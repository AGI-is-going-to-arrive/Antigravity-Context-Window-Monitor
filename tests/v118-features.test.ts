import { FALLBACK_APP_VERSION } from '../src/core/version';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { CdpOverlayPayload, CdpStatus } from '../src/app/sidecar-types';
import {
    CompactionRecoveryBriefTracker,
    SETTINGS_BACKUP_MAX_BYTES,
    buildAllowlistedHandoffV2,
    buildCompactionRecoveryEventKey,
    buildRedactedDiagnostics,
    buildSettingsBackupJson,
    combineSerializedRunwayWithWeekly,
    enrichLedgerEntriesForIngestion,
    parseAndValidateSettingsBackup,
} from '../src/app/sidecar-types';
import { createSidecarRuntimeProvider } from '../src/app/sidecar-runtime';
import { CascadeStatus } from '../src/constants';
import { DailyLedger, UNATTRIBUTED_WORKSPACE_KEY, aggregateWorkspaceLeaderboard } from '../src/daily-ledger';
import { DailyStore } from '../src/daily-store';
import { DurableState } from '../src/durable-state';
import { QuotaRunwayTracker } from '../src/quota-runway';
import { buildCalendarExportMarkdown } from '../src/cli-usage-scanner';
import type { LSInfo } from '../src/discovery';
import type { GMSummary } from '../src/gm-tracker';
import type { ModelConfig, UserQuotaSummary, UserStatusInfo } from '../src/models';
import type { ContextUsage, TrajectorySummary } from '../src/tracker';
import { StatusBarManager } from '../src/statusbar';
import {
    activate as activateIde,
    deactivate as deactivateIde,
    dismissIdeRecoveryBrief,
    exportIdeRedactedDiagnostics,
    exportIdeSettingsBackup,
    importIdeSettingsBackup,
} from '../src/extension';
import { buildPublishedMonitorObservation } from '../src/core/context-display';
import { showMonitorPanel } from '../src/webview-panel';

const vscodeState = (() => {
    const configValues: Record<string, unknown> = {
        'statusBar.tooltipDensity': 'auto',
        'statusBar.showContext': true,
        'statusBar.showQuota': true,
        'statusBar.showResetCountdown': true,
        'statusBar.showAiCredits': true,
        'statusBar.showSpeed': true,
        'statusBar.showCacheHit': false,
        'statusBar.showSessionCost': false,
    };
    const executedCommands: Array<{ cmd: string; args: unknown[] }> = [];
    const copiedTexts: string[] = [];
    const statusBarItem = {
        name: '',
        text: '',
        tooltip: undefined as unknown,
        backgroundColor: undefined as unknown,
        command: undefined as unknown,
        accessibilityInformation: undefined as unknown,
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
    };
    let onMessage: ((msg: Record<string, unknown>) => Promise<void> | void) | null = null;
    let onDispose: (() => void) | null = null;
    let onViewState: ((e: { webviewPanel: { visible: boolean; active: boolean } }) => void) | null = null;
    const postedMessages: Array<Record<string, unknown>> = [];

    const install = () => {
        const win = vscode.window as unknown as Record<string, unknown>;
        win.createStatusBarItem = vi.fn(() => statusBarItem);
        win.createOutputChannel = vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() }));
        win.createWebviewPanel = vi.fn(() => ({
            title: '',
            visible: true,
            active: true,
            reveal: vi.fn(),
            dispose: vi.fn(() => { onDispose?.(); }),
            onDidChangeViewState: vi.fn((cb: typeof onViewState) => {
                onViewState = cb;
                return { dispose: vi.fn() };
            }),
            onDidDispose: vi.fn((cb: () => void) => {
                onDispose = cb;
                return { dispose: vi.fn() };
            }),
            webview: {
                html: '',
                postMessage: vi.fn(async (m: Record<string, unknown>) => {
                    postedMessages.push(m);
                    return true;
                }),
                onDidReceiveMessage: vi.fn((cb: typeof onMessage) => {
                    onMessage = cb;
                    return { dispose: vi.fn() };
                }),
            },
        }));
        win.showSaveDialog = vi.fn(async () => undefined);
        win.showOpenDialog = vi.fn(async () => undefined);

        const ws = vscode.workspace as unknown as Record<string, unknown>;
        ws.workspaceFolders = [{ uri: { fsPath: '/Users/secretuser/private-repo', toString: () => 'file:///Users/secretuser/private-repo' } }];
        ws.getConfiguration = vi.fn((section?: string) => ({
            get: <T>(key: string, def?: T): T => {
                if (section === 'window' && key === 'zoomLevel') {
                    return (configValues['window.zoomLevel'] ?? def ?? 0) as T;
                }
                return (key in configValues ? configValues[key] : def) as T;
            },
            update: vi.fn(async (key: string, val: unknown) => {
                configValues[key] = val;
            }),
        }));
        ws.onDidChangeConfiguration = vi.fn(() => ({ dispose: vi.fn() }));
        ws.onDidChangeWorkspaceFolders = vi.fn(() => ({ dispose: vi.fn() }));

        const cmds = vscode.commands as unknown as Record<string, unknown>;
        cmds.executeCommand = vi.fn(async (cmd: string, ...args: unknown[]) => {
            executedCommands.push({ cmd, args });
        });
        cmds.registerCommand = vi.fn(() => ({ dispose: vi.fn() }));

        const envObj = vscode.env as unknown as Record<string, unknown>;
        envObj.language = 'en';
        envObj.clipboard = {
            writeText: vi.fn(async (txt: string) => {
                copiedTexts.push(txt);
            }),
        };
    };

    return {
        configValues,
        executedCommands,
        copiedTexts,
        statusBarItem,
        postedMessages,
        getOnMessage: () => onMessage,
        getOnDispose: () => onDispose,
        getOnViewState: () => onViewState,
        reset: () => {
            executedCommands.length = 0;
            copiedTexts.length = 0;
            postedMessages.length = 0;
            onMessage = null;
            onDispose = null;
            onViewState = null;
            install();
        },
    };
})();

function makeTmpDir(prefix = 'acm-v118-'): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFixtureLs(): LSInfo {
    return {
        port: 49999,
        csrfToken: 'tok-super-secret-xyz',
        pid: 4242,
        useTls: false,
        hostname: '127.0.0.1',
        surface: 'app',
        source: 'process',
    };
}

function makeFixtureModels(frac5h = 0.8): ModelConfig[] {
    return [
        {
            model: 'MODEL_PLACEHOLDER_M37',
            label: 'Gemini 3.1 Pro (High)',
            quotaInfo: {
                remainingFraction: frac5h,
                resetTime: '2026-11-27T18:00:00.000Z',
            },
        },
    ];
}

function makeFixtureQuotaSummary(frac5h = 0.8, frac7d = 0.45): UserQuotaSummary {
    return {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini',
                modelIds: ['MODEL_PLACEHOLDER_M37'],
                fiveHour: { remainingFraction: frac5h, resetTime: '2026-11-27T18:00:00.000Z' },
                weekly: { remainingFraction: frac7d, resetTime: '2026-12-03T00:00:00.000Z' },
            },
        ],
    } as unknown as UserQuotaSummary;
}

function makeFixtureUser(): UserStatusInfo {
    return {
        name: 'Alice Secret',
        email: 'alice.secret@example.com',
        planName: 'Pro',
        userTierName: 'Tier 1',
        availableCredits: [],
    };
}

function makeFixtureUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        cascadeId: 'cascade-main-1111',
        title: 'Secret Repo Investigation',
        model: 'MODEL_PLACEHOLDER_M37',
        modelDisplayName: 'Gemini 3.1 Pro (High)',
        contextUsed: 120_000,
        contextLimit: 200_000,
        usagePercent: 60,
        stepCount: 12,
        status: CascadeStatus.IDLE,
        lastModifiedTime: '2026-11-27T12:00:00.000Z',
        isEstimated: false,
        totalOutputTokens: 2400,
        totalToolCallOutputTokens: 800,
        estimatedDeltaSinceCheckpoint: 0,
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        imageGenStepCount: 0,
        repositoryName: 'private-repo',
        branchName: 'feat/secret-branch',
        gitOriginUrl: 'https://github.com/secretorg/private-repo.git',
        gitRootUri: 'file:///Users/secretuser/private-repo',
        ...overrides,
    };
}

function makeFixtureTrajectories(): TrajectorySummary[] {
    return [
        {
            cascadeId: 'cascade-main-1111',
            summary: 'Secret Repo Investigation',
            stepCount: 12,
            status: CascadeStatus.IDLE,
            lastModifiedTime: '2026-11-27T12:00:00.000Z',
            workspaceUris: ['file:///Users/secretuser/private-repo'],
            repositoryName: 'private-repo',
            branchName: 'feat/secret-branch',
            requestedModel: 'MODEL_PLACEHOLDER_M37',
            generatorModel: 'MODEL_PLACEHOLDER_M37',
        },
        {
            cascadeId: 'cascade-other-2222',
            summary: 'Unrelated Chat',
            stepCount: 4,
            status: CascadeStatus.IDLE,
            lastModifiedTime: '2026-11-27T11:30:00.000Z',
            workspaceUris: [],
            requestedModel: 'MODEL_PLACEHOLDER_M37',
            generatorModel: 'MODEL_PLACEHOLDER_M37',
        },
    ];
}

function makeFixtureGmSummary(createdAtIso = '2026-11-27T12:00:00.000Z'): GMSummary {
    const call1 = {
        executionId: 'exec-1',
        model: 'MODEL_PLACEHOLDER_M37',
        modelDisplay: 'Gemini 3.1 Pro (High)',
        responseModel: 'gemini-3.1-pro',
        modelAccuracy: 'exact' as const,
        inputTokens: 10_000,
        outputTokens: 1_000,
        cacheReadTokens: 80_000,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
        ttftSeconds: 1.0,
        streamingSeconds: 4.0,
        credits: 2,
        retries: 0,
        hasError: false,
        createdAt: createdAtIso,
        accountEmail: 'alice.secret@example.com',
        stepIndices: [1],
    };
    const call2 = {
        ...call1,
        executionId: 'exec-2',
        outputTokens: 500,
        ttftSeconds: 3.0,
        streamingSeconds: 2.0,
        createdAt: '2026-11-27T12:00:30.000Z',
        stepIndices: [2],
    };
    return {
        totalCalls: 2,
        totalInputTokens: 20_000,
        totalOutputTokens: 1_500,
        totalCacheRead: 160_000,
        totalCacheCreation: 0,
        totalThinkingTokens: 0,
        totalCredits: 4,
        totalRetryCount: 0,
        totalRetryTokens: 0,
        retryErrorCodes: {},
        toolCallCounts: { SENTINEL_UNRELATED_GLOBAL_TOOL: 99 },
        modelBreakdown: {},
        conversations: [
            {
                cascadeId: 'cascade-main-1111',
                title: 'Secret Repo Investigation',
                totalSteps: 12,
                calls: [call1, call2],
                checkpointSummaries: [],
            },
        ],
    } as unknown as GMSummary;
}

describe('v1.18 Wave 3B Dual-Host Features & Wiring', () => {
    const tmpDirs: string[] = [];

    beforeEach(() => {
        vscodeState.reset();
    });

    afterEach(async () => {
        await deactivateIde().catch(() => {});
        for (const d of tmpDirs.splice(0)) {
            fs.rmSync(d, { recursive: true, force: true });
        }
        delete process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH;
    });

    it('1. package.json has conflict-free IDE keybindings (ZERO Cmd+Shift+Q), v1.18 settings, synchronized runtime version, zero runtime deps', () => {
        const pkgPath = path.resolve(__dirname, '../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

        expect(pkg.version).toBe(FALLBACK_APP_VERSION);
        expect(pkg.dependencies).toBeUndefined();

        const keybindings: Array<{ command: string; key: string; mac?: string; when?: string }> = pkg.contributes.keybindings;
        expect(Array.isArray(keybindings)).toBe(true);
        const showKb = keybindings.find(k => k.command === 'antigravity-context-monitor.showDetails');
        const refreshKb = keybindings.find(k => k.command === 'antigravity-context-monitor.refresh');
        expect(showKb).toEqual({
            command: 'antigravity-context-monitor.showDetails',
            key: 'ctrl+alt+m',
            mac: 'cmd+alt+m',
            when: '!terminalFocus',
        });
        expect(refreshKb).toEqual({
            command: 'antigravity-context-monitor.refresh',
            key: 'ctrl+alt+shift+r',
            mac: 'cmd+alt+shift+r',
            when: 'antigravityContextMonitor.panelFocused || !inputFocus',
        });
        // Strictly NEVER bind macOS system Log Out shortcut Cmd+Shift+Q
        for (const kb of keybindings) {
            expect((kb.mac || '').toLowerCase()).not.toContain('cmd+shift+q');
            expect((kb.key || '').toLowerCase()).not.toContain('cmd+shift+q');
        }

        const props = pkg.contributes.configuration.properties;
        expect(props['antigravityContextMonitor.languagePreference'].default).toBe('auto');
        expect(props['antigravityContextMonitor.languagePreference'].enum).toEqual(['auto', 'en', 'zh', 'both']);
        expect(props['antigravityContextMonitor.contextPctBasis'].default).toBe('compaction');
        expect(props['antigravityContextMonitor.speedMetricMode'].default).toBe('decode');
        expect(props['antigravityContextMonitor.quotaWindowMode'].default).toBe('5h');
        expect(props['antigravityContextMonitor.quotaDirectionMode'].default).toBe('remaining');
        expect(props['antigravityContextMonitor.nativeHudAutoHideOnOverview'].default).toBe(true);
        expect(props['antigravityContextMonitor.cdpOverlayFontSize'].default).toBe('normal');
        expect(props['antigravityContextMonitor.cdpOverlayHighContrast'].default).toBe(false);
        expect(props['antigravityContextMonitor.customFxCurrency'].default).toBeNull();
    });

    it('2. Ingestion-time workspace attribution attributes each chat once without smearing unrelated chats', () => {
        const trajectories = [
            { cascadeId: 'chat-a', workspaceUris: ['file:///Users/dev/project-alpha'] },
            { cascadeId: 'chat-b', workspaceUris: ['vscode-remote://ssh-remote%2Bprod-box/srv/app'] },
            { cascadeId: 'chat-unscoped', workspaceUris: [] },
        ];
        const rawEntries = [
            {
                dedupKey: 'chat-a|exec-1',
                cascadeId: 'chat-a',
                call: {
                    model: 'MODEL_PLACEHOLDER_M37',
                    modelDisplay: 'Gemini 3.1 Pro (High)',
                    responseModel: 'gemini-3.1-pro',
                    inputTokens: 1000,
                    outputTokens: 200,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    thinkingTokens: 0,
                    credits: 1,
                    createdAt: '2026-11-27T10:00:00.000Z',
                    accountEmail: 'alice@example.com',
                },
            },
            {
                dedupKey: 'chat-b|exec-2',
                cascadeId: 'chat-b',
                call: {
                    model: 'MODEL_PLACEHOLDER_M37',
                    modelDisplay: 'Gemini 3.1 Pro (High)',
                    responseModel: 'gemini-3.1-pro',
                    inputTokens: 3000,
                    outputTokens: 500,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    thinkingTokens: 0,
                    credits: 2,
                    createdAt: '2026-11-27T10:05:00.000Z',
                },
            },
            {
                dedupKey: 'chat-unscoped|exec-3',
                cascadeId: 'chat-unscoped',
                call: {
                    model: 'MODEL_PLACEHOLDER_M37',
                    modelDisplay: 'Gemini 3.1 Pro (High)',
                    responseModel: 'gemini-3.1-pro',
                    inputTokens: 400,
                    outputTokens: 100,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    thinkingTokens: 0,
                    credits: 0,
                    createdAt: '2026-11-27T10:10:00.000Z',
                },
            },
        ];

        const enriched = enrichLedgerEntriesForIngestion(rawEntries, {
            trajectories,
            activeCascadeId: 'chat-a',
            activeWorkspaceUri: 'file:///Users/dev/project-alpha',
            fallbackAuthority: 'local',
            fallbackAccount: 'bob@example.com',
        });

        expect(enriched[0].workspace).toBe('file:///Users/dev/project-alpha');
        expect(enriched[0].authority).toBe('local');
        expect(enriched[0].account).toBe('alice@example.com');
        expect(enriched[1].workspace).toBe('vscode-remote://ssh-remote%2Bprod-box/srv/app');
        expect(enriched[1].authority).toBe('ssh-remote+prod-box');
        expect(enriched[1].account).toBe('bob@example.com');
        // Unrelated conversation lacking workspace MUST NOT be smeared with chat-a's active workspace!
        expect(enriched[2].workspace).toBeUndefined();

        const ledger = new DailyLedger('2026-11-27');
        const rec = ledger.recordCallsDetailed(enriched as Parameters<DailyLedger['recordCallsDetailed']>[0], 'app');
        expect(rec.added).toBe(3);

        const leaderboard = aggregateWorkspaceLeaderboard({ ledger });
        const keys = leaderboard.rows.map(e => e.workspaceKey);
        expect(keys).toContain(UNATTRIBUTED_WORKSPACE_KEY);
        expect(leaderboard.rows.some(e => e.workspaceKey.includes('project-alpha') && e.totalTokens === 1200)).toBe(true);
        expect(leaderboard.rows.some(e => e.authority === 'ssh-remote+prod-box' && e.totalTokens === 3500)).toBe(true);
        expect(leaderboard.rows.find(e => e.workspaceKey === UNATTRIBUTED_WORKSPACE_KEY)?.totalTokens).toBe(500);
    });

    it('3. Weekly active-hours quota runway persists across App+IDE restarts and StatusBarManager projects 5h/7d/tightest & remaining/used + E2E speed', async () => {
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');

        let clockMs = Date.parse('2026-11-25T10:00:00.000Z');
        let frac7d = 0.80;
        const makeRuntime = () => createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            hostLocale: 'en-US',
            deps: {
                now: () => clockMs,
                discoverLS: async () => makeFixtureLs(),
                fetchFullUserStatus: async () => ({
                    ok: true,
                    configs: makeFixtureModels(0.8),
                    userInfo: makeFixtureUser(),
                }),
                fetchUserQuotaSummary: async () => makeFixtureQuotaSummary(0.8, frac7d),
                fetchOrchestratorSettings: async () => null,
                fetchAvailableModels: async () => null,
                getAllTrajectories: async () => makeFixtureTrajectories(),
                getContextUsage: async () => makeFixtureUsage(),
                fetchTrajectoryGeneratorMetadataResult: async () => ({ ok: true, metadata: [] }),
                fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                processActivity: async () => false,
                fetchGM: async () => makeFixtureGmSummary(new Date(clockMs).toISOString()),
            },
        });

        const rt1 = makeRuntime();
        await rt1.pollNow(true);
        // Advance 2 hours & burn 7d quota
        clockMs += 2 * 3_600_000;
        frac7d = 0.65;
        await rt1.pollNow(true);
        await rt1.dispose();

        // Reload in a second runtime + simulate an IDE observation merge
        const disk = new DurableState(statePath);
        const g = disk.globalBucket();
        const savedRunway = g.get<Record<string, unknown> | null>('quotaRunwayState', null);
        const savedWeekly = g.get<Record<string, unknown> | null>('quotaRunwayWeeklyBuckets', null);
        expect(savedRunway).toBeTruthy();
        expect(savedWeekly).toBeTruthy();

        const combined = combineSerializedRunwayWithWeekly(savedRunway as never, savedWeekly as never);
        const restored = QuotaRunwayTracker.deserialize(combined as never);
        const weeklyEst = restored.estimateWeekly(
            { account: 'alice.secret@example.com', pool: 'gemini', window: '7d' },
            clockMs,
        );
        expect(weeklyEst.latestRemainingFraction).toBeCloseTo(0.65, 2);

        // StatusBarManager projections: default 5h/remaining -> 7d/used + E2E speed + weekly at_risk
        const sb = new StatusBarManager();
        sb.setDisplayPrefs({ showSpeed: true });
        sb.setModelConfigs(makeFixtureModels(0.8));
        sb.setQuotaSummary(makeFixtureQuotaSummary(0.8, 0.45));
        sb.setTelemetry(makeFixtureGmSummary(), 'cascade-main-1111');
        sb.update(makeFixtureUsage());
        expect(vscodeState.statusBarItem.text).toContain('$(layers) 80%');
        expect((vscodeState.statusBarItem.tooltip as { value: string }).value).toContain('Quota remaining');

        sb.setQuotaDisplayModes({
            quotaWindowMode: '7d',
            quotaDirectionMode: 'used',
            speedMetricMode: 'e2e',
        });
        sb.setWeeklyQuotaRunways({
            gemini: {
                account: 'alice.secret@example.com',
                pool: 'gemini',
                window: '7d',
                resetEpoch: 0,
                status: 'at_risk',
                burnRatePctPerActiveHour: 5,
                avgActiveHoursPerDay: 4,
                projectedDailyBurnPct: 20,
                estRemainingActiveHours: 9,
                estExhaustMs: 36 * 3_600_000,
                timeToResetMs: 96 * 3_600_000,
                latestRemainingFraction: 0.45,
                coverage: {
                    activeHours: 4,
                    activeHourBuckets: 4,
                    activeDays: 2,
                    observedSpanHours: 30,
                    minActiveHours: 2,
                    minActiveDays: 2,
                    minSpanHours: 24,
                    meetsThreshold: true,
                },
                dailySummaries: [],
                offlineGapCount: 0,
                fractionalResetCount: 0,
                epochsConsidered: 1,
            },
        });
        sb.setPromptCacheTtl({
            key: { account: 'a', backend: 'b', conversation: 'c', model: 'm', branch: 'main' },
            compositeKey: 'a|b|c|m|main',
            ttlEstimateState: 'cooling',
            measuredCacheState: 'warm',
            idleSeconds: 210,
            remainingTtlSeconds: 90,
            warnSeconds: 180,
            expireSeconds: 300,
            clockAnomaly: 'none',
            possibleCauses: [],
            measuredCacheHitRate: 0.85,
            isHeuristic: true,
        });
        sb.update(makeFixtureUsage());
        expect(vscodeState.statusBarItem.text).toContain('$(layers) Weekly quota used 55%');
        expect(vscodeState.statusBarItem.text).toContain('E2E');
        const tipVal = (vscodeState.statusBarItem.tooltip as { value: string }).value;
        expect(tipVal).toContain('Quota used');
        expect(tipVal).toContain('Speed (E2E) / TTFT');
        expect(tipVal).toContain('model-call E2E 2/2');
        expect(tipVal).toContain('5m TTL cooling');
        sb.dispose();
    });

    it('4. App Sidecar: Prompt Cache 5m TTL, Decode vs E2E speed, CDP enrichment, per-view language (incl. both), split HUD', async () => {
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');

        let clockMs = Date.parse('2026-11-27T12:00:30.000Z');
        let capturedPayload: CdpOverlayPayload | null = null;
        const rt = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            hostLocale: 'zh-CN',
            deps: {
                now: () => clockMs,
                discoverLS: async () => makeFixtureLs(),
                fetchFullUserStatus: async () => ({
                    ok: true,
                    configs: makeFixtureModels(0.8),
                    userInfo: makeFixtureUser(),
                }),
                fetchUserQuotaSummary: async () => makeFixtureQuotaSummary(0.8, 0.45),
                fetchOrchestratorSettings: async () => null,
                fetchAvailableModels: async () => null,
                getAllTrajectories: async () => makeFixtureTrajectories(),
                getContextUsage: async () => makeFixtureUsage(),
                fetchTrajectoryGeneratorMetadataResult: async () => ({ ok: true, metadata: [] }),
                fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                processActivity: async () => false,
                fetchGM: async () => makeFixtureGmSummary('2026-11-27T12:00:00.000Z'),
                createCdpOverlayManager: () => ({
                    getStatus: (): CdpStatus => ({
                        state: 'disabled',
                        diagnosticCode: 'disabled',
                        composerEnabled: false,
                        topBarEnabled: false,
                        platformGuide: { platform: 'darwin', command: '', en: '', zh: '' },
                    }),
                    setToggles: async () => ({
                        state: 'disabled',
                        diagnosticCode: 'disabled',
                        composerEnabled: false,
                        topBarEnabled: false,
                        platformGuide: { platform: 'darwin', command: '', en: '', zh: '' },
                    }),
                    updatePayload: async (p: CdpOverlayPayload) => {
                        capturedPayload = p;
                        return {
                            state: 'disabled',
                            diagnosticCode: 'disabled',
                            composerEnabled: false,
                            topBarEnabled: false,
                            platformGuide: { platform: 'darwin', command: '', en: '', zh: '' },
                        };
                    },
                    dispose: async () => {},
                }),
            },
        });

        // Split HUD defaults: App true, IDE false, autoHideOnOverview true
        const initSettings = rt.getAppSettings();
        expect(initSettings.appShowNativeHudBar).toBe(true);
        expect(initSettings.ideShowNativeHudBar).toBe(false);
        expect(initSettings.nativeHudAutoHideOnOverview).toBe(true);

        // hostLocale 'zh-CN' with auto -> effective 'zh'
        const zhSnap = await rt.getSnapshot({ viewMode: 'aux' });
        expect(zhSnap.language).toBe('zh');

        // Explicit legacy 'both' is accepted and preserved!
        const setBoth = await rt.handleAction({ command: 'setAppSetting', key: 'languagePreference', value: 'both' });
        expect(setBoth.ok).toBe(true);
        expect(rt.getAppSettings().languagePreference).toBe('both');
        const bothSnap = await rt.getSnapshot({ viewMode: 'aux' });
        expect(bothSnap.language).toBe('both');

        // Configure v1.18 overlay visual presets + quota modes + E2E speed
        await rt.handleAction({ command: 'setAppSetting', key: 'cdpOverlayFontSize', value: 'large' });
        await rt.handleAction({ command: 'setAppSetting', key: 'cdpOverlayHighContrast', value: true });
        await rt.handleAction({ command: 'setAppSetting', key: 'quotaWindowMode', value: '7d' });
        await rt.handleAction({ command: 'setAppSetting', key: 'quotaDirectionMode', value: 'used' });

        await rt.pollNow(true);
        // Decode weighted = (1000+500)/(4+2) = 250 tok/s
        const decodePayload = rt.buildOverlayPayload(clockMs);
        expect(decodePayload.speedMetricMode).toBe('decode');
        expect(decodePayload.avgOutputSpeedTps).toBe(250);
        expect(decodePayload.speedCoverage).toEqual({ measuredCount: 2, totalCount: 2 });
        expect(decodePayload.fontSizePreset).toBe('large');
        expect(decodePayload.highContrast).toBe(true);
        expect(decodePayload.quotaWindowMode).toBe('7d');
        expect(decodePayload.quotaDirectionMode).toBe('used');
        expect(decodePayload.promptCacheTtlState).toBe('warm');

        // Switch to E2E: weighted = (1000+500)/((1+4)+(3+2)) = 1500/10 = 150 tok/s
        await rt.handleAction({ command: 'setAppSetting', key: 'speedMetricMode', value: 'e2e' });
        // Step forward in <=60s increments (staying below 90s suspend-resume anomaly threshold): 210s -> cooling, 320s -> cold
        rt.buildOverlayPayload(clockMs + 60_000);
        rt.buildOverlayPayload(clockMs + 120_000);
        rt.buildOverlayPayload(clockMs + 180_000);
        const coolingPayload = rt.buildOverlayPayload(clockMs + 210_000);
        expect(coolingPayload.speedMetricMode).toBe('e2e');
        expect(coolingPayload.avgOutputSpeedTps).toBe(150);
        expect(coolingPayload.promptCacheTtlState).toBe('cooling');
        rt.buildOverlayPayload(clockMs + 270_000);
        const coldPayload = rt.buildOverlayPayload(clockMs + 320_000);
        expect(coldPayload.promptCacheTtlState).toBe('cold');
        expect(capturedPayload).toBeTruthy();

        await rt.dispose();
    });

    it('5. Handoff v2 allowlist generator (App + IDE): subject-bound, ZERO raw prompt slicing, ZERO global tools, SEC-04 privacy safe', async () => {
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');

        const rt = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            initialWorkspaceUris: ['file:///Users/secretuser/private-repo'],
            deps: {
                discoverLS: async () => makeFixtureLs(),
                fetchFullUserStatus: async () => ({
                    ok: true,
                    configs: makeFixtureModels(0.8),
                    userInfo: makeFixtureUser(),
                }),
                fetchUserQuotaSummary: async () => makeFixtureQuotaSummary(),
                fetchOrchestratorSettings: async () => null,
                fetchAvailableModels: async () => null,
                getAllTrajectories: async () => makeFixtureTrajectories(),
                getContextUsage: async () => makeFixtureUsage(),
                fetchTrajectoryGeneratorMetadataResult: async () => ({ ok: true, metadata: [] }),
                fetchTrajectorySteps: async () => ({
                    ok: true,
                    hasGaps: false,
                    steps: [
                        { userInput: { userResponse: 'SENTINEL_RAW_PROMPT_SECRET_999' } },
                    ],
                }),
                processActivity: async () => false,
                fetchGM: async () => makeFixtureGmSummary(),
            },
        });
        await rt.pollNow(true);

        // Stale subject cascadeId -> rejected with 409!
        const mismatch = await rt.handleAction({
            command: 'previewHandoffV2',
            cascadeId: 'cascade-other-2222',
        });
        expect(mismatch.ok).toBe(false);
        expect(mismatch.statusCode).toBe(409);

        // Privacy masked (default true): zero raw prompt, zero global tool, zero workspace/branch/title leaks!
        const maskedPreview = await rt.handleAction({
            command: 'previewHandoffV2',
            cascadeId: 'cascade-main-1111',
        });
        expect(maskedPreview.ok).toBe(true);
        const maskedText = String((maskedPreview as { text?: string }).text || '');
        const maskedRes = maskedPreview.result as { markdown?: string; text?: string; previewText?: string };
        expect(maskedRes.markdown).toBe(maskedText);
        expect(maskedRes.text).toBe(maskedText);
        expect(maskedRes.previewText).toBe(maskedText);
        expect(maskedPreview.messages?.[0]?.command).toBe('handoffV2PreviewResult');
        expect(maskedPreview.messages?.[0]?.markdown).toBe(maskedText);
        expect(maskedText).toContain('Gemini 3.1 Pro');
        expect(maskedText).toContain('HANDOFF');
        expect(maskedText).not.toContain('SENTINEL_RAW_PROMPT_SECRET_999');
        expect(maskedText).not.toContain('SENTINEL_UNRELATED_GLOBAL_TOOL');
        expect(maskedText).not.toContain('private-repo');
        expect(maskedText).not.toContain('feat/secret-branch');
        expect(maskedText).not.toContain('alice.secret@example.com');

        // Even unmasked: STILL zero raw prompt slicing and zero global tool count!
        await rt.handleAction({ command: 'setPrivacyMask', windowId: 'win-hf', masked: false });
        const unmaskedPreview = await rt.handleAction({ command: 'previewHandoffV2', windowId: 'win-hf' });
        const unmaskedText = String((unmaskedPreview as { text?: string }).text || '');
        expect(unmaskedText).toContain('private-repo');
        expect(unmaskedText).not.toContain('SENTINEL_RAW_PROMPT_SECRET_999');
        expect(unmaskedText).not.toContain('SENTINEL_UNRELATED_GLOBAL_TOOL');

        // Direct unit check on buildAllowlistedHandoffV2 allowlist binding
        const direct = buildAllowlistedHandoffV2({
            subjectCascadeId: 'cid-1',
            dataRevision: 7,
            canonicalModel: 'Gemini 3.1 Pro',
            workspaceUriOrLabel: 'file:///Users/dev/my-app',
            privacyMasked: false,
            lang: 'en',
        });
        expect(direct.subjectCascadeId).toBe('cid-1');
        expect(direct.dataRevision).toBe(7);
        expect(direct.previewText).toContain('HANDOFF');
        expect(direct.previewText).toContain('my-app');
        await rt.dispose();
    });

    it('6. Compaction Recovery Brief dedup suppresses duplicates across replay/resume/reload/rewind and ignores cross-model/undo', async () => {
        const tracker = new CompactionRecoveryBriefTracker();
        // Undo/rewind never triggers
        expect(tracker.evaluate({
            cascadeId: 'c1', model: 'm1', role: 'single', branch: 'main',
            currentTokens: 50_000, limitTokens: 200_000, previousTokens: 150_000,
            compressionDetected: true, isUndo: true, compactionEventAnchor: 10,
        })).toBeNull();

        // Real same-(model, role, branch) compaction triggers read-only brief
        const brief = tracker.evaluate({
            cascadeId: 'c1', model: 'm1', role: 'single', branch: 'main',
            currentTokens: 50_000, limitTokens: 200_000, previousTokens: 150_000,
            dropTokens: 100_000, compressionDetected: true, isUndo: false, compactionEventAnchor: 12,
        });
        expect(brief).not.toBeNull();
        expect(brief!.readOnly).toBe(true);
        expect(brief!.autoInject).toBe(false);
        expect(brief!.beforeTokens).toBe(150_000);
        expect(brief!.afterTokens).toBe(50_000);
        expect(brief!.savedTokens).toBe(100_000);
        expect(brief!.previousTokens).toBe(150_000);
        expect(brief!.currentTokens).toBe(50_000);
        expect(brief!.dropTokens).toBe(100_000);
        expect(brief!.eventKey).toBe(buildCompactionRecoveryEventKey({
            cascadeId: 'c1',
            model: 'm1',
            role: 'single',
            branch: 'main',
            eventStepOrTimestamp: 12,
        }));

        // Cross-model switch without checkpoint drop does NOT falsely trigger a new event key
        tracker.dismiss(brief!.eventKey);
        expect(tracker.evaluate({
            cascadeId: 'c1', model: 'm2', role: 'single', branch: 'main',
            currentTokens: 40_000, limitTokens: 200_000, previousTokens: 50_000,
            compressionDetected: false, compactionEventAnchor: 13,
        })).toBeNull();

        // Dismiss + persist + reload into fresh Sidecar runtime -> NEVER re-surfaces!
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');
        const makeCompactedRuntime = () => createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: {
                discoverLS: async () => makeFixtureLs(),
                fetchFullUserStatus: async () => ({
                    ok: true, configs: makeFixtureModels(), userInfo: makeFixtureUser(),
                }),
                fetchUserQuotaSummary: async () => makeFixtureQuotaSummary(),
                fetchOrchestratorSettings: async () => null,
                fetchAvailableModels: async () => null,
                getAllTrajectories: async () => makeFixtureTrajectories(),
                getContextUsage: async () => makeFixtureUsage({
                    compressionDetected: true,
                    checkpointCompressionDrop: 90_000,
                }),
                fetchTrajectoryGeneratorMetadataResult: async () => ({ ok: true, metadata: [] }),
                fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                processActivity: async () => false,
                fetchGM: async () => makeFixtureGmSummary(),
            },
        });

        const rt1 = makeCompactedRuntime();
        await rt1.pollNow(true);
        const firstBrief = rt1.getState().recoveryBrief;
        expect(firstBrief).not.toBeNull();
        expect(firstBrief!.readOnly).toBe(true);

        const dismissRes = await rt1.handleAction({
            command: 'dismissRecoveryBrief',
            eventKey: firstBrief!.eventKey,
        });
        expect(dismissRes.ok).toBe(true);
        expect(rt1.getState().recoveryBrief).toBeNull();
        await rt1.dispose();

        // Brand-new runtime instance replaying exact same compaction event -> suppressed!
        const rt2 = makeCompactedRuntime();
        await rt2.pollNow(true);
        expect(rt2.getState().recoveryBrief).toBeNull();
        await rt2.dispose();
    });

    it('7. Settings JSON backup/import (App + IDE): schemaVersion 1, <=64KB cap, strict allowlist, atomic validation, strips secrets', async () => {
        // Oversized backup rejected before JSON.parse
        const huge = JSON.stringify({ schemaVersion: 1, settings: { pad: 'x'.repeat(SETTINGS_BACKUP_MAX_BYTES + 100) } });
        const hugeRes = parseAndValidateSettingsBackup(huge);
        expect(hugeRes.ok).toBe(false);

        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');
        const rt = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
        });

        // Export backup -> verify zero secrets / paths / update metadata / session IDs
        const exported = await rt.handleAction({ command: 'exportSettingsBackup' });
        expect(exported.ok).toBe(true);
        expect(exported.messages?.[0]?.command).toBe('settingsBackupExportResult');
        const backupObj = JSON.parse(String((exported as { content?: string }).content || '{}'));
        expect(backupObj.schemaVersion).toBe(1);
        expect(backupObj.settings).not.toHaveProperty('lastUpdateCheck');
        expect(backupObj.settings).not.toHaveProperty('csrfToken');
        expect(backupObj.settings).not.toHaveProperty('workspaceUris');
        expect(backupObj.settings).not.toHaveProperty('activeConversationId');

        // Import with valid settings + forbidden fields -> forbidden stripped, valid committed atomically
        const dirtyBackup = JSON.stringify({
            schemaVersion: 1,
            settings: {
                displayCurrency: 'CAD',
                customFxRate: 1.38,
                quotaWindowMode: '7d',
                quotaDirectionMode: 'used',
                cdpOverlayFontSize: 'compact',
                cdpOverlayHighContrast: true,
                csrfToken: 'LEAKED_TOKEN',
                lastUpdateCheck: { latestVersion: '9.9.9', assetUrl: 'https://evil.example/x' },
                workspaceUris: ['/etc/passwd'],
                activeConversationId: 'live-sess-id',
                stateFilePath: '/tmp/evil',
            },
            customPricing: {
                'gemini-3.1-pro': { input: 2.5, output: 10.0, cacheRead: 0.25 },
            },
        });
        const impOk = await rt.handleAction({ command: 'importSettingsBackup', json: dirtyBackup });
        expect(impOk.ok).toBe(true);
        const impResult = impOk.result as { strippedKeys: string[]; customPricingImported: boolean };
        expect(impResult.strippedKeys).toEqual(expect.arrayContaining([
            'csrfToken', 'lastUpdateCheck', 'workspaceUris', 'activeConversationId', 'stateFilePath',
        ]));
        expect(impResult.customPricingImported).toBe(true);
        expect(rt.getAppSettings().displayCurrency).toBe('CAD');
        expect(rt.getAppSettings().quotaWindowMode).toBe('7d');
        expect(rt.getAppSettings().cdpOverlayFontSize).toBe('compact');
        expect(rt.getAppSettings().cdpOverlayHighContrast).toBe(true);

        // Atomic rejection on invalid field -> ZERO partial mutation!
        const invalidBackup = JSON.stringify({
            schemaVersion: 1,
            settings: {
                displayCurrency: 'JPY',
                quotaWindowMode: 'invalid_horizon',
            },
        });
        const impBad = await rt.handleAction({ command: 'importSettingsBackup', json: invalidBackup });
        expect(impBad.ok).toBe(false);
        expect(rt.getAppSettings().displayCurrency).toBe('CAD'); // untouched!
        await rt.dispose();

        // Verify buildSettingsBackupJson directly excludes non-allowlisted properties
        const rawBuilt = buildSettingsBackupJson({
            displayCurrency: 'EUR',
            lastUpdateCheck: { checkedAt: 1, latestVersion: '2.0.0' },
            csrfToken: 'secret',
        } as never);
        expect(rawBuilt.json).not.toContain('lastUpdateCheck');
        expect(rawBuilt.json).not.toContain('csrfToken');
    });

    it('8. Redacted Diagnostics export (App + IDE): opaque aliases, buildIds, ZERO emails/paths/tokens/titles/prompts', async () => {
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');

        const rt = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            initialWorkspaceUris: ['file:///Users/secretuser/private-repo'],
            deps: {
                discoverLS: async () => makeFixtureLs(),
                fetchFullUserStatus: async () => ({
                    ok: true, configs: makeFixtureModels(), userInfo: makeFixtureUser(),
                }),
                fetchUserQuotaSummary: async () => makeFixtureQuotaSummary(),
                fetchOrchestratorSettings: async () => null,
                fetchAvailableModels: async () => null,
                getAllTrajectories: async () => makeFixtureTrajectories(),
                getContextUsage: async () => makeFixtureUsage(),
                fetchTrajectoryGeneratorMetadataResult: async () => ({ ok: true, metadata: [] }),
                fetchTrajectorySteps: async () => ({
                    ok: true, hasGaps: false,
                    steps: [{ userInput: { userResponse: 'TOP_SECRET_USER_PROMPT_XYZ' } }],
                }),
                processActivity: async () => false,
                fetchGM: async () => makeFixtureGmSummary(),
            },
        });
        await rt.pollNow(true);

        const res = await rt.handleAction({ command: 'exportRedactedDiagnostics' });
        expect(res.ok).toBe(true);
        expect(res.messages?.[0]?.command).toBe('redactedDiagnosticsResult');
        const content = String((res as { content?: string }).content || '');
        const parsed = JSON.parse(content);
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.surface).toBe('app-sidecar');
        expect(parsed.buildIds.webviewClient).toBeTruthy();
        expect(parsed.buildIds.cdpOverlay).toBeTruthy();
        expect(parsed.observation.subjectAlias).toMatch(/^conv_\d+$/);

        // Zero secret leaks!
        for (const sentinel of [
            'alice.secret@example.com',
            'Alice Secret',
            '/Users/secretuser/private-repo',
            'tok-super-secret-xyz',
            'Secret Repo Investigation',
            'TOP_SECRET_USER_PROMPT_XYZ',
            'cascade-main-1111',
        ]) {
            expect(content).not.toContain(sentinel);
        }
        await rt.dispose();

        // Direct sanitizer check on error strings with embedded emails/paths
        const diag = buildRedactedDiagnostics({
            surface: 'ide',
            version: '1.17.11',
            counters: { pollCount: 3 },
            freshness: { isStale: true, lastError: 'ECONNREFUSED /Users/alice/secret alice@corp.io' },
        });
        expect(diag.diagnostics.freshness.errorCode).toBe('ECONNREFUSED');
        expect(diag.json).not.toContain('/Users/alice');
        expect(diag.json).not.toContain('alice@corp.io');
    });

    it('9. Unified Markdown Calendar Export (App + IDE): empty selection returns empty, escapes untrusted Markdown cells', async () => {
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');

        // Seed a day into DurableState's dailyStore
        const ds = new DurableState(statePath);
        const store = new DailyStore(400);
        store.init(ds.globalBucket());
        store.restoreSnapshot({
            version: 1,
            records: {
                '2026-11-27': {
                    date: '2026-11-27',
                    cycles: [{
                        startTime: '2026-11-27T09:00:00.000Z',
                        endTime: '2026-11-27T10:00:00.000Z',
                        totalSteps: 5,
                        userInputs: 2,
                        toolCalls: 3,
                        reasoningSteps: 1,
                        errors: 0,
                        checkpoints: 0,
                        gmTotalCalls: 2,
                        gmTotalTokens: 15_000,
                        gmTotalAllTokens: 15_000,
                        estimatedCost: 0.12,
                        surface: 'app',
                        gmModelStats: {
                            'Model | [evil](https://x.test) <script>': {
                                calls: 2,
                                credits: 1,
                                inputTokens: 10_000,
                                outputTokens: 5_000,
                                thinkingTokens: 0,
                                estimatedCost: 0.12,
                            },
                        },
                    }],
                },
            },
        } as never);
        await ds.flush();

        const rt = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: { now: () => Date.parse('2026-11-27T12:00:00.000Z') },
        });

        // Empty selectedDates -> strictly empty Markdown content and rowCount 0!
        const emptyMd = await rt.handleAction({
            command: 'calendarExportMarkdown',
            selectedDates: [],
        });
        expect(emptyMd.ok).toBe(true);
        expect((emptyMd as { content?: string }).content).toBe('');
        expect((emptyMd.result as { rowCount: number }).rowCount).toBe(0);

        // Unmatched date range -> strictly empty Markdown content!
        const unmatchedMd = await rt.handleAction({
            command: 'calendarExportMarkdown',
            startDate: '2025-01-01',
            endDate: '2025-01-02',
        });
        expect((unmatchedMd as { content?: string }).content).toBe('');
        expect((unmatchedMd.result as { rowCount: number }).rowCount).toBe(0);

        // Matching date -> valid Markdown table with escaped untrusted model cells!
        const validMd = await rt.handleAction({
            command: 'calendarExportMarkdown',
            startDate: '2026-11-27',
            endDate: '2026-11-27',
        });
        expect(validMd.ok).toBe(true);
        const mdText = String((validMd as { content?: string }).content || '');
        expect(mdText).toContain('2026-11-27');
        expect(mdText).toContain('\\|');
        expect(mdText).toContain('\\[evil\\]');
        expect(mdText).toContain('&lt;script&gt;');

        // Direct markdown escaper test
        const escapedDirect = buildCalendarExportMarkdown([{
            date: '2026-11-27',
            sources: ['app'],
            calls: 1,
            inputTokens: 10,
            outputTokens: 5,
            thinkingTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 15,
            estimatedCostUsd: 0.01,
            models: {
                'bad|name [link](x) <tag>': {
                    calls: 1,
                    inputTokens: 10,
                    outputTokens: 5,
                    thinkingTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    totalTokens: 15,
                    estimatedCostUsd: 0.01,
                },
            },
        }], {
            sourceFilter: 'all',
            periodMode: 'daily',
            rangeStart: '2026-11-27',
            rangeEnd: '2026-11-27',
            currency: 'USD',
        });
        expect(escapedDirect).toContain('bad\\|name \\[link\\](x) &lt;tag&gt;');
        await rt.dispose();
    });

    it('10. IDE end-to-end host wiring: panelFocused context key, previewHandoffV2, settings backup/import, redacted diagnostics, recovery brief, calendarExportMarkdown', async () => {
        const dir = makeTmpDir();
        tmpDirs.push(dir);
        const statePath = path.join(dir, 'state-v1.json');
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = statePath;

        const memGlobal = new Map<string, unknown>();
        const memWorkspace = new Map<string, unknown>();
        const fakeCtx = {
            subscriptions: [] as Array<{ dispose: () => void }>,
            globalState: {
                get: <T>(k: string, d?: T) => (memGlobal.has(k) ? memGlobal.get(k) : d) as T,
                update: async (k: string, v: unknown) => { memGlobal.set(k, v); },
            },
            workspaceState: {
                get: <T>(k: string, d?: T) => (memWorkspace.has(k) ? memWorkspace.get(k) : d) as T,
                update: async (k: string, v: unknown) => { memWorkspace.set(k, v); },
            },
            extension: { packageJSON: { version: '1.17.11' } },
        } as unknown as Parameters<typeof activateIde>[0];

        activateIde(fakeCtx);

        // Verify IDE exported host helpers directly
        const ideExport = exportIdeSettingsBackup(Date.parse('2026-11-27T12:00:00.000Z'));
        expect(ideExport.schemaVersion).toBe(1);
        expect(JSON.parse(ideExport.content).schemaVersion).toBe(1);

        const ideImp = await importIdeSettingsBackup(JSON.stringify({
            schemaVersion: 1,
            settings: {
                quotaWindowMode: 'tightest',
                quotaDirectionMode: 'used',
                cdpOverlayFontSize: 'large',
                cdpOverlayHighContrast: true,
                csrfToken: 'FORBIDDEN_TOKEN',
            },
        }));
        expect(ideImp.ok).toBe(true);
        expect(ideImp.strippedKeys).toContain('csrfToken');

        const ideDiag = exportIdeRedactedDiagnostics(Date.parse('2026-11-27T12:00:00.000Z'));
        expect(ideDiag.diagnostics.surface).toBe('ide');
        expect(ideDiag.diagnostics.buildIds.webviewClient).toBeTruthy();
        expect(ideDiag.content).not.toContain('/Users/secretuser');

        const dismissRes = await dismissIdeRecoveryBrief('cascade-main-1111:m:single:main:12');
        expect(dismissRes.ok).toBe(true);

        // Open IDE monitor panel and verify panelFocused context key + all v1.18 webview message handlers
        const dailyStore = new DailyStore(400);
        showMonitorPanel({
            context: fakeCtx,
            publishedObservation: buildPublishedMonitorObservation({
                backendEpoch: 1, windowId: 'ide-1', subjectCascadeId: 'cascade-main-1111',
                usedTokens: 43000, compactionLimit: 100000, selectionRevision: 3, dataRevision: 19,
            }),
            windowSelectionState: {
                backendEpoch: 1, windowId: 'ide-1', selectionRevision: 3,
                observedHostFocus: null, lockedRootId: 'root-fixture', inspectedMemberId: 'cascade-main-1111',
            },
            currentUsage: makeFixtureUsage(),
            allTrajectoryUsages: [makeFixtureUsage()],
            allTrajectories: makeFixtureTrajectories(),
            modelConfigs: makeFixtureModels(),
            userInfo: makeFixtureUser(),
            workspaceUri: 'file:///Users/secretuser/private-repo',
            gmSummary: makeFixtureGmSummary(),
            dailyStore,
        });

        expect(vscodeState.executedCommands.some(c =>
            c.cmd === 'setContext' && c.args[0] === 'antigravityContextMonitor.panelFocused' && c.args[1] === true,
        )).toBe(true);

        const onMsg = vscodeState.getOnMessage();
        expect(onMsg).toBeTruthy();

        await onMsg!({ command: 'panelReady' });
        const tabs = vscodeState.postedMessages.find(m => m.command === 'updateTabs')?.tabs as { overview: string };
        expect(tabs.overview).toContain('data-observation-data-rev="19"');
        expect(tabs.overview).toContain('data-inspect-banner="true"');
        // previewHandoffV2 subject mismatch rejected cleanly
        await onMsg!({ command: 'previewHandoffV2', cascadeId: 'wrong-cascade-id' });
        expect(vscodeState.postedMessages.some(m => m.command === 'handoffV2PreviewResult' && m.ok === false && m.staleSubject === true)).toBe(true);

        // previewHandoffV2 matching subject -> allowlisted, privacy-masked, zero global tool leak, aligned markdown/text keys!
        await onMsg!({ command: 'previewHandoffV2', cascadeId: 'cascade-main-1111' });
        const previewMsg = vscodeState.postedMessages.find(m => m.command === 'handoffV2PreviewResult' && m.ok === true);
        expect(previewMsg).toBeTruthy();
        expect(previewMsg!.markdown).toBe(previewMsg!.previewText);
        expect(previewMsg!.text).toBe(previewMsg!.previewText);
        expect(String(previewMsg!.previewText)).not.toContain('SENTINEL_UNRELATED_GLOBAL_TOOL');
        expect(String(previewMsg!.previewText)).not.toContain('private-repo');

        // exportSettingsBackup + exportRedactedDiagnostics via native save dialog -> writes file & omits `content` (no duplicate browser download)
        const backupOutPath = path.join(dir, 'exported-backup.json');
        const diagOutPath = path.join(dir, 'exported-diag.json');
        const winAny = vscode.window as unknown as Record<string, unknown>;
        winAny.showSaveDialog = vi.fn(async (opts: { defaultUri?: { fsPath?: string } }) =>
            String(opts?.defaultUri?.fsPath || '').includes('diagnostics')
                ? vscode.Uri.file(diagOutPath)
                : vscode.Uri.file(backupOutPath),
        );
        await onMsg!({ command: 'exportSettingsBackup' });
        const backupSavedMsg = vscodeState.postedMessages.find(m => m.command === 'settingsBackupExportResult' && m.ok === true);
        expect(backupSavedMsg).toBeTruthy();
        expect(backupSavedMsg!.saved).toBe(true);
        expect(backupSavedMsg!.content).toBeUndefined();
        expect(fs.existsSync(backupOutPath)).toBe(true);

        await onMsg!({ command: 'exportRedactedDiagnostics' });
        const diagSavedMsg = vscodeState.postedMessages.find(m => m.command === 'redactedDiagnosticsResult' && m.ok === true);
        expect(diagSavedMsg).toBeTruthy();
        expect(diagSavedMsg!.saved).toBe(true);
        expect(diagSavedMsg!.content).toBeUndefined();
        expect(fs.existsSync(diagOutPath)).toBe(true);

        // Fallback when showSaveDialog is unavailable -> preserves `content` in posted message
        winAny.showSaveDialog = undefined;
        vscodeState.postedMessages.length = 0;
        await onMsg!({ command: 'exportSettingsBackup' });
        const backupFallbackMsg = vscodeState.postedMessages.find(m => m.command === 'settingsBackupExportResult' && m.ok === true);
        expect(backupFallbackMsg).toBeTruthy();
        expect(typeof backupFallbackMsg!.content).toBe('string');

        await onMsg!({ command: 'exportRedactedDiagnostics' });
        const diagFallbackMsg = vscodeState.postedMessages.find(m => m.command === 'redactedDiagnosticsResult' && m.ok === true);
        expect(diagFallbackMsg).toBeTruthy();
        expect(typeof diagFallbackMsg!.content).toBe('string');

        await onMsg!({ command: 'calendarExportMarkdown', selectedDates: [] });
        expect(vscodeState.postedMessages.some(m =>
            m.command === 'calendarExportResult' && m.format === 'markdown' && m.content === '' && m.rowCount === 0,
        )).toBe(true);

        // Panel dispose clears panelFocused context key
        vscodeState.getOnDispose()?.();
        expect(vscodeState.executedCommands.some(c =>
            c.cmd === 'setContext' && c.args[0] === 'antigravityContextMonitor.panelFocused' && c.args[1] === false,
        )).toBe(true);
    });
});

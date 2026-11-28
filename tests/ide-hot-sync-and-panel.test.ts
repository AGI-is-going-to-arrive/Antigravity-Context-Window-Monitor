// Consolidated Domain Suite: App <-> IDE Bidirectional Hot Sync, IDE Panel Parity & Shared AppSettings Wiring
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as vscode from 'vscode';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    buildOpenExternalUrlCommand,
    buildRevealInOsCommand,
    createSidecarRuntimeProvider,
    type SidecarRuntimeDeps,
    type SidecarRuntimeProvider,
    validateExternalUrl,
} from '../src/app/sidecar-runtime';
import { computeSnapshotHash, createSidecarHandler, type StandaloneServerHandle, startStandaloneServer } from '../src/app/sidecar-server';
import { type CdpAmbientOverlayManager, type CdpClientLike, createCdpAmbientOverlayManager } from '../src/app/cdp-injector';
import type { CdpOverlayPayload, CdpOverlayToggles, CdpStatus, PluginReleaseInfo } from '../src/app/sidecar-types';
import { CascadeStatus } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import { DEFAULT_APP_SETTINGS, DurableState, normalizeAppSettings, SUPPORTED_DISPLAY_CURRENCIES } from '../src/durable-state';
import { getLanguage, setLanguageToState } from '../src/i18n-core';
import {
    applyModelCatalogSync,
    clearLiveModelSyncProvenance,
    type FullUserStatus,
    type ModelConfig,
    resolveModelContextLimits,
} from '../src/models';
import * as trackerModule from '../src/tracker';
import type { ContextUsage, TrajectorySummary } from '../src/tracker';
import { type CliUsageScanner, CURRENCY_CODES, escapeCsvCell, escapeMarkdownCell } from '../src/cli-usage-scanner';
import {
    activate,
    buildIdePublishedObservation,
    clearInspectedSwarmMember,
    deactivate,
    getBillingDaysMap,
    getLockToMainAgent,
    getSharedAppSettings,
    getWindowSelectionState,
    inspectSwarmMember,
    resolveIdeBrainRootScope,
    retargetLockedRootConversation,
    setLockToMainAgent,
    syncFromDurableStateIfChanged,
    updateSharedAppSetting,
} from '../src/extension';
import { ideCdpLauncherActions, showMonitorPanel, syncMonitorPanelSettings } from '../src/webview-panel';
import { DailyStore } from '../src/daily-store';
import { PricingStore } from '../src/pricing-store';
import { extractOverviewTelemetry } from '../src/monitor-overview';
import { toLocalDateKey } from '../src/daily-archival';
import { type GMSummary, GMTracker } from '../src/gm-tracker';
import { ActivityTracker } from '../src/activity-tracker';
import * as backendConnection from '../src/backend-connection';
import * as cdpLauncherModule from '../src/app/cdp-launcher';
import { getScript } from '../src/webview-script';
import { StatusBarManager } from '../src/statusbar';
import { buildPricingTabContent } from '../src/pricing-panel';
import { buildCalendarExportData, buildCalendarTabContent } from '../src/webview-calendar-tab';
import { projectForIdeStatusBar, projectForOverview, verifySurfaceProjectionParity } from '../src/core/context-display';
import { resolveScopedBrainRoot } from '../src/core/swarm-registry';
import { getLatestGMContextUsedForCascade } from '../src/core/gm-context-fallback';
import { createFastDurableState } from './helpers/factories';

describe('[ide-bidirectional-hot-sync]', () => {
    interface HttpResponse {
        status: number;
        headers: http.IncomingHttpHeaders;
        text: string;
        json(): any;
    }


    function httpRequest(
        baseUrl: string,
        method: string,
        reqPath: string,
        options: { headers?: Record<string, string>; body?: string } = {},
    ): Promise<HttpResponse> {
        return new Promise((resolve, reject) => {
            const url = new URL(reqPath, baseUrl);
            const body = options.body;
            const headers: Record<string, string> = { ...(options.headers || {}) };
            if (body !== undefined && !headers['Content-Length']) {
                headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
            }
            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method,
                headers,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        text,
                        json: () => JSON.parse(text),
                    });
                });
            });
            req.on('error', reject);
            if (body !== undefined) {
                req.write(body);
            }
            req.end();
        });
    }


    async function pairStandaloneSession(handle: StandaloneServerHandle): Promise<{
        sessionToken: string;
        authHeaders: Record<string, string>;
    }> {
        const pairRes = await httpRequest(handle.url, 'POST', '/api/auth/pair', {
            headers: { 'Content-Type': 'application/json', Origin: handle.url },
            body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
        });
        expect(pairRes.status).toBe(200);
        const sessionToken = pairRes.json().sessionToken as string;
        return { sessionToken, authHeaders: { 'X-Monitor-Session': sessionToken, Origin: handle.url } };
    }


    function makeTmpDir(): string {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'acm-v1176-sync-'));
    }


    function makeMockLS(): LSInfo {
        return {
            pid: 9191,
            port: 62919,
            csrfToken: 'mock-token',
            useTls: false,
            hostname: '127.0.0.1',
            surface: 'app',
            source: 'hub-file',
        };
    }


    function makeMockConfigs(): ModelConfig[] {
        return [
            {
                model: 'MODEL_PLACEHOLDER_M535',
                label: 'Gemini 4 Neon (Extra High)',
                supportsImages: true,
                quotaInfo: {
                    remainingFraction: 0.55,
                    resetTime: new Date(Date.now() + 2 * 3_600_000).toISOString(),
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 2,
                isRecommended: true,
                supportedMimeTypes: ['image/png'],
            },
            {
                model: 'MODEL_PLACEHOLDER_M401',
                label: 'Claude Opus 5.5 (Medium)',
                supportsImages: true,
                quotaInfo: {
                    remainingFraction: 0.30,
                    resetTime: new Date(Date.now() + 3 * 3_600_000).toISOString(),
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 2,
                isRecommended: false,
                supportedMimeTypes: ['image/png'],
            },
        ];
    }


    function makeMockUserStatus(): FullUserStatus {
        return {
            configs: makeMockConfigs(),
            userInfo: {
                name: 'Alice Dev',
                email: 'alice@example.com',
                planName: 'Google AI Pro',
                userTierId: 'tier-pro',
                userTierName: 'Pro',
                tierDescription: 'Pro',
                upgradeText: '',
                upgradeUri: '',
                promptCredits: 0,
                flowCredits: 0,
                availableCredits: [{ creditType: 'GOOGLE_ONE_AI', creditAmount: 1200, minimumCreditAmountForUsage: 1 }],
                browserEnabled: true,
                knowledgeBaseEnabled: true,
                canBuyMoreCredits: true,
                monthlyPromptCredits: 0,
                monthlyFlowCredits: 0,
            },
        };
    }


    function makeTrajectory(): TrajectorySummary {
        return {
            cascadeId: 'conv-v1176-001',
            trajectoryId: 'traj-v1176-001',
            summary: 'Verify v1.17.6 Dual-Surface Runtime Bridge',
            stepCount: 8,
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T20:00:00.000Z',
            createdTime: '2026-11-22T19:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M535',
            generatorModel: 'MODEL_PLACEHOLDER_M535',
            workspaceUris: ['file:///tmp/workspace-v1176'],
            lastUserInputTime: '2026-11-22T19:59:00.000Z',
            lastUserInputStepIndex: 7,
            repositoryName: 'antigravity',
            gitOriginUrl: '',
            branchName: 'main',
            gitRootUri: 'file:///tmp/workspace-v1176',
        };
    }


    function makeUsage(traj: TrajectorySummary): ContextUsage {
        return {
            tokenUsageSource: 'planner',
            cascadeId: traj.cascadeId,
            title: traj.summary,
            model: traj.requestedModel || 'MODEL_PLACEHOLDER_M535',
            modelDisplayName: 'Gemini 4 Neon (Extra High)',
            contextUsed: 180_000,
            totalOutputTokens: 3_200,
            totalToolCallOutputTokens: 8_000,
            contextLimit: 256_000,
            usagePercent: 70.3,
            stepCount: traj.stepCount,
            lastModifiedTime: traj.lastModifiedTime,
            status: traj.status,
            isEstimated: false,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            imageGenerationModels: [],
            imageGenerationIncomplete: false,
            imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: false,
            createdTime: traj.createdTime,
            lastUserInputTime: traj.lastUserInputTime,
            lastUserInputStepIndex: traj.lastUserInputStepIndex,
            repositoryName: traj.repositoryName,
            gitOriginUrl: traj.gitOriginUrl,
            branchName: traj.branchName,
            gitRootUri: traj.gitRootUri,
        };
    }


    describe('v1.17.6 App <-> IDE bidirectional DurableState hot sync & IDE panel parity', () => {
        const tmpDirs: string[] = [];
        const origStateEnv = process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH;

        afterEach(async () => {
            await deactivate();
            delete (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders;
            if (origStateEnv === undefined) {
                delete process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH;
            } else {
                process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = origStateEnv;
            }
            vi.restoreAllMocks();
            while (tmpDirs.length > 0) {
                fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
            }
        });

        it('hot-reloads external App Sidecar edits in IDE and awaits DurableState.flush() on deactivate()', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const stateFile = path.join(tmp, 'shared-state.json');
            process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;
            vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(null);

            const configStore: Record<string, unknown> = {
                pollingInterval: 5,
                displayCurrency: 'USD',
                orchestratorPricingMode: 'mapped',
                calendarRetentionDays: 400,
                showNativeHudBar: false,
            };
            const updatedKeys: Array<[string, unknown]> = [];
            vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
                get: <T>(key: string, defaultValue?: T) => (key in configStore ? configStore[key] : defaultValue) as T,
                update: async (key: string, value: unknown) => {
                    configStore[key] = value;
                    updatedKeys.push([key, value]);
                },
            }) as unknown as vscode.WorkspaceConfiguration);
            (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });

            const memGlobal = new Map<string, unknown>();
            const memWorkspace = new Map<string, unknown>();
            const fakeContext = {
                subscriptions: [] as Array<{ dispose(): void }>,
                globalState: {
                    get: <T>(k: string, d?: T) => (memGlobal.has(k) ? memGlobal.get(k) : d) as T,
                    update: async (k: string, v: unknown) => { memGlobal.set(k, v); },
                },
                workspaceState: {
                    get: <T>(k: string, d?: T) => (memWorkspace.has(k) ? memWorkspace.get(k) : d) as T,
                    update: async (k: string, v: unknown) => { memWorkspace.set(k, v); },
                },
                extension: { packageJSON: { version: '1.17.5' } },
            } as unknown as vscode.ExtensionContext;

            activate(fakeContext);

            // Simulate App Sidecar writing shared state changes externally to the same stateFile
            const appState = createFastDurableState(stateFile);
            const appGlobal = appState.globalBucket();
            await setLanguageToState('zh', appGlobal);
            await appGlobal.update('lockToMainAgent', true);
            await appGlobal.update('accountBillingDays', { 'alice@example.com': 18 });
            await appState.updateAppSettings({
                orchestratorPricingMode: 'strict',
                displayCurrency: 'JPY',
                calendarRetentionDays: 120,
                lockToMainAgent: true,
            });
            await appState.flush();

            // Trigger IDE hot-reload (called on poll cycles, panel reveal, and settings reads)
            const reloaded = syncFromDurableStateIfChanged(false);
            expect(reloaded).toBe(true);
            expect(getLanguage()).toBe('zh');
            expect(getLockToMainAgent()).toBe(true);
            expect(getBillingDaysMap()['alice@example.com']).toBe(18);
            expect(getSharedAppSettings().orchestratorPricingMode).toBe('strict');
            expect(getSharedAppSettings().displayCurrency).toBe('JPY');
            expect(getSharedAppSettings().calendarRetentionDays).toBe(120);

            // Now IDE edits a shared setting and deactivates -> deactivate() MUST flush cleanly to disk!
            await updateSharedAppSetting('displayCurrency', 'GBP');
            await deactivate();

            // Verify App Sidecar sees IDE's flushed edit immediately on reload
            expect(appState.reloadIfChanged()).toBe(true);
            expect(appState.getAppSettings().displayCurrency).toBe('GBP');

            // Restore default language for downstream tests
            await setLanguageToState('both', appGlobal);
        });

        it('renders hot-reloaded App-written DurableState settings in IDE showMonitorPanel even when VS Code cfg.get still returns schema defaults', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const stateFile = path.join(tmp, 'shared-state-defaults.json');
            process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;
            vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(null);

            // Pre-seed disk state from App Sidecar BEFORE IDE activates (tests initialLoad mirroring too)
            const appState = createFastDurableState(stateFile);
            await appState.updateAppSettings({
                displayCurrency: 'CNY',
                orchestratorPricingMode: 'strict',
                showNativeHudBar: true,
                calendarRetentionDays: 240,
            });
            await appState.flush();

            // Simulate VS Code workspace.getConfiguration ALWAYS returning package.json schema defaults
            // (matching the async race window before cfg.update settles)
            const mirroredCalls: Array<[string, unknown]> = [];
            const schemaDefaults: Record<string, unknown> = {
                pollingInterval: 5,
                quotaNotificationThreshold: 20,
                'statusBar.showContext': true,
                'statusBar.showQuota': true,
                'statusBar.showResetCountdown': true,
                'statusBar.showAiCredits': true,
                'statusBar.showSpeed': false,
                'statusBar.showCacheHit': false,
                'statusBar.showSessionCost': false,
                'statusBar.tooltipDensity': 'auto',
                showModelInternalId: false,
                'activity.maxRecentSteps': 100,
                'activity.maxArchives': 20,
                orchestratorPricingMode: 'mapped',
                displayCurrency: 'USD',
                customFxRate: null,
                subscriptionPlan: 'none',
                subscriptionMonthlyFee: null,
                subscriptionCurrency: 'USD',
                calendarRetentionDays: 400,
                autoCheckUpdates: true,
                showNativeHudBar: false,
            };
            vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
                get: <T>(key: string, defaultValue?: T) => (key in schemaDefaults ? schemaDefaults[key] : defaultValue) as T,
                update: async (key: string, value: unknown) => {
                    mirroredCalls.push([key, value]);
                },
            }) as unknown as vscode.WorkspaceConfiguration);
            (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });

            const memGlobal = new Map<string, unknown>();
            const memWorkspace = new Map<string, unknown>();
            const fakeContext = {
                subscriptions: [] as Array<{ dispose(): void }>,
                globalState: {
                    get: <T>(k: string, d?: T) => (memGlobal.has(k) ? memGlobal.get(k) : d) as T,
                    update: async (k: string, v: unknown) => { memGlobal.set(k, v); },
                },
                workspaceState: {
                    get: <T>(k: string, d?: T) => (memWorkspace.has(k) ? memWorkspace.get(k) : d) as T,
                    update: async (k: string, v: unknown) => { memWorkspace.set(k, v); },
                },
                extension: { packageJSON: { version: '1.17.5' } },
            } as unknown as vscode.ExtensionContext;

            activate(fakeContext);

            // Initial load over pre-existing disk state mirrors into VS Code config
            expect(mirroredCalls).toContainEqual(['displayCurrency', 'CNY']);
            expect(mirroredCalls).toContainEqual(['orchestratorPricingMode', 'strict']);
            expect(mirroredCalls).toContainEqual(['showNativeHudBar', true]);

            let onDispose: (() => void) | undefined;
            const fakePanel = {
                visible: true,
                webview: {
                    html: '',
                    postMessage: () => Promise.resolve(true),
                    onDidReceiveMessage: () => ({ dispose: () => {} }),
                },
                reveal: () => {},
                onDidChangeViewState: () => ({ dispose: () => {} }),
                onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => {} }; },
            };
            vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

            try {
                showMonitorPanel({
                    currentUsage: null,
                    allTrajectoryUsages: [],
                    modelConfigs: [],
                    userInfo: null,
                    cliDays: [],
                    context: fakeContext,
                });
                // Rendered HTML reflects App-written CNY + strict mode + Native HUD despite VS Code cfg.get returning schema defaults!
                expect(fakePanel.webview.html).toContain('<option value="CNY" selected>');
                expect(fakePanel.webview.html).toMatch(/id="stgOrchModeStrict"[^>]*aria-checked="true"/);
                expect(fakePanel.webview.html).toContain('id="nativeHudBar"');

                // Hot-reload another App edit (EUR + mapped) while cfg.get STILL returns USD/mapped
                await appState.updateAppSettings({ displayCurrency: 'EUR', orchestratorPricingMode: 'mapped' });
                await appState.flush();
                expect(syncFromDurableStateIfChanged(false)).toBe(true);
                onDispose?.();
                fakePanel.webview.html = '';
                showMonitorPanel({
                    currentUsage: null,
                    allTrajectoryUsages: [],
                    modelConfigs: [],
                    userInfo: null,
                    cliDays: [],
                    context: fakeContext,
                });
                expect(fakePanel.webview.html).toContain('<option value="EUR" selected>');
                expect(fakePanel.webview.html).toMatch(/id="stgOrchModeMapped"[^>]*aria-checked="true"/);
            } finally {
                onDispose?.();
            }
        });

        it('IDE webview panel handles Calendar controls, CSV/JSON save dialog export, Orchestrator mode, applyPluginUpdate notice & strict external URLs', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const exportCsvPath = path.join(tmp, 'exported-usage.csv');
            const posted: Array<Record<string, unknown>> = [];
            const openedExternal: string[] = [];
            let onMessage: ((msg: Record<string, unknown>) => Promise<void> | void) | undefined;
            let onDispose: (() => void) | undefined;

            const fakePanel = {
                visible: true,
                webview: {
                    html: '',
                    postMessage: (msg: Record<string, unknown>) => { posted.push(msg); return Promise.resolve(true); },
                    onDidReceiveMessage: (cb: (msg: Record<string, unknown>) => Promise<void> | void) => {
                        onMessage = cb;
                        return { dispose: () => {} };
                    },
                },
                reveal: () => {},
                onDidChangeViewState: () => ({ dispose: () => {} }),
                onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => {} }; },
            };
            vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);
            (vscode.window as unknown as Record<string, unknown>).showSaveDialog = vi.fn(async () => vscode.Uri.file(exportCsvPath));
            (vscode.env as unknown as Record<string, unknown>).openExternal = vi.fn(async (uri: { fsPath?: string; toString?: () => string }) => {
                openedExternal.push(uri.fsPath || String(uri));
                return true;
            });

            const dailyStore = new DailyStore();
            const pricingStore = new PricingStore();

            try {
                showMonitorPanel({
                    currentUsage: null,
                    allTrajectoryUsages: [],
                    modelConfigs: [],
                    userInfo: null,
                    dailyStore,
                    pricingStore,
                    cliDays: [{
                        date: '2026-11-22',
                        calls: 3,
                        inputTokens: 5_000,
                        outputTokens: 1_500,
                        thinkingTokens: 0,
                        cacheReadTokens: 1_000,
                        cacheCreationTokens: 0,
                        totalTokens: 7_500,
                        estimatedCost: 0.04,
                        modelBreakdown: {},
                    }],
                });

                expect(onMessage).toBeDefined();

                // Calendar controls emit incremental tab updates
                posted.length = 0;
                await onMessage!({ command: 'calendarFilterSource', source: 'cli' });
                await onMessage!({ command: 'calendarSetMetric', metric: 'cost' });
                await onMessage!({ command: 'calendarSetPeriod', period: 'daily' });
                await onMessage!({ command: 'calendarSetView', view: 'heatmap' });
                await onMessage!({ command: 'calendarSelectDate', date: '2026-11-22' });
                expect(posted.filter(m => m.command === 'updateTabs').length).toBe(5);

                // Calendar CSV export invokes showSaveDialog and writes UTF-8 CSV file
                await onMessage!({ command: 'calendarExportCsv' });
                expect(fs.existsSync(exportCsvPath)).toBe(true);
                const csvText = fs.readFileSync(exportCsvPath, 'utf8');
                expect(csvText).toContain('2026-11-22');

                // applyPluginUpdate returns clean IDE / Open VSX notice (never killing host)
                posted.length = 0;
                await onMessage!({ command: 'applyPluginUpdate' });
                const updNotice = posted.find(m => m.command === 'pluginUpdateResult');
                expect(updNotice).toBeDefined();
                expect(updNotice!.type).toBe('pluginUpdateResult');
                expect(updNotice!.requiresReload).toBe(false);
                expect(String(updNotice!.message)).toContain('Open VSX');

                // recheckCdp in IDE webview replies with structured cdpStatusResult + syncSettingsControls
                const prevPortFileEnv = process.env.AGY_BROWSER_ACTIVE_PORT_FILE;
                let fakeCdpServer: http.Server | undefined;
                try {
                    posted.length = 0;
                    await onMessage!({ command: 'recheckCdp' });
                    const disabledCdpMsg = posted.find(m => m.command === 'cdpStatusResult');
                    expect(disabledCdpMsg).toBeDefined();
                    expect((disabledCdpMsg!.cdpStatus as CdpStatus)?.state).toBe('disabled');
                    expect((disabledCdpMsg!.cdpStatus as CdpStatus)?.diagnosticCode).toBe('disabled');
                    const disabledSyncMsg = posted.find(m => m.command === 'syncSettingsControls');
                    expect((disabledSyncMsg?.cdpStatus as CdpStatus)?.state).toBe('disabled');

                    // Enable overlay toggle and point AGY_BROWSER_ACTIVE_PORT_FILE to a fake loopback CDP /json/version + /json/list server
                    let cdpPort = 0;
                    fakeCdpServer = http.createServer((req, res) => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        if (req.url === '/json/version') {
                            res.end(JSON.stringify({
                                Browser: 'Antigravity/2.34.0',
                                webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/browser/ide-test`,
                            }));
                            return;
                        }
                        res.end(JSON.stringify([{
                            id: 'hub-ide-test',
                            type: 'page',
                            title: 'Jetski Web',
                            url: 'https://127.0.0.1:49991/',
                            webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/page/hub-ide-test`,
                        }]));
                    });
                    await new Promise<void>(resolve => fakeCdpServer!.listen(0, '127.0.0.1', resolve));
                    cdpPort = (fakeCdpServer.address() as { port: number }).port;
                    const portFile = path.join(tmp, 'DevToolsActivePort');
                    fs.writeFileSync(portFile, `${cdpPort}\n/devtools/browser/ide-test\n`, 'utf8');
                    process.env.AGY_BROWSER_ACTIVE_PORT_FILE = portFile;

                    posted.length = 0;
                    await onMessage!({ command: 'setAppSetting', key: 'appComposerRingEnabled', value: true });
                    // Toggling an overlay ON immediately probes CDP without requiring a manual recheckCdp click
                    const liveToggleCdpMsg = posted.find(m => m.command === 'cdpStatusResult');
                    expect(liveToggleCdpMsg).toBeDefined();
                    expect((liveToggleCdpMsg!.cdpStatus as CdpStatus)?.state).toBe('connected');
                    expect((liveToggleCdpMsg!.cdpStatus as CdpStatus)?.diagnosticCode).toBe('connected');
                    expect((liveToggleCdpMsg!.cdpStatus as CdpStatus)?.discoveredPort).toBe(cdpPort);
                    const liveToggleSyncMsg = posted.find(m => m.command === 'syncSettingsControls');
                    expect((liveToggleSyncMsg?.cdpStatus as CdpStatus)?.state).toBe('connected');

                    posted.length = 0;
                    await onMessage!({ command: 'recheckCdp' });
                    const connCdpMsg = posted.find(m => m.command === 'cdpStatusResult');
                    expect(connCdpMsg).toBeDefined();
                    expect((connCdpMsg!.cdpStatus as CdpStatus)?.state).toBe('connected');
                    expect((connCdpMsg!.cdpStatus as CdpStatus)?.diagnosticCode).toBe('connected');
                    expect((connCdpMsg!.cdpStatus as CdpStatus)?.discoveredPort).toBe(cdpPort);
                    expect((connCdpMsg!.cdpStatus as CdpStatus)?.targetTitle).toBe('Jetski Web');

                    // Close fake CDP server -> port_unreachable diagnostic
                    await new Promise<void>(resolve => fakeCdpServer!.close(() => resolve()));
                    fakeCdpServer = undefined;
                    posted.length = 0;
                    await onMessage!({ command: 'recheckCdp' });
                    const staleCdpMsg = posted.find(m => m.command === 'cdpStatusResult');
                    expect(staleCdpMsg).toBeDefined();
                    expect((staleCdpMsg!.cdpStatus as CdpStatus)?.state).toBe('cdp_unavailable');
                    expect((staleCdpMsg!.cdpStatus as CdpStatus)?.diagnosticCode).toBe('port_unreachable');

                    // Reset toggle cleanly -> returns to disabled
                    posted.length = 0;
                    await onMessage!({ command: 'setAppSetting', key: 'appComposerRingEnabled', value: false });
                    const offSyncMsg = posted.find(m => m.command === 'syncSettingsControls');
                    expect((offSyncMsg?.cdpStatus as CdpStatus)?.state).toBe('disabled');

                    // Isolate HOME / USERPROFILE / APPDATA / XDG_CONFIG_HOME so missing_port_file & launcher tests are 100% hermetic
                    // even when a real live `Antigravity (CDP).app` has a DevToolsActivePort file under the host user's real HOME.
                    const prevHomeEnv = process.env.HOME;
                    const prevUserProfileEnv = process.env.USERPROFILE;
                    const prevAppDataEnv = process.env.APPDATA;
                    const prevXdgConfigEnv = process.env.XDG_CONFIG_HOME;
                    const fakeHome = path.join(tmp, 'ide-launcher-home');
                    fs.mkdirSync(fakeHome, { recursive: true });
                    try {
                        process.env.HOME = fakeHome;
                        process.env.USERPROFILE = fakeHome;
                        process.env.APPDATA = path.join(fakeHome, 'AppData', 'Roaming');
                        process.env.XDG_CONFIG_HOME = path.join(fakeHome, '.config');

                        // Toggle TopBar ON with missing port file -> probes immediately & NEVER stays stuck on stale 'disabled'
                        process.env.AGY_BROWSER_ACTIVE_PORT_FILE = path.join(tmp, 'nonexistent-DevToolsActivePort');
                        posted.length = 0;
                        await onMessage!({ command: 'setAppSetting', key: 'appTopBarEnabled', value: true });
                        const toggleOnMissingCdp = posted.find(m => m.command === 'cdpStatusResult');
                        expect((toggleOnMissingCdp?.cdpStatus as CdpStatus)?.state).toBe('cdp_unavailable');
                        expect((toggleOnMissingCdp?.cdpStatus as CdpStatus)?.diagnosticCode).toBe('missing_port_file');
                        const toggleOnMissingSync = posted.find(m => m.command === 'syncSettingsControls');
                        expect((toggleOnMissingSync?.cdpStatus as CdpStatus)?.state).toBe('cdp_unavailable');

                        // External toggle-ON after cached 'disabled' never emits stale { state: 'disabled' }
                        await onMessage!({ command: 'setAppSetting', key: 'appTopBarEnabled', value: false });
                        await updateSharedAppSetting('appComposerRingEnabled', true);
                        posted.length = 0;
                        syncMonitorPanelSettings(false);
                        const extSyncMsg = posted.find(m => m.command === 'syncSettingsControls');
                        expect((extSyncMsg?.cdpStatus as CdpStatus | undefined)?.state).not.toBe('disabled');

                        // Cleanly disable again before exiting
                        await onMessage!({ command: 'setAppSetting', key: 'appComposerRingEnabled', value: false });

                        // Hermetic IDE setupCdpLauncher, revealCdpLauncher & removeCdpLauncher using temporary HOME (never touches real ~/Applications)
                        posted.length = 0;
                        await onMessage!({ command: 'setupCdpLauncher' });
                        const ideSetupMsg = posted.find(m => m.command === 'cdpLauncherResult');
                        expect(ideSetupMsg).toBeDefined();
                        expect(ideSetupMsg!.ok).toBe(true);
                        expect((ideSetupMsg!.launcherStatus as { installed?: boolean; launcherPath?: string })?.installed).toBe(true);
                        expect(JSON.stringify(ideSetupMsg)).not.toContain(fakeHome);
                        expect(posted.some(m => m.command === 'cdpStatusResult')).toBe(true);
                        expect(posted.some(m => m.command === 'syncSettingsControls')).toBe(true);

                        // Hermetic IDE revealCdpLauncher (spied on lightweight ideCdpLauncherActions so Finder/Explorer is never spawned)
                        const revealSpy = vi.spyOn(ideCdpLauncherActions, 'reveal').mockResolvedValue({
                            ok: true,
                            status: ideCdpLauncherActions.inspect({ env: process.env }),
                            messageEn: 'Revealed persistent launcher in Finder.',
                            messageZh: '已在访达中定位持久化启动器。',
                        });
                        try {
                            posted.length = 0;
                            await onMessage!({ command: 'revealCdpLauncher' });
                            expect(revealSpy).toHaveBeenCalledTimes(1);
                            const ideRevealMsg = posted.find(m => m.command === 'cdpLauncherResult');
                            expect(ideRevealMsg).toBeDefined();
                            expect(ideRevealMsg!.type).toBe('cdpLauncherResult');
                            expect(ideRevealMsg!.action).toBe('revealCdpLauncher');
                            expect(ideRevealMsg!.ok).toBe(true);
                            expect((ideRevealMsg!.launcherStatus as { installed?: boolean })?.installed).toBe(true);
                            expect(posted.some(m => m.command === 'syncSettingsControls')).toBe(true);
                        } finally {
                            revealSpy.mockRestore();
                        }

                        posted.length = 0;
                        await onMessage!({ command: 'removeCdpLauncher' });
                        const ideRemoveMsg = posted.find(m => m.command === 'cdpLauncherResult');
                        expect(ideRemoveMsg).toBeDefined();
                        expect(ideRemoveMsg!.ok).toBe(true);
                        expect((ideRemoveMsg!.launcherStatus as { installed?: boolean })?.installed).toBe(false);
                    } finally {
                        if (prevHomeEnv === undefined) { delete process.env.HOME; } else { process.env.HOME = prevHomeEnv; }
                        if (prevUserProfileEnv === undefined) { delete process.env.USERPROFILE; } else { process.env.USERPROFILE = prevUserProfileEnv; }
                        if (prevAppDataEnv === undefined) { delete process.env.APPDATA; } else { process.env.APPDATA = prevAppDataEnv; }
                        if (prevXdgConfigEnv === undefined) { delete process.env.XDG_CONFIG_HOME; } else { process.env.XDG_CONFIG_HOME = prevXdgConfigEnv; }
                    }
                } finally {
                    if (fakeCdpServer) {
                        await new Promise<void>(resolve => fakeCdpServer!.close(() => resolve()));
                    }
                    if (prevPortFileEnv === undefined) {
                        delete process.env.AGY_BROWSER_ACTIVE_PORT_FILE;
                    } else {
                        process.env.AGY_BROWSER_ACTIVE_PORT_FILE = prevPortFileEnv;
                    }
                }

                // openExternalUrl allows strict https:// allowlisted host and rejects bad schemes
                await onMessage!({ command: 'openExternalUrl', url: 'https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor' });
                await onMessage!({ command: 'openExternalUrl', url: 'file:///etc/passwd' });
                await onMessage!({ command: 'openExternalUrl', url: 'https://evil.example.com/' });
                expect(openedExternal.length).toBe(1);
                expect(openedExternal[0]).toContain('open-vsx.org');
            } finally {
                onDispose?.();
                delete (vscode.window as unknown as Record<string, unknown>).showSaveDialog;
                delete (vscode.env as unknown as Record<string, unknown>).openExternal;
            }
        });

        it('triggers non-blocking initial probeIdeCdpStatus() when IDE panel opens with CDP overlay already enabled', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const stateFile = path.join(tmp, 'ide-initial-cdp-probe-state.json');
            process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

            // Pre-seed shared state with Composer Ring enabled BEFORE opening the IDE panel
            await updateSharedAppSetting('appComposerRingEnabled', true);

            const prevPortFileEnv = process.env.AGY_BROWSER_ACTIVE_PORT_FILE;
            let cdpPort = 0;
            const fakeCdpServer = http.createServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (req.url === '/json/version') {
                    res.end(JSON.stringify({
                        Browser: 'Antigravity/2.34.0',
                        webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/browser/initial-probe`,
                    }));
                    return;
                }
                res.end(JSON.stringify([{
                    id: 'hub-initial-probe',
                    type: 'page',
                    title: 'Antigravity Hub',
                    url: 'https://127.0.0.1:49992/',
                    webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/page/hub-initial-probe`,
                }]));
            });
            await new Promise<void>(resolve => fakeCdpServer.listen(0, '127.0.0.1', resolve));
            cdpPort = (fakeCdpServer.address() as { port: number }).port;
            const portFile = path.join(tmp, 'DevToolsActivePort');
            fs.writeFileSync(portFile, `${cdpPort}\n/devtools/browser/initial-probe\n`, 'utf8');
            process.env.AGY_BROWSER_ACTIVE_PORT_FILE = portFile;

            const posted: Array<Record<string, unknown>> = [];
            let onDispose: (() => void) | undefined;
            const fakePanel = {
                visible: true,
                webview: {
                    html: '',
                    postMessage: (msg: Record<string, unknown>) => { posted.push(msg); return Promise.resolve(true); },
                    onDidReceiveMessage: () => ({ dispose: () => {} }),
                },
                reveal: () => {},
                onDidChangeViewState: () => ({ dispose: () => {} }),
                onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => {} }; },
            };
            vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

            try {
                showMonitorPanel({
                    currentUsage: null,
                    allTrajectoryUsages: [],
                    modelConfigs: [],
                    userInfo: null,
                    dailyStore: new DailyStore(),
                    pricingStore: new PricingStore(),
                });

                // Initial HTML immediately renders neutral 'probing' (NEVER fabricated cdp_unavailable / missing_port_file)
                expect(fakePanel.webview.html).toContain('data-cdp-state="probing"');
                expect(fakePanel.webview.html).not.toContain('data-cdp-state="cdp_unavailable"');

                // Non-blocking initial probe resolves automatically and posts connected status without clicking Recheck CDP
                await vi.waitFor(() => {
                    const cdpMsg = posted.find(m => m.command === 'cdpStatusResult');
                    expect(cdpMsg).toBeDefined();
                    expect((cdpMsg!.cdpStatus as CdpStatus)?.state).toBe('connected');
                    expect((cdpMsg!.cdpStatus as CdpStatus)?.diagnosticCode).toBe('connected');
                    expect((cdpMsg!.cdpStatus as CdpStatus)?.discoveredPort).toBe(cdpPort);
                    expect((cdpMsg!.cdpStatus as CdpStatus)?.targetTitle).toBe('Antigravity Hub');
                }, { timeout: 5_000 });

                const syncMsg = posted.find(m => m.command === 'syncSettingsControls' && (m.cdpStatus as CdpStatus | undefined)?.state === 'connected');
                expect(syncMsg).toBeDefined();
                expect((syncMsg!.cdpStatus as CdpStatus).discoveredPort).toBe(cdpPort);
            } finally {
                onDispose?.();
                await updateSharedAppSetting('appComposerRingEnabled', false).catch(() => {});
                await new Promise<void>(resolve => fakeCdpServer.close(() => resolve()));
                if (prevPortFileEnv === undefined) {
                    delete process.env.AGY_BROWSER_ACTIVE_PORT_FILE;
                } else {
                    process.env.AGY_BROWSER_ACTIVE_PORT_FILE = prevPortFileEnv;
                }
            }
        });

        it('clears GMTracker error backoff before gmTracker.fetchAll on IDE manual refresh and supports Pro / Ultra 5x / Ultra 20x in IDE', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const stateFile = path.join(tmp, 'ide-manual-refresh-state.json');
            process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

            const callOrder: string[] = [];
            const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
            vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((command: string, callback: (...args: unknown[]) => unknown) => {
                registeredCommands.set(command, callback);
                return { dispose: () => {} };
            });
            (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });

            const traj = makeTrajectory('cascade-ide-refresh');
            let discoverCount = 0;
            vi.spyOn(backendConnection, 'discoverPreferredBackend').mockImplementation(async () => {
                discoverCount++;
                // Return null on initial activate() auto-poll so manual refresh runs deterministically without overlapping isPolling
                return discoverCount === 1 ? null : makeMockLS();
            });
            vi.spyOn(trackerModule, 'fetchFullUserStatus').mockResolvedValue(makeMockUserStatus());
            vi.spyOn(trackerModule, 'fetchOrchestratorSettings').mockResolvedValue(null);
            vi.spyOn(trackerModule, 'fetchUserQuotaSummary').mockResolvedValue(null);
            vi.spyOn(trackerModule, 'getAllTrajectories').mockResolvedValue([traj]);
            vi.spyOn(trackerModule, 'getContextUsage').mockResolvedValue(makeUsage(traj));
            vi.spyOn(trackerModule, 'refreshWorkflowImageUsage').mockImplementation(async (_ls, u) => u);
            vi.spyOn(ActivityTracker.prototype, 'processTrajectories').mockResolvedValue(false);

            const clearSpy = vi.spyOn(GMTracker.prototype, 'clearErrorBackoff').mockImplementation(() => {
                callOrder.push('clearErrorBackoff');
            });
            const fetchSpy = vi.spyOn(GMTracker.prototype, 'fetchAll').mockImplementation(async () => {
                callOrder.push('fetchAll');
                return {
                    conversations: [],
                    modelBreakdown: {},
                    totalCalls: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    totalThinkingTokens: 0,
                    totalCacheReadTokens: 0,
                    totalCacheCreationTokens: 0,
                    totalCredits: 0,
                    totalEstimatedCost: 0,
                    latestTimestamp: '',
                    totalRetryCount: 0,
                    totalErrorCount: 0,
                    contextGrowthRate: 0,
                    toolsCatalog: [],
                } as unknown as GMSummary;
            });

            const memGlobal = new Map<string, unknown>();
            const memWorkspace = new Map<string, unknown>();
            const fakeContext = {
                subscriptions: [] as Array<{ dispose(): void }>,
                globalState: {
                    get: <T>(k: string, d?: T) => (memGlobal.has(k) ? memGlobal.get(k) : d) as T,
                    update: async (k: string, v: unknown) => { memGlobal.set(k, v); },
                },
                workspaceState: {
                    get: <T>(k: string, d?: T) => (memWorkspace.has(k) ? memWorkspace.get(k) : d) as T,
                    update: async (k: string, v: unknown) => { memWorkspace.set(k, v); },
                },
                extension: { packageJSON: { version: '1.17.8' } },
            } as unknown as vscode.ExtensionContext;

            activate(fakeContext);
            // Wait for initial auto-poll (which returns null LS cleanly) to settle
            await new Promise(resolve => setTimeout(resolve, 40));
            expect(clearSpy).not.toHaveBeenCalled();

            // Trigger IDE manual refresh command -> pollContextUsage(true)
            const refreshCmd = registeredCommands.get('antigravity-context-monitor.refresh');
            expect(refreshCmd).toBeDefined();
            refreshCmd!();
            for (let i = 0; i < 40 && fetchSpy.mock.calls.length === 0; i++) {
                await new Promise(resolve => setTimeout(resolve, 15));
            }

            expect(clearSpy).toHaveBeenCalledTimes(1);
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(callOrder.indexOf('clearErrorBackoff')).toBeGreaterThanOrEqual(0);
            expect(callOrder.indexOf('clearErrorBackoff')).toBeLessThan(callOrder.indexOf('fetchAll'));

            // IDE updateSharedAppSetting supports Pro ($19.99), Ultra 5x ($99.99), Ultra 20x ($199.99), and legacy 'google-ai-ultra'
            expect((await updateSharedAppSetting('subscriptionPlan', 'google-ai-ultra-5x')).ok).toBe(true);
            expect(getSharedAppSettings().subscriptionPlan).toBe('google-ai-ultra-5x');
            expect(getSharedAppSettings().subscriptionMonthlyFee).toBe(99.99);

            expect((await updateSharedAppSetting('subscriptionPlan', 'google-ai-ultra-20x')).ok).toBe(true);
            expect(getSharedAppSettings().subscriptionPlan).toBe('google-ai-ultra-20x');
            expect(getSharedAppSettings().subscriptionMonthlyFee).toBe(199.99);

            expect((await updateSharedAppSetting('subscriptionPlan', 'google-ai-ultra')).ok).toBe(true);
            expect(getSharedAppSettings().subscriptionPlan).toBe('google-ai-ultra-20x');
            expect(getSharedAppSettings().subscriptionMonthlyFee).toBe(199.99);
        });
    });
});

describe('[p2b-ide-shared-wiring]', () => {
    const tmpDirs: string[] = [];


    function makeTmpDir(prefix = 'acm-p2b-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tmpDirs.push(dir);
        return dir;
    }


    afterEach(() => {
        clearLiveModelSyncProvenance();
        while (tmpDirs.length > 0) {
            const dir = tmpDirs.pop()!;
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });


    describe('Phase 2 Wave 2B: AppSettings v1.18 Consolidation & Field-Level Patching', () => {
        it('supports all 10 currencies (incl. CAD), preserves explicit languagePreference="both", and binds customFxCurrency', () => {
            expect(SUPPORTED_DISPLAY_CURRENCIES).toContain('CAD');
            expect(SUPPORTED_DISPLAY_CURRENCIES).toHaveLength(10);
            expect(CURRENCY_CODES).toEqual(SUPPORTED_DISPLAY_CURRENCIES);

            expect(DEFAULT_APP_SETTINGS.languagePreference).toBe('auto');
            expect(DEFAULT_APP_SETTINGS.customFxCurrency).toBeNull();
            expect(DEFAULT_APP_SETTINGS.subscriptionPlan).toBe('none');
            expect(DEFAULT_APP_SETTINGS.contextPctBasis).toBe('compaction');
            expect(DEFAULT_APP_SETTINGS.speedMetricMode).toBe('decode');
            expect(DEFAULT_APP_SETTINGS.quotaWindowMode).toBe('5h');
            expect(DEFAULT_APP_SETTINGS.quotaDirectionMode).toBe('remaining');
            expect(DEFAULT_APP_SETTINGS.appShowNativeHudBar).toBe(true);
            expect(DEFAULT_APP_SETTINGS.ideShowNativeHudBar).toBe(false);
            expect(DEFAULT_APP_SETTINGS.nativeHudAutoHideOnOverview).toBe(true);
            expect(DEFAULT_APP_SETTINGS.legacyLockMigrated).toBe(false);

            // Explicitly persisted legacy 'both' must survive normalization
            const bothNorm = normalizeAppSettings({ languagePreference: 'both' });
            expect(bothNorm.languagePreference).toBe('both');

            // CAD with custom FX binds cleanly; mismatched customFxCurrency clears customFxRate
            const cadBound = normalizeAppSettings({
                displayCurrency: 'CAD',
                customFxRate: 1.42,
                customFxCurrency: 'CAD',
            });
            expect(cadBound.displayCurrency).toBe('CAD');
            expect(cadBound.customFxRate).toBe(1.42);
            expect(cadBound.customFxCurrency).toBe('CAD');

            const mismatchedFx = normalizeAppSettings({
                displayCurrency: 'JPY',
                customFxRate: 1.42,
                customFxCurrency: 'CAD',
            });
            expect(mismatchedFx.displayCurrency).toBe('JPY');
            expect(mismatchedFx.customFxRate).toBeNull();
            expect(mismatchedFx.customFxCurrency).toBeNull();
        });

        it('atomically merges concurrent App currency patch + IDE basis patch via patchAppSettingsWithReceipt without clobbering', async () => {
            const dir = makeTmpDir('acm-p2b-patch-');
            const statePath = path.join(dir, 'state.json');

            // Both hosts open the same shared DurableState file (cold start — no prior appSettings)
            const appHost = createFastDurableState(statePath);
            const ideHost = createFastDurableState(statePath);

            // App edits displayCurrency + customFxRate (CAD) and commits to disk
            const appRes = await appHost.patchAppSettingsWithReceipt({
                displayCurrency: 'CAD',
                customFxRate: 1.41,
                customFxCurrency: 'CAD',
                appShowNativeHudBar: false,
            });
            expect(appRes.receipt.committed).toBe(true);

            // IDE (without reloading first!) edits contextPctBasis + speedMetricMode + ideShowNativeHudBar
            const ideRes = await ideHost.patchAppSettingsWithReceipt({
                contextPctBasis: 'native',
                speedMetricMode: 'e2e',
                ideShowNativeHudBar: true,
            });
            expect(ideRes.receipt.committed).toBe(true);

            // Fresh reader verifies BOTH host edits survived atomically!
            const verifier = createFastDurableState(statePath);
            const merged = verifier.getAppSettings();
            expect(merged.displayCurrency).toBe('CAD');
            expect(merged.customFxRate).toBe(1.41);
            expect(merged.customFxCurrency).toBe('CAD');
            expect(merged.appShowNativeHudBar).toBe(false);
            expect(merged.contextPctBasis).toBe('native');
            expect(merged.speedMetricMode).toBe('e2e');
            expect(merged.ideShowNativeHudBar).toBe(true);
        });

        it('migrates legacy top-level lockToMainAgent ONCE and never re-applies stale top-level key afterward', async () => {
            const dir = makeTmpDir('acm-p2b-lock-mig-');
            const statePath = path.join(dir, 'state.json');
            fs.writeFileSync(statePath, JSON.stringify({
                version: 1,
                global: {
                    lockToMainAgent: true,
                    appSettings: { displayCurrency: 'USD' },
                },
                workspaces: {},
            }, null, 2), 'utf8');

            const state = createFastDurableState(statePath);
            const firstCheck = state.resolveMigratedLegacyLock();
            expect(firstCheck.lockToMainAgent).toBe(true);
            expect(firstCheck.needsMigrationPersist).toBe(true);

            const migRes = await state.migrateLegacyLockOnce();
            expect(migRes.migrated).toBe(true);
            expect(migRes.settings.lockToMainAgent).toBe(true);
            expect(state.getAppSettings().legacyLockMigrated).toBe(true);

            // User turns lock OFF in appSettings; even if legacy top-level key remains `true`, it MUST NOT override!
            await state.patchAppSettingsWithReceipt({ lockToMainAgent: false, legacyLockMigrated: true });
            const freshReader = createFastDurableState(statePath);
            expect(freshReader.resolveMigratedLegacyLock()).toEqual({
                lockToMainAgent: false,
                needsMigrationPersist: false,
            });
        });
    });


    describe('Phase 2 Wave 2B: 10-Currency StatusBar, Pricing, Calendar & CLI Export Hardening', () => {
        it('renders all 10 currencies incl. CAD (CA$/A$/$/JP¥/₩/NT$) in StatusBarManager session cost and hover', () => {
            const sb = new StatusBarManager();
            sb.setDisplayPrefs({
                showContext: true,
                showQuota: false,
                showResetCountdown: false,
                showAiCredits: false,
                showSpeed: false,
                showCacheHit: false,
                showSessionCost: true,
            });
            const usage: ContextUsage = {
                cascadeId: 'c-cad-1',
                title: 'CAD Session',
                model: 'MODEL_PLACEHOLDER_M532',
                modelDisplayName: 'Gemini 4 Neon (High)',
                contextUsed: 128_000,
                contextLimit: 512_000,
                usagePercent: 25,
                isEstimated: false,
                stepCount: 4,
                status: 'CASCADE_RUN_STATUS_IDLE',
                lastModifiedTime: '2026-11-27T08:00:00Z',
                totalOutputTokens: 1000,
                totalToolCallOutputTokens: 0,
                lastModelUsage: {
                    model: 'MODEL_PLACEHOLDER_M532',
                    inputTokens: 128_000,
                    outputTokens: 1000,
                    responseOutputTokens: 1000,
                    cacheReadTokens: 0,
                },
                estimatedDeltaSinceCheckpoint: 0,
                compressionDetected: false,
                checkpointCompressionDrop: 0,
                imageGenStepCount: 0,
            };

            sb.setCostSnapshot({
                todayCostUsd: 10,
                todayHasUnpriced: false,
                sessionCostUsd: 10,
                sessionHasUnpriced: false,
            });

            const readSbText = (): string => (sb as unknown as { statusBarItem: { text: string } }).statusBarItem.text;

            sb.setCurrencyConfig({ code: 'CAD' });
            sb.update(usage);
            expect(readSbText()).toContain('CA$13.80');

            sb.setCurrencyConfig({ code: 'AUD' });
            sb.update(usage);
            expect(readSbText()).toContain('A$15.40');

            sb.setCurrencyConfig({ code: 'JPY' });
            sb.update(usage);
            expect(readSbText()).toContain('JP¥1,540');

            // Custom FX rate bound to CAD applies to CAD, ignored when currency switches to EUR
            sb.setCurrencyConfig({ code: 'CAD', customRatePerUsd: 2.0, customFxCurrency: 'CAD' });
            sb.update(usage);
            expect(readSbText()).toContain('CA$20.00');

            sb.setCurrencyConfig({ code: 'EUR', customRatePerUsd: 2.0, customFxCurrency: 'CAD' });
            sb.update(usage);
            expect(readSbText()).toContain('€9.20');

            sb.dispose();
        });

        it('renders CAD in buildPricingTabContent and removes redundant Calendar Usage Summary card (D5)', () => {
            const pricingStore = new PricingStore();
            const summary: GMSummary = {
                conversations: [{
                    cascadeId: 'conv-cad',
                    title: 'CAD Test',
                    totalSteps: 2,
                    coveredSteps: 2,
                    coverageRate: 1,
                    calls: [{
                        executionId: 'e1',
                        model: 'MODEL_PLACEHOLDER_M532',
                        modelDisplay: 'Gemini 4 Neon (High)',
                        responseModel: 'gemini-4-neon-high',
                        modelAccuracy: 'exact',
                        inputTokens: 1_000_000,
                        outputTokens: 0,
                        thinkingTokens: 0,
                        responseTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        ttftSeconds: 0.5,
                        streamingSeconds: 1.0,
                        credits: 0,
                        creditType: '',
                        hasError: false,
                        errorMessage: '',
                        contextTokensUsed: 100000,
                        completionConfig: null,
                        systemPromptSnippet: '',
                        toolCount: 0,
                        toolNames: [],
                        promptSectionTitles: [],
                        promptSnippet: '',
                        promptSource: 'none',
                        messagePromptCount: 0,
                        messageMetadataKeys: [],
                        responseHeaderKeys: [],
                        userMessageAnchors: [],
                        aiSnippetsByStep: {},
                        retries: 0,
                        stopReason: '',
                        retryTokensIn: 0,
                        retryTokensOut: 0,
                        retryCredits: 0,
                        retryErrors: [],
                        timeSinceLastInvocation: 0,
                        tokenBreakdownGroups: [],
                        createdAt: '2026-11-27T08:00:00Z',
                        latestStableMessageIndex: 1,
                        stepIndices: [0, 1],
                        startStepIndex: 0,
                    }],
                }],
                modelBreakdown: {
                    'Gemini 4 Neon (High)': {
                        callCount: 1,
                        stepsCovered: 2,
                        totalInputTokens: 1_000_000,
                        totalOutputTokens: 0,
                        totalThinkingTokens: 0,
                        totalResponseTokens: 0,
                        totalCacheRead: 0,
                        totalCacheCreation: 0,
                        totalCredits: 0,
                        avgTTFT: 0.5,
                        minTTFT: 0.5,
                        maxTTFT: 0.5,
                        avgStreaming: 1.0,
                        cacheHitRate: 0,
                        responseModel: 'gemini-4-neon-high',
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        completionConfig: null,
                        hasSystemPrompt: false,
                        toolCount: 0,
                        promptSectionTitles: [],
                        totalRetries: 0,
                        errorCount: 0,
                        creditCallCount: 0,
                        exactCallCount: 1,
                        placeholderOnlyCalls: 0,
                        contextWindowCapacity: 1_048_576,
                    },
                },
                totalCalls: 1,
                totalStepsCovered: 2,
                totalCredits: 0,
                totalInputTokens: 1_000_000,
                totalOutputTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalThinkingTokens: 0,
                totalRetryCount: 0,
                totalRetryTokens: 0,
                totalRetryCredits: 0,
                stopReasonCounts: {},
                retryErrorCodes: {},
                toolCallCounts: {},
                recentErrors: [],
                contextGrowth: [],
            };

            const pricingHtml = buildPricingTabContent(summary, pricingStore, undefined, undefined, undefined, false, {
                currency: 'CAD',
            });
            expect(pricingHtml).toContain('CA$4.14');

            // Calendar tab removes redundant Usage Summary card (cal-summary-card) and renders CAD
            const dailyStore = new DailyStore();
            dailyStore.mergeRecords({
                version: 1,
                records: {
                    '2026-11-27': {
                        date: '2026-11-27',
                        cycles: [{
                            startTime: '2026-11-27T08:00:00Z',
                            endTime: '2026-11-27T09:00:00Z',
                            totalToolCalls: 0,
                            totalSteps: 4,
                            gmTotalCalls: 2,
                            gmTotalCredits: 0,
                            gmTotalInputTokens: 1_000_000,
                            gmTotalOutputTokens: 0,
                            gmTotalCacheRead: 0,
                            gmTotalCacheCreation: 0,
                            gmTotalThinkingTokens: 0,
                            estimatedCost: 10,
                            surfaces: ['ide'],
                        }],
                    },
                },
            });
            const calHtml = buildCalendarTabContent(dailyStore, 2026, 11, {
                selectedDate: '2026-11-27',
                currency: 'CAD',
                now: new Date(2026, 10, 27, 12, 0, 0),
            });
            expect(calHtml).not.toContain('cal-summary-card');
            expect(calHtml).toContain('CA$13.80');
        });

        it('exports EMPTY on empty selection/date range (NEVER falling back to all history) and neutralizes CSV/MD injection', () => {
            const dailyStore = new DailyStore();
            dailyStore.mergeRecords({
                version: 1,
                records: {
                    '2024-01-10': {
                        date: '2024-01-10',
                        cycles: [{
                            startTime: '2024-01-10T08:00:00Z',
                            endTime: '2024-01-10T09:00:00Z',
                            totalToolCalls: 0,
                            totalSteps: 2,
                            gmTotalCalls: 1,
                            gmTotalCredits: 0,
                            gmTotalInputTokens: 5000,
                            gmTotalOutputTokens: 500,
                            gmTotalCacheRead: 0,
                            gmTotalCacheCreation: 0,
                            gmTotalThinkingTokens: 0,
                            estimatedCost: 1.5,
                            surfaces: ['ide'],
                        }],
                    },
                },
            });
            const now = new Date(2026, 10, 27, 12, 0, 0);

            // 1. Out-of-window daily (52w) export MUST return empty, NEVER falling back to 2024-01-10!
            const dailyOutOfWindow = buildCalendarExportData(dailyStore, 2026, 11, {
                periodMode: 'daily',
                currency: 'CAD',
                now,
            });
            expect(dailyOutOfWindow.rows).toHaveLength(0);
            expect(dailyOutOfWindow.csv.trim().split('\n')).toHaveLength(1); // header only

            // 2. Empty explicit selectedDate export MUST return empty!
            const emptySel = buildCalendarExportData(dailyStore, 2026, 11, {
                exportSelectedDateOnly: true,
                selectedDate: '2026-11-20',
                now,
            });
            expect(emptySel.rows).toHaveLength(0);

            // 3. Explicit date range with zero matching days MUST return empty!
            const emptyRange = buildCalendarExportData(dailyStore, 2026, 11, {
                rangeStart: '2026-11-01',
                rangeEnd: '2026-11-15',
                now,
            });
            expect(emptyRange.rows).toHaveLength(0);

            // 4. All-time export includes 2024-01-10 with structured CurrencyExportRecord
            const allTime = buildCalendarExportData(dailyStore, 2026, 11, {
                periodMode: 'all',
                currency: 'CAD',
                now,
            });
            expect(allTime.rows).toHaveLength(1);
            const parsed = JSON.parse(allTime.json);
            expect(parsed.summary.cost.currency).toBe('CAD');
            expect(parsed.summary.cost.formatted).toBe('CA$2.07');
            expect(allTime.markdown).toContain('2024-01-10');

            // 5. CSV formula neutralization AFTER leading whitespace normalization + multiline quoting
            expect(escapeCsvCell('  =SUM(A1:A5)')).toBe("'  =SUM(A1:A5)");
            expect(escapeCsvCell('\t+1+1')).toBe("'\t+1+1");
            expect(escapeCsvCell(' -cmd|foo')).toBe("' -cmd|foo");
            expect(escapeCsvCell('line1\n=CMD()')).toBe('"line1\n=CMD()"');
            expect(escapeMarkdownCell('a|b\nc[1](http://x)')).toBe('a\\|b c\\[1\\](http://x)');
        });
    });


    describe('Phase 2 Wave 2B: Decoupling, Dead-Code Removal & ActivityTracker Config Injection', () => {
        it('severs extension<->webview-panel cycle, removes cdp-launcher/overlay-assets from webview-panel, removes vscode from ActivityTracker, and deletes portFromAddressToken', () => {
            const root = path.resolve(__dirname, '..');
            const webviewPanelSrc = fs.readFileSync(path.join(root, 'src', 'webview-panel.ts'), 'utf8');
            const idePanelTypesSrc = fs.readFileSync(path.join(root, 'src', 'ide-panel-types.ts'), 'utf8');
            const activityTrackerSrc = fs.readFileSync(path.join(root, 'src', 'activity', 'tracker.ts'), 'utf8');
            const activityBarrelSrc = fs.readFileSync(path.join(root, 'src', 'activity-tracker.ts'), 'utf8');
            const discoverySrc = fs.readFileSync(path.join(root, 'src', 'discovery.ts'), 'utf8');

            // Circular import broken
            expect(webviewPanelSrc).not.toMatch(/from\s+['"]\.\/extension['"]/);
            expect(idePanelTypesSrc).not.toMatch(/from\s+['"]\.\/extension['"]/);
            expect(idePanelTypesSrc).not.toMatch(/from\s+['"]\.\/webview-panel['"]/);

            // Lightweight CDP discovery only (zero bloated cdp-launcher / cdp-injector / cdp-overlay-assets / sidecar-runtime)
            expect(webviewPanelSrc).toMatch(/from\s+['"]\.\/app\/cdp-discovery['"]/);
            expect(webviewPanelSrc).not.toMatch(/cdp-launcher['"]/);
            expect(webviewPanelSrc).not.toMatch(/cdp-injector/);
            expect(webviewPanelSrc).not.toMatch(/cdp-overlay-assets/);
            expect(webviewPanelSrc).not.toMatch(/sidecar-runtime/);

            // ActivityTracker completely decoupled from vscode runtime imports/requires
            expect(activityTrackerSrc).not.toMatch(/require\s*\(\s*['"]vscode['"]\s*\)|from\s+['"]vscode['"]/);
            expect(activityBarrelSrc).not.toMatch(/require\s*\(\s*['"]vscode['"]\s*\)|from\s+['"]vscode['"]/);

            // Dead code removed
            expect(discoverySrc).not.toContain('portFromAddressToken');

            // ActivityTracker accepts constructor config & runtime updateConfig without vscode
            const tracker = new ActivityTracker({ maxRecentSteps: 25, maxArchives: 5 });
            expect(tracker.getConfig()).toEqual({ maxRecentSteps: 25, maxArchives: 5 });
            tracker.updateConfig({ maxRecentSteps: 40, maxArchives: 8 });
            expect(tracker.getConfig()).toEqual({ maxRecentSteps: 40, maxArchives: 8 });
            const restored = ActivityTracker.restore(tracker.serialize(), { maxRecentSteps: 15, maxArchives: 3 });
            expect(restored.getConfig()).toEqual({ maxRecentSteps: 15, maxArchives: 3 });
        });
    });


    describe('Phase 2 Wave 2B: IDE D9 Observation Parity, 3-Field Lock, Remote-SSH Scoping & Model Catalog Sync', () => {
        it('publishes ONE frozen PublishedMonitorObservation with 100% StatusBar <-> Overview projection parity across compaction/native/overflow/fresh/incomplete', () => {
            const sb = new StatusBarManager();
            const readSbText = (): string => (sb as unknown as { statusBarItem: { text: string } }).statusBarItem.text;
            sb.setDisplayPrefs({
                showContext: true,
                showQuota: false,
                showResetCountdown: false,
                showAiCredits: false,
                showSpeed: false,
                showCacheHit: false,
                showSessionCost: false,
            });

            // 1. Overflow scenario (573,440 / 512,000 = 112%)
            const overflowUsage: ContextUsage = {
                cascadeId: 'c-overflow',
                title: 'Overflow Chat',
                model: 'MODEL_PLACEHOLDER_M532',
                modelDisplayName: 'Gemini 4 Neon (High)',
                contextUsed: 573_440,
                contextLimit: 512_000,
                usagePercent: 112,
                isEstimated: false,
                stepCount: 12,
                status: 'CASCADE_RUN_STATUS_IDLE',
                lastModifiedTime: '2026-11-27T08:10:00Z',
                totalOutputTokens: 2000,
                totalToolCallOutputTokens: 0,
                lastModelUsage: {
                    model: 'MODEL_PLACEHOLDER_M532',
                    inputTokens: 573_440,
                    outputTokens: 2000,
                    responseOutputTokens: 2000,
                    cacheReadTokens: 0,
                },
                estimatedDeltaSinceCheckpoint: 0,
                compressionDetected: false,
                checkpointCompressionDrop: 0,
                imageGenStepCount: 0,
            };
            const obsOverflow = buildIdePublishedObservation(overflowUsage, { summary: null });
            expect(obsOverflow).not.toBeNull();
            expect(Object.isFrozen(obsOverflow)).toBe(true);
            expect(obsOverflow!.primaryPct).toBe(112);
            expect(obsOverflow!.geometryFillPct).toBe(100);
            expect(obsOverflow!.healthStatus).toBe('overflow');

            sb.update(overflowUsage, obsOverflow);
            const sbProj = sb.getObservationProjection()!;
            const ovProj = projectForOverview(obsOverflow!);
            expect(verifySurfaceProjectionParity([sbProj, ovProj]).ok).toBe(true);
            expect(sbProj.primaryPctText).toBe('112%');
            expect(sbProj.geometryFillPct).toBe(100);
            expect(readSbText()).toContain('573.4k/512k');
            const tooltipVal = ((sb as unknown as { statusBarItem: { tooltip?: { value?: string } } }).statusBarItem.tooltip?.value) ?? '';
            expect(tooltipVal).toContain('112%');

            // 2. Confirmed 0-step fresh conversation -> 0%, null speed/cost, never unhealthy
            const freshUsage: ContextUsage = {
                ...overflowUsage,
                cascadeId: 'c-fresh',
                contextUsed: 0,
                usagePercent: 0,
                stepCount: 0,
                isEstimated: true,
                lastModelUsage: null,
            };
            const obsFresh = buildIdePublishedObservation(freshUsage, { summary: null });
            expect(obsFresh!.isZeroStepFresh).toBe(true);
            expect(obsFresh!.primaryPct).toBe(0);
            expect(obsFresh!.displaySpeedTps).toBeNull();
            expect(obsFresh!.sessionCostUsd).toBeNull();
            expect(obsFresh!.healthStatus).toBe('fresh');
            expect(verifySurfaceProjectionParity([projectForIdeStatusBar(obsFresh!), projectForOverview(obsFresh!)]).ok).toBe(true);

            // 3. Incomplete (hasGaps) -> '—', never 0%
            const incompleteUsage: ContextUsage = {
                ...overflowUsage,
                cascadeId: 'c-gap',
                contextUsed: 0,
                usagePercent: 0,
                stepCount: 5,
                hasGaps: true,
                lastModelUsage: null,
            };
            const obsGap = buildIdePublishedObservation(incompleteUsage, { summary: null });
            expect(obsGap!.isIncomplete).toBe(true);
            expect(obsGap!.primaryPct).toBeNull();
            sb.update(incompleteUsage, obsGap);
            expect(readSbText()).toContain('—');
            expect(verifySurfaceProjectionParity([sb.getObservationProjection()!, projectForOverview(obsGap!)]).ok).toBe(true);

            sb.dispose();
        });

        it('preserves 3-field WindowSelectionState lock parity (inspectSwarmMember never overwrites lockedRootId)', () => {
            retargetLockedRootConversation('root-main-1');
            expect(getLockToMainAgent()).toBe(true);
            expect(getWindowSelectionState().lockedRootId).toBe('root-main-1');
            expect(getWindowSelectionState().inspectedMemberId).toBeNull();

            inspectSwarmMember('worker-alpha-1');
            expect(getWindowSelectionState().lockedRootId).toBe('root-main-1');
            expect(getWindowSelectionState().inspectedMemberId).toBe('worker-alpha-1');

            clearInspectedSwarmMember();
            expect(getWindowSelectionState().lockedRootId).toBe('root-main-1');
            expect(getWindowSelectionState().inspectedMemberId).toBeNull();

            setLockToMainAgent(false);
            expect(getLockToMainAgent()).toBe(false);
            expect(getWindowSelectionState().lockedRootId).toBeNull();
        });

        it('disables local brain/ scan when Remote-SSH or WSL host is active and enforces compaction boundary on GM fallback', () => {
            const sshScope = resolveIdeBrainRootScope(['vscode-remote://ssh-remote+prod/srv/repo'], { remoteName: '' });
            expect(sshScope.isRemoteHost).toBe(true);
            expect(resolveScopedBrainRoot(sshScope)).toBeNull();

            const remoteNameScope = resolveIdeBrainRootScope([], { remoteName: 'wsl' });
            expect(remoteNameScope.isRemoteHost).toBe(true);
            expect(resolveScopedBrainRoot(remoteNameScope)).toBeNull();

            const localScope = resolveIdeBrainRootScope(['file:///Users/dev/project'], { remoteName: '' });
            expect(localScope.isRemoteHost).toBe(false);
            expect(resolveScopedBrainRoot(localScope)).not.toBeNull();

            // Compaction boundary rejects stale pre-compaction high-water GM sample
            const gmSummary = {
                conversations: [{
                    cascadeId: 'c-compact',
                    calls: [
                        { contextTokensUsed: 480_000, createdAt: '2026-11-27T08:00:00Z', stepIndices: [10] },
                        { contextTokensUsed: 65_000, createdAt: '2026-11-27T08:05:00Z', stepIndices: [12] },
                    ],
                }],
            };
            expect(getLatestGMContextUsedForCascade(gmSummary, 'c-compact', {
                compactionBoundary: { stepIndex: 11, timestampMs: '2026-11-27T08:04:00Z' },
            })).toBe(65_000);
            // No post-compaction sample -> fails closed to 0 (never resurrects 480,000!)
            expect(getLatestGMContextUsedForCascade(gmSummary, 'c-compact', {
                compactionBoundary: { stepIndex: 15, timestampMs: '2026-11-27T08:10:00Z' },
            })).toBe(0);
        });

        it('wires shared model-catalog-sync in src/models.ts with live_checkpointer & native-only provenance', () => {
            const syncRes = applyModelCatalogSync({
                response: {
                    models: {
                        'gemini-5-nova-xhigh': {
                            model: 'MODEL_PLACEHOLDER_M9901',
                            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                            maxTokens: 2_000_000,
                            maxOutputTokens: 128_000,
                            supportsThinking: true,
                            modelExperiments: {
                                experiments: {
                                    CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                                        stringValue: JSON.stringify({ max_token_limit: 768_000, token_threshold: 100_000 }),
                                    },
                                },
                            },
                        },
                    },
                },
            });
            expect(syncRes.hasEffectiveUpdates).toBe(true);
            expect(syncRes.entries[0].specPatch.displayName).toBe('Gemini 5 Nova (XHigh)');

            const limits = resolveModelContextLimits('MODEL_PLACEHOLDER_M9901');
            expect(limits.compactionLimit).toBe(768_000);
            expect(limits.compactionLimitProvenance).toBe('live_checkpointer');
            expect(limits.nativeLimit).toBe(2_000_000);
            expect(limits.nativeLimitProvenance).toBe('live_catalog');
            expect(limits.isNativeOnly).toBe(false);

            // Native-only image model never fabricates a compaction limit
            const imageLimits = resolveModelContextLimits('MODEL_PLACEHOLDER_M21');
            expect(imageLimits.compactionLimit).toBeNull();
            expect(imageLimits.compactionLimitProvenance).toBe('none');
            expect(imageLimits.nativeLimit).toBe(65_536);
            expect(imageLimits.isNativeOnly).toBe(true);
        });
    });
});

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    buildOpenExternalUrlCommand,
    buildRevealInOsCommand,
    createSidecarRuntimeProvider,
    validateExternalUrl,
    type SidecarRuntimeDeps,
    type SidecarRuntimeProvider,
} from '../src/app/sidecar-runtime';
import {
    startStandaloneServer,
    type StandaloneServerHandle,
} from '../src/app/sidecar-server';
import type { CdpAmbientOverlayManager } from '../src/app/cdp-injector';
import type { CdpOverlayPayload, CdpOverlayToggles, CdpStatus, PluginReleaseInfo } from '../src/app/sidecar-types';
import { CascadeStatus } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import { DurableState } from '../src/durable-state';
import { getLanguage, setLanguageToState } from '../src/i18n-core';
import type { FullUserStatus, ModelConfig } from '../src/models';
import type { ContextUsage, TrajectorySummary } from '../src/tracker';
import type { CliUsageScanner } from '../src/cli-usage-scanner';
import {
    activate,
    deactivate,
    getBillingDaysMap,
    getLockToMainAgent,
    getSharedAppSettings,
    syncFromDurableStateIfChanged,
    updateSharedAppSetting,
} from '../src/extension';
import { showMonitorPanel } from '../src/webview-panel';
import { DailyStore } from '../src/daily-store';
import { PricingStore } from '../src/pricing-store';
import * as backendConnection from '../src/backend-connection';

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

describe('v1.17.6 Sidecar runtime: overlay bridge auth, CDP toggle lifecycle, updates, calendar export & security', () => {
    const tmpDirs: string[] = [];
    const providers: SidecarRuntimeProvider[] = [];
    const servers: StandaloneServerHandle[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        while (servers.length > 0) {
            await servers.pop()!.close();
        }
        while (providers.length > 0) {
            await providers.pop()!.dispose();
        }
        while (tmpDirs.length > 0) {
            fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
        }
    });

    it('enforces 256-bit X-Monitor-Token and strict loopback Origin on POST/OPTIONS /api/overlay/action', async () => {
        const tmp = makeTmpDir();
        tmpDirs.push(tmp);
        const traj = makeTrajectory();
        let pollCalls = 0;

        const provider = await createSidecarRuntimeProvider({
            version: '1.17.5',
            statePath: path.join(tmp, 'state.json'),
            autoStart: false,
            disableCliScan: true,
            deps: {
                discoverLS: async () => makeMockLS(),
                fetchFullUserStatus: async () => makeMockUserStatus(),
                fetchAvailableModels: async () => null,
                fetchOrchestratorSettings: async () => null,
                fetchUserQuotaSummary: async () => null,
                getAllTrajectories: async () => {
                    pollCalls++;
                    return [traj];
                },
                getContextUsage: async () => makeUsage(traj),
                refreshWorkflowImageUsage: async (_ls, u) => u,
                fetchTrajectoryGeneratorMetadata: async () => [],
                fetchTrajectorySteps: async () => ({ steps: [], totalSteps: 0 }),
                processActivity: async () => false,
                fetchGM: async () => null,
            },
        });
        providers.push(provider);

        const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0, version: '1.17.5' });
        servers.push(handle);
        const token = handle.overlayBridgeToken;
        expect(token).toMatch(/^[a-f0-9]{64}$/);

        // 1. Missing Origin -> 403
        const noOrigin = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
            headers: { 'Content-Type': 'application/json', 'X-Monitor-Token': token },
            body: JSON.stringify({ command: 'ping' }),
        });
        expect(noOrigin.status).toBe(403);

        // 2. Non-loopback Origin -> 403
        const evilOrigin = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://evil.example.com',
                'X-Monitor-Token': token,
            },
            body: JSON.stringify({ command: 'ping' }),
        });
        expect(evilOrigin.status).toBe(403);

        // 3. Invalid X-Monitor-Token -> 401
        const badToken = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
            headers: {
                'Content-Type': 'application/json',
                Origin: 'http://127.0.0.1:43210',
                'X-Monitor-Token': '0'.repeat(64),
            },
            body: JSON.stringify({ command: 'ping' }),
        });
        expect(badToken.status).toBe(401);

        // 4. Valid CORS preflight OPTIONS -> 204
        const preflight = await httpRequest(handle.url, 'OPTIONS', '/api/overlay/action', {
            headers: { Origin: 'http://127.0.0.1:43210' },
        });
        expect(preflight.status).toBe(204);
        expect(preflight.headers['access-control-allow-origin']).toBe('http://127.0.0.1:43210');

        // 5. Valid authenticated commands: ping, refresh, openSidecar, togglePanel
        for (const cmd of ['ping', 'refresh', 'openSidecar', 'togglePanel']) {
            const res = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:43210',
                    'X-Monitor-Token': token,
                },
                body: JSON.stringify({ command: cmd, source: 'topbar' }),
            });
            expect(res.status).toBe(200);
            expect(res.json().ok).toBe(true);
        }
        expect(pollCalls).toBe(1);

        // 6. Unsupported overlay command -> 400
        const badCmd = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
            headers: {
                'Content-Type': 'application/json',
                Origin: 'http://127.0.0.1:43210',
                'X-Monitor-Token': token,
            },
            body: JSON.stringify({ command: 'deleteEverything' }),
        });
        expect(badCmd.status).toBe(400);
    });

    it('syncs opt-in CDP overlay toggles, pushes live CdpOverlayPayload, and disposes cleanly', async () => {
        const tmp = makeTmpDir();
        tmpDirs.push(tmp);
        const traj = makeTrajectory();

        const toggleHistory: CdpOverlayToggles[] = [];
        const pushedPayloads: CdpOverlayPayload[] = [];
        let overlayDisposed = false;
        let currentToggles: CdpOverlayToggles = { appComposerRingEnabled: false, appTopBarEnabled: false };

        const mockOverlayManager: CdpAmbientOverlayManager = {
            getStatus: (): CdpStatus => ({
                state: (currentToggles.appComposerRingEnabled || currentToggles.appTopBarEnabled) ? 'connected' : 'disabled',
                composerEnabled: currentToggles.appComposerRingEnabled,
                topBarEnabled: currentToggles.appTopBarEnabled,
                targetUrl: (currentToggles.appComposerRingEnabled || currentToggles.appTopBarEnabled) ? 'http://127.0.0.1:41234/' : undefined,
                platformGuide: { platform: 'darwin', command: 'open -a Antigravity --args --remote-debugging-port=0', en: 'en', zh: 'zh' },
            }),
            setToggles: async (next) => {
                currentToggles = { ...next };
                toggleHistory.push({ ...next });
                return mockOverlayManager.getStatus();
            },
            updatePayload: async (payload) => {
                pushedPayloads.push(payload);
                return mockOverlayManager.getStatus();
            },
            dispose: async () => {
                overlayDisposed = true;
                currentToggles = { appComposerRingEnabled: false, appTopBarEnabled: false };
            },
        };

        const mockCliScanner = {
            scan: () => ({
                available: true,
                days: [{
                    date: '2026-11-21',
                    calls: 4,
                    inputTokens: 10_000,
                    outputTokens: 2_000,
                    thinkingTokens: 500,
                    cacheReadTokens: 3_000,
                    cacheCreationTokens: 0,
                    totalTokens: 15_000,
                    estimatedCost: 0.08,
                    modelBreakdown: {},
                }],
            }),
        } as unknown as CliUsageScanner;

        const provider = await createSidecarRuntimeProvider({
            version: '1.17.5',
            statePath: path.join(tmp, 'state.json'),
            autoStart: false,
            deps: {
                createCdpOverlayManager: () => mockOverlayManager,
                cliUsageScanner: mockCliScanner,
                discoverLS: async () => makeMockLS(),
                fetchFullUserStatus: async () => makeMockUserStatus(),
                fetchAvailableModels: async () => null,
                fetchOrchestratorSettings: async () => null,
                fetchUserQuotaSummary: async () => null,
                getAllTrajectories: async () => [traj],
                getContextUsage: async () => makeUsage(traj),
                refreshWorkflowImageUsage: async (_ls, u) => u,
                fetchTrajectoryGeneratorMetadata: async () => [],
                fetchTrajectorySteps: async () => ({ steps: [], totalSteps: 0 }),
                processActivity: async () => false,
                fetchGM: async () => null,
            },
        });
        providers.push(provider);

        // Strictly opt-in by default
        expect(provider.getAppSettings().appComposerRingEnabled).toBe(false);
        expect(provider.getAppSettings().appTopBarEnabled).toBe(false);
        expect(provider.getCdpStatus().state).toBe('disabled');
        expect(toggleHistory.length).toBe(0);

        await provider.pollNow(true);

        // Toggle Composer Ring ON -> mounts immediately and pushes live payload
        const enableRes = await provider.handleAction({
            command: 'setAppSetting',
            key: 'appComposerRingEnabled',
            value: true,
        });
        expect(enableRes.ok).toBe(true);
        expect(toggleHistory.at(-1)).toEqual({ appComposerRingEnabled: true, appTopBarEnabled: false });
        expect(provider.getCdpStatus().state).toBe('connected');
        expect(pushedPayloads.length).toBeGreaterThan(0);

        const latestPayload = pushedPayloads.at(-1)!;
        expect(latestPayload.contextUsedTokens).toBe(180_000);
        expect(latestPayload.contextEffectiveLimit).toBe(256_000);
        expect(latestPayload.tightestQuotaPct).toBe(30);
        expect(latestPayload.quotaPools.length).toBeGreaterThanOrEqual(2);
        expect(latestPayload.cumulativeRecordedTokens).toBeGreaterThanOrEqual(15_000);

        // Toggle Top Bar ON -> both active
        await provider.handleAction({ command: 'setAppSetting', key: 'appTopBarEnabled', value: true });
        expect(toggleHistory.at(-1)).toEqual({ appComposerRingEnabled: true, appTopBarEnabled: true });

        // Toggle both OFF -> unmounts cleanly
        await provider.handleAction({ command: 'setAppSetting', key: 'appComposerRingEnabled', value: false });
        await provider.handleAction({ command: 'setAppSetting', key: 'appTopBarEnabled', value: false });
        expect(provider.getCdpStatus().state).toBe('disabled');

        // Dispose calls overlayManager.dispose()
        await provider.dispose();
        expect(overlayDisposed).toBe(true);
    });

    it('wires checkForUpdates + applyPluginUpdate with lastUpdateCheck persistence and requiresReload notice', async () => {
        const tmp = makeTmpDir();
        tmpDirs.push(tmp);
        const pluginDir = path.join(tmp, 'live-plugin');
        fs.mkdirSync(pluginDir, { recursive: true });

        const releaseInfo: PluginReleaseInfo = {
            version: '1.17.6',
            tagName: 'v1.17.6',
            releaseUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.6',
            releaseNotesSummary: 'Ambient HUD, Calendar 52w heatmap, and App-IDE hot sync.',
            assetName: 'antigravity-context-monitor-app-1.17.6.zip',
            assetUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/antigravity-context-monitor-app-1.17.6.zip',
            checksumsUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/SHA256SUMS.txt',
        };
        const applyCalls: Array<{ targetPluginDir: string; version: string }> = [];

        const provider = await createSidecarRuntimeProvider({
            version: '1.17.5',
            statePath: path.join(tmp, 'state.json'),
            targetPluginDir: pluginDir,
            autoStart: false,
            disableCliScan: true,
            deps: {
                checkForUpdates: async () => ({
                    status: 'update_available',
                    currentVersion: '1.17.5',
                    latestVersion: '1.17.6',
                    hasUpdate: true,
                    checkedAt: 1_763_840_000_000,
                    etag: '"etag-1176"',
                    releaseInfo,
                }),
                applyAppPluginUpdate: async (opts) => {
                    applyCalls.push({ targetPluginDir: opts.targetPluginDir, version: opts.releaseInfo.version });
                    return {
                        ok: true,
                        previousVersion: opts.currentVersion,
                        installedVersion: opts.releaseInfo.version,
                        requiresReload: true,
                        checksumVerified: true,
                        message: 'Updated to v1.17.6. Toggle plugin Off -> On to reload.',
                    };
                },
            },
        });
        providers.push(provider);

        // Manual checkForUpdates returns { type: 'updateCheckResult', command: 'updateCheckResult' }
        const checkRes = await provider.handleAction({ command: 'checkForUpdates', force: true });
        expect(checkRes.ok).toBe(true);
        const checkPayload = checkRes.result as Record<string, unknown>;
        expect(checkPayload.type).toBe('updateCheckResult');
        expect(checkPayload.command).toBe('updateCheckResult');
        expect(checkPayload.hasUpdate).toBe(true);
        expect(checkPayload.latestVersion).toBe('1.17.6');

        // Persisted in DurableState and survives subsequent setAppSetting edits!
        expect(provider.getDurableState().getAppSettings().lastUpdateCheck?.latestVersion).toBe('1.17.6');
        await provider.handleAction({ command: 'setAppSetting', key: 'displayCurrency', value: 'CNY' });
        expect(provider.getDurableState().getAppSettings().lastUpdateCheck?.latestVersion).toBe('1.17.6');
        expect(provider.getDurableState().getAppSettings().displayCurrency).toBe('CNY');

        // applyPluginUpdate invokes applyAppPluginUpdate targeting pluginDir with requiresReload: true
        const applyRes = await provider.handleAction({ command: 'applyPluginUpdate' });
        expect(applyRes.ok).toBe(true);
        const applyPayload = applyRes.result as Record<string, unknown>;
        expect(applyPayload.type).toBe('pluginUpdateResult');
        expect(applyPayload.command).toBe('pluginUpdateResult');
        expect(applyPayload.requiresReload).toBe(true);
        expect(applyPayload.installedVersion).toBe('1.17.6');
        expect(applyCalls).toEqual([{ targetPluginDir: path.resolve(pluginDir), version: '1.17.6' }]);
        expect(provider.getState().updateStatus?.status).toBe('applied');
    });

    it('handles all Calendar actions, live-today + CLI merge, CSV/JSON export, Orchestrator mode, settings & strict URL/reveal safety', async () => {
        const tmp = makeTmpDir();
        tmpDirs.push(tmp);
        const openedUrls: string[] = [];

        const mockCliScanner = {
            scan: () => ({
                available: true,
                days: [{
                    date: '2026-11-22',
                    calls: 2,
                    inputTokens: 4_000,
                    outputTokens: 1_000,
                    thinkingTokens: 0,
                    cacheReadTokens: 1_000,
                    cacheCreationTokens: 0,
                    totalTokens: 6_000,
                    estimatedCost: 0.03,
                    modelBreakdown: {
                        'Gemini 4 Neon': {
                            calls: 2,
                            inputTokens: 4_000,
                            outputTokens: 1_000,
                            thinkingTokens: 0,
                            cacheReadTokens: 1_000,
                            cacheCreationTokens: 0,
                            estimatedCost: 0.03,
                        },
                    },
                }],
            }),
        } as unknown as CliUsageScanner;

        const provider = await createSidecarRuntimeProvider({
            version: '1.17.5',
            statePath: path.join(tmp, 'state.json'),
            autoStart: false,
            deps: {
                cliUsageScanner: mockCliScanner,
                openExternalUrl: async (url) => { openedUrls.push(url); },
                now: () => Date.parse('2026-11-22T12:00:00Z'),
            },
        });
        providers.push(provider);

        // Orchestrator Pricing Mode toggle
        const modeRes = await provider.handleAction({ command: 'setOrchestratorPricingMode', mode: 'strict' });
        expect(modeRes.ok).toBe(true);
        expect(provider.getState().orchestratorPricingMode).toBe('strict');
        expect(provider.getDurableState().getAppSettings().orchestratorPricingMode).toBe('strict');
        expect(modeRes.messages?.some(m => m.command === 'configSaved' && m.key === 'orchestratorPricingMode')).toBe(true);
        expect(modeRes.messages?.some(m => m.command === 'syncSettingsControls' && m.orchestratorPricingMode === 'strict')).toBe(true);

        // All v1.17.6 settings via setAppSetting
        const settingsMatrix: Array<[string, unknown]> = [
            ['displayCurrency', 'EUR'],
            ['customFxRate', 0.92],
            ['subscriptionPlan', 'google-ai-pro'],
            ['subscriptionCurrency', 'USD'],
            ['calendarRetentionDays', 180],
            ['autoCheckUpdates', false],
            ['showNativeHudBar', false],
            ['activityMaxRecentSteps', 220],
            ['activityMaxArchives', 45],
            ['quotaNotificationThreshold', 15],
            ['pollingInterval', 10],
        ];
        for (const [key, value] of settingsMatrix) {
            const r = await provider.handleAction({ command: 'setAppSetting', key, value });
            expect(r.ok, `setAppSetting(${key})`).toBe(true);
            expect(r.messages?.some(m => m.command === 'configSaved')).toBe(true);
            expect(r.messages?.some(m => m.command === 'syncSettingsControls')).toBe(true);
        }
        const savedSettings = provider.getDurableState().getAppSettings();
        expect(savedSettings.displayCurrency).toBe('EUR');
        expect(savedSettings.customFxRate).toBe(0.92);
        expect(savedSettings.subscriptionMonthlyFee).toBe(19.99);
        expect(savedSettings.calendarRetentionDays).toBe(180);
        expect(savedSettings.autoCheckUpdates).toBe(false);
        expect(savedSettings.showNativeHudBar).toBe(false);
        expect(savedSettings.activityMaxRecentSteps).toBe(220);
        expect(savedSettings.activityMaxArchives).toBe(45);
        expect(savedSettings.quotaNotificationThreshold).toBe(15);
        expect(savedSettings.pollingInterval).toBe(10);

        // Calendar interactive actions + CSV/JSON exports
        expect((await provider.handleAction({ command: 'calendarFilterSource', source: 'cli' })).ok).toBe(true);
        expect((await provider.handleAction({ command: 'calendarSetMetric', metric: 'cost' })).ok).toBe(true);
        expect((await provider.handleAction({ command: 'calendarSetPeriod', period: 'daily' })).ok).toBe(true);
        expect((await provider.handleAction({ command: 'calendarSetView', view: 'heatmap' })).ok).toBe(true);
        expect((await provider.handleAction({ command: 'calendarSelectDate', date: '2026-11-22' })).ok).toBe(true);
        expect((await provider.handleAction({ command: 'calendarJumpDate', date: '2026-11-22', year: 2026, month: 11 })).ok).toBe(true);

        const csvRes = await provider.handleAction({ command: 'calendarExportCsv' }) as Record<string, any>;
        expect(csvRes.ok).toBe(true);
        expect(csvRes.filename).toMatch(/^antigravity-usage-cli-daily-\d{4}-\d{2}-\d{2}\.csv$/);
        expect(csvRes.mimeType).toContain('text/csv');
        expect(csvRes.content).toContain('2026-11-22');

        const jsonRes = await provider.handleAction({ command: 'calendarExportJson' }) as Record<string, any>;
        expect(jsonRes.ok).toBe(true);
        expect(jsonRes.filename).toMatch(/\.json$/);
        expect(jsonRes.mimeType).toContain('application/json');
        const parsedExport = JSON.parse(jsonRes.content);
        expect(parsedExport.filter.source).toBe('cli');
        expect(parsedExport.filter.currency).toBe('EUR');
        expect(parsedExport.days.length).toBe(1);

        // Strict external URL validation
        expect((await provider.handleAction({
            command: 'openExternalUrl',
            url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases',
        })).ok).toBe(true);
        expect(openedUrls.length).toBe(1);

        for (const badUrl of [
            'http://github.com/foo',
            'file:///etc/passwd',
            'javascript:alert(1)',
            'https://evil.example.com/phish',
            'https://github.com/foo&calc.exe',
        ]) {
            const badRes = await provider.handleAction({ command: 'openExternalUrl', url: badUrl });
            expect(badRes.ok).toBe(false);
            expect(badRes.statusCode).toBe(403);
            expect(validateExternalUrl(badUrl)).toBeNull();
        }

        // Cross-platform reveal command hardening (Windows spaces & commas, macOS open -R, Linux xdg-open parent)
        const winSpec = buildRevealInOsCommand('C:\\Users\\Alice, Bob\\My Files\\state,v1.json', false, 'win32');
        expect(winSpec.cmd).toBe('explorer.exe');
        expect(winSpec.options.shell).toBe(false);
        expect(winSpec.options.windowsVerbatimArguments).toBe(true);
        expect(winSpec.args).toEqual(['/select,', '"C:\\Users\\Alice, Bob\\My Files\\state,v1.json"']);
        expect(() => buildRevealInOsCommand('C:\\bad"quote\\a.json', false, 'win32')).toThrow();

        const macSpec = buildRevealInOsCommand('/Users/alice/state.json', false, 'darwin');
        expect(macSpec.cmd).toBe('open');
        expect(macSpec.args).toEqual(['-R', '/Users/alice/state.json']);
        expect(macSpec.options.shell).toBe(false);

        const linuxSpec = buildRevealInOsCommand('/home/alice/.gemini/state.json', false, 'linux');
        expect(linuxSpec.cmd).toBe('xdg-open');
        expect(linuxSpec.args).toEqual(['/home/alice/.gemini']);
        expect(linuxSpec.options.shell).toBe(false);

        const winUrlSpec = buildOpenExternalUrlCommand('https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor', 'win32');
        expect(winUrlSpec.cmd).toBe('rundll32.exe');
        expect(winUrlSpec.options.shell).toBe(false);
    });

    it('host-bridge script includes v1.17.6 Native HUD patching, structured action responses & file download helper', () => {
        const script = getHostBridgeScript({ pollIntervalMs: 3000, autoPoll: false });
        expect(() => new Function(script)).not.toThrow();
        expect(script).toContain('nativeHudHost');
        expect(script).toContain('triggerFileDownload');
        expect(script).toContain('downloadFile');
        expect(script).toContain('updateCheckResult');
        expect(script).toContain('pluginUpdateResult');
        expect(script).toContain('configSaved');
        expect(script).toContain('syncSettingsControls');
    });
});

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
        const appState = new DurableState(stateFile);
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
});

// Consolidated Domain Suite: App Sidecar Sync, Overlay Bridge Auth, CDP Lifecycle, Updates & Calendar Export
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
import { DurableState } from '../src/durable-state';
import { getLanguage, setLanguageToState } from '../src/i18n-core';
import type { FullUserStatus, ModelConfig } from '../src/models';
import * as trackerModule from '../src/tracker';
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
import { createFastDurableState } from './helpers/factories';

describe('[app-sidecar-sync-and-bridge]', () => {
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

            let overlayMgr: CdpAmbientOverlayManager | null = null;
            let injectedOverlayToken = '';
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
                    createCdpOverlayManager: (mgrOpts) => {
                        overlayMgr = createCdpAmbientOverlayManager({
                            ...mgrOpts,
                            discoverActivePort: () => ({
                                port: 9222,
                                wsPath: '/devtools/browser/test-overlay-auth',
                                filePath: '/tmp/DevToolsActivePort',
                            }),
                            inspectHostProcess: async () => ({ found: true, pid: 4242, hasRemoteDebuggingFlag: true }),
                            fetchVersion: async () => ({
                                Browser: 'Antigravity/1.0',
                                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test-overlay-auth',
                            }),
                            fetchTargets: async () => [{
                                id: 'hub-overlay-auth',
                                type: 'page',
                                title: 'Antigravity',
                                url: 'http://127.0.0.1:43210/',
                                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/hub-overlay-auth',
                            }],
                            connectClient: async (): Promise<CdpClientLike> => {
                                let open = true;
                                return {
                                    get isOpen() { return open; },
                                    send: async () => ({} as never),
                                    evaluate: async <T = unknown>(expr: string) => {
                                        const m = /"bridgeToken":"([a-f0-9]{64})"/.exec(expr);
                                        if (m) { injectedOverlayToken = m[1]; }
                                        return { ok: true, origin: 'http://127.0.0.1:43210', href: 'http://127.0.0.1:43210/' } as T;
                                    },
                                    close: async () => { open = false; },
                                };
                            },
                        });
                        return overlayMgr;
                    },
                },
            });
            providers.push(provider);

            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0, version: '1.17.5' });
            servers.push(handle);
            expect(handle.overlayBridgeToken).toMatch(/^[a-f0-9]{64}$/);

            // Attach a verified Hub target to mint a live per-target origin-bound CDP grant
            await provider.handleAction({ command: 'setAppSetting', key: 'appTopBarEnabled', value: true });
            const activeGrants = overlayMgr!.getActiveGrants?.() ?? [];
            expect(activeGrants).toHaveLength(1);
            const token = injectedOverlayToken;
            expect(token).toMatch(/^[a-f0-9]{64}$/);

            // 1. Missing Origin -> 403
            const noOrigin = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: { 'Content-Type': 'application/json', 'X-Monitor-Token': token },
                body: JSON.stringify({ command: 'openPanel' }),
            });
            expect(noOrigin.status).toBe(403);

            // 2. Non-loopback Origin -> 403
            const evilOrigin = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://evil.example.com',
                    'X-Monitor-Token': token,
                },
                body: JSON.stringify({ command: 'openPanel' }),
            });
            expect(evilOrigin.status).toBe(403);

            // 3. Invalid X-Monitor-Token -> 401
            const badToken = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:43210',
                    'X-Monitor-Token': '0'.repeat(64),
                },
                body: JSON.stringify({ command: 'openPanel' }),
            });
            expect(badToken.status).toBe(401);

            // 3b. Valid token with mismatched loopback Origin -> 401 (strict origin binding)
            const wrongOrigin = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:49999',
                    'X-Monitor-Token': token,
                },
                body: JSON.stringify({ command: 'openPanel' }),
            });
            expect(wrongOrigin.status).toBe(401);

            // 4. Valid CORS preflight OPTIONS -> 204
            const preflight = await httpRequest(handle.url, 'OPTIONS', '/api/overlay/action', {
                headers: { Origin: 'http://127.0.0.1:43210' },
            });
            expect(preflight.status).toBe(204);
            expect(preflight.headers['access-control-allow-origin']).toBe('http://127.0.0.1:43210');

            // 5. Valid authenticated CDP-scoped commands: openPanel, refresh, togglePause, focusConversation
            const pollsBefore = pollCalls;
            for (const cmd of ['openPanel', 'refresh', 'togglePause', 'focusConversation']) {
                const res = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: 'http://127.0.0.1:43210',
                        'X-Monitor-Token': token,
                    },
                    body: JSON.stringify({ command: cmd, source: 'topbar', ...(cmd === 'focusConversation' ? { conversationId: 'conv-main', focusRevision: 1 } : {}) }),
                });
                expect(res.status).toBe(200);
                expect(res.json().ok).toBe(true);
            }
            expect(pollCalls).toBe(pollsBefore + 1);

            // 6. Disallowed / non-CDP commands -> 403 (strict minimal CDP capability scope)
            for (const disallowedCmd of ['ping', 'openSidecar', 'togglePanel', 'deleteEverything']) {
                const badCmd = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: 'http://127.0.0.1:43210',
                        'X-Monitor-Token': token,
                    },
                    body: JSON.stringify({ command: disallowedCmd }),
                });
                expect(badCmd.status).toBe(403);
            }
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
                    platformGuide: { platform: 'darwin', command: 'open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0', en: 'en', zh: 'zh' },
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

            // Subscription Plan presets: Ultra 5x ($99.99), Ultra 20x ($199.99), legacy 'google-ai-ultra' -> Ultra 20x ($199.99), invalid rejection
            const u5Res = await provider.handleAction({ command: 'setAppSetting', key: 'subscriptionPlan', value: 'google-ai-ultra-5x' });
            expect(u5Res.ok).toBe(true);
            expect(provider.getAppSettings().subscriptionPlan).toBe('google-ai-ultra-5x');
            expect(provider.getDurableState().getAppSettings().subscriptionMonthlyFee).toBe(99.99);
            expect(provider.getDurableState().getAppSettings().subscriptionCurrency).toBe('USD');

            const u20Res = await provider.handleAction({ command: 'setAppSetting', key: 'subscriptionPlan', value: 'google-ai-ultra-20x' });
            expect(u20Res.ok).toBe(true);
            expect(provider.getAppSettings().subscriptionPlan).toBe('google-ai-ultra-20x');
            expect(provider.getDurableState().getAppSettings().subscriptionMonthlyFee).toBe(199.99);

            const legacyRes = await provider.handleAction({ command: 'setAppSetting', key: 'subscriptionPlan', value: 'google-ai-ultra' });
            expect(legacyRes.ok).toBe(true);
            expect(provider.getAppSettings().subscriptionPlan).toBe('google-ai-ultra-20x');
            expect(provider.getDurableState().getAppSettings().subscriptionMonthlyFee).toBe(199.99);

            const badPlanRes = await provider.handleAction({ command: 'setAppSetting', key: 'subscriptionPlan', value: 'bogus-tier' });
            expect(badPlanRes.ok).toBe(false);

            // Hydrating persisted legacy 'google-ai-ultra' preserves historical $249.99 fee non-destructively (or maps $99.99 -> Ultra 5x)
            const legacy249Path = path.join(tmp, 'legacy-ultra-249.json');
            const legacy249State = createFastDurableState(legacy249Path);
            await legacy249State.globalBucket().update('subscriptionPlan', 'google-ai-ultra');
            await legacy249State.updateAppSettings({ subscriptionMonthlyFee: 249.99, subscriptionCurrency: 'USD' });
            await legacy249State.flush();
            const hydrated249 = await createSidecarRuntimeProvider({
                version: '1.17.8',
                statePath: legacy249Path,
                autoStart: false,
                disableCliScan: true,
            });
            providers.push(hydrated249);
            expect(hydrated249.getAppSettings().subscriptionPlan).toBe('google-ai-ultra-20x');
            expect(hydrated249.getAppSettings().subscriptionMonthlyFee).toBe(249.99);

            const legacy99Path = path.join(tmp, 'legacy-ultra-99.json');
            const legacy99State = createFastDurableState(legacy99Path);
            await legacy99State.globalBucket().update('subscriptionPlan', 'google-ai-ultra');
            await legacy99State.updateAppSettings({ subscriptionMonthlyFee: 99.99, subscriptionCurrency: 'USD' });
            await legacy99State.flush();
            const hydrated99 = await createSidecarRuntimeProvider({
                version: '1.17.8',
                statePath: legacy99Path,
                autoStart: false,
                disableCliScan: true,
            });
            providers.push(hydrated99);
            expect(hydrated99.getAppSettings().subscriptionPlan).toBe('google-ai-ultra-5x');
            expect(hydrated99.getAppSettings().subscriptionMonthlyFee).toBe(99.99);

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
            expect(script).toContain('cdpStatusResult');
            expect(script).toContain('configSaved');
            expect(script).toContain('syncSettingsControls');
        });

        it('wires recheckCdp end-to-end across HTTP /api/action, live setListeningPort exclusion, telemetry push, cdpStatusResult/syncSettingsControls, and host-bridge dispatch', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const traj = makeTrajectory();

            let portReady = false;
            let standalonePort = 0;
            const connectedWsUrls: string[] = [];
            const evaluatedScripts: string[] = [];

            const provider = await createSidecarRuntimeProvider({
                version: '1.17.6',
                statePath: path.join(tmp, 'state.json'),
                autoStart: false,
                disableCliScan: true,
                deps: {
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
                    checkForUpdates: async () => ({
                        status: 'up_to_date',
                        hasUpdate: false,
                        currentVersion: '1.17.6',
                        latestVersion: '1.17.6',
                        checkedAt: Date.parse('2026-11-24T10:00:00Z'),
                    }),
                    createCdpOverlayManager: (mgrOpts) => createCdpAmbientOverlayManager({
                        ...mgrOpts,
                        enableActionBridge: false,
                        reconnectBackoffMs: 60_000,
                        discoverActivePort: () => (portReady
                            ? { port: 9333, wsPath: '/devtools/browser/test', filePath: '/tmp/DevToolsActivePort' }
                            : null),
                        fetchTargets: async () => [
                            // Standalone sidecar's own listening port (registered AFTER createCdpOverlayManager via setListeningPort)
                            {
                                id: 'sidecar-self',
                                type: 'page',
                                title: 'Antigravity',
                                url: `https://127.0.0.1:${standalonePort}/`,
                                webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/sidecar-self',
                            },
                            // Genuine Hub target
                            {
                                id: 'hub-main',
                                type: 'page',
                                title: 'Jetski Web',
                                url: 'https://127.0.0.1:49888/',
                                webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/hub-main',
                            },
                        ],
                        connectClient: async (wsUrl): Promise<CdpClientLike> => {
                            connectedWsUrls.push(wsUrl);
                            let open = true;
                            return {
                                get isOpen() { return open; },
                                send: async () => ({} as never),
                                evaluate: async <T = unknown>(expr: string) => {
                                    evaluatedScripts.push(expr);
                                    return { ok: true } as T;
                                },
                                close: async () => { open = false; },
                            };
                        },
                    }),
                },
            });
            providers.push(provider);

            // Start standalone server -> calls provider.setListeningPort(handle.port) AFTER createCdpOverlayManager
            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0, version: '1.17.6' });
            servers.push(handle);
            standalonePort = handle.port;
            const { authHeaders } = await pairStandaloneSession(handle);

            await provider.pollNow(true);
            await provider.handleAction({ command: 'checkForUpdates', force: true });

            // Enable Composer Ring while DevToolsActivePort is missing -> cdp_unavailable + missing_port_file
            const toggleHttp = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'setAppSetting', key: 'appComposerRingEnabled', value: true }),
            });
            expect(toggleHttp.status).toBe(200);
            const toggleBody = toggleHttp.json();
            expect(toggleBody.ok).toBe(true);
            expect(toggleBody.result.cdpStatus.state).toBe('cdp_unavailable');
            expect(toggleBody.result.cdpStatus.diagnosticCode).toBe('missing_port_file');

            // Now Antigravity restarts with CDP enabled -> user clicks Recheck CDP (despite 60s backoff!)
            portReady = true;
            evaluatedScripts.length = 0;
            const recheckHttp = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'recheckCdp', viewMode: 'aux' }),
            });
            expect(recheckHttp.status).toBe(200);
            const recheckBody = recheckHttp.json();
            expect(recheckBody.ok).toBe(true);

            // Live setListeningPort excluded standalonePort and attached to genuine Hub target
            expect(connectedWsUrls).toEqual(['ws://127.0.0.1:9333/devtools/page/hub-main']);
            // Both bootstrap AND fresh telemetry update payload were pushed immediately on reconnect
            expect(evaluatedScripts.length).toBeGreaterThanOrEqual(2);
            expect(evaluatedScripts.some(s => s.includes('180000') || s.includes('Gemini 4 Neon'))).toBe(true);

            // Structured cdpStatusResult + syncSettingsControls + snapshot.data.{cdpStatus,updateStatus}
            expect(recheckBody.result.type).toBe('cdpStatusResult');
            expect(recheckBody.result.command).toBe('cdpStatusResult');
            expect(recheckBody.result.cdpStatus.state).toBe('connected');
            expect(recheckBody.result.cdpStatus.diagnosticCode).toBe('connected');
            expect(recheckBody.result.cdpStatus.discoveredPort).toBe(9333);
            expect(recheckBody.result.cdpStatus.targetTitle).toBe('Jetski Web');

            const cdpMsg = (recheckBody.messages as Array<Record<string, any>>).find(m => m.command === 'cdpStatusResult');
            const syncMsg = (recheckBody.messages as Array<Record<string, any>>).find(m => m.command === 'syncSettingsControls');
            expect(cdpMsg?.cdpStatus?.state).toBe('connected');
            expect(syncMsg?.cdpStatus?.state).toBe('connected');
            expect(syncMsg?.cdpStatus?.diagnosticCode).toBe('connected');
            expect(syncMsg?.updateStatus?.status).toBe('up_to_date');
            expect(typeof syncMsg?.pollingInterval).toBe('number');
            expect(typeof syncMsg?.quotaNotificationThreshold).toBe('number');
            expect(recheckBody.snapshot?.data?.cdpStatus?.state).toBe('connected');
            expect(recheckBody.snapshot?.data?.updateStatus?.status).toBe('up_to_date');

            // Verify host-bridge.ts forwards structured cdpStatusResult even when returned only in data.result
            const dispatched: Array<Record<string, unknown>> = [];
            const listeners = new Map<string, Array<(ev: any) => void>>();
            const docStub = {
                readyState: 'complete',
                hidden: false,
                body: { getAttribute: () => 'aux', setAttribute: () => {}, classList: { toggle: () => {} } },
                documentElement: { style: { getPropertyValue: () => '', setProperty: () => {} } },
                addEventListener: () => {},
                getElementById: () => null,
            };
            const sandbox: Record<string, unknown> = {
                URLSearchParams,
                URL,
                Promise,
                setTimeout,
                clearTimeout,
                document: docStub,
                navigator: {},
                MessageEvent: class FakeMessageEvent {
                    type: string;
                    data: unknown;
                    constructor(type: string, init?: { data?: unknown }) {
                        this.type = type;
                        this.data = init?.data;
                    }
                },
                CustomEvent: class FakeCustomEvent {
                    type: string;
                    detail: unknown;
                    constructor(type: string, init?: { detail?: unknown }) {
                        this.type = type;
                        this.detail = init?.detail;
                    }
                },
            };
            const winStub: Record<string, any> = {
                location: { pathname: '/', search: '', href: 'http://127.0.0.1/' },
                addEventListener: (type: string, fn: (ev: any) => void) => {
                    const arr = listeners.get(type) ?? [];
                    arr.push(fn);
                    listeners.set(type, arr);
                },
                dispatchEvent: (ev: any) => {
                    if (ev?.type === 'message' && ev.data) {
                        dispatched.push(ev.data as Record<string, unknown>);
                    }
                    for (const fn of listeners.get(ev?.type) ?? []) {
                        fn(ev);
                    }
                    return true;
                },
                postMessage: (msg: Record<string, unknown>) => { dispatched.push(msg); },
                fetch: async () => ({
                    ok: true,
                    json: async () => ({
                        ok: true,
                        result: {
                            type: 'cdpStatusResult',
                            command: 'cdpStatusResult',
                            cdpStatus: { state: 'connected', diagnosticCode: 'connected', discoveredPort: 9333 },
                        },
                    }),
                }),
                CustomEvent: sandbox.CustomEvent,
                MessageEvent: sandbox.MessageEvent,
            };
            sandbox.window = winStub;
            vm.runInNewContext(getHostBridgeScript({ pollIntervalMs: 4000, autoPoll: false }), sandbox);
            await winStub.__ACM_BRIDGE__.sendAction({ command: 'recheckCdp' });
            expect(dispatched.some(m => m.command === 'cdpStatusResult' && (m.cdpStatus as CdpStatus)?.diagnosticCode === 'connected')).toBe(true);

            // 5. Verify host-bridge.ts also forwards structured cdpLauncherResult
            const launcherDispatched: Array<Record<string, unknown>> = [];
            const launcherSandbox: Record<string, unknown> = {
                console,
                setTimeout,
                clearTimeout,
                URLSearchParams,
                CustomEvent: class CustomEvent { constructor(public type: string, public init?: { detail?: unknown }) { this.detail = init?.detail; } detail: unknown; },
                MessageEvent: class MessageEvent { constructor(public type: string, public init?: { data?: unknown }) { this.data = init?.data; } data: unknown; },
                document: { hidden: false, readyState: 'complete', addEventListener: () => {} },
                navigator: { clipboard: { writeText: async () => {} } },
            };
            const launcherWinStub: Record<string, any> = {
                location: { href: 'http://127.0.0.1:49999/', pathname: '/', search: '' },
                addEventListener: () => {},
                dispatchEvent: (ev: any) => {
                    if (ev?.type === 'message' && ev?.data) { launcherDispatched.push(ev.data); }
                    return true;
                },
                postMessage: (msg: Record<string, unknown>) => { launcherDispatched.push(msg); },
                fetch: async () => ({
                    ok: true,
                    json: async () => ({
                        ok: true,
                        result: {
                            type: 'cdpLauncherResult',
                            command: 'cdpLauncherResult',
                            ok: true,
                            launcherStatus: { installed: true, launcherPath: '/tmp/fake/Antigravity (CDP).app' },
                        },
                    }),
                }),
                CustomEvent: launcherSandbox.CustomEvent,
                MessageEvent: launcherSandbox.MessageEvent,
            };
            launcherSandbox.window = launcherWinStub;
            vm.runInNewContext(getHostBridgeScript({ pollIntervalMs: 4000, autoPoll: false }), launcherSandbox);
            await launcherWinStub.__ACM_BRIDGE__.sendAction({ command: 'setupCdpLauncher' });
            expect(launcherDispatched.some(m => m.command === 'cdpLauncherResult' && (m.launcherStatus as { installed?: boolean })?.installed === true)).toBe(true);

            // 6. Verify App Sidecar setupCdpLauncher & removeCdpLauncher via injected hermetic deps (never touches ~/Applications)
            let launcherInstalled = false;
            const fakeLauncherPath = path.join(tmp, 'Applications', 'Antigravity (CDP).app');
            const makeLauncherStatus = () => ({
                supported: true,
                platform: 'darwin' as const,
                installed: launcherInstalled,
                launcherPath: fakeLauncherPath,
                displayName: 'Antigravity (CDP)',
                targetAppFound: true,
                targetAppPath: '/Applications/Antigravity.app',
                safeTerminalCommand: 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                noteEn: 'Hermetic launcher EN',
                noteZh: '隔离测试启动器 ZH',
            });
            const launcherStatePath = path.join(tmp, 'launcher-state.json');
            const launcherProvider = await createSidecarRuntimeProvider({
                version: '1.17.8',
                statePath: launcherStatePath,
                autoStart: false,
                disableCliScan: true,
                deps: {
                    discoverLS: async () => makeMockLS(),
                    fetchFullUserStatus: async () => makeMockUserStatus(),
                    fetchAvailableModels: async () => null,
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    getAllTrajectories: async () => [makeTrajectory('cascade-launcher')],
                    getContextUsage: async () => makeUsage(makeTrajectory('cascade-launcher')),
                    refreshWorkflowImageUsage: async (_ls, u) => u,
                    fetchTrajectoryGeneratorMetadata: async () => [],
                    fetchTrajectorySteps: async () => ({ steps: [], totalSteps: 0 }),
                    processActivity: async () => false,
                    fetchGM: async () => null,
                    inspectCdpLauncher: () => makeLauncherStatus(),
                    createCdpLauncher: () => {
                        launcherInstalled = true;
                        return {
                            ok: true,
                            status: makeLauncherStatus(),
                            messageEn: 'Created persistent CDP launcher',
                            messageZh: '已生成持久化 CDP 启动器',
                        };
                    },
                    removeCdpLauncher: () => {
                        launcherInstalled = false;
                        return {
                            ok: true,
                            status: makeLauncherStatus(),
                            messageEn: 'Removed persistent CDP launcher',
                            messageZh: '已移除持久化 CDP 启动器',
                        };
                    },
                },
            });
            providers.push(launcherProvider);
            await launcherProvider.pollNow(true);
            const snapBeforeLauncher = await launcherProvider.getSnapshot({ viewMode: 'aux' });
            expect(snapBeforeLauncher.data.cdpStatus?.launcherStatus).toBeUndefined();

            const setupRes = await launcherProvider.handleAction({ command: 'setupCdpLauncher', viewMode: 'aux' });
            expect(setupRes.ok).toBe(true);
            const setupResult = setupRes.result as Record<string, unknown>;
            expect(setupResult.command).toBe('cdpLauncherResult');
            expect((setupResult.launcherStatus as { installed?: boolean })?.installed).toBe(true);
            expect(setupRes.messages?.some(m => m.command === 'cdpLauncherResult')).toBe(true);
            expect(setupRes.messages?.some(m => m.command === 'cdpStatusResult')).toBe(true);
            expect(setupRes.messages?.some(m => m.command === 'syncSettingsControls')).toBe(true);
            const snapAfterSetup = await launcherProvider.getSnapshot({ viewMode: 'aux' });
            expect(snapAfterSetup.data.cdpStatus?.launcherStatus?.installed).toBe(true);
            expect(computeSnapshotHash(snapAfterSetup)).not.toBe(computeSnapshotHash(snapBeforeLauncher));

            const removeRes = await launcherProvider.handleAction({ command: 'removeCdpLauncher', viewMode: 'aux' });
            expect(removeRes.ok).toBe(true);
            expect((removeRes.result as { launcherStatus?: { installed?: boolean } })?.launcherStatus?.installed).toBe(false);
            const snapAfterRemove = await launcherProvider.getSnapshot({ viewMode: 'aux' });
            expect(snapAfterRemove.data.cdpStatus?.launcherStatus?.installed).toBe(false);
        });

        it('keeps CDP overlay estCostFormatted in USD + localCostFormatted in local currency, preserves post-archive live tokens, and forwards orchestratorPricingMode', async () => {
            const tmp = makeTmpDir();
            tmpDirs.push(tmp);
            const statePath = path.join(tmp, 'state.json');
            const fixedNow = Date.parse('2026-11-22T14:00:00Z');
            const todayKey = toLocalDateKey(new Date(fixedNow));

            // Seed state.json with an earlier archived cycle for today AND a live post-archive ledger bucket for today
            const seedState = createFastDurableState(statePath);
            const seedGlobal = seedState.globalBucket();
            await seedGlobal.update('dailyStoreState', {
                version: 1,
                records: {
                    [todayKey]: {
                        date: todayKey,
                        cycles: [{
                            startTime: '2026-11-22T09:00:00Z',
                            endTime: '2026-11-22T10:00:00Z',
                            triggeredBy: 'daily-rollover',
                            totalReasoning: 0,
                            totalToolCalls: 0,
                            totalErrors: 0,
                            totalInputTokens: 10_000,
                            totalOutputTokens: 2_000,
                            estSteps: 2,
                            modelNames: ['Gemini 4 Neon'],
                            modelStats: {},
                            gmTotalCalls: 2,
                            gmTotalTokens: 12_000,
                            gmTotalCacheRead: 3_000,
                            gmTotalAllTokens: 15_000,
                            gmEstimatedCost: 0.06,
                            surface: 'app',
                        }],
                    },
                },
            });
            await seedGlobal.update('dailyLedgerState', {
                version: 1,
                dateKey: todayKey,
                accounts: {
                    'alice@example.com': {
                        email: 'alice@example.com',
                        totalCalls: 1,
                        totalInputTokens: 5_000,
                        totalOutputTokens: 1_000,
                        totalThinkingTokens: 0,
                        totalCacheRead: 2_000,
                        totalCacheCreation: 0,
                        totalCredits: 0,
                        totalEstimatedCost: 0.05,
                        surfaceBreakdown: {
                            app: {
                                calls: 1,
                                inputTokens: 5_000,
                                outputTokens: 1_000,
                                thinkingTokens: 0,
                                cacheReadTokens: 2_000,
                                cacheCreationTokens: 0,
                                credits: 0,
                                estimatedCost: 0.05,
                            },
                        },
                        modelStats: {
                            'Gemini 4 Neon': {
                                calls: 1,
                                inputTokens: 5_000,
                                outputTokens: 1_000,
                                thinkingTokens: 0,
                                cacheReadTokens: 2_000,
                                cacheCreationTokens: 0,
                                credits: 0,
                                estimatedCost: 0.05,
                            },
                        },
                        recordedCallIds: ['call-post-archive-1'],
                        recordedCalls: [{
                            callId: 'call-post-archive-1',
                            createdAt: '2026-11-22T12:30:00Z',
                            createdAtMs: Date.parse('2026-11-22T12:30:00Z'),
                            modelId: 'MODEL_PLACEHOLDER_M535',
                            modelKey: 'Gemini 4 Neon',
                            inputTokens: 5_000,
                            outputTokens: 1_000,
                            thinkingTokens: 0,
                            cacheReadTokens: 2_000,
                            cacheCreationTokens: 0,
                            credits: 0,
                            estimatedCost: 0.05,
                            surface: 'app',
                        }],
                    },
                },
                settled: [],
            });
            await seedState.updateAppSettings({ displayCurrency: 'CNY', customFxRate: 7.25 });
            await seedState.flush();

            const traj = makeTrajectory();
            const orchGmSummary = {
                totalCalls: 1,
                totalStepsCovered: 1,
                totalCredits: 0,
                totalInputTokens: 100_000,
                totalOutputTokens: 20_000,
                totalThinkingTokens: 0,
                totalCacheRead: 200_000,
                totalCacheCreation: 0,
                totalRetryCount: 0,
                totalRetryTokens: 0,
                totalRetryCredits: 0,
                stopReasonCounts: {},
                retryErrorCodes: {},
                toolCallCounts: {},
                recentErrors: [],
                modelBreakdown: {},
                contextGrowth: [],
                conversations: [{
                    cascadeId: traj.cascadeId,
                    title: traj.summary,
                    totalSteps: 1,
                    coveredSteps: 1,
                    coverageRate: 1,
                    calls: [{
                        stepIndices: [1],
                        executionId: 'orch-exec-1',
                        model: 'MODEL_PLACEHOLDER_M537',
                        modelDisplay: 'Orchestrator (Neon)',
                        responseModel: 'gemini-pro-orchestrator-neon',
                        modelAccuracy: 'exact' as const,
                        inputTokens: 100_000,
                        outputTokens: 20_000,
                        thinkingTokens: 0,
                        responseTokens: 20_000,
                        cacheReadTokens: 200_000,
                        cacheCreationTokens: 0,
                        apiProvider: 'GOOGLE_GENAI',
                        ttftSeconds: 0.8,
                        streamingSeconds: 4.0,
                        credits: 0,
                        creditType: '',
                        hasError: false,
                        errorMessage: '',
                        contextTokensUsed: 300_000,
                        completionConfig: null,
                        systemPromptSnippet: '',
                        toolCount: 0,
                        toolNames: [],
                        promptSectionTitles: [],
                        promptSnippet: '',
                        promptSource: '',
                        messagePromptCount: 0,
                        createdAt: '2026-11-22T13:55:00Z',
                    }],
                }],
            } as unknown as GMSummary;

            const provider = await createSidecarRuntimeProvider({
                version: '1.17.5',
                statePath,
                autoStart: false,
                disableCliScan: true,
                deps: {
                    now: () => fixedNow,
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
                    fetchGM: async () => orchGmSummary,
                },
            });
            providers.push(provider);
            await provider.pollNow(true);

            const overlay = provider.buildOverlayPayload();
            // #3: USD primary + CNY local conversion (never duplicate ¥... ≈ ¥...)
            expect(overlay.estCostFormatted).toMatch(/^\$\d+\.\d{2}$/);
            expect(overlay.localCostFormatted).toMatch(/^¥\d+\.\d{2}$/);
            expect(overlay.estCostFormatted).not.toBe(overlay.localCostFormatted);

            // #5: Archived today cycle (15,000) + post-archive live ledger (8,000) = 23,000 (not dropped!)
            expect(overlay.cumulativeRecordedTokens).toBe(23_000);

            // #6: extractOverviewTelemetry forwards orchestratorPricingMode explicitly
            const mappedTelemetry = extractOverviewTelemetry(orchGmSummary, traj.cascadeId, {}, 'mapped');
            const strictTelemetry = extractOverviewTelemetry(orchGmSummary, traj.cascadeId, {}, 'strict');
            expect(mappedTelemetry?.primary.estCacheSavingsUsd).not.toBeNull();
            expect(strictTelemetry?.primary.estCacheSavingsUsd).toBeNull();
        });

        it('handles App Sidecar setupCdpLauncher/removeCdpLauncher hermetically, surfaces host_missing_flag, and forwards cdpLauncherResult via host-bridge', async () => {
            const tmp = makeTmpDir();
            const traj = makeTrajectory();
            const fakeLauncherPath = path.join(tmp, 'Applications', 'Antigravity (CDP).app');
            let launcherInstalled = false;

            const makeLauncherStatus = () => ({
                supported: true,
                platform: 'darwin' as const,
                installed: launcherInstalled,
                launcherPath: fakeLauncherPath,
                displayName: 'Antigravity (CDP)',
                targetAppFound: true,
                targetAppPath: '/Applications/Antigravity.app',
                safeTerminalCommand: 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                noteEn: 'Hermetic launcher note EN',
                noteZh: '隔离启动器说明 ZH',
            });

            const provider = await createSidecarRuntimeProvider({
                version: '1.17.8',
                statePath: path.join(tmp, 'state.json'),
                autoStart: false,
                disableCliScan: true,
                deps: {
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
                    inspectCdpLauncher: () => makeLauncherStatus(),
                    createCdpLauncher: () => {
                        launcherInstalled = true;
                        return {
                            ok: true,
                            status: makeLauncherStatus(),
                            messageEn: 'Created persistent CDP launcher.',
                            messageZh: '已生成持久化 CDP 启动器。',
                        };
                    },
                    removeCdpLauncher: () => {
                        launcherInstalled = false;
                        return {
                            ok: true,
                            status: makeLauncherStatus(),
                            messageEn: 'Removed persistent CDP launcher.',
                            messageZh: '已移除持久化 CDP 启动器。',
                        };
                    },
                    createCdpOverlayManager: (mgrOpts) => createCdpAmbientOverlayManager({
                        ...mgrOpts,
                        enableActionBridge: false,
                        discoverActivePort: () => null,
                        inspectHostProcess: () => ({
                            found: true,
                            pid: 42424,
                            hasRemoteDebuggingFlag: false,
                            commandLine: '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
                        }),
                    }),
                },
            });
            providers.push(provider);

            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0, version: '1.17.8' });
            servers.push(handle);
            const { sessionToken, authHeaders } = await pairStandaloneSession(handle);
            const sdkHandler = createSidecarHandler(provider, { isSidecarEnv: true, version: '1.17.8' });
            await provider.pollNow(true);

            // Enable overlay while host lacks --remote-debugging-port=0 -> host_missing_flag
            const toggleRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'setAppSetting', key: 'appComposerRingEnabled', value: true }),
            });
            expect(toggleRes.status).toBe(200);
            const toggleJson = toggleRes.json();
            expect(toggleJson.result.cdpStatus.state).toBe('cdp_unavailable');
            expect(toggleJson.result.cdpStatus.diagnosticCode).toBe('host_missing_flag');
            expect(toggleJson.result.cdpStatus.hostHasDebugFlag).toBe(false);
            expect(toggleJson.result.cdpStatus.launcherStatus.installed).toBe(false);

            // Host-privileged setupCdpLauncher is denied on standalone HTTP (403) and permitted only in SDK scope
            const setupDenied = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'setupCdpLauncher', viewMode: 'aux' }),
            });
            expect(setupDenied.status).toBe(403);
            expect(launcherInstalled).toBe(false);

            // 1-click setupCdpLauncher via SDK scope -> installs hermetically & updates cdpLauncherResult + snapshot
            const setupRes = await sdkHandler.handleActionPayload(
                { command: 'setupCdpLauncher', viewMode: 'aux' },
                { transport: 'sdk', authScope: 'sdk' },
            );
            expect(setupRes.status).toBe(200);
            const setupJson = setupRes.body as Record<string, any>;
            expect(setupJson.ok).toBe(true);
            expect(setupJson.result.command).toBe('cdpLauncherResult');
            expect(setupJson.result.launcherStatus.installed).toBe(true);
            // Fail-closed privacy mask redacts local launcher paths until explicitly unmasked
            expect(setupJson.result.launcherStatus.launcherPath).toBe('[Redacted Path]');
            expect(setupJson.snapshot.data.cdpStatus.launcherStatus.installed).toBe(true);
            expect((setupJson.messages as Array<Record<string, any>>).some(m => m.command === 'cdpLauncherResult')).toBe(true);
            expect((setupJson.messages as Array<Record<string, any>>).some(m => m.command === 'syncSettingsControls' && m.cdpStatus?.launcherStatus?.installed === true)).toBe(true);

            // After explicit unmask for windowId, real launcherPath is exposed for that window only
            const unmaskRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'setPrivacyMask', windowId: 'win-cdp', masked: false }),
            });
            expect(unmaskRes.status).toBe(200);
            const unmaskedSnapRes = await httpRequest(handle.url, 'GET', '/api/snapshot?view=aux&windowId=win-cdp', {
                headers: { 'X-Monitor-Session': sessionToken },
            });
            expect(unmaskedSnapRes.status).toBe(200);
            expect(unmaskedSnapRes.json().snapshot.data.cdpStatus.launcherStatus.launcherPath).toBe(fakeLauncherPath);

            // Verify host-bridge.ts forwards structured cdpLauncherResult returned in data.result
            const forwarded: any[] = [];
            const winListeners: Record<string, Array<(ev: any) => void>> = {};
            const docListeners: Record<string, Array<(ev: any) => void>> = {};
            const fakeDoc = {
                hidden: false,
                readyState: 'complete',
                documentElement: { style: { getPropertyValue: () => '' }, className: '' },
                body: {
                    setAttribute: () => {},
                    getAttribute: () => null,
                    style: {},
                    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
                },
                addEventListener: (t: string, fn: (ev: any) => void) => { (docListeners[t] ||= []).push(fn); },
                dispatchEvent: () => true,
            };
            const fakeWin: Record<string, any> = {
                document: fakeDoc,
                location: { origin: handle.url, href: handle.url + '/', search: '' },
                addEventListener: (t: string, fn: (ev: any) => void) => { (winListeners[t] ||= []).push(fn); },
                dispatchEvent: (ev: any) => {
                    if (ev?.type === 'message' && ev.data) {
                        forwarded.push(ev.data);
                    }
                    for (const fn of winListeners[ev.type] || []) { fn(ev); }
                    return true;
                },
                postMessage: (data: any) => {
                    forwarded.push(data);
                    for (const fn of winListeners.message || []) { fn({ data }); }
                },
                setInterval: () => 1,
                clearInterval: () => {},
                setTimeout: () => 1,
                clearTimeout: () => {},
                CustomEvent: class { constructor(public type: string, public detail?: any) {} },
                fetch: async () => ({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        result: setupJson.result,
                    }),
                }),
            };
            fakeWin.window = fakeWin;
            fakeWin.self = fakeWin;
            vm.runInNewContext(getHostBridgeScript({ viewMode: 'aux', pollIntervalMs: 5000, autoPoll: false }), {
                window: fakeWin,
                document: fakeDoc,
                console,
                URLSearchParams,
                setInterval: fakeWin.setInterval,
                clearInterval: fakeWin.clearInterval,
                setTimeout: fakeWin.setTimeout,
                clearTimeout: fakeWin.clearTimeout,
                CustomEvent: fakeWin.CustomEvent,
                fetch: fakeWin.fetch,
                Promise,
            });
            await fakeWin.__ACM_BRIDGE__.sendAction({ command: 'setupCdpLauncher' });
            expect(forwarded.some(m => m && m.command === 'cdpLauncherResult' && m.launcherStatus?.installed === true)).toBe(true);

            // Standalone HTTP removeCdpLauncher is denied (403); SDK scope removes launcher cleanly
            const removeDenied = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'removeCdpLauncher', viewMode: 'aux' }),
            });
            expect(removeDenied.status).toBe(403);
            expect(launcherInstalled).toBe(true);

            const removeRes = await sdkHandler.handleActionPayload(
                { command: 'removeCdpLauncher', viewMode: 'aux' },
                { transport: 'sdk', authScope: 'sdk' },
            );
            expect(removeRes.status).toBe(200);
            const removeJson = removeRes.body as Record<string, any>;
            expect(removeJson.ok).toBe(true);
            expect(removeJson.result.command).toBe('cdpLauncherResult');
            expect(removeJson.result.launcherStatus.installed).toBe(false);
            expect(removeJson.snapshot.data.cdpStatus.launcherStatus.installed).toBe(false);
        });

        it('v1.17.8: wires App Sidecar revealCdpLauncher, rich buildCdpOverlayPayload speed/total fields, and context-aware openPanel targetTab switching', async () => {
            let overlayMgr: CdpAmbientOverlayManager | null = null;
            let injectedOverlayToken = '';
            const tmp = makeTmpDir();
            const fixedNow = Date.parse('2026-11-24T12:00:00Z');
            const todayKey = toLocalDateKey(new Date(fixedNow));
            const yesterdayKey = toLocalDateKey(new Date(fixedNow - 86_400_000));
            const statePath = path.join(tmp, 'v1178-runtime-state.json');

            // Seed 2 days of recorded history (yesterday archived in DailyStore + today active/settled in DailyLedger) + subscription plan
            const seedState = createFastDurableState(statePath);
            const seedBucket = seedState.globalBucket();
            const seedStore = new DailyStore(400);
            seedStore.init(seedBucket, { maxDays: 400 });
            seedStore.addDailySnapshot(
                yesterdayKey,
                {
                    totalUserInputs: 4,
                    totalReasoning: 8,
                    totalToolCalls: 10,
                    totalErrors: 0,
                    totalCheckpoints: 1,
                    estSteps: 22,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    modelStats: {},
                    toolBreakdown: {},
                    recentSteps: [],
                } as any,
                {
                    totalCalls: 4,
                    totalInputTokens: 50_000,
                    totalOutputTokens: 10_000,
                    totalCacheRead: 40_000,
                    totalCacheCreation: 0,
                    totalThinkingTokens: 0,
                    totalCredits: 0,
                    totalRetryCount: 0,
                    totalRetryTokens: 0,
                    totalRetryCredits: 0,
                    retryErrorCodes: {},
                    modelBreakdown: {},
                    conversations: [],
                    toolCallCounts: {},
                    toolCatalog: [],
                    uniqueErrors: [],
                    fetchedAt: fixedNow - 86_400_000,
                } as unknown as GMSummary,
                12.5,
                undefined,
                false,
                { surface: 'app' },
            );

            await seedBucket.update('lastArchivalDateKey', todayKey);
            await seedBucket.update('dailyLedgerState', {
                version: 1,
                dateKey: todayKey,
                surface: 'app',
                accounts: {
                    'tester@example.com': {
                        email: 'tester@example.com',
                        accountEmail: 'tester@example.com',
                        totalCalls: 1,
                        totalInputTokens: 20_000,
                        totalOutputTokens: 4_000,
                        totalThinkingTokens: 0,
                        totalCacheRead: 30_000,
                        totalCacheCreation: 0,
                        totalCredits: 0,
                        totalEstimatedCost: 4.2,
                        surfaceBreakdown: {
                            app: {
                                calls: 1,
                                inputTokens: 20_000,
                                outputTokens: 4_000,
                                thinkingTokens: 0,
                                cacheReadTokens: 30_000,
                                cacheCreationTokens: 0,
                                credits: 0,
                                estimatedCost: 4.2,
                            },
                        },
                        modelStats: {
                            'Gemini 4 Neon': {
                                calls: 1,
                                inputTokens: 20_000,
                                outputTokens: 4_000,
                                thinkingTokens: 0,
                                cacheReadTokens: 30_000,
                                cacheCreationTokens: 0,
                                credits: 0,
                                estimatedCost: 4.2,
                            },
                        },
                        recordedCallIds: ['today-call-1'],
                        recordedCalls: [{
                            callId: 'today-call-1',
                            createdAt: new Date(fixedNow - 60_000).toISOString(),
                            createdAtMs: fixedNow - 60_000,
                            modelId: 'MODEL_PLACEHOLDER_M535',
                            modelKey: 'Gemini 4 Neon',
                            inputTokens: 20_000,
                            outputTokens: 4_000,
                            thinkingTokens: 0,
                            cacheReadTokens: 30_000,
                            cacheCreationTokens: 0,
                            credits: 0,
                            estimatedCost: 4.2,
                            surface: 'app',
                        }],
                    },
                },
                settled: [{
                    settledAt: new Date(fixedNow - 30_000).toISOString(),
                    accountEmail: 'tester@example.com',
                    poolModelIds: ['MODEL_PLACEHOLDER_M535'],
                    poolModelLabels: ['Gemini 4 Neon'],
                    totalCalls: 1,
                    totalInputTokens: 10_000,
                    totalOutputTokens: 2_000,
                    totalThinkingTokens: 0,
                    totalCacheRead: 14_000,
                    totalCacheCreation: 0,
                    totalCredits: 0,
                    totalEstimatedCost: 1.8,
                    modelCalls: { 'Gemini 4 Neon': 1 },
                    surface: 'app',
                }],
            });
            await seedBucket.update('subscriptionPlan', 'google-ai-ultra-20x');
            await seedState.updateAppSettings({
                displayCurrency: 'USD',
                subscriptionMonthlyFee: 199.99,
                subscriptionCurrency: 'USD',
            });
            await seedState.flush();

            const traj1: TrajectorySummary = { ...makeTrajectory(), cascadeId: 'cascade-main-v1178', trajectoryId: 'traj-main-v1178' };
            const traj2: TrajectorySummary = { ...makeTrajectory(), cascadeId: 'cascade-second-v1178', trajectoryId: 'traj-second-v1178', summary: 'Second Session' };
            const gmWithSpeed: GMSummary = {
                totalCalls: 3,
                totalStepsCovered: 12,
                totalInputTokens: 30_000,
                totalOutputTokens: 6_010,
                totalCacheRead: 44_000,
                totalCacheCreation: 0,
                totalThinkingTokens: 0,
                totalCredits: 0,
                totalRetryCount: 0,
                totalRetryTokens: 0,
                totalRetryCredits: 0,
                contextGrowth: [],
                latestTokenBreakdown: [],
                stopReasonCounts: {},
                recentErrors: [],
                retryErrorCodes: {},
                modelBreakdown: {},
                toolCallCounts: {},
                toolCatalog: [],
                uniqueErrors: [],
                fetchedAt: new Date(fixedNow).toISOString(),
                conversations: [{
                    cascadeId: traj1.cascadeId,
                    title: 'Main Session',
                    totalSteps: 12,
                    coveredSteps: 12,
                    coverageRate: 1,
                    checkpointSummaries: [],
                    systemContextItems: [],
                    calls: [
                        // Valid call: 1,000 tok / 10s = 100.0 tok/s
                        {
                            model: 'MODEL_PLACEHOLDER_M535',
                            modelDisplay: 'Gemini 4 Neon',
                            responseModel: 'gemini-4-neon',
                            modelAccuracy: 'exact',
                            inputTokens: 10_000,
                            outputTokens: 1_000,
                            cacheReadTokens: 20_000,
                            cacheCreationTokens: 0,
                            thinkingTokens: 0,
                            ttftSeconds: 0.8,
                            streamingSeconds: 10,
                            createdAt: new Date(fixedNow - 90_000).toISOString(),
                            hasError: false,
                            toolCallsByStep: {},
                            userMessageAnchors: [],
                        },
                        // Peak valid call: 2,260 tok / 20s = 113.0 tok/s
                        {
                            model: 'MODEL_PLACEHOLDER_M535',
                            modelDisplay: 'Gemini 4 Neon',
                            responseModel: 'gemini-4-neon',
                            modelAccuracy: 'exact',
                            inputTokens: 15_000,
                            outputTokens: 2_260,
                            cacheReadTokens: 24_000,
                            cacheCreationTokens: 0,
                            thinkingTokens: 0,
                            ttftSeconds: 0.6,
                            streamingSeconds: 20,
                            createdAt: new Date(fixedNow - 40_000).toISOString(),
                            hasError: false,
                            toolCallsByStep: {},
                            userMessageAnchors: [],
                        },
                        // Short sample: 10 tok / 0.02s = 500 tok/s (MUST be filtered out of peakOutputSpeedTps!)
                        {
                            model: 'MODEL_PLACEHOLDER_M535',
                            modelDisplay: 'Gemini 4 Neon',
                            responseModel: 'gemini-4-neon',
                            modelAccuracy: 'exact',
                            inputTokens: 5_000,
                            outputTokens: 10,
                            cacheReadTokens: 0,
                            cacheCreationTokens: 0,
                            thinkingTokens: 0,
                            ttftSeconds: 0.4,
                            streamingSeconds: 0.02,
                            createdAt: new Date(fixedNow - 10_000).toISOString(),
                            hasError: false,
                            toolCallsByStep: {},
                            userMessageAnchors: [],
                        },
                    ],
                }],
            } as unknown as GMSummary;

            const fakeLauncherPath = path.join(tmp, 'Applications', 'Antigravity (CDP).app');
            let launcherInstalled = true;
            let revealCallCount = 0;
            const makeLauncherStatus = () => ({
                supported: true,
                platform: 'darwin' as const,
                installed: launcherInstalled,
                launcherPath: fakeLauncherPath,
                displayName: 'Antigravity (CDP)',
                targetAppFound: true,
                targetAppPath: '/Applications/Antigravity.app',
                safeTerminalCommand: 'open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                noteEn: 'Ready',
                noteZh: '已就绪',
            });

            const provider = await createSidecarRuntimeProvider({
                version: '1.17.8',
                statePath,
                autoStart: false,
                disableCliScan: true,
                deps: {
                    now: () => fixedNow,
                    discoverLS: async () => makeMockLS(),
                    fetchFullUserStatus: async () => makeMockUserStatus(),
                    fetchAvailableModels: async () => null,
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    getAllTrajectories: async () => [traj1, traj2],
                    getContextUsage: async () => makeUsage(traj1),
                    refreshWorkflowImageUsage: async (_ls, u) => u,
                    fetchTrajectoryGeneratorMetadata: async () => [],
                    fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                    processActivity: async () => false,
                    fetchGM: async () => gmWithSpeed,
                    inspectCdpLauncher: () => makeLauncherStatus(),
                    revealCdpLauncher: () => {
                        revealCallCount++;
                        if (!launcherInstalled) {
                            return {
                                ok: false,
                                status: makeLauncherStatus(),
                                messageEn: 'Not created yet',
                                messageZh: '尚未创建',
                                error: 'Launcher not created yet',
                            };
                        }
                        return {
                            ok: true,
                            status: makeLauncherStatus(),
                            messageEn: `Revealed "${fakeLauncherPath}" in Finder.`,
                            messageZh: `已在访达中定位「${fakeLauncherPath}」。`,
                        };
                    },
                    createCdpOverlayManager: (mgrOpts) => {
                        overlayMgr = createCdpAmbientOverlayManager({
                            ...mgrOpts,
                            discoverActivePort: () => ({
                                port: 9223,
                                wsPath: '/devtools/browser/test-v1178',
                                filePath: '/tmp/DevToolsActivePort',
                            }),
                            inspectHostProcess: async () => ({ found: true, pid: 4243, hasRemoteDebuggingFlag: true }),
                            fetchVersion: async () => ({
                                Browser: 'Antigravity/1.0',
                                webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/test-v1178',
                            }),
                            fetchTargets: async () => [{
                                id: 'hub-v1178',
                                type: 'page',
                                title: 'Antigravity',
                                url: 'http://127.0.0.1:49999/',
                                webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/hub-v1178',
                            }],
                            connectClient: async (): Promise<CdpClientLike> => {
                                let open = true;
                                return {
                                    get isOpen() { return open; },
                                    send: async () => ({} as never),
                                    evaluate: async <T = unknown>(expr: string) => {
                                        const m = /"bridgeToken":"([a-f0-9]{64})"/.exec(expr);
                                        if (m) { injectedOverlayToken = m[1]; }
                                        return { ok: true, origin: 'http://127.0.0.1:49999', href: 'http://127.0.0.1:49999/' } as T;
                                    },
                                    close: async () => { open = false; },
                                };
                            },
                        });
                        return overlayMgr;
                    },
                },
            });
            providers.push(provider);
            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0, version: '1.17.8' });
            servers.push(handle);
            const { sessionToken, authHeaders } = await pairStandaloneSession(handle);
            const sdkHandler = createSidecarHandler(provider, { isSidecarEnv: true, version: '1.17.8' });
            await provider.pollNow(true);

            // 1. Verify all 8 new buildCdpOverlayPayload() fields
            const overlay = provider.buildOverlayPayload();
            expect(overlay.todayTokens).toBe(80_000); // 20k+4k+30k + 10k+2k+14k
            expect(overlay.cumulativeRecordedTokens).toBe(180_000); // yesterday 100k + today 80k
            expect(overlay.todayCostFormatted).toMatch(/^\$\d+\.\d{2}$/);
            expect(overlay.cumulativeCostFormatted).toMatch(/^\$\d+\.\d{2}$/);
            expect(overlay.recordedDaysCount).toBe(2);
            expect(overlay.sessionCount).toBe(2);
            expect(overlay.peakOutputSpeedTps).toBe(113); // short sample (500 tok/s) excluded!
            expect(overlay.recentCallCount).toBe(3);
            expect(overlay.subscriptionRoiSummary).toMatch(/^Google AI Ultra 20x · \d+\.\d×$/);

            // Turn subscription plan off -> subscriptionRoiSummary becomes null
            await provider.handleAction({ command: 'setAppSetting', key: 'subscriptionPlan', value: 'none' });
            expect(provider.buildOverlayPayload().subscriptionRoiSummary).toBeNull();

            // 2. Verify App Sidecar revealCdpLauncher (blocked on standalone HTTP 403, succeeds via SDK scope + error path)
            const revealStandaloneDenied = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'revealCdpLauncher', viewMode: 'aux' }),
            });
            expect(revealStandaloneDenied.status).toBe(403);
            expect(revealCallCount).toBe(0);

            const revealOkRes = await sdkHandler.handleActionPayload(
                { command: 'revealCdpLauncher', viewMode: 'aux' },
                { transport: 'sdk', authScope: 'sdk' },
            );
            expect(revealOkRes.status).toBe(200);
            const revealOkJson = revealOkRes.body as Record<string, any>;
            expect(revealCallCount).toBe(1);
            expect(revealOkJson.ok).toBe(true);
            expect(revealOkJson.result).toMatchObject({
                type: 'cdpLauncherResult',
                command: 'cdpLauncherResult',
                action: 'revealCdpLauncher',
                ok: true,
            });
            expect(revealOkJson.result.launcherStatus.installed).toBe(true);
            expect(revealOkJson.result.cdpStatus.launcherStatus.installed).toBe(true);
            expect((revealOkJson.messages as Array<Record<string, any>>).map(m => m.command)).toEqual([
                'cdpLauncherResult',
                'syncSettingsControls',
            ]);

            launcherInstalled = false;
            const revealErrRes = await provider.handleAction({ command: 'revealCdpLauncher', viewMode: 'aux' });
            expect(revealErrRes.ok).toBe(false);
            expect(revealErrRes.error).toBe('Launcher not created yet');
            expect((revealErrRes.result as Record<string, any>).action).toBe('revealCdpLauncher');

            // 3. Verify context-aware openPanel targetTab through /api/overlay/action -> /api/snapshot -> webview-script.ts VM
            await provider.handleAction({ command: 'setAppSetting', key: 'appTopBarEnabled', value: true });
            const overlayGrants = overlayMgr!.getActiveGrants?.() ?? [];
            expect(overlayGrants).toHaveLength(1);
            const overlayToken = injectedOverlayToken;
            expect(overlayToken).toMatch(/^[a-f0-9]{64}$/);

            const initialSnapRes = await httpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux', {
                headers: { 'X-Monitor-Session': sessionToken },
            });
            expect(initialSnapRes.status).toBe(200);
            const initialSnapJson = initialSnapRes.json();
            expect(initialSnapJson.snapshot.meta.overlayTargetTab).toBeUndefined();

            const overlayOpenRes = await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'http://127.0.0.1:49999',
                    'X-Monitor-Token': overlayToken,
                },
                body: JSON.stringify({ command: 'openPanel', source: 'topbar', targetTab: 'gm' }),
            });
            expect(overlayOpenRes.status).toBe(200);
            expect(overlayOpenRes.json().result).toMatchObject({
                acknowledged: true,
                command: 'openPanel',
                targetTab: 'gm',
                targetTabSeq: 1,
            });

            // ETag changed immediately and snapshot exposes meta.overlayTargetTab = { seq: 1, tab: 'gm' }
            const snapAfterGmRes = await httpRequest(
                handle.url,
                'GET',
                `/api/snapshot?viewMode=aux&etag=${encodeURIComponent(initialSnapJson.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(snapAfterGmRes.status).toBe(200);
            const snapAfterGmJson = snapAfterGmRes.json();
            expect(snapAfterGmJson.unchanged).toBe(false);
            expect(snapAfterGmJson.snapshot.meta.overlayTargetTab).toEqual({ seq: 1, tab: 'gm' });

            // Invalid targetTab is safely ignored (does not bump seq)
            await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'http://127.0.0.1:49999',
                    'X-Monitor-Token': overlayToken,
                },
                body: JSON.stringify({ command: 'openPanel', source: 'topbar', targetTab: 'evil-tab' }),
            });
            const snapAfterInvalid = (await httpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux', {
                headers: { 'X-Monitor-Session': sessionToken },
            })).json();
            expect(snapAfterInvalid.snapshot.meta.overlayTargetTab).toEqual({ seq: 1, tab: 'gm' });

            // Second valid targetTab ('cost') bumps monotonic seq to 2
            await httpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'http://127.0.0.1:49999',
                    'X-Monitor-Token': overlayToken,
                },
                body: JSON.stringify({ command: 'openPanel', source: 'topbar', targetTab: 'cost' }),
            });
            const snapAfterCostJson = (await httpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux', {
                headers: { 'X-Monitor-Session': sessionToken },
            })).json();
            expect(snapAfterCostJson.snapshot.meta.overlayTargetTab).toEqual({ seq: 2, tab: 'cost' });

            // Execute webview-script.ts in a lightweight DOM VM and confirm acm:snapshot switches tabs (gm -> gmdata, cost -> pricing) & deduplicates stale seq
            const tabIds = ['overview', 'gmdata', 'chats', 'pricing', 'models', 'calendar', 'profile', 'settings', 'about'];
            const makeClassList = (initial: string[] = []) => {
                const set = new Set(initial);
                return {
                    add: (...cls: string[]) => { for (const c of cls) set.add(c); },
                    remove: (...cls: string[]) => { for (const c of cls) set.delete(c); },
                    toggle: (c: string, force?: boolean) => {
                        const next = force !== undefined ? !!force : !set.has(c);
                        if (next) set.add(c); else set.delete(c);
                        return next;
                    },
                    contains: (c: string) => set.has(c),
                };
            };
            const tabBtns = tabIds.map(id => {
                const attrs: Record<string, string> = { 'data-tab': id };
                return {
                    dataset: { tab: id },
                    classList: makeClassList(id === 'overview' ? ['tab-btn', 'active'] : ['tab-btn']),
                    setAttribute: (k: string, v: string) => { attrs[k] = v; },
                    removeAttribute: (k: string) => { delete attrs[k]; },
                    getAttribute: (k: string) => attrs[k] ?? null,
                    focus: () => {},
                    scrollIntoView: () => {},
                    offsetLeft: 0,
                    offsetWidth: 60,
                    addEventListener: () => {},
                };
            });
            const tabPanes = tabIds.map(id => ({
                id: `tab-${id}`,
                innerHTML: '',
                classList: makeClassList(id === 'overview' ? ['tab-pane', 'active'] : ['tab-pane']),
                querySelector: () => null,
                querySelectorAll: () => [],
                contains: () => false,
            }));
            const paneById = new Map(tabPanes.map(p => [p.id, p]));
            let storedWebviewState: Record<string, any> = {};
            const winListeners: Record<string, Array<(ev: any) => void>> = {};
            const fakeDoc: Record<string, any> = {
                documentElement: { setAttribute: () => {}, getAttribute: () => null },
                body: {
                    dataset: {},
                    style: {},
                    getAttribute: () => null,
                    setAttribute: () => {},
                    addEventListener: () => {},
                },
                activeElement: null,
                querySelectorAll: (sel: string) => {
                    if (sel === '.tab-btn') { return tabBtns; }
                    if (sel === '.tab-pane') { return tabPanes; }
                    return [];
                },
                querySelector: (sel: string) => {
                    if (sel === '.tab-btn.active') { return tabBtns.find(b => b.classList.contains('active')) || null; }
                    return null;
                },
                getElementById: (id: string) => paneById.get(id) || null,
                addEventListener: () => {},
            };
            const fakeWin: Record<string, any> = {
                document: fakeDoc,
                scrollY: 0,
                scrollTo: () => {},
                requestAnimationFrame: (cb: () => void) => cb(),
                setTimeout: () => 1,
                clearTimeout: () => {},
                addEventListener: (type: string, fn: (ev: any) => void) => { (winListeners[type] ||= []).push(fn); },
                dispatchEvent: (ev: any) => {
                    for (const fn of winListeners[ev.type] || []) { fn(ev); }
                    return true;
                },
                acquireVsCodeApi: () => ({
                    getState: () => storedWebviewState,
                    setState: (s: Record<string, any>) => { storedWebviewState = { ...s }; },
                    postMessage: () => {},
                }),
            };
            fakeWin.window = fakeWin;
            vm.runInNewContext(getScript(), {
                window: fakeWin,
                document: fakeDoc,
                acquireVsCodeApi: fakeWin.acquireVsCodeApi,
                requestAnimationFrame: fakeWin.requestAnimationFrame,
                setTimeout: fakeWin.setTimeout,
                clearTimeout: fakeWin.clearTimeout,
                navigator: {},
                Element: function Element() {},
                Map,
                Set,
                Array,
                Object,
                JSON,
                Number,
                String,
                Boolean,
                Math,
                isFinite,
                parseInt,
                parseFloat,
                console,
            });

            // Dispatch seq 1 (targetTab: 'gm') -> switches active tab to 'gmdata'
            fakeWin.dispatchEvent({
                type: 'acm:snapshot',
                detail: { snapshot: snapAfterGmJson.snapshot, hash: snapAfterGmJson.hash },
            });
            expect(storedWebviewState.activeTab).toBe('gmdata');
            expect(storedWebviewState.lastHandledOverlayTabSeq).toBe(1);
            expect(paneById.get('tab-gmdata')!.classList.contains('active')).toBe(true);

            // User manually switches to 'overview'; replaying stale seq 1 must NOT override user's choice
            fakeWin.dispatchEvent({ type: 'message', data: { command: 'switchToTab', tab: 'overview' } });
            expect(storedWebviewState.activeTab).toBe('overview');
            fakeWin.dispatchEvent({
                type: 'acm:snapshot',
                detail: { snapshot: { ...snapAfterGmJson.snapshot }, hash: 'replay-1' },
            });
            expect(storedWebviewState.activeTab).toBe('overview');

            // Dispatch newer seq 2 (targetTab: 'cost') -> switches active tab to 'pricing'
            fakeWin.dispatchEvent({
                type: 'acm:snapshot',
                detail: { snapshot: snapAfterCostJson.snapshot, hash: snapAfterCostJson.hash },
            });
            expect(storedWebviewState.activeTab).toBe('pricing');
            expect(storedWebviewState.lastHandledOverlayTabSeq).toBe(2);
            expect(paneById.get('tab-pricing')!.classList.contains('active')).toBe(true);
        });
    });
});

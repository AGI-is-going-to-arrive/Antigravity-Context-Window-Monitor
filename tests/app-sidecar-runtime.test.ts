// Consolidated Domain Suite: App Sidecar Runtime Engine & Wave 1B Runtime Hardening
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    createSidecarRuntimeProvider,
    PollRpcCache,
    type SidecarDocumentParams,
    type SidecarRuntimeDeps,
    type SidecarRuntimeProvider,
    validateRevealTargetPath,
} from '../src/app/sidecar-runtime';
import { computeSnapshotHash, createSidecarHandler, type StandaloneServerHandle, startStandaloneServer } from '../src/app/sidecar-server';
import { CascadeStatus } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import { DurableState } from '../src/durable-state';
import { toLocalDateKey } from '../src/daily-ledger';
import type { FullUserStatus, ModelConfig, UserStatusInfo } from '../src/models';
import type { ContextUsage, RawGeneratorMetadataEntry, TrajectorySummary } from '../src/tracker';
import { buildAccountStatusPanel } from '../src/activity-panel';
import type { GMSummary } from '../src/gm-tracker';
import { buildMonitorDocumentHtml } from '../src/webview-document';
import { buildProfileContent, maskEmailForDisplay } from '../src/webview-profile-tab';
import { createFastDurableState } from './helpers/factories';

describe('[app-sidecar-runtime]', () => {
    interface HttpResponse {
        status: number;
        headers: http.IncomingHttpHeaders;
        buffer: Buffer;
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
                    const buffer = Buffer.concat(chunks);
                    const text = buffer.toString('utf8');
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        buffer,
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


    function makeMockLS(overrides: Partial<LSInfo> = {}): LSInfo {
        return {
            pid: 4242,
            port: 62502,
            csrfToken: 'mock-csrf-token',
            useTls: false,
            hostname: '127.0.0.1',
            surface: 'app',
            source: 'hub-file',
            ...overrides,
        };
    }


    function makeMockConfigs(): ModelConfig[] {
        return [
            {
                model: 'MODEL_PLACEHOLDER_M37',
                label: 'Gemini 3.1 Pro (High)',
                supportsImages: true,
                quotaInfo: {
                    remainingFraction: 0.72,
                    resetTime: new Date(Date.now() + 3 * 3_600_000).toISOString(),
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 2,
                isRecommended: true,
                supportedMimeTypes: ['image/png', 'image/jpeg'],
            },
            {
                model: 'MODEL_PLACEHOLDER_M26',
                label: 'Claude Opus 4.6 (Thinking)',
                supportsImages: true,
                quotaInfo: {
                    remainingFraction: 0.40,
                    resetTime: new Date(Date.now() + 2 * 3_600_000).toISOString(),
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 2,
                isRecommended: false,
                supportedMimeTypes: ['image/png', 'image/jpeg'],
            },
        ];
    }


    function makeMockUserStatus(email = 'alice@example.com', configs = makeMockConfigs()): FullUserStatus {
        return {
            configs,
            userInfo: {
                name: 'Alice Dev',
                email,
                planName: 'Google AI Pro',
                userTierId: 'tier-pro',
                userTierName: 'Pro',
                tierDescription: 'Pro tier',
                upgradeText: '',
                upgradeUri: '',
                promptCredits: 1000,
                flowCredits: 500,
                availableCredits: [
                    { creditType: 'GOOGLE_ONE_AI', creditAmount: 1000, minimumCreditAmountForUsage: 1 },
                ],
                browserEnabled: true,
                knowledgeBaseEnabled: true,
                canBuyMoreCredits: true,
                monthlyPromptCredits: 1000,
                monthlyFlowCredits: 500,
            },
        };
    }


    function makeTrajectory(overrides: Partial<TrajectorySummary> = {}): TrajectorySummary {
        return {
            cascadeId: 'conv-main-0001',
            trajectoryId: 'traj-main-0001',
            summary: 'Implement Antigravity App Sidecar Runtime',
            stepCount: 12,
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T18:00:00.000Z',
            createdTime: '2026-11-22T17:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M37',
            generatorModel: 'MODEL_PLACEHOLDER_M37',
            workspaceUris: ['file:///tmp/workspace-a'],
            lastUserInputTime: '2026-11-22T17:59:00.000Z',
            lastUserInputStepIndex: 10,
            repositoryName: 'antigravity',
            gitOriginUrl: '',
            branchName: 'main',
            gitRootUri: 'file:///tmp/workspace-a',
            ...overrides,
        };
    }


    function makeUsage(traj: TrajectorySummary, overrides: Partial<ContextUsage> = {}): ContextUsage {
        return {
            tokenUsageSource: 'planner',
            cascadeId: traj.cascadeId,
            trajectoryId: traj.trajectoryId,
            title: traj.summary,
            model: traj.requestedModel || 'MODEL_PLACEHOLDER_M37',
            modelDisplayName: 'Gemini 3.1 Pro (High)',
            contextUsed: 128_000,
            totalOutputTokens: 4_500,
            totalToolCallOutputTokens: 12_000,
            contextLimit: 256_000,
            usagePercent: 50,
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
            ...overrides,
        };
    }


    function makeMockGeneratorMetadata(): RawGeneratorMetadataEntry[] {
        return [
            {
                stepIndices: [1, 2, 3],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M37',
                    timeToFirstToken: '0.85s',
                    streamingDuration: '2.5s',
                    usage: {
                        inputTokens: 40_000,
                        cacheReadTokens: 2_000,
                        outputTokens: 1_200,
                        thinkingOutputTokens: 400,
                        responseOutputTokens: 800,
                    },
                    promptSections: [
                        { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 48_000 },
                        { title: 'Global Rules', tokenType: 'TOKEN_TYPE_RULES', contentLen: 16_000 },
                    ],
                },
            },
            {
                stepIndices: [9, 10, 11],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M37',
                    timeToFirstToken: '0.42s',
                    streamingDuration: '3.0s',
                    usage: {
                        inputTokens: 24_000,
                        cacheReadTokens: 96_000,
                        outputTokens: 3_000,
                        thinkingOutputTokens: 1_000,
                        responseOutputTokens: 2_000,
                    },
                    promptSections: [
                        { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 48_000 },
                        { title: 'Skill Catalog', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 24_000 },
                        { title: 'MCP Tools', tokenType: 'TOKEN_TYPE_PLUGINS', contentLen: 32_000 },
                    ],
                },
            },
        ];
    }


    function makeMockSteps(): Array<Record<string, unknown>> {
        return [
            {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: { userResponse: 'Please wire the Antigravity App Sidecar runtime and ETag API.' },
            },
            {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                plannerResponse: {
                    thinking: 'Planning the sidecar runtime architecture and security checks.',
                    response: 'Implementing src/app/sidecar-runtime.ts with full telemetry parity.',
                },
            },
        ];
    }


    function createMockDeps(
        overrides: Partial<SidecarRuntimeDeps> & {
            ls?: LSInfo | null;
            trajectories?: TrajectorySummary[];
            userStatus?: FullUserStatus;
            gmEntries?: RawGeneratorMetadataEntry[];
            steps?: Array<Record<string, unknown>>;
        } = {},
    ): SidecarRuntimeDeps {
        const ls = overrides.ls !== undefined ? overrides.ls : makeMockLS();
        const trajectories = overrides.trajectories ?? [makeTrajectory()];
        const userStatus = overrides.userStatus ?? makeMockUserStatus();
        const gmEntries = overrides.gmEntries ?? makeMockGeneratorMetadata();
        const steps = overrides.steps ?? makeMockSteps();

        return {
            discoverLS: overrides.discoverLS ?? (async () => ls),
            fetchFullUserStatus: overrides.fetchFullUserStatus ?? (async () => userStatus),
            getAllTrajectories: overrides.getAllTrajectories ?? (async () => trajectories),
            getContextUsage: overrides.getContextUsage ?? (async (_ls, tr) => makeUsage(tr)),
            refreshWorkflowImageUsage: overrides.refreshWorkflowImageUsage ?? (async (_ls, u) => u),
            fetchTrajectoryGeneratorMetadata: overrides.fetchTrajectoryGeneratorMetadata ?? (async () => gmEntries),
            fetchTrajectorySteps: overrides.fetchTrajectorySteps ?? (async () => ({ steps, hasGaps: false })),
            fetchOrchestratorSettings: overrides.fetchOrchestratorSettings ?? (async () => null),
            fetchUserQuotaSummary: overrides.fetchUserQuotaSummary ?? (async () => null),
            fetchAvailableModels: overrides.fetchAvailableModels ?? (async () => null),
            processActivity: overrides.processActivity ?? (async () => false),
            fetchGM: overrides.fetchGM ?? (async () => null),
            revealInOs: overrides.revealInOs ?? (async () => {}),
            now: overrides.now ?? (() => Date.parse('2026-11-22T18:05:00.000Z')),
            homedir: overrides.homedir ?? (() => os.homedir()),
        };
    }


    describe('app sidecar runtime engine', () => {
        const tmpDirs: string[] = [];
        const providers: SidecarRuntimeProvider[] = [];
        const servers: StandaloneServerHandle[] = [];

        function makeTempDir(prefix = 'acm-sidecar-rt-'): string {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
            tmpDirs.push(dir);
            return dir;
        }

        afterEach(async () => {
            while (servers.length > 0) {
                const s = servers.pop();
                if (s) { await s.close(); }
            }
            while (providers.length > 0) {
                const p = providers.pop();
                if (p) { await p.dispose(); }
            }
            while (tmpDirs.length > 0) {
                const d = tmpDirs.pop();
                if (d) { fs.rmSync(d, { recursive: true, force: true }); }
            }
        });

        it('loads compiled sidecar-runtime.js, sidecar-server.js, and webview-document.js in pure Node with ZERO vscode dependency', () => {
            const repoRoot = path.resolve(__dirname, '..');
            const outRuntime = path.join(repoRoot, 'out', 'app', 'sidecar-runtime.js');
            const outDoc = path.join(repoRoot, 'out', 'webview-document.js');
            if (!fs.existsSync(outRuntime) || !fs.existsSync(outDoc)) {
                execFileSync('npm', ['run', 'compile'], { cwd: repoRoot, stdio: 'pipe', windowsHide: true });
            }
            const tmpState = path.join(makeTempDir('acm-pure-node-'), 'state-v1.json');
            const checkScript = `
                const Module = require('module');
                const origLoad = Module._load;
                Module._load = function(request, parent, isMain) {
                    if (request === 'vscode') { throw new Error('FORBIDDEN_VSCODE_IMPORT'); }
                    return origLoad.apply(this, arguments);
                };
                const rt = require(${JSON.stringify(outRuntime)});
                const srv = require(${JSON.stringify(path.join(repoRoot, 'out', 'app', 'sidecar-server.js'))});
                const doc = require(${JSON.stringify(outDoc)});
                if (typeof rt.createSidecarRuntimeProvider !== 'function') throw new Error('missing factory');
                if (typeof srv.createSidecarHandler !== 'function') throw new Error('missing handler');
                if (typeof doc.buildMonitorDocumentHtml !== 'function') throw new Error('missing doc builder');
                (async () => {
                    const provider = rt.createSidecarRuntimeProvider({
                        version: '1.17.5',
                        statePath: ${JSON.stringify(tmpState)},
                        autoStart: false,
                    });
                    try {
                        const html = await provider.renderHtml({
                            viewMode: 'aux',
                            pathname: '/',
                            isSidecarEnv: true,
                            version: '1.17.5',
                        });
                        if (!html.includes('id="tab-settings"') || !html.includes('data-monitor-overview')) {
                            throw new Error('did not render full 9-tab webview-document');
                        }
                        if (html.includes('acm-hero-metric')) {
                            throw new Error('unexpectedly fell back to stub renderer');
                        }
                        console.log('ZERO_VSCODE_OK');
                    } finally {
                        await provider.dispose();
                    }
                })().catch(err => { console.error(err); process.exit(1); });
            `;
            const stdout = execFileSync(process.execPath, ['-e', checkScript], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            expect(stdout).toContain('ZERO_VSCODE_OK');
        });

        it('discovers with preferredSurface:"app", computes full v1.17.5 telemetry, and passes complete contract to renderDocument', async () => {
            const tmpDir = makeTempDir();
            const statePath = path.join(tmpDir, 'state-v1.json');
            let discoveredOpts: any = null;
            let capturedParams: SidecarDocumentParams | null = null;

            const deps = createMockDeps({
                discoverLS: async (opts) => {
                    discoveredOpts = opts;
                    return makeMockLS();
                },
            });

            const provider = createSidecarRuntimeProvider({
                version: '1.17.5',
                statePath,
                autoStart: false,
                deps,
                renderDocument: (params) => {
                    capturedParams = params;
                    return `<!DOCTYPE html><html><head><title>Injected</title></head><body><div>${params.surface}:${params.activeConversationId}</div></body></html>`;
                },
            });
            providers.push(provider);

            await provider.pollNow(true);
            const html = await provider.renderHtml({
                viewMode: 'aux',
                pathname: '/',
                isSidecarEnv: true,
                version: '1.17.5',
            });

            expect(discoveredOpts).toMatchObject({ preferredSurface: 'app' });
            expect(html).toContain('app-sidecar:conv-main-0001');
            expect(capturedParams).not.toBeNull();

            const p = capturedParams!;
            expect(p.surface).toBe('app-sidecar');
            expect(p.version).toBe('1.17.5');
            expect(p.imagesBaseUri).toBeUndefined();
            expect(p.lastUpdatedTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
            expect(p.data?.cascadeId).toBe('conv-main-0001');
            expect(p.currentUsage?.cascadeId).toBe('conv-main-0001');
            expect(p.allTrajectories).toHaveLength(1);
            expect(p.userStatus.configs).toHaveLength(2);
            // Fail-closed privacy mask is ON by default: plaintext email & name are redacted before rendering
            expect(p.userStatus.userInfo?.email).toBe('****@redacted');
            expect(p.privacyMasked).toBe(true);
            expect(p.staleState?.isStale).toBe(false);
            expect(p.isCustomModelActive).toBe(false);

            // Explicit unmask scoped to windowId reveals real account identity; absent windowId stays fail-closed masked!
            const unmaskRes = await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-aux', masked: false });
            expect(unmaskRes.ok).toBe(true);
            await provider.renderHtml({
                viewMode: 'aux',
                pathname: '/',
                windowId: 'win-aux',
                isSidecarEnv: true,
                version: '1.17.5',
            });
            expect(capturedParams!.userStatus.userInfo?.email).toBe('alice@example.com');
            await provider.renderHtml({
                viewMode: 'aux',
                pathname: '/',
                isSidecarEnv: true,
                version: '1.17.5',
            });
            expect(capturedParams!.userStatus.userInfo?.email).toBe('****@redacted');
            expect(capturedParams!.privacyMasked).toBe(true);

            // Dual-cap breakdown (256K effective budget vs 1M native ceiling for Gemini 3.1 Pro)
            expect(p.contextBreakdown).not.toBeNull();
            expect(p.contextBreakdown!.measurementState).toBe('measured');
            expect(p.contextBreakdown!.hasPromptSections).toBe(true);
            expect(p.contextBreakdown!.hasDualCap).toBe(true);
            expect(p.contextBreakdown!.effectiveBudgetTokens).toBe(256_000);
            expect(p.contextBreakdown!.nativeLimitTokens).toBeGreaterThan(256_000);
            expect(p.contextBreakdown!.segments.length).toBeGreaterThan(0);

            // Turn diagnostics (Turn 1 cold ~4.8%, Turn 2 warm 80%)
            expect(p.turnDiagnostics).not.toBeNull();
            expect(p.turnDiagnostics!.totalTurns).toBe(2);
            expect(p.turnDiagnostics!.lastTurnStartKind).toBe('warm');
            expect(p.turnDiagnostics!.lastTurnCacheHitPct).toBe(80);
            expect(p.turnDiagnostics!.sessionCacheHitPct).toBeGreaterThan(50);

            // Conversation options & extras mirror
            expect(p.conversationOptions).toHaveLength(1);
            expect(p.activeConversationId).toBe('conv-main-0001');
            expect(p.extras.imagesBaseUri).toBeUndefined();
            expect(p.extras.contextBreakdown).toBe(p.contextBreakdown);
            expect(p.extras.observation?.subjectCascadeId).toBe('conv-main-0001');
        });

        it('renders full 9-tab Studio Telemetry Ledger via webview-document.ts by default with XSS escaping and per-request lang override', async () => {
            const tmpDir = makeTempDir();
            const xssTitle = '<script>alert("title-xss")</script><img src=x onerror=alert(1)>';
            const xssSection = '"><svg onload=alert("sec-xss")>';
            const xssPath = `file:///tmp/<img src=x onerror=alert("ws")>/repo`;
            const xssTraj = makeTrajectory({
                summary: xssTitle,
                workspaceUris: [xssPath],
                gitRootUri: xssPath,
            });
            const xssGm = makeMockGeneratorMetadata();
            xssGm[1].chatModel!.promptSections!.push({
                title: xssSection,
                tokenType: 'TOKEN_TYPE_FILES',
                contentLen: 80_000,
            });

            let capturedParams: SidecarDocumentParams | null = null;
            const provider = createSidecarRuntimeProvider({
                version: '1.17.5',
                statePath: path.join(tmpDir, 'state-v1.json'),
                initialWorkspaceUris: [xssPath],
                autoStart: false,
                deps: createMockDeps({
                    trajectories: [xssTraj],
                    gmEntries: xssGm,
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            const html = await provider.renderHtml({
                viewMode: 'sidebar',
                pathname: '/full',
                lang: 'en',
                isSidecarEnv: false,
                version: '1.17.5',
            });

            // Full v1.18 5-Tab Studio Telemetry Ledger + Topbar Utility Views (NOT stub fallback)
            expect(html).toContain('data-acm-surface="app-sidecar"');
            expect(html).toContain('data-monitor-overview');
            expect(html).toContain('id="mastheadContextBar"');
            expect(html).toContain('id="conversationSwitcher"');
            expect(html).toContain('data-action="toggleLockMain"');
            expect(html).toContain('data-action="copyContextReport"');
            expect(html).toContain('data-action="copyHandoffPrompt"');
            expect(html).toContain('ctx-dot-matrix');
            expect(html).toContain('ctx-dual-cap-row');
            for (const tabId of ['overview', 'gm', 'sessions', 'calendar', 'models', 'settings', 'about']) {
                expect(html).toContain(`id="tab-${tabId}"`);
            }
            for (const slotId of ['slot-gm', 'slot-sessions', 'slot-calendar', 'slot-pricing', 'slot-models', 'slot-profile']) {
                expect(html).toContain(`id="${slotId}"`);
            }
            expect(html).toContain('id="tabBtn-settings"');
            expect(html).not.toContain('id="topbarSettingsBtn"');
            expect(html).toContain('id="topbarAboutBtn"');
            expect(html).not.toContain('acm-hero-metric');
            expect(html).toContain('data-lang="en"');

            // Strict XSS escaping for untrusted titles, prompt section names, and workspace paths
            expect(html).not.toContain('<script>alert("title-xss")</script>');
            expect(html).not.toContain('<img src=x onerror=alert(1)>');
            expect(html).not.toContain('<svg onload=alert("sec-xss")>');
            expect(html).toContain('&lt;script&gt;alert(&quot;title-xss&quot;)&lt;/script&gt;');

            // Custom injected renderDocument still receives full D9 SidecarDocumentParams
            const customProbe = createSidecarRuntimeProvider({
                version: '1.17.5',
                statePath: path.join(tmpDir, 'custom-render-state.json'),
                autoStart: false,
                deps: createMockDeps(),
                renderDocument: (p) => {
                    capturedParams = p;
                    return `<html><body>${p.extras.observation?.subjectCascadeId ?? 'none'}</body></html>`;
                },
            });
            providers.push(customProbe);
            await customProbe.pollNow(true);
            const customHtml = await customProbe.renderHtml({
                viewMode: 'sidebar',
                pathname: '/full',
                isSidecarEnv: false,
                version: '1.17.5',
            });
            expect(capturedParams).not.toBeNull();
            expect(customHtml).toContain('conv-main-0001');
        });

        it('recalculates today’s overview cost for settled calls under the active prices and strict mode', async () => {
            const statePath = path.join(makeTempDir(), 'state.json');
            const stats = { calls: 1, inputTokens: 1_000_000, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0 };
            fs.writeFileSync(statePath, JSON.stringify({
                version: 1, workspaces: {}, global: {
                    appSettings: { orchestratorPricingMode: 'strict' },
                    customModelPricing: { 'model-a': { input: 3, output: 1, thinking: 1, cacheRead: 0.1, cacheWrite: 1 } },
                    dailyLedgerState: {
                        version: 1, dateKey: toLocalDateKey(), accounts: {},
                        settled: [{
                            settledAt: new Date().toISOString(), accountEmail: '', poolModelIds: [], poolModelLabels: [],
                            totalCalls: 2, totalInputTokens: 2_000_000, totalOutputTokens: 0, totalCacheRead: 0,
                            totalThinkingTokens: 0, totalCacheCreation: 0, totalCredits: 0, totalEstimatedCost: 10,
                            modelCalls: { 'model-a': 1, MODEL_PLACEHOLDER_M667: 1 },
                            modelStats: { 'model-a': { ...stats, estimatedCost: 1 }, MODEL_PLACEHOLDER_M667: { ...stats, estimatedCost: 9 } },
                        }],
                    },
                },
            }));
            let overviewTotal: number | undefined;
            const provider = createSidecarRuntimeProvider({
                statePath, autoStart: false, disableCliScan: true, deps: createMockDeps({ now: () => Date.now() }),
                renderDocument(params) {
                    expect(params.ledgerDateKey).toBe(toLocalDateKey());
                    overviewTotal = params.todayCostUsd;
                    return '<html></html>';
                },
            });
            providers.push(provider);
            await provider.pollNow(false);
            await provider.renderHtml({ viewMode: 'aux', pathname: '/', isSidecarEnv: true, version: 'test' });
            expect(overviewTotal).toBe(3);
        });

        it('refreshes idle telemetry on a trajectory replacement and manual refresh even at identical step count and timestamp', async () => {
            let trajectory = makeTrajectory({ status: CascadeStatus.IDLE });
            let used = 12_000;
            let now = Date.parse(trajectory.lastModifiedTime);
            const fetchUsage = vi.fn(async (_ls: LSInfo, tr: TrajectorySummary) => makeUsage(tr, { contextUsed: used }));
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(makeTempDir(), 'state.json'),
                autoStart: false,
                deps: createMockDeps({
                    now: () => now,
                    getAllTrajectories: async () => [trajectory],
                    getContextUsage: fetchUsage,
                    fetchTrajectoryGeneratorMetadata: async () => [{
                        stepIndices: [0], chatModel: { usage: { inputTokens: used } },
                    }],
                    steps: [],
                }),
            });
            providers.push(provider);

            await provider.pollNow(false);
            await provider.pollNow(false);
            expect(fetchUsage).toHaveBeenCalledTimes(1);
            for (const change of [{ trajectoryId: 'replacement' }, { branchName: 'other' }]) {
                trajectory = { ...trajectory, ...change };
                used += 1000;
                await provider.pollNow(false);
                expect(provider.getState().currentUsage?.contextUsed).toBe(used);
                expect(provider.getState().latestObservation?.usedTokens).toBe(used);
            }
            used += 1000;
            await provider.handleAction({ command: 'refresh' });
            expect(provider.getState().latestObservation?.usedTokens).toBe(used);
            expect(fetchUsage).toHaveBeenCalledTimes(4);
            used += 1000;
            now += 60_000;
            await provider.pollNow(false);
            expect(provider.getState().latestObservation?.usedTokens).toBe(used);
            expect(fetchUsage).toHaveBeenCalledTimes(5);
        });

        it('reads the checkpoint after the last GM even when the old call has prompt sections', async () => {
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(makeTempDir(), 'state.json'),
                autoStart: false,
                deps: createMockDeps({
                    trajectories: [makeTrajectory({ stepCount: 13 })],
                    gmEntries: makeMockGeneratorMetadata(),
                    steps: [{ stepIndex: 12, type: 'CORTEX_STEP_TYPE_CHECKPOINT', checkpoint: { sessionSummary: 'Short checkpoint' } }],
                }),
            });
            providers.push(provider);
            await provider.pollNow(false);
            const state = provider.getState();
            expect(state.contextBreakdown?.measurementState).toBe('estimated_post_compaction');
            expect(state.latestObservation?.usedTokens).toBe(state.contextBreakdown?.usedTokens);
            expect(state.latestObservation!.usedTokens).toBe(26_004);
        });

        it('shows unavailable context after an unsized checkpoint until a later planner call measures it', async () => {
            const trajectory = makeTrajectory({ stepCount: 4 });
            const gm = [{ stepIndices: [1], chatModel: { usage: { inputTokens: 90_000 } } }];
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(makeTempDir(), 'state.json'),
                autoStart: false,
                deps: createMockDeps({
                    trajectories: [trajectory],
                    getContextUsage: async () => makeUsage(trajectory, { contextUsed: 90_000 }),
                    gmEntries: gm,
                    steps: [{ stepIndex: 2, type: 'CORTEX_STEP_TYPE_CHECKPOINT', checkpoint: {} }],
                }),
            });
            providers.push(provider);
            await provider.pollNow(false);
            expect(provider.getState().latestObservation?.usedTokens).toBeNull();
            expect(provider.getState().currentUsage?.postCompactionPending).toBe(true);
            gm.push({ stepIndices: [3], chatModel: { usage: { inputTokens: 12_000 } } });
            await provider.pollNow(false);
            expect(provider.getState().contextBreakdown?.measurementState).toBe('measured');
            expect(provider.getState().latestObservation?.usedTokens).toBe(12_000);
        });

        it('rejects a second window’s pre-compaction handoff revision after the active window updates', async () => {
            const tr = makeTrajectory();
            const steps: Array<Record<string, unknown>> = [];
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(makeTempDir(), 'state.json'),
                autoStart: false,
                deps: createMockDeps({ trajectories: [tr], steps }),
            });
            providers.push(provider);
            await provider.pollNow(false);
            const windowId = 'background-window';
            const focus = await provider.handleAction({ command: 'syncHostFocus', conversationId: tr.cascadeId, windowId, focusRevision: 1, isFocusedPane: false });
            expect(focus.result?.accepted).toBe(true);
            const request = { command: 'previewHandoffV2', cascadeId: tr.cascadeId, windowId } as const;
            const original = await provider.handleAction(request);
            expect(original.ok).toBe(true);
            const oldRevision = original.result!.dataRevision;
            steps.push({ stepIndex: tr.stepCount++, type: 'CORTEX_STEP_TYPE_CHECKPOINT', checkpoint: { sessionSummary: 'New summary' } });
            await provider.pollNow(false);
            const stale = await provider.handleAction({ ...request, dataRevision: oldRevision });
            expect(stale.statusCode).toBe(409);
            const fresh = await provider.handleAction(request);
            expect(fresh.ok).toBe(true);
            expect(fresh.result!.dataRevision).toBeGreaterThan(oldRevision);
        });

        it('continues polling model calls when context and activity reads fail', async () => {
            const fetchGM = vi.fn(async () => null);
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(makeTempDir(), 'state.json'),
                autoStart: false,
                deps: createMockDeps({
                    getContextUsage: async () => { throw new Error('steps unavailable'); },
                    processActivity: async () => { throw new Error('activity unavailable'); },
                    fetchGM,
                }),
            });
            providers.push(provider);
            await provider.pollNow(false);
            expect(fetchGM).toHaveBeenCalledTimes(1);
            expect(provider.getState().latestObservation?.usedTokens).toBeNull();
        });

        it('detects rewind across polls when step count shrinks (estimated_rewind, not compaction)', async () => {
            const tmpDir = makeTempDir();
            let currentTraj = makeTrajectory({ stepCount: 15, lastModifiedTime: '2026-11-22T18:01:00.000Z' });
            let gmEntries = makeMockGeneratorMetadata();

            const provider = createSidecarRuntimeProvider({
                statePath: path.join(tmpDir, 'state-v1.json'),
                autoStart: false,
                deps: createMockDeps({
                    getAllTrajectories: async () => [currentTraj],
                    getContextUsage: async (_ls, tr) => makeUsage(tr),
                    fetchTrajectoryGeneratorMetadata: async () => gmEntries,
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            expect(provider.getState().contextBreakdown?.measurementState).toBe('measured');

            // Rewind from 15 steps down to 7 steps
            currentTraj = makeTrajectory({ stepCount: 7, lastModifiedTime: '2026-11-22T18:02:00.000Z' });
            gmEntries = [];
            await provider.pollNow(true);
            expect(provider.getState().contextBreakdown?.measurementState).toBe('estimated_rewind');
        });

        it('enforces Lock to Main Agent against subagent bursts and persists lock + pin selection', async () => {
            const tmpDir = makeTempDir();
            const statePath = path.join(tmpDir, 'state-v1.json');

            const mainTraj = makeTrajectory({
                cascadeId: 'conv-main-0001',
                summary: 'Main Feature Work',
                status: 'CASCADE_RUN_STATUS_IDLE',
                lastModifiedTime: '2026-11-22T18:00:00.000Z',
            });
            const subagentTraj = makeTrajectory({
                cascadeId: 'conv-sub-9999',
                summary: '[Subagent] Run background grep',
                status: CascadeStatus.RUNNING,
                parentCascadeId: 'conv-main-0001',
                trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT',
                lastModifiedTime: '2026-11-22T18:05:00.000Z',
            });

            const provider = createSidecarRuntimeProvider({
                statePath,
                autoStart: false,
                deps: createMockDeps({
                    trajectories: [subagentTraj, mainTraj],
                }),
            });
            providers.push(provider);

            // Auto-follow picks running subagent initially
            await provider.pollNow(true);
            expect(provider.getState().activeConversationId).toBe('conv-sub-9999');

            // Enable Lock to Main Agent -> switches to main agent & ignores subagent burst
            const lockRes = await provider.handleAction({ command: 'toggleLockMain', locked: true });
            expect(lockRes.ok).toBe(true);
            expect(provider.getState().lockToMainAgent).toBe(true);
            expect(provider.getState().activeConversationId).toBe('conv-main-0001');

            // Verify persisted to DurableState across restart
            const provider2 = createSidecarRuntimeProvider({
                statePath,
                autoStart: false,
                deps: createMockDeps({ trajectories: [subagentTraj, mainTraj] }),
            });
            providers.push(provider2);
            await provider2.pollNow(true);
            expect(provider2.getState().lockToMainAgent).toBe(true);
            expect(provider2.getState().activeConversationId).toBe('conv-main-0001');

            // Manual pin overrides lock; clearing pin returns to locked main
            const pinRes = await provider2.handleAction({ command: 'selectConversation', conversationId: 'conv-sub-9999' });
            expect(pinRes.ok).toBe(true);
            expect(provider2.getState().activeConversationId).toBe('conv-sub-9999');

            const unpinRes = await provider2.handleAction({ command: 'selectConversation', conversationId: null });
            expect(unpinRes.ok).toBe(true);
            expect(provider2.getState().pinnedConversationId).toBeNull();
            expect(provider2.getState().activeConversationId).toBe('conv-main-0001');
            // Waiting/completed conversation with valid usage MUST still render active hero context gauge (not idle empty state)
            expect(provider2.getState().monitorStatus.state).toBe('active');
            const mainHtml = await provider2.renderHtml({
                viewMode: 'aux',
                pathname: '/',
                lang: 'en',
                isSidecarEnv: true,
                version: '1.17.5',
            });
            expect(mainHtml).toContain('class="overview-session"');
            expect(mainHtml).not.toContain('No context measurement for this conversation yet.');
        });

        it('preserves cached quotas & context via StaleCacheGuard on transient RPC outage and recovers on LS rediscovery', async () => {
            const tmpDir = makeTempDir();
            let shouldFail = false;
            let currentPort = 62502;

            const provider = createSidecarRuntimeProvider({
                statePath: path.join(tmpDir, 'state-v1.json'),
                autoStart: false,
                deps: createMockDeps({
                    discoverLS: async () => (shouldFail ? null : makeMockLS({ port: currentPort })),
                    fetchFullUserStatus: async () => {
                        if (shouldFail) { throw new Error('ECONNREFUSED'); }
                        return makeMockUserStatus();
                    },
                    getAllTrajectories: async () => {
                        if (shouldFail) { throw new Error('socket hang up'); }
                        return [makeTrajectory()];
                    },
                }),
            });
            providers.push(provider);

            // Poll 1: healthy
            await provider.pollNow(true);
            expect(provider.getState().staleState.isStale).toBe(false);
            expect(provider.getState().modelConfigs).toHaveLength(2);
            expect(provider.getState().currentUsage?.contextUsed).toBe(128_000);

            // Poll 2: transient outage -> stale flag set, cached telemetry preserved (NOT blanked!)
            shouldFail = true;
            await provider.pollNow(true);
            expect(provider.getState().staleState.isStale).toBe(true);
            expect(provider.getState().staleState.lastSuccessAtMs).toBeGreaterThan(0);
            expect(provider.getState().modelConfigs).toHaveLength(2);
            expect(provider.getState().currentUsage?.contextUsed).toBe(128_000);

            // Poll 3: LS restarts on a new port -> auto-rediscovers & clears stale state
            shouldFail = false;
            currentPort = 62999;
            await provider.pollNow(true);
            expect(provider.getState().staleState.isStale).toBe(false);
            expect(provider.getState().lsInfo?.port).toBe(62999);
        });

        it('isolates custom-* / BYOK models from Google quota runway alerts', async () => {
            const tmpDir = makeTempDir();
            const customTraj = makeTrajectory({
                cascadeId: 'conv-custom-01',
                requestedModel: 'custom-deepseek-r1',
                generatorModel: 'custom-deepseek-r1',
            });
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(tmpDir, 'state-v1.json'),
                autoStart: false,
                deps: createMockDeps({
                    trajectories: [customTraj],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, {
                        model: 'custom-deepseek-r1',
                        modelDisplayName: 'custom-deepseek-r1',
                    }),
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            const st = provider.getState();
            expect(st.isCustomModelActive).toBe(true);
            for (const est of Object.values(st.quotaRunways)) {
                expect(est.status).toBe('custom_model_isolated');
            }
        });

        it('serves /, /full, snapshot and action routes and rejects retired screenshot paths', async () => {
            const tmpDir = makeTempDir();
            const statePath = path.join(tmpDir, 'state-v1.json');
            const wsDir = path.join(tmpDir, 'workspace-a');
            fs.mkdirSync(wsDir, { recursive: true });
            const wsFile = path.join(wsDir, 'README.md');
            fs.writeFileSync(wsFile, '# hello\n', 'utf8');

            const revealedCalls: Array<{ target: string; isDir: boolean }> = [];
            let clockMs = Date.parse('2026-11-22T18:10:00.000Z');

            const provider = createSidecarRuntimeProvider({
                version: '1.17.5',
                statePath,
                initialWorkspaceUris: [wsDir],
                autoStart: false,
                deps: createMockDeps({
                    now: () => clockMs,
                    revealInOs: async (target, isDir) => {
                        revealedCalls.push({ target, isDir });
                    },
                }),
            });
            providers.push(provider);

            // Seed a second cached (inactive) account snapshot via external DurableState (simulating IDE)
            const externalState = createFastDurableState(statePath);
            await externalState.globalBucket().update('accountSnapshots', [
                {
                    email: 'bob@example.com',
                    name: 'Bob Cached',
                    planName: 'Pro',
                    tierName: 'Pro',
                    earliestResetTime: '',
                    allResetTimes: [],
                    resetPools: [],
                    isActive: false,
                    lastSeen: '2026-11-21T00:00:00.000Z',
                },
            ]);
            await externalState.flush();
            await provider.pollNow(true);

            const handle = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
            servers.push(handle);

            // 1. Dead /assets/images/* route is removed and fails closed with 404
            for (const removedPath of [
                '/assets/images/monitor-overview.png',
                '/assets/images/../package.json',
                '/assets/images/%2e%2e%2fpackage.json',
                '/assets/images/Monitor-Overview.png',
                '/assets/images/sub/monitor-overview.png',
                '/assets/images/monitor-overview.svg',
                '/assets/images/does-not-exist.png',
            ]) {
                const badRes = await httpRequest(handle.url, 'GET', removedPath);
                expect(badRes.status).toBe(404);
            }

            // Unauthenticated GET /api/snapshot fails closed with 401 before pairing
            const unauthSnap = await httpRequest(handle.url, 'GET', '/api/snapshot?view=aux&lang=en&includeHtml=true');
            expect(unauthSnap.status).toBe(401);
            const { sessionToken, authHeaders } = await pairStandaloneSession(handle);

            // 2. GET /api/snapshot with view, lang, includeHtml & HTTP 304 ETag unchanged short-circuit (zero dual snapshot/data duplication)
            const snap1 = await httpRequest(handle.url, 'GET', '/api/snapshot?view=aux&lang=en&includeHtml=true', {
                headers: { 'X-Monitor-Session': sessionToken },
            });
            expect(snap1.status).toBe(200);
            const s1 = snap1.json();
            expect(s1.unchanged).toBe(false);
            expect(typeof s1.hash).toBe('string');
            expect(snap1.headers.etag).toBe(`"${s1.hash}"`);
            expect(s1.snapshot.data.usage.cascadeId).toBe('conv-main-0001');
            expect(s1).not.toHaveProperty('data');
            expect(typeof s1.html).toBe('string');
            expect(s1.html).toContain('data-acm-host-bridge="true"');

            const snap2 = await httpRequest(
                handle.url,
                'GET',
                `/api/snapshot?view=aux&lang=en&includeHtml=true&etag=${encodeURIComponent(s1.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(snap2.status).toBe(304);
            expect(snap2.text).toBe('');
            expect(snap2.headers.etag).toBe(`"${s1.hash}"`);

            // Changing includeHtml invalidates the ETag (prevents serving HTML-less 304 for includeHtml=true or vice versa)
            const snapDifferentHtmlFlag = await httpRequest(
                handle.url,
                'GET',
                `/api/snapshot?view=aux&lang=en&etag=${encodeURIComponent(s1.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(snapDifferentHtmlFlag.status).toBe(200);
            expect(snapDifferentHtmlFlag.json().unchanged).toBe(false);

            // 3. POST /api/action: copyContextReport & copyHandoffPrompt
            const ctxRep = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'copyContextReport' }),
            });
            expect(ctxRep.status).toBe(200);
            expect(ctxRep.json().ok).toBe(true);
            expect(ctxRep.json().text).toContain('Gemini 3.1 Pro');
            expect(ctxRep.json().copiedHint).toBeTruthy();

            const handoff = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'copyHandoffPrompt' }),
            });
            expect(handoff.status).toBe(200);
            expect(handoff.json().ok).toBe(true);
            // P1-11: Masked Handoff v2 omits non-allowlisted free-text title while preserving structured model/context fields
            expect(handoff.json().text).toContain('Gemini 3.1 Pro');
            expect(handoff.json().text).not.toContain('Implement Antigravity App Sidecar Runtime');

            // 4. POST /api/action: switchLanguage
            const langRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'switchLanguage', lang: 'zh' }),
            });
            expect(langRes.status).toBe(200);
            expect(langRes.json()).toMatchObject({ ok: true, reload: true, result: { language: 'zh' } });

            const badLang = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'switchLanguage', lang: 'fr' }),
            });
            expect(badLang.status).toBe(400);

            // 5. POST /api/action: updateSettings + updateSetting
            const updSettings = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({
                    command: 'updateSettings',
                    settings: {
                        pollingInterval: 10,
                        quotaNotificationThreshold: 15,
                        showModelInternalId: true,
                        uiZoom: 110,
                        showTips: false,
                        customScrollbar: true,
                    },
                }),
            });
            expect(updSettings.status).toBe(200);
            expect(updSettings.json().result.settings).toMatchObject({
                pollingInterval: 10,
                quotaNotificationThreshold: 15,
                showModelInternalId: true,
            });
            expect(updSettings.json().result.zoomLevel).toBe(110);

            // 6. POST /api/action: saveCustomPricing & resetCustomPricing
            const savePrice = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({
                    command: 'saveCustomPricing',
                    overrides: {
                        'Gemini 3.1 Pro': { input: 2.5, output: 12.0, cacheRead: 0.25, cacheWrite: 0, thinking: 12.0 },
                    },
                }),
            });
            expect(savePrice.status).toBe(200);
            expect(savePrice.json().result.customPricing['Gemini 3.1 Pro'].input).toBe(2.5);

            const resetPrice = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'resetCustomPricing' }),
            });
            expect(resetPrice.status).toBe(200);
            expect(resetPrice.json().result.customPricing).toEqual({});

            // 7. POST /api/action: selectAccount, setAccountBillingDay, removeAccountSnapshot
            // While privacy mask is ON (default), results use opaque handles with zero plaintext email leakage
            const billRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'setAccountBillingDay', email: 'alice@example.com', day: 15 }),
            });
            expect(billRes.status).toBe(200);
            const aliceHandle = billRes.json().result.accountHandle as string;
            expect(aliceHandle).toMatch(/^acct_[a-f0-9]{12}$/);
            expect(billRes.json().result.billingDays[aliceHandle]).toBe(15);
            expect(JSON.stringify(billRes.json().result)).not.toContain('alice@example.com');

            // Unmask explicitly for windowId -> plaintext account keys are returned for that window only
            const unmaskHttp = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'setPrivacyMask', windowId: 'win-http', masked: false }),
            });
            expect(unmaskHttp.status).toBe(200);

            const selAcct = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'selectAccount', windowId: 'win-http', email: 'bob@example.com' }),
            });
            expect(selAcct.status).toBe(200);
            expect(selAcct.json().result.activeAccountKey).toBe('bob@example.com');

            // Refuses removing active account
            const remActive = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'removeAccountSnapshot', windowId: 'win-http', email: 'alice@example.com' }),
            });
            expect(remActive.status).toBe(400);

            // Removes inactive cached account cleanly
            const remCached = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'removeAccountSnapshot', windowId: 'win-http', email: 'bob@example.com' }),
            });
            expect(remCached.status).toBe(200);
            expect(remCached.json().result.removed).toBe('bob@example.com');

            // 8. POST /api/action: togglePause, switchTab, refresh, revealPath (SDK-only)
            const pauseRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'togglePause', paused: true }),
            });
            expect(pauseRes.status).toBe(200);
            expect(pauseRes.json().result.paused).toBe(true);

            const tabRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'switchTab', tab: 'models' }),
            });
            expect(tabRes.status).toBe(200);
            expect(tabRes.json().messages).toEqual([{ command: 'switchToTab', tab: 'models' }]);

            clockMs += 5000;
            const refreshRes = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'refresh' }),
            });
            expect(refreshRes.status).toBe(200);
            expect(refreshRes.json().ok).toBe(true);
            expect(refreshRes.json().hash).not.toBe(s1.hash);

            // Host-privileged revealPath is blocked on standalone HTTP (403) and permitted only in SDK scope
            const revealStandaloneDenied = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'revealPath', path: wsFile }),
            });
            expect(revealStandaloneDenied.status).toBe(403);
            expect(revealedCalls).toHaveLength(0);

            const sdkHandler = createSidecarHandler(provider, { isSidecarEnv: true });
            const revealOk = await sdkHandler.handleActionPayload(
                { command: 'revealPath', path: wsFile },
                { transport: 'sdk', authScope: 'sdk' },
            );
            expect(revealOk.status).toBe(200);
            expect(revealedCalls).toHaveLength(1);
            expect(revealedCalls[0].target).toBe(fs.realpathSync(wsFile));

            // Close is idempotent
            await handle.close();
            await handle.close();
            servers.pop();
        });

        it('strictly enforces revealPath & historyAction security boundaries against traversal, symlinks, and arbitrary paths', async () => {
            const tmpDir = makeTempDir();
            const fakeHome = path.join(tmpDir, 'home');
            const agyDir = path.join(fakeHome, '.gemini', 'antigravity');
            const cfgDir = path.join(fakeHome, '.gemini', 'config');
            const stateDir = path.join(tmpDir, 'state');
            const outsideDir = path.join(tmpDir, 'outside');
            fs.mkdirSync(agyDir, { recursive: true });
            fs.mkdirSync(cfgDir, { recursive: true });
            fs.mkdirSync(stateDir, { recursive: true });
            fs.mkdirSync(outsideDir, { recursive: true });

            const insideFile = path.join(agyDir, 'note.txt');
            const outsideFile = path.join(outsideDir, 'secret.txt');
            fs.writeFileSync(insideFile, 'ok', 'utf8');
            fs.writeFileSync(outsideFile, 'secret', 'utf8');

            const escapeSymlink = path.join(agyDir, 'escape-link.txt');
            fs.symlinkSync(outsideFile, escapeSymlink);

            const allowedRoots = [agyDir, cfgDir, stateDir];

            // Allowed inside ~/.gemini/antigravity/
            expect(validateRevealTargetPath(insideFile, allowedRoots).ok).toBe(true);
            // Reject arbitrary outside path
            expect(validateRevealTargetPath(outsideFile, allowedRoots)).toMatchObject({ ok: false, statusCode: 403 });
            // Reject traversal via ..
            expect(validateRevealTargetPath(path.join(agyDir, '..', '..', '..', 'outside', 'secret.txt'), allowedRoots))
                .toMatchObject({ ok: false, statusCode: 403 });
            // Reject symlink escaping allowed root!
            expect(validateRevealTargetPath(escapeSymlink, allowedRoots))
                .toMatchObject({ ok: false, statusCode: 403 });
            // Reject non-file URI scheme & NUL byte & missing file
            expect(validateRevealTargetPath('http://127.0.0.1/test', allowedRoots)).toMatchObject({ ok: false, statusCode: 403 });
            expect(validateRevealTargetPath(`${insideFile}\0.txt`, allowedRoots)).toMatchObject({ ok: false, statusCode: 400 });
            expect(validateRevealTargetPath(path.join(agyDir, 'missing.txt'), allowedRoots)).toMatchObject({ ok: false, statusCode: 404 });

            // Verify via provider handleAction that revealInOs is NEVER invoked for rejected paths
            const revealed: string[] = [];
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(stateDir, 'state-v1.json'),
                autoStart: false,
                deps: createMockDeps({
                    homedir: () => fakeHome,
                    revealInOs: async (p) => { revealed.push(p); },
                }),
            });
            providers.push(provider);

            const badReveal = await provider.handleAction({ command: 'revealPath', path: outsideFile });
            expect(badReveal.ok).toBe(false);
            expect(badReveal.statusCode).toBe(403);

            const badHistory = await provider.handleAction({
                command: 'historyAction',
                action: 'pb',
                cascadeId: '../../etc/passwd',
            });
            expect(badHistory.ok).toBe(false);
            expect(badHistory.statusCode).toBe(400);
            expect(revealed).toHaveLength(0);
        });

        it('shares state-v1.json concurrency-safely between IDE DurableState and Sidecar runtime without clobbering', async () => {
            const tmpDir = makeTempDir();
            const sharedStatePath = path.join(tmpDir, 'state-v1.json');

            // Simulate Antigravity IDE writing language + billing day
            const ideState = createFastDurableState(sharedStatePath);
            const ideGlobal = ideState.globalBucket();
            await ideGlobal.update('displayLanguage', 'en');
            await ideGlobal.update('accountBillingDays', { 'alice@example.com': 5 });
            await ideState.flush();

            // Start Antigravity App Sidecar reading the SAME file
            const provider = createSidecarRuntimeProvider({
                statePath: sharedStatePath,
                autoStart: false,
                deps: createMockDeps(),
            });
            providers.push(provider);
            await provider.pollNow(true);

            // App updates lockToMainAgent
            await provider.handleAction({ command: 'toggleLockMain', locked: true });

            // IDE concurrently writes a new billing day and switches language to zh
            await ideGlobal.update('displayLanguage', 'zh');
            await ideGlobal.update('accountBillingDays', { 'alice@example.com': 5, 'bob@example.com': 20 });
            await ideState.flush();

            // App reloads via getSnapshot() and observes IDE's changes without losing lockToMainAgent
            // Privacy mask is ON by default -> billingDays uses opaque handles
            const maskedSnap = await provider.getSnapshot({});
            expect(maskedSnap.language).toBe('zh');
            expect(Object.values((maskedSnap.data as any).billingDays).sort((a: any, b: any) => a - b)).toEqual([5, 20]);
            expect(Object.keys((maskedSnap.data as any).billingDays).every((k: string) => /^acct_[a-f0-9]{12}$/.test(k))).toBe(true);
            expect(maskedSnap.lockToMainAgent).toBe(true);

            // Explicitly unmasking a window exposes exact synced billingDays by email for that window
            await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-sync', masked: false });
            const snap = await provider.getSnapshot({ windowId: 'win-sync' });
            expect((snap.data as any).billingDays).toMatchObject({
                'alice@example.com': 5,
                'bob@example.com': 20,
            });
        });

        it('generates enhanced host-bridge script and packages bundled allowlisted sidecar-runtime (zero legacy PNGs) cleanly', async () => {
            const script = getHostBridgeScript({ pollIntervalMs: 3000, autoPoll: true });
            expect(() => new Function(script)).not.toThrow();
            expect(script).toContain('acm:snapshot');
            expect(script).toContain('selectConversation');
            expect(script).toContain('toggleLockMain');
            expect(script).toContain('revealPath');
            expect(script).toContain('copyContextReport');
            expect(script).toContain('copyHandoffPrompt');

            const repoRoot = path.resolve(__dirname, '..');
            const distRoot = makeTempDir('acm-pkg-test-');
            const packagerMod = await import(path.join(repoRoot, 'scripts', 'package-app-plugin.mjs'));
            const packaged = packagerMod.packageAppPlugin({
                repoRoot,
                distRoot,
                includeVsix: false,
                skipValidation: true,
            });

            expect(packaged.hasSidecarRuntime).toBe(true);
            expect(packaged.bundledImages).toEqual([]);
            expect(fs.existsSync(path.join(packaged.stageDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'))).toBe(true);
            expect(fs.existsSync(path.join(packaged.stageDir, 'sidecars', 'context_monitor', 'runtime', 'src', 'images'))).toBe(false);
            expect(fs.existsSync(packaged.zipPath)).toBe(true);
            expect(fs.existsSync(packaged.tarGzPath)).toBe(true);

            // Verify packaged main.mjs boots cleanly from packaged layout, serves /api/health, excludes retired PNGs, and shuts down cleanly
            const packagedMain = path.join(packaged.stageDir, 'sidecars', 'context_monitor', 'main.mjs');
            const isolatedState = path.join(distRoot, 'isolated-state.json');
            const child = spawn(process.execPath, [packagedMain, '--standalone-port=0', '--print-url'], {
                env: {
                    ...process.env,
                    ANTIGRAVITY_SIDECAR_WEB_PORT: '',
                    ANTIGRAVITY_LS_ADDRESS: '',
                    ANTIGRAVITY_CSRF_TOKEN: '',
                    ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: isolatedState,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });

            try {
                const url = await new Promise<string>((resolveUrl, rejectUrl) => {
                    let buf = '';
                    const timer = setTimeout(() => rejectUrl(new Error('Timed out waiting for sidecar URL')), 8000);
                    child.stdout.on('data', (chunk: Buffer) => {
                        buf += chunk.toString('utf8');
                        const nl = buf.indexOf('\n');
                        if (nl >= 0) {
                            clearTimeout(timer);
                            resolveUrl(buf.slice(0, nl).trim());
                        }
                    });
                    child.once('exit', (code) => {
                        clearTimeout(timer);
                        rejectUrl(new Error(`Sidecar exited early with code ${code}`));
                    });
                });

                expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
                const health = await httpRequest(url, 'GET', '/api/health');
                expect(health.status).toBe(200);
                expect(health.json()).toMatchObject({ ok: true, surface: 'app-sidecar', mode: 'standalone' });

                const png = await httpRequest(url, 'GET', '/assets/images/monitor-overview.png');
                expect(png.status).toBe(404);
            } finally {
                child.kill('SIGTERM');
                await new Promise<void>((resolveExit) => {
                    const killer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 3000);
                    child.once('exit', () => { clearTimeout(killer); resolveExit(); });
                });
            }
        });

        it('returns 404 for removed /assets/images/* route even when imagesDir option is supplied', async () => {
            const tmpDir = makeTempDir();
            const imagesDir = path.join(tmpDir, 'images');
            fs.mkdirSync(imagesDir, { recursive: true });
            fs.writeFileSync(path.join(imagesDir, 'valid-icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

            const provider = createSidecarRuntimeProvider({
                statePath: path.join(tmpDir, 'state-v1.json'),
                autoStart: false,
                deps: createMockDeps(),
            });
            providers.push(provider);

            const handle = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1', imagesDir });
            servers.push(handle);

            const res = await httpRequest(handle.url, 'GET', '/assets/images/valid-icon.png');
            expect(res.status).toBe(404);
        });

        it('emits WCAG-compliant <title> in <head> and accessible #privacyToggle across en, zh, and both', async () => {
            const tmpDir = makeTempDir();
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(tmpDir, 'state-v1.json'),
                autoStart: false,
                deps: createMockDeps(),
            });
            providers.push(provider);
            await provider.pollNow(true);

            for (const lang of ['en', 'zh', 'both'] as const) {
                const html = await provider.renderHtml({
                    viewMode: 'sidebar',
                    pathname: '/full',
                    lang,
                    isSidecarEnv: true,
                    version: '1.17.5',
                });
                expect(html).toMatch(/<head>[\s\S]*?<title>[^<]+<\/title>[\s\S]*?<\/head>/);
                const privacyMatch = html.match(/<button[^>]*id="privacyToggle"[^>]*>/);
                expect(privacyMatch).not.toBeNull();
                expect(privacyMatch![0]).toContain('aria-pressed="true"');
                expect(privacyMatch![0]).not.toContain('aria-label=');
            }
        });
    });
});

describe('[w1b-app-runtime-hardening]', () => {
    function makeMockLS(overrides: Partial<LSInfo> = {}): LSInfo {
        return {
            pid: 7001,
            port: 62701,
            csrfToken: 'csrf-w1b',
            useTls: false,
            hostname: '127.0.0.1',
            surface: 'app',
            source: 'hub-file',
            ...overrides,
        };
    }


    function makeModelConfigs(overrides: Partial<ModelConfig>[] = []): ModelConfig[] {
        if (overrides.length > 0) {
            return overrides.map((o, idx) => ({
                model: o.model ?? `MODEL_PLACEHOLDER_M${30 + idx}`,
                label: o.label ?? `Model ${idx}`,
                supportsImages: true,
                quotaInfo: o.quotaInfo ?? {
                    remainingFraction: 0.75,
                    resetTime: '2026-11-27T21:00:00.000Z',
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 1,
                isRecommended: idx === 0,
                supportedMimeTypes: ['image/png'],
                ...o,
            }));
        }
        return [
            {
                model: 'MODEL_PLACEHOLDER_M37',
                label: 'Gemini 3.1 Pro (High)',
                supportsImages: true,
                quotaInfo: {
                    remainingFraction: 0.72,
                    resetTime: '2026-11-27T21:00:00.000Z',
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 1,
                isRecommended: true,
                supportedMimeTypes: ['image/png'],
            },
        ];
    }


    function makeSentinelUserInfo(overrides: Partial<UserStatusInfo> = {}): UserStatusInfo {
        return {
            name: 'Sentinel Secret User',
            email: 'a@sentinel-secret.example',
            planName: 'Google AI Pro',
            teamsTier: '',
            userTierId: 'tier-pro',
            userTierName: 'Pro',
            defaultModelLabel: 'Gemini 3.1 Pro (High)',
            planLimits: {
                maxNumChatInputTokens: 1_000_000,
                maxNumPremiumChatMessages: 1000,
                maxCustomChatInstructionCharacters: 10_000,
                maxNumPinnedContextItems: 50,
                maxLocalIndexSize: 10_000,
                monthlyFlexCreditPurchaseAmount: 0,
            },
            teamConfig: {
                allowMcpServers: true,
                allowAutoRunCommands: true,
                allowBrowserExperimentalFeatures: true,
            },
            availableCredits: [
                { creditType: 'GOOGLE_ONE_AI', creditAmount: 1000, minimumCreditAmountForUsage: 1 },
            ],
            canBuyMoreCredits: true,
            browserEnabled: true,
            cascadeWebSearchEnabled: true,
            knowledgeBaseEnabled: true,
            canGenerateCommitMessages: true,
            cascadeCanAutoRunCommands: true,
            canAllowCascadeInBackground: true,
            hasAutocompleteFastMode: true,
            allowStickyPremiumModels: true,
            allowPremiumCommandModels: true,
            hasTabToJump: true,
            canCustomizeAppIcon: true,
            userTierDescription: 'Pro',
            upgradeSubscriptionText: '',
            modelSortOrder: [],
            ...overrides,
        };
    }


    function makeTrajectory(overrides: Partial<TrajectorySummary> = {}): TrajectorySummary {
        return {
            cascadeId: 'conv-alpha-001',
            trajectoryId: 'traj-alpha-001',
            summary: 'Working inside /Users/sentinel/secret-proj for a@sentinel-secret.example',
            stepCount: 8,
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-27T18:00:00.000Z',
            createdTime: '2026-11-27T17:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M37',
            generatorModel: 'MODEL_PLACEHOLDER_M37',
            workspaceUris: ['file:///Users/sentinel/secret-proj'],
            lastUserInputTime: '2026-11-27T17:59:00.000Z',
            lastUserInputStepIndex: 6,
            repositoryName: 'secret-proj',
            gitOriginUrl: 'https://github.com/sentinel/secret-proj',
            branchName: 'main',
            gitRootUri: 'file:///Users/sentinel/secret-proj',
            ...overrides,
        };
    }


    function makeUsage(traj: TrajectorySummary, overrides: Partial<ContextUsage> = {}): ContextUsage {
        return {
            tokenUsageSource: 'planner',
            cascadeId: traj.cascadeId,
            title: traj.summary,
            model: traj.requestedModel || 'MODEL_PLACEHOLDER_M37',
            modelDisplayName: 'Gemini 3.1 Pro (High)',
            contextUsed: 120_000,
            totalOutputTokens: 3_000,
            totalToolCallOutputTokens: 6_000,
            contextLimit: 256_000,
            usagePercent: 46.8,
            stepCount: traj.stepCount,
            lastModifiedTime: traj.lastModifiedTime,
            status: traj.status,
            isEstimated: false,
            lastModelUsage: null,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            imageGenerationModels: [],
            imageGenerationIncomplete: false,
            imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: false,
            checkpointModel: '',
            createdTime: traj.createdTime,
            lastUserInputTime: traj.lastUserInputTime,
            lastUserInputStepIndex: traj.lastUserInputStepIndex,
            repositoryName: traj.repositoryName,
            gitOriginUrl: traj.gitOriginUrl,
            branchName: traj.branchName,
            gitRootUri: traj.gitRootUri,
            ...overrides,
        };
    }


    function makeGmSummary(
        cascadeId: string,
        opts: { email?: string; ttftSeconds?: number; streamingSeconds?: number; inputTokens?: number; outputTokens?: number } = {},
    ): GMSummary {
        const email = opts.email ?? 'a@sentinel-secret.example';
        const inTok = opts.inputTokens ?? 20_000;
        const outTok = opts.outputTokens ?? 2_000;
        return {
            conversations: [{
                cascadeId,
                title: 'Sentinel chat in /Users/sentinel/secret-proj',
                totalSteps: 8,
                coveredSteps: 8,
                coverageRate: 1,
                checkpointSummaries: [],
                calls: [{
                    callId: `${cascadeId}:1`,
                    executionId: `exec-${cascadeId}-1`,
                    model: 'MODEL_PLACEHOLDER_M37',
                    modelDisplay: 'Gemini 3.1 Pro (High)',
                    responseModel: 'gemini-3.1-pro',
                    modelAccuracy: 'exact',
                    inputTokens: inTok,
                    outputTokens: outTok,
                    thinkingTokens: 200,
                    responseTokens: outTok - 200,
                    cacheReadTokens: 10_000,
                    cacheCreationTokens: 0,
                    contextTokensUsed: 120_000,
                    credits: 5,
                    ttftSeconds: opts.ttftSeconds ?? 0.5,
                    streamingSeconds: opts.streamingSeconds ?? 2.0,
                    createdAt: '2026-11-27T17:58:00.000Z',
                    hasError: false,
                    retryErrors: [],
                    accountEmail: email,
                    toolCalls: [],
                }],
            }],
            modelBreakdown: {
                'Gemini 3.1 Pro (High)': {
                    callCount: 1,
                    totalInputTokens: inTok,
                    totalOutputTokens: outTok,
                    totalThinkingTokens: 200,
                    totalCacheRead: 10_000,
                    totalCacheCreation: 0,
                    totalCredits: 5,
                    avgTTFT: opts.ttftSeconds ?? 0.5,
                    minTTFT: opts.ttftSeconds ?? 0.5,
                    maxTTFT: opts.ttftSeconds ?? 0.5,
                    avgStreaming: opts.streamingSeconds ?? 2.0,
                    ttftSampleCount: 1,
                    streamingSampleCount: 1,
                    timedOutputTokens: outTok,
                    timedStreamingSeconds: opts.streamingSeconds ?? 2.0,
                    cacheHitCalls: 1,
                    cacheHitRate: 1,
                    errorCount: 0,
                    exactCallCount: 1,
                    placeholderOnlyCalls: 0,
                    responseModel: 'gemini-3.1-pro',
                },
            },
            totalCalls: 1,
            totalInputTokens: inTok,
            totalOutputTokens: outTok,
            totalThinkingTokens: 200,
            totalCacheRead: 10_000,
            totalCacheCreation: 0,
            totalCredits: 5,
            totalRetryCount: 0,
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            retryErrorCodes: {},
            toolCallCounts: {},
            toolCatalog: [],
            uniqueErrors: [],
            fetchedAt: Date.parse('2026-11-27T18:00:00.000Z'),
        };
    }


    describe('Wave 1B App Sidecar Runtime Hardening', () => {
        const tmpDirs: string[] = [];
        const providers: SidecarRuntimeProvider[] = [];

        function makeTempDir(prefix = 'acm-w1b-'): string {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
            tmpDirs.push(dir);
            return dir;
        }

        afterEach(async () => {
            vi.restoreAllMocks();
            while (providers.length > 0) {
                await providers.pop()!.dispose();
            }
            while (tmpDirs.length > 0) {
                fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
            }
        });

        it('renders a late worker call first in the newest 20 account-wide rows while the root stays selected', async () => {
            const root = makeTrajectory({ cascadeId: 'root-monitor' });
            const worker = makeTrajectory({ cascadeId: 'worker-monitor', parentCascadeId: root.cascadeId });
            const gm = makeGmSummary(root.cascadeId);
            const rootCalls = gm.conversations[0].calls;
            const first = rootCalls[0];
            for (let i = 1; i <= 20; i++) {
                rootCalls.push({ ...first, executionId: `root-call-${i}`, createdAt: new Date(Date.parse(first.createdAt) + i * 1000).toISOString() });
            }
            const member = makeGmSummary(worker.cascadeId).conversations[0];
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(makeTempDir(), 'state.json'),
                autoStart: false,
                deps: {
                    discoverLS: async () => makeMockLS(),
                    fetchFullUserStatus: async () => ({ configs: [], userInfo: makeSentinelUserInfo() }),
                    getAllTrajectories: async () => [root, worker],
                    getContextUsage: async (_ls, tr) => makeUsage(tr),
                    fetchTrajectoryGeneratorMetadata: async () => [],
                    fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    fetchAvailableModels: async () => null,
                    processActivity: async () => false,
                    fetchGM: async () => gm,
                },
            });
            providers.push(provider);
            await provider.pollNow(false);
            member.calls[0] = { ...first, responseModel: 'worker-model', executionId: 'worker-new', createdAt: '2026-11-27T18:05:00Z' };
            gm.conversations.push(member);
            gm.totalCalls = 22;
            await provider.pollNow(false);
            const html = await provider.renderHtml({ viewMode: 'aux', lang: 'en', pathname: '/', isSidecarEnv: true, version: 'test' });
            const ledger = html.split('id="recentCallsLedger"')[1].split('</details>')[0];
            const rows = ledger.match(/<tr data-gm-anomalies=[\s\S]*?<\/tr>/g) ?? [];
            expect(rows).toHaveLength(20);
            expect(rows[0]).toContain('worker-model');
            expect(rows[1]).toContain('root-call-20');
            expect(ledger).toContain('20 / 22');
            expect(provider.getState().activeConversationId).toBe(root.cascadeId);
        });

        describe('SEC-04 Full-Chain Sentinel Identity Privacy Redaction', () => {
            it('fixes 1-character local-part email masking bypass and replaces data-email with data-account-handle', () => {
                expect(maskEmailForDisplay('a@sentinel-secret.example')).toBe('****@sentinel-secret.example');
                expect(maskEmailForDisplay('ab@sentinel-secret.example')).toBe('****@sentinel-secret.example');
                expect(maskEmailForDisplay('secret.alice@example.com')).toBe('se****@example.com');
                expect(maskEmailForDisplay('****@redacted')).toBe('****@redacted');

                const profileHtml = buildProfileContent(
                    makeSentinelUserInfo({ name: 'Account #1', email: '****@redacted' }),
                    makeModelConfigs(),
                    15,
                    null,
                    { privacyMasked: true, accountHandle: 'acct_deadbeef1234' },
                );
                expect(profileHtml).toContain('data-account-handle="acct_deadbeef1234"');
                expect(profileHtml).not.toContain('data-email=');
                expect(profileHtml.toLowerCase()).not.toContain('sentinel');

                const popoverHtml = buildAccountStatusPanel(
                    [{
                        email: 'a@sentinel-secret.example',
                        accountHandle: 'acct_deadbeef1234',
                        name: 'Sentinel Secret User',
                        planName: 'Pro',
                        tierName: 'Pro',
                        earliestResetTime: '',
                        allResetTimes: [],
                        resetPools: [],
                        isActive: false,
                        lastSeen: '2026-11-27T18:00:00.000Z',
                    }],
                    { acct_deadbeef1234: 15 },
                    { privacyMasked: true },
                );
                expect(popoverHtml).toContain('data-account-handle="acct_deadbeef1234"');
                expect(popoverHtml).not.toContain('data-email=');
                expect(popoverHtml.toLowerCase()).not.toContain('sentinel');
            });

            it('leaks ZERO sentinel plaintext across HTML, Snapshot JSON, billing attrs, popovers, ARIA, copy, and exports while masked, and evicts cache on re-mask', async () => {
                const tmp = makeTempDir('acm-sentinel-');
                const sentinelStateDir = path.join(tmp, 'sentinel', '.gemini');
                fs.mkdirSync(sentinelStateDir, { recursive: true });
                const sentinelStatePath = path.join(sentinelStateDir, 'state-v1.json');
                // Pre-seed durable state with DailyStore record + ActivityTracker recentSteps containing sentinel secrets
                fs.writeFileSync(sentinelStatePath, JSON.stringify({
                    version: 1,
                    workspaces: {},
                    global: {
                        dailyStoreState: {
                            version: 1,
                            records: {
                                '2026-11-26': {
                                    date: '2026-11-26',
                                    cycles: [{
                                        startTime: '2026-11-26T00:00:00',
                                        endTime: '2026-11-26T23:59:59Z',
                                        totalReasoning: 5,
                                        totalToolCalls: 3,
                                        totalErrors: 1,
                                        totalInputTokens: 15_000,
                                        totalOutputTokens: 1_500,
                                        estSteps: 8,
                                        modelNames: ['Gemini 3.1 Pro (High)'],
                                        gmTotalCalls: 2,
                                        gmTotalCredits: 4,
                                        gmTotalTokens: 16_500,
                                        estimatedCost: 0.25,
                                        accountEmail: 'a@sentinel-secret.example',
                                    }],
                                },
                            },
                        },
                        activityTrackerState: {
                            version: 1,
                            warmedUp: true,
                            trajectoryBaselines: {},
                            summary: {
                                totalUserInputs: 1,
                                totalReasoning: 1,
                                totalToolCalls: 1,
                                totalErrors: 0,
                                totalCheckpoints: 0,
                                totalInputTokens: 20_000,
                                totalOutputTokens: 2_000,
                                totalToolReturnTokens: 0,
                                estSteps: 3,
                                modelStats: {},
                                globalToolStats: {},
                                sessionStartTime: '2026-11-27T17:00:00.000Z',
                                subAgentTokens: [],
                                checkpointHistory: [],
                                conversationBreakdown: [],
                                recentSteps: [{
                                    timestamp: '2026-11-27T17:58:00.000Z',
                                    icon: 'user',
                                    category: 'user',
                                    model: 'MODEL_PLACEHOLDER_M37',
                                    detail: 'Detail for a@sentinel-secret.example in /Users/sentinel/secret-proj',
                                    durationMs: 120,
                                    userInput: 'User prompt by a@sentinel-secret.example',
                                    fullUserInput: 'Full prompt inside /Users/sentinel/secret-proj for Sentinel Secret User',
                                    aiResponse: 'AI answer mentioning /Users/sentinel/secret-proj',
                                    fullAiResponse: 'Full AI answer mentioning a@sentinel-secret.example and /Users/sentinel/secret-proj',
                                    browserSub: 'Visited /Users/sentinel/secret-proj',
                                    gmPromptSnippet: 'Snippet for a@sentinel-secret.example at /Users/sentinel/secret-proj',
                                }],
                            },
                        },
                    },
                }), 'utf8');

                const sentinelTraj = makeTrajectory({
                    branchName: 'feat/sentinel-secret-branch',
                });
                const sentinelUser = makeSentinelUserInfo();
                const sentinelGm = makeGmSummary(sentinelTraj.cascadeId);
                sentinelGm.recentErrors = ['Rate limit hit for a@sentinel-secret.example in /Users/sentinel/secret-proj'];
                sentinelGm.recentErrorEntries = [{
                    code: '429',
                    message: 'Quota exceeded for a@sentinel-secret.example at /Users/sentinel/secret-proj',
                    createdAt: '2026-11-27T17:59:00.000Z',
                }];
                sentinelGm.uniqueErrors = [{
                    code: '429',
                    message: 'Unique error for Sentinel Secret User (a@sentinel-secret.example) in /Users/sentinel/secret-proj',
                    firstSeen: '2026-11-27T17:59:00.000Z',
                }];
                sentinelGm.conversations[0].calls[0].hasError = true;
                sentinelGm.conversations[0].calls[0].errorMessage = 'Call error for a@sentinel-secret.example';
                sentinelGm.conversations[0].calls[0].retryErrors = ['Retry failed in /Users/sentinel/secret-proj for a@sentinel-secret.example'];
                sentinelGm.conversations[0].calls[0].promptSnippet = 'Prompt snippet for a@sentinel-secret.example';
                const rawGmMeta: RawGeneratorMetadataEntry[] = [{
                    stepIndices: [1, 2],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M37',
                        usage: { inputTokens: 100_000, cacheReadTokens: 20_000, outputTokens: 2_000 },
                        promptSections: [
                            { title: '/Users/sentinel/secret-proj/secrets.ts', tokenType: 'TOKEN_TYPE_FILES', contentLen: 40_000 },
                        ],
                    },
                }];

                let capturedDocParams: SidecarDocumentParams | null = null;
                let statusPollCount = 0;
                const provider = createSidecarRuntimeProvider({
                    version: '1.18.0',
                    statePath: sentinelStatePath,
                    initialWorkspaceUris: ['file:///Users/sentinel/secret-proj'],
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    renderDocument: (p) => {
                        capturedDocParams = p;
                        return buildMonitorDocumentHtml(p);
                    },
                    deps: {
                        discoverLS: async () => makeMockLS(),
                        fetchFullUserStatus: async () => {
                            statusPollCount++;
                            if (statusPollCount === 1) {
                                return { ok: true, configs: makeModelConfigs(), userInfo: sentinelUser };
                            }
                            return {
                                ok: false,
                                configs: [],
                                userInfo: null,
                                error: 'Upstream 503 for a@sentinel-secret.example in /Users/sentinel/secret-proj',
                            };
                        },
                        getAllTrajectories: async () => [sentinelTraj],
                        getContextUsage: async (_ls, tr) => makeUsage(tr),
                        refreshWorkflowImageUsage: async (_ls, u) => u,
                        fetchTrajectoryGeneratorMetadata: async () => rawGmMeta,
                        fetchTrajectorySteps: async () => ({
                            ok: true,
                            steps: [{
                                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                                userInput: { userResponse: 'Inspect /Users/sentinel/secret-proj for a@sentinel-secret.example' },
                            }],
                            hasGaps: false,
                        }),
                        fetchOrchestratorSettings: async () => null,
                        fetchUserQuotaSummary: async () => null,
                        fetchAvailableModels: async () => null,
                        processActivity: async () => false,
                        fetchGM: async () => sentinelGm,
                        homedir: () => '/Users/sentinel',
                        now: () => Date.parse('2026-11-27T18:05:00.000Z'),
                    },
                });
                providers.push(provider);

                // Poll 1 succeeds, Poll 2 produces a staleState error containing sentinel strings
                await provider.pollNow(true);
                await provider.pollNow(true);

                // Set billing day using opaque handle discovered from snapshot
                const snapMasked = await provider.getSnapshot({ viewMode: 'sidebar', lang: 'en' });
                const activeHandle = (snapMasked.data as Record<string, unknown>).activeAccountKey as string;
                expect(activeHandle).toMatch(/^acct_[a-f0-9]{12}$/);

                const billRes = await provider.handleAction({
                    command: 'setAccountBillingDay',
                    accountHandle: activeHandle,
                    day: 12,
                });
                expect(billRes.ok).toBe(true);

                // Collect ALL outputs while privacy mask is ON (default)
                const html = await provider.renderHtml({
                    viewMode: 'sidebar',
                    pathname: '/full',
                    lang: 'en',
                    isSidecarEnv: true,
                    version: '1.18.0',
                });
                const snap = await provider.getSnapshot({ viewMode: 'sidebar', lang: 'en' });
                const ctxRep = await provider.handleAction({ command: 'copyContextReport' });
                const handoff = await provider.handleAction({ command: 'copyHandoffPrompt' });
                const statePathCopy = await provider.handleAction({ command: 'copyStatePath' });
                const exportCsv = await provider.handleAction({ command: 'calendarExportCsv' });
                const exportJson = await provider.handleAction({ command: 'calendarExportJson' });

                expect(capturedDocParams).not.toBeNull();
                const docParamsSnapshot = {
                    gmSummary: capturedDocParams!.gmSummary,
                    gmFullSummary: capturedDocParams!.gmFullSummary,
                    activitySummary: capturedDocParams!.activitySummary,
                    staleState: capturedDocParams!.staleState,
                    conversationOptions: capturedDocParams!.conversationOptions,
                    dailyStore: capturedDocParams!.dailyStore.serialize(),
                    dailyLedger: capturedDocParams!.dailyLedger,
                };

                // Prove the seeded private archive actually reached the projection.
                expect(docParamsSnapshot.dailyStore.records['2026-11-26'].cycles[0].gmTotalCalls).toBe(2);
                expect(docParamsSnapshot.activitySummary?.recentSteps).toHaveLength(1);

                const forbiddenNeedles = [
                    'a@sentinel-secret.example',
                    'sentinel-secret.example',
                    'sentinel-secret',
                    'Sentinel Secret User',
                    '/Users/sentinel/secret-proj',
                    '/Users/sentinel',
                    'secret-proj',
                    'data-email=',
                ];

                const surfaces: Array<[string, string]> = [
                    ['rendered HTML', html],
                    ['snapshot JSON', JSON.stringify(snap)],
                    ['SidecarDocumentParams (GM/Activity/DailyStore/DailyLedger/Stale/Options)', JSON.stringify(docParamsSnapshot)],
                    ['copyContextReport', String(ctxRep.text || '')],
                    ['copyHandoffPrompt', String(handoff.text || '')],
                    ['copyStatePath', String(statePathCopy.text || '')],
                    ['calendarExportCsv', String(exportCsv.content || '')],
                    ['calendarExportJson', String(exportJson.content || '')],
                    ['setAccountBillingDay result', JSON.stringify(billRes.result)],
                ];

                for (const [surfaceName, content] of surfaces) {
                    const lower = content.toLowerCase();
                    for (const needle of forbiddenNeedles) {
                        expect(lower, `Sentinel leak "${needle}" found in ${surfaceName}`).not.toContain(needle.toLowerCase());
                    }
                }
                expect(html).toContain(`data-account-handle="${activeHandle}"`);
                expect(html).toContain('data-privacy-masked="true"');

                // Unmask explicitly for window -> real identity appears & ETag changes
                const hashMasked = computeSnapshotHash(snap);
                const unmaskRes = await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-sec', masked: false });
                expect(unmaskRes.ok).toBe(true);
                expect(unmaskRes.messages).toContainEqual({ command: 'privacyMaskState', windowId: 'win-sec', masked: false, privacyMasked: false });
                const snapUnmasked = await provider.getSnapshot({ viewMode: 'sidebar', lang: 'en', windowId: 'win-sec' });
                expect(computeSnapshotHash(snapUnmasked)).not.toBe(hashMasked);
                expect((snapUnmasked.data as any).userInfo.email).toBe('a@sentinel-secret.example');

                // Re-mask -> evicts cached unmasked snapshot immediately with zero leakage
                const remaskRes = await provider.handleAction({ command: 'togglePrivacyMask', windowId: 'win-sec' });
                expect(remaskRes.ok).toBe(true);
                expect((remaskRes.result as any).privacyMasked).toBe(true);
                const snapRemasked = await provider.getSnapshot({ viewMode: 'sidebar', lang: 'en', windowId: 'win-sec' });
                const remaskedStr = JSON.stringify(snapRemasked).toLowerCase();
                expect(remaskedStr).not.toContain('sentinel-secret');
                expect(remaskedStr).not.toContain('/users/sentinel');
                expect(remaskedStr).not.toContain('secret-proj');
                expect(remaskedStr).not.toContain('data-email=');
            });
        });

        describe('Positive Reveal Authorization (No Denylist, No Lexical Fallback, APFS/WSL Case Rules)', () => {
            it('rejects canonicalization failure without lexical fallback, honors APFS case rules, and enforces WSL distro + POSIX case rules', () => {
                const tmp = makeTempDir('acm-reveal-');
                const rootDir = path.join(tmp, 'ActiveRoot');
                const insideFile = path.join(rootDir, 'src.ts');
                fs.mkdirSync(rootDir, { recursive: true });
                fs.writeFileSync(insideFile, 'export const ok = true;\n', 'utf8');

                // 1. Canonicalization failure on root MUST fail closed (403) — never lexical fallback
                const resCanonFail = validateRevealTargetPath(insideFile, [rootDir], 'linux', {
                    existsSync: () => true,
                    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
                    realpathSync: (p) => {
                        if (p === rootDir) { throw new Error('EACCES'); }
                        return p;
                    },
                });
                expect(resCanonFail).toMatchObject({ ok: false, statusCode: 403 });

                // 2. macOS case-sensitive APFS -> case-mismatched root MUST fail closed (403)
                const resMacSensitive = validateRevealTargetPath(
                    '/Volumes/CaseSensitive/Root/file.ts',
                    ['/Volumes/CaseSensitive/root'],
                    'darwin',
                    {
                        existsSync: () => true,
                        realpathSync: (p) => p,
                        statSync: () => ({ isFile: () => true, isDirectory: () => false }),
                        isCaseSensitivePath: () => true,
                    },
                );
                expect(resMacSensitive).toMatchObject({ ok: false, statusCode: 403 });

                // 3. macOS indeterminate case probe (`null`) -> MUST fail closed (403)
                const resMacIndeterminate = validateRevealTargetPath(
                    '/Volumes/UnknownMount/Root/file.ts',
                    ['/Volumes/UnknownMount/root'],
                    'darwin',
                    {
                        existsSync: () => true,
                        realpathSync: (p) => p,
                        statSync: () => ({ isFile: () => true, isDirectory: () => false }),
                        isCaseSensitivePath: () => null,
                    },
                );
                expect(resMacIndeterminate).toMatchObject({ ok: false, statusCode: 403 });

                // 4. macOS confirmed case-insensitive APFS (both root & target === false) -> allowed
                const resMacInsensitive = validateRevealTargetPath(
                    '/Users/Dev/Root/file.ts',
                    ['/Users/Dev/root'],
                    'darwin',
                    {
                        existsSync: () => true,
                        realpathSync: (p) => p,
                        statSync: () => ({ isFile: () => true, isDirectory: () => false }),
                        isCaseSensitivePath: () => false,
                    },
                );
                expect(resMacInsensitive.ok).toBe(true);

                // 5. WSL UNC: same distro + exact POSIX case allowed; different distro or wrong case rejected (403)
                const wslOps = {
                    existsSync: () => true,
                    realpathSync: (p: string) => p,
                    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
                };
                expect(validateRevealTargetPath(
                    '\\\\wsl$\\Ubuntu\\home\\dev\\proj\\index.ts',
                    ['\\\\wsl$\\Ubuntu\\home\\dev\\proj'],
                    'win32',
                    wslOps,
                ).ok).toBe(true);
                expect(validateRevealTargetPath(
                    '\\\\wsl$\\Debian\\home\\dev\\proj\\index.ts',
                    ['\\\\wsl$\\Ubuntu\\home\\dev\\proj'],
                    'win32',
                    wslOps,
                )).toMatchObject({ ok: false, statusCode: 403 });
                expect(validateRevealTargetPath(
                    '\\\\wsl$\\Ubuntu\\home\\dev\\Proj\\index.ts',
                    ['\\\\wsl$\\Ubuntu\\home\\dev\\proj'],
                    'win32',
                    wslOps,
                )).toMatchObject({ ok: false, statusCode: 403 });

                // 6. Non-local remote URI schemes fail closed (403)
                expect(validateRevealTargetPath(
                    'vscode-remote://ssh-remote+prod/home/dev/proj/a.ts',
                    ['/home/dev/proj'],
                    'linux',
                )).toMatchObject({ ok: false, statusCode: 403 });
            });

            it('authorizes ONLY active registered workspace roots (revokes on registerWorkspaces([]), rejects historical trajectories & swarm metadata)', async () => {
                const tmp = makeTempDir('acm-ws-pos-');
                const activeWs = path.join(tmp, 'active-ws');
                const activeWs2 = path.join(tmp, 'active-ws-2');
                const historicalWs = path.join(tmp, 'historical-ws');
                const swarmWs = path.join(tmp, 'swarm-worker-ws');
                for (const dir of [activeWs, activeWs2, historicalWs, swarmWs]) {
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, 'file.txt'), 'ok', 'utf8');
                }

                const revealed: string[] = [];
                const provider = createSidecarRuntimeProvider({
                    statePath: path.join(tmp, 'state-v1.json'),
                    initialWorkspaceUris: [activeWs],
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    deps: {
                        discoverLS: async () => makeMockLS(),
                        fetchFullUserStatus: async () => ({ ok: true, configs: makeModelConfigs(), userInfo: makeSentinelUserInfo() }),
                        getAllTrajectories: async () => [
                            makeTrajectory({
                                cascadeId: 'conv-hist-01',
                                workspaceUris: [historicalWs, swarmWs],
                                gitRootUri: historicalWs,
                            }),
                        ],
                        getContextUsage: async (_ls, tr) => makeUsage(tr),
                        refreshWorkflowImageUsage: async (_ls, u) => u,
                        fetchTrajectoryGeneratorMetadata: async () => [],
                        fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                        fetchOrchestratorSettings: async () => null,
                        fetchUserQuotaSummary: async () => null,
                        fetchAvailableModels: async () => null,
                        processActivity: async () => false,
                        fetchGM: async () => null,
                        revealInOs: async (target) => { revealed.push(target); },
                    },
                });
                providers.push(provider);

                await provider.pollNow(true);

                // Active registered workspace is allowed
                const okActive = await provider.handleAction({ command: 'revealPath', path: path.join(activeWs, 'file.txt') });
                expect(okActive.ok).toBe(true);
                expect(revealed).toHaveLength(1);

                // Historical trajectory workspace & swarm workspace MUST be rejected (403)
                const badHist = await provider.handleAction({ command: 'revealPath', path: path.join(historicalWs, 'file.txt') });
                expect(badHist).toMatchObject({ ok: false, statusCode: 403 });
                const badHistAction = await provider.handleAction({ command: 'historyAction', action: 'workspace', uri: historicalWs });
                expect(badHistAction).toMatchObject({ ok: false, statusCode: 403 });
                const badSwarm = await provider.handleAction({ command: 'revealPath', path: path.join(swarmWs, 'file.txt') });
                expect(badSwarm).toMatchObject({ ok: false, statusCode: 403 });

                // Multi-window registration + selective revoke
                await provider.handleAction({ command: 'registerWorkspaces', windowId: 'win-2', workspaceUris: [activeWs2] });
                expect((await provider.handleAction({ command: 'revealPath', path: path.join(activeWs2, 'file.txt') })).ok).toBe(false);
                expect((await provider.handleAction({ command: 'revealPath', windowId: 'win-2', path: path.join(activeWs2, 'file.txt') })).ok).toBe(true);
                await provider.handleAction({ command: 'registerWorkspaces', windowId: 'win-2', workspaceUris: [] });
                expect(await provider.handleAction({ command: 'revealPath', path: path.join(activeWs2, 'file.txt') }))
                    .toMatchObject({ ok: false, statusCode: 403 });
                // default window root still works until explicitly revoked
                expect((await provider.handleAction({ command: 'revealPath', path: path.join(activeWs, 'file.txt') })).ok).toBe(true);

                // Explicit host-wide `registerWorkspaces({ workspaceUris: [] })` revokes ALL previously registered roots!
                const revokeAll = await provider.handleAction({ command: 'registerWorkspaces', workspaceUris: [] });
                expect(revokeAll.ok).toBe(true);
                expect((revokeAll.result as any).activeWorkspaceUris).toEqual([]);
                const afterRevoke = await provider.handleAction({ command: 'revealPath', path: path.join(activeWs, 'file.txt') });
                expect(afterRevoke).toMatchObject({ ok: false, statusCode: 403 });
            });
        });

        describe('PollRpcCache (PERF-02) Wire Coalescing & Consumer Cancellation Isolation', () => {
            it('coalesces equivalent keys, isolates distinct keys, and never poisons sibling consumers on single abort', async () => {
                const cache = new PollRpcCache();
                let callCount = 0;
                let upstreamAborted = false;
                let resolveUpstream!: (v: string) => void;

                const keyA = {
                    backendEpoch: 1,
                    authority: 'http://127.0.0.1:62701:7001',
                    method: 'GetCascadeTrajectorySteps',
                    cascadeId: 'conv-1',
                    range: '0:50',
                    branchRevision: '50:t1',
                };
                const fetcher = (sig: AbortSignal) => {
                    callCount++;
                    sig.addEventListener('abort', () => { upstreamAborted = true; });
                    return new Promise<string>((resolve, reject) => {
                        sig.addEventListener('abort', () => reject(new Error('upstream aborted')));
                        resolveUpstream = resolve;
                    });
                };

                const c1 = new AbortController();
                const c2 = new AbortController();
                const p1 = cache.getOrFetch(keyA, fetcher, c1.signal);
                const p2 = cache.getOrFetch({ ...keyA }, fetcher, c2.signal);
                expect(callCount).toBe(1);

                // Consumer 1 cancels -> only Consumer 1 rejects; upstream & Consumer 2 stay healthy!
                c1.abort('consumer-1-cancelled');
                await expect(p1).rejects.toThrow();
                expect(upstreamAborted).toBe(false);

                resolveUpstream('payload-ok');
                expect(await p2).toBe('payload-ok');

                // Distinct key field (e.g. different backendEpoch or range) MUST NOT coalesce
                let callCount2 = 0;
                const pDiff = cache.getOrFetch(
                    { ...keyA, backendEpoch: 2 },
                    async () => { callCount2++; return 'epoch-2'; },
                );
                expect(await pDiff).toBe('epoch-2');
                expect(callCount2).toBe(1);

                // When ALL consumers abort, upstream aborts cleanly
                let allAbortedUpstream = false;
                const c3 = new AbortController();
                const p3 = cache.getOrFetch(
                    { ...keyA, range: '50:100' },
                    (sig) => new Promise<string>((_res, rej) => {
                        sig.addEventListener('abort', () => {
                            allAbortedUpstream = true;
                            rej(new Error('upstream cancelled'));
                        });
                    }),
                    c3.signal,
                );
                c3.abort();
                await expect(p3).rejects.toThrow();
                expect(allAbortedUpstream).toBe(true);
            });

            it('evicts non-throwing failed or gapped responses when shouldCache returns false', async () => {
                const cache = new PollRpcCache();
                let statusAttempts = 0;
                const statusKey = {
                    backendEpoch: 1,
                    authority: 'http://127.0.0.1:62701:7001',
                    method: 'GetUserStatus',
                };
                const s1 = await cache.getOrFetch(
                    statusKey,
                    async () => {
                        statusAttempts++;
                        return statusAttempts === 1 ? { ok: false, error: 'transient' } : { ok: true, data: 'fresh' };
                    },
                    undefined,
                    { shouldCache: (r) => r.ok },
                );
                expect(s1).toEqual({ ok: false, error: 'transient' });
                expect(cache.size).toBe(0);

                const s2 = await cache.getOrFetch(
                    statusKey,
                    async () => {
                        statusAttempts++;
                        return { ok: true, data: 'fresh' };
                    },
                    undefined,
                    { shouldCache: (r) => r.ok },
                );
                expect(s2).toEqual({ ok: true, data: 'fresh' });
                expect(statusAttempts).toBe(2);
                expect(cache.size).toBe(1);

                // Cached healthy response is reused without re-fetching
                const s3 = await cache.getOrFetch(
                    statusKey,
                    async () => {
                        statusAttempts++;
                        return { ok: true, data: 'should-not-run' };
                    },
                    undefined,
                    { shouldCache: (r) => r.ok },
                );
                expect(s3).toEqual({ ok: true, data: 'fresh' });
                expect(statusAttempts).toBe(2);

                // Gapped steps response is NOT cached
                let stepAttempts = 0;
                const stepsKey = { ...statusKey, method: 'GetCascadeTrajectorySteps', cascadeId: 'c1', range: '0:20' };
                const rGap = await cache.getOrFetch(
                    stepsKey,
                    async () => {
                        stepAttempts++;
                        return { ok: true, hasGaps: true, steps: [] };
                    },
                    undefined,
                    { shouldCache: (r) => r.ok && !r.hasGaps },
                );
                expect(rGap.hasGaps).toBe(true);
                const rClean = await cache.getOrFetch(
                    stepsKey,
                    async () => {
                        stepAttempts++;
                        return { ok: true, hasGaps: false, steps: [{ id: 1 }] };
                    },
                    undefined,
                    { shouldCache: (r) => r.ok && !r.hasGaps },
                );
                expect(rClean.hasGaps).toBe(false);
                expect(stepAttempts).toBe(2);
            });
        });

        describe('Generation/Epoch Guards, Commit Receipts, Focus Isolation, Freshness, Quota Null & Update Metadata', () => {
            it('ignores focus/workspace fields on GET/ping/refresh/updateSettings and enforces monotonic syncHostFocus', async () => {
                const tmp = makeTempDir('acm-focus-');
                const convA = makeTrajectory({ cascadeId: 'conv-focus-a', summary: 'Chat A' });
                const convB = makeTrajectory({
                    cascadeId: 'conv-focus-b',
                    summary: 'Chat B',
                    status: 'CASCADE_RUN_STATUS_IDLE',
                    lastModifiedTime: '2026-11-27T17:50:00.000Z',
                });

                const provider = createSidecarRuntimeProvider({
                    statePath: path.join(tmp, 'state-v1.json'),
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    deps: {
                        discoverLS: async () => makeMockLS(),
                        fetchFullUserStatus: async () => ({ ok: true, configs: makeModelConfigs(), userInfo: makeSentinelUserInfo() }),
                        getAllTrajectories: async () => [convA, convB],
                        getContextUsage: async (_ls, tr) => makeUsage(tr),
                        refreshWorkflowImageUsage: async (_ls, u) => u,
                        fetchTrajectoryGeneratorMetadata: async () => [],
                        fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                        fetchOrchestratorSettings: async () => null,
                        fetchUserQuotaSummary: async () => null,
                        fetchAvailableModels: async () => null,
                        processActivity: async () => false,
                        fetchGM: async () => null,
                    },
                });
                providers.push(provider);
                await provider.pollNow(true);
                expect(provider.getState().activeConversationId).toBe('conv-focus-a');

                // Piggybacked conversationId/workspaceUris on GET/ping/refresh/updateSettings MUST be ignored
                await provider.getSnapshot({ conversationId: 'conv-focus-b', workspaceUris: ['/tmp/sneaky'] });
                await provider.handleAction({ command: 'ping', conversationId: 'conv-focus-b', workspaceUris: ['/tmp/sneaky'] });
                await provider.handleAction({ command: 'refresh', conversationId: 'conv-focus-b', workspaceUris: ['/tmp/sneaky'] });
                await provider.handleAction({
                    command: 'updateSettings',
                    settings: { pollingInterval: 8, lastUpdateCheck: { checkedAt: 999, latestVersion: '9.9.9', assetUrl: 'https://evil.example/x.zip' } },
                    conversationId: 'conv-focus-b',
                    workspaceUris: ['/tmp/sneaky'],
                });
                expect(provider.getState().activeConversationId).toBe('conv-focus-a');
                // lastUpdateCheck was excluded from updateSettings import!
                expect(provider.getDurableState().getAppSettings().lastUpdateCheck).toBeNull();

                // Dedicated syncHostFocus accepts monotonic revisions and rejects stale revisions & epochs
                const f1 = await provider.handleAction({
                    command: 'syncHostFocus',
                    conversationId: 'conv-focus-b',
                    focusRevision: 5,
                    windowId: 'win-main',
                });
                expect(f1.ok).toBe(true);
                expect(f1.result).toMatchObject({ accepted: true, ackFocusRevision: 5, backendEpoch: 1 });
                expect(provider.getState().activeConversationId).toBe('conv-focus-b');

                // Idempotent retry of same revision & conversationId
                const f1Retry = await provider.handleAction({
                    command: 'syncHostFocus',
                    conversationId: 'conv-focus-b',
                    focusRevision: 5,
                    windowId: 'win-main',
                });
                expect(f1Retry.result).toMatchObject({ accepted: true, idempotent: true, ackFocusRevision: 5 });

                // Stale lower revision -> rejected cleanly without clobbering active focus
                const fStale = await provider.handleAction({
                    command: 'syncHostFocus',
                    conversationId: 'conv-focus-a',
                    focusRevision: 3,
                    windowId: 'win-main',
                });
                expect(fStale.ok).toBe(true);
                expect(fStale.result).toMatchObject({ accepted: false, ackFocusRevision: 5 });
                expect(provider.getState().activeConversationId).toBe('conv-focus-b');
            });

            it('guards Pin rollback so a slow failed request for B NEVER clears a newer successful selection C', async () => {
                const tmp = makeTempDir('acm-pin-race-');
                const convA = makeTrajectory({ cascadeId: 'conv-a-001', summary: 'A' });
                const convB = makeTrajectory({ cascadeId: 'conv-b-002', summary: 'B', status: 'CASCADE_RUN_STATUS_IDLE' });
                const convC = makeTrajectory({ cascadeId: 'conv-c-003', summary: 'C', status: 'CASCADE_RUN_STATUS_IDLE' });

                let rejectB!: (err: Error) => void;
                let bStarted!: () => void;
                const bStartedPromise = new Promise<void>(res => { bStarted = res; });

                const provider = createSidecarRuntimeProvider({
                    statePath: path.join(tmp, 'state-v1.json'),
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    deps: {
                        discoverLS: async () => makeMockLS(),
                        fetchFullUserStatus: async () => ({ ok: true, configs: makeModelConfigs(), userInfo: makeSentinelUserInfo() }),
                        getAllTrajectories: async () => [convA, convB, convC],
                        getContextUsage: async (_ls, tr) => {
                            if (tr.cascadeId === 'conv-b-002') {
                                bStarted();
                                return new Promise<ContextUsage>((_res, rej) => { rejectB = rej; });
                            }
                            return makeUsage(tr, { contextUsed: tr.cascadeId === 'conv-c-003' ? 99_000 : 50_000 });
                        },
                        refreshWorkflowImageUsage: async (_ls, u) => u,
                        fetchTrajectoryGeneratorMetadata: async () => [],
                        fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                        fetchOrchestratorSettings: async () => null,
                        fetchUserQuotaSummary: async () => null,
                        fetchAvailableModels: async () => null,
                        processActivity: async () => false,
                        fetchGM: async () => null,
                    },
                });
                providers.push(provider);
                await provider.pollNow(true);

                // Start slow selectConversation(B), then immediately switch to C which succeeds
                const pSelectB = provider.handleAction({ command: 'selectConversation', conversationId: 'conv-b-002' });
                await bStartedPromise;
                const resC = await provider.handleAction({ command: 'selectConversation', conversationId: 'conv-c-003' });
                expect(resC.ok).toBe(true);
                expect(provider.getState().currentUsage?.cascadeId).toBe('conv-c-003');
                expect(provider.getState().currentUsage?.contextUsed).toBe(99_000);

                // Now B's delayed RPC rejects -> MUST NOT clear C's currentUsage!
                rejectB(new Error('delayed B failure'));
                await pSelectB;
                expect(provider.getState().activeConversationId).toBe('conv-c-003');
                expect(provider.getState().currentUsage?.cascadeId).toBe('conv-c-003');
                expect(provider.getState().currentUsage?.contextUsed).toBe(99_000);
            });

            it('checks DurableState commit receipts (never emits configSaved on failed disk flush) and handles fullStatus.ok=false, source freshness, minFraction=null, and Atom-only updates', async () => {
                const tmp = makeTempDir('acm-receipt-');
                const statePath = path.join(tmp, 'state-v1.json');
                let nowMs = Date.parse('2026-11-27T18:00:00.000Z');
                let statusCall = 0;

                const unknownQuotaConfigs = makeModelConfigs([{
                    model: 'MODEL_PLACEHOLDER_M37',
                    label: 'Gemini 3.1 Pro (High)',
                    quotaInfo: { remainingFraction: Number.NaN, resetTime: '2026-11-27T21:00:00.000Z' },
                }]);

                const applyCalls: Array<Record<string, unknown>> = [];
                let checkMode: 'full' | 'atom' = 'full';
                let capturedReceiptDocParams: SidecarDocumentParams | null = null;

                const provider = createSidecarRuntimeProvider({
                    version: '1.17.11',
                    statePath,
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    renderDocument: (p) => {
                        capturedReceiptDocParams = p;
                        return buildMonitorDocumentHtml(p);
                    },
                    deps: {
                        now: () => nowMs,
                        discoverLS: async () => makeMockLS(),
                        fetchFullUserStatus: async () => {
                            statusCall++;
                            if (statusCall === 1) {
                                return { ok: true, configs: unknownQuotaConfigs, userInfo: makeSentinelUserInfo() };
                            }
                            return { ok: false, configs: [], userInfo: null, error: 'HTTP 503 user status unavailable' };
                        },
                        getAllTrajectories: async () => [makeTrajectory()],
                        getContextUsage: async (_ls, tr) => makeUsage(tr),
                        refreshWorkflowImageUsage: async (_ls, u) => u,
                        fetchTrajectoryGeneratorMetadata: async () => [],
                        fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                        fetchOrchestratorSettings: async () => null,
                        fetchUserQuotaSummary: async () => null,
                        fetchAvailableModels: async () => null,
                        processActivity: async () => false,
                        fetchGM: async () => null,
                        checkForUpdates: async () => {
                            if (checkMode === 'full') {
                                return {
                                    status: 'update_available',
                                    hasUpdate: true,
                                    currentVersion: '1.17.11',
                                    latestVersion: '1.18.0',
                                    checkedAt: nowMs,
                                    releaseInfo: {
                                        version: '1.18.0',
                                        tagName: 'v1.18.0',
                                        releaseUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.18.0',
                                        releaseNotesSummary: 'v1.18.0',
                                        assetName: 'antigravity-context-monitor-app-1.18.0.zip',
                                        assetUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/antigravity-context-monitor-app-1.18.0.zip',
                                        checksumsUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/SHA256SUMS.txt',
                                    },
                                };
                            }
                            // Atom-only fallback detects newer 1.19.0 without releaseInfo
                            return {
                                status: 'update_available',
                                hasUpdate: true,
                                currentVersion: '1.17.11',
                                latestVersion: '1.19.0',
                                checkedAt: nowMs + 1000,
                            };
                        },
                        applyAppPluginUpdate: async (opts) => {
                            applyCalls.push(opts as unknown as Record<string, unknown>);
                            return {
                                ok: true,
                                previousVersion: opts.currentVersion,
                                installedVersion: '1.19.0',
                                requiresReload: true,
                                checksumVerified: true,
                                message: 'Updated',
                            };
                        },
                    },
                });
                providers.push(provider);

                // Poll 1: all-NaN quota pool -> minFraction is null -> NEVER fabricates 100% in quotaRunways or report!
                await provider.pollNow(true);
                expect(Object.keys(provider.getState().quotaRunways)).toHaveLength(0);
                const rep = await provider.handleAction({ command: 'copyContextReport' });
                expect(String(rep.text || '')).not.toContain('100%');

                // Poll 2 (manual refresh 10s later): fullStatus returns ok: false while trajectories succeeds!
                const t1 = nowMs;
                nowMs += 10_000;
                await provider.pollNow(true);
                const stale = provider.getState().staleState;
                expect(stale.isStale).toBe(true);
                expect(stale.staleSources).toEqual(['userStatus']);
                expect(stale.sources?.userStatus.isStale).toBe(true);
                expect(stale.sources?.trajectories.isStale).toBe(false);
                // Source-specific freshness: lastSuccessAtMs reflects stale userStatus (t1), NOT fresh trajectories (t1+10s)!
                expect(stale.lastSuccessAtMs).toBe(t1);

                // Commit receipt failure: simulate failed flush -> MUST NOT emit configSaved and MUST roll back in-memory state!
                const failedReceipt = {
                    committed: false,
                    revision: 0,
                    pendingRevision: 1,
                    status: 'failed' as const,
                    error: 'ENOSPC disk full',
                    errorCode: 'ENOSPC',
                    retryScheduled: false,
                };
                const initialPollInterval = provider.getState().settings.pollingInterval;
                const initialPlan = provider.getState().settings.subscriptionPlan;
                const initialShowInternal = provider.getState().settings.showModelInternalId;

                const flushSpy = vi.spyOn(provider.getDurableState(), 'flush').mockResolvedValue(failedReceipt);

                // 1. setAppSetting rollback
                const saveFail = await provider.handleAction({ command: 'setAppSetting', key: 'pollingInterval', value: 12 });
                expect(saveFail.ok).toBe(false);
                expect(saveFail.statusCode).toBe(503);
                expect(saveFail.messages?.some(m => m.command === 'configSaved')).toBe(false);
                expect(saveFail.messages?.some(m => m.command === 'configSaveFailed')).toBe(true);
                expect(provider.getState().settings.pollingInterval).toBe(initialPollInterval);
                expect(provider.getAppSettings().pollingInterval).toBe(initialPollInterval);

                // 2. setPanelPref rollback
                const prefFail = await provider.handleAction({ command: 'setPanelPref', key: 'panelShowScrollbar', value: true });
                expect(prefFail.ok).toBe(false);
                expect(prefFail.statusCode).toBe(503);

                // 3. setPollingInterval rollback
                const pollFail = await provider.handleAction({ command: 'setPollingInterval', value: 25 });
                expect(pollFail.ok).toBe(false);
                expect(pollFail.statusCode).toBe(503);
                expect(provider.getState().settings.pollingInterval).toBe(initialPollInterval);

                // 4. setZoomLevel rollback
                const zoomFail = await provider.handleAction({ command: 'setZoomLevel', value: 145 });
                expect(zoomFail.ok).toBe(false);
                expect(zoomFail.statusCode).toBe(503);

                // 5. updateSettings rollback (multi-key batch)
                const batchFail = await provider.handleAction({
                    command: 'updateSettings',
                    settings: {
                        pollingInterval: 33,
                        subscriptionPlan: 'google-ai-pro',
                        showModelInternalId: !initialShowInternal,
                    },
                });
                expect(batchFail.ok).toBe(false);
                expect(batchFail.statusCode).toBe(503);
                expect(provider.getState().settings.pollingInterval).toBe(initialPollInterval);
                expect(provider.getState().settings.subscriptionPlan).toBe(initialPlan);
                expect(provider.getState().settings.showModelInternalId).toBe(initialShowInternal);

                const snapAfterFailedSaves = await provider.getSnapshot({ viewMode: 'aux', lang: 'en' });
                expect((snapAfterFailedSaves.data as any).settings.pollingInterval).toBe(initialPollInterval);
                expect((snapAfterFailedSaves.data as any).settings.subscriptionPlan).toBe(initialPlan);
                expect((snapAfterFailedSaves.data as any).appSettings.pollingInterval).toBe(initialPollInterval);
                await provider.renderHtml({ viewMode: 'aux', pathname: '/', lang: 'en', isSidecarEnv: true, version: '1.17.11' });
                expect(capturedReceiptDocParams).not.toBeNull();
                expect(capturedReceiptDocParams!.panelHintPrefs.showScrollbar).toBe(false);
                expect(capturedReceiptDocParams!.zoomLevel).toBe(100);
                flushSpy.mockRestore();

                // Atom-only check clears stale 1.18.0 cached releaseInfo so applyPluginUpdate re-resolves 1.19.0!
                checkMode = 'full';
                await provider.handleAction({ command: 'checkForUpdates', force: true });
                checkMode = 'atom';
                await provider.handleAction({ command: 'checkForUpdates', force: true });
                expect(provider.getDurableState().getAppSettings().lastUpdateCheck?.assetUrl).toBeNull();

                const applyRes = await provider.handleAction({ command: 'applyPluginUpdate' });
                expect(applyRes.ok).toBe(true);
                expect(applyCalls).toHaveLength(1);
                expect(applyCalls[0].reResolveRelease).toBe(true);
                expect(applyCalls[0].targetTagOrVersion).toBe('v1.19.0');
                expect(applyCalls[0].releaseInfo).toBeUndefined();
            });

            it('populates CdpOverlayPayload cascadeId/revisions without cross-conversation cost/speed fallback and invalidates ETag on GM timing changes', async () => {
                const tmp = makeTempDir('acm-etag-ov-');
                const convA = makeTrajectory({ cascadeId: 'conv-other-cost', summary: 'Other Chat' });
                const convB = makeTrajectory({
                    cascadeId: 'conv-fresh-empty',
                    summary: 'Fresh Chat',
                    status: CascadeStatus.RUNNING,
                    lastModifiedTime: '2026-11-27T18:10:00.000Z',
                });
                let gmTiming = { ttftSeconds: 0.5, streamingSeconds: 2.0 };
                let gmSummary = makeGmSummary('conv-other-cost', gmTiming);

                const provider = createSidecarRuntimeProvider({
                    statePath: path.join(tmp, 'state-v1.json'),
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    deps: {
                        discoverLS: async () => makeMockLS(),
                        fetchFullUserStatus: async () => ({ ok: true, configs: makeModelConfigs(), userInfo: makeSentinelUserInfo() }),
                        getAllTrajectories: async () => [convB, convA],
                        getContextUsage: async (_ls, tr) => makeUsage(tr),
                        refreshWorkflowImageUsage: async (_ls, u) => u,
                        fetchTrajectoryGeneratorMetadata: async () => [],
                        fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                        fetchOrchestratorSettings: async () => null,
                        fetchUserQuotaSummary: async () => null,
                        fetchAvailableModels: async () => null,
                        processActivity: async () => false,
                        fetchGM: async () => gmSummary,
                    },
                });
                providers.push(provider);
                await provider.pollNow(true);

                // conv-fresh-empty is active, while only conv-other-cost has GM calls -> ZERO cross-conversation bleed!
                const overlay = provider.buildOverlayPayload();
                expect(overlay.cascadeId).toBe('conv-fresh-empty');
                expect(typeof overlay.selectionRevision).toBe('number');
                expect(typeof overlay.dataRevision).toBe('number');
                expect(overlay.estCostUsd).toBeNull();
                expect(overlay.recentCallCount).toBeNull();
                expect(overlay.outputSpeedTps).toBeNull();

                // ETag changes when GM call timings change (ttftSeconds/streamingSeconds) even if call count/tokens are unchanged
                const snap1 = await provider.getSnapshot({ viewMode: 'aux', lang: 'en' });
                const hash1 = computeSnapshotHash(snap1);

                gmTiming = { ttftSeconds: 1.75, streamingSeconds: 4.5 };
                gmSummary = makeGmSummary('conv-other-cost', gmTiming);
                await provider.pollNow(true);
                const snap2 = await provider.getSnapshot({ viewMode: 'aux', lang: 'en' });
                expect(computeSnapshotHash(snap2)).not.toBe(hash1);
            });

            it('hydrates pre-existing persisted appSettings.lastUpdateCheck on startup without TDZ ReferenceError', async () => {
                const tmp = makeTempDir('acm-last-update-tdz-');
                const statePath = path.join(tmp, 'state-v1.json');

                // Seed a realistic pre-upgrade state-v1.json containing appSettings.lastUpdateCheck
                const seedProvider = createSidecarRuntimeProvider({
                    statePath,
                    version: '1.17.11',
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                    deps: {
                        checkForUpdates: async () => ({
                            status: 'up_to_date',
                            currentVersion: '1.17.11',
                            latestVersion: '1.17.11',
                            updateAvailable: false,
                            checkedAt: 1_764_200_000_000,
                            etag: '"v11711"',
                            releaseUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.11',
                            releaseNotesSummary: 'v1.17.11 release',
                        }),
                    },
                });
                providers.push(seedProvider);
                await seedProvider.handleAction({ command: 'checkForUpdates', force: true });
                await seedProvider.getDurableState().flush();
                seedProvider.dispose();

                // Booting a fresh v1.18.0 provider against that existing state file must NOT hit TDZ on toUpdateStatusView
                const upgradedProvider = createSidecarRuntimeProvider({
                    statePath,
                    version: '1.18.0',
                    autoStart: false,
                    disableCliScan: true,
                    enableAutoUpdateCheck: false,
                });
                providers.push(upgradedProvider);
                const snap = await upgradedProvider.getSnapshot({ viewMode: 'aux', lang: 'en' });
                const updateStatus = (snap.data as { updateStatus?: { currentVersion: string; latestVersion: string | null; status: string } }).updateStatus;
                expect(updateStatus).toBeDefined();
                expect(updateStatus?.currentVersion).toBe('1.18.0');
                expect(updateStatus?.latestVersion).toBe('1.17.11');
                expect(updateStatus?.status).toBe('up_to_date');
            });
        });
    });
});

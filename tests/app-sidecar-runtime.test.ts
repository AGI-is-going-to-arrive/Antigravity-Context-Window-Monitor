import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    createSidecarRuntimeProvider,
    renderFallbackDocumentHtml,
    validateRevealTargetPath,
    type SidecarDocumentParams,
    type SidecarRuntimeDeps,
    type SidecarRuntimeProvider,
} from '../src/app/sidecar-runtime';
import {
    startStandaloneServer,
    type StandaloneServerHandle,
} from '../src/app/sidecar-server';
import { CascadeStatus } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import { DurableState } from '../src/durable-state';
import type { FullUserStatus, ModelConfig } from '../src/models';
import type { ContextUsage, RawGeneratorMetadataEntry, TrajectorySummary } from '../src/tracker';

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
        expect(p.imagesBaseUri).toBe('/assets/images');
        expect(p.lastUpdatedTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(p.data?.cascadeId).toBe('conv-main-0001');
        expect(p.currentUsage?.cascadeId).toBe('conv-main-0001');
        expect(p.allTrajectories).toHaveLength(1);
        expect(p.userStatus.configs).toHaveLength(2);
        expect(p.userStatus.userInfo?.email).toBe('alice@example.com');
        expect(p.staleState?.isStale).toBe(false);
        expect(p.isCustomModelActive).toBe(false);

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
        expect(p.extras.imagesBaseUri).toBe('/assets/images');
        expect(p.extras.contextBreakdown).toBe(p.contextBreakdown);
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

        // Full 9-tab Studio Telemetry Ledger (NOT stub fallback)
        expect(html).toContain('data-acm-surface="app-sidecar"');
        expect(html).toContain('data-monitor-overview');
        expect(html).toContain('id="mastheadContextBar"');
        expect(html).toContain('id="conversationSwitcher"');
        expect(html).toContain('data-action="toggleLockMain"');
        expect(html).toContain('data-action="copyContextReport"');
        expect(html).toContain('data-action="copyHandoffPrompt"');
        expect(html).toContain('ctx-dot-matrix');
        expect(html).toContain('ctx-dual-cap-row');
        for (const tabId of ['overview', 'gmdata', 'chats', 'pricing', 'models', 'calendar', 'profile', 'settings', 'about']) {
            expect(html).toContain(`id="tab-${tabId}"`);
        }
        expect(html).not.toContain('acm-hero-metric');
        expect(html).toContain('data-lang="en"');

        // Strict XSS escaping for untrusted titles, prompt section names, and workspace paths
        expect(html).not.toContain('<script>alert("title-xss")</script>');
        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).not.toContain('<svg onload=alert("sec-xss")>');
        expect(html).toContain('&lt;script&gt;alert(&quot;title-xss&quot;)&lt;/script&gt;');

        // Explicit fallback renderer still works cleanly when invoked directly
        const fallbackProbe = createSidecarRuntimeProvider({
            version: '1.17.5',
            statePath: path.join(tmpDir, 'fallback-state.json'),
            autoStart: false,
            deps: createMockDeps(),
            renderDocument: (p) => {
                capturedParams = p;
                return renderFallbackDocumentHtml(p);
            },
        });
        providers.push(fallbackProbe);
        await fallbackProbe.pollNow(true);
        const fallbackHtml = await fallbackProbe.renderHtml({
            viewMode: 'sidebar',
            pathname: '/full',
            isSidecarEnv: false,
            version: '1.17.5',
        });
        expect(capturedParams).not.toBeNull();
        expect(fallbackHtml).toContain('acm-dot-grid');
        expect(fallbackHtml).toContain('acm-dual-cap');
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

    it('serves full HTTP routes: /, /full, /assets/images/*.png allowlist, ETag /api/snapshot, and ALL /api/action commands', async () => {
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
        const externalState = new DurableState(statePath);
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

        // 1. Offline PNG image allowlist & security
        const imgOk = await httpRequest(handle.url, 'GET', '/assets/images/monitor-overview.png');
        expect(imgOk.status).toBe(200);
        expect(imgOk.headers['content-type']).toBe('image/png');
        expect(imgOk.headers['cache-control']).toBe('public, max-age=3600');
        // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
        expect(imgOk.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);

        for (const badPath of [
            '/assets/images/../package.json',
            '/assets/images/%2e%2e%2fpackage.json',
            '/assets/images/Monitor-Overview.png',
            '/assets/images/sub/monitor-overview.png',
            '/assets/images/monitor-overview.svg',
            '/assets/images/does-not-exist.png',
        ]) {
            const badRes = await httpRequest(handle.url, 'GET', badPath);
            expect(badRes.status).toBe(404);
        }

        // 2. GET /api/snapshot with view, lang, includeHtml & ETag unchanged short-circuit
        const snap1 = await httpRequest(handle.url, 'GET', '/api/snapshot?view=aux&lang=en&includeHtml=true');
        expect(snap1.status).toBe(200);
        const s1 = snap1.json();
        expect(s1.unchanged).toBe(false);
        expect(typeof s1.hash).toBe('string');
        expect(s1.data.usage.cascadeId).toBe('conv-main-0001');
        expect(typeof s1.html).toBe('string');
        expect(s1.html).toContain('data-acm-host-bridge="true"');

        const snap2 = await httpRequest(
            handle.url,
            'GET',
            `/api/snapshot?view=aux&lang=en&etag=${encodeURIComponent(s1.hash)}`,
        );
        expect(snap2.status).toBe(200);
        expect(snap2.json()).toEqual({ unchanged: true, hash: s1.hash });

        // 3. POST /api/action: copyContextReport & copyHandoffPrompt
        const ctxRep = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'copyContextReport' }),
        });
        expect(ctxRep.status).toBe(200);
        expect(ctxRep.json().ok).toBe(true);
        expect(ctxRep.json().text).toContain('Gemini 3.1 Pro');
        expect(ctxRep.json().copiedHint).toBeTruthy();

        const handoff = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'copyHandoffPrompt' }),
        });
        expect(handoff.status).toBe(200);
        expect(handoff.json().ok).toBe(true);
        expect(handoff.json().text).toContain('Implement Antigravity App Sidecar Runtime');

        // 4. POST /api/action: switchLanguage
        const langRes = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'switchLanguage', lang: 'zh' }),
        });
        expect(langRes.status).toBe(200);
        expect(langRes.json()).toMatchObject({ ok: true, reload: true, result: { language: 'zh' } });

        const badLang = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'switchLanguage', lang: 'fr' }),
        });
        expect(badLang.status).toBe(400);

        // 5. POST /api/action: updateSettings + updateSetting
        const updSettings = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'resetCustomPricing' }),
        });
        expect(resetPrice.status).toBe(200);
        expect(resetPrice.json().result.customPricing).toEqual({});

        // 7. POST /api/action: selectAccount, setAccountBillingDay, removeAccountSnapshot
        const billRes = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'setAccountBillingDay', email: 'alice@example.com', day: 15 }),
        });
        expect(billRes.status).toBe(200);
        expect(billRes.json().result.billingDays['alice@example.com']).toBe(15);

        const selAcct = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'selectAccount', email: 'bob@example.com' }),
        });
        expect(selAcct.status).toBe(200);
        expect(selAcct.json().result.activeAccountKey).toBe('bob@example.com');

        // Refuses removing active account
        const remActive = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'removeAccountSnapshot', email: 'alice@example.com' }),
        });
        expect(remActive.status).toBe(400);

        // Removes inactive cached account cleanly
        const remCached = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'removeAccountSnapshot', email: 'bob@example.com' }),
        });
        expect(remCached.status).toBe(200);
        expect(remCached.json().result.removed).toBe('bob@example.com');

        // 8. POST /api/action: togglePause, switchTab, refresh, revealPath
        const pauseRes = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'togglePause', paused: true }),
        });
        expect(pauseRes.status).toBe(200);
        expect(pauseRes.json().result.paused).toBe(true);

        const tabRes = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'switchTab', tab: 'models' }),
        });
        expect(tabRes.status).toBe(200);
        expect(tabRes.json().messages).toEqual([{ command: 'switchToTab', tab: 'models' }]);

        clockMs += 5000;
        const refreshRes = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'refresh' }),
        });
        expect(refreshRes.status).toBe(200);
        expect(refreshRes.json().ok).toBe(true);
        expect(refreshRes.json().hash).not.toBe(s1.hash);

        const revealOk = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'revealPath', path: wsFile }),
        });
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
        const ideState = new DurableState(sharedStatePath);
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
        const snap = await provider.getSnapshot({});
        expect(snap.language).toBe('zh');
        expect((snap.data as any).billingDays).toMatchObject({
            'alice@example.com': 5,
            'bob@example.com': 20,
        });
        expect(snap.lockToMainAgent).toBe(true);
    });

    it('generates enhanced host-bridge script and packages sidecar-runtime + offline PNGs cleanly', async () => {
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
            skipValidation: true,
        });

        expect(packaged.hasSidecarRuntime).toBe(true);
        expect(packaged.bundledImages.length).toBeGreaterThanOrEqual(9);
        expect(fs.existsSync(path.join(packaged.stageDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'))).toBe(true);
        expect(fs.existsSync(path.join(packaged.stageDir, 'sidecars', 'context_monitor', 'runtime', 'src', 'images', 'monitor-overview.png'))).toBe(true);
        expect(fs.existsSync(packaged.zipPath)).toBe(true);
        expect(fs.existsSync(packaged.tarGzPath)).toBe(true);

        // Verify packaged main.mjs boots cleanly from packaged layout, serves /api/health & offline PNGs, and shuts down cleanly
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
            expect(png.status).toBe(200);
            expect(png.headers['content-type']).toBe('image/png');
        } finally {
            child.kill('SIGTERM');
            await new Promise<void>((resolveExit) => {
                const killer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 3000);
                child.once('exit', () => { clearTimeout(killer); resolveExit(); });
            });
        }
    });

    it('rejects symlinks inside imagesDir escaping outside the allowlisted directory', async () => {
        const tmpDir = makeTempDir();
        const imagesDir = path.join(tmpDir, 'images');
        const outsideDir = path.join(tmpDir, 'outside');
        fs.mkdirSync(imagesDir, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });

        const realPng = path.join(imagesDir, 'valid-icon.png');
        const outsideSecret = path.join(outsideDir, 'secret.png');
        fs.writeFileSync(realPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        fs.writeFileSync(outsideSecret, Buffer.from('NOT_ALLOWED'));
        fs.symlinkSync(outsideSecret, path.join(imagesDir, 'escape-icon.png'));

        const provider = createSidecarRuntimeProvider({
            statePath: path.join(tmpDir, 'state-v1.json'),
            autoStart: false,
            deps: createMockDeps(),
        });
        providers.push(provider);

        const handle = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1', imagesDir });
        servers.push(handle);

        const okRes = await httpRequest(handle.url, 'GET', '/assets/images/valid-icon.png');
        expect(okRes.status).toBe(200);
        expect(okRes.headers['content-type']).toBe('image/png');

        const escapeRes = await httpRequest(handle.url, 'GET', '/assets/images/escape-icon.png');
        expect(escapeRes.status).toBe(404);
    });
});

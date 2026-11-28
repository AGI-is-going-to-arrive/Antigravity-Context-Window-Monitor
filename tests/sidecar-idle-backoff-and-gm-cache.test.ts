import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcCallMock = vi.fn();

vi.mock('../src/rpc-client', () => ({
    rpcCall: (...args: unknown[]) => rpcCallMock(...args),
}));

import type { CdpAmbientOverlayManager } from '../src/app/cdp-injector';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    createSidecarRuntimeProvider,
    type SidecarRuntimeDeps,
    type SidecarRuntimeProvider,
} from '../src/app/sidecar-runtime';
import {
    computeSnapshotHash,
    startStandaloneServer,
    type StandaloneServerHandle,
} from '../src/app/sidecar-server';
import type { CdpStatus } from '../src/app/sidecar-types';
import type { CliDailyUsageRecord, CliUsageScanner } from '../src/cli-usage-scanner';
import { CascadeStatus } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import { GMTracker } from '../src/gm-tracker';
import type { FullUserStatus, ModelConfig, OrchestratorSettings, UserQuotaSummary } from '../src/models';
import type { ContextUsage, RawGeneratorMetadataEntry, TrajectorySummary } from '../src/tracker';

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

async function pairStandaloneSession(handle: StandaloneServerHandle): Promise<string> {
    const pairRes = await httpRequest(handle.url, 'POST', '/api/auth/pair', {
        headers: { 'Content-Type': 'application/json', Origin: handle.url },
        body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
    });
    expect(pairRes.status).toBe(200);
    return pairRes.json().sessionToken as string;
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
                resetTime: '2026-11-24T12:00:00.000Z',
            },
            allowedTiers: ['pro'],
            mimeTypeCount: 2,
            isRecommended: true,
            supportedMimeTypes: ['image/png', 'image/jpeg'],
        },
    ];
}

function makeMockUserStatus(configs = makeMockConfigs()): FullUserStatus {
    return {
        configs,
        userInfo: {
            name: 'Alice Dev',
            email: 'alice@example.com',
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
        summary: 'Sidecar Idle Backoff Fixture',
        stepCount: 6,
        status: CascadeStatus.IDLE,
        lastModifiedTime: '2026-11-22T18:00:00.000Z',
        createdTime: '2026-11-22T17:00:00.000Z',
        requestedModel: 'MODEL_PLACEHOLDER_M37',
        generatorModel: 'MODEL_PLACEHOLDER_M37',
        workspaceUris: ['file:///tmp/workspace-a'],
        lastUserInputTime: '2026-11-22T17:59:00.000Z',
        lastUserInputStepIndex: 4,
        repositoryName: 'antigravity',
        gitOriginUrl: '',
        branchName: 'main',
        gitRootUri: 'file:///tmp/workspace-a',
        ...overrides,
    };
}

function makeUsage(traj: TrajectorySummary): ContextUsage {
    return {
        tokenUsageSource: 'planner',
        cascadeId: traj.cascadeId,
        title: traj.summary,
        model: traj.requestedModel || 'MODEL_PLACEHOLDER_M37',
        modelDisplayName: 'Gemini 3.1 Pro (High)',
        contextUsed: 64_000,
        totalOutputTokens: 2_000,
        totalToolCallOutputTokens: 4_000,
        contextLimit: 256_000,
        usagePercent: 25,
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

function createMockDeps(overrides: Partial<SidecarRuntimeDeps> = {}): Partial<SidecarRuntimeDeps> {
    const ls = makeMockLS();
    const userStatus = makeMockUserStatus();
    const traj = makeTrajectory();
    const gmEntries: RawGeneratorMetadataEntry[] = [];
    const steps: Array<Record<string, unknown>> = [];

    return {
        ...overrides,
        discoverLS: overrides.discoverLS ?? (async () => ls),
        fetchFullUserStatus: overrides.fetchFullUserStatus ?? (async () => userStatus),
        getAllTrajectories: overrides.getAllTrajectories ?? (async () => [traj]),
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

describe('sidecar idle backoff and GM cache fixes', () => {
    const tmpDirs: string[] = [];
    const providers: SidecarRuntimeProvider[] = [];
    const servers: StandaloneServerHandle[] = [];

    function makeTempStatePath(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-idle-fix-'));
        tmpDirs.push(dir);
        return path.join(dir, 'state-v1.json');
    }

    beforeEach(() => {
        rpcCallMock.mockReset();
    });

    afterEach(async () => {
        vi.useRealTimers();
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

    it('1. breaks idle-backoff self-lock under passive 4s /api/snapshot polling and wakes on active=1', async () => {
        let nowMs = Date.parse('2026-11-22T18:00:00.000Z');
        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({ now: () => nowMs }),
            renderTabs: () => ({ overview: '<div>ok</div>' }),
        });
        providers.push(provider);

        const server = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
        servers.push(server);
        const sessionToken = await pairStandaloneSession(server);

        await provider.renderHtml({
            viewMode: 'aux',
            pathname: '/',
            isSidecarEnv: true,
            version: '1.17.6',
        });

        // Simulate host-bridge passive polling every 4s for 72s
        let flippedAtSec: number | null = null;
        for (let elapsedSec = 4; elapsedSec <= 72; elapsedSec += 4) {
            nowMs += 4_000;
            const res = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux', {
                headers: { 'X-Monitor-Session': sessionToken },
            });
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.unchanged).toBe(false);
            const eff = body.snapshot.meta.effectivePollIntervalMs;
            if (elapsedSec <= 60) {
                expect(eff).toBe(5000);
            } else {
                expect(eff).toBe(30000);
                if (flippedAtSec === null) {
                    flippedAtSec = elapsedSec;
                }
            }
        }
        expect(flippedAtSec).toBe(64);

        // Sending active=1 immediately restores 5000ms cadence
        const activeRes = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux&active=1', {
            headers: { 'X-Monitor-Session': sessionToken },
        });
        expect(activeRes.status).toBe(200);
        expect(activeRes.json().snapshot.meta.effectivePollIntervalMs).toBe(5000);

        // Also verify sleeping 30s pollTimer wakes up immediately when marked active
        vi.useFakeTimers();
        vi.setSystemTime(nowMs);
        let pollNowMs = nowMs;
        let trajCalls = 0;
        const autoProvider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: true,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({
                now: () => pollNowMs,
                getAllTrajectories: async () => {
                    trajCalls++;
                    return [makeTrajectory()];
                },
            }),
            renderTabs: () => ({ overview: '<div>ok</div>' }),
        });
        providers.push(autoProvider);

        // Advance past 60s idle threshold in 5s steps so timer backs off to 30s
        for (let i = 0; i < 13; i++) {
            pollNowMs += 5_000;
            await vi.advanceTimersByTimeAsync(5_000);
        }
        const callsWhenSleeping = trajCalls;
        // Advance 5s into the 30s sleep window: should not have fired yet
        pollNowMs += 5_000;
        await vi.advanceTimersByTimeAsync(5_000);
        expect(trajCalls).toBe(callsWhenSleeping);

        // User activity wakes the sleeping 30s timer back to 5s immediately
        await autoProvider.getSnapshot({ viewMode: 'aux', userActive: true });
        pollNowMs += 5_000;
        await vi.advanceTimersByTimeAsync(5_000);
        expect(trajCalls).toBeGreaterThan(callsWhenSleeping);
    });

    it('2. keeps 5s cadence while a trajectory is RUNNING even past 120s, then backs off to 30s when IDLE', async () => {
        let nowMs = Date.parse('2026-11-22T18:00:00.000Z');
        let currentStatus: CascadeStatus = CascadeStatus.RUNNING;
        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({
                now: () => nowMs,
                getAllTrajectories: async () => [makeTrajectory({ status: currentStatus })],
            }),
            renderTabs: () => ({ overview: '<div>ok</div>' }),
        });
        providers.push(provider);

        await provider.pollNow(true);
        nowMs += 120_000;

        const runningSnap = await provider.getSnapshot({ viewMode: 'aux' });
        expect(runningSnap.meta?.effectivePollIntervalMs).toBe(5000);

        currentStatus = CascadeStatus.IDLE;
        await provider.pollNow(false);

        const idleSnap = await provider.getSnapshot({ viewMode: 'aux' });
        expect(idleSnap.meta?.effectivePollIntervalMs).toBe(30000);
    });

    it('3. preserves ETag stability across pollCount increments and memoizes tab rendering (O(1))', async () => {
        const nowMs = Date.parse('2026-11-22T18:00:00.000Z');
        const renderTabsSpy = vi.fn(() => ({ overview: '<div>stable</div>', gm: '<div>gm</div>' }));
        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({ now: () => nowMs }),
            renderTabs: renderTabsSpy,
        });
        providers.push(provider);

        const server = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
        servers.push(server);
        const sessionToken = await pairStandaloneSession(server);

        await provider.pollNow(false);
        const firstRes = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux', {
            headers: { 'X-Monitor-Session': sessionToken },
        });
        expect(firstRes.status).toBe(200);
        const firstBody = firstRes.json();
        expect(firstBody.unchanged).toBe(false);
        expect(firstBody.snapshot.meta.pollCount).toBe(1);
        expect(renderTabsSpy).toHaveBeenCalledTimes(1);

        // Execute 3 more unchanged polls (pollCount: 1 -> 4)
        await provider.pollNow(false);
        await provider.pollNow(false);
        await provider.pollNow(false);
        expect(provider.getState().pollCount).toBe(4);

        const etagRes = await httpRequest(
            server.url,
            'GET',
            `/api/snapshot?view=aux&etag=${encodeURIComponent(firstBody.hash)}`,
            { headers: { 'X-Monitor-Session': sessionToken } },
        );
        expect(etagRes.status).toBe(304);
        expect(etagRes.text).toBe('');
        expect(etagRes.headers.etag).toBe(`"${firstBody.hash}"`);
        expect(renderTabsSpy).toHaveBeenCalledTimes(1);

        // Direct computeSnapshotHash check ignoring meta.pollCount
        expect(computeSnapshotHash({
            data: { x: 1 },
            meta: { pollCount: 1, effectivePollIntervalMs: 5000 },
        })).toBe(computeSnapshotHash({
            data: { x: 1 },
            meta: { pollCount: 4, effectivePollIntervalMs: 5000 },
        }));
    });

    it('4. skips redundant periodic discoverLS revalidation when lsInfo.source is "env"', async () => {
        const discoverLS = vi.fn(async () => makeMockLS({ source: 'env' }));
        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({ discoverLS }),
            renderTabs: () => ({ overview: '<div>ok</div>' }),
        });
        providers.push(provider);

        for (let i = 0; i < 10; i++) {
            await provider.pollNow(false);
        }

        expect(discoverLS).toHaveBeenCalledTimes(1);
    });

    it('5. emits host-bridge.js with effectivePollIntervalMs sync, active=1, interaction listeners, and pause guard', () => {
        const script = getHostBridgeScript();
        expect(script).toContain('effectivePollIntervalMs');
        expect(script).toContain("qs.set('active', '1')");
        expect(script).toContain('pointerdown');
        expect(script).toContain('markUserInteraction');
        expect(script).toContain('clearTimeout(pollTimer)');
        expect(script).toContain('(!forceFull && (document.hidden || pollPaused))');
    });

    it('6. GMTracker skips active idle conversation, skips redundant GetCascadeTrajectory while RUNNING, and settles after RUNNING->IDLE', async () => {
        const tracker = new GMTracker();
        const ls = makeMockLS();
        const validTs = '2026-11-22T18:00:00.000Z';
        const rawEntry = {
            executionId: 'exec-1',
            stepIndices: [1, 2],
            chatModel: {
                model: 'MODEL_PLACEHOLDER_M37',
                responseModel: 'gemini-3.1-pro',
                usage: { inputTokens: 100, outputTokens: 20 },
                chatStartMetadata: { createdAt: validTs },
            },
        };
        const trajPayload = {
            trajectory: {
                steps: [
                    { stepIndex: 0, type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { userResponse: 'hello' } },
                ],
                generatorMetadata: [
                    {
                        ...rawEntry,
                        chatModel: {
                            ...rawEntry.chatModel,
                            messagePrompts: [{ source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'hello', stepIdx: 0 }],
                        },
                    },
                ],
            },
        };

        rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string) => {
            if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                return { generatorMetadata: [rawEntry] };
            }
            if (endpoint === 'GetCascadeTrajectory') {
                return trajPayload;
            }
            return {};
        });

        // Initial fetch of current active IDLE conversation
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
            'conv-active',
        );
        expect(rpcCallMock).toHaveBeenCalledTimes(2);
        expect(rpcCallMock.mock.calls.map(c => c[1])).toEqual([
            'GetCascadeTrajectoryGeneratorMetadata',
            'GetCascadeTrajectory',
        ]);
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-active')!.calls[0].userMessageAnchors).toEqual([
            { stepIndex: 0, text: 'hello' },
        ]);

        // Next 3 polls on unchanged active IDLE conversation: 0 RPCs
        rpcCallMock.mockClear();
        for (let i = 0; i < 3; i++) {
            await tracker.fetchAll(
                ls,
                [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
                'conv-active',
            );
        }
        expect(rpcCallMock).not.toHaveBeenCalled();

        // Transition to RUNNING with unchanged stepCount: lightweight GM only, preserves userMessageAnchors (no GetCascadeTrajectory repeat)
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_RUNNING' }],
            'conv-active',
        );
        expect(rpcCallMock).toHaveBeenCalledTimes(1);
        expect(rpcCallMock.mock.calls[0][1]).toBe('GetCascadeTrajectoryGeneratorMetadata');
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-active')!.calls[0].userMessageAnchors).toEqual([
            { stepIndex: 0, text: 'hello' },
        ]);

        // Transition RUNNING -> IDLE: forces 1 trailing capture (lightweight only since enriched fields are already complete), then settles to 0 RPCs
        rpcCallMock.mockClear();
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
            'conv-active',
        );
        expect(rpcCallMock).toHaveBeenCalledTimes(1);
        expect(rpcCallMock.mock.calls[0][1]).toBe('GetCascadeTrajectoryGeneratorMetadata');
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-active')!.calls[0].userMessageAnchors).toEqual([
            { stepIndex: 0, text: 'hello' },
        ]);

        rpcCallMock.mockClear();
        for (let i = 0; i < 3; i++) {
            await tracker.fetchAll(
                ls,
                [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
                'conv-active',
            );
        }
        expect(rpcCallMock).not.toHaveBeenCalled();
    });

    it('7. settles idle conversations with empty GM or unrecoverable timestamps after 1 fetch, and re-fetches on stepCount growth', async () => {
        const tracker = new GMTracker();
        const ls = makeMockLS();

        rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string, body: { cascadeId: string }) => {
            if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                if (body.cascadeId === 'conv-empty') {
                    return { generatorMetadata: [] };
                }
                return {
                    generatorMetadata: [{
                        executionId: 'exec-no-ts',
                        stepIndices: [1],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 50, outputTokens: 10 },
                            chatStartMetadata: { createdAt: '' },
                        },
                    }],
                };
            }
            return { trajectory: { steps: [] } };
        });

        const initialTrajs = [
            { cascadeId: 'conv-empty', title: 'Empty GM', stepCount: 3, status: 'CASCADE_RUN_STATUS_IDLE' },
            { cascadeId: 'conv-bad-ts', title: 'Missing TS', stepCount: 2, status: 'CASCADE_RUN_STATUS_IDLE' },
        ];

        await tracker.fetchAll(ls, initialTrajs);
        // conv-empty: 1 lightweight RPC; conv-bad-ts: 1 lightweight + 1 enrichment RPC
        expect(rpcCallMock).toHaveBeenCalledTimes(3);

        // Next 3 unchanged polls must emit 0 RPCs
        rpcCallMock.mockClear();
        for (let i = 0; i < 3; i++) {
            await tracker.fetchAll(ls, initialTrajs);
        }
        expect(rpcCallMock).not.toHaveBeenCalled();

        // When stepCount grows, both re-fetch immediately
        await tracker.fetchAll(ls, [
            { cascadeId: 'conv-empty', title: 'Empty GM', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' },
            { cascadeId: 'conv-bad-ts', title: 'Missing TS', stepCount: 3, status: 'CASCADE_RUN_STATUS_IDLE' },
        ]);
        expect(rpcCallMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('8. applies exponential backoff on idle GMTracker RPC errors (skips 5s tick, retries after 60s)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-24T00:00:00.000Z'));

        const tracker = new GMTracker();
        const ls = makeMockLS();
        const traj = [{ cascadeId: 'conv-err', title: 'Error Idle', stepCount: 3, status: 'CASCADE_RUN_STATUS_IDLE' }];

        rpcCallMock.mockRejectedValue(new Error('transient RPC failure'));

        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).toHaveBeenCalledTimes(1);

        // 5s later: still in 60s backoff window -> skipped (0 RPCs)
        vi.advanceTimersByTime(5_000);
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).toHaveBeenCalledTimes(1);

        // 60s after failure: backoff expired -> retries once
        vi.advanceTimersByTime(55_000);
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).toHaveBeenCalledTimes(2);
    });

    it('9. caches multiple viewModes concurrently without thrashing when AUX_PANE and SIDEBAR poll together', async () => {
        const nowMs = Date.parse('2026-11-22T18:00:00.000Z');
        const renderTabsSpy = vi.fn((params: { viewMode: string }) => ({
            overview: `<div>${params.viewMode}</div>`,
        }));
        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({ now: () => nowMs }),
            renderTabs: renderTabsSpy,
        });
        providers.push(provider);

        const server = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
        servers.push(server);
        const sessionToken = await pairStandaloneSession(server);

        await provider.pollNow(false);
        const aux1Res = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux', {
            headers: { 'X-Monitor-Session': sessionToken },
        });
        const side1Res = await httpRequest(server.url, 'GET', '/api/snapshot?view=sidebar', {
            headers: { 'X-Monitor-Session': sessionToken },
        });
        expect(aux1Res.status).toBe(200);
        expect(side1Res.status).toBe(200);
        const aux1 = aux1Res.json();
        const side1 = side1Res.json();
        expect(aux1.unchanged).toBe(false);
        expect(side1.unchanged).toBe(false);
        expect(renderTabsSpy).toHaveBeenCalledTimes(2);

        // Interleave polls from both panels across unchanged backend polls: 0 re-renders (HTTP 304)
        for (let i = 0; i < 3; i++) {
            await provider.pollNow(false);
            const auxNext = await httpRequest(
                server.url,
                'GET',
                `/api/snapshot?view=aux&etag=${encodeURIComponent(aux1.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            const sideNext = await httpRequest(
                server.url,
                'GET',
                `/api/snapshot?view=sidebar&etag=${encodeURIComponent(side1.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(auxNext.status).toBe(304);
            expect(auxNext.text).toBe('');
            expect(auxNext.headers.etag).toBe(`"${aux1.hash}"`);
            expect(sideNext.status).toBe(304);
            expect(sideNext.text).toBe('');
            expect(sideNext.headers.etag).toBe(`"${side1.hash}"`);
        }
        expect(renderTabsSpy).toHaveBeenCalledTimes(2);
    });

    it('10. keeps ETag & snapshot cache stable across countdown clock ticks (countdowns stay client-side) while invalidating on real state changes', async () => {
        let nowMs = Date.parse('2026-11-22T18:00:05.000Z');
        const resetMs = Date.parse('2026-11-22T18:05:00.000Z');
        const renderTabsSpy = vi.fn((params: { now: number }) => ({
            overview: `<div>resetIn=${Math.max(0, Math.ceil((resetMs - params.now) / 60_000))}m</div>`,
        }));
        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({ now: () => nowMs }),
            renderTabs: renderTabsSpy,
        });
        providers.push(provider);

        const server = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
        servers.push(server);
        const sessionToken = await pairStandaloneSession(server);

        await provider.pollNow(false);
        const firstRes = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux', {
            headers: { 'X-Monitor-Session': sessionToken },
        });
        expect(firstRes.status).toBe(200);
        const first = firstRes.json();
        expect(first.snapshot.tabs.overview).toContain('resetIn=5m');
        expect(renderTabsSpy).toHaveBeenCalledTimes(1);

        // 25s later (same minute): cache hit + HTTP 304 ETag unchanged
        nowMs += 25_000;
        const intraMin = await httpRequest(
            server.url,
            'GET',
            `/api/snapshot?view=aux&etag=${encodeURIComponent(first.hash)}`,
            { headers: { 'X-Monitor-Session': sessionToken } },
        );
        expect(intraMin.status).toBe(304);
        expect(intraMin.text).toBe('');
        expect(intraMin.headers.etag).toBe(`"${first.hash}"`);
        expect(renderTabsSpy).toHaveBeenCalledTimes(1);

        // Cross into next minute (18:01:05) with NO data change: ETag remains stable (no server-side minuteBucket churn!)
        nowMs = Date.parse('2026-11-22T18:01:05.000Z');
        const nextMin = await httpRequest(
            server.url,
            'GET',
            `/api/snapshot?view=aux&etag=${encodeURIComponent(first.hash)}`,
            { headers: { 'X-Monitor-Session': sessionToken } },
        );
        expect(nextMin.status).toBe(304);
        expect(nextMin.text).toBe('');
        expect(nextMin.headers.etag).toBe(`"${first.hash}"`);
        expect(renderTabsSpy).toHaveBeenCalledTimes(1);

        // Real state change (e.g., privacy mask toggle) invalidates cache & ETag immediately
        await provider.handleAction({ command: 'setPrivacyMask', masked: false });
        const afterChangeRes = await httpRequest(
            server.url,
            'GET',
            `/api/snapshot?view=aux&etag=${encodeURIComponent(first.hash)}`,
            { headers: { 'X-Monitor-Session': sessionToken } },
        );
        expect(afterChangeRes.status).toBe(200);
        const afterChange = afterChangeRes.json();
        expect(afterChange.unchanged).toBe(false);
        expect(afterChange.hash).not.toBe(first.hash);
        expect(renderTabsSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('11. prevents async handleAction() cache poisoning when GET /api/snapshot runs concurrently during await', async () => {
        const nowMs = Date.parse('2026-11-22T18:00:00.000Z');
        const trajA = makeTrajectory({ cascadeId: 'conv-a', summary: 'Conversation A' });
        const trajB = makeTrajectory({ cascadeId: 'conv-b', summary: 'Conversation B', lastModifiedTime: '2026-11-22T17:55:00.000Z' });
        let resolveConvB!: (u: ContextUsage) => void;
        let resolveConvBStarted!: () => void;
        const convBStarted = new Promise<void>(resolve => {
            resolveConvBStarted = resolve;
        });

        const provider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({
                now: () => nowMs,
                getAllTrajectories: async () => [trajA, trajB],
                getContextUsage: async (_ls, tr) => {
                    if (tr.cascadeId === 'conv-b') {
                        resolveConvBStarted();
                        return new Promise<ContextUsage>(resolve => {
                            resolveConvB = resolve;
                        });
                    }
                    return makeUsage(tr);
                },
            }),
            renderTabs: (params) => ({ overview: `<div>${params.currentUsage?.cascadeId ?? 'none'}</div>` }),
        });
        providers.push(provider);

        await provider.pollNow(false);
        const before = await provider.getSnapshot({ viewMode: 'aux' });
        expect(before.activeConversationId).toBe('conv-a');
        expect((before.data as { usage: ContextUsage | null }).usage?.cascadeId).toBe('conv-a');

        // Start async selectConversation -> conv-b
        const actionPromise = provider.handleAction({
            command: 'selectConversation',
            conversationId: 'conv-b',
            viewMode: 'aux',
        });
        await convBStarted;

        // While B is loading, the snapshot must not attach the old A sample to B.
        const midFlightSnap = await provider.getSnapshot({ viewMode: 'aux' });
        expect(midFlightSnap.activeConversationId).toBe('conv-b');
        expect((midFlightSnap.data as { usage: ContextUsage | null }).usage).toBeNull();
        expect(midFlightSnap.tabs?.overview).toBe('<div>none</div>');

        // Finish conv-b telemetry fetch
        resolveConvB(makeUsage(trajB));
        const actionRes = await actionPromise;
        expect(actionRes.ok).toBe(true);
        expect((actionRes.snapshot?.data as { usage: ContextUsage | null }).usage?.cascadeId).toBe('conv-b');

        // Next passive getSnapshot MUST return conv-b (not poisoned conv-a from cache)
        const afterSnap = await provider.getSnapshot({ viewMode: 'aux' });
        expect((afterSnap.data as { usage: ContextUsage | null }).usage?.cascadeId).toBe('conv-b');
        expect(afterSnap.tabs?.overview).toBe('<div>conv-b</div>');
    });

    it('12. invalidates snapshotCache on background trajectory, credits, quotaSummary, orchestratorSettings, activity, CLI, and recheckCdp changes', async () => {
        let nowMs = Date.parse('2026-11-22T18:00:00.000Z');
        const trajMain = makeTrajectory({ cascadeId: 'conv-main', summary: 'Main' });
        let bgStatus = CascadeStatus.IDLE;
        let bgSteps = 2;
        let creditsAmount = 1000;
        let weeklyFraction = 0.8;
        let orchSettings: OrchestratorSettings | null = null;
        let activityFlag = false;
        let cliTokens = 500;
        let cdpState: CdpStatus = {
            state: 'cdp_unavailable',
            diagnosticCode: 'missing_port_file',
            composerEnabled: true,
            topBarEnabled: false,
            platformGuide: { platform: 'darwin', command: 'open', en: 'en', zh: 'zh' },
        };
        let capturedExcludePortsRef: readonly number[] | undefined;
        const recheckSpy = vi.fn(async (): Promise<CdpStatus> => {
            cdpState = {
                ...cdpState,
                state: 'connected',
                diagnosticCode: 'connected',
                targetTitle: 'Jetski Web',
                targetUrl: 'https://127.0.0.1:44444/',
                discoveredPort: 9222,
                lastInjectedAt: nowMs,
            };
            return cdpState;
        });

        const fakeOverlayManager: CdpAmbientOverlayManager & { recheck: () => Promise<CdpStatus> } = {
            getStatus: () => ({ ...cdpState }),
            setToggles: async () => ({ ...cdpState }),
            updatePayload: async () => ({ ...cdpState }),
            recheck: recheckSpy,
            dispose: async () => {},
        };

        const cliScanner = {
            scan: vi.fn(() => ({
                available: true,
                days: [{
                    date: '2026-11-22',
                    surface: 'cli' as const,
                    calls: 2,
                    sessions: 1,
                    inputTokens: cliTokens,
                    outputTokens: 100,
                    thinkingTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    totalTokens: cliTokens + 100,
                    credits: 0,
                    estimatedCost: 0.05,
                    models: {},
                } satisfies CliDailyUsageRecord],
            })),
        } as unknown as CliUsageScanner;

        const prevEnvPort = process.env.ANTIGRAVITY_SIDECAR_WEB_PORT;
        process.env.ANTIGRAVITY_SIDECAR_WEB_PORT = '55443';
        try {
            const renderTabsSpy = vi.fn(() => ({ overview: `<div>r</div>` }));
            const provider = createSidecarRuntimeProvider({
                version: '1.17.6',
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: false,
                enableAutoUpdateCheck: false,
                deps: createMockDeps({
                    now: () => nowMs,
                    getAllTrajectories: async () => [
                        trajMain,
                        makeTrajectory({
                            cascadeId: 'conv-bg',
                            summary: 'Background',
                            status: bgStatus,
                            stepCount: bgSteps,
                            lastModifiedTime: '2026-11-22T17:50:00.000Z',
                        }),
                    ],
                    fetchFullUserStatus: async () => {
                        const base = makeMockUserStatus();
                        base.userInfo!.availableCredits = [
                            { creditType: 'GOOGLE_ONE_AI', creditAmount: creditsAmount, minimumCreditAmountForUsage: 1 },
                        ];
                        return base;
                    },
                    fetchUserQuotaSummary: async (): Promise<UserQuotaSummary> => ({
                        groups: [{
                            label: 'Weekly',
                            modelIds: ['MODEL_PLACEHOLDER_M37'],
                            remainingFraction: weeklyFraction,
                            resetTime: '2026-11-29T00:00:00.000Z',
                        }],
                    } as unknown as UserQuotaSummary),
                    fetchOrchestratorSettings: async () => orchSettings,
                    processActivity: async () => {
                        const res = activityFlag;
                        activityFlag = false;
                        return res;
                    },
                    cliUsageScanner: cliScanner,
                    createCdpOverlayManager: (opts) => {
                        capturedExcludePortsRef = opts.excludeTargetPorts;
                        return fakeOverlayManager;
                    },
                }),
                renderTabs: renderTabsSpy,
            });
            providers.push(provider);

            const server = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
            servers.push(server);
            // Verify ANTIGRAVITY_SIDECAR_WEB_PORT and standalone listening port are both in excludeTargetPorts
            expect(capturedExcludePortsRef).toContain(55443);
            expect(capturedExcludePortsRef).toContain(server.port);

            // Pin main conversation so background trajectory changes don't affect active currentUsage
            await provider.pollNow(false);
            await provider.handleAction({ command: 'pinConversation', conversationId: 'conv-main' });
            await provider.getSnapshot({ viewMode: 'aux' });
            let renders = renderTabsSpy.mock.calls.length;

            // (a) Background trajectory changes status & stepCount
            bgStatus = CascadeStatus.RUNNING;
            bgSteps = 3;
            await provider.pollNow(false);
            await provider.getSnapshot({ viewMode: 'aux' });
            expect(renderTabsSpy.mock.calls.length).toBeGreaterThan(renders);
            renders = renderTabsSpy.mock.calls.length;

            // (b) Credits change on status refresh tick
            creditsAmount = 920;
            await provider.pollNow(false);
            await provider.pollNow(false); // STATUS_REFRESH_INTERVAL = 2
            await provider.getSnapshot({ viewMode: 'aux' });
            expect(renderTabsSpy.mock.calls.length).toBeGreaterThan(renders);
            renders = renderTabsSpy.mock.calls.length;

            // (c) Dual-window quotaSummary change
            weeklyFraction = 0.65;
            await provider.pollNow(false);
            await provider.pollNow(false);
            await provider.getSnapshot({ viewMode: 'aux' });
            expect(renderTabsSpy.mock.calls.length).toBeGreaterThan(renders);
            renders = renderTabsSpy.mock.calls.length;

            // (d) Orchestrator settings change
            orchSettings = { enabled: true } as unknown as OrchestratorSettings;
            await provider.pollNow(false);
            await provider.pollNow(false);
            await provider.getSnapshot({ viewMode: 'aux' });
            expect(renderTabsSpy.mock.calls.length).toBeGreaterThan(renders);
            renders = renderTabsSpy.mock.calls.length;

            // (e) Activity tracker reports activityChanged = true
            activityFlag = true;
            await provider.pollNow(false);
            await provider.getSnapshot({ viewMode: 'aux' });
            expect(renderTabsSpy.mock.calls.length).toBeGreaterThan(renders);
            renders = renderTabsSpy.mock.calls.length;

            // (f) CLI usage changes after 60s TTL (same minute bucket? advance 65s & verify CLI rescan updates signature)
            cliTokens = 2400;
            nowMs += 65_000;
            await provider.pollNow(false);
            const afterCli = await provider.getSnapshot({ viewMode: 'aux' });
            expect(cliScanner.scan).toHaveBeenCalledTimes(2);
            expect(renderTabsSpy.mock.calls.length).toBeGreaterThan(renders);
            expect(afterCli).toBeDefined();

            // (g) recheckCdp calls overlayManager.recheck(), returns updated cdpStatus in result + syncSettingsControls message
            const recheckRes = await provider.handleAction({ command: 'recheckCdp', viewMode: 'aux' });
            expect(recheckRes.ok).toBe(true);
            expect(recheckSpy).toHaveBeenCalledTimes(1);
            expect((recheckRes.result as { cdpStatus: CdpStatus }).cdpStatus.state).toBe('connected');
            expect((recheckRes.result as { cdpStatus: CdpStatus }).cdpStatus.diagnosticCode).toBe('connected');
            const syncMsg = recheckRes.messages?.find(m => m.command === 'syncSettingsControls');
            expect((syncMsg?.cdpStatus as CdpStatus)?.state).toBe('connected');
            expect(((recheckRes.snapshot?.data as { cdpStatus: CdpStatus }).cdpStatus).targetTitle).toBe('Jetski Web');
        } finally {
            if (prevEnvPort === undefined) {
                delete process.env.ANTIGRAVITY_SIDECAR_WEB_PORT;
            } else {
                process.env.ANTIGRAVITY_SIDECAR_WEB_PORT = prevEnvPort;
            }
        }
    });

    it('13. still rediscovers LS on getAllTrajectories error for source="env", and revalidates at tick 6 for source="hub-file"', async () => {
        // Case A: source="env" still recovers immediately when getAllTrajectories throws
        let envDiscoverCount = 0;
        let trajCallCount = 0;
        const envDiscover = vi.fn(async () => {
            envDiscoverCount++;
            return makeMockLS({ source: envDiscoverCount === 1 ? 'env' : 'hub-file', port: 62500 + envDiscoverCount });
        });
        const envProvider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({
                discoverLS: envDiscover,
                getAllTrajectories: async () => {
                    trajCallCount++;
                    if (trajCallCount === 3) {
                        throw new Error('ECONNREFUSED');
                    }
                    return [makeTrajectory()];
                },
            }),
            renderTabs: () => ({ overview: '<div>ok</div>' }),
        });
        providers.push(envProvider);

        await envProvider.pollNow(false);
        await envProvider.pollNow(false);
        expect(envDiscover).toHaveBeenCalledTimes(1);
        await envProvider.pollNow(false); // throws -> triggers immediate rediscovery
        expect(envDiscover).toHaveBeenCalledTimes(2);
        expect(envProvider.getState().lsInfo?.source).toBe('hub-file');

        // Case B: source="hub-file" still performs periodic revalidation at tick 6
        const hubDiscover = vi.fn(async () => makeMockLS({ source: 'hub-file' }));
        const hubProvider = createSidecarRuntimeProvider({
            version: '1.17.6',
            statePath: makeTempStatePath(),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: createMockDeps({ discoverLS: hubDiscover }),
            renderTabs: () => ({ overview: '<div>ok</div>' }),
        });
        providers.push(hubProvider);

        for (let i = 0; i < 7; i++) {
            await hubProvider.pollNow(false);
        }
        // Initial discover (poll 1) + 6th subsequent poll revalidation (poll 7)
        expect(hubDiscover).toHaveBeenCalledTimes(2);
    });

    it('14. GMTracker preserves model, responseModel, executionModel, anchors, and step-level checkpoints across lightweight refresh', async () => {
        const tracker = new GMTracker();
        const ls = makeMockLS();
        const validTs = '2026-11-22T18:00:00.000Z';
        const lightweightEntry = {
            executionId: 'exec-orch-1',
            stepIndices: [1, 2],
            chatModel: {
                model: '',
                responseModel: '',
                usage: { inputTokens: 1200, outputTokens: 250 },
                chatStartMetadata: { createdAt: validTs },
            },
        };
        const fullTrajectoryResp = {
            trajectory: {
                steps: [
                    {
                        stepIndex: 0,
                        type: 'CORTEX_STEP_TYPE_USER_INPUT',
                        userInput: {
                            userResponse: 'build feature',
                            userConfig: {
                                plannerConfig: {
                                    planModel: 'MODEL_CLAUDE_4_5_SONNET',
                                    planExecuteConfig: {
                                        executionModel: 'MODEL_GEMINI_2_5_PRO',
                                    },
                                },
                            },
                        },
                    },
                    {
                        stepIndex: 3,
                        type: 'CORTEX_STEP_TYPE_CHECKPOINT',
                        checkpoint: {
                            checkpointIndex: 1,
                            memorySummary: 'Checkpoint summary text from step',
                            userIntent: 'build feature',
                            modelUsage: { inputTokens: 800, outputTokens: 120 },
                        },
                    },
                ],
                generatorMetadata: [
                    {
                        ...lightweightEntry,
                        chatModel: {
                            ...lightweightEntry.chatModel,
                            model: 'MODEL_CLAUDE_4_5_SONNET',
                            responseModel: 'claude-sonnet-4-5',
                            messagePrompts: [
                                { source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'build feature', stepIdx: 0 },
                            ],
                        },
                    },
                ],
            },
        };

        rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string) => {
            if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                return { generatorMetadata: [lightweightEntry] };
            }
            if (endpoint === 'GetCascadeTrajectory') {
                return fullTrajectoryResp;
            }
            return {};
        });

        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-orch', title: 'Orch', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
        );
        const firstConv = tracker.getAllConversationData().find(c => c.cascadeId === 'conv-orch')!;
        expect(firstConv.calls[0].model).toBe('MODEL_CLAUDE_4_5_SONNET');
        expect(firstConv.calls[0].responseModel).toBe('claude-sonnet-4-5');
        expect(firstConv.calls[0].modelAccuracy).toBe('exact');
        expect(firstConv.calls[0].executionModel).toBe('MODEL_GEMINI_2_5_PRO');
        expect(firstConv.calls[0].userMessageAnchors).toEqual([{ stepIndex: 0, text: 'build feature' }]);
        expect(firstConv.checkpointSummaries.length).toBeGreaterThanOrEqual(1);
        expect(firstConv.systemContextItems?.some(i => i.type === 'checkpoint')).toBe(true);

        // Now lightweight refresh while RUNNING (same stepCount, lightweight omits responseModel/executionModel/messagePrompts/steps)
        rpcCallMock.mockClear();
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-orch', title: 'Orch', stepCount: 4, status: 'CASCADE_RUN_STATUS_RUNNING' }],
        );
        expect(rpcCallMock).toHaveBeenCalledTimes(1);
        expect(rpcCallMock.mock.calls[0][1]).toBe('GetCascadeTrajectoryGeneratorMetadata');

        const secondConv = tracker.getAllConversationData().find(c => c.cascadeId === 'conv-orch')!;
        expect(secondConv.calls[0].model).toBe('MODEL_CLAUDE_4_5_SONNET');
        expect(secondConv.calls[0].responseModel).toBe('claude-sonnet-4-5');
        expect(secondConv.calls[0].modelAccuracy).toBe('exact');
        expect(secondConv.calls[0].executionModel).toBe('MODEL_GEMINI_2_5_PRO');
        expect(secondConv.calls[0].userMessageAnchors).toEqual([{ stepIndex: 0, text: 'build feature' }]);
        expect(secondConv.checkpointSummaries).toEqual(firstConv.checkpointSummaries);
        expect(secondConv.systemContextItems).toEqual(firstConv.systemContextItems);
    });

    it('15. GMTracker does NOT inherit timestamps or anchors across conflicting executionIds after revert', async () => {
        const tracker = new GMTracker();
        const ls = makeMockLS();
        let phase = 1;

        rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string) => {
            if (phase === 1) {
                if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                    return {
                        generatorMetadata: [{
                            executionId: 'exec-old',
                            stepIndices: [1, 2],
                            chatModel: {
                                model: 'MODEL_PLACEHOLDER_M37',
                                responseModel: 'gemini-3.1-pro',
                                usage: { inputTokens: 100, outputTokens: 20 },
                                chatStartMetadata: { createdAt: '2026-11-20T00:00:00.000Z' },
                            },
                        }],
                    };
                }
                return {
                    trajectory: {
                        steps: [],
                        generatorMetadata: [{
                            executionId: 'exec-old',
                            stepIndices: [1, 2],
                            chatModel: {
                                model: 'MODEL_PLACEHOLDER_M37',
                                responseModel: 'gemini-3.1-pro',
                                usage: { inputTokens: 100, outputTokens: 20 },
                                chatStartMetadata: { createdAt: '2026-11-20T00:00:00.000Z' },
                                messagePrompts: [{ source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'old prompt', stepIdx: 0 }],
                            },
                        }],
                    },
                };
            }
            // Phase 2: regenerated call at same stepIndices [1,2] with NEW executionId and missing lightweight timestamp
            if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                return {
                    generatorMetadata: [{
                        executionId: 'exec-new',
                        stepIndices: [1, 2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 100, outputTokens: 20 },
                            chatStartMetadata: { createdAt: '' },
                        },
                    }],
                };
            }
            return {
                trajectory: {
                    steps: [],
                    generatorMetadata: [{
                        executionId: 'exec-new',
                        stepIndices: [1, 2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 100, outputTokens: 20 },
                            chatStartMetadata: { createdAt: '2026-11-24T12:00:00.000Z' },
                            messagePrompts: [{ source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'new prompt', stepIdx: 0 }],
                        },
                    }],
                },
            };
        });

        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-rev', title: 'Revert', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
        );

        phase = 2;
        rpcCallMock.mockClear();
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-rev', title: 'Revert', stepCount: 4, status: 'CASCADE_RUN_STATUS_RUNNING' }],
        );
        // Because exec-new != exec-old, it MUST NOT inherit old createdAt/anchors and MUST enrich
        expect(rpcCallMock.mock.calls.map(c => c[1])).toEqual([
            'GetCascadeTrajectoryGeneratorMetadata',
            'GetCascadeTrajectory',
        ]);
        const afterRevertConv = tracker.getAllConversationData().find(c => c.cascadeId === 'conv-rev')!;
        expect(afterRevertConv.calls[0].createdAt).toBe('2026-11-24T12:00:00.000Z');
        expect(afterRevertConv.calls[0].userMessageAnchors).toEqual([
            { stepIndex: 0, text: 'new prompt' },
        ]);
    });

    it('16. GMTracker runs finalized GetCascadeTrajectory on RUNNING->IDLE even when (stepCount, calls.length) stayed equal after mid-stream enrichment', async () => {
        const tracker = new GMTracker();
        const ls = makeMockLS();
        let finalized = false;

        rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string) => {
            if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                return {
                    generatorMetadata: [{
                        executionId: 'exec-stream-1',
                        stepIndices: [1, 2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 300, outputTokens: 50 },
                            chatStartMetadata: { createdAt: '' },
                        },
                    }],
                };
            }
            if (!finalized) {
                // Mid-stream: GetCascadeTrajectory returns incomplete data (missing createdAt & messagePrompts)
                return { trajectory: { steps: [], generatorMetadata: [] } };
            }
            // Finalized on RUNNING -> IDLE
            return {
                trajectory: {
                    steps: [],
                    generatorMetadata: [{
                        executionId: 'exec-stream-1',
                        stepIndices: [1, 2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 300, outputTokens: 50 },
                            chatStartMetadata: { createdAt: '2026-11-24T15:00:00.000Z' },
                            messagePrompts: [{ source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'finalized prompt', stepIdx: 0 }],
                        },
                    }],
                },
            };
        });

        // Poll 1: RUNNING at (stepCount=6, calls=1) -> mid-stream enrichment returns incomplete data
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-stream', title: 'Streaming', stepCount: 6, status: 'CASCADE_RUN_STATUS_RUNNING' }],
        );
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-stream')!.calls[0].createdAt).toBe('');
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-stream')!.calls[0].userMessageAnchors).toEqual([]);

        // Poll 2: RUNNING -> IDLE at SAME (stepCount=6, calls=1) -> MUST enrich again to capture finalized fields
        finalized = true;
        rpcCallMock.mockClear();
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-stream', title: 'Streaming', stepCount: 6, status: 'CASCADE_RUN_STATUS_IDLE' }],
        );
        expect(rpcCallMock.mock.calls.map(c => c[1])).toEqual([
            'GetCascadeTrajectoryGeneratorMetadata',
            'GetCascadeTrajectory',
        ]);
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-stream')!.calls[0].createdAt).toBe('2026-11-24T15:00:00.000Z');
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-stream')!.calls[0].userMessageAnchors).toEqual([
            { stepIndex: 0, text: 'finalized prompt' },
        ]);

        // Poll 3+: settled at 0 RPCs
        rpcCallMock.mockClear();
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-stream', title: 'Streaming', stepCount: 6, status: 'CASCADE_RUN_STATUS_IDLE' }],
        );
        expect(rpcCallMock).not.toHaveBeenCalled();
    });

    it('17. GMTracker backs off on transient GetCascadeTrajectory errors (not permanent settle) and retries immediately on clearErrorBackoff()', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-24T00:00:00.000Z'));

        const tracker = new GMTracker();
        const ls = makeMockLS();
        const traj = [{ cascadeId: 'conv-enrich-err', title: 'Enrich Fail', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }];
        const validTs = '2026-11-24T00:00:00.000Z';
        let failEnrich = true;

        rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string) => {
            if (endpoint === 'GetCascadeTrajectoryGeneratorMetadata') {
                return {
                    generatorMetadata: [{
                        executionId: 'exec-e1',
                        stepIndices: [1, 2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 100, outputTokens: 20 },
                            chatStartMetadata: { createdAt: validTs },
                        },
                    }],
                };
            }
            if (failEnrich) {
                throw new Error('transient GetCascadeTrajectory error');
            }
            return {
                trajectory: {
                    steps: [],
                    generatorMetadata: [{
                        executionId: 'exec-e1',
                        stepIndices: [1, 2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M37',
                            responseModel: 'gemini-3.1-pro',
                            usage: { inputTokens: 100, outputTokens: 20 },
                            chatStartMetadata: { createdAt: validTs },
                            messagePrompts: [{ source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'recovered prompt', stepIdx: 0 }],
                        },
                    }],
                },
            };
        });

        // Attempt 1: lightweight succeeds (even with valid createdAt!), enrichment throws -> 60s backoff
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).toHaveBeenCalledTimes(2);

        // +5s: skipped during 60s backoff
        rpcCallMock.mockClear();
        vi.advanceTimersByTime(5_000);
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).not.toHaveBeenCalled();

        // +60s total: retries even though cached call has valid createdAt; fails again -> 120s backoff
        vi.advanceTimersByTime(55_000);
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).toHaveBeenCalledTimes(2);

        // +60s into 120s backoff: still skipped
        rpcCallMock.mockClear();
        vi.advanceTimersByTime(60_000);
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).not.toHaveBeenCalled();

        // Manual refresh clears backoff -> retries immediately and enriches cleanly
        failEnrich = false;
        tracker.clearErrorBackoff();
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock.mock.calls.map(c => c[1])).toEqual([
            'GetCascadeTrajectoryGeneratorMetadata',
            'GetCascadeTrajectory',
        ]);
        expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-enrich-err')!.calls[0].userMessageAnchors).toEqual([
            { stepIndex: 0, text: 'recovered prompt' },
        ]);

        // Subsequent idle polls settle cleanly to 0 RPCs
        rpcCallMock.mockClear();
        await tracker.fetchAll(ls, traj);
        expect(rpcCallMock).not.toHaveBeenCalled();
    });

    it('18. host-bridge.js caps visible idle poll at 15s, prevents in-flight interaction clobber, wakes immediately with active=1, and retries active=1 on error', async () => {
        const script = getHostBridgeScript({ autoPoll: true, pollIntervalMs: 5000 });

        type TimerEntry = { id: number; fn: () => void; delay: number };
        const timers = new Map<number, TimerEntry>();
        let nextTimerId = 1;
        const listeners: Record<string, Array<(...args: any[]) => void>> = {};
        const fetchedUrls: string[] = [];
        const fetchQueue: Array<{
            resolve: (v: { ok: boolean; status: number; json: () => Promise<any> }) => void;
            reject: (err: Error) => void;
        }> = [];

        const mockWindow: Record<string, any> = {
            location: { pathname: '/', search: '?view=aux' },
            localStorage: { getItem: () => null, setItem: () => {} },
            addEventListener: (ev: string, cb: (...args: any[]) => void) => {
                (listeners[ev] ||= []).push(cb);
            },
            dispatchEvent: () => true,
            postMessage: () => {},
            fetch: (url: string) => {
                fetchedUrls.push(url);
                return new Promise((resolve, reject) => {
                    fetchQueue.push({ resolve, reject });
                });
            },
            matchMedia: () => ({ matches: true, addEventListener: () => {} }),
            CustomEvent: class CustomEvent { constructor(public type: string, public detail?: any) {} },
            MessageEvent: class MessageEvent { constructor(public type: string, public init?: any) {} },
            URLSearchParams,
            navigator: {},
        };
        mockWindow.window = mockWindow;

        const mockDocument = {
            hidden: false,
            documentElement: {
                style: { getPropertyValue: () => '' },
                classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
                setAttribute: () => {},
                getAttribute: () => null,
            },
            body: {
                classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
                dataset: {} as Record<string, string>,
                setAttribute: () => {},
                getAttribute: () => null,
            },
            addEventListener: () => {},
            getElementById: () => null,
            querySelectorAll: () => [],
        };

        const context = vm.createContext({
            window: mockWindow,
            document: mockDocument,
            URLSearchParams,
            Promise,
            Math,
            Number,
            String,
            Boolean,
            Array,
            Object,
            JSON,
            Error,
            setTimeout: (fn: () => void, delay: number) => {
                const id = nextTimerId++;
                timers.set(id, { id, fn, delay });
                return id;
            },
            clearTimeout: (id: number) => {
                timers.delete(id);
            },
        });
        vm.runInContext(script, context);

        const flushMicrotasks = async () => {
            for (let i = 0; i < 6; i++) {
                await Promise.resolve();
            }
        };

        // Initial poll timer should be scheduled at 5000ms
        expect([...timers.values()][0].delay).toBe(5000);

        // Fire first passive poll; server reports idle 30000ms -> client caps visible idle poll at 15000ms
        const t1 = [...timers.values()][0];
        timers.delete(t1.id);
        t1.fn();
        expect(fetchedUrls[0]).not.toContain('active=1');
        fetchQueue.shift()!.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                unchanged: false,
                hash: 'h1',
                snapshot: {
                    data: { settings: { pollingInterval: 5 } },
                    meta: { effectivePollIntervalMs: 30000 },
                },
            }),
        });
        await flushMicrotasks();
        expect([...timers.values()][0].delay).toBe(15000);

        // Start a second passive poll (in-flight). While in-flight, user interacts (pointerdown).
        const t2 = [...timers.values()][0];
        timers.delete(t2.id);
        t2.fn();
        expect(fetchedUrls[1]).not.toContain('active=1');
        for (const cb of (listeners.pointerdown || [])) { cb(); }

        // Resolve in-flight passive response with effectivePollIntervalMs: 30000 -> MUST NOT clobber pollIntervalMs
        // and MUST immediately fire a wake poll carrying active=1!
        fetchQueue.shift()!.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                unchanged: false,
                hash: 'h2',
                snapshot: {
                    data: { settings: { pollingInterval: 5 } },
                    meta: { effectivePollIntervalMs: 30000 },
                },
            }),
        });
        await flushMicrotasks();
        expect(fetchedUrls.length).toBe(3);
        expect(fetchedUrls[2]).toContain('active=1');

        // Reject the active=1 wake poll -> next retry MUST preserve active=1
        fetchQueue.shift()!.reject(new Error('network blip'));
        await flushMicrotasks();
        const t3 = [...timers.values()][0];
        timers.delete(t3.id);
        t3.fn();
        expect(fetchedUrls[3]).toContain('active=1');

        // Resolve retry and verify setPollIntervalMs updates configuredPollIntervalMs
        fetchQueue.shift()!.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                unchanged: false,
                hash: 'h3',
                snapshot: {
                    data: { settings: { pollingInterval: 5 } },
                    meta: { effectivePollIntervalMs: 5000 },
                },
            }),
        });
        await flushMicrotasks();
        mockWindow.__ACM_BRIDGE__.setPollIntervalMs(8000);
        expect([...timers.values()][0].delay).toBe(8000);
        const t4 = [...timers.values()][0];
        timers.delete(t4.id);
        t4.fn();
        fetchQueue.shift()!.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                unchanged: false,
                hash: 'h4',
                snapshot: { meta: {} },
            }),
        });
        await flushMicrotasks();
        // Because setPollIntervalMs updated configuredPollIntervalMs to 8000, snapshot without effectivePollIntervalMs keeps 8000
        expect([...timers.values()][0].delay).toBe(8000);
    });
});

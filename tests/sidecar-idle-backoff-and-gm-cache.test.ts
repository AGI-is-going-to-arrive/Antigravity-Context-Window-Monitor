import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcCallMock = vi.fn();

vi.mock('../src/rpc-client', () => ({
    rpcCall: (...args: unknown[]) => rpcCallMock(...args),
}));

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
import { CascadeStatus } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import { GMTracker } from '../src/gm-tracker';
import type { FullUserStatus, ModelConfig } from '../src/models';
import type { ContextUsage, RawGeneratorMetadataEntry, TrajectorySummary } from '../src/tracker';

interface HttpResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    text: string;
    json(): any;
}

function httpRequest(baseUrl: string, method: string, reqPath: string): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const url = new URL(reqPath, baseUrl);
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
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
            const res = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux');
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
        const activeRes = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux&active=1');
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

        await provider.pollNow(false);
        const firstRes = await httpRequest(server.url, 'GET', '/api/snapshot?view=aux');
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
        );
        expect(etagRes.status).toBe(200);
        expect(etagRes.json()).toEqual({ unchanged: true, hash: firstBody.hash });
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
                            messagePrompts: [{ source: 'USER', text: 'hello', stepIdx: 0 }],
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

        // Transition to RUNNING with unchanged stepCount: lightweight GM only, no GetCascadeTrajectory repeat
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_RUNNING' }],
            'conv-active',
        );
        expect(rpcCallMock).toHaveBeenCalledTimes(1);
        expect(rpcCallMock.mock.calls[0][1]).toBe('GetCascadeTrajectoryGeneratorMetadata');

        // Transition RUNNING -> IDLE: forces 1 trailing capture, then subsequent polls settle to 0 RPCs
        rpcCallMock.mockClear();
        await tracker.fetchAll(
            ls,
            [{ cascadeId: 'conv-active', title: 'Active Idle', stepCount: 4, status: 'CASCADE_RUN_STATUS_IDLE' }],
            'conv-active',
        );
        expect(rpcCallMock).toHaveBeenCalledTimes(1);
        expect(rpcCallMock.mock.calls[0][1]).toBe('GetCascadeTrajectoryGeneratorMetadata');

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
});

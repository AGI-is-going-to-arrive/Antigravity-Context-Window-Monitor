// Consolidated Domain Suite: RPC Tracker Accuracy, Steps Pagination & Conversation Selector
import * as http from 'http';
import type { AddressInfo } from 'net';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    DEFAULT_SWARM_POLL_BUDGET,
    getTrajectoryPollBudgetSnapshot,
    withTrajectoryPollBudget,
    withTrajectoryRequestShare,
} from '../src/core/swarm-registry';
import { CascadeStatus, StepType } from '../src/constants';
import type { LSInfo } from '../src/discovery';
import type { ModelConfig } from '../src/models';
import { MonitorStore } from '../src/monitor-store';
import {
    decodeConnectFirstFrame,
    destroyRpcAgents,
    getRpcAgent,
    resolveLoopbackRpcHostname,
    redactRpcErrorExcerpt,
    rpcCall,
    rpcStreamFirstFrame,
} from '../src/rpc-client';
import {
    fetchFullUserStatus,
    fetchTrajectoryGeneratorMetadata,
    fetchTrajectoryGeneratorMetadataResult,
    fetchTrajectorySteps,
    getContextUsage,
    getTrajectoryTokenUsage,
    normalizeUri,
    processSteps,
} from '../src/tracker';
import { comparePoolResetTimes, groupModelConfigsByQuotaPool, parsePositivePoolResetMs } from '../src/pool-utils';
import { computeGMCallFingerprint, GM_FETCH_CONCURRENCY, GMTracker } from '../src/gm/tracker';
import type { GMCallEntry, GMConversationData } from '../src/gm/types';
import { classifyPromptCacheState, computeCallTelemetry, computeTelemetryAggregate } from '../src/telemetry-metrics';
import { analyzeTurnDiagnostics, classifyPromptCacheState as classifyPromptCacheStateFromTurnDiag, classifyTurnStartKind } from '../src/turn-diagnostics';
import {
    buildConversationOptions,
    type ConversationTrajectoryLike,
    detectPathCaseSensitivity,
    filterTrajectoriesByWorkspaces,
    isSubagentTrajectory,
    matchesAnyWorkspace,
    normalizeWorkspaceUri,
    resetPathCaseSensitivityCache,
    resolveIdeAutoFollowConversation,
    resolveTargetConversation,
} from '../src/conversation-selector';

describe('[rpc-tracker-accuracy]', () => {
    // ─── Helpers ─────────────────────────────────────────────────────────────────

    async function withHttpServer(
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
        fn: (ls: LSInfo, server: http.Server) => Promise<void>,
    ): Promise<void> {
        const server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const port = (server.address() as AddressInfo).port;
        const ls: LSInfo = { pid: 1, port, csrfToken: 'test-csrf', useTls: false };
        try {
            await fn(ls, server);
        } finally {
            destroyRpcAgents();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    }


    function makeModelConfig(
        model: string,
        label: string,
        remainingFraction: number,
        resetTime = '2026-11-28T00:00:00Z',
    ): ModelConfig {
        return {
            model,
            label,
            supportsImages: false,
            quotaInfo: { remainingFraction, resetTime },
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
        };
    }


    function makeGMCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-1',
            model: 'MODEL_PLACEHOLDER_M532',
            modelDisplay: 'Gemini 4 Neon (High)',
            responseModel: 'gemini-4-neon-high',
            modelAccuracy: 'exact',
            inputTokens: 1000,
            outputTokens: 200,
            thinkingTokens: 0,
            responseTokens: 200,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_GOOGLE',
            ttftSeconds: 0.5,
            streamingSeconds: 1.5,
            credits: 0,
            creditType: '',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 1200,
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
            stopReason: 'STOP_REASON_END_TURN',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: new Date().toISOString(),
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 512000,
            ...overrides,
        };
    }


    function makeTrajectory(
        cascadeId: string,
        overrides: Partial<ConversationTrajectoryLike> = {},
    ): ConversationTrajectoryLike {
        return {
            cascadeId,
            trajectoryId: `traj-${cascadeId}`,
            summary: `Chat ${cascadeId}`,
            stepCount: 4,
            status: CascadeStatus.IDLE,
            lastModifiedTime: '2026-11-27T10:00:00.000Z',
            createdTime: '2026-11-27T09:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M532',
            generatorModel: 'MODEL_PLACEHOLDER_M532',
            workspaceUris: ['file:///Users/dev/repo-a'],
            ...overrides,
        };
    }


    afterEach(() => {
        destroyRpcAgents();
        resetPathCaseSensitivityCache();
        vi.restoreAllMocks();
    });


    // ─── 1. rpc-client.ts (PERF-03) ──────────────────────────────────────────────

    describe('rpc-client: UTF-8 chunk boundaries, keepAlive agent reuse, and hard timeout', () => {
        it('pins credential-bearing RPC destinations to local IP literals', () => {
            expect(resolveLoopbackRpcHostname()).toBe('127.0.0.1');
            expect(resolveLoopbackRpcHostname('LOCALHOST')).toBe('127.0.0.1');
            expect(resolveLoopbackRpcHostname('[::1]')).toBe('::1');
            expect(() => resolveLoopbackRpcHostname('remote.example.invalid')).toThrow(/loopback/);
        });

        it('decodes multibyte CJK and emoji UTF-8 sequences split across arbitrary chunk boundaries without corruption', async () => {
            const expected = {
                title: '上下文监控窗口：中文多字节测试 🚀🎉🧠 — 精准统计',
                nested: { emoji: '👨‍👩‍👧‍👦', kana: 'コンテキストウィンドウ' },
            };
            const rawBytes = Buffer.from(JSON.stringify(expected), 'utf8');

            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                // Deliberately write 1 byte at a time so every 3-byte CJK and 4-byte emoji char is split across chunks.
                let offset = 0;
                const pump = () => {
                    if (offset >= rawBytes.length) {
                        res.end();
                        return;
                    }
                    res.write(rawBytes.subarray(offset, offset + 1));
                    offset += 1;
                    setImmediate(pump);
                };
                pump();
            }, async (ls) => {
                const resp = await rpcCall(ls, 'TestUtf8Split', { ok: true }, 5000);
                expect(resp).toEqual(expected);
                expect(JSON.stringify(resp)).not.toContain('\uFFFD');
            });
        });

        it('limits actual trajectory requests across nested readers, pages and response chunks', async () => {
            let hits = 0, concurrent = 0, peak = 0;
            await withHttpServer((req, res) => {
                req.resume();
                hits++; concurrent++; peak = Math.max(peak, concurrent);
                setTimeout(() => { concurrent--; res.end(JSON.stringify({ text: 'abcdef' })); }, 10);
            }, async ls => {
                const methods = ['GetCascadeTrajectorySteps', 'GetCascadeTrajectoryGeneratorMetadata', 'GetCascadeTrajectory'];
                const limits = { maxRequests: 6, maxPages: 5, maxBytes: 1000, maxConcurrency: 2, maxElapsedMs: 2000 };
                await withTrajectoryPollBudget(limits, async () => {
                    const first = await withTrajectoryRequestShare(() => Promise.allSettled(methods.map(m => rpcCall(ls, m, {}))));
                    expect(first.filter(r => r.status === 'fulfilled')).toHaveLength(2);
                    const second = await Promise.allSettled([...methods, ...methods].map(m => rpcCall(ls, m, {})));
                    expect(second.filter(r => r.status === 'fulfilled')).toHaveLength(3);
                });
                expect({ hits, peak }).toEqual({ hits: 5, peak: 2 });
                await withTrajectoryPollBudget({ ...limits, maxBytes: 5 }, async () => {
                    await expect(rpcCall(ls, methods[0], {})).rejects.toThrow('byte budget');
                    await expect(rpcCall(ls, methods[1], {})).rejects.toThrow('budget exhausted');
                });
                expect(hits).toBe(6);
            });
        });

        it('reuses keep-alive HTTP agent and underlying TCP socket across sequential RPC calls', async () => {
            const remotePorts: number[] = [];
            const connectionHeaders: Array<string | undefined> = [];

            await withHttpServer((req, res) => {
                req.resume();
                remotePorts.push(req.socket.remotePort ?? -1);
                connectionHeaders.push(req.headers.connection);
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Connection': 'keep-alive',
                });
                res.end(JSON.stringify({ seq: remotePorts.length }));
            }, async (ls) => {
                const agentBefore = getRpcAgent(false);
                const r1 = await rpcCall(ls, 'Ping', { n: 1 }, 5000);
                const r2 = await rpcCall(ls, 'Ping', { n: 2 }, 5000);
                const agentAfter = getRpcAgent(false);

                expect(r1).toEqual({ seq: 1 });
                expect(r2).toEqual({ seq: 2 });
                expect(agentBefore).toBe(agentAfter);
                expect(connectionHeaders).toEqual(['keep-alive', 'keep-alive']);
                // Same ephemeral client port proves TCP keep-alive socket reuse
                expect(remotePorts[0]).toBeGreaterThan(0);
                expect(remotePorts[1]).toBe(remotePorts[0]);
            });
        });

        it('enforces a hard wall-clock timeout even when the server continuously dribbles bytes', async () => {
            const intervals: NodeJS.Timeout[] = [];

            await withHttpServer((req, res) => {
                req.resume();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.write('{"partial":"');
                // Dribble 1 byte every 25ms — shorter than the 120ms timeout so an idle-only socket timeout would NEVER fire!
                const iv = setInterval(() => {
                    if (!res.destroyed) {
                        res.write('a');
                    }
                }, 25);
                intervals.push(iv);
                res.on('close', () => clearInterval(iv));
            }, async (ls) => {
                const startedAt = Date.now();
                await expect(rpcCall(ls, 'SlowDribble', {}, 120)).rejects.toThrow(/RPC timeout/i);
                const elapsed = Date.now() - startedAt;
                expect(elapsed).toBeGreaterThanOrEqual(90);
                expect(elapsed).toBeLessThan(1500);
            });

            for (const iv of intervals) { clearInterval(iv); }
        });
    });


    // ─── 2. tracker.ts (ACC-04, ACC-05) ──────────────────────────────────────────

    describe('tracker: fetchFullUserStatus ok/error, fetchTrajectorySteps/Metadata ok/hasGaps, PLANNER_RESPONSE compaction', () => {
        describe('full checkpoint between planner calls', () => {
            const planner = {
                stepIndex: 218, type: StepType.PLANNER_RESPONSE,
                metadata: { modelUsage: { inputTokens: '11932', cacheReadTokens: '318717', outputTokens: '822' } },
            };
            const checkpoint = {
                stepIndex: 221, type: StepType.CHECKPOINT, status: 'CORTEX_STEP_STATUS_DONE',
                checkpoint: { includedStepIndexEnd: 221, sessionSummary: 'A short summary' },
                metadata: { modelUsage: { inputTokens: '3889', cacheReadTokens: '328600', outputTokens: '5515' } },
            };
            const waiting = { stepIndex: 222, type: StepType.PLANNER_RESPONSE, plannerResponse: { response: 'Waiting' } };

            it('estimates only retained context, even when only a suffix is available', () => {
                const full = processSteps([planner, checkpoint, waiting]);
                expect(full).toMatchObject({ postCompactionPending: true, lastModelUsage: null, isEstimated: true });
                expect(full.contextUsed).toBeGreaterThan(0);
                expect(full.contextUsed).toBeLessThan(1000);
                expect(processSteps([checkpoint, waiting]).contextUsed).toBe(full.contextUsed);
                expect(processSteps([planner, checkpoint, waiting, {
                    ...planner, stepIndex: 224, metadata: { modelUsage: { inputTokens: '47952', outputTokens: '138' } },
                }])).toMatchObject({ contextUsed: 48090, isEstimated: false, tokenUsageSource: 'planner' });
            });

            it('ignores non-compacting or unfinished checkpoint usage', () => {
                for (const marker of [
                    { ...checkpoint, checkpoint: { intentOnly: true } },
                    { ...checkpoint, status: 'CORTEX_STEP_STATUS_RUNNING' },
                    { ...checkpoint, status: 'CORTEX_STEP_STATUS_ERROR' },
                ]) {
                    expect(processSteps([planner, marker])).toMatchObject({
                        contextUsed: 331471, isEstimated: false, tokenUsageSource: 'planner',
                    });
                }
            });

            it('clears a pending compaction estimate on rewind or a different branch', () => {
                for (const boundary of [{ type: 'CORTEX_STEP_TYPE_REWIND' }, { branchId: 'new-branch' }]) {
                    expect(processSteps([planner, checkpoint, boundary])).toMatchObject({
                        postCompactionPending: false, isEstimated: true, lastModelUsage: null,
                    });
                }
            });

            it('persists changed compaction state and trajectory identity with otherwise identical telemetry', async () => {
                await withHttpServer((_req, res) => res.end(JSON.stringify({ steps: [{ ...planner, stepIndex: 0 }] })), async ls => {
                    const usage = await getContextUsage(ls, {
                        cascadeId: 'root', trajectoryId: 'first', stepCount: 1, status: CascadeStatus.IDLE,
                        summary: '', createdTime: '', lastModifiedTime: '', requestedModel: '', generatorModel: '',
                        workspaceUris: [], lastUserInputTime: '', lastUserInputStepIndex: 0,
                        repositoryName: '', gitOriginUrl: '', branchName: '', gitRootUri: '',
                    });
                    expect(usage).toMatchObject({ trajectoryId: 'first', postCompactionPending: false });
                    const store = new MonitorStore();
                    store.record([usage], 'root');
                    store.record([{ ...usage, postCompactionPending: true }]);
                    expect(store.restore().currentUsage?.postCompactionPending).toBe(true);
                    store.record([{ ...usage, postCompactionPending: true, trajectoryId: 'second' }]);
                    expect(store.restore().currentUsage?.trajectoryId).toBe('second');
                });
            });
        });

        it('preserves explicit zero and -1 in plan fields, without coercing missing or malformed values', async () => {
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ userStatus: { planStatus: { planInfo: {
                    maxNumPremiumChatMessages: '-1', maxLocalIndexSize: 0,
                    maxCustomChatInstructionCharacters: '600characters',
                    maxNumPinnedContextItems: -2, monthlyFlexCreditPurchaseAmount: '25000',
                } } } }));
            }, async ls => {
                const { userInfo } = await fetchFullUserStatus(ls);
                expect(userInfo?.planLimits).toEqual({
                    maxNumChatInputTokens: null, maxNumPremiumChatMessages: -1,
                    maxCustomChatInstructionCharacters: null, maxNumPinnedContextItems: null,
                    maxLocalIndexSize: 0, monthlyFlexCreditPurchaseAmount: 25_000,
                });
            });
        });

        it('fetchFullUserStatus distinguishes valid responses (ok: true) from RPC errors and malformed payloads (ok: false)', async () => {
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    userStatus: {
                        name: 'Ada',
                        email: 'ada@example.test',
                        cascadeModelConfigData: {
                            clientModelConfigs: [{
                                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' },
                                label: 'Gemini 4 Neon (High)',
                                quotaInfo: { remainingFraction: 0.75, resetTime: '2026-11-28T00:00:00Z' },
                            }],
                        },
                    },
                }));
            }, async (ls) => {
                const okRes = await fetchFullUserStatus(ls);
                expect(okRes.ok).toBe(true);
                expect(okRes.error).toBeUndefined();
                expect(okRes.configs).toHaveLength(1);
                expect(okRes.userInfo?.email).toBe('ada@example.test');
            });

            await withHttpServer((_req, res) => {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('service unavailable');
            }, async (ls) => {
                const errRes = await fetchFullUserStatus(ls);
                expect(errRes.ok).toBe(false);
                expect(errRes.configs).toEqual([]);
                expect(errRes.userInfo).toBeNull();
                expect(errRes.error).toMatch(/503/);
            });

            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ userStatus: null }));
            }, async (ls) => {
                const badRes = await fetchFullUserStatus(ls);
                expect(badRes.ok).toBe(false);
                expect(badRes.error).toBeTruthy();
            });
        });

        it('fetchTrajectorySteps returns ok/hasGaps accurately and continues paginating when page 1 exceeds STEP_BATCH_SIZE but is < totalSteps', async () => {
            // 1. Genuine empty (totalSteps = 0)
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps: [] }));
            }, async (ls) => {
                const emptyRes = await fetchTrajectorySteps(ls, 'c-empty', 0);
                expect(emptyRes).toEqual({ ok: true, steps: [], hasGaps: false });
            });

            // 2. First page returns 60 steps (> STEP_BATCH_SIZE=50) out of 120 -> MUST fetch offset 60..120 instead of dropping them!
            const seenOffsets: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    seenOffsets.push(offset);
                    const batch = Array.from({ length: 60 }, (_, idx) => ({
                        stepIndex: offset + idx,
                        type: StepType.USER_INPUT,
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps: batch }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-paged', 120);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(120);
                expect(seenOffsets).toEqual([0, 60]);
            });

            // 3. Batch failure -> ok: false, hasGaps: true, error set
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    if ((body.stepOffset ?? 0) === 0) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ steps: Array.from({ length: 50 }, (_, i) => ({ stepIndex: i })) }));
                    } else {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('boom');
                    }
                });
            }, async (ls) => {
                const partial = await fetchTrajectorySteps(ls, 'c-gap', 100);
                expect(partial.ok).toBe(false);
                expect(partial.hasGaps).toBe(true);
                expect(partial.steps).toHaveLength(50);
                expect(partial.error).toMatch(/500/);
            });
            expect(warnSpy).toHaveBeenCalled();
        });

        it('fetchTrajectoryGeneratorMetadataResult distinguishes genuine empty from RPC failure while keeping legacy wrapper compatible', async () => {
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ generatorMetadata: [] }));
            }, async (ls) => {
                const res = await fetchTrajectoryGeneratorMetadataResult(ls, 'c-empty');
                expect(res).toEqual({ ok: true, metadata: [] });
                expect(await fetchTrajectoryGeneratorMetadata(ls, 'c-empty')).toEqual([]);
            });

            await withHttpServer((_req, res) => {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('bad gateway');
            }, async (ls) => {
                const res = await fetchTrajectoryGeneratorMetadataResult(ls, 'c-fail');
                expect(res.ok).toBe(false);
                expect(res.metadata).toEqual([]);
                expect(res.error).toMatch(/502/);
                // Backward-compatible wrapper still returns []
                expect(await fetchTrajectoryGeneratorMetadata(ls, 'c-fail')).toEqual([]);
            });
        });

        it('processSteps detects input-drop compaction on PLANNER_RESPONSE steps, ignores delegated executors, and emits no stray console.log', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            // Modern trajectory without CHECKPOINT: PLANNER_RESPONSE drops from 180,000 -> 35,000 prompt tokens
            const compacted = processSteps([
                {
                    type: StepType.USER_INPUT,
                    userInput: { userResponse: 'Continue work' },
                },
                {
                    type: StepType.PLANNER_RESPONSE,
                    plannerResponse: { response: 'Step 1' },
                    metadata: {
                        generatorModel: 'MODEL_PLACEHOLDER_M532',
                        modelUsage: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            inputTokens: 20_000,
                            cacheReadTokens: 160_000,
                            outputTokens: 400,
                        },
                    },
                },
                {
                    type: StepType.PLANNER_RESPONSE,
                    plannerResponse: { response: 'After compaction' },
                    metadata: {
                        generatorModel: 'MODEL_PLACEHOLDER_M532',
                        modelUsage: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            inputTokens: 30_000,
                            cacheReadTokens: 5_000,
                            outputTokens: 300,
                        },
                    },
                },
                // CHECKPOINT with retryInfos must NOT emit stray console.log
                {
                    type: StepType.CHECKPOINT,
                    metadata: {
                        modelUsage: {
                            model: 'MODEL_PLACEHOLDER_M50',
                            inputTokens: 10_000,
                            outputTokens: 100,
                        },
                        retryInfos: [{ usage: { inputTokens: 1000, outputTokens: 50 } }],
                    },
                },
            ]);

            expect(compacted.checkpointCompressionDetected).toBe(true);
            expect(compacted.checkpointCompressionDrop).toBe(145_000);
            expect(logSpy).not.toHaveBeenCalled();

            // Delegated Orchestrator sub-executor with smaller subtask prompt must NOT trigger false compaction
            const delegated = processSteps([
                {
                    type: StepType.USER_INPUT,
                    userInput: {
                        userResponse: 'Run orchestrator task',
                        userConfig: {
                            plannerConfig: {
                                planModel: 'MODEL_PLACEHOLDER_M401',
                                planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' },
                            },
                        },
                    },
                },
                {
                    type: StepType.PLANNER_RESPONSE,
                    plannerResponse: { response: 'Plan' },
                    metadata: {
                        modelUsage: {
                            model: 'MODEL_PLACEHOLDER_M401',
                            inputTokens: 120_000,
                            outputTokens: 500,
                        },
                    },
                },
                {
                    type: StepType.PLANNER_RESPONSE,
                    plannerResponse: { response: 'Delegated subtask' },
                    metadata: {
                        modelUsage: {
                            model: 'MODEL_PLACEHOLDER_M528',
                            inputTokens: 12_000,
                            outputTokens: 200,
                        },
                    },
                },
            ]);

            expect(delegated.checkpointCompressionDetected).toBe(false);
            expect(delegated.checkpointCompressionDrop).toBe(0);
        });
    });


    // ─── 3. pool-utils.ts (ACC-04) ───────────────────────────────────────────────

    describe('pool-utils: groupModelConfigsByQuotaPool all-NaN -> null guard', () => {
        it('returns minFraction: null (never fabricated 1.0) when all models in a pool have NaN or non-finite fractions', () => {
            const groups = groupModelConfigsByQuotaPool([
                makeModelConfig('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)', Number.NaN, '2026-11-28T05:00:00Z'),
                makeModelConfig('MODEL_PLACEHOLDER_M533', 'Gemini 4 Neon (Medium)', Number.POSITIVE_INFINITY, '2026-11-28T05:00:00Z'),
                makeModelConfig('MODEL_PLACEHOLDER_M401', 'Claude Opus 5.5 (Medium)', Number.NaN, '2026-11-28T06:00:00Z'),
                makeModelConfig('MODEL_PLACEHOLDER_M404', 'Claude Sonnet 5.5 (Medium)', 0.42, '2026-11-28T06:00:00Z'),
            ]);

            const gemini = groups.find(g => g.key === 'gemini');
            const premium = groups.find(g => g.key === 'premium');

            expect(gemini).toBeDefined();
            expect(gemini!.minFraction).toBeNull();
            expect(premium).toBeDefined();
            expect(premium!.minFraction).toBe(0.42);
        });

        it('rejects epoch-0 / invalid resetTime strings and sorts positive resetTimes chronologically', () => {
            expect(parsePositivePoolResetMs('1970-01-01T00:00:00Z')).toBeNull();
            expect(parsePositivePoolResetMs('bad-date')).toBeNull();
            expect(parsePositivePoolResetMs('2026-11-28T05:00:00Z')).toBe(Date.parse('2026-11-28T05:00:00Z'));

            const sorted = ['2026-11-28T06:00:00Z', '', '2026-11-28T07:00:00+02:00'].sort(comparePoolResetTimes);
            expect(sorted).toEqual(['2026-11-28T07:00:00+02:00', '2026-11-28T06:00:00Z', '']);
        });
    });


    // ─── 4. gm/tracker.ts (ACC-02, PERF-03) ──────────────────────────────────────

    describe('GMTracker: stepCount===0 clear, equal-length/longer prefix rewind, bounded concurrency & AbortSignal', () => {
        it('clears cached GM state and marks pending revert when stepCount drops to 0', async () => {
            const tracker = new GMTracker();
            const cache = (tracker as any)._cache as Map<string, GMConversationData>;
            const calls = [
                makeGMCall({ executionId: 'z-0' }),
                makeGMCall({ executionId: 'z-1' }),
            ];
            cache.set('conv-zero', {
                cascadeId: 'conv-zero',
                title: 'Cleared Conv',
                totalSteps: 4,
                calls,
                lifetimeCalls: 2,
                coveredSteps: 2,
                coverageRate: 0.5,
                checkpointSummaries: [],
                systemContextItems: [],
            });

            const first = tracker.getNewCallsSinceLastRecord();
            expect(first.entries).toHaveLength(2);
            tracker.markLedgerEntriesRecorded(first.entries);

            // Next fetchAll observes stepCount === 0 -> clears cache instead of `continue`
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ generatorMetadata: [] }));
            }, async (ls) => {
                await tracker.fetchAll(ls, [
                    { cascadeId: 'conv-zero', title: 'Cleared Conv', stepCount: 0, status: CascadeStatus.IDLE },
                ]);
            });

            expect(tracker.getAllConversationData().find(c => c.cascadeId === 'conv-zero')).toBeUndefined();
            const afterClear = tracker.getNewCallsSinceLastRecord();
            expect(afterClear.revertedCascadeIds).toEqual(['conv-zero']);
            expect(afterClear.entries).toHaveLength(0);
        });

        it('detects equal-length and longer branch rewinds via stable prefix fingerprints (with and without executionId)', () => {
            const tracker = new GMTracker();
            const cache = (tracker as any)._cache as Map<string, GMConversationData>;
            const now = Date.now();
            const ts = (offsetSec: number) => new Date(now - (120 - offsetSec) * 1000).toISOString();

            const orig = [
                makeGMCall({ executionId: 'a0', createdAt: ts(1), inputTokens: 1000 }),
                makeGMCall({ executionId: 'a1', createdAt: ts(2), inputTokens: 2000 }),
                makeGMCall({ executionId: 'a2', createdAt: ts(3), inputTokens: 3000 }),
                makeGMCall({ executionId: 'a3', createdAt: ts(4), inputTokens: 4000 }),
            ];
            cache.set('conv-branch', {
                cascadeId: 'conv-branch',
                title: 'Branch Rewind',
                totalSteps: 8,
                calls: orig,
                lifetimeCalls: 4,
                coveredSteps: 4,
                coverageRate: 0.5,
                checkpointSummaries: [],
                systemContextItems: [],
            });

            const initial = tracker.getNewCallsSinceLastRecord();
            expect(initial.entries).toHaveLength(4);
            tracker.markLedgerEntriesRecorded(initial.entries);

            // 1. Equal-length branch rewind: [a0, a1, b2, b3] (length stays 4!)
            cache.get('conv-branch')!.calls = [
                orig[0],
                orig[1],
                makeGMCall({ executionId: 'b2', createdAt: ts(10), inputTokens: 3100 }),
                makeGMCall({ executionId: 'b3', createdAt: ts(11), inputTokens: 4200 }),
            ];
            const eqRewind = tracker.getNewCallsSinceLastRecord();
            expect(eqRewind.revertedCascadeIds).toEqual(['conv-branch']);
            expect(eqRewind.entries.map(e => e.call.executionId)).toEqual(['b2', 'b3']);
            tracker.markLedgerEntriesRecorded(eqRewind.entries);
            expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);

            // 2. Longer branch rewind without executionId (diverges via createdAt/model/inputTokens fingerprint at index 1)
            const noExecOrig = [
                makeGMCall({ executionId: '', createdAt: ts(20), model: 'MODEL_PLACEHOLDER_M532', inputTokens: 500 }),
                makeGMCall({ executionId: '', createdAt: ts(21), model: 'MODEL_PLACEHOLDER_M532', inputTokens: 900 }),
            ];
            cache.set('conv-no-exec', {
                cascadeId: 'conv-no-exec',
                title: 'No ExecId Branch',
                totalSteps: 4,
                calls: noExecOrig,
                lifetimeCalls: 2,
                coveredSteps: 2,
                coverageRate: 0.5,
                checkpointSummaries: [],
                systemContextItems: [],
            });
            const init2 = tracker.getNewCallsSinceLastRecord();
            tracker.markLedgerEntriesRecorded(init2.entries);

            const divergedB1 = makeGMCall({ executionId: '', createdAt: ts(30), model: 'MODEL_PLACEHOLDER_M401', inputTokens: 1500 });
            const divergedB2 = makeGMCall({ executionId: '', createdAt: ts(31), model: 'MODEL_PLACEHOLDER_M401', inputTokens: 2500 });
            expect(computeGMCallFingerprint(noExecOrig[1])).not.toBe(computeGMCallFingerprint(divergedB1));

            cache.get('conv-no-exec')!.calls = [noExecOrig[0], divergedB1, divergedB2];
            const longerRewind = tracker.getNewCallsSinceLastRecord();
            expect(longerRewind.revertedCascadeIds).toEqual(['conv-no-exec']);
            expect(longerRewind.entries).toHaveLength(2);
            expect(longerRewind.entries[0].call.inputTokens).toBe(1500);
            expect(longerRewind.entries[1].call.inputTokens).toBe(2500);
        });

        it('runs GMTracker.fetchAll() with bounded concurrency = 3 (concurrent, never exceeding 3 in-flight)', async () => {
            let inFlight = 0;
            let maxInFlight = 0;
            let completed = 0;

            await withHttpServer((req, res) => {
                req.resume();
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                setTimeout(() => {
                    inFlight--;
                    completed++;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ generatorMetadata: [] }));
                }, 40);
            }, async (ls) => {
                const tracker = new GMTracker();
                const trajectories = Array.from({ length: 9 }, (_, i) => ({
                    cascadeId: `conv-conc-${i}`,
                    title: `Conv ${i}`,
                    stepCount: 2,
                    status: CascadeStatus.IDLE,
                }));

                await tracker.fetchAll(ls, trajectories);
                expect(completed).toBe(9);
                expect(GM_FETCH_CONCURRENCY).toBe(3);
                expect(maxInFlight).toBeLessThanOrEqual(3);
                expect(maxInFlight).toBeGreaterThanOrEqual(2);
            });
        });

        it('immediately rethrows on AbortSignal in both metadata and enrichment fetches without recording idle error backoff', async () => {
            let attempts = 0;

            // Case 1: Abort during GetCascadeTrajectoryGeneratorMetadata
            await withHttpServer((req, res) => {
                req.resume();
                attempts++;
                if (attempts === 1) {
                    // Stall first request so AbortController aborts it
                    setTimeout(() => {
                        if (!res.destroyed) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ generatorMetadata: [] }));
                        }
                    }, 2000);
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ generatorMetadata: [] }));
            }, async (ls) => {
                const tracker = new GMTracker();
                const ac = new AbortController();
                const traj = [{ cascadeId: 'conv-abort-1', title: 'Abort 1', stepCount: 3, status: CascadeStatus.IDLE }];
                setTimeout(() => ac.abort(), 30);

                await expect(tracker.fetchAll(ls, traj, undefined, ac.signal)).rejects.toThrow(/abort/i);

                // Immediate retry without abort MUST NOT be skipped by backoff!
                await tracker.fetchAll(ls, traj);
                expect(attempts).toBe(2);
            });

            // Case 2: Abort during GetCascadeTrajectory enrichment catch block
            let enrichAttempts = 0;
            await withHttpServer((req, res) => {
                req.resume();
                if (req.url?.endsWith('/GetCascadeTrajectoryGeneratorMetadata')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        generatorMetadata: [{
                            executionId: 'enrich-abort-exec',
                            stepIndices: [1],
                            chatModel: {
                                model: 'MODEL_PLACEHOLDER_M532',
                                usage: { inputTokens: 100, outputTokens: 20 },
                                chatStartMetadata: { createdAt: new Date().toISOString() },
                            },
                        }],
                    }));
                    return;
                }
                enrichAttempts++;
                if (enrichAttempts === 1) {
                    setTimeout(() => {
                        if (!res.destroyed) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ trajectory: { steps: [] } }));
                        }
                    }, 2000);
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ trajectory: { steps: [] } }));
            }, async (ls) => {
                const tracker = new GMTracker();
                const ac = new AbortController();
                const traj = [{ cascadeId: 'conv-abort-enrich', title: 'Abort Enrich', stepCount: 3, status: CascadeStatus.IDLE }];
                setTimeout(() => ac.abort(), 40);

                await expect(tracker.fetchAll(ls, traj, undefined, ac.signal)).rejects.toThrow(/abort/i);

                // Retry immediately — must NOT have recorded backoff from aborted enrichment!
                await tracker.fetchAll(ls, traj);
                expect(enrichAttempts).toBe(2);
            });
        });
    });


    // ─── 5. telemetry-metrics.ts & turn-diagnostics.ts (ACC-05) ──────────────────

    describe('unified classifyPromptCacheState across telemetry-metrics and turn-diagnostics', () => {
        it('exports the single canonical classifier with exact <10% cold, 10–70% partial, >=70% warm thresholds', () => {
            expect(classifyPromptCacheStateFromTurnDiag).toBe(classifyPromptCacheState);

            expect(classifyPromptCacheState(null)).toBe('unknown');
            expect(classifyPromptCacheState(undefined)).toBe('unknown');
            expect(classifyPromptCacheState(Number.NaN)).toBe('unknown');
            expect(classifyPromptCacheState(-1)).toBe('unknown');

            expect(classifyPromptCacheState(0)).toBe('cold');
            expect(classifyPromptCacheState(0.1)).toBe('cold');
            expect(classifyPromptCacheState(9.99)).toBe('cold');
            expect(classifyPromptCacheState(10)).toBe('partial');
            expect(classifyPromptCacheState(45)).toBe('partial');
            expect(classifyPromptCacheState(69.99)).toBe('partial');
            expect(classifyPromptCacheState(70)).toBe('warm');
            expect(classifyPromptCacheState(100)).toBe('warm');
        });

        it('eliminates the dual-threshold conflict so 0.1% / 5% / 40% / 80% agree between telemetry-metrics and turn-diagnostics', () => {
            // 0.1% cache read (10 / 10_000) -> COLD in BOTH engines (previously telemetry-metrics wrongly said 'warm'!)
            const tinyHitCall = makeGMCall({
                executionId: 'tiny-hit',
                createdAt: '2026-11-27T10:02:00.000Z',
                inputTokens: 9_990,
                cacheReadTokens: 10,
                cacheCreationTokens: 0,
            });
            const telTiny = computeCallTelemetry(tinyHitCall);
            const diagTiny = analyzeTurnDiagnostics([tinyHitCall]);
            expect(telTiny.promptCacheState).toBe('cold');
            expect(telTiny.cacheState).toBe('cold');
            expect(diagTiny.lastTurnStartKind).toBe('cold');

            // 40% cache read -> PARTIAL in canonical classifier (warming in legacy badge, never 'warm')
            const partialCall = makeGMCall({
                executionId: 'partial-hit',
                createdAt: '2026-11-27T10:01:00.000Z',
                inputTokens: 6_000,
                cacheReadTokens: 4_000,
                cacheCreationTokens: 0,
            });
            const telPartial = computeCallTelemetry(partialCall);
            const diagPartial = analyzeTurnDiagnostics([partialCall]);
            expect(telPartial.promptCacheState).toBe('partial');
            expect(telPartial.cacheState).toBe('warming');
            expect(diagPartial.lastTurnStartKind).toBe('partial');

            // 70% cache read -> WARM in BOTH engines
            const warmCall = makeGMCall({
                executionId: 'warm-hit',
                createdAt: '2026-11-27T10:00:00.000Z',
                inputTokens: 3_000,
                cacheReadTokens: 7_000,
                cacheCreationTokens: 0,
            });
            const telWarm = computeCallTelemetry(warmCall);
            const diagWarm = analyzeTurnDiagnostics([warmCall]);
            expect(telWarm.promptCacheState).toBe('warm');
            expect(telWarm.cacheState).toBe('warm');
            expect(diagWarm.lastTurnStartKind).toBe('warm');
            expect(classifyTurnStartKind(70, 10_000)).toBe('warm');

            // Aggregate reflects chronologically latest call's canonical promptCacheState (tinyHitCall @ 10:02 > warmCall @ 10:00)
            const agg = computeTelemetryAggregate([warmCall, tinyHitCall]);
            expect(agg.latestPromptCacheState).toBe('cold');
            expect(agg.latestCacheState).toBe('cold');
        });
    });


    // ─── 6. conversation-selector.ts (ACC-05) ────────────────────────────────────

    describe('conversation-selector: Remote-SSH authority, macOS case-sensitive APFS, multi-root & worker-isolated IDE auto-follow', () => {
        it('preserves Remote-SSH authority so distinct hosts with identical paths never collide (even on darwin/win32)', () => {
            const hostA = normalizeWorkspaceUri('vscode-remote://ssh-remote+prod-box/srv/MyApp/', 'darwin');
            const hostAEncoded = normalizeWorkspaceUri('vscode-remote://ssh-remote%2BPROD-BOX/srv/MyApp', 'win32');
            const hostB = normalizeWorkspaceUri('vscode-remote://ssh-remote+staging-box/srv/MyApp/', 'darwin');
            const hostALower = normalizeWorkspaceUri('vscode-remote://ssh-remote+prod-box/srv/myapp/', 'darwin');

            expect(hostA).toBe('vscode-remote://ssh-remote+prod-box/srv/MyApp');
            expect(hostAEncoded).toBe(hostA);
            expect(hostB).toBe('vscode-remote://ssh-remote+staging-box/srv/MyApp');
            expect(hostA).not.toBe(hostB);
            // Remote Linux POSIX path case is preserved even when local IDE runs on macOS
            expect(hostA).not.toBe(hostALower);

            // tracker.ts normalizeUri delegates consistently
            expect(normalizeUri('vscode-remote://ssh-remote+prod-box/srv/MyApp/', 'darwin')).toBe(hostA);
            expect(normalizeUri('vscode-remote://ssh-remote+staging-box/srv/MyApp/', 'darwin')).toBe(hostB);

            // Explicit ssh:// URI also preserves authority
            expect(normalizeWorkspaceUri('ssh://alice@host1/srv/App/', 'darwin'))
                .not.toBe(normalizeWorkspaceUri('ssh://alice@host2/srv/App/', 'darwin'));
        });

        it('supports macOS case-sensitive APFS volumes without blindly lowercasing paths', () => {
            // Explicit caseSensitive override on darwin
            const upperCs = normalizeWorkspaceUri('file:///Volumes/WorkCS/ProjectA/', { platform: 'darwin', caseSensitive: true });
            const lowerCs = normalizeWorkspaceUri('file:///Volumes/WorkCS/projecta/', { platform: 'darwin', caseSensitive: true });
            expect(upperCs).toBe('/Volumes/WorkCS/ProjectA');
            expect(lowerCs).toBe('/Volumes/WorkCS/projecta');
            expect(upperCs).not.toBe(lowerCs);

            // Probe-based detection: ENOENT on toggled case => case-sensitive volume (true)
            const csProbe = detectPathCaseSensitivity('/Volumes/CaseSens/Repo', {
                statSync(targetPath) {
                    if (targetPath === '/Volumes/CaseSens') { return { dev: 42, ino: 50 }; }
                    if (targetPath === '/Volumes/CaseSens/Repo') { return { dev: 42, ino: 100 }; }
                    const err = new Error('ENOENT') as NodeJS.ErrnoException;
                    err.code = 'ENOENT';
                    throw err;
                },
            });
            expect(csProbe).toBe(true);

            // Probe-based detection: same (dev, ino) on toggled case => case-insensitive volume (false)
            const ciProbe = detectPathCaseSensitivity('/Users/Alice/Repo', {
                statSync() { return { dev: 1, ino: 777 }; },
            });
            expect(ciProbe).toBe(false);

            // Probe-based detection: distinct inodes on toggled case => case-sensitive volume (true)
            const distinctInoProbe = detectPathCaseSensitivity('/Volumes/CaseSens/Repo', {
                statSync(targetPath) {
                    return targetPath === '/Volumes/CaseSens/Repo'
                        ? { dev: 99, ino: 1001 }
                        : { dev: 99, ino: 2002 };
                },
            });
            expect(distinctInoProbe).toBe(true);

            // Custom per-path case-sensitivity hook preserves case only on case-sensitive volumes
            const hook = (p: string) => p.startsWith('/Volumes/CaseSens');
            expect(normalizeWorkspaceUri('file:///Volumes/CaseSens/App', { platform: 'darwin', isCaseSensitivePath: hook }))
                .not.toBe(normalizeWorkspaceUri('file:///Volumes/CaseSens/app', { platform: 'darwin', isCaseSensitivePath: hook }));
            expect(normalizeWorkspaceUri('file:///Users/Alice/App', { platform: 'darwin', isCaseSensitivePath: hook }))
                .toBe(normalizeWorkspaceUri('file:///Users/Alice/app', { platform: 'darwin', isCaseSensitivePath: hook }));
        });

        it('matches multi-root workspaces accurately and isolates workers & foreign workspaces in resolveIdeAutoFollowConversation', () => {
            const roots = [
                'vscode-remote://ssh-remote+host-a/srv/frontend',
                'vscode-remote://ssh-remote+host-a/srv/backend',
            ];

            const backendIdle = makeTrajectory('backend-idle', {
                workspaceUris: ['vscode-remote://ssh-remote+host-a/srv/backend/'],
                lastModifiedTime: '2026-11-27T10:00:00Z',
            });
            const foreignHostRunning = makeTrajectory('foreign-host-running', {
                // Same POSIX path `/srv/backend`, DIFFERENT Remote-SSH host -> MUST NOT match or hijack!
                workspaceUris: ['vscode-remote://ssh-remote+host-b/srv/backend'],
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-27T10:05:00Z',
            });
            const swarmWorkerRunning = makeTrajectory('worker-running', {
                workspaceUris: ['vscode-remote://ssh-remote+host-a/srv/frontend'],
                branchName: 'swarm-p1-rpc-tracker-65db7925',
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-27T10:06:00Z',
            });
            const frontendRunning = makeTrajectory('frontend-running', {
                workspaceUris: ['vscode-remote://ssh-remote+host-a/srv/frontend'],
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-27T10:04:00Z',
            });

            expect(matchesAnyWorkspace(backendIdle, roots, 'darwin')).toBe(true);
            expect(matchesAnyWorkspace(foreignHostRunning, roots, 'darwin')).toBe(false);
            expect(filterTrajectoriesByWorkspaces([backendIdle, foreignHostRunning, frontendRunning], roots, 'darwin').map(t => t.cascadeId))
                .toEqual(['backend-idle', 'frontend-running']);

            // 1. Worker running + foreign-host running must NOT hijack IDE auto-follow from multi-root backendIdle
            const stayedOnLocal = resolveIdeAutoFollowConversation({
                trajectories: [swarmWorkerRunning, foreignHostRunning, backendIdle],
                workspaceUris: roots,
                currentActiveId: 'backend-idle',
                platform: 'darwin',
            });
            expect(stayedOnLocal.cascadeId).toBe('backend-idle');
            expect(stayedOnLocal.ignoredSubagentBurst).toBe(true);

            // 2. Running non-worker conversation in SECOND root (`frontend`) IS followed cleanly
            const multiRootRunning = resolveIdeAutoFollowConversation({
                trajectories: [swarmWorkerRunning, foreignHostRunning, frontendRunning, backendIdle],
                workspaceUris: roots,
                currentActiveId: 'backend-idle',
                platform: 'darwin',
            });
            expect(multiRootRunning.cascadeId).toBe('frontend-running');
            expect(multiRootRunning.ignoredSubagentBurst).toBe(true);

            // 3. Step-count change detection picks workspace-eligible changed conversation without jumping to foreign workspace
            const stepChanged = resolveIdeAutoFollowConversation({
                trajectories: [foreignHostRunning, backendIdle],
                workspaceUris: roots,
                currentActiveId: 'backend-idle',
                previousStepCounts: new Map([['backend-idle', 2]]),
                platform: 'darwin',
            });
            expect(stepChanged.cascadeId).toBe('backend-idle');
            expect(stepChanged.reason).toBe('ide_step_count_increased');
        });
    });
});

describe('[w1a-tracker-rpc-selector]', () => {
    async function withHttpServer(
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
        fn: (ls: LSInfo) => Promise<void>,
        csrfToken = 'test-csrf-token-9876543210',
    ): Promise<void> {
        const server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const port = (server.address() as AddressInfo).port;
        const ls: LSInfo = { pid: 1, port, csrfToken, useTls: false };
        try {
            await fn(ls);
        } finally {
            destroyRpcAgents();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    }


    function encodeConnectFrame(payload: string, flags = 0): Buffer {
        const body = Buffer.from(payload, 'utf8');
        const frame = Buffer.alloc(5 + body.length);
        frame[0] = flags;
        frame.writeUInt32BE(body.length, 1);
        body.copy(frame, 5);
        return frame;
    }


    function makeTrajectory(
        cascadeId: string,
        overrides: Partial<ConversationTrajectoryLike> = {},
    ): ConversationTrajectoryLike {
        return {
            cascadeId,
            trajectoryId: `traj-${cascadeId}`,
            summary: `Chat ${cascadeId}`,
            stepCount: 4,
            status: CascadeStatus.IDLE,
            lastModifiedTime: '2026-11-27T10:00:00.000Z',
            createdTime: '2026-11-27T09:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M532',
            generatorModel: 'MODEL_PLACEHOLDER_M532',
            workspaceUris: [],
            ...overrides,
        };
    }


    afterEach(() => {
        destroyRpcAgents();
        resetPathCaseSensitivityCache();
        vi.restoreAllMocks();
    });


    // ─── W1A-FIX-2: Short-page Steps & malformed-page false green ────────────────

    describe('W1A-FIX-2: fetchTrajectorySteps short-page pagination, contiguous coverage, and malformed-page guards', () => {
        it('resumes from actual covered offset (20) when page 1 returns fewer steps than requested (20 of 50), dropping zero steps', async () => {
            const seenRequests: Array<{ startIndex?: number; endIndex?: number; stepOffset?: number }> = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                        startIndex?: number;
                        endIndex?: number;
                        stepOffset?: number;
                    };
                    seenRequests.push(body);
                    const offset = body.stepOffset ?? 0;
                    const remaining = Math.max(0, 100 - offset);
                    const count = Math.min(20, remaining);
                    const steps = Array.from({ length: count }, (_, idx) => ({
                        stepIndex: offset + idx,
                        type: StepType.USER_INPUT,
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-short-page', 100);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(100);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 100 }, (_, i) => i));
                expect(seenRequests.map(r => r.stepOffset)).toEqual([0, 20, 40, 60, 80]);
            });
        });

        it('paginates short pages when totalSteps === 50 or totalSteps < 50 (e.g. 40), fails closed on incomplete tail, and handles variable byte-capped pages', async () => {
            // Case A: totalSteps === 50 (exact STEP_BATCH_SIZE) returning 20 on page 1 -> MUST resume at offset 20, then 40!
            const offsets50: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    offsets50.push(offset);
                    const count = Math.min(20, Math.max(0, 50 - offset));
                    const steps = Array.from({ length: count }, (_, i) => ({
                        stepIndex: offset + i,
                        type: StepType.USER_INPUT,
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-short-50', 50);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(50);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 50 }, (_, i) => i));
                expect(offsets50).toEqual([0, 20, 40]);
            });

            // Case B: totalSteps === 40 (< STEP_BATCH_SIZE) byte-capped at 20 -> MUST resume at offset 20!
            const offsets40: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    offsets40.push(offset);
                    const count = Math.min(20, Math.max(0, 40 - offset));
                    const steps = Array.from({ length: count }, (_, i) => ({
                        stepIndex: offset + i,
                        type: StepType.USER_INPUT,
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-short-40', 40);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(40);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 40 }, (_, i) => i));
                expect(offsets40).toEqual([0, 20]);
            });

            // Case C: totalSteps === 50 returns 20 then empty [] -> MUST mark ok: false, hasGaps: true (never false green!)
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (offset === 0) {
                        res.end(JSON.stringify({ steps: Array.from({ length: 20 }, (_, i) => ({ stepIndex: i })) }));
                    } else {
                        res.end(JSON.stringify({ steps: [] }));
                    }
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-short-50-gap', 50);
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.steps).toHaveLength(20);
                expect(res.error).toMatch(/empty steps page/i);
            });

            // Case D: multi-page variable byte-capped page sizes (20, 13, 30, 12 -> 75 steps total)
            const pageSizes = [20, 13, 30, 12];
            let callNum = 0;
            const offsetsB: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    offsetsB.push(offset);
                    const count = pageSizes[callNum++] ?? 0;
                    const steps = Array.from({ length: count }, (_, i) => ({
                        stepIndex: offset + i,
                        type: StepType.USER_INPUT,
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-variable-short', 75);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(75);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 75 }, (_, i) => i));
                expect(offsetsB).toEqual([0, 20, 33, 63]);
            });
        });

        it('repairs a short later concurrent batch in exact order without dropping or duplicating steps', async () => {
            const seenOffsets: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                        stepOffset?: number;
                        endIndex?: number;
                    };
                    const offset = body.stepOffset ?? 0;
                    seenOffsets.push(offset);
                    let count: number;
                    if (offset === 0) { count = 50; }
                    else if (offset === 50) { count = 20; } // Byte-capped short later batch!
                    else if (offset === 70) { count = 30; } // Repair slice [70..99]
                    else if (offset === 100) { count = 50; }
                    else { count = 0; }
                    const steps = Array.from({ length: count }, (_, i) => ({
                        stepIndex: offset + i,
                        type: StepType.USER_INPUT,
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-repair-later', 150);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(150);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 150 }, (_, i) => i));
                expect(seenOffsets).toContain(70);
            });
        });

        it('marks ok: false and hasGaps: true on empty later pages, malformed payloads, filtered elements, stuck cursors, and invalid totalSteps', async () => {
            // 1. Invalid / negative / non-integer / unbounded totalSteps
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps: [] }));
            }, async (ls) => {
                for (const badTotal of [-1, Number.NaN, Number.POSITIVE_INFINITY, 12.5, 500_000]) {
                    const res = await fetchTrajectorySteps(ls, 'c-bad-total', badTotal);
                    expect(res.ok, `badTotal=${String(badTotal)}`).toBe(false);
                    expect(res.hasGaps, `badTotal=${String(badTotal)}`).toBe(true);
                    expect(res.steps).toEqual([]);
                    expect(res.error).toBeTruthy();
                }
            });

            // 2. Fulfilled empty later page (`steps: []` at offset 50)
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (offset === 0) {
                        res.end(JSON.stringify({ steps: Array.from({ length: 50 }, (_, i) => ({ stepIndex: i })) }));
                    } else {
                        res.end(JSON.stringify({ steps: [] }));
                    }
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-empty-later', 100);
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.steps).toHaveLength(50);
                expect(res.error).toMatch(/empty steps page/i);

                const tokenUsage = await getTrajectoryTokenUsage(ls, 'c-empty-later', 100);
                expect(tokenUsage.hasGaps).toBe(true);
            });

            // 3. Fulfilled later page with malformed element filtered out (`[null, { stepIndex: 51 }]`)
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (offset === 0) {
                        res.end(JSON.stringify({ steps: Array.from({ length: 50 }, (_, i) => ({ stepIndex: i })) }));
                    } else {
                        res.end(JSON.stringify({ steps: [null, { stepIndex: 51, type: StepType.USER_INPUT }] }));
                    }
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-malformed-elem', 52);
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.steps.every(s => s && typeof s === 'object')).toBe(true);
                expect(res.error).toMatch(/malformed/i);
            });

            // 4. Fulfilled later page with non-array `steps` payload
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (offset === 0) {
                        res.end(JSON.stringify({ steps: Array.from({ length: 50 }, (_, i) => ({ stepIndex: i })) }));
                    } else {
                        res.end(JSON.stringify({ steps: 'corrupt-payload' }));
                    }
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-bad-shape', 100);
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.error).toMatch(/invalid steps payload/i);
            });

            // 5. Stuck / non-advancing cursor returning offset 0..19 again for offset 20
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps: Array.from({ length: 20 }, (_, i) => ({ stepIndex: i })) }));
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-stuck-cursor', 60);
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.steps).toHaveLength(20);
                expect(res.error).toMatch(/non-contiguous stepIndex/i);
            });
        });

        it('fetchTrajectoryGeneratorMetadataResult distinguishes proto3 empty from malformed/filtered GM entries', async () => {
            // Legitimately empty proto3 `{}` and `{ generatorMetadata: [] }`
            for (const payload of [{}, { generatorMetadata: [] }]) {
                await withHttpServer((_req, res) => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(payload));
                }, async (ls) => {
                    const res = await fetchTrajectoryGeneratorMetadataResult(ls, 'c-gm-empty');
                    expect(res).toEqual({ ok: true, metadata: [] });
                });
            }

            // Inconclusive / malformed top-level payloads (`null`, wrong type, error envelope)
            for (const payload of [
                { generatorMetadata: null },
                { generatorMetadata: 'not-an-array' },
                { code: 'internal', error: 'backend timeout' },
            ]) {
                await withHttpServer((_req, res) => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(payload));
                }, async (ls) => {
                    const res = await fetchTrajectoryGeneratorMetadataResult(ls, 'c-gm-bad-top');
                    expect(res.ok).toBe(false);
                    expect(res.metadata).toEqual([]);
                    expect(res.error).toBeTruthy();
                });
            }

            // Array with malformed elements filtered out -> MUST return ok: false so cache never latches
            await withHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    generatorMetadata: [
                        { stepIndices: [1, 2], chatModel: { usage: { inputTokens: 500 } } },
                        null,
                        { stepIndices: [-3], chatModel: { usage: { inputTokens: 100 } } },
                        { chatModel: 'not-an-object' },
                    ],
                }));
            }, async (ls) => {
                const res = await fetchTrajectoryGeneratorMetadataResult(ls, 'c-gm-filtered');
                expect(res.ok).toBe(false);
                expect(res.metadata).toHaveLength(1);
                expect(res.error).toMatch(/filtered 3 malformed/i);
            });
        });

        it('Issue #79: binary-searches earliest fitting suffix on v2.34+ oversize page-0 failure (<=8 probes, zero duplicate suffixes, recovers live context)', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const totalSteps = 1000;
            const fitThresholdOffset = 750; // [0..749] pushes total payload over cap; [750..999] fits!
            const seenOffsets: number[] = [];
            let inFlight = 0;
            let peakInFlight = 0;

            const makeV234Step = (stepIndex: number): Record<string, unknown> => {
                if (stepIndex === totalSteps - 1) {
                    return {
                        stepIndex,
                        type: StepType.PLANNER_RESPONSE,
                        plannerResponse: { response: 'latest answer' },
                        metadata: {
                            generatorModel: 'MODEL_PLACEHOLDER_M532',
                            modelUsage: {
                                model: 'MODEL_PLACEHOLDER_M532',
                                inputTokens: 42_000,
                                cacheReadTokens: 128_000,
                                outputTokens: 1_500,
                            },
                        },
                    };
                }
                // Earlier steps carry heavy tool payloads; tail steps [750..999] are compact.
                return {
                    stepIndex,
                    type: StepType.USER_INPUT,
                    userInput: { userResponse: stepIndex < fitThresholdOffset ? 'X'.repeat(300) : 'ok' },
                };
            };

            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                inFlight++;
                peakInFlight = Math.max(peakInFlight, inFlight);
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    seenOffsets.push(offset);
                    // Simulate Antigravity v2.34+ hub: IGNORES endIndex and returns ALL remaining steps [offset..totalSteps)
                    const steps = Array.from({ length: Math.max(0, totalSteps - offset) }, (_, i) => makeV234Step(offset + i));
                    setTimeout(() => {
                        inFlight--;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ steps }));
                    }, 5);
                });
            }, async (ls) => {
                // Cap = 24 KB: [750..999] (~15 KB) fits, [700..999] (~33 KB) exceeds cap, [0..999] (~270 KB) exceeds cap.
                const res = await fetchTrajectorySteps(ls, 'c-huge-v234', totalSteps, undefined, {
                    maxResponseBytes: 24 * 1024,
                });
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.error).toMatch(/RPC response exceeded \d+ bytes/i);
                expect(res.suffixStartOffset).toBe(fitThresholdOffset);
                expect(res.steps).toHaveLength(totalSteps - fitThresholdOffset);
                // Strictly contiguous, zero duplicates, all the way to the live tail step 999!
                expect(res.steps.map(s => s.stepIndex)).toEqual(
                    Array.from({ length: totalSteps - fitThresholdOffset }, (_, i) => fitThresholdOffset + i),
                );
                // Page 0 + at most 8 suffix probes, strictly sequential (no concurrent oversize bursts!)
                expect(seenOffsets[0]).toBe(0);
                expect(seenOffsets.length - 1).toBeLessThanOrEqual(8);
                expect(peakInFlight).toBe(1);

                // Verify live context/model metrics are recovered accurately from the suffix!
                const usage = processSteps(res.steps);
                expect(usage.model).toBe('MODEL_PLACEHOLDER_M532');
                expect(usage.tokenUsageSource).toBe('planner');
                expect(usage.contextUsed).toBe(42_000 + 128_000 + 1_500);
                expect(usage.lastModelUsage?.inputTokens).toBe(42_000);
            });
            expect(warnSpy).toHaveBeenCalled();

            // Fine-grained tail shrink when even the final STEP_BATCH_SIZE bucket [150..199] is oversize
            // (e.g. giant screenshot at step 192 -> recovers [193..199] cleanly within <= 8 probes!)
            const fineOffsets: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    fineOffsets.push(offset);
                    const steps = Array.from({ length: Math.max(0, 200 - offset) }, (_, i) => {
                        const idx = offset + i;
                        return {
                            stepIndex: idx,
                            type: StepType.USER_INPUT,
                            userInput: { userResponse: idx === 192 ? 'B'.repeat(20_000) : 's' },
                        };
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-huge-tail-spike', 200, undefined, {
                    maxResponseBytes: 8 * 1024,
                });
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.suffixStartOffset).toBe(193);
                expect(res.steps.map(s => s.stepIndex)).toEqual([193, 194, 195, 196, 197, 198, 199]);
                expect(fineOffsets.length - 1).toBeLessThanOrEqual(8);
            });

            // Legacy paginated server where ONLY page 0 [0..50) is oversize -> stitches [50..200) with zero duplicates
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                        stepOffset?: number;
                        endIndex?: number;
                    };
                    const offset = body.stepOffset ?? 0;
                    const end = Math.min(body.endIndex ?? (offset + 50), 200);
                    const steps = Array.from({ length: Math.max(0, end - offset) }, (_, i) => ({
                        stepIndex: offset + i,
                        type: StepType.USER_INPUT,
                        userInput: { userResponse: offset === 0 ? 'H'.repeat(500) : 'ok' },
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-paginated-p0-huge', 200, undefined, {
                    maxResponseBytes: 8 * 1024,
                });
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.suffixStartOffset).toBe(50);
                expect(res.steps).toHaveLength(150);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 150 }, (_, i) => 50 + i));
            });

            // Buggy hub ignoring stepOffset (returns stepIndex: 0 for offset > 0) -> stops safely without bogus steps
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    if (offset === 0) {
                        res.end(JSON.stringify({ steps: [{ stepIndex: 0, pad: 'Z'.repeat(20_000) }] }));
                    } else {
                        // Hub ignores stepOffset and wrongly returns stepIndex: 0!
                        res.end(JSON.stringify({ steps: [{ stepIndex: 0, type: StepType.USER_INPUT }] }));
                    }
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-ignores-offset', 200, undefined, {
                    maxResponseBytes: 4 * 1024,
                });
                expect(res.ok).toBe(false);
                expect(res.hasGaps).toBe(true);
                expect(res.steps).toEqual([]);
                expect(res.suffixStartOffset).toBeUndefined();
            });
        });

        it('Issue #79: short-circuits suffix-returning pagination loops without duplicate steps or concurrent multi-MB bursts', async () => {
            // Case A: Page 0 returns > STEP_BATCH_SIZE (80 of 240) -> paginates strictly sequentially (peakInFlight === 1)
            let inFlightA = 0;
            let peakInFlightA = 0;
            const offsetsA: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                inFlightA++;
                peakInFlightA = Math.max(peakInFlightA, inFlightA);
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    offsetsA.push(offset);
                    const count = Math.min(80, Math.max(0, 240 - offset));
                    const steps = Array.from({ length: count }, (_, i) => ({ stepIndex: offset + i, type: StepType.USER_INPUT }));
                    setTimeout(() => {
                        inFlightA--;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ steps }));
                    }, 10);
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-seq-oversize-p0', 240);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 240 }, (_, i) => i));
                expect(offsetsA).toEqual([0, 80, 160]);
                expect(peakInFlightA).toBe(1);
            });

            // Case B: Page 0 returns exact 50, then offset=50 ignores endIndex and returns full remaining suffix [50..399]
            // -> MUST short-circuit remaining ranges in group AND never fire group 2 (offset >= 300), zero duplicate steps!
            const offsetsB: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    offsetsB.push(offset);
                    const count = offset === 0 ? 50 : Math.max(0, 400 - offset);
                    const steps = Array.from({ length: count }, (_, i) => ({ stepIndex: offset + i, type: StepType.USER_INPUT }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-mid-suffix-shortcircuit', 400);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(400);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 400 }, (_, i) => i));
                // Group 2 (offset 300, 350) must NEVER be requested!
                expect(offsetsB.every(o => o < 300)).toBe(true);
            });

            // Case C: Page 0 returns exact 50, offset=50 returns 120 steps [50..169] (< totalSteps=250)
            // -> trims overlap, switches to sequential for [170..250), zero duplicates!
            const offsetsC: number[] = [];
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    offsetsC.push(offset);
                    let count: number;
                    if (offset === 0) { count = 50; }
                    else if (offset === 50) { count = 120; }
                    else { count = Math.min(50, Math.max(0, 250 - offset)); }
                    const steps = Array.from({ length: count }, (_, i) => ({ stepIndex: offset + i, type: StepType.USER_INPUT }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                const res = await fetchTrajectorySteps(ls, 'c-mid-switch-seq', 250);
                expect(res.ok).toBe(true);
                expect(res.hasGaps).toBe(false);
                expect(res.steps).toHaveLength(250);
                expect(res.steps.map(s => s.stepIndex)).toEqual(Array.from({ length: 250 }, (_, i) => i));
                expect(offsetsC).toContain(170);
                expect(offsetsC).toContain(220);
            });
        });

        it('Issue #79: poll byte budget preserves headroom for suffix recovery and GM metadata without starving background polls', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(DEFAULT_SWARM_POLL_BUDGET.maxBytes).toBeGreaterThanOrEqual(32 * 1024 * 1024);
            expect(DEFAULT_SWARM_POLL_BUDGET.maxConcurrency).toBeLessThanOrEqual(3);

            // Simulate a large active conversation (e.g. c0f223c6) exceeding the poll budget at offset=0,
            // while its live tail [250..299] is compact and GM metadata is lightweight.
            const totalSteps = 300;
            await withHttpServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    if (req.url?.endsWith('/GetCascadeTrajectoryGeneratorMetadata')) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            generatorMetadata: [{
                                stepIndices: [totalSteps - 1],
                                chatModel: {
                                    model: 'MODEL_PLACEHOLDER_M532',
                                    usage: { inputTokens: 88_000, outputTokens: 600 },
                                },
                            }],
                        }));
                        return;
                    }
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stepOffset?: number };
                    const offset = body.stepOffset ?? 0;
                    const steps = Array.from({ length: Math.max(0, totalSteps - offset) }, (_, i) => {
                        const idx = offset + i;
                        if (idx === totalSteps - 1) {
                            return {
                                stepIndex: idx,
                                type: StepType.PLANNER_RESPONSE,
                                plannerResponse: { response: 'done' },
                                metadata: {
                                    generatorModel: 'MODEL_PLACEHOLDER_M532',
                                    modelUsage: {
                                        model: 'MODEL_PLACEHOLDER_M532',
                                        inputTokens: 88_000,
                                        cacheReadTokens: 12_000,
                                        outputTokens: 600,
                                    },
                                },
                            };
                        }
                        return {
                            stepIndex: idx,
                            type: StepType.USER_INPUT,
                            userInput: { userResponse: idx < 250 ? 'A'.repeat(1_000) : 'tail' },
                        };
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                });
            }, async (ls) => {
                // Tight 48 KB poll budget: page 0 (~255 KB) aborts at 60% headroom cap (~28.8 KB),
                // leaving ~19 KB for suffix recovery ([250..299] ~4 KB) AND downstream GM metadata!
                await withTrajectoryPollBudget(
                    { maxRequests: 16, maxPages: 24, maxBytes: 48 * 1024, maxConcurrency: 3, maxElapsedMs: 5_000 },
                    async () => {
                        const usage = await getContextUsage(ls, {
                            cascadeId: 'c0f223c6-large-conv',
                            trajectoryId: 't-large',
                            summary: 'Large Session',
                            stepCount: totalSteps,
                            status: CascadeStatus.IDLE,
                            lastModifiedTime: '2026-11-27T10:00:00Z',
                            createdTime: '2026-11-27T09:00:00Z',
                            requestedModel: '',
                            generatorModel: '',
                            workspaceUris: [],
                            lastUserInputTime: '',
                            lastUserInputStepIndex: 0,
                            repositoryName: '',
                            gitOriginUrl: '',
                            branchName: '',
                            gitRootUri: '',
                        });
                        expect(usage.hasGaps).toBe(true);
                        expect(usage.suffixRecovered).toBe(true);
                        expect(usage.suffixStartOffset).toBeGreaterThanOrEqual(50);
                        expect(usage.model).toBe('MODEL_PLACEHOLDER_M532');
                        expect(usage.contextUsed).toBe(88_000 + 12_000 + 600);
                        expect(usage.lastModelUsage?.inputTokens).toBe(88_000);

                        // Downstream GM metadata in the exact same poll cycle MUST NOT be starved!
                        const snapBeforeGm = getTrajectoryPollBudgetSnapshot();
                        expect(snapBeforeGm).not.toBeNull();
                        expect(snapBeforeGm!.bytesLeft).toBeGreaterThan(0);

                        const gm = await fetchTrajectoryGeneratorMetadataResult(ls, 'c0f223c6-large-conv');
                        expect(gm.ok).toBe(true);
                        expect(gm.metadata).toHaveLength(1);
                    },
                );
            });
            expect(warnSpy).toHaveBeenCalled();

            // Background phase under withTrajectoryRequestShare hitting an oversize response
            // MUST abort at its phase byte share without starving the subsequent phase!
            await withHttpServer((req, res) => {
                req.resume();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (req.url?.endsWith('/GetCascadeTrajectorySteps')) {
                    res.end(JSON.stringify({ payload: 'B'.repeat(20_000) }));
                } else {
                    res.end(JSON.stringify({ generatorMetadata: [] }));
                }
            }, async (ls) => {
                await withTrajectoryPollBudget(
                    { maxRequests: 12, maxPages: 12, maxBytes: 10_000, maxConcurrency: 2, maxElapsedMs: 5_000 },
                    async () => {
                        await withTrajectoryRequestShare(async () => {
                            await expect(rpcCall(ls, 'GetCascadeTrajectorySteps', {}))
                                .rejects.toThrow(/byte budget/i);
                        });
                        // Next phase (e.g. GM tracker) still has ~50% byte budget left and succeeds!
                        const afterPhase = getTrajectoryPollBudgetSnapshot();
                        expect(afterPhase!.bytesLeft).toBeGreaterThan(0);
                        const gm = await fetchTrajectoryGeneratorMetadataResult(ls, 'c-bg-ok');
                        expect(gm.ok).toBe(true);
                    },
                );
            });
        });
    });


    // ─── W1A-FIX-7: PLANNER_RESPONSE compaction scoped to model/role/branch ──────

    describe('W1A-FIX-7: PLANNER_RESPONSE compaction detection scoped to same model, role, and branch', () => {
        const plannerStep = (
            model: string,
            inputTokens: number,
            extra: {
                stepIndex?: number;
                role?: string;
                branchId?: string;
                isSubagent?: boolean;
                cacheReadTokens?: number;
            } = {},
        ): Record<string, unknown> => ({
            ...(extra.stepIndex !== undefined ? { stepIndex: extra.stepIndex } : {}),
            type: StepType.PLANNER_RESPONSE,
            plannerResponse: { response: 'reply' },
            metadata: {
                generatorModel: model,
                ...(extra.role ? { role: extra.role } : {}),
                ...(extra.branchId ? { branchId: extra.branchId } : {}),
                ...(extra.isSubagent ? { isSubagent: true } : {}),
                modelUsage: {
                    model,
                    inputTokens,
                    cacheReadTokens: extra.cacheReadTokens ?? 0,
                    outputTokens: 300,
                },
            },
        });

        it('never triggers false compaction when switching between different models', () => {
            const res = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 1 }),
                plannerStep('MODEL_PLACEHOLDER_M401', 35_000, { stepIndex: 3 }),
            ]);
            expect(res.checkpointCompressionDetected).toBe(false);
            expect(res.checkpointCompressionDrop).toBe(0);
        });

        it('detects compaction across alias-equivalent spellings of the same canonical model', () => {
            const res = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M528', 180_000, { stepIndex: 1 }),
                plannerStep('gemini-4-hydrogen-xhigh', 35_000, { stepIndex: 3 }),
            ]);
            expect(res.checkpointCompressionDetected).toBe(true);
            expect(res.checkpointCompressionDrop).toBe(145_000);
        });

        it('never triggers false compaction across different roles or branches even on the same model', () => {
            // Different roles on the exact same model
            const diffRole = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 1, role: 'planner' }),
                plannerStep('MODEL_PLACEHOLDER_M532', 35_000, { stepIndex: 3, role: 'reviewer' }),
            ]);
            expect(diffRole.checkpointCompressionDetected).toBe(false);
            expect(diffRole.checkpointCompressionDrop).toBe(0);

            // Explicit subagent step on the same model
            const subagentStep = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 1 }),
                plannerStep('MODEL_PLACEHOLDER_M532', 20_000, { stepIndex: 3, isSubagent: true }),
            ]);
            expect(subagentStep.checkpointCompressionDetected).toBe(false);
            expect(subagentStep.checkpointCompressionDrop).toBe(0);

            // Different branches directly on PLANNER_RESPONSE
            const diffBranch = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 1, branchId: 'branch-a' }),
                plannerStep('MODEL_PLACEHOLDER_M532', 35_000, { stepIndex: 3, branchId: 'branch-b' }),
            ]);
            expect(diffBranch.checkpointCompressionDetected).toBe(false);
            expect(diffBranch.checkpointCompressionDrop).toBe(0);

            // Branch change carried on intervening USER_INPUT
            const branchOnUserInput = processSteps([
                { type: StepType.USER_INPUT, metadata: { branchId: 'main' }, userInput: { userResponse: 'turn 1' } },
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 1 }),
                { type: StepType.USER_INPUT, metadata: { branchId: 'fork-1' }, userInput: { userResponse: 'fork turn' } },
                plannerStep('MODEL_PLACEHOLDER_M532', 35_000, { stepIndex: 3 }),
            ]);
            expect(branchOnUserInput.checkpointCompressionDetected).toBe(false);
            expect(branchOnUserInput.checkpointCompressionDrop).toBe(0);

            // Non-monotonic stepIndex (rewind) on same model
            const rewound = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 10 }),
                plannerStep('MODEL_PLACEHOLDER_M532', 35_000, { stepIndex: 6 }),
            ]);
            expect(rewound.checkpointCompressionDetected).toBe(false);
            expect(rewound.checkpointCompressionDrop).toBe(0);
        });

        it('preserves planner baseline across intervening delegated executor steps and detects genuine same-model compaction', () => {
            const res = processSteps([
                {
                    type: StepType.USER_INPUT,
                    stepIndex: 0,
                    userInput: {
                        userResponse: 'Orchestrated task',
                        userConfig: {
                            plannerConfig: {
                                planModel: 'MODEL_PLACEHOLDER_M401',
                                planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' },
                            },
                        },
                    },
                },
                plannerStep('MODEL_PLACEHOLDER_M401', 180_000, { stepIndex: 1 }),
                plannerStep('MODEL_PLACEHOLDER_M528', 15_000, { stepIndex: 2 }), // delegated executor: ignored
                plannerStep('MODEL_PLACEHOLDER_M401', 40_000, { stepIndex: 3 }), // same planner model/role/branch: real compaction!
            ]);
            expect(res.checkpointCompressionDetected).toBe(true);
            expect(res.checkpointCompressionDrop).toBe(140_000);
        });

        it('never detects compaction when model identity is unknown or when a known-model step is followed by an unknown-model step', () => {
            // Both unknown
            const bothUnknown = processSteps([
                plannerStep('', 180_000, { stepIndex: 1 }),
                plannerStep('', 30_000, { stepIndex: 3 }),
            ]);
            expect(bothUnknown.checkpointCompressionDetected).toBe(false);
            expect(bothUnknown.checkpointCompressionDrop).toBe(0);

            // Known-model step followed by unknown-model low-token step MUST NOT inherit prior conversation model
            const knownThenUnknown = processSteps([
                plannerStep('MODEL_PLACEHOLDER_M532', 180_000, { stepIndex: 1 }),
                {
                    stepIndex: 3,
                    type: StepType.PLANNER_RESPONSE,
                    plannerResponse: { response: 'reply without model metadata' },
                    metadata: {
                        modelUsage: {
                            inputTokens: 30_000,
                            outputTokens: 300,
                        },
                    },
                },
            ]);
            expect(knownThenUnknown.checkpointCompressionDetected).toBe(false);
            expect(knownThenUnknown.checkpointCompressionDrop).toBe(0);

            // CHECKPOINT: known model vs unknown model MUST NOT trigger false compaction
            const ckptKnownThenUnknown = processSteps([
                {
                    stepIndex: 1,
                    type: StepType.CHECKPOINT,
                    metadata: { modelUsage: { model: 'MODEL_PLACEHOLDER_M50', inputTokens: 180_000, outputTokens: 100 } },
                },
                {
                    stepIndex: 3,
                    type: StepType.CHECKPOINT,
                    metadata: { modelUsage: { inputTokens: 30_000, outputTokens: 100 } },
                },
            ]);
            expect(ckptKnownThenUnknown.checkpointCompressionDetected).toBe(false);
            expect(ckptKnownThenUnknown.checkpointCompressionDrop).toBe(0);

            // CHECKPOINT: legacy model-less checkpoints (both '') still detect genuine compaction
            const ckptLegacyBothModelLess = processSteps([
                {
                    stepIndex: 1,
                    type: StepType.CHECKPOINT,
                    metadata: { modelUsage: { inputTokens: 180_000, outputTokens: 100 } },
                },
                {
                    stepIndex: 3,
                    type: StepType.CHECKPOINT,
                    metadata: { modelUsage: { inputTokens: 30_000, outputTokens: 100 } },
                },
            ]);
            expect(ckptLegacyBothModelLess.checkpointCompressionDetected).toBe(true);
            expect(ckptLegacyBothModelLess.checkpointCompressionDrop).toBe(150_000);
        });
    });


    // ─── W1A-FIX-6: RPC error excerpt redaction & safe truncation ────────────────

    describe('W1A-FIX-6: rpc-client error redaction and safe truncation', () => {
        it('redacts headers, tokens, JWTs, query params, URL credentials, PEM keys, and control chars before truncating', () => {
            const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456_sig';
            const csrf = 'super-secret-csrf-token-xyz';
            const raw = [
                'Authorization: Bearer sk-ant-secret1234567890abcdef',
                `x-codeium-csrf-token: ${csrf}`,
                `{"accessToken":"ya29.a0AfH6SMB_secret_oauth_token","code":"permission_denied","csrfToken":"${csrf}"}`,
                `https://alice:topsecretpass@internal.local/api?api_key=AIzaSyA1234567890abcdefghijk&ok=1`,
                `jwt=${jwt}`,
                'line1\r\nFAKE_LOG_INJECTION\t\x07',
            ].join(' | ');

            const redacted = redactRpcErrorExcerpt(raw, { maxLength: 400, knownSecrets: [csrf] });
            expect(redacted).not.toContain('sk-ant-secret');
            expect(redacted).not.toContain(csrf);
            expect(redacted).not.toContain('ya29.a0AfH6SMB');
            expect(redacted).not.toContain('topsecretpass');
            expect(redacted).not.toContain('AIzaSyA1234567890');
            expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
            expect(redacted).not.toMatch(/[\r\n\t\x07]/);
            expect(redacted).toContain('[REDACTED]');
            expect(redacted.length).toBeLessThanOrEqual(400);

            // Secret straddling the truncation boundary (200 chars) must be redacted BEFORE truncation
            const prefix = 'x'.repeat(185);
            const straddling = `${prefix} Bearer ya29.superSecretOAuthTokenValue1234567890`;
            const truncated = redactRpcErrorExcerpt(straddling, { maxLength: 200 });
            expect(truncated.length).toBeLessThanOrEqual(200);
            expect(truncated).not.toContain('ya29.');
            expect(truncated).not.toContain('superSecret');

            // Full Cookie / Set-Cookie header values (multiple semicolon-separated pairs) must be redacted completely
            const cookieHeaders = [
                'HTTP/1.1 401 Unauthorized',
                'Cookie: pref=en; sid=COOKIE_SECRET_VALUE_12345; theme=dark',
                'Set-Cookie: session=SETCOOKIE_SECRET_67890; Path=/; HttpOnly; Secure',
                'X-Trace-Id: trace-ok-42',
            ].join('\r\n');
            const redactedCookies = redactRpcErrorExcerpt(cookieHeaders, { maxLength: 400 });
            expect(redactedCookies).not.toContain('COOKIE_SECRET_VALUE_12345');
            expect(redactedCookies).not.toContain('SETCOOKIE_SECRET_67890');
            expect(redactedCookies).not.toContain('pref=en');
            expect(redactedCookies).not.toContain('theme=dark');
            expect(redactedCookies).toContain('Cookie: [REDACTED]');
            expect(redactedCookies).toContain('Set-Cookie: [REDACTED]');
            expect(redactedCookies).toContain('X-Trace-Id: trace-ok-42');
        });

        it('redacts sensitive tokens in rpcCall HTTP errors and JSON parse errors', async () => {
            const csrf = 'loopback-csrf-sentinel-99887766';
            await withHttpServer((req, res) => {
                req.resume();
                if (req.url?.endsWith('/BadHttp')) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'unauthorized',
                        header: `Authorization: Bearer ghp_1234567890abcdef1234567890`,
                        csrfToken: csrf,
                    }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(`not-json x-codeium-csrf-token=${csrf} Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig123456`);
            }, async (ls) => {
                await expect(rpcCall(ls, 'BadHttp', {})).rejects.toThrow(/RPC HTTP 401:/);
                try {
                    await rpcCall(ls, 'BadHttp', {});
                    expect.unreachable('should have thrown');
                } catch (err) {
                    const msg = (err as Error).message;
                    expect(msg).not.toContain(csrf);
                    expect(msg).not.toContain('ghp_1234567890');
                    expect(msg).toContain('[REDACTED]');
                }

                try {
                    await rpcCall(ls, 'BadJson', {});
                    expect.unreachable('should have thrown');
                } catch (err) {
                    const msg = (err as Error).message;
                    expect(msg).toMatch(/Failed to parse RPC response:/);
                    expect(msg).not.toContain(csrf);
                    expect(msg).not.toContain('eyJhbGciOiJIUzI1NiJ9');
                    expect(msg).toContain('[REDACTED]');
                }
            }, csrf);
        });

        it('redacts sensitive tokens in rpcStreamFirstFrame and decodeConnectFirstFrame errors', async () => {
            const csrf = 'stream-csrf-sentinel-55443322';
            await withHttpServer((req, res) => {
                req.resume();
                if (req.url?.endsWith('/StreamHttpErr')) {
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    res.end(`Forbidden: x-codeium-csrf-token: ${csrf}; Authorization: Bearer sk-proj-secretvalue1234567890`);
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                res.end(encodeConnectFrame(JSON.stringify({
                    error: { code: 'unauthenticated', message: `invalid token ${csrf} Bearer ya29.secret_stream_token_12345` },
                }), 0x02));
            }, async (ls) => {
                try {
                    await rpcStreamFirstFrame(ls, 'StreamHttpErr', {});
                    expect.unreachable('should have thrown');
                } catch (err) {
                    const msg = (err as Error).message;
                    expect(msg).toMatch(/RPC stream HTTP 403:/);
                    expect(msg).not.toContain(csrf);
                    expect(msg).not.toContain('sk-proj-secretvalue');
                    expect(msg).toContain('[REDACTED]');
                }

                try {
                    await rpcStreamFirstFrame(ls, 'StreamEndErr', {});
                    expect.unreachable('should have thrown');
                } catch (err) {
                    const msg = (err as Error).message;
                    expect(msg).toMatch(/RPC stream ended without data:/);
                    expect(msg).not.toContain(csrf);
                    expect(msg).not.toContain('ya29.secret_stream_token');
                    expect(msg).toContain('[REDACTED]');
                }
            }, csrf);

            // decodeConnectFirstFrame invalid JSON and non-object payload must redact secrets BEFORE truncation,
            // including when a raw ls.csrfToken straddles the 200-char truncation cutoff in rpcStreamFirstFrame!
            const straddleCsrf = 'RAW_STRADDLE_CSRF_SECRET_TOKEN_987654321';
            const pad = 'z'.repeat(185);
            await withHttpServer((req, res) => {
                req.resume();
                res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                if (req.url?.endsWith('/StreamStraddleJson')) {
                    res.end(encodeConnectFrame(`not-json ${pad}${straddleCsrf}`));
                    return;
                }
                res.end(encodeConnectFrame(JSON.stringify([`${pad}${straddleCsrf}`])));
            }, async (ls) => {
                try {
                    await rpcStreamFirstFrame(ls, 'StreamStraddleJson', {});
                    expect.unreachable('should have thrown');
                } catch (err) {
                    const msg = (err as Error).message;
                    expect(msg).toMatch(/Failed to parse Connect stream payload:/);
                    expect(msg).not.toContain('RAW_STRADDLE');
                    expect(msg).not.toContain(straddleCsrf.slice(0, 8));
                }

                try {
                    await rpcStreamFirstFrame(ls, 'StreamStraddleArray', {});
                    expect.unreachable('should have thrown');
                } catch (err) {
                    const msg = (err as Error).message;
                    expect(msg).toMatch(/Unexpected Connect stream payload:/);
                    expect(msg).not.toContain('RAW_STRADDLE');
                    expect(msg).not.toContain(straddleCsrf.slice(0, 8));
                }
            }, straddleCsrf);

            const badJsonFrame = encodeConnectFrame('not-json Authorization: Bearer sk-ant-streamleak1234567890abcdef');
            expect(() => decodeConnectFirstFrame(badJsonFrame)).toThrow(/Failed to parse Connect stream payload:/);
            try {
                decodeConnectFirstFrame(badJsonFrame);
            } catch (err) {
                expect((err as Error).message).not.toContain('sk-ant-streamleak');
                expect((err as Error).message).toContain('[REDACTED]');
            }

            const arrayFrame = encodeConnectFrame('["Bearer sk-ant-arrayleak1234567890abcdef"]');
            try {
                decodeConnectFirstFrame(arrayFrame);
                expect.unreachable('should have thrown');
            } catch (err) {
                expect((err as Error).message).toMatch(/Unexpected Connect stream payload:/);
                expect((err as Error).message).not.toContain('sk-ant-arrayleak');
                expect((err as Error).message).toContain('[REDACTED]');
            }
        });
    });


    // ─── W1A-FIX-8 #1 & #2: macOS APFS mount-point/indeterminate & WSL authority ─

    describe('W1A-FIX-8 #1: macOS APFS probe preserves case when indeterminate and avoids parent-volume lookup at mount points', () => {
        it('preserves original case on darwin whenever probe is indeterminate (returns null)', () => {
            const res = normalizeWorkspaceUri('file:///Volumes/MountedAPFS/MyProject/', {
                platform: 'darwin',
                isCaseSensitivePath: () => null,
            });
            expect(res).toBe('/Volumes/MountedAPFS/MyProject');
            expect(res).not.toBe('/volumes/mountedapfs/myproject');
        });

        it('never looks up alternate spelling on the parent volume at a mount point and never caches parent sensitivity under the mounted device', () => {
            const queriedPaths: string[] = [];
            // Parent `/Volumes` is on dev=1 (case-insensitive); mounted `/Volumes/CaseSens` is on dev=42 (case-sensitive).
            const statMock = (targetPath: string) => {
                queriedPaths.push(targetPath);
                if (targetPath === '/Volumes') { return { dev: 1, ino: 10 }; }
                if (targetPath === '/Volumes/CaseSens') { return { dev: 42, ino: 2 }; }
                if (targetPath === '/Volumes/cASEsENS') {
                    // If probed on parent case-insensitive `/Volumes`, macOS would resolve to the same mount inode!
                    return { dev: 42, ino: 2 };
                }
                if (targetPath === '/Volumes/CaseSens/2026') { return { dev: 42, ino: 300 }; }
                if (targetPath === '/Volumes/CaseSens/Repo') { return { dev: 42, ino: 400 }; }
                const err = new Error('ENOENT') as NodeJS.ErrnoException;
                err.code = 'ENOENT';
                throw err;
            };

            // 1. Mount point itself without readdirSync: must NOT query `/Volumes/cASEsENS` and must return null
            expect(detectPathCaseSensitivity('/Volumes/CaseSens', { statSync: statMock })).toBeNull();
            expect(queriedPaths).not.toContain('/Volumes/cASEsENS');

            // 2. Numeric child on mount point (walks up to mount boundary): still must NOT query `/Volumes/cASEsENS`
            queriedPaths.length = 0;
            expect(detectPathCaseSensitivity('/Volumes/CaseSens/2026', { statSync: statMock })).toBeNull();
            expect(queriedPaths).not.toContain('/Volumes/cASEsENS');

            // 3. Mount point WITH readdirSync exposing a same-device child `'Repo'`: probes inside dev=42 -> true!
            queriedPaths.length = 0;
            expect(detectPathCaseSensitivity('/Volumes/CaseSens', {
                statSync: statMock,
                readdirSync: (p) => (p === '/Volumes/CaseSens' ? ['Repo'] : []),
            })).toBe(true);
            expect(queriedPaths).not.toContain('/Volumes/cASEsENS');
            expect(queriedPaths).toContain('/Volumes/CaseSens/rEPO');

            // 4. Exercise real internal `volumeCaseSensitivityCache` with useCache: true: mount-point probe MUST NOT poison dev=42!
            resetPathCaseSensitivityCache();
            queriedPaths.length = 0;
            expect(detectPathCaseSensitivity('/Volumes/CaseSens', {
                statSync: statMock,
                readdirSync: () => [],
                useCache: true,
            })).toBeNull();
            expect(queriedPaths).not.toContain('/Volumes/cASEsENS');
            // Subsequent probe of an actual child on dev=42 must see true (not poisoned false) and populate cache!
            expect(detectPathCaseSensitivity('/Volumes/CaseSens/Repo', {
                statSync: statMock,
                useCache: true,
            })).toBe(true);
            // Once cached from a verified same-device probe, subsequent mount-point lookup returns true from cache.
            expect(detectPathCaseSensitivity('/Volumes/CaseSens', {
                statSync: statMock,
                readdirSync: () => [],
                useCache: true,
            })).toBe(true);
        });

        it('returns null instead of falling back onto /Volumes for an unmounted /Volumes/<name>/... path', () => {
            const queried: string[] = [];
            const probe = detectPathCaseSensitivity('/Volumes/UnmountedCS/MyRepo', {
                statSync(targetPath) {
                    queried.push(targetPath);
                    if (targetPath === '/Volumes' || targetPath === '/vOLUMES') {
                        return { dev: 1, ino: 10 };
                    }
                    const err = new Error('ENOENT') as NodeJS.ErrnoException;
                    err.code = 'ENOENT';
                    throw err;
                },
            });
            expect(probe).toBeNull();
            expect(queried).not.toContain('/vOLUMES');
        });
    });


    describe('W1A-FIX-8 #2: WSL path normalization preserves distro authority, POSIX case, and translates \\\\wsl$ / \\\\wsl.localhost aliases', () => {
        it('preserves distinct WSL distro authorities so Ubuntu and Debian never collide', () => {
            const ubuntu = normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/Dev/MyApp/', 'win32');
            const ubuntuEncoded = normalizeWorkspaceUri('vscode-remote://wsl%2BUBUNTU/home/Dev/MyApp', 'win32');
            const debian = normalizeWorkspaceUri('vscode-remote://wsl+Debian/home/Dev/MyApp/', 'win32');

            expect(ubuntu).toBe('vscode-remote://wsl+ubuntu/home/Dev/MyApp');
            expect(ubuntuEncoded).toBe(ubuntu);
            expect(debian).toBe('vscode-remote://wsl+debian/home/Dev/MyApp');
            expect(ubuntu).not.toBe(debian);

            // tracker.ts normalizeUri delegates consistently
            expect(normalizeUri('vscode-remote://wsl+Ubuntu/home/Dev/MyApp/', 'win32')).toBe(ubuntu);
            expect(normalizeUri('vscode-remote://wsl+Debian/home/Dev/MyApp/', 'win32')).toBe(debian);
        });

        it('preserves POSIX case sensitivity for WSL paths even on win32 and darwin', () => {
            const upper = normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/Dev/MyApp', 'win32');
            const lower = normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/dev/myapp', 'win32');
            expect(upper).not.toBe(lower);

            const uncUpper = normalizeWorkspaceUri('\\\\wsl$\\Ubuntu\\home\\Dev\\MyApp', 'win32');
            const uncLower = normalizeWorkspaceUri('\\\\wsl$\\Ubuntu\\home\\dev\\myapp', 'win32');
            expect(uncUpper).toBe(upper);
            expect(uncLower).toBe(lower);
            expect(uncUpper).not.toBe(uncLower);
        });

        it('translates \\\\wsl$, \\\\wsl.localhost, and file://wsl* aliases only after matching distro authority', () => {
            const canonical = 'vscode-remote://wsl+ubuntu/home/Dev/My App';
            for (const variant of [
                'vscode-remote://wsl+Ubuntu/home/Dev/My%20App/',
                'vscode-remote://wsl%2BUbuntu/home/Dev/My%20App',
                '\\\\wsl$\\Ubuntu\\home\\Dev\\My App\\',
                '\\\\wsl.localhost\\Ubuntu\\home\\Dev\\My App\\',
                '\\\\?\\UNC\\wsl.localhost\\Ubuntu\\home\\Dev\\My App',
                '//wsl$/Ubuntu/home/Dev/My App/',
                '//wsl.localhost/Ubuntu/home/Dev/My App',
                'file://wsl$/Ubuntu/home/Dev/My%20App/',
                'file://wsl%24/Ubuntu/home/Dev/My%20App/',
                'file://wsl.localhost/Ubuntu/home/Dev/My%20App/',
            ]) {
                expect(normalizeWorkspaceUri(variant, 'win32'), variant).toBe(canonical);
                expect(normalizeWorkspaceUri(variant, 'linux'), variant).toBe(canonical);
            }

            // Different distro via \\wsl$ / \\wsl.localhost MUST NOT match Ubuntu
            expect(normalizeWorkspaceUri('\\\\wsl$\\Debian\\home\\Dev\\My App', 'win32'))
                .toBe('vscode-remote://wsl+debian/home/Dev/My App');
            expect(normalizeWorkspaceUri('\\\\wsl.localhost\\Debian\\home\\Dev\\My App', 'win32'))
                .toBe('vscode-remote://wsl+debian/home/Dev/My App');
            expect(normalizeWorkspaceUri('\\\\wsl$\\Debian\\home\\Dev\\My App', 'win32'))
                .not.toBe(canonical);

            // Optional explicit wslDistro scopes local POSIX paths only to that matching distro
            expect(normalizeWorkspaceUri('file:///home/Dev/My%20App/', { platform: 'linux', wslDistro: 'Ubuntu' }))
                .toBe(canonical);
            expect(normalizeWorkspaceUri('file:///home/Dev/My%20App/', { platform: 'linux', wslDistro: 'Debian' }))
                .not.toBe(canonical);
            // Normal non-WSL Windows SMB UNC shares remain unaffected
            expect(normalizeWorkspaceUri('\\\\fileserver\\Share\\Project\\', 'win32'))
                .toBe('//fileserver/share/project');
        });

        it('isolates Ubuntu vs Debian workspaces in matchesAnyWorkspace and resolveIdeAutoFollowConversation on win32', () => {
            const ubuntuIdle = makeTrajectory('ubuntu-idle', {
                workspaceUris: ['\\\\wsl.localhost\\Ubuntu\\home\\Dev\\App'],
                lastModifiedTime: '2026-11-27T10:00:00Z',
            });
            const debianRunning = makeTrajectory('debian-running', {
                workspaceUris: ['\\\\wsl$\\Debian\\home\\Dev\\App'],
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-27T10:05:00Z',
            });
            const ubuntuLowercaseRunning = makeTrajectory('ubuntu-lowercase', {
                workspaceUris: ['\\\\wsl$\\Ubuntu\\home\\dev\\app'],
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-27T10:06:00Z',
            });

            const roots = ['vscode-remote://wsl+Ubuntu/home/Dev/App'];
            expect(matchesAnyWorkspace(ubuntuIdle, roots, 'win32')).toBe(true);
            expect(matchesAnyWorkspace(debianRunning, roots, 'win32')).toBe(false);
            expect(matchesAnyWorkspace(ubuntuLowercaseRunning, roots, 'win32')).toBe(false);

            const resolved = resolveIdeAutoFollowConversation({
                trajectories: [ubuntuLowercaseRunning, debianRunning, ubuntuIdle],
                workspaceUris: roots,
                currentActiveId: 'ubuntu-idle',
                platform: 'win32',
            });
            expect(resolved.cascadeId).toBe('ubuntu-idle');
        });
    });
});

describe('[conversation-selector]', () => {
    function makeTrajectory(
        cascadeId: string,
        overrides: Partial<ConversationTrajectoryLike> = {},
    ): ConversationTrajectoryLike {
        return {
            cascadeId,
            trajectoryId: `traj-${cascadeId}`,
            summary: `Conversation ${cascadeId}`,
            stepCount: 5,
            status: 'CASCADE_RUN_STATUS_IDLE',
            lastModifiedTime: '2026-11-22T10:00:00.000Z',
            createdTime: '2026-11-22T09:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M532',
            generatorModel: 'MODEL_PLACEHOLDER_M532',
            workspaceUris: ['file:///Users/dev/antigravity'],
            ...overrides,
        };
    }


    describe('isSubagentTrajectory', () => {
        it('detects subagent / swarm / child trajectories cleanly across metadata fields and prefixes', () => {
            expect(isSubagentTrajectory(makeTrajectory('c1', { isSubagent: true }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c2', { parentCascadeId: 'main-1' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c3', { trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c4', { trajectoryType: 'SWARM_WORKER' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c5', { trajectoryMetadata: { parentCascadeId: 'main-1' } }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c6', { trajectoryMetadata: { isChild: true } }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c7', { trajectoryMetadata: { role: 'worker', swarmId: 's1' } }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c8', { trajectoryMetadata: { spawnedBy: 'coordinator' } }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c9', { summary: '[Subagent] Audit repo architecture' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c10', { summary: '[Swarm: telemetry-architect] Build modules' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c11', { summary: 'Subagent: inspect RPC payloads' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c12', { summary: 'swarm-telemetry-architect-22593eb9' }))).toBe(true);
            expect(isSubagentTrajectory(makeTrajectory('c13'), new Set(['c13']))).toBe(true);
        });

        it('never triggers false positives on normal user chats discussing subagents or swarms', () => {
            expect(isSubagentTrajectory(makeTrajectory('u1', {
                summary: 'How do I design a subagent swarm architecture in TypeScript?',
                trajectoryType: 'TRAJECTORY_TYPE_MAIN',
            }))).toBe(false);
            expect(isSubagentTrajectory(makeTrajectory('u2', {
                summary: 'Add Lock to Main Agent toggle to ignore subagent bursts',
            }))).toBe(false);
            expect(isSubagentTrajectory(makeTrajectory('u3', {
                summary: 'Fix parentCascadeId and worker timeout handling',
                trajectoryMetadata: { swarmId: 's1', role: 'coordinator' },
            }))).toBe(false);
            // Self-referential parent ID does not misclassify as child
            expect(isSubagentTrajectory(makeTrajectory('u4', { parentCascadeId: 'u4' }))).toBe(false);
            expect(isSubagentTrajectory(makeTrajectory('u5', { summary: '' }))).toBe(false);
            expect(isSubagentTrajectory(null)).toBe(false);
            // §3.3: unknown role MUST NOT auto-classify as worker even with swarmId!
            expect(isSubagentTrajectory(makeTrajectory('u6', {
                trajectoryMetadata: { swarmId: 's1', role: 'reviewer' },
            }))).toBe(false);
            // §3.3: forked chat retaining parentCascadeId is NOT a subagent!
            expect(isSubagentTrajectory(makeTrajectory('u7', {
                parentCascadeId: 'main-root',
                isFork: true,
            }))).toBe(false);
            // §3.3: explicit coordinator role is NEVER overridden by swarm-* branch/worktree/title!
            expect(isSubagentTrajectory(makeTrajectory('u8', {
                summary: '[Swarm] Coord chat',
                branchName: 'swarm-coord-1234abcd',
                trajectoryMetadata: { role: 'coordinator' },
            }))).toBe(false);
        });
    });


    describe('normalizeWorkspaceUri', () => {
        it('normalizes Windows URIs, encoded colons, backslashes, and UNC paths identically', () => {
            const expected = 'c:/users/alice/my repo';
            expect(normalizeWorkspaceUri('file:///C:/Users/Alice/My%20Repo/', 'win32')).toBe(expected);
            expect(normalizeWorkspaceUri('file:///c%3A/Users/Alice/My%20Repo', 'win32')).toBe(expected);
            expect(normalizeWorkspaceUri('C:\\Users\\Alice\\My Repo\\', 'win32')).toBe(expected);
            // Windows paths still normalize consistently even when tested on Linux/macOS
            expect(normalizeWorkspaceUri('file:///C:/Users/Alice/My%20Repo', 'linux')).toBe(expected);
            expect(normalizeWorkspaceUri('C:\\Users\\Alice\\My Repo', 'darwin')).toBe(expected);

            expect(normalizeWorkspaceUri('file://fileserver/Share/Project/', 'win32')).toBe('//fileserver/share/project');
            expect(normalizeWorkspaceUri('\\\\fileserver\\Share\\Project\\', 'win32')).toBe('//fileserver/share/project');
        });

        it('handles macOS case-insensitivity/indeterminate preservation, Linux case-sensitivity, and vscode-remote/WSL URIs', () => {
            expect(normalizeWorkspaceUri('file:///Users/Alice/Desktop/Repo/', { platform: 'darwin', caseSensitive: false }))
                .toBe(normalizeWorkspaceUri('/users/alice/desktop/repo', { platform: 'darwin', caseSensitive: false }));
            expect(normalizeWorkspaceUri('file:///Volumes/Unknown/Repo/', { platform: 'darwin', isCaseSensitivePath: () => null }))
                .toBe('/Volumes/Unknown/Repo');

            expect(normalizeWorkspaceUri('file:///home/Alice/Repo/', 'linux')).toBe('/home/Alice/Repo');
            expect(normalizeWorkspaceUri('file:///home/alice/repo/', 'linux')).toBe('/home/alice/repo');
            expect(normalizeWorkspaceUri('file:///home/Alice/Repo', 'linux'))
                .not.toBe(normalizeWorkspaceUri('file:///home/alice/repo', 'linux'));

            expect(normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/Alice/Repo/', 'linux'))
                .toBe('vscode-remote://wsl+ubuntu/home/Alice/Repo');
            expect(normalizeWorkspaceUri('\\\\wsl$\\Ubuntu\\home\\Alice\\Repo\\', 'win32'))
                .toBe('vscode-remote://wsl+ubuntu/home/Alice/Repo');
            expect(normalizeWorkspaceUri('\\\\wsl.localhost\\Ubuntu\\home\\Alice\\Repo\\', 'win32'))
                .toBe('vscode-remote://wsl+ubuntu/home/Alice/Repo');
            expect(normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/Alice/Repo/', 'win32'))
                .not.toBe(normalizeWorkspaceUri('vscode-remote://wsl+Debian/home/Alice/Repo/', 'win32'));
            expect(normalizeWorkspaceUri('vscode-remote://ssh-remote+dev/srv/app%20one/', 'linux'))
                .toBe('vscode-remote://ssh-remote+dev/srv/app one');
            expect(normalizeWorkspaceUri('   ', 'darwin')).toBe('');
        });
    });


    describe('resolveTargetConversation', () => {
        it('handles empty trajectory lists cleanly', () => {
            const res = resolveTargetConversation({ trajectories: [], pinnedId: 'missing' });
            expect(res.target).toBeNull();
            expect(res.cascadeId).toBeNull();
            expect(res.pinnedFallback).toBe(true);
            expect(res.reason).toBe('empty_trajectories');
        });

        it('respects manual pin and falls back cleanly when pinnedId is deleted/missing', () => {
            const mainA = makeTrajectory('main-a', { lastModifiedTime: '2026-11-22T10:00:00Z' });
            const mainB = makeTrajectory('main-b', {
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-22T10:05:00Z',
            });

            const pinned = resolveTargetConversation({
                trajectories: [mainA, mainB],
                pinnedId: 'main-a',
                hostConversationId: 'main-b',
            });
            expect(pinned.mode).toBe('pinned');
            expect(pinned.cascadeId).toBe('main-a');
            expect(pinned.pinnedFallback).toBe(false);

            const deletedPin = resolveTargetConversation({
                trajectories: [mainA, mainB],
                pinnedId: 'deleted-id',
                hostConversationId: 'main-b',
            });
            expect(deletedPin.mode).toBe('auto_follow');
            expect(deletedPin.cascadeId).toBe('main-b');
            expect(deletedPin.pinnedFallback).toBe(true);
        });

        it('Lock to Main Agent ignores subagent bursts (both RUNNING subagents and subagent hostConversationId)', () => {
            const main = makeTrajectory('main-1', {
                status: 'CASCADE_RUN_STATUS_IDLE',
                lastModifiedTime: '2026-11-22T10:00:00Z',
            });
            const sub1 = makeTrajectory('sub-1', {
                parentCascadeId: 'main-1',
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-22T10:05:00Z',
            });
            const sub2 = makeTrajectory('sub-2', {
                trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT',
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-22T10:06:00Z',
            });

            // Subagent burst with hostConversationId hijacked to sub-2
            const locked = resolveTargetConversation({
                trajectories: [sub2, sub1, main],
                lockToMainAgent: true,
                lockedMainId: 'main-1',
                hostConversationId: 'sub-2',
                workspaceUris: ['/Users/dev/antigravity'],
                platform: 'darwin',
            });
            expect(locked.mode).toBe('locked_main');
            expect(locked.cascadeId).toBe('main-1');
            expect(locked.lockedMainId).toBe('main-1');
            expect(locked.ignoredSubagentBurst).toBe(true);

            // Passive hostConversationId pointing to another main MUST NOT displace lockedMainId (§3.2);
            // instead it preserves main-1 and surfaces an advisory retargetOfferId!
            const main2 = makeTrajectory('main-2', { lastModifiedTime: '2026-11-22T10:07:00Z' });
            const passiveOtherMain = resolveTargetConversation({
                trajectories: [main2, sub2, main],
                lockToMainAgent: true,
                lockedMainId: 'main-1',
                hostConversationId: 'main-2',
                platform: 'darwin',
            });
            expect(passiveOtherMain.mode).toBe('locked_main');
            expect(passiveOtherMain.cascadeId).toBe('main-1');
            expect(passiveOtherMain.lockedMainId).toBe('main-1');
            expect(passiveOtherMain.retargetOfferId).toBe('main-2');
            expect(passiveOtherMain.reason).toBe('locked_main_preserved');

            // Confirmed deletion of main-1 in same epoch allows anchoring cleanly to main-2
            const afterDeletedRoot = resolveTargetConversation({
                trajectories: [main2, sub2],
                lockToMainAgent: true,
                lockedMainId: 'main-1',
                hostConversationId: 'main-2',
                deletedConversationIds: new Set(['main-1']),
                backendEpoch: 1,
                lockedRootEpoch: 1,
                platform: 'darwin',
            });
            expect(afterDeletedRoot.mode).toBe('locked_main');
            expect(afterDeletedRoot.cascadeId).toBe('main-2');
            expect(afterDeletedRoot.lockedMainId).toBe('main-2');
        });

        it('falls back gracefully in Lock to Main Agent when only subagent trajectories exist', () => {
            const sub = makeTrajectory('sub-only', { isSubagent: true, status: CascadeStatus.RUNNING });
            const res = resolveTargetConversation({
                trajectories: [sub],
                lockToMainAgent: true,
            });
            expect(res.cascadeId).toBe('sub-only');
            expect(res.lockedMainId).toBeNull();
            expect(res.reason).toBe('fallback_subagent_only');
        });

        it('auto-follow prioritizes hostConversationId, workspace RUNNING, cross-workspace RUNNING, then workspace latest', () => {
            const wsLocal = makeTrajectory('local-idle', {
                workspaceUris: ['file:///C:/Users/Dev/Repo'],
                lastModifiedTime: '2026-11-22T10:00:00Z',
            });
            const wsOtherRunning = makeTrajectory('other-running', {
                workspaceUris: ['file:///C:/Users/Dev/Other'],
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-22T10:02:00Z',
            });
            const wsLocalRunning = makeTrajectory('local-running', {
                workspaces: [{ workspaceFolderAbsoluteUri: 'C:\\Users\\Dev\\Repo\\' }],
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-22T10:01:00Z',
            });
            const killedRunning = makeTrajectory('killed-running', {
                workspaceUris: ['file:///C:/Users/Dev/Repo'],
                status: CascadeStatus.RUNNING,
                killed: true,
                lastModifiedTime: '2026-11-22T10:09:00Z',
            });

            // 1. hostConversationId wins directly
            const fromHost = resolveTargetConversation({
                trajectories: [wsLocal, wsOtherRunning, wsLocalRunning],
                hostConversationId: 'local-idle',
                workspaceUris: ['C:\\Users\\Dev\\Repo'],
                platform: 'win32',
            });
            expect(fromHost.cascadeId).toBe('local-idle');
            expect(fromHost.reason).toBe('host_conversation');

            // 2. Local RUNNING beats cross-workspace RUNNING and killed trajectories (matching Windows URI formats)
            const localWin = resolveTargetConversation({
                trajectories: [killedRunning, wsOtherRunning, wsLocalRunning, wsLocal],
                workspaceUris: ['file:///c%3A/Users/Dev/Repo'],
                platform: 'win32',
            });
            expect(localWin.cascadeId).toBe('local-running');
            expect(localWin.reason).toBe('running_in_workspace');

            // 3. Cross-workspace RUNNING beats local idle
            const crossRunning = resolveTargetConversation({
                trajectories: [wsLocal, wsOtherRunning],
                workspaceUris: ['C:\\Users\\Dev\\Repo'],
                platform: 'win32',
            });
            expect(crossRunning.cascadeId).toBe('other-running');
            expect(crossRunning.reason).toBe('running_cross_workspace');

            // 4. Local idle beats newer cross-workspace idle
            const wsOtherIdle = makeTrajectory('other-idle', {
                workspaceUris: ['file:///C:/Users/Dev/Other'],
                lastModifiedTime: '2026-11-22T11:00:00Z',
            });
            const localIdle = resolveTargetConversation({
                trajectories: [wsOtherIdle, wsLocal],
                workspaceUris: ['C:\\Users\\Dev\\Repo'],
                platform: 'win32',
            });
            expect(localIdle.cascadeId).toBe('local-idle');
            expect(localIdle.reason).toBe('latest_in_workspace');
        });
    });


    describe('buildConversationOptions', () => {
        it('builds deduplicated options with untitled fallbacks, subagent badges, and workspace priority', () => {
            const untitled = makeTrajectory('abcdef1234567890', {
                summary: 'abcdef1234567890', // echoes cascadeId -> untitled!
                workspaceUris: ['file:///Users/dev/antigravity'],
                lastModifiedTime: '2026-11-22T10:01:00Z',
                branchName: 'main',
            });
            const sub = makeTrajectory('sub-99', {
                summary: '[Subagent] Check tests',
                isSubagent: true,
                status: CascadeStatus.RUNNING,
                workspaceUris: ['file:///Users/dev/antigravity'],
                lastModifiedTime: '2026-11-22T10:02:00Z',
            });
            const otherWs = makeTrajectory('other-1', {
                summary: 'Other Workspace Chat',
                workspaceUris: ['C:\\Projects\\OtherApp'],
                lastModifiedTime: '2026-11-22T12:00:00Z',
            });

            const optsEn = buildConversationOptions(
                [otherWs, untitled, untitled, sub],
                'abcdef1234567890',
                'abcdef1234567890',
                {
                    workspaceUris: ['/Users/dev/antigravity'],
                    platform: 'darwin',
                    lang: 'en',
                },
            );

            expect(optsEn).toHaveLength(3); // deduplicated!
            // Workspace matches prioritized before newer other-workspace chat
            expect(optsEn[0].cascadeId).toBe('sub-99');
            expect(optsEn[0].isSubagent).toBe(true);
            expect(optsEn[0].isRunning).toBe(true);

            expect(optsEn[1]).toMatchObject({
                cascadeId: 'abcdef1234567890',
                title: 'Untitled (abcdef12)',
                isUntitled: true,
                isActive: true,
                isLockedMain: true,
                matchesWorkspace: true,
                workspaceLabel: 'antigravity',
                branchName: 'main',
            });

            expect(optsEn[2].workspaceLabel).toBe('OtherApp');

            // Localized Chinese & Bilingual untitled labels + excludeSubagents filter
            const optsZh = buildConversationOptions([untitled, sub], null, null, {
                lang: 'zh',
                excludeSubagents: true,
            });
            expect(optsZh).toHaveLength(1);
            expect(optsZh[0].title).toBe('未命名会话 (abcdef12)');

            const optsBoth = buildConversationOptions([makeTrajectory('xyz1234567', { summary: '   ' })], null, null, {
                lang: 'both',
            });
            expect(optsBoth[0].title).toBe('Untitled / 未命名 (xyz12345)');
            expect(optsBoth[0].isUntitled).toBe(true);
        });
    });
});

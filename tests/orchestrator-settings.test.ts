import * as http from 'http';
import * as zlib from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeConnectFirstFrame, rpcStreamFirstFrame } from '../src/rpc-client';
import {
    getContextLimit,
    getModelDisplayName,
    getModelSpecs,
    getQuotaPoolKey,
    guessContextLimitSpec,
    localizeNeonPickerLabel,
    localizePickerEffortLabel,
    resolveModelId,
    resolveOrchestratorSettings,
    updateModelDisplayNames,
    type ModelConfig,
} from '../src/models';
import {
    fetchFullUserStatus,
    fetchOrchestratorSettings,
    fetchUserQuotaSummary,
    getContextUsage,
    parseJetboxOrchestratorPrefs,
    parseOrchestratorModelRoles,
    parseUserQuotaSummary,
    processSteps,
    type TrajectorySummary,
} from '../src/tracker';
import { groupModelQuotas } from '../src/model-quota';
import { measuredContextDrop } from '../src/extension';
import {
    applyTrajectoryModelHints,
    extractTrajectoryModelHints,
    mergeGMCallEntries,
    parseGMEntry,
} from '../src/gm/parser';
import { slimCallForPersistence } from '../src/gm/types';
import { setLanguageToState } from '../src/i18n';
import type { LSInfo } from '../src/discovery';

const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };

function makeConnectFrame(payload: unknown, flags = 0): Buffer {
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const body = (flags & 0x01) !== 0 ? zlib.gzipSync(raw) : raw;
    const header = Buffer.alloc(5);
    header[0] = flags;
    header.writeUInt32BE(body.length, 1);
    return Buffer.concat([header, body]);
}

function makeConfig(
    model: string,
    label: string,
    modelId: string,
    remaining = 0.8,
    resetTime = '2026-11-28T14:33:03Z',
): ModelConfig {
    return {
        model,
        label,
        modelId,
        supportsImages: true,
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
        quotaInfo: { remainingFraction: remaining, resetTime },
    };
}

const LIVE_LIKE_CONFIGS: ModelConfig[] = [
    makeConfig('MODEL_PLACEHOLDER_M534', 'Gemini 4 Neon (Low)', 'gemini-4-neon-low'),
    makeConfig('MODEL_PLACEHOLDER_M533', 'Gemini 4 Neon (Medium)', 'gemini-4-neon-medium'),
    makeConfig('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)', 'gemini-4-neon-high'),
    makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 'gemini-4-neon-xhigh'),
    makeConfig('MODEL_PLACEHOLDER_M438', 'Gemini 4 Carbon (Low)', 'gemini-4-carbon-low'),
    makeConfig('MODEL_PLACEHOLDER_M437', 'Gemini 4 Carbon (Medium)', 'gemini-4-carbon-medium'),
    makeConfig('MODEL_PLACEHOLDER_M427', 'Gemini 4 Carbon (High)', 'gemini-4-carbon-high'),
    makeConfig('MODEL_PLACEHOLDER_M419', 'Gemini 4 Argon (Low)', 'gemini-4-argon-low'),
    makeConfig('MODEL_PLACEHOLDER_M418', 'Gemini 4 Argon (Medium)', 'gemini-4-argon-medium'),
    makeConfig('MODEL_PLACEHOLDER_M417', 'Gemini 4 Argon (High)', 'gemini-4-argon-high'),
    makeConfig('MODEL_PLACEHOLDER_M527', 'Gemini 4 Hydrogen (Low)', 'gemini-4-hydrogen-low'),
    makeConfig('MODEL_PLACEHOLDER_M526', 'Gemini 4 Hydrogen (Medium)', 'gemini-4-hydrogen-medium'),
    makeConfig('MODEL_PLACEHOLDER_M525', 'Gemini 4 Hydrogen (High)', 'gemini-4-hydrogen-high'),
    makeConfig('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', 'gemini-4-hydrogen-xhigh'),
    makeConfig('MODEL_PLACEHOLDER_M400', 'Claude Opus 5.5 (Low)', 'claude-opus-5-5-low', 1, '2026-11-28T14:51:36Z'),
    makeConfig('MODEL_PLACEHOLDER_M401', 'Claude Opus 5.5 (Medium)', 'claude-opus-5-5-medium', 1, '2026-11-28T14:51:36Z'),
    makeConfig('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)', 'claude-opus-5-5-high', 1, '2026-11-28T14:51:36Z'),
    makeConfig('MODEL_PLACEHOLDER_M403', 'Claude Sonnet 5.5 (Low)', 'claude-sonnet-5-5-low', 1, '2026-11-28T14:51:36Z'),
    makeConfig('MODEL_PLACEHOLDER_M404', 'Claude Sonnet 5.5 (Medium)', 'claude-sonnet-5-5-medium', 1, '2026-11-28T14:51:36Z'),
    makeConfig('MODEL_PLACEHOLDER_M405', 'Claude Sonnet 5.5 (High)', 'claude-sonnet-5-5-high', 1, '2026-11-28T14:51:36Z'),
    makeConfig('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 'gemini-pro-orchestrator-neon'),
];

const LIVE_MENDEL_RESPONSE = {
    experimentConfig: {
        experiments: [
            {
                key: 'EXPERIMENT_KEY_UNSPECIFIED',
                keyString: 'unrelated-flag',
                string: 'true',
            },
            {
                key: 'EXPERIMENT_KEY_UNSPECIFIED',
                keyString: 'orchestrator-model-roles',
                string: JSON.stringify({
                    orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
                    executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
                }),
                source: 'EXPERIMENT_SOURCE_LANGUAGE_SERVER',
            },
        ],
    },
};

const LIVE_QUOTA_SUMMARY_RESPONSE = {
    response: {
        groups: [
            {
                displayName: 'Gemini Models',
                description: 'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen',
                buckets: [
                    {
                        bucketId: 'gemini-weekly',
                        displayName: 'Weekly Limit Remaining',
                        description: 'Weekly limit description',
                        window: 'weekly',
                        remainingFraction: 0.9984152,
                        resetTime: '2026-11-28T14:33:03Z',
                    },
                    {
                        bucketId: 'gemini-5h',
                        displayName: 'Five Hour Limit Remaining',
                        description: '5h limit description',
                        window: '5h',
                        remainingFraction: 0.9936607,
                        resetTime: '2026-11-21T19:33:03Z',
                    },
                ],
            },
            {
                displayName: 'Claude and GPT models',
                description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
                buckets: [
                    {
                        bucketId: '3p-weekly',
                        displayName: 'Weekly Limit Remaining',
                        window: 'weekly',
                        remainingFraction: 1,
                        resetTime: '2026-11-28T14:51:36Z',
                    },
                    {
                        bucketId: '3p-5h',
                        displayName: 'Five Hour Limit Remaining',
                        window: '5h',
                        remainingFraction: 1,
                        resetTime: '2026-11-21T19:51:36Z',
                    },
                ],
            },
        ],
        description: 'Within each group, models share a weekly limit and a 5-hour limit.',
    },
};

async function withMockServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse, endpoint: string) => void,
    fn: (ls: LSInfo) => Promise<void>,
): Promise<void> {
    const server = http.createServer((req, res) => {
        const endpoint = (req.url || '').split('/').pop() || '';
        handler(req, res, endpoint);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const ls: LSInfo = { pid: 1, port, hostname: '127.0.0.1', csrfToken: 'test-token', useTls: false };
    try {
        await fn(ls);
    } finally {
        server.closeAllConnections?.();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

afterEach(async () => {
    updateModelDisplayNames([], { authoritative: true });
    await setLanguageToState('both', memState);
});

describe('Connect streaming first-frame decoder and transport', () => {
    it('decodes uncompressed, gzipped, multi-chunk, and end-stream Connect frames', () => {
        const frame = makeConnectFrame({ appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' } });
        expect(decodeConnectFirstFrame(frame.subarray(0, 3))).toEqual({ done: false });
        expect(decodeConnectFirstFrame(frame.subarray(0, frame.length - 1))).toEqual({ done: false });
        expect(decodeConnectFirstFrame(frame)).toEqual({
            done: true,
            endStream: false,
            payload: { appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' } },
        });

        const gzipped = makeConnectFrame({ ok: true, count: 42 }, 0x01);
        expect(decodeConnectFirstFrame(gzipped)).toEqual({
            done: true,
            endStream: false,
            payload: { ok: true, count: 42 },
        });

        const endFrame = makeConnectFrame({ error: { code: 'unimplemented', message: 'not supported' } }, 0x02);
        expect(decodeConnectFirstFrame(endFrame)).toEqual({
            done: true,
            endStream: true,
            payload: { error: { code: 'unimplemented', message: 'not supported' } },
        });
    });

    it('rejects malformed JSON and oversized Connect envelopes', () => {
        const badBody = Buffer.from('{not-json', 'utf8');
        const badHeader = Buffer.alloc(5);
        badHeader[0] = 0;
        badHeader.writeUInt32BE(badBody.length, 1);
        expect(() => decodeConnectFirstFrame(Buffer.concat([badHeader, badBody]))).toThrow();

        const hugeHeader = Buffer.alloc(5);
        hugeHeader[0] = 0;
        hugeHeader.writeUInt32BE(60 * 1024 * 1024, 1);
        expect(() => decodeConnectFirstFrame(hugeHeader)).toThrow(/exceeded/);
    });

    it('reads frame 1 from an open server stream, handles chunking/gzip, and tears down without hanging', async () => {
        const payload = {
            appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' },
            userConfig: { userSettings: { orchestratorModel: 'MODEL_PLACEHOLDER_M401' } },
        };
        await withMockServer((_req, res, endpoint) => {
            if (endpoint === 'JetboxSubscribeToState') {
                res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                const frame = makeConnectFrame(payload, 0x01);
                res.write(frame.subarray(0, 7));
                setTimeout(() => {
                    if (!res.destroyed) {
                        res.write(frame.subarray(7));
                        // Intentionally leave stream open like live JetboxSubscribeToState
                    }
                }, 15);
                return;
            }
            if (endpoint === 'EndError') {
                res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                res.end(makeConnectFrame({ error: { code: 'not_found', message: 'missing' } }, 0x02));
                return;
            }
            res.writeHead(501);
            res.end('Not Implemented');
        }, async (ls) => {
            const first = await rpcStreamFirstFrame(ls, 'JetboxSubscribeToState', {}, 2000);
            expect(first).toEqual(payload);
            await expect(rpcStreamFirstFrame(ls, 'EndError', {}, 2000)).rejects.toThrow(/missing/);
            await expect(rpcStreamFirstFrame(ls, 'MissingEndpoint', {}, 2000)).rejects.toThrow(/HTTP 501/);
        });
    });

    it('rejects gzip bombs whose decompressed payload exceeds MAX_RESPONSE_BODY_SIZE', () => {
        const oversized = Buffer.from(`{"a":"${'x'.repeat(55 * 1024 * 1024)}"}`, 'utf8');
        const compressed = zlib.gzipSync(oversized);
        expect(compressed.length).toBeLessThan(1024 * 1024);
        const frame = Buffer.alloc(5 + compressed.length);
        frame[0] = 0x01;
        frame.writeUInt32BE(compressed.length, 1);
        compressed.copy(frame, 5);
        expect(() => decodeConnectFirstFrame(frame)).toThrow(/maxOutputLength|length|buffer/i);
    });

    it('rejects cleanly when a non-2xx streaming response aborts mid-body without hanging', async () => {
        await withMockServer((_req, res) => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.write('bad gateway');
            res.socket?.destroy();
        }, async (ls) => {
            await expect(rpcStreamFirstFrame(ls, 'AbortedError', {}, 2000)).rejects.toThrow();
        });
    });
});

describe('Orchestrator Settings resolution (Mendel roles + Jetbox prefs)', () => {
    it('parses Mendel orchestrator-model-roles and ignores disabled or malformed flags', () => {
        const roles = parseOrchestratorModelRoles(LIVE_MENDEL_RESPONSE);
        expect(roles).toEqual({
            orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
            executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
        });

        expect(parseOrchestratorModelRoles({
            experimentConfig: {
                experiments: [{
                    keyString: 'orchestrator-model-roles',
                    disabled: true,
                    string: '{"orchestrators":["gemini-4-neon"],"executors":["gemini-4-hydrogen"]}',
                }],
            },
        })).toBeNull();

        expect(parseOrchestratorModelRoles({
            experimentConfig: {
                experiments: [{ keyString: 'orchestrator-model-roles', string: '{broken' }],
            },
        })).toBeNull();
    });

    it('resolves default highest-effort pair when Jetbox settings are unset / MODEL_UNSPECIFIED', () => {
        const prefs = parseJetboxOrchestratorPrefs({
            appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' },
            userConfig: { userSettings: { orchestratorModel: 'MODEL_UNSPECIFIED' } },
        });
        const roles = parseOrchestratorModelRoles(LIVE_MENDEL_RESPONSE);
        const settings = resolveOrchestratorSettings(prefs, roles, LIVE_LIKE_CONFIGS);
        expect(settings).not.toBeNull();
        expect(settings!.mode).toBe('default');
        expect(settings!.isCustomOrchestrator).toBe(false);
        expect(settings!.isCustomExecutor).toBe(false);
        expect(settings!.effectiveOrchestratorModel).toBe('MODEL_PLACEHOLDER_M535');
        expect(settings!.effectiveOrchestratorLabel).toBe('Gemini 4 Neon (XHigh)');
        expect(settings!.effectiveExecutorModel).toBe('MODEL_PLACEHOLDER_M528');
        expect(settings!.effectiveExecutorLabel).toBe('Gemini 4 Hydrogen (XHigh)');
        expect(settings!.lastSelectedAgentModel).toBe('MODEL_PLACEHOLDER_M535');
        // Fixed legacy Orchestrator (Neon) M537 must NOT appear as a dynamic role candidate
        expect(settings!.orchestratorCandidates).not.toContain('MODEL_PLACEHOLDER_M537');
        expect(settings!.orchestratorCandidates).toContain('MODEL_PLACEHOLDER_M401');
        expect(settings!.executorCandidates).toContain('MODEL_PLACEHOLDER_M528');
        expect(settings!.executorCandidates).toContain('MODEL_PLACEHOLDER_M404');
    });

    it('resolves custom Claude Opus 5.5 + Sonnet 5.5 / Hydrogen pairs and rejects ineligible overrides', () => {
        const roles = parseOrchestratorModelRoles(LIVE_MENDEL_RESPONSE);
        const custom = resolveOrchestratorSettings({
            orchestratorModel: 'MODEL_PLACEHOLDER_M401',
            orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M404',
        }, roles, LIVE_LIKE_CONFIGS);
        expect(custom).toMatchObject({
            mode: 'custom',
            isCustomOrchestrator: true,
            isCustomExecutor: true,
            effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
            effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
            effectiveExecutorModel: 'MODEL_PLACEHOLDER_M404',
            effectiveExecutorLabel: 'Claude Sonnet 5.5 (Medium)',
        });

        // Passing an executor-only model as orchestrator override falls back to default Neon XHigh
        const invalidOrch = resolveOrchestratorSettings({
            orchestratorModel: 'MODEL_PLACEHOLDER_M528',
            orchestratorExecutorModel: 'MODEL_UNSPECIFIED',
        }, roles, LIVE_LIKE_CONFIGS);
        expect(invalidOrch).toMatchObject({
            mode: 'default',
            isCustomOrchestrator: false,
            effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
            effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        });

        // Without roles or explicit overrides, resolves to null cleanly
        expect(resolveOrchestratorSettings({ orchestratorModel: 'MODEL_UNSPECIFIED' }, null, LIVE_LIKE_CONFIGS)).toBeNull();
    });

    it('fetches live Orchestrator Settings over HTTP and degrades cleanly to null on 404/501', async () => {
        await withMockServer((_req, res, endpoint) => {
            if (endpoint === 'JetboxSubscribeToState') {
                res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                res.write(makeConnectFrame({
                    appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M401' },
                    userConfig: {
                        userSettings: {
                            orchestratorModel: 'MODEL_PLACEHOLDER_M401',
                            orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M528',
                        },
                    },
                }));
                return;
            }
            if (endpoint === 'GetMendelFlags') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(LIVE_MENDEL_RESPONSE));
                return;
            }
            res.writeHead(404);
            res.end();
        }, async (ls) => {
            const settings = await fetchOrchestratorSettings(ls, LIVE_LIKE_CONFIGS);
            expect(settings).toMatchObject({
                mode: 'custom',
                effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
                effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
                lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M401',
            });
        });

        await withMockServer((_req, res) => {
            res.writeHead(501);
            res.end();
        }, async (ls) => {
            expect(await fetchOrchestratorSettings(ls, LIVE_LIKE_CONFIGS, undefined, { disableConfigFallback: true })).toBeNull();
        });
    });
});

describe('Dual-window quota summary (RetrieveUserQuotaSummary) & groupedModels', () => {
    it('parses 5h and weekly quota windows and attaches them to groupModelQuotas without breaking legacy output', () => {
        const summary = parseUserQuotaSummary(LIVE_QUOTA_SUMMARY_RESPONSE);
        expect(summary).not.toBeNull();
        expect(summary!.groups).toHaveLength(2);
        const geminiSummary = summary!.groups.find(g => g.pool === 'gemini')!;
        const premiumSummary = summary!.groups.find(g => g.pool === 'premium')!;
        expect(geminiSummary.fiveHour?.remainingFraction).toBeCloseTo(0.9936607, 6);
        expect(geminiSummary.weekly?.remainingFraction).toBeCloseTo(0.9984152, 6);
        expect(premiumSummary.fiveHour?.remainingFraction).toBe(1);
        expect(premiumSummary.weekly?.remainingFraction).toBe(1);

        // Backward compatibility: omitting summary leaves dual-window fields undefined
        const legacyGroups = groupModelQuotas(LIVE_LIKE_CONFIGS);
        expect(legacyGroups.every(g => g.fiveHourQuota === undefined && g.weeklyQuota === undefined)).toBe(true);

        // Passing quotaSummary attaches exact 5h + weekly windows to matching canonical pools
        const enrichedGroups = groupModelQuotas(LIVE_LIKE_CONFIGS, summary);
        const geminiGroup = enrichedGroups.find(g => g.pool === 'gemini')!;
        const premiumGroup = enrichedGroups.find(g => g.pool === 'premium')!;
        expect(geminiGroup.minimum).toBe(0.8);
        expect(geminiGroup.fiveHourQuota?.bucketId).toBe('gemini-5h');
        expect(geminiGroup.weeklyQuota?.bucketId).toBe('gemini-weekly');
        expect(premiumGroup.fiveHourQuota?.bucketId).toBe('3p-5h');
        expect(premiumGroup.weeklyQuota?.bucketId).toBe('3p-weekly');
    });

    it('handles proto3 omitted remainingFraction and rejects invalid timestamps/fractions', () => {
        const parsed = parseUserQuotaSummary({
            response: {
                groups: [{
                    displayName: 'Gemini Models',
                    buckets: [
                        // Omitted fraction + valid future reset → exhausted (0)
                        { bucketId: 'gemini-5h', window: '5h', resetTime: '2026-11-21T19:33:03Z' },
                        // Omitted fraction + epoch reset → untouched (1), resetAt null
                        { bucketId: 'gemini-weekly', window: 'weekly', resetTime: '1970-01-01T00:00:00.000Z' },
                        // Invalid calendar day & out-of-range fraction → nulls
                        { bucketId: 'gemini-bad', window: 'other', remainingFraction: 1.5, resetTime: '2026-11-31T00:00:00Z' },
                    ],
                }],
            },
        });
        expect(parsed).not.toBeNull();
        expect(parsed!.groups[0].fiveHour?.remainingFraction).toBe(0);
        expect(parsed!.groups[0].weekly?.remainingFraction).toBe(1);
        expect(parsed!.groups[0].weekly?.resetAt).toBeNull();
        expect(parsed!.groups[0].buckets[2].remainingFraction).toBeNull();
        expect(parsed!.groups[0].buckets[2].resetTime).toBeNull();
    });

    it('fetches RetrieveUserQuotaSummary & groupedModels via live-shaped HTTP and degrades cleanly', async () => {
        await withMockServer((_req, res, endpoint) => {
            if (endpoint === 'RetrieveUserQuotaSummary') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(LIVE_QUOTA_SUMMARY_RESPONSE));
                return;
            }
            if (endpoint === 'GetUserStatus') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    userStatus: {
                        cascadeModelConfigData: {
                            clientModelConfigs: [{
                                label: 'Gemini 4 Neon (XHigh)',
                                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' },
                                modelId: 'gemini-4-neon-xhigh',
                                tagTitle: 'New',
                                tagDescription: 'Highest reasoning effort',
                                supportsImages: true,
                                quotaInfo: { remainingFraction: 1, resetTime: '2026-11-21T19:33:03Z' },
                            }],
                            groupedModels: {
                                'gemini-4-neon': {
                                    displayName: 'Gemini 4 Neon',
                                    defaultThinkingSuffix: 'medium',
                                    supportedThinkingLevels: [
                                        { thinkingSuffix: 'xhigh', thinkingDisplayName: 'Extra High' },
                                    ],
                                },
                            },
                        },
                    },
                }));
                return;
            }
            res.writeHead(404);
            res.end();
        }, async (ls) => {
            const quota = await fetchUserQuotaSummary(ls);
            expect(quota?.groups).toHaveLength(2);
            const status = await fetchFullUserStatus(ls);
            expect(status.configs[0]).toMatchObject({
                model: 'MODEL_PLACEHOLDER_M535',
                modelId: 'gemini-4-neon-xhigh',
                tagDescription: 'Highest reasoning effort',
            });
            expect(status.groupedModels?.['gemini-4-neon']).toEqual({
                displayName: 'Gemini 4 Neon',
                defaultThinkingSuffix: 'medium',
                supportedThinkingLevels: [{ thinkingSuffix: 'xhigh', thinkingDisplayName: 'Extra High' }],
            });
        });

        await withMockServer((_req, res) => {
            res.writeHead(404);
            res.end();
        }, async (ls) => {
            expect(await fetchUserQuotaSummary(ls)).toBeNull();
        });
    });
});

describe('Cross-pool Orchestrator trajectory & context limit handling', () => {
    const opusMedium = 'MODEL_PLACEHOLDER_M401';
    const hydrogenXHigh = 'MODEL_PLACEHOLDER_M528';
    const shadowCheckpoint = 'MODEL_PLACEHOLDER_M50';

    const makeTrajectory = (stepCount: number): TrajectorySummary => ({
        cascadeId: 'cross-pool-1',
        trajectoryId: 'traj-1',
        summary: 'Cross-pool Orchestrator run',
        stepCount,
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: '2026-11-21T15:00:00Z',
        createdTime: '2026-11-21T14:55:00Z',
        requestedModel: '',
        generatorModel: '',
        workspaceUris: [],
        lastUserInputTime: '2026-11-21T14:55:00Z',
        lastUserInputStepIndex: 0,
        repositoryName: '',
        gitOriginUrl: '',
        branchName: '',
        gitRootUri: '',
    });

    it('tracks planModel + executionModel without clobbering coordinator identity and prevents false compression', () => {
        const userInput = {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                userResponse: 'Refactor module',
                userConfig: {
                    plannerConfig: {
                        planModel: opusMedium,
                        planExecuteConfig: { executionModel: hydrogenXHigh },
                    },
                },
            },
        };
        const plannerStep = {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            metadata: {
                generatorModel: opusMedium,
                modelUsage: { model: opusMedium, inputTokens: 120_000, outputTokens: 1_500, cacheReadTokens: 0 },
            },
        };
        const executorStep = {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            metadata: {
                generatorModel: hydrogenXHigh,
                modelUsage: { model: hydrogenXHigh, inputTokens: 40_000, outputTokens: 800, cacheReadTokens: 0 },
            },
        };

        const atPlanner = processSteps([userInput, plannerStep]);
        expect(atPlanner.model).toBe(opusMedium);
        expect(atPlanner.orchestratorConfig).toEqual({ planModel: opusMedium, executionModel: hydrogenXHigh });
        expect(atPlanner.lastModelUsage?.model).toBe(opusMedium);

        const atExecutor = processSteps([userInput, plannerStep, executorStep]);
        // Selected coordinator model stays Opus 5.5 while lastModelUsage reflects executor Hydrogen
        expect(atExecutor.model).toBe(opusMedium);
        expect(atExecutor.orchestratorConfig).toEqual({ planModel: opusMedium, executionModel: hydrogenXHigh });
        expect(atExecutor.lastModelUsage?.model).toBe(hydrogenXHigh);

        // Switching from Opus 5.5 planner (120K) to Hydrogen executor (40K) is NOT context compression
        expect(measuredContextDrop(
            { ...atPlanner, contextLimit: 255_000 },
            { ...atExecutor, contextLimit: 511_000 },
            false,
        )).toBe(0);

        // Switching to a regular non-Orchestrator model in a later turn clears orchestratorConfig
        const normalUserInput = {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                userResponse: 'Normal follow-up',
                userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M535' } },
            },
        };
        const afterSwitch = processSteps([userInput, plannerStep, executorStep, normalUserInput]);
        expect(afterSwitch.model).toBe('MODEL_PLACEHOLDER_M535');
        expect(afterSwitch.orchestratorConfig).toBeUndefined();

        // Switching directly to the former executor (M528) via plannerConfig.requestedModel clears orchestratorConfig
        const directExecUserInput = {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                userResponse: 'Switch directly to Hydrogen',
                userConfig: { plannerConfig: { requestedModel: { model: hydrogenXHigh } } },
            },
        };
        const directExecReply = {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            metadata: {
                requestedModel: { model: hydrogenXHigh },
                generatorModel: hydrogenXHigh,
                modelUsage: { model: hydrogenXHigh, inputTokens: 15_000, outputTokens: 500, cacheReadTokens: 0 },
            },
        };
        const afterDirectExec = processSteps([userInput, plannerStep, executorStep, directExecUserInput, directExecReply]);
        expect(afterDirectExec.model).toBe(hydrogenXHigh);
        expect(afterDirectExec.orchestratorConfig).toBeUndefined();

        // Switching to a different concrete model via metadata.requestedModel without USER_INPUT.planModel clears stale orchestratorConfig
        const metaSwitchReply = {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            metadata: {
                requestedModel: { model: 'MODEL_PLACEHOLDER_M532' },
                generatorModel: 'MODEL_PLACEHOLDER_M532',
                modelUsage: { model: 'MODEL_PLACEHOLDER_M532', inputTokens: 10_000, outputTokens: 400, cacheReadTokens: 0 },
            },
        };
        const afterMetaSwitch = processSteps([userInput, metaSwitchReply]);
        expect(afterMetaSwitch.model).toBe('MODEL_PLACEHOLDER_M532');
        expect(afterMetaSwitch.orchestratorConfig).toBeUndefined();

        // Canonical alias-equivalent planModel and executionModel do not create self-delegating orchestratorConfig
        const selfAliasInput = {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                userResponse: 'Self alias',
                userConfig: {
                    plannerConfig: {
                        planModel: hydrogenXHigh,
                        planExecuteConfig: { executionModel: 'gemini-4-hydrogen-xhigh' },
                    },
                },
            },
        };
        const selfAliasRes = processSteps([selfAliasInput]);
        expect(selfAliasRes.model).toBe(hydrogenXHigh);
        expect(selfAliasRes.orchestratorConfig).toBeUndefined();
    });

    it('uses snapshot model limit for planner snapshots and NEVER shadow M50 for checkpoint snapshots', async () => {
        const userInput = {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                userResponse: 'Run task',
                userConfig: {
                    plannerConfig: {
                        planModel: opusMedium,
                        planExecuteConfig: { executionModel: hydrogenXHigh },
                    },
                },
            },
        };
        const executorStep = {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            metadata: {
                generatorModel: hydrogenXHigh,
                modelUsage: { model: hydrogenXHigh, inputTokens: 100_000, outputTokens: 2_000, cacheReadTokens: 0 },
            },
        };
        const checkpointStep = {
            type: 'CORTEX_STEP_TYPE_CHECKPOINT',
            metadata: {
                generatorModel: shadowCheckpoint,
                modelUsage: { model: shadowCheckpoint, inputTokens: 90_000, outputTokens: 1_000, cacheReadTokens: 0 },
            },
        };

        let stepsToServe: Array<Record<string, unknown>> = [userInput, executorStep];
        await withMockServer((_req, res, endpoint) => {
            if (endpoint === 'GetCascadeTrajectorySteps') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps: stepsToServe }));
                return;
            }
            res.writeHead(404);
            res.end();
        }, async (ls) => {
            // Planner snapshot from Hydrogen executor → 511K limit (Gemini 4 512K cold-start)
            const execUsage = await getContextUsage(ls, makeTrajectory(2));
            expect(execUsage.model).toBe(opusMedium);
            expect(execUsage.orchestratorConfig).toEqual({ planModel: opusMedium, executionModel: hydrogenXHigh });
            expect(execUsage.contextLimit).toBe(511_000);

            // Checkpoint snapshot with shadow M50 (128K) → must use effectiveModel (Opus 5.5 = 255K), NOT 127K!
            stepsToServe = [userInput, checkpointStep];
            const ckptUsage = await getContextUsage(ls, makeTrajectory(2));
            expect(ckptUsage.tokenUsageSource).toBe('checkpoint');
            expect(ckptUsage.checkpointModel).toBe(shadowCheckpoint);
            expect(ckptUsage.contextLimit).toBe(255_000);
        });
    });
});

describe('Catalog-only Hydrogen models, M669 dual labels, Extra High localization & Claude Orchestrator pool', () => {
    it('resolves M530, M531, M578 and both live + legacy M669 worker names', () => {
        expect(resolveModelId('gemini-4-hydrogen-tiered-high')).toBe('MODEL_PLACEHOLDER_M530');
        expect(resolveModelId('gemini-4-hydrogen-tiered-xhigh')).toBe('MODEL_PLACEHOLDER_M531');
        expect(resolveModelId('gemini-4-hydrogen-sonar')).toBe('MODEL_PLACEHOLDER_M578');
        expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M530')).toBe('gemini');
        expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M531')).toBe('gemini');
        expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M578')).toBe('gemini');
        expect(getContextLimit('MODEL_PLACEHOLDER_M530')).toBe(511_000);
        expect(getContextLimit('MODEL_PLACEHOLDER_M531')).toBe(511_000);
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M578')).toEqual({
            cpLimit: 0, cpThreshold: 0, maxTokens: 1_048_576, supportsThinking: true,
        });

        expect(getModelDisplayName('MODEL_PLACEHOLDER_M669')).toBe('Gemini 4 Hydrogen (Orchestrator)');
        expect(resolveModelId('Gemini 4 Hydrogen (Orchestrator)')).toBe('MODEL_PLACEHOLDER_M669');
        expect(resolveModelId('Gemini Flash (Orchestrator Worker)')).toBe('MODEL_PLACEHOLDER_M669');
        expect(resolveModelId('gemini-flash-worker-agy')).toBe('MODEL_PLACEHOLDER_M669');
        expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M669')?.thinkingLevel).toBe(100);
    });

    it('localizes Extra High consistently across both Gemini 4 Neon and Gemini 4 Hydrogen', () => {
        expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 'en')).toBe('Gemini 4 Neon (Extra High)');
        expect(localizeNeonPickerLabel('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', 'en')).toBe('Gemini 4 Hydrogen (Extra High)');
        expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 'zh')).toBe('Gemini 4 Neon (超高)');
        expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (Extra)', 'zh')).toBe('Gemini 4 Hydrogen (超高)');
        expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', 'both')).toBe('Gemini 4 Hydrogen (Extra High / 超高)');
    });

    it('maps dynamic Orchestrator Claude labels to the premium quota pool', () => {
        expect(getQuotaPoolKey('Orchestrator (Claude Opus 5.5)')).toBe('premium');
        expect(getQuotaPoolKey('Orchestrator (Claude Sonnet 5.5 Medium)')).toBe('premium');
    });
});

describe('GM parser dynamic Orchestrator fields & fallback hints', () => {
    it('extracts executionModel and modelDisplayName and preserves executionModel through merge and slimming', () => {
        const call = parseGMEntry({
            executionId: 'dyn-orch-1',
            stepIndices: [1],
            plannerConfig: {
                planModel: 'MODEL_PLACEHOLDER_M401',
                planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' },
            },
            chatModel: {
                model: 'MODEL_PLACEHOLDER_M401',
                modelDisplayName: 'Claude Opus 5.5 (Medium)',
                responseModel: 'claude-opus-5-5',
                usage: { inputTokens: 1000, outputTokens: 200 },
            },
        });
        expect(call.executionModel).toBe('MODEL_PLACEHOLDER_M528');
        expect(call.modelDisplayName).toBe('Claude Opus 5.5 (Medium)');

        const slim = slimCallForPersistence(call);
        expect(slim.executionModel).toBe('MODEL_PLACEHOLDER_M528');

        const bare = parseGMEntry({
            executionId: 'dyn-orch-1',
            stepIndices: [1],
            chatModel: { model: 'MODEL_PLACEHOLDER_M401', usage: { inputTokens: 1000, outputTokens: 200 } },
        });
        const merged = mergeGMCallEntries(bare, call);
        expect(merged.executionModel).toBe('MODEL_PLACEHOLDER_M528');
        expect(merged.modelDisplayName).toBe('Claude Opus 5.5 (Medium)');
    });

    it('uses plannerConfig.planModel as fallback trajectory hint without overriding concrete chatModel', () => {
        const steps = [{
            stepIndex: 0,
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                userConfig: {
                    plannerConfig: {
                        planModel: 'MODEL_PLACEHOLDER_M401',
                        planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' },
                    },
                },
            },
        }];
        const hints = extractTrajectoryModelHints(steps);
        expect(hints.get(0)).toBe('MODEL_PLACEHOLDER_M401');

        // Unknown call recovers planModel from trajectory hint
        const unknownCall = parseGMEntry({ stepIndices: [0], chatModel: { usage: { inputTokens: 50 } } });
        const recovered = applyTrajectoryModelHints([unknownCall], steps);
        expect(recovered[0].model).toBe('MODEL_PLACEHOLDER_M401');
        expect(recovered[0].modelSource).toBe('trajectory');

        // Authoritative executor call keeps its own M528 identity and is NOT overwritten by planModel
        const executorCall = parseGMEntry({
            stepIndices: [0],
            chatModel: { model: 'MODEL_PLACEHOLDER_M528', responseModel: 'gemini-4-hydrogen', usage: { inputTokens: 50 } },
        });
        const preserved = applyTrajectoryModelHints([executorCall], steps);
        expect(preserved[0].model).toBe('MODEL_PLACEHOLDER_M528');
        expect(preserved[0].modelSource).toBe('chatModel');
    });
});

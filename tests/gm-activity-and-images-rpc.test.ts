// Consolidated Domain Suite: RPC-Mocked GM, Activity, Trajectory Hub & Image Tracking
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    applyTrajectoryModelHints,
    isValidCallTimestamp,
    mergeGMCallEntries,
    parseGMEntry,
    shouldEnrichConversation,
} from '../src/gm/parser';
import {
    type GMCallEntry,
    type GMConversationData,
    type GMModelStats,
    type GMSummary,
    GMTracker,
    type GMTrackerState,
} from '../src/gm-tracker';
import { DailyLedger } from '../src/daily-ledger';
import { rpcCall } from '../src/rpc-client';
import { findPricing, findPricingForDate } from '../src/pricing-store';
import { ActivityTracker, mergeGMStats } from '../src/activity-tracker';
import { classifyStep, extractToolName, slimStepEventForPersistence } from '../src/activity/helpers';
import {
    type ContextUsage,
    extractLinkedSubagentIds,
    getContextUsage,
    isImageGenStep,
    processSteps,
    refreshWorkflowImageUsage,
    resetImageWorkflowCache,
    type TrajectorySummary,
} from '../src/tracker';
import { applyGMContextToUsage, fetchAndOverrideCheckpointerLimits, hasSameUsageInputs, invalidateLiveModelMetadata } from '../src/extension';
import { StepType } from '../src/constants';
import {
    getAvailableImageModelSpecs,
    getContextLimit,
    getModelDisplayName,
    getModelSpecs,
    getQuotaPoolKey,
    guessContextLimitSpec,
    isImageGenerationModel,
    resolveModelId,
    setAvailableImageModelIds,
    updateModelSpec,
} from '../src/models';
import { verifiedModelCatalog } from './fixtures/model-catalog-2026-10-31';
import { buildOverviewTabContent } from '../src/webview-overview-tab';
import { type Language, setLanguageToState } from '../src/i18n';
import { MonitorStore } from '../src/monitor-store';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));

describe('[gm-timestamps]', () => {
    const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };

    const timestamp = '2026-11-30T10:00:00.000Z';


    function rawCall(createdAt = '', executionId = '') {
        return { executionId, stepIndices: [1], chatModel: { model: 'MODEL_PLACEHOLDER_M419',
            responseModel: 'gemini-4-argon', usage: { inputTokens: 12905, outputTokens: 5 },
            chatStartMetadata: { createdAt } } };
    }


    function planner(stepIndex = 1, metadata: Record<string, unknown> = { startedAt: timestamp }) {
        return { stepIndex, type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata };
    }


    function conversation(call: GMCallEntry): GMConversationData {
        return { cascadeId: 'timestamp-fixture', title: 'Fixture', totalSteps: 2,
            calls: [call], coveredSteps: 1, coverageRate: 0.5, checkpointSummaries: [] };
    }


    function cacheOf(tracker: GMTracker): Map<string, GMConversationData> {
        return (tracker as unknown as { _cache: Map<string, GMConversationData> })._cache;
    }


    afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });


    describe('trajectory-derived GM timestamps', () => {
        it.each(['', 'invalid', '1', '2026-11-31T10:00:00Z', '2026-11-30T10:00:00',
            '2026-02-29T00:00:00Z', '2026-11-30'])(
            'recovers %s timestamps despite authoritative model identity and absent model hints', missing => {
            const call = parseGMEntry(rawCall(missing));
            const [enriched] = applyTrajectoryModelHints([call], [planner()]);
            expect(enriched.createdAt).toBe(timestamp);
            expect(enriched.model).toBe('MODEL_PLACEHOLDER_M419');
            expect(enriched.modelSource).toBe('chatModel');
            expect(call.createdAt).toBe(missing);
            expect(shouldEnrichConversation(2, [call])).toBe(true);
            expect(findPricingForDate(enriched.model, {}, enriched.createdAt)?.input).toBe(2);
        });

        it('keeps a valid original GM timestamp and accepts a valid planner creation time', () => {
            const call = parseGMEntry(rawCall('2026-10-31T01:00:00.000Z'));
            expect(applyTrajectoryModelHints([call], [planner()])[0]).toBe(call);
            const [fallback] = applyTrajectoryModelHints([parseGMEntry(rawCall())], [
                planner(1, { startedAt: 'invalid', createdAt: timestamp }),
            ]);
            expect(fallback.createdAt).toBe(timestamp);
        });

        it.each(['2028-02-29T10:00:00Z', '2026-11-30T10:00:00.123456789Z',
            '2026-11-30T23:30:00-01:00', '2026-12-01T10:30:00+11:00'])(
            'keeps valid zoned call timestamp %s unchanged', valid => {
                const call = parseGMEntry(rawCall(valid));
                expect(isValidCallTimestamp(valid)).toBe(true);
                expect(applyTrajectoryModelHints([call], [planner()])[0]).toBe(call);
                expect(findPricingForDate(call.model, {}, valid)).not.toBeNull();
            },
        );

        it('uses request creation time when the hub startedAt is a later completion-time timestamp', () => {
            const [call] = applyTrajectoryModelHints([parseGMEntry(rawCall())], [planner(1, {
                createdAt: '2026-11-30T23:59:59Z', startedAt: '2026-12-01T00:00:01Z',
            })]);
            expect(call.createdAt).toBe('2026-11-30T23:59:59Z');
            expect(findPricingForDate(call.model, {}, call.createdAt)?.input).toBe(2);
        });

        it('matches an execution ID even when step indices are unavailable, and rejects conflicting IDs', () => {
            const call = parseGMEntry({ ...rawCall('', 'exec-date'), stepIndices: [] });
            expect(applyTrajectoryModelHints([call], [planner(20, { executionId: 'exec-date', startedAt: timestamp })])[0].createdAt).toBe(timestamp);
            const conflicted = parseGMEntry(rawCall('', 'other-exec'));
            expect(applyTrajectoryModelHints([conflicted], [planner(1, { executionId: 'exec-date', startedAt: timestamp })])[0].createdAt).toBe('');
        });

        it('does not borrow a nearby, user-input, ambiguous or arbitrary first-step timestamp', () => {
            const call = parseGMEntry(rawCall());
            expect(applyTrajectoryModelHints([call], [planner(0)])[0].createdAt).toBe('');
            expect(applyTrajectoryModelHints([call], [{ ...planner(), type: 'CORTEX_STEP_TYPE_USER_INPUT' }])[0].createdAt).toBe('');
            const noStepIdentity = { ...call, stepIndices: [], startStepIndex: 0 };
            expect(applyTrajectoryModelHints([noStepIdentity], [planner(0)])[0].createdAt).toBe('');
            const ambiguous = { ...call, stepIndices: [1, 2] };
            expect(applyTrajectoryModelHints([ambiguous], [planner(), planner(2, { startedAt: '2026-12-01T10:00:00.000Z' })])[0].createdAt).toBe('');
            expect(isValidCallTimestamp('1')).toBe(false);
        });

        it('requests timestamp enrichment even when model and user anchors are complete', () => {
            const call = parseGMEntry(rawCall());
            call.userMessageAnchors = [{ stepIndex: 0, text: 'fixture' }];
            expect(shouldEnrichConversation(2, [call])).toBe(true);
            expect(shouldEnrichConversation(2, [{ ...call, createdAt: timestamp }])).toBe(false);
            expect(mergeGMCallEntries({ ...call, createdAt: 'invalid' }, { ...call, createdAt: timestamp }).createdAt).toBe(timestamp);
        });

        it('retries an unchanged idle cache with a missing date and uses the historical call date for pricing', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-12-02T10:00:00.000Z'));
            const tracker = new GMTracker();
            cacheOf(tracker).set('timestamp-fixture', conversation(parseGMEntry(rawCall())));
            vi.mocked(rpcCall).mockResolvedValueOnce({ generatorMetadata: [rawCall()] });
            vi.mocked(rpcCall).mockResolvedValueOnce({ trajectory: { steps: [planner()] } });
            await tracker.fetchAll(ls, [{ cascadeId: 'timestamp-fixture', stepCount: 2, status: 'CASCADE_RUN_STATUS_IDLE' }]);
            const call = tracker.getAllConversationData()[0].calls[0];
            expect(call.createdAt).toBe(timestamp);
            expect(findPricingForDate(call.model, {}, call.createdAt)?.input).toBe(2);
            expect(findPricingForDate(call.model, {}, '2026-12-02')?.input).toBe(4);
            expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0); // historical call, not today's usage
            expect(vi.mocked(rpcCall).mock.calls.map(args => args[1])).toEqual([
                'GetCascadeTrajectoryGeneratorMetadata', 'GetCascadeTrajectory',
            ]);
        });

        it.each(['', 'invalid'])('does not duplicate an already recorded call when its %s date is filled after restore and revert', missing => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
            const tracker = new GMTracker();
            const original = parseGMEntry(rawCall(missing));
            cacheOf(tracker).set('timestamp-fixture', conversation(original));
            const ledger = new DailyLedger();
            const initial = tracker.getNewCallsSinceLastRecord().entries;
            expect(ledger.recordCalls(initial)).toBe(1);
            tracker.markLedgerEntriesRecorded(initial);
            const restored = GMTracker.restore(tracker.serialize());
            const restoredLedger = DailyLedger.restore(ledger.serialize());
            expect(restored.getNewCallsSinceLastRecord().revertedCascadeIds).toEqual(['timestamp-fixture']);
            const [enriched] = applyTrajectoryModelHints([original], [planner(1, { startedAt: '2026-10-31T09:00:00.000Z' })]);
            cacheOf(restored).set('timestamp-fixture', conversation(enriched));
            const returned = restored.getNewCallsSinceLastRecord().entries;
            expect(returned).toHaveLength(0);
            expect(restoredLedger.recordCalls(returned)).toBe(0);
            expect(restoredLedger.getTodayActive()[0].totalCalls).toBe(1);
        });

        it('still distinguishes a regenerated call with a different valid timestamp after revert', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
            const tracker = new GMTracker();
            const original = parseGMEntry(rawCall('2026-10-31T08:00:00.000Z'));
            cacheOf(tracker).set('timestamp-fixture', conversation(original));
            tracker.markLedgerEntriesRecorded(tracker.getNewCallsSinceLastRecord().entries);
            const restored = GMTracker.restore(tracker.serialize());
            restored.getNewCallsSinceLastRecord();
            cacheOf(restored).set('timestamp-fixture', conversation({ ...original, createdAt: '2026-10-31T09:00:00.000Z' }));
            expect(restored.getNewCallsSinceLastRecord().entries).toHaveLength(1);
        });
    });
});

describe('[gm-tracker-restore-fetch]', () => {
    const rpcCallMock = vi.mocked(rpcCall);

    function makeSummary(): GMSummary {
        return {
            conversations: [{
                cascadeId: 'conv-restored',
                title: 'Restored Conversation',
                totalSteps: 3,
                calls: [],
                lifetimeCalls: 2,
                coveredSteps: 0,
                coverageRate: 0,
                checkpointSummaries: [],
                systemContextItems: [],
            }],
            modelBreakdown: {},
            totalCalls: 0,
            totalStepsCovered: 0,
            totalCredits: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalThinkingTokens: 0,
            contextGrowth: [],
            fetchedAt: '2026-06-01T00:00:00.000Z',
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            totalRetryCount: 0,
            latestTokenBreakdown: [],
            stopReasonCounts: {},
            retryErrorCodes: {},
            recentErrors: [],
            toolCallCounts: {},
        };
    }


    function makeRestoredState(): GMTrackerState {
        return {
            version: 1,
            summary: makeSummary(),
            baselines: { 'conv-restored': 3 },
            callBaselines: { 'conv-restored': 0 },
        };
    }


    function makeHydratedCall(): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-restored-1',
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            responseModel: '',
            modelAccuracy: 'placeholder',
            inputTokens: 10,
            outputTokens: 5,
            thinkingTokens: 0,
            responseTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            apiProvider: '',
            ttftSeconds: 0,
            streamingSeconds: 0,
            credits: 0,
            creditType: '',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 0,
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
            createdAt: '2026-06-01T00:00:00.000Z',
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 0,
        };
    }


    describe('GMTracker restore fetch behavior', () => {
        beforeEach(() => {
            rpcCallMock.mockReset();
            rpcCallMock.mockResolvedValue({ generatorMetadata: [] });
        });

        it('re-fetches unchanged idle conversations when restored cache has no calls', async () => {
            const tracker = GMTracker.restore(makeRestoredState());

            await tracker.fetchAll(
                {} as any,
                [{
                    cascadeId: 'conv-restored',
                    title: 'Restored Conversation',
                    stepCount: 3,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                }],
            );

            expect(rpcCallMock).toHaveBeenCalledTimes(1);
            expect(rpcCallMock).toHaveBeenCalledWith(
                {} as any,
                'GetCascadeTrajectoryGeneratorMetadata',
                expect.objectContaining({ cascadeId: 'conv-restored' }),
                30000,
                undefined,
            );
        });

        it('hides persisted UI summaries until live GM calls are hydrated again', () => {
            const tracker = GMTracker.restore(makeRestoredState());

            expect(tracker.getUiSummary()).toBeNull();
            expect(tracker.getUiFullSummary()).toBeNull();
            expect(tracker.getFullSummary()).not.toBeNull();
            expect(tracker.getArchivalSummary()).not.toBeNull();
        });

        it('still skips unchanged idle conversations after calls are already hydrated', async () => {
            const tracker = GMTracker.restore(makeRestoredState());
            const cache = (tracker as any)._cache as Map<string, any>;
            const restored = cache.get('conv-restored');
            cache.set('conv-restored', {
                ...restored,
                calls: [makeHydratedCall()],
            });

            await tracker.fetchAll(
                {} as any,
                [{
                    cascadeId: 'conv-restored',
                    title: 'Restored Conversation',
                    stepCount: 3,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                }],
            );

            expect(rpcCallMock).not.toHaveBeenCalled();
        });

        it('baselines a failed startup conversation after recovery and counts new sessions normally', async () => {
            const inventory = (id: string) => ({ cascadeId: id, title: id, stepCount: 2, status: 'CASCADE_RUN_STATUS_RUNNING' });
            const ls = { pid: 1, port: 1, csrfToken: 'fixture', useTls: false };
            const fresh = new GMTracker();
            rpcCallMock.mockRejectedValueOnce(new Error('metadata unavailable'));
            await fresh.fetchAll(ls, [inventory('existing')]);
            expect(fresh.serialize().pendingStartupBaselines).toEqual(['existing']);
            const restarted = GMTracker.restore(fresh.serialize());
            let seenNew = false;
            rpcCallMock.mockImplementation(async (_ls, endpoint, data) => {
                if (endpoint !== 'GetCascadeTrajectoryGeneratorMetadata') { return { trajectory: { steps: [] } }; }
                const id = (data as { cascadeId: string }).cascadeId;
                const ids = id === 'existing' && seenNew ? ['old', 'later'] : [id === 'existing' ? 'old' : 'new-call'];
                return { generatorMetadata: ids.map(executionId => ({
                    executionId, stepIndices: [1], chatModel: {
                        model: 'MODEL_PLACEHOLDER_M419', usage: { inputTokens: 50, outputTokens: 2 },
                        chatStartMetadata: { createdAt: new Date().toISOString() },
                    },
                })) };
            });
            await restarted.fetchAll(ls, [inventory('existing'), inventory('new')]);
            const writes = restarted.getNewCallsSinceLastRecord().entries;
            expect(writes.map(e => e.call.executionId)).toEqual(['new-call']);
            restarted.markLedgerEntriesRecorded(writes);
            seenNew = true;
            await restarted.fetchAll(ls, [inventory('existing'), inventory('new')]);
            expect(restarted.getNewCallsSinceLastRecord().entries.map(e => e.call.executionId)).toEqual(['later']);
        });

        it('baselines a late-discovered manifest member once, retaining history for group pricing and only recording subsequent calls', async () => {
            const ls = { pid: 1, port: 1, csrfToken: 'fixture', useTls: false };
            const member = { cascadeId: 'worker', title: 'Worker', status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 8, manifestMember: true };
            const tracker = new GMTracker();
            await tracker.fetchAll(ls, []);
            rpcCallMock.mockRejectedValueOnce(new Error('unavailable'));
            await tracker.fetchAll(ls, [member]);
            expect(tracker.serialize().pendingStartupBaselines).toContain(member.cascadeId);
            const resumed = GMTracker.restore(tracker.serialize());
            let executionIds = ['a', 'b'];
            rpcCallMock.mockImplementation(async (_ls, endpoint) => endpoint === 'GetCascadeTrajectoryGeneratorMetadata'
                ? { generatorMetadata: executionIds.map((executionId, i) => ({
                    executionId, stepIndices: [i], chatModel: { model: 'MODEL_PLACEHOLDER_M419',
                        usage: { inputTokens: 22, outputTokens: 2 }, chatStartMetadata: { createdAt: new Date().toISOString() } },
                })) }
                : { trajectory: { steps: [] } });
            resumed.setCurrentAccount('member@example.test');
            await resumed.fetchAll(ls, [member]);
            expect(resumed.getNewCallsSinceLastRecord().entries).toEqual([]);
            expect(resumed.getGroupCostConversations(['worker'])[0].calls.map(c => c.executionId)).toEqual(executionIds);
            resumed.setCurrentAccount('different@example.test');
            expect(resumed.getGroupCostConversations(['worker'])[0].calls).toHaveLength(0);
            executionIds = [...executionIds, 'c'];
            resumed.setCurrentAccount('member@example.test');
            await resumed.fetchAll(ls, [{ ...member, stepCount: 9 }]);
            const delta = resumed.getNewCallsSinceLastRecord().entries;
            expect(delta.map(e => e.call.executionId)).toEqual(['c']);
            resumed.markLedgerEntriesRecorded(delta);
            expect(resumed.getNewCallsSinceLastRecord().entries).toEqual([]);
            expect(resumed.getGroupCostConversations(['worker', 'worker'])[0].calls).toHaveLength(3);
        });

        it('uses the host poll metadata for manifest members only, keeping a deferred first read retryable and unbilled', async () => {
            const tracker = new GMTracker();
            const ls = { pid: 1, port: 1, csrfToken: 'fixture', useTls: false };
            const root = { cascadeId: 'root', title: 'Root', status: 'CASCADE_RUN_STATUS_IDLE', stepCount: 1 };
            const member = { ...root, cascadeId: 'member', manifestMember: true };
            rpcCallMock.mockResolvedValue({ generatorMetadata: [] });
            const read = vi.fn().mockRejectedValueOnce(new Error('Trajectory poll byte budget exhausted'))
                .mockResolvedValue([{ executionId: 'member-old', stepIndices: [1], chatModel: {
                    model: 'MODEL_PLACEHOLDER_M419', usage: { inputTokens: 50, outputTokens: 2 },
                    chatStartMetadata: { createdAt: new Date().toISOString() },
                } }]);
            await tracker.fetchAll(ls, [root]);
            await tracker.fetchAll(ls, [root, member], undefined, undefined, read);
            expect(tracker.serialize().pendingStartupBaselines).toContain('member');
            await tracker.fetchAll(ls, [root, member], undefined, undefined, read);
            expect(read.mock.calls).toEqual([['member'], ['member']]);
            expect(tracker.getNewCallsSinceLastRecord().entries).toEqual([]);
            expect(tracker.getGroupCostConversations(['member'])[0].calls).toHaveLength(1);
            const wireIds = rpcCallMock.mock.calls.map(([, , body]) => (body as { cascadeId?: string }).cascadeId);
            expect(wireIds).toContain('root');
            expect(wireIds).not.toContain('member');
        });

        it('exposes enriched observations for reconciliation after the write-once cursor is committed', async () => {
            const tracker = new GMTracker();
            tracker.setCurrentAccount('fixture@example.test');
            rpcCallMock.mockImplementation(async (_ls: unknown, endpoint: string) => endpoint === 'GetCascadeTrajectoryGeneratorMetadata'
                ? { generatorMetadata: [{ executionId: 'reconcile-exec', stepIndices: [1], chatModel: {
                    model: 'MODEL_PLACEHOLDER_M419', responseModel: 'gemini-4-argon',
                    usage: { inputTokens: 50, outputTokens: 2 },
                    chatStartMetadata: { createdAt: new Date().toISOString() },
                } }] }
                : { trajectory: { steps: [] } });
            await tracker.fetchAll({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false }, [{
                cascadeId: 'reconcile-only', title: 'Fixture', stepCount: 2, status: 'CASCADE_RUN_STATUS_IDLE',
            }]);
            const observations = tracker.getLedgerReconciliationEntries();
            expect(observations).toHaveLength(1);
            tracker.markLedgerEntriesRecorded(observations);
            expect(tracker.getNewCallsSinceLastRecord().entries).toEqual([]);
            expect(tracker.getLedgerReconciliationEntries()).toEqual(observations);
            expect(observations[0].call.createdAt).not.toBe('');
            expect(observations[0].dedupKey).toBe('reconcile-only|exec%3Areconcile-exec');
            expect(observations[0].cascadeId).toBe('reconcile-only');
            expect(observations[0].callIndex).toBe(0);
        });
    });
});

describe('[activity-recent-steps]', () => {
    const rpcCallMock = vi.mocked(rpcCall);

    function makeUserStep(index: number): Record<string, unknown> {
        const minute = String(Math.floor(index / 60)).padStart(2, '0');
        const second = String(index % 60).padStart(2, '0');
        return {
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            metadata: {
                createdAt: `2026-06-01T00:${minute}:${second}.000Z`,
            },
            userInput: {
                items: [{ text: `user input ${index}` }],
            },
        };
    }


    describe('ActivityTracker recent-step warm-up', () => {
        beforeEach(() => {
            rpcCallMock.mockReset();
        });

        it('keeps all warm-up events in runtime instead of truncating the timeline buffer', async () => {
            const tracker = new ActivityTracker();
            const steps = Array.from({ length: 120 }, (_, index) => makeUserStep(index));

            rpcCallMock.mockResolvedValue({ steps });

            const changed = await tracker.processTrajectories(
                {} as any,
                [{
                    cascadeId: 'conv-warmup',
                    stepCount: steps.length,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                }],
            );

            expect(changed).toBe(true);

            const summary = tracker.getSummary();
            expect(summary.recentSteps).toHaveLength(120);
            expect(summary.recentSteps[0]?.stepIndex).toBe(0);
            expect(summary.recentSteps[119]?.stepIndex).toBe(119);
        });

        it('still trims persisted recent steps to the configured safety limit', async () => {
            const tracker = new ActivityTracker();
            const steps = Array.from({ length: 120 }, (_, index) => makeUserStep(index));

            rpcCallMock.mockResolvedValue({ steps });

            await tracker.processTrajectories(
                {} as any,
                [{
                    cascadeId: 'conv-persist',
                    stepCount: steps.length,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                }],
            );

            const serialized = tracker.serialize();
            expect(serialized.summary.recentSteps).toHaveLength(100);
            expect(serialized.summary.recentSteps[0]?.stepIndex).toBe(20);
            expect(serialized.summary.recentSteps[99]?.stepIndex).toBe(119);
        });

        it('P0-3: never advances stepCount on budget-rejected or failed warm-up and incremental reads so retries ingest missed steps', async () => {
            const tracker = new ActivityTracker();
            const initialSteps = [makeUserStep(0), makeUserStep(1)];
            const extraSteps = [makeUserStep(2), makeUserStep(3), makeUserStep(4)];

            // 1. Warm-up RPC fails with trajectory poll byte budget exhaustion -> must retry next poll!
            rpcCallMock.mockRejectedValueOnce(new Error('Trajectory poll byte budget exhausted'));
            const firstChanged = await tracker.processTrajectories(
                {} as any,
                [{ cascadeId: 'conv-retry', stepCount: 2, status: 'CASCADE_RUN_STATUS_IDLE' }],
            );
            expect(firstChanged).toBe(false);
            expect(tracker.getSummary().recentSteps).toHaveLength(0);

            // 2. Retry succeeds and ingests steps 0..1
            rpcCallMock.mockResolvedValueOnce({ steps: initialSteps });
            const secondChanged = await tracker.processTrajectories(
                {} as any,
                [{ cascadeId: 'conv-retry', stepCount: 2, status: 'CASCADE_RUN_STATUS_IDLE' }],
            );
            expect(secondChanged).toBe(true);
            expect(tracker.getSummary().recentSteps.map(s => s.stepIndex)).toEqual([0, 1]);

            // 3. Incremental growth 2 -> 5 fails with byte budget exhaustion -> must NOT skip steps 2..4!
            rpcCallMock.mockRejectedValueOnce(new Error('Trajectory poll byte budget exhausted'));
            const thirdChanged = await tracker.processTrajectories(
                {} as any,
                [{ cascadeId: 'conv-retry', stepCount: 5, status: 'CASCADE_RUN_STATUS_RUNNING' }],
            );
            expect(thirdChanged).toBe(false);
            expect(tracker.getSummary().recentSteps.map(s => s.stepIndex)).toEqual([0, 1]);

            // 4. Subsequent poll retries and ingests steps 2..4 cleanly!
            rpcCallMock.mockResolvedValueOnce({ steps: [...initialSteps, ...extraSteps] });
            const fourthChanged = await tracker.processTrajectories(
                {} as any,
                [{ cascadeId: 'conv-retry', stepCount: 5, status: 'CASCADE_RUN_STATUS_IDLE' }],
            );
            expect(fourthChanged).toBe(true);
            expect(tracker.getSummary().recentSteps.map(s => s.stepIndex)).toEqual([0, 1, 2, 3, 4]);
            const lastCallPayload = rpcCallMock.mock.calls[rpcCallMock.mock.calls.length - 1][2] as Record<string, unknown>;
            expect(lastCallPayload).toMatchObject({ cascadeId: 'conv-retry', startIndex: 0, endIndex: 5 });
        });
    });


    describe('ActivityTracker GM telemetry fields and mergeGMStats delegation (#66 #3 & #C)', () => {
        it('populates gmResponseTokens and gmCacheCreationTokens in injectGMData and preserves them through persistence slimming', () => {
            const tracker = new ActivityTracker();
            const gmSummary: GMSummary = {
                conversations: [{
                    cascadeId: 'conv-gm',
                    title: 'GM Conv',
                    totalSteps: 2,
                    calls: [{
                        stepIndices: [1],
                        executionId: 'exec-gm-1',
                        model: 'MODEL_PLACEHOLDER_M318',
                        modelDisplay: 'Gemini 3.8 Flash (High)',
                        responseModel: 'gemini-3.8-flash-high',
                        modelAccuracy: 'exact',
                        inputTokens: 2000,
                        outputTokens: 291,
                        thinkingTokens: 0,
                        responseTokens: 67,
                        cacheReadTokens: 8000,
                        cacheCreationTokens: 1500,
                        apiProvider: 'API_PROVIDER_GOOGLE',
                        ttftSeconds: 0.75,
                        streamingSeconds: 2.5,
                        credits: 1,
                        creditType: 'ai',
                        hasError: false,
                        errorMessage: '',
                        contextTokensUsed: 11500,
                        completionConfig: null,
                        systemPromptSnippet: '',
                        toolCount: 0,
                        toolNames: [],
                        promptSectionTitles: [],
                        promptSnippet: 'Detailed prompt snippet',
                        promptSource: 'messagePrompts',
                        messagePromptCount: 1,
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
                        createdAt: '2026-06-01T10:00:00.000Z',
                        latestStableMessageIndex: 0,
                        startStepIndex: 0,
                        checkpointIndex: 0,
                        checkpointSummaries: [],
                        systemContextItems: [],
                        toolCallsByStep: {},
                        contextWindowCapacity: 256000,
                    }],
                    coveredSteps: 1,
                    coverageRate: 0.5,
                    checkpointSummaries: [],
                }],
                modelBreakdown: {},
                totalCalls: 1,
                totalStepsCovered: 1,
                totalCredits: 1,
                totalInputTokens: 2000,
                totalOutputTokens: 291,
                totalCacheRead: 8000,
                totalCacheCreation: 1500,
                totalThinkingTokens: 0,
                contextGrowth: [],
                fetchedAt: '2026-06-01T10:00:01.000Z',
                totalRetryTokens: 0,
                totalRetryCredits: 0,
                totalRetryCount: 0,
                latestTokenBreakdown: [],
                stopReasonCounts: {},
                retryErrorCodes: {},
                recentErrors: [],
                toolCallCounts: {},
            };

            tracker.injectGMData(gmSummary);
            const event = tracker.getSummary().recentSteps.find(s => s.gmExecutionId === 'exec-gm-1');
            expect(event).toBeDefined();
            expect(event!.gmResponseTokens).toBe(67);
            expect(event!.gmCacheCreationTokens).toBe(1500);
            expect(event!.gmTTFT).toBe(0.75);
            expect(event!.gmStreamingDuration).toBe(2.5);

            const slimmed = slimStepEventForPersistence(event!);
            expect(slimmed.gmResponseTokens).toBe(67);
            expect(slimmed.gmCacheCreationTokens).toBe(1500);
            expect(slimmed.gmPromptSnippet).toBeUndefined();
        });

        it('delegates mergeGMStats to mergeGMModelStats (no zero-TTFT dilution, preserves creditCallCount & contextWindowCapacity)', () => {
            const makeStats = (over: Partial<GMModelStats>): GMModelStats => ({
                callCount: 1,
                stepsCovered: 1,
                totalInputTokens: 100,
                totalOutputTokens: 50,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 0,
                avgTTFT: 0,
                minTTFT: 0,
                maxTTFT: 0,
                avgStreaming: 0,
                cacheHitRate: 0,
                responseModel: 'claude-opus-4-6-thinking',
                apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
                completionConfig: null,
                hasSystemPrompt: false,
                toolCount: 0,
                promptSectionTitles: [],
                totalRetries: 0,
                errorCount: 0,
                creditCallCount: 0,
                exactCallCount: 1,
                placeholderOnlyCalls: 0,
                contextWindowCapacity: 0,
                ...over,
            });

            const target = makeStats({
                callCount: 2,
                avgTTFT: 0,
                avgStreaming: 0,
                ttftSampleCount: 0,
                streamingSampleCount: 0,
                creditCallCount: 1,
                contextWindowCapacity: 160000,
            });
            const source = makeStats({
                callCount: 1,
                avgTTFT: 2.0,
                minTTFT: 2.0,
                maxTTFT: 2.0,
                avgStreaming: 4.0,
                ttftSampleCount: 1,
                streamingSampleCount: 1,
                timedOutputTokens: 200,
                timedStreamingSeconds: 4.0,
                creditCallCount: 2,
                contextWindowCapacity: 256000,
            });

            mergeGMStats(target, source);
            expect(target.avgTTFT).toBeCloseTo(2.0, 10);
            expect(target.avgStreaming).toBeCloseTo(4.0, 10);
            expect(target.creditCallCount).toBe(3);
            expect(target.contextWindowCapacity).toBe(256000);
            expect(target.timedOutputTokens).toBe(200);
            expect(target.timedStreamingSeconds).toBeCloseTo(4.0, 10);
        });
    });
});

describe('[trajectory-agent-hub]', () => {
    // Only model/token metadata from the authorized 2026-10-31 Low OK call.
    // No prompts, customization content, account or conversation identifiers.
    const lowUsage = { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '12905', outputTokens: '5', responseOutputTokens: '5' };

    function userInput(model = 'MODEL_PLACEHOLDER_M419'): Record<string, unknown> {
        return { type: StepType.USER_INPUT, userInput: { userResponse: 'OK',
            userConfig: { plannerConfig: { planModel: model } } } };
    }

    function response(usage: Record<string, unknown> = lowUsage): Record<string, unknown> {
        return { type: StepType.PLANNER_RESPONSE, metadata: { generatorModel: usage.model, modelUsage: usage },
            plannerResponse: { response: 'OK', thinking: 'fixture' } };
    }

    function contextUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
        return { cascadeId: 'test-only', title: 'fixture', model: 'MODEL_PLACEHOLDER_M419',
            modelDisplayName: 'Gemini 4 Argon (Low)', contextUsed: 12910, totalOutputTokens: 5,
            totalToolCallOutputTokens: 0, contextLimit: 256000, usagePercent: 12910 / 256000 * 100,
            stepCount: 2, lastModifiedTime: '2026-10-31T00:00:00Z', status: 'CASCADE_RUN_STATUS_IDLE',
            isEstimated: false, lastModelUsage: { ...lowUsage, inputTokens: 12905, outputTokens: 5,
                responseOutputTokens: 5, cacheReadTokens: 0 }, estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0, imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
            compressionDetected: false, checkpointCompressionDrop: 0,
            hasGaps: false, checkpointModel: '', createdTime: '', lastUserInputTime: '',
            lastUserInputStepIndex: 0, repositoryName: '', gitOriginUrl: '', branchName: '', gitRootUri: '',
            tokenUsageSource: 'planner', ...overrides };
    }


    describe('agy planner token snapshots', () => {
        it('uses precise Low usage without a checkpoint and without adding response text twice', () => {
            expect(processSteps([userInput(), response()])).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419',
                inputTokens: 12905, totalOutputTokens: 5, contextUsed: 12910, isEstimated: false,
                tokenUsageSource: 'planner', estimatedDeltaSinceCheckpoint: 0, checkpointModel: '' });
        });

        it('includes cached input in context occupancy using the real image-workflow parent snapshot', () => {
            const usage = processSteps([response({ ...lowUsage, inputTokens: '2285', outputTokens: '248',
                responseOutputTokens: '248', cacheReadTokens: '11219' })]);
            expect(usage.contextUsed).toBe(13752);
            expect(usage.isEstimated).toBe(false);
            expect(usage.inputTokens).toBe(2285); // Fresh tokens remain distinct for billing.
            expect(usage.lastModelUsage?.cacheReadTokens).toBe(11219);
        });

        it('counts cache creation once and does not mistake cache hits for checkpoint compression', () => {
            const first = { type: StepType.CHECKPOINT, metadata: { modelUsage: { model: 'MODEL_PLACEHOLDER_M50',
                inputTokens: '15000', outputTokens: '10' } } };
            const cached = { type: StepType.CHECKPOINT, metadata: { modelUsage: { model: 'MODEL_PLACEHOLDER_M50',
                inputTokens: '1000', cacheReadTokens: '13000', cacheCreationTokens: '1000', outputTokens: '10' } } };
            const usage = processSteps([first, cached]);
            expect(usage.contextUsed).toBe(15010);
            expect(usage.checkpointCompressionDetected).toBe(false);
            expect(usage.checkpointCompressionDrop).toBe(0);
        });

        it('accepts cache-only protobuf input instead of replacing it with a text heuristic', () => {
            const usage = processSteps([response({ model: 'MODEL_PLACEHOLDER_M419', cacheReadTokens: '1000' })]);
            expect(usage.contextUsed).toBe(1000);
            expect(usage.isEstimated).toBe(false);
        });

        it.each(['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M418', 'MODEL_PLACEHOLDER_M419'])(
            'identifies selected %s before a response exists', model => {
                expect(processSteps([userInput(model)])).toMatchObject({ model, isEstimated: true, tokenUsageSource: 'estimated' });
            },
        );

        it('uses the latest response snapshot across a model switch, not a sum of all requests', () => {
            const latest = { ...lowUsage, model: 'MODEL_PLACEHOLDER_M417', inputTokens: 14000, outputTokens: 20 };
            expect(processSteps([userInput(), response(), userInput(latest.model), response(latest)]))
                .toMatchObject({ model: latest.model, contextUsed: 14020, totalOutputTokens: 20, isEstimated: false });
        });

        it('preserves legacy checkpoint accounting and tracks later tool/user deltas', () => {
            const checkpoint = { type: StepType.CHECKPOINT, metadata: { generatorModel: 'MODEL_PLACEHOLDER_M50',
                modelUsage: { model: 'MODEL_PLACEHOLDER_M50', inputTokens: '1000', outputTokens: '50' } } };
            expect(processSteps([userInput(), checkpoint])).toMatchObject({ contextUsed: 1050,
                model: 'MODEL_PLACEHOLDER_M419', tokenUsageSource: 'checkpoint', checkpointModel: 'MODEL_PLACEHOLDER_M50' });
            expect(processSteps([checkpoint, response(), { type: 'CORTEX_STEP_TYPE_TOOL', metadata: { toolCallOutputTokens: 100 } }, userInput()]))
                .toMatchObject({ contextUsed: 13011, totalToolCallOutputTokens: 100,
                    tokenUsageSource: 'planner', isEstimated: true, estimatedDeltaSinceCheckpoint: 101 });
        });

        it.each(['NaN', '12905oops', '-5', '1.5', null, Infinity, Number.MAX_SAFE_INTEGER + 1])(
            'rejects malformed model token count %s instead of claiming precision', inputTokens => {
                const result = processSteps([userInput(), response({ ...lowUsage, inputTokens })]);
                expect(result.lastModelUsage).toBeNull();
                expect(result.isEstimated).toBe(true);
                expect(Number.isFinite(result.contextUsed)).toBe(true);
            },
        );

        it('accepts protobuf zero input with a real output count', () => {
            const result = processSteps([response({ model: 'MODEL_PLACEHOLDER_M419', outputTokens: '5' })]);
            expect(result.contextUsed).toBe(5);
            expect(result.isEstimated).toBe(false);
        });

        it('produces correct model identity and context from a summary with no model hints', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({ steps: [userInput(), response()] });
            const summary = { cascadeId: 'test-only', stepCount: 2, requestedModel: '', generatorModel: '',
                summary: 'fixture', status: 'CASCADE_RUN_STATUS_IDLE' } as TrajectorySummary;
            const usage = await getContextUsage({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false }, summary);
            expect(usage).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419', modelDisplayName: 'Gemini 4 Argon (Low)',
                contextUsed: 12910, totalOutputTokens: 5, tokenUsageSource: 'planner', isEstimated: false });
        });
    });


    describe('context precision and stale caches', () => {
        it('does not replace provider counts with the larger pre-call GM estimate', () => {
            const usage = contextUsage();
            expect(applyGMContextToUsage(usage, 18324)).toBe(false);
            expect(usage.contextUsed).toBe(12910);
            expect(usage.isEstimated).toBe(false);
        });

        it('keeps a GM fallback explicitly estimated and rejects non-finite values', () => {
            const usage = contextUsage({ lastModelUsage: null, tokenUsageSource: 'estimated', contextUsed: 10000 });
            expect(applyGMContextToUsage(usage, 18324)).toBe(true);
            expect(usage.isEstimated).toBe(true);
            expect(usage.usagePercent).toBe(18324 / 256000 * 100);
            for (const value of [NaN, Infinity, -1, 0, 1.5]) { expect(applyGMContextToUsage(usage, value)).toBe(false); }
        });

        it('re-fetches pre-fix cached usage and mutable running steps', () => {
            const usage = contextUsage();
            expect(hasSameUsageInputs(usage, usage)).toBe(true);
            expect(hasSameUsageInputs({ ...usage, tokenUsageSource: undefined }, usage)).toBe(false);
            expect(hasSameUsageInputs(usage, { ...usage, status: 'CASCADE_RUN_STATUS_RUNNING' })).toBe(false);
            expect(hasSameUsageInputs({ ...usage, status: 'CASCADE_RUN_STATUS_RUNNING' }, usage)).toBe(false);
        });
    });
});

describe('[image-model-registry]', () => {
    const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };

    const imageSpec = { ...getModelSpecs().find(spec => spec.placeholderId === 'MODEL_PLACEHOLDER_M21')! };

    const imageMetadata = {
        model: 'MODEL_PLACEHOLDER_M21', displayName: 'Gemini 3.1 Flash Image',
        maxTokens: 65536, maxOutputTokens: 65536, apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
        supportsImages: true,
    };


    afterEach(() => {
        vi.clearAllMocks();
        setAvailableImageModelIds([]);
        updateModelSpec('MODEL_PLACEHOLDER_M21', { ...imageSpec, supportsAdaptiveThinking: undefined, thinkingLevel: undefined });
    });


    describe('dedicated image model registry', () => {
        it('keeps image native capacity separate from unknown chat compression and chat quota', () => {
            for (const identity of ['MODEL_PLACEHOLDER_M21', 'gemini-3.1-flash-image', 'Gemini 3.1 Flash Image']) {
                expect(resolveModelId(identity)).toBe('MODEL_PLACEHOLDER_M21');
                expect(isImageGenerationModel(identity)).toBe(true);
                expect(getContextLimit(identity)).toBe(65536);
                expect(getQuotaPoolKey(identity, 'chat-reset')).toBe('image:MODEL_PLACEHOLDER_M21');
                expect(guessContextLimitSpec(identity)).toEqual({ cpLimit: 0, cpThreshold: 0, maxTokens: 65536, supportsThinking: false });
                expect(findPricing(identity)).toBeNull();
            }
            expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M417', 'chat-reset')).toBe('gemini');
            expect(isImageGenerationModel('MODEL_PLACEHOLDER_M417')).toBe(false);
            expect(isImageGenerationModel('MODEL_PLACEHOLDER_M210')).toBe(false);
            expect(isImageGenerationModel('some-image-keyword')).toBe(false);
            expect(getModelDisplayName('MODEL_UNSPECIFIED')).toBe('MODEL_UNSPECIFIED');
        });

        it('only exposes image cards from an explicitly available catalog and clears on account changes', () => {
            expect(getAvailableImageModelSpecs()).toEqual([]);
            setAvailableImageModelIds(['gemini-3.1-flash-image', 'MODEL_PLACEHOLDER_M21', 'unknown-image']);
            expect(getAvailableImageModelSpecs().map(spec => spec.placeholderId)).toEqual(['MODEL_PLACEHOLDER_M21']);
            setAvailableImageModelIds([]);
            expect(getAvailableImageModelSpecs()).toEqual([]);
            expect(isImageGenerationModel('MODEL_PLACEHOLDER_M21')).toBe(true); // archived identity survives
        });

        it('syncs an image-only catalog without inventing compression or requiring a picker entry', async () => {
            updateModelSpec('MODEL_PLACEHOLDER_M21', { cpLimit: 159000, cpThreshold: 50000, thinkingBudget: 1024 });
            vi.mocked(rpcCall).mockResolvedValueOnce({ response: {
                imageGenerationModelIds: ['gemini-3.1-flash-image'], models: { 'gemini-3.1-flash-image': imageMetadata },
            } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
            expect(getAvailableImageModelSpecs()).toHaveLength(1);
            expect(getAvailableImageModelSpecs()[0]).toMatchObject({ isImageGeneration: true,
                cpLimit: 0, cpThreshold: 0, maxTokens: 65536, maxOutputTokens: 65536, thinkingBudget: 0, supportsThinking: false });
            expect(getContextLimit('MODEL_PLACEHOLDER_M21')).toBe(65536);
        });

        it('registers a future image identity from the explicit capability list, not supportsImages alone', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({ imageGenerationModelIds: ['fixture-image-v2'], models: {
                'fixture-image-v2': { ...imageMetadata, model: 'MODEL_PLACEHOLDER_M9021', displayName: 'Fixture Image V2', maxTokens: 32768 },
                'fixture-vision-only': { ...imageMetadata, model: 'MODEL_PLACEHOLDER_M9022', displayName: 'Fixture Vision Only' },
            } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
            expect(resolveModelId('fixture-image-v2')).toBe('MODEL_PLACEHOLDER_M9021');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M9021')).toBe('Fixture Image V2');
            expect(getAvailableImageModelSpecs().map(spec => spec.placeholderId)).toEqual(['MODEL_PLACEHOLDER_M9021']);
            expect(getContextLimit('fixture-image-v2')).toBe(32768);
            expect(getQuotaPoolKey('fixture-image-v2', 'chat-reset')).toBe('image:MODEL_PLACEHOLDER_M9021');
            expect(isImageGenerationModel('Fixture Image V2')).toBe(true);
            expect(isImageGenerationModel('fixture-vision-only')).toBe(false);
            expect(resolveModelId('fixture-vision-only')).toBeUndefined();
        });

        it('applies an authoritative empty image list without erasing historical image identity', async () => {
            setAvailableImageModelIds(['gemini-3.1-flash-image']);
            vi.mocked(rpcCall).mockResolvedValueOnce({ response: { imageGenerationModelIds: [], models: {} } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
            expect(getAvailableImageModelSpecs()).toEqual([]);
            expect(resolveModelId('gemini-3.1-flash-image')).toBe('MODEL_PLACEHOLDER_M21');
        });

        it('preserves last valid image availability when RPC or the capability list is malformed', async () => {
            setAvailableImageModelIds(['gemini-3.1-flash-image']);
            vi.mocked(rpcCall).mockRejectedValueOnce(new Error('fixture unavailable'));
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
            vi.mocked(rpcCall).mockResolvedValueOnce({ response: { imageGenerationModelIds: [null], models: {} } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
            expect(getAvailableImageModelSpecs().map(spec => spec.placeholderId)).toEqual(['MODEL_PLACEHOLDER_M21']);
        });

        it('classifies the typed generation step as a readable tool without treating image input as generation', () => {
            const classification = classifyStep('CORTEX_STEP_TYPE_GENERATE_IMAGE');
            expect(classification).toEqual({ category: 'tool', icon: '🎨', label: 'generate_image' });
            expect(extractToolName({ type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE', generateImage: { modelName: 'gemini-3.1-flash-image' } }, classification.label)).toBe('generate_image');
            expect(classifyStep('CORTEX_STEP_TYPE_USER_INPUT').category).toBe('user');
        });

        it('matches every currently available chat model and image model against the captured catalog', async () => {
            expect(verifiedModelCatalog.filter(row => row.inLivePicker)).toHaveLength(13);
            const models = Object.fromEntries(verifiedModelCatalog.map(row => [row.catalogId, {
                ...row.metadata,
                ...(row.checkpointer ? { modelExperiments: { experiments: {
                    CASCADE_USE_EXPERIMENT_CHECKPOINTER: { stringValue: JSON.stringify(row.checkpointer) },
                } } } : {}),
            }]));
            vi.mocked(rpcCall).mockResolvedValueOnce({ response: {
                models, imageGenerationModelIds: verifiedModelCatalog.filter(row => row.isImageGenerationModel).map(row => row.catalogId),
            } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
            for (const row of verifiedModelCatalog) {
                const spec = getModelSpecs().find(item => item.placeholderId === row.metadata.model)!;
                const cpLimit = row.checkpointer ? Number(row.checkpointer.max_token_limit) : 0;
                expect(spec, row.catalogId).toMatchObject({ modelId: row.catalogId,
                    displayName: row.metadata.displayName, apiProvider: row.metadata.apiProvider.replace('API_PROVIDER_', ''),
                    maxTokens: row.metadata.maxTokens, maxOutputTokens: row.metadata.maxOutputTokens,
                    cpLimit, cpThreshold: row.checkpointer ? Number(row.checkpointer.token_threshold) : 0,
                    supportsThinking: 'supportsThinking' in row.metadata ? row.metadata.supportsThinking : false,
                    thinkingBudget: 'thinkingBudget' in row.metadata ? row.metadata.thinkingBudget : 0,
                    thinkingLevel: 'thinkingLevel' in row.metadata ? row.metadata.thinkingLevel : 0,
                });
                expect(resolveModelId(row.catalogId)).toBe(row.metadata.model);
                expect(getContextLimit(row.catalogId)).toBe(cpLimit || row.metadata.maxTokens);
                expect(isImageGenerationModel(row.catalogId)).toBe(row.isImageGenerationModel);
            }
            expect(getAvailableImageModelSpecs().map(spec => spec.modelId)).toEqual(['gemini-3.1-flash-image']);
        });
    });
});

describe('[image-workflow]', () => {
    const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };

    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };


    function invoke(...ids: string[]): Record<string, unknown> {
        return { type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT', invokeSubagent: {
            subagents: [{ typeName: 'image' }], results: ids.map(conversationId => ({ conversationId })),
        } };
    }

    function image(): Record<string, unknown> {
        return { type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE', status: 'CORTEX_STEP_STATUS_DONE',
            metadata: { generatorModel: 'MODEL_PLACEHOLDER_M322', toolCall: { name: 'generate_image' } },
            generateImage: { modelName: 'gemini-3.1-flash-image', aspectRatio: '1:1', generatedMedia: { mimeType: 'image/jpeg' } } };
    }

    function child(steps: Array<Record<string, unknown>>, status = 'CASCADE_RUN_STATUS_IDLE') {
        return { trajectory: { steps }, status, numTotalSteps: steps.length };
    }

    function usage(children = ['child']): ContextUsage {
        return { cascadeId: 'parent', title: 'Fixture', model: 'MODEL_PLACEHOLDER_M419',
            modelDisplayName: 'Gemini 4 Argon (Low)', contextUsed: 13752, contextLimit: 256000,
            totalOutputTokens: 248, totalToolCallOutputTokens: 0, usagePercent: 13752 / 256000 * 100,
            stepCount: 6, lastModifiedTime: '2026-10-31T00:00:00Z', status: 'CASCADE_RUN_STATUS_IDLE',
            isEstimated: false, lastModelUsage: { model: 'MODEL_PLACEHOLDER_M419', inputTokens: 2285,
                cacheReadTokens: 11219, outputTokens: 248, responseOutputTokens: 248 },
            estimatedDeltaSinceCheckpoint: 0, imageGenStepCount: 0, imageGenerationModels: [],
            imageGenerationIncomplete: false, imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: children },
            compressionDetected: false, checkpointCompressionDrop: 0, hasGaps: false, checkpointModel: '',
            createdTime: '', lastUserInputTime: '', lastUserInputStepIndex: 0, repositoryName: '',
            gitOriginUrl: '', branchName: '', gitRootUri: '', tokenUsageSource: 'planner' };
    }


    afterEach(async () => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        vi.useRealTimers();
        resetImageWorkflowCache();
        await setLanguageToState('both', state);
    });


    describe('linked image workflows', () => {
        it('reads references only from the typed invocation result and deduplicates them', () => {
            expect(extractLinkedSubagentIds([
                invoke('child-a', 'child-a', 'child-b'),
                { type: 'CORTEX_STEP_TYPE_USER_INPUT', invokeSubagent: { results: [{ conversationId: 'unrelated' }] } },
                { type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT', conversationId: 'unrelated',
                    invokeSubagent: { subagents: [{ initialPrompt: 'unrelated' }], results: [null, {}, { conversationId: '' }, { conversationId: 1 }] } },
            ])).toEqual(['child-a', 'child-b']);
        });

        it('reports the actual M21 image inside an M322 child while preserving the parent measured context', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({ steps: [invoke('child'), {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { generatorModel: 'MODEL_PLACEHOLDER_M419',
                    modelUsage: { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '2285', cacheReadTokens: '11219', outputTokens: '248' } },
            }] });
            vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
            const trajectory = { ...usage(), stepCount: 2, summary: 'Fixture', workspaceUris: [], requestedModel: '', generatorModel: '' } as TrajectorySummary;
            const result = await getContextUsage(ls, trajectory);
            expect(result).toMatchObject({ imageGenStepCount: 1, imageGenerationModels: ['MODEL_PLACEHOLDER_M21'],
                imageGenerationIncomplete: false, model: 'MODEL_PLACEHOLDER_M419', contextUsed: 13752,
                totalOutputTokens: 248, isEstimated: false });
            expect(vi.mocked(rpcCall).mock.calls.map(args => [args[1], args[2].cascadeId])).toEqual([
                ['GetCascadeTrajectorySteps', 'parent'], ['GetCascadeTrajectory', 'child'],
            ]);
            const refreshed = await refreshWorkflowImageUsage(ls, result);
            expect(refreshed.imageGenStepCount).toBe(1);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
        });

        it('refreshes a running child even when its idle parent input has not changed', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce(child([], 'CASCADE_RUN_STATUS_RUNNING'));
            const first = await refreshWorkflowImageUsage(ls, usage());
            expect(first.imageGenStepCount).toBe(0);
            expect(hasSameUsageInputs(first, first)).toBe(true);
            vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
            const second = await refreshWorkflowImageUsage(ls, first);
            expect(second.imageGenStepCount).toBe(1);
            expect(second.contextUsed).toBe(13752);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
        });

        it('deduplicates shared children and terminates cycles without reading unrelated conversations', async () => {
            vi.mocked(rpcCall).mockImplementation(async (_ls, _method, params) => {
                const id = params.cascadeId;
                if (id === 'a') { return child([invoke('c', 'parent')]); }
                if (id === 'b') { return child([invoke('c')]); }
                if (id === 'c') { return child([image(), invoke('a')]); }
                throw new Error('unexpected conversation');
            });
            const result = await refreshWorkflowImageUsage(ls, usage(['a', 'b', 'a']));
            expect(result.imageGenStepCount).toBe(1);
            expect(result.imageGenerationIncomplete).toBe(false);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(3);
        });

        it('bounds wide and deep workflows and marks the incomplete count', async () => {
            vi.mocked(rpcCall).mockResolvedValue(child([image()]));
            const wide = await refreshWorkflowImageUsage(ls, usage(Array.from({ length: 20 }, (_, i) => `child-${i}`)));
            expect(wide.imageGenStepCount).toBe(16);
            expect(wide.imageGenerationIncomplete).toBe(true);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(16);
            resetImageWorkflowCache();
            vi.mocked(rpcCall).mockClear();
            vi.mocked(rpcCall).mockImplementation(async (_ls, _method, params) =>
                child([image(), invoke(String(Number(params.cascadeId) + 1))]));
            const deep = await refreshWorkflowImageUsage(ls, usage(['1']));
            expect(deep.imageGenStepCount).toBe(4);
            expect(deep.imageGenerationIncomplete).toBe(true);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(4);
        });

        it('preserves observed images on a failed refresh and clears observations on account/backend invalidation', async () => {
            vi.useFakeTimers();
            vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
            const first = await refreshWorkflowImageUsage(ls, usage());
            vi.advanceTimersByTime(31_000);
            vi.mocked(rpcCall).mockRejectedValueOnce(new Error('child unavailable'));
            const failed = await refreshWorkflowImageUsage(ls, first);
            expect(failed.imageGenStepCount).toBe(1);
            expect(failed.imageGenerationIncomplete).toBe(true);
            invalidateLiveModelMetadata();
            vi.mocked(rpcCall).mockRejectedValueOnce(new Error('new account child unavailable'));
            const other = await refreshWorkflowImageUsage(ls, failed);
            expect(other.imageGenStepCount).toBe(0);
            expect(other.imageGenerationIncomplete).toBe(true);
        });

        it('does not reuse child data across a backend connection identity', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
            await refreshWorkflowImageUsage(ls, usage());
            vi.mocked(rpcCall).mockResolvedValueOnce(child([]));
            const changed = await refreshWorkflowImageUsage({ ...ls, csrfToken: 'new-fixture' }, usage());
            expect(changed.imageGenStepCount).toBe(0);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
        });

        it('does not publish an in-flight child result after the account changes', async () => {
            let finish!: (value: Record<string, unknown>) => void;
            vi.mocked(rpcCall).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
            const pending = refreshWorkflowImageUsage(ls, usage());
            resetImageWorkflowCache();
            finish(child([image(), invoke('stale-grandchild')]));
            const stale = await pending;
            expect(stale.imageGenStepCount).toBe(0);
            expect(stale.imageGenerationIncomplete).toBe(true);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(1);
            vi.mocked(rpcCall).mockResolvedValueOnce(child([]));
            expect((await refreshWorkflowImageUsage(ls, usage())).imageGenStepCount).toBe(0);
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
        });

        it('reports truncated child data and respects cancellation without fetching another conversation', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({ ...child([image()]), numTotalSteps: 20 });
            expect((await refreshWorkflowImageUsage(ls, usage())).imageGenerationIncomplete).toBe(true);
            const controller = new AbortController();
            controller.abort();
            await expect(refreshWorkflowImageUsage(ls, usage(), controller.signal)).rejects.toThrow('aborted');
            expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(1);
        });

        it('persists model and completeness changes even when the image count is unchanged', () => {
            const storage = { get: vi.fn().mockReturnValue(null), update: vi.fn().mockResolvedValue(undefined) };
            const store = new MonitorStore();
            store.init(storage);
            const initial = { ...usage(), imageGenStepCount: 1 };
            store.record([initial]);
            store.record([{ ...initial, imageGenerationModels: ['MODEL_PLACEHOLDER_M21'], imageGenerationIncomplete: true }]);
            expect(storage.update).toHaveBeenCalledTimes(2);
            expect(store.getSnapshot('parent')?.imageGenerationModels).toEqual(['MODEL_PLACEHOLDER_M21']);
            expect(store.getSnapshot('parent')?.imageGenerationIncomplete).toBe(true);
        });

        it.each(['en', 'zh', 'both'] as Language[])('shows the image count, true image model and partial-data warning in %s', async language => {
            await setLanguageToState(language, state);
            const overview = buildOverviewTabContent({
                ...usage(), imageGenStepCount: 1, imageGenerationModels: ['MODEL_PLACEHOLDER_M21'], imageGenerationIncomplete: true,
            }, [], null);
            expect(overview).toContain('Gemini 3.1 Flash Image');
            expect(overview).toContain(language === 'zh' ? '图片模型' : 'Image model');
            expect(overview).toContain(language === 'zh' ? '图片工作流数据不完整' : 'Image workflow data is incomplete');
            expect(overview).not.toContain('M322');
        });
    });
});

describe('[image-steps]', () => {
    describe('image generation trajectory isolation', () => {
        it.each([
            { type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE' },
            { type: 'CORTEX_STEP_TYPE_IMAGE_GENERATION' },
            { type: 'FUTURE_IMAGE_TOOL', generateImage: { modelName: 'gemini-3.1-flash-image' } },
        ])('recognizes typed image generation with no generator metadata: %j', step => {
            expect(isImageGenStep(step, '')).toBe(true);
            expect(processSteps([step]).imageGenStepCount).toBe(1);
        });

        it('recognizes the opaque image-model ID without relying on name keywords', () => {
            expect(isImageGenStep({ type: 'FUTURE_GENERATOR' }, 'MODEL_PLACEHOLDER_M21')).toBe(true);
        });

        it.each(['CORTEX_STEP_TYPE_GENERATE_CODE', 'CORTEX_STEP_TYPE_VIEW_IMAGE', StepType.USER_INPUT])(
            'does not count ordinary image inputs or unrelated generators: %s', type => {
                expect(isImageGenStep({ type }, 'MODEL_PLACEHOLDER_M417')).toBe(false);
            },
        );

        it('does not let the image backend replace the text conversation model or context snapshot', () => {
            const usage = processSteps([
                { type: StepType.USER_INPUT, userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M419' } } } },
                { type: StepType.PLANNER_RESPONSE, metadata: { generatorModel: 'MODEL_PLACEHOLDER_M419',
                    modelUsage: { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '12000', outputTokens: '100' } } },
                { type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE', generateImage: { modelName: 'gemini-3.1-flash-image' },
                    metadata: { generatorModel: 'MODEL_PLACEHOLDER_M21', requestedModel: { model: 'MODEL_PLACEHOLDER_M21' },
                        modelUsage: { model: 'MODEL_PLACEHOLDER_M21', inputTokens: '50', outputTokens: '1120' }, toolCallOutputTokens: 20 } },
            ]);
            expect(usage).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419', contextUsed: 12120,
                totalOutputTokens: 100, imageGenStepCount: 1, totalToolCallOutputTokens: 20, isEstimated: true });
            expect(usage.lastModelUsage?.model).toBe('MODEL_PLACEHOLDER_M419');
        });

        it('keeps image planner usage out of the coordinating text request snapshot', () => {
            const usage = processSteps([
                { type: StepType.USER_INPUT, userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M419' } } } },
                { type: StepType.PLANNER_RESPONSE, metadata: { generatorModel: 'MODEL_PLACEHOLDER_M21',
                    modelUsage: { model: 'MODEL_PLACEHOLDER_M21', inputTokens: '50', outputTokens: '1120' } } },
            ]);
            expect(usage.model).toBe('MODEL_PLACEHOLDER_M419');
            expect(usage.imageGenStepCount).toBe(1);
            expect(usage.lastModelUsage).toBeNull();
        });
    });
});

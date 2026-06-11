import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { DailyLedger, type DailyLedgerState, type LedgerAccountBucket, type LedgerDayData } from '../src/daily-ledger';
import { GMTracker, type GMCallEntry, type GMConversationData } from '../src/gm-tracker';

function localTime(y: number, month: number, d: number, h = 0, m = 0, s = 0, ms = 0): Date {
    return new Date(y, month - 1, d, h, m, s, ms);
}

function localIso(y: number, month: number, d: number, h = 0, m = 0, s = 0, ms = 0): string {
    return localTime(y, month, d, h, m, s, ms).toISOString();
}

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    const model = overrides.model || 'MODEL_PLACEHOLDER_M16';
    const isGemini = model === 'MODEL_PLACEHOLDER_M16';
    return {
        stepIndices: [1],
        executionId: overrides.executionId || `exec-${Math.random().toString(36).slice(2)}`,
        model,
        modelDisplay: overrides.modelDisplay || (isGemini ? 'Gemini 3.1 Pro (High)' : 'Claude Opus 4.6 (Thinking)'),
        responseModel: overrides.responseModel || (isGemini ? 'gemini-3.1-pro-high' : 'claude-opus-4-6-thinking'),
        modelAccuracy: 'exact',
        inputTokens: overrides.inputTokens ?? 100,
        outputTokens: overrides.outputTokens ?? 50,
        thinkingTokens: overrides.thinkingTokens ?? 10,
        responseTokens: overrides.responseTokens ?? 40,
        cacheReadTokens: overrides.cacheReadTokens ?? 5,
        cacheCreationTokens: overrides.cacheCreationTokens ?? 7,
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        ttftSeconds: 1.2,
        streamingSeconds: 2.3,
        credits: overrides.credits ?? 3,
        creditType: 'ai',
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
        createdAt: overrides.createdAt || localIso(2026, 6, 1, 10),
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        accountEmail: overrides.accountEmail || 'user@example.com',
        toolCallsByStep: {},
        contextWindowCapacity: 160000,
    };
}

function addLegacyAggregate(bucket: LedgerAccountBucket, modelKey: string, calls: number): void {
    const ms = bucket.modelStats[modelKey];
    if (!ms) { throw new Error(`missing model stats for ${modelKey}`); }
    bucket.totalCalls += calls;
    bucket.totalInputTokens += calls * 100;
    bucket.totalOutputTokens += calls * 50;
    bucket.totalThinkingTokens += calls * 10;
    bucket.totalCacheRead += calls * 5;
    bucket.totalCacheCreation += calls * 7;
    bucket.totalCredits += calls * 3;
    ms.calls += calls;
    ms.inputTokens += calls * 100;
    ms.outputTokens += calls * 50;
    ms.thinkingTokens += calls * 10;
    ms.cacheReadTokens += calls * 5;
    ms.cacheCreationTokens += calls * 7;
    ms.credits += calls * 3;
}

describe('DailyLedger quota reset regressions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(localTime(2026, 6, 1, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('settles only calls at or before the quota-reset cutoff', () => {
        const ledger = new DailyLedger('2026-06-01');
        const resetTime = localTime(2026, 6, 1, 12).getTime();

        expect(ledger.recordCalls([
            {
                call: makeCall({ executionId: 'pre-reset', createdAt: localIso(2026, 6, 1, 11, 59) }),
                dedupKey: 'conv:0',
            },
            {
                call: makeCall({
                    executionId: 'post-reset',
                    createdAt: localIso(2026, 6, 1, 12, 1),
                    inputTokens: 200,
                    outputTokens: 80,
                    thinkingTokens: 20,
                    cacheReadTokens: 8,
                    cacheCreationTokens: 9,
                    credits: 4,
                }),
                dedupKey: 'conv:1',
            },
        ])).toBe(2);

        const settled = ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com', resetTime);

        expect(settled?.totalCalls).toBe(1);
        expect(settled?.totalInputTokens).toBe(100);
        expect(settled?.totalThinkingTokens).toBe(10);
        expect(settled?.totalCacheCreation).toBe(7);
        expect(ledger.isPoolSettled(['MODEL_PLACEHOLDER_M16'], 'user@example.com', resetTime)).toBe(true);
        expect(ledger.isPoolSettled(['MODEL_PLACEHOLDER_M16'], 'user@example.com', resetTime + 1)).toBe(false);

        const active = ledger.getAccountActive('user@example.com');
        expect(active?.totalCalls).toBe(1);
        expect(active?.totalInputTokens).toBe(200);
        expect(active?.totalThinkingTokens).toBe(20);
        expect(active?.totalCacheCreation).toBe(9);
        expect(active?.modelStats['Gemini 3.1 Pro (High)']?.calls).toBe(1);
    });

    it('clamps active totals when corrupted state is settled defensively', () => {
        const ledger = new DailyLedger('2026-06-01');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'corrupt-source' }), dedupKey: 'conv:0' },
        ])).toBe(1);
        const bucket = ledger.getAccountActive('user@example.com')!;
        bucket.totalInputTokens = 0;
        bucket.totalOutputTokens = 0;
        bucket.totalThinkingTokens = 0;
        bucket.totalCacheRead = 0;
        bucket.totalCacheCreation = 0;
        bucket.totalCredits = 0;
        bucket.totalEstimatedCost = 0;

        ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com');

        expect(bucket.totalCalls).toBe(0);
        expect(bucket.totalInputTokens).toBe(0);
        expect(bucket.totalOutputTokens).toBe(0);
        expect(bucket.totalThinkingTokens).toBe(0);
        expect(bucket.totalCacheRead).toBe(0);
        expect(bucket.totalCacheCreation).toBe(0);
        expect(bucket.totalCredits).toBe(0);
        expect(bucket.totalEstimatedCost).toBe(0);
    });

    it('preserves settled thinking and cache-creation tokens with exact per-model totals', () => {
        const dayData: LedgerDayData = {
            dateKey: '2026-06-01',
            accounts: {},
            settled: [{
                settledAt: localIso(2026, 6, 1, 12),
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_PLACEHOLDER_M16', 'MODEL_PLACEHOLDER_M26'],
                poolModelLabels: ['Gemini 3.1 Pro (High)', 'Claude Opus 4.6 (Thinking)'],
                totalCalls: 2,
                totalInputTokens: 5,
                totalOutputTokens: 7,
                totalThinkingTokens: 5,
                totalCacheRead: 3,
                totalCacheCreation: 5,
                totalCredits: 5,
                totalEstimatedCost: 0,
                modelCalls: {
                    'Gemini 3.1 Pro (High)': 1,
                    'Claude Opus 4.6 (Thinking)': 1,
                },
            }],
        };

        const { summary } = buildGMSummaryFromLedger(dayData);
        const modelStats = Object.values(summary.modelBreakdown);

        expect(summary.totalInputTokens).toBe(5);
        expect(summary.totalOutputTokens).toBe(7);
        expect(summary.totalThinkingTokens).toBe(5);
        expect(summary.totalCacheRead).toBe(3);
        expect(summary.totalCacheCreation).toBe(5);
        expect(modelStats.reduce((sum, ms) => sum + ms.totalInputTokens, 0)).toBe(5);
        expect(modelStats.reduce((sum, ms) => sum + ms.totalOutputTokens, 0)).toBe(7);
        expect(modelStats.reduce((sum, ms) => sum + ms.totalThinkingTokens, 0)).toBe(5);
        expect(modelStats.reduce((sum, ms) => sum + ms.totalCacheRead, 0)).toBe(3);
        expect(modelStats.reduce((sum, ms) => sum + ms.totalCacheCreation, 0)).toBe(5);
        expect(modelStats.reduce((sum, ms) => sum + ms.totalCredits, 0)).toBe(5);
    });

    it('settles restored legacy aggregate usage plus newly recorded per-call usage', () => {
        const legacyBucket: Omit<LedgerAccountBucket, 'recordedCalls'> = {
            accountEmail: 'user@example.com',
            totalCalls: 5,
            totalInputTokens: 500,
            totalOutputTokens: 250,
            totalThinkingTokens: 50,
            totalCacheRead: 25,
            totalCacheCreation: 35,
            totalCredits: 15,
            totalEstimatedCost: 0,
            modelStats: {
                'Gemini 3.1 Pro (High)': {
                    calls: 5,
                    inputTokens: 500,
                    outputTokens: 250,
                    thinkingTokens: 50,
                    cacheReadTokens: 25,
                    cacheCreationTokens: 35,
                    credits: 15,
                    estimatedCost: 0,
                },
            },
            recordedCallIds: ['conv:0', 'conv:1', 'conv:2', 'conv:3', 'conv:4'],
        };
        const legacyState = {
            version: 1,
            dateKey: '2026-06-01',
            accounts: { 'user@example.com': legacyBucket },
            settled: [],
        } as unknown as DailyLedgerState;
        const ledger = DailyLedger.restore(legacyState);

        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'post-upgrade', createdAt: localIso(2026, 6, 1, 11, 55) }), dedupKey: 'conv:5' },
        ])).toBe(1);

        const settled = ledger.settleForQuotaReset(
            ['MODEL_PLACEHOLDER_M16'],
            'user@example.com',
            localTime(2026, 6, 1, 12).getTime(),
        );

        expect(settled?.totalCalls).toBe(6);
        expect(settled?.totalInputTokens).toBe(600);
        expect(settled?.totalOutputTokens).toBe(300);
        expect(settled?.totalThinkingTokens).toBe(60);
        expect(settled?.totalCacheRead).toBe(30);
        expect(settled?.totalCacheCreation).toBe(42);
        expect(settled?.totalCredits).toBe(18);

        const active = ledger.getAccountActive('user@example.com');
        expect(active?.totalCalls).toBe(0);
        expect(active?.modelStats['Gemini 3.1 Pro (High)']).toBeUndefined();
    });

    it('settles partial-migration aggregate residuals without double-counting recorded calls across models', () => {
        const ledger = new DailyLedger('2026-06-01');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'partial-gemini' }), dedupKey: 'conv-partial:0' },
            { call: makeCall({ executionId: 'partial-claude', model: 'MODEL_PLACEHOLDER_M26' }), dedupKey: 'conv-partial:1' },
        ])).toBe(2);

        const bucket = ledger.getAccountActive('user@example.com')!;
        addLegacyAggregate(bucket, 'Gemini 3.1 Pro (High)', 3);
        addLegacyAggregate(bucket, 'Claude Opus 4.6 (Thinking)', 2);
        const restored = DailyLedger.restore(ledger.serialize());

        const settled = restored.settleForQuotaReset(
            ['MODEL_PLACEHOLDER_M16', 'MODEL_PLACEHOLDER_M26'],
            'user@example.com',
            localTime(2026, 6, 1, 12).getTime(),
        );

        expect(settled?.totalCalls).toBe(7);
        expect(settled?.totalInputTokens).toBe(700);
        expect(settled?.totalCredits).toBe(21);
        expect(settled?.modelCalls).toEqual({
            'Gemini 3.1 Pro (High)': 4,
            'Claude Opus 4.6 (Thinking)': 3,
        });
        expect(restored.getAccountActive('user@example.com')?.totalCalls).toBe(0);
        expect(restored.settleForQuotaReset(
            ['MODEL_PLACEHOLDER_M16', 'MODEL_PLACEHOLDER_M26'],
            'user@example.com',
            localTime(2026, 6, 1, 12).getTime(),
        )).toBeNull();
    });

    it('does not create negative residuals when recorded calls exceed restored aggregate stats', () => {
        const ledger = new DailyLedger('2026-06-01');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'overrepresented-0' }), dedupKey: 'conv-over:0' },
            { call: makeCall({ executionId: 'overrepresented-1' }), dedupKey: 'conv-over:1' },
        ])).toBe(2);

        const bucket = ledger.getAccountActive('user@example.com')!;
        bucket.totalCalls = 1;
        bucket.totalInputTokens = 50;
        bucket.totalOutputTokens = 25;
        bucket.totalThinkingTokens = 5;
        bucket.totalCacheRead = 2;
        bucket.totalCacheCreation = 3;
        bucket.totalCredits = 1;
        const ms = bucket.modelStats['Gemini 3.1 Pro (High)'];
        ms.calls = 1;
        ms.inputTokens = 50;
        ms.outputTokens = 25;
        ms.thinkingTokens = 5;
        ms.cacheReadTokens = 2;
        ms.cacheCreationTokens = 3;
        ms.credits = 1;

        const settled = ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com');

        expect(settled?.totalCalls).toBe(2);
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(0);
        expect(ledger.getAccountActive('user@example.com')?.modelStats['Gemini 3.1 Pro (High)']).toBeUndefined();
    });

    it('settles calls with missing or invalid createdAt at the cutoff', () => {
        const ledger = new DailyLedger('2026-06-01');
        const missingCreatedAt = makeCall({ executionId: 'missing-created-at' });
        delete (missingCreatedAt as Partial<GMCallEntry>).createdAt;

        expect(ledger.recordCalls([
            { call: missingCreatedAt, dedupKey: 'conv-missing:0' },
            { call: makeCall({ executionId: 'invalid-created-at', createdAt: 'not-a-date' }), dedupKey: 'conv-invalid:0' },
        ])).toBe(2);

        const settled = ledger.settleForQuotaReset(
            ['MODEL_PLACEHOLDER_M16'],
            'user@example.com',
            localTime(2026, 6, 1, 12).getTime(),
        );

        expect(settled?.totalCalls).toBe(2);
        expect(settled?.totalInputTokens).toBe(200);
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(0);
    });

    it('keeps a post-reset call with missing createdAt active using its observed-at timestamp', () => {
        vi.setSystemTime(localTime(2026, 6, 1, 12, 1));
        const ledger = new DailyLedger('2026-06-01');
        const missingCreatedAt = makeCall({ executionId: 'post-reset-missing-created-at' });
        delete (missingCreatedAt as Partial<GMCallEntry>).createdAt;

        expect(ledger.recordCalls([
            { call: missingCreatedAt, dedupKey: 'conv-post-missing:0' },
        ])).toBe(1);

        const settled = ledger.settleForQuotaReset(
            ['MODEL_PLACEHOLDER_M16'],
            'user@example.com',
            localTime(2026, 6, 1, 12).getTime(),
        );

        expect(settled).toBeNull();
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(1);
        expect(ledger.getTodayTotals().totalCalls).toBe(1);
    });

    it('settles restored non-finite recorded call timestamps and keeps today totals consistent', () => {
        const ledger = new DailyLedger('2026-06-01');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'non-finite-created-at', createdAt: localIso(2026, 6, 1, 12, 1) }), dedupKey: 'conv-non-finite:0' },
        ])).toBe(1);
        const bucket = ledger.getAccountActive('user@example.com')!;
        bucket.recordedCalls[0].createdAtMs = Number.NaN;

        const settled = ledger.settleForQuotaReset(
            ['MODEL_PLACEHOLDER_M16'],
            'user@example.com',
            localTime(2026, 6, 1, 12).getTime(),
        );

        expect(settled?.totalCalls).toBe(1);
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(0);
        expect(ledger.getSettledEntries()).toHaveLength(1);
        expect(ledger.getTodayTotals().totalCalls).toBe(1);
    });
});

describe('GMTracker ledger position commits', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(localTime(2026, 6, 2, 0, 5));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('re-offers calls when a data-bearing stale daily ledger rejects them before archival catches up', () => {
        const tracker = new GMTracker();
        vi.setSystemTime(localTime(2026, 6, 1, 23, 55));
        const ledger = new DailyLedger('2026-06-01');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'previous-day-call', createdAt: localIso(2026, 6, 1, 23, 50) }), dedupKey: 'conv-previous:0' },
        ])).toBe(1);

        vi.setSystemTime(localTime(2026, 6, 2, 0, 5));
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        cache.set('conv-midnight', {
            cascadeId: 'conv-midnight',
            title: 'Midnight',
            totalSteps: 1,
            calls: [makeCall({ executionId: 'new-day-call', createdAt: localIso(2026, 6, 2, 0, 1) })],
            lifetimeCalls: 1,
            coveredSteps: 1,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const first = tracker.getNewCallsSinceLastRecord();
        expect(first.entries).toHaveLength(1);
        expect(ledger.recordCalls(first.entries)).toBe(0);

        const second = tracker.getNewCallsSinceLastRecord();
        expect(second.entries).toHaveLength(1);

        ledger.rollover('2026-06-01');
        expect(ledger.recordCalls(second.entries)).toBe(1);
        tracker.markLedgerEntriesRecorded(second.entries);
        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);
    });

    it('re-offers new calls made after a conversation is reverted below its ledger position', () => {
        const tracker = new GMTracker();
        const ledger = new DailyLedger('2026-06-02');
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const originalCalls = Array.from({ length: 5 }, (_, index) => makeCall({
            executionId: `original-${index}`,
            createdAt: localIso(2026, 6, 2, 0, index + 1),
        }));

        cache.set('conv-revert', {
            cascadeId: 'conv-revert',
            title: 'Reverted',
            totalSteps: 5,
            calls: originalCalls,
            lifetimeCalls: 5,
            coveredSteps: 5,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const initial = tracker.getNewCallsSinceLastRecord();
        expect(initial.entries).toHaveLength(5);
        expect(ledger.recordCalls(initial.entries)).toBe(5);
        tracker.markLedgerEntriesRecorded(initial.entries);

        cache.get('conv-revert')!.calls = originalCalls.slice(0, 3);
        const reverted = tracker.getNewCallsSinceLastRecord();
        expect(reverted.entries).toHaveLength(0);
        expect(reverted.revertedCascadeIds).toEqual(['conv-revert']);
        for (const cid of reverted.revertedCascadeIds) {
            ledger.clearRecordedIdsForConversation(cid);
        }

        cache.get('conv-revert')!.calls = [
            ...originalCalls.slice(0, 3),
            makeCall({ executionId: 'new-after-revert-3', createdAt: localIso(2026, 6, 2, 0, 10) }),
            makeCall({ executionId: 'new-after-revert-4', createdAt: localIso(2026, 6, 2, 0, 11) }),
        ];

        const afterRevert = tracker.getNewCallsSinceLastRecord();
        expect(afterRevert.entries.map(entry => entry.dedupKey)).toEqual([
            expect.stringMatching(/^conv-revert:3\|/),
            expect.stringMatching(/^conv-revert:4\|/),
        ]);
        expect(ledger.recordCalls(afterRevert.entries)).toBe(2);
        tracker.markLedgerEntriesRecorded(afterRevert.entries);
        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);
    });

    it('does not double-record unchanged calls that return after a revert cleared stale ledger ids', () => {
        const tracker = new GMTracker();
        const ledger = new DailyLedger('2026-06-02');
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const originalCalls = Array.from({ length: 5 }, (_, index) => makeCall({
            executionId: `unchanged-${index}`,
            createdAt: localIso(2026, 6, 2, 0, index + 1),
        }));

        cache.set('conv-unchanged-return', {
            cascadeId: 'conv-unchanged-return',
            title: 'Unchanged Return',
            totalSteps: 5,
            calls: originalCalls,
            lifetimeCalls: 5,
            coveredSteps: 5,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const initial = tracker.getNewCallsSinceLastRecord();
        expect(initial.entries).toHaveLength(5);
        expect(ledger.recordCalls(initial.entries)).toBe(5);
        tracker.markLedgerEntriesRecorded(initial.entries);

        cache.get('conv-unchanged-return')!.calls = originalCalls.slice(0, 3);
        const reverted = tracker.getNewCallsSinceLastRecord();
        expect(reverted.entries).toHaveLength(0);
        expect(reverted.revertedCascadeIds).toEqual(['conv-unchanged-return']);
        for (const cid of reverted.revertedCascadeIds) {
            ledger.clearRecordedIdsForConversation(cid);
        }

        cache.get('conv-unchanged-return')!.calls = originalCalls;
        const returned = tracker.getNewCallsSinceLastRecord();

        expect(returned.entries).toHaveLength(0);
        expect(ledger.recordCalls(returned.entries)).toBe(0);
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(5);
    });

    it('accepts changed calls after revert even if stale ledger ids were not cleared', () => {
        const tracker = new GMTracker();
        const ledger = new DailyLedger('2026-06-02');
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const originalCalls = Array.from({ length: 5 }, (_, index) => makeCall({
            executionId: `diverged-original-${index}`,
            createdAt: localIso(2026, 6, 2, 0, index + 1),
        }));

        cache.set('conv-diverged-no-clear', {
            cascadeId: 'conv-diverged-no-clear',
            title: 'Diverged No Clear',
            totalSteps: 5,
            calls: originalCalls,
            lifetimeCalls: 5,
            coveredSteps: 5,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const initial = tracker.getNewCallsSinceLastRecord();
        expect(initial.entries).toHaveLength(5);
        expect(ledger.recordCalls(initial.entries)).toBe(5);
        tracker.markLedgerEntriesRecorded(initial.entries);

        cache.get('conv-diverged-no-clear')!.calls = originalCalls.slice(0, 3);
        const reverted = tracker.getNewCallsSinceLastRecord();
        expect(reverted.entries).toHaveLength(0);
        expect(reverted.revertedCascadeIds).toEqual(['conv-diverged-no-clear']);

        cache.get('conv-diverged-no-clear')!.calls = [
            ...originalCalls.slice(0, 3),
            makeCall({ executionId: 'diverged-new-3', createdAt: localIso(2026, 6, 2, 0, 10) }),
            makeCall({ executionId: 'diverged-new-4', createdAt: localIso(2026, 6, 2, 0, 11) }),
        ];
        const diverged = tracker.getNewCallsSinceLastRecord();

        expect(diverged.entries).toHaveLength(2);
        expect(ledger.recordCalls(diverged.entries)).toBe(2);
        tracker.markLedgerEntriesRecorded(diverged.entries);
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(7);
        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);
    });

    it('keeps interleaved conversations independent when one reverts all the way to zero calls', () => {
        const tracker = new GMTracker();
        const ledger = new DailyLedger('2026-06-02');
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const convAOriginal = [
            makeCall({ executionId: 'conv-a-original-0', createdAt: localIso(2026, 6, 2, 0, 1) }),
            makeCall({ executionId: 'conv-a-original-1', createdAt: localIso(2026, 6, 2, 0, 2) }),
        ];
        const convBOriginal = [
            makeCall({ executionId: 'conv-b-original-0', createdAt: localIso(2026, 6, 2, 0, 3) }),
        ];

        cache.set('conv-a-full-revert', {
            cascadeId: 'conv-a-full-revert',
            title: 'A',
            totalSteps: 2,
            calls: convAOriginal,
            lifetimeCalls: 2,
            coveredSteps: 2,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });
        cache.set('conv-b-interleaved', {
            cascadeId: 'conv-b-interleaved',
            title: 'B',
            totalSteps: 1,
            calls: convBOriginal,
            lifetimeCalls: 1,
            coveredSteps: 1,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const initial = tracker.getNewCallsSinceLastRecord();
        expect(initial.entries).toHaveLength(3);
        expect(ledger.recordCalls(initial.entries)).toBe(3);
        tracker.markLedgerEntriesRecorded(initial.entries);

        cache.get('conv-a-full-revert')!.calls = [];
        const reverted = tracker.getNewCallsSinceLastRecord();
        expect(reverted.entries).toHaveLength(0);
        expect(reverted.revertedCascadeIds).toEqual(['conv-a-full-revert']);
        for (const cid of reverted.revertedCascadeIds) {
            ledger.clearRecordedIdsForConversation(cid);
        }

        cache.get('conv-a-full-revert')!.calls = [
            makeCall({ executionId: 'conv-a-new-0', createdAt: localIso(2026, 6, 2, 0, 10) }),
        ];
        cache.get('conv-b-interleaved')!.calls = [
            ...convBOriginal,
            makeCall({ executionId: 'conv-b-new-1', createdAt: localIso(2026, 6, 2, 0, 11) }),
        ];
        const afterRevert = tracker.getNewCallsSinceLastRecord();

        expect(afterRevert.entries.map(entry => entry.dedupKey)).toEqual([
            expect.stringMatching(/^conv-a-full-revert:0\|/),
            expect.stringMatching(/^conv-b-interleaved:1\|/),
        ]);
        expect(ledger.recordCalls(afterRevert.entries)).toBe(2);
        tracker.markLedgerEntriesRecorded(afterRevert.entries);
        expect(ledger.getAccountActive('user@example.com')?.totalCalls).toBe(5);
        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);
    });

    it('persists recorded call identities across tracker restore', () => {
        const tracker = new GMTracker();
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const originalCalls = Array.from({ length: 3 }, (_, index) => makeCall({
            executionId: `persisted-identity-${index}`,
            createdAt: localIso(2026, 6, 2, 0, index + 1),
        }));

        cache.set('conv-persist-identities', {
            cascadeId: 'conv-persist-identities',
            title: 'Persist Identities',
            totalSteps: 3,
            calls: originalCalls,
            lifetimeCalls: 3,
            coveredSteps: 3,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const initial = tracker.getNewCallsSinceLastRecord();
        tracker.markLedgerEntriesRecorded(initial.entries);

        const restored = GMTracker.restore(tracker.serialize());
        const restoredCache = (restored as any)._cache as Map<string, GMConversationData>;
        restoredCache.set('conv-persist-identities', {
            cascadeId: 'conv-persist-identities',
            title: 'Persist Identities',
            totalSteps: 3,
            calls: originalCalls.slice(0, 1),
            lifetimeCalls: 3,
            coveredSteps: 1,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        expect(restored.getNewCallsSinceLastRecord().revertedCascadeIds).toEqual(['conv-persist-identities']);

        restoredCache.get('conv-persist-identities')!.calls = originalCalls;
        expect(restored.getNewCallsSinceLastRecord().entries).toHaveLength(0);
    });

    it('backfills call identities for restored legacy ledger positions before a later revert', () => {
        const tracker = new GMTracker();
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const ledgerPositions = (tracker as any)._ledgerPositions as Map<string, number>;
        const originalCalls = Array.from({ length: 5 }, (_, index) => makeCall({
            executionId: `legacy-position-${index}`,
            createdAt: localIso(2026, 6, 2, 0, index + 1),
        }));

        cache.set('conv-legacy-position', {
            cascadeId: 'conv-legacy-position',
            title: 'Legacy Position',
            totalSteps: 5,
            calls: originalCalls,
            lifetimeCalls: 5,
            coveredSteps: 5,
            coverageRate: 1,
            checkpointSummaries: [],
            systemContextItems: [],
        });
        ledgerPositions.set('conv-legacy-position', 5);

        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);

        cache.get('conv-legacy-position')!.calls = originalCalls.slice(0, 3);
        expect(tracker.getNewCallsSinceLastRecord().revertedCascadeIds).toEqual(['conv-legacy-position']);

        cache.get('conv-legacy-position')!.calls = originalCalls;
        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0);
    });
});

describe('DailyLedger stale empty date normalization', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(localTime(2026, 6, 11, 12));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('records today calls after an empty in-memory ledger spans midnight', () => {
        vi.setSystemTime(localTime(2026, 6, 10, 23, 55));
        const ledger = new DailyLedger('2026-06-10');

        vi.setSystemTime(localTime(2026, 6, 11, 12));
        const added = ledger.recordCalls([
            { call: makeCall({ executionId: 'runtime-midnight', createdAt: localIso(2026, 6, 11, 12) }), dedupKey: 'conv-runtime:0' },
        ]);

        expect(added).toBe(1);
        expect(ledger.dateKey).toBe('2026-06-11');
        expect(ledger.getTodayTotals().totalCalls).toBe(1);
    });

    it('self-heals an already persisted empty wedge before recording new calls', () => {
        const ledger = new DailyLedger('2026-06-05');

        const added = ledger.recordCalls([
            { call: makeCall({ executionId: 'existing-wedge', createdAt: localIso(2026, 6, 11, 12) }), dedupKey: 'conv-wedge:0' },
        ]);

        expect(added).toBe(1);
        expect(ledger.dateKey).toBe('2026-06-11');
        expect(ledger.getTodayTotals().totalCalls).toBe(1);
    });

    it('keeps stale data-bearing ledgers blocked until archival runs', () => {
        vi.setSystemTime(localTime(2026, 6, 10, 12));
        const ledger = new DailyLedger('2026-06-10');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'yesterday-data', createdAt: localIso(2026, 6, 10, 12) }), dedupKey: 'conv-data:0' },
        ])).toBe(1);

        vi.setSystemTime(localTime(2026, 6, 11, 12));
        const added = ledger.recordCalls([
            { call: makeCall({ executionId: 'today-blocked', createdAt: localIso(2026, 6, 11, 12) }), dedupKey: 'conv-data:1' },
        ]);

        expect(added).toBe(0);
        expect(ledger.dateKey).toBe('2026-06-10');
        expect(ledger.getTodayTotals().totalCalls).toBe(1);
    });

    it('preserves settled-only stale ledgers on restore for startup archival', () => {
        vi.setSystemTime(localTime(2026, 6, 10, 12));
        const ledger = new DailyLedger('2026-06-10');
        expect(ledger.recordCalls([
            { call: makeCall({ executionId: 'settled-only', createdAt: localIso(2026, 6, 10, 12) }), dedupKey: 'conv-settled:0' },
        ])).toBe(1);
        const cutoff = localTime(2026, 6, 10, 13).getTime();
        const settled = ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com', cutoff);
        expect(settled?.totalCalls).toBe(1);
        expect(ledger.getTodayActive()).toHaveLength(0);

        vi.setSystemTime(localTime(2026, 6, 11, 12));
        const restored = DailyLedger.restore(ledger.serialize());

        expect(restored.dateKey).toBe('2026-06-10');
        expect(restored.hasData).toBe(true);
        expect(restored.getSettledEntries()).toHaveLength(1);
        expect(restored.getSettledEntries()[0].settledCutoffTime).toBe(cutoff);
        expect(restored.getSettledEntries()[0].totalCalls).toBe(1);
    });

    it('normalizes an empty future-dated ledger on restore', () => {
        const state: DailyLedgerState = {
            version: 1,
            dateKey: '2026-06-12',
            accounts: {},
            settled: [],
        };

        const restored = DailyLedger.restore(state);

        expect(restored.dateKey).toBe('2026-06-11');
        expect(restored.hasData).toBe(false);
    });

    it('normalizes an empty future-dated ledger before recording', () => {
        const ledger = new DailyLedger('2026-06-12');

        const added = ledger.recordCalls([
            { call: makeCall({ executionId: 'clock-rollback', createdAt: localIso(2026, 6, 11, 12) }), dedupKey: 'conv-future:0' },
        ]);

        expect(added).toBe(1);
        expect(ledger.dateKey).toBe('2026-06-11');
    });

    it('keeps hasData aligned with non-trivial serialized ledger fields', () => {
        const empty = new DailyLedger('2026-06-11');
        // New serialized data fields must be added to hasData or explicitly exempted here.
        expect(Object.keys(empty.serialize()).sort()).toEqual(['accounts', 'dateKey', 'settled', 'version']);
        expect(empty.hasData).toBe(false);

        const active = new DailyLedger('2026-06-11');
        expect(active.recordCalls([
            { call: makeCall({ executionId: 'active-contract', createdAt: localIso(2026, 6, 11, 12) }), dedupKey: 'conv-active-contract:0' },
        ])).toBe(1);
        expect(active.serialize().accounts['user@example.com'].totalCalls).toBeGreaterThan(0);
        expect(active.hasData).toBe(true);

        const settledOnly = new DailyLedger('2026-06-11');
        expect(settledOnly.recordCalls([
            { call: makeCall({ executionId: 'settled-contract', createdAt: localIso(2026, 6, 11, 12) }), dedupKey: 'conv-settled-contract:0' },
        ])).toBe(1);
        settledOnly.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com');
        expect(settledOnly.serialize().settled).toHaveLength(1);
        expect(settledOnly.hasData).toBe(true);
    });
});

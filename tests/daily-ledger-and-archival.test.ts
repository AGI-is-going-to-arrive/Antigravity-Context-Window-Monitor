// Consolidated Domain Suite: Daily Ledger, Archival, Cost Reconciliation & Multi-Account
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { buildGMSummaryFromLedger, type DailyArchivalContext, performDailyArchival } from '../src/daily-archival';
import {
    DailyLedger,
    type DailyLedgerState,
    type LedgerAccountBucket,
    type LedgerCallEntry,
    type LedgerDayData,
    toLocalDateKey,
} from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import type { ActivitySummary } from '../src/activity-tracker';
import { type GMCallEntry, type GMConversationData, type GMSummary, GMTracker } from '../src/gm-tracker';
import { parseGMEntry } from '../src/gm/parser';
import { calculateLedgerModelCosts } from '../src/pricing-store';

describe('[daily-archival-time]', () => {
    function makeActivitySummary(): ActivitySummary {
        return {
            totalUserInputs: 0,
            totalReasoning: 0,
            totalToolCalls: 0,
            totalErrors: 0,
            totalCheckpoints: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalToolReturnTokens: 0,
            estSteps: 0,
            modelStats: {},
            globalToolStats: {},
            recentSteps: [],
            sessionStartTime: '2026-06-01T00:00:00.000Z',
            subAgentTokens: [],
            checkpointHistory: [],
            conversationBreakdown: [],
        };
    }


    function localTime(y: number, month: number, d: number, h = 0, m = 0, s = 0, ms = 0): Date {
        return new Date(y, month - 1, d, h, m, s, ms);
    }


    function localIso(y: number, month: number, d: number, h = 0, m = 0, s = 0, ms = 0): string {
        return localTime(y, month, d, h, m, s, ms).toISOString();
    }


    function makeCall(createdAt: string, executionId: string, model = 'MODEL_PLACEHOLDER_M26'): GMCallEntry {
        const modelDisplay = model === 'MODEL_PLACEHOLDER_M16'
            ? 'Gemini 3.1 Pro (High)'
            : 'Claude Opus 4.6 (Thinking)';
        const responseModel = model === 'MODEL_PLACEHOLDER_M16'
            ? 'gemini-3.1-pro-high'
            : 'claude-opus-4-6-thinking';
        return {
            stepIndices: [1],
            executionId,
            model,
            modelDisplay,
            responseModel,
            modelAccuracy: 'exact',
            inputTokens: 100,
            outputTokens: 50,
            thinkingTokens: 10,
            responseTokens: 40,
            cacheReadTokens: 5,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 1.2,
            streamingSeconds: 2.3,
            credits: 3,
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
            createdAt,
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 160000,
            accountEmail: 'user@example.com',
        };
    }


    function makeEmptySummary(): GMSummary {
        return {
            conversations: [],
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
            uniqueErrors: [],
            recentErrorEntries: [],
            toolCatalog: [],
        };
    }


    function buildContext(overrides: Partial<DailyArchivalContext> = {}): {
        ctx: DailyArchivalContext;
        dailyStore: DailyStore;
        persisted: Array<{ lastArchivalDateKey: string; lastGMSummary: GMSummary | null; modelDNAChanged: boolean }>;
        resetFlags: { activity: boolean; gm: boolean };
    } {
        const dailyStore = new DailyStore();
        const persisted: Array<{ lastArchivalDateKey: string; lastGMSummary: GMSummary | null; modelDNAChanged: boolean }> = [];
        const resetFlags = { activity: false, gm: false };
        const activitySummary = makeActivitySummary();

        const ctx: DailyArchivalContext = {
            activityTracker: {
                getSummary: () => activitySummary,
                archiveAndReset: () => {
                    resetFlags.activity = true;
                    return null;
                },
            } as any,
            gmTracker: {
                reset: () => {
                    resetFlags.gm = true;
                },
                getDetailedSummary: () => null,
                getCachedSummary: () => null,
                getArchivalSummary: () => null,
            } as any,
            dailyStore,
            pricingStore: null,
            lastGMSummary: null,
            persistedModelDNA: {},
            lastArchivalDateKey: '',
            dailyLedger: null,
            persist: (updates) => {
                persisted.push({
                    lastArchivalDateKey: updates.lastArchivalDateKey,
                    lastGMSummary: updates.lastGMSummary,
                    modelDNAChanged: updates.modelDNAChanged,
                });
            },
            log: () => {},
            ...overrides,
        };

        return { ctx, dailyStore, persisted, resetFlags };
    }


    describe('daily archival time simulation', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('does not archive again before the local date changes', () => {
            vi.setSystemTime(localTime(2026, 6, 1, 23, 55));
            const { ctx, dailyStore, persisted, resetFlags } = buildContext({
                lastArchivalDateKey: '2026-06-01',
            });

            const result = performDailyArchival(ctx, false, localTime(2026, 6, 1, 23, 55));

            expect(result.archived).toBe(false);
            expect(result.sameDay).toBe(true);
            expect(persisted).toHaveLength(0);
            expect(resetFlags.activity).toBe(false);
            expect(resetFlags.gm).toBe(false);
            expect(dailyStore.getDatesWithData()).toEqual([]);
        });

        it('archives both active and settled ledger data when the clock crosses midnight', () => {
            vi.setSystemTime(localTime(2026, 6, 1, 23, 58));
            const ledger = new DailyLedger('2026-06-01');

            const activeAdded = ledger.recordCalls([
                { call: makeCall(localIso(2026, 6, 1, 10), 'active-1'), dedupKey: 'conv-a:0' },
            ]);
            const settledSourceAdded = ledger.recordCalls([
                { call: makeCall(localIso(2026, 6, 1, 11), 'settled-1', 'MODEL_PLACEHOLDER_M16'), dedupKey: 'conv-b:0' },
            ]);
            const settled = ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com');

            expect(activeAdded).toBe(1);
            expect(settledSourceAdded).toBe(1);
            expect(settled?.totalCalls).toBe(1);

            vi.setSystemTime(localTime(2026, 6, 2, 0, 5));
            const { ctx, dailyStore, persisted, resetFlags } = buildContext({
                lastArchivalDateKey: '2026-06-01',
                dailyLedger: ledger,
            });

            const result = performDailyArchival(ctx, false, localTime(2026, 6, 2, 0, 5));

            expect(result.archived).toBe(true);
            expect(result.archiveDateKey).toBe('2026-06-01');
            expect(resetFlags.activity).toBe(true);
            expect(resetFlags.gm).toBe(true);

            const record = dailyStore.getRecord('2026-06-01');
            expect(record).not.toBeNull();
            expect(record?.cycles).toHaveLength(1);
            expect(record?.cycles[0].gmTotalCalls).toBe(2);
            expect(record?.cycles[0].gmTotalCredits).toBe(6);
            expect(record?.cycles[0].gmTotalTokens).toBe(300);

            expect(ledger.dateKey).toBe('2026-06-02');
            expect(ledger.getTodayTotals().totalCalls).toBe(0);
            expect(ledger.getSettledEntries()).toHaveLength(0);

            expect(persisted).toHaveLength(1);
            expect(persisted[0].lastArchivalDateKey).toBe('2026-06-02');
        });

        it('treats a stale startup ledger as the previous day and rolls it into the calendar immediately', () => {
            vi.setSystemTime(localTime(2026, 6, 1, 21, 35));
            const ledger = new DailyLedger('2026-06-01');
            const added = ledger.recordCalls([
                { call: makeCall(localIso(2026, 6, 1, 21, 30), 'startup-stale-1'), dedupKey: 'conv-startup:0' },
            ]);
            expect(added).toBe(1);

            vi.setSystemTime(localTime(2026, 6, 2, 8));

            const { ctx, dailyStore, persisted } = buildContext({
                lastArchivalDateKey: '2026-06-01',
                dailyLedger: ledger,
            });

            const result = performDailyArchival(ctx, false, localTime(2026, 6, 2, 8));

            expect(result.archived).toBe(true);
            expect(result.archiveDateKey).toBe('2026-06-01');
            expect(dailyStore.getRecord('2026-06-01')?.cycles[0].gmTotalCalls).toBe(1);
            expect(ledger.dateKey).toBe('2026-06-02');
            expect(persisted[0].lastArchivalDateKey).toBe('2026-06-02');
        });

        it('still supports the legacy GM-only fallback when the daily ledger is empty', () => {
            vi.setSystemTime(localTime(2026, 6, 2, 0, 10));
            const lastGMSummary = {
                ...makeEmptySummary(),
                totalCalls: 3,
                totalCredits: 9,
                totalInputTokens: 300,
                totalOutputTokens: 150,
                modelBreakdown: {
                    'Claude Opus 4.6 (Thinking)': {
                        callCount: 3,
                        stepsCovered: 0,
                        totalInputTokens: 300,
                        totalOutputTokens: 150,
                        totalThinkingTokens: 30,
                        totalCacheRead: 15,
                        totalCacheCreation: 0,
                        totalCredits: 9,
                        avgTTFT: 1.2,
                        minTTFT: 1.2,
                        maxTTFT: 1.2,
                        avgStreaming: 2.3,
                        cacheHitRate: 1,
                        responseModel: 'claude-opus-4-6-thinking',
                        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
                        completionConfig: null as any,
                        hasSystemPrompt: false,
                        toolCount: 0,
                        promptSectionTitles: [],
                        totalRetries: 0,
                        errorCount: 0,
                        creditCallCount: 3,
                        exactCallCount: 3,
                        placeholderOnlyCalls: 0,
                        contextWindowCapacity: 160000,
                    },
                },
            } satisfies GMSummary;

            const { ctx, dailyStore } = buildContext({
                lastArchivalDateKey: '2026-06-01',
                lastGMSummary,
                gmTracker: {
                    reset: () => {},
                    getDetailedSummary: () => null,
                    getCachedSummary: () => null,
                    getArchivalSummary: () => makeEmptySummary(),
                } as any,
            });

            const result = performDailyArchival(ctx, false, localTime(2026, 6, 2, 0, 10));

            expect(result.archived).toBe(true);
            expect(dailyStore.getRecord('2026-06-01')?.cycles[0].gmTotalCalls).toBe(3);
            expect(dailyStore.getRecord('2026-06-01')?.cycles[0].gmTotalCredits).toBe(9);
        });

        it('normalizes a stale empty daily ledger when archival runs without data', () => {
            vi.setSystemTime(localTime(2026, 6, 2, 0, 10));
            const ledger = new DailyLedger('2026-06-01');
            const logs: string[] = [];
            const { ctx, dailyStore, persisted } = buildContext({
                lastArchivalDateKey: '2026-06-01',
                dailyLedger: ledger,
                log: (msg) => logs.push(msg),
            });

            const result = performDailyArchival(ctx, false, localTime(2026, 6, 2, 0, 10));

            expect(result.archived).toBe(false);
            expect(ledger.dateKey).toBe('2026-06-02');
            expect(dailyStore.getDatesWithData()).toEqual([]);
            expect(persisted[0].lastArchivalDateKey).toBe('2026-06-02');
            expect(logs).toContain('DailyLedger normalized empty ledger date 2026-06-01 → 2026-06-02');
        });
    });
});

describe('[daily-ledger-date-filter]', () => {
    function makeCall(createdAt: string): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: `exec-${createdAt}`,
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            responseModel: 'claude-opus-4-6-thinking',
            modelAccuracy: 'exact',
            inputTokens: 100,
            outputTokens: 50,
            thinkingTokens: 10,
            responseTokens: 40,
            cacheReadTokens: 5,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 1.2,
            streamingSeconds: 2.3,
            credits: 3,
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
            createdAt,
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 160000,
            accountEmail: 'user@example.com',
        };
    }


    describe('DailyLedger date filtering', () => {
        it('rejects calls that belong to the next local day', () => {
            const ledger = new DailyLedger(toLocalDateKey(new Date()));
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(12, 0, 0, 0);

            const entries: LedgerCallEntry[] = [{
                call: makeCall(tomorrow.toISOString()),
                dedupKey: 'conv-1:0',
            }];

            const added = ledger.recordCalls(entries);

            expect(added).toBe(0);
            expect(ledger.getTodayTotals().totalCalls).toBe(0);
        });

        it('normalizes a restored stale empty ledger so new calls can be recorded today', () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const restored = DailyLedger.restore(new DailyLedger(toLocalDateKey(yesterday)).serialize());

            const now = new Date();
            now.setHours(12, 0, 0, 0);
            const added = restored.recordCalls([{
                call: makeCall(now.toISOString()),
                dedupKey: 'conv-1:0',
            }]);

            expect(added).toBe(1);
            expect(restored.dateKey).toBe(toLocalDateKey(now));
            expect(restored.getTodayTotals().totalCalls).toBe(1);
        });
    });
});

describe('[daily-ledger-regressions]', () => {
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
                expect.stringMatching(/^conv-revert\|/),
                expect.stringMatching(/^conv-revert\|/),
            ]);
            expect(afterRevert.entries.map(entry => entry.callIndex)).toEqual([3, 4]);
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
                expect.stringMatching(/^conv-a-full-revert\|/),
                expect.stringMatching(/^conv-b-interleaved\|/),
            ]);
            expect(afterRevert.entries.map(entry => entry.callIndex)).toEqual([0, 1]);
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


    describe('DailyLedger -> DailyArchival -> DailyStore telemetry persistence and v1 backward compatibility (#66 #4)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(localTime(2026, 6, 1, 14));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('preserves TTFT, streaming, speed, and cache tokens across active + settled ledger rollover into DailyStore', () => {
            const ledger = new DailyLedger('2026-06-01');
            const cutoffMs = localTime(2026, 6, 1, 12).getTime();

            // Call 1 (pre-reset, will be settled): TTFT=1.0s, stream=2.0s, out=100, cacheRead=900, input=100
            // Call 2 (post-reset, remains active): TTFT=3.0s, stream=4.0s, out=200, cacheRead=0, cacheCreation=500, input=500
            // Call 3 (post-reset, zero timing): TTFT=0, stream=0, out=50, cacheRead=400, input=100
            const c1: GMCallEntry = {
                ...makeCall({
                    executionId: 't-settled',
                    createdAt: localIso(2026, 6, 1, 11),
                    inputTokens: 100,
                    outputTokens: 100,
                    cacheReadTokens: 900,
                    cacheCreationTokens: 0,
                }),
                ttftSeconds: 1.0,
                streamingSeconds: 2.0,
            };
            const c2: GMCallEntry = {
                ...makeCall({
                    executionId: 't-active-timed',
                    createdAt: localIso(2026, 6, 1, 13),
                    inputTokens: 500,
                    outputTokens: 200,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 500,
                }),
                ttftSeconds: 3.0,
                streamingSeconds: 4.0,
            };
            const c3: GMCallEntry = {
                ...makeCall({
                    executionId: 't-active-untimed',
                    createdAt: localIso(2026, 6, 1, 13, 30),
                    inputTokens: 100,
                    outputTokens: 50,
                    cacheReadTokens: 400,
                    cacheCreationTokens: 0,
                }),
                ttftSeconds: 0,
                streamingSeconds: 0,
            };

            expect(ledger.recordCalls([
                { call: c1, dedupKey: 'conv:0' },
                { call: c2, dedupKey: 'conv:1' },
                { call: c3, dedupKey: 'conv:2' },
            ])).toBe(3);

            // Settle c1 at noon cutoff; c2 & c3 stay active with exact remaining telemetry
            const settled = ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'user@example.com', cutoffMs);
            expect(settled?.totalCalls).toBe(1);
            expect(settled?.modelTelemetry?.['Gemini 3.1 Pro (High)']).toMatchObject({
                ttftSum: 1.0,
                ttftCount: 1,
                streamingSum: 2.0,
                streamingCount: 1,
                timedOutputTokens: 100,
                timedStreamingSeconds: 2.0,
                cacheHitCalls: 1,
            });

            const activeMs = ledger.getAccountActive('user@example.com')!.modelStats['Gemini 3.1 Pro (High)'];
            expect(activeMs.ttftSum).toBeCloseTo(3.0, 10);
            expect(activeMs.ttftCount).toBe(1);
            expect(activeMs.minTTFT).toBeCloseTo(3.0, 10);
            expect(activeMs.maxTTFT).toBeCloseTo(3.0, 10);
            expect(activeMs.streamingSum).toBeCloseTo(4.0, 10);
            expect(activeMs.streamingCount).toBe(1);
            expect(activeMs.timedOutputTokens).toBe(200);
            expect(activeMs.timedStreamingSeconds).toBeCloseTo(4.0, 10);
            expect(activeMs.cacheHitCalls).toBe(1);

            // Midnight rollover -> buildGMSummaryFromLedger -> DailyStore
            const dayData = ledger.rollover('2026-06-01');
            const { summary, totalCost, costPerModel } = buildGMSummaryFromLedger(dayData);
            const gms = summary.modelBreakdown['Gemini 3.1 Pro (High)'];

            // Combined across active + settled (c3 untimed does NOT dilute avgTTFT or avgStreaming!)
            expect(gms.callCount).toBe(3);
            expect(gms.avgTTFT).toBeCloseTo((1.0 + 3.0) / 2, 10);
            expect(gms.minTTFT).toBeCloseTo(1.0, 10);
            expect(gms.maxTTFT).toBeCloseTo(3.0, 10);
            expect(gms.ttftSampleCount).toBe(2);
            expect(gms.avgStreaming).toBeCloseTo((2.0 + 4.0) / 2, 10);
            expect(gms.streamingSampleCount).toBe(2);
            expect(gms.timedOutputTokens).toBe(300);
            expect(gms.timedStreamingSeconds).toBeCloseTo(6.0, 10);
            expect(gms.cacheHitCalls).toBe(2);
            expect(gms.cacheHitRate).toBeCloseTo(2 / 3, 10);

            const store = new DailyStore();
            store.addDailySnapshot('2026-06-01', {
                totalUserInputs: 0, totalReasoning: 3, totalToolCalls: 0, totalErrors: 0, totalCheckpoints: 0,
                totalInputTokens: 0, totalOutputTokens: 0, totalToolReturnTokens: 0, estSteps: 0,
                modelStats: {}, globalToolStats: {}, recentSteps: [], sessionStartTime: '2026-06-01T00:00:00Z',
                subAgentTokens: [], checkpointHistory: [], conversationBreakdown: [],
            }, summary, totalCost, costPerModel);

            const storedModel = store.getRecord('2026-06-01')!.cycles[0].gmModelStats!['Gemini 3.1 Pro (High)'];
            expect(storedModel.avgTTFT).toBeCloseTo(2.0, 10);
            expect(storedModel.avgStreaming).toBeCloseTo(3.0, 10);
            expect(storedModel.avgGenTokPerSec).toBeCloseTo(300 / 6.0, 10);
            expect(storedModel.cacheReadTokens).toBe(1300);
            expect(storedModel.cacheCreationTokens).toBe(500);
            // Token-weighted cache hit: 1300 / (700 input + 1300 cacheRead + 500 cacheCreation) = 1300 / 2500 = 0.52
            expect(storedModel.tokenCacheHitRate).toBeCloseTo(1300 / 2500, 10);
            expect(storedModel.cacheHitRate).toBeCloseTo(2 / 3, 10);
        });

        it('restores legacy v1 DailyLedgerState and DailyStoreState JSON without optional telemetry fields cleanly', () => {
            const legacyLedgerJson: DailyLedgerState = {
                version: 1,
                dateKey: '2026-06-01',
                accounts: {
                    'legacy@example.com': {
                        accountEmail: 'legacy@example.com',
                        totalCalls: 2,
                        totalInputTokens: 2000,
                        totalOutputTokens: 500,
                        totalThinkingTokens: 100,
                        totalCacheRead: 4000,
                        totalCacheCreation: 0,
                        totalCredits: 2,
                        totalEstimatedCost: 0.01,
                        modelStats: {
                            'Claude Opus 4.6 (Thinking)': {
                                calls: 2,
                                inputTokens: 2000,
                                outputTokens: 500,
                                thinkingTokens: 100,
                                cacheReadTokens: 4000,
                                cacheCreationTokens: 0,
                                credits: 2,
                                estimatedCost: 0.01,
                            },
                        },
                        recordedCallIds: ['legacy:0', 'legacy:1'],
                        recordedCalls: [{
                            callId: 'legacy:0',
                            createdAt: localIso(2026, 6, 1, 9),
                            createdAtMs: localTime(2026, 6, 1, 9).getTime(),
                            modelId: 'MODEL_PLACEHOLDER_M26',
                            modelKey: 'Claude Opus 4.6 (Thinking)',
                            inputTokens: 1000,
                            outputTokens: 250,
                            thinkingTokens: 50,
                            cacheReadTokens: 2000,
                            cacheCreationTokens: 0,
                            credits: 1,
                            estimatedCost: 0.005,
                        }],
                    },
                },
                settled: [{
                    settledAt: localIso(2026, 6, 1, 8),
                    accountEmail: 'legacy@example.com',
                    poolModelIds: ['MODEL_PLACEHOLDER_M16'],
                    poolModelLabels: ['Gemini 3.1 Pro (High)'],
                    totalCalls: 1,
                    totalInputTokens: 500,
                    totalOutputTokens: 100,
                    totalThinkingTokens: 0,
                    totalCacheRead: 0,
                    totalCacheCreation: 0,
                    totalCredits: 1,
                    totalEstimatedCost: 0.002,
                    modelCalls: { 'Gemini 3.1 Pro (High)': 1 },
                }],
            };

            const restoredLedger = DailyLedger.restore(legacyLedgerJson);
            expect(restoredLedger.serialize().version).toBe(1);
            const dayData = restoredLedger.rollover('2026-06-01');
            const { summary } = buildGMSummaryFromLedger(dayData);
            const claude = summary.modelBreakdown['Claude Opus 4.6 (Thinking)'];
            expect(claude.callCount).toBe(2);
            expect(claude.avgTTFT).toBe(0);
            expect(claude.avgStreaming).toBe(0);
            expect(claude.ttftSampleCount).toBe(0);
            expect(claude.streamingSampleCount).toBe(0);
            expect(claude.cacheHitRate).toBe(0);
            expect(claude.totalCacheRead).toBe(4000);

            // Legacy v1 DailyStoreState without new optional fields restores cleanly
            const legacyStoreState: DailyStoreState = {
                version: 1,
                records: {
                    '2026-05-30': {
                        date: '2026-05-30',
                        cycles: [{
                            startTime: '2026-05-30T00:00:00',
                            endTime: '2026-05-30T23:59:59',
                            totalReasoning: 2,
                            totalToolCalls: 1,
                            totalErrors: 0,
                            totalInputTokens: 1000,
                            totalOutputTokens: 200,
                            estSteps: 0,
                            modelNames: ['Claude Opus 4.6 (Thinking)'],
                            gmModelStats: {
                                'Claude Opus 4.6 (Thinking)': {
                                    calls: 2,
                                    credits: 2,
                                    inputTokens: 1000,
                                    outputTokens: 200,
                                    thinkingTokens: 0,
                                    avgTTFT: 1.5,
                                    cacheHitRate: 0.5,
                                },
                            },
                        }],
                    },
                },
            };
            const store = new DailyStore();
            store.restoreSnapshot(legacyStoreState);
            const restoredRow = store.getRecord('2026-05-30')!.cycles[0].gmModelStats!['Claude Opus 4.6 (Thinking)'];
            expect(restoredRow.avgTTFT).toBe(1.5);
            expect(restoredRow.cacheReadTokens).toBeUndefined();
            expect(restoredRow.avgGenTokPerSec).toBeUndefined();
            expect(store.serialize().version).toBe(1);
        });

        it('uses preserved cacheReadTokens when DailyStore.backfillMissingCosts prices a newly archived row', () => {
            const state: DailyStoreState = {
                version: 1,
                records: {
                    '2026-06-01': {
                        date: '2026-06-01',
                        cycles: [{
                            startTime: '2026-06-01T00:00:00',
                            endTime: '2026-06-01T23:59:59',
                            totalReasoning: 1,
                            totalToolCalls: 0,
                            totalErrors: 0,
                            totalInputTokens: 0,
                            totalOutputTokens: 0,
                            estSteps: 0,
                            modelNames: ['Claude Opus 4.6 (Thinking)'],
                            gmModelStats: {
                                'Claude Opus 4.6 (Thinking)': {
                                    calls: 1,
                                    credits: 0,
                                    inputTokens: 1_000_000,    // $5.00
                                    outputTokens: 0,
                                    thinkingTokens: 0,
                                    cacheReadTokens: 2_000_000, // $1.00 ($0.50/1M)
                                    avgTTFT: 1.0,
                                    cacheHitRate: 1,
                                },
                            },
                        }],
                    },
                },
            };
            const store = new DailyStore();
            store.restoreSnapshot(state);
            expect(store.backfillMissingCosts({})).toBe(1);
            const filled = store.getRecord('2026-06-01')!.cycles[0].gmModelStats!['Claude Opus 4.6 (Thinking)'];
            expect(filled.estimatedCost).toBeCloseTo(6.0, 10);
        });
    });
});

describe('[ledger-cost-reconciliation]', () => {
    const account = 'pricing@example.test';

    const localIso = (hour: number) => new Date(2026, 9, 31, hour).toISOString();


    function entry(id: string, model: string, inputTokens: number, outputTokens: number, index: number): LedgerCallEntry {
        return { dedupKey: `fixture:${index}|${encodeURIComponent(`exec:${id}`)}`,
            call: { ...parseGMEntry({ executionId: id, stepIndices: [index], chatModel: {
                model, responseModel: 'gemini-4-argon', usage: { inputTokens, outputTokens },
                chatStartMetadata: { createdAt: localIso(9) },
            } }), accountEmail: account } };
    }


    /** A version that had no Argon price saved the first three calls at zero. */
    function legacyMixedState(): { state: DailyLedgerState; entries: LedgerCallEntry[] } {
        const entries = [
            entry('old-low', 'MODEL_PLACEHOLDER_M419', 12905, 5, 0),
            entry('old-medium', 'MODEL_PLACEHOLDER_M418', 12903, 31, 1),
            entry('old-high', 'MODEL_PLACEHOLDER_M417', 12905, 32, 2),
            entry('new-low', 'MODEL_PLACEHOLDER_M419', 12952, 87, 3),
        ];
        const ledger = new DailyLedger();
        expect(ledger.recordCalls(entries)).toBe(4);
        const state = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
        const bucket = state.accounts[account];
        for (const record of bucket.recordedCalls.slice(0, 3)) {
            bucket.totalEstimatedCost -= record.estimatedCost;
            bucket.modelStats[record.modelKey].estimatedCost -= record.estimatedCost;
            record.estimatedCost = 0;
            record.createdAt = '';
            record.createdAtMs = Date.parse(localIso(10)); // ingestion time is not usage evidence
        }
        return { state, entries };
    }


    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 31, 10)); });

    afterEach(() => vi.useRealTimers());


    describe('existing ledger call metadata and missing official cost reconciliation', () => {
        it('fills the exact old 3-call cost gap in a mixed positive/zero bucket without adding calls or tokens', () => {
            const { state, entries } = legacyMixedState();
            const ledger = DailyLedger.restore(state);
            const before = ledger.serialize().accounts[account];
            const previousTotal = before.totalEstimatedCost;
            const beforeTokens = [before.totalCalls, before.totalInputTokens, before.totalOutputTokens, before.totalCacheRead];
            const oldIds = [...before.recordedCallIds];
            const positiveCost = before.recordedCalls[3].estimatedCost;
            expect(ledger.reconcileRecordedCalls(entries)).toBe(3);
            const after = ledger.serialize().accounts[account];
            expect(after.totalEstimatedCost - previousTotal).toBeCloseTo(0.078106, 10);
            expect([after.totalCalls, after.totalInputTokens, after.totalOutputTokens, after.totalCacheRead]).toEqual(beforeTokens);
            expect(after.recordedCallIds).toEqual(oldIds);
            expect(after.recordedCalls[3].estimatedCost).toBe(positiveCost);
            expect(after.recordedCalls.slice(0, 3).every(call => call.createdAt === localIso(9))).toBe(true);
            const displayed = Object.entries(after.modelStats).reduce((sum, [key, stats]) =>
                sum + calculateLedgerModelCosts(key, stats, after, {}).totalCost, 0);
            expect(displayed).toBeCloseTo(after.totalEstimatedCost, 10);
            expect(ledger.reconcileRecordedCalls(entries)).toBe(0);
            expect(ledger.recordCalls(entries)).toBe(0);
            expect(ledger.serialize().accounts[account].totalCalls).toBe(4);
        });

        it('is idempotent after serialization and preserves already-positive historical cost', () => {
            const { state, entries } = legacyMixedState();
            const ledger = DailyLedger.restore(state);
            ledger.reconcileRecordedCalls(entries);
            const saved = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
            const restored = DailyLedger.restore(saved);
            expect(restored.reconcileRecordedCalls(entries)).toBe(0);
            expect(restored.serialize()).toEqual(saved);
        });

        it.each(['account', 'model', 'tokens', 'invalid-date', 'other-day'])(
            'rejects mismatched or unproven %s metadata', kind => {
                const { state, entries } = legacyMixedState();
                const ledger = DailyLedger.restore(state);
                const candidate = { ...entries[0], call: { ...entries[0].call } };
                if (kind === 'account') { candidate.call.accountEmail = 'other@example.test'; }
                if (kind === 'model') { candidate.call.model = 'MODEL_PLACEHOLDER_M418'; }
                if (kind === 'tokens') { candidate.call.inputTokens++; }
                if (kind === 'invalid-date') { candidate.call.createdAt = 'invalid'; }
                if (kind === 'other-day') { candidate.call.createdAt = new Date(2026, 9, 30, 9).toISOString(); }
                const before = JSON.stringify(ledger.serialize());
                expect(ledger.reconcileRecordedCalls([candidate])).toBe(0);
                expect(JSON.stringify(ledger.serialize())).toBe(before);
            },
        );

        it('does not add a cost already present in an unexplained historical aggregate', () => {
            const { state, entries } = legacyMixedState();
            const bucket = state.accounts[account];
            const key = bucket.recordedCalls[0].modelKey;
            bucket.modelStats[key].estimatedCost += 1;
            bucket.totalEstimatedCost += 1;
            const ledger = DailyLedger.restore(state);
            const before = bucket.totalEstimatedCost;
            expect(ledger.reconcileRecordedCalls([entries[0]])).toBe(1); // timestamp only
            const after = ledger.serialize().accounts[account];
            expect(after.totalEstimatedCost).toBe(before);
            expect(after.recordedCalls[0].estimatedCost).toBe(0);
            expect(ledger.reconcileRecordedCalls([entries[0]])).toBe(0);
        });

        it('matches a stable execution identity after the tracker changes its array position', () => {
            const { state, entries } = legacyMixedState();
            const ledger = DailyLedger.restore(state);
            const moved = { ...entries[0], dedupKey: `fixture:9|${encodeURIComponent('exec:old-low')}` };
            expect(ledger.reconcileRecordedCalls([moved])).toBe(1);
            expect(ledger.serialize().accounts[account].totalCalls).toBe(4);
            expect(ledger.serialize().accounts[account].recordedCalls[0].estimatedCost).toBeCloseTo(0.02586, 10);
        });

        it('can enrich a timestamp-only archive identity change without touching another conversation', () => {
            const { state, entries } = legacyMixedState();
            const identity = (date: string) => `archive|steps:0|model:gemini-4-argon|created:${date}|in:12905|out:5|think:0|cache:0|start:0`;
            const oldKey = `fixture:0|${encodeURIComponent(identity(''))}`;
            state.accounts[account].recordedCalls[0].callId = oldKey;
            state.accounts[account].recordedCallIds[0] = oldKey;
            const ledger = DailyLedger.restore(state);
            const candidate = { call: { ...entries[0].call, executionId: '' },
                dedupKey: `fixture:0|${encodeURIComponent(identity(localIso(9)))}` };
            expect(ledger.reconcileRecordedCalls([{ ...candidate, dedupKey: candidate.dedupKey.replace('fixture:', 'unrelated:') }])).toBe(0);
            expect(ledger.reconcileRecordedCalls([candidate])).toBe(1);
            expect(ledger.serialize().accounts[account].recordedCalls[0].estimatedCost).toBeCloseTo(0.02586, 10);
        });

        it('reconciles legacy zero-cost Gemini 4 Neon calls using the newly verified official rate without adding calls', () => {
            const neonCall: LedgerCallEntry = {
                dedupKey: `neon:0|${encodeURIComponent('exec:neon-1')}`,
                call: {
                    ...parseGMEntry({
                        executionId: 'neon-1',
                        stepIndices: [1],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M535',
                            responseModel: 'gemini-4-neon',
                            usage: {
                                inputTokens: 1_000_000,
                                outputTokens: 200_000,
                                thinkingOutputTokens: 50_000,
                                cacheReadTokens: 1_000_000,
                            },
                            chatStartMetadata: { createdAt: localIso(9) },
                        },
                    }),
                    accountEmail: account,
                },
            };
            const ledger = new DailyLedger();
            expect(ledger.recordCalls([neonCall])).toBe(1);
            const saved = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
            const bucket = saved.accounts[account];
            const expectedCost = bucket.recordedCalls[0].estimatedCost;
            // 1M * $3 + 0.15M * $15 + 0.05M * $15 + 1M * $0.15 = $6.15
            expect(expectedCost).toBeCloseTo(6.15, 10);

            // Simulate legacy state written when Neon was unpriced
            bucket.totalEstimatedCost = 0;
            for (const stats of Object.values(bucket.modelStats)) {
                stats.estimatedCost = 0;
            }
            bucket.recordedCalls[0].estimatedCost = 0;

            const restored = DailyLedger.restore(saved);
            expect(restored.reconcileRecordedCalls([neonCall])).toBe(1);
            const after = restored.serialize().accounts[account];
            expect(after.totalCalls).toBe(1);
            expect(after.totalEstimatedCost).toBeCloseTo(6.15, 10);
            expect(after.recordedCalls[0].estimatedCost).toBeCloseTo(6.15, 10);
            expect(restored.reconcileRecordedCalls([neonCall])).toBe(0);
        });
    });
});

describe('[multi-account-archival]', () => {
    /** Helper: build a minimal GMCallEntry with all required fields */
    function makeCall(overrides: Partial<GMCallEntry> & { model: string; accountEmail: string }): GMCallEntry {
        return {
            model: overrides.model,
            modelDisplay: overrides.modelDisplay || overrides.model,
            responseModel: overrides.responseModel || '',
            modelAccuracy: '' as any,
            inputTokens: overrides.inputTokens ?? 1000,
            outputTokens: overrides.outputTokens ?? 500,
            responseTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            thinkingTokens: 0,
            credits: overrides.credits ?? 0,
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
            promptSource: '' as any,
            messagePromptCount: 0,
            messageMetadataKeys: [],
            responseHeaderKeys: [],
            userMessageAnchors: [],
            aiSnippetsByStep: {},
            retries: 0,
            stopReason: 'end_turn',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: overrides.createdAt || new Date().toISOString(),
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            accountEmail: overrides.accountEmail,
            toolCallsByStep: {},
            toolCallCounts: {},
            contextWindowCapacity: 160000,
            apiProvider: '',
            ttftSeconds: 0.1,
            streamingSeconds: 0.2,
            stepIndices: [1],
            executionId: overrides.executionId || `exec-${Math.random().toString(36).slice(2, 10)}`,
            isRetry: false,
            retryOf: '',
            ttft: 100,
            streamDuration: 200,
            toolCalls: [],
        } as GMCallEntry;
    }


    /** Seed a tracker with calls from two different accounts */
    function buildMultiAccountTracker(): GMTracker {
        const tracker = new GMTracker();
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;

        // Account A: 200 calls across 2 conversations
        const accountA = 'alice@example.com';
        const callsA1: GMCallEntry[] = [];
        for (let i = 0; i < 120; i++) {
            callsA1.push(makeCall({
                model: 'MODEL_PLACEHOLDER_M26',
                modelDisplay: 'Claude Opus 4.6 (Thinking)',
                accountEmail: accountA,
                executionId: `a1-${i}`,
            }));
        }
        cache.set('conv-a1', {
            cascadeId: 'conv-a1',
            title: 'Conv A1',
            totalSteps: 200,
            calls: callsA1,
            lifetimeCalls: 120,
            coveredSteps: 120,
            coverageRate: 0.6,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        const callsA2: GMCallEntry[] = [];
        for (let i = 0; i < 80; i++) {
            callsA2.push(makeCall({
                model: 'MODEL_PLACEHOLDER_M16',
                modelDisplay: 'Gemini 3.1 Pro (High)',
                accountEmail: accountA,
                executionId: `a2-${i}`,
            }));
        }
        cache.set('conv-a2', {
            cascadeId: 'conv-a2',
            title: 'Conv A2',
            totalSteps: 100,
            calls: callsA2,
            lifetimeCalls: 80,
            coveredSteps: 80,
            coverageRate: 0.8,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        // Account B: 150 calls in 1 conversation
        const accountB = 'bob@example.com';
        const callsB1: GMCallEntry[] = [];
        for (let i = 0; i < 150; i++) {
            callsB1.push(makeCall({
                model: 'MODEL_PLACEHOLDER_M26',
                modelDisplay: 'Claude Opus 4.6 (Thinking)',
                accountEmail: accountB,
                executionId: `b1-${i}`,
            }));
        }
        cache.set('conv-b1', {
            cascadeId: 'conv-b1',
            title: 'Conv B1',
            totalSteps: 200,
            calls: callsB1,
            lifetimeCalls: 150,
            coveredSteps: 150,
            coverageRate: 0.75,
            checkpointSummaries: [],
            systemContextItems: [],
        });

        // Set current account to B (simulates user switched to account B)
        tracker.setCurrentAccount(accountB);
        // Mark as having fetched data
        (tracker as any)._hasFetchedCalls = true;

        return tracker;
    }


    describe('Multi-account archival integrity', () => {
        it('serialize → restore → getArchivalSummary preserves ALL accounts', () => {
            const tracker = buildMultiAccountTracker();

            // Verify: raw _buildSummary(true, true) sees all 350 calls
            const fullSummary = (tracker as any)._buildSummary(true, true) as GMSummary;
            expect(fullSummary.totalCalls).toBe(350);

            // Verify: account-filtered _buildSummary() sees only B's 150 calls
            const filteredSummary = (tracker as any)._buildSummary() as GMSummary;
            expect(filteredSummary.totalCalls).toBe(150);

            // Step 1: getArchivalSummary() with live data should return ALL 350
            const liveArchival = tracker.getArchivalSummary()!;
            expect(liveArchival.totalCalls).toBe(350);

            // Step 2: Simulate serialize (strips calls[])
            // First, trigger _lastSummary update (as fetchAll would)
            (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);
            const serialized = tracker.serialize();

            // Verify serialized summary has 350 calls (not just 150)
            expect(serialized.summary.totalCalls).toBe(350);
            // Verify calls[] are stripped
            for (const conv of serialized.summary.conversations) {
                expect(conv.calls.length).toBe(0);
            }

            // Step 3: Restore from serialized state (simulates IDE restart)
            const restored = GMTracker.restore(serialized);

            // _hasFetchedCalls should be false after restore
            expect((restored as any)._hasFetchedCalls).toBe(false);

            // Step 4: getArchivalSummary() after restore should still return ALL 350
            const restoredArchival = restored.getArchivalSummary()!;
            expect(restoredArchival.totalCalls).toBe(350);

            // Verify model breakdown includes both models
            const models = Object.keys(restoredArchival.modelBreakdown);
            expect(models.length).toBeGreaterThanOrEqual(2);
        });

        it('getFullSummary after restore also preserves all accounts', () => {
            const tracker = buildMultiAccountTracker();
            (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);
            const serialized = tracker.serialize();
            const restored = GMTracker.restore(serialized);

            const fullSummary = restored.getFullSummary()!;
            expect(fullSummary.totalCalls).toBe(350);
        });

        it('getDetailedSummary after restore preserves all accounts', () => {
            const tracker = buildMultiAccountTracker();
            (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);
            const serialized = tracker.serialize();
            const restored = GMTracker.restore(serialized);

            const detailed = restored.getDetailedSummary()!;
            expect(detailed.totalCalls).toBe(350);
        });

        it('daily archival context uses correct summary', () => {
            const tracker = buildMultiAccountTracker();

            // Simulate what fetchAll() now does: save full summary
            (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);

            // Serialize + restore (IDE restart before midnight)
            const serialized = tracker.serialize();
            const restored = GMTracker.restore(serialized);

            // At midnight, performDailyArchival calls getArchivalSummary()
            const archivalSummary = restored.getArchivalSummary()!;

            // This is what gets written to the calendar
            expect(archivalSummary.totalCalls).toBe(350);
            expect(archivalSummary.totalInputTokens).toBe(350 * 1000); // 1000 per call
            expect(archivalSummary.totalOutputTokens).toBe(350 * 500);  // 500 per call
        });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performDailyArchival, type DailyArchivalContext } from '../src/daily-archival';
import { DailyLedger } from '../src/daily-ledger';
import { DailyStore } from '../src/daily-store';
import type { ActivitySummary } from '../src/activity-tracker';
import type { GMCallEntry, GMSummary } from '../src/gm-tracker';

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
});

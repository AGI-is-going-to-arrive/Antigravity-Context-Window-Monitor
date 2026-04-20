import { describe, expect, it } from 'vitest';
import { DailyStore } from '../src/daily-store';
import type { ActivitySummary } from '../src/activity-tracker';
import type { GMSummary } from '../src/gm-tracker';

function createStore() {
    const state = new Map<string, unknown>();
    const store = new DailyStore();
    store.init({
        get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
        update: (key: string, value: unknown) => {
            state.set(key, value);
            return Promise.resolve();
        },
    } as never);
    return store;
}

function makeActivitySummary(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
    return {
        sessionStartTime: '2026-03-27T01:00:00.000Z',
        totalReasoning: 3,
        totalToolCalls: 1,
        totalCheckpoints: 0,
        totalUserInputs: 0,
        totalErrors: 0,
        estSteps: 0,
        totalInputTokens: 120,
        totalOutputTokens: 60,
        totalToolReturnTokens: 0,
        recentSteps: [],
        modelStats: {
            'Gemini 3.1 Pro (强)': {
                modelName: 'Gemini 3.1 Pro (强)',
                reasoning: 3,
                toolCalls: 1,
                checkpoints: 0,
                userInputs: 0,
                errors: 0,
                estSteps: 0,
                totalSteps: 4,
                thinkingTimeMs: 0,
                toolTimeMs: 0,
                inputTokens: 120,
                outputTokens: 60,
                toolReturnTokens: 0,
                toolBreakdown: {},
            },
        },
        globalToolStats: {},
        conversationBreakdown: [],
        checkpointHistory: [],
        subAgentTokens: [],
        ...overrides,
    };
}

function makeGMSummary(): GMSummary {
    return {
        conversations: [],
        modelBreakdown: {
            'Gemini 3.1 Pro (强)': {
                callCount: 2,
                stepsCovered: 3,
                totalInputTokens: 120,
                totalOutputTokens: 60,
                totalThinkingTokens: 20,
                totalCacheRead: 30,
                totalCacheCreation: 0,
                totalCredits: 5,
                avgTTFT: 1.5,
                minTTFT: 1,
                maxTTFT: 2,
                avgStreaming: 2.5,
                cacheHitRate: 0.5,
                responseModel: 'gemini-3.1-pro-high',
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                completionConfig: null,
                hasSystemPrompt: false,
                toolCount: 0,
                promptSectionTitles: [],
                totalRetries: 0,
                errorCount: 0,
                exactCallCount: 2,
                placeholderOnlyCalls: 0,
            },
        },
        totalCalls: 2,
        totalStepsCovered: 3,
        totalCredits: 5,
        totalInputTokens: 120,
        totalOutputTokens: 60,
        totalCacheRead: 30,
        totalCacheCreation: 0,
        totalThinkingTokens: 20,
        contextGrowth: [],
        fetchedAt: '2026-03-27T06:00:00.000Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
    };
}

describe('DailyStore', () => {
    it('addDailySnapshot writes a single entry per day and replaces on re-call', () => {
        const store = createStore();
        const summary = makeActivitySummary();
        const gm = makeGMSummary();

        store.addDailySnapshot('2026-03-27', summary, gm, 1.23, { 'Gemini 3.1 Pro (强)': 1.23 });

        const record = store.getRecord('2026-03-27');
        expect(record).not.toBeNull();
        expect(record!.cycles).toHaveLength(1);
        expect(record!.cycles[0].totalReasoning).toBe(3);
        expect(record!.cycles[0].gmTotalCalls).toBe(2);
        expect(record!.cycles[0].gmTotalCredits).toBe(5);
        expect(record!.cycles[0].estimatedCost).toBe(1.23);
        expect(record!.cycles[0].modelNames).toContain('Gemini 3.1 Pro (强)');

        // Re-call should replace, not append
        const updatedSummary = makeActivitySummary({ totalReasoning: 10 });
        store.addDailySnapshot('2026-03-27', updatedSummary, gm, 2.50);

        const updated = store.getRecord('2026-03-27');
        expect(updated!.cycles).toHaveLength(1);
        expect(updated!.cycles[0].totalReasoning).toBe(10);
        expect(updated!.cycles[0].estimatedCost).toBe(2.50);
    });

    it('addDailySnapshot works without GM summary', () => {
        const store = createStore();
        const summary = makeActivitySummary();

        store.addDailySnapshot('2026-04-01', summary, null);

        const record = store.getRecord('2026-04-01');
        expect(record).not.toBeNull();
        expect(record!.cycles[0].gmTotalCalls).toBeUndefined();
        expect(record!.cycles[0].totalReasoning).toBe(3);
    });

    it('legacy addCycle still works for backward compatibility', () => {
        const store = createStore();
        const archive = {
            startTime: '2026-03-27T01:00:00.000Z',
            endTime: '2026-03-27T06:00:00.000Z',
            triggeredBy: ['MODEL_PLACEHOLDER_M37'],
            recentSteps: [],
            summary: makeActivitySummary(),
        };

        store.addCycle(archive, makeGMSummary(), 1.23);

        const record = store.getRecord('2026-03-27');
        expect(record).not.toBeNull();
        expect(record!.cycles).toHaveLength(1);
        expect(record!.cycles[0].gmTotalCalls).toBe(2);
    });

    it('serialize/restoreSnapshot round-trips correctly without backfilled field', () => {
        const store = createStore();
        store.addDailySnapshot('2026-04-10', makeActivitySummary(), makeGMSummary(), 0.99);

        const serialized = store.serialize();
        expect(serialized.version).toBe(1);
        expect((serialized as any).backfilled).toBeUndefined();

        const store2 = createStore();
        store2.restoreSnapshot(serialized);
        const record = store2.getRecord('2026-04-10');
        expect(record!.cycles[0].estimatedCost).toBe(0.99);
    });

    it('clear removes all records', () => {
        const store = createStore();
        store.addDailySnapshot('2026-04-10', makeActivitySummary(), null);
        store.addDailySnapshot('2026-04-11', makeActivitySummary(), null);
        expect(store.totalDays).toBe(2);

        store.clear();
        expect(store.totalDays).toBe(0);
    });
});

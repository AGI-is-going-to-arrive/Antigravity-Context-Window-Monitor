import { describe, expect, it } from 'vitest';
import { DailyStore } from '../src/daily-store';
import type { ActivityArchive } from '../src/activity-tracker';
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

describe('DailyStore', () => {
    it('backfills missing GM and cost fields when importArchives hits an existing cycle', () => {
        const store = createStore();
        const archive: ActivityArchive = {
            startTime: '2026-03-27T01:00:00.000Z',
            endTime: '2026-03-27T06:00:00.000Z',
            triggeredBy: ['MODEL_PLACEHOLDER_M37'],
            recentSteps: [],
            summary: {
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
                    'Gemini 3.1 Pro (高)': {
                        modelName: 'Gemini 3.1 Pro (高)',
                        reasoning: 3,
                        toolCalls: 1,
                        checkPoints: 0,
                        userInputs: 0,
                        errors: 0,
                        estSteps: 0,
                        totalThinkingMs: 0,
                        totalToolMs: 0,
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
                gmModelBreakdown: undefined,
            },
        };

        store.addCycle(archive);

        const gmSummary: GMSummary = {
            conversations: [],
            modelBreakdown: {
                'Gemini 3.1 Pro (高)': {
                    callCount: 2,
                    stepsCovered: 3,
                    totalInputTokens: 120,
                    totalOutputTokens: 60,
                    totalThinkingTokens: 20,
                    totalCacheRead: 30,
                    totalCacheCreation: 0,
                    totalCredits: 0,
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
            totalCredits: 0,
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

        store.restoreSnapshot({
            version: 1,
            backfilled: false,
            records: {
                '2026-03-27': {
                    date: '2026-03-27',
                    cycles: [{
                        startTime: archive.startTime,
                        endTime: archive.endTime,
                        totalReasoning: 3,
                        totalToolCalls: 1,
                        totalErrors: 0,
                        totalInputTokens: 120,
                        totalOutputTokens: 60,
                        estSteps: 0,
                        modelNames: ['Gemini 3.1 Pro (高)'],
                    }],
                },
            },
        });

        const imported = store.importArchives([archive], gmSummary, 1.23);
        expect(imported).toBe(0);

        const record = store.getRecord('2026-03-27');
        expect(record?.cycles[0].triggeredBy).toEqual(['MODEL_PLACEHOLDER_M37']);
        expect(record?.cycles[0].gmTotalCalls).toBe(2);
        expect(record?.cycles[0].gmTotalTokens).toBe(180);
        expect(record?.cycles[0].estimatedCost).toBe(1.23);
        expect(record?.cycles[0].gmModelStats?.['Gemini 3.1 Pro (高)']?.cacheHitRate).toBe(0.5);
    });
});

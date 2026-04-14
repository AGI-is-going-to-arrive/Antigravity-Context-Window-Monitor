import { describe, expect, it } from 'vitest';
import type { GMSummary } from '../src/gm-tracker';
import { mergeModelDNAState, restoreModelDNAState, serializeModelDNAState } from '../src/model-dna-store';
import { initI18nFromState } from '../src/i18n';

function setLanguage(lang: 'zh' | 'en' | 'both') {
    initI18nFromState({
        get: () => lang,
    } as never);
}

describe('model-dna-store', () => {
    it('persists static model DNA even when the current cycle summary becomes empty', () => {
        setLanguage('zh');

        const summary: GMSummary = {
            conversations: [],
            modelBreakdown: {
                'Gemini 3.1 Pro (高)': {
                    callCount: 3,
                    stepsCovered: 5,
                    totalInputTokens: 1200,
                    totalOutputTokens: 300,
                    totalThinkingTokens: 100,
                    totalCacheRead: 0,
                    totalCacheCreation: 0,
                    totalCredits: 0,
                    avgTTFT: 1,
                    minTTFT: 1,
                    maxTTFT: 1,
                    avgStreaming: 2,
                    cacheHitRate: 0,
                    responseModel: 'gemini-3.1-pro-high',
                    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                    completionConfig: {
                        maxTokens: 8192,
                        temperature: 1,
                        firstTemperature: 1,
                        topK: 40,
                        topP: 0.95,
                        numCompletions: 1,
                        stopPatternCount: 4,
                    },
                    hasSystemPrompt: true,
                    toolCount: 12,
                    promptSectionTitles: ['System Prompt', 'Chat Messages'],
                    totalRetries: 0,
                    errorCount: 0,
                    exactCallCount: 3,
                    placeholderOnlyCalls: 0,
                },
            },
            totalCalls: 3,
            totalStepsCovered: 5,
            totalCredits: 0,
            totalInputTokens: 1200,
            totalOutputTokens: 300,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalThinkingTokens: 100,
            contextGrowth: [],
            fetchedAt: '2026-03-27T05:00:00.000Z',
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            totalRetryCount: 0,
            latestTokenBreakdown: [],
            stopReasonCounts: {},
        };

        const merged = mergeModelDNAState({}, summary);
        expect(merged.changed).toBe(true);

        const restored = restoreModelDNAState(serializeModelDNAState(merged.entries));
        const entry = restored['MODEL_PLACEHOLDER_M37'];
        expect(entry).toBeTruthy();
        expect(entry.responseModel).toBe('gemini-3.1-pro-high');
        expect(entry.toolCount).toBe(12);
        expect(entry.hasSystemPrompt).toBe(true);

        const afterEmpty = mergeModelDNAState(restored, {
            ...summary,
            modelBreakdown: {},
            totalCalls: 0,
            totalStepsCovered: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalThinkingTokens: 0,
        });
        expect(afterEmpty.changed).toBe(false);
        expect(afterEmpty.entries['MODEL_PLACEHOLDER_M37']?.responseModel).toBe('gemini-3.1-pro-high');
    });
});

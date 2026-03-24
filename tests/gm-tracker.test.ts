import { describe, expect, it } from 'vitest';
import type { GMSummary } from '../src/gm-tracker';
import { filterGMSummaryByModels } from '../src/gm-tracker';

describe('filterGMSummaryByModels', () => {
    it('keeps only the selected pool models in the archived snapshot', () => {
        const summary: GMSummary = {
            conversations: [
                {
                    cascadeId: 'c1',
                    title: 'Session 1',
                    totalSteps: 10,
                    coveredSteps: 4,
                    coverageRate: 0.4,
                    calls: [
                        {
                            stepIndices: [1],
                            executionId: 'a',
                            model: 'sonnet',
                            modelDisplay: 'Claude Sonnet',
                            responseModel: 'claude-sonnet-4-6',
                            modelAccuracy: 'exact',
                            inputTokens: 100,
                            outputTokens: 50,
                            thinkingTokens: 10,
                            responseTokens: 40,
                            cacheReadTokens: 5,
                            cacheCreationTokens: 0,
                            apiProvider: 'anthropic',
                            ttftSeconds: 1,
                            streamingSeconds: 2,
                            credits: 3,
                            creditType: 'prompt',
                            hasError: false,
                            errorMessage: '',
                            contextTokensUsed: 150,
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
                            retries: 0,
                            stopReason: 'STOP_REASON_END_TURN',
                            retryTokensIn: 0,
                            retryTokensOut: 0,
                            retryCredits: 0,
                            retryErrors: [],
                            timeSinceLastInvocation: 0,
                            tokenBreakdownGroups: [],
                            createdAt: '',
                            latestStableMessageIndex: 0,
                            startStepIndex: 0,
                            checkpointIndex: 0,
                        },
                        {
                            stepIndices: [2],
                            executionId: 'b',
                            model: 'gemini-flash',
                            modelDisplay: 'Gemini Flash',
                            responseModel: 'gemini-3-flash',
                            modelAccuracy: 'exact',
                            inputTokens: 200,
                            outputTokens: 80,
                            thinkingTokens: 0,
                            responseTokens: 80,
                            cacheReadTokens: 0,
                            cacheCreationTokens: 0,
                            apiProvider: 'google',
                            ttftSeconds: 2,
                            streamingSeconds: 3,
                            credits: 4,
                            creditType: 'prompt',
                            hasError: false,
                            errorMessage: '',
                            contextTokensUsed: 280,
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
                            retries: 0,
                            stopReason: 'STOP_REASON_END_TURN',
                            retryTokensIn: 0,
                            retryTokensOut: 0,
                            retryCredits: 0,
                            retryErrors: [],
                            timeSinceLastInvocation: 0,
                            tokenBreakdownGroups: [],
                            createdAt: '',
                            latestStableMessageIndex: 0,
                            startStepIndex: 0,
                            checkpointIndex: 0,
                        },
                    ],
                },
            ],
            modelBreakdown: {},
            totalCalls: 2,
            totalStepsCovered: 2,
            totalCredits: 7,
            totalInputTokens: 300,
            totalOutputTokens: 130,
            totalCacheRead: 5,
            totalCacheCreation: 0,
            totalThinkingTokens: 10,
            contextGrowth: [],
            fetchedAt: '2026-03-23T09:00:00.000Z',
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            totalRetryCount: 0,
            latestTokenBreakdown: [],
            stopReasonCounts: {},
        };

        const filtered = filterGMSummaryByModels(summary, ['sonnet']);

        expect(filtered).not.toBeNull();
        expect(filtered?.totalCalls).toBe(1);
        expect(filtered?.totalInputTokens).toBe(100);
        expect(filtered?.totalOutputTokens).toBe(50);
        expect(Object.keys(filtered?.modelBreakdown || {})).toEqual(['Claude Sonnet']);
        expect(filtered?.conversations[0].calls).toHaveLength(1);
        expect(filtered?.conversations[0].calls[0].model).toBe('sonnet');
        expect(filtered?.modelBreakdown['Claude Sonnet']?.exactCallCount).toBe(1);
        expect(filtered?.modelBreakdown['Claude Sonnet']?.placeholderOnlyCalls).toBe(0);
    });
});

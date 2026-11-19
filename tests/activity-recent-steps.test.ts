import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcCallMock = vi.fn();

vi.mock('../src/rpc-client', () => ({
    rpcCall: (...args: unknown[]) => rpcCallMock(...args),
}));

import { ActivityTracker, mergeGMStats } from '../src/activity-tracker';
import { slimStepEventForPersistence } from '../src/activity/helpers';
import type { GMModelStats, GMSummary } from '../src/gm-tracker';

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

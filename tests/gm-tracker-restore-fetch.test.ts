import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GMCallEntry, GMSummary, GMTrackerState } from '../src/gm-tracker';

const rpcCallMock = vi.fn();

vi.mock('../src/rpc-client', () => ({
    rpcCall: (...args: unknown[]) => rpcCallMock(...args),
}));

import { GMTracker } from '../src/gm-tracker';

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
});

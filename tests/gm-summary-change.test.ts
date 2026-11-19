import { describe, expect, it } from 'vitest';
import { hasGMSummaryChanged } from '../src/extension';
import {
    GMTracker,
    buildSummaryFromConversations,
    filterGMSummaryByModels,
    mergeGMModelStats,
    type GMCallEntry,
    type GMConversationData,
    type GMModelStats,
    type GMSummary,
} from '../src/gm-tracker';

function makeCall(): GMCallEntry {
    return {
        stepIndices: [1],
        executionId: 'exec-1',
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
        completionConfig: {
            maxTokens: 16384,
            temperature: 1,
            firstTemperature: 1,
            topK: 40,
            topP: 1,
            numCompletions: 1,
            stopPatternCount: 0,
        },
        systemPromptSnippet: 'system',
        toolCount: 2,
        toolNames: ['read_file', 'edit_file'],
        promptSectionTitles: ['system', 'tools'],
        promptSnippet: 'prompt',
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
        createdAt: '2026-06-01T00:00:00.000Z',
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        accountEmail: 'user@example.com',
        toolCallsByStep: { 1: ['read_file'] },
        contextWindowCapacity: 160000,
    };
}

function makeConversation(): GMConversationData {
    return {
        cascadeId: 'conv-1',
        title: 'Conversation 1',
        totalSteps: 5,
        calls: [makeCall()],
        lifetimeCalls: 1,
        coveredSteps: 1,
        coverageRate: 0.2,
        checkpointSummaries: [{
            checkpointNumber: 1,
            stepIndex: 1,
            tokens: 300,
            fullText: 'checkpoint text',
        }],
        systemContextItems: [{
            type: 'context_injection',
            stepIndex: 1,
            tokens: 200,
            label: 'Context Injection',
            fullText: 'history text',
        }],
        accountCredits: 3,
    };
}

function makeSummary(): GMSummary {
    return {
        conversations: [makeConversation()],
        modelBreakdown: {
            'Claude Opus 4.6 (Thinking)': {
                callCount: 1,
                stepsCovered: 1,
                totalInputTokens: 100,
                totalOutputTokens: 50,
                totalThinkingTokens: 10,
                totalCacheRead: 5,
                totalCacheCreation: 0,
                totalCredits: 3,
                avgTTFT: 1.2,
                minTTFT: 1.2,
                maxTTFT: 1.2,
                avgStreaming: 2.3,
                cacheHitRate: 1,
                responseModel: 'claude-opus-4-6-thinking',
                apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
                completionConfig: {
                    maxTokens: 16384,
                    temperature: 1,
                    firstTemperature: 1,
                    topK: 40,
                    topP: 1,
                    numCompletions: 1,
                    stopPatternCount: 0,
                },
                hasSystemPrompt: true,
                toolCount: 2,
                promptSectionTitles: ['system', 'tools'],
                totalRetries: 0,
                errorCount: 0,
                creditCallCount: 1,
                exactCallCount: 1,
                placeholderOnlyCalls: 0,
                contextWindowCapacity: 160000,
            },
        },
        totalCalls: 1,
        totalStepsCovered: 1,
        totalCredits: 3,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCacheRead: 5,
        totalCacheCreation: 0,
        totalThinkingTokens: 10,
        contextGrowth: [{ step: 1, tokens: 1200, model: 'Claude Opus 4.6 (Thinking)' }],
        fetchedAt: '2026-06-01T00:00:00.000Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: { END_TURN: 1 },
        retryErrorCodes: {},
        recentErrors: [],
        recentErrorEntries: [],
        toolCallCounts: { read_file: 1 },
        toolCallCountsByConv: { 'conv-1': { read_file: 1 } },
        retryErrorCodesByConv: {},
        uniqueErrors: [],
        toolCatalog: [{ name: 'read_file', firstSeen: '2026-06-01T00:00:00.000Z' }],
    };
}

describe('hasGMSummaryChanged', () => {
    it('returns false for identical summaries', () => {
        const prev = makeSummary();
        const next = structuredClone(prev);
        expect(hasGMSummaryChanged(prev, next)).toBe(false);
    });

    it('detects model DNA-only changes even when totals stay the same', () => {
        const prev = makeSummary();
        const next = makeSummary();
        next.modelBreakdown['Claude Opus 4.6 (Thinking)'].promptSectionTitles = ['system', 'tools', 'policy'];

        expect(hasGMSummaryChanged(prev, next)).toBe(true);
    });

    it('detects nested GM detail changes even when totals stay the same', () => {
        const prev = makeSummary();
        const next = makeSummary();
        next.toolCallCountsByConv = { 'conv-1': { read_file: 2 } };
        next.conversations[0].systemContextItems = [{
            type: 'context_injection',
            stepIndex: 1,
            tokens: 200,
            label: 'Context Injection',
            fullText: 'history text changed',
        }];

        expect(hasGMSummaryChanged(prev, next)).toBe(true);
    });
});

describe('GM aggregation regression — zero/missing TTFT and streaming must never dilute averages (#66 #2 & #3)', () => {
    it('does not dilute avgTTFT or avgStreaming in filterGMSummaryByModels when calls lack timing', () => {
        const callZeroFirst = { ...makeCall(), executionId: 'z0', ttftSeconds: 0, streamingSeconds: 0, outputTokens: 100, cacheReadTokens: 0 };
        const callTimedA = { ...makeCall(), executionId: 't1', ttftSeconds: 2.0, streamingSeconds: 4.0, outputTokens: 200, cacheReadTokens: 500 };
        const callZeroMid = { ...makeCall(), executionId: 'z1', ttftSeconds: 0, streamingSeconds: 0, outputTokens: 100, cacheReadTokens: 0 };
        const callTimedB = { ...makeCall(), executionId: 't2', ttftSeconds: 4.0, streamingSeconds: 6.0, outputTokens: 300, cacheReadTokens: 500 };
        const callOneTok = { ...makeCall(), executionId: 'tiny', ttftSeconds: 0, streamingSeconds: 0.2, outputTokens: 1, cacheReadTokens: 0 };

        const summary = makeSummary();
        summary.conversations = [{
            ...makeConversation(),
            calls: [callZeroFirst, callTimedA, callZeroMid, callTimedB, callOneTok],
        }];

        const filtered = filterGMSummaryByModels(summary, ['MODEL_PLACEHOLDER_M26']);
        expect(filtered).not.toBeNull();
        const stats = filtered!.modelBreakdown['Claude Opus 4.6 (Thinking)'];

        expect(stats.callCount).toBe(5);
        expect(stats.ttftSampleCount).toBe(2);
        expect(stats.avgTTFT).toBeCloseTo(3.0, 10);
        expect(stats.minTTFT).toBeCloseTo(2.0, 10);
        expect(stats.maxTTFT).toBeCloseTo(4.0, 10);
        expect(stats.streamingSampleCount).toBe(3);
        expect(stats.avgStreaming).toBeCloseTo((4.0 + 6.0 + 0.2) / 3, 10);
        // 1-token call excluded from speed-valid timed sums
        expect(stats.timedOutputTokens).toBe(500);
        expect(stats.timedStreamingSeconds).toBeCloseTo(10.0, 10);
        expect(stats.cacheHitCalls).toBe(2);
        expect(stats.cacheHitRate).toBeCloseTo(2 / 5, 10);
    });

    it('matches GMTracker._buildSummary when aggregating through buildSummaryFromConversations and mergeGMModelStats', () => {
        const calls: GMCallEntry[] = [
            { ...makeCall(), executionId: 'c1', ttftSeconds: 2.0, streamingSeconds: 4.0, outputTokens: 200, cacheReadTokens: 100, createdAt: new Date().toISOString() },
            { ...makeCall(), executionId: 'c2', ttftSeconds: 0, streamingSeconds: 0, outputTokens: 50, cacheReadTokens: 0, createdAt: new Date().toISOString() },
            { ...makeCall(), executionId: 'c3', ttftSeconds: 4.0, streamingSeconds: 6.0, outputTokens: 300, cacheReadTokens: 100, createdAt: new Date().toISOString() },
        ];
        const conv: GMConversationData = { ...makeConversation(), calls };

        const built = buildSummaryFromConversations([conv], '2026-06-01T00:00:00.000Z')!;
        const builtStats = built.modelBreakdown['Claude Opus 4.6 (Thinking)'];
        expect(builtStats.avgTTFT).toBeCloseTo(3.0, 10);
        expect(builtStats.avgStreaming).toBeCloseTo(5.0, 10);
        expect(builtStats.ttftSampleCount).toBe(2);
        expect(builtStats.streamingSampleCount).toBe(2);
        expect(builtStats.timedOutputTokens).toBe(500);
        expect(builtStats.timedStreamingSeconds).toBeCloseTo(10.0, 10);
        expect(builtStats.cacheHitCalls).toBe(2);

        const tracker = new GMTracker();
        (tracker as any)._cache.set('conv-1', conv);
        const trackerSummary = tracker.getFullSummary()!;
        const trackerStats = trackerSummary.modelBreakdown['Claude Opus 4.6 (Thinking)'];

        expect(trackerStats.avgTTFT).toBeCloseTo(builtStats.avgTTFT, 10);
        expect(trackerStats.avgStreaming).toBeCloseTo(builtStats.avgStreaming, 10);
        expect(trackerStats.ttftSampleCount).toBe(builtStats.ttftSampleCount);
        expect(trackerStats.streamingSampleCount).toBe(builtStats.streamingSampleCount);
        expect(trackerStats.timedOutputTokens).toBe(builtStats.timedOutputTokens);
        expect(trackerStats.timedStreamingSeconds).toBeCloseTo(builtStats.timedStreamingSeconds!, 10);
        expect(trackerStats.cacheHitCalls).toBe(builtStats.cacheHitCalls);
    });

    it('weights mergeGMModelStats by valid sample counts for both modern and legacy stats objects', () => {
        const base = makeSummary().modelBreakdown['Claude Opus 4.6 (Thinking)'];
        const target: GMModelStats = {
            ...base,
            callCount: 10,
            avgTTFT: 1.5,
            minTTFT: 1.0,
            maxTTFT: 2.0,
            avgStreaming: 3.0,
            ttftSampleCount: 4,
            streamingSampleCount: 4,
            timedOutputTokens: 400,
            timedStreamingSeconds: 12.0,
            cacheHitCalls: 6,
            cacheHitRate: 0.6,
        };
        const source: GMModelStats = {
            ...base,
            callCount: 5,
            avgTTFT: 4.0,
            minTTFT: 4.0,
            maxTTFT: 4.0,
            avgStreaming: 0,
            ttftSampleCount: 1,
            streamingSampleCount: 0,
            timedOutputTokens: 0,
            timedStreamingSeconds: 0,
            cacheHitCalls: 3,
            cacheHitRate: 0.6,
        };

        mergeGMModelStats(target, source);
        expect(target.callCount).toBe(15);
        expect(target.ttftSampleCount).toBe(5);
        expect(target.avgTTFT).toBeCloseTo((1.5 * 4 + 4.0 * 1) / 5, 10);
        expect(target.streamingSampleCount).toBe(4);
        expect(target.avgStreaming).toBeCloseTo(3.0, 10);
        expect(target.timedOutputTokens).toBe(400);
        expect(target.timedStreamingSeconds).toBeCloseTo(12.0, 10);
        expect(target.cacheHitCalls).toBe(9);
        expect(target.cacheHitRate).toBeCloseTo(9 / 15, 10);

        // Legacy stats (no ttftSampleCount) with avgTTFT === 0 must not dilute a timed merge
        const legacyZero: GMModelStats = { ...base, callCount: 3, avgTTFT: 0, minTTFT: 0, maxTTFT: 0, avgStreaming: 0 };
        delete legacyZero.ttftSampleCount;
        delete legacyZero.streamingSampleCount;
        const legacyTimed: GMModelStats = { ...base, callCount: 1, avgTTFT: 2.5, minTTFT: 2.5, maxTTFT: 2.5, avgStreaming: 5.0 };
        delete legacyTimed.ttftSampleCount;
        delete legacyTimed.streamingSampleCount;

        mergeGMModelStats(legacyZero, legacyTimed);
        expect(legacyZero.avgTTFT).toBeCloseTo(2.5, 10);
        expect(legacyZero.avgStreaming).toBeCloseTo(5.0, 10);
        expect(legacyZero.ttftSampleCount).toBe(1);
        expect(legacyZero.streamingSampleCount).toBe(1);
    });
});

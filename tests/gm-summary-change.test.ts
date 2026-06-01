import { describe, expect, it } from 'vitest';
import { hasGMSummaryChanged } from '../src/extension';
import type { GMCallEntry, GMConversationData, GMSummary } from '../src/gm-tracker';

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

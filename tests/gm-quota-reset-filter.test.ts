import { describe, expect, it } from 'vitest';
import { GMTracker, type GMCallEntry, type GMConversationData, type GMSummary } from '../src/gm-tracker';

const ACCOUNT_EMAIL = 'user@example.com';
const MODEL_ID = 'MODEL_PLACEHOLDER_M132';

function makeIsoAt(hour: number, minute = 0): string {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
}

function makeCall(overrides: Partial<GMCallEntry> & {
    executionId: string;
    stepIndices: number[];
    createdAt: string;
}): GMCallEntry {
    return {
        stepIndices: overrides.stepIndices,
        executionId: overrides.executionId,
        model: overrides.model || MODEL_ID,
        modelDisplay: overrides.modelDisplay || 'Gemini 3.5 Flash (High)',
        responseModel: overrides.responseModel || '',
        modelAccuracy: overrides.modelAccuracy || 'exact',
        inputTokens: overrides.inputTokens ?? 100,
        outputTokens: overrides.outputTokens ?? 50,
        thinkingTokens: overrides.thinkingTokens ?? 0,
        responseTokens: overrides.responseTokens ?? 50,
        cacheReadTokens: overrides.cacheReadTokens ?? 0,
        cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
        apiProvider: overrides.apiProvider || 'API_PROVIDER_GOOGLE_GEMINI',
        ttftSeconds: overrides.ttftSeconds ?? 0.5,
        streamingSeconds: overrides.streamingSeconds ?? 1.2,
        credits: overrides.credits ?? 1,
        creditType: overrides.creditType || 'ai',
        hasError: overrides.hasError ?? false,
        errorMessage: overrides.errorMessage || '',
        contextTokensUsed: overrides.contextTokensUsed ?? 1024,
        completionConfig: overrides.completionConfig ?? null,
        systemPromptSnippet: overrides.systemPromptSnippet || '',
        toolCount: overrides.toolCount ?? 0,
        toolNames: overrides.toolNames ?? [],
        promptSectionTitles: overrides.promptSectionTitles ?? [],
        promptSnippet: overrides.promptSnippet || '',
        promptSource: overrides.promptSource || 'none',
        messagePromptCount: overrides.messagePromptCount ?? 0,
        messageMetadataKeys: overrides.messageMetadataKeys ?? [],
        responseHeaderKeys: overrides.responseHeaderKeys ?? [],
        userMessageAnchors: overrides.userMessageAnchors ?? [],
        aiSnippetsByStep: overrides.aiSnippetsByStep ?? {},
        retries: overrides.retries ?? 0,
        stopReason: overrides.stopReason || 'STOP_REASON_END_TURN',
        retryTokensIn: overrides.retryTokensIn ?? 0,
        retryTokensOut: overrides.retryTokensOut ?? 0,
        retryCredits: overrides.retryCredits ?? 0,
        retryErrors: overrides.retryErrors ?? [],
        timeSinceLastInvocation: overrides.timeSinceLastInvocation ?? 0,
        tokenBreakdownGroups: overrides.tokenBreakdownGroups ?? [],
        createdAt: overrides.createdAt,
        latestStableMessageIndex: overrides.latestStableMessageIndex ?? 0,
        startStepIndex: overrides.startStepIndex ?? 0,
        checkpointIndex: overrides.checkpointIndex ?? 0,
        checkpointSummaries: overrides.checkpointSummaries ?? [],
        systemContextItems: overrides.systemContextItems ?? [],
        accountEmail: overrides.accountEmail ?? ACCOUNT_EMAIL,
        toolCallsByStep: overrides.toolCallsByStep ?? {},
        contextWindowCapacity: overrides.contextWindowCapacity ?? 128000,
    };
}

function seedTracker(calls: GMCallEntry[]): GMTracker {
    const tracker = new GMTracker();
    const cache = (tracker as any)._cache as Map<string, GMConversationData>;
    cache.set('conv-1', {
        cascadeId: 'conv-1',
        title: 'Conversation 1',
        totalSteps: 200,
        calls,
        lifetimeCalls: calls.length,
        coveredSteps: calls.length,
        coverageRate: calls.length / 200,
        checkpointSummaries: [],
        systemContextItems: [],
    });
    tracker.setCurrentAccount(ACCOUNT_EMAIL);
    (tracker as any)._hasFetchedCalls = true;
    (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true) as GMSummary;
    return tracker;
}

describe('GM quota reset filtering', () => {
    it('only archives calls at or before the cutoff time', () => {
        const beforeReset = makeCall({
            executionId: 'before-reset',
            stepIndices: [1],
            createdAt: makeIsoAt(1, 0),
        });
        const afterReset = makeCall({
            executionId: 'after-reset',
            stepIndices: [2],
            createdAt: makeIsoAt(2, 0),
        });
        const tracker = seedTracker([beforeReset, afterReset]);

        const archived = tracker.baselineForQuotaReset(
            ACCOUNT_EMAIL,
            [MODEL_ID],
            makeIsoAt(1, 30),
        );

        expect(archived).toBe(1);
        expect(tracker.getUiSummary()?.totalCalls).toBe(1);
        expect(tracker.getUiSummary()?.modelBreakdown['Gemini 3.5 Flash (High)']?.callCount).toBe(1);
    });

    it('keeps new same-model calls visible after reset even if their timestamps look stale', () => {
        const beforeReset = makeCall({
            executionId: 'before-reset',
            stepIndices: [1],
            createdAt: makeIsoAt(1, 0),
        });
        const tracker = seedTracker([beforeReset]);

        tracker.baselineForQuotaReset(
            ACCOUNT_EMAIL,
            [MODEL_ID],
            makeIsoAt(1, 30),
        );

        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        const conv = cache.get('conv-1')!;
        conv.calls.push(makeCall({
            executionId: 'post-reset-stale-created-at',
            stepIndices: [2],
            createdAt: makeIsoAt(1, 0),
        }));
        conv.totalSteps += 1;
        conv.lifetimeCalls = conv.calls.length;
        cache.set('conv-1', conv);

        const summary = tracker.getUiSummary();
        expect(summary?.totalCalls).toBe(1);
        expect(summary?.modelBreakdown['Gemini 3.5 Flash (High)']?.callCount).toBe(1);
    });

    it('ignores stale future cutoffs left by earlier resetTime drift bugs', () => {
        const currentCall = makeCall({
            executionId: 'current-m132',
            stepIndices: [1],
            createdAt: new Date().toISOString(),
        });
        const tracker = seedTracker([currentCall]);
        const cutoffKey = `${ACCOUNT_EMAIL}|${MODEL_ID}`;
        const futureCutoff = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

        ((tracker as any)._archivedAccountModelCutoffs as Map<string, string>).set(cutoffKey, futureCutoff);

        const summary = tracker.getUiSummary();
        expect(summary?.totalCalls).toBe(1);
        expect(summary?.modelBreakdown['Gemini 3.5 Flash (High)']?.callCount).toBe(1);
        expect(tracker.serialize().archivedAccountModelCutoffs?.[cutoffKey]).toBeUndefined();
    });
});

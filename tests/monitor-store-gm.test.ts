import { describe, expect, it, vi } from 'vitest';
import { MonitorStore } from '../src/monitor-store';
import type { GMCallEntry, GMConversationData } from '../src/gm-tracker';

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        stepIndices: [1],
        executionId: overrides.executionId || 'exec-1',
        model: overrides.model || 'MODEL_PLACEHOLDER_M26',
        modelDisplay: overrides.modelDisplay || 'Claude Opus 4.6 (Thinking)',
        responseModel: overrides.responseModel || 'claude-opus-4-6-thinking',
        modelAccuracy: overrides.modelAccuracy || 'exact',
        inputTokens: overrides.inputTokens ?? 10,
        outputTokens: overrides.outputTokens ?? 5,
        thinkingTokens: overrides.thinkingTokens ?? 0,
        responseTokens: overrides.responseTokens ?? 5,
        cacheReadTokens: overrides.cacheReadTokens ?? 0,
        cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
        apiProvider: overrides.apiProvider || '',
        ttftSeconds: overrides.ttftSeconds ?? 0,
        streamingSeconds: overrides.streamingSeconds ?? 0,
        credits: overrides.credits ?? 1,
        creditType: overrides.creditType || '',
        hasError: overrides.hasError ?? false,
        errorMessage: overrides.errorMessage || '',
        contextTokensUsed: overrides.contextTokensUsed ?? 0,
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
        stopReason: overrides.stopReason || '',
        retryTokensIn: overrides.retryTokensIn ?? 0,
        retryTokensOut: overrides.retryTokensOut ?? 0,
        retryCredits: overrides.retryCredits ?? 0,
        retryErrors: overrides.retryErrors ?? [],
        timeSinceLastInvocation: overrides.timeSinceLastInvocation ?? 0,
        tokenBreakdownGroups: overrides.tokenBreakdownGroups ?? [],
        createdAt: overrides.createdAt || '2026-06-01T00:00:00.000Z',
        latestStableMessageIndex: overrides.latestStableMessageIndex ?? 0,
        startStepIndex: overrides.startStepIndex ?? 0,
        checkpointIndex: overrides.checkpointIndex ?? 0,
        checkpointSummaries: overrides.checkpointSummaries ?? [],
        systemContextItems: overrides.systemContextItems ?? [],
        accountEmail: overrides.accountEmail,
        toolCallsByStep: overrides.toolCallsByStep ?? {},
        contextWindowCapacity: overrides.contextWindowCapacity ?? 0,
    };
}

function makeConversation(call: GMCallEntry): GMConversationData {
    return {
        cascadeId: 'conv-1',
        title: 'Conversation 1',
        totalSteps: 5,
        calls: [call],
        lifetimeCalls: 1,
        coveredSteps: 1,
        coverageRate: 0.2,
        checkpointSummaries: [],
        systemContextItems: [],
        accountCredits: call.credits,
    };
}

describe('MonitorStore GM conversation snapshots', () => {
    it('persists again when latest GM call details change without changing call count', () => {
        const updates: unknown[] = [];
        const workspaceState = {
            get: vi.fn().mockReturnValue(null),
            update: vi.fn((_key: string, value: unknown) => {
                updates.push(value);
                return Promise.resolve();
            }),
        };

        const store = new MonitorStore();
        store.init(workspaceState);

        store.recordGMConversations([makeConversation(makeCall())]);
        store.recordGMConversations([
            makeConversation(makeCall({
                responseModel: 'claude-opus-4-6-thinking-v2',
                credits: 9,
                createdAt: '2026-06-01T00:05:00.000Z',
            })),
        ]);

        expect(workspaceState.update).toHaveBeenCalledTimes(2);
        const lastSaved = updates[1] as { gmConversations: Record<string, GMConversationData> };
        expect(lastSaved.gmConversations['conv-1'].calls[0].responseModel).toBe('claude-opus-4-6-thinking-v2');
        expect(lastSaved.gmConversations['conv-1'].calls[0].credits).toBe(9);
    });
});

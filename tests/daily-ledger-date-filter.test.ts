import { describe, expect, it } from 'vitest';
import { DailyLedger, type LedgerCallEntry, toLocalDateKey } from '../src/daily-ledger';
import type { GMCallEntry } from '../src/gm-tracker';

function makeCall(createdAt: string): GMCallEntry {
    return {
        stepIndices: [1],
        executionId: `exec-${createdAt}`,
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
        stopReason: 'STOP_REASON_END_TURN',
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        timeSinceLastInvocation: 0,
        tokenBreakdownGroups: [],
        createdAt,
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        toolCallsByStep: {},
        contextWindowCapacity: 160000,
        accountEmail: 'user@example.com',
    };
}

describe('DailyLedger date filtering', () => {
    it('rejects calls that belong to the next local day', () => {
        const ledger = new DailyLedger(toLocalDateKey(new Date()));
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(12, 0, 0, 0);

        const entries: LedgerCallEntry[] = [{
            call: makeCall(tomorrow.toISOString()),
            dedupKey: 'conv-1:0',
        }];

        const added = ledger.recordCalls(entries);

        expect(added).toBe(0);
        expect(ledger.getTodayTotals().totalCalls).toBe(0);
    });
});

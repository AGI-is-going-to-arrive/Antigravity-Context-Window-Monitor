/**
 * Test: multi-account archival data integrity
 *
 * Simulates:
 *   1. Account A makes 200 calls
 *   2. Account B makes 150 calls
 *   3. User switches to account B (currentAccountEmail = B)
 *   4. serialize() → strip calls[] → restore() (simulates IDE restart)
 *   5. getArchivalSummary() should return ALL 350 calls, not just B's 150
 *
 * Before fix: _lastSummary saved account-filtered data → only 150 calls
 * After fix:  _lastSummary saves full cross-account data → 350 calls
 */

import { describe, expect, it } from 'vitest';
import { GMTracker, type GMSummary, type GMCallEntry, type GMConversationData } from '../src/gm-tracker';

/** Helper: build a minimal GMCallEntry with all required fields */
function makeCall(overrides: Partial<GMCallEntry> & { model: string; accountEmail: string }): GMCallEntry {
    return {
        model: overrides.model,
        modelDisplay: overrides.modelDisplay || overrides.model,
        responseModel: overrides.responseModel || '',
        modelAccuracy: '' as any,
        inputTokens: overrides.inputTokens ?? 1000,
        outputTokens: overrides.outputTokens ?? 500,
        responseTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
        credits: overrides.credits ?? 0,
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
        promptSource: '' as any,
        messagePromptCount: 0,
        messageMetadataKeys: [],
        responseHeaderKeys: [],
        userMessageAnchors: [],
        aiSnippetsByStep: {},
        retries: 0,
        stopReason: 'end_turn',
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        timeSinceLastInvocation: 0,
        tokenBreakdownGroups: [],
        createdAt: overrides.createdAt || new Date().toISOString(),
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        accountEmail: overrides.accountEmail,
        toolCallsByStep: {},
        toolCallCounts: {},
        contextWindowCapacity: 160000,
        apiProvider: '',
        ttftSeconds: 0.1,
        streamingSeconds: 0.2,
        stepIndices: [1],
        executionId: overrides.executionId || `exec-${Math.random().toString(36).slice(2, 10)}`,
        isRetry: false,
        retryOf: '',
        ttft: 100,
        streamDuration: 200,
        toolCalls: [],
    } as GMCallEntry;
}

/** Seed a tracker with calls from two different accounts */
function buildMultiAccountTracker(): GMTracker {
    const tracker = new GMTracker();
    const cache = (tracker as any)._cache as Map<string, GMConversationData>;

    // Account A: 200 calls across 2 conversations
    const accountA = 'alice@example.com';
    const callsA1: GMCallEntry[] = [];
    for (let i = 0; i < 120; i++) {
        callsA1.push(makeCall({
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            accountEmail: accountA,
            executionId: `a1-${i}`,
        }));
    }
    cache.set('conv-a1', {
        cascadeId: 'conv-a1',
        title: 'Conv A1',
        totalSteps: 200,
        calls: callsA1,
        lifetimeCalls: 120,
        coveredSteps: 120,
        coverageRate: 0.6,
        checkpointSummaries: [],
        systemContextItems: [],
    });

    const callsA2: GMCallEntry[] = [];
    for (let i = 0; i < 80; i++) {
        callsA2.push(makeCall({
            model: 'MODEL_PLACEHOLDER_M16',
            modelDisplay: 'Gemini 3.1 Pro (High)',
            accountEmail: accountA,
            executionId: `a2-${i}`,
        }));
    }
    cache.set('conv-a2', {
        cascadeId: 'conv-a2',
        title: 'Conv A2',
        totalSteps: 100,
        calls: callsA2,
        lifetimeCalls: 80,
        coveredSteps: 80,
        coverageRate: 0.8,
        checkpointSummaries: [],
        systemContextItems: [],
    });

    // Account B: 150 calls in 1 conversation
    const accountB = 'bob@example.com';
    const callsB1: GMCallEntry[] = [];
    for (let i = 0; i < 150; i++) {
        callsB1.push(makeCall({
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            accountEmail: accountB,
            executionId: `b1-${i}`,
        }));
    }
    cache.set('conv-b1', {
        cascadeId: 'conv-b1',
        title: 'Conv B1',
        totalSteps: 200,
        calls: callsB1,
        lifetimeCalls: 150,
        coveredSteps: 150,
        coverageRate: 0.75,
        checkpointSummaries: [],
        systemContextItems: [],
    });

    // Set current account to B (simulates user switched to account B)
    tracker.setCurrentAccount(accountB);
    // Mark as having fetched data
    (tracker as any)._hasFetchedCalls = true;

    return tracker;
}

describe('Multi-account archival integrity', () => {
    it('serialize → restore → getArchivalSummary preserves ALL accounts', () => {
        const tracker = buildMultiAccountTracker();

        // Verify: raw _buildSummary(true, true) sees all 350 calls
        const fullSummary = (tracker as any)._buildSummary(true, true) as GMSummary;
        expect(fullSummary.totalCalls).toBe(350);

        // Verify: account-filtered _buildSummary() sees only B's 150 calls
        const filteredSummary = (tracker as any)._buildSummary() as GMSummary;
        expect(filteredSummary.totalCalls).toBe(150);

        // Step 1: getArchivalSummary() with live data should return ALL 350
        const liveArchival = tracker.getArchivalSummary()!;
        expect(liveArchival.totalCalls).toBe(350);

        // Step 2: Simulate serialize (strips calls[])
        // First, trigger _lastSummary update (as fetchAll would)
        (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);
        const serialized = tracker.serialize();

        // Verify serialized summary has 350 calls (not just 150)
        expect(serialized.summary.totalCalls).toBe(350);
        // Verify calls[] are stripped
        for (const conv of serialized.summary.conversations) {
            expect(conv.calls.length).toBe(0);
        }

        // Step 3: Restore from serialized state (simulates IDE restart)
        const restored = GMTracker.restore(serialized);

        // _hasFetchedCalls should be false after restore
        expect((restored as any)._hasFetchedCalls).toBe(false);

        // Step 4: getArchivalSummary() after restore should still return ALL 350
        const restoredArchival = restored.getArchivalSummary()!;
        expect(restoredArchival.totalCalls).toBe(350);

        // Verify model breakdown includes both models
        const models = Object.keys(restoredArchival.modelBreakdown);
        expect(models.length).toBeGreaterThanOrEqual(2);
    });

    it('getFullSummary after restore also preserves all accounts', () => {
        const tracker = buildMultiAccountTracker();
        (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);
        const serialized = tracker.serialize();
        const restored = GMTracker.restore(serialized);

        const fullSummary = restored.getFullSummary()!;
        expect(fullSummary.totalCalls).toBe(350);
    });

    it('getDetailedSummary after restore preserves all accounts', () => {
        const tracker = buildMultiAccountTracker();
        (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);
        const serialized = tracker.serialize();
        const restored = GMTracker.restore(serialized);

        const detailed = restored.getDetailedSummary()!;
        expect(detailed.totalCalls).toBe(350);
    });

    it('daily archival context uses correct summary', () => {
        const tracker = buildMultiAccountTracker();

        // Simulate what fetchAll() now does: save full summary
        (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true);

        // Serialize + restore (IDE restart before midnight)
        const serialized = tracker.serialize();
        const restored = GMTracker.restore(serialized);

        // At midnight, performDailyArchival calls getArchivalSummary()
        const archivalSummary = restored.getArchivalSummary()!;

        // This is what gets written to the calendar
        expect(archivalSummary.totalCalls).toBe(350);
        expect(archivalSummary.totalInputTokens).toBe(350 * 1000); // 1000 per call
        expect(archivalSummary.totalOutputTokens).toBe(350 * 500);  // 500 per call
    });
});

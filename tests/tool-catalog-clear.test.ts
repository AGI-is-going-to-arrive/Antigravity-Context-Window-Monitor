import { describe, expect, it } from 'vitest';
import { persistClearedToolCatalog } from '../src/extension';
import { GMTracker, type GMSummary } from '../src/gm-tracker';

function makeSummary(): GMSummary {
    return {
        conversations: [],
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
        fetchedAt: '2026-05-06T00:00:00.000Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
        retryErrorCodes: {},
        recentErrors: [],
        toolCallCounts: {},
        toolCatalog: [{ name: 'stale_tool', firstSeen: '2026-05-05T00:00:00.000Z' }],
    };
}

describe('persistClearedToolCatalog', () => {
    it('clears both globalState and file-backed GM summaries', () => {
        const tracker = GMTracker.restore({
            version: 1,
            summary: makeSummary(),
            baselines: {},
        });
        const globalWrites = new Map<string, unknown>();
        const fileWrites = new Map<string, unknown>();
        const writer = (writes: Map<string, unknown>) => ({
            update: (key: string, value: unknown) => {
                writes.set(key, value);
            },
        });

        const summary = persistClearedToolCatalog(tracker, writer(globalWrites), writer(fileWrites));

        expect(summary?.toolCatalog).toEqual([]);
        expect((globalWrites.get('gmTrackerState') as { summary: GMSummary }).summary.toolCatalog).toEqual([]);
        expect((fileWrites.get('gmDetailedSummary') as GMSummary).toolCatalog).toEqual([]);
    });
});

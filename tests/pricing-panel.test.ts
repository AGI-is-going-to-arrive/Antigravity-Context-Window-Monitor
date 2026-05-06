import { describe, expect, it } from 'vitest';
import { buildPricingTabContent } from '../src/pricing-panel';
import { DEFAULT_PRICING, type ModelPricing, type PricingStore } from '../src/pricing-store';
import type { GMModelStats, GMSummary } from '../src/gm-tracker';

function makeModelStats(responseModel: string): GMModelStats {
    return {
        calls: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalThinkingTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCredits: 1,
        avgTTFT: 0,
        minTTFT: 0,
        maxTTFT: 0,
        avgStreaming: 0,
        cacheHitRate: 0,
        responseModel,
        apiProvider: '',
        completionConfig: null,
        hasSystemPrompt: false,
        toolCount: 0,
        promptSectionTitles: [],
        totalRetries: 0,
        errorCount: 0,
        creditCallCount: 1,
        exactCallCount: responseModel ? 1 : 0,
        placeholderOnlyCalls: responseModel ? 0 : 1,
        contextWindowCapacity: 0,
    };
}

function makeSummary(modelBreakdown: Record<string, GMModelStats>): GMSummary {
    return {
        conversations: [],
        modelBreakdown,
        totalCalls: 1,
        totalStepsCovered: 1,
        totalCredits: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
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
        toolCatalog: [],
    };
}

function makeStore(custom: Record<string, ModelPricing> = {}): PricingStore {
    const merged = { ...DEFAULT_PRICING, ...custom };
    return {
        calculateCosts: () => ({ rows: [], grandTotal: 0 }),
        getMerged: () => merged,
        getCustom: () => custom,
    } as unknown as PricingStore;
}

describe('pricing panel', () => {
    it('keeps default pricing rows visible when a called model lacks responseModel', () => {
        const html = buildPricingTabContent(
            makeSummary({ 'Unknown placeholder': makeModelStats('') }),
            makeStore(),
        );

        expect(html).not.toContain('data-model=""');
        expect(html).toContain('data-model="claude-opus-4-6"');
        expect(html).toContain('data-model="gemini-3-flash"');
    });

    it('marks pricing inputs with their original value and custom state', () => {
        const custom = {
            'claude-opus-4-6': { ...DEFAULT_PRICING['claude-opus-4-6'], input: 7 },
        };
        const html = buildPricingTabContent(
            makeSummary({ Claude: makeModelStats('claude-opus-4-6') }),
            makeStore(custom),
        );

        expect(html).toContain('data-model="claude-opus-4-6"');
        expect(html).toContain('data-original-value="7"');
        expect(html).toContain('data-was-custom="1"');
        expect(html).toContain('data-model="gpt-oss-120b"');
        expect(html).toContain('data-was-custom="0"');
    });

    it('marks default-only pricing inputs so saving does not create overrides', () => {
        const html = buildPricingTabContent(null, makeStore());

        expect(html).toContain('data-model="claude-opus-4-6"');
        expect(html).toContain('data-original-value="5"');
        expect(html).toContain('data-was-custom="0"');
    });
});

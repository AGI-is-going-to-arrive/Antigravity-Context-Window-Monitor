import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PRICING,
    findPricing,
    findPricingWithCustom,
    costFromTokens,
    type ModelPricing,
} from '../src/pricing-store';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import type { LedgerDayData } from '../src/daily-ledger';

const TENFOLD_37_FLASH: ModelPricing = {
    input: 7.5, output: 37.5, cacheRead: 0.75, cacheWrite: 9.375, thinking: 37.5,
};

function makeDay(modelKey: string, overrides: Partial<{
    inputTokens: number; outputTokens: number; thinkingTokens: number;
    cacheReadTokens: number; estimatedCost: number;
}> = {}): LedgerDayData {
    const stats = {
        calls: 10,
        inputTokens: overrides.inputTokens ?? 500_000,
        outputTokens: overrides.outputTokens ?? 200_000,
        thinkingTokens: overrides.thinkingTokens ?? 50_000,
        cacheReadTokens: overrides.cacheReadTokens ?? 1_500_000,
        cacheCreationTokens: 0,
        credits: 0,
        estimatedCost: overrides.estimatedCost ?? 0,
    };
    return {
        dateKey: '2026-08-13',
        settled: [],
        accounts: {
            'user@example.com': {
                accountEmail: 'user@example.com',
                totalCalls: stats.calls,
                totalInputTokens: stats.inputTokens,
                totalOutputTokens: stats.outputTokens,
                totalThinkingTokens: stats.thinkingTokens,
                totalCacheRead: stats.cacheReadTokens,
                totalCacheCreation: 0,
                totalCredits: 0,
                totalEstimatedCost: stats.estimatedCost,
                modelStats: { [modelKey]: stats },
                recordedCallIds: [],
                recordedCalls: [],
            },
        },
    };
}

// ─── Localized display names ─────────────────────────────────────────────────
// `resolveModelId` only knows the English tier suffix, so a localized name reached
// the end of findPricing unmatched and the model's cost silently read $0 for every
// user running a non-English UI. Claude names happened to survive (their built-in
// keys dash the decimal, matching the kebab rewrite) while every Gemini name did
// not — which is why this went unnoticed.

describe('findPricing with localized display names', () => {
    it('resolves Chinese-locale Gemini display names', () => {
        expect(findPricing('Gemini 3.1 Pro (高)')?.input).toBe(DEFAULT_PRICING['gemini-3.1-pro'].input);
        expect(findPricing('Gemini 3.7 Flash (高)')?.input).toBe(DEFAULT_PRICING['gemini-3.7-flash'].input);
        expect(findPricing('Gemini 3.5 Flash (中)')?.input).toBe(DEFAULT_PRICING['gemini-3.5-flash'].input);
        expect(findPricing('Gemini 3.6 Flash (低)')?.input).toBe(DEFAULT_PRICING['gemini-3.6-flash'].input);
    });

    it('still resolves the English names it always did', () => {
        expect(findPricing('Gemini 3.1 Pro (High)')?.input).toBe(DEFAULT_PRICING['gemini-3.1-pro'].input);
        expect(findPricing('Claude Opus 4.6 (Thinking)')?.input).toBe(DEFAULT_PRICING['claude-opus-4-6'].input);
        expect(findPricing('Claude Opus 4.6 (思考)')?.input).toBe(DEFAULT_PRICING['claude-opus-4-6'].input);
        expect(findPricing('gemini-3.7-flash-high')?.input).toBe(DEFAULT_PRICING['gemini-3.7-flash'].input);
    });

    it('does not invent pricing for an unknown model', () => {
        expect(findPricing('Totally Unknown Model (高)')).toBeNull();
        expect(findPricing('')).toBeNull();
    });
});

// ─── Custom pricing reaching the ledger ──────────────────────────────────────

describe('findPricingWithCustom', () => {
    const custom = { 'Gemini 3.7 Flash (High)': TENFOLD_37_FLASH };

    it('applies a custom price stored under a display name to a catalog-id query', () => {
        // The Pricing tab writes custom rows keyed by the ledger's display name while the
        // ledger looks pricing up by catalog id. Merging the tables does not bridge them.
        expect(findPricingWithCustom('gemini-3.7-flash-high', custom)?.input).toBe(7.5);
        expect(findPricingWithCustom('MODEL_PLACEHOLDER_M298', custom)?.input).toBe(7.5);
        expect(findPricingWithCustom('Gemini 3.7 Flash (High)', custom)?.input).toBe(7.5);
    });

    it('is not reachable through a merged table, which is why the helper exists', () => {
        // Guards the regression this replaced: the prefix pass walks keys in insertion
        // order, so built-in 'gemini-3.7-flash' wins over any custom row that follows it.
        const merged = { ...DEFAULT_PRICING, ...custom };
        expect(findPricing('gemini-3.7-flash-high', merged)?.input)
            .toBe(DEFAULT_PRICING['gemini-3.7-flash'].input);
    });

    it('leaves models the user did not customise on the built-in price', () => {
        expect(findPricingWithCustom('gemini-3.6-flash-high', custom)?.input)
            .toBe(DEFAULT_PRICING['gemini-3.6-flash'].input);
        expect(findPricingWithCustom('claude-opus-4-6', custom)?.input)
            .toBe(DEFAULT_PRICING['claude-opus-4-6'].input);
    });

    it('falls back to the built-in table when there are no custom prices', () => {
        expect(findPricingWithCustom('gemini-3.7-flash-high', {})?.input)
            .toBe(DEFAULT_PRICING['gemini-3.7-flash'].input);
    });
});

describe('costFromTokens', () => {
    it('bills thinking tokens at the thinking rate and excludes them from output', () => {
        const pricing = DEFAULT_PRICING['gemini-3.7-flash'];
        const cost = costFromTokens({
            inputTokens: 500_000, outputTokens: 200_000,
            thinkingTokens: 50_000, cacheReadTokens: 1_500_000,
        }, pricing);
        const expected = (500_000 * 0.75 + 150_000 * 3.75 + 1_500_000 * 0.075 + 50_000 * 3.75) / 1e6;
        expect(cost).toBeCloseTo(expected, 10);
    });

    it('never lets thinking exceeding output produce a negative output charge', () => {
        const cost = costFromTokens({
            inputTokens: 0, outputTokens: 10, thinkingTokens: 100, cacheReadTokens: 0,
        }, DEFAULT_PRICING['gemini-3.7-flash']);
        expect(cost).toBeGreaterThan(0);
    });
});

// ─── Archival re-pricing ─────────────────────────────────────────────────────

describe('buildGMSummaryFromLedger re-prices from stored tokens', () => {
    it('recovers a cost the ledger froze at zero for an unpriced model', () => {
        // Exactly the Gemini 3.7 Flash situation: recorded by a build whose pricing table
        // had no row for the model, so every call was archived at $0 forever.
        const result = buildGMSummaryFromLedger(makeDay('Gemini 3.7 Flash (High)'));
        const expected = (500_000 * 0.75 + 150_000 * 3.75 + 1_500_000 * 0.075 + 50_000 * 3.75) / 1e6;
        expect(result.totalCost).toBeCloseTo(expected, 10);
        expect(result.costPerModel['Gemini 3.7 Flash (High)']).toBeCloseTo(expected, 10);
    });

    it('lets custom pricing reach the archived day', () => {
        const result = buildGMSummaryFromLedger(
            makeDay('Gemini 3.7 Flash (High)'),
            { 'Gemini 3.7 Flash (High)': TENFOLD_37_FLASH },
        );
        const baseline = buildGMSummaryFromLedger(makeDay('Gemini 3.7 Flash (High)'));
        expect(result.totalCost).toBeCloseTo(baseline.totalCost * 10, 8);
    });

    it('keeps the frozen cost when the model resolves to no pricing', () => {
        const result = buildGMSummaryFromLedger(makeDay('Totally Unknown Model', { estimatedCost: 4.25 }));
        expect(result.totalCost).toBeCloseTo(4.25, 10);
    });

    it('carries a resolvable responseModel so the archival cost fallback is not dead code', () => {
        // An empty responseModel made findPricing return null and silently disabled the
        // pricingStore fallback in performDailyArchival.
        const result = buildGMSummaryFromLedger(makeDay('Gemini 3.7 Flash (High)'));
        const stats = result.summary.modelBreakdown['Gemini 3.7 Flash (High)'];
        expect(stats.responseModel).toBe('Gemini 3.7 Flash (High)');
        expect(findPricing(stats.responseModel)).not.toBeNull();
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_PRICING, PricingStore, calculateCosts, calculateLedgerModelCosts, calculateUsageCosts,
    costFromTokens, findPricing, findPricingForDate, findPricingWithCustom, type ModelPricing,
} from '../src/pricing-store';
import { DailyLedger, type LedgerAccountBucket, type LedgerDayData, type LedgerModelStats } from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { parseGMEntry } from '../src/gm/parser';
import { buildPricingTabContent } from '../src/pricing-panel';
import { setLanguageToState, type Language } from '../src/i18n';

const model = 'MODEL_PLACEHOLDER_M419';
const intro: ModelPricing = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0, thinking: 10 };
const standard: ModelPricing = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0, thinking: 20 };
const custom: ModelPricing = { input: 3, output: 7, cacheRead: 0.5, cacheWrite: 0, thinking: 7 };
const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000, thinkingTokens: 250_000, cacheReadTokens: 1_000_000 };
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

afterEach(async () => { vi.useRealTimers(); await setLanguageToState('both', state); });

function call(createdAt: string, id: string, modelId = model) {
    return { ...parseGMEntry({ executionId: id, stepIndices: [1], chatModel: {
        model: modelId, responseModel: 'gemini-4-argon', usage: {
            inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens,
            thinkingOutputTokens: tokens.thinkingTokens, cacheReadTokens: tokens.cacheReadTokens,
        }, chatStartMetadata: { createdAt },
    } }), accountEmail: 'pricing@example.test' };
}

function bucket(estimatedCost = 0): LedgerAccountBucket {
    const stats: LedgerModelStats = { ...tokens, calls: 1, cacheCreationTokens: 0, credits: 0, estimatedCost };
    return { accountEmail: 'pricing@example.test', totalCalls: 1, totalInputTokens: tokens.inputTokens,
        totalOutputTokens: tokens.outputTokens, totalThinkingTokens: tokens.thinkingTokens,
        totalCacheRead: tokens.cacheReadTokens, totalCacheCreation: 0, totalCredits: 0,
        totalEstimatedCost: estimatedCost, modelStats: { [model]: stats }, recordedCalls: [], recordedCallIds: [] };
}

describe('official Gemini 4 Argon standard API rates', () => {
    it.each([
        ['2026-11-30', intro], ['2026-11-30T23:59:59.999Z', intro],
        ['2026-12-01T00:00:00Z', standard], ['2026-12-01', standard],
        ['2026-12-01T10:59:59+11:00', intro], ['2026-12-01T11:00:00+11:00', standard],
        ['2026-11-30T23:30:00-01:00', standard],
    ] as const)('uses the published standard rate at %s', (date, expected) => {
        expect(findPricingForDate(model, {}, date)).toEqual(expected);
    });

    it('changes current default/editor prices without restarting the extension', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-30T23:59:59Z'));
        const store = new PricingStore();
        expect(findPricing(model)).toEqual(intro);
        expect(store.getMerged()['gemini-4-argon']).toEqual(intro);
        vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
        expect(findPricing(model)).toEqual(standard);
        expect(store.getMerged()['gemini-4-argon']).toEqual(standard);
        expect(findPricingForDate(model, {}, '2026-11-30')).toEqual(intro);
    });

    it.each(['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M418', model,
        'gemini-4-argon-high', 'gemini-4-argon-medium', 'gemini-4-argon-low', 'gemini-4-argon',
        'Gemini 4 Argon (高)', 'Gemini 4 Argon (中) (M418)', 'Gemini 4 Argon（低）',
    ])('resolves the dated official rate for %s', alias => {
        expect(findPricingForDate(alias, {}, '2026-11-30')).toEqual(intro);
        expect(findPricingForDate(alias, {}, '2026-12-01')).toEqual(standard);
    });

    it.each(['', 'invalid', '2026-11-31', '2026-13-01', '2026-12-01T00:00:00', Infinity, NaN, new Date(NaN)])(
        'does not substitute today for invalid historic date %s', date => {
            expect(findPricingForDate(model, {}, date)).toBeNull();
            expect(findPricingForDate(model, { 'gemini-4-argon': custom }, date)).toBe(custom);
        },
    );

    it('keeps exact custom tiers above family overrides across both rate eras', () => {
        const overrides = { 'gemini-4-argon': standard, 'Gemini 4 Argon (低) (M419)': custom };
        for (const date of ['2026-11-30', '2026-12-01']) {
            expect(findPricingForDate(model, overrides, date)).toBe(custom);
            expect(findPricingForDate('gemini-4-argon-high', overrides, date)).toBe(standard);
        }
        expect(findPricingWithCustom(model, overrides)).toBe(custom);
        expect(findPricingForDate('gemini-40-argon', {}, '2026-11-30')).toBeNull();
        expect(findPricingForDate('unknown-image-model', {}, '2026-11-30')).toBeNull();
    });

    it('includes thinking once and uses only implicit cache read rates', () => {
        expect(costFromTokens(tokens, intro)).toBeCloseTo(12.1, 10);
        expect(costFromTokens(tokens, standard)).toBeCloseTo(24.2, 10);
        expect(intro.cacheWrite).toBe(0);
    });

    it('prices the three observed OK calls without billing thinking twice', () => {
        const observed = [
            { inputTokens: 12905, outputTokens: 5, thinkingTokens: 0, cacheReadTokens: 0 },
            { inputTokens: 12903, outputTokens: 31, thinkingTokens: 26, cacheReadTokens: 0 },
            { inputTokens: 12905, outputTokens: 32, thinkingTokens: 27, cacheReadTokens: 0 },
        ];
        const total = observed.reduce((sum, usage) => sum + costFromTokens(usage, intro), 0);
        expect(total).toBeCloseTo(0.078106, 10);
    });

    it.each(['__proto__', 'constructor', 'toString'])('does not treat inherited table property %s as a price', key => {
        expect(findPricing(key)).toBeNull();
        expect(findPricingForDate(key, { 'gemini-4-argon': custom }, '2026-11-30')).toBeNull();
    });

    it('preserves the Flash introductory schedule through the shared dated resolver', () => {
        expect(findPricingForDate('MODEL_PLACEHOLDER_M318', {}, '2026-12-31')?.input).toBe(0.75);
        expect(findPricingForDate('Gemini 3.8 Flash (中)', {}, '2027-01-01')?.input).toBe(1.5);
        expect(findPricingForDate('MODEL_PLACEHOLDER_M298', {}, '2026-12-31')?.output).toBe(3.75);
    });
});

describe('Argon historical costs through ledger, summary and archive', () => {
    it('keeps an old accepted call at its original rate after restore and rollover', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-30T23:59:59Z'));
        const ledger = new DailyLedger();
        const entry = { call: call(new Date().toISOString(), 'old'), dedupKey: 'old' };
        expect(ledger.recordCalls([entry])).toBe(1);
        const saved = ledger.serialize();
        expect(saved.accounts['pricing@example.test'].totalEstimatedCost).toBeCloseTo(12.1, 10);
        vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
        const restored = DailyLedger.restore(JSON.parse(JSON.stringify(saved)));
        const result = buildGMSummaryFromLedger(restored.rollover(saved.dateKey));
        expect(result.totalCost).toBeCloseTo(12.1, 10);
    });

    it('prices complete mixed-date call evidence individually, including restored summary data', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
        const calls = [call('2026-11-30T23:59:59Z', 'before'), call('2026-12-01T00:00:00Z', 'after')];
        const summary = buildSummaryFromConversations([{ cascadeId: 'fixture', title: 'fixture', totalSteps: 2,
            calls, coveredSteps: 2, coverageRate: 1, checkpointSummaries: [] }], new Date().toISOString())!;
        const restored = JSON.parse(JSON.stringify(summary));
        const cost = calculateCosts(restored, {});
        expect(cost.grandTotal).toBeCloseTo(36.3, 10);
        expect(cost.rows[0]).toMatchObject({ inputCost: 6, outputCost: 22.5, thinkingCost: 7.5,
            usesHistoricalRates: true });
        expect(cost.rows[0].cacheCost).toBeCloseTo(0.3, 10);
        expect(calculateCosts(summary, { 'gemini-4-argon': custom }).grandTotal).toBeCloseTo(21, 10);
        const stats = Object.values(summary.modelBreakdown)[0];
        const unknownLabel = { ...summary, modelBreakdown: {
            'Historic untranslated label': { ...stats, responseModel: 'gemini-4-argon-low' },
        } };
        expect(calculateCosts(unknownLabel, {}).grandTotal).toBeCloseTo(36.3, 10);
    });

    it.each(['', 'invalid-time'])('retains a known introductory call while an undated remainder stays incomplete (%s)', missingDate => {
        const calls = [call('2026-11-30T23:59:59Z', 'known'), call(missingDate, 'undated')];
        const summary = buildSummaryFromConversations([{ cascadeId: 'fixture', title: 'fixture', totalSteps: 2,
            calls, coveredSteps: 2, coverageRate: 1, checkpointSummaries: [] }], '2026-12-02T00:00:00Z')!;
        const cost = calculateCosts(summary, {});
        expect(cost.grandTotal).toBeCloseTo(12.1, 10);
        expect(cost.rows[0].pricing).toBeNull();
        const html = buildPricingTabContent(summary, new PricingStore());
        expect(html).toContain('Partial total');
        expect(html).toContain('usage dates');
        expect(calculateCosts(summary, { 'gemini-4-argon': custom }).grandTotal).toBeCloseTo(21, 10);
    });

    it('does not price sparse or wholly missing call evidence using the summary retrieval date', () => {
        const calls = [call('2026-11-30T23:59:59Z', 'known'), call('', 'undated')];
        const summary = buildSummaryFromConversations([{ cascadeId: 'fixture', title: 'fixture', totalSteps: 2,
            calls, coveredSteps: 2, coverageRate: 1, checkpointSummaries: [] }], '2026-12-02T00:00:00Z')!;
        summary.conversations[0].calls = [calls[0]];
        expect(calculateCosts(summary, {}).grandTotal).toBeCloseTo(12.1, 10);
        expect(calculateCosts(summary, {}).rows[0].pricing).toBeNull();
        summary.conversations[0].calls = [];
        expect(calculateCosts(summary, {}).grandTotal).toBe(0);
        expect(calculateCosts(summary, {}).rows[0].pricing).toBeNull();
        summary.fetchedAt = '2026-11-30T00:00:00Z';
        expect(calculateCosts(summary, {}).grandTotal).toBe(0);
    });

    it('preserves a frozen aggregate when dated call detail is missing', () => {
        const b = bucket(13.75);
        const dated = calculateLedgerModelCosts(model, b.modelStats[model], b, {}, '2026-12-01');
        expect(dated.totalCost).toBe(13.75);
        expect(dated.costBreakdownUnavailable).toBe(true);
        expect(dated.inputCost + dated.outputCost + dated.thinkingCost + dated.cacheCost).toBe(0);
        expect(calculateLedgerModelCosts(model, b.modelStats[model], b, { [model]: custom }, '2026-12-01').totalCost)
            .toBeCloseTo(10.5, 10);
        b.recordedCalls = [{ callId: 'missing-date', createdAt: '', createdAtMs: Date.parse('2026-12-02T00:00:00Z'),
            modelId: model, modelKey: model, ...tokens, cacheCreationTokens: 0, credits: 0, estimatedCost: 13.75 }];
        expect(calculateLedgerModelCosts(model, b.modelStats[model], b, {}, '2026-12-01').totalCost).toBe(13.75);
    });

    it('re-prices previously unpriced day aggregates by saved calendar date, not today', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
        const b = bucket();
        const day: LedgerDayData = { dateKey: '2026-11-30', accounts: { 'pricing@example.test': b }, settled: [] };
        expect(buildGMSummaryFromLedger(day).totalCost).toBeCloseTo(12.1, 10);
        expect(buildGMSummaryFromLedger({ ...day, dateKey: '2026-12-01' }).totalCost).toBeCloseTo(24.2, 10);
        expect(calculateUsageCosts(model, tokens, {}, { at: 'invalid' }).pricing).toBeNull();
    });

    it('backfills only missing archived amounts with date-specific rates and keeps frozen amounts', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
        const data: DailyStoreState = { version: 1, records: {} };
        for (const date of ['2026-11-30', '2026-12-01']) {
            data.records[date] = { date, cycles: [{ startTime: `${date}T00:00:00`, endTime: `${date}T23:59:59`,
                totalReasoning: 0, totalToolCalls: 0, totalErrors: 0, totalInputTokens: 0, totalOutputTokens: 0,
                estSteps: 0, modelNames: [model], gmModelStats: { [model]: { calls: 1, credits: 0,
                    inputTokens: 1_000_000, outputTokens: 1_000_000, thinkingTokens: 250_000, avgTTFT: 0, cacheHitRate: 0 } } }] };
        }
        const persisted = new Map<string, unknown>([['dailyStoreState', data]]);
        const store = new DailyStore();
        store.init({ get: <T>(key: string, fallback: T) => (persisted.get(key) as T) ?? fallback,
            update: async (key: string, value: unknown) => { persisted.set(key, value); } });
        expect(store.backfillMissingCosts()).toBe(2);
        expect(store.getRecord('2026-11-30')!.cycles[0].estimatedCost).toBe(12);
        expect(store.getRecord('2026-12-01')!.cycles[0].estimatedCost).toBe(24);
        const before = JSON.stringify(store.serialize());
        expect(store.backfillMissingCosts({ 'gemini-4-argon': custom })).toBe(0);
        expect(JSON.stringify(store.serialize())).toBe(before);
    });
});

describe('Argon pricing disclosure', () => {
    it.each(['en', 'zh', 'both'] as Language[])('shows official standard rates and effective dates in %s', async language => {
        await setLanguageToState(language, state);
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
        const html = buildPricingTabContent(null, new PricingStore());
        expect(html).toMatch(/data-model="gemini-4-argon" data-field="input" data-original-value="2"/);
        expect(html).toContain('https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon');
        expect(html).toContain('2026-11-30'); expect(html).toContain('2026-12-01');
        expect(html).toContain(language === 'zh' ? '不支持显式缓存' : 'Explicit caching is not supported');
    });
});

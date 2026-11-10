import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_PRICING, PRICING_LAST_UPDATED, PricingStore, calculateCosts, calculateUsageCosts,
    costFromTokens, findPricing, findPricingForDate, type ModelPricing,
} from '../src/pricing-store';
import { DailyLedger } from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { buildPricingTabContent } from '../src/pricing-panel';
import { setLanguageToState, type Language } from '../src/i18n';

const model = 'MODEL_PLACEHOLDER_M438';
const intro: ModelPricing = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0, thinking: 10 };
const standard: ModelPricing = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0, thinking: 20 };
const custom: ModelPricing = { input: 3, output: 8, cacheRead: 0.4, cacheWrite: 0, thinking: 8 };
const tokens = { inputTokens: 1_000_000, outputTokens: 100_000, thinkingTokens: 25_000, cacheReadTokens: 500_000 };
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

afterEach(async () => { vi.useRealTimers(); await setLanguageToState('both', state); });

function call(createdAt: string, id: string) {
    return { ...parseGMEntry({ executionId: id, stepIndices: [1], chatModel: {
        model, responseModel: 'gemini-4-carbon', usage: {
            inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens,
            thinkingOutputTokens: tokens.thinkingTokens, cacheReadTokens: tokens.cacheReadTokens,
        }, chatStartMetadata: { createdAt },
    } }), accountEmail: 'carbon-pricing@example.test' };
}

function summary(dates: string[]) {
    const calls = dates.map((date, i) => call(date, `carbon-${i}`));
    return buildSummaryFromConversations([{ cascadeId: 'carbon-pricing-fixture', title: 'fixture',
        totalSteps: calls.length, calls, coveredSteps: calls.length, coverageRate: 1, checkpointSummaries: [] }],
    '2026-12-02T00:00:00Z')!;
}

describe('independent Carbon standard API pricing', () => {
    it.each([
        ['2026-11-30', intro], ['2026-11-30T23:59:59.999Z', intro],
        ['2026-12-01', standard], ['2026-12-01T00:00:00Z', standard],
        ['2026-12-01T10:59:59+11:00', intro], ['2026-12-01T11:00:00+11:00', standard],
        ['2026-11-30T23:30:00-01:00', standard],
        [Date.parse('2026-12-01T00:00:00Z'), standard], [new Date('2026-11-30T23:59:59Z'), intro],
    ] as const)('uses the usage date at %s regardless of the local calendar day', (date, expected) => {
        expect(findPricingForDate(model, {}, date)).toEqual(expected);
    });

    it('updates current prices at the boundary while keeping Carbon and Argon independent', () => {
        vi.useFakeTimers();
        const store = new PricingStore();
        for (const [date, expected] of [['2026-11-30T23:59:59Z', intro], ['2026-12-01T00:00:00Z', standard]] as const) {
            vi.setSystemTime(new Date(date));
            expect(store.getMerged()['gemini-4-carbon']).toEqual(expected);
            expect(findPricing(model)).toEqual(expected);
            expect(DEFAULT_PRICING['gemini-4-carbon']).not.toBe(DEFAULT_PRICING['gemini-4-argon']);
        }
        expect(findPricingForDate(model, {}, '2026-11-30')).toEqual(intro);
        expect(findPricingForDate('gemini-4-argon', {}, '2026-11-30')).toEqual(intro);
        expect(findPricingForDate('gemini-3.8-flash', {}, '2026-12-31')?.input).toBe(0.75);
        expect(findPricingForDate('gemini-3.8-flash', {}, '2027-01-01')?.input).toBe(1.5);
        expect(PRICING_LAST_UPDATED).toBe('2026-11-11');
    });

    it.each(['gemini-4-carbon', 'Gemini 4 Carbon', 'GEMINI_4_CARBON'])(
        'prices the shared family %s without assigning it an effort', family => {
            expect(findPricingForDate(family, {}, '2026-11-30')).toEqual(intro);
            expect(findPricingForDate(family, {}, '2026-12-01')).toEqual(standard);
        },
    );

    it.each([
        ['M427', 'high', '高'], ['M437', 'medium', '中'], ['M438', 'low', '低'],
    ])('prices every alias of %s without crossing effort or family overrides', (id, tier, localized) => {
        const aliases = [`MODEL_PLACEHOLDER_${id}`, `gemini-4-carbon-${tier}`,
            `GEMINI-4-CARBON-${tier.toUpperCase()}`, `Gemini 4 Carbon（${localized}）`,
            `Gemini 4 Carbon (${localized}) (${id})`];
        for (const alias of aliases) {
            expect(findPricingForDate(alias, {}, '2026-11-30')).toEqual(intro);
            expect(findPricingForDate(alias, {}, '2026-12-01')).toEqual(standard);
            expect(findPricingForDate(alias, { 'gemini-4-argon': custom }, '2026-11-30')).toEqual(intro);
        }
        const overrides = { 'gemini-4-carbon': standard, [`Gemini 4 Carbon (${localized}) (${id})`]: custom };
        for (const date of ['2026-11-30', '2026-12-01']) {
            expect(findPricingForDate(`gemini-4-carbon-${tier}`, overrides, date)).toBe(custom);
            for (const other of ['low', 'medium', 'high'].filter(value => value !== tier)) {
                expect(findPricingForDate(`gemini-4-carbon-${other}`, overrides, date)).toBe(standard);
            }
            expect(findPricingForDate('gemini-4-carbon', overrides, date)).toBe(standard);
            expect(findPricingForDate('gemini-4-argon-low', overrides, date)).not.toBe(custom);
        }
    });

    it.each(['', 'invalid', '2026-11-31', '2026-13-01', '2026-12-01T00:00:00',
        '2026-12-01T25:00:00Z', Infinity, NaN, new Date(NaN)])(
        'leaves invalid usage date %s unpriced unless an explicit custom price applies', date => {
            expect(findPricingForDate(model, {}, date)).toBeNull();
            expect(findPricingForDate(model, { 'gemini-4-carbon': custom }, date)).toBe(custom);
        },
    );

    it('leaves other generations, similar names and image models unpriced', () => {
        for (const id of ['gemini-40-carbon-high', 'gemini-4-carbonated-high', 'gemini-4-carbon-highest',
            'MODEL_PLACEHOLDER_M4270', 'gemini-3.1-flash-image']) {
            expect(findPricingForDate(id, {}, '2026-11-30'), id).toBeNull();
        }
    });

    it.each(['Carbon', 'Argon'])('rejects malformed %s names before family-price fallback', family => {
        const familyKey = `gemini-4-${family.toLowerCase()}`;
        const invalid = [`Gemini 4 ${family} (Maximum)`, `Gemini 4 ${family} (Highest)`,
            `Gemini 4 ${family} (High`, `Gemini 4 ${family} High)`, `Gemini 4 ${family} (高`,
            `Gemini 4 ${family} (Low) garbage`, `${familyKey}-low-garbage`,
            `${familyKey}-preview`, `${familyKey}-latest`, `${familyKey}-20261111`,
            `Gemini 4 ${family} (M427)`];
        for (const name of invalid) {
            expect(findPricingForDate(name, {}, '2026-11-11'), name).toBeNull();
            expect(findPricingForDate(name, { [familyKey]: custom }, '2026-11-11'), name).toBeNull();
            // An explicit exact-key custom price remains a deliberate user override.
            expect(findPricingForDate(name, { [name]: custom }, 'invalid'), name).toBe(custom);
        }
    });

    it('retains preview, latest and dated aliases for older model families', () => {
        for (const variant of ['preview', 'latest', '20261111']) {
            expect(findPricing(`gemini-3.1-pro-${variant}`)).toBe(DEFAULT_PRICING['gemini-3.1-pro']);
            expect(findPricing(`claude-opus-4-6-${variant}`)).toBe(DEFAULT_PRICING['claude-opus-4-6']);
        }
    });

    it('counts thinking once and excludes unsupported explicit cache writes', () => {
        expect(costFromTokens(tokens, intro)).toBeCloseTo(3.05, 10);
        expect(costFromTokens(tokens, standard)).toBeCloseTo(6.1, 10);
        expect(findPricingForDate(model, {}, '2026-11-30')?.cacheWrite).toBe(0);
    });
});

describe('Carbon historical usage and price recovery', () => {
    it('retains usage-date cost through ledger restore and archival after the price changes', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-30T23:59:59Z'));
        const ledger = new DailyLedger();
        ledger.recordCalls([{ dedupKey: 'carbon-old', call: call(new Date().toISOString(), 'carbon-old') }]);
        const saved = ledger.serialize();
        vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
        const restored = DailyLedger.restore(JSON.parse(JSON.stringify(saved)));
        expect(buildGMSummaryFromLedger(restored.rollover(saved.dateKey)).totalCost).toBeCloseTo(3.05, 10);
    });

    it('prices a mixed-boundary summary per call and marks undated usage incomplete', () => {
        const complete = summary(['2026-11-30T23:59:59Z', '2026-12-01T00:00:00Z']);
        const costs = calculateCosts(complete, {});
        expect(costs.grandTotal).toBeCloseTo(9.15, 10);
        expect(costs.rows[0]).toMatchObject({ inputCost: 6, outputCost: 2.25, thinkingCost: 0.75,
            usesHistoricalRates: true });
        const incomplete = summary(['2026-11-30T23:59:59Z', '']);
        expect(calculateCosts(incomplete, {}).grandTotal).toBeCloseTo(3.05, 10);
        expect(calculateCosts(incomplete, {}).rows[0].pricing).toBeNull();
        expect(calculateCosts(incomplete, { 'gemini-4-carbon': custom }).grandTotal).toBeCloseTo(8, 10);
    });

    it('preserves positive frozen totals when call evidence is missing and respects custom overrides', () => {
        const frozen = calculateUsageCosts(model, tokens, {}, { at: '2026-12-01', frozenCost: 3.75 });
        expect(frozen).toMatchObject({ totalCost: 3.75, costBreakdownUnavailable: true });
        expect(frozen.inputCost + frozen.outputCost + frozen.thinkingCost + frozen.cacheCost).toBe(0);
        expect(calculateUsageCosts(model, tokens, { [model]: custom },
            { at: '2026-12-01', frozenCost: 3.75 }).totalCost).toBeCloseTo(4, 10);
    });

    it('backfills unpriced archives by saved day, preserving all existing positive amounts', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-02T00:00:00Z'));
        const data: DailyStoreState = { version: 1, records: {} };
        for (const date of ['2026-11-29', '2026-11-30', '2026-12-01']) {
            data.records[date] = { date, cycles: [{ startTime: `${date}T00:00:00`, endTime: `${date}T23:59:59`,
                totalReasoning: 0, totalToolCalls: 0, totalErrors: 0, totalInputTokens: 0, totalOutputTokens: 0,
                estSteps: 0, modelNames: [model], ...(date === '2026-11-29' ? { estimatedCost: 7.25 } : {}),
                gmModelStats: { [model]: { calls: 1, credits: 0, inputTokens: tokens.inputTokens,
                    outputTokens: tokens.outputTokens, thinkingTokens: tokens.thinkingTokens, avgTTFT: 0, cacheHitRate: 0 } } }] };
        }
        const persisted = new Map<string, unknown>([['dailyStoreState', data]]);
        const store = new DailyStore();
        store.init({ get: <T>(key: string, fallback: T) => (persisted.get(key) as T) ?? fallback,
            update: async (key: string, value: unknown) => { persisted.set(key, value); } });
        expect(store.backfillMissingCosts()).toBe(2);
        expect(store.getRecord('2026-11-29')!.cycles[0].estimatedCost).toBe(7.25);
        expect(store.getRecord('2026-11-30')!.cycles[0].estimatedCost).toBe(3);
        expect(store.getRecord('2026-12-01')!.cycles[0].estimatedCost).toBe(6);
        const before = JSON.stringify(store.serialize());
        expect(store.backfillMissingCosts({ 'gemini-4-carbon': custom })).toBe(0);
        expect(JSON.stringify(store.serialize())).toBe(before);
    });
});

describe('Carbon pricing disclosure and editors', () => {
    it.each(['en', 'zh', 'both'] as Language[])('shows rates, dates and a stable editor before and after calls in %s', async language => {
        await setLanguageToState(language, state);
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
        const store = new PricingStore();
        for (const data of [null, summary(['2026-11-11T00:00:00Z'])]) {
            const html = buildPricingTabContent(data, store);
            expect(html.match(/data-model="gemini-4-carbon" data-field="input"/g)).toHaveLength(1);
            expect(html).toMatch(/data-model="gemini-4-carbon" data-field="input" data-original-value="2"/);
            expect(html).toContain('https://aistudio.google.com/docs/pricing#gemini-4-carbon');
            expect(html).toContain('2026-11-30'); expect(html).toContain('2026-12-01');
            expect(html).toContain(language === 'zh' ? 'Gemini 4 Carbon 标准 API 参考价' : 'Gemini 4 Carbon standard API reference');
            expect(html).toContain(language === 'zh' ? '不支持显式缓存' : 'Explicit caching is not supported');
        }
        const incomplete = buildPricingTabContent(summary(['2026-11-11T00:00:00Z', '']), store);
        expect(incomplete).toContain(language === 'zh' ? '已知小计' : 'Partial total');
        expect(incomplete).toContain(language === 'zh' ? '缺少已核实价格或调用日期' : 'lack verified prices or usage dates');
    });
});

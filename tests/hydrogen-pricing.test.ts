import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_PRICING, PRICING_LAST_UPDATED, PricingStore, calculateCosts, calculateUsageCosts,
    costFromTokens, findPricing, findPricingForDate, findPricingWithCustom, type ModelPricing,
} from '../src/pricing-store';
import { DailyLedger } from '../src/daily-ledger';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { buildPricingTabContent } from '../src/pricing-panel';
import { setLanguageToState, type Language } from '../src/i18n';
import { setShowModelShortId, updateModelDisplayNames } from '../src/models';

const rate: ModelPricing = { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0, thinking: 7.5 };
const override: ModelPricing = { input: 3, output: 8, cacheRead: 0.4, cacheWrite: 0, thinking: 8 };
const tiers = [
    { id: 'M527', tier: 'low', label: 'Low', zh: '低' },
    { id: 'M526', tier: 'medium', label: 'Medium', zh: '中' },
    { id: 'M525', tier: 'high', label: 'High', zh: '高' },
    { id: 'M528', tier: 'xhigh', label: 'XHigh', zh: '超高' },
];
const tokens = { inputTokens: 1_000_000, outputTokens: 100_000, thinkingTokens: 25_000, cacheReadTokens: 500_000 };
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

beforeEach(() => { setShowModelShortId(false); updateModelDisplayNames([], { authoritative: true }); });
afterEach(async () => { vi.useRealTimers(); setShowModelShortId(false); updateModelDisplayNames([], { authoritative: true }); await setLanguageToState('both', state); });

function call(id: string, index: number) {
    return { ...parseGMEntry({ executionId: `hydrogen-pricing-${index}`, stepIndices: [index], chatModel: {
        model: `MODEL_PLACEHOLDER_${id}`, responseModel: 'gemini-4-hydrogen', usage: {
            inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens,
            thinkingOutputTokens: tokens.thinkingTokens, cacheReadTokens: tokens.cacheReadTokens,
        }, chatStartMetadata: { createdAt: '2026-11-13T00:00:00Z' },
    } }), accountEmail: 'hydrogen-pricing@example.test' };
}

function summary() {
    const calls = tiers.map((tier, i) => call(tier.id, i));
    return buildSummaryFromConversations([{ cascadeId: 'hydrogen-pricing-fixture', title: 'fixture',
        totalSteps: calls.length, calls, coveredSteps: calls.length, coverageRate: 1, checkpointSummaries: [] }],
    '2026-11-13T00:01:00Z')!;
}

describe('independent Hydrogen standard API pricing', () => {
    it('prices stable identities after account labels change without losing custom tier precedence', () => {
        updateModelDisplayNames(tiers.map(tier => ({ model: `MODEL_PLACEHOLDER_${tier.id}`,
            label: `Account Hydrogen ${tier.label}`, supportsImages: true, allowedTiers: [],
            mimeTypeCount: 0, supportedMimeTypes: [], isRecommended: false })), { authoritative: true });
        const custom = { 'gemini-4-hydrogen': rate, 'gemini-4-hydrogen-xhigh': override };
        for (const tier of tiers) {
            for (const name of [`MODEL_PLACEHOLDER_${tier.id}`, `Account Hydrogen ${tier.label}`]) {
                expect(findPricing(name)).toEqual(rate);
                expect(findPricingWithCustom(name, custom)).toEqual(tier.tier === 'xhigh' ? override : rate);
            }
        }
        expect(findPricingWithCustom('MODEL_PLACEHOLDER_M528', { 'Account Hydrogen XHigh': override })).toBe(override);
    });

    it.each(tiers)('prices every alias of $tier at its own family rate', ({ id, tier, label, zh }) => {
        for (const alias of [`MODEL_PLACEHOLDER_${id}`, `gemini-4-hydrogen-${tier}`,
            `GEMINI_4_HYDROGEN_${tier.toUpperCase()}`, `Gemini 4 Hydrogen (${label})`,
            `Gemini 4 Hydrogen (${zh}) (${id})`, `Gemini 4 Hydrogen（${zh}）`]) {
            expect(findPricing(alias), alias).toEqual(rate);
            expect(findPricingWithCustom(alias, { 'gemini-4-carbon': override, 'gemini-4-argon': override }), alias).toEqual(rate);
        }
    });

    it.each(['Gemini 4 Hydrogen Extra', 'Gemini 4 Hydrogen (Extra)', 'Gemini 4 Hydrogen Extra High',
        'gemini-4-hydrogen-extra', 'gemini-4-hydrogen-xhigh', 'Gemini 4 Hydrogen（极高）'])(
        'maps the fourth effort spelling %s without a High-tier price leak', alias => {
            expect(findPricingWithCustom(alias, { 'gemini-4-hydrogen-high': override })).toEqual(rate);
            expect(findPricingWithCustom(alias, { 'gemini-4-hydrogen-xhigh': override })).toBe(override);
        },
    );

    it.each(['gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'GEMINI_4_HYDROGEN'])(
        'supports shared family %s without inheriting a tier override', family => {
            expect(findPricing(family)).toEqual(rate);
            expect(findPricingWithCustom(family, { 'gemini-4-hydrogen-xhigh': override })).toEqual(rate);
        },
    );

    it.each(['2026-11-13', '2026-12-01', '2027-01-01'])('does not inherit another family cutover on %s', date => {
        vi.useFakeTimers(); vi.setSystemTime(new Date(`${date}T00:00:00Z`));
        expect(DEFAULT_PRICING['gemini-4-hydrogen']).toEqual(rate);
        expect(findPricingForDate('MODEL_PLACEHOLDER_M528', {}, date)).toEqual(rate);
        expect(DEFAULT_PRICING['gemini-4-hydrogen']).not.toBe(DEFAULT_PRICING['gemini-4-carbon']);
        expect(DEFAULT_PRICING['gemini-4-hydrogen']).not.toBe(DEFAULT_PRICING['gemini-3.8-flash']);
    });

    it.each(tiers)('keeps a localized $tier override isolated and lets it win over a family override', ({ id, tier, zh }) => {
        const custom = { 'gemini-4-hydrogen': rate, [`Gemini 4 Hydrogen (${zh}) (${id})`]: override };
        for (const other of tiers) {
            expect(findPricingWithCustom(`gemini-4-hydrogen-${other.tier}`, custom)).toEqual(other.tier === tier ? override : rate);
        }
        expect(findPricingWithCustom('gemini-4-hydrogen', custom)).toBe(rate);
    });

    it.each(['Gemini 4 Hydrogen (Maximum)', 'Gemini 4 Hydrogen (Highest)', 'Gemini 4 Hydrogen (High',
        'Gemini 4 Hydrogen High)', 'Gemini 4 Hydrogen (超高', 'Gemini 4 Hydrogen Extra)',
        'Gemini 4 Hydrogen (XHigh) garbage', 'gemini-4-hydrogen-xhighest', 'gemini-4-hydrogen-high-garbage',
        'gemini-4-hydrogen-preview', 'gemini-4-hydrogen-latest', 'gemini-4-hydrogen-20261113',
        'Gemini 4 HydrogenHigh', 'Gemini 4 Hydrogen (M528)', 'gemini-4-hydrogenated-high'])(
        'does not price malformed identifier %s from its family prefix', name => {
            expect(findPricing(name)).toBeNull();
            expect(findPricingWithCustom(name, { 'gemini-4-hydrogen': override })).toBeNull();
            expect(findPricingWithCustom(name, { [name]: override })).toBe(override);
        },
    );

    it('counts thinking once and does not charge unsupported explicit caching', () => {
        expect(costFromTokens(tokens, rate)).toBeCloseTo(2.2875, 10);
        expect(findPricing('gemini-4-hydrogen')?.cacheWrite).toBe(0);
        expect(PRICING_LAST_UPDATED).toBe('2026-11-13');
    });
});

describe('Hydrogen cost records and presentation', () => {
    it('keeps all four costs distinct when responses contain only the shared family', () => {
        const costs = calculateCosts(summary(), {});
        expect(costs.rows).toHaveLength(4);
        expect(new Set(costs.rows.map(row => row.name)).size).toBe(4);
        expect(costs.grandTotal).toBeCloseTo(9.15, 10);
        expect(costs.rows.every(row => Math.abs(row.totalCost - 2.2875) < 1e-10)).toBe(true);
        const customized = calculateCosts(summary(), { 'gemini-4-hydrogen-xhigh': override });
        expect(customized.grandTotal).toBeCloseTo(10.8625, 10);
    });

    it('retains independently priced tiers through ledger restore and archival', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T01:00:00Z'));
        const ledger = new DailyLedger();
        ledger.recordCalls(tiers.map((tier, i) => ({ dedupKey: `hydrogen-${i}`, call: call(tier.id, i) })));
        const saved = ledger.serialize();
        vi.setSystemTime(new Date('2027-01-02T00:00:00Z'));
        const restored = DailyLedger.restore(JSON.parse(JSON.stringify(saved)));
        const archived = buildGMSummaryFromLedger(restored.rollover(saved.dateKey));
        expect(Object.keys(archived.summary.modelBreakdown)).toHaveLength(4);
        expect(archived.totalCost).toBeCloseTo(9.15, 10);
    });

    it('persists Extra overrides across store restore and resets to the independent family rate', async () => {
        const data = new Map<string, unknown>();
        const storage = { get: <T>(key: string, fallback: T) => (data.get(key) as T) ?? fallback,
            update: async (key: string, value: unknown) => { data.set(key, JSON.parse(JSON.stringify(value))); } };
        const original = new PricingStore(); original.init(storage);
        await original.set('Gemini 4 Hydrogen (Extra)', override);
        const restored = new PricingStore(); restored.init(storage);
        expect(calculateUsageCosts('MODEL_PLACEHOLDER_M528', tokens, restored.getCustom(),
            { at: '2026-11-13' }).totalCost).toBeCloseTo(4, 10);
        expect(findPricingWithCustom('MODEL_PLACEHOLDER_M525', restored.getCustom())).toEqual(rate);
        await restored.reset();
        expect(findPricingWithCustom('MODEL_PLACEHOLDER_M528', restored.getCustom())).toEqual(rate);
        const reset = new PricingStore(); reset.init(storage);
        expect(reset.getCustom()).toEqual({});
    });

    it.each(['en', 'zh', 'both'] as Language[])('shows verified rates and stable family editors in %s', async language => {
        await setLanguageToState(language, state);
        const store = new PricingStore();
        for (const data of [null, summary()]) {
            const html = buildPricingTabContent(data, store);
            expect(html.match(/data-model="gemini-4-hydrogen" data-field="input"/g)).toHaveLength(1);
            expect(html).toMatch(/data-model="gemini-4-hydrogen" data-field="input" data-original-value="1.5"/);
            expect(html).toContain('https://aistudio.google.com/docs/pricing#gemini-4-hydrogen');
            expect(html).toContain(language === 'zh' ? 'Gemini 4 Hydrogen 标准 API 参考价' : 'Gemini 4 Hydrogen standard API reference');
            expect(html).toContain(language === 'zh' ? '官网未公布定时调价计划' : 'No scheduled price change is published');
            expect(html).toContain(language === 'zh' ? 'Extra（XHigh）' : 'Extra (XHigh)');
        }
    });
});

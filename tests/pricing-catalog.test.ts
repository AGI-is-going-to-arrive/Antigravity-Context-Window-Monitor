// Consolidated Domain Suite: Model Pricing Tables & Resolution
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    calculateCosts,
    calculateLedgerModelCosts,
    calculateUsageCosts,
    costFromTokens,
    DEFAULT_PRICING,
    findPricing,
    findPricingForDate,
    findPricingWithCustom,
    formatUsdCost,
    formatUsdPerMillion,
    formatUsdSavings,
    getUpcomingRateChangeForModel,
    getUpcomingRateChanges,
    type ModelPricing,
    PRICING_LAST_UPDATED,
    PricingStore,
} from '../src/pricing-store';
import {
    DailyLedger,
    type DailyLedgerState,
    type LedgerAccountBucket,
    type LedgerDayData,
    type LedgerModelStats,
} from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { parseGMEntry } from '../src/gm/parser';
import { buildPricingTabContent } from '../src/pricing-panel';
import { type Language, setLanguageToState } from '../src/i18n';
import { setShowModelShortId, updateModelDisplayNames } from '../src/models';

describe('[argon-pricing]', () => {
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
});

describe('[carbon-pricing]', () => {
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
            expect(PRICING_LAST_UPDATED).toBe('2026-11-22');
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

        it('excludes a frozen mapped Orchestrator cost in strict mode while honoring explicit custom overrides', () => {
            const id = 'MODEL_PLACEHOLDER_M667';
            const at = '2026-11-28T12:00:00Z';
            const usage = { inputTokens: 1_000_000, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 };
            const options = { at, frozenCost: 2, callCount: 1 };
            expect(calculateUsageCosts(id, usage, {}, { ...options, orchestratorPricingMode: 'mapped' }).totalCost).toBe(2);
            for (const calls of [[], [{ ...usage, model: id, createdAt: at }]]) {
                const strict = { ...options, orchestratorPricingMode: 'strict' as const, calls };
                expect(calculateUsageCosts(id, usage, {}, strict)).toMatchObject({ pricing: null, provenance: 'unpriced', totalCost: 0 });
                expect(calculateUsageCosts(id, usage, { [id]: { ...custom, input: 7 } }, strict)).toMatchObject({
                    provenance: 'custom', totalCost: 7,
                });
            }
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
});

describe('[hydrogen-pricing]', () => {
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
            expect(PRICING_LAST_UPDATED).toBe('2026-11-22');
        });

        it('maps M669 worker to Hydrogen in mapped mode, stays unpriced in strict mode, and keeps sonar/unmapped labels unpriced', () => {
            const mappedWorkerAliases = [
                'MODEL_PLACEHOLDER_M669',
                'gemini-flash-worker-agy',
                'Gemini Flash (Orchestrator Worker)',
                'Gemini 4 Hydrogen (Orchestrator)',
                'Gemini 4 Hydrogen (Orchestrator) (M669)',
            ];
            for (const id of mappedWorkerAliases) {
                // Default mapped mode maps M669 -> Hydrogen base rate without leaking family custom overrides
                expect(findPricing(id, DEFAULT_PRICING, 'mapped'), id).toEqual(rate);
                expect(findPricingWithCustom(id, { 'gemini-4-hydrogen': override }, DEFAULT_PRICING, 'mapped'), id).toEqual(rate);
                // Strict mode preserves strict unpriced behavior unless explicitly overridden
                expect(findPricing(id, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, { 'gemini-4-hydrogen': override }, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, { [id]: override }, DEFAULT_PRICING, 'strict'), id).toBe(override);
                expect(findPricingWithCustom(id, { [id]: override }, DEFAULT_PRICING, 'mapped'), id).toBe(override);
            }
            // Unverified specialized entries (Sonar, unmapped localized labels) stay unpriced in BOTH modes
            for (const unpriced of ['Gemini 4 Hydrogen (编排器)', 'gemini-4-hydrogen-sonar']) {
                expect(findPricing(unpriced, DEFAULT_PRICING, 'mapped'), unpriced).toBeNull();
                expect(findPricing(unpriced, DEFAULT_PRICING, 'strict'), unpriced).toBeNull();
                expect(findPricingWithCustom(unpriced, { 'gemini-4-hydrogen': override }), unpriced).toBeNull();
                expect(findPricingWithCustom(unpriced, { [unpriced]: override }), unpriced).toBe(override);
            }
            expect(findPricing('gemini-4-hydrogen-tiered-high')).toEqual(rate);
            expect(findPricing('gemini-4-hydrogen-tiered-xhigh')).toEqual(rate);
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
                expect(html).toContain(language === 'zh' ? 'Extra High（XHigh）' : 'Extra High (XHigh)');
            }
        });
    });
});

describe('[neon-pricing]', () => {
    const NEON_RATE: ModelPricing = { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0, thinking: 15 };

    const CUSTOM_OVERRIDE: ModelPricing = { input: 5, output: 25, cacheRead: 0.25, cacheWrite: 0, thinking: 25 };


    const NEON_TIERS = [
        { id: 'M534', tier: 'low', label: 'Low', zh: '低' },
        { id: 'M533', tier: 'medium', label: 'Medium', zh: '中' },
        { id: 'M532', tier: 'high', label: 'High', zh: '高' },
        { id: 'M535', tier: 'xhigh', label: 'XHigh', zh: '超高' },
    ] as const;


    const TOKENS = {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        thinkingTokens: 50_000,
        cacheReadTokens: 1_000_000,
    };


    beforeEach(() => {
        setShowModelShortId(false);
        updateModelDisplayNames([], { authoritative: true });
    });


    afterEach(() => {
        vi.useRealTimers();
        setShowModelShortId(false);
        updateModelDisplayNames([], { authoritative: true });
    });


    function makeNeonCall(id: string, index: number, createdAt = '2026-11-22T01:00:00Z') {
        return {
            ...parseGMEntry({
                executionId: `neon-pricing-${index}`,
                stepIndices: [index + 1],
                chatModel: {
                    model: `MODEL_PLACEHOLDER_${id}`,
                    responseModel: 'gemini-4-neon',
                    usage: {
                        inputTokens: TOKENS.inputTokens,
                        outputTokens: TOKENS.outputTokens,
                        thinkingOutputTokens: TOKENS.thinkingTokens,
                        cacheReadTokens: TOKENS.cacheReadTokens,
                    },
                    chatStartMetadata: { createdAt },
                },
            }),
            accountEmail: 'neon-pricing@example.test',
        };
    }


    describe('Gemini 4 Neon verified official standard API pricing', () => {
        it('exposes exact verified rates ($3/$15/$0.15/$0) across all four efforts and shared family', () => {
            expect(PRICING_LAST_UPDATED).toBe('2026-11-22');
            expect(DEFAULT_PRICING['gemini-4-neon']).toEqual(NEON_RATE);

            for (const family of ['gemini-4-neon', 'Gemini 4 Neon', 'GEMINI_4_NEON']) {
                expect(findPricing(family), family).toEqual(NEON_RATE);
            }

            for (const { id, tier, label, zh } of NEON_TIERS) {
                for (const alias of [
                    `MODEL_PLACEHOLDER_${id}`,
                    `gemini-4-neon-${tier}`,
                    `GEMINI_4_NEON_${tier.toUpperCase()}`,
                    `Gemini 4 Neon (${label})`,
                    `Gemini 4 Neon (${zh}) (${id})`,
                    `Gemini 4 Neon（${zh}）`,
                ]) {
                    expect(findPricing(alias), alias).toEqual(NEON_RATE);
                    expect(
                        findPricingWithCustom(alias, { 'gemini-4-carbon': CUSTOM_OVERRIDE, 'gemini-4-hydrogen': CUSTOM_OVERRIDE }),
                        alias,
                    ).toEqual(NEON_RATE);
                }
            }
        });

        it('has no scheduled cutover across December 2026 and January 2027', () => {
            for (const date of ['2026-11-22', '2026-12-01', '2027-01-01']) {
                vi.useFakeTimers();
                vi.setSystemTime(new Date(`${date}T00:00:00Z`));
                expect(DEFAULT_PRICING['gemini-4-neon']).toEqual(NEON_RATE);
                expect(findPricingForDate('MODEL_PLACEHOLDER_M535', {}, date)).toEqual(NEON_RATE);
            }
        });

        it('honors concrete-tier custom overrides ahead of family overrides without leaking across tiers', () => {
            const custom = {
                'gemini-4-neon': NEON_RATE,
                'Gemini 4 Neon (超高) (M535)': CUSTOM_OVERRIDE,
            };
            expect(findPricingWithCustom('MODEL_PLACEHOLDER_M535', custom)).toBe(CUSTOM_OVERRIDE);
            expect(findPricingWithCustom('gemini-4-neon-xhigh', custom)).toBe(CUSTOM_OVERRIDE);
            expect(findPricingWithCustom('gemini-4-neon-high', custom)).toEqual(NEON_RATE);
            expect(findPricingWithCustom('gemini-4-neon-medium', custom)).toEqual(NEON_RATE);
            expect(findPricingWithCustom('gemini-4-neon-low', custom)).toEqual(NEON_RATE);
            expect(findPricingWithCustom('gemini-4-neon', custom)).toEqual(NEON_RATE);
        });

        it('rejects malformed Neon suffixes unless explicitly overridden by exact key', () => {
            for (const malformed of [
                'Gemini 4 Neon (Maximum)',
                'Gemini 4 Neon (Highest)',
                'Gemini 4 Neon (Extra',
                'gemini-4-neon-extra-garbage',
                'Gemini 4 Neon (Extra)X',
                'MODEL_PLACEHOLDER_M5350',
                'gemini-4-neon-preview',
                'gemini-4-neon-20261122',
            ]) {
                expect(findPricing(malformed), malformed).toBeNull();
                expect(findPricingWithCustom(malformed, { 'gemini-4-neon': CUSTOM_OVERRIDE }), malformed).toBeNull();
                expect(findPricingWithCustom(malformed, { [malformed]: CUSTOM_OVERRIDE }), malformed).toBe(CUSTOM_OVERRIDE);
            }
        });

        it('maps M537/M669 to base rates in mapped mode, stays unpriced in strict mode, and keeps Sonar unpriced', () => {
            const mappedNeonIds = [
                'MODEL_PLACEHOLDER_M537',
                'Orchestrator (Neon)',
                'gemini-pro-orchestrator-neon',
            ];
            const mappedWorkerIds = [
                'MODEL_PLACEHOLDER_M669',
                'gemini-flash-worker-agy',
                'Gemini Flash (Orchestrator Worker)',
                'Gemini 4 Hydrogen (Orchestrator)',
                'Gemini 4 Hydrogen (Orchestrator) (M669)',
            ];
            const alwaysUnpricedIds = [
                'Gemini 4 Hydrogen（编排器）',
                'MODEL_PLACEHOLDER_M578',
                'gemini-4-hydrogen-sonar',
                'Gemini 4 Hydrogen (Sonar)',
            ];
            const familyOverrides = {
                'gemini-4-neon': CUSTOM_OVERRIDE,
                'gemini-4-hydrogen': CUSTOM_OVERRIDE,
            };
            for (const id of mappedNeonIds) {
                expect(findPricing(id, DEFAULT_PRICING, 'mapped'), id).toEqual(NEON_RATE);
                expect(findPricingWithCustom(id, familyOverrides, DEFAULT_PRICING, 'mapped'), id).toEqual(NEON_RATE);
                expect(findPricing(id, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, familyOverrides, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, { [id]: CUSTOM_OVERRIDE }), id).toBe(CUSTOM_OVERRIDE);
            }
            for (const id of mappedWorkerIds) {
                expect(findPricing(id, DEFAULT_PRICING, 'mapped'), id).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
                expect(findPricingWithCustom(id, familyOverrides, DEFAULT_PRICING, 'mapped'), id).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
                expect(findPricing(id, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, familyOverrides, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, { [id]: CUSTOM_OVERRIDE }), id).toBe(CUSTOM_OVERRIDE);
            }
            for (const id of alwaysUnpricedIds) {
                expect(findPricing(id, DEFAULT_PRICING, 'mapped'), id).toBeNull();
                expect(findPricing(id, DEFAULT_PRICING, 'strict'), id).toBeNull();
                expect(findPricingWithCustom(id, familyOverrides), id).toBeNull();
                expect(findPricingWithCustom(id, { [id]: CUSTOM_OVERRIDE }), id).toBe(CUSTOM_OVERRIDE);
            }
            // Catalog-only tiered Hydrogen variants price at Hydrogen rates
            expect(findPricing('gemini-4-hydrogen-tiered-high')).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
            expect(findPricing('gemini-4-hydrogen-tiered-xhigh')).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
        });

        it('counts thinking tokens once and computes exact Neon costs', () => {
            // 1M * $3 + (200K - 50K) * $15 + 50K * $15 + 1M * $0.15 = 3 + 2.25 + 0.75 + 0.15 = $6.15
            expect(costFromTokens(TOKENS, NEON_RATE)).toBeCloseTo(6.15, 10);
            const calls = NEON_TIERS.map((t, i) => makeNeonCall(t.id, i));
            const summary = buildSummaryFromConversations([{
                cascadeId: 'neon-fixture',
                title: 'Neon Fixture',
                totalSteps: calls.length,
                calls,
                coveredSteps: calls.length,
                coverageRate: 1,
                checkpointSummaries: [],
            }], '2026-11-22T01:05:00Z')!;
            const costs = calculateCosts(summary, {});
            expect(costs.rows).toHaveLength(4);
            expect(costs.grandTotal).toBeCloseTo(24.6, 10);
        });
    });


    describe('Neon upgrade recovery: DailyLedger reconciliation & DailyStore backfill', () => {
        it('reconciles today zero-cost Neon ledger calls and archives accurate cost on rollover', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-22T02:00:00Z'));
            const entries = NEON_TIERS.map((t, i) => ({
                dedupKey: `neon:${i}|${encodeURIComponent(`exec:neon-pricing-${i}`)}`,
                call: makeNeonCall(t.id, i, '2026-11-22T01:00:00Z'),
            }));
            const ledger = new DailyLedger();
            expect(ledger.recordCalls(entries)).toBe(4);
            const saved = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
            const bucket = saved.accounts['neon-pricing@example.test'];

            // Simulate pre-upgrade state where Neon was unpriced ($0)
            bucket.totalEstimatedCost = 0;
            for (const ms of Object.values(bucket.modelStats)) { ms.estimatedCost = 0; }
            for (const rc of bucket.recordedCalls) { rc.estimatedCost = 0; }

            const restored = DailyLedger.restore(saved);
            expect(restored.reconcileRecordedCalls(entries)).toBe(4);
            expect(restored.serialize().accounts['neon-pricing@example.test'].totalEstimatedCost).toBeCloseTo(24.6, 10);
            expect(restored.reconcileRecordedCalls(entries)).toBe(0);

            const rolled = buildGMSummaryFromLedger(restored.rollover(saved.dateKey));
            expect(rolled.totalCost).toBeCloseTo(24.6, 10);
        });

        it('backfills archived zero-cost Neon days idempotently without overwriting positive history', () => {
            const state: DailyStoreState = {
                version: 1,
                records: {
                    '2026-11-20': {
                        date: '2026-11-20',
                        cycles: [{
                            startTime: '2026-11-20T00:00:00',
                            endTime: '2026-11-20T23:59:59',
                            totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                            totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                            modelNames: ['MODEL_PLACEHOLDER_M535'],
                            gmModelStats: {
                                'Gemini 4 Neon (XHigh)': {
                                    calls: 1, credits: 0,
                                    inputTokens: TOKENS.inputTokens,
                                    outputTokens: TOKENS.outputTokens,
                                    thinkingTokens: TOKENS.thinkingTokens,
                                    cacheReadTokens: TOKENS.cacheReadTokens,
                                    avgTTFT: 0, cacheHitRate: 1,
                                },
                            },
                        }],
                    },
                    '2026-11-21': {
                        date: '2026-11-21',
                        cycles: [{
                            startTime: '2026-11-21T00:00:00',
                            endTime: '2026-11-21T23:59:59',
                            totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                            totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                            modelNames: ['MODEL_PLACEHOLDER_M535'],
                            estimatedCost: 9.99,
                            gmModelStats: {
                                'Gemini 4 Neon (XHigh)': {
                                    calls: 1, credits: 0,
                                    inputTokens: TOKENS.inputTokens,
                                    outputTokens: TOKENS.outputTokens,
                                    thinkingTokens: TOKENS.thinkingTokens,
                                    cacheReadTokens: TOKENS.cacheReadTokens,
                                    avgTTFT: 0, cacheHitRate: 1,
                                    estimatedCost: 9.99,
                                },
                            },
                        }],
                    },
                },
            };
            const persisted = new Map<string, unknown>([['dailyStoreState', state]]);
            const store = new DailyStore();
            store.init({
                get: <T>(key: string, fallback: T) => (persisted.get(key) as T) ?? fallback,
                update: async (key: string, value: unknown) => { persisted.set(key, value); },
            });
            expect(store.backfillMissingCosts()).toBe(1);
            expect(store.getRecord('2026-11-20')!.cycles[0].estimatedCost).toBeCloseTo(6.15, 10);
            expect(store.getRecord('2026-11-21')!.cycles[0].estimatedCost).toBe(9.99);
            expect(store.backfillMissingCosts({ 'gemini-4-neon': CUSTOM_OVERRIDE })).toBe(0);
        });
    });


    describe('Gemini 3.6 Flash 3-era pricing & calculateUsageCosts', () => {
        it('switches between standard (<Aug 13), promo (Aug 13–Dec 31), and standard (>=2027-01-01)', () => {
            vi.useFakeTimers();
            const store = new PricingStore();

            vi.setSystemTime(new Date('2026-08-12T23:59:59Z'));
            expect(store.getMerged()['gemini-3.6-flash'].input).toBe(1.50);

            vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
            expect(store.getMerged()['gemini-3.6-flash'].input).toBe(0.75);
            expect(store.getMerged()['gemini-3.6-flash'].output).toBe(3.75);
            expect(store.getMerged()['gemini-3.6-flash'].cacheRead).toBe(0.075);

            vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
            expect(store.getMerged()['gemini-3.6-flash'].input).toBe(1.50);

            // Frozen cost preservation across scheduled eras when call timestamps are missing
            const frozen = calculateUsageCosts('gemini-3.6-flash-high', TOKENS, {}, { at: '2026-12-31', frozenCost: 4.5 });
            expect(frozen).toMatchObject({ totalCost: 4.5, costBreakdownUnavailable: true });
        });
    });


    describe('getUpcomingRateChanges & getUpcomingRateChangeForModel', () => {
        it('reports Carbon & Argon within 14d of 2026-11-22 and adds Flash 3.6/3.7/3.8 within 45d', () => {
            const now = Date.parse('2026-11-22T00:00:00Z');
            const within14 = getUpcomingRateChanges(now, 14);
            expect(within14.map(c => c.modelKey)).toEqual(['gemini-4-argon', 'gemini-4-carbon']);
            expect(within14[0]).toMatchObject({ effectiveDate: '2026-12-01', daysRemaining: 9, multiplier: 2 });

            const within45 = getUpcomingRateChanges(now, 45);
            expect(within45.map(c => c.modelKey)).toEqual([
                'gemini-4-argon',
                'gemini-4-carbon',
                'gemini-3.6-flash',
                'gemini-3.7-flash',
                'gemini-3.8-flash',
            ]);
            expect(within45[2]).toMatchObject({ effectiveDate: '2027-01-01', daysRemaining: 40, multiplier: 2 });
        });

        it('excludes expired cutovers, pre-promo windows, and non-scheduled models', () => {
            const afterDec1 = Date.parse('2026-12-01T00:00:00Z');
            expect(getUpcomingRateChanges(afterDec1, 45).map(c => c.modelKey)).toEqual([
                'gemini-3.6-flash',
                'gemini-3.7-flash',
                'gemini-3.8-flash',
            ]);
            expect(getUpcomingRateChanges(Date.parse('2027-01-01T00:00:00Z'), 365)).toEqual([]);
            // Before 3.6 Flash promo start (2026-08-13), 3.6 Flash is not in a promo window
            const beforePromo = Date.parse('2026-08-01T00:00:00Z');
            expect(getUpcomingRateChanges(beforePromo, 200).map(c => c.modelKey)).not.toContain('gemini-3.6-flash');
            expect(getUpcomingRateChanges(Number.NaN, 30)).toEqual([]);
            expect(getUpcomingRateChanges(afterDec1, -1)).toEqual([]);
        });

        it('matches specific model aliases and suppresses notices when custom pricing overrides the model', () => {
            const now = Date.parse('2026-11-22T00:00:00Z');
            expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M427', {}, now, 14)?.modelKey).toBe('gemini-4-carbon');
            expect(getUpcomingRateChangeForModel('Gemini 4 Argon (Low)', {}, now, 14)?.modelKey).toBe('gemini-4-argon');
            expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M535', {}, now, 365)).toBeNull(); // Neon has no cutover
            expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M528', {}, now, 365)).toBeNull(); // Hydrogen has no cutover
            expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M427', { 'gemini-4-carbon': CUSTOM_OVERRIDE }, now, 14)).toBeNull();
            expect(getUpcomingRateChangeForModel('', {}, now, 30)).toBeNull();
        });
    });
});

describe('[pricing-resolution]', () => {
    const TENFOLD_37_FLASH: ModelPricing = {
        input: 7.5, output: 37.5, cacheRead: 0.75, cacheWrite: 9.375, thinking: 37.5,
    };


    const TENFOLD_38_FLASH: ModelPricing = {
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
            expect(findPricing('Gemini 3.8 Flash (中)')?.input).toBe(DEFAULT_PRICING['gemini-3.8-flash'].input);
            expect(findPricing('Gemini 3.5 Flash (中)')?.input).toBe(DEFAULT_PRICING['gemini-3.5-flash'].input);
            expect(findPricing('Gemini 3.6 Flash (低)')?.input).toBe(DEFAULT_PRICING['gemini-3.6-flash'].input);
        });

        it('still resolves the English names it always did', () => {
            expect(findPricing('Gemini 3.1 Pro (High)')?.input).toBe(DEFAULT_PRICING['gemini-3.1-pro'].input);
            expect(findPricing('Claude Opus 4.6 (Thinking)')?.input).toBe(DEFAULT_PRICING['claude-opus-4-6'].input);
            expect(findPricing('Claude Opus 4.6 (思考)')?.input).toBe(DEFAULT_PRICING['claude-opus-4-6'].input);
            expect(findPricing('gemini-3.7-flash-high')?.input).toBe(DEFAULT_PRICING['gemini-3.7-flash'].input);
            expect(findPricing('gemini-3.8-flash-low')?.input).toBe(DEFAULT_PRICING['gemini-3.8-flash'].input);
        });

        it('does not invent pricing for an unknown model', () => {
            expect(findPricing('Totally Unknown Model (高)')).toBeNull();
            expect(findPricing('')).toBeNull();
        });
    });


    // ─── Custom pricing reaching the ledger ──────────────────────────────────────

    describe('findPricingWithCustom', () => {
        const custom = {
            'Gemini 3.7 Flash (High)': TENFOLD_37_FLASH,
            'Gemini 3.8 Flash (High)': TENFOLD_38_FLASH,
        };

        it('applies a custom price stored under a display name to a catalog-id query', () => {
            // The Pricing tab writes custom rows keyed by the ledger's display name while the
            // ledger looks pricing up by catalog id. Merging the tables does not bridge them.
            expect(findPricingWithCustom('gemini-3.7-flash-high', custom)?.input).toBe(7.5);
            expect(findPricingWithCustom('MODEL_PLACEHOLDER_M298', custom)?.input).toBe(7.5);
            expect(findPricingWithCustom('Gemini 3.7 Flash (High)', custom)?.input).toBe(7.5);
            expect(findPricingWithCustom('gemini-3.8-flash-high', custom)?.input).toBe(7.5);
            expect(findPricingWithCustom('MODEL_PLACEHOLDER_M318', custom)?.input).toBe(7.5);
            expect(findPricingWithCustom('Gemini 3.8 Flash (High)', custom)?.input).toBe(7.5);
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

        it('recovers Gemini 3.8 Flash cost by localized display name', () => {
            const result = buildGMSummaryFromLedger(makeDay('Gemini 3.8 Flash (高)'));
            const expected = (500_000 * 0.75 + 150_000 * 3.75 + 1_500_000 * 0.075 + 50_000 * 3.75) / 1e6;
            expect(result.totalCost).toBeCloseTo(expected, 10);
            expect(result.costPerModel['Gemini 3.8 Flash (高)']).toBeCloseTo(expected, 10);
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


    describe('Gemini 3.6 Flash bounded promotional pricing window', () => {
        it.each([
            ['2026-07-22', 1.50, 7.50, 0.15],
            ['2026-08-12T23:59:59Z', 1.50, 7.50, 0.15],
            ['2026-08-13', 0.75, 3.75, 0.075],
            ['2026-08-13T00:00:00Z', 0.75, 3.75, 0.075],
            ['2026-11-22', 0.75, 3.75, 0.075],
            ['2026-12-31T23:59:59Z', 0.75, 3.75, 0.075],
            ['2027-01-01', 1.50, 7.50, 0.15],
            ['2027-01-01T00:00:00Z', 1.50, 7.50, 0.15],
        ] as const)('resolves exact rate at %s', (date, input, output, cacheRead) => {
            const pricing = findPricingForDate('gemini-3.6-flash-high', {}, date);
            expect(pricing).toMatchObject({ input, output, cacheRead, thinking: output });
        });

        it('returns null for invalid dates unless overridden by custom pricing', () => {
            expect(findPricingForDate('gemini-3.6-flash', {}, 'invalid')).toBeNull();
            expect(findPricingForDate('gemini-3.6-flash', { 'gemini-3.6-flash': TENFOLD_37_FLASH }, 'invalid'))
                .toBe(TENFOLD_37_FLASH);
        });
    });


    describe('formatUsdCost, formatUsdSavings & formatUsdPerMillion', () => {
        it('formats standard and per-call USD costs cleanly', () => {
            expect(formatUsdCost(0)).toBe('$0.00');
            expect(formatUsdCost(0.0042)).toBe('$0.0042');
            expect(formatUsdCost(0.27)).toBe('$0.27');
            expect(formatUsdCost(1.42)).toBe('$1.42');

            expect(formatUsdCost(0.065, { precision: 'call' })).toBe('$0.065');
            expect(formatUsdCost(0.0004, { precision: 'call' })).toBe('$0.0004');
            expect(formatUsdCost(1.25, { precision: 'call' })).toBe('$1.25');
        });

        it('handles negative, -0, NaN, Infinity, and tiny negative zero safely', () => {
            expect(formatUsdCost(-0)).toBe('$0.00');
            expect(formatUsdCost(-0.5)).toBe('$0.00');
            expect(formatUsdCost(-0.5, { allowNegative: true })).toBe('-$0.50');
            expect(formatUsdCost(Number.NaN)).toBe('—');
            expect(formatUsdCost(Number.POSITIVE_INFINITY)).toBe('—');
            expect(formatUsdCost(Number.NEGATIVE_INFINITY)).toBe('—');
            // Never emit -$0.0000 for tiny negatives that round to zero
            expect(formatUsdCost(-0.00001, { allowNegative: true })).toBe('$0.0000');
        });

        it('handles rounding across precision thresholds cleanly without $1.000 or $0.0100', () => {
            expect(formatUsdCost(0.00999, { precision: 'standard' })).toBe('$0.01');
            expect(formatUsdCost(0.00994, { precision: 'standard' })).toBe('$0.0099');
            expect(formatUsdCost(0.9999, { precision: 'call' })).toBe('$1.00');
            expect(formatUsdCost(0.00099, { precision: 'call' })).toBe('$0.001');
            expect(formatUsdPerMillion(0.9999)).toBe('$1/M');
        });

        it('formats USD cache savings with leading minus sign and returns em-dash for zero/invalid/sub-precision', () => {
            expect(formatUsdSavings(0.45)).toBe('-$0.45');
            expect(formatUsdSavings(0.0042)).toBe('-$0.0042');
            expect(formatUsdSavings(0.00001)).toBe('—');
            expect(formatUsdSavings(0)).toBe('—');
            expect(formatUsdSavings(-1)).toBe('—');
            expect(formatUsdSavings(Number.NaN)).toBe('—');
        });

        it('formats per-million USD list and effective blended rates cleanly', () => {
            expect(formatUsdPerMillion(3)).toBe('$3/M');
            expect(formatUsdPerMillion(0.15)).toBe('$0.15/M');
            expect(formatUsdPerMillion(0.075)).toBe('$0.075/M');
            expect(formatUsdPerMillion(0.14)).toBe('$0.14/M');
            expect(formatUsdPerMillion(-1)).toBe('—');
            expect(formatUsdPerMillion(Number.NaN)).toBe('—');
            expect(formatUsdPerMillion(Number.POSITIVE_INFINITY)).toBe('—');
        });
    });
});

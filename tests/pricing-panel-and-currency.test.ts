// Consolidated Domain Suite: Pricing Panel, 10-Currency Engine, Cost Backfill & Credits
import * as fs from 'fs';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    bindCustomFxRate,
    buildCurrencyExportRecord,
    classifyCurrencyAmount,
    convertCurrencyToUsd,
    convertUsdToCurrency,
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    type CurrencyCode,
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    getCurrencyDecimals,
    getCurrencySymbol,
    isCurrencyCode,
    isValidCustomFxRate,
    MAX_CUSTOM_FX_RATE,
    MIN_CUSTOM_FX_RATE,
    normalizeCurrencyCode,
    normalizeZero,
    resolveAppCurrencyConfig,
    resolveCurrencyConfig,
    resolveMicroCostThreshold,
    roundCurrencyAmount,
    sumAndConvertUsdAmounts,
    sumUsdAmounts,
    SUPPORTED_DISPLAY_CURRENCIES,
    switchDisplayCurrency,
} from '../src/core/currency';
import { getLanguage, type Language, setLanguageToState } from '../src/i18n';
import { buildPricingTabContent, getPricingTabStyles } from '../src/pricing-panel';
import { DEFAULT_PRICING, type ModelPricing, PricingStore } from '../src/pricing-store';
import type { GMModelStats, GMSummary } from '../src/gm-tracker';
import { DailyStore, type DailyStoreState, type GMModelCycleStats } from '../src/daily-store';
import { type DailyArchivalContext, performDailyArchival } from '../src/daily-archival';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { getDaysUntilBillingDay } from '../src/billing-day';
import {
    aiCreditTotal,
    currentAICredits,
    formatCreditTypeLabel,
    isCurrentCreditType,
    parseCreditBalance,
    summarizeAccountCredits,
} from '../src/account-credits';
import type { CreditInfo } from '../src/models';

describe('[core-currency]', () => {
    describe('src/core/currency — 10-currency data contract (D5)', () => {
        it('supports all 10 required currencies including CAD with disambiguated symbols and reference rates', () => {
            const expected: CurrencyCode[] = [
                'USD', 'CNY', 'EUR', 'JPY', 'GBP', 'KRW', 'HKD', 'TWD', 'CAD', 'AUD',
            ];
            expect(CURRENCY_CODES).toHaveLength(10);
            expect([...CURRENCY_CODES]).toEqual(expected);
            expect([...SUPPORTED_DISPLAY_CURRENCIES]).toEqual(expected);

            for (const code of expected) {
                expect(isCurrencyCode(code)).toBe(true);
                expect(isCurrencyCode(code.toLowerCase())).toBe(true);
                const preset = CURRENCY_PRESETS[code];
                expect(preset.code).toBe(code);
                expect(Number.isFinite(preset.defaultRatePerUsd)).toBe(true);
                expect(preset.defaultRatePerUsd).toBeGreaterThan(0);
                expect(preset.nameEn.length).toBeGreaterThan(0);
                expect(preset.nameZh.length).toBeGreaterThan(0);
            }

            // Symbol disambiguation contract
            expect(CURRENCY_PRESETS.USD.symbol).toBe('$');
            expect(CURRENCY_PRESETS.CAD.symbol).toBe('CA$');
            expect(CURRENCY_PRESETS.AUD.symbol).toBe('A$');
            expect(CURRENCY_PRESETS.HKD.symbol).toBe('HK$');
            expect(CURRENCY_PRESETS.TWD.symbol).toBe('NT$');
            expect(CURRENCY_PRESETS.CNY.symbol).toBe('¥');
            expect(CURRENCY_PRESETS.JPY.symbol).toBe('JP¥');
            expect(CURRENCY_PRESETS.JPY.compactSymbol).toBe('¥');
            expect(CURRENCY_PRESETS.EUR.symbol).toBe('€');
            expect(CURRENCY_PRESETS.GBP.symbol).toBe('£');
            expect(CURRENCY_PRESETS.KRW.symbol).toBe('₩');

            // Distinct dollar & yen symbols in standard display
            const standardSymbols = CURRENCY_CODES.map((c) => CURRENCY_PRESETS[c].symbol);
            expect(new Set(standardSymbols).size).toBe(10);
        });

        it('enforces TWD standard (2 decimals) vs compact (0 decimals) and JPY/KRW zero-decimal rules', () => {
            expect(getCurrencyDecimals(CURRENCY_PRESETS.TWD, 'standard')).toBe(2);
            expect(getCurrencyDecimals(CURRENCY_PRESETS.TWD, 'compact')).toBe(0);
            expect(getCurrencyDecimals(CURRENCY_PRESETS.JPY, 'standard')).toBe(0);
            expect(getCurrencyDecimals(CURRENCY_PRESETS.JPY, 'compact')).toBe(0);
            expect(getCurrencyDecimals(CURRENCY_PRESETS.KRW, 'standard')).toBe(0);
            expect(getCurrencyDecimals(CURRENCY_PRESETS.KRW, 'compact')).toBe(0);

            // TWD: standard keeps 2 decimals; compact rounds to 0 decimals
            expect(formatCurrencyAmount(1, 'TWD', { mode: 'standard' })).toBe('NT$32.40');
            expect(formatCurrencyAmount(1, 'TWD', { mode: 'compact' })).toBe('NT$32');
            expect(formatCurrencyAmount(0, 'TWD', { mode: 'standard' })).toBe('NT$0.00');
            expect(formatCurrencyAmount(0, 'TWD', { mode: 'compact' })).toBe('NT$0');

            // JPY & KRW: strictly 0 decimals in both standard and compact modes
            expect(formatCurrencyAmount(10, 'JPY', { mode: 'standard' })).toBe('JP¥1,540');
            expect(formatCurrencyAmount(10, 'JPY', { mode: 'compact' })).toBe('JP¥1,540');
            expect(formatCurrencyAmount(10, 'JPY', { mode: 'compact', symbolStyle: 'compact' })).toBe('¥1,540');
            expect(formatCurrencyAmount(10, 'KRW', { mode: 'standard' })).toBe('₩13,900');
            expect(formatCurrencyAmount(10, 'KRW', { mode: 'compact' })).toBe('₩13,900');

            // CAD & AUD disambiguation
            expect(formatCurrencyAmount(10, 'CAD')).toBe('CA$13.80');
            expect(formatCurrencyAmount(10, 'AUD')).toBe('A$15.40');
            expect(formatCurrencyAmount(10, 'USD')).toBe('$10.00');
            expect(getCurrencySymbol(CURRENCY_PRESETS.JPY, 'standard')).toBe('JP¥');
            expect(getCurrencySymbol(CURRENCY_PRESETS.JPY, 'compact')).toBe('¥');
        });

        it('dynamically converts micro-cost threshold into displayed currency (never hardcodes <0.01)', () => {
            // USD: $0.01 threshold
            const usdThresh = resolveMicroCostThreshold('USD');
            expect(usdThresh.displayThreshold).toBe(0.01);
            expect(usdThresh.lessThanLabel).toBe('<$0.01');
            expect(formatCurrencyAmount(0.004, 'USD')).toBe('<$0.01');
            expect(formatCurrencyAmount(0.01, 'USD')).toBe('$0.01');

            // JPY (154): $0.01 -> 1.54 JPY -> aligned to JP¥2
            const jpyThresh = resolveMicroCostThreshold('JPY');
            expect(jpyThresh.displayThreshold).toBe(2);
            expect(jpyThresh.lessThanLabel).toBe('<JP¥2');
            expect(formatCurrencyAmount(0.005, 'JPY')).toBe('<JP¥2'); // 0.77 JPY < 2
            expect(formatCurrencyAmount(0.02, 'JPY')).toBe('JP¥3');   // 3.08 JPY >= 2

            // KRW (1390): $0.01 -> 13.9 KRW -> aligned to ₩14
            const krwThresh = resolveMicroCostThreshold('KRW');
            expect(krwThresh.displayThreshold).toBe(14);
            expect(krwThresh.lessThanLabel).toBe('<₩14');
            expect(formatCurrencyAmount(0.005, 'KRW')).toBe('<₩14'); // 6.95 KRW < 14
            expect(formatCurrencyAmount(0.02, 'KRW')).toBe('₩28');   // 27.8 KRW >= 14

            // TWD (32.4): standard -> NT$0.32, compact -> NT$1 (never rounds positive to NT$0!)
            const twdStd = resolveMicroCostThreshold('TWD', { mode: 'standard' });
            const twdCmp = resolveMicroCostThreshold('TWD', { mode: 'compact' });
            expect(twdStd.displayThreshold).toBe(0.32);
            expect(twdStd.lessThanLabel).toBe('<NT$0.32');
            expect(twdCmp.displayThreshold).toBe(1);
            expect(twdCmp.lessThanLabel).toBe('<NT$1');
            expect(formatCurrencyAmount(0.005, 'TWD', { mode: 'standard' })).toBe('<NT$0.32');
            expect(formatCurrencyAmount(0.02, 'TWD', { mode: 'standard' })).toBe('NT$0.65');
            expect(formatCurrencyAmount(0.02, 'TWD', { mode: 'compact' })).toBe('<NT$1');
            expect(formatCurrencyAmount(0.05, 'TWD', { mode: 'compact' })).toBe('NT$2');

            // Custom FX rate dynamically rescales micro-cost threshold
            const customJpyThresh = resolveMicroCostThreshold({
                code: 'JPY',
                customRatePerUsd: 500,
                customFxCurrency: 'JPY',
            });
            expect(customJpyThresh.displayThreshold).toBe(5);
            expect(customJpyThresh.lessThanLabel).toBe('<JP¥5');
            expect(formatCurrencyAmount(0.005, { code: 'JPY', customRatePerUsd: 500, customFxCurrency: 'JPY' })).toBe('<JP¥5');
        });

        it('strictly distinguishes unknown, exact 0, -0, positive micro-cost, normal positive, and negative adjustments', () => {
            // 1. Unknown values
            for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
                expect(classifyCurrencyAmount(bad, 'USD').kind).toBe('unknown');
                expect(formatCurrencyAmount(bad, 'USD')).toBe('—');
                expect(formatCurrencyAmount(bad, 'JPY')).toBe('—');
            }
            // Overflowing conversion product -> unknown
            expect(classifyCurrencyAmount(1e308, 'KRW').kind).toBe('unknown');
            expect(formatCurrencyAmount(1e308, 'KRW')).toBe('—');
            expect(Number.isNaN(convertUsdToCurrency(1e308, 'KRW'))).toBe(true);

            // 2. Exact 0 and -0 normalization (never -$0.00 or -JP¥0)
            expect(Object.is(normalizeZero(-0), 0)).toBe(true);
            expect(classifyCurrencyAmount(0, 'USD').kind).toBe('zero');
            expect(classifyCurrencyAmount(-0, 'USD', { allowNegative: true }).kind).toBe('zero');
            expect(formatCurrencyAmount(0, 'USD')).toBe('$0.00');
            expect(formatCurrencyAmount(-0, 'USD', { allowNegative: true })).toBe('$0.00');
            expect(formatCurrencyAmount(-0, 'JPY', { allowNegative: true })).toBe('JP¥0');
            expect(formatCurrencyAmount(0, 'CNY', { zeroAsDash: true })).toBe('—');

            // 3. Positive sub-unit micro-cost never renders as exact 0 in threshold OR precise mode
            expect(classifyCurrencyAmount(1e-9, 'USD').kind).toBe('micro_positive');
            expect(formatCurrencyAmount(1e-9, 'USD')).toBe('<$0.01');
            expect(formatCurrencyAmount(1e-9, 'USD', { microStyle: 'precise' })).toBe('<$0.0001');
            expect(formatCurrencyAmount(0.0042, 'USD', { microStyle: 'precise' })).toBe('$0.0042');
            expect(formatCurrencyAmount(1e-9, 'JPY', { microStyle: 'precise' })).toBe('<JP¥0.01');
            expect(formatCurrencyAmount(0.005, 'JPY', { microStyle: 'precise' })).toBe('JP¥0.77');

            // 4. Negative adjustments
            // Default (allowNegative = false): clamped to exact zero
            expect(classifyCurrencyAmount(-5, 'USD').kind).toBe('zero');
            expect(formatCurrencyAmount(-5, 'USD')).toBe('$0.00');
            // allowNegative = true: normal negative & micro-negative preserved distinctly
            expect(classifyCurrencyAmount(-5, 'USD', { allowNegative: true }).kind).toBe('negative');
            expect(formatCurrencyAmount(-5, 'USD', { allowNegative: true })).toBe('-$5.00');
            expect(formatCurrencyAmount(-10, 'JPY', { allowNegative: true })).toBe('-JP¥1,540');
            expect(classifyCurrencyAmount(-0.002, 'USD', { allowNegative: true }).kind).toBe('micro_negative');
            expect(formatCurrencyAmount(-0.002, 'USD', { allowNegative: true })).toBe('>-$0.01');
            expect(formatCurrencyAmount(-0.002, 'JPY', { allowNegative: true })).toBe('>-JP¥2');
            expect(formatCurrencyAmount(-1e-9, 'USD', { allowNegative: true, microStyle: 'precise' })).toBe('>-$0.0001');
        });

        it('validates custom FX rate bounds and binds customFxRate to customFxCurrency across currency switches', () => {
            expect(isValidCustomFxRate(7.2)).toBe(true);
            expect(isValidCustomFxRate(MIN_CUSTOM_FX_RATE)).toBe(true);
            expect(isValidCustomFxRate(MAX_CUSTOM_FX_RATE)).toBe(true);
            expect(isValidCustomFxRate(0)).toBe(false);
            expect(isValidCustomFxRate(-1)).toBe(false);
            expect(isValidCustomFxRate(Number.NaN)).toBe(false);
            expect(isValidCustomFxRate(Number.POSITIVE_INFINITY)).toBe(false);
            expect(isValidCustomFxRate(MIN_CUSTOM_FX_RATE / 10)).toBe(false);
            expect(isValidCustomFxRate(MAX_CUSTOM_FX_RATE + 1)).toBe(false);

            // Matching customFxCurrency applies custom rate
            const cnyBound = resolveCurrencyConfig({
                code: 'CNY',
                customRatePerUsd: 7.5,
                customFxCurrency: 'CNY',
            });
            expect(cnyBound.isCustomRate).toBe(true);
            expect(cnyBound.ratePerUsd).toBe(7.5);
            expect(cnyBound.rateMismatchIgnored).toBe(false);

            // Switching to EUR while old customFxCurrency is CNY MUST ignore stale 7.5 rate!
            const eurMismatch = resolveCurrencyConfig({
                code: 'EUR',
                customRatePerUsd: 7.5,
                customFxCurrency: 'CNY',
            });
            expect(eurMismatch.isCustomRate).toBe(false);
            expect(eurMismatch.ratePerUsd).toBe(CURRENCY_PRESETS.EUR.defaultRatePerUsd);
            expect(eurMismatch.rateMismatchIgnored).toBe(true);

            // Explicit null customFxCurrency or requireBoundCurrency rejects unbound rates
            const unbound = resolveAppCurrencyConfig({
                displayCurrency: 'CAD',
                customFxRate: 1.5,
                customFxCurrency: null,
            });
            expect(unbound.isCustomRate).toBe(false);
            expect(unbound.ratePerUsd).toBe(CURRENCY_PRESETS.CAD.defaultRatePerUsd);
            expect(unbound.rateMismatchIgnored).toBe(true);

            const strictUnbound = resolveAppCurrencyConfig({
                displayCurrency: 'CAD',
                customFxRate: 1.5,
                requireBoundCurrency: true,
            });
            expect(strictUnbound.isCustomRate).toBe(false);
            expect(strictUnbound.rateMismatchIgnored).toBe(true);

            // USD never accepts custom FX rate
            const usdCustom = resolveCurrencyConfig({ code: 'USD', customRatePerUsd: 2 });
            expect(usdCustom.ratePerUsd).toBe(1);
            expect(usdCustom.isCustomRate).toBe(false);
            expect(usdCustom.rateMismatchIgnored).toBe(true);

            // Helpers: bindCustomFxRate & switchDisplayCurrency
            const bound = bindCustomFxRate('JPY', 160);
            expect(bound).toEqual({ displayCurrency: 'JPY', customFxRate: 160, customFxCurrency: 'JPY' });
            expect(bindCustomFxRate('USD', 2)).toEqual({ displayCurrency: 'USD', customFxRate: null, customFxCurrency: null });

            const keptSame = switchDisplayCurrency(bound, 'JPY');
            expect(keptSame).toEqual({ displayCurrency: 'JPY', customFxRate: 160, customFxCurrency: 'JPY' });

            const clearedOnSwitch = switchDisplayCurrency(bound, 'CAD');
            expect(clearedOnSwitch).toEqual({ displayCurrency: 'CAD', customFxRate: null, customFxCurrency: null });

            // Round-trip conversion & normalization
            expect(convertCurrencyToUsd(13.8, 'CAD')).toBeCloseTo(10, 6);
            expect(normalizeCurrencyCode('  cad ')).toBe('CAD');
            expect(normalizeCurrencyCode('UNKNOWN', 'EUR')).toBe('EUR');
        });

        it('enforces sum-before-round and preserves raw export records independently of display formatting', () => {
            // 10 micro items of $0.004 USD each: summing before rounding yields $0.04 (not 10x rounded $0.00!)
            const items = Array.from({ length: 10 }, () => 0.004);
            const summedUsd = sumUsdAmounts([...items, null, undefined, Number.NaN]);
            expect(summedUsd.hasValues).toBe(true);
            expect(summedUsd.validCount).toBe(10);
            expect(summedUsd.unknownCount).toBe(3);
            expect(summedUsd.totalUsd).toBeCloseTo(0.04, 10);

            const convertedSum = sumAndConvertUsdAmounts(items, 'JPY');
            // 0.04 * 154 = 6.16 JPY -> rounds once to 6 (whereas rounding each 0.616 -> 1 * 10 = 10 would drift +67%!)
            expect(convertedSum.convertedAmount).toBeCloseTo(6.16, 6);
            expect(convertedSum.roundedConvertedAmount).toBe(6);
            expect(convertedSum.formatted).toBe('JP¥6');

            // Empty / all-unknown sums return unknown
            const emptySum = sumAndConvertUsdAmounts([null, Number.NaN], 'CAD');
            expect(emptySum.hasValues).toBe(false);
            expect(emptySum.totalUsd).toBeNull();
            expect(emptySum.convertedAmount).toBeNull();
            expect(emptySum.formatted).toBe('—');

            // roundCurrencyAmount normalizes -0
            expect(Object.is(roundCurrencyAmount(-0.0001, 'USD'), 0)).toBe(true);

            // Structured export record preserves raw numeric USD, currency code, and applied FX rate
            const rec = buildCurrencyExportRecord(1.23456, {
                code: 'CAD',
                customRatePerUsd: 1.4,
                customFxCurrency: 'CAD',
            });
            expect(rec).toEqual({
                amountUsd: 1.23456,
                currency: 'CAD',
                fxRatePerUsd: 1.4,
                isCustomFxRate: true,
                convertedAmount: 1.23456 * 1.4,
                classification: 'positive',
                formatted: 'CA$1.73',
                formattedUsd: '$1.23',
            });

            // Dual formatting
            expect(formatDualCurrencyAmount(10, 'CAD')).toBe('CA$13.80 ($10.00)');
            expect(formatDualCurrencyAmount(10, 'USD')).toBe('$10.00');
            expect(formatDualCurrencyAmount(Number.NaN, 'CAD')).toBe('—');

            // Rate & call modes + rounding across 1,000 boundary (999.996 -> $1,000.00 / $1,000)
            expect(formatCurrencyAmount(999.996, 'USD')).toBe('$1,000.00');
            expect(formatCurrencyAmount(999.994, 'USD')).toBe('$999.99');
            expect(formatCurrencyAmount(999.996, 'USD', { mode: 'rate' })).toBe('$1,000');
            expect(formatCurrencyAmount(1000.5, 'USD', { mode: 'rate' })).toBe('$1,000.5');
            expect(formatCurrencyAmount(3, 'USD', { mode: 'rate' })).toBe('$3');
            expect(formatCurrencyAmount(0.15, 'USD', { mode: 'rate' })).toBe('$0.15');
            expect(formatCurrencyAmount(0.075, 'USD', { mode: 'rate' })).toBe('$0.075');
            expect(formatCurrencyAmount(0, 'USD', { mode: 'rate' })).toBe('$0');
            expect(formatCurrencyAmount(0.065, 'USD', { mode: 'call' })).toBe('$0.065');
            expect(formatCurrencyAmount(0.0004, 'USD', { mode: 'call' })).toBe('$0.0004');
            expect(formatCurrencyAmount(1e-8, 'USD', { mode: 'call' })).toBe('<$0.0001');
        });

        it('has zero vscode imports inside src/core/currency.ts', () => {
            const src = fs.readFileSync(path.resolve(__dirname, '../src/core/currency.ts'), 'utf8');
            expect(src).not.toMatch(/from\s+['"]vscode['"]|require\s*\(\s*['"]vscode['"]\s*\)/);
        });
    });
});

describe('[pricing-panel]', () => {
    const initialLanguage = getLanguage();

    const langState = { get: <T>(_k: string, fallback: T) => fallback, update: async () => {} };


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

        it('exposes both 5.5 family prices before a model has been called', () => {
            const html = buildPricingTabContent(null, new PricingStore());
            expect(html).toContain('Claude Opus 5.5');
            expect(html).toContain('Claude Sonnet 5.5');
            expect(html).toMatch(/data-model="claude-opus-5-5" data-field="input" data-original-value="4"/);
            expect(html).toMatch(/data-model="claude-sonnet-5-5" data-field="input" data-original-value="2"/);
            expect(html).toContain('5-minute TTL');
            expect(html).toContain('5 分钟');
        });

        it('shows generic unknown usage as unavailable with blank editable prices rather than free', () => {
            const html = buildPricingTabContent(
                makeSummary({ 'Future Unpriced Model (High)': makeModelStats('future-unpriced-high') }),
                new PricingStore(),
            );
            expect(html).toContain('Not available');
            expect(html).toContain('Price unavailable');
            expect(html).toContain('The total is incomplete');
            expect(html).toMatch(/data-model="future-unpriced-high" data-field="input" data-original-value=""[^>]*value=""/);
            expect(html).not.toContain('cost-chip-total">$0');
        });

        it('marks mixed totals incomplete without hiding known 5.5 family defaults', () => {
            const html = buildPricingTabContent(makeSummary({
                'Claude Opus 5.5 (High)': makeModelStats('claude-opus-5-5-high'),
                'Future Unpriced Model': makeModelStats('future-unpriced'),
            }), new PricingStore());
            expect(html).toContain('Partial total');
            expect(html).toContain('data-model="claude-sonnet-5-5"');
            expect(html).toContain('data-model="claude-opus-4-6"');
        });

        it('keeps a custom family row editable when a called tier covers that family', async () => {
            const store = new PricingStore();
            await store.set('claude-sonnet-5-5', { ...DEFAULT_PRICING['claude-sonnet-5-5'], input: 7 });
            const html = buildPricingTabContent(makeSummary({
                'Claude Sonnet 5.5 (High)': makeModelStats('claude-sonnet-5-5-high'),
            }), store);
            expect(html).toMatch(/data-model="claude-sonnet-5-5" data-field="input" data-original-value="7" data-was-custom="1"/);
        });

        it('keeps a family editor present when its first tier call arrives', () => {
            const store = new PricingStore();
            const before = buildPricingTabContent(null, store);
            const after = buildPricingTabContent(makeSummary({
                'Claude Opus 5.5 (High)': makeModelStats('claude-opus-5-5-high'),
            }), store);
            for (const html of [before, after]) {
                expect(html.match(/data-model="claude-opus-5-5" data-field="input"/g)).toHaveLength(1);
            }
            expect(after).toContain('data-model="claude-opus-5-5-high"');
        });

        it('does not duplicate an exact family editor when a family-only response is called', () => {
            const html = buildPricingTabContent(makeSummary({
                'Claude Opus 5.5': makeModelStats('claude-opus-5-5'),
            }), new PricingStore());
            expect(html.match(/data-model="claude-opus-5-5" data-field="input"/g)).toHaveLength(1);
        });

        it('renders USD-only Cost tab with Neon verified row/footnote, rate-change banner, thinking share, and cache savings', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-22T00:00:00Z'));
            try {
                const store = new PricingStore();
                const stats: GMModelStats = {
                    ...makeModelStats('gemini-4-neon'),
                    totalInputTokens: 1_000_000,
                    totalOutputTokens: 200_000,
                    totalThinkingTokens: 100_000,
                    totalCacheRead: 1_000_000,
                };
                const html = buildPricingTabContent(
                    makeSummary({ 'Gemini 4 Neon (XHigh)': stats }),
                    store,
                );

                // Strictly USD-only (no currency switcher or FX rate controls)
                expect(html).not.toContain('prc-currency-bar');
                expect(html).not.toContain('currency-toggle-group');
                expect(html).not.toMatch(/[\u00a5\uffe5]/);
                // Neon moved from UNVERIFIED_PRICE_KEYS into built-in DEFAULT_PRICING ($3)
                expect(html).toMatch(/data-model="gemini-4-neon" data-field="input" data-original-value="3"/);
                expect(html).not.toContain('data-model="gemini-4-neon-xhigh"');
                expect(html).toContain('https://aistudio.google.com/docs/whats-new-gemini-4-neon');
                // Upcoming rate-change banner (Carbon/Argon Dec 1 + Flash Jan 1)
                expect(html).toContain('class="rate-change-banner"');
                expect(html).toContain('2026-12-01');
                expect(html).toContain('2027-01-01');
                // USD formatting + Cache savings chip + Thinking share
                expect(html).toContain('$6.15');
                expect(html).toContain('$2.85');
                expect(html).toContain('cost-chip-saved');
                expect(html).toContain('cost-detail-saved');
                expect(html).toContain('cost-share-sub');
                // Updated Custom Orchestrator note
                expect(html).toContain('Custom Orchestrator Mode');
                expect(html).not.toContain('令牌');

                // After all cutovers pass (2027-02-01), rate-change banner disappears cleanly
                vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
                const postCutover = buildPricingTabContent(null, store);
                expect(postCutover).not.toContain('class="rate-change-banner"');
            } finally {
                vi.useRealTimers();
            }
        });

        it('renders positive USD savings without double negatives or zero-rounded dashes', async () => {
            await setLanguageToState('both', langState);
            try {
                const store = new PricingStore();
                const stats: GMModelStats = {
                    ...makeModelStats('gemini-4-neon'),
                    totalInputTokens: 100_000,
                    totalOutputTokens: 10_000,
                    totalThinkingTokens: 0,
                    totalCacheRead: 100_000, // savings = 0.1 * (3.0 - 0.15) = $0.285 -> $0.28
                };

                const html = buildPricingTabContent(
                    makeSummary({ 'Gemini 4 Neon (XHigh)': stats }),
                    store,
                );
                expect(html).toContain('cost-chip-saved');
                expect(html).toContain('$0.28');
                expect(html).not.toContain('-$0.28');
                expect(html).not.toMatch(/[\u00a5\uffe5]/);

                // Sub-threshold USD savings (< $0.0001) omit savings chips cleanly instead of showing '—'
                const tinyStats: GMModelStats = {
                    ...makeModelStats('gemini-4-neon'),
                    totalInputTokens: 1_000,
                    totalOutputTokens: 100,
                    totalThinkingTokens: 0,
                    totalCacheRead: 10, // savings = $0.0000285 -> omitted
                };
                const tinyHtml = buildPricingTabContent(
                    makeSummary({ 'Gemini 4 Neon (XHigh)': tinyStats }),
                    store,
                );
                expect(tinyHtml).not.toContain('cost-chip-saved');
                expect(tinyHtml).not.toContain('cost-detail-saved');
                expect(tinyHtml).not.toContain('Cache saved —');
                expect(tinyHtml).not.toContain('Saved —');

                const styles = getPricingTabStyles();
                expect(styles).not.toContain('.prc-currency-bar');
                expect(styles).not.toContain('.prc-fx-save-btn');
            } finally {
                await setLanguageToState(initialLanguage, langState);
            }
        });
    });
});

describe('[cost-backfill]', () => {
    // ─── Fixtures ────────────────────────────────────────────────────────────────

    const STORAGE_KEY = 'dailyStoreState';


    /** In-memory stand-in for vscode globalState. */
    function makeGlobalState() {
        const mem = new Map<string, unknown>();
        return {
            mem,
            get<T>(k: string, d: T): T { return mem.has(k) ? mem.get(k) as T : d; },
            update(k: string, v: unknown): Thenable<void> { mem.set(k, v); return Promise.resolve(); },
        };
    }


    /** A per-model row; `estimatedCost` is left absent unless given, as the archive does. */
    function row(over: Partial<GMModelCycleStats> = {}): GMModelCycleStats {
        const r: GMModelCycleStats = {
            calls: 10,
            credits: 0,
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            thinkingTokens: 0,
            avgTTFT: 0,
            cacheHitRate: 0,
            ...over,
        };
        if (over.estimatedCost === undefined) { delete r.estimatedCost; }
        return r;
    }


    function stateWith(
        days: Record<string, { cost?: number; models: Record<string, GMModelCycleStats> }>,
    ): DailyStoreState {
        const records: DailyStoreState['records'] = {};
        for (const [date, day] of Object.entries(days)) {
            records[date] = {
                date,
                cycles: [{
                    startTime: `${date}T00:00:00`,
                    endTime: `${date}T23:59:59`,
                    totalReasoning: 1, totalToolCalls: 1, totalErrors: 0,
                    totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                    modelNames: Object.keys(day.models),
                    ...(day.cost === undefined ? {} : { estimatedCost: day.cost }),
                    gmModelStats: day.models,
                }],
            };
        }
        return { version: 1, records };
    }


    function makeStore(state: DailyStoreState) {
        const globalState = makeGlobalState();
        globalState.mem.set(STORAGE_KEY, JSON.parse(JSON.stringify(state)));
        const store = new DailyStore();
        store.init(globalState);
        return { store, globalState };
    }


    /** DEFAULT_PRICING with the 3.7/3.8 Flash rows rewritten to their post-2027 rates. */
    function post2027Table(): Record<string, ModelPricing> {
        return {
            ...DEFAULT_PRICING,
            'gemini-3.7-flash': { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 1.875, thinking: 7.50 },
            'gemini-3.8-flash': { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 1.875, thinking: 7.50 },
        };
    }


    const firstRow = (store: DailyStore, date: string): GMModelCycleStats =>
        Object.values(store.getRecord(date)!.cycles[0].gmModelStats!)[0];


    // ─── Tests ───────────────────────────────────────────────────────────────────

    describe('DailyStore.backfillMissingCosts', () => {
        it('leaves a row that already has a cost byte-identical', () => {
            const state = stateWith({
                '2026-03-22': { cost: 1.23, models: { 'Claude Opus 4.6 (Thinking)': row({ estimatedCost: 1.23 }) } },
            });
            const { store } = makeStore(state);
            const before = JSON.stringify(store.serialize());

            expect(store.backfillMissingCosts({})).toBe(0);
            expect(JSON.stringify(store.serialize())).toBe(before);
        });

        it('fills a missing cost from tokens for a resolvable model', () => {
            // Claude Opus 4.6: $5 / 1M input, $25 / 1M output.
            // 1,000,000 in + 500,000 out = 5 + 12.5 = 17.5
            const { store } = makeStore(stateWith({
                '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
            }));

            expect(store.backfillMissingCosts({})).toBe(1);
            const filled = firstRow(store, '2026-03-22');
            expect(filled.estimatedCost).toBeCloseTo(17.5, 10);
            expect(filled.costBackfilled).toBe(true);
        });

        it('resolves a localized display name, as archived by a non-English UI', () => {
            const { store } = makeStore(stateWith({
                '2026-03-22': { models: { 'Claude Opus 4.6 (思考)': row() } },
            }));

            expect(store.backfillMissingCosts({})).toBe(1);
            expect(firstRow(store, '2026-03-22').estimatedCost).toBeCloseTo(17.5, 10);
        });

        it('resolves a raw placeholder key', () => {
            // MODEL_PLACEHOLDER_M298 = Gemini 3.7 Flash (High): $0.75 in / $3.75 out.
            const { store } = makeStore(stateWith({
                '2026-08-01': { models: { 'MODEL_PLACEHOLDER_M298': row({ outputTokens: 1_000_000 }) } },
            }));

            expect(store.backfillMissingCosts({})).toBe(1);
            expect(firstRow(store, '2026-08-01').estimatedCost).toBeCloseTo(4.5, 10);
        });

        it('leaves an unresolvable model absent rather than writing 0', () => {
            const { store } = makeStore(stateWith({
                '2026-03-22': { models: { 'Nonexistent Vendor Zx9': row() } },
            }));

            expect(store.backfillMissingCosts({})).toBe(0);
            const untouched = firstRow(store, '2026-03-22');
            expect(untouched.estimatedCost).toBeUndefined();
            expect('estimatedCost' in untouched).toBe(false);
            expect(untouched.costBackfilled).toBeUndefined();
        });

        it('leaves a resolvable model with no tokens absent rather than writing 0', () => {
            const { store } = makeStore(stateWith({
                '2026-03-22': {
                    models: {
                        'Claude Opus 4.6 (Thinking)': row({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }),
                    },
                },
            }));

            expect(store.backfillMissingCosts({})).toBe(0);
            expect(firstRow(store, '2026-03-22').estimatedCost).toBeUndefined();
        });

        it('prices a 2026 Gemini 3.7 Flash day at the introductory rate even after the table rolls to 2027', () => {
            // 1M in + 1M out. Introductory: 0.75 + 3.75 = 4.5. Post-2027 would be 1.5 + 7.5 = 9.
            const { store } = makeStore(stateWith({
                '2026-09-14': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
            }));

            expect(store.backfillMissingCosts({}, { basePricing: post2027Table() })).toBe(1);
            expect(firstRow(store, '2026-09-14').estimatedCost).toBeCloseTo(4.5, 10);
        });

        it('prices a 2027 Gemini 3.7 Flash day at the current table rate', () => {
            const { store } = makeStore(stateWith({
                '2027-01-01': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
            }));

            expect(store.backfillMissingCosts({}, { basePricing: post2027Table() })).toBe(1);
            expect(firstRow(store, '2027-01-01').estimatedCost).toBeCloseTo(9, 10);
        });

        it('prices a 2026 Gemini 3.8 Flash day at the introductory rate after the table rolls to 2027', () => {
            const { store } = makeStore(stateWith({
                '2026-09-05': { models: { 'MODEL_PLACEHOLDER_M318': row({ outputTokens: 1_000_000 }) } },
            }));

            expect(store.backfillMissingCosts({}, { basePricing: post2027Table() })).toBe(1);
            expect(firstRow(store, '2026-09-05').estimatedCost).toBeCloseTo(4.5, 10);
        });

        it('prices a 2027 Gemini 3.8 Flash day at the current table rate', () => {
            const { store } = makeStore(stateWith({
                '2027-01-01': { models: { 'Gemini 3.8 Flash (高)': row({ outputTokens: 1_000_000 }) } },
            }));

            expect(store.backfillMissingCosts({}, { basePricing: post2027Table() })).toBe(1);
            expect(firstRow(store, '2027-01-01').estimatedCost).toBeCloseTo(9, 10);
        });

        it('lets a user custom price outrank the introductory special case', () => {
            const custom: Record<string, ModelPricing> = {
                'Gemini 3.7 Flash (High)': { input: 2, output: 4, cacheRead: 0, cacheWrite: 0, thinking: 4 },
            };
            const { store } = makeStore(stateWith({
                '2026-09-14': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
            }));

            expect(store.backfillMissingCosts(custom)).toBe(1);
            expect(firstRow(store, '2026-09-14').estimatedCost).toBeCloseTo(6, 10);
        });

        it('moves the cycle total by exactly the sum of the rows it filled', () => {
            const { store } = makeStore(stateWith({
                '2026-03-22': {
                    cost: 100,
                    models: {
                        'Claude Opus 4.6 (Thinking)': row(),                          // 17.5, filled
                        'Claude Sonnet 4.6': row({ estimatedCost: 100 }),             // already priced
                        'Nonexistent Vendor Zx9': row(),                              // unresolvable
                        'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }),  // 4.5, filled
                    },
                },
            }));

            expect(store.backfillMissingCosts({})).toBe(2);
            const cycle = store.getRecord('2026-03-22')!.cycles[0];
            expect(cycle.estimatedCost).toBeCloseTo(100 + 17.5 + 4.5, 10);

            // The month rollup and the per-model rollup must agree about the same day.
            const breakdown = store.getMonthCostBreakdown(2026, 3);
            const rowSum = breakdown.models.reduce((s, m) => s + m.totalCost, 0);
            expect(rowSum).toBeCloseTo(breakdown.grandTotal, 10);
        });

        it('sets a cycle total that was absent when it fills rows under it', () => {
            const { store } = makeStore(stateWith({
                '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
            }));

            store.backfillMissingCosts({});
            expect(store.getRecord('2026-03-22')!.cycles[0].estimatedCost).toBeCloseTo(17.5, 10);
        });

        it('refuses a cycle whose total already covers its unpriced rows', () => {
            // The legacy archival path keyed per-model costs by the normalized display name while the
            // rows are keyed by the raw model id, so when those disagreed every row landed without a
            // cost even though the day total held the full amount. Adding to that total doubles the
            // day permanently — a second run finds every row priced and reports nothing left to fix.
            const { store } = makeStore(stateWith({
                '2026-03-22': { cost: 100, models: { 'Claude Opus 4.6 (Thinking)': row() } },
            }));

            expect(store.backfillMissingCosts({})).toBe(0);
            const cycle = store.getRecord('2026-03-22')!.cycles[0];
            expect(cycle.estimatedCost).toBe(100);
            expect(firstRow(store, '2026-03-22').estimatedCost).toBeUndefined();
        });

        it('still fills when the priced rows already account for the whole total', () => {
            const { store } = makeStore(stateWith({
                '2026-03-22': {
                    cost: 100,
                    models: {
                        'Claude Sonnet 4.6': row({ estimatedCost: 100 }),
                        'Claude Opus 4.6 (Thinking)': row(),
                    },
                },
            }));

            expect(store.backfillMissingCosts({})).toBe(1);
            expect(store.getRecord('2026-03-22')!.cycles[0].estimatedCost).toBeCloseTo(117.5, 10);
        });

        it('is idempotent — running twice equals running once', () => {
            const state = stateWith({
                '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
                '2026-03-23': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
                '2026-03-24': { models: { 'Nonexistent Vendor Zx9': row() } },
            });

            const once = makeStore(state).store;
            expect(once.backfillMissingCosts({})).toBe(2);
            const afterOne = JSON.stringify(once.serialize());

            const twice = makeStore(state).store;
            twice.backfillMissingCosts({});
            expect(twice.backfillMissingCosts({})).toBe(0);
            expect(JSON.stringify(twice.serialize())).toBe(afterOne);
        });

        it('persists exactly once, keeping version 1 so no reader discards the blob', () => {
            const { store, globalState } = makeStore(stateWith({
                '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
            }));

            store.backfillMissingCosts({});
            const saved = globalState.mem.get(STORAGE_KEY) as DailyStoreState;
            expect(saved.version).toBe(1);
            const savedRow = Object.values(saved.records['2026-03-22'].cycles[0].gmModelStats!)[0];
            expect(savedRow.estimatedCost).toBeCloseTo(17.5, 10);
            expect(savedRow.costBackfilled).toBe(true);
        });

        it('does not touch storage when there is nothing to fill', () => {
            const { store, globalState } = makeStore(stateWith({
                '2026-03-22': { cost: 1.23, models: { 'Claude Opus 4.6 (Thinking)': row({ estimatedCost: 1.23 }) } },
            }));
            const before = JSON.stringify(globalState.mem.get(STORAGE_KEY));

            expect(store.backfillMissingCosts({})).toBe(0);
            expect(JSON.stringify(globalState.mem.get(STORAGE_KEY))).toBe(before);
        });

        it('tolerates a day with no gmModelStats at all', () => {
            const { store } = makeStore({
                version: 1,
                records: {
                    '2026-03-22': {
                        date: '2026-03-22',
                        cycles: [{
                            startTime: '2026-03-22T00:00:00', endTime: '2026-03-22T23:59:59',
                            totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                            totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0, modelNames: [],
                        }],
                    },
                },
            });

            expect(store.backfillMissingCosts({})).toBe(0);
        });
    });


    // ─── The archival side of the same invariant ─────────────────────────────────

    describe('legacy-path archival keys per-model costs so the backfill has nothing to double', () => {
        function makeGMSummary(rawKey: string, responseModel: string): GMSummary {
            const ms: GMModelStats = {
                callCount: 10, stepsCovered: 0,
                totalInputTokens: 1_000_000, totalOutputTokens: 500_000, totalThinkingTokens: 0,
                totalCacheRead: 0, totalCacheCreation: 0, totalCredits: 0,
                avgTTFT: 0, minTTFT: 0, maxTTFT: 0, avgStreaming: 0, cacheHitRate: 0,
                responseModel, apiProvider: '',
                completionConfig: {} as never, hasSystemPrompt: false,
                toolCount: 0, promptSectionTitles: [],
                totalRetries: 0, errorCount: 0,
                creditCallCount: 0, exactCallCount: 0,
                placeholderOnlyCalls: 0, contextWindowCapacity: 0,
            };
            return {
                conversations: [], modelBreakdown: { [rawKey]: ms },
                totalCalls: 10, totalStepsCovered: 0, totalCredits: 0,
                totalInputTokens: 1_000_000, totalOutputTokens: 500_000,
                totalCacheRead: 0, totalCacheCreation: 0, totalThinkingTokens: 0,
                contextGrowth: [], fetchedAt: '2026-08-01T00:00:00.000Z',
                totalRetryTokens: 0, totalRetryCredits: 0, totalRetryCount: 0,
                latestTokenBreakdown: [], stopReasonCounts: {}, retryErrorCodes: {},
                recentErrors: [], toolCallCounts: {}, uniqueErrors: [],
                recentErrorEntries: [], toolCatalog: [],
            } as GMSummary;
        }

        // The per-model cost used to be keyed by the normalized display name while the rows are keyed
        // by the raw model id. Whenever those disagreed the rows were archived with no cost at all
        // while the day total held the full amount — which the backfill then read as "unpriced" and
        // added a second time, doubling the day permanently and leaving no trace to find it by.
        it('writes the cost under the raw breakdown key, not the display name', () => {
            const dailyStore = new DailyStore();
            dailyStore.init(makeGlobalState());
            const pricingStore = new PricingStore();
            pricingStore.init(makeGlobalState());

            const gmSummary = makeGMSummary('MODEL_PLACEHOLDER_M298', 'gemini-3.7-flash-high');
            const ctx = {
                activityTracker: {
                    getSummary: () => ({
                        totalReasoning: 1, totalToolCalls: 1, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: [], modelStats: {},
                    }),
                    archiveAndReset: () => null,
                },
                gmTracker: {
                    reset: () => {}, getDetailedSummary: () => null,
                    getCachedSummary: () => gmSummary, getArchivalSummary: () => gmSummary,
                },
                dailyStore, pricingStore,
                lastGMSummary: gmSummary, persistedModelDNA: {},
                lastArchivalDateKey: '2026-08-01', dailyLedger: null,
                persist: () => {}, log: () => {},
            } as unknown as DailyArchivalContext;

            performDailyArchival(ctx, false, new Date(2026, 7, 2, 1, 0, 0));

            const cycle = dailyStore.getRecord('2026-08-01')!.cycles[0];
            const expected = (1_000_000 * 0.75 + 500_000 * 3.75) / 1e6;
            expect(cycle.gmModelStats!['MODEL_PLACEHOLDER_M298'].estimatedCost).toBeCloseTo(expected, 10);
            expect(cycle.estimatedCost).toBeCloseTo(expected, 10);

            // Nothing left for the backfill, so the day total cannot move.
            expect(dailyStore.backfillMissingCosts({})).toBe(0);
            expect(dailyStore.getRecord('2026-08-01')!.cycles[0].estimatedCost).toBeCloseTo(expected, 10);
        });
    });
});

describe('[image-cost-warning]', () => {
    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    afterEach(() => setLanguageToState('both', state));


    describe('unmetered image costs', () => {
        it.each(['en', 'zh', 'both'] as Language[])('marks known text fees as partial when an image tool ran in %s', async language => {
            await setLanguageToState(language, state);
            const call = parseGMEntry({ stepIndices: [1], chatModel: { model: 'MODEL_PLACEHOLDER_M419',
                responseModel: 'gemini-4-argon', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
                chatStartMetadata: { createdAt: '2026-10-31T00:00:00Z' } } });
            const gm = buildSummaryFromConversations([{ cascadeId: 'test', title: 'Fixture', totalSteps: 3,
                coveredSteps: 1, coverageRate: 1 / 3, calls: [call], checkpointSummaries: [] }], '2026-10-31T00:00:01Z')!;
            const store = new PricingStore();
            const html = buildPricingTabContent(gm, store, undefined, undefined, undefined, true);
            expect(html).toContain('image-cost-unavailable');
            expect(html).toContain(language === 'zh' ? '未计入图片生成费用' : 'exclude image-generation fees');
            expect(html).toContain(language === 'zh' ? '已知小计' : 'Partial total');
            expect(html).toContain('$12.00');
            expect(html).not.toContain('data-tooltip="Avg per Call"');
            expect(html).toContain('https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image');
            expect(store.calculateCosts(gm).grandTotal).toBe(12);
        });

        it('does not show an image-cost warning for ordinary text or image-input conversations', () => {
            expect(buildPricingTabContent(null, new PricingStore())).not.toContain('image-cost-unavailable');
        });
    });
});

describe('[billing-day]', () => {
    describe('getDaysUntilBillingDay', () => {
        it('counts calendar days across DST boundaries', () => {
            const now = new Date(2026, 2, 31, 0, 30);

            expect(getDaysUntilBillingDay(30, now)).toBe(30);
        });
    });
});

describe('[account-credits]', () => {
    const initialLanguage = getLanguage();

    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };


    function credit(creditType: string, creditAmount: number | null): CreditInfo {
        return { creditType, creditAmount, minimumCreditAmountForUsage: 1 };
    }


    beforeEach(async () => { await setLanguageToState('en', state); });

    afterEach(async () => { await setLanguageToState(initialLanguage, state); });


    describe('current account credit balances', () => {
        it.each([undefined, null, '', '  ', '3 credits', NaN, Infinity, -1])('keeps unavailable or invalid balance %s unknown', value => {
            expect(parseCreditBalance(value)).toBeNull();
        });

        it('preserves explicit zero and numeric server strings', () => {
            expect(parseCreditBalance(0)).toBe(0);
            expect(parseCreditBalance('0')).toBe(0);
            expect(parseCreditBalance('12.5')).toBe(12.5);
            expect(aiCreditTotal([credit('GOOGLE_ONE_AI', 0)])).toBe(0);
        });

        it('ignores legacy and unspecified credit kinds and deduplicates equivalent entries', () => {
            const rows = [
                credit('CREDIT_TYPE_PROMPT', 50_000),
                credit('FLOW', 150_000),
                credit('PROMPT_CREDITS', 100),
                credit('FLOW_CREDITS', 200),
                credit('CREDIT_TYPE_UNSPECIFIED', null),
                credit('CREDIT_TYPE_GOOGLE_ONE_AI', 1200),
                credit('google_one_ai', 1200),
            ];
            expect(isCurrentCreditType('CREDIT_TYPE_UNSPECIFIED')).toBe(false);
            expect(isCurrentCreditType('PROMPT_CREDITS')).toBe(false);
            expect(currentAICredits(rows)).toEqual([credit('GOOGLE_ONE_AI', 1200)]);
            expect(aiCreditTotal(rows)).toBe(1200);
        });

        it('leaves conflicting and unreported buckets unknown', () => {
            expect(aiCreditTotal([credit('GOOGLE_ONE_AI', null)])).toBeNull();
            expect(aiCreditTotal([credit('GOOGLE_ONE_AI', 5), credit('CREDIT_TYPE_GOOGLE_ONE_AI', 10)])).toBeNull();
            expect(aiCreditTotal([])).toBeNull();
        });

        it.each([
            ['en', 'Google AI credits', 'CUSTOM POOL'],
            ['zh', 'Google AI 积分', 'CUSTOM POOL'],
            ['both', 'Google AI credits / Google AI 积分', 'CUSTOM POOL'],
        ] as Array<[Language, string, string]>)('formats known and unknown credit labels cleanly in %s without duplication', async (lang, expectedKnown, expectedCustom) => {
            await setLanguageToState(lang, state);
            expect(formatCreditTypeLabel('CREDIT_TYPE_GOOGLE_ONE_AI')).toBe(expectedKnown);
            expect(formatCreditTypeLabel('CREDIT_TYPE_CUSTOM_POOL')).toBe(expectedCustom);
        });

        it('summarizes credits and billing-day expiry cleanly while distinguishing 0 from unknown', () => {
            const now = new Date(2026, 10, 19);
            const zeroSummary = summarizeAccountCredits([credit('GOOGLE_ONE_AI', 0)], 25, now);
            expect(zeroSummary).toMatchObject({ total: 0, known: true, billingDay: 25, daysUntilExpiry: 6 });

            const unknownSummary = summarizeAccountCredits([credit('CREDIT_TYPE_PROMPT', 99)], 40, now);
            expect(unknownSummary).toMatchObject({ entries: [], total: null, known: false, billingDay: 0, daysUntilExpiry: null });
        });
    });
});

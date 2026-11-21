import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CNY_EXCHANGE_RATE,
    DEFAULT_DISPLAY_CURRENCY,
    MAX_CNY_EXCHANGE_RATE,
    MIN_CNY_EXCHANGE_RATE,
    convertUsdToCny,
    formatCurrencyCost,
    formatCurrencySavings,
    formatPerMillionRate,
    normalizeCurrencyPrefs,
    parseDisplayCurrency,
    sanitizeCnyExchangeRate,
} from '../src/currency';

describe('currency parsing & exchange rate sanitization', () => {
    it('parses display currency safely with case-insensitive matching', () => {
        expect(parseDisplayCurrency('USD')).toBe('USD');
        expect(parseDisplayCurrency('usd')).toBe('USD');
        expect(parseDisplayCurrency(' CNY ')).toBe('CNY');
        expect(parseDisplayCurrency('Both')).toBe('both');
        expect(parseDisplayCurrency('EUR')).toBe(DEFAULT_DISPLAY_CURRENCY);
        expect(parseDisplayCurrency(null)).toBe(DEFAULT_DISPLAY_CURRENCY);
        expect(parseDisplayCurrency(123)).toBe(DEFAULT_DISPLAY_CURRENCY);
    });

    it('validates and clamps CNY exchange rate without NaN/Infinity/negative leaks', () => {
        expect(sanitizeCnyExchangeRate(7.2)).toBe(7.2);
        expect(sanitizeCnyExchangeRate('6.85')).toBe(6.85);
        expect(sanitizeCnyExchangeRate(0.001)).toBe(MIN_CNY_EXCHANGE_RATE);
        expect(sanitizeCnyExchangeRate(99999)).toBe(MAX_CNY_EXCHANGE_RATE);
        for (const bad of [0, -7.2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '', 'abc', null, undefined]) {
            expect(sanitizeCnyExchangeRate(bad), String(bad)).toBe(DEFAULT_CNY_EXCHANGE_RATE);
        }
    });

    it('normalizes partial preferences', () => {
        expect(normalizeCurrencyPrefs()).toEqual({ currency: 'USD', cnyRate: 7.2 });
        expect(normalizeCurrencyPrefs({ currency: 'CNY', cnyRate: 7.15 })).toEqual({ currency: 'CNY', cnyRate: 7.15 });
    });

    it('converts USD to CNY safely', () => {
        expect(convertUsdToCny(1, 7.2)).toBeCloseTo(7.2, 10);
        expect(convertUsdToCny(-1, 7.2)).toBe(0);
        expect(convertUsdToCny(-1, 7.2, true)).toBeCloseTo(-7.2, 10);
        expect(convertUsdToCny(Number.NaN, 7.2)).toBe(0);
        expect(convertUsdToCny(Number.POSITIVE_INFINITY, 7.2)).toBe(0);
    });
});

describe('formatCurrencyCost, formatCurrencySavings & formatPerMillionRate', () => {
    it('formats standard costs in USD, CNY, and both modes', () => {
        expect(formatCurrencyCost(0)).toBe('$0.00');
        expect(formatCurrencyCost(0.0042)).toBe('$0.0042');
        expect(formatCurrencyCost(0.27)).toBe('$0.27');
        expect(formatCurrencyCost(1.42)).toBe('$1.42');

        expect(formatCurrencyCost(0.27, { currency: 'CNY', cnyRate: 7.2 })).toBe('¥1.94');
        expect(formatCurrencyCost(0.27, { currency: 'both', cnyRate: 7.2 })).toBe('$0.27 (¥1.94)');
        expect(formatCurrencyCost(0.27, { currency: 'both', cnyRate: 7.2 }, { bothFormat: 'slash' })).toBe('$0.27 / ¥1.94');
    });

    it('formats per-call precision cleanly (matching ¥0.402 / ¥0.465 telemetry rows)', () => {
        expect(formatCurrencyCost(0.05984, { currency: 'CNY', cnyRate: 6.72 }, { precision: 'call' })).toBe('¥0.402');
        expect(formatCurrencyCost(0.06956, { currency: 'CNY', cnyRate: 6.68 }, { precision: 'call' })).toBe('¥0.465');
        expect(formatCurrencyCost(0.065, { currency: 'USD' }, { precision: 'call' })).toBe('$0.065');
        expect(formatCurrencyCost(0.0004, { currency: 'USD' }, { precision: 'call' })).toBe('$0.0004');
        expect(formatCurrencyCost(1.25, { currency: 'USD' }, { precision: 'call' })).toBe('$1.25');
    });

    it('handles negative, -0, NaN, and Infinity safely', () => {
        expect(formatCurrencyCost(-0)).toBe('$0.00');
        expect(formatCurrencyCost(-0.5)).toBe('$0.00');
        expect(formatCurrencyCost(-0.5, { currency: 'USD' }, { allowNegative: true })).toBe('-$0.50');
        expect(formatCurrencyCost(-0.5, { currency: 'CNY', cnyRate: 7.2 }, { allowNegative: true })).toBe('-¥3.60');
        expect(formatCurrencyCost(Number.NaN)).toBe('—');
        expect(formatCurrencyCost(Number.POSITIVE_INFINITY)).toBe('—');
        expect(formatCurrencyCost(Number.NEGATIVE_INFINITY)).toBe('—');
        // Never emit -$0.0000 for tiny negatives that round to zero, and never emit ¥Infinity on CNY overflow
        expect(formatCurrencyCost(-0.00001, { currency: 'USD' }, { allowNegative: true })).toBe('$0.0000');
        expect(formatCurrencyCost(1e308, { currency: 'CNY', cnyRate: 7.2 })).toBe('—');
        expect(formatCurrencyCost(1e308, { currency: 'both', cnyRate: 7.2 })).toBe('—');
        expect(formatPerMillionRate(1e308, { currency: 'CNY', cnyRate: 7.2 })).toBe('—');
    });

    it('handles rounding across precision thresholds cleanly without $1.000 or $0.0100', () => {
        expect(formatCurrencyCost(0.00999, { currency: 'USD' }, { precision: 'standard' })).toBe('$0.01');
        expect(formatCurrencyCost(0.00994, { currency: 'USD' }, { precision: 'standard' })).toBe('$0.0099');
        expect(formatCurrencyCost(0.9999, { currency: 'USD' }, { precision: 'call' })).toBe('$1.00');
        expect(formatCurrencyCost(0.00099, { currency: 'USD' }, { precision: 'call' })).toBe('$0.001');
        expect(formatPerMillionRate(0.9999, { currency: 'USD' })).toBe('$1/M');
    });

    it('formats cache savings with leading minus sign and returns em-dash for zero/invalid/sub-precision', () => {
        expect(formatCurrencySavings(0.45, { currency: 'USD' })).toBe('-$0.45');
        expect(formatCurrencySavings(0.45, { currency: 'CNY', cnyRate: 7.2 })).toBe('-¥3.24');
        expect(formatCurrencySavings(0.45, { currency: 'both', cnyRate: 7.2 })).toBe('-$0.45 (-¥3.24)');
        expect(formatCurrencySavings(0.00001, { currency: 'USD' })).toBe('—');
        expect(formatCurrencySavings(0)).toBe('—');
        expect(formatCurrencySavings(-1)).toBe('—');
        expect(formatCurrencySavings(Number.NaN)).toBe('—');
    });

    it('formats per-million list and effective blended rates cleanly', () => {
        expect(formatPerMillionRate(3, { currency: 'USD' })).toBe('$3/M');
        expect(formatPerMillionRate(0.15, { currency: 'USD' })).toBe('$0.15/M');
        expect(formatPerMillionRate(0.075, { currency: 'USD' })).toBe('$0.075/M');
        expect(formatPerMillionRate(0.14, { currency: 'USD' })).toBe('$0.14/M');
        expect(formatPerMillionRate(3, { currency: 'CNY', cnyRate: 7.2 })).toBe('¥21.6/M');
        expect(formatPerMillionRate(0.15, { currency: 'both', cnyRate: 7.2 })).toBe('$0.15/M (¥1.08/M)');
        expect(formatPerMillionRate(-1)).toBe('—');
        expect(formatPerMillionRate(Number.NaN)).toBe('—');
    });
});

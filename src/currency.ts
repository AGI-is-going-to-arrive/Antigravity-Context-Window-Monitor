// ─── Currency Formatting Utility ──────────────────────────────────────────────
// Pure offline-first currency formatting for USD, CNY, and dual display.
// Zero VS Code UI dependencies and zero external network requests.

export type DisplayCurrency = 'USD' | 'CNY' | 'both';

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'USD';
export const DEFAULT_CNY_EXCHANGE_RATE = 7.2;
export const MIN_CNY_EXCHANGE_RATE = 0.01;
export const MAX_CNY_EXCHANGE_RATE = 1000;

export interface CurrencyPrefs {
    currency: DisplayCurrency;
    cnyRate: number;
}

export interface FormatCostOptions {
    /**
     * - `'standard'` (default): totals & panels ($0.00, $0.0042 for <0.01, $1.42 for >=0.01)
     * - `'call'`: per-call telemetry ($0.00, $0.0004 for <0.001, $0.065 / ¥0.465 for <1, $1.25 for >=1)
     * - `'rate'`: list or effective per-1M rate ($3, $0.15, $0.075, ¥21.60)
     */
    precision?: 'standard' | 'call' | 'rate';
    /** How `'both'` joins USD and CNY. Default `'paren'` -> `$0.27 (¥1.94)`. */
    bothFormat?: 'paren' | 'slash';
    /** Preserve negative sign instead of clamping negative numbers to 0. */
    allowNegative?: boolean;
}

/** Parse display currency setting safely, falling back to `'USD'`. */
export function parseDisplayCurrency(value: unknown): DisplayCurrency {
    if (typeof value !== 'string') { return DEFAULT_DISPLAY_CURRENCY; }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'usd') { return 'USD'; }
    if (normalized === 'cny') { return 'CNY'; }
    if (normalized === 'both') { return 'both'; }
    return DEFAULT_DISPLAY_CURRENCY;
}

/** Validate and clamp a USD-to-CNY reference exchange rate safely. */
export function sanitizeCnyExchangeRate(value: unknown): number {
    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : Number.NaN);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_CNY_EXCHANGE_RATE;
    }
    if (parsed < MIN_CNY_EXCHANGE_RATE) { return MIN_CNY_EXCHANGE_RATE; }
    if (parsed > MAX_CNY_EXCHANGE_RATE) { return MAX_CNY_EXCHANGE_RATE; }
    return parsed;
}

/** Normalize partial/untrusted currency preferences. */
export function normalizeCurrencyPrefs(prefs?: Partial<CurrencyPrefs>): CurrencyPrefs {
    return {
        currency: parseDisplayCurrency(prefs?.currency),
        cnyRate: sanitizeCnyExchangeRate(prefs?.cnyRate),
    };
}

/** Convert a USD amount to CNY using a validated exchange rate. */
export function convertUsdToCny(
    usdAmount: number,
    cnyRate: unknown = DEFAULT_CNY_EXCHANGE_RATE,
    allowNegative = false,
): number {
    if (!Number.isFinite(usdAmount)) { return 0; }
    const effectiveUsd = !allowNegative && usdAmount < 0 ? 0 : usdAmount;
    if (effectiveUsd === 0) { return 0; }
    return effectiveUsd * sanitizeCnyExchangeRate(cnyRate);
}

function formatNumericAmount(
    absAmount: number,
    precision: 'standard' | 'call' | 'rate',
): string {
    if (absAmount === 0) {
        return precision === 'rate' ? '0' : '0.00';
    }
    if (precision === 'rate') {
        if (absAmount < 0.01 && Number(absAmount.toFixed(4)) < 0.01) {
            return trimTrailingZeros(absAmount.toFixed(4));
        }
        if (absAmount < 1 && Number(absAmount.toFixed(3)) < 1) {
            return trimTrailingZeros(absAmount.toFixed(3), 2);
        }
        return trimTrailingZeros(absAmount.toFixed(2));
    }
    if (precision === 'call') {
        if (absAmount < 0.001 && Number(absAmount.toFixed(4)) < 0.001) {
            return absAmount.toFixed(4);
        }
        if (absAmount < 1 && Number(absAmount.toFixed(3)) < 1) {
            return absAmount.toFixed(3);
        }
        return absAmount.toFixed(2);
    }
    // 'standard'
    if (absAmount < 0.01 && Number(absAmount.toFixed(4)) < 0.01) {
        return absAmount.toFixed(4);
    }
    return absAmount.toFixed(2);
}

function trimTrailingZeros(fixed: string, minDecimals = 0): string {
    if (!fixed.includes('.')) { return fixed; }
    const [whole, frac] = fixed.split('.');
    let end = frac.length;
    while (end > minDecimals && frac[end - 1] === '0') {
        end--;
    }
    return end === 0 ? whole : `${whole}.${frac.slice(0, end)}`;
}

function formatSingleCurrency(
    amount: number,
    symbol: '$' | '¥',
    precision: 'standard' | 'call' | 'rate',
    allowNegative: boolean,
): string {
    if (!Number.isFinite(amount)) { return '—'; }
    const normalized = !allowNegative && amount < 0 ? 0 : (Object.is(amount, -0) ? 0 : amount);
    const formatted = formatNumericAmount(Math.abs(normalized), precision);
    const isRoundedZero = /^0(?:\.0+)?$/.test(formatted);
    const sign = normalized < 0 && !isRoundedZero ? '-' : '';
    return `${sign}${symbol}${formatted}`;
}

/**
 * Format a USD cost into the configured display currency (`USD`, `CNY`, or `both`).
 * Returns `'—'` for non-finite inputs (`NaN`, `Infinity`, `-Infinity`) or overflow after conversion.
 */
export function formatCurrencyCost(
    usdAmount: number,
    prefs?: Partial<CurrencyPrefs>,
    options: FormatCostOptions = {},
): string {
    if (!Number.isFinite(usdAmount)) { return '—'; }
    const { currency, cnyRate } = normalizeCurrencyPrefs(prefs);
    const precision = options.precision ?? 'standard';
    const bothFormat = options.bothFormat ?? 'paren';
    const allowNegative = options.allowNegative ?? false;

    const effectiveUsd = !allowNegative && usdAmount < 0 ? 0 : usdAmount;
    const usdStr = formatSingleCurrency(effectiveUsd, '$', precision, allowNegative);
    if (currency === 'USD') {
        return usdStr;
    }
    const cnyValue = convertUsdToCny(effectiveUsd, cnyRate, allowNegative);
    if (!Number.isFinite(cnyValue)) { return '—'; }
    const cnyStr = formatSingleCurrency(cnyValue, '¥', precision, allowNegative);
    if (currency === 'CNY') {
        return cnyStr;
    }
    return bothFormat === 'slash' ? `${usdStr} / ${cnyStr}` : `${usdStr} (${cnyStr})`;
}

/**
 * Format positive cache savings with a leading minus sign (e.g. `-$0.45`, `-¥3.24`, `-$0.45 (-¥3.24)`).
 * Returns `'—'` when `usdSaved` is non-finite, `<= 0`, or rounds to zero at display precision.
 */
export function formatCurrencySavings(
    usdSaved: number,
    prefs?: Partial<CurrencyPrefs>,
    options: Omit<FormatCostOptions, 'allowNegative'> = {},
): string {
    if (!Number.isFinite(usdSaved) || usdSaved <= 0) { return '—'; }
    const formatted = formatCurrencyCost(-usdSaved, prefs, { ...options, allowNegative: true });
    return formatted.includes('-') ? formatted : '—';
}

/**
 * Format a per-million-token rate (e.g. `$0.14/M`, `$0.075/M`, `¥21.60/M`, `$3/M (¥21.60/M)`).
 * Returns `'—'` for non-finite, negative, or overflowing inputs.
 */
export function formatPerMillionRate(
    usdPerMillion: number,
    prefs?: Partial<CurrencyPrefs>,
    bothFormat: 'paren' | 'slash' = 'paren',
): string {
    if (!Number.isFinite(usdPerMillion) || usdPerMillion < 0) { return '—'; }
    const { currency, cnyRate } = normalizeCurrencyPrefs(prefs);
    const usdStr = `${formatSingleCurrency(usdPerMillion, '$', 'rate', false)}/M`;
    if (currency === 'USD') {
        return usdStr;
    }
    const cnyRateVal = convertUsdToCny(usdPerMillion, cnyRate);
    if (!Number.isFinite(cnyRateVal)) { return '—'; }
    const cnyStr = `${formatSingleCurrency(cnyRateVal, '¥', 'rate', false)}/M`;
    if (currency === 'CNY') {
        return cnyStr;
    }
    return bothFormat === 'slash' ? `${usdStr} / ${cnyStr}` : `${usdStr} (${cnyStr})`;
}

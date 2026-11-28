/**
 * Shared Pure-TypeScript 10-Currency Data Contract & Formatting Engine (D5).
 *
 * Strictly zero `vscode` imports and zero external npm dependencies so IDE VSIX,
 * App Sidecar, CDP overlays, CLI statusLine, and export pipelines all share a
 * single authoritative currency contract.
 *
 * Design Guarantees:
 * - Supports all 10 currencies: USD, CNY, EUR, JPY, GBP, KRW, HKD, TWD, CAD, AUD.
 * - Explicit symbol disambiguation:
 *   - USD (`$`), CAD (`CA$`), AUD (`A$`), HKD (`HK$`), TWD (`NT$`)
 *   - CNY (`¥`), JPY (`JP¥` standard / `¥` compact), EUR (`€`), GBP (`£`), KRW (`₩`)
 * - Explicit decimal policy:
 *   - `JPY` & `KRW`: 0 decimals in BOTH standard and compact modes.
 *   - `TWD`: 2 decimals in standard mode, 0 decimals in compact mode.
 *   - All other 7 currencies: 2 decimals in both standard and compact modes.
 * - Dynamic micro-cost threshold: converts the USD threshold (`$0.01` default,
 *   `$0.001` in `call` mode) into the active display currency at the effective FX
 *   rate — never hardcodes `<0.01` across JPY/KRW/TWD.
 * - Strict 5-way distinction: `unknown` (`null`/`undefined`/`NaN`/non-finite),
 *   `exact 0` (including normalized `-0`), `positive sub-unit micro-cost`,
 *   `normal positive`, and `negative adjustment` (normal or micro-negative).
 * - FX safety: validates effective FX rate and converted product are finite and
 *   positive; binds `customRatePerUsd` to `customFxCurrency` so switching display
 *   currency never silently applies a stale rate entered for another currency.
 * - Sum-before-round helpers eliminate rounding drift across aggregated rows.
 * - Structured export records preserve raw numeric USD, currency code, and applied
 *   FX rate independently of localized display strings.
 */

// ─── Currency Codes & Metadata ───────────────────────────────────────────────

export type CurrencyCode =
    | 'USD'
    | 'CNY'
    | 'EUR'
    | 'JPY'
    | 'GBP'
    | 'KRW'
    | 'HKD'
    | 'TWD'
    | 'CAD'
    | 'AUD';

/** Backward-compatible alias for `durable-state.ts` / `sidecar-types.ts`. */
export type DisplayCurrencyCode = CurrencyCode;

export const CURRENCY_CODES: readonly CurrencyCode[] = [
    'USD',
    'CNY',
    'EUR',
    'JPY',
    'GBP',
    'KRW',
    'HKD',
    'TWD',
    'CAD',
    'AUD',
] as const;

/** Backward-compatible alias for `durable-state.ts` / `sidecar-types.ts`. */
export const SUPPORTED_DISPLAY_CURRENCIES: readonly CurrencyCode[] = CURRENCY_CODES;

export const MIN_CUSTOM_FX_RATE = 0.0001;
export const MAX_CUSTOM_FX_RATE = 100_000;
export const DEFAULT_MICRO_THRESHOLD_USD = 0.01;
export const DEFAULT_CALL_MICRO_THRESHOLD_USD = 0.001;

export type CurrencyDisplayMode = 'standard' | 'compact' | 'call' | 'rate';
export type CurrencySymbolStyle = 'standard' | 'compact';
export type CurrencyMicroStyle = 'threshold' | 'precise';

export type CurrencyAmountKind =
    | 'unknown'
    | 'zero'
    | 'micro_positive'
    | 'positive'
    | 'micro_negative'
    | 'negative';

export interface CurrencyPreset {
    readonly code: CurrencyCode;
    /** Disambiguated standard symbol (e.g. `$`, `CA$`, `A$`, `HK$`, `NT$`, `¥`, `JP¥`, `€`, `£`, `₩`). */
    readonly symbol: string;
    /** Compact symbol for ultra-tight surfaces (`¥` for JPY when explicitly requested). */
    readonly compactSymbol: string;
    readonly nameEn: string;
    readonly nameZh: string;
    /** Indicative reference units per 1 USD (override via `CurrencyConfig.customRatePerUsd`). */
    readonly defaultRatePerUsd: number;
    /** Fractional digits in standard display mode (0 for JPY/KRW, 2 for TWD & major decimal currencies). */
    readonly standardDecimals: number;
    /** Fractional digits in compact display mode (0 for JPY/KRW/TWD, 2 for major decimal currencies). */
    readonly compactDecimals: number;
    /** Alias for `standardDecimals` for backward compatibility with existing callers. */
    readonly decimals: number;
    /** Extra precision digits used in `'precise'` micro-cost mode (e.g. 4 for USD, 2 for JPY/KRW). */
    readonly microDecimals: number;
}

export const CURRENCY_PRESETS: Readonly<Record<CurrencyCode, CurrencyPreset>> = Object.freeze({
    USD: Object.freeze({
        code: 'USD',
        symbol: '$',
        compactSymbol: '$',
        nameEn: 'US Dollar',
        nameZh: '美元',
        defaultRatePerUsd: 1,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
    CNY: Object.freeze({
        code: 'CNY',
        symbol: '¥',
        compactSymbol: '¥',
        nameEn: 'Chinese Yuan',
        nameZh: '人民币',
        defaultRatePerUsd: 7.25,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
    EUR: Object.freeze({
        code: 'EUR',
        symbol: '€',
        compactSymbol: '€',
        nameEn: 'Euro',
        nameZh: '欧元',
        defaultRatePerUsd: 0.92,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
    JPY: Object.freeze({
        code: 'JPY',
        symbol: 'JP¥',
        compactSymbol: '¥',
        nameEn: 'Japanese Yen',
        nameZh: '日元',
        defaultRatePerUsd: 154,
        standardDecimals: 0,
        compactDecimals: 0,
        decimals: 0,
        microDecimals: 2,
    }),
    GBP: Object.freeze({
        code: 'GBP',
        symbol: '£',
        compactSymbol: '£',
        nameEn: 'British Pound',
        nameZh: '英镑',
        defaultRatePerUsd: 0.79,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
    KRW: Object.freeze({
        code: 'KRW',
        symbol: '₩',
        compactSymbol: '₩',
        nameEn: 'South Korean Won',
        nameZh: '韩元',
        defaultRatePerUsd: 1390,
        standardDecimals: 0,
        compactDecimals: 0,
        decimals: 0,
        microDecimals: 2,
    }),
    HKD: Object.freeze({
        code: 'HKD',
        symbol: 'HK$',
        compactSymbol: 'HK$',
        nameEn: 'Hong Kong Dollar',
        nameZh: '港元',
        defaultRatePerUsd: 7.78,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
    TWD: Object.freeze({
        code: 'TWD',
        symbol: 'NT$',
        compactSymbol: 'NT$',
        nameEn: 'New Taiwan Dollar',
        nameZh: '新台币',
        defaultRatePerUsd: 32.4,
        standardDecimals: 2,
        compactDecimals: 0,
        decimals: 2,
        microDecimals: 4,
    }),
    CAD: Object.freeze({
        code: 'CAD',
        symbol: 'CA$',
        compactSymbol: 'CA$',
        nameEn: 'Canadian Dollar',
        nameZh: '加元',
        defaultRatePerUsd: 1.38,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
    AUD: Object.freeze({
        code: 'AUD',
        symbol: 'A$',
        compactSymbol: 'A$',
        nameEn: 'Australian Dollar',
        nameZh: '澳元',
        defaultRatePerUsd: 1.54,
        standardDecimals: 2,
        compactDecimals: 2,
        decimals: 2,
        microDecimals: 4,
    }),
});

// ─── Configuration & FX Binding ──────────────────────────────────────────────

export interface CurrencyConfig {
    code: CurrencyCode;
    /** Optional user-provided exchange rate override (units per 1 USD, finite & > 0). */
    customRatePerUsd?: number | null;
    /**
     * Currency code that `customRatePerUsd` was explicitly bound to.
     * When provided (including `null` or empty string) and not matching `code`,
     * `customRatePerUsd` is rejected so switching currency never applies a stale FX rate.
     */
    customFxCurrency?: CurrencyCode | string | null;
    /**
     * When `true`, `customRatePerUsd` is ignored unless `customFxCurrency` is explicitly
     * provided and matches `code`. Useful when reading persisted settings across switches.
     */
    requireBoundCurrency?: boolean;
}

export type CurrencyInput = CurrencyCode | Partial<CurrencyConfig> | null | undefined;

export interface ResolvedCurrencyConfig {
    preset: CurrencyPreset;
    ratePerUsd: number;
    isCustomRate: boolean;
    customFxCurrency: CurrencyCode | null;
    /** True when a custom FX rate was supplied but ignored due to currency mismatch or invalid value. */
    rateMismatchIgnored: boolean;
}

export interface BoundCustomFxState {
    displayCurrency: CurrencyCode;
    customFxRate: number | null;
    customFxCurrency: CurrencyCode | null;
}

export function normalizeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
    if (typeof value !== 'string') { return false; }
    const upper = value.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(CURRENCY_PRESETS, upper);
}

export function normalizeCurrencyCode(
    value: unknown,
    fallback: CurrencyCode = 'USD',
): CurrencyCode {
    if (typeof value !== 'string') { return fallback; }
    const upper = value.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(CURRENCY_PRESETS, upper)
        ? (upper as CurrencyCode)
        : fallback;
}

export function isValidCustomFxRate(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value >= MIN_CUSTOM_FX_RATE
        && value <= MAX_CUSTOM_FX_RATE;
}

/**
 * Bind a custom FX rate to a specific display currency.
 * USD never carries a custom FX override (`rate` is always cleared to `null`).
 */
export function bindCustomFxRate(
    displayCurrency: CurrencyCode,
    customFxRate: number | null | undefined,
): BoundCustomFxState {
    const code = normalizeCurrencyCode(displayCurrency, 'USD');
    if (code === 'USD' || !isValidCustomFxRate(customFxRate)) {
        return {
            displayCurrency: code,
            customFxRate: null,
            customFxCurrency: null,
        };
    }
    return {
        displayCurrency: code,
        customFxRate: normalizeZero(customFxRate),
        customFxCurrency: code,
    };
}

/**
 * Safely switch the display currency, clearing `customFxRate` whenever the
 * newly selected currency differs from the rate's bound `customFxCurrency`.
 */
export function switchDisplayCurrency(
    current: {
        displayCurrency?: unknown;
        customFxRate?: number | null;
        customFxCurrency?: unknown;
    },
    nextCurrency: unknown,
): BoundCustomFxState {
    const nextCode = normalizeCurrencyCode(nextCurrency, 'USD');
    const boundCode = typeof current.customFxCurrency === 'string' && isCurrencyCode(current.customFxCurrency)
        ? normalizeCurrencyCode(current.customFxCurrency)
        : null;
    if (nextCode === 'USD' || !boundCode || boundCode !== nextCode || !isValidCustomFxRate(current.customFxRate)) {
        return {
            displayCurrency: nextCode,
            customFxRate: null,
            customFxCurrency: null,
        };
    }
    return {
        displayCurrency: nextCode,
        customFxRate: normalizeZero(current.customFxRate),
        customFxCurrency: nextCode,
    };
}

export function resolveCurrencyConfig(input?: CurrencyInput): ResolvedCurrencyConfig {
    if (!input) {
        return {
            preset: CURRENCY_PRESETS.USD,
            ratePerUsd: 1,
            isCustomRate: false,
            customFxCurrency: null,
            rateMismatchIgnored: false,
        };
    }

    const rawCode = typeof input === 'string' ? input : input.code;
    const code = normalizeCurrencyCode(rawCode, 'USD');
    const preset = CURRENCY_PRESETS[code];

    if (typeof input === 'string' || preset.code === 'USD') {
        const hadNonUsCustom = typeof input === 'object'
            && input !== null
            && input.customRatePerUsd !== undefined
            && input.customRatePerUsd !== null;
        return {
            preset,
            ratePerUsd: preset.defaultRatePerUsd,
            isCustomRate: false,
            customFxCurrency: null,
            rateMismatchIgnored: preset.code === 'USD' && hadNonUsCustom,
        };
    }

    const rawCustomRate = input.customRatePerUsd;
    if (rawCustomRate === undefined || rawCustomRate === null) {
        return {
            preset,
            ratePerUsd: preset.defaultRatePerUsd,
            isCustomRate: false,
            customFxCurrency: null,
            rateMismatchIgnored: false,
        };
    }

    if (!isValidCustomFxRate(rawCustomRate)) {
        return {
            preset,
            ratePerUsd: preset.defaultRatePerUsd,
            isCustomRate: false,
            customFxCurrency: null,
            rateMismatchIgnored: true,
        };
    }

    const hasBoundField = Object.prototype.hasOwnProperty.call(input, 'customFxCurrency')
        && input.customFxCurrency !== undefined;

    if (hasBoundField) {
        const rawBound = input.customFxCurrency;
        if (typeof rawBound !== 'string' || !isCurrencyCode(rawBound)) {
            return {
                preset,
                ratePerUsd: preset.defaultRatePerUsd,
                isCustomRate: false,
                customFxCurrency: null,
                rateMismatchIgnored: true,
            };
        }
        const normalizedBound = normalizeCurrencyCode(rawBound);
        if (normalizedBound !== preset.code) {
            return {
                preset,
                ratePerUsd: preset.defaultRatePerUsd,
                isCustomRate: false,
                customFxCurrency: null,
                rateMismatchIgnored: true,
            };
        }
        return {
            preset,
            ratePerUsd: normalizeZero(rawCustomRate),
            isCustomRate: true,
            customFxCurrency: preset.code,
            rateMismatchIgnored: false,
        };
    }

    if (input.requireBoundCurrency) {
        return {
            preset,
            ratePerUsd: preset.defaultRatePerUsd,
            isCustomRate: false,
            customFxCurrency: null,
            rateMismatchIgnored: true,
        };
    }

    return {
        preset,
        ratePerUsd: normalizeZero(rawCustomRate),
        isCustomRate: true,
        customFxCurrency: preset.code,
        rateMismatchIgnored: false,
    };
}

/**
 * Convenience resolver for persisted `AppSettings` shapes (`displayCurrency`,
 * `customFxRate`, `customFxCurrency`). When `customFxCurrency` is present it is
 * strictly verified against `displayCurrency`.
 */
export function resolveAppCurrencyConfig(settings: {
    displayCurrency?: unknown;
    customFxRate?: number | null;
    customFxCurrency?: CurrencyCode | string | null;
    requireBoundCurrency?: boolean;
}): ResolvedCurrencyConfig {
    return resolveCurrencyConfig({
        code: normalizeCurrencyCode(settings.displayCurrency, 'USD'),
        customRatePerUsd: settings.customFxRate,
        ...(settings.customFxCurrency !== undefined ? { customFxCurrency: settings.customFxCurrency } : {}),
        ...(settings.requireBoundCurrency !== undefined ? { requireBoundCurrency: settings.requireBoundCurrency } : {}),
    });
}

// ─── Core Conversion & Precision Helpers ─────────────────────────────────────

export function getCurrencyDecimals(
    preset: CurrencyPreset,
    mode: CurrencyDisplayMode = 'standard',
): number {
    return mode === 'compact' ? preset.compactDecimals : preset.standardDecimals;
}

export function getCurrencySymbol(
    preset: CurrencyPreset,
    symbolStyle: CurrencySymbolStyle = 'standard',
): string {
    return symbolStyle === 'compact' ? preset.compactSymbol : preset.symbol;
}

export function convertUsdToCurrency(
    usd: number | null | undefined,
    currency?: CurrencyInput,
): number {
    if (typeof usd !== 'number' || !Number.isFinite(usd)) {
        return Number.NaN;
    }
    const { ratePerUsd } = resolveCurrencyConfig(currency);
    if (!Number.isFinite(ratePerUsd) || ratePerUsd <= 0) {
        return Number.NaN;
    }
    const product = usd * ratePerUsd;
    if (!Number.isFinite(product)) {
        return Number.NaN;
    }
    return normalizeZero(product);
}

export function convertCurrencyToUsd(
    amount: number | null | undefined,
    currency?: CurrencyInput,
): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        return Number.NaN;
    }
    const { ratePerUsd } = resolveCurrencyConfig(currency);
    if (!Number.isFinite(ratePerUsd) || ratePerUsd <= 0) {
        return Number.NaN;
    }
    const quotient = amount / ratePerUsd;
    if (!Number.isFinite(quotient)) {
        return Number.NaN;
    }
    return normalizeZero(quotient);
}

export function roundCurrencyAmount(
    localAmount: number,
    currency?: CurrencyInput,
    mode: 'standard' | 'compact' = 'standard',
): number {
    if (!Number.isFinite(localAmount)) { return Number.NaN; }
    const { preset } = resolveCurrencyConfig(currency);
    const decimals = getCurrencyDecimals(preset, mode);
    const factor = 10 ** decimals;
    const scaled = localAmount * factor;
    if (!Number.isFinite(scaled)) { return Number.NaN; }
    return normalizeZero(Math.round(scaled) / factor);
}

// ─── Dynamic Micro-Cost Threshold ────────────────────────────────────────────

export interface MicroCostThresholdInfo {
    currency: CurrencyCode;
    usdThreshold: number;
    ratePerUsd: number;
    /** Exact converted local value (`usdThreshold * ratePerUsd`). */
    rawLocalThreshold: number;
    /** Minimum representable single unit at display precision (`1` or `0.01`). */
    minDisplayUnit: number;
    /** Monotonic local cutover threshold aligned to `minDisplayUnit`. */
    displayThreshold: number;
    /** Formatted threshold value without `<` prefix (e.g. `$0.01`, `JP¥2`, `₩14`, `NT$0.32`, `NT$1`). */
    formattedThreshold: string;
    /** Formatted micro-positive label (e.g. `<$0.01`, `<JP¥2`, `<₩14`, `<NT$0.32`, `<NT$1`). */
    lessThanLabel: string;
    /** Formatted micro-negative label (e.g. `>-$0.01`, `>-JP¥2`, `>-₩14`). */
    greaterThanNegativeLabel: string;
}

function formatNumberWithGrouping(absValue: number, decimals: number): string {
    if (decimals <= 0) {
        return Math.round(absValue).toLocaleString('en-US');
    }
    return absValue.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function trimTrailingDecimalZeros(fixed: string, minDecimals = 0): string {
    if (!fixed.includes('.')) { return fixed; }
    const [whole, frac] = fixed.split('.');
    let end = frac.length;
    while (end > minDecimals && frac[end - 1] === '0') {
        end--;
    }
    return end === 0 ? whole : `${whole}.${frac.slice(0, end)}`;
}

/**
 * Compute the dynamic micro-cost threshold in the target display currency.
 * Converts the USD threshold (`$0.01` default; `$0.001` for `call` mode) using the
 * active FX rate and aligns it to the currency's display decimal unit so threshold
 * and normal formatting remain strictly monotonic across every currency and FX rate.
 */
export function resolveMicroCostThreshold(
    currency?: CurrencyInput,
    options: {
        mode?: CurrencyDisplayMode;
        symbolStyle?: CurrencySymbolStyle;
        microThresholdUsd?: number;
    } = {},
): MicroCostThresholdInfo {
    const mode = options.mode ?? 'standard';
    const symbolStyle = options.symbolStyle ?? 'standard';
    const resolved = resolveCurrencyConfig(currency);
    const { preset, ratePerUsd } = resolved;
    const decimals = getCurrencyDecimals(preset, mode);
    const symbol = getCurrencySymbol(preset, symbolStyle);

    const defaultUsdThreshold = mode === 'call'
        ? DEFAULT_CALL_MICRO_THRESHOLD_USD
        : DEFAULT_MICRO_THRESHOLD_USD;
    const usdThreshold = typeof options.microThresholdUsd === 'number'
        && Number.isFinite(options.microThresholdUsd)
        && options.microThresholdUsd > 0
        ? options.microThresholdUsd
        : defaultUsdThreshold;

    const minDisplayUnit = decimals === 0 ? 1 : Number((10 ** -decimals).toFixed(decimals));
    const rawLocalThreshold = usdThreshold * ratePerUsd;

    const alignedSteps = Math.max(1, Math.round(rawLocalThreshold / minDisplayUnit));
    const displayThreshold = decimals === 0
        ? alignedSteps
        : Number((alignedSteps * minDisplayUnit).toFixed(decimals));

    const formattedMagnitude = formatNumberWithGrouping(displayThreshold, decimals);
    const formattedThreshold = `${symbol}${formattedMagnitude}`;

    return {
        currency: preset.code,
        usdThreshold,
        ratePerUsd,
        rawLocalThreshold,
        minDisplayUnit,
        displayThreshold,
        formattedThreshold,
        lessThanLabel: `<${formattedThreshold}`,
        greaterThanNegativeLabel: `>-${formattedThreshold}`,
    };
}

// ─── Formatting & Classification Contract ────────────────────────────────────

export interface FormatCurrencyOptions {
    /**
     * Display precision mode:
     * - `'standard'` (default): totals & panels (TWD=2 decimals, JPY/KRW=0 decimals)
     * - `'compact'`: dense HUD/status/badge surfaces (TWD=0 decimals, JPY/KRW=0 decimals)
     * - `'call'`: per-call telemetry (defaults to `'precise'` micro-style & `$0.001` USD threshold)
     * - `'rate'`: list or per-1M rate (trims trailing fractional zeros)
     */
    mode?: CurrencyDisplayMode;
    /** Symbol variant (`'standard'` uses `JP¥` for JPY; `'compact'` uses `¥` for JPY). */
    symbolStyle?: CurrencySymbolStyle;
    /**
     * How sub-threshold non-zero amounts are rendered:
     * - `'threshold'` (default for `'standard'`/`'compact'`): dynamic `<$0.01`, `<JP¥2`, `<₩14`, `<NT$0.32`, `<NT$1`
     * - `'precise'` (default for `'call'`): extra fractional precision (4 decimals for decimal currencies,
     *   2 decimals for zero-decimal currencies), falling back to `<subUnit` only if smaller than sub-unit precision.
     */
    microStyle?: CurrencyMicroStyle;
    /** Return `'—'` when amount is exact 0 (or <= 0 when `allowNegative` is false). Default: `false`. */
    zeroAsDash?: boolean;
    /** Preserve negative adjustments instead of clamping negative values to `0`. Default: `false`. */
    allowNegative?: boolean;
    /** Optional custom micro-cost USD threshold override (must be finite and > 0). */
    microThresholdUsd?: number;
}

export interface ClassifiedCurrencyAmount {
    kind: CurrencyAmountKind;
    amountUsd: number | null;
    convertedAmount: number | null;
    resolved: ResolvedCurrencyConfig;
    threshold: MicroCostThresholdInfo;
}

/**
 * Classify a USD amount in the target currency into one of 6 strict semantic states:
 * `'unknown' | 'zero' | 'micro_positive' | 'positive' | 'micro_negative' | 'negative'`.
 *
 * `-0` is always normalized to exact `+0` (`'zero'`).
 */
export function classifyCurrencyAmount(
    usdAmount: number | null | undefined,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): ClassifiedCurrencyAmount {
    const resolved = resolveCurrencyConfig(currency);
    const mode = options.mode ?? 'standard';
    const threshold = resolveMicroCostThreshold(currency, {
        mode,
        symbolStyle: options.symbolStyle,
        microThresholdUsd: options.microThresholdUsd,
    });

    if (typeof usdAmount !== 'number' || !Number.isFinite(usdAmount)) {
        return {
            kind: 'unknown',
            amountUsd: null,
            convertedAmount: null,
            resolved,
            threshold,
        };
    }

    const allowNegative = options.allowNegative ?? false;
    const rawUsd = normalizeZero(usdAmount);
    const effectiveUsd = !allowNegative && rawUsd < 0 ? 0 : rawUsd;
    const converted = effectiveUsd * resolved.ratePerUsd;

    if (!Number.isFinite(converted)) {
        return {
            kind: 'unknown',
            amountUsd: null,
            convertedAmount: null,
            resolved,
            threshold,
        };
    }

    const normalizedConverted = normalizeZero(converted);
    if (normalizedConverted === 0) {
        return {
            kind: 'zero',
            amountUsd: 0,
            convertedAmount: 0,
            resolved,
            threshold,
        };
    }

    const absConverted = Math.abs(normalizedConverted);
    const isMicro = absConverted < threshold.displayThreshold;

    if (normalizedConverted > 0) {
        return {
            kind: isMicro ? 'micro_positive' : 'positive',
            amountUsd: effectiveUsd,
            convertedAmount: normalizedConverted,
            resolved,
            threshold,
        };
    }

    return {
        kind: isMicro ? 'micro_negative' : 'negative',
        amountUsd: effectiveUsd,
        convertedAmount: normalizedConverted,
        resolved,
        threshold,
    };
}

function formatPreciseMicro(
    absConverted: number,
    preset: CurrencyPreset,
    symbol: string,
    isNegative: boolean,
): string {
    const microDecimals = preset.microDecimals;
    const fixed = absConverted.toFixed(microDecimals);
    const roundsToZero = /^0(?:\.0+)?$/.test(fixed);
    if (roundsToZero) {
        const subUnit = (10 ** -microDecimals).toFixed(microDecimals);
        return isNegative ? `>-${symbol}${subUnit}` : `<${symbol}${subUnit}`;
    }
    return isNegative ? `-${symbol}${fixed}` : `${symbol}${fixed}`;
}

function formatRateMagnitude(absConverted: number, preset: CurrencyPreset): string {
    if (absConverted === 0) {
        return '0';
    }
    if (preset.standardDecimals === 0) {
        if (absConverted < 1) {
            return trimTrailingDecimalZeros(absConverted.toFixed(preset.microDecimals));
        }
        return formatNumberWithGrouping(absConverted, 0);
    }
    if (absConverted < 0.01 && Number(absConverted.toFixed(4)) < 0.01) {
        return trimTrailingDecimalZeros(absConverted.toFixed(4));
    }
    if (absConverted < 1 && Number(absConverted.toFixed(3)) < 1) {
        return trimTrailingDecimalZeros(absConverted.toFixed(3), 2);
    }
    const rounded2 = Number(absConverted.toFixed(2));
    if (rounded2 >= 1000) {
        return trimTrailingDecimalZeros(formatNumberWithGrouping(rounded2, 2));
    }
    return trimTrailingDecimalZeros(absConverted.toFixed(2));
}

/**
 * Format a USD amount into the target display currency following the D5 data contract.
 *
 * Guarantees:
 * - `null`, `undefined`, `NaN`, `Infinity`, `-Infinity`, or overflowing products → `'—'`
 * - Exact `0` or `-0` → `$0.00` / `JP¥0` / `₩0` / `NT$0.00` (standard) / `NT$0` (compact) (or `'—'` if `zeroAsDash`)
 * - Positive sub-threshold micro-costs NEVER collapse to `0` (`<$0.01`, `<JP¥2`, `<₩14`, `<NT$0.32`, `<NT$1`, or precise sub-unit)
 * - Negative adjustments with `allowNegative: true` preserve `-` (and micro-negatives NEVER collapse to `-0`)
 */
export function formatCurrencyAmount(
    usdAmount: number | null | undefined,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): string {
    const mode = options.mode ?? 'standard';
    const symbolStyle = options.symbolStyle ?? 'standard';
    const microStyle = options.microStyle ?? (mode === 'call' ? 'precise' : 'threshold');
    const zeroAsDash = options.zeroAsDash ?? false;

    const classified = classifyCurrencyAmount(usdAmount, currency, options);
    const { preset } = classified.resolved;
    const symbol = getCurrencySymbol(preset, symbolStyle);
    const decimals = getCurrencyDecimals(preset, mode);

    if (classified.kind === 'unknown' || classified.convertedAmount === null) {
        return '—';
    }

    if (classified.kind === 'zero') {
        if (zeroAsDash) { return '—'; }
        if (mode === 'rate') { return `${symbol}0`; }
        return `${symbol}${decimals === 0 ? '0' : (0).toFixed(decimals)}`;
    }

    const abs = Math.abs(classified.convertedAmount);

    if (mode === 'rate') {
        const formatted = formatRateMagnitude(abs, preset);
        const roundsToZero = /^0(?:\.0+)?$/.test(formatted);
        if (roundsToZero) {
            return formatPreciseMicro(abs, preset, symbol, classified.convertedAmount < 0);
        }
        return `${classified.convertedAmount < 0 ? '-' : ''}${symbol}${formatted}`;
    }

    if (classified.kind === 'micro_positive') {
        if (microStyle === 'precise') {
            return formatPreciseMicro(abs, preset, symbol, false);
        }
        return classified.threshold.lessThanLabel;
    }

    if (classified.kind === 'micro_negative') {
        if (microStyle === 'precise') {
            return formatPreciseMicro(abs, preset, symbol, true);
        }
        return classified.threshold.greaterThanNegativeLabel;
    }

    if (mode === 'call' && decimals > 0 && abs < 1 && Number(abs.toFixed(3)) < 1) {
        const sign = classified.kind === 'negative' ? '-' : '';
        return `${sign}${symbol}${abs.toFixed(3)}`;
    }

    const formatted = formatNumberWithGrouping(abs, decimals);
    const sign = classified.kind === 'negative' ? '-' : '';
    return `${sign}${symbol}${formatted}`;
}

/**
 * Format cost showing local currency + USD reference when non-USD, or pure USD when USD.
 */
export function formatDualCurrencyAmount(
    usdAmount: number | null | undefined,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): string {
    const classified = classifyCurrencyAmount(usdAmount, currency, options);
    if (classified.kind === 'unknown') { return '—'; }
    if (options.zeroAsDash && classified.kind === 'zero') { return '—'; }
    const primary = formatCurrencyAmount(usdAmount, currency, options);
    if (classified.resolved.preset.code === 'USD') {
        return primary;
    }
    const usdStr = formatCurrencyAmount(usdAmount, 'USD', options);
    return `${primary} (${usdStr})`;
}

// ─── Sum-Before-Round Helpers ────────────────────────────────────────────────

export interface UsdSumResult {
    /** Raw unrounded sum of finite USD inputs (or `null` when no finite inputs exist). */
    totalUsd: number | null;
    validCount: number;
    unknownCount: number;
    hasValues: boolean;
}

/**
 * Sum raw numeric USD amounts before any currency conversion or display rounding.
 * Skips `null`/`undefined`/`NaN`/non-finite inputs while counting them explicitly.
 */
export function sumUsdAmounts(
    values: Iterable<number | null | undefined>,
): UsdSumResult {
    let total = 0;
    let validCount = 0;
    let unknownCount = 0;

    for (const v of values) {
        if (typeof v === 'number' && Number.isFinite(v)) {
            total += normalizeZero(v);
            validCount++;
        } else {
            unknownCount++;
        }
    }

    if (validCount === 0 || !Number.isFinite(total)) {
        return {
            totalUsd: null,
            validCount: 0,
            unknownCount: validCount === 0 ? unknownCount : unknownCount + validCount,
            hasValues: false,
        };
    }

    return {
        totalUsd: normalizeZero(total),
        validCount,
        unknownCount,
        hasValues: true,
    };
}

export interface ConvertedSumResult extends UsdSumResult {
    currency: CurrencyCode;
    fxRatePerUsd: number;
    isCustomFxRate: boolean;
    /** Unrounded converted total (`totalUsd * fxRatePerUsd`, or `null` if unknown/overflow). */
    convertedAmount: number | null;
    /** Rounded converted total at display precision (computed once AFTER summing). */
    roundedConvertedAmount: number | null;
    classification: CurrencyAmountKind;
    formatted: string;
}

/**
 * Enforce sum-before-round across a collection of USD amounts:
 * 1. Sum all raw finite USD inputs first.
 * 2. Convert the summed USD total once at the active FX rate.
 * 3. Format/round once at the end.
 */
export function sumAndConvertUsdAmounts(
    values: Iterable<number | null | undefined>,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): ConvertedSumResult {
    const summed = sumUsdAmounts(values);
    const resolved = resolveCurrencyConfig(currency);
    const mode = options.mode ?? 'standard';
    const roundMode: 'standard' | 'compact' = mode === 'compact' ? 'compact' : 'standard';

    if (!summed.hasValues || summed.totalUsd === null) {
        return {
            ...summed,
            currency: resolved.preset.code,
            fxRatePerUsd: resolved.ratePerUsd,
            isCustomFxRate: resolved.isCustomRate,
            convertedAmount: null,
            roundedConvertedAmount: null,
            classification: 'unknown',
            formatted: '—',
        };
    }

    const classified = classifyCurrencyAmount(summed.totalUsd, currency, options);
    const converted = classified.convertedAmount;
    const rounded = converted !== null
        ? roundCurrencyAmount(converted, currency, roundMode)
        : null;

    return {
        ...summed,
        currency: resolved.preset.code,
        fxRatePerUsd: resolved.ratePerUsd,
        isCustomFxRate: resolved.isCustomRate,
        convertedAmount: converted,
        roundedConvertedAmount: rounded !== null && Number.isFinite(rounded) ? rounded : null,
        classification: classified.kind,
        formatted: formatCurrencyAmount(summed.totalUsd, currency, options),
    };
}

// ─── Structured Export Records ───────────────────────────────────────────────

export interface CurrencyExportRecord {
    /** Raw unrounded USD value (`null` when unknown/non-finite; `0` when exact zero). */
    amountUsd: number | null;
    /** ISO 4217 currency code applied for display/conversion. */
    currency: CurrencyCode;
    /** Effective exchange rate (units of `currency` per 1 USD). */
    fxRatePerUsd: number;
    /** Whether `fxRatePerUsd` came from a user custom override rather than built-in reference rate. */
    isCustomFxRate: boolean;
    /** Raw converted amount in `currency` (`null` when unknown/overflow). */
    convertedAmount: number | null;
    /** Semantic classification distinguishing unknown / zero / micro / positive / negative. */
    classification: CurrencyAmountKind;
    /** Localized/formatted display string in `currency`. */
    formatted: string;
    /** Formatted reference display string in USD. */
    formattedUsd: string;
}

/**
 * Build a machine-readable export record that preserves raw numeric USD, currency code,
 * and applied FX rate independently of localized display strings.
 */
export function buildCurrencyExportRecord(
    usdAmount: number | null | undefined,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): CurrencyExportRecord {
    const classified = classifyCurrencyAmount(usdAmount, currency, options);
    const { preset, ratePerUsd, isCustomRate } = classified.resolved;

    return {
        amountUsd: classified.amountUsd,
        currency: preset.code,
        fxRatePerUsd: ratePerUsd,
        isCustomFxRate: isCustomRate,
        convertedAmount: classified.convertedAmount,
        classification: classified.kind,
        formatted: formatCurrencyAmount(usdAmount, currency, options),
        formattedUsd: formatCurrencyAmount(usdAmount, 'USD', options),
    };
}

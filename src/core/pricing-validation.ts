/**
 * Shared Pure-TypeScript Pricing, Currency & Subscription Settings Validation.
 *
 * Strictly zero `vscode` imports and zero external npm dependencies.
 * Provides bounded, fail-closed validation and normalization shared across
 * IDE settings, App Sidecar actions, DurableState persistence, and JSON import/export.
 */

import {
    CURRENCY_CODES,
    MAX_CUSTOM_FX_RATE,
    MIN_CUSTOM_FX_RATE,
    isCurrencyCode,
    isValidCustomFxRate,
    normalizeCurrencyCode,
    normalizeZero,
    type CurrencyCode,
} from './currency';

// ─── Shared Domain Types & Limits ────────────────────────────────────────────

export type OrchestratorPricingMode = 'mapped' | 'strict';

export interface ValidatedModelPricing {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    thinking: number;
}

export type SubscriptionPlanPresetId =
    | 'none'
    | 'google-ai-pro'
    | 'google-ai-ultra-5x'
    | 'google-ai-ultra-20x'
    | 'custom';

export interface SubscriptionPlanPreset {
    readonly id: SubscriptionPlanPresetId;
    readonly labelEn: string;
    readonly labelZh: string;
    /** Indicative US monthly fee in USD (`0` for `'none'` and `'custom'`). */
    readonly monthlyUsd: number;
}

export const SUBSCRIPTION_PLAN_PRESET_ORDER: readonly SubscriptionPlanPresetId[] = [
    'none',
    'google-ai-pro',
    'google-ai-ultra-5x',
    'google-ai-ultra-20x',
    'custom',
] as const;

export const SUBSCRIPTION_PLAN_PRESETS: Readonly<Record<SubscriptionPlanPresetId, SubscriptionPlanPreset>> = Object.freeze({
    none: Object.freeze({ id: 'none', labelEn: 'Off', labelZh: '未启用', monthlyUsd: 0 }),
    'google-ai-pro': Object.freeze({ id: 'google-ai-pro', labelEn: 'Google AI Pro', labelZh: 'Google AI Pro', monthlyUsd: 19.99 }),
    'google-ai-ultra-5x': Object.freeze({ id: 'google-ai-ultra-5x', labelEn: 'Google AI Ultra 5x', labelZh: 'Google AI Ultra 5x', monthlyUsd: 99.99 }),
    'google-ai-ultra-20x': Object.freeze({ id: 'google-ai-ultra-20x', labelEn: 'Google AI Ultra 20x', labelZh: 'Google AI Ultra 20x', monthlyUsd: 199.99 }),
    custom: Object.freeze({ id: 'custom', labelEn: 'Custom Plan', labelZh: '自定义订阅', monthlyUsd: 0 }),
});

/** Sanity ceiling for custom per-1M-token prices in USD (generous upper bound to block overflow/corrupt data). */
export const MAX_MODEL_PRICE_PER_MILLION_USD = 100_000;
/** Maximum number of custom model pricing override entries accepted in one payload. */
export const MAX_CUSTOM_PRICING_MODELS = 256;
/** Maximum length of a model pricing key. */
export const MAX_MODEL_PRICING_KEY_LENGTH = 160;
/** Sanity ceiling for monthly subscription fee in any supported currency. */
export const MAX_SUBSCRIPTION_MONTHLY_FEE = 1_000_000;

const FORBIDDEN_OBJECT_KEYS: ReadonlySet<string> = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'valueOf',
    'hasOwnProperty',
]);

export type ValidationResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

// ─── Helper Predicates ───────────────────────────────────────────────────────

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function parseStrictFiniteNumber(raw: unknown): number | null {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? normalizeZero(raw) : null;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) { return null; }
        const n = Number(trimmed);
        return Number.isFinite(n) ? normalizeZero(n) : null;
    }
    return null;
}

export function isValidPricingModelKey(key: unknown): key is string {
    if (typeof key !== 'string') { return false; }
    const trimmed = key.trim();
    if (!trimmed || trimmed.length > MAX_MODEL_PRICING_KEY_LENGTH) { return false; }
    if (/[\0\r\n\t]/.test(trimmed)) { return false; }
    if (FORBIDDEN_OBJECT_KEYS.has(trimmed)) { return false; }
    return true;
}

// ─── Custom Model Pricing Validation ─────────────────────────────────────────

export function validateModelPricingEntry(raw: unknown): ValidationResult<ValidatedModelPricing> {
    if (!isPlainRecord(raw)) {
        return { ok: false, error: 'Model pricing entry must be a plain object' };
    }

    const input = parseStrictFiniteNumber(raw.input);
    if (input === null || input < 0 || input > MAX_MODEL_PRICE_PER_MILLION_USD) {
        return { ok: false, error: `Invalid input price (must be a finite number in [0, ${MAX_MODEL_PRICE_PER_MILLION_USD}])` };
    }

    const output = parseStrictFiniteNumber(raw.output);
    if (output === null || output < 0 || output > MAX_MODEL_PRICE_PER_MILLION_USD) {
        return { ok: false, error: `Invalid output price (must be a finite number in [0, ${MAX_MODEL_PRICE_PER_MILLION_USD}])` };
    }

    const cacheReadRaw = raw.cacheRead === undefined ? 0 : raw.cacheRead;
    const cacheRead = parseStrictFiniteNumber(cacheReadRaw);
    if (cacheRead === null || cacheRead < 0 || cacheRead > MAX_MODEL_PRICE_PER_MILLION_USD) {
        return { ok: false, error: `Invalid cacheRead price (must be a finite number in [0, ${MAX_MODEL_PRICE_PER_MILLION_USD}])` };
    }

    const cacheWriteRaw = raw.cacheWrite === undefined ? 0 : raw.cacheWrite;
    const cacheWrite = parseStrictFiniteNumber(cacheWriteRaw);
    if (cacheWrite === null || cacheWrite < 0 || cacheWrite > MAX_MODEL_PRICE_PER_MILLION_USD) {
        return { ok: false, error: `Invalid cacheWrite price (must be a finite number in [0, ${MAX_MODEL_PRICE_PER_MILLION_USD}])` };
    }

    const thinkingRaw = raw.thinking === undefined ? output : raw.thinking;
    const thinking = parseStrictFiniteNumber(thinkingRaw);
    if (thinking === null || thinking < 0 || thinking > MAX_MODEL_PRICE_PER_MILLION_USD) {
        return { ok: false, error: `Invalid thinking price (must be a finite number in [0, ${MAX_MODEL_PRICE_PER_MILLION_USD}])` };
    }

    return {
        ok: true,
        value: {
            input,
            output,
            cacheRead,
            cacheWrite,
            thinking,
        },
    };
}

/**
 * Strictly validate an entire custom pricing override map.
 * Rejects arrays/primitives, prototype-pollution keys, blank/control-char keys,
 * excessive key counts, and any negative/NaN/Infinity/out-of-range prices.
 */
export function validateCustomPricingOverrides(
    raw: unknown,
): ValidationResult<Record<string, ValidatedModelPricing>> {
    if (!isPlainRecord(raw)) {
        return { ok: false, error: 'Custom pricing overrides must be a plain object' };
    }
    const keys = Object.keys(raw);
    if (keys.length > MAX_CUSTOM_PRICING_MODELS) {
        return { ok: false, error: `Custom pricing overrides exceed maximum of ${MAX_CUSTOM_PRICING_MODELS} models` };
    }

    const out: Record<string, ValidatedModelPricing> = Object.create(null);
    const result: Record<string, ValidatedModelPricing> = {};
    for (const rawKey of keys) {
        if (!isValidPricingModelKey(rawKey)) {
            return { ok: false, error: `Invalid model pricing key "${String(rawKey).slice(0, 40)}"` };
        }
        const cleanKey = rawKey.trim();
        if (Object.prototype.hasOwnProperty.call(out, cleanKey)) {
            return { ok: false, error: `Duplicate normalized model pricing key "${cleanKey}"` };
        }
        const entryRes = validateModelPricingEntry(raw[rawKey]);
        if (!entryRes.ok) {
            return { ok: false, error: `Invalid pricing for "${cleanKey}": ${entryRes.error}` };
        }
        out[cleanKey] = entryRes.value;
        result[cleanKey] = entryRes.value;
    }

    return { ok: true, value: result };
}

/**
 * Convenience sanitizer matching `sidecar-runtime.ts` (`Record<string, ModelPricing> | null`).
 */
export function sanitizeCustomPricingOverrides(
    raw: unknown,
): Record<string, ValidatedModelPricing> | null {
    const validated = validateCustomPricingOverrides(raw);
    return validated.ok ? validated.value : null;
}

// ─── Orchestrator Pricing Mode Validation ────────────────────────────────────

export function isOrchestratorPricingMode(value: unknown): value is OrchestratorPricingMode {
    return value === 'mapped' || value === 'strict';
}

export function validateOrchestratorPricingMode(
    value: unknown,
): ValidationResult<OrchestratorPricingMode> {
    if (typeof value === 'string') {
        const clean = value.trim().toLowerCase();
        if (clean === 'mapped' || clean === 'strict') {
            return { ok: true, value: clean };
        }
    }
    return { ok: false, error: 'Invalid orchestratorPricingMode (expected "mapped" or "strict")' };
}

export function normalizeOrchestratorPricingMode(
    value: unknown,
    fallback: OrchestratorPricingMode = 'mapped',
): OrchestratorPricingMode {
    const res = validateOrchestratorPricingMode(value);
    return res.ok ? res.value : fallback;
}

// ─── Subscription & Currency Settings Validation ─────────────────────────────

export function isSubscriptionPlanPresetId(value: unknown): value is SubscriptionPlanPresetId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLAN_PRESETS, value);
}

/**
 * Normalize a raw or persisted subscription plan ID, including backward-compatible
 * migration for legacy `'google-ai-ultra'` and fee-based preset inference when empty.
 */
export function normalizeSubscriptionPlanId(
    rawPlan: unknown,
    monthlyFee?: number | null,
): SubscriptionPlanPresetId {
    const cleaned = typeof rawPlan === 'string' ? rawPlan.trim() : '';
    if (isSubscriptionPlanPresetId(cleaned)) {
        return cleaned;
    }
    const validFee = typeof monthlyFee === 'number' && Number.isFinite(monthlyFee) && monthlyFee > 0
        ? monthlyFee
        : null;
    if (cleaned === 'google-ai-ultra') {
        if (validFee !== null && Math.abs(validFee - SUBSCRIPTION_PLAN_PRESETS['google-ai-ultra-5x'].monthlyUsd) < 0.01) {
            return 'google-ai-ultra-5x';
        }
        return 'google-ai-ultra-20x';
    }
    if (validFee !== null) {
        for (const planId of SUBSCRIPTION_PLAN_PRESET_ORDER) {
            const preset = SUBSCRIPTION_PLAN_PRESETS[planId];
            if (preset.monthlyUsd > 0 && Math.abs(validFee - preset.monthlyUsd) < 0.01) {
                return planId;
            }
        }
        return 'custom';
    }
    return 'none';
}

export function validateSubscriptionPlan(
    value: unknown,
    monthlyFee?: number | null,
): ValidationResult<SubscriptionPlanPresetId> {
    if (typeof value !== 'string') {
        return { ok: false, error: 'Invalid subscriptionPlan (expected string preset ID)' };
    }
    const cleaned = value.trim();
    if (!isSubscriptionPlanPresetId(cleaned) && cleaned !== 'google-ai-ultra') {
        return {
            ok: false,
            error: `Invalid subscriptionPlan "${cleaned}" (expected one of ${SUBSCRIPTION_PLAN_PRESET_ORDER.join(', ')})`,
        };
    }
    return { ok: true, value: normalizeSubscriptionPlanId(cleaned, monthlyFee) };
}

export function validateSubscriptionMonthlyFee(
    value: unknown,
): ValidationResult<number | null> {
    if (value === null || value === undefined || value === '') {
        return { ok: true, value: null };
    }
    const parsed = parseStrictFiniteNumber(value);
    if (parsed === null || parsed < 0 || parsed > MAX_SUBSCRIPTION_MONTHLY_FEE) {
        return {
            ok: false,
            error: `Invalid subscriptionMonthlyFee (must be null or a finite number in [0, ${MAX_SUBSCRIPTION_MONTHLY_FEE}])`,
        };
    }
    return { ok: true, value: parsed > 0 ? parsed : null };
}

export function validateSupportedCurrency(
    value: unknown,
    fieldName = 'currency',
): ValidationResult<CurrencyCode> {
    if (typeof value !== 'string' || !isCurrencyCode(value)) {
        return {
            ok: false,
            error: `Invalid ${fieldName} (expected one of ${CURRENCY_CODES.join(', ')})`,
        };
    }
    return { ok: true, value: normalizeCurrencyCode(value) };
}

export function validateSubscriptionCurrency(value: unknown): ValidationResult<CurrencyCode> {
    return validateSupportedCurrency(value, 'subscriptionCurrency');
}

export function validateDisplayCurrency(value: unknown): ValidationResult<CurrencyCode> {
    return validateSupportedCurrency(value, 'displayCurrency');
}

export function validateCustomFxRate(value: unknown): ValidationResult<number | null> {
    if (value === null || value === undefined || value === '') {
        return { ok: true, value: null };
    }
    const parsed = parseStrictFiniteNumber(value);
    if (parsed === null || !isValidCustomFxRate(parsed)) {
        return {
            ok: false,
            error: `Invalid customFxRate (must be null or a finite number in [${MIN_CUSTOM_FX_RATE}, ${MAX_CUSTOM_FX_RATE}])`,
        };
    }
    return { ok: true, value: parsed };
}

export interface NormalizedSubscriptionSettings {
    subscriptionPlan: SubscriptionPlanPresetId;
    subscriptionMonthlyFee: number | null;
    subscriptionCurrency: CurrencyCode;
}

/**
 * Normalize and coherently reconcile `{ subscriptionPlan, subscriptionMonthlyFee, subscriptionCurrency }`.
 * - Validates currency against all 10 supported currencies (including `CAD`).
 * - Clears fee when plan is `'none'` (unless no plan was provided and a positive fee implies `'custom'`).
 * - Fills preset USD fee & currency when a named preset has no explicit fee.
 */
export function normalizeSubscriptionSettings(raw: {
    subscriptionPlan?: unknown;
    subscriptionMonthlyFee?: unknown;
    subscriptionCurrency?: unknown;
} | null | undefined): NormalizedSubscriptionSettings {
    const feeRes = validateSubscriptionMonthlyFee(raw?.subscriptionMonthlyFee);
    const validFee = feeRes.ok ? feeRes.value : null;
    const currency = normalizeCurrencyCode(raw?.subscriptionCurrency, 'USD');

    const hasExplicitNone = typeof raw?.subscriptionPlan === 'string' && raw.subscriptionPlan.trim() === 'none';
    if (hasExplicitNone) {
        return {
            subscriptionPlan: 'none',
            subscriptionMonthlyFee: null,
            subscriptionCurrency: currency,
        };
    }

    const plan = normalizeSubscriptionPlanId(raw?.subscriptionPlan, validFee);
    if (plan === 'none') {
        return {
            subscriptionPlan: 'none',
            subscriptionMonthlyFee: null,
            subscriptionCurrency: currency,
        };
    }

    const preset = SUBSCRIPTION_PLAN_PRESETS[plan];
    if (preset.monthlyUsd > 0 && validFee === null) {
        return {
            subscriptionPlan: plan,
            subscriptionMonthlyFee: preset.monthlyUsd,
            subscriptionCurrency: 'USD',
        };
    }

    return {
        subscriptionPlan: plan,
        subscriptionMonthlyFee: validFee,
        subscriptionCurrency: currency,
    };
}

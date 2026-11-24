// ─── CLI Usage Scanner, Multi-Currency, Subscription ROI & Export Engine ─────
// Zero-dependency, strictly read-only, mtime+size cached scanner for Antigravity
// CLI local session data (~/.gemini/antigravity-cli), plus multi-currency FX
// conversion, optional Subscription Plan ROI estimator, and pure CSV/JSON export
// builders for the Calendar & Activity Heatmap dashboard.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { normalizeModelDisplayName } from './models';
import {
    costFromTokens,
    findPricingForDate,
    formatUsdCost,
    type ModelPricing,
} from './pricing-store';
import {
    computeAdditiveTokens,
    type DailyCycleEntry,
    type DailyRecord,
    type GMModelCycleStats,
} from './daily-store';
import { toLocalDateKey, type UsageSurface } from './daily-ledger';
import { MIN_OUTPUT_TOKENS_FOR_SPEED, MIN_STREAM_SECONDS } from './telemetry-metrics';

// ─── Multi-Currency Conversion Engine ────────────────────────────────────────

export type CurrencyCode = 'USD' | 'CNY' | 'EUR' | 'JPY' | 'KRW' | 'GBP' | 'AUD' | 'HKD' | 'TWD';

export const CURRENCY_CODES: readonly CurrencyCode[] = [
    'USD', 'CNY', 'EUR', 'JPY', 'KRW', 'GBP', 'AUD', 'HKD', 'TWD',
] as const;

export interface CurrencyPreset {
    code: CurrencyCode;
    symbol: string;
    nameEn: string;
    nameZh: string;
    /** Indicative reference units per 1 USD (override via CurrencyConfig.customRatePerUsd). */
    defaultRatePerUsd: number;
    /** Standard fractional precision (0 for JPY/KRW/TWD, 2 for major decimal currencies). */
    decimals: number;
}

export const CURRENCY_PRESETS: Readonly<Record<CurrencyCode, CurrencyPreset>> = {
    USD: { code: 'USD', symbol: '$', nameEn: 'US Dollar', nameZh: '美元', defaultRatePerUsd: 1, decimals: 2 },
    CNY: { code: 'CNY', symbol: '¥', nameEn: 'Chinese Yuan', nameZh: '人民币', defaultRatePerUsd: 7.25, decimals: 2 },
    EUR: { code: 'EUR', symbol: '€', nameEn: 'Euro', nameZh: '欧元', defaultRatePerUsd: 0.92, decimals: 2 },
    JPY: { code: 'JPY', symbol: '¥', nameEn: 'Japanese Yen', nameZh: '日元', defaultRatePerUsd: 154, decimals: 0 },
    KRW: { code: 'KRW', symbol: '₩', nameEn: 'South Korean Won', nameZh: '韩元', defaultRatePerUsd: 1390, decimals: 0 },
    GBP: { code: 'GBP', symbol: '£', nameEn: 'British Pound', nameZh: '英镑', defaultRatePerUsd: 0.79, decimals: 2 },
    AUD: { code: 'AUD', symbol: 'A$', nameEn: 'Australian Dollar', nameZh: '澳元', defaultRatePerUsd: 1.54, decimals: 2 },
    HKD: { code: 'HKD', symbol: 'HK$', nameEn: 'Hong Kong Dollar', nameZh: '港元', defaultRatePerUsd: 7.78, decimals: 2 },
    TWD: { code: 'TWD', symbol: 'NT$', nameEn: 'New Taiwan Dollar', nameZh: '新台币', defaultRatePerUsd: 32.4, decimals: 0 },
};

export interface CurrencyConfig {
    code: CurrencyCode;
    /** Optional user-provided exchange rate override (units per 1 USD, must be > 0). */
    customRatePerUsd?: number;
}

export type CurrencyInput = CurrencyCode | Partial<CurrencyConfig> | null | undefined;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_PRESETS, value.toUpperCase());
}

export function resolveCurrencyConfig(input?: CurrencyInput): {
    preset: CurrencyPreset;
    ratePerUsd: number;
    isCustomRate: boolean;
} {
    if (!input) {
        return { preset: CURRENCY_PRESETS.USD, ratePerUsd: 1, isCustomRate: false };
    }
    const rawCode = typeof input === 'string' ? input : input.code;
    const upper = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : 'USD';
    const preset = isCurrencyCode(upper) ? CURRENCY_PRESETS[upper] : CURRENCY_PRESETS.USD;

    const customRate = typeof input === 'object' ? input.customRatePerUsd : undefined;
    if (preset.code !== 'USD' && typeof customRate === 'number' && Number.isFinite(customRate) && customRate > 0) {
        return { preset, ratePerUsd: customRate, isCustomRate: true };
    }
    return { preset, ratePerUsd: preset.defaultRatePerUsd, isCustomRate: false };
}

export function convertUsdToCurrency(usd: number, currency?: CurrencyInput): number {
    if (!Number.isFinite(usd)) { return Number.NaN; }
    const { ratePerUsd } = resolveCurrencyConfig(currency);
    return usd * ratePerUsd;
}

export function convertCurrencyToUsd(amount: number, currency?: CurrencyInput): number {
    if (!Number.isFinite(amount)) { return Number.NaN; }
    const { ratePerUsd } = resolveCurrencyConfig(currency);
    return ratePerUsd > 0 ? amount / ratePerUsd : Number.NaN;
}

export interface FormatCurrencyOptions {
    /** Return '—' when amount <= 0 (default: false). */
    zeroAsDash?: boolean;
    /** Preserve negative sign instead of clamping to 0 (default: false). */
    allowNegative?: boolean;
}

/**
 * Format a USD amount into the requested currency (using USD standard formatter when USD).
 * Returns '—' for non-finite inputs (`NaN`, `Infinity`, `-Infinity`).
 */
export function formatCurrencyAmount(
    usdAmount: number,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): string {
    if (!Number.isFinite(usdAmount)) { return '—'; }
    const zeroAsDash = options.zeroAsDash ?? false;
    const allowNegative = options.allowNegative ?? false;
    if (zeroAsDash && usdAmount <= 0) { return '—'; }

    const { preset, ratePerUsd } = resolveCurrencyConfig(currency);
    if (preset.code === 'USD') {
        return formatUsdCost(usdAmount, { precision: 'standard', allowNegative });
    }

    const convertedRaw = usdAmount * ratePerUsd;
    const normalized = !allowNegative && convertedRaw < 0 ? 0 : (Object.is(convertedRaw, -0) ? 0 : convertedRaw);
    const abs = Math.abs(normalized);

    let formatted: string;
    if (abs === 0) {
        formatted = preset.decimals === 0 ? '0' : (0).toFixed(preset.decimals);
    } else if (preset.decimals === 0) {
        formatted = abs < 1 ? abs.toFixed(2) : Math.round(abs).toLocaleString('en-US');
    } else if (abs < 0.01 && Number(abs.toFixed(4)) < 0.01) {
        formatted = abs.toFixed(4);
    } else {
        formatted = abs >= 1000
            ? abs.toLocaleString('en-US', { minimumFractionDigits: preset.decimals, maximumFractionDigits: preset.decimals })
            : abs.toFixed(preset.decimals);
    }

    const isZero = /^0(?:\.0+)?$/.test(formatted);
    const sign = normalized < 0 && !isZero ? '-' : '';
    return `${sign}${preset.symbol}${formatted}`;
}

/**
 * Format cost showing local currency + USD reference when non-USD, or pure USD when USD.
 */
export function formatDualCurrencyAmount(
    usdAmount: number,
    currency?: CurrencyInput,
    options: FormatCurrencyOptions = {},
): string {
    if (!Number.isFinite(usdAmount)) { return '—'; }
    if (options.zeroAsDash && usdAmount <= 0) { return '—'; }
    const { preset } = resolveCurrencyConfig(currency);
    const primary = formatCurrencyAmount(usdAmount, currency, options);
    if (preset.code === 'USD') { return primary; }
    const usdStr = formatUsdCost(usdAmount, { precision: 'standard', allowNegative: options.allowNegative });
    return `${primary} (${usdStr})`;
}

// ─── Subscription Plan ROI Estimator ─────────────────────────────────────────

export type SubscriptionPlanPresetId =
    | 'none'
    | 'google-ai-pro'
    | 'google-ai-ultra-5x'
    | 'google-ai-ultra-20x'
    | 'custom';

export const SUBSCRIPTION_PLAN_PRESET_ORDER: readonly SubscriptionPlanPresetId[] = [
    'none',
    'google-ai-pro',
    'google-ai-ultra-5x',
    'google-ai-ultra-20x',
    'custom',
] as const;

export interface SubscriptionPlanPreset {
    id: SubscriptionPlanPresetId;
    labelEn: string;
    labelZh: string;
    /** Indicative US monthly fee in USD (0 for 'none' and 'custom'). */
    monthlyUsd: number;
}

export const SUBSCRIPTION_PLAN_PRESETS: Readonly<Record<SubscriptionPlanPresetId, SubscriptionPlanPreset>> = {
    none: { id: 'none', labelEn: 'Off', labelZh: '未启用', monthlyUsd: 0 },
    'google-ai-pro': { id: 'google-ai-pro', labelEn: 'Google AI Pro', labelZh: 'Google AI Pro', monthlyUsd: 19.99 },
    'google-ai-ultra-5x': { id: 'google-ai-ultra-5x', labelEn: 'Google AI Ultra 5x', labelZh: 'Google AI Ultra 5x', monthlyUsd: 99.99 },
    'google-ai-ultra-20x': { id: 'google-ai-ultra-20x', labelEn: 'Google AI Ultra 20x', labelZh: 'Google AI Ultra 20x', monthlyUsd: 199.99 },
    custom: { id: 'custom', labelEn: 'Custom Plan', labelZh: '自定义订阅', monthlyUsd: 0 },
};

export function isSubscriptionPlanPresetId(value: unknown): value is SubscriptionPlanPresetId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLAN_PRESETS, value);
}

/**
 * Normalize a raw or persisted subscription plan ID (including backward-compatible
 * migration for legacy `'google-ai-ultra'` and fee-based inference when empty).
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

export interface SubscriptionConfig {
    planId: SubscriptionPlanPresetId;
    /** Optional user-entered monthly fee (in `feeCurrency`, or display currency when omitted). */
    monthlyFee?: number;
    feeCurrency?: CurrencyCode;
    customRatePerUsd?: number;
}

export interface SubscriptionRoiEstimate {
    enabled: boolean;
    planId: SubscriptionPlanPresetId;
    planLabelEn: string;
    planLabelZh: string;
    periodDays: number;
    monthlyFeeUsd: number;
    proratedFeeUsd: number;
    apiReferenceValueUsd: number;
    /** Ratio = apiReferenceValueUsd / proratedFeeUsd (null when prorated fee <= 0). */
    roiMultiple: number | null;
    /** apiReferenceValueUsd - proratedFeeUsd (may be negative). */
    deltaUsd: number;
    disclaimerEn: string;
    disclaimerZh: string;
}

export const ROI_DISCLAIMER_EN = 'Reference ratio only: public API list rates do not equal actual cash saved or subscription billing.';
export const ROI_DISCLAIMER_ZH = '仅供参考比值：公开 API 标价不等于实际省下的现金或真实订阅计费。';

/**
 * Estimate prorated Subscription Plan ROI against public API reference cost.
 * Returns `null` when subscription tracking is disabled (`planId === 'none'` or invalid fee <= 0).
 */
export function estimateSubscriptionRoi(
    apiReferenceValueUsd: number,
    periodDays: number,
    subscription?: SubscriptionConfig | null,
    displayCurrency?: CurrencyInput,
): SubscriptionRoiEstimate | null {
    if (!subscription) { return null; }
    const normalizedPlanId = normalizeSubscriptionPlanId(subscription.planId, subscription.monthlyFee);
    if (normalizedPlanId === 'none') { return null; }
    const preset = SUBSCRIPTION_PLAN_PRESETS[normalizedPlanId];
    if (!preset) { return null; }

    let monthlyFeeUsd = preset.monthlyUsd;
    if (typeof subscription.monthlyFee === 'number' && Number.isFinite(subscription.monthlyFee) && subscription.monthlyFee > 0) {
        const feeCurrencyConfig: CurrencyInput = subscription.feeCurrency
            ? { code: subscription.feeCurrency, customRatePerUsd: subscription.customRatePerUsd }
            : displayCurrency;
        monthlyFeeUsd = convertCurrencyToUsd(subscription.monthlyFee, feeCurrencyConfig);
    }

    if (!Number.isFinite(monthlyFeeUsd) || monthlyFeeUsd <= 0) {
        return null;
    }

    const safeDays = Math.max(1, Number.isFinite(periodDays) ? Math.round(periodDays) : 1);
    const safeApiUsd = Number.isFinite(apiReferenceValueUsd) && apiReferenceValueUsd > 0 ? apiReferenceValueUsd : 0;
    const proratedFeeUsd = monthlyFeeUsd * (safeDays / 30);
    const roiMultiple = proratedFeeUsd > 0 ? safeApiUsd / proratedFeeUsd : null;

    return {
        enabled: true,
        planId: preset.id,
        planLabelEn: preset.labelEn,
        planLabelZh: preset.labelZh,
        periodDays: safeDays,
        monthlyFeeUsd,
        proratedFeeUsd,
        apiReferenceValueUsd: safeApiUsd,
        roiMultiple,
        deltaUsd: safeApiUsd - proratedFeeUsd,
        disclaimerEn: ROI_DISCLAIMER_EN,
        disclaimerZh: ROI_DISCLAIMER_ZH,
    };
}

// ─── CLI Usage Scanner Types ─────────────────────────────────────────────────

export interface CliParsedCall {
    callId: string;
    sessionId: string;
    dateKey: string;
    createdAtMs: number;
    modelKey: string;
    responseModel: string;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    ttftSeconds: number;
    streamingSeconds: number;
}

export interface CliModelDayStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    estimatedCost: number;
    avgTTFT: number;
    avgStreaming?: number;
    avgGenTokPerSec?: number;
    cacheHitRate: number;
    tokenCacheHitRate?: number;
}

export interface CliDailyUsageRecord {
    date: string; // 'YYYY-MM-DD'
    surface: 'cli';
    calls: number;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** Additive total: inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens */
    totalTokens: number;
    credits: number;
    estimatedCost: number;
    models: Record<string, CliModelDayStats>;
}

export interface CliScanOptions {
    /** Override root directory (defaults to ~/.gemini/antigravity-cli or $ANTIGRAVITY_CLI_DATA_DIR). */
    cliRootDir?: string;
    /** Custom pricing overrides for estimating API cost of CLI calls. */
    customPricing?: Record<string, ModelPricing>;
    /** Maximum number of files to inspect per scan (default: 1500). */
    maxFiles?: number;
    /** Ignore files older than N days by mtime when > 0 (default: 400). */
    maxAgeDays?: number;
    /** Optional deterministic clock override for testing. */
    now?: Date | number;
    /** Disable SQLite reader (useful for testing JSONL-only fallback). */
    disableSqlite?: boolean;
}

export interface CliScanResult {
    available: boolean;
    rootDir: string;
    days: CliDailyUsageRecord[];
    filesScanned: number;
    cacheHits: number;
    cacheMisses: number;
    errorsSkipped: number;
    scannedAt: string;
}

// ─── Minimal Zero-Dep Protobuf Wire Reader (for CLI conversations/*.db) ──────

interface ProtoField {
    fn: number;
    wt: number;
    varint?: number;
    bytes?: Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): [number, number] | null {
    let result = 0;
    let shift = 0;
    while (pos < buf.length) {
        const b = buf[pos++];
        // Keep safe integer arithmetic up to 53 bits; clamp huge unsigned 64-bit sentinels cleanly
        if (shift < 49) {
            result += (b & 0x7f) * Math.pow(2, shift);
        }
        if ((b & 0x80) === 0) {
            return [result, pos];
        }
        shift += 7;
        if (shift > 70) { return null; }
    }
    return null;
}

function parseProtoFields(buf: Uint8Array): ProtoField[] {
    const fields: ProtoField[] = [];
    let pos = 0;
    while (pos < buf.length) {
        const tagPair = readVarint(buf, pos);
        if (!tagPair) { break; }
        const [tag, afterTag] = tagPair;
        pos = afterTag;
        const fn = Math.floor(tag / 8);
        const wt = tag & 7;
        if (fn <= 0) { break; }

        if (wt === 0) {
            const valPair = readVarint(buf, pos);
            if (!valPair) { break; }
            fields.push({ fn, wt, varint: valPair[0] });
            pos = valPair[1];
        } else if (wt === 1) {
            if (pos + 8 > buf.length) { break; }
            pos += 8;
        } else if (wt === 2) {
            const lenPair = readVarint(buf, pos);
            if (!lenPair) { break; }
            const [len, afterLen] = lenPair;
            if (len < 0 || afterLen + len > buf.length) { break; }
            fields.push({ fn, wt, bytes: buf.subarray(afterLen, afterLen + len) });
            pos = afterLen + len;
        } else if (wt === 5) {
            if (pos + 4 > buf.length) { break; }
            pos += 4;
        } else {
            break;
        }
    }
    return fields;
}

function decodeProtoDurationSeconds(buf: Uint8Array | undefined): number {
    if (!buf || buf.length === 0) { return 0; }
    let seconds = 0;
    let nanos = 0;
    for (const f of parseProtoFields(buf)) {
        if (f.wt !== 0 || f.varint === undefined) { continue; }
        if (f.fn === 1) { seconds = f.varint; }
        else if (f.fn === 2) { nanos = f.varint; }
    }
    const total = seconds + nanos / 1e9;
    // Reject negative / absurd durations (e.g. unsigned -1 sentinels)
    return Number.isFinite(total) && total > 0 && total < 86400 ? total : 0;
}

function decodeProtoTimestampMs(buf: Uint8Array | undefined): number {
    if (!buf || buf.length === 0) { return 0; }
    let seconds = 0;
    let nanos = 0;
    for (const f of parseProtoFields(buf)) {
        if (f.wt !== 0 || f.varint === undefined) { continue; }
        if (f.fn === 1) { seconds = f.varint; }
        else if (f.fn === 2) { nanos = f.varint; }
    }
    // Valid Unix epoch between 2020-01-01 and 2100-01-01
    if (seconds < 1_577_836_800 || seconds > 4_102_444_800) { return 0; }
    return seconds * 1000 + Math.floor(nanos / 1e6);
}

function decodePackedVarints(buf: Uint8Array): number[] {
    const out: number[] = [];
    let pos = 0;
    while (pos < buf.length) {
        const pair = readVarint(buf, pos);
        if (!pair) { break; }
        out.push(pair[0]);
        pos = pair[1];
    }
    return out;
}

function decodeUtf8Safe(buf: Uint8Array | undefined): string {
    if (!buf || buf.length === 0) { return ''; }
    try {
        return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('utf8').trim();
    } catch {
        return '';
    }
}

/**
 * Decode a single Antigravity CLI `gen_metadata.data` protobuf blob into a {@link CliParsedCall}.
 * Pure, zero-dep, and resilient against corrupt/unknown payloads (returns `null` instead of throwing).
 */
export function decodeCliGenMetadataBlob(
    blob: Uint8Array,
    sessionId: string,
    rowIdx: number,
    fallbackCreatedAtMs: number,
    stepTimestamps?: Map<number, number>,
): CliParsedCall | null {
    if (!blob || blob.length === 0) { return null; }
    try {
        const top = parseProtoFields(blob);
        const chatModelField = top.find(f => f.fn === 1 && f.wt === 2 && f.bytes);
        if (!chatModelField?.bytes) { return null; }

        const execIdField = top.find(f => f.fn === 4 && f.wt === 2 && f.bytes);
        const executionId = decodeUtf8Safe(execIdField?.bytes);

        const stepIndices: number[] = [];
        for (const f of top) {
            if (f.fn !== 2) { continue; }
            if (f.wt === 0 && f.varint !== undefined) {
                stepIndices.push(f.varint);
            } else if (f.wt === 2 && f.bytes) {
                stepIndices.push(...decodePackedVarints(f.bytes));
            }
        }

        const cmFields = parseProtoFields(chatModelField.bytes);
        const usageField = cmFields.find(f => f.fn === 4 && f.wt === 2 && f.bytes);
        if (!usageField?.bytes) { return null; }

        let inputTokens = 0;
        let outputTokens = 0;
        let cacheCreationTokens = 0;
        let cacheReadTokens = 0;
        let thinkingTokens = 0;

        for (const uf of parseProtoFields(usageField.bytes)) {
            if (uf.wt !== 0 || uf.varint === undefined) { continue; }
            // Antigravity ModelUsageStats protobuf layout:
            // 1 = model enum, 2 = inputTokens, 3 = outputTokens, 4 = cacheCreationTokens,
            // 5 = cacheReadTokens, 9 = thinkingOutputTokens, 10 = responseOutputTokens
            if (uf.fn === 2) { inputTokens = uf.varint; }
            else if (uf.fn === 3) { outputTokens = uf.varint; }
            else if (uf.fn === 4) { cacheCreationTokens = uf.varint; }
            else if (uf.fn === 5) { cacheReadTokens = uf.varint; }
            else if (uf.fn === 9) { thinkingTokens = uf.varint; }
        }

        const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
        if (totalTokens <= 0) { return null; }

        const responseModel = decodeUtf8Safe(cmFields.find(f => f.fn === 19 && f.wt === 2)?.bytes);
        const displayName = decodeUtf8Safe(cmFields.find(f => f.fn === 21 && f.wt === 2)?.bytes);
        const rawModel = displayName || responseModel || 'CLI Model';
        const modelKey = normalizeModelDisplayName(rawModel) || rawModel;

        const ttftSeconds = decodeProtoDurationSeconds(cmFields.find(f => f.fn === 11 && f.wt === 2)?.bytes);
        const streamingSeconds = decodeProtoDurationSeconds(cmFields.find(f => f.fn === 12 && f.wt === 2)?.bytes);

        let createdAtMs = 0;
        const csmField = cmFields.find(f => f.fn === 9 && f.wt === 2 && f.bytes);
        if (csmField?.bytes) {
            const tsField = parseProtoFields(csmField.bytes).find(f => f.fn === 4 && f.wt === 2 && f.bytes);
            createdAtMs = decodeProtoTimestampMs(tsField?.bytes);
        }
        if (createdAtMs <= 0 && stepTimestamps && stepIndices.length > 0) {
            for (const si of stepIndices) {
                const st = stepTimestamps.get(si);
                if (st && st > 0) {
                    createdAtMs = st;
                    break;
                }
            }
        }
        if (createdAtMs <= 0) {
            createdAtMs = fallbackCreatedAtMs;
        }
        if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) { return null; }

        return {
            callId: executionId || `cli-db:${sessionId}:${rowIdx}`,
            sessionId,
            dateKey: toLocalDateKey(new Date(createdAtMs)),
            createdAtMs,
            modelKey,
            responseModel: responseModel || modelKey,
            inputTokens,
            outputTokens,
            thinkingTokens,
            cacheReadTokens,
            cacheCreationTokens,
            credits: 0,
            ttftSeconds,
            streamingSeconds,
        };
    } catch {
        return null;
    }
}

function decodeStepTimestampBlob(blob: Uint8Array): number {
    if (!blob || blob.length === 0) { return 0; }
    try {
        const fields = parseProtoFields(blob);
        // Field 1 on StepMetadata is createdAt (google.protobuf.Timestamp)
        const tsField = fields.find(f => f.fn === 1 && f.wt === 2 && f.bytes);
        return decodeProtoTimestampMs(tsField?.bytes);
    } catch {
        return 0;
    }
}

// ─── JSON / JSONL CLI Transcript Usage Parser ────────────────────────────────

function readNonNegInt(obj: Record<string, unknown>, keys: readonly string[]): number {
    for (const key of keys) {
        const raw = obj[key];
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            return Math.floor(raw);
        }
        if (typeof raw === 'string' && raw.trim()) {
            const parsed = Number(raw.trim());
            if (Number.isFinite(parsed) && parsed > 0) {
                return Math.floor(parsed);
            }
        }
    }
    return 0;
}

function readNonNegFloat(obj: Record<string, unknown>, keys: readonly string[]): number {
    for (const key of keys) {
        const raw = obj[key];
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            return raw;
        }
        if (typeof raw === 'string' && raw.trim()) {
            const parsed = Number(raw.trim().replace(/s$/i, ''));
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
    }
    return 0;
}

function readStringField(obj: Record<string, unknown>, keys: readonly string[]): string {
    for (const key of keys) {
        const raw = obj[key];
        if (typeof raw === 'string' && raw.trim()) {
            return raw.trim();
        }
    }
    return '';
}

function extractUsageObject(record: Record<string, unknown>): Record<string, unknown> | null {
    const directCandidates = [
        record.usage,
        record.usageMetadata,
        record.tokenUsage,
        record.modelUsage,
    ];
    for (const cand of directCandidates) {
        if (cand && typeof cand === 'object' && !Array.isArray(cand)) {
            return cand as Record<string, unknown>;
        }
    }
    const gm = record.generatorMetadata as Record<string, unknown> | undefined;
    if (gm && typeof gm === 'object') {
        const cm = gm.chatModel as Record<string, unknown> | undefined;
        if (cm && typeof cm === 'object' && cm.usage && typeof cm.usage === 'object') {
            return cm.usage as Record<string, unknown>;
        }
    }
    const meta = record.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object') {
        return extractUsageObject(meta);
    }
    if (
        record.inputTokens !== undefined
        || record.input_tokens !== undefined
        || record.promptTokenCount !== undefined
        || record.outputTokens !== undefined
        || record.output_tokens !== undefined
        || record.candidatesTokenCount !== undefined
    ) {
        return record;
    }
    return null;
}

function parseTimestampMs(raw: unknown, fallbackMs: number): number {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return raw < 1e11 ? raw * 1000 : raw;
    }
    if (typeof raw === 'string' && raw.trim()) {
        const parsed = Date.parse(raw.trim());
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return fallbackMs;
}

function parseJsonRecordToCliCall(
    record: unknown,
    sessionId: string,
    lineIdx: number,
    fallbackMs: number,
): CliParsedCall | null {
    if (!record || typeof record !== 'object' || Array.isArray(record)) { return null; }
    const obj = record as Record<string, unknown>;
    const usage = extractUsageObject(obj);
    if (!usage) { return null; }

    const inputTokens = readNonNegInt(usage, ['inputTokens', 'input_tokens', 'promptTokenCount', 'prompt_tokens']);
    const outputTokens = readNonNegInt(usage, ['outputTokens', 'output_tokens', 'candidatesTokenCount', 'completion_tokens']);
    const cacheReadTokens = readNonNegInt(usage, ['cacheReadTokens', 'cache_read_tokens', 'cachedContentTokenCount', 'cache_read_input_tokens']);
    const cacheCreationTokens = readNonNegInt(usage, ['cacheCreationTokens', 'cache_creation_tokens', 'cache_creation_input_tokens']);
    const thinkingTokens = readNonNegInt(usage, ['thinkingTokens', 'thinking_tokens', 'thinkingOutputTokens', 'thoughtsTokenCount']);
    const credits = readNonNegInt(usage, ['credits', 'consumedCredits']) || readNonNegInt(obj, ['credits']);

    if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) {
        return null;
    }

    const gm = (obj.generatorMetadata && typeof obj.generatorMetadata === 'object')
        ? obj.generatorMetadata as Record<string, unknown>
        : undefined;
    const cm = (gm?.chatModel && typeof gm.chatModel === 'object')
        ? gm.chatModel as Record<string, unknown>
        : undefined;

    const responseModel = readStringField(obj, ['responseModel', 'response_model', 'model'])
        || (cm ? readStringField(cm, ['responseModel', 'modelDisplayName', 'model']) : '')
        || readStringField(usage, ['responseModel', 'model']);
    const displayCandidate = readStringField(obj, ['modelDisplay', 'modelDisplayName', 'model_display'])
        || (cm ? readStringField(cm, ['modelDisplayName']) : '')
        || responseModel
        || 'CLI Model';
    const modelKey = normalizeModelDisplayName(displayCandidate) || displayCandidate;

    const createdAtMs = parseTimestampMs(
        obj.created_at ?? obj.createdAt ?? obj.timestamp ?? obj.time,
        fallbackMs,
    );
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) { return null; }

    const ttftSeconds = readNonNegFloat(obj, ['ttftSeconds', 'ttft_seconds'])
        || (cm ? readNonNegFloat(cm, ['timeToFirstToken', 'ttftSeconds']) : 0);
    const streamingSeconds = readNonNegFloat(obj, ['streamingSeconds', 'streaming_seconds'])
        || (cm ? readNonNegFloat(cm, ['streamingDuration', 'streamingSeconds']) : 0);

    const execId = readStringField(obj, ['executionId', 'execution_id', 'callId', 'call_id', 'id']);
    return {
        callId: execId || `cli-json:${sessionId}:${lineIdx}`,
        sessionId,
        dateKey: toLocalDateKey(new Date(createdAtMs)),
        createdAtMs,
        modelKey,
        responseModel: responseModel || modelKey,
        inputTokens,
        outputTokens,
        thinkingTokens,
        cacheReadTokens,
        cacheCreationTokens,
        credits,
        ttftSeconds,
        streamingSeconds,
    };
}

function parseJsonlFileToCliCalls(filePath: string, sessionId: string, fallbackMs: number): CliParsedCall[] {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) { return []; }

    const calls: CliParsedCall[] = [];
    const trimmed = raw.trim();

    // Handle single JSON document (.json array or object with calls/entries)
    if (filePath.endsWith('.json') || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            const list = Array.isArray(parsed)
                ? parsed
                : (parsed && typeof parsed === 'object'
                    ? (Array.isArray((parsed as Record<string, unknown>).calls)
                        ? (parsed as Record<string, unknown>).calls as unknown[]
                        : Array.isArray((parsed as Record<string, unknown>).entries)
                            ? (parsed as Record<string, unknown>).entries as unknown[]
                            : [parsed])
                    : []);
            for (let i = 0; i < list.length; i++) {
                const call = parseJsonRecordToCliCall(list[i], sessionId, i, fallbackMs);
                if (call) { calls.push(call); }
            }
            return calls;
        } catch {
            // Fall through to line-delimited JSONL
        }
    }

    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || !line.startsWith('{')) { continue; }
        // Fast skip lines that clearly cannot contain any token usage
        if (!/(?:token|usage|input|output|cache)/i.test(line)) { continue; }
        try {
            const obj = JSON.parse(line) as unknown;
            const call = parseJsonRecordToCliCall(obj, sessionId, i, fallbackMs);
            if (call) { calls.push(call); }
        } catch {
            // Skip malformed JSONL lines gracefully
        }
    }
    return calls;
}

// ─── Dynamic Optional node:sqlite Loader (Zero External Deps) ────────────────

interface SqliteStatementLike {
    all(...params: unknown[]): Array<Record<string, unknown>>;
}

interface SqliteDatabaseLike {
    prepare(sql: string): SqliteStatementLike;
    close(): void;
}

type SqliteConstructor = new (filename: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike;

let cachedSqliteCtor: SqliteConstructor | null | undefined;

function loadBuiltinSqlite(): SqliteConstructor | null {
    if (cachedSqliteCtor !== undefined) {
        return cachedSqliteCtor;
    }
    try {
        // Dynamic require keeps compatibility with runtimes without node:sqlite (e.g. older Node)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('node:sqlite') as { DatabaseSync?: SqliteConstructor };
        cachedSqliteCtor = typeof mod?.DatabaseSync === 'function' ? mod.DatabaseSync : null;
    } catch {
        cachedSqliteCtor = null;
    }
    return cachedSqliteCtor;
}

function parseSqliteDbToCliCalls(dbPath: string, sessionId: string, fallbackMs: number): CliParsedCall[] {
    const DatabaseSync = loadBuiltinSqlite();
    if (!DatabaseSync) { return []; }

    let db: SqliteDatabaseLike | null = null;
    try {
        // When no active non-empty WAL exists, open with ?immutable=1 so SQLite
        // never creates -wal/-shm sidecar files (strictly zero-write read-only).
        const walStat = safeStat(`${dbPath}-wal`);
        const hasActiveWal = Boolean(walStat && walStat.isFile() && walStat.size > 0);
        const openTarget = hasActiveWal
            ? dbPath
            : `${pathToFileURL(dbPath).href}?immutable=1`;
        db = new DatabaseSync(openTarget, { readOnly: true });
        const gmRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
        if (!gmRows || gmRows.length === 0) { return []; }

        let stepTimestamps: Map<number, number> | undefined;
        const calls: CliParsedCall[] = [];

        const ensureStepTimestamps = (): Map<number, number> => {
            if (stepTimestamps) { return stepTimestamps; }
            stepTimestamps = new Map<number, number>();
            try {
                const sRows = db!.prepare('SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL').all();
                for (const sr of sRows) {
                    const sIdx = typeof sr.idx === 'number' ? sr.idx : Number(sr.idx);
                    const meta = sr.metadata;
                    if (Number.isFinite(sIdx) && meta instanceof Uint8Array) {
                        const ts = decodeStepTimestampBlob(meta);
                        if (ts > 0) { stepTimestamps.set(sIdx, ts); }
                    }
                }
            } catch {
                // steps table optional
            }
            return stepTimestamps;
        };

        for (let i = 0; i < gmRows.length; i++) {
            const row = gmRows[i];
            const data = row.data;
            if (!(data instanceof Uint8Array) || data.length === 0) { continue; }
            const rowIdx = typeof row.idx === 'number' ? row.idx : i;

            // First try without scanning steps; only lazily read steps if createdAt is missing
            let parsed = decodeCliGenMetadataBlob(data, sessionId, rowIdx, 0);
            if (!parsed) {
                parsed = decodeCliGenMetadataBlob(data, sessionId, rowIdx, fallbackMs, ensureStepTimestamps());
            }
            if (parsed) {
                calls.push(parsed);
            }
        }
        return calls;
    } catch {
        return [];
    } finally {
        if (db) {
            try { db.close(); } catch { /* ignore */ }
        }
    }
}

// ─── Cross-Platform CLI Directory Resolution ─────────────────────────────────

/**
 * Resolve default Antigravity CLI local data directory across macOS, Windows, and Linux.
 * Honors `ANTIGRAVITY_CLI_DATA_DIR` when provided; otherwise `~/.gemini/antigravity-cli`.
 */
export function resolveDefaultCliDataDir(
    env: Record<string, string | undefined> = process.env,
    homeDir?: string,
): string {
    const override = env.ANTIGRAVITY_CLI_DATA_DIR?.trim();
    if (override) {
        return path.resolve(override);
    }
    const home = homeDir?.trim()
        || env.HOME?.trim()
        || env.USERPROFILE?.trim()
        || os.homedir();
    return path.join(home, '.gemini', 'antigravity-cli');
}

// ─── CliUsageScanner (mtime + size LRU Cached, Strictly Read-Only) ───────────

interface FileCacheEntry {
    signature: string;
    calls: CliParsedCall[];
}

const DEFAULT_CACHE_LIMIT = 1500;
const DEFAULT_MAX_FILES = 1500;
const DEFAULT_MAX_AGE_DAYS = 400;

function safeStat(filePath: string): fs.Stats | null {
    try {
        return fs.statSync(filePath);
    } catch {
        return null;
    }
}

function buildFileSignature(filePath: string, stat: fs.Stats): string {
    let sig = `${Math.floor(stat.mtimeMs)}:${stat.size}`;
    if (filePath.endsWith('.db')) {
        const walStat = safeStat(`${filePath}-wal`);
        if (walStat && walStat.isFile() && walStat.size > 0) {
            sig += `|wal:${Math.floor(walStat.mtimeMs)}:${walStat.size}`;
        }
    }
    return sig;
}

export class CliUsageScanner {
    private _cache = new Map<string, FileCacheEntry>();
    private _cacheLimit: number;

    constructor(cacheLimit = DEFAULT_CACHE_LIMIT) {
        this._cacheLimit = Math.max(50, Math.floor(cacheLimit));
    }

    /** Current number of cached file entries. */
    get cacheSize(): number { return this._cache.size; }

    /** Clear in-memory mtime+size cache. */
    clearCache(): void { this._cache.clear(); }

    /**
     * Scan Antigravity CLI local session data read-only and aggregate by local day.
     * Never throws; returns `{ available: false, days: [], ... }` when directory is absent.
     */
    scan(options: CliScanOptions = {}): CliScanResult {
        const nowDate = options.now instanceof Date
            ? options.now
            : (typeof options.now === 'number' && Number.isFinite(options.now) ? new Date(options.now) : new Date());
        const nowMs = nowDate.getTime();
        const rootDir = options.cliRootDir ? path.resolve(options.cliRootDir) : resolveDefaultCliDataDir();
        const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES));
        const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        const minMtimeMs = maxAgeDays > 0 ? nowMs - maxAgeDays * 86_400_000 : 0;

        const emptyResult = (available: boolean): CliScanResult => ({
            available,
            rootDir,
            days: [],
            filesScanned: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errorsSkipped: 0,
            scannedAt: nowDate.toISOString(),
        });

        const rootStat = safeStat(rootDir);
        if (!rootStat || !rootStat.isDirectory()) {
            return emptyResult(false);
        }

        let filesScanned = 0;
        let cacheHits = 0;
        let cacheMisses = 0;
        let errorsSkipped = 0;

        const seenCallIds = new Set<string>();
        const allCalls: CliParsedCall[] = [];
        const dbSessionsWithCalls = new Set<string>();

        const ingestFile = (
            filePath: string,
            sessionId: string,
            kind: 'db' | 'jsonl',
        ): CliParsedCall[] => {
            if (filesScanned >= maxFiles) { return []; }
            const stat = safeStat(filePath);
            if (!stat || !stat.isFile()) { return []; }
            if (minMtimeMs > 0 && stat.mtimeMs < minMtimeMs) { return []; }

            filesScanned++;
            const signature = buildFileSignature(filePath, stat);
            const cached = this._cache.get(filePath);
            if (cached && cached.signature === signature) {
                // Refresh LRU order
                this._cache.delete(filePath);
                this._cache.set(filePath, cached);
                cacheHits++;
                return cached.calls;
            }

            cacheMisses++;
            let parsed: CliParsedCall[] = [];
            try {
                parsed = kind === 'db'
                    ? parseSqliteDbToCliCalls(filePath, sessionId, stat.mtimeMs)
                    : parseJsonlFileToCliCalls(filePath, sessionId, stat.mtimeMs);
            } catch {
                errorsSkipped++;
                parsed = [];
            }

            this._setCache(filePath, { signature, calls: parsed });
            return parsed;
        };

        const addCalls = (calls: CliParsedCall[]): void => {
            for (const c of calls) {
                if (seenCallIds.has(c.callId)) { continue; }
                seenCallIds.add(c.callId);
                allCalls.push(c);
            }
        };

        // 1. Scan conversations/*.db (exact protobuf gen_metadata telemetry)
        if (!options.disableSqlite) {
            const convDir = path.join(rootDir, 'conversations');
            try {
                if (safeStat(convDir)?.isDirectory()) {
                    const entries = fs.readdirSync(convDir).filter(f => f.endsWith('.db'));
                    for (const fileName of entries) {
                        if (filesScanned >= maxFiles) { break; }
                        const sessionId = fileName.slice(0, -3);
                        const calls = ingestFile(path.join(convDir, fileName), sessionId, 'db');
                        if (calls.length > 0) {
                            dbSessionsWithCalls.add(sessionId);
                            addCalls(calls);
                        }
                    }
                }
            } catch {
                errorsSkipped++;
            }
        }

        // 2. Scan brain/<id>/.system_generated/logs/transcript.jsonl & brain/<id>/transcript.jsonl
        const brainDir = path.join(rootDir, 'brain');
        try {
            if (safeStat(brainDir)?.isDirectory()) {
                const dirs = fs.readdirSync(brainDir);
                for (const dirName of dirs) {
                    if (filesScanned >= maxFiles) { break; }
                    if (dirName.startsWith('.') || dbSessionsWithCalls.has(dirName)) { continue; }
                    const fullDir = path.join(brainDir, dirName);
                    if (!safeStat(fullDir)?.isDirectory()) { continue; }
                    const cand1 = path.join(fullDir, '.system_generated', 'logs', 'transcript.jsonl');
                    const cand2 = path.join(fullDir, 'transcript.jsonl');
                    const target = safeStat(cand1)?.isFile() ? cand1 : (safeStat(cand2)?.isFile() ? cand2 : null);
                    if (target) {
                        addCalls(ingestFile(target, dirName, 'jsonl'));
                    }
                }
            }
        } catch {
            errorsSkipped++;
        }

        // 3. Scan optional usage/*.jsonl, sessions/*.json, sessions/*.jsonl
        for (const subDirName of ['usage', 'sessions']) {
            const subDir = path.join(rootDir, subDirName);
            try {
                if (!safeStat(subDir)?.isDirectory()) { continue; }
                const files = fs.readdirSync(subDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
                for (const fileName of files) {
                    if (filesScanned >= maxFiles) { break; }
                    const sessionId = fileName.replace(/\.(?:jsonl|json)$/i, '');
                    if (dbSessionsWithCalls.has(sessionId)) { continue; }
                    addCalls(ingestFile(path.join(subDir, fileName), sessionId, 'jsonl'));
                }
            } catch {
                errorsSkipped++;
            }
        }

        const days = aggregateCliCallsByDay(allCalls, options.customPricing || {});
        return {
            available: true,
            rootDir,
            days,
            filesScanned,
            cacheHits,
            cacheMisses,
            errorsSkipped,
            scannedAt: nowDate.toISOString(),
        };
    }

    private _setCache(key: string, value: FileCacheEntry): void {
        if (this._cache.has(key)) {
            this._cache.delete(key);
        } else if (this._cache.size >= this._cacheLimit) {
            const oldestKey = this._cache.keys().next().value;
            if (oldestKey !== undefined) {
                this._cache.delete(oldestKey);
            }
        }
        this._cache.set(key, value);
    }
}

/** Shared default scanner instance with persistent in-memory mtime+size cache. */
const defaultCliScanner = new CliUsageScanner();

/** Convenience function using the default mtime+size cached scanner. */
export function scanCliUsageDays(options?: CliScanOptions): CliScanResult {
    return defaultCliScanner.scan(options);
}

/** Aggregate parsed CLI calls into sorted ascending {@link CliDailyUsageRecord}s. */
export function aggregateCliCallsByDay(
    calls: readonly CliParsedCall[],
    customPricing: Record<string, ModelPricing> = {},
): CliDailyUsageRecord[] {
    interface ModelAcc {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        credits: number;
        estimatedCost: number;
        ttftSum: number;
        ttftCount: number;
        streamingSum: number;
        streamingCount: number;
        timedOutput: number;
        timedStream: number;
        cacheHitCalls: number;
    }

    interface DayAcc {
        sessions: Set<string>;
        calls: number;
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        credits: number;
        estimatedCost: number;
        models: Map<string, ModelAcc>;
    }

    const byDay = new Map<string, DayAcc>();

    for (const c of calls) {
        if (!c.dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(c.dateKey)) { continue; }
        let day = byDay.get(c.dateKey);
        if (!day) {
            day = {
                sessions: new Set<string>(),
                calls: 0,
                inputTokens: 0,
                outputTokens: 0,
                thinkingTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                credits: 0,
                estimatedCost: 0,
                models: new Map<string, ModelAcc>(),
            };
            byDay.set(c.dateKey, day);
        }

        const pricing = findPricingForDate(c.responseModel || c.modelKey, customPricing, new Date(c.createdAtMs))
            || findPricingForDate(c.modelKey, customPricing, new Date(c.createdAtMs));
        const callCost = pricing ? costFromTokens(c, pricing) : 0;

        day.sessions.add(c.sessionId);
        day.calls++;
        day.inputTokens += c.inputTokens;
        day.outputTokens += c.outputTokens;
        day.thinkingTokens += c.thinkingTokens;
        day.cacheReadTokens += c.cacheReadTokens;
        day.cacheCreationTokens += c.cacheCreationTokens;
        day.credits += c.credits;
        day.estimatedCost += callCost;

        let m = day.models.get(c.modelKey);
        if (!m) {
            m = {
                calls: 0,
                inputTokens: 0,
                outputTokens: 0,
                thinkingTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                credits: 0,
                estimatedCost: 0,
                ttftSum: 0,
                ttftCount: 0,
                streamingSum: 0,
                streamingCount: 0,
                timedOutput: 0,
                timedStream: 0,
                cacheHitCalls: 0,
            };
            day.models.set(c.modelKey, m);
        }
        m.calls++;
        m.inputTokens += c.inputTokens;
        m.outputTokens += c.outputTokens;
        m.thinkingTokens += c.thinkingTokens;
        m.cacheReadTokens += c.cacheReadTokens;
        m.cacheCreationTokens += c.cacheCreationTokens;
        m.credits += c.credits;
        m.estimatedCost += callCost;
        if (c.ttftSeconds > 0) {
            m.ttftSum += c.ttftSeconds;
            m.ttftCount++;
        }
        if (c.streamingSeconds > 0) {
            m.streamingSum += c.streamingSeconds;
            m.streamingCount++;
            if (c.streamingSeconds >= MIN_STREAM_SECONDS && c.outputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
                m.timedOutput += c.outputTokens;
                m.timedStream += c.streamingSeconds;
            }
        }
        if (c.cacheReadTokens > 0) {
            m.cacheHitCalls++;
        }
    }

    const out: CliDailyUsageRecord[] = [];
    for (const [date, day] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const models: Record<string, CliModelDayStats> = {};
        for (const [name, m] of day.models) {
            const promptTotal = m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens;
            const entry: CliModelDayStats = {
                calls: m.calls,
                inputTokens: m.inputTokens,
                outputTokens: m.outputTokens,
                thinkingTokens: m.thinkingTokens,
                cacheReadTokens: m.cacheReadTokens,
                cacheCreationTokens: m.cacheCreationTokens,
                credits: m.credits,
                estimatedCost: m.estimatedCost,
                avgTTFT: m.ttftCount > 0 ? m.ttftSum / m.ttftCount : 0,
                cacheHitRate: m.calls > 0 ? m.cacheHitCalls / m.calls : 0,
            };
            if (m.streamingCount > 0) {
                entry.avgStreaming = m.streamingSum / m.streamingCount;
            }
            if (m.timedStream >= MIN_STREAM_SECONDS && m.timedOutput >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
                entry.avgGenTokPerSec = m.timedOutput / m.timedStream;
            }
            if (promptTotal > 0) {
                entry.tokenCacheHitRate = Math.min(1, Math.max(0, m.cacheReadTokens / promptTotal));
            }
            models[name] = entry;
        }

        out.push({
            date,
            surface: 'cli',
            calls: day.calls,
            sessions: day.sessions.size,
            inputTokens: day.inputTokens,
            outputTokens: day.outputTokens,
            thinkingTokens: day.thinkingTokens,
            cacheReadTokens: day.cacheReadTokens,
            cacheCreationTokens: day.cacheCreationTokens,
            totalTokens: computeAdditiveTokens(day),
            credits: day.credits,
            estimatedCost: day.estimatedCost,
            models,
        });
    }
    return out;
}

/** Convert a {@link CliDailyUsageRecord} into a {@link DailyRecord} tagged with `surface: 'cli'`. */
export function cliDayRecordToDailyRecord(cliDay: CliDailyUsageRecord): DailyRecord {
    const gmModelStats: Record<string, GMModelCycleStats> = {};
    for (const [name, ms] of Object.entries(cliDay.models || {})) {
        const row: GMModelCycleStats = {
            calls: ms.calls,
            credits: ms.credits,
            inputTokens: ms.inputTokens,
            outputTokens: ms.outputTokens,
            thinkingTokens: ms.thinkingTokens,
            avgTTFT: ms.avgTTFT,
            cacheHitRate: ms.cacheHitRate,
            cacheReadTokens: ms.cacheReadTokens,
            cacheCreationTokens: ms.cacheCreationTokens,
        };
        if (ms.estimatedCost > 0) { row.estimatedCost = ms.estimatedCost; }
        if (ms.avgStreaming !== undefined && ms.avgStreaming > 0) { row.avgStreaming = ms.avgStreaming; }
        if (ms.avgGenTokPerSec !== undefined && ms.avgGenTokPerSec > 0) { row.avgGenTokPerSec = ms.avgGenTokPerSec; }
        if (ms.tokenCacheHitRate !== undefined) { row.tokenCacheHitRate = ms.tokenCacheHitRate; }
        gmModelStats[name] = row;
    }

    const totalTokens = cliDay.totalTokens > 0
        ? cliDay.totalTokens
        : computeAdditiveTokens(cliDay);

    const cycle: DailyCycleEntry = {
        startTime: `${cliDay.date}T00:00:00`,
        endTime: `${cliDay.date}T23:59:59`,
        totalReasoning: 0,
        totalToolCalls: 0,
        totalErrors: 0,
        totalInputTokens: cliDay.inputTokens,
        totalOutputTokens: cliDay.outputTokens,
        estSteps: cliDay.sessions,
        modelNames: Object.keys(gmModelStats),
        gmTotalCalls: cliDay.calls,
        gmTotalCredits: cliDay.credits,
        gmTotalTokens: cliDay.inputTokens + cliDay.outputTokens,
        gmTotalAllTokens: totalTokens,
        ...(cliDay.cacheReadTokens > 0 ? { gmTotalCacheRead: cliDay.cacheReadTokens } : {}),
        ...(cliDay.cacheCreationTokens > 0 ? { gmTotalCacheCreation: cliDay.cacheCreationTokens } : {}),
        ...(cliDay.thinkingTokens > 0 ? { gmTotalThinkingTokens: cliDay.thinkingTokens } : {}),
        ...(cliDay.estimatedCost > 0 ? { estimatedCost: cliDay.estimatedCost } : {}),
        gmModelStats,
        surface: 'cli',
        surfaceBreakdown: {
            cli: {
                calls: cliDay.calls,
                inputTokens: cliDay.inputTokens,
                outputTokens: cliDay.outputTokens,
                thinkingTokens: cliDay.thinkingTokens,
                cacheReadTokens: cliDay.cacheReadTokens,
                cacheCreationTokens: cliDay.cacheCreationTokens,
                credits: cliDay.credits,
                estimatedCost: cliDay.estimatedCost,
            },
        },
    };

    return { date: cliDay.date, cycles: [cycle] };
}

// ─── Pure CSV & JSON Export Builders ─────────────────────────────────────────

export interface CalendarExportModelRow {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    credits: number;
}

export interface CalendarExportDayRow {
    date: string;
    sources: UsageSurface[];
    calls: number;
    cycles: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    credits: number;
    avgTTFT?: number;
    avgGenTokPerSec?: number;
    cacheHitRate?: number;
    isLive?: boolean;
    models: Record<string, CalendarExportModelRow>;
}

export interface CalendarExportMetadata {
    exportedAt?: string;
    sourceFilter?: 'all' | UsageSurface;
    periodMode?: string;
    rangeStart?: string;
    rangeEnd?: string;
    spanDays?: number;
    currency?: CurrencyInput;
    subscription?: SubscriptionConfig | null;
}

function parseDateKeyUtcMs(dateKey: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!m) { return NaN; }
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Compute current active streak (ending on `referenceDateKey` or yesterday if today not yet active)
 * and longest consecutive active-day streak across a list of `YYYY-MM-DD` keys.
 */
export function computeActivityStreaks(
    activeDateKeys: readonly string[],
    referenceDateKey?: string,
): { currentStreak: number; longestStreak: number } {
    const uniqueSorted = [...new Set(activeDateKeys.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    if (uniqueSorted.length === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const dayMsList = uniqueSorted.map(parseDateKeyUtcMs).filter(Number.isFinite);
    if (dayMsList.length === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const ONE_DAY = 86_400_000;
    let longest = 1;
    let run = 1;
    for (let i = 1; i < dayMsList.length; i++) {
        if (dayMsList[i] - dayMsList[i - 1] === ONE_DAY) {
            run++;
            if (run > longest) { longest = run; }
        } else {
            run = 1;
        }
    }

    // Current streak anchored at referenceDateKey (or latest active day if omitted)
    let current = 0;
    const refMs = referenceDateKey ? parseDateKeyUtcMs(referenceDateKey) : dayMsList[dayMsList.length - 1];
    if (Number.isFinite(refMs)) {
        const set = new Set(dayMsList);
        let cursor = set.has(refMs) ? refMs : (set.has(refMs - ONE_DAY) ? refMs - ONE_DAY : NaN);
        while (Number.isFinite(cursor) && set.has(cursor)) {
            current++;
            cursor -= ONE_DAY;
        }
    }

    return { currentStreak: current, longestStreak: longest };
}

function computeCalendarSpanDays(
    sortedDays: readonly CalendarExportDayRow[],
    meta?: CalendarExportMetadata,
): number {
    if (meta?.spanDays && Number.isFinite(meta.spanDays) && meta.spanDays >= 1) {
        return Math.floor(meta.spanDays);
    }
    const startKey = meta?.rangeStart || sortedDays[0]?.date;
    const endKey = meta?.rangeEnd || sortedDays[sortedDays.length - 1]?.date;
    if (startKey && endKey) {
        const s = parseDateKeyUtcMs(startKey);
        const e = parseDateKeyUtcMs(endKey);
        if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
            return Math.floor((e - s) / 86_400_000) + 1;
        }
    }
    return Math.max(1, sortedDays.length);
}

/**
 * Pure JSON export builder for a filtered Calendar date range.
 */
export function buildCalendarExportJson(
    days: readonly CalendarExportDayRow[],
    meta: CalendarExportMetadata = {},
): string {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const { preset, ratePerUsd } = resolveCurrencyConfig(meta.currency);

    let totalCalls = 0;
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let estimatedCostUsd = 0;
    let totalCredits = 0;
    let peakDay: { date: string; totalTokens: number; estimatedCostUsd: number } | null = null;

    for (const d of sorted) {
        const additive = d.totalTokens > 0 ? d.totalTokens : computeAdditiveTokens(d);
        totalCalls += d.calls;
        totalTokens += additive;
        inputTokens += d.inputTokens;
        outputTokens += d.outputTokens;
        thinkingTokens += d.thinkingTokens;
        cacheReadTokens += d.cacheReadTokens;
        cacheCreationTokens += d.cacheCreationTokens;
        estimatedCostUsd += Number.isFinite(d.estimatedCostUsd) ? d.estimatedCostUsd : 0;
        totalCredits += d.credits;
        if (!peakDay || additive > peakDay.totalTokens) {
            peakDay = {
                date: d.date,
                totalTokens: additive,
                estimatedCostUsd: Number.isFinite(d.estimatedCostUsd) ? d.estimatedCostUsd : 0,
            };
        }
    }

    const activeDays = sorted.length;
    const spanDays = computeCalendarSpanDays(sorted, meta);
    const streaks = computeActivityStreaks(sorted.map(d => d.date), meta.rangeEnd);
    const roi = estimateSubscriptionRoi(estimatedCostUsd, spanDays, meta.subscription, meta.currency);

    const payload = {
        schemaVersion: 1,
        exportedAt: meta.exportedAt || new Date().toISOString(),
        filter: {
            source: meta.sourceFilter || 'all',
            periodMode: meta.periodMode || 'daily',
            rangeStart: meta.rangeStart || sorted[0]?.date || null,
            rangeEnd: meta.rangeEnd || sorted[sorted.length - 1]?.date || null,
            currency: preset.code,
            fxRatePerUsd: ratePerUsd,
        },
        summary: {
            activeDays,
            spanDays,
            totalCalls,
            totalTokens,
            inputTokens,
            outputTokens,
            thinkingTokens,
            cacheReadTokens,
            cacheCreationTokens,
            estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
            estimatedCostLocal: Number((estimatedCostUsd * ratePerUsd).toFixed(preset.decimals === 0 ? 2 : 4)),
            totalCredits,
            calendarDailyAvgTokens: Math.round(totalTokens / Math.max(1, spanDays)),
            activeDayAvgTokens: activeDays > 0 ? Math.round(totalTokens / activeDays) : 0,
            calendarDailyAvgCostUsd: Number((estimatedCostUsd / Math.max(1, spanDays)).toFixed(6)),
            activeDayAvgCostUsd: activeDays > 0 ? Number((estimatedCostUsd / activeDays).toFixed(6)) : 0,
            currentStreakDays: streaks.currentStreak,
            longestStreakDays: streaks.longestStreak,
            peakDay,
            subscriptionRoi: roi ? {
                planId: roi.planId,
                proratedFeeUsd: Number(roi.proratedFeeUsd.toFixed(4)),
                roiMultiple: roi.roiMultiple !== null ? Number(roi.roiMultiple.toFixed(2)) : null,
                disclaimer: roi.disclaimerEn,
            } : null,
        },
        days: sorted.map(d => {
            const safeCostUsd = Number.isFinite(d.estimatedCostUsd) ? d.estimatedCostUsd : 0;
            return {
                date: d.date,
                sources: d.sources,
                isLive: Boolean(d.isLive),
                calls: d.calls,
                cycles: d.cycles,
                totalTokens: d.totalTokens > 0 ? d.totalTokens : computeAdditiveTokens(d),
                inputTokens: d.inputTokens,
                cacheReadTokens: d.cacheReadTokens,
                cacheCreationTokens: d.cacheCreationTokens,
                outputTokens: d.outputTokens,
                thinkingTokens: d.thinkingTokens,
                estimatedCostUsd: Number(safeCostUsd.toFixed(6)),
                estimatedCostLocal: Number((safeCostUsd * ratePerUsd).toFixed(preset.decimals === 0 ? 2 : 4)),
                credits: d.credits,
                ...(d.cacheHitRate !== undefined ? { cacheHitRate: Number(d.cacheHitRate.toFixed(4)) } : {}),
                ...(d.avgTTFT !== undefined ? { avgTTFT: Number(d.avgTTFT.toFixed(3)) } : {}),
                ...(d.avgGenTokPerSec !== undefined ? { avgGenTokPerSec: Number(d.avgGenTokPerSec.toFixed(2)) } : {}),
                models: d.models,
            };
        }),
    };

    return JSON.stringify(payload, null, 2);
}

function escapeCsvCell(value: string, guardFormula = false): string {
    let text = String(value);
    // Guard against spreadsheet CSV formula injection on untrusted text columns
    if (guardFormula && /^[=+\-@\t\r]/.test(text)) {
        text = `'${text}`;
    }
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * Pure RFC 4180 CSV export builder for a filtered Calendar date range.
 */
export function buildCalendarExportCsv(
    days: readonly CalendarExportDayRow[],
    meta: CalendarExportMetadata = {},
): string {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const { preset, ratePerUsd } = resolveCurrencyConfig(meta.currency);

    const header = [
        'date',
        'sources',
        'is_live',
        'calls',
        'cycles',
        'total_tokens',
        'input_tokens',
        'cache_read_tokens',
        'cache_creation_tokens',
        'output_tokens',
        'thinking_tokens',
        'estimated_cost_usd',
        'currency',
        'estimated_cost_local',
        'credits',
        'cache_hit_rate_pct',
        'avg_ttft_sec',
        'avg_tps',
        'top_models',
    ];

    const rows: string[] = [header.join(',')];

    for (const d of sorted) {
        const totalTokens = d.totalTokens > 0 ? d.totalTokens : computeAdditiveTokens(d);
        const safeCostUsd = Number.isFinite(d.estimatedCostUsd) && d.estimatedCostUsd > 0 ? d.estimatedCostUsd : 0;
        const localCost = safeCostUsd * ratePerUsd;
        const topModels = Object.entries(d.models || {})
            .sort((a, b) => (b[1].totalTokens || 0) - (a[1].totalTokens || 0))
            .slice(0, 5)
            .map(([name, m]) => `${name}:${m.totalTokens || computeAdditiveTokens(m)}`)
            .join('; ');

        const cols = [
            escapeCsvCell(d.date),
            escapeCsvCell((d.sources || ['unknown']).join('|'), true),
            d.isLive ? 'true' : 'false',
            String(d.calls),
            String(d.cycles),
            String(totalTokens),
            String(d.inputTokens),
            String(d.cacheReadTokens),
            String(d.cacheCreationTokens),
            String(d.outputTokens),
            String(d.thinkingTokens),
            safeCostUsd.toFixed(6),
            escapeCsvCell(preset.code),
            localCost.toFixed(preset.decimals === 0 ? 2 : 4),
            String(d.credits),
            d.cacheHitRate !== undefined && Number.isFinite(d.cacheHitRate) ? (d.cacheHitRate * 100).toFixed(1) : '',
            d.avgTTFT !== undefined && Number.isFinite(d.avgTTFT) && d.avgTTFT > 0 ? d.avgTTFT.toFixed(3) : '',
            d.avgGenTokPerSec !== undefined && Number.isFinite(d.avgGenTokPerSec) && d.avgGenTokPerSec > 0 ? d.avgGenTokPerSec.toFixed(1) : '',
            escapeCsvCell(topModels, true),
        ];
        rows.push(cols.join(','));
    }

    return rows.join('\n') + '\n';
}

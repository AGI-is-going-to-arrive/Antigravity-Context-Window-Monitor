// ─── CLI Usage Scanner, Multi-Currency, Subscription ROI & Export Engine ─────
// Zero-dependency, strictly read-only, mtime+size cached scanner for Antigravity
// CLI local session data (~/.gemini/antigravity-cli), plus multi-currency FX
// conversion, optional Subscription Plan ROI estimator, and pure CSV/JSON export
// builders for the Calendar & Activity Heatmap dashboard.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { pathToFileURL } from 'url';
import { normalizeModelDisplayName } from './models';
import {
    costFromTokens,
    findPricingForDate,
    type ModelPricing,
} from './pricing-store';
import {
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    SUPPORTED_DISPLAY_CURRENCIES,
    buildCurrencyExportRecord,
    convertCurrencyToUsd,
    convertUsdToCurrency,
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    isCurrencyCode,
    normalizeCurrencyCode,
    resolveCurrencyConfig,
    roundCurrencyAmount,
    sumAndConvertUsdAmounts,
    sumUsdAmounts,
    type CurrencyAmountKind,
    type CurrencyCode,
    type CurrencyConfig,
    type CurrencyDisplayMode,
    type CurrencyExportRecord,
    type CurrencyInput,
    type CurrencyMicroStyle,
    type CurrencyPreset,
    type CurrencySymbolStyle,
    type DisplayCurrencyCode,
    type FormatCurrencyOptions,
    type ResolvedCurrencyConfig,
} from './core/currency';
import {
    SUBSCRIPTION_PLAN_PRESETS,
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    isSubscriptionPlanPresetId,
    normalizeSubscriptionPlanId,
    type SubscriptionPlanPreset,
    type SubscriptionPlanPresetId,
} from './core/pricing-validation';
import {
    computeAdditiveTokens,
    type DailyCycleEntry,
    type DailyRecord,
    type GMModelCycleStats,
} from './daily-store';
import { toLocalDateKey, type UsageSurface } from './daily-ledger';
import { MIN_OUTPUT_TOKENS_FOR_SPEED, MIN_STREAM_SECONDS } from './telemetry-metrics';

// ─── Multi-Currency & Subscription Presets (Re-exported from Shared Core) ───

export {
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    SUPPORTED_DISPLAY_CURRENCIES,
    SUBSCRIPTION_PLAN_PRESETS,
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    buildCurrencyExportRecord,
    convertCurrencyToUsd,
    convertUsdToCurrency,
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    isCurrencyCode,
    isSubscriptionPlanPresetId,
    normalizeCurrencyCode,
    normalizeSubscriptionPlanId,
    resolveCurrencyConfig,
    roundCurrencyAmount,
    sumAndConvertUsdAmounts,
    sumUsdAmounts,
};
export type {
    CurrencyAmountKind,
    CurrencyCode,
    CurrencyConfig,
    CurrencyDisplayMode,
    CurrencyExportRecord,
    CurrencyInput,
    CurrencyMicroStyle,
    CurrencyPreset,
    CurrencySymbolStyle,
    DisplayCurrencyCode,
    FormatCurrencyOptions,
    ResolvedCurrencyConfig,
    SubscriptionPlanPreset,
    SubscriptionPlanPresetId,
};

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

export interface SqliteStatementLike {
    all(...params: unknown[]): Array<Record<string, unknown>>;
}

export interface SqliteDatabaseLike {
    prepare(sql: string): SqliteStatementLike;
    exec?(sql: string): void;
    close(): void;
}

/** Diagnostic scan outcome distinguishing transient locks, missing dirs, unsupported runtimes, budgets, and genuinely empty data. */
export type CliScanStatus =
    | 'ok'
    | 'empty'
    | 'busy'
    | 'unavailable'
    | 'unsupported'
    | 'budget_exceeded'
    | 'error';

export interface CliScanOptions {
    /** Override root directory (defaults to ~/.gemini/antigravity-cli or $ANTIGRAVITY_CLI_DATA_DIR). */
    cliRootDir?: string;
    /** Custom pricing overrides for estimating API cost of CLI calls. */
    customPricing?: Record<string, ModelPricing>;
    /** Maximum number of files to inspect per scan (default: 1500). */
    maxFiles?: number;
    /** Ignore files older than N days by effective mtime (WAL-aware for .db) when > 0 (default: 400). */
    maxAgeDays?: number;
    /** Maximum bytes to read from a single DB (including WAL) or JSON/JSONL file (default: 16 MiB). */
    maxFileBytes?: number;
    /** Maximum total bytes read across all files in a single scan (default: 64 MiB). */
    maxTotalBytes?: number;
    /** Maximum SQLite rows or JSONL lines processed per file (default: 50_000). */
    maxRowsPerFile?: number;
    /** Maximum total SQLite rows + JSONL lines processed across a single scan (default: 200_000). */
    maxRowsTotal?: number;
    /** Maximum wall-clock elapsed ms budget for a single scan (default: 5_000ms). */
    maxElapsedMs?: number;
    /** Bounded SQLite pagination page size (default: 250). */
    sqlitePageSize?: number;
    /** Optional deterministic clock override for testing (used for date/age/scannedAt). */
    now?: Date | number;
    /** Optional injectable monotonic elapsed-time clock (ms) for deterministic time-budget tests. */
    monotonicNowMs?: () => number;
    /** Disable SQLite reader (useful for testing JSONL-only fallback). */
    disableSqlite?: boolean;
    /** Optional injectable SQLite opener for deterministic testing (`null` simulates a runtime without `node:sqlite`). */
    sqliteOpen?: ((target: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike) | null;
}

export interface CliCachedScanOptions extends CliScanOptions {
    /** Maximum age (ms) of cached scan before triggering an async background refresh (default: 30_000ms). */
    maxAgeMs?: number;
    /** Trigger a non-blocking background `scanAsync()` on cache miss or expiry (default: true). */
    triggerRefresh?: boolean;
}

export interface CliScanResult {
    available: boolean;
    /** Explicit diagnostic status distinguishing ok, empty, busy, unavailable, unsupported, budget_exceeded, and error. */
    status: CliScanStatus;
    /** True when last complete scan `days` were preserved after a busy/budget/error degradation. */
    preservedLastComplete: boolean;
    /** True when any file, row, byte, or elapsed-time budget halted the scan before completion. */
    budgetExceeded: boolean;
    /** Optional diagnostic detail when status is not 'ok' or 'empty'. */
    reason?: string;
    rootDir: string;
    days: CliDailyUsageRecord[];
    filesScanned: number;
    rowsProcessed: number;
    bytesRead: number;
    elapsedMs: number;
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
        let responseOutputTokens = 0;

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
            else if (uf.fn === 10) { responseOutputTokens = uf.varint; }
        }

        // Reconcile field 10 (responseOutputTokens) & implicit thinking:
        // - When thinkingOutputTokens (9) is omitted but outputTokens (3) > responseOutputTokens (10) > 0,
        //   derive implicit thinking = outputTokens - responseOutputTokens.
        // - When outputTokens (3) is omitted/0 but field 10 or 9 is present, sum response + thinking.
        if (thinkingTokens === 0 && responseOutputTokens > 0 && outputTokens > responseOutputTokens) {
            thinkingTokens = outputTokens - responseOutputTokens;
        } else if (outputTokens === 0 && (responseOutputTokens > 0 || thinkingTokens > 0)) {
            outputTokens = responseOutputTokens + thinkingTokens;
        } else if (responseOutputTokens > 0 && thinkingTokens > 0 && outputTokens < responseOutputTokens + thinkingTokens) {
            outputTokens = responseOutputTokens + thinkingTokens;
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
    let outputTokens = readNonNegInt(usage, ['outputTokens', 'output_tokens', 'candidatesTokenCount', 'completion_tokens']);
    const cacheReadTokens = readNonNegInt(usage, ['cacheReadTokens', 'cache_read_tokens', 'cachedContentTokenCount', 'cache_read_input_tokens']);
    const cacheCreationTokens = readNonNegInt(usage, ['cacheCreationTokens', 'cache_creation_tokens', 'cache_creation_input_tokens']);
    let thinkingTokens = readNonNegInt(usage, ['thinkingTokens', 'thinking_tokens', 'thinkingOutputTokens', 'thoughtsTokenCount']);
    const responseOutputTokens = readNonNegInt(usage, ['responseOutputTokens', 'response_output_tokens', 'responseTokens', 'response_tokens']);
    if (thinkingTokens === 0 && responseOutputTokens > 0 && outputTokens > responseOutputTokens) {
        thinkingTokens = outputTokens - responseOutputTokens;
    } else if (outputTokens === 0 && (responseOutputTokens > 0 || thinkingTokens > 0)) {
        outputTokens = responseOutputTokens + thinkingTokens;
    } else if (responseOutputTokens > 0 && thinkingTokens > 0 && outputTokens < responseOutputTokens + thinkingTokens) {
        outputTokens = responseOutputTokens + thinkingTokens;
    }
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
    const csm = (cm?.chatStartMetadata && typeof cm.chatStartMetadata === 'object')
        ? cm.chatStartMetadata as Record<string, unknown>
        : undefined;
    const meta = (obj.metadata && typeof obj.metadata === 'object')
        ? obj.metadata as Record<string, unknown>
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
        obj.created_at ?? obj.createdAt ?? obj.timestamp ?? obj.time
        ?? csm?.createdAt ?? csm?.created_at
        ?? meta?.created_at ?? meta?.createdAt ?? meta?.timestamp,
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

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ROWS_PER_FILE = 50_000;
const DEFAULT_MAX_ROWS_TOTAL = 200_000;
const DEFAULT_MAX_ELAPSED_MS = 5_000;
const DEFAULT_SQLITE_PAGE_SIZE = 250;
const JSONL_CHUNK_BYTES = 64 * 1024;

interface ScanBudgetState {
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxRowsPerFile: number;
    readonly maxRowsTotal: number;
    readonly maxElapsedMs: number;
    readonly sqlitePageSize: number;
    readonly startMonoMs: number;
    readonly monoNow: () => number;
    bytesRead: number;
    rowsProcessed: number;
    budgetExceeded: boolean;
    budgetReason?: string;
}

function createScanBudgetState(options: CliScanOptions, maxFiles: number): ScanBudgetState {
    const posInt = (val: number | undefined, fallback: number): number =>
        typeof val === 'number' && Number.isFinite(val) && val > 0 ? Math.floor(val) : fallback;
    const monoNow = options.monotonicNowMs ?? (() => Number(process.hrtime.bigint() / 1_000_000n));
    return {
        maxFiles,
        maxFileBytes: posInt(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES),
        maxTotalBytes: posInt(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES),
        maxRowsPerFile: posInt(options.maxRowsPerFile, DEFAULT_MAX_ROWS_PER_FILE),
        maxRowsTotal: posInt(options.maxRowsTotal, DEFAULT_MAX_ROWS_TOTAL),
        maxElapsedMs: posInt(options.maxElapsedMs, DEFAULT_MAX_ELAPSED_MS),
        sqlitePageSize: posInt(options.sqlitePageSize, DEFAULT_SQLITE_PAGE_SIZE),
        startMonoMs: monoNow(),
        monoNow,
        bytesRead: 0,
        rowsProcessed: 0,
        budgetExceeded: false,
    };
}

function checkElapsedBudget(budget: ScanBudgetState): boolean {
    if (budget.budgetExceeded) { return true; }
    const elapsed = Math.max(0, budget.monoNow() - budget.startMonoMs);
    if (elapsed >= budget.maxElapsedMs) {
        budget.budgetExceeded = true;
        budget.budgetReason = `time budget exceeded (${elapsed}ms >= ${budget.maxElapsedMs}ms)`;
        return true;
    }
    return false;
}

function markBudgetExceeded(budget: ScanBudgetState, reason: string): void {
    budget.budgetExceeded = true;
    if (!budget.budgetReason) {
        budget.budgetReason = reason;
    }
}

interface FileParseOutcome {
    calls: CliParsedCall[];
    /** True ONLY when the file was read completely without error or budget truncation. */
    cacheable: boolean;
    status: 'ok' | 'busy' | 'unavailable' | 'unsupported' | 'budget_exceeded' | 'error';
    reason?: string;
}

function classifyFsOrSqliteError(err: unknown): { status: 'busy' | 'unavailable' | 'error'; reason: string } {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code || '') : '';
    const errcode = err && typeof err === 'object' && 'errcode' in err ? Number((err as { errcode?: unknown }).errcode) : NaN;
    if (
        errcode === 5 || errcode === 6
        || /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(msg)
        || code === 'EBUSY' || code === 'EAGAIN'
    ) {
        return { status: 'busy', reason: msg || 'database is busy' };
    }
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || /permission denied|no such file/i.test(msg)) {
        return { status: 'unavailable', reason: msg || code };
    }
    return { status: 'error', reason: msg || 'read error' };
}

function parseJsonDocumentWithBudget(
    raw: string,
    sessionId: string,
    fallbackMs: number,
    budget: ScanBudgetState,
): FileParseOutcome {
    try {
        const parsed = JSON.parse(raw.trim()) as unknown;
        const list = Array.isArray(parsed)
            ? parsed
            : (parsed && typeof parsed === 'object'
                ? (Array.isArray((parsed as Record<string, unknown>).calls)
                    ? (parsed as Record<string, unknown>).calls as unknown[]
                    : Array.isArray((parsed as Record<string, unknown>).entries)
                        ? (parsed as Record<string, unknown>).entries as unknown[]
                        : [parsed])
                : []);
        const calls: CliParsedCall[] = [];
        for (let i = 0; i < list.length; i++) {
            if (i >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                markBudgetExceeded(budget, 'JSON record row budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            if ((i & 63) === 0 && checkElapsedBudget(budget)) {
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            budget.rowsProcessed++;
            const call = parseJsonRecordToCliCall(list[i], sessionId, i, fallbackMs);
            if (call) { calls.push(call); }
        }
        return { calls, cacheable: true, status: 'ok' };
    } catch {
        return { calls: [], cacheable: false, status: 'error', reason: 'malformed JSON document' };
    }
}

function parseJsonlLineIntoCalls(
    line: string,
    sessionId: string,
    lineIdx: number,
    fallbackMs: number,
    calls: CliParsedCall[],
): void {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) { return; }
    // Fast skip lines that clearly cannot contain any token usage
    if (!/(?:token|usage|input|output|cache)/i.test(trimmed)) { return; }
    try {
        const obj = JSON.parse(trimmed) as unknown;
        const call = parseJsonRecordToCliCall(obj, sessionId, lineIdx, fallbackMs);
        if (call) { calls.push(call); }
    } catch {
        // Skip malformed JSONL lines gracefully
    }
}

function parseJsonlFileBoundedSync(
    filePath: string,
    stat: fs.Stats,
    sessionId: string,
    fallbackMs: number,
    budget: ScanBudgetState,
): FileParseOutcome {
    if (checkElapsedBudget(budget)) {
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    if (stat.size > budget.maxFileBytes) {
        markBudgetExceeded(budget, `file size ${stat.size} exceeds maxFileBytes ${budget.maxFileBytes}`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    if (budget.bytesRead + stat.size > budget.maxTotalBytes) {
        markBudgetExceeded(budget, `total byte budget ${budget.maxTotalBytes} exceeded`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }

    if (filePath.endsWith('.json')) {
        try {
            const buf = fs.readFileSync(filePath);
            budget.bytesRead += buf.byteLength;
            if (buf.byteLength > budget.maxFileBytes || budget.bytesRead > budget.maxTotalBytes) {
                markBudgetExceeded(budget, 'byte budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const raw = buf.toString('utf8');
            const docRes = parseJsonDocumentWithBudget(raw, sessionId, fallbackMs, budget);
            if (docRes.status !== 'error') { return docRes; }
            // Fall through to JSONL parsing if a .json file is line-delimited
        } catch (err) {
            const cls = classifyFsOrSqliteError(err);
            return { calls: [], cacheable: false, status: cls.status, reason: cls.reason };
        }
    }

    let fd: number | null = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const chunkBuf = Buffer.allocUnsafe(JSONL_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let fileBytes = 0;
        let fileLines = 0;
        let carry = '';
        const calls: CliParsedCall[] = [];

        while (true) {
            if (checkElapsedBudget(budget)) {
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const n = fs.readSync(fd, chunkBuf, 0, chunkBuf.length, null);
            if (n <= 0) { break; }
            fileBytes += n;
            budget.bytesRead += n;
            if (fileBytes > budget.maxFileBytes || budget.bytesRead > budget.maxTotalBytes) {
                markBudgetExceeded(budget, 'JSONL byte budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const text = carry + decoder.write(chunkBuf.subarray(0, n));
            const parts = text.split(/\r?\n/);
            carry = parts.pop() || '';
            for (const line of parts) {
                if (fileLines >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                    markBudgetExceeded(budget, 'JSONL row budget exceeded');
                    return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
                }
                parseJsonlLineIntoCalls(line, sessionId, fileLines, fallbackMs, calls);
                fileLines++;
                budget.rowsProcessed++;
            }
        }
        const trailing = decoder.end();
        if (trailing) { carry += trailing; }
        if (carry.trim().length > 0) {
            if (fileLines >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                markBudgetExceeded(budget, 'JSONL row budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const trimmedCarry = carry.trim();
            if (fileLines === 0 && trimmedCarry.startsWith('[') && trimmedCarry.endsWith(']')) {
                return parseJsonDocumentWithBudget(trimmedCarry, sessionId, fallbackMs, budget);
            }
            parseJsonlLineIntoCalls(carry, sessionId, fileLines, fallbackMs, calls);
            budget.rowsProcessed++;
        }
        return { calls, cacheable: true, status: 'ok' };
    } catch (err) {
        const cls = classifyFsOrSqliteError(err);
        return { calls: [], cacheable: false, status: cls.status, reason: cls.reason };
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

async function parseJsonlFileBoundedAsync(
    filePath: string,
    stat: fs.Stats,
    sessionId: string,
    fallbackMs: number,
    budget: ScanBudgetState,
): Promise<FileParseOutcome> {
    if (checkElapsedBudget(budget)) {
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    if (stat.size > budget.maxFileBytes) {
        markBudgetExceeded(budget, `file size ${stat.size} exceeds maxFileBytes ${budget.maxFileBytes}`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    if (budget.bytesRead + stat.size > budget.maxTotalBytes) {
        markBudgetExceeded(budget, `total byte budget ${budget.maxTotalBytes} exceeded`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }

    if (filePath.endsWith('.json')) {
        try {
            const buf = await fs.promises.readFile(filePath);
            budget.bytesRead += buf.byteLength;
            if (buf.byteLength > budget.maxFileBytes || budget.bytesRead > budget.maxTotalBytes) {
                markBudgetExceeded(budget, 'byte budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const docRes = parseJsonDocumentWithBudget(buf.toString('utf8'), sessionId, fallbackMs, budget);
            if (docRes.status !== 'error') { return docRes; }
        } catch (err) {
            const cls = classifyFsOrSqliteError(err);
            return { calls: [], cacheable: false, status: cls.status, reason: cls.reason };
        }
    }

    let handle: fs.promises.FileHandle | null = null;
    try {
        handle = await fs.promises.open(filePath, 'r');
        const chunkBuf = Buffer.allocUnsafe(JSONL_CHUNK_BYTES);
        const decoder = new StringDecoder('utf8');
        let fileBytes = 0;
        let fileLines = 0;
        let carry = '';
        const calls: CliParsedCall[] = [];

        while (true) {
            if (checkElapsedBudget(budget)) {
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const { bytesRead } = await handle.read(chunkBuf, 0, chunkBuf.length, null);
            if (bytesRead <= 0) { break; }
            fileBytes += bytesRead;
            budget.bytesRead += bytesRead;
            if (fileBytes > budget.maxFileBytes || budget.bytesRead > budget.maxTotalBytes) {
                markBudgetExceeded(budget, 'JSONL byte budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const text = carry + decoder.write(chunkBuf.subarray(0, bytesRead));
            const parts = text.split(/\r?\n/);
            carry = parts.pop() || '';
            for (const line of parts) {
                if (fileLines >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                    markBudgetExceeded(budget, 'JSONL row budget exceeded');
                    return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
                }
                parseJsonlLineIntoCalls(line, sessionId, fileLines, fallbackMs, calls);
                fileLines++;
                budget.rowsProcessed++;
            }
            await yieldEventLoop();
        }
        const trailing = decoder.end();
        if (trailing) { carry += trailing; }
        if (carry.trim().length > 0) {
            if (fileLines >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                markBudgetExceeded(budget, 'JSONL row budget exceeded');
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const trimmedCarry = carry.trim();
            if (fileLines === 0 && trimmedCarry.startsWith('[') && trimmedCarry.endsWith(']')) {
                return parseJsonDocumentWithBudget(trimmedCarry, sessionId, fallbackMs, budget);
            }
            parseJsonlLineIntoCalls(carry, sessionId, fileLines, fallbackMs, calls);
            budget.rowsProcessed++;
        }
        return { calls, cacheable: true, status: 'ok' };
    } catch (err) {
        const cls = classifyFsOrSqliteError(err);
        return { calls: [], cacheable: false, status: cls.status, reason: cls.reason };
    } finally {
        if (handle) {
            await handle.close().catch(() => {});
        }
    }
}

// ─── Dynamic Optional node:sqlite Loader (Zero External Deps) ────────────────

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

function readStepTimestampsBounded(
    db: SqliteDatabaseLike,
    budget: ScanBudgetState,
): Map<number, number> {
    const stepTimestamps = new Map<number, number>();
    try {
        const pageSize = budget.sqlitePageSize;
        let lastIdx = -1;
        let stepRowsRead = 0;
        const stmt = db.prepare('SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL AND idx > ? ORDER BY idx ASC LIMIT ?');
        while (true) {
            if (checkElapsedBudget(budget)) {
                break;
            }
            const sRows = stmt.all(lastIdx, pageSize);
            if (!sRows || sRows.length === 0) { break; }
            let maxIdx = lastIdx;
            let hitRowBudget = false;
            for (const sr of sRows) {
                if (stepRowsRead >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                    markBudgetExceeded(budget, 'SQLite steps row budget exceeded');
                    hitRowBudget = true;
                    break;
                }
                stepRowsRead++;
                budget.rowsProcessed++;
                const sIdx = typeof sr.idx === 'number' ? sr.idx : Number(sr.idx);
                const meta = sr.metadata;
                if (Number.isFinite(sIdx)) {
                    if (sIdx > maxIdx) { maxIdx = sIdx; }
                    if (meta instanceof Uint8Array) {
                        const ts = decodeStepTimestampBlob(meta);
                        if (ts > 0) { stepTimestamps.set(sIdx, ts); }
                    }
                }
            }
            if (hitRowBudget || sRows.length < pageSize || maxIdx <= lastIdx) { break; }
            lastIdx = maxIdx;
        }
    } catch {
        // steps table optional
    }
    return stepTimestamps;
}

function openSqliteReadOnlySnapshotSync(
    dbPath: string,
    dbStat: fs.Stats,
    walStat: fs.Stats | null,
    sqliteOpen: ((target: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike) | null | undefined,
): { db: SqliteDatabaseLike; tmpDir: string | null } | { failed: FileParseOutcome } {
    const hasActiveWal = Boolean(walStat && walStat.isFile() && walStat.size > 0);
    if (sqliteOpen === null) {
        return { failed: { calls: [], cacheable: false, status: 'unsupported', reason: 'node:sqlite unavailable in current Node runtime' } };
    }
    if (sqliteOpen) {
        const openTarget = hasActiveWal ? dbPath : `${pathToFileURL(dbPath).href}?immutable=1`;
        return { db: sqliteOpen(openTarget, { readOnly: true }), tmpDir: null };
    }
    const DatabaseSync = loadBuiltinSqlite();
    if (!DatabaseSync) {
        return { failed: { calls: [], cacheable: false, status: 'unsupported', reason: 'node:sqlite unavailable in current Node runtime' } };
    }
    if (!hasActiveWal) {
        return { db: new DatabaseSync(`${pathToFileURL(dbPath).href}?immutable=1`, { readOnly: true }), tmpDir: null };
    }

    // Active WAL: copy (db, db-wal) into a private temp directory so we NEVER create -shm
    // or touch the source directory (strictly read-only even in chmod 0o555 directories!).
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cli-ro-'));
    try {
        const baseName = path.basename(dbPath);
        const snapDbPath = path.join(tmpDir, baseName);
        const snapWalPath = `${snapDbPath}-wal`;
        fs.copyFileSync(dbPath, snapDbPath);
        fs.copyFileSync(`${dbPath}-wal`, snapWalPath);

        // Verify source did not mutate mid-copy (guards against torn WAL snapshot)
        const postDb = safeStat(dbPath);
        const postWal = safeStat(`${dbPath}-wal`);
        if (!postDb || !postWal
            || postDb.size !== dbStat.size || Math.floor(postDb.mtimeMs) !== Math.floor(dbStat.mtimeMs)
            || postWal.size !== walStat!.size || Math.floor(postWal.mtimeMs) !== Math.floor(walStat!.mtimeMs)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            return { failed: { calls: [], cacheable: false, status: 'busy', reason: 'SQLite WAL updated concurrently during read-only snapshot' } };
        }

        try {
            fs.chmodSync(snapDbPath, 0o600);
            fs.chmodSync(snapWalPath, 0o600);
        } catch { /* ignore on platforms without POSIX chmod */ }

        const db = new DatabaseSync(snapDbPath, { readOnly: false });
        try {
            db.exec?.('PRAGMA query_only=ON;');
        } catch { /* ignore if custom wrapper lacks exec */ }
        return { db, tmpDir };
    } catch (err) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        const cls = classifyFsOrSqliteError(err);
        return { failed: { calls: [], cacheable: false, status: cls.status, reason: cls.reason } };
    }
}

async function openSqliteReadOnlySnapshotAsync(
    dbPath: string,
    dbStat: fs.Stats,
    walStat: fs.Stats | null,
    sqliteOpen: ((target: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike) | null | undefined,
): Promise<{ db: SqliteDatabaseLike; tmpDir: string | null } | { failed: FileParseOutcome }> {
    const hasActiveWal = Boolean(walStat && walStat.isFile() && walStat.size > 0);
    if (sqliteOpen === null) {
        return { failed: { calls: [], cacheable: false, status: 'unsupported', reason: 'node:sqlite unavailable in current Node runtime' } };
    }
    if (sqliteOpen) {
        const openTarget = hasActiveWal ? dbPath : `${pathToFileURL(dbPath).href}?immutable=1`;
        return { db: sqliteOpen(openTarget, { readOnly: true }), tmpDir: null };
    }
    const DatabaseSync = loadBuiltinSqlite();
    if (!DatabaseSync) {
        return { failed: { calls: [], cacheable: false, status: 'unsupported', reason: 'node:sqlite unavailable in current Node runtime' } };
    }
    if (!hasActiveWal) {
        return { db: new DatabaseSync(`${pathToFileURL(dbPath).href}?immutable=1`, { readOnly: true }), tmpDir: null };
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'acm-cli-ro-'));
    try {
        const baseName = path.basename(dbPath);
        const snapDbPath = path.join(tmpDir, baseName);
        const snapWalPath = `${snapDbPath}-wal`;
        await fs.promises.copyFile(dbPath, snapDbPath);
        await fs.promises.copyFile(`${dbPath}-wal`, snapWalPath);

        const postDb = await safeStatAsync(dbPath);
        const postWal = await safeStatAsync(`${dbPath}-wal`);
        if (!postDb || !postWal
            || postDb.size !== dbStat.size || Math.floor(postDb.mtimeMs) !== Math.floor(dbStat.mtimeMs)
            || postWal.size !== walStat!.size || Math.floor(postWal.mtimeMs) !== Math.floor(walStat!.mtimeMs)) {
            await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            return { failed: { calls: [], cacheable: false, status: 'busy', reason: 'SQLite WAL updated concurrently during read-only snapshot' } };
        }

        await fs.promises.chmod(snapDbPath, 0o600).catch(() => {});
        await fs.promises.chmod(snapWalPath, 0o600).catch(() => {});

        const db = new DatabaseSync(snapDbPath, { readOnly: false });
        try {
            db.exec?.('PRAGMA query_only=ON;');
        } catch { /* ignore */ }
        return { db, tmpDir };
    } catch (err) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        const cls = classifyFsOrSqliteError(err);
        return { failed: { calls: [], cacheable: false, status: cls.status, reason: cls.reason } };
    }
}

function parseSqliteDbToCliCallsBoundedSync(
    dbPath: string,
    dbStat: fs.Stats,
    walStat: fs.Stats | null,
    sessionId: string,
    fallbackMs: number,
    budget: ScanBudgetState,
    sqliteOpen?: ((target: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike) | null,
): FileParseOutcome {
    if (checkElapsedBudget(budget)) {
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    const walBytes = walStat && walStat.isFile() && walStat.size > 0 ? walStat.size : 0;
    const fileTotalBytes = dbStat.size + walBytes;
    if (fileTotalBytes > budget.maxFileBytes) {
        markBudgetExceeded(budget, `SQLite DB+WAL size ${fileTotalBytes} exceeds maxFileBytes ${budget.maxFileBytes}`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    if (budget.bytesRead + fileTotalBytes > budget.maxTotalBytes) {
        markBudgetExceeded(budget, `total byte budget ${budget.maxTotalBytes} exceeded`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }

    let db: SqliteDatabaseLike | null = null;
    let tmpDir: string | null = null;
    try {
        const opened = openSqliteReadOnlySnapshotSync(dbPath, dbStat, walStat, sqliteOpen);
        if ('failed' in opened) {
            return opened.failed;
        }
        db = opened.db;
        tmpDir = opened.tmpDir;
        budget.bytesRead += fileTotalBytes;

        const pageSize = budget.sqlitePageSize;
        const stmt = db.prepare('SELECT idx, data FROM gen_metadata WHERE idx > ? ORDER BY idx ASC LIMIT ?');
        let lastIdx = -1;
        let fileRows = 0;
        let stepTimestamps: Map<number, number> | undefined;
        const calls: CliParsedCall[] = [];

        const ensureStepTimestamps = (): Map<number, number> => {
            if (!stepTimestamps) {
                stepTimestamps = readStepTimestampsBounded(db!, budget);
            }
            return stepTimestamps;
        };

        while (true) {
            if (checkElapsedBudget(budget)) {
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const gmRows = stmt.all(lastIdx, pageSize);
            if (!gmRows || gmRows.length === 0) { break; }

            let maxRowIdx = lastIdx;
            for (let i = 0; i < gmRows.length; i++) {
                if (fileRows >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                    markBudgetExceeded(budget, 'SQLite row budget exceeded');
                    return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
                }
                const row = gmRows[i];
                const rowIdx = typeof row.idx === 'number' ? row.idx : fileRows;
                if (rowIdx > maxRowIdx) { maxRowIdx = rowIdx; }
                fileRows++;
                budget.rowsProcessed++;

                const data = row.data;
                if (!(data instanceof Uint8Array) || data.length === 0) { continue; }
                let parsed = decodeCliGenMetadataBlob(data, sessionId, rowIdx, 0);
                if (!parsed) {
                    const stepTs = ensureStepTimestamps();
                    if (budget.budgetExceeded) {
                        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
                    }
                    parsed = decodeCliGenMetadataBlob(data, sessionId, rowIdx, fallbackMs, stepTs);
                }
                if (parsed) {
                    calls.push(parsed);
                }
            }
            if (gmRows.length < pageSize || maxRowIdx <= lastIdx) { break; }
            lastIdx = maxRowIdx;
        }
        return { calls, cacheable: true, status: 'ok' };
    } catch (err) {
        const cls = classifyFsOrSqliteError(err);
        return { calls: [], cacheable: false, status: cls.status, reason: cls.reason };
    } finally {
        if (db) {
            try { db.close(); } catch { /* ignore */ }
        }
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

async function parseSqliteDbToCliCallsBoundedAsync(
    dbPath: string,
    dbStat: fs.Stats,
    walStat: fs.Stats | null,
    sessionId: string,
    fallbackMs: number,
    budget: ScanBudgetState,
    sqliteOpen?: ((target: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike) | null,
): Promise<FileParseOutcome> {
    if (checkElapsedBudget(budget)) {
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    const walBytes = walStat && walStat.isFile() && walStat.size > 0 ? walStat.size : 0;
    const fileTotalBytes = dbStat.size + walBytes;
    if (fileTotalBytes > budget.maxFileBytes) {
        markBudgetExceeded(budget, `SQLite DB+WAL size ${fileTotalBytes} exceeds maxFileBytes ${budget.maxFileBytes}`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }
    if (budget.bytesRead + fileTotalBytes > budget.maxTotalBytes) {
        markBudgetExceeded(budget, `total byte budget ${budget.maxTotalBytes} exceeded`);
        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
    }

    let db: SqliteDatabaseLike | null = null;
    let tmpDir: string | null = null;
    try {
        const opened = await openSqliteReadOnlySnapshotAsync(dbPath, dbStat, walStat, sqliteOpen);
        if ('failed' in opened) {
            return opened.failed;
        }
        db = opened.db;
        tmpDir = opened.tmpDir;
        budget.bytesRead += fileTotalBytes;

        const pageSize = budget.sqlitePageSize;
        const stmt = db.prepare('SELECT idx, data FROM gen_metadata WHERE idx > ? ORDER BY idx ASC LIMIT ?');
        let lastIdx = -1;
        let fileRows = 0;
        let stepTimestamps: Map<number, number> | undefined;
        const calls: CliParsedCall[] = [];

        const ensureStepTimestamps = (): Map<number, number> => {
            if (!stepTimestamps) {
                stepTimestamps = readStepTimestampsBounded(db!, budget);
            }
            return stepTimestamps;
        };

        while (true) {
            if (checkElapsedBudget(budget)) {
                return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
            }
            const gmRows = stmt.all(lastIdx, pageSize);
            if (!gmRows || gmRows.length === 0) { break; }

            let maxRowIdx = lastIdx;
            for (let i = 0; i < gmRows.length; i++) {
                if (fileRows >= budget.maxRowsPerFile || budget.rowsProcessed >= budget.maxRowsTotal) {
                    markBudgetExceeded(budget, 'SQLite row budget exceeded');
                    return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
                }
                const row = gmRows[i];
                const rowIdx = typeof row.idx === 'number' ? row.idx : fileRows;
                if (rowIdx > maxRowIdx) { maxRowIdx = rowIdx; }
                fileRows++;
                budget.rowsProcessed++;

                const data = row.data;
                if (!(data instanceof Uint8Array) || data.length === 0) { continue; }
                let parsed = decodeCliGenMetadataBlob(data, sessionId, rowIdx, 0);
                if (!parsed) {
                    const stepTs = ensureStepTimestamps();
                    if (budget.budgetExceeded) {
                        return { calls: [], cacheable: false, status: 'budget_exceeded', reason: budget.budgetReason };
                    }
                    parsed = decodeCliGenMetadataBlob(data, sessionId, rowIdx, fallbackMs, stepTs);
                }
                if (parsed) {
                    calls.push(parsed);
                }
            }
            if (gmRows.length < pageSize || maxRowIdx <= lastIdx) { break; }
            lastIdx = maxRowIdx;
            await yieldEventLoop();
        }
        return { calls, cacheable: true, status: 'ok' };
    } catch (err) {
        const cls = classifyFsOrSqliteError(err);
        return { calls: [], cacheable: false, status: cls.status, reason: cls.reason };
    } finally {
        if (db) {
            try { db.close(); } catch { /* ignore */ }
        }
        if (tmpDir) {
            await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
const DEFAULT_CACHED_SCAN_TTL_MS = 30_000;

function safeStat(filePath: string): fs.Stats | null {
    try {
        return fs.statSync(filePath);
    } catch {
        return null;
    }
}

async function safeStatAsync(filePath: string): Promise<fs.Stats | null> {
    try {
        return await fs.promises.stat(filePath);
    } catch {
        return null;
    }
}

function buildFileSignatureFromStats(stat: fs.Stats, walStat: fs.Stats | null): string {
    let sig = `${Math.floor(stat.mtimeMs)}:${stat.size}`;
    if (walStat && walStat.isFile() && walStat.size > 0) {
        sig += `|wal:${Math.floor(walStat.mtimeMs)}:${walStat.size}`;
    }
    return sig;
}

function getEffectiveFileMtimeMs(stat: fs.Stats, walStat: fs.Stats | null): number {
    if (walStat && walStat.isFile() && walStat.size > 0) {
        return Math.max(stat.mtimeMs, walStat.mtimeMs);
    }
    return stat.mtimeMs;
}

function cloneDailyUsageRecords(days: readonly CliDailyUsageRecord[]): CliDailyUsageRecord[] {
    return days.map(d => ({
        ...d,
        models: Object.fromEntries(Object.entries(d.models).map(([k, v]) => [k, { ...v }])),
    }));
}

function buildCliCallContentFingerprint(c: CliParsedCall): string {
    const sec = Math.floor(c.createdAtMs / 1000);
    return `${c.sessionId}|${sec}|${c.modelKey}|${c.inputTokens}|${c.outputTokens}|${c.cacheReadTokens}|${c.cacheCreationTokens}`;
}

function yieldEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

export class CliUsageScanner {
    private _cache = new Map<string, FileCacheEntry>();
    private _cacheLimit: number;
    private _lastScanResult: CliScanResult | null = null;
    private _lastScanAtMs = 0;
    private _lastScanKey = '';
    private _lastCompleteDaysByKey = new Map<string, CliDailyUsageRecord[]>();
    private _scanInFlight = new Map<string, Promise<CliScanResult>>();

    constructor(cacheLimit = DEFAULT_CACHE_LIMIT) {
        this._cacheLimit = Math.max(50, Math.floor(cacheLimit));
    }

    /** Current number of cached file entries. */
    get cacheSize(): number { return this._cache.size; }

    /** Clear in-memory mtime+size cache and last cached scan snapshot. */
    clearCache(): void {
        this._cache.clear();
        this._lastScanResult = null;
        this._lastScanAtMs = 0;
        this._lastScanKey = '';
        this._lastCompleteDaysByKey.clear();
    }

    private _buildScanCacheKey(options: CliScanOptions): string {
        const rootDir = options.cliRootDir ? path.resolve(options.cliRootDir) : resolveDefaultCliDataDir();
        const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        const disableSqlite = Boolean(options.disableSqlite);
        const pricingKey = options.customPricing ? JSON.stringify(options.customPricing) : '';
        return `${rootDir}|${maxAgeDays}|${disableSqlite}|${pricingKey}`;
    }

    /**
     * Non-blocking O(1) memory lookup of the most recent CLI scan result for Calendar rendering.
     * Never performs synchronous disk or SQLite I/O; optionally triggers a background `scanAsync()`
     * when uncached or older than `maxAgeMs`.
     */
    getCachedScan(options: CliCachedScanOptions = {}): CliScanResult | null {
        const key = this._buildScanCacheKey(options);
        const nowMs = options.now instanceof Date
            ? options.now.getTime()
            : (typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now());
        const maxAgeMs = typeof options.maxAgeMs === 'number' && Number.isFinite(options.maxAgeMs) && options.maxAgeMs >= 0
            ? options.maxAgeMs
            : DEFAULT_CACHED_SCAN_TTL_MS;
        const triggerRefresh = options.triggerRefresh !== false;

        const hasMatch = this._lastScanResult !== null && this._lastScanKey === key;
        const isFresh = hasMatch && (nowMs - this._lastScanAtMs) <= maxAgeMs;
        if (!isFresh && triggerRefresh && !this._scanInFlight.has(key)) {
            void this.scanAsync(options).catch(() => {});
        }
        return hasMatch ? this._lastScanResult : null;
    }

    /**
     * Asynchronously scan Antigravity CLI local session data read-only without blocking
     * the event loop (uses `fs.promises`, bounded SQLite/JSONL pagination, and yields between chunks).
     * Concurrent scans with matching options are coalesced onto a single in-flight Promise.
     */
    async scanAsync(options: CliScanOptions = {}): Promise<CliScanResult> {
        const cacheKey = this._buildScanCacheKey(options);
        const inFlight = this._scanInFlight.get(cacheKey);
        if (inFlight) {
            return await inFlight;
        }

        const runPromise = this._scanAsyncImpl(options, cacheKey).finally(() => {
            if (this._scanInFlight.get(cacheKey) === runPromise) {
                this._scanInFlight.delete(cacheKey);
            }
        });
        this._scanInFlight.set(cacheKey, runPromise);
        return await runPromise;
    }

    private _buildFinalResult(
        cacheKey: string,
        nowMs: number,
        nowDate: Date,
        rootDir: string,
        allCalls: CliParsedCall[],
        customPricing: Record<string, ModelPricing>,
        budget: ScanBudgetState,
        counters: {
            filesScanned: number;
            cacheHits: number;
            cacheMisses: number;
            errorsSkipped: number;
            busyCount: number;
            unsupportedCount: number;
            unavailableCount: number;
            ioErrorCount: number;
            firstReason?: string;
        },
    ): CliScanResult {
        const elapsedMs = Math.max(0, budget.monoNow() - budget.startMonoMs);
        const freshDays = aggregateCliCallsByDay(allCalls, customPricing);

        const isDegraded = budget.budgetExceeded
            || counters.busyCount > 0
            || counters.ioErrorCount > 0
            || counters.unsupportedCount > 0
            || counters.unavailableCount > 0;

        let status: CliScanStatus;
        let reason: string | undefined;
        if (budget.budgetExceeded) {
            status = 'budget_exceeded';
            reason = budget.budgetReason || counters.firstReason || 'scan budget exceeded';
        } else if (counters.busyCount > 0) {
            status = 'busy';
            reason = counters.firstReason || 'database is busy';
        } else if (counters.unsupportedCount > 0 && freshDays.length === 0) {
            status = 'unsupported';
            reason = counters.firstReason || 'node:sqlite unavailable';
        } else if (counters.ioErrorCount > 0) {
            status = 'error';
            reason = counters.firstReason || 'I/O error while reading CLI usage data';
        } else if (counters.unavailableCount > 0 && freshDays.length === 0) {
            status = 'unavailable';
            reason = counters.firstReason || 'CLI usage files unavailable';
        } else if (counters.unsupportedCount > 0) {
            status = 'unsupported';
            reason = counters.firstReason || 'node:sqlite unavailable for some database files';
        } else if (counters.unavailableCount > 0) {
            status = 'unavailable';
            reason = counters.firstReason || 'some CLI usage files unavailable';
        } else {
            status = freshDays.length > 0 ? 'ok' : 'empty';
        }

        let days = freshDays;
        let preservedLastComplete = false;
        if (!isDegraded) {
            this._lastCompleteDaysByKey.set(cacheKey, cloneDailyUsageRecords(freshDays));
        } else {
            const prevComplete = this._lastCompleteDaysByKey.get(cacheKey);
            if (prevComplete) {
                days = cloneDailyUsageRecords(prevComplete);
                preservedLastComplete = true;
            }
        }

        const result: CliScanResult = {
            available: true,
            status,
            preservedLastComplete,
            budgetExceeded: budget.budgetExceeded,
            ...(reason ? { reason } : {}),
            rootDir,
            days,
            filesScanned: counters.filesScanned,
            rowsProcessed: budget.rowsProcessed,
            bytesRead: budget.bytesRead,
            elapsedMs,
            cacheHits: counters.cacheHits,
            cacheMisses: counters.cacheMisses,
            errorsSkipped: counters.errorsSkipped,
            scannedAt: nowDate.toISOString(),
        };
        this._lastScanResult = result;
        this._lastScanAtMs = nowMs;
        this._lastScanKey = cacheKey;
        return result;
    }

    private _unavailableRoot(cacheKey: string, rootDir: string, nowDate: Date, budget: ScanBudgetState): CliScanResult {
        const previous = this._lastCompleteDaysByKey.get(cacheKey);
        const unavailableRes: CliScanResult = {
            available: false,
            status: 'unavailable',
            preservedLastComplete: previous !== undefined,
            budgetExceeded: false,
            reason: 'CLI data directory not found',
            rootDir,
            days: previous ? cloneDailyUsageRecords(previous) : [],
            filesScanned: 0,
            rowsProcessed: 0,
            bytesRead: 0,
            elapsedMs: Math.max(0, budget.monoNow() - budget.startMonoMs),
            cacheHits: 0,
            cacheMisses: 0,
            errorsSkipped: 0,
            scannedAt: nowDate.toISOString(),
        };
        this._lastScanResult = unavailableRes;
        this._lastScanAtMs = nowDate.getTime();
        this._lastScanKey = cacheKey;
        return unavailableRes;
    }

    private async _scanAsyncImpl(options: CliScanOptions, cacheKey: string): Promise<CliScanResult> {
        const nowDate = options.now instanceof Date
            ? options.now
            : (typeof options.now === 'number' && Number.isFinite(options.now) ? new Date(options.now) : new Date());
        const nowMs = nowDate.getTime();
        const rootDir = options.cliRootDir ? path.resolve(options.cliRootDir) : resolveDefaultCliDataDir();
        const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES));
        const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        const minMtimeMs = maxAgeDays > 0 ? nowMs - maxAgeDays * 86_400_000 : 0;
        const budget = createScanBudgetState(options, maxFiles);

        const rootStat = await safeStatAsync(rootDir);
        if (!rootStat || !rootStat.isDirectory()) {
            return this._unavailableRoot(cacheKey, rootDir, nowDate, budget);
        }

        const counters = {
            filesScanned: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errorsSkipped: 0,
            busyCount: 0,
            unsupportedCount: 0,
            unavailableCount: 0,
            ioErrorCount: 0,
            firstReason: undefined as string | undefined,
        };

        const seenCallIds = new Set<string>();
        const seenDbContentFingerprints = new Set<string>();
        const allCalls: CliParsedCall[] = [];

        const recordOutcomeStatus = (outcome: FileParseOutcome): void => {
            if (outcome.status === 'ok') { return; }
            if (!counters.firstReason && outcome.reason) { counters.firstReason = outcome.reason; }
            if (outcome.status === 'busy') {
                counters.busyCount++;
                counters.errorsSkipped++;
            } else if (outcome.status === 'unsupported') {
                counters.unsupportedCount++;
            } else if (outcome.status === 'unavailable') {
                counters.unavailableCount++;
                counters.errorsSkipped++;
            } else if (outcome.status === 'error') {
                counters.ioErrorCount++;
                counters.errorsSkipped++;
            }
        };

        const ingestFileAsync = async (
            filePath: string,
            sessionId: string,
            kind: 'db' | 'jsonl',
        ): Promise<CliParsedCall[]> => {
            if (checkElapsedBudget(budget)) { return []; }
            if (counters.filesScanned >= maxFiles) {
                markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                return [];
            }
            const stat = await safeStatAsync(filePath);
            if (!stat || !stat.isFile()) { return []; }

            // Check SQLite WAL freshness BEFORE comparing against main DB mtimeMs so active WAL
            // writes on a long-lived conversation DB are never skipped as stale!
            const walStat = kind === 'db' ? await safeStatAsync(`${filePath}-wal`) : null;
            const effectiveMtimeMs = getEffectiveFileMtimeMs(stat, walStat);
            if (minMtimeMs > 0 && effectiveMtimeMs < minMtimeMs) { return []; }

            counters.filesScanned++;
            const signature = buildFileSignatureFromStats(stat, walStat);
            const cached = this._cache.get(filePath);
            if (cached && cached.signature === signature) {
                this._cache.delete(filePath);
                this._cache.set(filePath, cached);
                counters.cacheHits++;
                return cached.calls;
            }

            counters.cacheMisses++;
            if (kind === 'db') {
                await yieldEventLoop();
                const outcome = await parseSqliteDbToCliCallsBoundedAsync(
                    filePath, stat, walStat, sessionId, 0, budget, options.sqliteOpen,
                );
                recordOutcomeStatus(outcome);
                if (outcome.cacheable) {
                    this._setCache(filePath, { signature, calls: outcome.calls });
                }
                return outcome.calls;
            }

            const outcome = await parseJsonlFileBoundedAsync(filePath, stat, sessionId, 0, budget);
            recordOutcomeStatus(outcome);
            if (outcome.cacheable) {
                this._setCache(filePath, { signature, calls: outcome.calls });
            }
            return outcome.calls;
        };

        const addCalls = (calls: CliParsedCall[], source: 'db' | 'jsonl'): void => {
            for (const c of calls) {
                if (seenCallIds.has(c.callId)) { continue; }
                const fp = buildCliCallContentFingerprint(c);
                if (source === 'jsonl' && c.callId.startsWith('cli-json:') && seenDbContentFingerprints.has(fp)) {
                    continue;
                }
                seenCallIds.add(c.callId);
                if (source === 'db') {
                    seenDbContentFingerprints.add(fp);
                }
                allCalls.push(c);
            }
        };

        // 1. Scan conversations/*.db (exact protobuf gen_metadata telemetry)
        if (!options.disableSqlite && !budget.budgetExceeded) {
            const convDir = path.join(rootDir, 'conversations');
            try {
                if ((await safeStatAsync(convDir))?.isDirectory()) {
                    const entries = (await fs.promises.readdir(convDir)).filter(f => f.endsWith('.db'));
                    for (const fileName of entries) {
                        if (checkElapsedBudget(budget)) { break; }
                        if (counters.filesScanned >= maxFiles) {
                            markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                            break;
                        }
                        const sessionId = fileName.slice(0, -3);
                        const calls = await ingestFileAsync(path.join(convDir, fileName), sessionId, 'db');
                        if (calls.length > 0) {
                            addCalls(calls, 'db');
                        }
                    }
                }
            } catch (err) {
                const cls = classifyFsOrSqliteError(err);
                if (cls.status === 'unavailable') { counters.unavailableCount++; } else { counters.ioErrorCount++; }
                if (!counters.firstReason) { counters.firstReason = cls.reason; }
                counters.errorsSkipped++;
            }
        }

        // 2. Scan brain/<id>/.system_generated/logs/transcript.jsonl & brain/<id>/transcript.jsonl
        if (!budget.budgetExceeded) {
            const brainDir = path.join(rootDir, 'brain');
            try {
                if ((await safeStatAsync(brainDir))?.isDirectory()) {
                    const dirs = await fs.promises.readdir(brainDir);
                    for (const dirName of dirs) {
                        if (checkElapsedBudget(budget)) { break; }
                        if (counters.filesScanned >= maxFiles) {
                            markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                            break;
                        }
                        if (dirName.startsWith('.')) { continue; }
                        const fullDir = path.join(brainDir, dirName);
                        if (!(await safeStatAsync(fullDir))?.isDirectory()) { continue; }
                        const cand1 = path.join(fullDir, '.system_generated', 'logs', 'transcript.jsonl');
                        const cand2 = path.join(fullDir, 'transcript.jsonl');
                        const target = (await safeStatAsync(cand1))?.isFile()
                            ? cand1
                            : ((await safeStatAsync(cand2))?.isFile() ? cand2 : null);
                        if (target) {
                            addCalls(await ingestFileAsync(target, dirName, 'jsonl'), 'jsonl');
                        }
                    }
                }
            } catch (err) {
                const cls = classifyFsOrSqliteError(err);
                if (cls.status === 'unavailable') { counters.unavailableCount++; } else { counters.ioErrorCount++; }
                if (!counters.firstReason) { counters.firstReason = cls.reason; }
                counters.errorsSkipped++;
            }
        }

        // 3. Scan optional usage/*.jsonl, sessions/*.json, sessions/*.jsonl
        if (!budget.budgetExceeded) {
            for (const subDirName of ['usage', 'sessions']) {
                if (checkElapsedBudget(budget)) { break; }
                const subDir = path.join(rootDir, subDirName);
                try {
                    if (!(await safeStatAsync(subDir))?.isDirectory()) { continue; }
                    const files = (await fs.promises.readdir(subDir)).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
                    for (const fileName of files) {
                        if (checkElapsedBudget(budget)) { break; }
                        if (counters.filesScanned >= maxFiles) {
                            markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                            break;
                        }
                        const sessionId = fileName.replace(/\.(?:jsonl|json)$/i, '');
                        addCalls(await ingestFileAsync(path.join(subDir, fileName), sessionId, 'jsonl'), 'jsonl');
                    }
                } catch (err) {
                    const cls = classifyFsOrSqliteError(err);
                    if (cls.status === 'unavailable') { counters.unavailableCount++; } else { counters.ioErrorCount++; }
                    if (!counters.firstReason) { counters.firstReason = cls.reason; }
                    counters.errorsSkipped++;
                }
            }
        }

        return this._buildFinalResult(
            cacheKey, nowMs, nowDate, rootDir, allCalls, options.customPricing || {}, budget, counters,
        );
    }

    /**
     * Scan Antigravity CLI local session data read-only and aggregate by local day.
     * An unavailable directory retains the last complete result when one exists.
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
        const cacheKey = this._buildScanCacheKey(options);
        const budget = createScanBudgetState(options, maxFiles);

        const rootStat = safeStat(rootDir);
        if (!rootStat || !rootStat.isDirectory()) {
            return this._unavailableRoot(cacheKey, rootDir, nowDate, budget);
        }

        const counters = {
            filesScanned: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errorsSkipped: 0,
            busyCount: 0,
            unsupportedCount: 0,
            unavailableCount: 0,
            ioErrorCount: 0,
            firstReason: undefined as string | undefined,
        };

        const seenCallIds = new Set<string>();
        const seenDbContentFingerprints = new Set<string>();
        const allCalls: CliParsedCall[] = [];

        const recordOutcomeStatus = (outcome: FileParseOutcome): void => {
            if (outcome.status === 'ok') { return; }
            if (!counters.firstReason && outcome.reason) { counters.firstReason = outcome.reason; }
            if (outcome.status === 'busy') {
                counters.busyCount++;
                counters.errorsSkipped++;
            } else if (outcome.status === 'unsupported') {
                counters.unsupportedCount++;
            } else if (outcome.status === 'unavailable') {
                counters.unavailableCount++;
                counters.errorsSkipped++;
            } else if (outcome.status === 'error') {
                counters.ioErrorCount++;
                counters.errorsSkipped++;
            }
        };

        const ingestFile = (
            filePath: string,
            sessionId: string,
            kind: 'db' | 'jsonl',
        ): CliParsedCall[] => {
            if (checkElapsedBudget(budget)) { return []; }
            if (counters.filesScanned >= maxFiles) {
                markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                return [];
            }
            const stat = safeStat(filePath);
            if (!stat || !stat.isFile()) { return []; }

            // Check SQLite WAL freshness BEFORE main DB mtimeMs so active WAL writes are not skipped as stale!
            const walStat = kind === 'db' ? safeStat(`${filePath}-wal`) : null;
            const effectiveMtimeMs = getEffectiveFileMtimeMs(stat, walStat);
            if (minMtimeMs > 0 && effectiveMtimeMs < minMtimeMs) { return []; }

            counters.filesScanned++;
            const signature = buildFileSignatureFromStats(stat, walStat);
            const cached = this._cache.get(filePath);
            if (cached && cached.signature === signature) {
                this._cache.delete(filePath);
                this._cache.set(filePath, cached);
                counters.cacheHits++;
                return cached.calls;
            }

            counters.cacheMisses++;
            if (kind === 'db') {
                const outcome = parseSqliteDbToCliCallsBoundedSync(
                    filePath, stat, walStat, sessionId, 0, budget, options.sqliteOpen,
                );
                recordOutcomeStatus(outcome);
                if (outcome.cacheable) {
                    this._setCache(filePath, { signature, calls: outcome.calls });
                }
                return outcome.calls;
            }

            const outcome = parseJsonlFileBoundedSync(filePath, stat, sessionId, 0, budget);
            recordOutcomeStatus(outcome);
            if (outcome.cacheable) {
                this._setCache(filePath, { signature, calls: outcome.calls });
            }
            return outcome.calls;
        };

        const addCalls = (calls: CliParsedCall[], source: 'db' | 'jsonl'): void => {
            for (const c of calls) {
                if (seenCallIds.has(c.callId)) { continue; }
                const fp = buildCliCallContentFingerprint(c);
                if (source === 'jsonl' && c.callId.startsWith('cli-json:') && seenDbContentFingerprints.has(fp)) {
                    continue;
                }
                seenCallIds.add(c.callId);
                if (source === 'db') {
                    seenDbContentFingerprints.add(fp);
                }
                allCalls.push(c);
            }
        };

        // 1. Scan conversations/*.db (exact protobuf gen_metadata telemetry)
        if (!options.disableSqlite && !budget.budgetExceeded) {
            const convDir = path.join(rootDir, 'conversations');
            try {
                if (safeStat(convDir)?.isDirectory()) {
                    const entries = fs.readdirSync(convDir).filter(f => f.endsWith('.db'));
                    for (const fileName of entries) {
                        if (checkElapsedBudget(budget)) { break; }
                        if (counters.filesScanned >= maxFiles) {
                            markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                            break;
                        }
                        const sessionId = fileName.slice(0, -3);
                        const calls = ingestFile(path.join(convDir, fileName), sessionId, 'db');
                        if (calls.length > 0) {
                            addCalls(calls, 'db');
                        }
                    }
                }
            } catch (err) {
                const cls = classifyFsOrSqliteError(err);
                if (cls.status === 'unavailable') { counters.unavailableCount++; } else { counters.ioErrorCount++; }
                if (!counters.firstReason) { counters.firstReason = cls.reason; }
                counters.errorsSkipped++;
            }
        }

        // 2. Scan brain/<id>/.system_generated/logs/transcript.jsonl & brain/<id>/transcript.jsonl
        if (!budget.budgetExceeded) {
            const brainDir = path.join(rootDir, 'brain');
            try {
                if (safeStat(brainDir)?.isDirectory()) {
                    const dirs = fs.readdirSync(brainDir);
                    for (const dirName of dirs) {
                        if (checkElapsedBudget(budget)) { break; }
                        if (counters.filesScanned >= maxFiles) {
                            markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                            break;
                        }
                        if (dirName.startsWith('.')) { continue; }
                        const fullDir = path.join(brainDir, dirName);
                        if (!safeStat(fullDir)?.isDirectory()) { continue; }
                        const cand1 = path.join(fullDir, '.system_generated', 'logs', 'transcript.jsonl');
                        const cand2 = path.join(fullDir, 'transcript.jsonl');
                        const target = safeStat(cand1)?.isFile() ? cand1 : (safeStat(cand2)?.isFile() ? cand2 : null);
                        if (target) {
                            addCalls(ingestFile(target, dirName, 'jsonl'), 'jsonl');
                        }
                    }
                }
            } catch (err) {
                const cls = classifyFsOrSqliteError(err);
                if (cls.status === 'unavailable') { counters.unavailableCount++; } else { counters.ioErrorCount++; }
                if (!counters.firstReason) { counters.firstReason = cls.reason; }
                counters.errorsSkipped++;
            }
        }

        // 3. Scan optional usage/*.jsonl, sessions/*.json, sessions/*.jsonl
        if (!budget.budgetExceeded) {
            for (const subDirName of ['usage', 'sessions']) {
                if (checkElapsedBudget(budget)) { break; }
                const subDir = path.join(rootDir, subDirName);
                try {
                    if (!safeStat(subDir)?.isDirectory()) { continue; }
                    const files = fs.readdirSync(subDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
                    for (const fileName of files) {
                        if (checkElapsedBudget(budget)) { break; }
                        if (counters.filesScanned >= maxFiles) {
                            markBudgetExceeded(budget, `file budget exceeded (${maxFiles})`);
                            break;
                        }
                        const sessionId = fileName.replace(/\.(?:jsonl|json)$/i, '');
                        addCalls(ingestFile(path.join(subDir, fileName), sessionId, 'jsonl'), 'jsonl');
                    }
                } catch (err) {
                    const cls = classifyFsOrSqliteError(err);
                    if (cls.status === 'unavailable') { counters.unavailableCount++; } else { counters.ioErrorCount++; }
                    if (!counters.firstReason) { counters.firstReason = cls.reason; }
                    counters.errorsSkipped++;
                }
            }
        }

        return this._buildFinalResult(
            cacheKey, nowMs, nowDate, rootDir, allCalls, options.customPricing || {}, budget, counters,
        );
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

/** Async non-blocking scan convenience helper using the default cached scanner. */
export function scanCliUsageDaysAsync(options?: CliScanOptions): Promise<CliScanResult> {
    return defaultCliScanner.scanAsync(options);
}

/** Non-blocking memory-cached CLI scan lookup (triggers async background refresh when stale). */
export function getCachedCliUsageDays(options?: CliCachedScanOptions): CliScanResult | null {
    return defaultCliScanner.getCachedScan(options);
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
 * Uses sum-before-round (`sumAndConvertUsdAmounts`) and attaches structured
 * `CurrencyExportRecord` fields preserving raw numeric USD, currency code, and
 * applied FX rate independently of localized display strings.
 */
export function buildCalendarExportJson(
    days: readonly CalendarExportDayRow[],
    meta: CalendarExportMetadata = {},
): string {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const resolvedCurrency = resolveCurrencyConfig(meta.currency);
    const { preset, ratePerUsd, isCustomRate } = resolvedCurrency;

    let totalCalls = 0;
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let totalCredits = 0;
    let peakDay: { date: string; totalTokens: number; estimatedCostUsd: number } | null = null;
    const rawDayCosts: number[] = [];

    for (const d of sorted) {
        const additive = d.totalTokens > 0 ? d.totalTokens : computeAdditiveTokens(d);
        const safeCost = Number.isFinite(d.estimatedCostUsd) ? d.estimatedCostUsd : 0;
        totalCalls += d.calls;
        totalTokens += additive;
        inputTokens += d.inputTokens;
        outputTokens += d.outputTokens;
        thinkingTokens += d.thinkingTokens;
        cacheReadTokens += d.cacheReadTokens;
        cacheCreationTokens += d.cacheCreationTokens;
        rawDayCosts.push(safeCost);
        totalCredits += d.credits;
        if (!peakDay || additive > peakDay.totalTokens) {
            peakDay = {
                date: d.date,
                totalTokens: additive,
                estimatedCostUsd: safeCost,
            };
        }
    }

    // Sum raw USD first, then convert and round once (sum-before-round contract)
    const summedCost = sumAndConvertUsdAmounts(rawDayCosts, meta.currency);
    const estimatedCostUsd = summedCost.totalUsd ?? 0;
    const summaryCostRecord = buildCurrencyExportRecord(estimatedCostUsd, meta.currency);

    const activeDays = sorted.length;
    const spanDays = computeCalendarSpanDays(sorted, meta);
    const streaks = computeActivityStreaks(sorted.map(d => d.date), meta.rangeEnd);
    const roi = estimateSubscriptionRoi(estimatedCostUsd, spanDays, meta.subscription, meta.currency);
    const localDecimals = preset.standardDecimals === 0 ? 2 : 4;

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
            isCustomFxRate: isCustomRate,
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
            estimatedCostLocal: Number((estimatedCostUsd * ratePerUsd).toFixed(localDecimals)),
            cost: summaryCostRecord,
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
            const dayCostRecord = buildCurrencyExportRecord(safeCostUsd, meta.currency);
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
                estimatedCostLocal: Number((safeCostUsd * ratePerUsd).toFixed(localDecimals)),
                cost: dayCostRecord,
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

/**
 * RFC 4180 CSV cell escaper with whitespace-normalized formula-injection guard:
 * neutralizes leading `=`, `+`, `-`, `@`, `\t`, `\r` (including after leading
 * spaces/whitespace/control prefixes) and double-quotes multiline or comma/quote fields.
 */
export function escapeCsvCell(value: string, guardFormula = true): string {
    let text = String(value);
    if (guardFormula) {
        const leadingTrimmed = text.replace(/^[ \t\r\n\f\v\u00A0]+/, '');
        if (/^[=+\-@\t\r]/.test(text) || /^[=+\-@]/.test(leadingTrimmed)) {
            text = `'${text}`;
        }
    }
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * Escape untrusted cell content for GitHub-Flavored Markdown tables.
 */
export function escapeMarkdownCell(value: string): string {
    return String(value)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Pure Markdown table export builder for a filtered Calendar date range.
 * Shares the exact range/filter/currency contract with CSV & JSON exports.
 */
export function buildCalendarExportMarkdown(
    days: readonly CalendarExportDayRow[],
    meta: CalendarExportMetadata = {},
): string {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const { preset, ratePerUsd } = resolveCurrencyConfig(meta.currency);
    const rangeLabel = meta.rangeStart && meta.rangeEnd
        ? `${meta.rangeStart} .. ${meta.rangeEnd}`
        : (sorted.length > 0 ? `${sorted[0].date} .. ${sorted[sorted.length - 1].date}` : 'empty');

    const lines: string[] = [
        `# Usage Export (${escapeMarkdownCell(meta.sourceFilter || 'all')} · ${escapeMarkdownCell(meta.periodMode || 'daily')})`,
        '',
        `- Range: \`${escapeMarkdownCell(rangeLabel)}\``,
        `- Currency: \`${preset.code}\` (1 USD = ${ratePerUsd} ${preset.code})`,
        `- Active Days: ${sorted.length}`,
        '',
        '| Date | Sources | Calls | Total Tokens | Cost (USD) | Cost (Local) | Top Models |',
        '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ];

    for (const d of sorted) {
        const totalTokens = d.totalTokens > 0 ? d.totalTokens : computeAdditiveTokens(d);
        const safeCostUsd = Number.isFinite(d.estimatedCostUsd) && d.estimatedCostUsd > 0 ? d.estimatedCostUsd : 0;
        const topModels = Object.entries(d.models || {})
            .sort((a, b) => (b[1].totalTokens || 0) - (a[1].totalTokens || 0))
            .slice(0, 5)
            .map(([name, m]) => `${name}:${m.totalTokens || computeAdditiveTokens(m)}`)
            .join('; ');
        lines.push(
            `| ${escapeMarkdownCell(d.date)} | ${escapeMarkdownCell((d.sources || ['unknown']).join(', '))} | ${d.calls} | ${totalTokens} | ${formatCurrencyAmount(safeCostUsd, 'USD')} | ${formatCurrencyAmount(safeCostUsd, meta.currency)} | ${escapeMarkdownCell(topModels || '—')} |`,
        );
    }

    return lines.join('\n') + '\n';
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
    const localDecimals = preset.standardDecimals === 0 ? 2 : 4;

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
            localCost.toFixed(localDecimals),
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

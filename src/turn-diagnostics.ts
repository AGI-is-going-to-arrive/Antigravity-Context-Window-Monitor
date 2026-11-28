// ─── Pure Turn Diagnostics & Prompt-Cache Classification Engine ──────────────
// Analyzes recent model calls (GMCallEntry or raw GetCascadeTrajectoryGeneratorMetadata
// entries) into per-turn cache-hit classification (Cold / Partial / Warm), net
// context growth (+Δ / negative post-compaction Δ), TTFT, and decode throughput.
//
// Follows Antigravity ground-truth protobuf semantics by default:
//   - cacheReadTokens and cacheCreationTokens are strictly ADDITIVE with fresh inputTokens:
//       totalPromptTokens = freshInputTokens + cacheReadTokens + cacheCreationTokens
//   - thinkingOutputTokens is strictly a SUBSET of outputTokens (never summed).
//   - streamingDuration strictly excludes TTFT; sub-50ms or <2 output token samples
//     return null tok/s to prevent division noise / Infinity.
//
// Zero VS Code, DOM, or external npm dependencies.

import { COMPRESSION_MIN_DROP } from './constants';
import type { GMCallEntry } from './gm/types';
import { normalizeModelDisplayName } from './models';
import {
    PROMPT_CACHE_COLD_THRESHOLD_PCT,
    PROMPT_CACHE_WARM_THRESHOLD_PCT,
    classifyPromptCacheState,
    type PromptCacheState,
} from './telemetry-metrics';

export { classifyPromptCacheState, type PromptCacheState };

// ─── Thresholds & Constants ──────────────────────────────────────────────────

/** Cache hit % below this threshold is classified as Cold Start. */
export const COLD_START_THRESHOLD_PCT = PROMPT_CACHE_COLD_THRESHOLD_PCT;

/** Cache hit % at or above this threshold is classified as Warm Start. */
export const WARM_START_THRESHOLD_PCT = PROMPT_CACHE_WARM_THRESHOLD_PCT;

/** Minimum valid TTFT in milliseconds (sub-1ms timing is treated as invalid/noise). */
export const MIN_VALID_TTFT_MS = 1;

/** Minimum streaming duration in seconds for valid decode throughput (matches telemetry-metrics). */
export const MIN_VALID_STREAMING_SECONDS = 0.05;

/** Minimum output tokens for valid decode throughput (matches telemetry-metrics). */
export const MIN_VALID_OUTPUT_TOKENS = 2;

export const DEFAULT_MAX_TURNS = 50;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TurnStartKind = PromptCacheState;

export type CacheTokenSemantics = 'additive' | 'inclusive';

export interface TurnDiagnosticEntry {
    /** 1-based sequential turn number across the analyzed call stream. */
    turnIndex: number;
    /** Primary trajectory step index if available. */
    stepIndex?: number;
    /** ISO-8601 timestamp if available. */
    timestamp?: string;
    /** Normalized model display name or model ID if available. */
    model?: string;
    /** Total prompt input tokens for this turn (fresh + cacheRead + cacheCreation in additive mode). */
    inputTokens: number;
    /** Fresh (non-cached) input tokens. */
    freshInputTokens: number;
    /** Prompt tokens served from cache. */
    cacheReadTokens: number;
    /** Prompt tokens written to cache. */
    cacheCreationTokens: number;
    /** Total output tokens (includes thinkingTokens). */
    outputTokens: number;
    /** Thinking / reasoning tokens (subset of outputTokens). */
    thinkingTokens: number;
    /** Cache hit percentage in [0, 100], or null when inputTokens <= 0 or cache telemetry is missing. */
    cacheHitPct: number | null;
    /** Cold (<10%), Partial (10%–<70%), Warm (>=70%), or Unknown. */
    startKind: TurnStartKind;
    /** Net change in total prompt inputTokens compared to the previous valid turn (negative on compaction/rewind). */
    deltaTokens: number | null;
    /** True when deltaTokens reflects a significant compaction/context drop. */
    isCompactionDrop: boolean;
    /** Time to first token in milliseconds, or null if absent/sub-1ms/invalid. */
    ttftMs: number | null;
    /** Decode generation speed in tokens/sec, or null if streaming duration is too short/invalid. */
    tokPerSec: number | null;
}

export interface TurnDiagnosticsSummary {
    /** Cache hit percentage of the latest turn (0..100), or null if unavailable. */
    lastTurnCacheHitPct: number | null;
    /** Token-weighted session cache hit percentage (0..100), or null if no eligible turns. */
    sessionCacheHitPct: number | null;
    /** Start classification of the latest turn. */
    lastTurnStartKind: TurnStartKind;
    /** Most recent turns (up to maxTurns), chronologically ordered oldest -> newest. */
    turns: TurnDiagnosticEntry[];
    /** Total turns processed before maxTurns slicing. */
    totalTurns: number;
    coldCount: number;
    partialCount: number;
    warmCount: number;
    unknownCount: number;
    totalInputTokens: number;
    totalCacheReadTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
}

/** Flexible raw turn input accepted by `analyzeTurnDiagnostics`. */
export interface RawTurnCallInput {
    stepIndex?: number;
    stepIndices?: number[];
    timestamp?: string;
    createdAt?: string;
    model?: string;
    modelDisplay?: string;
    modelDisplayName?: string;
    responseModel?: string;
    inputTokens?: number | string | null;
    cacheReadTokens?: number | string | null;
    cacheCreationTokens?: number | string | null;
    outputTokens?: number | string | null;
    thinkingTokens?: number | string | null;
    thinkingOutputTokens?: number | string | null;
    responseTokens?: number | string | null;
    responseOutputTokens?: number | string | null;
    ttftSeconds?: number | string | null;
    ttftMs?: number | string | null;
    streamingSeconds?: number | string | null;
    streamingMs?: number | string | null;
    cacheTelemetryAvailable?: boolean;
    /** Raw GetCascadeTrajectoryGeneratorMetadata nested chatModel payload. */
    chatModel?: {
        model?: string;
        modelDisplayName?: string;
        responseModel?: string;
        timeToFirstToken?: number | string | null;
        streamingDuration?: number | string | null;
        usage?: {
            model?: string;
            inputTokens?: number | string | null;
            outputTokens?: number | string | null;
            thinkingOutputTokens?: number | string | null;
            responseOutputTokens?: number | string | null;
            cacheReadTokens?: number | string | null;
            cacheCreationTokens?: number | string | null;
        } | null;
        chatStartMetadata?: {
            createdAt?: string;
            startStepIndex?: number | string;
        } | null;
    } | null;
}

export type TurnDiagnosticsInputItem = GMCallEntry | RawTurnCallInput | Record<string, unknown>;

export interface TurnDiagnosticsOptions {
    /** Maximum number of most recent turns to retain in `turns[]`. Defaults to 50. */
    maxTurns?: number;
    /**
     * Token accounting semantics for `inputTokens` vs `cacheReadTokens`.
     * Defaults to `'additive'` (Antigravity protobuf standard).
     */
    cacheSemantics?: CacheTokenSemantics;
    /**
     * When true, calls where `cacheReadTokens` is `undefined` are treated as missing
     * cache telemetry (`cacheHitPct: null`, `startKind: 'unknown'`) instead of proto3 zero.
     * Defaults to `false` (explicit `null` or `cacheTelemetryAvailable: false` still yields `null`).
     */
    treatUndefinedCacheAsMissing?: boolean;
}

// ─── Primitive Helpers ───────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function parseNonNegNumber(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) { return null; }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    return null;
}

function parseNonNegInt(value: unknown): number {
    const parsed = parseNonNegNumber(value);
    return parsed !== null ? Math.round(parsed) : 0;
}

function round1(value: number): number {
    if (!Number.isFinite(value)) { return 0; }
    return Math.round(value * 10) / 10;
}

/**
 * Parse protobuf/API duration strings (`"1.25s"`, `"450ms"`, `"250us"`, `"100ns"`)
 * or raw numeric seconds into finite non-negative seconds.
 */
export function parseDurationSeconds(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : null;
    }
    if (typeof value !== 'string') { return null; }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) { return null; }

    const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(ns|us|µs|μs|ms|s)?$/i);
    if (!match) { return null; }
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) { return null; }

    const unit = (match[2] || 's').toLowerCase();
    switch (unit) {
        case 'ns': return num / 1_000_000_000;
        case 'us':
        case 'µs':
        case 'μs': return num / 1_000_000;
        case 'ms': return num / 1_000;
        default: return num;
    }
}

// ─── Classification Helper ───────────────────────────────────────────────────

/**
 * Classify a turn's prompt cache start kind from its cache hit percentage (0..100)
 * and total prompt `inputTokens`.
 *
 * - `inputTokens <= 0` or `cacheHitPct === null` -> `'unknown'`
 * - `cacheHitPct < 10` -> `'cold'`
 * - `10 <= cacheHitPct < 70` -> `'partial'`
 * - `cacheHitPct >= 70` -> `'warm'`
 */
export function classifyTurnStartKind(
    cacheHitPct: number | null | undefined,
    inputTokens: number,
): TurnStartKind {
    if (!Number.isFinite(inputTokens) || inputTokens <= 0) {
        return 'unknown';
    }
    return classifyPromptCacheState(cacheHitPct);
}

// ─── Normalization ───────────────────────────────────────────────────────────

interface NormalizedTurnFields {
    stepIndex?: number;
    timestamp?: string;
    model?: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    hasCacheTelemetry: boolean;
    outputTokens: number;
    thinkingTokens: number;
    ttftSeconds: number | null;
    streamingSeconds: number | null;
}

function normalizeTurnItem(
    rawItem: TurnDiagnosticsInputItem,
    treatUndefinedCacheAsMissing: boolean,
): NormalizedTurnFields | null {
    const rec = asRecord(rawItem);
    if (!rec) { return null; }

    const cm = asRecord(rec.chatModel);
    const usage = asRecord(cm?.usage);
    const csm = asRecord(cm?.chatStartMetadata);

    // Step index
    let stepIndex: number | undefined;
    if (typeof rec.stepIndex === 'number' && Number.isFinite(rec.stepIndex) && rec.stepIndex >= 0) {
        stepIndex = Math.round(rec.stepIndex);
    } else if (Array.isArray(rec.stepIndices)) {
        const validSteps = rec.stepIndices.filter(
            (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0,
        );
        if (validSteps.length > 0) {
            stepIndex = Math.min(...validSteps);
        }
    } else if (csm && csm.startStepIndex !== undefined) {
        const parsedStart = parseNonNegNumber(csm.startStepIndex);
        if (parsedStart !== null) {
            stepIndex = Math.round(parsedStart);
        }
    }

    // Timestamp
    const timestamp = (typeof rec.timestamp === 'string' && rec.timestamp.trim())
        || (typeof rec.createdAt === 'string' && rec.createdAt.trim())
        || (typeof csm?.createdAt === 'string' && csm.createdAt.trim())
        || undefined;

    // Model label
    const rawModelDisplay = (typeof rec.modelDisplayName === 'string' && rec.modelDisplayName.trim())
        || (typeof rec.modelDisplay === 'string' && rec.modelDisplay.trim())
        || (typeof cm?.modelDisplayName === 'string' && cm.modelDisplayName.trim())
        || '';
    const rawModelId = (typeof rec.model === 'string' && rec.model.trim())
        || (typeof cm?.model === 'string' && cm.model.trim())
        || (typeof usage?.model === 'string' && usage.model.trim())
        || (typeof rec.responseModel === 'string' && rec.responseModel.trim())
        || (typeof cm?.responseModel === 'string' && cm.responseModel.trim())
        || '';
    const model = rawModelDisplay || (rawModelId ? (normalizeModelDisplayName(rawModelId) || rawModelId) : undefined);

    // Token fields (support both flat GMCallEntry and nested chatModel.usage)
    const sourceObj = usage ?? rec;
    const rawFreshInput = sourceObj.inputTokens;
    const rawCacheRead = sourceObj.cacheReadTokens;
    const rawCacheCreation = sourceObj.cacheCreationTokens;

    const freshInputTokens = parseNonNegInt(rawFreshInput);
    const cacheCreationTokens = parseNonNegInt(rawCacheCreation);

    // Determine cache telemetry availability cleanly:
    // - Explicit cacheTelemetryAvailable === false -> missing
    // - Explicit cacheReadTokens === null or invalid non-numeric value -> missing
    // - Undefined cacheReadTokens -> 0 (proto3 default) unless treatUndefinedCacheAsMissing is true
    let hasCacheTelemetry = true;
    let cacheReadTokens = 0;

    if (rec.cacheTelemetryAvailable === false) {
        hasCacheTelemetry = false;
    } else if (rawCacheRead === null) {
        hasCacheTelemetry = false;
    } else if (rawCacheRead === undefined) {
        hasCacheTelemetry = !treatUndefinedCacheAsMissing;
        cacheReadTokens = 0;
    } else {
        const parsedCacheRead = parseNonNegNumber(rawCacheRead);
        if (parsedCacheRead === null) {
            hasCacheTelemetry = false;
            cacheReadTokens = 0;
        } else {
            cacheReadTokens = Math.round(parsedCacheRead);
        }
    }

    const explicitOutput = parseNonNegInt(sourceObj.outputTokens);
    const explicitThinking = parseNonNegInt(
        sourceObj.thinkingOutputTokens !== undefined ? sourceObj.thinkingOutputTokens : sourceObj.thinkingTokens,
    );
    const explicitResponse = parseNonNegInt(
        sourceObj.responseOutputTokens !== undefined ? sourceObj.responseOutputTokens : sourceObj.responseTokens,
    );

    const outputTokens = explicitOutput > 0
        ? explicitOutput
        : (explicitThinking + explicitResponse);
    // Thinking tokens are a subset of outputTokens; handle implicit thinking when omitted
    const thinkingTokens = explicitThinking > 0
        ? Math.min(explicitThinking, outputTokens > 0 ? outputTokens : explicitThinking)
        : (explicitResponse > 0 && outputTokens > explicitResponse ? outputTokens - explicitResponse : 0);

    // Timings: TTFT and Streaming duration
    let ttftSeconds: number | null = null;
    if (rec.ttftMs !== undefined && rec.ttftMs !== null) {
        const ms = parseNonNegNumber(rec.ttftMs);
        ttftSeconds = ms !== null && ms > 0 ? ms / 1000 : null;
    } else if (rec.ttftSeconds !== undefined && rec.ttftSeconds !== null) {
        ttftSeconds = parseDurationSeconds(rec.ttftSeconds);
    } else if (cm && cm.timeToFirstToken !== undefined && cm.timeToFirstToken !== null) {
        ttftSeconds = parseDurationSeconds(cm.timeToFirstToken);
    }

    let streamingSeconds: number | null = null;
    if (rec.streamingMs !== undefined && rec.streamingMs !== null) {
        const ms = parseNonNegNumber(rec.streamingMs);
        streamingSeconds = ms !== null && ms > 0 ? ms / 1000 : null;
    } else if (rec.streamingSeconds !== undefined && rec.streamingSeconds !== null) {
        streamingSeconds = parseDurationSeconds(rec.streamingSeconds);
    } else if (cm && cm.streamingDuration !== undefined && cm.streamingDuration !== null) {
        streamingSeconds = parseDurationSeconds(cm.streamingDuration);
    }

    return {
        stepIndex,
        timestamp,
        model,
        freshInputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        hasCacheTelemetry,
        outputTokens,
        thinkingTokens,
        ttftSeconds,
        streamingSeconds,
    };
}

// ─── Main Analyzer ───────────────────────────────────────────────────────────

/**
 * Analyze a sequence of model calls / generator metadata entries into a
 * `TurnDiagnosticsSummary` with per-turn cache hit %, Cold/Partial/Warm start
 * classification, token-weighted session cache hit %, net `+Δ`/`-Δ` context
 * growth, TTFT, and generation speed.
 */
export function analyzeTurnDiagnostics(
    items: ReadonlyArray<TurnDiagnosticsInputItem>,
    options: TurnDiagnosticsOptions = {},
): TurnDiagnosticsSummary {
    const maxTurns = typeof options.maxTurns === 'number' && Number.isFinite(options.maxTurns) && options.maxTurns >= 0
        ? Math.round(options.maxTurns)
        : DEFAULT_MAX_TURNS;
    const cacheSemantics: CacheTokenSemantics = options.cacheSemantics ?? 'additive';
    const treatUndefinedCacheAsMissing = options.treatUndefinedCacheAsMissing === true;

    const allTurns: TurnDiagnosticEntry[] = [];
    let prevValidInputTokens: number | null = null;

    let coldCount = 0;
    let partialCount = 0;
    let warmCount = 0;
    let unknownCount = 0;

    let totalInputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;

    // Numerator / denominator ONLY across turns with valid cache telemetry & inputTokens > 0
    let weightedCacheReadSum = 0;
    let weightedInputSum = 0;

    if (Array.isArray(items)) {
        for (const rawItem of items) {
            const norm = normalizeTurnItem(rawItem, treatUndefinedCacheAsMissing);
            if (!norm) { continue; }

            const totalPromptTokens = cacheSemantics === 'additive'
                ? norm.freshInputTokens + norm.cacheReadTokens + norm.cacheCreationTokens
                : Math.max(norm.freshInputTokens, norm.cacheReadTokens);

            const effectiveCacheRead = cacheSemantics === 'inclusive'
                ? Math.min(norm.cacheReadTokens, totalPromptTokens)
                : norm.cacheReadTokens;

            let cacheHitPct: number | null = null;
            if (totalPromptTokens > 0 && norm.hasCacheTelemetry) {
                const rawPct = (effectiveCacheRead / totalPromptTokens) * 100;
                cacheHitPct = Number.isFinite(rawPct)
                    ? round1(Math.max(0, Math.min(100, rawPct)))
                    : null;
            }

            const startKind = classifyTurnStartKind(cacheHitPct, totalPromptTokens);
            switch (startKind) {
                case 'cold': coldCount++; break;
                case 'partial': partialCount++; break;
                case 'warm': warmCount++; break;
                default: unknownCount++; break;
            }

            let deltaTokens: number | null = null;
            if (totalPromptTokens > 0) {
                if (prevValidInputTokens !== null) {
                    deltaTokens = totalPromptTokens - prevValidInputTokens;
                }
                prevValidInputTokens = totalPromptTokens;
            }
            const isCompactionDrop = deltaTokens !== null && deltaTokens <= -COMPRESSION_MIN_DROP;

            // Sub-1ms TTFT is treated as invalid/noise (avoids bogus 0ms readings)
            const rawTtftMs = norm.ttftSeconds !== null ? norm.ttftSeconds * 1000 : null;
            const ttftMs = rawTtftMs !== null && Number.isFinite(rawTtftMs) && rawTtftMs >= MIN_VALID_TTFT_MS
                ? Math.round(rawTtftMs)
                : null;

            // Sub-50ms (including sub-1ms) streaming or <2 output tokens -> null tok/s (prevents Infinity/spikes)
            let tokPerSec: number | null = null;
            if (
                norm.streamingSeconds !== null
                && Number.isFinite(norm.streamingSeconds)
                && norm.streamingSeconds >= MIN_VALID_STREAMING_SECONDS
                && norm.outputTokens >= MIN_VALID_OUTPUT_TOKENS
            ) {
                const speed = norm.outputTokens / norm.streamingSeconds;
                if (Number.isFinite(speed) && speed > 0) {
                    tokPerSec = round1(speed);
                }
            }

            totalInputTokens += totalPromptTokens;
            totalCacheReadTokens += effectiveCacheRead;
            totalOutputTokens += norm.outputTokens;
            totalThinkingTokens += norm.thinkingTokens;

            if (cacheHitPct !== null && totalPromptTokens > 0) {
                weightedCacheReadSum += effectiveCacheRead;
                weightedInputSum += totalPromptTokens;
            }

            allTurns.push({
                turnIndex: allTurns.length + 1,
                ...(norm.stepIndex !== undefined ? { stepIndex: norm.stepIndex } : {}),
                ...(norm.timestamp !== undefined ? { timestamp: norm.timestamp } : {}),
                ...(norm.model !== undefined ? { model: norm.model } : {}),
                inputTokens: totalPromptTokens,
                freshInputTokens: cacheSemantics === 'inclusive'
                    ? Math.max(0, totalPromptTokens - effectiveCacheRead)
                    : norm.freshInputTokens,
                cacheReadTokens: effectiveCacheRead,
                cacheCreationTokens: norm.cacheCreationTokens,
                outputTokens: norm.outputTokens,
                thinkingTokens: norm.thinkingTokens,
                cacheHitPct,
                startKind,
                deltaTokens,
                isCompactionDrop,
                ttftMs,
                tokPerSec,
            });
        }
    }

    const totalTurns = allTurns.length;
    const latestTurn = totalTurns > 0 ? allTurns[totalTurns - 1] : null;
    const lastTurnCacheHitPct = latestTurn ? latestTurn.cacheHitPct : null;
    const lastTurnStartKind: TurnStartKind = latestTurn ? latestTurn.startKind : 'unknown';

    const sessionCacheHitPct = weightedInputSum > 0
        ? round1(Math.max(0, Math.min(100, (weightedCacheReadSum / weightedInputSum) * 100)))
        : null;

    const recentTurns = maxTurns === 0
        ? []
        : (allTurns.length > maxTurns ? allTurns.slice(allTurns.length - maxTurns) : allTurns);

    return {
        lastTurnCacheHitPct,
        sessionCacheHitPct,
        lastTurnStartKind,
        turns: recentTurns,
        totalTurns,
        coldCount,
        partialCount,
        warmCount,
        unknownCount,
        totalInputTokens,
        totalCacheReadTokens,
        totalOutputTokens,
        totalThinkingTokens,
    };
}

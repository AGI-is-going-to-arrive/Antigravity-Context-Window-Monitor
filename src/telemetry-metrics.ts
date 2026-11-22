// ─── Pure Telemetry Metrics Engine ───────────────────────────────────────────
// Single source of truth for generation speed (tok/s), TTFT, streaming duration,
// and prompt-cache efficiency metrics across Status Bar, Overview, GM Data, and Calendar.
//
// Zero VS Code or DOM dependencies — deterministic and cross-platform.
//
// Ground-truth Antigravity protobuf semantics:
//   - streamingSeconds strictly EXCLUDES ttftSeconds (decode phase only).
//   - cacheReadTokens and cacheCreationTokens are strictly ADDITIVE with inputTokens:
//       totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens
//   - thinkingTokens is strictly a SUBSET of outputTokens (NEVER sum output + thinking).
//   - Implicit thinking (e.g. Gemini Flash omitting thinkingOutputTokens while
//     outputTokens > responseTokens > 0) is handled via effectiveThinkingTokens and
//     visibleResponseTokens.

import type { GMCallEntry, GMModelStats, GMSummary } from './gm/types';
import { getContextLimit, getModelSpecs, normalizeModelDisplayName, resolveModelId } from './models';
import {
    findPricingForDate,
    findPricingWithCustom,
    getOrchestratorPricingMode,
    selectPricingModel,
    type ModelPricing,
    type OrchestratorPricingMode,
} from './pricing-store';

// ─── Noise & Validity Thresholds ─────────────────────────────────────────────

/** Hard lower bound on streaming duration (seconds) for valid decode speed. */
export const MIN_STREAM_SECONDS = 0.05;

/** Hard lower bound on output tokens for valid decode speed (excludes 1-token jitter). */
export const MIN_OUTPUT_TOKENS_FOR_SPEED = 2;

/** Representative lower bound on streaming duration (seconds) for median/min/max spread. */
export const REP_MIN_STREAM_SECONDS = 0.25;

/** Representative lower bound on output tokens for median/min/max spread. */
export const REP_MIN_OUTPUT_TOKENS = 10;

/** Sparse-sample speed guard minimum output tokens (below this -> Short sample / 短样本). */
export const SHORT_SAMPLE_MIN_OUTPUT_TOKENS = 16;

/** Sparse-sample speed guard minimum streaming duration in seconds (below this -> Short sample). */
export const SHORT_SAMPLE_MIN_STREAM_SECONDS = 0.3;

/** Standard long-context pricing tier threshold (200k prompt tokens). */
export const LONG_CONTEXT_TIER_THRESHOLD = 200_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export type CacheState = 'warm' | 'warming' | 'cold' | 'unknown';

export interface SpeedSampleInput {
    outputTokens?: number | null;
    streamingSeconds?: number | null;
    ttftSeconds?: number | null;
    /** True when a response is actively in-flight awaiting first token. */
    isStreaming?: boolean;
    /** Optional elapsed wait duration (seconds) while waiting for TTFT. */
    elapsedWaitSeconds?: number | null;
    /** Optional override for minimum output tokens before showing steady TPS (default 16). */
    minOutputTokens?: number;
    /** Optional override for minimum decode duration in seconds (default 0.3). */
    minStreamSeconds?: number;
}

export interface SpeedSampleEvaluation {
    /** True when output or duration is too short for a reliable steady TPS reading. */
    isShortSample: boolean;
    /** Display-safe reliable tok/s, or null when waiting TTFT, unmeasured, or suppressed as short sample. */
    displaySpeed: number | null;
    /** Raw unfiltered tok/s (outputTokens / streamingSeconds) when both > 0; useful for tooltips/drawers. */
    rawSpeed: number | null;
    /** True when awaiting first token (no decoded output/stream yet while in-flight or TTFT pending). */
    isWaitingTtft: boolean;
    /** Optional wait seconds when isWaitingTtft is true. */
    waitingSeconds?: number | null;
}

export interface ContextDualWatermarkInput {
    /** Current context tokens used. */
    contextUsed: number;
    /** Auto-compaction / platform truncation limit (e.g. 256k or 512k). Falls back to model lookup if omitted. */
    compactionLimit?: number | null;
    /** Model's physical / native context window (e.g. 1,048,576). Falls back to model spec lookup if omitted. */
    physicalContextWindow?: number | null;
    /** Optional model identifier used to look up physical window and compaction limit when omitted. */
    model?: string;
    /** Long-context pricing tier threshold (default 200,000 tokens). */
    longContextThreshold?: number;
}

export interface ContextDualWatermark {
    contextUsed: number;
    /** Auto-compaction / checkpointer ceiling (platform usable limit). */
    compactionLimit: number;
    /** Physical / native model context window (always >= compactionLimit when known). */
    physicalContextWindow: number;
    /** Percentage of auto-compaction limit currently used (0..100+). */
    compactionUsagePct: number;
    /** Percentage of physical context window currently used (0..100). */
    physicalUsagePct: number;
    /** Position (0..100%) of the auto-compaction ceiling along the physical window bar. */
    compactionMarkerPct: number;
    /** True when physicalContextWindow strictly exceeds compactionLimit. */
    hasDistinctPhysicalWindow: boolean;
    /** 200k long-context pricing tier boundary. */
    longContextThreshold: number;
    /** True when the 200k long-context pricing tier marker falls inside the window (> 200k). */
    showLongContextMarker: boolean;
    /** Position (0..100%) of the 200k marker relative to the compaction bar, or null if compactionLimit <= threshold. */
    longContextMarkerPctOfCompaction: number | null;
    /** Position (0..100%) of the 200k marker relative to the physical window bar, or null if physicalWindow <= threshold. */
    longContextMarkerPctOfPhysical: number | null;
    /** True when current contextUsed > 200,000 tokens. */
    exceedsLongContextTier: boolean;
    /** Remaining tokens until auto-compaction limit (clamped >= 0). */
    tokensUntilCompaction: number;
    /** Remaining tokens until 200k threshold (0 when exceeded; null when not applicable). */
    tokensUntilLongContextTier: number | null;
    /** Usage severity band relative to compaction limit. */
    severity: 'safe' | 'caution' | 'critical';
}

/** GMCallEntry with optional conversation cascadeId attached for session aggregation. */
export type TelemetryCallInput = GMCallEntry & { cascadeId?: string };

export interface CallTelemetryPoint {
    callId: string;
    cascadeId: string;
    model: string;
    createdAt: string;
    ttftSeconds: number | null;
    streamingSeconds: number | null;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    effectiveThinkingTokens: number;
    visibleResponseTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalPromptTokens: number;
    totalGenTokPerSec: number | null;
    visibleTokPerSec: number | null;
    endToEndTokPerSec: number | null;
    promptCacheHitRate: number | null;
    isCacheHit: boolean;
    cacheState: CacheState;
    estCacheSavingsUsd: number | null;
    /** Sparse-sample speed guard evaluation for this call. */
    speedSample?: SpeedSampleEvaluation;
}

export interface TelemetryAggregate {
    // Throughput
    weightedGenTokPerSec: number | null;
    medianGenTokPerSec: number | null;
    minGenTokPerSec: number | null;
    maxGenTokPerSec: number | null;
    weightedVisibleTokPerSec: number | null;
    weightedEndToEndTokPerSec: number | null;
    latestGenTokPerSec: number | null;
    latestVisibleTokPerSec: number | null;
    speedSampleCount: number;
    representativeSpeedSampleCount: number;
    hasThinking: boolean;

    // TTFT
    avgTtftSeconds: number | null;
    medianTtftSeconds: number | null;
    p95TtftSeconds: number | null;
    minTtftSeconds: number | null;
    maxTtftSeconds: number | null;
    latestTtftSeconds: number | null;
    ttftSampleCount: number;
    cachedAvgTtftSeconds: number | null;
    uncachedAvgTtftSeconds: number | null;
    cachedTtftCount: number;
    uncachedTtftCount: number;
    ttftCacheDeltaPct: number | null;

    // Streaming
    avgStreamingSeconds: number | null;
    streamingSampleCount: number;

    // Prompt Cache
    totalPromptTokens: number;
    totalFreshInputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    tokenCacheHitRate: number | null;
    callCacheHitRate: number | null;
    cacheReuseRate: number | null;
    cachedCallCount: number;
    totalCalls: number;
    latestCacheState: CacheState;
    estCacheSavedTokens: number;
    estCacheSavingsUsd: number | null;

    // Snapshots
    latestCall: CallTelemetryPoint | null;
    latestTimedCall: CallTelemetryPoint | null;
    /** Sparse-sample speed guard evaluation for the latest call. */
    latestSpeedSample?: SpeedSampleEvaluation | null;
}

export interface SessionTelemetrySummary {
    overall: TelemetryAggregate;
    active: TelemetryAggregate | null;
    primary: TelemetryAggregate;
    byModel: Record<string, TelemetryAggregate>;
    primaryScope: 'active' | 'session';
}

export interface TelemetrySummaryOptions {
    activeCascadeId?: string;
    customPricing?: Record<string, ModelPricing>;
    orchestratorPricingMode?: OrchestratorPricingMode;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function safeNonNeg(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function positiveOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) { return 0; }
    if (value <= 0) { return 0; }
    if (value >= 1) { return 1; }
    return value;
}

function parseValidTimestamp(iso: string | undefined): number | null {
    if (!iso) { return null; }
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}

/** Linear-interpolated quantile (R-7) over an ascending sorted non-empty array. */
function percentile(sortedAsc: readonly number[], p: number): number | null {
    const n = sortedAsc.length;
    if (n === 0) { return null; }
    if (n === 1) { return sortedAsc[0]; }
    const idx = (n - 1) * clamp01(p);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) { return sortedAsc[lo]; }
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function arithmeticMean(values: readonly number[]): number | null {
    if (values.length === 0) { return null; }
    let sum = 0;
    for (const v of values) { sum += v; }
    return sum / values.length;
}

function classifyCacheState(
    cacheReadTokens: number,
    cacheCreationTokens: number,
    totalPromptTokens: number,
): CacheState {
    if (cacheReadTokens > 0) { return 'warm'; }
    if (cacheCreationTokens > 0) { return 'warming'; }
    if (totalPromptTokens > 0) { return 'cold'; }
    return 'unknown';
}

function isHardValidSpeedSample(outputTokens: number, streamingSeconds: number | null): boolean {
    return streamingSeconds !== null
        && streamingSeconds >= MIN_STREAM_SECONDS
        && outputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED;
}

function isRepresentativeSpeedSample(outputTokens: number, streamingSeconds: number | null): boolean {
    return streamingSeconds !== null
        && streamingSeconds >= REP_MIN_STREAM_SECONDS
        && outputTokens >= REP_MIN_OUTPUT_TOKENS;
}

function resolveModelLabel(call: Pick<GMCallEntry, 'modelDisplay' | 'model' | 'responseModel'>): string {
    const raw = call.modelDisplay || call.model || call.responseModel || '';
    return (normalizeModelDisplayName(raw) || raw).trim();
}

function resolvePricingForCall(
    call: Pick<GMCallEntry, 'model' | 'modelDisplay' | 'responseModel' | 'createdAt'>,
    customPricing?: Record<string, ModelPricing>,
    orchestratorPricingMode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): ModelPricing | null {
    const custom = customPricing || {};
    const fallback = selectPricingModel(call.modelDisplay || '', call.responseModel || '', custom);
    const pricingModel = selectPricingModel(call.model || '', fallback, custom);
    if (!pricingModel) { return null; }
    if (call.createdAt) {
        const dated = findPricingForDate(pricingModel, custom, call.createdAt, undefined, orchestratorPricingMode);
        if (dated) { return dated; }
    }
    return findPricingWithCustom(pricingModel, custom, undefined, orchestratorPricingMode);
}

function resolvePricingForModelKey(
    modelKey: string,
    responseModel: string,
    customPricing?: Record<string, ModelPricing>,
    orchestratorPricingMode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): ModelPricing | null {
    const custom = customPricing || {};
    const pricingModel = selectPricingModel(modelKey, responseModel, custom);
    if (!pricingModel) { return null; }
    return findPricingWithCustom(pricingModel, custom, undefined, orchestratorPricingMode);
}

// ─── Sparse-Sample Speed Guard & Dual Watermark ──────────────────────────────

/**
 * Evaluate a decode throughput sample with sparse-sample micro-burst suppression.
 * Prevents noisy TPS spikes on tiny bursts (e.g. 4 tokens in 15ms) while keeping
 * `rawSpeed` available for tooltips/detail drawers and exposing explicit TTFT waiting state.
 */
export function evaluateSpeedSample(input: SpeedSampleInput): SpeedSampleEvaluation {
    const out = safeNonNeg(input.outputTokens);
    const stream = positiveOrNull(input.streamingSeconds);
    const ttft = positiveOrNull(input.ttftSeconds);
    const elapsedWait = positiveOrNull(input.elapsedWaitSeconds);

    const minOut = typeof input.minOutputTokens === 'number' && Number.isFinite(input.minOutputTokens) && input.minOutputTokens > 0
        ? Math.max(MIN_OUTPUT_TOKENS_FOR_SPEED, input.minOutputTokens)
        : SHORT_SAMPLE_MIN_OUTPUT_TOKENS;
    const minStream = typeof input.minStreamSeconds === 'number' && Number.isFinite(input.minStreamSeconds) && input.minStreamSeconds > 0
        ? Math.max(MIN_STREAM_SECONDS, input.minStreamSeconds)
        : SHORT_SAMPLE_MIN_STREAM_SECONDS;

    // Waiting for first token: no output tokens / decode duration yet, but request is streaming or TTFT pending.
    if (out === 0 && stream === null) {
        if (input.isStreaming === true || elapsedWait !== null || ttft !== null) {
            return {
                isShortSample: false,
                displaySpeed: null,
                rawSpeed: null,
                isWaitingTtft: true,
                waitingSeconds: elapsedWait ?? ttft ?? null,
            };
        }
        return {
            isShortSample: false,
            displaySpeed: null,
            rawSpeed: null,
            isWaitingTtft: false,
        };
    }

    // Output arrived with no recorded positive stream duration (or positive stream with 0 output).
    if (out <= 0 || stream === null) {
        if (input.isStreaming === true && out === 0) {
            return {
                isShortSample: false,
                displaySpeed: null,
                rawSpeed: null,
                isWaitingTtft: true,
                waitingSeconds: elapsedWait ?? ttft ?? null,
            };
        }
        return {
            isShortSample: false,
            displaySpeed: null,
            rawSpeed: null,
            isWaitingTtft: false,
        };
    }

    const rawSpeed = out / stream;
    if (!Number.isFinite(rawSpeed) || rawSpeed <= 0) {
        return {
            isShortSample: false,
            displaySpeed: null,
            rawSpeed: null,
            isWaitingTtft: false,
        };
    }

    if (out < minOut || stream < minStream) {
        return {
            isShortSample: true,
            displaySpeed: null,
            rawSpeed,
            isWaitingTtft: false,
        };
    }

    return {
        isShortSample: false,
        displaySpeed: rawSpeed,
        rawSpeed,
        isWaitingTtft: false,
    };
}

/**
 * Compute dual-watermark context metadata comparing platform auto-compaction ceiling
 * against physical model context window, plus the 200k long-context pricing tier marker.
 */
export function computeContextWatermarks(input: ContextDualWatermarkInput): ContextDualWatermark {
    const contextUsed = safeNonNeg(input.contextUsed);
    const threshold = typeof input.longContextThreshold === 'number'
        && Number.isFinite(input.longContextThreshold)
        && input.longContextThreshold > 0
        ? input.longContextThreshold
        : LONG_CONTEXT_TIER_THRESHOLD;

    let specMaxTokens = 0;
    let specCpLimit = 0;
    if (input.model && input.model.trim()) {
        const resolved = resolveModelId(input.model) || input.model.trim();
        const spec = getModelSpecs().find(s => s.placeholderId === resolved || s.modelId === resolved);
        if (spec) {
            specMaxTokens = safeNonNeg(spec.maxTokens);
            specCpLimit = safeNonNeg(spec.cpLimit);
        }
        if (specCpLimit <= 0) {
            specCpLimit = safeNonNeg(getContextLimit(input.model));
        }
    }

    const explicitCompaction = positiveOrNull(input.compactionLimit);
    const explicitPhysical = positiveOrNull(input.physicalContextWindow);

    const compactionLimit = explicitCompaction ?? (specCpLimit > 0 ? specCpLimit : (explicitPhysical ?? specMaxTokens));
    const rawPhysical = explicitPhysical ?? (specMaxTokens > 0 ? specMaxTokens : compactionLimit);
    const physicalContextWindow = Math.max(compactionLimit, rawPhysical);

    const compactionUsagePct = compactionLimit > 0 ? (contextUsed / compactionLimit) * 100 : 0;
    const physicalUsagePct = physicalContextWindow > 0
        ? Math.min(100, (contextUsed / physicalContextWindow) * 100)
        : 0;
    const compactionMarkerPct = physicalContextWindow > 0 && compactionLimit > 0
        ? Math.min(100, (compactionLimit / physicalContextWindow) * 100)
        : 100;
    const hasDistinctPhysicalWindow = physicalContextWindow > compactionLimit && compactionLimit > 0;

    const longContextMarkerPctOfCompaction = compactionLimit > threshold
        ? (threshold / compactionLimit) * 100
        : null;
    const longContextMarkerPctOfPhysical = physicalContextWindow > threshold
        ? (threshold / physicalContextWindow) * 100
        : null;
    const showLongContextMarker = longContextMarkerPctOfCompaction !== null || longContextMarkerPctOfPhysical !== null;
    const exceedsLongContextTier = contextUsed > threshold;

    const tokensUntilCompaction = compactionLimit > 0 ? Math.max(0, compactionLimit - contextUsed) : 0;
    const tokensUntilLongContextTier = showLongContextMarker
        ? Math.max(0, threshold - contextUsed)
        : null;

    const severity: 'safe' | 'caution' | 'critical' = compactionUsagePct >= 80
        ? 'critical'
        : compactionUsagePct >= 50
            ? 'caution'
            : 'safe';

    return {
        contextUsed,
        compactionLimit,
        physicalContextWindow,
        compactionUsagePct,
        physicalUsagePct,
        compactionMarkerPct,
        hasDistinctPhysicalWindow,
        longContextThreshold: threshold,
        showLongContextMarker,
        longContextMarkerPctOfCompaction,
        longContextMarkerPctOfPhysical,
        exceedsLongContextTier,
        tokensUntilCompaction,
        tokensUntilLongContextTier,
        severity,
    };
}

/**
 * Conservative detector for internal compaction/checkpoint-summarization calls.
 * Only triggers on unambiguous internal metadata markers so normal chat calls
 * (including chats discussing compaction or conversations containing checkpoints)
 * are never excluded.
 */
export function isInternalCompactionCall(call: GMCallEntry): boolean {
    const execId = (call.executionId || '').trim();
    if (execId && /^(?:compaction|checkpoint[-_]?summary|summary[-_]?compaction|summarize[-_]?conversation)(?:[-_:]|$)/i.test(execId)) {
        return true;
    }

    const toolCount = safeNonNeg(call.toolCount);
    const hasUserAnchors = Array.isArray(call.userMessageAnchors) && call.userMessageAnchors.length > 0;
    if (toolCount > 0 || hasUserAnchors) {
        return false;
    }

    const titles = Array.isArray(call.promptSectionTitles) ? call.promptSectionTitles : [];
    if (titles.length > 0 && titles.every(t => /^(?:compaction|conversation[ _-]?compaction|checkpoint[ _-]?summary|history[ _-]?summary)$/i.test((t || '').trim()))) {
        return true;
    }

    const sysPrompt = (call.systemPromptSnippet || '').trim();
    if (sysPrompt && /^(?:you are (?:an? )?(?:conversation |context |checkpoint )?(?:compaction|summarizer|summary) (?:assistant|agent|model)|summarize (?:this|the) (?:preceding |following )?conversation (?:into|for) (?:a )?(?:concise )?(?:checkpoint|compaction))/i.test(sysPrompt)) {
        return true;
    }

    return false;
}

/** Create an empty TelemetryAggregate with null ratios/timings and zero counters. */
export function createEmptyTelemetryAggregate(): TelemetryAggregate {
    return {
        weightedGenTokPerSec: null,
        medianGenTokPerSec: null,
        minGenTokPerSec: null,
        maxGenTokPerSec: null,
        weightedVisibleTokPerSec: null,
        weightedEndToEndTokPerSec: null,
        latestGenTokPerSec: null,
        latestVisibleTokPerSec: null,
        speedSampleCount: 0,
        representativeSpeedSampleCount: 0,
        hasThinking: false,

        avgTtftSeconds: null,
        medianTtftSeconds: null,
        p95TtftSeconds: null,
        minTtftSeconds: null,
        maxTtftSeconds: null,
        latestTtftSeconds: null,
        ttftSampleCount: 0,
        cachedAvgTtftSeconds: null,
        uncachedAvgTtftSeconds: null,
        cachedTtftCount: 0,
        uncachedTtftCount: 0,
        ttftCacheDeltaPct: null,

        avgStreamingSeconds: null,
        streamingSampleCount: 0,

        totalPromptTokens: 0,
        totalFreshInputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        tokenCacheHitRate: null,
        callCacheHitRate: null,
        cacheReuseRate: null,
        cachedCallCount: 0,
        totalCalls: 0,
        latestCacheState: 'unknown',
        estCacheSavedTokens: 0,
        estCacheSavingsUsd: null,

        latestCall: null,
        latestTimedCall: null,
        latestSpeedSample: null,
    };
}

interface OrderedPoint {
    point: CallTelemetryPoint;
    ts: number | null;
    order: number;
}

/** Pick the chronologically latest entry (prefer valid timestamps; tie-break by order). */
function pickLatest(entries: readonly OrderedPoint[]): CallTelemetryPoint | null {
    if (entries.length === 0) { return null; }
    let best = entries[0];
    for (let i = 1; i < entries.length; i++) {
        const cur = entries[i];
        if (cur.ts !== null && best.ts !== null) {
            if (cur.ts > best.ts || (cur.ts === best.ts && cur.order > best.order)) {
                best = cur;
            }
        } else if (cur.ts !== null && best.ts === null) {
            best = cur;
        } else if (cur.ts === null && best.ts === null && cur.order > best.order) {
            best = cur;
        }
    }
    return best.point;
}

// ─── Core Telemetry Computation ──────────────────────────────────────────────

/**
 * Compute normalized per-call telemetry point from a single GMCallEntry.
 */
export function computeCallTelemetry(
    call: TelemetryCallInput,
    customPricing?: Record<string, ModelPricing>,
    cascadeIdOverride?: string,
    orchestratorPricingMode?: OrchestratorPricingMode,
): CallTelemetryPoint {
    const cascadeId = cascadeIdOverride ?? call.cascadeId ?? '';
    const model = resolveModelLabel(call);
    const createdAt = call.createdAt || '';
    const callId = call.executionId
        || (Array.isArray(call.stepIndices) && call.stepIndices.length > 0
            ? `${cascadeId || 'call'}:${call.stepIndices.join(',')}`
            : `${cascadeId || 'call'}:${createdAt || model || 'unknown'}`);

    const ttftSeconds = positiveOrNull(call.ttftSeconds);
    const streamingSeconds = positiveOrNull(call.streamingSeconds);

    const inputTokens = safeNonNeg(call.inputTokens);
    const outputTokens = safeNonNeg(call.outputTokens);
    const thinkingTokens = safeNonNeg(call.thinkingTokens);
    const responseTokens = safeNonNeg(call.responseTokens);
    const cacheReadTokens = safeNonNeg(call.cacheReadTokens);
    const cacheCreationTokens = safeNonNeg(call.cacheCreationTokens);

    // Thinking tokens are strictly a subset of outputTokens; handle implicit thinking
    // (e.g., Gemini Flash omitting thinkingOutputTokens while outputTokens > responseTokens).
    const visibleResponseTokens = responseTokens > 0
        ? Math.min(outputTokens, responseTokens)
        : Math.max(0, outputTokens - thinkingTokens);
    const effectiveThinkingTokens = thinkingTokens > 0
        ? thinkingTokens
        : (responseTokens > 0 && outputTokens > responseTokens ? outputTokens - responseTokens : 0);

    // Antigravity additive prompt cache semantics
    const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
    const promptCacheHitRate = totalPromptTokens > 0
        ? clamp01(cacheReadTokens / totalPromptTokens)
        : null;
    const isCacheHit = cacheReadTokens > 0;
    const cacheState = classifyCacheState(cacheReadTokens, cacheCreationTokens, totalPromptTokens);

    // Speed metrics (decode strictly excludes TTFT; 1-token / sub-50ms noise rejected)
    const speedValid = isHardValidSpeedSample(outputTokens, streamingSeconds);
    const totalGenTokPerSec = speedValid
        ? outputTokens / streamingSeconds!
        : null;
    const visibleTokPerSec = (speedValid && visibleResponseTokens > 0)
        ? visibleResponseTokens / streamingSeconds!
        : null;
    const endToEndTokPerSec = (speedValid && ttftSeconds !== null)
        ? outputTokens / (ttftSeconds + streamingSeconds!)
        : null;

    const speedSample = evaluateSpeedSample({
        outputTokens,
        streamingSeconds,
        ttftSeconds,
    });

    // Cache read savings in USD — null when unpriced or no cache read (never fake $0.00)
    let estCacheSavingsUsd: number | null = null;
    if (cacheReadTokens > 0) {
        const pricing = resolvePricingForCall(call, customPricing, orchestratorPricingMode);
        if (pricing) {
            const rateDiff = Math.max(0, pricing.input - pricing.cacheRead);
            estCacheSavingsUsd = (cacheReadTokens * rateDiff) / 1_000_000;
        }
    }

    return {
        callId,
        cascadeId,
        model,
        createdAt,
        ttftSeconds,
        streamingSeconds,
        inputTokens,
        outputTokens,
        thinkingTokens,
        effectiveThinkingTokens,
        visibleResponseTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalPromptTokens,
        totalGenTokPerSec,
        visibleTokPerSec,
        endToEndTokPerSec,
        promptCacheHitRate,
        isCacheHit,
        cacheState,
        estCacheSavingsUsd,
        speedSample,
    };
}

/**
 * Fallback telemetry aggregate from GMModelStats when per-call `calls[]` is empty/archived.
 * Preserves accurate weighted averages and token-weighted cache rates without fabricating
 * percentiles, latest snapshots, or unpriced USD savings.
 */
export function computeTelemetryAggregateFromModelStats(
    modelStats: Record<string, GMModelStats> | readonly (GMModelStats & { modelName?: string })[],
    customPricing?: Record<string, ModelPricing>,
    orchestratorPricingMode?: OrchestratorPricingMode,
): TelemetryAggregate {
    const entries: Array<[string, GMModelStats]> = Array.isArray(modelStats)
        ? modelStats.map((ms, idx) => [ms.modelName || ms.responseModel || `model_${idx}`, ms])
        : Object.entries(modelStats);

    if (entries.length === 0) {
        return createEmptyTelemetryAggregate();
    }

    let totalCalls = 0;
    let cachedCallCount = 0;
    let totalFreshInputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let hasThinking = false;

    let speedOutputSum = 0;
    let speedVisibleSum = 0;
    let speedStreamSum = 0;
    let speedSampleCount = 0;

    let ttftWeightedSum = 0;
    let ttftSampleCount = 0;
    let minTtft: number | null = null;
    let maxTtft: number | null = null;

    let streamWeightedSum = 0;
    let streamingSampleCount = 0;

    let savingsUsdSum = 0;
    let pricedCacheReadModels = 0;

    for (const [modelKey, ms] of entries) {
        const calls = safeNonNeg(ms.callCount);
        const input = safeNonNeg(ms.totalInputTokens);
        const output = safeNonNeg(ms.totalOutputTokens);
        const thinking = safeNonNeg(ms.totalThinkingTokens);
        const cacheRead = safeNonNeg(ms.totalCacheRead);
        const cacheCreation = safeNonNeg(ms.totalCacheCreation);

        totalCalls += calls;
        totalFreshInputTokens += input;
        totalCacheReadTokens += cacheRead;
        totalCacheCreationTokens += cacheCreation;
        if (thinking > 0) { hasThinking = true; }

        const hits = ms.cacheHitCalls !== undefined
            ? safeNonNeg(ms.cacheHitCalls)
            : (calls > 0 ? Math.round(clamp01(ms.cacheHitRate || 0) * calls) : 0);
        cachedCallCount += Math.min(calls, hits);

        // TTFT
        const avgTtft = positiveOrNull(ms.avgTTFT);
        if (avgTtft !== null) {
            const count = ms.ttftSampleCount !== undefined ? safeNonNeg(ms.ttftSampleCount) : calls;
            if (count > 0) {
                ttftWeightedSum += avgTtft * count;
                ttftSampleCount += count;
            }
        }
        const mMin = positiveOrNull(ms.minTTFT);
        if (mMin !== null) {
            minTtft = minTtft === null ? mMin : Math.min(minTtft, mMin);
        }
        const mMax = positiveOrNull(ms.maxTTFT);
        if (mMax !== null) {
            maxTtft = maxTtft === null ? mMax : Math.max(maxTtft, mMax);
        }

        // Streaming
        const avgStream = positiveOrNull(ms.avgStreaming);
        if (avgStream !== null) {
            const count = ms.streamingSampleCount !== undefined ? safeNonNeg(ms.streamingSampleCount) : calls;
            if (count > 0) {
                streamWeightedSum += avgStream * count;
                streamingSampleCount += count;
            }
        }

        // Throughput (prefer explicit speed-valid sums; fallback to legacy avgStreaming)
        const timedOut = safeNonNeg(ms.timedOutputTokens);
        const timedStream = safeNonNeg(ms.timedStreamingSeconds);
        if (timedOut >= MIN_OUTPUT_TOKENS_FOR_SPEED && timedStream >= MIN_STREAM_SECONDS) {
            speedOutputSum += timedOut;
            const visibleRatio = output > 0 ? Math.max(0, output - thinking) / output : 1;
            speedVisibleSum += timedOut * visibleRatio;
            speedStreamSum += timedStream;
            const samples = ms.streamingSampleCount !== undefined ? safeNonNeg(ms.streamingSampleCount) : calls;
            speedSampleCount += Math.max(1, samples);
        } else if (ms.timedOutputTokens === undefined && ms.timedStreamingSeconds === undefined
            && avgStream !== null && avgStream >= MIN_STREAM_SECONDS
            && output >= MIN_OUTPUT_TOKENS_FOR_SPEED && calls > 0) {
            const count = ms.streamingSampleCount !== undefined ? safeNonNeg(ms.streamingSampleCount) : calls;
            const estTotalStream = avgStream * count;
            if (count > 0 && estTotalStream >= MIN_STREAM_SECONDS) {
                speedOutputSum += output;
                speedVisibleSum += Math.max(0, output - thinking);
                speedStreamSum += estTotalStream;
                speedSampleCount += count;
            }
        }

        // Cache USD savings
        if (cacheRead > 0) {
            const pricing = resolvePricingForModelKey(modelKey, ms.responseModel || '', customPricing, orchestratorPricingMode);
            if (pricing) {
                const rateDiff = Math.max(0, pricing.input - pricing.cacheRead);
                savingsUsdSum += (cacheRead * rateDiff) / 1_000_000;
                pricedCacheReadModels++;
            }
        }
    }

    const totalPromptTokens = totalFreshInputTokens + totalCacheReadTokens + totalCacheCreationTokens;
    const cacheReuseDenom = totalCacheReadTokens + totalCacheCreationTokens;

    const weightedGenTokPerSec = speedStreamSum >= MIN_STREAM_SECONDS && speedOutputSum >= MIN_OUTPUT_TOKENS_FOR_SPEED
        ? speedOutputSum / speedStreamSum
        : null;
    const weightedVisibleTokPerSec = weightedGenTokPerSec !== null && speedVisibleSum > 0
        ? speedVisibleSum / speedStreamSum
        : null;

    return {
        weightedGenTokPerSec,
        medianGenTokPerSec: null,
        minGenTokPerSec: null,
        maxGenTokPerSec: null,
        weightedVisibleTokPerSec,
        weightedEndToEndTokPerSec: null,
        latestGenTokPerSec: null,
        latestVisibleTokPerSec: null,
        speedSampleCount,
        representativeSpeedSampleCount: 0,
        hasThinking,

        avgTtftSeconds: ttftSampleCount > 0 ? ttftWeightedSum / ttftSampleCount : null,
        medianTtftSeconds: null,
        p95TtftSeconds: null,
        minTtftSeconds: minTtft,
        maxTtftSeconds: maxTtft,
        latestTtftSeconds: null,
        ttftSampleCount,
        cachedAvgTtftSeconds: null,
        uncachedAvgTtftSeconds: null,
        cachedTtftCount: 0,
        uncachedTtftCount: 0,
        ttftCacheDeltaPct: null,

        avgStreamingSeconds: streamingSampleCount > 0 ? streamWeightedSum / streamingSampleCount : null,
        streamingSampleCount,

        totalPromptTokens,
        totalFreshInputTokens,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        tokenCacheHitRate: totalPromptTokens > 0 ? clamp01(totalCacheReadTokens / totalPromptTokens) : null,
        callCacheHitRate: totalCalls > 0 ? clamp01(cachedCallCount / totalCalls) : null,
        cacheReuseRate: cacheReuseDenom > 0 ? clamp01(totalCacheReadTokens / cacheReuseDenom) : null,
        cachedCallCount,
        totalCalls,
        latestCacheState: classifyCacheState(totalCacheReadTokens, totalCacheCreationTokens, totalPromptTokens),
        estCacheSavedTokens: totalCacheReadTokens,
        estCacheSavingsUsd: pricedCacheReadModels > 0 ? savingsUsdSum : null,

        latestCall: null,
        latestTimedCall: null,
        latestSpeedSample: null,
    };
}

/**
 * Aggregate telemetry across a list of GM calls.
 * When `calls` is empty (e.g. archived or slimmed summary without per-call arrays),
 * seamlessly falls back to `fallbackModelStats` if provided.
 */
export function computeTelemetryAggregate(
    calls: readonly TelemetryCallInput[],
    customPricing?: Record<string, ModelPricing>,
    fallbackModelStats?: Record<string, GMModelStats> | readonly (GMModelStats & { modelName?: string })[],
    orchestratorPricingMode?: OrchestratorPricingMode,
): TelemetryAggregate {
    const filteredCalls = calls.filter(c => !isInternalCompactionCall(c));

    if (filteredCalls.length === 0) {
        if (fallbackModelStats) {
            const hasFallback = Array.isArray(fallbackModelStats)
                ? fallbackModelStats.length > 0
                : Object.keys(fallbackModelStats).length > 0;
            if (hasFallback) {
                return computeTelemetryAggregateFromModelStats(fallbackModelStats, customPricing, orchestratorPricingMode);
            }
        }
        return createEmptyTelemetryAggregate();
    }

    const orderedPoints: OrderedPoint[] = [];
    const hardValidSpeedPoints: OrderedPoint[] = [];
    const repSpeedPoints: CallTelemetryPoint[] = [];
    const ttftOrderedPoints: OrderedPoint[] = [];
    const timedOrderedPoints: OrderedPoint[] = [];

    const ttftValues: number[] = [];
    const cachedTtftValues: number[] = [];
    const uncachedTtftValues: number[] = [];
    const streamValues: number[] = [];

    let validOutputSum = 0;
    let validVisibleSum = 0;
    let validStreamSum = 0;
    let e2eOutputSum = 0;
    let e2eDurationSum = 0;
    let hasThinking = false;

    let totalFreshInputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let cachedCallCount = 0;
    let savingsUsdSum = 0;
    let pricedCacheReadCalls = 0;

    for (let i = 0; i < filteredCalls.length; i++) {
        const call = filteredCalls[i];
        const point = computeCallTelemetry(call, customPricing, undefined, orchestratorPricingMode);
        const ordered: OrderedPoint = {
            point,
            ts: parseValidTimestamp(point.createdAt),
            order: i,
        };
        orderedPoints.push(ordered);

        totalFreshInputTokens += point.inputTokens;
        totalCacheReadTokens += point.cacheReadTokens;
        totalCacheCreationTokens += point.cacheCreationTokens;
        if (point.isCacheHit) { cachedCallCount++; }
        if (point.effectiveThinkingTokens > 0) { hasThinking = true; }
        if (point.estCacheSavingsUsd !== null) {
            savingsUsdSum += point.estCacheSavingsUsd;
            pricedCacheReadCalls++;
        }

        if (point.ttftSeconds !== null) {
            ttftValues.push(point.ttftSeconds);
            ttftOrderedPoints.push(ordered);
            if (point.isCacheHit) {
                cachedTtftValues.push(point.ttftSeconds);
            } else {
                uncachedTtftValues.push(point.ttftSeconds);
            }
        }

        if (point.streamingSeconds !== null) {
            streamValues.push(point.streamingSeconds);
        }

        if (point.ttftSeconds !== null || point.streamingSeconds !== null) {
            timedOrderedPoints.push(ordered);
        }

        if (point.totalGenTokPerSec !== null && point.streamingSeconds !== null) {
            hardValidSpeedPoints.push(ordered);
            validOutputSum += point.outputTokens;
            validVisibleSum += point.visibleResponseTokens;
            validStreamSum += point.streamingSeconds;

            if (point.ttftSeconds !== null) {
                e2eOutputSum += point.outputTokens;
                e2eDurationSum += point.ttftSeconds + point.streamingSeconds;
            }

            if (isRepresentativeSpeedSample(point.outputTokens, point.streamingSeconds)) {
                repSpeedPoints.push(point);
            }
        }
    }

    // Spread source: prefer representative calls, fall back to hard-valid set
    const spreadSource = repSpeedPoints.length > 0
        ? repSpeedPoints
        : hardValidSpeedPoints.map(o => o.point);
    const sortedSpeeds = spreadSource
        .map(p => p.totalGenTokPerSec!)
        .sort((a, b) => a - b);

    const sortedTtfts = [...ttftValues].sort((a, b) => a - b);
    const cachedAvgTtftSeconds = arithmeticMean(cachedTtftValues);
    const uncachedAvgTtftSeconds = arithmeticMean(uncachedTtftValues);
    const ttftCacheDeltaPct = (cachedAvgTtftSeconds !== null && uncachedAvgTtftSeconds !== null && uncachedAvgTtftSeconds > 0)
        ? ((cachedAvgTtftSeconds - uncachedAvgTtftSeconds) / uncachedAvgTtftSeconds) * 100
        : null;

    const latestCall = pickLatest(orderedPoints);
    const latestSpeedCall = pickLatest(hardValidSpeedPoints);
    const latestTtftCall = pickLatest(ttftOrderedPoints);
    const latestTimedCall = latestSpeedCall || pickLatest(timedOrderedPoints);

    const totalCalls = orderedPoints.length;
    const totalPromptTokens = totalFreshInputTokens + totalCacheReadTokens + totalCacheCreationTokens;
    const cacheReuseDenom = totalCacheReadTokens + totalCacheCreationTokens;

    const weightedGenTokPerSec = validStreamSum > 0 ? validOutputSum / validStreamSum : null;
    const weightedVisibleTokPerSec = (validStreamSum > 0 && validVisibleSum > 0)
        ? validVisibleSum / validStreamSum
        : null;
    const weightedEndToEndTokPerSec = e2eDurationSum > 0 ? e2eOutputSum / e2eDurationSum : null;

    return {
        weightedGenTokPerSec,
        medianGenTokPerSec: percentile(sortedSpeeds, 0.5),
        minGenTokPerSec: sortedSpeeds.length > 0 ? sortedSpeeds[0] : null,
        maxGenTokPerSec: sortedSpeeds.length > 0 ? sortedSpeeds[sortedSpeeds.length - 1] : null,
        weightedVisibleTokPerSec,
        weightedEndToEndTokPerSec,
        latestGenTokPerSec: latestSpeedCall?.totalGenTokPerSec ?? null,
        latestVisibleTokPerSec: latestSpeedCall?.visibleTokPerSec ?? null,
        speedSampleCount: hardValidSpeedPoints.length,
        representativeSpeedSampleCount: repSpeedPoints.length,
        hasThinking,

        avgTtftSeconds: arithmeticMean(ttftValues),
        medianTtftSeconds: percentile(sortedTtfts, 0.5),
        p95TtftSeconds: percentile(sortedTtfts, 0.95),
        minTtftSeconds: sortedTtfts.length > 0 ? sortedTtfts[0] : null,
        maxTtftSeconds: sortedTtfts.length > 0 ? sortedTtfts[sortedTtfts.length - 1] : null,
        latestTtftSeconds: latestTtftCall?.ttftSeconds ?? null,
        ttftSampleCount: ttftValues.length,
        cachedAvgTtftSeconds,
        uncachedAvgTtftSeconds,
        cachedTtftCount: cachedTtftValues.length,
        uncachedTtftCount: uncachedTtftValues.length,
        ttftCacheDeltaPct,

        avgStreamingSeconds: arithmeticMean(streamValues),
        streamingSampleCount: streamValues.length,

        totalPromptTokens,
        totalFreshInputTokens,
        totalCacheReadTokens,
        totalCacheCreationTokens,
        tokenCacheHitRate: totalPromptTokens > 0 ? clamp01(totalCacheReadTokens / totalPromptTokens) : null,
        callCacheHitRate: totalCalls > 0 ? clamp01(cachedCallCount / totalCalls) : null,
        cacheReuseRate: cacheReuseDenom > 0 ? clamp01(totalCacheReadTokens / cacheReuseDenom) : null,
        cachedCallCount,
        totalCalls,
        latestCacheState: latestCall?.cacheState ?? 'unknown',
        estCacheSavedTokens: totalCacheReadTokens,
        estCacheSavingsUsd: pricedCacheReadCalls > 0 ? savingsUsdSum : null,

        latestCall,
        latestTimedCall,
        latestSpeedSample: latestCall?.speedSample ?? latestTimedCall?.speedSample ?? null,
    };
}

/**
 * Compute full session telemetry summary (overall, active conversation, primary scope, and per-model breakdown).
 */
export function computeTelemetrySummary(
    gmSummary: GMSummary | null | undefined,
    opts?: TelemetrySummaryOptions,
): SessionTelemetrySummary {
    if (!gmSummary) {
        const empty = createEmptyTelemetryAggregate();
        return {
            overall: empty,
            active: null,
            primary: empty,
            byModel: {},
            primaryScope: 'session',
        };
    }

    const customPricing = opts?.customPricing;
    const activeCascadeId = opts?.activeCascadeId;
    const orchestratorPricingMode = opts?.orchestratorPricingMode;
    const conversations = Array.isArray(gmSummary.conversations) ? gmSummary.conversations : [];
    const modelBreakdown = gmSummary.modelBreakdown || {};

    const allCalls: TelemetryCallInput[] = [];
    const activeCalls: TelemetryCallInput[] = [];
    const callsByModel = new Map<string, TelemetryCallInput[]>();

    for (const conv of conversations) {
        const convCalls = Array.isArray(conv.calls) ? conv.calls : [];
        const isActiveConv = !!activeCascadeId && conv.cascadeId === activeCascadeId;
        for (const call of convCalls) {
            const tagged: TelemetryCallInput = { ...call, cascadeId: conv.cascadeId };
            allCalls.push(tagged);
            if (isActiveConv) {
                activeCalls.push(tagged);
            }
            const modelKey = resolveModelLabel(call);
            if (modelKey) {
                let list = callsByModel.get(modelKey);
                if (!list) {
                    list = [];
                    callsByModel.set(modelKey, list);
                }
                list.push(tagged);
            }
        }
    }

    const overall = computeTelemetryAggregate(allCalls, customPricing, modelBreakdown, orchestratorPricingMode);

    let active: TelemetryAggregate | null = null;
    if (activeCascadeId && activeCalls.length > 0) {
        const computedActive = computeTelemetryAggregate(activeCalls, customPricing, undefined, orchestratorPricingMode);
        if (computedActive.totalCalls > 0) {
            active = computedActive;
        }
    }

    const byModel: Record<string, TelemetryAggregate> = {};
    for (const [modelKey, modelCalls] of callsByModel) {
        const agg = computeTelemetryAggregate(modelCalls, customPricing, undefined, orchestratorPricingMode);
        if (agg.totalCalls > 0) {
            byModel[modelKey] = agg;
        }
    }
    // Backfill any models present in modelBreakdown without hydrated per-call arrays
    for (const [rawKey, stats] of Object.entries(modelBreakdown)) {
        const modelKey = (normalizeModelDisplayName(rawKey) || rawKey).trim();
        if (!modelKey || byModel[modelKey]) { continue; }
        const agg = computeTelemetryAggregateFromModelStats({ [modelKey]: stats }, customPricing, orchestratorPricingMode);
        if (agg.totalCalls > 0) {
            byModel[modelKey] = agg;
        }
    }

    const primaryScope: 'active' | 'session' = active !== null ? 'active' : 'session';
    const primary = active ?? overall;

    return {
        overall,
        active,
        primary,
        byModel,
        primaryScope,
    };
}

// ─── Timeline Step Helpers ───────────────────────────────────────────────────

/** Compute per-step generation speed (tok/s), returning null if below hard validity gates. */
export function computeStepSpeed(
    outputTokens: number | undefined,
    streamingSeconds: number | undefined,
): number | null {
    const out = safeNonNeg(outputTokens);
    const stream = positiveOrNull(streamingSeconds);
    if (!isHardValidSpeedSample(out, stream)) {
        return null;
    }
    return out / stream!;
}

/** Compute per-step token-weighted prompt cache hit rate using additive Antigravity semantics. */
export function computeStepCacheHitRate(
    inputTokens: number | undefined,
    cacheReadTokens: number | undefined,
    cacheCreationTokens?: number | undefined,
): number | null {
    const fresh = safeNonNeg(inputTokens);
    const read = safeNonNeg(cacheReadTokens);
    const create = safeNonNeg(cacheCreationTokens);
    const total = fresh + read + create;
    if (total <= 0) { return null; }
    return clamp01(read / total);
}

// ─── Formatters ──────────────────────────────────────────────────────────────

/** Format token generation speed (`64.2 tok/s`, `1.2k tok/s` when >= 999.95, `—` when null/invalid). */
export function formatSpeed(tokPerSec: number | null | undefined): string {
    if (tokPerSec === null || tokPerSec === undefined || !Number.isFinite(tokPerSec) || tokPerSec <= 0) {
        return '—';
    }
    if (tokPerSec >= 999.95) {
        return `${(tokPerSec / 1000).toFixed(1)}k tok/s`;
    }
    return `${tokPerSec.toFixed(1)} tok/s`;
}

/** Format latency in seconds (`420ms` when < 1.0s, `1.42s` when >= 1.0s, `—` when null/invalid). */
export function formatLatency(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        return '—';
    }
    if (seconds < 1.0) {
        const ms = Math.round(seconds * 1000);
        if (ms >= 1000) {
            return `${(ms / 1000).toFixed(2)}s`;
        }
        return `${ms}ms`;
    }
    return `${seconds.toFixed(2)}s`;
}

/** Format cache hit rate in [0, 1] (`84.2%`, `0%`, `100%`, `—` when null/invalid). */
export function formatCachePercent(rate: number | null | undefined): string {
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate < 0) {
        return '—';
    }
    const pct = clamp01(rate) * 100;
    if (pct === 0) { return '0%'; }
    if (pct >= 99.95) { return '100%'; }
    return `${pct.toFixed(1)}%`;
}

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
    costFromTokens,
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

/** Prompt cache hit % below this threshold is classified as Cold (`<10%`). */
export const PROMPT_CACHE_COLD_THRESHOLD_PCT = 10;

/** Prompt cache hit % at or above this threshold is classified as Warm (`>=70%`). */
export const PROMPT_CACHE_WARM_THRESHOLD_PCT = 70;

/** Local 5-minute idle TTL warning boundary (180 seconds = 3 minutes). */
export const PROMPT_CACHE_TTL_WARN_SECONDS = 180;

/** Local 5-minute idle TTL expiry boundary (300 seconds = 5 minutes). */
export const PROMPT_CACHE_TTL_EXPIRE_SECONDS = 300;

export const PROMPT_CACHE_TTL_WARN_MS = PROMPT_CACHE_TTL_WARN_SECONDS * 1000;
export const PROMPT_CACHE_TTL_EXPIRE_MS = PROMPT_CACHE_TTL_EXPIRE_SECONDS * 1000;

/** Default consecutive-tick wall-clock gap (ms) indicating system suspend/resume. */
export const PROMPT_CACHE_SUSPEND_GAP_THRESHOLD_MS = 90_000;

/** Default anomaly filter thresholds for GM calls. */
export const DEFAULT_GM_ANOMALY_THRESHOLDS = Object.freeze({
    slowTtftSeconds: 5.0,
    cacheMissMaxReusePct: PROMPT_CACHE_COLD_THRESHOLD_PCT,
    cacheMissMinPromptTokens: 1_000,
    highCostUsd: 0.25,
    highContextRatio: 0.80,
    highContextTokens: LONG_CONTEXT_TIER_THRESHOLD,
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type CacheState = 'warm' | 'warming' | 'cold' | 'unknown';

/** Canonical prompt-cache classification shared across Overview, Telemetry Metrics, and Turn Diagnostics. */
export type PromptCacheState = 'cold' | 'partial' | 'warm' | 'unknown';

/**
 * Single canonical prompt-cache hit-rate classifier:
 * - `null | undefined | NaN | < 0` -> `'unknown'`
 * - `< 10%` -> `'cold'`
 * - `10% <= pct < 70%` -> `'partial'`
 * - `>= 70%` -> `'warm'`
 */
export function classifyPromptCacheState(
    hitRatePercent: number | null | undefined,
): PromptCacheState {
    if (typeof hitRatePercent !== 'number' || !Number.isFinite(hitRatePercent) || hitRatePercent < 0) {
        return 'unknown';
    }
    if (hitRatePercent < PROMPT_CACHE_COLD_THRESHOLD_PCT) {
        return 'cold';
    }
    if (hitRatePercent < PROMPT_CACHE_WARM_THRESHOLD_PCT) {
        return 'partial';
    }
    return 'warm';
}

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

/** GMCallEntry with optional conversation cascadeId and telemetry extras attached for session aggregation. */
export type TelemetryCallInput = GMCallEntry & {
    cascadeId?: string;
    /** Optional pre-computed USD cost for anomaly checks. */
    estimatedCost?: number | null;
    /** Optional HTTP status code if captured on call metadata. */
    httpStatusCode?: number | null;
};

/** Model-call throughput mode: decode-only vs model-call end-to-end (`output / (TTFT + streaming)`). */
export type SpeedMetricMode = 'decode' | 'e2e';

/** Canonical five-state speed sample classification. */
export type SpeedSampleState = 'waiting' | 'short_sample' | 'missing' | 'zero' | 'measured';

/** Exact sample coverage metadata for weighted aggregates (e.g. `12/15 calls`). */
export interface SpeedCoverageMetadata {
    measuredCount: number;
    totalCount: number;
    /** `measuredCount / totalCount` in `[0, 1]`, or `null` when `totalCount === 0`. */
    coverageRatio: number | null;
}

/**
 * Genuine measured model-call phases ONLY (`ttftMs` + `streamingMs`).
 * Explicitly excludes tool execution and whole-turn orchestration, and NEVER
 * synthesizes fake disjoint thinking/tool duration bars from tool names or token counts.
 */
export interface MeasuredModelCallPhases {
    /** Measured Time-To-First-Token in milliseconds, or `null` when unmeasured. */
    ttftMs: number | null;
    /** Measured decode/streaming duration in milliseconds (excludes TTFT), or `null` when unmeasured. */
    streamingMs: number | null;
    /** Model-call total duration (`ttftMs + streamingMs`) ONLY when BOTH phases are measured. */
    modelCallTotalMs: number | null;
    /** Share of model-call duration spent in TTFT (`0..100`), or `null` unless both phases are measured. */
    ttftSharePct: number | null;
    /** Share of model-call duration spent in decode streaming (`0..100`), or `null` unless both phases are measured. */
    streamingSharePct: number | null;
    /** Provenance tag guaranteeing no synthetic thinking/tool duration segments exist. */
    phaseSource: 'measured_only';
    /** Scope tag documenting model-call boundary (excludes tool execution & orchestration). */
    scope: 'model_call';
}

export interface ModelCallSpeedInput extends SpeedSampleInput {
    /** Throughput view mode: `'decode'` (default) or `'e2e'` (model-call `output / (ttft + streaming)`). */
    mode?: SpeedMetricMode;
}

export interface ModelCallSpeedEvaluation {
    mode: SpeedMetricMode;
    scope: 'model_call';
    /** Selected mode state (`'waiting' | 'short_sample' | 'missing' | 'zero' | 'measured'`). */
    state: SpeedSampleState;
    /** Selected mode display-safe tok/s (`null` unless `state === 'measured'`). */
    displaySpeed: number | null;
    /** Selected mode unfiltered tok/s (`0` when `state === 'zero'`, `null` when `waiting` or `missing`). */
    rawSpeed: number | null;
    decodeState: SpeedSampleState;
    decodeDisplaySpeed: number | null;
    decodeRawSpeed: number | null;
    /** Model-call level E2E state (`outputTokens / (ttftSeconds + streamingSeconds)`). */
    e2eState: SpeedSampleState;
    e2eDisplaySpeed: number | null;
    e2eRawSpeed: number | null;
    isShortSample: boolean;
    isWaitingTtft: boolean;
    waitingSeconds: number | null;
    measuredPhases: MeasuredModelCallPhases;
}

export interface WeightedSpeedMetricSummary {
    mode: SpeedMetricMode;
    scope: 'model_call';
    /** Ratio of sums (`sumOutputTokens / sumDurationSeconds`) over valid measured calls only. */
    weightedTokPerSec: number | null;
    latestTokPerSec: number | null;
    coverage: SpeedCoverageMetadata;
    state: SpeedSampleState;
    sumOutputTokens: number;
    sumDurationSeconds: number;
}

/** Composite cache TTL scope key. */
export interface PromptCacheTtlKey {
    account: string;
    backend: string;
    conversation: string;
    model: string;
    branch: string;
}

/** Local 5-minute idle TTL heuristic state (`<180s` warm, `180s..300s` cooling, `>=300s` cold). */
export type PromptCacheTtlState = 'warm' | 'cooling' | 'cold' | 'unknown';

export type PromptCacheClockAnomaly = 'none' | 'clock_reversal' | 'suspend_resume';

export type CacheMissCauseKind =
    | 'model_switch'
    | 'idle_timeout'
    | 'compaction'
    | 'branch_change'
    | 'unknown';

/** Explicit evidence confidence so UI labels unconfirmed items as "Possible cause / 可能原因". */
export type CacheMissCauseConfidence = 'confirmed_event' | 'possible_cause';

export interface CacheMissCause {
    cause: CacheMissCauseKind;
    confidence: CacheMissCauseConfidence;
    detail?: string;
}

export interface PromptCacheMeasuredInput {
    inputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheCreationTokens?: number | null;
    cacheTelemetryAvailable?: boolean;
    /** Optional pre-computed provider-observed reuse percentage (`0..100`) or `null` when absent. */
    measuredReusePct?: number | null;
}

export interface PromptCacheTransitionEvidence {
    previousModel?: string | null;
    currentModel?: string | null;
    /** True when model switch is confirmed by concrete/exact model identifiers or explicit switch event. */
    modelSwitchConfirmed?: boolean;
    previousBranch?: string | null;
    currentBranch?: string | null;
    /** True when branch/fork/rewind transition was explicitly confirmed by trajectory metadata. */
    branchChangeConfirmed?: boolean;
    previousCheckpointIndex?: number | null;
    currentCheckpointIndex?: number | null;
    /** True when compaction/checkpoint event was explicitly confirmed. */
    compactionConfirmed?: boolean;
    /** True when compaction is suspected heuristically (e.g. prompt drop without confirmed checkpoint). */
    compactionSuspected?: boolean;
    /** True when prior turn had a warm/active cache so a cold turn represents a cache drop. */
    hadPriorWarmCache?: boolean;
}

export interface PromptCacheTtlInput {
    key: PromptCacheTtlKey;
    /** Optional scope key of the last cache event to detect scope/model/branch mismatches. */
    lastEventKey?: Partial<PromptCacheTtlKey> | null;
    /** Timestamp (ms) of the last relevant cache-bearing event, or `null`/`undefined` if none. */
    lastEventMs: number | null | undefined;
    /** Current wall-clock timestamp (ms). */
    nowMs: number;
    /** Optional previous tick wall-clock timestamp (ms) for suspend/resume jump detection. */
    previousNowMs?: number | null;
    /** Optional monotonic elapsed ms since `lastEventMs` for clock/suspend jump detection. */
    monotonicElapsedMs?: number | null;
    /** Explicit suspend/resume signal from host power/sleep observer. */
    suspendResumeDetected?: boolean;
    /** Consecutive tick wall-clock gap threshold (ms) treated as suspend/resume (default 90_000). */
    suspendGapThresholdMs?: number;
    /** Provider-observed measured cache reuse counts/ratio, strictly separate from local TTL timer. */
    measured?: PromptCacheMeasuredInput | null;
    /** Optional transition context for classifying confirmed vs possible cache-miss causes. */
    transition?: PromptCacheTransitionEvidence | null;
    /** Warning threshold in seconds (default 180). */
    warnSeconds?: number;
    /** Expiry threshold in seconds (default 300). */
    expireSeconds?: number;
}

export interface PromptCacheTtlEvaluation {
    cacheKey: string;
    key: PromptCacheTtlKey;
    keyMatched: boolean;
    /** Provider-observed cache reuse ratio in `0..100`, or `null` when provider cache counts are missing. */
    measuredReusePct: number | null;
    /** Provider-observed cache state (`warm` | `partial` | `cold` | `unknown`), independent of local timer. */
    measuredCacheState: PromptCacheState;
    /** True iff provider explicitly reported numeric cache counts. */
    hasMeasuredCacheTelemetry: boolean;
    /** Local 5-minute idle TTL heuristic (`warm` | `cooling` | `cold` | `unknown`). */
    ttlEstimateState: PromptCacheTtlState;
    /** Explicitly identifies TTL state as a local timer heuristic, never server-confirmed. */
    ttlSource: 'local_ttl_heuristic';
    /** Non-negative elapsed idle seconds since `lastEventMs`, or `null` on missing event / clock reversal. */
    idleSeconds: number | null;
    /** Non-negative remaining countdown seconds until expiry (NEVER negative), or `null` when unknown. */
    remainingTtlSeconds: number | null;
    warnSeconds: number;
    expireSeconds: number;
    clockAnomaly: PromptCacheClockAnomaly;
    /** True when clock reversal or suspend/resume invalidates the local timer heuristic. */
    shouldResetHeuristic: boolean;
    /** Primary classified cache-miss cause when a miss/cold state is present, else `null`. */
    missCause: CacheMissCause | null;
    /** Ranked list of applicable cache-miss causes (confirmed events before possible causes). */
    possibleCauses: CacheMissCause[];
}

export type GmAnomalyKind =
    | 'error_or_retry'
    | 'slow_ttft'
    | 'cache_miss'
    | 'high_cost'
    | 'high_context'
    | 'non_200_or_truncated';

export interface GmAnomalyThresholds {
    slowTtftSeconds?: number;
    cacheMissMaxReusePct?: number;
    cacheMissMinPromptTokens?: number;
    highCostUsd?: number;
    highContextRatio?: number;
    highContextTokens?: number;
    customPricing?: Record<string, ModelPricing>;
    orchestratorPricingMode?: OrchestratorPricingMode;
}

export interface GmAnomalyFilterOptions extends GmAnomalyThresholds {
    /** Restrict to specific anomaly kinds; empty/omitted matches ANY anomaly. */
    kinds?: readonly GmAnomalyKind[];
    /** `'any'` (OR, default) or `'all'` (AND) across requested `kinds`. */
    matchMode?: 'any' | 'all';
    /** Exclude internal compaction calls (default `false`). */
    excludeInternalCompaction?: boolean;
}

export interface GmCallAnomalyMatch<T extends TelemetryCallInput = TelemetryCallInput> {
    call: T;
    callId: string;
    anomalies: GmAnomalyKind[];
    estimatedCostUsd: number | null;
    contextUsageRatio: number | null;
    measuredReusePct: number | null;
    httpStatusCode: number | null;
    isTruncated: boolean;
}

export interface GmAnomalyFilterResult<T extends TelemetryCallInput = TelemetryCallInput> {
    matches: GmCallAnomalyMatch<T>[];
    totalInspected: number;
    matchedCount: number;
    countsByKind: Record<GmAnomalyKind, number>;
}

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
    /** Provider-measured cache read count preserving `null` absence distinct from `0`. */
    cacheReadTokensMeasured: number | null;
    /** Provider-measured cache creation count preserving `null` absence distinct from `0`. */
    cacheCreationTokensMeasured: number | null;
    /** False when provider omitted cache counts so `promptCacheHitRate`/`measuredReusePct` remain `null`. */
    cacheTelemetryAvailable: boolean;
    totalPromptTokens: number;
    totalGenTokPerSec: number | null;
    visibleTokPerSec: number | null;
    /** Model-call level end-to-end speed: `outputTokens / (ttftSeconds + streamingSeconds)` (excludes tool & turn orchestration). */
    endToEndTokPerSec: number | null;
    promptCacheHitRate: number | null;
    /** Provider-observed cache reuse percentage (`0..100`), or `null` when counts are missing. */
    measuredReusePct: number | null;
    isCacheHit: boolean;
    cacheState: CacheState;
    /** Canonical threshold classification (`<10% cold`, `10–70% partial`, `>=70% warm`). */
    promptCacheState: PromptCacheState;
    estCacheSavingsUsd: number | null;
    /** Sparse-sample speed guard evaluation for this call. */
    speedSample?: SpeedSampleEvaluation;
    /** Genuine measured model-call phases ONLY (`ttftMs`, `streamingMs`); never fake thinking/tool bars. */
    measuredPhases: MeasuredModelCallPhases;
    /** Five-state classification for decode speed (`'waiting' | 'short_sample' | 'missing' | 'zero' | 'measured'`). */
    decodeSpeedState: SpeedSampleState;
    /** Five-state classification for model-call E2E speed (`'waiting' | 'short_sample' | 'missing' | 'zero' | 'measured'`). */
    e2eSpeedState: SpeedSampleState;
}

export interface TelemetryAggregate {
    // Throughput
    weightedGenTokPerSec: number | null;
    medianGenTokPerSec: number | null;
    minGenTokPerSec: number | null;
    maxGenTokPerSec: number | null;
    weightedVisibleTokPerSec: number | null;
    /** Model-call level ratio-of-sums E2E speed: `sum(output) / sum(ttft + streaming)` over calls with BOTH valid decode and TTFT. */
    weightedEndToEndTokPerSec: number | null;
    latestGenTokPerSec: number | null;
    latestVisibleTokPerSec: number | null;
    latestEndToEndTokPerSec: number | null;
    speedSampleCount: number;
    /** Number of calls contributing to `weightedEndToEndTokPerSec` (valid decode AND valid TTFT). */
    e2eSampleCount: number;
    representativeSpeedSampleCount: number;
    hasThinking: boolean;
    /** Explicitly documents model-call level throughput boundary (excludes tool & turn orchestration). */
    speedMetricScope: 'model_call';
    /** Coverage metadata for decode speed (`{ measuredCount, totalCount, coverageRatio }`). */
    decodeSpeedCoverage: SpeedCoverageMetadata;
    /** Coverage metadata for model-call E2E speed (`{ measuredCount, totalCount, coverageRatio }`). */
    e2eSpeedCoverage: SpeedCoverageMetadata;
    /** Coverage metadata for measured TTFT (`{ measuredCount, totalCount, coverageRatio }`). */
    ttftCoverage: SpeedCoverageMetadata;
    /** Coverage metadata for calls with provider-reported cache counts (`{ measuredCount, totalCount, coverageRatio }`). */
    cacheCoverage: SpeedCoverageMetadata;

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
    /** Canonical threshold classification of the latest call (`<10% cold`, `10–70% partial`, `>=70% warm`). */
    latestPromptCacheState: PromptCacheState;
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

function nonNegOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function makeCoverage(measuredCount: number, totalCount: number): SpeedCoverageMetadata {
    const safeTotal = Math.max(0, Math.round(totalCount));
    const safeMeasured = Math.max(0, Math.min(safeTotal, Math.round(measuredCount)));
    return {
        measuredCount: safeMeasured,
        totalCount: safeTotal,
        coverageRatio: safeTotal > 0 ? safeMeasured / safeTotal : null,
    };
}

/**
 * Extract provider cache token counts while preserving genuine omission (`null`)
 * distinct from an explicitly measured `0`.
 */
function extractCallCacheCounts(call: {
    cacheReadTokens?: number | null;
    cacheCreationTokens?: number | null;
    cacheReadTokensNullable?: number | null;
    cacheCreationTokensNullable?: number | null;
    cacheTelemetryAvailable?: boolean;
}): {
    available: boolean;
    readMeasured: number | null;
    createMeasured: number | null;
    readNum: number;
    createNum: number;
} {
    if (call.cacheTelemetryAvailable === false) {
        return {
            available: false,
            readMeasured: null,
            createMeasured: null,
            readNum: 0,
            createNum: 0,
        };
    }
    if (call.cacheReadTokensNullable !== undefined || call.cacheCreationTokensNullable !== undefined) {
        const readMeasured = nonNegOrNull(call.cacheReadTokensNullable);
        const createMeasured = nonNegOrNull(call.cacheCreationTokensNullable);
        const available = readMeasured !== null || createMeasured !== null;
        return {
            available,
            readMeasured,
            createMeasured,
            readNum: readMeasured ?? 0,
            createNum: createMeasured ?? 0,
        };
    }
    if (call.cacheReadTokens === null && (call.cacheCreationTokens === null || call.cacheCreationTokens === undefined)) {
        return {
            available: false,
            readMeasured: null,
            createMeasured: null,
            readNum: 0,
            createNum: 0,
        };
    }
    const readMeasured = nonNegOrNull(call.cacheReadTokens);
    const createMeasured = nonNegOrNull(call.cacheCreationTokens);
    const available = readMeasured !== null || createMeasured !== null;
    return {
        available,
        readMeasured,
        createMeasured,
        readNum: readMeasured ?? 0,
        createNum: createMeasured ?? 0,
    };
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
    if (totalPromptTokens <= 0) { return 'unknown'; }
    const hitRatePercent = clamp01(cacheReadTokens / totalPromptTokens) * 100;
    const canonical = classifyPromptCacheState(hitRatePercent);
    if (canonical === 'warm') { return 'warm'; }
    if (canonical === 'partial') { return 'warming'; }
    // <10% read hit: distinguish active cache-write warm-up (cacheCreation > 0 with 0 read) from cold miss.
    if (cacheReadTokens <= 0 && cacheCreationTokens > 0) { return 'warming'; }
    return 'cold';
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
 * Extract ONLY genuine measured model-call phases (`ttftMs` and `streamingMs`).
 * Never synthesizes fake disjoint thinking/tool duration bars from tool names or token counts.
 */
export function computeMeasuredModelCallPhases(input: {
    ttftSeconds?: number | null;
    streamingSeconds?: number | null;
}): MeasuredModelCallPhases {
    const ttftSec = positiveOrNull(input.ttftSeconds);
    const streamSec = positiveOrNull(input.streamingSeconds);
    const ttftMs = ttftSec !== null ? Math.round(ttftSec * 1000 * 100) / 100 : null;
    const streamingMs = streamSec !== null ? Math.round(streamSec * 1000 * 100) / 100 : null;
    const hasBoth = ttftMs !== null && streamingMs !== null && (ttftMs + streamingMs) > 0;
    const modelCallTotalMs = hasBoth ? Math.round((ttftMs! + streamingMs!) * 100) / 100 : null;
    const ttftSharePct = hasBoth ? Math.round((ttftMs! / modelCallTotalMs!) * 1000) / 10 : null;
    const streamingSharePct = hasBoth ? Math.round((streamingMs! / modelCallTotalMs!) * 1000) / 10 : null;
    return {
        ttftMs,
        streamingMs,
        modelCallTotalMs,
        ttftSharePct,
        streamingSharePct,
        phaseSource: 'measured_only',
        scope: 'model_call',
    };
}

/**
 * Evaluate model-call level Decode vs E2E speed with explicit 5-state classification:
 * `'waiting' | 'short_sample' | 'missing' | 'zero' | 'measured'`.
 *
 * - Decode speed: `outputTokens / streamingSeconds` (decode phase only).
 * - Model-call E2E speed: `outputTokens / (ttftSeconds + streamingSeconds)`
 *   (strictly model-call level; excludes tool execution & whole-turn orchestration).
 */
export function evaluateModelCallSpeed(input: ModelCallSpeedInput): ModelCallSpeedEvaluation {
    const mode: SpeedMetricMode = input.mode === 'e2e' ? 'e2e' : 'decode';
    const rawOut = nonNegOrNull(input.outputTokens);
    const out = rawOut ?? 0;
    const stream = positiveOrNull(input.streamingSeconds);
    const ttft = positiveOrNull(input.ttftSeconds);
    const elapsedWait = positiveOrNull(input.elapsedWaitSeconds);

    const minOut = typeof input.minOutputTokens === 'number' && Number.isFinite(input.minOutputTokens) && input.minOutputTokens > 0
        ? Math.max(MIN_OUTPUT_TOKENS_FOR_SPEED, input.minOutputTokens)
        : SHORT_SAMPLE_MIN_OUTPUT_TOKENS;
    const minStream = typeof input.minStreamSeconds === 'number' && Number.isFinite(input.minStreamSeconds) && input.minStreamSeconds > 0
        ? Math.max(MIN_STREAM_SECONDS, input.minStreamSeconds)
        : SHORT_SAMPLE_MIN_STREAM_SECONDS;

    const measuredPhases = computeMeasuredModelCallPhases({
        ttftSeconds: ttft,
        streamingSeconds: stream,
    });

    const waitingCondition = (out === 0 && stream === null && (input.isStreaming === true || elapsedWait !== null || ttft !== null))
        || (input.isStreaming === true && out === 0);
    const waitingSeconds = waitingCondition ? (elapsedWait ?? ttft ?? null) : null;

    // Decode evaluation
    let decodeState: SpeedSampleState;
    let decodeRawSpeed: number | null = null;
    let decodeDisplaySpeed: number | null = null;
    if (waitingCondition) {
        decodeState = 'waiting';
    } else if (rawOut === 0 && stream !== null) {
        decodeState = 'zero';
        decodeRawSpeed = 0;
        decodeDisplaySpeed = 0;
    } else if (out <= 0 || stream === null) {
        decodeState = 'missing';
    } else {
        const speed = out / stream;
        if (!Number.isFinite(speed) || speed <= 0) {
            decodeState = 'missing';
        } else if (out < minOut || stream < minStream) {
            decodeState = 'short_sample';
            decodeRawSpeed = speed;
        } else {
            decodeState = 'measured';
            decodeRawSpeed = speed;
            decodeDisplaySpeed = speed;
        }
    }

    // Model-call E2E evaluation: outputTokens / (ttftSeconds + streamingSeconds)
    let e2eState: SpeedSampleState;
    let e2eRawSpeed: number | null = null;
    let e2eDisplaySpeed: number | null = null;
    if (waitingCondition) {
        e2eState = 'waiting';
    } else if (rawOut === 0 && stream !== null && ttft !== null) {
        e2eState = 'zero';
        e2eRawSpeed = 0;
        e2eDisplaySpeed = 0;
    } else if (out <= 0 || stream === null || ttft === null) {
        e2eState = 'missing';
    } else {
        const totalDuration = ttft + stream;
        const speed = totalDuration > 0 ? out / totalDuration : NaN;
        if (!Number.isFinite(speed) || speed <= 0) {
            e2eState = 'missing';
        } else if (out < minOut || stream < minStream) {
            e2eState = 'short_sample';
            e2eRawSpeed = speed;
        } else {
            e2eState = 'measured';
            e2eRawSpeed = speed;
            e2eDisplaySpeed = speed;
        }
    }

    const state = mode === 'e2e' ? e2eState : decodeState;
    const displaySpeed = mode === 'e2e' ? e2eDisplaySpeed : decodeDisplaySpeed;
    const rawSpeed = mode === 'e2e' ? e2eRawSpeed : decodeRawSpeed;

    return {
        mode,
        scope: 'model_call',
        state,
        displaySpeed,
        rawSpeed,
        decodeState,
        decodeDisplaySpeed,
        decodeRawSpeed,
        e2eState,
        e2eDisplaySpeed,
        e2eRawSpeed,
        isShortSample: state === 'short_sample',
        isWaitingTtft: state === 'waiting',
        waitingSeconds,
        measuredPhases,
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
        latestEndToEndTokPerSec: null,
        speedSampleCount: 0,
        e2eSampleCount: 0,
        representativeSpeedSampleCount: 0,
        hasThinking: false,
        speedMetricScope: 'model_call',
        decodeSpeedCoverage: makeCoverage(0, 0),
        e2eSpeedCoverage: makeCoverage(0, 0),
        ttftCoverage: makeCoverage(0, 0),
        cacheCoverage: makeCoverage(0, 0),

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
        latestPromptCacheState: 'unknown',
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
    const cacheCounts = extractCallCacheCounts(call);
    const cacheReadTokens = cacheCounts.readNum;
    const cacheCreationTokens = cacheCounts.createNum;

    // Thinking tokens are strictly a subset of outputTokens; handle implicit thinking
    // (e.g., Gemini Flash omitting thinkingOutputTokens while outputTokens > responseTokens).
    const visibleResponseTokens = responseTokens > 0
        ? Math.min(outputTokens, responseTokens)
        : Math.max(0, outputTokens - thinkingTokens);
    const effectiveThinkingTokens = thinkingTokens > 0
        ? thinkingTokens
        : (responseTokens > 0 && outputTokens > responseTokens ? outputTokens - responseTokens : 0);

    // Antigravity additive prompt cache semantics — preserve genuine absence as null/unknown!
    const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
    const promptCacheHitRate = (cacheCounts.available && totalPromptTokens > 0)
        ? clamp01(cacheReadTokens / totalPromptTokens)
        : null;
    const measuredReusePct = promptCacheHitRate !== null ? promptCacheHitRate * 100 : null;
    const isCacheHit = cacheCounts.available && cacheReadTokens > 0;
    const promptCacheState = classifyPromptCacheState(measuredReusePct);
    const cacheState = cacheCounts.available
        ? classifyCacheState(cacheReadTokens, cacheCreationTokens, totalPromptTokens)
        : 'unknown';

    // Speed metrics (decode strictly excludes TTFT; model-call E2E = output / (ttft + streaming))
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
    const modelCallSpeed = evaluateModelCallSpeed({
        outputTokens: nonNegOrNull(call.outputTokens),
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
        cacheReadTokensMeasured: cacheCounts.readMeasured,
        cacheCreationTokensMeasured: cacheCounts.createMeasured,
        cacheTelemetryAvailable: cacheCounts.available,
        totalPromptTokens,
        totalGenTokPerSec,
        visibleTokPerSec,
        endToEndTokPerSec,
        promptCacheHitRate,
        measuredReusePct,
        isCacheHit,
        cacheState,
        promptCacheState,
        estCacheSavingsUsd,
        speedSample,
        measuredPhases: modelCallSpeed.measuredPhases,
        decodeSpeedState: modelCallSpeed.decodeState,
        e2eSpeedState: modelCallSpeed.e2eState,
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
        latestEndToEndTokPerSec: null,
        speedSampleCount,
        e2eSampleCount: 0,
        representativeSpeedSampleCount: 0,
        hasThinking,
        speedMetricScope: 'model_call',
        decodeSpeedCoverage: makeCoverage(speedSampleCount, totalCalls),
        e2eSpeedCoverage: makeCoverage(0, totalCalls),
        ttftCoverage: makeCoverage(ttftSampleCount, totalCalls),
        cacheCoverage: makeCoverage(totalPromptTokens > 0 ? totalCalls : 0, totalCalls),

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
        latestPromptCacheState: classifyPromptCacheState(
            totalPromptTokens > 0 ? clamp01(totalCacheReadTokens / totalPromptTokens) * 100 : null,
        ),
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
    const e2eValidSpeedPoints: OrderedPoint[] = [];
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
    let measuredFreshInputTokens = 0;
    let measuredCacheReadTokens = 0;
    let measuredCacheCreationTokens = 0;
    let cacheMeasuredCallCount = 0;
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
        if (point.cacheTelemetryAvailable) {
            cacheMeasuredCallCount++;
            measuredFreshInputTokens += point.inputTokens;
            measuredCacheReadTokens += point.cacheReadTokens;
            measuredCacheCreationTokens += point.cacheCreationTokens;
        }
        if (point.isCacheHit) { cachedCallCount++; }
        if (point.effectiveThinkingTokens > 0) { hasThinking = true; }
        if (point.estCacheSavingsUsd !== null) {
            savingsUsdSum += point.estCacheSavingsUsd;
            pricedCacheReadCalls++;
        }

        if (point.ttftSeconds !== null) {
            ttftValues.push(point.ttftSeconds);
            ttftOrderedPoints.push(ordered);
            if (point.cacheTelemetryAvailable) {
                if (point.isCacheHit) {
                    cachedTtftValues.push(point.ttftSeconds);
                } else {
                    uncachedTtftValues.push(point.ttftSeconds);
                }
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

            if (point.ttftSeconds !== null && point.endToEndTokPerSec !== null) {
                e2eValidSpeedPoints.push(ordered);
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
    const latestE2eSpeedCall = pickLatest(e2eValidSpeedPoints);
    const latestTtftCall = pickLatest(ttftOrderedPoints);
    const latestTimedCall = latestSpeedCall || pickLatest(timedOrderedPoints);

    const totalCalls = orderedPoints.length;
    const totalPromptTokens = totalFreshInputTokens + totalCacheReadTokens + totalCacheCreationTokens;
    const measuredPromptTokens = measuredFreshInputTokens + measuredCacheReadTokens + measuredCacheCreationTokens;
    const cacheReuseDenom = measuredCacheReadTokens + measuredCacheCreationTokens;

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
        latestEndToEndTokPerSec: latestE2eSpeedCall?.endToEndTokPerSec ?? null,
        speedSampleCount: hardValidSpeedPoints.length,
        e2eSampleCount: e2eValidSpeedPoints.length,
        representativeSpeedSampleCount: repSpeedPoints.length,
        hasThinking,
        speedMetricScope: 'model_call',
        decodeSpeedCoverage: makeCoverage(hardValidSpeedPoints.length, totalCalls),
        e2eSpeedCoverage: makeCoverage(e2eValidSpeedPoints.length, totalCalls),
        ttftCoverage: makeCoverage(ttftValues.length, totalCalls),
        cacheCoverage: makeCoverage(cacheMeasuredCallCount, totalCalls),

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
        tokenCacheHitRate: (cacheMeasuredCallCount > 0 && measuredPromptTokens > 0)
            ? clamp01(measuredCacheReadTokens / measuredPromptTokens)
            : null,
        callCacheHitRate: cacheMeasuredCallCount > 0
            ? clamp01(cachedCallCount / cacheMeasuredCallCount)
            : null,
        cacheReuseRate: (cacheMeasuredCallCount > 0 && cacheReuseDenom > 0)
            ? clamp01(measuredCacheReadTokens / cacheReuseDenom)
            : null,
        cachedCallCount,
        totalCalls,
        latestCacheState: latestCall?.cacheState ?? 'unknown',
        latestPromptCacheState: latestCall?.promptCacheState ?? 'unknown',
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

    const hasActiveTarget = typeof activeCascadeId === 'string' && activeCascadeId.trim().length > 0;
    const primaryScope: 'active' | 'session' = hasActiveTarget ? 'active' : 'session';
    // Never fall back to unrelated conversations (`overall`) when a specific active conversation
    // was requested and has zero recorded calls yet.
    const primary = hasActiveTarget
        ? (active ?? createEmptyTelemetryAggregate())
        : overall;

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

/** Compute per-step token-weighted prompt cache hit rate using additive Antigravity semantics.
 *  Preserves genuine absence (`null`) distinct from measured `0` when `cacheTelemetryAvailable === false`
 *  or cache token counters are explicitly `null`. */
export function computeStepCacheHitRate(
    inputTokens: number | null | undefined,
    cacheReadTokens: number | null | undefined,
    cacheCreationTokens?: number | null | undefined,
    options?: { cacheTelemetryAvailable?: boolean },
): number | null {
    if (options?.cacheTelemetryAvailable === false) { return null; }
    if (cacheReadTokens === null && (cacheCreationTokens === null || cacheCreationTokens === undefined)) {
        return null;
    }
    const fresh = safeNonNeg(inputTokens);
    const read = safeNonNeg(cacheReadTokens);
    const create = safeNonNeg(cacheCreationTokens);
    const total = fresh + read + create;
    if (total <= 0) { return null; }
    return clamp01(read / total);
}

// ─── Model-Call Weighted Speed Selector (Decode vs E2E) ──────────────────────

/**
 * Compute model-call level weighted throughput using **ratio of sums** (`sumOutput / sumDuration`)
 * strictly over calls with valid measured samples, returning exact coverage (`{ measuredCount, totalCount }`).
 *
 * - `mode: 'decode'`: `sum(outputTokens) / sum(streamingSeconds)` over valid decode calls.
 * - `mode: 'e2e'`: `sum(outputTokens) / sum(ttftSeconds + streamingSeconds)` over calls with BOTH
 *   valid decode and valid measured TTFT (excludes tool execution & whole-turn orchestration).
 */
export function computeWeightedSpeedMetric(
    calls: readonly TelemetryCallInput[],
    mode: SpeedMetricMode = 'decode',
    options?: { excludeInternalCompaction?: boolean; isStreaming?: boolean },
): WeightedSpeedMetricSummary {
    const excludeCompaction = options?.excludeInternalCompaction !== false;
    const filtered = excludeCompaction ? calls.filter(c => !isInternalCompactionCall(c)) : calls;
    const totalCount = filtered.length;

    let measuredCount = 0;
    let shortSampleCount = 0;
    let zeroCount = 0;
    let sumOutputTokens = 0;
    let sumDurationSeconds = 0;
    const validOrdered: Array<{ speed: number; ts: number | null; order: number }> = [];

    for (let i = 0; i < filtered.length; i++) {
        const call = filtered[i];
        const rawOut = nonNegOrNull(call.outputTokens);
        const out = rawOut ?? 0;
        const stream = positiveOrNull(call.streamingSeconds);
        const ttft = positiveOrNull(call.ttftSeconds);
        const ts = parseValidTimestamp(call.createdAt);

        if (mode === 'e2e') {
            if (isHardValidSpeedSample(out, stream) && ttft !== null) {
                const dur = ttft + stream!;
                measuredCount++;
                sumOutputTokens += out;
                sumDurationSeconds += dur;
                validOrdered.push({ speed: out / dur, ts, order: i });
            } else if (rawOut === 0 && stream !== null && ttft !== null) {
                zeroCount++;
            } else if (out > 0 && stream !== null && ttft !== null) {
                shortSampleCount++;
            }
        } else {
            if (isHardValidSpeedSample(out, stream)) {
                measuredCount++;
                sumOutputTokens += out;
                sumDurationSeconds += stream!;
                validOrdered.push({ speed: out / stream!, ts, order: i });
            } else if (rawOut === 0 && stream !== null) {
                zeroCount++;
            } else if (out > 0 && stream !== null) {
                shortSampleCount++;
            }
        }
    }

    let latestTokPerSec: number | null = null;
    if (validOrdered.length > 0) {
        let best = validOrdered[0];
        for (let i = 1; i < validOrdered.length; i++) {
            const cur = validOrdered[i];
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
        latestTokPerSec = best.speed;
    }

    const weightedTokPerSec = (measuredCount > 0 && sumDurationSeconds > 0)
        ? sumOutputTokens / sumDurationSeconds
        : null;

    let state: SpeedSampleState;
    if (weightedTokPerSec !== null) {
        state = 'measured';
    } else if (options?.isStreaming === true) {
        state = 'waiting';
    } else if (shortSampleCount > 0) {
        state = 'short_sample';
    } else if (zeroCount > 0) {
        state = 'zero';
    } else {
        state = 'missing';
    }

    return {
        mode,
        scope: 'model_call',
        weightedTokPerSec,
        latestTokPerSec,
        coverage: makeCoverage(measuredCount, totalCount),
        state,
        sumOutputTokens,
        sumDurationSeconds,
    };
}

/** Project decode or model-call E2E speed + coverage directly from a precomputed {@link TelemetryAggregate}. */
export function selectAggregateSpeedMetric(
    aggregate: TelemetryAggregate,
    mode: SpeedMetricMode = 'decode',
): {
    mode: SpeedMetricMode;
    scope: 'model_call';
    weightedTokPerSec: number | null;
    latestTokPerSec: number | null;
    coverage: SpeedCoverageMetadata;
    state: SpeedSampleState;
} {
    const weightedTokPerSec = mode === 'e2e'
        ? aggregate.weightedEndToEndTokPerSec
        : aggregate.weightedGenTokPerSec;
    const latestTokPerSec = mode === 'e2e'
        ? aggregate.latestEndToEndTokPerSec
        : aggregate.latestGenTokPerSec;
    const coverage = mode === 'e2e'
        ? aggregate.e2eSpeedCoverage
        : aggregate.decodeSpeedCoverage;
    const latestState = mode === 'e2e'
        ? aggregate.latestCall?.e2eSpeedState
        : aggregate.latestCall?.decodeSpeedState;

    const state: SpeedSampleState = weightedTokPerSec !== null
        ? 'measured'
        : (latestState ?? 'missing');

    return {
        mode,
        scope: 'model_call',
        weightedTokPerSec,
        latestTokPerSec,
        coverage,
        state,
    };
}

// ─── Prompt Cache 5-Minute Idle TTL Heuristic & Possible Causes ──────────────

function normalizeTtlSegment(value: string | null | undefined, fallback = ''): string {
    const clean = typeof value === 'string' ? value.trim() : '';
    return clean || fallback;
}

/** Build deterministic composite cache TTL key `{ account, backend, conversation, model, branch }`. */
export function buildPromptCacheTtlKey(key: Partial<PromptCacheTtlKey>): string {
    return [
        normalizeTtlSegment(key.account, 'default').toLowerCase(),
        normalizeTtlSegment(key.backend, 'default'),
        normalizeTtlSegment(key.conversation),
        normalizeTtlSegment(key.model),
        normalizeTtlSegment(key.branch, 'main'),
    ].join('|');
}

function normalizeCacheTtlKeyStruct(key: PromptCacheTtlKey): PromptCacheTtlKey {
    return {
        account: normalizeTtlSegment(key.account, 'default').toLowerCase(),
        backend: normalizeTtlSegment(key.backend, 'default'),
        conversation: normalizeTtlSegment(key.conversation),
        model: normalizeTtlSegment(key.model),
        branch: normalizeTtlSegment(key.branch, 'main'),
    };
}

function resolveMeasuredCacheReuse(measured?: PromptCacheMeasuredInput | null): {
    hasMeasuredCacheTelemetry: boolean;
    measuredReusePct: number | null;
    measuredCacheState: PromptCacheState;
} {
    if (!measured) {
        return {
            hasMeasuredCacheTelemetry: false,
            measuredReusePct: null,
            measuredCacheState: 'unknown',
        };
    }
    if (measured.cacheTelemetryAvailable === false) {
        return {
            hasMeasuredCacheTelemetry: false,
            measuredReusePct: null,
            measuredCacheState: 'unknown',
        };
    }
    if (typeof measured.measuredReusePct === 'number' && Number.isFinite(measured.measuredReusePct) && measured.measuredReusePct >= 0) {
        const pct = Math.min(100, Math.max(0, measured.measuredReusePct));
        return {
            hasMeasuredCacheTelemetry: true,
            measuredReusePct: pct,
            measuredCacheState: classifyPromptCacheState(pct),
        };
    }
    if (measured.measuredReusePct === null) {
        return {
            hasMeasuredCacheTelemetry: false,
            measuredReusePct: null,
            measuredCacheState: 'unknown',
        };
    }

    const read = nonNegOrNull(measured.cacheReadTokens);
    const create = nonNegOrNull(measured.cacheCreationTokens);
    if (read === null && create === null) {
        return {
            hasMeasuredCacheTelemetry: false,
            measuredReusePct: null,
            measuredCacheState: 'unknown',
        };
    }
    const fresh = safeNonNeg(measured.inputTokens);
    const total = fresh + (read ?? 0) + (create ?? 0);
    if (total <= 0) {
        return {
            hasMeasuredCacheTelemetry: true,
            measuredReusePct: null,
            measuredCacheState: 'unknown',
        };
    }
    const pct = clamp01((read ?? 0) / total) * 100;
    return {
        hasMeasuredCacheTelemetry: true,
        measuredReusePct: pct,
        measuredCacheState: classifyPromptCacheState(pct),
    };
}

/**
 * Classify prompt-cache miss causes tagged explicitly with `'confirmed_event'` vs `'possible_cause'`.
 *
 * - `compaction`: `'confirmed_event'` when checkpoint incremented or `compactionConfirmed === true`;
 *   `'possible_cause'` when suspected without confirmed checkpoint.
 * - `model_switch`: `'confirmed_event'` when model changed with `modelSwitchConfirmed === true`;
 *   `'possible_cause'` when inferred/unconfirmed.
 * - `branch_change`: `'confirmed_event'` when branch changed with `branchChangeConfirmed === true`;
 *   `'possible_cause'` when unconfirmed.
 * - `idle_timeout`: ALWAYS `'possible_cause'` (local 5-minute TTL heuristic, never server-confirmed).
 * - `unknown`: `'possible_cause'` fallback when a measured cold miss has no identified trigger.
 */
export function classifyCacheMissCauses(input: {
    idleSeconds: number | null;
    expireSeconds?: number;
    clockAnomaly?: PromptCacheClockAnomaly;
    measuredReusePct: number | null;
    hasMeasuredCacheTelemetry: boolean;
    ttlEstimateState: PromptCacheTtlState;
    transition?: PromptCacheTransitionEvidence | null;
    key?: PromptCacheTtlKey;
    lastEventKey?: Partial<PromptCacheTtlKey> | null;
}): { missCause: CacheMissCause | null; possibleCauses: CacheMissCause[] } {
    const expireSec = typeof input.expireSeconds === 'number' && Number.isFinite(input.expireSeconds) && input.expireSeconds > 0
        ? input.expireSeconds
        : PROMPT_CACHE_TTL_EXPIRE_SECONDS;
    const t = input.transition ?? {};

    const isMeasuredWarmOrPartial = input.hasMeasuredCacheTelemetry
        && input.measuredReusePct !== null
        && input.measuredReusePct >= PROMPT_CACHE_COLD_THRESHOLD_PCT;
    const isMeasuredColdMiss = input.hasMeasuredCacheTelemetry
        && input.measuredReusePct !== null
        && input.measuredReusePct < PROMPT_CACHE_COLD_THRESHOLD_PCT;
    const isTtlExpired = input.ttlEstimateState === 'cold';

    // If provider explicitly measured a warm/partial cache hit, no cache miss occurred
    // (even if the local 5m TTL heuristic elapsed).
    if (isMeasuredWarmOrPartial) {
        return { missCause: null, possibleCauses: [] };
    }

    const causes: CacheMissCause[] = [];

    // 1. Compaction / checkpoint event
    const checkpointAdvanced = typeof t.previousCheckpointIndex === 'number'
        && typeof t.currentCheckpointIndex === 'number'
        && Number.isFinite(t.previousCheckpointIndex)
        && Number.isFinite(t.currentCheckpointIndex)
        && t.currentCheckpointIndex > t.previousCheckpointIndex;
    if (t.compactionConfirmed === true || checkpointAdvanced) {
        causes.push({
            cause: 'compaction',
            confidence: 'confirmed_event',
            ...(checkpointAdvanced
                ? { detail: `checkpoint ${t.previousCheckpointIndex} -> ${t.currentCheckpointIndex}` }
                : {}),
        });
    } else if (t.compactionSuspected === true) {
        causes.push({
            cause: 'compaction',
            confidence: 'possible_cause',
        });
    }

    // 2. Model switch
    const prevModel = normalizeTtlSegment(t.previousModel ?? input.lastEventKey?.model);
    const currModel = normalizeTtlSegment(t.currentModel ?? input.key?.model);
    if (prevModel && currModel && prevModel !== currModel) {
        causes.push({
            cause: 'model_switch',
            confidence: t.modelSwitchConfirmed === true ? 'confirmed_event' : 'possible_cause',
            detail: `${prevModel} -> ${currModel}`,
        });
    }

    // 3. Branch change / rewind / fork
    const prevBranch = normalizeTtlSegment(t.previousBranch ?? input.lastEventKey?.branch);
    const currBranch = normalizeTtlSegment(t.currentBranch ?? input.key?.branch);
    if (prevBranch && currBranch && prevBranch !== currBranch) {
        causes.push({
            cause: 'branch_change',
            confidence: t.branchChangeConfirmed === true ? 'confirmed_event' : 'possible_cause',
            detail: `${prevBranch} -> ${currBranch}`,
        });
    }

    // 4. Local 5-minute idle TTL heuristic — ALWAYS 'possible_cause' (never server-confirmed!)
    if (
        (input.idleSeconds !== null && input.idleSeconds >= expireSec)
        || (input.clockAnomaly === 'suspend_resume' && input.ttlEstimateState === 'cold')
    ) {
        causes.push({
            cause: 'idle_timeout',
            confidence: 'possible_cause',
            ...(input.idleSeconds !== null ? { detail: `idle ${Math.round(input.idleSeconds)}s >= ${expireSec}s` } : {}),
        });
    }

    // Rank confirmed_event before possible_cause while preserving deterministic order within each tier.
    causes.sort((a, b) => {
        if (a.confidence === b.confidence) { return 0; }
        return a.confidence === 'confirmed_event' ? -1 : 1;
    });

    if (causes.length === 0 && (isMeasuredColdMiss || isTtlExpired || t.hadPriorWarmCache === true)) {
        causes.push({
            cause: 'unknown',
            confidence: 'possible_cause',
        });
    }

    return {
        missCause: causes.length > 0 ? causes[0] : null,
        possibleCauses: causes,
    };
}

/**
 * Evaluate the local 5-minute prompt-cache idle TTL heuristic keyed by
 * `{ account, backend, conversation, model, branch }`.
 *
 * Exact deterministic boundaries:
 * - `0 <= idleSeconds < 180`: `'warm'`
 * - `180 <= idleSeconds < 300`: `'cooling'` (warning band)
 * - `idleSeconds >= 300`: `'cold'` (expired, `remainingTtlSeconds = 0`, NEVER negative)
 * - `nowMs < lastEventMs`: clock reversal -> `'unknown'`, `idleSeconds = null`, `remainingTtlSeconds = null`, `shouldResetHeuristic = true`
 * - System suspend/resume jump: `'cold'` if `idleSeconds >= 300`, else `'unknown'`, with `shouldResetHeuristic = true`
 * - Strictly separates `measuredReusePct` (provider-observed, `null` when missing) from `ttlEstimateState` (local heuristic).
 */
export function evaluatePromptCacheTtl(input: PromptCacheTtlInput): PromptCacheTtlEvaluation {
    const key = normalizeCacheTtlKeyStruct(input.key);
    const cacheKey = buildPromptCacheTtlKey(key);
    const warnSeconds = typeof input.warnSeconds === 'number' && Number.isFinite(input.warnSeconds) && input.warnSeconds > 0
        ? input.warnSeconds
        : PROMPT_CACHE_TTL_WARN_SECONDS;
    const expireSeconds = typeof input.expireSeconds === 'number' && Number.isFinite(input.expireSeconds) && input.expireSeconds > warnSeconds
        ? input.expireSeconds
        : Math.max(warnSeconds + 1, PROMPT_CACHE_TTL_EXPIRE_SECONDS);
    const suspendGapThresholdMs = typeof input.suspendGapThresholdMs === 'number'
        && Number.isFinite(input.suspendGapThresholdMs)
        && input.suspendGapThresholdMs > 0
        ? input.suspendGapThresholdMs
        : PROMPT_CACHE_SUSPEND_GAP_THRESHOLD_MS;

    const measuredInfo = resolveMeasuredCacheReuse(input.measured);

    // Check scope key compatibility when lastEventKey is supplied
    let keyMatched = true;
    let scopeMismatched = false;
    let modelOrBranchMismatched = false;
    if (input.lastEventKey) {
        const lastAcc = normalizeTtlSegment(input.lastEventKey.account, key.account).toLowerCase();
        const lastBack = normalizeTtlSegment(input.lastEventKey.backend, key.backend);
        const lastConv = normalizeTtlSegment(input.lastEventKey.conversation, key.conversation);
        const lastModel = normalizeTtlSegment(input.lastEventKey.model, key.model);
        const lastBranch = normalizeTtlSegment(input.lastEventKey.branch, key.branch);
        if (lastAcc !== key.account || lastBack !== key.backend || lastConv !== key.conversation) {
            keyMatched = false;
            scopeMismatched = true;
        } else if (lastModel !== key.model || lastBranch !== key.branch) {
            keyMatched = false;
            modelOrBranchMismatched = true;
        }
    }

    const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : NaN;
    const lastEventMs = typeof input.lastEventMs === 'number' && Number.isFinite(input.lastEventMs)
        ? input.lastEventMs
        : null;
    const previousNowMs = typeof input.previousNowMs === 'number' && Number.isFinite(input.previousNowMs)
        ? input.previousNowMs
        : null;

    let ttlEstimateState: PromptCacheTtlState = 'unknown';
    let idleSeconds: number | null = null;
    let remainingTtlSeconds: number | null = null;
    let clockAnomaly: PromptCacheClockAnomaly = 'none';
    let shouldResetHeuristic = false;

    if (!Number.isFinite(nowMs) || lastEventMs === null || scopeMismatched) {
        ttlEstimateState = 'unknown';
        shouldResetHeuristic = scopeMismatched;
    } else if (nowMs < lastEventMs || (previousNowMs !== null && nowMs < previousNowMs)) {
        // Clock reversal (NTP step backwards or system clock adjustment) -> reset heuristic cleanly, NEVER negative!
        clockAnomaly = 'clock_reversal';
        ttlEstimateState = 'unknown';
        idleSeconds = null;
        remainingTtlSeconds = null;
        shouldResetHeuristic = true;
    } else {
        const wallIdleMs = nowMs - lastEventMs;
        const wallIdleSec = wallIdleMs / 1000;
        const tickGapSuspend = previousNowMs !== null && (nowMs - previousNowMs) >= suspendGapThresholdMs;
        const monotonicDiverged = typeof input.monotonicElapsedMs === 'number'
            && Number.isFinite(input.monotonicElapsedMs)
            && input.monotonicElapsedMs >= 0
            && Math.abs(wallIdleMs - input.monotonicElapsedMs) > 30_000;
        const isSuspendResume = input.suspendResumeDetected === true || tickGapSuspend || monotonicDiverged;

        if (isSuspendResume) {
            clockAnomaly = 'suspend_resume';
            shouldResetHeuristic = true;
            idleSeconds = wallIdleSec;
            if (wallIdleSec >= expireSeconds) {
                ttlEstimateState = 'cold';
                remainingTtlSeconds = 0;
            } else {
                ttlEstimateState = 'unknown';
                remainingTtlSeconds = null;
            }
        } else if (modelOrBranchMismatched) {
            // Same conversation but model or branch switched -> prior prefix key is invalidated!
            idleSeconds = wallIdleSec;
            ttlEstimateState = 'cold';
            remainingTtlSeconds = 0;
            shouldResetHeuristic = true;
        } else {
            idleSeconds = wallIdleSec;
            if (wallIdleSec < warnSeconds) {
                ttlEstimateState = 'warm';
                remainingTtlSeconds = Math.max(0, expireSeconds - wallIdleSec);
            } else if (wallIdleSec < expireSeconds) {
                ttlEstimateState = 'cooling';
                remainingTtlSeconds = Math.max(0, expireSeconds - wallIdleSec);
            } else {
                ttlEstimateState = 'cold';
                remainingTtlSeconds = 0;
            }
        }
    }

    const { missCause, possibleCauses } = classifyCacheMissCauses({
        idleSeconds,
        expireSeconds,
        clockAnomaly,
        measuredReusePct: measuredInfo.measuredReusePct,
        hasMeasuredCacheTelemetry: measuredInfo.hasMeasuredCacheTelemetry,
        ttlEstimateState,
        transition: input.transition,
        key,
        lastEventKey: input.lastEventKey,
    });

    return {
        cacheKey,
        key,
        keyMatched,
        measuredReusePct: measuredInfo.measuredReusePct,
        measuredCacheState: measuredInfo.measuredCacheState,
        hasMeasuredCacheTelemetry: measuredInfo.hasMeasuredCacheTelemetry,
        ttlEstimateState,
        ttlSource: 'local_ttl_heuristic',
        idleSeconds,
        remainingTtlSeconds,
        warnSeconds,
        expireSeconds,
        clockAnomaly,
        shouldResetHeuristic,
        missCause,
        possibleCauses,
    };
}

interface CacheTtlAnchorRecord {
    key: PromptCacheTtlKey;
    lastEventMs: number;
    lastEvaluatedNowMs: number;
    checkpointIndex: number | null;
    hadWarmCache: boolean;
    modelConfirmed: boolean;
    branchConfirmed: boolean;
}

/**
 * Stateful bounded tracker for the 5-minute prompt-cache idle TTL heuristic keyed by
 * `{ account, backend, conversation, model, branch }`.
 * Automatically tracks prior conversation-level model/branch/checkpoint transitions
 * and detects clock reversal or system suspend/resume jumps across evaluations.
 */
export class PromptCacheTtlTracker {
    private readonly byCompositeKey = new Map<string, CacheTtlAnchorRecord>();
    private readonly byConversationScope = new Map<string, CacheTtlAnchorRecord>();
    private readonly maxEntries: number;
    private readonly suspendGapThresholdMs: number;

    constructor(options?: { maxEntries?: number; suspendGapThresholdMs?: number }) {
        this.maxEntries = options?.maxEntries && options.maxEntries > 0 ? Math.round(options.maxEntries) : 256;
        this.suspendGapThresholdMs = options?.suspendGapThresholdMs && options.suspendGapThresholdMs > 0
            ? options.suspendGapThresholdMs
            : PROMPT_CACHE_SUSPEND_GAP_THRESHOLD_MS;
    }

    private conversationScopeKey(key: PromptCacheTtlKey): string {
        return `${key.account}|${key.backend}|${key.conversation}`;
    }

    /** Record a cache-bearing model call event for a composite key. */
    recordEvent(input: {
        key: PromptCacheTtlKey;
        eventMs: number;
        measured?: PromptCacheMeasuredInput | null;
        checkpointIndex?: number | null;
        modelConfirmed?: boolean;
        branchConfirmed?: boolean;
    }): void {
        if (!Number.isFinite(input.eventMs) || input.eventMs < 0) { return; }
        const key = normalizeCacheTtlKeyStruct(input.key);
        const compositeKey = buildPromptCacheTtlKey(key);
        const scopeKey = this.conversationScopeKey(key);
        const measured = resolveMeasuredCacheReuse(input.measured);
        const hadWarmCache = measured.measuredCacheState === 'warm' || measured.measuredCacheState === 'partial'
            || safeNonNeg(input.measured?.cacheCreationTokens) > 0;

        const record: CacheTtlAnchorRecord = {
            key,
            lastEventMs: input.eventMs,
            lastEvaluatedNowMs: input.eventMs,
            checkpointIndex: typeof input.checkpointIndex === 'number' && Number.isFinite(input.checkpointIndex)
                ? input.checkpointIndex
                : null,
            hadWarmCache,
            modelConfirmed: input.modelConfirmed === true,
            branchConfirmed: input.branchConfirmed === true,
        };

        this.byCompositeKey.set(compositeKey, record);
        this.byConversationScope.set(scopeKey, record);

        if (this.byCompositeKey.size > this.maxEntries) {
            const oldestKey = this.byCompositeKey.keys().next().value;
            if (oldestKey !== undefined) {
                this.byCompositeKey.delete(oldestKey);
            }
        }
    }

    /** Evaluate current TTL state and possible miss causes for `{ account, backend, conversation, model, branch }`. */
    evaluate(input: {
        key: PromptCacheTtlKey;
        nowMs: number;
        measured?: PromptCacheMeasuredInput | null;
        transition?: PromptCacheTransitionEvidence | null;
        monotonicElapsedMs?: number | null;
        suspendResumeDetected?: boolean;
        warnSeconds?: number;
        expireSeconds?: number;
    }): PromptCacheTtlEvaluation {
        const key = normalizeCacheTtlKeyStruct(input.key);
        const compositeKey = buildPromptCacheTtlKey(key);
        const scopeKey = this.conversationScopeKey(key);
        const exactAnchor = this.byCompositeKey.get(compositeKey) ?? null;
        const convAnchor = this.byConversationScope.get(scopeKey) ?? null;
        const anchor = exactAnchor ?? convAnchor;

        const mergedTransition: PromptCacheTransitionEvidence = {
            ...(anchor ? {
                previousModel: anchor.key.model,
                currentModel: key.model,
                previousBranch: anchor.key.branch,
                currentBranch: key.branch,
                previousCheckpointIndex: anchor.checkpointIndex,
                hadPriorWarmCache: anchor.hadWarmCache,
            } : {}),
            ...(input.transition ?? {}),
        };

        const result = evaluatePromptCacheTtl({
            key,
            lastEventKey: anchor?.key ?? null,
            lastEventMs: anchor?.lastEventMs ?? null,
            nowMs: input.nowMs,
            previousNowMs: anchor?.lastEvaluatedNowMs ?? null,
            monotonicElapsedMs: input.monotonicElapsedMs,
            suspendResumeDetected: input.suspendResumeDetected,
            suspendGapThresholdMs: this.suspendGapThresholdMs,
            measured: input.measured,
            transition: mergedTransition,
            warnSeconds: input.warnSeconds,
            expireSeconds: input.expireSeconds,
        });

        if (result.clockAnomaly === 'clock_reversal') {
            this.byCompositeKey.delete(compositeKey);
            if (convAnchor === exactAnchor) {
                this.byConversationScope.delete(scopeKey);
            }
        } else if (exactAnchor && Number.isFinite(input.nowMs)) {
            exactAnchor.lastEvaluatedNowMs = input.nowMs;
        }

        return result;
    }

    reset(key?: Partial<PromptCacheTtlKey>): void {
        if (!key) {
            this.byCompositeKey.clear();
            this.byConversationScope.clear();
            return;
        }
        const fullKey = buildPromptCacheTtlKey(key);
        this.byCompositeKey.delete(fullKey);
    }
}

// ─── Pure GM Anomaly Classifier & Filter Helpers ─────────────────────────────

const TRUNCATED_STOP_REASON_RE = /(?:MAX_TOKENS|STOP_REASON_LENGTH|FINISH_REASON_LENGTH|TRUNCATED|\bLENGTH\b)/i;
const TRUNCATED_ERROR_TEXT_RE = /(?:exceeded\s+max\s+tokens|max[_\s-]?tokens\s+limit|output\s+truncated|response\s+truncated)/i;
const GRPC_NON_OK_CODE_MAP: ReadonlyArray<readonly [RegExp, number]> = [
    [/\bRESOURCE_EXHAUSTED\b/i, 429],
    [/\bUNAVAILABLE\b/i, 503],
    [/\bDEADLINE_EXCEEDED\b/i, 504],
    [/\bINTERNAL\b/i, 500],
    [/\bINVALID_ARGUMENT\b/i, 400],
    [/\bUNAUTHENTICATED\b/i, 401],
    [/\bPERMISSION_DENIED\b/i, 403],
    [/\bNOT_FOUND\b/i, 404],
];

function extractNon200HttpStatus(call: TelemetryCallInput): number | null {
    if (typeof call.httpStatusCode === 'number' && Number.isFinite(call.httpStatusCode)) {
        const code = Math.round(call.httpStatusCode);
        return code !== 200 && code >= 100 && code <= 599 ? code : null;
    }
    const messages = [call.errorMessage || '', ...(Array.isArray(call.retryErrors) ? call.retryErrors : [])];
    for (const raw of messages) {
        if (!raw) { continue; }
        const explicitCode = raw.match(/(?:\bcode\s*[:=]?\s*|\bHTTP\s*|\bstatus\s*[:=]?\s*)([45]\d{2})\b/i);
        if (explicitCode) {
            const parsed = Number.parseInt(explicitCode[1], 10);
            if (Number.isFinite(parsed) && parsed !== 200) { return parsed; }
        }
        for (const [re, status] of GRPC_NON_OK_CODE_MAP) {
            if (re.test(raw)) { return status; }
        }
    }
    return null;
}

function isTruncatedCall(call: TelemetryCallInput): boolean {
    if (call.stopReason && TRUNCATED_STOP_REASON_RE.test(call.stopReason)) {
        return true;
    }
    if (call.errorMessage && TRUNCATED_ERROR_TEXT_RE.test(call.errorMessage)) {
        return true;
    }
    if (Array.isArray(call.retryErrors) && call.retryErrors.some(e => TRUNCATED_ERROR_TEXT_RE.test(e))) {
        return true;
    }
    return false;
}

/**
 * Classify all telemetry anomalies present on a single GM call:
 * - `'error_or_retry'`: error flag, non-empty error message, or retries > 0
 * - `'slow_ttft'`: measured TTFT >= threshold (default 5.0s)
 * - `'cache_miss'`: provider-measured reuse < 10% on prompts >= minPromptTokens (never fires when cache telemetry is missing!)
 * - `'high_cost'`: resolved USD call cost >= threshold (default $0.25)
 * - `'high_context'`: context ratio >= 80% of window capacity OR tokens >= 200k
 * - `'non_200_or_truncated'`: non-200 HTTP/gRPC error status OR max-tokens/length truncation
 */
export function classifyGmCallAnomalies<T extends TelemetryCallInput>(
    call: T,
    thresholds: GmAnomalyThresholds = {},
): GmCallAnomalyMatch<T> {
    const slowTtftSeconds = typeof thresholds.slowTtftSeconds === 'number' && Number.isFinite(thresholds.slowTtftSeconds) && thresholds.slowTtftSeconds > 0
        ? thresholds.slowTtftSeconds
        : DEFAULT_GM_ANOMALY_THRESHOLDS.slowTtftSeconds;
    const cacheMissMaxReusePct = typeof thresholds.cacheMissMaxReusePct === 'number' && Number.isFinite(thresholds.cacheMissMaxReusePct) && thresholds.cacheMissMaxReusePct >= 0
        ? thresholds.cacheMissMaxReusePct
        : DEFAULT_GM_ANOMALY_THRESHOLDS.cacheMissMaxReusePct;
    const cacheMissMinPromptTokens = typeof thresholds.cacheMissMinPromptTokens === 'number' && Number.isFinite(thresholds.cacheMissMinPromptTokens) && thresholds.cacheMissMinPromptTokens >= 0
        ? thresholds.cacheMissMinPromptTokens
        : DEFAULT_GM_ANOMALY_THRESHOLDS.cacheMissMinPromptTokens;
    const highCostUsd = typeof thresholds.highCostUsd === 'number' && Number.isFinite(thresholds.highCostUsd) && thresholds.highCostUsd > 0
        ? thresholds.highCostUsd
        : DEFAULT_GM_ANOMALY_THRESHOLDS.highCostUsd;
    const highContextRatio = typeof thresholds.highContextRatio === 'number' && Number.isFinite(thresholds.highContextRatio) && thresholds.highContextRatio > 0
        ? thresholds.highContextRatio
        : DEFAULT_GM_ANOMALY_THRESHOLDS.highContextRatio;
    const highContextTokens = typeof thresholds.highContextTokens === 'number' && Number.isFinite(thresholds.highContextTokens) && thresholds.highContextTokens > 0
        ? thresholds.highContextTokens
        : DEFAULT_GM_ANOMALY_THRESHOLDS.highContextTokens;

    const point = computeCallTelemetry(
        call,
        thresholds.customPricing,
        undefined,
        thresholds.orchestratorPricingMode,
    );

    const anomalies: GmAnomalyKind[] = [];

    // 1. Error or retry
    const hasErrorOrRetry = call.hasError === true
        || (typeof call.errorMessage === 'string' && call.errorMessage.trim().length > 0)
        || safeNonNeg(call.retries) > 0
        || (Array.isArray(call.retryErrors) && call.retryErrors.length > 0);
    if (hasErrorOrRetry) {
        anomalies.push('error_or_retry');
    }

    // 2. Slow TTFT
    if (point.ttftSeconds !== null && point.ttftSeconds >= slowTtftSeconds) {
        anomalies.push('slow_ttft');
    }

    // 3. Cache miss / cold start (ONLY when provider cache telemetry is actually measured!)
    if (
        point.cacheTelemetryAvailable
        && point.totalPromptTokens >= cacheMissMinPromptTokens
        && point.measuredReusePct !== null
        && point.measuredReusePct < cacheMissMaxReusePct
    ) {
        anomalies.push('cache_miss');
    }

    // 4. High cost
    let estimatedCostUsd: number | null = null;
    if (typeof call.estimatedCost === 'number' && Number.isFinite(call.estimatedCost) && call.estimatedCost >= 0) {
        estimatedCostUsd = call.estimatedCost;
    } else {
        const pricing = resolvePricingForCall(call, thresholds.customPricing, thresholds.orchestratorPricingMode);
        if (pricing) {
            estimatedCostUsd = costFromTokens({
                inputTokens: point.inputTokens,
                outputTokens: point.outputTokens,
                thinkingTokens: point.thinkingTokens,
                cacheReadTokens: point.cacheReadTokens,
            }, pricing);
        }
    }
    if (estimatedCostUsd !== null && estimatedCostUsd >= highCostUsd) {
        anomalies.push('high_cost');
    }

    // 5. High context
    const ctxTokens = Math.max(safeNonNeg(call.contextTokensUsed), point.totalPromptTokens);
    const capacity = positiveOrNull(call.contextWindowCapacity);
    const contextUsageRatio = capacity !== null ? ctxTokens / capacity : null;
    if (
        (contextUsageRatio !== null && contextUsageRatio >= highContextRatio)
        || ctxTokens >= highContextTokens
    ) {
        anomalies.push('high_context');
    }

    // 6. Non-200 HTTP/gRPC status or truncated response
    const httpStatusCode = extractNon200HttpStatus(call);
    const truncated = isTruncatedCall(call);
    if (httpStatusCode !== null || truncated) {
        anomalies.push('non_200_or_truncated');
    }

    return {
        call,
        callId: point.callId,
        anomalies,
        estimatedCostUsd,
        contextUsageRatio,
        measuredReusePct: point.measuredReusePct,
        httpStatusCode,
        isTruncated: truncated,
    };
}

/**
 * Pure GM anomaly filter helper supporting filtering by any combination of anomaly kinds
 * (`'error_or_retry'`, `'slow_ttft'`, `'cache_miss'`, `'high_cost'`, `'high_context'`,
 * `'non_200_or_truncated'`) with full per-kind counts.
 */
export function filterGmAnomalies<T extends TelemetryCallInput>(
    calls: readonly T[],
    options: GmAnomalyFilterOptions = {},
): GmAnomalyFilterResult<T> {
    const excludeCompaction = options.excludeInternalCompaction === true;
    const inspected = excludeCompaction ? calls.filter(c => !isInternalCompactionCall(c)) : calls;
    const requestedKinds = Array.isArray(options.kinds) && options.kinds.length > 0
        ? new Set<GmAnomalyKind>(options.kinds)
        : null;
    const matchMode = options.matchMode === 'all' ? 'all' : 'any';

    const countsByKind: Record<GmAnomalyKind, number> = {
        error_or_retry: 0,
        slow_ttft: 0,
        cache_miss: 0,
        high_cost: 0,
        high_context: 0,
        non_200_or_truncated: 0,
    };

    const matches: GmCallAnomalyMatch<T>[] = [];
    for (const call of inspected) {
        const evaluated = classifyGmCallAnomalies(call, options);
        for (const kind of evaluated.anomalies) {
            countsByKind[kind] += 1;
        }
        if (evaluated.anomalies.length === 0) {
            continue;
        }
        if (!requestedKinds) {
            matches.push(evaluated);
            continue;
        }
        if (matchMode === 'all') {
            const hasAll = [...requestedKinds].every(k => evaluated.anomalies.includes(k));
            if (hasAll) {
                matches.push(evaluated);
            }
        } else {
            const hasAny = evaluated.anomalies.some(k => requestedKinds.has(k));
            if (hasAny) {
                matches.push(evaluated);
            }
        }
    }

    return {
        matches,
        totalInspected: inspected.length,
        matchedCount: matches.length,
        countsByKind,
    };
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

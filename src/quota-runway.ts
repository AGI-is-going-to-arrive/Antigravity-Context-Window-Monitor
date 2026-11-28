// ─── Pure Quota Runway Predictor, Custom-Model Isolation & Stale Cache Guard ─
// Tracks rolling 45-minute quota burn rates per pool with jitter filtering,
// automatic recovery/reset-turnover detection, custom/BYOK model isolation,
// and transient-RPC stale-cache preservation.
//
// Zero VS Code, DOM, or external npm dependencies.

// ─── Constants ───────────────────────────────────────────────────────────────

/** Rolling observation window for burn-rate calculation (45 minutes). */
export const RUNWAY_WINDOW_MS = 45 * 60 * 1000;

/** Fraction deltas smaller than 0.001 (0.1%) are treated as telemetry jitter. */
export const JITTER_EPSILON = 0.001;

/** Upward jump >= +5% resets burn-rate history as a quota recovery. */
export const RECOVERY_JUMP_FRACTION = 0.05;

/** Crossing upward into >= 90% resets burn-rate history as a quota recovery. */
export const RECOVERY_HIGH_THRESHOLD = 0.90;

/** Reset timestamp shift > 60s forward indicates a new quota reset cycle. */
export const RESET_ROLLOVER_TOLERANCE_MS = 60 * 1000;

/** Minimum time span between observations before reporting a burn rate (10 seconds). */
export const DEFAULT_MIN_SPAN_MS = 10 * 1000;

/** How long `recoveredRecently` stays true after a quota recovery event (15 minutes). */
export const DEFAULT_RECOVERY_NOTICE_MS = 15 * 60 * 1000;

/** Safety cap on stored samples per pool to keep serialized state compact. */
export const MAX_SAMPLES_PER_POOL = 200;

/** Default weekly active-hours lookback window (7 days). */
export const WEEKLY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounded maximum UTC hourly buckets retained per weekly series (14 days = 336 hours). */
export const MAX_WEEKLY_HOURLY_BUCKETS = 336;

/** Bounded maximum weekly series retained across accounts/pools/windows/reset epochs. */
export const MAX_WEEKLY_SERIES = 64;

/** Default gap between consecutive observations treated as an offline gap rather than active usage (2 hours). */
export const DEFAULT_OFFLINE_GAP_MS = 2 * 60 * 60 * 1000;

/** Default minimum active hours required before reporting weekly active-hours forecast. */
export const DEFAULT_MIN_WEEKLY_ACTIVE_HOURS = 2;

/** Default minimum distinct local calendar days with user activity required for weekly forecast. */
export const DEFAULT_MIN_WEEKLY_ACTIVE_DAYS = 2;

/** Default minimum wall-clock observation span (hours) required for weekly forecast. */
export const DEFAULT_MIN_WEEKLY_SPAN_HOURS = 24;

// ─── Types ───────────────────────────────────────────────────────────────────

export type QuotaRunwayStatus =
    | 'safe_until_reset'
    | 'at_risk'
    | 'exhausted'
    | 'insufficient_data'
    | 'insufficient_history'
    | 'custom_model_isolated';

export type QuotaHorizonWindow = '5h' | '7d';
export type QuotaWindowMode = '5h' | '7d' | 'tightest';
export type QuotaDirectionMode = 'remaining' | 'used';

/** Optional timezone offset resolver returning minutes (matching `Date.prototype.getTimezoneOffset()`). */
export type TimezoneOffsetResolver = (timestampMs: number) => number;

export interface WeeklyQuotaBucketKey {
    account: string;
    pool: string;
    window: QuotaHorizonWindow;
    /** Reset cycle UTC timestamp (ms), or `0` when unknown. */
    resetEpoch: number;
}

export interface HourlyQuotaObservationBucket {
    /** DST-safe physical UTC hour index (`Math.floor(timestampMs / 3_600_000)`). */
    hourEpoch: number;
    /** Local calendar date (`'YYYY-MM-DD'`) at this hour's start. */
    localDateKey: string;
    firstTimestampMs: number;
    lastTimestampMs: number;
    /** Highest remaining fraction observed before drops in this hour bucket. */
    startFraction: number;
    /** Lowest / latest remaining fraction observed in this hour bucket. */
    endFraction: number;
    /** Cumulative deduplicated quota drop fraction consumed during this hour. */
    burnFraction: number;
    /** Verified active usage duration (ms) within this hour (capped at `3_600_000`). */
    activeMs: number;
    /** True iff user-activity evidence was recorded in this hour (prevents idle hours distorting active burn rate). */
    hasUserActivity: boolean;
    /** Count of deduplicated observations recorded in this hour. */
    observationCount: number;
    /** Contributing surfaces (e.g. `['app', 'ide']`). */
    surfaces: string[];
    /** True when a fractional quota reset/recovery occurred in this hour bucket. */
    hadFractionalReset?: boolean;
    /** Quota drop observed across an offline gap (unknown active duration; excluded from active burn rate). */
    offlineBurnFraction?: number;
}

export interface DailyQuotaObservationSummary {
    localDateKey: string;
    /** Physical length of this local calendar day in hours (`23` spring-forward DST, `24` normal, `25` fall-back DST). */
    dayDurationHours: number;
    /** Verified active usage duration on this local day (hours). */
    activeHours: number;
    /** Distinct UTC hour buckets with verified user activity on this day. */
    activeHourBuckets: number;
    /** Total deduplicated quota fraction burned on this local day. */
    burnFraction: number;
    /** Distinct UTC hour buckets observed (active or idle). */
    observedHours: number;
    fractionalResetCount: number;
}

export interface WeeklyQuotaSeriesState {
    key: WeeklyQuotaBucketKey;
    seriesKey: string;
    buckets: HourlyQuotaObservationBucket[];
    lastObservedAtMs: number | null;
    lastFraction: number | null;
    lastResetTimeMs: number | null;
    offlineGapCount: number;
    offlineGapMs: number;
    fractionalResetCount: number;
}

export interface WeeklyQuotaObservationInput {
    account?: string;
    pool: string;
    window: QuotaHorizonWindow;
    remainingFraction: number;
    timestampMs: number;
    resetTimeMs?: number | null;
    /** Explicit user-activity evidence (e.g., GM call or step activity). Genuine drop >= jitter also proves activity. */
    userActivityEvidence?: boolean;
    /** Origin surface (`'app' | 'ide' | 'cli' | 'unknown'`) for cross-host deduplication tracking. */
    surface?: string;
    /** Optional timezone offset resolver for deterministic DST handling across timezones. */
    tzOffsetResolver?: TimezoneOffsetResolver;
}

export interface WeeklyQuotaCoverage {
    activeHours: number;
    activeHourBuckets: number;
    activeDays: number;
    observedSpanHours: number;
    minActiveHours: number;
    minActiveDays: number;
    minSpanHours: number;
    meetsThreshold: boolean;
}

export interface WeeklyQuotaRunwayEstimate {
    account: string;
    pool: string;
    window: QuotaHorizonWindow;
    resetEpoch: number;
    status: QuotaRunwayStatus;
    /** Burn rate in quota % per verified active hour (never diluted by idle or offline hours). */
    burnRatePctPerActiveHour: number | null;
    /** Average verified active hours per active local day. */
    avgActiveHoursPerDay: number | null;
    /** Projected daily burn in quota % (`burnRatePctPerActiveHour * avgActiveHoursPerDay`). */
    projectedDailyBurnPct: number | null;
    /** Estimated remaining active hours until exhaustion at active burn rate. */
    estRemainingActiveHours: number | null;
    /** Estimated wall-clock ms until exhaustion paced at `avgActiveHoursPerDay`. */
    estExhaustMs: number | null;
    timeToResetMs: number | null;
    latestRemainingFraction: number | null;
    coverage: WeeklyQuotaCoverage;
    dailySummaries: DailyQuotaObservationSummary[];
    offlineGapCount: number;
    fractionalResetCount: number;
    /** Distinct reset epochs aggregated within the lookback window. */
    epochsConsidered: number;
}

export interface WeeklyEstimateOptions extends QuotaEstimateOptions {
    /** Lookback window in ms (default 7 days). */
    lookbackMs?: number;
    minActiveHours?: number;
    minActiveDays?: number;
    minSpanHours?: number;
    /** If set, restrict estimate strictly to this `resetEpoch` instead of aggregating epochs across the weekly lookback. */
    resetEpoch?: number;
    tzOffsetResolver?: TimezoneOffsetResolver;
}

export interface QuotaWindowReading {
    /** Remaining fraction in `[0, 1]`, or `null`/`undefined` when unavailable. */
    remainingFraction: number | null | undefined;
    resetTimeMs?: number | null;
}

export interface QuotaDisplayProjectionInput {
    windowMode: QuotaWindowMode;
    directionMode: QuotaDirectionMode;
    window5h?: QuotaWindowReading | null;
    window7d?: QuotaWindowReading | null;
    nowMs?: number;
}

export interface QuotaDisplayProjection {
    requestedWindowMode: QuotaWindowMode;
    effectiveWindow: QuotaHorizonWindow | null;
    selectedByTightest: boolean;
    directionMode: QuotaDirectionMode;
    remainingPct: number | null;
    usedPct: number | null;
    displayPct: number | null;
    resetTimeMs: number | null;
    timeToResetMs: number | null;
    windowTag: QuotaHorizonWindow | null;
    directionLabelEn: 'Remaining' | 'Used';
    directionLabelZh: '剩余' | '已用';
    windowLabelEn: '5-hour quota' | 'Weekly quota' | 'Quota';
    windowLabelZh: '5 小时配额' | '每周配额' | '配额';
    metricLabelEn: string;
    metricLabelZh: string;
    isUnavailable: boolean;
}

export interface QuotaRunwayEstimate {
    poolKey: string;
    status: QuotaRunwayStatus;
    burnRatePctPerHour: number | null;
    estExhaustMs: number | null;
    timeToResetMs: number | null;
    recoveredRecently: boolean;
}

export interface QuotaSample {
    remainingFraction: number;
    timestampMs: number;
    resetTimeMs: number | null;
}

export interface QuotaPoolHistory {
    poolKey: string;
    samples: QuotaSample[];
    lastObservedAtMs: number | null;
    lastResetTimeMs: number | null;
    recoveredAtMs: number | null;
}

export interface SerializedQuotaRunwayState {
    version: 1;
    pools: Record<string, QuotaPoolHistory>;
    /** Bounded hourly active-usage buckets keyed by `{ account, pool, window, resetEpoch }` (optional for v1 compat). */
    weeklyBuckets?: Record<string, WeeklyQuotaSeriesState>;
}

export interface QuotaRunwayTrackerOptions {
    windowMs?: number;
    jitterEpsilon?: number;
    recoveryJumpFraction?: number;
    recoveryHighThreshold?: number;
    resetRolloverToleranceMs?: number;
    minSpanMs?: number;
    recoveryNoticeMs?: number;
    maxSamplesPerPool?: number;
    maxWeeklyHourlyBuckets?: number;
    maxWeeklySeries?: number;
    offlineGapThresholdMs?: number;
    minWeeklyActiveHours?: number;
    minWeeklyActiveDays?: number;
    minWeeklySpanHours?: number;
    tzOffsetResolver?: TimezoneOffsetResolver;
}

export interface QuotaEstimateOptions {
    modelId?: string;
    modelLabel?: string;
    isCustomModel?: boolean;
}

export interface StaleCacheSnapshot<T> {
    data: T | null;
    isStale: boolean;
    lastSuccessAtMs: number | null;
    consecutiveFailures: number;
    lastError: string | null;
}

export interface StaleCacheGuardOptions {
    /** Optional max age (ms) after which cached data is considered stale even without errors. */
    maxAgeMs?: number;
}

// ─── Custom / BYOK / Local Model Detection ───────────────────────────────────

const CUSTOM_MODEL_ID_PATTERNS: readonly RegExp[] = [
    /^custom[-_:/]/i,
    /^model_custom(?:[-_]|$)/i,
    /^byok[-_:/]/i,
    /^(?:ollama|lmstudio|lm-studio|vllm|llamacpp|llama\.cpp|litellm|local|localhost|self[-_]?hosted|openai[-_]?compatible)[-_:/]/i,
    /^openrouter\//i,
];

const BUILTIN_MODEL_ID_PATTERNS: readonly RegExp[] = [
    /^MODEL_PLACEHOLDER_M\d+$/i,
    /^MODEL_OPENAI_GPT_OSS_/i,
    /^MODEL_GOOGLE_/i,
    /^MODEL_ANTHROPIC_/i,
    /^MODEL_CLAUDE_/i,
];

const CUSTOM_LABEL_PATTERNS: readonly RegExp[] = [
    /\bbyok\b/i,
    /(?:^|[\s([{-])custom\s+model\b/i,
    /^custom\s*:/i,
    /(?:\(|\[)\s*(?:custom|byok|local)\s*(?:\)|\])/i,
    /\b(?:ollama|lm\s*studio|vllm|local\s+model|self[- ]hosted)\b/i,
];

const ORCHESTRATOR_LABEL_PATTERN = /\b(?:orchestrator|编排器|协调器)\b/i;

/**
 * Detect whether a model is a `custom-*` / BYOK / local non-Google model whose
 * activity does NOT consume Antigravity Google quota pools.
 *
 * Carefully avoids false positives on built-in Antigravity models (including
 * `"Orchestrator (Custom)"` custom planner/executor pairs).
 */
export function isCustomModel(modelId?: string, label?: string): boolean {
    const cleanId = (modelId || '').trim();
    const cleanLabel = (label || '').trim();

    if (cleanId) {
        if (CUSTOM_MODEL_ID_PATTERNS.some(re => re.test(cleanId))) {
            return true;
        }
        if (BUILTIN_MODEL_ID_PATTERNS.some(re => re.test(cleanId))) {
            // Built-in placeholder IDs are Google-hosted unless explicitly tagged BYOK
            return /\bbyok\b/i.test(cleanLabel);
        }
    }

    if (cleanLabel) {
        // Antigravity's built-in Orchestrator allows a "Custom" planner/executor pair
        // that still runs on Google quota pools — do not misclassify as BYOK.
        if (ORCHESTRATOR_LABEL_PATTERN.test(cleanLabel) && !/\bbyok\b/i.test(cleanLabel)) {
            return false;
        }
        if (CUSTOM_LABEL_PATTERNS.some(re => re.test(cleanLabel))) {
            return true;
        }
    }

    return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(value: number): number {
    if (!Number.isFinite(value)) { return 0; }
    if (value <= 0) { return 0; }
    if (value >= 1) { return 1; }
    return value;
}

function normalizeResetMs(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : null;
}

function round2(value: number): number {
    if (!Number.isFinite(value)) { return 0; }
    return Math.round(value * 100) / 100;
}

const HOUR_MS = 3_600_000;

function normalizeWeeklyAccount(account?: string | null): string {
    const clean = typeof account === 'string' ? account.trim().toLowerCase() : '';
    return clean || 'default';
}

function normalizeWeeklyPool(pool?: string | null): string {
    return typeof pool === 'string' ? pool.trim() : '';
}

function normalizeWeeklyWindow(window?: string | null): QuotaHorizonWindow {
    return window === '7d' ? '7d' : '5h';
}

function normalizeSurfaceTag(surface?: string | null): string | null {
    if (typeof surface !== 'string') { return null; }
    const clean = surface.trim().toLowerCase();
    return clean || null;
}

/** Build deterministic composite key `{ account, pool, window, resetEpoch }`. */
export function buildWeeklyQuotaSeriesKey(key: WeeklyQuotaBucketKey): string {
    return [
        normalizeWeeklyAccount(key.account),
        normalizeWeeklyPool(key.pool),
        normalizeWeeklyWindow(key.window),
        String(Number.isFinite(key.resetEpoch) && key.resetEpoch > 0 ? Math.round(key.resetEpoch) : 0),
    ].join('|');
}

/** Format a UTC timestamp into local `'YYYY-MM-DD'`, supporting optional injectable timezone offsets for DST testing. */
export function formatLocalDateKeyForTz(
    timestampMs: number,
    tzOffsetResolver?: TimezoneOffsetResolver,
): string {
    if (!tzOffsetResolver) {
        const d = new Date(timestampMs);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const offsetMin = tzOffsetResolver(timestampMs);
    const localMs = timestampMs - offsetMin * 60_000;
    const d = new Date(localMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Compute the physical length of a local calendar day in hours (`23` on spring-forward DST,
 * `24` on standard days, `25` on fall-back DST).
 */
export function getLocalDayDurationHours(
    localDateKey: string,
    tzOffsetResolver?: TimezoneOffsetResolver,
): number {
    const parts = localDateKey.split('-');
    if (parts.length !== 3) { return 24; }
    const y = Number.parseInt(parts[0], 10);
    const m = Number.parseInt(parts[1], 10);
    const d = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) { return 24; }

    if (!tzOffsetResolver) {
        const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
        const next = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
        const hours = Math.round((next - start) / HOUR_MS);
        return Number.isFinite(hours) && hours > 0 ? hours : 24;
    }

    const resolveMidnightUtc = (yy: number, mm: number, dd: number): number => {
        const nominal = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
        let guess = nominal + tzOffsetResolver(nominal) * 60_000;
        guess = nominal + tzOffsetResolver(guess) * 60_000;
        return guess;
    };
    const startUtc = resolveMidnightUtc(y, m, d);
    const nextDate = new Date(Date.UTC(y, m - 1, d + 1));
    const nextUtc = resolveMidnightUtc(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth() + 1,
        nextDate.getUTCDate(),
    );
    const hours = Math.round((nextUtc - startUtc) / HOUR_MS);
    return Number.isFinite(hours) && hours > 0 ? hours : 24;
}

function validFractionOrNull(value: number | null | undefined): number | null {
    return typeof value === 'number' && value >= 0 && value <= 1 ? value : null;
}

/**
 * Project quota percentage and explicit window/direction metadata for:
 * - `windowMode: '5h' | '7d' | 'tightest'`
 * - `directionMode: 'remaining' | 'used'`
 *
 * Preserves unavailable/unknown readings cleanly as `null` (NEVER fabricates 100% or 0%).
 */
export function projectQuotaDisplay(input: QuotaDisplayProjectionInput): QuotaDisplayProjection {
    const windowMode: QuotaWindowMode = input.windowMode === '5h' || input.windowMode === '7d' || input.windowMode === 'tightest'
        ? input.windowMode
        : 'tightest';
    const directionMode: QuotaDirectionMode = input.directionMode === 'used' ? 'used' : 'remaining';
    const directionLabelEn: 'Remaining' | 'Used' = directionMode === 'used' ? 'Used' : 'Remaining';
    const directionLabelZh: '剩余' | '已用' = directionMode === 'used' ? '已用' : '剩余';

    const f5h = validFractionOrNull(input.window5h?.remainingFraction);
    const f7d = validFractionOrNull(input.window7d?.remainingFraction);
    const r5h = normalizeResetMs(input.window5h?.resetTimeMs);
    const r7d = normalizeResetMs(input.window7d?.resetTimeMs);

    let effectiveWindow: QuotaHorizonWindow | null = null;
    let selectedByTightest = false;
    let chosenFraction: number | null = null;
    let resetTimeMs: number | null = null;

    if (windowMode === '5h') {
        if (f5h !== null) {
            effectiveWindow = '5h';
            chosenFraction = f5h;
            resetTimeMs = r5h;
        }
    } else if (windowMode === '7d') {
        if (f7d !== null) {
            effectiveWindow = '7d';
            chosenFraction = f7d;
            resetTimeMs = r7d;
        }
    } else {
        // 'tightest': pick whichever valid window has the lower remaining fraction (higher used %); tie-break prefers '5h'
        if (f5h !== null && f7d !== null) {
            selectedByTightest = true;
            if (f7d < f5h) {
                effectiveWindow = '7d';
                chosenFraction = f7d;
                resetTimeMs = r7d;
            } else {
                effectiveWindow = '5h';
                chosenFraction = f5h;
                resetTimeMs = r5h;
            }
        } else if (f5h !== null) {
            effectiveWindow = '5h';
            chosenFraction = f5h;
            resetTimeMs = r5h;
        } else if (f7d !== null) {
            effectiveWindow = '7d';
            chosenFraction = f7d;
            resetTimeMs = r7d;
        }
    }

    const remainingPct = chosenFraction !== null ? round2(chosenFraction * 100) : null;
    const usedPct = remainingPct !== null ? round2(Math.max(0, 100 - remainingPct)) : null;
    const displayPct = remainingPct === null
        ? null
        : (directionMode === 'used' ? usedPct : remainingPct);

    const refNowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? Math.round(input.nowMs) : null;
    const timeToResetMs = resetTimeMs !== null && refNowMs !== null
        ? Math.max(0, resetTimeMs - refNowMs)
        : null;

    const window = effectiveWindow ?? (windowMode === 'tightest' ? null : windowMode);
    const windowLabelEn = window === '5h' ? '5-hour quota' : window === '7d' ? 'Weekly quota' : 'Quota';
    const windowLabelZh = window === '5h' ? '5 小时配额' : window === '7d' ? '每周配额' : '配额';

    return {
        requestedWindowMode: windowMode,
        effectiveWindow,
        selectedByTightest,
        directionMode,
        remainingPct,
        usedPct,
        displayPct,
        resetTimeMs,
        timeToResetMs,
        windowTag: effectiveWindow,
        directionLabelEn,
        directionLabelZh,
        windowLabelEn,
        windowLabelZh,
        metricLabelEn: chosenFraction === null ? `${windowLabelEn} unavailable` : `${windowLabelEn} ${directionLabelEn.toLowerCase()}`,
        metricLabelZh: chosenFraction === null ? `${windowLabelZh}暂无数据` : `${windowLabelZh}${directionLabelZh}`,
        isUnavailable: chosenFraction === null,
    };
}

function mergeHourlyBucketsDedup(
    a: HourlyQuotaObservationBucket,
    b: HourlyQuotaObservationBucket,
): HourlyQuotaObservationBucket {
    const startFraction = Math.max(a.startFraction, b.startFraction);
    const endFraction = Math.min(a.endFraction, b.endFraction);
    const hadFractionalReset = Boolean(a.hadFractionalReset || b.hadFractionalReset);
    const offlineBurnFraction = Math.max(a.offlineBurnFraction ?? 0, b.offlineBurnFraction ?? 0);
    const hadOfflineBurn = offlineBurnFraction > 0;
    const envelopeDrop = Math.max(0, startFraction - endFraction);
    const burnFraction = (hadFractionalReset || hadOfflineBurn)
        ? Math.max(a.burnFraction, b.burnFraction)
        : Math.max(a.burnFraction, b.burnFraction, envelopeDrop);
    const activeMs = Math.min(HOUR_MS, Math.max(a.activeMs, b.activeMs));
    const surfaces = [...new Set([...(a.surfaces || []), ...(b.surfaces || [])])].sort();
    return {
        hourEpoch: a.hourEpoch,
        localDateKey: a.localDateKey || b.localDateKey,
        firstTimestampMs: Math.min(a.firstTimestampMs, b.firstTimestampMs),
        lastTimestampMs: Math.max(a.lastTimestampMs, b.lastTimestampMs),
        startFraction,
        endFraction,
        burnFraction,
        activeMs,
        hasUserActivity: Boolean(a.hasUserActivity || b.hasUserActivity),
        observationCount: Math.max(a.observationCount, b.observationCount),
        surfaces,
        ...(hadFractionalReset ? { hadFractionalReset: true } : {}),
        ...(hadOfflineBurn ? { offlineBurnFraction } : {}),
    };
}

function cloneHourlyBucket(b: HourlyQuotaObservationBucket): HourlyQuotaObservationBucket {
    return {
        ...b,
        surfaces: [...(b.surfaces || [])],
    };
}

function cloneWeeklySeries(series: WeeklyQuotaSeriesState): WeeklyQuotaSeriesState {
    return {
        key: { ...series.key },
        seriesKey: series.seriesKey,
        buckets: series.buckets.map(cloneHourlyBucket),
        lastObservedAtMs: series.lastObservedAtMs,
        lastFraction: series.lastFraction,
        lastResetTimeMs: series.lastResetTimeMs,
        offlineGapCount: series.offlineGapCount,
        offlineGapMs: series.offlineGapMs,
        fractionalResetCount: series.fractionalResetCount,
    };
}

function mergeWeeklySeriesStates(
    a: WeeklyQuotaSeriesState,
    b: WeeklyQuotaSeriesState,
    maxBuckets: number,
): WeeklyQuotaSeriesState {
    const byHour = new Map<number, HourlyQuotaObservationBucket>();
    for (const bucket of a.buckets) {
        byHour.set(bucket.hourEpoch, cloneHourlyBucket(bucket));
    }
    for (const bucket of b.buckets) {
        const existing = byHour.get(bucket.hourEpoch);
        if (!existing) {
            byHour.set(bucket.hourEpoch, cloneHourlyBucket(bucket));
        } else {
            byHour.set(bucket.hourEpoch, mergeHourlyBucketsDedup(existing, bucket));
        }
    }
    let buckets = [...byHour.values()].sort((x, y) => x.hourEpoch - y.hourEpoch);
    if (buckets.length > maxBuckets) {
        buckets = buckets.slice(buckets.length - maxBuckets);
    }

    const aObs = a.lastObservedAtMs ?? -1;
    const bObs = b.lastObservedAtMs ?? -1;
    const lastObservedAtMs = Math.max(aObs, bObs) >= 0 ? Math.max(aObs, bObs) : null;
    let lastFraction: number | null;
    if (aObs > bObs) {
        lastFraction = a.lastFraction;
    } else if (bObs > aObs) {
        lastFraction = b.lastFraction;
    } else if (a.lastFraction !== null && b.lastFraction !== null) {
        lastFraction = Math.min(a.lastFraction, b.lastFraction);
    } else {
        lastFraction = a.lastFraction ?? b.lastFraction;
    }

    const lastResetTimeMs = a.lastResetTimeMs !== null && b.lastResetTimeMs !== null
        ? Math.max(a.lastResetTimeMs, b.lastResetTimeMs)
        : (a.lastResetTimeMs ?? b.lastResetTimeMs);

    const latestBucket = buckets.length > 0 ? buckets[buckets.length - 1] : null;
    if (latestBucket && lastFraction !== null && !latestBucket.hadFractionalReset && lastFraction > latestBucket.endFraction) {
        lastFraction = latestBucket.endFraction;
    }

    return {
        key: { ...a.key },
        seriesKey: a.seriesKey,
        buckets,
        lastObservedAtMs,
        lastFraction,
        lastResetTimeMs,
        offlineGapCount: Math.max(a.offlineGapCount, b.offlineGapCount),
        offlineGapMs: Math.max(a.offlineGapMs, b.offlineGapMs),
        fractionalResetCount: Math.max(a.fractionalResetCount, b.fractionalResetCount),
    };
}

/**
 * Pure idempotent multi-host (App + IDE) merger for {@link SerializedQuotaRunwayState}.
 * Deduplicates overlapping hourly observations within each `{ account, pool, window, resetEpoch }`
 * series so concurrent App + IDE polls NEVER double-count quota burn or active hours.
 */
export function mergeSerializedQuotaRunwayStates(
    first: SerializedQuotaRunwayState | null | undefined,
    second: SerializedQuotaRunwayState | null | undefined,
    options: QuotaRunwayTrackerOptions = {},
): SerializedQuotaRunwayState {
    const t1 = QuotaRunwayTracker.deserialize(first, options);
    const t2 = QuotaRunwayTracker.deserialize(second, options);
    t1.mergeFrom(t2);
    return t1.serialize();
}

function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name || 'Unknown error';
    }
    if (typeof error === 'string') {
        return error.trim() || 'Unknown error';
    }
    if (error !== null && typeof error === 'object' && 'message' in error) {
        const msg = (error as { message?: unknown }).message;
        if (typeof msg === 'string' && msg.trim()) {
            return msg.trim();
        }
    }
    return String(error ?? 'Unknown error');
}

// ─── QuotaRunwayTracker ──────────────────────────────────────────────────────

/**
 * Pure, serializable rolling-window tracker that estimates per-pool quota burn
 * rate and time-to-exhaustion vs reset countdown.
 */
export class QuotaRunwayTracker {
    private readonly windowMs: number;
    private readonly jitterEpsilon: number;
    private readonly recoveryJumpFraction: number;
    private readonly recoveryHighThreshold: number;
    private readonly resetRolloverToleranceMs: number;
    private readonly minSpanMs: number;
    private readonly recoveryNoticeMs: number;
    private readonly maxSamplesPerPool: number;
    private readonly maxWeeklyHourlyBuckets: number;
    private readonly maxWeeklySeries: number;
    private readonly offlineGapThresholdMs: number;
    private readonly minWeeklyActiveHours: number;
    private readonly minWeeklyActiveDays: number;
    private readonly minWeeklySpanHours: number;
    private readonly tzOffsetResolver?: TimezoneOffsetResolver;
    private readonly pools = new Map<string, QuotaPoolHistory>();
    private readonly weeklySeries = new Map<string, WeeklyQuotaSeriesState>();

    constructor(options: QuotaRunwayTrackerOptions = {}) {
        const opt = (v: number | undefined, ok: boolean, def: number, round = false) =>
            v !== undefined && ok ? (round ? Math.round(v) : v) : def;
        this.windowMs = opt(options.windowMs, (options.windowMs ?? 0) > 0, RUNWAY_WINDOW_MS);
        this.jitterEpsilon = opt(options.jitterEpsilon, (options.jitterEpsilon ?? -1) >= 0, JITTER_EPSILON);
        this.recoveryJumpFraction = opt(options.recoveryJumpFraction, (options.recoveryJumpFraction ?? 0) > 0, RECOVERY_JUMP_FRACTION);
        this.recoveryHighThreshold = opt(options.recoveryHighThreshold, (options.recoveryHighThreshold ?? 0) > 0, RECOVERY_HIGH_THRESHOLD);
        this.resetRolloverToleranceMs = opt(options.resetRolloverToleranceMs, (options.resetRolloverToleranceMs ?? -1) >= 0, RESET_ROLLOVER_TOLERANCE_MS);
        this.minSpanMs = opt(options.minSpanMs, (options.minSpanMs ?? -1) >= 0, DEFAULT_MIN_SPAN_MS);
        this.recoveryNoticeMs = opt(options.recoveryNoticeMs, (options.recoveryNoticeMs ?? -1) >= 0, DEFAULT_RECOVERY_NOTICE_MS);
        this.maxSamplesPerPool = opt(options.maxSamplesPerPool, (options.maxSamplesPerPool ?? 0) >= 2, MAX_SAMPLES_PER_POOL, true);
        this.maxWeeklyHourlyBuckets = opt(options.maxWeeklyHourlyBuckets, (options.maxWeeklyHourlyBuckets ?? 0) >= 24, MAX_WEEKLY_HOURLY_BUCKETS, true);
        this.maxWeeklySeries = opt(options.maxWeeklySeries, (options.maxWeeklySeries ?? 0) >= 1, MAX_WEEKLY_SERIES, true);
        this.offlineGapThresholdMs = opt(options.offlineGapThresholdMs, (options.offlineGapThresholdMs ?? 0) > 0, DEFAULT_OFFLINE_GAP_MS, true);
        this.minWeeklyActiveHours = opt(options.minWeeklyActiveHours, (options.minWeeklyActiveHours ?? 0) > 0, DEFAULT_MIN_WEEKLY_ACTIVE_HOURS);
        this.minWeeklyActiveDays = opt(options.minWeeklyActiveDays, (options.minWeeklyActiveDays ?? 0) >= 1, DEFAULT_MIN_WEEKLY_ACTIVE_DAYS, true);
        this.minWeeklySpanHours = opt(options.minWeeklySpanHours, (options.minWeeklySpanHours ?? -1) >= 0, DEFAULT_MIN_WEEKLY_SPAN_HOURS);
        this.tzOffsetResolver = options.tzOffsetResolver;
    }

    /**
     * Record a quota observation for a pool.
     *
     * - Filters `<0.001` (`0.1%`) jitter without losing cumulative drift or steady-state span.
     * - Resets burn-rate history cleanly on quota recovery (`>= +5%` jump or crossed up to `>= 90%`)
     *   or when `resetTimeMs` rolls forward into a new reset cycle.
     */
    record(
        poolKey: string,
        remainingFraction: number,
        timestampMs: number,
        resetTimeMs?: number | null,
    ): void {
        const key = (poolKey || '').trim();
        if (!key) { return; }
        if (!Number.isFinite(remainingFraction) || !Number.isFinite(timestampMs) || timestampMs < 0) {
            return;
        }

        const fraction = clamp01(remainingFraction);
        const ts = Math.round(timestampMs);
        const resetMs = normalizeResetMs(resetTimeMs);

        const existing = this.pools.get(key);
        if (!existing || existing.samples.length === 0) {
            this.pools.set(key, {
                poolKey: key,
                samples: [{ remainingFraction: fraction, timestampMs: ts, resetTimeMs: resetMs }],
                lastObservedAtMs: ts,
                lastResetTimeMs: resetMs,
                recoveredAtMs: null,
            });
            return;
        }

        const latest = existing.samples[existing.samples.length - 1];

        // Ignore out-of-order stale timestamps older than already recorded data
        if (ts < latest.timestampMs || (existing.lastObservedAtMs !== null && ts < existing.lastObservedAtMs)) {
            return;
        }

        const prevResetMs = existing.lastResetTimeMs;
        const resetRolledForward = prevResetMs !== null
            && resetMs !== null
            && (resetMs - prevResetMs) > this.resetRolloverToleranceMs;

        const delta = fraction - latest.remainingFraction;
        const jumpedUp = delta >= this.recoveryJumpFraction;
        const crossedRecoveryCeiling = latest.remainingFraction < this.recoveryHighThreshold
            && fraction >= this.recoveryHighThreshold
            && delta >= this.jitterEpsilon;

        if (resetRolledForward || jumpedUp || crossedRecoveryCeiling) {
            const recovered = jumpedUp || crossedRecoveryCeiling
                || (resetRolledForward && (delta > this.jitterEpsilon || fraction >= this.recoveryHighThreshold));
            existing.samples = [{ remainingFraction: fraction, timestampMs: ts, resetTimeMs: resetMs }];
            existing.lastObservedAtMs = ts;
            existing.lastResetTimeMs = resetMs ?? existing.lastResetTimeMs;
            if (recovered) {
                existing.recoveredAtMs = ts;
            }
            return;
        }

        if (resetMs !== null) {
            existing.lastResetTimeMs = resetMs;
        }
        existing.lastObservedAtMs = ts;

        // Filter <0.1% jitter relative to the latest significant anchor sample
        if (Math.abs(delta) < this.jitterEpsilon) {
            // Prune expired samples only if we still retain the current anchor
            this.prunePool(existing, ts);
            return;
        }

        // Same timestamp update replaces latest sample to avoid zero-duration spikes
        if (ts === latest.timestampMs) {
            existing.samples[existing.samples.length - 1] = {
                remainingFraction: fraction,
                timestampMs: ts,
                resetTimeMs: resetMs ?? latest.resetTimeMs,
            };
        } else {
            existing.samples.push({
                remainingFraction: fraction,
                timestampMs: ts,
                resetTimeMs: resetMs ?? latest.resetTimeMs,
            });
        }

        this.prunePool(existing, ts);
    }

    /**
     * Compute the current runway estimate for a quota pool.
     */
    estimate(
        poolKey: string,
        nowMs?: number,
        options: QuotaEstimateOptions = {},
    ): QuotaRunwayEstimate {
        const key = (poolKey || '').trim();
        const est = (status: QuotaRunwayEstimate['status'], burnRatePctPerHour: number | null = null, estExhaustMs: number | null = null, timeToResetMs: number | null = null, recoveredRecently = false): QuotaRunwayEstimate =>
            ({ poolKey: key, status, burnRatePctPerHour, estExhaustMs, timeToResetMs, recoveredRecently });
        if (options.isCustomModel || isCustomModel(options.modelId, options.modelLabel)) {
            return est('custom_model_isolated');
        }

        const history = this.pools.get(key);
        if (!history || history.samples.length === 0) {
            return est('insufficient_data');
        }

        const latest = history.samples[history.samples.length - 1];
        const refNowMs = typeof nowMs === 'number' && Number.isFinite(nowMs)
            ? Math.round(nowMs)
            : (history.lastObservedAtMs ?? latest.timestampMs);

        const resetMs = history.lastResetTimeMs ?? latest.resetTimeMs;
        const timeToResetMs = resetMs !== null ? Math.max(0, resetMs - refNowMs) : null;
        const recoveredRecently = history.recoveredAtMs !== null
            && refNowMs >= history.recoveredAtMs
            && (refNowMs - history.recoveredAtMs) <= this.recoveryNoticeMs;

        // Filter samples within the rolling 45-minute window relative to refNowMs
        const cutoffMs = refNowMs - this.windowMs;
        const inWindow = history.samples.filter(s => s.timestampMs >= cutoffMs && s.timestampMs <= refNowMs);

        // Immediately classify exhausted quota even from a single recent observation
        if (latest.remainingFraction <= 0) {
            return est('exhausted', this.computeBurnRate(inWindow, history.lastObservedAtMs, refNowMs), 0, timeToResetMs, recoveredRecently);
        }

        if (inWindow.length === 0) {
            // Check if we had a recent jitter-filtered steady observation anchored slightly earlier
            const observedRecently = history.lastObservedAtMs !== null
                && history.lastObservedAtMs >= cutoffMs
                && history.lastObservedAtMs <= refNowMs;
            if (!observedRecently) {
                return est('insufficient_data', null, null, timeToResetMs, recoveredRecently);
            }
            const spanMs = history.lastObservedAtMs! - latest.timestampMs;
            if (spanMs < this.minSpanMs) {
                return {
                    poolKey: key,
                    status: 'insufficient_data',
                    burnRatePctPerHour: null,
                    estExhaustMs: null,
                    timeToResetMs,
                    recoveredRecently,
                };
            }
            return {
                poolKey: key,
                status: 'safe_until_reset',
                burnRatePctPerHour: 0,
                estExhaustMs: null,
                timeToResetMs,
                recoveredRecently,
            };
        }

        const burnRatePctPerHour = this.computeBurnRate(inWindow, history.lastObservedAtMs, refNowMs);
        if (burnRatePctPerHour === null) {
            return {
                poolKey: key,
                status: 'insufficient_data',
                burnRatePctPerHour: null,
                estExhaustMs: null,
                timeToResetMs,
                recoveredRecently,
            };
        }

        if (burnRatePctPerHour <= 0) {
            return {
                poolKey: key,
                status: 'safe_until_reset',
                burnRatePctPerHour: 0,
                estExhaustMs: null,
                timeToResetMs,
                recoveredRecently,
            };
        }

        const remainingPct = latest.remainingFraction * 100;
        const estExhaustHours = remainingPct / burnRatePctPerHour;
        const estExhaustMs = Number.isFinite(estExhaustHours) && estExhaustHours >= 0
            ? Math.round(estExhaustHours * 3_600_000)
            : null;

        let status: QuotaRunwayStatus;
        if (estExhaustMs === null) {
            status = 'insufficient_data';
        } else if (timeToResetMs !== null && timeToResetMs > 0) {
            status = estExhaustMs <= timeToResetMs ? 'at_risk' : 'safe_until_reset';
        } else if (timeToResetMs === 0) {
            // Reset timestamp is already elapsed; waiting for server rollover
            status = 'insufficient_data';
        } else {
            // Unknown reset time while actively burning
            status = 'at_risk';
        }

        return {
            poolKey: key,
            status,
            burnRatePctPerHour,
            estExhaustMs,
            timeToResetMs,
            recoveredRecently,
        };
    }

    /** Compute estimates for all tracked pools. */
    estimateAll(
        nowMs?: number,
        options: QuotaEstimateOptions = {},
    ): Record<string, QuotaRunwayEstimate> {
        const result: Record<string, QuotaRunwayEstimate> = {};
        for (const poolKey of this.pools.keys()) {
            result[poolKey] = this.estimate(poolKey, nowMs, options);
        }
        return result;
    }

    /** Inspect a defensive copy of a pool's sample history. */
    getPoolHistory(poolKey: string): QuotaPoolHistory | null {
        const entry = this.pools.get((poolKey || '').trim());
        if (!entry) { return null; }
        return {
            poolKey: entry.poolKey,
            samples: entry.samples.map(s => ({ ...s })),
            lastObservedAtMs: entry.lastObservedAtMs,
            lastResetTimeMs: entry.lastResetTimeMs,
            recoveredAtMs: entry.recoveredAtMs,
        };
    }

    /** Clear one pool or all tracked pools (and matching weekly series). */
    clear(poolKey?: string): void {
        if (poolKey !== undefined) {
            const clean = poolKey.trim();
            this.pools.delete(clean);
            for (const [sk, series] of [...this.weeklySeries.entries()]) {
                if (series.key.pool === clean) {
                    this.weeklySeries.delete(sk);
                }
            }
        } else {
            this.pools.clear();
            this.weeklySeries.clear();
        }
    }

    /**
     * Record a persistent hourly/daily observation keyed by `{ account, pool, window, resetEpoch }`
     * for weekly active-hours quota pacing.
     *
     * Handles:
     * - User-activity evidence gating (idle flat hours never dilute active burn rate)
     * - App+IDE observation deduplication (same bucket/epoch/drop never double-counted)
     * - Offline gaps (sleep/closed-laptop spans excluded from active duration)
     * - Fractional resets (mid-cycle partial quota jumps re-anchor without wiping weekly history)
     * - Overnight sessions (contiguous intervals spanning hour/midnight boundaries split proportionally)
     * - DST 23h/25h transitions (physical UTC `hourEpoch` buckets + local calendar day duration)
     */
    recordWeeklyObservation(input: WeeklyQuotaObservationInput): void {
        const pool = normalizeWeeklyPool(input.pool);
        if (!pool) { return; }
        if (!Number.isFinite(input.remainingFraction) || !Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
            return;
        }

        const account = normalizeWeeklyAccount(input.account);
        const window = normalizeWeeklyWindow(input.window);
        const fraction = clamp01(input.remainingFraction);
        const ts = Math.round(input.timestampMs);
        const resetMs = normalizeResetMs(input.resetTimeMs);
        const surface = normalizeSurfaceTag(input.surface);
        const tzResolver = input.tzOffsetResolver ?? this.tzOffsetResolver;

        const canonicalResetEpoch = this.findWeeklySeries({ account, pool, window, resetEpoch: resetMs ?? 0 })
            ?.key.resetEpoch ?? resetMs ?? 0;

        const bucketKey: WeeklyQuotaBucketKey = {
            account,
            pool,
            window,
            resetEpoch: canonicalResetEpoch,
        };
        const seriesKey = buildWeeklyQuotaSeriesKey(bucketKey);

        let series = this.weeklySeries.get(seriesKey);
        if (!series) {
            series = {
                key: bucketKey,
                seriesKey,
                buckets: [],
                lastObservedAtMs: null,
                lastFraction: null,
                lastResetTimeMs: resetMs,
                offlineGapCount: 0,
                offlineGapMs: 0,
                fractionalResetCount: 0,
            };
            this.weeklySeries.set(seriesKey, series);
        }

        const hourEpoch = Math.floor(ts / HOUR_MS);
        const localDateKey = formatLocalDateKeyForTz(ts, tzResolver);

        // Helper to locate or insert a physical UTC hour bucket
        const getOrCreateBucket = (
            hEpoch: number,
            sliceStartMs: number,
            sliceEndMs: number,
            initFraction: number,
        ): HourlyQuotaObservationBucket => {
            const existing = series!.buckets.find(b => b.hourEpoch === hEpoch);
            if (existing) {
                existing.firstTimestampMs = Math.min(existing.firstTimestampMs, sliceStartMs);
                existing.lastTimestampMs = Math.max(existing.lastTimestampMs, sliceEndMs);
                if (surface && !existing.surfaces.includes(surface)) {
                    existing.surfaces.push(surface);
                    existing.surfaces.sort();
                }
                return existing;
            }
            const created: HourlyQuotaObservationBucket = {
                hourEpoch: hEpoch,
                localDateKey: formatLocalDateKeyForTz(hEpoch * HOUR_MS, tzResolver),
                firstTimestampMs: sliceStartMs,
                lastTimestampMs: sliceEndMs,
                startFraction: initFraction,
                endFraction: initFraction,
                burnFraction: 0,
                activeMs: 0,
                hasUserActivity: false,
                observationCount: 0,
                surfaces: surface ? [surface] : [],
            };
            series!.buckets.push(created);
            series!.buckets.sort((a, b) => a.hourEpoch - b.hourEpoch);
            return created;
        };

        // First observation in this reset epoch
        if (series.lastObservedAtMs === null || series.lastFraction === null) {
            const bucket = getOrCreateBucket(hourEpoch, ts, ts, fraction);
            bucket.localDateKey = localDateKey;
            bucket.observationCount += 1;
            if (input.userActivityEvidence === true) {
                bucket.hasUserActivity = true;
            }
            series.lastObservedAtMs = ts;
            series.lastFraction = fraction;
            if (resetMs !== null) { series.lastResetTimeMs = resetMs; }
            this.pruneWeeklySeries(series);
            return;
        }

        // Out-of-order / duplicate delayed observation from another host (e.g. IDE poll arriving after App)
        if (ts < series.lastObservedAtMs) {
            const existing = series.buckets.find(b => b.hourEpoch === hourEpoch);
            if (existing) {
                if (surface && !existing.surfaces.includes(surface)) {
                    existing.surfaces.push(surface);
                    existing.surfaces.sort();
                }
                // Only expand monotonic envelope when this observation reveals a genuinely lower remaining fraction
                // below BOTH this hour's floor and the series' latest tracked floor in the same non-reset regime.
                // Lowering series.lastFraction keeps the next in-order observation from double-counting the same drop.
                const hasLaterReset = series.buckets.some(b => b.hourEpoch > hourEpoch && b.hadFractionalReset);
                const hasLaterBucket = series.buckets.some(b => b.hourEpoch > hourEpoch);
                if (!hasLaterReset) {
                    const effectiveFloor = Math.min(existing.endFraction, series.lastFraction);
                    if (fraction < effectiveFloor - this.jitterEpsilon) {
                        const extraDrop = effectiveFloor - fraction;
                        existing.endFraction = Math.min(existing.endFraction, fraction);
                        existing.burnFraction += extraDrop;
                        existing.hasUserActivity = true;
                        series.lastFraction = Math.min(series.lastFraction, fraction);
                    }
                } else if (!hasLaterBucket && fraction < existing.endFraction - this.jitterEpsilon) {
                    const extraDrop = existing.endFraction - fraction;
                    existing.endFraction = fraction;
                    existing.burnFraction += extraDrop;
                    existing.hasUserActivity = true;
                }
            }
            return;
        }

        const prevTs = series.lastObservedAtMs;
        const prevFraction = series.lastFraction;
        const gapMs = ts - prevTs;
        const delta = fraction - prevFraction; // negative = burn, positive = recovery/reset
        const isOfflineGap = gapMs > this.offlineGapThresholdMs;

        // Check for fractional reset / mid-epoch quota recovery
        const isFractionalReset = delta >= this.recoveryJumpFraction
            || (prevFraction < this.recoveryHighThreshold && fraction >= this.recoveryHighThreshold && delta >= this.jitterEpsilon);

        if (isOfflineGap) {
            series.offlineGapCount += 1;
            series.offlineGapMs += gapMs;
        }

        if (isFractionalReset) {
            const bucket = getOrCreateBucket(hourEpoch, ts, ts, fraction);
            bucket.localDateKey = localDateKey;
            bucket.endFraction = fraction;
            bucket.hadFractionalReset = true;
            bucket.observationCount += 1;
            if (input.userActivityEvidence === true) {
                bucket.hasUserActivity = true;
            }
            series.fractionalResetCount += 1;
            series.lastObservedAtMs = ts;
            series.lastFraction = fraction;
            if (resetMs !== null) { series.lastResetTimeMs = resetMs; }
            this.pruneWeeklySeries(series);
            return;
        }

        const dropFraction = prevFraction - fraction;
        const hasGenuineDrop = dropFraction >= this.jitterEpsilon;
        const hasActivity = hasGenuineDrop || input.userActivityEvidence === true;

        if (isOfflineGap) {
            // Do NOT attribute offline sleep/closed-laptop duration to activeMs, and do NOT fold
            // offline-gap drops into active burnFraction (unknown active duration would inflate
            // burnRatePctPerActiveHour and fabricate 0-activeMs days that distort avgActiveHoursPerDay).
            const bucket = getOrCreateBucket(hourEpoch, ts, ts, fraction);
            bucket.localDateKey = localDateKey;
            bucket.observationCount += 1;
            bucket.endFraction = Math.min(bucket.endFraction, fraction);
            if (hasGenuineDrop) {
                bucket.offlineBurnFraction = (bucket.offlineBurnFraction ?? 0) + dropFraction;
            }
            if (input.userActivityEvidence === true) {
                bucket.hasUserActivity = true;
            }
        } else if (gapMs === 0) {
            // Simultaneous / duplicate timestamp (e.g. App + IDE polling the exact same second)
            const bucket = getOrCreateBucket(hourEpoch, ts, ts, prevFraction);
            bucket.localDateKey = localDateKey;
            if (hasGenuineDrop) {
                bucket.burnFraction += dropFraction;
                bucket.endFraction = Math.min(bucket.endFraction, fraction);
                bucket.hasUserActivity = true;
            }
            if (input.userActivityEvidence === true) {
                bucket.hasUserActivity = true;
            }
        } else {
            // Contiguous online interval [prevTs, ts] — split cleanly across physical UTC hour boundaries
            // so overnight sessions (e.g. 23:30 -> 00:30) and DST transitions attribute exact slices!
            let cursor = prevTs;
            while (cursor < ts) {
                const sliceHour = Math.floor(cursor / HOUR_MS);
                const nextHourBoundary = (sliceHour + 1) * HOUR_MS;
                const sliceEnd = Math.min(ts, nextHourBoundary);
                const sliceMs = sliceEnd - cursor;
                const weight = gapMs > 0 ? sliceMs / gapMs : 1;
                const sliceStartFrac = prevFraction - (hasGenuineDrop ? dropFraction * ((cursor - prevTs) / gapMs) : 0);
                const sliceEndFrac = prevFraction - (hasGenuineDrop ? dropFraction * ((sliceEnd - prevTs) / gapMs) : 0);

                const bucket = getOrCreateBucket(sliceHour, cursor, sliceEnd, sliceStartFrac);
                if (sliceEnd === ts) {
                    bucket.observationCount += 1;
                }
                if (hasActivity) {
                    bucket.hasUserActivity = true;
                    bucket.activeMs = Math.min(HOUR_MS, bucket.activeMs + sliceMs);
                }
                if (hasGenuineDrop) {
                    bucket.burnFraction += dropFraction * weight;
                    bucket.startFraction = Math.max(bucket.startFraction, sliceStartFrac);
                    bucket.endFraction = Math.min(bucket.endFraction, sliceEndFrac);
                } else {
                    bucket.endFraction = Math.min(bucket.endFraction, fraction);
                }
                cursor = sliceEnd;
            }
        }

        series.lastObservedAtMs = ts;
        // Within a non-reset cycle, remaining fraction is monotonically non-increasing:
        // a slightly stale higher reading from a peer host (e.g. IDE polling 0.76 right after
        // App observed 0.75) must NEVER lift lastFraction and cause double-counted burn.
        if (fraction < prevFraction) {
            series.lastFraction = fraction;
        }
        if (resetMs !== null) {
            series.lastResetTimeMs = resetMs;
        }
        this.pruneWeeklySeries(series);
    }

    private findWeeklySeries(key: WeeklyQuotaBucketKey): WeeklyQuotaSeriesState | undefined {
        const exact = this.weeklySeries.get(buildWeeklyQuotaSeriesKey(key));
        if (exact || key.resetEpoch === 0) { return exact; }
        return [...this.weeklySeries.values()].find(s => s.key.account === key.account && s.key.pool === key.pool
            && s.key.window === key.window && s.key.resetEpoch > 0
            && Math.abs(s.key.resetEpoch - key.resetEpoch) <= this.resetRolloverToleranceMs);
    }

    /** Inspect a defensive copy of a weekly observation series by composite key. */
    getWeeklySeries(key: WeeklyQuotaBucketKey): WeeklyQuotaSeriesState | null {
        const found = this.findWeeklySeries(key);
        return found ? cloneWeeklySeries(found) : null;
    }

    /** List defensive copies of all tracked weekly series. */
    listWeeklySeries(): WeeklyQuotaSeriesState[] {
        return [...this.weeklySeries.values()].map(cloneWeeklySeries);
    }

    /**
     * Estimate weekly active-hours quota runway for `{ account, pool, window }`.
     *
     * Explicitly returns `status: 'insufficient_history'` whenever active hours,
     * active calendar days, or wall-clock observation span fall below minimum coverage thresholds.
     */
    estimateWeekly(
        query: { account?: string; pool: string; window: QuotaHorizonWindow },
        nowMs?: number,
        options: WeeklyEstimateOptions = {},
    ): WeeklyQuotaRunwayEstimate {
        const account = normalizeWeeklyAccount(query.account);
        const pool = normalizeWeeklyPool(query.pool);
        const window = normalizeWeeklyWindow(query.window);
        const minActiveHours = options.minActiveHours !== undefined && options.minActiveHours > 0
            ? options.minActiveHours
            : this.minWeeklyActiveHours;
        const minActiveDays = options.minActiveDays !== undefined && options.minActiveDays >= 1
            ? Math.round(options.minActiveDays)
            : this.minWeeklyActiveDays;
        const minSpanHours = options.minSpanHours !== undefined && options.minSpanHours >= 0
            ? options.minSpanHours
            : this.minWeeklySpanHours;
        const lookbackMs = options.lookbackMs && options.lookbackMs > 0
            ? options.lookbackMs
            : WEEKLY_LOOKBACK_MS;
        const tzResolver = options.tzOffsetResolver ?? this.tzOffsetResolver;

        const emptyCoverage: WeeklyQuotaCoverage = {
            activeHours: 0,
            activeHourBuckets: 0,
            activeDays: 0,
            observedSpanHours: 0,
            minActiveHours,
            minActiveDays,
            minSpanHours,
            meetsThreshold: false,
        };

        if (options.isCustomModel || isCustomModel(options.modelId, options.modelLabel)) {
            return {
                account,
                pool,
                window,
                resetEpoch: options.resetEpoch ?? 0,
                status: 'custom_model_isolated',
                burnRatePctPerActiveHour: null,
                avgActiveHoursPerDay: null,
                projectedDailyBurnPct: null,
                estRemainingActiveHours: null,
                estExhaustMs: null,
                timeToResetMs: null,
                latestRemainingFraction: null,
                coverage: emptyCoverage,
                dailySummaries: [],
                offlineGapCount: 0,
                fractionalResetCount: 0,
                epochsConsidered: 0,
            };
        }

        const epoch = options.resetEpoch === undefined ? undefined :
            this.findWeeklySeries({ account, pool, window, resetEpoch: options.resetEpoch })?.key.resetEpoch ?? options.resetEpoch;
        const matchingSeries: WeeklyQuotaSeriesState[] = [];
        for (const s of this.weeklySeries.values()) {
            if (s.key.account !== account || s.key.pool !== pool || s.key.window !== window) {
                continue;
            }
            if (epoch !== undefined && s.key.resetEpoch !== epoch) {
                continue;
            }
            matchingSeries.push(s);
        }

        if (matchingSeries.length === 0) {
            return {
                account,
                pool,
                window,
                resetEpoch: options.resetEpoch ?? 0,
                status: 'insufficient_history',
                burnRatePctPerActiveHour: null,
                avgActiveHoursPerDay: null,
                projectedDailyBurnPct: null,
                estRemainingActiveHours: null,
                estExhaustMs: null,
                timeToResetMs: null,
                latestRemainingFraction: null,
                coverage: emptyCoverage,
                dailySummaries: [],
                offlineGapCount: 0,
                fractionalResetCount: 0,
                epochsConsidered: 0,
            };
        }

        // Identify most recently observed series for current remaining quota & reset timestamp
        let latestSeries = matchingSeries[0];
        for (let i = 1; i < matchingSeries.length; i++) {
            const cur = matchingSeries[i];
            if ((cur.lastObservedAtMs ?? -1) > (latestSeries.lastObservedAtMs ?? -1)) {
                latestSeries = cur;
            }
        }

        const refNowMs = typeof nowMs === 'number' && Number.isFinite(nowMs)
            ? Math.round(nowMs)
            : (latestSeries.lastObservedAtMs ?? Date.now());
        const cutoffMs = refNowMs - lookbackMs;
        const cutoffHourEpoch = Math.floor(cutoffMs / HOUR_MS);
        const nowHourEpoch = Math.floor(refNowMs / HOUR_MS);

        // Combine buckets across matching reset epochs within the lookback window.
        // Same-epoch duplicate buckets are already deduplicated; distinct reset epochs falling in the
        // same physical hour sum their disjoint epoch burns while capping hour activeMs at 1.0h!
        const combinedByHour = new Map<number, {
            hourEpoch: number;
            localDateKey: string;
            firstTimestampMs: number;
            lastTimestampMs: number;
            burnFraction: number;
            activeMs: number;
            hasUserActivity: boolean;
            fractionalResetCount: number;
        }>();

        let offlineGapCount = 0;
        let fractionalResetCount = 0;
        let epochsConsidered = 0;

        for (const s of matchingSeries) {
            let contributed = false;
            for (const b of s.buckets) {
                if (b.hourEpoch < cutoffHourEpoch || b.hourEpoch > nowHourEpoch) { continue; }
                contributed = true;
                const existing = combinedByHour.get(b.hourEpoch);
                if (!existing) {
                    combinedByHour.set(b.hourEpoch, {
                        hourEpoch: b.hourEpoch,
                        localDateKey: b.localDateKey || formatLocalDateKeyForTz(b.hourEpoch * HOUR_MS, tzResolver),
                        firstTimestampMs: b.firstTimestampMs,
                        lastTimestampMs: b.lastTimestampMs,
                        burnFraction: b.burnFraction,
                        activeMs: b.activeMs,
                        hasUserActivity: b.hasUserActivity,
                        fractionalResetCount: b.hadFractionalReset ? 1 : 0,
                    });
                } else {
                    existing.firstTimestampMs = Math.min(existing.firstTimestampMs, b.firstTimestampMs);
                    existing.lastTimestampMs = Math.max(existing.lastTimestampMs, b.lastTimestampMs);
                    existing.burnFraction += b.burnFraction;
                    existing.activeMs = Math.min(HOUR_MS, existing.activeMs + b.activeMs);
                    existing.hasUserActivity = existing.hasUserActivity || b.hasUserActivity;
                    existing.fractionalResetCount += b.hadFractionalReset ? 1 : 0;
                }
            }
            if (contributed) {
                epochsConsidered++;
                offlineGapCount += s.offlineGapCount;
                fractionalResetCount += s.fractionalResetCount;
            }
        }

        const bucketsInWindow = [...combinedByHour.values()].sort((a, b) => a.hourEpoch - b.hourEpoch);
        const dailyMap = new Map<string, DailyQuotaObservationSummary>();

        let totalActiveMs = 0;
        let activeHourBuckets = 0;
        let totalBurnFraction = 0;
        let earliestTs = Infinity;
        let latestTs = -Infinity;

        for (const b of bucketsInWindow) {
            if (b.firstTimestampMs < earliestTs) { earliestTs = b.firstTimestampMs; }
            if (b.lastTimestampMs > latestTs) { latestTs = b.lastTimestampMs; }

            let day = dailyMap.get(b.localDateKey);
            if (!day) {
                day = {
                    localDateKey: b.localDateKey,
                    dayDurationHours: getLocalDayDurationHours(b.localDateKey, tzResolver),
                    activeHours: 0,
                    activeHourBuckets: 0,
                    burnFraction: 0,
                    observedHours: 0,
                    fractionalResetCount: 0,
                };
                dailyMap.set(b.localDateKey, day);
            }
            day.observedHours += 1;
            day.burnFraction += b.burnFraction;
            day.fractionalResetCount += b.fractionalResetCount;

            if (b.hasUserActivity) {
                activeHourBuckets += 1;
                totalActiveMs += b.activeMs;
                day.activeHourBuckets += 1;
                day.activeHours += b.activeMs / HOUR_MS;
                totalBurnFraction += b.burnFraction;
            }
        }

        const dailySummaries = [...dailyMap.values()]
            .sort((a, b) => a.localDateKey.localeCompare(b.localDateKey))
            .map(d => ({
                ...d,
                activeHours: round2(d.activeHours),
                burnFraction: Math.round(d.burnFraction * 1_000_000) / 1_000_000,
            }));

        const activeDays = dailySummaries.filter(d => d.activeHourBuckets > 0).length;
        const activeHours = totalActiveMs / HOUR_MS;
        const observedSpanHours = (Number.isFinite(earliestTs) && Number.isFinite(latestTs) && latestTs >= earliestTs)
            ? (latestTs - earliestTs) / HOUR_MS
            : 0;

        const meetsThreshold = activeHours >= minActiveHours
            && activeDays >= minActiveDays
            && observedSpanHours >= minSpanHours;

        const coverage: WeeklyQuotaCoverage = {
            activeHours: round2(activeHours),
            activeHourBuckets,
            activeDays,
            observedSpanHours: round2(observedSpanHours),
            minActiveHours,
            minActiveDays,
            minSpanHours,
            meetsThreshold,
        };

        const resetMs = latestSeries.lastResetTimeMs ?? (latestSeries.key.resetEpoch > 0 ? latestSeries.key.resetEpoch : null);
        const timeToResetMs = resetMs !== null ? Math.max(0, resetMs - refNowMs) : null;
        const latestRemainingFraction = latestSeries.lastFraction;

        if (latestRemainingFraction !== null && latestRemainingFraction <= 0) {
            const burnRate = activeHours > 0 ? round2((totalBurnFraction * 100) / activeHours) : null;
            return {
                account,
                pool,
                window,
                resetEpoch: latestSeries.key.resetEpoch,
                status: 'exhausted',
                burnRatePctPerActiveHour: burnRate,
                avgActiveHoursPerDay: activeDays > 0 ? round2(activeHours / activeDays) : null,
                projectedDailyBurnPct: (burnRate !== null && activeDays > 0) ? round2(burnRate * (activeHours / activeDays)) : null,
                estRemainingActiveHours: 0,
                estExhaustMs: 0,
                timeToResetMs,
                latestRemainingFraction,
                coverage,
                dailySummaries,
                offlineGapCount,
                fractionalResetCount,
                epochsConsidered,
            };
        }

        if (!meetsThreshold || latestRemainingFraction === null) {
            return {
                account,
                pool,
                window,
                resetEpoch: latestSeries.key.resetEpoch,
                status: 'insufficient_history',
                burnRatePctPerActiveHour: null,
                avgActiveHoursPerDay: activeDays > 0 ? round2(activeHours / activeDays) : null,
                projectedDailyBurnPct: null,
                estRemainingActiveHours: null,
                estExhaustMs: null,
                timeToResetMs,
                latestRemainingFraction,
                coverage,
                dailySummaries,
                offlineGapCount,
                fractionalResetCount,
                epochsConsidered,
            };
        }

        const burnRateRaw = activeHours > 0 ? (totalBurnFraction * 100) / activeHours : 0;
        const burnRatePctPerActiveHour = round2(Math.max(0, burnRateRaw));
        const avgActiveHoursPerDayRaw = activeDays > 0 ? activeHours / activeDays : 0;
        const avgActiveHoursPerDay = round2(avgActiveHoursPerDayRaw);
        const projectedDailyBurnPct = round2(burnRateRaw * avgActiveHoursPerDayRaw);

        if (burnRateRaw <= 0) {
            return {
                account,
                pool,
                window,
                resetEpoch: latestSeries.key.resetEpoch,
                status: 'safe_until_reset',
                burnRatePctPerActiveHour: 0,
                avgActiveHoursPerDay,
                projectedDailyBurnPct: 0,
                estRemainingActiveHours: null,
                estExhaustMs: null,
                timeToResetMs,
                latestRemainingFraction,
                coverage,
                dailySummaries,
                offlineGapCount,
                fractionalResetCount,
                epochsConsidered,
            };
        }

        const remainingPct = latestRemainingFraction * 100;
        const estRemainingActiveHoursRaw = remainingPct / burnRateRaw;
        const estRemainingActiveHours = round2(estRemainingActiveHoursRaw);

        // Pace remaining active hours over realistic daily active hours (calendar-aware, not 24/7 idle).
        const estWallDays = avgActiveHoursPerDayRaw > 0
            ? estRemainingActiveHoursRaw / avgActiveHoursPerDayRaw
            : 0;
        const estExhaustMs = Number.isFinite(estWallDays) && estWallDays >= 0
            ? Math.round(estWallDays * 24 * HOUR_MS)
            : null;

        let status: QuotaRunwayStatus;
        if (estExhaustMs === null) {
            status = 'insufficient_history';
        } else if (timeToResetMs !== null && timeToResetMs > 0) {
            status = estExhaustMs <= timeToResetMs ? 'at_risk' : 'safe_until_reset';
        } else if (timeToResetMs === 0) {
            status = 'insufficient_data';
        } else {
            status = 'at_risk';
        }

        return {
            account,
            pool,
            window,
            resetEpoch: latestSeries.key.resetEpoch,
            status,
            burnRatePctPerActiveHour,
            avgActiveHoursPerDay,
            projectedDailyBurnPct,
            estRemainingActiveHours,
            estExhaustMs,
            timeToResetMs,
            latestRemainingFraction,
            coverage,
            dailySummaries,
            offlineGapCount,
            fractionalResetCount,
            epochsConsidered,
        };
    }

    /**
     * Merge another tracker or serialized snapshot into this instance idempotently
     * (deduplicating concurrent App + IDE observations across both 45m pools and weekly series).
     */
    mergeFrom(other: QuotaRunwayTracker | SerializedQuotaRunwayState | null | undefined): void {
        if (!other) { return; }
        const snap = other instanceof QuotaRunwayTracker ? other.serialize() : other;
        if (!snap || typeof snap !== 'object') { return; }

        // Merge 45m rolling pools
        if (snap.pools && typeof snap.pools === 'object') {
            for (const [poolKey, incoming] of Object.entries(snap.pools)) {
                if (!incoming || !Array.isArray(incoming.samples) || incoming.samples.length === 0) { continue; }
                const existing = this.pools.get(poolKey);
                if (!existing) {
                    this.pools.set(poolKey, {
                        poolKey: incoming.poolKey || poolKey,
                        samples: incoming.samples.map(s => ({ ...s })),
                        lastObservedAtMs: incoming.lastObservedAtMs,
                        lastResetTimeMs: incoming.lastResetTimeMs,
                        recoveredAtMs: incoming.recoveredAtMs,
                    });
                    continue;
                }
                const byTs = new Map<number, QuotaSample>();
                for (const s of existing.samples) { byTs.set(s.timestampMs, { ...s }); }
                for (const s of incoming.samples) {
                    const prev = byTs.get(s.timestampMs);
                    if (!prev) {
                        byTs.set(s.timestampMs, { ...s });
                    } else {
                        byTs.set(s.timestampMs, {
                            remainingFraction: Math.min(prev.remainingFraction, s.remainingFraction),
                            timestampMs: s.timestampMs,
                            resetTimeMs: prev.resetTimeMs !== null && s.resetTimeMs !== null
                                ? Math.max(prev.resetTimeMs, s.resetTimeMs)
                                : (prev.resetTimeMs ?? s.resetTimeMs),
                        });
                    }
                }
                const mergedSamples = [...byTs.values()].sort((a, b) => a.timestampMs - b.timestampMs);
                existing.samples = mergedSamples.length > this.maxSamplesPerPool
                    ? mergedSamples.slice(mergedSamples.length - this.maxSamplesPerPool)
                    : mergedSamples;
                existing.lastObservedAtMs = Math.max(existing.lastObservedAtMs ?? -1, incoming.lastObservedAtMs ?? -1);
                if (existing.lastObservedAtMs < 0) { existing.lastObservedAtMs = null; }
                if (incoming.lastResetTimeMs !== null) {
                    existing.lastResetTimeMs = existing.lastResetTimeMs !== null
                        ? Math.max(existing.lastResetTimeMs, incoming.lastResetTimeMs)
                        : incoming.lastResetTimeMs;
                }
                if (incoming.recoveredAtMs !== null) {
                    existing.recoveredAtMs = existing.recoveredAtMs !== null
                        ? Math.max(existing.recoveredAtMs, incoming.recoveredAtMs)
                        : incoming.recoveredAtMs;
                }
            }
        }

        // Merge bounded weekly observation series with deduplication
        if (snap.weeklyBuckets && typeof snap.weeklyBuckets === 'object') {
            for (const incoming of Object.values(snap.weeklyBuckets)) {
                if (!incoming || !incoming.key || !Array.isArray(incoming.buckets)) { continue; }
                const canonicalKey = buildWeeklyQuotaSeriesKey(incoming.key);
                const existing = this.findWeeklySeries(incoming.key);
                if (!existing) {
                    const cloned = cloneWeeklySeries({ ...incoming, seriesKey: canonicalKey });
                    this.weeklySeries.set(canonicalKey, cloned);
                    this.pruneWeeklySeries(cloned);
                } else {
                    const merged = mergeWeeklySeriesStates(existing, incoming, this.maxWeeklyHourlyBuckets);
                    merged.key.resetEpoch = Math.min(existing.key.resetEpoch, incoming.key.resetEpoch);
                    merged.seriesKey = buildWeeklyQuotaSeriesKey(merged.key);
                    this.weeklySeries.delete(existing.seriesKey);
                    this.weeklySeries.set(merged.seriesKey, merged);
                }
            }
            this.enforceWeeklySeriesBound();
        }
    }

    /** Export pure JSON-serializable state for persistence (100% backward compatible with v1). */
    serialize(): SerializedQuotaRunwayState {
        const pools: Record<string, QuotaPoolHistory> = {};
        for (const [key, value] of this.pools.entries()) {
            pools[key] = {
                poolKey: value.poolKey,
                samples: value.samples.map(s => ({ ...s })),
                lastObservedAtMs: value.lastObservedAtMs,
                lastResetTimeMs: value.lastResetTimeMs,
                recoveredAtMs: value.recoveredAtMs,
            };
        }
        if (this.weeklySeries.size === 0) {
            return { version: 1, pools };
        }
        const weeklyBuckets: Record<string, WeeklyQuotaSeriesState> = {};
        for (const [seriesKey, series] of this.weeklySeries.entries()) {
            weeklyBuckets[seriesKey] = cloneWeeklySeries(series);
        }
        return { version: 1, pools, weeklyBuckets };
    }

    toJSON(): SerializedQuotaRunwayState {
        return this.serialize();
    }

    /** Restore a tracker instance from serialized JSON state safely (supports legacy v1 without `weeklyBuckets`). */
    static deserialize(
        raw: unknown,
        options: QuotaRunwayTrackerOptions = {},
    ): QuotaRunwayTracker {
        const tracker = new QuotaRunwayTracker(options);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return tracker;
        }
        const rec = raw as Record<string, unknown>;
        const poolsRaw = rec.pools;
        if (poolsRaw && typeof poolsRaw === 'object' && !Array.isArray(poolsRaw)) {
            for (const [poolKey, value] of Object.entries(poolsRaw as Record<string, unknown>)) {
                if (!poolKey.trim() || !value || typeof value !== 'object' || Array.isArray(value)) {
                    continue;
                }
                const poolObj = value as Record<string, unknown>;
                const rawSamples = Array.isArray(poolObj.samples) ? poolObj.samples : [];
                const samples: QuotaSample[] = [];
                for (const s of rawSamples) {
                    if (!s || typeof s !== 'object' || Array.isArray(s)) { continue; }
                    const sr = s as Record<string, unknown>;
                    if (typeof sr.remainingFraction !== 'number' || !Number.isFinite(sr.remainingFraction)) { continue; }
                    if (typeof sr.timestampMs !== 'number' || !Number.isFinite(sr.timestampMs) || sr.timestampMs < 0) { continue; }
                    samples.push({
                        remainingFraction: clamp01(sr.remainingFraction),
                        timestampMs: Math.round(sr.timestampMs),
                        resetTimeMs: normalizeResetMs(sr.resetTimeMs as number | null | undefined),
                    });
                }
                if (samples.length === 0) { continue; }
                samples.sort((a, b) => a.timestampMs - b.timestampMs);
                const trimmed = samples.length > tracker.maxSamplesPerPool
                    ? samples.slice(samples.length - tracker.maxSamplesPerPool)
                    : samples;
                const lastObservedAtMs = typeof poolObj.lastObservedAtMs === 'number' && Number.isFinite(poolObj.lastObservedAtMs)
                    ? Math.round(poolObj.lastObservedAtMs)
                    : trimmed[trimmed.length - 1].timestampMs;
                const lastResetTimeMs = normalizeResetMs(poolObj.lastResetTimeMs as number | null | undefined);
                const recoveredAtMs = typeof poolObj.recoveredAtMs === 'number' && Number.isFinite(poolObj.recoveredAtMs)
                    ? Math.round(poolObj.recoveredAtMs)
                    : null;

                tracker.pools.set(poolKey.trim(), {
                    poolKey: poolKey.trim(),
                    samples: trimmed,
                    lastObservedAtMs,
                    lastResetTimeMs,
                    recoveredAtMs,
                });
            }
        }

        // Restore optional bounded weekly active-hours observation buckets
        const weeklyRaw = rec.weeklyBuckets;
        if (weeklyRaw && typeof weeklyRaw === 'object' && !Array.isArray(weeklyRaw)) {
            for (const [, rawSeries] of Object.entries(weeklyRaw as Record<string, unknown>)) {
                if (!rawSeries || typeof rawSeries !== 'object' || Array.isArray(rawSeries)) { continue; }
                const sr = rawSeries as Record<string, unknown>;
                const rawKey = sr.key as Record<string, unknown> | undefined;
                if (!rawKey || typeof rawKey !== 'object' || Array.isArray(rawKey)) { continue; }
                const pool = normalizeWeeklyPool(rawKey.pool as string | undefined);
                if (!pool) { continue; }
                const key: WeeklyQuotaBucketKey = {
                    account: normalizeWeeklyAccount(rawKey.account as string | undefined),
                    pool,
                    window: normalizeWeeklyWindow(rawKey.window as string | undefined),
                    resetEpoch: typeof rawKey.resetEpoch === 'number' && Number.isFinite(rawKey.resetEpoch) && rawKey.resetEpoch > 0
                        ? Math.round(rawKey.resetEpoch)
                        : 0,
                };
                const seriesKey = buildWeeklyQuotaSeriesKey(key);
                const rawBuckets = Array.isArray(sr.buckets) ? sr.buckets : [];
                const buckets: HourlyQuotaObservationBucket[] = [];
                for (const rb of rawBuckets) {
                    if (!rb || typeof rb !== 'object' || Array.isArray(rb)) { continue; }
                    const b = rb as Record<string, unknown>;
                    if (typeof b.hourEpoch !== 'number' || !Number.isFinite(b.hourEpoch)) { continue; }
                    if (typeof b.firstTimestampMs !== 'number' || !Number.isFinite(b.firstTimestampMs)) { continue; }
                    if (typeof b.lastTimestampMs !== 'number' || !Number.isFinite(b.lastTimestampMs)) { continue; }
                    buckets.push({
                        hourEpoch: Math.floor(b.hourEpoch),
                        localDateKey: typeof b.localDateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.localDateKey)
                            ? b.localDateKey
                            : formatLocalDateKeyForTz(Math.floor(b.hourEpoch) * HOUR_MS, tracker.tzOffsetResolver),
                        firstTimestampMs: Math.round(b.firstTimestampMs),
                        lastTimestampMs: Math.round(b.lastTimestampMs),
                        startFraction: typeof b.startFraction === 'number' && Number.isFinite(b.startFraction) ? clamp01(b.startFraction) : 1,
                        endFraction: typeof b.endFraction === 'number' && Number.isFinite(b.endFraction) ? clamp01(b.endFraction) : 1,
                        burnFraction: typeof b.burnFraction === 'number' && Number.isFinite(b.burnFraction) && b.burnFraction > 0 ? b.burnFraction : 0,
                        activeMs: typeof b.activeMs === 'number' && Number.isFinite(b.activeMs) && b.activeMs > 0
                            ? Math.min(HOUR_MS, Math.round(b.activeMs))
                            : 0,
                        hasUserActivity: b.hasUserActivity === true,
                        observationCount: typeof b.observationCount === 'number' && Number.isFinite(b.observationCount) && b.observationCount > 0
                            ? Math.round(b.observationCount)
                            : 1,
                        surfaces: Array.isArray(b.surfaces)
                            ? [...new Set(b.surfaces.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim().toLowerCase()))].sort()
                            : [],
                        ...(b.hadFractionalReset === true ? { hadFractionalReset: true } : {}),
                        ...(typeof b.offlineBurnFraction === 'number' && Number.isFinite(b.offlineBurnFraction) && b.offlineBurnFraction > 0
                            ? { offlineBurnFraction: b.offlineBurnFraction }
                            : {}),
                    });
                }
                buckets.sort((a, b) => a.hourEpoch - b.hourEpoch);
                const trimmedBuckets = buckets.length > tracker.maxWeeklyHourlyBuckets
                    ? buckets.slice(buckets.length - tracker.maxWeeklyHourlyBuckets)
                    : buckets;
                const series: WeeklyQuotaSeriesState = {
                    key,
                    seriesKey,
                    buckets: trimmedBuckets,
                    lastObservedAtMs: typeof sr.lastObservedAtMs === 'number' && Number.isFinite(sr.lastObservedAtMs)
                        ? Math.round(sr.lastObservedAtMs)
                        : (trimmedBuckets.length > 0 ? trimmedBuckets[trimmedBuckets.length - 1].lastTimestampMs : null),
                    lastFraction: typeof sr.lastFraction === 'number' && Number.isFinite(sr.lastFraction)
                        ? clamp01(sr.lastFraction)
                        : (trimmedBuckets.length > 0 ? trimmedBuckets[trimmedBuckets.length - 1].endFraction : null),
                    lastResetTimeMs: normalizeResetMs(sr.lastResetTimeMs as number | null | undefined),
                    offlineGapCount: typeof sr.offlineGapCount === 'number' && Number.isFinite(sr.offlineGapCount) && sr.offlineGapCount > 0
                        ? Math.round(sr.offlineGapCount)
                        : 0,
                    offlineGapMs: typeof sr.offlineGapMs === 'number' && Number.isFinite(sr.offlineGapMs) && sr.offlineGapMs > 0
                        ? Math.round(sr.offlineGapMs)
                        : 0,
                    fractionalResetCount: typeof sr.fractionalResetCount === 'number' && Number.isFinite(sr.fractionalResetCount) && sr.fractionalResetCount > 0
                        ? Math.round(sr.fractionalResetCount)
                        : 0,
                };
                tracker.weeklySeries.set(seriesKey, series);
            }
            tracker.enforceWeeklySeriesBound();
        }

        return tracker;
    }

    private pruneWeeklySeries(series: WeeklyQuotaSeriesState): void {
        if (series.buckets.length > this.maxWeeklyHourlyBuckets) {
            series.buckets = series.buckets.slice(series.buckets.length - this.maxWeeklyHourlyBuckets);
        }
        this.enforceWeeklySeriesBound();
    }

    private enforceWeeklySeriesBound(): void {
        if (this.weeklySeries.size <= this.maxWeeklySeries) { return; }
        const sorted = [...this.weeklySeries.entries()].sort((a, b) =>
            (a[1].lastObservedAtMs ?? 0) - (b[1].lastObservedAtMs ?? 0),
        );
        const excess = sorted.length - this.maxWeeklySeries;
        for (let i = 0; i < excess; i++) {
            this.weeklySeries.delete(sorted[i][0]);
        }
    }

    private computeBurnRate(
        inWindow: readonly QuotaSample[],
        lastObservedAtMs: number | null,
        refNowMs: number,
    ): number | null {
        if (inWindow.length === 0) { return null; }
        const first = inWindow[0];
        const last = inWindow[inWindow.length - 1];
        const effectiveEndMs = lastObservedAtMs !== null
            ? Math.min(refNowMs, Math.max(last.timestampMs, lastObservedAtMs))
            : last.timestampMs;

        const spanMs = effectiveEndMs - first.timestampMs;
        if (!Number.isFinite(spanMs) || spanMs < this.minSpanMs) {
            return null;
        }

        const dropFraction = Math.max(0, first.remainingFraction - last.remainingFraction);
        if (dropFraction < this.jitterEpsilon) {
            return 0;
        }

        const spanHours = spanMs / 3_600_000;
        if (spanHours <= 0) { return null; }
        const rate = (dropFraction * 100) / spanHours;
        return Number.isFinite(rate) && rate >= 0 ? round2(rate) : null;
    }

    private prunePool(history: QuotaPoolHistory, nowMs: number): void {
        const cutoff = nowMs - this.windowMs;
        if (history.samples.length > 1) {
            const filtered = history.samples.filter(s => s.timestampMs >= cutoff);
            history.samples = filtered.length > 0
                ? filtered
                : [history.samples[history.samples.length - 1]];
        }
        if (history.samples.length > this.maxSamplesPerPool) {
            history.samples = history.samples.slice(history.samples.length - this.maxSamplesPerPool);
        }
    }
}

// ─── StaleCacheGuard ─────────────────────────────────────────────────────────

/**
 * Preserves last-known good data across transient RPC failures so UI surfaces
 * render a clear Stale/Cached badge instead of blanking out.
 */
export class StaleCacheGuard<T> {
    private data: T | null = null;
    private isStale = false;
    private lastSuccessAtMs: number | null = null;
    private consecutiveFailures = 0;
    private lastError: string | null = null;
    private readonly maxAgeMs: number | null;

    constructor(
        initial?: Partial<StaleCacheSnapshot<T>>,
        options: StaleCacheGuardOptions = {},
    ) {
        if (initial) {
            if (initial.data !== undefined) { this.data = initial.data; }
            if (typeof initial.isStale === 'boolean') { this.isStale = initial.isStale; }
            if (typeof initial.lastSuccessAtMs === 'number' && Number.isFinite(initial.lastSuccessAtMs)) {
                this.lastSuccessAtMs = initial.lastSuccessAtMs;
            }
            if (typeof initial.consecutiveFailures === 'number' && Number.isFinite(initial.consecutiveFailures) && initial.consecutiveFailures >= 0) {
                this.consecutiveFailures = Math.round(initial.consecutiveFailures);
            }
            if (typeof initial.lastError === 'string') {
                this.lastError = initial.lastError;
            }
        }
        this.maxAgeMs = typeof options.maxAgeMs === 'number' && Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0
            ? options.maxAgeMs
            : null;
    }

    recordSuccess(data: T, timestampMs = Date.now()): StaleCacheSnapshot<T> {
        this.data = data;
        this.isStale = false;
        this.lastSuccessAtMs = Number.isFinite(timestampMs) ? Math.round(timestampMs) : Date.now();
        this.consecutiveFailures = 0;
        this.lastError = null;
        return this.getSnapshot(this.lastSuccessAtMs);
    }

    recordFailure(error: unknown): StaleCacheSnapshot<T> {
        this.consecutiveFailures += 1;
        this.lastError = extractErrorMessage(error);
        // Mark stale only when cached data exists; if no prior good data exists, keep data=null.
        this.isStale = this.data !== null;
        return this.getSnapshot();
    }

    /**
     * Execute an async fetch operation, recording success or preserving the
     * last-known good data on failure.
     */
    async run<R extends T = T>(
        fetcher: () => Promise<R>,
        nowMs?: number,
    ): Promise<StaleCacheSnapshot<T>> {
        try {
            const result = await fetcher();
            return this.recordSuccess(result, nowMs ?? Date.now());
        } catch (err) {
            return this.recordFailure(err);
        }
    }

    getSnapshot(nowMs?: number): StaleCacheSnapshot<T> {
        let stale = this.isStale;
        if (
            !stale
            && this.data !== null
            && this.maxAgeMs !== null
            && this.lastSuccessAtMs !== null
        ) {
            const refNow = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
            if (refNow - this.lastSuccessAtMs > this.maxAgeMs) {
                stale = true;
            }
        }
        return {
            data: this.data,
            isStale: stale,
            lastSuccessAtMs: this.lastSuccessAtMs,
            consecutiveFailures: this.consecutiveFailures,
            lastError: this.lastError,
        };
    }

    hasData(): boolean {
        return this.data !== null;
    }

    reset(): void {
        this.data = null;
        this.isStale = false;
        this.lastSuccessAtMs = null;
        this.consecutiveFailures = 0;
        this.lastError = null;
    }
}

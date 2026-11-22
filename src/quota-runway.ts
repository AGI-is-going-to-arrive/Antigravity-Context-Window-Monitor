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

// ─── Types ───────────────────────────────────────────────────────────────────

export type QuotaRunwayStatus =
    | 'safe_until_reset'
    | 'at_risk'
    | 'exhausted'
    | 'insufficient_data'
    | 'custom_model_isolated';

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
    private readonly pools = new Map<string, QuotaPoolHistory>();

    constructor(options: QuotaRunwayTrackerOptions = {}) {
        this.windowMs = options.windowMs && options.windowMs > 0 ? options.windowMs : RUNWAY_WINDOW_MS;
        this.jitterEpsilon = options.jitterEpsilon !== undefined && options.jitterEpsilon >= 0
            ? options.jitterEpsilon
            : JITTER_EPSILON;
        this.recoveryJumpFraction = options.recoveryJumpFraction !== undefined && options.recoveryJumpFraction > 0
            ? options.recoveryJumpFraction
            : RECOVERY_JUMP_FRACTION;
        this.recoveryHighThreshold = options.recoveryHighThreshold !== undefined && options.recoveryHighThreshold > 0
            ? options.recoveryHighThreshold
            : RECOVERY_HIGH_THRESHOLD;
        this.resetRolloverToleranceMs = options.resetRolloverToleranceMs !== undefined && options.resetRolloverToleranceMs >= 0
            ? options.resetRolloverToleranceMs
            : RESET_ROLLOVER_TOLERANCE_MS;
        this.minSpanMs = options.minSpanMs !== undefined && options.minSpanMs >= 0
            ? options.minSpanMs
            : DEFAULT_MIN_SPAN_MS;
        this.recoveryNoticeMs = options.recoveryNoticeMs !== undefined && options.recoveryNoticeMs >= 0
            ? options.recoveryNoticeMs
            : DEFAULT_RECOVERY_NOTICE_MS;
        this.maxSamplesPerPool = options.maxSamplesPerPool && options.maxSamplesPerPool >= 2
            ? Math.round(options.maxSamplesPerPool)
            : MAX_SAMPLES_PER_POOL;
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
        if (options.isCustomModel || isCustomModel(options.modelId, options.modelLabel)) {
            return {
                poolKey: key,
                status: 'custom_model_isolated',
                burnRatePctPerHour: null,
                estExhaustMs: null,
                timeToResetMs: null,
                recoveredRecently: false,
            };
        }

        const history = this.pools.get(key);
        if (!history || history.samples.length === 0) {
            return {
                poolKey: key,
                status: 'insufficient_data',
                burnRatePctPerHour: null,
                estExhaustMs: null,
                timeToResetMs: null,
                recoveredRecently: false,
            };
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
            const burnRate = this.computeBurnRate(inWindow, history.lastObservedAtMs, refNowMs);
            return {
                poolKey: key,
                status: 'exhausted',
                burnRatePctPerHour: burnRate,
                estExhaustMs: 0,
                timeToResetMs,
                recoveredRecently,
            };
        }

        if (inWindow.length === 0) {
            // Check if we had a recent jitter-filtered steady observation anchored slightly earlier
            const observedRecently = history.lastObservedAtMs !== null
                && history.lastObservedAtMs >= cutoffMs
                && history.lastObservedAtMs <= refNowMs;
            if (!observedRecently) {
                return {
                    poolKey: key,
                    status: 'insufficient_data',
                    burnRatePctPerHour: null,
                    estExhaustMs: null,
                    timeToResetMs,
                    recoveredRecently,
                };
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

    /** Clear one pool or all tracked pools. */
    clear(poolKey?: string): void {
        if (poolKey !== undefined) {
            this.pools.delete(poolKey.trim());
        } else {
            this.pools.clear();
        }
    }

    /** Export pure JSON-serializable state for persistence. */
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
        return { version: 1, pools };
    }

    toJSON(): SerializedQuotaRunwayState {
        return this.serialize();
    }

    /** Restore a tracker instance from serialized JSON state safely. */
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
        if (!poolsRaw || typeof poolsRaw !== 'object' || Array.isArray(poolsRaw)) {
            return tracker;
        }

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

        return tracker;
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

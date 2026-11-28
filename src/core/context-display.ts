// ─── Unified Immutable Monitor Observation & Surface Projection Engine ────────
// Single source of truth for context utilization, dual-cap basis resolution,
// threshold markers, health severity, speed metadata, and run-scoped opaque
// diagnostic aliases across Overview, Native HUD, CDP Topbar, CDP Composer
// Ring, and IDE Status Bar.
//
// Zero VS Code, DOM, or external npm dependencies.

// ─── Types ───────────────────────────────────────────────────────────────────

export type ObservationSubjectKind = 'main' | 'worker' | 'subagent';

export type ContextDisplayBasis = 'compaction' | 'native';

export type ContextLimitProvenance =
    | 'planner_config'
    | 'ls_metadata'
    | 'model_catalog'
    | 'model_guess'
    | 'explicit_override'
    | 'unavailable';

export type ContextTokenSource =
    | 'gm_usage'
    | 'tracker_usage'
    | 'breakdown_buckets'
    | 'step_estimate'
    | 'zero_step_fresh'
    | 'unavailable';

export type SpeedDisplayMode = 'decode' | 'e2e';

export type SpeedSampleScope = 'latest_call' | 'conversation_weighted' | 'none';

export type ContextHealthStatus =
    | 'fresh'
    | 'healthy'
    | 'elevated'
    | 'high_pressure'
    | 'overflow'
    | 'incomplete';

export type CompactionWarningLevel = 'none' | 'elevated' | 'critical' | 'overflow';

export type MonitorDisplaySurface =
    | 'overview'
    | 'native_hud'
    | 'cdp_topbar'
    | 'cdp_composer_ring'
    | 'ide_status_bar';

export interface ContextThresholdMarker {
    readonly id: string;
    readonly label: string;
    readonly tokens: number;
    readonly axis: ContextDisplayBasis;
    /** Exact marker position on `actualBasis` axis in percentage (0..100). */
    readonly positionPct: number;
    readonly exceeded: boolean;
}

/**
 * Single deeply-frozen immutable observation published by the telemetry producer
 * for a given `(backendEpoch, windowId, subjectCascadeId, selectionRevision, dataRevision)`.
 *
 * Every surface rendering the same `(subjectCascadeId, dataRevision)` projects
 * directly from this object, guaranteeing 100% numeric, denominator, rounding,
 * health, and marker parity.
 */
export interface PublishedMonitorObservation {
    readonly backendEpoch: number;
    readonly windowId: string;
    readonly rootCascadeId: string | null;
    readonly subjectCascadeId: string | null;
    readonly subjectKind: ObservationSubjectKind;
    readonly selectionRevision: number;
    readonly dataRevision: number;
    /** Model ID that actually supplied this measurement (distinct from swarm assignedModel). */
    readonly measuredModel: string | null;
    readonly tokenSource: ContextTokenSource;
    /** Used context tokens (`0` for confirmed 0-step fresh, `null` when missing/incomplete). */
    readonly usedTokens: number | null;
    readonly compactionLimit: number | null;
    readonly compactionLimitProvenance: ContextLimitProvenance;
    readonly nativeLimit: number | null;
    readonly nativeLimitProvenance: ContextLimitProvenance;
    readonly requestedBasis: ContextDisplayBasis;
    readonly actualBasis: ContextDisplayBasis;
    /** Canonical rounded primary percentage (1 decimal place, un-clamped for overflow; `null` if incomplete). */
    readonly primaryPct: number | null;
    /** Unrounded primary percentage (`null` if incomplete; preserves overflow such as `112.34...`). */
    readonly primaryPctRaw: number | null;
    readonly speedMode: SpeedDisplayMode;
    readonly speedSampleScope: SpeedSampleScope;
    readonly speedCallId: string | null;
    readonly displaySpeedTps: number | null;
    readonly isZeroStepFresh: boolean;
    readonly isIncomplete: boolean;

    // ── Canonical derived fields (immutable) ──
    readonly primaryLimit: number | null;
    readonly secondaryLimit: number | null;
    readonly secondaryBasis: ContextDisplayBasis | null;
    readonly secondaryPct: number | null;
    readonly secondaryPctRaw: number | null;
    readonly compactionPct: number | null;
    readonly compactionPctRaw: number | null;
    readonly nativePct: number | null;
    readonly nativePctRaw: number | null;
    readonly isSingleScale: boolean;
    readonly hasDualCap: boolean;
    readonly isOverflow: boolean;
    /** Clamped geometric fill percentage (`0..100`) for progress bars and rings ONLY. */
    readonly geometryFillPct: number;
    readonly healthStatus: ContextHealthStatus;
    /** Always preserved when approaching/exceeding compaction limit, even if `requestedBasis === 'native'`. */
    readonly compactionWarningActive: boolean;
    readonly compactionWarningLevel: CompactionWarningLevel;
    /** Threshold markers positioned strictly on the `actualBasis` axis. */
    readonly markers: readonly ContextThresholdMarker[];
    /** Strictly scoped session cost (`null` for confirmed 0-step fresh or when unavailable). */
    readonly sessionCostUsd: number | null;
    readonly observedAtMs: number;
}

export interface BuildObservationInput {
    backendEpoch: number;
    windowId: string;
    rootCascadeId?: string | null;
    subjectCascadeId?: string | null;
    subjectKind?: ObservationSubjectKind;
    selectionRevision: number;
    dataRevision: number;
    measuredModel?: string | null;
    tokenSource?: ContextTokenSource;
    usedTokens?: number | null;
    compactionLimit?: number | null;
    compactionLimitProvenance?: ContextLimitProvenance;
    nativeLimit?: number | null;
    nativeLimitProvenance?: ContextLimitProvenance;
    requestedBasis?: ContextDisplayBasis;
    speedMode?: SpeedDisplayMode;
    speedSampleScope?: SpeedSampleScope;
    speedCallId?: string | null;
    displaySpeedTps?: number | null;
    /** Explicitly marks a confirmed 0-step brand-new conversation awaiting first turn. */
    isZeroStepFresh?: boolean;
    /** Explicitly marks an incomplete/unavailable measurement (e.g. failed RPC or missing limits). */
    isIncomplete?: boolean;
    /** Optional session cost strictly scoped to `subjectCascadeId` (nullified automatically on fresh). */
    sessionCostUsd?: number | null;
    /** Warning threshold percentage on the compaction/primary axis (default 65). */
    elevatedThresholdPct?: number;
    /** Critical / high-pressure threshold percentage on the compaction/primary axis (default 80). */
    highPressureThresholdPct?: number;
    /** Optional custom threshold token lines to project onto `actualBasis` (e.g. 200_000). */
    extraThresholds?: ReadonlyArray<{ id: string; label: string; tokens: number }>;
    /** Disable the default 200k long-context tier marker if needed (default true). */
    include200kMarker?: boolean;
    observedAtMs?: number;
}

export interface SurfaceObservationProjection {
    readonly surface: MonitorDisplaySurface;
    readonly backendEpoch: number;
    readonly windowId: string;
    readonly rootCascadeId: string | null;
    readonly subjectCascadeId: string | null;
    readonly subjectKind: ObservationSubjectKind;
    readonly selectionRevision: number;
    readonly dataRevision: number;
    readonly measuredModel: string | null;
    readonly actualBasis: ContextDisplayBasis;
    readonly requestedBasis: ContextDisplayBasis;
    readonly usedTokens: number | null;
    readonly denominatorTokens: number | null;
    readonly secondaryDenominatorTokens: number | null;
    readonly secondaryBasis: ContextDisplayBasis | null;
    readonly primaryPct: number | null;
    readonly primaryPctRaw: number | null;
    readonly primaryPctRoundedInt: number | null;
    /** Canonical display string (`'—'` when incomplete, `'0%'` when fresh, `'112%'` on overflow). */
    readonly primaryPctText: string;
    /** Geometric bar/ring width strictly clamped to `0..100`. */
    readonly geometryFillPct: number;
    readonly healthStatus: ContextHealthStatus;
    readonly compactionWarningActive: boolean;
    readonly compactionWarningLevel: CompactionWarningLevel;
    readonly compactionPct: number | null;
    readonly isSingleScale: boolean;
    readonly hasDualCap: boolean;
    readonly isOverflow: boolean;
    readonly isZeroStepFresh: boolean;
    readonly isIncomplete: boolean;
    readonly markers: readonly ContextThresholdMarker[];
    readonly speedMode: SpeedDisplayMode;
    readonly speedSampleScope: SpeedSampleScope;
    readonly speedCallId: string | null;
    readonly displaySpeedTps: number | null;
    readonly sessionCostUsd: number | null;
}

export interface ObservationParityCheckResult {
    readonly ok: boolean;
    readonly mismatches: readonly string[];
}

export interface SanitizedObservationDiagnostic {
    readonly backendEpoch: number;
    readonly windowAlias: string;
    readonly rootAlias: string | null;
    readonly subjectAlias: string | null;
    readonly subjectKind: ObservationSubjectKind;
    readonly selectionRevision: number;
    readonly dataRevision: number;
    readonly modelAlias: string | null;
    readonly tokenSource: ContextTokenSource;
    readonly usedTokens: number | null;
    readonly compactionLimit: number | null;
    readonly compactionLimitProvenance: ContextLimitProvenance;
    readonly nativeLimit: number | null;
    readonly nativeLimitProvenance: ContextLimitProvenance;
    readonly requestedBasis: ContextDisplayBasis;
    readonly actualBasis: ContextDisplayBasis;
    readonly primaryPct: number | null;
    readonly primaryPctRaw: number | null;
    readonly geometryFillPct: number;
    readonly healthStatus: ContextHealthStatus;
    readonly compactionWarningActive: boolean;
    readonly compactionWarningLevel: CompactionWarningLevel;
    readonly speedMode: SpeedDisplayMode;
    readonly speedSampleScope: SpeedSampleScope;
    readonly speedCallAlias: string | null;
    readonly displaySpeedTps: number | null;
    readonly isZeroStepFresh: boolean;
    readonly isIncomplete: boolean;
    readonly observedAtMs: number;
}

// ─── Constants & Primitive Helpers ───────────────────────────────────────────

export const DEFAULT_ELEVATED_THRESHOLD_PCT = 65;
export const DEFAULT_HIGH_PRESSURE_THRESHOLD_PCT = 80;
export const LONG_CONTEXT_200K_TOKENS = 200_000;

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') { return null; }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveLimit(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return Math.round(value);
}

function normalizeNonNegCount(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.round(value);
}

function normalizePositiveSpeed(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return Math.round(value * 10) / 10;
}

function normalizeFiniteNonNegNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return value;
}

function roundPct1(raw: number): number {
    if (!Number.isFinite(raw)) { return 0; }
    const rounded = Math.round(raw * 10) / 10;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function clampGeometryPct(raw: number | null): number {
    if (raw === null || !Number.isFinite(raw) || raw <= 0) { return 0; }
    if (raw >= 100) { return 100; }
    return roundPct1(raw);
}

function normalizeRevision(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.floor(value);
}

function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
    } else {
        for (const key of Object.keys(value as Record<string, unknown>)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
    }
    return Object.freeze(value);
}

function severityRank(status: ContextHealthStatus): number {
    switch (status) {
        case 'incomplete': return 0;
        case 'fresh': return 1;
        case 'healthy': return 2;
        case 'elevated': return 3;
        case 'high_pressure': return 4;
        case 'overflow': return 5;
    }
}

function classifyPctSeverity(
    pctRaw: number | null,
    elevatedPct: number,
    highPressurePct: number,
): ContextHealthStatus {
    if (pctRaw === null || !Number.isFinite(pctRaw) || pctRaw < 0) {
        return 'incomplete';
    }
    if (pctRaw > 100) { return 'overflow'; }
    if (pctRaw >= highPressurePct) { return 'high_pressure'; }
    if (pctRaw >= elevatedPct) { return 'elevated'; }
    return 'healthy';
}

function classifyCompactionWarning(
    pctRaw: number | null,
    elevatedPct: number,
    highPressurePct: number,
): CompactionWarningLevel {
    if (pctRaw === null || !Number.isFinite(pctRaw) || pctRaw < elevatedPct) {
        return 'none';
    }
    if (pctRaw > 100) { return 'overflow'; }
    if (pctRaw >= highPressurePct) { return 'critical'; }
    return 'elevated';
}

function warningToHealth(level: CompactionWarningLevel): ContextHealthStatus {
    switch (level) {
        case 'overflow': return 'overflow';
        case 'critical': return 'high_pressure';
        case 'elevated': return 'elevated';
        case 'none': return 'healthy';
    }
}

// ─── Observation Builder ─────────────────────────────────────────────────────

/**
 * Construct a deeply frozen `PublishedMonitorObservation` with strict invariants:
 * - Confirmed 0-step fresh conversations emit `primaryPct: 0`, `isZeroStepFresh: true`,
 *   null speed/cost samples, and `healthStatus: 'fresh'` (never unhealthy).
 * - Missing/incomplete measurements emit `primaryPct: null`, `isIncomplete: true`,
 *   and `healthStatus: 'incomplete'` (never `0%` or `'healthy'`).
 * - Native-only limits fall back cleanly to `actualBasis: 'native'` with explicit provenance.
 * - Equal limits set `isSingleScale: true` and `hasDualCap: false`.
 * - Overflow values preserve raw percentage in `primaryPct` / `primaryPctRaw` (e.g. `112%`),
 *   clamping ONLY `geometryFillPct` to `0..100`.
 * - Threshold markers are positioned on the `actualBasis` axis, and compaction warnings are
 *   ALWAYS preserved even when `requestedBasis === 'native'`.
 */
export function buildPublishedMonitorObservation(
    input: BuildObservationInput,
): PublishedMonitorObservation {
    const backendEpoch = normalizeRevision(input.backendEpoch);
    const windowId = normalizeNonEmptyString(input.windowId) ?? 'default';
    const rootCascadeId = normalizeNonEmptyString(input.rootCascadeId);
    const subjectCascadeId = normalizeNonEmptyString(input.subjectCascadeId);
    const subjectKind: ObservationSubjectKind = input.subjectKind ?? 'main';
    const selectionRevision = normalizeRevision(input.selectionRevision);
    const dataRevision = normalizeRevision(input.dataRevision);
    const measuredModel = normalizeNonEmptyString(input.measuredModel);

    const requestedBasis: ContextDisplayBasis = input.requestedBasis === 'native' ? 'native' : 'compaction';
    const speedMode: SpeedDisplayMode = input.speedMode === 'e2e' ? 'e2e' : 'decode';
    const elevatedPct = typeof input.elevatedThresholdPct === 'number'
        && Number.isFinite(input.elevatedThresholdPct)
        && input.elevatedThresholdPct > 0
        && input.elevatedThresholdPct < 100
        ? input.elevatedThresholdPct
        : DEFAULT_ELEVATED_THRESHOLD_PCT;
    const highPressurePct = typeof input.highPressureThresholdPct === 'number'
        && Number.isFinite(input.highPressureThresholdPct)
        && input.highPressureThresholdPct >= elevatedPct
        && input.highPressureThresholdPct <= 100
        ? input.highPressureThresholdPct
        : Math.max(elevatedPct, DEFAULT_HIGH_PRESSURE_THRESHOLD_PCT);

    // Normalize both limits and provenance
    const compactionLimit = normalizePositiveLimit(input.compactionLimit);
    let nativeLimit = normalizePositiveLimit(input.nativeLimit);

    const compactionLimitProvenance: ContextLimitProvenance = compactionLimit !== null
        ? (input.compactionLimitProvenance && input.compactionLimitProvenance !== 'unavailable'
            ? input.compactionLimitProvenance
            : 'model_catalog')
        : 'unavailable';

    let nativeLimitProvenance: ContextLimitProvenance = nativeLimit !== null
        ? (input.nativeLimitProvenance && input.nativeLimitProvenance !== 'unavailable'
            ? input.nativeLimitProvenance
            : 'model_catalog')
        : 'unavailable';

    // Keep native >= compaction when both are supplied and compaction exceeds native
    if (compactionLimit !== null && nativeLimit !== null && compactionLimit > nativeLimit) {
        nativeLimit = compactionLimit;
        nativeLimitProvenance = compactionLimitProvenance;
    }

    const hasCompaction = compactionLimit !== null;
    const hasNative = nativeLimit !== null;
    const hasDualCap = compactionLimit !== null && nativeLimit !== null && compactionLimit < nativeLimit;
    const isSingleScale = (compactionLimit !== null && nativeLimit !== null && compactionLimit === nativeLimit)
        || (hasCompaction !== hasNative);

    // Resolve actualBasis cleanly from available limits
    let actualBasis: ContextDisplayBasis;
    if (requestedBasis === 'compaction') {
        actualBasis = hasCompaction ? 'compaction' : (hasNative ? 'native' : 'compaction');
    } else {
        actualBasis = hasNative ? 'native' : (hasCompaction ? 'compaction' : 'native');
    }

    const primaryLimit = actualBasis === 'compaction' ? compactionLimit : nativeLimit;
    const secondaryBasis: ContextDisplayBasis | null = hasDualCap
        ? (actualBasis === 'compaction' ? 'native' : 'compaction')
        : null;
    const secondaryLimit = secondaryBasis === 'native'
        ? nativeLimit
        : (secondaryBasis === 'compaction' ? compactionLimit : null);

    const isZeroStepFresh = input.isZeroStepFresh === true && input.isIncomplete !== true;
    const rawUsedTokens = normalizeNonNegCount(input.usedTokens);

    // Incomplete whenever explicitly flagged OR missing measurement / denominator on a non-fresh observation
    const isIncomplete = !isZeroStepFresh && (
        input.isIncomplete === true
        || rawUsedTokens === null
        || primaryLimit === null
        || primaryLimit <= 0
    );

    const usedTokens: number | null = isZeroStepFresh
        ? 0
        : (isIncomplete ? null : rawUsedTokens);

    const tokenSource: ContextTokenSource = isZeroStepFresh
        ? 'zero_step_fresh'
        : (isIncomplete
            ? 'unavailable'
            : (input.tokenSource ?? 'tracker_usage'));

    let primaryPctRaw: number | null = null;
    let primaryPct: number | null = null;
    let secondaryPctRaw: number | null = null;
    let secondaryPct: number | null = null;
    let compactionPctRaw: number | null = null;
    let compactionPct: number | null = null;
    let nativePctRaw: number | null = null;
    let nativePct: number | null = null;

    if (isZeroStepFresh) {
        primaryPctRaw = 0;
        primaryPct = 0;
        if (secondaryLimit !== null && secondaryLimit > 0) {
            secondaryPctRaw = 0;
            secondaryPct = 0;
        }
        if (compactionLimit !== null && compactionLimit > 0) {
            compactionPctRaw = 0;
            compactionPct = 0;
        }
        if (nativeLimit !== null && nativeLimit > 0) {
            nativePctRaw = 0;
            nativePct = 0;
        }
    } else if (!isIncomplete && usedTokens !== null && primaryLimit !== null && primaryLimit > 0) {
        primaryPctRaw = (usedTokens / primaryLimit) * 100;
        primaryPct = roundPct1(primaryPctRaw);
        if (secondaryLimit !== null && secondaryLimit > 0) {
            secondaryPctRaw = (usedTokens / secondaryLimit) * 100;
            secondaryPct = roundPct1(secondaryPctRaw);
        }
        if (compactionLimit !== null && compactionLimit > 0) {
            compactionPctRaw = (usedTokens / compactionLimit) * 100;
            compactionPct = roundPct1(compactionPctRaw);
        }
        if (nativeLimit !== null && nativeLimit > 0) {
            nativePctRaw = (usedTokens / nativeLimit) * 100;
            nativePct = roundPct1(nativePctRaw);
        }
    }

    const isOverflow = primaryPctRaw !== null && primaryPctRaw > 100;
    const geometryFillPct = isIncomplete || isZeroStepFresh ? 0 : clampGeometryPct(primaryPctRaw);

    // Health & compaction warning evaluation
    let compactionWarningLevel: CompactionWarningLevel = 'none';
    let compactionWarningActive = false;
    let healthStatus: ContextHealthStatus;

    if (isIncomplete) {
        healthStatus = 'incomplete';
    } else if (isZeroStepFresh) {
        healthStatus = 'fresh';
    } else {
        const primaryHealth = classifyPctSeverity(primaryPctRaw, elevatedPct, highPressurePct);
        if (compactionLimit !== null && compactionPctRaw !== null) {
            compactionWarningLevel = classifyCompactionWarning(compactionPctRaw, elevatedPct, highPressurePct);
            compactionWarningActive = compactionWarningLevel !== 'none';
        }
        const compactionHealth = compactionWarningActive
            ? warningToHealth(compactionWarningLevel)
            : 'healthy';
        healthStatus = severityRank(compactionHealth) > severityRank(primaryHealth)
            ? compactionHealth
            : primaryHealth;
    }

    // Build threshold markers strictly on the ACTUAL displayed axis (`actualBasis`)
    const markers: ContextThresholdMarker[] = [];
    if (primaryLimit !== null && primaryLimit > 0) {
        const include200k = input.include200kMarker !== false;
        if (include200k && primaryLimit > LONG_CONTEXT_200K_TOKENS) {
            const pos = roundPct1((LONG_CONTEXT_200K_TOKENS / primaryLimit) * 100);
            if (pos > 0 && pos < 100) {
                markers.push({
                    id: 'tier_200k',
                    label: '200k',
                    tokens: LONG_CONTEXT_200K_TOKENS,
                    axis: actualBasis,
                    positionPct: pos,
                    exceeded: usedTokens !== null && usedTokens > LONG_CONTEXT_200K_TOKENS,
                });
            }
        }
        // When displaying on the native axis with a lower compaction ceiling, mark the compaction line!
        if (actualBasis === 'native' && hasDualCap && compactionLimit !== null && compactionLimit < primaryLimit) {
            const pos = roundPct1((compactionLimit / primaryLimit) * 100);
            if (pos > 0 && pos < 100) {
                markers.push({
                    id: 'compaction_limit',
                    label: 'Compaction',
                    tokens: compactionLimit,
                    axis: 'native',
                    positionPct: pos,
                    exceeded: usedTokens !== null && usedTokens >= compactionLimit,
                });
            }
        }
        if (Array.isArray(input.extraThresholds)) {
            const seenIds = new Set(markers.map(m => m.id));
            for (const extra of input.extraThresholds) {
                const tok = normalizePositiveLimit(extra?.tokens);
                const id = normalizeNonEmptyString(extra?.id);
                const label = normalizeNonEmptyString(extra?.label);
                if (!id || !label || tok === null || tok >= primaryLimit || seenIds.has(id)) {
                    continue;
                }
                const pos = roundPct1((tok / primaryLimit) * 100);
                if (pos > 0 && pos < 100) {
                    seenIds.add(id);
                    markers.push({
                        id,
                        label,
                        tokens: tok,
                        axis: actualBasis,
                        positionPct: pos,
                        exceeded: usedTokens !== null && usedTokens >= tok,
                    });
                }
            }
        }
        markers.sort((a, b) => a.positionPct - b.positionPct || a.id.localeCompare(b.id));
    }

    // Confirmed 0-step fresh conversations ALWAYS have null speed and null session cost
    const displaySpeedTps = isZeroStepFresh || isIncomplete
        ? null
        : normalizePositiveSpeed(input.displaySpeedTps);
    const speedCallId = isZeroStepFresh || isIncomplete || displaySpeedTps === null
        ? null
        : normalizeNonEmptyString(input.speedCallId);
    const speedSampleScope: SpeedSampleScope = isZeroStepFresh || isIncomplete || displaySpeedTps === null
        ? 'none'
        : (input.speedSampleScope && input.speedSampleScope !== 'none'
            ? input.speedSampleScope
            : 'latest_call');
    const sessionCostUsd = isZeroStepFresh || isIncomplete
        ? null
        : normalizeFiniteNonNegNumber(input.sessionCostUsd);

    const observedAtMs = typeof input.observedAtMs === 'number' && Number.isFinite(input.observedAtMs)
        ? Math.round(input.observedAtMs)
        : Date.now();

    return deepFreeze<PublishedMonitorObservation>({
        backendEpoch,
        windowId,
        rootCascadeId,
        subjectCascadeId,
        subjectKind,
        selectionRevision,
        dataRevision,
        measuredModel,
        tokenSource,
        usedTokens,
        compactionLimit,
        compactionLimitProvenance,
        nativeLimit,
        nativeLimitProvenance,
        requestedBasis,
        actualBasis,
        primaryPct,
        primaryPctRaw,
        speedMode,
        speedSampleScope,
        speedCallId,
        displaySpeedTps,
        isZeroStepFresh,
        isIncomplete,
        primaryLimit,
        secondaryLimit,
        secondaryBasis,
        secondaryPct,
        secondaryPctRaw,
        compactionPct,
        compactionPctRaw,
        nativePct,
        nativePctRaw,
        isSingleScale,
        hasDualCap,
        isOverflow,
        geometryFillPct,
        healthStatus,
        compactionWarningActive,
        compactionWarningLevel,
        markers,
        sessionCostUsd,
        observedAtMs,
    });
}

// ─── Pure Surface Projection Helpers ─────────────────────────────────────────

/**
 * Format the canonical primary percentage string from a `PublishedMonitorObservation`:
 * - Incomplete -> `'—'` (NEVER `'0%'`)
 * - Confirmed 0-step fresh -> `'0%'`
 * - Measured (including overflow > 100%) -> exact 1-decimal trimmed text (e.g. `'21%'`, `'21.4%'`, `'112%'`).
 */
export function formatObservationPrimaryPct(obs: PublishedMonitorObservation): string {
    if (obs.isIncomplete || obs.primaryPct === null || !Number.isFinite(obs.primaryPct)) {
        return '—';
    }
    if (obs.isZeroStepFresh) {
        return '0%';
    }
    return `${obs.primaryPct.toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * Project a `PublishedMonitorObservation` onto any target display surface while
 * guaranteeing 100% parity on primary %, denominator, rounding, health status,
 * compaction warnings, and threshold markers.
 */
export function projectObservationForSurface(
    obs: PublishedMonitorObservation,
    surface: MonitorDisplaySurface,
): SurfaceObservationProjection {
    const primaryPctText = formatObservationPrimaryPct(obs);
    const primaryPctRoundedInt = obs.isIncomplete || obs.primaryPctRaw === null
        ? null
        : (obs.isZeroStepFresh ? 0 : Math.round(obs.primaryPctRaw));

    return deepFreeze<SurfaceObservationProjection>({
        surface,
        backendEpoch: obs.backendEpoch,
        windowId: obs.windowId,
        rootCascadeId: obs.rootCascadeId,
        subjectCascadeId: obs.subjectCascadeId,
        subjectKind: obs.subjectKind,
        selectionRevision: obs.selectionRevision,
        dataRevision: obs.dataRevision,
        measuredModel: obs.measuredModel,
        actualBasis: obs.actualBasis,
        requestedBasis: obs.requestedBasis,
        usedTokens: obs.usedTokens,
        denominatorTokens: obs.primaryLimit,
        secondaryDenominatorTokens: obs.secondaryLimit,
        secondaryBasis: obs.secondaryBasis,
        primaryPct: obs.primaryPct,
        primaryPctRaw: obs.primaryPctRaw,
        primaryPctRoundedInt,
        primaryPctText,
        geometryFillPct: obs.geometryFillPct,
        healthStatus: obs.healthStatus,
        compactionWarningActive: obs.compactionWarningActive,
        compactionWarningLevel: obs.compactionWarningLevel,
        compactionPct: obs.compactionPct,
        isSingleScale: obs.isSingleScale,
        hasDualCap: obs.hasDualCap,
        isOverflow: obs.isOverflow,
        isZeroStepFresh: obs.isZeroStepFresh,
        isIncomplete: obs.isIncomplete,
        markers: obs.markers.map(m => ({ ...m })),
        speedMode: obs.speedMode,
        speedSampleScope: obs.speedSampleScope,
        speedCallId: obs.speedCallId,
        displaySpeedTps: obs.displaySpeedTps,
        sessionCostUsd: obs.sessionCostUsd,
    });
}

export function projectForOverview(obs: PublishedMonitorObservation): SurfaceObservationProjection {
    return projectObservationForSurface(obs, 'overview');
}

export function projectForNativeHud(obs: PublishedMonitorObservation): SurfaceObservationProjection {
    return projectObservationForSurface(obs, 'native_hud');
}

export function projectForCdpTopbar(obs: PublishedMonitorObservation): SurfaceObservationProjection {
    return projectObservationForSurface(obs, 'cdp_topbar');
}

export function projectForCdpComposerRing(obs: PublishedMonitorObservation): SurfaceObservationProjection {
    return projectObservationForSurface(obs, 'cdp_composer_ring');
}

export function projectForIdeStatusBar(obs: PublishedMonitorObservation): SurfaceObservationProjection {
    return projectObservationForSurface(obs, 'ide_status_bar');
}

/**
 * Verify cross-surface parity across all projections sharing the same
 * `(subjectCascadeId, dataRevision)`.
 */
export function verifySurfaceProjectionParity(
    projections: readonly SurfaceObservationProjection[],
): ObservationParityCheckResult {
    if (projections.length <= 1) {
        return { ok: true, mismatches: [] };
    }
    const base = projections[0];
    const mismatches: string[] = [];
    const baseMarkersJson = JSON.stringify(base.markers);

    for (let i = 1; i < projections.length; i++) {
        const cur = projections[i];
        if (cur.subjectCascadeId !== base.subjectCascadeId || cur.dataRevision !== base.dataRevision) {
            continue;
        }
        const tag = `${base.surface} vs ${cur.surface}`;
        if (cur.primaryPct !== base.primaryPct) {
            mismatches.push(`${tag}: primaryPct ${base.primaryPct} !== ${cur.primaryPct}`);
        }
        if (cur.primaryPctText !== base.primaryPctText) {
            mismatches.push(`${tag}: primaryPctText ${base.primaryPctText} !== ${cur.primaryPctText}`);
        }
        if (cur.primaryPctRoundedInt !== base.primaryPctRoundedInt) {
            mismatches.push(`${tag}: primaryPctRoundedInt ${base.primaryPctRoundedInt} !== ${cur.primaryPctRoundedInt}`);
        }
        if (cur.denominatorTokens !== base.denominatorTokens) {
            mismatches.push(`${tag}: denominatorTokens ${base.denominatorTokens} !== ${cur.denominatorTokens}`);
        }
        if (cur.actualBasis !== base.actualBasis) {
            mismatches.push(`${tag}: actualBasis ${base.actualBasis} !== ${cur.actualBasis}`);
        }
        if (cur.healthStatus !== base.healthStatus) {
            mismatches.push(`${tag}: healthStatus ${base.healthStatus} !== ${cur.healthStatus}`);
        }
        if (cur.compactionWarningActive !== base.compactionWarningActive
            || cur.compactionWarningLevel !== base.compactionWarningLevel) {
            mismatches.push(`${tag}: compactionWarning mismatch`);
        }
        if (cur.geometryFillPct !== base.geometryFillPct) {
            mismatches.push(`${tag}: geometryFillPct ${base.geometryFillPct} !== ${cur.geometryFillPct}`);
        }
        if (cur.displaySpeedTps !== base.displaySpeedTps) {
            mismatches.push(`${tag}: displaySpeedTps ${base.displaySpeedTps} !== ${cur.displaySpeedTps}`);
        }
        if (JSON.stringify(cur.markers) !== baseMarkersJson) {
            mismatches.push(`${tag}: markers mismatch`);
        }
    }

    return { ok: mismatches.length === 0, mismatches };
}

// ─── Per-Run Opaque Diagnostic Alias Mapper ──────────────────────────────────

/**
 * Run-scoped opaque alias registry for privacy-safe diagnostic logging.
 * Maps raw cascade IDs, models, labels, window IDs, and call IDs to opaque
 * tokens (`conv_1`, `model_1`, `label_1`, `win_1`, `call_1`) so diagnostics
 * NEVER log conversation titles, file paths, emails, credentials, or prompts.
 */
export class DiagnosticAliasMap {
    private readonly convAliases = new Map<string, string>();
    private readonly modelAliases = new Map<string, string>();
    private readonly labelAliases = new Map<string, string>();
    private readonly windowAliases = new Map<string, string>();
    private readonly callAliases = new Map<string, string>();

    private getOrAssign(map: Map<string, string>, prefix: string, raw: string | null | undefined): string | null {
        const clean = normalizeNonEmptyString(raw);
        if (!clean) { return null; }
        const existing = map.get(clean);
        if (existing) { return existing; }
        const alias = `${prefix}_${map.size + 1}`;
        map.set(clean, alias);
        return alias;
    }

    public aliasConversation(cascadeId: string | null | undefined): string | null {
        return this.getOrAssign(this.convAliases, 'conv', cascadeId);
    }

    public aliasModel(modelId: string | null | undefined): string | null {
        return this.getOrAssign(this.modelAliases, 'model', modelId);
    }

    public aliasLabel(label: string | null | undefined): string | null {
        return this.getOrAssign(this.labelAliases, 'label', label);
    }

    public aliasWindow(windowId: string | null | undefined): string {
        return this.getOrAssign(this.windowAliases, 'win', windowId) ?? 'win_0';
    }

    public aliasCall(callId: string | null | undefined): string | null {
        return this.getOrAssign(this.callAliases, 'call', callId);
    }

    public reset(): void {
        this.convAliases.clear();
        this.modelAliases.clear();
        this.labelAliases.clear();
        this.windowAliases.clear();
        this.callAliases.clear();
    }
}

/**
 * Serialize a `PublishedMonitorObservation` into a strictly sanitized diagnostic
 * record using opaque run-scoped aliases — NEVER including raw IDs, titles,
 * filesystem paths, credentials, or prompt content.
 */
export function formatObservationDiagnostic(
    obs: PublishedMonitorObservation,
    aliasMap: DiagnosticAliasMap,
): SanitizedObservationDiagnostic {
    return Object.freeze({
        backendEpoch: obs.backendEpoch,
        windowAlias: aliasMap.aliasWindow(obs.windowId),
        rootAlias: aliasMap.aliasConversation(obs.rootCascadeId),
        subjectAlias: aliasMap.aliasConversation(obs.subjectCascadeId),
        subjectKind: obs.subjectKind,
        selectionRevision: obs.selectionRevision,
        dataRevision: obs.dataRevision,
        modelAlias: aliasMap.aliasModel(obs.measuredModel),
        tokenSource: obs.tokenSource,
        usedTokens: obs.usedTokens,
        compactionLimit: obs.compactionLimit,
        compactionLimitProvenance: obs.compactionLimitProvenance,
        nativeLimit: obs.nativeLimit,
        nativeLimitProvenance: obs.nativeLimitProvenance,
        requestedBasis: obs.requestedBasis,
        actualBasis: obs.actualBasis,
        primaryPct: obs.primaryPct,
        primaryPctRaw: obs.primaryPctRaw,
        geometryFillPct: obs.geometryFillPct,
        healthStatus: obs.healthStatus,
        compactionWarningActive: obs.compactionWarningActive,
        compactionWarningLevel: obs.compactionWarningLevel,
        speedMode: obs.speedMode,
        speedSampleScope: obs.speedSampleScope,
        speedCallAlias: aliasMap.aliasCall(obs.speedCallId),
        displaySpeedTps: obs.displaySpeedTps,
        isZeroStepFresh: obs.isZeroStepFresh,
        isIncomplete: obs.isIncomplete,
        observedAtMs: obs.observedAtMs,
    });
}

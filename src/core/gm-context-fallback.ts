/**
 * Shared Pure-TypeScript GM Context Fallback Selector (D9 §3.1).
 *
 * Strictly zero `vscode` imports and zero external npm dependencies.
 * Unifies the previously diverged App (reverse array walk) vs IDE (lexicographic
 * `createdAt`) fallback selection into one deterministic, rewind/compaction-safe
 * selector.
 *
 * Guarantees:
 * - Compares candidates by normalized UTC numeric epoch timestamp (correctly
 *   handling timezone offsets, variable fractional seconds, numeric ms, and Date).
 * - Breaks timestamp ties using known `stepIndex`, explicit `callOrder`, and
 *   array index (never relying on fragile string ordering).
 * - Rejects stale high-water readings whose timestamp or step index precedes a
 *   known rewind or compaction boundary (`minTimestampMs`, `minStepIndex`,
 *   `compactionBoundary`).
 * - Fails closed on undated/unindexed readings when a boundary is active so a
 *   delayed pre-compaction sample cannot restore an old high-water reading.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GMContextCallLike {
    contextTokensUsed?: number | null;
    createdAt?: string | number | Date | null;
    stepIndices?: readonly number[] | null;
    startStepIndex?: number | null;
    latestStableMessageIndex?: number | null;
    callOrder?: number | null;
    executionId?: string | null;
}

export interface GMCompactionBoundary {
    /** Rewind/compaction boundary timestamp (epoch ms, ISO string, or Date). */
    timestampMs?: number | string | Date | null;
    /** Rewind/compaction boundary step index (non-negative integer). */
    stepIndex?: number | null;
    /**
     * When `true`, calls strictly equal to the boundary are also rejected (`<=` instead of `<`).
     * Default: `false` (calls at or after the boundary are eligible).
     */
    exclusive?: boolean;
}

export interface GMContextFallbackOptions {
    /** Minimum eligible call timestamp (rejects older calls). */
    minTimestampMs?: number | string | Date | null;
    /** Minimum eligible call step index (rejects calls with smaller step indices). */
    minStepIndex?: number | null;
    /** Optional structured compaction or rewind boundary. */
    compactionBoundary?: GMCompactionBoundary | null;
    /**
     * When `true`, `minTimestampMs` / `minStepIndex` comparisons reject equality too.
     * Default: `false`.
     */
    exclusive?: boolean;
    /**
     * When a timestamp or step boundary is active, reject candidates missing the
     * corresponding timestamp/step evidence rather than letting undated pre-compaction
     * samples slip through. Default: `true` (fail-closed).
     */
    rejectUndatedWhenBounded?: boolean;
}

export interface GMContextFallbackSelection {
    contextTokensUsed: number;
    callIndex: number;
    timestampMs: number | null;
    stepIndex: number | null;
    callOrder: number | null;
    executionId?: string;
}

export interface GMConversationLike {
    cascadeId: string;
    calls: readonly GMContextCallLike[];
}

export interface GMSummaryLike {
    conversations: readonly GMConversationLike[];
}

// ─── Normalization Helpers ───────────────────────────────────────────────────

const ISO_DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/;

/**
 * Normalize an ISO timestamp string, numeric epoch ms, numeric string, or `Date`
 * into a finite UTC epoch millisecond value, or `null` when missing/malformed.
 *
 * Rejects impossible calendar dates that JavaScript's `Date.parse` would silently
 * roll over (e.g. `2026-02-30T00:00:00Z`).
 */
export function normalizeEpochMs(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) && ms >= 0 ? ms : null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    // Pure numeric epoch ms string (e.g. "1732689600000")
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const n = Number(trimmed);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }

    // Validate calendar date component against JS Date rollover (e.g. Feb 30 -> Mar 2)
    const dateMatch = ISO_DATE_PREFIX_RE.exec(trimmed);
    if (dateMatch) {
        const year = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const day = Number(dateMatch[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) {
            return null;
        }
        const check = new Date(Date.UTC(year, month - 1, day));
        if (
            check.getUTCFullYear() !== year
            || check.getUTCMonth() !== month - 1
            || check.getUTCDate() !== day
        ) {
            return null;
        }
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Extract the effective step index for a GM call entry.
 * Prefers the highest valid non-negative integer in `stepIndices`, falling back
 * to `startStepIndex`.
 */
export function extractEffectiveStepIndex(call: GMContextCallLike): number | null {
    let best: number | null = null;
    if (Array.isArray(call.stepIndices)) {
        for (const idx of call.stepIndices) {
            if (typeof idx === 'number' && Number.isSafeInteger(idx) && idx >= 0) {
                if (best === null || idx > best) {
                    best = idx;
                }
            }
        }
    }
    if (best !== null) {
        return best;
    }
    if (
        typeof call.startStepIndex === 'number'
        && Number.isSafeInteger(call.startStepIndex)
        && call.startStepIndex >= 0
    ) {
        return call.startStepIndex;
    }
    return null;
}

function normalizeStepBound(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        return null;
    }
    return value;
}

function normalizeCallOrder(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

// ─── Candidate Comparison & Selection ────────────────────────────────────────

/**
 * Deterministic strict total lexicographic comparator between two GM context candidates.
 * Returns `> 0` if `a` is newer than `b`, `< 0` if `b` is newer, `0` if tied.
 *
 * Strict total ordering precedence (guaranteed transitive & sort-safe):
 * 1. Dated (`timestampMs !== null`) always outranks undated (`timestampMs === null`).
 * 2. Normalized UTC epoch `timestampMs` (higher wins).
 * 3. `stepIndex` (present outranks `null`; higher wins).
 * 4. `callOrder` (present outranks `null`; higher wins).
 * 5. `callIndex` (later array position wins).
 */
export function compareGMContextCandidates(
    a: GMContextFallbackSelection,
    b: GMContextFallbackSelection,
): number {
    const aHasTs = a.timestampMs !== null;
    const bHasTs = b.timestampMs !== null;

    if (aHasTs !== bHasTs) {
        return aHasTs ? 1 : -1;
    }
    if (aHasTs && bHasTs && a.timestampMs !== b.timestampMs) {
        return a.timestampMs! - b.timestampMs!;
    }

    if (a.stepIndex !== null && b.stepIndex !== null) {
        if (a.stepIndex !== b.stepIndex) {
            return a.stepIndex - b.stepIndex;
        }
    } else if (a.stepIndex !== null || b.stepIndex !== null) {
        return a.stepIndex !== null ? 1 : -1;
    }

    if (a.callOrder !== null && b.callOrder !== null) {
        if (a.callOrder !== b.callOrder) {
            return a.callOrder - b.callOrder;
        }
    } else if (a.callOrder !== null || b.callOrder !== null) {
        return a.callOrder !== null ? 1 : -1;
    }

    return a.callIndex - b.callIndex;
}

interface EffectiveBounds {
    minTs: number | null;
    tsExclusive: boolean;
    minStep: number | null;
    stepExclusive: boolean;
    rejectUndatedWhenBounded: boolean;
}

function resolveEffectiveBounds(options?: GMContextFallbackOptions): EffectiveBounds {
    const optExclusive = options?.exclusive === true;
    const cb = options?.compactionBoundary;
    const cbExclusive = cb?.exclusive === true;

    const optTs = normalizeEpochMs(options?.minTimestampMs);
    const cbTs = normalizeEpochMs(cb?.timestampMs);
    let minTs: number | null = null;
    let tsExclusive = false;
    if (optTs !== null && cbTs !== null) {
        if (cbTs > optTs) {
            minTs = cbTs;
            tsExclusive = cbExclusive;
        } else if (optTs > cbTs) {
            minTs = optTs;
            tsExclusive = optExclusive;
        } else {
            minTs = optTs;
            tsExclusive = optExclusive || cbExclusive;
        }
    } else if (cbTs !== null) {
        minTs = cbTs;
        tsExclusive = cbExclusive;
    } else if (optTs !== null) {
        minTs = optTs;
        tsExclusive = optExclusive;
    }

    const optStep = normalizeStepBound(options?.minStepIndex);
    const cbStep = normalizeStepBound(cb?.stepIndex);
    let minStep: number | null = null;
    let stepExclusive = false;
    if (optStep !== null && cbStep !== null) {
        if (cbStep > optStep) {
            minStep = cbStep;
            stepExclusive = cbExclusive;
        } else if (optStep > cbStep) {
            minStep = optStep;
            stepExclusive = optExclusive;
        } else {
            minStep = optStep;
            stepExclusive = optExclusive || cbExclusive;
        }
    } else if (cbStep !== null) {
        minStep = cbStep;
        stepExclusive = cbExclusive;
    } else if (optStep !== null) {
        minStep = optStep;
        stepExclusive = optExclusive;
    }

    return {
        minTs,
        tsExclusive,
        minStep,
        stepExclusive,
        rejectUndatedWhenBounded: options?.rejectUndatedWhenBounded ?? true,
    };
}

function passesBoundaries(
    timestampMs: number | null,
    stepIndex: number | null,
    bounds: EffectiveBounds,
): boolean {
    if (bounds.minTs !== null) {
        if (timestampMs === null) {
            if (bounds.rejectUndatedWhenBounded) {
                return false;
            }
        } else if (bounds.tsExclusive ? timestampMs <= bounds.minTs : timestampMs < bounds.minTs) {
            return false;
        }
    }

    if (bounds.minStep !== null) {
        if (stepIndex === null) {
            if (bounds.rejectUndatedWhenBounded) {
                return false;
            }
        } else if (bounds.stepExclusive ? stepIndex <= bounds.minStep : stepIndex < bounds.minStep) {
            return false;
        }
    }

    return true;
}

/**
 * Select the single latest eligible GM call carrying a positive integer
 * `contextTokensUsed`, honoring rewind/compaction boundaries and deterministic
 * timestamp + step/order tie-breaking.
 */
export function selectLatestGMContextCall(
    calls: readonly GMContextCallLike[] | null | undefined,
    options?: GMContextFallbackOptions,
): GMContextFallbackSelection | null {
    if (!Array.isArray(calls) || calls.length === 0) {
        return null;
    }

    const bounds = resolveEffectiveBounds(options);
    let best: GMContextFallbackSelection | null = null;

    for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        if (!call || typeof call !== 'object') { continue; }
        const tokens = call.contextTokensUsed;
        if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens <= 0) {
            continue;
        }

        const timestampMs = normalizeEpochMs(call.createdAt);
        const stepIndex = extractEffectiveStepIndex(call);
        if (!passesBoundaries(timestampMs, stepIndex, bounds)) {
            continue;
        }

        const callOrder = normalizeCallOrder(call.callOrder);
        const candidate: GMContextFallbackSelection = {
            contextTokensUsed: tokens,
            callIndex: i,
            timestampMs,
            stepIndex,
            callOrder,
            ...(typeof call.executionId === 'string' && call.executionId.trim()
                ? { executionId: call.executionId.trim() }
                : {}),
        };

        if (!best || compareGMContextCandidates(candidate, best) > 0) {
            best = candidate;
        }
    }

    return best;
}

/**
 * Unified replacement for App (`sidecar-runtime.ts`) and IDE (`extension.ts`)
 * `getLatestGMContextUsed`.
 *
 * Returns the latest eligible `contextTokensUsed` (> 0) or `0` if none qualify.
 */
export function getLatestGMContextUsed(
    calls: readonly GMContextCallLike[] | null | undefined,
    options?: GMContextFallbackOptions,
): number {
    return selectLatestGMContextCall(calls, options)?.contextTokensUsed ?? 0;
}

/**
 * Convenience helper accepting a `GMSummary` + `cascadeId` for direct consumption
 * by both App Sidecar and IDE extension runtimes.
 */
export function getLatestGMContextUsedForCascade(
    summary: GMSummaryLike | null | undefined,
    cascadeId: string | null | undefined,
    options?: GMContextFallbackOptions,
): number {
    if (!summary || !Array.isArray(summary.conversations) || !cascadeId) {
        return 0;
    }
    const conv = summary.conversations.find((c) => c && c.cascadeId === cascadeId);
    if (!conv) {
        return 0;
    }
    return getLatestGMContextUsed(conv.calls, options);
}

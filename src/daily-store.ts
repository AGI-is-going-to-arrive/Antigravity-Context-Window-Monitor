// ─── Daily Store ─────────────────────────────────────────────────────────────
// Aggregates Activity, GM, and Pricing snapshots by date for the Calendar tab.
// Each day gets a single aggregated entry, written when the local date rolls over.
// Persisted via globalState for cross-session survival.

import type { ActivityArchive, ActivitySummary } from './activity-tracker';
import type { GMSummary, GMModelStats } from './gm-tracker';
import {
    UNATTRIBUTED_WORKSPACE_KEY,
    addCallToWorkspaceBreakdown,
    addSurfaceStats,
    canonicalLogicalCallId,
    cloneSurfaceBreakdown,
    cloneWorkspaceBreakdown,
    dominantUsageSurface,
    normalizeUsageSurface,
    normalizeWorkspaceKey,
    type SurfaceUsageStats,
    type UsageSurface,
    type WorkspaceUsageStats,
} from './daily-ledger';
import { normalizeModelDisplayName } from './models';
import type { ModelPricing } from './pricing-store';
import { DEFAULT_PRICING, findPricingForDate, costFromTokens } from './pricing-store';
import { MIN_OUTPUT_TOKENS_FOR_SPEED, MIN_STREAM_SECONDS } from './telemetry-metrics';

export type { SurfaceUsageStats, UsageSurface, WorkspaceUsageStats };

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-model breakdown within a cycle */
export interface ModelCycleStats {
    reasoning: number;
    toolCalls: number;
    errors: number;
    estSteps: number;
    inputTokens: number;
    outputTokens: number;
}

/** Per-model GM breakdown within a cycle */
export interface GMModelCycleStats {
    calls: number;
    credits: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    avgTTFT: number;
    cacheHitRate: number;
    estimatedCost?: number;     // USD per-model cost
    /** Set when estimatedCost was re-priced from tokens after the fact — see
     *  DailyStore.backfillMissingCosts. On legacy records without cacheReadTokens
     *  such a figure excludes cache reads and is an underestimate. */
    costBackfilled?: true;
    /** Preserved cache read tokens across archival/rollover (optional for v1 compat) */
    cacheReadTokens?: number;
    /** Preserved cache creation/write tokens across archival/rollover (optional for v1 compat) */
    cacheCreationTokens?: number;
    /** Average streaming/decode duration in seconds across timed calls (optional for v1 compat) */
    avgStreaming?: number;
    /** Weighted output generation speed (tok/s) across speed-valid calls (optional for v1 compat) */
    avgGenTokPerSec?: number;
    /** Token-weighted prompt cache hit rate: cacheRead / (input + cacheRead + cacheCreation) */
    tokenCacheHitRate?: number;
}

/** Per-call record persisted for idempotent late-day merging & cross-host 3-way reconciliation. */
export interface DailyMergedLateCall {
    /** Original rollover projection retained only for the two most recent archived dates. */
    fromDaySnapshot?: true;
    callId: string;
    createdAt: string;
    createdAtMs: number;
    modelId: string;
    modelKey: string;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    estimatedCost: number;
    ttftSeconds?: number;
    streamingSeconds?: number;
    surface?: UsageSurface;
    accountEmail?: string;
    /** Account identifier preserved across late-day merge (optional for v1 compat). */
    account?: string;
    /** Host/remote authority preserved across late-day merge (optional for v1 compat). */
    authority?: string;
    /** Conversation cascadeId preserved across late-day merge (optional for v1 compat). */
    cascadeId?: string;
    /** Canonical workspace key captured at ingestion time (optional for v1 compat). */
    workspace?: string;
    /** True when the call's model had no resolved pricing. */
    unpriced?: boolean;
}

/** A single quota-cycle snapshot within a day */
export interface DailyCycleEntry {
    startTime: string;               // ISO
    endTime: string;                 // ISO
    triggeredBy?: string[];          // models whose quota reset triggered this
    // Activity
    totalReasoning: number;
    totalToolCalls: number;
    totalErrors: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    estSteps: number;
    modelNames: string[];            // distinct model display names
    /** Per-model breakdown (key = display name) */
    modelStats?: Record<string, ModelCycleStats>;
    // GM
    gmTotalCalls?: number;
    gmTotalCredits?: number;
    gmTotalTokens?: number;          // legacy input + output (retained for backward compatibility)
    /** Additive total tokens: input + cacheRead + cacheCreation + output (optional for v1 compat) */
    gmTotalAllTokens?: number;
    /** Total cache read tokens across all models in this cycle (optional for v1 compat) */
    gmTotalCacheRead?: number;
    /** Total cache creation/write tokens across all models in this cycle (optional for v1 compat) */
    gmTotalCacheCreation?: number;
    /** Total thinking tokens (subset of outputTokens) across all models in this cycle (optional for v1 compat) */
    gmTotalThinkingTokens?: number;
    gmRetryTokens?: number;          // retry overhead: tokens wasted
    gmRetryCredits?: number;         // retry overhead: credits lost
    gmRetryCount?: number;           // retry overhead: number of retried calls
    // Cost
    estimatedCost?: number;          // USD grand total
    // GM per-model breakdown
    gmModelStats?: Record<string, GMModelCycleStats>;
    /** Account email that produced this cycle (multi-account isolation) */
    accountEmail?: string;
    /** Origin surface ('app' | 'ide' | 'cli' | 'unknown'); omitted on legacy untagged records */
    surface?: UsageSurface;
    /** Per-surface split when multiple surfaces contributed to the same archived cycle */
    surfaceBreakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    /** Per-workspace attribution breakdown preserved across archival & late-day merge */
    workspaceBreakdown?: Record<string, WorkspaceUsageStats>;
    /** Canonical logical call IDs already included in this archived cycle (for idempotent late-call dedup) */
    recordedCallIds?: string[];
    /** Late-merged calls keyed by canonical logical call ID (enables lossless App + IDE 3-way merge) */
    lateMergedCalls?: Record<string, DailyMergedLateCall>;
    /** Runtime-only flag for live merged ledger cycles (never persisted to DailyStore) */
    isLive?: boolean;
}

/** All cycles for a single calendar day */
export interface DailyRecord {
    date: string;                    // 'YYYY-MM-DD'
    cycles: DailyCycleEntry[];
}

/** Project all persisted identity-bearing keys and values before rendering a masked archive. */
export function redactDailyRecordIdentities(record: DailyRecord, handle: (value: string) => string): DailyRecord {
    const workspaceHandle = (workspace: string) =>
        workspace === UNATTRIBUTED_WORKSPACE_KEY ? workspace : handle(workspace);
    return {
        date: record.date,
        cycles: record.cycles.map(cycle => ({
            ...cycle,
            ...(cycle.accountEmail ? { accountEmail: handle(cycle.accountEmail) } : {}),
            ...(cycle.recordedCallIds ? { recordedCallIds: cycle.recordedCallIds.map(handle) } : {}),
            ...(cycle.workspaceBreakdown ? {
                workspaceBreakdown: Object.fromEntries(Object.entries(cycle.workspaceBreakdown).map(([workspace, stats]) => [
                    workspaceHandle(workspace),
                    { ...stats, ...(stats.authority ? { authority: handle(stats.authority) } : {}) },
                ])),
            } : {}),
            ...(cycle.lateMergedCalls ? {
                lateMergedCalls: Object.fromEntries(Object.entries(cycle.lateMergedCalls).map(([key, call]) => [
                    handle(key),
                    {
                        ...call,
                        callId: handle(call.callId),
                        ...(call.accountEmail ? { accountEmail: handle(call.accountEmail) } : {}),
                        ...(call.account ? { account: handle(call.account) } : {}),
                        ...(call.authority ? { authority: handle(call.authority) } : {}),
                        ...(call.workspace ? { workspace: workspaceHandle(call.workspace) } : {}),
                        ...(call.cascadeId ? { cascadeId: handle(call.cascadeId) } : {}),
                    },
                ])),
            } : {}),
        })),
    };
}

/** Month-cell summary for calendar grid rendering */
export interface MonthCellSummary {
    date: string;                    // 'YYYY-MM-DD'
    cycleCount: number;
    totalReasoning: number;
    totalToolCalls: number;
    totalCost: number;
    gmCalls: number;
    /** Additive total tokens (input + cacheRead + cacheCreation + output) */
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    thinkingTokens?: number;
    /** Distinct surfaces observed on this date */
    surfaces?: UsageSurface[];
}

/** Per-model cost aggregation for a month */
export interface MonthModelCost {
    name: string;
    totalCost: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    credits: number;
}

/** Monthly cost breakdown result */
export interface MonthCostBreakdown {
    year: number;
    month: number;
    grandTotal: number;
    cycleCount: number;
    earliestDate: string;           // earliest recorded date in this month ('' if none)
    models: MonthModelCost[];
}

/** Serialized state for globalState */
export interface DailyStoreState {
    version: 1;
    records: Record<string, DailyRecord>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract 'YYYY-MM-DD' from an ISO timestamp using LOCAL time */
function toDateKey(iso: string): string {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Get distinct model names from an ActivitySummary's modelStats */
function extractModelNames(modelStats: Record<string, unknown>): string[] {
    return Object.keys(modelStats);
}

function buildPerModelStats(modelStats: Record<string, {
    reasoning: number;
    toolCalls: number;
    errors: number;
    estSteps: number;
    inputTokens: number;
    outputTokens: number;
}>): Record<string, ModelCycleStats> | undefined {
    const perModel: Record<string, ModelCycleStats> = {};
    for (const [name, ms] of Object.entries(modelStats)) {
        perModel[name] = {
            reasoning: ms.reasoning,
            toolCalls: ms.toolCalls,
            errors: ms.errors,
            estSteps: ms.estSteps,
            inputTokens: ms.inputTokens,
            outputTokens: ms.outputTokens,
        };
    }
    return Object.keys(perModel).length > 0 ? perModel : undefined;
}

export function buildGMPerModelStats(
    gmSummaryOrBreakdown?: GMSummary | Record<string, GMModelStats> | null,
    costPerModel?: Record<string, number>,
): Record<string, GMModelCycleStats> | undefined {
    const breakdown = gmSummaryOrBreakdown && 'modelBreakdown' in gmSummaryOrBreakdown
        ? gmSummaryOrBreakdown.modelBreakdown
        : gmSummaryOrBreakdown || undefined;
    if (!breakdown) { return undefined; }
    const gmPerModel: Record<string, GMModelCycleStats> = {};
    for (const [name, ms] of Object.entries(breakdown)) {
        const totalPromptTokens = (ms.totalInputTokens || 0)
            + (ms.totalCacheRead || 0)
            + (ms.totalCacheCreation || 0);
        const tokenCacheHitRate = totalPromptTokens > 0
            ? Math.min(1, Math.max(0, (ms.totalCacheRead || 0) / totalPromptTokens))
            : undefined;

        let avgGenTokPerSec: number | undefined;
        if (ms.timedOutputTokens && ms.timedOutputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED
            && ms.timedStreamingSeconds && ms.timedStreamingSeconds >= MIN_STREAM_SECONDS) {
            avgGenTokPerSec = ms.timedOutputTokens / ms.timedStreamingSeconds;
        } else if (ms.timedOutputTokens === undefined && ms.timedStreamingSeconds === undefined
            && ms.avgStreaming >= MIN_STREAM_SECONDS
            && ms.totalOutputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED
            && ms.callCount > 0) {
            const streamCount = ms.streamingSampleCount !== undefined ? ms.streamingSampleCount : ms.callCount;
            const totalStream = ms.avgStreaming * streamCount;
            if (streamCount > 0 && totalStream >= MIN_STREAM_SECONDS) {
                avgGenTokPerSec = ms.totalOutputTokens / totalStream;
            }
        }

        const entry: GMModelCycleStats = {
            calls: ms.callCount,
            credits: ms.totalCredits,
            inputTokens: ms.totalInputTokens,
            outputTokens: ms.totalOutputTokens,
            thinkingTokens: ms.totalThinkingTokens,
            avgTTFT: ms.avgTTFT,
            cacheHitRate: ms.cacheHitRate,
            estimatedCost: costPerModel?.[name],
            cacheReadTokens: ms.totalCacheRead,
            cacheCreationTokens: ms.totalCacheCreation,
        };
        if (ms.avgStreaming > 0) {
            entry.avgStreaming = ms.avgStreaming;
        }
        if (avgGenTokPerSec !== undefined && Number.isFinite(avgGenTokPerSec) && avgGenTokPerSec > 0) {
            entry.avgGenTokPerSec = avgGenTokPerSec;
        }
        if (tokenCacheHitRate !== undefined) {
            entry.tokenCacheHitRate = tokenCacheHitRate;
        }
        gmPerModel[name] = entry;
    }
    return Object.keys(gmPerModel).length > 0 ? gmPerModel : undefined;
}

/**
 * Whether a cycle's day total is fully explained by the rows that already carry a cost.
 *
 * Filling a row also adds its cost to the day total, which is only correct if that money is not
 * in the total already. It can be: the legacy archival path used to key per-model costs by the
 * normalized display name while the rows are keyed by the raw model id, so when those disagreed
 * every row was written without a cost even though the day total held the full amount. Adding to
 * that total would double the day, permanently and with no trace — a second run would find every
 * row priced and report nothing to fix. When the total exceeds what the priced rows account for,
 * the excess belongs to the unpriced rows, so leave the cycle alone.
 */
function cycleTotalIsAccountedFor(cycle: DailyCycleEntry): boolean {
    const total = cycle.estimatedCost || 0;
    if (total <= 0) { return true; }
    let priced = 0;
    for (const gms of Object.values(cycle.gmModelStats || {})) {
        priced += gms.estimatedCost || 0;
    }
    // Tolerance covers float drift from summing many per-call costs, not a real shortfall.
    return total - priced <= Math.max(1e-9, total * 1e-9);
}

/** Options for {@link DailyStore.backfillMissingCosts}. */
export interface CostBackfillOptions {
    /** Built-in pricing table to price against. Defaults to DEFAULT_PRICING. */
    basePricing?: Record<string, ModelPricing>;
}

/** Optional metadata when writing a daily snapshot. */
export interface DailySnapshotMetadata {
    surface?: UsageSurface;
    surfaceBreakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    workspaceBreakdown?: Record<string, WorkspaceUsageStats>;
    accountEmail?: string;
    /** Recent rollover contributions used to reconcile independent App / IDE archives. */
    snapshotCalls?: DailyMergedLateCall[];
    /** Canonical logical call IDs already included in this archived snapshot (for late-call dedup). */
    recordedCallIds?: string[];
}

/** Result of merging late-arriving calls into a historical date in {@link DailyStore}. */
export interface MergeLateDayCallsResult {
    /** Number of truly new unique calls merged (0 on duplicate replay). */
    appliedCalls: number;
    /** Canonical logical call IDs newly merged into the archived day. */
    appliedCallIds: string[];
    /** True when the synchronous persistence handoff did not throw (or no write was needed). */
    persisted: boolean;
    /** Resolves true once backing storage persistence confirms commit (false on rejection or uncommitted receipt). */
    persistPromise: Promise<boolean>;
}

/** Result of awaiting an async late-day merge & persistence confirmation. */
export interface MergeLateDayCallsAsyncResult {
    appliedCalls: number;
    appliedCallIds: string[];
    committed: boolean;
}

/** Optional initialization parameters for {@link DailyStore.init}. */
export interface DailyStoreInitOptions {
    /** Override maximum days retained (defaults to DEFAULT_MAX_DAYS = 400). */
    maxDays?: number;
}

/** Canonical additive token totals for a single cycle or record. */
export interface AdditiveTokenTotals {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens (thinking is a subset of output). */
    totalTokens: number;
}

function safeNonNeg(n: number | undefined): number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Antigravity additive token total:
 * `inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens`.
 * `thinkingTokens` is strictly a subset of `outputTokens` and is never added a second time.
 */
export function computeAdditiveTokens(t: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
}): number {
    return safeNonNeg(t.inputTokens)
        + safeNonNeg(t.cacheReadTokens)
        + safeNonNeg(t.cacheCreationTokens)
        + safeNonNeg(t.outputTokens);
}

function hasCompleteGmModelStats(cycle: DailyCycleEntry): boolean {
    const rows = Object.values(cycle.gmModelStats ?? {});
    return rows.length > 0 && rows.reduce((sum, row) => sum + safeNonNeg(row.calls), 0) >= safeNonNeg(cycle.gmTotalCalls);
}

/**
 * Compute additive token totals and breakdown for a single {@link DailyCycleEntry}.
 * Uses `gmModelStats` when present (most exact), with graceful fallback to cycle-level
 * fields for legacy archived records.
 */
export function computeCycleTokenTotals(cycle: DailyCycleEntry): AdditiveTokenTotals {
    if (hasCompleteGmModelStats(cycle)) {
        let inputTokens = 0;
        let outputTokens = 0;
        let thinkingTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        for (const gm of Object.values(cycle.gmModelStats!)) {
            inputTokens += safeNonNeg(gm.inputTokens);
            outputTokens += safeNonNeg(gm.outputTokens);
            thinkingTokens += safeNonNeg(gm.thinkingTokens);
            cacheReadTokens += safeNonNeg(gm.cacheReadTokens);
            cacheCreationTokens += safeNonNeg(gm.cacheCreationTokens);
        }
        return {
            inputTokens,
            outputTokens,
            thinkingTokens,
            cacheReadTokens,
            cacheCreationTokens,
            totalTokens: inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens,
        };
    }

    const cacheReadTokens = safeNonNeg(cycle.gmTotalCacheRead);
    const cacheCreationTokens = safeNonNeg(cycle.gmTotalCacheCreation);
    const thinkingTokens = safeNonNeg(cycle.gmTotalThinkingTokens);
    const inputTokens = safeNonNeg(cycle.totalInputTokens);
    const outputTokens = safeNonNeg(cycle.totalOutputTokens);
    const fallbackAll = safeNonNeg(cycle.gmTotalAllTokens);
    const fallbackLegacy = safeNonNeg(cycle.gmTotalTokens);

    const totalTokens = fallbackAll > 0
        ? fallbackAll
        : (fallbackLegacy > 0
            ? fallbackLegacy + cacheReadTokens + cacheCreationTokens
            : inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens);

    return {
        inputTokens,
        outputTokens,
        thinkingTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens,
    };
}

/** Extract distinct surfaces present on a cycle (backward-compatible default: ['unknown']). */
export function getCycleSurfaces(cycle: DailyCycleEntry): UsageSurface[] {
    const out = new Set<UsageSurface>();
    if (cycle.surfaceBreakdown) {
        for (const [key, stats] of Object.entries(cycle.surfaceBreakdown)) {
            if (stats && (stats.calls > 0 || computeAdditiveTokens(stats) > 0 || stats.estimatedCost > 0)) {
                out.add(normalizeUsageSurface(key));
            }
        }
    }
    if (out.size === 0) {
        out.add(normalizeUsageSurface(cycle.surface));
    }
    return [...out];
}

/** Collect all canonical logical call IDs already recorded across a cycle. */
export function collectCycleRecordedCallIds(cycle: DailyCycleEntry): Set<string> {
    const ids = new Set<string>();
    if (Array.isArray(cycle.recordedCallIds)) {
        for (const id of cycle.recordedCallIds) {
            if (typeof id === 'string' && id) {
                ids.add(id);
                ids.add(canonicalLogicalCallId(id));
            }
        }
    }
    if (cycle.lateMergedCalls && typeof cycle.lateMergedCalls === 'object') {
        for (const [key, call] of Object.entries(cycle.lateMergedCalls)) {
            if (key) {
                ids.add(key);
                ids.add(canonicalLogicalCallId(key));
            }
            if (call && typeof call.callId === 'string' && call.callId) {
                ids.add(call.callId);
                ids.add(canonicalLogicalCallId(call.callId));
            }
        }
    }
    return ids;
}

function cloneDailyCycleEntry(cycle: DailyCycleEntry): DailyCycleEntry {
    const clonedModelStats = cycle.modelStats
        ? Object.fromEntries(Object.entries(cycle.modelStats).map(([k, v]) => [k, { ...v }]))
        : undefined;
    const clonedGmModelStats = cycle.gmModelStats
        ? Object.fromEntries(Object.entries(cycle.gmModelStats).map(([k, v]) => [k, { ...v }]))
        : undefined;
    const clonedSurfaceBreakdown = cloneSurfaceBreakdown(cycle.surfaceBreakdown);
    const clonedWorkspaceBreakdown = cloneWorkspaceBreakdown(cycle.workspaceBreakdown);
    const clonedLateCalls = cycle.lateMergedCalls
        ? Object.fromEntries(Object.entries(cycle.lateMergedCalls).map(([k, v]) => [k, { ...v }]))
        : undefined;
    return {
        ...cycle,
        modelNames: [...(cycle.modelNames || [])],
        ...(cycle.triggeredBy ? { triggeredBy: [...cycle.triggeredBy] } : {}),
        ...(clonedModelStats ? { modelStats: clonedModelStats } : {}),
        ...(clonedGmModelStats ? { gmModelStats: clonedGmModelStats } : {}),
        ...(clonedSurfaceBreakdown ? { surfaceBreakdown: clonedSurfaceBreakdown } : {}),
        ...(clonedWorkspaceBreakdown ? { workspaceBreakdown: clonedWorkspaceBreakdown } : {}),
        ...(Array.isArray(cycle.recordedCallIds) ? { recordedCallIds: [...cycle.recordedCallIds] } : {}),
        ...(clonedLateCalls ? { lateMergedCalls: clonedLateCalls } : {}),
    };
}

/**
 * Pure, idempotent merge of late-arriving calls into an existing {@link DailyCycleEntry}.
 * Preserves ALL activity stats and prior GM calls, deduplicating strictly by canonical
 * logical call ID (independent of mutable array indices).
 */
export function mergeLateCallsIntoCycle(
    existingCycle: DailyCycleEntry,
    calls: readonly DailyMergedLateCall[],
    options?: {
        defaultSurface?: UsageSurface;
        externalSeenIds?: ReadonlySet<string>;
    },
): { cycle: DailyCycleEntry; appliedIds: string[] } {
    const knownIds = collectCycleRecordedCallIds(existingCycle);
    if (options?.externalSeenIds) {
        for (const id of options.externalSeenIds) {
            knownIds.add(id);
            knownIds.add(canonicalLogicalCallId(id));
        }
    }

    const toApply: Array<{ canonicalId: string; call: DailyMergedLateCall }> = [];
    for (const rawCall of calls) {
        if (!rawCall || !rawCall.callId) { continue; }
        const canonicalId = canonicalLogicalCallId(rawCall.callId);
        if (!canonicalId || knownIds.has(rawCall.callId) || knownIds.has(canonicalId)) {
            continue;
        }
        knownIds.add(rawCall.callId);
        knownIds.add(canonicalId);
        toApply.push({ canonicalId, call: rawCall });
    }

    if (toApply.length === 0) {
        return { cycle: existingCycle, appliedIds: [] };
    }

    const next = cloneDailyCycleEntry(existingCycle);
    const fallbackSurface = normalizeUsageSurface(options?.defaultSurface);

    const priorGmCalls = safeNonNeg(next.gmTotalCalls);
    const priorGmTokens = computeCycleTokenTotals(next);
    const priorGmCredits = safeNonNeg(next.gmTotalCredits);
    const priorGmCost = safeNonNeg(next.estimatedCost);

    const hasIncomingSurface = toApply.some(({ call }) =>
        normalizeUsageSurface(call.surface ?? fallbackSurface) !== 'unknown',
    );
    const hasIncomingWorkspace = toApply.some(({ call }) =>
        Boolean(call.workspace || call.authority),
    );
    const priorSurfDelta: SurfaceUsageStats = {
        calls: priorGmCalls, inputTokens: priorGmTokens.inputTokens, outputTokens: priorGmTokens.outputTokens,
        thinkingTokens: priorGmTokens.thinkingTokens, cacheReadTokens: priorGmTokens.cacheReadTokens,
        cacheCreationTokens: priorGmTokens.cacheCreationTokens, credits: priorGmCredits, estimatedCost: priorGmCost,
    };
    if ((hasIncomingSurface || next.surfaceBreakdown || (next.surface && next.surface !== 'unknown')) && !next.surfaceBreakdown && priorGmCalls > 0) {
        next.surfaceBreakdown = { [normalizeUsageSurface(next.surface)]: { ...priorSurfDelta } };
    }
    if ((hasIncomingWorkspace || next.workspaceBreakdown) && !next.workspaceBreakdown && priorGmCalls > 0) {
        const priorSurfaces = cloneSurfaceBreakdown(next.surfaceBreakdown)
            ?? { [normalizeUsageSurface(next.surface)]: { ...priorSurfDelta } };
        next.workspaceBreakdown = {
            [UNATTRIBUTED_WORKSPACE_KEY]: {
                calls: priorGmCalls, inputTokens: priorGmTokens.inputTokens, outputTokens: priorGmTokens.outputTokens,
                thinkingTokens: priorGmTokens.thinkingTokens, cacheReadTokens: priorGmTokens.cacheReadTokens,
                cacheCreationTokens: priorGmTokens.cacheCreationTokens, credits: priorGmCredits,
                knownCostUsd: priorGmCost, unpricedCalls: 0, bySurface: priorSurfaces,
            },
        };
    }

    let addedInput = 0;
    let addedOutput = 0;
    let addedThinking = 0;
    let addedCacheRead = 0;
    let addedCacheCreation = 0;
    let runningGmCalls = priorGmCalls;
    let runningGmCredits = priorGmCredits;
    let runningCost = priorGmCost;

    if (!next.gmModelStats) { next.gmModelStats = {}; }
    if (!next.recordedCallIds) { next.recordedCallIds = []; }
    if (!next.lateMergedCalls) { next.lateMergedCalls = {}; }

    const existingIdSet = new Set(next.recordedCallIds.map(id => canonicalLogicalCallId(id)));
    const appliedIds: string[] = [];

    for (const { canonicalId, call } of toApply) {
        const inTok = safeNonNeg(call.inputTokens);
        const outTok = safeNonNeg(call.outputTokens);
        const thinkTok = safeNonNeg(call.thinkingTokens);
        const cacheRead = safeNonNeg(call.cacheReadTokens);
        const cacheCreate = safeNonNeg(call.cacheCreationTokens);
        const credits = safeNonNeg(call.credits);
        const cost = safeNonNeg(call.estimatedCost);
        const callSurface = normalizeUsageSurface(call.surface ?? fallbackSurface);

        runningGmCalls += 1;
        runningGmCredits += credits;
        addedInput += inTok;
        addedOutput += outTok;
        addedThinking += thinkTok;
        addedCacheRead += cacheRead;
        addedCacheCreation += cacheCreate;
        runningCost += cost;

        // Per-model GM stats incremental update
        const modelKey = (call.modelKey || call.modelId || 'Unknown').trim() || 'Unknown';
        const prevMs = next.gmModelStats[modelKey];
        if (!prevMs) {
            const promptTotal = inTok + cacheRead + cacheCreate;
            const entry: GMModelCycleStats = {
                calls: 1,
                credits,
                inputTokens: inTok,
                outputTokens: outTok,
                thinkingTokens: thinkTok,
                avgTTFT: typeof call.ttftSeconds === 'number' && Number.isFinite(call.ttftSeconds) && call.ttftSeconds > 0 ? call.ttftSeconds : 0,
                cacheHitRate: cacheRead > 0 ? 1 : 0,
                cacheReadTokens: cacheRead,
                cacheCreationTokens: cacheCreate,
                ...(cost > 0 ? { estimatedCost: cost } : {}),
            };
            if (typeof call.streamingSeconds === 'number' && Number.isFinite(call.streamingSeconds) && call.streamingSeconds > 0) {
                entry.avgStreaming = call.streamingSeconds;
                if (call.streamingSeconds >= MIN_STREAM_SECONDS && outTok >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
                    entry.avgGenTokPerSec = outTok / call.streamingSeconds;
                }
            }
            if (promptTotal > 0) {
                entry.tokenCacheHitRate = Math.min(1, Math.max(0, cacheRead / promptTotal));
            }
            next.gmModelStats[modelKey] = entry;
        } else {
            const prevCalls = safeNonNeg(prevMs.calls);
            const nextCalls = prevCalls + 1;
            prevMs.calls = nextCalls;
            prevMs.credits = safeNonNeg(prevMs.credits) + credits;
            prevMs.inputTokens = safeNonNeg(prevMs.inputTokens) + inTok;
            prevMs.outputTokens = safeNonNeg(prevMs.outputTokens) + outTok;
            prevMs.thinkingTokens = safeNonNeg(prevMs.thinkingTokens) + thinkTok;
            prevMs.cacheReadTokens = safeNonNeg(prevMs.cacheReadTokens) + cacheRead;
            prevMs.cacheCreationTokens = safeNonNeg(prevMs.cacheCreationTokens) + cacheCreate;
            if (cost > 0) {
                prevMs.estimatedCost = safeNonNeg(prevMs.estimatedCost) + cost;
            }
            if (typeof call.ttftSeconds === 'number' && Number.isFinite(call.ttftSeconds) && call.ttftSeconds > 0) {
                prevMs.avgTTFT = prevMs.avgTTFT > 0
                    ? ((prevMs.avgTTFT * prevCalls) + call.ttftSeconds) / nextCalls
                    : call.ttftSeconds;
            }
            if (typeof call.streamingSeconds === 'number' && Number.isFinite(call.streamingSeconds) && call.streamingSeconds > 0) {
                const prevStream = safeNonNeg(prevMs.avgStreaming);
                prevMs.avgStreaming = prevStream > 0
                    ? ((prevStream * prevCalls) + call.streamingSeconds) / nextCalls
                    : call.streamingSeconds;
                if (call.streamingSeconds >= MIN_STREAM_SECONDS && outTok >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
                    const prevSpeed = safeNonNeg(prevMs.avgGenTokPerSec);
                    if (prevSpeed > 0 && prevStream > 0 && prevCalls > 0) {
                        const prevTotalStream = prevStream * prevCalls;
                        const prevTimedOut = prevSpeed * prevTotalStream;
                        prevMs.avgGenTokPerSec = (prevTimedOut + outTok) / (prevTotalStream + call.streamingSeconds);
                    } else {
                        prevMs.avgGenTokPerSec = outTok / call.streamingSeconds;
                    }
                }
            }
            const prevCacheHits = Math.round(safeNonNeg(prevMs.cacheHitRate) * prevCalls);
            prevMs.cacheHitRate = Math.min(1, (prevCacheHits + (cacheRead > 0 ? 1 : 0)) / nextCalls);
            const promptTotal = prevMs.inputTokens + (prevMs.cacheReadTokens || 0) + (prevMs.cacheCreationTokens || 0);
            if (promptTotal > 0) {
                prevMs.tokenCacheHitRate = Math.min(1, Math.max(0, (prevMs.cacheReadTokens || 0) / promptTotal));
            }
        }

        // Per-surface stats update
        if (callSurface !== 'unknown' || next.surfaceBreakdown) {
            if (!next.surfaceBreakdown) { next.surfaceBreakdown = {}; }
            const sb = next.surfaceBreakdown[callSurface] || {
                calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0,
            };
            addSurfaceStats(sb, {
                calls: 1, inputTokens: inTok, outputTokens: outTok, thinkingTokens: thinkTok,
                cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreate, credits, estimatedCost: cost,
            });
            next.surfaceBreakdown[callSurface] = sb;
        }

        // Per-workspace attribution update (idempotent per unique logical call)
        if (hasIncomingWorkspace || next.workspaceBreakdown) {
            if (!next.workspaceBreakdown) { next.workspaceBreakdown = {}; }
            addCallToWorkspaceBreakdown(
                next.workspaceBreakdown,
                normalizeWorkspaceKey(call.workspace, call.authority),
                {
                    inputTokens: inTok, outputTokens: outTok, thinkingTokens: thinkTok,
                    cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreate,
                    credits, estimatedCost: cost, unpriced: call.unpriced, authority: call.authority, surface: callSurface,
                },
                callSurface,
            );
        }

        if (!existingIdSet.has(canonicalId)) {
            existingIdSet.add(canonicalId);
            next.recordedCallIds.push(canonicalId);
        }
        next.lateMergedCalls[canonicalId] = {
            ...call,
            callId: canonicalId,
            ...(callSurface !== 'unknown' ? { surface: callSurface } : {}),
        };
        appliedIds.push(canonicalId);
    }

    const hasPriorGmModelStats = hasCompleteGmModelStats(existingCycle);
    const nextCacheRead = (hasPriorGmModelStats ? priorGmTokens.cacheReadTokens : safeNonNeg(existingCycle.gmTotalCacheRead)) + addedCacheRead;
    const nextCacheCreation = (hasPriorGmModelStats ? priorGmTokens.cacheCreationTokens : safeNonNeg(existingCycle.gmTotalCacheCreation)) + addedCacheCreation;
    const nextThinking = (hasPriorGmModelStats ? priorGmTokens.thinkingTokens : safeNonNeg(existingCycle.gmTotalThinkingTokens)) + addedThinking;
    const priorGmInOut = hasPriorGmModelStats
        ? priorGmTokens.inputTokens + priorGmTokens.outputTokens
        : safeNonNeg(existingCycle.gmTotalTokens);

    next.gmTotalCalls = runningGmCalls;
    next.gmTotalCredits = runningGmCredits;
    next.gmTotalTokens = priorGmInOut + addedInput + addedOutput;
    const addedAdditive = computeAdditiveTokens({
        inputTokens: addedInput,
        outputTokens: addedOutput,
        cacheReadTokens: addedCacheRead,
        cacheCreationTokens: addedCacheCreation,
    });
    const priorAdditive = hasPriorGmModelStats
        ? priorGmTokens.totalTokens
        : (safeNonNeg(existingCycle.gmTotalAllTokens)
            || (priorGmInOut + safeNonNeg(existingCycle.gmTotalCacheRead) + safeNonNeg(existingCycle.gmTotalCacheCreation)));
    const additiveTotal = priorAdditive + addedAdditive;
    if (additiveTotal > 0) {
        next.gmTotalAllTokens = additiveTotal;
    }
    if (nextCacheRead > 0) { next.gmTotalCacheRead = nextCacheRead; }
    if (nextCacheCreation > 0) { next.gmTotalCacheCreation = nextCacheCreation; }
    if (nextThinking > 0) { next.gmTotalThinkingTokens = nextThinking; }
    if (runningCost > 0) { next.estimatedCost = runningCost; }

    const domSurf = dominantUsageSurface(next.surfaceBreakdown, next.surface);
    if (domSurf) {
        next.surface = domSurf;
    }

    return { cycle: next, appliedIds };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'dailyStoreState';
/** Default retention supports a full 52-week/year heatmap plus buffer (400 days). */
export const DEFAULT_MAX_DAYS = 400;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 3650;

function normalizeMaxDays(days?: number): number {
    if (typeof days !== 'number' || !Number.isFinite(days)) {
        return DEFAULT_MAX_DAYS;
    }
    return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(days)));
}

// ─── DailyStore Class ────────────────────────────────────────────────────────

const CANONICAL_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalDateKey(raw: unknown): raw is string {
    if (typeof raw !== 'string' || !CANONICAL_DATE_KEY_RE.test(raw)) { return false; }
    const [y, m, d] = raw.split('-').map(Number);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) { return false; }
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function safeNonNegUnknown(val: unknown): number {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0;
}

function sanitizeOptionalNonNeg(val: unknown): number | undefined {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : undefined;
}

function sanitizeSurfaceBucket(raw: unknown): SurfaceUsageStats | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const s = raw as Record<string, unknown>;
    return {
        calls: safeNonNegUnknown(s.calls),
        inputTokens: safeNonNegUnknown(s.inputTokens),
        outputTokens: safeNonNegUnknown(s.outputTokens),
        thinkingTokens: safeNonNegUnknown(s.thinkingTokens),
        cacheReadTokens: safeNonNegUnknown(s.cacheReadTokens),
        cacheCreationTokens: safeNonNegUnknown(s.cacheCreationTokens),
        credits: safeNonNegUnknown(s.credits),
        estimatedCost: safeNonNegUnknown(s.estimatedCost),
    };
}

function sanitizeImportedCycleEntry(raw: unknown, dateKey: string): DailyCycleEntry | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const c = raw as Record<string, unknown>;
    const sanitized: DailyCycleEntry = {
        startTime: typeof c.startTime === 'string' ? c.startTime : `${dateKey}T00:00:00`,
        endTime: typeof c.endTime === 'string' ? c.endTime : `${dateKey}T23:59:59`,
        totalReasoning: safeNonNegUnknown(c.totalReasoning),
        totalToolCalls: safeNonNegUnknown(c.totalToolCalls),
        totalErrors: safeNonNegUnknown(c.totalErrors),
        totalInputTokens: safeNonNegUnknown(c.totalInputTokens),
        totalOutputTokens: safeNonNegUnknown(c.totalOutputTokens),
        estSteps: safeNonNegUnknown(c.estSteps),
        modelNames: Array.isArray(c.modelNames)
            ? c.modelNames.filter((n): n is string => typeof n === 'string').map(n => n.slice(0, 128))
            : [],
        ...(Array.isArray(c.triggeredBy)
            ? { triggeredBy: c.triggeredBy.filter((n): n is string => typeof n === 'string').map(n => n.slice(0, 128)) }
            : {}),
    };
    for (const k of [
        'gmTotalCalls', 'gmTotalCredits', 'gmTotalTokens', 'gmTotalAllTokens', 'gmTotalCacheRead',
        'gmTotalCacheCreation', 'gmTotalThinkingTokens', 'gmRetryTokens', 'gmRetryCredits', 'gmRetryCount', 'estimatedCost',
    ] as const) {
        const v = sanitizeOptionalNonNeg(c[k]);
        if (v !== undefined) { (sanitized as unknown as Record<string, unknown>)[k] = v; }
    }

    if (typeof c.accountEmail === 'string' && c.accountEmail.trim()) {
        sanitized.accountEmail = c.accountEmail;
    }
    if (typeof c.surface === 'string') {
        const surf = normalizeUsageSurface(c.surface);
        if (surf !== 'unknown') { sanitized.surface = surf; }
    }
    if (c.modelStats && typeof c.modelStats === 'object' && !Array.isArray(c.modelStats)) {
        const ms: Record<string, ModelCycleStats> = {};
        for (const [mk, mv] of Object.entries(c.modelStats as Record<string, unknown>)) {
            if (!mk || mk === '__proto__' || mk === 'constructor' || mk === 'prototype') { continue; }
            if (!mv || typeof mv !== 'object' || Array.isArray(mv)) { continue; }
            const r = mv as Record<string, unknown>;
            ms[mk] = {
                reasoning: safeNonNegUnknown(r.reasoning),
                toolCalls: safeNonNegUnknown(r.toolCalls),
                errors: safeNonNegUnknown(r.errors),
                estSteps: safeNonNegUnknown(r.estSteps),
                inputTokens: safeNonNegUnknown(r.inputTokens),
                outputTokens: safeNonNegUnknown(r.outputTokens),
            };
        }
        sanitized.modelStats = ms;
    }
    if (c.gmModelStats && typeof c.gmModelStats === 'object' && !Array.isArray(c.gmModelStats)) {
        const gms: Record<string, GMModelCycleStats> = {};
        for (const [mk, mv] of Object.entries(c.gmModelStats as Record<string, unknown>)) {
            if (!mk || mk === '__proto__' || mk === 'constructor' || mk === 'prototype') { continue; }
            if (!mv || typeof mv !== 'object' || Array.isArray(mv)) { continue; }
            const r = mv as Record<string, unknown>;
            const entry: GMModelCycleStats = {
                calls: safeNonNegUnknown(r.calls),
                credits: safeNonNegUnknown(r.credits),
                inputTokens: safeNonNegUnknown(r.inputTokens),
                outputTokens: safeNonNegUnknown(r.outputTokens),
                thinkingTokens: safeNonNegUnknown(r.thinkingTokens),
                avgTTFT: safeNonNegUnknown(r.avgTTFT),
                cacheHitRate: Math.min(1, safeNonNegUnknown(r.cacheHitRate)),
            };
            const cr = sanitizeOptionalNonNeg(r.cacheReadTokens);
            if (cr !== undefined) { entry.cacheReadTokens = cr; }
            const cc = sanitizeOptionalNonNeg(r.cacheCreationTokens);
            if (cc !== undefined) { entry.cacheCreationTokens = cc; }
            const ec = sanitizeOptionalNonNeg(r.estimatedCost);
            if (ec !== undefined) { entry.estimatedCost = ec; }
            if (r.costBackfilled === true) { entry.costBackfilled = true; }
            const avgStr = sanitizeOptionalNonNeg(r.avgStreaming);
            if (avgStr !== undefined) { entry.avgStreaming = avgStr; }
            const avgSpd = sanitizeOptionalNonNeg(r.avgGenTokPerSec);
            if (avgSpd !== undefined) { entry.avgGenTokPerSec = avgSpd; }
            const tchr = sanitizeOptionalNonNeg(r.tokenCacheHitRate);
            if (tchr !== undefined) { entry.tokenCacheHitRate = Math.min(1, tchr); }
            gms[mk] = entry;
        }
        sanitized.gmModelStats = gms;
    }
    if (c.surfaceBreakdown && typeof c.surfaceBreakdown === 'object' && !Array.isArray(c.surfaceBreakdown)) {
        const sb: Partial<Record<UsageSurface, SurfaceUsageStats>> = {};
        for (const [sk, sv] of Object.entries(c.surfaceBreakdown as Record<string, unknown>)) {
            const surf = normalizeUsageSurface(sk);
            const cleanBucket = sanitizeSurfaceBucket(sv);
            if (cleanBucket) { sb[surf] = cleanBucket; }
        }
        if (Object.keys(sb).length > 0) { sanitized.surfaceBreakdown = sb; }
    }
    if (c.workspaceBreakdown && typeof c.workspaceBreakdown === 'object' && !Array.isArray(c.workspaceBreakdown)) {
        const filtered = Object.create(null) as Record<string, WorkspaceUsageStats>;
        for (const [wk, wv] of Object.entries(c.workspaceBreakdown as Record<string, unknown>)) {
            if (!wk || wk === '__proto__' || wk === 'constructor' || wk === 'prototype') { continue; }
            if (!wv || typeof wv !== 'object' || Array.isArray(wv)) { continue; }
            filtered[wk] = wv as WorkspaceUsageStats;
        }
        const wb = cloneWorkspaceBreakdown(filtered);
        if (wb) { sanitized.workspaceBreakdown = wb; }
    }
    if (Array.isArray(c.recordedCallIds)) {
        const ids = [...new Set(c.recordedCallIds.filter((id): id is string => typeof id === 'string').map(id => canonicalLogicalCallId(id)).filter(Boolean))];
        if (ids.length > 0) { sanitized.recordedCallIds = ids; }
    }
    if (c.lateMergedCalls && typeof c.lateMergedCalls === 'object' && !Array.isArray(c.lateMergedCalls)) {
        const lmc: Record<string, DailyMergedLateCall> = {};
        for (const [cid, cv] of Object.entries(c.lateMergedCalls as Record<string, unknown>)) {
            if (!cid || cid === '__proto__' || cid === 'constructor' || cid === 'prototype') { continue; }
            if (!cv || typeof cv !== 'object' || Array.isArray(cv)) { continue; }
            const r = cv as Record<string, unknown>;
            const createdAt = typeof r.createdAt === 'string' && r.createdAt.trim() ? r.createdAt : `${dateKey}T00:00:00Z`;
            const parsedMs = Date.parse(createdAt);
            const createdAtMs = typeof r.createdAtMs === 'number' && Number.isFinite(r.createdAtMs) && r.createdAtMs >= 0
                ? r.createdAtMs
                : (Number.isFinite(parsedMs) ? parsedMs : 0);
            const modelKey = typeof r.modelKey === 'string' && r.modelKey.trim() ? r.modelKey : 'Unknown';
            lmc[cid] = {
                callId: typeof r.callId === 'string' && r.callId.trim() ? r.callId : cid,
                createdAt,
                createdAtMs,
                modelId: typeof r.modelId === 'string' && r.modelId.trim() ? r.modelId : modelKey,
                modelKey,
                inputTokens: safeNonNegUnknown(r.inputTokens),
                outputTokens: safeNonNegUnknown(r.outputTokens),
                thinkingTokens: safeNonNegUnknown(r.thinkingTokens),
                cacheReadTokens: safeNonNegUnknown(r.cacheReadTokens),
                cacheCreationTokens: safeNonNegUnknown(r.cacheCreationTokens),
                credits: safeNonNegUnknown(r.credits),
                estimatedCost: safeNonNegUnknown(r.estimatedCost),
                ...(sanitizeOptionalNonNeg(r.ttftSeconds) !== undefined ? { ttftSeconds: sanitizeOptionalNonNeg(r.ttftSeconds) } : {}),
                ...(sanitizeOptionalNonNeg(r.streamingSeconds) !== undefined ? { streamingSeconds: sanitizeOptionalNonNeg(r.streamingSeconds) } : {}),
                ...(typeof r.surface === 'string' ? { surface: normalizeUsageSurface(r.surface) } : {}),
                ...(typeof r.accountEmail === 'string' ? { accountEmail: r.accountEmail } : {}),
                ...(typeof r.account === 'string' ? { account: r.account } : {}),
                ...(typeof r.workspace === 'string' ? { workspace: r.workspace } : {}),
                ...(typeof r.cascadeId === 'string' ? { cascadeId: r.cascadeId } : {}),
                ...(typeof r.authority === 'string' ? { authority: r.authority } : {}),
                ...(r.unpriced === true ? { unpriced: true } : {}),
                ...(r.fromDaySnapshot === true ? { fromDaySnapshot: true } : {}),
            };
        }
        if (Object.keys(lmc).length > 0) { sanitized.lateMergedCalls = lmc; }
    }
    return sanitized;
}

function sanitizeImportedDailyRecord(dateKey: string, raw: unknown): DailyRecord | null {
    if (!isCanonicalDateKey(dateKey)) { return null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const rec = raw as Record<string, unknown>;
    if (!Array.isArray(rec.cycles)) { return null; }
    const cycles: DailyCycleEntry[] = [];
    for (const c of rec.cycles) {
        const clean = sanitizeImportedCycleEntry(c, dateKey);
        if (clean) { cycles.push(clean); }
    }
    return { date: dateKey, cycles };
}

function populateCycleGmFields(
    entry: DailyCycleEntry,
    gmSummary: GMSummary | null | undefined,
    costTotal?: number,
    costPerModel?: Record<string, number>,
): void {
    if (gmSummary) {
        entry.gmTotalCalls = gmSummary.totalCalls;
        entry.gmTotalCredits = gmSummary.totalCredits;
        entry.gmTotalTokens = gmSummary.totalInputTokens + gmSummary.totalOutputTokens;
        const additiveTotal = computeAdditiveTokens({
            inputTokens: gmSummary.totalInputTokens,
            outputTokens: gmSummary.totalOutputTokens,
            cacheReadTokens: gmSummary.totalCacheRead,
            cacheCreationTokens: gmSummary.totalCacheCreation,
        });
        if (additiveTotal > 0) { entry.gmTotalAllTokens = additiveTotal; }
        if (gmSummary.totalCacheRead > 0) { entry.gmTotalCacheRead = gmSummary.totalCacheRead; }
        if (gmSummary.totalCacheCreation > 0) { entry.gmTotalCacheCreation = gmSummary.totalCacheCreation; }
        if (gmSummary.totalThinkingTokens > 0) { entry.gmTotalThinkingTokens = gmSummary.totalThinkingTokens; }
        if (gmSummary.totalRetryTokens > 0) {
            entry.gmRetryTokens = gmSummary.totalRetryTokens;
            entry.gmRetryCredits = gmSummary.totalRetryCredits;
            entry.gmRetryCount = gmSummary.totalRetryCount;
        }
    }
    if (costTotal !== undefined && costTotal > 0) { entry.estimatedCost = costTotal; }
    entry.gmModelStats = buildGMPerModelStats(gmSummary ?? null, costPerModel);
}

export class DailyStore {
    private _records = new Map<string, DailyRecord>();
    private _maxDays = DEFAULT_MAX_DAYS;
    private _lateWrite: Promise<void> = Promise.resolve();
    get hasBackingStore(): boolean { return this._globalState !== null; }
    private _globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): PromiseLike<void> } | null = null;

    constructor(maxDays?: number) {
        this._maxDays = normalizeMaxDays(maxDays);
    }

    /** Current configured maximum number of days retained. */
    get maxDays(): number { return this._maxDays; }

    /** Update maximum retention days (clamped to 7–3650) and trim excess oldest records. */
    setMaxDays(days: number): void {
        const next = normalizeMaxDays(days);
        if (next === this._maxDays) { return; }
        this._maxDays = next;
        const sizeBefore = this._records.size;
        this._trimOld();
        if (this._records.size !== sizeBefore) {
            this._persist();
        }
    }

    /** Initialize from globalState */
    init(
        globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): PromiseLike<void> },
        options?: DailyStoreInitOptions,
    ): void {
        this._globalState = globalState;
        if (options?.maxDays !== undefined) {
            this._maxDays = normalizeMaxDays(options.maxDays);
        }
        const saved = globalState.get<DailyStoreState | null>(STORAGE_KEY, null);
        if (saved && saved.version === 1 && saved.records && typeof saved.records === 'object') {
            for (const [date, record] of Object.entries(saved.records)) {
                const sanitized = sanitizeImportedDailyRecord(date, record);
                if (sanitized) {
                    this._records.set(sanitized.date, sanitized);
                }
            }
        }
        this._trimOld();
    }

    /**
     * Merge external records into this store (for data migration/recovery).
     * Only adds records for dates not already present — existing data is never overwritten.
     * Validates canonical YYYY-MM-DD dates and finite non-negative numeric fields to prevent
     * stored HTML/XSS injection or NaN corruption from malformed recovery payloads.
     * Returns the number of records added.
     */
    mergeRecords(externalState: DailyStoreState): number {
        if (!externalState || externalState.version !== 1 || !externalState.records || typeof externalState.records !== 'object') { return 0; }
        let added = 0;
        for (const [date, record] of Object.entries(externalState.records)) {
            const sanitized = sanitizeImportedDailyRecord(date, record);
            if (!sanitized) { continue; }
            if (!this._records.has(sanitized.date)) {
                this._records.set(sanitized.date, sanitized);
                added++;
            }
        }
        if (added > 0) {
            this._trimOld();
            this._persist();
        }
        return added;
    }

    /**
     * Fill in per-model costs that were archived without one.
     *
     * A call is priced when it is recorded, so a model the platform ships mid-cycle — one
     * with no row in the pricing table yet — is recorded at $0 and then frozen into the
     * archive that way. Once the price row lands, the tokens are still there and the cost
     * can be recovered.
     *
     * Fill-only, never overwrite: a row already holding a number was priced correctly when
     * it was written and comes out identical. That is also what makes this safe to run on
     * every activation instead of behind a one-shot flag — it is self-healing and
     * idempotent, so a row whose model is still unknown today gets filled by whichever
     * future release adds that price.
     *
     * What it writes is an UNDERESTIMATE, and is flagged `costBackfilled` to say so:
     * GMModelCycleStats never kept cache tokens, so only input + output + thinking survive
     * to be re-priced. A model that resolves to no pricing at all is left alone with its
     * cost still absent — writing 0 there would be indistinguishable from a real $0 day.
     *
     * Returns the number of per-model rows filled.
     */
    backfillMissingCosts(
        customPricing: Record<string, ModelPricing> = {},
        opts?: CostBackfillOptions,
    ): number {
        const base = opts?.basePricing || DEFAULT_PRICING;
        let filled = 0;

        for (const [date, record] of this._records) {
            for (const cycle of record.cycles) {
                if (!cycle.gmModelStats) { continue; }
                if (!cycleTotalIsAccountedFor(cycle)) { continue; }
                let cycleDelta = 0;

                for (const [modelKey, gms] of Object.entries(cycle.gmModelStats)) {
                    if (gms.estimatedCost !== undefined) { continue; }
                    const pricing = findPricingForDate(modelKey, customPricing, date, base);
                    if (!pricing) { continue; }
                    const cost = costFromTokens({
                        inputTokens: gms.inputTokens,
                        outputTokens: gms.outputTokens,
                        thinkingTokens: gms.thinkingTokens,
                        cacheReadTokens: gms.cacheReadTokens || 0,
                    }, pricing);
                    if (cost <= 0) { continue; }

                    gms.estimatedCost = cost;
                    gms.costBackfilled = true;
                    cycleDelta += cost;
                    filled++;
                }

                // Keep the day total in step with its rows, or getMonthSummary and
                // getMonthCostBreakdown would report different numbers for the same day.
                if (cycleDelta > 0) {
                    cycle.estimatedCost = (cycle.estimatedCost || 0) + cycleDelta;
                }
            }
        }

        if (filled > 0) { this._persist(); }
        return filled;
    }

    /**
     * Add a daily snapshot from Activity + GM summaries.
     * Called when the local date rolls over (performDailyArchival).
     * Each day gets exactly one entry; calling again for the same date replaces it.
     */
    addDailySnapshot(
        dateKey: string,
        activitySummary: ActivitySummary,
        gmSummary: GMSummary | null,
        costTotal?: number,
        costPerModel?: Record<string, number>,
        /** If true, appends a cycle instead of replacing the day's entry. */
        append?: boolean,
        /** Optional surface/account metadata for source tagging. */
        meta?: DailySnapshotMetadata,
    ): void {
        let record = this._records.get(dateKey);
        if (!record) {
            record = { date: dateKey, cycles: [] };
            this._records.set(dateKey, record);
        }

        const entry: DailyCycleEntry = {
            startTime: `${dateKey}T00:00:00`,
            endTime: new Date().toISOString(),
            totalReasoning: activitySummary.totalReasoning,
            totalToolCalls: activitySummary.totalToolCalls,
            totalErrors: activitySummary.totalErrors,
            totalInputTokens: activitySummary.totalInputTokens,
            totalOutputTokens: activitySummary.totalOutputTokens,
            estSteps: activitySummary.estSteps,
            modelNames: extractModelNames(activitySummary.modelStats),
            modelStats: buildPerModelStats(activitySummary.modelStats),
        };

        populateCycleGmFields(entry, gmSummary, costTotal, costPerModel);

        if (meta?.accountEmail) {
            entry.accountEmail = meta.accountEmail;
        }
        const surface = normalizeUsageSurface(meta?.surface);
        if (surface !== 'unknown') {
            entry.surface = surface;
        }
        const clonedBreakdown = cloneSurfaceBreakdown(meta?.surfaceBreakdown);
        if (clonedBreakdown) {
            entry.surfaceBreakdown = clonedBreakdown;
        }
        const clonedWorkspaceBreakdown = cloneWorkspaceBreakdown(meta?.workspaceBreakdown);
        if (clonedWorkspaceBreakdown) {
            entry.workspaceBreakdown = clonedWorkspaceBreakdown;
        }
        if (Array.isArray(meta?.recordedCallIds) && meta.recordedCallIds.length > 0) {
            const dedupedIds = [...new Set(meta.recordedCallIds.map(id => canonicalLogicalCallId(id)).filter(Boolean))];
            if (dedupedIds.length > 0) {
                entry.recordedCallIds = dedupedIds;
            }
        }

        if (meta?.snapshotCalls?.length) {
            entry.lateMergedCalls = Object.fromEntries(meta.snapshotCalls.map(call => [
                canonicalLogicalCallId(call.callId), { ...call, fromDaySnapshot: true },
            ]));
        }
        if (append) {
            record.cycles.push(entry);
        } else if (meta?.snapshotCalls?.length) {
            // Another host can archive (or late-merge) this day first. Carry
            // forward its distinct contributions when a daily snapshot replaces it.
            const cached = record.cycles.flatMap(c => Object.values(c.lateMergedCalls ?? {}));
            const reconciled = mergeLateCallsIntoCycle(entry, cached).cycle;
            record.cycles = [reconciled];
        } else {
            record.cycles = [entry];
        }
        // Only recent dates can race normal rollover. Historical days keep their
        // aggregates and dedup IDs; original per-call projections need no longer occupy disk.
        for (const oldDate of [...this._records.keys()].sort().slice(0, -2)) {
            const old = this._records.get(oldDate)!;
            for (const c of old.cycles) {
                if (!c.lateMergedCalls) { continue; }
                for (const [id, call] of Object.entries(c.lateMergedCalls)) {
                    if (call.fromDaySnapshot) { delete c.lateMergedCalls[id]; }
                }
                if (!Object.keys(c.lateMergedCalls).length) { delete c.lateMergedCalls; }
            }
        }
        this._trimOld();
        this._persist();
    }

    /**
     * Idempotently merge late-arriving calls into a historical date's existing archive.
     * - Preserves existing activity fields and existing archived GM calls (NEVER overwrites `record.cycles = [entry]`).
     * - Deduplicates strictly by durable canonical logical call ID (NEVER double-counts on replay).
     * - Rolls back in-memory mutation if synchronous persistence throws.
     */
    private _mergeLateDayCallsInternal(
        dateKey: string,
        calls: readonly DailyMergedLateCall[],
        options?: {
            defaultSurface?: UsageSurface;
            accountEmail?: string;
        },
    ): { result: MergeLateDayCallsResult; rollback: () => void } {
        const noopRollback = () => {};
        if (!dateKey || calls.length === 0) {
            return {
                result: {
                    appliedCalls: 0,
                    appliedCallIds: [],
                    persisted: true,
                    persistPromise: Promise.resolve(true),
                },
                rollback: noopRollback,
            };
        }

        const prevRecord = this._records.get(dateKey);
        const backupRecord: DailyRecord | null = prevRecord
            ? { date: prevRecord.date, cycles: prevRecord.cycles.map(cloneDailyCycleEntry) }
            : null;

        let record = prevRecord;
        if (!record) {
            record = { date: dateKey, cycles: [] };
            this._records.set(dateKey, record);
        }

        // Collect already-recorded call IDs across ALL cycles on this date
        const recordSeenIds = new Set<string>();
        for (const c of record.cycles) {
            for (const id of collectCycleRecordedCallIds(c)) {
                recordSeenIds.add(id);
            }
        }

        let targetIdx = record.cycles.findIndex(c => {
            const surfs = getCycleSurfaces(c);
            return !(surfs.length === 1 && surfs[0] === 'cli');
        });
        if (targetIdx < 0 && record.cycles.length > 0) {
            targetIdx = 0;
        }

        const baseCycle: DailyCycleEntry = targetIdx >= 0
            ? record.cycles[targetIdx]
            : {
                startTime: `${dateKey}T00:00:00`,
                endTime: `${dateKey}T23:59:59`,
                totalReasoning: 0,
                totalToolCalls: 0,
                totalErrors: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                estSteps: 0,
                modelNames: [],
                ...(options?.accountEmail ? { accountEmail: options.accountEmail } : {}),
            };

        const { cycle: mergedCycle, appliedIds } = mergeLateCallsIntoCycle(baseCycle, calls, {
            defaultSurface: options?.defaultSurface,
            externalSeenIds: recordSeenIds,
        });

        if (appliedIds.length === 0) {
            // Replay of already-archived calls — zero change!
            if (!backupRecord) {
                this._records.delete(dateKey);
            }
            return {
                result: {
                    appliedCalls: 0,
                    appliedCallIds: [],
                    persisted: true,
                    persistPromise: Promise.resolve(true),
                },
                rollback: noopRollback,
            };
        }

        const appliedIdx = targetIdx >= 0 ? targetIdx : record.cycles.length;
        if (targetIdx >= 0) {
            record.cycles[targetIdx] = mergedCycle;
        } else {
            record.cycles.push(mergedCycle);
        }

        const rollback = () => {
            const currentRec = this._records.get(dateKey);
            if (!currentRec || currentRec.cycles[appliedIdx] !== mergedCycle) {
                return;
            }
            if (backupRecord) {
                this._records.set(dateKey, backupRecord);
            } else {
                this._records.delete(dateKey);
            }
        };

        this._trimOld();
        const persistOutcome = this._persistWithOutcome();
        if (!persistOutcome.syncOk) {
            rollback();
            return {
                result: {
                    appliedCalls: 0,
                    appliedCallIds: [],
                    persisted: false,
                    persistPromise: Promise.resolve(false),
                },
                rollback: noopRollback,
            };
        }

        return {
            result: {
                appliedCalls: appliedIds.length,
                appliedCallIds: appliedIds,
                persisted: true,
                persistPromise: persistOutcome.promise,
            },
            rollback,
        };
    }

    mergeLateDayCalls(
        dateKey: string,
        calls: readonly DailyMergedLateCall[],
        options?: {
            defaultSurface?: UsageSurface;
            accountEmail?: string;
        },
    ): MergeLateDayCallsResult {
        return this._mergeLateDayCallsInternal(dateKey, calls, options).result;
    }

    /**
     * Async variant of {@link mergeLateDayCalls} that awaits backing persistence confirmation
     * (including an optional `confirmPersist` commit check such as `DurableState.flush()`).
     * Rolls back the in-memory record mutation if persistence fails so retries re-apply cleanly.
     */
    async mergeLateDayCallsAsync(
        dateKey: string,
        calls: readonly DailyMergedLateCall[],
        options?: {
            defaultSurface?: UsageSurface;
            accountEmail?: string;
            confirmPersist?: () => boolean | Promise<boolean>;
        },
    ): Promise<MergeLateDayCallsAsyncResult> {
        // Wait for the previous optimistic change to commit or roll back before
        // checking duplicate IDs against the in-memory archive.
        const previous = this._lateWrite;
        let release!: () => void;
        this._lateWrite = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await this._commitLateDayCalls(dateKey, calls, options);
        } finally {
            release();
        }
    }

    private async _commitLateDayCalls(
        dateKey: string,
        calls: readonly DailyMergedLateCall[],
        options?: { defaultSurface?: UsageSurface; accountEmail?: string; confirmPersist?: () => boolean | Promise<boolean> },
    ): Promise<MergeLateDayCallsAsyncResult> {
        const { result: res, rollback } = this._mergeLateDayCallsInternal(dateKey, calls, options);
        if (!res.persisted) {
            return { appliedCalls: 0, appliedCallIds: [], committed: false };
        }
        // A flush may complete before an async backing bucket has even queued
        // this write. Require the receipt for the write itself as well.
        try {
            const [updated, confirmed] = await Promise.all([
                res.persistPromise,
                options?.confirmPersist?.() ?? true,
            ]);
            if (!updated || !confirmed) {
                rollback();
                return { appliedCalls: 0, appliedCallIds: [], committed: false };
            }
        } catch {
            rollback();
            return { appliedCalls: 0, appliedCallIds: [], committed: false };
        }
        return {
            appliedCalls: res.appliedCalls,
            appliedCallIds: res.appliedCallIds,
            committed: true,
        };
    }

    /**
     * @deprecated Legacy method — kept for backward compatibility with old archive format.
     * New code should use addDailySnapshot() instead.
     */
    addCycle(
        archive: ActivityArchive,
        gmSummary?: GMSummary | null,
        costTotal?: number,
        costPerModel?: Record<string, number>,
        accountEmail?: string,
        surface?: UsageSurface,
    ): void {
        const dateKey = toDateKey(archive.endTime);
        let record = this._records.get(dateKey);
        if (!record) {
            record = { date: dateKey, cycles: [] };
            this._records.set(dateKey, record);
        }

        const s = archive.summary;
        const cycle: DailyCycleEntry = {
            startTime: archive.startTime,
            endTime: archive.endTime,
            triggeredBy: archive.triggeredBy,
            totalReasoning: s.totalReasoning,
            totalToolCalls: s.totalToolCalls,
            totalErrors: s.totalErrors,
            totalInputTokens: s.totalInputTokens,
            totalOutputTokens: s.totalOutputTokens,
            estSteps: s.estSteps,
            modelNames: extractModelNames(s.modelStats),
            modelStats: buildPerModelStats(s.modelStats),
        };

        populateCycleGmFields(cycle, gmSummary, costTotal, costPerModel);
        if (accountEmail) { cycle.accountEmail = accountEmail; }
        const normSurface = normalizeUsageSurface(surface);
        if (normSurface !== 'unknown') { cycle.surface = normSurface; }

        record.cycles.push(cycle);
        this._trimOld();
        this._persist();
    }

    // importArchives() removed — daily archival no longer needs retroactive backfill.

    /** Get record for a specific date, or null */
    getRecord(date: string): DailyRecord | null {
        return this._records.get(date) || null;
    }

    /** Get all dates that have data, sorted descending */
    getDatesWithData(): string[] {
        return [...this._records.keys()].sort().reverse();
    }

    /** Get all recorded days, sorted ascending by date */
    getAllRecords(): DailyRecord[] {
        return [...this._records.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, rec]) => rec);
    }

    /** Get summary data for each day in a month (for calendar grid) */
    getMonthSummary(year: number, month: number): MonthCellSummary[] {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const results: MonthCellSummary[] = [];

        for (const [date, record] of this._records) {
            if (!date.startsWith(prefix)) { continue; }
            let totalReasoning = 0, totalToolCalls = 0, totalCost = 0, gmCalls = 0;
            let totalTokens = 0, inputTokens = 0, outputTokens = 0;
            let cacheReadTokens = 0, cacheCreationTokens = 0, thinkingTokens = 0;
            const surfaces = new Set<UsageSurface>();

            for (const c of record.cycles) {
                totalReasoning += c.totalReasoning;
                totalToolCalls += c.totalToolCalls;
                totalCost += Number.isFinite(c.estimatedCost) ? (c.estimatedCost || 0) : 0;
                gmCalls += c.gmTotalCalls || 0;
                const tok = computeCycleTokenTotals(c);
                totalTokens += tok.totalTokens;
                inputTokens += tok.inputTokens;
                outputTokens += tok.outputTokens;
                cacheReadTokens += tok.cacheReadTokens;
                cacheCreationTokens += tok.cacheCreationTokens;
                thinkingTokens += tok.thinkingTokens;
                for (const s of getCycleSurfaces(c)) {
                    surfaces.add(s);
                }
            }
            results.push({
                date,
                cycleCount: record.cycles.length,
                totalReasoning,
                totalToolCalls,
                totalCost,
                gmCalls,
                totalTokens,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheCreationTokens,
                thinkingTokens,
                surfaces: [...surfaces],
            });
        }

        return results;
    }

    /**
     * Aggregate per-model cost data across all cycles in a given month.
     * Returns per-model breakdown and a grand total from archived cycles.
     */
    getMonthCostBreakdown(year: number, month: number): MonthCostBreakdown {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const models = new Map<string, MonthModelCost>();
        let grandTotal = 0;
        let cycleCount = 0;
        let earliestDate = '';

        for (const [date, record] of this._records) {
            if (!date.startsWith(prefix)) { continue; }
            if (!earliestDate || date < earliestDate) { earliestDate = date; }

            for (const cycle of record.cycles) {
                cycleCount++;
                const cycleCost = cycle.estimatedCost || 0;
                grandTotal += cycleCost;

                // Aggregate per-model from gmModelStats
                if (cycle.gmModelStats) {
                    for (const [rawName, gms] of Object.entries(cycle.gmModelStats)) {
                        const name = normalizeModelDisplayName(rawName) || rawName;
                        let entry = models.get(name);
                        if (!entry) {
                            entry = { name, totalCost: 0, calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, credits: 0 };
                            models.set(name, entry);
                        }
                        entry.totalCost += gms.estimatedCost || 0;
                        entry.calls += gms.calls;
                        entry.inputTokens += gms.inputTokens;
                        entry.outputTokens += gms.outputTokens;
                        entry.thinkingTokens += gms.thinkingTokens;
                        entry.credits += gms.credits;
                    }
                }
            }
        }

        const modelRows = [...models.values()].sort((a, b) => b.totalCost - a.totalCost);

        return {
            year,
            month,
            grandTotal,
            cycleCount,
            earliestDate,
            models: modelRows,
        };
    }

    /** Total number of recorded days */
    get totalDays(): number { return this._records.size; }

    /** Clear all history. */
    clear(): void {
        this._records.clear();
        this._persist();
    }

    /** Serialize to plain object */
    serialize(): DailyStoreState {
        const records: Record<string, DailyRecord> = {};
        for (const [date, record] of this._records) {
            records[date] = record;
        }
        return { version: 1, records };
    }

    /** Restore the full in-memory snapshot and persist it back to storage. */
    restoreSnapshot(state: DailyStoreState): void {
        this._records.clear();
        if (state && state.version === 1 && state.records && typeof state.records === 'object') {
            for (const [date, record] of Object.entries(state.records)) {
                const sanitized = sanitizeImportedDailyRecord(date, record);
                if (sanitized) {
                    this._records.set(sanitized.date, sanitized);
                }
            }
        }
        this._trimOld();
        this._persist();
    }

    // ─── Internal ────────────────────────────────────────────────────────

    /** Remove records older than _maxDays */
    private _trimOld(): void {
        if (this._records.size <= this._maxDays) { return; }
        const sorted = [...this._records.keys()].sort();
        const excess = sorted.length - this._maxDays;
        for (let i = 0; i < excess; i++) {
            this._records.delete(sorted[i]);
        }
    }

    private _persistWithOutcome(): { syncOk: boolean; promise: Promise<boolean> } {
        if (!this._globalState) {
            return { syncOk: true, promise: Promise.resolve(true) };
        }
        try {
            const ret = this._globalState.update(STORAGE_KEY, this.serialize());
            const promise = Promise.resolve(ret).then((val: unknown) => {
                if (val && typeof val === 'object' && 'committed' in val) {
                    return Boolean((val as { committed?: unknown }).committed);
                }
                return true;
            }, () => false);
            return { syncOk: true, promise };
        } catch {
            return { syncOk: false, promise: Promise.resolve(false) };
        }
    }

    private _persist(): void {
        if (this._globalState) {
            this._globalState.update(STORAGE_KEY, this.serialize());
        }
    }
}

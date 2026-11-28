// ─── Daily Archival Logic ────────────────────────────────────────────────────
// Pure logic extracted from extension.ts so it can be unit tested with injected
// dependencies.  extension.ts wires up the concrete instances and delegates here.

import type { ActivityTracker } from './activity-tracker';
import type { GMTracker, GMSummary, GMModelStats } from './gm-tracker';
import {
    buildGMPerModelStats,
    collectCycleRecordedCallIds,
    computeAdditiveTokens,
    getCycleSurfaces,
    type DailyCycleEntry,
    type DailyMergedLateCall,
    type DailyRecord,
    type DailyStore,
} from './daily-store';
import type { PricingStore, ModelPricing, OrchestratorPricingMode } from './pricing-store';
import {
    calculateLedgerModelCosts,
    calculateUsageCosts,
    getOrchestratorPricingMode,
    resolvePricingDetail,
    samePricingModel,
    selectPricingModel,
} from './pricing-store';
import type { PersistedModelDNA } from './model-dna-store';
import { mergeModelDNAState } from './model-dna-store';
import {
    UNATTRIBUTED_WORKSPACE_KEY,
    aggregateWorkspaceLeaderboard,
    canonicalLogicalCallId,
    cloneSurfaceBreakdown,
    cloneWorkspaceBreakdown,
    dominantUsageSurface,
    normalizeUsageSurface,
    normalizeWorkspaceKey,
    type DailyLedger,
    type LedgerAccountBucket,
    type LedgerRecordedCall,
    type LedgerDayData,
    type LedgerModelTelemetry,
    type LedgerSettledEntry,
    type SurfaceUsageStats,
    type UsageSurface,
    type WorkspaceUsageStats,
} from './daily-ledger';

export { UNATTRIBUTED_WORKSPACE_KEY, aggregateWorkspaceLeaderboard };

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Extract local date key 'YYYY-MM-DD' from a Date object. */
export function toLocalDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ─── Archived Dependencies ───────────────────────────────────────────────────
// All mutable state that performDailyArchival needs is passed via this context
// object, so the function is deterministic and testable.

export interface DailyArchivalContext {
    activityTracker: ActivityTracker;
    gmTracker: GMTracker;
    dailyStore: DailyStore | null;
    pricingStore: PricingStore | null;
    lastGMSummary: GMSummary | null;
    persistedModelDNA: Record<string, PersistedModelDNA>;
    lastArchivalDateKey: string;
    /** DailyLedger for incremental accounting (added v1.18.0) */
    dailyLedger: DailyLedger | null;
    /** Optional origin surface ('app' | 'ide' | 'cli' | 'unknown') for source tagging */
    surface?: UsageSurface;
    /** Optional pre-archival flush callback (sync or async, e.g. final GM fetch & flush into DailyLedger right before rollover). */
    preArchivalFlush?: () => void | Promise<void>;
    /** Optional persistence confirmation hook (e.g. `() => durableState.flush().then(r => r.committed)`).
     *  When provided to async archival/late-day flush, late queues are drained ONLY after this confirms true. */
    confirmPersist?: () => boolean | Promise<boolean>;

    /** Write-back: called when state needs persisting. */
    persist: (updates: DailyArchivalPersistUpdates) => void | Promise<void>;
    /** Logging callback. */
    log: (msg: string) => void;
}

export interface DailyArchivalPersistUpdates {
    lastArchivalDateKey: string;
    lastGMSummary: GMSummary | null;
    persistedModelDNA?: Record<string, PersistedModelDNA>;
    modelDNAChanged: boolean;
}

export interface DailyArchivalResult {
    /** Whether archival actually ran (data was written). */
    archived: boolean;
    /** The date key that was archived (yesterday or forced today). */
    archiveDateKey: string;
    /** Whether this was the first-ever run (no prior dateKey). */
    firstRun: boolean;
    /** Whether the date was the same (no-op). */
    sameDay: boolean;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Perform daily archival: snapshot all data → write to DailyStore → clear runtime.
 * Called on every poll; only executes when the local date has changed.
 *
 * Data source priority:
 *   1. DailyLedger.rollover() — incremental accounting, most reliable
 *   2. Fallback: getArchivalSummary() + pendingArchives (legacy path)
 *
 * @param ctx  All dependencies injected.
 * @param force If true, skip date-change check (for dev simulation).
 * @param now  The current date (injectable for testing).
 */
function sweepUnrecordedGMCallsForArchiveDate(
    ctx: DailyArchivalContext,
    archiveDateKey: string,
    force: boolean,
): void {
    if (force || !ctx.dailyLedger || ctx.dailyLedger.dateKey !== archiveDateKey) {
        return;
    }
    const gmAny = ctx.gmTracker as {
        getNewCallsSinceLastRecord?: GMTracker['getNewCallsSinceLastRecord'];
        markLedgerEntriesRecorded?: GMTracker['markLedgerEntriesRecorded'];
    };
    if (typeof gmAny.getNewCallsSinceLastRecord !== 'function') {
        return;
    }
    try {
        // Use getNewCallsSinceLastRecord() so first-start baselined calls are NEVER rescanned!
        const { entries: newEntries, revertedCascadeIds } = gmAny.getNewCallsSinceLastRecord.call(ctx.gmTracker);
        for (const cid of revertedCascadeIds) {
            ctx.dailyLedger.clearRecordedIdsForConversation(cid);
        }
        const matchingArchiveEntries = newEntries.filter((entry) => {
            if (!entry.call.createdAt) { return false; }
            const ts = Date.parse(entry.call.createdAt);
            return !Number.isNaN(ts) && toLocalDateKey(new Date(ts)) === archiveDateKey;
        });
        if (matchingArchiveEntries.length > 0) {
            const detailed = ctx.dailyLedger.recordCallsDetailed(matchingArchiveEntries, ctx.surface);
            if (typeof gmAny.markLedgerEntriesRecorded === 'function') {
                gmAny.markLedgerEntriesRecorded.call(ctx.gmTracker, matchingArchiveEntries, detailed.statuses);
            }
            if (detailed.added > 0) {
                ctx.log(`Daily archival pre-flush swept ${detailed.added} late GM call(s) into ${archiveDateKey}`);
            }
        }
    } catch {
        // Non-critical pre-archival sweep
    }
}

function collectDayDataRecordedCallIds(dayData: LedgerDayData): string[] {
    const ids = new Set<string>();
    for (const bucket of Object.values(dayData.accounts)) {
        for (const id of bucket.recordedCallIds || []) {
            if (id) { ids.add(canonicalLogicalCallId(id)); }
        }
        for (const call of bucket.recordedCalls || []) {
            if (call.callId) { ids.add(canonicalLogicalCallId(call.callId)); }
        }
    }
    for (const settled of dayData.settled || []) {
        for (const id of settled.recordedCallIds || []) {
            if (id) { ids.add(canonicalLogicalCallId(id)); }
        }
        for (const call of settled.settledCalls || []) {
            if (call.callId) { ids.add(canonicalLogicalCallId(call.callId)); }
        }
    }
    return [...ids];
}

function executeDailyArchivalBody(
    ctx: DailyArchivalContext,
    archiveDateKey: string,
    todayKey: string,
    force: boolean,
): {
    archived: boolean;
    persistUpdates: DailyArchivalPersistUpdates;
} {
    // 0b. Sweep any unrecorded post-baseline GM calls matching archiveDateKey right before rollover
    sweepUnrecordedGMCallsForArchiveDate(ctx, archiveDateKey, force);

    // 1. Snapshot Activity
    const activitySummary = ctx.activityTracker.getSummary();
    const hasActivity = activitySummary.totalReasoning > 0
        || activitySummary.totalToolCalls > 0;

    // 2. Build GM summary — use DailyLedger if available, else legacy path
    let gmSummary: GMSummary | null = null;
    let costTotal: number | undefined;
    let costPerModel: Record<string, number> | undefined;
    let resolvedSurface: UsageSurface | undefined = ctx.surface ? normalizeUsageSurface(ctx.surface) : undefined;
    let resolvedSurfaceBreakdown: Partial<Record<UsageSurface, SurfaceUsageStats>> | undefined;
    let resolvedWorkspaceBreakdown: Record<string, WorkspaceUsageStats> | undefined;
    let resolvedAccountEmail: string | undefined;
    let recordedCallIds: string[] | undefined;
    let snapshotCalls: DailyMergedLateCall[] | undefined;

    if (ctx.dailyLedger && !ctx.dailyLedger.hasData) {
        const previousLedgerDateKey = ctx.dailyLedger.dateKey;
        if (ctx.dailyLedger.normalizeIfStaleEmpty(todayKey)) {
            ctx.log(`DailyLedger normalized empty ledger date ${previousLedgerDateKey} → ${ctx.dailyLedger.dateKey}`);
        }
    }

    if (ctx.dailyLedger && ctx.dailyLedger.hasData) {
        // ── New path: DailyLedger is the source of truth ──
        const dayData = ctx.dailyLedger.rollover(archiveDateKey);
        recordedCallIds = collectDayDataRecordedCallIds(dayData);
        snapshotCalls = buildLateMergedCallsFromDayData(dayData, ctx.pricingStore?.getCustom(), ctx.surface, ctx.dailyLedger.surface).calls;
        const result = buildGMSummaryFromLedger(dayData, ctx.pricingStore?.getCustom());
        gmSummary = result.summary;
        costTotal = result.totalCost > 0 ? result.totalCost : undefined;
        costPerModel = result.costPerModel;
        resolvedSurface = result.surface ?? resolvedSurface ?? (ctx.dailyLedger.surface !== 'unknown' ? ctx.dailyLedger.surface : undefined);
        resolvedSurfaceBreakdown = result.surfaceBreakdown;
        resolvedWorkspaceBreakdown = result.workspaceBreakdown;
        const distinctEmails = new Set<string>();
        for (const email of Object.keys(dayData.accounts)) {
            if (email) { distinctEmails.add(email); }
        }
        for (const s of dayData.settled) {
            if (s.accountEmail) { distinctEmails.add(s.accountEmail); }
        }
        if (distinctEmails.size === 1) {
            resolvedAccountEmail = [...distinctEmails][0];
        }
        ctx.log(`DailyLedger rollover: ${gmSummary.totalCalls} calls, $${(result.totalCost || 0).toFixed(4)} cost`);
    } else {
        // ── Legacy path: getArchivalSummary + pendingArchives ──
        gmSummary = buildGMSummaryLegacy(ctx);
    }

    const hasGM = !!(gmSummary && gmSummary.totalCalls > 0);

    // 3. Calculate cost (only if ledger didn't provide it)
    if (costTotal === undefined && gmSummary && ctx.pricingStore) {
        const custom = ctx.pricingStore.getCustom();
        const perModel: Record<string, number> = {};
        let total = 0;
        for (const [key, ms] of Object.entries(gmSummary.modelBreakdown)) {
            const model = selectPricingModel(key, ms.responseModel, custom);
            const calls = (gmSummary.conversations || []).flatMap(conversation => conversation.calls)
                .filter(call => samePricingModel(call.modelDisplay || call.model || call.responseModel, model));
            const cost = calculateUsageCosts(model, {
                inputTokens: ms.totalInputTokens,
                outputTokens: ms.totalOutputTokens,
                thinkingTokens: ms.totalThinkingTokens,
                cacheReadTokens: ms.totalCacheRead,
            }, custom, { at: archiveDateKey, calls, callCount: ms.callCount }).totalCost;
            if (cost > 0) { perModel[key] = cost; total += cost; }
        }
        if (total > 0) { costTotal = total; }
        costPerModel = perModel;
    }

    // 4. Write to DailyStore (only if there's actual data)
    if ((hasActivity || hasGM) && ctx.dailyStore) {
        const meta = (resolvedSurface && resolvedSurface !== 'unknown')
            || resolvedSurfaceBreakdown
            || resolvedWorkspaceBreakdown
            || resolvedAccountEmail
            || (recordedCallIds && recordedCallIds.length > 0)
            ? {
                ...(resolvedSurface && resolvedSurface !== 'unknown' ? { surface: resolvedSurface } : {}),
                ...(resolvedSurfaceBreakdown ? { surfaceBreakdown: resolvedSurfaceBreakdown } : {}),
                ...(resolvedWorkspaceBreakdown ? { workspaceBreakdown: resolvedWorkspaceBreakdown } : {}),
                ...(resolvedAccountEmail ? { accountEmail: resolvedAccountEmail } : {}),
                ...(recordedCallIds && recordedCallIds.length > 0 ? { recordedCallIds } : {}),
                ...(snapshotCalls?.length ? { snapshotCalls } : {}),
            }
            : undefined;
        ctx.dailyStore.addDailySnapshot(
            archiveDateKey,
            activitySummary,
            gmSummary || null,
            costTotal,
            costPerModel,
            false,
            meta,
        );
        ctx.log(`Daily snapshot written for ${archiveDateKey}`);
    } else {
        ctx.log(`Daily archival skipped for ${archiveDateKey} — no data`);
    }

    // 5. Merge ModelDNA before clearing GM
    let modelDNAChanged = false;
    let updatedDNA = ctx.persistedModelDNA;
    if (gmSummary) {
        const mergedDNA = mergeModelDNAState(ctx.persistedModelDNA, gmSummary);
        if (mergedDNA.changed) {
            updatedDNA = mergedDNA.entries;
            modelDNAChanged = true;
        }
    }

    // 6. Global reset
    ctx.activityTracker.archiveAndReset();
    ctx.gmTracker.reset();
    const newGMSummary = ctx.gmTracker.getDetailedSummary() || ctx.gmTracker.getCachedSummary();

    return {
        archived: hasActivity || !!hasGM,
        persistUpdates: {
            lastArchivalDateKey: todayKey,
            lastGMSummary: newGMSummary,
            persistedModelDNA: modelDNAChanged ? updatedDNA : undefined,
            modelDNAChanged,
        },
    };
}

/**
 * Perform daily archival synchronously (backward-compatible entrypoint).
 * Prefer {@link performDailyArchivalAsync} when `preArchivalFlush` or `confirmPersist` is async.
 */
export function performDailyArchival(
    ctx: DailyArchivalContext,
    force = false,
    now: Date = new Date(),
): DailyArchivalResult {
    const todayKey = toLocalDateKey(now);

    if (!force) {
        if (!ctx.lastArchivalDateKey) {
            ctx.persist({
                lastArchivalDateKey: todayKey,
                lastGMSummary: ctx.lastGMSummary,
                modelDNAChanged: false,
            });
            return { archived: false, archiveDateKey: todayKey, firstRun: true, sameDay: false };
        }
        if (ctx.lastArchivalDateKey === todayKey) {
            if (ctx.dailyLedger && ctx.dailyStore && typeof ctx.dailyLedger.getLateDaySnapshots === 'function'
                && ctx.dailyLedger.getLateDaySnapshots().length > 0) {
                flushLateDaysToDailyStore(
                    ctx.dailyLedger,
                    ctx.dailyStore,
                    ctx.pricingStore?.getCustom(),
                    ctx.surface,
                    ctx.log,
                );
            }
            return { archived: false, archiveDateKey: todayKey, firstRun: false, sameDay: true };
        }
    }

    // ── Date rolled over → archive yesterday's data ──
    const archiveDateKey = force ? todayKey : ctx.lastArchivalDateKey;
    ctx.log(`Daily archival triggered: ${archiveDateKey} → ${todayKey}`);

    if (ctx.preArchivalFlush) {
        try {
            ctx.preArchivalFlush();
        } catch (err) {
            ctx.log(`Daily archival pre-flush hook failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const { archived, persistUpdates } = executeDailyArchivalBody(ctx, archiveDateKey, todayKey, force);

    // 4b. Idempotently merge any pending late-arriving cross-midnight buckets into their true local dates
    let lateFlushed = 0;
    if (ctx.dailyLedger && ctx.dailyStore && typeof ctx.dailyLedger.getLateDaySnapshots === 'function'
        && ctx.dailyLedger.getLateDaySnapshots().length > 0) {
        lateFlushed = flushLateDaysToDailyStore(
            ctx.dailyLedger,
            ctx.dailyStore,
            ctx.pricingStore?.getCustom(),
            ctx.surface,
            ctx.log,
        );
    }

    // 7. Persist everything
    ctx.persist(persistUpdates);

    ctx.log(`Daily archival completed for ${archiveDateKey}`);
    return { archived: archived || lateFlushed > 0, archiveDateKey, firstRun: false, sameDay: false };
}

/**
 * Asynchronous daily archival that awaits `ctx.preArchivalFlush()` (so an async GM fetch/flush
 * completes cleanly BEFORE rollover), awaits idempotent late-day persistence before draining
 * pending late queues, and awaits `ctx.persist(...)`.
 */
export async function performDailyArchivalAsync(
    ctx: DailyArchivalContext,
    force = false,
    now: Date = new Date(),
): Promise<DailyArchivalResult> {
    const todayKey = toLocalDateKey(now);

    if (!force) {
        if (!ctx.lastArchivalDateKey) {
            await ctx.persist({
                lastArchivalDateKey: todayKey,
                lastGMSummary: ctx.lastGMSummary,
                modelDNAChanged: false,
            });
            return { archived: false, archiveDateKey: todayKey, firstRun: true, sameDay: false };
        }
        if (ctx.lastArchivalDateKey === todayKey) {
            if (ctx.dailyLedger && ctx.dailyStore && typeof ctx.dailyLedger.getLateDaySnapshots === 'function'
                && ctx.dailyLedger.getLateDaySnapshots().length > 0) {
                await flushLateDaysToDailyStoreAsync(
                    ctx.dailyLedger,
                    ctx.dailyStore,
                    ctx.pricingStore?.getCustom(),
                    ctx.surface,
                    ctx.log,
                    undefined,
                    ctx.confirmPersist,
                );
            }
            return { archived: false, archiveDateKey: todayKey, firstRun: false, sameDay: true };
        }
    }

    // ── Date rolled over → await async pre-archival flush BEFORE sweeping & rolling over ──
    const archiveDateKey = force ? todayKey : ctx.lastArchivalDateKey;
    ctx.log(`Daily archival triggered: ${archiveDateKey} → ${todayKey}`);

    if (ctx.preArchivalFlush) {
        try {
            await ctx.preArchivalFlush();
        } catch (err) {
            ctx.log(`Daily archival pre-flush hook failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const { archived, persistUpdates } = executeDailyArchivalBody(ctx, archiveDateKey, todayKey, force);

    // 4b. Idempotently merge & confirm-persist pending late-arriving cross-midnight buckets
    let lateFlushed = 0;
    if (ctx.dailyLedger && ctx.dailyStore && typeof ctx.dailyLedger.getLateDaySnapshots === 'function'
        && ctx.dailyLedger.getLateDaySnapshots().length > 0) {
        lateFlushed = await flushLateDaysToDailyStoreAsync(
            ctx.dailyLedger,
            ctx.dailyStore,
            ctx.pricingStore?.getCustom(),
            ctx.surface,
            ctx.log,
            undefined,
            ctx.confirmPersist,
        );
    }

    // 7. Persist everything
    await ctx.persist(persistUpdates);

    ctx.log(`Daily archival completed for ${archiveDateKey}`);
    return { archived: archived || lateFlushed > 0, archiveDateKey, firstRun: false, sameDay: false };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildLateMergedCallsFromDayData(
    dayData: LedgerDayData,
    customPricing?: Record<string, ModelPricing>,
    defaultSurface?: UsageSurface,
    ledgerSurface?: UsageSurface,
    orchestratorPricingMode?: OrchestratorPricingMode,
): {
    calls: DailyMergedLateCall[];
    rawCallIds: string[];
    accountEmail?: string;
    resolvedSurface?: UsageSurface;
} {
    const custom = customPricing || {};
    const mode = orchestratorPricingMode ?? getOrchestratorPricingMode();
    const fallbackSurface = defaultSurface && normalizeUsageSurface(defaultSurface) !== 'unknown'
        ? normalizeUsageSurface(defaultSurface)
        : (ledgerSurface && normalizeUsageSurface(ledgerSurface) !== 'unknown'
            ? normalizeUsageSurface(ledgerSurface)
            : undefined);

    const calls: DailyMergedLateCall[] = [];
    const rawCallIds: string[] = [];
    const distinctEmails = new Set<string>();

    const project = (email: string, recorded: readonly LedgerRecordedCall[], ids?: readonly string[], surface?: UsageSurface) => {
        if (email) { distinctEmails.add(email); }
        for (const id of ids || []) {
            if (id) { rawCallIds.push(id); }
        }
        const bucketSurface = surface && normalizeUsageSurface(surface) !== 'unknown'
            ? normalizeUsageSurface(surface)
            : fallbackSurface;

        for (const rc of recorded) {
            if (!rc || !rc.callId) { continue; }
            const modelKey = rc.modelKey || rc.modelId || 'Unknown';
            const at = rc.createdAt || dayData.dateKey;
            const detail = resolvePricingDetail(modelKey, custom, { at, orchestratorPricingMode: mode });
            const suppressFrozenFallback = Boolean(detail.mappedBaseKey && mode === 'strict' && detail.provenance === 'unpriced');
            const repriced = calculateUsageCosts(modelKey, {
                inputTokens: rc.inputTokens,
                outputTokens: rc.outputTokens,
                thinkingTokens: rc.thinkingTokens,
                cacheReadTokens: rc.cacheReadTokens,
            }, custom, {
                at,
                calls: [{ ...rc, model: modelKey }],
                callCount: 1,
                frozenCost: suppressFrozenFallback ? undefined : rc.estimatedCost,
                orchestratorPricingMode: mode,
            }).totalCost;

            const callSurf = normalizeUsageSurface(rc.surface ?? bucketSurface);
            const isUnpriced = detail.pricing === null || (suppressFrozenFallback && repriced === 0);
            calls.push({
                callId: canonicalLogicalCallId(rc.callId),
                createdAt: rc.createdAt,
                createdAtMs: rc.createdAtMs,
                modelId: rc.modelId,
                modelKey,
                inputTokens: rc.inputTokens,
                outputTokens: rc.outputTokens,
                thinkingTokens: rc.thinkingTokens,
                cacheReadTokens: rc.cacheReadTokens,
                cacheCreationTokens: rc.cacheCreationTokens,
                credits: rc.credits,
                estimatedCost: isUnpriced ? 0 : repriced,
                ...(rc.ttftSeconds !== undefined ? { ttftSeconds: rc.ttftSeconds } : {}),
                ...(rc.streamingSeconds !== undefined ? { streamingSeconds: rc.streamingSeconds } : {}),
                ...(callSurf !== 'unknown' ? { surface: callSurf } : {}),
                ...(email ? { accountEmail: email } : {}),
                ...(rc.account || email ? { account: rc.account || email } : {}),
                ...(rc.authority ? { authority: rc.authority } : {}),
                ...(rc.cascadeId ? { cascadeId: rc.cascadeId } : {}),
                ...(rc.workspace ? { workspace: rc.workspace } : {}),
                ...(isUnpriced ? { unpriced: true } : {}),
            });
            rawCallIds.push(rc.callId);
        }
    };
    for (const [emailKey, bucket] of Object.entries(dayData.accounts)) {
        project(bucket.accountEmail || emailKey, bucket.recordedCalls || [], bucket.recordedCallIds, bucket.surface);
    }
    for (const entry of dayData.settled || []) {
        project(entry.accountEmail, entry.settledCalls || [], entry.recordedCallIds, entry.surface);
    }

    return {
        calls,
        rawCallIds,
        ...(distinctEmails.size === 1 ? { accountEmail: [...distinctEmails][0] } : {}),
        ...(fallbackSurface ? { resolvedSurface: fallbackSurface } : {}),
    };
}

/**
 * Flush pending late-arriving cross-midnight buckets from `DailyLedger` into their
 * true local dates in `DailyStore`.
 * - Idempotently merges into the target date's existing archive (preserving existing activity
 *   and existing calls, deduplicating by durable logical call ID).
 * - Drains pending late calls ONLY after persistence confirms success.
 * Returns the number of late days flushed.
 */
export function flushLateDaysToDailyStore(
    ledger: DailyLedger,
    dailyStore: DailyStore,
    customPricing?: Record<string, ModelPricing>,
    defaultSurface?: UsageSurface,
    log?: (msg: string) => void,
    orchestratorPricingMode?: OrchestratorPricingMode,
): number {
    // A synchronous caller cannot confirm an asynchronous backing-store write.
    // Leave the queue intact until the regular receipt-aware path acknowledges it.
    if (dailyStore.hasBackingStore) {
        void flushLateDaysToDailyStoreAsync(ledger, dailyStore, customPricing, defaultSurface, log, orchestratorPricingMode)
            .catch(() => log?.('Deferred late calls after a backing-store failure'));
        return 0;
    }
    const lateDays = ledger.getLateDaySnapshots();
    if (lateDays.length === 0) { return 0; }

    let flushed = 0;

    for (const dayData of lateDays) {
        const { calls, rawCallIds, accountEmail, resolvedSurface } = buildLateMergedCallsFromDayData(
            dayData,
            customPricing,
            defaultSurface,
            ledger.surface,
            orchestratorPricingMode,
        );
        if (calls.length === 0) { continue; }

        const res = dailyStore.mergeLateDayCalls(dayData.dateKey, calls, {
            defaultSurface: resolvedSurface,
            accountEmail,
        });
        if (!res.persisted) {
            log?.(`Deferred draining late calls for ${dayData.dateKey}: persistence failed`);
            continue;
        }
        // Persistence confirmed: acknowledge & drain ONLY the flushed calls for this date
        ledger.acknowledgeLateDayCalls(dayData.dateKey, rawCallIds);
        if (res.appliedCalls > 0) {
            flushed++;
            log?.(`Merged ${res.appliedCalls} late pre-midnight call(s) into ${dayData.dateKey}`);
        }
    }
    return flushed;
}

/**
 * Async variant of {@link flushLateDaysToDailyStore} that awaits persistence confirmation
 * (including an optional `confirmPersist` check such as `DurableState.flush()`) BEFORE
 * draining pending late calls from `DailyLedger`.
 */
export async function flushLateDaysToDailyStoreAsync(
    ledger: DailyLedger,
    dailyStore: DailyStore,
    customPricing?: Record<string, ModelPricing>,
    defaultSurface?: UsageSurface,
    log?: (msg: string) => void,
    orchestratorPricingMode?: OrchestratorPricingMode,
    confirmPersist?: () => boolean | Promise<boolean>,
): Promise<number> {
    const lateDays = ledger.getLateDaySnapshots();
    if (lateDays.length === 0) { return 0; }

    let flushed = 0;

    for (const dayData of lateDays) {
        const { calls, rawCallIds, accountEmail, resolvedSurface } = buildLateMergedCallsFromDayData(
            dayData,
            customPricing,
            defaultSurface,
            ledger.surface,
            orchestratorPricingMode,
        );
        if (calls.length === 0) { continue; }

        const res = await dailyStore.mergeLateDayCallsAsync(dayData.dateKey, calls, {
            defaultSurface: resolvedSurface,
            accountEmail,
            confirmPersist,
        });
        if (!res.committed) {
            log?.(`Deferred draining late calls for ${dayData.dateKey}: durable commit not confirmed`);
            continue;
        }
        ledger.acknowledgeLateDayCalls(dayData.dateKey, rawCallIds);
        if (res.appliedCalls > 0) {
            flushed++;
            log?.(`Merged ${res.appliedCalls} late pre-midnight call(s) into ${dayData.dateKey}`);
        }
    }
    return flushed;
}

/**
 * Dynamically recalculate a settled ledger entry's cost using its preserved per-model
 * token totals (`entry.modelStats`), respecting custom pricing overrides and Orchestrator
 * billing mode (`mapped` vs `strict`). Falls back to frozen `entry.totalEstimatedCost`
 * only for legacy v1 settled entries that predate `modelStats`.
 */
export function calculateSettledEntryCosts(
    entry: LedgerSettledEntry,
    dateKey: string,
    customPricing?: Record<string, ModelPricing>,
    orchestratorPricingMode?: OrchestratorPricingMode,
): { totalCost: number; costPerModel: Record<string, number> } {
    const costPerModel: Record<string, number> = {};
    let totalCost = 0;

    if (entry.modelStats && Object.keys(entry.modelStats).length > 0) {
        const custom = customPricing || {};
        const mode = orchestratorPricingMode ?? getOrchestratorPricingMode();
        for (const [modelKey, ms] of Object.entries(entry.modelStats)) {
            const detail = resolvePricingDetail(modelKey, custom, { at: dateKey, orchestratorPricingMode: mode });
            // When an Orchestrator model is explicitly evaluated under 'strict' mode without a custom price,
            // do NOT fall back to the frozen 'mapped' cost recorded earlier.
            const suppressFrozenFallback = Boolean(detail.mappedBaseKey && mode === 'strict' && detail.provenance === 'unpriced');
            const cost = calculateUsageCosts(modelKey, ms, custom, {
                at: dateKey,
                calls: entry.settledCalls?.filter(c => c.modelKey === modelKey).map(c => ({ ...c, model: modelKey })),
                callCount: ms.calls,
                frozenCost: suppressFrozenFallback ? undefined : ms.estimatedCost,
                orchestratorPricingMode: mode,
            }).totalCost;
            if (cost > 0) {
                costPerModel[modelKey] = (costPerModel[modelKey] || 0) + cost;
                totalCost += cost;
            }
        }
        return { totalCost, costPerModel };
    }

    // Legacy fallback: settled entry without per-model token totals
    if (entry.totalEstimatedCost > 0) {
        totalCost = entry.totalEstimatedCost;
        if (entry.totalCalls > 0) {
            for (const [modelKey, calls] of Object.entries(entry.modelCalls || {})) {
                const ratio = calls / entry.totalCalls;
                costPerModel[modelKey] = (costPerModel[modelKey] || 0) + entry.totalEstimatedCost * ratio;
            }
        }
    }
    return { totalCost, costPerModel };
}

/**
 * Build a GMSummary-compatible object from DailyLedger rollover data.
 *
 * `customPricing` and `orchestratorPricingMode` re-price both active buckets and settled
 * entries that retain per-model token totals (`entry.modelStats`), while falling back to
 * frozen totals for legacy v1 settled entries.
 */
export function buildGMSummaryFromLedger(
    dayData: LedgerDayData,
    customPricing?: Record<string, ModelPricing>,
    orchestratorPricingMode?: OrchestratorPricingMode,
): {
    summary: GMSummary;
    totalCost: number;
    costPerModel: Record<string, number>;
    surface?: UsageSurface;
    surfaceBreakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    workspaceBreakdown?: Record<string, WorkspaceUsageStats>;
} {
    let totalCalls = 0;
    let totalIn = 0, totalOut = 0, totalThinking = 0;
    let totalCacheRead = 0, totalCacheCreation = 0, totalCredits = 0;
    let totalCost = 0;
    const modelBreakdown: Record<string, GMModelStats> = {};
    const telemetryByModel: Record<string, LedgerModelTelemetry> = {};
    const costPerModel: Record<string, number> = {};
    const surfaceBreakdown: Partial<Record<UsageSurface, SurfaceUsageStats>> = {};
    const workspaceBreakdown = Object.create(null) as Record<string, WorkspaceUsageStats>;
    const FORBIDDEN_WS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    let hasExplicitSurface = false;
    let hasWorkspaceAttribution = false;
    const custom = customPricing || {};
    const pricingMode = orchestratorPricingMode ?? getOrchestratorPricingMode();

    const addWorkspaceEntry = (wsKey: string, stats: WorkspaceUsageStats): void => {
        const key = wsKey || UNATTRIBUTED_WORKSPACE_KEY;
        if (FORBIDDEN_WS_KEYS.has(key) || !stats || typeof stats !== 'object') { return; }
        const cur = Object.prototype.hasOwnProperty.call(workspaceBreakdown, key)
            ? workspaceBreakdown[key]
            : {
                calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0,
                knownCostUsd: 0, unpricedCalls: 0,
                ...(stats.authority ? { authority: stats.authority } : {}),
            };
        cur.calls += stats.calls;
        cur.inputTokens += stats.inputTokens;
        cur.outputTokens += stats.outputTokens;
        cur.thinkingTokens += stats.thinkingTokens;
        cur.cacheReadTokens += stats.cacheReadTokens;
        cur.cacheCreationTokens += stats.cacheCreationTokens;
        cur.credits += stats.credits;
        cur.knownCostUsd += stats.knownCostUsd;
        cur.unpricedCalls += stats.unpricedCalls;
        if (!cur.authority && stats.authority) { cur.authority = stats.authority; }
        if (stats.bySurface && typeof stats.bySurface === 'object') {
            if (!cur.bySurface) { cur.bySurface = {}; }
            for (const [sk, sv] of Object.entries(stats.bySurface)) {
                if (FORBIDDEN_WS_KEYS.has(sk) || !sv || sv.calls <= 0) { continue; }
                const surf = normalizeUsageSurface(sk);
                const prev = Object.prototype.hasOwnProperty.call(cur.bySurface, surf)
                    ? cur.bySurface[surf]!
                    : {
                        calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                        cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0,
                    };
                prev.calls += sv.calls;
                prev.inputTokens += sv.inputTokens;
                prev.outputTokens += sv.outputTokens;
                prev.thinkingTokens += sv.thinkingTokens;
                prev.cacheReadTokens += sv.cacheReadTokens;
                prev.cacheCreationTokens += sv.cacheCreationTokens;
                prev.credits += sv.credits;
                prev.estimatedCost += sv.estimatedCost;
                cur.bySurface[surf] = prev;
            }
        }
        workspaceBreakdown[key] = cur;
    };

    const addRepricedCallsToWorkspaceBreakdown = (
        calls: readonly import('./daily-ledger').LedgerRecordedCall[],
        fallbackSurface: UsageSurface,
    ): void => {
        for (const rc of calls) {
            const wsKey = normalizeWorkspaceKey(rc.workspace, rc.authority);
            const surf = normalizeUsageSurface(rc.surface ?? fallbackSurface);
            const modelKey = rc.modelKey || rc.modelId || 'Unknown';
            const detail = resolvePricingDetail(modelKey, custom, { at: rc.createdAt || dayData.dateKey, orchestratorPricingMode: pricingMode });
            const suppressFrozen = Boolean(detail.mappedBaseKey && pricingMode === 'strict' && detail.provenance === 'unpriced');
            const isUnpriced = detail.pricing === null || suppressFrozen;
            const repriced = isUnpriced ? 0 : calculateUsageCosts(modelKey, {
                inputTokens: rc.inputTokens,
                outputTokens: rc.outputTokens,
                thinkingTokens: rc.thinkingTokens,
                cacheReadTokens: rc.cacheReadTokens,
            }, custom, {
                at: rc.createdAt || dayData.dateKey,
                callCount: 1,
                frozenCost: suppressFrozen ? undefined : rc.estimatedCost,
                orchestratorPricingMode: pricingMode,
            }).totalCost;
            addWorkspaceEntry(wsKey, {
                calls: 1,
                inputTokens: rc.inputTokens,
                outputTokens: rc.outputTokens,
                thinkingTokens: rc.thinkingTokens,
                cacheReadTokens: rc.cacheReadTokens,
                cacheCreationTokens: rc.cacheCreationTokens,
                credits: rc.credits,
                knownCostUsd: isUnpriced ? 0 : repriced,
                unpricedCalls: isUnpriced ? 1 : 0,
                ...(rc.authority ? { authority: rc.authority } : {}),
                bySurface: {
                    [surf]: {
                        calls: 1,
                        inputTokens: rc.inputTokens,
                        outputTokens: rc.outputTokens,
                        thinkingTokens: rc.thinkingTokens,
                        cacheReadTokens: rc.cacheReadTokens,
                        cacheCreationTokens: rc.cacheCreationTokens,
                        credits: rc.credits,
                        estimatedCost: isUnpriced ? 0 : repriced,
                    },
                },
            });
        }
    };

    const addSurfaceEntry = (surf: UsageSurface, stats: SurfaceUsageStats): void => {
        if (surf !== 'unknown') { hasExplicitSurface = true; }
        const cur = surfaceBreakdown[surf] || {
            calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
            cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0,
        };
        cur.calls += stats.calls;
        cur.inputTokens += stats.inputTokens;
        cur.outputTokens += stats.outputTokens;
        cur.thinkingTokens += stats.thinkingTokens;
        cur.cacheReadTokens += stats.cacheReadTokens;
        cur.cacheCreationTokens += stats.cacheCreationTokens;
        cur.credits += stats.credits;
        cur.estimatedCost += stats.estimatedCost;
        surfaceBreakdown[surf] = cur;
    };

    // Merge active buckets
    for (const bucket of Object.values(dayData.accounts)) {
        totalCalls += bucket.totalCalls;
        totalIn += bucket.totalInputTokens;
        totalOut += bucket.totalOutputTokens;
        totalThinking += bucket.totalThinkingTokens;
        totalCacheRead += bucket.totalCacheRead;
        totalCacheCreation += bucket.totalCacheCreation;
        totalCredits += bucket.totalCredits;

        let bucketRepricedCost = 0;
        for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
            mergeModelIntoBreakdown(modelBreakdown, telemetryByModel, modelKey, ms.calls,
                ms.inputTokens, ms.outputTokens, ms.thinkingTokens,
                ms.cacheReadTokens, ms.cacheCreationTokens, ms.credits,
                {
                    ttftSum: ms.ttftSum || 0,
                    ttftCount: ms.ttftCount || 0,
                    minTTFT: ms.minTTFT || 0,
                    maxTTFT: ms.maxTTFT || 0,
                    streamingSum: ms.streamingSum || 0,
                    streamingCount: ms.streamingCount || 0,
                    timedOutputTokens: ms.timedOutputTokens || 0,
                    timedStreamingSeconds: ms.timedStreamingSeconds || 0,
                    cacheHitCalls: ms.cacheHitCalls || 0,
                });
            // The ledger files per-model rows under a display name, which is also the key
            // the Pricing tab writes custom prices under, so look pricing up by that key.
            const cost = calculateLedgerModelCosts(
                modelKey,
                ms,
                bucket,
                customPricing || {},
                dayData.dateKey,
                orchestratorPricingMode,
            ).totalCost;
            if (cost > 0) {
                costPerModel[modelKey] = (costPerModel[modelKey] || 0) + cost;
            }
            bucketRepricedCost += cost;
            totalCost += cost;
        }

        if (bucket.totalCalls > 0) {
            if (bucket.surfaceBreakdown) {
                const rawCostSum = Object.values(bucket.surfaceBreakdown).reduce((s, v) => s + (v?.estimatedCost || 0), 0);
                const costScale = rawCostSum > 0 ? bucketRepricedCost / rawCostSum : 1;
                for (const [sk, sv] of Object.entries(bucket.surfaceBreakdown)) {
                    if (!sv || sv.calls <= 0) { continue; }
                    addSurfaceEntry(normalizeUsageSurface(sk), {
                        ...sv,
                        estimatedCost: sv.estimatedCost * costScale,
                    });
                }
            } else {
                addSurfaceEntry(normalizeUsageSurface(bucket.surface), {
                    calls: bucket.totalCalls,
                    inputTokens: bucket.totalInputTokens,
                    outputTokens: bucket.totalOutputTokens,
                    thinkingTokens: bucket.totalThinkingTokens,
                    cacheReadTokens: bucket.totalCacheRead,
                    cacheCreationTokens: bucket.totalCacheCreation,
                    credits: bucket.totalCredits,
                    estimatedCost: bucketRepricedCost,
                });
            }

            const bucketHasWorkspace = Boolean(
                bucket.workspaceBreakdown
                || (Array.isArray(bucket.recordedCalls) && bucket.recordedCalls.some(c => Boolean(c.workspace || c.authority))),
            );
            if (bucketHasWorkspace) {
                hasWorkspaceAttribution = true;
            }
            if (Array.isArray(bucket.recordedCalls) && bucket.recordedCalls.length === bucket.totalCalls && bucketHasWorkspace) {
                addRepricedCallsToWorkspaceBreakdown(bucket.recordedCalls, normalizeUsageSurface(bucket.surface));
            } else if (bucket.workspaceBreakdown) {
                for (const [wk, wv] of Object.entries(bucket.workspaceBreakdown)) {
                    if (wv && wv.calls > 0) { addWorkspaceEntry(wk, wv); }
                }
            } else {
                // Legacy unattributed bucket -> explicitly mapped to UNATTRIBUTED_WORKSPACE_KEY (never smeared!)
                addWorkspaceEntry(UNATTRIBUTED_WORKSPACE_KEY, {
                    calls: bucket.totalCalls,
                    inputTokens: bucket.totalInputTokens,
                    outputTokens: bucket.totalOutputTokens,
                    thinkingTokens: bucket.totalThinkingTokens,
                    cacheReadTokens: bucket.totalCacheRead,
                    cacheCreationTokens: bucket.totalCacheCreation,
                    credits: bucket.totalCredits,
                    knownCostUsd: bucketRepricedCost,
                    unpricedCalls: 0,
                    bySurface: cloneSurfaceBreakdown(bucket.surfaceBreakdown) ?? {
                        [normalizeUsageSurface(bucket.surface)]: {
                            calls: bucket.totalCalls,
                            inputTokens: bucket.totalInputTokens,
                            outputTokens: bucket.totalOutputTokens,
                            thinkingTokens: bucket.totalThinkingTokens,
                            cacheReadTokens: bucket.totalCacheRead,
                            cacheCreationTokens: bucket.totalCacheCreation,
                            credits: bucket.totalCredits,
                            estimatedCost: bucketRepricedCost,
                        },
                    },
                });
            }
        }
    }

    // Merge settled entries (dynamically re-priced when per-model modelStats are retained)
    for (const entry of dayData.settled) {
        totalCalls += entry.totalCalls;
        totalIn += entry.totalInputTokens;
        totalOut += entry.totalOutputTokens;
        totalThinking += entry.totalThinkingTokens || 0;
        totalCacheRead += entry.totalCacheRead;
        totalCacheCreation += entry.totalCacheCreation || 0;
        totalCredits += entry.totalCredits;

        const settledCosts = calculateSettledEntryCosts(entry, dayData.dateKey, customPricing, orchestratorPricingMode);
        totalCost += settledCosts.totalCost;
        for (const [mk, mc] of Object.entries(settledCosts.costPerModel)) {
            if (mc > 0) {
                costPerModel[mk] = (costPerModel[mk] || 0) + mc;
            }
        }

        if (entry.totalCalls > 0) {
            if (entry.surfaceBreakdown) {
                const rawCostSum = Object.values(entry.surfaceBreakdown).reduce((s, v) => s + (v?.estimatedCost || 0), 0);
                const costScale = rawCostSum > 0 ? settledCosts.totalCost / rawCostSum : 1;
                for (const [sk, sv] of Object.entries(entry.surfaceBreakdown)) {
                    if (!sv || sv.calls <= 0) { continue; }
                    addSurfaceEntry(normalizeUsageSurface(sk), {
                        ...sv,
                        estimatedCost: sv.estimatedCost * costScale,
                    });
                }
            } else {
                addSurfaceEntry(normalizeUsageSurface(entry.surface), {
                    calls: entry.totalCalls,
                    inputTokens: entry.totalInputTokens,
                    outputTokens: entry.totalOutputTokens,
                    thinkingTokens: entry.totalThinkingTokens || 0,
                    cacheReadTokens: entry.totalCacheRead,
                    cacheCreationTokens: entry.totalCacheCreation || 0,
                    credits: entry.totalCredits,
                    estimatedCost: settledCosts.totalCost,
                });
            }

            const entryHasWorkspace = Boolean(
                entry.workspaceBreakdown
                || (Array.isArray(entry.settledCalls) && entry.settledCalls.some(c => Boolean(c.workspace || c.authority))),
            );
            if (entryHasWorkspace) {
                hasWorkspaceAttribution = true;
            }
            if (Array.isArray(entry.settledCalls) && entry.settledCalls.length === entry.totalCalls && entryHasWorkspace) {
                addRepricedCallsToWorkspaceBreakdown(entry.settledCalls, normalizeUsageSurface(entry.surface));
            } else if (entry.workspaceBreakdown) {
                for (const [wk, wv] of Object.entries(entry.workspaceBreakdown)) {
                    if (wv && wv.calls > 0) { addWorkspaceEntry(wk, wv); }
                }
            } else {
                addWorkspaceEntry(UNATTRIBUTED_WORKSPACE_KEY, {
                    calls: entry.totalCalls,
                    inputTokens: entry.totalInputTokens,
                    outputTokens: entry.totalOutputTokens,
                    thinkingTokens: entry.totalThinkingTokens || 0,
                    cacheReadTokens: entry.totalCacheRead,
                    cacheCreationTokens: entry.totalCacheCreation || 0,
                    credits: entry.totalCredits,
                    knownCostUsd: settledCosts.totalCost,
                    unpricedCalls: 0,
                    bySurface: cloneSurfaceBreakdown(entry.surfaceBreakdown) ?? {
                        [normalizeUsageSurface(entry.surface)]: {
                            calls: entry.totalCalls,
                            inputTokens: entry.totalInputTokens,
                            outputTokens: entry.totalOutputTokens,
                            thinkingTokens: entry.totalThinkingTokens || 0,
                            cacheReadTokens: entry.totalCacheRead,
                            cacheCreationTokens: entry.totalCacheCreation || 0,
                            credits: entry.totalCredits,
                            estimatedCost: settledCosts.totalCost,
                        },
                    },
                });
            }
        }

        if (entry.modelStats && Object.keys(entry.modelStats).length > 0) {
            for (const [modelKey, ms] of Object.entries(entry.modelStats)) {
                const telemetry: LedgerModelTelemetry = entry.modelTelemetry?.[modelKey] || {
                    ttftSum: ms.ttftSum || 0,
                    ttftCount: ms.ttftCount || 0,
                    minTTFT: ms.minTTFT || 0,
                    maxTTFT: ms.maxTTFT || 0,
                    streamingSum: ms.streamingSum || 0,
                    streamingCount: ms.streamingCount || 0,
                    timedOutputTokens: ms.timedOutputTokens || 0,
                    timedStreamingSeconds: ms.timedStreamingSeconds || 0,
                    cacheHitCalls: ms.cacheHitCalls || 0,
                };
                mergeModelIntoBreakdown(modelBreakdown, telemetryByModel, modelKey, ms.calls,
                    ms.inputTokens, ms.outputTokens, ms.thinkingTokens,
                    ms.cacheReadTokens, ms.cacheCreationTokens, ms.credits,
                    telemetry);
            }
        } else {
            const allocated = allocateSettledEntryByModel(entry);
            for (const [modelKey, calls] of Object.entries(entry.modelCalls)) {
                // Legacy settled entries only have per-model call counts; distribute totals proportionally.
                if (entry.totalCalls > 0) {
                    const modelTokens = allocated[modelKey];
                    mergeModelIntoBreakdown(modelBreakdown, telemetryByModel, modelKey, calls,
                        modelTokens?.inputTokens || 0,
                        modelTokens?.outputTokens || 0,
                        modelTokens?.thinkingTokens || 0,
                        modelTokens?.cacheReadTokens || 0,
                        modelTokens?.cacheCreationTokens || 0,
                        modelTokens?.credits || 0,
                        entry.modelTelemetry?.[modelKey]);
                }
            }
        }
    }

    // Finalize weighted averages & telemetry sample counts on each model row
    for (const [modelKey, ms] of Object.entries(modelBreakdown)) {
        const acc = telemetryByModel[modelKey];
        if (!acc) { continue; }
        ms.avgTTFT = acc.ttftCount > 0 ? acc.ttftSum / acc.ttftCount : 0;
        ms.minTTFT = acc.minTTFT || 0;
        ms.maxTTFT = acc.maxTTFT || 0;
        ms.avgStreaming = acc.streamingCount > 0 ? acc.streamingSum / acc.streamingCount : 0;
        ms.cacheHitRate = ms.callCount > 0 ? Math.min(1, acc.cacheHitCalls / ms.callCount) : 0;
        ms.ttftSampleCount = acc.ttftCount;
        ms.streamingSampleCount = acc.streamingCount;
        ms.timedOutputTokens = acc.timedOutputTokens;
        ms.timedStreamingSeconds = acc.timedStreamingSeconds;
        ms.cacheHitCalls = acc.cacheHitCalls;
    }

    const summary: GMSummary = {
        conversations: [],
        modelBreakdown,
        totalCalls,
        totalStepsCovered: 0,
        totalCredits,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        totalCacheRead: totalCacheRead,
        totalCacheCreation: totalCacheCreation,
        totalThinkingTokens: totalThinking,
        contextGrowth: [],
        fetchedAt: new Date().toISOString(),
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
        retryErrorCodes: {},
        recentErrors: [],
        toolCallCounts: {},
        uniqueErrors: [],
        recentErrorEntries: [],
        toolCatalog: [],
    };

    const clonedSurfaceBreakdown = hasExplicitSurface ? cloneSurfaceBreakdown(surfaceBreakdown) : undefined;
    const clonedWorkspaceBreakdown = hasWorkspaceAttribution ? cloneWorkspaceBreakdown(workspaceBreakdown) : undefined;
    const dominantSurface = hasExplicitSurface ? dominantUsageSurface(clonedSurfaceBreakdown) : undefined;

    return {
        summary,
        totalCost,
        costPerModel,
        ...(dominantSurface ? { surface: dominantSurface } : {}),
        ...(clonedSurfaceBreakdown ? { surfaceBreakdown: clonedSurfaceBreakdown } : {}),
        ...(clonedWorkspaceBreakdown ? { workspaceBreakdown: clonedWorkspaceBreakdown } : {}),
    };
}

function allocateSettledEntryByModel(entry: LedgerDayData['settled'][number]): Record<string, {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
}> {
    const modelEntries = Object.entries(entry.modelCalls);
    const result: Record<string, {
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        credits: number;
    }> = {};
    if (entry.totalCalls <= 0 || modelEntries.length === 0) { return result; }

    const largestModel = modelEntries.reduce((largest, current) =>
        current[1] > largest[1] ? current : largest, modelEntries[0])[0];

    const allocate = (total: number): Record<string, number> => {
        const values: Record<string, number> = {};
        let sum = 0;
        for (const [modelKey, calls] of modelEntries) {
            const value = Math.round(total * (calls / entry.totalCalls));
            values[modelKey] = value;
            sum += value;
        }
        values[largestModel] = (values[largestModel] || 0) + (total - sum);
        return values;
    };

    const input = allocate(entry.totalInputTokens);
    const output = allocate(entry.totalOutputTokens);
    const thinking = allocate(entry.totalThinkingTokens || 0);
    const cacheRead = allocate(entry.totalCacheRead);
    const cacheCreation = allocate(entry.totalCacheCreation || 0);
    const credits = allocate(entry.totalCredits);

    for (const [modelKey] of modelEntries) {
        result[modelKey] = {
            inputTokens: input[modelKey] || 0,
            outputTokens: output[modelKey] || 0,
            thinkingTokens: thinking[modelKey] || 0,
            cacheReadTokens: cacheRead[modelKey] || 0,
            cacheCreationTokens: cacheCreation[modelKey] || 0,
            credits: credits[modelKey] || 0,
        };
    }
    return result;
}

function mergeModelIntoBreakdown(
    breakdown: Record<string, GMModelStats>,
    telemetryByModel: Record<string, LedgerModelTelemetry>,
    modelKey: string,
    calls: number,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens: number,
    cacheRead: number,
    cacheCreation: number,
    credits: number,
    telemetry?: LedgerModelTelemetry,
): void {
    let ms = breakdown[modelKey];
    if (!ms) {
        ms = {
            callCount: 0, stepsCovered: 0,
            totalInputTokens: 0, totalOutputTokens: 0, totalThinkingTokens: 0,
            totalCacheRead: 0, totalCacheCreation: 0, totalCredits: 0,
            avgTTFT: 0, minTTFT: 0, maxTTFT: 0, avgStreaming: 0, cacheHitRate: 0,
            ttftSampleCount: 0, streamingSampleCount: 0,
            timedOutputTokens: 0, timedStreamingSeconds: 0, cacheHitCalls: 0,
            // The ledger has no responseModel to carry over, but leaving this empty made
            // `findPricing('')` return null and silently turned the cost fallback in
            // performDailyArchival into dead code. The model key is a resolvable name.
            responseModel: modelKey, apiProvider: '',
            completionConfig: {} as any, hasSystemPrompt: false,
            toolCount: 0, promptSectionTitles: [],
            totalRetries: 0, errorCount: 0,
            creditCallCount: 0, exactCallCount: 0,
            placeholderOnlyCalls: 0, contextWindowCapacity: 0,
        };
        breakdown[modelKey] = ms;
    }
    ms.callCount += calls;
    ms.totalInputTokens += inputTokens;
    ms.totalOutputTokens += outputTokens;
    ms.totalThinkingTokens += thinkingTokens;
    ms.totalCacheRead += cacheRead;
    ms.totalCacheCreation += cacheCreation;
    ms.totalCredits += credits;

    let acc = telemetryByModel[modelKey];
    if (!acc) {
        acc = {
            ttftSum: 0, ttftCount: 0, minTTFT: 0, maxTTFT: 0,
            streamingSum: 0, streamingCount: 0,
            timedOutputTokens: 0, timedStreamingSeconds: 0, cacheHitCalls: 0,
        };
        telemetryByModel[modelKey] = acc;
    }
    if (telemetry) {
        acc.ttftSum += telemetry.ttftSum || 0;
        acc.ttftCount += telemetry.ttftCount || 0;
        const tMin = telemetry.minTTFT || 0;
        if (tMin > 0) {
            acc.minTTFT = acc.minTTFT && acc.minTTFT > 0 ? Math.min(acc.minTTFT, tMin) : tMin;
        }
        const tMax = telemetry.maxTTFT || 0;
        if (tMax > (acc.maxTTFT || 0)) {
            acc.maxTTFT = tMax;
        }
        acc.streamingSum += telemetry.streamingSum || 0;
        acc.streamingCount += telemetry.streamingCount || 0;
        acc.timedOutputTokens += telemetry.timedOutputTokens || 0;
        acc.timedStreamingSeconds += telemetry.timedStreamingSeconds || 0;
        acc.cacheHitCalls += telemetry.cacheHitCalls || 0;
    }
}

/**
 * Legacy path: build GM summary from getArchivalSummary.
 * Kept for backward compatibility when DailyLedger is empty.
 */
function buildGMSummaryLegacy(ctx: DailyArchivalContext): GMSummary | null {
    const liveSummary = ctx.gmTracker.getArchivalSummary();
    const liveCalls = liveSummary?.totalCalls || 0;
    const lastCalls = ctx.lastGMSummary?.totalCalls || 0;
    return (ctx.lastGMSummary && lastCalls > liveCalls)
        ? ctx.lastGMSummary
        : liveSummary || ctx.lastGMSummary;
}

// ─── Live Today Merge (Calendar / Dashboard) ─────────────────────────────────

/** Live ledger input accepted by {@link mergeArchivedAndLiveRecords}. */
export type LiveLedgerSource =
    | Pick<DailyLedger, 'dateKey' | 'hasData' | 'getLiveDaySnapshot' | 'getTodayActive' | 'getSettledEntries'>
    | {
        dateKey?: string;
        active?: LedgerAccountBucket[];
        settled?: LedgerSettledEntry[];
        ledger?: Pick<DailyLedger, 'dateKey' | 'hasData' | 'getLiveDaySnapshot' | 'getTodayActive' | 'getSettledEntries'> | null;
        customPricing?: Record<string, ModelPricing>;
        defaultSurface?: UsageSurface;
    };

export interface MergeArchivedAndLiveOptions {
    store?: DailyStore | null;
    liveLedger?: LiveLedgerSource | null;
    cliRecords?: readonly DailyRecord[] | null;
    customPricing?: Record<string, ModelPricing>;
    defaultSurface?: UsageSurface;
    now?: Date | number;
}

function resolveNowDate(now?: Date | number): Date {
    if (now instanceof Date && Number.isFinite(now.getTime())) { return now; }
    if (typeof now === 'number' && Number.isFinite(now)) { return new Date(now); }
    return new Date();
}

function extractLiveDayData(
    liveLedger: LiveLedgerSource | null | undefined,
    fallbackDateKey: string,
): { dayData: LedgerDayData; customPricing?: Record<string, ModelPricing>; defaultSurface?: UsageSurface } | null {
    if (!liveLedger) { return null; }

    // Direct DailyLedger instance (has getLiveDaySnapshot or getTodayActive)
    if ('getLiveDaySnapshot' in liveLedger && typeof liveLedger.getLiveDaySnapshot === 'function') {
        if ('hasData' in liveLedger && !liveLedger.hasData) { return null; }
        const snapshot = liveLedger.getLiveDaySnapshot();
        const surface = 'surface' in liveLedger && typeof (liveLedger as DailyLedger).surface === 'string'
            ? (liveLedger as DailyLedger).surface
            : undefined;
        return { dayData: snapshot, defaultSurface: surface };
    }

    // Wrapper object with nested `ledger`
    if ('ledger' in liveLedger && liveLedger.ledger) {
        const inner = extractLiveDayData(liveLedger.ledger, liveLedger.dateKey || fallbackDateKey);
        if (inner) {
            return {
                dayData: liveLedger.dateKey ? { ...inner.dayData, dateKey: liveLedger.dateKey } : inner.dayData,
                customPricing: liveLedger.customPricing,
                defaultSurface: liveLedger.defaultSurface ?? inner.defaultSurface,
            };
        }
    }

    // Plain `{ dateKey?, active?, settled? }` snapshot
    const active = ('active' in liveLedger && Array.isArray(liveLedger.active))
        ? liveLedger.active.filter(b => b && b.totalCalls > 0)
        : ('getTodayActive' in liveLedger && typeof liveLedger.getTodayActive === 'function'
            ? liveLedger.getTodayActive()
            : []);
    const settled = ('settled' in liveLedger && Array.isArray(liveLedger.settled))
        ? liveLedger.settled.filter(s => s && s.totalCalls > 0)
        : ('getSettledEntries' in liveLedger && typeof liveLedger.getSettledEntries === 'function'
            ? liveLedger.getSettledEntries()
            : []);

    if (active.length === 0 && settled.length === 0) { return null; }

    let dateKey = ('dateKey' in liveLedger && typeof liveLedger.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(liveLedger.dateKey))
        ? liveLedger.dateKey
        : '';
    if (!dateKey) {
        // Infer dateKey from recorded calls / settled timestamps when caller omitted dateKey
        let latestMs = 0;
        for (const bucket of active) {
            for (const c of bucket.recordedCalls || []) {
                const ms = c.createdAt ? Date.parse(c.createdAt) : (Number.isFinite(c.createdAtMs) ? c.createdAtMs : 0);
                if (ms > latestMs) { latestMs = ms; }
            }
        }
        for (const s of settled) {
            const ms = s.settledAt ? Date.parse(s.settledAt) : 0;
            if (ms > latestMs) { latestMs = ms; }
        }
        dateKey = latestMs > 0 ? toLocalDateKey(new Date(latestMs)) : fallbackDateKey;
    }

    const accounts: Record<string, LedgerAccountBucket> = {};
    for (let i = 0; i < active.length; i++) {
        const b = active[i];
        const key = b.accountEmail || `__acct_${i}`;
        accounts[key] = b;
    }

    return {
        dayData: { dateKey, accounts, settled },
        customPricing: 'customPricing' in liveLedger ? liveLedger.customPricing : undefined,
        defaultSurface: 'defaultSurface' in liveLedger ? liveLedger.defaultSurface : undefined,
    };
}

function getLiveTimeBounds(dayData: LedgerDayData, fallbackIso: string): {
    startIso: string;
    endIso: string;
    earliestMs: number;
    latestMs: number;
} {
    let earliestMs = Infinity;
    let latestMs = 0;
    for (const bucket of Object.values(dayData.accounts)) {
        for (const call of bucket.recordedCalls || []) {
            const ms = call.createdAt ? Date.parse(call.createdAt) : (Number.isFinite(call.createdAtMs) ? call.createdAtMs : NaN);
            if (Number.isFinite(ms) && ms > 0) {
                if (ms < earliestMs) { earliestMs = ms; }
                if (ms > latestMs) { latestMs = ms; }
            }
        }
    }
    for (const s of dayData.settled) {
        const ms = s.settledAt ? Date.parse(s.settledAt) : NaN;
        if (Number.isFinite(ms) && ms > 0) {
            if (ms < earliestMs) { earliestMs = ms; }
            if (ms > latestMs) { latestMs = ms; }
        }
    }
    const startIso = Number.isFinite(earliestMs) && earliestMs < Infinity
        ? new Date(earliestMs).toISOString()
        : `${dayData.dateKey}T00:00:00`;
    const endIso = latestMs > 0 ? new Date(latestMs).toISOString() : fallbackIso;
    return {
        startIso,
        endIso,
        earliestMs: Number.isFinite(earliestMs) && earliestMs < Infinity ? earliestMs : 0,
        latestMs,
    };
}

/**
 * Convert a live {@link LedgerDayData} snapshot into a virtual {@link DailyCycleEntry}
 * marked with `isLive: true`, suitable for merging into Calendar displays on Day 1.
 */
export function buildLiveDailyCycleFromLedger(
    dayData: LedgerDayData,
    customPricing?: Record<string, ModelPricing>,
    options?: { defaultSurface?: UsageSurface; now?: Date | number },
): DailyCycleEntry | null {
    const built = buildGMSummaryFromLedger(dayData, customPricing);
    if (built.summary.totalCalls <= 0) { return null; }

    const nowDate = resolveNowDate(options?.now);
    const bounds = getLiveTimeBounds(dayData, nowDate.toISOString());
    const additiveTotal = computeAdditiveTokens({
        inputTokens: built.summary.totalInputTokens,
        outputTokens: built.summary.totalOutputTokens,
        cacheReadTokens: built.summary.totalCacheRead,
        cacheCreationTokens: built.summary.totalCacheCreation,
    });

    const distinctEmails = new Set<string>();
    for (const bucket of Object.values(dayData.accounts)) {
        if (bucket.accountEmail) { distinctEmails.add(bucket.accountEmail); }
    }
    for (const s of dayData.settled) {
        if (s.accountEmail) { distinctEmails.add(s.accountEmail); }
    }

    const fallbackSurf = normalizeUsageSurface(options?.defaultSurface);
    const surface = built.surface ?? (fallbackSurf !== 'unknown' ? fallbackSurf : undefined);

    const cycle: DailyCycleEntry = {
        startTime: bounds.startIso,
        endTime: bounds.endIso,
        totalReasoning: 0,
        totalToolCalls: 0,
        totalErrors: 0,
        totalInputTokens: built.summary.totalInputTokens,
        totalOutputTokens: built.summary.totalOutputTokens,
        estSteps: 0,
        modelNames: Object.keys(built.summary.modelBreakdown),
        gmTotalCalls: built.summary.totalCalls,
        gmTotalCredits: built.summary.totalCredits,
        gmTotalTokens: built.summary.totalInputTokens + built.summary.totalOutputTokens,
        gmTotalAllTokens: additiveTotal,
        ...(built.summary.totalCacheRead > 0 ? { gmTotalCacheRead: built.summary.totalCacheRead } : {}),
        ...(built.summary.totalCacheCreation > 0 ? { gmTotalCacheCreation: built.summary.totalCacheCreation } : {}),
        ...(built.summary.totalThinkingTokens > 0 ? { gmTotalThinkingTokens: built.summary.totalThinkingTokens } : {}),
        ...(built.totalCost > 0 ? { estimatedCost: built.totalCost } : {}),
        gmModelStats: buildGMPerModelStats(built.summary, built.costPerModel),
        ...(distinctEmails.size === 1 ? { accountEmail: [...distinctEmails][0] } : {}),
        ...(surface && surface !== 'unknown' ? { surface } : {}),
        ...(built.surfaceBreakdown ? { surfaceBreakdown: built.surfaceBreakdown } : {}),
        ...(built.workspaceBreakdown ? { workspaceBreakdown: built.workspaceBreakdown } : {}),
        isLive: true,
    };

    return cycle;
}

/**
 * Merge archived {@link DailyStore} records, live {@link DailyLedger} activity,
 * and optional CLI {@link DailyRecord}s into a clean date-keyed map WITHOUT mutating
 * the store and WITHOUT double-counting across midnight rollover or same-day snapshots.
 */
export function mergeArchivedAndLiveRecords(options: MergeArchivedAndLiveOptions): Map<string, DailyRecord> {
    const nowDate = resolveNowDate(options.now);
    const todayKey = toLocalDateKey(nowDate);
    const merged = new Map<string, DailyRecord>();

    // 1. Clone archived DailyStore records
    if (options.store) {
        for (const rec of options.store.getAllRecords()) {
            merged.set(rec.date, {
                date: rec.date,
                cycles: rec.cycles.map(c => ({ ...c })),
            });
        }
    }

    // 2. Merge live DailyLedger (active + settled) with strict rollover deduplication
    const extracted = extractLiveDayData(options.liveLedger, todayKey);
    if (extracted) {
        const { dayData } = extracted;
        const customPricing = options.customPricing ?? extracted.customPricing;
        const defaultSurface = options.defaultSurface ?? extracted.defaultSurface;
        const liveCycle = buildLiveDailyCycleFromLedger(dayData, customPricing, { defaultSurface, now: nowDate });

        if (liveCycle) {
            const existing = merged.get(dayData.dateKey);
            if (!existing) {
                merged.set(dayData.dateKey, { date: dayData.dateKey, cycles: [liveCycle] });
            } else if (dayData.dateKey < todayKey) {
                // Past date already exists in DailyStore (midnight rollover completed):
                // never double-count stale un-flushed ledger state on top of the archive!
                // Only merge if surfaces are strictly disjoint and known (e.g. archived CLI only, live App).
                const archivedSurfaces = new Set(existing.cycles.flatMap(c => getCycleSurfaces(c)));
                const liveSurfaces = getCycleSurfaces(liveCycle);
                const disjointKnown = liveSurfaces.every(s => s !== 'unknown' && !archivedSurfaces.has(s))
                    && [...archivedSurfaces].every(s => s !== 'unknown');
                if (disjointKnown) {
                    existing.cycles.push(liveCycle);
                }
            } else {
                // Same-day (`dayData.dateKey >= todayKey`) with existing archived entry (e.g. forced archival or CLI):
                const archivedSurfaces = new Set(existing.cycles.flatMap(c => getCycleSurfaces(c)));
                const liveSurfaces = getCycleSurfaces(liveCycle);
                const disjointKnown = liveSurfaces.every(s => s !== 'unknown' && !archivedSurfaces.has(s))
                    && [...archivedSurfaces].every(s => s !== 'unknown');

                if (disjointKnown) {
                    existing.cycles.push(liveCycle);
                } else {
                    // Check whether all live calls occurred strictly after the archived snapshot endTime
                    // (e.g. forced archival ran at 14:00 and reset ledger, then new calls came in at 15:00).
                    const bounds = getLiveTimeBounds(dayData, nowDate.toISOString());
                    let maxArchivedEndMs = 0;
                    for (const c of existing.cycles) {
                        const t = c.endTime ? Date.parse(c.endTime) : NaN;
                        if (Number.isFinite(t) && t > maxArchivedEndMs) { maxArchivedEndMs = t; }
                    }
                    if (bounds.earliestMs > 0 && maxArchivedEndMs > 0 && bounds.earliestMs > maxArchivedEndMs) {
                        existing.cycles.push(liveCycle);
                    } else {
                        // Overlapping window (likely same calls already archived or superseded snapshot):
                        // replace only if live cycle strictly supersedes archived non-CLI total; NEVER sum!
                        const archivedCalls = existing.cycles.reduce((s, c) => s + (c.gmTotalCalls || 0), 0);
                        const archivedTokens = existing.cycles.reduce((s, c) => s + (c.gmTotalAllTokens || c.gmTotalTokens || 0), 0);
                        const liveCalls = liveCycle.gmTotalCalls || 0;
                        const liveTokens = liveCycle.gmTotalAllTokens || liveCycle.gmTotalTokens || 0;
                        if (liveCalls > archivedCalls || (liveCalls === archivedCalls && liveTokens > archivedTokens)) {
                            // Keep any disjoint CLI cycles on that date while replacing overlapping cycles
                            const nonOverlapping = existing.cycles.filter(c => {
                                const s = getCycleSurfaces(c);
                                return s.length === 1 && s[0] === 'cli' && !liveSurfaces.includes('cli');
                            });
                            existing.cycles = [...nonOverlapping, liveCycle];
                        }
                    }
                }
            }
        }
    }

    // 2b. Merge pending late-arriving cross-midnight day snapshots (if DailyLedger holds any)
    const lateSource = options.liveLedger && 'getLateDaySnapshots' in options.liveLedger
        && typeof (options.liveLedger as DailyLedger).getLateDaySnapshots === 'function'
        ? (options.liveLedger as DailyLedger)
        : (options.liveLedger && 'ledger' in options.liveLedger && options.liveLedger.ledger
            && 'getLateDaySnapshots' in options.liveLedger.ledger
            && typeof (options.liveLedger.ledger as DailyLedger).getLateDaySnapshots === 'function'
            ? (options.liveLedger.ledger as DailyLedger)
            : null);
    if (lateSource) {
        const lateCustomPricing = options.customPricing ?? extracted?.customPricing;
        const lateDefaultSurface = options.defaultSurface ?? extracted?.defaultSurface;
        for (const lateDay of lateSource.getLateDaySnapshots()) {
            const existing = merged.get(lateDay.dateKey);
            let effectiveLateDay = lateDay;
            if (existing) {
                const archivedIds = new Set<string>();
                for (const c of existing.cycles) {
                    for (const id of collectCycleRecordedCallIds(c)) {
                        archivedIds.add(id);
                    }
                }
                if (archivedIds.size > 0) {
                    const filteredAccounts: Record<string, LedgerAccountBucket> = {};
                    let hasRemaining = false;
                    for (const [email, bucket] of Object.entries(lateDay.accounts)) {
                        const unseen = (bucket.recordedCalls || []).filter(rc =>
                            !archivedIds.has(rc.callId) && !archivedIds.has(canonicalLogicalCallId(rc.callId)),
                        );
                        if (unseen.length === (bucket.recordedCalls || []).length) {
                            filteredAccounts[email] = bucket;
                            hasRemaining = true;
                        } else if (unseen.length > 0) {
                            const rebuilt: LedgerAccountBucket = {
                                accountEmail: bucket.accountEmail,
                                totalCalls: 0,
                                totalInputTokens: 0,
                                totalOutputTokens: 0,
                                totalThinkingTokens: 0,
                                totalCacheRead: 0,
                                totalCacheCreation: 0,
                                totalCredits: 0,
                                totalEstimatedCost: 0,
                                modelStats: {},
                                recordedCallIds: [],
                                recordedCalls: unseen,
                                ...(bucket.surface ? { surface: bucket.surface } : {}),
                            };
                            for (const rc of unseen) {
                                rebuilt.totalCalls++;
                                rebuilt.totalInputTokens += rc.inputTokens;
                                rebuilt.totalOutputTokens += rc.outputTokens;
                                rebuilt.totalThinkingTokens += rc.thinkingTokens;
                                rebuilt.totalCacheRead += rc.cacheReadTokens;
                                rebuilt.totalCacheCreation += rc.cacheCreationTokens;
                                rebuilt.totalCredits += rc.credits;
                                rebuilt.totalEstimatedCost += rc.estimatedCost;
                                rebuilt.recordedCallIds.push(rc.callId);
                                const ms = rebuilt.modelStats[rc.modelKey] || {
                                    calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                                    cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0,
                                };
                                ms.calls++;
                                ms.inputTokens += rc.inputTokens;
                                ms.outputTokens += rc.outputTokens;
                                ms.thinkingTokens += rc.thinkingTokens;
                                ms.cacheReadTokens += rc.cacheReadTokens;
                                ms.cacheCreationTokens += rc.cacheCreationTokens;
                                ms.credits += rc.credits;
                                ms.estimatedCost += rc.estimatedCost;
                                rebuilt.modelStats[rc.modelKey] = ms;
                                if (bucket.workspaceBreakdown || rc.workspace || rc.authority) {
                                    if (!rebuilt.workspaceBreakdown) { rebuilt.workspaceBreakdown = {}; }
                                    const wsKey = normalizeWorkspaceKey(rc.workspace, rc.authority);
                                    const surf = normalizeUsageSurface(rc.surface ?? bucket.surface);
                                    const knownCost = rc.unpriced ? 0 : rc.estimatedCost;
                                    const wb = rebuilt.workspaceBreakdown[wsKey] || {
                                        calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                                        cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0,
                                        knownCostUsd: 0, unpricedCalls: 0,
                                        ...(rc.authority ? { authority: rc.authority } : {}),
                                    };
                                    wb.calls++;
                                    wb.inputTokens += rc.inputTokens;
                                    wb.outputTokens += rc.outputTokens;
                                    wb.thinkingTokens += rc.thinkingTokens;
                                    wb.cacheReadTokens += rc.cacheReadTokens;
                                    wb.cacheCreationTokens += rc.cacheCreationTokens;
                                    wb.credits += rc.credits;
                                    wb.knownCostUsd += knownCost;
                                    if (rc.unpriced) { wb.unpricedCalls++; }
                                    if (!wb.bySurface) { wb.bySurface = {}; }
                                    const sb = wb.bySurface[surf] || {
                                        calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                                        cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0,
                                    };
                                    sb.calls++;
                                    sb.inputTokens += rc.inputTokens;
                                    sb.outputTokens += rc.outputTokens;
                                    sb.thinkingTokens += rc.thinkingTokens;
                                    sb.cacheReadTokens += rc.cacheReadTokens;
                                    sb.cacheCreationTokens += rc.cacheCreationTokens;
                                    sb.credits += rc.credits;
                                    sb.estimatedCost += knownCost;
                                    wb.bySurface[surf] = sb;
                                    rebuilt.workspaceBreakdown[wsKey] = wb;
                                }
                            }
                            filteredAccounts[email] = rebuilt;
                            hasRemaining = true;
                        }
                    }
                    if (!hasRemaining) { continue; }
                    effectiveLateDay = { dateKey: lateDay.dateKey, accounts: filteredAccounts, settled: [] };
                }
            }
            const lateCycle = buildLiveDailyCycleFromLedger(effectiveLateDay, lateCustomPricing, {
                defaultSurface: lateDefaultSurface,
                now: nowDate,
            });
            if (!lateCycle) { continue; }
            if (!existing) {
                merged.set(lateDay.dateKey, { date: lateDay.dateKey, cycles: [lateCycle] });
            } else {
                existing.cycles.push(lateCycle);
            }
        }
    }

    // 3. Merge CLI records (surface: 'cli') cleanly without duplicating already-present CLI cycles
    if (options.cliRecords && options.cliRecords.length > 0) {
        for (const cliRec of options.cliRecords) {
            if (!cliRec || !cliRec.date || !Array.isArray(cliRec.cycles) || cliRec.cycles.length === 0) {
                continue;
            }
            const existing = merged.get(cliRec.date);
            if (!existing) {
                merged.set(cliRec.date, {
                    date: cliRec.date,
                    cycles: cliRec.cycles.map(c => ({ ...c, surface: 'cli' as UsageSurface })),
                });
            } else {
                const alreadyHasCli = existing.cycles.some(c => getCycleSurfaces(c).includes('cli'));
                if (!alreadyHasCli) {
                    for (const c of cliRec.cycles) {
                        existing.cycles.push({ ...c, surface: 'cli' as UsageSurface });
                    }
                }
            }
        }
    }

    return merged;
}

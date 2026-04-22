// ─── Daily Archival Logic ────────────────────────────────────────────────────
// Pure logic extracted from extension.ts so it can be unit tested with injected
// dependencies.  extension.ts wires up the concrete instances and delegates here.

import type { ActivityTracker } from './activity-tracker';
import type { GMTracker, GMSummary } from './gm-tracker';
import type { DailyStore } from './daily-store';
import type { PricingStore } from './pricing-store';
import type { PersistedModelDNA } from './model-dna-store';
import { mergeModelDNAState, serializeModelDNAState } from './model-dna-store';

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

    /** Write-back: called when state needs persisting. */
    persist: (updates: DailyArchivalPersistUpdates) => void;
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
 * @param ctx  All dependencies injected.
 * @param force If true, skip date-change check (for dev simulation).
 * @param now  The current date (injectable for testing).
 */
export function performDailyArchival(
    ctx: DailyArchivalContext,
    force = false,
    now: Date = new Date(),
): DailyArchivalResult {
    const todayKey = toLocalDateKey(now);

    if (!force) {
        if (!ctx.lastArchivalDateKey) {
            // First run ever — record today, don't archive
            ctx.persist({
                lastArchivalDateKey: todayKey,
                lastGMSummary: ctx.lastGMSummary,
                modelDNAChanged: false,
            });
            return { archived: false, archiveDateKey: todayKey, firstRun: true, sameDay: false };
        }
        if (ctx.lastArchivalDateKey === todayKey) {
            return { archived: false, archiveDateKey: todayKey, firstRun: false, sameDay: true };
        }
    }

    // ── Date rolled over → archive yesterday's data ──
    const archiveDateKey = force ? todayKey : ctx.lastArchivalDateKey;
    ctx.log(`Daily archival triggered: ${archiveDateKey} → ${todayKey}`);

    // 1. Snapshot Activity
    const activitySummary = ctx.activityTracker.getSummary();
    const hasActivity = activitySummary.totalReasoning > 0
        || activitySummary.totalToolCalls > 0;

    // 2. Snapshot GM (all accounts — DailyStore needs cross-account totals)
    const gmSummary = ctx.gmTracker.getFullSummary() || ctx.lastGMSummary;
    const hasGM = gmSummary && gmSummary.totalCalls > 0;

    // 3. Calculate cost
    let costTotal: number | undefined;
    let costPerModel: Record<string, number> | undefined;
    if (gmSummary && ctx.pricingStore) {
        const result = ctx.pricingStore.calculateCosts(gmSummary);
        if (result.grandTotal > 0) { costTotal = result.grandTotal; }
        costPerModel = {};
        for (const row of result.rows) {
            if (row.totalCost > 0) { costPerModel[row.name] = row.totalCost; }
        }
    }

    // 4. Write to DailyStore (only if there's actual data)
    if ((hasActivity || hasGM) && ctx.dailyStore) {
        ctx.dailyStore.addDailySnapshot(
            archiveDateKey,
            activitySummary,
            gmSummary || null,
            costTotal,
            costPerModel,
            true, // append — preserve intra-day quota-reset cycles
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

    // 7. Persist everything
    ctx.persist({
        lastArchivalDateKey: todayKey,
        lastGMSummary: newGMSummary,
        persistedModelDNA: modelDNAChanged ? updatedDNA : undefined,
        modelDNAChanged,
    });

    ctx.log(`Daily archival completed for ${archiveDateKey}`);
    return { archived: hasActivity || !!hasGM, archiveDateKey, firstRun: false, sameDay: false };
}

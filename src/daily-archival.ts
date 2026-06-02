// ─── Daily Archival Logic ────────────────────────────────────────────────────
// Pure logic extracted from extension.ts so it can be unit tested with injected
// dependencies.  extension.ts wires up the concrete instances and delegates here.

import type { ActivityTracker } from './activity-tracker';
import type { GMTracker, GMSummary, GMModelStats } from './gm-tracker';
import type { DailyStore } from './daily-store';
import type { PricingStore } from './pricing-store';
import type { PersistedModelDNA } from './model-dna-store';
import { mergeModelDNAState } from './model-dna-store';
import type { DailyLedger, LedgerDayData } from './daily-ledger';

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
 *
 * Data source priority:
 *   1. DailyLedger.rollover() — incremental accounting, most reliable
 *   2. Fallback: getArchivalSummary() + pendingArchives (legacy path)
 *
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

    // 2. Build GM summary — use DailyLedger if available, else legacy path
    let gmSummary: GMSummary | null = null;
    let costTotal: number | undefined;
    let costPerModel: Record<string, number> | undefined;

    if (ctx.dailyLedger && ctx.dailyLedger.hasData) {
        // ── New path: DailyLedger is the source of truth ──
        const dayData = ctx.dailyLedger.rollover(archiveDateKey);
        const result = buildGMSummaryFromLedger(dayData);
        gmSummary = result.summary;
        costTotal = result.totalCost > 0 ? result.totalCost : undefined;
        costPerModel = result.costPerModel;
        ctx.log(`DailyLedger rollover: ${gmSummary.totalCalls} calls, $${(result.totalCost || 0).toFixed(4)} cost`);
    } else {
        // ── Legacy path: getArchivalSummary + pendingArchives ──
        gmSummary = buildGMSummaryLegacy(ctx);
    }

    const hasGM = !!(gmSummary && gmSummary.totalCalls > 0);

    // 3. Calculate cost (only if ledger didn't provide it)
    if (costTotal === undefined && gmSummary && ctx.pricingStore) {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a GMSummary-compatible object from DailyLedger rollover data. */
export function buildGMSummaryFromLedger(dayData: LedgerDayData): {
    summary: GMSummary;
    totalCost: number;
    costPerModel: Record<string, number>;
} {
    let totalCalls = 0;
    let totalIn = 0, totalOut = 0, totalThinking = 0;
    let totalCacheRead = 0, totalCacheCreation = 0, totalCredits = 0;
    let totalCost = 0;
    const modelBreakdown: Record<string, GMModelStats> = {};
    const costPerModel: Record<string, number> = {};

    // Merge active buckets
    for (const bucket of Object.values(dayData.accounts)) {
        totalCalls += bucket.totalCalls;
        totalIn += bucket.totalInputTokens;
        totalOut += bucket.totalOutputTokens;
        totalThinking += bucket.totalThinkingTokens;
        totalCacheRead += bucket.totalCacheRead;
        totalCacheCreation += bucket.totalCacheCreation;
        totalCredits += bucket.totalCredits;
        totalCost += bucket.totalEstimatedCost;

        for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
            mergeModelIntoBreakdown(modelBreakdown, modelKey, ms.calls,
                ms.inputTokens, ms.outputTokens, ms.thinkingTokens,
                ms.cacheReadTokens, ms.cacheCreationTokens, ms.credits);
            if (ms.estimatedCost > 0) {
                costPerModel[modelKey] = (costPerModel[modelKey] || 0) + ms.estimatedCost;
            }
        }
    }

    // Merge settled entries
    for (const entry of dayData.settled) {
        totalCalls += entry.totalCalls;
        totalIn += entry.totalInputTokens;
        totalOut += entry.totalOutputTokens;
        totalThinking += entry.totalThinkingTokens || 0;
        totalCacheRead += entry.totalCacheRead;
        totalCacheCreation += entry.totalCacheCreation || 0;
        totalCredits += entry.totalCredits;
        totalCost += entry.totalEstimatedCost;

        const allocated = allocateSettledEntryByModel(entry);

        for (const [modelKey, calls] of Object.entries(entry.modelCalls)) {
            // Settled entries only have per-model call counts; distribute
            // totals proportionally.
            if (entry.totalCalls > 0) {
                const modelTokens = allocated[modelKey];
                mergeModelIntoBreakdown(modelBreakdown, modelKey, calls,
                    modelTokens?.inputTokens || 0,
                    modelTokens?.outputTokens || 0,
                    modelTokens?.thinkingTokens || 0,
                    modelTokens?.cacheReadTokens || 0,
                    modelTokens?.cacheCreationTokens || 0,
                    modelTokens?.credits || 0);
            }
            if (entry.totalEstimatedCost > 0 && entry.totalCalls > 0) {
                const ratio = calls / entry.totalCalls;
                costPerModel[modelKey] = (costPerModel[modelKey] || 0) + entry.totalEstimatedCost * ratio;
            }
        }
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

    return { summary, totalCost, costPerModel };
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
    modelKey: string,
    calls: number,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens: number,
    cacheRead: number,
    cacheCreation: number,
    credits: number,
): void {
    let ms = breakdown[modelKey];
    if (!ms) {
        ms = {
            callCount: 0, stepsCovered: 0,
            totalInputTokens: 0, totalOutputTokens: 0, totalThinkingTokens: 0,
            totalCacheRead: 0, totalCacheCreation: 0, totalCredits: 0,
            avgTTFT: 0, minTTFT: 0, maxTTFT: 0, avgStreaming: 0, cacheHitRate: 0,
            responseModel: '', apiProvider: '',
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

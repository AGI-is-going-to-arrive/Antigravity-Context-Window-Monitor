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

    // 2. Snapshot GM (all accounts, including pending-archive calls)
    // getArchivalSummary() skips both account filtering and archival filtering,
    // so it returns ALL calls from this cycle: calls already baselined by
    // intra-day quota resets (pending-archive) + still-active calls.
    // This gives DailyStore the complete picture of the day's usage.
    // SAFETY: after an extension restart, _cache.calls may be empty (stripped
    // during serialization) — getArchivalSummary() then returns totalCalls=0.
    // Fall back to lastGMSummary (last persisted snapshot) if it has more data.
    const liveSummary = ctx.gmTracker.getArchivalSummary();
    let gmSummary = (liveSummary && liveSummary.totalCalls > 0)
        ? liveSummary
        : (ctx.lastGMSummary && ctx.lastGMSummary.totalCalls > (liveSummary?.totalCalls || 0))
            ? ctx.lastGMSummary
            : liveSummary || ctx.lastGMSummary;

    // ── 核心修复：合并 pendingArchives (白天因为额度重置转存到待归档区的汇总数据) ──
    const pendingArchives = ctx.gmTracker.getPendingArchives() || [];
    if (pendingArchives.length > 0) {
        if (!gmSummary) {
            // 就地构建一个空的 gmSummary 容器以防 Null 丢数据
            gmSummary = {
                conversations: [],
                modelBreakdown: {},
                totalCalls: 0,
                totalStepsCovered: 0,
                totalCredits: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalThinkingTokens: 0,
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
        }

        if (gmSummary) {
            // 把每一个 pending 条目里的统计值归并累加回 gmSummary
            for (const pending of pendingArchives) {
                gmSummary.totalCalls += pending.totalCalls;
                gmSummary.totalInputTokens += pending.totalInputTokens;
                gmSummary.totalOutputTokens += pending.totalOutputTokens;
                gmSummary.totalCacheRead += pending.totalCacheRead;
                gmSummary.totalCredits += pending.totalCredits;

                // 合并每个模型的 Breakdown
                for (const [modelKey, calls] of Object.entries(pending.modelCalls)) {
                    let mStats = gmSummary.modelBreakdown[modelKey];
                    if (!mStats) {
                        mStats = {
                            callCount: 0,
                            stepsCovered: 0,
                            totalInputTokens: 0,
                            totalOutputTokens: 0,
                            totalThinkingTokens: 0,
                            totalCacheRead: 0,
                            totalCacheCreation: 0,
                            totalCredits: 0,
                            avgTTFT: 0, minTTFT: 0, maxTTFT: 0, avgStreaming: 0, cacheHitRate: 0,
                            responseModel: '', apiProvider: '', completionConfig: {} as any, hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [], totalRetries: 0, errorCount: 0, creditCallCount: 0, exactCallCount: 0, placeholderOnlyCalls: 0, contextWindowCapacity: 0
                        };
                        gmSummary.modelBreakdown[modelKey] = mStats;
                    }
                    mStats.callCount += calls;
                    // 分摊 pending 的 token 计数到各模型
                    if (pending.totalCalls > 0) {
                        const ratio = calls / pending.totalCalls;
                        mStats.totalInputTokens += Math.round(pending.totalInputTokens * ratio);
                        mStats.totalOutputTokens += Math.round(pending.totalOutputTokens * ratio);
                        mStats.totalCacheRead += Math.round(pending.totalCacheRead * ratio);
                        mStats.totalCredits += Math.round(pending.totalCredits * ratio);
                    }
                }
            }
        }
    }
    const hasGM = !!(gmSummary && gmSummary.totalCalls > 0);

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

    // 3b. 保底合并 pendingArchives 中的预估费用 (防止未配好价格表时费用丢失)
    if (pendingArchives.length > 0) {
        let pendingCostTotal = 0;
        const pendingCostPerModel: Record<string, number> = {};
        for (const pending of pendingArchives) {
            if (pending.estimatedCost && pending.estimatedCost > 0) {
                pendingCostTotal += pending.estimatedCost;
                
                // 将费用按照 modelCalls 的比例分摊到各模型中
                for (const [modelKey, calls] of Object.entries(pending.modelCalls)) {
                    if (pending.totalCalls > 0) {
                        const ratio = calls / pending.totalCalls;
                        pendingCostPerModel[modelKey] = (pendingCostPerModel[modelKey] || 0) + (pending.estimatedCost * ratio);
                    }
                }
            }
        }
        
        if (pendingCostTotal > 0) {
            costTotal = (costTotal || 0) + pendingCostTotal;
            if (!costPerModel) { costPerModel = {}; }
            for (const [modelKey, cost] of Object.entries(pendingCostPerModel)) {
                costPerModel[modelKey] = (costPerModel[modelKey] || 0) + cost;
            }
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
            // replace mode: getFullSummary() is cumulative — appending
            // would duplicate data already captured by pre-reset snapshots.
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

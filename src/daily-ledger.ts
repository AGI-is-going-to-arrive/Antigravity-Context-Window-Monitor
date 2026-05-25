// ─── Daily Ledger ────────────────────────────────────────────────────────────
// Incremental GM call ledger: records every new GM call in real-time,
// bucketed by date + account email. Does not depend on LS keeping
// conversations in memory — once a call is recorded, it's permanent
// until midnight rollover.
//
// Lifecycle:
//   fetchAll() → getNewCallsSinceLastRecord() → ledger.recordCalls()  (real-time)
//   quota reset → ledger.settleForQuotaReset()                        (per-pool settle)
//   midnight   → ledger.rollover() → DailyStore                      (day-end flush)

import type { GMCallEntry } from './gm-tracker';
import { normalizeModelDisplayName, resolveModelId } from './models';
import { buildGMArchiveKey } from './gm/parser';
import { findPricing } from './pricing-store';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-model statistics within a ledger bucket */
export interface LedgerModelStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    estimatedCost: number;
}

/** A single account bucket within a day */
export interface LedgerAccountBucket {
    accountEmail: string;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalCredits: number;
    totalEstimatedCost: number;
    /** Per-model breakdown (key = display name) */
    modelStats: Record<string, LedgerModelStats>;
    /** Call IDs already recorded — prevents double-counting */
    recordedCallIds: string[];
}

/** A settled (quota-reset) entry — frozen snapshot of a pool's data at reset time */
export interface LedgerSettledEntry {
    /** ISO timestamp when settlement occurred */
    settledAt: string;
    /** Account email */
    accountEmail: string;
    /** Model IDs in the settled pool */
    poolModelIds: string[];
    /** Display names of models in the settled pool */
    poolModelLabels: string[];
    /** Settled statistics */
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheRead: number;
    totalCredits: number;
    totalEstimatedCost: number;
    /** Per-model call counts (key = display name) */
    modelCalls: Record<string, number>;
}

/** Full day entry containing active buckets + settled entries */
export interface LedgerDayData {
    dateKey: string;
    /** Per-account active buckets */
    accounts: Record<string, LedgerAccountBucket>;
    /** Settled entries from quota resets */
    settled: LedgerSettledEntry[];
}

/** Serialized state for persistence */
export interface DailyLedgerState {
    version: 1;
    dateKey: string;
    accounts: Record<string, LedgerAccountBucket>;
    settled: LedgerSettledEntry[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** A call entry with an externally-provided dedup key.
 *  The tracker supplies `dedupKey = cascadeId:arrayIndex` which is
 *  guaranteed unique, solving the placeholder-data collision problem. */
export interface LedgerCallEntry {
    call: GMCallEntry;
    /** Externally-provided unique key (e.g. 'cascadeId:index'). Used for dedup. */
    dedupKey: string;
}

/** Fallback: build a dedup key from call fields (best-effort, may collide for placeholder data). */
function fallbackCallId(call: GMCallEntry): string {
    if (call.executionId) { return call.executionId; }
    const base = buildGMArchiveKey(call);
    return `${base}|in:${call.inputTokens}|out:${call.outputTokens}|ssi:${call.startStepIndex}`;
}

/** Compute per-call estimated cost using responseModel pricing */
function estimateCallCost(call: GMCallEntry): number {
    if (!call.responseModel) { return 0; }
    const pr = findPricing(call.responseModel);
    if (!pr) { return 0; }
    const respOut = Math.max(0, (call.outputTokens || 0) - (call.thinkingTokens || 0));
    return (
        (call.inputTokens || 0) * pr.input +
        respOut * pr.output +
        (call.cacheReadTokens || 0) * pr.cacheRead +
        (call.thinkingTokens || 0) * pr.thinking
    ) / 1_000_000;
}

function emptyBucket(email: string): LedgerAccountBucket {
    return {
        accountEmail: email,
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
    };
}

// ─── DailyLedger Class ──────────────────────────────────────────────────────

export class DailyLedger {
    private _dateKey: string;
    /** Per-account active buckets (key = accountEmail or '' for unknown) */
    private _accounts = new Map<string, LedgerAccountBucket>();
    /** Settled entries from quota resets (waiting for midnight flush) */
    private _settled: LedgerSettledEntry[] = [];
    /** Fast lookup set for deduplication (union of all bucket recordedCallIds) */
    private _allRecordedIds = new Set<string>();

    constructor(dateKey?: string) {
        this._dateKey = dateKey || toLocalDateKey();
    }

    /** Current date key */
    get dateKey(): string { return this._dateKey; }

    /**
     * Clear recorded dedup IDs that belong to a specific conversation.
     * Called when a conversation is reverted — the old indices are invalidated
     * and new calls at the same indices must be accepted.
     * Does NOT reduce call counts (those represent actual API usage).
     */
    clearRecordedIdsForConversation(cascadeId: string): void {
        const prefix = cascadeId + ':';
        const toRemove: string[] = [];
        for (const id of this._allRecordedIds) {
            if (id.startsWith(prefix)) { toRemove.push(id); }
        }
        for (const id of toRemove) { this._allRecordedIds.delete(id); }
        // Also clean from per-account bucket recordedCallIds
        for (const bucket of this._accounts.values()) {
            bucket.recordedCallIds = bucket.recordedCallIds.filter(id => !id.startsWith(prefix));
        }
    }

    /**
     * Record a batch of new GM calls into the ledger.
     * Each entry carries a `dedupKey` (provided by the tracker) for reliable dedup.
     * @returns number of newly recorded calls
     */
    recordCalls(entries: LedgerCallEntry[]): number {
        let added = 0;
        const todayKey = toLocalDateKey();

        // If the date has rolled over, auto-rollover first
        if (todayKey !== this._dateKey) {
            // Caller should have called rollover() before midnight.
            // Safety: if they didn't, just reset for the new day.
            this._resetForNewDay(todayKey);
        }

        for (const entry of entries) {
            const call = entry.call;
            const id = entry.dedupKey || fallbackCallId(call);
            if (this._allRecordedIds.has(id)) { continue; }

            const email = call.accountEmail || '';
            let bucket = this._accounts.get(email);
            if (!bucket) {
                bucket = emptyBucket(email);
                this._accounts.set(email, bucket);
            }

            // Accumulate totals
            bucket.totalCalls++;
            bucket.totalInputTokens += call.inputTokens;
            bucket.totalOutputTokens += call.outputTokens;
            bucket.totalThinkingTokens += call.thinkingTokens;
            bucket.totalCacheRead += call.cacheReadTokens;
            bucket.totalCacheCreation += call.cacheCreationTokens;
            bucket.totalCredits += call.credits;

            const cost = estimateCallCost(call);
            bucket.totalEstimatedCost += cost;

            // Per-model breakdown
            const modelKey = normalizeModelDisplayName(
                call.modelDisplay || call.model,
            ) || call.responseModel || call.model;

            let ms = bucket.modelStats[modelKey];
            if (!ms) {
                ms = {
                    calls: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    thinkingTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    credits: 0,
                    estimatedCost: 0,
                };
                bucket.modelStats[modelKey] = ms;
            }
            ms.calls++;
            ms.inputTokens += call.inputTokens;
            ms.outputTokens += call.outputTokens;
            ms.thinkingTokens += call.thinkingTokens;
            ms.cacheReadTokens += call.cacheReadTokens;
            ms.cacheCreationTokens += call.cacheCreationTokens;
            ms.credits += call.credits;
            ms.estimatedCost += cost;

            // Mark as recorded
            bucket.recordedCallIds.push(id);
            this._allRecordedIds.add(id);
            added++;
        }

        return added;
    }

    /**
     * Settle (freeze) data for a specific quota pool after reset.
     * Moves matching model data from active bucket to a settled entry.
     * The settled data stays until midnight rollover.
     *
     * @param poolModelIds Model IDs in the reset pool (e.g. ['MODEL_PLACEHOLDER_M16', ...])
     * @param accountEmail Account email to settle
     * @returns the settled entry, or null if no matching data
     */
    settleForQuotaReset(poolModelIds: string[], accountEmail?: string): LedgerSettledEntry | null {
        const email = accountEmail || '';
        const bucket = this._accounts.get(email);
        if (!bucket || bucket.totalCalls === 0) { return null; }

        // Build a set of display names that belong to this pool
        const poolModelIdSet = new Set(poolModelIds.map(id => id.toLowerCase()));
        const matchingModelKeys: string[] = [];

        for (const modelKey of Object.keys(bucket.modelStats)) {
            // Check if this model key belongs to the pool
            const resolvedId = resolveModelId(modelKey);
            if (resolvedId && poolModelIdSet.has(resolvedId.toLowerCase())) {
                matchingModelKeys.push(modelKey);
                continue;
            }
            // Fallback: check if any pool model ID's display name matches
            for (const pid of poolModelIds) {
                const pidDisplay = normalizeModelDisplayName(pid);
                if (pidDisplay && pidDisplay.toLowerCase() === modelKey.toLowerCase()) {
                    matchingModelKeys.push(modelKey);
                    break;
                }
            }
        }

        if (matchingModelKeys.length === 0) { return null; }

        // Extract matching stats
        let totalCalls = 0;
        let totalIn = 0, totalOut = 0, totalCache = 0, totalCredits = 0, totalCost = 0;
        const modelCalls: Record<string, number> = {};

        for (const key of matchingModelKeys) {
            const ms = bucket.modelStats[key];
            if (!ms) { continue; }
            totalCalls += ms.calls;
            totalIn += ms.inputTokens;
            totalOut += ms.outputTokens;
            totalCache += ms.cacheReadTokens;
            totalCredits += ms.credits;
            totalCost += ms.estimatedCost;
            modelCalls[key] = ms.calls;

            // Subtract from active bucket
            bucket.totalCalls -= ms.calls;
            bucket.totalInputTokens -= ms.inputTokens;
            bucket.totalOutputTokens -= ms.outputTokens;
            bucket.totalThinkingTokens -= ms.thinkingTokens;
            bucket.totalCacheRead -= ms.cacheReadTokens;
            bucket.totalCacheCreation -= ms.cacheCreationTokens;
            bucket.totalCredits -= ms.credits;
            bucket.totalEstimatedCost -= ms.estimatedCost;

            // Remove from model breakdown
            delete bucket.modelStats[key];
        }

        const entry: LedgerSettledEntry = {
            settledAt: new Date().toISOString(),
            accountEmail: email,
            poolModelIds,
            poolModelLabels: matchingModelKeys,
            totalCalls,
            totalInputTokens: totalIn,
            totalOutputTokens: totalOut,
            totalCacheRead: totalCache,
            totalCredits,
            totalEstimatedCost: totalCost,
            modelCalls,
        };

        this._settled.push(entry);
        return entry;
    }

    /**
     * Midnight rollover: return all data for the completed day, then reset.
     * Returns combined active + settled data for the day.
     */
    rollover(archiveDateKey?: string): LedgerDayData {
        const dateKey = archiveDateKey || this._dateKey;
        const accounts: Record<string, LedgerAccountBucket> = {};
        for (const [email, bucket] of this._accounts) {
            accounts[email] = { ...bucket };
        }

        const result: LedgerDayData = {
            dateKey,
            accounts,
            settled: [...this._settled],
        };

        // Reset for new day
        this._resetForNewDay(toLocalDateKey());

        return result;
    }

    /** Get active (unsettled) data for all accounts */
    getTodayActive(): LedgerAccountBucket[] {
        return [...this._accounts.values()].filter(b => b.totalCalls > 0);
    }

    /** Get active data for a specific account */
    getAccountActive(email: string): LedgerAccountBucket | null {
        return this._accounts.get(email) || null;
    }

    /** Get settled entries (from quota resets, waiting for midnight flush) */
    getSettledEntries(): LedgerSettledEntry[] {
        return [...this._settled];
    }

    /** Get combined totals (active + settled) for today */
    getTodayTotals(): { totalCalls: number; totalCost: number } {
        let totalCalls = 0;
        let totalCost = 0;
        for (const bucket of this._accounts.values()) {
            totalCalls += bucket.totalCalls;
            totalCost += bucket.totalEstimatedCost;
        }
        for (const entry of this._settled) {
            totalCalls += entry.totalCalls;
            totalCost += entry.totalEstimatedCost;
        }
        return { totalCalls, totalCost };
    }

    /** Check if ledger has any data (active or settled) */
    get hasData(): boolean {
        for (const bucket of this._accounts.values()) {
            if (bucket.totalCalls > 0) { return true; }
        }
        return this._settled.length > 0;
    }

    // ─── Serialization ───────────────────────────────────────────────────

    serialize(): DailyLedgerState {
        const accounts: Record<string, LedgerAccountBucket> = {};
        for (const [email, bucket] of this._accounts) {
            accounts[email] = { ...bucket };
        }
        return {
            version: 1,
            dateKey: this._dateKey,
            accounts,
            settled: [...this._settled],
        };
    }

    static restore(data: DailyLedgerState | undefined | null): DailyLedger {
        const ledger = new DailyLedger();
        if (!data || data.version !== 1) { return ledger; }

        const todayKey = toLocalDateKey();
        if (data.dateKey !== todayKey) {
            // Stale data from a previous day — don't restore, start fresh.
            // The old data should have been rolled over already.
            return ledger;
        }

        ledger._dateKey = data.dateKey;
        ledger._settled = Array.isArray(data.settled) ? [...data.settled] : [];

        if (data.accounts && typeof data.accounts === 'object') {
            for (const [email, bucket] of Object.entries(data.accounts)) {
                const restored: LedgerAccountBucket = {
                    ...bucket,
                    recordedCallIds: Array.isArray(bucket.recordedCallIds)
                        ? [...bucket.recordedCallIds]
                        : [],
                };
                ledger._accounts.set(email, restored);
                // Rebuild dedup set
                for (const id of restored.recordedCallIds) {
                    ledger._allRecordedIds.add(id);
                }
            }
        }

        return ledger;
    }

    // ─── Internal ────────────────────────────────────────────────────────

    private _resetForNewDay(newDateKey: string): void {
        this._dateKey = newDateKey;
        this._accounts.clear();
        this._settled = [];
        this._allRecordedIds.clear();
    }
}

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

/** Per-call data retained so quota-reset settlement can split by reset cutoff. */
export interface LedgerRecordedCall {
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
    /** Accepted calls retained for cutoff-aware quota settlement */
    recordedCalls: LedgerRecordedCall[];
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
    totalThinkingTokens: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalCredits: number;
    totalEstimatedCost: number;
    /** Optional reset boundary used for this settlement */
    settledCutoffTime?: number;
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

export function toLocalDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Convert a dateKey like "2026-05-29" to the Unix timestamp (ms) of
 * midnight local time on that date.
 * Returns 0 on parse failure (caller treats 0 as "no filter").
 */
function dateKeyToStartOfDayMs(dateKey: string): number {
    const parts = dateKey.split('-');
    if (parts.length !== 3) { return 0; }
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) { return 0; }
    return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

function dateKeyToNextDayStartMs(dateKey: string): number {
    const parts = dateKey.split('-');
    if (parts.length !== 3) { return 0; }
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) { return 0; }
    return new Date(y, m, d + 1, 0, 0, 0, 0).getTime();
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

function emptyModelStats(): LedgerModelStats {
    return {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        credits: 0,
        estimatedCost: 0,
    };
}

function resolveCallModelId(call: GMCallEntry, modelKey: string): string {
    return resolveModelId(call.model)
        || resolveModelId(call.responseModel || '')
        || resolveModelId(modelKey)
        || call.model
        || call.responseModel
        || modelKey;
}

function callMatchesPool(modelKey: string, modelId: string | undefined, poolModelIds: string[]): boolean {
    const poolModelIdSet = new Set(poolModelIds.map(id => id.toLowerCase()));
    if (modelId && poolModelIdSet.has(modelId.toLowerCase())) {
        return true;
    }
    const resolvedId = resolveModelId(modelKey);
    if (resolvedId && poolModelIdSet.has(resolvedId.toLowerCase())) {
        return true;
    }
    for (const pid of poolModelIds) {
        const pidDisplay = normalizeModelDisplayName(pid);
        if (pidDisplay && pidDisplay.toLowerCase() === modelKey.toLowerCase()) {
            return true;
        }
    }
    return false;
}

function addRecordedCallStats(target: LedgerModelStats, call: LedgerRecordedCall): void {
    target.calls++;
    target.inputTokens += call.inputTokens;
    target.outputTokens += call.outputTokens;
    target.thinkingTokens += call.thinkingTokens;
    target.cacheReadTokens += call.cacheReadTokens;
    target.cacheCreationTokens += call.cacheCreationTokens;
    target.credits += call.credits;
    target.estimatedCost += call.estimatedCost;
}

function addModelStats(target: LedgerModelStats, source: LedgerModelStats): void {
    target.calls += source.calls;
    target.inputTokens += source.inputTokens;
    target.outputTokens += source.outputTokens;
    target.thinkingTokens += source.thinkingTokens;
    target.cacheReadTokens += source.cacheReadTokens;
    target.cacheCreationTokens += source.cacheCreationTokens;
    target.credits += source.credits;
    target.estimatedCost += source.estimatedCost;
}

function subtractModelStatsSnapshot(total: LedgerModelStats, represented?: LedgerModelStats): LedgerModelStats {
    const rep = represented || emptyModelStats();
    return {
        calls: Math.max(0, total.calls - rep.calls),
        inputTokens: Math.max(0, total.inputTokens - rep.inputTokens),
        outputTokens: Math.max(0, total.outputTokens - rep.outputTokens),
        thinkingTokens: Math.max(0, total.thinkingTokens - rep.thinkingTokens),
        cacheReadTokens: Math.max(0, total.cacheReadTokens - rep.cacheReadTokens),
        cacheCreationTokens: Math.max(0, total.cacheCreationTokens - rep.cacheCreationTokens),
        credits: Math.max(0, total.credits - rep.credits),
        estimatedCost: Math.max(0, total.estimatedCost - rep.estimatedCost),
    };
}

function hasModelStatsData(stats: LedgerModelStats): boolean {
    return stats.calls > 0
        || stats.inputTokens > 0
        || stats.outputTokens > 0
        || stats.thinkingTokens > 0
        || stats.cacheReadTokens > 0
        || stats.cacheCreationTokens > 0
        || stats.credits > 0
        || stats.estimatedCost > 0;
}

function parseCallCreatedAtMs(createdAt: string | undefined): number {
    const parsed = Date.parse(createdAt || '');
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function isRecordedCallBeforeCutoff(call: LedgerRecordedCall, cutoffMs: number | undefined): boolean {
    if (cutoffMs === undefined) { return true; }
    return Number.isFinite(call.createdAtMs) ? call.createdAtMs <= cutoffMs : true;
}

function subtractStatsFromBucket(bucket: LedgerAccountBucket, key: string, stats: LedgerModelStats): void {
    bucket.totalCalls = Math.max(0, bucket.totalCalls - stats.calls);
    bucket.totalInputTokens = Math.max(0, bucket.totalInputTokens - stats.inputTokens);
    bucket.totalOutputTokens = Math.max(0, bucket.totalOutputTokens - stats.outputTokens);
    bucket.totalThinkingTokens = Math.max(0, bucket.totalThinkingTokens - stats.thinkingTokens);
    bucket.totalCacheRead = Math.max(0, bucket.totalCacheRead - stats.cacheReadTokens);
    bucket.totalCacheCreation = Math.max(0, bucket.totalCacheCreation - stats.cacheCreationTokens);
    bucket.totalCredits = Math.max(0, bucket.totalCredits - stats.credits);
    bucket.totalEstimatedCost = Math.max(0, bucket.totalEstimatedCost - stats.estimatedCost);

    const activeStats = bucket.modelStats[key];
    if (!activeStats) { return; }
    activeStats.calls = Math.max(0, activeStats.calls - stats.calls);
    activeStats.inputTokens = Math.max(0, activeStats.inputTokens - stats.inputTokens);
    activeStats.outputTokens = Math.max(0, activeStats.outputTokens - stats.outputTokens);
    activeStats.thinkingTokens = Math.max(0, activeStats.thinkingTokens - stats.thinkingTokens);
    activeStats.cacheReadTokens = Math.max(0, activeStats.cacheReadTokens - stats.cacheReadTokens);
    activeStats.cacheCreationTokens = Math.max(0, activeStats.cacheCreationTokens - stats.cacheCreationTokens);
    activeStats.credits = Math.max(0, activeStats.credits - stats.credits);
    activeStats.estimatedCost = Math.max(0, activeStats.estimatedCost - stats.estimatedCost);
    if (activeStats.calls === 0) {
        delete bucket.modelStats[key];
    }
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
        recordedCalls: [],
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
        const isLegacyIndexOnlyId = (id: string): boolean => {
            if (!id.startsWith(prefix)) { return false; }
            return /^\d+$/.test(id.slice(prefix.length));
        };
        const toRemove: string[] = [];
        for (const id of this._allRecordedIds) {
            if (isLegacyIndexOnlyId(id)) { toRemove.push(id); }
        }
        for (const id of toRemove) { this._allRecordedIds.delete(id); }
        // Also clean legacy per-account bucket recordedCallIds
        for (const bucket of this._accounts.values()) {
            bucket.recordedCallIds = bucket.recordedCallIds.filter(id => !isLegacyIndexOnlyId(id));
        }
    }

    /**
     * Check if a specific pool (by modelIds + email) has already been settled.
     * Used by proactive settlement to avoid duplicate settlements.
     */
    isPoolSettled(modelIds: string[], email?: string, cutoffTime?: number): boolean {
        const querySet = new Set(modelIds.map(id => id.toLowerCase()));
        const cutoffMs = typeof cutoffTime === 'number' && !Number.isNaN(cutoffTime)
            ? cutoffTime
            : undefined;
        for (const entry of this._settled) {
            const matchEmail = !email || entry.accountEmail === email;
            if (!matchEmail) { continue; }
            // Compare by poolModelIds (raw model IDs), not modelCalls (display names)
            const overlap = (entry.poolModelIds || []).some(
                pid => querySet.has(pid.toLowerCase()),
            );
            if (!overlap) { continue; }
            if (cutoffMs === undefined) { return true; }
            if (typeof entry.settledCutoffTime === 'number'
                && entry.settledCutoffTime >= cutoffMs) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if the active bucket for a given email has any recorded calls
     * for models in the specified pool. Used to detect real usage even when
     * the account snapshot's `hasUsage` flag is stale.
     */
    hasActiveCallsForPool(poolModelIds: string[], email?: string): boolean {
        const acctEmail = email || '';
        const bucket = this._accounts.get(acctEmail);
        if (!bucket || bucket.totalCalls === 0) { return false; }

        const poolIdSet = new Set(poolModelIds.map(id => id.toLowerCase()));
        for (const modelKey of Object.keys(bucket.modelStats)) {
            const resolvedId = resolveModelId(modelKey);
            if (resolvedId && poolIdSet.has(resolvedId.toLowerCase())) {
                return true;
            }
            // Fallback: display name match
            for (const pid of poolModelIds) {
                const pidDisplay = normalizeModelDisplayName(pid);
                if (pidDisplay && pidDisplay.toLowerCase() === modelKey.toLowerCase()) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Record a batch of new GM calls into the ledger.
     * Each entry carries a `dedupKey` (provided by the tracker) for reliable dedup.
     * @returns number of newly recorded calls
     */
    recordCalls(entries: LedgerCallEntry[]): number {
        let added = 0;
        const todayKey = toLocalDateKey();

        // If the date has rolled over, do NOT auto-reset here.
        // performDailyArchival() must call rollover() first to archive yesterday's
        // data before we start recording for the new day. Silently skip until then.
        if (todayKey !== this._dateKey) {
            return 0;
        }

        // Timestamp gate: compute midnight of dateKey's local day.
        // Calls with createdAt before this threshold are old history
        // (e.g. from loading a previous conversation) and must be rejected.
        const dayStartMs = dateKeyToStartOfDayMs(this._dateKey);
        const nextDayStartMs = dateKeyToNextDayStartMs(this._dateKey);

        for (const entry of entries) {
            const call = entry.call;

            // Reject calls outside the ledger day's local bounds.
            // This prevents both old history and future-day calls from polluting
            // the current bucket when conversations are reloaded across midnight.
            if (dayStartMs > 0 && call.createdAt) {
                const callMs = Date.parse(call.createdAt);
                if (!isNaN(callMs) && (callMs < dayStartMs || (nextDayStartMs > 0 && callMs >= nextDayStartMs))) {
                    continue;
                }
            }

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
                ms = emptyModelStats();
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
            const createdAtMs = parseCallCreatedAtMs(call.createdAt);
            bucket.recordedCalls.push({
                callId: id,
                createdAt: call.createdAt || '',
                createdAtMs,
                modelId: resolveCallModelId(call, modelKey),
                modelKey,
                inputTokens: call.inputTokens,
                outputTokens: call.outputTokens,
                thinkingTokens: call.thinkingTokens,
                cacheReadTokens: call.cacheReadTokens,
                cacheCreationTokens: call.cacheCreationTokens,
                credits: call.credits,
                estimatedCost: cost,
            });
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
     * @param cutoffTime Optional reset boundary. Only calls created at or before
     *                   this time are settled; later calls remain active.
     * @returns the settled entry, or null if no matching data
     */
    settleForQuotaReset(poolModelIds: string[], accountEmail?: string, cutoffTime?: number): LedgerSettledEntry | null {
        const email = accountEmail || '';
        const bucket = this._accounts.get(email);
        if (!bucket || bucket.totalCalls === 0) { return null; }
        const cutoffMs = typeof cutoffTime === 'number' && !Number.isNaN(cutoffTime)
            ? cutoffTime
            : undefined;
        const settledStatsByModel: Record<string, LedgerModelStats> = {};
        const representedStatsByModel: Record<string, LedgerModelStats> = {};
        const recordedCalls = Array.isArray(bucket.recordedCalls) ? bucket.recordedCalls : [];
        const remainingCalls: LedgerRecordedCall[] = [];

        for (const call of recordedCalls) {
            const matches = callMatchesPool(call.modelKey, call.modelId, poolModelIds);
            if (matches) {
                const represented = representedStatsByModel[call.modelKey] || emptyModelStats();
                addRecordedCallStats(represented, call);
                representedStatsByModel[call.modelKey] = represented;
            }
            if (!matches || !isRecordedCallBeforeCutoff(call, cutoffMs)) {
                remainingCalls.push(call);
                continue;
            }
            const stats = settledStatsByModel[call.modelKey] || emptyModelStats();
            addRecordedCallStats(stats, call);
            settledStatsByModel[call.modelKey] = stats;
        }
        bucket.recordedCalls = remainingCalls;

        for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
            if (!callMatchesPool(modelKey, resolveModelId(modelKey), poolModelIds)) { continue; }
            const unrepresented = subtractModelStatsSnapshot(ms, representedStatsByModel[modelKey]);
            if (hasModelStatsData(unrepresented)) {
                const stats = settledStatsByModel[modelKey] || emptyModelStats();
                addModelStats(stats, unrepresented);
                settledStatsByModel[modelKey] = stats;
            }
        }

        const matchingModelKeys = Object.keys(settledStatsByModel);
        if (matchingModelKeys.length === 0) { return null; }

        let totalCalls = 0;
        let totalIn = 0, totalOut = 0, totalThinking = 0, totalCache = 0, totalCacheCreation = 0;
        let totalCredits = 0, totalCost = 0;
        const modelCalls: Record<string, number> = {};

        for (const key of matchingModelKeys) {
            const ms = settledStatsByModel[key];
            if (!ms) { continue; }
            totalCalls += ms.calls;
            totalIn += ms.inputTokens;
            totalOut += ms.outputTokens;
            totalThinking += ms.thinkingTokens;
            totalCache += ms.cacheReadTokens;
            totalCacheCreation += ms.cacheCreationTokens;
            totalCredits += ms.credits;
            totalCost += ms.estimatedCost;
            modelCalls[key] = ms.calls;
            subtractStatsFromBucket(bucket, key, ms);
        }

        const entry: LedgerSettledEntry = {
            settledAt: new Date().toISOString(),
            accountEmail: email,
            poolModelIds,
            poolModelLabels: matchingModelKeys,
            totalCalls,
            totalInputTokens: totalIn,
            totalOutputTokens: totalOut,
            totalThinkingTokens: totalThinking,
            totalCacheRead: totalCache,
            totalCacheCreation,
            totalCredits,
            totalEstimatedCost: totalCost,
            settledCutoffTime: cutoffMs,
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
            accounts[email] = {
                ...bucket,
                recordedCallIds: [...bucket.recordedCallIds],
                recordedCalls: [...bucket.recordedCalls],
            };
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
            accounts[email] = {
                ...bucket,
                recordedCallIds: [...bucket.recordedCallIds],
                recordedCalls: [...bucket.recordedCalls],
            };
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

        // Always restore the data — even if it's from a previous day.
        // If the IDE was off overnight, the data hasn't been rolled over yet.
        // performDailyArchival() will call rollover() to flush it before
        // starting the new day.
        ledger._dateKey = data.dateKey;
        ledger._settled = Array.isArray(data.settled) ? [...data.settled] : [];

        if (data.accounts && typeof data.accounts === 'object') {
            for (const [email, bucket] of Object.entries(data.accounts)) {
                const restored: LedgerAccountBucket = {
                    ...bucket,
                    recordedCallIds: Array.isArray(bucket.recordedCallIds)
                        ? [...bucket.recordedCallIds]
                        : [],
                    recordedCalls: Array.isArray(bucket.recordedCalls)
                        ? [...bucket.recordedCalls]
                        : [],
                };
                ledger._accounts.set(email, restored);
                // Rebuild dedup set
                for (const id of restored.recordedCallIds) {
                    ledger._allRecordedIds.add(id);
                }
            }
        }

        // A stale empty ledger has nothing to archive, but keeping its old
        // dateKey makes recordCalls() reject all new calls until restart repair.
        if (!ledger.hasData && ledger._dateKey !== toLocalDateKey()) {
            ledger._resetForNewDay(toLocalDateKey());
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

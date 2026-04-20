// ─── Daily Store ─────────────────────────────────────────────────────────────
// Aggregates Activity, GM, and Pricing snapshots by date for the Calendar tab.
// Each day gets a single aggregated entry, written when the local date rolls over.
// Persisted via globalState for cross-session survival.

import type { ActivityArchive, ActivitySummary } from './activity-tracker';
import type { GMSummary, GMModelStats } from './gm-tracker';

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
    gmTotalTokens?: number;          // input + output
    gmRetryTokens?: number;          // retry overhead: tokens wasted
    gmRetryCredits?: number;         // retry overhead: credits lost
    gmRetryCount?: number;           // retry overhead: number of retried calls
    // Cost
    estimatedCost?: number;          // USD grand total
    // GM per-model breakdown
    gmModelStats?: Record<string, GMModelCycleStats>;
    /** Account email that produced this cycle (multi-account isolation) */
    accountEmail?: string;
}

/** All cycles for a single calendar day */
export interface DailyRecord {
    date: string;                    // 'YYYY-MM-DD'
    cycles: DailyCycleEntry[];
}

/** Month-cell summary for calendar grid rendering */
export interface MonthCellSummary {
    date: string;                    // 'YYYY-MM-DD'
    cycleCount: number;
    totalReasoning: number;
    totalToolCalls: number;
    totalCost: number;
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

function buildGMPerModelStats(
    gmSummaryOrBreakdown?: GMSummary | Record<string, GMModelStats> | null,
    costPerModel?: Record<string, number>,
): Record<string, GMModelCycleStats> | undefined {
    const breakdown = gmSummaryOrBreakdown && 'modelBreakdown' in gmSummaryOrBreakdown
        ? gmSummaryOrBreakdown.modelBreakdown
        : gmSummaryOrBreakdown || undefined;
    if (!breakdown) { return undefined; }
    const gmPerModel: Record<string, GMModelCycleStats> = {};
    for (const [name, ms] of Object.entries(breakdown)) {
        gmPerModel[name] = {
            calls: ms.callCount,
            credits: ms.totalCredits,
            inputTokens: ms.totalInputTokens,
            outputTokens: ms.totalOutputTokens,
            thinkingTokens: ms.totalThinkingTokens,
            avgTTFT: ms.avgTTFT,
            cacheHitRate: ms.cacheHitRate,
            estimatedCost: costPerModel?.[name],
        };
    }
    return Object.keys(gmPerModel).length > 0 ? gmPerModel : undefined;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'dailyStoreState';
const DEFAULT_MAX_DAYS = 90;

// ─── DailyStore Class ────────────────────────────────────────────────────────

export class DailyStore {
    private _records = new Map<string, DailyRecord>();
    private _maxDays = DEFAULT_MAX_DAYS;
    private _globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): Thenable<void> } | null = null;

    /** Initialize from globalState */
    init(globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): Thenable<void> }): void {
        this._globalState = globalState;
        const saved = globalState.get<DailyStoreState | null>(STORAGE_KEY, null);
        if (saved && saved.version === 1 && saved.records) {
            for (const [date, record] of Object.entries(saved.records)) {
                this._records.set(date, record);
            }
        }
        this._trimOld();
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

        if (gmSummary) {
            entry.gmTotalCalls = gmSummary.totalCalls;
            entry.gmTotalCredits = gmSummary.totalCredits;
            entry.gmTotalTokens = gmSummary.totalInputTokens + gmSummary.totalOutputTokens;
            if (gmSummary.totalRetryTokens > 0) {
                entry.gmRetryTokens = gmSummary.totalRetryTokens;
                entry.gmRetryCredits = gmSummary.totalRetryCredits;
                entry.gmRetryCount = gmSummary.totalRetryCount;
            }
        }

        if (costTotal !== undefined && costTotal > 0) {
            entry.estimatedCost = costTotal;
        }

        entry.gmModelStats = buildGMPerModelStats(gmSummary, costPerModel);

        // One entry per day — replace existing
        record.cycles = [entry];
        this._trimOld();
        this._persist();
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

        if (gmSummary) {
            cycle.gmTotalCalls = gmSummary.totalCalls;
            cycle.gmTotalCredits = gmSummary.totalCredits;
            cycle.gmTotalTokens = gmSummary.totalInputTokens + gmSummary.totalOutputTokens;
            if (gmSummary.totalRetryTokens > 0) {
                cycle.gmRetryTokens = gmSummary.totalRetryTokens;
                cycle.gmRetryCredits = gmSummary.totalRetryCredits;
                cycle.gmRetryCount = gmSummary.totalRetryCount;
            }
        }

        if (costTotal !== undefined && costTotal > 0) {
            cycle.estimatedCost = costTotal;
        }
        cycle.gmModelStats = buildGMPerModelStats(gmSummary, costPerModel);
        if (accountEmail) { cycle.accountEmail = accountEmail; }

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

    /** Get summary data for each day in a month (for calendar grid) */
    getMonthSummary(year: number, month: number): MonthCellSummary[] {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const results: MonthCellSummary[] = [];

        for (const [date, record] of this._records) {
            if (!date.startsWith(prefix)) { continue; }
            let totalReasoning = 0, totalToolCalls = 0, totalCost = 0;
            for (const c of record.cycles) {
                totalReasoning += c.totalReasoning;
                totalToolCalls += c.totalToolCalls;
                totalCost += c.estimatedCost || 0;
            }
            results.push({
                date,
                cycleCount: record.cycles.length,
                totalReasoning,
                totalToolCalls,
                totalCost,
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
                    for (const [name, gms] of Object.entries(cycle.gmModelStats)) {
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
        if (state && state.version === 1 && state.records) {
            for (const [date, record] of Object.entries(state.records)) {
                this._records.set(date, record);
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

    private _persist(): void {
        if (this._globalState) {
            this._globalState.update(STORAGE_KEY, this.serialize());
        }
    }
}

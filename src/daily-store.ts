// ─── Daily Store ─────────────────────────────────────────────────────────────
// Aggregates Activity, GM, and Pricing snapshots by date for the Calendar tab.
// Each quota-reset archive creates a "cycle" entry under that day's record.
// Persisted via globalState for cross-session survival.

import type { ActivityArchive } from './activity-tracker';
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
    /** True once importArchives has completed — prevents re-importing on every activate */
    backfilled?: boolean;
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
    private _backfilled = false;
    private _globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): Thenable<void> } | null = null;

    /** Initialize from globalState */
    init(globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): Thenable<void> }): void {
        this._globalState = globalState;
        const saved = globalState.get<DailyStoreState | null>(STORAGE_KEY, null);
        if (saved && saved.version === 1 && saved.records) {
            for (const [date, record] of Object.entries(saved.records)) {
                this._records.set(date, record);
            }
            this._backfilled = !!saved.backfilled;
        }
        this._trimOld();
    }

    /**
     * Add a cycle entry from an ActivityArchive snapshot.
     * Called when quota resets (archiveAndReset).
     */
    addCycle(
        archive: ActivityArchive,
        gmSummary?: GMSummary | null,
        costTotal?: number,
        costPerModel?: Record<string, number>,
    ): void {
        const dateKey = toDateKey(archive.endTime);
        let record = this._records.get(dateKey);
        if (!record) {
            record = { date: dateKey, cycles: [] };
            this._records.set(dateKey, record);
        }

        const s = archive.summary;

        // Extract per-model breakdown from archive's modelStats
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

        // GM per-model breakdown
        cycle.gmModelStats = buildGMPerModelStats(gmSummary, costPerModel);

        record.cycles.push(cycle);
        this._trimOld();
        this._persist();
    }

    /**
     * Bulk import existing archives into the store (ONE-TIME retroactive fill).
     * Skips entirely if already backfilled. Sets backfilled flag after completion
     * so subsequent activations don't re-import cleared data.
     */
    importArchives(
        archives: ActivityArchive[],
        gmSummary?: GMSummary | null,
        costTotal?: number,
    ): number {
        // Already backfilled — skip to prevent resurrecting cleared calendar data
        if (this._backfilled) { return 0; }

        let imported = 0;
        let needsPersist = false;
        for (const archive of archives) {
            const dateKey = toDateKey(archive.endTime);
            const existing = this._records.get(dateKey);
            // Dedup: skip if a cycle with the same startTime already exists — BUT
            // back-fill missing fields if the existing cycle is incomplete (data upgrade).
            if (existing) {
                const match = existing.cycles.find(c => c.startTime === archive.startTime);
                if (match) {
                    const upgradedModelStats = buildPerModelStats(archive.summary.modelStats);
                    const archiveGMBreakdown = archive.summary.gmModelBreakdown;
                    const upgradedGMModelStats = buildGMPerModelStats(gmSummary?.modelBreakdown || archiveGMBreakdown);
                    const gmTotalCalls = gmSummary?.totalCalls
                        ?? (archiveGMBreakdown ? Object.values(archiveGMBreakdown).reduce((sum, ms) => sum + ms.callCount, 0) : 0);
                    const gmTotalCredits = gmSummary?.totalCredits
                        ?? (archiveGMBreakdown ? Object.values(archiveGMBreakdown).reduce((sum, ms) => sum + ms.totalCredits, 0) : 0);
                    const gmTotalTokens = gmSummary
                        ? gmSummary.totalInputTokens + gmSummary.totalOutputTokens
                        : (archiveGMBreakdown
                            ? Object.values(archiveGMBreakdown).reduce((sum, ms) => sum + ms.totalInputTokens + ms.totalOutputTokens, 0)
                            : 0);
                    const gmRetryTokens = gmSummary?.totalRetryTokens ?? 0;
                    const gmRetryCredits = gmSummary?.totalRetryCredits ?? 0;
                    const gmRetryCount = gmSummary?.totalRetryCount ?? 0;

                    if (!match.modelStats && upgradedModelStats) {
                        match.modelStats = upgradedModelStats;
                        needsPersist = true;
                    }
                    if (!match.triggeredBy && archive.triggeredBy && archive.triggeredBy.length > 0) {
                        match.triggeredBy = [...archive.triggeredBy];
                        needsPersist = true;
                    }
                    if ((match.gmTotalCalls === undefined || match.gmTotalCalls === 0) && gmTotalCalls > 0) {
                        match.gmTotalCalls = gmTotalCalls;
                        needsPersist = true;
                    }
                    if ((match.gmTotalCredits === undefined || match.gmTotalCredits === 0) && gmTotalCredits > 0) {
                        match.gmTotalCredits = gmTotalCredits;
                        needsPersist = true;
                    }
                    if ((match.gmTotalTokens === undefined || match.gmTotalTokens === 0) && gmTotalTokens > 0) {
                        match.gmTotalTokens = gmTotalTokens;
                        needsPersist = true;
                    }
                    if ((match.gmRetryTokens === undefined || match.gmRetryTokens === 0) && gmRetryTokens > 0) {
                        match.gmRetryTokens = gmRetryTokens;
                        match.gmRetryCredits = gmRetryCredits;
                        match.gmRetryCount = gmRetryCount;
                        needsPersist = true;
                    }
                    if ((match.estimatedCost === undefined || match.estimatedCost === 0) && (costTotal || 0) > 0) {
                        match.estimatedCost = costTotal;
                        needsPersist = true;
                    }
                    if (!match.gmModelStats && upgradedGMModelStats) {
                        match.gmModelStats = upgradedGMModelStats;
                        needsPersist = true;
                    }
                    continue;
                }
            }
            this.addCycle(archive, gmSummary, costTotal);
            imported++;
        }
        // Mark as backfilled so subsequent activations skip this path
        this._backfilled = true;
        this._persist();
        return imported;
    }

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

    /** Clear all history. Also sets backfilled=true to prevent importArchives from re-populating. */
    clear(): void {
        this._records.clear();
        this._backfilled = true;
        this._persist();
    }

    /** Serialize to plain object */
    serialize(): DailyStoreState {
        const records: Record<string, DailyRecord> = {};
        for (const [date, record] of this._records) {
            records[date] = record;
        }
        return { version: 1, records, backfilled: this._backfilled };
    }

    /** Restore the full in-memory snapshot and persist it back to storage. */
    restoreSnapshot(state: DailyStoreState): void {
        this._records.clear();
        if (state && state.version === 1 && state.records) {
            for (const [date, record] of Object.entries(state.records)) {
                this._records.set(date, record);
            }
            this._backfilled = !!state.backfilled;
        } else {
            this._backfilled = false;
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

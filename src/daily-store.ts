// ─── Daily Store ─────────────────────────────────────────────────────────────
// Aggregates Activity, GM, and Pricing snapshots by date for the Calendar tab.
// Each quota-reset archive creates a "cycle" entry under that day's record.
// Persisted via globalState for cross-session survival.

import type { ActivityArchive } from './activity-tracker';
import type { GMSummary } from './gm-tracker';

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

/** Serialized state for globalState */
interface DailyStoreState {
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
        const perModel: Record<string, ModelCycleStats> = {};
        for (const [name, ms] of Object.entries(s.modelStats)) {
            perModel[name] = {
                reasoning: ms.reasoning,
                toolCalls: ms.toolCalls,
                errors: ms.errors,
                estSteps: ms.estSteps,
                inputTokens: ms.inputTokens,
                outputTokens: ms.outputTokens,
            };
        }

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
            modelStats: Object.keys(perModel).length > 0 ? perModel : undefined,
        };

        if (gmSummary) {
            cycle.gmTotalCalls = gmSummary.totalCalls;
            cycle.gmTotalCredits = gmSummary.totalCredits;
            cycle.gmTotalTokens = gmSummary.totalInputTokens + gmSummary.totalOutputTokens;
        }

        if (costTotal !== undefined && costTotal > 0) {
            cycle.estimatedCost = costTotal;
        }

        // GM per-model breakdown
        if (gmSummary && gmSummary.modelBreakdown) {
            const gmPerModel: Record<string, GMModelCycleStats> = {};
            for (const [name, ms] of Object.entries(gmSummary.modelBreakdown)) {
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
            if (Object.keys(gmPerModel).length > 0) {
                cycle.gmModelStats = gmPerModel;
            }
        }

        record.cycles.push(cycle);
        this._trimOld();
        this._persist();
    }

    /**
     * Bulk import existing archives into the store (retroactive fill).
     * Skips any archives whose startTime already exists to avoid duplicates.
     * Called once at startup to backfill from activityTracker.getArchives().
     */
    importArchives(
        archives: ActivityArchive[],
        gmSummary?: GMSummary | null,
        costTotal?: number,
    ): number {
        let imported = 0;
        let needsPersist = false;
        for (const archive of archives) {
            const dateKey = toDateKey(archive.endTime);
            const existing = this._records.get(dateKey);
            // Dedup: skip if a cycle with the same startTime already exists — BUT
            // back-fill modelStats if the existing cycle is missing it (data upgrade).
            if (existing) {
                const match = existing.cycles.find(c => c.startTime === archive.startTime);
                if (match) {
                    if (!match.modelStats && archive.summary.modelStats) {
                        const perModel: Record<string, ModelCycleStats> = {};
                        for (const [name, ms] of Object.entries(archive.summary.modelStats)) {
                            perModel[name] = {
                                reasoning: ms.reasoning,
                                toolCalls: ms.toolCalls,
                                errors: ms.errors,
                                estSteps: ms.estSteps,
                                inputTokens: ms.inputTokens,
                                outputTokens: ms.outputTokens,
                            };
                        }
                        if (Object.keys(perModel).length > 0) {
                            match.modelStats = perModel;
                            needsPersist = true;
                        }
                    }
                    continue;
                }
            }
            this.addCycle(archive, gmSummary, costTotal);
            imported++;
        }
        if (needsPersist) { this._persist(); }
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

    /** Total number of recorded days */
    get totalDays(): number { return this._records.size; }

    /** Clear all history */
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

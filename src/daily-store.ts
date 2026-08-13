// ─── Daily Store ─────────────────────────────────────────────────────────────
// Aggregates Activity, GM, and Pricing snapshots by date for the Calendar tab.
// Each day gets a single aggregated entry, written when the local date rolls over.
// Persisted via globalState for cross-session survival.

import type { ActivityArchive, ActivitySummary } from './activity-tracker';
import type { GMSummary, GMModelStats } from './gm-tracker';
import { normalizeModelDisplayName } from './models';
import type { ModelPricing } from './pricing-store';
import { DEFAULT_PRICING, findPricingWithCustom, costFromTokens } from './pricing-store';

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
     *  DailyStore.backfillMissingCosts. Such a figure excludes cache reads and
     *  is therefore an underestimate, not an original record. */
    costBackfilled?: true;
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
    gmCalls: number;
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

/**
 * Gemini 3.7 Flash shipped on introductory pricing that Google's own footnote says expires
 * 2026-12-31, with both rates doubling on 2027-01-01. The built-in table therefore has to be
 * rewritten on that date, and from then on every 2026 day re-priced against it would be
 * billed at twice what it actually cost. Backfilling re-prices days that are already over,
 * so it has to charge each day the rate that was in force on that day.
 *
 * This is deliberately a single hard-coded special case rather than an effective-date pricing
 * system: exactly one row is documented to change on exactly one known date.
 */
const GEMINI_37_FLASH_INTRO_LAST_DAY = '2026-12-31';
const GEMINI_37_FLASH_INTRO_PRICING: ModelPricing = {
    input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.9375, thinking: 3.75,
};

/**
 * The pricing that applied on `date`.
 *
 * `findPricing` hands back the table's own object, so a row that priced off the built-in
 * 'gemini-3.7-flash' entry is recognizable by reference regardless of which of its spellings
 * the archived key used — a display name, a localized display name, or a raw
 * 'MODEL_PLACEHOLDER_M298'. A user's custom price is a different object and passes through
 * untouched, because an explicit override outranks this rule.
 */
function pricingForDate(
    pricing: ModelPricing,
    base: Record<string, ModelPricing>,
    date: string,
): ModelPricing {
    if (pricing === base['gemini-3.7-flash'] && date <= GEMINI_37_FLASH_INTRO_LAST_DAY) {
        return GEMINI_37_FLASH_INTRO_PRICING;
    }
    return pricing;
}

/** Options for {@link DailyStore.backfillMissingCosts}. */
export interface CostBackfillOptions {
    /** Built-in pricing table to price against. Defaults to DEFAULT_PRICING. */
    basePricing?: Record<string, ModelPricing>;
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
     * Merge external records into this store (for data migration/recovery).
     * Only adds records for dates not already present — existing data is never overwritten.
     * Returns the number of records added.
     */
    mergeRecords(externalState: DailyStoreState): number {
        if (!externalState || externalState.version !== 1 || !externalState.records) { return 0; }
        let added = 0;
        for (const [date, record] of Object.entries(externalState.records)) {
            if (!this._records.has(date)) {
                this._records.set(date, record);
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
                let cycleDelta = 0;

                for (const [modelKey, gms] of Object.entries(cycle.gmModelStats)) {
                    if (gms.estimatedCost !== undefined) { continue; }
                    const pricing = findPricingWithCustom(modelKey, customPricing, base);
                    if (!pricing) { continue; }
                    const cost = costFromTokens({
                        inputTokens: gms.inputTokens,
                        outputTokens: gms.outputTokens,
                        thinkingTokens: gms.thinkingTokens,
                        cacheReadTokens: 0,     // dropped at rollover — never archived
                    }, pricingForDate(pricing, base, date));
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

        if (append) {
            record.cycles.push(entry);
        } else {
            // One entry per day — replace existing
            record.cycles = [entry];
        }
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
            let totalReasoning = 0, totalToolCalls = 0, totalCost = 0, gmCalls = 0;
            for (const c of record.cycles) {
                totalReasoning += c.totalReasoning;
                totalToolCalls += c.totalToolCalls;
                totalCost += c.estimatedCost || 0;
                gmCalls += c.gmTotalCalls || 0;
            }
            results.push({
                date,
                cycleCount: record.cycles.length,
                totalReasoning,
                totalToolCalls,
                totalCost,
                gmCalls,
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

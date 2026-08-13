/**
 * Test: DailyStore.backfillMissingCosts — re-pricing archived days that were stored with
 * no cost because their model had no price row at the time.
 *
 * The invariants under test are the ones that make it safe to run on every activation:
 * it only fills gaps, it never moves a number that is already there, and running it twice
 * is the same as running it once.
 */

import { describe, expect, it } from 'vitest';
import { DailyStore, type DailyStoreState, type GMModelCycleStats } from '../src/daily-store';
import { DEFAULT_PRICING, type ModelPricing } from '../src/pricing-store';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'dailyStoreState';

/** In-memory stand-in for vscode globalState. */
function makeGlobalState() {
    const mem = new Map<string, unknown>();
    return {
        mem,
        get<T>(k: string, d: T): T { return mem.has(k) ? mem.get(k) as T : d; },
        update(k: string, v: unknown): Thenable<void> { mem.set(k, v); return Promise.resolve(); },
    };
}

/** A per-model row; `estimatedCost` is left absent unless given, as the archive does. */
function row(over: Partial<GMModelCycleStats> = {}): GMModelCycleStats {
    const r: GMModelCycleStats = {
        calls: 10,
        credits: 0,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        thinkingTokens: 0,
        avgTTFT: 0,
        cacheHitRate: 0,
        ...over,
    };
    if (over.estimatedCost === undefined) { delete r.estimatedCost; }
    return r;
}

function stateWith(
    days: Record<string, { cost?: number; models: Record<string, GMModelCycleStats> }>,
): DailyStoreState {
    const records: DailyStoreState['records'] = {};
    for (const [date, day] of Object.entries(days)) {
        records[date] = {
            date,
            cycles: [{
                startTime: `${date}T00:00:00`,
                endTime: `${date}T23:59:59`,
                totalReasoning: 1, totalToolCalls: 1, totalErrors: 0,
                totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                modelNames: Object.keys(day.models),
                ...(day.cost === undefined ? {} : { estimatedCost: day.cost }),
                gmModelStats: day.models,
            }],
        };
    }
    return { version: 1, records };
}

function makeStore(state: DailyStoreState) {
    const globalState = makeGlobalState();
    globalState.mem.set(STORAGE_KEY, JSON.parse(JSON.stringify(state)));
    const store = new DailyStore();
    store.init(globalState);
    return { store, globalState };
}

/** DEFAULT_PRICING with the 3.7 Flash row already rewritten to its post-2027 rates. */
function post2027Table(): Record<string, ModelPricing> {
    return {
        ...DEFAULT_PRICING,
        'gemini-3.7-flash': { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 1.875, thinking: 7.50 },
    };
}

const firstRow = (store: DailyStore, date: string): GMModelCycleStats =>
    Object.values(store.getRecord(date)!.cycles[0].gmModelStats!)[0];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DailyStore.backfillMissingCosts', () => {
    it('leaves a row that already has a cost byte-identical', () => {
        const state = stateWith({
            '2026-03-22': { cost: 1.23, models: { 'Claude Opus 4.6 (Thinking)': row({ estimatedCost: 1.23 }) } },
        });
        const { store } = makeStore(state);
        const before = JSON.stringify(store.serialize());

        expect(store.backfillMissingCosts({})).toBe(0);
        expect(JSON.stringify(store.serialize())).toBe(before);
    });

    it('fills a missing cost from tokens for a resolvable model', () => {
        // Claude Opus 4.6: $5 / 1M input, $25 / 1M output.
        // 1,000,000 in + 500,000 out = 5 + 12.5 = 17.5
        const { store } = makeStore(stateWith({
            '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
        }));

        expect(store.backfillMissingCosts({})).toBe(1);
        const filled = firstRow(store, '2026-03-22');
        expect(filled.estimatedCost).toBeCloseTo(17.5, 10);
        expect(filled.costBackfilled).toBe(true);
    });

    it('resolves a localized display name, as archived by a non-English UI', () => {
        const { store } = makeStore(stateWith({
            '2026-03-22': { models: { 'Claude Opus 4.6 (思考)': row() } },
        }));

        expect(store.backfillMissingCosts({})).toBe(1);
        expect(firstRow(store, '2026-03-22').estimatedCost).toBeCloseTo(17.5, 10);
    });

    it('resolves a raw placeholder key', () => {
        // MODEL_PLACEHOLDER_M298 = Gemini 3.7 Flash (High): $0.75 in / $3.75 out.
        const { store } = makeStore(stateWith({
            '2026-08-01': { models: { 'MODEL_PLACEHOLDER_M298': row({ outputTokens: 1_000_000 }) } },
        }));

        expect(store.backfillMissingCosts({})).toBe(1);
        expect(firstRow(store, '2026-08-01').estimatedCost).toBeCloseTo(4.5, 10);
    });

    it('leaves an unresolvable model absent rather than writing 0', () => {
        const { store } = makeStore(stateWith({
            '2026-03-22': { models: { 'Nonexistent Vendor Zx9': row() } },
        }));

        expect(store.backfillMissingCosts({})).toBe(0);
        const untouched = firstRow(store, '2026-03-22');
        expect(untouched.estimatedCost).toBeUndefined();
        expect('estimatedCost' in untouched).toBe(false);
        expect(untouched.costBackfilled).toBeUndefined();
    });

    it('leaves a resolvable model with no tokens absent rather than writing 0', () => {
        const { store } = makeStore(stateWith({
            '2026-03-22': {
                models: {
                    'Claude Opus 4.6 (Thinking)': row({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }),
                },
            },
        }));

        expect(store.backfillMissingCosts({})).toBe(0);
        expect(firstRow(store, '2026-03-22').estimatedCost).toBeUndefined();
    });

    it('prices a 2026 Gemini 3.7 Flash day at the introductory rate even after the table rolls to 2027', () => {
        // 1M in + 1M out. Introductory: 0.75 + 3.75 = 4.5. Post-2027 would be 1.5 + 7.5 = 9.
        const { store } = makeStore(stateWith({
            '2026-09-14': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
        }));

        expect(store.backfillMissingCosts({}, { basePricing: post2027Table() })).toBe(1);
        expect(firstRow(store, '2026-09-14').estimatedCost).toBeCloseTo(4.5, 10);
    });

    it('prices a 2027 Gemini 3.7 Flash day at the current table rate', () => {
        const { store } = makeStore(stateWith({
            '2027-01-01': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
        }));

        expect(store.backfillMissingCosts({}, { basePricing: post2027Table() })).toBe(1);
        expect(firstRow(store, '2027-01-01').estimatedCost).toBeCloseTo(9, 10);
    });

    it('lets a user custom price outrank the introductory special case', () => {
        const custom: Record<string, ModelPricing> = {
            'Gemini 3.7 Flash (High)': { input: 2, output: 4, cacheRead: 0, cacheWrite: 0, thinking: 4 },
        };
        const { store } = makeStore(stateWith({
            '2026-09-14': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
        }));

        expect(store.backfillMissingCosts(custom)).toBe(1);
        expect(firstRow(store, '2026-09-14').estimatedCost).toBeCloseTo(6, 10);
    });

    it('moves the cycle total by exactly the sum of the rows it filled', () => {
        const { store } = makeStore(stateWith({
            '2026-03-22': {
                cost: 100,
                models: {
                    'Claude Opus 4.6 (Thinking)': row(),                          // 17.5, filled
                    'Claude Sonnet 4.6': row({ estimatedCost: 100 }),             // already priced
                    'Nonexistent Vendor Zx9': row(),                              // unresolvable
                    'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }),  // 4.5, filled
                },
            },
        }));

        expect(store.backfillMissingCosts({})).toBe(2);
        const cycle = store.getRecord('2026-03-22')!.cycles[0];
        expect(cycle.estimatedCost).toBeCloseTo(100 + 17.5 + 4.5, 10);

        // The month rollup and the per-model rollup must agree about the same day.
        const breakdown = store.getMonthCostBreakdown(2026, 3);
        const rowSum = breakdown.models.reduce((s, m) => s + m.totalCost, 0);
        expect(rowSum).toBeCloseTo(breakdown.grandTotal, 10);
    });

    it('sets a cycle total that was absent when it fills rows under it', () => {
        const { store } = makeStore(stateWith({
            '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
        }));

        store.backfillMissingCosts({});
        expect(store.getRecord('2026-03-22')!.cycles[0].estimatedCost).toBeCloseTo(17.5, 10);
    });

    it('is idempotent — running twice equals running once', () => {
        const state = stateWith({
            '2026-03-22': { cost: 100, models: { 'Claude Opus 4.6 (Thinking)': row() } },
            '2026-03-23': { models: { 'Gemini 3.7 Flash (High)': row({ outputTokens: 1_000_000 }) } },
            '2026-03-24': { models: { 'Nonexistent Vendor Zx9': row() } },
        });

        const once = makeStore(state).store;
        expect(once.backfillMissingCosts({})).toBe(2);
        const afterOne = JSON.stringify(once.serialize());

        const twice = makeStore(state).store;
        twice.backfillMissingCosts({});
        expect(twice.backfillMissingCosts({})).toBe(0);
        expect(JSON.stringify(twice.serialize())).toBe(afterOne);
    });

    it('persists exactly once, keeping version 1 so no reader discards the blob', () => {
        const { store, globalState } = makeStore(stateWith({
            '2026-03-22': { models: { 'Claude Opus 4.6 (Thinking)': row() } },
        }));

        store.backfillMissingCosts({});
        const saved = globalState.mem.get(STORAGE_KEY) as DailyStoreState;
        expect(saved.version).toBe(1);
        const savedRow = Object.values(saved.records['2026-03-22'].cycles[0].gmModelStats!)[0];
        expect(savedRow.estimatedCost).toBeCloseTo(17.5, 10);
        expect(savedRow.costBackfilled).toBe(true);
    });

    it('does not touch storage when there is nothing to fill', () => {
        const { store, globalState } = makeStore(stateWith({
            '2026-03-22': { cost: 1.23, models: { 'Claude Opus 4.6 (Thinking)': row({ estimatedCost: 1.23 }) } },
        }));
        const before = JSON.stringify(globalState.mem.get(STORAGE_KEY));

        expect(store.backfillMissingCosts({})).toBe(0);
        expect(JSON.stringify(globalState.mem.get(STORAGE_KEY))).toBe(before);
    });

    it('tolerates a day with no gmModelStats at all', () => {
        const { store } = makeStore({
            version: 1,
            records: {
                '2026-03-22': {
                    date: '2026-03-22',
                    cycles: [{
                        startTime: '2026-03-22T00:00:00', endTime: '2026-03-22T23:59:59',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0, modelNames: [],
                    }],
                },
            },
        });

        expect(store.backfillMissingCosts({})).toBe(0);
    });
});

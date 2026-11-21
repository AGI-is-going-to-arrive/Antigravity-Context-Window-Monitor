import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_PRICING,
    PRICING_LAST_UPDATED,
    PricingStore,
    calculateCosts,
    calculateUsageCosts,
    costFromTokens,
    findPricing,
    findPricingForDate,
    findPricingWithCustom,
    getUpcomingRateChangeForModel,
    getUpcomingRateChanges,
    type ModelPricing,
} from '../src/pricing-store';
import { DailyLedger, type DailyLedgerState } from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { setShowModelShortId, updateModelDisplayNames } from '../src/models';

const NEON_RATE: ModelPricing = { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0, thinking: 15 };
const CUSTOM_OVERRIDE: ModelPricing = { input: 5, output: 25, cacheRead: 0.25, cacheWrite: 0, thinking: 25 };

const NEON_TIERS = [
    { id: 'M534', tier: 'low', label: 'Low', zh: '低' },
    { id: 'M533', tier: 'medium', label: 'Medium', zh: '中' },
    { id: 'M532', tier: 'high', label: 'High', zh: '高' },
    { id: 'M535', tier: 'xhigh', label: 'XHigh', zh: '超高' },
] as const;

const TOKENS = {
    inputTokens: 1_000_000,
    outputTokens: 200_000,
    thinkingTokens: 50_000,
    cacheReadTokens: 1_000_000,
};

beforeEach(() => {
    setShowModelShortId(false);
    updateModelDisplayNames([], { authoritative: true });
});

afterEach(() => {
    vi.useRealTimers();
    setShowModelShortId(false);
    updateModelDisplayNames([], { authoritative: true });
});

function makeNeonCall(id: string, index: number, createdAt = '2026-11-22T01:00:00Z') {
    return {
        ...parseGMEntry({
            executionId: `neon-pricing-${index}`,
            stepIndices: [index + 1],
            chatModel: {
                model: `MODEL_PLACEHOLDER_${id}`,
                responseModel: 'gemini-4-neon',
                usage: {
                    inputTokens: TOKENS.inputTokens,
                    outputTokens: TOKENS.outputTokens,
                    thinkingOutputTokens: TOKENS.thinkingTokens,
                    cacheReadTokens: TOKENS.cacheReadTokens,
                },
                chatStartMetadata: { createdAt },
            },
        }),
        accountEmail: 'neon-pricing@example.test',
    };
}

describe('Gemini 4 Neon verified official standard API pricing', () => {
    it('exposes exact verified rates ($3/$15/$0.15/$0) across all four efforts and shared family', () => {
        expect(PRICING_LAST_UPDATED).toBe('2026-11-22');
        expect(DEFAULT_PRICING['gemini-4-neon']).toEqual(NEON_RATE);

        for (const family of ['gemini-4-neon', 'Gemini 4 Neon', 'GEMINI_4_NEON']) {
            expect(findPricing(family), family).toEqual(NEON_RATE);
        }

        for (const { id, tier, label, zh } of NEON_TIERS) {
            for (const alias of [
                `MODEL_PLACEHOLDER_${id}`,
                `gemini-4-neon-${tier}`,
                `GEMINI_4_NEON_${tier.toUpperCase()}`,
                `Gemini 4 Neon (${label})`,
                `Gemini 4 Neon (${zh}) (${id})`,
                `Gemini 4 Neon（${zh}）`,
            ]) {
                expect(findPricing(alias), alias).toEqual(NEON_RATE);
                expect(
                    findPricingWithCustom(alias, { 'gemini-4-carbon': CUSTOM_OVERRIDE, 'gemini-4-hydrogen': CUSTOM_OVERRIDE }),
                    alias,
                ).toEqual(NEON_RATE);
            }
        }
    });

    it('has no scheduled cutover across December 2026 and January 2027', () => {
        for (const date of ['2026-11-22', '2026-12-01', '2027-01-01']) {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(`${date}T00:00:00Z`));
            expect(DEFAULT_PRICING['gemini-4-neon']).toEqual(NEON_RATE);
            expect(findPricingForDate('MODEL_PLACEHOLDER_M535', {}, date)).toEqual(NEON_RATE);
        }
    });

    it('honors concrete-tier custom overrides ahead of family overrides without leaking across tiers', () => {
        const custom = {
            'gemini-4-neon': NEON_RATE,
            'Gemini 4 Neon (超高) (M535)': CUSTOM_OVERRIDE,
        };
        expect(findPricingWithCustom('MODEL_PLACEHOLDER_M535', custom)).toBe(CUSTOM_OVERRIDE);
        expect(findPricingWithCustom('gemini-4-neon-xhigh', custom)).toBe(CUSTOM_OVERRIDE);
        expect(findPricingWithCustom('gemini-4-neon-high', custom)).toEqual(NEON_RATE);
        expect(findPricingWithCustom('gemini-4-neon-medium', custom)).toEqual(NEON_RATE);
        expect(findPricingWithCustom('gemini-4-neon-low', custom)).toEqual(NEON_RATE);
        expect(findPricingWithCustom('gemini-4-neon', custom)).toEqual(NEON_RATE);
    });

    it('rejects malformed Neon suffixes unless explicitly overridden by exact key', () => {
        for (const malformed of [
            'Gemini 4 Neon (Maximum)',
            'Gemini 4 Neon (Highest)',
            'Gemini 4 Neon (Extra',
            'gemini-4-neon-extra-garbage',
            'Gemini 4 Neon (Extra)X',
            'MODEL_PLACEHOLDER_M5350',
            'gemini-4-neon-preview',
            'gemini-4-neon-20261122',
        ]) {
            expect(findPricing(malformed), malformed).toBeNull();
            expect(findPricingWithCustom(malformed, { 'gemini-4-neon': CUSTOM_OVERRIDE }), malformed).toBeNull();
            expect(findPricingWithCustom(malformed, { [malformed]: CUSTOM_OVERRIDE }), malformed).toBe(CUSTOM_OVERRIDE);
        }
    });

    it('keeps M537 (Orchestrator Neon) and M669 (worker/Hydrogen Orchestrator) deterministically unpriced', () => {
        const unpricedIdentities = [
            'MODEL_PLACEHOLDER_M537',
            'Orchestrator (Neon)',
            'gemini-pro-orchestrator-neon',
            'MODEL_PLACEHOLDER_M669',
            'gemini-flash-worker-agy',
            'Gemini Flash (Orchestrator Worker)',
            'Gemini 4 Hydrogen (Orchestrator)',
            'Gemini 4 Hydrogen (Orchestrator) (M669)',
            'Gemini 4 Hydrogen（编排器）',
            'MODEL_PLACEHOLDER_M578',
            'gemini-4-hydrogen-sonar',
            'Gemini 4 Hydrogen (Sonar)',
        ];
        const familyOverrides = {
            'gemini-4-neon': CUSTOM_OVERRIDE,
            'gemini-4-hydrogen': CUSTOM_OVERRIDE,
        };
        for (const id of unpricedIdentities) {
            expect(findPricing(id), id).toBeNull();
            expect(findPricingWithCustom(id, familyOverrides), id).toBeNull();
            expect(findPricingWithCustom(id, { [id]: CUSTOM_OVERRIDE }), id).toBe(CUSTOM_OVERRIDE);
        }
        // Catalog-only tiered Hydrogen variants price at Hydrogen rates
        expect(findPricing('gemini-4-hydrogen-tiered-high')).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
        expect(findPricing('gemini-4-hydrogen-tiered-xhigh')).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
    });

    it('counts thinking tokens once and computes exact Neon costs', () => {
        // 1M * $3 + (200K - 50K) * $15 + 50K * $15 + 1M * $0.15 = 3 + 2.25 + 0.75 + 0.15 = $6.15
        expect(costFromTokens(TOKENS, NEON_RATE)).toBeCloseTo(6.15, 10);
        const calls = NEON_TIERS.map((t, i) => makeNeonCall(t.id, i));
        const summary = buildSummaryFromConversations([{
            cascadeId: 'neon-fixture',
            title: 'Neon Fixture',
            totalSteps: calls.length,
            calls,
            coveredSteps: calls.length,
            coverageRate: 1,
            checkpointSummaries: [],
        }], '2026-11-22T01:05:00Z')!;
        const costs = calculateCosts(summary, {});
        expect(costs.rows).toHaveLength(4);
        expect(costs.grandTotal).toBeCloseTo(24.6, 10);
    });
});

describe('Neon upgrade recovery: DailyLedger reconciliation & DailyStore backfill', () => {
    it('reconciles today zero-cost Neon ledger calls and archives accurate cost on rollover', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-22T02:00:00Z'));
        const entries = NEON_TIERS.map((t, i) => ({
            dedupKey: `neon:${i}|${encodeURIComponent(`exec:neon-pricing-${i}`)}`,
            call: makeNeonCall(t.id, i, '2026-11-22T01:00:00Z'),
        }));
        const ledger = new DailyLedger();
        expect(ledger.recordCalls(entries)).toBe(4);
        const saved = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
        const bucket = saved.accounts['neon-pricing@example.test'];

        // Simulate pre-upgrade state where Neon was unpriced ($0)
        bucket.totalEstimatedCost = 0;
        for (const ms of Object.values(bucket.modelStats)) { ms.estimatedCost = 0; }
        for (const rc of bucket.recordedCalls) { rc.estimatedCost = 0; }

        const restored = DailyLedger.restore(saved);
        expect(restored.reconcileRecordedCalls(entries)).toBe(4);
        expect(restored.serialize().accounts['neon-pricing@example.test'].totalEstimatedCost).toBeCloseTo(24.6, 10);
        expect(restored.reconcileRecordedCalls(entries)).toBe(0);

        const rolled = buildGMSummaryFromLedger(restored.rollover(saved.dateKey));
        expect(rolled.totalCost).toBeCloseTo(24.6, 10);
    });

    it('backfills archived zero-cost Neon days idempotently without overwriting positive history', () => {
        const state: DailyStoreState = {
            version: 1,
            records: {
                '2026-11-20': {
                    date: '2026-11-20',
                    cycles: [{
                        startTime: '2026-11-20T00:00:00',
                        endTime: '2026-11-20T23:59:59',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['MODEL_PLACEHOLDER_M535'],
                        gmModelStats: {
                            'Gemini 4 Neon (XHigh)': {
                                calls: 1, credits: 0,
                                inputTokens: TOKENS.inputTokens,
                                outputTokens: TOKENS.outputTokens,
                                thinkingTokens: TOKENS.thinkingTokens,
                                cacheReadTokens: TOKENS.cacheReadTokens,
                                avgTTFT: 0, cacheHitRate: 1,
                            },
                        },
                    }],
                },
                '2026-11-21': {
                    date: '2026-11-21',
                    cycles: [{
                        startTime: '2026-11-21T00:00:00',
                        endTime: '2026-11-21T23:59:59',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['MODEL_PLACEHOLDER_M535'],
                        estimatedCost: 9.99,
                        gmModelStats: {
                            'Gemini 4 Neon (XHigh)': {
                                calls: 1, credits: 0,
                                inputTokens: TOKENS.inputTokens,
                                outputTokens: TOKENS.outputTokens,
                                thinkingTokens: TOKENS.thinkingTokens,
                                cacheReadTokens: TOKENS.cacheReadTokens,
                                avgTTFT: 0, cacheHitRate: 1,
                                estimatedCost: 9.99,
                            },
                        },
                    }],
                },
            },
        };
        const persisted = new Map<string, unknown>([['dailyStoreState', state]]);
        const store = new DailyStore();
        store.init({
            get: <T>(key: string, fallback: T) => (persisted.get(key) as T) ?? fallback,
            update: async (key: string, value: unknown) => { persisted.set(key, value); },
        });
        expect(store.backfillMissingCosts()).toBe(1);
        expect(store.getRecord('2026-11-20')!.cycles[0].estimatedCost).toBeCloseTo(6.15, 10);
        expect(store.getRecord('2026-11-21')!.cycles[0].estimatedCost).toBe(9.99);
        expect(store.backfillMissingCosts({ 'gemini-4-neon': CUSTOM_OVERRIDE })).toBe(0);
    });
});

describe('Gemini 3.6 Flash 3-era pricing & calculateUsageCosts', () => {
    it('switches between standard (<Aug 13), promo (Aug 13–Dec 31), and standard (>=2027-01-01)', () => {
        vi.useFakeTimers();
        const store = new PricingStore();

        vi.setSystemTime(new Date('2026-08-12T23:59:59Z'));
        expect(store.getMerged()['gemini-3.6-flash'].input).toBe(1.50);

        vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
        expect(store.getMerged()['gemini-3.6-flash'].input).toBe(0.75);
        expect(store.getMerged()['gemini-3.6-flash'].output).toBe(3.75);
        expect(store.getMerged()['gemini-3.6-flash'].cacheRead).toBe(0.075);

        vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
        expect(store.getMerged()['gemini-3.6-flash'].input).toBe(1.50);

        // Frozen cost preservation across scheduled eras when call timestamps are missing
        const frozen = calculateUsageCosts('gemini-3.6-flash-high', TOKENS, {}, { at: '2026-12-31', frozenCost: 4.5 });
        expect(frozen).toMatchObject({ totalCost: 4.5, costBreakdownUnavailable: true });
    });
});

describe('getUpcomingRateChanges & getUpcomingRateChangeForModel', () => {
    it('reports Carbon & Argon within 14d of 2026-11-22 and adds Flash 3.6/3.7/3.8 within 45d', () => {
        const now = Date.parse('2026-11-22T00:00:00Z');
        const within14 = getUpcomingRateChanges(now, 14);
        expect(within14.map(c => c.modelKey)).toEqual(['gemini-4-argon', 'gemini-4-carbon']);
        expect(within14[0]).toMatchObject({ effectiveDate: '2026-12-01', daysRemaining: 9, multiplier: 2 });

        const within45 = getUpcomingRateChanges(now, 45);
        expect(within45.map(c => c.modelKey)).toEqual([
            'gemini-4-argon',
            'gemini-4-carbon',
            'gemini-3.6-flash',
            'gemini-3.7-flash',
            'gemini-3.8-flash',
        ]);
        expect(within45[2]).toMatchObject({ effectiveDate: '2027-01-01', daysRemaining: 40, multiplier: 2 });
    });

    it('excludes expired cutovers, pre-promo windows, and non-scheduled models', () => {
        const afterDec1 = Date.parse('2026-12-01T00:00:00Z');
        expect(getUpcomingRateChanges(afterDec1, 45).map(c => c.modelKey)).toEqual([
            'gemini-3.6-flash',
            'gemini-3.7-flash',
            'gemini-3.8-flash',
        ]);
        expect(getUpcomingRateChanges(Date.parse('2027-01-01T00:00:00Z'), 365)).toEqual([]);
        // Before 3.6 Flash promo start (2026-08-13), 3.6 Flash is not in a promo window
        const beforePromo = Date.parse('2026-08-01T00:00:00Z');
        expect(getUpcomingRateChanges(beforePromo, 200).map(c => c.modelKey)).not.toContain('gemini-3.6-flash');
        expect(getUpcomingRateChanges(Number.NaN, 30)).toEqual([]);
        expect(getUpcomingRateChanges(afterDec1, -1)).toEqual([]);
    });

    it('matches specific model aliases and suppresses notices when custom pricing overrides the model', () => {
        const now = Date.parse('2026-11-22T00:00:00Z');
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M427', {}, now, 14)?.modelKey).toBe('gemini-4-carbon');
        expect(getUpcomingRateChangeForModel('Gemini 4 Argon (Low)', {}, now, 14)?.modelKey).toBe('gemini-4-argon');
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M535', {}, now, 365)).toBeNull(); // Neon has no cutover
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M528', {}, now, 365)).toBeNull(); // Hydrogen has no cutover
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M427', { 'gemini-4-carbon': CUSTOM_OVERRIDE }, now, 14)).toBeNull();
        expect(getUpcomingRateChangeForModel('', {}, now, 30)).toBeNull();
    });
});

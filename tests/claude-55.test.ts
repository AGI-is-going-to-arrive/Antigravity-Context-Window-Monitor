import { afterEach, describe, expect, it } from 'vitest';
import {
    getContextLimit, getModelBaseName, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, normalizeModelDisplayName, registerResponseModelAlias, resolveModelId,
    setShowModelShortId, updateModelDisplayNames,
} from '../src/models';
import {
    DEFAULT_PRICING, calculateCosts, costFromTokens, findPricing, findPricingWithCustom,
    type ModelPricing,
} from '../src/pricing-store';
import { parseGMEntry } from '../src/gm/parser';
import { getModelDNAKey, restoreModelDNAState, serializeModelDNAState, type PersistedModelDNA } from '../src/model-dna-store';
import { DailyLedger } from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import type { GMSummary } from '../src/gm-tracker';

// Metadata captured from the installed Antigravity IDE's read-only LS endpoints
// on 2026-10-03. No generation, credentials, quota values, or user data in fixtures.
const CLAUDE_55 = [
    { id: 'M400', family: 'Opus', tier: 'Low', zh: '低', effort: 1 },
    { id: 'M401', family: 'Opus', tier: 'Medium', zh: '中', effort: 2 },
    { id: 'M402', family: 'Opus', tier: 'High', zh: '高', effort: 3 },
    { id: 'M403', family: 'Sonnet', tier: 'Low', zh: '低', effort: 1 },
    { id: 'M404', family: 'Sonnet', tier: 'Medium', zh: '中', effort: 2 },
    { id: 'M405', family: 'Sonnet', tier: 'High', zh: '高', effort: 3 },
] as const;

const customPrice: ModelPricing = { input: 11, output: 22, cacheRead: 0.11, cacheWrite: 13.75, thinking: 22 };

afterEach(() => {
    setShowModelShortId(false);
    updateModelDisplayNames([], { authoritative: true });
});

describe('Claude 5.5 registry and cold start', () => {
    it.each(CLAUDE_55)('$id preserves the exact tier across model identifiers and languages', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const label = `Claude ${model.family} 5.5 (${model.tier})`;
        const catalogId = `claude-${model.family.toLowerCase()}-5-5-${model.tier.toLowerCase()}`;
        const aliases = [
            id, catalogId, catalogId.replace('5-5', '5.5'), catalogId.toUpperCase(),
            label, label.replace(model.tier, model.zh), label.replace(`(${model.tier})`, `（${model.zh}）`),
            `  ${label} (${model.id})  `, `Claude ${model.family} 5.5 ${model.tier}`,
        ];
        expect(getModelDisplayName(id)).toBe(label);
        for (const alias of aliases) {
            expect(resolveModelId(alias), alias).toBe(id);
            expect(getModelBaseName(alias), alias).toBe(label);
            expect(getContextLimit(alias), alias).toBe(255_000);
            expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('premium');
        }
        expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 256_000, cpThreshold: 50_000, maxTokens: 1_000_000, supportsThinking: true });
        expect(guessContextLimitSpec(catalogId)).toEqual(guessContextLimitSpec(id));
        expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
            modelId: catalogId, displayName: label, apiProvider: 'ANTHROPIC_VERTEX',
            maxTokens: 1_000_000, maxOutputTokens: 128_000,
            cpLimit: 256_000, cpThreshold: 50_000, thinkingBudget: 0,
            supportsThinking: true, supportsAdaptiveThinking: true, thinkingLevel: model.effort,
        });
    });

    it('defaults bare human labels to Medium without assigning a tier to a shared response family', () => {
        expect(resolveModelId('Claude Opus 5.5')).toBe('MODEL_PLACEHOLDER_M401');
        expect(resolveModelId('Claude Sonnet 5.5')).toBe('MODEL_PLACEHOLDER_M404');
        for (const family of ['opus', 'sonnet']) {
            const bare = `claude-${family}-5-5`;
            registerResponseModelAlias(bare, 'MODEL_PLACEHOLDER_M402');
            expect(resolveModelId(bare)).toBeUndefined();
            expect(getQuotaPoolKey(bare, 'different-reset')).toBe('premium');
            expect(getContextLimit(bare)).toBe(255_000);
        }
    });

    it('keeps 4.6 identities/specs for accounts whose live picker still offers them', () => {
        for (const [id, label] of [
            ['MODEL_PLACEHOLDER_M26', 'Claude Opus 4.6 (Thinking)'],
            ['MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)'],
        ]) {
            expect(resolveModelId(label)).toBe(id);
            expect(getContextLimit(id)).toBe(159_000);
            expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({ cpLimit: 160_000, maxTokens: 250_000 });
        }
        for (const id of ['MODEL_PLACEHOLDER_M4000', 'MODEL_PLACEHOLDER_M4050']) {
            expect(guessContextLimitSpec(id).cpLimit).toBe(0);
        }
    });

    it('keeps diagnostic suffixes out of stable aggregation keys', () => {
        setShowModelShortId(true);
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M402')).toBe('Claude Opus 5.5 (High) (M402)');
        expect(getModelBaseName('Claude Opus 5.5 (High) (M402)')).toBe('Claude Opus 5.5 (High)');
    });
});

describe('Claude 5.5 pricing boundaries', () => {
    it.each(CLAUDE_55)('$id resolves the exact official family price', model => {
        const expected = DEFAULT_PRICING[`claude-${model.family.toLowerCase()}-5-5`];
        for (const key of [
            `MODEL_PLACEHOLDER_${model.id}`,
            `claude-${model.family.toLowerCase()}-5-5-${model.tier.toLowerCase()}`,
            `Claude ${model.family} 5.5 (${model.zh}) (${model.id})`,
        ]) {
            expect(findPricing(key), key).toBe(expected);
        }
        expect(expected).toEqual(model.family === 'Opus'
            ? { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5, thinking: 20 }
            : { input: 2, output: 10, cacheRead: 0.20, cacheWrite: 2.50, thinking: 10 });
    });

    it('does not price a future version or partial family from nearby rows', () => {
        const table = { ...DEFAULT_PRICING, 'claude-sonnet-5': customPrice };
        for (const key of ['claude-opus-5-6', 'claude-opus-5-50', 'claude-opus-5', 'claude-opus', 'Claude Opus 5.6 (High)']) {
            expect(findPricing(key, table), key).toBeNull();
        }
        expect(findPricing('claude-sonnet-5-6-high', table)).toBeNull();
        expect(findPricing('claude-opus-4-6')?.input).toBe(5);
        expect(findPricing('claude-sonnet-4-6')?.input).toBe(3);
    });

    it('isolates custom effort prices, including localized persisted keys', () => {
        const custom = { 'Claude Sonnet 5.5 (低) (M403)': customPrice };
        expect(findPricingWithCustom('claude-sonnet-5-5-low', custom)).toBe(customPrice);
        expect(findPricingWithCustom('MODEL_PLACEHOLDER_M403', custom)).toBe(customPrice);
        expect(findPricingWithCustom('claude-sonnet-5-5-high', custom)).toBe(DEFAULT_PRICING['claude-sonnet-5-5']);
        expect(findPricingWithCustom('claude-sonnet-5-5', custom)).toBe(DEFAULT_PRICING['claude-sonnet-5-5']);
        expect(findPricingWithCustom('claude-sonnet-5-5-high', { 'claude-sonnet-5-5': customPrice })).toBe(customPrice);
    });

    it('honors a concrete-tier override before a shared bare responseModel', () => {
        const summary = { modelBreakdown: {
            'Claude Opus 5.5 (High)': {
                responseModel: 'claude-opus-5-5', totalInputTokens: 1_000_000,
                totalOutputTokens: 0, totalThinkingTokens: 0, totalCacheRead: 0,
            },
        } } as unknown as GMSummary;
        expect(calculateCosts(summary, { 'Claude Opus 5.5 (High)': customPrice }).grandTotal).toBe(11);
    });
});

describe('Claude 5.5 captured, persisted and archived identities', () => {
    it('keeps six GM/DNA efforts separate even with a shared responseModel per family', () => {
        const entries: Record<string, PersistedModelDNA> = {};
        for (const m of CLAUDE_55) {
            const model = `MODEL_PLACEHOLDER_${m.id}`;
            const responseModel = `claude-${m.family.toLowerCase()}-5-5`;
            const call = parseGMEntry({ chatModel: { model, responseModel, usage: {} }, stepIndices: [1] });
            expect(call.model).toBe(model);
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toBe(`Claude ${m.family} 5.5 (${m.tier})`);
            expect(getModelDNAKey(call.modelDisplay, responseModel)).toBe(model);
            entries[model] = {
                displayName: `Claude ${m.family} 5.5 (${m.zh}) (${m.id})`, responseModel,
                apiProvider: 'ANTHROPIC_VERTEX', completionConfig: null, hasSystemPrompt: false,
                toolCount: 0, promptSectionTitles: [],
            };
        }
        const restored = restoreModelDNAState(serializeModelDNAState(entries));
        expect(Object.keys(restored).sort()).toEqual(CLAUDE_55.map(m => `MODEL_PLACEHOLDER_${m.id}`));
    });

    it('records nonzero Opus cost when the call only supplies its concrete model ID', () => {
        const call = parseGMEntry({ chatModel: {
            model: 'MODEL_PLACEHOLDER_M402', usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
            chatStartMetadata: { createdAt: new Date().toISOString() },
        }, stepIndices: [1], executionId: 'opus-55-id-only' });
        const ledger = new DailyLedger();
        expect(ledger.recordCalls([{ call, dedupKey: 'opus-55-id-only' }])).toBe(1);
        const bucket = ledger.getTodayActive()[0];
        expect(bucket.totalEstimatedCost).toBeGreaterThan(0);
        expect(bucket.totalEstimatedCost).toBe(costFromTokens(call, DEFAULT_PRICING['claude-opus-5-5']));
        expect(Object.keys(bucket.modelStats)).toEqual(['Claude Opus 5.5 (High)']);
    });

    it('backfills all six exact prices, preserves tiers and does not overwrite historical costs', () => {
        const state: DailyStoreState = { version: 1, records: { '2026-10-03': {
            date: '2026-10-03', cycles: [{
                startTime: '2026-10-03T00:00:00', endTime: '2026-10-03T23:59:59',
                totalReasoning: 6, totalToolCalls: 0, totalErrors: 0, totalInputTokens: 0,
                totalOutputTokens: 0, estSteps: 0, modelNames: [],
                gmModelStats: Object.fromEntries(CLAUDE_55.map(m => [`Claude ${m.family} 5.5 (${m.zh}) (${m.id})`, {
                    calls: 1, credits: 0, inputTokens: 1_000_000, outputTokens: 500_000,
                    thinkingTokens: 100_000, avgTTFT: 0, cacheHitRate: 0,
                }])),
            }],
        } } };
        const values = new Map<string, unknown>([['dailyStoreState', state]]);
        const store = new DailyStore();
        store.init({ get: <T>(key: string, fallback: T) => (values.get(key) as T) ?? fallback,
            update: async (key: string, value: unknown) => { values.set(key, value); } });
        expect(store.backfillMissingCosts()).toBe(6);
        expect(store.backfillMissingCosts()).toBe(0);
        const sonnet = store.getRecord('2026-10-03')!.cycles[0].gmModelStats!['Claude Sonnet 5.5 (中) (M404)'];
        expect(sonnet.estimatedCost).toBe(7);
        expect(store.backfillMissingCosts({ 'claude-sonnet-5-5': customPrice })).toBe(0);
        expect(store.backfillMissingCosts({ 'claude-sonnet-5-5': customPrice })).toBe(0);
        expect(sonnet.estimatedCost).toBe(7);
        expect(store.getMonthCostBreakdown(2026, 10).models).toHaveLength(6);
        expect(store.getMonthCostBreakdown(2026, 10).grandTotal).toBe(3 * 14 + 3 * 7);
    });
});

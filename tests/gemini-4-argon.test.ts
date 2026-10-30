import { afterEach, describe, expect, it } from 'vitest';
import {
    getContextLimit, getModelBaseName, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, normalizeModelDisplayName, registerResponseModelAlias, resolveModelId,
    setShowModelShortId, updateModelDisplayNames, type ModelConfig,
} from '../src/models';
import { calculateCosts, findPricing, findPricingWithCustom, type ModelPricing } from '../src/pricing-store';
import { DailyLedger } from '../src/daily-ledger';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { expandModelIdsToPool, groupModelIdsByResetPool } from '../src/pool-utils';
import { selectQuotaRows } from '../src/tooltip-budget';
import { parseGMEntry } from '../src/gm/parser';
import { getModelDNAKey, restoreModelDNAState, serializeModelDNAState, type PersistedModelDNA } from '../src/model-dna-store';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { setLanguageToState, type Language } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';

// Sanitized model metadata from the installed Antigravity IDE's read-only
// GetUserStatus/GetAvailableModels agent-hub endpoints, 2026-10-31.
const ARGON = [
    { id: 'M417', tier: 'High', zh: '高', effort: 3 },
    { id: 'M418', tier: 'Medium', zh: '中', effort: 2 },
    { id: 'M419', tier: 'Low', zh: '低', effort: 1 },
] as const;
const customPrice: ModelPricing = { input: 11, output: 22, cacheRead: 0.11, cacheWrite: 13.75, thinking: 22 };
const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

function config(model: string, label: string, isRecommended = false): ModelConfig {
    return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
        supportedMimeTypes: [], isRecommended,
        // Deliberately different reset samples must not split the same provider pool.
        quotaInfo: { remainingFraction: 0.8, resetTime: `${model}-reset` } };
}

afterEach(async () => {
    setShowModelShortId(false);
    updateModelDisplayNames([], { authoritative: true });
    await setLanguageToState('both', state);
});

describe('Gemini 4 Argon identity and verified metadata', () => {
    it.each(ARGON)('$id preserves the effort across aliases, persisted labels and locales', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const label = `Gemini 4 Argon (${model.tier})`;
        const catalog = `gemini-4-argon-${model.tier.toLowerCase()}`;
        const aliases = [id, catalog, catalog.toUpperCase(), label,
            label.replace(model.tier, model.zh), label.replace(`(${model.tier})`, `（${model.zh}）`),
            `  ${label} (${model.id})  `, `Gemini 4 Argon ${model.tier}`];
        expect(getModelDisplayName(id)).toBe(label);
        for (const alias of aliases) {
            expect(resolveModelId(alias), alias).toBe(id);
            expect(getModelBaseName(alias), alias).toBe(label);
            expect(getContextLimit(alias), alias).toBe(255_000);
            expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('gemini');
        }
        expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 256_000, cpThreshold: 50_000,
            maxTokens: 1_048_576, supportsThinking: true });
        expect(guessContextLimitSpec(catalog)).toEqual(guessContextLimitSpec(id));
        expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
            modelId: catalog, displayName: label, apiProvider: 'GOOGLE_GEMINI',
            maxTokens: 1_048_576, maxOutputTokens: 65_536, thinkingLevel: model.effort,
            cpLimit: 256_000, cpThreshold: 50_000, thinkingBudget: 0, supportsThinking: true,
        });
        expect(getModelSpecs().find(s => s.placeholderId === id)?.supportsAdaptiveThinking).toBeUndefined();
    });

    it('does not assign a shared response family to the first observed effort', () => {
        for (const family of ['gemini-4-argon', 'Gemini 4 Argon']) {
            registerResponseModelAlias(family, 'MODEL_PLACEHOLDER_M419');
            expect(resolveModelId(family)).toBeUndefined();
            expect(getQuotaPoolKey(family, 'different-reset')).toBe('gemini');
            expect(getContextLimit(family)).toBe(255_000);
        }
    });

    it('does not match neighboring versions, malformed effort labels or placeholder prefixes', () => {
        for (const key of ['gemini-40-argon-high', 'gemini-4-argon-highest', 'Gemini 4 Argon (Maximum)',
            'MODEL_PLACEHOLDER_M4170', 'MODEL_PLACEHOLDER_M4190']) {
            expect(resolveModelId(key), key).toBeUndefined();
        }
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M4170').cpLimit).toBe(0);
        expect(guessContextLimitSpec('gemini-40-argon-high').cpLimit).toBe(0);
        expect(getModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M318').cpThreshold).toBe(50_000);
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M322').cpThreshold).toBe(140_000);
        expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
    });

    it('preserves live labels and clears them on account changes without losing static history', () => {
        updateModelDisplayNames([config('MODEL_PLACEHOLDER_M418', 'Account Argon Medium')], { authoritative: true });
        expect(normalizeModelDisplayName('gemini-4-argon-medium')).toBe('Account Argon Medium');
        updateModelDisplayNames([], { authoritative: true });
        expect(resolveModelId('Account Argon Medium')).toBeUndefined();
        expect(normalizeModelDisplayName('gemini-4-argon-medium')).toBe('Gemini 4 Argon (Medium)');
        setShowModelShortId(true);
        expect(normalizeModelDisplayName('gemini-4-argon-medium')).toBe('Gemini 4 Argon (Medium) (M418)');
        expect(getModelBaseName('Gemini 4 Argon (中) (M418)')).toBe('Gemini 4 Argon (Medium)');
    });
});

describe('Argon accounting and pricing boundaries', () => {
    it.each(ARGON)('$id remains unpriced unless the user supplies a matching price', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const catalog = `gemini-4-argon-${model.tier.toLowerCase()}`;
        const localized = `Gemini 4 Argon (${model.zh}) (${model.id})`;
        for (const key of [id, catalog, localized, 'gemini-4-argon']) {
            expect(findPricing(key), key).toBeNull();
        }
        expect(findPricingWithCustom(id, { [localized]: customPrice })).toBe(customPrice);
        expect(findPricingWithCustom(catalog, { 'gemini-4-argon': customPrice })).toBe(customPrice);
        expect(findPricing(catalog, { 'gemini-3.8-flash': customPrice })).toBeNull();
        expect(findPricing(catalog, { 'gemini-4': customPrice })).toBeNull();
    });

    it('isolates per-effort custom prices and leaves other efforts unpriced', () => {
        const custom = { 'Gemini 4 Argon (低) (M419)': customPrice };
        expect(findPricingWithCustom('gemini-4-argon-low', custom)).toBe(customPrice);
        expect(findPricingWithCustom('gemini-4-argon-medium', custom)).toBeNull();
        expect(findPricingWithCustom('gemini-4-argon-high', custom)).toBeNull();
        expect(findPricingWithCustom('gemini-4-argon', custom)).toBeNull();
    });

    it('keeps GM and persisted DNA efforts separate with a shared responseModel', () => {
        const entries: Record<string, PersistedModelDNA> = {};
        for (const model of ARGON) {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const call = parseGMEntry({ chatModel: { model: id, responseModel: 'gemini-4-argon', usage: {} }, stepIndices: [1] });
            expect(call.model).toBe(id);
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toBe(`Gemini 4 Argon (${model.tier})`);
            expect(getModelDNAKey(call.modelDisplay, call.responseModel)).toBe(id);
            entries[id] = { displayName: `Gemini 4 Argon (${model.zh}) (${model.id})`,
                responseModel: 'gemini-4-argon', apiProvider: 'GOOGLE_GEMINI', completionConfig: null,
                hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [] };
        }
        const restored = restoreModelDNAState(serializeModelDNAState(entries));
        expect(Object.keys(restored).sort()).toEqual(ARGON.map(m => `MODEL_PLACEHOLDER_${m.id}`));
    });

    it('retains exact tier token totals through ledger restore, deduplication, pricing and archival', () => {
        const ledger = new DailyLedger();
        const entries = ARGON.map((model, index) => ({ dedupKey: `argon-${model.id}`,
            call: { ...parseGMEntry({ executionId: `argon-${model.id}`, stepIndices: [index],
                chatModel: { model: `MODEL_PLACEHOLDER_${model.id}`, responseModel: 'gemini-4-argon',
                    usage: { inputTokens: (index + 1) * 100_000, outputTokens: 1000,
                        thinkingOutputTokens: 100, cacheReadTokens: 50 },
                    chatStartMetadata: { createdAt: new Date().toISOString() } },
            }), accountEmail: 'argon@example.test' } }));
        expect(ledger.recordCalls(entries)).toBe(3);
        const restored = DailyLedger.restore(ledger.serialize());
        expect(restored.recordCalls(entries)).toBe(0);
        const bucket = restored.getAccountActive('argon@example.test')!;
        expect(Object.keys(bucket.modelStats)).toEqual(ARGON.map(m => `Gemini 4 Argon (${m.tier})`));
        expect(bucket.totalInputTokens).toBe(600_000);
        expect(bucket.totalOutputTokens).toBe(3000);
        expect(bucket.totalThinkingTokens).toBe(300);
        expect(bucket.totalEstimatedCost).toBe(0); // unpriced, not a free built-in rate
        const custom = Object.fromEntries(ARGON.map((model, index) => [
            `Gemini 4 Argon (${model.zh}) (${model.id})`,
            { input: index + 1, output: 10, thinking: 20, cacheRead: 0.5, cacheWrite: 0 },
        ]));
        const archive = buildGMSummaryFromLedger(restored.rollover(), custom);
        const cost = calculateCosts(archive.summary, custom);
        expect(cost.rows).toHaveLength(3);
        expect(archive.totalCost).toBeCloseTo(1.433075, 8);
        expect(cost.grandTotal).toBeCloseTo(archive.totalCost, 8);
        expect(cost.rows.map(row => row.inputTokens).sort((a, b) => a - b)).toEqual([100_000, 200_000, 300_000]);
        expect(cost.rows.every(row => row.pricing !== null)).toBe(true);
    });

    it('groups all Argon efforts with Gemini Flash without merging the premium pool', () => {
        const configs = ARGON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Argon (${m.tier})`));
        configs.push(config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
            config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)'));
        const expected = ['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M418', 'MODEL_PLACEHOLDER_M419', 'MODEL_PLACEHOLDER_M318'];
        expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M417'], configs)).toEqual(expected);
        const groups = groupModelIdsByResetPool(['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M402'], configs);
        expect(groups).toEqual([expected, ['MODEL_PLACEHOLDER_M402']]);
    });
});

describe('Argon model and tooltip presentation', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders only account-available Argon efforts in %s', async language => {
        await setLanguageToState(language, state);
        const configs = ARGON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Argon (${m.tier})`));
        const html = buildModelsTabContent(null, configs);
        expect(html.match(/class="spec-card"/g)).toHaveLength(3);
        for (const model of ARGON) {
            expect(html).toContain(`Gemini 4 Argon (${model.tier})`);
            expect(html).toContain(`gemini-4-argon-${model.tier.toLowerCase()}`);
        }
        expect(html).toContain('256,000');
        expect(html).toContain('1,048,576');
        expect(html).toContain(language === 'zh' ? '支持 · 预算未指定' : 'Supported · Budget unspecified');
        expect(html).not.toContain('Gemini 3.8 Flash');
        expect(html).not.toContain('Claude');
        const empty = buildModelsTabContent(null, []);
        expect(empty).not.toContain('Gemini 4 Argon');
    });

    it('prefers live recommendations and the current tier over a newer generation', () => {
        const configs = [config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
            ...ARGON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Argon (${m.tier})`, m.tier === 'Medium'))];
        expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M418');
        expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M419', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M419');
        expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M318', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M318');
        const unflagged = configs.map(c => ({ ...c, isRecommended: false }));
        expect(selectQuotaRows(unflagged, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M417');
        expect(selectQuotaRows(unflagged, '', 3).rows[0].label).toBe('Gemini 4 Argon (High) · 4');
    });
});

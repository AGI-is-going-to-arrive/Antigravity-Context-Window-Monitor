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
// GetUserStatus/GetAvailableModels agent-hub endpoints, 2026-11-11.
const CARBON = [
    { id: 'M427', tier: 'High', zh: '高', effort: 3 },
    { id: 'M437', tier: 'Medium', zh: '中', effort: 2 },
    { id: 'M438', tier: 'Low', zh: '低', effort: 1 },
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

describe('Gemini 4 Carbon identity and verified metadata', () => {
    it.each(CARBON)('$id preserves the effort across aliases, persisted labels and locales', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const label = `Gemini 4 Carbon (${model.tier})`;
        const catalog = `gemini-4-carbon-${model.tier.toLowerCase()}`;
        const aliases = [id, catalog, catalog.toUpperCase(), label,
            label.replace(model.tier, model.zh), label.replace(`(${model.tier})`, `（${model.zh}）`),
            `  ${label} (${model.id})  `, `Gemini 4 Carbon ${model.tier}`];
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
            maxTokens: 1_048_576, maxOutputTokens: 262_144, thinkingLevel: model.effort,
            cpLimit: 256_000, cpThreshold: 50_000, thinkingBudget: 0, supportsThinking: true,
        });
        expect(getModelSpecs().find(s => s.placeholderId === id)?.supportsAdaptiveThinking).toBeUndefined();
    });

    it('does not assign a shared response family to the first observed effort', () => {
        for (const family of ['gemini-4-carbon', 'Gemini 4 Carbon', 'GEMINI_4_CARBON']) {
            for (const model of CARBON) {
                registerResponseModelAlias(family, `MODEL_PLACEHOLDER_${model.id}`);
            }
            expect(resolveModelId(family)).toBeUndefined();
            expect(getQuotaPoolKey(family, 'different-reset')).toBe('gemini');
            expect(getContextLimit(family)).toBe(255_000);
            const responseOnly = parseGMEntry({ chatModel: { responseModel: family, usage: {} }, stepIndices: [1] });
            expect(responseOnly.model).toBe('');
            expect(responseOnly.modelSource).toBe('unknown');
        }
    });

    it('does not match neighboring versions, malformed effort labels or placeholder prefixes', () => {
        for (const key of ['gemini-40-carbon-high', 'gemini-4-carbon-highest', 'Gemini 4 Carbon (Maximum)',
            'gemini-4-carbonated-high', 'Gemini 4 CarbonHigh', 'Gemini 4 Carbon (High',
            'Gemini 4 Carbon High)', 'MODEL_PLACEHOLDER_M4270', 'MODEL_PLACEHOLDER_M4370', 'MODEL_PLACEHOLDER_M4380']) {
            expect(resolveModelId(key), key).toBeUndefined();
            expect(guessContextLimitSpec(key).cpLimit, key).toBe(0);
        }
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M4270').cpLimit).toBe(0);
        expect(guessContextLimitSpec('gemini-40-carbon-high').cpLimit).toBe(0);
        expect(getModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M318').cpThreshold).toBe(50_000);
        expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M322').cpThreshold).toBe(140_000);
        expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
        expect(resolveModelId('gemini-4-argon-high')).toBe('MODEL_PLACEHOLDER_M417');
        expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M417')?.maxOutputTokens).toBe(65_536);
    });

    it('does not let a conflicting GM sample remap a registered tier across efforts or families', () => {
        registerResponseModelAlias('gemini-4-carbon-low', 'MODEL_PLACEHOLDER_M427');
        registerResponseModelAlias('gemini-4-carbon-low', 'MODEL_PLACEHOLDER_M419');
        registerResponseModelAlias('gemini-4-argon-low', 'MODEL_PLACEHOLDER_M438');
        expect(resolveModelId('gemini-4-carbon-low')).toBe('MODEL_PLACEHOLDER_M438');
        expect(resolveModelId('gemini-4-argon-low')).toBe('MODEL_PLACEHOLDER_M419');
    });

    it.each([
        { family: 'Carbon', id: 'M427', tier: 'High', zh: '高', otherTier: 'M438', otherFamily: 'M417' },
        { family: 'Carbon', id: 'M437', tier: 'Medium', zh: '中', otherTier: 'M427', otherFamily: 'M418' },
        { family: 'Carbon', id: 'M438', tier: 'Low', zh: '低', otherTier: 'M427', otherFamily: 'M419' },
        { family: 'Argon', id: 'M417', tier: 'High', zh: '高', otherTier: 'M419', otherFamily: 'M427' },
        { family: 'Argon', id: 'M418', tier: 'Medium', zh: '中', otherTier: 'M417', otherFamily: 'M437' },
        { family: 'Argon', id: 'M419', tier: 'Low', zh: '低', otherTier: 'M417', otherFamily: 'M438' },
    ])('$family $tier cannot be remapped through a different spelling of its known identity', model => {
        const expected = `MODEL_PLACEHOLDER_${model.id}`;
        for (const alias of [
            `GEMINI_4_${model.family.toUpperCase()}_${model.tier.toUpperCase()}`,
            `Gemini 4 ${model.family} ${model.tier.toUpperCase()}`,
            `Gemini 4 ${model.family}（${model.zh}）`,
            `Gemini 4 ${model.family} (${model.zh}) (${model.id})`,
        ]) {
            expect(resolveModelId(alias), alias).toBe(expected);
            for (const wrongId of [model.otherTier, model.otherFamily]) {
                registerResponseModelAlias(alias, `MODEL_PLACEHOLDER_${wrongId}`);
                expect(resolveModelId(alias), `${alias} -> ${wrongId}`).toBe(expected);
                const responseOnly = parseGMEntry({ chatModel: { responseModel: alias, usage: {} }, stepIndices: [1] });
                expect(responseOnly.model).toBe(expected);
            }
            registerResponseModelAlias(alias, expected);
            expect(resolveModelId(alias)).toBe(expected);
        }
    });

    it('still learns unknown aliases and defers to authoritative live labels during a renumber', () => {
        const alias = 'fixture-carbon-live-renumber';
        expect(resolveModelId(alias)).toBeUndefined();
        registerResponseModelAlias(alias, 'MODEL_PLACEHOLDER_M438');
        expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M438');
        updateModelDisplayNames([config('MODEL_PLACEHOLDER_M9090', alias)], { authoritative: true });
        expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M9090');
        registerResponseModelAlias(alias, 'MODEL_PLACEHOLDER_M9090');
        registerResponseModelAlias(alias, 'MODEL_PLACEHOLDER_M438');
        expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M9090');
        updateModelDisplayNames([], { authoritative: true });
        expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M9090');
    });

    it('preserves live labels and clears them on account changes without losing static history', () => {
        updateModelDisplayNames([config('MODEL_PLACEHOLDER_M437', 'Account Carbon Medium')], { authoritative: true });
        expect(normalizeModelDisplayName('gemini-4-carbon-medium')).toBe('Account Carbon Medium');
        updateModelDisplayNames([], { authoritative: true });
        expect(resolveModelId('Account Carbon Medium')).toBeUndefined();
        expect(normalizeModelDisplayName('gemini-4-carbon-medium')).toBe('Gemini 4 Carbon (Medium)');
        setShowModelShortId(true);
        expect(normalizeModelDisplayName('gemini-4-carbon-medium')).toBe('Gemini 4 Carbon (Medium) (M437)');
        expect(getModelBaseName('Gemini 4 Carbon (中) (M437)')).toBe('Gemini 4 Carbon (Medium)');
    });
});

describe('Carbon accounting and pricing boundaries', () => {
    it.each(CARBON)('$id isolates pricing from Argon, Flash and unrelated Gemini families', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const catalog = `gemini-4-carbon-${model.tier.toLowerCase()}`;
        const localized = `Gemini 4 Carbon (${model.zh}) (${model.id})`;
        for (const key of [id, catalog, localized, 'gemini-4-carbon']) {
            expect(findPricing(key, { 'gemini-4-argon': customPrice }), key).toBeNull();
            expect(findPricing(key, { 'gemini-3.8-flash': customPrice }), key).toBeNull();
            expect(findPricing(key, { 'gemini-4': customPrice }), key).toBeNull();
        }
        expect(findPricingWithCustom(id, { [localized]: customPrice })).toBe(customPrice);
        expect(findPricingWithCustom(catalog, { 'gemini-4-carbon': customPrice })).toBe(customPrice);
    });

    it('keeps a custom Low price scoped to that effort and family', () => {
        const custom = { 'Gemini 4 Carbon (低) (M438)': customPrice };
        expect(findPricingWithCustom('gemini-4-carbon-low', custom, {})).toBe(customPrice);
        for (const model of ['gemini-4-carbon-medium', 'gemini-4-carbon-high', 'gemini-4-carbon',
            'gemini-4-argon-low', 'gemini-3.8-flash-low']) {
            expect(findPricingWithCustom(model, custom, {}), model).toBeNull();
        }
    });

    it('keeps GM and persisted DNA efforts separate with a shared responseModel', () => {
        const entries: Record<string, PersistedModelDNA> = {};
        for (const model of CARBON) {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const call = parseGMEntry({ chatModel: { model: id, responseModel: 'gemini-4-carbon', usage: {} }, stepIndices: [1] });
            expect(call.model).toBe(id);
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toBe(`Gemini 4 Carbon (${model.tier})`);
            expect(getModelDNAKey(call.modelDisplay, call.responseModel)).toBe(id);
            entries[id] = { displayName: `Gemini 4 Carbon (${model.zh}) (${model.id})`,
                responseModel: 'gemini-4-carbon', apiProvider: 'GOOGLE_GEMINI', completionConfig: null,
                hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [] };
        }
        const restored = restoreModelDNAState(serializeModelDNAState(entries));
        expect(Object.keys(restored).sort()).toEqual(CARBON.map(m => `MODEL_PLACEHOLDER_${m.id}`));
    });

    it('retains exact tier token totals through ledger restore, deduplication, pricing and archival', () => {
        const ledger = new DailyLedger();
        const entries = CARBON.map((model, index) => ({ dedupKey: `carbon-${model.id}`,
            call: { ...parseGMEntry({ executionId: `carbon-${model.id}`, stepIndices: [index],
                chatModel: { model: `MODEL_PLACEHOLDER_${model.id}`, responseModel: 'gemini-4-carbon',
                    usage: { inputTokens: (index + 1) * 100_000, outputTokens: 1000,
                        thinkingOutputTokens: 100, cacheReadTokens: 50 },
                    chatStartMetadata: { createdAt: new Date().toISOString() } },
            }), accountEmail: 'carbon@example.test' } }));
        expect(ledger.recordCalls(entries)).toBe(3);
        const restored = DailyLedger.restore(ledger.serialize());
        expect(restored.recordCalls(entries)).toBe(0);
        const bucket = restored.getAccountActive('carbon@example.test')!;
        expect(Object.keys(bucket.modelStats)).toEqual(CARBON.map(m => `Gemini 4 Carbon (${m.tier})`));
        expect(bucket.totalInputTokens).toBe(600_000);
        expect(bucket.totalOutputTokens).toBe(3000);
        expect(bucket.totalThinkingTokens).toBe(300);
        const custom = Object.fromEntries(CARBON.map((model, index) => [
            `Gemini 4 Carbon (${model.zh}) (${model.id})`,
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

    it('groups all Carbon efforts with Gemini Flash without merging the premium pool', () => {
        const configs = CARBON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Carbon (${m.tier})`));
        configs.push(config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
            config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)'));
        const expected = ['MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M437', 'MODEL_PLACEHOLDER_M438', 'MODEL_PLACEHOLDER_M318'];
        expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M427'], configs)).toEqual(expected);
        const groups = groupModelIdsByResetPool(['MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M402'], configs);
        expect(groups).toEqual([expected, ['MODEL_PLACEHOLDER_M402']]);
    });
});

describe('Carbon model and tooltip presentation', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders only account-available Carbon efforts in %s', async language => {
        await setLanguageToState(language, state);
        const configs = CARBON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Carbon (${m.tier})`));
        const html = buildModelsTabContent(null, configs);
        expect(html.match(/class="spec-card"/g)).toHaveLength(3);
        for (const model of CARBON) {
            expect(html).toContain(`Gemini 4 Carbon (${model.tier})`);
            expect(html).toContain(`gemini-4-carbon-${model.tier.toLowerCase()}`);
        }
        expect(html).toContain('256,000');
        expect(html).toContain('1,048,576');
        expect(html).toContain('262,144');
        expect(html).toContain(language === 'zh' ? '支持 · 预算未指定' : 'Supported · Budget unspecified');
        expect(html).not.toContain('Gemini 3.8 Flash');
        expect(html).not.toContain('Claude');
        expect(html).not.toContain('Gemini 4 Argon');
        const mediumOnly = buildModelsTabContent(null, [configs[1]]);
        expect(mediumOnly.match(/class="spec-card"/g)).toHaveLength(1);
        expect(mediumOnly).toContain('gemini-4-carbon-medium');
        expect(mediumOnly).not.toContain('gemini-4-carbon-high');
        expect(mediumOnly).not.toContain('gemini-4-carbon-low');
        const empty = buildModelsTabContent(null, []);
        expect(empty).not.toContain('Gemini 4 Carbon');
    });

    it('prefers live recommendations and the current tier over a newer generation', () => {
        const configs = [config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
            config('MODEL_PLACEHOLDER_M417', 'Gemini 4 Argon (High)'),
            ...CARBON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Carbon (${m.tier})`, m.tier === 'Medium'))];
        expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M437');
        expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M438', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M438');
        expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M318', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M318');
        expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M417', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M417');
        expect(selectQuotaRows(configs, '', 3).rows[0].poolSize).toBe(5);
    });
});

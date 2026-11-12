import { afterEach, describe, expect, it } from 'vitest';
import {
    getContextLimit, getModelBaseName, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, normalizeModelDisplayName, registerResponseModelAlias, resolveModelId,
    setShowModelShortId, updateModelDisplayNames, updateModelSpec, type ModelConfig,
} from '../src/models';
import { DailyLedger } from '../src/daily-ledger';
import { groupModelQuotas } from '../src/model-quota';
import { expandModelIdsToPool } from '../src/pool-utils';
import { selectQuotaRows } from '../src/tooltip-budget';
import { parseGMEntry } from '../src/gm/parser';
import { getModelDNAKey, restoreModelDNAState, serializeModelDNAState, type PersistedModelDNA } from '../src/model-dna-store';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { buildModelQuotaGrid } from '../src/webview-profile-tab';
import { setLanguageToState, type Language } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';

// Sanitized fields from the running IDE GetAvailableModels/GetUserStatus, 2026-11-13.
// Extra is the picker label; XHigh and level 100 are the backend identity.
const HYDROGEN = [
    { id: 'M527', tier: 'Low', zh: '低', level: 1 },
    { id: 'M526', tier: 'Medium', zh: '中', level: 2 },
    { id: 'M525', tier: 'High', zh: '高', level: 3 },
    { id: 'M528', tier: 'XHigh', zh: '超高', level: 100 },
] as const;
const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const RESET = '2026-11-13T12:00:00Z';
function config(model: string, label: string, isRecommended = false): ModelConfig {
    return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
        supportedMimeTypes: [], isRecommended, quotaInfo: { remainingFraction: 0.8, resetTime: RESET } };
}
const configs = () => HYDROGEN.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Hydrogen (${m.tier})`));

afterEach(async () => {
    setShowModelShortId(false);
    updateModelDisplayNames([], { authoritative: true });
    await setLanguageToState('both', state);
});

describe('Hydrogen verified identities and context', () => {
    it.each(HYDROGEN)('$tier resolves persisted, localized, catalog and picker spellings independently', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const catalog = `gemini-4-hydrogen-${model.tier.toLowerCase()}`;
        const label = `Gemini 4 Hydrogen (${model.tier})`;
        for (const alias of [id, catalog, catalog.toUpperCase(), catalog.replace(/-/g, '_'), label,
            `Gemini 4 Hydrogen ${model.tier}`, `Gemini 4 Hydrogen (${model.zh})`,
            `Gemini 4 Hydrogen（${model.zh}）`, `  ${label} (${model.id})  `,
            `Gemini 4 Hydrogen（${model.zh}）（${model.id}）`]) {
            expect(resolveModelId(alias), alias).toBe(id);
            expect(getModelBaseName(alias), alias).toBe(label);
            expect(getContextLimit(alias), alias).toBe(255_000);
            expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('gemini');
        }
        expect(getModelDisplayName(id)).toBe(label);
        expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 256_000, cpThreshold: 50_000,
            maxTokens: 1_048_576, supportsThinking: true });
        expect(guessContextLimitSpec(catalog)).toEqual(guessContextLimitSpec(id));
        expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
            modelId: catalog, displayName: label, apiProvider: 'GOOGLE_GEMINI',
            maxTokens: 1_048_576, maxOutputTokens: 262_144, thinkingLevel: model.level,
            thinkingBudget: 0, supportsThinking: true, cpLimit: 256_000, cpThreshold: 50_000,
        });
    });

    it.each(['Extra', 'Extra High', 'extra-high', 'extra_high', 'XHigh', '超高', '极高'])(
        'maps the %s picker/localized alias to XHigh, never High', effort => {
            for (const name of [`Gemini 4 Hydrogen ${effort}`, `Gemini 4 Hydrogen (${effort})`]) {
                expect(resolveModelId(name)).toBe('MODEL_PLACEHOLDER_M528');
                expect(guessContextLimitSpec(name).cpThreshold).toBe(50_000);
            }
        },
    );

    it.each(['gemini-40-hydrogen-high', 'gemini-4-hydrogenated-high', 'gemini-4-hydrogen-highest',
        'Gemini 4 HydrogenHigh', 'Gemini 4 Hydrogen (High', 'Gemini 4 Hydrogen High)',
        'Gemini 4 Hydrogen (Extra High', 'Gemini 4 Hydrogen (Maximum)', 'Gemini 4 Hydrogen (XHighExtra)',
        'Gemini 4 Hydrogen (Extra High) trailing', 'MODEL_PLACEHOLDER_M5250', 'MODEL_PLACEHOLDER_M5260',
        'MODEL_PLACEHOLDER_M5270', 'MODEL_PLACEHOLDER_M5280', 'Gemini 4 Carbon (Extra)', 'Gemini 4 Argon (XHigh)'])(
        'leaves malformed or unverified identity %s unresolved', key => {
            expect(resolveModelId(key)).toBeUndefined();
            expect(guessContextLimitSpec(key).cpLimit).toBe(0);
        },
    );

    it('does not learn a shared response family as the first observed tier', () => {
        for (const family of ['gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'GEMINI_4_HYDROGEN']) {
            for (const model of HYDROGEN) registerResponseModelAlias(family, `MODEL_PLACEHOLDER_${model.id}`);
            expect(resolveModelId(family)).toBeUndefined();
            expect(getContextLimit(family)).toBe(255_000);
            expect(getQuotaPoolKey(family)).toBe('gemini');
            const call = parseGMEntry({ chatModel: { responseModel: family, usage: {} }, stepIndices: [1] });
            expect(call.model).toBe('');
            expect(call.modelSource).toBe('unknown');
        }
    });

    it.each(HYDROGEN)('$tier cannot be reassigned by a conflicting GM alias', model => {
        const id = `MODEL_PLACEHOLDER_${model.id}`;
        const aliases = [`gemini-4-hydrogen-${model.tier.toLowerCase()}`, `GEMINI_4_HYDROGEN_${model.tier.toUpperCase()}`,
            `Gemini 4 Hydrogen（${model.zh}）`, `Gemini 4 Hydrogen (${model.zh}) (${model.id})`];
        if (model.tier === 'XHigh') aliases.push('Gemini 4 Hydrogen Extra', 'gemini-4-hydrogen-extra-high');
        for (const alias of aliases) {
            for (const wrong of [...HYDROGEN.map(m => `MODEL_PLACEHOLDER_${m.id}`), 'MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M417']) {
                registerResponseModelAlias(alias, wrong);
                expect(resolveModelId(alias)).toBe(id);
            }
        }
    });

    it('resets account labels and preserves history, diagnostic IDs and tier identity', () => {
        updateModelDisplayNames([config('MODEL_PLACEHOLDER_M528', 'Account Hydrogen Extra')], { authoritative: true });
        expect(normalizeModelDisplayName('gemini-4-hydrogen-xhigh')).toBe('Account Hydrogen Extra');
        updateModelDisplayNames([], { authoritative: true });
        expect(resolveModelId('Account Hydrogen Extra')).toBeUndefined();
        expect(getModelBaseName('Gemini 4 Hydrogen (超高) (M528)')).toBe('Gemini 4 Hydrogen (XHigh)');
        setShowModelShortId(true);
        expect(normalizeModelDisplayName('gemini-4-hydrogen-extra')).toBe('Gemini 4 Hydrogen (XHigh) (M528)');
        expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M417')?.maxOutputTokens).toBe(65_536);
        expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
    });
});

describe('Hydrogen shared quota without merged accounting', () => {
    it('groups all four efforts into one Gemini family and never adds percentages', () => {
        const all = [...configs(), config('MODEL_PLACEHOLDER_M438', 'Gemini 4 Carbon (Low)'),
            config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)'),
            config('MODEL_PLACEHOLDER_M667', 'Orchestrator')];
        const groups = groupModelQuotas(all);
        expect(groups).toHaveLength(3);
        const gemini = groups.find(g => g.pool === 'gemini')!;
        expect(gemini.minimum).toBe(0.8);
        expect(gemini.maximum).toBe(0.8);
        expect(gemini.members[0].label).toBe('Gemini 4 Hydrogen');
        expect(gemini.members[0].efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
        expect(gemini.members[0].readings.map(r => r.model)).toEqual(HYDROGEN.map(m => `MODEL_PLACEHOLDER_${m.id}`));
        expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M528'], all)).toEqual(['MODEL_PLACEHOLDER_M528', ...HYDROGEN.slice(0, 3).map(m => `MODEL_PLACEHOLDER_${m.id}`), 'MODEL_PLACEHOLDER_M438']);
        expect(groups.find(g => g.label === 'Orchestrator')?.pool).toBeUndefined();
    });

    it.each(['API_PROVIDER_GOOGLE_GEMINI', 'ANTHROPIC_VERTEX', 'OPENAI_VERTEX'])(
        'does not infer an unverified model quota pool from provider %s', apiProvider => {
            // The current IDE includes a new Orchestrator; equal reset readings
            // and a Google provider do not prove membership in the Gemini pool.
            const id = 'MODEL_PLACEHOLDER_M667';
            updateModelSpec(id, { modelId: 'gemini-pro-orchestrator', displayName: 'Orchestrator', apiProvider });
            registerResponseModelAlias('gemini-pro-orchestrator', id);
            try {
                expect(getQuotaPoolKey(id)).toBe(id);
                expect(getQuotaPoolKey('gemini-pro-orchestrator')).toBe('gemini-pro-orchestrator');
                expect(getQuotaPoolKey(id, RESET)).toBe(RESET);
                const all = [...configs(), config(id, 'Orchestrator')];
                expect(groupModelQuotas(all)).toHaveLength(2);
                expect(groupModelQuotas(all).find(g => g.label === 'Orchestrator')?.pool).toBeUndefined();
                expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M528'], all)).not.toContain(id);
            } finally {
                updateModelSpec(id, { apiProvider: '' });
            }
        },
    );

    it.each([
        { catalog: 'gemini-fixture-future-high', provider: 'API_PROVIDER_GOOGLE_GEMINI', pool: 'gemini' },
        { catalog: 'claude-fixture-future-high', provider: 'ANTHROPIC_VERTEX', pool: 'premium' },
        { catalog: 'gpt-oss-fixture-medium', provider: 'OPENAI_VERTEX', pool: 'premium' },
    ])('preserves future $catalog pooling when its provider also matches', ({ catalog, provider, pool }) => {
        const id = 'MODEL_PLACEHOLDER_M9955';
        updateModelSpec(id, { modelId: catalog, apiProvider: provider });
        expect(getQuotaPoolKey(id, RESET)).toBe(pool);
        updateModelSpec(id, { apiProvider: pool === 'gemini' ? 'ANTHROPIC_VERTEX' : 'GOOGLE_GEMINI' });
        expect(getQuotaPoolKey(id)).toBe(id);
        updateModelSpec(id, { modelId: 'unbranded-orchestrator', displayName: 'Gemini 4 Hydrogen Extra', apiProvider: provider });
        expect(getQuotaPoolKey(id)).toBe(id);
    });

    it.each(['Extra', 'Extra High', 'XHigh', '超高', '极高'])('strips only the known %s effort from the live family label', effort => {
        for (const label of [`Account Hydrogen (${effort}) (M528)`, `Account Hydrogen ${effort}`, `Account Hydrogen（${effort}）（M528）`]) {
            const member = groupModelQuotas([config('MODEL_PLACEHOLDER_M528', label)])[0].members[0];
            expect(member.label).toBe('Account Hydrogen');
            expect(member.efforts).toEqual(['xhigh']);
        }
    });

    it('keeps absent Extra unknown and exposes missing/conflicting quota without manufacturing a fourth tier', () => {
        const partial = configs().slice(0, 3);
        expect(groupModelQuotas(partial)[0].members[0].efforts).toEqual(['low', 'medium', 'high']);
        const extra = configs()[3];
        extra.quotaInfo = undefined;
        const group = groupModelQuotas([...partial, extra])[0];
        expect(group.missingQuota).toBe(true);
        expect(group.minimum).toBe(0.8);
        expect(group.members[0].readings[3].remaining).toBeNull();
        extra.quotaInfo = { remainingFraction: 0, resetTime: '2026-11-13T13:00:00Z' };
        const differing = groupModelQuotas([...partial, extra])[0];
        expect(differing.minimum).toBe(0);
        expect(differing.maximum).toBe(0.8);
        expect(differing.quotaDiffers).toBe(true);
        expect(differing.resetDiffers).toBe(true);
    });

    it('deduplicates Extra/XHigh aliases but retains conflicting readings', () => {
        const list = [config('gemini-4-hydrogen-xhigh', 'Gemini 4 Hydrogen (XHigh)'),
            config('Gemini 4 Hydrogen Extra', 'Gemini 4 Hydrogen Extra'), configs()[3]];
        expect(groupModelQuotas(list)[0].readings).toHaveLength(1);
        list[2].quotaInfo = { remainingFraction: 0.2, resetTime: RESET };
        const group = groupModelQuotas(list)[0];
        expect(group.readings).toHaveLength(2);
        expect(group.quotaDiffers).toBe(true);
    });

    it('preserves all four GM and DNA identities when the response reports only the family', () => {
        const entries: Record<string, PersistedModelDNA> = {};
        for (const model of HYDROGEN) {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const call = parseGMEntry({ chatModel: { model: id, responseModel: 'gemini-4-hydrogen', usage: {} }, stepIndices: [1] });
            expect(call.model).toBe(id);
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toBe(`Gemini 4 Hydrogen (${model.tier})`);
            expect(getModelDNAKey(call.modelDisplay, call.responseModel)).toBe(id);
            entries[id] = { displayName: `Gemini 4 Hydrogen (${model.zh}) (${model.id})`,
                responseModel: 'gemini-4-hydrogen', apiProvider: 'GOOGLE_GEMINI', completionConfig: null,
                hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [] };
        }
        expect(Object.keys(restoreModelDNAState(serializeModelDNAState(entries))).sort()).toEqual(Object.keys(entries).sort());
    });

    it('retains exact per-tier and account totals through ledger restoration and duplicate polling', () => {
        const entries = HYDROGEN.map((model, index) => ({ dedupKey: `hydrogen-${model.id}`,
            call: { ...parseGMEntry({ executionId: `hydrogen-${model.id}`, stepIndices: [index],
                chatModel: { model: `MODEL_PLACEHOLDER_${model.id}`, responseModel: 'gemini-4-hydrogen',
                    usage: { inputTokens: (index + 1) * 100, outputTokens: 10, thinkingOutputTokens: index, cacheReadTokens: 50 },
                    chatStartMetadata: { createdAt: new Date().toISOString() } },
            }), accountEmail: 'hydrogen@example.test' } }));
        const ledger = new DailyLedger();
        expect(ledger.recordCalls(entries)).toBe(4);
        const restored = DailyLedger.restore(ledger.serialize());
        expect(restored.recordCalls(entries)).toBe(0);
        const account = restored.getAccountActive('hydrogen@example.test')!;
        expect(Object.keys(account.modelStats)).toEqual(HYDROGEN.map(m => `Gemini 4 Hydrogen (${m.tier})`));
        expect(account.totalInputTokens).toBe(1000);
        expect(account.totalOutputTokens).toBe(40);
        expect(account.totalThinkingTokens).toBe(6);
        expect(restored.getAccountActive('other@example.test')).toBeNull();
    });
});

describe('Hydrogen available catalog and multilingual presentation', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders four real efforts and Extra quota label in %s', async language => {
        await setLanguageToState(language, state);
        const html = buildModelsTabContent(null, configs());
        expect(html.match(/class="spec-card"/g)).toHaveLength(4);
        for (const model of HYDROGEN) {
            expect(html).toContain(`Gemini 4 Hydrogen (${model.tier})`);
            expect(html).toContain(`gemini-4-hydrogen-${model.tier.toLowerCase()}`);
        }
        for (const value of ['1,048,576', '262,144', '256,000', '50,000']) expect(html).toContain(value);
        const quota = buildModelQuotaGrid(configs());
        expect(quota).toContain(language === 'zh' ? '低 · 中 · 高 · 超高' : 'Low · Medium · High · Extra');
        expect(quota).not.toContain('undefined');
        const extraOnly = buildModelsTabContent(null, [configs()[3]]);
        expect(extraOnly.match(/class="spec-card"/g)).toHaveLength(1);
        expect(extraOnly).toContain('gemini-4-hydrogen-xhigh');
        expect(extraOnly).not.toContain('gemini-4-hydrogen-high');
        expect(buildModelsTabContent(null, [])).not.toContain('Gemini 4 Hydrogen');
    });

    it('sorts the new family first while retaining recommendation and current-model precedence', () => {
        const ids = getModelSpecs().map(s => s.placeholderId);
        expect(ids.slice(0, 4)).toEqual(['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M525', 'MODEL_PLACEHOLDER_M526', 'MODEL_PLACEHOLDER_M527']);
        const all = [config('MODEL_PLACEHOLDER_M427', 'Gemini 4 Carbon (High)'),
            config('MODEL_PLACEHOLDER_M417', 'Gemini 4 Argon (High)'), ...configs()];
        expect(selectQuotaRows(all, '', 3).rows[0].label).toMatch(/^Gemini 4 Hydrogen/);
        all[0].isRecommended = true;
        expect(selectQuotaRows(all, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M427');
        for (const model of HYDROGEN) {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            expect(selectQuotaRows(all, id, 3).rows[0].model).toBe(id);
        }
    });
});

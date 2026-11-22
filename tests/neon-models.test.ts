import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGMDataTabContent } from '../src/activity-panel';
import { DailyLedger } from '../src/daily-ledger';
import { fetchAndOverrideCheckpointerLimits } from '../src/extension';
import { applyTrajectoryModelHints, parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { setLanguageToState, type Language } from '../src/i18n';
import { getModelDNAKey } from '../src/model-dna-store';
import { groupModelQuotas } from '../src/model-quota';
import {
    DEFAULT_CONTEXT_LIMITS, getContextLimit, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, normalizeModelDisplayName, overrideContextLimits, registerResponseModelAlias,
    resolveModelId, updateModelDisplayNames, updateModelSpec, type ModelConfig,
} from '../src/models';
import { buildPricingTabContent } from '../src/pricing-panel';
import { calculateCosts, DEFAULT_PRICING, findPricingWithCustom, PricingStore } from '../src/pricing-store';
import { rpcCall } from '../src/rpc-client';
import { buildModelsTabContent } from '../src/webview-models-tab';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));

// Sanitized metadata from the running IDE catalog on 2026-11-19.
const tiers = [
    { id: 'MODEL_PLACEHOLDER_M534', slug: 'low', label: 'Low', zh: '低', level: 1 },
    { id: 'MODEL_PLACEHOLDER_M533', slug: 'medium', label: 'Medium', zh: '中', level: 2 },
    { id: 'MODEL_PLACEHOLDER_M532', slug: 'high', label: 'High', zh: '高', level: 3 },
    { id: 'MODEL_PLACEHOLDER_M535', slug: 'xhigh', label: 'XHigh', zh: '超高', level: 100 },
] as const;
const orchestrator = 'MODEL_PLACEHOLDER_M537';
const worker = 'MODEL_PLACEHOLDER_M669';
const carbon = 'MODEL_PLACEHOLDER_M667';
const argon = 'MODEL_PLACEHOLDER_M681';
const catalog = [
    ...tiers.map(tier => ({ id: tier.id, key: `gemini-4-neon-${tier.slug}`, name: `Gemini 4 Neon (${tier.label})`, level: tier.level })),
    { id: orchestrator, key: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)', level: 100 },
];
const rate = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0, thinking: 10 };
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const limits = { ...DEFAULT_CONTEXT_LIMITS };
const specs = getModelSpecs().map(spec => ({ ...spec }));
const resetTime = '2026-11-19T06:00:00Z';

function config(model: string, label = getModelDisplayName(model)): ModelConfig {
    return {
        model, label, supportsImages: true, isRecommended: true, supportedMimeTypes: [],
        mimeTypeCount: 0, allowedTiers: [], quotaInfo: { remainingFraction: 0.65, resetTime },
    };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T03:00:00Z'));
});

afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    for (const spec of specs) { updateModelSpec(spec.placeholderId, spec); }
    for (const key of Object.keys(DEFAULT_CONTEXT_LIMITS)) {
        if (!Object.hasOwn(limits, key)) { delete DEFAULT_CONTEXT_LIMITS[key]; }
    }
    overrideContextLimits(limits);
    updateModelDisplayNames([], { authoritative: true });
    await setLanguageToState('both', state);
});

describe('Neon model identities', () => {
    it.each(catalog)('retains the verified $key identity, capabilities and cold-start context', model => {
        for (const alias of [model.id, model.key, model.key.toUpperCase(), model.name, `${model.name} (${model.id.slice('MODEL_PLACEHOLDER_'.length)})`]) {
            expect(resolveModelId(alias), alias).toBe(model.id);
            expect(getContextLimit(alias), alias).toBe(511000);
            expect(getQuotaPoolKey(alias), alias).toBe('gemini');
        }
        expect(guessContextLimitSpec(model.key)).toEqual({
            cpLimit: 512000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true,
        });
        expect(getModelSpecs().find(spec => spec.placeholderId === model.id)).toMatchObject({
            modelId: model.key, displayName: model.name, maxTokens: 1048576, maxOutputTokens: 262144,
            cpLimit: 512000, cpThreshold: 50000, thinkingLevel: model.level, thinkingBudget: 0,
            ...(model.id === orchestrator ? { executionModelId: worker } : {}),
        });
    });

    it.each(tiers)('resolves localized $label aliases without reassignment by a conflicting response', tier => {
        for (const alias of [`Gemini 4 Neon ${tier.label}`, `Gemini 4 Neon（${tier.zh}）`]) {
            registerResponseModelAlias(alias, orchestrator);
            expect(resolveModelId(alias)).toBe(tier.id);
        }
    });

    it.each(['Extra', 'Extra High', 'extra-high', 'XHigh', '超高', '极高'])('maps %s to only M535', effort => {
        expect(resolveModelId(`Gemini 4 Neon (${effort})`)).toBe('MODEL_PLACEHOLDER_M535');
    });

    it.each(['Orchestrator Neon', '编排器（Neon）', '协调器 (Neon)', 'ORCHESTRATOR_NEON'])('resolves the fixed coordinator alias %s', alias => {
        expect(resolveModelId(alias)).toBe(orchestrator);
    });

    it.each([
        'Gemini 4 NeonHigh', 'Gemini 4 Neon (Maximum)', 'Gemini 4 Neon (Extra',
        'gemini-4-neon-extra-garbage', 'Gemini 4 Neon (Extra)X', 'MODEL_PLACEHOLDER_M5350',
        'Orchestrator (Neon High)', 'OrchestratorNeon', 'Orchestrator Neon)',
        'Orchestrator (Neon) Extra', 'gemini-pro-orchestrator-neon-low',
    ])('leaves malformed or unsupported variants unresolved: %s', alias => {
        expect(resolveModelId(alias)).toBeUndefined();
        expect(findPricingWithCustom(alias, {
            'gemini-4-neon': rate, 'gemini-pro-orchestrator-neon': rate, Orchestrator: rate,
        })).toBeNull();
    });

    it('keeps a bare Neon family response shared for quota and ambiguous for call attribution', () => {
        for (const alias of ['Gemini 4 Neon', 'GEMINI_4_NEON', 'gemini-4-neon']) {
            for (const { id } of tiers) { registerResponseModelAlias(alias, id); }
            expect(resolveModelId(alias)).toBeUndefined();
            expect(getQuotaPoolKey(alias)).toBe('gemini');
        }
        expect(resolveModelId('Orchestrator')).toBe(carbon);
        expect(resolveModelId('Orchestrator (Argon)')).toBe(argon);
    });

    it('adopts live limits and routes while retaining the legacy coordinator IDs', async () => {
        const models = Object.fromEntries([
            ...catalog,
            { id: carbon, key: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)', level: 3 },
            { id: argon, key: 'gemini-pro-orchestrator-argon', name: 'Orchestrator (Argon)', level: 3 },
            { id: worker, key: 'gemini-flash-worker-agy', name: 'Gemini Flash (Orchestrator Worker)', level: 100 },
        ].map(model => [model.key, {
            model: model.id, displayName: model.name, apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            maxTokens: 1048576, maxOutputTokens: model.id === argon ? 65536 : 262144,
            supportsThinking: true, thinkingLevel: model.level, minThinkingBudget: 32,
            modelExperiments: { experiments: {
                CASCADE_USE_EXPERIMENT_CHECKPOINTER: { stringValue: '{"max_token_limit":"512000","token_threshold":"50000"}' },
                ...(model.key.startsWith('gemini-pro-orchestrator')
                    ? { 'plan-execute-config': { stringValue: JSON.stringify({ executionModel: worker }) } } : {}),
            } },
        }]));
        vi.mocked(rpcCall).mockResolvedValueOnce({ response: { models } });
        expect(await fetchAndOverrideCheckpointerLimits({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false }, () => {})).toBe(true);
        for (const [key, model] of Object.entries(models)) {
            expect(getContextLimit(key)).toBe(512000);
            expect(getModelSpecs().find(spec => spec.placeholderId === model.model)).toMatchObject({
                modelId: key, thinkingLevel: model.thinkingLevel, thinkingBudget: 0,
                maxOutputTokens: model.maxOutputTokens, cpLimit: 512000, cpThreshold: 50000,
            });
        }
        expect(getModelSpecs().find(spec => spec.placeholderId === orchestrator)?.executionModelId).toBe(worker);
    });

    it('prioritizes Neon in the static ordering without conflating effort IDs', () => {
        const names = getModelSpecs().filter(spec => spec.modelId.startsWith('gemini-4-')).map(spec => spec.modelId);
        expect(names.slice(0, 4)).toEqual(['gemini-4-neon-xhigh', 'gemini-4-neon-high', 'gemini-4-neon-medium', 'gemini-4-neon-low']);
    });
});

describe('Neon quota and presentation', () => {
    it('groups four efforts and one fixed coordinator in the existing Gemini pool', () => {
        const [pool] = groupModelQuotas([...catalog.map(model => config(model.id)), config(carbon), config(argon)]);
        expect(pool.pool).toBe('gemini');
        expect(pool.readings).toHaveLength(7);
        expect(pool.minimum).toBe(0.65);
        expect(pool.maximum).toBe(0.65);
        expect(pool.members.find(member => member.label === 'Gemini 4 Neon')?.efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
        expect(pool.members.map(member => member.label)).not.toContain(getModelDisplayName(worker));
        expect(pool.members.find(member => member.label === 'Orchestrator (Neon)')?.efforts).toEqual([]);
    });

    it('uses only account-visible tiers and preserves missing/conflicting samples', () => {
        const extra = config('Gemini 4 Neon Extra', 'Gemini 4 Neon Extra');
        const same = config(tiers[3].id);
        expect(groupModelQuotas([extra, same])[0].readings).toHaveLength(1);
        same.quotaInfo = { remainingFraction: 0, resetTime: '2026-11-19T07:00:00Z' };
        const missing = config(orchestrator);
        delete missing.quotaInfo;
        const [pool] = groupModelQuotas([extra, same, missing]);
        expect(pool.members[0].efforts).toEqual(['xhigh']);
        expect(pool.minimum).toBe(0);
        expect(pool.maximum).toBe(0.65);
        expect(pool.quotaDiffers).toBe(true);
        expect(pool.resetDiffers).toBe(true);
        expect(pool.missingQuota).toBe(true);
        expect(pool.missingReset).toBe(true);
    });

    it.each(['en', 'zh', 'both'] as Language[])('localizes Neon effort and the configured route in %s', async lang => {
        await setLanguageToState(lang, state);
        const configs = catalog.map(model => config(model.id));
        const html = buildModelsTabContent(null, configs);
        expect(html.match(/class="spec-card"/g)).toHaveLength(5);
        for (const tier of tiers) {
            const en = tier.label === 'XHigh' ? 'Extra High' : tier.label;
            const display = lang === 'en' ? en : lang === 'zh' ? tier.zh : `${en} / ${tier.zh}`;
            expect(html).toContain(`<h3 class="spec-name">Gemini 4 Neon (${display})</h3>`);
        }
        expect(html).toContain('Orchestrator (Neon)');
        expect(html).toContain(lang === 'zh' ? '配置的执行模型' : 'Configured execution model');
        expect(html).toContain('gemini-flash-worker-agy');
        expect(html).not.toContain(`data-model-id="${worker}"`);
        expect(html).toContain('512,000');
        expect(buildModelsTabContent(null, [])).not.toContain('Gemini 4 Neon');
    });

    it('honors account labels during an authoritative catalog change', () => {
        const custom = config(tiers[3].id, 'Account Preview <Neon>');
        updateModelDisplayNames([custom], { authoritative: true });
        expect(normalizeModelDisplayName('gemini-4-neon-xhigh')).toBe(custom.label);
        expect(buildModelsTabContent(null, [custom])).toContain('Account Preview &lt;Neon&gt;');
        updateModelDisplayNames([], { authoritative: true });
        expect(resolveModelId(custom.label)).toBeUndefined();
        expect(normalizeModelDisplayName('gemini-4-neon-xhigh')).toBe('Gemini 4 Neon (XHigh)');
    });

    it('resolves and prices bilingual slash picker labels while rejecting contradictory tier pairs', () => {
        expect(resolveModelId('Gemini 4 Neon (Extra High / 超高)')).toBe('MODEL_PLACEHOLDER_M535');
        expect(resolveModelId('Gemini 4 Hydrogen (Extra High / 超高)')).toBe('MODEL_PLACEHOLDER_M528');
        expect(resolveModelId('Gemini 4 Carbon (High / 高)')).toBe('MODEL_PLACEHOLDER_M427');
        expect(resolveModelId('Gemini 4 Argon (Low / 低)')).toBe('MODEL_PLACEHOLDER_M419');
        expect(findPricingWithCustom('Gemini 4 Neon (Extra High / 超高)', {})).toEqual(DEFAULT_PRICING['gemini-4-neon']);
        expect(resolveModelId('Gemini 4 Neon (High / 低)')).toBeUndefined();
    });
});

describe('Neon accounting and cost editors', () => {
    it.each(catalog)('only uses a verified identity override for $key', model => {
        const otherRates = {
            'gemini-4-carbon': rate, 'gemini-4-argon': rate, 'gemini-4-hydrogen': rate,
            Orchestrator: rate, 'gemini-pro-orchestrator-argon': rate, 'gemini-flash-worker-agy': rate,
        };
        // Default mapped mode maps M537 -> Neon base rate (never leaking Carbon/Argon/other overrides)
        expect(findPricingWithCustom(model.id, otherRates, DEFAULT_PRICING, 'mapped')).toEqual(
            DEFAULT_PRICING['gemini-4-neon'],
        );
        // Strict mode keeps M537 unpriced unless explicitly overridden
        expect(findPricingWithCustom(model.id, otherRates, DEFAULT_PRICING, 'strict')).toEqual(
            model.id === orchestrator ? null : DEFAULT_PRICING['gemini-4-neon'],
        );
        expect(findPricingWithCustom(model.id, { [model.key]: rate })).toEqual(rate);
        expect(findPricingWithCustom(carbon, { [model.key]: rate }, {})).toBeNull();
        expect(findPricingWithCustom(worker, { [model.key]: rate }, {})).toBeNull();
    });

    it('keeps the configured coordinator and actual execution model distinct in GM, DNA and restored ledger', () => {
        const ids = [...catalog.map(model => model.id), worker];
        const calls = ids.map((id, index) => {
            const responseModel = id === worker ? 'gemini-pro-orchestrator-neon' : 'gemini-4-neon';
            const call = parseGMEntry({
                executionId: 'fixture-execution', stepIndices: [index + 1],
                chatModel: { model: id, responseModel, usage: { inputTokens: 100, outputTokens: 10 },
                    chatStartMetadata: { createdAt: new Date().toISOString() } },
            });
            return { ...call, accountEmail: 'neon@example.test' };
        });
        const resolvedCalls = applyTrajectoryModelHints(calls, [
            { type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { model: orchestrator } },
        ]);
        expect(resolvedCalls.map(call => call.model)).toEqual(ids);
        expect(resolvedCalls.map(call => getModelDNAKey(call.modelDisplay, call.responseModel))).toEqual(ids);
        const ledger = new DailyLedger();
        const entries = resolvedCalls.map((call, index) => ({ dedupKey: `neon-${index}`, call }));
        expect(ledger.recordCalls(entries)).toBe(6);
        const restored = DailyLedger.restore(ledger.serialize());
        expect(restored.recordCalls(entries)).toBe(0);
        expect(Object.keys(restored.getAccountActive('neon@example.test')!.modelStats)).toEqual(ids.map(getModelDisplayName));
    });

    it('never adopts a conflicting responseModel rate; maps to Neon in mapped mode and stays unpriced in strict mode', () => {
        const responseModel = 'gemini-4-carbon-low';
        const timestamp = new Date().toISOString();
        const call = parseGMEntry({
            stepIndices: [1], chatModel: { model: orchestrator, responseModel,
                usage: { inputTokens: 1000, outputTokens: 100 },
                chatStartMetadata: { createdAt: timestamp } },
        });
        const summary = buildSummaryFromConversations([{
            cascadeId: 'fixture', calls: [call], title: '', totalSteps: 1,
            coveredSteps: 1, coverageRate: 1, checkpointSummaries: [],
        }], timestamp)!;
        expect(summary.modelBreakdown['Orchestrator (Neon)'].responseModel).toBe(responseModel);
        // Mapped mode (default): M537 maps to Neon ($3/$15), NOT conflicting responseModel Carbon ($2/$10)!
        const mapped = calculateCosts(summary, {}, 'mapped');
        expect(mapped.rows[0].pricing).toEqual(DEFAULT_PRICING['gemini-4-neon']);
        expect(mapped.rows[0].provenance).toBe('mapped_base');
        expect(mapped.grandTotal).toBeCloseTo((1000 * 3 + 100 * 15) / 1e6, 10);

        // Strict mode: stays strictly unpriced even though responseModel is a priced model
        expect(calculateCosts(summary, {}, 'strict').rows[0].pricing).toBeNull();
        expect(calculateCosts(summary, {}, 'strict').grandTotal).toBe(0);
        const ledger = new DailyLedger();
        expect(ledger.recordCalls([{ dedupKey: 'mapped-neon', call: { ...call, accountEmail: 'neon@example.test' } }])).toBe(1);
        expect(ledger.getAccountActive('neon@example.test')?.totalEstimatedCost).toBeCloseTo((1000 * 3 + 100 * 15) / 1e6, 10);

        // Recovery still works when old data has no resolvable display identity.
        const fallback = { ...summary, modelBreakdown: {
            'Old untranslated label': summary.modelBreakdown['Orchestrator (Neon)'],
        } };
        expect(calculateCosts(fallback, { [responseModel]: rate }).grandTotal).toBeGreaterThan(0);
    });

    it('keeps official Neon family editor, saved per-tier overrides, and unpriced Orchestrator/worker rows stable before and after calls', async () => {
        const store = new PricingStore();
        const savedKey = 'Gemini 4 Neon（超高）';
        await store.set(savedKey, rate);
        const call = parseGMEntry({ stepIndices: [1], chatModel: {
            model: tiers[3].id, responseModel: 'gemini-4-neon-xhigh', usage: { inputTokens: 100, outputTokens: 10 },
        } });
        const summary = buildSummaryFromConversations([{
            cascadeId: 'fixture', calls: [call], title: '', totalSteps: 1,
            coveredSteps: 1, coverageRate: 1, checkpointSummaries: [],
        }], new Date().toISOString())!;
        expect(calculateCosts(summary, store.getCustom()).rows[0].pricing).toEqual(rate);
        // Official gemini-4-neon family + saved per-tier alias + unpriced Orchestrator (Neon) & worker M669
        for (const html of [buildPricingTabContent(null, store), buildPricingTabContent(summary, store)]) {
            for (const key of ['gemini-4-neon', savedKey, 'gemini-pro-orchestrator-neon', 'gemini-flash-worker-agy']) {
                expect(html.split(`data-model="${key}"`).length - 1, key).toBe(4);
            }
            expect(html).not.toContain('data-model="gemini-4-neon-xhigh"');
        }
        // Default mapped mode maps M537 -> Neon and M669 -> Hydrogen; strict mode keeps both unpriced
        expect(findPricingWithCustom(orchestrator, {}, DEFAULT_PRICING, 'mapped')).toEqual(DEFAULT_PRICING['gemini-4-neon']);
        expect(findPricingWithCustom(worker, {}, DEFAULT_PRICING, 'mapped')).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);
        expect(findPricingWithCustom(orchestrator, {}, DEFAULT_PRICING, 'strict')).toBeNull();
        expect(findPricingWithCustom(worker, {}, DEFAULT_PRICING, 'strict')).toBeNull();
        expect(findPricingWithCustom(tiers[3].id, {})).toEqual(DEFAULT_PRICING['gemini-4-neon']);
    });
});

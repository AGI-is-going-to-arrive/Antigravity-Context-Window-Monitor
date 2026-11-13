import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTEXT_LIMITS, getContextLimit, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, normalizeModelDisplayName, registerResponseModelAlias, resolveModelId,
    updateModelDisplayNames, updateModelSpec, overrideContextLimits, type ModelConfig } from '../src/models';
import { fetchAndOverrideCheckpointerLimits, measuredContextDrop } from '../src/extension';
import { rpcCall } from '../src/rpc-client';
import { parseGMEntry, applyTrajectoryModelHints } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { calculateCosts, findPricingWithCustom, PricingStore } from '../src/pricing-store';
import { buildPricingTabContent } from '../src/pricing-panel';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { groupModelQuotas } from '../src/model-quota';
import { setLanguageToState, type Language } from '../src/i18n';
import { DailyLedger } from '../src/daily-ledger';
import { processSteps } from '../src/tracker';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));
const carbon = 'MODEL_PLACEHOLDER_M667', argon = 'MODEL_PLACEHOLDER_M681', worker = 'MODEL_PLACEHOLDER_M669';
const identities = [
    { id: carbon, catalog: 'gemini-pro-orchestrator', label: 'Orchestrator (Carbon)', output: 262144 },
    { id: argon, catalog: 'gemini-pro-orchestrator-argon', label: 'Orchestrator (Argon)', output: 65536 },
    { id: worker, catalog: 'gemini-flash-worker-agy', label: 'Gemini Flash (Orchestrator Worker)', output: 262144 },
];
const saved = getModelSpecs().map(s => ({ ...s })), limits = { ...DEFAULT_CONTEXT_LIMITS };
const state = { get: <T>(_k: string, d: T) => d, update: async () => {} };
const cfg = (model: string, label = getModelDisplayName(model)): ModelConfig => ({ model, label,
    supportsImages: true, allowedTiers: [], supportedMimeTypes: [], mimeTypeCount: 0, isRecommended: false,
    quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-14T00:00:00Z' } });
const rate = { input: 2, output: 10, thinking: 10, cacheRead: 0.1, cacheWrite: 0 };
afterEach(async () => {
    saved.forEach(s => updateModelSpec(s.placeholderId, { ...s }));
    overrideContextLimits(limits); updateModelDisplayNames([], { authoritative: true });
    vi.clearAllMocks(); await setLanguageToState('both', state);
});

describe('Orchestrator Carbon/Argon split', () => {
    it.each(identities)('resolves $label and preserves verified independent limits', ({ id, catalog, label, output }) => {
        for (const alias of [id, catalog, catalog.toUpperCase(), label, label.toLowerCase(), `${label} (${id.slice(18)})`]) {
            expect(resolveModelId(alias), alias).toBe(id);
            expect(getContextLimit(alias)).toBe(255000);
            expect(getQuotaPoolKey(alias)).toBe('gemini');
        }
        expect(guessContextLimitSpec(catalog)).toEqual({ cpLimit: 256000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true });
        expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({ maxOutputTokens: output, thinkingLevel: 3, thinkingBudget: 0 });
    });
    it.each(['Orchestrator', '编排器', '协调器', 'Orchestrator Carbon', '协调器（Carbon）', 'ORCHESTRATOR_CARBON'])('preserves Carbon history %s', alias => {
        expect(resolveModelId(alias)).toBe(carbon);
        expect(normalizeModelDisplayName(alias)).toBe('Orchestrator (Carbon)');
    });
    it.each(['Orchestrator Argon', '编排器（Argon）', '协调器 (Argon)', 'ORCHESTRATOR_ARGON', 'GEMINI_PRO_ORCHESTRATOR_ARGON'])('resolves localized Argon %s', alias => expect(resolveModelId(alias)).toBe(argon));
    it.each(['Orchestrator (Argon', 'Orchestrator Argon)', 'OrchestratorArgon', 'Orchestrator (Argon High)',
        'Orchestrator (Carbon) High', 'Orchestrator (Hydrogen)', 'gemini-pro-orchestrator-argon-high',
        'gemini-pro-orchestrator-carbon', 'Orchestrator (Argon)<script>', '__proto__', 'constructor'])('rejects invented identity and rates: %s', alias => {
        expect(resolveModelId(alias)).toBeUndefined();
        expect(findPricingWithCustom(alias, { Orchestrator: rate, 'Orchestrator (Carbon)': rate, 'Orchestrator (Argon)': rate })).toBeNull();
    });
    it('never learns conflicting coordinator or worker aliases from a routed response', () => {
        for (const { id, catalog, label } of identities) {
            for (const wrong of [carbon, argon, worker].filter(k => k !== id)) {
                registerResponseModelAlias(catalog, wrong); registerResponseModelAlias(label.toUpperCase(), wrong);
                expect(resolveModelId(catalog)).toBe(id); expect(resolveModelId(label.toUpperCase())).toBe(id);
                const c = parseGMEntry({ chatModel: { model: wrong, responseModel: catalog, usage: {} }, stepIndices: [1] });
                expect(applyTrajectoryModelHints([c], [{ type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { model: id } }])[0].model).toBe(wrong);
            }
        }
    });
    it('syncs different output limits and the shared route from live-shaped metadata', async () => {
        const models = Object.fromEntries(identities.map(m => [m.catalog, { model: m.id, displayName: m.label,
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI', maxTokens: 1048576, maxOutputTokens: m.output,
            supportsThinking: true, thinkingLevel: 3, minThinkingBudget: m.id === carbon ? 128 : 32,
            modelExperiments: { experiments: { CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: '{"max_token_limit":"256000","token_threshold":"50000"}' },
                ...(m.id === worker ? {} : { 'plan-execute-config': { stringValue: JSON.stringify({ executionModel: worker }) } }) } } }]));
        vi.mocked(rpcCall).mockResolvedValueOnce({ response: { models } });
        expect(await fetchAndOverrideCheckpointerLimits({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false }, () => {})).toBe(true);
        for (const m of identities) {
            expect(getContextLimit(m.id)).toBe(256000);
            expect(getModelSpecs().find(s => s.placeholderId === m.id)).toMatchObject({ modelId: m.catalog, maxOutputTokens: m.output,
                executionModelId: m.id === worker ? undefined : worker });
        }
    });
    it('keeps current, legacy, partial and empty account catalogs authoritative', () => {
        for (const configs of [[cfg(carbon), cfg(argon)], [cfg(argon)], [cfg(carbon, 'Orchestrator')], []]) {
            updateModelDisplayNames(configs, { authoritative: true });
            const html = buildModelsTabContent(null, configs);
            expect((html.match(/class="spec-card"/g) || []).length).toBe(configs.length);
            expect(html).not.toContain('data-model-id="MODEL_PLACEHOLDER_M669"');
        }
        expect(resolveModelId('Orchestrator')).toBe(carbon);
        expect(getModelDisplayName(argon)).toBe('Orchestrator (Argon)');
    });
    it('groups both coordinators into Gemini without doubling or averaging allowance', () => {
        const a = cfg(carbon), b = cfg(argon); b.quotaInfo!.remainingFraction = 0.2;
        const [pool] = groupModelQuotas([a, b, cfg('MODEL_PLACEHOLDER_M528')]);
        expect(pool.pool).toBe('gemini'); expect(pool.minimum).toBe(0.2); expect(pool.maximum).toBe(0.8);
        expect(pool.members.filter(m => m.label.startsWith('Orchestrator')).map(m => m.efforts)).toEqual([[], []]);
        delete b.quotaInfo;
        expect(groupModelQuotas([a, b])[0].missingQuota).toBe(true);
    });
    it.each(['Orchestrator', 'orchestrator', 'Orchestrator (Carbon)', 'gemini-pro-orchestrator', carbon])('never shares old custom rate %s with Argon/worker', key => {
        expect(findPricingWithCustom(carbon, { [key]: rate })).toEqual(rate);
        expect(findPricingWithCustom(argon, { [key]: rate })).toBeNull();
        expect(findPricingWithCustom(worker, { [key]: rate })).toBeNull();
    });
    it.each(identities)('keeps $label unpriced regardless of ordinary family rates', m => {
        expect(findPricingWithCustom(m.id, { 'gemini-4-carbon': rate, 'gemini-4-argon': rate, 'gemini-4-hydrogen': rate })).toBeNull();
        expect(findPricingWithCustom(m.id, { [m.catalog]: rate })).toEqual(rate);
    });
    it.each(['en', 'zh', 'both'] as Language[])('renders both routes, separate price editors and localized empty state in %s', async lang => {
        await setLanguageToState(lang, state);
        const html = buildModelsTabContent(null, [cfg(carbon), cfg(argon)]);
        expect(html.match(/class="spec-card"/g)).toHaveLength(2);
        expect(html).toContain('Orchestrator (Carbon)'); expect(html).toContain('Orchestrator (Argon)');
        expect(html).toContain('65,536'); expect(html).toContain('262,144');
        expect(html).toContain(lang === 'zh' ? '配置的执行模型' : 'Configured execution model');
        const price = buildPricingTabContent(null, new PricingStore());
        for (const m of identities) expect(price).toContain(`data-model="${m.catalog}"`);
        expect(buildModelsTabContent(null, [])).not.toContain('spec-orchestration');
    });
    it('persists all actual model calls separately across reload and model transitions', () => {
        const calls = identities.map((m, i) => parseGMEntry({ executionId: 'same-workflow', stepIndices: [i + 1],
            chatModel: { model: m.id, responseModel: m.catalog, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, thinkingOutputTokens: 20 },
                chatStartMetadata: { createdAt: '2026-11-13T00:00:00Z' } } }));
        const summary = buildSummaryFromConversations([{ cascadeId: 'test', title: 'synthetic', totalSteps: 3, coveredSteps: 3, coverageRate: 1, calls, checkpointSummaries: [] }], '2026-11-13T00:01:00Z')!;
        const priced = calculateCosts(summary, { 'gemini-pro-orchestrator-argon': rate });
        expect(priced.rows).toHaveLength(3); expect(priced.rows.filter(r => r.pricing)).toHaveLength(1);
        expect(priced.grandTotal).toBeCloseTo(0.00305, 10);
        const ledger = new DailyLedger(), entries = calls.map((c, i) => ({ dedupKey: `split-${i}`, call: { ...c, accountEmail: 'test@example.test' } }));
        expect(ledger.recordCalls(entries)).toBe(3);
        const restored = DailyLedger.restore(ledger.serialize()); expect(restored.recordCalls(entries)).toBe(0);
        expect(Object.keys(restored.getAccountActive('test@example.test')!.modelStats)).toHaveLength(3);
        const snapshot = (requested: string, actual: string, input: number) => ({ ...processSteps([{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            metadata: { generatorModel: actual, requestedModel: { model: requested }, modelUsage: { model: actual, inputTokens: input, outputTokens: 100 } } }]), contextLimit: 256000 });
        expect(measuredContextDrop(snapshot(carbon, carbon, 20000), snapshot(argon, argon, 10000), false)).toBe(0);
        expect(measuredContextDrop(snapshot(argon, argon, 20000), snapshot(argon, worker, 10000), false)).toBe(0);
    });
});

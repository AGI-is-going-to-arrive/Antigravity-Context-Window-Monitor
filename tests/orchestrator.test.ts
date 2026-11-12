import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTEXT_LIMITS, getContextLimit, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, normalizeModelDisplayName, registerResponseModelAlias, resolveModelId,
    updateModelDisplayNames, updateModelSpec, overrideContextLimits, type ModelConfig } from '../src/models';
import { processSteps } from '../src/tracker';
import { fetchAndOverrideCheckpointerLimits, measuredContextDrop } from '../src/extension';
import { rpcCall } from '../src/rpc-client';
import { parseGMEntry, applyTrajectoryModelHints, maybeEnrichCallsFromTrajectory, buildGMMatchKey } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { calculateCosts, findPricingWithCustom, PricingStore } from '../src/pricing-store';
import { buildPricingTabContent } from '../src/pricing-panel';
import { buildModelsTabContent, buildModelInfoGrid } from '../src/webview-models-tab';
import { groupModelQuotas } from '../src/model-quota';
import { setLanguageToState, type Language } from '../src/i18n';
import { DailyLedger } from '../src/daily-ledger';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));
const coordinator = 'MODEL_PLACEHOLDER_M667';
const worker = 'MODEL_PLACEHOLDER_M669';
const original = getModelSpecs().map(s => ({ ...s }));
const limits = { ...DEFAULT_CONTEXT_LIMITS };
const state = { get: <T>(_k: string, d: T) => d, update: async () => {} };
const ls = { pid: 1, port: 1, csrfToken: 'fixture', useTls: false };
const cfg = (model = coordinator, label = getModelDisplayName(model)): ModelConfig => ({ model, label,
    supportsImages: true, allowedTiers: [], supportedMimeTypes: [], mimeTypeCount: 0, isRecommended: false,
    quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-14T00:00:00Z' } });
const spec = (id = coordinator) => getModelSpecs().find(s => s.placeholderId === id)!;
afterEach(async () => {
    vi.clearAllMocks();
    original.forEach(s => updateModelSpec(s.placeholderId, { ...s, executionModelId: s.executionModelId }));
    overrideContextLimits(limits);
    updateModelDisplayNames([], { authoritative: true });
    await setLanguageToState('both', state);
});

const identities = [
    { id: coordinator, catalog: 'gemini-pro-orchestrator', label: 'Orchestrator' },
    { id: worker, catalog: 'gemini-flash-worker-agy', label: 'Gemini Flash (Orchestrator Worker)' },
];
describe('Orchestrator and catalog-only worker', () => {
    it.each(identities)('recognizes $catalog before a live catalog is available', ({ id, catalog, label }) => {
        updateModelDisplayNames([], { authoritative: true });
        for (const alias of [id, catalog, catalog.toUpperCase(), label, `${label} (${id.slice(18)})`]) {
            expect(resolveModelId(alias), alias).toBe(id);
            expect(getContextLimit(alias), alias).toBe(255000);
        }
        expect(spec(id)).toMatchObject({ maxTokens: 1048576, maxOutputTokens: 262144,
            cpLimit: 256000, cpThreshold: 50000, thinkingLevel: 3, thinkingBudget: 0, supportsThinking: true });
        expect(guessContextLimitSpec(catalog)).toMatchObject({ cpLimit: 256000, cpThreshold: 50000 });
    });
    it.each(['Orchestrator (High)', 'Orchestrator Extra', 'orchestrators', 'gemini-pro-orchestrator-high',
        'gemini-flash-worker-agy-high', 'Gemini Flash', 'gemini-pro-orchestrator<script>'])(
        'does not invent an effort/alias for %s', name => expect(resolveModelId(name)).toBeUndefined());
    it.each(['编排器', '协调器', 'ORCHESTRATOR', ' Orchestrator (M667) '])('normalizes %s', name => {
        expect(normalizeModelDisplayName(name)).toBe('Orchestrator');
    });
    it('does not let routing or conflicting response samples rewrite either actual model', () => {
        registerResponseModelAlias('gemini-pro-orchestrator', worker);
        registerResponseModelAlias('gemini-flash-worker-agy', coordinator);
        registerResponseModelAlias('GEMINI_PRO_ORCHESTRATOR', 'MODEL_PLACEHOLDER_M427');
        expect(resolveModelId('gemini-pro-orchestrator')).toBe(coordinator);
        expect(resolveModelId('gemini-flash-worker-agy')).toBe(worker);
        const parsed = parseGMEntry({ chatModel: { model: worker, responseModel: 'gemini-pro-orchestrator', usage: {} }, stepIndices: [1] });
        expect(parsed.model).toBe(worker);
        expect(applyTrajectoryModelHints([parsed], [{ type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: { model: coordinator } }])[0].model).toBe(worker);
    });
    it('keeps stable quota identities across equal reset timestamps and account aliases', () => {
        for (const { id, catalog } of identities) {
            expect(getQuotaPoolKey(catalog, 'same-reset')).toBe('gemini');
            expect(getQuotaPoolKey(id, 'same-reset')).toBe('gemini');
        }
        const groups = groupModelQuotas([cfg(), cfg(worker), cfg('MODEL_PLACEHOLDER_M528')]);
        expect(groups).toHaveLength(1);
        expect(groups.find(g => g.pool === 'gemini')!.readings).toHaveLength(3);
        expect(groups[0].minimum).toBe(0.8);
        expect(groups[0].members.find(m => m.label === 'Orchestrator')?.efforts).toEqual([]);
    });
});

const full = (plan?: unknown) => ({ model: coordinator, apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    maxTokens: 1048576, maxOutputTokens: 262144, supportsThinking: true, thinkingLevel: 3,
    modelExperiments: { experiments: { CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
        stringValue: '{"max_token_limit":"256000","token_threshold":"50000"}' },
        ...(plan === undefined ? {} : { 'plan-execute-config': { stringValue: plan } }) } } });
async function sync(metadata: unknown, updated = true) {
    vi.mocked(rpcCall).mockResolvedValueOnce({ models: { 'gemini-pro-orchestrator': metadata } });
    expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(updated);
}
describe('live execution metadata', () => {
    it('updates a configured worker without relabeling the coordinator', async () => {
        await sync(full(JSON.stringify({ executionModel: 'MODEL_PLACEHOLDER_M9999' })));
        expect(spec().executionModelId).toBe('MODEL_PLACEHOLDER_M9999');
        expect(spec().modelId).toBe('gemini-pro-orchestrator');
        expect(getContextLimit(coordinator)).toBe(256000);
        await sync(full(JSON.stringify({ executionModel: worker })));
        expect(spec().executionModelId).toBe(worker);
    });
    it('clears a removed route from complete metadata', async () => {
        await sync(full());
        expect(spec().executionModelId).toBeUndefined();
    });
    it('preserves a route when the response is partial', async () => {
        await sync({ model: coordinator }, false);
        expect(spec().executionModelId).toBe(worker);
    });
    it.each(['{', 'null', '[]', '"text"', '{"executionModel":3}',
        '{"executionModel":"MODEL_UNSPECIFIED"}', '{"executionModel":"MODEL_PLACEHOLDER_M667"}',
        '{"executionModel":"<script>"}', '{"executionModel":" MODEL_PLACEHOLDER_M669 "}'])(
        'rejects malformed route %s without erasing verified metadata', async plan => {
            await sync(full(plan)); expect(spec().executionModelId).toBe(worker);
        });
});

function summary() {
    const calls = identities.map(({ id, catalog }, i) => ({ ...parseGMEntry({ executionId: `orchestrator-${i}`,
        stepIndices: [i + 1], chatModel: { model: id, responseModel: catalog,
            usage: { inputTokens: 1000, outputTokens: 100, thinkingOutputTokens: 20, cacheReadTokens: 500 },
            chatStartMetadata: { createdAt: '2026-11-13T00:00:00Z' } } }), accountEmail: 'fixture@example.test' }));
    return buildSummaryFromConversations([{ cascadeId: 'fixture', title: 'synthetic', totalSteps: 2,
        coveredSteps: 2, coverageRate: 1, calls, checkpointSummaries: [] }], '2026-11-13T00:01:00Z')!;
}
describe('Orchestrator accounting and presentation', () => {
    it('keeps unknown rates explicit and custom coordinator/worker rates separate', () => {
        const rate = { input: 2, output: 10, thinking: 10, cacheRead: 0.1, cacheWrite: 0 };
        for (const { id, catalog } of identities) {
            expect(findPricingWithCustom(id, {})).toBeNull();
            expect(findPricingWithCustom(catalog, { 'gemini-4-carbon': rate, 'gemini-4-hydrogen': rate })).toBeNull();
        }
        const custom = { 'gemini-pro-orchestrator': rate };
        expect(findPricingWithCustom(coordinator, custom)).toEqual(rate);
        expect(findPricingWithCustom(worker, custom)).toBeNull();
        const result = calculateCosts(summary(), custom);
        expect(result.rows).toHaveLength(2);
        expect(result.grandTotal).toBeCloseTo(0.00305, 10);
        expect(result.rows.filter(r => !r.pricing)).toHaveLength(1);
    });
    it('persists both actual calls without adding a call for the configured route', () => {
        const s = summary();
        const ledger = new DailyLedger();
        const entries = s.conversations[0].calls.map((call, i) => ({ dedupKey: `orchestrator-${i}`, call }));
        expect(ledger.recordCalls(entries)).toBe(2);
        const restored = DailyLedger.restore(ledger.serialize());
        expect(restored.recordCalls(entries)).toBe(0);
        const bucket = restored.getAccountActive('fixture@example.test')!;
        expect(bucket.totalCalls).toBe(2);
        expect(Object.keys(bucket.modelStats)).toHaveLength(2);
    });
    it.each(['en', 'zh', 'both'] as Language[])('renders a localized route, not a selectable worker, in %s', async language => {
        await setLanguageToState(language, state);
        const html = buildModelsTabContent(null, [cfg()]);
        expect(html.match(/class="spec-card"/g)).toHaveLength(1);
        expect(html).toContain('gemini-pro-orchestrator');
        expect(html).toContain('gemini-flash-worker-agy');
        expect(html).toContain(language === 'zh' ? '配置的执行模型' : 'Configured execution model');
        expect(html).toContain('1,048,576 / 262,144');
        expect(buildModelsTabContent(null, [])).not.toContain('spec-orchestration');
        const pricing = buildPricingTabContent(summary(), new PricingStore());
        expect(pricing).toContain('data-model="gemini-pro-orchestrator"');
        expect(pricing).toContain('data-model="gemini-flash-worker-agy"');
        expect(pricing).toContain(language === 'zh' ? '价格待确认' : 'Price unavailable');
    });
    it('escapes live labels and rejects malicious or self-referencing execution links', () => {
        expect(buildModelsTabContent(null, [cfg(coordinator, '<img src=x onerror=alert(1)>')])).not.toContain('<img');
        for (const executionModelId of ['<img src=x>', coordinator, 'MODEL_UNSPECIFIED']) {
            expect(buildModelInfoGrid([{ ...spec(), executionModelId }])).not.toContain('spec-orchestration');
        }
        expect(buildModelInfoGrid([{ ...spec(), executionModelId: 'MODEL_PLACEHOLDER_M9999' }])).toContain('MODEL_PLACEHOLDER_M9999');
    });
});


describe('delegated context snapshots', () => {
    const planner = (model: string, inputTokens: number) => ({ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        metadata: { generatorModel: model, requestedModel: { model: coordinator },
            modelUsage: { model, inputTokens, outputTokens: 100, cacheReadTokens: 200 } } });
    it('marks intervening tool tokens estimated, then replaces them with the worker snapshot', () => {
        const steps = [planner(coordinator, 1000), { type: 'CORTEX_STEP_TYPE_VIEW_FILE',
            metadata: { generatorModel: worker, requestedModel: { model: coordinator }, toolCallOutputTokens: 50 } }];
        expect(processSteps(steps)).toMatchObject({ model: coordinator, contextUsed: 1350, isEstimated: true });
        expect(processSteps([...steps, planner(worker, 1200)])).toMatchObject({ model: coordinator,
            contextUsed: 1500, isEstimated: false, lastModelUsage: { model: worker }, tokenUsageSource: 'planner' });
    });
    it('does not call coordinator-to-worker context changes compression', () => {
        const previous = { ...processSteps([planner(coordinator, 20000)]), contextLimit: 256000 };
        const current = { ...processSteps([planner(worker, 10000)]), contextLimit: 256000 };
        expect(previous.model).toBe(current.model);
        expect(measuredContextDrop(previous, current, false)).toBe(0);
        expect(measuredContextDrop(current, { ...current, contextUsed: 6000 }, false)).toBe(4300);
    });
});


describe('workflow execution IDs are not individual call IDs', () => {
    const call = (index: number) => parseGMEntry({ executionId: 'shared-workflow', stepIndices: [index, index + 1],
        chatModel: { model: coordinator, responseModel: 'gemini-pro-orchestrator', usage: { inputTokens: 100, outputTokens: 10 } } });
    const times = [2, 6].map((stepIndex, i) => ({ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', stepIndex,
        metadata: { executionId: 'shared-workflow', createdAt: `2026-11-13T00:0${i}:00Z` } }));
    it('recovers each actual call timestamp from shared execution ID plus planner step', () => {
        const result = applyTrajectoryModelHints([call(2), call(6)], times);
        expect(result.map(c => c.createdAt)).toEqual(['2026-11-13T00:00:00Z', '2026-11-13T00:01:00Z']);
        expect(applyTrajectoryModelHints([{ ...call(2), stepIndices: [] }], times)[0].createdAt).toBe('');
        expect(applyTrajectoryModelHints([call(50)], [times[0]])[0].createdAt).toBe('');
    });
    it('never enriches all calls with the last embedded call in a shared execution', () => {
        const first = call(2), second = call(6);
        expect(buildGMMatchKey(first)).not.toBe(buildGMMatchKey(second));
        const result = maybeEnrichCallsFromTrajectory([first, second], [
            { ...first, promptSnippet: 'first request', createdAt: '2026-11-13T00:00:00Z' },
            { ...second, promptSnippet: 'second request', createdAt: '2026-11-13T00:01:00Z' },
        ]);
        expect(result.map(c => c.promptSnippet)).toEqual(['first request', 'second request']);
        expect(result.map(c => c.createdAt)).toEqual(['2026-11-13T00:00:00Z', '2026-11-13T00:01:00Z']);
    });
    it('preserves uniquely identified legacy calls and rejects ambiguous missing-step matches', () => {
        const primary = { ...call(2), stepIndices: [] };
        const embedded = { ...call(2), promptSnippet: 'unique' };
        expect(maybeEnrichCallsFromTrajectory([primary], [embedded])[0].promptSnippet).toBe('unique');
        expect(maybeEnrichCallsFromTrajectory([primary, { ...call(6), stepIndices: [] }], [embedded])
            .every(c => c.promptSnippet === '')).toBe(true);
        expect(maybeEnrichCallsFromTrajectory([primary, { ...call(6), stepIndices: [] }], [{ ...embedded, stepIndices: [] }])
            .every(c => c.promptSnippet === '')).toBe(true);
    });
});


it('does not duplicate a shared workflow when formerly undated calls are enriched after reload', () => {
    const ids = [coordinator, coordinator, worker];
    const entries = ids.map((id, i) => ({ dedupKey: `workflow:${i}`, call: {
        ...parseGMEntry({ executionId: 'shared-execution', stepIndices: [i * 3 + 1],
            chatModel: { model: id, usage: { inputTokens: 1000, outputTokens: 100 } } }),
        accountEmail: 'reload@example.test',
    } }));
    const ledger = new DailyLedger(); expect(ledger.recordCalls(entries)).toBe(3);
    const restored = DailyLedger.restore(ledger.serialize());
    const enriched = entries.map(e => ({ ...e, call: { ...e.call, createdAt: new Date().toISOString() } }));
    expect(restored.recordCalls(enriched)).toBe(0);
    const bucket = restored.getAccountActive('reload@example.test')!;
    expect(bucket.totalCalls).toBe(3); expect(bucket.totalInputTokens).toBe(3000);
    expect(Object.keys(bucket.modelStats)).toHaveLength(2);
});


it('keeps Orchestrator in Gemini when readings differ or are missing without adding allowances', () => {
    const orchestrator = cfg();
    orchestrator.quotaInfo = { remainingFraction: 0.2, resetTime: '2026-11-15T00:00:00Z' };
    const hydrogen = cfg('MODEL_PLACEHOLDER_M528');
    const [pool] = groupModelQuotas([hydrogen, orchestrator]);
    expect(pool.pool).toBe('gemini'); expect(pool.members).toHaveLength(2);
    expect(pool.minimum).toBe(0.2); expect(pool.maximum).toBe(0.8);
    expect(pool.quotaDiffers).toBe(true); expect(pool.resetDiffers).toBe(true);
    delete orchestrator.quotaInfo;
    const groups = groupModelQuotas([hydrogen, orchestrator]);
    expect(groups).toHaveLength(1); expect(groups[0].missingQuota).toBe(true);
    expect(groups[0].members.find(m => m.label === 'Orchestrator')?.efforts).toEqual([]);
});

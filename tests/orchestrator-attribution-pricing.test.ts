import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { applyTrajectoryModelHints, extractTrajectoryOrchestratorRoutes, parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import type { GMCallEntry, GMSummary } from '../src/gm/types';
import { getLanguage, setLanguageToState, type Language } from '../src/i18n';
import {
    getModelDisplayName,
    getModelThinkingEffortLabel,
    type ModelConfig,
    type OrchestratorSettings,
} from '../src/models';
import {
    analyzeUserTurnCacheStates,
    buildOrchestratorSplitCardHtml,
    classifyConversationCalls,
    classifyFirstCallCacheStart,
    computeOrchestratorSplit,
    getAntigravityUserConfigPath,
    getOrchestratorAttributionStyles,
    parseAntigravityUserConfig,
    readLocalOrchestratorConfigFallback,
    renderCallRoleBadgeHtml,
} from '../src/orchestrator-attribution';
import {
    buildActiveOrchestratorPricingCard,
    buildPricingTabContent,
    getPricingTabStyles,
} from '../src/pricing-panel';
import {
    calculateCosts,
    DEFAULT_PRICING,
    findPricingForDate,
    getOrchestratorBaseMapping,
    getOrchestratorPricingMode,
    getUpcomingRateChangeForModel,
    PricingStore,
    resolvePricingDetail,
    setOrchestratorPricingMode,
    type ModelPricing,
} from '../src/pricing-store';
import { computeOrchestratorSplit as statusbarComputeOrchestratorSplit } from '../src/statusbar';
import {
    computeCallTelemetry,
    computeContextWatermarks,
    computeTelemetrySummary,
    evaluateSpeedSample,
    LONG_CONTEXT_TIER_THRESHOLD,
} from '../src/telemetry-metrics';
import { fetchOrchestratorSettings, processSteps, type ContextUsage } from '../src/tracker';
import { buildModelsTabContent, buildOrchestratorSettingsCard } from '../src/webview-models-tab';
import { collectPricingInputOverrides } from '../src/webview-script';
import type { LSInfo } from '../src/discovery';

const initialLang = getLanguage();
const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };

const CUSTOM_RATE: ModelPricing = {
    input: 9.5,
    output: 39.5,
    cacheRead: 0.95,
    cacheWrite: 0,
    thinking: 39.5,
};

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    const base = parseGMEntry({
        executionId: overrides.executionId || 'exec-1',
        stepIndices: overrides.stepIndices || [1],
        chatModel: {
            model: overrides.model || 'MODEL_PLACEHOLDER_M535',
            responseModel: overrides.responseModel || 'gemini-4-neon',
            timeToFirstToken: '0.8s',
            streamingDuration: '2.0s',
            usage: {
                inputTokens: String(overrides.inputTokens ?? 10_000),
                outputTokens: String(overrides.outputTokens ?? 200),
                thinkingOutputTokens: String(overrides.thinkingTokens ?? 50),
                cacheReadTokens: String(overrides.cacheReadTokens ?? 0),
                cacheCreationTokens: String(overrides.cacheCreationTokens ?? 0),
            },
            chatStartMetadata: {
                createdAt: overrides.createdAt ?? '2026-11-22T01:00:00Z',
            },
        },
    });
    return {
        ...base,
        ...overrides,
    };
}

function makeSummaryFromCalls(calls: GMCallEntry[], cascadeId = 'conv-orch'): GMSummary {
    return buildSummaryFromConversations([{
        cascadeId,
        title: 'Orchestrator Test Session',
        totalSteps: calls.length * 2,
        coveredSteps: calls.length * 2,
        coverageRate: 1,
        calls,
        checkpointSummaries: [],
    }], '2026-11-22T02:00:00Z')!;
}

const SAMPLE_SETTINGS: OrchestratorSettings = {
    configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
    configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
    effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorLabel: 'Gemini 4 Neon (XHigh)',
    effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
    isCustomOrchestrator: true,
    isCustomExecutor: true,
    mode: 'custom',
    roles: {
        orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'claude-opus-5-5'],
        executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
    },
    orchestratorCandidates: ['MODEL_PLACEHOLDER_M535', 'MODEL_PLACEHOLDER_M401'],
    executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
    useAiCredits: false,
    settingsSource: 'config_fallback',
};

afterEach(async () => {
    setOrchestratorPricingMode('mapped');
    await setLanguageToState(initialLang, memState);
});

// ─── 1. Orchestrator Mapped vs Strict Pricing & Provenance ───────────────────

describe('Orchestrator pricing modes (mapped vs strict), UTC cutovers & provenance', () => {
    it('defaults to mapped mode and resolves all 4 legacy Orchestrator IDs to verified base rates with provenance', () => {
        expect(getOrchestratorPricingMode()).toBe('mapped');

        // M537 -> Neon ($3/$15/$0.15)
        const neon = resolvePricingDetail('MODEL_PLACEHOLDER_M537', {}, { at: '2026-11-22T00:00:00Z' });
        expect(neon.provenance).toBe('mapped_base');
        expect(neon.mappedBaseKey).toBe('gemini-4-neon');
        expect(neon.mappedBaseLabel).toBe('Gemini 4 Neon');
        expect(neon.pricing).toEqual(DEFAULT_PRICING['gemini-4-neon']);

        // M667 -> Carbon (dated cutover 2026-12-01 UTC)
        const carbonIntro = resolvePricingDetail('MODEL_PLACEHOLDER_M667', {}, { at: '2026-11-30T23:59:59Z' });
        const carbonStd = resolvePricingDetail('MODEL_PLACEHOLDER_M667', {}, { at: '2026-12-01T00:00:00Z' });
        const carbonUndated = resolvePricingDetail('MODEL_PLACEHOLDER_M667', {}, { at: '' });
        expect(carbonIntro).toMatchObject({ provenance: 'mapped_base', mappedBaseKey: 'gemini-4-carbon', pricing: { input: 2, output: 10, cacheRead: 0.1 } });
        expect(carbonStd).toMatchObject({ provenance: 'mapped_base', mappedBaseKey: 'gemini-4-carbon', pricing: { input: 4, output: 20, cacheRead: 0.2 } });
        expect(carbonUndated.pricing).toBeNull();
        expect(carbonUndated.provenance).toBe('unpriced');

        // M681 -> Argon (dated cutover 2026-12-01 UTC)
        const argonIntro = resolvePricingDetail('gemini-pro-orchestrator-argon', {}, { at: '2026-11-30T12:00:00Z' });
        const argonStd = resolvePricingDetail('Orchestrator (Argon)', {}, { at: '2026-12-01T00:00:00Z' });
        expect(argonIntro).toMatchObject({ provenance: 'mapped_base', mappedBaseKey: 'gemini-4-argon', pricing: { input: 2, output: 10, cacheRead: 0.1 } });
        expect(argonStd).toMatchObject({ provenance: 'mapped_base', mappedBaseKey: 'gemini-4-argon', pricing: { input: 4, output: 20, cacheRead: 0.2 } });

        // M669 -> Hydrogen (proven sharing base M432)
        const worker = resolvePricingDetail('MODEL_PLACEHOLDER_M669', {}, { at: '2026-11-22T00:00:00Z' });
        expect(worker).toMatchObject({
            provenance: 'mapped_base',
            mappedBaseKey: 'gemini-4-hydrogen',
            mappedBaseLabel: 'Gemini 4 Hydrogen',
            pricing: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0, thinking: 7.5 },
        });

        // Non-orchestrator official model -> 'official'
        expect(resolvePricingDetail('MODEL_PLACEHOLDER_M535', {}, { at: '2026-11-22' }).provenance).toBe('official');
        // Specialized Sonar M578 -> NEVER mapped
        expect(getOrchestratorBaseMapping('MODEL_PLACEHOLDER_M578')).toBeNull();
        expect(resolvePricingDetail('MODEL_PLACEHOLDER_M578', {}).provenance).toBe('unpriced');
    });

    it('lets user custom overrides always win in both mapped and strict modes without leaking base-family overrides', () => {
        const baseOverrides = {
            'gemini-4-neon': CUSTOM_RATE,
            'gemini-4-carbon': CUSTOM_RATE,
            'gemini-4-argon': CUSTOM_RATE,
            'gemini-4-hydrogen': CUSTOM_RATE,
        };
        // Base family custom rates must NOT hijack Orchestrator IDs
        expect(resolvePricingDetail('MODEL_PLACEHOLDER_M537', baseOverrides, { orchestratorPricingMode: 'mapped' })).toMatchObject({
            provenance: 'mapped_base',
            pricing: DEFAULT_PRICING['gemini-4-neon'],
        });
        expect(resolvePricingDetail('MODEL_PLACEHOLDER_M537', baseOverrides, { orchestratorPricingMode: 'strict' })).toMatchObject({
            provenance: 'unpriced',
            pricing: null,
        });

        // Direct custom override on the Orchestrator identity ALWAYS wins in both modes
        const directOverride = { 'gemini-pro-orchestrator-neon': CUSTOM_RATE };
        for (const mode of ['mapped', 'strict'] as const) {
            const detail = resolvePricingDetail('MODEL_PLACEHOLDER_M537', directOverride, { orchestratorPricingMode: mode });
            expect(detail.provenance).toBe('custom');
            expect(detail.pricing).toEqual(CUSTOM_RATE);
        }
    });

    it('persists orchestratorPricingMode in PricingStore and triggers Carbon/Argon cutover notices in mapped mode only', async () => {
        const backing = new Map<string, unknown>();
        const storage = {
            get: <T>(k: string, d: T) => (backing.has(k) ? backing.get(k) as T : d),
            update: async (k: string, v: unknown) => { backing.set(k, v); },
        };
        const store = new PricingStore();
        store.init(storage);
        expect(store.getOrchestratorPricingMode()).toBe('mapped');

        await store.setOrchestratorPricingMode('strict');
        expect(store.getOrchestratorPricingMode()).toBe('strict');
        expect(getOrchestratorPricingMode()).toBe('strict');

        const reloaded = new PricingStore();
        reloaded.init(storage);
        expect(reloaded.getOrchestratorPricingMode()).toBe('strict');

        const now = Date.parse('2026-11-22T00:00:00Z');
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M667', {}, now, 14, 'mapped')?.modelKey).toBe('gemini-4-carbon');
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M681', {}, now, 14, 'mapped')?.modelKey).toBe('gemini-4-argon');
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M667', {}, now, 14, 'strict')).toBeNull();
        expect(getUpcomingRateChangeForModel('MODEL_PLACEHOLDER_M667', { 'gemini-pro-orchestrator': CUSTOM_RATE }, now, 14, 'mapped')).toBeNull();
    });

    it('resolves estCacheSavingsUsd cleanly for mapped Orchestrator calls and omits it in strict mode', () => {
        const m537Call = makeCall({
            model: 'MODEL_PLACEHOLDER_M537',
            modelDisplay: 'Orchestrator (Neon)',
            responseModel: 'gemini-pro-orchestrator-neon',
            inputTokens: 100_000,
            cacheReadTokens: 1_000_000, // saved = 1M * ($3.00 - $0.15) = $2.85
            outputTokens: 500,
            createdAt: '2026-11-22T01:00:00Z',
        });
        const m669Call = makeCall({
            model: 'MODEL_PLACEHOLDER_M669',
            modelDisplay: 'Gemini 4 Hydrogen (Orchestrator)',
            responseModel: 'gemini-flash-worker-agy',
            inputTokens: 50_000,
            cacheReadTokens: 1_000_000, // saved = 1M * ($1.50 - $0.075) = $1.425
            outputTokens: 400,
            createdAt: '2026-11-22T01:01:00Z',
        });

        const ptMapped = computeCallTelemetry(m537Call, {}, 'conv-1', 'mapped');
        expect(ptMapped.estCacheSavingsUsd).toBeCloseTo(2.85, 6);

        const ptStrict = computeCallTelemetry(m537Call, {}, 'conv-1', 'strict');
        expect(ptStrict.estCacheSavingsUsd).toBeNull();

        const summary = makeSummaryFromCalls([m537Call, m669Call]);
        const telemMapped = computeTelemetrySummary(summary, { orchestratorPricingMode: 'mapped' });
        expect(telemMapped.overall.estCacheSavingsUsd).toBeCloseTo(4.275, 6);

        const telemStrict = computeTelemetrySummary(summary, { orchestratorPricingMode: 'strict' });
        expect(telemStrict.overall.estCacheSavingsUsd).toBeNull();
    });
});

// ─── 2. Pricing Panel Active Orchestrator Banner & Editable Placeholders ─────

describe('Pricing panel Active Orchestrator banner, toggle & editable mapped placeholders', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders Active Orchestrator Pricing Card with effective rates, thinking levels & mode toggle in %s', async lang => {
        await setLanguageToState(lang, memState);
        const cardHtml = buildActiveOrchestratorPricingCard(SAMPLE_SETTINGS, {}, 'mapped');
        expect(cardHtml).toContain('id="activeOrchestratorPricingCard"');
        expect(cardHtml).toContain('data-orchestrator-pricing-mode="mapped"');
        expect(cardHtml).toContain('id="orchPricingModeMapped"');
        expect(cardHtml).toContain('id="orchPricingModeStrict"');
        expect(cardHtml).toContain('aria-checked="true"');
        expect(cardHtml).toContain('$3/M');
        expect(cardHtml).toContain('$15/M');
        expect(cardHtml).toContain('$1.5/M');
        expect(cardHtml).toContain('$7.5/M');
        expect(cardHtml).toContain(lang === 'zh' ? '编排模型' : 'Orchestrator Model');
        expect(cardHtml).toContain(lang === 'zh' ? '执行模型' : 'Executor Model');
        // Standardized Chinese terminology — never 编排器模型 or 执行器模型
        expect(cardHtml).not.toContain('编排器模型');
        expect(cardHtml).not.toContain('执行器模型');
        expect(cardHtml).not.toContain('令牌');
        expect(cardHtml).not.toMatch(/[\u00a5\uffe5]/);
    });

    it('renders legacy Orchestrator rows with mapped numeric placeholders (empty value) so unmodified save creates zero fake overrides', () => {
        const store = new PricingStore();
        const html = buildPricingTabContent(null, store, undefined, undefined, undefined, false, {
            orchestratorSettings: SAMPLE_SETTINGS,
            orchestratorPricingMode: 'mapped',
        });

        expect(html).toContain('data-model="gemini-pro-orchestrator-neon"');
        expect(html).toContain('data-mapped-value="3"');
        expect(html).toContain('placeholder="3"');
        expect(html).toContain('Est. via Base Model');
        expect(html).toContain('→ Gemini 4 Neon');
        expect(html).toContain('→ Gemini 4 Hydrogen');

        // Verify unmodified mapped inputs yield zero custom overrides when passed through collectPricingInputOverrides
        const mockInputs = ['input', 'output', 'cacheRead', 'thinking'].map((field, idx) => {
            const mapped = ['3', '15', '0.15', '15'][idx];
            const attrs: Record<string, string> = {
                'data-model': 'gemini-pro-orchestrator-neon',
                'data-field': field,
                'data-original-value': '',
                'data-was-custom': '0',
                'data-cache-write': '0',
                'data-mapped-value': mapped,
            };
            return { value: '', getAttribute: (name: string) => attrs[name] ?? null };
        });
        expect(collectPricingInputOverrides(mockInputs)).toEqual({});

        // Entering explicit custom numbers overrides cleanly
        const edited = mockInputs.map((inp, idx) => ({ ...inp, value: ['4', '18', '0.2', '18'][idx] }));
        expect(collectPricingInputOverrides(edited)).toEqual({
            'gemini-pro-orchestrator-neon': { input: 4, output: 18, cacheRead: 0.2, cacheWrite: 0, thinking: 18 },
        });

        // Strict mode flips badges to Price unavailable
        const strictHtml = buildPricingTabContent(null, store, undefined, undefined, undefined, false, {
            orchestratorSettings: SAMPLE_SETTINGS,
            orchestratorPricingMode: 'strict',
        });
        expect(strictHtml).toContain('data-orchestrator-pricing-mode="strict"');
        expect(strictHtml).toContain('Price unavailable');

        // Balanced CSS braces
        const css = getPricingTabStyles();
        expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
    });
});

// ─── 3. Cross-Platform ~/.gemini/config/config.json Fallback Reader ──────────

describe('Cross-platform ~/.gemini/config/config.json fallback reader', () => {
    it('constructs cross-platform path and parses userSettings cleanly', () => {
        const fakeHome = path.join('/tmp', 'agy-test-home');
        expect(getAntigravityUserConfigPath(fakeHome)).toBe(
            path.join(fakeHome, '.gemini', 'config', 'config.json'),
        );

        expect(parseAntigravityUserConfig({
            userSettings: {
                orchestratorModel: 'MODEL_PLACEHOLDER_M401',
                orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M528',
                useAiCredits: true,
            },
        })).toEqual({
            orchestratorModel: 'MODEL_PLACEHOLDER_M401',
            orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M528',
            useAiCredits: true,
        });

        expect(parseAntigravityUserConfig(null)).toBeNull();
        expect(parseAntigravityUserConfig({})).toBeNull();
        expect(parseAntigravityUserConfig({ userSettings: {} })).toBeNull();
    });

    it('reads temp config.json read-only, never throws on missing/corrupt files, and backs fetchOrchestratorSettings when RPC is unavailable', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-orch-cfg-'));
        try {
            const cfgDir = path.join(tmpDir, '.gemini', 'config');
            fs.mkdirSync(cfgDir, { recursive: true });
            const cfgPath = path.join(cfgDir, 'config.json');
            fs.writeFileSync(cfgPath, JSON.stringify({
                userSettings: {
                    orchestratorModel: 'MODEL_PLACEHOLDER_M401',
                    orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M528',
                    useAiCredits: true,
                },
            }), 'utf8');

            const loaded = readLocalOrchestratorConfigFallback({ homeDir: tmpDir });
            expect(loaded).toEqual({
                orchestratorModel: 'MODEL_PLACEHOLDER_M401',
                orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M528',
                useAiCredits: true,
                configPath: cfgPath,
            });

            // Missing file returns null cleanly
            expect(readLocalOrchestratorConfigFallback({ configPath: path.join(tmpDir, 'nope.json') })).toBeNull();

            // Malformed JSON returns null cleanly
            const badPath = path.join(tmpDir, 'bad.json');
            fs.writeFileSync(badPath, '{not json', 'utf8');
            expect(readLocalOrchestratorConfigFallback({ configPath: badPath })).toBeNull();

            // Wire into fetchOrchestratorSettings when Jetbox RPC returns 501
            const server = http.createServer((_req, res) => {
                res.writeHead(501);
                res.end();
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const port = (server.address() as { port: number }).port;
            const ls: LSInfo = { pid: 1, port, hostname: '127.0.0.1', csrfToken: 'test', useTls: false };
            const configs: ModelConfig[] = [
                { model: 'MODEL_PLACEHOLDER_M401', label: 'Claude Opus 5.5 (Medium)', modelId: 'claude-opus-5-5-medium', supportsImages: true, allowedTiers: [], mimeTypeCount: 0, isRecommended: false, supportedMimeTypes: [] },
                { model: 'MODEL_PLACEHOLDER_M528', label: 'Gemini 4 Hydrogen (XHigh)', modelId: 'gemini-4-hydrogen-xhigh', supportsImages: true, allowedTiers: [], mimeTypeCount: 0, isRecommended: false, supportedMimeTypes: [] },
            ];
            try {
                const resolved = await fetchOrchestratorSettings(ls, configs, undefined, { homeDir: tmpDir });
                expect(resolved).not.toBeNull();
                expect(resolved!.mode).toBe('custom');
                expect(resolved!.effectiveOrchestratorModel).toBe('MODEL_PLACEHOLDER_M401');
                expect(resolved!.effectiveExecutorModel).toBe('MODEL_PLACEHOLDER_M528');
                expect(resolved!.useAiCredits).toBe(true);
                expect(resolved!.settingsSource).toBe('config_fallback');
            } finally {
                server.closeAllConnections?.();
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ─── 4. Role Attribution, Cold-Cache Switches, Reconfig & UI Integration ─────

describe('Full-stack Orchestrator role attribution, cold-cache switches & UI rendering', () => {
    it('attributes live-shaped M667 + M669 trajectory and detects Orchestrator <-> Executor cold-cache switches', () => {
        // Mirrors live Antigravity trajectory 451ef6a6 from inspection #6:
        // M667 plan -> M669 executor cold switch (in=117143, cache=0) -> M669 warm loop -> M667 return cold switch (in=175195, cache=0)
        const calls = [
            makeCall({ executionId: 'w1', stepIndices: [1], model: 'MODEL_PLACEHOLDER_M667', modelDisplay: 'Orchestrator (Carbon)', responseModel: 'gemini-pro-orchestrator', inputTokens: 20_000, cacheReadTokens: 80_000, outputTokens: 800, createdAt: '2026-11-22T01:00:00Z' }),
            makeCall({ executionId: 'w1', stepIndices: [2], model: 'MODEL_PLACEHOLDER_M669', modelDisplay: 'Gemini 4 Hydrogen (Orchestrator)', responseModel: 'gemini-flash-worker-agy', inputTokens: 117_143, cacheReadTokens: 0, outputTokens: 600, createdAt: '2026-11-22T01:01:00Z' }),
            makeCall({ executionId: 'w1', stepIndices: [3], model: 'MODEL_PLACEHOLDER_M669', modelDisplay: 'Gemini 4 Hydrogen (Orchestrator)', responseModel: 'gemini-flash-worker-agy', inputTokens: 4_000, cacheReadTokens: 115_094, outputTokens: 500, createdAt: '2026-11-22T01:02:00Z' }),
            makeCall({ executionId: 'w1', stepIndices: [4], model: 'MODEL_PLACEHOLDER_M667', modelDisplay: 'Orchestrator (Carbon)', responseModel: 'gemini-pro-orchestrator', inputTokens: 175_195, cacheReadTokens: 0, outputTokens: 900, createdAt: '2026-11-22T01:03:00Z' }),
        ];

        const split = computeOrchestratorSplit(calls, undefined, {});
        expect(split).not.toBeNull();
        expect(statusbarComputeOrchestratorSplit).toBe(computeOrchestratorSplit);
        expect(split!.isMultiModelOrchestrated).toBe(true);
        expect(split!.orchestrator.calls).toBe(2);
        expect(split!.executor.calls).toBe(2);
        expect(split!.roleSwitchCount).toBe(2);
        expect(split!.coldCacheSwitchCount).toBe(2);
        expect(split!.coldCacheSwitchInputTokens).toBe(117_143 + 175_195);
        expect(split!.switches[0]).toMatchObject({
            direction: 'orchestrator_to_executor',
            isColdCache: true,
            freshInputTokens: 117_143,
        });
        expect(split!.switches[1]).toMatchObject({
            direction: 'executor_to_orchestrator',
            isColdCache: true,
            freshInputTokens: 175_195,
        });
        // Mapped base pricing prices both roles cleanly
        expect(split!.plannerCostUsd).toBeGreaterThan(0);
        expect(split!.executorCostUsd).toBeGreaterThan(0);
        expect(split!.orchestrator.mappedBaseCalls).toBe(2);
        expect(split!.executor.mappedBaseCalls).toBe(2);
        expect(split!.hasUnpriced).toBe(false);
    });

    it('handles same-model Orchestrator edge case and mid-conversation reconfigurations without orphaning earlier turns', () => {
        // 1. Same-model Orchestrator: Neon XHigh plans (carries executionModel=M535) and executes follow-ups without executionModel
        const sameModelCalls = [
            makeCall({ executionId: 's1', stepIndices: [1], model: 'MODEL_PLACEHOLDER_M535', executionModel: 'MODEL_PLACEHOLDER_M535', inputTokens: 30_000, cacheReadTokens: 0, createdAt: '2026-11-22T01:00:00Z' }),
            makeCall({ executionId: 's1', stepIndices: [2], model: 'MODEL_PLACEHOLDER_M535', inputTokens: 35_000, cacheReadTokens: 0, createdAt: '2026-11-22T01:01:00Z' }),
        ];
        const sameSplit = computeOrchestratorSplit(sameModelCalls, {
            orchestratorConfig: { planModel: 'MODEL_PLACEHOLDER_M535', executionModel: 'MODEL_PLACEHOLDER_M535' },
        });
        expect(sameSplit).not.toBeNull();
        expect(sameSplit!.isSameModelOrchestrated).toBe(true);
        expect(sameSplit!.orchestrator.calls).toBe(1);
        expect(sameSplit!.executor.calls).toBe(1);
        expect(sameSplit!.coldCacheSwitchCount).toBe(1);

        // 2. Mid-conversation reconfiguration via processSteps orchestratorHistory:
        // Turn 1 (step 0): Opus 5.5 -> Hydrogen; Turn 2 (step 4): Neon -> Sonnet 5.5; Turn 3 (step 8): direct Hydrogen
        const steps = [
            { stepIndex: 0, type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M401', planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' } } } } },
            { stepIndex: 4, type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M535', planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M404' } } } } },
            { stepIndex: 8, type: 'CORTEX_STEP_TYPE_USER_INPUT', userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M528' } } } },
        ];
        const processed = processSteps(steps);
        expect(processed.orchestratorHistory).toHaveLength(3);
        expect(extractTrajectoryOrchestratorRoutes(steps)).toHaveLength(3);

        const reconfigCalls = [
            makeCall({ stepIndices: [1], model: 'MODEL_PLACEHOLDER_M401', responseModel: 'claude-opus-5-5', createdAt: '2026-11-22T01:00:00Z' }),
            makeCall({ stepIndices: [2], model: 'MODEL_PLACEHOLDER_M528', responseModel: 'gemini-4-hydrogen', inputTokens: 50_000, cacheReadTokens: 0, createdAt: '2026-11-22T01:01:00Z' }),
            makeCall({ stepIndices: [5], model: 'MODEL_PLACEHOLDER_M535', responseModel: 'gemini-4-neon', inputTokens: 60_000, cacheReadTokens: 0, createdAt: '2026-11-22T01:02:00Z' }),
            makeCall({ stepIndices: [6], model: 'MODEL_PLACEHOLDER_M404', responseModel: 'claude-sonnet-5-5', inputTokens: 70_000, cacheReadTokens: 0, createdAt: '2026-11-22T01:03:00Z' }),
            makeCall({ stepIndices: [9], model: 'MODEL_PLACEHOLDER_M528', responseModel: 'gemini-4-hydrogen', inputTokens: 10_000, cacheReadTokens: 70_000, createdAt: '2026-11-22T01:04:00Z' }),
        ];

        // Also test applyTrajectoryModelHints propagating executionModel onto planner calls only
        const enriched = applyTrajectoryModelHints(reconfigCalls, steps);
        expect(enriched[0].executionModel).toBe('MODEL_PLACEHOLDER_M528');
        expect(enriched[1].executionModel).toBeUndefined();
        expect(enriched[2].executionModel).toBe('MODEL_PLACEHOLDER_M404');
        expect(enriched[3].executionModel).toBeUndefined();
        expect(enriched[4].executionModel).toBeUndefined();

        const reconfigSplit = computeOrchestratorSplit(reconfigCalls, {
            orchestratorHistory: processed.orchestratorHistory,
        });
        expect(reconfigSplit).not.toBeNull();
        expect(reconfigSplit!.hasMidConversationReconfig).toBe(true);
        expect(reconfigSplit!.orchestrator.calls).toBe(2);
        expect(reconfigSplit!.executor.calls).toBe(2);
        expect(reconfigSplit!.direct.calls).toBe(1);
        expect(reconfigSplit!.attributedCalls.map(c => c.role)).toEqual([
            'orchestrator', 'executor', 'orchestrator', 'executor', 'direct',
        ]);
    });

    it('classifies subagent calls and auto-hides split card for single-model direct conversations', () => {
        const directCalls = [
            makeCall({ executionId: 'd1', model: 'MODEL_PLACEHOLDER_M535', createdAt: '2026-11-22T01:00:00Z' }),
            makeCall({ executionId: 'd2', model: 'MODEL_PLACEHOLDER_M535', cacheReadTokens: 9_000, createdAt: '2026-11-22T01:01:00Z' }),
        ];
        expect(computeOrchestratorSplit(directCalls)).toBeNull();
        expect(buildOrchestratorSplitCardHtml(null)).toBe('');

        const subagentAttributed = classifyConversationCalls([
            makeCall({ executionId: 'subagent-task-1', model: 'MODEL_PLACEHOLDER_M528' }),
        ]);
        expect(subagentAttributed[0].role).toBe('subagent');
        expect(renderCallRoleBadgeHtml('subagent')).toContain('data-call-role="subagent"');
        expect(renderCallRoleBadgeHtml('direct')).toBe('');
    });

    it('renders Orchestrator split card, role badges, cold-cache switch hints & short-sample guard in GM Data, and rates in Models tab', async () => {
        await setLanguageToState('both', memState);
        const orchCalls = [
            makeCall({
                executionId: 'o1',
                stepIndices: [1],
                model: 'MODEL_PLACEHOLDER_M401',
                modelDisplay: 'Claude Opus 5.5 (Medium)',
                responseModel: 'claude-opus-5-5',
                executionModel: 'MODEL_PLACEHOLDER_M528',
                inputTokens: 40_000,
                outputTokens: 600,
                streamingSeconds: 3.0,
                cacheReadTokens: 0,
                createdAt: '2026-11-22T01:00:00Z',
            }),
            makeCall({
                executionId: 'o1',
                stepIndices: [2],
                model: 'MODEL_PLACEHOLDER_M528',
                modelDisplay: 'Gemini 4 Hydrogen (XHigh)',
                responseModel: 'gemini-4-hydrogen',
                inputTokens: 45_000,
                outputTokens: 6, // micro-burst short sample
                streamingSeconds: 0.08,
                cacheReadTokens: 0, // cold cache switch!
                createdAt: '2026-11-22T01:01:00Z',
            }),
        ];
        const gm = makeSummaryFromCalls(orchCalls, 'conv-orch');
        const usage = {
            cascadeId: 'conv-orch',
            orchestratorConfig: { planModel: 'MODEL_PLACEHOLDER_M401', executionModel: 'MODEL_PLACEHOLDER_M528' },
        } as ContextUsage;

        const gmHtml = buildGMDataTabContent(null, gm, usage);
        expect(gmHtml).toContain('id="orchestratorSplitCard"');
        expect(gmHtml).toContain('data-call-role="orchestrator"');
        expect(gmHtml).toContain('data-call-role="executor"');
        expect(gmHtml).toContain('data-cold-cache-switch="true"');
        expect(gmHtml).toContain('Switch Cold');
        expect(gmHtml).toContain('切换冷启动');
        expect(gmHtml).toContain('data-short-sample="true"');
        expect(gmHtml).toContain('Short sample');
        expect(gmHtml).toContain('短样本');
        expect(gmHtml).not.toContain('编排器模型');
        expect(gmHtml).not.toContain('执行器模型');
        expect(gmHtml).not.toContain('令牌');

        // Single-model GM Data hides the split card completely
        const singleGm = makeSummaryFromCalls([makeCall({ model: 'MODEL_PLACEHOLDER_M535' })], 'conv-single');
        expect(buildGMDataTabContent(null, singleGm)).not.toContain('id="orchestratorSplitCard"');

        // Models tab Orchestrator Settings Card shows effective per-1M rates & standardized Chinese labels
        const modelsCard = buildOrchestratorSettingsCard(SAMPLE_SETTINGS);
        expect(modelsCard).toContain('编排模型');
        expect(modelsCard).toContain('执行模型');
        expect(modelsCard).not.toContain('编排器模型');
        expect(modelsCard).not.toContain('执行器模型');
        expect(modelsCard).toContain('$3/M');
        expect(modelsCard).toContain('$15/M');
        expect(modelsCard).toContain('$1.5/M');
        expect(modelsCard).toContain('$7.5/M');
        expect(modelsCard).toContain('data-settings-source="config_fallback"');
        expect(modelsCard).toContain('AI Credit Overages');

        // Full Models tab builds cleanly with orchestratorSettings
        const modelsTab = buildModelsTabContent(null, [], { orchestratorSettings: SAMPLE_SETTINGS });
        expect(modelsTab).toContain('orch-role-rates');

        // Thinking effort helper
        expect(getModelThinkingEffortLabel('MODEL_PLACEHOLDER_M535', 'en')).toBe('Extra High');
        expect(getModelThinkingEffortLabel('MODEL_PLACEHOLDER_M535', 'zh')).toBe('超高');

        // Balanced CSS in both modules
        for (const css of [getOrchestratorAttributionStyles(), getGMDataTabStyles()]) {
            expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
        }
    });
});

// ─── 5. Sparse-Sample Speed Guard, Turn Cache State & Dual Watermark ─────────

describe('Sparse-sample speed guard, user-turn cache classification & dual context watermarks', () => {
    it('suppresses micro-burst TPS spikes while preserving rawSpeed and explicit TTFT waiting state', () => {
        // Micro-burst: 5 tokens in 0.01s -> rawSpeed 500 tok/s suppressed as short sample
        const microBurst = evaluateSpeedSample({ outputTokens: 5, streamingSeconds: 0.01 });
        expect(microBurst).toEqual({
            isShortSample: true,
            displaySpeed: null,
            rawSpeed: 500,
            isWaitingTtft: false,
        });

        // Short duration with moderate tokens (196 tokens in 0.02s -> 9800 tok/s spike suppressed!)
        const subThresholdDuration = evaluateSpeedSample({ outputTokens: 196, streamingSeconds: 0.02 });
        expect(subThresholdDuration.isShortSample).toBe(true);
        expect(subThresholdDuration.displaySpeed).toBeNull();
        expect(subThresholdDuration.rawSpeed).toBeCloseTo(9800, 6);

        // Short output count with longer duration (10 tokens in 1.0s)
        const lowTokens = evaluateSpeedSample({ outputTokens: 10, streamingSeconds: 1.0 });
        expect(lowTokens).toEqual({
            isShortSample: true,
            displaySpeed: null,
            rawSpeed: 10,
            isWaitingTtft: false,
        });

        // Reliable steady sample (120 tokens in 1.5s -> 80 tok/s)
        const steady = evaluateSpeedSample({ outputTokens: 120, streamingSeconds: 1.5 });
        expect(steady).toEqual({
            isShortSample: false,
            displaySpeed: 80,
            rawSpeed: 80,
            isWaitingTtft: false,
        });

        // Waiting for TTFT
        const waiting = evaluateSpeedSample({
            outputTokens: 0,
            streamingSeconds: 0,
            isStreaming: true,
            elapsedWaitSeconds: 2.3,
        });
        expect(waiting).toEqual({
            isShortSample: false,
            displaySpeed: null,
            rawSpeed: null,
            isWaitingTtft: true,
            waitingSeconds: 2.3,
        });

        // Empty / idle
        const empty = evaluateSpeedSample({ outputTokens: 0, streamingSeconds: 0 });
        expect(empty).toEqual({
            isShortSample: false,
            displaySpeed: null,
            rawSpeed: null,
            isWaitingTtft: false,
        });
    });

    it('classifies each user turn first GM call as cold / partial / warm and tracks net +Δ context growth', () => {
        expect(classifyFirstCallCacheStart(10_000, 0)).toMatchObject({ cacheStart: 'cold', cacheHitPct: 0 });
        expect(classifyFirstCallCacheStart(6_000, 4_000)).toMatchObject({ cacheStart: 'partial', cacheHitPct: 40 });
        expect(classifyFirstCallCacheStart(2_000, 18_000)).toMatchObject({ cacheStart: 'warm', cacheHitPct: 90 });
        expect(classifyFirstCallCacheStart(0, 0)).toMatchObject({ cacheStart: 'unknown', cacheHitPct: null });

        const calls = [
            // User Turn 1 (2 GM calls: cold start 10k -> grows to 15k within turn)
            makeCall({ executionId: 'turn-1', stepIndices: [1], inputTokens: 10_000, cacheReadTokens: 0 }),
            makeCall({ executionId: 'turn-1', stepIndices: [2], inputTokens: 5_000, cacheReadTokens: 10_000 }),
            // User Turn 2 (partial cache start: 12k fresh + 8k cache = 20k -> 40% partial, net +Δ = +10k vs Turn 1 first call)
            makeCall({ executionId: 'turn-2', stepIndices: [4], inputTokens: 12_000, cacheReadTokens: 8_000 }),
            // User Turn 3 (warm cache start: 3k fresh + 27k cache = 30k -> 90% warm, net +Δ = +10k)
            makeCall({ executionId: 'turn-3', stepIndices: [6], inputTokens: 3_000, cacheReadTokens: 27_000 }),
            // User Turn 4 (compaction drop to 8k cold start: net Δ = -22k -> isCompactionDrop true)
            makeCall({ executionId: 'turn-4', stepIndices: [8], inputTokens: 8_000, cacheReadTokens: 0 }),
        ];

        const summary = analyzeUserTurnCacheStates(calls);
        expect(summary.turns).toHaveLength(4);
        expect(summary.coldCount).toBe(2);
        expect(summary.partialCount).toBe(1);
        expect(summary.warmCount).toBe(1);

        expect(summary.turns[0]).toMatchObject({
            turnIndex: 1,
            callCount: 2,
            cacheStart: 'cold',
            firstCallPromptTokens: 10_000,
            lastCallPromptTokens: 15_000,
            netContextDeltaTokens: null,
            intraTurnGrowthTokens: 5_000,
            isCompactionDrop: false,
        });
        expect(summary.turns[1]).toMatchObject({
            turnIndex: 2,
            cacheStart: 'partial',
            cacheHitPct: 40,
            netContextDeltaTokens: 10_000,
        });
        expect(summary.turns[2]).toMatchObject({
            turnIndex: 3,
            cacheStart: 'warm',
            cacheHitPct: 90,
            netContextDeltaTokens: 10_000,
        });
        expect(summary.turns[3]).toMatchObject({
            turnIndex: 4,
            cacheStart: 'cold',
            netContextDeltaTokens: -22_000,
            isCompactionDrop: true,
        });
        expect(summary.latestTurn).toEqual(summary.turns[3]);
    });

    it('exports accurate dual-watermark metadata for compaction ceiling, physical window, and 200k long-context tier', () => {
        expect(LONG_CONTEXT_TIER_THRESHOLD).toBe(200_000);

        // Gemini 4 Neon (512k compaction vs 1M physical), context = 250k (> 200k tier!)
        const above200k = computeContextWatermarks({
            contextUsed: 250_000,
            compactionLimit: 512_000,
            physicalContextWindow: 1_048_576,
        });
        expect(above200k.hasDistinctPhysicalWindow).toBe(true);
        expect(above200k.compactionUsagePct).toBeCloseTo((250_000 / 512_000) * 100, 3);
        expect(above200k.physicalUsagePct).toBeCloseTo((250_000 / 1_048_576) * 100, 3);
        expect(above200k.compactionMarkerPct).toBeCloseTo((512_000 / 1_048_576) * 100, 3);
        expect(above200k.showLongContextMarker).toBe(true);
        expect(above200k.longContextMarkerPctOfCompaction).toBeCloseTo((200_000 / 512_000) * 100, 3);
        expect(above200k.longContextMarkerPctOfPhysical).toBeCloseTo((200_000 / 1_048_576) * 100, 3);
        expect(above200k.exceedsLongContextTier).toBe(true);
        expect(above200k.tokensUntilLongContextTier).toBe(0);
        expect(above200k.tokensUntilCompaction).toBe(262_000);
        expect(above200k.severity).toBe('safe');

        // Lookup directly from model placeholder ID when explicit limits omitted
        const fromModel = computeContextWatermarks({
            contextUsed: 120_000,
            model: 'MODEL_PLACEHOLDER_M535',
        });
        expect(fromModel.compactionLimit).toBe(512_000);
        expect(fromModel.physicalContextWindow).toBe(1_048_576);
        expect(fromModel.exceedsLongContextTier).toBe(false);
        expect(fromModel.tokensUntilLongContextTier).toBe(80_000);

        // Smaller 128k window -> 200k marker not shown; 85% compaction -> critical severity
        const smallWin = computeContextWatermarks({
            contextUsed: 110_000,
            compactionLimit: 128_000,
            physicalContextWindow: 128_000,
        });
        expect(smallWin.hasDistinctPhysicalWindow).toBe(false);
        expect(smallWin.showLongContextMarker).toBe(false);
        expect(smallWin.longContextMarkerPctOfCompaction).toBeNull();
        expect(smallWin.exceedsLongContextTier).toBe(false);
        expect(smallWin.severity).toBe('critical');
    });
});

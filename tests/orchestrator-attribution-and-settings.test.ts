// Consolidated Domain Suite: Orchestrator Attribution, Settings & Webview UI
import packageManifest from '../package.json';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import {
    applyTrajectoryModelHints,
    extractTrajectoryModelHints,
    extractTrajectoryOrchestratorRoutes,
    mergeGMCallEntries,
    parseGMEntry,
} from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { type GMCallEntry, type GMSummary, slimCallForPersistence } from '../src/gm/types';
import { getLanguage, type Language, setLanguageToState, tBiHtml } from '../src/i18n';
import {
    getContextLimit,
    getModelDisplayName,
    getModelSpecs,
    getModelThinkingEffortLabel,
    getQuotaPoolKey,
    guessContextLimitSpec,
    localizeNeonPickerLabel,
    localizePickerEffortLabel,
    type ModelConfig,
    type OrchestratorSettings,
    resolveModelId,
    resolveOrchestratorSettings,
    updateModelDisplayNames,
    type UserQuotaSummary,
    type UserStatusInfo,
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
import { buildActiveOrchestratorPricingCard, buildPricingTabContent, getPricingTabStyles } from '../src/pricing-panel';
import {
    calculateCosts,
    DEFAULT_PRICING,
    findPricingForDate,
    getOrchestratorBaseMapping,
    getOrchestratorPricingMode,
    getUpcomingRateChangeForModel,
    type ModelPricing,
    PricingStore,
    resolvePricingDetail,
    setOrchestratorPricingMode,
} from '../src/pricing-store';
import { computeOrchestratorSplit as statusbarComputeOrchestratorSplit } from '../src/statusbar';
import {
    computeCallTelemetry,
    computeContextWatermarks,
    computeTelemetrySummary,
    evaluateSpeedSample,
    LONG_CONTEXT_TIER_THRESHOLD,
} from '../src/telemetry-metrics';
import {
    type ContextUsage,
    fetchFullUserStatus,
    fetchOrchestratorSettings,
    fetchUserQuotaSummary,
    getContextUsage,
    parseJetboxOrchestratorPrefs,
    parseOrchestratorModelRoles,
    parseUserQuotaSummary,
    processSteps,
    type TrajectorySummary,
} from '../src/tracker';
import { buildModelInfoGrid, buildModelsTabContent, buildOrchestratorSettingsCard } from '../src/webview-models-tab';
import { collectPricingInputOverrides } from '../src/webview-script';
import type { LSInfo } from '../src/discovery';
import * as zlib from 'zlib';
import { decodeConnectFirstFrame, rpcStreamFirstFrame } from '../src/rpc-client';
import { groupModelQuotas } from '../src/model-quota';
import { measuredContextDrop } from '../src/extension';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { formatOverviewCost, formatOverviewSavings, formatQuotaWindowPercent, resolveActiveOrchestratorRoute } from '../src/monitor-overview';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { buildOverviewTabContent, getOverviewStyles } from '../src/webview-overview-tab';
import { buildModelQuotaGrid, buildProfileContent } from '../src/webview-profile-tab';

describe('[orchestrator-attribution-pricing]', () => {
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
});

describe('[orchestrator-settings]', () => {
    const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };


    function makeConnectFrame(payload: unknown, flags = 0): Buffer {
        const raw = Buffer.from(JSON.stringify(payload), 'utf8');
        const body = (flags & 0x01) !== 0 ? zlib.gzipSync(raw) : raw;
        const header = Buffer.alloc(5);
        header[0] = flags;
        header.writeUInt32BE(body.length, 1);
        return Buffer.concat([header, body]);
    }


    function makeConfig(
        model: string,
        label: string,
        modelId: string,
        remaining = 0.8,
        resetTime = '2026-11-28T14:33:03Z',
    ): ModelConfig {
        return {
            model,
            label,
            modelId,
            supportsImages: true,
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
            quotaInfo: { remainingFraction: remaining, resetTime },
        };
    }


    const LIVE_LIKE_CONFIGS: ModelConfig[] = [
        makeConfig('MODEL_PLACEHOLDER_M534', 'Gemini 4 Neon (Low)', 'gemini-4-neon-low'),
        makeConfig('MODEL_PLACEHOLDER_M533', 'Gemini 4 Neon (Medium)', 'gemini-4-neon-medium'),
        makeConfig('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)', 'gemini-4-neon-high'),
        makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 'gemini-4-neon-xhigh'),
        makeConfig('MODEL_PLACEHOLDER_M438', 'Gemini 4 Carbon (Low)', 'gemini-4-carbon-low'),
        makeConfig('MODEL_PLACEHOLDER_M437', 'Gemini 4 Carbon (Medium)', 'gemini-4-carbon-medium'),
        makeConfig('MODEL_PLACEHOLDER_M427', 'Gemini 4 Carbon (High)', 'gemini-4-carbon-high'),
        makeConfig('MODEL_PLACEHOLDER_M419', 'Gemini 4 Argon (Low)', 'gemini-4-argon-low'),
        makeConfig('MODEL_PLACEHOLDER_M418', 'Gemini 4 Argon (Medium)', 'gemini-4-argon-medium'),
        makeConfig('MODEL_PLACEHOLDER_M417', 'Gemini 4 Argon (High)', 'gemini-4-argon-high'),
        makeConfig('MODEL_PLACEHOLDER_M527', 'Gemini 4 Hydrogen (Low)', 'gemini-4-hydrogen-low'),
        makeConfig('MODEL_PLACEHOLDER_M526', 'Gemini 4 Hydrogen (Medium)', 'gemini-4-hydrogen-medium'),
        makeConfig('MODEL_PLACEHOLDER_M525', 'Gemini 4 Hydrogen (High)', 'gemini-4-hydrogen-high'),
        makeConfig('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', 'gemini-4-hydrogen-xhigh'),
        makeConfig('MODEL_PLACEHOLDER_M400', 'Claude Opus 5.5 (Low)', 'claude-opus-5-5-low', 1, '2026-11-28T14:51:36Z'),
        makeConfig('MODEL_PLACEHOLDER_M401', 'Claude Opus 5.5 (Medium)', 'claude-opus-5-5-medium', 1, '2026-11-28T14:51:36Z'),
        makeConfig('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)', 'claude-opus-5-5-high', 1, '2026-11-28T14:51:36Z'),
        makeConfig('MODEL_PLACEHOLDER_M403', 'Claude Sonnet 5.5 (Low)', 'claude-sonnet-5-5-low', 1, '2026-11-28T14:51:36Z'),
        makeConfig('MODEL_PLACEHOLDER_M404', 'Claude Sonnet 5.5 (Medium)', 'claude-sonnet-5-5-medium', 1, '2026-11-28T14:51:36Z'),
        makeConfig('MODEL_PLACEHOLDER_M405', 'Claude Sonnet 5.5 (High)', 'claude-sonnet-5-5-high', 1, '2026-11-28T14:51:36Z'),
        makeConfig('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 'gemini-pro-orchestrator-neon'),
    ];


    const LIVE_MENDEL_RESPONSE = {
        experimentConfig: {
            experiments: [
                {
                    key: 'EXPERIMENT_KEY_UNSPECIFIED',
                    keyString: 'unrelated-flag',
                    string: 'true',
                },
                {
                    key: 'EXPERIMENT_KEY_UNSPECIFIED',
                    keyString: 'orchestrator-model-roles',
                    string: JSON.stringify({
                        orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
                        executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
                    }),
                    source: 'EXPERIMENT_SOURCE_LANGUAGE_SERVER',
                },
            ],
        },
    };


    const LIVE_QUOTA_SUMMARY_RESPONSE = {
        response: {
            groups: [
                {
                    displayName: 'Gemini Models',
                    description: 'Models within this group: Gemini 4 Neon, Gemini 4 Hydrogen',
                    buckets: [
                        {
                            bucketId: 'gemini-weekly',
                            displayName: 'Weekly Limit Remaining',
                            description: 'Weekly limit description',
                            window: 'weekly',
                            remainingFraction: 0.9984152,
                            resetTime: '2026-11-28T14:33:03Z',
                        },
                        {
                            bucketId: 'gemini-5h',
                            displayName: 'Five Hour Limit Remaining',
                            description: '5h limit description',
                            window: '5h',
                            remainingFraction: 0.9936607,
                            resetTime: '2026-11-21T19:33:03Z',
                        },
                    ],
                },
                {
                    displayName: 'Claude and GPT models',
                    description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
                    buckets: [
                        {
                            bucketId: '3p-weekly',
                            displayName: 'Weekly Limit Remaining',
                            window: 'weekly',
                            remainingFraction: 1,
                            resetTime: '2026-11-28T14:51:36Z',
                        },
                        {
                            bucketId: '3p-5h',
                            displayName: 'Five Hour Limit Remaining',
                            window: '5h',
                            remainingFraction: 1,
                            resetTime: '2026-11-21T19:51:36Z',
                        },
                    ],
                },
            ],
            description: 'Within each group, models share a weekly limit and a 5-hour limit.',
        },
    };


    async function withMockServer(
        handler: (req: http.IncomingMessage, res: http.ServerResponse, endpoint: string) => void,
        fn: (ls: LSInfo) => Promise<void>,
    ): Promise<void> {
        const server = http.createServer((req, res) => {
            const endpoint = (req.url || '').split('/').pop() || '';
            handler(req, res, endpoint);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const ls: LSInfo = { pid: 1, port, hostname: '127.0.0.1', csrfToken: 'test-token', useTls: false };
        try {
            await fn(ls);
        } finally {
            server.closeAllConnections?.();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    }


    afterEach(async () => {
        updateModelDisplayNames([], { authoritative: true });
        await setLanguageToState('both', memState);
    });


    describe('Connect streaming first-frame decoder and transport', () => {
        it('decodes uncompressed, gzipped, multi-chunk, and end-stream Connect frames', () => {
            const frame = makeConnectFrame({ appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' } });
            expect(decodeConnectFirstFrame(frame.subarray(0, 3))).toEqual({ done: false });
            expect(decodeConnectFirstFrame(frame.subarray(0, frame.length - 1))).toEqual({ done: false });
            expect(decodeConnectFirstFrame(frame)).toEqual({
                done: true,
                endStream: false,
                payload: { appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' } },
            });

            const gzipped = makeConnectFrame({ ok: true, count: 42 }, 0x01);
            expect(decodeConnectFirstFrame(gzipped)).toEqual({
                done: true,
                endStream: false,
                payload: { ok: true, count: 42 },
            });

            const endFrame = makeConnectFrame({ error: { code: 'unimplemented', message: 'not supported' } }, 0x02);
            expect(decodeConnectFirstFrame(endFrame)).toEqual({
                done: true,
                endStream: true,
                payload: { error: { code: 'unimplemented', message: 'not supported' } },
            });
        });

        it('rejects malformed JSON and oversized Connect envelopes', () => {
            const badBody = Buffer.from('{not-json', 'utf8');
            const badHeader = Buffer.alloc(5);
            badHeader[0] = 0;
            badHeader.writeUInt32BE(badBody.length, 1);
            expect(() => decodeConnectFirstFrame(Buffer.concat([badHeader, badBody]))).toThrow();

            const hugeHeader = Buffer.alloc(5);
            hugeHeader[0] = 0;
            hugeHeader.writeUInt32BE(60 * 1024 * 1024, 1);
            expect(() => decodeConnectFirstFrame(hugeHeader)).toThrow(/exceeded/);
        });

        it('reads frame 1 from an open server stream, handles chunking/gzip, and tears down without hanging', async () => {
            const payload = {
                appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' },
                userConfig: { userSettings: { orchestratorModel: 'MODEL_PLACEHOLDER_M401' } },
            };
            await withMockServer((_req, res, endpoint) => {
                if (endpoint === 'JetboxSubscribeToState') {
                    res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                    const frame = makeConnectFrame(payload, 0x01);
                    res.write(frame.subarray(0, 7));
                    setTimeout(() => {
                        if (!res.destroyed) {
                            res.write(frame.subarray(7));
                            // Intentionally leave stream open like live JetboxSubscribeToState
                        }
                    }, 15);
                    return;
                }
                if (endpoint === 'EndError') {
                    res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                    res.end(makeConnectFrame({ error: { code: 'not_found', message: 'missing' } }, 0x02));
                    return;
                }
                res.writeHead(501);
                res.end('Not Implemented');
            }, async (ls) => {
                const first = await rpcStreamFirstFrame(ls, 'JetboxSubscribeToState', {}, 2000);
                expect(first).toEqual(payload);
                await expect(rpcStreamFirstFrame(ls, 'EndError', {}, 2000)).rejects.toThrow(/missing/);
                await expect(rpcStreamFirstFrame(ls, 'MissingEndpoint', {}, 2000)).rejects.toThrow(/HTTP 501/);
            });
        });

        it('rejects gzip bombs whose decompressed payload exceeds MAX_RESPONSE_BODY_SIZE', () => {
            const oversized = Buffer.from(`{"a":"${'x'.repeat(55 * 1024 * 1024)}"}`, 'utf8');
            const compressed = zlib.gzipSync(oversized);
            expect(compressed.length).toBeLessThan(1024 * 1024);
            const frame = Buffer.alloc(5 + compressed.length);
            frame[0] = 0x01;
            frame.writeUInt32BE(compressed.length, 1);
            compressed.copy(frame, 5);
            expect(() => decodeConnectFirstFrame(frame)).toThrow(/maxOutputLength|length|buffer/i);
        });

        it('rejects cleanly when a non-2xx streaming response aborts mid-body without hanging', async () => {
            await withMockServer((_req, res) => {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.write('bad gateway');
                res.socket?.destroy();
            }, async (ls) => {
                await expect(rpcStreamFirstFrame(ls, 'AbortedError', {}, 2000)).rejects.toThrow();
            });
        });
    });


    describe('Orchestrator Settings resolution (Mendel roles + Jetbox prefs)', () => {
        it('parses Mendel orchestrator-model-roles and ignores disabled or malformed flags', () => {
            const roles = parseOrchestratorModelRoles(LIVE_MENDEL_RESPONSE);
            expect(roles).toEqual({
                orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
                executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
            });

            expect(parseOrchestratorModelRoles({
                experimentConfig: {
                    experiments: [{
                        keyString: 'orchestrator-model-roles',
                        disabled: true,
                        string: '{"orchestrators":["gemini-4-neon"],"executors":["gemini-4-hydrogen"]}',
                    }],
                },
            })).toBeNull();

            expect(parseOrchestratorModelRoles({
                experimentConfig: {
                    experiments: [{ keyString: 'orchestrator-model-roles', string: '{broken' }],
                },
            })).toBeNull();
        });

        it('resolves default highest-effort pair when Jetbox settings are unset / MODEL_UNSPECIFIED', () => {
            const prefs = parseJetboxOrchestratorPrefs({
                appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535' },
                userConfig: { userSettings: { orchestratorModel: 'MODEL_UNSPECIFIED' } },
            });
            const roles = parseOrchestratorModelRoles(LIVE_MENDEL_RESPONSE);
            const settings = resolveOrchestratorSettings(prefs, roles, LIVE_LIKE_CONFIGS);
            expect(settings).not.toBeNull();
            expect(settings!.mode).toBe('default');
            expect(settings!.isCustomOrchestrator).toBe(false);
            expect(settings!.isCustomExecutor).toBe(false);
            expect(settings!.effectiveOrchestratorModel).toBe('MODEL_PLACEHOLDER_M535');
            expect(settings!.effectiveOrchestratorLabel).toBe('Gemini 4 Neon (XHigh)');
            expect(settings!.effectiveExecutorModel).toBe('MODEL_PLACEHOLDER_M528');
            expect(settings!.effectiveExecutorLabel).toBe('Gemini 4 Hydrogen (XHigh)');
            expect(settings!.lastSelectedAgentModel).toBe('MODEL_PLACEHOLDER_M535');
            // Fixed legacy Orchestrator (Neon) M537 must NOT appear as a dynamic role candidate
            expect(settings!.orchestratorCandidates).not.toContain('MODEL_PLACEHOLDER_M537');
            expect(settings!.orchestratorCandidates).toContain('MODEL_PLACEHOLDER_M401');
            expect(settings!.executorCandidates).toContain('MODEL_PLACEHOLDER_M528');
            expect(settings!.executorCandidates).toContain('MODEL_PLACEHOLDER_M404');
        });

        it('resolves custom Claude Opus 5.5 + Sonnet 5.5 / Hydrogen pairs and rejects ineligible overrides', () => {
            const roles = parseOrchestratorModelRoles(LIVE_MENDEL_RESPONSE);
            const custom = resolveOrchestratorSettings({
                orchestratorModel: 'MODEL_PLACEHOLDER_M401',
                orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M404',
            }, roles, LIVE_LIKE_CONFIGS);
            expect(custom).toMatchObject({
                mode: 'custom',
                isCustomOrchestrator: true,
                isCustomExecutor: true,
                effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
                effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
                effectiveExecutorModel: 'MODEL_PLACEHOLDER_M404',
                effectiveExecutorLabel: 'Claude Sonnet 5.5 (Medium)',
            });

            // Passing an executor-only model as orchestrator override falls back to default Neon XHigh
            const invalidOrch = resolveOrchestratorSettings({
                orchestratorModel: 'MODEL_PLACEHOLDER_M528',
                orchestratorExecutorModel: 'MODEL_UNSPECIFIED',
            }, roles, LIVE_LIKE_CONFIGS);
            expect(invalidOrch).toMatchObject({
                mode: 'default',
                isCustomOrchestrator: false,
                effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
                effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
            });

            // Without roles or explicit overrides, resolves to null cleanly
            expect(resolveOrchestratorSettings({ orchestratorModel: 'MODEL_UNSPECIFIED' }, null, LIVE_LIKE_CONFIGS)).toBeNull();
        });

        it('fetches live Orchestrator Settings over HTTP and degrades cleanly to null on 404/501', async () => {
            await withMockServer((_req, res, endpoint) => {
                if (endpoint === 'JetboxSubscribeToState') {
                    res.writeHead(200, { 'Content-Type': 'application/connect+json' });
                    res.write(makeConnectFrame({
                        appState: { lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M401' },
                        userConfig: {
                            userSettings: {
                                orchestratorModel: 'MODEL_PLACEHOLDER_M401',
                                orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M528',
                            },
                        },
                    }));
                    return;
                }
                if (endpoint === 'GetMendelFlags') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(LIVE_MENDEL_RESPONSE));
                    return;
                }
                res.writeHead(404);
                res.end();
            }, async (ls) => {
                const settings = await fetchOrchestratorSettings(ls, LIVE_LIKE_CONFIGS);
                expect(settings).toMatchObject({
                    mode: 'custom',
                    effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
                    effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
                    lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M401',
                });
            });

            await withMockServer((_req, res) => {
                res.writeHead(501);
                res.end();
            }, async (ls) => {
                expect(await fetchOrchestratorSettings(ls, LIVE_LIKE_CONFIGS, undefined, { disableConfigFallback: true })).toBeNull();
            });
        });
    });


    describe('Dual-window quota summary (RetrieveUserQuotaSummary) & groupedModels', () => {
        it('parses 5h and weekly quota windows and attaches them to groupModelQuotas without breaking legacy output', () => {
            const summary = parseUserQuotaSummary(LIVE_QUOTA_SUMMARY_RESPONSE);
            expect(summary).not.toBeNull();
            expect(summary!.groups).toHaveLength(2);
            const geminiSummary = summary!.groups.find(g => g.pool === 'gemini')!;
            const premiumSummary = summary!.groups.find(g => g.pool === 'premium')!;
            expect(geminiSummary.fiveHour?.remainingFraction).toBeCloseTo(0.9936607, 6);
            expect(geminiSummary.weekly?.remainingFraction).toBeCloseTo(0.9984152, 6);
            expect(premiumSummary.fiveHour?.remainingFraction).toBe(1);
            expect(premiumSummary.weekly?.remainingFraction).toBe(1);

            // Backward compatibility: omitting summary leaves dual-window fields undefined
            const legacyGroups = groupModelQuotas(LIVE_LIKE_CONFIGS);
            expect(legacyGroups.every(g => g.fiveHourQuota === undefined && g.weeklyQuota === undefined)).toBe(true);

            // Passing quotaSummary attaches exact 5h + weekly windows to matching canonical pools
            const enrichedGroups = groupModelQuotas(LIVE_LIKE_CONFIGS, summary);
            const geminiGroup = enrichedGroups.find(g => g.pool === 'gemini')!;
            const premiumGroup = enrichedGroups.find(g => g.pool === 'premium')!;
            expect(geminiGroup.minimum).toBe(0.8);
            expect(geminiGroup.fiveHourQuota?.bucketId).toBe('gemini-5h');
            expect(geminiGroup.weeklyQuota?.bucketId).toBe('gemini-weekly');
            expect(premiumGroup.fiveHourQuota?.bucketId).toBe('3p-5h');
            expect(premiumGroup.weeklyQuota?.bucketId).toBe('3p-weekly');
        });

        it('handles proto3 omitted remainingFraction and rejects invalid timestamps/fractions', () => {
            const parsed = parseUserQuotaSummary({
                response: {
                    groups: [{
                        displayName: 'Gemini Models',
                        buckets: [
                            // Omitted fraction + valid future reset → exhausted (0)
                            { bucketId: 'gemini-5h', window: '5h', resetTime: '2026-11-21T19:33:03Z' },
                            // Omitted fraction + epoch reset → untouched (1), resetAt null
                            { bucketId: 'gemini-weekly', window: 'weekly', resetTime: '1970-01-01T00:00:00.000Z' },
                            // Invalid calendar day & out-of-range fraction → nulls
                            { bucketId: 'gemini-bad', window: 'other', remainingFraction: 1.5, resetTime: '2026-11-31T00:00:00Z' },
                        ],
                    }],
                },
            });
            expect(parsed).not.toBeNull();
            expect(parsed!.groups[0].fiveHour?.remainingFraction).toBe(0);
            expect(parsed!.groups[0].weekly?.remainingFraction).toBe(1);
            expect(parsed!.groups[0].weekly?.resetAt).toBeNull();
            expect(parsed!.groups[0].buckets[2].remainingFraction).toBeNull();
            expect(parsed!.groups[0].buckets[2].resetTime).toBeNull();
        });

        it('fetches RetrieveUserQuotaSummary & groupedModels via live-shaped HTTP and degrades cleanly', async () => {
            await withMockServer((_req, res, endpoint) => {
                if (endpoint === 'RetrieveUserQuotaSummary') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(LIVE_QUOTA_SUMMARY_RESPONSE));
                    return;
                }
                if (endpoint === 'GetUserStatus') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        userStatus: {
                            cascadeModelConfigData: {
                                clientModelConfigs: [{
                                    label: 'Gemini 4 Neon (XHigh)',
                                    modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' },
                                    modelId: 'gemini-4-neon-xhigh',
                                    tagTitle: 'New',
                                    tagDescription: 'Highest reasoning effort',
                                    supportsImages: true,
                                    quotaInfo: { remainingFraction: 1, resetTime: '2026-11-21T19:33:03Z' },
                                }],
                                groupedModels: {
                                    'gemini-4-neon': {
                                        displayName: 'Gemini 4 Neon',
                                        defaultThinkingSuffix: 'medium',
                                        supportedThinkingLevels: [
                                            { thinkingSuffix: 'xhigh', thinkingDisplayName: 'Extra High' },
                                        ],
                                    },
                                },
                            },
                        },
                    }));
                    return;
                }
                res.writeHead(404);
                res.end();
            }, async (ls) => {
                const quota = await fetchUserQuotaSummary(ls);
                expect(quota?.groups).toHaveLength(2);
                const status = await fetchFullUserStatus(ls);
                expect(status.configs[0]).toMatchObject({
                    model: 'MODEL_PLACEHOLDER_M535',
                    modelId: 'gemini-4-neon-xhigh',
                    tagDescription: 'Highest reasoning effort',
                });
                expect(status.groupedModels?.['gemini-4-neon']).toEqual({
                    displayName: 'Gemini 4 Neon',
                    defaultThinkingSuffix: 'medium',
                    supportedThinkingLevels: [{ thinkingSuffix: 'xhigh', thinkingDisplayName: 'Extra High' }],
                });
            });

            await withMockServer((_req, res) => {
                res.writeHead(404);
                res.end();
            }, async (ls) => {
                expect(await fetchUserQuotaSummary(ls)).toBeNull();
            });
        });
    });


    describe('Cross-pool Orchestrator trajectory & context limit handling', () => {
        const opusMedium = 'MODEL_PLACEHOLDER_M401';
        const hydrogenXHigh = 'MODEL_PLACEHOLDER_M528';
        const shadowCheckpoint = 'MODEL_PLACEHOLDER_M50';

        const makeTrajectory = (stepCount: number): TrajectorySummary => ({
            cascadeId: 'cross-pool-1',
            trajectoryId: 'traj-1',
            summary: 'Cross-pool Orchestrator run',
            stepCount,
            status: 'CASCADE_RUN_STATUS_IDLE',
            lastModifiedTime: '2026-11-21T15:00:00Z',
            createdTime: '2026-11-21T14:55:00Z',
            requestedModel: '',
            generatorModel: '',
            workspaceUris: [],
            lastUserInputTime: '2026-11-21T14:55:00Z',
            lastUserInputStepIndex: 0,
            repositoryName: '',
            gitOriginUrl: '',
            branchName: '',
            gitRootUri: '',
        });

        it('tracks planModel + executionModel without clobbering coordinator identity and prevents false compression', () => {
            const userInput = {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: {
                    userResponse: 'Refactor module',
                    userConfig: {
                        plannerConfig: {
                            planModel: opusMedium,
                            planExecuteConfig: { executionModel: hydrogenXHigh },
                        },
                    },
                },
            };
            const plannerStep = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                metadata: {
                    generatorModel: opusMedium,
                    modelUsage: { model: opusMedium, inputTokens: 120_000, outputTokens: 1_500, cacheReadTokens: 0 },
                },
            };
            const executorStep = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                metadata: {
                    generatorModel: hydrogenXHigh,
                    modelUsage: { model: hydrogenXHigh, inputTokens: 40_000, outputTokens: 800, cacheReadTokens: 0 },
                },
            };

            const atPlanner = processSteps([userInput, plannerStep]);
            expect(atPlanner.model).toBe(opusMedium);
            expect(atPlanner.orchestratorConfig).toEqual({ planModel: opusMedium, executionModel: hydrogenXHigh });
            expect(atPlanner.lastModelUsage?.model).toBe(opusMedium);

            const atExecutor = processSteps([userInput, plannerStep, executorStep]);
            // Selected coordinator model stays Opus 5.5 while lastModelUsage reflects executor Hydrogen
            expect(atExecutor.model).toBe(opusMedium);
            expect(atExecutor.orchestratorConfig).toEqual({ planModel: opusMedium, executionModel: hydrogenXHigh });
            expect(atExecutor.lastModelUsage?.model).toBe(hydrogenXHigh);

            // Switching from Opus 5.5 planner (120K) to Hydrogen executor (40K) is NOT context compression
            expect(measuredContextDrop(
                { ...atPlanner, contextLimit: 255_000 },
                { ...atExecutor, contextLimit: 511_000 },
                false,
            )).toBe(0);

            // Switching to a regular non-Orchestrator model in a later turn clears orchestratorConfig
            const normalUserInput = {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: {
                    userResponse: 'Normal follow-up',
                    userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M535' } },
                },
            };
            const afterSwitch = processSteps([userInput, plannerStep, executorStep, normalUserInput]);
            expect(afterSwitch.model).toBe('MODEL_PLACEHOLDER_M535');
            expect(afterSwitch.orchestratorConfig).toBeUndefined();

            // Switching directly to the former executor (M528) via plannerConfig.requestedModel clears orchestratorConfig
            const directExecUserInput = {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: {
                    userResponse: 'Switch directly to Hydrogen',
                    userConfig: { plannerConfig: { requestedModel: { model: hydrogenXHigh } } },
                },
            };
            const directExecReply = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                metadata: {
                    requestedModel: { model: hydrogenXHigh },
                    generatorModel: hydrogenXHigh,
                    modelUsage: { model: hydrogenXHigh, inputTokens: 15_000, outputTokens: 500, cacheReadTokens: 0 },
                },
            };
            const afterDirectExec = processSteps([userInput, plannerStep, executorStep, directExecUserInput, directExecReply]);
            expect(afterDirectExec.model).toBe(hydrogenXHigh);
            expect(afterDirectExec.orchestratorConfig).toBeUndefined();

            // Switching to a different concrete model via metadata.requestedModel without USER_INPUT.planModel clears stale orchestratorConfig
            const metaSwitchReply = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                metadata: {
                    requestedModel: { model: 'MODEL_PLACEHOLDER_M532' },
                    generatorModel: 'MODEL_PLACEHOLDER_M532',
                    modelUsage: { model: 'MODEL_PLACEHOLDER_M532', inputTokens: 10_000, outputTokens: 400, cacheReadTokens: 0 },
                },
            };
            const afterMetaSwitch = processSteps([userInput, metaSwitchReply]);
            expect(afterMetaSwitch.model).toBe('MODEL_PLACEHOLDER_M532');
            expect(afterMetaSwitch.orchestratorConfig).toBeUndefined();

            // Canonical alias-equivalent planModel and executionModel do not create self-delegating orchestratorConfig
            const selfAliasInput = {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: {
                    userResponse: 'Self alias',
                    userConfig: {
                        plannerConfig: {
                            planModel: hydrogenXHigh,
                            planExecuteConfig: { executionModel: 'gemini-4-hydrogen-xhigh' },
                        },
                    },
                },
            };
            const selfAliasRes = processSteps([selfAliasInput]);
            expect(selfAliasRes.model).toBe(hydrogenXHigh);
            expect(selfAliasRes.orchestratorConfig).toBeUndefined();
        });

        it('uses snapshot model limit for planner snapshots and NEVER shadow M50 for checkpoint snapshots', async () => {
            const userInput = {
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: {
                    userResponse: 'Run task',
                    userConfig: {
                        plannerConfig: {
                            planModel: opusMedium,
                            planExecuteConfig: { executionModel: hydrogenXHigh },
                        },
                    },
                },
            };
            const executorStep = {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                metadata: {
                    generatorModel: hydrogenXHigh,
                    modelUsage: { model: hydrogenXHigh, inputTokens: 100_000, outputTokens: 2_000, cacheReadTokens: 0 },
                },
            };
            const checkpointStep = {
                type: 'CORTEX_STEP_TYPE_CHECKPOINT',
                metadata: {
                    generatorModel: shadowCheckpoint,
                    modelUsage: { model: shadowCheckpoint, inputTokens: 90_000, outputTokens: 1_000, cacheReadTokens: 0 },
                },
            };

            let stepsToServe: Array<Record<string, unknown>> = [userInput, executorStep];
            await withMockServer((_req, res, endpoint) => {
                if (endpoint === 'GetCascadeTrajectorySteps') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps: stepsToServe }));
                    return;
                }
                res.writeHead(404);
                res.end();
            }, async (ls) => {
                // Planner snapshot from Hydrogen executor → 511K limit (Gemini 4 512K cold-start)
                const execUsage = await getContextUsage(ls, makeTrajectory(2));
                expect(execUsage.model).toBe(opusMedium);
                expect(execUsage.orchestratorConfig).toEqual({ planModel: opusMedium, executionModel: hydrogenXHigh });
                expect(execUsage.contextLimit).toBe(511_000);

                // Checkpoint snapshot with shadow M50 (128K) → must use effectiveModel (Opus 5.5 = 255K), NOT 127K!
                stepsToServe = [userInput, checkpointStep];
                const ckptUsage = await getContextUsage(ls, makeTrajectory(2));
                expect(ckptUsage.tokenUsageSource).toBe('checkpoint');
                expect(ckptUsage.checkpointModel).toBe(shadowCheckpoint);
                expect(ckptUsage.contextLimit).toBe(255_000);
            });
        });
    });


    describe('Catalog-only Hydrogen models, M669 dual labels, Extra High localization & Claude Orchestrator pool', () => {
        it('resolves M530, M531, M578 and both live + legacy M669 worker names', () => {
            expect(resolveModelId('gemini-4-hydrogen-tiered-high')).toBe('MODEL_PLACEHOLDER_M530');
            expect(resolveModelId('gemini-4-hydrogen-tiered-xhigh')).toBe('MODEL_PLACEHOLDER_M531');
            expect(resolveModelId('gemini-4-hydrogen-sonar')).toBe('MODEL_PLACEHOLDER_M578');
            expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M530')).toBe('gemini');
            expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M531')).toBe('gemini');
            expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M578')).toBe('gemini');
            expect(getContextLimit('MODEL_PLACEHOLDER_M530')).toBe(511_000);
            expect(getContextLimit('MODEL_PLACEHOLDER_M531')).toBe(511_000);
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M578')).toEqual({
                cpLimit: 0, cpThreshold: 0, maxTokens: 1_048_576, supportsThinking: true,
            });

            expect(getModelDisplayName('MODEL_PLACEHOLDER_M669')).toBe('Gemini 4 Hydrogen (Orchestrator)');
            expect(resolveModelId('Gemini 4 Hydrogen (Orchestrator)')).toBe('MODEL_PLACEHOLDER_M669');
            expect(resolveModelId('Gemini Flash (Orchestrator Worker)')).toBe('MODEL_PLACEHOLDER_M669');
            expect(resolveModelId('gemini-flash-worker-agy')).toBe('MODEL_PLACEHOLDER_M669');
            expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M669')?.thinkingLevel).toBe(100);
        });

        it('localizes Extra High consistently across both Gemini 4 Neon and Gemini 4 Hydrogen', () => {
            expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 'en')).toBe('Gemini 4 Neon (Extra High)');
            expect(localizeNeonPickerLabel('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', 'en')).toBe('Gemini 4 Hydrogen (Extra High)');
            expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 'zh')).toBe('Gemini 4 Neon (超高)');
            expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (Extra)', 'zh')).toBe('Gemini 4 Hydrogen (超高)');
            expect(localizePickerEffortLabel('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', 'both')).toBe('Gemini 4 Hydrogen (Extra High / 超高)');
        });

        it('maps dynamic Orchestrator Claude labels to the premium quota pool', () => {
            expect(getQuotaPoolKey('Orchestrator (Claude Opus 5.5)')).toBe('premium');
            expect(getQuotaPoolKey('Orchestrator (Claude Sonnet 5.5 Medium)')).toBe('premium');
        });
    });


    describe('GM parser dynamic Orchestrator fields & fallback hints', () => {
        it('extracts executionModel and modelDisplayName and preserves executionModel through merge and slimming', () => {
            const call = parseGMEntry({
                executionId: 'dyn-orch-1',
                stepIndices: [1],
                plannerConfig: {
                    planModel: 'MODEL_PLACEHOLDER_M401',
                    planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' },
                },
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M401',
                    modelDisplayName: 'Claude Opus 5.5 (Medium)',
                    responseModel: 'claude-opus-5-5',
                    usage: { inputTokens: 1000, outputTokens: 200 },
                },
            });
            expect(call.executionModel).toBe('MODEL_PLACEHOLDER_M528');
            expect(call.modelDisplayName).toBe('Claude Opus 5.5 (Medium)');

            const slim = slimCallForPersistence(call);
            expect(slim.executionModel).toBe('MODEL_PLACEHOLDER_M528');

            const bare = parseGMEntry({
                executionId: 'dyn-orch-1',
                stepIndices: [1],
                chatModel: { model: 'MODEL_PLACEHOLDER_M401', usage: { inputTokens: 1000, outputTokens: 200 } },
            });
            const merged = mergeGMCallEntries(bare, call);
            expect(merged.executionModel).toBe('MODEL_PLACEHOLDER_M528');
            expect(merged.modelDisplayName).toBe('Claude Opus 5.5 (Medium)');
        });

        it('uses plannerConfig.planModel as fallback trajectory hint without overriding concrete chatModel', () => {
            const steps = [{
                stepIndex: 0,
                type: 'CORTEX_STEP_TYPE_USER_INPUT',
                userInput: {
                    userConfig: {
                        plannerConfig: {
                            planModel: 'MODEL_PLACEHOLDER_M401',
                            planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M528' },
                        },
                    },
                },
            }];
            const hints = extractTrajectoryModelHints(steps);
            expect(hints.get(0)).toBe('MODEL_PLACEHOLDER_M401');

            // Unknown call recovers planModel from trajectory hint
            const unknownCall = parseGMEntry({ stepIndices: [0], chatModel: { usage: { inputTokens: 50 } } });
            const recovered = applyTrajectoryModelHints([unknownCall], steps);
            expect(recovered[0].model).toBe('MODEL_PLACEHOLDER_M401');
            expect(recovered[0].modelSource).toBe('trajectory');

            // Authoritative executor call keeps its own M528 identity and is NOT overwritten by planModel
            const executorCall = parseGMEntry({
                stepIndices: [0],
                chatModel: { model: 'MODEL_PLACEHOLDER_M528', responseModel: 'gemini-4-hydrogen', usage: { inputTokens: 50 } },
            });
            const preserved = applyTrajectoryModelHints([executorCall], steps);
            expect(preserved[0].model).toBe('MODEL_PLACEHOLDER_M528');
            expect(preserved[0].modelSource).toBe('chatModel');
        });
    });
});

describe('[webview-orchestrator-ui]', () => {
    const initialLang = getLanguage();

    const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };

    const NOW = Date.parse('2026-11-21T15:00:00Z');


    function makeConfig(
        model: string,
        overrides: Partial<ModelConfig> = {},
    ): ModelConfig {
        return {
            model,
            label: overrides.label || getModelDisplayName(model),
            supportsImages: true,
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
            quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-21T19:33:03Z' },
            ...overrides,
        };
    }


    const SAMPLE_ORCH_DEFAULT: OrchestratorSettings = {
        configuredOrchestratorModel: '',
        configuredExecutorModel: '',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorLabel: 'Gemini 4 Neon (XHigh)',
        effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
        isCustomOrchestrator: false,
        isCustomExecutor: false,
        mode: 'default',
        roles: {
            orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
            executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
        },
        orchestratorCandidates: ['MODEL_PLACEHOLDER_M535', 'MODEL_PLACEHOLDER_M401'],
        executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
        lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535',
    };


    const SAMPLE_ORCH_CUSTOM: OrchestratorSettings = {
        ...SAMPLE_ORCH_DEFAULT,
        configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
        effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
        isCustomOrchestrator: true,
        isCustomExecutor: true,
        mode: 'custom',
    };


    const SAMPLE_QUOTA_SUMMARY: UserQuotaSummary = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.9936607,
                    resetTime: '2026-11-21T19:33:03Z',
                    resetAt: Date.parse('2026-11-21T19:33:03Z'),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.9984152,
                    resetTime: '2026-11-28T14:33:03Z',
                    resetAt: Date.parse('2026-11-28T14:33:03Z'),
                },
                buckets: [],
            },
            {
                pool: 'premium',
                displayName: 'Claude and GPT models',
                fiveHour: {
                    bucketId: '3p-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.72,
                    resetTime: '2026-11-21T19:51:36Z',
                    resetAt: Date.parse('2026-11-21T19:51:36Z'),
                },
                weekly: {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 1,
                    resetTime: '2026-11-28T14:51:36Z',
                    resetAt: Date.parse('2026-11-28T14:51:36Z'),
                },
                buckets: [],
            },
        ],
    };


    function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
        return {
            cascadeId: 'orch-conv-1',
            title: 'Cross-pool refactor',
            model: 'MODEL_PLACEHOLDER_M401',
            modelDisplayName: 'Claude Opus 5.5 (Medium)',
            contextUsed: 84_000,
            totalOutputTokens: 1_200,
            totalToolCallOutputTokens: 8_000,
            contextLimit: 256_000,
            usagePercent: 32.8125,
            stepCount: 12,
            lastModifiedTime: '2026-11-21T14:59:00Z',
            status: 'IDLE',
            isEstimated: false,
            lastModelUsage: null,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: false,
            checkpointModel: '',
            createdTime: '2026-11-21T14:50:00Z',
            lastUserInputTime: '2026-11-21T14:58:00Z',
            lastUserInputStepIndex: 10,
            repositoryName: '',
            gitOriginUrl: '',
            branchName: '',
            gitRootUri: '',
            orchestratorConfig: {
                planModel: 'MODEL_PLACEHOLDER_M401',
                executionModel: 'MODEL_PLACEHOLDER_M528',
            },
            ...overrides,
        };
    }


    function makeUserInfo(): UserStatusInfo {
        return {
            name: 'Alice',
            email: 'alice@example.test',
            planName: 'Google AI Ultra',
            teamsTier: '',
            userTierName: 'Google AI Ultra',
            userTierId: 'ultra',
            defaultModelLabel: 'Gemini 4 Neon (XHigh)',
            planLimits: {
                maxNumChatInputTokens: 1_000_000,
                maxNumPremiumChatMessages: -1,
                maxCustomChatInstructionCharacters: 12_000,
                maxNumPinnedContextItems: 20,
                maxLocalIndexSize: 100_000,
                monthlyFlexCreditPurchaseAmount: 0,
            },
            teamConfig: {
                allowMcpServers: true,
                allowAutoRunCommands: true,
                allowBrowserExperimentalFeatures: false,
            },
            availableCredits: [],
            canBuyMoreCredits: false,
            browserEnabled: true,
            cascadeWebSearchEnabled: true,
            knowledgeBaseEnabled: true,
            canGenerateCommitMessages: true,
            cascadeCanAutoRunCommands: true,
            canAllowCascadeInBackground: true,
            hasAutocompleteFastMode: true,
            allowStickyPremiumModels: true,
            allowPremiumCommandModels: true,
            hasTabToJump: true,
            canCustomizeAppIcon: true,
            userTierDescription: '',
            upgradeSubscriptionText: '',
            modelSortOrder: [],
        };
    }


    function makeCalendarStore(records: DailyStoreState['records']): DailyStore {
        const store = new DailyStore();
        store.restoreSnapshot({ version: 1, records });
        return store;
    }


    afterEach(async () => {
        await setLanguageToState(initialLang, memState);
    });


    describe('Models tab: Orchestrator Settings card, API reference price row & Notice badge', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders Orchestrator Settings card in default and custom modes in %s', async lang => {
            await setLanguageToState(lang, memState);
            expect(buildOrchestratorSettingsCard(null)).toBe('');

            const defaultHtml = buildModelsTabContent(null, [
                makeConfig('MODEL_PLACEHOLDER_M535'),
                makeConfig('MODEL_PLACEHOLDER_M528'),
            ], { orchestratorSettings: SAMPLE_ORCH_DEFAULT });
            expect(defaultHtml).toContain('class="card orch-settings-card"');
            expect(defaultHtml).toContain('data-orchestrator-mode="default"');
            expect(defaultHtml).toContain('Gemini 4 Neon');
            expect(defaultHtml).toContain('Gemini 4 Hydrogen');
            expect(defaultHtml).toContain(lang === 'zh' ? '超高' : 'Extra High');
            expect(defaultHtml).toContain('Claude Opus 5.5');
            expect(defaultHtml).toContain('Claude Sonnet 5.5');
            expect(defaultHtml).not.toContain('令牌');

            const customHtml = buildModelsTabContent(null, [
                makeConfig('MODEL_PLACEHOLDER_M401'),
                makeConfig('MODEL_PLACEHOLDER_M528'),
            ], { orchestratorSettings: SAMPLE_ORCH_CUSTOM });
            expect(customHtml).toContain('data-orchestrator-mode="custom"');
            expect(customHtml).toContain('Claude / GPT');
            expect(customHtml).toContain('Gemini');
            expect(customHtml).toContain(lang === 'zh' ? '自定义' : 'Custom');
            expect(customHtml).toContain(lang === 'zh' ? '已指定' : 'Pinned');
            expect(customHtml).not.toContain('令牌');
        });

        it('renders concise API reference prices in USD and honest Unpriced badges for unpriced models', async () => {
            await setLanguageToState('en', memState);
            const neonSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M535')!;
            const orchSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M537')!;
            const workerSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M669')!;
            const imgSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M21')!;

            const usdHtml = buildModelInfoGrid([neonSpec, orchSpec, workerSpec], 'chat');
            expect(usdHtml).toContain('class="spec-price-row"');
            expect(usdHtml).toContain('$3/M');
            expect(usdHtml).toContain('$15/M');
            expect(usdHtml).toContain('$0.15/M');
            expect(usdHtml).not.toMatch(/[\u00a5\uffe5]/);
            // Default mapped mode shows mapped base prices for M537/M669 with transparent badge
            expect(usdHtml.match(/data-price-state="mapped"/g)).toHaveLength(2);
            expect(usdHtml).toContain('Est. via Base Model');
            expect(usdHtml).not.toContain('$0.00');

            // Strict mode renders honest Unpriced badges for M537/M669
            const strictHtml = buildModelInfoGrid([neonSpec, orchSpec, workerSpec], 'chat', {
                orchestratorPricingMode: 'strict',
            });
            expect(strictHtml.match(/data-price-state="unpriced"/g)).toHaveLength(2);
            expect(strictHtml).toContain('Unpriced');
            expect(strictHtml).not.toContain('$0.00');

            await setLanguageToState('zh', memState);
            const imgHtml = buildModelInfoGrid([imgSpec], 'image');
            expect(imgHtml).toContain('data-price-state="unpriced"');
            expect(imgHtml).toContain('未定价');
        });

        it.each(['en', 'zh', 'both'] as Language[])('renders amber Notice tag for GPT-OSS 120B and dual-window quota bars in %s', async lang => {
            await setLanguageToState(lang, memState);
            const configs = [
                makeConfig('MODEL_PLACEHOLDER_M535'),
                makeConfig('MODEL_PLACEHOLDER_M401'),
                makeConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', { tagTitle: 'Notice' }),
            ];
            const html = buildModelQuotaGrid(configs, { quotaSummary: SAMPLE_QUOTA_SUMMARY });
            expect(html).toContain('tag-notice');
            expect(html).toContain(lang === 'zh' ? '提示' : 'Notice');
            expect(html).toContain('class="quota-dual-row"');
            expect(html).toContain('data-quota-window="5h"');
            expect(html).toContain('data-quota-window="weekly"');
            expect(html).toContain('99.3%');
            expect(html).toContain('99.8%');
            expect(html).toContain('72%');
            expect(html).not.toContain('令牌');

            const profileHtml = buildProfileContent(makeUserInfo(), configs, 15, SAMPLE_QUOTA_SUMMARY);
            expect(profileHtml).toContain('class="quota-dual-row"');
            expect(profileHtml).toContain('tag-notice');
        });
    });


    describe('Overview tab: active Orchestrator route, Session/Today cost & Dual-window quota', () => {
        it.each(['en', 'zh', 'both'] as Language[])('shows active cross-pool Orchestrator route, USD cost, and 5h + Weekly meters in %s', async lang => {
            await setLanguageToState(lang, memState);
            const route = resolveActiveOrchestratorRoute(makeUsage());
            expect(route).not.toBeNull();
            expect(route!.isCrossPool).toBe(true);
            expect(route!.plannerPool).toBe('premium');
            expect(route!.executorPool).toBe('gemini');

            const html = buildOverviewTabContent(
                makeUsage(),
                [makeConfig('MODEL_PLACEHOLDER_M401'), makeConfig('MODEL_PLACEHOLDER_M528')],
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                {
                    orchestratorSettings: SAMPLE_ORCH_CUSTOM,
                    quotaSummary: SAMPLE_QUOTA_SUMMARY,
                    sessionCostUsd: 0.45,
                    todayCostUsd: 1.25,
                },
            );
            expect(html).toContain('class="orch-route-pill"');
            expect(html).toContain('data-cross-pool="true"');
            expect(html).toContain('Claude Opus 5.5 (Medium)');
            expect(html).toContain(lang === 'zh' ? 'Gemini 4 Hydrogen (超高)' : 'Gemini 4 Hydrogen (Extra High');
            expect(html).toContain('$0.45');
            expect(html).toContain('$1.25');
            expect(html).not.toMatch(/[\u00a5\uffe5]/);
            expect(html).toContain('class="quota-dual-row"');
            expect(html).toContain('data-quota-window="5h"');
            expect(html).toContain('data-quota-window="weekly"');
            expect(html).toContain('99.3%');
            expect(html).toContain('99.8%');
            expect(html).toContain(lang === 'zh' ? '规划' : 'Planner');
            expect(html).toContain(lang === 'zh' ? '执行' : 'Executor');
            expect(html).not.toContain('令牌');
            expect(html).not.toMatch(/NaN|Infinity/);
        });

        it('falls back cleanly to 5h-only meters when quotaSummary is absent and formats helper edge cases safely', () => {
            expect(formatQuotaWindowPercent(1)).toBe('100%');
            expect(formatQuotaWindowPercent(0)).toBe('0%');
            expect(formatQuotaWindowPercent(0.9936607)).toBe('99.3%');
            expect(formatQuotaWindowPercent(0.72)).toBe('72%');
            expect(formatQuotaWindowPercent(null)).toBe('—');
            expect(formatOverviewCost(NaN)).toBeNull();
            expect(formatOverviewCost(-1)).toBeNull();
            expect(formatOverviewCost(Number.POSITIVE_INFINITY)).toBeNull();
            expect(formatOverviewCost(1.25)).toBe('$1.25');
            expect(formatOverviewCost(0.0042)).toBe('$0.0042');
            expect(formatOverviewSavings(0.27)).toBe('$0.27');
            expect(formatOverviewSavings(0.000001)).toBe('<$0.0001');
            expect(formatOverviewSavings(0)).toBeNull();
            expect(formatOverviewSavings(Number.POSITIVE_INFINITY)).toBeNull();

            const fallbackHtml = buildOverviewTabContent(
                makeUsage({ orchestratorConfig: undefined }),
                [makeConfig('MODEL_PLACEHOLDER_M535')],
                null,
                0,
                { state: 'active' },
                NOW,
            );
            expect(fallbackHtml).not.toContain('class="orch-route-pill"');
            expect(fallbackHtml).not.toContain('class="quota-dual-row"');
            expect(fallbackHtml).toContain('80%');
        });

        it('guards invalid/out-of-range dual-window fractions, edge rounding, and epoch-0 reset timestamps', async () => {
            await setLanguageToState('en', memState);
            expect(formatQuotaWindowPercent(1)).toBe('100%');
            expect(formatQuotaWindowPercent(0.9999)).toBe('99.9%');
            expect(formatQuotaWindowPercent(0.9996)).toBe('99.9%');
            expect(formatQuotaWindowPercent(0.9984152)).toBe('99.8%');
            expect(formatQuotaWindowPercent(0.993)).toBe('99.3%');
            expect(formatQuotaWindowPercent(0.004)).toBe('<1%');
            expect(formatQuotaWindowPercent(0.0001)).toBe('<1%');
            expect(formatQuotaWindowPercent(0)).toBe('0%');
            expect(formatQuotaWindowPercent(Number.NaN)).toBe('—');
            expect(formatQuotaWindowPercent(-0.1)).toBe('—');
            expect(formatQuotaWindowPercent(1.5)).toBe('—');

            const malformedQuotaSummary: UserQuotaSummary = {
                groups: [
                    {
                        groupId: 'gemini-pool',
                        pool: 'gemini',
                        fiveHour: { remainingFraction: Number.NaN, resetTime: '1970-01-01T00:00:00Z' },
                        weekly: { remainingFraction: 1.5, resetTime: 'not-a-date' },
                    },
                    {
                        groupId: 'premium-pool',
                        pool: 'premium',
                        fiveHour: { remainingFraction: -0.2, resetTime: null },
                        weekly: { remainingFraction: 0.004, resetTime: '2026-11-28T00:00:00Z' },
                    },
                ],
            };
            const configs = [
                makeConfig('MODEL_PLACEHOLDER_M535'),
                makeConfig('MODEL_PLACEHOLDER_M402'),
            ];

            const overviewHtml = buildOverviewTabContent(
                makeUsage(),
                configs,
                null,
                0,
                { state: 'active' },
                NOW,
                { quotaSummary: malformedQuotaSummary },
            );
            expect(overviewHtml).not.toMatch(/NaN|width:150%|width:-20%|aria-valuenow="150"/);
            expect(overviewHtml).toContain('overview-meter is-unknown');
            expect(overviewHtml).toContain('&lt;1%');

            const profileHtml = buildProfileContent(makeUserInfo(), configs, 0, malformedQuotaSummary);
            expect(profileHtml).not.toMatch(/NaN|width:150%|width:-20%|aria-valuenow="150"/);
            expect(profileHtml).toContain('quota-bar-wrap is-unknown');
            expect(profileHtml).toContain('Reset time unavailable');
            expect(profileHtml).not.toContain('Reset 0m');
            expect(profileHtml).toContain('&lt;1%');
        });
    });


    describe('Calendar tab USD costs & About tab v1.17.4 + 512K disclaimer & shared CSS', () => {
        it('formats daily, monthly, and per-model Calendar costs strictly in USD and guards Infinity', async () => {
            await setLanguageToState('en', memState);
            const store = makeCalendarStore({
                '2026-11-21': {
                    date: '2026-11-21',
                    cycles: [{
                        startTime: '2026-11-21T00:00:00Z',
                        endTime: '2026-11-21T23:59:59Z',
                        totalReasoning: 0,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalInputTokens: 0,
                        totalOutputTokens: 0,
                        estSteps: 0,
                        modelNames: [],
                        gmTotalCalls: 5,
                        gmTotalCredits: 0,
                        gmTotalTokens: 100_000,
                        estimatedCost: 1.5,
                        gmModelStats: {
                            'Gemini 4 Neon (XHigh)': {
                                calls: 5,
                                credits: 0,
                                inputTokens: 80_000,
                                outputTokens: 20_000,
                                thinkingTokens: 5_000,
                                avgTTFT: 0.5,
                                cacheHitRate: 0.8,
                                estimatedCost: 1.5,
                            },
                        },
                    }],
                },
            });

            const usdHtml = buildCalendarTabContent(store, 2026, 11);
            expect(usdHtml).toContain('$1.50');
            expect(usdHtml).not.toMatch(/[\u00a5\uffe5]/);

            // Guard Infinity against empty/dash cost chips
            const extremeStore = makeCalendarStore({
                '2026-11-22': {
                    date: '2026-11-22',
                    cycles: [{
                        startTime: '2026-11-22T00:00:00Z',
                        endTime: '2026-11-22T23:59:59Z',
                        totalReasoning: 0,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalInputTokens: 0,
                        totalOutputTokens: 0,
                        estSteps: 0,
                        modelNames: [],
                        gmTotalCalls: 2,
                        gmTotalCredits: 0,
                        gmTotalTokens: 1000,
                        estimatedCost: Number.POSITIVE_INFINITY,
                        gmModelStats: {
                            'InfModel': { calls: 1, credits: 0, inputTokens: 500, outputTokens: 500, thinkingTokens: 0, avgTTFT: 0, cacheHitRate: 0, estimatedCost: Number.POSITIVE_INFINITY },
                            'InvalidCostModel': { calls: 1, credits: 0, inputTokens: 500, outputTokens: 500, thinkingTokens: 0, avgTTFT: 0, cacheHitRate: 0, estimatedCost: Number.NaN },
                        },
                    }],
                },
            });
            const extremeHtml = buildCalendarTabContent(extremeStore, 2026, 11);
            expect(extremeHtml).not.toContain('cal-chip-cost');
            expect(extremeHtml).not.toContain('Infinity');
            expect(extremeHtml).not.toContain('NaN');
        });

        it.each(['en', 'zh', 'both'] as Language[])('renders the current About tab version, Extra High, and full Gemini 4 512K disclaimer in %s', async lang => {
            await setLanguageToState(lang, memState);
            const html = buildAboutTabContent();
            expect(html).toContain(`<span class="about-version-pill">v${packageManifest.version}</span>`);
            expect(html).toContain('USD');
            expect(html).not.toMatch(/USD\s*\/\s*[A-Z]{3}|[\u00a5\uffe5]/);
            expect(html).toContain(`v${packageManifest.version}`);
            expect(html).toContain('Extra High');
            expect(html).toContain('512K');
            expect(html).toContain('Gemini 4 Neon');
            expect(html).toContain('Carbon');
            expect(html).toContain('Argon');
            expect(html).toContain('Hydrogen');
            expect(html).toContain('Orchestrator Neon/Carbon/Argon');
            expect(html).not.toContain('v1.17.2');
            expect(html).not.toContain('令牌');
            if (lang === 'both') {
                expect(html).toContain(tBiHtml('Context Window Limitation:', '上下文窗口限制：'));
            }
            // Blank or whitespace version must fall back cleanly (never render bare 'v')
            expect(buildAboutTabContent('')).toContain(`<span class="about-version-pill">v${packageManifest.version}</span>`);
            expect(buildAboutTabContent('   ')).toContain(`<span class="about-version-pill">v${packageManifest.version}</span>`);
            expect(buildAboutTabContent('1.19.0')).toContain('<span class="about-version-pill">v1.19.0</span>');
        });

        it('exports all required v1.17.3 shared CSS classes with balanced braces and zero Songti', () => {
            const editorialCss = getEditorialStyles();
            const overviewCss = getOverviewStyles();
            for (const cls of [
                '.recent-calls-card',
                '.recent-calls-table-wrap',
                '.recent-calls-table',
                '.rate-change-banner',
                '.rate-change-banner-head',
                '.rate-change-banner-list',
                '.orch-settings-card',
                '.orch-role-row',
                '.orch-role-value .spec-short-id',
                '.orch-route-pill',
                '.quota-dual-row',
                '.spec-price-row',
                '.tag-notice',
                '.model-tag-badge:not(.tag-notice)',
                '.cal-overview-val',
                '.cal-day-total-val',
            ]) {
                expect(editorialCss, cls).toContain(cls);
            }
            expect(editorialCss).not.toContain('.currency-toggle-group');
            expect(editorialCss).not.toContain('.currency-btn');
            expect(editorialCss).not.toContain('.fx-rate-input');
            expect(editorialCss).toMatch(/\.rate-change-banner\s*\{[^}]*flex-direction:\s*column/);
            expect((editorialCss.match(/\{/g) || []).length).toBe((editorialCss.match(/\}/g) || []).length);
            expect((overviewCss.match(/\{/g) || []).length).toBe((overviewCss.match(/\}/g) || []).length);
            const cssRulesOnly = editorialCss.replace(/\/\*[\s\S]*?\*\//g, '');
            expect(cssRulesOnly).not.toMatch(/SimSun|Songti|宋体/i);
        });
    });
});

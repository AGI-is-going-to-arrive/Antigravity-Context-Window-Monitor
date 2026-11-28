// Consolidated Domain Suite: RPC-Mocked Live Model Sync, Neon, Account/Quota Parsing & Orchestrator Models
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    applyLiveModelStatus,
    fetchAndOverrideCheckpointerLimits,
    groupModelConfigsByQuotaPool,
    invalidateLiveModelMetadata,
    measuredContextDrop,
} from '../src/extension';
import {
    DEFAULT_CONTEXT_LIMITS,
    getAvailableImageModelSpecs,
    getContextLimit,
    getModelDisplayName,
    getModelSpecs,
    getQuotaPoolKey,
    guessContextLimitSpec,
    type ModelConfig,
    normalizeModelDisplayName,
    overrideContextLimits,
    registerResponseModelAlias,
    resolveModelId,
    setAvailableImageModelIds,
    updateModelDisplayNames,
    updateModelSpec,
    type UserStatusInfo,
} from '../src/models';
import { rpcCall } from '../src/rpc-client';
import { QuotaTracker } from '../src/quota-tracker';
import { StatusBarManager } from '../src/statusbar';
import type * as vscode from 'vscode';
import { buildGMDataTabContent } from '../src/activity-panel';
import { DailyLedger } from '../src/daily-ledger';
import { applyTrajectoryModelHints, buildGMMatchKey, maybeEnrichCallsFromTrajectory, parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import {
    formatNumber,
    getLanguage,
    type Language,
    setLanguageToState,
    t,
    tBi,
    tBiHtml,
} from '../src/i18n';
import { getModelDNAKey } from '../src/model-dna-store';
import { groupModelQuotas } from '../src/model-quota';
import { buildPricingTabContent } from '../src/pricing-panel';
import { calculateCosts, DEFAULT_PRICING, findPricingWithCustom, PricingStore } from '../src/pricing-store';
import { buildModelInfoGrid, buildModelsTabContent } from '../src/webview-models-tab';
import {
    fetchFullUserStatus,
    normalizeUri,
    parseStrictResetTimestamp,
    parseUserQuotaSummary,
    processSteps,
} from '../src/tracker';
import type { LSInfo } from '../src/discovery';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));

describe('[model-live-sync]', () => {
    const originalSpecs = getModelSpecs().map(s => ({ ...s }));

    const originalLimits = { ...DEFAULT_CONTEXT_LIMITS };

    const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };


    function config(model: string, label: string): ModelConfig {
        return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
            supportedMimeTypes: [], isRecommended: false,
            quotaInfo: { remainingFraction: 0.7, resetTime: new Date(Date.now() + 3_600_000).toISOString() } };
    }


    afterEach(() => {
        vi.clearAllMocks();
        for (const spec of originalSpecs) {
            updateModelSpec(spec.placeholderId, { ...spec,
                supportsAdaptiveThinking: spec.supportsAdaptiveThinking, thinkingLevel: spec.thinkingLevel });
        }
        for (const key of Object.keys(DEFAULT_CONTEXT_LIMITS)) {
            if (!(key in originalLimits)) { delete DEFAULT_CONTEXT_LIMITS[key]; }
        }
        overrideContextLimits(originalLimits);
        updateModelDisplayNames([], { authoritative: true });
    });


    describe('live checkpointer/model metadata sync', () => {
        // Copied from the sanitized 2026-10-31 read-only agent-hub capture. Keep
        // this fixture self-contained: ignored local cache files are not test inputs.
        const googleTiers = [
            ['gemini-4-argon-high', 'MODEL_PLACEHOLDER_M417', 3],
            ['gemini-4-argon-medium', 'MODEL_PLACEHOLDER_M418', 2],
            ['gemini-4-argon-low', 'MODEL_PLACEHOLDER_M419', 1],
            ['gemini-3.8-flash-high', 'MODEL_PLACEHOLDER_M318', 3],
            ['gemini-3.8-flash-medium', 'MODEL_PLACEHOLDER_M319', 2],
            ['gemini-3.8-flash-low', 'MODEL_PLACEHOLDER_M320', 1],
        ] as const;

        it('syncs all Argon efforts and removes obsolete Flash thinking budgets from complete live metadata', async () => {
            const models = Object.fromEntries(googleTiers.map(([catalog, model, thinkingLevel], index) => {
                // Emulate stale runtime metadata. The complete live catalog has
                // effort levels but omits fixed budgets and adaptive-thinking flags.
                updateModelSpec(model, { cpThreshold: 140_000, thinkingBudget: index === 0 ? -1 : 4000,
                    thinkingLevel: 0, supportsAdaptiveThinking: true });
                return [catalog, { model, apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                    maxTokens: 1_048_576, maxOutputTokens: 65_536, minThinkingBudget: 32,
                    supportsThinking: true, thinkingLevel,
                    modelExperiments: { experiments: { CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                        stringValue: JSON.stringify({ max_token_limit: '256000', token_threshold: '50000',
                            enabled: true, max_output_tokens: '16384' }),
                    } } },
                }];
            }));
            vi.mocked(rpcCall).mockResolvedValueOnce({ response: { models } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
            for (const [catalog, model, thinkingLevel] of googleTiers) {
                expect(resolveModelId(catalog)).toBe(model);
                expect(getContextLimit(model)).toBe(256_000);
                expect(getContextLimit(catalog)).toBe(256_000);
                expect(getModelSpecs().find(s => s.placeholderId === model)).toMatchObject({
                    modelId: catalog, apiProvider: 'GOOGLE_GEMINI', maxTokens: 1_048_576,
                    maxOutputTokens: 65_536, cpLimit: 256_000, cpThreshold: 50_000,
                    supportsThinking: true, thinkingLevel, thinkingBudget: 0, supportsAdaptiveThinking: false,
                });
                expect(getQuotaPoolKey(catalog, 'different-reset')).toBe('gemini');
            }
            // Current picker changes must not overwrite the retired tiered router
            // or the independently retained historical Flash-generation profiles.
            expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M298')).toMatchObject({
                cpThreshold: 140_000, thinkingBudget: -1,
            });
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M264')).toBe('Gemini 3.6 Flash (High)');
        });

        it('keeps known thinking metadata when catalog records are partial or malformed', async () => {
            updateModelSpec('MODEL_PLACEHOLDER_M418', { thinkingBudget: 4096, thinkingLevel: 2,
                supportsThinking: true, supportsAdaptiveThinking: true });
            for (const partial of [
                { model: 'MODEL_PLACEHOLDER_M418', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI' },
                { model: 'MODEL_PLACEHOLDER_M418', maxTokens: 'bad', maxOutputTokens: 65_536,
                    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI', thinkingBudget: 'bad',
                    supportsThinking: 'bad', supportsAdaptiveThinking: 'bad', thinkingLevel: NaN },
            ]) {
                vi.mocked(rpcCall).mockResolvedValueOnce({ models: { 'gemini-4-argon-medium': partial } });
                expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
                expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M418')).toMatchObject({
                    thinkingBudget: 4096, thinkingLevel: 2, supportsThinking: true, supportsAdaptiveThinking: true,
                    cpLimit: 512_000, maxTokens: 1_048_576,
                });
            }
        });

        it('reads catalog map keys and adaptive metadata for all six current Claude tiers', async () => {
            const models = Object.fromEntries(Array.from({ length: 6 }, (_, n) => {
                const family = n < 3 ? 'opus' : 'sonnet';
                const tier = ['low', 'medium', 'high'][n % 3];
                return [`claude-${family}-5-5-${tier}`, {
                    model: `MODEL_PLACEHOLDER_M${400 + n}`,
                    apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX', maxTokens: 1_000_000, maxOutputTokens: 128_000,
                    supportsThinking: true, supportsAdaptiveThinking: true, thinkingLevel: (n % 3) + 1,
                    modelExperiments: { experiments: { CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                        stringValue: JSON.stringify({ max_token_limit: '256000', token_threshold: '50000' }),
                    } } },
                }];
            }));
            vi.mocked(rpcCall).mockResolvedValueOnce({ response: { models } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
            for (const [modelId, metadata] of Object.entries(models)) {
                expect(getModelSpecs().find(s => s.placeholderId === metadata.model)).toMatchObject({
                    modelId, cpLimit: 256_000, cpThreshold: 50_000,
                    supportsAdaptiveThinking: true, thinkingLevel: metadata.thinkingLevel,
                });
                expect(getContextLimit(modelId)).toBe(256_000);
                expect(resolveModelId(modelId)).toBe(metadata.model);
            }
            expect(rpcCall).toHaveBeenCalledOnce();
            expect(vi.mocked(rpcCall).mock.calls[0][1]).toBe('GetAvailableModels');
        });

        it('accepts the top-level envelope and registers newly described catalog aliases', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({ models: { 'claude-fixture-future-high': {
                model: 'MODEL_PLACEHOLDER_M9402', maxTokens: 1_000_000, apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
                supportsThinking: true, supportsAdaptiveThinking: true, thinkingLevel: 3,
                modelExperiments: { experiments: { CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                    stringValue: JSON.stringify({ max_limit: 256_000, threshold: 50_000 }),
                } } },
            } } });
            expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
            expect(resolveModelId('claude-fixture-future-high')).toBe('MODEL_PLACEHOLDER_M9402');
            expect(getQuotaPoolKey('claude-fixture-future-high')).toBe('premium');
        });

        it.each(['256000oops', 'Infinity', '-1', '0', '2.5', '9007199254740992'])(
            'rejects malformed checkpointer limit %s without erasing a known spec', async limit => {
                vi.mocked(rpcCall).mockResolvedValueOnce({ response: { models: { 'claude-opus-5-5-high': {
                    model: 'MODEL_PLACEHOLDER_M402',
                    modelExperiments: { experiments: { CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                        stringValue: JSON.stringify({ max_token_limit: limit, token_threshold: 'NaN' }),
                    } } },
                } } } });
                expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
                expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M402')).toMatchObject({
                    cpLimit: 256_000, cpThreshold: 50_000, maxTokens: 1_000_000, maxOutputTokens: 128_000,
                    supportsThinking: true, supportsAdaptiveThinking: true,
                });
                expect(getContextLimit('MODEL_PLACEHOLDER_M402')).toBe(255_000);
            },
        );
    });


    describe('authenticated live picker changes', () => {
        it('replaces a restored old catalog with Argon and removes Argon-only live labels after an account switch', () => {
            const old = [config('MODEL_PLACEHOLDER_M318', 'Restored Flash High')];
            updateModelDisplayNames(old);
            let cached = old;
            const switchAccount = vi.fn();
            const updateQuota = vi.fn();
            const handlers = { replaceConfigs: (configs: ModelConfig[]) => { cached = configs; },
                switchAccount, updateQuota };
            const argon = [['M417', 'High'], ['M418', 'Medium'], ['M419', 'Low']].map(([id, tier]) =>
                config(`MODEL_PLACEHOLDER_${id}`, `Live Argon ${tier}`));
            expect(applyLiveModelStatus({ configs: argon,
                userInfo: { email: 'argon@example.test' } as UserStatusInfo }, handlers)).toBe(true);
            expect(cached).toEqual(argon);
            expect(resolveModelId('Restored Flash High')).toBeUndefined();
            expect(resolveModelId('Live Argon Medium')).toBe('MODEL_PLACEHOLDER_M418');
            expect(switchAccount).toHaveBeenLastCalledWith('argon@example.test');
            const other = [config('MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)')];
            expect(applyLiveModelStatus({ configs: other,
                userInfo: { email: 'other@example.test' } as UserStatusInfo }, handlers)).toBe(true);
            expect(cached).toEqual(other);
            expect(resolveModelId('Live Argon Medium')).toBeUndefined();
            expect(updateQuota).toHaveBeenLastCalledWith(other, 'other@example.test');
            // Old and new records remain readable after the live list changes.
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M418')).toBe('Gemini 4 Argon (Medium)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
        });

        it('applies paid → empty free → 4.6 picker transitions and preserves caches on RPC failure', () => {
            const values = new Map<string, unknown>();
            const state = { get: <T>(key: string, fallback: T) => (values.get(key) as T) ?? fallback,
                update: async (key: string, value: unknown) => { values.set(key, value); } };
            const context = { globalState: state } as unknown as vscode.ExtensionContext;
            const quota = new QuotaTracker(context);
            const bar = new StatusBarManager();
            const barSpy = vi.spyOn(bar, 'setModelConfigs');
            let cached: ModelConfig[] = [];
            let owner = '';
            const transitions: string[] = [];
            const handlers = {
                replaceConfigs: (configs: ModelConfig[]) => {
                    cached = configs;
                    bar.setModelConfigs(configs);
                    void state.update('cachedModelConfigs', configs);
                },
                switchAccount: (email: string) => { owner = email; transitions.push(`account:${email}`); },
                updateQuota: (configs: ModelConfig[], email?: string) => {
                    expect(owner).toBe(email);
                    transitions.push(`quota:${email}`);
                    quota.processUpdate(configs, undefined, email);
                },
            };
            const paid = [config('MODEL_PLACEHOLDER_M402', 'Paid account Opus 5.5 High')];
            expect(applyLiveModelStatus({ configs: paid, userInfo: { email: 'paid@example.test' } as UserStatusInfo }, handlers)).toBe(true);
            expect(resolveModelId('Paid account Opus 5.5 High')).toBe('MODEL_PLACEHOLDER_M402');
            expect(applyLiveModelStatus({ configs: [], userInfo: { email: 'free@example.test' } as UserStatusInfo }, handlers)).toBe(true);
            expect(cached).toEqual([]);
            expect(values.get('cachedModelConfigs')).toEqual([]);
            expect(barSpy).toHaveBeenLastCalledWith([]);
            expect(owner).toBe('free@example.test');
            expect(resolveModelId('Paid account Opus 5.5 High')).toBeUndefined();
            // Existing paid-account quota history remains isolated and is not falsely
            // reset or credited to the incoming account by its authenticated empty list.
            expect(quota.getActiveSessions().every(s => s.accountEmail === 'paid@example.test')).toBe(true);
            const free = [config('MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)')];
            expect(applyLiveModelStatus({ configs: free, userInfo: { email: 'free@example.test' } as UserStatusInfo }, handlers)).toBe(true);
            expect(cached).toEqual(free);
            const transitionCount = transitions.length;
            expect(applyLiveModelStatus({ configs: [], userInfo: null }, handlers)).toBe(false);
            expect(cached).toEqual(free);
            expect(transitions).toHaveLength(transitionCount);
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M402')).toBe('Claude Opus 5.5 (High)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M35')).toBe('Claude Sonnet 4.6 (Thinking)');
            bar.dispose();
        });
    });
});

describe('[model-metadata-lifecycle]', () => {
    afterEach(() => { vi.clearAllMocks(); invalidateLiveModelMetadata(); });


    describe('live image-model availability lifecycle', () => {
        it('clears the prior account or backend image catalog immediately', () => {
            setAvailableImageModelIds(['gemini-3.1-flash-image']);
            expect(getAvailableImageModelSpecs()).toHaveLength(1);
            invalidateLiveModelMetadata();
            expect(getAvailableImageModelSpecs()).toEqual([]);
        });

        it('discards an in-flight catalog reply after its account/backend becomes stale', async () => {
            let finish: (value: Record<string, unknown>) => void = () => {};
            vi.mocked(rpcCall).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
            let current = true;
            const sync = fetchAndOverrideCheckpointerLimits({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false },
                () => {}, () => current);
            current = false;
            invalidateLiveModelMetadata();
            finish({ response: { imageGenerationModelIds: ['gemini-3.1-flash-image'], models: {
                'gemini-3.1-flash-image': { model: 'MODEL_PLACEHOLDER_M21', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                    maxTokens: 65536, maxOutputTokens: 65536 },
            } } });
            expect(await sync).toBe(false);
            expect(getAvailableImageModelSpecs()).toEqual([]);
        });
    });
});

describe('[neon-models]', () => {
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
});

describe('[cross-platform-account-quota-rpc]', () => {
    const initialLanguage = getLanguage();

    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    const dummyLs: LSInfo = { pid: 1, port: 443, csrfToken: 'test', useTls: false };


    beforeEach(async () => {
        vi.clearAllMocks();
        await setLanguageToState('both', state);
    });


    afterEach(async () => {
        await setLanguageToState(initialLanguage, state);
    });


    describe('modern account status and quota parsing', () => {
        it('parses modern userInfo without planStatus.planInfo and marks unknown credits/fractions accurately', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({
                userStatus: {
                    name: 'Ada',
                    email: 'ada@example.test',
                    userTier: {
                        name: 'Google AI Ultra',
                        id: 'tier-ultra',
                        availableCredits: [
                            { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 50_000 },
                            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI' }, // missing balance -> null (unknown)
                            { creditType: 'CREDIT_TYPE_GOOGLE_AI_STUDIO', creditAmount: '0' }, // explicit 0
                        ],
                    },
                    cascadeModelConfigData: {
                        clientModelConfigs: [
                            {
                                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M534' },
                                label: 'Gemini 4 Neon (Low)',
                                quotaInfo: { resetTime: '1970-01-01T00:00:00Z' }, // proto3 untouched -> 1
                            },
                            {
                                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' },
                                label: 'Gemini 4 Neon (High)',
                                quotaInfo: { resetTime: '2026-11-19T06:00:00Z' }, // proto3 exhausted -> 0
                            },
                            {
                                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' },
                                label: 'Gemini 4 Neon (XHigh)',
                                quotaInfo: { remainingFraction: 'not-a-number', resetTime: 'bad-date' }, // malformed -> NaN
                            },
                        ],
                    },
                },
            });

            const status = await fetchFullUserStatus(dummyLs);
            expect(status.userInfo).not.toBeNull();
            expect(status.userInfo?.email).toBe('ada@example.test');
            expect(status.userInfo?.userTierName).toBe('Google AI Ultra');
            expect('availablePromptCredits' in (status.userInfo || {})).toBe(false);
            expect('availableFlowCredits' in (status.userInfo || {})).toBe(false);
            expect(status.userInfo?.availableCredits).toEqual([
                { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 50_000, minimumCreditAmountForUsage: 0 },
                { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null, minimumCreditAmountForUsage: 0 },
                { creditType: 'CREDIT_TYPE_GOOGLE_AI_STUDIO', creditAmount: 0, minimumCreditAmountForUsage: 0 },
            ]);

            expect(status.configs[0].quotaInfo?.remainingFraction).toBe(1);
            expect(status.configs[1].quotaInfo?.remainingFraction).toBe(0);
            expect(Number.isNaN(status.configs[2].quotaInfo?.remainingFraction)).toBe(true);

            // NaN fraction and epoch 1970 resetTime must not poison quota pool aggregation
            const pools = groupModelConfigsByQuotaPool(status.configs);
            expect(pools).toHaveLength(1);
            expect(pools[0].key).toBe('gemini');
            expect(pools[0].minFraction).toBe(0);
            expect(pools[0].resetTime).toBe('2026-11-19T06:00:00Z');
        });

        it('parseStrictResetTimestamp accepts equivalent ISO epoch-0 forms and rejects loose V8 Date.parse quirks', () => {
            // Equivalent proto3 epoch-0 spellings -> 0
            for (const epoch of [
                '1970-01-01T00:00:00Z',
                '1970-01-01T00:00:00.000Z',
                '1970-01-01T00:00:00.000000000Z',
                '1970-01-01T00:00:00+00:00',
                '1970-01-01T01:00:00+01:00',
                '  1970-01-01T00:00:00.000Z  ',
            ]) {
                expect(parseStrictResetTimestamp(epoch), epoch).toBe(0);
            }

            // Valid positive ISO timestamps (including leap day and non-UTC day-boundary offsets)
            expect(parseStrictResetTimestamp('2026-11-19T06:00:00Z')).toBe(Date.parse('2026-11-19T06:00:00Z'));
            expect(parseStrictResetTimestamp('2026-11-19T17:00:00+11:00')).toBe(Date.parse('2026-11-19T06:00:00Z'));
            expect(parseStrictResetTimestamp('2024-02-29T12:00:00Z')).toBe(Date.parse('2024-02-29T12:00:00Z'));
            expect(parseStrictResetTimestamp('2026-03-01T00:30:00+02:00')).toBe(Date.parse('2026-02-28T22:30:00Z'));
            expect(parseStrictResetTimestamp('2026-02-28T23:30:00-02:00')).toBe(Date.parse('2026-03-01T01:30:00Z'));

            // Valid negative ISO timestamp (callers distinguish < 0 from epoch-0 and positive)
            expect(parseStrictResetTimestamp('1969-12-31T23:59:59Z')).toBe(-1000);

            // Loose/malformed/impossible dates and invalid timezone offsets
            for (const bad of [
                '',
                '   ',
                null,
                undefined,
                0,
                '0',
                '1970',
                '1970-01-01',
                '0bad',
                'bad-date',
                '2026-11-12T01:00:00',
                '2026-02-29T12:00:00Z',
                '1900-02-29T12:00:00Z',
                '2026-02-30T00:00:00Z',
                '2026-11-31T00:00:00Z',
                '2026-11-21T24:00:00Z',
                '2026-11-21T12:00:00+24:00',
                '2026-11-21T12:00:00+25:00',
                '2026-11-21T12:00:00+00:60',
                '2026-11-21T12:00:00-24:00',
            ]) {
                expect(parseStrictResetTimestamp(bad), String(bad)).toBeNull();
            }
        });

        it.each([
            { userStatus: [] },
            { userStatus: null },
            { userStatus: 'invalid' },
        ])('fetchFullUserStatus rejects non-object or array userStatus %j without attaching rawResponse', async payload => {
            vi.mocked(rpcCall).mockResolvedValueOnce(payload);
            const status = await fetchFullUserStatus(dummyLs);
            expect(status).toMatchObject({ ok: false, configs: [], userInfo: null });
            expect(typeof status.error).toBe('string');
            expect(status.error!.length).toBeGreaterThan(0);
            expect('rawResponse' in status).toBe(false);
        });

        it('treats equivalent epoch-0 resetTime as full quota and malformed/negative resetTime as unknown in fetchFullUserStatus & parseUserQuotaSummary', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({
                userStatus: {
                    name: 'Ada',
                    email: 'ada@example.test',
                    cascadeModelConfigData: {
                        clientModelConfigs: [
                            { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M534' }, label: 'Epoch Z', quotaInfo: { resetTime: '1970-01-01T00:00:00Z' } },
                            { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M533' }, label: 'Epoch ms', quotaInfo: { resetTime: '1970-01-01T00:00:00.000Z' } },
                            { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' }, label: 'Epoch offset', quotaInfo: { resetTime: '1970-01-01T00:00:00+00:00' } },
                            { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' }, label: 'Exhausted', quotaInfo: { resetTime: '2026-11-19T06:00:00Z' } },
                            { modelOrAlias: { model: 'MODEL_BAD_ZERO' }, label: 'Bad Zero', quotaInfo: { resetTime: '0' } },
                            { modelOrAlias: { model: 'MODEL_BAD_YEAR' }, label: 'Bad 1970', quotaInfo: { resetTime: '1970' } },
                            { modelOrAlias: { model: 'MODEL_BAD_CAL' }, label: 'Bad Feb 30', quotaInfo: { resetTime: '2026-02-30T00:00:00Z' } },
                            { modelOrAlias: { model: 'MODEL_BAD_NEG' }, label: 'Negative 1969', quotaInfo: { resetTime: '1969-12-31T23:59:59Z' } },
                        ],
                    },
                },
            });

            const status = await fetchFullUserStatus(dummyLs);
            expect(status.configs[0].quotaInfo?.remainingFraction).toBe(1);
            expect(status.configs[1].quotaInfo?.remainingFraction).toBe(1);
            expect(status.configs[2].quotaInfo?.remainingFraction).toBe(1);
            expect(status.configs[3].quotaInfo?.remainingFraction).toBe(0);
            expect(Number.isNaN(status.configs[4].quotaInfo?.remainingFraction)).toBe(true);
            expect(Number.isNaN(status.configs[5].quotaInfo?.remainingFraction)).toBe(true);
            expect(Number.isNaN(status.configs[6].quotaInfo?.remainingFraction)).toBe(true);
            expect(Number.isNaN(status.configs[7].quotaInfo?.remainingFraction)).toBe(true);

            const summary = parseUserQuotaSummary({
                groups: [{
                    displayName: 'Gemini Models',
                    buckets: [
                        { bucketId: 'gemini-5h', window: '5h', resetTime: '1970-01-01T00:00:00+00:00' },
                        { bucketId: 'gemini-weekly', window: 'weekly', resetTime: '2026-11-28T00:00:00Z' },
                        { bucketId: 'gemini-bad-zero', window: 'other', resetTime: '0' },
                        { bucketId: 'gemini-bad-1970', window: 'other', resetTime: '1970' },
                        { bucketId: 'gemini-bad-neg', window: 'other', resetTime: '1969-12-31T23:59:59Z' },
                        { bucketId: 'gemini-bad-cal', window: 'other', resetTime: '2026-02-30T00:00:00Z' },
                    ],
                }],
            });
            expect(summary).not.toBeNull();
            const buckets = summary!.groups[0].buckets;
            expect(buckets[0]).toMatchObject({ remainingFraction: 1, resetTime: null, resetAt: null });
            expect(buckets[1]).toMatchObject({ remainingFraction: 0, resetTime: '2026-11-28T00:00:00Z' });
            expect(buckets[2]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
            expect(buckets[3]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
            expect(buckets[4]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
            expect(buckets[5]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
        });
    });
});

describe('[orchestrator]', () => {
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
        vi.useRealTimers();
        vi.clearAllMocks();
        original.forEach(s => updateModelSpec(s.placeholderId, { ...s, executionModelId: s.executionModelId }));
        for (const k of Object.keys(DEFAULT_CONTEXT_LIMITS)) {
            if (!(k in limits)) { delete DEFAULT_CONTEXT_LIMITS[k]; }
        }
        overrideContextLimits(limits);
        updateModelDisplayNames([], { authoritative: true });
        await setLanguageToState('both', state);
    });


    const identities = [
        { id: coordinator, catalog: 'gemini-pro-orchestrator', label: 'Orchestrator (Carbon)', aliases: [] as string[], level: 3 },
        { id: worker, catalog: 'gemini-flash-worker-agy', label: 'Gemini 4 Hydrogen (Orchestrator)', aliases: ['Gemini Flash (Orchestrator Worker)'], level: 100 },
    ];

    describe('Orchestrator and catalog-only worker', () => {
        it.each(identities)('recognizes $catalog before a live catalog is available', ({ id, catalog, label, aliases, level }) => {
            updateModelDisplayNames([], { authoritative: true });
            for (const alias of [id, catalog, catalog.toUpperCase(), label, `${label} (${id.slice(18)})`, ...aliases]) {
                expect(resolveModelId(alias), alias).toBe(id);
                expect(getContextLimit(alias), alias).toBe(511000);
            }
            expect(spec(id)).toMatchObject({ maxTokens: 1048576, maxOutputTokens: 262144,
                cpLimit: 512000, cpThreshold: 50000, thinkingLevel: level, thinkingBudget: 0, supportsThinking: true });
            expect(guessContextLimitSpec(catalog)).toMatchObject({ cpLimit: 512000, cpThreshold: 50000 });
        });
        it.each(['Orchestrator (High)', 'Orchestrator Extra', 'orchestrators', 'gemini-pro-orchestrator-high',
            'gemini-flash-worker-agy-high', 'Gemini Flash', 'gemini-pro-orchestrator<script>'])(
            'does not invent an effort/alias for %s', name => expect(resolveModelId(name)).toBeUndefined());
        it.each(['编排器', '协调器', 'ORCHESTRATOR', ' Orchestrator (M667) '])('normalizes %s', name => {
            expect(normalizeModelDisplayName(name)).toBe('Orchestrator (Carbon)');
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
            expect(groups[0].members.find(m => m.label === 'Orchestrator (Carbon)')?.efforts).toEqual([]);
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
        it('keeps strict mode explicit, maps base rates in mapped mode, and keeps custom coordinator/worker rates separate', () => {
            const rate = { input: 2, output: 10, thinking: 10, cacheRead: 0.1, cacheWrite: 0 };
            const familyCustom = { input: 9, output: 29, thinking: 29, cacheRead: 0.9, cacheWrite: 0 };
            for (const { id, catalog } of identities) {
                expect(findPricingWithCustom(id, {}, DEFAULT_PRICING, 'strict')).toBeNull();
                expect(findPricingWithCustom(catalog, { 'gemini-4-carbon': familyCustom, 'gemini-4-hydrogen': familyCustom }, DEFAULT_PRICING, 'strict')).toBeNull();
                expect(findPricingWithCustom(catalog, { 'gemini-4-carbon': familyCustom, 'gemini-4-hydrogen': familyCustom }, DEFAULT_PRICING, 'mapped')).not.toEqual(familyCustom);
            }
            const custom = { 'gemini-pro-orchestrator': rate };
            expect(findPricingWithCustom(coordinator, custom)).toEqual(rate);
            expect(findPricingWithCustom(worker, custom, DEFAULT_PRICING, 'strict')).toBeNull();
            expect(findPricingWithCustom(worker, custom, DEFAULT_PRICING, 'mapped')).toEqual(DEFAULT_PRICING['gemini-4-hydrogen']);

            const strictResult = calculateCosts(summary(), custom, 'strict');
            expect(strictResult.rows).toHaveLength(2);
            expect(strictResult.grandTotal).toBeCloseTo(0.00305, 10);
            expect(strictResult.rows.filter(r => !r.pricing)).toHaveLength(1);

            const mappedResult = calculateCosts(summary(), custom, 'mapped');
            expect(mappedResult.rows).toHaveLength(2);
            expect(mappedResult.rows.filter(r => !r.pricing)).toHaveLength(0);
            expect(mappedResult.grandTotal).toBeGreaterThan(strictResult.grandTotal);
        });
        it('persists both actual calls without adding a call for the configured route', () => {
            const s = summary();
            const entries = s.conversations[0].calls.map((call, i) => ({ dedupKey: `orchestrator-${i}`, call }));
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date(entries[0].call.createdAt));
            const ledger = new DailyLedger();
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
            const pricingMapped = buildPricingTabContent(summary(), new PricingStore());
            expect(pricingMapped).toContain('data-model="gemini-pro-orchestrator"');
            expect(pricingMapped).toContain('data-model="gemini-flash-worker-agy"');
            expect(pricingMapped).toContain(language === 'zh' ? '按底座估算' : 'Est. via Base Model');

            const pricingStrict = buildPricingTabContent(summary(), new PricingStore(), undefined, undefined, undefined, false, {
                orchestratorPricingMode: 'strict',
            });
            expect(pricingStrict).toContain('data-model="gemini-pro-orchestrator"');
            expect(pricingStrict).toContain('data-model="gemini-flash-worker-agy"');
            expect(pricingStrict).toContain(language === 'zh' ? '价格待确认' : 'Price unavailable');
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
        expect(groups[0].members.find(m => m.label === 'Orchestrator (Carbon)')?.efforts).toEqual([]);
    });
});

describe('[orchestrator-split]', () => {
    const carbon = 'MODEL_PLACEHOLDER_M667', argon = 'MODEL_PLACEHOLDER_M681', worker = 'MODEL_PLACEHOLDER_M669';

    const identities = [
        { id: carbon, catalog: 'gemini-pro-orchestrator', label: 'Orchestrator (Carbon)', aliases: [] as string[], output: 262144, level: 3 },
        { id: argon, catalog: 'gemini-pro-orchestrator-argon', label: 'Orchestrator (Argon)', aliases: [] as string[], output: 65536, level: 3 },
        { id: worker, catalog: 'gemini-flash-worker-agy', label: 'Gemini 4 Hydrogen (Orchestrator)', aliases: ['Gemini Flash (Orchestrator Worker)'], output: 262144, level: 100 },
    ];

    const saved = getModelSpecs().map(s => ({ ...s })), limits = { ...DEFAULT_CONTEXT_LIMITS };

    const state = { get: <T>(_k: string, d: T) => d, update: async () => {} };

    const cfg = (model: string, label = getModelDisplayName(model)): ModelConfig => ({ model, label,
        supportsImages: true, allowedTiers: [], supportedMimeTypes: [], mimeTypeCount: 0, isRecommended: false,
        quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-14T00:00:00Z' } });

    const rate = { input: 2, output: 10, thinking: 10, cacheRead: 0.1, cacheWrite: 0 };

    afterEach(async () => {
        vi.useRealTimers();
        saved.forEach(s => updateModelSpec(s.placeholderId, { ...s }));
        overrideContextLimits(limits); updateModelDisplayNames([], { authoritative: true });
        vi.clearAllMocks(); await setLanguageToState('both', state);
    });


    describe('Orchestrator Carbon/Argon split', () => {
        it.each(identities)('resolves $label and preserves verified independent limits', ({ id, catalog, label, aliases, output, level }) => {
            for (const alias of [id, catalog, catalog.toUpperCase(), label, label.toLowerCase(), `${label} (${id.slice(18)})`, ...aliases]) {
                expect(resolveModelId(alias), alias).toBe(id);
                expect(getContextLimit(alias)).toBe(511000);
                expect(getQuotaPoolKey(alias)).toBe('gemini');
            }
            expect(guessContextLimitSpec(catalog)).toEqual({ cpLimit: 512000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true });
            expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({ maxOutputTokens: output, thinkingLevel: level, thinkingBudget: 0 });
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
            const distinctCustom = { input: 9.9, output: 19.9, thinking: 19.9, cacheRead: 0.99, cacheWrite: 0 };
            expect(findPricingWithCustom(carbon, { [key]: distinctCustom })).toEqual(distinctCustom);
            // In strict mode, Argon/worker stay null; in mapped mode, they use their own base rates, NEVER Carbon's custom override
            expect(findPricingWithCustom(argon, { [key]: distinctCustom }, DEFAULT_PRICING, 'strict')).toBeNull();
            expect(findPricingWithCustom(worker, { [key]: distinctCustom }, DEFAULT_PRICING, 'strict')).toBeNull();
            expect(findPricingWithCustom(argon, { [key]: distinctCustom }, DEFAULT_PRICING, 'mapped')).not.toEqual(distinctCustom);
            expect(findPricingWithCustom(worker, { [key]: distinctCustom }, DEFAULT_PRICING, 'mapped')).not.toEqual(distinctCustom);
        });
        it.each(identities)('isolates $label from ordinary family custom rates and respects strict vs mapped modes', m => {
            const familyCustom = { input: 9.9, output: 19.9, thinking: 19.9, cacheRead: 0.99, cacheWrite: 0 };
            const familyTable = { 'gemini-4-carbon': familyCustom, 'gemini-4-argon': familyCustom, 'gemini-4-hydrogen': familyCustom };
            expect(findPricingWithCustom(m.id, familyTable, DEFAULT_PRICING, 'strict')).toBeNull();
            expect(findPricingWithCustom(m.id, familyTable, DEFAULT_PRICING, 'mapped')).not.toEqual(familyCustom);
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
            const pricedStrict = calculateCosts(summary, { 'gemini-pro-orchestrator-argon': rate }, 'strict');
            expect(pricedStrict.rows).toHaveLength(3); expect(pricedStrict.rows.filter(r => r.pricing)).toHaveLength(1);
            expect(pricedStrict.grandTotal).toBeCloseTo(0.00305, 10);
            const pricedMapped = calculateCosts(summary, { 'gemini-pro-orchestrator-argon': rate }, 'mapped');
            expect(pricedMapped.rows).toHaveLength(3); expect(pricedMapped.rows.filter(r => r.pricing)).toHaveLength(3);
            expect(pricedMapped.grandTotal).toBeGreaterThan(pricedStrict.grandTotal);
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date(calls[0].createdAt));
            const ledger = new DailyLedger();
            const entries = calls.map((c, i) => ({ dedupKey: `split-${i}`, call: { ...c, accountEmail: 'test@example.test' } }));
            expect(ledger.recordCalls(entries)).toBe(3);
            const restored = DailyLedger.restore(ledger.serialize()); expect(restored.recordCalls(entries)).toBe(0);
            expect(Object.keys(restored.getAccountActive('test@example.test')!.modelStats)).toHaveLength(3);
            const snapshot = (requested: string, actual: string, input: number) => ({ ...processSteps([{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                metadata: { generatorModel: actual, requestedModel: { model: requested }, modelUsage: { model: actual, inputTokens: input, outputTokens: 100 } } }]), contextLimit: 256000 });
            expect(measuredContextDrop(snapshot(carbon, carbon, 20000), snapshot(argon, argon, 10000), false)).toBe(0);
            expect(measuredContextDrop(snapshot(argon, argon, 20000), snapshot(argon, worker, 10000), false)).toBe(0);
        });
    });
});

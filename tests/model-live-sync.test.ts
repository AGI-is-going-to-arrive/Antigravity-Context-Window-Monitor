import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLiveModelStatus, fetchAndOverrideCheckpointerLimits } from '../src/extension';
import {
    getContextLimit, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    overrideContextLimits, resolveModelId, updateModelDisplayNames, updateModelSpec,
    type ModelConfig, type UserStatusInfo,
} from '../src/models';
import { rpcCall } from '../src/rpc-client';
import { QuotaTracker } from '../src/quota-tracker';
import { StatusBarManager } from '../src/statusbar';
import type * as vscode from 'vscode';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));

const originalSpecs = getModelSpecs().map(s => ({ ...s }));
const originalLimits = Object.fromEntries(originalSpecs.map(s => [s.placeholderId, getContextLimit(s.placeholderId)]));
const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };

function config(model: string, label: string): ModelConfig {
    return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
        supportedMimeTypes: [], isRecommended: false,
        quotaInfo: { remainingFraction: 0.7, resetTime: new Date(Date.now() + 3_600_000).toISOString() } };
}

afterEach(() => {
    vi.clearAllMocks();
    for (const spec of originalSpecs) { updateModelSpec(spec.placeholderId, spec); }
    overrideContextLimits(originalLimits);
    updateModelDisplayNames([], { authoritative: true });
});

describe('live checkpointer/model metadata sync', () => {
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguageToState, type Language } from '../src/i18n';
import { buildModelInfoGrid, buildModelsTabContent } from '../src/webview-models-tab';
import { getModelSpecs, type ModelConfig, type ModelSpec } from '../src/models';
import type { StateBucket } from '../src/durable-state';

const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const spec: ModelSpec = {
    modelId: 'claude-opus-5-5-medium', placeholderId: 'MODEL_PLACEHOLDER_M401',
    displayName: 'Claude Opus 5.5 (Medium)', apiProvider: 'ANTHROPIC_VERTEX',
    maxTokens: 1_000_000, maxOutputTokens: 128_000, cpLimit: 256_000,
    cpThreshold: 50_000, supportsThinking: true, thinkingBudget: 0,
};

beforeEach(() => setLanguageToState('en', state));
afterEach(() => setLanguageToState('both', state));

describe('model information rendering', () => {
    // The first locale render took 5.17s on a cold Windows CI runner. This checks
    // correctness, not startup latency; keep its budget separate from other tests.
    it.each([
        ['en', 'Compression limit', 'Native context', 'Adaptive'],
        ['zh', '压缩阈值', '原生上下文', '自适应'],
        ['both', 'Compression limit / 压缩阈值', 'Native context / 原生上下文', 'Adaptive / 自适应'],
    ] as const)('renders complete parameters in %s', async (language, limit, native, thinking) => {
        await setLanguageToState(language, state);
        const html = buildModelInfoGrid([{ ...spec, supportsAdaptiveThinking: true }]);
        for (const value of [limit, native, thinking, '256,000', '1,000,000', 'Anthropic · Vertex', spec.modelId, 'M401']) {
            expect(html).toContain(value);
        }
        expect(html).not.toContain('Budget: None');
    }, 15_000);

    it.each([0, -1, NaN, Infinity, -Infinity])('does not claim an invalid %s token limit', (invalid) => {
        const html = buildModelInfoGrid([{ ...spec, cpLimit: invalid, maxTokens: invalid }]);
        expect(html.match(/<dd>Not available<\/dd>/g)).toHaveLength(2);
        expect(html).not.toMatch(/<dd>(NaN|Infinity|-1|0)<\/dd>/);
    });

    it.each([
        [false, 1024, 'Not supported'], [true, -1, 'Dynamic'],
        [true, 8192, 'Budget: 8,192'], [true, 0, 'Supported · Budget unspecified'],
        [true, NaN, 'Supported · Budget unspecified'], [true, -2, 'Supported · Budget unspecified'],
    ])('distinguishes thinking support %s and budget %s', (supportsThinking, thinkingBudget, expected) => {
        expect(buildModelInfoGrid([{ ...spec, supportsThinking, thinkingBudget }])).toContain(expected);
    });

    it('escapes every model metadata field and does not create executable HTML', () => {
        const injected = '\"><img src=x onerror=alert(1)>';
        const html = buildModelInfoGrid([{
            ...spec, displayName: injected, modelId: injected, placeholderId: injected,
            apiProvider: injected,
        }]);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        expect(html).not.toContain('aria-label=""><');
    });

    it('labels an absent provider without inventing a provider or duplicating an ID', () => {
        const html = buildModelInfoGrid([{ ...spec, apiProvider: '', modelId: spec.placeholderId }]);
        expect(html).toContain('Provider not available');
        expect(html).not.toContain('class="spec-short-id"');
    });

    it('retains complete long names and provider identifiers for narrow layouts', () => {
        const label = 'A very long model name '.repeat(12);
        const provider = 'NEW_UNKNOWN_PROVIDER';
        const html = buildModelInfoGrid([{ ...spec, displayName: label, apiProvider: provider }]);
        expect(html).toContain(label);
        expect(html).toContain('NEW UNKNOWN PROVIDER');
    });
});

function config(model: string): ModelConfig {
    const registered = getModelSpecs().find(s => s.placeholderId === model);
    return { model, label: registered?.displayName || model } as ModelConfig;
}

describe('account-specific model availability', () => {
    it.each(['en', 'zh', 'both'] as Language[])('follows each live picker in %s without stale third-party cards', async language => {
        await setLanguageToState(language, state);
        const paid = buildModelsTabContent(null, ['M400', 'M401', 'M402', 'M403', 'M404', 'M405'].map(id => config(`MODEL_PLACEHOLDER_${id}`)));
        expect(paid.match(/class="spec-card"/g)).toHaveLength(6);
        expect(paid).not.toContain('Claude Opus 4.6');

        const free = buildModelsTabContent(null, ['M26', 'M35', 'M318'].map(id => config(`MODEL_PLACEHOLDER_${id}`)));
        expect(free).toContain('Claude Opus 4.6');
        expect(free).toContain('Claude Sonnet 4.6');
        expect(free).not.toContain('Claude Opus 5.5');

        const geminiOnly = buildModelsTabContent(null, [config('MODEL_PLACEHOLDER_M318')]);
        expect(geminiOnly).toContain('Gemini 3.8 Flash');
        expect(geminiOnly).not.toContain('Claude');
        expect(geminiOnly).not.toContain('GPT-OSS');
    });

    it('shows a translated empty state when the account has no available models', () => {
        const html = buildModelsTabContent(null, []);
        expect(html).not.toContain('class="spec-card"');
        expect(html).toContain('Model Info');
    });
});

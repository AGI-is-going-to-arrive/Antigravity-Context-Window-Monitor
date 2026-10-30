import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguageToState, type Language } from '../src/i18n';
import { buildModelInfoGrid, buildModelsTabContent } from '../src/webview-models-tab';
import { getModelSpecs, setAvailableImageModelIds, type ModelConfig, type ModelSpec } from '../src/models';
import type { StateBucket } from '../src/durable-state';

const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const spec: ModelSpec = {
    modelId: 'claude-opus-5-5-medium', placeholderId: 'MODEL_PLACEHOLDER_M401',
    displayName: 'Claude Opus 5.5 (Medium)', apiProvider: 'ANTHROPIC_VERTEX',
    maxTokens: 1_000_000, maxOutputTokens: 128_000, cpLimit: 256_000,
    cpThreshold: 50_000, supportsThinking: true, thinkingBudget: 0,
};

beforeEach(() => {
    setAvailableImageModelIds([]);
    return setLanguageToState('en', state);
});
afterEach(() => {
    setAvailableImageModelIds([]);
    return setLanguageToState('both', state);
});

describe('model information rendering', () => {
    it.each(['en', 'zh', 'both'] as Language[])('does not confuse unreported image thinking with unsupported capability in %s', async language => {
        await setLanguageToState(language, state);
        const html = buildModelInfoGrid([{ ...spec, isImageGeneration: true,
            thinkingCapabilityReported: false, supportsThinking: false, cpLimit: 0, cpThreshold: 0 }]);
        expect(html).toContain(language === 'zh' ? 'IDE 未上报' : 'Not reported by IDE');
        expect(html).not.toContain('<dd>Not supported</dd>');
        expect(html).not.toContain('<dd>不支持</dd>');
    });
    // The first locale render took 5.17s on a cold Windows CI runner. This checks
    // correctness, not startup latency; keep its budget separate from other tests.
    it.each([
        ['en', 'Compression limit', 'Checkpoint threshold', 'Model context', 'Max output', 'Adaptive'],
        ['zh', '压缩上限', '检查点阈值', '模型上下文', '最大输出', '自适应'],
        ['both', 'Compression limit / 压缩上限', 'Checkpoint threshold / 检查点阈值', 'Model context / 模型上下文', 'Max output / 最大输出', 'Adaptive / 自适应'],
    ] as const)('renders complete parameters in %s', async (language, limit, threshold, native, output, thinking) => {
        await setLanguageToState(language, state);
        const html = buildModelInfoGrid([{ ...spec, supportsAdaptiveThinking: true }]);
        for (const value of [limit, threshold, native, output, thinking, '256,000', '50,000', '1,000,000', '128,000', 'Anthropic · Vertex', spec.modelId, 'M401']) {
            expect(html).toContain(value);
        }
        for (const [metric, label, value] of [
            ['compression-limit', limit, '256,000'], ['checkpoint-threshold', threshold, '50,000'],
            ['native-context', native, '1,000,000'], ['max-output', output, '128,000'],
        ]) {
            expect(html).toMatch(new RegExp(`data-metric="${metric}">\\s*<dt>${label}</dt>\\s*<dd>${value}</dd>`));
        }
        expect(html).not.toContain('压缩阈值');
        expect(html).not.toContain('Native context');
        expect(html).toContain(language === 'zh' ? '可能与公开 API 限额不同' : 'may differ from public API limits');
        expect(html).not.toContain('Budget: None');
    }, 15_000);

    it.each([0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('does not claim an invalid %s token limit', (invalid) => {
        const html = buildModelInfoGrid([{ ...spec, cpLimit: invalid, cpThreshold: invalid, maxTokens: invalid, maxOutputTokens: invalid }]);
        expect(html.match(/<dd>Not available<\/dd>/g)).toHaveLength(4);
        expect(html).not.toMatch(/<dd>(NaN|Infinity|-1|0)<\/dd>/);
        expect(html).not.toContain('Not applicable');
    });

    it.each(['en', 'zh', 'both'] as Language[])('distinguishes image compression inapplicability from missing text limits in %s', async language => {
        await setLanguageToState(language, state);
        const imageSpec: ModelSpec = { ...spec, modelId: 'gemini-3.1-flash-image', placeholderId: 'MODEL_PLACEHOLDER_M21',
            displayName: 'Gemini 3.1 Flash Image', apiProvider: 'GOOGLE_GEMINI', isImageGeneration: true,
            maxTokens: 65_536, maxOutputTokens: 65_536, cpLimit: 0, cpThreshold: 0 };
        const html = buildModelInfoGrid([imageSpec], 'image');
        const notApplicable = language === 'en' ? 'Not applicable' : language === 'zh' ? '不适用' : 'Not applicable / 不适用';
        expect(html.split(`<dd>${notApplicable}</dd>`)).toHaveLength(3);
        expect(html.match(/<dd>65,536<\/dd>/g)).toHaveLength(2);
        expect(html).toContain('data-model-kind="image"');
        expect(html).toContain(language === 'zh' ? '图片生成模型' : 'Image generation models');
        expect(html).toContain(language === 'zh' ? '可能与公开 API 不同' : 'may differ from public API limits');
        const textHtml = buildModelInfoGrid([{ ...spec, cpLimit: 0, cpThreshold: 0 }]);
        expect(textHtml).not.toContain(notApplicable);
        expect(textHtml).toContain(language === 'zh' ? '暂无数据' : 'Not available');
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
    it.each(['en', 'zh', 'both'] as Language[])('keeps the live chat picker separate from the authoritative image catalog in %s', async language => {
        await setLanguageToState(language, state);
        const chatIds = ['M417', 'M418', 'M419', 'M318', 'M319', 'M320', 'M400', 'M401', 'M402', 'M403', 'M404', 'M405']
            .map(id => `MODEL_PLACEHOLDER_${id}`).concat('MODEL_OPENAI_GPT_OSS_120B_MEDIUM');
        const chatConfigs = chatIds.map(id => ({ ...config(id), supportsImages: true }));
        const initial = buildModelsTabContent(null, chatConfigs);
        expect(initial.match(/class="spec-card"/g)).toHaveLength(13);
        expect(initial).not.toContain('data-model-kind="image"');

        setAvailableImageModelIds(['gemini-3.1-flash-image']);
        const available = buildModelsTabContent(null, chatConfigs);
        expect(available.match(/class="spec-card"/g)).toHaveLength(14);
        const [chatSection, imageSection] = available.split('data-model-kind="image"');
        expect(chatSection.match(/class="spec-card"/g)).toHaveLength(13);
        expect(chatSection).not.toContain('data-model-id="MODEL_PLACEHOLDER_M21"');
        expect(imageSection.match(/class="spec-card"/g)).toHaveLength(1);
        expect(imageSection).toContain('data-model-id="MODEL_PLACEHOLDER_M21"');
        expect(imageSection).toContain('gemini-3.1-flash-image');
        expect(imageSection).toContain(language === 'zh' ? '不适用' : 'Not applicable');

        // A stale static image spec must not survive an authoritative empty catalog.
        setAvailableImageModelIds([]);
        const cleared = buildModelsTabContent(null, chatConfigs);
        expect(cleared.match(/class="spec-card"/g)).toHaveLength(13);
        expect(cleared).not.toContain('data-model-kind="image"');
    });

    it('does not duplicate an image model when it also appears in the picker', () => {
        setAvailableImageModelIds(['gemini-3.1-flash-image']);
        const html = buildModelsTabContent(null, [config('MODEL_PLACEHOLDER_M417'), config('MODEL_PLACEHOLDER_M21')]);
        expect(html.match(/data-model-id="MODEL_PLACEHOLDER_M21"/g)).toHaveLength(1);
        expect(html.match(/class="spec-card"/g)).toHaveLength(2);
    });

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

import { describe, expect, it } from 'vitest';
import { normalizeModelDisplayName, resolveModelId } from '../src/models';
import { collectPricingInputOverrides } from '../src/webview-script';

type Attrs = Record<string, string>;

function input(attrs: Attrs, value: number) {
    return {
        value: String(value),
        getAttribute: (name: string) => attrs[name] ?? null,
    };
}

function modelInputs(model: string, values: Record<string, number>, attrs: Omit<Attrs, 'data-model' | 'data-field'> = {}) {
    return Object.entries(values).map(([field, value]) => input({
        ...attrs,
        'data-model': model,
        'data-field': field,
        'data-original-value': String(value),
        'data-was-custom': attrs['data-was-custom'] ?? '0',
    }, value));
}

describe('collectPricingInputOverrides', () => {
    it('does not persist untouched built-in pricing rows as custom overrides', () => {
        const overrides = collectPricingInputOverrides([
            ...modelInputs('claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5, thinking: 25 }),
            ...modelInputs('gpt-oss-120b', { input: 0.09, output: 0.36, cacheRead: 0, thinking: 0.36 }),
        ]);

        expect(overrides).toEqual({});
    });

    it('keeps existing custom rows and newly changed rows', () => {
        const changed = modelInputs('gpt-oss-120b', { input: 0.09, output: 0.36, cacheRead: 0, thinking: 0.36 });
        changed[0] = input({
            'data-model': 'gpt-oss-120b',
            'data-field': 'input',
            'data-original-value': '0.09',
            'data-was-custom': '0',
        }, 0.12);

        const overrides = collectPricingInputOverrides([
            ...modelInputs('claude-opus-4-6', { input: 7, output: 25, cacheRead: 0.5, thinking: 25 }, { 'data-was-custom': '1' }),
            ...changed,
        ]);

        expect(overrides['claude-opus-4-6']).toEqual({
            input: 7,
            output: 25,
            cacheRead: 0.5,
            cacheWrite: 0,
            thinking: 25,
        });
        expect(overrides['gpt-oss-120b']).toEqual({
            input: 0.12,
            output: 0.36,
            cacheRead: 0,
            cacheWrite: 0,
            thinking: 0.36,
        });
    });
});

describe('static model display fallbacks', () => {
    it('does not expose known model IDs before GetUserStatus labels are loaded', () => {
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M133')).toBe('Gemini 3.5 Flash (High)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M132')).toBe('Gemini 3.5 Flash (High)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M20')).toBe('Gemini 3.5 Flash (Medium)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M187')).toBe('Gemini 3.5 Flash (Low)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M18')).toBe('Gemini 3 Flash');
        expect(normalizeModelDisplayName('MODEL_OPENAI_GPT_OSS_120B_MEDIUM')).toBe('GPT-OSS 120B (Medium)');
        expect(resolveModelId('Gemini 3.5 Flash (Low)')).toBe('MODEL_PLACEHOLDER_M187');
    });

    it('exposes Gemini 3.6 Flash tiers and the M84 takeover of 3.5 Flash (High)', () => {
        // M84 took over the "Gemini 3.5 Flash (High)" identity from M133 (2026-07 live probe).
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M84')).toBe('Gemini 3.5 Flash (High)');
        // 3.6 Flash was renumbered M264/M265/M266 -> M71/M72/M73 (2026-08 live probe). Both the
        // active and the retired IDs must still render a human-readable name.
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M71')).toBe('Gemini 3.6 Flash (High)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M72')).toBe('Gemini 3.6 Flash (Medium)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M73')).toBe('Gemini 3.6 Flash (Low)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M264')).toBe('Gemini 3.6 Flash (High)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M265')).toBe('Gemini 3.6 Flash (Medium)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M266')).toBe('Gemini 3.6 Flash (Low)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M196')).toBe('Gemini 3.6 Flash (Tiered)');
        expect(resolveModelId('Gemini 3.6 Flash (High)')).toBe('MODEL_PLACEHOLDER_M71');
    });

    it('exposes the Gemini 3.7 Flash tiers', () => {
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M298')).toBe('Gemini 3.7 Flash (High)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M299')).toBe('Gemini 3.7 Flash (Medium)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M300')).toBe('Gemini 3.7 Flash (Low)');
        expect(resolveModelId('Gemini 3.7 Flash (High)')).toBe('MODEL_PLACEHOLDER_M298');
    });

    it('exposes the Gemini 3.8 Flash tiers and localized aliases before GetUserStatus loads', () => {
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M319')).toBe('Gemini 3.8 Flash (Medium)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M320')).toBe('Gemini 3.8 Flash (Low)');
        expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M322')).toBe('Gemini 3.8 Flash (Tiered)');
        expect(normalizeModelDisplayName('Gemini 3.8 Flash (高)')).toBe('Gemini 3.8 Flash (High)');
    });
});

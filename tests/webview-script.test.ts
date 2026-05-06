import { describe, expect, it } from 'vitest';
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

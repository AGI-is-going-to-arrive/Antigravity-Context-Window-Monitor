import { describe, expect, it } from 'vitest';
import { guessContextLimitSpec, getModelSpecs, resolveModelId, getContextLimit } from '../src/models';
import { findPricing } from '../src/pricing-store';

describe('guessContextLimitSpec placeholder collision guard', () => {
    it('maps Gemini 3.6 Flash placeholders to the 256K flash profile, not the m26 Claude branch', () => {
        for (const id of ['MODEL_PLACEHOLDER_M264', 'MODEL_PLACEHOLDER_M265', 'MODEL_PLACEHOLDER_M266']) {
            const spec = guessContextLimitSpec(id);
            expect(spec.cpLimit).toBe(256000);
            expect(spec.cpThreshold).toBe(140000);
            expect(spec.supportsThinking).toBe(false);
        }
    });

    it('keeps Claude placeholders on the premium thinking profile', () => {
        for (const id of ['MODEL_PLACEHOLDER_M26', 'MODEL_PLACEHOLDER_M35']) {
            const spec = guessContextLimitSpec(id);
            expect(spec.cpLimit).toBe(160000);
            expect(spec.supportsThinking).toBe(true);
        }
    });

    it('does not let an unknown placeholder substring-collide into the Claude branch', () => {
        // Old substring logic: 'model_placeholder_m350'.includes('m35') wrongly hit Claude (160K thinking).
        const spec = guessContextLimitSpec('MODEL_PLACEHOLDER_M350');
        expect(spec.supportsThinking).toBe(false);
        expect(spec.cpLimit).toBe(0);
    });

    it('routes 3.5 flash placeholders (M84/M20/M187) to the 256K flash profile', () => {
        for (const id of ['MODEL_PLACEHOLDER_M84', 'MODEL_PLACEHOLDER_M20', 'MODEL_PLACEHOLDER_M187']) {
            expect(guessContextLimitSpec(id).cpLimit).toBe(256000);
        }
    });

    it('still keyword-matches catalog model_id names to the flash branch', () => {
        const spec = guessContextLimitSpec('gemini-3.6-flash-high');
        expect(spec.cpLimit).toBe(256000);
        expect(spec.cpThreshold).toBe(140000);
        expect(spec.supportsThinking).toBe(false);
    });
});

describe('getModelSpecs ordering', () => {
    it('renders Gemini 3.6 Flash tiers and M84 first, with retired M133 last', () => {
        const ids = getModelSpecs().map(s => s.placeholderId);
        expect(ids).toEqual([
            'MODEL_PLACEHOLDER_M264',
            'MODEL_PLACEHOLDER_M265',
            'MODEL_PLACEHOLDER_M266',
            'MODEL_PLACEHOLDER_M84',
            'MODEL_PLACEHOLDER_M20',
            'MODEL_PLACEHOLDER_M187',
            'MODEL_UNSPECIFIED',
            'MODEL_PLACEHOLDER_M16',
            'MODEL_PLACEHOLDER_M36',
            'MODEL_PLACEHOLDER_M35',
            'MODEL_PLACEHOLDER_M26',
            'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
            'MODEL_PLACEHOLDER_M133',
        ]);
    });
});

describe('model identity takeover + 3.6 pricing', () => {
    it('resolves gemini-3-flash-agent to M84 (identity takeover from M133)', () => {
        expect(resolveModelId('gemini-3-flash-agent')).toBe('MODEL_PLACEHOLDER_M84');
    });

    it('prices the Gemini 3.6 Flash family (input 1.50 / output 7.50)', () => {
        const pricing = findPricing('gemini-3.6-flash-high');
        expect(pricing).not.toBeNull();
        expect(pricing?.input).toBe(1.5);
        expect(pricing?.output).toBe(7.5);
    });
});

describe('adversarial round1 regression pins (W1/W2/I1)', () => {
    // I1: reverse label lookup must land on active M84, not retired M133/M132.
    it('resolves the "Gemini 3.5 Flash (High)" label to active M84, not retired M133', () => {
        expect(resolveModelId('Gemini 3.5 Flash (High)')).toBe('MODEL_PLACEHOLDER_M84');
    });

    // W2: raw catalog name must agree with its M18 placeholder (159K), not the flash-keyword 255K.
    it('getContextLimit("gemini-3-flash") agrees with its M18 placeholder (159K), not flash-guess 255K', () => {
        expect(getContextLimit('gemini-3-flash')).toBe(159_000);
        expect(getContextLimit('gemini-3-flash')).toBe(getContextLimit('MODEL_PLACEHOLDER_M18'));
    });

    // W1: MODEL_UNSPECIFIED status-bar limit and the models-panel spec share one source (-1K relation).
    it('MODEL_UNSPECIFIED context limit is consistent with its active spec cpLimit', () => {
        const spec = getModelSpecs().find(s => s.placeholderId === 'MODEL_UNSPECIFIED');
        expect(spec?.cpLimit).toBe(256_000);
        expect(getContextLimit('MODEL_UNSPECIFIED')).toBe(255_000);
        expect(getContextLimit('MODEL_UNSPECIFIED')).toBe(spec!.cpLimit - 1000);
    });

    // W2: flash guess is generation-aware — pre-3.5 stays 128K, 3.5/3.6+ doubles to 256K.
    it('guessContextLimitSpec is generation-aware for flash names', () => {
        expect(guessContextLimitSpec('gemini-2.5-flash').cpLimit).toBe(128_000);
        expect(guessContextLimitSpec('gemini-3.6-flash-anything').cpLimit).toBe(256_000);
    });
});

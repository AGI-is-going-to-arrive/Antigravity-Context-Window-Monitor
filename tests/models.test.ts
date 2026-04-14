import { describe, it, expect } from 'vitest';
import { resolveModelId, normalizeModelDisplayName, GHOST_CHECKPOINT_MODELS } from '../src/models';

describe('GHOST_CHECKPOINT_MODELS', () => {
    it('should contain M50 (Flash Lite)', () => {
        expect(GHOST_CHECKPOINT_MODELS.has('MODEL_PLACEHOLDER_M50')).toBe(true);
    });

    it('should not contain regular user-facing models', () => {
        expect(GHOST_CHECKPOINT_MODELS.has('MODEL_PLACEHOLDER_M37')).toBe(false);
        expect(GHOST_CHECKPOINT_MODELS.has('MODEL_PLACEHOLDER_M35')).toBe(false);
    });
});

describe('resolveModelId — legacy alias resolution', () => {
    it('should resolve current Chinese display name (高)', () => {
        expect(resolveModelId('Gemini 3.1 Pro (高)')).toBe('MODEL_PLACEHOLDER_M37');
    });

    it('should resolve legacy Chinese display name (强) via alias', () => {
        expect(resolveModelId('Gemini 3.1 Pro (强)')).toBe('MODEL_PLACEHOLDER_M37');
    });

    it('should resolve legacy Chinese display name (弱) via alias', () => {
        expect(resolveModelId('Gemini 3.1 Pro (弱)')).toBe('MODEL_PLACEHOLDER_M36');
    });

    it('should resolve legacy bilingual format via alias', () => {
        expect(resolveModelId('Gemini 3.1 Pro (High) / Gemini 3.1 Pro (强)')).toBe('MODEL_PLACEHOLDER_M37');
        expect(resolveModelId('Gemini 3.1 Pro (Low) / Gemini 3.1 Pro (弱)')).toBe('MODEL_PLACEHOLDER_M36');
    });

    it('should resolve current bilingual format directly', () => {
        expect(resolveModelId('Gemini 3.1 Pro (High) / Gemini 3.1 Pro (高)')).toBe('MODEL_PLACEHOLDER_M37');
    });

    it('should resolve English display name', () => {
        expect(resolveModelId('Gemini 3.1 Pro (High)')).toBe('MODEL_PLACEHOLDER_M37');
        expect(resolveModelId('Gemini 3.1 Pro (Low)')).toBe('MODEL_PLACEHOLDER_M36');
    });

    it('should resolve model IDs directly', () => {
        expect(resolveModelId('MODEL_PLACEHOLDER_M37')).toBe('MODEL_PLACEHOLDER_M37');
        expect(resolveModelId('MODEL_PLACEHOLDER_M50')).toBe('MODEL_PLACEHOLDER_M50');
    });

    it('should return undefined for unknown strings', () => {
        expect(resolveModelId('Unknown Model XYZ')).toBeUndefined();
    });
});

describe('normalizeModelDisplayName — legacy normalization', () => {
    it('should normalize legacy 强 to current display name', () => {
        const result = normalizeModelDisplayName('Gemini 3.1 Pro (强)');
        // Should resolve to MODEL_PLACEHOLDER_M37 then return current display name
        expect(result).toContain('Gemini 3.1 Pro');
        expect(result).not.toContain('强');
    });
});

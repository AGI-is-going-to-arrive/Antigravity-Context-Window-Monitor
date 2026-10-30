import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndOverrideCheckpointerLimits } from '../src/extension';
import { rpcCall } from '../src/rpc-client';
import { classifyStep, extractToolName } from '../src/activity/helpers';
import {
    getAvailableImageModelSpecs, getContextLimit, getModelDisplayName, getModelSpecs, getQuotaPoolKey,
    guessContextLimitSpec, isImageGenerationModel, resolveModelId, setAvailableImageModelIds, updateModelSpec,
} from '../src/models';
import { findPricing } from '../src/pricing-store';
import { verifiedModelCatalog } from './fixtures/model-catalog-2026-10-31';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));
const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };
const imageSpec = { ...getModelSpecs().find(spec => spec.placeholderId === 'MODEL_PLACEHOLDER_M21')! };
const imageMetadata = {
    model: 'MODEL_PLACEHOLDER_M21', displayName: 'Gemini 3.1 Flash Image',
    maxTokens: 65536, maxOutputTokens: 65536, apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    supportsImages: true,
};

afterEach(() => {
    vi.clearAllMocks();
    setAvailableImageModelIds([]);
    updateModelSpec('MODEL_PLACEHOLDER_M21', { ...imageSpec, supportsAdaptiveThinking: undefined, thinkingLevel: undefined });
});

describe('dedicated image model registry', () => {
    it('keeps image native capacity separate from unknown chat compression and chat quota', () => {
        for (const identity of ['MODEL_PLACEHOLDER_M21', 'gemini-3.1-flash-image', 'Gemini 3.1 Flash Image']) {
            expect(resolveModelId(identity)).toBe('MODEL_PLACEHOLDER_M21');
            expect(isImageGenerationModel(identity)).toBe(true);
            expect(getContextLimit(identity)).toBe(65536);
            expect(getQuotaPoolKey(identity, 'chat-reset')).toBe('image:MODEL_PLACEHOLDER_M21');
            expect(guessContextLimitSpec(identity)).toEqual({ cpLimit: 0, cpThreshold: 0, maxTokens: 65536, supportsThinking: false });
            expect(findPricing(identity)).toBeNull();
        }
        expect(getQuotaPoolKey('MODEL_PLACEHOLDER_M417', 'chat-reset')).toBe('gemini');
        expect(isImageGenerationModel('MODEL_PLACEHOLDER_M417')).toBe(false);
        expect(isImageGenerationModel('MODEL_PLACEHOLDER_M210')).toBe(false);
        expect(isImageGenerationModel('some-image-keyword')).toBe(false);
        expect(getModelDisplayName('MODEL_UNSPECIFIED')).toBe('MODEL_UNSPECIFIED');
    });

    it('only exposes image cards from an explicitly available catalog and clears on account changes', () => {
        expect(getAvailableImageModelSpecs()).toEqual([]);
        setAvailableImageModelIds(['gemini-3.1-flash-image', 'MODEL_PLACEHOLDER_M21', 'unknown-image']);
        expect(getAvailableImageModelSpecs().map(spec => spec.placeholderId)).toEqual(['MODEL_PLACEHOLDER_M21']);
        setAvailableImageModelIds([]);
        expect(getAvailableImageModelSpecs()).toEqual([]);
        expect(isImageGenerationModel('MODEL_PLACEHOLDER_M21')).toBe(true); // archived identity survives
    });

    it('syncs an image-only catalog without inventing compression or requiring a picker entry', async () => {
        updateModelSpec('MODEL_PLACEHOLDER_M21', { cpLimit: 159000, cpThreshold: 50000, thinkingBudget: 1024 });
        vi.mocked(rpcCall).mockResolvedValueOnce({ response: {
            imageGenerationModelIds: ['gemini-3.1-flash-image'], models: { 'gemini-3.1-flash-image': imageMetadata },
        } });
        expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
        expect(getAvailableImageModelSpecs()).toHaveLength(1);
        expect(getAvailableImageModelSpecs()[0]).toMatchObject({ isImageGeneration: true,
            cpLimit: 0, cpThreshold: 0, maxTokens: 65536, maxOutputTokens: 65536, thinkingBudget: 0, supportsThinking: false });
        expect(getContextLimit('MODEL_PLACEHOLDER_M21')).toBe(65536);
    });

    it('registers a future image identity from the explicit capability list, not supportsImages alone', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce({ imageGenerationModelIds: ['fixture-image-v2'], models: {
            'fixture-image-v2': { ...imageMetadata, model: 'MODEL_PLACEHOLDER_M9021', displayName: 'Fixture Image V2', maxTokens: 32768 },
            'fixture-vision-only': { ...imageMetadata, model: 'MODEL_PLACEHOLDER_M9022', displayName: 'Fixture Vision Only' },
        } });
        expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
        expect(resolveModelId('fixture-image-v2')).toBe('MODEL_PLACEHOLDER_M9021');
        expect(getModelDisplayName('MODEL_PLACEHOLDER_M9021')).toBe('Fixture Image V2');
        expect(getAvailableImageModelSpecs().map(spec => spec.placeholderId)).toEqual(['MODEL_PLACEHOLDER_M9021']);
        expect(getContextLimit('fixture-image-v2')).toBe(32768);
        expect(getQuotaPoolKey('fixture-image-v2', 'chat-reset')).toBe('image:MODEL_PLACEHOLDER_M9021');
        expect(isImageGenerationModel('Fixture Image V2')).toBe(true);
        expect(isImageGenerationModel('fixture-vision-only')).toBe(false);
        expect(resolveModelId('fixture-vision-only')).toBeUndefined();
    });

    it('applies an authoritative empty image list without erasing historical image identity', async () => {
        setAvailableImageModelIds(['gemini-3.1-flash-image']);
        vi.mocked(rpcCall).mockResolvedValueOnce({ response: { imageGenerationModelIds: [], models: {} } });
        expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
        expect(getAvailableImageModelSpecs()).toEqual([]);
        expect(resolveModelId('gemini-3.1-flash-image')).toBe('MODEL_PLACEHOLDER_M21');
    });

    it('preserves last valid image availability when RPC or the capability list is malformed', async () => {
        setAvailableImageModelIds(['gemini-3.1-flash-image']);
        vi.mocked(rpcCall).mockRejectedValueOnce(new Error('fixture unavailable'));
        expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
        vi.mocked(rpcCall).mockResolvedValueOnce({ response: { imageGenerationModelIds: [null], models: {} } });
        expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(false);
        expect(getAvailableImageModelSpecs().map(spec => spec.placeholderId)).toEqual(['MODEL_PLACEHOLDER_M21']);
    });

    it('classifies the typed generation step as a readable tool without treating image input as generation', () => {
        const classification = classifyStep('CORTEX_STEP_TYPE_GENERATE_IMAGE');
        expect(classification).toEqual({ category: 'tool', icon: '🎨', label: 'generate_image' });
        expect(extractToolName({ type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE', generateImage: { modelName: 'gemini-3.1-flash-image' } }, classification.label)).toBe('generate_image');
        expect(classifyStep('CORTEX_STEP_TYPE_USER_INPUT').category).toBe('user');
    });

    it('matches every currently available chat model and image model against the captured catalog', async () => {
        expect(verifiedModelCatalog.filter(row => row.inLivePicker)).toHaveLength(13);
        const models = Object.fromEntries(verifiedModelCatalog.map(row => [row.catalogId, {
            ...row.metadata,
            ...(row.checkpointer ? { modelExperiments: { experiments: {
                CASCADE_USE_EXPERIMENT_CHECKPOINTER: { stringValue: JSON.stringify(row.checkpointer) },
            } } } : {}),
        }]));
        vi.mocked(rpcCall).mockResolvedValueOnce({ response: {
            models, imageGenerationModelIds: verifiedModelCatalog.filter(row => row.isImageGenerationModel).map(row => row.catalogId),
        } });
        expect(await fetchAndOverrideCheckpointerLimits(ls, () => {})).toBe(true);
        for (const row of verifiedModelCatalog) {
            const spec = getModelSpecs().find(item => item.placeholderId === row.metadata.model)!;
            const cpLimit = row.checkpointer ? Number(row.checkpointer.max_token_limit) : 0;
            expect(spec, row.catalogId).toMatchObject({ modelId: row.catalogId,
                displayName: row.metadata.displayName, apiProvider: row.metadata.apiProvider.replace('API_PROVIDER_', ''),
                maxTokens: row.metadata.maxTokens, maxOutputTokens: row.metadata.maxOutputTokens,
                cpLimit, cpThreshold: row.checkpointer ? Number(row.checkpointer.token_threshold) : 0,
                supportsThinking: 'supportsThinking' in row.metadata ? row.metadata.supportsThinking : false,
                thinkingBudget: 'thinkingBudget' in row.metadata ? row.metadata.thinkingBudget : 0,
                thinkingLevel: 'thinkingLevel' in row.metadata ? row.metadata.thinkingLevel : 0,
            });
            expect(resolveModelId(row.catalogId)).toBe(row.metadata.model);
            expect(getContextLimit(row.catalogId)).toBe(cpLimit || row.metadata.maxTokens);
            expect(isImageGenerationModel(row.catalogId)).toBe(row.isImageGenerationModel);
        }
        expect(getAvailableImageModelSpecs().map(spec => spec.modelId)).toEqual(['gemini-3.1-flash-image']);
    });
});

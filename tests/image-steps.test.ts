import { describe, expect, it } from 'vitest';
import { isImageGenStep, processSteps } from '../src/tracker';
import { StepType } from '../src/constants';

describe('image generation trajectory isolation', () => {
    it.each([
        { type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE' },
        { type: 'CORTEX_STEP_TYPE_IMAGE_GENERATION' },
        { type: 'FUTURE_IMAGE_TOOL', generateImage: { modelName: 'gemini-3.1-flash-image' } },
    ])('recognizes typed image generation with no generator metadata: %j', step => {
        expect(isImageGenStep(step, '')).toBe(true);
        expect(processSteps([step]).imageGenStepCount).toBe(1);
    });

    it('recognizes the opaque image-model ID without relying on name keywords', () => {
        expect(isImageGenStep({ type: 'FUTURE_GENERATOR' }, 'MODEL_PLACEHOLDER_M21')).toBe(true);
    });

    it.each(['CORTEX_STEP_TYPE_GENERATE_CODE', 'CORTEX_STEP_TYPE_VIEW_IMAGE', StepType.USER_INPUT])(
        'does not count ordinary image inputs or unrelated generators: %s', type => {
            expect(isImageGenStep({ type }, 'MODEL_PLACEHOLDER_M417')).toBe(false);
        },
    );

    it('does not let the image backend replace the text conversation model or context snapshot', () => {
        const usage = processSteps([
            { type: StepType.USER_INPUT, userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M419' } } } },
            { type: StepType.PLANNER_RESPONSE, metadata: { generatorModel: 'MODEL_PLACEHOLDER_M419',
                modelUsage: { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '12000', outputTokens: '100' } } },
            { type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE', generateImage: { modelName: 'gemini-3.1-flash-image' },
                metadata: { generatorModel: 'MODEL_PLACEHOLDER_M21', requestedModel: { model: 'MODEL_PLACEHOLDER_M21' },
                    modelUsage: { model: 'MODEL_PLACEHOLDER_M21', inputTokens: '50', outputTokens: '1120' }, toolCallOutputTokens: 20 } },
        ]);
        expect(usage).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419', contextUsed: 12120,
            totalOutputTokens: 100, imageGenStepCount: 1, totalToolCallOutputTokens: 20, isEstimated: true });
        expect(usage.lastModelUsage?.model).toBe('MODEL_PLACEHOLDER_M419');
    });

    it('keeps image planner usage out of the coordinating text request snapshot', () => {
        const usage = processSteps([
            { type: StepType.USER_INPUT, userInput: { userConfig: { plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M419' } } } },
            { type: StepType.PLANNER_RESPONSE, metadata: { generatorModel: 'MODEL_PLACEHOLDER_M21',
                modelUsage: { model: 'MODEL_PLACEHOLDER_M21', inputTokens: '50', outputTokens: '1120' } } },
        ]);
        expect(usage.model).toBe('MODEL_PLACEHOLDER_M419');
        expect(usage.imageGenStepCount).toBe(1);
        expect(usage.lastModelUsage).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';
import {
    applyTrajectoryModelHints,
    extractTrajectoryModelHints,
    mergeGMCallEntries,
    parseGMEntry,
    shouldEnrichConversation,
} from '../src/gm/parser';
import { resolveModelId } from '../src/models';

function makeGM(overrides: {
    model?: string;
    responseModel?: string;
    stepIndices?: number[];
    executionId?: string;
} = {}): Record<string, unknown> {
    return {
        stepIndices: overrides.stepIndices || [1],
        executionId: overrides.executionId || 'exec-1',
        chatModel: {
            model: overrides.model,
            responseModel: overrides.responseModel,
            usage: {},
            chatStartMetadata: {
                createdAt: '2026-06-02T00:00:00.000Z',
                startStepIndex: 1,
            },
        },
    };
}

describe('GM model capture', () => {
    it('keeps chatModel.model as the authoritative placeholder identity', () => {
        const call = parseGMEntry(makeGM({
            model: 'MODEL_PLACEHOLDER_M132',
            responseModel: 'gemini-3-flash-a',
        }));

        expect(call.model).toBe('MODEL_PLACEHOLDER_M132');
        expect(call.modelSource).toBe('chatModel');
        expect(call.modelDisplay).toContain('Gemini 3.5 Flash');
    });

    it('does not let a conflicting responseModel sample remap an existing alias', () => {
        expect(resolveModelId('gemini-3-flash-a')).toBe('MODEL_PLACEHOLDER_M132');

        const call = parseGMEntry(makeGM({
            model: 'MODEL_PLACEHOLDER_M133',
            responseModel: 'gemini-3-flash-a',
        }));

        expect(call.model).toBe('MODEL_PLACEHOLDER_M133');
        expect(resolveModelId('gemini-3-flash-a')).toBe('MODEL_PLACEHOLDER_M132');
    });

    it('uses trajectory requestedModel to replace low-trust responseModel fallback', () => {
        const call = parseGMEntry(makeGM({
            responseModel: 'gemini-3-flash-a',
            stepIndices: [42],
        }));

        expect(call.model).toBe('MODEL_PLACEHOLDER_M132');
        expect(call.modelSource).toBe('responseAlias');
        expect(shouldEnrichConversation(50, [call])).toBe(true);

        const [updated] = applyTrajectoryModelHints([call], [
            {
                stepIndex: 42,
                metadata: {
                    requestedModel: { model: 'MODEL_PLACEHOLDER_M133' },
                },
            },
        ]);

        expect(updated.model).toBe('MODEL_PLACEHOLDER_M133');
        expect(updated.modelSource).toBe('trajectory');
    });

    it('does not overwrite an authoritative GM model with trajectory hints', () => {
        const call = parseGMEntry(makeGM({
            model: 'MODEL_PLACEHOLDER_M132',
            responseModel: 'gemini-3-flash-a',
            stepIndices: [42],
        }));

        const [updated] = applyTrajectoryModelHints([call], [
            {
                stepIndex: 42,
                metadata: {
                    requestedModel: { model: 'MODEL_PLACEHOLDER_M133' },
                },
            },
        ]);

        expect(updated.model).toBe('MODEL_PLACEHOLDER_M132');
        expect(updated.modelSource).toBe('chatModel');
    });

    it('falls back to user planner requestedModel when GM model fields are absent', () => {
        const call = parseGMEntry(makeGM({
            stepIndices: [7],
        }));

        const hints = extractTrajectoryModelHints([
            {
                stepIndex: 7,
                userInput: {
                    userConfig: {
                        plannerConfig: {
                            requestedModel: { model: 'MODEL_PLACEHOLDER_M187' },
                        },
                    },
                },
            },
        ]);
        const [updated] = applyTrajectoryModelHints([call], [
            {
                stepIndex: 7,
                userInput: {
                    userConfig: {
                        plannerConfig: {
                            requestedModel: { model: 'MODEL_PLACEHOLDER_M187' },
                        },
                    },
                },
            },
        ]);

        expect(hints.get(7)).toBe('MODEL_PLACEHOLDER_M187');
        expect(updated.model).toBe('MODEL_PLACEHOLDER_M187');
        expect(updated.modelSource).toBe('trajectory');
    });

    it('prefers embedded authoritative model over a primary response alias during merge', () => {
        const primary = parseGMEntry(makeGM({
            responseModel: 'gemini-3-flash-a',
            executionId: 'exec-merge',
        }));
        const embedded = parseGMEntry(makeGM({
            model: 'MODEL_PLACEHOLDER_M187',
            executionId: 'exec-merge',
        }));

        const merged = mergeGMCallEntries(primary, embedded);

        expect(merged.model).toBe('MODEL_PLACEHOLDER_M187');
        expect(merged.modelSource).toBe('chatModel');
    });
});

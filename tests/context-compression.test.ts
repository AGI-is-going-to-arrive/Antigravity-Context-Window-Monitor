import { describe, expect, it } from 'vitest';
import { measuredContextDrop, hasSameUsageInputs } from '../src/extension';
import type { ContextUsage } from '../src/tracker';

const measured = { model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', contextUsed: 8651,
    contextLimit: 80000, isEstimated: false, tokenUsageSource: 'planner' as const };

describe('context reduction evidence', () => {
    it('does not report the live GPT-OSS estimate-to-provider correction as compression', () => {
        expect(measuredContextDrop({ ...measured, contextUsed: 10015, isEstimated: true,
            tokenUsageSource: 'estimated' }, measured, false)).toBe(0);
    });

    it('compares measured snapshots of the same model and source', () => {
        expect(measuredContextDrop({ ...measured, contextUsed: 12000 }, measured, false)).toBe(3349);
        expect(measuredContextDrop({ ...measured, contextUsed: 12000 }, measured, true)).toBe(0);
        expect(measuredContextDrop({ ...measured, contextUsed: 9000 }, measured, false)).toBe(0);
    });

    it('excludes model switches, checkpoint/planner transitions, missing and invalid values', () => {
        for (const previous of [undefined, { ...measured, contextUsed: 12000, model: 'MODEL_PLACEHOLDER_M417' },
            { ...measured, contextUsed: 12000, tokenUsageSource: 'checkpoint' as const },
            { ...measured, contextUsed: Infinity }, { ...measured, contextUsed: 12000, model: '' }]) {
            expect(measuredContextDrop(previous, measured, false)).toBe(0);
        }
        expect(measuredContextDrop({ ...measured, contextUsed: 12000 }, { ...measured, isEstimated: true }, false)).toBe(0);
    });

    it('re-evaluates cached inferred reductions instead of persisting a transient warning forever', () => {
        const cached = { ...measured, cascadeId: 'test', stepCount: 2, lastModifiedTime: 'now',
            imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
            status: 'CASCADE_RUN_STATUS_IDLE', compressionDetected: true, checkpointCompressionDrop: 0 } as ContextUsage;
        expect(hasSameUsageInputs(cached, cached)).toBe(false);
        expect(hasSameUsageInputs({ ...cached, compressionDetected: false }, cached)).toBe(true);
    });
});

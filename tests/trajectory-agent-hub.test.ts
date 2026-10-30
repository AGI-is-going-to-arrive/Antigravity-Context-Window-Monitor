import { describe, expect, it, vi } from 'vitest';
import { processSteps, getContextUsage, type ContextUsage, type TrajectorySummary } from '../src/tracker';
import { applyGMContextToUsage, hasSameUsageInputs } from '../src/extension';
import { rpcCall } from '../src/rpc-client';
import { StepType } from '../src/constants';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));

// Only model/token metadata from the authorized 2026-10-31 Low OK call.
// No prompts, customization content, account or conversation identifiers.
const lowUsage = { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '12905', outputTokens: '5', responseOutputTokens: '5' };
function userInput(model = 'MODEL_PLACEHOLDER_M419'): Record<string, unknown> {
    return { type: StepType.USER_INPUT, userInput: { userResponse: 'OK',
        userConfig: { plannerConfig: { planModel: model } } } };
}
function response(usage: Record<string, unknown> = lowUsage): Record<string, unknown> {
    return { type: StepType.PLANNER_RESPONSE, metadata: { generatorModel: usage.model, modelUsage: usage },
        plannerResponse: { response: 'OK', thinking: 'fixture' } };
}
function contextUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return { cascadeId: 'test-only', title: 'fixture', model: 'MODEL_PLACEHOLDER_M419',
        modelDisplayName: 'Gemini 4 Argon (Low)', contextUsed: 12910, totalOutputTokens: 5,
        totalToolCallOutputTokens: 0, contextLimit: 256000, usagePercent: 12910 / 256000 * 100,
        stepCount: 2, lastModifiedTime: '2026-10-31T00:00:00Z', status: 'CASCADE_RUN_STATUS_IDLE',
        isEstimated: false, lastModelUsage: { ...lowUsage, inputTokens: 12905, outputTokens: 5,
            responseOutputTokens: 5, cacheReadTokens: 0 }, estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0, compressionDetected: false, checkpointCompressionDrop: 0,
        hasGaps: false, checkpointModel: '', createdTime: '', lastUserInputTime: '',
        lastUserInputStepIndex: 0, repositoryName: '', gitOriginUrl: '', branchName: '', gitRootUri: '',
        tokenUsageSource: 'planner', ...overrides };
}

describe('agy planner token snapshots', () => {
    it('uses precise Low usage without a checkpoint and without adding response text twice', () => {
        expect(processSteps([userInput(), response()])).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419',
            inputTokens: 12905, totalOutputTokens: 5, contextUsed: 12910, isEstimated: false,
            tokenUsageSource: 'planner', estimatedDeltaSinceCheckpoint: 0, checkpointModel: '' });
    });

    it.each(['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M418', 'MODEL_PLACEHOLDER_M419'])(
        'identifies selected %s before a response exists', model => {
            expect(processSteps([userInput(model)])).toMatchObject({ model, isEstimated: true, tokenUsageSource: 'estimated' });
        },
    );

    it('uses the latest response snapshot across a model switch, not a sum of all requests', () => {
        const latest = { ...lowUsage, model: 'MODEL_PLACEHOLDER_M417', inputTokens: 14000, outputTokens: 20 };
        expect(processSteps([userInput(), response(), userInput(latest.model), response(latest)]))
            .toMatchObject({ model: latest.model, contextUsed: 14020, totalOutputTokens: 20, isEstimated: false });
    });

    it('preserves legacy checkpoint accounting and tracks later tool/user deltas', () => {
        const checkpoint = { type: StepType.CHECKPOINT, metadata: { generatorModel: 'MODEL_PLACEHOLDER_M50',
            modelUsage: { model: 'MODEL_PLACEHOLDER_M50', inputTokens: '1000', outputTokens: '50' } } };
        expect(processSteps([userInput(), checkpoint])).toMatchObject({ contextUsed: 1050,
            model: 'MODEL_PLACEHOLDER_M419', tokenUsageSource: 'checkpoint', checkpointModel: 'MODEL_PLACEHOLDER_M50' });
        expect(processSteps([checkpoint, response(), { type: 'CORTEX_STEP_TYPE_TOOL', metadata: { toolCallOutputTokens: 100 } }, userInput()]))
            .toMatchObject({ contextUsed: 13011, totalToolCallOutputTokens: 100,
                tokenUsageSource: 'planner', isEstimated: true, estimatedDeltaSinceCheckpoint: 101 });
    });

    it.each(['NaN', '12905oops', '-5', '1.5', null, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed model token count %s instead of claiming precision', inputTokens => {
            const result = processSteps([userInput(), response({ ...lowUsage, inputTokens })]);
            expect(result.lastModelUsage).toBeNull();
            expect(result.isEstimated).toBe(true);
            expect(Number.isFinite(result.contextUsed)).toBe(true);
        },
    );

    it('accepts protobuf zero input with a real output count', () => {
        const result = processSteps([response({ model: 'MODEL_PLACEHOLDER_M419', outputTokens: '5' })]);
        expect(result.contextUsed).toBe(5);
        expect(result.isEstimated).toBe(false);
    });

    it('produces correct model identity and context from a summary with no model hints', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce({ steps: [userInput(), response()] });
        const summary = { cascadeId: 'test-only', stepCount: 2, requestedModel: '', generatorModel: '',
            summary: 'fixture', status: 'CASCADE_RUN_STATUS_IDLE' } as TrajectorySummary;
        const usage = await getContextUsage({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false }, summary);
        expect(usage).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419', modelDisplayName: 'Gemini 4 Argon (Low)',
            contextUsed: 12910, totalOutputTokens: 5, tokenUsageSource: 'planner', isEstimated: false });
    });
});

describe('context precision and stale caches', () => {
    it('does not replace provider counts with the larger pre-call GM estimate', () => {
        const usage = contextUsage();
        expect(applyGMContextToUsage(usage, 18324)).toBe(false);
        expect(usage.contextUsed).toBe(12910);
        expect(usage.isEstimated).toBe(false);
    });

    it('keeps a GM fallback explicitly estimated and rejects non-finite values', () => {
        const usage = contextUsage({ lastModelUsage: null, tokenUsageSource: 'estimated', contextUsed: 10000 });
        expect(applyGMContextToUsage(usage, 18324)).toBe(true);
        expect(usage.isEstimated).toBe(true);
        expect(usage.usagePercent).toBe(18324 / 256000 * 100);
        for (const value of [NaN, Infinity, -1, 0, 1.5]) { expect(applyGMContextToUsage(usage, value)).toBe(false); }
    });

    it('re-fetches pre-fix cached usage and mutable running steps', () => {
        const usage = contextUsage();
        expect(hasSameUsageInputs(usage, usage)).toBe(true);
        expect(hasSameUsageInputs({ ...usage, tokenUsageSource: undefined }, usage)).toBe(false);
        expect(hasSameUsageInputs(usage, { ...usage, status: 'CASCADE_RUN_STATUS_RUNNING' })).toBe(false);
        expect(hasSameUsageInputs({ ...usage, status: 'CASCADE_RUN_STATUS_RUNNING' }, usage)).toBe(false);
    });
});

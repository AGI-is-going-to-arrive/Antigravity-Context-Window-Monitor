import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    extractLinkedSubagentIds, getContextUsage, refreshWorkflowImageUsage, resetImageWorkflowCache,
    type ContextUsage, type TrajectorySummary,
} from '../src/tracker';
import { rpcCall } from '../src/rpc-client';
import { StatusBarManager } from '../src/statusbar';
import { setLanguageToState, type Language } from '../src/i18n';
import { MonitorStore } from '../src/monitor-store';
import { hasSameUsageInputs, invalidateLiveModelMetadata } from '../src/extension';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));
const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

function invoke(...ids: string[]): Record<string, unknown> {
    return { type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT', invokeSubagent: {
        subagents: [{ typeName: 'image' }], results: ids.map(conversationId => ({ conversationId })),
    } };
}
function image(): Record<string, unknown> {
    return { type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE', status: 'CORTEX_STEP_STATUS_DONE',
        metadata: { generatorModel: 'MODEL_PLACEHOLDER_M322', toolCall: { name: 'generate_image' } },
        generateImage: { modelName: 'gemini-3.1-flash-image', aspectRatio: '1:1', generatedMedia: { mimeType: 'image/jpeg' } } };
}
function child(steps: Array<Record<string, unknown>>, status = 'CASCADE_RUN_STATUS_IDLE') {
    return { trajectory: { steps }, status, numTotalSteps: steps.length };
}
function usage(children = ['child']): ContextUsage {
    return { cascadeId: 'parent', title: 'Fixture', model: 'MODEL_PLACEHOLDER_M419',
        modelDisplayName: 'Gemini 4 Argon (Low)', contextUsed: 13752, contextLimit: 256000,
        totalOutputTokens: 248, totalToolCallOutputTokens: 0, usagePercent: 13752 / 256000 * 100,
        stepCount: 6, lastModifiedTime: '2026-10-31T00:00:00Z', status: 'CASCADE_RUN_STATUS_IDLE',
        isEstimated: false, lastModelUsage: { model: 'MODEL_PLACEHOLDER_M419', inputTokens: 2285,
            cacheReadTokens: 11219, outputTokens: 248, responseOutputTokens: 248 },
        estimatedDeltaSinceCheckpoint: 0, imageGenStepCount: 0, imageGenerationModels: [],
        imageGenerationIncomplete: false, imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: children },
        compressionDetected: false, checkpointCompressionDrop: 0, hasGaps: false, checkpointModel: '',
        createdTime: '', lastUserInputTime: '', lastUserInputStepIndex: 0, repositoryName: '',
        gitOriginUrl: '', branchName: '', gitRootUri: '', tokenUsageSource: 'planner' };
}

afterEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetImageWorkflowCache();
    await setLanguageToState('both', state);
});

describe('linked image workflows', () => {
    it('reads references only from the typed invocation result and deduplicates them', () => {
        expect(extractLinkedSubagentIds([
            invoke('child-a', 'child-a', 'child-b'),
            { type: 'CORTEX_STEP_TYPE_USER_INPUT', invokeSubagent: { results: [{ conversationId: 'unrelated' }] } },
            { type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT', conversationId: 'unrelated',
                invokeSubagent: { subagents: [{ initialPrompt: 'unrelated' }], results: [null, {}, { conversationId: '' }, { conversationId: 1 }] } },
        ])).toEqual(['child-a', 'child-b']);
    });

    it('reports the actual M21 image inside an M322 child while preserving the parent measured context', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce({ steps: [invoke('child'), {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { generatorModel: 'MODEL_PLACEHOLDER_M419',
                modelUsage: { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '2285', cacheReadTokens: '11219', outputTokens: '248' } },
        }] });
        vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
        const trajectory = { ...usage(), summary: 'Fixture', workspaceUris: [], requestedModel: '', generatorModel: '' } as TrajectorySummary;
        const result = await getContextUsage(ls, trajectory);
        expect(result).toMatchObject({ imageGenStepCount: 1, imageGenerationModels: ['MODEL_PLACEHOLDER_M21'],
            imageGenerationIncomplete: false, model: 'MODEL_PLACEHOLDER_M419', contextUsed: 13752,
            totalOutputTokens: 248, isEstimated: false });
        expect(vi.mocked(rpcCall).mock.calls.map(args => [args[1], args[2].cascadeId])).toEqual([
            ['GetCascadeTrajectorySteps', 'parent'], ['GetCascadeTrajectory', 'child'],
        ]);
        const refreshed = await refreshWorkflowImageUsage(ls, result);
        expect(refreshed.imageGenStepCount).toBe(1);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
    });

    it('refreshes a running child even when its idle parent input has not changed', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce(child([], 'CASCADE_RUN_STATUS_RUNNING'));
        const first = await refreshWorkflowImageUsage(ls, usage());
        expect(first.imageGenStepCount).toBe(0);
        expect(hasSameUsageInputs(first, first)).toBe(true);
        vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
        const second = await refreshWorkflowImageUsage(ls, first);
        expect(second.imageGenStepCount).toBe(1);
        expect(second.contextUsed).toBe(13752);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
    });

    it('deduplicates shared children and terminates cycles without reading unrelated conversations', async () => {
        vi.mocked(rpcCall).mockImplementation(async (_ls, _method, params) => {
            const id = params.cascadeId;
            if (id === 'a') { return child([invoke('c', 'parent')]); }
            if (id === 'b') { return child([invoke('c')]); }
            if (id === 'c') { return child([image(), invoke('a')]); }
            throw new Error('unexpected conversation');
        });
        const result = await refreshWorkflowImageUsage(ls, usage(['a', 'b', 'a']));
        expect(result.imageGenStepCount).toBe(1);
        expect(result.imageGenerationIncomplete).toBe(false);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(3);
    });

    it('bounds wide and deep workflows and marks the incomplete count', async () => {
        vi.mocked(rpcCall).mockResolvedValue(child([image()]));
        const wide = await refreshWorkflowImageUsage(ls, usage(Array.from({ length: 20 }, (_, i) => `child-${i}`)));
        expect(wide.imageGenStepCount).toBe(16);
        expect(wide.imageGenerationIncomplete).toBe(true);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(16);
        resetImageWorkflowCache();
        vi.mocked(rpcCall).mockClear();
        vi.mocked(rpcCall).mockImplementation(async (_ls, _method, params) =>
            child([image(), invoke(String(Number(params.cascadeId) + 1))]));
        const deep = await refreshWorkflowImageUsage(ls, usage(['1']));
        expect(deep.imageGenStepCount).toBe(4);
        expect(deep.imageGenerationIncomplete).toBe(true);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(4);
    });

    it('preserves observed images on a failed refresh and clears observations on account/backend invalidation', async () => {
        vi.useFakeTimers();
        vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
        const first = await refreshWorkflowImageUsage(ls, usage());
        vi.advanceTimersByTime(31_000);
        vi.mocked(rpcCall).mockRejectedValueOnce(new Error('child unavailable'));
        const failed = await refreshWorkflowImageUsage(ls, first);
        expect(failed.imageGenStepCount).toBe(1);
        expect(failed.imageGenerationIncomplete).toBe(true);
        invalidateLiveModelMetadata();
        vi.mocked(rpcCall).mockRejectedValueOnce(new Error('new account child unavailable'));
        const other = await refreshWorkflowImageUsage(ls, failed);
        expect(other.imageGenStepCount).toBe(0);
        expect(other.imageGenerationIncomplete).toBe(true);
    });

    it('does not reuse child data across a backend connection identity', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce(child([image()]));
        await refreshWorkflowImageUsage(ls, usage());
        vi.mocked(rpcCall).mockResolvedValueOnce(child([]));
        const changed = await refreshWorkflowImageUsage({ ...ls, csrfToken: 'new-fixture' }, usage());
        expect(changed.imageGenStepCount).toBe(0);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
    });

    it('does not publish an in-flight child result after the account changes', async () => {
        let finish!: (value: Record<string, unknown>) => void;
        vi.mocked(rpcCall).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = refreshWorkflowImageUsage(ls, usage());
        resetImageWorkflowCache();
        finish(child([image(), invoke('stale-grandchild')]));
        const stale = await pending;
        expect(stale.imageGenStepCount).toBe(0);
        expect(stale.imageGenerationIncomplete).toBe(true);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(1);
        vi.mocked(rpcCall).mockResolvedValueOnce(child([]));
        expect((await refreshWorkflowImageUsage(ls, usage())).imageGenStepCount).toBe(0);
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(2);
    });

    it('reports truncated child data and respects cancellation without fetching another conversation', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce({ ...child([image()]), numTotalSteps: 20 });
        expect((await refreshWorkflowImageUsage(ls, usage())).imageGenerationIncomplete).toBe(true);
        const controller = new AbortController();
        controller.abort();
        await expect(refreshWorkflowImageUsage(ls, usage(), controller.signal)).rejects.toThrow('aborted');
        expect(vi.mocked(rpcCall)).toHaveBeenCalledTimes(1);
    });

    it('persists model and completeness changes even when the image count is unchanged', () => {
        const storage = { get: vi.fn().mockReturnValue(null), update: vi.fn().mockResolvedValue(undefined) };
        const store = new MonitorStore();
        store.init(storage);
        const initial = { ...usage(), imageGenStepCount: 1 };
        store.record([initial]);
        store.record([{ ...initial, imageGenerationModels: ['MODEL_PLACEHOLDER_M21'], imageGenerationIncomplete: true }]);
        expect(storage.update).toHaveBeenCalledTimes(2);
        expect(store.getSnapshot('parent')?.imageGenerationModels).toEqual(['MODEL_PLACEHOLDER_M21']);
        expect(store.getSnapshot('parent')?.imageGenerationIncomplete).toBe(true);
    });

    it.each(['en', 'zh', 'both'] as Language[])('shows the image count, true image model and partial-data warning in %s', async language => {
        await setLanguageToState(language, state);
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        manager.update({ ...usage(), imageGenStepCount: 1, imageGenerationModels: ['MODEL_PLACEHOLDER_M21'], imageGenerationIncomplete: true });
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        const tooltip = (item.tooltip as vscode.MarkdownString).value;
        expect(tooltip).toContain('Gemini 3.1 Flash Image');
        expect(tooltip).toContain(language === 'zh' ? '图片模型' : 'Image model');
        expect(tooltip).toContain(language === 'zh' ? '图片工作流数据不完整' : 'Image workflow data is incomplete');
        expect(tooltip).not.toContain('M322');
        manager.dispose();
    });
});

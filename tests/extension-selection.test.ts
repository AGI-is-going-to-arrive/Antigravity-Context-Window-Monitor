import { describe, expect, it } from 'vitest';
import {
    buildUsageScopeTrajectories,
    groupModelConfigsByQuotaPool,
    selectRunningTrajectoryCandidate,
} from '../src/extension';
import { CascadeStatus } from '../src/constants';
import type { TrajectorySummary } from '../src/tracker';
import type { ModelConfig } from '../src/models';

function trajectory(
    cascadeId: string,
    status: string,
    workspaceUris: string[] = [],
    stepCount = 1,
): TrajectorySummary {
    return {
        cascadeId,
        trajectoryId: `trajectory-${cascadeId}`,
        summary: cascadeId,
        stepCount,
        status,
        lastModifiedTime: `2026-05-07T00:00:0${stepCount}.000Z`,
        createdTime: '2026-05-07T00:00:00.000Z',
        requestedModel: 'MODEL_PLACEHOLDER_M37',
        generatorModel: 'MODEL_PLACEHOLDER_M37',
        workspaceUris,
        lastUserInputTime: '2026-05-07T00:00:00.000Z',
        lastUserInputStepIndex: 0,
        repositoryName: '',
        gitOriginUrl: '',
        branchName: '',
        gitRootUri: '',
    };
}

function modelConfig(model: string, label: string, resetTime: string, remainingFraction: number): ModelConfig {
    return {
        model,
        label,
        supportsImages: false,
        quotaInfo: { resetTime, remainingFraction },
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
    };
}

describe('selectRunningTrajectoryCandidate', () => {
    it('keeps the tracked cascade when it is still running in the current workspace', () => {
        const first = trajectory('first', CascadeStatus.RUNNING, ['file:///repo']);
        const tracked = trajectory('tracked', CascadeStatus.RUNNING, ['file:///repo']);

        const result = selectRunningTrajectoryCandidate(
            [first, tracked],
            [first, tracked],
            'tracked',
        );

        expect(result.candidateId).toBe('tracked');
        expect(result.selectionReason).toBe('tracked cascade is RUNNING');
        expect(result.selectedOutsideWorkspace).toBe(false);
    });

    it('keeps current-workspace RUNNING ahead of cross-workspace RUNNING', () => {
        const crossWorkspace = trajectory('cross', CascadeStatus.RUNNING, ['file:///other']);
        const currentWorkspace = trajectory('current', CascadeStatus.RUNNING, ['file:///repo']);

        const result = selectRunningTrajectoryCandidate(
            [crossWorkspace, currentWorkspace],
            [currentWorkspace],
            null,
        );

        expect(result.candidateId).toBe('current');
        expect(result.selectionReason).toBe('new RUNNING cascade in ws');
        expect(result.selectedOutsideWorkspace).toBe(false);
    });

    it('falls back to a RUNNING cascade from another workspace when none are running locally', () => {
        const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
        const crossWorkspace = trajectory('cross-running', CascadeStatus.RUNNING, ['file:///other']);

        const result = selectRunningTrajectoryCandidate(
            [localIdle, crossWorkspace],
            [localIdle],
            'local-idle',
        );

        expect(result.candidateId).toBe('cross-running');
        expect(result.selectionReason).toBe('RUNNING cascade from another workspace (cross-workspace tracking)');
        expect(result.selectedOutsideWorkspace).toBe(true);
    });

    it('preserves the existing fallback for RUNNING cascades without workspace URIs', () => {
        const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
        const noWorkspace = trajectory('no-workspace', CascadeStatus.RUNNING);

        const result = selectRunningTrajectoryCandidate(
            [localIdle, noWorkspace],
            [localIdle],
            null,
        );

        expect(result.candidateId).toBe('no-workspace');
        expect(result.selectionReason).toBe('RUNNING cascade without workspace (new conversation)');
        expect(result.selectedOutsideWorkspace).toBe(true);
    });

    it('returns no candidate when no trajectory is running', () => {
        const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
        const otherIdle = trajectory('other-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///other']);

        const result = selectRunningTrajectoryCandidate(
            [localIdle, otherIdle],
            [localIdle],
            null,
        );

        expect(result.candidateId).toBeNull();
        expect(result.selectionReason).toBe('');
        expect(result.selectedOutsideWorkspace).toBe(false);
    });
});

describe('buildUsageScopeTrajectories', () => {
    it('includes an active cross-workspace trajectory before qualified local history', () => {
        const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
        const crossWorkspace = trajectory('cross-running', CascadeStatus.RUNNING, ['file:///other']);

        const scope = buildUsageScopeTrajectories(
            [localIdle],
            [localIdle, crossWorkspace],
            crossWorkspace,
        );

        expect(scope.map(t => t.cascadeId)).toEqual(['cross-running', 'local-idle']);
    });

    it('does not duplicate the active trajectory when it is already in scope', () => {
        const currentWorkspace = trajectory('current', CascadeStatus.RUNNING, ['file:///repo']);

        const scope = buildUsageScopeTrajectories(
            [currentWorkspace],
            [currentWorkspace],
            currentWorkspace,
        );

        expect(scope.map(t => t.cascadeId)).toEqual(['current']);
    });
});

describe('groupModelConfigsByQuotaPool', () => {
    it('keeps known quota pools separate even when resetTime strings match', () => {
        const groups = groupModelConfigsByQuotaPool([
            modelConfig('MODEL_PLACEHOLDER_M133', 'Gemini 3 Flash', '2026-05-21T00:00:00Z', 0.8),
            modelConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)', '2026-05-21T00:00:00Z', 0.4),
        ]);

        expect(groups.map(g => g.key).sort()).toEqual(['gemini', 'premium']);
        expect(groups.find(g => g.key === 'gemini')?.labels).toEqual(['Gemini 3 Flash']);
        expect(groups.find(g => g.key === 'premium')?.labels).toEqual(['GPT-OSS 120B (Medium)']);
    });

    it('still groups unknown future models by resetTime fallback', () => {
        const groups = groupModelConfigsByQuotaPool([
            modelConfig('MODEL_FUTURE_A', 'Future A', '2026-05-21T00:00:00Z', 0.7),
            modelConfig('MODEL_FUTURE_B', 'Future B', '2026-05-21T00:00:00Z', 0.5),
        ]);

        expect(groups).toHaveLength(1);
        expect(groups[0].modelIds).toEqual(['MODEL_FUTURE_A', 'MODEL_FUTURE_B']);
        expect(groups[0].minFraction).toBe(0.5);
    });

    it('groups Gemini 3.6 Flash into the shared gemini pool via KNOWN_QUOTA_POOLS, not resetTime', () => {
        // M71 and M133 carry different resetTimes, yet both must land in the fixed 'gemini' pool.
        // Before the fix, the 3.6 tier fell back to its resetTime key and split into its own pool.
        const groups = groupModelConfigsByQuotaPool([
            modelConfig('MODEL_PLACEHOLDER_M71', 'Gemini 3.6 Flash (High)', '2026-07-21T21:41:45Z', 0.9),
            modelConfig('MODEL_PLACEHOLDER_M133', 'Gemini 3.5 Flash (High)', '2026-07-22T09:00:00Z', 0.7),
            modelConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)', '2026-07-21T21:41:45Z', 0.3),
        ]);

        expect(groups.map(g => g.key).sort()).toEqual(['gemini', 'premium']);
        const gemini = groups.find(g => g.key === 'gemini');
        expect(gemini?.modelIds.slice().sort()).toEqual(['MODEL_PLACEHOLDER_M133', 'MODEL_PLACEHOLDER_M71']);
        expect(gemini?.minFraction).toBe(0.7);
        expect(groups.find(g => g.key === 'premium')?.modelIds).toEqual(['MODEL_OPENAI_GPT_OSS_120B_MEDIUM']);
    });

    it('groups the whole live 3.7 / 3.6 / 3.5 Flash lineup into a single gemini pool', () => {
        // The picker now carries three generations of Flash at once. Each tier reports its own
        // resetTime, so without KNOWN_QUOTA_POOLS the status bar would show up to nine separate
        // "pools" for what is really one shared Gemini quota.
        const groups = groupModelConfigsByQuotaPool([
            modelConfig('MODEL_PLACEHOLDER_M298', 'Gemini 3.7 Flash (High)', '2026-08-13T23:31:25Z', 1.0),
            modelConfig('MODEL_PLACEHOLDER_M299', 'Gemini 3.7 Flash (Medium)', '2026-08-13T23:31:25Z', 1.0),
            modelConfig('MODEL_PLACEHOLDER_M300', 'Gemini 3.7 Flash (Low)', '2026-08-13T23:27:33Z', 1.0),
            modelConfig('MODEL_PLACEHOLDER_M71', 'Gemini 3.6 Flash (High)', '2026-08-13T23:31:25Z', 0.8),
            modelConfig('MODEL_PLACEHOLDER_M72', 'Gemini 3.6 Flash (Medium)', '2026-08-13T22:00:00Z', 0.8),
            modelConfig('MODEL_PLACEHOLDER_M73', 'Gemini 3.6 Flash (Low)', '2026-08-13T22:00:00Z', 0.8),
            modelConfig('MODEL_PLACEHOLDER_M84', 'Gemini 3.5 Flash (High)', '2026-08-13T21:00:00Z', 0.6),
            modelConfig('MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)', '2026-08-13T21:00:00Z', 0.4),
        ]);

        expect(groups.map(g => g.key).sort()).toEqual(['gemini', 'premium']);
        const gemini = groups.find(g => g.key === 'gemini');
        expect(gemini?.modelIds).toHaveLength(7);
        expect(gemini?.minFraction).toBe(0.6);
    });
});

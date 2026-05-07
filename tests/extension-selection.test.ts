import { describe, expect, it } from 'vitest';
import {
    buildUsageScopeTrajectories,
    selectRunningTrajectoryCandidate,
} from '../src/extension';
import { CascadeStatus } from '../src/constants';
import type { TrajectorySummary } from '../src/tracker';

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

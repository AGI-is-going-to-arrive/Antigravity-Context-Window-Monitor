import { describe, expect, it } from 'vitest';
import type { ContextUsage } from '../src/tracker';
import { MonitorStore } from '../src/monitor-store';

function makeUsage(cascadeId: string, lastModifiedTime: string): ContextUsage {
    return {
        cascadeId,
        title: cascadeId,
        model: 'model-a',
        modelDisplayName: 'Model A',
        contextUsed: 1000,
        totalOutputTokens: 100,
        totalToolCallOutputTokens: 50,
        contextLimit: 1000000,
        usagePercent: 0.1,
        stepCount: 10,
        lastModifiedTime,
        status: 'CASCADE_RUN_STATUS_IDLE',
        isEstimated: false,
        lastModelUsage: {
            model: 'model-a',
            inputTokens: 1000,
            outputTokens: 100,
            responseOutputTokens: 100,
            cacheReadTokens: 0,
        },
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        createdTime: lastModifiedTime,
        lastUserInputTime: lastModifiedTime,
        lastUserInputStepIndex: 9,
        repositoryName: 'repo',
        gitOriginUrl: 'https://example.com/repo.git',
        branchName: 'main',
        gitRootUri: 'file:///repo',
    };
}

describe('MonitorStore', () => {
    it('persists snapshots independently from archive flow', () => {
        let persisted: unknown = null;
        const workspaceState = {
            get<T>(_key: string, defaultValue: T): T {
                return (persisted as T) ?? defaultValue;
            },
            update(_key: string, value: unknown): Promise<void> {
                persisted = value;
                return Promise.resolve();
            },
        };

        const store = new MonitorStore();
        store.init(workspaceState);
        const older = makeUsage('cascade-1', '2026-03-23T08:00:00.000Z');
        const newer = makeUsage('cascade-2', '2026-03-23T09:00:00.000Z');
        store.record([older, newer], newer.cascadeId);

        const restored = new MonitorStore();
        restored.init(workspaceState);
        const state = restored.restore();

        expect(state.currentUsage?.cascadeId).toBe('cascade-2');
        expect(state.allUsages.map(usage => usage.cascadeId)).toEqual(['cascade-2', 'cascade-1']);
    });
});

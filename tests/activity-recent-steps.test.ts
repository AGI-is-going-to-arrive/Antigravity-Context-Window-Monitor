import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcCallMock = vi.fn();

vi.mock('../src/rpc-client', () => ({
    rpcCall: (...args: unknown[]) => rpcCallMock(...args),
}));

import { ActivityTracker } from '../src/activity-tracker';

function makeUserStep(index: number): Record<string, unknown> {
    const minute = String(Math.floor(index / 60)).padStart(2, '0');
    const second = String(index % 60).padStart(2, '0');
    return {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        metadata: {
            createdAt: `2026-06-01T00:${minute}:${second}.000Z`,
        },
        userInput: {
            items: [{ text: `user input ${index}` }],
        },
    };
}

describe('ActivityTracker recent-step warm-up', () => {
    beforeEach(() => {
        rpcCallMock.mockReset();
    });

    it('keeps all warm-up events in runtime instead of truncating the timeline buffer', async () => {
        const tracker = new ActivityTracker();
        const steps = Array.from({ length: 120 }, (_, index) => makeUserStep(index));

        rpcCallMock.mockResolvedValue({ steps });

        const changed = await tracker.processTrajectories(
            {} as any,
            [{
                cascadeId: 'conv-warmup',
                stepCount: steps.length,
                status: 'CASCADE_RUN_STATUS_IDLE',
            }],
        );

        expect(changed).toBe(true);

        const summary = tracker.getSummary();
        expect(summary.recentSteps).toHaveLength(120);
        expect(summary.recentSteps[0]?.stepIndex).toBe(0);
        expect(summary.recentSteps[119]?.stepIndex).toBe(119);
    });

    it('still trims persisted recent steps to the configured safety limit', async () => {
        const tracker = new ActivityTracker();
        const steps = Array.from({ length: 120 }, (_, index) => makeUserStep(index));

        rpcCallMock.mockResolvedValue({ steps });

        await tracker.processTrajectories(
            {} as any,
            [{
                cascadeId: 'conv-persist',
                stepCount: steps.length,
                status: 'CASCADE_RUN_STATUS_IDLE',
            }],
        );

        const serialized = tracker.serialize();
        expect(serialized.summary.recentSteps).toHaveLength(100);
        expect(serialized.summary.recentSteps[0]?.stepIndex).toBe(20);
        expect(serialized.summary.recentSteps[99]?.stepIndex).toBe(119);
    });
});

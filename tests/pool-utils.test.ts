import { describe, expect, it } from 'vitest';
import type { ModelConfig } from '../src/models';
import type { QuotaSession } from '../src/quota-tracker';
import { expandModelIdsToPool, findLatestQuotaSessionForPool, groupModelIdsByResetPool } from '../src/pool-utils';

function makeConfig(model: string, label: string, resetTime: string): ModelConfig {
    return {
        model,
        label,
        quotaInfo: {
            remainingFraction: 1,
            resetTime,
        },
    } as ModelConfig;
}

describe('pool-utils', () => {
    const configs = [
        makeConfig('sonnet', 'Claude Sonnet', '2026-03-23T10:00:00.000Z'),
        makeConfig('opus', 'Claude Opus', '2026-03-23T10:00:00.000Z'),
        makeConfig('gptoss', 'GPT OSS', '2026-03-23T10:00:00.000Z'),
        makeConfig('gemini-pro-high', 'Gemini Pro High', '2026-03-23T12:00:00.000Z'),
        makeConfig('gemini-pro-low', 'Gemini Pro Low', '2026-03-23T12:00:00.000Z'),
        makeConfig('gemini-flash', 'Gemini Flash', '2026-03-23T15:00:00.000Z'),
    ];

    it('expands representative model ids to full pool members', () => {
        expect(expandModelIdsToPool(['sonnet'], configs)).toEqual(
            expect.arrayContaining(['sonnet', 'opus', 'gptoss']),
        );
        expect(expandModelIdsToPool(['gemini-flash'], configs)).toEqual(['gemini-flash']);
    });

    it('groups reset model ids into independent pools', () => {
        const groups = groupModelIdsByResetPool(['sonnet', 'gemini-pro-high', 'gemini-flash'], configs);
        expect(groups).toHaveLength(3);
        expect(groups).toContainEqual(expect.arrayContaining(['sonnet', 'opus', 'gptoss']));
        expect(groups).toContainEqual(expect.arrayContaining(['gemini-pro-high', 'gemini-pro-low']));
        expect(groups).toContainEqual(['gemini-flash']);
    });

    it('finds the latest matching quota session for a pool', () => {
        const history: QuotaSession[] = [
            {
                id: 'flash',
                modelId: 'gemini-flash',
                modelLabel: 'Gemini Flash',
                startTime: '2026-03-23T10:00:00.000Z',
                endTime: '2026-03-23T15:00:00.000Z',
                totalDurationMs: 18_000_000,
                snapshots: [],
                completed: false,
            },
            {
                id: 'claude',
                modelId: 'sonnet',
                modelLabel: 'Claude Sonnet',
                poolModels: ['Claude Opus', 'Claude Sonnet', 'GPT OSS'],
                startTime: '2026-03-23T05:00:00.000Z',
                endTime: '2026-03-23T10:00:00.000Z',
                totalDurationMs: 18_000_000,
                snapshots: [],
                completed: false,
            },
        ];

        const session = findLatestQuotaSessionForPool(['opus', 'gptoss'], configs, history);
        expect(session?.id).toBe('claude');
        expect(session?.startTime).toBe('2026-03-23T05:00:00.000Z');
        expect(session?.endTime).toBe('2026-03-23T10:00:00.000Z');
    });
});

import { describe, expect, it } from 'vitest';
import { aggregateSwarmGroupCost, priceSwarmGroup, type SwarmGroupSummary } from '../src/core/swarm-registry';
import { parseGMEntry } from '../src/gm/parser';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';

const group: SwarmGroupSummary = {
    rootId: 'root', memberIds: ['root', 'worker', 'free', 'unpriced', 'silent'], title: 'Review',
    coordinatorIds: ['root'], activeMemberIds: ['root', 'worker'], killedMemberIds: [],
    nestedSubSwarmCoordinatorIds: [], hasConflict: false, coordinatorDeleted: false, isStaleManifest: false,
};
const call = (executionId: string, steps: number[]) => parseGMEntry({ executionId, stepIndices: steps,
    chatModel: { model: 'MODEL_PLACEHOLDER_M535', usage: { inputTokens: 27000, outputTokens: 2100 } },
});

describe('member costs follow recorded calls', () => {
    it('counts different planner calls in one execution and deduplicates mirrored permutations of the same steps', () => {
        const summary = priceSwarmGroup(group, [
            { cascadeId: 'root', calls: [call('same', [1, 2]), call('same', [4])] },
            { cascadeId: 'worker', calls: [call('same', [2, 1]), call('other', [3])] },
        ], () => 1)!;
        expect(summary.uniqueCallCount).toBe(3);
        expect(summary.inclusiveGroupCostUsd).toBe(3);
        expect(summary.duplicateCallsDeduplicated).toBe(1);
        expect(summary.directCostByMember.worker.directCostUsd).toBe(2);
        expect(summary.directCostByMember.silent.callCount).toBe(0);
    });

    it('uses reported start steps including zero when indices are missing, and falls back to the call timestamp when the provider omits both', () => {
        const sparse = (startStepIndex: string | undefined, createdAt = '') => parseGMEntry({
            executionId: 'execution', chatModel: { chatStartMetadata: { startStepIndex, createdAt } },
        });
        const summary = priceSwarmGroup(group, [
            { cascadeId: 'root', calls: [sparse('0'), sparse('8'), sparse(undefined, '2026-11-01T10:00:00Z'), sparse(undefined, '2026-11-01T10:01:00Z')] },
            { cascadeId: 'worker', calls: [call('execution', [0]), call('execution', [8])] },
        ], () => 1)!;
        expect(summary.uniqueCallCount).toBe(4);
        expect(summary.duplicateCallsDeduplicated).toBe(2);
    });

    it('uses a priced duplicate even when its unpriced observation arrived first', () => {
        const summary = aggregateSwarmGroupCost({ rootId: 'root', calls: [
            { cascadeId: 'root', logicalCallId: 'shared', costUsd: null },
            { cascadeId: 'root', logicalCallId: 'shared', costUsd: 1 },
            { cascadeId: 'worker', logicalCallId: 'shared', costUsd: 1 },
        ] });
        expect(summary).toMatchObject({ inclusiveGroupCostUsd: 1, uniqueCallCount: 1, unpricedCallCount: 0, pricedCallCount: 1 });
        expect(summary.directCostByMember.root).toMatchObject({ directCostUsd: 1, callCount: 1, unpricedCallCount: 0 });
    });

    it('excludes the session snapshot from historical, empty and discontinuous date selections', () => {
        const now = new Date(2026, 10, 28, 12);
        const summary = aggregateSwarmGroupCost({ rootId: 'root', memberIds: group.memberIds, calls: [] });
        for (const selectedDates of [[], ['2026-11-25'], ['2026-11-27', '2026-11-29']]) {
            const html = buildCalendarTabContent(undefined, 2026, 11, { now, periodMode: 'all', selectedDates, swarmGroupCosts: { root: summary } });
            expect(html).not.toContain('data-swarm-source="session"');
        }
        const today = buildCalendarTabContent(undefined, 2026, 11, { now, selectedDates: ['2026-11-28'], swarmGroupCosts: { root: summary } });
        expect(today).toContain('data-swarm-source="session"');
        expect(today).toContain('0/5');
        expect(today).not.toContain('data-swarm-group-total="0"');
    });

    it.each(['en', 'zh', 'both'] as const)('distinguishes missing calls, missing prices and priced zero and hides identities in %s', language => {
        const summary = aggregateSwarmGroupCost({ rootId: group.rootId, memberIds: group.memberIds, calls: [
            { cascadeId: 'root', costUsd: 2, logicalCallId: 'root-call' },
            { cascadeId: 'free', costUsd: 0, logicalCallId: 'free-call' },
            { cascadeId: 'unpriced', costUsd: null, logicalCallId: 'unpriced-call' },
        ] });
        const html = buildCalendarTabContent(undefined, 2026, 11, { language, privacyMasked: true,
            now: new Date(2026, 10, 28, 12), periodMode: 'all', swarmGroupCosts: { root: summary } });
        const card = html.split('id="calSwarmGroupCost"')[1].split('</section>')[0];
        expect(card).toContain('data-swarm-source="session"');
        expect(card).toContain('3/5');
        expect(card).toContain('data-swarm-group-total="2"');
        expect(card.match(/data-swarm-direct-cost="0"/g)).toHaveLength(1);
        expect(card).toContain(language === 'en' ? 'No calls recorded' : '暂无调用记录');
        expect(card).not.toContain('data-swarm-member="silent"');
        expect(card).not.toContain('data-swarm-root="root"');
        expect(card).toMatch(/<details id="cal-swarm-members[^"]*"><summary>/);
    });
});

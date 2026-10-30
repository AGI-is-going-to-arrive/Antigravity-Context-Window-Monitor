import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    applyTrajectoryModelHints, isValidCallTimestamp, mergeGMCallEntries, parseGMEntry, shouldEnrichConversation,
} from '../src/gm/parser';
import { GMTracker, type GMCallEntry, type GMConversationData } from '../src/gm-tracker';
import { DailyLedger } from '../src/daily-ledger';
import { rpcCall } from '../src/rpc-client';
import { findPricingForDate } from '../src/pricing-store';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));
const ls = { pid: 1, port: 1, csrfToken: 'fixture-only', useTls: false };
const timestamp = '2026-11-30T10:00:00.000Z';

function rawCall(createdAt = '', executionId = '') {
    return { executionId, stepIndices: [1], chatModel: { model: 'MODEL_PLACEHOLDER_M419',
        responseModel: 'gemini-4-argon', usage: { inputTokens: 12905, outputTokens: 5 },
        chatStartMetadata: { createdAt } } };
}

function planner(stepIndex = 1, metadata: Record<string, unknown> = { startedAt: timestamp }) {
    return { stepIndex, type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata };
}

function conversation(call: GMCallEntry): GMConversationData {
    return { cascadeId: 'timestamp-fixture', title: 'Fixture', totalSteps: 2,
        calls: [call], coveredSteps: 1, coverageRate: 0.5, checkpointSummaries: [] };
}

function cacheOf(tracker: GMTracker): Map<string, GMConversationData> {
    return (tracker as unknown as { _cache: Map<string, GMConversationData> })._cache;
}

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('trajectory-derived GM timestamps', () => {
    it.each(['', 'invalid', '1', '2026-11-31T10:00:00Z', '2026-11-30T10:00:00',
        '2026-02-29T00:00:00Z', '2026-11-30'])(
        'recovers %s timestamps despite authoritative model identity and absent model hints', missing => {
        const call = parseGMEntry(rawCall(missing));
        const [enriched] = applyTrajectoryModelHints([call], [planner()]);
        expect(enriched.createdAt).toBe(timestamp);
        expect(enriched.model).toBe('MODEL_PLACEHOLDER_M419');
        expect(enriched.modelSource).toBe('chatModel');
        expect(call.createdAt).toBe(missing);
        expect(shouldEnrichConversation(2, [call])).toBe(true);
        expect(findPricingForDate(enriched.model, {}, enriched.createdAt)?.input).toBe(2);
    });

    it('keeps a valid original GM timestamp and accepts a valid planner creation time', () => {
        const call = parseGMEntry(rawCall('2026-10-31T01:00:00.000Z'));
        expect(applyTrajectoryModelHints([call], [planner()])[0]).toBe(call);
        const [fallback] = applyTrajectoryModelHints([parseGMEntry(rawCall())], [
            planner(1, { startedAt: 'invalid', createdAt: timestamp }),
        ]);
        expect(fallback.createdAt).toBe(timestamp);
    });

    it.each(['2028-02-29T10:00:00Z', '2026-11-30T10:00:00.123456789Z',
        '2026-11-30T23:30:00-01:00', '2026-12-01T10:30:00+11:00'])(
        'keeps valid zoned call timestamp %s unchanged', valid => {
            const call = parseGMEntry(rawCall(valid));
            expect(isValidCallTimestamp(valid)).toBe(true);
            expect(applyTrajectoryModelHints([call], [planner()])[0]).toBe(call);
            expect(findPricingForDate(call.model, {}, valid)).not.toBeNull();
        },
    );

    it('uses request creation time when the hub startedAt is a later completion-time timestamp', () => {
        const [call] = applyTrajectoryModelHints([parseGMEntry(rawCall())], [planner(1, {
            createdAt: '2026-11-30T23:59:59Z', startedAt: '2026-12-01T00:00:01Z',
        })]);
        expect(call.createdAt).toBe('2026-11-30T23:59:59Z');
        expect(findPricingForDate(call.model, {}, call.createdAt)?.input).toBe(2);
    });

    it('matches an execution ID even when step indices are unavailable, and rejects conflicting IDs', () => {
        const call = parseGMEntry({ ...rawCall('', 'exec-date'), stepIndices: [] });
        expect(applyTrajectoryModelHints([call], [planner(20, { executionId: 'exec-date', startedAt: timestamp })])[0].createdAt).toBe(timestamp);
        const conflicted = parseGMEntry(rawCall('', 'other-exec'));
        expect(applyTrajectoryModelHints([conflicted], [planner(1, { executionId: 'exec-date', startedAt: timestamp })])[0].createdAt).toBe('');
    });

    it('does not borrow a nearby, user-input, ambiguous or arbitrary first-step timestamp', () => {
        const call = parseGMEntry(rawCall());
        expect(applyTrajectoryModelHints([call], [planner(0)])[0].createdAt).toBe('');
        expect(applyTrajectoryModelHints([call], [{ ...planner(), type: 'CORTEX_STEP_TYPE_USER_INPUT' }])[0].createdAt).toBe('');
        const noStepIdentity = { ...call, stepIndices: [], startStepIndex: 0 };
        expect(applyTrajectoryModelHints([noStepIdentity], [planner(0)])[0].createdAt).toBe('');
        const ambiguous = { ...call, stepIndices: [1, 2] };
        expect(applyTrajectoryModelHints([ambiguous], [planner(), planner(2, { startedAt: '2026-12-01T10:00:00.000Z' })])[0].createdAt).toBe('');
        expect(isValidCallTimestamp('1')).toBe(false);
    });

    it('requests timestamp enrichment even when model and user anchors are complete', () => {
        const call = parseGMEntry(rawCall());
        call.userMessageAnchors = [{ stepIndex: 0, text: 'fixture' }];
        expect(shouldEnrichConversation(2, [call])).toBe(true);
        expect(shouldEnrichConversation(2, [{ ...call, createdAt: timestamp }])).toBe(false);
        expect(mergeGMCallEntries({ ...call, createdAt: 'invalid' }, { ...call, createdAt: timestamp }).createdAt).toBe(timestamp);
    });

    it('retries an unchanged idle cache with a missing date and uses the historical call date for pricing', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-02T10:00:00.000Z'));
        const tracker = new GMTracker();
        cacheOf(tracker).set('timestamp-fixture', conversation(parseGMEntry(rawCall())));
        vi.mocked(rpcCall).mockResolvedValueOnce({ generatorMetadata: [rawCall()] });
        vi.mocked(rpcCall).mockResolvedValueOnce({ trajectory: { steps: [planner()] } });
        await tracker.fetchAll(ls, [{ cascadeId: 'timestamp-fixture', stepCount: 2, status: 'CASCADE_RUN_STATUS_IDLE' }]);
        const call = tracker.getAllConversationData()[0].calls[0];
        expect(call.createdAt).toBe(timestamp);
        expect(findPricingForDate(call.model, {}, call.createdAt)?.input).toBe(2);
        expect(findPricingForDate(call.model, {}, '2026-12-02')?.input).toBe(4);
        expect(tracker.getNewCallsSinceLastRecord().entries).toHaveLength(0); // historical call, not today's usage
        expect(vi.mocked(rpcCall).mock.calls.map(args => args[1])).toEqual([
            'GetCascadeTrajectoryGeneratorMetadata', 'GetCascadeTrajectory',
        ]);
    });

    it.each(['', 'invalid'])('does not duplicate an already recorded call when its %s date is filled after restore and revert', missing => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
        const tracker = new GMTracker();
        const original = parseGMEntry(rawCall(missing));
        cacheOf(tracker).set('timestamp-fixture', conversation(original));
        const ledger = new DailyLedger();
        const initial = tracker.getNewCallsSinceLastRecord().entries;
        expect(ledger.recordCalls(initial)).toBe(1);
        tracker.markLedgerEntriesRecorded(initial);
        const restored = GMTracker.restore(tracker.serialize());
        const restoredLedger = DailyLedger.restore(ledger.serialize());
        expect(restored.getNewCallsSinceLastRecord().revertedCascadeIds).toEqual(['timestamp-fixture']);
        const [enriched] = applyTrajectoryModelHints([original], [planner(1, { startedAt: '2026-10-31T09:00:00.000Z' })]);
        cacheOf(restored).set('timestamp-fixture', conversation(enriched));
        const returned = restored.getNewCallsSinceLastRecord().entries;
        expect(returned).toHaveLength(0);
        expect(restoredLedger.recordCalls(returned)).toBe(0);
        expect(restoredLedger.getTodayActive()[0].totalCalls).toBe(1);
    });

    it('still distinguishes a regenerated call with a different valid timestamp after revert', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
        const tracker = new GMTracker();
        const original = parseGMEntry(rawCall('2026-10-31T08:00:00.000Z'));
        cacheOf(tracker).set('timestamp-fixture', conversation(original));
        tracker.markLedgerEntriesRecorded(tracker.getNewCallsSinceLastRecord().entries);
        const restored = GMTracker.restore(tracker.serialize());
        restored.getNewCallsSinceLastRecord();
        cacheOf(restored).set('timestamp-fixture', conversation({ ...original, createdAt: '2026-10-31T09:00:00.000Z' }));
        expect(restored.getNewCallsSinceLastRecord().entries).toHaveLength(1);
    });
});

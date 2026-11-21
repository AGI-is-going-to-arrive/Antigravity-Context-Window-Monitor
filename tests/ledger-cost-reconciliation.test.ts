import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyLedger, type DailyLedgerState, type LedgerCallEntry } from '../src/daily-ledger';
import { parseGMEntry } from '../src/gm/parser';
import { calculateLedgerModelCosts } from '../src/pricing-store';

const account = 'pricing@example.test';
const localIso = (hour: number) => new Date(2026, 9, 31, hour).toISOString();

function entry(id: string, model: string, inputTokens: number, outputTokens: number, index: number): LedgerCallEntry {
    return { dedupKey: `fixture:${index}|${encodeURIComponent(`exec:${id}`)}`,
        call: { ...parseGMEntry({ executionId: id, stepIndices: [index], chatModel: {
            model, responseModel: 'gemini-4-argon', usage: { inputTokens, outputTokens },
            chatStartMetadata: { createdAt: localIso(9) },
        } }), accountEmail: account } };
}

/** A version that had no Argon price saved the first three calls at zero. */
function legacyMixedState(): { state: DailyLedgerState; entries: LedgerCallEntry[] } {
    const entries = [
        entry('old-low', 'MODEL_PLACEHOLDER_M419', 12905, 5, 0),
        entry('old-medium', 'MODEL_PLACEHOLDER_M418', 12903, 31, 1),
        entry('old-high', 'MODEL_PLACEHOLDER_M417', 12905, 32, 2),
        entry('new-low', 'MODEL_PLACEHOLDER_M419', 12952, 87, 3),
    ];
    const ledger = new DailyLedger();
    expect(ledger.recordCalls(entries)).toBe(4);
    const state = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
    const bucket = state.accounts[account];
    for (const record of bucket.recordedCalls.slice(0, 3)) {
        bucket.totalEstimatedCost -= record.estimatedCost;
        bucket.modelStats[record.modelKey].estimatedCost -= record.estimatedCost;
        record.estimatedCost = 0;
        record.createdAt = '';
        record.createdAtMs = Date.parse(localIso(10)); // ingestion time is not usage evidence
    }
    return { state, entries };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 31, 10)); });
afterEach(() => vi.useRealTimers());

describe('existing ledger call metadata and missing official cost reconciliation', () => {
    it('fills the exact old 3-call cost gap in a mixed positive/zero bucket without adding calls or tokens', () => {
        const { state, entries } = legacyMixedState();
        const ledger = DailyLedger.restore(state);
        const before = ledger.serialize().accounts[account];
        const previousTotal = before.totalEstimatedCost;
        const beforeTokens = [before.totalCalls, before.totalInputTokens, before.totalOutputTokens, before.totalCacheRead];
        const oldIds = [...before.recordedCallIds];
        const positiveCost = before.recordedCalls[3].estimatedCost;
        expect(ledger.reconcileRecordedCalls(entries)).toBe(3);
        const after = ledger.serialize().accounts[account];
        expect(after.totalEstimatedCost - previousTotal).toBeCloseTo(0.078106, 10);
        expect([after.totalCalls, after.totalInputTokens, after.totalOutputTokens, after.totalCacheRead]).toEqual(beforeTokens);
        expect(after.recordedCallIds).toEqual(oldIds);
        expect(after.recordedCalls[3].estimatedCost).toBe(positiveCost);
        expect(after.recordedCalls.slice(0, 3).every(call => call.createdAt === localIso(9))).toBe(true);
        const displayed = Object.entries(after.modelStats).reduce((sum, [key, stats]) =>
            sum + calculateLedgerModelCosts(key, stats, after, {}).totalCost, 0);
        expect(displayed).toBeCloseTo(after.totalEstimatedCost, 10);
        expect(ledger.reconcileRecordedCalls(entries)).toBe(0);
        expect(ledger.recordCalls(entries)).toBe(0);
        expect(ledger.serialize().accounts[account].totalCalls).toBe(4);
    });

    it('is idempotent after serialization and preserves already-positive historical cost', () => {
        const { state, entries } = legacyMixedState();
        const ledger = DailyLedger.restore(state);
        ledger.reconcileRecordedCalls(entries);
        const saved = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
        const restored = DailyLedger.restore(saved);
        expect(restored.reconcileRecordedCalls(entries)).toBe(0);
        expect(restored.serialize()).toEqual(saved);
    });

    it.each(['account', 'model', 'tokens', 'invalid-date', 'other-day'])(
        'rejects mismatched or unproven %s metadata', kind => {
            const { state, entries } = legacyMixedState();
            const ledger = DailyLedger.restore(state);
            const candidate = { ...entries[0], call: { ...entries[0].call } };
            if (kind === 'account') { candidate.call.accountEmail = 'other@example.test'; }
            if (kind === 'model') { candidate.call.model = 'MODEL_PLACEHOLDER_M418'; }
            if (kind === 'tokens') { candidate.call.inputTokens++; }
            if (kind === 'invalid-date') { candidate.call.createdAt = 'invalid'; }
            if (kind === 'other-day') { candidate.call.createdAt = new Date(2026, 9, 30, 9).toISOString(); }
            const before = JSON.stringify(ledger.serialize());
            expect(ledger.reconcileRecordedCalls([candidate])).toBe(0);
            expect(JSON.stringify(ledger.serialize())).toBe(before);
        },
    );

    it('does not add a cost already present in an unexplained historical aggregate', () => {
        const { state, entries } = legacyMixedState();
        const bucket = state.accounts[account];
        const key = bucket.recordedCalls[0].modelKey;
        bucket.modelStats[key].estimatedCost += 1;
        bucket.totalEstimatedCost += 1;
        const ledger = DailyLedger.restore(state);
        const before = bucket.totalEstimatedCost;
        expect(ledger.reconcileRecordedCalls([entries[0]])).toBe(1); // timestamp only
        const after = ledger.serialize().accounts[account];
        expect(after.totalEstimatedCost).toBe(before);
        expect(after.recordedCalls[0].estimatedCost).toBe(0);
        expect(ledger.reconcileRecordedCalls([entries[0]])).toBe(0);
    });

    it('matches a stable execution identity after the tracker changes its array position', () => {
        const { state, entries } = legacyMixedState();
        const ledger = DailyLedger.restore(state);
        const moved = { ...entries[0], dedupKey: `fixture:9|${encodeURIComponent('exec:old-low')}` };
        expect(ledger.reconcileRecordedCalls([moved])).toBe(1);
        expect(ledger.serialize().accounts[account].totalCalls).toBe(4);
        expect(ledger.serialize().accounts[account].recordedCalls[0].estimatedCost).toBeCloseTo(0.02586, 10);
    });

    it('can enrich a timestamp-only archive identity change without touching another conversation', () => {
        const { state, entries } = legacyMixedState();
        const identity = (date: string) => `archive|steps:0|model:gemini-4-argon|created:${date}|in:12905|out:5|think:0|cache:0|start:0`;
        const oldKey = `fixture:0|${encodeURIComponent(identity(''))}`;
        state.accounts[account].recordedCalls[0].callId = oldKey;
        state.accounts[account].recordedCallIds[0] = oldKey;
        const ledger = DailyLedger.restore(state);
        const candidate = { call: { ...entries[0].call, executionId: '' },
            dedupKey: `fixture:0|${encodeURIComponent(identity(localIso(9)))}` };
        expect(ledger.reconcileRecordedCalls([{ ...candidate, dedupKey: candidate.dedupKey.replace('fixture:', 'unrelated:') }])).toBe(0);
        expect(ledger.reconcileRecordedCalls([candidate])).toBe(1);
        expect(ledger.serialize().accounts[account].recordedCalls[0].estimatedCost).toBeCloseTo(0.02586, 10);
    });

    it('reconciles legacy zero-cost Gemini 4 Neon calls using the newly verified official rate without adding calls', () => {
        const neonCall: LedgerCallEntry = {
            dedupKey: `neon:0|${encodeURIComponent('exec:neon-1')}`,
            call: {
                ...parseGMEntry({
                    executionId: 'neon-1',
                    stepIndices: [1],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M535',
                        responseModel: 'gemini-4-neon',
                        usage: {
                            inputTokens: 1_000_000,
                            outputTokens: 200_000,
                            thinkingOutputTokens: 50_000,
                            cacheReadTokens: 1_000_000,
                        },
                        chatStartMetadata: { createdAt: localIso(9) },
                    },
                }),
                accountEmail: account,
            },
        };
        const ledger = new DailyLedger();
        expect(ledger.recordCalls([neonCall])).toBe(1);
        const saved = JSON.parse(JSON.stringify(ledger.serialize())) as DailyLedgerState;
        const bucket = saved.accounts[account];
        const expectedCost = bucket.recordedCalls[0].estimatedCost;
        // 1M * $3 + 0.15M * $15 + 0.05M * $15 + 1M * $0.15 = $6.15
        expect(expectedCost).toBeCloseTo(6.15, 10);

        // Simulate legacy state written when Neon was unpriced
        bucket.totalEstimatedCost = 0;
        for (const stats of Object.values(bucket.modelStats)) {
            stats.estimatedCost = 0;
        }
        bucket.recordedCalls[0].estimatedCost = 0;

        const restored = DailyLedger.restore(saved);
        expect(restored.reconcileRecordedCalls([neonCall])).toBe(1);
        const after = restored.serialize().accounts[account];
        expect(after.totalCalls).toBe(1);
        expect(after.totalEstimatedCost).toBeCloseTo(6.15, 10);
        expect(after.recordedCalls[0].estimatedCost).toBeCloseTo(6.15, 10);
        expect(restored.reconcileRecordedCalls([neonCall])).toBe(0);
    });
});

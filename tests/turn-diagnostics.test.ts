import { describe, expect, it } from 'vitest';
import {
    analyzeTurnDiagnostics,
    classifyTurnStartKind,
    parseDurationSeconds,
} from '../src/turn-diagnostics';

describe('classifyTurnStartKind', () => {
    it('applies exact <10% Cold, 10%–70% Partial, >=70% Warm thresholds', () => {
        expect(classifyTurnStartKind(0, 10_000)).toBe('cold');
        expect(classifyTurnStartKind(9.9, 10_000)).toBe('cold');
        expect(classifyTurnStartKind(10, 10_000)).toBe('partial');
        expect(classifyTurnStartKind(45.5, 10_000)).toBe('partial');
        expect(classifyTurnStartKind(69.9, 10_000)).toBe('partial');
        expect(classifyTurnStartKind(70, 10_000)).toBe('warm');
        expect(classifyTurnStartKind(98.5, 10_000)).toBe('warm');
        expect(classifyTurnStartKind(100, 10_000)).toBe('warm');
    });

    it('returns unknown for zero/negative inputTokens or null/NaN cacheHitPct', () => {
        expect(classifyTurnStartKind(80, 0)).toBe('unknown');
        expect(classifyTurnStartKind(80, -100)).toBe('unknown');
        expect(classifyTurnStartKind(80, Number.NaN)).toBe('unknown');
        expect(classifyTurnStartKind(null, 5_000)).toBe('unknown');
        expect(classifyTurnStartKind(undefined, 5_000)).toBe('unknown');
        expect(classifyTurnStartKind(Number.NaN, 5_000)).toBe('unknown');
        expect(classifyTurnStartKind(-5, 5_000)).toBe('unknown');
    });
});

describe('parseDurationSeconds', () => {
    it('parses s, ms, us, ns duration strings and numeric seconds safely', () => {
        expect(parseDurationSeconds('1.5s')).toBeCloseTo(1.5, 6);
        expect(parseDurationSeconds('450ms')).toBeCloseTo(0.45, 6);
        expect(parseDurationSeconds('500us')).toBeCloseTo(0.0005, 8);
        expect(parseDurationSeconds('250ns')).toBeCloseTo(0.00000025, 10);
        expect(parseDurationSeconds(2.25)).toBe(2.25);
        expect(parseDurationSeconds(0)).toBeNull();
        expect(parseDurationSeconds(-1)).toBeNull();
        expect(parseDurationSeconds(Number.NaN)).toBeNull();
        expect(parseDurationSeconds(Number.POSITIVE_INFINITY)).toBeNull();
        expect(parseDurationSeconds('invalid')).toBeNull();
    });
});

describe('analyzeTurnDiagnostics', () => {
    it('analyzes raw GetCascadeTrajectoryGeneratorMetadata entries with additive prompt cache semantics', () => {
        const summary = analyzeTurnDiagnostics([
            {
                stepIndices: [1],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M532',
                    modelDisplayName: 'Gemini 4 Neon (High)',
                    timeToFirstToken: '1.25s',
                    streamingDuration: '2.0s',
                    chatStartMetadata: { createdAt: '2026-11-22T10:00:00Z' },
                    usage: {
                        inputTokens: 10_000,
                        cacheReadTokens: 0,
                        outputTokens: 200,
                        thinkingOutputTokens: 80,
                        responseOutputTokens: 120,
                    },
                },
            },
            {
                stepIndices: [3],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M532',
                    modelDisplayName: 'Gemini 4 Neon (High)',
                    timeToFirstToken: '450ms',
                    streamingDuration: '2.5s',
                    chatStartMetadata: { createdAt: '2026-11-22T10:01:00Z' },
                    usage: {
                        // Additive: total prompt = 12_000 + 8_000 = 20_000 -> 40.0% (Partial)
                        inputTokens: 12_000,
                        cacheReadTokens: 8_000,
                        outputTokens: 500,
                        thinkingOutputTokens: 200,
                        responseOutputTokens: 300,
                    },
                },
            },
            {
                stepIndices: [5],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M532',
                    modelDisplayName: 'Gemini 4 Neon (High)',
                    timeToFirstToken: '0.35s',
                    streamingDuration: '4.0s',
                    chatStartMetadata: { createdAt: '2026-11-22T10:02:00Z' },
                    usage: {
                        // Additive: total prompt = 3_000 + 27_000 = 30_000 -> 90.0% (Warm)
                        inputTokens: 3_000,
                        cacheReadTokens: 27_000,
                        outputTokens: 400,
                        responseOutputTokens: 250, // implicit thinking = 150
                    },
                },
            },
        ]);

        expect(summary.totalTurns).toBe(3);
        expect(summary.lastTurnCacheHitPct).toBe(90);
        expect(summary.lastTurnStartKind).toBe('warm');
        // Token-weighted session cache: (0 + 8_000 + 27_000) / (10_000 + 20_000 + 30_000) = 35_000 / 60_000 = 58.3%
        expect(summary.sessionCacheHitPct).toBe(58.3);
        expect(summary.coldCount).toBe(1);
        expect(summary.partialCount).toBe(1);
        expect(summary.warmCount).toBe(1);
        expect(summary.unknownCount).toBe(0);

        const [t1, t2, t3] = summary.turns;
        expect(t1).toMatchObject({
            turnIndex: 1,
            stepIndex: 1,
            inputTokens: 10_000,
            cacheReadTokens: 0,
            outputTokens: 200,
            thinkingTokens: 80,
            cacheHitPct: 0,
            startKind: 'cold',
            deltaTokens: null,
            isCompactionDrop: false,
            ttftMs: 1250,
            tokPerSec: 100,
        });
        expect(t2).toMatchObject({
            turnIndex: 2,
            stepIndex: 3,
            inputTokens: 20_000,
            cacheReadTokens: 8_000,
            cacheHitPct: 40,
            startKind: 'partial',
            deltaTokens: 10_000,
            ttftMs: 450,
            tokPerSec: 200,
        });
        expect(t3).toMatchObject({
            turnIndex: 3,
            stepIndex: 5,
            inputTokens: 30_000,
            cacheReadTokens: 27_000,
            thinkingTokens: 150,
            cacheHitPct: 90,
            startKind: 'warm',
            deltaTokens: 10_000,
            ttftMs: 350,
            tokPerSec: 100,
        });
    });

    it('handles post-compaction negative deltaTokens without clamping to zero', () => {
        const summary = analyzeTurnDiagnostics([
            { inputTokens: 10_000, cacheReadTokens: 170_000, outputTokens: 300 },
            { inputTokens: 25_000, cacheReadTokens: 5_000, outputTokens: 200 },
        ]);

        expect(summary.turns[0].deltaTokens).toBeNull();
        expect(summary.turns[1].inputTokens).toBe(30_000);
        expect(summary.turns[1].deltaTokens).toBe(-150_000);
        expect(summary.turns[1].isCompactionDrop).toBe(true);
    });

    it('handles zero-token calls, missing cache telemetry, and sub-1ms timing without NaN/Infinity', () => {
        const summary = analyzeTurnDiagnostics([
            // Zero-token failed/aborted call
            { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, ttftSeconds: 0, streamingSeconds: 0 },
            // Explicitly missing cache telemetry (cacheReadTokens: null)
            { inputTokens: 20_000, cacheReadTokens: null, outputTokens: 100, ttftMs: 0.4, streamingMs: 0.5 },
            // Sub-1ms / sub-50ms duration strings + invalid NaN fields
            {
                chatModel: {
                    timeToFirstToken: '300us',
                    streamingDuration: '0.0005s',
                    usage: {
                        inputTokens: 2_000,
                        cacheReadTokens: 8_000,
                        outputTokens: 1, // < 2 tokens also invalid for speed
                    },
                },
            },
            // Corrupted NaN/Infinity numeric fields
            {
                inputTokens: Number.NaN,
                cacheReadTokens: Number.POSITIVE_INFINITY,
                outputTokens: -50,
                ttftSeconds: Number.POSITIVE_INFINITY,
                streamingSeconds: Number.NaN,
            },
        ]);

        expect(summary.turns[0]).toMatchObject({
            inputTokens: 0,
            cacheHitPct: null,
            startKind: 'unknown',
            deltaTokens: null,
            ttftMs: null,
            tokPerSec: null,
        });

        expect(summary.turns[1]).toMatchObject({
            inputTokens: 20_000,
            cacheHitPct: null,
            startKind: 'unknown',
            ttftMs: null,
            tokPerSec: null,
        });

        // Turn 3 has valid cache telemetry (8_000 / 10_000 = 80%) and sub-1ms timing safely nulled
        expect(summary.turns[2]).toMatchObject({
            inputTokens: 10_000,
            cacheHitPct: 80,
            startKind: 'warm',
            deltaTokens: -10_000,
            ttftMs: null,
            tokPerSec: null,
        });

        // Turn 4 corrupted values never produce NaN or Infinity
        expect(summary.turns[3]).toMatchObject({
            inputTokens: 0,
            outputTokens: 0,
            cacheHitPct: null,
            startKind: 'unknown',
            ttftMs: null,
            tokPerSec: null,
        });

        // Only turn 3 had valid cache telemetry -> sessionCacheHitPct = 80% (not diluted by missing-telemetry turn 2!)
        expect(summary.sessionCacheHitPct).toBe(80);
        // Latest turn (turn 4) is unknown
        expect(summary.lastTurnCacheHitPct).toBeNull();
        expect(summary.lastTurnStartKind).toBe('unknown');
    });

    it('supports treatUndefinedCacheAsMissing, inclusive cache semantics, and maxTurns slicing', () => {
        const missingMode = analyzeTurnDiagnostics(
            [{ inputTokens: 5_000, outputTokens: 100 }],
            { treatUndefinedCacheAsMissing: true },
        );
        expect(missingMode.lastTurnCacheHitPct).toBeNull();
        expect(missingMode.lastTurnStartKind).toBe('unknown');

        const inclusive = analyzeTurnDiagnostics(
            [{ inputTokens: 10_000, cacheReadTokens: 7_500, outputTokens: 100 }],
            { cacheSemantics: 'inclusive' },
        );
        expect(inclusive.turns[0].inputTokens).toBe(10_000);
        expect(inclusive.turns[0].freshInputTokens).toBe(2_500);
        expect(inclusive.lastTurnCacheHitPct).toBe(75);
        expect(inclusive.lastTurnStartKind).toBe('warm');

        const sliced = analyzeTurnDiagnostics(
            [
                { inputTokens: 1_000, cacheReadTokens: 0 },
                { inputTokens: 2_000, cacheReadTokens: 0 },
                { inputTokens: 3_000, cacheReadTokens: 0 },
                { inputTokens: 4_000, cacheReadTokens: 0 },
            ],
            { maxTurns: 2 },
        );
        expect(sliced.totalTurns).toBe(4);
        expect(sliced.turns).toHaveLength(2);
        expect(sliced.turns[0].turnIndex).toBe(3);
        expect(sliced.turns[0].deltaTokens).toBe(1_000);
        expect(sliced.turns[1].turnIndex).toBe(4);
    });

    it('accounts for cacheCreationTokens in additive totalPromptTokens and exact threshold boundaries', () => {
        const summary = analyzeTurnDiagnostics([
            // 1000 fresh + 7000 cacheRead + 2000 cacheCreation = 10_000 -> exact 70.0% Warm
            { inputTokens: 1_000, cacheReadTokens: 7_000, cacheCreationTokens: 2_000, outputTokens: 100 },
            // 9000 fresh + 1000 cacheRead = 10_000 -> exact 10.0% Partial
            { inputTokens: 9_000, cacheReadTokens: 1_000, outputTokens: 100 },
            // 9010 fresh + 990 cacheRead = 10_000 -> 9.9% Cold
            { inputTokens: 9_010, cacheReadTokens: 990, outputTokens: 100 },
        ]);

        expect(summary.turns[0]).toMatchObject({ inputTokens: 10_000, cacheHitPct: 70, startKind: 'warm' });
        expect(summary.turns[1]).toMatchObject({ inputTokens: 10_000, cacheHitPct: 10, startKind: 'partial', deltaTokens: 0 });
        expect(summary.turns[2]).toMatchObject({ inputTokens: 10_000, cacheHitPct: 9.9, startKind: 'cold', deltaTokens: 0 });
    });

    it('returns safe empty summary for empty input', () => {
        const empty = analyzeTurnDiagnostics([]);
        expect(empty).toEqual({
            lastTurnCacheHitPct: null,
            sessionCacheHitPct: null,
            lastTurnStartKind: 'unknown',
            turns: [],
            totalTurns: 0,
            coldCount: 0,
            partialCount: 0,
            warmCount: 0,
            unknownCount: 0,
            totalInputTokens: 0,
            totalCacheReadTokens: 0,
            totalOutputTokens: 0,
            totalThinkingTokens: 0,
        });
    });
});

import { describe, expect, it } from 'vitest';
import type { GMCallEntry, GMConversationData, GMModelStats, GMSummary } from '../src/gm/types';
import type { ModelPricing } from '../src/pricing-store';
import {
    MIN_OUTPUT_TOKENS_FOR_SPEED,
    MIN_STREAM_SECONDS,
    REP_MIN_OUTPUT_TOKENS,
    REP_MIN_STREAM_SECONDS,
    computeCallTelemetry,
    computeStepCacheHitRate,
    computeStepSpeed,
    computeTelemetryAggregate,
    computeTelemetryAggregateFromModelStats,
    computeTelemetrySummary,
    formatCachePercent,
    formatLatency,
    formatSpeed,
    isInternalCompactionCall,
} from '../src/telemetry-metrics';

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        stepIndices: [1],
        executionId: 'exec-1',
        model: 'MODEL_PLACEHOLDER_M26',
        modelDisplay: 'Claude Opus 4.6 (Thinking)',
        responseModel: 'claude-opus-4-6-thinking',
        modelAccuracy: 'exact',
        inputTokens: 1000,
        outputTokens: 200,
        thinkingTokens: 50,
        responseTokens: 150,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        ttftSeconds: 1.5,
        streamingSeconds: 2.0,
        credits: 1,
        creditType: 'ai',
        hasError: false,
        errorMessage: '',
        contextTokensUsed: 1200,
        completionConfig: null,
        systemPromptSnippet: '',
        toolCount: 2,
        toolNames: ['read_file'],
        promptSectionTitles: ['system', 'tools'],
        promptSnippet: '',
        promptSource: 'none',
        messagePromptCount: 0,
        messageMetadataKeys: [],
        responseHeaderKeys: [],
        userMessageAnchors: [],
        aiSnippetsByStep: {},
        retries: 0,
        stopReason: 'STOP_REASON_END_TURN',
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        timeSinceLastInvocation: 0,
        tokenBreakdownGroups: [],
        createdAt: '2026-10-15T10:00:00.000Z',
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        toolCallsByStep: {},
        contextWindowCapacity: 160000,
        ...overrides,
    };
}

function makeModelStats(overrides: Partial<GMModelStats> = {}): GMModelStats {
    return {
        callCount: 1,
        stepsCovered: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalThinkingTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCredits: 0,
        avgTTFT: 1.0,
        minTTFT: 1.0,
        maxTTFT: 1.0,
        avgStreaming: 2.0,
        cacheHitRate: 0,
        responseModel: 'claude-opus-4-6-thinking',
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        completionConfig: null,
        hasSystemPrompt: false,
        toolCount: 0,
        promptSectionTitles: [],
        totalRetries: 0,
        errorCount: 0,
        creditCallCount: 0,
        exactCallCount: 1,
        placeholderOnlyCalls: 0,
        contextWindowCapacity: 160000,
        ...overrides,
    };
}

function makeSummary(conversations: GMConversationData[], modelBreakdown: Record<string, GMModelStats> = {}): GMSummary {
    return {
        conversations,
        modelBreakdown,
        totalCalls: conversations.reduce((s, c) => s + c.calls.length, 0),
        totalStepsCovered: 0,
        totalCredits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalThinkingTokens: 0,
        contextGrowth: [],
        fetchedAt: '2026-10-15T10:05:00.000Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
        retryErrorCodes: {},
        recentErrors: [],
        toolCallCounts: {},
    };
}

describe('computeCallTelemetry — Antigravity protobuf semantics', () => {
    it('treats cacheReadTokens and cacheCreationTokens as strictly additive with inputTokens', () => {
        // Real RPC capture pattern: cacheReadTokens > inputTokens (impossible if subset)
        const point = computeCallTelemetry(makeCall({
            inputTokens: 2285,
            cacheReadTokens: 11219,
            cacheCreationTokens: 496,
            outputTokens: 248,
            thinkingTokens: 0,
            responseTokens: 248,
        }));

        expect(point.totalPromptTokens).toBe(2285 + 11219 + 496);
        expect(point.promptCacheHitRate).toBeCloseTo(11219 / 14000, 10);
        expect(point.promptCacheHitRate!).toBeLessThanOrEqual(1);
        expect(point.isCacheHit).toBe(true);
        expect(point.cacheState).toBe('warm');
    });

    it('computes token-weighted cache hit accurately when call-hit would mislead as 100%', () => {
        const point = computeCallTelemetry(makeCall({
            inputTokens: 24000,
            cacheReadTokens: 4000,
            cacheCreationTokens: 0,
        }));

        expect(point.totalPromptTokens).toBe(28000);
        expect(point.promptCacheHitRate).toBeCloseTo(4000 / 28000, 10);
        expect(formatCachePercent(point.promptCacheHitRate)).toBe('14.3%');
    });

    it('treats thinkingTokens as strictly a subset of outputTokens (never sums output + thinking)', () => {
        const point = computeCallTelemetry(makeCall({
            outputTokens: 568,
            thinkingTokens: 563,
            responseTokens: 5,
            ttftSeconds: 1.0,
            streamingSeconds: 4.0,
        }));

        expect(point.effectiveThinkingTokens).toBe(563);
        expect(point.visibleResponseTokens).toBe(5);
        // Total gen speed uses 568 (NOT 568 + 563 = 1131!)
        expect(point.totalGenTokPerSec).toBeCloseTo(568 / 4.0, 10);
        expect(point.visibleTokPerSec).toBeCloseTo(5 / 4.0, 10);
        // End-to-end strictly adds ttft + streaming (decode excludes TTFT)
        expect(point.endToEndTokPerSec).toBeCloseTo(568 / 5.0, 10);
    });

    it('derives visibleResponseTokens from outputTokens - thinkingTokens when responseTokens is 0', () => {
        const point = computeCallTelemetry(makeCall({
            outputTokens: 300,
            thinkingTokens: 180,
            responseTokens: 0,
            streamingSeconds: 3.0,
        }));

        expect(point.visibleResponseTokens).toBe(120);
        expect(point.effectiveThinkingTokens).toBe(180);
        expect(point.totalGenTokPerSec).toBeCloseTo(100, 10);
        expect(point.visibleTokPerSec).toBeCloseTo(40, 10);
    });

    it('handles Gemini implicit thinking (outputTokens > responseTokens > 0 with thinkingTokens === 0)', () => {
        // Real Gemini 3.8 Flash capture: outputTokens=291, responseOutputTokens=67, thinkingOutputTokens omitted
        const point = computeCallTelemetry(makeCall({
            model: 'MODEL_PLACEHOLDER_M318',
            modelDisplay: 'Gemini 3.8 Flash (High)',
            responseModel: 'gemini-3.8-flash-high',
            outputTokens: 291,
            thinkingTokens: 0,
            responseTokens: 67,
            streamingSeconds: 2.0,
        }));

        expect(point.thinkingTokens).toBe(0);
        expect(point.effectiveThinkingTokens).toBe(224);
        expect(point.visibleResponseTokens).toBe(67);
        expect(point.totalGenTokPerSec).toBeCloseTo(291 / 2.0, 10);
        expect(point.visibleTokPerSec).toBeCloseTo(67 / 2.0, 10);
    });

    it('rejects 1-token jitter, sub-50ms durations, and non-positive timings with null (never fabricates 0)', () => {
        const oneToken = computeCallTelemetry(makeCall({
            outputTokens: 1,
            thinkingTokens: 0,
            responseTokens: 1,
            streamingSeconds: 0.5,
            ttftSeconds: 0.8,
        }));
        expect(oneToken.totalGenTokPerSec).toBeNull();
        expect(oneToken.visibleTokPerSec).toBeNull();
        expect(oneToken.endToEndTokPerSec).toBeNull();
        expect(oneToken.ttftSeconds).toBe(0.8);

        const sub50ms = computeCallTelemetry(makeCall({
            outputTokens: 100,
            streamingSeconds: MIN_STREAM_SECONDS - 0.001,
            ttftSeconds: 0,
        }));
        expect(sub50ms.totalGenTokPerSec).toBeNull();
        expect(sub50ms.visibleTokPerSec).toBeNull();
        expect(sub50ms.ttftSeconds).toBeNull();

        const zeroTimings = computeCallTelemetry(makeCall({
            outputTokens: 100,
            streamingSeconds: 0,
            ttftSeconds: 0,
        }));
        expect(zeroTimings.ttftSeconds).toBeNull();
        expect(zeroTimings.streamingSeconds).toBeNull();
        expect(zeroTimings.totalGenTokPerSec).toBeNull();

        const exactBoundary = computeCallTelemetry(makeCall({
            outputTokens: MIN_OUTPUT_TOKENS_FOR_SPEED,
            thinkingTokens: 0,
            responseTokens: MIN_OUTPUT_TOKENS_FOR_SPEED,
            streamingSeconds: MIN_STREAM_SECONDS,
            ttftSeconds: 0,
        }));
        expect(exactBoundary.totalGenTokPerSec).toBeCloseTo(40, 10);
        expect(exactBoundary.endToEndTokPerSec).toBeNull(); // missing TTFT must not be fabricated as 0
    });

    it('classifies warm, warming, cold, and unknown cache states accurately', () => {
        expect(computeCallTelemetry(makeCall({ inputTokens: 100, cacheReadTokens: 500, cacheCreationTokens: 0 })).cacheState).toBe('warm');
        expect(computeCallTelemetry(makeCall({ inputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 500 })).cacheState).toBe('warming');
        expect(computeCallTelemetry(makeCall({ inputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 })).cacheState).toBe('cold');
        expect(computeCallTelemetry(makeCall({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).cacheState).toBe('unknown');
    });

    it('computes priced USD cache savings accurately and returns null (never $0.00) when unpriced or zero cacheRead', () => {
        // Claude Opus 4.6: input=$5/1M, cacheRead=$0.50/1M => savings = $4.50/1M
        const pricedHit = computeCallTelemetry(makeCall({
            cacheReadTokens: 1_000_000,
        }));
        expect(pricedHit.estCacheSavingsUsd).toBeCloseTo(4.5, 10);

        // Priced model with 0 cache reads => null (never fake $0.00)
        const pricedMiss = computeCallTelemetry(makeCall({
            cacheReadTokens: 0,
        }));
        expect(pricedMiss.estCacheSavingsUsd).toBeNull();

        // Unpriced model with cache reads => null (never fake $0.00)
        const unpricedHit = computeCallTelemetry(makeCall({
            model: 'MODEL_UNKNOWN_999',
            modelDisplay: 'Mystery Model X',
            responseModel: 'mystery-model-x',
            cacheReadTokens: 500_000,
        }));
        expect(unpricedHit.estCacheSavingsUsd).toBeNull();

        // Custom pricing override works even for custom/unpriced models
        const custom: Record<string, ModelPricing> = {
            'mystery-model-x': { input: 10, output: 30, cacheRead: 1, cacheWrite: 12.5, thinking: 30 },
        };
        const customHit = computeCallTelemetry(makeCall({
            model: 'MODEL_UNKNOWN_999',
            modelDisplay: 'Mystery Model X',
            responseModel: 'mystery-model-x',
            cacheReadTokens: 500_000,
        }), custom);
        expect(customHit.estCacheSavingsUsd).toBeCloseTo(4.5, 10);

        // Historical dated pricing: Gemini 3.8 Flash intro ($0.75 in / $0.075 cacheRead) vs 2027 ($1.50 / $0.15)
        const flashIntro = computeCallTelemetry(makeCall({
            model: 'MODEL_PLACEHOLDER_M318',
            modelDisplay: 'Gemini 3.8 Flash (High)',
            responseModel: 'gemini-3.8-flash-high',
            cacheReadTokens: 1_000_000,
            createdAt: '2026-09-10T10:00:00.000Z',
        }));
        expect(flashIntro.estCacheSavingsUsd).toBeCloseTo(0.675, 10);

        const flashPost = computeCallTelemetry(makeCall({
            model: 'MODEL_PLACEHOLDER_M318',
            modelDisplay: 'Gemini 3.8 Flash (High)',
            responseModel: 'gemini-3.8-flash-high',
            cacheReadTokens: 1_000_000,
            createdAt: '2027-02-10T10:00:00.000Z',
        }));
        expect(flashPost.estCacheSavingsUsd).toBeCloseTo(1.35, 10);
    });
});

describe('computeTelemetryAggregate — weighting, spread, TTFT cache delta, and noise guards', () => {
    it('computes ratio-of-sums weighted speed rather than unweighted arithmetic mean of ratios', () => {
        // Call A: 50 tokens / 1s = 50 tok/s
        // Call B: 900 tokens / 9s = 100 tok/s
        // Unweighted mean = 75 tok/s; Ratio of sums = 950 / 10 = 95 tok/s
        const agg = computeTelemetryAggregate([
            makeCall({ executionId: 'a', outputTokens: 50, thinkingTokens: 0, responseTokens: 50, streamingSeconds: 1.0, ttftSeconds: 1.0 }),
            makeCall({ executionId: 'b', outputTokens: 900, thinkingTokens: 0, responseTokens: 900, streamingSeconds: 9.0, ttftSeconds: 1.0 }),
        ]);

        expect(agg.weightedGenTokPerSec).toBeCloseTo(95, 10);
        expect(agg.weightedVisibleTokPerSec).toBeCloseTo(95, 10);
        // End-to-end: (50 + 900) / ((1+1) + (1+9)) = 950 / 12
        expect(agg.weightedEndToEndTokPerSec).toBeCloseTo(950 / 12, 10);
        expect(agg.speedSampleCount).toBe(2);
        expect(agg.representativeSpeedSampleCount).toBe(2);
    });

    it('uses representative samples for median/min/max and falls back to hard-valid when none are representative', () => {
        // Tiny hard-valid spike: 5 tokens / 0.05s = 100 tok/s (below REP_MIN_STREAM_SECONDS & REP_MIN_OUTPUT_TOKENS)
        // Representative calls: 40 tok/s, 60 tok/s, 80 tok/s
        const spike = makeCall({
            executionId: 'spike',
            outputTokens: 5,
            thinkingTokens: 0,
            responseTokens: 5,
            streamingSeconds: 0.05,
        });
        const rep1 = makeCall({
            executionId: 'r1',
            outputTokens: 40,
            thinkingTokens: 0,
            responseTokens: 40,
            streamingSeconds: 1.0,
        });
        const rep2 = makeCall({
            executionId: 'r2',
            outputTokens: 60,
            thinkingTokens: 0,
            responseTokens: 60,
            streamingSeconds: 1.0,
        });
        const rep3 = makeCall({
            executionId: 'r3',
            outputTokens: 80,
            thinkingTokens: 0,
            responseTokens: 80,
            streamingSeconds: 1.0,
        });

        const withRep = computeTelemetryAggregate([spike, rep1, rep2, rep3]);
        expect(withRep.speedSampleCount).toBe(4);
        expect(withRep.representativeSpeedSampleCount).toBe(3);
        // Weighted sum includes all 4 hard-valid calls: (5+40+60+80) / (0.05+1+1+1) = 185 / 3.05
        expect(withRep.weightedGenTokPerSec).toBeCloseTo(185 / 3.05, 10);
        // Spread uses ONLY the 3 representative calls (spike of 100 tok/s does not distort max!)
        expect(withRep.minGenTokPerSec).toBeCloseTo(40, 10);
        expect(withRep.medianGenTokPerSec).toBeCloseTo(60, 10);
        expect(withRep.maxGenTokPerSec).toBeCloseTo(80, 10);

        // Fallback when ONLY hard-valid (non-representative) calls exist
        const tinyA = makeCall({
            executionId: 'tiny-a',
            outputTokens: REP_MIN_OUTPUT_TOKENS - 2,
            streamingSeconds: REP_MIN_STREAM_SECONDS - 0.05, // 8 / 0.2 = 40
        });
        const tinyB = makeCall({
            executionId: 'tiny-b',
            outputTokens: 6,
            streamingSeconds: 0.1, // 6 / 0.1 = 60
        });
        const fallbackOnly = computeTelemetryAggregate([tinyA, tinyB]);
        expect(fallbackOnly.speedSampleCount).toBe(2);
        expect(fallbackOnly.representativeSpeedSampleCount).toBe(0);
        expect(fallbackOnly.minGenTokPerSec).toBeCloseTo(40, 10);
        expect(fallbackOnly.medianGenTokPerSec).toBeCloseTo(50, 10);
        expect(fallbackOnly.maxGenTokPerSec).toBeCloseTo(60, 10);
    });

    it('computes Cached vs Uncached TTFT delta accurately for both faster and slower cached cases', () => {
        // Faster cached case: cached avg = 0.8s, uncached avg = 2.0s => (0.8 - 2.0) / 2.0 * 100 = -60%
        const faster = computeTelemetryAggregate([
            makeCall({ executionId: 'c1', ttftSeconds: 0.6, cacheReadTokens: 5000 }),
            makeCall({ executionId: 'c2', ttftSeconds: 1.0, cacheReadTokens: 8000 }),
            makeCall({ executionId: 'u1', ttftSeconds: 2.0, cacheReadTokens: 0 }),
            // Zero-TTFT call must be excluded from both buckets and overall count
            makeCall({ executionId: 'z1', ttftSeconds: 0, cacheReadTokens: 5000 }),
        ]);

        expect(faster.ttftSampleCount).toBe(3);
        expect(faster.cachedTtftCount).toBe(2);
        expect(faster.uncachedTtftCount).toBe(1);
        expect(faster.cachedAvgTtftSeconds).toBeCloseTo(0.8, 10);
        expect(faster.uncachedAvgTtftSeconds).toBeCloseTo(2.0, 10);
        expect(faster.ttftCacheDeltaPct).toBeCloseTo(-60, 10);
        expect(faster.minTtftSeconds).toBeCloseTo(0.6, 10);
        expect(faster.medianTtftSeconds).toBeCloseTo(1.0, 10);
        expect(faster.maxTtftSeconds).toBeCloseTo(2.0, 10);
        expect(faster.p95TtftSeconds).toBeCloseTo(1.9, 10);

        // Slower cached case (e.g. massive cached prompt vs tiny uncached prompt): +20%
        const slower = computeTelemetryAggregate([
            makeCall({ executionId: 'c1', ttftSeconds: 2.4, cacheReadTokens: 100000 }),
            makeCall({ executionId: 'u1', ttftSeconds: 2.0, cacheReadTokens: 0 }),
        ]);
        expect(slower.ttftCacheDeltaPct).toBeCloseTo(20, 10);

        // Single-bucket only => delta must be null
        const cachedOnly = computeTelemetryAggregate([
            makeCall({ executionId: 'c1', ttftSeconds: 0.8, cacheReadTokens: 5000 }),
        ]);
        expect(cachedOnly.cachedAvgTtftSeconds).toBeCloseTo(0.8, 10);
        expect(cachedOnly.uncachedAvgTtftSeconds).toBeNull();
        expect(cachedOnly.ttftCacheDeltaPct).toBeNull();
    });

    it('computes tokenCacheHitRate, callCacheHitRate, cacheReuseRate, and never fakes $0.00 savings', () => {
        const agg = computeTelemetryAggregate([
            makeCall({
                executionId: 'u1',
                model: 'MODEL_UNKNOWN_1',
                modelDisplay: 'Unknown Model',
                responseModel: 'unknown-model',
                inputTokens: 1000,
                cacheReadTokens: 0,
                cacheCreationTokens: 3000,
                createdAt: '2026-10-15T10:00:00.000Z',
            }),
            makeCall({
                executionId: 'u2',
                model: 'MODEL_UNKNOWN_1',
                modelDisplay: 'Unknown Model',
                responseModel: 'unknown-model',
                inputTokens: 1000,
                cacheReadTokens: 9000,
                cacheCreationTokens: 0,
                createdAt: '2026-10-15T10:01:00.000Z',
            }),
        ]);

        expect(agg.totalFreshInputTokens).toBe(2000);
        expect(agg.totalCacheReadTokens).toBe(9000);
        expect(agg.totalCacheCreationTokens).toBe(3000);
        expect(agg.totalPromptTokens).toBe(14000);
        expect(agg.tokenCacheHitRate).toBeCloseTo(9000 / 14000, 10);
        expect(agg.callCacheHitRate).toBeCloseTo(0.5, 10);
        expect(agg.cacheReuseRate).toBeCloseTo(9000 / 12000, 10);
        expect(agg.cachedCallCount).toBe(1);
        expect(agg.totalCalls).toBe(2);
        expect(agg.latestCacheState).toBe('warm');
        expect(agg.estCacheSavedTokens).toBe(9000);
        expect(agg.estCacheSavingsUsd).toBeNull(); // unpriced => null, NEVER $0.00
    });

    it('excludes unambiguous internal compaction calls without dropping normal chat calls', () => {
        const compactionById = makeCall({
            executionId: 'compaction-step-42',
            outputTokens: 500,
            streamingSeconds: 1.0,
        });
        const compactionByPrompt = makeCall({
            executionId: 'exec-internal-1',
            toolCount: 0,
            userMessageAnchors: [],
            promptSectionTitles: ['checkpoint_summary'],
            outputTokens: 400,
            streamingSeconds: 1.0,
        });
        // Normal chat call that happens to have a prior checkpoint & mentions "compaction" in user prompt
        const normalChat = makeCall({
            executionId: 'exec-normal-1',
            checkpointIndex: 2,
            checkpointSummaries: [{ checkpointNumber: 2, stepIndex: 10, tokens: 500, fullText: 'Checkpoint 2' }],
            promptSnippet: 'Please summarize how compaction works',
            toolCount: 3,
            outputTokens: 100,
            streamingSeconds: 2.0,
        });

        expect(isInternalCompactionCall(compactionById)).toBe(true);
        expect(isInternalCompactionCall(compactionByPrompt)).toBe(true);
        expect(isInternalCompactionCall(normalChat)).toBe(false);

        const agg = computeTelemetryAggregate([compactionById, compactionByPrompt, normalChat]);
        expect(agg.totalCalls).toBe(1);
        expect(agg.weightedGenTokPerSec).toBeCloseTo(50, 10);
    });

    it('detects hasThinking from Gemini implicit thinking even when thinkingTokens === 0', () => {
        const agg = computeTelemetryAggregate([
            makeCall({ outputTokens: 291, thinkingTokens: 0, responseTokens: 67, streamingSeconds: 2.0 }),
        ]);
        expect(agg.hasThinking).toBe(true);
        expect(agg.weightedVisibleTokPerSec).toBeCloseTo(67 / 2.0, 10);
    });

    it('falls back cleanly to GMModelStats when calls[] is empty/archived', () => {
        const stats: Record<string, GMModelStats> = {
            'Claude Opus 4.6 (Thinking)': makeModelStats({
                callCount: 4,
                totalInputTokens: 10000,
                totalOutputTokens: 1000,
                totalThinkingTokens: 400,
                totalCacheRead: 40000,
                totalCacheCreation: 10000,
                avgTTFT: 1.25,
                minTTFT: 0.8,
                maxTTFT: 2.1,
                avgStreaming: 4.0,
                cacheHitRate: 0.75,
                ttftSampleCount: 2,
                streamingSampleCount: 2,
                timedOutputTokens: 800,
                timedStreamingSeconds: 10.0,
                cacheHitCalls: 3,
            }),
        };

        const agg = computeTelemetryAggregate([], undefined, stats);
        expect(agg.totalCalls).toBe(4);
        expect(agg.weightedGenTokPerSec).toBeCloseTo(80, 10);
        expect(agg.weightedVisibleTokPerSec).toBeCloseTo(48, 10); // 60% visible ratio * 800 / 10
        expect(agg.avgTtftSeconds).toBeCloseTo(1.25, 10);
        expect(agg.minTtftSeconds).toBeCloseTo(0.8, 10);
        expect(agg.maxTtftSeconds).toBeCloseTo(2.1, 10);
        expect(agg.ttftSampleCount).toBe(2);
        expect(agg.avgStreamingSeconds).toBeCloseTo(4.0, 10);
        expect(agg.streamingSampleCount).toBe(2);
        expect(agg.totalPromptTokens).toBe(60000);
        expect(agg.tokenCacheHitRate).toBeCloseTo(40000 / 60000, 10);
        expect(agg.callCacheHitRate).toBeCloseTo(0.75, 10);
        expect(agg.cacheReuseRate).toBeCloseTo(40000 / 50000, 10);
        expect(agg.estCacheSavedTokens).toBe(40000);
        expect(agg.estCacheSavingsUsd).toBeCloseTo(40000 * 4.5 / 1e6, 10);
        // Never fabricates per-call spread/latest metrics when calls[] is absent
        expect(agg.medianGenTokPerSec).toBeNull();
        expect(agg.latestCall).toBeNull();
        expect(agg.latestTimedCall).toBeNull();
        expect(agg.ttftCacheDeltaPct).toBeNull();

        // Legacy GMModelStats without optional sample counts still works
        const legacyAgg = computeTelemetryAggregateFromModelStats({
            'Claude Sonnet 4.6': makeModelStats({
                callCount: 2,
                totalInputTokens: 2000,
                totalOutputTokens: 400,
                totalCacheRead: 8000,
                avgTTFT: 1.5,
                avgStreaming: 4.0,
                cacheHitRate: 0.5,
                responseModel: 'claude-sonnet-4-6',
            }),
        });
        expect(legacyAgg.weightedGenTokPerSec).toBeCloseTo(400 / 8.0, 10);
        expect(legacyAgg.tokenCacheHitRate).toBeCloseTo(0.8, 10);
        expect(legacyAgg.cachedCallCount).toBe(1);
    });
});

describe('computeTelemetrySummary', () => {
    it('handles null/undefined summary safely', () => {
        const res = computeTelemetrySummary(null);
        expect(res.primaryScope).toBe('session');
        expect(res.active).toBeNull();
        expect(res.overall.totalCalls).toBe(0);
        expect(res.overall.weightedGenTokPerSec).toBeNull();
        expect(res.byModel).toEqual({});
    });

    it('computes active vs overall primary scope, per-model aggregates, and chronological latest snapshot', () => {
        const oldConv: GMConversationData = {
            cascadeId: 'conv-old',
            title: 'Old Large Conv',
            totalSteps: 100,
            calls: [
                makeCall({
                    executionId: 'old-1',
                    model: 'MODEL_PLACEHOLDER_M26',
                    modelDisplay: 'Claude Opus 4.6 (Thinking)',
                    responseModel: 'claude-opus-4-6-thinking',
                    outputTokens: 100,
                    thinkingTokens: 0,
                    responseTokens: 100,
                    streamingSeconds: 2.0,
                    ttftSeconds: 2.0,
                    createdAt: '2026-10-15T09:00:00.000Z',
                }),
            ],
            coveredSteps: 1,
            coverageRate: 0.01,
            checkpointSummaries: [],
        };
        const activeConv: GMConversationData = {
            cascadeId: 'conv-active',
            title: 'Active Conv',
            totalSteps: 5,
            calls: [
                makeCall({
                    executionId: 'act-1',
                    model: 'MODEL_PLACEHOLDER_M318',
                    modelDisplay: 'Gemini 3.8 Flash (High)',
                    responseModel: 'gemini-3.8-flash-high',
                    outputTokens: 300,
                    thinkingTokens: 0,
                    responseTokens: 300,
                    streamingSeconds: 2.0, // 150 tok/s
                    ttftSeconds: 0.5,
                    cacheReadTokens: 9000,
                    inputTokens: 1000,
                    createdAt: '2026-10-15T10:00:00.000Z',
                }),
                // Trailing 1-token noise call: latestCall updates, but latestGenTokPerSec preserves act-1!
                makeCall({
                    executionId: 'act-2',
                    model: 'MODEL_PLACEHOLDER_M318',
                    modelDisplay: 'Gemini 3.8 Flash (High)',
                    responseModel: 'gemini-3.8-flash-high',
                    outputTokens: 1,
                    thinkingTokens: 0,
                    responseTokens: 1,
                    streamingSeconds: 0.1,
                    ttftSeconds: 0.4,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 200,
                    inputTokens: 100,
                    createdAt: '2026-10-15T10:01:00.000Z',
                }),
            ],
            coveredSteps: 2,
            coverageRate: 0.4,
            checkpointSummaries: [],
        };

        const summary = makeSummary([oldConv, activeConv]);
        const withActive = computeTelemetrySummary(summary, { activeCascadeId: 'conv-active' });

        expect(withActive.primaryScope).toBe('active');
        expect(withActive.active).not.toBeNull();
        expect(withActive.primary).toBe(withActive.active);
        expect(withActive.active!.totalCalls).toBe(2);
        expect(withActive.active!.latestCall?.callId).toBe('act-2');
        expect(withActive.active!.latestCacheState).toBe('warming');
        expect(withActive.active!.latestTtftSeconds).toBeCloseTo(0.4, 10);
        expect(withActive.active!.latestGenTokPerSec).toBeCloseTo(150, 10);
        expect(withActive.active!.latestTimedCall?.callId).toBe('act-1');

        expect(withActive.overall.totalCalls).toBe(3);
        expect(withActive.overall.latestCall?.callId).toBe('act-2');
        expect(Object.keys(withActive.byModel)).toEqual(
            expect.arrayContaining(['Claude Opus 4.6 (Thinking)', 'Gemini 3.8 Flash (High)']),
        );
        expect(withActive.byModel['Claude Opus 4.6 (Thinking)'].weightedGenTokPerSec).toBeCloseTo(50, 10);
        expect(withActive.byModel['Gemini 3.8 Flash (High)'].weightedGenTokPerSec).toBeCloseTo(150, 10);

        // When activeCascadeId has no matching conversation => primary falls back to session
        const withoutActive = computeTelemetrySummary(summary, { activeCascadeId: 'nonexistent' });
        expect(withoutActive.primaryScope).toBe('session');
        expect(withoutActive.active).toBeNull();
        expect(withoutActive.primary).toBe(withoutActive.overall);
    });

    it('falls back to modelBreakdown in overall and byModel when calls[] are stripped', () => {
        const summary = makeSummary(
            [{ cascadeId: 'c1', title: 'Stripped', totalSteps: 5, calls: [], coveredSteps: 0, coverageRate: 0, checkpointSummaries: [] }],
            {
                'Claude Opus 4.6 (Thinking)': makeModelStats({
                    callCount: 3,
                    totalInputTokens: 3000,
                    totalOutputTokens: 600,
                    totalCacheRead: 7000,
                    avgTTFT: 1.1,
                    avgStreaming: 3.0,
                    ttftSampleCount: 3,
                    streamingSampleCount: 3,
                    timedOutputTokens: 600,
                    timedStreamingSeconds: 9.0,
                    cacheHitCalls: 2,
                    cacheHitRate: 2 / 3,
                }),
            },
        );

        const res = computeTelemetrySummary(summary, { activeCascadeId: 'c1' });
        expect(res.primaryScope).toBe('session');
        expect(res.overall.totalCalls).toBe(3);
        expect(res.overall.weightedGenTokPerSec).toBeCloseTo(600 / 9.0, 10);
        expect(res.overall.tokenCacheHitRate).toBeCloseTo(0.7, 10);
        expect(res.byModel['Claude Opus 4.6 (Thinking)']?.avgTtftSeconds).toBeCloseTo(1.1, 10);
    });
});

describe('step helpers and formatters', () => {
    it('computes step speed and additive step cache hit rate with proper guards', () => {
        expect(computeStepSpeed(120, 2.0)).toBeCloseTo(60, 10);
        expect(computeStepSpeed(1, 1.0)).toBeNull();
        expect(computeStepSpeed(100, 0.04)).toBeNull();
        expect(computeStepSpeed(undefined, 2.0)).toBeNull();

        expect(computeStepCacheHitRate(2000, 8000, 0)).toBeCloseTo(0.8, 10);
        expect(computeStepCacheHitRate(2000, 6000, 2000)).toBeCloseTo(0.6, 10);
        expect(computeStepCacheHitRate(0, 0, 0)).toBeNull();
    });

    it('formats speed, latency, and cache percentage cleanly', () => {
        expect(formatSpeed(null)).toBe('—');
        expect(formatSpeed(undefined)).toBe('—');
        expect(formatSpeed(0)).toBe('—');
        expect(formatSpeed(-10)).toBe('—');
        expect(formatSpeed(Number.NaN)).toBe('—');
        expect(formatSpeed(64.24)).toBe('64.2 tok/s');
        expect(formatSpeed(999.94)).toBe('999.9 tok/s');
        expect(formatSpeed(999.95)).toBe('1.0k tok/s');
        expect(formatSpeed(1234)).toBe('1.2k tok/s');

        expect(formatLatency(null)).toBe('—');
        expect(formatLatency(0)).toBe('—');
        expect(formatLatency(-0.5)).toBe('—');
        expect(formatLatency(0.42)).toBe('420ms');
        expect(formatLatency(0.9996)).toBe('1.00s');
        expect(formatLatency(1.0)).toBe('1.00s');
        expect(formatLatency(1.423)).toBe('1.42s');

        expect(formatCachePercent(null)).toBe('—');
        expect(formatCachePercent(-0.1)).toBe('—');
        expect(formatCachePercent(0)).toBe('0%');
        expect(formatCachePercent(0.8423)).toBe('84.2%');
        expect(formatCachePercent(1)).toBe('100%');
        expect(formatCachePercent(0.9996)).toBe('100%');
    });
});

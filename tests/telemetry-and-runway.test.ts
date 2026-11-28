// Consolidated Domain Suite: Telemetry Metrics, Weekly Quota Runway & Monitor Overview
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { GMCallEntry, GMConversationData, GMModelStats, GMSummary } from '../src/gm/types';
import type { ModelPricing } from '../src/pricing-store';
import {
    buildPromptCacheTtlKey,
    classifyCacheMissCauses,
    classifyGmCallAnomalies,
    computeCallTelemetry,
    computeMeasuredModelCallPhases,
    computeStepCacheHitRate,
    computeStepSpeed,
    computeTelemetryAggregate,
    computeTelemetryAggregateFromModelStats,
    computeTelemetrySummary,
    computeWeightedSpeedMetric,
    evaluateModelCallSpeed,
    evaluatePromptCacheTtl,
    filterGmAnomalies,
    formatCachePercent,
    formatLatency,
    formatSpeed,
    isInternalCompactionCall,
    MIN_OUTPUT_TOKENS_FOR_SPEED,
    MIN_STREAM_SECONDS,
    PROMPT_CACHE_TTL_EXPIRE_SECONDS,
    PROMPT_CACHE_TTL_WARN_SECONDS,
    type PromptCacheTtlKey,
    PromptCacheTtlTracker,
    REP_MIN_OUTPUT_TOKENS,
    REP_MIN_STREAM_SECONDS,
    selectAggregateSpeedMetric,
} from '../src/telemetry-metrics';
import { mergeQuotaRunwayState3Way } from '../src/durable-state';
import { mergeGMCallEntries, parseGMEntry, parseOptionalNonNegInt } from '../src/gm/parser';
import { analyzeTurnDiagnostics } from '../src/turn-diagnostics';
import {
    buildWeeklyQuotaSeriesKey,
    getLocalDayDurationHours,
    mergeSerializedQuotaRunwayStates,
    projectQuotaDisplay,
    QuotaRunwayTracker,
    type TimezoneOffsetResolver,
} from '../src/quota-runway';
import {
    aggregateLedgerSwarmGroupCost,
    aggregateWorkspaceLeaderboard,
    DailyLedger,
    deriveWorkspaceDisplayLabel,
    type LedgerCallEntry,
    normalizeWorkspaceKey,
    UNATTRIBUTED_WORKSPACE_KEY,
} from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { buildGMSummaryFromLedger, flushLateDaysToDailyStore, performDailyArchivalAsync } from '../src/daily-archival';
import { ledgerDedupKey } from '../src/gm/tracker';
import type { ActivitySummary } from '../src/activity-tracker';
import * as vscode from 'vscode';
import { getLanguage, setLanguageToState, tBiHtml } from '../src/i18n';
import {
    extractOverviewTelemetry,
    formatCompactTokens,
    formatCreditExpiry,
    formatQuotaEffort,
    formatQuotaEfforts,
    formatSavingsUsd,
    getContextReading,
    getContextRemaining,
    MONITOR_COMMAND,
    resetCountdown,
    selectMonitorQuotaGroups,
} from '../src/monitor-overview';
import { StatusBarManager } from '../src/statusbar';
import type { ModelConfig } from '../src/models';
import type { ContextUsage } from '../src/tracker';
import { buildCalendarTabContent, getCalendarTabStyles } from '../src/webview-calendar-tab';
import { buildOverviewTabContent, getOverviewStyles } from '../src/webview-overview-tab';

describe('[telemetry-metrics]', () => {
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

            // When activeCascadeId has no matching conversation => stays strictly scoped to 'active' with empty aggregate (zero cross-conversation fallback)
            const withoutActive = computeTelemetrySummary(summary, { activeCascadeId: 'nonexistent' });
            expect(withoutActive.primaryScope).toBe('active');
            expect(withoutActive.active).toBeNull();
            expect(withoutActive.primary.totalCalls).toBe(0);
            expect(withoutActive.overall.totalCalls).toBe(3);

            // When activeCascadeId is omitted => session-wide scope uses overall aggregate
            const sessionWide = computeTelemetrySummary(summary);
            expect(sessionWide.primaryScope).toBe('session');
            expect(sessionWide.primary).toBe(sessionWide.overall);
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
            expect(res.primaryScope).toBe('active');
            expect(res.primary.totalCalls).toBe(0);
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
});

describe('[v118-telemetry-and-runway]', () => {
    const MIN = 60 * 1000;

    const HOUR = 60 * MIN;

    const DAY = 24 * HOUR;


    function localDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
        return new Date(y, m - 1, d, hh, mm, ss);
    }


    function localIso(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): string {
        return localDate(y, m, d, hh, mm, ss).toISOString();
    }


    function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-1',
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            responseModel: 'claude-opus-4-6-thinking',
            modelAccuracy: 'exact',
            inputTokens: 10_000,
            outputTokens: 500,
            thinkingTokens: 100,
            responseTokens: 400,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 1.0,
            streamingSeconds: 2.0,
            credits: 1,
            creditType: 'GOOGLE_ONE_AI',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 10_500,
            completionConfig: null,
            systemPromptSnippet: '',
            toolCount: 2,
            toolNames: ['read_file', 'run_command'],
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
            startStepIndex: 1,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 200_000,
            ...overrides,
        };
    }


    function makeActivitySummary(): ActivitySummary {
        return {
            totalUserInputs: 12,
            totalReasoning: 33,
            totalToolCalls: 17,
            totalErrors: 1,
            totalInputTokens: 9_000,
            totalOutputTokens: 2_400,
            totalToolReturnTokens: 800,
            estSteps: 74,
            modelStats: {
                'Claude Opus 4.6 (Thinking)': {
                    reasoning: 33,
                    toolCalls: 17,
                    inputTokens: 9_000,
                    outputTokens: 2_400,
                    toolReturnTokens: 800,
                    estSteps: 74,
                },
            },
            globalToolStats: { read_file: 17 },
            recentSteps: [],
            sessionStartTime: localIso(2026, 6, 10, 8, 0, 0),
            subAgentTokens: [],
            checkpointHistory: [],
            conversationBreakdown: [],
        };
    }


    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });


    // ─── 1. Prompt Cache Nullable Counts, 5m Idle TTL Heuristic & Miss Causes ───

    describe('v1.18.0 §5.2 #1 — Nullable cache counts, 5m idle TTL heuristic & possible miss causes', () => {
        it('preserves genuine absence (null) distinct from measured 0 in parseOptionalNonNegInt & parseGMEntry', () => {
            expect(parseOptionalNonNegInt(undefined)).toBeNull();
            expect(parseOptionalNonNegInt(null)).toBeNull();
            expect(parseOptionalNonNegInt('')).toBeNull();
            expect(parseOptionalNonNegInt('   ')).toBeNull();
            expect(parseOptionalNonNegInt('NaN')).toBeNull();
            expect(parseOptionalNonNegInt(-5)).toBeNull();
            expect(parseOptionalNonNegInt(Number.POSITIVE_INFINITY)).toBeNull();
            expect(parseOptionalNonNegInt(0)).toBe(0);
            expect(parseOptionalNonNegInt('0')).toBe(0);
            expect(parseOptionalNonNegInt('12345')).toBe(12345);

            const missingCache = parseGMEntry({
                executionId: 'exec-missing-cache',
                stepIndices: [1],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M26',
                    responseModel: 'claude-opus-4-6-thinking',
                    usage: {
                        inputTokens: '10000',
                        outputTokens: '500',
                    },
                    timeToFirstToken: '1.2s',
                    streamingDuration: '2.5s',
                },
            });
            expect(missingCache.cacheReadTokensNullable).toBeNull();
            expect(missingCache.cacheCreationTokensNullable).toBeNull();
            expect(missingCache.cacheTelemetryAvailable).toBe(false);
            // Numeric fields stay 0 for backward-compatible arithmetic callers
            expect(missingCache.cacheReadTokens).toBe(0);
            expect(missingCache.cacheCreationTokens).toBe(0);

            const measuredZeroCache = parseGMEntry({
                executionId: 'exec-zero-cache',
                stepIndices: [2],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M26',
                    responseModel: 'claude-opus-4-6-thinking',
                    usage: {
                        inputTokens: '10000',
                        outputTokens: '500',
                        cacheReadTokens: '0',
                        cacheCreationTokens: '0',
                    },
                    timeToFirstToken: '1.4s',
                    streamingDuration: '2.0s',
                },
            });
            expect(measuredZeroCache.cacheReadTokensNullable).toBe(0);
            expect(measuredZeroCache.cacheCreationTokensNullable).toBe(0);
            expect(measuredZeroCache.cacheTelemetryAvailable).toBe(true);

            // Downstream telemetry & turn diagnostics distinguish missing (null/unknown) from measured 0 (0%/cold)
            const ptMissing = computeCallTelemetry(missingCache);
            expect(ptMissing.cacheTelemetryAvailable).toBe(false);
            expect(ptMissing.cacheReadTokensMeasured).toBeNull();
            expect(ptMissing.promptCacheHitRate).toBeNull();
            expect(ptMissing.measuredReusePct).toBeNull();
            expect(ptMissing.cacheState).toBe('unknown');
            expect(ptMissing.promptCacheState).toBe('unknown');

            const ptZero = computeCallTelemetry(measuredZeroCache);
            expect(ptZero.cacheTelemetryAvailable).toBe(true);
            expect(ptZero.cacheReadTokensMeasured).toBe(0);
            expect(ptZero.promptCacheHitRate).toBe(0);
            expect(ptZero.measuredReusePct).toBe(0);
            expect(ptZero.cacheState).toBe('cold');
            expect(ptZero.promptCacheState).toBe('cold');

            const diag = analyzeTurnDiagnostics([missingCache, measuredZeroCache]);
            expect(diag.turns[0].cacheHitPct).toBeNull();
            expect(diag.turns[0].startKind).toBe('unknown');
            expect(diag.turns[1].cacheHitPct).toBe(0);
            expect(diag.turns[1].startKind).toBe('cold');

            // Unmeasured call must NOT dilute measured calls in aggregate ratios
            const measuredWarm = parseGMEntry({
                executionId: 'exec-warm-cache',
                stepIndices: [3],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M26',
                    responseModel: 'claude-opus-4-6-thinking',
                    usage: {
                        inputTokens: '2000',
                        outputTokens: '300',
                        cacheReadTokens: '8000',
                        cacheCreationTokens: '0',
                    },
                },
            });
            const agg = computeTelemetryAggregate([missingCache, measuredWarm]);
            expect(agg.cacheCoverage).toEqual({ measuredCount: 1, totalCount: 2, coverageRatio: 0.5 });
            expect(agg.tokenCacheHitRate).toBeCloseTo(0.8, 10);
            expect(agg.callCacheHitRate).toBeCloseTo(1.0, 10);

            // mergeGMCallEntries inherits measured cache counts from fallback when primary lacked them
            const merged = mergeGMCallEntries(missingCache, measuredWarm);
            expect(merged.cacheTelemetryAvailable).toBe(true);
            expect(merged.cacheReadTokensNullable).toBe(8000);
            expect(merged.cacheReadTokens).toBe(8000);

            // computeStepCacheHitRate preserves null when counts are explicitly null or unavailable
            expect(computeStepCacheHitRate(5000, null, null)).toBeNull();
            expect(computeStepCacheHitRate(5000, 0, 0, { cacheTelemetryAvailable: false })).toBeNull();
            expect(computeStepCacheHitRate(5000, 0, 0)).toBe(0);
        });

        it('enforces exact deterministic 180s / 300s boundaries and separates measuredReusePct from ttlEstimateState', () => {
            const key: PromptCacheTtlKey = {
                account: 'Alice@Example.com',
                backend: 'app-local-1',
                conversation: 'conv-1',
                model: 'claude-opus-4-6-thinking',
                branch: 'main',
            };
            const t0 = 1_750_000_000_000;

            expect(buildPromptCacheTtlKey(key)).toBe('alice@example.com|app-local-1|conv-1|claude-opus-4-6-thinking|main');

            // < 180s -> warm
            const warmStart = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0,
                measured: { inputTokens: 1000, cacheReadTokens: null, cacheCreationTokens: null, cacheTelemetryAvailable: false },
            });
            expect(warmStart.ttlEstimateState).toBe('warm');
            expect(warmStart.ttlSource).toBe('local_ttl_heuristic');
            expect(warmStart.idleSeconds).toBe(0);
            expect(warmStart.remainingTtlSeconds).toBe(PROMPT_CACHE_TTL_EXPIRE_SECONDS);
            expect(warmStart.measuredReusePct).toBeNull();
            expect(warmStart.measuredCacheState).toBe('unknown');

            const justBeforeWarn = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0 + (PROMPT_CACHE_TTL_WARN_SECONDS * 1000) - 1,
            });
            expect(justBeforeWarn.ttlEstimateState).toBe('warm');
            expect(justBeforeWarn.remainingTtlSeconds).toBeCloseTo(120.001, 3);

            // 180s <= idle < 300s -> cooling
            const exactWarn = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0 + PROMPT_CACHE_TTL_WARN_SECONDS * 1000,
            });
            expect(exactWarn.ttlEstimateState).toBe('cooling');
            expect(exactWarn.remainingTtlSeconds).toBe(120);

            const justBeforeExpire = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0 + (PROMPT_CACHE_TTL_EXPIRE_SECONDS * 1000) - 1,
            });
            expect(justBeforeExpire.ttlEstimateState).toBe('cooling');
            expect(justBeforeExpire.remainingTtlSeconds).toBeCloseTo(0.001, 3);

            // >= 300s -> cold (expired), remaining clamped to 0 (never negative)
            const exactExpire = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0 + PROMPT_CACHE_TTL_EXPIRE_SECONDS * 1000,
                measured: { inputTokens: 2000, cacheReadTokens: 8000, cacheCreationTokens: 0, cacheTelemetryAvailable: true },
            });
            expect(exactExpire.ttlEstimateState).toBe('cold');
            expect(exactExpire.remainingTtlSeconds).toBe(0);
            // Provider-observed reuse remains cleanly separated from local 5m timer!
            expect(exactExpire.measuredReusePct).toBeCloseTo(80, 6);
            expect(exactExpire.measuredCacheState).toBe('warm');
            // Provider actually served a warm cache hit -> no cache-miss cause fabricated!
            expect(exactExpire.missCause).toBeNull();

            const longIdle = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0 + 900 * 1000,
            });
            expect(longIdle.ttlEstimateState).toBe('cold');
            expect(longIdle.remainingTtlSeconds).toBe(0);
            expect(longIdle.missCause).toMatchObject({
                cause: 'idle_timeout',
                confidence: 'possible_cause',
            });
        });

        it('handles clock reversal and system suspend/resume jumps safely without negative countdowns', () => {
            const key: PromptCacheTtlKey = {
                account: 'alice@example.com',
                backend: 'app-local-1',
                conversation: 'conv-1',
                model: 'claude-opus-4-6-thinking',
                branch: 'main',
            };
            const t0 = 1_750_000_000_000;

            // Clock reversal (nowMs < lastEventMs)
            const reversed = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                nowMs: t0 - 15_000,
            });
            expect(reversed.clockAnomaly).toBe('clock_reversal');
            expect(reversed.ttlEstimateState).toBe('unknown');
            expect(reversed.idleSeconds).toBeNull();
            expect(reversed.remainingTtlSeconds).toBeNull();
            expect(reversed.shouldResetHeuristic).toBe(true);

            // Long system suspend (> 5m elapsed across sleep) -> cold, remaining = 0
            const longSuspend = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                previousNowMs: t0 + 10_000,
                nowMs: t0 + 420_000,
            });
            expect(longSuspend.clockAnomaly).toBe('suspend_resume');
            expect(longSuspend.ttlEstimateState).toBe('cold');
            expect(longSuspend.remainingTtlSeconds).toBe(0);
            expect(longSuspend.shouldResetHeuristic).toBe(true);

            // Short suspend / forward NTP clock jump (< 5m) -> unknown & reset heuristic
            const shortSuspend = evaluatePromptCacheTtl({
                key,
                lastEventMs: t0,
                previousNowMs: t0 + 5_000,
                nowMs: t0 + 120_000,
                suspendGapThresholdMs: 90_000,
            });
            expect(shortSuspend.clockAnomaly).toBe('suspend_resume');
            expect(shortSuspend.ttlEstimateState).toBe('unknown');
            expect(shortSuspend.remainingTtlSeconds).toBeNull();
            expect(shortSuspend.shouldResetHeuristic).toBe(true);

            // Stateful tracker clears reversed anchor cleanly
            const tracker = new PromptCacheTtlTracker();
            tracker.recordEvent({ key, eventMs: t0 });
            expect(tracker.evaluate({ key, nowMs: t0 + 60_000 }).ttlEstimateState).toBe('warm');
            const rev = tracker.evaluate({ key, nowMs: t0 - 5_000 });
            expect(rev.clockAnomaly).toBe('clock_reversal');
            expect(rev.ttlEstimateState).toBe('unknown');
            // After reset, subsequent eval without new anchor stays unknown
            expect(tracker.evaluate({ key, nowMs: t0 + 70_000 }).ttlEstimateState).toBe('unknown');
        });

        it('classifies cache-miss causes with confirmed_event vs possible_cause confidence tagging', () => {
            // Confirmed compaction ranks ahead of possible idle_timeout
            const compactionAndIdle = classifyCacheMissCauses({
                idleSeconds: 360,
                measuredReusePct: 2,
                hasMeasuredCacheTelemetry: true,
                ttlEstimateState: 'cold',
                transition: {
                    previousCheckpointIndex: 1,
                    currentCheckpointIndex: 2,
                },
            });
            expect(compactionAndIdle.missCause).toMatchObject({
                cause: 'compaction',
                confidence: 'confirmed_event',
            });
            expect(compactionAndIdle.possibleCauses).toEqual([
                expect.objectContaining({ cause: 'compaction', confidence: 'confirmed_event' }),
                expect.objectContaining({ cause: 'idle_timeout', confidence: 'possible_cause' }),
            ]);

            // Unconfirmed model switch -> possible_cause; confirmed model switch -> confirmed_event
            const unconfirmedSwitch = classifyCacheMissCauses({
                idleSeconds: 20,
                measuredReusePct: 0,
                hasMeasuredCacheTelemetry: true,
                ttlEstimateState: 'warm',
                transition: {
                    previousModel: 'claude-opus-4-6-thinking',
                    currentModel: 'gemini-4-neon',
                    modelSwitchConfirmed: false,
                },
            });
            expect(unconfirmedSwitch.missCause).toMatchObject({
                cause: 'model_switch',
                confidence: 'possible_cause',
            });

            const confirmedSwitch = classifyCacheMissCauses({
                idleSeconds: 20,
                measuredReusePct: 0,
                hasMeasuredCacheTelemetry: true,
                ttlEstimateState: 'warm',
                transition: {
                    previousModel: 'claude-opus-4-6-thinking',
                    currentModel: 'gemini-4-neon',
                    modelSwitchConfirmed: true,
                },
            });
            expect(confirmedSwitch.missCause).toMatchObject({
                cause: 'model_switch',
                confidence: 'confirmed_event',
            });

            // Confirmed branch change
            const branchChange = classifyCacheMissCauses({
                idleSeconds: 15,
                measuredReusePct: 0,
                hasMeasuredCacheTelemetry: true,
                ttlEstimateState: 'warm',
                transition: {
                    previousBranch: 'rev-1',
                    currentBranch: 'rev-2-rewind',
                    branchChangeConfirmed: true,
                },
            });
            expect(branchChange.missCause).toMatchObject({
                cause: 'branch_change',
                confidence: 'confirmed_event',
            });

            // Unexplained cold miss -> unknown (possible_cause)
            const unknownMiss = classifyCacheMissCauses({
                idleSeconds: 30,
                measuredReusePct: 0,
                hasMeasuredCacheTelemetry: true,
                ttlEstimateState: 'warm',
            });
            expect(unknownMiss.missCause).toEqual({
                cause: 'unknown',
                confidence: 'possible_cause',
            });
        });
    });


    // ─── 2. Model-Call Decode vs E2E Speed, Measured Phases & GM Anomaly Filters ─

    describe('v1.18.0 §5.2 #2 — Model-call Decode vs E2E speed, measured phases & GM anomaly filters', () => {
        it('distinguishes all 5 speed states (waiting, short_sample, missing, zero, measured) for Decode & model-call E2E', () => {
            const waiting = evaluateModelCallSpeed({
                outputTokens: 0,
                streamingSeconds: null,
                isStreaming: true,
                elapsedWaitSeconds: 1.8,
                mode: 'e2e',
            });
            expect(waiting.state).toBe('waiting');
            expect(waiting.decodeState).toBe('waiting');
            expect(waiting.e2eState).toBe('waiting');
            expect(waiting.waitingSeconds).toBe(1.8);
            expect(waiting.scope).toBe('model_call');

            const shortSample = evaluateModelCallSpeed({
                outputTokens: 8,
                streamingSeconds: 0.2,
                ttftSeconds: 0.8,
                mode: 'e2e',
            });
            expect(shortSample.decodeState).toBe('short_sample');
            expect(shortSample.e2eState).toBe('short_sample');
            expect(shortSample.displaySpeed).toBeNull();
            expect(shortSample.decodeRawSpeed).toBeCloseTo(40, 6);
            expect(shortSample.e2eRawSpeed).toBeCloseTo(8 / 1.0, 6);

            const missingTtft = evaluateModelCallSpeed({
                outputTokens: 200,
                streamingSeconds: 2.0,
                ttftSeconds: null,
                mode: 'e2e',
            });
            expect(missingTtft.decodeState).toBe('measured');
            expect(missingTtft.decodeDisplaySpeed).toBeCloseTo(100, 6);
            // E2E must remain 'missing' when TTFT is absent (never fabricate TTFT = 0!)
            expect(missingTtft.e2eState).toBe('missing');
            expect(missingTtft.e2eDisplaySpeed).toBeNull();

            const zeroMeasured = evaluateModelCallSpeed({
                outputTokens: 0,
                streamingSeconds: 0.8,
                ttftSeconds: 0.5,
                isStreaming: false,
                mode: 'e2e',
            });
            expect(zeroMeasured.decodeState).toBe('zero');
            expect(zeroMeasured.e2eState).toBe('zero');
            expect(zeroMeasured.displaySpeed).toBe(0);

            const measured = evaluateModelCallSpeed({
                outputTokens: 400,
                streamingSeconds: 4.0,
                ttftSeconds: 1.0,
                mode: 'e2e',
            });
            expect(measured.decodeState).toBe('measured');
            expect(measured.decodeDisplaySpeed).toBeCloseTo(100, 6);
            expect(measured.e2eState).toBe('measured');
            expect(measured.e2eDisplaySpeed).toBeCloseTo(80, 6); // 400 / (1.0 + 4.0)
            expect(measured.measuredPhases).toEqual({
                ttftMs: 1000,
                streamingMs: 4000,
                modelCallTotalMs: 5000,
                ttftSharePct: 20,
                streamingSharePct: 80,
                phaseSource: 'measured_only',
                scope: 'model_call',
            });
        });

        it('never synthesizes fake disjoint thinking/tool phase durations from tool names or thinking tokens', () => {
            const call = makeCall({
                thinkingTokens: 300,
                toolNames: ['read_file', 'run_command', 'grep_search'],
                toolCount: 3,
                ttftSeconds: 1.25,
                streamingSeconds: 3.75,
            });
            const phases = computeMeasuredModelCallPhases(call);
            expect(phases.phaseSource).toBe('measured_only');
            expect(phases.scope).toBe('model_call');
            expect(phases.ttftMs).toBe(1250);
            expect(phases.streamingMs).toBe(3750);
            expect(phases.modelCallTotalMs).toBe(5000);
            expect('thinkingMs' in (phases as unknown as Record<string, unknown>)).toBe(false);
            expect('toolMs' in (phases as unknown as Record<string, unknown>)).toBe(false);

            const pt = computeCallTelemetry(call);
            expect(pt.measuredPhases).toEqual(phases);
        });

        it('computes ratio-of-sums weighted Decode & E2E speed with exact coverage metadata (e.g. 12/15 calls)', () => {
            const calls: GMCallEntry[] = [];
            // 10 calls with BOTH valid decode and TTFT: 100 tok in 1s stream + 1s TTFT
            for (let i = 0; i < 10; i++) {
                calls.push(makeCall({
                    executionId: `full-${i}`,
                    outputTokens: 100,
                    streamingSeconds: 1.0,
                    ttftSeconds: 1.0,
                    createdAt: `2026-10-15T10:${String(i).padStart(2, '0')}:00.000Z`,
                }));
            }
            // 2 calls with valid decode ONLY (missing TTFT): 500 tok in 5s stream (100 tok/s)
            for (let i = 0; i < 2; i++) {
                calls.push(makeCall({
                    executionId: `decode-only-${i}`,
                    outputTokens: 500,
                    streamingSeconds: 5.0,
                    ttftSeconds: 0,
                    createdAt: `2026-10-15T10:${String(10 + i).padStart(2, '0')}:00.000Z`,
                }));
            }
            // 3 calls missing valid decode timing (1-token jitter / zero duration)
            for (let i = 0; i < 3; i++) {
                calls.push(makeCall({
                    executionId: `invalid-${i}`,
                    outputTokens: 1,
                    streamingSeconds: 0.01,
                    ttftSeconds: 0.5,
                    createdAt: `2026-10-15T10:${String(12 + i).padStart(2, '0')}:00.000Z`,
                }));
            }

            const agg = computeTelemetryAggregate(calls);
            expect(agg.speedMetricScope).toBe('model_call');
            expect(agg.decodeSpeedCoverage).toEqual({ measuredCount: 12, totalCount: 15, coverageRatio: 12 / 15 });
            expect(agg.e2eSpeedCoverage).toEqual({ measuredCount: 10, totalCount: 15, coverageRatio: 10 / 15 });
            expect(agg.weightedGenTokPerSec).toBeCloseTo(2000 / 20, 10);
            expect(agg.weightedEndToEndTokPerSec).toBeCloseTo(1000 / 20, 10);

            const decodeMetric = computeWeightedSpeedMetric(calls, 'decode');
            expect(decodeMetric.coverage).toEqual({ measuredCount: 12, totalCount: 15, coverageRatio: 12 / 15 });
            expect(decodeMetric.weightedTokPerSec).toBeCloseTo(100, 10);
            expect(decodeMetric.sumOutputTokens).toBe(2000);
            expect(decodeMetric.sumDurationSeconds).toBe(20);

            const e2eMetric = computeWeightedSpeedMetric(calls, 'e2e');
            expect(e2eMetric.coverage).toEqual({ measuredCount: 10, totalCount: 15, coverageRatio: 10 / 15 });
            expect(e2eMetric.weightedTokPerSec).toBeCloseTo(50, 10);
            expect(e2eMetric.sumOutputTokens).toBe(1000);
            expect(e2eMetric.sumDurationSeconds).toBe(20);

            expect(selectAggregateSpeedMetric(agg, 'e2e').coverage).toEqual(agg.e2eSpeedCoverage);
        });

        it('filters GM anomalies cleanly across all 6 kinds without false cache-miss flags on missing cache counts', () => {
            const cleanCall = makeCall({
                executionId: 'clean',
                inputTokens: 1_000,
                cacheReadTokens: 9_000,
                outputTokens: 200,
                ttftSeconds: 0.9,
                contextTokensUsed: 10_000,
                contextWindowCapacity: 200_000,
            });
            const retry429Call = makeCall({
                executionId: 'retry-429',
                retries: 2,
                retryErrors: ['RESOURCE_EXHAUSTED (code 429): rate limit'],
                cacheReadTokens: 9_000,
                inputTokens: 1_000,
            });
            const slowTtftColdCall = makeCall({
                executionId: 'slow-cold',
                ttftSeconds: 7.5,
                inputTokens: 15_000,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
            });
            const missingCacheCall = parseGMEntry({
                executionId: 'missing-cache-only',
                stepIndices: [5],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M26',
                    responseModel: 'claude-opus-4-6-thinking',
                    usage: { inputTokens: '15000', outputTokens: '100' },
                    timeToFirstToken: '1.0s',
                    streamingDuration: '1.0s',
                },
            });
            const highCostHighCtxTruncated = makeCall({
                executionId: 'expensive-ctx-trunc',
                inputTokens: 120_000,
                cacheReadTokens: 100_000,
                outputTokens: 5_000,
                contextTokensUsed: 220_000,
                contextWindowCapacity: 256_000,
                stopReason: 'STOP_REASON_MAX_TOKENS',
            });

            // Missing cache counts MUST NOT trigger 'cache_miss'
            expect(classifyGmCallAnomalies(missingCacheCall).anomalies).not.toContain('cache_miss');

            const allResult = filterGmAnomalies([
                cleanCall,
                retry429Call,
                slowTtftColdCall,
                missingCacheCall,
                highCostHighCtxTruncated,
            ]);
            expect(allResult.totalInspected).toBe(5);
            expect(allResult.matchedCount).toBe(3);
            expect(allResult.countsByKind).toEqual({
                error_or_retry: 1,
                slow_ttft: 1,
                cache_miss: 1,
                high_cost: 1,
                high_context: 1,
                non_200_or_truncated: 2,
            });

            const strictCombo = filterGmAnomalies(
                [cleanCall, retry429Call, slowTtftColdCall, highCostHighCtxTruncated],
                { kinds: ['high_cost', 'high_context', 'non_200_or_truncated'], matchMode: 'all' },
            );
            expect(strictCombo.matches.map(m => m.callId)).toEqual(['expensive-ctx-trunc']);
        });
    });


    // ─── 3. Persistent Bounded Weekly Active-Hours Quota Runway & Projection ────

    describe('v1.18.0 §5.2 #3 — Persistent weekly active-hours quota runway & 5h/7d/tightest projection', () => {
        it('returns insufficient_history below minimum weekly coverage (including 45m window) and isolates idle hours', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = Date.UTC(2026, 9, 12, 10, 0, 0); // Mon 10:00 UTC
            const reset7d = t0 + 7 * DAY;

            // Only 45 minutes of data -> MUST be insufficient_history for weekly forecast
            tracker.recordWeeklyObservation({
                account: 'alice@example.com',
                pool: 'claude',
                window: '7d',
                remainingFraction: 1.0,
                timestampMs: t0,
                resetTimeMs: reset7d,
                surface: 'app',
            });
            tracker.recordWeeklyObservation({
                account: 'alice@example.com',
                pool: 'claude',
                window: '7d',
                remainingFraction: 0.90,
                timestampMs: t0 + 45 * MIN,
                resetTimeMs: reset7d,
                surface: 'app',
            });
            const tooShort = tracker.estimateWeekly(
                { account: 'alice@example.com', pool: 'claude', window: '7d' },
                t0 + 45 * MIN,
            );
            expect(tooShort.status).toBe('insufficient_history');
            expect(tooShort.coverage.meetsThreshold).toBe(false);

            // Continue Day 1 active up to 2h total (20% burned in 2 active hours = 10%/active-hr)
            tracker.recordWeeklyObservation({
                account: 'alice@example.com',
                pool: 'claude',
                window: '7d',
                remainingFraction: 0.80,
                timestampMs: t0 + 2 * HOUR,
                resetTimeMs: reset7d,
                surface: 'app',
            });
            // Add 6 idle hours on Day 1 (flat 0.80, userActivityEvidence: false) — MUST NOT dilute active burn rate!
            for (let h = 3; h <= 8; h++) {
                tracker.recordWeeklyObservation({
                    account: 'alice@example.com',
                    pool: 'claude',
                    window: '7d',
                    remainingFraction: 0.80,
                    timestampMs: t0 + h * HOUR,
                    resetTimeMs: reset7d,
                    userActivityEvidence: false,
                    surface: 'app',
                });
            }
            // Day 2 (26h later = offline gap > 2h): 2 more active hours burning another 20% (0.80 -> 0.60)
            const d2Start = t0 + DAY;
            tracker.recordWeeklyObservation({
                account: 'alice@example.com',
                pool: 'claude',
                window: '7d',
                remainingFraction: 0.80,
                timestampMs: d2Start,
                resetTimeMs: reset7d,
                surface: 'app',
            });
            tracker.recordWeeklyObservation({
                account: 'alice@example.com',
                pool: 'claude',
                window: '7d',
                remainingFraction: 0.70,
                timestampMs: d2Start + 1 * HOUR,
                resetTimeMs: reset7d,
                surface: 'app',
            });
            tracker.recordWeeklyObservation({
                account: 'alice@example.com',
                pool: 'claude',
                window: '7d',
                remainingFraction: 0.60,
                timestampMs: d2Start + 2 * HOUR,
                resetTimeMs: reset7d,
                surface: 'app',
            });

            const est = tracker.estimateWeekly(
                { account: 'alice@example.com', pool: 'claude', window: '7d' },
                d2Start + 2 * HOUR,
                { tzOffsetResolver: () => 0 },
            );
            expect(est.coverage.meetsThreshold).toBe(true);
            expect(est.coverage.activeHours).toBeCloseTo(4, 2);
            expect(est.coverage.activeDays).toBe(2);
            expect(est.offlineGapCount).toBeGreaterThanOrEqual(1);
            // 40% burned over 4 active hours = 10%/active-hr (idle & offline hours excluded!)
            expect(est.burnRatePctPerActiveHour).toBeCloseTo(10, 1);
            expect(est.avgActiveHoursPerDay).toBeCloseTo(2, 1);
            expect(est.projectedDailyBurnPct).toBeCloseTo(20, 1);
            // 60% remaining / 10%/hr = 6 active hours => at 2 active hrs/day = 3 days < 5.92 days to reset => at_risk!
            expect(est.estRemainingActiveHours).toBeCloseTo(6, 1);
            expect(est.estExhaustMs).toBeCloseTo(3 * DAY, -4);
            expect(est.status).toBe('at_risk');
        });

        it('deduplicates concurrent App + IDE observations both live and across state merges without double-counting', () => {
            const t0 = Date.UTC(2026, 9, 12, 10, 0, 0);
            const reset7d = t0 + 7 * DAY;

            // 1. Live interleaved App + IDE polls with slight timestamp jitter and stale peer fraction
            const live = new QuotaRunwayTracker({ tzOffsetResolver: () => 0 });
            live.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.90, timestampMs: t0, resetTimeMs: reset7d, surface: 'app' });
            live.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.90, timestampMs: t0 + 2_000, resetTimeMs: reset7d + 15_000, surface: 'ide' });
            live.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.80, timestampMs: t0 + 30 * MIN, resetTimeMs: reset7d, surface: 'app' });
            // Slightly stale IDE poll reporting 0.82 right after App already saw 0.80, then 0.80
            live.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.82, timestampMs: t0 + 30 * MIN + 1_000, resetTimeMs: reset7d, surface: 'ide' });
            live.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.80, timestampMs: t0 + 30 * MIN + 3_000, resetTimeMs: reset7d, surface: 'ide' });

            const liveSeries = live.getWeeklySeries({ account: 'u@x.com', pool: 'gemini', window: '7d', resetEpoch: reset7d })!;
            expect(liveSeries.buckets).toHaveLength(1);
            expect(liveSeries.buckets[0].burnFraction).toBeCloseTo(0.10, 6);
            expect(liveSeries.buckets[0].surfaces).toEqual(['app', 'ide']);

            // 2. Two independent trackers (App & IDE) observing the same drop + one disjoint drop -> merge is idempotent
            const appTracker = new QuotaRunwayTracker({ tzOffsetResolver: () => 0 });
            const ideTracker = new QuotaRunwayTracker({ tzOffsetResolver: () => 0 });
            appTracker.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.90, timestampMs: t0, resetTimeMs: reset7d, surface: 'app' });
            appTracker.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.80, timestampMs: t0 + 30 * MIN, resetTimeMs: reset7d, surface: 'app' });

            ideTracker.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.90, timestampMs: t0 + 1_000, resetTimeMs: reset7d + 15_000, surface: 'ide' });
            ideTracker.recordWeeklyObservation({ account: 'u@x.com', pool: 'gemini', window: '7d', remainingFraction: 0.80, timestampMs: t0 + 30 * MIN + 2_000, resetTimeMs: reset7d + 15_000, surface: 'ide' });

            const merged1 = mergeSerializedQuotaRunwayStates(appTracker.serialize(), ideTracker.serialize());
            const merged2 = mergeSerializedQuotaRunwayStates(merged1, ideTracker.serialize());
            const key = buildWeeklyQuotaSeriesKey({ account: 'u@x.com', pool: 'gemini', window: '7d', resetEpoch: reset7d });
            // App saw 30m (1_800_000ms), IDE saw 30m+1s (1_801_000ms) -> union max is 30m+1s (NEVER 60m+1s!), burn is 0.10 (NEVER 0.20!)
            expect(merged1.weeklyBuckets![key].buckets[0].burnFraction).toBeCloseTo(0.10, 6);
            expect(merged1.weeklyBuckets![key].buckets[0].activeMs).toBe(30 * MIN + 1_000);
            expect(merged2.weeklyBuckets![key].buckets[0].burnFraction).toBeCloseTo(0.10, 6);
            expect(merged2.weeklyBuckets![key].buckets[0].activeMs).toBe(30 * MIN + 1_000);

            const mergedOnDisk = mergeQuotaRunwayState3Way(undefined, { ...ideTracker.serialize() }, { ...appTracker.serialize() });
            expect(mergedOnDisk.weeklyBuckets).toEqual(merged1.weeklyBuckets);
            expect(Object.keys(merged1.weeklyBuckets!)).toEqual([key]);
            const afterReset = mergeQuotaRunwayState3Way(mergedOnDisk, mergedOnDisk, { version: 1, pools: {} });
            expect(afterReset.weeklyBuckets).toBeUndefined();

            // Verify strict bucket & series bounding + exhausted/custom_model_isolated weekly states
            const bounded = new QuotaRunwayTracker({
                maxWeeklyHourlyBuckets: 24,
                maxWeeklySeries: 2,
                tzOffsetResolver: () => 0,
            });
            for (let h = 0; h < 40; h++) {
                bounded.recordWeeklyObservation({
                    account: 'u@x.com',
                    pool: 'pool-a',
                    window: '7d',
                    remainingFraction: Math.max(0.1, 1 - h * 0.01),
                    timestampMs: t0 + h * HOUR,
                    resetTimeMs: reset7d,
                });
            }
            expect(bounded.getWeeklySeries({ account: 'u@x.com', pool: 'pool-a', window: '7d', resetEpoch: reset7d })!.buckets.length).toBeLessThanOrEqual(24);
            bounded.recordWeeklyObservation({ account: 'u@x.com', pool: 'pool-b', window: '7d', remainingFraction: 0.5, timestampMs: t0 + 41 * HOUR, resetTimeMs: reset7d });
            bounded.recordWeeklyObservation({ account: 'u@x.com', pool: 'pool-c', window: '7d', remainingFraction: 0.0, timestampMs: t0 + 42 * HOUR, resetTimeMs: reset7d });
            expect(bounded.listWeeklySeries().length).toBeLessThanOrEqual(2);
            expect(bounded.estimateWeekly({ account: 'u@x.com', pool: 'pool-c', window: '7d' }, t0 + 42 * HOUR).status).toBe('exhausted');
            expect(bounded.estimateWeekly({ account: 'u@x.com', pool: 'pool-c', window: '7d' }, t0 + 42 * HOUR, { modelId: 'byok-openai-o3' }).status).toBe('custom_model_isolated');
        });

        it('handles fractional resets, overnight sessions, DST 23h/25h days, and v1 backward-compatible serialization', () => {
            // US Eastern DST 2026:
            // Spring forward: 2026-03-08 02:00 EST (07:00Z) -> offset +300 becomes +240 (23h day)
            // Fall back:      2026-11-01 02:00 EDT (06:00Z) -> offset +240 becomes +300 (25h day)
            const usEasternTz: TimezoneOffsetResolver = (tsMs: number) => {
                const springUtc = Date.UTC(2026, 2, 8, 7, 0, 0);
                const fallUtc = Date.UTC(2026, 10, 1, 6, 0, 0);
                return tsMs >= springUtc && tsMs < fallUtc ? 240 : 300;
            };

            expect(getLocalDayDurationHours('2026-03-08', usEasternTz)).toBe(23);
            expect(getLocalDayDurationHours('2026-06-15', usEasternTz)).toBe(24);
            expect(getLocalDayDurationHours('2026-11-01', usEasternTz)).toBe(25);

            const tracker = new QuotaRunwayTracker({ tzOffsetResolver: usEasternTz });
            const resetEpoch = Date.UTC(2026, 10, 8, 5, 0, 0);

            // Overnight session crossing local midnight 2026-10-31 23:30 EDT (03:30Z) -> 2026-11-01 00:30 EDT (04:30Z)
            const oct31_2330 = Date.UTC(2026, 10, 1, 3, 30, 0);
            const nov01_0030 = Date.UTC(2026, 10, 1, 4, 30, 0);
            // Fall-back repeated 01:00 local hour: 05:00Z (01:00 EDT) and 06:00Z (01:00 EST) -> TWO distinct UTC hours!
            const nov01_0130_edt = Date.UTC(2026, 10, 1, 5, 30, 0);
            const nov01_0130_est = Date.UTC(2026, 10, 1, 6, 30, 0);
            const nov01_0230_est = Date.UTC(2026, 10, 1, 7, 30, 0);

            tracker.recordWeeklyObservation({ account: 'a@b.com', pool: 'claude', window: '7d', remainingFraction: 0.90, timestampMs: oct31_2330, resetTimeMs: resetEpoch });
            tracker.recordWeeklyObservation({ account: 'a@b.com', pool: 'claude', window: '7d', remainingFraction: 0.80, timestampMs: nov01_0030, resetTimeMs: resetEpoch });
            tracker.recordWeeklyObservation({ account: 'a@b.com', pool: 'claude', window: '7d', remainingFraction: 0.70, timestampMs: nov01_0130_edt, resetTimeMs: resetEpoch });
            // Fractional reset (+15% jump: 0.70 -> 0.85) mid-session!
            tracker.recordWeeklyObservation({ account: 'a@b.com', pool: 'claude', window: '7d', remainingFraction: 0.85, timestampMs: nov01_0130_est, resetTimeMs: resetEpoch });
            tracker.recordWeeklyObservation({ account: 'a@b.com', pool: 'claude', window: '7d', remainingFraction: 0.75, timestampMs: nov01_0230_est, resetTimeMs: resetEpoch });

            const est = tracker.estimateWeekly(
                { account: 'a@b.com', pool: 'claude', window: '7d' },
                nov01_0230_est,
                { minSpanHours: 3, tzOffsetResolver: usEasternTz },
            );
            expect(est.fractionalResetCount).toBe(1);
            expect(est.dailySummaries.map(d => [d.localDateKey, d.dayDurationHours])).toEqual([
                ['2026-10-31', 24],
                ['2026-11-01', 25],
            ]);
            // Overnight split gave 0.5h on Oct 31 and remaining active hours on Nov 1 without losing prior burn across fractional reset!
            expect(est.dailySummaries[0].activeHours).toBeCloseTo(0.5, 2);
            expect(est.dailySummaries[0].burnFraction).toBeCloseTo(0.05, 4);
            // Total burn: 0.10 (overnight) + 0.10 (01:30 EDT) + 0.10 (after fractional reset) = 0.30
            const totalDailyBurn = est.dailySummaries.reduce((s, d) => s + d.burnFraction, 0);
            expect(totalDailyBurn).toBeCloseTo(0.30, 4);

            // Round-trip serialize/deserialize preserves weekly buckets cleanly
            const rawJson = JSON.stringify(tracker.serialize());
            const restored = QuotaRunwayTracker.deserialize(JSON.parse(rawJson), { tzOffsetResolver: usEasternTz });
            expect(restored.estimateWeekly(
                { account: 'a@b.com', pool: 'claude', window: '7d' },
                nov01_0230_est,
                { minSpanHours: 3, tzOffsetResolver: usEasternTz },
            )).toEqual(est);

            // Legacy v1 snapshot without weeklyBuckets restores safely
            const legacyV1 = {
                version: 1,
                pools: {
                    claude: {
                        poolKey: 'claude',
                        samples: [
                            { remainingFraction: 0.9, timestampMs: oct31_2330, resetTimeMs: resetEpoch },
                            { remainingFraction: 0.8, timestampMs: oct31_2330 + 15 * MIN, resetTimeMs: resetEpoch },
                        ],
                        lastObservedAtMs: oct31_2330 + 15 * MIN,
                        lastResetTimeMs: resetEpoch,
                        recoveredAtMs: null,
                    },
                },
            };
            const fromLegacy = QuotaRunwayTracker.deserialize(legacyV1);
            expect(fromLegacy.estimate('claude', oct31_2330 + 15 * MIN).burnRatePctPerHour).toBeCloseTo(40, 1);
            expect(fromLegacy.estimateWeekly({ account: 'a@b.com', pool: 'claude', window: '7d' }).status).toBe('insufficient_history');
        });

        it.each([
            [0.71, 0.71, '5h', 71, '5 小时配额剩余'],
            [null, 0.71, '7d', 71, '每周配额剩余'],
            [0, undefined, '5h', 0, '5 小时配额剩余'],
            [1.2, -0.5, null, null, '配额暂无数据'],
        ] as const)('describes the observed window for automatic selection with %s and %s', (fiveHour, weekly, window, pct, zh) => {
            const projection = projectQuotaDisplay({
                windowMode: 'tightest', directionMode: 'remaining',
                window5h: { remainingFraction: fiveHour }, window7d: { remainingFraction: weekly },
            });
            expect(projection).toMatchObject({ effectiveWindow: window, displayPct: pct, metricLabelZh: zh });
        });

        it('projects 5h, 7d, and tightest quota percentages cleanly for remaining and used modes with explicit tags', () => {
            const now = 1_750_000_000_000;
            const r5h = now + 2 * HOUR;
            const r7d = now + 4 * DAY;

            // Tightest picks 7d (0.25 remaining < 0.60 remaining)
            const tightRem = projectQuotaDisplay({
                windowMode: 'tightest',
                directionMode: 'remaining',
                window5h: { remainingFraction: 0.60, resetTimeMs: r5h },
                window7d: { remainingFraction: 0.25, resetTimeMs: r7d },
                nowMs: now,
            });
            expect(tightRem).toMatchObject({
                effectiveWindow: '7d',
                selectedByTightest: true,
                windowTag: '7d',
                remainingPct: 25,
                usedPct: 75,
                displayPct: 25,
                directionLabelEn: 'Remaining',
                directionLabelZh: '剩余',
                windowLabelEn: 'Weekly quota',
                windowLabelZh: '每周配额',
                timeToResetMs: 4 * DAY,
                isUnavailable: false,
            });

            // Direction = used
            const used5h = projectQuotaDisplay({
                windowMode: '5h',
                directionMode: 'used',
                window5h: { remainingFraction: 0.60, resetTimeMs: r5h },
                window7d: { remainingFraction: 0.25, resetTimeMs: r7d },
                nowMs: now,
            });
            expect(used5h).toMatchObject({
                effectiveWindow: '5h',
                windowTag: '5h',
                remainingPct: 60,
                usedPct: 40,
                displayPct: 40,
                directionLabelEn: 'Used',
                directionLabelZh: '已用',
                windowLabelEn: '5-hour quota',
                windowLabelZh: '5 小时配额',
                isUnavailable: false,
            });

            // Missing requested window stays unavailable (NEVER fabricates 100% or silently swaps windows!)
            const missing7d = projectQuotaDisplay({
                windowMode: '7d',
                directionMode: 'remaining',
                window5h: { remainingFraction: 0.80, resetTimeMs: r5h },
                window7d: { remainingFraction: null },
                nowMs: now,
            });
            expect(missing7d.isUnavailable).toBe(true);
            expect(missing7d.displayPct).toBeNull();
            expect(missing7d.effectiveWindow).toBeNull();
            expect(missing7d.windowTag).toBeNull();
        });

        it('P2-11: prevents delayed lower-reading double-counts and excludes offline-gap drops from active burn rate', () => {
            const t0 = Date.UTC(2026, 9, 12, 10, 0, 0);
            const reset7d = t0 + 7 * DAY;

            // 1. Delayed lower reading must lower series.lastFraction so subsequent in-order polls do NOT double-count
            const delayed = new QuotaRunwayTracker({ tzOffsetResolver: () => 0 });
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.80, timestampMs: t0, resetTimeMs: reset7d, surface: 'app' });
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.70, timestampMs: t0 + 30 * MIN, resetTimeMs: reset7d, surface: 'app' });
            // Out-of-order delayed IDE poll from t0+29m reveals a lower reading (0.65)
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.65, timestampMs: t0 + 29 * MIN, resetTimeMs: reset7d, surface: 'ide' });
            // Next in-order App poll at t0+35m observes 0.65, then 0.60 at t0+45m
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.65, timestampMs: t0 + 35 * MIN, resetTimeMs: reset7d, surface: 'app' });
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.60, timestampMs: t0 + 45 * MIN, resetTimeMs: reset7d, surface: 'app' });

            const delayedSeries = delayed.getWeeklySeries({ account: 'u@x.com', pool: 'claude', window: '7d', resetEpoch: reset7d })!;
            expect(delayedSeries.buckets).toHaveLength(1);
            // Total drop 0.80 -> 0.60 MUST be exact 0.20 (NOT 0.25!)
            expect(delayedSeries.buckets[0].burnFraction).toBeCloseTo(0.20, 6);
            expect(delayedSeries.lastFraction).toBeCloseTo(0.60, 6);

            // Also verify delayed reading for an earlier hour above series.lastFraction does not double-count
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.50, timestampMs: t0 + 75 * MIN, resetTimeMs: reset7d, surface: 'app' });
            delayed.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.55, timestampMs: t0 + 50 * MIN, resetTimeMs: reset7d, surface: 'ide' });
            const afterHour2 = delayed.getWeeklySeries({ account: 'u@x.com', pool: 'claude', window: '7d', resetEpoch: reset7d })!;
            const totalBurnAcross2Hours = afterHour2.buckets.reduce((s, b) => s + b.burnFraction, 0);
            expect(totalBurnAcross2Hours).toBeCloseTo(0.30, 6);

            // 2. Offline-gap drop (e.g., quota spent on another machine while laptop slept) must NOT inflate burnRatePctPerActiveHour
            const offline = new QuotaRunwayTracker({ tzOffsetResolver: () => 0 });
            // Day 1: 2 active hours burning 20% (1.00 -> 0.80 = 10%/active-hr)
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 1.00, timestampMs: t0, resetTimeMs: reset7d, surface: 'app' });
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.90, timestampMs: t0 + 1 * HOUR, resetTimeMs: reset7d, surface: 'app' });
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.80, timestampMs: t0 + 2 * HOUR, resetTimeMs: reset7d, surface: 'app' });
            // Day 2 (24h later = offline gap): quota dropped 30% while offline (0.80 -> 0.50), then 2 active hours burn 20% (0.50 -> 0.30 = 10%/active-hr)
            const d2 = t0 + DAY;
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.50, timestampMs: d2, resetTimeMs: reset7d, surface: 'app' });
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.40, timestampMs: d2 + 1 * HOUR, resetTimeMs: reset7d, surface: 'app' });
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.30, timestampMs: d2 + 2 * HOUR, resetTimeMs: reset7d, surface: 'app' });
            // Day 3 (another 24h offline gap): single wake observation showing 0.20 (offline drop 0.10, ZERO active hours)
            const d3 = t0 + 2 * DAY;
            offline.recordWeeklyObservation({ account: 'u@x.com', pool: 'claude', window: '7d', remainingFraction: 0.20, timestampMs: d3, resetTimeMs: reset7d, surface: 'app' });

            const est = offline.estimateWeekly({ account: 'u@x.com', pool: 'claude', window: '7d' }, d3, { tzOffsetResolver: () => 0 });
            expect(est.coverage.meetsThreshold).toBe(true);
            expect(est.coverage.activeHours).toBeCloseTo(4, 2);
            // Day 3 wake-only offline drop MUST NOT add a 0h active day that dilutes avgActiveHoursPerDay!
            expect(est.coverage.activeDays).toBe(2);
            expect(est.avgActiveHoursPerDay).toBeCloseTo(2, 2);
            // Online active burn rate MUST stay 10%/active-hr (NOT inflated by the 30% + 10% offline drops!)
            expect(est.burnRatePctPerActiveHour).toBeCloseTo(10, 1);
            expect(est.latestRemainingFraction).toBeCloseTo(0.20, 4);

            // Round-trip serialize/deserialize and cross-host merge must preserve offlineBurnFraction without folding into burnFraction
            const roundTripped = QuotaRunwayTracker.deserialize(JSON.parse(JSON.stringify(offline.serialize())), { tzOffsetResolver: () => 0 });
            const merged = mergeSerializedQuotaRunwayStates(offline.serialize(), roundTripped.serialize());
            const mergedTracker = QuotaRunwayTracker.deserialize(merged, { tzOffsetResolver: () => 0 });
            const mergedEst = mergedTracker.estimateWeekly({ account: 'u@x.com', pool: 'claude', window: '7d' }, d3, { tzOffsetResolver: () => 0 });
            expect(mergedEst.burnRatePctPerActiveHour).toBeCloseTo(10, 1);
            expect(mergedEst.coverage.activeDays).toBe(2);
            const mergedSeries = mergedTracker.getWeeklySeries({ account: 'u@x.com', pool: 'claude', window: '7d', resetEpoch: reset7d })!;
            const offlineSum = mergedSeries.buckets.reduce((s, b) => s + (b.offlineBurnFraction ?? 0), 0);
            expect(offlineSum).toBeCloseTo(0.40, 6);
        });
    });


    // ─── 4. Workspace Attribution at Ingestion, W1A 100->102 & Swarm Cost Parity ─

    describe('v1.18.0 §5.2 #5 — Ingestion-time workspace attribution, Unattributed & Swarm group costs', () => {
        it('normalizes workspace keys preserving case & remote authority and mapping absent workspaces to __unattributed__', () => {
            expect(normalizeWorkspaceKey(undefined)).toBe(UNATTRIBUTED_WORKSPACE_KEY);
            expect(normalizeWorkspaceKey('')).toBe(UNATTRIBUTED_WORKSPACE_KEY);
            expect(normalizeWorkspaceKey('/Users/dev/RepoA/')).toBe('/Users/dev/RepoA');
            expect(normalizeWorkspaceKey('/Users/dev/repoa')).not.toBe(normalizeWorkspaceKey('/Users/dev/RepoA'));
            expect(normalizeWorkspaceKey('/home/dev/app', 'wsl+ubuntu')).toBe('wsl+ubuntu::/home/dev/app');
            expect(normalizeWorkspaceKey('/home/dev/app', 'wsl+debian')).toBe('wsl+debian::/home/dev/app');
            expect(deriveWorkspaceDisplayLabel(UNATTRIBUTED_WORKSPACE_KEY)).toBe('Unattributed');
            expect(deriveWorkspaceDisplayLabel('wsl+ubuntu::/home/dev/app')).toBe('app (wsl+ubuntu)');
        });

        it('preserves ingestion-time attribution across settlement, conversation deletion, archival & W1A 100->102 late-day merge', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 10, 23, 50, 0));

            const ledger = new DailyLedger('2026-06-10', 'app');
            const entries: LedgerCallEntry[] = [];
            for (let i = 0; i < 100; i++) {
                const isProjA = i < 60;
                const surface = isProjA ? 'app' : 'ide';
                const workspace = isProjA ? '/Users/dev/alpha' : '/Users/dev/beta';
                const cascadeId = isProjA ? 'conv-alpha' : 'conv-beta';
                const call = makeCall({
                    executionId: `ws-orig-${i}`,
                    accountEmail: 'user@example.com',
                    inputTokens: 1_000,
                    outputTokens: 200,
                    thinkingTokens: 50,
                    cacheReadTokens: 3_000,
                    cacheCreationTokens: 0,
                    createdAt: localIso(2026, 6, 10, 9 + Math.floor(i / 10), i % 60, 0),
                });
                entries.push({
                    dedupKey: ledgerDedupKey(cascadeId, call),
                    cascadeId,
                    callIndex: i,
                    call,
                    account: 'user@example.com',
                    authority: 'local',
                    workspace,
                    surface,
                });
            }

            // First ingestion assigns all 100 logical calls ONCE; duplicate submission adds 0
            const det1 = ledger.recordCallsDetailed(entries);
            expect(det1.added).toBe(100);
            expect(ledger.recordCallsDetailed(entries).added).toBe(0);

            // Settle early calls (quota reset) and delete a conversation -> project attribution MUST survive both!
            const settled = ledger.settleForQuotaReset(
                ['MODEL_PLACEHOLDER_M26'],
                'user@example.com',
                localDate(2026, 6, 10, 12, 0, 0).getTime(),
            );
            expect(settled).not.toBeNull();
            expect(settled!.workspaceBreakdown?.['/Users/dev/alpha']?.calls).toBeGreaterThan(0);
            ledger.recordConversationDeleted('conv-alpha');

            // Verify live ledger attribution sums to exact 60 alpha + 40 beta = 100 calls
            const preArchBoard = aggregateWorkspaceLeaderboard({ ledger });
            expect(preArchBoard.totals.calls).toBe(100);
            expect(preArchBoard.rows.find(r => r.workspaceKey === '/Users/dev/alpha')?.calls).toBe(60);
            expect(preArchBoard.rows.find(r => r.workspaceKey === '/Users/dev/beta')?.calls).toBe(40);

            // Midnight archival into DailyStore
            const store = new DailyStore();
            const activity = makeActivitySummary();
            const arch = await performDailyArchivalAsync({
                activityTracker: { getSummary: () => activity, archiveAndReset: () => null } as any,
                gmTracker: {
                    reset: () => {},
                    getDetailedSummary: () => null,
                    getCachedSummary: () => null,
                    getArchivalSummary: () => null,
                    getNewCallsSinceLastRecord: () => ({ entries: [], revertedCascadeIds: [] }),
                    markLedgerEntriesRecorded: () => {},
                } as any,
                dailyStore: store,
                pricingStore: null,
                lastGMSummary: null,
                persistedModelDNA: {},
                lastArchivalDateKey: '2026-06-10',
                dailyLedger: ledger,
                surface: 'app',
                persist: () => {},
                log: () => {},
            }, false, localDate(2026, 6, 11, 0, 2, 0));
            expect(arch.archived).toBe(true);

            // Day +1: App adds 1 late call to alpha, IDE adds 1 late call to gamma + replays App's late call
            vi.setSystemTime(localDate(2026, 6, 11, 0, 5, 0));
            const lateAppCall = makeCall({
                executionId: 'late-app-alpha',
                accountEmail: 'user@example.com',
                createdAt: localIso(2026, 6, 10, 23, 59, 10),
            });
            const lateIdeCall = makeCall({
                executionId: 'late-ide-gamma',
                accountEmail: 'user@example.com',
                createdAt: localIso(2026, 6, 10, 23, 59, 20),
            });

            const appDay2 = new DailyLedger('2026-06-11', 'app');
            appDay2.recordCallsDetailed([{
                dedupKey: ledgerDedupKey('conv-alpha', lateAppCall),
                cascadeId: 'conv-alpha',
                call: lateAppCall,
                account: 'user@example.com',
                authority: 'local',
                workspace: '/Users/dev/alpha',
                surface: 'app',
            }]);
            expect(flushLateDaysToDailyStore(appDay2, store)).toBe(1);

            const ideDay2 = new DailyLedger('2026-06-11', 'ide');
            ideDay2.recordCallsDetailed([
                {
                    dedupKey: ledgerDedupKey('conv-alpha', lateAppCall),
                    cascadeId: 'conv-alpha',
                    call: lateAppCall,
                    account: 'user@example.com',
                    authority: 'local',
                    workspace: '/Users/dev/alpha',
                    surface: 'app',
                },
                {
                    dedupKey: ledgerDedupKey('conv-gamma', lateIdeCall),
                    cascadeId: 'conv-gamma',
                    call: lateIdeCall,
                    account: 'user@example.com',
                    authority: 'ssh-remote+prod',
                    workspace: '/srv/gamma',
                    surface: 'ide',
                },
            ]);
            expect(flushLateDaysToDailyStore(ideDay2, store)).toBe(1);
            // Second replay changes nothing!
            const replayDay2 = new DailyLedger('2026-06-11', 'ide');
            replayDay2.recordCallsDetailed([{
                dedupKey: ledgerDedupKey('conv-gamma', lateIdeCall),
                cascadeId: 'conv-gamma',
                call: lateIdeCall,
                account: 'user@example.com',
                authority: 'ssh-remote+prod',
                workspace: '/srv/gamma',
                surface: 'ide',
            }]);
            expect(flushLateDaysToDailyStore(replayDay2, store)).toBe(0);

            const rec = store.getRecord('2026-06-10')!;
            expect(rec.cycles).toHaveLength(1);
            expect(rec.cycles[0].gmTotalCalls).toBe(102);
            expect(rec.cycles[0].totalReasoning).toBe(33);
            expect(rec.cycles[0].totalToolCalls).toBe(17);

            const board = aggregateWorkspaceLeaderboard({ records: store.getAllRecords() });
            expect(board.totals.calls).toBe(102);
            expect(board.rows.find(r => r.workspaceKey === '/Users/dev/alpha')?.calls).toBe(61);
            expect(board.rows.find(r => r.workspaceKey === '/Users/dev/beta')?.calls).toBe(40);
            expect(board.rows.find(r => r.workspaceKey === 'ssh-remote+prod::/srv/gamma')?.calls).toBe(1);

            // Exact surface filtering without proportional smearing
            const appOnly = aggregateWorkspaceLeaderboard({ records: store.getAllRecords(), surfaceFilter: 'app' });
            expect(appOnly.totals.calls).toBe(61);
            expect(appOnly.rows.map(r => r.workspaceKey)).toEqual(['/Users/dev/alpha']);

            const ideOnly = aggregateWorkspaceLeaderboard({ records: store.getAllRecords(), surfaceFilter: 'ide' });
            expect(ideOnly.totals.calls).toBe(41);
            expect(ideOnly.rows.map(r => r.workspaceKey).sort()).toEqual(['/Users/dev/beta', 'ssh-remote+prod::/srv/gamma']);
        });

        it('maps legacy/unattributable records explicitly to __unattributed__ and computes Swarm direct vs inclusive group costs', () => {
            // Legacy record with NO workspaceBreakdown -> MUST map 100% to __unattributed__ (never smeared!)
            const legacyRecord = {
                date: '2026-05-01',
                cycles: [{
                    gmTotalCalls: 10,
                    totalInputTokens: 20_000,
                    totalOutputTokens: 5_000,
                    gmTotalCacheRead: 10_000,
                    estimatedCost: 1.5,
                    surface: 'ide' as const,
                }],
            };

            // Live Swarm calls: Coordinator + Worker 1 (including 1 unpriced model call) + duplicate logical call ID
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 15, 14, 0, 0));
            const ledger = new DailyLedger('2026-06-15', 'app');
            const coordCall = makeCall({
                executionId: 'swarm-coord-1',
                inputTokens: 100_000,
                outputTokens: 10_000,
                cacheReadTokens: 0,
                createdAt: localIso(2026, 6, 15, 13, 0, 0),
            });
            const workerCallPriced = makeCall({
                executionId: 'swarm-w1-priced',
                inputTokens: 50_000,
                outputTokens: 5_000,
                cacheReadTokens: 0,
                createdAt: localIso(2026, 6, 15, 13, 5, 0),
            });
            const workerCallUnpriced = makeCall({
                executionId: 'swarm-w1-unpriced',
                model: 'MODEL_UNKNOWN_999',
                modelDisplay: 'Mystery Local Model',
                responseModel: 'mystery-local-model',
                inputTokens: 10_000,
                outputTokens: 2_000,
                cacheReadTokens: 0,
                createdAt: localIso(2026, 6, 15, 13, 10, 0),
            });

            ledger.recordCallsDetailed([
                {
                    dedupKey: ledgerDedupKey('coord-root', coordCall),
                    cascadeId: 'coord-root',
                    call: coordCall,
                    workspace: '/Users/dev/swarm-repo',
                    surface: 'app',
                },
                {
                    dedupKey: ledgerDedupKey('worker-1', workerCallPriced),
                    cascadeId: 'worker-1',
                    call: workerCallPriced,
                    workspace: '/Users/dev/swarm-repo',
                    surface: 'app',
                },
                {
                    dedupKey: ledgerDedupKey('worker-1', workerCallUnpriced),
                    cascadeId: 'worker-1',
                    call: workerCallUnpriced,
                    workspace: '/Users/dev/swarm-repo',
                    surface: 'app',
                },
            ]);

            const built = buildGMSummaryFromLedger(ledger.getLiveDaySnapshot());
            expect(built.workspaceBreakdown?.['/Users/dev/swarm-repo']?.unpricedCalls).toBe(1);

            const board = aggregateWorkspaceLeaderboard({
                records: [legacyRecord],
                ledger,
                swarmGroups: [{ rootId: 'coord-root', memberIds: ['worker-1'] }],
            });

            // Attributed project sorted first, Unattributed cleanly separated last
            expect(board.rows).toHaveLength(2);
            expect(board.rows[0].workspaceKey).toBe('/Users/dev/swarm-repo');
            expect(board.rows[0].isUnattributed).toBe(false);
            expect(board.rows[0].calls).toBe(3);
            expect(board.rows[0].unpricedCalls).toBe(1);
            expect(board.rows[0].knownCostUsd).toBeGreaterThan(0);

            expect(board.rows[1].workspaceKey).toBe(UNATTRIBUTED_WORKSPACE_KEY);
            expect(board.rows[1].isUnattributed).toBe(true);
            expect(board.rows[1].displayLabel).toBe('Unattributed');
            expect(board.rows[1].calls).toBe(10);
            expect(board.rows[1].knownCostUsd).toBeCloseTo(1.5, 6);
            expect(board.unattributedRow).toEqual(board.rows[1]);

            // Swarm direct vs inclusive group cost compatibility
            const swarmCost = board.swarmGroupCosts?.['coord-root']!;
            expect(swarmCost).toBeDefined();
            expect(swarmCost.coordinatorDirectCostUsd).toBeGreaterThan(0);
            expect(swarmCost.workersDirectCostUsd).toBeGreaterThan(0);
            expect(swarmCost.inclusiveGroupCostUsd).toBeCloseTo(
                swarmCost.coordinatorDirectCostUsd + swarmCost.workersDirectCostUsd,
                10,
            );
            expect(swarmCost.uniqueCallCount).toBe(3);
            expect(swarmCost.pricedCallCount).toBe(2);
            expect(swarmCost.unpricedCallCount).toBe(1);
            expect(swarmCost.hasUnpricedCalls).toBe(true);

            // Standalone helper matches & deduplicates repeated calls cleanly
            const directLedgerSwarm = aggregateLedgerSwarmGroupCost({
                rootId: 'coord-root',
                memberIds: ['worker-1'],
                ledger,
            });
            expect(directLedgerSwarm).toEqual(swarmCost);

            // Duplicate logical call IDs across positional index prefixes are counted ONCE in leaderboard
            const rawDupCalls = ledger.getLiveDaySnapshot().accounts['']?.recordedCalls ?? [];
            expect(rawDupCalls).toHaveLength(3);
            const dupBoard = aggregateWorkspaceLeaderboard({
                calls: [
                    ...rawDupCalls,
                    ...rawDupCalls.map((c, idx) => ({ ...c, callId: c.callId.replace('|', `:${idx + 99}|`) })),
                ],
            });
            expect(dupBoard.totals.calls).toBe(3);
        });
    });
});

describe('[monitor-overview]', () => {
    const initialLanguage = getLanguage();

    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    const now = Date.parse('2026-11-19T01:00:00Z');

    const neon = 'MODEL_PLACEHOLDER_M535';


    function usage(values: Partial<ContextUsage> = {}): ContextUsage {
        return {
            cascadeId: 'sample', title: 'Local <session> & notes', model: neon, modelDisplayName: 'Gemini 4 Neon (XHigh)',
            contextLimit: 512_000, contextUsed: 24_000, usagePercent: 4.6875, status: 'IDLE', stepCount: 1,
            lastModifiedTime: '', isEstimated: false, lastModelUsage: null, totalOutputTokens: 10,
            totalToolCallOutputTokens: 100, estimatedDeltaSinceCheckpoint: 0, imageGenStepCount: 0,
            compressionDetected: false, checkpointCompressionDrop: 0, hasGaps: false, checkpointModel: '',
            createdTime: '', lastUserInputTime: '', lastUserInputStepIndex: 0, repositoryName: '', gitOriginUrl: '',
            branchName: '', gitRootUri: '', ...values,
        };
    }


    function config(model: string, label: string, fraction: number, resetTime = '2026-11-19T02:00:00Z'): ModelConfig {
        return {
            model, label, quotaInfo: { remainingFraction: fraction, resetTime }, supportsImages: false,
            allowedTiers: [], mimeTypeCount: 0, isRecommended: false, supportedMimeTypes: [],
        };
    }


    function gmCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-1',
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Sonnet 4',
            responseModel: 'claude-sonnet-4-20250514',
            modelAccuracy: 'exact',
            inputTokens: 20_000,
            outputTokens: 600,
            thinkingTokens: 0,
            responseTokens: 600,
            cacheReadTokens: 80_000,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 0.75,
            streamingSeconds: 10,
            credits: 0,
            creditType: '',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 100_600,
            completionConfig: null,
            systemPromptSnippet: '',
            toolCount: 0,
            toolNames: [],
            promptSectionTitles: [],
            promptSnippet: '',
            promptSource: 'none',
            messagePromptCount: 0,
            messageMetadataKeys: [],
            responseHeaderKeys: [],
            userMessageAnchors: [],
            aiSnippetsByStep: {},
            retries: 0,
            stopReason: '',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: '2026-11-19T00:50:00Z',
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 200_000,
            ...overrides,
        };
    }


    function makeGMSummary(conversations: Array<Pick<GMConversationData, 'cascadeId' | 'calls'> & { title?: string }>): GMSummary {
        const convs: GMConversationData[] = conversations.map((c, idx) => ({
            cascadeId: c.cascadeId,
            title: c.title || `Conv ${idx + 1}`,
            totalSteps: c.calls.length,
            calls: c.calls,
            coveredSteps: c.calls.length,
            coverageRate: 1,
            checkpointSummaries: [],
        }));
        const allCalls = convs.flatMap(c => c.calls);
        return {
            conversations: convs,
            modelBreakdown: {},
            totalCalls: allCalls.length,
            totalStepsCovered: allCalls.length,
            totalCredits: 0,
            totalInputTokens: allCalls.reduce((s, c) => s + c.inputTokens, 0),
            totalOutputTokens: allCalls.reduce((s, c) => s + c.outputTokens, 0),
            totalCacheRead: allCalls.reduce((s, c) => s + c.cacheReadTokens, 0),
            totalCacheCreation: allCalls.reduce((s, c) => s + c.cacheCreationTokens, 0),
            totalThinkingTokens: allCalls.reduce((s, c) => s + c.thinkingTokens, 0),
            contextGrowth: [],
            fetchedAt: '2026-11-19T01:00:00Z',
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


    function makeCalendarStore(records: DailyStoreState['records']): DailyStore {
        const store = new DailyStore();
        store.restoreSnapshot({ version: 1, records });
        return store;
    }


    beforeEach(async () => { await setLanguageToState('en', state); });

    afterEach(async () => {
        vi.restoreAllMocks();
        await setLanguageToState(initialLanguage, state);
    });


    describe('status hover and overview', () => {
        it('offers allowlisted hover destinations and counts both Neon types in one pool', () => {
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            manager.setModelConfigs([
                config(neon, 'Gemini 4 Neon (XHigh)', 0.5165423),
                config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.5165423),
            ]);
            manager.update(usage());
            const tooltip = item.tooltip as vscode.MarkdownString;
            expect(tooltip.isTrusted).toEqual({
                enabledCommands: [MONITOR_COMMAND, 'antigravity-context-monitor.refresh'],
            });
            expect(tooltip.value.match(/Gemini[^|\n]*\|[^|\n]*\*\*52%\*\*/g)).toHaveLength(1);
            expect(tooltip.value).toContain('Gemini 4 Neon \\(Extra High\\)');
            for (const tab of ['overview', 'gmdata', 'pricing', 'models', 'settings']) {
                expect(tooltip.value).toContain(`command:${MONITOR_COMMAND}?${encodeURIComponent(JSON.stringify([tab]))}`);
            }
            expect(tooltip.value).toContain('command:antigravity-context-monitor.refresh');
            expect(item.text).not.toContain('||');
            manager.dispose();
        });

        it('counts all Gemini 4 Neon efforts once and keeps the Orchestrator distinct', () => {
            vi.spyOn(Date, 'now').mockReturnValue(now);
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            const configs = [
                config('MODEL_PLACEHOLDER_M534', 'Gemini 4 Neon (Low)', 0.60),
                config('MODEL_PLACEHOLDER_M533', 'Gemini 4 Neon (Medium)', 0.60),
                config('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)', 0.35, '2026-11-19T03:00:00Z'),
                config(neon, 'Gemini 4 Neon (XHigh)', 0.52),
                config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.60),
            ];
            manager.setModelConfigs([...configs, configs[0]]);
            manager.showNoConversation();
            const hover = (item.tooltip as vscode.MarkdownString).value;
            expect(hover.match(/Gemini/g)).toHaveLength(1);
            expect(hover).toContain('35–60%');
            expect(hover).toContain('Reset times vary');
            expect(hover).not.toMatch(/XHigh|5 models/);
            const overview = buildOverviewTabContent(null, configs, null, 0, { state: 'empty' }, now);
            expect(overview).toContain('2 models');
            expect(overview.match(/Gemini 4 Neon/g)).toHaveLength(1);
            manager.dispose();
        });

        it('keeps session name and actionable summary at automatic density', () => {
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            manager.update(usage({ title: 'Release review', contextUsed: 24_000, hasGaps: true }));
            const hover = (item.tooltip as vscode.MarkdownString).value;
            expect(hover).toContain('**Release review**');
            expect(hover).toContain('**24k** / 512k tokens');
            expect(hover).toContain('Remaining **488k** (95.3%)');
            expect(hover).toContain('Some steps are missing');
            expect(hover).toContain('[$(dashboard) Overview]');
            expect(hover).toContain('\n\n---\n\n');
            manager.dispose();
        });

        it('renders explicit zero AI credits accurately, omits unknown credits without fake 0, and avoids cross-pool reset leaks', () => {
            vi.spyOn(Date, 'now').mockReturnValue(now);
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            manager.setModelConfigs([
                config('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)', 1.0, '1970-01-01T00:00:00Z'),
                config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)', 0.4, '2026-11-19T02:30:00Z'),
            ]);
            // Unknown credits (null) -> never show 0 in status bar or hover; Gemini untouched must NOT inherit Claude's reset.
            manager.setCredits(null);
            manager.update(usage({ model: 'MODEL_PLACEHOLDER_M532', modelDisplayName: 'Gemini 4 Neon (High)' }));
            expect(item.text).toContain('$(layers) 100%');
            expect(item.text).not.toContain('$(clock)');
            expect(item.text).not.toContain('$(zap)');
            const unknownHover = (item.tooltip as vscode.MarkdownString).value;
            expect(unknownHover).not.toContain('AI credits');
            expect(unknownHover).toContain('1h 30m');
            expect(unknownHover).not.toContain('Reset time passed');

            // Explicit 0 credits -> displayed accurately as 0.
            manager.setCredits(0);
            manager.update(usage({ model: 'MODEL_PLACEHOLDER_M532', modelDisplayName: 'Gemini 4 Neon (High)' }));
            expect(item.text).toContain('$(zap) 0');
            expect((item.tooltip as vscode.MarkdownString).value).toContain('**AI credits** · **0**');

            // Unknown credits with billing day configured -> discloses Not reported instead of 0.
            manager.setCredits(null);
            manager.setBillingDay(25);
            manager.refreshFromConfig();
            const withExpiryHover = (item.tooltip as vscode.MarkdownString).value;
            expect(withExpiryHover).toContain('**AI credits** · Not reported · ');
            expect(withExpiryHover).not.toContain('**0**');
            manager.dispose();
        });

        it('supports compact and detailed/full hover density with remaining %, clock time, and CRLF-safe title normalization', () => {
            vi.spyOn(Date, 'now').mockReturnValue(now);
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            const configs = [
                config('MODEL_PLACEHOLDER_M534', 'Gemini 4 Neon (Low)', 0.60, '2026-11-19T02:30:00Z'),
                config('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', 0.60, '2026-11-19T02:30:00Z'),
                config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.60, '2026-11-19T02:30:00Z'),
            ];
            manager.setModelConfigs(configs);
            manager.setPlanName('  Google AI\r\nUltra  ', 'Google AI Ultra');
            manager.setCredits(14_701);

            const getConfigSpy = vi.spyOn(vscode.workspace, 'getConfiguration');
            // Compact density: concise context gauge, countdown, omits expiry & detail lines
            getConfigSpy.mockImplementation((section?: string) => ({
                get: <T>(key: string, fallback?: T) => {
                    if (section === 'antigravityContextMonitor' && key === 'statusBar.tooltipDensity') { return 'compact' as T; }
                    return fallback as T;
                },
            }) as unknown as vscode.WorkspaceConfiguration);
            manager.update(usage({ title: '  \r\n  Windows\tCRLF\r\nSession  ' }));
            const compactHover = (item.tooltip as vscode.MarkdownString).value;
            expect(compactHover).toContain('**Windows CRLF Session**');
            expect(compactHover).toContain('**24k** / 512k tokens');
            expect(compactHover).toContain('1h 30m');
            expect(compactHover).toContain('**14,701**');
            expect(compactHover).not.toContain('Expiry date not set');

            // 'detailed' alias resolves identically to 'full' density with exact numbers & diagnostics
            getConfigSpy.mockImplementation((section?: string) => ({
                get: <T>(key: string, fallback?: T) => {
                    if (section === 'antigravityContextMonitor' && key === 'statusBar.tooltipDensity') { return 'detailed' as T; }
                    return fallback as T;
                },
            }) as unknown as vscode.WorkspaceConfiguration);
            manager.update(usage({
                title: 'Detailed check',
                lastModelUsage: { model: neon, inputTokens: 18_000, outputTokens: 2_000, responseOutputTokens: 1_500, cacheReadTokens: 4_000, cacheCreationTokens: 0 },
                tokenUsageSource: 'planner',
            }));
            const detailedHover = (item.tooltip as vscode.MarkdownString).value;
            expect(detailedHover).toContain('**24,000** / 512,000 tokens');
            expect(detailedHover).toContain('Remaining **488,000** (95.3%)');
            expect(detailedHover).toContain('Model Output 10 · Tool Results 100');
            expect(detailedHover).not.toContain('Image Gen 0');
            manager.dispose();
        });

        it('formats countdowns without trailing zeros and guards helper bounds cleanly', async () => {
            expect(resetCountdown(now + 3_600_000, now)).toBe('1h');
            expect(resetCountdown(now + 5_400_000, now)).toBe('1h 30m');
            expect(resetCountdown(now + 48 * 3_600_000, now)).toBe('2d');
            expect(resetCountdown(now + 50 * 3_600_000, now)).toBe('2d 2h');
            expect(resetCountdown(0, now)).toBe('Reset time unavailable');
            expect(getContextRemaining(24_000, 512_000)).toEqual({ tokens: 488_000, percent: (488_000 / 512_000) * 100 });
            expect(getContextRemaining(640_000, 512_000)).toEqual({ tokens: 0, percent: 0 });
            expect(getContextRemaining(null, 512_000)).toBeNull();
            expect(formatCreditExpiry(-3)).toBe('Expiry date not set');
            expect(formatCreditExpiry(0)).toBe('Expires today');
            expect(formatQuotaEffort('xhigh')).toBe('Extra High');
            expect(formatQuotaEfforts(['low', 'medium', 'high', 'xhigh'])).toBe('Low · Medium · High · Extra High');
            await setLanguageToState('zh', state);
            expect(resetCountdown(now + 3_600_000, now)).toBe('1 小时');
            expect(formatQuotaEfforts(['low', 'xhigh'])).toBe('低 · 超高');
        });

        it('shows no stale metrics during disconnect and no invented zero/limit in an empty session', () => {
            const configs = [config(neon, 'Gemini 4 Neon (XHigh)', 0.35)];
            const offline = buildOverviewTabContent(usage(), configs, null, 0, { state: 'disconnected', backendIssue: 'lost' }, now);
            expect(offline).toContain('Reconnecting');
            expect(offline).not.toMatch(/35%|24,000|512,000/);
            const idle = buildOverviewTabContent(null, configs, null, 0, { state: 'idle' }, now);
            expect(idle).toContain('No context measurement');
            expect(idle).toContain('35%');
            expect(idle).not.toContain('512,000');
        });

        it('escapes labels, shows split readings and bounds the meter without hiding overflow', () => {
            const data = [
                config(neon, 'Gemini 4 Neon (XHigh)', 0),
                config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.54, '2026-11-19T04:00:00Z'),
                config('future', 'New <model>', NaN, '2026-02-31T10:00:00Z'),
            ];
            const html = buildOverviewTabContent(usage({ contextUsed: 640_000 }), data, null, 0, { state: 'active' }, now);
            expect(html).toContain('Local &lt;session&gt; &amp; notes');
            expect(html).toContain('New &lt;model&gt;');
            expect(html).toContain('0–54%');
            expect(html).toContain('Reset times vary');
            expect(html).toContain('Reset time unavailable');
            expect(html).toContain('Above the context limit');
            expect(html).toContain('aria-valuenow="100" aria-valuetext="125%"');
            expect(html).not.toMatch(/NaN|Infinity/);
        });

        it('keeps independent unknown IDs separate even at the same reset time', () => {
            const groups = selectMonitorQuotaGroups([
                config('unknown-one', 'Unknown A', 0.7),
                config('unknown-two', 'Unknown B', 0.25),
            ]);
            expect(groups.map(group => group.label)).toEqual(['Unknown B', 'Unknown A']);
        });

        it('handles malformed limits and translates the Extra label and status actions in bilingual mode', async () => {
            await setLanguageToState('both', state);
            const malformed = usage({ contextUsed: Infinity, contextLimit: 0 });
            expect(getContextReading(malformed)).toEqual({ used: null, limit: null, percent: null });
            const html = buildOverviewTabContent(malformed, [], null);
            const text = html.replace(/<[^>]+>/g, '');
            expect(html).toContain(tBiHtml('Context & quota', '上下文与配额'));
            expect(text).toContain('Context &amp; quota / 上下文与配额');
            expect(html).toContain('Gemini 4 Neon (Extra High / 超高)');
            expect(html).toContain(tBiHtml('View models', '查看模型'));
            expect(text).toContain('View models / 查看模型');
            expect(html).not.toContain('令牌');
            expect(html).not.toMatch(/NaN|Infinity|role="meter"/);
        });
    });


    describe('overview telemetry strip and helper', () => {
        it('prefers active conversation telemetry and falls back cleanly to session scope', () => {
            const summary = makeGMSummary([
                {
                    cascadeId: 'conv-other',
                    calls: [
                        gmCall({
                            executionId: 'other-1',
                            inputTokens: 10_000,
                            outputTokens: 400,
                            responseTokens: 400,
                            cacheReadTokens: 40_000,
                            ttftSeconds: 1.8,
                            streamingSeconds: 10, // 40.0 tok/s
                            createdAt: '2026-11-19T00:40:00Z',
                        }),
                    ],
                },
                {
                    cascadeId: 'conv-active',
                    calls: [
                        gmCall({
                            executionId: 'act-1',
                            inputTokens: 10_000,
                            outputTokens: 500,
                            responseTokens: 500,
                            cacheReadTokens: 90_000,
                            ttftSeconds: 0.9,
                            streamingSeconds: 10, // 50.0 tok/s
                            createdAt: '2026-11-19T00:50:00Z',
                        }),
                        gmCall({
                            executionId: 'act-2',
                            inputTokens: 10_000,
                            outputTokens: 700,
                            responseTokens: 700,
                            cacheReadTokens: 90_000,
                            ttftSeconds: 0.6,
                            streamingSeconds: 10, // 70.0 tok/s; weighted = 1200 / 20 = 60.0 tok/s
                            createdAt: '2026-11-19T00:55:00Z',
                        }),
                    ],
                },
            ]);

            const activeSnap = extractOverviewTelemetry(summary, 'conv-active');
            expect(activeSnap?.primaryScope).toBe('active');
            expect(activeSnap?.speedPrimary).toBeCloseTo(70, 5);

            const activeHtml = buildOverviewTabContent(
                usage({ cascadeId: 'conv-active' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: summary },
            );
            expect(activeHtml).toContain('class="overview-telemetry-strip"');
            expect(activeHtml).toContain('data-telemetry-scope="active"');
            expect(activeHtml).toContain('70.0 tok/s');
            expect(activeHtml).toContain('avg 60.0 tok/s');
            expect(activeHtml).toContain('600ms');
            expect(activeHtml).toContain('cached 750ms');
            expect(activeHtml).toContain('90.0%');
            expect(activeHtml).toContain('180k · 2/2');
            expect(activeHtml).toContain('Warm');
            // Positioned directly below context meter/remaining and above #overview-session-diagnostics
            expect(activeHtml.indexOf('overview-meter')).toBeLessThan(activeHtml.indexOf('overview-telemetry-strip'));
            // The shared telemetry strip follows both session diagnostics and the quota column.
            expect(activeHtml.indexOf('id="overview-session-diagnostics"')).toBeLessThan(activeHtml.indexOf('overview-telemetry-strip'));
            expect(activeHtml.indexOf('id="overview-quota-heading"')).toBeLessThan(activeHtml.indexOf('overview-telemetry-strip'));

            // Active conversation with no GM calls MUST NOT inherit other conversations' telemetry (no cross-conversation bleed)
            const freshHtml = buildOverviewTabContent(
                usage({ cascadeId: 'conv-fresh' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: summary },
            );
            expect(freshHtml).not.toContain('data-telemetry-scope="session"');
            expect(freshHtml).not.toContain('220k · 3/3');

            // Without an explicit active conversation target, session-wide scope still works cleanly
            const sessionHtml = buildOverviewTabContent(
                null,
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: summary },
            );
            expect(sessionHtml).toContain('data-telemetry-scope="session"');
            expect(sessionHtml).toContain('220k · 3/3');
        });

        it('renders visible resp tok/s for thinking models and unpriced savings as tokens without fake $0.00', () => {
            const unpricedThinkingSummary = makeGMSummary([
                {
                    cascadeId: 'conv-think',
                    calls: [
                        gmCall({
                            executionId: 'think-1',
                            model: 'MODEL_PLACEHOLDER_UNPRICED_999',
                            modelDisplay: 'Future Experimental Model',
                            responseModel: 'future-experimental-unpriced',
                            inputTokens: 20_000,
                            cacheReadTokens: 142_000,
                            cacheCreationTokens: 0,
                            outputTokens: 800,
                            thinkingTokens: 560,
                            responseTokens: 240,
                            ttftSeconds: 1.4,
                            streamingSeconds: 10, // 80.0 tok/s total, 24.0 tok/s visible
                            createdAt: '2026-11-19T00:55:00Z',
                        }),
                    ],
                },
            ]);

            const html = buildOverviewTabContent(
                usage({ cascadeId: 'conv-think' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: unpricedThinkingSummary },
            );
            expect(html).toContain('80.0 tok/s');
            expect(html).toContain('resp 24.0 tok/s');
            expect(html).toContain('1.40s');
            expect(html).toContain('cached 1.40s');
            expect(html).toContain('87.7%');
            expect(html).toContain('142k · 1/1');
            expect(html).toContain('142k tokens');
            expect(html).toContain('is-warm');
            expect(html).not.toContain('$0.00');
            expect(html).not.toContain('令牌');
        });

        it('renders USD savings for priced models, p50 TTFT when uncached, and warming/cold warmth states', () => {
            // Priced Claude Sonnet 4.6 call with 100k cacheRead ($3.00 - $0.30 = $2.70/1M -> $0.27)
            const pricedSummary = makeGMSummary([
                {
                    cascadeId: 'conv-priced',
                    calls: [
                        gmCall({
                            model: 'claude-sonnet-4-6',
                            modelDisplay: 'Claude Sonnet 4.6',
                            responseModel: 'claude-sonnet-4-6',
                            inputTokens: 10_000,
                            cacheReadTokens: 100_000,
                            outputTokens: 500,
                            responseTokens: 500,
                            ttftSeconds: 0.85,
                            streamingSeconds: 10,
                        }),
                    ],
                },
            ]);
            const pricedHtml = buildOverviewTabContent(
                usage({ cascadeId: 'conv-priced' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: pricedSummary },
            );
            expect(pricedHtml).toContain('$0.27');
            expect(pricedHtml).toContain('is-cache');
            expect(pricedHtml).not.toContain('$0.00');

            // Custom pricing override on an otherwise unpriced model works cleanly
            const customPricedHtml = buildOverviewTabContent(
                usage({ cascadeId: 'conv-priced' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                {
                    gmSummary: pricedSummary,
                    customPricing: {
                        'claude-sonnet-4-6': { input: 4.5, output: 15, cacheRead: 0.4, cacheWrite: 5, thinking: 15 },
                    },
                },
            );
            expect(customPricedHtml).toContain('$0.41');

            // Uncached warming call -> p50 TTFT sub-caption, muted 0% cache hit, — saved, Warming state
            const warmingSummary = makeGMSummary([
                {
                    cascadeId: 'conv-warm',
                    calls: [
                        gmCall({
                            inputTokens: 10_000,
                            cacheReadTokens: 0,
                            cacheCreationTokens: 8_000,
                            outputTokens: 300,
                            responseTokens: 300,
                            ttftSeconds: 1.25,
                            streamingSeconds: 6,
                        }),
                    ],
                },
            ]);
            const warmingHtml = buildOverviewTabContent(
                usage({ cascadeId: 'conv-warm' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: warmingSummary },
            );
            expect(warmingHtml).toContain('p50 1.25s');
            expect(warmingHtml).toContain('overview-telemetry-value is-muted">0%');
            expect(warmingHtml).toContain('overview-telemetry-value is-muted">—');
            expect(warmingHtml).toContain('overview-telemetry-sub is-warming');
            expect(warmingHtml).toContain('Warming');
            expect(warmingHtml).not.toContain('$0.00');

            // Pure cold call -> Cold state
            const coldSummary = makeGMSummary([
                {
                    cascadeId: 'conv-cold',
                    calls: [
                        gmCall({
                            inputTokens: 4_000,
                            cacheReadTokens: 0,
                            cacheCreationTokens: 0,
                            outputTokens: 200,
                            responseTokens: 200,
                            ttftSeconds: 0.9,
                            streamingSeconds: 4,
                        }),
                    ],
                },
            ]);
            const coldHtml = buildOverviewTabContent(
                usage({ cascadeId: 'conv-cold' }),
                [],
                null,
                0,
                { state: 'active' },
                now,
                { gmSummary: coldSummary },
            );
            expect(coldHtml).toContain('overview-telemetry-sub is-cold');
            expect(coldHtml).toContain('Cold');
        });

        it('cleanly omits telemetry strip when idle/empty with 0 GM calls, disconnected, or lacking readings', () => {
            const emptyGM = makeGMSummary([]);
            expect(extractOverviewTelemetry(null)).toBeNull();
            expect(extractOverviewTelemetry(emptyGM)).toBeNull();

            const idleEmpty = buildOverviewTabContent(null, [], null, 0, { state: 'idle' }, now, { gmSummary: emptyGM });
            expect(idleEmpty).not.toContain('overview-telemetry-strip');
            expect(idleEmpty).not.toContain('0 tok/s');

            const activeEmpty = buildOverviewTabContent(usage(), [], null, 0, { state: 'active' }, now, { gmSummary: emptyGM });
            expect(activeEmpty).not.toContain('overview-telemetry-strip');

            // Call with all zeros (no speed, no TTFT, no prompt tokens) -> omitted, never fake 0 tok/s
            const zeroCallGM = makeGMSummary([
                {
                    cascadeId: 'sample',
                    calls: [
                        gmCall({
                            inputTokens: 0,
                            outputTokens: 0,
                            responseTokens: 0,
                            cacheReadTokens: 0,
                            cacheCreationTokens: 0,
                            ttftSeconds: 0,
                            streamingSeconds: 0,
                        }),
                    ],
                },
            ]);
            expect(extractOverviewTelemetry(zeroCallGM, 'sample')).toBeNull();
            const zeroHtml = buildOverviewTabContent(usage(), [], null, 0, { state: 'active' }, now, { gmSummary: zeroCallGM });
            expect(zeroHtml).not.toContain('overview-telemetry-strip');

            // Disconnected state never leaks telemetry
            const richGM = makeGMSummary([{ cascadeId: 'sample', calls: [gmCall()] }]);
            const offline = buildOverviewTabContent(
                usage(),
                [],
                null,
                0,
                { state: 'disconnected', backendIssue: 'lost' },
                now,
                { gmSummary: richGM },
            );
            expect(offline).not.toContain('overview-telemetry-strip');

            // Helper formatters never fabricate $0.00
            expect(formatSavingsUsd(null)).toBeNull();
            expect(formatSavingsUsd(0)).toBeNull();
            expect(formatSavingsUsd(-1)).toBeNull();
            expect(formatSavingsUsd(0.41)).toBe('$0.41');
            expect(formatSavingsUsd(0.0042)).toBe('$0.004');
            expect(formatSavingsUsd(0.00001)).toBe('<$0.0001');
            expect(formatCompactTokens(142_000)).toBe('142k');
            expect(formatCompactTokens(14_500)).toBe('14.5k');
            expect(formatCompactTokens(1_200_000)).toBe('1.2M');
        });

        it('renders clean localized telemetry copy with zero forbidden 令牌 across en, zh, and both', async () => {
            const summary = makeGMSummary([
                {
                    cascadeId: 'conv-i18n',
                    calls: [
                        gmCall({
                            model: 'MODEL_PLACEHOLDER_UNPRICED_999',
                            modelDisplay: 'Unpriced Model',
                            responseModel: 'unpriced-model',
                            inputTokens: 10_000,
                            cacheReadTokens: 90_000,
                            outputTokens: 500,
                            thinkingTokens: 300,
                            responseTokens: 200,
                            ttftSeconds: 0.65,
                            streamingSeconds: 10,
                        }),
                    ],
                },
            ]);

            for (const lang of ['en', 'zh', 'both'] as const) {
                await setLanguageToState(lang, state);
                const html = buildOverviewTabContent(
                    usage({ cascadeId: 'conv-i18n' }),
                    [],
                    null,
                    0,
                    { state: 'active' },
                    now,
                    { gmSummary: summary },
                );
                expect(html).not.toContain('令牌');
                expect(html).not.toMatch(/NaN|Infinity/);
                expect(html).toContain('90k tokens');
                if (lang === 'en') {
                    expect(html).toContain('Speed');
                    expect(html).toContain('TTFT');
                    expect(html).toContain('cached 650ms');
                    expect(html).toContain('Cache Hit');
                    expect(html).toContain('Cache Saved');
                    expect(html).toContain('Warm');
                } else if (lang === 'zh') {
                    expect(html).toContain('生成速度');
                    expect(html).toContain('首字延迟');
                    expect(html).toContain('缓存首字 650ms');
                    expect(html).not.toContain('cached 650ms');
                    expect(html).toContain('缓存命中');
                    expect(html).toContain('缓存节省');
                    expect(html).toContain('热缓存（命中）');
                } else {
                    expect(html).toContain(tBiHtml('Speed', '生成速度'));
                    expect(html).toContain(tBiHtml('TTFT', '首字延迟'));
                    expect(html).toContain(tBiHtml('cached 650ms', '缓存首字 650ms'));
                    expect(html).toContain(tBiHtml('Cache Hit', '缓存命中'));
                    expect(html).toContain(tBiHtml('Cache Saved', '缓存节省'));
                    expect(html).toContain(tBiHtml('Warm', '热缓存（命中）'));
                }
            }

            // CSS token & balance sanity check
            const css = getOverviewStyles();
            expect(css).toContain('.overview-telemetry-strip');
            expect(css).toContain('var(--ed-surface-well');
            expect(css).toContain('var(--ed-chart-cache');
            expect(css).toContain('repeat(2, minmax(0, 1fr))');
            expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
        });
    });


    describe('calendar archived telemetry', () => {
        it('renders archived speed, adaptive TTFT latency, and token-weighted cache hit with legacy fallback', async () => {
            const store = makeCalendarStore({
                '2026-11-18': {
                    date: '2026-11-18',
                    cycles: [
                        {
                            startTime: '2026-11-18T00:00:00Z',
                            endTime: '2026-11-18T23:59:59Z',
                            totalReasoning: 0,
                            totalToolCalls: 0,
                            totalErrors: 0,
                            totalInputTokens: 0,
                            totalOutputTokens: 0,
                            estSteps: 0,
                            modelNames: [],
                            gmTotalCalls: 14,
                            gmTotalCredits: 2,
                            gmTotalTokens: 34_000,
                            estimatedCost: 0.45,
                            gmModelStats: {
                                // Modern record with speed, sub-second TTFT, and token-weighted cache hit (differs from legacy 100%)
                                'Claude Sonnet 4': {
                                    calls: 10,
                                    credits: 2,
                                    inputTokens: 20_000,
                                    outputTokens: 4_000,
                                    thinkingTokens: 0,
                                    avgTTFT: 0.42,
                                    cacheHitRate: 1.0,
                                    estimatedCost: 0.35,
                                    cacheReadTokens: 80_000,
                                    cacheCreationTokens: 0,
                                    avgStreaming: 6.25,
                                    avgGenTokPerSec: 64.0,
                                    tokenCacheHitRate: 0.8,
                                },
                                // Legacy archived record lacking avgGenTokPerSec, tokenCacheHitRate, and cacheReadTokens
                                'Legacy Model': {
                                    calls: 4,
                                    credits: 0,
                                    inputTokens: 8_000,
                                    outputTokens: 2_000,
                                    thinkingTokens: 0,
                                    avgTTFT: 1.2,
                                    cacheHitRate: 0.75,
                                    estimatedCost: 0.1,
                                },
                            },
                        },
                    ],
                },
            });

            for (const lang of ['en', 'zh', 'both'] as const) {
                await setLanguageToState(lang, state);
                const html = buildCalendarTabContent(store, 2026, 11);
                expect(html).toContain('id="cal-detail-2026-11-18"');
                expect(html).toContain('id="clearCalendarBtn"');
                expect(html).toContain('class="cal-grid"');
                // Modern model chips
                expect(html).toContain('cal-chip-speed');
                expect(html).toContain('64.0 tok/s');
                expect(html).toContain('420ms');
                expect(html).toContain('80.0%');
                // Legacy model chips: adaptive TTFT + graceful cacheHitRate fallback (no speed chip)
                expect(html).toContain('1.20s');
                expect(html).toContain('75.0%');
                expect(html).not.toContain('令牌');
                expect(html).not.toMatch(/NaN|Infinity/);
            }

            // Verify legacy model row itself does not emit a speed chip
            await setLanguageToState('en', state);
            const enHtml = buildCalendarTabContent(store, 2026, 11);
            const legacyIdx = enHtml.indexOf('Legacy Model');
            expect(legacyIdx).toBeGreaterThan(-1);
            const legacyRowSlice = enHtml.slice(legacyIdx, enHtml.indexOf('</div>', legacyIdx));
            expect(legacyRowSlice).not.toContain('cal-chip-speed');
            expect(legacyRowSlice).toContain('1.20s');
            expect(legacyRowSlice).toContain('75.0%');

            const calCss = getCalendarTabStyles();
            expect(calCss).toContain('.cal-chip-speed');
            expect(calCss).not.toContain('.cal-cell[data-tooltip]');
            expect(calCss).not.toContain('[data-tooltip]::after');
            expect((calCss.match(/\{/g) || []).length).toBe((calCss.match(/\}/g) || []).length);
        });

        it('merges multi-cycle speed time-weighted and prompt cache token-weighted', () => {
            const store = makeCalendarStore({
                '2026-11-19': {
                    date: '2026-11-19',
                    cycles: [
                        {
                            startTime: '2026-11-19T00:00:00Z',
                            endTime: '2026-11-19T12:00:00Z',
                            totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                            totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0, modelNames: [],
                            gmTotalCalls: 5,
                            gmModelStats: {
                                'Claude Sonnet 4': {
                                    calls: 5, credits: 0,
                                    inputTokens: 10_000, outputTokens: 1_000, thinkingTokens: 0,
                                    avgTTFT: 0.5, cacheHitRate: 1,
                                    cacheReadTokens: 90_000, tokenCacheHitRate: 0.9,
                                    avgGenTokPerSec: 50, // 20s streaming
                                },
                            },
                        },
                        {
                            startTime: '2026-11-19T12:00:00Z',
                            endTime: '2026-11-19T23:59:59Z',
                            totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                            totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0, modelNames: [],
                            gmTotalCalls: 1,
                            gmModelStats: {
                                'Claude Sonnet 4': {
                                    calls: 1, credits: 0,
                                    inputTokens: 5_000, outputTokens: 200, thinkingTokens: 0,
                                    avgTTFT: 1.1, cacheHitRate: 1,
                                    cacheReadTokens: 5_000, tokenCacheHitRate: 0.5,
                                    avgGenTokPerSec: 100, // 2s streaming
                                },
                            },
                        },
                    ],
                },
            });

            const html = buildCalendarTabContent(store, 2026, 11);
            // Time-weighted speed: (1000 + 200) / (20 + 2) = 1200 / 22 = 54.545... -> 54.5 tok/s
            expect(html).toContain('54.5 tok/s');
            // Token-weighted cache hit: (90k + 5k) / (100k + 10k) = 95 / 110 = 86.36... -> 86.4%
            expect(html).toContain('86.4%');
            // Call-weighted TTFT: (0.5 * 5 + 1.1 * 1) / 6 = 0.6s -> 600ms
            expect(html).toContain('600ms');
        });
    });
});

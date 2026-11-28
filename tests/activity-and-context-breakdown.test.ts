// Consolidated Domain Suite: Activity Telemetry Panel, Context Breakdown & Turn Diagnostics
import { afterEach, describe, expect, it } from 'vitest';
import { buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { ActivityTracker } from '../src/activity-tracker';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { type Language, setLanguageToState } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';
import type { GMCallEntry, GMModelStats, GMSummary } from '../src/gm-tracker';
import type { ModelPricing } from '../src/pricing-store';
import {
    advanceBranchStepPeak,
    BranchStepPeakTracker,
    buildDotMatrix,
    CONTEXT_CATEGORY_META,
    CONTEXT_CATEGORY_ORDER,
    CONTEXT_FREE_SPACE_META,
    type ContextCategorySegment,
    formatContextTextReport,
    formatDotMatrixRows,
    formatHandoffPrompt,
    type GeneratorMetadataLike,
    getMeasurementNote,
    mapTokenTypeToCategory,
    parseContextBreakdown,
} from '../src/context-breakdown';
import { StepType } from '../src/constants';
import { analyzeTurnDiagnostics, classifyTurnStartKind, parseDurationSeconds } from '../src/turn-diagnostics';

describe('[activity-estimated-context]', () => {
    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    afterEach(() => setLanguageToState('both', state));


    describe('GM estimated context labels', () => {
        it.each(['en', 'zh', 'both'] as Language[])('distinguishes request estimates from reported tokens throughout the %s panel', async language => {
            await setLanguageToState(language, state);
            const calls = [0, 1].map(index => parseGMEntry({ stepIndices: [index + 1], chatModel: {
                model: 'MODEL_PLACEHOLDER_M419', responseModel: 'gemini-4-argon',
                usage: { inputTokens: 12905, outputTokens: 32 },
                completionConfig: { maxTokens: 65536, temperature: 1, topP: 1 },
                chatStartMetadata: { createdAt: `2026-10-31T00:00:0${index}.000Z`,
                    contextWindowMetadata: { estimatedTokensUsed: 18324, maxContextTokens: 256000,
                        tokenBreakdown: { groups: [{ name: 'Prompt', numTokens: 18324, children: [] }] } } },
            } }));
            const gm = buildSummaryFromConversations([{ cascadeId: 'fixture', title: 'Fixture', totalSteps: 2,
                coveredSteps: 2, coverageRate: 1, calls, checkpointSummaries: [] }], '2026-10-31T00:00:02.000Z')!;
            const summary = new ActivityTracker().getSummary();
            summary.totalReasoning = 2;
            summary.recentSteps = calls.map((call, index) => ({ timestamp: call.createdAt, category: 'reasoning',
                icon: '', model: call.modelDisplay, detail: '', durationMs: 0, stepIndex: index + 1,
                cascadeId: 'fixture', gmModel: call.model, gmInputTokens: call.inputTokens,
                gmOutputTokens: call.outputTokens, gmContextTokensUsed: call.contextTokensUsed }));
            const html = buildGMDataTabContent(summary, gm);
            const label = language === 'en' ? 'Estimated context' : language === 'zh' ? '估算上下文' : 'Estimated context / 估算上下文';
            const chart = language === 'en' ? 'Estimated context growth' : language === 'zh' ? '估算上下文增长' : 'Estimated context growth / 估算上下文增长';
            for (const className of ['act-tl-gm-tag act-tl-gm-ctx', 'seg-chip seg-chip-ctx', 'cp-card-chip cp-card-chip-step']) {
                expect(html).toContain(`class="${className}" data-popover-key=`);
                expect(html).not.toContain(`class="${className}" title=`);
                expect(html).toMatch(new RegExp(`class="${className}"[^>]*data-tip-body="[^"]+"[^>]*>${label} 18\\.3k`));
            }
            expect(html).toContain(chart);
            expect(html).toContain(language === 'zh' ? '可能与回复后报告的 Token 数不同' : 'may differ from the token counts reported after the response');
            expect(html).toContain(language === 'zh' ? '最新估算上下文 Token 分布' : 'Latest estimated context token distribution');
            expect(html).not.toContain('18.3k ctx');
            expect(html).not.toMatch(/>Ctx 18\.3k<|>上下文 18\.3k</);
            expect(calls.map(call => [call.contextTokensUsed, call.inputTokens, call.outputTokens])).toEqual([
                [18324, 12905, 32], [18324, 12905, 32],
            ]);
            expect(gm.contextGrowth.map(point => point.tokens)).toEqual([18324, 18324]);
        });
    });
});

describe('[activity-telemetry-panel]', () => {
    const state: StateBucket = {
        get: <T>(_key: string, fallback: T) => fallback,
        update: async () => {},
    };


    afterEach(async () => {
        await setLanguageToState('both', state);
    });


    function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-1',
            model: 'MODEL_PLACEHOLDER_M35',
            modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
            responseModel: 'claude-sonnet-4-6-thinking',
            modelAccuracy: 'exact',
            inputTokens: 4000,
            outputTokens: 600,
            thinkingTokens: 200,
            responseTokens: 400,
            cacheReadTokens: 16000,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 0.74,
            streamingSeconds: 6.0,
            credits: 1,
            creditType: 'AI',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 20600,
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
            stopReason: 'STOP_REASON_END_TURN',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: '2026-11-19T10:00:00.000Z',
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 200000,
            ...overrides,
        };
    }


    function makeGMSummary(calls: GMCallEntry[], cascadeId = 'conv-1'): GMSummary {
        return buildSummaryFromConversations([{
            cascadeId,
            title: 'Telemetry Session',
            totalSteps: calls.length,
            coveredSteps: calls.length,
            coverageRate: 1,
            calls,
            checkpointSummaries: [],
        }], '2026-11-19T10:10:00.000Z')!;
    }


    const CUSTOM_PRICING: Record<string, ModelPricing> = {
        'claude-sonnet-4-6-thinking': {
            input: 3.0,
            output: 15.0,
            cacheRead: 0.3,
            thinking: 15.0,
        },
    };


    describe('GM Data Tab — Speed, TTFT (Cached vs Uncached) & Prompt Cache Telemetry', () => {
        it('renders KPI strip from account-filtered GM summary (fixing #66 bug #7) and appends Speed, Avg TTFT, and token-weighted Cache Hit', async () => {
            await setLanguageToState('en', state);
            const calls = [
                // Uncached cold call: 100 tok/s, TTFT 2.15s, input 24000, cacheRead 0
                makeCall({
                    executionId: 'c1',
                    stepIndices: [1],
                    inputTokens: 24000,
                    outputTokens: 500,
                    thinkingTokens: 200,
                    responseTokens: 300,
                    cacheReadTokens: 0,
                    ttftSeconds: 2.15,
                    streamingSeconds: 5.0,
                    createdAt: '2026-11-19T10:00:00.000Z',
                }),
                // Cached warm call: 150 tok/s, TTFT 0.74s, input 4000, cacheRead 20000
                makeCall({
                    executionId: 'c2',
                    stepIndices: [2],
                    inputTokens: 4000,
                    outputTokens: 750,
                    thinkingTokens: 250,
                    responseTokens: 500,
                    cacheReadTokens: 20000,
                    ttftSeconds: 0.74,
                    streamingSeconds: 5.0,
                    createdAt: '2026-11-19T10:01:00.000Z',
                }),
                // Untimed call (ttft=0, streaming=0) — must NOT dilute Avg TTFT or speed
                makeCall({
                    executionId: 'c3',
                    stepIndices: [3],
                    inputTokens: 2000,
                    outputTokens: 100,
                    thinkingTokens: 0,
                    responseTokens: 100,
                    cacheReadTokens: 0,
                    ttftSeconds: 0,
                    streamingSeconds: 0,
                    createdAt: '2026-11-19T10:02:00.000Z',
                }),
            ];
            const gm = makeGMSummary(calls);
            const activity = new ActivityTracker().getSummary();
            // Simulate stale cross-account ActivityTracker totals (#66 bug #7)
            activity.gmTotalInputTokens = 999_000;
            activity.gmTotalOutputTokens = 888_000;
            activity.gmTotalCacheRead = 777_000;

            const html = buildGMDataTabContent(activity, gm, undefined, undefined, undefined, undefined, CUSTOM_PRICING);

            // Account-filtered GM totals win over cross-account ActivityTracker totals
            expect(html).toContain('<span class="act-stat-val val-in">30.0k</span>');
            expect(html).not.toContain('999.0k');

            // Weighted speed: (500 + 750) / (5 + 5) = 125.0 tok/s
            expect(html).toContain('act-stat-speed');
            expect(html).toContain('125.0 tok/s');
            // Tooltip contains visible resp tok/s ((300 + 500) / 10 = 80.0 tok/s) & p50 median (125.0 tok/s)
            expect(html).toContain('Visible resp 80.0 tok/s');
            expect(html).toContain('p50 median 125.0 tok/s');

            // Avg TTFT excludes ttft=0 call: (2.15 + 0.74) / 2 = 1.445 (IEEE-754 -> 1.44s)
            expect(html).toContain('act-stat-ttft');
            expect(html).toContain('1.44s');

            // Token-weighted Cache Hit: 20000 / (24000 + 4000 + 2000 + 20000) = 20000 / 50000 = 40.0%, with 1/3 call ratio
            expect(html).toContain('act-stat-cache-hit');
            expect(html).toContain('>40.0%<');
            expect(html).toContain('<span class="act-stat-sub">1/3</span>');
        });

        it('renders clean dashes in KPI strip when calls have zero timed samples and omits telemetry section when 0 calls', async () => {
            await setLanguageToState('en', state);
            const untimedGm = makeGMSummary([
                makeCall({ ttftSeconds: 0, streamingSeconds: 0, cacheReadTokens: 0, inputTokens: 0, outputTokens: 10 }),
            ]);
            const htmlUntimed = buildGMDataTabContent(null, untimedGm);
            expect(htmlUntimed).toContain('act-stat-speed');
            expect(htmlUntimed).toContain('<span class="act-stat-val val-speed">—</span>');
            expect(htmlUntimed).toContain('<span class="act-stat-val val-ttft">—</span>');
            expect(htmlUntimed).toContain('telemetry-ledger-section');
            expect(htmlUntimed).toContain('No timed streaming samples yet.');
            expect(htmlUntimed).toContain('No valid TTFT samples yet');

            // Activity-only (no GM calls) omits telemetry section completely
            const activityOnly = new ActivityTracker().getSummary();
            activityOnly.totalInputTokens = 1200;
            const htmlEmptyGm = buildGMDataTabContent(activityOnly, null);
            expect(htmlEmptyGm).not.toContain('telemetry-ledger-section');
            expect(htmlEmptyGm).not.toContain('act-stat-speed');
        });

        it('renders Speed & First-Token Cache editorial section with proportional Cached vs Uncached TTFT bars, delta pill, warmth badge, and priced savings', async () => {
            await setLanguageToState('en', state);
            const calls = [
                makeCall({
                    executionId: 'cold-1',
                    inputTokens: 10000,
                    outputTokens: 400,
                    thinkingTokens: 100,
                    responseTokens: 300,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 5000,
                    ttftSeconds: 2.15,
                    streamingSeconds: 5.0, // 80 tok/s
                    createdAt: '2026-11-19T10:00:00.000Z',
                }),
                makeCall({
                    executionId: 'warm-1',
                    inputTokens: 2000,
                    outputTokens: 600,
                    thinkingTokens: 200,
                    responseTokens: 400,
                    cacheReadTokens: 18000,
                    cacheCreationTokens: 0,
                    ttftSeconds: 0.74,
                    streamingSeconds: 5.0, // 120 tok/s
                    createdAt: '2026-11-19T10:01:00.000Z',
                }),
            ];
            const gm = makeGMSummary(calls);
            const html = buildGMDataTabContent(null, gm, undefined, undefined, undefined, undefined, CUSTOM_PRICING);

            expect(html).toContain('id="telemetryLedgerSection"');
            expect(html).toContain('Speed &amp; First-Token Cache');
            expect(html).toContain('Generation Speed &amp; TTFT');
            expect(html).toContain('Prompt Cache Efficiency &amp; Savings');

            // Left card speed hero + sub-metrics (Latest, Median p50, Range, Visible resp, End-to-End)
            expect(html).toContain('100.0 tok/s'); // weighted (400+600)/(5+5)
            expect(html).toContain('120.0 tok/s'); // latest
            expect(html).toContain('80.0–120.0 tok/s'); // range
            expect(html).toContain('Visible resp');
            expect(html).toContain('70.0 tok/s'); // visible (300+400)/10
            expect(html).toContain('End-to-End');

            // Cached vs Uncached TTFT tracks + signed delta pill: (0.74 - 2.15)/2.15 = -65.58% -> -66%
            expect(html).toContain('telemetry-bar-fill-cache');
            expect(html).toContain('telemetry-bar-fill-uncached');
            expect(html).toContain('740ms<span class="telemetry-sample-n">(n=1)</span>');
            expect(html).toContain('2.15s<span class="telemetry-sample-n">(n=1)</span>');
            expect(html).toContain('telemetry-delta-pill is-faster');
            expect(html).toContain('>-66%<');

            // Right card: Warm badge, Precision Capsule 3-segment stacked bar (Read + Fresh + Write), Reuse %, USD savings
            expect(html).toContain('telemetry-warmth-badge is-warm');
            expect(html).toContain('telemetry-cache-seg-read');
            expect(html).toContain('telemetry-cache-seg-fresh');
            expect(html).toContain('telemetry-cache-seg-write');
            expect(html).toContain('Cache Write');
            expect(html).toContain('Reuse');
            // 18000 / (18000 + 5000) = 78.3%
            expect(html).toContain('78.3%');
            // Priced cache read savings: 18000 * (3.0 - 0.3) / 1e6 = $0.0486 -> $0.05
            expect(html).toContain('18.0k');
            expect(html).toContain('telemetry-savings-usd');
            expect(html).toContain('$0.05');
        });

        it('handles single-bucket TTFT states honestly without fabricating the missing half, and omits USD savings for unpriced models', async () => {
            await setLanguageToState('en', state);

            // 1. All timed calls cached + unpriced model (Sonar M578 — unpriced in both mapped & strict modes)
            const allCachedGm = makeGMSummary([
                makeCall({
                    model: 'MODEL_PLACEHOLDER_M578',
                    modelDisplay: 'Gemini 4 Hydrogen (Sonar)',
                    responseModel: 'gemini-4-hydrogen-sonar',
                    inputTokens: 2000,
                    cacheReadTokens: 18000,
                    cacheCreationTokens: 0,
                    ttftSeconds: 0.65,
                    streamingSeconds: 4.0,
                }),
            ]);
            const htmlAllCached = buildGMDataTabContent(null, allCachedGm);
            expect(htmlAllCached).toContain('telemetry-bar-fill-cache');
            expect(htmlAllCached).not.toContain('telemetry-bar-fill-uncached');
            expect(htmlAllCached).not.toContain('telemetry-delta-pill');
            expect(htmlAllCached).toContain('All timed calls cached');
            // Unpriced savings: show saved tokens, NEVER fabricate $0.00!
            expect(htmlAllCached).toContain('<b>18.0k</b> tokens');
            expect(htmlAllCached).not.toContain('telemetry-savings-usd');
            expect(htmlAllCached).not.toContain('$0.00');
            expect(htmlAllCached).not.toContain('act-card-row-cost');

            // 2. Only uncached calls + warming state (cacheCreation > 0, cacheRead = 0)
            const uncachedWarmingGm = makeGMSummary([
                makeCall({
                    inputTokens: 8000,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 4000,
                    ttftSeconds: 1.85,
                    streamingSeconds: 3.0,
                }),
            ]);
            const htmlWarming = buildGMDataTabContent(null, uncachedWarmingGm);
            expect(htmlWarming).toContain('telemetry-bar-fill-uncached');
            expect(htmlWarming).not.toContain('telemetry-bar-fill-cache');
            expect(htmlWarming).not.toContain('telemetry-delta-pill');
            expect(htmlWarming).toContain('No cached TTFT samples yet');
            expect(htmlWarming).toContain('telemetry-warmth-badge is-warming');
        });

        it('renders neutral delta pill when cached TTFT is slower than uncached TTFT', async () => {
            await setLanguageToState('en', state);
            const gm = makeGMSummary([
                makeCall({ executionId: 'u1', cacheReadTokens: 0, ttftSeconds: 1.0, streamingSeconds: 2.0 }),
                makeCall({ executionId: 'c1', cacheReadTokens: 10000, ttftSeconds: 1.25, streamingSeconds: 2.0 }),
            ]);
            const html = buildGMDataTabContent(null, gm);
            expect(html).toContain('telemetry-delta-pill is-neutral');
            expect(html).toContain('>+25%<');
        });

        it('unifies Model Stats cards (fixing #66 bug #5), adds Speed + valid TTFT + token-weighted Cache Hit + Cache Write', async () => {
            await setLanguageToState('en', state);
            const calls = [
                makeCall({
                    executionId: 'm1',
                    modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
                    inputTokens: 24000,
                    outputTokens: 1200,
                    thinkingTokens: 400,
                    responseTokens: 800,
                    cacheReadTokens: 4000,
                    cacheCreationTokens: 1000,
                    ttftSeconds: 0.8,
                    streamingSeconds: 2.5,
                }),
                makeCall({
                    executionId: 'm2',
                    modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
                    inputTokens: 24000,
                    outputTokens: 1200,
                    thinkingTokens: 400,
                    responseTokens: 800,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    ttftSeconds: 2.0,
                    streamingSeconds: 2.5,
                }),
            ];
            const gm = makeGMSummary(calls);

            // GM-only (no Activity modelStats) — previously showed Steps instead of Calls (#66 bug #5)
            const html = buildGMDataTabContent(null, gm, undefined, undefined, undefined, undefined, CUSTOM_PRICING);
            expect(html).toContain('<span>Calls</span></span><span class="val val-calls">2</span>');
            expect(html).not.toContain('<span>Steps</span></span>');

            // Speed row: weighted (2400 / 5.0) = 480.0 tok/s, visible (1600 / 5.0) = 320.0 tok/s
            expect(html).toContain('<span>Speed</span>');
            expect(html).toContain('480.0 tok/s');
            expect(html).toContain('resp 320.0 tok/s');

            // Avg TTFT row: (0.8 + 2.0) / 2 = 1.40s, plus cached 800ms sub-value
            expect(html).toContain('<span>Avg TTFT</span>');
            expect(html).toContain('1.40s');
            expect(html).toContain('cached 800ms');

            // Cache Write row shown when > 0
            expect(html).toContain('<span>Cache Write</span></span><span class="val val-cache-write">1.0k</span>');

            // Token-weighted Cache Hit: 4000 / (24000 + 24000 + 4000 + 1000) = 4000 / 53000 = 7.5% · 1/2
            expect(html).toContain('<span>Cache Hit</span>');
            expect(html).toContain('<span>7.5%</span><span class="act-credit-calls">· 1/2</span>');
            expect(html).not.toContain('>50%<');

            // Fallback when conversations[] is empty (archived modelBreakdown only)
            const fallbackModelStats: Record<string, GMModelStats> = {
                'Archived Model': {
                    ...gm.modelBreakdown['Claude Sonnet 4.6 (Thinking)'],
                    callCount: 3,
                    totalInputTokens: 24000,
                    totalOutputTokens: 900,
                    totalThinkingTokens: 0,
                    totalCacheRead: 6000,
                    totalCacheCreation: 0,
                    avgTTFT: 0.9,
                    avgStreaming: 3.0,
                    cacheHitRate: 1.0,
                    timedOutputTokens: 900,
                    timedStreamingSeconds: 9.0,
                    ttftSampleCount: 3,
                    streamingSampleCount: 3,
                    cacheHitCalls: 3,
                },
            };
            const archivedGm: GMSummary = {
                ...gm,
                conversations: [],
                modelBreakdown: fallbackModelStats,
                totalCalls: 3,
            };
            const htmlArchived = buildGMDataTabContent(null, archivedGm);
            expect(htmlArchived).toContain('100.0 tok/s');
            expect(htmlArchived).toContain('900ms');
            // Token-weighted 6000 / 30000 = 20.0% · 3/3 (NOT call-only 100%)
            expect(htmlArchived).toContain('<span>20.0%</span><span class="act-credit-calls">· 3/3</span>');
        });

        it('renders Timeline per-step Speed, adaptive TTFT, Stream, and additive Cache % pills plus per-turn header telemetry pills', async () => {
            await setLanguageToState('en', state);
            const gm = makeGMSummary([makeCall()]);
            const activity = new ActivityTracker().getSummary();
            activity.totalReasoning = 2;
            activity.recentSteps = [
                {
                    timestamp: '2026-11-19T10:00:00.000Z',
                    icon: '💬',
                    category: 'user',
                    model: '',
                    detail: 'Analyze telemetry',
                    durationMs: 0,
                    cascadeId: 'conv-1',
                    userInput: 'Analyze telemetry',
                    stepIndex: 1,
                },
                {
                    // Valid speed: 500 / 5.0 = 100.0 tok/s, TTFT 740ms, Stream 5.00s, Cache: 16000 / (3000+16000+1000) = 80.0%
                    timestamp: '2026-11-19T10:00:05.000Z',
                    icon: '🧠',
                    category: 'reasoning',
                    model: 'Claude Sonnet 4.6 (Thinking)',
                    detail: 'Checked files',
                    durationMs: 5740,
                    cascadeId: 'conv-1',
                    stepIndex: 2,
                    gmModel: 'claude-sonnet-4-6-thinking',
                    gmInputTokens: 3000,
                    gmOutputTokens: 500,
                    gmThinkingTokens: 150,
                    gmCacheReadTokens: 16000,
                    gmCacheCreationTokens: 1000,
                    gmTTFT: 0.74,
                    gmStreamingDuration: 5.0,
                },
                {
                    // Invalid speed sample (1 output token, 0.02s stream) — speed pill MUST be omitted; TTFT 1.50s
                    timestamp: '2026-11-19T10:00:10.000Z',
                    icon: '🧠',
                    category: 'reasoning',
                    model: 'Claude Sonnet 4.6 (Thinking)',
                    detail: 'Tiny reply',
                    durationMs: 1520,
                    cascadeId: 'conv-1',
                    stepIndex: 3,
                    gmModel: 'claude-sonnet-4-6-thinking',
                    gmInputTokens: 1000,
                    gmOutputTokens: 1,
                    gmCacheReadTokens: 0,
                    gmTTFT: 1.5,
                    gmStreamingDuration: 0.02,
                },
            ];

            const html = buildGMDataTabContent(activity, gm, { cascadeId: 'conv-1' } as any, undefined, undefined, undefined, CUSTOM_PRICING);

            // Per-step pills
            expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-speed">100.0 tok/s</span>');
            expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-ttft"><span>TTFT 740ms</span></span>');
            expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-ttft"><span>TTFT 1.50s</span></span>');
            expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-stream"><span>Stream 5.00s</span></span>');
            expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-cache-hit"><span>Cache 80.0%</span></span>');
            // Invalid speed step (1 / 0.02 = 50 tok/s) MUST NOT appear as a speed tag
            expect(html).not.toContain('50.0 tok/s');

            // Per-turn header pills:
            // Weighted speed from valid step only: 500 / 5.0 = 100.0 tok/s
            expect(html).toContain('<span class="seg-chip seg-chip-speed">100.0 tok/s</span>');
            // Turn avg TTFT: (0.74 + 1.5) / 2 = 1.12s
            expect(html).toContain('<span class="seg-chip seg-chip-ttft"><span>TTFT 1.12s</span></span>');
            // Turn token-weighted Cache %: 16000 / (3000 + 1000 + 16000 + 1000) = 16000 / 21000 = 76.2%
            expect(html).toContain('<span class="seg-chip seg-chip-cache-hit"><span>Cache 76.2%</span></span>');
        });

        it.each(['en', 'zh', 'both'] as Language[])('produces zero banned 令牌 translation and zero glued bilingual units in %s mode', async language => {
            await setLanguageToState(language, state);
            const calls = [
                makeCall({
                    executionId: 'l1',
                    inputTokens: 10000,
                    outputTokens: 400,
                    thinkingTokens: 150,
                    responseTokens: 250,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 2000,
                    ttftSeconds: 1.8,
                    streamingSeconds: 4.0,
                }),
                makeCall({
                    executionId: 'l2',
                    inputTokens: 2000,
                    outputTokens: 600,
                    thinkingTokens: 200,
                    responseTokens: 400,
                    cacheReadTokens: 18000,
                    cacheCreationTokens: 0,
                    ttftSeconds: 0.6,
                    streamingSeconds: 5.0,
                }),
            ];
            const gm = makeGMSummary(calls);
            const activity = new ActivityTracker().getSummary();
            activity.totalReasoning = 1;
            activity.recentSteps = [
                {
                    timestamp: '2026-11-19T10:01:00.000Z',
                    icon: '🧠',
                    category: 'reasoning',
                    model: 'Claude Sonnet 4.6 (Thinking)',
                    detail: 'Step',
                    durationMs: 5600,
                    cascadeId: 'conv-1',
                    stepIndex: 1,
                    gmModel: 'claude-sonnet-4-6-thinking',
                    gmInputTokens: 2000,
                    gmOutputTokens: 600,
                    gmThinkingTokens: 200,
                    gmCacheReadTokens: 18000,
                    gmTTFT: 0.6,
                    gmStreamingDuration: 5.0,
                },
            ];

            const html = buildGMDataTabContent(activity, gm, { cascadeId: 'conv-1' } as any, undefined, undefined, undefined, CUSTOM_PRICING);

            // Zero banned 令牌 translation
            expect(html).not.toContain('令牌');

            // Inline-flex tags wrap bilingual text inside a single <span> so numbers never glue to units
            expect(html).not.toMatch(/class="(?:act-tl-gm-tag|seg-chip|telemetry-pill|telemetry-warmth-badge)[^"]*">[^<]*<span class="bi-en">/);
            expect(html).not.toMatch(/Turn\s*\/\s*第\s*\d+\s*\/\s*轮/);
        });

        it('ships balanced, Studio Telemetry Ledger CSS with opaque pill backings and 680px responsive grid collapse', () => {
            const css = getGMDataTabStyles();
            const opens = (css.match(/\{/g) || []).length;
            const closes = (css.match(/\}/g) || []).length;
            expect(opens).toBe(closes);
            expect(opens).toBeGreaterThan(100);

            // Responsive collapse for telemetry ledger grid
            expect(css).toContain('@media (max-width: 680px)');
            expect(css).toContain('.telemetry-ledger-grid');

            // Zero legacy 3px rainbow left stripes
            expect(css).not.toMatch(/border-left:\s*3px/);

            // Opaque surface backing on colored telemetry badges/pills
            expect(css).toContain('.telemetry-warmth-badge.is-warm');
            expect(css).toContain('.telemetry-delta-pill.is-faster');
            expect(css).toContain('.act-tl-gm-speed { background: var(--ed-surface);');
            expect(css).toContain('.act-tl-gm-cache-hit { background: var(--ed-surface);');
            expect(css).toContain('.seg-chip-speed { border-color: var(--ed-accent-border); background: var(--ed-surface);');
            expect(css).toContain('.seg-chip-cache-hit { border-color: var(--ed-border-strong); background: var(--ed-surface);');
            expect(css).toContain('.recent-calls-card');
            expect(css).toContain('.recent-calls-table-wrap');
            expect(css).toContain('.recent-calls-table');
        });

        it('renders the collapsible Recent Calls Ledger table with USD costs, noise gate, unpriced badge, and 20-row cap', async () => {
            await setLanguageToState('zh', state);
            const calls: GMCallEntry[] = [
                // Row with tiny decode burst (<0.05s) -> speed noise-gated to —
                makeCall({
                    executionId: 'c-burst',
                    model: 'MODEL_PLACEHOLDER_M427',
                    modelDisplay: 'Gemini 4 Carbon (High)',
                    responseModel: 'gemini-4-carbon',
                    inputTokens: 2897,
                    outputTokens: 196,
                    thinkingTokens: 50,
                    cacheReadTokens: 221_677,
                    ttftSeconds: 6.4,
                    streamingSeconds: 0.02,
                    createdAt: '2026-11-22T01:00:00.000Z',
                }),
                // Row with 4543 in, 388 out, 97.96% cache, 6.0s TTFT, 8.5s total, 155.2 tok/s
                makeCall({
                    executionId: 'c-steady',
                    model: 'MODEL_PLACEHOLDER_M427',
                    modelDisplay: 'Gemini 4 Carbon (High)',
                    responseModel: 'gemini-4-carbon',
                    inputTokens: 4543,
                    outputTokens: 388,
                    thinkingTokens: 120,
                    cacheReadTokens: 218_153,
                    ttftSeconds: 6.0,
                    streamingSeconds: 2.5,
                    createdAt: '2026-11-22T01:01:00.000Z',
                }),
                // Unpriced specialized model with error -> honest Unpriced badge & Error status (never $0.00)
                makeCall({
                    executionId: 'c-unpriced',
                    model: 'MODEL_PLACEHOLDER_M578',
                    modelDisplay: 'Gemini 4 Hydrogen (Sonar)',
                    responseModel: 'gemini-4-hydrogen-sonar',
                    inputTokens: 1000,
                    outputTokens: 50,
                    thinkingTokens: 0,
                    cacheReadTokens: 0,
                    ttftSeconds: 1.2,
                    streamingSeconds: 1.0,
                    hasError: true,
                    errorMessage: '429 rate limit',
                    createdAt: '2026-11-22T01:02:00.000Z',
                }),
            ];
            // Add 22 older calls to verify latest-20 cap
            for (let i = 0; i < 22; i++) {
                calls.push(makeCall({
                    executionId: `old-${i}`,
                    createdAt: `2026-11-22T00:${String(i).padStart(2, '0')}:00.000Z`,
                }));
            }

            const gm = makeGMSummary(calls);
            const html = buildGMDataTabContent(null, gm, null, undefined, undefined, undefined, {});

            expect(html).toContain('id="recentCallsLedger"');
            expect(html).toContain('class="recent-calls-table-wrap" tabindex="0" role="region" aria-label="');
            expect(html).toContain('class="recent-calls-table"');
            expect(html).toContain('20 / 25');
            expect(html).toContain('gemini-4-carbon');
            expect(html).toContain('97.96%');
            expect(html).toContain('8.50s');
            expect(html).toContain('155.2 tok/s');
            expect(html).toContain('class="rc-cost-val">$');
            expect(html).not.toMatch(/[\u00a5\uffe5]/);
            expect(html).toContain('class="rc-unpriced"');
            expect(html).toContain('未定价');
            expect(html).toContain('rc-status is-err');
            expect(html).toContain('rc-status is-ok');
            expect(html).not.toContain('令牌');
            // Exactly 20 <tr> rows inside <tbody>
            const tbodyMatch = html.match(/<table class="recent-calls-table">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
            expect(tbodyMatch).toBeTruthy();
            expect(tbodyMatch![1].match(/<tr[\s>]/g)).toHaveLength(20);
        });

        it('keeps undated scheduled-cutover calls Unpriced in Recent Calls Ledger and guards micro-USD savings', async () => {
            await setLanguageToState('en', state);
            const undatedCarbon = makeCall({
                executionId: 'undated-carbon',
                model: 'MODEL_PLACEHOLDER_M427',
                modelDisplay: 'Gemini 4 Carbon (High)',
                responseModel: 'gemini-4-carbon',
                inputTokens: 1_000_000,
                outputTokens: 0,
                cacheReadTokens: 0,
                createdAt: '',
            });
            const undatedHtml = buildGMDataTabContent(null, makeGMSummary([undatedCarbon]), null, undefined, undefined, undefined, {});
            expect(undatedHtml).toContain('class="rc-unpriced"');
            expect(undatedHtml).not.toContain('$2.00');

            // Micro-USD cache savings: 10 cached tokens on Neon ($2.85/M = $0.0000285) -> '<$0.0001' (never '$0.0000')
            const microCall = makeCall({
                executionId: 'micro-save',
                model: 'MODEL_PLACEHOLDER_M535',
                modelDisplay: 'Gemini 4 Neon (XHigh)',
                responseModel: 'gemini-4-neon',
                inputTokens: 100,
                outputTokens: 50,
                cacheReadTokens: 10,
                createdAt: '2026-11-22T01:00:00.000Z',
            });
            const microUsdHtml = buildGMDataTabContent(null, makeGMSummary([microCall]), null, undefined, undefined, undefined, {});
            expect(microUsdHtml).toContain('class="telemetry-savings-usd">· &lt;$0.0001</span>');
            expect(microUsdHtml).not.toContain('class="telemetry-savings-usd">· $0.0000</span>');
            expect(microUsdHtml).not.toContain('$NaN');
            expect(microUsdHtml).not.toMatch(/[\u00a5\uffe5]/);
        });
    });
});

describe('[context-breakdown]', () => {
    describe('mapTokenTypeToCategory', () => {
        it('maps Antigravity TOKEN_TYPE_* enums accurately across all categories', () => {
            expect(mapTokenTypeToCategory('TOKEN_TYPE_SYSTEM_PROMPT')).toBe('system');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_CHECKPOINT')).toBe('system');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_SKILLS')).toBe('rules_skills');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_RULES')).toBe('rules_skills');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_USER_RULES')).toBe('rules_skills');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_WORKFLOWS')).toBe('rules_skills');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_PLUGINS')).toBe('plugins_mcp');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_MCP_SERVERS')).toBe('plugins_mcp');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_SUBAGENTS')).toBe('subagents');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_SWARM')).toBe('subagents');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_USER_MESSAGE')).toBe('user');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_ASSISTANT')).toBe('assistant_thinking');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_THINKING')).toBe('assistant_thinking');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_TOOLS')).toBe('tools');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_TOOL_RESULTS')).toBe('tools');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_MEDIA')).toBe('media_files');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_FILES')).toBe('media_files');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_UNKNOWN')).toBe('other');
        });

        it('falls back cleanly to section title heuristics when tokenType is generic or absent', () => {
            expect(mapTokenTypeToCategory('', 'System Instructions')).toBe('system');
            expect(mapTokenTypeToCategory('TOKEN_TYPE_GENERIC', 'AGENTS.md Rules')).toBe('rules_skills');
            expect(mapTokenTypeToCategory(undefined, 'MCP Server Catalog')).toBe('plugins_mcp');
            expect(mapTokenTypeToCategory(undefined, 'Swarm Worker Roster')).toBe('subagents');
            expect(mapTokenTypeToCategory(undefined, 'Open Files & Screenshots')).toBe('media_files');
            expect(mapTokenTypeToCategory(undefined, 'Unclassified Misc Blob')).toBe('other');
        });
    });


    describe('parseContextBreakdown', () => {
        it('parses promptSections + additive chatModel.usage with dual-cap metadata accurately', () => {
            const gm: GeneratorMetadataLike[] = [
                {
                    stepIndices: [1, 2],
                    plannerConfig: { truncationThresholdTokens: 512_000 },
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M532',
                        modelDisplayName: 'Gemini 4 Neon (High)',
                        promptSections: [
                            { title: 'Core System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 40_000 },
                            { title: 'Workspace Rules', tokenType: 'TOKEN_TYPE_RULES', contentLen: 12_000 },
                            { title: 'Loaded Skills', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 8_000 },
                            { title: 'Installed Plugins', tokenType: 'TOKEN_TYPE_PLUGINS', contentLen: 16_000 },
                            { title: 'Subagent Definitions', tokenType: 'TOKEN_TYPE_SUBAGENTS', contentLen: 4_000 },
                        ],
                        usage: {
                            // Additive prompt tokens = 10_000 + 40_000 + 0 = 50_000
                            // Output = 2_400 (thinkingOutputTokens=1_000 is subset, NOT summed)
                            inputTokens: 10_000,
                            cacheReadTokens: 40_000,
                            outputTokens: 2_400,
                            thinkingOutputTokens: 1_000,
                            responseOutputTokens: 1_400,
                        },
                        chatStartMetadata: {
                            createdAt: '2026-11-22T10:00:00Z',
                        },
                    },
                },
            ];

            const steps = [
                { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Explain the architecture in detail.' } },
                {
                    stepIndex: 1,
                    type: 'CORTEX_STEP_TYPE_VIEW_FILE',
                    viewFile: { absolutePath: '/repo/src/tracker.ts' },
                    metadata: { toolCallOutputTokens: 12_000, toolCall: { name: 'read_file' } },
                },
                {
                    stepIndex: 2,
                    type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
                    metadata: { toolCallOutputTokens: 8_000, toolCall: { name: 'run_command' } },
                },
            ];

            const snap = parseContextBreakdown({ generatorMetadata: gm, steps });

            expect(snap.measurementState).toBe('measured');
            expect(snap.attributionSource).toBe('prompt_sections');
            expect(snap.hasPromptSections).toBe(true);
            expect(snap.model).toBe('MODEL_PLACEHOLDER_M532');
            expect(snap.modelDisplayName).toBe('Gemini 4 Neon (High)');

            // Dual cap: 512k effective autocompact vs 1,048,576 native ceiling
            expect(snap.effectiveBudgetTokens).toBe(512_000);
            expect(snap.nativeLimitTokens).toBe(1_048_576);
            expect(snap.hasDualCap).toBe(true);

            // Total used should equal 50_000 prompt + 2_400 output = 52_400 (thinking NOT double counted!)
            expect(snap.usedTokens).toBe(52_400);
            expect(snap.effectivePct).toBeCloseTo(10.2, 1);
            expect(snap.nativePct).toBeCloseTo(5.0, 1);

            const byKey = Object.fromEntries(snap.segments.map(s => [s.key, s]));
            expect(byKey.system.tokens).toBe(10_000);
            expect(byKey.rules_skills.tokens).toBe(5_000);
            expect(byKey.rules_skills.itemCount).toBe(2);
            expect(byKey.plugins_mcp.tokens).toBe(4_000);
            expect(byKey.subagents.tokens).toBe(1_000);
            expect(byKey.assistant_thinking.tokens).toBe(2_400);
            // Remaining 30,000 prompt tokens attributed across user/media_files/tools from steps
            expect(byKey.media_files.tokens).toBeGreaterThan(0);
            expect(byKey.tools.tokens).toBeGreaterThan(0);

            // Largest items capped at <= 5 and sorted descending
            expect(snap.largestItems.length).toBeLessThanOrEqual(5);
            expect(snap.largestItems[0].tokens).toBeGreaterThanOrEqual(snap.largestItems[1].tokens);
        });

        it('scales promptSections proportionally when contentLen/4 exceeds measured prompt tokens', () => {
            const snap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [1],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M402',
                            promptSections: [
                                { title: 'Huge System', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 400_000 }, // 100k est
                                { title: 'Huge Skills', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 400_000 }, // 100k est
                            ],
                            usage: { inputTokens: 20_000, cacheReadTokens: 0, outputTokens: 500 },
                        },
                    },
                ],
            });

            expect(snap.usedTokens).toBe(20_500);
            const sys = snap.segments.find(s => s.key === 'system')!;
            const rules = snap.segments.find(s => s.key === 'rules_skills')!;
            expect(sys.tokens).toBe(10_000);
            expect(rules.tokens).toBe(10_000);
        });

        it('falls back gracefully to step-level attribution when promptSections are absent without fabricating fake zeros', () => {
            const steps = [
                { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Please inspect package.json and run tests.' } },
                {
                    stepIndex: 1,
                    type: 'CORTEX_STEP_TYPE_VIEW_FILE',
                    viewFile: { absolutePath: '/workspace/package.json' },
                    metadata: { toolCallOutputTokens: 1_500, toolCall: { name: 'read_file' } },
                },
                {
                    stepIndex: 2,
                    type: 'CORTEX_STEP_TYPE_MCP_TOOL',
                    metadata: { toolCallOutputTokens: 900, toolCall: { name: 'mcp__github__list_issues' }, toolSource: 'mcp' },
                },
                {
                    stepIndex: 3,
                    type: StepType.PLANNER_RESPONSE,
                    plannerResponse: { response: 'All checks look good.', thinking: 'Checking dependencies...' },
                    metadata: {
                        generatorModel: 'MODEL_PLACEHOLDER_M405',
                        modelUsage: { inputTokens: 4_000, cacheReadTokens: 6_000, outputTokens: 300 },
                    },
                },
            ];

            const snap = parseContextBreakdown({ steps });

            expect(snap.measurementState).toBe('measured');
            expect(snap.attributionSource).toBe('steps');
            expect(snap.hasPromptSections).toBe(false);
            expect(snap.usedTokens).toBe(10_300);

            // No fake zero segments emitted for unmeasured categories like rules_skills or subagents
            expect(snap.segments.every(s => s.tokens > 0)).toBe(true);
            expect(snap.segments.find(s => s.key === 'rules_skills')).toBeUndefined();
            expect(snap.segments.find(s => s.key === 'subagents')).toBeUndefined();

            expect(snap.segments.find(s => s.key === 'media_files')?.tokens).toBe(1_500);
            expect(snap.segments.find(s => s.key === 'plugins_mcp')?.tokens).toBe(900);
            expect(snap.segments.find(s => s.key === 'system')?.tokens).toBeGreaterThan(0);
        });

        it('classifies brand-new pre-generation conversation as awaiting_generation without fake zeros', () => {
            const emptySnap = parseContextBreakdown({ generatorMetadata: [], steps: [] });
            expect(emptySnap.measurementState).toBe('awaiting_generation');
            expect(emptySnap.usedTokens).toBe(0);
            expect(emptySnap.segments).toEqual([]);
            expect(emptySnap.largestItems).toEqual([]);
            expect(Number.isNaN(emptySnap.effectivePct)).toBe(false);

            const pendingUserSnap = parseContextBreakdown({
                steps: [
                    { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Hello Antigravity!' } },
                ],
                model: 'MODEL_PLACEHOLDER_M532',
            });
            expect(pendingUserSnap.measurementState).toBe('awaiting_generation');
            expect(pendingUserSnap.usedTokens).toBeGreaterThan(0);
            expect(pendingUserSnap.segments.map(s => s.key)).toEqual(['user']);
        });

        it('detects compaction checkpoints across generations and marks unmeasured post-compaction state', () => {
            // Case 1: Completed compaction followed by measured post-compaction generation
            const completedSnap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [4],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M402',
                            usage: { inputTokens: 20_000, cacheReadTokens: 180_000, outputTokens: 1_500 },
                            chatStartMetadata: { checkpointIndex: 0, createdAt: '2026-11-22T10:00:00Z' },
                        },
                    },
                    {
                        stepIndices: [7],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M402',
                            usage: { inputTokens: 30_000, cacheReadTokens: 5_000, outputTokens: 1_000 },
                            chatStartMetadata: { checkpointIndex: 1, createdAt: '2026-11-22T10:05:00Z' },
                        },
                    },
                ],
                steps: [
                    { stepIndex: 5, type: StepType.CHECKPOINT, checkpoint: { checkpointIndex: 1, sessionSummary: 'Compacted summary' }, metadata: { createdAt: '2026-11-22T10:04:00Z' } },
                    { stepIndex: 7, type: StepType.PLANNER_RESPONSE, plannerResponse: { response: 'Continued.' } },
                ],
                currentStepCount: 8,
                previousMaxStepCount: 6,
            });

            expect(completedSnap.measurementState).toBe('measured');
            expect(completedSnap.compactionCheckpoints).toHaveLength(1);
            expect(completedSnap.compactionCheckpoints[0]).toMatchObject({
                stepIndex: 5,
                beforeTokens: 200_000,
                afterTokens: 35_000,
                savedTokens: 165_000,
                timestamp: '2026-11-22T10:04:00Z',
            });

            // Case 2: Full compaction checkpoint occurred AFTER latest generation -> estimated_post_compaction
            const pendingCompactionSnap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [4],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M402',
                            promptSections: [
                                { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 40_000 },
                            ],
                            usage: { inputTokens: 190_000, cacheReadTokens: 0, outputTokens: 1_000 },
                        },
                    },
                ],
                steps: [
                    { stepIndex: 5, type: StepType.CHECKPOINT, checkpoint: { checkpointIndex: 1, tokens: 4_000, sessionSummary: 'Summary of prior work' }, metadata: { createdAt: '2026-11-22T10:06:00Z' } },
                    { stepIndex: 6, type: StepType.USER_INPUT, userInput: { userResponse: 'Now run the tests' } },
                ],
                currentStepCount: 7,
                previousMaxStepCount: 5,
            });

            expect(pendingCompactionSnap.measurementState).toBe('estimated_post_compaction');
            expect(pendingCompactionSnap.usedTokens).toBeLessThan(30_000);
            expect(pendingCompactionSnap.compactionCheckpoints).toHaveLength(1);
            expect(pendingCompactionSnap.compactionCheckpoints[0].savedTokens).toBeGreaterThan(150_000);
        });

        it('treats a completed checkpoint at the start of a recovered suffix as an estimate until a later planner reading', () => {
            const before = { stepIndices: [218], chatModel: { usage: { inputTokens: 330_000, outputTokens: 800 } } };
            const checkpoint = { type: StepType.CHECKPOINT, status: 'CORTEX_STEP_STATUS_DONE',
                checkpoint: { sessionSummary: 'Existing summary' },
                metadata: { modelUsage: { inputTokens: 331_000, outputTokens: 5515 } } };
            for (const generatorMetadata of [[], [before], [{ ...before, stepIndices: [221] }]]) {
                const snap = parseContextBreakdown({ steps: [checkpoint], suffixStartOffset: 221, generatorMetadata });
                expect(snap.measurementState).toBe('estimated_post_compaction');
                expect(snap.usedTokens).toBeGreaterThan(0);
                expect(snap.usedTokens).toBeLessThan(100);
            }
            const toolOnly = parseContextBreakdown({ steps: [checkpoint,
                { type: 'CORTEX_STEP_TYPE_TOOL', metadata: { modelUsage: { inputTokens: 200_000 } } }],
                suffixStartOffset: 221, generatorMetadata: [before] });
            expect(toolOnly.measurementState).toBe('estimated_post_compaction');
            expect(toolOnly.usedTokens).toBeLessThan(100);
            const resumed = parseContextBreakdown({ steps: [checkpoint,
                { type: StepType.PLANNER_RESPONSE, metadata: { modelUsage: { inputTokens: 30_000, outputTokens: 120 } } }],
                suffixStartOffset: 221, generatorMetadata: [before] });
            expect(resumed.measurementState).toBe('measured');
            expect(resumed.usedTokens).toBe(30_120);
            for (const status of ['CORTEX_STEP_STATUS_ERROR', 'CORTEX_STEP_STATUS_RUNNING']) {
                const failed = parseContextBreakdown({ steps: [{ ...checkpoint, status }], suffixStartOffset: 221, generatorMetadata: [before] });
                expect(failed.measurementState).toBe('measured');
                expect(failed.compactionCheckpoints).toEqual([]);
            }
        });

        it('uses wire decimal indices for a post-checkpoint call and rejects out-of-range indices', () => {
            const steps = [{ stepIndex: 12, type: StepType.CHECKPOINT, checkpoint: { sessionSummary: 'summary' } }];
            const newer = { stepIndices: ['13'], chatModel: { usage: { inputTokens: 5300 } } };
            expect(parseGMEntry(newer).stepIndices).toEqual([13]);
            expect(parseContextBreakdown({ steps, generatorMetadata: [newer] })).toMatchObject({
                usedTokens: 5300, measurementState: 'measured',
            });
            const invalid = { ...newer, stepIndices: ['', -1, '12.5', '200001', '3e2'] };
            expect(parseGMEntry(invalid).stepIndices).toEqual([]);
            expect(parseContextBreakdown({ steps, generatorMetadata: [invalid] }).measurementState).toBe('estimated_post_compaction');
        });

        it('classifies shrinking step count as estimated_rewind and NEVER as compaction', () => {
            const snap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            usage: { inputTokens: 180_000, cacheReadTokens: 0, outputTokens: 500 },
                        },
                    },
                    {
                        stepIndices: [3],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            usage: { inputTokens: 25_000, cacheReadTokens: 0, outputTokens: 500 },
                        },
                    },
                ],
                steps: [
                    { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Initial prompt' } },
                    { stepIndex: 1, type: StepType.PLANNER_RESPONSE, plannerResponse: { response: 'Initial reply' } },
                ],
                currentStepCount: 4,
                previousMaxStepCount: 15,
            });

            expect(snap.measurementState).toBe('estimated_rewind');
            expect(snap.compactionCheckpoints).toEqual([]);
            expect(snap.recommendedBranchPeakStepCount).toBe(4);
        });

        it('breaks out of estimated_rewind immediately on post-rewind forward growth, fork, or post-compaction without all-time peak stickiness', () => {
            const gmAtStep5: GeneratorMetadataLike[] = [
                {
                    stepIndices: [5],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M532',
                        usage: { inputTokens: 32_000, cacheReadTokens: 0, outputTokens: 800 },
                    },
                },
            ];

            // 1. Forward step growth after rewind (4 -> 5, still well below old all-time peak 15!) -> measured immediately!
            const forwardSnap = parseContextBreakdown({
                generatorMetadata: gmAtStep5,
                currentStepCount: 5,
                previousStepCount: 4,
                previousMaxStepCount: 15,
            });
            expect(forwardSnap.measurementState).toBe('measured');
            expect(forwardSnap.recommendedBranchPeakStepCount).toBe(5);

            // 2. Forked trajectory at step 5 (retaining old all-time peak 15) -> measured immediately!
            const forkSnap = parseContextBreakdown({
                generatorMetadata: gmAtStep5,
                currentStepCount: 5,
                previousMaxStepCount: 15,
                isFork: true,
            });
            expect(forkSnap.measurementState).toBe('measured');
            expect(forkSnap.recommendedBranchPeakStepCount).toBe(5);

            // 3. BranchStepPeakTracker full lifecycle: grow to 15 -> rewind to 4 -> parked at 4 -> grow to 5 -> compact -> fork to 3
            const tracker = new BranchStepPeakTracker();
            const r1 = tracker.observe('conv-1', { stepCount: 15, hasMeasuredGeneration: true });
            expect(r1.isRewind).toBe(false);
            expect(r1.state.branchPeakStepCount).toBe(15);

            // Rewind to step 4 -> estimated_rewind AND resets branchPeakStepCount to 4!
            const r2 = tracker.observe('conv-1', { stepCount: 4, hasMeasuredGeneration: false });
            expect(r2.isRewind).toBe(true);
            expect(r2.peakReset).toBe(true);
            expect(r2.state.branchPeakStepCount).toBe(4);
            const snapRewind = parseContextBreakdown({
                generatorMetadata: gmAtStep5,
                currentStepCount: 4,
                branchPeakStepCount: r2.effectiveBranchPeakStepCount,
            });
            expect(snapRewind.measurementState).toBe('estimated_rewind');

            // Still parked at step 4 with no new generation -> stays in rewind
            const r3 = tracker.observe('conv-1', { stepCount: 4, hasMeasuredGeneration: false });
            expect(r3.isRewind).toBe(true);

            // User sends new turn on rewound branch -> step 5 (< old 15!) exits rewind IMMEDIATELY!
            const r4 = tracker.observe('conv-1', { stepCount: 5, hasMeasuredGeneration: true });
            expect(r4.isRewind).toBe(false);
            expect(r4.state.branchPeakStepCount).toBe(5);
            const snapRecovered = parseContextBreakdown({
                generatorMetadata: gmAtStep5,
                currentStepCount: 5,
                branchPeakStepCount: r4.effectiveBranchPeakStepCount,
            });
            expect(snapRecovered.measurementState).toBe('measured');

            // Post-compaction reset -> resets peak cleanly even if step count changes on next branch
            const r5 = tracker.observe('conv-1', { stepCount: 7, hasPostCompactionReset: true, branchRevision: 'branch-a' });
            expect(r5.isRewind).toBe(false);
            expect(r5.peakReset).toBe(true);
            expect(r5.state.branchPeakStepCount).toBe(7);

            // Branch revision switch at step 3 -> NOT stuck in estimated_rewind!
            const r6 = advanceBranchStepPeak(r5.state, { stepCount: 3, branchRevision: 'branch-b' });
            expect(r6.isRewind).toBe(false);
            expect(r6.state.branchPeakStepCount).toBe(3);

            // Explicit fork at step 2 -> NOT stuck in estimated_rewind!
            const r7 = advanceBranchStepPeak(r5.state, { stepCount: 2, isFork: true });
            expect(r7.isRewind).toBe(false);
            expect(r7.state.branchPeakStepCount).toBe(2);
        });

        it('truncates long titles in largestItems and caps at 5 items', () => {
            const longTitle = 'A'.repeat(140) + '\nwith\tnewlines';
            const sections = Array.from({ length: 8 }, (_, idx) => ({
                title: idx === 0 ? longTitle : `Section ${idx}`,
                tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT',
                contentLen: (10 - idx) * 4_000,
            }));

            const snap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [1],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            promptSections: sections,
                            usage: { inputTokens: 52_000, outputTokens: 500 },
                        },
                    },
                ],
            });

            expect(snap.largestItems).toHaveLength(5);
            expect(snap.largestItems[0].title.length).toBeLessThanOrEqual(80);
            expect(snap.largestItems[0].title.endsWith('...')).toBe(true);
            expect(snap.largestItems[0].title).not.toContain('\n');
        });

        it('falls back to tokenBreakdown.groups when promptSections are omitted', () => {
            const snap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M402',
                            usage: { inputTokens: 15_000, cacheReadTokens: 15_000, outputTokens: 1_000 },
                            chatStartMetadata: {
                                contextWindowMetadata: {
                                    maxContextTokens: 256_000,
                                    tokenBreakdown: {
                                        groups: [
                                            {
                                                name: 'System Prompt',
                                                type: 'TOKEN_TYPE_SYSTEM_PROMPT',
                                                numTokens: 12_000,
                                                children: [{ name: 'Core Instructions', numTokens: 12_000 }],
                                            },
                                            {
                                                name: 'Tool Results',
                                                type: 'TOKEN_TYPE_TOOLS',
                                                numTokens: 18_000,
                                                children: [{ name: 'run_command output', numTokens: 18_000 }],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                ],
            });

            expect(snap.attributionSource).toBe('token_breakdown');
            expect(snap.measurementState).toBe('measured');
            expect(snap.usedTokens).toBe(31_000);
            expect(snap.effectiveBudgetTokens).toBe(256_000);
            expect(snap.hasDualCap).toBe(true);
            expect(snap.largestItems[0]).toMatchObject({
                title: 'run_command output',
                category: 'tools',
                tokens: 18_000,
            });
        });

        it('handles single-cap models and explicit budget overrides cleanly', () => {
            const singleCap = parseContextBreakdown({
                generatorMetadata: [{ chatModel: { usage: { inputTokens: 50_000 } } }],
                effectiveBudgetTokens: 200_000,
                nativeLimitTokens: 200_000,
            });
            expect(singleCap.hasDualCap).toBe(false);
            expect(singleCap.effectivePct).toBe(25);
            expect(singleCap.nativePct).toBe(25);

            const clampedCap = parseContextBreakdown({
                generatorMetadata: [{ chatModel: { usage: { inputTokens: 50_000 } } }],
                effectiveBudgetTokens: 300_000,
                nativeLimitTokens: 200_000,
            });
            expect(clampedCap.nativeLimitTokens).toBe(300_000);
            expect(clampedCap.hasDualCap).toBe(false);
        });

        it('does not flag intentOnly checkpoints as post-compaction estimation', () => {
            const snap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [2],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            usage: { inputTokens: 20_000, cacheReadTokens: 10_000, outputTokens: 500 },
                        },
                    },
                ],
                steps: [
                    { stepIndex: 3, type: StepType.CHECKPOINT, checkpoint: { intentOnly: true, userIntent: 'Summarize intent' } },
                ],
            });
            expect(snap.measurementState).toBe('measured');
            expect(snap.compactionCheckpoints).toEqual([]);
        });

        it('extracts per-category topItems (max 3) before global top-5 truncation and exposes plain-language meta & unified 子智能体 label', () => {
            // 6 huge tools items completely dominate global largestItems (top 5),
            // while rules_skills (4 items) and plugins_mcp (2 items) must STILL retain their own top 3 topItems!
            const snap = parseContextBreakdown({
                generatorMetadata: [
                    {
                        stepIndices: [10],
                        chatModel: {
                            model: 'MODEL_PLACEHOLDER_M532',
                            promptSections: [
                                { title: 'Tool Log 1', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 30_000 },
                                { title: 'Tool Log 2', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 25_000 },
                                { title: 'Tool Log 3', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 20_000 },
                                { title: 'Tool Log 4', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 18_000 },
                                { title: 'Tool Log 5', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 15_000 },
                                { title: 'Tool Log 6', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 12_000 },
                                { title: 'AGENTS.md Rule', tokenType: 'TOKEN_TYPE_RULES', numTokens: 4_500 },
                                { title: 'Skill A', tokenType: 'TOKEN_TYPE_SKILLS', numTokens: 3_200 },
                                { title: 'Skill B', tokenType: 'TOKEN_TYPE_SKILLS', numTokens: 2_100 },
                                { title: 'Skill C', tokenType: 'TOKEN_TYPE_SKILLS', numTokens: 900 },
                                { title: 'MCP Server Alpha', tokenType: 'TOKEN_TYPE_MCP_SERVERS', numTokens: 1_800 },
                                { title: 'MCP Server Beta', tokenType: 'TOKEN_TYPE_MCP_TOOLS', numTokens: 1_100 },
                                { title: 'Swarm Worker', tokenType: 'TOKEN_TYPE_SUBAGENTS', numTokens: 600 },
                            ],
                            usage: { inputTokens: 135_200, cacheReadTokens: 0, outputTokens: 1_000 },
                        },
                    },
                ],
                effectiveBudgetTokens: 512_000,
            });

            expect(snap.largestItems).toHaveLength(5);
            expect(snap.largestItems.every(it => it.category === 'tools')).toBe(true);

            const byKey = Object.fromEntries(snap.segments.map(s => [s.key, s]));
            expect(byKey.tools.topItems).toHaveLength(3);
            expect(byKey.tools.topItems.map(i => i.title)).toEqual(['Tool Log 1', 'Tool Log 2', 'Tool Log 3']);

            // Not lost to global top-5 truncation!
            expect(byKey.rules_skills.topItems).toHaveLength(3);
            expect(byKey.rules_skills.topItems.map(i => i.title)).toEqual(['AGENTS.md Rule', 'Skill A', 'Skill B']);
            expect(byKey.plugins_mcp.topItems).toHaveLength(2);
            expect(byKey.plugins_mcp.topItems.map(i => i.title)).toEqual(['MCP Server Alpha', 'MCP Server Beta']);
            expect(byKey.subagents.labelZh).toBe('子智能体');
            expect(byKey.subagents.topItems).toHaveLength(1);
            expect(byKey.subagents.topItems[0].title).toBe('Swarm Worker');

            // Verify metadata completeness & unified terminology across all 9 categories + free space
            for (const key of CONTEXT_CATEGORY_ORDER) {
                const m = CONTEXT_CATEGORY_META[key];
                expect(m.descEn.trim().length, `missing descEn for ${key}`).toBeGreaterThan(10);
                expect(m.descZh.trim().length, `missing descZh for ${key}`).toBeGreaterThan(5);
                expect(m.tipEn.trim().length, `missing tipEn for ${key}`).toBeGreaterThan(10);
                expect(m.tipZh.trim().length, `missing tipZh for ${key}`).toBeGreaterThan(5);
                expect(m.labelZh).not.toContain('子代理');
                expect(m.descZh + m.tipZh).not.toContain('令牌');
            }
            expect(CONTEXT_FREE_SPACE_META.descEn.length).toBeGreaterThan(10);
            expect(CONTEXT_FREE_SPACE_META.descZh.length).toBeGreaterThan(5);
            expect(CONTEXT_FREE_SPACE_META.tipEn.length).toBeGreaterThan(10);
            expect(CONTEXT_FREE_SPACE_META.tipZh.length).toBeGreaterThan(5);
            expect(getMeasurementNote('measured', 'zh')).toContain('实测');
            expect(getMeasurementNote('estimated_post_compaction', 'en')).toContain('post-compaction');
        });
    });


    describe('buildDotMatrix & formatDotMatrixRows', () => {
        const makeSeg = (key: (typeof CONTEXT_CATEGORY_ORDER)[number], tokens: number): ContextCategorySegment => {
            const meta = CONTEXT_CATEGORY_META[key];
            return {
                key,
                labelEn: meta.labelEn,
                labelZh: meta.labelZh,
                colorToken: meta.colorToken,
                tokens,
                pct: 0,
                sharePct: 0,
                itemCount: 1,
                topItems: [],
            };
        };

        it('returns 100 free dots when usage is 0 or segments are empty', () => {
            const empty = buildDotMatrix([], 0, 256_000);
            expect(empty).toHaveLength(100);
            expect(empty.every(c => c.isFree && c.category === 'free')).toBe(true);

            const zeroTokens = buildDotMatrix([makeSeg('system', 0)], 0, 256_000);
            expect(zeroTokens).toHaveLength(100);
            expect(zeroTokens.every(c => c.isFree)).toBe(true);
        });

        it('gives every non-empty segment >= 1 dot and keeps exact gridSize length', () => {
            const segments = [
                makeSeg('system', 50_000),
                makeSeg('rules_skills', 50), // tiny 0.02% segment
                makeSeg('plugins_mcp', 20),  // tiny 0.008% segment
                makeSeg('user', 25_000),
            ];
            const total = 75_070;
            const cells = buildDotMatrix(segments, total, 250_000, 100);

            expect(cells).toHaveLength(100);
            const countOf = (cat: string) => cells.filter(c => c.category === cat).length;
            expect(countOf('system')).toBeGreaterThanOrEqual(1);
            expect(countOf('rules_skills')).toBeGreaterThanOrEqual(1);
            expect(countOf('plugins_mcp')).toBeGreaterThanOrEqual(1);
            expect(countOf('user')).toBeGreaterThanOrEqual(1);
            expect(countOf('free')).toBeGreaterThan(60);
            expect(cells.map(c => c.index)).toEqual(Array.from({ length: 100 }, (_, i) => i));
        });

        it('clamps overflow usage >= 100% cleanly to exact gridSize with zero free dots', () => {
            const segments = [
                makeSeg('system', 100_000),
                makeSeg('tools', 200_000),
                makeSeg('subagents', 100),
            ];
            const cells = buildDotMatrix(segments, 300_100, 200_000, 100);

            expect(cells).toHaveLength(100);
            expect(cells.filter(c => c.isFree)).toHaveLength(0);
            expect(cells.filter(c => c.category === 'subagents').length).toBeGreaterThanOrEqual(1);
            expect(cells.filter(c => c.category === 'tools').length).toBeGreaterThan(
                cells.filter(c => c.category === 'system').length,
            );
        });

        it('handles tiny grid sizes and formats 20x5 and 10x10 row layouts', () => {
            const segments = [
                makeSeg('system', 500),
                makeSeg('user', 300),
                makeSeg('tools', 200),
                makeSeg('other', 100),
            ];
            const tiny = buildDotMatrix(segments, 1_100, 2_000, 2);
            expect(tiny).toHaveLength(2);
            expect(tiny.map(c => c.category)).toEqual(['system', 'user']);

            const grid100 = buildDotMatrix(segments, 1_100, 2_000, 100);
            const rows20x5 = formatDotMatrixRows(grid100, 20);
            expect(rows20x5).toHaveLength(5);
            expect(rows20x5.every(r => r.length === 20)).toBe(true);

            const rows10x10 = formatDotMatrixRows(grid100, 10);
            expect(rows10x10).toHaveLength(10);
            expect(rows10x10.every(r => r.length === 10)).toBe(true);

            // Zero capacity and NaN inputs stay safe and exact length
            const zeroCap = buildDotMatrix(segments, 1_100, 0, 100);
            expect(zeroCap).toHaveLength(100);
            expect(zeroCap.filter(c => c.isFree)).toHaveLength(0);

            const nanInputs = buildDotMatrix(segments, Number.NaN, Number.NaN, 100);
            expect(nanInputs).toHaveLength(100);
        });
    });


    describe('formatContextTextReport & formatHandoffPrompt', () => {
        const sampleSnapshot = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [3],
                    plannerConfig: { truncationThresholdTokens: 256_000 },
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M402',
                        modelDisplayName: 'Claude Opus 5.5 (High)',
                        promptSections: [
                            { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 40_000 },
                            { title: 'Workspace Rules', tokenType: 'TOKEN_TYPE_RULES', contentLen: 16_000 },
                        ],
                        usage: { inputTokens: 18_000, cacheReadTokens: 82_000, outputTokens: 2_000 },
                    },
                },
            ],
            nativeLimitTokens: 1_000_000,
        });

        it('renders EN, ZH, and Both /context text reports with dual-cap, table, largest items, and quota summary', () => {
            const reportInput = {
                snapshot: sampleSnapshot,
                title: 'Implement Antigravity App Support',
                workspacePath: '/Users/dev/antigravity',
                branchName: 'feat/v1.17.5',
                cacheHitPct: 82.0,
                turnStartKind: 'warm' as const,
                quotaSummary: [
                    { poolName: 'Claude & GPT', remainingPct: 68, resetCountdown: '3h12m', runwayLabel: 'Safe before reset' },
                ],
            };

            const en = formatContextTextReport(reportInput, 'en');
            expect(en).toContain('Context Window Report');
            expect(en).toContain('Claude Opus 5.5 (High)');
            expect(en).toContain('effective budget');
            expect(en).toContain('Native Ceiling');
            expect(en).toContain('Category Breakdown');
            expect(en).toContain('Largest Items');
            expect(en).toContain('Quota Summary');
            expect(en).toContain('Claude & GPT');
            expect(en).toContain('Warm Cache');
            expect(en).not.toContain('上下文窗口报告');

            const zh = formatContextTextReport(reportInput, 'zh');
            expect(zh).toContain('上下文窗口报告');
            expect(zh).toContain('有效预算');
            expect(zh).toContain('原生上限');
            expect(zh).toContain('分类明细');
            expect(zh).toContain('最大占用项');
            expect(zh).toContain('配额摘要');
            expect(zh).toContain('热缓存');
            expect(zh).not.toContain('Context Window Report');

            const both = formatContextTextReport(reportInput, 'both');
            expect(both).toContain('Context Window Report / 上下文窗口报告');
            expect(both).toContain('Category Breakdown / 分类明细');
            expect(both).toContain('System Prompt / 系统提示');
        });

        it('renders practical HANDOFF.md prompts in EN, ZH, and Both modes', () => {
            const handoffInput = {
                snapshot: sampleSnapshot,
                title: 'Migrate telemetry core',
                workspacePath: '/Users/dev/antigravity',
                branchName: 'main',
                recentTopics: ['Dual-cap context breakdown', 'Quota runway prediction'],
                activeTools: ['read_file', 'edit_file', 'run_command', 'read_file'],
                pendingTasks: ['Wire sidecar panel UI', 'Run full Vitest matrix'],
            };

            const en = formatHandoffPrompt(handoffInput, 'en');
            expect(en).toContain('# HANDOFF — Session Continuation');
            expect(en).toContain('/Users/dev/antigravity');
            expect(en).toContain('Dual-cap context breakdown');
            expect(en).toContain('`read_file`, `edit_file`, `run_command`');
            expect(en).toContain('- [ ] Wire sidecar panel UI');

            const zh = formatHandoffPrompt(handoffInput, 'zh');
            expect(zh).toContain('# HANDOFF — 会话交接继续执行');
            expect(zh).toContain('## 续接检查清单');
            expect(zh).toContain('## 常用工具');

            const both = formatHandoffPrompt({ snapshot: sampleSnapshot }, 'both');
            expect(both).toContain('Session Context / 会话概况');
            expect(both).toContain('Resume Checklist / 续接检查清单');
            expect(both).toContain('- [ ] ');

            // Verify awaiting_generation and estimated_rewind report notes render cleanly
            const rewindSnap = parseContextBreakdown({
                steps: [],
                currentStepCount: 2,
                previousMaxStepCount: 10,
            });
            expect(formatContextTextReport({ snapshot: rewindSnap }, 'en')).toContain('Estimated (rewind)');
            expect(formatContextTextReport({ snapshot: rewindSnap }, 'zh')).toContain('估算（回退）');

            const awaitingSnap = parseContextBreakdown({ steps: [] });
            expect(formatContextTextReport({ snapshot: awaitingSnap }, 'en')).toContain('Awaiting generation');
            expect(formatContextTextReport({ snapshot: awaitingSnap }, 'zh')).toContain('等待生成');
        });
    });
});

describe('[turn-diagnostics]', () => {
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
});

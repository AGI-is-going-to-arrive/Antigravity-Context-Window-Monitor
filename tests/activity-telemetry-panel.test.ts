import { afterEach, describe, expect, it } from 'vitest';
import { buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { ActivityTracker } from '../src/activity-tracker';
import type { GMCallEntry, GMModelStats, GMSummary } from '../src/gm-tracker';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { setLanguageToState, type Language } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';
import type { ModelPricing } from '../src/pricing-store';

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

        // 1. All timed calls cached + unpriced model (Orchestrator Neon = MODEL_PLACEHOLDER_M537)
        const allCachedGm = makeGMSummary([
            makeCall({
                model: 'MODEL_PLACEHOLDER_M537',
                modelDisplay: 'Orchestrator (Neon)',
                responseModel: 'gemini-4-carbon-low',
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
        expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-ttft">TTFT 740ms</span>');
        expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-ttft">TTFT 1.50s</span>');
        expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-stream"><span>Stream 5.00s</span></span>');
        expect(html).toContain('<span class="act-tl-gm-tag act-tl-gm-cache-hit"><span>Cache 80.0%</span></span>');
        // Invalid speed step (1 / 0.02 = 50 tok/s) MUST NOT appear as a speed tag
        expect(html).not.toContain('50.0 tok/s');

        // Per-turn header pills:
        // Weighted speed from valid step only: 500 / 5.0 = 100.0 tok/s
        expect(html).toContain('<span class="seg-chip seg-chip-speed">100.0 tok/s</span>');
        // Turn avg TTFT: (0.74 + 1.5) / 2 = 1.12s
        expect(html).toContain('<span class="seg-chip seg-chip-ttft">TTFT 1.12s</span>');
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

    it('renders the collapsible Recent Calls Ledger table with screenshot-parity columns, CNY costs, noise gate, unpriced badge, and 20-row cap', async () => {
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
            // Row matching screenshot Row 2: 4543 in, 388 out, 97.96% cache, 6.0s TTFT, 8.5s total, 155.2 tok/s
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
            // Unpriced orchestrator call with error -> honest Unpriced badge & Error status (never $0.00)
            makeCall({
                executionId: 'c-unpriced',
                model: 'MODEL_PLACEHOLDER_M537',
                modelDisplay: 'Orchestrator (Neon)',
                responseModel: 'gemini-pro-orchestrator-neon',
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
        const html = buildGMDataTabContent(null, gm, null, undefined, undefined, undefined, {}, { currency: 'CNY', cnyRate: 7.2 });

        expect(html).toContain('id="recentCallsLedger"');
        expect(html).toContain('class="recent-calls-table-wrap" tabindex="0" role="region" aria-label="');
        expect(html).toContain('class="recent-calls-table"');
        expect(html).toContain('20 / 25');
        expect(html).toContain('gemini-4-carbon');
        expect(html).toContain('97.96%');
        expect(html).toContain('8.50s');
        expect(html).toContain('155.2 tok/s');
        expect(html).toContain('¥');
        expect(html).toContain('class="rc-unpriced"');
        expect(html).toContain('未定价');
        expect(html).toContain('rc-status is-err');
        expect(html).toContain('rc-status is-ok');
        expect(html).not.toContain('令牌');
        // Exactly 20 <tr> rows inside <tbody>
        const tbodyMatch = html.match(/<table class="recent-calls-table">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
        expect(tbodyMatch).toBeTruthy();
        expect(tbodyMatch![1].match(/<tr>/g)).toHaveLength(20);
    });

    it('keeps undated scheduled-cutover calls Unpriced in Recent Calls Ledger and guards micro-CNY savings (#31 #2/#9)', async () => {
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
        const undatedHtml = buildGMDataTabContent(null, makeGMSummary([undatedCarbon]), null, undefined, undefined, undefined, {}, { currency: 'USD', cnyRate: 7.2 });
        expect(undatedHtml).toContain('class="rc-unpriced"');
        expect(undatedHtml).not.toContain('$2.00');

        // Micro-CNY cache savings: 100 cached tokens on Neon ($2.85/M = $0.000285) at cnyRate 0.01 -> ¥0.00000285 -> '<¥0.0001' (never '¥0.0000')
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
        const microCnyHtml = buildGMDataTabContent(null, makeGMSummary([microCall]), null, undefined, undefined, undefined, {}, { currency: 'CNY', cnyRate: 0.01 });
        expect(microCnyHtml).toContain('class="telemetry-savings-usd">· &lt;¥0.0001</span>');
        expect(microCnyHtml).not.toContain('class="telemetry-savings-usd">· ¥0.0000</span>');
        expect(microCnyHtml).not.toContain('$NaN');
    });
});

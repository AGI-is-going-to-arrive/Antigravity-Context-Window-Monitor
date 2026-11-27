import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildAccountStatusPanel,
    buildGMDataTabContent,
    getGMDataTabStyles,
    type AccountSnapshot,
} from '../src/activity-panel';
import { ActivityTracker } from '../src/activity-tracker';
import type { GMCallEntry, GMModelStats, GMSummary, PersistedModelDNA } from '../src/gm-tracker';
import { setLanguageToState, type Language } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';
import {
    buildOrchestratorSplitCardHtml,
    computeOrchestratorSplit,
    getOrchestratorAttributionStyles,
    renderCallRoleBadgeHtml,
} from '../src/orchestrator-attribution';
import {
    buildActiveOrchestratorPricingCard,
    buildModelDNACards,
    buildPricingTabContent,
    getPricingTabStyles,
} from '../src/pricing-panel';
import { PricingStore } from '../src/pricing-store';
import { buildChatHistoryTabContent } from '../src/webview-chat-history-tab';
import type { TrajectorySummary } from '../src/tracker';
import type { LedgerAccountBucket, LedgerSettledEntry } from '../src/daily-ledger';
import type { MonthCostBreakdown } from '../src/daily-store';
import type { OrchestratorSettings } from '../src/models';

const langState: StateBucket = {
    get: <T>(_key: string, fallback: T) => fallback,
    update: async () => {},
};

afterEach(async () => {
    vi.useRealTimers();
    await setLanguageToState('both', langState);
});

// ─── Shared Frozen HTML Contract Assertions ──────────────────────────────────

function extractAttributeValues(html: string, attrName: string): string[] {
    const regex = new RegExp(`${attrName}="([^"]*)"`, 'g');
    const values: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        values.push(match[1]);
    }
    return values;
}

function assertFrozenRichTipContract(html: string, contextLabel: string): void {
    // 1. Zero legacy CSS data-tooltip attributes
    expect(html, `${contextLabel}: must not emit legacy data-tooltip`).not.toMatch(/\bdata-tooltip="/);

    // 2. Zero native title="..." attributes on elements (no duplicate IDE tooltip)
    expect(html, `${contextLabel}: must not emit native title="..."`).not.toMatch(/(?<![a-z-])title="/);

    // 3. Every data-popover-key must be non-empty and globally unique
    const keys = extractAttributeValues(html, 'data-popover-key');
    expect(keys.length, `${contextLabel}: expected at least one data-popover-key`).toBeGreaterThan(0);
    const seen = new Map<string, number>();
    const duplicates: string[] = [];
    for (const key of keys) {
        expect(key.trim().length, `${contextLabel}: empty data-popover-key`).toBeGreaterThan(0);
        const count = (seen.get(key) || 0) + 1;
        seen.set(key, count);
        if (count === 2) {
            duplicates.push(key);
        }
    }
    expect(duplicates, `${contextLabel}: duplicate data-popover-key values`).toEqual([]);

    // 4. Every data-tip-html-id must match an existing <template id="...">
    const htmlIds = extractAttributeValues(html, 'data-tip-html-id');
    for (const id of htmlIds) {
        expect(html, `${contextLabel}: missing <template id="${id}">`).toContain(`<template id="${id}">`);
    }

    // 5. Zero banned terminology
    expect(html, `${contextLabel}: banned term 令牌`).not.toContain('令牌');
    expect(html, `${contextLabel}: banned term 编排器模型`).not.toContain('编排器模型');
    expect(html, `${contextLabel}: banned term 执行器模型`).not.toContain('执行器模型');

    // 6. Inline-flex tags never glue bilingual spans directly next to bare numbers
    expect(
        html,
        `${contextLabel}: glued bilingual span inside inline-flex chip`,
    ).not.toMatch(/class="(?:act-tl-gm-tag|seg-chip|telemetry-pill|telemetry-warmth-badge)[^"]*">[^<]*<span class="bi-en">/);
}

function assertBalancedCssBraces(css: string, label: string): void {
    const opens = (css.match(/\{/g) || []).length;
    const closes = (css.match(/\}/g) || []).length;
    expect(opens, `${label}: balanced CSS braces`).toBe(closes);
    expect(opens, `${label}: non-empty CSS`).toBeGreaterThan(10);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeGMCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    const todayIso = new Date().toISOString();
    return {
        executionId: 'exec-1',
        stepIndices: [2],
        model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
        modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
        responseModel: 'claude-sonnet-4-6',
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        accountEmail: 'alice@example.com',
        inputTokens: 4000,
        outputTokens: 600,
        thinkingTokens: 200,
        responseTokens: 400,
        cacheReadTokens: 16000,
        cacheCreationTokens: 1000,
        toolOutputTokens: 0,
        credits: 1,
        ttftSeconds: 0.72,
        streamingSeconds: 5.0,
        stopReason: 'STOP_REASON_STOP_PATTERN',
        completionConfig: {
            maxTokens: 65536,
            temperature: 1,
            firstTemperature: 0.4,
            topK: 40,
            topP: 0.95,
            stopPatterns: ['</final>'],
        },
        hasSystemPrompt: true,
        toolCount: 19,
        promptSectionTitles: ['System Preamble', 'Tool Definitions'],
        systemPromptSnippet: 'You are an expert assistant.',
        createdAt: todayIso,
        contextTokensUsed: 24500,
        maxContextTokens: 200000,
        tokenBreakdown: [
            { name: 'System Prompt', tokens: 6000 },
            { name: 'Conversation', tokens: 18500 },
        ],
        retries: 0,
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        errorMessage: '',
        ephemeralCount: 3,
        ...overrides,
    };
}

const ALL_19_TOOLS = [
    'run_command', 'command_status', 'send_command_input', 'read_terminal',
    'view_file', 'view_file_outline', 'view_code_item', 'write_to_file',
    'replace_file_content', 'multi_replace_file_content', 'grep_search',
    'find_by_name', 'list_dir', 'browser_subagent', 'read_url_content',
    'search_web', 'notify_user', 'task_boundary', 'generate_image',
];

function makeRichGMData(): {
    activity: ReturnType<ActivityTracker['getSummary']>;
    gm: GMSummary;
    accounts: AccountSnapshot[];
    todayLedger: LedgerAccountBucket[];
    settledLedger: LedgerSettledEntry[];
} {
    const nowBase = Date.now() - 120_000;
    const atOffset = (sec: number) => new Date(nowBase + sec * 1000).toISOString();
    const calls: GMCallEntry[] = [
        // 1. Cold start call
        makeGMCall({
            executionId: 'exec-cold',
            stepIndices: [2],
            inputTokens: 18000,
            outputTokens: 500,
            thinkingTokens: 150,
            responseTokens: 350,
            cacheReadTokens: 0,
            cacheCreationTokens: 2000,
            ttftSeconds: 1.9,
            streamingSeconds: 4.5,
            createdAt: atOffset(2),
            contextTokensUsed: 20000,
        }),
        // 2. Compaction drop + Mapped Base model (Gemini 4 Carbon orchestrator placeholder)
        makeGMCall({
            executionId: 'exec-mapped-compact',
            stepIndices: [3],
            model: 'MODEL_PLACEHOLDER_M667',
            modelDisplay: 'Gemini 4 Carbon (Orchestrator)',
            responseModel: 'MODEL_PLACEHOLDER_M667',
            inputTokens: 2000,
            outputTokens: 400,
            thinkingTokens: 100,
            responseTokens: 300,
            cacheReadTokens: 3000,
            cacheCreationTokens: 0,
            ttftSeconds: 0.85,
            streamingSeconds: 4.0,
            createdAt: atOffset(20),
            contextTokensUsed: 5000,
        }),
        // 3. Short-sample + retry call (<16 tokens & <0.3s)
        makeGMCall({
            executionId: 'exec-short-retry',
            stepIndices: [4],
            inputTokens: 4000,
            outputTokens: 5,
            thinkingTokens: 0,
            responseTokens: 5,
            cacheReadTokens: 6000,
            cacheCreationTokens: 0,
            ttftSeconds: 0.5,
            streamingSeconds: 0.1,
            retries: 1,
            retryTokensIn: 500,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: ['503'],
            createdAt: atOffset(35),
            contextTokensUsed: 10500,
        }),
        // 4. HTTP 429 error call (unpriced custom model)
        makeGMCall({
            executionId: 'exec-err-429',
            stepIndices: [5],
            model: 'MODEL_CUSTOM_UNKNOWN_X',
            modelDisplay: 'Unknown Experimental X',
            responseModel: 'unknown-experimental-x',
            inputTokens: 1200,
            outputTokens: 0,
            thinkingTokens: 0,
            responseTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            ttftSeconds: 0,
            streamingSeconds: 0,
            hasError: true,
            errorMessage: 'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded',
            createdAt: atOffset(45),
            contextTokensUsed: 11000,
        }),
        // 5. HTTP 504 timeout error call
        makeGMCall({
            executionId: 'exec-err-504',
            stepIndices: [6],
            model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
            modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
            responseModel: 'claude-sonnet-4-6',
            inputTokens: 1200,
            outputTokens: 0,
            thinkingTokens: 0,
            responseTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            ttftSeconds: 0,
            streamingSeconds: 0,
            hasError: true,
            errorMessage: 'HTTP 504 GATEWAY_TIMEOUT: deadline exceeded',
            createdAt: atOffset(55),
            contextTokensUsed: 11000,
        }),
        // 6. Latest warm cached call (keeps latest warmth badge = Warm + gives faster cached TTFT delta)
        makeGMCall({
            executionId: 'exec-warm',
            stepIndices: [7],
            inputTokens: 2500,
            outputTokens: 700,
            thinkingTokens: 250,
            responseTokens: 450,
            cacheReadTokens: 28000,
            cacheCreationTokens: 0,
            ttftSeconds: 0.65,
            streamingSeconds: 5.5,
            createdAt: atOffset(75),
            contextTokensUsed: 30500,
        }),
    ];

    const sonnetStats: GMModelStats = {
        calls: 3,
        callCount: 3,
        stepsCovered: 3,
        totalInputTokens: 24500,
        totalOutputTokens: 1205,
        totalThinkingTokens: 400,
        totalCacheRead: 34000,
        totalCacheCreation: 2000,
        totalCredits: 3,
        avgTTFT: 1.02,
        minTTFT: 0.5,
        maxTTFT: 1.9,
        avgStreaming: 3.37,
        cacheHitRate: 0.56,
        responseModel: 'claude-sonnet-4-6',
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        completionConfig: calls[0].completionConfig,
        hasSystemPrompt: true,
        toolCount: 19,
        promptSectionTitles: ['System Preamble', 'Tool Definitions'],
        totalRetries: 1,
        errorCount: 0,
        creditCallCount: 3,
        exactCallCount: 3,
        placeholderOnlyCalls: 0,
        contextWindowCapacity: 200000,
    };

    const checkpointOnlyStats: GMModelStats = {
        ...sonnetStats,
        calls: 1,
        callCount: 1,
        stepsCovered: 1,
        totalInputTokens: 500,
        totalOutputTokens: 120,
        totalThinkingTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCredits: 0,
        creditCallCount: 0,
        responseModel: 'gemini-3-flash',
        isCheckpointOnly: true,
    };

    const mappedOpusStats: GMModelStats = {
        ...sonnetStats,
        calls: 1,
        callCount: 1,
        stepsCovered: 1,
        totalInputTokens: 5000,
        totalOutputTokens: 400,
        totalThinkingTokens: 100,
        totalCacheRead: 5000,
        totalCacheCreation: 0,
        totalCredits: 2,
        responseModel: 'MODEL_PLACEHOLDER_M667',
        exactCallCount: 0,
        placeholderOnlyCalls: 1,
    };

    const gm: GMSummary = {
        conversations: [{
            cascadeId: 'conv-ux-1',
            title: 'UX Tooltip Audit Session',
            totalSteps: 6,
            coveredSteps: 5,
            coverageRate: 5 / 6,
            calls,
            checkpointSummaries: [{
                checkpointNumber: 1,
                stepIndex: 4,
                tokens: 500,
                fullText: 'USER Objective: audit tooltips across tabs.',
            }],
            systemContextItems: [
                {
                    type: 'checkpoint',
                    checkpointNumber: 1,
                    stepIndex: 4,
                    tokens: 500,
                    label: 'Checkpoint #1',
                    fullText: 'USER Objective: audit tooltips across tabs.',
                },
                {
                    type: 'system_preamble',
                    stepIndex: 0,
                    tokens: 1800,
                    label: 'System Preamble',
                    fullText: 'You are an expert assistant.',
                },
                {
                    type: 'ephemeral',
                    stepIndex: 3,
                    tokens: 320,
                    label: 'Ephemeral',
                    fullText: 'Open editor: src/activity-panel.ts',
                },
            ],
        }],
        modelBreakdown: {
            'Claude Sonnet 4.6 (Thinking)': sonnetStats,
            'Claude Opus 5.5 (Orchestrator)': mappedOpusStats,
            'Gemini 3 Flash (Checkpoint)': checkpointOnlyStats,
        },
        totalCalls: 5,
        totalStepsCovered: 5,
        totalCredits: 5,
        totalInputTokens: 30700,
        totalOutputTokens: 1605,
        totalThinkingTokens: 500,
        totalCacheRead: 39000,
        totalCacheCreation: 2000,
        contextGrowth: [
            { stepIndex: 2, tokens: 20000, maxTokens: 200000, timestamp: '2026-11-26T10:00:02.000Z' },
            { stepIndex: 3, tokens: 30500, maxTokens: 200000, timestamp: '2026-11-26T10:00:20.000Z' },
            { stepIndex: 4, tokens: 10000, maxTokens: 200000, timestamp: '2026-11-26T10:00:40.000Z' },
        ],
        fetchedAt: '2026-11-26T10:01:10.000Z',
        totalRetryTokens: 500,
        totalRetryCredits: 0,
        totalRetryCount: 1,
        latestTokenBreakdown: [
            { name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM', tokens: 6000, children: [] },
            { name: 'Conversation', type: 'TOKEN_TYPE_CONVERSATION', tokens: 18500, children: [] },
        ],
        stopReasonCounts: { STOP_REASON_STOP_PATTERN: 4 },
        retryErrorCodes: { '503': 1, '429': 1 },
        recentErrors: [
            'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded',
        ],
        recentErrorEntries: [
            {
                code: '429',
                message: 'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded',
                createdAt: '2026-11-26T10:01:05.000Z',
            },
        ],
        toolCallCounts: { view_file: 4, run_command: 2 },
        toolCatalog: ALL_19_TOOLS.map((name, idx) => ({
            name,
            firstSeen: `2026-11-26T10:00:${String(idx).padStart(2, '0')}.000Z`,
        })),
        accountBreakdown: {
            'alice@example.com': { calls: 4, errorCount: 1, credits: 5, inputTokens: 30000, outputTokens: 1605 },
        },
        modelAccountBreakdown: {
            'Claude Sonnet 4.6 (Thinking)': {
                'alice@example.com': { calls: 3, errorCount: 1 },
            },
        },
    };

    const activity = new ActivityTracker().getSummary();
    activity.totalReasoning = 4;
    activity.totalToolCalls = 2;
    activity.totalCheckpoints = 1;
    activity.totalUserInputs = 1;
    activity.totalInputTokens = 30700;
    activity.totalOutputTokens = 1605;
    activity.totalToolOutputTokens = 320;
    activity.modelStats['Gemini 3 Flash (Checkpoint)'] = {
        totalSteps: 1,
        reasoning: 0,
        toolCalls: 0,
        checkpoints: 1,
        estSteps: 0,
        inputTokens: 500,
        outputTokens: 120,
        toolOutputTokens: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
    } as any;
    activity.recentSteps = [
        {
            // Step before any user anchor -> triggers "AI actions (no user anchor)"
            timestamp: '2026-11-26T09:59:55.000Z',
            icon: '🧠',
            category: 'reasoning',
            model: 'Claude Sonnet 4.6 (Thinking)',
            detail: 'Bootstrap analysis',
            durationMs: 900,
            stepIndex: 0,
            cascadeId: 'conv-ux-1',
            gmModel: 'claude-sonnet-4-6',
            gmInputTokens: 1200,
            gmOutputTokens: 120,
            gmTTFT: 0.45,
            gmStreamingDuration: 0.45,
        },
        {
            timestamp: '2026-11-26T10:00:00.000Z',
            icon: '💬',
            category: 'user',
            model: '',
            detail: 'Audit tooltips',
            durationMs: 0,
            stepIndex: 1,
            cascadeId: 'conv-ux-1',
        },
        {
            timestamp: '2026-11-26T10:00:02.000Z',
            icon: '🧠',
            category: 'reasoning',
            model: 'Claude Sonnet 4.6 (Thinking)',
            detail: 'Cold reasoning pass',
            durationMs: 6400,
            stepIndex: 2,
            cascadeId: 'conv-ux-1',
            gmModel: 'claude-sonnet-4-6',
            gmInputTokens: 18000,
            gmOutputTokens: 500,
            gmThinkingTokens: 150,
            gmCacheReadTokens: 0,
            gmCacheCreationTokens: 2000,
            gmTTFT: 1.9,
            gmStreamingDuration: 4.5,
            gmContextTokensUsed: 20000,
        },
        {
            timestamp: '2026-11-26T10:00:20.000Z',
            icon: '🧠',
            category: 'reasoning',
            model: 'Claude Sonnet 4.6 (Thinking)',
            detail: 'Warm reasoning pass',
            durationMs: 6150,
            stepIndex: 3,
            cascadeId: 'conv-ux-1',
            gmModel: 'claude-sonnet-4-6',
            gmInputTokens: 2500,
            gmOutputTokens: 700,
            gmThinkingTokens: 250,
            gmCacheReadTokens: 28000,
            gmTTFT: 0.65,
            gmStreamingDuration: 5.5,
            gmContextTokensUsed: 30500,
        },
    ];

    const futureIso = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
    const accounts: AccountSnapshot[] = [
        {
            email: 'alice@example.com',
            name: 'Alice',
            planName: 'Pro',
            tierName: 'Pro',
            earliestResetTime: futureIso,
            allResetTimes: [futureIso, pastIso],
            resetPools: [
                {
                    resetTime: futureIso,
                    modelLabels: ['Claude Opus 5.5', 'Claude Sonnet 4.6 (Thinking)', 'Gemini 3.1 Pro', 'Gemini 4 Neon', 'GPT-OSS 120B'],
                    modelIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
                    hasUsage: true,
                    remainingPercent: 72,
                },
                {
                    resetTime: futureIso,
                    modelLabels: ['Gemini 3 Flash'],
                    modelIds: ['m6'],
                    hasUsage: false,
                    remainingPercent: 100,
                },
                {
                    resetTime: pastIso,
                    modelLabels: ['Gemini 4 Hydrogen'],
                    modelIds: ['m7'],
                    hasUsage: true,
                    remainingPercent: 100,
                },
            ],
            isActive: true,
            lastSeen: '2026-11-26T10:01:00.000Z',
        },
        {
            email: 'bob@example.com',
            name: 'Bob',
            planName: 'Free',
            tierName: 'Free',
            earliestResetTime: futureIso,
            allResetTimes: [futureIso],
            resetPools: [
                {
                    resetTime: futureIso,
                    modelLabels: ['Claude Sonnet 4.6'],
                    modelIds: ['m2'],
                    hasUsage: false,
                    remainingPercent: 100,
                },
            ],
            isActive: false,
            lastSeen: '2026-11-25T08:00:00.000Z',
        },
    ];

    const todayLedger: LedgerAccountBucket[] = [{
        accountEmail: 'alice@example.com',
        totalCalls: 5,
        totalCredits: 5,
        totalInputTokens: 30700,
        totalOutputTokens: 1605,
        totalCacheRead: 39000,
        totalCacheCreation: 2000,
        totalThinkingTokens: 500,
        totalEstimatedCost: 0.14,
        recordedCallIds: ['exec-cold', 'exec-warm', 'exec-mapped-compact'],
        recordedCalls: [],
        modelStats: {
            'Claude Sonnet 4.6 (Thinking)': {
                calls: 3,
                inputTokens: 24500,
                outputTokens: 1205,
                cacheReadTokens: 34000,
                cacheCreationTokens: 2000,
                thinkingTokens: 400,
                credits: 3,
                estimatedCost: 0.11,
            },
            'Claude Opus 5.5 (Orchestrator)': {
                calls: 1,
                inputTokens: 5000,
                outputTokens: 400,
                cacheReadTokens: 5000,
                cacheCreationTokens: 0,
                thinkingTokens: 100,
                credits: 2,
                estimatedCost: 0.03,
            },
            'Unknown Experimental X': {
                calls: 1,
                inputTokens: 1200,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                thinkingTokens: 0,
                credits: 0,
                estimatedCost: 0,
            },
        },
    }];

    const settledLedger: LedgerSettledEntry[] = [{
        settledAt: '2026-11-26T06:00:00.000Z',
        accountEmail: 'alice@example.com',
        poolModelIds: ['claude-sonnet-4-6'],
        poolModelLabels: ['Claude Sonnet 4.6 (Thinking)'],
        totalCalls: 12,
        totalCredits: 10,
        totalInputTokens: 90000,
        totalOutputTokens: 6000,
        totalCacheRead: 120000,
        totalCacheCreation: 5000,
        totalThinkingTokens: 1500,
        totalEstimatedCost: 0.42,
        modelCalls: { 'Claude Sonnet 4.6 (Thinking)': 12 },
    }];

    return { activity, gm, accounts, todayLedger, settledLedger };
}

// ─── 1. GM Data + Account Status Popover ─────────────────────────────────────

describe('GM Data tab & Account Status rich tooltips (tabs-data)', () => {
    it.each(['en', 'zh', 'both'] as Language[])('satisfies frozen contract and rich-tip requirements in %s mode', async language => {
        await setLanguageToState(language, langState);
        const { activity, gm, accounts, todayLedger, settledLedger } = makeRichGMData();
        const html = buildGMDataTabContent(
            activity,
            gm,
            { cascadeId: 'conv-ux-1' } as any,
            accounts,
            todayLedger,
            settledLedger,
            {},
        );

        assertFrozenRichTipContract(html, `GM Data (${language})`);

        // 1. Focusable Timeline '?' button + <template id="gmTimelineLegendTpl"> (no hover-only popup)
        expect(html).toContain('<button type="button" class="act-tl-help-btn rich-tip-trigger" data-popover-key="gm-timeline-legend"');
        expect(html).toContain('data-tip-html-id="gmTimelineLegendTpl"');
        expect(html).toContain('<template id="gmTimelineLegendTpl">');
        expect(html).not.toContain('act-tl-help-popup');

        // 2. Localized TTFT in timeline rows, turn chips, and legend template
        if (language === 'zh') {
            expect(html).toContain('首字延迟 1.90s');
            expect(html).toContain('首字延迟 650ms');
            expect(html).toContain('首字延迟 1.2');
            expect(html).toContain('首字延迟 1.20s');
            expect(html).not.toMatch(/class="act-tl-gm-tag act-tl-gm-ttft"[^>]*>[^<]*TTFT/);
        } else if (language === 'en') {
            expect(html).toContain('TTFT 1.90s');
            expect(html).toContain('TTFT 650ms');
        } else {
            expect(html).toContain('首字延迟');
            expect(html).toContain('TTFT');
        }

        // 3. Cache warmth unified ZH label ("热缓存（命中）", NOT bare "已命中")
        if (language === 'zh') {
            expect(html).toContain('热缓存（命中）');
            expect(html).not.toMatch(/class="telemetry-warmth-badge is-warm"[^>]*>(?:<span[^>]*>)?已命中/);
        }

        // 4. Turn start pills carry reassuring server-side Prompt Cache explanation + thresholds
        expect(html).toContain('data-turn-start="warm"');
        expect(html).toContain('data-turn-start="cold"');
        expect(html).toContain(language === 'zh' ? '提示词缓存' : 'Prompt Cache');
        expect(html).toContain('≥70%');

        // 5. Telemetry delta pill, mapped-base cost, short-sample, HTTP 429 error, compaction drop
        expect(html).toContain('class="telemetry-delta-pill is-faster"');
        expect(html).toContain('data-popover-key="gm-tel-ttft-delta"');
        expect(html).toContain('class="rc-cost-val" data-popover-key="');
        expect(html).toContain('-cost-mapped"');
        expect(html).toContain('data-pricing-provenance="mapped_base"');
        expect(html).toContain(language === 'zh' ? '底座' : 'base');
        expect(html).toContain('Gemini 4 Carbon');
        expect(html).toContain('class="rc-short-sample"');
        expect(html).toContain('&lt;16');
        expect(html).toContain('class="rc-status is-err"');
        expect(html).toContain('HTTP 429 RESOURCE_EXHAUSTED');
        expect(html).toContain(language === 'zh' ? '限流' : 'rate limit');
        expect(html).toContain('rc-delta-compaction');

        // 6. Model cards: #modelStatsErrToggle, floppy-disk isCheckpointOnly badge, orphan AI actions
        expect(html).toContain('id="modelStatsErrToggle"');
        expect(html).toContain('data-popover-key="gm-model-stats-err-toggle"');
        expect(html).toContain('data-popover-key="gm-mcard-cp-only-');
        expect(html).toContain('data-popover-key="gm-tl-no-anchor-');

        // 7. Context Intelligence sub-terms (Checkpoint, System Preamble, Ephemeral, Model DNA, T=)
        expect(html).toContain('data-popover-key="gm-ci-badge-checkpoint"');
        expect(html).toContain('data-popover-key="gm-ci-badge-system_preamble"');
        expect(html).toContain('data-popover-key="gm-ci-badge-ephemeral"');
        expect(html).toContain('data-popover-key="gm-ci-badge-model-dna"');
        expect(html).toContain('data-popover-key="gm-ci-temp-chip-');

        // 8. All 19 tools in .tool-cat-chip have rich tips (EN in en mode, ZH in zh mode)
        for (const tool of ALL_19_TOOLS) {
            expect(html).toContain(`data-popover-key="gm-tool-cat-${tool}-`);
        }
        if (language === 'en') {
            expect(html).toContain('Execute a terminal command');
            expect(html).toContain('Run automated browser tasks via a subagent');
            expect(html).not.toContain('执行终端命令');
        } else if (language === 'zh') {
            expect(html).toContain('执行终端命令');
            expect(html).toContain('浏览器自动化');
        }

        // 9. Settled ledger + reset time + cycles rich tips
        expect(html).toContain('data-popover-key="gm-settled-title"');
        expect(html).toContain('data-popover-key="gm-settled-cycles"');
        expect(html).toContain('data-popover-key="gm-ledger-reset-0-0"');
    });

    it.each(['en', 'zh', 'both'] as Language[])('attaches rich tips to GM-only summary bar (summary === null) in %s mode', async language => {
        await setLanguageToState(language, langState);
        const { gm } = makeRichGMData();
        const html = buildGMDataTabContent(null, gm);

        assertFrozenRichTipContract(html, `GM-only Summary (${language})`);
        expect(html).toContain('data-popover-key="gm-stat-calls"');
        expect(html).toContain('data-popover-key="gm-stat-in"');
        expect(html).toContain('data-popover-key="gm-stat-out"');
        expect(html).toContain('data-popover-key="gm-stat-cache"');
        expect(html).toContain('data-popover-key="gm-stat-credits"');
    });

    it.each(['en', 'zh', 'both'] as Language[])('upgrades Account Status Popover with visible percent, hidden pool list, badges, and billing expiry tips in %s mode', async language => {
        await setLanguageToState(language, langState);
        const { accounts } = makeRichGMData();
        const todayDay = new Date().getDate();
        const otherDay = todayDay === 28 ? 10 : Math.min(28, todayDay + 5);
        const html = buildAccountStatusPanel(accounts, {
            'alice@example.com': otherDay,
            'bob@example.com': todayDay,
        });

        assertFrozenRichTipContract(html, `Account Status (${language})`);

        // Visible percentage next to .acct-quota-bar + rich tip on bar wrapper
        expect(html).toContain('class="acct-quota-wrap"');
        expect(html).toContain('class="acct-quota-pct">72%</span>');
        expect(html).toContain('data-popover-key="acct-pool-quota-alice-example-com-0-0"');

        // +N hidden pool models lists the hidden model names in rich tip
        expect(html).toContain('class="acct-pool-more"');
        expect(html).toContain('Gemini 4 Neon');
        expect(html).toContain('GPT-OSS 120B');

        // Active / Cached / Idle / Ready badges & Billing Day expiry rich tips
        expect(html).toContain('data-popover-key="acct-status-alice-example-com-0"');
        expect(html).toContain('data-popover-key="acct-status-bob-example-com-1"');
        expect(html).toContain('data-popover-key="acct-pool-state-alice-example-com-0-1"');
        expect(html).toContain('data-popover-key="acct-pool-state-alice-example-com-0-2"');
        expect(html).toContain('data-popover-key="acct-expiry-alice-example-com-0"');
        expect(html).toContain('data-popover-key="acct-expiry-bob-example-com-1"');
        expect(html).toContain(language === 'zh' ? '账单日' : 'billing day');
    });

    it('ships balanced GM Data CSS with removed legacy hover-only timeline popup & data-tooltip::after', () => {
        const css = getGMDataTabStyles();
        assertBalancedCssBraces(css, 'GM Data CSS');
        expect(css).toContain('.acct-quota-pct');
        expect(css).not.toContain('.act-tl-help-popup');
        expect(css).not.toContain('.act-stat[data-tooltip]');
        expect(css).not.toContain('.tool-cat-chip[data-tooltip]');
    });
});

// ─── 2. Orchestrator Attribution ─────────────────────────────────────────────

describe('Orchestrator Attribution rich tooltips (tabs-data)', () => {
    it.each(['en', 'zh', 'both'] as Language[])('attaches rich tips to role badges and avoids duplicate keys across Overview (compact) and GM Data cards in %s mode', async language => {
        await setLanguageToState(language, langState);

        // Standalone role badges
        const badgesHtml = [
            renderCallRoleBadgeHtml('orchestrator', false, true, 'row-1'),
            renderCallRoleBadgeHtml('executor', true, true, 'row-2'),
            renderCallRoleBadgeHtml('subagent', false, true, 'row-3'),
        ].join('');
        assertFrozenRichTipContract(badgesHtml, `Role Badges (${language})`);
        expect(badgesHtml).toContain('data-popover-key="orch-role-orchestrator-row-1"');
        expect(badgesHtml).toContain('data-popover-key="orch-role-executor-row-2"');
        expect(badgesHtml).toContain('data-popover-key="orch-cold-switch-row-2"');
        expect(badgesHtml).toContain('data-popover-key="orch-role-subagent-row-3"');
        if (language === 'zh' || language === 'both') {
            expect(badgesHtml).toContain('子智能体');
        }

        // Combined Overview (compact: true) + GM Data (compact: false) cards
        const orchCalls: GMCallEntry[] = [
            makeGMCall({
                executionId: 'orch-1',
                stepIndices: [1],
                model: 'MODEL_PLACEHOLDER_M667',
                modelDisplay: 'Claude Opus 5.5 (Orchestrator)',
                responseModel: 'MODEL_PLACEHOLDER_M667',
                inputTokens: 10000,
                outputTokens: 300,
                cacheReadTokens: 0,
                createdAt: '2026-11-26T10:00:00.000Z',
            }),
            makeGMCall({
                executionId: 'exec-2',
                stepIndices: [2],
                model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
                responseModel: 'claude-sonnet-4-6',
                inputTokens: 12000,
                outputTokens: 600,
                cacheReadTokens: 0,
                createdAt: '2026-11-26T10:00:05.000Z',
            }),
            makeGMCall({
                executionId: 'sub-3',
                stepIndices: [3],
                model: 'MODEL_PLACEHOLDER_M26',
                modelDisplay: 'Gemini 3 Flash',
                responseModel: 'gemini-3-flash',
                inputTokens: 3000,
                outputTokens: 200,
                cacheReadTokens: 0,
                createdAt: '2026-11-26T10:00:08.000Z',
            }),
        ];
        const summary = computeOrchestratorSplit(
            orchCalls,
            {
                orchestratorConfig: {
                    planModel: 'MODEL_PLACEHOLDER_M667',
                    executionModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                },
                orchestratorHistory: [
                    {
                        startStepIndex: 1,
                        endStepIndex: 1,
                        planModel: 'MODEL_PLACEHOLDER_M667',
                        executionModel: 'MODEL_PLACEHOLDER_M667',
                    },
                    {
                        startStepIndex: 2,
                        endStepIndex: 3,
                        planModel: 'MODEL_PLACEHOLDER_M667',
                        executionModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    },
                ],
                orchestratorSettings: {
                    configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
                    configuredExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
                    effectiveExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    effectiveOrchestratorLabel: 'Gemini 4 Carbon (Orchestrator)',
                    effectiveExecutorLabel: 'Claude Sonnet 4.6 (Thinking)',
                    isCustomOrchestrator: true,
                    isCustomExecutor: true,
                } as OrchestratorSettings,
            },
            {},
        );
        expect(summary).not.toBeNull();

        const overviewCard = buildOrchestratorSplitCardHtml(summary!, { compact: true });
        const gmCard = buildOrchestratorSplitCardHtml(summary!, { compact: false });
        const combined = overviewCard + gmCard;

        assertFrozenRichTipContract(combined, `Combined Orchestrator Split (${language})`);
        expect(overviewCard).toContain('data-popover-key="ov-orch-');
        expect(gmCard).toContain('data-popover-key="gm-orch-');
        expect(combined).toContain('orch-split-mapped-tag');
        expect(combined).toContain('orch-cold-switch-banner');
        expect(combined).toContain('data-popover-key="gm-orch-reconfigured"');
    });

    it('ships balanced Orchestrator Attribution CSS', () => {
        assertBalancedCssBraces(getOrchestratorAttributionStyles(), 'Orchestrator CSS');
    });
});

// ─── 3. Cost / Pricing Tab + Model DNA ───────────────────────────────────────

describe('Cost / Pricing tab & Model DNA rich tooltips (tabs-data)', () => {
    it.each(['en', 'zh', 'both'] as Language[])('eliminates clipped tooltips, raw M537/M667/M681/M669 codes, and explains mapped-base/partial/thinking/cache in %s mode', async language => {
        await setLanguageToState(language, langState);

        // Pin clock within 45 days before 2026-12-01 UTC cutover so scheduled rate banner renders
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'));

        const { gm, todayLedger, settledLedger } = makeRichGMData();
        // Add an unpriced custom model to gm.modelBreakdown so Partial total + Not available render
        gm.modelBreakdown['Unknown Experimental X'] = {
            ...gm.modelBreakdown['Claude Sonnet 4.6 (Thinking)'],
            calls: 1,
            responseModel: 'unknown-experimental-x',
            totalInputTokens: 2000,
            totalOutputTokens: 300,
            totalThinkingTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
        };

        const store = new PricingStore();
        const monthBreakdown: MonthCostBreakdown = {
            year: 2026,
            month: 5,
            grandTotal: 4.56,
            cycleCount: 3,
            earliestDate: '2026-05-01',
            models: [
                {
                    name: 'Claude Sonnet 4.6 (Thinking)',
                    totalCost: 3.12,
                    calls: 30,
                    inputTokens: 400000,
                    outputTokens: 30000,
                    thinkingTokens: 8000,
                    credits: 30,
                },
                {
                    name: 'Claude Opus 5.5 (Orchestrator)',
                    totalCost: 1.44,
                    calls: 10,
                    inputTokens: 80000,
                    outputTokens: 4000,
                    thinkingTokens: 0,
                    credits: 10,
                },
            ],
        };

        const orchSettings: OrchestratorSettings = {
            configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
            configuredExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
            effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
            effectiveExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
            effectiveOrchestratorLabel: 'Claude Opus 5.5 (Orchestrator)',
            effectiveExecutorLabel: 'Claude Sonnet 4.6 (Thinking)',
            isCustomOrchestrator: true,
            isCustomExecutor: true,
        } as OrchestratorSettings;

        const mappedHtml = buildPricingTabContent(
            gm,
            store,
            monthBreakdown,
            settledLedger,
            todayLedger,
            false,
            { orchestratorSettings: orchSettings, orchestratorPricingMode: 'mapped' },
        );
        const strictCardHtml = buildActiveOrchestratorPricingCard(orchSettings, {}, 'strict');

        assertFrozenRichTipContract(mappedHtml, `Pricing Tab Mapped (${language})`);
        assertFrozenRichTipContract(strictCardHtml, `Pricing Orchestrator Strict (${language})`);

        // ZERO internal M537/M667/M681/M669 placeholder codes in user-facing copy
        for (const rawCode of ['M537', 'M667', 'M681', 'M669']) {
            expect(mappedHtml, `Pricing mapped must hide ${rawCode}`).not.toContain(rawCode);
            expect(strictCardHtml, `Pricing strict must hide ${rawCode}`).not.toContain(rawCode);
        }

        // Mapped base badge carries exact mappedBaseLabel + Mapped vs Strict explanation
        expect(mappedHtml).toContain('class="prc-mapped-badge"');
        expect(mappedHtml).toContain('Claude Opus 5.5');
        expect(mappedHtml).toContain(language === 'zh' ? '严格模式' : 'Strict Mode');

        // Partial total + API reference vs subscription billing + Thinking exclusion + Cache TTL + Archived cycles
        expect(mappedHtml).toContain('data-popover-key="prc-cost-chip-total"');
        expect(mappedHtml).toContain(language === 'zh' ? '订阅' : 'subscription');
        expect(mappedHtml).toContain('data-popover-key="prc-legend-thinking"');
        expect(mappedHtml).toContain('data-popover-key="prc-legend-cache"');
        expect(mappedHtml).toContain('data-popover-key="prc-monthly-cycles"');

        // Upcoming scheduled rate change banner rich tip (00:00 UTC + per 1M)
        expect(mappedHtml).toContain('data-popover-key="prc-rate-change-banner"');
        expect(mappedHtml).toContain(language === 'zh' ? 'UTC 00:00' : '00:00 UTC');

        // Model DNA cards: Cached badge, provider, responseModel, all 6 sampling params
        const persistedDna: Record<string, PersistedModelDNA> = {
            'custom-vertex-endpoint-v1': {
                displayName: 'Custom Vertex Model',
                responseModel: 'custom-vertex-endpoint-v1',
                apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
                completionConfig: {
                    maxTokens: 65536,
                    temperature: 1,
                    firstTemperature: 0.4,
                    topK: 40,
                    topP: 0.95,
                    stopPatterns: ['</final>'],
                },
                hasSystemPrompt: true,
                toolCount: 19,
                promptSectionTitles: ['System Preamble'],
                lastSeen: '2026-11-26T10:00:00.000Z',
            },
        };
        const dnaHtml = buildModelDNACards(null, persistedDna, []);
        assertFrozenRichTipContract(dnaHtml, `Model DNA (${language})`);
        expect(dnaHtml).toContain('data-popover-key="prc-dna-cached-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-provider-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-resp-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-p-max-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-p-temp-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-p-ftemp-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-p-topk-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-p-topp-');
        expect(dnaHtml).toContain('data-popover-key="prc-dna-p-stops-');
    });

    it('ships balanced Pricing CSS', () => {
        assertBalancedCssBraces(getPricingTabStyles(), 'Pricing CSS');
    });
});

// ─── 4. Sessions / Chat History Tab ──────────────────────────────────────────

describe('Sessions / Chat History tab rich tooltips & terminology (tabs-data)', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders plain-language empty state without raw trajectory/LS jargon in %s mode', async language => {
        await setLanguageToState(language, langState);
        const html = buildChatHistoryTabContent([], null, null);

        expect(html).not.toContain('trajectory data');
        expect(html).not.toContain('轨迹数据');
        expect(html).not.toContain('LS sync');
        expect(html).not.toContain('LS 同步');
        if (language === 'en' || language === 'both') {
            expect(html).toContain('conversation history');
            expect(html).toContain('local service sync');
        }
        if (language === 'zh' || language === 'both') {
            expect(html).toContain('对话历史');
            expect(html).toContain('本地服务同步');
        }
    });

    it.each(['en', 'zh', 'both'] as Language[])('unifies terminology, wraps disabled action buttons, and migrates all tooltips in %s mode', async language => {
        await setLanguageToState(language, langState);

        const trajectories: TrajectorySummary[] = [
            {
                cascadeId: '11111111-2222-3333-4444-555555555555',
                title: 'Active Workspace Investigation',
                stepCount: 18,
                status: 'CASCADE_RUN_STATUS_RUNNING',
                model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                createdTime: '2026-11-26T09:00:00.000Z',
                lastModifiedTime: '2026-11-26T10:00:00.000Z',
                lastUserInputTime: '2026-11-26T09:58:00.000Z',
                workspaceUri: 'file:///Users/dev/project-alpha',
                repositoryName: 'project-alpha',
                branchName: 'main',
            },
            {
                cascadeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                title: 'Idle Conversation With Workspace',
                stepCount: 6,
                status: 'CASCADE_RUN_STATUS_IDLE',
                model: 'MODEL_PLACEHOLDER_M26',
                createdTime: '2026-11-26T08:00:00.000Z',
                lastModifiedTime: '2026-11-26T08:30:00.000Z',
                lastUserInputTime: '2026-11-26T08:25:00.000Z',
                workspaceUri: 'file:///Users/dev/project-alpha',
                repositoryName: 'project-alpha',
                branchName: 'main',
            },
            {
                cascadeId: '99999999-8888-7777-6666-555555555555',
                title: 'Finished Unscoped Session',
                stepCount: 10,
                status: 'CASCADE_RUN_STATUS_FINISHED',
                model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                createdTime: '2026-11-25T15:00:00.000Z',
                lastModifiedTime: '2026-11-25T15:40:00.000Z',
                lastUserInputTime: '2026-11-25T15:35:00.000Z',
                workspaceUri: '',
                repositoryName: '',
                branchName: '',
            },
        ];

        const html = buildChatHistoryTabContent(
            trajectories,
            { cascadeId: '11111111-2222-3333-4444-555555555555' } as any,
            null,
            undefined,
            'file:///Users/dev/project-alpha',
        );

        assertFrozenRichTipContract(html, `Sessions Tab (${language})`);

        // 1. Unified terminology (no legacy abbreviations / button label drift)
        expect(html).not.toContain('>WS<');
        expect(html).not.toContain('>本区<');
        expect(html).not.toContain('Recordable');
        expect(html).not.toContain('Record Folder');
        expect(html).not.toContain('aria-label="记录目录');
        expect(html).not.toContain('PB File');
        expect(html).not.toContain('PB 文件');
        if (language === 'en' || language === 'both') {
            expect(html).toContain('Current Workspace');
            expect(html).toContain('Backup Ready');
            expect(html).toContain('Session Records');
            expect(html).toContain('Archive (.pb)');
        }
        if (language === 'zh' || language === 'both') {
            expect(html).toContain('当前工作区');
            expect(html).toContain('可备份');
            expect(html).toContain('会话记录');
            expect(html).toContain('对话存档 (.pb)');
        }

        // 2. Disabled buttons wrapped in .rich-tip-disabled-wrap with tabindex="0" & disability explanation
        expect(html).toContain('class="rich-tip-disabled-wrap"');
        expect(html).toMatch(/class="rich-tip-disabled-wrap"[^>]*tabindex="0"[^>]*><button[^>]*disabled/);
        expect(html).toContain('data-popover-key="ses-act-ws-');
        expect(html).toContain('data-popover-key="ses-act-pb-');
        expect(html).toContain('data-popover-key="ses-act-records-');

        // 3. Row title shows full title + short ID via rich tip (zero raw UUID native title=)
        expect(html).toContain('data-popover-key="ses-row-title-');
        expect(html).toContain('11111111');

        // 4. Status badges distinguish Idle vs Finished & group N run chip has rich tip
        expect(html).toContain('data-popover-key="ses-badge-status-');
        expect(html).toContain('data-popover-key="ses-grp-run-0"');
        if (language === 'en') {
            expect(html).toContain('ready for your next message');
            expect(html).toContain('Contrast with Idle');
        } else if (language === 'zh') {
            expect(html).toContain('正等待你的下一条消息');
            expect(html).toContain('区别于「空闲」');
        }
    });
});

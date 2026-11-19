import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import type { GMCallEntry, GMConversationData, GMSummary } from '../src/gm/types';
import { getLanguage, setLanguageToState, tBiHtml } from '../src/i18n';
import {
    MONITOR_COMMAND, extractOverviewTelemetry, formatCompactTokens, formatCreditExpiry,
    formatQuotaEffort, formatQuotaEfforts, formatSavingsUsd,
    getContextReading, getContextRemaining, resetCountdown, selectMonitorQuotaGroups,
} from '../src/monitor-overview';
import { StatusBarManager } from '../src/statusbar';
import type { ModelConfig } from '../src/models';
import type { ContextUsage } from '../src/tracker';
import { buildCalendarTabContent, getCalendarTabStyles } from '../src/webview-calendar-tab';
import { buildOverviewTabContent, getOverviewStyles } from '../src/webview-overview-tab';

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
    it('offers three allowlisted hover destinations and counts both Neon types in one pool', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        manager.setModelConfigs([
            config(neon, 'Gemini 4 Neon (XHigh)', 0.5165423),
            config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.5165423),
        ]);
        manager.update(usage());
        const tooltip = item.tooltip as vscode.MarkdownString;
        expect(tooltip.isTrusted).toEqual({ enabledCommands: [MONITOR_COMMAND] });
        expect(tooltip.value.match(/\*\*Gemini\*\* · \*\*52%\*\*/g)).toHaveLength(1);
        expect(tooltip.value).toContain('Gemini 4 Neon \\(Extra\\)');
        for (const tab of ['overview', 'models', 'settings']) {
            expect(tooltip.value).toContain(`command:${MONITOR_COMMAND}?${encodeURIComponent(JSON.stringify([tab]))}`);
        }
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
        expect(hover.match(/Gemini 4 Neon/g)).toHaveLength(1);
        expect(hover.match(/Orchestrator/g)).toHaveLength(1);
        expect(hover).toContain('2 models');
        expect(hover).toContain('Gemini 4 Neon 35–60%');
        expect(hover).toContain('Reset times vary');
        expect(hover).toContain('Next reset');
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
        expect(hover).toContain('**24k / 512k**');
        expect(hover).toContain('Remaining · 488k (95.3%)');
        expect(hover).toContain('Some steps are missing');
        expect(hover).toContain('Open overview');
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
        expect(unknownHover).toContain('1h 30m · ');
        expect(unknownHover).not.toContain('Reset time passed');

        // Explicit 0 credits -> displayed accurately as 0.
        manager.setCredits(0);
        manager.update(usage({ model: 'MODEL_PLACEHOLDER_M532', modelDisplayName: 'Gemini 4 Neon (High)' }));
        expect(item.text).toContain('$(zap) 0');
        expect((item.tooltip as vscode.MarkdownString).value).toContain('AI credits · **0**');

        // Unknown credits with billing day configured -> discloses Not reported instead of 0.
        manager.setCredits(null);
        manager.setBillingDay(25);
        manager.refreshFromConfig();
        const withExpiryHover = (item.tooltip as vscode.MarkdownString).value;
        expect(withExpiryHover).toContain('AI credits · Not reported · ');
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
        // Compact density: includes remaining %, exact clock time + countdown, omits family lines & credits expiry
        getConfigSpy.mockImplementation((section?: string) => ({
            get: <T>(key: string, fallback?: T) => {
                if (section === 'antigravityContextMonitor' && key === 'statusBar.tooltipDensity') { return 'compact' as T; }
                return fallback as T;
            },
        }) as unknown as vscode.WorkspaceConfiguration);
        manager.update(usage({ title: '  \r\n  Windows\tCRLF\r\nSession  ' }));
        const compactHover = (item.tooltip as vscode.MarkdownString).value;
        expect(compactHover).toContain('**Windows CRLF Session**');
        expect(compactHover).toContain('95.3% left');
        expect(compactHover).toMatch(/1h 30m · \d{2}\/\d{2} \d{2}:\d{2}/);
        expect(compactHover).not.toContain('› ');
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
            lastModelUsage: { inputTokens: 18_000, outputTokens: 2_000, responseOutputTokens: 1_500, cacheReadTokens: 4_000, cacheCreationTokens: 0 },
            tokenUsageSource: 'planner',
        }));
        const detailedHover = (item.tooltip as vscode.MarkdownString).value;
        expect(detailedHover).toContain('**24,000 / 512,000**');
        expect(detailedHover).toContain('Remaining · 488,000 (95.3%)');
        expect(detailedHover).toContain('Latest Model Usage');
        expect(detailedHover).toContain('Input 18,000 · Output 2,000 · Cache 4,000');
        expect(detailedHover).not.toContain('Image Gen 0');
        expect(detailedHover).not.toContain('Cache creation');
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
        expect(formatQuotaEffort('xhigh')).toBe('Extra');
        expect(formatQuotaEfforts(['low', 'medium', 'high', 'xhigh'])).toBe('Low · Medium · High · Extra');
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
        expect(html).toContain('Gemini 4 Neon (Extra / 超高)');
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
        expect(activeHtml.indexOf('overview-telemetry-strip')).toBeLessThan(activeHtml.indexOf('id="overview-session-diagnostics"'));

        // Active conversation with no GM calls falls back cleanly to session overall
        const fallbackHtml = buildOverviewTabContent(
            usage({ cascadeId: 'conv-fresh' }),
            [],
            null,
            0,
            { state: 'active' },
            now,
            { gmSummary: summary },
        );
        expect(fallbackHtml).toContain('data-telemetry-scope="session"');
        expect(fallbackHtml).toContain('220k · 3/3');
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
                expect(html).toContain('Cache Hit');
                expect(html).toContain('Cache Saved');
                expect(html).toContain('Warm');
            } else if (lang === 'zh') {
                expect(html).toContain('生成速度');
                expect(html).toContain('首字延迟');
                expect(html).toContain('缓存命中');
                expect(html).toContain('缓存节省');
                expect(html).toContain('已命中');
            } else {
                expect(html).toContain(tBiHtml('Speed', '生成速度'));
                expect(html).toContain(tBiHtml('TTFT', '首字延迟'));
                expect(html).toContain(tBiHtml('Cache Hit', '缓存命中'));
                expect(html).toContain(tBiHtml('Cache Saved', '缓存节省'));
                expect(html).toContain(tBiHtml('Warm', '已命中'));
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

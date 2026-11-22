import { execFileSync } from 'child_process';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getLanguage, setLanguageToState, type Language } from '../src/i18n';
import { parseContextBreakdown, type ContextBreakdownSnapshot } from '../src/context-breakdown';
import { analyzeTurnDiagnostics } from '../src/turn-diagnostics';
import type { QuotaRunwayEstimate } from '../src/quota-runway';
import type { ConversationOption } from '../src/conversation-selector';
import { getModelDisplayName, type ModelConfig, type UserQuotaSummary, type UserStatusInfo } from '../src/models';
import type { ContextUsage } from '../src/tracker';
import type { GMCallEntry, GMSummary } from '../src/gm-tracker';
import {
    buildMonitorDocumentHtml,
    buildMonitorMastheadControlsHtml,
    buildMonitorTabsPayload,
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
} from '../src/webview-document';
import { buildOverviewTabContent, getOverviewStyles } from '../src/webview-overview-tab';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { getScript } from '../src/webview-script';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { showMonitorPanel } from '../src/webview-panel';

const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };
const initialLang = getLanguage();
const NOW = Date.parse('2026-11-23T09:15:30Z');

function makeConfig(model: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
        model,
        label: overrides.label || getModelDisplayName(model),
        supportsImages: true,
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
        quotaInfo: { remainingFraction: 0.72, resetTime: '2026-11-23T14:00:00Z' },
        ...overrides,
    };
}

function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        cascadeId: 'conv-main-001',
        title: 'Implement Antigravity App sidecar',
        model: 'MODEL_PLACEHOLDER_M535',
        modelDisplayName: 'Gemini 4 Neon (Extra High)',
        contextUsed: 120_000,
        totalOutputTokens: 4_200,
        totalToolCallOutputTokens: 18_500,
        contextLimit: 200_000,
        usagePercent: 60,
        stepCount: 24,
        lastModifiedTime: '2026-11-23T09:14:00Z',
        status: 'RUNNING',
        isEstimated: false,
        lastModelUsage: null,
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        checkpointModel: '',
        createdTime: '2026-11-23T08:00:00Z',
        lastUserInputTime: '2026-11-23T09:13:00Z',
        lastUserInputStepIndex: 22,
        repositoryName: 'antigravity',
        gitOriginUrl: '',
        branchName: 'main',
        gitRootUri: '',
        ...overrides,
    };
}

function makeUserInfo(): UserStatusInfo {
    return {
        name: 'Grace',
        email: 'grace@example.test',
        planName: 'Google AI Ultra',
        teamsTier: '',
        userTierName: 'Google AI Ultra',
        userTierId: 'ultra',
        defaultModelLabel: 'Gemini 4 Neon (Extra High)',
        planLimits: {
            maxNumChatInputTokens: 1_000_000,
            maxNumPremiumChatMessages: -1,
            maxCustomChatInstructionCharacters: 12_000,
            maxNumPinnedContextItems: 20,
            maxLocalIndexSize: 100_000,
            monthlyFlexCreditPurchaseAmount: 0,
        },
        teamConfig: {
            allowMcpServers: true,
            allowAutoRunCommands: true,
            allowBrowserExperimentalFeatures: false,
        },
        availableCredits: [],
        canBuyMoreCredits: false,
        browserEnabled: true,
        cascadeWebSearchEnabled: true,
        knowledgeBaseEnabled: true,
        canGenerateCommitMessages: true,
        cascadeCanAutoRunCommands: true,
        canAllowCascadeInBackground: true,
        hasAutocompleteFastMode: true,
        allowStickyPremiumModels: true,
        allowPremiumCommandModels: true,
        hasTabToJump: true,
        canCustomizeAppIcon: true,
        userTierDescription: '',
        upgradeSubscriptionText: '',
        modelSortOrder: [],
    };
}

function makeBreakdownSnapshot(overrides: Partial<ContextBreakdownSnapshot> = {}): ContextBreakdownSnapshot {
    const base = parseContextBreakdown({
        model: 'MODEL_PLACEHOLDER_M535',
        modelDisplayName: 'Gemini 4 Neon (Extra High)',
        effectiveBudgetTokens: 200_000,
        nativeLimitTokens: 512_000,
        currentStepCount: 24,
        generatorMetadata: [{
            stepIndices: [22, 23],
            chatModel: {
                model: 'MODEL_PLACEHOLDER_M535',
                promptSections: [
                    { title: 'System Instructions', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 18_000 },
                    { title: 'Workspace Rules & Skills', tokenType: 'TOKEN_TYPE_SKILLS', numTokens: 14_000 },
                    { title: 'MCP Tools & Schemas', tokenType: 'TOKEN_TYPE_MCP_TOOLS', numTokens: 22_000 },
                    { title: 'User Conversation Turns', tokenType: 'TOKEN_TYPE_USER_MESSAGE', numTokens: 16_000 },
                    { title: 'Tool Output: npm test', tokenType: 'TOKEN_TYPE_TOOL_RESULT', numTokens: 50_000 },
                ],
                usage: {
                    inputTokens: 12_000,
                    cacheReadTokens: 108_000,
                    outputTokens: 3_200,
                },
            },
        }],
    });
    return { ...base, ...overrides };
}

function makeSampleCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        executionId: 'exec-1',
        stepIndices: [1],
        model: 'MODEL_PLACEHOLDER_M535',
        modelDisplay: 'Gemini 4 Neon (Extra High)',
        responseModel: 'gemini-4-neon',
        inputTokens: 20_000,
        outputTokens: 1_000,
        thinkingTokens: 300,
        responseTokens: 700,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        credits: 0,
        ttftSeconds: 1.4,
        streamingSeconds: 2.5,
        createdAt: '2026-11-23T09:00:00Z',
        hasError: false,
        errorMessage: '',
        retries: 0,
        stopReason: 'STOP',
        toolCallCount: 1,
        ...overrides,
    };
}

function makeGMSummary(calls: GMCallEntry[]): GMSummary {
    return {
        totalCalls: calls.length,
        totalInputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
        totalOutputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
        totalThinkingTokens: calls.reduce((s, c) => s + c.thinkingTokens, 0),
        totalCacheRead: calls.reduce((s, c) => s + c.cacheReadTokens, 0),
        totalCacheCreation: calls.reduce((s, c) => s + c.cacheCreationTokens, 0),
        totalCredits: 0,
        totalRetryCount: 0,
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        retryErrorCodes: {},
        retryErrorCodesByConv: {},
        modelBreakdown: {
            'Gemini 4 Neon (Extra High)': {
                callCount: calls.length,
                stepsCovered: calls.length,
                totalInputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
                totalOutputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
                totalThinkingTokens: calls.reduce((s, c) => s + c.thinkingTokens, 0),
                totalCacheRead: calls.reduce((s, c) => s + c.cacheReadTokens, 0),
                totalCacheCreation: calls.reduce((s, c) => s + c.cacheCreationTokens, 0),
                totalCredits: 0,
                avgTTFT: 1.0,
                avgStreaming: 2.0,
                cacheHitRate: 0.7,
                responseModel: 'gemini-4-neon',
                errorCount: 0,
                errorCodes: {},
                timedOutputTokens: 2000,
                timedStreamingSeconds: 4.0,
                ttftSampleCount: calls.length,
            },
        },
        conversations: [{
            cascadeId: 'conv-main-001',
            title: 'Implement Antigravity App sidecar',
            calls,
            totalCalls: calls.length,
            totalCredits: 0,
            latestContextUsed: 60_000,
        }],
        toolCallCounts: {},
        systemContext: [],
        contextGrowth: [],
        errorDetails: [],
        lastUpdated: '2026-11-23T09:15:00Z',
    } as unknown as GMSummary;
}

const SAMPLE_QUOTA_SUMMARY: UserQuotaSummary = {
    groups: [
        {
            pool: 'gemini',
            displayName: 'Gemini Models',
            fiveHour: {
                bucketId: 'gemini-5h',
                window: '5h',
                displayName: 'Five Hour Limit Remaining',
                remainingFraction: 0.42,
                resetTime: '2026-11-23T13:15:30Z',
                resetAt: Date.parse('2026-11-23T13:15:30Z'),
            },
            weekly: {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 0.88,
                resetTime: '2026-11-29T13:15:30Z',
                resetAt: Date.parse('2026-11-29T13:15:30Z'),
            },
            buckets: [],
        },
        {
            pool: 'premium',
            displayName: 'Claude and GPT models',
            fiveHour: {
                bucketId: '3p-5h',
                window: '5h',
                displayName: 'Five Hour Limit Remaining',
                remainingFraction: 0.91,
                resetTime: '2026-11-23T13:15:30Z',
                resetAt: Date.parse('2026-11-23T13:15:30Z'),
            },
            weekly: {
                bucketId: '3p-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 0.96,
                resetTime: '2026-11-29T13:15:30Z',
                resetAt: Date.parse('2026-11-29T13:15:30Z'),
            },
            buckets: [],
        },
    ],
};

const SAMPLE_RUNWAYS: Record<string, QuotaRunwayEstimate> = {
    gemini: {
        poolKey: 'gemini',
        status: 'at_risk',
        burnRatePctPerHour: 24.5,
        estExhaustMs: 105 * 60_000, // 1h 45m
        timeToResetMs: 240 * 60_000,
        recoveredRecently: false,
    },
    premium: {
        poolKey: 'premium',
        status: 'safe_until_reset',
        burnRatePctPerHour: 6.2,
        estExhaustMs: 880 * 60_000,
        timeToResetMs: 240 * 60_000,
        recoveredRecently: false,
    },
};

const SAMPLE_CONV_OPTIONS: ConversationOption[] = [
    {
        cascadeId: 'conv-main-001',
        title: 'Implement Antigravity App sidecar',
        isUntitled: false,
        isSubagent: false,
        isActive: true,
        isLockedMain: true,
        isRunning: true,
        matchesWorkspace: true,
        stepCount: 24,
        lastModifiedTime: '2026-11-23T09:14:00Z',
        model: 'MODEL_PLACEHOLDER_M535',
        workspaceLabel: 'antigravity',
        branchName: 'main',
    },
    {
        cascadeId: 'conv-sub-002',
        title: 'Subagent: Audit CSS selectors',
        isUntitled: false,
        isSubagent: true,
        isActive: false,
        isLockedMain: false,
        isRunning: false,
        matchesWorkspace: true,
        stepCount: 6,
        lastModifiedTime: '2026-11-23T09:10:00Z',
        model: 'MODEL_PLACEHOLDER_M528',
        workspaceLabel: 'antigravity',
        branchName: 'main',
    },
];

beforeEach(async () => {
    await setLanguageToState('both', memState);
});

afterEach(async () => {
    vi.restoreAllMocks();
    await setLanguageToState(initialLang, memState);
});

describe('v1.17.5 pure webview-document.ts contract & zero-vscode runtime', () => {
    it('loads compiled out/webview-document.js in pure Node with zero vscode module', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const out = execFileSync(process.execPath, [
            '-e',
            `
            const mod = require('./out/webview-document.js');
            const html = mod.buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                version: '1.17.5',
                settings: mod.DEFAULT_MONITOR_DOCUMENT_SETTINGS,
                extraHeadHtml: '<meta name="x-test" content="sidecar">',
                extraBodyEndHtml: '<!-- sidecar-footer -->',
                imagesBaseUri: '/assets/images',
            });
            if (!html.includes('data-acm-surface="app-sidecar"')) throw new Error('missing surface');
            if (!html.includes('v1.17.5')) throw new Error('missing version');
            if (!html.includes('<meta name="x-test" content="sidecar">')) throw new Error('missing extraHeadHtml');
            if (!html.includes('<!-- sidecar-footer -->')) throw new Error('missing extraBodyEndHtml');
            if (!html.includes('data-images-base-uri="/assets/images"')) throw new Error('missing imagesBaseUri');
            console.log('PURE_OK');
            `,
        ], { cwd: repoRoot, encoding: 'utf8' });
        expect(out.trim()).toBe('PURE_OK');
    });

    it('accepts both IDE and App Sidecar parameter shapes and formats deterministic 24h clock timestamps', async () => {
        await setLanguageToState('en', memState);
        const html = buildMonitorDocumentHtml({
            surface: 'app-sidecar',
            version: '1.17.5',
            data: makeUsage(),
            userStatus: { userInfo: makeUserInfo(), configs: [makeConfig('MODEL_PLACEHOLDER_M535')] },
            backendStatus: { state: 'active' },
            isPaused: false,
            now: NOW,
            contextBreakdown: makeBreakdownSnapshot(),
            quotaRunways: SAMPLE_RUNWAYS,
            conversationOptions: SAMPLE_CONV_OPTIONS,
            activeConversationId: 'conv-main-001',
            pinnedConversationId: 'conv-sub-002',
            lockToMainAgent: true,
            staleState: { isStale: true, lastSuccessAtMs: NOW - 15_000, lastError: 'ECONNRESET' },
            settings: { ...DEFAULT_MONITOR_DOCUMENT_SETTINGS, pollingInterval: 3 },
        });

        expect(html).toContain('data-acm-surface="app-sidecar"');
        expect(html).toContain('id="conversationSwitcher"');
        expect(html).toContain('value="conv-sub-002" selected');
        expect(html).toContain('id="lockMainBtn"');
        expect(html).toContain('data-action="toggleLockMain"');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain('data-surface="app-sidecar"');
        expect(html).toContain('Antigravity App');
        expect(html).toContain('id="staleBadge"');
        expect(html).toContain('Cached / Stale');
        // Deterministic 24-hour HH:MM:SS (no AM/PM)
        expect(html).toMatch(/<span class="update-time">\s*\d{2}:\d{2}:\d{2}<\/span>/);
        // Preserves h1 title cleanly without mixing surface badge inside h1
        expect(html).toMatch(/<h1>[\s\S]*?Antigravity Monitor[\s\S]*?<\/h1>/);
        expect(html).not.toMatch(/<h1>[\s\S]*?Antigravity App[\s\S]*?<\/h1>/);
    });

    it('renders masthead controls across en, zh, and both with zero 令牌', async () => {
        for (const lang of ['en', 'zh', 'both'] as Language[]) {
            await setLanguageToState(lang, memState);
            const mh = buildMonitorMastheadControlsHtml({
                surface: 'ide',
                conversationOptions: SAMPLE_CONV_OPTIONS,
                activeConversationId: 'conv-main-001',
                pinnedConversationId: null,
                lockToMainAgent: false,
                staleState: null,
            });
            expect(mh).toContain('id="conversationSwitcher"');
            expect(mh).toContain('data-action="toggleLockMain"');
            expect(mh).toContain('Antigravity IDE');
            expect(mh).not.toContain('id="staleBadge"');
            expect(mh).not.toContain('令牌');
            if (lang === 'zh') {
                expect(mh).toContain('锁定主会话');
                expect(mh).toContain('跟随活跃会话');
            }
        }
    });
});

describe('v1.17.5 Overview Context Composition Breakdown & Quick Actions', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders Dual-Cap clarity, Measurement badge, Bar + 100-Dot Matrix, Largest Items, and Copy buttons in %s', async (lang) => {
        await setLanguageToState(lang, memState);
        const cb = makeBreakdownSnapshot({
            compactionCheckpoints: [{
                stepIndex: 18,
                beforeTokens: 185_000,
                afterTokens: 92_000,
                savedTokens: 93_000,
            }],
        });
        const html = buildOverviewTabContent(
            makeUsage(),
            [makeConfig('MODEL_PLACEHOLDER_M535')],
            makeUserInfo(),
            15,
            { state: 'active' },
            NOW,
            { contextBreakdown: cb },
        );

        expect(html).toContain('class="ctx-breakdown-card"');
        expect(html).toContain('data-measurement-state="measured"');
        expect(html).toContain('data-dual-cap="true"');
        expect(html).toContain('200k');
        expect(html).toContain('512k');
        expect(html).toContain('data-compaction-saved="93000"');
        expect(html).toContain('data-ctx-viz="bar"');
        expect(html).toContain('data-ctx-viz="dots"');
        expect(html).toContain('class="ctx-seg-bar"');
        expect(html).toContain('class="ctx-dot-matrix"');
        // Exact 20x5 = 100 dot cells
        expect(html.match(/class="ctx-dot(?:\s+is-free)?"/g)).toHaveLength(100);
        expect(html).toContain('id="overview-largest-items"');
        expect(html).toContain('data-action="copyContextReport"');
        expect(html).toContain('data-action="copyHandoffPrompt"');
        expect(html).not.toContain('令牌');
    });

    it('renders all 4 measurement states honestly and never fabricates 0-token segments when awaiting generation', async () => {
        await setLanguageToState('en', memState);
        const awaiting = parseContextBreakdown({
            model: 'MODEL_PLACEHOLDER_M535',
            effectiveBudgetTokens: 200_000,
            nativeLimitTokens: 512_000,
            currentStepCount: 0,
            generatorMetadata: [],
        });
        expect(awaiting.measurementState).toBe('awaiting_generation');

        const awaitingHtml = buildOverviewTabContent(
            makeUsage({ contextUsed: 0 }),
            [makeConfig('MODEL_PLACEHOLDER_M535')],
            null,
            0,
            { state: 'active' },
            NOW,
            { contextBreakdown: awaiting },
        );
        expect(awaitingHtml).toContain('data-measurement-state="awaiting_generation"');
        expect(awaitingHtml).toContain('Awaiting Generation');
        expect(awaitingHtml).not.toContain('class="ctx-dot-matrix"');
        expect(awaitingHtml).not.toContain('class="ctx-legend-item"');

        for (const [stateKey, expectedText] of [
            ['estimated_post_compaction', 'Estimated (Post-Compaction)'],
            ['estimated_rewind', 'Estimated (Rewind)'],
        ] as const) {
            const html = buildOverviewTabContent(
                makeUsage(),
                [],
                null,
                0,
                { state: 'active' },
                NOW,
                { contextBreakdown: makeBreakdownSnapshot({ measurementState: stateKey }) },
            );
            expect(html).toContain(`data-measurement-state="${stateKey}"`);
            expect(html).toContain(expectedText);
        }
    });
});

describe('v1.17.5 GM Data Turn Diagnostics (Cold/Partial/Warm Start + Net Δ)', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders Last-Turn vs Session Cache Hit %, Cold/Partial/Warm start pills, and Net +Δ/-Δ in %s', async (lang) => {
        await setLanguageToState(lang, memState);
        const calls: GMCallEntry[] = [
            makeSampleCall({
                executionId: 'c-cold',
                inputTokens: 20_000,
                cacheReadTokens: 0,
                createdAt: '2026-11-23T09:00:00Z',
            }),
            makeSampleCall({
                executionId: 'c-partial',
                inputTokens: 20_000,
                cacheReadTokens: 15_000, // 42.9% -> partial, +15k delta
                createdAt: '2026-11-23T09:01:00Z',
            }),
            makeSampleCall({
                executionId: 'c-warm',
                inputTokens: 5_000,
                cacheReadTokens: 45_000, // 90% -> warm, +15k delta
                createdAt: '2026-11-23T09:02:00Z',
            }),
            makeSampleCall({
                executionId: 'c-compact',
                inputTokens: 15_000,
                cacheReadTokens: 5_000, // 25% -> partial, -30k compaction drop
                createdAt: '2026-11-23T09:03:00Z',
            }),
        ];
        const gm = makeGMSummary(calls);
        const td = analyzeTurnDiagnostics(calls);
        const html = buildGMDataTabContent(null, gm, makeUsage(), undefined, undefined, undefined, {}, td);

        expect(html).toContain('data-turn-cache-comparison="true"');
        expect(html).toContain('data-turn-start="cold"');
        expect(html).toContain('data-turn-start="partial"');
        expect(html).toContain('data-turn-start="warm"');
        expect(html).toContain('rc-delta-pos');
        expect(html).toContain('rc-delta-compaction');
        expect(html).not.toContain('令牌');
    });

    it('renders fallback Turn Diagnostics ledger when only raw generatorMetadata turns are available', async () => {
        await setLanguageToState('en', memState);
        const td = analyzeTurnDiagnostics([
            { chatModel: { model: 'gemini-4-neon', usage: { inputTokens: 10_000, cacheReadTokens: 0, outputTokens: 500 } } },
            { chatModel: { model: 'gemini-4-neon', usage: { inputTokens: 2_000, cacheReadTokens: 18_000, outputTokens: 600 } } },
        ]);
        const html = buildGMDataTabContent(null, null, makeUsage(), undefined, undefined, undefined, {}, td);
        expect(html).toContain('id="turnDiagnosticsLedger"');
        expect(html).toContain('Last-Turn Cache');
        expect(html).toContain('Session Cache');
        expect(html).toContain('data-turn-start="warm"');
        expect(html).toContain('+10.0k');
    });
});

describe('v1.17.5 Quota Runway, Stale-Safe Fallback & custom-* Model Isolation', () => {
    it('renders per-pool Runway indicators alongside dual-window quotas in Overview and Models tabs', async () => {
        await setLanguageToState('en', memState);
        const configs = [makeConfig('MODEL_PLACEHOLDER_M535'), makeConfig('MODEL_PLACEHOLDER_M401')];

        const overviewHtml = buildOverviewTabContent(
            makeUsage(),
            configs,
            makeUserInfo(),
            15,
            { state: 'active' },
            NOW,
            { quotaSummary: SAMPLE_QUOTA_SUMMARY, quotaRunways: SAMPLE_RUNWAYS },
        );
        expect(overviewHtml).toContain('data-runway-status="at_risk"');
        expect(overviewHtml).toContain('Est. exhaust in');
        expect(overviewHtml).toContain('24.5%/h');
        expect(overviewHtml).toContain('data-runway-status="safe_until_reset"');
        expect(overviewHtml).toContain('Safe before reset');

        const modelsHtml = buildModelsTabContent(makeUserInfo(), configs, {
            quotaSummary: SAMPLE_QUOTA_SUMMARY,
            quotaRunways: SAMPLE_RUNWAYS,
        });
        expect(modelsHtml).toContain('models-runway-card');
        expect(modelsHtml).toContain('Est. exhaust in');
        expect(modelsHtml).toContain('Safe before reset');
    });

    it('preserves cached quotas under a Cached / Stale banner during transient RPC outage', async () => {
        await setLanguageToState('en', memState);
        const configs = [makeConfig('MODEL_PLACEHOLDER_M535')];
        const staleState = { isStale: true, lastSuccessAtMs: NOW - 30_000, lastError: 'ETIMEDOUT' };

        const overviewHtml = buildOverviewTabContent(
            makeUsage(),
            configs,
            makeUserInfo(),
            15,
            { state: 'disconnected', backendIssue: 'lost' },
            NOW,
            { quotaSummary: SAMPLE_QUOTA_SUMMARY, staleState },
        );
        expect(overviewHtml).toContain('data-stale-banner="true"');
        expect(overviewHtml).toContain('Cached / Stale');
        // Cached quota pools are preserved rather than blanked
        expect(overviewHtml).toContain('Gemini');
        expect(overviewHtml).toContain('42%');

        const modelsHtml = buildModelsTabContent(makeUserInfo(), configs, { staleState });
        expect(modelsHtml).toContain('data-stale-banner="true"');
        expect(modelsHtml).toContain('Cached / Stale');
    });

    it('displays Custom Model Isolated banner and collapses Google quota pools when custom-* model is active', async () => {
        await setLanguageToState('both', memState);
        const configs = [makeConfig('MODEL_PLACEHOLDER_M535')];

        const overviewHtml = buildOverviewTabContent(
            makeUsage({ model: 'custom-deepseek-r1', modelDisplayName: 'custom-deepseek-r1' }),
            configs,
            makeUserInfo(),
            15,
            { state: 'active' },
            NOW,
            { quotaSummary: SAMPLE_QUOTA_SUMMARY, quotaRunways: SAMPLE_RUNWAYS, isCustomModelActive: true },
        );
        expect(overviewHtml).toContain('data-custom-model-isolated="true"');
        expect(overviewHtml).toContain('Custom Model Isolated');
        expect(overviewHtml).toContain('id="overview-custom-model-pools"');
        expect(overviewHtml).not.toMatch(/<details[^>]*id="overview-custom-model-pools"[^>]*\bopen\b/);

        const modelsHtml = buildModelsTabContent(makeUserInfo(), configs, {
            quotaSummary: SAMPLE_QUOTA_SUMMARY,
            quotaRunways: SAMPLE_RUNWAYS,
            isCustomModelActive: true,
        });
        expect(modelsHtml).toContain('data-custom-model-isolated="true"');
        expect(modelsHtml).toContain('id="models-custom-model-pools"');
        expect(modelsHtml).not.toContain('models-runway-card');
    });
});

describe('v1.17.5 Settings App-Sidecar Adaptation, About Dual Support, Script & Dual Theme CSS', () => {
    it('gracefully marks IDE-only status bar toggles in app-sidecar surface while keeping shared settings active', async () => {
        await setLanguageToState('both', memState);
        const storage = {
            stateFilePath: '/tmp/state-v1.json',
            stateFileExists: true,
            stateFileSizeBytes: 4096,
            stateFileOpenWarnBytes: 1_048_576,
            calendarDayCount: 7,
        };

        const sidecarHtml = buildSettingsContent([], storage, undefined, {
            surface: 'app-sidecar',
            settings: { ...DEFAULT_MONITOR_DOCUMENT_SETTINGS, lockToMainAgent: true, pollingInterval: 4 },
        });
        expect(sidecarHtml).toContain('Antigravity IDE Status Bar');
        expect(sidecarHtml).toContain('is-ide-only');
        expect(sidecarHtml).toMatch(/id="toggleContext"[^>]*disabled/);
        expect(sidecarHtml).toMatch(/id="statusTooltipDensity"[^>]*disabled/);
        expect(sidecarHtml).not.toContain('id="openStateFile"');
        // Shared settings remain active (not disabled)
        expect(sidecarHtml).toMatch(/id="toggleLockMainAgent"[^>]*checked/);
        expect(sidecarHtml).not.toMatch(/id="toggleLockMainAgent"[^>]*disabled/);
        expect(sidecarHtml).toContain('id="pollingInput"');
        expect(sidecarHtml).toContain('value="4"');
        expect(sidecarHtml).toContain('id="copyStatePath"');
        expect(sidecarHtml).toContain('id="revealStateFile"');
        expect(sidecarHtml).not.toContain('令牌');

        const ideHtml = buildSettingsContent([], storage, undefined, {
            surface: 'ide',
            settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
        });
        expect(ideHtml).not.toContain('is-ide-only');
        expect(ideHtml).toContain('id="openStateFile"');
        expect(ideHtml).not.toMatch(/id="toggleContext"[^>]*disabled/);
    });

    it('marks Antigravity App (Desktop 2.0+ Sidecar) as Supported alongside Antigravity IDE in About tab', async () => {
        for (const lang of ['en', 'zh', 'both'] as Language[]) {
            await setLanguageToState(lang, memState);
            const aboutHtml = buildAboutTabContent('1.17.5');
            expect(aboutHtml).toContain('<span class="about-version-pill">v1.17.5</span>');
            expect(aboutHtml).toContain(
                lang === 'zh'
                    ? 'Antigravity App（桌面版 2.0+ Sidecar）'
                    : 'Antigravity App (Desktop 2.0+ Sidecar)',
            );
            expect(aboutHtml.match(/class="about-platform-chip about-platform-active"/g)).toHaveLength(2);
            expect(aboutHtml).not.toContain('令牌');
        }
    });

    it('compiles valid browser JS supporting both acquireVsCodeApi and window.__ACM_BRIDGE__ plus acm:snapshot', () => {
        const script = getScript();
        expect(() => new Function(script)).not.toThrow();
        expect(script).toContain('window.__ACM_BRIDGE__');
        expect(script).toContain("window.addEventListener('acm:snapshot'");
        expect(script).toContain("command: 'selectConversation'");
        expect(script).toContain("command: 'toggleLockMain'");
        expect(script).toContain('copyContextReport');
        expect(script).toContain('copyHandoffPrompt');
        expect(script).toContain('ctxVizMode');
        expect(script).toContain('mastheadControls');
    });

    it('matches both VS Code and Antigravity App Sidecar theme attributes with balanced CSS and zero Songti', () => {
        const editorial = getEditorialStyles();
        const overview = getOverviewStyles();
        const gm = getGMDataTabStyles();

        expect(editorial).toContain('[data-acm-theme="light"]');
        expect(editorial).toContain('[data-acm-theme="hc"]');
        expect(editorial).toContain('[data-acm-theme="hc-light"]');
        expect(editorial).toContain('--ctx-cat-system:');
        expect(editorial).toContain('--ctx-cat-tools:');
        expect(editorial).toContain('grid-template-columns: repeat(20, minmax(0, 1fr))');
        expect(overview).toContain('[data-acm-theme="hc"]');
        expect(gm).toContain('[data-acm-theme="hc"]');

        for (const css of [editorial, overview, gm]) {
            expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
            expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/SimSun|Songti|宋体/i);
        }
    });

    it('wires new IDE webview messages (selectConversation, toggleLockMain, copyContextReport, copyHandoffPrompt)', async () => {
        await setLanguageToState('en', memState);
        let onMessage: ((msg: Record<string, unknown>) => Promise<void> | void) | undefined;
        let onDispose: (() => void) | undefined;
        const posted: Array<Record<string, unknown>> = [];
        const copiedTexts: string[] = [];
        const executedCommands: string[] = [];

        vi.spyOn(vscode.env.clipboard, 'writeText').mockImplementation(async (text: string) => {
            copiedTexts.push(text);
        });
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string) => {
            executedCommands.push(cmd);
            return undefined;
        });

        const fakePanel = {
            visible: true,
            webview: {
                html: '',
                postMessage: (msg: Record<string, unknown>) => { posted.push(msg); return Promise.resolve(true); },
                onDidReceiveMessage: (cb: (msg: Record<string, unknown>) => Promise<void> | void) => {
                    onMessage = cb;
                    return { dispose: () => {} };
                },
            },
            reveal: () => {},
            onDidChangeViewState: () => ({ dispose: () => {} }),
            onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => {} }; },
        };
        vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

        try {
            showMonitorPanel({
                currentUsage: makeUsage(),
                allTrajectoryUsages: [makeUsage()],
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                userInfo: makeUserInfo(),
                contextBreakdown: makeBreakdownSnapshot(),
                conversationOptions: SAMPLE_CONV_OPTIONS,
                activeConversationId: 'conv-main-001',
            });

            expect(onMessage).toBeDefined();

            await onMessage!({ command: 'copyContextReport' });
            expect(copiedTexts.length).toBe(1);
            expect(copiedTexts[0]).toContain('Gemini 4 Neon');
            expect(posted.some(m => m.command === 'copyActionResult' && m.action === 'copyContextReport' && m.ok === true)).toBe(true);

            await onMessage!({ command: 'copyHandoffPrompt' });
            expect(copiedTexts.length).toBe(2);
            expect(copiedTexts[1]).toContain('HANDOFF');
            expect(posted.some(m => m.command === 'copyActionResult' && m.action === 'copyHandoffPrompt' && m.ok === true)).toBe(true);

            await onMessage!({ command: 'toggleLockMain', locked: true });
            expect(posted.some(m => m.command === 'syncSettingsControls' && m.lockToMainAgent === true)).toBe(true);
            expect(executedCommands).toContain('antigravity-context-monitor.refresh');

            await onMessage!({ command: 'selectConversation', conversationId: 'conv-sub-002' });
            expect(executedCommands.filter(c => c === 'antigravity-context-monitor.refresh').length).toBeGreaterThanOrEqual(2);

            // panelReady emits updateTabs with deterministic 24-hour HH:MM:SS time and mastheadControls
            posted.length = 0;
            await onMessage!({ command: 'panelReady' });
            const updateMsg = posted.find(m => m.command === 'updateTabs') as { time?: string; tabs?: Record<string, unknown> } | undefined;
            expect(updateMsg).toBeDefined();
            expect(updateMsg!.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
            expect(typeof updateMsg!.tabs?.mastheadControls).toBe('string');

            // Reset lock state back to false cleanly
            await onMessage!({ command: 'toggleLockMain', locked: false });
            await onMessage!({ command: 'selectConversation', conversationId: null });
        } finally {
            onDispose?.();
        }
    });
});

// Consolidated Domain Suite: Webview Tabs & Features (v1.17.5–v1.17.6)
import { execFileSync } from 'child_process';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as vscode from 'vscode';
import { getLanguage, type Language, setLanguageToState } from '../src/i18n';
import { type ContextBreakdownSnapshot, parseContextBreakdown } from '../src/context-breakdown';
import { analyzeTurnDiagnostics } from '../src/turn-diagnostics';
import type { QuotaRunwayEstimate } from '../src/quota-runway';
import type { ConversationOption } from '../src/conversation-selector';
import {
    getModelDisplayName,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../src/models';
import type { ContextUsage } from '../src/tracker';
import type { GMCallEntry, GMSummary } from '../src/gm-tracker';
import {
    buildMonitorDocumentHtml,
    buildMonitorMastheadControlsHtml,
    buildMonitorTabsPayload,
    buildNativeHudHtml,
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
} from '../src/webview-document';
import { buildOverviewTabContent, evaluateLowQuotaWarning, getOverviewStyles } from '../src/webview-overview-tab';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { buildAboutTabContent, getAboutTabStyles } from '../src/webview-about-tab';
import { getScript } from '../src/webview-script';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { showMonitorPanel } from '../src/webview-panel';
import { getIdePanelHostBridge, registerIdePanelHostBridge } from '../src/ide-panel-types';
import { t, translations } from '../src/i18n-core';
import { getCalendarTabStyles } from '../src/webview-calendar-tab';
import { getOrchestratorAttributionStyles } from '../src/orchestrator-attribution';
import type { CdpStatus } from '../src/app/sidecar-types';

describe('[webview-v1175-features]', () => {
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

            expect(html).toMatch(/<details[^>]+id="overview-context-composition"[^>]+data-ctx-breakdown="true"[^>]*>\s*<summary>/);
            expect(html).toContain('data-measurement-state="measured"');
            expect(html).toContain('data-dual-cap="true"');
            expect(html).toContain('200k');
            expect(html).toContain('512k');
            expect(html).toContain('data-compaction-saved="93000"');
            expect(html).toContain('data-ctx-viz="bar"');
            expect(html).toContain('data-ctx-viz="dots"');
            expect(html).toContain('class="ctx-seg-bar"');
            // WCAG aria-required-children: legend uses valid <ul><li><button> structure
            expect(html).toContain('<ul class="ctx-legend"');
            expect(html).toContain('<li class="ctx-legend-row"><button');
            expect(html).not.toContain('role="list"');
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
                expect(aboutHtml).toContain('about-acks');
                expect(aboutHtml).toContain('https://github.com/dimitr-io/antigravity-desktop-context');
                expect(aboutHtml).toContain('https://github.com/benedictusrey/Antigravity-Monitor');
                expect(aboutHtml).not.toContain('令牌');
            }
        });

        it('compiles valid browser JS supporting both acquireVsCodeApi and window.__ACM_BRIDGE__ plus acm:snapshot', () => {
            const script = getScript();
            expect(() => new Function(script)).not.toThrow();
            expect(script).toContain('window.__ACM_BRIDGE__');
            expect(script).toMatch(/[A-Za-z_$][\w$]*\(\s*window\s*,\s*['"]acm:snapshot['"]/);
            expect(script).toMatch(/command:\s*['"]selectConversation['"]/);
            expect(script).toMatch(/command:\s*['"]toggleLockMain['"]/);
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
            const host = getIdePanelHostBridge();
            const refreshSelection = vi.fn();
            const inspectSwarmMember = vi.fn(() => null);
            registerIdePanelHostBridge({ ...host, refreshSelection, inspectSwarmMember });

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
                expect(refreshSelection).toHaveBeenCalledTimes(1);

                await onMessage!({ command: 'selectConversation', conversationId: 'conv-sub-002' });
                expect(refreshSelection).toHaveBeenCalledTimes(2);
                await onMessage!({ command: 'inspectMember', cascadeId: 'conv-sub-002' });
                expect(inspectSwarmMember).toHaveBeenCalledWith('conv-sub-002');
                expect(refreshSelection).toHaveBeenCalledTimes(3);
                expect(executedCommands).not.toContain('antigravity-context-monitor.refresh');

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
                registerIdePanelHostBridge(host);
            }
        });
    });
});

describe('[webview-v1176-ui]', () => {
    const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };

    const initialLang = getLanguage();

    const NOW = Date.parse('2026-11-23T10:30:00Z');


    function makeConfig(model: string, remainingFraction = 0.72, overrides: Partial<ModelConfig> = {}): ModelConfig {
        return {
            model,
            label: overrides.label || getModelDisplayName(model),
            supportsImages: true,
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
            quotaInfo: { remainingFraction, resetTime: '2026-11-23T14:30:00Z' },
            ...overrides,
        };
    }


    function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
        return {
            cascadeId: 'conv-v1176-001',
            title: 'Phase B UI Glue Verification',
            model: 'MODEL_PLACEHOLDER_M535',
            modelDisplayName: 'Gemini 4 Neon (Extra High)',
            contextUsed: 150_000,
            totalOutputTokens: 3_200,
            totalToolCallOutputTokens: 12_000,
            contextLimit: 512_000,
            usagePercent: 29.3,
            stepCount: 16,
            lastModifiedTime: '2026-11-23T10:29:00Z',
            status: 'RUNNING',
            isEstimated: false,
            lastModelUsage: null,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: false,
            checkpointModel: '',
            createdTime: '2026-11-23T09:00:00Z',
            lastUserInputTime: '2026-11-23T10:28:00Z',
            lastUserInputStepIndex: 14,
            repositoryName: 'antigravity',
            gitOriginUrl: '',
            branchName: 'main',
            gitRootUri: '',
            ...overrides,
        };
    }


    function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            executionId: 'exec-1',
            stepIndices: [1],
            model: 'MODEL_PLACEHOLDER_M535',
            modelDisplay: 'Gemini 4 Neon (Extra High)',
            responseModel: 'gemini-4-neon',
            modelAccuracy: 'exact',
            inputTokens: 20_000,
            outputTokens: 600,
            thinkingTokens: 100,
            responseTokens: 500,
            cacheReadTokens: 80_000,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            ttftSeconds: 0.9,
            streamingSeconds: 6.0,
            credits: 0,
            creditType: '',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 100_000,
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
            stopReason: 'STOP',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: '2026-11-23T10:20:00Z',
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 512_000,
            ...overrides,
        };
    }


    function makeGMSummary(calls: GMCallEntry[], cascadeId = 'conv-v1176-001'): GMSummary {
        return {
            conversations: [{
                cascadeId,
                title: 'Phase B UI Glue Verification',
                totalSteps: calls.length,
                calls,
                coveredSteps: calls.length,
                coverageRate: 1,
                checkpointSummaries: [],
            }],
            modelBreakdown: {},
            totalCalls: calls.length,
            totalStepsCovered: calls.length,
            totalCredits: 0,
            totalInputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
            totalOutputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
            totalCacheRead: calls.reduce((s, c) => s + c.cacheReadTokens, 0),
            totalCacheCreation: calls.reduce((s, c) => s + c.cacheCreationTokens, 0),
            totalThinkingTokens: calls.reduce((s, c) => s + c.thinkingTokens, 0),
            contextGrowth: [],
            fetchedAt: '2026-11-23T10:30:00Z',
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


    function makeUserInfo(): UserStatusInfo {
        return {
            name: 'Lin',
            email: 'lin@example.test',
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


    const SAMPLE_ORCH_SETTINGS: OrchestratorSettings = {
        configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
        effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
        isCustomOrchestrator: true,
        isCustomExecutor: true,
        mode: 'custom',
        roles: {
            orchestrators: ['gemini-4-neon', 'claude-opus-5-5'],
            executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
        },
        orchestratorCandidates: ['MODEL_PLACEHOLDER_M535', 'MODEL_PLACEHOLDER_M401'],
        executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
        lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M401',
    };


    const SAMPLE_QUOTA_SUMMARY: UserQuotaSummary = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.15,
                    resetTime: '2026-11-23T14:30:00Z',
                    resetAt: Date.parse('2026-11-23T14:30:00Z'),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.85,
                    resetTime: '2026-11-29T14:30:00Z',
                    resetAt: Date.parse('2026-11-29T14:30:00Z'),
                },
                buckets: [],
            },
        ],
    };


    beforeEach(async () => {
        await setLanguageToState('both', memState);
    });


    afterEach(async () => {
        await setLanguageToState(initialLang, memState);
    });


    describe('v1.17.6 Native Sidecar Collapsible Ambient HUD', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders mini SVG ring, Short sample guard with raw tooltip, currency cost, tightest quota, and toggle drawer in %s', async (lang) => {
            await setLanguageToState(lang, memState);
            const shortCall = makeCall({ outputTokens: 8, streamingSeconds: 0.08, ttftSeconds: 0.65, inputTokens: 10_000, cacheReadTokens: 40_000 });
            const gm = makeGMSummary([shortCall]);
            const html = buildNativeHudHtml({
                usage: makeUsage({ contextUsed: 180_000, contextLimit: 512_000 }),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 0.15)],
                quotaSummary: SAMPLE_QUOTA_SUMMARY,
                gmSummary: gm,
                sessionCostUsd: 1.0,
                todayCostUsd: 2.5,
                displayCurrency: { code: 'CNY', customRatePerUsd: 7.2 },
                now: NOW,
            });

            expect(html).toContain('id="nativeHudBar"');
            expect(html).toContain('data-native-hud="true"');
            expect(html).toContain('class="native-hud-ring-svg"');
            expect(html).toContain('35%');
            expect(html).toContain('data-hud-speed="short-sample"');
            expect(html).toContain(lang === 'zh' ? '短样本' : 'Short sample');
            expect(html).toContain('100.0 tok/s'); // raw value in tooltip
            expect(html).toContain('650ms'); // TTFT
            expect(html).toContain('80.0%'); // Cache Hit %
            expect(html).toContain('¥7.20'); // Selected currency (CNY * 7.2)
            expect(html).toContain('$1.00'); // Dual USD reference in tooltip
            expect(html).toContain('15%'); // Tightest quota %
            expect(html).toContain('id="nativeHudToggle"');
            expect(html).toContain('data-action="toggleNativeHud"');
            expect(html).toContain('id="nativeHudDrawer"');
            expect(html).not.toContain('令牌');
        });

        it('enables Native HUD by default on app-sidecar and respects showNativeHudBar toggle on both surfaces', async () => {
            await setLanguageToState('en', memState);
            const appDefault = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                data: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                now: NOW,
            });
            expect(appDefault).toContain('id="nativeHudBar"');
            expect(appDefault).not.toMatch(/id="nativeHudHost"[^>]*hidden/);

            const appDisabled = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                data: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                appSettings: { showNativeHudBar: false },
                now: NOW,
            });
            expect(appDisabled).not.toContain('id="nativeHudBar"');
            expect(appDisabled).toMatch(/id="nativeHudHost"[^>]*hidden/);

            const ideDefault = buildMonitorDocumentHtml({
                surface: 'ide',
                currentUsage: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                now: NOW,
            });
            expect(ideDefault).not.toContain('id="nativeHudBar"');

            const ideEnabled = buildMonitorDocumentHtml({
                surface: 'ide',
                currentUsage: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                appSettings: { showNativeHudBar: true },
                now: NOW,
            });
            expect(ideEnabled).toContain('id="nativeHudBar"');
            const payload = buildMonitorTabsPayload({
                surface: 'ide',
                currentUsage: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                appSettings: { showNativeHudBar: true },
                now: NOW,
            });
            expect(payload.nativeHud).toContain('id="nativeHudBar"');
        });
    });


    describe('v1.17.6 Overview Tab: Orchestrator Split, Dual Watermarks, Speed/Turn Guards, Low-Quota Banner & Jargon Tips', () => {
        it('renders Orchestrator Split card on multi-model conversations and auto-hides on single-model conversations', async () => {
            await setLanguageToState('both', memState);
            const multiCalls = [
                makeCall({
                    executionId: 'p1',
                    model: 'MODEL_PLACEHOLDER_M401',
                    modelDisplay: 'Claude Opus 5.5 (Medium)',
                    responseModel: 'claude-opus-5-5',
                    inputTokens: 20_000,
                    cacheReadTokens: 0,
                    outputTokens: 500,
                    streamingSeconds: 5,
                }),
                makeCall({
                    executionId: 'e1',
                    model: 'MODEL_PLACEHOLDER_M528',
                    modelDisplay: 'Gemini 4 Hydrogen (XHigh)',
                    responseModel: 'gemini-4-hydrogen',
                    inputTokens: 25_000,
                    cacheReadTokens: 0,
                    outputTokens: 800,
                    streamingSeconds: 8,
                }),
            ];
            const multiHtml = buildOverviewTabContent(
                makeUsage({
                    model: 'MODEL_PLACEHOLDER_M401',
                    orchestratorConfig: {
                        planModel: 'MODEL_PLACEHOLDER_M401',
                        executionModel: 'MODEL_PLACEHOLDER_M528',
                    },
                }),
                [makeConfig('MODEL_PLACEHOLDER_M401'), makeConfig('MODEL_PLACEHOLDER_M528')],
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                {
                    gmSummary: makeGMSummary(multiCalls),
                    orchestratorSettings: SAMPLE_ORCH_SETTINGS,
                },
            );
            expect(multiHtml).toContain('id="overviewOrchestratorSplitCard"');
            expect(multiHtml).toContain('data-orchestrator-split="true"');
            expect(multiHtml).toContain('编排模型');
            expect(multiHtml).toContain('执行模型');
            expect(multiHtml).not.toContain('编排器模型');
            expect(multiHtml).not.toContain('执行器模型');

            // Full document containing both #tab-overview and #tab-gmdata must have ZERO duplicate split card IDs
            const fullDoc = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                data: makeUsage({
                    model: 'MODEL_PLACEHOLDER_M401',
                    orchestratorConfig: {
                        planModel: 'MODEL_PLACEHOLDER_M401',
                        executionModel: 'MODEL_PLACEHOLDER_M528',
                    },
                }),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M401'), makeConfig('MODEL_PLACEHOLDER_M528')],
                userInfo: makeUserInfo(),
                gmSummary: makeGMSummary(multiCalls),
                orchestratorSettings: SAMPLE_ORCH_SETTINGS,
                now: NOW,
            });
            expect(fullDoc.match(/id="overviewOrchestratorSplitCard"/g)).toHaveLength(1);
            expect(fullDoc.match(/id="orchestratorSplitCard"/g)).toHaveLength(1);

            const singleCalls = [makeCall({ executionId: 's1' }), makeCall({ executionId: 's2' })];
            const singleHtml = buildOverviewTabContent(
                makeUsage({ orchestratorConfig: undefined }),
                [makeConfig('MODEL_PLACEHOLDER_M535')],
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                { gmSummary: makeGMSummary(singleCalls) },
            );
            expect(singleHtml).not.toContain('id="overviewOrchestratorSplitCard"');
            expect(singleHtml).not.toContain('id="orchestratorSplitCard"');
        });

        it('renders Dual-Watermark markers (compaction ceiling + 200k long-context tier), Short sample guard, Turn cache start + Δ, and all 5 jargon tips', async () => {
            await setLanguageToState('both', memState);
            const calls = [
                makeCall({
                    executionId: 't1',
                    userMessageAnchors: [{ stepIndex: 1, text: 'hello' }],
                    inputTokens: 20_000,
                    cacheReadTokens: 0,
                    outputTokens: 300,
                    streamingSeconds: 3.0,
                }),
                makeCall({
                    executionId: 't2',
                    userMessageAnchors: [{ stepIndex: 1, text: 'hello' }, { stepIndex: 5, text: 'next' }],
                    inputTokens: 5_000,
                    cacheReadTokens: 35_000, // 87.5% warm start, +20k net delta
                    outputTokens: 6, // triggers Short sample guard!
                    streamingSeconds: 0.05,
                }),
            ];
            const cb = parseContextBreakdown({
                model: 'MODEL_PLACEHOLDER_M535',
                effectiveBudgetTokens: 256_000,
                nativeLimitTokens: 1_048_576,
                currentStepCount: 16,
                generatorMetadata: [{
                    stepIndices: [14, 15],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M535',
                        promptSections: [
                            { title: 'System', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 50_000 },
                            { title: 'Tools', tokenType: 'TOKEN_TYPE_TOOL_RESULT', numTokens: 170_000 },
                        ],
                        usage: { inputTokens: 20_000, cacheReadTokens: 200_000, outputTokens: 1_000 },
                    },
                }],
            });

            const html = buildOverviewTabContent(
                makeUsage({ contextUsed: 220_000, contextLimit: 256_000 }),
                [makeConfig('MODEL_PLACEHOLDER_M535', 0.65)],
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                {
                    gmSummary: makeGMSummary(calls),
                    contextBreakdown: cb,
                    sessionCostUsd: 0.85,
                },
            );

            // Dual watermarks: 200k long-context tier exceeded + compaction ceiling vs physical window
            expect(html).toContain('data-dual-watermark="true"');
            expect(html).toContain('data-watermark="long-context-200k"');
            expect(html).toContain('is-exceeded');
            expect(html).toContain('data-watermark="compaction-limit"');

            // Sparse-sample speed guard with raw value in tooltip
            expect(html).toContain('data-speed-state="short-sample"');
            expect(html).toContain('Short sample');
            expect(html).toContain('短样本');
            expect(html).toContain('120.0 tok/s');

            // User-turn cache start + net context growth (+Δ)
            expect(html).toContain('data-turn-cache-state="warm"');
            expect(html).toContain('data-turn-net-delta="20000"');
            expect(html).toContain('+20k');

            // Deduplicated core jargon tips (fixed Session Cost ?, no internal M537/M667/M681/M669 codes)
            // + bottom jargon row folded into default-collapsed #overview-glossary <details>
            expect(html).not.toContain('class="overview-jargon-row"');
            expect(html).toContain('id="overview-glossary"');
            expect(html).toContain('data-state-key="overview-glossary"');
            expect(html).not.toMatch(/<details[^>]*id="overview-glossary"[^>]*\bopen\b/);
            for (const jargon of ['ttft', 'dual-cap', 'session-cost']) {
                expect(html, `missing jargon tip ${jargon}`).toContain(`data-jargon="${jargon}"`);
            }
            expect(html).not.toContain('data-jargon="mapped-base-rate"');
            expect(html).not.toMatch(/M537|M667|M681|M669/);
            for (const cell of ['speed', 'ttft', 'cache-hit', 'cache-saved', 'cost']) {
                expect(html, `missing telemetry cell ${cell}`).toContain(`data-telemetry-cell="${cell}"`);
            }
        });

        it('forwards orchestratorPricingMode to Overview telemetry so legacy M537 cache savings resolve in mapped mode and omit USD in strict mode', async () => {
            await setLanguageToState('en', memState);
            const legacyCall = makeCall({
                model: 'MODEL_PLACEHOLDER_M537',
                modelDisplay: 'Orchestrator (Neon)',
                responseModel: 'gemini-pro-orchestrator-neon',
                inputTokens: 10_000,
                cacheReadTokens: 100_000,
                outputTokens: 400,
                streamingSeconds: 4.0,
            });
            const gm = makeGMSummary([legacyCall]);
            const mappedHtml = buildOverviewTabContent(
                makeUsage({ model: 'MODEL_PLACEHOLDER_M537' }),
                [makeConfig('MODEL_PLACEHOLDER_M537')],
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                { gmSummary: gm, orchestratorPricingMode: 'mapped' },
            );
            const strictHtml = buildOverviewTabContent(
                makeUsage({ model: 'MODEL_PLACEHOLDER_M537' }),
                [makeConfig('MODEL_PLACEHOLDER_M537')],
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                { gmSummary: gm, orchestratorPricingMode: 'strict' },
            );
            expect(mappedHtml).toContain('$0.28'); // 100k cacheRead * ($3 - $0.15) / 1e6 = $0.285 -> $0.28 / $0.29
            expect(strictHtml).not.toContain('$0.28');
            expect(strictHtml).toContain('100k tokens');
        });

        it('renders App-side Low-Quota Warning Banner when pool remaining % <= threshold and suppresses for BYOK / threshold=0', async () => {
            await setLanguageToState('both', memState);
            const lowConfigs = [makeConfig('MODEL_PLACEHOLDER_M535', 0.15)];

            const warnedHtml = buildOverviewTabContent(
                makeUsage(),
                lowConfigs,
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                {
                    surface: 'app-sidecar',
                    quotaSummary: SAMPLE_QUOTA_SUMMARY,
                    quotaNotificationThreshold: 20,
                },
            );
            expect(warnedHtml).toContain('id="lowQuotaBanner"');
            expect(warnedHtml).toContain('data-low-quota-banner="true"');
            expect(warnedHtml).toContain('data-threshold="20"');
            expect(warnedHtml).toContain('15%');

            const disabledHtml = buildOverviewTabContent(
                makeUsage(),
                lowConfigs,
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                { quotaSummary: SAMPLE_QUOTA_SUMMARY, quotaNotificationThreshold: 0 },
            );
            expect(disabledHtml).not.toContain('id="lowQuotaBanner"');

            const byokHtml = buildOverviewTabContent(
                makeUsage({ model: 'custom-local' }),
                lowConfigs,
                makeUserInfo(),
                15,
                { state: 'active' },
                NOW,
                { quotaSummary: SAMPLE_QUOTA_SUMMARY, quotaNotificationThreshold: 20, isCustomModelActive: true },
            );
            expect(byokHtml).not.toContain('id="lowQuotaBanner"');
            expect(evaluateLowQuotaWarning([], 20, false)).toBeNull();
        });
    });


    describe('v1.17.6 Settings Tab: Overlays/CDP, Updates, Cost/Currency/History, Collapsed IDE Card & Zoom SSR', () => {
        it('renders App Ambient Overlays card with CDP status states and cross-platform launch guide', async () => {
            await setLanguageToState('both', memState);
            const connectedStatus: CdpStatus = {
                state: 'connected',
                composerEnabled: true,
                topBarEnabled: false,
                targetTitle: 'Antigravity Hub',
                platformGuide: {
                    platform: 'darwin',
                    command: 'open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                    en: 'Launch with --remote-debugging-port=0',
                    zh: '使用 --remote-debugging-port=0 启动',
                },
            };
            const html = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: {
                    appComposerRingEnabled: true,
                    appTopBarEnabled: false,
                    showNativeHudBar: true,
                },
                cdpStatus: connectedStatus,
            });

            expect(html).toContain('id="appOverlaysCard"');
            expect(html).toMatch(/id="toggleAppComposerRing"[^>]*checked/);
            expect(html).not.toMatch(/id="toggleAppTopBar"[^>]*checked/);
            expect(html).toMatch(/id="toggleNativeHudBar"[^>]*checked/);
            expect(html).toContain('data-cdp-state="connected"');
            expect(html).toContain('data-cdp-diagnostic="connected"');
            expect(html).toContain('id="cdpDiagnosticHint"');
            expect(html).toContain('id="cdpRecheckBtn"');
            expect(html).toContain('data-action="recheckCdp"');
            expect(html).toContain('id="settings-cdp-guide"');
            expect(html).toContain('--remote-debugging-port=0');
            expect(html).toContain('/Applications/Antigravity.app');
            expect(html).toContain('$env:LOCALAPPDATA');
            expect(html).toContain('%LOCALAPPDATA%');
            expect(html).toContain('Cmd+Q');
            expect(html).toContain('app.asar');

            const inactiveHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: { ...connectedStatus, state: 'cdp_unavailable', diagnosticCode: 'missing_port_file' },
            });
            expect(inactiveHtml).toContain('data-cdp-state="cdp_unavailable"');
            expect(inactiveHtml).toContain('data-cdp-diagnostic="missing_port_file"');
            expect(inactiveHtml).toContain('CDP Inactive');
            expect(inactiveHtml).toContain('DevToolsActivePort');

            const unreachableHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: {
                    ...connectedStatus,
                    state: 'cdp_unavailable',
                    diagnosticCode: 'port_unreachable',
                    discoveredPort: 9222,
                },
            });
            expect(unreachableHtml).toContain('data-cdp-diagnostic="port_unreachable"');
            expect(unreachableHtml).toContain('9222');

            const noHubHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: {
                    ...connectedStatus,
                    state: 'cdp_unavailable',
                    diagnosticCode: 'no_hub_target',
                    discoveredPort: 9222,
                },
            });
            expect(noHubHtml).toContain('data-cdp-diagnostic="no_hub_target"');

            // host_missing_flag diagnostic + Persistent CDP Launcher controls (uninstalled vs installed) + race-free macOS guide
            const hostMissingHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: {
                    ...connectedStatus,
                    state: 'cdp_unavailable',
                    diagnosticCode: 'host_missing_flag',
                    hostHasDebugFlag: false,
                    launcherStatus: {
                        supported: true,
                        platform: 'darwin',
                        installed: false,
                        launcherPath: '/tmp/test-home/Applications/Antigravity (CDP).app',
                        displayName: 'Antigravity (CDP)',
                        targetAppFound: true,
                        targetAppPath: '/Applications/Antigravity.app',
                        safeTerminalCommand: 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                        noteEn: 'Zero-patch launcher note EN',
                        noteZh: '零魔改启动器说明 ZH',
                    },
                },
            });
            expect(hostMissingHtml).toContain('data-cdp-diagnostic="host_missing_flag"');
            expect(hostMissingHtml).toContain('5s');
            expect(hostMissingHtml).not.toContain('一键生成并重启');
            expect(hostMissingHtml).toContain('Step 1');
            expect(hostMissingHtml).toContain('Step 2');
            expect(hostMissingHtml).toContain('步骤 1');
            expect(hostMissingHtml).toContain('步骤 2');
            expect(hostMissingHtml).toContain('id="cdpLauncherBox"');
            expect(hostMissingHtml).toContain('id="cdpLauncherStatus"');
            expect(hostMissingHtml).toContain('data-launcher-installed="false"');
            expect(hostMissingHtml).toContain('id="cdpSetupLauncherBtn"');
            expect(hostMissingHtml).toContain('Create Persistent Launcher');
            expect(hostMissingHtml).toContain('一键生成持久化启动器');
            expect(hostMissingHtml).toMatch(/id="cdpRevealLauncherBtn"[^>]*data-action="revealCdpLauncher"[^>]*hidden/);
            expect(hostMissingHtml).toMatch(/id="cdpRemoveLauncherBtn"[^>]*hidden/);
            expect(hostMissingHtml).toContain('pgrep -f');
            expect(hostMissingHtml).toContain('cdp-copy-btn');

            const installedLauncherHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: {
                    ...connectedStatus,
                    state: 'cdp_unavailable',
                    diagnosticCode: 'host_missing_flag',
                    launcherStatus: {
                        supported: true,
                        platform: 'darwin',
                        installed: true,
                        launcherPath: '/tmp/test-home/Applications/Antigravity (CDP).app',
                        displayName: 'Antigravity (CDP)',
                        targetAppFound: true,
                        targetAppPath: '/Applications/Antigravity.app',
                        safeTerminalCommand: 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                        noteEn: 'Zero-patch launcher note EN',
                        noteZh: '零魔改启动器说明 ZH',
                    },
                },
            });
            expect(installedLauncherHtml).toContain('data-launcher-installed="true"');
            expect(installedLauncherHtml).toContain('Recreate Launcher');
            expect(installedLauncherHtml).toContain('重新生成启动器');
            expect(installedLauncherHtml).toContain('Reveal in Finder');
            expect(installedLauncherHtml).toContain('在访达中显示');
            expect(installedLauncherHtml).toContain('持久化启动器已就绪');
            expect(installedLauncherHtml).not.toContain('一键生成并重启');
            expect(installedLauncherHtml).not.toMatch(/id="cdpRevealLauncherBtn"[^>]*hidden/);
            expect(installedLauncherHtml).not.toMatch(/id="cdpRemoveLauncherBtn"[^>]*hidden/);

            // Platform-aware reveal labels on Windows and Linux
            const winInstalledHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: {
                    ...connectedStatus,
                    state: 'cdp_unavailable',
                    diagnosticCode: 'host_missing_flag',
                    launcherStatus: {
                        supported: true,
                        platform: 'win32',
                        installed: true,
                        launcherPath: 'C:\\Users\\Alice\\Desktop\\Antigravity (CDP).lnk',
                        displayName: 'Antigravity (CDP)',
                        targetAppFound: true,
                        safeTerminalCommand: '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0',
                        noteEn: 'Win note',
                        noteZh: 'Win 说明',
                    },
                },
            });
            expect(winInstalledHtml).toContain('Show in Explorer');
            expect(winInstalledHtml).toContain('在资源管理器中显示');

            const linuxInstalledHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: {
                    ...connectedStatus,
                    state: 'cdp_unavailable',
                    diagnosticCode: 'host_missing_flag',
                    launcherStatus: {
                        supported: true,
                        platform: 'linux',
                        installed: true,
                        launcherPath: '/home/alice/.local/share/applications/antigravity-cdp.desktop',
                        displayName: 'Antigravity (CDP)',
                        targetAppFound: true,
                        safeTerminalCommand: 'antigravity --remote-debugging-port=0',
                        noteEn: 'Linux note',
                        noteZh: 'Linux 说明',
                    },
                },
            });
            expect(linuxInstalledHtml).toContain('Open Folder');
            expect(linuxInstalledHtml).toContain('打开所在目录');

            const probingHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'ide',
                appSettings: { appComposerRingEnabled: true, appTopBarEnabled: false },
                cdpStatus: { ...connectedStatus, state: 'probing', diagnosticCode: 'probing' },
            });
            expect(probingHtml).toContain('data-cdp-state="probing"');
            expect(probingHtml).toContain('data-cdp-diagnostic="probing"');
            expect(probingHtml).toContain('Checking…');
            expect(probingHtml).toContain('检测中…');
            expect(probingHtml).toContain('Checking Antigravity App CDP connection…');
            expect(probingHtml).not.toContain('data-cdp-diagnostic="missing_port_file"');

            const disabledHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
            });
            expect(disabledHtml).toContain('data-cdp-state="disabled"');
            expect(disabledHtml).toMatch(/id="cdpDiagnosticHint"[^>]*hidden/);
        });

        it('renders Updates card (App Upgrade Now vs IDE Open VSX hint), Cost/Currency/History card, collapsed IDE-only card, and live zoom SSR', async () => {
            await setLanguageToState('both', memState);
            const appHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                version: '1.17.5',
                zoomLevel: 120,
                updateStatus: {
                    status: 'update_available',
                    updateAvailable: true,
                    currentVersion: '1.17.5',
                    latestVersion: '1.17.6',
                    checkedAt: NOW,
                },
                appSettings: {
                    autoCheckUpdates: true,
                    orchestratorPricingMode: 'strict',
                    displayCurrency: 'CNY',
                    customFxRate: 7.3,
                    subscriptionPlan: 'google-ai-ultra-20x',
                    subscriptionMonthlyFee: 199.99,
                    subscriptionCurrency: 'USD',
                    calendarRetentionDays: 450,
                    activityMaxRecentSteps: 200,
                    activityMaxArchives: 40,
                },
            });

            // Updates card (App surface -> Upgrade Now visible)
            expect(appHtml).toContain('id="updatesSettingsCard"');
            expect(appHtml).toContain('data-action="checkForUpdates"');
            expect(appHtml).toContain('data-action="applyPluginUpdate"');
            expect(appHtml).toContain('v1.17.6');

            // Cost, Currency & History card
            expect(appHtml).toContain('id="costCurrencyHistoryCard"');
            expect(appHtml).toMatch(/id="stgOrchModeStrict"[^>]*aria-checked="true"/);
            expect(appHtml).toContain('class="stg-form-grid stg-form-grid-subscription"');
            expect(appHtml).toContain('class="stg-field stg-field-plan"');
            expect(appHtml).toContain('id="displayCurrencySelect" class="stg-select"');
            expect(appHtml).toContain('<option value="CNY" selected>');
            expect(appHtml).toContain('<option value="TWD">');
            expect(appHtml).toContain('id="customFxRateInput"');
            expect(appHtml).toContain('value="7.3"');
            expect(appHtml).toContain('id="subscriptionPlanSelect" class="stg-select"');
            expect(appHtml).toContain('<option value="none">');
            expect(appHtml).toContain('<option value="google-ai-pro">Google AI Pro ($19.99/mo)</option>');
            expect(appHtml).toContain('<option value="google-ai-ultra-5x">Google AI Ultra 5x ($99.99/mo)</option>');
            expect(appHtml).toContain('<option value="google-ai-ultra-20x" selected>Google AI Ultra 20x ($199.99/mo)</option>');
            expect(appHtml).toContain('<option value="custom">');
            expect(appHtml).toContain('id="subscriptionFeeInput"');
            expect(appHtml).toMatch(/id="subscriptionFeeInput"[^>]*placeholder="199\.99"/);
            expect(appHtml).toContain('id="subscriptionCurrencySelect"');
            expect(appHtml).toContain('id="calendarRetentionInput"');
            expect(appHtml).toContain('value="450"');
            expect(appHtml).toContain('id="activityMaxRecentStepsInput"');
            expect(appHtml).toContain('value="200"');
            expect(appHtml).toContain('id="activityMaxArchivesInput"');
            expect(appHtml).toContain('value="40"');

            // Collapsed IDE Status Bar card on App
            expect(appHtml).toContain('id="settings-ide-status-bar"');
            expect(appHtml).not.toMatch(/<details[^>]*id="settings-ide-status-bar"[^>]*\bopen\b/);

            // Fixed zoomRange SSR reflecting zoomLevel=120
            expect(appHtml).toMatch(/id="zoomRange"[^>]*value="120"/);
            expect(appHtml).toContain('<span class="zoom-value" id="zoomValue">120%</span>');
            expect(appHtml).toContain('class="preset-btn zoom-preset is-active" data-zoom="120"');

            // IDE surface: IDE Status Bar open by default & Open VSX hint (no Upgrade Now button)
            const ideHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'ide',
                version: '1.17.5',
                zoomLevel: 90,
                updateStatus: {
                    status: 'update_available',
                    updateAvailable: true,
                    currentVersion: '1.17.5',
                    latestVersion: '1.17.6',
                },
            });
            expect(ideHtml).toMatch(/<details[^>]*id="settings-ide-status-bar"[^>]*\bopen\b/);
            expect(ideHtml).not.toContain('id="settingsUpgradeNowBtn"');
            expect(ideHtml).toContain('Open VSX');
            expect(ideHtml).toMatch(/id="zoomRange"[^>]*value="90"/);
        });

        it('normalizes legacy google-ai-ultra settings cleanly and updates subscription fee placeholders dynamically', async () => {
            await setLanguageToState('en', memState);
            // Ultra 5x placeholder ($99.99)
            const ultra5xHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: {
                    subscriptionPlan: 'google-ai-ultra-5x',
                    subscriptionMonthlyFee: 99.99,
                    subscriptionCurrency: 'USD',
                },
            });
            expect(ultra5xHtml).toContain('<option value="google-ai-ultra-5x" selected>Google AI Ultra 5x ($99.99/mo)</option>');
            expect(ultra5xHtml).toMatch(/id="subscriptionFeeInput"[^>]*placeholder="99\.99"/);

            // Legacy 'google-ai-ultra' with saved historical $249.99 fee maps to Ultra 20x while preserving input value non-destructively
            const legacy249Html = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: {
                    subscriptionPlan: 'google-ai-ultra' as unknown as 'google-ai-ultra-20x',
                    subscriptionMonthlyFee: 249.99,
                    subscriptionCurrency: 'USD',
                },
            });
            expect(legacy249Html).toContain('<option value="google-ai-ultra-20x" selected>');
            expect(legacy249Html).toMatch(/id="subscriptionFeeInput"[^>]*value="249\.99"/);
            expect(legacy249Html).toMatch(/id="subscriptionFeeInput"[^>]*placeholder="199\.99"/);

            // Legacy 'google-ai-ultra' with $99.99 fee maps to Ultra 5x
            const legacy99Html = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: {
                    subscriptionPlan: 'google-ai-ultra' as unknown as 'google-ai-ultra-5x',
                    subscriptionMonthlyFee: 99.99,
                    subscriptionCurrency: 'USD',
                },
            });
            expect(legacy99Html).toContain('<option value="google-ai-ultra-5x" selected>');
            expect(legacy99Html).toMatch(/id="subscriptionFeeInput"[^>]*placeholder="99\.99"/);

            // Client script includes dynamic placeholder sync & live toggle-ON CDP non-disabled fallback
            const script = getScript();
            expect(script).toContain('subscriptionPlanSelect');
            expect(script).toContain('subscriptionFeeInput');
            expect(script).toContain('.placeholder');
            expect(script).toContain('"google-ai-ultra-5x":"99.99"');
            expect(script).toContain('"google-ai-ultra-20x":"199.99"');
            expect(script).toMatch(/[A-Za-z_$][\w$]*\.getAttribute\(['"]data-cdp-state['"]\)\s*===\s*['"]disabled['"]/);
        });
    });


    describe('v1.17.6 About Tab: Version & Updates Strip, AGENTS.md Tip & Community Credits', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders Version & Updates strip, App Upgrade Now vs IDE Open VSX, AGENTS.md tip, and all required community credits in %s', async (lang) => {
            await setLanguageToState(lang, memState);
            const appAbout = buildAboutTabContent('1.17.5', {
                surface: 'app-sidecar',
                updateStatus: {
                    status: 'update_available',
                    updateAvailable: true,
                    latestVersion: '1.17.6',
                    checkedAt: NOW,
                },
            });
            expect(appAbout).toContain('data-navigate-tab="updates"');
            expect(appAbout).not.toContain('data-action="checkForUpdates"');
            const settings = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar', version: '1.17.5',
                updateStatus: { status: 'update_available', latestVersion: '1.17.6', checkedAt: NOW },
            });
            expect(settings.trimStart()).toMatch(/^<section[^>]+id="updatesSettingsCard"/);
            expect(settings).toMatch(/id="settingsUpgradeNowBtn"[^>]+data-action="applyPluginUpdate">/);
            expect(settings).toContain(`datetime="${new Date(NOW).toISOString()}"`);
            expect(settings).toContain('AGENTS.md');
            expect(settings).toContain('v1.17.6');
            expect(settings).toMatch(/<details[^>]+id="settingsGroupDisplay"[^>]*>\s*<summary/);
            for (const status of ['idle', 'up_to_date', 'error'] as const) {
                const inactive = buildSettingsContent([], undefined, undefined, {
                    surface: 'app-sidecar', updateStatus: { status },
                });
                expect(inactive).toMatch(/id="settingsUpgradeNowBtn"[^>]+hidden>/);
            }

            // All 6 required design-inspiration credits
            for (const repo of [
                'dimitr-io/antigravity-desktop-context',
                'elviscjn-cjn/antigravity-context-viewer',
                'yuhuan-dev/antigravity-usage-monitor',
                'Lumidarin/agy-capsule',
                'evenluo/agy-pulse',
                'jule-x/antigravity-context-monitor',
            ]) {
                expect(appAbout, `missing acknowledgment ${repo}`).toContain(repo);
            }

            // Unified Profile terminology (never '个人' on feature card, never '当前账户')
            expect(appAbout).not.toContain('>个人<');
            expect(appAbout).not.toContain('当前账户');
            expect(appAbout).not.toContain('令牌');
            // All 4 platform chips carry valid role="status" for aria-label WCAG compliance
            expect(appAbout.match(/class="about-platform-chip[^"]*" role="status"/g)).toHaveLength(4);

            const ideSettings = buildSettingsContent([], undefined, undefined, {
                surface: 'ide', updateStatus: { status: 'up_to_date', checkedAt: NOW },
            });
            expect(ideSettings).toContain('id="settingsOpenVsxLink"');
            expect(ideSettings).toContain('data-action="openExternalUrl"');
            expect(ideSettings).not.toContain('data-action="applyPluginUpdate"');
        });
    });


    describe('v1.17.6 Document Styles, Client Script Action Wiring & i18n Unification', () => {
        it('injects Calendar + Orchestrator styles cleanly with balanced braces across all CSS modules', () => {
            const docHtml = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                version: '1.17.5',
                data: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
                now: NOW,
            });
            expect(docHtml).toContain('.orch-split-card');
            expect(docHtml).toContain('.cal-hm-grid');
            expect(docHtml).toContain('.cal-kpi-grid');
            expect(docHtml).toContain('.native-hud-bar');

            const editorialCss = getEditorialStyles();
            expect(editorialCss).toMatch(/body\s+\.stg-header\s*\{[^}]*flex-wrap:\s*wrap/);
            expect(editorialCss).toMatch(/body\s+\.stg-status-pill\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/);
            expect(editorialCss).toContain('.stg-form-grid-subscription');
            expect(editorialCss).toContain('.stg-select');
            expect(editorialCss).toMatch(/body\s+\.stg-field\s*\{[^}]*min-width:\s*0/);

            for (const css of [
                getEditorialStyles(),
                getOverviewStyles(),
                getCalendarTabStyles(),
                getOrchestratorAttributionStyles(),
                getAboutTabStyles(),
            ]) {
                expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
                expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/SimSun|Songti|宋体/i);
            }
        });

        it('wires all Calendar, Orchestrator, Settings, About & HUD actions in valid browser JS', async () => {
            const script = getScript();
            expect(() => new Function(script)).not.toThrow();

            const requiredActions = [
                'calendarFilterSource',
                'calendarSetMetric',
                'calendarSetPeriod',
                'calendarSetView',
                'calendarExportCsv',
                'calendarExportJson',
                'calendarSelectDate',
                'calendarJumpDate',
                'calendarClearArm',
                'calendarClearConfirm',
                'calendarClearCancel',
                'setOrchestratorPricingMode',
                'setAppSetting',
                'recheckCdp',
                'setupCdpLauncher',
                'revealCdpLauncher',
                'removeCdpLauncher',
                'checkForUpdates',
                'applyPluginUpdate',
                'toggleNativeHud',
                'openExternalUrl',
            ];
            for (const action of requiredActions) {
                expect(script, `missing script action ${action}`).toContain(action);
            }
            expect(script).not.toContain('一键生成并重启');
            // Live CDP & Update pill/diagnostic/launcher synchronization across syncSettingsControls & acm:snapshot
            expect(script).toContain('data-cdp-state');
            expect(script).toContain('data-launcher-installed');
            expect(script).toContain('updateStatusPill');
            expect(script).toContain('data-about-update-status');
            expect(script).toContain('cdpDiagnosticHint');
            expect(script).toContain('cdpStatusResult');
            expect(script).toContain('cdpLauncherResult');
            expect(script).toContain('cdpRevealLauncherBtn');
            expect(script).toContain('host_missing_flag');
            expect(script).toContain('cdp-copy-btn');
            expect(script).toMatch(/[A-Za-z_$][\w$]*\.snapshot\.data\.cdpStatus/);
            // Verify syncCdpLauncherUi, #cdpRevealLauncherBtn & host_missing_flag live DOM update via minimal VM harness
            const vm = await import('vm');
            const attrs = new Map<string, Map<string, string>>();
            const postedMessages: any[] = [];
            const makeEl = (id: string) => {
                const elAttrs = new Map<string, string>();
                attrs.set(id, elAttrs);
                const children: any[] = [];
                const el: any = {
                    id,
                    className: '',
                    hidden: false,
                    disabled: false,
                    checked: true,
                    textContent: '',
                    style: {},
                    dataset: {},
                    children,
                    classList: {
                        add: () => {},
                        remove: () => {},
                        toggle: () => {},
                        contains: () => false,
                    },
                    setAttribute: (k: string, v: string) => { elAttrs.set(k, String(v)); },
                    getAttribute: (k: string) => elAttrs.get(k) ?? null,
                    removeAttribute: (k: string) => { elAttrs.delete(k); },
                    appendChild: (c: any) => { children.push(c); return c; },
                    querySelector: (sel: string) => sel === 'span' ? el._span ?? null : null,
                    querySelectorAll: () => [],
                    addEventListener: () => {},
                    closest: () => null,
                };
                if (id === 'cdpSetupLauncherBtn') {
                    el._span = { textContent: 'Create Persistent Launcher' };
                }
                if (id === 'cdpRevealLauncherBtn') {
                    el._span = { textContent: 'Reveal in Finder' };
                    elAttrs.set('data-action', 'revealCdpLauncher');
                    el.closest = (sel: string) => sel.includes('revealCdpLauncher') ? el : null;
                }
                return el;
            };
            const domMap = new Map<string, any>([
                ['cdpStatusPill', makeEl('cdpStatusPill')],
                ['cdpDiagnosticHint', makeEl('cdpDiagnosticHint')],
                ['cdpLauncherStatus', makeEl('cdpLauncherStatus')],
                ['cdpLauncherNote', makeEl('cdpLauncherNote')],
                ['cdpSetupLauncherBtn', makeEl('cdpSetupLauncherBtn')],
                ['cdpRevealLauncherBtn', makeEl('cdpRevealLauncherBtn')],
                ['cdpRemoveLauncherBtn', makeEl('cdpRemoveLauncherBtn')],
                ['cdpLauncherFeedback', makeEl('cdpLauncherFeedback')],
                ['appOverlaysFeedback', makeEl('appOverlaysFeedback')],
                ['toggleAppComposerRing', makeEl('toggleAppComposerRing')],
                ['toggleAppTopBar', makeEl('toggleAppTopBar')],
            ]);
            domMap.get('cdpRevealLauncherBtn').hidden = true;
            domMap.get('cdpRemoveLauncherBtn').hidden = true;
            const msgListeners: Array<(ev: { data: any }) => void> = [];
            const bodyClickListeners: Array<(ev: any) => void> = [];
            class FakeElement {}
            Object.setPrototypeOf(domMap.get('cdpRevealLauncherBtn'), FakeElement.prototype);
            const docStub: any = {
                body: {
                    style: {},
                    dataset: {},
                    getAttribute: (k: string) => (k === 'data-lang' ? 'both' : null),
                    setAttribute: () => {},
                    addEventListener: (type: string, fn: any) => { if (type === 'click') { bodyClickListeners.push(fn); } },
                    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
                },
                documentElement: { style: { setProperty: () => {} } },
                getElementById: (id: string) => domMap.get(id) ?? null,
                querySelector: () => null,
                querySelectorAll: () => [],
                createElement: (tag: string) => ({ tagName: tag.toUpperCase(), className: '', textContent: '', setAttribute: () => {}, style: {}, appendChild: () => {} }),
                addEventListener: () => {},
            };
            const winStub: any = {
                addEventListener: (type: string, fn: any) => { if (type === 'message') { msgListeners.push(fn); } },
                removeEventListener: () => {},
                location: { href: 'http://127.0.0.1:49999/' },
                requestAnimationFrame: () => 0,
                setTimeout: () => 0,
                clearTimeout: () => {},
            };
            vm.runInNewContext(script, {
                window: winStub,
                document: docStub,
                Element: FakeElement,
                acquireVsCodeApi: () => ({ getState: () => ({}), setState: () => {}, postMessage: (m: any) => { postedMessages.push(m); } }),
                requestAnimationFrame: () => 0,
                setTimeout: () => 0,
                clearTimeout: () => {},
                navigator: {},
                console,
            });
            // 1. Before launcher is created -> Step 1 / Step 2 guidance & reveal button hidden
            for (const fn of msgListeners) {
                fn({
                    data: {
                        command: 'cdpStatusResult',
                        cdpStatus: {
                            state: 'cdp_unavailable',
                            diagnosticCode: 'host_missing_flag',
                            hostHasDebugFlag: false,
                            composerEnabled: true,
                            topBarEnabled: false,
                            launcherStatus: {
                                installed: false,
                                platform: 'darwin',
                                launcherPath: '/tmp/vm-home/Applications/Antigravity (CDP).app',
                            },
                        },
                    },
                });
            }
            expect(domMap.get('cdpRevealLauncherBtn').hidden).toBe(true);
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('Step 1');
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('步骤 1');
            expect(domMap.get('cdpDiagnosticHint').textContent).not.toContain('一键生成并重启');

            // 2. After setupCdpLauncher succeeds -> reveal button appears live & hint flips to "launcher is ready"
            for (const fn of msgListeners) {
                fn({
                    data: {
                        command: 'cdpLauncherResult',
                        action: 'setupCdpLauncher',
                        ok: true,
                        messageEn: 'Created persistent launcher',
                        messageZh: '已生成持久化启动器',
                        launcherStatus: {
                            installed: true,
                            platform: 'darwin',
                            launcherPath: '/tmp/vm-home/Applications/Antigravity (CDP).app',
                            noteEn: 'Updated note EN',
                            noteZh: '更新说明 ZH',
                        },
                        cdpStatus: {
                            state: 'cdp_unavailable',
                            diagnosticCode: 'host_missing_flag',
                            hostHasDebugFlag: false,
                            composerEnabled: true,
                            topBarEnabled: false,
                            launcherStatus: {
                                installed: true,
                                platform: 'darwin',
                                launcherPath: '/tmp/vm-home/Applications/Antigravity (CDP).app',
                            },
                        },
                    },
                });
            }
            expect(attrs.get('cdpDiagnosticHint')?.get('data-cdp-diagnostic')).toBe('host_missing_flag');
            expect(domMap.get('cdpDiagnosticHint').hidden).toBe(false);
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('--remote-debugging-port=0');
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('Reveal in Finder');
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('持久化启动器已就绪');
            expect(attrs.get('cdpLauncherStatus')?.get('data-launcher-installed')).toBe('true');
            expect(attrs.get('cdpLauncherStatus')?.get('data-launcher-path')).toBe('/tmp/vm-home/Applications/Antigravity (CDP).app');
            expect(domMap.get('cdpSetupLauncherBtn')._span.textContent).toContain('Recreate Launcher');
            expect(domMap.get('cdpRevealLauncherBtn').hidden).toBe(false);
            expect(domMap.get('cdpRevealLauncherBtn')._span.textContent).toContain('Reveal in Finder');
            expect(domMap.get('cdpRemoveLauncherBtn').hidden).toBe(false);
            expect(domMap.get('cdpLauncherFeedback').textContent).toContain('Created persistent launcher');

            // 3. Clicking #cdpRevealLauncherBtn dispatches { command: 'revealCdpLauncher' }
            for (const fn of bodyClickListeners) {
                fn({ target: domMap.get('cdpRevealLauncherBtn') });
            }
            expect(postedMessages).toContainEqual({ command: 'revealCdpLauncher' });

            // 4. Removing launcher (even without cdpStatus in payload) hides reveal button & flips hint back to Step 1 / Step 2
            for (const fn of msgListeners) {
                fn({
                    data: {
                        command: 'cdpLauncherResult',
                        action: 'removeCdpLauncher',
                        ok: true,
                        messageEn: 'Removed launcher',
                        messageZh: '已移除启动器',
                        launcherStatus: {
                            installed: false,
                            platform: 'darwin',
                            launcherPath: '/tmp/vm-home/Applications/Antigravity (CDP).app',
                        },
                    },
                });
            }
            expect(domMap.get('cdpRevealLauncherBtn').hidden).toBe(true);
            expect(domMap.get('cdpRemoveLauncherBtn').hidden).toBe(true);
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('Step 1');
            expect(domMap.get('cdpDiagnosticHint').textContent).toContain('步骤 1');
            // Two-step clear guard: #clearCalendarBtn must NOT directly post clearCalendarHistory
            expect(script).not.toMatch(/[A-Za-z_$][\w$]*\.closest\(['"]#clearCalendarBtn['"]\)\)\s*\{?\s*[A-Za-z_$][\w$]*\.postMessage\(\{\s*command:\s*['"]clearCalendarHistory['"]/);
            // syncSettingsControls syncs polling, quota threshold, customFxRate, and subscriptionMonthlyFee
            expect(script).toMatch(/typeof\s+[A-Za-z_$][\w$]*\.pollingInterval\s*===?\s*['"]number['"]/);
            expect(script).toMatch(/typeof\s+[A-Za-z_$][\w$]*\.quotaNotificationThreshold\s*===?\s*['"]number['"]/);
            expect(script).toMatch(/Object\.prototype\.hasOwnProperty\.call\(\s*[A-Za-z_$][\w$]*\s*,\s*['"]customFxRate['"]\s*\)/);
            expect(script).toMatch(/Object\.prototype\.hasOwnProperty\.call\(\s*[A-Za-z_$][\w$]*\s*,\s*['"]subscriptionMonthlyFee['"]\s*\)/);
            // openExternalUrl always calls e.preventDefault() so <a> links do not double-open
            expect(script).not.toMatch(/if\s*\(\s*[A-Za-z_$][\w$]*\.tagName\s*!==\s*['"]A['"]\s*\)\s*\{?\s*[A-Za-z_$][\w$]*\.preventDefault\(\)/);
            expect(script).toMatch(/[A-Za-z_$][\w$]*\.preventDefault\(\)[;,]\s*[A-Za-z_$][\w$]*\.postMessage\(\{\s*command:\s*['"]openExternalUrl['"]|command:\s*['"]openExternalUrl['"][\s\S]{0,120}/);
        });

        it('enforces unified EN/ZH/Both i18n terminology with zero raw fallback keys or 令牌', async () => {
            expect(t('agent.lockToMain', 'zh')).toBe('锁定主会话');
            expect(t('agent.lockToMain', 'zh')).not.toContain('锁定主智能体');
            expect(t('orchestrator.model', 'zh')).toBe('编排模型');
            expect(t('orchestrator.executor', 'zh')).toBe('执行模型');
            expect(t('nav.profile', 'zh')).toBe('账号');
            expect(t('profile.accountInfo', 'zh')).toBe('账号信息');

            for (const [key, entry] of Object.entries(translations)) {
                expect(entry.en.trim().length, `empty EN for ${key}`).toBeGreaterThan(0);
                expect(entry.zh.trim().length, `empty ZH for ${key}`).toBeGreaterThan(0);
                expect(entry.zh, `forbidden term 令牌 in ${key}`).not.toContain('令牌');
                expect(entry.zh, `ununified 锁定主智能体 in ${key}`).not.toContain('锁定主智能体');
                expect(entry.zh, `ununified 编排器模型 in ${key}`).not.toContain('编排器模型');
                expect(entry.zh, `ununified 执行器模型 in ${key}`).not.toContain('执行器模型');
            }

            await setLanguageToState('zh', memState);
            const zhDoc = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                data: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
                now: NOW,
            });
            for (const label of ['概览', '模型调用', '会话', '用量与费用', '模型与配额']) {
                expect(zhDoc).toContain(`<span class="tab-label">${label}</span>`);
            }
            expect(zhDoc).toContain('id="slot-profile"');
            expect(zhDoc).toContain('账号');
            expect(zhDoc).not.toContain('<span class="tab-label">个人</span>');
            expect(zhDoc).not.toContain('账户');
            expect(zhDoc).not.toContain('锁定主智能体');
        });

        it('keeps compiled out/webview-document.js 100% pure Node (zero vscode import)', () => {
            const repoRoot = path.resolve(__dirname, '..');
            const out = execFileSync(process.execPath, [
                '-e',
                `
                const mod = require('./out/webview-document.js');
                const html = mod.buildMonitorDocumentHtml({
                    surface: 'app-sidecar',
                    version: '1.17.5',
                    zoomLevel: 115,
                    appSettings: { showNativeHudBar: true, displayCurrency: 'CNY', calendarRetentionDays: 400 },
                    updateStatus: { status: 'update_available', updateAvailable: true, latestVersion: '1.17.6' },
                });
                if (!html.includes('id="nativeHudBar"')) throw new Error('missing HUD');
                if (!html.includes('value="115"')) throw new Error('missing zoom SSR');
                if (!html.includes('id="settingsUpgradeNowBtn"')) throw new Error('missing upgrade button');
                console.log('V1176_PURE_OK');
                `,
            ], { cwd: repoRoot, encoding: 'utf8' });
            expect(out.trim()).toBe('V1176_PURE_OK');
        });
    });
});

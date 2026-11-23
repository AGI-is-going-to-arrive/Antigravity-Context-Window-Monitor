import { execFileSync } from 'child_process';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    getLanguage,
    setLanguageToState,
    t,
    translations,
    type Language,
} from '../src/i18n-core';
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
    buildMonitorTabsPayload,
    buildNativeHudHtml,
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
} from '../src/webview-document';
import {
    buildOverviewTabContent,
    evaluateLowQuotaWarning,
    getOverviewStyles,
} from '../src/webview-overview-tab';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { buildAboutTabContent, getAboutTabStyles } from '../src/webview-about-tab';
import { getCalendarTabStyles } from '../src/webview-calendar-tab';
import { getOrchestratorAttributionStyles } from '../src/orchestrator-attribution';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { getScript } from '../src/webview-script';
import { parseContextBreakdown } from '../src/context-breakdown';
import type { CdpStatus } from '../src/app/sidecar-types';

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

        // All 5 accessible inline jargon explainer tooltips + valid role="group" container
        expect(html).toContain('<div class="overview-jargon-row" role="group" aria-label=');
        for (const jargon of ['gm-data', 'ttft', 'dual-cap', 'compaction-vs-physical', 'mapped-base-rate']) {
            expect(html, `missing jargon tip ${jargon}`).toContain(`data-jargon="${jargon}"`);
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
                command: 'open -a "Antigravity" --args --remote-debugging-port=0',
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
        expect(html).toContain('id="settings-cdp-guide"');
        expect(html).toContain('--remote-debugging-port=0');
        expect(html).toContain('app.asar');

        const inactiveHtml = buildSettingsContent([], undefined, undefined, {
            surface: 'app-sidecar',
            appSettings: { appComposerRingEnabled: true },
            cdpStatus: { ...connectedStatus, state: 'cdp_unavailable' },
        });
        expect(inactiveHtml).toContain('data-cdp-state="cdp_unavailable"');
        expect(inactiveHtml).toContain('CDP Inactive');

        const disabledHtml = buildSettingsContent([], undefined, undefined, {
            surface: 'app-sidecar',
        });
        expect(disabledHtml).toContain('data-cdp-state="disabled"');
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
                subscriptionPlan: 'google-ai-ultra',
                subscriptionMonthlyFee: 249.99,
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
        expect(appHtml).toContain('id="displayCurrencySelect"');
        expect(appHtml).toContain('<option value="CNY" selected>');
        expect(appHtml).toContain('<option value="TWD">');
        expect(appHtml).toContain('id="customFxRateInput"');
        expect(appHtml).toContain('value="7.3"');
        expect(appHtml).toContain('id="subscriptionPlanSelect"');
        expect(appHtml).toContain('<option value="google-ai-ultra" selected>');
        expect(appHtml).toContain('id="subscriptionFeeInput"');
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
        expect(appAbout).toContain('id="aboutUpdatesSection"');
        expect(appAbout).toContain('data-action="checkForUpdates"');
        expect(appAbout).toContain('id="aboutUpgradeNowBtn"');
        expect(appAbout).toContain('data-action="applyPluginUpdate"');
        expect(appAbout).toContain('AGENTS.md');
        expect(appAbout).toContain('v1.17.6');

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

        const ideAbout = buildAboutTabContent('1.17.5', {
            surface: 'ide',
            updateStatus: { status: 'up_to_date', checkedAt: NOW },
        });
        expect(ideAbout).toContain('id="aboutOpenVsxLink"');
        expect(ideAbout).toContain('data-action="openExternalUrl"');
        expect(ideAbout).not.toContain('id="aboutUpgradeNowBtn"');
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

    it('wires all Calendar, Orchestrator, Settings, About & HUD actions in valid browser JS', () => {
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
            'checkForUpdates',
            'applyPluginUpdate',
            'toggleNativeHud',
            'openExternalUrl',
        ];
        for (const action of requiredActions) {
            expect(script, `missing script action ${action}`).toContain(action);
        }
        // Two-step clear guard: #clearCalendarBtn must NOT directly post clearCalendarHistory
        expect(script).not.toMatch(/target\.closest\('#clearCalendarBtn'\)\)\s*\{\s*vscode\.postMessage\(\{\s*command:\s*'clearCalendarHistory'/);
        // syncSettingsControls syncs polling, quota threshold, customFxRate, and subscriptionMonthlyFee
        expect(script).toContain("typeof msg.pollingInterval === 'number'");
        expect(script).toContain("typeof msg.quotaNotificationThreshold === 'number'");
        expect(script).toContain("Object.prototype.hasOwnProperty.call(msg, 'customFxRate')");
        expect(script).toContain("Object.prototype.hasOwnProperty.call(msg, 'subscriptionMonthlyFee')");
        // openExternalUrl always calls e.preventDefault() so <a> links do not double-open
        expect(script).not.toContain("if (extUrlEl.tagName !== 'A') { e.preventDefault(); }");
        expect(script).toMatch(/command:\s*'openExternalUrl'[\s\S]{0,120}|e\.preventDefault\(\);\s*vscode\.postMessage\(\{\s*command:\s*'openExternalUrl'/);
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
        expect(zhDoc).toContain('data-tab="profile"');
        expect(zhDoc).toContain('<span class="tab-label">账号</span>');
        expect(zhDoc).not.toContain('<span class="tab-label">个人</span>');
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
            if (!html.includes('id="aboutUpgradeNowBtn"')) throw new Error('missing upgrade button');
            console.log('V1176_PURE_OK');
            `,
        ], { cwd: repoRoot, encoding: 'utf8' });
        expect(out.trim()).toBe('V1176_PURE_OK');
    });
});

import { afterEach, describe, expect, it } from 'vitest';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { getLanguage, setLanguageToState, tBiHtml, type Language } from '../src/i18n';
import {
    formatOverviewCost,
    formatOverviewSavings,
    formatQuotaWindowPercent,
    resolveActiveOrchestratorRoute,
} from '../src/monitor-overview';
import {
    getModelDisplayName,
    getModelSpecs,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../src/models';
import type { ContextUsage } from '../src/tracker';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { buildModelInfoGrid, buildModelsTabContent, buildOrchestratorSettingsCard } from '../src/webview-models-tab';
import { buildOverviewTabContent, getOverviewStyles } from '../src/webview-overview-tab';
import { buildModelQuotaGrid, buildProfileContent } from '../src/webview-profile-tab';

const initialLang = getLanguage();
const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };
const NOW = Date.parse('2026-11-21T15:00:00Z');

function makeConfig(
    model: string,
    overrides: Partial<ModelConfig> = {},
): ModelConfig {
    return {
        model,
        label: overrides.label || getModelDisplayName(model),
        supportsImages: true,
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
        quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-21T19:33:03Z' },
        ...overrides,
    };
}

const SAMPLE_ORCH_DEFAULT: OrchestratorSettings = {
    configuredOrchestratorModel: '',
    configuredExecutorModel: '',
    effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
    effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorLabel: 'Gemini 4 Neon (XHigh)',
    effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
    isCustomOrchestrator: false,
    isCustomExecutor: false,
    mode: 'default',
    roles: {
        orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
        executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
    },
    orchestratorCandidates: ['MODEL_PLACEHOLDER_M535', 'MODEL_PLACEHOLDER_M401'],
    executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
    lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535',
};

const SAMPLE_ORCH_CUSTOM: OrchestratorSettings = {
    ...SAMPLE_ORCH_DEFAULT,
    configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
    configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
    effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
    effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
    isCustomOrchestrator: true,
    isCustomExecutor: true,
    mode: 'custom',
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
                remainingFraction: 0.9936607,
                resetTime: '2026-11-21T19:33:03Z',
                resetAt: Date.parse('2026-11-21T19:33:03Z'),
            },
            weekly: {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 0.9984152,
                resetTime: '2026-11-28T14:33:03Z',
                resetAt: Date.parse('2026-11-28T14:33:03Z'),
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
                remainingFraction: 0.72,
                resetTime: '2026-11-21T19:51:36Z',
                resetAt: Date.parse('2026-11-21T19:51:36Z'),
            },
            weekly: {
                bucketId: '3p-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 1,
                resetTime: '2026-11-28T14:51:36Z',
                resetAt: Date.parse('2026-11-28T14:51:36Z'),
            },
            buckets: [],
        },
    ],
};

function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        cascadeId: 'orch-conv-1',
        title: 'Cross-pool refactor',
        model: 'MODEL_PLACEHOLDER_M401',
        modelDisplayName: 'Claude Opus 5.5 (Medium)',
        contextUsed: 84_000,
        totalOutputTokens: 1_200,
        totalToolCallOutputTokens: 8_000,
        contextLimit: 256_000,
        usagePercent: 32.8125,
        stepCount: 12,
        lastModifiedTime: '2026-11-21T14:59:00Z',
        status: 'IDLE',
        isEstimated: false,
        lastModelUsage: null,
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        checkpointModel: '',
        createdTime: '2026-11-21T14:50:00Z',
        lastUserInputTime: '2026-11-21T14:58:00Z',
        lastUserInputStepIndex: 10,
        repositoryName: '',
        gitOriginUrl: '',
        branchName: '',
        gitRootUri: '',
        orchestratorConfig: {
            planModel: 'MODEL_PLACEHOLDER_M401',
            executionModel: 'MODEL_PLACEHOLDER_M528',
        },
        ...overrides,
    };
}

function makeUserInfo(): UserStatusInfo {
    return {
        name: 'Alice',
        email: 'alice@example.test',
        planName: 'Google AI Ultra',
        teamsTier: '',
        userTierName: 'Google AI Ultra',
        userTierId: 'ultra',
        defaultModelLabel: 'Gemini 4 Neon (XHigh)',
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

function makeCalendarStore(records: DailyStoreState['records']): DailyStore {
    const store = new DailyStore();
    store.restoreSnapshot({ version: 1, records });
    return store;
}

afterEach(async () => {
    await setLanguageToState(initialLang, memState);
});

describe('Models tab: Orchestrator Settings card, API reference price row & Notice badge', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders Orchestrator Settings card in default and custom modes in %s', async lang => {
        await setLanguageToState(lang, memState);
        expect(buildOrchestratorSettingsCard(null)).toBe('');

        const defaultHtml = buildModelsTabContent(null, [
            makeConfig('MODEL_PLACEHOLDER_M535'),
            makeConfig('MODEL_PLACEHOLDER_M528'),
        ], { orchestratorSettings: SAMPLE_ORCH_DEFAULT });
        expect(defaultHtml).toContain('class="card orch-settings-card"');
        expect(defaultHtml).toContain('data-orchestrator-mode="default"');
        expect(defaultHtml).toContain('Gemini 4 Neon');
        expect(defaultHtml).toContain('Gemini 4 Hydrogen');
        expect(defaultHtml).toContain(lang === 'zh' ? '超高' : 'Extra High');
        expect(defaultHtml).toContain('Claude Opus 5.5');
        expect(defaultHtml).toContain('Claude Sonnet 5.5');
        expect(defaultHtml).not.toContain('令牌');

        const customHtml = buildModelsTabContent(null, [
            makeConfig('MODEL_PLACEHOLDER_M401'),
            makeConfig('MODEL_PLACEHOLDER_M528'),
        ], { orchestratorSettings: SAMPLE_ORCH_CUSTOM });
        expect(customHtml).toContain('data-orchestrator-mode="custom"');
        expect(customHtml).toContain('Claude / GPT');
        expect(customHtml).toContain('Gemini');
        expect(customHtml).toContain(lang === 'zh' ? '自定义' : 'Custom');
        expect(customHtml).toContain(lang === 'zh' ? '已指定' : 'Pinned');
        expect(customHtml).not.toContain('令牌');
    });

    it('renders concise API reference prices in USD and honest Unpriced badges for unpriced models', async () => {
        await setLanguageToState('en', memState);
        const neonSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M535')!;
        const orchSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M537')!;
        const workerSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M669')!;
        const imgSpec = getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M21')!;

        const usdHtml = buildModelInfoGrid([neonSpec, orchSpec, workerSpec], 'chat');
        expect(usdHtml).toContain('class="spec-price-row"');
        expect(usdHtml).toContain('$3/M');
        expect(usdHtml).toContain('$15/M');
        expect(usdHtml).toContain('$0.15/M');
        expect(usdHtml).not.toMatch(/[\u00a5\uffe5]/);
        expect(usdHtml.match(/data-price-state="unpriced"/g)).toHaveLength(2);
        expect(usdHtml).toContain('Unpriced');
        expect(usdHtml).not.toContain('$0.00');

        await setLanguageToState('zh', memState);
        const imgHtml = buildModelInfoGrid([imgSpec], 'image');
        expect(imgHtml).toContain('data-price-state="unpriced"');
        expect(imgHtml).toContain('未定价');
    });

    it.each(['en', 'zh', 'both'] as Language[])('renders amber Notice tag for GPT-OSS 120B and dual-window quota bars in %s', async lang => {
        await setLanguageToState(lang, memState);
        const configs = [
            makeConfig('MODEL_PLACEHOLDER_M535'),
            makeConfig('MODEL_PLACEHOLDER_M401'),
            makeConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', { tagTitle: 'Notice' }),
        ];
        const html = buildModelQuotaGrid(configs, { quotaSummary: SAMPLE_QUOTA_SUMMARY });
        expect(html).toContain('tag-notice');
        expect(html).toContain(lang === 'zh' ? '提示' : 'Notice');
        expect(html).toContain('class="quota-dual-row"');
        expect(html).toContain('data-quota-window="5h"');
        expect(html).toContain('data-quota-window="weekly"');
        expect(html).toContain('99.3%');
        expect(html).toContain('99.8%');
        expect(html).toContain('72%');
        expect(html).not.toContain('令牌');

        const profileHtml = buildProfileContent(makeUserInfo(), configs, 15, SAMPLE_QUOTA_SUMMARY);
        expect(profileHtml).toContain('class="quota-dual-row"');
        expect(profileHtml).toContain('tag-notice');
    });
});

describe('Overview tab: active Orchestrator route, Session/Today cost & Dual-window quota', () => {
    it.each(['en', 'zh', 'both'] as Language[])('shows active cross-pool Orchestrator route, USD cost, and 5h + Weekly meters in %s', async lang => {
        await setLanguageToState(lang, memState);
        const route = resolveActiveOrchestratorRoute(makeUsage());
        expect(route).not.toBeNull();
        expect(route!.isCrossPool).toBe(true);
        expect(route!.plannerPool).toBe('premium');
        expect(route!.executorPool).toBe('gemini');

        const html = buildOverviewTabContent(
            makeUsage(),
            [makeConfig('MODEL_PLACEHOLDER_M401'), makeConfig('MODEL_PLACEHOLDER_M528')],
            makeUserInfo(),
            15,
            { state: 'active' },
            NOW,
            {
                orchestratorSettings: SAMPLE_ORCH_CUSTOM,
                quotaSummary: SAMPLE_QUOTA_SUMMARY,
                sessionCostUsd: 0.45,
                todayCostUsd: 1.25,
            },
        );
        expect(html).toContain('class="orch-route-pill"');
        expect(html).toContain('data-cross-pool="true"');
        expect(html).toContain('Claude Opus 5.5 (Medium)');
        expect(html).toContain(lang === 'zh' ? 'Gemini 4 Hydrogen (超高)' : 'Gemini 4 Hydrogen (Extra High');
        expect(html).toContain('$0.45');
        expect(html).toContain('$1.25');
        expect(html).not.toMatch(/[\u00a5\uffe5]/);
        expect(html).toContain('class="quota-dual-row"');
        expect(html).toContain('data-quota-window="5h"');
        expect(html).toContain('data-quota-window="weekly"');
        expect(html).toContain('99.3%');
        expect(html).toContain('99.8%');
        expect(html).toContain(lang === 'zh' ? '规划' : 'Planner');
        expect(html).toContain(lang === 'zh' ? '执行' : 'Executor');
        expect(html).not.toContain('令牌');
        expect(html).not.toMatch(/NaN|Infinity/);
    });

    it('falls back cleanly to 5h-only meters when quotaSummary is absent and formats helper edge cases safely', () => {
        expect(formatQuotaWindowPercent(1)).toBe('100%');
        expect(formatQuotaWindowPercent(0)).toBe('0%');
        expect(formatQuotaWindowPercent(0.9936607)).toBe('99.3%');
        expect(formatQuotaWindowPercent(0.72)).toBe('72%');
        expect(formatQuotaWindowPercent(null)).toBe('—');
        expect(formatOverviewCost(NaN)).toBeNull();
        expect(formatOverviewCost(-1)).toBeNull();
        expect(formatOverviewCost(Number.POSITIVE_INFINITY)).toBeNull();
        expect(formatOverviewCost(1.25)).toBe('$1.25');
        expect(formatOverviewCost(0.0042)).toBe('$0.0042');
        expect(formatOverviewSavings(0.27)).toBe('$0.27');
        expect(formatOverviewSavings(0.000001)).toBe('<$0.0001');
        expect(formatOverviewSavings(0)).toBeNull();
        expect(formatOverviewSavings(Number.POSITIVE_INFINITY)).toBeNull();

        const fallbackHtml = buildOverviewTabContent(
            makeUsage({ orchestratorConfig: undefined }),
            [makeConfig('MODEL_PLACEHOLDER_M535')],
            null,
            0,
            { state: 'active' },
            NOW,
        );
        expect(fallbackHtml).not.toContain('class="orch-route-pill"');
        expect(fallbackHtml).not.toContain('class="quota-dual-row"');
        expect(fallbackHtml).toContain('80%');
    });

    it('guards invalid/out-of-range dual-window fractions, edge rounding, and epoch-0 reset timestamps', async () => {
        await setLanguageToState('en', memState);
        expect(formatQuotaWindowPercent(1)).toBe('100%');
        expect(formatQuotaWindowPercent(0.9999)).toBe('99.9%');
        expect(formatQuotaWindowPercent(0.9996)).toBe('99.9%');
        expect(formatQuotaWindowPercent(0.9984152)).toBe('99.8%');
        expect(formatQuotaWindowPercent(0.993)).toBe('99.3%');
        expect(formatQuotaWindowPercent(0.004)).toBe('<1%');
        expect(formatQuotaWindowPercent(0.0001)).toBe('<1%');
        expect(formatQuotaWindowPercent(0)).toBe('0%');
        expect(formatQuotaWindowPercent(Number.NaN)).toBe('—');
        expect(formatQuotaWindowPercent(-0.1)).toBe('—');
        expect(formatQuotaWindowPercent(1.5)).toBe('—');

        const malformedQuotaSummary: UserQuotaSummary = {
            groups: [
                {
                    groupId: 'gemini-pool',
                    pool: 'gemini',
                    fiveHour: { remainingFraction: Number.NaN, resetTime: '1970-01-01T00:00:00Z' },
                    weekly: { remainingFraction: 1.5, resetTime: 'not-a-date' },
                },
                {
                    groupId: 'premium-pool',
                    pool: 'premium',
                    fiveHour: { remainingFraction: -0.2, resetTime: null },
                    weekly: { remainingFraction: 0.004, resetTime: '2026-11-28T00:00:00Z' },
                },
            ],
        };
        const configs = [
            makeConfig('MODEL_PLACEHOLDER_M535'),
            makeConfig('MODEL_PLACEHOLDER_M402'),
        ];

        const overviewHtml = buildOverviewTabContent(
            makeUsage(),
            configs,
            null,
            0,
            { state: 'active' },
            NOW,
            { quotaSummary: malformedQuotaSummary },
        );
        expect(overviewHtml).not.toMatch(/NaN|width:150%|width:-20%|aria-valuenow="150"/);
        expect(overviewHtml).toContain('overview-meter is-unknown');
        expect(overviewHtml).toContain('&lt;1%');

        const profileHtml = buildProfileContent(makeUserInfo(), configs, 0, malformedQuotaSummary);
        expect(profileHtml).not.toMatch(/NaN|width:150%|width:-20%|aria-valuenow="150"/);
        expect(profileHtml).toContain('quota-bar-wrap is-unknown');
        expect(profileHtml).toContain('Reset time unavailable');
        expect(profileHtml).not.toContain('Reset 0m');
        expect(profileHtml).toContain('&lt;1%');
    });
});

describe('Calendar tab USD costs & About tab v1.17.4 + 512K disclaimer & shared CSS', () => {
    it('formats daily, monthly, and per-model Calendar costs strictly in USD and guards Infinity', async () => {
        await setLanguageToState('en', memState);
        const store = makeCalendarStore({
            '2026-11-21': {
                date: '2026-11-21',
                cycles: [{
                    startTime: '2026-11-21T00:00:00Z',
                    endTime: '2026-11-21T23:59:59Z',
                    totalReasoning: 0,
                    totalToolCalls: 0,
                    totalErrors: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    estSteps: 0,
                    modelNames: [],
                    gmTotalCalls: 5,
                    gmTotalCredits: 0,
                    gmTotalTokens: 100_000,
                    estimatedCost: 1.5,
                    gmModelStats: {
                        'Gemini 4 Neon (XHigh)': {
                            calls: 5,
                            credits: 0,
                            inputTokens: 80_000,
                            outputTokens: 20_000,
                            thinkingTokens: 5_000,
                            avgTTFT: 0.5,
                            cacheHitRate: 0.8,
                            estimatedCost: 1.5,
                        },
                    },
                }],
            },
        });

        const usdHtml = buildCalendarTabContent(store, 2026, 11);
        expect(usdHtml).toContain('$1.50');
        expect(usdHtml).not.toMatch(/[\u00a5\uffe5]/);

        // Guard Infinity against empty/dash cost chips
        const extremeStore = makeCalendarStore({
            '2026-11-22': {
                date: '2026-11-22',
                cycles: [{
                    startTime: '2026-11-22T00:00:00Z',
                    endTime: '2026-11-22T23:59:59Z',
                    totalReasoning: 0,
                    totalToolCalls: 0,
                    totalErrors: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    estSteps: 0,
                    modelNames: [],
                    gmTotalCalls: 2,
                    gmTotalCredits: 0,
                    gmTotalTokens: 1000,
                    estimatedCost: Number.POSITIVE_INFINITY,
                    gmModelStats: {
                        'InfModel': { calls: 1, credits: 0, inputTokens: 500, outputTokens: 500, thinkingTokens: 0, avgTTFT: 0, cacheHitRate: 0, estimatedCost: Number.POSITIVE_INFINITY },
                        'InvalidCostModel': { calls: 1, credits: 0, inputTokens: 500, outputTokens: 500, thinkingTokens: 0, avgTTFT: 0, cacheHitRate: 0, estimatedCost: Number.NaN },
                    },
                }],
            },
        });
        const extremeHtml = buildCalendarTabContent(extremeStore, 2026, 11);
        expect(extremeHtml).not.toContain('cal-chip-cost');
        expect(extremeHtml).not.toContain('Infinity');
        expect(extremeHtml).not.toContain('NaN');
    });

    it.each(['en', 'zh', 'both'] as Language[])('renders About tab v1.17.5, Extra High, and full Gemini 4 512K disclaimer in %s', async lang => {
        await setLanguageToState(lang, memState);
        const html = buildAboutTabContent();
        expect(html).toContain('<span class="about-version-pill">v1.17.5</span>');
        expect(html).toContain('USD');
        expect(html).not.toMatch(/USD\s*\/\s*[A-Z]{3}|[\u00a5\uffe5]/);
        expect(html).toContain('v1.17.5');
        expect(html).toContain('Extra High');
        expect(html).toContain('512K');
        expect(html).toContain('Gemini 4 Neon');
        expect(html).toContain('Carbon');
        expect(html).toContain('Argon');
        expect(html).toContain('Hydrogen');
        expect(html).toContain('Orchestrator Neon/Carbon/Argon');
        expect(html).not.toContain('v1.17.2');
        expect(html).not.toContain('令牌');
        if (lang === 'both') {
            expect(html).toContain(tBiHtml('Context Window Limitation:', '上下文窗口限制：'));
        }
        // Blank or whitespace version must fall back cleanly (never render bare 'v')
        expect(buildAboutTabContent('')).toContain('<span class="about-version-pill">v1.17.5</span>');
        expect(buildAboutTabContent('   ')).toContain('<span class="about-version-pill">v1.17.5</span>');
        expect(buildAboutTabContent('1.18.0')).toContain('<span class="about-version-pill">v1.18.0</span>');
    });

    it('exports all required v1.17.3 shared CSS classes with balanced braces and zero Songti', () => {
        const editorialCss = getEditorialStyles();
        const overviewCss = getOverviewStyles();
        for (const cls of [
            '.recent-calls-card',
            '.recent-calls-table-wrap',
            '.recent-calls-table',
            '.rate-change-banner',
            '.rate-change-banner-head',
            '.rate-change-banner-list',
            '.orch-settings-card',
            '.orch-role-row',
            '.orch-role-value .spec-short-id',
            '.orch-route-pill',
            '.quota-dual-row',
            '.spec-price-row',
            '.tag-notice',
            '.model-tag-badge:not(.tag-notice)',
            '.cal-overview-val',
            '.cal-day-total-val',
        ]) {
            expect(editorialCss, cls).toContain(cls);
        }
        expect(editorialCss).not.toContain('.currency-toggle-group');
        expect(editorialCss).not.toContain('.currency-btn');
        expect(editorialCss).not.toContain('.fx-rate-input');
        expect(editorialCss).toMatch(/\.rate-change-banner\s*\{[^}]*flex-direction:\s*column/);
        expect((editorialCss.match(/\{/g) || []).length).toBe((editorialCss.match(/\}/g) || []).length);
        expect((overviewCss.match(/\{/g) || []).length).toBe((overviewCss.match(/\}/g) || []).length);
        const cssRulesOnly = editorialCss.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(cssRulesOnly).not.toMatch(/SimSun|Songti|宋体/i);
    });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    getLanguage,
    setLanguageInMemory,
    t,
    translations,
    type Language,
} from '../src/i18n-core';
import * as i18n from '../src/i18n';
import {
    getModelDisplayName,
    getModelSpecs,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../src/models';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import { buildModelsTabContent, buildModelInfoGrid, buildOrchestratorSettingsCard } from '../src/webview-models-tab';
import { buildProfileContent, buildModelQuotaGrid, buildDefaultModelCard } from '../src/webview-profile-tab';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { poolSizeSuffix, selectQuotaRows } from '../src/tooltip-budget';
import type { QuotaRunwayEstimate } from '../src/quota-runway';
import type { CdpStatus } from '../src/app/sidecar-types';

const initialLang = getLanguage();

function makeConfig(model: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
        model,
        label: overrides.label || getModelDisplayName(model),
        supportsImages: true,
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
        quotaInfo: { remainingFraction: 0.72, resetTime: '2026-11-26T18:00:00Z' },
        ...overrides,
    };
}

function makeUserInfo(overrides: Partial<UserStatusInfo> = {}): UserStatusInfo {
    return {
        name: 'Alice',
        email: 'alice@example.test',
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
            monthlyFlexCreditPurchaseAmount: 500,
        },
        teamConfig: {
            allowMcpServers: true,
            allowAutoRunCommands: false,
            allowBrowserExperimentalFeatures: true,
        },
        availableCredits: [
            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 2_500, minimumCreditAmountForUsage: 1 },
        ],
        canBuyMoreCredits: true,
        browserEnabled: true,
        cascadeWebSearchEnabled: true,
        knowledgeBaseEnabled: true,
        canGenerateCommitMessages: true,
        cascadeCanAutoRunCommands: true,
        canAllowCascadeInBackground: false,
        hasAutocompleteFastMode: true,
        allowStickyPremiumModels: true,
        allowPremiumCommandModels: false,
        hasTabToJump: true,
        canCustomizeAppIcon: false,
        userTierDescription: '',
        upgradeSubscriptionText: '',
        modelSortOrder: [],
        ...overrides,
    };
}

const SAMPLE_ORCH: OrchestratorSettings = {
    configuredOrchestratorModel: '',
    configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M537',
    effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
    effectiveOrchestratorLabel: 'Orchestrator (Neon)',
    effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
    isCustomOrchestrator: false,
    isCustomExecutor: true,
    mode: 'custom',
    settingsSource: 'config_fallback',
    useAiCredits: true,
    roles: {
        orchestrators: ['gemini-4-neon', 'claude-opus-5-5'],
        executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
    },
    orchestratorCandidates: ['MODEL_PLACEHOLDER_M537', 'MODEL_PLACEHOLDER_M401'],
    executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
    lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M537',
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
                remainingFraction: 0.68,
                resetTime: '2026-11-26T18:00:00Z',
                resetAt: Date.parse('2026-11-26T18:00:00Z'),
            },
            weekly: {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 0.91,
                resetTime: '2026-12-02T18:00:00Z',
                resetAt: Date.parse('2026-12-02T18:00:00Z'),
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
                remainingFraction: 0.45,
                resetTime: '2026-11-26T18:30:00Z',
                resetAt: Date.parse('2026-11-26T18:30:00Z'),
            },
            weekly: {
                bucketId: '3p-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 0.85,
                resetTime: '2026-12-02T18:30:00Z',
                resetAt: Date.parse('2026-12-02T18:30:00Z'),
            },
            buckets: [],
        },
    ],
};

const SAMPLE_RUNWAYS: Record<string, QuotaRunwayEstimate> = {
    gemini: {
        poolKey: 'gemini',
        status: 'safe_until_reset',
        burnRatePctPerHour: 4.2,
        estExhaustMs: 12 * 60 * 60_000,
        timeToResetMs: 4 * 60 * 60_000,
        recoveredRecently: false,
    },
    premium: {
        poolKey: 'premium',
        status: 'at_risk',
        burnRatePctPerHour: 28.5,
        estExhaustMs: 90 * 60_000,
        timeToResetMs: 240 * 60_000,
        recoveredRecently: false,
    },
};

function assertFrozenPopoverContract(html: string, label: string): void {
    // 1. Every element carrying data-tip-body MUST also carry data-popover-key and MUST NOT carry native title="..."
    const tagRegex = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
    const keys: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(html)) !== null) {
        const attrs = match[2];
        const keyMatch = /\bdata-popover-key="([^"]+)"/.exec(attrs);
        const hasTipBody = /\bdata-tip-body="/.test(attrs);
        const hasNativeTitle = /(?:^|\s)title="/.test(attrs);
        if (hasTipBody) {
            expect(keyMatch, `${label}: element with data-tip-body missing data-popover-key: ${match[0]}`).not.toBeNull();
            expect(hasNativeTitle, `${label}: element with data-tip-body must not emit native title=: ${match[0]}`).toBe(false);
        }
        if (keyMatch) {
            keys.push(keyMatch[1]);
        }
    }
    // 2. All data-popover-key values must be globally unique within the rendered HTML
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const k of keys) {
        if (seen.has(k)) { duplicates.push(k); }
        seen.add(k);
    }
    expect(duplicates, `${label}: duplicate data-popover-key values`).toEqual([]);
    expect(keys.length, `${label}: expected rich-tip triggers`).toBeGreaterThan(0);
    // 3. Never emit forbidden machine-translated 令牌
    expect(html, `${label}: forbidden 令牌`).not.toContain('令牌');
}

beforeEach(() => {
    setLanguageInMemory('both');
});

afterEach(() => {
    setLanguageInMemory(initialLang);
});

describe('Models tab UX, unified naming & rich-tip contract', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders unified limits, rich tips, and zero native title= in %s', (lang) => {
        setLanguageInMemory(lang);
        const configs = [
            makeConfig('MODEL_PLACEHOLDER_M537'),
            makeConfig('MODEL_PLACEHOLDER_M528'),
            makeConfig('MODEL_PLACEHOLDER_M401'),
            makeConfig('MODEL_PLACEHOLDER_M669'),
        ];
        const html = buildModelsTabContent(makeUserInfo(), configs, {
            orchestratorSettings: SAMPLE_ORCH,
            quotaSummary: SAMPLE_QUOTA_SUMMARY,
            quotaRunways: SAMPLE_RUNWAYS,
        });

        assertFrozenPopoverContract(html, `models-${lang}`);
        // Zero remaining native title="..." attributes inside Models tab
        expect(html).not.toMatch(/\stitle="/);

        // Unified 3-limit naming
        if (lang !== 'zh') {
            expect(html).toContain('Effective Budget (Compaction Limit)');
            expect(html).toContain('Checkpoint Threshold');
            expect(html).toContain('Native Ceiling (Model Context)');
        }
        if (lang !== 'en') {
            expect(html).toContain('自动压缩上限（有效预算）');
            expect(html).toContain('检查点阈值');
            expect(html).toContain('原生窗口上限');
        }

        // Orchestrator Settings rich tips: planner/worker, auto default, pinned, local config, AI Credit Overages, mapped base, pool chips
        expect(html).toContain('data-popover-key="models-orch-role-orchestrator"');
        expect(html).toContain('data-popover-key="models-orch-role-executor"');
        expect(html).toContain('data-popover-key="models-orch-status-orchestrator"');
        expect(html).toContain('data-popover-key="models-orch-status-executor"');
        expect(html).toContain('data-popover-key="models-orch-source"');
        expect(html).toContain('~/.gemini/config/config.json');
        expect(html).toContain('data-popover-key="models-orch-ai-credits"');
        expect(html).toContain('data-popover-key="models-orch-shortid-orchestrator"');
        expect(html).toContain('MODEL_PLACEHOLDER_M537');
        expect(html).toContain('data-popover-key="models-orch-planner-pool-gemini"');
        expect(html).toContain('data-popover-key="models-orch-prov-orchestrator"');

        // Quota Runway rich tips (45-minute rolling window)
        expect(html).toContain('data-popover-key="models-runway-heading"');
        expect(html).toContain('data-popover-key="models-runway-gemini"');
        expect(html).toContain('data-popover-key="models-runway-premium"');
        expect(html).toMatch(/45-minute|45 分钟/);

        // Spec cards: provider, short-id, model-id, pricing, thinking, execution route
        expect(html).toContain('data-popover-key="models-spec-provider-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-modelid-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-shortid-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-compaction-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-checkpoint-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-native-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-thinking-chat-0-model_placeholder_m537"');
        expect(html).toContain('data-popover-key="models-spec-pricelabel-chat-0-model_placeholder_m537"');

        // Custom / BYOK isolated summary rich-tip
        const byokHtml = buildModelsTabContent(makeUserInfo(), configs, {
            isCustomModelActive: true,
            quotaSummary: SAMPLE_QUOTA_SUMMARY,
        });
        assertFrozenPopoverContract(byokHtml, `models-byok-${lang}`);
        expect(byokHtml).toContain('data-popover-key="models-byok-pools-summary"');
        expect(byokHtml).toContain('BYOK');
    });

    it('renders Thinking modes (Adaptive, Dynamic, Budget), Custom & Unpriced tips, and replaces raw LS in empty state', () => {
        setLanguageInMemory('both');
        const baseSpec = getModelSpecs()[0];
        const html = buildModelInfoGrid(
            [
                { ...baseSpec, placeholderId: 'MODEL_A', modelId: 'model-a', supportsThinking: true, supportsAdaptiveThinking: true },
                { ...baseSpec, placeholderId: 'MODEL_B', modelId: 'model-b', supportsThinking: true, supportsAdaptiveThinking: false, thinkingBudget: -1 },
                { ...baseSpec, placeholderId: 'MODEL_C', modelId: 'model-c', supportsThinking: true, supportsAdaptiveThinking: false, thinkingBudget: 16_000 },
            ],
            'chat',
            {
                customPricing: { 'model-a': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, thinking: 2 } },
                orchestratorPricingMode: 'strict',
            },
        );
        assertFrozenPopoverContract(html, 'models-thinking-pricing');
        expect(html).toContain('Adaptive Thinking');
        expect(html).toContain('Dynamic Thinking');
        expect(html).toContain('Fixed Thinking Budget');
        expect(html).toContain('Custom Rate');
        expect(html).toContain('Unpriced Model');

        // Also check strict unpriced in Orchestrator Settings card
        const strictOrch = buildOrchestratorSettingsCard(SAMPLE_ORCH, { orchestratorPricingMode: 'strict' });
        assertFrozenPopoverContract(strictOrch, 'orch-strict');
        expect(strictOrch).toContain('data-popover-key="models-orch-price-orchestrator"');
        expect(strictOrch).toContain('Unpriced Model');

        // Default model card has rich tip and no native title=
        const defHtml = buildDefaultModelCard(makeUserInfo());
        assertFrozenPopoverContract(defHtml, 'default-model');
        expect(defHtml).not.toMatch(/\stitle="/);
    });
});

describe('Profile tab UX: Notice tagDescription bug fix, unified 账号 & accessible Feature/Team flags', () => {
    it.each(['en', 'zh', 'both'] as Language[])('surfaces config.tagDescription on Notice badges and eliminates raw LS / 个人 in %s', (lang) => {
        setLanguageInMemory(lang);
        const configs: ModelConfig[] = [
            makeConfig('MODEL_PLACEHOLDER_M535', { tagTitle: 'New', tagDescription: 'Latest flagship reasoning tier' }),
            makeConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', {
                tagTitle: 'Notice',
                tagDescription: 'Scheduled for sunset on 2026-12-31; migrate to Gemini 4.',
            }),
            makeConfig('MODEL_CUSTOM_STANDALONE', {
                label: 'Standalone Experimental',
                tagTitle: 'Notice',
                tagDescription: 'Standalone notice text from catalog',
            }),
        ];
        const html = buildProfileContent(makeUserInfo(), configs, 15, SAMPLE_QUOTA_SUMMARY);

        assertFrozenPopoverContract(html, `profile-${lang}`);
        expect(html).not.toMatch(/\stitle="/);

        // Bug fix: Notice badge surfaces real config.tagDescription via rich-tip (NOT redundant title="Notice")
        expect(html).toContain('Scheduled for sunset on 2026-12-31; migrate to Gemini 4.');
        expect(html).toContain('Latest flagship reasoning tier');
        expect(html).toContain('Standalone notice text from catalog');

        // Unified ZH heading 账号 (never 个人 or 账户)
        if (lang !== 'en') {
            expect(html).toContain('账号');
            expect(html).not.toContain('>个人<');
            expect(html).not.toContain('>账户<');
        }

        // Dual-window, efforts, AI credits, billingDay, Plan Limits (with units), Feature Flags & Team Config
        expect(html).toContain('data-popover-key="profile-quota-win-0-pool-gemini-5h"');
        expect(html).toContain('data-popover-key="profile-quota-win-0-pool-gemini-weekly"');
        expect(html).toContain('data-popover-key="profile-ai-credits-heading"');
        expect(html).toContain('data-popover-key="profile-billing-day-label"');
        expect(html).toContain('data-popover-key="profile-limit-max-input"');
        expect(html).toContain('data-popover-key="profile-limit-local-index"');
        expect(html).toContain('data-popover-key="profile-limit-pinned-context"');
        expect(html).toContain('data-popover-key="profile-limit-flex-credits"');
        const plainText = html.replace(/<[^>]+>/g, '');
        expect(plainText).toContain(lang === 'zh' ? '100,000 条' : '100,000 items');
        expect(plainText).toContain(lang === 'zh' ? '20 项' : '20 items');

        // Accessible Feature Flags & Team Config chips with visible ✓/× status + aria-label + rich-tip
        expect(html).toContain('data-popover-key="profile-flag-sticky-premium"');
        expect(html).toContain('data-popover-key="profile-flag-command-models"');
        expect(html).toContain('data-popover-key="profile-flag-tab-jump"');
        expect(html).toContain('data-popover-key="profile-flag-background"');
        expect(html).toContain('data-popover-key="profile-flag-auto-run"');
        expect(html).toContain('data-popover-key="profile-team-mcp-servers"');
        expect(html).toContain('data-popover-key="profile-team-browser-experimental"');
        expect(html).toContain('class="feature-tag-state"');
        expect(html).toContain('✓');
        expect(html).toContain('×');
        expect(html).toContain('data-flag-state="enabled"');
        expect(html).toContain('data-flag-state="disabled"');

        // Empty state: unified 账号 + local service (no raw LS)
        const emptyHtml = buildProfileContent(null, []);
        expect(emptyHtml).not.toContain('LS');
        expect(emptyHtml).not.toContain('>个人<');
        expect(emptyHtml).toContain(lang === 'en' ? 'local service' : '本地服务');
    });

    it('adds rich-tip for Reported values differ and falls back gracefully when tagDescription is missing', () => {
        setLanguageInMemory('en');
        const html = buildModelQuotaGrid([
            makeConfig('MODEL_PLACEHOLDER_M534', { quotaInfo: { remainingFraction: 0.4, resetTime: '2026-11-26T18:00:00Z' } }),
            makeConfig('MODEL_PLACEHOLDER_M535', { tagTitle: 'Notice', quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-26T18:00:00Z' } }),
        ]);
        assertFrozenPopoverContract(html, 'profile-diff-fallback');
        expect(html).toContain('Why Reported Values Differ');
        expect(html).toContain('Official notice from the model catalog');
    });
});

describe('Calendar tab UX: all broken tooltips migrated, Credits chip fixed & metric explanations', () => {
    function makeRichCalendarStore(): DailyStore {
        const store = new DailyStore();
        const records: DailyStoreState['records'] = {
            '2026-10-15': {
                date: '2026-10-15',
                cycles: [{
                    startTime: '2026-10-15T08:00:00Z',
                    endTime: '2026-10-15T12:00:00Z',
                    totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                    totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                    modelNames: ['Gemini 4 Neon (High)'],
                    gmTotalCalls: 2, gmTotalCredits: 1, gmTotalTokens: 5_000, gmTotalAllTokens: 15_000,
                    estimatedCost: 0.05, surface: 'ide',
                    gmModelStats: {
                        'Gemini 4 Neon (High)': {
                            calls: 2, credits: 1, inputTokens: 3_000, outputTokens: 2_000, thinkingTokens: 500,
                            cacheReadTokens: 10_000, cacheCreationTokens: 0, avgTTFT: 0.5, avgGenTokPerSec: 90,
                            cacheHitRate: 1, tokenCacheHitRate: 10_000 / 13_000, estimatedCost: 0.05,
                        },
                    },
                }],
            },
            '2026-11-20': {
                date: '2026-11-20',
                cycles: [{
                    startTime: '2026-11-20T09:00:00Z',
                    endTime: '2026-11-20T18:00:00Z',
                    totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                    totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                    modelNames: ['Claude Opus 5.5 (High)'],
                    gmTotalCalls: 25, gmTotalCredits: 14, gmTotalTokens: 100_000, gmTotalAllTokens: 450_000,
                    estimatedCost: 3.5, surface: 'app', triggeredBy: ['Claude / GPT'],
                    gmModelStats: {
                        'Claude Opus 5.5 (High)': {
                            calls: 25, credits: 14, inputTokens: 50_000, outputTokens: 50_000, thinkingTokens: 18_000,
                            cacheReadTokens: 320_000, cacheCreationTokens: 30_000, avgTTFT: 0.8, avgGenTokPerSec: 75,
                            cacheHitRate: 1, tokenCacheHitRate: 320_000 / 400_000, estimatedCost: 3.5,
                        },
                    },
                }],
            },
        };
        store.restoreSnapshot({ version: 1, records });
        return store;
    }

    it.each(['en', 'zh', 'both'] as Language[])('migrates heatmap, month grid, day detail chips, and removes all title= & [data-tooltip] in %s', (lang) => {
        const store = makeRichCalendarStore();
        const now = new Date(2026, 10, 20, 14, 0, 0);
        const dailyHtml = buildCalendarTabContent(store, 2026, 11, {
            selectedDate: '2026-11-20',
            subscription: { planId: 'google-ai-pro' },
            now,
            language: lang,
        });

        assertFrozenPopoverContract(dailyHtml, `cal-daily-${lang}`);
        // Zero native title= and ZERO broken [data-tooltip] anywhere in Calendar
        expect(dailyHtml).not.toMatch(/\stitle="/);
        expect(dailyHtml).not.toContain('data-tooltip=');

        // Heatmap active AND empty cells carry rich-tip keys
        expect(dailyHtml).toContain('data-popover-key="cal-hm-2026-11-20"');
        expect(dailyHtml).toContain('data-popover-key="cal-hm-2026-11-19"');
        expect(dailyHtml).toContain('data-popover-key="cal-hm-legend"');

        // Month Grid cell & dot legend
        expect(dailyHtml).toContain('data-popover-key="cal-grid-2026-11-20"');
        expect(dailyHtml).toContain('data-popover-key="cal-month-dot-legend"');
        expect(dailyHtml).toMatch(/calls &gt; 20|调用 &gt; 20/);

        // Export buttons migrated to rich-tip
        expect(dailyHtml).toContain('data-popover-key="cal-export-csv"');
        expect(dailyHtml).toContain('data-popover-key="cal-export-json"');

        // Credits chip bug fix: visible credits label + aria-label + rich-tip
        expect(dailyHtml).toContain('cal-chip-credits');
        expect(dailyHtml).toContain('data-popover-key="cal-gm-credits-2026-11-20-0"');
        expect(dailyHtml.replace(/<[^>]+>/g, '')).toContain(lang === 'zh' ? '14 积分' : '14 credits');

        // All other Day Detail GM chips & Cycle History & Reset trigger & Range Footer & ROI
        for (const key of [
            'cal-gm-summary-label-2026-11-20',
            'cal-gm-speed-2026-11-20-0',
            'cal-gm-ttft-2026-11-20-0',
            'cal-gm-cache-2026-11-20-0',
            'cal-gm-tokens-2026-11-20-0',
            'cal-gm-model-2026-11-20-0',
            'cal-day-tokbreakdown-2026-11-20',
            'cal-cycles-summary-2026-11-20',
            'cal-cycle-reset-2026-11-20-0',
            'cal-range-cal-avg',
            'cal-range-active-avg',
            'cal-range-roi',
            'cal-src-cli',
        ]) {
            expect(dailyHtml, `missing calendar key ${key}`).toContain(`data-popover-key="${key}"`);
        }

        // All-Time strip (including narrow <10% 2026-10 block!) and Weekly/Monthly/Year bar charts
        const allTimeHtml = buildCalendarTabContent(store, 2026, 11, { periodMode: 'all', now, language: lang });
        assertFrozenPopoverContract(allTimeHtml, `cal-all-${lang}`);
        expect(allTimeHtml).not.toMatch(/\stitle="/);
        expect(allTimeHtml).toContain('data-popover-key="cal-cum-2026-10"');
        expect(allTimeHtml).toContain('data-popover-key="cal-cum-2026-11"');

        const weeklyHtml = buildCalendarTabContent(store, 2026, 11, { periodMode: 'weekly', now, language: lang });
        assertFrozenPopoverContract(weeklyHtml, `cal-weekly-${lang}`);
        expect(weeklyHtml).not.toMatch(/\stitle="/);
        expect(weeklyHtml).toContain('data-popover-key="cal-bar-weekly-');
    });
});

describe('Settings & About tabs UX: error pills fixed, plain CDP/Dock copy, no M537 codes, CLI reconciled', () => {
    it.each(['en', 'zh', 'both'] as Language[])('fixes #updateStatusPill & #cdpStatusPill error readability, removes M537 codes, and adds control explanations in %s', (lang) => {
        setLanguageInMemory(lang);
        const cdpErr: CdpStatus = {
            state: 'error',
            diagnosticCode: 'ws_error',
            errorMessage: 'WebSocket handshake refused on 127.0.0.1:9222',
            composerEnabled: true,
            topBarEnabled: false,
            launcherStatus: {
                supported: true,
                platform: 'darwin',
                installed: true,
                launcherPath: '/Applications/Antigravity (CDP).app',
                displayName: 'Antigravity (CDP)',
                targetAppFound: true,
                safeTerminalCommand: 'open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
            },
        };
        const html = buildSettingsContent([], undefined, undefined, {
            surface: 'app-sidecar',
            appSettings: { appComposerRingEnabled: true },
            cdpStatus: cdpErr,
            updateStatus: {
                status: 'error',
                error: 'GitHub API rate limit exceeded (HTTP 403)',
            },
        });

        assertFrozenPopoverContract(html, `settings-${lang}`);
        expect(html).not.toMatch(/\stitle="/);

        // Bug fix: error details visible in rich-tip attributes on #updateStatusPill and #cdpStatusPill
        expect(html).toContain('data-popover-key="settings-update-status-pill"');
        expect(html).toContain('GitHub API rate limit exceeded (HTTP 403)');
        expect(html).toContain('data-popover-key="settings-cdp-status-pill"');
        expect(html).toContain('WebSocket handshake refused on 127.0.0.1:9222');

        // Zero raw M537/M667/M681/M669 internal codes in Orchestrator pricing mode
        expect(html).not.toMatch(/M537|M667|M681|M669/);

        // Module A Dock guidance (macOS, Windows, Linux) present cleanly
        expect(html).toContain('/Applications/Antigravity (CDP).app');
        expect(html).toMatch(/Keep in Dock|在程序坞中保留/);
        expect(html).toMatch(/Pin to Taskbar|固定到任务栏/);
        expect(html).toContain('Ubuntu Dock');

        // All required settings control rich-tips
        for (const key of [
            'settings-tip-native-hud',
            'settings-tip-composer-ring',
            'settings-tip-topbar-overlay',
            'settings-tip-orch-mapped',
            'settings-tip-orch-strict',
            'settings-tip-custom-fx',
            'settings-tip-subscription-roi',
            'settings-tip-calendar-retention',
            'settings-tip-max-recent-steps',
            'settings-tip-max-archives',
            'settings-tip-polling-interval',
            'settings-tip-cache-hit',
            'settings-tip-hover-density',
            'settings-tip-lock-main-agent',
            'settings-tip-model-internal-id',
            'settings-tip-panel-tips',
        ]) {
            expect(html, `missing settings key ${key}`).toContain(`data-popover-key="${key}"`);
        }

        // Panel Tips clarifies top tab-bar horizontal scroll hint
        expect(html).toMatch(/tab-bar horizontal scroll hint|顶部标签导航栏的横向滚动提示/);
    });

    it.each(['en', 'zh', 'both'] as Language[])('fixes About error pill, reconciles CLI note, unifies Sidecar ZH & softens jargon in %s', (lang) => {
        setLanguageInMemory(lang);
        const html = buildAboutTabContent('1.17.10', {
            surface: 'app-sidecar',
            updateStatus: { status: 'error', error: 'TLS certificate expired' },
        });

        assertFrozenPopoverContract(html, `about-${lang}`);
        expect(html).not.toMatch(/\stitle="/);

        // Bug fix: error pill exposes error detail via rich-tip
        expect(html).toContain('data-about-update-status="error"');
        expect(html).toContain('data-popover-key="about-update-status-pill"');
        expect(html).toContain('TLS certificate expired');

        // CLI contradiction reconciled: clarifies runtime plugin unsupported while Calendar reads local CLI logs
        expect(html).toContain('data-popover-key="about-platform-cli"');
        expect(html).toMatch(/local CLI usage logs|本地 CLI 用量日志/);

        // Sidecar ZH unified & jargon softened
        if (lang !== 'en') {
            expect(html).toContain('侧边插件 (Sidecar)');
            expect(html).toContain('模型调用遥测');
            expect(html).toContain('本地会话记录');
            expect(html).toContain('对话存档');
            expect(html).not.toContain('编排器设置');
        }
        if (lang !== 'zh') {
            expect(html).toContain('runtime call telemetry (Generator Metadata)');
            expect(html).toContain('local session records (Brain)');
            expect(html).toContain('conversation archives (.pb / Protobuf)');
        }
    });
});

describe('tooltip-budget & i18n-core backward compatibility and unification', () => {
    it('unifies drifted ZH labels in i18n-core while preserving all existing exports from i18n.ts', () => {
        expect(t('orchestrator.settings', 'zh')).toBe('编排设置');
        expect(t('nav.profile', 'zh')).toBe('账号');
        expect(t('telemetry.cacheState.warm', 'zh')).toBe('热缓存');
        expect(t('telemetry.cacheState.warmCached', 'zh')).toBe('热缓存（命中）');
        expect(t('agent.subagents', 'zh')).toBe('子智能体');
        expect(t('context.effectiveBudget', 'zh')).toContain('自动压缩上限');
        expect(t('overview.compactionLimit', 'zh')).toBe('自动压缩上限');
        expect(t('context.nativeCeiling', 'zh')).toBe('原生窗口上限');
        expect(t('service.localService', 'zh')).toBe('本地服务');
        expect(i18n.translations).toBe(translations);
        expect(typeof i18n.t).toBe('function');
        expect(typeof i18n.tBi).toBe('function');
        expect(typeof i18n.tBiHtml).toBe('function');
    });

    it('formats collapsed quota pool rows with models / 个模型 units cleanly', () => {
        expect(poolSizeSuffix(1, 'en')).toBe('');
        expect(poolSizeSuffix(5, 'en')).toBe(' · 5 models');
        expect(poolSizeSuffix(5, 'zh')).toBe(' · 5 个模型');
        const res = selectQuotaRows([
            { model: 'MODEL_PLACEHOLDER_M438', label: 'Gemini 4 Carbon (Low)', quotaInfo: { remainingFraction: 0.5 } },
            { model: 'MODEL_PLACEHOLDER_M427', label: 'Gemini 4 Carbon (High)', quotaInfo: { remainingFraction: 0.5 } },
        ], '', 3, 'zh');
        expect(res.rows[0].label).toBe('Gemini 4 Carbon (High) · 2 个模型');
    });

    it('keeps all data-popover-key values globally unique when rendering all 5 owned tabs together', () => {
        setLanguageInMemory('both');
        const configs = [
            makeConfig('MODEL_PLACEHOLDER_M535', { tagTitle: 'New', tagDescription: 'Flagship' }),
            makeConfig('MODEL_PLACEHOLDER_M401'),
        ];
        const store = new DailyStore();
        store.restoreSnapshot({
            version: 1,
            records: {
                '2026-11-20': {
                    date: '2026-11-20',
                    cycles: [{
                        startTime: '2026-11-20T09:00:00Z', endTime: '2026-11-20T18:00:00Z',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['Gemini 4 Neon (High)'], gmTotalCalls: 3, gmTotalCredits: 2,
                        gmTotalTokens: 20_000, gmTotalAllTokens: 80_000, estimatedCost: 0.4, surface: 'app',
                        gmModelStats: {
                            'Gemini 4 Neon (High)': {
                                calls: 3, credits: 2, inputTokens: 15_000, outputTokens: 5_000, thinkingTokens: 1_000,
                                cacheReadTokens: 60_000, cacheCreationTokens: 0, avgTTFT: 0.4, avgGenTokPerSec: 85,
                                cacheHitRate: 1, tokenCacheHitRate: 0.8, estimatedCost: 0.4,
                            },
                        },
                    }],
                },
            },
        });
        const combined = [
            buildModelsTabContent(makeUserInfo(), configs, {
                orchestratorSettings: SAMPLE_ORCH,
                quotaSummary: SAMPLE_QUOTA_SUMMARY,
                quotaRunways: SAMPLE_RUNWAYS,
            }),
            buildProfileContent(makeUserInfo(), configs, 15, SAMPLE_QUOTA_SUMMARY),
            buildCalendarTabContent(store, 2026, 11, { selectedDate: '2026-11-20', now: new Date(2026, 10, 20, 12, 0), language: 'both' }),
            buildSettingsContent(configs, undefined, undefined, { surface: 'app-sidecar', updateStatus: { status: 'error', error: 'Timeout' } }),
            buildAboutTabContent('1.17.10', { surface: 'app-sidecar', updateStatus: { status: 'error', error: 'Timeout' } }),
        ].join('\n');

        assertFrozenPopoverContract(combined, 'all-5-tabs-combined');
    });
});

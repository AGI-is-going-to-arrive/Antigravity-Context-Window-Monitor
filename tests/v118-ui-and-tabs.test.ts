// Consolidated Domain Suite: v1.18.0 5-Tab IA, Plan C Tabs & Swarm UI Shell
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { buildAccountStatusPanel, buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { buildCalendarExportData, buildCalendarTabContent, getCalendarTabStyles } from '../src/webview-calendar-tab';
import { buildPricingTabContent, getPricingTabStyles } from '../src/pricing-panel';
import { buildModelsTabContent, isZeroDayUnknownModel } from '../src/webview-models-tab';
import { buildModelQuotaGrid, buildProfileContent } from '../src/webview-profile-tab';
import { buildSettingsContent, normalizeMonitorDocumentSettings } from '../src/webview-settings-tab';
import { buildAboutTabContent, getAboutTabStyles } from '../src/webview-about-tab';
import { buildSummaryFromConversations } from '../src/gm/summary';
import type { GMCallEntry } from '../src/gm/types';
import { evaluatePromptCacheTtl, type PromptCacheTtlEvaluation } from '../src/telemetry-metrics';
import { DailyStore } from '../src/daily-store';
import { PricingStore } from '../src/pricing-store';
import { resolveRuntimeVersion } from '../src/core/version';
import { buildPublishedMonitorObservation } from '../src/core/context-display';
import { CURRENCY_CODES } from '../src/core/currency';
import type { SwarmGroupCostSummary, SwarmTopologySnapshot } from '../src/core/swarm-registry';
import type { WeeklyQuotaRunwayEstimate } from '../src/quota-runway';
import type { ModelConfig, UserQuotaSummary, UserStatusInfo } from '../src/models';
import { type Language, setLanguageToState } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';
import * as vm from 'vm';
import {
    ALL_TAB_ALIASES,
    buildMonitorDocumentHtml,
    buildMonitorTabsPayload,
    CANONICAL_MAIN_TABS,
    resolveTabAlias,
} from '../src/webview-document';
import {
    buildOverviewTabContent,
    buildSwarmLiveStripHtml,
    type CompactionRecoveryBriefData,
    type HandoffV2PreviewData,
    type SwarmOverviewDisplayData,
} from '../src/webview-overview-tab';
import { buildChatHistoryTabContent } from '../src/webview-chat-history-tab';
import { getScript } from '../src/webview-script';
import { getStyles } from '../src/webview-styles';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { getLanguage } from '../src/i18n-core';
import type { ContextUsage, TrajectorySummary } from '../src/tracker';
import type { GMSummary } from '../src/gm-tracker';

describe('[v118-tabs-plan-c]', () => {
    const langState: StateBucket = {
        get: <T>(_key: string, fallback: T) => fallback,
        update: async () => {},
    };


    const FORBIDDEN_GLOSSARY_RE = /账户|成本|冷缓存|首次响应|生成器调用|模型上限|暂停刷新|令牌|额度/;

    const FORBIDDEN_COMPLIANCE_RE = /100%\s*ToS-safe|100%\s*合规/i;


    function extractAttrValues(html: string, attrName: string): string[] {
        const regex = new RegExp(`${attrName}="([^"]*)"`, 'g');
        const out: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = regex.exec(html)) !== null) {
            out.push(match[1]);
        }
        return out;
    }


    function assertFrozenPopoverContract(html: string, label: string): void {
        const keys = extractAttrValues(html, 'data-popover-key');
        const unique = new Set(keys);
        expect(unique.size, `${label}: duplicate data-popover-key detected`).toBe(keys.length);
        expect(html, `${label}: native title= found alongside data-tip-body`).not.toMatch(/data-tip-body="[^"]*"[^>]*\s+title="/);
        expect(html, `${label}: native title= found before data-tip-body`).not.toMatch(/\s+title="[^"]*"[^>]*data-tip-body="/);
    }


    function makeGmCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-1',
            model: 'MODEL_PLACEHOLDER_M535',
            modelDisplay: 'Gemini 4 Neon',
            responseModel: 'gemini-4-neon',
            modelAccuracy: 'exact',
            inputTokens: 10_000,
            outputTokens: 600,
            thinkingTokens: 200,
            responseTokens: 400,
            cacheReadTokens: 80_000,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            ttftSeconds: 1.5,
            streamingSeconds: 6.0,
            credits: 0,
            creditType: '',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 90_000,
            completionConfig: null,
            systemPromptSnippet: '',
            toolCount: 2,
            toolNames: ['run_command', 'read_file'],
            promptSectionTitles: [],
            promptSnippet: '',
            promptSource: 'none',
            messagePromptCount: 0,
            messageMetadataKeys: [],
            responseHeaderKeys: [],
            userMessageAnchors: [],
            aiSnippetsByStep: {},
            retries: 0,
            stopReason: 'STOP_REASON_STOP_PATTERN',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: '2026-11-27T10:00:00.000Z',
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


    function makeModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
        return {
            label: 'Gemini 4 Neon (High)',
            model: 'MODEL_PLACEHOLDER_M535',
            quotaInfo: {
                remainingFraction: 0.72,
                resetTime: '2026-11-27T15:00:00.000Z',
            },
            supportsImages: true,
            supportsThinking: true,
            recommended: true,
            isPremium: true,
            ...overrides,
        };
    }


    function makeUserInfo(overrides: Partial<UserStatusInfo> = {}): UserStatusInfo {
        return {
            name: 'Alice Secret',
            email: 'alice.secret@example.com',
            planName: 'Google AI Ultra',
            userTierName: 'Ultra 20x',
            userTierDescription: 'Ultra tier',
            modelSortOrder: [],
            defaultModelLabel: 'Gemini 4 Neon (High)',
            credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 2400, minimumCreditAmountForUsage: 1 }],
            planLimits: {
                maxNumChatInputTokens: 1_000_000,
                maxNumPremiumChatMessages: -1,
                maxCustomChatInstructionCharacters: 32_000,
                maxNumPinnedContextItems: 20,
                maxLocalIndexSize: 100_000,
                monthlyFlexCreditPurchaseAmount: 0,
            },
            ...overrides,
        };
    }


    afterEach(async () => {
        await setLanguageToState('both', langState);
    });


    describe('Phase 3 Wave 3B Plan C — Model Calls Tab (activity-panel.ts)', () => {
        it.each(['en', 'zh', 'both'] as Language[])(
            'renders GM Anomaly Filter Bar, 5m Idle TTL vs provider reuse, possible causes, Decode vs E2E speed, and strictly measured TTFT+Streaming bars in %s',
            async (lang) => {
                await setLanguageToState(lang, langState);

                const normalCall = makeGmCall({
                    executionId: 'call-normal',
                    createdAt: '2026-11-27T10:00:00.000Z',
                    ttftSeconds: 1.0,
                    streamingSeconds: 5.0,
                    outputTokens: 500,
                    cacheReadTokens: 80_000,
                    inputTokens: 10_000,
                });
                const slowErrorCall = makeGmCall({
                    executionId: 'call-slow-err',
                    stepIndices: [2],
                    createdAt: '2026-11-27T10:04:00.000Z',
                    ttftSeconds: 8.5,
                    streamingSeconds: 4.0,
                    outputTokens: 400,
                    inputTokens: 210_000,
                    cacheReadTokens: 0,
                    contextTokensUsed: 460_000,
                    hasError: true,
                    errorMessage: 'HTTP 429 RESOURCE_EXHAUSTED',
                    retries: 2,
                    stopReason: 'STOP_REASON_MAX_TOKENS',
                });

                const gm = buildSummaryFromConversations([{
                    cascadeId: 'conv-plan-c',
                    title: 'Plan C Telemetry',
                    totalSteps: 4,
                    calls: [normalCall, slowErrorCall],
                }]);

                const coolingTtl: PromptCacheTtlEvaluation = evaluatePromptCacheTtl({
                    key: { account: 'a1', backend: 'local', conversation: 'conv-plan-c', model: 'gemini-4-neon', branch: 'main' },
                    lastEventMs: Date.parse('2026-11-27T10:00:00.000Z'),
                    nowMs: Date.parse('2026-11-27T10:03:30.000Z'), // 210s -> cooling (>=180s)
                    measured: {
                        inputTokens: 50_000,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        cacheTelemetryAvailable: true,
                    },
                    transition: {
                        previousModel: 'claude-opus-5-5',
                        currentModel: 'gemini-4-neon',
                        modelSwitchConfirmed: false,
                        compactionSuspected: true,
                        hadPriorWarmCache: true,
                    },
                });

                const html = buildGMDataTabContent(null, gm, null, undefined, undefined, undefined, {}, null, {
                    anomalyFilter: 'slow_ttft',
                    speedMetricMode: 'e2e',
                    cacheTtl: coolingTtl,
                    currency: 'CAD',
                });

                // 1. GM Anomaly Filter Bar with all 8 pills and SSR row filtering
                expect(html).toContain('data-gm-anomaly-bar="true"');
                for (const kind of ['all', 'any', 'error_or_retry', 'slow_ttft', 'cache_miss', 'high_cost', 'high_context', 'non_200_or_truncated']) {
                    expect(html).toContain(`data-anomaly-kind="${kind}"`);
                }
                expect(html).toMatch(/data-anomaly-kind="slow_ttft"[^>]*aria-pressed="true"/);
                expect(html).toContain('data-gm-anomalies=');
                expect(html).toMatch(/<tr[^>]*hidden[^>]*>/);

                // 2. Prompt Cache 5m Idle TTL heuristic strictly separated from provider-observed reuse %
                expect(html).toContain('data-cache-ttl-state="cooling"');
                expect(html).toContain('data-cache-ttl-source="local_ttl_heuristic"');
                expect(html).toContain('data-cache-source="provider_measured"');
                expect(html).toContain('data-cache-miss-causes="true"');
                expect(html).toContain('data-cause-confidence="possible_cause"');
                expect(html).toContain(lang === 'zh' ? '可能原因' : 'Possible cause');

                // 3. Model-Call Decode vs E2E Speed with coverage and strictly measured TTFT + Streaming bars ONLY
                expect(html).toContain('data-setting-switch="speedMetricMode"');
                expect(html).toContain('data-action="setOverviewSetting"');
                expect(html).toContain('data-setting-key="speedMetricMode"');
                expect(html).toContain('data-setting-value="decode"');
                expect(html).toContain('data-setting-value="e2e"');
                expect(html).toContain('data-speed-coverage="2/2"');
                expect(html).toContain('data-phase-source="measured_only"');
                expect(html).toContain('data-phase-scope="model_call"');
                expect(html).toContain('phase-seg-ttft');
                expect(html).toContain('phase-seg-stream');
                // NEVER synthesize thinking/tool duration bars
                expect(html).not.toMatch(/phase-seg-(?:thinking|tool)/);

                // 4. Active 10-currency (CAD -> CA$) formatting on call cost
                expect(html).toContain('CA$');

                // 5. Frozen popover & glossary invariants
                assertFrozenPopoverContract(html, `Model Calls (${lang})`);
                expect(html).not.toMatch(FORBIDDEN_GLOSSARY_RE);
                expect(html).not.toMatch(FORBIDDEN_COMPLIANCE_RE);
            },
        );

        it('renders cold >=300s TTL, unreported provider cache telemetry, and SEC-04 account masking with zero data-email', async () => {
            await setLanguageToState('both', langState);

            const coldTtl = evaluatePromptCacheTtl({
                key: { account: 'a1', backend: 'local', conversation: 'conv-cold', model: 'gemini-4-neon', branch: 'feat' },
                lastEventMs: Date.parse('2026-11-27T10:00:00.000Z'),
                nowMs: Date.parse('2026-11-27T10:06:00.000Z'), // 360s -> cold
                measured: {
                    inputTokens: 12_000,
                    cacheReadTokens: null,
                    cacheCreationTokens: null,
                    cacheTelemetryAvailable: false,
                },
            });

            const gm = buildSummaryFromConversations([{
                cascadeId: 'conv-cold',
                title: 'Cold TTL',
                totalSteps: 1,
                calls: [makeGmCall({ executionId: 'cold-1', cacheReadTokens: 0 })],
            }]);

            const html = buildGMDataTabContent(null, gm, null, undefined, undefined, undefined, {}, null, {
                cacheTtl: coldTtl,
            });
            expect(html).toContain('data-cache-ttl-state="cold"');
            expect(html).toContain('冷启动');
            expect(html).toContain('缓存计数未上报');
            expect(html).toContain('Cache counts unreported');

            // SEC-04 Account Status Panel masking
            const acctHtml = buildAccountStatusPanel(
                [{
                    email: 'private.user@corp.example',
                    name: 'Private User',
                    planName: 'Ultra',
                    tierName: 'Ultra 20x',
                    isActive: false,
                    lastSeen: '2026-11-27T10:00:00.000Z',
                    accountHandle: 'acct_opaque_handle_99',
                    resetPools: [],
                }],
                {},
                { privacyMasked: true },
            );
            expect(acctHtml).toContain('data-account-handle="acct_opaque_handle_99"');
            expect(acctHtml).not.toContain('data-email=');
            expect(acctHtml).not.toContain('private.user@corp.example');
            assertFrozenPopoverContract(acctHtml, 'Account Status Panel');
        });
    });


    describe('Phase 3 Wave 3B Plan C — Usage & Cost Tab (webview-calendar-tab.ts & pricing-panel.ts)', () => {
        it.each(['en', 'zh', 'both'] as Language[])(
            'renders Workspace Project Leaderboard with Unattributed row, Swarm Group Cost, collapsible Plan ROI Advanced, and unified Markdown/CSV/JSON exports in %s',
            async (lang) => {
                await setLanguageToState(lang, langState);

                const store = new DailyStore();
                store.restoreSnapshot({
                    version: 1,
                    records: {
                        '2026-11-27': {
                            date: '2026-11-27',
                            totalReasoning: 2,
                            totalToolCalls: 0,
                            totalErrors: 0,
                            totalSteps: 6,
                            totalToolReturnTokens: 0,
                            conversations: 2,
                            gmCalls: 6,
                            gmInputTokens: 55_000,
                            gmOutputTokens: 6_000,
                            gmThinkingTokens: 500,
                            gmCacheReadTokens: 25_000,
                            gmCacheCreationTokens: 0,
                            gmCredits: 0,
                            gmEstimatedCost: 0.54,
                            cycles: [
                                {
                                    startTime: '2026-11-27T08:00:00.000Z',
                                    endTime: '2026-11-27T09:00:00.000Z',
                                    accountEmail: 'alice@example.com',
                                    totalReasoning: 1,
                                    totalToolCalls: 0,
                                    totalErrors: 0,
                                    totalSteps: 4,
                                    totalToolReturnTokens: 0,
                                    conversations: 1,
                                    gmCalls: 4,
                                    gmInputTokens: 40_000,
                                    gmOutputTokens: 4_000,
                                    gmThinkingTokens: 500,
                                    gmCacheReadTokens: 20_000,
                                    gmCacheCreationTokens: 0,
                                    gmCredits: 0,
                                    gmEstimatedCost: 0.42,
                                    sources: ['app'],
                                    workspaceBreakdown: {
                                        '/Users/dev/alpha-project': {
                                            calls: 4,
                                            inputTokens: 40_000,
                                            outputTokens: 4_000,
                                            thinkingTokens: 500,
                                            cacheReadTokens: 20_000,
                                            cacheCreationTokens: 0,
                                            credits: 0,
                                            knownCostUsd: 0.42,
                                            unpricedCalls: 1,
                                        },
                                    },
                                },
                                {
                                    startTime: '2026-11-27T09:05:00.000Z',
                                    endTime: '2026-11-27T09:30:00.000Z',
                                    accountEmail: 'alice@example.com',
                                    totalReasoning: 1,
                                    totalToolCalls: 0,
                                    totalErrors: 0,
                                    totalSteps: 2,
                                    totalToolReturnTokens: 0,
                                    conversations: 1,
                                    gmTotalCalls: 2,
                                    gmCalls: 2,
                                    gmInputTokens: 15_000,
                                    gmOutputTokens: 2_000,
                                    gmThinkingTokens: 0,
                                    gmCacheReadTokens: 5_000,
                                    gmCacheCreationTokens: 0,
                                    gmCredits: 0,
                                    estimatedCost: 0.12,
                                    gmEstimatedCost: 0.12,
                                    gmModelStats: {
                                        'Gemini 4 Carbon': {
                                            calls: 2,
                                            inputTokens: 15_000,
                                            outputTokens: 2_000,
                                            thinkingTokens: 0,
                                            cacheRead: 5_000,
                                            cacheCreation: 0,
                                            credits: 0,
                                            estimatedCost: 0.12,
                                        },
                                    },
                                    sources: ['ide'],
                                    // No workspaceBreakdown -> explicit Unattributed row
                                },
                            ],
                        },
                    },
                });

                const swarmGroupCosts: Record<string, SwarmGroupCostSummary> = {
                    'swarm-root-1': {
                        rootId: 'swarm-root-1',
                        directCostByMember: {
                            'swarm-root-1': { cascadeId: 'swarm-root-1', directCostUsd: 0.30, callCount: 3, pricedCallCount: 3, unpricedCallCount: 0, totalTokens: 30_000 },
                            'worker-a': { cascadeId: 'worker-a', directCostUsd: 0.25, callCount: 3, pricedCallCount: 2, unpricedCallCount: 1, totalTokens: 25_000 },
                        },
                        coordinatorDirectCostUsd: 0.30,
                        workersDirectCostUsd: 0.25,
                        inclusiveGroupCostUsd: 0.55,
                        uniqueCallCount: 6,
                        duplicateCallsDeduplicated: 1,
                        pricedCallCount: 5,
                        unpricedCallCount: 1,
                        hasUnpricedCalls: true,
                    },
                };

                const html = buildCalendarTabContent(store, 2026, 11, {
                    currency: 'CAD',
                    subscription: { planId: 'google-ai-pro', monthlyFee: 19.99, currency: 'USD' },
                    swarmGroupCosts,
                    language: lang,
                    now: new Date(2026, 10, 27, 12, 0, 0),
                });

                // 1. Workspace Project Leaderboard + Unattributed row + CAD formatting
                expect(html).toContain('id="calWorkspaceLeaderboard"');
                expect(html).toContain('data-workspace-leaderboard="true"');
                expect(html).toContain('alpha-project');
                expect(html).toContain('data-workspace-unattributed="true"');
                expect(html).toContain(lang === 'zh' ? '未归属' : 'Unattributed');
                expect(html).toContain('data-unpriced-calls="1"');
                expect(html).toContain('CA$');

                // 2. Swarm Group Cost section separating direct vs inclusive unique-call total + unpriced count
                expect(html).toContain('id="calSwarmGroupCost"');
                expect(html).toContain('data-swarm-group-cost="true"');
                expect(html).toContain('data-swarm-group-total="0.55"');
                expect(html).toContain('data-swarm-unpriced-calls="1"');

                // 3. Plan ROI inside collapsible <details> Advanced with explicit reference disclaimer
                expect(html).toContain('<details class="cal-roi-advanced" id="calPlanRoiAdvanced" data-cal-roi-advanced="true"');
                expect(html).toContain('data-cal-roi="true"');
                expect(html).toContain(lang === 'zh' ? 'API 等效参考比，非实际账单' : 'API Equivalent Reference Ratio, Not Actual Bill');

                // 4. Unified Markdown / CSV / JSON export buttons
                expect(html).toContain('data-action="calendarExportMarkdown"');
                expect(html).toContain('data-action="calendarExportCsv"');
                expect(html).toContain('data-action="calendarExportJson"');

                // 5. Privacy masking redacts workspace labels and account emails
                const maskedHtml = buildCalendarTabContent(store, 2026, 11, {
                    swarmGroupCosts,
                    privacyMasked: true,
                    language: lang,
                    now: new Date(2026, 10, 27, 12, 0, 0),
                });
                expect(maskedHtml).not.toContain('alpha-project');
                expect(maskedHtml).not.toContain('alice@example.com');
                expect(maskedHtml).toContain(lang === 'zh' ? '项目 #1' : 'Project #1');

                assertFrozenPopoverContract(html, `Calendar (${lang})`);
                expect(html).not.toMatch(FORBIDDEN_GLOSSARY_RE);
                expect(html).not.toMatch(FORBIDDEN_COMPLIANCE_RE);
            },
        );

        it('abolishes proportional surface scaling on mixed-surface cycles and enforces empty-selection + injection-safe exports', () => {
            const store = new DailyStore();
            store.restoreSnapshot({
                version: 1,
                records: {
                '2026-11-27': {
                    date: '2026-11-27',
                    totalReasoning: 1,
                    totalToolCalls: 0,
                    totalErrors: 0,
                    totalSteps: 2,
                    totalToolReturnTokens: 0,
                    conversations: 1,
                    gmCalls: 10,
                    gmInputTokens: 100_000,
                    gmOutputTokens: 10_000,
                    gmThinkingTokens: 0,
                    gmCacheReadTokens: 0,
                    gmCacheCreationTokens: 0,
                    gmCredits: 0,
                    gmEstimatedCost: 1.0,
                    cycles: [{
                        startTime: '2026-11-27T08:00:00.000Z',
                        endTime: '2026-11-27T09:00:00.000Z',
                        totalReasoning: 1,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalSteps: 2,
                        totalToolReturnTokens: 0,
                        conversations: 1,
                        gmCalls: 10,
                        gmInputTokens: 100_000,
                        gmOutputTokens: 10_000,
                        gmThinkingTokens: 0,
                        gmCacheReadTokens: 0,
                        gmCacheCreationTokens: 0,
                        gmCredits: 0,
                        gmEstimatedCost: 1.0,
                        sources: ['app', 'ide'],
                        surfaceBreakdown: {
                            app: { calls: 4, inputTokens: 40_000, outputTokens: 4_000, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0.40 },
                            ide: { calls: 6, inputTokens: 60_000, outputTokens: 6_000, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0.60 },
                        },
                        gmModelStats: {
                            '=HYPERLINK("http://evil")|model\nline2': {
                                calls: 10,
                                inputTokens: 100_000,
                                outputTokens: 10_000,
                                thinkingTokens: 0,
                                cacheRead: 0,
                                cacheCreation: 0,
                                credits: 0,
                                estimatedCost: 1.0,
                            },
                        },
                    }],
                },
                },
            });

            // Filtered to 'app' on mixed-surface cycle: exact surface totals (4 calls / $0.40), ZERO fabricated scaled per-model stats
            const appExport = buildCalendarExportData(store, 2026, 11, {
                sourceFilter: 'app',
                periodMode: 'all',
                now: new Date(2026, 10, 27, 12, 0, 0),
            });
            expect(appExport.rows).toHaveLength(1);
            expect(appExport.rows[0].calls).toBe(4);
            expect(appExport.rows[0].estimatedCostUsd).toBeCloseTo(0.40, 4);
            expect(Object.keys(appExport.rows[0].models)).toHaveLength(0);

            // Unfiltered export exercises CSV formula guard + multiline quoting + Markdown escaping + JSON structure
            const allExport = buildCalendarExportData(store, 2026, 11, {
                sourceFilter: 'all',
                periodMode: 'all',
                currency: 'CAD',
                now: new Date(2026, 10, 27, 12, 0, 0),
            });
            expect(allExport.csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")|model\nline2:");
            expect(allExport.markdown).toContain('\\|');
            expect(allExport.markdown).not.toContain('\nline2');
            const parsed = JSON.parse(allExport.json);
            expect(parsed.filter.currency).toBe('CAD');
            expect(parsed.days).toHaveLength(1);

            // Empty selection strictly produces empty rows/CSV/Markdown/JSON (never falls back to all history)
            const emptyListExport = buildCalendarExportData(store, 2026, 11, {
                selectedDates: [],
                now: new Date(2026, 10, 27, 12, 0, 0),
            });
            expect(emptyListExport.rows).toHaveLength(0);
            expect(emptyListExport.csv.trim().split('\n')).toHaveLength(1);
            expect(JSON.parse(emptyListExport.json).days).toEqual([]);

            const emptySingleExport = buildCalendarExportData(store, 2026, 11, {
                exportSelectedDateOnly: true,
                selectedDate: '',
                now: new Date(2026, 10, 27, 12, 0, 0),
            });
            expect(emptySingleExport.rows).toHaveLength(0);
        });

        it('pricing-panel.ts formats all 10 currencies incl. CAD (CA$/A$/$) and enforces currency-bound customFxRate', async () => {
            await setLanguageToState('en', langState);
            const pricingStore = new PricingStore();
            const gm = buildSummaryFromConversations([{
                cascadeId: 'conv-price',
                title: 'Pricing CAD',
                totalSteps: 1,
                calls: [makeGmCall({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0 })],
            }]);

            // CAD with matching bound customFxRate
            const cadHtml = buildPricingTabContent(gm, pricingStore, undefined, undefined, undefined, false, {
                currency: 'CAD',
                customFxRate: 1.5,
                customFxCurrency: 'CAD',
            });
            expect(cadHtml).toContain('data-currency="CAD"');
            expect(cadHtml).toContain('data-currency-symbol="CA$"');
            expect(cadHtml).toContain('data-fx-custom="true"');
            expect(cadHtml).toContain('data-fx-rate="1.5"');
            expect(cadHtml).toContain('CA$');

            // AUD with mismatched customFxCurrency ('CAD') MUST ignore stale rate
            const audMismatchHtml = buildPricingTabContent(gm, pricingStore, undefined, undefined, undefined, false, {
                currency: 'AUD',
                customFxRate: 1.5,
                customFxCurrency: 'CAD',
            });
            expect(audMismatchHtml).toContain('data-currency="AUD"');
            expect(audMismatchHtml).toContain('data-currency-symbol="A$"');
            expect(audMismatchHtml).toContain('data-fx-custom="false"');
            expect(audMismatchHtml).toContain('A$');

            // All 10 currencies render cleanly
            expect(CURRENCY_CODES).toContain('CAD');
            expect(CURRENCY_CODES).toHaveLength(10);
            for (const code of CURRENCY_CODES) {
                const h = buildPricingTabContent(gm, pricingStore, undefined, undefined, undefined, false, { currency: code });
                expect(h).toContain(`data-currency="${code}"`);
            }
        });
    });


    describe('Phase 3 Wave 3B Plan C — Models & Quotas Tab (webview-models-tab.ts & webview-profile-tab.ts)', () => {
        it.each(['en', 'zh', 'both'] as Language[])(
            'labels every quota % with active window & direction, renders Weekly Active-Hours Pace Forecast (populated & Insufficient history), Zero-Day Unknown Model badge, and SEC-04 privacy in %s',
            async (lang) => {
                await setLanguageToState(lang, langState);

                const quotaSummary: UserQuotaSummary = {
                    groups: [{
                        pool: 'gemini',
                        displayName: 'Gemini 4',
                        fiveHour: { remainingFraction: 0.80, resetTime: '2026-11-27T15:00:00.000Z', label: '5h', windowKind: '5h' },
                        weekly: { remainingFraction: 0.45, resetTime: '2026-12-03T00:00:00.000Z', label: '7d', windowKind: 'weekly' },
                        buckets: [],
                    }],
                };

                const populatedWeekly: WeeklyQuotaRunwayEstimate = {
                    account: 'acct_1',
                    pool: 'pool-gemini',
                    window: '7d',
                    resetEpoch: Date.parse('2026-12-03T00:00:00.000Z'),
                    status: 'at_risk',
                    burnRatePctPerActiveHour: 4.5,
                    avgActiveHoursPerDay: 5.0,
                    projectedDailyBurnPct: 22.5,
                    estRemainingActiveHours: 10.0,
                    estExhaustMs: 48 * 3600_000,
                    timeToResetMs: 120 * 3600_000,
                    latestRemainingFraction: 0.45,
                    coverage: {
                        activeHours: 12.5,
                        activeHourBuckets: 13,
                        activeDays: 3,
                        observedSpanHours: 60,
                        minActiveHours: 2,
                        minActiveDays: 2,
                        minSpanHours: 24,
                        meetsThreshold: true,
                    },
                    dailySummaries: [],
                    offlineGapCount: 2,
                    fractionalResetCount: 0,
                    epochsConsidered: 1,
                };

                const insufficientWeekly: WeeklyQuotaRunwayEstimate = {
                    ...populatedWeekly,
                    pool: 'pool-claude',
                    status: 'insufficient_history',
                    burnRatePctPerActiveHour: null,
                    projectedDailyBurnPct: null,
                    coverage: {
                        ...populatedWeekly.coverage,
                        activeHours: 0.5,
                        activeDays: 1,
                        observedSpanHours: 4,
                        meetsThreshold: false,
                    },
                };

                const configs: ModelConfig[] = [
                    makeModelConfig({ label: 'Gemini 4 Neon (High)', model: 'MODEL_PLACEHOLDER_M535', quotaInfo: { remainingFraction: 0.80, resetTime: '2026-11-27T15:00:00.000Z' } }),
                    makeModelConfig({ label: 'Gemini 5 Unseen Experimental', model: 'MODEL_PLACEHOLDER_M9999', quotaInfo: { remainingFraction: 0.65, resetTime: '2026-11-27T15:00:00.000Z' } }),
                ];

                expect(isZeroDayUnknownModel('MODEL_PLACEHOLDER_M9999')).toBe(true);
                expect(isZeroDayUnknownModel('MODEL_PLACEHOLDER_M535')).toBe(false);

                const modelsHtml = buildModelsTabContent(makeUserInfo(), configs, {
                    quotaSummary,
                    quotaWindowMode: 'tightest',
                    quotaDirectionMode: 'used',
                    weeklyRunways: [populatedWeekly, insufficientWeekly],
                    zeroDayModelIds: ['MODEL_PLACEHOLDER_M9999'],
                });

                // 1. Quota % labeled with active window & direction (tightest -> 7d 45% remaining = 55% used)
                expect(modelsHtml).toContain('data-quota-window-mode="tightest"');
                expect(modelsHtml).toContain('data-quota-direction="used"');
                expect(modelsHtml).toContain('>55%</span>');
                expect(modelsHtml).toContain(lang === 'zh' ? '已用' : 'Used');

                // 2. Weekly Active-Hours Quota Pace Forecast: both populated forecast & explicit Insufficient history
                expect(modelsHtml).toContain('id="modelsWeeklyPaceCard"');
                expect(modelsHtml).toContain('data-weekly-forecast="true"');
                expect(modelsHtml).toContain('4.5%/h');
                expect(modelsHtml).toContain('22.5%/d');
                expect(modelsHtml).toContain('data-weekly-status="insufficient_history"');
                expect(modelsHtml).toContain(lang === 'zh' ? '历史不足' : 'Insufficient history');

                // 3. Zero-Day Unknown Model adaptive badge
                expect(modelsHtml).toContain('data-zero-day="true"');
                expect(modelsHtml).toContain('data-zero-day-model="true"');
                expect(modelsHtml).toContain('spec-zeroday-badge');

                // 4. Profile SEC-04: opaque data-account-handle, ZERO data-email on #profileBillingDayInput, zero plaintext email when masked
                const profileHtml = buildProfileContent(makeUserInfo(), configs, 15, quotaSummary, {
                    privacyMasked: true,
                    accountHandle: 'acct_handle_profile_01',
                    quotaWindowMode: '5h',
                    quotaDirectionMode: 'remaining',
                });
                expect(profileHtml).toContain('id="profileBillingDayInput"');
                expect(profileHtml).toContain('data-account-handle="acct_handle_profile_01"');
                expect(profileHtml).not.toContain('data-email=');
                expect(profileHtml).not.toContain('alice.secret@example.com');
                expect(profileHtml).toContain(lang === 'zh' ? '剩余' : 'Remaining');

                // Single-window quota grid also labels window + direction while preserving >72%</span>
                const gridHtml = buildModelQuotaGrid([makeModelConfig({ quotaInfo: { remainingFraction: 0.72, resetTime: '2026-11-27T15:00:00.000Z' } })], {
                    quotaWindowMode: '5h',
                    quotaDirectionMode: 'remaining',
                });
                expect(gridHtml).toContain('>72%</span>');
                expect(gridHtml).toContain('data-quota-window-mode="5h"');
                expect(gridHtml).toContain('data-quota-direction="remaining"');

                assertFrozenPopoverContract(modelsHtml, `Models (${lang})`);
                assertFrozenPopoverContract(profileHtml, `Profile (${lang})`);
                expect(modelsHtml).not.toMatch(FORBIDDEN_GLOSSARY_RE);
                expect(profileHtml).not.toMatch(FORBIDDEN_GLOSSARY_RE);
            },
        );
    });


    describe('Phase 3 Wave 3B Plan C — Settings 5-Group & About (webview-settings-tab.ts & webview-about-tab.ts)', () => {
        it.each(['en', 'zh', 'both'] as Language[])(
            'renders exactly 5 logical Settings groups, all new setAppSetting controls, backup/diagnostics hooks, objective compliance wording, and streamlined About in %s',
            async (lang) => {
                await setLanguageToState(lang, langState);

                const normalized = normalizeMonitorDocumentSettings({
                    languagePreference: 'both',
                    contextPctBasis: 'native',
                    speedMetricMode: 'e2e',
                    quotaWindowMode: 'tightest',
                    quotaDirectionMode: 'used',
                    cdpOverlayFontSize: 'large',
                    cdpOverlayHighContrast: true,
                    appShowNativeHudBar: true,
                    ideShowNativeHudBar: false,
                    nativeHudAutoHideOnOverview: false,
                });
                expect(normalized.languagePreference).toBe('both');
                expect(normalized.contextPctBasis).toBe('native');
                expect(normalized.speedMetricMode).toBe('e2e');
                expect(normalized.quotaWindowMode).toBe('tightest');
                expect(normalized.quotaDirectionMode).toBe('used');
                expect(normalized.cdpOverlayFontSize).toBe('large');
                expect(normalized.cdpOverlayHighContrast).toBe(true);

                const html = buildSettingsContent([], undefined, undefined, {
                    surface: 'app-sidecar',
                    appSettings: {
                        languagePreference: 'both',
                        appShowNativeHudBar: true,
                        ideShowNativeHudBar: false,
                        nativeHudAutoHideOnOverview: false,
                        contextPctBasis: 'native',
                        speedMetricMode: 'e2e',
                        quotaWindowMode: 'tightest',
                        quotaDirectionMode: 'used',
                        displayCurrency: 'CAD',
                        customFxRate: 1.42,
                        customFxCurrency: 'CAD',
                        cdpOverlayFontSize: 'large',
                        cdpOverlayHighContrast: true,
                        subscriptionPlan: 'google-ai-pro',
                        subscriptionMonthlyFee: 19.99,
                        subscriptionCurrency: 'USD',
                    },
                });

                // 1. 6 logical groups in order (App Sidecar places Overlays & CDP at the top + Global Rules)
                const groups = extractAttrValues(html, 'data-settings-group');
                expect(groups).toEqual([
                    'version-updates',
                    'overlays-cdp',
                    'display-language',
                    'telemetry-metrics',
                    'currency-pricing',
                    'global-rules',
                    'data-backup-diagnostics',
                ]);

                // 2. All cross-worker setAppSetting keys present
                for (const key of [
                    'languagePreference',
                    'appShowNativeHudBar',
                    'ideShowNativeHudBar',
                    'nativeHudAutoHideOnOverview',
                    'contextPctBasis',
                    'speedMetricMode',
                    'quotaWindowMode',
                    'quotaDirectionMode',
                    'displayCurrency',
                    'customFxRate',
                    'subscriptionPlan',
                    'subscriptionMonthlyFee',
                    'subscriptionCurrency',
                    'cdpOverlayFontSize',
                    'cdpOverlayHighContrast',
                ]) {
                    expect(html).toContain(`data-app-setting="${key}"`);
                }
                expect(html).toContain('<option value="both" selected>');
                expect(html).toContain('<option value="CAD" selected>');
                expect(html).toContain('value="1.42"');

                // Mismatched customFxCurrency clears input value
                const mismatchSettingsHtml = buildSettingsContent([], undefined, undefined, {
                    surface: 'app-sidecar',
                    appSettings: {
                        displayCurrency: 'EUR',
                        customFxRate: 1.42,
                        customFxCurrency: 'CAD',
                    },
                });
                expect(mismatchSettingsHtml).toMatch(/id="customFxRateInput"[\s\S]*?value=""/);

                // 3. Group 5 backup/diagnostics actions, hidden file input, aligned feedback IDs & allowlist/exclusions note
                expect(html).toContain('data-action="exportSettingsBackup"');
                expect(html).toContain('data-action="importSettingsBackup"');
                expect(html).toContain('id="settingsBackupFileInput"');
                expect(html).toContain('accept=".json,application/json"');
                expect(html).toContain('id="settingsBackupFeedback"');
                expect(html).toContain('id="telemetryMetricsFeedback"');
                expect(html).toContain('id="languagePreferenceFeedback"');
                expect(html).toContain('data-action="exportRedactedDiagnostics"');
                expect(html).toContain('data-backup-exclusions="true"');

                // 4. Objective technical compliance wording ONLY
                expect(html).not.toMatch(FORBIDDEN_COMPLIANCE_RE);
                expect(html).not.toMatch(FORBIDDEN_GLOSSARY_RE);
                assertFrozenPopoverContract(html, `Settings (${lang})`);

                // 5. Streamlined About tab with single-source resolveRuntimeVersion() & 5-tab IA
                const aboutHtml = buildAboutTabContent(undefined, { surface: 'app-sidecar' });
                expect(aboutHtml).toContain(`v${resolveRuntimeVersion()}`);
                expect(aboutHtml).toContain('data-about-compliance="true"');
                for (const tabId of ['overview', 'gm', 'sessions', 'calendar', 'models', 'settings']) {
                    expect(aboutHtml).toContain(`data-navigate-tab="${tabId}"`);
                }
                expect(aboutHtml).not.toMatch(FORBIDDEN_COMPLIANCE_RE);
                expect(aboutHtml).not.toMatch(FORBIDDEN_GLOSSARY_RE);
                assertFrozenPopoverContract(aboutHtml, `About (${lang})`);
            },
        );

        it('keeps all owned tab CSS balanced with zero Songti', () => {
            for (const css of [
                getGMDataTabStyles(),
                getCalendarTabStyles(),
                getPricingTabStyles(),
                getAboutTabStyles(),
            ]) {
                const opens = (css.match(/\{/g) || []).length;
                const closes = (css.match(/\}/g) || []).length;
                expect(opens).toBe(closes);
                expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/SimSun|Songti|宋体/i);
            }
        });
    });
});

describe('[v118-ui-shell-and-swarm]', () => {
    const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };

    const initialLang = getLanguage();

    const NOW = Date.parse('2026-11-27T10:00:00Z');


    function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
        return {
            cascadeId: 'root-coord-1',
            title: 'Coordinator Main Session',
            model: 'MODEL_PLACEHOLDER_M535',
            modelDisplayName: 'Gemini 4 Neon (High)',
            contextLimit: 256_000,
            contextUsed: 185_000,
            usagePercent: 72.26,
            status: 'RUNNING',
            stepCount: 24,
            lastModifiedTime: '2026-11-27T09:59:00Z',
            isEstimated: false,
            lastModelUsage: {
                model: 'MODEL_PLACEHOLDER_M535',
                inputTokens: 15_000,
                outputTokens: 1_200,
                responseOutputTokens: 900,
                cacheReadTokens: 170_000,
                cacheCreationTokens: 0,
            },
            totalOutputTokens: 8_400,
            totalToolCallOutputTokens: 22_000,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: false,
            checkpointModel: '',
            createdTime: '2026-11-27T09:00:00Z',
            lastUserInputTime: '2026-11-27T09:58:00Z',
            lastUserInputStepIndex: 20,
            repositoryName: 'acme/monitor',
            gitOriginUrl: '',
            branchName: 'main',
            gitRootUri: 'file:///workspace/monitor',
            ...overrides,
        };
    }


    function makeConfig(model: string, label: string, frac5h: number, frac7d?: number): ModelConfig {
        return {
            model,
            label,
            quotaInfo: { remainingFraction: frac5h, resetTime: '2026-11-27T13:00:00Z' },
            supportsImages: false,
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
            ...(frac7d !== undefined ? { weeklyQuota: { remainingFraction: frac7d, resetTime: '2026-12-02T00:00:00Z' } } : {}),
        };
    }


    function makeGMSummary(cascadeId = 'root-coord-1'): GMSummary {
        const call: GMCallEntry = {
            stepIndices: [24],
            executionId: 'exec-v118',
            model: 'claude-sonnet-4-6',
            modelDisplay: 'Claude Sonnet 4.6',
            responseModel: 'claude-sonnet-4-6',
            modelAccuracy: 'exact',
            inputTokens: 15_000,
            outputTokens: 900,
            thinkingTokens: 0,
            responseTokens: 900,
            cacheReadTokens: 170_000,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 0.65,
            streamingSeconds: 9,
            credits: 0,
            creditType: '',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 185_000,
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
            createdAt: '2026-11-27T09:59:00Z',
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 200_000,
        };
        return {
            conversations: [{
                cascadeId,
                title: 'Coordinator Main Session',
                totalSteps: 24,
                calls: [call],
                coveredSteps: 24,
                coverageRate: 1,
                checkpointSummaries: [],
            }],
            modelBreakdown: {},
            totalCalls: 1,
            totalStepsCovered: 24,
            totalCredits: 0,
            totalInputTokens: 15_000,
            totalOutputTokens: 900,
            totalCacheRead: 170_000,
            totalCacheCreation: 0,
            totalThinkingTokens: 0,
            contextGrowth: [],
            fetchedAt: '2026-11-27T09:59:00Z',
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


    // ─── Minimal DOM Harness for VM Client Testing ───────────────────────────────

    class MiniClassList {
        private set = new Set<string>();
        constructor(private owner: MiniEl) {}
        sync(cls: string) { this.set = new Set(cls.split(/\s+/).filter(Boolean)); }
        private flush() { this.owner._className = [...this.set].join(' '); }
        add(...names: string[]) { for (const n of names) { if (n) { this.set.add(n); } } this.flush(); }
        remove(...names: string[]) { for (const n of names) { this.set.delete(n); } this.flush(); }
        toggle(name: string, force?: boolean): boolean {
            const next = force !== undefined ? Boolean(force) : !this.set.has(name);
            if (next) { this.set.add(name); } else { this.set.delete(name); }
            this.flush();
            return next;
        }
        contains(name: string) { return this.set.has(name); }
    }


    class MiniEl {
        tagName: string;
        lang = '';
        id = '';
        _className = '';
        classList: MiniClassList;
        attrs = new Map<string, string>();
        style: Record<string, string> = {};
        dataset: Record<string, string> = {};
        children: MiniEl[] = [];
        parentElement: MiniEl | null = null;
        hidden = false;
        disabled = false;
        type = '';
        value = '';
        defaultValue = '';
        checked = false;
        open = false;
        get isConnected(): boolean { return this.doc.documentElement.contains(this); }
        textContent = '';
        _innerHTML = '';
        scrollTop = 0;
        offsetLeft = 0;
        offsetWidth = 80;
        offsetHeight = 32;
        scrolledIntoView = 0;
        files: Array<{ size: number; text: () => Promise<string> }> | null = null;
        listeners = new Map<string, Array<(e: any) => void>>();
        doc!: MiniDoc;

        constructor(tag: string, doc: MiniDoc) {
            this.tagName = tag.toUpperCase();
            this.doc = doc;
            this.classList = new MiniClassList(this);
        }

        get className() { return this._className; }
        set className(v: string) { this._className = v; this.classList.sync(v); }
        get innerHTML() { return this._innerHTML; }
        set innerHTML(v: string) {
            this._innerHTML = v;
            this.textContent = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        setAttribute(k: string, v: string) {
            const s = String(v);
            this.attrs.set(k, s);
            if (k === 'id') { this.id = s; }
            if (k === 'class') { this.className = s; }
            if (k === 'type') { this.type = s; }
            if (k === 'hidden') { this.hidden = true; }
            if (k.startsWith('data-')) {
                const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.dataset[camel] = s;
            }
        }
        getAttribute(k: string): string | null {
            if (k === 'id' && this.id) { return this.id; }
            if (k === 'class' && this._className) { return this._className; }
            return this.attrs.has(k) ? this.attrs.get(k)! : null;
        }
        hasAttribute(k: string) { return this.attrs.has(k) || (k === 'id' && !!this.id); }
        removeAttribute(k: string) { this.attrs.delete(k); if (k === 'hidden') { this.hidden = false; } }
        appendChild(child: MiniEl) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        }
        remove() {
            if (!this.parentElement) { return; }
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) { this.parentElement.children.splice(idx, 1); }
            this.parentElement = null;
        }
        contains(node: MiniEl | null): boolean {
            let cur: MiniEl | null = node;
            while (cur) { if (cur === this) { return true; } cur = cur.parentElement; }
            return false;
        }
        focus() {
            if (this.doc.activeElement === this) { return; }
            this.doc.activeElement = this;
            this.dispatch('focusin');
        }
        scrollIntoView() { this.scrolledIntoView += 1; }
        getBoundingClientRect() { return { left: 20, right: 120, top: 80, bottom: 112, width: 100, height: 32 }; }
        addEventListener(type: string, fn: (e: any) => void) {
            const arr = this.listeners.get(type) || [];
            arr.push(fn);
            this.listeners.set(type, arr);
        }
        removeEventListener(type: string, fn: (e: any) => void) {
            const arr = this.listeners.get(type);
            if (!arr) { return; }
            const i = arr.indexOf(fn);
            if (i >= 0) { arr.splice(i, 1); }
        }
        matches(selector: string): boolean {
            const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
            return parts.some(part => this.matchSimple(part));
        }
        private matchSimple(sel: string): boolean {
            // Basic compound selector matching: tag, #id, .cls, [attr], [attr="val"]
            let rest = sel.trim();
            if (rest.includes(' ')) {
                const tokens = rest.split(/\s+/);
                const last = tokens[tokens.length - 1];
                if (!this.matchSimple(last)) { return false; }
                let anc = this.parentElement;
                const ancestorSel = tokens.slice(0, -1).join(' ');
                while (anc) {
                    if (anc.matchSimple(ancestorSel)) { return true; }
                    anc = anc.parentElement;
                }
                return false;
            }
            const tagMatch = /^([a-z0-9]+)/i.exec(rest);
            if (tagMatch) {
                if (this.tagName !== tagMatch[1].toUpperCase()) { return false; }
                rest = rest.slice(tagMatch[0].length);
            }
            while (rest.length > 0) {
                if (rest.startsWith('#')) {
                    const m = /^#([a-zA-Z0-9_-]+)/.exec(rest);
                    if (!m || this.id !== m[1]) { return false; }
                    rest = rest.slice(m[0].length);
                } else if (rest.startsWith('.')) {
                    const m = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
                    if (!m || !this.classList.contains(m[1])) { return false; }
                    rest = rest.slice(m[0].length);
                } else if (rest.startsWith('[')) {
                    const m = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/.exec(rest);
                    if (!m) { return false; }
                    const attrVal = this.getAttribute(m[1]);
                    if (m[2] !== undefined) {
                        if (attrVal !== m[2]) { return false; }
                    } else if (attrVal === null) {
                        return false;
                    }
                    rest = rest.slice(m[0].length);
                } else {
                    return false;
                }
            }
            return true;
        }
        closest(selector: string): MiniEl | null {
            let cur: MiniEl | null = this;
            while (cur) {
                if (cur.matches(selector)) { return cur; }
                cur = cur.parentElement;
            }
            return null;
        }
        querySelectorAll(selector: string): MiniEl[] {
            const res: MiniEl[] = [];
            const walk = (el: MiniEl) => {
                for (const c of el.children) {
                    if (c.matches(selector)) { res.push(c); }
                    walk(c);
                }
            };
            walk(this);
            return res;
        }
        querySelector(selector: string): MiniEl | null {
            return this.querySelectorAll(selector)[0] || null;
        }
        dispatch(type: string, extra: Record<string, unknown> = {}) {
            const ev = {
                type,
                target: this,
                currentTarget: this,
                preventDefault: () => {},
                stopPropagation: () => {},
                ...extra,
            };
            let cur: MiniEl | null = this;
            while (cur) {
                for (const fn of cur.listeners.get(type) || []) { fn.call(cur, ev); }
                cur = cur.parentElement;
            }
            for (const fn of this.doc.listeners.get(type) || []) { fn(ev); }
        }
    }


    class MiniDoc {
        documentElement: MiniEl;
        head: MiniEl;
        body: MiniEl;
        activeElement: MiniEl | null = null;
        listeners = new Map<string, Array<(e: any) => void>>();
        constructor() {
            this.documentElement = new MiniEl('html', this);
            this.head = new MiniEl('head', this);
            this.body = new MiniEl('body', this);
            this.documentElement.appendChild(this.head);
            this.documentElement.appendChild(this.body);
        }
        createElement(tag: string) { return new MiniEl(tag, this); }
        createTextNode(text: string) { const e = new MiniEl('#text', this); e.textContent = text; return e; }
        getElementById(id: string): MiniEl | null {
            const walk = (el: MiniEl): MiniEl | null => {
                if (el.id === id) { return el; }
                for (const c of el.children) { const f = walk(c); if (f) { return f; } }
                return null;
            };
            return walk(this.documentElement);
        }
        querySelectorAll(sel: string) { return this.documentElement.querySelectorAll(sel); }
        querySelector(sel: string) { return this.documentElement.querySelector(sel); }
        addEventListener(type: string, fn: (e: any) => void) {
            const arr = this.listeners.get(type) || [];
            arr.push(fn);
            this.listeners.set(type, arr);
        }
        removeEventListener(type: string, fn: (e: any) => void) {
            const arr = this.listeners.get(type);
            if (!arr) { return; }
            const i = arr.indexOf(fn);
            if (i >= 0) { arr.splice(i, 1); }
        }
        dispatch(type: string, extra: Record<string, unknown> = {}) {
            const ev = { type, target: this.activeElement || this.body, preventDefault: () => {}, stopPropagation: () => {}, ...extra };
            for (const fn of this.listeners.get(type) || []) { fn(ev); }
        }
    }


    function createV118ShellVm(opts: {
        surface?: 'app-sidecar' | 'ide';
        lang?: 'en' | 'zh' | 'both';
        primaryLang?: 'en' | 'zh';
        innerWidth?: number;
        zoom?: number;
        hudEnabled?: boolean;
        hudAutoHideOverview?: boolean;
        initialTabAttr?: string;
        initialAnchorAttr?: string;
        savedState?: Record<string, unknown>;
        search?: string;
        hash?: string;
        bridge?: Record<string, unknown>;
        beforeRun?: (doc: MiniDoc) => void;
        onTimer?: (fn: () => void, ms: number) => void;
    } = {}) {
        const doc = new MiniDoc();
        doc.body.setAttribute('data-acm-surface', opts.surface ?? 'app-sidecar');
        doc.body.setAttribute('data-lang', opts.lang ?? 'both');
        doc.body.setAttribute('data-primary-lang', opts.primaryLang ?? 'zh');
        doc.body.setAttribute('data-view-lang', opts.lang ?? 'both');
        doc.body.setAttribute('data-active-tab', 'overview');
        doc.body.setAttribute('data-hud-auto-hide-overview', String(opts.hudAutoHideOverview ?? true));
        doc.body.setAttribute('data-privacy-default', 'true');
        doc.body.setAttribute('data-privacy-masked', 'true');
        doc.body.setAttribute('data-zoom', String(opts.zoom ?? 100));
        if (opts.initialTabAttr) { doc.body.setAttribute('data-initial-tab', opts.initialTabAttr); }
        if (opts.initialAnchorAttr) { doc.body.setAttribute('data-initial-anchor', opts.initialAnchorAttr); }

        const topbar = doc.createElement('div');
        topbar.className = 'panel-topbar';
        doc.body.appendChild(topbar);

        const pauseBtn = doc.createElement('button');
        pauseBtn.setAttribute('id', 'pauseBtn');
        pauseBtn.setAttribute('data-label-pause', 'Freeze');
        pauseBtn.setAttribute('data-label-resume', 'Resume');
        pauseBtn.setAttribute('data-label-paused', 'FROZEN');
        topbar.appendChild(pauseBtn);

        const aboutBtn = doc.createElement('button');
        aboutBtn.setAttribute('id', 'topbarAboutBtn');
        aboutBtn.setAttribute('class', 'action-btn topbar-util-btn');
        aboutBtn.setAttribute('data-utility-view', 'about');
        aboutBtn.setAttribute('aria-pressed', 'false');
        aboutBtn.setAttribute('aria-controls', 'tab-about');
        aboutBtn.setAttribute('aria-label', 'About');
        topbar.appendChild(aboutBtn);

        const lockBtn = doc.createElement('button');
        lockBtn.setAttribute('id', 'lockMainBtn');
        lockBtn.setAttribute('data-action', 'toggleLockMain');
        lockBtn.setAttribute('aria-pressed', 'false');
        topbar.appendChild(lockBtn);

        const tabBar = doc.createElement('nav');
        tabBar.setAttribute('id', 'tabBar');
        tabBar.setAttribute('class', 'tab-bar');
        tabBar.setAttribute('role', 'tablist');
        topbar.appendChild(tabBar);

        const slider = doc.createElement('div');
        slider.className = 'tab-slider';
        tabBar.appendChild(slider);

        for (const id of CANONICAL_MAIN_TABS) {
            const btn = doc.createElement('button');
            btn.setAttribute('id', `tabBtn-${id}`);
            btn.setAttribute('class', id === 'overview' ? 'tab-btn active' : 'tab-btn');
            btn.setAttribute('role', 'tab');
            btn.setAttribute('data-tab', id);
            btn.setAttribute('aria-selected', id === 'overview' ? 'true' : 'false');
            btn.setAttribute('aria-controls', `tab-${id}`);
            btn.textContent = id;
            tabBar.appendChild(btn);
        }

        const hudHost = doc.createElement('div');
        hudHost.setAttribute('id', 'nativeHudHost');
        hudHost.setAttribute('class', 'native-hud-host');
        const hudOn = opts.hudEnabled ?? true;
        hudHost.setAttribute('data-hud-enabled', String(hudOn));
        hudHost.innerHTML = hudOn ? '<section id="nativeHudBar">HUD</section>' : '';
        if (!hudOn) { hudHost.hidden = true; }
        doc.body.appendChild(hudHost);

        const main = doc.createElement('main');
        main.setAttribute('id', 'monitor-content');
        doc.body.appendChild(main);

        const paneIds = ['overview', 'gm', 'sessions', 'calendar', 'models', 'settings', 'about'];
        for (const pid of paneIds) {
            const pane = doc.createElement('div');
            pane.setAttribute('id', `tab-${pid}`);
            pane.setAttribute('class', pid === 'overview' ? 'tab-pane active' : 'tab-pane');
            pane.setAttribute('role', 'tabpanel');
            main.appendChild(pane);
            if (pid === 'overview') {
                const h2 = doc.createElement('h2');
                h2.setAttribute('id', 'overview-heading');
                h2.setAttribute('data-overview-focus', 'heading');
                h2.setAttribute('tabindex', '-1');
                pane.appendChild(h2);
            }
            if (pid === 'gm') {
                const sg = doc.createElement('div'); sg.setAttribute('id', 'slot-gm'); pane.appendChild(sg);
                const sa = doc.createElement('div'); sa.setAttribute('id', 'slot-activity'); sa.hidden = true; pane.appendChild(sa);
            }
            if (pid === 'sessions') {
                const ss = doc.createElement('div'); ss.setAttribute('id', 'slot-sessions'); pane.appendChild(ss);
            }
            if (pid === 'calendar') {
                const sc = doc.createElement('div'); sc.setAttribute('id', 'slot-calendar'); pane.appendChild(sc);
                const sp = doc.createElement('div'); sp.setAttribute('id', 'slot-pricing'); pane.appendChild(sp);
            }
            if (pid === 'models') {
                const sm = doc.createElement('div'); sm.setAttribute('id', 'slot-models'); pane.appendChild(sm);
                const sp = doc.createElement('div'); sp.setAttribute('id', 'slot-profile'); pane.appendChild(sp);
            }
        }

        const liveRegion = doc.createElement('div');
        liveRegion.setAttribute('id', 'acmLiveRegion');
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');
        doc.body.appendChild(liveRegion);

        const posted: Array<Record<string, unknown>> = [];
        let stateObj: Record<string, unknown> = { ...(opts.savedState || {}) };
        const winListeners = new Map<string, Array<(e: any) => void>>();

        const win: Record<string, any> = {
            document: doc,
            Element: MiniEl,
            innerWidth: opts.innerWidth ?? 900,
            innerHeight: 700,
            scrollY: 0,
            scrollTo: () => {},
            location: {
                origin: 'http://127.0.0.1:43210',
                href: `http://127.0.0.1:43210/panel${opts.search || ''}${opts.hash || ''}`,
                search: opts.search || '',
                hash: opts.hash || '',
            },
            navigator: { clipboard: { writeText: async () => {} } },
            requestAnimationFrame: (cb: () => void) => cb(),
            setTimeout: (fn: () => void, ms: number) => { opts.onTimer?.(fn, ms); return 1; },
            clearTimeout: () => {},
            acquireVsCodeApi: () => ({
                getState: () => stateObj,
                setState: (next: Record<string, unknown>) => { stateObj = next; },
                postMessage: (m: Record<string, unknown>) => { posted.push(m); },
            }),
            addEventListener: (type: string, fn: (e: any) => void) => {
                const arr = winListeners.get(type) || [];
                arr.push(fn);
                winListeners.set(type, arr);
            },
            removeEventListener: (type: string, fn: (e: any) => void) => {
                const arr = winListeners.get(type);
                if (!arr) { return; }
                const i = arr.indexOf(fn);
                if (i >= 0) { arr.splice(i, 1); }
            },
            dispatchWin: (type: string, ev: Record<string, unknown> = {}) => {
                for (const fn of winListeners.get(type) || []) { fn({ type, ...ev }); }
            },
        };
        win.window = win;
        win.parent = { foreign: true };
        if (opts.bridge) { win.__ACM_BRIDGE__ = opts.bridge; }
        if (opts.beforeRun) { opts.beforeRun(doc); }

        const script = getScript();
        const ctx = vm.createContext({
            ...win,
            console,
            URL,
            Blob: class { constructor(public parts: unknown[], public opts?: unknown) {} },
            setTimeout: win.setTimeout,
            clearTimeout: win.clearTimeout,
            requestAnimationFrame: win.requestAnimationFrame,
        });
        const handle = vm.runInContext(script, ctx);
        return { doc, win, posted, handle, getState: () => stateObj, hudHost, liveRegion };
    }


    beforeEach(async () => { await setLanguageToState('both', memState); });

    afterEach(async () => { await setLanguageToState(initialLang, memState); });


    describe('v1.18 Phase 3 Wave 3B — 5-Tab Shell, Topbar Utility Views & 18-Alias Deep Links', () => {
        it('renders strictly 5 zero-scroll main tabs inside [role="tablist"] and ⚙️/ⓘ utility buttons outside', async () => {
            await setLanguageToState('zh', memState);
            const html = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                data: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon', 0.65, 0.45)],
                gmSummary: makeGMSummary(),
                now: NOW,
            });

            const tablistMatch = html.match(/<nav[^>]*role="tablist"[^>]*>([\s\S]*?)<\/nav>/);
            expect(tablistMatch).toBeTruthy();
            const tablistInner = tablistMatch![1];
            const tabIdsInTablist = [...tablistInner.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
            expect(tabIdsInTablist).toEqual(['overview', 'gm', 'sessions', 'calendar', 'models', 'settings']);
            expect(tablistInner).not.toContain('data-tab="about"');
            expect(html).not.toContain('id="tabArrowLeft"');
            expect(html).not.toContain('id="tabArrowRight"');
            expect(html).not.toContain('id="tabScrollHint"');

            // Duplicate topbar Settings button removed; About utility button stays outside [role="tablist"]
            expect(html).not.toContain('id="topbarSettingsBtn"');
            expect(html).toContain('id="tabBtn-settings"');
            expect(html).toContain('aria-labelledby="tabBtn-settings"');
            expect(html).toContain('id="topbarAboutBtn"');
            expect(html).toContain('data-utility-view="about"');
            expect(html).toContain('aria-controls="tab-about"');
            expect(html).toContain('id="acmLiveRegion"');
            expect(html).toContain('aria-live="polite"');

            // Zero-scroll 6-column CSS grid
            const baseCss = getStyles();
            expect(baseCss).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
        });

        it('resolves all 18 tab IDs & aliases, lets explicit deep link beat savedState, and preserves anchors across reload', () => {
            const expected18: Array<[string, string, string | undefined]> = [
                ['overview', 'overview', undefined],
                ['gm', 'gm', undefined],
                ['gmdata', 'gm', undefined],
                ['gm-data', 'gm', undefined],
                ['activity', 'gm', 'slot-activity'],
                ['sessions', 'sessions', undefined],
                ['chats', 'sessions', undefined],
                ['chat-history', 'sessions', undefined],
                ['usage', 'calendar', undefined],
                ['cost', 'calendar', 'slot-pricing'],
                ['pricing', 'calendar', 'slot-pricing'],
                ['calendar', 'calendar', undefined],
                ['models', 'models', undefined],
                ['profile', 'models', 'slot-profile'],
                ['account', 'models', 'slot-profile'],
                ['accounts', 'models', 'slot-profile'],
                ['settings', 'settings', undefined],
                ['about', 'about', undefined],
            ];
            expect(Object.keys(ALL_TAB_ALIASES)).toHaveLength(18);
            for (const [alias, canonical, anchor] of expected18) {
                expect(resolveTabAlias(alias), alias).toEqual(anchor ? { tab: canonical, anchor } : { tab: canonical });
            }

            // Explicit deep link (?tab=cost) beats savedState.activeTab ('sessions') and saves destination anchor
            const env1 = createV118ShellVm({
                savedState: { activeTab: 'sessions' },
                search: '?tab=cost',
            });
            expect(env1.handle.getStatus().activeTab).toBe('calendar');
            expect(env1.handle.getStatus().activeAnchor).toBe('slot-pricing');
            expect(env1.doc.getElementById('slot-pricing')!.scrolledIntoView).toBeGreaterThan(0);
            expect(env1.getState().activeTab).toBe('calendar');
            expect(env1.getState().activeAnchor).toBe('slot-pricing');

            // Reload without URL deep link restores savedState tab + destination anchor
            const env2 = createV118ShellVm({ savedState: env1.getState() });
            expect(env2.handle.getStatus().activeTab).toBe('calendar');
            expect(env2.handle.getStatus().activeAnchor).toBe('slot-pricing');
            expect(env2.doc.getElementById('slot-pricing')!.scrolledIntoView).toBeGreaterThan(0);

            // Settings main tab activates tabBtn-settings; About topbar utility button clears main tab aria-selected
            env2.doc.getElementById('tabBtn-settings')!.dispatch('click');
            expect(env2.handle.getStatus().activeTab).toBe('settings');
            expect(env2.doc.getElementById('tabBtn-settings')!.getAttribute('aria-selected')).toBe('true');
            expect(env2.doc.getElementById('tabBtn-settings')!.getAttribute('aria-current')).toBe('page');
            expect(env2.doc.getElementById('tabBtn-overview')!.getAttribute('aria-selected')).toBe('false');
            env2.doc.getElementById('topbarAboutBtn')!.dispatch('click');
            expect(env2.handle.getStatus().activeTab).toBe('about');
            expect(env2.doc.getElementById('topbarAboutBtn')!.getAttribute('aria-pressed')).toBe('true');
            expect(env2.doc.getElementById('tabBtn-settings')!.getAttribute('aria-selected')).toBe('false');
            expect(env2.doc.getElementById('tabBtn-overview')!.getAttribute('tabindex')).toBe('0');
        });

        it('slots legacy incremental updateTabs keys cleanly into 5-tab containers', () => {
            const env = createV118ShellVm();
            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210',
                source: env.win,
                data: {
                    command: 'updateTabs',
                    tabs: {
                        gmdata: '<p>GM Calls Updated</p>',
                        activity: '<p>Activity Timeline Updated</p>',
                        chats: '<p>Sessions Updated</p>',
                        pricing: '<p>Pricing Updated</p>',
                        profile: '<p>Account Updated</p>',
                    },
                },
            });
            expect(env.doc.getElementById('slot-gm')!.innerHTML).toContain('GM Calls Updated');
            expect(env.doc.getElementById('slot-activity')!.innerHTML).toContain('Activity Timeline Updated');
            expect(env.doc.getElementById('slot-activity')!.hidden).toBe(false);
            expect(env.doc.getElementById('slot-sessions')!.innerHTML).toContain('Sessions Updated');
            expect(env.doc.getElementById('slot-pricing')!.innerHTML).toContain('Pricing Updated');
            expect(env.doc.getElementById('slot-profile')!.innerHTML).toContain('Account Updated');
        });
    });


    describe('v1.18 Split Native HUD Auto-Hide & Per-View Compact Language (479/480/481 + Zoom + Focus)', () => {
        it('uses the published E2E sample and unknown session cost and labels the selected quota window and direction', () => {
            const observation = buildPublishedMonitorObservation({
                windowId: 'window-1', backendEpoch: 1, selectionRevision: 1, dataRevision: 29,
                subjectCascadeId: 'root-coord-1', usedTokens: 21000, compactionLimit: 100000,
                speedMode: 'e2e', displaySpeedTps: 23.4, sessionCostUsd: null,
            });
            const tabs = buildMonitorTabsPayload({
                surface: 'app-sidecar', observation, currentUsage: makeUsage(), gmSummary: makeGMSummary(),
                sessionCostUsd: 9876, todayCostUsd: 5432, quotaWindowMode: '7d', quotaDirectionMode: 'used',
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon', 0.65)],
                quotaSummary: { groups: [{ pool: 'gemini', displayName: 'Gemini', buckets: [], weekly: {
                    bucketId: 'week', window: 'weekly', displayName: 'Weekly', remainingFraction: 0.27,
                    resetTime: null, resetAt: null,
                } }] },
            });
            const hudSpeed = tabs.nativeHud.split('data-hud-metric="speed"')[1].split('data-hud-metric="ttft"')[0];
            const hudCost = tabs.nativeHud.split('data-hud-metric="cost"')[1].split('data-hud-metric="quota"')[0];
            expect(hudSpeed).toContain('23.4');
            expect(hudCost).toContain('—');
            expect(tabs.nativeHud).toContain('Weekly quota used / 每周配额已用 73%');
            expect(tabs.overview.split('data-telemetry-cell="speed"')[1].split('data-telemetry-cell="ttft"')[0]).toContain('23.4');
        });

        it('honors split appShowNativeHudBar / ideShowNativeHudBar and auto-hides HUD on Overview unless disabled', () => {
            const appDisabled = buildMonitorTabsPayload({
                surface: 'app-sidecar',
                data: makeUsage(),
                appSettings: { appShowNativeHudBar: false, ideShowNativeHudBar: true },
                now: NOW,
            });
            expect(appDisabled.nativeHud).toBe('');

            const ideEnabled = buildMonitorTabsPayload({
                surface: 'ide',
                data: makeUsage(),
                appSettings: { appShowNativeHudBar: false, ideShowNativeHudBar: true },
                now: NOW,
            });
            expect(ideEnabled.nativeHud).toContain('id="nativeHudBar"');

            // Default auto-hide on Overview: hidden on overview, restored on other tabs, hidden again on overview
            const envAuto = createV118ShellVm({ hudEnabled: true, hudAutoHideOverview: true });
            expect(envAuto.hudHost.hidden).toBe(true);
            envAuto.doc.getElementById('tabBtn-gm')!.dispatch('click');
            expect(envAuto.hudHost.hidden).toBe(false);
            envAuto.doc.getElementById('tabBtn-overview')!.dispatch('click');
            expect(envAuto.hudHost.hidden).toBe(true);

            // Always Show mode: stays visible on Overview
            const envAlways = createV118ShellVm({ hudEnabled: true, hudAutoHideOverview: false });
            expect(envAlways.hudHost.hidden).toBe(false);
        });

        it('compacts bilingual mode locally at 479/480/481 CSS px (including zoom) without mutating host or stealing focus', () => {
            const env = createV118ShellVm({ lang: 'both', primaryLang: 'zh', innerWidth: 481, zoom: 100 });
            const focusEl = env.doc.getElementById('tabBtn-gm')!;
            focusEl.focus();
            expect(env.doc.activeElement).toBe(focusEl);
            expect(env.doc.documentElement.lang).toBe('en');
            expect(env.doc.body.getAttribute('data-view-lang')).toBe('both');
            expect(env.doc.body.getAttribute('data-compact-lang')).toBe('false');

            // 480 CSS px -> compacts strictly in THIS view
            env.win.innerWidth = 480;
            env.win.dispatchWin('resize');
            expect(env.doc.documentElement.lang).toBe('zh-CN');
            expect(env.doc.body.getAttribute('data-view-lang')).toBe('zh');
            expect(env.doc.body.getAttribute('data-compact-lang')).toBe('true');
            expect(env.doc.activeElement).toBe(focusEl);

            // 479 CSS px -> stays compact
            env.win.innerWidth = 479;
            env.win.dispatchWin('resize');
            expect(env.doc.documentElement.lang).toBe('zh-CN');
            expect(env.doc.body.getAttribute('data-view-lang')).toBe('zh');

            // 481 CSS px -> restores bilingual
            env.win.innerWidth = 481;
            env.win.dispatchWin('resize');
            expect(env.doc.documentElement.lang).toBe('en');
            expect(env.doc.body.getAttribute('data-view-lang')).toBe('both');
            expect(env.doc.body.getAttribute('data-compact-lang')).toBe('false');

            // Zoom interaction: 600px at 125% zoom => 480 CSS px (compact); 600px at 120% zoom => 500 CSS px (both)
            env.win.innerWidth = 600;
            env.doc.body.style.zoom = '1.25';
            env.win.dispatchWin('resize');
            expect(env.doc.documentElement.lang).toBe('zh-CN');
            expect(env.doc.body.getAttribute('data-view-lang')).toBe('zh');
            env.doc.body.style.zoom = '1.2';
            env.win.dispatchWin('resize');
            expect(env.doc.documentElement.lang).toBe('en');
            expect(env.doc.body.getAttribute('data-view-lang')).toBe('both');

            // NEVER sends switchLanguage or setAppSetting(languagePreference) back to host
            expect(env.posted.filter(m => m.command === 'switchLanguage' || (m.command === 'setAppSetting' && m.key === 'languagePreference'))).toHaveLength(0);
        });
    });


    describe('v1.18 Overview D9 Swarm Live UI, Sessions Tree, Handoff v2 Preview & Recovery Brief', () => {
        it('renders sticky Inspect banner, Pending/Unavailable, Retarget, Swarm Live Strip (20+ partial), Handoff v2 & Recovery Brief', async () => {
            await setLanguageToState('both', memState);
            const members = Array.from({ length: 21 }, (_, idx) => ({
                cascadeId: idx === 0 ? 'root-coord-1' : `worker-${idx}`,
                memberName: idx === 1 ? 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef' : (idx === 0 ? 'coordinator' : `worker-${idx}`),
                isCoordinator: idx === 0,
                role: idx === 0 ? 'Coordinator' : 'Worker',
                relationshipKind: idx === 2 ? 'nested_helper' as const : 'swarm_member' as const,
                phase: idx === 1 ? 'WORKING' : 'WAITING',
                assignedModel: 'Gemini 4 Pro',
                measuredModel: idx === 1 ? 'Claude Sonnet 4.6' : null,
                contextPct: idx === 1 ? 84 : 25,
                directCostUsd: idx === 1 ? 1.25 : 0.12,
                lastObservedAt: idx < 18 ? NOW - 5_000 : null,
                isInspected: idx === 1,
                isLockedRoot: idx === 0,
            }));
            const swarmOverview: SwarmOverviewDisplayData = {
                rootId: 'root-coord-1',
                title: 'Wave 3B Swarm',
                members,
                totalMemberCount: 21,
                observedMemberCount: 18,
                partialCoverage: true,
                groupTotalCostUsd: 3.45,
                groupUnpricedCalls: 2,
            };
            const handoffPreview: HandoffV2PreviewData = {
                subjectCascadeId: 'worker-1',
                dataRevision: 42,
                markdown: '# HANDOFF v2\n- Resume worker-1',
            };
            const recoveryBrief: CompactionRecoveryBriefData = {
                eventKey: 'ev-compact-9',
                cascadeId: 'root-coord-1',
                beforeTokens: 210_000,
                afterTokens: 78_000,
                savedTokens: 132_000,
                summaryText: 'Compacted earlier turns safely.',
            };
            const cacheTtl: PromptCacheTtlEvaluation = {
                ttlEstimateState: 'cooling',
                idleSeconds: 235,
                remainingTtlSeconds: 65,
                ttlWindowSeconds: 300,
                clockAnomaly: 'none',
                shouldResetHeuristic: false,
                measuredReusePct: 86.5,
                hasMeasuredCacheTelemetry: true,
            };

            const overviewHtml = buildOverviewTabContent(
                makeUsage(),
                [makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon', 0.62, 0.34)],
                null,
                0,
                { state: 'active' },
                NOW,
                {
                    gmSummary: makeGMSummary(),
                    inspectedMemberId: 'worker-1',
                    inspectedMemberLabel: 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef',
                    lockedRootId: 'root-coord-1',
                    lockPendingUnavailable: true,
                    retargetOfferId: 'new-main-99',
                    retargetOfferTitle: 'New Main Task',
                    swarmOverview,
                    handoffPreview,
                    recoveryBrief,
                    cacheTtl,
                    contextPctBasis: 'native',
                    speedMetricMode: 'e2e',
                    quotaWindowMode: 'tightest',
                    quotaDirectionMode: 'used',
                },
            );

            // Sticky Inspecting Worker Banner (distinct from Root), Pending/Unavailable, Retarget
            expect(overviewHtml).toContain('data-inspect-banner="true"');
            expect(overviewHtml).toContain('is-sticky');
            expect(overviewHtml).toContain('data-action="clearInspect"');
            expect(overviewHtml).toContain('data-lock-pending="true"');
            expect(overviewHtml).toContain('data-retarget-banner="true"');
            expect(overviewHtml).toContain('data-action="retargetLockedRoot"');

            // Swarm Live Strip (20+ partial coverage, assigned vs measured model, direct vs group cost + unpriced)
            expect(overviewHtml).toContain('id="overviewSwarmStrip"');
            expect(overviewHtml).toContain('data-swarm-partial-coverage="true"');
            expect(overviewHtml).toContain('(18/21)');
            expect(overviewHtml).toContain('data-swarm-group-cost="true"');
            expect(overviewHtml).toContain('$3.45');
            expect(overviewHtml).toContain('data-member-direct-cost="true"');
            expect(overviewHtml).toContain('Gemini 4 Pro');
            expect(overviewHtml).toContain('Claude Sonnet 4.6');
            expect(overviewHtml).toContain('data-last-observed-at=');

            // Handoff v2 preview-before-copy bound to (subjectCascadeId, dataRevision) & Read-Only Recovery Brief
            expect(overviewHtml).toContain('data-context-budget-warning="true"');
            expect(overviewHtml).toContain('id="handoffV2PreviewBox"');
            expect(overviewHtml).toContain('data-subject-cascade-id="worker-1"');
            expect(overviewHtml).toContain('data-data-revision="42"');
            expect(overviewHtml).toContain('readonly');
            expect(overviewHtml).toContain('id="compactionRecoveryBrief"');
            expect(overviewHtml).toContain('data-read-only="true"');
            expect(overviewHtml).toContain('data-action="dismissRecoveryBrief"');

            // Cache 5m TTL badge + Basis/Speed/Quota switches
            expect(overviewHtml).toContain('data-cache-ttl-state="cooling"');
            expect(overviewHtml).toContain('data-cache-ttl-source="local_ttl_heuristic"');
            expect(overviewHtml).toContain('data-setting-switch="contextPctBasis"');
            expect(overviewHtml).toContain('data-setting-switch="speedMetricMode"');
            expect(overviewHtml).toContain('data-setting-switch="quotaWindowMode"');
            expect(overviewHtml).toContain('data-setting-switch="quotaDirectionMode"');

            // Sessions Hierarchy Tree renders Coordinator -> Worker -> Nested Helper with zero reveal button on swarm workspace
            const topo: SwarmTopologySnapshot = {
                lastSweepAtMs: NOW,
                nodesById: new Map([
                    ['root-coord-1', { cascadeId: 'root-coord-1', rootId: 'root-coord-1', directParentId: null, isCoordinator: true, relationshipKind: 'swarm_member', memberName: 'coordinator', phase: 'WORKING', killed: false, assignedModel: 'Gemini 4 Pro', lastObservedAt: NOW, isOrphan: false, cycleDetected: false, hasConflict: false, isStaleManifest: false }],
                    ['worker-1', { cascadeId: 'worker-1', rootId: 'root-coord-1', directParentId: 'root-coord-1', isCoordinator: false, relationshipKind: 'swarm_member', memberName: 'worker-1', phase: 'WORKING', killed: false, assignedModel: 'Gemini 4 Pro', lastObservedAt: NOW, isOrphan: false, cycleDetected: false, hasConflict: false, isStaleManifest: false }],
                    ['worker-2', { cascadeId: 'worker-2', rootId: 'root-coord-1', directParentId: 'worker-1', isCoordinator: false, relationshipKind: 'nested_helper', memberName: 'nested-helper-1', phase: 'WAITING', killed: false, assignedModel: 'Gemini 4 Flash', lastObservedAt: NOW, isOrphan: false, cycleDetected: false, hasConflict: false, isStaleManifest: false }],
                ]),
                groupsByRootId: new Map([
                    ['root-coord-1', { rootId: 'root-coord-1', title: 'Wave 3B Swarm', coordinatorIds: ['root-coord-1'], memberIds: ['worker-1', 'worker-2'], activeMemberIds: ['root-coord-1', 'worker-1'] }],
                ]),
            };
            const scoped = buildMonitorTabsPayload({
                currentUsage: makeUsage({ cascadeId: 'worker-1' }), swarmTopology: topo, inspectedMemberId: 'worker-1',
            });
            expect(scoped.overview).toContain('id="overviewSwarmStrip"');
            expect(scoped.overview).not.toContain('data-swarm-partial-coverage="true"');
            const unrelated = buildMonitorTabsPayload({ currentUsage: makeUsage({ cascadeId: 'unrelated' }), swarmTopology: topo });
            expect(unrelated.overview).not.toContain('id="overviewSwarmStrip"');
            const trajectories: TrajectorySummary[] = [];
            const sessionsHtml = buildChatHistoryTabContent(trajectories, makeUsage(), makeGMSummary(), undefined, undefined, undefined, {
                swarmTopology: topo,
                swarmOverview,
                inspectedMemberId: 'worker-1',
                lockedRootId: 'root-coord-1',
            });
            expect(sessionsHtml).toContain('id="sessionsSwarmTree"');
            expect(sessionsHtml).toContain('data-swarm-depth="0"');
            expect(sessionsHtml).toContain('data-swarm-depth="1"');
            expect(sessionsHtml).toContain('data-swarm-depth="2"');
            expect(sessionsHtml).not.toContain('data-history-action="workspace"');

            // Long worker name 320px wrapping CSS guard
            expect(getEditorialStyles()).toMatch(/\.swarm-member-name\s*\{[^}]*overflow-wrap:\s*anywhere/);
            expect(buildSwarmLiveStripHtml(null)).toBe('');
        });

        it('keeps a newly expanded member through a poll that arrives before the native toggle event', () => {
            const id = 'swarm-detail-sessions-root-worker';
            const env = createV118ShellVm({ savedState: { detailsOpen: { [id]: false } }, beforeRun: doc => {
                const detail = doc.createElement('details');
                detail.className = 'swarm-member-details';
                detail.setAttribute('id', id);
                doc.getElementById('slot-sessions')!.appendChild(detail);
            } });
            const detail = env.doc.getElementById(id)!;
            detail.open = true;
            env.win.dispatchWin('message', { origin: 'http://127.0.0.1:43210', source: env.win,
                data: { command: 'updateTabs', tabs: { sessions: '<details>new inventory</details>' } } });
            expect(env.getState().detailsOpen).toHaveProperty(id, true);
            detail.remove();
            detail.open = false;
            detail.dispatch('toggle');
            expect(env.getState().detailsOpen).toHaveProperty(id, true);
        });

        it('opens the member overview only when the requested member arrives and restores the Sessions row on exit', () => {
            let showSlow: (() => void) | undefined;
            const env = createV118ShellVm({ onTimer: (fn, ms) => { if (ms === 15000) { showSlow = fn; } } });
            const sessions = env.doc.getElementById('tab-sessions')!;
            const ovPane = env.doc.getElementById('tab-overview')!;
            const update = () => env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210', source: env.win,
                data: { command: 'updateTabs', tabs: {} },
            });
            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210', source: env.win,
                data: { command: 'switchToTab', tab: 'sessions' },
            });
            const details = env.doc.createElement('details');
            details.setAttribute('id', 'swarm-detail-sessions-root-worker');
            const summary = env.doc.createElement('summary');
            summary.setAttribute('id', details.id + '-toggle');
            details.appendChild(summary);
            const action = env.doc.createElement('button');
            action.setAttribute('data-action', 'inspectMember');
            action.setAttribute('data-cascade-id', 'worker');
            details.appendChild(action);
            sessions.appendChild(details);
            const feedback = env.doc.createElement('span');
            feedback.className = 'swarm-inspect-feedback';
            details.appendChild(feedback);
            const cancel = env.doc.createElement('button');
            cancel.setAttribute('data-action', 'cancelMemberNavigation');
            details.appendChild(cancel);
            action.dispatch('click');
            expect(showSlow).toBeTypeOf('function');
            showSlow!();
            expect(feedback.textContent).toContain('Still reading');
            expect(cancel.hidden).toBe(false);
            const banner = env.doc.createElement('div');
            banner.setAttribute('id', 'swarm-inspection-banner');
            banner.setAttribute('data-inspected-member', 'different-member');
            ovPane.appendChild(banner);
            update();
            expect(env.handle.getStatus().activeTab).toBe('sessions');
            banner.setAttribute('data-inspected-member', 'worker');
            env.win.dispatchWin('acm:snapshot', { detail: { snapshot: { tabs: {}, meta: { overlayTargetTab: { seq: 1, tab: 'sessions' } } } } });
            expect(env.handle.getStatus().activeTab).toBe('overview');
            expect(env.doc.activeElement).toBe(banner);
            const back = env.doc.createElement('button');
            back.setAttribute('data-action', 'clearInspect');
            banner.appendChild(back);
            back.dispatch('click');
            ovPane.children = ovPane.children.filter(child => child !== banner);
            update();
            expect(env.handle.getStatus().activeTab).toBe('sessions');
            expect(env.doc.activeElement).toBe(summary);
            // Late snapshots arriving after cancellation or an explicit navigation cannot steal focus.
            action.dispatch('click');
            cancel.dispatch('click');
            expect(env.posted.at(-1)).toEqual({ command: 'clearInspect' });
            ovPane.appendChild(banner);
            update();
            expect(env.handle.getStatus().activeTab).toBe('sessions');
            action.dispatch('click');
            env.win.dispatchWin('message', { origin: 'http://127.0.0.1:43210', source: env.win,
                data: { command: 'switchToTab', tab: 'settings' } });
            showSlow!();
            update();
            expect(env.handle.getStatus().activeTab).toBe('settings');
        });

        it('wires D9 inspect/clearInspect/retarget, Handoff v2 preview, Recovery dismiss, and Wave 3B backup/export commands', () => {
            const env = createV118ShellVm();
            const ovPane = env.doc.getElementById('tab-overview')!;

            const inspectBtn = env.doc.createElement('button');
            inspectBtn.setAttribute('data-action', 'inspectMember');
            inspectBtn.setAttribute('data-cascade-id', 'worker-7');
            ovPane.appendChild(inspectBtn);

            const clearBtn = env.doc.createElement('button');
            clearBtn.setAttribute('data-action', 'clearInspect');
            ovPane.appendChild(clearBtn);

            const retargetBtn = env.doc.createElement('button');
            retargetBtn.setAttribute('data-action', 'retargetLockedRoot');
            retargetBtn.setAttribute('data-cascade-id', 'root-new');
            ovPane.appendChild(retargetBtn);

            const previewBtn = env.doc.createElement('button');
            previewBtn.setAttribute('id', 'previewHandoffV2Btn');
            previewBtn.setAttribute('data-action', 'previewHandoffV2');
            previewBtn.setAttribute('data-cascade-id', 'worker-7');
            previewBtn.setAttribute('data-data-revision', '12');
            ovPane.appendChild(previewBtn);

            const previewBox = env.doc.createElement('section');
            previewBox.setAttribute('id', 'handoffV2PreviewBox');
            previewBox.hidden = true;
            const previewTa = env.doc.createElement('textarea');
            previewTa.setAttribute('id', 'handoffV2PreviewText');
            previewBox.appendChild(previewTa);
            ovPane.appendChild(previewBox);

            const recoveryCard = env.doc.createElement('section');
            recoveryCard.setAttribute('id', 'compactionRecoveryBrief');
            const dismissBtn = env.doc.createElement('button');
            dismissBtn.setAttribute('data-action', 'dismissRecoveryBrief');
            dismissBtn.setAttribute('data-event-key', 'ev-9');
            recoveryCard.appendChild(dismissBtn);
            ovPane.appendChild(recoveryCard);

            const exportBackupBtn = env.doc.createElement('button');
            exportBackupBtn.setAttribute('data-action', 'exportSettingsBackup');
            ovPane.appendChild(exportBackupBtn);

            const exportDiagBtn = env.doc.createElement('button');
            exportDiagBtn.setAttribute('data-action', 'exportRedactedDiagnostics');
            ovPane.appendChild(exportDiagBtn);

            const importInput = env.doc.createElement('textarea');
            importInput.setAttribute('id', 'settingsBackupImportInput');
            importInput.value = '{"schemaVersion":1}';
            ovPane.appendChild(importInput);

            const importBtn = env.doc.createElement('button');
            importBtn.setAttribute('data-action', 'importSettingsBackup');
            ovPane.appendChild(importBtn);

            const calMdBtn = env.doc.createElement('button');
            calMdBtn.setAttribute('data-action', 'calendarExportMarkdown');
            calMdBtn.setAttribute('data-start-date', '2026-11-01');
            calMdBtn.setAttribute('data-end-date', '2026-11-27');
            ovPane.appendChild(calMdBtn);

            inspectBtn.dispatch('click');
            clearBtn.dispatch('click');
            retargetBtn.dispatch('click');
            previewBtn.dispatch('click');
            dismissBtn.dispatch('click');
            exportBackupBtn.dispatch('click');
            exportDiagBtn.dispatch('click');
            importBtn.dispatch('click');
            calMdBtn.dispatch('click');

            expect(env.posted).toContainEqual({ command: 'inspectMember', cascadeId: 'worker-7' });
            expect(env.posted).toContainEqual({ command: 'clearInspect' });
            expect(env.posted).toContainEqual({ command: 'retargetLockedRoot', cascadeId: 'root-new' });
            expect(env.posted).toContainEqual({ command: 'previewHandoffV2', cascadeId: 'worker-7', dataRevision: 12 });
            expect(env.posted).toContainEqual({ command: 'dismissRecoveryBrief', eventKey: 'ev-9' });
            expect(recoveryCard.hidden).toBe(true);
            expect(env.posted).toContainEqual({ command: 'exportSettingsBackup' });
            expect(env.posted).toContainEqual({ command: 'exportRedactedDiagnostics' });
            expect(env.posted).toContainEqual({ command: 'importSettingsBackup', json: '{"schemaVersion":1}' });
            expect(env.posted).toContainEqual({ command: 'calendarExportMarkdown', startDate: '2026-11-01', endDate: '2026-11-27' });

            // Host response populates Handoff v2 preview box
            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210',
                source: env.win,
                data: { command: 'handoffV2PreviewResult', subjectCascadeId: 'worker-7', dataRevision: 12, markdown: '# Ready Handoff' },
            });
            expect(previewBox.hidden).toBe(false);
            expect(previewTa.value).toBe('# Ready Handoff');
        });
    });


    describe('v1.18 A11y (Non-Modal Pinned Popover, Live Region, CSS), Chinese Glossary & Wave 1B Security', () => {
        it('evicts revealed view fragments, tooltip and launcher data immediately on remask and allows masked patches to repopulate slots', () => {
            const env = createV118ShellVm();
            const button = env.doc.createElement('button');
            button.setAttribute('id', 'privacyToggle');
            env.doc.body.appendChild(button);
            button.dispatch('click');
            const overview = env.doc.getElementById('tab-overview')!;
            const slot = env.doc.getElementById('slot-calendar')!;
            slot.setAttribute('data-tab-slot', 'calendar');
            const tip = env.doc.createElement('div');
            tip.setAttribute('id', 'acmRichTipBody');
            env.doc.body.appendChild(tip);
            const launcher = env.doc.createElement('span');
            launcher.setAttribute('id', 'cdpLauncherStatus');
            launcher.setAttribute('data-launcher-path', '/Users/fixture-private/launcher');
            env.doc.body.appendChild(launcher);
            const sensitiveHtml = '<strong title="fixture-private">fixture-private</strong>';
            for (const node of [overview, slot, tip, launcher]) { node.innerHTML = sensitiveHtml; }
            button.dispatch('click');
            for (const node of [overview, slot, tip, launcher]) { expect(node.innerHTML).toBe(''); }
            expect(launcher.getAttribute('data-launcher-path')).toBeNull();
            env.win.dispatchWin('message', {
                origin: env.win.location.origin, source: env.win,
                data: { command: 'updateTabs', privacyMasked: true, tabs: { calendar: '<strong>Project #1</strong>' } },
            });
            expect(slot.innerHTML).toBe('<strong>Project #1</strong>');
        });

        it('distinguishes hover tooltip from pinned non-modal dialog, restores focus safely on Esc, and allows Tab exit', () => {
            const env = createV118ShellVm();
            const ovPane = env.doc.getElementById('tab-overview')!;

            const trig = env.doc.createElement('button');
            trig.setAttribute('class', 'jargon-tip');
            trig.setAttribute('data-popover-key', 'overview:jargon:ttft');
            trig.setAttribute('data-tip-title', 'TTFT');
            trig.setAttribute('data-tip-body', 'Time to first token.');
            trig.setAttribute('data-tip-pin', 'true');
            ovPane.appendChild(trig);

            // 1. Hover -> pure non-interactive role="tooltip"
            trig.dispatch('mouseover');
            const pop = env.doc.getElementById('acmRichTipPopover')!;
            expect(pop.hidden).toBe(false);
            expect(pop.getAttribute('role')).toBe('tooltip');
            expect(pop.getAttribute('aria-modal')).toBeNull();

            // 2. Keyboard Enter pins -> role="dialog" aria-modal="false" and focuses close button inside dialog
            trig.focus();
            env.doc.dispatch('keydown', { key: 'Enter' });
            expect(pop.getAttribute('role')).toBe('dialog');
            expect(pop.getAttribute('aria-modal')).toBe('false');
            expect(pop.getAttribute('data-pinned')).toBe('true');
            expect(env.doc.activeElement).toBe(env.doc.getElementById('acmRichTipClose'));

            // 3. Esc returns focus to surviving trigger
            env.doc.dispatch('keydown', { key: 'Escape' });
            expect(pop.hidden).toBe(true);
            expect(env.doc.activeElement).toBe(trig);

            // 4. Pin again, then simulate incremental DOM replacement of trigger by matching data-popover-key -> Esc returns focus to replacement trigger
            trig.focus();
            env.doc.dispatch('keydown', { key: 'Enter' });
            trig.remove();
            const trigReplacement = env.doc.createElement('button');
            trigReplacement.setAttribute('class', 'jargon-tip');
            trigReplacement.setAttribute('data-popover-key', 'overview:jargon:ttft');
            trigReplacement.setAttribute('data-tip-title', 'TTFT');
            trigReplacement.setAttribute('data-tip-body', 'Updated TTFT');
            ovPane.appendChild(trigReplacement);
            env.doc.dispatch('keydown', { key: 'Escape' });
            expect(pop.hidden).toBe(true);
            expect(env.doc.activeElement).toBe(trigReplacement);

            // 5. Pin again, then remove trigger completely without replacement -> Esc falls back to active section heading (#overview-heading)
            trigReplacement.focus();
            env.doc.dispatch('keydown', { key: 'Enter' });
            trigReplacement.remove();
            env.doc.dispatch('keydown', { key: 'Escape' });
            expect(pop.hidden).toBe(true);
            expect(env.doc.activeElement).toBe(env.doc.getElementById('overview-heading'));

            // 6. Ordinary Tab exit (focusout to an outside element) closes non-modal dialog cleanly without trapping focus
            const trig2 = env.doc.createElement('button');
            trig2.setAttribute('class', 'jargon-tip');
            trig2.setAttribute('data-tip-title', 'Cost');
            trig2.setAttribute('data-tip-body', 'API reference cost.');
            trig2.setAttribute('data-tip-pin', 'true');
            ovPane.appendChild(trig2);
            const outsideBtn = env.doc.createElement('button');
            ovPane.appendChild(outsideBtn);

            trig2.focus();
            env.doc.dispatch('keydown', { key: 'Enter' });
            expect(pop.hidden).toBe(false);
            env.doc.getElementById('acmRichTipClose')!.dispatch('focusout', { relatedTarget: outsideBtn });
            expect(pop.hidden).toBe(true);
        });

        it('announces meaningful state changes via #acmLiveRegion, enforces forced Chinese glossary, and preserves Wave 1B security', async () => {
            const env = createV118ShellVm();
            // Tab switch announces
            env.doc.getElementById('tabBtn-models')!.dispatch('click');
            expect(env.liveRegion.textContent).toContain('models');

            // Lock toggle announces
            env.doc.getElementById('lockMainBtn')!.dispatch('click');
            expect(env.liveRegion.textContent.length).toBeGreaterThan(0);

            // Trusted setPaused announces; untrusted cross-origin message is rejected!
            const beforeText = env.liveRegion.textContent;
            env.win.dispatchWin('message', {
                origin: 'https://evil.example',
                source: env.win,
                data: { command: 'setPaused', paused: true },
            });
            expect(env.liveRegion.textContent).toBe(beforeText);
            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210',
                source: env.win,
                data: { command: 'setPaused', paused: true },
            });
            expect(env.liveRegion.textContent).not.toBe(beforeText);

            // Settings saved & backup imported announce; incremental update with TTL badge never spams live region
            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210',
                source: env.win,
                data: { command: 'configSaved', key: 'contextPctBasis' },
            });
            const afterSaveText = env.liveRegion.textContent;
            expect(afterSaveText.length).toBeGreaterThan(0);

            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210',
                source: env.win,
                data: { command: 'updateTabs', tabs: { overview: '<span data-cache-ttl-state="warm" data-ttl-remaining-sec="241">Warm · 4:01</span>' } },
            });
            expect(env.liveRegion.textContent).toBe(afterSaveText);

            // Wave 1B privacy mask toggle & opaque accountHandle preserved
            const privBtn = env.doc.createElement('button');
            privBtn.setAttribute('id', 'privacyToggle');
            env.doc.body.appendChild(privBtn);
            privBtn.dispatch('click');
            expect(env.posted).toContainEqual({ command: 'setPrivacyMask', masked: false, privacyMasked: false });

            const delAcctBtn = env.doc.createElement('button');
            delAcctBtn.setAttribute('class', 'acct-delete-btn');
            delAcctBtn.setAttribute('data-account-handle', 'acct_opaque_123');
            env.doc.body.appendChild(delAcctBtn);
            delAcctBtn.dispatch('click');
            expect(env.posted).toContainEqual({ command: 'removeAccount', accountHandle: 'acct_opaque_123' });

            // CSS A11y rules present
            const editorialCss = getEditorialStyles();
            expect(editorialCss).toContain('@media (pointer: coarse)');
            expect(editorialCss).toContain('@media (prefers-reduced-motion: reduce)');
            expect(editorialCss).toContain('@media (forced-colors: active)');

            // All 8 mandatory Chinese glossary terms present in ZH document; zero forbidden terms across all owned UI outputs
            await setLanguageToState('zh', memState);
            const zhHtml = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                data: makeUsage(),
                modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon', 0.65, 0.45)],
                gmSummary: makeGMSummary(),
                sessionCostUsd: 0.42,
                todayCostUsd: 1.2,
                now: NOW,
            });
            for (const term of ['账号', '配额', '费用', '冷启动', '首字延迟', '模型调用', '原生窗口上限', '冻结面板']) {
                expect(zhHtml, `missing mandatory Chinese glossary term: ${term}`).toContain(term);
            }
            const zhOverview = buildOverviewTabContent(
                makeUsage(),
                [makeConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon', 0.65, 0.45)],
                null,
                0,
                { state: 'active' },
                NOW,
                { gmSummary: makeGMSummary(), sessionCostUsd: 0.42, todayCostUsd: 1.2 },
            );
            const zhSessions = buildChatHistoryTabContent([], makeUsage(), makeGMSummary());
            const zhScript = getScript();
            const topbarSlice = zhHtml.slice(zhHtml.indexOf('<div class="panel-topbar">'), zhHtml.indexOf('<main id="monitor-content">'));
            for (const [label, chunk] of [['overview', zhOverview], ['sessions', zhSessions], ['topbar', topbarSlice], ['script', zhScript]] as const) {
                expect(chunk, `forbidden term 额度 in ${label}`).not.toContain('额度');
                expect(chunk, `forbidden term 账户 in ${label}`).not.toContain('账户');
                expect(chunk, `forbidden term 令牌 in ${label}`).not.toContain('令牌');
            }
        });

        it('filters Model Calls anomaly rows via [data-action="gmFilterAnomaly"] and restores filter across mount & morphs', () => {
            const buildRecentCallsCard = (doc: MiniDoc) => {
                const card = doc.createElement('div');
                card.setAttribute('class', 'recent-calls-card');
                const bar = doc.createElement('div');
                bar.setAttribute('class', 'gm-anomaly-bar');
                bar.setAttribute('data-gm-anomaly-bar', 'true');
                bar.setAttribute('data-active-anomaly-filter', 'all');
                card.appendChild(bar);

                const pills: Record<string, MiniEl> = {};
                for (const kind of ['all', 'any', 'error_or_retry', 'slow_ttft', 'zero_output']) {
                    const btn = doc.createElement('button');
                    btn.setAttribute('class', kind === 'all' ? 'gm-anomaly-pill is-active' : 'gm-anomaly-pill');
                    btn.setAttribute('data-action', 'gmFilterAnomaly');
                    btn.setAttribute('data-anomaly-kind', kind);
                    btn.setAttribute('aria-pressed', kind === 'all' ? 'true' : 'false');
                    bar.appendChild(btn);
                    pills[kind] = btn;
                }

                const makeRow = (anomalies: string, hasAnomaly: boolean) => {
                    const tr = doc.createElement('tr');
                    tr.setAttribute('data-gm-anomalies', anomalies);
                    tr.setAttribute('data-has-anomaly', hasAnomaly ? 'true' : 'false');
                    card.appendChild(tr);
                    return tr;
                };
                const rowOk = makeRow('', false);
                const rowSlow = makeRow('slow_ttft', true);
                const rowErrCost = makeRow('error_or_retry,high_cost', true);
                const rowZero = makeRow('zero_output', true);
                return { card, bar, pills, rows: { rowOk, rowSlow, rowErrCost, rowZero } };
            };

            // 1. Mount restores previously saved gmAnomalyFilter immediately
            let initialCard!: ReturnType<typeof buildRecentCallsCard>;
            const env = createV118ShellVm({
                savedState: { gmAnomalyFilter: 'error_or_retry' },
                beforeRun: (doc) => {
                    initialCard = buildRecentCallsCard(doc);
                    doc.getElementById('slot-gm')!.appendChild(initialCard.card);
                },
            });
            expect(initialCard.bar.getAttribute('data-active-anomaly-filter')).toBe('error_or_retry');
            expect(initialCard.pills.error_or_retry.classList.contains('is-active')).toBe(true);
            expect(initialCard.pills.error_or_retry.getAttribute('aria-pressed')).toBe('true');
            expect(initialCard.pills.all.classList.contains('is-active')).toBe(false);
            expect(initialCard.rows.rowOk.hidden).toBe(true);
            expect(initialCard.rows.rowSlow.hidden).toBe(true);
            expect(initialCard.rows.rowErrCost.hidden).toBe(false);
            expect(initialCard.rows.rowZero.hidden).toBe(true);

            // 2. Click 'any' shows all anomalous rows & persists state
            initialCard.pills.any.dispatch('click');
            expect(env.getState().gmAnomalyFilter).toBe('any');
            expect(initialCard.bar.getAttribute('data-active-anomaly-filter')).toBe('any');
            expect(initialCard.pills.any.getAttribute('aria-pressed')).toBe('true');
            expect(initialCard.rows.rowOk.hidden).toBe(true);
            expect(initialCard.rows.rowSlow.hidden).toBe(false);
            expect(initialCard.rows.rowErrCost.hidden).toBe(false);
            expect(initialCard.rows.rowZero.hidden).toBe(false);

            // 3. Click specific kind 'slow_ttft'
            initialCard.pills.slow_ttft.dispatch('click');
            expect(env.getState().gmAnomalyFilter).toBe('slow_ttft');
            expect(initialCard.rows.rowOk.hidden).toBe(true);
            expect(initialCard.rows.rowSlow.hidden).toBe(false);
            expect(initialCard.rows.rowErrCost.hidden).toBe(true);
            expect(initialCard.rows.rowZero.hidden).toBe(true);

            // 4. Incremental update morphs fresh card -> saved 'slow_ttft' filter is restored automatically
            initialCard.card.remove();
            const refreshed = buildRecentCallsCard(env.doc);
            env.doc.getElementById('slot-gm')!.appendChild(refreshed.card);
            env.win.dispatchWin('message', {
                origin: 'http://127.0.0.1:43210',
                source: env.win,
                data: { command: 'updateTabs', tabs: {} },
            });
            expect(refreshed.bar.getAttribute('data-active-anomaly-filter')).toBe('slow_ttft');
            expect(refreshed.pills.slow_ttft.classList.contains('is-active')).toBe(true);
            expect(refreshed.pills.slow_ttft.getAttribute('aria-pressed')).toBe('true');
            expect(refreshed.rows.rowOk.hidden).toBe(true);
            expect(refreshed.rows.rowSlow.hidden).toBe(false);
            expect(refreshed.rows.rowErrCost.hidden).toBe(true);

            // 5. Click 'all' shows all rows and clears hidden attribute
            refreshed.pills.all.dispatch('click');
            expect(env.getState().gmAnomalyFilter).toBe('all');
            expect(refreshed.rows.rowOk.hidden).toBe(false);
            expect(refreshed.rows.rowOk.hasAttribute('hidden')).toBe(false);
            expect(refreshed.rows.rowSlow.hidden).toBe(false);
            expect(refreshed.rows.rowErrCost.hidden).toBe(false);
            expect(refreshed.rows.rowZero.hidden).toBe(false);
        });

        it('routes importSettingsBackup through bridge.sendAction in App Sidecar, falls back to postMessage in IDE, and always resets file input', async () => {
            // 1. App Sidecar bridge mode
            const bridgeCalls: Array<Record<string, unknown>> = [];
            let nextBridgeResponse: Promise<Record<string, unknown>> = Promise.resolve({ result: { ok: true } });
            const sidecarEnv = createV118ShellVm({
                surface: 'app-sidecar',
                bridge: {
                    surface: 'app-sidecar',
                    isTrustedHostEvent: () => true,
                    sendAction: (payload: Record<string, unknown>) => {
                        bridgeCalls.push(payload);
                        return nextBridgeResponse;
                    },
                },
            });
            const feedbackEl = sidecarEnv.doc.createElement('span');
            feedbackEl.setAttribute('id', 'settingsBackupFeedback');
            sidecarEnv.doc.body.appendChild(feedbackEl);

            const textarea = sidecarEnv.doc.createElement('textarea');
            textarea.setAttribute('id', 'settingsBackupImportInput');
            textarea.value = '{"schemaVersion":1,"settings":{"languagePreference":"zh"}}';
            sidecarEnv.doc.body.appendChild(textarea);

            const importBtn = sidecarEnv.doc.createElement('button');
            importBtn.setAttribute('data-action', 'importSettingsBackup');
            sidecarEnv.doc.body.appendChild(importBtn);

            importBtn.dispatch('click');
            await new Promise((r) => setTimeout(r, 0));
            expect(bridgeCalls).toHaveLength(1);
            expect(bridgeCalls[0]).toEqual({
                command: 'importSettingsBackup',
                json: '{"schemaVersion":1,"settings":{"languagePreference":"zh"}}',
            });
            expect(sidecarEnv.posted.filter((m) => m.command === 'importSettingsBackup')).toHaveLength(0);
            expect(feedbackEl.textContent.length).toBeGreaterThan(0);
            expect(sidecarEnv.liveRegion.textContent).toBe(feedbackEl.textContent);

            // Bridge error result surfaces custom error text
            nextBridgeResponse = Promise.resolve({ result: { ok: false, error: 'Unsupported backup schema' } });
            const fileInput = sidecarEnv.doc.createElement('input');
            fileInput.setAttribute('id', 'settingsBackupFileInput');
            fileInput.setAttribute('type', 'file');
            fileInput.value = 'C:\\fakepath\\backup.json';
            fileInput.files = [{ size: 42, text: async () => '{"schemaVersion":99}' }];
            sidecarEnv.doc.body.appendChild(fileInput);

            fileInput.dispatch('change');
            await new Promise((r) => setTimeout(r, 0));
            expect(fileInput.value).toBe('');
            expect(bridgeCalls).toHaveLength(2);
            expect(feedbackEl.textContent).toBe('Unsupported backup schema');
            expect(sidecarEnv.liveRegion.textContent).toBe('Unsupported backup schema');

            // Oversized (>64KB) file resets fileInput.value and fails without calling bridge
            fileInput.value = 'C:\\fakepath\\huge.json';
            fileInput.files = [{ size: 70000, text: async () => '{}' }];
            fileInput.dispatch('change');
            expect(fileInput.value).toBe('');
            expect(bridgeCalls).toHaveLength(2);

            // Rejected file.text() resets fileInput.value cleanly
            fileInput.value = 'C:\\fakepath\\broken.json';
            fileInput.files = [{ size: 12, text: async () => { throw new Error('read failed'); } }];
            fileInput.dispatch('change');
            await new Promise((r) => setTimeout(r, 0));
            expect(fileInput.value).toBe('');
            expect(bridgeCalls).toHaveLength(2);

            // 2. IDE mode (no non-vscode bridge) posts via vscode.postMessage and resets file input
            const ideEnv = createV118ShellVm({ surface: 'ide' });
            const ideFile = ideEnv.doc.createElement('input');
            ideFile.setAttribute('id', 'settingsBackupFileInput');
            ideFile.setAttribute('type', 'file');
            ideFile.value = 'C:\\fakepath\\ide-backup.json';
            ideFile.files = [{ size: 24, text: async () => '{"schemaVersion":1}' }];
            ideEnv.doc.body.appendChild(ideFile);
            ideFile.dispatch('change');
            await new Promise((r) => setTimeout(r, 0));
            expect(ideFile.value).toBe('');
            expect(ideEnv.posted).toContainEqual({ command: 'importSettingsBackup', json: '{"schemaVersion":1}' });
        });
    });
});

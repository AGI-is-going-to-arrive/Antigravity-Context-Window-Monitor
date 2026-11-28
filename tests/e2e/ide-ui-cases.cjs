/* Modular E2E UI Assertion Suites for Antigravity Context Monitor (v1.18.0).
 *
 * Covers:
 *   - 5-tab IA (`overview`, `gm`, `sessions`, `calendar`, `models`) + topbar `⚙️`/`ⓘ`
 *   - D9 Swarm Coordinator + 20+ workers (Inspect / Back to Main / Retarget / Pending-Unavailable)
 *   - Plan C features (Cache 5m TTL, Decode/E2E speed + measured-only phase bars,
 *     GM Anomaly Filter Bar, Weekly Active-Hours Forecast + Insufficient history,
 *     Zero-Day Unknown Model, Workspace Leaderboard + Unattributed, Swarm Group Cost,
 *     Plan ROI collapsed disclaimer, Handoff v2 preview, Compaction Recovery Brief,
 *     Settings 5 logical groups + backup/diagnostics + 10 currencies incl. CAD,
 *     Native HUD auto-hide on Overview, per-view 479/480/481 compact language)
 *   - Dual-side host + browser fixed-clock verification across BOTH `2026-11-30T12:00:00Z`
 *     (pre-change Carbon/Argon intro $2/$10 + banner) and `2026-12-02T12:00:00Z`
 *     (post-change Carbon/Argon standard $4/$20 + banner removed)
 *   - Strict destructive-action isolation guard (Clear Calendar History ONLY runs
 *     against an asserted throwaway temp fixture directory, NEVER live IDE or ~/.gemini).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./ide-ui-harness.cjs');

const {
    MAIN_TABS,
    UTILITY_VIEWS,
    ALL_VIEWS,
    LANGUAGES,
    LANGUAGE_BUTTONS,
    FORBIDDEN_CHINESE_GLOSSARY_RE,
    FORBIDDEN_COMPLIANCE_RE,
    NEON_IDENTITIES,
    GEMINI4_CHECKPOINTER_IDS,
    THEME_TOKENS,
    SCREENSHOT_FILENAMES,
    CLOCK_REGIMES,
    localizedEffortLabel,
    neonLabel,
    resolveViewId,
    resolveScreenshotThemes,
    assertCoolNeutralRgb,
    parseFixedClockIso,
    withHostFixedClock,
    browserFixture,
    assertDestructiveActionAllowed,
    createIsolatedFixtureEnv,
    createDesktopClient,
    createBrowserSession,
    loadInstalledPanel,
} = harness;

// ─── Rich Deterministic v1.18.0 Fixtures (Driven Strictly by `nowMs`) ─────────

function buildEditorialFixtures(usage, specs, modules, resetTime, nowMs, fixtureEnv) {
    const now = new Date(nowMs);
    const createdAt = now.toISOString();
    const earlierIso = new Date(now.getTime() - 12 * 60_000).toISOString();
    const expiredIso = new Date(now.getTime() - 60_000).toISOString();
    const weeklyResetTime = new Date(now.getTime() + 5 * 24 * 3600_000).toISOString();
    const workspaceUri = 'file:///example/workspaces/monitor';
    const otherWorkspaceUri = 'file:///example/workspaces/docs-site';
    const stateFilePath = fixtureEnv
        ? fixtureEnv.statePath
        : '/example/storage/antigravity-monitor-state.json';

    const currentUsage = {
        ...usage,
        cascadeId: 'root-coord-1',
        repositoryName: 'monitor',
        branchName: 'release',
        title: 'Review release changes',
        contextUsed: 214500,
        contextLimit: 512000,
        isEstimated: false,
        hasGaps: false,
        compressionDetected: false,
        previousContextUsed: undefined,
        checkpointCompressionDrop: 0,
        orchestratorConfig: {
            planModel: 'MODEL_PLACEHOLDER_M401',
            executionModel: 'MODEL_PLACEHOLDER_M528',
        },
    };

    const orchestratorSettingsDefault = {
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

    const orchestratorSettingsCustom = {
        ...orchestratorSettingsDefault,
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

    const orchestratorSettingsCustomSonnet = {
        ...orchestratorSettingsDefault,
        configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        configuredExecutorModel: 'MODEL_PLACEHOLDER_M404',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M404',
        effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
        effectiveExecutorLabel: 'Claude Sonnet 5.5 (Medium)',
        isCustomOrchestrator: true,
        isCustomExecutor: true,
        mode: 'custom',
    };

    const quotaSummary = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.52,
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.84,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
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
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.96,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
                },
                buckets: [],
            },
        ],
    };

    const quotaSummaryPrecision = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.9936607,
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.9984152,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
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
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 1,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
                },
                buckets: [],
            },
        ],
    };

    const allTrajectories = [
        { id: currentUsage.cascadeId, title: currentUsage.title, model: specs[0], status: 'RUNNING', ws: workspaceUri, repo: 'monitor', branch: 'release', time: createdAt },
        { id: 'test-another-session', title: 'Check quota display', model: specs[1], status: 'IDLE', ws: workspaceUri, repo: 'monitor', branch: 'main', time: earlierIso },
        { id: 'test-other-workspace', title: 'Audit documentation links', model: specs[1], status: 'FINISHED', ws: otherWorkspaceUri, repo: 'docs-site', branch: 'docs', time: earlierIso },
    ].map(({ id, title, model, status, ws, repo, branch, time }) => ({
        cascadeId: id,
        summary: title,
        requestedModel: model.placeholderId,
        generatorModel: model.placeholderId,
        workspaceUris: [ws],
        gitRootUri: ws,
        repositoryName: repo,
        branchName: branch,
        status: `CASCADE_STATUS_${status}`,
        stepCount: 8,
        createdTime: time,
        lastModifiedTime: time,
        lastUserInputTime: time,
    }));

    const convCallProfiles = [
        [
            { inputTokens: 12000, outputTokens: 1120, thinkingTokens: 380, responseTokens: 740, cacheReadTokens: 0, cacheCreationTokens: 0, ttftSeconds: 2.15, streamingSeconds: 16.0, offsetMs: -90_000, hasError: false, stopReason: 'STOP_REASON_END_TURN' },
            { inputTokens: 5500, outputTokens: 1320, thinkingTokens: 420, responseTokens: 900, cacheReadTokens: 28000, cacheCreationTokens: 0, ttftSeconds: 0.80, streamingSeconds: 16.5, offsetMs: -45_000, hasError: false, stopReason: 'STOP_REASON_END_TURN' },
            { inputTokens: 5000, outputTokens: 1560, thinkingTokens: 520, responseTokens: 1040, cacheReadTokens: 32000, cacheCreationTokens: 0, ttftSeconds: 0.76, streamingSeconds: 18.0, offsetMs: 0, hasError: false, stopReason: 'STOP_REASON_END_TURN' },
        ],
        [
            { inputTokens: 10000, outputTokens: 960, thinkingTokens: 320, responseTokens: 640, cacheReadTokens: 0, cacheCreationTokens: 6000, ttftSeconds: 2.25, streamingSeconds: 15.0, offsetMs: -12 * 60_000, hasError: false, stopReason: 'STOP_REASON_END_TURN' },
            { inputTokens: 5200, outputTokens: 1120, thinkingTokens: 360, responseTokens: 760, cacheReadTokens: 28000, cacheCreationTokens: 0, ttftSeconds: 0.79, streamingSeconds: 16.0, offsetMs: -11 * 60_000, hasError: false, stopReason: 'STOP_REASON_END_TURN' },
            { inputTokens: 4800, outputTokens: 1200, thinkingTokens: 400, responseTokens: 800, cacheReadTokens: 30000, cacheCreationTokens: 0, ttftSeconds: 0.77, streamingSeconds: 16.0, offsetMs: -10 * 60_000, hasError: false, stopReason: 'STOP_REASON_END_TURN' },
        ],
    ];

    const gmSummary = modules.buildSummaryFromConversations(allTrajectories.slice(0, 2).map((trajectory, index) => {
        const model = specs[index];
        const calls = convCallProfiles[index].map((profile, step) => {
            const hasRetry = index === 0 && step === 1;
            const callIso = new Date(now.getTime() + profile.offsetMs).toISOString();
            return {
                stepIndices: [step],
                executionId: `${trajectory.cascadeId}-${step}`,
                model: model.placeholderId,
                modelDisplay: model.displayName,
                responseModel: model.modelId,
                modelAccuracy: 'exact',
                inputTokens: profile.inputTokens,
                outputTokens: profile.outputTokens,
                thinkingTokens: profile.thinkingTokens,
                responseTokens: profile.responseTokens,
                cacheReadTokens: profile.cacheReadTokens,
                cacheCreationTokens: profile.cacheCreationTokens,
                apiProvider: model.apiProvider,
                ttftSeconds: profile.ttftSeconds,
                streamingSeconds: profile.streamingSeconds,
                credits: 2,
                creditType: 'AI',
                hasError: profile.hasError,
                errorMessage: '',
                contextTokensUsed: 74000 + 3000 * step,
                completionConfig: {
                    maxTokens: 65536, temperature: 0.7, firstTemperature: 0.7,
                    topK: 40, topP: 0.95, numCompletions: 1, stopPatternCount: 2,
                },
                systemPromptSnippet: 'Studio telemetry monitor test prompt',
                toolCount: 3,
                toolNames: ['read_file', 'search', 'replace_file_content'],
                promptSectionTitles: ['Identity', 'Tools', 'Workspace'],
                promptSnippet: '',
                promptSource: 'messagePrompts',
                messagePromptCount: 2,
                messageMetadataKeys: [],
                responseHeaderKeys: [],
                userMessageAnchors: [],
                aiSnippetsByStep: {},
                retries: hasRetry ? 1 : 0,
                stopReason: profile.stopReason,
                retryTokensIn: hasRetry ? 1200 : 0,
                retryTokensOut: hasRetry ? 100 : 0,
                retryCredits: 0,
                retryErrors: hasRetry ? ['RESOURCE_EXHAUSTED (code 429): Rate limit exceeded; retrying automatically after backoff.'] : [],
                timeSinceLastInvocation: 0,
                tokenBreakdownGroups: index === 0 && step === 2 ? [
                    { name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM_PROMPT', tokens: 12000, children: [{ name: 'Tool Definitions', tokens: 8000 }] },
                    { name: 'Conversation', type: 'TOKEN_TYPE_CHAT_MESSAGES', tokens: 68000, children: [] },
                ] : [],
                createdAt: callIso,
                latestStableMessageIndex: 0,
                startStepIndex: step,
                checkpointIndex: 0,
                checkpointSummaries: [],
                systemContextItems: index === 0 && step === 2 ? [{
                    type: 'user_rules', stepIndex: step, tokens: 640,
                    label: 'User Rules', fullText: 'Prefer concise telemetry tables and strict contrast.',
                }] : [],
                accountEmail: 'sample@example.invalid',
                toolCallsByStep: { [step]: ['read_file'] },
                contextWindowCapacity: 512000,
            };
        });
        return {
            cascadeId: trajectory.cascadeId,
            title: trajectory.summary,
            totalSteps: trajectory.stepCount,
            calls,
            checkpointSummaries: [],
        };
    }), createdAt);

    gmSummary.toolCallCounts = { read_file: 5, search: 3, replace_file_content: 2 };
    gmSummary.toolCatalog = [
        { name: 'read_file', firstSeen: createdAt },
        { name: 'search', firstSeen: createdAt },
        { name: 'replace_file_content', firstSeen: createdAt },
    ];
    gmSummary.uniqueErrors = [{
        code: '429',
        message: 'RESOURCE_EXHAUSTED (code 429): Rate limit exceeded; retrying automatically after backoff.',
        firstSeen: createdAt,
        count: 1,
    }];

    const activitySummary = {
        totalUserInputs: 1, totalReasoning: 2, totalToolCalls: 2, totalErrors: 0, totalCheckpoints: 0,
        totalInputTokens: 42500, totalOutputTokens: 7280, totalToolReturnTokens: 1400, estSteps: 0,
        modelStats: {}, globalToolStats: { read_file: 5, search: 3 },
        recentSteps: [
            {
                timestamp: earlierIso, icon: '💬', category: 'user', model: '',
                detail: 'Review release changes', durationMs: 0, cascadeId: currentUsage.cascadeId,
                userInput: 'Review release changes before packaging', stepIndex: 1,
            },
            {
                timestamp: createdAt, icon: '🧠', category: 'reasoning', model: specs[0].displayName,
                detail: 'Analyzed diff → 2 tools', durationMs: 18760, cascadeId: currentUsage.cascadeId,
                aiResponse: 'Checked quota pools and typography tokens.', stepIndex: 2,
                gmInputTokens: 5000, gmOutputTokens: 1560, gmThinkingTokens: 520, gmCacheReadTokens: 32000,
                gmCredits: 2, gmTTFT: 0.76, gmStreamingDuration: 18.0, gmRetries: 1,
                gmModel: specs[0].modelId, gmContextTokensUsed: 74000,
            },
            {
                timestamp: createdAt, icon: '📄', category: 'tool', model: specs[0].displayName,
                detail: 'src/webview-editorial-styles.ts', durationMs: 145, cascadeId: currentUsage.cascadeId,
                toolName: 'read_file', stepIndex: 3,
            },
        ],
        sessionStartTime: earlierIso, subAgentTokens: [], checkpointHistory: [], conversationBreakdown: [],
    };

    const dailyStore = new modules.DailyStore();
    const dayNumbers = [...new Set([1, 3, 7, now.getDate()])];
    const records = Object.fromEntries(dayNumbers.map((day, idx) => {
        const date = new Date(now.getFullYear(), now.getMonth(), day, 12);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const calls = 20 + day;
        const primaryCycle = {
            startTime: date.toISOString(), endTime: date.toISOString(), totalReasoning: calls,
            totalToolCalls: 6, totalErrors: 0, totalInputTokens: 45000, totalOutputTokens: 10000,
            estSteps: 0, modelNames: [specs[1].displayName], estimatedCost: 0.22 + day / 100,
            gmTotalCalls: calls, gmTotalCredits: calls, gmTotalTokens: 55000,
            sources: ['ide'],
            gmModelStats: {
                [specs[1].displayName]: {
                    calls, credits: calls, inputTokens: 45000,
                    outputTokens: 10000, thinkingTokens: 4000,
                    cacheReadTokens: 120000, cacheCreationTokens: 5000,
                    avgTTFT: 0.84, avgGenTokPerSec: 68.4,
                    cacheHitRate: 0.8, tokenCacheHitRate: 120000 / (45000 + 120000 + 5000),
                },
            },
            ...(idx === 0 ? {
                workspaceBreakdown: {
                    '/example/workspaces/monitor': {
                        calls,
                        inputTokens: 45000,
                        outputTokens: 10000,
                        thinkingTokens: 4000,
                        cacheReadTokens: 120000,
                        cacheCreationTokens: 5000,
                        credits: calls,
                        knownCostUsd: 0.22 + day / 100,
                        unpricedCalls: 1,
                    },
                },
            } : {}),
        };
        return [dateKey, { date: dateKey, cycles: [primaryCycle] }];
    }));
    dailyStore.restoreSnapshot({ version: 1, records });

    const storageDiagnostics = {
        stateFilePath,
        stateFileExists: true,
        stateFileSizeBytes: 18432,
        stateFileOpenWarnBytes: 1024 * 1024,
        calendarDayCount: dayNumbers.length,
    };

    const accountSnapshots = [
        {
            email: 'sample@example.invalid',
            accountHandle: 'acct_sample_opaque_01',
            name: 'Sample account',
            planName: 'Pro',
            tierName: 'Google AI Pro',
            earliestResetTime: resetTime,
            allResetTimes: [resetTime],
            resetPools: [
                { resetTime, modelLabels: ['Gemini 4 Neon', 'Orchestrator (Neon)'], remainingPercent: 52, hasUsage: true },
                { resetTime, modelLabels: ['Claude Opus 5.5'], remainingPercent: 91, hasUsage: true },
            ],
            isActive: true,
            lastSeen: createdAt,
            credits: [
                { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 1200 },
                { creditType: 'GOOGLE_ONE_AI', creditAmount: 1200 },
                { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 8765 },
                { creditType: 'CREDIT_TYPE_FLOW', creditAmount: 7654 },
            ],
        },
        {
            email: 'backup@example.invalid',
            accountHandle: 'acct_backup_opaque_02',
            name: 'Backup account',
            planName: 'Free',
            tierName: 'Free',
            earliestResetTime: expiredIso,
            allResetTimes: [expiredIso],
            resetPools: [
                { resetTime: expiredIso, modelLabels: ['Gemini 4 Neon'], remainingPercent: 100, hasUsage: true },
            ],
            isActive: false,
            lastSeen: earlierIso,
            credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null }],
        },
    ];

    const userInfo = {
        name: 'Sample account',
        email: 'sample@example.invalid',
        planName: 'Pro',
        userTierName: 'Google AI Pro',
        defaultModelLabel: 'Orchestrator (Neon)',
        modelSortOrder: [],
        planLimits: {
            maxNumChatInputTokens: 512000, maxNumPremiumChatMessages: 100, maxCustomChatInstructionCharacters: 12000,
            maxNumPinnedContextItems: 25, maxLocalIndexSize: 4000, monthlyFlexCreditPurchaseAmount: 0,
        },
        teamConfig: { allowMcpServers: true, allowAutoRunCommands: false, allowBrowserExperimentalFeatures: false },
        availableCredits: [
            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 1200, minimumCreditAmountForUsage: 0 },
            { creditType: 'GOOGLE_ONE_AI', creditAmount: 1200, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 8765, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_FLOW', creditAmount: 7654, minimumCreditAmountForUsage: 0 },
        ],
        monthlyPromptCredits: 100, availablePromptCredits: 76, monthlyFlowCredits: 100, availableFlowCredits: 82,
    };

    const unknownCreditsUserInfo = {
        ...userInfo,
        availableCredits: [
            { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 8765, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_FLOW', creditAmount: 7654, minimumCreditAmountForUsage: 0 },
        ],
    };

    // v1.18.0 D9 Swarm (Coordinator + 21 Workers = 22 members) & Plan C extras
    const swarmMembers = Array.from({ length: 22 }, (_, idx) => ({
        cascadeId: idx === 0 ? 'root-coord-1' : `swarm-worker-${idx}`,
        memberName: idx === 0
            ? 'coordinator'
            : (idx === 1 ? 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef' : `worker-${idx}`),
        isCoordinator: idx === 0,
        role: idx === 0 ? 'Coordinator' : 'Worker',
        relationshipKind: idx === 2 ? 'nested_helper' : 'swarm_member',
        phase: idx === 1 ? 'WORKING' : (idx === 21 ? 'KILLED' : 'WAITING'),
        killed: idx === 21,
        assignedModel: 'Gemini 4 Neon',
        measuredModel: idx === 1 ? 'Claude Opus 5.5' : null,
        contextPct: idx === 1 ? 82 : (20 + (idx % 40)),
        directCostUsd: idx === 1 ? 1.15 : 0.10,
        unpricedCalls: idx === 1 ? 1 : 0,
        lastObservedAt: idx < 18 ? nowMs - 4_000 : null,
        isInspected: idx === 1,
        isLockedRoot: idx === 0,
    }));

    const swarmOverview = {
        rootId: 'root-coord-1',
        title: 'Release Verification Swarm',
        members: swarmMembers,
        totalMemberCount: 22,
        observedMemberCount: 18,
        partialCoverage: true,
        groupTotalCostUsd: 3.45,
        groupUnpricedCalls: 2,
        lastSweepAtMs: nowMs - 1_500,
    };

    const swarmTopology = {
        lastSweepAtMs: nowMs - 1_500,
        nodesById: new Map([
            ['root-coord-1', { cascadeId: 'root-coord-1', rootId: 'root-coord-1', directParentId: null, isCoordinator: true, relationshipKind: 'swarm_member', memberName: 'coordinator', phase: 'WORKING', killed: false, assignedModel: 'Gemini 4 Neon', lastObservedAt: nowMs - 1_500, isOrphan: false, cycleDetected: false, hasConflict: false, isStaleManifest: false }],
            ['swarm-worker-1', { cascadeId: 'swarm-worker-1', rootId: 'root-coord-1', directParentId: 'root-coord-1', isCoordinator: false, relationshipKind: 'swarm_member', memberName: 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef', phase: 'WORKING', killed: false, assignedModel: 'Gemini 4 Neon', lastObservedAt: nowMs - 1_500, isOrphan: false, cycleDetected: false, hasConflict: false, isStaleManifest: false }],
            ['swarm-worker-2', { cascadeId: 'swarm-worker-2', rootId: 'root-coord-1', directParentId: 'swarm-worker-1', isCoordinator: false, relationshipKind: 'nested_helper', memberName: 'nested-helper-2', phase: 'WAITING', killed: false, assignedModel: 'Gemini 4 Hydrogen', lastObservedAt: nowMs - 1_500, isOrphan: false, cycleDetected: false, hasConflict: false, isStaleManifest: false }],
        ]),
        groupsByRootId: new Map([
            ['root-coord-1', { rootId: 'root-coord-1', title: 'Release Verification Swarm', coordinatorIds: ['root-coord-1'], memberIds: ['swarm-worker-1', 'swarm-worker-2'], activeMemberIds: ['root-coord-1', 'swarm-worker-1'] }],
        ]),
    };

    const swarmGroupCost = {
        rootId: 'root-coord-1',
        directCostByMember: {
            'root-coord-1': { cascadeId: 'root-coord-1', directCostUsd: 0.45, callCount: 3, pricedCallCount: 2, unpricedCallCount: 1, totalTokens: 48_000 },
            'swarm-worker-1': { cascadeId: 'swarm-worker-1', directCostUsd: 1.15, callCount: 4, pricedCallCount: 3, unpricedCallCount: 1, totalTokens: 64_000 },
        },
        coordinatorDirectCostUsd: 0.45,
        workersDirectCostUsd: 3.00,
        inclusiveGroupCostUsd: 3.45,
        uniqueCallCount: 12,
        duplicateCallsDeduplicated: 2,
        pricedCallCount: 10,
        unpricedCallCount: 2,
        hasUnpricedCalls: true,
    };

    const cacheTtl = modules.evaluatePromptCacheTtl({
        key: { account: 'acct_sample_opaque_01', backend: 'local', conversation: 'root-coord-1', model: 'gemini-4-neon', branch: 'release' },
        lastEventMs: nowMs - 210_000,
        nowMs,
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

    const weeklyRunways = [
        {
            account: 'acct_sample_opaque_01',
            pool: 'pool-gemini',
            window: '7d',
            resetEpoch: Date.parse(weeklyResetTime),
            status: 'at_risk',
            burnRatePctPerActiveHour: 4.5,
            avgActiveHoursPerDay: 5.0,
            projectedDailyBurnPct: 22.5,
            estRemainingActiveHours: 10.0,
            estExhaustMs: 48 * 3600_000,
            timeToResetMs: 120 * 3600_000,
            latestRemainingFraction: 0.84,
            coverage: {
                activeHours: 12.5, activeHourBuckets: 13, activeDays: 3, observedSpanHours: 60,
                minActiveHours: 2, minActiveDays: 2, minSpanHours: 24, meetsThreshold: true,
            },
            dailySummaries: [],
            offlineGapCount: 1,
            fractionalResetCount: 0,
            epochsConsidered: 1,
        },
        {
            account: 'acct_sample_opaque_01',
            pool: 'pool-claude',
            window: '7d',
            resetEpoch: Date.parse(weeklyResetTime),
            status: 'insufficient_history',
            burnRatePctPerActiveHour: null,
            avgActiveHoursPerDay: null,
            projectedDailyBurnPct: null,
            estRemainingActiveHours: null,
            estExhaustMs: null,
            timeToResetMs: 120 * 3600_000,
            latestRemainingFraction: 0.96,
            coverage: {
                activeHours: 0.5, activeHourBuckets: 1, activeDays: 1, observedSpanHours: 4,
                minActiveHours: 2, minActiveDays: 2, minSpanHours: 24, meetsThreshold: false,
            },
            dailySummaries: [],
            offlineGapCount: 0,
            fractionalResetCount: 0,
            epochsConsidered: 1,
        },
    ];

    const handoffPreview = {
        subjectCascadeId: 'swarm-worker-1',
        dataRevision: 42,
        markdown: '## Context HANDOFF Brief (v2 · rev 42)\n- Subject: `swarm-worker-1` (worker)\n- Context: 41.9% (214.5k / 512k)',
        generatedAtMs: nowMs,
    };

    const recoveryBrief = {
        eventKey: 'root-coord-1:gemini-4-neon:planner:release:8',
        cascadeId: 'root-coord-1',
        model: 'gemini-4-neon',
        role: 'planner',
        branch: 'release',
        beforeTokens: 320_000,
        afterTokens: 214_500,
        savedTokens: 105_500,
        summaryText: 'Compacted prior tool transcripts safely; current context stabilized at 214.5k tokens.',
        observedAtMs: nowMs - 30_000,
    };

    const observation = modules.buildPublishedMonitorObservation({
        backendEpoch: 1,
        windowId: 'e2e-win-1',
        rootCascadeId: 'root-coord-1',
        subjectCascadeId: 'root-coord-1',
        subjectKind: 'main',
        selectionRevision: 3,
        dataRevision: 42,
        measuredModel: 'gemini-4-neon',
        tokenSource: 'tracker_usage',
        usedTokens: 214_500,
        compactionLimit: 512_000,
        compactionLimitProvenance: 'model_catalog',
        nativeLimit: 1_048_576,
        nativeLimitProvenance: 'model_catalog',
        requestedBasis: 'compaction',
        speedMode: 'decode',
        speedSampleScope: 'latest_call',
        speedCallId: 'root-coord-1-2',
        displaySpeedTps: 86.7,
        sessionCostUsd: 0.45,
        observedAtMs: nowMs,
    });

    const populated = {
        useDocumentBuilder: true,
        now: nowMs,
        currentUsage,
        userInfo,
        allTrajectories,
        activitySummary,
        gmSummary,
        gmFullSummary: gmSummary,
        dailyStore,
        workspaceUri,
        storageDiagnostics,
        accountSnapshots,
        accountHandle: 'acct_sample_opaque_01',
        privacyMasked: true,
        orchestratorSettings: orchestratorSettingsCustom,
        quotaSummary,
        weeklyRunways,
        cacheTtl,
        swarmOverview,
        swarmTopology,
        swarmGroupCost,
        inspectedMemberId: 'swarm-worker-1',
        inspectedMemberLabel: 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef',
        // Inspecting this group while a previously locked root is absent from the inventory.
        lockedRootId: 'missing-locked-root',
        lockToMainAgent: true,
        lockPendingUnavailable: true,
        retargetOfferId: 'new-main-99',
        retargetOfferTitle: 'New Main Task',
        handoffPreview,
        recoveryBrief,
        observation,
        appSettings: {
            displayCurrency: 'USD',
            subscriptionPlan: 'google-ai-pro',
            subscriptionMonthlyFee: 19.99,
            subscriptionCurrency: 'USD',
            ideShowNativeHudBar: false,
            appShowNativeHudBar: true,
            nativeHudAutoHideOnOverview: true,
            languagePreference: 'both',
        },
        sessionCostUsd: 0.45,
        todayCostUsd: 1.25,
    };

    return {
        populated,
        unknownCredits: {
            useDocumentBuilder: true,
            now: nowMs,
            currentUsage: { ...currentUsage, orchestratorConfig: undefined },
            userInfo: unknownCreditsUserInfo,
            allTrajectories: [],
            activitySummary: null,
            gmSummary: null,
            gmFullSummary: null,
            dailyStore: new modules.DailyStore(),
            workspaceUri,
            orchestratorSettings: null,
            quotaSummary: null,
            accountHandle: 'acct_sample_opaque_01',
            accountSnapshots: [{ ...accountSnapshots[0], credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null }] }],
        },
        empty: {
            useDocumentBuilder: true,
            now: nowMs,
            allTrajectories: [],
            activitySummary: null,
            gmSummary: null,
            gmFullSummary: null,
            dailyStore: new modules.DailyStore(),
            accountSnapshots: [],
            orchestratorSettings: null,
            quotaSummary: null,
        },
        v1173: {
            orchestratorSettingsDefault,
            orchestratorSettingsCustom,
            orchestratorSettingsCustomSonnet,
            quotaSummary,
            quotaSummaryPrecision,
        },
    };
}

// ─── In-Browser Measurement Helpers (Evaluated inside Chromium) ──────────────

const measurements = `(() => {
    const cards = [...document.querySelectorAll('.spec-card')];
    const header = [...document.querySelectorAll('.topbar-title h1,#acctPopoverTrigger,.lang-switcher,#pauseBtn,#refreshBtn,#topbarAboutBtn,.update-time')];
    const overlaps = header.some((node, index) => {
        const a = node.getBoundingClientRect();
        return header.slice(index + 1).some(sibling => {
            const b = sibling.getBoundingClientRect();
            return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        });
    });
    return {
        heading: document.querySelector('.topbar-title h1')?.textContent.replace(/\\s+/g, ' ').trim(),
        modelInfo: document.querySelector('.model-info-section h2')?.textContent.replace(/\\s+/g, ' ').trim(),
        width: innerWidth,
        browserNowMs: Date.now(),
        browserClockIso: window.__E2E_FIXED_CLOCK__?.iso || null,
        overflow: document.documentElement.scrollWidth > innerWidth + 1 ||
            [...document.querySelectorAll('#tab-models .spec-card, #tab-models .model-card, #tab-models .orch-settings-card')].some(card => card.getBoundingClientRect().right > innerWidth + 1),
        overlaps,
        errors: testState.errors,
        orchSettings: (() => {
            const card = document.querySelector('#tab-models .orch-settings-card');
            if (!card) { return null; }
            return {
                mode: card.dataset.orchestratorMode || '',
                text: card.innerText.replace(/\\s+/g, ' ').trim(),
                orchestrator: card.querySelector('[data-orch-role="orchestrator"]')?.innerText.replace(/\\s+/g, ' ').trim() || '',
                executor: card.querySelector('[data-orch-role="executor"]')?.innerText.replace(/\\s+/g, ' ').trim() || '',
            };
        })(),
        entries: cards.map(card => ({
            model: card.dataset.modelId,
            name: card.querySelector('h3')?.textContent || '',
            catalog: card.querySelector('.spec-model-id')?.textContent || '',
            zeroDay: card.dataset.zeroDay === 'true' || card.dataset.zeroDayModel === 'true',
            limits: Object.fromEntries([...card.querySelectorAll('[data-metric]')].map(row => [row.dataset.metric, row.querySelector('dd')?.textContent || ''])),
            priceState: card.querySelector('.spec-price-row')?.dataset.priceState || '',
            priceText: card.querySelector('.spec-price-row')?.innerText.replace(/\\s+/g, ' ').trim() || '',
            route: card.querySelector('.spec-orchestration')?.textContent,
        })),
        pools: [...document.querySelectorAll('#slot-models .model-card')].map(card => ({
            group: card.querySelector('.model-card-name-text')?.textContent,
            members: [...card.querySelectorAll('.model-quota-members li')].map(row => row.innerText),
            range: card.querySelector('.model-card-pct')?.textContent,
            noticeTags: [...card.querySelectorAll('.tag-notice')].map(el => el.innerText.trim()),
            dualWindows: Object.fromEntries([...card.querySelectorAll('.quota-dual-item[data-quota-window]')].map(el => [
                el.dataset.quotaWindow,
                el.querySelector('.quota-dual-pct')?.innerText.trim() || '',
            ])),
        })),
    };
})()`;

function editorialReadings() {
    const pane = document.querySelector('#monitor-content .tab-pane.active');
    const activeMainTab = document.querySelector('#tabBar .tab-btn.active');
    const activeUtilBtn = document.querySelector('.topbar-util-btn.active');
    const activeViewId = activeMainTab?.dataset.tab || activeUtilBtn?.dataset.utilityView || pane?.id.replace(/^tab-/, '') || '';
    const isUtilityView = activeViewId === 'about';
    const masthead = document.querySelector('.panel-topbar');
    const topbarTitle = document.querySelector('.topbar-title');
    const tabBarWrap = document.querySelector('.tab-bar-wrapper');
    const logo = document.querySelector('.topbar-title h1');
    const visible = node => node.checkVisibility() && Boolean((node.innerText || '').trim());
    const headings = [...pane.querySelectorAll('h2, h3, .empty-msg, .empty-desc')].filter(visible);
    const readable = headings[0] || [...pane.children].find(visible);
    const box = readable?.getBoundingClientRect();
    const style = readable && getComputedStyle(readable);
    const mastheadRect = masthead.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.topbar-title h1,#acctPopoverTrigger,.lang-switcher,#pauseBtn,#refreshBtn,#topbarAboutBtn,.update-time')]
        .filter(node => node.checkVisibility());

    const outOfBounds = node => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
    };
    const isInsideScrollWrap = node => {
        if (node.tagName !== 'TABLE') { return false; }
        const wrap = node.closest('.recent-calls-table-wrap, .cal-heatmap-scroll');
        if (!wrap) { return false; }
        const ox = getComputedStyle(wrap).overflowX;
        return ox === 'auto' || ox === 'scroll';
    };
    const rectsOverlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const overlapping = controls.some((a, index) => controls.slice(index + 1).some(b =>
        rectsOverlap(a.getBoundingClientRect(), b.getBoundingClientRect())));
    const topbarRowOverlap = Boolean(topbarTitle && tabBarWrap
        && topbarTitle.getBoundingClientRect().bottom > tabBarWrap.getBoundingClientRect().top + 1);
    const stickyHeaderOverlap = topbarRowOverlap
        || (window.scrollY <= 1 && Boolean(box && box.top < mastheadRect.bottom - 1));

    const regionSelectors = [
        'section', 'h2', 'h3', 'table', 'pre',
        '.stg-card', '.cost-bar-row', '.cost-bar-track', '.cost-bar-section', '.cost-chips',
        '.prc-monthly-card', '.prc-monthly-models', '.prc-edit-row', '.rate-change-banner',
        '.cal-grid', '.cal-cell', '.cal-detail', '.cal-overview-grid', '.cal-chip-speed',
        '.ses-row', '.ses-shortcuts', '.ses-filters', '.ses-filter-btn', '.ses-group',
        '.model-card', '.spec-card', '.orch-settings-card', '.orch-role-row', '.spec-price-row', '.quota-dual-row',
        '.profile-page', '.profile-identity', '.profile-quota', '.profile-ai', '.profile-technical',
        '.act-summary-bar', '#telemetryLedgerSection', '.telemetry-ledger-card', '.telemetry-subgrid',
        '.recent-calls-card', '.recent-calls-table-wrap', '.act-model-card',
        '.about-card', '.about-info-box', '.overview-context', '.orch-route-pill',
        '.overview-telemetry-strip', '.overview-quota', '.overview-footer', '.zoom-presets',
        '#overviewSwarmStrip', '#handoffV2PreviewBox', '#compactionRecoveryBrief',
    ].join(', ');
    const overflowingRegions = [...pane.querySelectorAll(regionSelectors)]
        .filter(node => node.checkVisibility() && !isInsideScrollWrap(node) && outOfBounds(node))
        .slice(0, 6)
        .map(node => `${node.tagName.toLowerCase()}.${(node.className || '').toString().trim().replace(/\s+/g, '.')}`);

    const rootStyle = getComputedStyle(document.body);
    const resolveCssColor = cssValue => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;background-color:' + cssValue;
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return computed;
    };
    const parseRgba = str => {
        const m = (str || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/);
        if (!m) { return null; }
        return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    };
    const compositeOver = (fg, bg) => {
        const a = fg[3];
        if (a >= 1) { return [fg[0], fg[1], fg[2]]; }
        return [
            Math.round(fg[0] * a + bg[0] * (1 - a)),
            Math.round(fg[1] * a + bg[1] * (1 - a)),
            Math.round(fg[2] * a + bg[2] * (1 - a)),
        ];
    };
    const luminance = ([r, g, b]) => {
        const lin = c => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrastRatio = (fgStr, bgStr) => {
        const bgRaw = parseRgba(bgStr);
        const fgRaw = parseRgba(fgStr);
        if (!fgRaw || !bgRaw) { return null; }
        const bg = [bgRaw[0], bgRaw[1], bgRaw[2]];
        const fg = compositeOver(fgRaw, bg);
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
    };

    const resolvedTokens = {
        bg: resolveCssColor('var(--ed-bg)'),
        surface: resolveCssColor('var(--ed-surface)'),
        surfaceWell: resolveCssColor('var(--ed-surface-well)'),
        track: resolveCssColor('var(--ed-track)'),
        controlBorder: resolveCssColor('var(--ed-control-border)'),
        accent: resolveCssColor('var(--ed-accent)'),
        accentTrack: resolveCssColor('var(--ed-accent-track)'),
        goodFill: resolveCssColor('var(--ed-good-fill)'),
        warnFill: resolveCssColor('var(--ed-warn-fill)'),
        dangerFill: resolveCssColor('var(--ed-danger-fill)'),
        chartInput: resolveCssColor('var(--ed-chart-input)'),
        chartOutput: resolveCssColor('var(--ed-chart-output)'),
        chartCache: resolveCssColor('var(--ed-chart-cache)'),
        chartThinking: resolveCssColor('var(--ed-chart-thinking)'),
    };
    const nonTextContrasts = {
        controlBorderOnSurface: contrastRatio(resolvedTokens.controlBorder, resolvedTokens.surface),
        accentOnBg: contrastRatio(resolvedTokens.accent, resolvedTokens.bg),
        accentOnSurface: contrastRatio(resolvedTokens.accent, resolvedTokens.surface),
        accentTrackOnSurface: contrastRatio(resolvedTokens.accentTrack, resolvedTokens.surface),
        whiteThumbOnAccentTrack: contrastRatio('rgb(255, 255, 255)', resolvedTokens.accentTrack),
        goodFillOnTrack: contrastRatio(resolvedTokens.goodFill, resolvedTokens.track),
        warnFillOnTrack: contrastRatio(resolvedTokens.warnFill, resolvedTokens.track),
        dangerFillOnTrack: contrastRatio(resolvedTokens.dangerFill, resolvedTokens.track),
        accentOnTrack: contrastRatio(resolvedTokens.accent, resolvedTokens.track),
    };

    const requiredTokenNames = [
        '--ed-bg', '--ed-surface', '--ed-surface-well', '--ed-ink', '--ed-ink-secondary', '--ed-ink-muted',
        '--ed-accent', '--ed-border', '--ed-border-strong', '--ed-control-border',
        '--ed-display-latin', '--ed-sans', '--ed-sans-cjk', '--ed-mono',
    ];
    const designTokens = Object.fromEntries(requiredTokenNames.map(name => [name, rootStyle.getPropertyValue(name).trim()]));

    const fontStacks = [
        designTokens['--ed-display-latin'],
        designTokens['--ed-sans'],
        designTokens['--ed-sans-cjk'],
        rootStyle.fontFamily,
        getComputedStyle(logo).fontFamily,
    ].filter(Boolean);
    const hasGenericSerifFallback = fontStacks.some(stack => /(?:^|,)\s*serif\s*(?:,|$)/i.test(stack));
    const hasSongtiFallback = fontStacks.some(stack => /songti|simsun|nsimsun|fangsong|stsong/i.test(stack));

    const visibleBiEn = [...document.querySelectorAll('.panel-topbar .bi-en, #monitor-content .tab-pane.active .bi-en')]
        .filter(node => node.checkVisibility());
    const visibleBiZh = [...document.querySelectorAll('.panel-topbar .bi-zh, #monitor-content .tab-pane.active .bi-zh')]
        .filter(node => node.checkVisibility());
    const visibleBiSep = [...document.querySelectorAll('.panel-topbar .bi-sep, #monitor-content .tab-pane.active .bi-sep')]
        .filter(node => node.checkVisibility());

    const popoverText = document.getElementById('acctPopoverBody')?.textContent || '';
    const fullVisibleText = `${masthead.innerText}\n${pane.innerText}`;
    const attrCopy = [...document.querySelectorAll('.panel-topbar [aria-label], .panel-topbar [data-tip-body], #monitor-content .tab-pane.active [aria-label], #monitor-content .tab-pane.active [data-tip-body]')]
        .map(el => [el.getAttribute('aria-label'), el.getAttribute('data-tip-body')].filter(Boolean).join(' '))
        .join('\n');

    const tabBarIds = [...document.querySelectorAll('#tabBar .tab-btn[data-tab]')].map(btn => btn.dataset.tab);
    const hasTabScrollArrows = Boolean(document.getElementById('tabArrowLeft') || document.getElementById('tabArrowRight'));
    const hasTopbarUtilityButtons = Boolean(
        !document.querySelector('#topbarSettingsBtn')
        && document.querySelector('#tabBar #tabBtn-settings[data-tab="settings"]')
        && document.querySelector('#topbarAboutBtn[data-utility-view="about"]'),
    );

    const overviewInfo = activeViewId === 'overview' ? {
        hasSwarmStrip: Boolean(pane.querySelector('#overviewSwarmStrip')),
        swarmPartialCoverage: Boolean(pane.querySelector('#overviewSwarmStrip [data-swarm-partial-coverage="true"]')),
        hasInspectBanner: Boolean(pane.querySelector('[data-inspect-banner="true"]')),
        hasLockPendingBanner: Boolean(pane.querySelector('[data-lock-pending="true"]')),
        hasRetargetBanner: Boolean(pane.querySelector('[data-retarget-banner="true"]')),
        hasHandoffPreview: Boolean(pane.querySelector('#handoffV2PreviewBox')),
        hasRecoveryBrief: Boolean(pane.querySelector('#compactionRecoveryBrief')),
        hasCacheTtlBadge: Boolean(pane.querySelector('[data-cache-ttl-state]')),
        dualQuotaRows: pane.querySelectorAll('.quota-dual-row').length,
    } : null;

    const gmInfo = activeViewId === 'gm' ? {
        hasAnomalyBar: Boolean(pane.querySelector('[data-gm-anomaly-bar="true"]')),
        anomalyPillCount: pane.querySelectorAll('[data-gm-anomaly-bar="true"] [data-anomaly-kind]').length,
        hasSpeedSwitch: Boolean(pane.querySelector('[data-setting-switch="speedMetricMode"]')),
        hasMeasuredOnlyPhase: Boolean(pane.querySelector('[data-phase-source="measured_only"]')),
        hasSynthesizedPhase: Boolean(pane.querySelector('.phase-seg-thinking, .phase-seg-tool')),
        hasCacheTtlSource: Boolean(pane.querySelector('[data-cache-ttl-source="local_ttl_heuristic"]')),
        hasPossibleCauses: Boolean(pane.querySelector('[data-cache-miss-causes="true"]')),
    } : null;

    const sessionsInfo = activeViewId === 'sessions' ? {
        hasSwarmTree: Boolean(pane.querySelector('#sessionsSwarmTree')),
        hasDepth0: Boolean(pane.querySelector('#sessionsSwarmTree [data-swarm-depth="0"]')),
        hasDepth1: Boolean(pane.querySelector('#sessionsSwarmTree [data-swarm-depth="1"]')),
        hasDepth2: Boolean(pane.querySelector('#sessionsSwarmTree [data-swarm-depth="2"]')),
        swarmTreeHasRevealBtn: Boolean(pane.querySelector('#sessionsSwarmTree [data-history-action="workspace"]')),
    } : null;

    const calendarInfo = activeViewId === 'calendar' ? {
        hasWorkspaceLeaderboard: Boolean(pane.querySelector('#calWorkspaceLeaderboard[data-workspace-leaderboard="true"]')),
        hasUnattributedRow: Boolean(pane.querySelector('[data-workspace-unattributed="true"]')),
        hasSwarmGroupCost: Boolean(pane.querySelector('#calSwarmGroupCost[data-swarm-group-cost="true"]')),
        planRoiCollapsed: pane.querySelector('#calPlanRoiAdvanced') ? !pane.querySelector('#calPlanRoiAdvanced').open : null,
        hasExportMarkdown: Boolean(pane.querySelector('[data-action="calendarExportMarkdown"]')),
        hasExportCsv: Boolean(pane.querySelector('[data-action="calendarExportCsv"]')),
        hasExportJson: Boolean(pane.querySelector('[data-action="calendarExportJson"]')),
        hasOrchPricingToggle: Boolean(pane.querySelector('#orchPricingModeMapped') && pane.querySelector('#orchPricingModeStrict')),
        rateChangeBannerText: pane.querySelector('.rate-change-banner')?.innerText.replace(/\s+/g, ' ').trim() || '',
        carbonInputVal: pane.querySelector('.pricing-input[data-model="gemini-4-carbon"][data-field="input"]')?.value || '',
        carbonOutputVal: pane.querySelector('.pricing-input[data-model="gemini-4-carbon"][data-field="output"]')?.value || '',
        argonInputVal: pane.querySelector('.pricing-input[data-model="gemini-4-argon"][data-field="input"]')?.value || '',
        argonOutputVal: pane.querySelector('.pricing-input[data-model="gemini-4-argon"][data-field="output"]')?.value || '',
    } : null;

    const modelsInfo = activeViewId === 'models' ? {
        hasCatalogMetadata: Boolean(pane.querySelector('.spec-card .spec-provider[data-popover-key]'))
            && Boolean(pane.querySelector('.spec-card [data-popover-key^="models-spec-modelid-"]')),
        hasWeeklyForecast: Boolean(pane.querySelector('#modelsWeeklyPaceCard[data-weekly-forecast="true"]')),
        hasInsufficientHistory: Boolean(pane.querySelector('[data-weekly-status="insufficient_history"]')),
        hasProfileBillingInput: Boolean(pane.querySelector('#profileBillingDayInput')),
        profileBillingHasDataEmail: Boolean(pane.querySelector('#profileBillingDayInput[data-email]')),
        profileBillingHasHandle: Boolean(pane.querySelector('#profileBillingDayInput[data-account-handle]')),
    } : null;

    const settingsInfo = activeViewId === 'settings' ? {
        groups: [...pane.querySelectorAll('[data-settings-group]')].map(el => el.getAttribute('data-settings-group')),
        hasExportBackup: Boolean(pane.querySelector('[data-action="exportSettingsBackup"]')),
        hasImportBackup: Boolean(pane.querySelector('[data-action="importSettingsBackup"]')),
        hasExportDiag: Boolean(pane.querySelector('[data-action="exportRedactedDiagnostics"]')),
        hasCadOption: Boolean(pane.querySelector('#displayCurrencySelect option[value="CAD"]')),
    } : null;

    const aboutInfo = activeViewId === 'about' ? {
        versionPill: pane.querySelector('.about-version-pill')?.innerText.trim() || '',
        hasComplianceCard: Boolean(pane.querySelector('[data-about-compliance="true"]')),
        acknowledgments: [...pane.querySelectorAll('.about-acks li.about-ack-item')].map(item => {
            const link = item.querySelector('a.about-ack-link');
            const description = item.querySelector('.about-ack-desc');
            return {
                label: link?.innerText.trim(), href: link?.getAttribute('href'),
                actionUrl: link?.getAttribute('data-url'), description: description?.innerText.trim(),
                visible: Boolean(link?.getClientRects().length && description?.getClientRects().length),
            };
        }),
        text: pane.innerText || '',
    } : null;

    return {
        tab: activeViewId,
        pane: pane.id,
        isUtilityView,
        tabBarIds,
        hasTabScrollArrows,
        hasTopbarUtilityButtons,
        soleCurrentTab: isUtilityView
            ? (document.querySelectorAll('#tabBar [aria-current="page"]').length === 0
                && activeUtilBtn?.getAttribute('aria-pressed') === 'true')
            : (document.querySelectorAll('#tabBar [aria-current="page"]').length === 1
                && activeMainTab?.getAttribute('aria-current') === 'page'),
        readable: readable?.innerText.trim().slice(0, 110) || '',
        headlineFits: Boolean(box && !outOfBounds(readable) && box.bottom > mastheadRect.bottom
            && box.top < innerHeight && parseFloat(style.fontSize) >= 11),
        overflow: document.documentElement.scrollWidth > innerWidth + 1 || outOfBounds(pane) || controls.some(outOfBounds),
        overflowingRegions,
        overlapping,
        stickyHeaderOverlap,
        editorial: document.body.dataset.editorial === 'true',
        bodyLang: document.body.dataset.lang,
        bodyViewLang: document.body.dataset.viewLang,
        bodyCompactLang: document.body.dataset.compactLang || 'false',
        bodyThemeKind: document.body.getAttribute('data-vscode-theme-kind'),
        browserNowMs: Date.now(),
        browserClockIso: window.__E2E_FIXED_CLOCK__?.iso || null,
        designTokens,
        resolvedTokens,
        nonTextContrasts,
        hasGenericSerifFallback,
        hasSongtiFallback,
        bilingual: {
            enCount: visibleBiEn.length,
            zhCount: visibleBiZh.length,
            sepCount: visibleBiSep.length,
        },
        mastheadFont: getComputedStyle(logo).fontFamily,
        mastheadFontSize: parseFloat(getComputedStyle(logo).fontSize),
        pageSurface: rootStyle.backgroundColor,
        colorScheme: rootStyle.colorScheme,
        mastheadBackground: getComputedStyle(masthead).backgroundColor,
        missingNumeric: /(?:^|\s)(?:NaN|Infinity|Invalid Date)(?:\s|$)/.test(pane.innerText),
        hasForbiddenChineseGlossary: /账户|冷缓存|首次响应|生成器调用|模型上限|暂停刷新|令牌|额度/.test(`${fullVisibleText}\n${popoverText}\n${attrCopy}`),
        hasForbiddenComplianceCopy: /100%\s*ToS-safe|100%\s*Antigravity\s*ToS-compliant|100%\s*合规/i.test(`${fullVisibleText}\n${popoverText}\n${attrCopy}`),
        legacyCredits: /\b(?:Prompt|Flow)\s+(?:Credits\b|额度)|8,765|7,654/i.test(`${fullVisibleText}\n${popoverText}`),
        overviewInfo,
        gmInfo,
        sessionsInfo,
        calendarInfo,
        modelsInfo,
        settingsInfo,
        aboutInfo,
        errors: testState.errors,
    };
}

// ─── Modular Assertion Helpers ───────────────────────────────────────────────

function assertEditorialView(view, { lang, state, theme, width, tab, packageJSON, expectedClock }) {
    assert.equal(view.tab, tab, `keyboard activates ${tab}`);
    assert.equal(view.pane, `tab-${tab}`);
    assert.deepEqual(view.tabBarIds, [...MAIN_TABS], 'strictly 6 canonical tabs inside #tabBar[role="tablist"]');
    assert.equal(view.hasTabScrollArrows, false, 'zero-scroll 6-tab IA omits tab scroll arrows');
    assert.equal(view.hasTopbarUtilityButtons, true, 'Settings lives in #tabBar and topbar renders ⓘ About utility button');
    assert(view.soleCurrentTab, `sole current indicator holds for ${tab}`);
    assert(view.readable, 'pane has visible heading or content');
    assert(view.headlineFits, `pane begins with readable heading: ${view.readable}`);
    assert.equal(view.overflow, false, `page fits horizontally at ${width}px on ${tab}`);
    assert.deepEqual(view.overflowingRegions, [], `visible regions fit horizontally at ${width}px on ${tab}`);
    assert.equal(view.overlapping, false, 'masthead controls do not overlap');
    assert.equal(view.stickyHeaderOverlap, false, 'sticky header does not overlap pane content');
    assert.equal(view.editorial, true, 'editorial styling is integrated');
    assert.equal(view.bodyLang, lang, 'body[data-lang] matches active language');
    assert.equal(view.bodyThemeKind, theme, 'body[data-vscode-theme-kind] matches active theme');

    if (expectedClock) {
        assert.equal(view.browserNowMs, expectedClock.epochMs, `browser Date.now() matches host fixed clock ${expectedClock.iso}`);
        assert.equal(view.browserClockIso, expectedClock.iso, `browser __E2E_FIXED_CLOCK__.iso matches ${expectedClock.iso}`);
    }

    for (const [tokenName, tokenValue] of Object.entries(view.designTokens)) {
        assert(Boolean(tokenValue), `DESIGN.md token ${tokenName} is defined`);
    }
    assert.equal(view.hasGenericSerifFallback, false, 'Zero-Songti rule: no generic serif fallback');
    assert.equal(view.hasSongtiFallback, false, 'Zero-Songti rule: no Songti/SimSun fallback');

    assertCoolNeutralRgb(view.pageSurface, `${theme} body canvas`);
    assertCoolNeutralRgb(view.mastheadBackground, `${theme} masthead`);
    if (theme === 'vscode-light') {
        assert.equal(view.pageSurface, 'rgb(250, 251, 252)', 'Light canvas uses #FAFBFC');
    } else if (theme === 'vscode-dark') {
        assert.equal(view.pageSurface, 'rgb(13, 16, 20)', 'Dark canvas uses #0D1014');
    }

    if ((theme === 'vscode-light' || theme === 'vscode-dark') && tab === 'overview') {
        for (const [pair, ratio] of Object.entries(view.nonTextContrasts)) {
            assert(typeof ratio === 'number' && ratio >= 3.0,
                `WCAG 1.4.11 non-text contrast ${theme} ${pair}=${ratio} must be >= 3.0:1`);
        }
    }

    assert.equal(view.missingNumeric, false, 'no NaN/Infinity/Invalid Date');
    assert.equal(view.hasForbiddenChineseGlossary, false, 'v1.18 Chinese glossary guard: zero forbidden terms');
    assert.equal(view.hasForbiddenComplianceCopy, false, 'compliance guard: zero 100% ToS-safe / 100% 合规 claims');
    assert.equal(view.legacyCredits, false, 'zero legacy Prompt/Flow credits');
    assert.deepEqual(view.errors, [], 'zero uncaught browser JS errors');

    if (state === 'populated') {
        if (tab === 'overview') {
            assert.equal(view.overviewInfo?.hasSwarmStrip, true, 'Overview renders #overviewSwarmStrip');
            assert.equal(view.overviewInfo?.swarmPartialCoverage, true, 'Overview Swarm strip reports partial coverage for 22 members');
            assert.equal(view.overviewInfo?.hasInspectBanner, true, 'Overview renders sticky Inspecting Worker banner');
            assert.equal(view.overviewInfo?.hasLockPendingBanner, true, 'Overview renders Pending/Unavailable banner');
            assert.equal(view.overviewInfo?.hasRetargetBanner, true, 'Overview renders Retarget banner');
            assert.equal(view.overviewInfo?.hasHandoffPreview, true, 'Overview renders Handoff v2 preview box');
            assert.equal(view.overviewInfo?.hasRecoveryBrief, true, 'Overview renders read-only Compaction Recovery Brief');
            assert.equal(view.overviewInfo?.hasCacheTtlBadge, true, 'Overview renders Cache 5m TTL badge');
            assert.equal(view.overviewInfo?.dualQuotaRows, 2, 'Overview renders dual-window quota rows');
        }
        if (tab === 'gm') {
            assert.equal(view.gmInfo?.hasAnomalyBar, true, 'Model Calls renders GM Anomaly Filter Bar');
            assert.equal(view.gmInfo?.anomalyPillCount, 8, 'GM Anomaly Filter Bar has 8 filter pills');
            assert.equal(view.gmInfo?.hasSpeedSwitch, true, 'Model Calls renders Decode/E2E speed switch');
            assert.equal(view.gmInfo?.hasMeasuredOnlyPhase, true, 'Model Calls renders strictly measured-only phase bars');
            assert.equal(view.gmInfo?.hasSynthesizedPhase, false, 'Model Calls NEVER synthesizes thinking/tool phase bars');
            assert.equal(view.gmInfo?.hasCacheTtlSource, true, 'Model Calls tags Cache 5m TTL as local_ttl_heuristic');
            assert.equal(view.gmInfo?.hasPossibleCauses, true, 'Model Calls renders Possible Cache-Miss Causes');
        }
        if (tab === 'sessions') {
            assert.equal(view.sessionsInfo?.hasSwarmTree, true, 'Sessions renders #sessionsSwarmTree');
            assert.equal(view.sessionsInfo?.hasDepth0, true, 'Sessions Swarm tree renders coordinator depth 0');
            assert.equal(view.sessionsInfo?.hasDepth1, true, 'Sessions Swarm tree renders worker depth 1');
            assert.equal(view.sessionsInfo?.hasDepth2, true, 'Sessions Swarm tree renders nested helper depth 2');
            assert.equal(view.sessionsInfo?.swarmTreeHasRevealBtn, false, 'Sessions Swarm tree NEVER exposes workspace reveal button');
        }
        if (tab === 'calendar') {
            assert.equal(view.calendarInfo?.hasWorkspaceLeaderboard, true, 'Usage & Cost renders Workspace Project Leaderboard');
            assert.equal(view.calendarInfo?.hasUnattributedRow, true, 'Usage & Cost renders explicit Unattributed row');
            assert.equal(view.calendarInfo?.hasSwarmGroupCost, true, 'Usage & Cost renders Swarm Group Cost section');
            assert.equal(view.calendarInfo?.planRoiCollapsed, true, 'Plan ROI Advanced details starts collapsed');
            assert.equal(view.calendarInfo?.hasExportMarkdown, true, 'Usage & Cost renders Export Markdown');
            assert.equal(view.calendarInfo?.hasExportCsv, true, 'Usage & Cost renders Export CSV');
            assert.equal(view.calendarInfo?.hasExportJson, true, 'Usage & Cost renders Export JSON');
            assert.equal(view.calendarInfo?.hasOrchPricingToggle, true, 'Usage & Cost (#slot-pricing) renders Orchestrator Pricing Mode toggle');
            if (expectedClock) {
                if (expectedClock.isPreCutover) {
                    assert(view.calendarInfo.rateChangeBannerText.includes('2026-12-01')
                        && view.calendarInfo.rateChangeBannerText.includes('Carbon')
                        && view.calendarInfo.rateChangeBannerText.includes('Argon'),
                    `Pre-2026-12-01 banner must mention Carbon & Argon 2026-12-01: ${view.calendarInfo.rateChangeBannerText}`);
                    assert.equal(view.calendarInfo.carbonInputVal, '2', 'Pre-2026-12-01 Carbon input rate is $2');
                    assert.equal(view.calendarInfo.carbonOutputVal, '10', 'Pre-2026-12-01 Carbon output rate is $10');
                    assert.equal(view.calendarInfo.argonInputVal, '2', 'Pre-2026-12-01 Argon input rate is $2');
                    assert.equal(view.calendarInfo.argonOutputVal, '10', 'Pre-2026-12-01 Argon output rate is $10');
                } else {
                    assert(!view.calendarInfo.rateChangeBannerText.includes('2026-12-01'),
                        `Post-2026-12-01 banner must NOT list expired 2026-12-01 cutover: ${view.calendarInfo.rateChangeBannerText}`);
                    assert.equal(view.calendarInfo.carbonInputVal, '4', 'Post-2026-12-01 Carbon input rate is $4');
                    assert.equal(view.calendarInfo.carbonOutputVal, '20', 'Post-2026-12-01 Carbon output rate is $20');
                    assert.equal(view.calendarInfo.argonInputVal, '4', 'Post-2026-12-01 Argon input rate is $4');
                    assert.equal(view.calendarInfo.argonOutputVal, '20', 'Post-2026-12-01 Argon output rate is $20');
                }
            }
        }
        if (tab === 'models') {
            assert.equal(view.modelsInfo?.hasCatalogMetadata, true, 'Models & Quotas exposes provider and catalog ID details');
            assert.equal(view.modelsInfo?.hasWeeklyForecast, true, 'Models & Quotas renders Weekly Active-Hours Forecast');
            assert.equal(view.modelsInfo?.hasInsufficientHistory, true, 'Models & Quotas renders Insufficient history state');
            assert.equal(view.modelsInfo?.hasProfileBillingInput, true, 'Models & Quotas (#slot-profile) renders billing day input');
            assert.equal(view.modelsInfo?.profileBillingHasDataEmail, false, 'SEC-04: #profileBillingDayInput has ZERO data-email');
            assert.equal(view.modelsInfo?.profileBillingHasHandle, true, 'SEC-04: #profileBillingDayInput uses opaque data-account-handle');
        }
        if (tab === 'settings') {
            assert.deepEqual(view.settingsInfo?.groups, [
                'version-updates',
                'display-language',
                'telemetry-metrics',
                'currency-pricing',
                'overlays-cdp',
                'global-rules',
                'data-backup-diagnostics',
            ], 'IDE Settings renders the updates card and six settings groups');
            assert.equal(view.settingsInfo?.hasExportBackup, true, 'Settings renders Export Settings JSON');
            assert.equal(view.settingsInfo?.hasImportBackup, true, 'Settings renders Import Settings JSON');
            assert.equal(view.settingsInfo?.hasExportDiag, true, 'Settings renders Export Redacted Diagnostics');
            assert.equal(view.settingsInfo?.hasCadOption, true, 'Settings 10-currency selector includes CAD');
        }
        if (tab === 'about') {
            assert.equal(view.aboutInfo?.versionPill, `v${packageJSON.version}`, `About pill shows v${packageJSON.version}`);
            assert.equal(view.aboutInfo?.hasComplianceCard, true, 'About renders objective compliance card');
            for (const [name, link, en, zh] of [
                ['@gitstq (PR #78)', 'pull/78', 'Implemented the Settings editor', '实现了 App 与 IDE 的全局规则编辑器'],
                ['@GHTGXL (Issue #79)', 'issues/79', 'Reported repeated Windows Sidecar', '报告 Windows 上超过 2,500 步的会话'],
            ]) {
                const url = 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/' + link;
                const matches = view.aboutInfo.acknowledgments.filter(row => row.label === name || row.href === url);
                assert.equal(matches.length, 1, 'One acknowledgment row per contribution');
                const [row] = matches;
                assert.equal(row.label, name);
                assert.equal(row.href, url);
                assert.equal(row.actionUrl, url);
                assert.equal(row.visible, true);
                if (lang === 'en' || lang === 'zh') {
                    assert.ok(row.description.includes(lang === 'en' ? en : zh), 'Contributor credit is visible in the selected language');
                }
            }

        }
    }
}

// ─── Host-Only Dual-Clock Pricing & StatusBar Self-Test (Used in --dry-run) ──

async function runDualClockHostSelfTest(panel, configs, cleanUsage, gmSummary, quotaSummary, fixtureEnv) {
    const regimes = [
        { label: 'pre-2026-12-01', iso: CLOCK_REGIMES.pre },
        { label: 'post-2026-12-02', iso: CLOCK_REGIMES.post },
    ];
    const results = [];

    for (const regime of regimes) {
        await withHostFixedClock(regime.iso, async (clock) => {
            assert.equal(Date.now(), clock.epochMs, `host Date.now() fixed to ${clock.iso}`);
            const carbonRate = panel.modules.DEFAULT_PRICING['gemini-4-carbon'];
            const argonRate = panel.modules.DEFAULT_PRICING['gemini-4-argon'];
            const upcoming = panel.modules.getUpcomingRateChanges(Date.now(), 45);
            const has20261201 = upcoming.some(item => item.effectiveDate === '2026-12-01');

            const pricingHtml = panel.renderPricingTab(gmSummary);
            const carbonHover = panel.renderStatusBar('full', configs, {
                usage: { ...cleanUsage, model: 'MODEL_PLACEHOLDER_M427', modelDisplayName: 'Gemini 4 Carbon (High)' },
                quotaSummary,
            });
            const browserShim = harness.buildBrowserClockShimScript(clock.iso);
            assert(browserShim.includes(String(clock.epochMs)), 'browser clock shim embeds exact host epoch ms');
            assert(browserShim.includes(clock.iso), 'browser clock shim embeds exact host ISO');

            if (clock.isPreCutover) {
                assert.equal(carbonRate.input, 2, 'pre-change Carbon input is $2');
                assert.equal(carbonRate.output, 10, 'pre-change Carbon output is $10');
                assert.equal(carbonRate.cacheRead, 0.10, 'pre-change Carbon cacheRead is $0.10');
                assert.equal(argonRate.input, 2, 'pre-change Argon input is $2');
                assert.equal(argonRate.output, 10, 'pre-change Argon output is $10');
                assert.equal(has20261201, true, 'pre-change upcoming rate changes include 2026-12-01');
                assert(pricingHtml.includes('2026-12-01') && pricingHtml.includes('Carbon') && pricingHtml.includes('Argon'),
                    'pre-change pricing HTML includes 2026-12-01 Carbon/Argon banner');
                assert(carbonHover.tooltip.includes('2026-12-01') && /Price Notice|调价提醒/.test(carbonHover.tooltip),
                    'pre-change StatusBar Carbon hover displays 2026-12-01 Price Notice');
            } else {
                assert.equal(carbonRate.input, 4, 'post-change Carbon input is $4');
                assert.equal(carbonRate.output, 20, 'post-change Carbon output is $20');
                assert.equal(carbonRate.cacheRead, 0.20, 'post-change Carbon cacheRead is $0.20');
                assert.equal(argonRate.input, 4, 'post-change Argon input is $4');
                assert.equal(argonRate.output, 20, 'post-change Argon output is $20');
                assert.equal(has20261201, false, 'post-change upcoming rate changes exclude expired 2026-12-01');
                assert(!pricingHtml.includes('ends before 2026-12-01') && !pricingHtml.includes('将于 2026-12-01 结束'),
                    'post-change pricing HTML omits expired 2026-12-01 Carbon/Argon countdown');
                assert(!carbonHover.tooltip.includes('2026-12-01'),
                    'post-change StatusBar Carbon hover omits expired 2026-12-01 notice');
            }

            // Also verify full v1.18 HTML document builds cleanly under the fixed clock
            const docHtml = await panel.renderDocument('both', {
                now: Date.now(),
                currentUsage: cleanUsage,
                modelConfigs: configs,
                gmSummary,
                gmFullSummary: gmSummary,
                quotaSummary,
                storageDiagnostics: {
                    stateFilePath: fixtureEnv.statePath,
                    stateFileExists: true,
                    stateFileSizeBytes: 1024,
                    stateFileOpenWarnBytes: 1024 * 1024,
                    calendarDayCount: 1,
                },
            });
            assert(!FORBIDDEN_COMPLIANCE_RE.test(docHtml), 'document omits forbidden absolute ToS claims');
            assert(!FORBIDDEN_CHINESE_GLOSSARY_RE.test(docHtml), 'document complies with v1.18 Chinese glossary');

            results.push({
                regime: regime.label,
                clockIso: clock.iso,
                epochMs: clock.epochMs,
                carbonRates: { input: carbonRate.input, output: carbonRate.output, cacheRead: carbonRate.cacheRead },
                argonRates: { input: argonRate.input, output: argonRate.output, cacheRead: argonRate.cacheRead },
                has20261201Banner: has20261201,
                browserShimVerified: true,
            });
        });
    }

    return { ok: true, regimes: results };
}

// ─── Non-Destructive Native Live IDE Smoke (agent-desktop) ───────────────────

function runNativeSmoke(args) {
    const desktop = createDesktopClient();
    const app = args.app || (process.platform === 'darwin' ? 'com.google.antigravity-ide' : 'Antigravity IDE');
    const snapshotTimeout = String(Math.max(3000, parseInt(args['timeout-ms'], 10) || 8000));
    const snapshotArgs = ['snapshot', '--app', app, '--compact', '--max-depth', '45', '--timeout-ms', snapshotTimeout];
    if (args['window-id']) { snapshotArgs.push('--window-id', args['window-id']); }

    const snapshot = () => {
        const result = desktop.jsonResult(snapshotArgs);
        if (!result.ok) {
            if (result.error?.disposition?.retry === 'safe'
                && ['APP_UNRESPONSIVE', 'TIMEOUT'].includes(result.error.code)) { return null; }
            assert.fail(`IDE snapshot failed: ${result.error?.code}`);
        }
        const state = result.data;
        if (!state.complete) { return null; }
        const nodes = [];
        function visit(node, ancestors = []) {
            nodes.push({ ...node, ancestors });
            for (const child of node.children || []) { visit(child, [...ancestors, node.role]); }
        }
        visit(state.tree);
        return nodes;
    };

    const matches = (node, role, name) => node.role === role
        && (name instanceof RegExp ? name.test(node.name || '') : node.name === name);

    function waitFor(predicate, description) {
        const deadline = Date.now() + 18_000;
        do {
            const nodes = snapshot();
            const result = nodes && predicate(nodes);
            if (result) { return result; }
        } while (Date.now() < deadline);
        assert.fail(`Live IDE did not show ${description}`);
    }

    function click(predicate, description) {
        const button = waitFor(nodes => {
            const matching = nodes.filter(node => node.ref_id && predicate(node));
            assert(matching.length <= 1, `ambiguous IDE control: ${description}`);
            return matching[0];
        }, description);
        desktop.run(['click', button.ref_id]);
    }

    const has = (nodes, role, name) => nodes.some(node => matches(node, role, name));
    const hasText = (nodes, pattern) => nodes.some(node => (
        pattern instanceof RegExp ? pattern.test(node.name || '') : (node.name || '').includes(pattern)
    ));
    const statusLabel = new RegExp(
        args['status-label'] || 'Context (?:Window )?(?:Monitor|Usage)|上下文(?:窗口)?(?:使用情况|监控)|No active conversation|无活跃会话',
        'i',
    );
    const disconnectedStatusRe = /不可用|Unavailable|Disconnected|连接已断开/i;
    const findStatusButton = nodes => nodes.find(node => node.ancestors.includes('status') && matches(node, 'button', statusLabel));

    const openFromStatus = () => {
        const statusBtn = waitFor(findStatusButton, 'connected monitor status item');
        assert(!disconnectedStatusRe.test(statusBtn.name || ''),
            `Live IDE status bar must be connected: ${statusBtn.name}`);
        desktop.run(['click', statusBtn.ref_id]);
        return statusBtn.name || '';
    };

    const initialStatusLabel = openFromStatus();
    console.log(`Native live status bar connected: ${initialStatusLabel}`);
    const currentLocale = () => waitFor(
        nodes => Object.keys(LANGUAGES).find(lang => has(nodes, 'heading', LANGUAGES[lang].heading)),
        'monitor webview title',
    );
    const original = currentLocale();
    const switchLocale = lang => {
        if (currentLocale() === lang) { return; }
        click(node => matches(node, 'button', LANGUAGE_BUTTONS[lang]), `monitor language ${lang}`);
        waitFor(nodes => has(nodes, 'heading', LANGUAGES[lang].heading), `monitor heading in ${lang}`);
    };
    const clickMainTab = (label, description) => click(
        node => (node.role === 'tab' || node.role === 'button') && matches(node, node.role, label),
        description,
    );

    // Strictly NON-DESTRUCTIVE sweep of v1.18.0 5-tab IA + topbar Settings/About
    try {
        let sweptAll = false;
        for (const [lang, labels] of Object.entries(LANGUAGES)) {
            switchLocale(lang);
            openFromStatus();
            const overviewNodes = waitFor(
                nodes => has(nodes, 'heading', labels.overviewTitle) && nodes,
                `overview in ${lang}`,
            );
            assert(!has(overviewNodes, 'heading', labels.disconnectedHeading),
                `Overview must not show backend disconnected in ${lang}`);

            if (!sweptAll) {
                for (const key of ['gm', 'sessions', 'calendar', 'models']) {
                    clickMainTab(labels[key], `${key} tab in ${lang}`);
                    waitFor(nodes => hasText(nodes, labels[key]), `${key} mounted in ${lang}`);
                }
                clickMainTab(labels.settings, `Settings tab in ${lang}`);
                waitFor(nodes => hasText(nodes, /Updates|版本与更新|Backup|备份/), `Settings view in ${lang}`);

                click(node => matches(node, 'button', labels.about), `topbar About in ${lang}`);
                waitFor(
                    nodes => nodes.some(n => (n.name || '').includes(harness.MANIFEST.version)),
                    `About version ${harness.MANIFEST.version} in ${lang}`,
                );
                sweptAll = true;
            }
            console.log(`Native ${lang}: v1.18 six tabs + About non-destructive smoke passed`);
        }
    } finally {
        switchLocale(original);
        openFromStatus();
    }
}

// ─── Modular Browser Matrix Runner (Isolated Fixture Only) ───────────────────

function buildModelCatalogFixture(panel, resetTime) {
    const neon = NEON_IDENTITIES.map(([id, catalogId, effort, translated]) => {
        const spec = panel.specs.find(s => s.placeholderId === `MODEL_PLACEHOLDER_${id}`);
        assert.equal(spec?.modelId, catalogId, `${id} catalog identity`);
        return { ...spec, displayName: neonLabel('en', effort, translated), effort, translated };
    });
    const findSpec = id => {
        const spec = panel.specs.find(s => s.placeholderId === id);
        assert(spec, `installed spec exists: ${id}`);
        return spec;
    };
    const config = (spec, remainingFraction = 0.52, extra = {}) => ({
        model: spec.placeholderId,
        label: spec.displayName,
        quotaInfo: { remainingFraction, resetTime },
        ...extra,
    });
    const hydrogenSpecs = panel.specs.filter(s => s.displayName.startsWith('Gemini 4 Hydrogen (') && !s.displayName.includes('Orchestrator'));
    const claudeOpus55Specs = panel.specs.filter(s => s.displayName.startsWith('Claude Opus 5.5 ('));
    const configs = [
        ...neon.map(spec => config(spec)),
        config(findSpec('MODEL_PLACEHOLDER_M528'), 0.52),
        config(findSpec('MODEL_PLACEHOLDER_M427'), 0.52),
        config(findSpec('MODEL_PLACEHOLDER_M417'), 0.52),
        config(findSpec('MODEL_PLACEHOLDER_M667'), 0.52),
        config(findSpec('MODEL_PLACEHOLDER_M681'), 0.52),
        config(findSpec('MODEL_PLACEHOLDER_M401'), 0.91),
        config(findSpec('MODEL_PLACEHOLDER_M402'), 0.91),
        config(findSpec('MODEL_PLACEHOLDER_M404'), 0.91),
        config(findSpec('MODEL_OPENAI_GPT_OSS_120B_MEDIUM'), 0.91, { tagTitle: 'Notice', tagDescription: 'Model will be deprecated soon' }),
    ];
    const multiFamilyConfigs = [
        ...neon.map(spec => config(spec, 0.52)),
        ...hydrogenSpecs.map(spec => config(spec, 0.52)),
        ...claudeOpus55Specs.map(spec => config(spec, 0.91)),
    ];
    return { neon, configs, multiFamilyConfigs, claude: findSpec('MODEL_PLACEHOLDER_M402'), config };
}

async function runScreenshotExport(args, panel, configs, fixtures, browserSession, fixedClock) {
    const screenshotLang = args['screenshot-lang'];
    assert(Object.hasOwn(LANGUAGES, screenshotLang), `unsupported --screenshot-lang: ${screenshotLang} (use both, en, or zh)`);
    const themes = resolveScreenshotThemes(args['screenshot-theme']);
    if (args.screenshot) {
        assert.equal(themes.length, 1, '--screenshot takes a single theme (use --screenshots-dir with --screenshot-theme=both)');
    }
    const shotWidth = Math.max(320, parseInt(args['screenshot-width'], 10) || 1200);
    const shotHeight = Math.max(600, parseInt(args['screenshot-height'], 10) || 860);
    const html = await panel.render(screenshotLang, configs, fixtures.populated);
    const output = path.resolve(args.screenshot || args['screenshots-dir']);
    if (!args.overwrite) {
        assert(!fs.existsSync(output), `screenshot output path already exists: ${output} (pass --overwrite to replace)`);
    }

    function capture(rawView, destination) {
        const resolved = resolveViewId(rawView);
        assert(resolved, `unknown screenshot tab/view: ${rawView}`);
        browserSession.selectTab(resolved.tab);
        browserSession.evaluate('window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }');
        browserSession.settleAnimations();
        browserSession.browser(['screenshot', destination]);
    }

    const saved = [];
    for (const theme of themes) {
        browserSession.open(
            browserFixture(html, theme, THEME_TOKENS[theme], { fixedClockIso: fixedClock?.iso }),
            shotWidth,
            shotHeight,
        );
        browserSession.waitFor('(async () => { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } return true; })()', 'fonts settled');
        if (args.screenshot) {
            fs.mkdirSync(path.dirname(output), { recursive: true });
            capture(args['screenshot-tab'], output);
            saved.push(output);
        } else {
            const targetDir = themes.length > 1
                ? path.join(output, theme === 'vscode-light' ? 'light' : 'dark')
                : output;
            fs.mkdirSync(targetDir, { recursive: true });
            for (const view of ALL_VIEWS) {
                const dest = path.join(targetDir, SCREENSHOT_FILENAMES[view]);
                capture(view, dest);
                saved.push(dest);
            }
        }
    }
    console.log(JSON.stringify({ mode: 'screenshots', lang: screenshotLang, themes, width: shotWidth, height: shotHeight, count: saved.length, output }, null, 2));
}

async function runBrowserMatrix(args, packageJSON, installedDir) {
    const fixtureEnv = createIsolatedFixtureEnv({
        prefix: 'installed-monitor-ui-',
        fixtureDir: args['fixture-dir'],
    });
    const guardContext = {
        native: false,
        isolatedFixture: true,
        fixtureDir: fixtureEnv.rootDir,
        stateFilePath: fixtureEnv.statePath,
    };
    const browserSession = createBrowserSession(fixtureEnv);
    const failures = [];
    let passed = 0;

    function runCase(name, fn, restartable = false) {
        try {
            fn();
            passed += 1;
        } catch (error) {
            if (!restartable || !browserSession.isTransientError(error)) {
                failures.push({ name, message: error.message });
                return;
            }
            browserSession.noteRetry();
            browserSession.resetSession('retry');
            try {
                if (typeof restartable === 'function') { restartable(); }
                fn();
                passed += 1;
            } catch (retryError) {
                failures.push({ name, message: retryError.message });
            }
        }
    }

    const explicitClock = parseFixedClockIso(args.clock);
    const activeClock = explicitClock || parseFixedClockIso(CLOCK_REGIMES.pre);

    try {
        const panel = loadInstalledPanel(packageJSON, installedDir, harness.REPO_ROOT, fixtureEnv);

        await withHostFixedClock(activeClock.iso, async (clock) => {
            const resetTime = new Date(clock.epochMs + 3_600_000).toISOString();
            const { neon, configs, multiFamilyConfigs, claude } = buildModelCatalogFixture(panel, resetTime);
            const activeUsage = {
                cascadeId: 'root-coord-1',
                title: 'Review release changes',
                model: neon[4].placeholderId,
                modelDisplayName: neon[4].displayName,
                contextUsed: 214500,
                contextLimit: 512000,
                totalOutputTokens: 1050,
                totalToolCallOutputTokens: 3200,
                stepCount: 16,
                hasGaps: false,
                lastModelUsage: { inputTokens: 150000, outputTokens: 1050, cacheReadTokens: 32000, cacheCreationTokens: 4000 },
                compressionDetected: false,
                checkpointCompressionDrop: 0,
                estimatedDeltaSinceCheckpoint: 0,
                isEstimated: false,
                tokenUsageSource: 'planner',
            };
            const fixtures = buildEditorialFixtures(activeUsage, [neon[4], claude], panel.modules, resetTime, clock.epochMs, fixtureEnv);

            if (args.screenshot || args['screenshots-dir']) {
                await runScreenshotExport(args, panel, configs, fixtures, browserSession, clock);
                return;
            }

            // 1. Editorial 5-tab + topbar ⚙️/ⓘ matrix under fixed clock
            const runLangs = args.smoke ? ['both'] : Object.keys(LANGUAGES);
            const matrixThemes = args.smoke
                ? [['vscode-light', THEME_TOKENS['vscode-light']], ['vscode-dark', THEME_TOKENS['vscode-dark']]]
                : Object.entries(THEME_TOKENS);

            for (const lang of runLangs) {
                const html = await panel.render(lang, configs, fixtures.populated);
                for (const [theme, tokens] of matrixThemes) {
                    const source = browserFixture(html, theme, tokens, { fixedClockIso: clock.iso });
                    const widths = args.smoke ? [320, 1280] : [320, 480, 960, 1280];
                    for (const width of widths) {
                        browserSession.open(source, width);
                        for (const view of ALL_VIEWS) {
                            runCase(`v1.18 editorial ${lang} ${theme} ${width}px ${view} (${clock.regime})`, () => {
                                const reading = browserSession.measureTab(view, editorialReadings);
                                assertEditorialView(reading, {
                                    lang,
                                    state: 'populated',
                                    theme,
                                    width,
                                    tab: view,
                                    packageJSON,
                                    expectedClock: clock,
                                });
                                if ((theme === 'vscode-light' || theme === 'vscode-dark') && (width === 320 || width === 1280)) {
                                    browserSession.auditChromeAndPane(view);
                                }
                            }, () => browserSession.open(source, width));
                        }
                    }
                }
            }

            // 2. Interactive v1.18 Plan C + Swarm + Popover + Destructive-Action Guarded Calendar Clear
            const richHtml = await panel.render('both', configs, fixtures.populated);
            const richFixture = browserFixture(richHtml, 'vscode-dark', THEME_TOKENS['vscode-dark'], { fixedClockIso: clock.iso });
            const reopenRich = () => browserSession.open(richFixture, 960);
            reopenRich();

            const clickCentered = (selector, { scrollTop = false } = {}) => {
                browserSession.evaluate(`(() => {
                    const pop = document.getElementById('acmRichTipPopover');
                    if (pop) { pop.hidden = true; pop.setAttribute('aria-hidden', 'true'); pop.setAttribute('data-pinned', 'false'); }
                    if (${scrollTop ? 'true' : 'false'}) {
                        window.scrollTo(0, 0);
                    } else {
                        const el = document.querySelector(${JSON.stringify(selector)});
                        if (el) { el.scrollIntoView({ block: 'center', inline: 'center' }); }
                    }
                })()`);
                browserSession.click(selector);
            };

            runCase('Swarm Inspect / Back to Main / Retarget / Handoff v2 / Recovery Brief actions', () => {
                browserSession.selectTab('overview');
                const detail = browserSession.evaluate(`document.querySelector('#overviewSwarmStrip [data-action="inspectMember"]').closest('details').id`);
                clickCentered('#' + detail + ' > summary');
                assert(browserSession.evaluate(`document.getElementById(${JSON.stringify(detail)}).open`), 'Member details expand in place');
                clickCentered('#' + detail + ' [data-action="inspectMember"]');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'inspectMember')"), 'Inspect member posts inspectMember');
                clickCentered('[data-inspect-banner="true"] [data-action="clearInspect"]', { scrollTop: true });
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'clearInspect')"), 'Back to Main posts clearInspect');
                clickCentered('[data-retarget-banner="true"] [data-action="retargetLockedRoot"]');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'retargetLockedRoot')"), 'Retarget posts retargetLockedRoot');
                clickCentered('#compactionRecoveryBrief [data-action="dismissRecoveryBrief"]');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'dismissRecoveryBrief')"), 'Dismiss Recovery Brief posts dismissRecoveryBrief');
                assert.deepEqual(browserSession.evaluate('testState.errors'), []);
            }, reopenRich);

            runCase('Per-view 479/480/481 compact language breakpoint without mutating host', () => {
                for (const [width, compact] of [[481, false], [480, true], [479, true], [960, false]]) {
                    browserSession.browser(['set', 'viewport', String(width), '800']);
                    // Setting the viewport can return before Chromium delivers resize/ResizeObserver.
                    browserSession.waitFor(`innerWidth === ${width} && document.body.dataset.compactLang === '${compact}'
                        && document.body.dataset.viewLang === ${compact ? 'document.body.dataset.primaryLang' : "'both'"}`,
                    `Width ${width} resolves ${compact ? 'compact' : 'bilingual'} language`);
                }
                assert.equal(
                    browserSession.evaluate("testState.messages.filter(m => m.command === 'switchLanguage').length"),
                    0,
                    'viewport compacting NEVER mutates host language',
                );
            }, reopenRich);

            runCase('Calendar two-step Clear Calendar History (strictly isolated temp fixture guard)', () => {
                // MANDATORY DESTRUCTIVE GUARD: refuses live IDE or any non-isolated path!
                assertDestructiveActionAllowed(guardContext, 'clearCalendarHistory');

                browserSession.selectTab('calendar');
                assert.equal(browserSession.evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), true);
                clickCentered('#clearCalendarBtn');
                assert.equal(browserSession.evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), false);
                assert.equal(browserSession.evaluate("testState.messages.some(m => m.command === 'clearCalendarHistory')"), false);
                clickCentered('#cancelClearCalendarBtn');
                assert.equal(browserSession.evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), true);
                clickCentered('#clearCalendarBtn');
                clickCentered('#confirmClearCalendarBtn');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'clearCalendarHistory')"),
                    'Confirm posts clearCalendarHistory inside stubbed isolated fixture');
                assert.deepEqual(browserSession.evaluate('testState.errors'), []);
            }, reopenRich);

            runCase('Settings update shortcut, disclosures, currency and backup actions', () => {
                browserSession.selectTab('about');
                clickCentered('[data-navigate-tab="updates"]');
                browserSession.waitFor("document.body.dataset.activeTab === 'settings' && document.getElementById('updatesSettingsCard').contains(document.activeElement)", 'About opens the version card in Settings');
                clickCentered('#costCurrencyHistoryCard > summary');
                assert(browserSession.evaluate("document.getElementById('costCurrencyHistoryCard').open"));
                browserSession.browser(['select', '#displayCurrencySelect', 'CAD']);
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'setAppSetting' && m.key === 'displayCurrency' && m.value === 'CAD')"));
                clickCentered('#settingsBackupCard > summary');
                clickCentered('[data-action="exportSettingsBackup"]');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'exportSettingsBackup')"));
                browserSession.click('[data-action="exportRedactedDiagnostics"]');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'exportRedactedDiagnostics')"));
                assert.deepEqual(browserSession.evaluate('testState.errors'), []);
            }, reopenRich);

            runCase('Overview credits shortcut opens the editable local reminder', () => {
                browserSession.selectTab('overview');
                clickCentered('[data-overview-anchor="profileBillingDayInput"]');
                browserSession.browser(['wait', '--fn', "document.body.dataset.activeTab === 'models' && document.activeElement?.id === 'profileBillingDayInput'"]);
                assert.equal(browserSession.evaluate("document.querySelector('#profileBillingDayInput').closest('[role=tabpanel]').id"), 'tab-models');
                assert.equal(browserSession.evaluate("testState.messages.some(m => m.command === 'setAccountBillingDay')"), false);
            }, reopenRich);

            runCase('Account popover & Profile privacy toggle with opaque accountHandle (SEC-04)', () => {
                browserSession.click('#acctPopoverTrigger');
                browserSession.waitFor("Boolean(document.querySelector('#acctPopoverPanel:not([hidden])'))", 'Account popover opened');
                assert.equal(browserSession.evaluate("document.querySelectorAll('#acctPopoverBody [data-email]').length"), 0, 'zero data-email in Account popover');
                browserSession.browser(['press', 'Escape']);
                browserSession.waitFor("Boolean(document.querySelector('#acctPopoverPanel')?.hidden)", 'Escape closes Account popover');
                assert.equal(browserSession.evaluate("document.activeElement?.id"), 'acctPopoverTrigger');

                browserSession.selectTab('models');
                browserSession.evaluate("document.querySelector('#privacyToggle')?.scrollIntoView({ block: 'center' })");
                browserSession.click('#privacyToggle');
                assert(browserSession.evaluate("testState.messages.some(m => m.command === 'setPrivacyMask')"), 'Privacy toggle sends setPrivacyMask');
                assert.deepEqual(browserSession.evaluate('testState.errors'), []);
            }, reopenRich);

            // 3. StatusBarManager hover matrix under active clock
            runCase(`StatusBar hover matrix (${clock.regime})`, () => {
                const fullHover = panel.renderStatusBar('full', multiFamilyConfigs, {
                    usage: activeUsage,
                    credits: 1200,
                    billingDay: 15,
                    planName: 'Pro',
                    tierName: 'Google AI Pro',
                    quotaSummary: fixtures.v1173.quotaSummary,
                    gmSummary: fixtures.populated.gmSummary,
                    activeCascadeId: activeUsage.cascadeId,
                });
                assert(
                    !/账户|冷缓存|首次响应|生成器调用|模型上限|暂停刷新|令牌|\b(?:Prompt|Flow)\s+(?:Credits|额度)/i.test(fullHover.tooltip),
                    'StatusBar hover respects v1.18 glossary',
                );
                assert(fullHover.tooltip.includes('Gemini') && fullHover.tooltip.includes('Claude / GPT'));
            });
        });

        // 4. Dual-side host + browser fixed-clock verification for BOTH pre & post 2026-12-01 UTC
        if (args['clock-matrix'] || !args.clock) {
            for (const regimeIso of [CLOCK_REGIMES.pre, CLOCK_REGIMES.post]) {
                await withHostFixedClock(regimeIso, async (clock) => {
                    const resetTime = new Date(clock.epochMs + 3_600_000).toISOString();
                    const { neon, configs, claude } = buildModelCatalogFixture(panel, resetTime);
                    const baseUsage = {
                        cascadeId: 'clock-fixture',
                        title: 'Dual-clock pricing check',
                        model: 'MODEL_PLACEHOLDER_M427',
                        modelDisplayName: 'Gemini 4 Carbon (High)',
                        contextUsed: 120_000,
                        contextLimit: 512_000,
                        stepCount: 4,
                        isEstimated: false,
                        hasGaps: false,
                    };
                    const fixtures = buildEditorialFixtures(baseUsage, [neon[4], claude], panel.modules, resetTime, clock.epochMs, fixtureEnv);
                    const html = await panel.render('both', configs, fixtures.populated);
                    const wrapped = browserFixture(html, 'vscode-dark', THEME_TOKENS['vscode-dark'], { fixedClockIso: clock.iso });
                    runCase(`Dual-side host+browser fixed clock ${clock.iso} (${clock.regime})`, () => {
                        browserSession.open(wrapped, 1280);
                        const calView = browserSession.measureTab('calendar', editorialReadings);
                        assertEditorialView(calView, {
                            lang: 'both',
                            state: 'populated',
                            theme: 'vscode-dark',
                            width: 1280,
                            tab: 'calendar',
                            packageJSON,
                            expectedClock: clock,
                        });
                    }, () => browserSession.open(wrapped, 1280));
                });
            }
        }
    } finally {
        browserSession.close();
        fixtureEnv.cleanup();
    }

    if (args.screenshot || args['screenshots-dir']) {
        return;
    }

    const stats = browserSession.getStats();
    console.log(JSON.stringify({
        mode: args.smoke ? 'installed-code Chromium smoke (v1.18)' : 'installed-code Chromium fixtures (v1.18)',
        clock: activeClock.iso,
        passed,
        browserRetries: stats.browserRetries,
        sessionRecycles: stats.sessionRecycles,
        failures,
    }, null, 2));
    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

module.exports = {
    buildEditorialFixtures,
    buildModelCatalogFixture,
    editorialReadings,
    measurements,
    assertEditorialView,
    runDualClockHostSelfTest,
    runNativeSmoke,
    runScreenshotExport,
    runBrowserMatrix,
};

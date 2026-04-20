import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTracker, type ActivityTrackerState } from '../src/activity-tracker';
import { rpcCall } from '../src/rpc-client';
import { initI18nFromState } from '../src/i18n';
import type { GMSummary } from '../src/gm-tracker';

vi.mock('../src/rpc-client', () => ({
    rpcCall: vi.fn(),
}));

const rpcCallMock = vi.mocked(rpcCall);

function setLanguage(lang: 'zh' | 'en' | 'both') {
    initI18nFromState({
        get: () => lang,
    } as never);
}

function makeUserStep(text: string, createdAt: string) {
    return {
        type: 'CORTEX_STEP_TYPE_USER_INPUT',
        metadata: { createdAt },
        userInput: {
            userResponse: text,
        },
    };
}

function makePlannerStep(createdAt: string, response = '') {
    return {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        metadata: {
            createdAt,
            generatorModel: 'MODEL_PLACEHOLDER_M37',
        },
        plannerResponse: response
            ? { response, modifiedResponse: response }
            : {},
    };
}

function makePlannerToolOnlyStep(createdAt: string, messageId: string) {
    return {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        metadata: {
            createdAt,
            generatorModel: 'MODEL_PLACEHOLDER_M37',
        },
        plannerResponse: {
            messageId,
            toolCalls: [
                {
                    id: 'tool-1',
                    name: 'view_file',
                    argumentsJson: '{}',
                },
            ],
        },
    };
}

function makeReasoningSummary(cascadeId: string, stepIndex: number, createdAt: string): GMSummary {
    return {
        conversations: [
            {
                cascadeId,
                title: 'conv',
                totalSteps: stepIndex + 1,
                coveredSteps: 1,
                coverageRate: 1,
                calls: [
                    {
                        stepIndices: [stepIndex],
                        executionId: 'exec-1',
                        model: 'MODEL_PLACEHOLDER_M37',
                        modelDisplay: 'Gemini 3.1 Pro (High)',
                        responseModel: 'gemini-3.1-pro-high',
                        modelAccuracy: 'exact',
                        inputTokens: 123,
                        outputTokens: 45,
                        thinkingTokens: 6,
                        responseTokens: 45,
                        cacheReadTokens: 78,
                        cacheCreationTokens: 0,
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        ttftSeconds: 1.2,
                        streamingSeconds: 2.3,
                        credits: 0,
                        creditType: '',
                        hasError: false,
                        errorMessage: '',
                        contextTokensUsed: 999,
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
                        retries: 0,
                        stopReason: '',
                        retryTokensIn: 0,
                        retryTokensOut: 0,
                        retryCredits: 0,
                        retryErrors: [],
                        timeSinceLastInvocation: 0,
                        tokenBreakdownGroups: [],
                        createdAt,
                        latestStableMessageIndex: stepIndex,
                        startStepIndex: 0,
                        checkpointIndex: 0,
                        checkpointSummaries: [],
                        aiSnippetsByStep: {},
                    },
                ],
            },
        ],
        modelBreakdown: {
            'Gemini 3.1 Pro (High)': {
                callCount: 1,
                stepsCovered: 1,
                totalInputTokens: 123,
                totalOutputTokens: 45,
                totalThinkingTokens: 6,
                totalCacheRead: 78,
                totalCacheCreation: 0,
                totalCredits: 0,
                avgTTFT: 1.2,
                minTTFT: 1.2,
                maxTTFT: 1.2,
                avgStreaming: 2.3,
                cacheHitRate: 1,
                responseModel: 'gemini-3.1-pro-high',
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                completionConfig: null,
                hasSystemPrompt: false,
                toolCount: 0,
                promptSectionTitles: [],
                totalRetries: 0,
                errorCount: 0,
                exactCallCount: 1,
                placeholderOnlyCalls: 0,
            },
        },
        totalCalls: 1,
        totalStepsCovered: 1,
        totalCredits: 0,
        totalInputTokens: 123,
        totalOutputTokens: 45,
        totalCacheRead: 78,
        totalCacheCreation: 0,
        totalThinkingTokens: 6,
        contextGrowth: [],
        fetchedAt: createdAt,
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
    };
}

function makeReasoningSummaryWithPromptSnippet(
    cascadeId: string,
    stepIndex: number,
    createdAt: string,
    promptSnippet: string,
    promptSource: 'none' | 'messagePrompts' | 'messageMetadata' = 'messagePrompts',
): GMSummary {
    const summary = makeReasoningSummary(cascadeId, stepIndex, createdAt);
    summary.conversations[0].calls[0].promptSnippet = promptSnippet;
    summary.conversations[0].calls[0].promptSource = promptSource;
    return summary;
}

describe('ActivityTracker planner refresh', () => {
    beforeEach(() => {
        rpcCallMock.mockReset();
        setLanguage('both');
    });

    it('revisits empty planner steps and backfills the final response without stepCount growth', async () => {
        const tracker = new ActivityTracker();
        const ls = {} as never;
        const trajectories = [
            {
                cascadeId: 'conv-1',
                stepCount: 2,
                status: 'CASCADE_RUN_STATUS_IDLE',
                requestedModel: '',
                generatorModel: '',
            },
        ];

        rpcCallMock
            .mockResolvedValueOnce({
                steps: [
                    makeUserStep('first prompt', '2026-03-26T05:00:00.000Z'),
                    makePlannerStep('2026-03-26T05:00:01.000Z'),
                ],
            })
            .mockResolvedValueOnce({
                steps: [
                    makeUserStep('first prompt', '2026-03-26T05:00:00.000Z'),
                    makePlannerStep('2026-03-26T05:00:01.000Z', 'final answer from Gemini'),
                ],
            });

        await tracker.processTrajectories(ls, trajectories);
        const firstSummary = tracker.getSummary();
        expect(firstSummary.recentSteps.some(e => e.stepIndex === 1 && e.aiResponse)).toBe(false);

        await tracker.processTrajectories(ls, trajectories);
        const repairedSummary = tracker.getSummary();
        const repairedEvent = repairedSummary.recentSteps.find(e => e.stepIndex === 1);
        expect(repairedEvent?.aiResponse).toContain('final answer from Gemini');
    });

    it('rehydrates short restored conversations once so stale empty planner rows can self-heal', async () => {
        const tracker = new ActivityTracker();
        const ls = {} as never;
        const trajectories = [
            {
                cascadeId: 'conv-restore',
                stepCount: 2,
                status: 'CASCADE_RUN_STATUS_IDLE',
                requestedModel: '',
                generatorModel: '',
            },
        ];

        rpcCallMock.mockResolvedValueOnce({
            steps: [
                makeUserStep('restore prompt', '2026-03-26T06:00:00.000Z'),
                makePlannerStep('2026-03-26T06:00:01.000Z'),
            ],
        });
        await tracker.processTrajectories(ls, trajectories);

        const restored = ActivityTracker.restore(tracker.serialize());

        rpcCallMock.mockResolvedValueOnce({
            steps: [
                makeUserStep('restore prompt', '2026-03-26T06:00:00.000Z'),
                makePlannerStep('2026-03-26T06:00:01.000Z', 'restored final answer'),
            ],
        });

        await restored.processTrajectories(ls, trajectories);
        const summary = restored.getSummary();
        const repairedEvent = summary.recentSteps.find(e => e.stepIndex === 1);
        expect(repairedEvent?.aiResponse).toContain('restored final answer');
    });

    it('dedupes remapped Gemini step events by raw-step fingerprint instead of unstable stepIndex', () => {
        const tracker = new ActivityTracker() as any;
        const step = makeUserStep('same prompt', '2026-03-27T13:14:46.058Z');

        const first = tracker._buildStepTimelineEvent(step, 318, 'conv-shifted');
        const second = tracker._buildStepTimelineEvent(step, 320, 'conv-shifted');

        tracker._upsertStepTimelineEvent(first);
        tracker._upsertStepTimelineEvent(second);

        const events = tracker.getSummary().recentSteps.filter((event: any) => event.cascadeId === 'conv-shifted');
        expect(events).toHaveLength(1);
        expect(events[0].stepIndex).toBe(320);
        expect(events[0].userInput).toContain('same prompt');
    });

    it('keeps user rows clean when GM exact attribution lands on the same step index', () => {
        const tracker = new ActivityTracker() as any;
        const cascadeId = 'conv-user';
        const createdAt = '2026-03-27T13:08:53.982Z';
        const userEvent = tracker._buildStepTimelineEvent(makeUserStep('用户消息', createdAt), 264, cascadeId);

        tracker._upsertStepTimelineEvent(userEvent);
        tracker.injectGMData(makeReasoningSummary(cascadeId, 264, createdAt));

        const restoredUser = tracker.getSummary().recentSteps.find((event: any) =>
            event.cascadeId === cascadeId && event.category === 'user'
        );
        expect(restoredUser?.model).toBe('');
        expect(restoredUser?.modelBasis).toBe('step');
        expect(restoredUser?.gmInputTokens).toBeUndefined();
        expect(restoredUser?.gmExecutionId).toBeUndefined();
    });

    it('does not backfill step-based planner rows with GM prompt snippets when the planner response itself is empty', () => {
        const tracker = new ActivityTracker() as any;
        const cascadeId = 'conv-messageid';
        const createdAt = '2026-03-27T13:18:53.982Z';
        const plannerEvent = tracker._buildStepTimelineEvent(
            makePlannerToolOnlyStep(createdAt, 'bot-fc2dab1b-0317-47cc-8b08-3384e2e70caf'),
            406,
            cascadeId,
        );

        tracker._upsertStepTimelineEvent(plannerEvent);
        tracker.injectGMData(makeReasoningSummaryWithPromptSnippet(
            cascadeId,
            406,
            createdAt,
            'bot-fc2dab1b-0317-47cc-8b08-3384e2e70caf',
        ));

        const repairedEvent = tracker.getSummary().recentSteps.find((event: any) =>
            event.cascadeId === cascadeId && event.stepIndex === 406
        );
        // The step-source planner event is suppressed by GM range suppression,
        // replaced by gm_virtual. The gm_virtual detail reflects promptSnippet
        // filtering: 'bot-...' is low-signal so it falls through to 'GM call'.
        expect(repairedEvent?.source).toBe('gm_virtual');
        expect(repairedEvent?.gmPromptSnippet).toBe('bot-fc2dab1b-0317-47cc-8b08-3384e2e70caf');
    });

    it('keeps gm_virtual rows structural-only even when GM carries a readable prompt snippet', () => {
        const tracker = new ActivityTracker() as any;
        tracker._trajectories.set('conv-virtual', {
            stepCount: 100,
            processedIndex: 100,
            dominantModel: 'Gemini 3.1 Pro (High)',
            lastStatus: 'CASCADE_RUN_STATUS_IDLE',
            requestedModel: '',
            generatorModel: '',
        });

        tracker.injectGMData(makeReasoningSummaryWithPromptSnippet(
            'conv-virtual',
            120,
            '2026-03-27T13:28:53.982Z',
            '现在让我查看 buildOverallSummary 和 buildCalendarTabContent 函数。',
        ));

        const virtualEvent = tracker.getSummary().recentSteps.find((event: any) =>
            event.cascadeId === 'conv-virtual' && event.source === 'gm_virtual'
        );
        expect(virtualEvent?.aiResponse).toBeUndefined();
        expect(virtualEvent?.detail).toContain('现在让我查看');
        expect(virtualEvent?.gmPromptSnippet).toBe('现在让我查看 buildOverallSummary 和 buildCalendarTabContent 函数。');
    });

    it('compacts duplicated persisted recent steps during restore so stale state self-heals on reload', () => {
        const createdAt = '2026-03-27T13:14:46.058Z';
        const duplicateEvent = {
            timestamp: createdAt,
            icon: '💬',
            category: 'user' as const,
            model: 'Gemini 3.1 Pro (强)',
            detail: '',
            durationMs: 0,
            userInput: '重复用户消息',
            fullUserInput: '重复用户消息',
            stepIndex: 318,
            cascadeId: 'conv-persist',
            source: 'step' as const,
            modelBasis: 'gm_exact' as const,
            gmInputTokens: 123,
            gmExecutionId: 'exec-dup',
        };

        const restored = ActivityTracker.restore({
            version: 1,
            warmedUp: true,
            trajectoryBaselines: {},
            summary: {
                totalUserInputs: 1,
                totalReasoning: 0,
                totalToolCalls: 0,
                totalErrors: 0,
                totalCheckpoints: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalToolReturnTokens: 0,
                estSteps: 0,
                modelStats: {},
                globalToolStats: {},
                recentSteps: [duplicateEvent, { ...duplicateEvent }],
                sessionStartTime: createdAt,
                subAgentTokens: [],
                checkpointHistory: [],
                conversationBreakdown: [],
            },
        });

        const steps = restored.getSummary().recentSteps.filter(event => event.cascadeId === 'conv-persist');
        expect(steps).toHaveLength(1);
        expect(steps[0].model).toBe('');
        expect(steps[0].gmExecutionId).toBeUndefined();
    });

    it('removes stale planner rows when later polls insert non-renderable internal steps before the final response', async () => {
        const tracker = new ActivityTracker();
        const ls = {} as never;

        rpcCallMock.mockResolvedValueOnce({
            steps: [
                makeUserStep('prompt', '2026-03-26T07:00:00.000Z'),
                makePlannerStep('2026-03-26T07:00:01.000Z', 'draft reply'),
            ],
        });
        await tracker.processTrajectories(ls, [
            {
                cascadeId: 'conv-shift',
                stepCount: 2,
                status: 'CASCADE_RUN_STATUS_RUNNING',
                requestedModel: '',
                generatorModel: '',
            },
        ]);

        rpcCallMock.mockResolvedValueOnce({
            steps: [
                makeUserStep('prompt', '2026-03-26T07:00:00.000Z'),
                {
                    type: 'CORTEX_STEP_TYPE_GENERATE_IMAGE',
                    metadata: {
                        createdAt: '2026-03-26T07:00:01.500Z',
                        generatorModel: 'MODEL_PLACEHOLDER_M37',
                    },
                },
                {
                    type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE',
                    metadata: {
                        createdAt: '2026-03-26T07:00:01.800Z',
                    },
                },
                makePlannerStep('2026-03-26T07:00:02.000Z', 'final reply'),
            ],
        });

        await tracker.processTrajectories(ls, [
            {
                cascadeId: 'conv-shift',
                stepCount: 4,
                status: 'CASCADE_RUN_STATUS_IDLE',
                requestedModel: '',
                generatorModel: '',
            },
        ]);

        const summary = tracker.getSummary();
        const scoped = summary.recentSteps.filter(e => e.cascadeId === 'conv-shift');
        expect(scoped.some(e => e.stepIndex === 1 && e.aiResponse === 'draft reply')).toBe(false);
        expect(scoped.some(e => e.stepIndex === 3 && e.aiResponse === 'final reply')).toBe(true);
    });

    it('merges legacy cross-language model buckets on restore and archives the whole Gemini pool', () => {
        setLanguage('zh');

        const state: ActivityTrackerState = {
            version: 1,
            warmedUp: true,
            trajectoryBaselines: {
                'conv-locale': {
                    stepCount: 23,
                    processedIndex: 23,
                    dominantModel: 'Gemini 3.1 Pro (High)',
                    requestedModel: 'Gemini 3.1 Pro (强)',
                    generatorModel: 'MODEL_PLACEHOLDER_M37',
                },
            },
            summary: {
                totalUserInputs: 0,
                totalReasoning: 0,
                totalToolCalls: 0,
                totalErrors: 0,
                totalCheckpoints: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalToolReturnTokens: 0,
                estSteps: 0,
                modelStats: {
                    'Gemini 3.1 Pro (High)': {
                        modelName: 'Gemini 3.1 Pro (High)',
                        userInputs: 0,
                        reasoning: 1,
                        toolCalls: 2,
                        errors: 0,
                        checkpoints: 0,
                        totalSteps: 3,
                        thinkingTimeMs: 4900,
                        toolTimeMs: 2700,
                        inputTokens: 0,
                        outputTokens: 0,
                        toolReturnTokens: 0,
                        toolBreakdown: { mcp_tool: 1, view_file: 1 },
                        estSteps: 0,
                    },
                    'Gemini 3.1 Pro (强)': {
                        modelName: 'Gemini 3.1 Pro (强)',
                        userInputs: 0,
                        reasoning: 10,
                        toolCalls: 7,
                        errors: 0,
                        checkpoints: 3,
                        totalSteps: 20,
                        thinkingTimeMs: 35700,
                        toolTimeMs: 69600,
                        inputTokens: 0,
                        outputTokens: 0,
                        toolReturnTokens: 0,
                        toolBreakdown: { search_web: 6, browser: 1 },
                        estSteps: 0,
                    },
                },
                globalToolStats: {},
                recentSteps: [
                    {
                        timestamp: '2026-03-26T05:56:18.000Z',
                        icon: '🧠',
                        category: 'reasoning',
                        model: 'Gemini 3.1 Pro (High)',
                        detail: '',
                        durationMs: 0,
                        aiResponse: 'final answer',
                        cascadeId: 'conv-locale',
                        stepIndex: 30,
                        source: 'step',
                        modelBasis: 'step',
                    },
                ],
                sessionStartTime: '2026-03-26T05:00:00.000Z',
                subAgentTokens: [],
                checkpointHistory: [],
                conversationBreakdown: [],
                gmModelBreakdown: {
                    'Gemini 3.1 Pro (High)': {
                        callCount: 1,
                        stepsCovered: 3,
                        totalInputTokens: 100,
                        totalOutputTokens: 50,
                        totalThinkingTokens: 10,
                        totalCacheRead: 5,
                        totalCacheCreation: 0,
                        totalCredits: 2,
                        avgTTFT: 4.9,
                        minTTFT: 4.9,
                        maxTTFT: 4.9,
                        avgStreaming: 2.7,
                        cacheHitRate: 1,
                        responseModel: 'gemini-3.1-pro-high',
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        completionConfig: null,
                        hasSystemPrompt: false,
                        toolCount: 2,
                        promptSectionTitles: [],
                        totalRetries: 0,
                        errorCount: 0,
                        exactCallCount: 1,
                        placeholderOnlyCalls: 0,
                    },
                    'Gemini 3.1 Pro (强)': {
                        callCount: 10,
                        stepsCovered: 20,
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalThinkingTokens: 100,
                        totalCacheRead: 50,
                        totalCacheCreation: 0,
                        totalCredits: 20,
                        avgTTFT: 5.9,
                        minTTFT: 5.9,
                        maxTTFT: 5.9,
                        avgStreaming: 6.5,
                        cacheHitRate: 0.9,
                        responseModel: 'gemini-3.1-pro-high',
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        completionConfig: null,
                        hasSystemPrompt: false,
                        toolCount: 6,
                        promptSectionTitles: [],
                        totalRetries: 0,
                        errorCount: 0,
                        exactCallCount: 10,
                        placeholderOnlyCalls: 0,
                    },
                },
            },
            archives: [],
        };

        const tracker = ActivityTracker.restore(state);
        const summary = tracker.getSummary();
        const zhName = 'Gemini 3.1 Pro (强)';

        expect(Object.keys(summary.modelStats)).toEqual([zhName]);
        expect(summary.modelStats[zhName]?.totalSteps).toBe(23);
        expect(summary.modelStats[zhName]?.reasoning).toBe(11);
        expect(summary.modelStats[zhName]?.toolCalls).toBe(9);
        expect(summary.gmModelBreakdown?.[zhName]?.callCount).toBe(11);
        expect(summary.recentSteps.every(event => !event.model || event.model === zhName)).toBe(true);

        const archive = tracker.archiveAndReset();
        expect(archive?.summary.modelStats[zhName]?.totalSteps).toBe(23);
        expect(archive?.summary.gmModelBreakdown?.[zhName]?.callCount).toBe(11);
        expect(Object.keys(tracker.getSummary().modelStats)).toHaveLength(0);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTracker, type ActivityTrackerState } from '../src/activity-tracker';
import { rpcCall } from '../src/rpc-client';
import { initI18nFromState } from '../src/i18n';

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

        const archive = tracker.archiveAndReset(['MODEL_PLACEHOLDER_M37']);
        expect(archive?.summary.modelStats[zhName]?.totalSteps).toBe(23);
        expect(archive?.summary.gmModelBreakdown?.[zhName]?.callCount).toBe(11);
        expect(Object.keys(tracker.getSummary().modelStats)).toHaveLength(0);
    });
});

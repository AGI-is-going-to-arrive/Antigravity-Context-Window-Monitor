// Consolidated Domain Suite: GM Tracker Core, Model Capture & Context Compression
import { describe, expect, it, vi } from 'vitest';
import {
    applyTrajectoryModelHints,
    extractTrajectoryModelHints,
    mergeGMCallEntries,
    parseGMEntry,
    shouldEnrichConversation,
} from '../src/gm/parser';
import { resolveModelId } from '../src/models';
import { costFromTokens, findPricing } from '../src/pricing-store';
import { hasGMSummaryChanged, hasSameUsageInputs, measuredContextDrop, persistClearedToolCatalog } from '../src/extension';
import {
    buildSummaryFromConversations,
    filterGMSummaryByModels,
    type GMCallEntry,
    type GMConversationData,
    type GMModelStats,
    type GMSummary,
    GMTracker,
    mergeGMModelStats,
} from '../src/gm-tracker';
import { MonitorStore } from '../src/monitor-store';
import type { ContextUsage } from '../src/tracker';

describe('[gm-agent-hub]', () => {
    // Sanitized from the first authorized Low test in the installed 1.16.19
    // extension, 2026-10-31. Contains no prompts, credentials, or account data.
    function lowFixture() {
        const usage = { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '12905', outputTokens: '5',
            responseOutputTokens: '5', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI' };
        return { stepIndices: [1], chatModel: {
            model: 'MODEL_PLACEHOLDER_M419', responseModel: 'gemini-4-argon',
            modelDisplayName: 'Gemini 4 Argon (Low)', usage,
            chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 18324, maxContextTokens: 256000 } },
            retryInfos: [{ usage }],
        }, plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M419', modelName: 'gemini-4-argon-low', maxOutputTokens: 65536 } };
    }


    describe('agent-hub GM telemetry', () => {
        it('reads real Low tokens and context capacity without assigning the shared response name to Low', () => {
            const call = parseGMEntry(lowFixture());
            expect(call).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419', modelSource: 'chatModel',
                modelDisplay: 'Gemini 4 Argon (Low)', responseModel: 'gemini-4-argon',
                inputTokens: 12905, outputTokens: 5, responseTokens: 5, thinkingTokens: 0,
                contextWindowCapacity: 256000, contextTokensUsed: 18324,
                retries: 0, retryTokensIn: 0, retryTokensOut: 0, retryCredits: 0, retryErrors: [], hasError: false });
            expect(resolveModelId('gemini-4-argon')).toBeUndefined();
            expect(findPricing(call.model)).toMatchObject({ input: 2, output: 10, cacheRead: 0.1 });
            // With a synthetic user price, only the primary usage is billed once.
            expect(costFromTokens(call, { input: 1, output: 1, thinking: 1, cacheRead: 0, cacheWrite: 0 })).toBe(0.01291);
        });

        it('keeps a valid legacy planner capacity ahead of the new context metadata fallback', () => {
            const fixture = lowFixture();
            const call = parseGMEntry({ ...fixture, plannerConfig: { ...fixture.plannerConfig, truncationThresholdTokens: '128000' } });
            expect(call.contextWindowCapacity).toBe(128000);
        });

        it.each([undefined, null, 0, -1, NaN, Infinity, 1.5, '256000bad', '1e6', '9007199254740992', {}])(
            'rejects invalid planner capacity %s and uses the valid current metadata', invalid => {
                const fixture = lowFixture();
                expect(parseGMEntry({ ...fixture, plannerConfig: { truncationThresholdTokens: invalid } }).contextWindowCapacity).toBe(256000);
            },
        );

        it.each([undefined, null, 0, -1, NaN, Infinity, 1.5, '256000bad', '1e6', '9007199254740992', {}])(
            'reports unknown capacity when both capacity sources are invalid (%s)', invalid => {
                const fixture = lowFixture();
                fixture.chatModel.chatStartMetadata.contextWindowMetadata = { estimatedTokensUsed: 18324, maxContextTokens: invalid as number };
                expect(parseGMEntry(fixture).contextWindowCapacity).toBe(0);
            },
        );

        it('accepts exact decimal-string capacities from protobuf JSON', () => {
            const fixture = lowFixture();
            const chatModel = { ...fixture.chatModel, chatStartMetadata: { contextWindowMetadata: { maxContextTokens: '256000' } } };
            expect(parseGMEntry({ ...fixture, chatModel }).contextWindowCapacity).toBe(256000);
        });

        it('does not count duplicate successful retryInfo usage as retries, errors or additional cost', () => {
            const fixture = lowFixture();
            const chatModel = { ...fixture.chatModel, retries: 2,
                retryInfos: [...fixture.chatModel.retryInfos, ...fixture.chatModel.retryInfos] };
            const call = parseGMEntry({ ...fixture, chatModel });
            expect(call.retries).toBe(0);
            expect(call.retryTokensIn + call.retryTokensOut + call.retryCredits).toBe(0);
            expect(call.hasError).toBe(false);
            expect(call.retryErrors).toEqual([]);
            expect(call.inputTokens).toBe(12905);
            expect(call.outputTokens).toBe(5);
        });

        it('retains failed-attempt telemetry separately and uses legacy retry count only without detail', () => {
            const fixture = lowFixture();
            const chatModel = { ...fixture.chatModel, retries: 4, retryInfos: [
                ...fixture.chatModel.retryInfos,
                { error: 'temporary: temporary', usage: { inputTokens: '10', outputTokens: '2' } },
            ] };
            const call = parseGMEntry({ ...fixture, chatModel });
            expect(call.retries).toBe(1);
            expect(call.retryErrors).toEqual(['temporary']);
            expect(call.retryTokensIn).toBe(10);
            expect(call.retryTokensOut).toBe(2);
            expect(call.inputTokens).toBe(12905);
            expect(parseGMEntry({ ...fixture, chatModel: { ...fixture.chatModel, retries: 4, retryInfos: undefined } }).retries).toBe(3);
        });
    });
});

describe('[gm-model-capture]', () => {
    function makeGM(overrides: {
        model?: string;
        responseModel?: string;
        stepIndices?: number[];
        executionId?: string;
    } = {}): Record<string, unknown> {
        return {
            stepIndices: overrides.stepIndices || [1],
            executionId: overrides.executionId || 'exec-1',
            chatModel: {
                model: overrides.model,
                responseModel: overrides.responseModel,
                usage: {},
                chatStartMetadata: {
                    createdAt: '2026-06-02T00:00:00.000Z',
                    startStepIndex: 1,
                },
            },
        };
    }


    describe('GM model capture', () => {
        it('keeps chatModel.model as the authoritative placeholder identity', () => {
            const call = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M132',
                responseModel: 'gemini-3-flash-a',
            }));

            expect(call.model).toBe('MODEL_PLACEHOLDER_M132');
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toContain('Gemini 3.5 Flash');
        });

        it('does not let a conflicting responseModel sample remap an existing alias', () => {
            expect(resolveModelId('gemini-3-flash-a')).toBe('MODEL_PLACEHOLDER_M132');

            const call = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M133',
                responseModel: 'gemini-3-flash-a',
            }));

            expect(call.model).toBe('MODEL_PLACEHOLDER_M133');
            expect(resolveModelId('gemini-3-flash-a')).toBe('MODEL_PLACEHOLDER_M132');
        });

        it('uses trajectory requestedModel to replace low-trust responseModel fallback', () => {
            const call = parseGMEntry(makeGM({
                responseModel: 'gemini-3-flash-a',
                stepIndices: [42],
            }));

            expect(call.model).toBe('MODEL_PLACEHOLDER_M132');
            expect(call.modelSource).toBe('responseAlias');
            expect(shouldEnrichConversation(50, [call])).toBe(true);

            const [updated] = applyTrajectoryModelHints([call], [
                {
                    stepIndex: 42,
                    metadata: {
                        requestedModel: { model: 'MODEL_PLACEHOLDER_M133' },
                    },
                },
            ]);

            expect(updated.model).toBe('MODEL_PLACEHOLDER_M133');
            expect(updated.modelSource).toBe('trajectory');
        });

        it('does not overwrite an authoritative GM model with trajectory hints', () => {
            const call = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M132',
                responseModel: 'gemini-3-flash-a',
                stepIndices: [42],
            }));

            const [updated] = applyTrajectoryModelHints([call], [
                {
                    stepIndex: 42,
                    metadata: {
                        requestedModel: { model: 'MODEL_PLACEHOLDER_M133' },
                    },
                },
            ]);

            expect(updated.model).toBe('MODEL_PLACEHOLDER_M132');
            expect(updated.modelSource).toBe('chatModel');
        });

        it('falls back to user planner requestedModel when GM model fields are absent', () => {
            const call = parseGMEntry(makeGM({
                stepIndices: [7],
            }));

            const hints = extractTrajectoryModelHints([
                {
                    stepIndex: 7,
                    userInput: {
                        userConfig: {
                            plannerConfig: {
                                requestedModel: { model: 'MODEL_PLACEHOLDER_M187' },
                            },
                        },
                    },
                },
            ]);
            const [updated] = applyTrajectoryModelHints([call], [
                {
                    stepIndex: 7,
                    userInput: {
                        userConfig: {
                            plannerConfig: {
                                requestedModel: { model: 'MODEL_PLACEHOLDER_M187' },
                            },
                        },
                    },
                },
            ]);

            expect(hints.get(7)).toBe('MODEL_PLACEHOLDER_M187');
            expect(updated.model).toBe('MODEL_PLACEHOLDER_M187');
            expect(updated.modelSource).toBe('trajectory');
        });

        it('prefers embedded authoritative model over a primary response alias during merge', () => {
            const primary = parseGMEntry(makeGM({
                responseModel: 'gemini-3-flash-a',
                executionId: 'exec-merge',
            }));
            const embedded = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M187',
                executionId: 'exec-merge',
            }));

            const merged = mergeGMCallEntries(primary, embedded);

            expect(merged.model).toBe('MODEL_PLACEHOLDER_M187');
            expect(merged.modelSource).toBe('chatModel');
        });

        it('captures Gemini 3.6 Flash identity from chatModel and its seeded response alias', () => {
            // The platform renumbered the 3.6 tiers from M264/M265/M266 to M71/M72/M73 (2026-08 live probe).
            expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');

            const call = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M71',
                responseModel: 'gemini-3.6-flash-high',
            }));

            expect(call.model).toBe('MODEL_PLACEHOLDER_M71');
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toContain('Gemini 3.6 Flash');
        });

        it('captures Gemini 3.7 Flash identity from chatModel and its seeded response alias', () => {
            expect(resolveModelId('gemini-3.7-flash-high')).toBe('MODEL_PLACEHOLDER_M298');

            const call = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M298',
                responseModel: 'gemini-3.7-flash-high',
            }));

            expect(call.model).toBe('MODEL_PLACEHOLDER_M298');
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toContain('Gemini 3.7 Flash');
        });

        it.each([
            ['high', 'MODEL_PLACEHOLDER_M318'],
            ['medium', 'MODEL_PLACEHOLDER_M319'],
            ['low', 'MODEL_PLACEHOLDER_M320'],
        ])('captures Gemini 3.8 Flash %s identity from chatModel and its seeded response alias', (tier, model) => {
            expect(resolveModelId(`gemini-3.8-flash-${tier}`)).toBe(model);

            const call = parseGMEntry(makeGM({
                model,
                responseModel: `gemini-3.8-flash-${tier}`,
            }));

            expect(call.model).toBe(model);
            expect(call.modelSource).toBe('chatModel');
            expect(call.modelDisplay).toContain('Gemini 3.8 Flash');
        });

        it('still resolves pre-renumber 3.6 records captured by v1.16.14', () => {
            const call = parseGMEntry(makeGM({
                model: 'MODEL_PLACEHOLDER_M264',
                responseModel: 'gemini-3.6-flash-high',
            }));

            expect(call.model).toBe('MODEL_PLACEHOLDER_M264');
            expect(call.modelDisplay).toContain('Gemini 3.6 Flash');
        });
    });
});

describe('[gm-summary-change]', () => {
    function makeCall(): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-1',
            model: 'MODEL_PLACEHOLDER_M26',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            responseModel: 'claude-opus-4-6-thinking',
            modelAccuracy: 'exact',
            inputTokens: 100,
            outputTokens: 50,
            thinkingTokens: 10,
            responseTokens: 40,
            cacheReadTokens: 5,
            cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 1.2,
            streamingSeconds: 2.3,
            credits: 3,
            creditType: 'ai',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 1200,
            completionConfig: {
                maxTokens: 16384,
                temperature: 1,
                firstTemperature: 1,
                topK: 40,
                topP: 1,
                numCompletions: 1,
                stopPatternCount: 0,
            },
            systemPromptSnippet: 'system',
            toolCount: 2,
            toolNames: ['read_file', 'edit_file'],
            promptSectionTitles: ['system', 'tools'],
            promptSnippet: 'prompt',
            promptSource: 'messagePrompts',
            messagePromptCount: 1,
            messageMetadataKeys: [],
            responseHeaderKeys: [],
            userMessageAnchors: [],
            aiSnippetsByStep: {},
            retries: 0,
            stopReason: 'STOP_REASON_END_TURN',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: '2026-06-01T00:00:00.000Z',
            latestStableMessageIndex: 0,
            startStepIndex: 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            accountEmail: 'user@example.com',
            toolCallsByStep: { 1: ['read_file'] },
            contextWindowCapacity: 160000,
        };
    }


    function makeConversation(): GMConversationData {
        return {
            cascadeId: 'conv-1',
            title: 'Conversation 1',
            totalSteps: 5,
            calls: [makeCall()],
            lifetimeCalls: 1,
            coveredSteps: 1,
            coverageRate: 0.2,
            checkpointSummaries: [{
                checkpointNumber: 1,
                stepIndex: 1,
                tokens: 300,
                fullText: 'checkpoint text',
            }],
            systemContextItems: [{
                type: 'context_injection',
                stepIndex: 1,
                tokens: 200,
                label: 'Context Injection',
                fullText: 'history text',
            }],
            accountCredits: 3,
        };
    }


    function makeSummary(): GMSummary {
        return {
            conversations: [makeConversation()],
            modelBreakdown: {
                'Claude Opus 4.6 (Thinking)': {
                    callCount: 1,
                    stepsCovered: 1,
                    totalInputTokens: 100,
                    totalOutputTokens: 50,
                    totalThinkingTokens: 10,
                    totalCacheRead: 5,
                    totalCacheCreation: 0,
                    totalCredits: 3,
                    avgTTFT: 1.2,
                    minTTFT: 1.2,
                    maxTTFT: 1.2,
                    avgStreaming: 2.3,
                    cacheHitRate: 1,
                    responseModel: 'claude-opus-4-6-thinking',
                    apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
                    completionConfig: {
                        maxTokens: 16384,
                        temperature: 1,
                        firstTemperature: 1,
                        topK: 40,
                        topP: 1,
                        numCompletions: 1,
                        stopPatternCount: 0,
                    },
                    hasSystemPrompt: true,
                    toolCount: 2,
                    promptSectionTitles: ['system', 'tools'],
                    totalRetries: 0,
                    errorCount: 0,
                    creditCallCount: 1,
                    exactCallCount: 1,
                    placeholderOnlyCalls: 0,
                    contextWindowCapacity: 160000,
                },
            },
            totalCalls: 1,
            totalStepsCovered: 1,
            totalCredits: 3,
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalCacheRead: 5,
            totalCacheCreation: 0,
            totalThinkingTokens: 10,
            contextGrowth: [{ step: 1, tokens: 1200, model: 'Claude Opus 4.6 (Thinking)' }],
            fetchedAt: '2026-06-01T00:00:00.000Z',
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            totalRetryCount: 0,
            latestTokenBreakdown: [],
            stopReasonCounts: { END_TURN: 1 },
            retryErrorCodes: {},
            recentErrors: [],
            recentErrorEntries: [],
            toolCallCounts: { read_file: 1 },
            toolCallCountsByConv: { 'conv-1': { read_file: 1 } },
            retryErrorCodesByConv: {},
            uniqueErrors: [],
            toolCatalog: [{ name: 'read_file', firstSeen: '2026-06-01T00:00:00.000Z' }],
        };
    }


    describe('hasGMSummaryChanged', () => {
        it('returns false for identical summaries', () => {
            const prev = makeSummary();
            const next = structuredClone(prev);
            expect(hasGMSummaryChanged(prev, next)).toBe(false);
        });

        it('detects model DNA-only changes even when totals stay the same', () => {
            const prev = makeSummary();
            const next = makeSummary();
            next.modelBreakdown['Claude Opus 4.6 (Thinking)'].promptSectionTitles = ['system', 'tools', 'policy'];

            expect(hasGMSummaryChanged(prev, next)).toBe(true);
        });

        it('detects nested GM detail changes even when totals stay the same', () => {
            const prev = makeSummary();
            const next = makeSummary();
            next.toolCallCountsByConv = { 'conv-1': { read_file: 2 } };
            next.conversations[0].systemContextItems = [{
                type: 'context_injection',
                stepIndex: 1,
                tokens: 200,
                label: 'Context Injection',
                fullText: 'history text changed',
            }];

            expect(hasGMSummaryChanged(prev, next)).toBe(true);
        });
    });


    describe('GM aggregation regression — zero/missing TTFT and streaming must never dilute averages (#66 #2 & #3)', () => {
        it('does not dilute avgTTFT or avgStreaming in filterGMSummaryByModels when calls lack timing', () => {
            const callZeroFirst = { ...makeCall(), executionId: 'z0', ttftSeconds: 0, streamingSeconds: 0, outputTokens: 100, cacheReadTokens: 0 };
            const callTimedA = { ...makeCall(), executionId: 't1', ttftSeconds: 2.0, streamingSeconds: 4.0, outputTokens: 200, cacheReadTokens: 500 };
            const callZeroMid = { ...makeCall(), executionId: 'z1', ttftSeconds: 0, streamingSeconds: 0, outputTokens: 100, cacheReadTokens: 0 };
            const callTimedB = { ...makeCall(), executionId: 't2', ttftSeconds: 4.0, streamingSeconds: 6.0, outputTokens: 300, cacheReadTokens: 500 };
            const callOneTok = { ...makeCall(), executionId: 'tiny', ttftSeconds: 0, streamingSeconds: 0.2, outputTokens: 1, cacheReadTokens: 0 };

            const summary = makeSummary();
            summary.conversations = [{
                ...makeConversation(),
                calls: [callZeroFirst, callTimedA, callZeroMid, callTimedB, callOneTok],
            }];

            const filtered = filterGMSummaryByModels(summary, ['MODEL_PLACEHOLDER_M26']);
            expect(filtered).not.toBeNull();
            const stats = filtered!.modelBreakdown['Claude Opus 4.6 (Thinking)'];

            expect(stats.callCount).toBe(5);
            expect(stats.ttftSampleCount).toBe(2);
            expect(stats.avgTTFT).toBeCloseTo(3.0, 10);
            expect(stats.minTTFT).toBeCloseTo(2.0, 10);
            expect(stats.maxTTFT).toBeCloseTo(4.0, 10);
            expect(stats.streamingSampleCount).toBe(3);
            expect(stats.avgStreaming).toBeCloseTo((4.0 + 6.0 + 0.2) / 3, 10);
            // 1-token call excluded from speed-valid timed sums
            expect(stats.timedOutputTokens).toBe(500);
            expect(stats.timedStreamingSeconds).toBeCloseTo(10.0, 10);
            expect(stats.cacheHitCalls).toBe(2);
            expect(stats.cacheHitRate).toBeCloseTo(2 / 5, 10);
        });

        it('matches GMTracker._buildSummary when aggregating through buildSummaryFromConversations and mergeGMModelStats', () => {
            const calls: GMCallEntry[] = [
                { ...makeCall(), executionId: 'c1', ttftSeconds: 2.0, streamingSeconds: 4.0, outputTokens: 200, cacheReadTokens: 100, createdAt: new Date().toISOString() },
                { ...makeCall(), executionId: 'c2', ttftSeconds: 0, streamingSeconds: 0, outputTokens: 50, cacheReadTokens: 0, createdAt: new Date().toISOString() },
                { ...makeCall(), executionId: 'c3', ttftSeconds: 4.0, streamingSeconds: 6.0, outputTokens: 300, cacheReadTokens: 100, createdAt: new Date().toISOString() },
            ];
            const conv: GMConversationData = { ...makeConversation(), calls };

            const built = buildSummaryFromConversations([conv], '2026-06-01T00:00:00.000Z')!;
            const builtStats = built.modelBreakdown['Claude Opus 4.6 (Thinking)'];
            expect(builtStats.avgTTFT).toBeCloseTo(3.0, 10);
            expect(builtStats.avgStreaming).toBeCloseTo(5.0, 10);
            expect(builtStats.ttftSampleCount).toBe(2);
            expect(builtStats.streamingSampleCount).toBe(2);
            expect(builtStats.timedOutputTokens).toBe(500);
            expect(builtStats.timedStreamingSeconds).toBeCloseTo(10.0, 10);
            expect(builtStats.cacheHitCalls).toBe(2);

            const tracker = new GMTracker();
            (tracker as any)._cache.set('conv-1', conv);
            const trackerSummary = tracker.getFullSummary()!;
            const trackerStats = trackerSummary.modelBreakdown['Claude Opus 4.6 (Thinking)'];

            expect(trackerStats.avgTTFT).toBeCloseTo(builtStats.avgTTFT, 10);
            expect(trackerStats.avgStreaming).toBeCloseTo(builtStats.avgStreaming, 10);
            expect(trackerStats.ttftSampleCount).toBe(builtStats.ttftSampleCount);
            expect(trackerStats.streamingSampleCount).toBe(builtStats.streamingSampleCount);
            expect(trackerStats.timedOutputTokens).toBe(builtStats.timedOutputTokens);
            expect(trackerStats.timedStreamingSeconds).toBeCloseTo(builtStats.timedStreamingSeconds!, 10);
            expect(trackerStats.cacheHitCalls).toBe(builtStats.cacheHitCalls);
        });

        it('weights mergeGMModelStats by valid sample counts for both modern and legacy stats objects', () => {
            const base = makeSummary().modelBreakdown['Claude Opus 4.6 (Thinking)'];
            const target: GMModelStats = {
                ...base,
                callCount: 10,
                avgTTFT: 1.5,
                minTTFT: 1.0,
                maxTTFT: 2.0,
                avgStreaming: 3.0,
                ttftSampleCount: 4,
                streamingSampleCount: 4,
                timedOutputTokens: 400,
                timedStreamingSeconds: 12.0,
                cacheHitCalls: 6,
                cacheHitRate: 0.6,
            };
            const source: GMModelStats = {
                ...base,
                callCount: 5,
                avgTTFT: 4.0,
                minTTFT: 4.0,
                maxTTFT: 4.0,
                avgStreaming: 0,
                ttftSampleCount: 1,
                streamingSampleCount: 0,
                timedOutputTokens: 0,
                timedStreamingSeconds: 0,
                cacheHitCalls: 3,
                cacheHitRate: 0.6,
            };

            mergeGMModelStats(target, source);
            expect(target.callCount).toBe(15);
            expect(target.ttftSampleCount).toBe(5);
            expect(target.avgTTFT).toBeCloseTo((1.5 * 4 + 4.0 * 1) / 5, 10);
            expect(target.streamingSampleCount).toBe(4);
            expect(target.avgStreaming).toBeCloseTo(3.0, 10);
            expect(target.timedOutputTokens).toBe(400);
            expect(target.timedStreamingSeconds).toBeCloseTo(12.0, 10);
            expect(target.cacheHitCalls).toBe(9);
            expect(target.cacheHitRate).toBeCloseTo(9 / 15, 10);

            // Legacy stats (no ttftSampleCount) with avgTTFT === 0 must not dilute a timed merge
            const legacyZero: GMModelStats = { ...base, callCount: 3, avgTTFT: 0, minTTFT: 0, maxTTFT: 0, avgStreaming: 0 };
            delete legacyZero.ttftSampleCount;
            delete legacyZero.streamingSampleCount;
            const legacyTimed: GMModelStats = { ...base, callCount: 1, avgTTFT: 2.5, minTTFT: 2.5, maxTTFT: 2.5, avgStreaming: 5.0 };
            delete legacyTimed.ttftSampleCount;
            delete legacyTimed.streamingSampleCount;

            mergeGMModelStats(legacyZero, legacyTimed);
            expect(legacyZero.avgTTFT).toBeCloseTo(2.5, 10);
            expect(legacyZero.avgStreaming).toBeCloseTo(5.0, 10);
            expect(legacyZero.ttftSampleCount).toBe(1);
            expect(legacyZero.streamingSampleCount).toBe(1);
        });
    });
});

describe('[monitor-store-gm]', () => {
    function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: overrides.executionId || 'exec-1',
            model: overrides.model || 'MODEL_PLACEHOLDER_M26',
            modelDisplay: overrides.modelDisplay || 'Claude Opus 4.6 (Thinking)',
            responseModel: overrides.responseModel || 'claude-opus-4-6-thinking',
            modelAccuracy: overrides.modelAccuracy || 'exact',
            inputTokens: overrides.inputTokens ?? 10,
            outputTokens: overrides.outputTokens ?? 5,
            thinkingTokens: overrides.thinkingTokens ?? 0,
            responseTokens: overrides.responseTokens ?? 5,
            cacheReadTokens: overrides.cacheReadTokens ?? 0,
            cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
            apiProvider: overrides.apiProvider || '',
            ttftSeconds: overrides.ttftSeconds ?? 0,
            streamingSeconds: overrides.streamingSeconds ?? 0,
            credits: overrides.credits ?? 1,
            creditType: overrides.creditType || '',
            hasError: overrides.hasError ?? false,
            errorMessage: overrides.errorMessage || '',
            contextTokensUsed: overrides.contextTokensUsed ?? 0,
            completionConfig: overrides.completionConfig ?? null,
            systemPromptSnippet: overrides.systemPromptSnippet || '',
            toolCount: overrides.toolCount ?? 0,
            toolNames: overrides.toolNames ?? [],
            promptSectionTitles: overrides.promptSectionTitles ?? [],
            promptSnippet: overrides.promptSnippet || '',
            promptSource: overrides.promptSource || 'none',
            messagePromptCount: overrides.messagePromptCount ?? 0,
            messageMetadataKeys: overrides.messageMetadataKeys ?? [],
            responseHeaderKeys: overrides.responseHeaderKeys ?? [],
            userMessageAnchors: overrides.userMessageAnchors ?? [],
            aiSnippetsByStep: overrides.aiSnippetsByStep ?? {},
            retries: overrides.retries ?? 0,
            stopReason: overrides.stopReason || '',
            retryTokensIn: overrides.retryTokensIn ?? 0,
            retryTokensOut: overrides.retryTokensOut ?? 0,
            retryCredits: overrides.retryCredits ?? 0,
            retryErrors: overrides.retryErrors ?? [],
            timeSinceLastInvocation: overrides.timeSinceLastInvocation ?? 0,
            tokenBreakdownGroups: overrides.tokenBreakdownGroups ?? [],
            createdAt: overrides.createdAt || '2026-06-01T00:00:00.000Z',
            latestStableMessageIndex: overrides.latestStableMessageIndex ?? 0,
            startStepIndex: overrides.startStepIndex ?? 0,
            checkpointIndex: overrides.checkpointIndex ?? 0,
            checkpointSummaries: overrides.checkpointSummaries ?? [],
            systemContextItems: overrides.systemContextItems ?? [],
            accountEmail: overrides.accountEmail,
            toolCallsByStep: overrides.toolCallsByStep ?? {},
            contextWindowCapacity: overrides.contextWindowCapacity ?? 0,
        };
    }


    function makeConversation(call: GMCallEntry): GMConversationData {
        return {
            cascadeId: 'conv-1',
            title: 'Conversation 1',
            totalSteps: 5,
            calls: [call],
            lifetimeCalls: 1,
            coveredSteps: 1,
            coverageRate: 0.2,
            checkpointSummaries: [],
            systemContextItems: [],
            accountCredits: call.credits,
        };
    }


    describe('MonitorStore GM conversation snapshots', () => {
        it('persists again when latest GM call details change without changing call count', () => {
            const updates: unknown[] = [];
            const workspaceState = {
                get: vi.fn().mockReturnValue(null),
                update: vi.fn((_key: string, value: unknown) => {
                    updates.push(value);
                    return Promise.resolve();
                }),
            };

            const store = new MonitorStore();
            store.init(workspaceState);

            store.recordGMConversations([makeConversation(makeCall())]);
            store.recordGMConversations([
                makeConversation(makeCall({
                    responseModel: 'claude-opus-4-6-thinking-v2',
                    credits: 9,
                    createdAt: '2026-06-01T00:05:00.000Z',
                })),
            ]);

            expect(workspaceState.update).toHaveBeenCalledTimes(2);
            const lastSaved = updates[1] as { gmConversations: Record<string, GMConversationData> };
            expect(lastSaved.gmConversations['conv-1'].calls[0].responseModel).toBe('claude-opus-4-6-thinking-v2');
            expect(lastSaved.gmConversations['conv-1'].calls[0].credits).toBe(9);
        });
    });
});

describe('[tool-catalog-clear]', () => {
    function makeSummary(): GMSummary {
        return {
            conversations: [],
            modelBreakdown: {},
            totalCalls: 0,
            totalStepsCovered: 0,
            totalCredits: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalThinkingTokens: 0,
            contextGrowth: [],
            fetchedAt: '2026-05-06T00:00:00.000Z',
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            totalRetryCount: 0,
            latestTokenBreakdown: [],
            stopReasonCounts: {},
            retryErrorCodes: {},
            recentErrors: [],
            toolCallCounts: {},
            toolCatalog: [{ name: 'stale_tool', firstSeen: '2026-05-05T00:00:00.000Z' }],
        };
    }


    describe('persistClearedToolCatalog', () => {
        it('clears both globalState and file-backed GM summaries', () => {
            const tracker = GMTracker.restore({
                version: 1,
                summary: makeSummary(),
                baselines: {},
            });
            const globalWrites = new Map<string, unknown>();
            const fileWrites = new Map<string, unknown>();
            const writer = (writes: Map<string, unknown>) => ({
                update: (key: string, value: unknown) => {
                    writes.set(key, value);
                },
            });

            const summary = persistClearedToolCatalog(tracker, writer(globalWrites), writer(fileWrites));

            expect(summary?.toolCatalog).toEqual([]);
            expect((globalWrites.get('gmTrackerState') as { summary: GMSummary }).summary.toolCatalog).toEqual([]);
            expect((fileWrites.get('gmDetailedSummary') as GMSummary).toolCatalog).toEqual([]);
        });
    });
});

describe('[context-compression]', () => {
    const measured = { model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', contextUsed: 8651,
        contextLimit: 80000, isEstimated: false, tokenUsageSource: 'planner' as const };


    describe('context reduction evidence', () => {
        it('does not report the live GPT-OSS estimate-to-provider correction as compression', () => {
            expect(measuredContextDrop({ ...measured, contextUsed: 10015, isEstimated: true,
                tokenUsageSource: 'estimated' }, measured, false)).toBe(0);
        });

        it('compares measured snapshots of the same model and source', () => {
            expect(measuredContextDrop({ ...measured, contextUsed: 12000 }, measured, false)).toBe(3349);
            expect(measuredContextDrop({ ...measured, contextUsed: 12000 }, measured, true)).toBe(0);
            expect(measuredContextDrop({ ...measured, contextUsed: 9000 }, measured, false)).toBe(0);
        });

        it('excludes model switches, checkpoint/planner transitions, missing and invalid values', () => {
            for (const previous of [undefined, { ...measured, contextUsed: 12000, model: 'MODEL_PLACEHOLDER_M417' },
                { ...measured, contextUsed: 12000, tokenUsageSource: 'checkpoint' as const },
                { ...measured, contextUsed: Infinity }, { ...measured, contextUsed: 12000, model: '' }]) {
                expect(measuredContextDrop(previous, measured, false)).toBe(0);
            }
            expect(measuredContextDrop({ ...measured, contextUsed: 12000 }, { ...measured, isEstimated: true }, false)).toBe(0);
        });

        it('re-evaluates cached inferred reductions instead of persisting a transient warning forever', () => {
            const cached = { ...measured, cascadeId: 'test', stepCount: 2, lastModifiedTime: 'now',
                imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
                status: 'CASCADE_RUN_STATUS_IDLE', compressionDetected: true, checkpointCompressionDrop: 0 } as ContextUsage;
            expect(hasSameUsageInputs(cached, cached)).toBe(false);
            expect(hasSameUsageInputs({ ...cached, compressionDetected: false }, cached)).toBe(true);
        });
    });
});

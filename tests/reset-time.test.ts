// Consolidated Gate Suite #5: Quota Reset Time Turnover, Reset Filters, Pools & Runway
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { shouldSettleOnResetTimeChange } from '../src/extension';
import { type GMCallEntry, type GMConversationData, type GMSummary, GMTracker } from '../src/gm-tracker';
import { isCustomModel, QuotaRunwayTracker, StaleCacheGuard } from '../src/quota-runway';
import { groupModelQuotas } from '../src/model-quota';
import { buildModelQuotaGrid } from '../src/webview-profile-tab';
import { buildModelsTabContent } from '../src/webview-models-tab';
import {
    getModelDisplayName,
    getModelSpecs,
    type ModelConfig,
    updateModelDisplayNames,
    updateModelSpec,
} from '../src/models';
import { type Language, setLanguageToState, tBiHtml } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';

describe('[reset-time-turnover]', () => {
    describe('shouldSettleOnResetTimeChange', () => {
        it('ignores minute-level resetTime drift while the old reset is still in the future', () => {
            const nowMs = Date.parse('2026-06-02T01:22:37.917Z');
            const oldResetTime = '2026-06-02T06:17:47Z';
            const newResetTime = '2026-06-02T06:20:51Z';

            expect(shouldSettleOnResetTimeChange(oldResetTime, newResetTime, nowMs)).toBe(false);
        });

        it('ignores tiny post-expiry nudges that look like server-side drift', () => {
            const nowMs = Date.parse('2026-06-02T06:18:30.000Z');
            const oldResetTime = '2026-06-02T06:17:47Z';
            const newResetTime = '2026-06-02T06:20:51Z';

            expect(shouldSettleOnResetTimeChange(oldResetTime, newResetTime, nowMs)).toBe(false);
        });

        it('accepts a real turnover after the old reset time has passed and the next cycle jumps forward', () => {
            const nowMs = Date.parse('2026-06-02T06:18:30.000Z');
            const oldResetTime = '2026-06-02T06:17:47Z';
            const newResetTime = '2026-06-02T11:20:51Z';

            expect(shouldSettleOnResetTimeChange(oldResetTime, newResetTime, nowMs)).toBe(true);
        });
    });
});

describe('[gm-quota-reset-filter]', () => {
    const ACCOUNT_EMAIL = 'user@example.com';

    const MODEL_ID = 'MODEL_PLACEHOLDER_M132';


    function makeIsoAt(hour: number, minute = 0): string {
        const date = new Date();
        date.setHours(hour, minute, 0, 0);
        return date.toISOString();
    }


    function makeCall(overrides: Partial<GMCallEntry> & {
        executionId: string;
        stepIndices: number[];
        createdAt: string;
    }): GMCallEntry {
        return {
            stepIndices: overrides.stepIndices,
            executionId: overrides.executionId,
            model: overrides.model || MODEL_ID,
            modelDisplay: overrides.modelDisplay || 'Gemini 3.5 Flash (High)',
            responseModel: overrides.responseModel || '',
            modelAccuracy: overrides.modelAccuracy || 'exact',
            inputTokens: overrides.inputTokens ?? 100,
            outputTokens: overrides.outputTokens ?? 50,
            thinkingTokens: overrides.thinkingTokens ?? 0,
            responseTokens: overrides.responseTokens ?? 50,
            cacheReadTokens: overrides.cacheReadTokens ?? 0,
            cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
            apiProvider: overrides.apiProvider || 'API_PROVIDER_GOOGLE_GEMINI',
            ttftSeconds: overrides.ttftSeconds ?? 0.5,
            streamingSeconds: overrides.streamingSeconds ?? 1.2,
            credits: overrides.credits ?? 1,
            creditType: overrides.creditType || 'ai',
            hasError: overrides.hasError ?? false,
            errorMessage: overrides.errorMessage || '',
            contextTokensUsed: overrides.contextTokensUsed ?? 1024,
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
            stopReason: overrides.stopReason || 'STOP_REASON_END_TURN',
            retryTokensIn: overrides.retryTokensIn ?? 0,
            retryTokensOut: overrides.retryTokensOut ?? 0,
            retryCredits: overrides.retryCredits ?? 0,
            retryErrors: overrides.retryErrors ?? [],
            timeSinceLastInvocation: overrides.timeSinceLastInvocation ?? 0,
            tokenBreakdownGroups: overrides.tokenBreakdownGroups ?? [],
            createdAt: overrides.createdAt,
            latestStableMessageIndex: overrides.latestStableMessageIndex ?? 0,
            startStepIndex: overrides.startStepIndex ?? 0,
            checkpointIndex: overrides.checkpointIndex ?? 0,
            checkpointSummaries: overrides.checkpointSummaries ?? [],
            systemContextItems: overrides.systemContextItems ?? [],
            accountEmail: overrides.accountEmail ?? ACCOUNT_EMAIL,
            toolCallsByStep: overrides.toolCallsByStep ?? {},
            contextWindowCapacity: overrides.contextWindowCapacity ?? 128000,
        };
    }


    function seedTracker(calls: GMCallEntry[]): GMTracker {
        const tracker = new GMTracker();
        const cache = (tracker as any)._cache as Map<string, GMConversationData>;
        cache.set('conv-1', {
            cascadeId: 'conv-1',
            title: 'Conversation 1',
            totalSteps: 200,
            calls,
            lifetimeCalls: calls.length,
            coveredSteps: calls.length,
            coverageRate: calls.length / 200,
            checkpointSummaries: [],
            systemContextItems: [],
        });
        tracker.setCurrentAccount(ACCOUNT_EMAIL);
        (tracker as any)._hasFetchedCalls = true;
        (tracker as any)._lastSummary = (tracker as any)._buildSummary(true, true) as GMSummary;
        return tracker;
    }


    describe('GM quota reset filtering', () => {
        it('only archives calls at or before the cutoff time', () => {
            const beforeReset = makeCall({
                executionId: 'before-reset',
                stepIndices: [1],
                createdAt: makeIsoAt(1, 0),
            });
            const afterReset = makeCall({
                executionId: 'after-reset',
                stepIndices: [2],
                createdAt: makeIsoAt(2, 0),
            });
            const tracker = seedTracker([beforeReset, afterReset]);

            const archived = tracker.baselineForQuotaReset(
                ACCOUNT_EMAIL,
                [MODEL_ID],
                makeIsoAt(1, 30),
            );

            expect(archived).toBe(1);
            expect(tracker.getUiSummary()?.totalCalls).toBe(1);
            expect(tracker.getUiSummary()?.modelBreakdown['Gemini 3.5 Flash (High)']?.callCount).toBe(1);
        });

        it('keeps new same-model calls visible after reset even if their timestamps look stale', () => {
            const beforeReset = makeCall({
                executionId: 'before-reset',
                stepIndices: [1],
                createdAt: makeIsoAt(1, 0),
            });
            const tracker = seedTracker([beforeReset]);

            tracker.baselineForQuotaReset(
                ACCOUNT_EMAIL,
                [MODEL_ID],
                makeIsoAt(1, 30),
            );

            const cache = (tracker as any)._cache as Map<string, GMConversationData>;
            const conv = cache.get('conv-1')!;
            conv.calls.push(makeCall({
                executionId: 'post-reset-stale-created-at',
                stepIndices: [2],
                createdAt: makeIsoAt(1, 0),
            }));
            conv.totalSteps += 1;
            conv.lifetimeCalls = conv.calls.length;
            cache.set('conv-1', conv);

            const summary = tracker.getUiSummary();
            expect(summary?.totalCalls).toBe(1);
            expect(summary?.modelBreakdown['Gemini 3.5 Flash (High)']?.callCount).toBe(1);
        });

        it('counts a call carrying a pre-renumber placeholder into the pool expressed with live IDs', () => {
            // Upgrade scenario: the ledger holds calls tagged MODEL_PLACEHOLDER_M264 (what v1.16.14
            // captured for Gemini 3.6 Flash High), while the live quota pool is now expressed with
            // M71/M298/… Exact ID comparison can never bridge those two, so the pool filter has to fall
            // back to the shared display label. If it does not, the call is left out of the reset
            // baseline and the GM ledger diverges from the daily ledger, which does bridge by label.
            const retiredCall = makeCall({
                executionId: 'renumbered-3-6',
                stepIndices: [1],
                createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                model: 'MODEL_PLACEHOLDER_M264',
                modelDisplay: 'Gemini 3.6 Flash (High)',
                responseModel: 'gemini-3.6-flash-high',
            });
            const tracker = seedTracker([retiredCall]);
            const livePool = [
                'MODEL_PLACEHOLDER_M298', 'MODEL_PLACEHOLDER_M299', 'MODEL_PLACEHOLDER_M300',
                'MODEL_PLACEHOLDER_M71', 'MODEL_PLACEHOLDER_M72', 'MODEL_PLACEHOLDER_M73',
                'MODEL_PLACEHOLDER_M16',
            ];
            const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();

            expect(tracker.baselineForQuotaReset(ACCOUNT_EMAIL, livePool, cutoff)).toBe(1);
        });

        it('does not sweep an unrelated model into a pool via M-number prefix collision', () => {
            // M-numbers are plain decimal, so raw-ID substring matching would put M187 in M18's pool and
            // M298 in M29's. Only exact IDs and resolved display labels may match.
            const claudeCall = makeCall({
                executionId: 'claude-call',
                stepIndices: [1],
                createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                model: 'MODEL_PLACEHOLDER_M35',
                modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
                responseModel: 'claude-sonnet-4-6',
            });
            const tracker = seedTracker([claudeCall]);
            const geminiPool = ['MODEL_PLACEHOLDER_M298', 'MODEL_PLACEHOLDER_M71', 'MODEL_PLACEHOLDER_M16'];
            const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();

            expect(tracker.baselineForQuotaReset(ACCOUNT_EMAIL, geminiPool, cutoff)).toBe(0);
        });

        it('ignores stale future cutoffs left by earlier resetTime drift bugs', () => {
            const currentCall = makeCall({
                executionId: 'current-m132',
                stepIndices: [1],
                createdAt: new Date().toISOString(),
            });
            const tracker = seedTracker([currentCall]);
            const cutoffKey = `${ACCOUNT_EMAIL}|${MODEL_ID}`;
            const futureCutoff = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

            ((tracker as any)._archivedAccountModelCutoffs as Map<string, string>).set(cutoffKey, futureCutoff);

            const summary = tracker.getUiSummary();
            expect(summary?.totalCalls).toBe(1);
            expect(summary?.modelBreakdown['Gemini 3.5 Flash (High)']?.callCount).toBe(1);
            expect(tracker.serialize().archivedAccountModelCutoffs?.[cutoffKey]).toBeUndefined();
        });
    });
});

describe('[quota-runway]', () => {
    const MIN = 60 * 1000;

    const HOUR = 60 * MIN;


    describe('isCustomModel', () => {
        it('detects custom-*, BYOK, and local/self-hosted model IDs and labels', () => {
            expect(isCustomModel('custom-gpt-5')).toBe(true);
            expect(isCustomModel('custom_my_endpoint')).toBe(true);
            expect(isCustomModel('custom:claude-direct')).toBe(true);
            expect(isCustomModel('MODEL_CUSTOM_ENDPOINT')).toBe(true);
            expect(isCustomModel('byok-openai-o3')).toBe(true);
            expect(isCustomModel('ollama/qwen2.5-coder:32b')).toBe(true);
            expect(isCustomModel('lmstudio/deepseek-r1')).toBe(true);
            expect(isCustomModel('vllm/llama-3.3-70b')).toBe(true);
            expect(isCustomModel('local/gemma-3')).toBe(true);
            expect(isCustomModel('openrouter/anthropic/claude-4')).toBe(true);

            expect(isCustomModel(undefined, 'My Endpoint (BYOK)')).toBe(true);
            expect(isCustomModel(undefined, 'Custom Model: DeepSeek')).toBe(true);
            expect(isCustomModel(undefined, 'Llama 3 [Local]')).toBe(true);
            expect(isCustomModel(undefined, 'Ollama Qwen')).toBe(true);
            expect(isCustomModel(undefined, 'LM Studio Server')).toBe(true);
        });

        it('does not falsely flag built-in Antigravity Google-pooled models or Orchestrator (Custom)', () => {
            expect(isCustomModel('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)')).toBe(false);
            expect(isCustomModel('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)')).toBe(false);
            expect(isCustomModel('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)')).toBe(false);
            expect(isCustomModel('MODEL_PLACEHOLDER_M667', 'Orchestrator (Custom)')).toBe(false);
            expect(isCustomModel(undefined, 'Orchestrator (Custom)')).toBe(false);
            expect(isCustomModel(undefined, '编排器 (自定义)')).toBe(false);
            expect(isCustomModel('', '')).toBe(false);
            expect(isCustomModel()).toBe(false);
        });
    });


    describe('QuotaRunwayTracker', () => {
        it('returns insufficient_data for unknown or single-sample pools and exhausted for 0%', () => {
            const tracker = new QuotaRunwayTracker();
            expect(tracker.estimate('claude').status).toBe('insufficient_data');

            const t0 = 1_700_000_000_000;
            tracker.record('claude', 0.85, t0, t0 + 3 * HOUR);
            expect(tracker.estimate('claude', t0)).toMatchObject({
                poolKey: 'claude',
                status: 'insufficient_data',
                burnRatePctPerHour: null,
                estExhaustMs: null,
                timeToResetMs: 3 * HOUR,
                recoveredRecently: false,
            });

            tracker.record('gemini', 0, t0, t0 + 2 * HOUR);
            expect(tracker.estimate('gemini', t0)).toMatchObject({
                poolKey: 'gemini',
                status: 'exhausted',
                estExhaustMs: 0,
                timeToResetMs: 2 * HOUR,
            });
        });

        it('isolates Google quota pools when active model is a custom/BYOK model', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = 1_700_000_000_000;
            tracker.record('claude', 0.80, t0, t0 + 2 * HOUR);
            tracker.record('claude', 0.40, t0 + 10 * MIN, t0 + 2 * HOUR);

            const isolated = tracker.estimate('claude', t0 + 10 * MIN, { modelId: 'custom-deepseek-r1' });
            expect(isolated).toEqual({
                poolKey: 'claude',
                status: 'custom_model_isolated',
                burnRatePctPerHour: null,
                estExhaustMs: null,
                timeToResetMs: null,
                recoveredRecently: false,
            });
        });

        it('computes accurate burn rate and classifies at_risk vs safe_until_reset against resetTimeMs', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = 1_700_000_000_000;
            const resetAt = t0 + 2 * HOUR;

            // Burn 10% over 15 min -> 40%/hr; remaining 70% exhausts in 1.75h (105m) < 105m? Wait: at t0+15m reset is 105m away -> exact boundary at_risk
            tracker.record('claude', 0.80, t0, resetAt);
            tracker.record('claude', 0.70, t0 + 15 * MIN, resetAt);

            const atRisk = tracker.estimate('claude', t0 + 15 * MIN);
            expect(atRisk.burnRatePctPerHour).toBeCloseTo(40, 2);
            expect(atRisk.estExhaustMs).toBe(105 * MIN);
            expect(atRisk.timeToResetMs).toBe(105 * MIN);
            expect(atRisk.status).toBe('at_risk');

            // Pool burning slowly: 5% over 30 min -> 10%/hr; remaining 75% exhausts in 7.5h > 1.5h until reset -> safe_until_reset
            tracker.record('gemini', 0.80, t0, resetAt);
            tracker.record('gemini', 0.75, t0 + 30 * MIN, resetAt);

            const safe = tracker.estimate('gemini', t0 + 30 * MIN);
            expect(safe.burnRatePctPerHour).toBeCloseTo(10, 2);
            expect(safe.estExhaustMs).toBe(450 * MIN);
            expect(safe.timeToResetMs).toBe(90 * MIN);
            expect(safe.status).toBe('safe_until_reset');
        });

        it('filters <0.001 (0.1%) jitter without reporting bogus burn while preserving cumulative drift', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = 1_700_000_000_000;
            const resetAt = t0 + 3 * HOUR;

            tracker.record('claude', 0.8000, t0, resetAt);
            tracker.record('claude', 0.7995, t0 + 5 * MIN, resetAt); // -0.05% jitter
            tracker.record('claude', 0.8004, t0 + 10 * MIN, resetAt); // +0.04% jitter
            tracker.record('claude', 0.7992, t0 + 15 * MIN, resetAt); // -0.08% jitter

            const steady = tracker.estimate('claude', t0 + 15 * MIN);
            expect(steady.burnRatePctPerHour).toBe(0);
            expect(steady.estExhaustMs).toBeNull();
            expect(steady.status).toBe('safe_until_reset');
            // Jitter samples did not pollute stored anchor list
            expect(tracker.getPoolHistory('claude')?.samples).toHaveLength(1);

            // Once cumulative drop reaches >= 0.001 (0.1%), it is recorded as genuine burn
            tracker.record('claude', 0.7900, t0 + 20 * MIN, resetAt); // -1.0% over 20m = 3%/hr
            const realBurn = tracker.estimate('claude', t0 + 20 * MIN);
            expect(realBurn.burnRatePctPerHour).toBeCloseTo(3, 2);
            expect(tracker.getPoolHistory('claude')?.samples).toHaveLength(2);
        });

        it('enforces rolling 45-minute window eviction', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = 1_700_000_000_000;
            const resetAt = t0 + 5 * HOUR;

            // Early steep drop at t0 -> t0+10m (50% dropped!)
            tracker.record('claude', 0.90, t0, resetAt);
            tracker.record('claude', 0.40, t0 + 10 * MIN, resetAt);
            // Later gentle burn at t0+50m -> t0+60m (only 2% dropped in 10m = 12%/hr)
            tracker.record('claude', 0.38, t0 + 50 * MIN, resetAt);
            tracker.record('claude', 0.36, t0 + 60 * MIN, resetAt);

            // At t0+60m, cutoff is t0+15m so t0 and t0+10m are evicted from the 45-min window!
            const est = tracker.estimate('claude', t0 + 60 * MIN);
            expect(est.burnRatePctPerHour).toBeCloseTo(12, 2);
        });

        it('resets burn history cleanly on >= +5% jump, recovery to >= 90%, or reset timestamp rollover', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = 1_700_000_000_000;
            const reset1 = t0 + 2 * HOUR;

            // 1. Recovery via >= +5% jump (0.50 -> 0.56)
            tracker.record('pool-jump', 0.70, t0, reset1);
            tracker.record('pool-jump', 0.50, t0 + 10 * MIN, reset1);
            expect(tracker.estimate('pool-jump', t0 + 10 * MIN).burnRatePctPerHour).toBeCloseTo(120, 1);

            tracker.record('pool-jump', 0.56, t0 + 15 * MIN, reset1);
            const afterJump = tracker.estimate('pool-jump', t0 + 15 * MIN);
            expect(afterJump.status).toBe('insufficient_data');
            expect(afterJump.burnRatePctPerHour).toBeNull();
            expect(afterJump.recoveredRecently).toBe(true);
            // Recovery notice expires after 15 minutes
            expect(tracker.estimate('pool-jump', t0 + 35 * MIN).recoveredRecently).toBe(false);

            // 2. Recovery via crossing up into >= 90% even with a <5% jump (0.88 -> 0.91)
            tracker.record('pool-high', 0.95, t0, reset1);
            tracker.record('pool-high', 0.88, t0 + 10 * MIN, reset1);
            tracker.record('pool-high', 0.91, t0 + 15 * MIN, reset1);
            const afterHigh = tracker.estimate('pool-high', t0 + 15 * MIN);
            expect(afterHigh.status).toBe('insufficient_data');
            expect(afterHigh.recoveredRecently).toBe(true);

            // 3. Reset timestamp rolls forward into a new window (> 60s forward)
            tracker.record('pool-roll', 0.60, t0, reset1);
            tracker.record('pool-roll', 0.40, t0 + 10 * MIN, reset1 + 20_000); // minor 20s server jitter -> NOT reset
            expect(tracker.estimate('pool-roll', t0 + 10 * MIN).burnRatePctPerHour).toBeCloseTo(120, 1);

            const reset2 = reset1 + 5 * HOUR;
            tracker.record('pool-roll', 1.0, t0 + 15 * MIN, reset2);
            const afterRoll = tracker.estimate('pool-roll', t0 + 15 * MIN);
            expect(afterRoll.status).toBe('insufficient_data');
            expect(afterRoll.recoveredRecently).toBe(true);
            expect(afterRoll.timeToResetMs).toBe(reset2 - (t0 + 15 * MIN));

            // 4. Recovery from exhausted (0%) cleanly exits exhausted state
            tracker.record('pool-exhaust', 0.0, t0, reset1);
            expect(tracker.estimate('pool-exhaust', t0).status).toBe('exhausted');
            tracker.record('pool-exhaust', 1.0, t0 + 5 * MIN, reset2);
            const recoveredExhaust = tracker.estimate('pool-exhaust', t0 + 5 * MIN);
            expect(recoveredExhaust.status).toBe('insufficient_data');
            expect(recoveredExhaust.recoveredRecently).toBe(true);
        });

        it('serializes and deserializes cleanly and ignores malformed or out-of-order inputs', () => {
            const tracker = new QuotaRunwayTracker();
            const t0 = 1_700_000_000_000;
            const resetAt = t0 + 3 * HOUR;

            tracker.record('', 0.5, t0);
            tracker.record('claude', Number.NaN, t0);
            tracker.record('claude', 0.9, t0 + 10 * MIN, resetAt);
            tracker.record('claude', 0.5, t0 + 5 * MIN, resetAt); // out-of-order ignored
            tracker.record('claude', 0.7, t0 + 25 * MIN, resetAt);

            const json = JSON.stringify(tracker.serialize());
            const restored = QuotaRunwayTracker.deserialize(JSON.parse(json));
            expect(restored.estimate('claude', t0 + 25 * MIN)).toEqual(
                tracker.estimate('claude', t0 + 25 * MIN),
            );

            // Malformed deserialize payloads never throw
            expect(QuotaRunwayTracker.deserialize(null).estimateAll()).toEqual({});
            expect(QuotaRunwayTracker.deserialize({ pools: { bad: { samples: [{ remainingFraction: 'nope' }] } } }).estimateAll()).toEqual({});
        });
    });


    describe('StaleCacheGuard', () => {
        it('preserves last-known good data on transient RPC failures and clears stale badge on recovery', async () => {
            const guard = new StaleCacheGuard<{ quota: number }>();

            // Initial empty state
            expect(guard.getSnapshot()).toEqual({
                data: null,
                isStale: false,
                lastSuccessAtMs: null,
                consecutiveFailures: 0,
                lastError: null,
            });

            // Failure before any success keeps data null and isStale false
            const fail0 = guard.recordFailure(new Error('LS offline'));
            expect(fail0).toEqual({
                data: null,
                isStale: false,
                lastSuccessAtMs: null,
                consecutiveFailures: 1,
                lastError: 'LS offline',
            });

            // First success populates fresh data
            const ok1 = await guard.run(async () => ({ quota: 82 }), 10_000);
            expect(ok1).toEqual({
                data: { quota: 82 },
                isStale: false,
                lastSuccessAtMs: 10_000,
                consecutiveFailures: 0,
                lastError: null,
            });

            // Transient RPC failures preserve { quota: 82 } and mark isStale: true
            const fail1 = await guard.run(async () => { throw new Error('ECONNRESET'); });
            expect(fail1).toEqual({
                data: { quota: 82 },
                isStale: true,
                lastSuccessAtMs: 10_000,
                consecutiveFailures: 1,
                lastError: 'ECONNRESET',
            });

            const fail2 = guard.recordFailure('timeout');
            expect(fail2.data).toEqual({ quota: 82 });
            expect(fail2.isStale).toBe(true);
            expect(fail2.consecutiveFailures).toBe(2);
            expect(fail2.lastError).toBe('timeout');

            // Recovery clears stale state and updates data
            const ok2 = guard.recordSuccess({ quota: 79 }, 20_000);
            expect(ok2).toEqual({
                data: { quota: 79 },
                isStale: false,
                lastSuccessAtMs: 20_000,
                consecutiveFailures: 0,
                lastError: null,
            });

            guard.reset();
            expect(guard.hasData()).toBe(false);
        });

        it('supports optional maxAgeMs staleness check without errors', () => {
            const guard = new StaleCacheGuard<string>(undefined, { maxAgeMs: 60_000 });
            guard.recordSuccess('cached', 1_000);
            expect(guard.getSnapshot(30_000).isStale).toBe(false);
            expect(guard.getSnapshot(62_000).isStale).toBe(true);
        });
    });
});

describe('[model-quota]', () => {
    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    const RESET = '2026-11-12T01:00:00Z';

    const CURRENT_IDS = ['M437', 'M427', 'M438', 'M418', 'M417', 'M419', 'M319', 'M318', 'M320',
        'M401', 'M402', 'M400', 'M404', 'M405', 'M403', 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM'];


    function config(id: string, fraction = 0.8, resetTime = RESET, label?: string): ModelConfig {
        const model = /^M\d+$/.test(id) ? `MODEL_PLACEHOLDER_${id}` : id;
        return { model, label: label || getModelDisplayName(model), supportsImages: true,
            allowedTiers: [], mimeTypeCount: 0, supportedMimeTypes: [], isRecommended: false,
            quotaInfo: { remainingFraction: fraction, resetTime } };
    }


    beforeEach(() => setLanguageToState('en', state));

    afterEach(async () => {
        updateModelDisplayNames([], { authoritative: true });
        await setLanguageToState('both', state);
    });


    describe('model quota pool grouping', () => {
        it('reduces sixteen chat efforts to two shared pools while retaining six families and sixteen metadata cards', () => {
            const configs = CURRENT_IDS.map(id => config(id));
            const before = structuredClone(configs);
            const groups = groupModelQuotas(configs);
            expect(groups.map(g => g.label)).toEqual(['Gemini', 'Claude / GPT']);
            expect(groups.map(g => g.readings.length)).toEqual([9, 7]);
            const members = groups.flatMap(g => g.members);
            expect(members.map(m => m.label)).toEqual(['Gemini 4 Carbon', 'Gemini 4 Argon', 'Gemini 3.8 Flash',
                'Claude Opus 5.5', 'Claude Sonnet 5.5', 'GPT-OSS 120B']);
            expect(members.slice(0, 5).every(m => m.efforts.join(',') === 'low,medium,high')).toBe(true);
            expect(members[5].efforts).toEqual(['medium']);
            expect(groups.every(g => g.minimum === 0.8 && g.maximum === 0.8 && !g.quotaDiffers && !g.resetDiffers)).toBe(true);
            const html = buildModelsTabContent(null, configs);
            expect(html.match(/class="model-card"/g)).toHaveLength(2);
            expect(html.match(/class="spec-card"/g)).toHaveLength(16);
            expect(configs).toEqual(before);
        });

        it('keeps first pool/family occurrence order and renders only available efforts', () => {
            const groups = groupModelQuotas([config('M401'), config('M418'), config('M437'), config('M417')]);
            expect(groups.map(g => g.label)).toEqual(['Claude / GPT', 'Gemini']);
            expect(groups[1].members.map(m => m.label)).toEqual(['Gemini 4 Argon', 'Gemini 4 Carbon']);
            expect(groups[1].members[0].efforts).toEqual(['medium', 'high']);
            expect(groups[1].members[1].efforts).toEqual(['medium']);
            expect(buildModelQuotaGrid([config('M437')])).not.toContain('Low · Medium · High');
        });

        it('does not sum or mix independent Gemini and premium percentages', () => {
            const groups = groupModelQuotas([config('M438', 0.4), config('M419', 0.4),
                config('M400', 0.9), config('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 0.9)]);
            expect(groups.map(g => [g.pool, g.minimum, g.maximum, g.quotaDiffers])).toEqual([
                ['gemini', 0.4, 0.4, false], ['premium', 0.9, 0.9, false],
            ]);
        });

        it.each([
            ['M437', 'Gemini', 'Gemini 4 Carbon', 'medium'],
            ['M400', 'Claude / GPT', 'Claude Opus 5.5', 'low'],
            ['MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'Claude / GPT', 'GPT-OSS 120B', 'medium'],
        ])('supports a single available effort %s without implying absent model efforts', (id, poolLabel, memberLabel, effort) => {
            const groups = groupModelQuotas([config(id)]);
            expect(groups).toHaveLength(1);
            expect(groups[0].label).toBe(poolLabel);
            expect(groups[0].members).toHaveLength(1);
            expect(groups[0].members[0]).toMatchObject({ label: memberLabel, efforts: [effort] });
        });

        it('supports an account with only the Gemini pool', () => {
            const groups = groupModelQuotas(CURRENT_IDS.slice(0, 9).map(id => config(id)));
            expect(groups).toHaveLength(1);
            expect(groups[0].members).toHaveLength(3);
            expect(buildModelQuotaGrid(CURRENT_IDS.slice(0, 9).map(id => config(id)))).not.toContain('Claude / GPT');
        });

        it('normalizes canonical, English, Chinese and diagnostic aliases without duplicate readings', () => {
            const aliases = ['MODEL_PLACEHOLDER_M438', 'gemini-4-carbon-low', 'GEMINI_4_CARBON_LOW',
                'Gemini 4 Carbon Low', 'Gemini 4 Carbon（低）', 'Gemini 4 Carbon (低) (M438)'];
            const groups = groupModelQuotas(aliases.map(alias => config(alias, 0.8, RESET, alias)));
            expect(groups).toHaveLength(1);
            expect(groups[0].readings).toHaveLength(1);
            expect(groups[0].efforts).toEqual(['low']);
        });

        it('lists generations and families separately inside their pool while image quota remains independent', () => {
            const groups = groupModelQuotas(['M438', 'M419', 'M320', 'M300', 'M322', 'M21', 'M400', 'M403'].map(id => config(id)));
            expect(groups).toHaveLength(3);
            expect(groups[0].pool).toBe('gemini');
            expect(groups[0].members).toHaveLength(5);
            expect(groups[1]).toMatchObject({ pool: undefined, label: 'Gemini 3.1 Flash Image' });
            expect(groups[2].pool).toBe('premium');
            expect(groups[2].members).toHaveLength(2);
        });

        it('keeps unknown IDs independent even when their labels imitate a known family', () => {
            const groups = groupModelQuotas([
                config('future-a', 0.8, RESET, 'Gemini 4 Carbon (High)'),
                config('future-b', 0.8, RESET, 'Gemini 4 Carbon (Low)'),
                config('M438'),
            ]);
            expect(groups).toHaveLength(3);
            expect(groups.slice(0, 2).every(g => g.efforts.length === 0)).toBe(true);
        });

        it('recognizes new model families when provider, catalog ID and thinking level agree', () => {
            const models = [
                ['M98701', 'future-studio-7-low', 'ProviderA', 1, 'Studio 7 (Low)'],
                ['M98702', 'future-studio-7-medium', 'ProviderA', 2, 'Studio 7（中）'],
                ['M98703', 'future-studio-7-high', 'ProviderA', 3, 'Studio 7 (High)'],
                ['M98704', 'future-studio-7-extra', 'ProviderA', 100, 'Studio 7 (Extra)'],
                ['M98705', 'future-studio-7-high', 'ProviderB', 3, 'Studio 7 (High)'],
                ['M98706', 'future-studio-7-low', 'ProviderA', 3, 'Studio 7 (Low)'],
            ] as const;
            for (const [id, modelId, apiProvider, thinkingLevel, displayName] of models) {
                updateModelSpec(`MODEL_PLACEHOLDER_${id}`, { modelId, apiProvider, thinkingLevel, displayName, supportsThinking: true });
            }
            const groups = groupModelQuotas(models.map(([id, , , , label], i) => config(id, 0.5 + i / 100, RESET, label)));
            expect(groups).toHaveLength(3);
            expect(groups[0]).toMatchObject({
                label: 'Studio 7', efforts: ['low', 'medium', 'high', 'xhigh'],
                minimum: 0.5, maximum: 0.53, quotaDiffers: true,
            });
            expect(groups[0].members).toHaveLength(1);
            expect(groups[1].efforts).toEqual(['high']);
            expect(groups[2].efforts).toEqual([]);
            expect(groups.every(group => group.pool === undefined)).toBe(true);
        });

        it('uses the registry quota contract instead of creating a second provider mapping', () => {
            const original = { ...getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M437')! };
            try {
                updateModelSpec('MODEL_PLACEHOLDER_M437', { apiProvider: 'OPENAI_VERTEX' });
                const groups = groupModelQuotas([config('M438'), config('M437')]);
                expect(groups).toHaveLength(1);
                expect(groups[0].pool).toBe('gemini');
            } finally { updateModelSpec(original.placeholderId, original); }
        });

        it('preserves live names while using catalog identity even if a label names another family', () => {
            const configs = [config('M437', 0.8, RESET, 'Account Carbon (Medium)'),
                config('M427', 0.8, RESET, 'Gemini 4 Argon (High)'), config('M438', 0.8, RESET, 'Account Carbon（低）（M438）')];
            updateModelDisplayNames(configs, { authoritative: true });
            const groups = groupModelQuotas(configs);
            expect(groups).toHaveLength(1);
            expect(groups[0].members[0].label).toBe('Account Carbon');
            expect(groups[0].efforts).toEqual(['low', 'medium', 'high']);
            const html = buildModelQuotaGrid(configs);
            expect(html).toContain('Gemini 4 Argon (High)');
            expect(groupModelQuotas([configs[2]])[0].members[0].label).toBe('Account Carbon');
        });

        it('groups legacy Flash IDs by their verified efforts despite misleading catalogs and renamed labels', () => {
            const configs = [config('M84', 0.8, RESET, '账号 Flash（高）'),
                config('M20', 0.8, RESET, '账号 Flash（中）'), config('M187', 0.8, RESET, '账号 Flash（低）')];
            updateModelDisplayNames(configs, { authoritative: true });
            const groups = groupModelQuotas(configs);
            expect(groups).toHaveLength(1);
            expect(groups[0].members[0].label).toBe('账号 Flash');
            expect(groups[0].efforts).toEqual(['low', 'medium', 'high']);
            expect(groups[0].readings.map(r => [r.model, r.effort])).toEqual([
                ['MODEL_PLACEHOLDER_M187', 'low'], ['MODEL_PLACEHOLDER_M20', 'medium'], ['MODEL_PLACEHOLDER_M84', 'high'],
            ]);
        });

        it('clears families when the account catalog becomes empty', () => {
            expect(groupModelQuotas([config('M438')])).toHaveLength(1);
            expect(groupModelQuotas([])).toEqual([]);
            const emptyHtml = buildModelQuotaGrid([]);
            expect(emptyHtml).toContain('id="model-quota-heading"');
            expect(emptyHtml).toContain('class="empty-msg"');
            expect(emptyHtml).not.toContain('data-quota-family=');
        });

        it('does not treat an unknown raw ID equal to a pool name as a canonical pool', () => {
            const groups = groupModelQuotas([config('gemini'), config('premium'), config('M438')]);
            expect(groups).toHaveLength(3);
            expect(groups.map(g => g.pool)).toEqual([undefined, undefined, 'gemini']);
        });

        it.each(['gemini', 'premium'])('keeps live-registered unknown ID %s separate from the canonical quota pool', id => {
            const configs = [config(id, 0.8, RESET, `Unknown ${id} model`), config('M438'), config('M400')];
            updateModelDisplayNames(configs, { authoritative: true });
            const groups = groupModelQuotas(configs);
            expect(groups).toHaveLength(3);
            expect(groups.map(g => g.pool)).toEqual([undefined, 'gemini', 'premium']);
            expect(groups[0].readings.map(reading => reading.model)).toEqual([id]);
        });
    });


    describe('quota differences and incomplete readings', () => {
        it('identifies the full model and effort in conflicting cross-family readings', () => {
            const html = buildModelQuotaGrid([config('M438', 0.4), config('M419', 0.8)]);
            expect(html.match(/class="model-card"/g)).toHaveLength(1);
            expect(html).toContain('40–80%');
            expect(html).toContain('<li><span>Gemini 4 Carbon (Low)</span>');
            expect(html).toContain('<li><span>Gemini 4 Argon (Low)</span>');
            expect(html).not.toContain('<li><span>Low</span>');
        });

        it('preserves raw differences rather than averaging, summing or rounding them away', () => {
            const configs = [config('M438', 0.801), config('M437', 0.804), config('M427', 0.9)];
            const group = groupModelQuotas(configs)[0];
            expect(group).toMatchObject({ minimum: 0.801, maximum: 0.9, quotaDiffers: true });
            const html = buildModelQuotaGrid(configs);
            expect(html.match(/class="model-card"/g)).toHaveLength(1);
            expect(html).toContain('80.1–90%');
            expect(html).toContain('width:80.1%');
            expect(html).toContain('Reported values differ');
            expect(html).toContain('<details');
            expect(html).toContain('80.4%');
        });

        it.each([0.29, 0.58])('formats fraction %s without binary floating-point noise', fraction => {
            const html = buildModelQuotaGrid([config('M438', fraction)]);
            expect(html).toContain(`>${Math.round(fraction * 100)}%</span>`);
            expect(html).toContain(`width:${Math.round(fraction * 100)}%`);
            expect(html).not.toMatch(/999999999|000000001/);
        });

        it('keeps a compact range for inexact binary fractions', () => {
            const html = buildModelQuotaGrid([config('M438', 0.29), config('M437', 0.58)]);
            expect(html).toContain('29–58%');
            expect(html).toContain('width:29%');
        });

        it('discloses a raw difference below the displayed precision', () => {
            const html = buildModelQuotaGrid([config('M438', 0.7000000000001), config('M437', 0.7000000000002)]);
            expect(html).toContain('>70%</span>');
            expect(html).toContain('Reported values differ');
            expect(html).toContain('Differences are below displayed precision.');
        });

        it('preserves conflicting duplicate samples but deduplicates exact aliases', () => {
            const configs = [config('M438', 0.8), config('gemini-4-carbon-low', 0.8), config('M438', 0.5)];
            const groups = groupModelQuotas(configs);
            expect(groups).toHaveLength(1);
            expect(groups[0]).toMatchObject({ efforts: ['low'], minimum: 0.5, maximum: 0.8, quotaDiffers: true });
            expect(groups[0].readings).toHaveLength(2);
        });

        it('compares reset instants across timezone spellings and exposes different instants', () => {
            const same = [config('M438', 0.8, RESET), config('M437', 0.8, '2026-11-12T12:00:00+11:00')];
            expect(groupModelQuotas(same)[0].resetDiffers).toBe(false);
            expect(buildModelQuotaGrid(same)).not.toContain('<details');
            const different = [...same, config('M427', 0.8, '2026-11-12T01:00:01Z')];
            expect(groupModelQuotas(different)[0].resetDiffers).toBe(true);
            expect(buildModelQuotaGrid(different)).toContain('Reset times differ');
        });

        it.each([
            '',
            'not-a-date',
            '0',
            '1970',
            '1969-12-31T23:59:59Z',
            '1970-01-01T00:00:00Z',
            '1970-01-01T00:00:00.000Z',
            '1970-01-01T00:00:00+00:00',
            '2026-11-12T01:00:00',
            '2026-02-30T01:00:00Z',
            '2026-11-21T24:00:00Z',
        ])('does not claim missing, epoch or invalid reset %j', reset => {
            const groups = groupModelQuotas([config('M438', 0.8, reset)]);
            expect(groups[0]).toMatchObject({ resetTime: null, missingReset: true });
            expect(buildModelQuotaGrid([config('M438', 0.8, reset)])).toContain('Reset time unavailable');
        });

        it.each([NaN, Infinity, -Infinity, -0.1, 1.1])('renders invalid fraction %s as unknown without an invalid CSS width', fraction => {
            const configs = [config('M438', fraction)];
            expect(groupModelQuotas(configs)[0]).toMatchObject({ minimum: null, maximum: null, missingQuota: true });
            const html = buildModelQuotaGrid(configs);
            expect(html).toContain('Unknown');
            expect(html).not.toContain('aria-valuenow=');
            expect(html).not.toContain('style="width:');
            expect(html).not.toMatch(/NaN|Infinity/);
        });

        it('keeps missing effort quota visible beside known readings and supports exact zero and full quota', () => {
            const missing = { ...config('M427'), quotaInfo: undefined };
            const group = groupModelQuotas([config('M438', 0), config('M437', 1), missing])[0];
            expect(group).toMatchObject({ minimum: 0, maximum: 1, missingQuota: true, missingReset: true, quotaDiffers: true });
            expect(group.readings).toHaveLength(3);
            const html = buildModelQuotaGrid([missing]);
            expect(html.match(/class="model-card"/g)).toHaveLength(1);
            expect(html).toContain('Unknown');
            expect(html).not.toContain('>0%<');
        });
    });


    describe('quota card rendering', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders compact normal and explanatory incomplete cards in %s', async lang => {
            await setLanguageToState(lang, state);
            const normal = buildModelQuotaGrid(['M427', 'M438', 'M437'].map(id => config(id)));
            expect(normal.match(/class="model-card-pct"/g)).toHaveLength(1);
            expect(normal.match(/class="model-card-reset"/g)).toHaveLength(1);
            expect(normal).not.toContain('<details');
            expect(normal).toContain(tBiHtml('Low · Medium · High', '低 · 中 · 高'));
            expect(normal.replace(/<[^>]+>/g, '')).toContain(lang === 'en' ? 'Low · Medium · High' : lang === 'zh' ? '低 · 中 · 高' : 'Low · Medium · High / 低 · 中 · 高');
            const incomplete = buildModelQuotaGrid([config('M438', 0.8), { ...config('M427'), quotaInfo: undefined }]);
            expect(incomplete).toContain(tBiHtml('Some quota or reset data is unavailable', '部分配额或重置数据缺失'));
            expect(incomplete).toContain(tBiHtml('Readings by effort', '各档位读数'));
        });

        it('escapes live labels, tags, unknown IDs and malicious reset values', () => {
            const bad = '"><img src=x onerror=alert(1)>';
            const configs = [{ ...config('M438', 0.8, bad, bad), tagTitle: bad }, config(bad, 0.5, bad, bad)];
            const html = buildModelQuotaGrid(configs);
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;img');
            expect(html).not.toContain('aria-label=""><');
            expect(html).toContain('Reset time unavailable');
        });

        it('universally merges efforts across Neon, Hydrogen, Carbon, Argon, Claude 5.5, GPT-OSS while keeping all 3 Orchestrators distinct', () => {
            const configs: ModelConfig[] = [
                // Gemini 4 Neon (4 efforts -> 1 model)
                config('M534', 0.70, RESET, 'Gemini 4 Neon (Low)'),
                config('M533', 0.70, RESET, 'Gemini 4 Neon (Medium)'),
                config('M532', 0.45, RESET, 'Gemini 4 Neon (High)'),
                { ...config('M535', 0.70, RESET, 'Gemini 4 Neon (Extra / 超高)'), tagTitle: 'New' },
                // 3 distinct Orchestrator variants -> 3 models
                config('M537', 0.70, RESET, 'Orchestrator (Neon)'),
                config('M667', 0.70, RESET, 'Orchestrator (Carbon)'),
                config('M681', 0.70, RESET, 'Orchestrator (Argon)'),
                // Gemini 4 Hydrogen (4 efforts -> 1 model)
                config('M527', 0.70), config('M526', 0.70), config('M525', 0.70), config('M528', 0.70),
                // Gemini 4 Carbon (3 efforts -> 1 model) & Argon (3 efforts -> 1 model)
                config('M438', 0.70), config('M437', 0.70), config('M427', 0.70),
                config('M419', 0.70), config('M418', 0.70), config('M417', 0.70),
                // Claude Opus 5.5 (3 -> 1), Sonnet 5.5 (3 -> 1), GPT-OSS 120B (1 -> 1)
                config('M400', 0.90), config('M401', 0.80), config('M402', 0.90),
                config('M403', 0.90), config('M404', 0.90), config('M405', 0.90),
                config('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 0.90),
            ];
            const groups = groupModelQuotas(configs);
            expect(groups.map(g => g.label)).toEqual(['Gemini', 'Claude / GPT']);
            const [gemini, premium] = groups;
            expect(gemini.members.map(m => m.label)).toEqual([
                'Gemini 4 Neon', 'Orchestrator (Neon)', 'Orchestrator (Carbon)', 'Orchestrator (Argon)',
                'Gemini 4 Hydrogen', 'Gemini 4 Carbon', 'Gemini 4 Argon',
            ]);
            expect(gemini.members[0].efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
            expect(gemini.members[0].tagTitle).toBe('New');
            expect(gemini).toMatchObject({ minimum: 0.45, maximum: 0.70, quotaDiffers: true });
            expect(premium.members.map(m => m.label)).toEqual(['Claude Opus 5.5', 'Claude Sonnet 5.5', 'GPT-OSS 120B']);
            expect(premium).toMatchObject({ minimum: 0.80, maximum: 0.90, quotaDiffers: true });
        });

        it('merges retired placeholder IDs (M37/M36 and M264/M265/M266) even without active specs and strips legacy Chinese 强/弱 labels', () => {
            const proGroups = groupModelQuotas([
                config('M37', 0.8, RESET, 'Gemini 3.1 Pro (强)'),
                config('M36', 0.6, RESET, 'Gemini 3.1 Pro (弱)'),
            ]);
            expect(proGroups).toHaveLength(1);
            expect(proGroups[0].members).toHaveLength(1);
            expect(proGroups[0].members[0]).toMatchObject({ label: 'Gemini 3.1 Pro', efforts: ['low', 'high'] });
            expect(proGroups[0]).toMatchObject({ minimum: 0.6, maximum: 0.8, quotaDiffers: true });

            const flash36Groups = groupModelQuotas([
                config('M264', 0.5, RESET, 'Gemini 3.6 Flash (High)'),
                config('M265', 0.5, RESET, 'Gemini 3.6 Flash (Medium)'),
                config('M266', 0.5, RESET, 'Gemini 3.6 Flash (Low)'),
            ]);
            expect(flash36Groups).toHaveLength(1);
            expect(flash36Groups[0].members).toHaveLength(1);
            expect(flash36Groups[0].members[0]).toMatchObject({ label: 'Gemini 3.6 Flash', efforts: ['low', 'medium', 'high'] });
        });
    });
});

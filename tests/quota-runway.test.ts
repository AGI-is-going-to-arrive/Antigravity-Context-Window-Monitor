import { describe, expect, it } from 'vitest';
import {
    QuotaRunwayTracker,
    StaleCacheGuard,
    isCustomModel,
} from '../src/quota-runway';

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

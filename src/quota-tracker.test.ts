import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock vscode module ──────────────────────────────────────────────────────

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({ get: () => false }),
    },
}));

import { QuotaTracker } from './quota-tracker';
import { ModelConfig } from './models';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockContext() {
    const store = new Map<string, unknown>();
    return {
        globalState: {
            get: (key: string, fallback?: unknown) => store.get(key) ?? fallback,
            update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); },
        },
    } as any;
}

function makeConfig(
    model: string,
    fraction: number | undefined,
    resetTime: string,
    label = model,
): ModelConfig {
    return {
        model,
        label,
        supportsImages: false,
        quotaInfo: { remainingFraction: fraction as number, resetTime },
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
    };
}

function futureReset(base: Date, offsetMs: number): string {
    return new Date(base.getTime() + offsetMs).toISOString();
}

const FIVE_HOURS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QuotaTracker state machine', () => {
    let tracker: QuotaTracker;
    let resetCallback: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tracker = new QuotaTracker(createMockContext());
        tracker.setEnabled(true);
        resetCallback = vi.fn();
        tracker.onQuotaReset = resetCallback as (modelIds: string[]) => void;
    });

    // ─── IDLE State ──────────────────────────────────────────────────────────

    describe('idle state', () => {
        it('should stay idle at 100% during observation window', () => {
            const now = new Date();
            // resetTime stays the same on each poll (locked)
            const config = makeConfig('M1', 1.0, futureReset(now, FIVE_HOURS));
            tracker.processUpdate([config]);
            tracker.processUpdate([config]); // still < 10min observation
            expect(tracker.getActiveSessions().length).toBe(0);
        });

        it('should stay idle when resetTime drifts (API refreshing = unused)', () => {
            const now = new Date();
            // Simulate: each poll returns a slightly different resetTime (refreshing)
            const reset1 = futureReset(now, FIVE_HOURS);
            const reset2 = futureReset(now, FIVE_HOURS + 4 * 60 * 1000); // +4min drift

            tracker.processUpdate([makeConfig('M1', 1.0, reset1)]);
            // Fast forward via idleSince manipulation — but we can't directly.
            // Instead: resetTime drifts > 3min threshold → API is refreshing → reset observation
            tracker.processUpdate([makeConfig('M1', 1.0, reset2)]);

            // Drift detected → reset baseline, model is unused → still idle
            expect(tracker.getActiveSessions().length).toBe(0);
        });

        it('should enter tracking when fraction drops below 1.0', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            expect(tracker.getActiveSessions().length).toBe(0);

            tracker.processUpdate([makeConfig('M1', 0.8, resetTime)]);
            const session = tracker.getActiveSessions().find(s => s.modelId === 'M1');
            expect(session).toBeDefined();
            expect(session!.snapshots.length).toBe(2);
        });

        it('should go straight to done when fraction drops to 0', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0, resetTime)]);

            expect(tracker.getActiveSessions().length).toBe(0);
            const history = tracker.getHistory();
            expect(history.length).toBe(1);
            expect(history[0].completed).toBe(true);
        });
    });

    // ─── Dynamic Detection at 100% ──────────────────────────────────────────

    describe('dynamic usage detection at 100%', () => {
        it('should enter tracking after 10min of stable resetTime', () => {
            // Simulate by manipulating the tracker's internal idleSince
            // through repeated calls with the same resetTime.
            // We can't fake time easily, so we create a tracker with
            // idleSince already 10+ minutes in the past.
            const ctx = createMockContext();
            const now = new Date();
            const resetTime = futureReset(now, 2 * 60 * 60 * 1000); // 2h

            // Pre-seed the model state with idleSince = 11 minutes ago
            const elevenMinAgo = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'idle',
                    lastFraction: 1.0,
                    last100Time: elevenMinAgo,
                    lastResetTime: resetTime,
                    currentSession: null,
                    baselineResetTime: resetTime,
                    idleSince: elevenMinAgo,
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);

            // Poll with SAME resetTime → drift = 0, idle > 10min → enter tracking!
            t.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            expect(t.getActiveSessions().find(s => s.modelId === 'M1')).toBeDefined();
        });

        it('should NOT enter tracking if resetTime drifts during observation', () => {
            const ctx = createMockContext();
            const now = new Date();
            const resetTime1 = futureReset(now, FIVE_HOURS);
            const resetTime2 = futureReset(now, FIVE_HOURS + 5 * 60 * 1000); // +5min

            // Pre-seed with idleSince = 11 minutes ago
            const elevenMinAgo = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'idle',
                    lastFraction: 1.0,
                    last100Time: elevenMinAgo,
                    lastResetTime: resetTime1,
                    currentSession: null,
                    baselineResetTime: resetTime1,
                    idleSince: elevenMinAgo,
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);

            // Poll with DIFFERENT resetTime (+5min drift > 3min threshold)
            // → API refreshed → model is unused → reset observation, stay idle
            t.processUpdate([makeConfig('M1', 1.0, resetTime2)]);
            expect(t.getActiveSessions().length).toBe(0);
        });

        it('should work for 5h cycle models', () => {
            const ctx = createMockContext();
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS - 15 * 60 * 1000); // 4h45m

            const pastTime = new Date(now.getTime() - TEN_MIN - 1000).toISOString();
            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'idle', lastFraction: 1.0, last100Time: pastTime,
                    lastResetTime: resetTime, currentSession: null,
                    baselineResetTime: resetTime, idleSince: pastTime,
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);
            t.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            expect(t.getActiveSessions().length).toBe(1);
        });

        it('should work for 7d cycle models', () => {
            const ctx = createMockContext();
            const now = new Date();
            const resetTime = futureReset(now, SEVEN_DAYS - 30 * 60 * 1000);

            const pastTime = new Date(now.getTime() - TEN_MIN - 1000).toISOString();
            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'idle', lastFraction: 1.0, last100Time: pastTime,
                    lastResetTime: resetTime, currentSession: null,
                    baselineResetTime: resetTime, idleSince: pastTime,
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);
            t.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            expect(t.getActiveSessions().length).toBe(1);
        });

        it('should work for ANY unknown cycle (e.g. 48h)', () => {
            const ctx = createMockContext();
            const now = new Date();
            const resetTime = futureReset(now, 48 * 60 * 60 * 1000);

            const pastTime = new Date(now.getTime() - TEN_MIN - 1000).toISOString();
            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'idle', lastFraction: 1.0, last100Time: pastTime,
                    lastResetTime: resetTime, currentSession: null,
                    baselineResetTime: resetTime, idleSince: pastTime,
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);
            t.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            expect(t.getActiveSessions().length).toBe(1);
        });
    });

    // ─── TRACKING State ──────────────────────────────────────────────────────

    describe('tracking state', () => {
        it('should record snapshots when fraction changes', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.8, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.6, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.4, resetTime)]);

            const session = tracker.getActiveSessions().find(s => s.modelId === 'M1');
            expect(session).toBeDefined();
            expect(session!.snapshots.length).toBeGreaterThanOrEqual(4);
        });

        it('should archive to done when fraction reaches 0', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.5, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0, resetTime)]);

            expect(tracker.getActiveSessions().length).toBe(0);
            const history = tracker.getHistory();
            expect(history.length).toBe(1);
            expect(history[0].completed).toBe(true);
        });

        it('should archive on genuine reset (fraction <1 → 1)', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.6, resetTime)]);

            const newResetTime = futureReset(now, FIVE_HOURS + 3600000);
            tracker.processUpdate([makeConfig('M1', 1.0, newResetTime)]);

            expect(tracker.getActiveSessions().length).toBe(0);
            expect(tracker.getHistory().length).toBe(1);
            expect(resetCallback).toHaveBeenCalledWith(['M1']);
        });

        it('should use official resetTime as endTime on genuine reset', () => {
            const now = new Date();
            const resetTime = futureReset(now, 2 * 3600e3);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.5, resetTime)]);

            const newReset = futureReset(now, FIVE_HOURS);
            tracker.processUpdate([makeConfig('M1', 1.0, newReset)]);

            expect(tracker.getHistory()[0].endTime).toBe(resetTime);
        });

        it('should archive 100%→100% tracking via resetTime jump', () => {
            // Simulate: dynamic detection enters tracking at 100%,
            // then resetTime jumps (new cycle) → should archive
            const ctx = createMockContext();
            const now = new Date();
            const resetTime = futureReset(now, 2 * 3600e3);

            // Pre-seed: tracking at 100% via dynamic detection
            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'tracking', lastFraction: 1.0,
                    last100Time: new Date(now.getTime() - 15 * 60e3).toISOString(),
                    lastResetTime: resetTime, baselineResetTime: resetTime,
                    idleSince: new Date(now.getTime() - 15 * 60e3).toISOString(),
                    currentSession: {
                        id: 'M1_test', modelId: 'M1', modelLabel: 'M1',
                        startTime: new Date(now.getTime() - 15 * 60e3).toISOString(),
                        snapshots: [{ timestamp: new Date(now.getTime() - 15 * 60e3).toISOString(), fraction: 1.0, percent: 100, elapsedMs: 0 }],
                        completed: false,
                    },
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);
            const cb = vi.fn();
            t.onQuotaReset = cb as (modelIds: string[]) => void;

            // Poll with jumped resetTime (> 30min different)
            const newReset = futureReset(now, FIVE_HOURS);
            t.processUpdate([makeConfig('M1', 1.0, newReset)]);

            expect(t.getActiveSessions().length).toBe(0);
            expect(t.getHistory().length).toBe(1);
            expect(t.getHistory()[0].endTime).toBe(resetTime);
            expect(cb).toHaveBeenCalledWith(['M1']);
        });

        it('should archive 100%→100% tracking via resetTime passed', () => {
            const ctx = createMockContext();
            const now = new Date();
            // resetTime is 1 second in the past
            const pastReset = futureReset(now, -1000);

            ctx.globalState.update('quotaActiveTracking', {
                'M1': {
                    state: 'tracking', lastFraction: 1.0,
                    last100Time: new Date(now.getTime() - 2 * 3600e3).toISOString(),
                    lastResetTime: pastReset, baselineResetTime: pastReset,
                    idleSince: new Date(now.getTime() - 2 * 3600e3).toISOString(),
                    currentSession: {
                        id: 'M1_test', modelId: 'M1', modelLabel: 'M1',
                        startTime: new Date(now.getTime() - 2 * 3600e3).toISOString(),
                        snapshots: [{ timestamp: new Date(now.getTime() - 2 * 3600e3).toISOString(), fraction: 1.0, percent: 100, elapsedMs: 0 }],
                        completed: false,
                    },
                },
            });

            const t = new QuotaTracker(ctx);
            t.setEnabled(true);
            const cb = vi.fn();
            t.onQuotaReset = cb as (modelIds: string[]) => void;

            t.processUpdate([makeConfig('M1', 1.0, futureReset(now, FIVE_HOURS))]);

            expect(t.getActiveSessions().length).toBe(0);
            expect(t.getHistory().length).toBe(1);
            expect(cb).toHaveBeenCalledWith(['M1']);
        });
    });

    // ─── DONE State ──────────────────────────────────────────────────────────

    describe('done state', () => {
        it('should return to idle when fraction recovers to 1.0', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0.5, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0, resetTime)]);
            expect(tracker.getHistory().length).toBe(1);

            tracker.processUpdate([makeConfig('M1', 1.0, futureReset(now, FIVE_HOURS))]);
            expect(resetCallback).toHaveBeenCalledWith(['M1']);
        });

        it('should stay in done while fraction remains 0', () => {
            const now = new Date();
            const resetTime = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0, resetTime)]);
            tracker.processUpdate([makeConfig('M1', 0, resetTime)]);
            expect(tracker.getHistory().length).toBe(1);
        });
    });

    // ─── Multi-model ─────────────────────────────────────────────────────────

    describe('multi-model', () => {
        it('should track each model independently', () => {
            const now = new Date();
            const reset = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('A', 1.0, reset), makeConfig('B', 1.0, reset)]);
            tracker.processUpdate([makeConfig('A', 0.6, reset), makeConfig('B', 1.0, reset)]);

            expect(tracker.getActiveSessions().length).toBe(1);
            expect(tracker.getActiveSessions()[0].modelId).toBe('A');
        });

        it('should archive one model without affecting others', () => {
            const now = new Date();
            const reset = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('A', 1.0, reset), makeConfig('B', 1.0, reset)]);
            tracker.processUpdate([makeConfig('A', 0.5, reset), makeConfig('B', 0.8, reset)]);

            const newReset = futureReset(now, FIVE_HOURS * 2);
            tracker.processUpdate([makeConfig('A', 1.0, newReset), makeConfig('B', 0.6, reset)]);

            expect(tracker.getActiveSessions().length).toBe(1);
            expect(tracker.getActiveSessions()[0].modelId).toBe('B');
            expect(tracker.getHistory().length).toBe(1);
            expect(tracker.getHistory()[0].modelId).toBe('A');
        });

        it('should fire callback once per processUpdate with all reset modelIds', () => {
            const now = new Date();
            const reset = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('A', 1.0, reset), makeConfig('B', 1.0, reset)]);
            tracker.processUpdate([makeConfig('A', 0.5, reset), makeConfig('B', 0.5, reset)]);

            // Both reset at same time
            const newReset = futureReset(now, FIVE_HOURS * 2);
            tracker.processUpdate([makeConfig('A', 1.0, newReset), makeConfig('B', 1.0, newReset)]);

            // Callback fired exactly once per processUpdate, with both modelIds
            expect(resetCallback).toHaveBeenCalledTimes(1);
            const calledWith = resetCallback.mock.calls[0][0] as string[];
            expect(calledWith).toContain('A');
            expect(calledWith).toContain('B');
        });
    });

    // ─── resetTrackingStates ─────────────────────────────────────────────────

    describe('resetTrackingStates', () => {
        it('should clear all model states', () => {
            const now = new Date();
            const reset = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, reset)]);
            tracker.processUpdate([makeConfig('M1', 0.5, reset)]);
            expect(tracker.getActiveSessions().length).toBe(1);

            tracker.resetTrackingStates();
            expect(tracker.getActiveSessions().length).toBe(0);
        });

        it('should not affect archived history', () => {
            const now = new Date();
            const reset = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, reset)]);
            tracker.processUpdate([makeConfig('M1', 0, reset)]);
            expect(tracker.getHistory().length).toBe(1);

            tracker.resetTrackingStates();
            expect(tracker.getHistory().length).toBe(1);
        });
    });

    // ─── Edge cases ──────────────────────────────────────────────────────────

    describe('edge cases', () => {
        it('should handle missing quotaInfo gracefully', () => {
            const config: ModelConfig = {
                model: 'M1', label: 'Test', supportsImages: false,
                allowedTiers: [], mimeTypeCount: 0, isRecommended: false,
                supportedMimeTypes: [],
            };
            tracker.processUpdate([config]);
            expect(tracker.getActiveSessions().length).toBe(0);
        });

        it('should handle disabled tracker', () => {
            tracker.setEnabled(false);
            const now = new Date();
            tracker.processUpdate([makeConfig('M1', 0.5, futureReset(now, FIVE_HOURS))]);
            expect(tracker.getActiveSessions().length).toBe(0);
        });

        it('should handle undefined remainingFraction as 0', () => {
            const now = new Date();
            const reset = futureReset(now, FIVE_HOURS);

            tracker.processUpdate([makeConfig('M1', 1.0, reset)]);
            tracker.processUpdate([makeConfig('M1', undefined as any, reset)]);

            expect(tracker.getHistory().length).toBe(1);
            expect(tracker.getHistory()[0].completed).toBe(true);
        });
    });
});

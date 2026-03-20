// ─── Quota Consumption Timeline Tracker ──────────────────────────────────────
// Tracks per-model quota consumption over time.
// State machine per model: IDLE → TRACKING → DONE
//
// IDLE: fraction == 1.0, waiting for first usage
// TRACKING: fraction < 1.0, recording snapshots on each change
// DONE: fraction == 0, session archived

import * as vscode from 'vscode';
import { ModelConfig } from './models';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotaSnapshot {
    /** ISO timestamp when this fraction was observed */
    timestamp: string;
    /** Raw fraction (0.0 ~ 1.0) */
    fraction: number;
    /** Display percentage (0 ~ 100) */
    percent: number;
    /** Milliseconds elapsed since previous snapshot (0 for first) */
    elapsedMs: number;
}

export interface QuotaSession {
    /** Unique session ID */
    id: string;
    /** Model internal ID */
    modelId: string;
    /** Model display label */
    modelLabel: string;
    /** ISO timestamp: last time we saw 100% before tracking started */
    startTime: string;
    /** ISO timestamp: when 0% was reached */
    endTime?: string;
    /** Total duration from start to end in milliseconds */
    totalDurationMs?: number;
    /** Ordered snapshots */
    snapshots: QuotaSnapshot[];
    /** Whether the session reached 0% */
    completed: boolean;
}

type TrackingState = 'idle' | 'tracking' | 'done';

interface ModelState {
    state: TrackingState;
    lastFraction: number;
    /** Last time we observed fraction == 1.0 */
    last100Time: string;
    /** Current active session (during tracking) */
    currentSession: QuotaSession | null;
}

const STORAGE_KEY = 'quotaHistory';
const ACTIVE_KEY = 'quotaActiveTracking';
const MAX_HISTORY_KEY = 'quotaMaxHistory';
const ENABLED_KEY = 'quotaTrackingEnabled';
const DEFAULT_MAX_HISTORY = 20;

// ─── Cycle Detection ─────────────────────────────────────────────────────────
// Known quota reset cycles. An unused model's resetTime ≈ now + cycle.
// When resetTime drifts away from any known cycle by > TOLERANCE, the model
// has genuinely been used.
const KNOWN_CYCLES_MS = [
    5 * 60 * 60 * 1000,            // 5 hours  (Premium tier)
    7 * 24 * 60 * 60 * 1000,       // 7 days   (lower-tier membership)
];
const CYCLE_TOLERANCE_MS = 10 * 60 * 1000; // 10-minute tolerance for polling delay

// ─── QuotaTracker ─────────────────────────────────────────────────────────────

export class QuotaTracker {
    private modelStates = new Map<string, ModelState>();
    private history: QuotaSession[] = [];
    private maxHistory: number = DEFAULT_MAX_HISTORY;
    private enabled: boolean = false;
    private context: vscode.ExtensionContext;
    private _onQuotaReset?: () => void;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.restore();
    }

    /** Register a callback that fires when any model's quota resets (fraction → 1.0). */
    set onQuotaReset(fn: () => void) { this._onQuotaReset = fn; }

    /** Process a batch of model configs (called on each status refresh). */
    processUpdate(configs: ModelConfig[]): void {
        if (!this.enabled) { return; }
        const nowDate = new Date();
        const now = nowDate.toISOString();

        for (const config of configs) {
            if (!config.quotaInfo) { continue; }

            const modelId = config.model;
            // LS omits remainingFraction when quota is exhausted — default to 0
            const fraction = config.quotaInfo.remainingFraction ?? 0;
            const percent = Math.round(fraction * 100);

            let ms = this.modelStates.get(modelId);
            if (!ms) {
                ms = {
                    state: 'idle',
                    lastFraction: fraction,
                    last100Time: now,
                    currentSession: null,
                };
                this.modelStates.set(modelId, ms);
            }

            switch (ms.state) {
                case 'idle':
                    if (fraction >= 1.0) {
                        const resetTimeStr = config.quotaInfo.resetTime || '';
                        if (this.isUnusedModel(resetTimeStr, nowDate)) {
                            // Genuinely unused — keep refreshing baseline
                            ms.last100Time = now;
                            ms.lastFraction = fraction;
                        } else {
                            // Model IS used but still at 100% → start tracking early!
                            // Freeze last100Time (already frozen or first detection)
                            const session: QuotaSession = {
                                id: `${modelId}_${Date.now()}`,
                                modelId,
                                modelLabel: config.label,
                                startTime: ms.last100Time,
                                snapshots: [
                                    {
                                        timestamp: ms.last100Time,
                                        fraction: 1.0,
                                        percent: 100,
                                        elapsedMs: 0,
                                    },
                                ],
                                completed: false,
                            };
                            ms.state = 'tracking';
                            ms.currentSession = session;
                            ms.lastFraction = fraction;
                        }
                    } else {
                        // First usage detected (fraction < 1.0) → start tracking
                        const session: QuotaSession = {
                            id: `${modelId}_${Date.now()}`,
                            modelId,
                            modelLabel: config.label,
                            startTime: ms.last100Time,
                            snapshots: [
                                {
                                    timestamp: ms.last100Time,
                                    fraction: 1.0,
                                    percent: 100,
                                    elapsedMs: 0,
                                },
                                {
                                    timestamp: now,
                                    fraction,
                                    percent,
                                    elapsedMs: new Date(now).getTime() - new Date(ms.last100Time).getTime(),
                                },
                            ],
                            completed: false,
                        };

                        if (fraction <= 0) {
                            // Directly went to 0 (edge case)
                            session.endTime = now;
                            session.totalDurationMs = new Date(now).getTime() - new Date(ms.last100Time).getTime();
                            session.completed = true;
                            this.archiveSession(session);
                            ms.state = 'done';
                            ms.currentSession = null;
                        } else {
                            ms.state = 'tracking';
                            ms.currentSession = session;
                        }
                        ms.lastFraction = fraction;
                    }
                    break;

                case 'tracking':
                    if (!ms.currentSession) {
                        // Shouldn't happen — reset to idle
                        ms.state = 'idle';
                        ms.lastFraction = fraction;
                        break;
                    }

                    if (fraction >= 1.0) {
                        if (ms.lastFraction >= 1.0) {
                            // Still at 100% — haven't dropped yet, just keep tracking
                            break;
                        }
                        // Was below 100%, now back to 100% → genuine reset!
                        ms.currentSession.completed = false;
                        ms.currentSession.endTime = now;
                        ms.currentSession.totalDurationMs =
                            new Date(now).getTime() - new Date(ms.currentSession.startTime).getTime();
                        this.archiveSession(ms.currentSession);
                        ms.currentSession = null;
                        ms.state = 'idle';
                        ms.last100Time = now;
                        ms.lastFraction = fraction;
                        if (this._onQuotaReset) { this._onQuotaReset(); }
                        break;
                    }

                    // Record if fraction changed (rounded to integer %)
                    if (Math.round(fraction * 100) !== Math.round(ms.lastFraction * 100)) {
                        const lastSnap = ms.currentSession.snapshots[ms.currentSession.snapshots.length - 1];
                        const elapsedMs = new Date(now).getTime() - new Date(lastSnap.timestamp).getTime();
                        ms.currentSession.snapshots.push({
                            timestamp: now,
                            fraction,
                            percent,
                            elapsedMs,
                        });
                    }

                    if (fraction <= 0) {
                        // Reached 0% → session complete!
                        ms.currentSession.endTime = now;
                        ms.currentSession.totalDurationMs =
                            new Date(now).getTime() - new Date(ms.currentSession.startTime).getTime();
                        ms.currentSession.completed = true;
                        this.archiveSession(ms.currentSession);
                        ms.currentSession = null;
                        ms.state = 'done';
                    }
                    ms.lastFraction = fraction;
                    break;

                case 'done':
                    if (fraction >= 1.0) {
                        // Reset after done → go idle
                        ms.state = 'idle';
                        ms.last100Time = now;
                        ms.lastFraction = fraction;
                        if (this._onQuotaReset) { this._onQuotaReset(); }
                    } else {
                        ms.lastFraction = fraction;
                    }
                    break;
            }
        }

        this.persist();
    }

    /** Get all currently tracking sessions (not yet archived). */
    getActiveSessions(): QuotaSession[] {
        const result: QuotaSession[] = [];
        for (const ms of this.modelStates.values()) {
            if (ms.currentSession) {
                result.push(ms.currentSession);
            }
        }
        return result;
    }

    /** Get archived session history. */
    getHistory(): QuotaSession[] {
        return [...this.history];
    }

    /** Clear all archived history. */
    clearHistory(): void {
        this.history = [];
        this.persist();
    }

    /** Set maximum number of archived sessions to keep. */
    setMaxHistory(n: number): void {
        this.maxHistory = Math.max(1, n);
        this.trimHistory();
        this.persist();
    }

    /** Get current max history setting. */
    getMaxHistory(): number {
        return this.maxHistory;
    }

    /** Check if tracking is enabled. */
    isEnabled(): boolean {
        return this.enabled;
    }

    /** Enable or disable tracking. */
    setEnabled(val: boolean): void {
        this.enabled = val;
        this.context.globalState.update(ENABLED_KEY, val);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /**
     * Check if a model at 100% fraction is genuinely unused.
     * Unused models have resetTime ≈ now + full_cycle (within ±5min tolerance).
     * Used models have resetTime locked at a fixed future point, drifting from cycle boundaries.
     */
    private isUnusedModel(resetTimeStr: string, now: Date): boolean {
        if (!resetTimeStr) { return true; } // No resetTime → assume unused
        const timeToReset = new Date(resetTimeStr).getTime() - now.getTime();
        if (timeToReset <= 0) { return false; } // Past reset → definitely used

        for (const cycle of KNOWN_CYCLES_MS) {
            if (Math.abs(timeToReset - cycle) <= CYCLE_TOLERANCE_MS) {
                return true; // Within tolerance of a known full cycle → unused
            }
        }
        return false; // Not near any known cycle → has been used
    }

    private archiveSession(session: QuotaSession): void {
        this.history.unshift(session); // newest first
        this.trimHistory();
    }

    private trimHistory(): void {
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(0, this.maxHistory);
        }
    }

    private persist(): void {
        this.context.globalState.update(STORAGE_KEY, this.history);
        this.context.globalState.update(MAX_HISTORY_KEY, this.maxHistory);
        this.context.globalState.update(ENABLED_KEY, this.enabled);

        // Serialize active tracking state
        const activeState: Record<string, {
            state: TrackingState; lastFraction: number;
            last100Time: string; currentSession: QuotaSession | null;
        }> = {};
        for (const [modelId, ms] of this.modelStates.entries()) {
            activeState[modelId] = {
                state: ms.state,
                lastFraction: ms.lastFraction,
                last100Time: ms.last100Time,
                currentSession: ms.currentSession,
            };
        }
        this.context.globalState.update(ACTIVE_KEY, activeState);
    }

    private restore(): void {
        this.history = this.context.globalState.get<QuotaSession[]>(STORAGE_KEY, []);
        this.maxHistory = this.context.globalState.get<number>(MAX_HISTORY_KEY, DEFAULT_MAX_HISTORY);
        this.enabled = this.context.globalState.get<boolean>(ENABLED_KEY, false);

        const activeState = this.context.globalState.get<Record<string, ModelState>>(ACTIVE_KEY);
        if (activeState) {
            for (const [modelId, ms] of Object.entries(activeState)) {
                this.modelStates.set(modelId, ms);
            }
        }
    }
}

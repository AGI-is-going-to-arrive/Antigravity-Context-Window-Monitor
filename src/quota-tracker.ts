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
    /** All model labels sharing the same quota pool (e.g. Claude Sonnet + Opus + GPT-OSS) */
    poolModels?: string[];
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
    /** Last observed API resetTime (ISO) — used to detect quota cycle end */
    lastResetTime: string;
    /** Current active session (during tracking) */
    currentSession: QuotaSession | null;
    /** The resetTime recorded when this model first entered idle at 100% */
    baselineResetTime: string;
    /** When we started observing this model in idle at 100% (ISO) */
    idleSince: string;
}

const STORAGE_KEY = 'quotaHistory';
const ACTIVE_KEY = 'quotaActiveTracking';
const MAX_HISTORY_KEY = 'quotaMaxHistory';
const ENABLED_KEY = 'quotaTrackingEnabled';
const DEFAULT_MAX_HISTORY = 20;

// ─── Tracking Strategy ───────────────────────────────────────────────────────
// Usage detection at 100%:
//   1. Instant: compare model's timeToReset with max across all models (≈cycle).
//      If elapsedInCycle > ELAPSED_THRESHOLD → model is already in use.
//   2. Drift: if resetTime stays locked (no refresh) for ≥ OBSERVATION_WINDOW
//      → model IS used. Unused models get refreshed resetTime periodically.
//   3. Fraction: fraction < 1.0 → enter tracking immediately.
const ELAPSED_THRESHOLD_MS = 10 * 60 * 1000;     // 10 min elapsed in cycle → instant detect
const OBSERVATION_WINDOW_MS = 10 * 60 * 1000;    // 10 min stable resetTime → drift-based detect
const RESET_DRIFT_TOLERANCE_MS = 3 * 60 * 1000;  // 3 min — API variance threshold

// ─── QuotaTracker ─────────────────────────────────────────────────────────────

export class QuotaTracker {
    private modelStates = new Map<string, ModelState>();
    private history: QuotaSession[] = [];
    private maxHistory: number = DEFAULT_MAX_HISTORY;
    private enabled: boolean = false;
    private context: vscode.ExtensionContext;
    private _onQuotaReset?: (modelIds: string[]) => void;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.restore();
    }

    /** Register a callback that fires when model quota resets. Called once per processUpdate batch with all reset modelIds. */
    set onQuotaReset(fn: (modelIds: string[]) => void) { this._onQuotaReset = fn; }

    /** Process a batch of model configs (called on each status refresh). */
    processUpdate(configs: ModelConfig[]): void {
        if (!this.enabled) { return; }
        const nowDate = new Date();
        const now = nowDate.toISOString();
        const nowMs = nowDate.getTime();
        const resetModels: string[] = [];

        // ── Infer cycle length from max timeToReset across all 100% models ──
        // Unused models show ≈full cycle remaining; the max is our best guess.
        let maxTimeToResetMs = 0;
        for (const c of configs) {
            if (!c.quotaInfo) { continue; }
            const f = c.quotaInfo.remainingFraction ?? 0;
            const rt = c.quotaInfo.resetTime;
            if (f >= 1.0 && rt) {
                const ttr = new Date(rt).getTime() - nowMs;
                if (ttr > maxTimeToResetMs) { maxTimeToResetMs = ttr; }
            }
        }

        // ── Pool deduplication: group models sharing the same resetTime ──
        // Same-pool models (e.g., Claude Sonnet/Opus/GPT-OSS) share quota and
        // identical resetTime. Only track one representative per pool to avoid
        // cluttering history with duplicate sessions.
        const poolByResetTime = new Map<string, ModelConfig[]>();
        for (const c of configs) {
            const rt = c.quotaInfo?.resetTime;
            if (!rt) { continue; }
            let pool = poolByResetTime.get(rt);
            if (!pool) { pool = []; poolByResetTime.set(rt, pool); }
            pool.push(c);
        }
        // For multi-model pools, pick the representative: prefer lowest fraction
        // (most usage evidence), then alphabetical label as tie-break.
        const poolSkip = new Set<string>();
        const poolLabelsForModel = new Map<string, string[]>();
        for (const pool of poolByResetTime.values()) {
            if (pool.length <= 1) { continue; }
            pool.sort((a, b) => {
                const fa = a.quotaInfo?.remainingFraction ?? 1;
                const fb = b.quotaInfo?.remainingFraction ?? 1;
                if (fa !== fb) { return fa - fb; } // lowest fraction first
                return a.label.localeCompare(b.label);
            });
            // Collect all labels in this pool for the representative
            const allLabels = pool.map(c => c.label).sort();
            poolLabelsForModel.set(pool[0].model, allLabels);
            // First is representative; rest are skipped
            for (let i = 1; i < pool.length; i++) {
                poolSkip.add(pool[i].model);
            }
        }

        for (const config of configs) {
            if (!config.quotaInfo) { continue; }

            const modelId = config.model;

            // Skip non-representative pool members (same quota pool, different model)
            if (poolSkip.has(modelId)) {
                // Still update basic state so it stays in sync, but never enter tracking
                const existing = this.modelStates.get(modelId);
                if (existing) {
                    existing.lastFraction = config.quotaInfo.remainingFraction ?? 0;
                    existing.lastResetTime = config.quotaInfo.resetTime || '';
                }
                continue;
            }

            // LS omits remainingFraction when quota is exhausted — default to 0
            const fraction = config.quotaInfo.remainingFraction ?? 0;
            const percent = Math.round(fraction * 100);

            let ms = this.modelStates.get(modelId);
            if (!ms) {
                ms = {
                    state: 'idle',
                    lastFraction: fraction,
                    last100Time: now,
                    lastResetTime: config.quotaInfo.resetTime || '',
                    currentSession: null,
                    baselineResetTime: config.quotaInfo.resetTime || '',
                    idleSince: now,
                };
                this.modelStates.set(modelId, ms);
            }

            // Current API resetTime for this model
            const resetTimeStr = config.quotaInfo.resetTime || '';

            // Migrate legacy state: old globalState lacks lastResetTime
            if (!ms.lastResetTime && ms.lastResetTime !== '') {
                ms.lastResetTime = resetTimeStr;
            }

            switch (ms.state) {
                case 'idle':
                    if (fraction >= 1.0) {
                        // ── Usage detection at 100% ─────────────────────────
                        const currentResetMs = resetTimeStr
                            ? new Date(resetTimeStr).getTime() : 0;
                        const timeToResetMs = currentResetMs - nowMs;

                        // Strategy 1: Instant detection via elapsed-in-cycle
                        // If maxTimeToReset ≈ cycle length and this model's
                        // timeToReset is significantly shorter, it's already
                        // been in a used cycle for (max - this) time.
                        let instantDetect = false;
                        if (maxTimeToResetMs > 0 && timeToResetMs > 0) {
                            const elapsedInCycle = maxTimeToResetMs - timeToResetMs;
                            if (elapsedInCycle >= ELAPSED_THRESHOLD_MS) {
                                instantDetect = true;
                            }
                        }

                        // Strategy 2: Drift-based detection (fallback)
                        const baselineMs = ms.baselineResetTime
                            ? new Date(ms.baselineResetTime).getTime() : 0;
                        const resetTimeDrift = Math.abs(currentResetMs - baselineMs);
                        const idleDuration = nowMs - new Date(ms.idleSince).getTime();

                        if (instantDetect) {
                            // Model has been in-cycle for >10min → used!
                            // Backdate startTime to estimated cycle start
                            const estimatedStart = new Date(
                                currentResetMs - maxTimeToResetMs
                            ).toISOString();
                            const session: QuotaSession = {
                                id: `${modelId}_${Date.now()}`,
                                modelId,
                                modelLabel: config.label,
                                poolModels: poolLabelsForModel.get(modelId),
                                startTime: estimatedStart,
                                snapshots: [{
                                    timestamp: estimatedStart,
                                    fraction: 1.0,
                                    percent: 100,
                                    elapsedMs: 0,
                                }],
                                completed: false,
                            };
                            ms.state = 'tracking';
                            ms.currentSession = session;
                            ms.lastFraction = fraction;
                        } else if (resetTimeDrift > RESET_DRIFT_TOLERANCE_MS) {
                            // resetTime shifted — API is refreshing → model is unused
                            ms.baselineResetTime = resetTimeStr;
                            ms.idleSince = now;
                            ms.last100Time = now;
                            ms.lastFraction = fraction;
                        } else if (idleDuration >= OBSERVATION_WINDOW_MS) {
                            // resetTime locked for ≥10min → model IS used!
                            const session: QuotaSession = {
                                id: `${modelId}_${Date.now()}`,
                                modelId,
                                modelLabel: config.label,
                                poolModels: poolLabelsForModel.get(modelId),
                                startTime: ms.last100Time,
                                snapshots: [{
                                    timestamp: ms.last100Time,
                                    fraction: 1.0,
                                    percent: 100,
                                    elapsedMs: 0,
                                }],
                                completed: false,
                            };
                            ms.state = 'tracking';
                            ms.currentSession = session;
                            ms.lastFraction = fraction;
                        } else {
                            // Still observing
                            ms.last100Time = now;
                            ms.lastFraction = fraction;
                        }
                    } else {
                        // Actual usage detected (fraction < 1.0) → start tracking
                        // Backdate startTime to estimated cycle start when possible
                        const curResetMs = resetTimeStr
                            ? new Date(resetTimeStr).getTime() : 0;
                        const estimatedStart = (maxTimeToResetMs > 0 && curResetMs > 0)
                            ? new Date(curResetMs - maxTimeToResetMs).toISOString()
                            : ms.last100Time;
                        const session: QuotaSession = {
                            id: `${modelId}_${Date.now()}`,
                            modelId,
                            modelLabel: config.label,
                            poolModels: poolLabelsForModel.get(modelId),
                            startTime: estimatedStart,
                            snapshots: [
                                {
                                    timestamp: estimatedStart,
                                    fraction: 1.0,
                                    percent: 100,
                                    elapsedMs: 0,
                                },
                                {
                                    timestamp: now,
                                    fraction,
                                    percent,
                                    elapsedMs: nowMs - new Date(estimatedStart).getTime(),
                                },
                            ],
                            completed: false,
                        };

                        if (fraction <= 0) {
                            // Directly went to 0 (edge case)
                            session.endTime = now;
                            session.totalDurationMs = nowMs - new Date(estimatedStart).getTime();
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
                    ms.lastResetTime = resetTimeStr;
                    break;

                case 'tracking':
                    if (!ms.currentSession) {
                        // Shouldn't happen — reset to idle
                        ms.state = 'idle';
                        ms.lastFraction = fraction;
                        ms.lastResetTime = resetTimeStr;
                        break;
                    }

                    // Keep poolModels up-to-date with latest pool membership
                    const latestPoolLabels = poolLabelsForModel.get(modelId);
                    if (latestPoolLabels) {
                        ms.currentSession.poolModels = latestPoolLabels;
                    }

                    if (fraction >= 1.0) {
                        if (ms.lastFraction >= 1.0) {
                            // Entered tracking at 100% via dynamic detection.
                            // Check if the quota cycle has ended via resetTime:
                            //   • resetTime passed (now >= lastResetTime)
                            //   • resetTime jumped forward significantly (new cycle)
                            const lastResetMs = ms.lastResetTime
                                ? new Date(ms.lastResetTime).getTime() : 0;
                            const curResetMs = resetTimeStr
                                ? new Date(resetTimeStr).getTime() : 0;
                            const resetTimePassed = lastResetMs > 0
                                && lastResetMs <= nowDate.getTime();
                            const resetTimeJumped = lastResetMs > 0 && curResetMs > 0
                                && Math.abs(curResetMs - lastResetMs) > 30 * 60 * 1000;

                            if (resetTimePassed || resetTimeJumped) {
                                // Quota cycle ended — archive
                                const endTimeStr = ms.lastResetTime || now;
                                ms.currentSession.completed = false;
                                ms.currentSession.endTime = endTimeStr;
                                ms.currentSession.totalDurationMs =
                                    new Date(endTimeStr).getTime() - new Date(ms.currentSession.startTime).getTime();
                                this.archiveSession(ms.currentSession);
                                ms.currentSession = null;
                                ms.state = 'idle';
                                ms.last100Time = now;
                                ms.lastFraction = fraction;
                                ms.lastResetTime = resetTimeStr;
                                ms.baselineResetTime = resetTimeStr;
                                ms.idleSince = now;
                                resetModels.push(modelId);
                                break;
                            }
                            // Same cycle, still at 100% — keep tracking
                            ms.lastResetTime = resetTimeStr;
                            break;
                        }
                        // Was below 100%, now back to 100% → genuine reset!
                        // Use the stored resetTime as endTime (official reset point)
                        const endTimeStr = ms.lastResetTime || now;
                        ms.currentSession.completed = false;
                        ms.currentSession.endTime = endTimeStr;
                        ms.currentSession.totalDurationMs =
                            new Date(endTimeStr).getTime() - new Date(ms.currentSession.startTime).getTime();
                        this.archiveSession(ms.currentSession);
                        ms.currentSession = null;
                        ms.state = 'idle';
                        ms.last100Time = now;
                        ms.lastFraction = fraction;
                        ms.lastResetTime = resetTimeStr;
                        ms.baselineResetTime = resetTimeStr;
                        ms.idleSince = now;
                        resetModels.push(modelId);
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
                    ms.lastResetTime = resetTimeStr;
                    break;

                case 'done':
                    if (fraction >= 1.0) {
                        // Reset after done → go idle
                        ms.state = 'idle';
                        ms.last100Time = now;
                        ms.lastFraction = fraction;
                        ms.lastResetTime = resetTimeStr;
                        ms.baselineResetTime = resetTimeStr;
                        ms.idleSince = now;
                        resetModels.push(modelId);
                    } else {
                        ms.lastFraction = fraction;
                        ms.lastResetTime = resetTimeStr;
                    }
                    break;
            }
        }

        // Fire callback once with all models that reset in this batch
        if (resetModels.length > 0 && this._onQuotaReset) {
            this._onQuotaReset(resetModels);
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

    /** Reset all model tracking states to idle.
     *  Active sessions are discarded. Next processUpdate will re-detect and re-enter tracking if needed. */
    resetTrackingStates(): void {
        this.modelStates.clear();
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

        // Serialize active tracking state — ALL fields must be persisted
        const activeState: Record<string, ModelState> = {};
        for (const [modelId, ms] of this.modelStates.entries()) {
            activeState[modelId] = {
                state: ms.state,
                lastFraction: ms.lastFraction,
                last100Time: ms.last100Time,
                lastResetTime: ms.lastResetTime,
                currentSession: ms.currentSession,
                baselineResetTime: ms.baselineResetTime,
                idleSince: ms.idleSince,
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
            const now = new Date().toISOString();
            for (const [modelId, ms] of Object.entries(activeState)) {
                // Backfill fields added in later versions
                if (!ms.lastResetTime) { ms.lastResetTime = ''; }
                if (!ms.baselineResetTime) { ms.baselineResetTime = ms.lastResetTime; }
                if (!ms.idleSince) { ms.idleSince = now; }
                this.modelStates.set(modelId, ms);
            }
        }
    }
}

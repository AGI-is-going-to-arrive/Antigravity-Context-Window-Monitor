// ─── Quota Consumption Timeline Tracker ──────────────────────────────────────
// Tracks per-model quota consumption over time.
// State machine per model: IDLE → TRACKING → (archive) → IDLE
//
// IDLE: waiting for first usage detection
// TRACKING: recording snapshots until cycle ends (resetTime passes or shifts)

import * as vscode from 'vscode';
import { ModelConfig } from './models';
import type { StateBucket } from './durable-state';

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
    /** ISO timestamp: when the session ended (cycle reset) */
    endTime?: string;
    /** Total duration from start to end in milliseconds */
    totalDurationMs?: number;
    /** Ordered snapshots */
    snapshots: QuotaSnapshot[];
    /** Whether the session reached 0% at some point */
    completed: boolean;
    /** The API resetTime observed when tracking started — used for cycle-end detection */
    cycleResetTime?: string;
}

type TrackingState = 'idle' | 'tracking';

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
const CYCLE_END_JUMP_MS = 30 * 60 * 1000;        // 30 min — resetTime jump = new cycle

// ─── QuotaTracker ─────────────────────────────────────────────────────────────

export class QuotaTracker {
    private modelStates = new Map<string, ModelState>();
    private history: QuotaSession[] = [];
    private maxHistory: number = DEFAULT_MAX_HISTORY;
    private enabled: boolean = false;
    private context: vscode.ExtensionContext;
    private state: StateBucket;
    private _onQuotaReset?: (modelIds: string[]) => void;

    constructor(context: vscode.ExtensionContext, state?: StateBucket) {
        this.context = context;
        this.state = state || context.globalState;
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
                            const estimatedStart = new Date(
                                currentResetMs - maxTimeToResetMs
                            ).toISOString();
                            this.startTracking(ms, modelId, config.label, estimatedStart, resetTimeStr, fraction, poolLabelsForModel.get(modelId));
                        } else if (resetTimeDrift > RESET_DRIFT_TOLERANCE_MS) {
                            // resetTime shifted — API is refreshing → model is unused
                            ms.baselineResetTime = resetTimeStr;
                            ms.idleSince = now;
                            ms.last100Time = now;
                            ms.lastFraction = fraction;
                        } else if (idleDuration >= OBSERVATION_WINDOW_MS) {
                            this.startTracking(ms, modelId, config.label, ms.last100Time, resetTimeStr, fraction, poolLabelsForModel.get(modelId));
                        } else {
                            ms.last100Time = now;
                            ms.lastFraction = fraction;
                        }
                    } else {
                        // Actual usage detected (fraction < 1.0) → start tracking
                        const curResetMs = resetTimeStr
                            ? new Date(resetTimeStr).getTime() : 0;
                        const estimatedStart = (maxTimeToResetMs > 0 && curResetMs > 0)
                            ? new Date(curResetMs - maxTimeToResetMs).toISOString()
                            : ms.last100Time;
                        this.startTracking(ms, modelId, config.label, estimatedStart, resetTimeStr, 1.0, poolLabelsForModel.get(modelId));
                        // Add the current fraction as second snapshot
                        ms.currentSession!.snapshots.push({
                            timestamp: now,
                            fraction,
                            percent,
                            elapsedMs: nowMs - new Date(estimatedStart).getTime(),
                        });
                        if (fraction <= 0) { ms.currentSession!.completed = true; }
                        ms.lastFraction = fraction;
                    }
                    ms.lastResetTime = resetTimeStr;
                    break;

                case 'tracking': {
                    if (!ms.currentSession) {
                        ms.state = 'idle';
                        ms.lastFraction = fraction;
                        ms.lastResetTime = resetTimeStr;
                        break;
                    }

                    // Keep poolModels up-to-date
                    const latestPoolLabels = poolLabelsForModel.get(modelId);
                    if (latestPoolLabels) {
                        ms.currentSession.poolModels = latestPoolLabels;
                    }

                    // ── Cycle-end detection via cycleResetTime ──
                    if (this.isCycleEnded(ms.currentSession, resetTimeStr, nowMs)) {
                        const endTimeStr = ms.currentSession.cycleResetTime || ms.lastResetTime || now;
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

                    // Record snapshot if fraction changed (integer %)
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

                    // Mark completed at 0% but DO NOT archive — wait for cycle end
                    if (fraction <= 0 && !ms.currentSession.completed) {
                        ms.currentSession.completed = true;
                    }
                    ms.lastFraction = fraction;
                    ms.lastResetTime = resetTimeStr;
                    break;
                }
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
        this.state.update(ENABLED_KEY, val);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /** Helper: begin a tracking session. */
    private startTracking(
        ms: ModelState, modelId: string, label: string,
        startTime: string, resetTime: string, initialFraction: number,
        poolModels?: string[],
    ): void {
        const session: QuotaSession = {
            id: `${modelId}_${Date.now()}`,
            modelId,
            modelLabel: label,
            poolModels,
            startTime,
            snapshots: [{
                timestamp: startTime,
                fraction: initialFraction,
                percent: Math.round(initialFraction * 100),
                elapsedMs: 0,
            }],
            completed: false,
            cycleResetTime: resetTime,
        };
        ms.state = 'tracking';
        ms.currentSession = session;
        ms.lastFraction = initialFraction;
    }

    /** Detect if the quota cycle has ended.
     *  Two signals: (a) cycleResetTime has passed, (b) API resetTime jumped > 30 min. */
    private isCycleEnded(session: QuotaSession, currentResetTimeStr: string, nowMs: number): boolean {
        const cycleMs = session.cycleResetTime
            ? new Date(session.cycleResetTime).getTime() : 0;
        const curMs = currentResetTimeStr
            ? new Date(currentResetTimeStr).getTime() : 0;

        // (a) The expected reset time has passed
        if (cycleMs > 0 && cycleMs <= nowMs) { return true; }

        // (b) API resetTime jumped forward significantly → new cycle
        if (cycleMs > 0 && curMs > 0 && Math.abs(curMs - cycleMs) > CYCLE_END_JUMP_MS) {
            return true;
        }
        return false;
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
        this.state.update(STORAGE_KEY, this.history);
        this.state.update(MAX_HISTORY_KEY, this.maxHistory);
        this.state.update(ENABLED_KEY, this.enabled);

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
        this.state.update(ACTIVE_KEY, activeState);
    }

    private restore(): void {
        this.history = this.state.get<QuotaSession[]>(STORAGE_KEY, []);
        this.maxHistory = this.state.get<number>(MAX_HISTORY_KEY, DEFAULT_MAX_HISTORY);
        this.enabled = this.state.get<boolean>(ENABLED_KEY, false);

        const activeState = this.state.get<Record<string, ModelState> | undefined>(ACTIVE_KEY, undefined);
        if (activeState) {
            const now = new Date().toISOString();
            for (const [modelId, ms] of Object.entries(activeState)) {
                // Backfill fields added in later versions
                if (!ms.lastResetTime) { ms.lastResetTime = ''; }
                if (!ms.baselineResetTime) { ms.baselineResetTime = ms.lastResetTime; }
                if (!ms.idleSince) { ms.idleSince = now; }
                // Migrate: 'done' state removed in v1.13.7 → treat as idle
                if ((ms.state as string) === 'done') {
                    ms.state = 'idle';
                    ms.currentSession = null;
                    ms.last100Time = now;
                }
                // Migrate: backfill cycleResetTime for sessions created before v1.13.7
                if (ms.currentSession && !ms.currentSession.cycleResetTime) {
                    ms.currentSession.cycleResetTime = ms.lastResetTime;
                }
                this.modelStates.set(modelId, ms);
            }
        }
    }
}

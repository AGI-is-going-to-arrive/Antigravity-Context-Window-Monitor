// ─── Quota Consumption Timeline Tracker ──────────────────────────────────────
// Tracks per-model quota consumption over time.
// State machine per model: IDLE → TRACKING → (archive) → IDLE
//
// IDLE: waiting for first usage detection
// TRACKING: recording snapshots until cycle ends (resetTime passes or shifts)

import * as vscode from 'vscode';
import { getQuotaPoolKey, ModelConfig } from './models';
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
    /** Account email that owns this session (for multi-account isolation) */
    accountEmail?: string;
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
    /** Last known full-window remaining time for this model/pool (ms). */
    knownWindowMs: number;
}

const STORAGE_KEY = 'quotaHistory';
const ACTIVE_KEY = 'quotaActiveTracking';
const MAX_HISTORY_KEY = 'quotaMaxHistory';
const ENABLED_KEY = 'quotaTrackingEnabled';
const DEFAULT_MAX_HISTORY = 20;

// ─── Tracking Strategy ───────────────────────────────────────────────────────
// Usage detection:
//   1. Primary: fraction < 1.0 → enter tracking immediately.
//   2. GMTracker: usedModelIds from caller confirms actual LLM calls at frac=1.0.
//   3. Drift: if resetTime shifts (sliding window refresh), reset baseline.
const RESET_DRIFT_TOLERANCE_MS = 3 * 60 * 1000;  // 3 min — API variance threshold
const CYCLE_END_JUMP_MS = 30 * 60 * 1000;        // 30 min — resetTime jump = new cycle
const FUTURE_TOLERANCE_MS = 2 * 60 * 1000;       // 2 min — tolerate small clock drift only

function getUsableKnownWindowMs(knownWindowMs: number, currentTimeToResetMs: number): number {
    if (knownWindowMs <= 0 || currentTimeToResetMs <= 0) {
        return 0;
    }
    // If current remaining time is far LONGER than what we previously learned,
    // service-side rules likely changed. Don't backdate with stale assumptions.
    if (currentTimeToResetMs > knownWindowMs + CYCLE_END_JUMP_MS) {
        return 0;
    }
    return knownWindowMs;
}

// ─── QuotaTracker ─────────────────────────────────────────────────────────────

export class QuotaTracker {
    private modelStates = new Map<string, ModelState>();
    private history: QuotaSession[] = [];
    private maxHistory: number = DEFAULT_MAX_HISTORY;
    private enabled: boolean = true;
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

    /** Process a batch of model configs (called on each status refresh).
     *  @param usedModelIds — model IDs with confirmed LLM calls in this cycle (from GMTracker).
     *  @param accountEmail — current account email for per-account state isolation. */
    processUpdate(configs: ModelConfig[], usedModelIds?: Set<string>, accountEmail?: string): void {
        if (!this.enabled) { return; }
        const emailPrefix = accountEmail ? `${accountEmail}:` : '';
        const nowDate = new Date();
        const now = nowDate.toISOString();
        const nowMs = nowDate.getTime();
        const resetModels: string[] = [];

        // Only sanitize states belonging to the current account
        for (const [stateKey, ms] of this.modelStates.entries()) {
            if (stateKey.startsWith(emailPrefix) || (!emailPrefix && !stateKey.includes(':'))) {
                this.sanitizeModelState(stateKey, ms, nowDate);
            }
        }

        // ── Pool deduplication: group models by stable quota-pool key ──
        // Known pools are model-family based (e.g. Gemini Pro High/Low, Claude+OSS),
        // not merely "same resetTime". Different independent pools can refresh at the
        // same moment, so resetTime equality alone is not sufficient.
        const poolByKey = new Map<string, ModelConfig[]>();
        for (const c of configs) {
            const key = getQuotaPoolKey(c.model, c.quotaInfo?.resetTime);
            let pool = poolByKey.get(key);
            if (!pool) { pool = []; poolByKey.set(key, pool); }
            pool.push(c);
        }
        // For multi-model pools, pick the representative: prefer lowest fraction
        // (most usage evidence), then alphabetical label as tie-break.
        const poolSkip = new Set<string>();
        const poolLabelsForModel = new Map<string, string[]>();
        for (const pool of poolByKey.values()) {
            if (pool.length <= 1) { continue; }
            pool.sort((a, b) => {
                const aKey = `${emailPrefix}${a.model}`;
                const bKey = `${emailPrefix}${b.model}`;
                const aTracking = this.modelStates.get(aKey)?.state === 'tracking'
                    && !!this.modelStates.get(aKey)?.currentSession;
                const bTracking = this.modelStates.get(bKey)?.state === 'tracking'
                    && !!this.modelStates.get(bKey)?.currentSession;
                if (aTracking !== bTracking) { return aTracking ? -1 : 1; }

                const aStart = this.modelStates.get(aKey)?.currentSession?.startTime || '';
                const bStart = this.modelStates.get(bKey)?.currentSession?.startTime || '';
                if (aTracking && bTracking && aStart !== bStart) {
                    return aStart.localeCompare(bStart);
                }

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
            const stateKey = `${emailPrefix}${modelId}`;

            // Skip non-representative pool members (same quota pool, different model)
            if (poolSkip.has(modelId)) {
                // Still update basic state so it stays in sync, but never enter tracking
                const existing = this.modelStates.get(stateKey);
                if (existing) {
                    existing.lastFraction = config.quotaInfo.remainingFraction ?? 0;
                    existing.lastResetTime = config.quotaInfo.resetTime || '';
                }
                continue;
            }

            // LS omits remainingFraction when quota is exhausted — default to 0
            const fraction = config.quotaInfo.remainingFraction ?? 0;
            const percent = Math.round(fraction * 100);

            let ms = this.modelStates.get(stateKey);
            if (!ms) {
                ms = {
                    state: 'idle',
                    lastFraction: fraction,
                    last100Time: now,
                    lastResetTime: config.quotaInfo.resetTime || '',
                    currentSession: null,
                    baselineResetTime: config.quotaInfo.resetTime || '',
                    idleSince: now,
                    knownWindowMs: 0,
                };
                this.modelStates.set(stateKey, ms);
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
                        // ── frac=1.0: maintain baseline + GMTracker-assisted detection ──
                        // remainingFraction is quantized in 20% steps, so frac=1.0
                        // could mean 0–19% consumed. Learn resetTime patterns and
                        // enter tracking only when GMTracker confirms actual usage.
                        const currentResetMs = resetTimeStr
                            ? new Date(resetTimeStr).getTime() : 0;
                        const timeToResetMs = currentResetMs - nowMs;
                        const knownWindowMs = getUsableKnownWindowMs(ms.knownWindowMs, timeToResetMs);

                        const baselineMs = ms.baselineResetTime
                            ? new Date(ms.baselineResetTime).getTime() : 0;
                        const resetTimeDrift = Math.abs(currentResetMs - baselineMs);

                        if (resetTimeDrift > RESET_DRIFT_TOLERANCE_MS) {
                            // resetTime shifted — API is refreshing (sliding window)
                            ms.baselineResetTime = resetTimeStr;
                            ms.idleSince = now;
                        }

                        // GMTracker confirms this model has been called in current cycle
                        // → enter tracking immediately, even though frac is still 1.0
                        if (usedModelIds?.has(modelId) && currentResetMs > nowMs) {
                            const estimatedStart = (knownWindowMs > 0 && currentResetMs > 0)
                                ? new Date(currentResetMs - knownWindowMs).toISOString()
                                : ms.last100Time;
                            this.startTracking(ms, modelId, config.label, estimatedStart, resetTimeStr, fraction, poolLabelsForModel.get(modelId), accountEmail);
                        } else {
                            ms.last100Time = now;
                            ms.lastFraction = fraction;
                            if (timeToResetMs > 0) {
                                ms.knownWindowMs = timeToResetMs;
                            }
                        }
                    } else {
                        // Actual usage detected (fraction < 1.0) → start tracking
                        const curResetMs = resetTimeStr
                            ? new Date(resetTimeStr).getTime() : 0;

                        // ── Stale-resetTime guard ────────────────────────────
                        // After a quota reset the API may still report the OLD
                        // resetTime (already in the past) for several minutes.
                        // If we enter tracking with a past cycleResetTime,
                        // isCycleEnded() fires immediately on the next poll →
                        // archive → back to idle → re-enter → infinite ghost-
                        // session loop.  Stay idle until API provides a future
                        // resetTime for the new cycle.
                        if (curResetMs > 0 && curResetMs <= nowMs) {
                            ms.lastFraction = fraction;
                            ms.lastResetTime = resetTimeStr;
                            break;
                        }

                        const timeToResetMs = curResetMs - nowMs;
                        const knownWindowMs = getUsableKnownWindowMs(ms.knownWindowMs, timeToResetMs);
                        const observedFullBeforeDrop = ms.lastFraction >= 1.0;
                        const startTimeCandidate = (knownWindowMs > 0 && curResetMs > 0)
                            ? new Date(curResetMs - knownWindowMs).toISOString()
                            : (observedFullBeforeDrop ? ms.last100Time : now);
                        const startTime = this.sanitizeTrackingStartTime(
                            startTimeCandidate,
                            observedFullBeforeDrop ? ms.last100Time : now,
                            resetTimeStr,
                            nowDate,
                        );
                        const initialFraction = (knownWindowMs > 0 || observedFullBeforeDrop) ? 1.0 : fraction;
                        this.startTracking(ms, modelId, config.label, startTime, resetTimeStr, initialFraction, poolLabelsForModel.get(modelId), accountEmail);
                        // Add the current fraction only when it differs from the initial snapshot.
                        if (Math.round(initialFraction * 100) !== percent) {
                            ms.currentSession!.snapshots.push({
                                timestamp: now,
                                fraction,
                                percent,
                                elapsedMs: nowMs - new Date(startTime).getTime(),
                            });
                        }
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
                        const nextWindowMs = resetTimeStr ? new Date(resetTimeStr).getTime() - nowMs : 0;
                        if (nextWindowMs > 0) {
                            ms.knownWindowMs = nextWindowMs;
                        }
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
                    } else if (fraction > 0 && ms.currentSession.completed) {
                        // If the service later reports quota back above 0%,
                        // treat the session as active again instead of keeping
                        // the stale "completed" badge.
                        ms.currentSession.completed = false;
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

    /** Archive active tracking sessions for a specific account whose quota has expired.
     *  Called by checkCachedAccountResets() when a cached (non-active) account's
     *  quota pool resets — the QuotaTracker never receives API config updates for
     *  these accounts, so their sessions would stay in 'tracking' state forever.
     *  @param email — account email to match against session.accountEmail
     *  @param modelLabels — model labels in the expired pool (used to scope archival)
     *  @returns number of sessions archived */
    archiveExpiredSessions(email: string, modelLabels: string[]): number {
        if (!email) { return 0; }
        const now = new Date();
        const nowIso = now.toISOString();
        const labelSet = new Set(modelLabels.map(l => l.toLowerCase()));
        let count = 0;

        for (const [stateKey, ms] of this.modelStates.entries()) {
            if (!ms.currentSession) { continue; }
            // Match by account email prefix in stateKey (format: "email:modelId")
            if (!stateKey.startsWith(`${email}:`)) { continue; }
            // Match by model label (pool scope)
            const sessionLabel = ms.currentSession.modelLabel?.toLowerCase() || '';
            const hasPoolMatch = labelSet.has(sessionLabel)
                || (ms.currentSession.poolModels || []).some(p => labelSet.has(p.toLowerCase()));
            if (!hasPoolMatch && labelSet.size > 0) { continue; }

            // Archive the session with resetTime as end time
            const endTime = ms.currentSession.cycleResetTime || nowIso;
            ms.currentSession.endTime = endTime;
            ms.currentSession.totalDurationMs =
                new Date(endTime).getTime() - new Date(ms.currentSession.startTime).getTime();
            this.archiveSession(ms.currentSession);
            ms.currentSession = null;
            ms.state = 'idle';
            ms.last100Time = nowIso;
            ms.lastFraction = 1.0;
            ms.idleSince = nowIso;
            count++;
        }

        if (count > 0) { this.persist(); }
        return count;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /** Helper: begin a tracking session. */
    private startTracking(
        ms: ModelState, modelId: string, label: string,
        startTime: string, resetTime: string, initialFraction: number,
        poolModels?: string[],
        accountEmail?: string,
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
            accountEmail,
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

    private sanitizeTrackingStartTime(
        candidateIso: string,
        fallbackIso: string,
        resetTimeIso: string,
        now: Date,
    ): string {
        const nowMs = now.getTime();
        const candidateMs = Date.parse(candidateIso);
        const fallbackMs = Date.parse(fallbackIso);
        const resetMs = resetTimeIso ? Date.parse(resetTimeIso) : 0;

        const candidateValid = !isNaN(candidateMs)
            && candidateMs <= nowMs + FUTURE_TOLERANCE_MS
            && (!resetMs || candidateMs <= resetMs);
        if (candidateValid) {
            return new Date(candidateMs).toISOString();
        }

        const fallbackValid = !isNaN(fallbackMs)
            && fallbackMs <= nowMs + FUTURE_TOLERANCE_MS
            && (!resetMs || fallbackMs <= resetMs);
        if (fallbackValid) {
            return new Date(fallbackMs).toISOString();
        }

        return now.toISOString();
    }

    private sanitizeModelState(modelId: string, ms: ModelState, now: Date): void {
        const nowMs = now.getTime();
        const sanitizeIso = (iso: string, fallback = now.toISOString()): string => {
            const parsed = Date.parse(iso);
            if (isNaN(parsed)) { return fallback; }
            return new Date(parsed).toISOString();
        };

        ms.last100Time = sanitizeIso(ms.last100Time);
        ms.idleSince = sanitizeIso(ms.idleSince, ms.last100Time);
        ms.lastResetTime = ms.lastResetTime ? sanitizeIso(ms.lastResetTime, '') : '';
        ms.baselineResetTime = ms.baselineResetTime ? sanitizeIso(ms.baselineResetTime, ms.lastResetTime) : ms.lastResetTime;

        if (!ms.currentSession) { return; }

        const originalSnapshots = Array.isArray(ms.currentSession.snapshots) ? ms.currentSession.snapshots : [];
        const snapshots = originalSnapshots
            .filter(s => Number.isFinite(s.fraction) && Number.isFinite(s.percent))
            .map(s => {
                const parsed = Date.parse(s.timestamp);
                return Number.isNaN(parsed)
                    ? null
                    : { ...s, timestamp: new Date(parsed).toISOString(), elapsedMs: Math.max(0, s.elapsedMs || 0) };
            })
            .filter((s): s is QuotaSnapshot => !!s)
            .filter(s => Date.parse(s.timestamp) <= nowMs + FUTURE_TOLERANCE_MS)
            .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

        if (snapshots.length === 0) {
            ms.currentSession = null;
            ms.state = 'idle';
            ms.lastFraction = 1.0;
            ms.last100Time = now.toISOString();
            ms.idleSince = now.toISOString();
            return;
        }

        snapshots[0].elapsedMs = 0;
        for (let i = 1; i < snapshots.length; i++) {
            const prevMs = Date.parse(snapshots[i - 1].timestamp);
            const currMs = Date.parse(snapshots[i].timestamp);
            snapshots[i].elapsedMs = Math.max(0, currMs - prevMs);
        }

        const earliestSnapshot = snapshots[0].timestamp;
        ms.currentSession.snapshots = snapshots;
        ms.currentSession.startTime = this.sanitizeTrackingStartTime(
            ms.currentSession.startTime,
            earliestSnapshot,
            ms.currentSession.cycleResetTime || ms.lastResetTime,
            now,
        );
        if (Date.parse(ms.currentSession.startTime) > Date.parse(earliestSnapshot)) {
            ms.currentSession.startTime = earliestSnapshot;
        }
        if (ms.currentSession.cycleResetTime) {
            ms.currentSession.cycleResetTime = sanitizeIso(ms.currentSession.cycleResetTime, ms.lastResetTime);
        }
        ms.lastFraction = snapshots[snapshots.length - 1].fraction;
        if (ms.state === 'tracking' && !ms.currentSession.id) {
            ms.currentSession.id = `${modelId}_${Date.now()}`;
        }
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
                knownWindowMs: ms.knownWindowMs,
            };
        }
        this.state.update(ACTIVE_KEY, activeState);
    }

    private restore(): void {
        this.history = this.state.get<QuotaSession[]>(STORAGE_KEY, []);
        this.maxHistory = this.state.get<number>(MAX_HISTORY_KEY, DEFAULT_MAX_HISTORY);
        this.enabled = this.state.get<boolean>(ENABLED_KEY, true);

        const activeState = this.state.get<Record<string, ModelState> | undefined>(ACTIVE_KEY, undefined);
        if (activeState) {
            const now = new Date().toISOString();
            for (const [modelId, ms] of Object.entries(activeState)) {
                // Backfill fields added in later versions
                if (!ms.lastResetTime) { ms.lastResetTime = ''; }
                if (!ms.baselineResetTime) { ms.baselineResetTime = ms.lastResetTime; }
                if (!ms.idleSince) { ms.idleSince = now; }
                if (!ms.knownWindowMs) { ms.knownWindowMs = 0; }
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
                this.sanitizeModelState(modelId, ms, new Date());
                this.modelStates.set(modelId, ms);
            }
        }
    }
}

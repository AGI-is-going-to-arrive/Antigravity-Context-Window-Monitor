// ─── GM Tracker Class ────────────────────────────────────────────────────────
// Core GMTracker class: fetch, aggregate, reset, serialize.

import { LSInfo } from '../discovery';
import { rpcCall } from '../rpc-client';
import { fetchTrajectoryGeneratorMetadataResult, requireGeneratorMetadata, validateStepsPageResponse, type RawGeneratorMetadataEntry } from '../tracker';
import { normalizeModelDisplayName, getQuotaPoolKey, resolveModelId, type ModelConfig } from '../models';
import type { QuotaSession } from '../quota-tracker';
import type {
    GMCallEntry,
    GMCheckpointSummary,
    GMCompletionConfig,
    GMConversationData,
    GMModelStats,
    GMSummary,
    GMSystemContextItem,
    GMTrackerState,
    TokenBreakdownGroup,
    UniqueErrorEntry,
    RecentErrorEntry,
    ToolCatalogEntry,
} from './types';
import { cloneConversationData, cloneTokenBreakdownGroups } from './types';
import {
    parseGMEntry,
    maybeEnrichCallsFromTrajectory,
    mergeGMCallEntries,
    applyTrajectoryModelHints,
    isValidCallTimestamp,
    shouldEnrichConversation,
    buildGMMatchKey,
    buildGMArchiveKey,
    deduplicateApiErrorText,
    extractCheckpointsFromTrajectorySteps,
} from './parser';
import { buildSummaryFromConversations, normalizeGMSummary, parseErrorCode, normalizeErrorMessage, MAX_RECENT_ERRORS } from './summary';
import { MIN_OUTPUT_TOKENS_FOR_SPEED, MIN_STREAM_SECONDS } from '../telemetry-metrics';
import {
    LATE_CROSS_MIDNIGHT_WINDOW_MS,
    toLocalDateKey,
    type LedgerCallEntry,
    type RecordCallStatus,
} from '../daily-ledger';

/**
 * Whether a (lower-cased) string is a raw platform model identifier rather than a display label.
 * Pool matching falls back to substring comparison for human-readable labels; raw IDs must be
 * excluded from that fallback because M-numbers are plain decimal and therefore prefix-collide
 * (m18 ⊂ m187, m29 ⊂ m298, m30 ⊂ m300). Exact-equality matching on IDs happens separately.
 */
export function isRawModelId(value: string): boolean {
    return (value || '').trim().toLowerCase().startsWith('model_');
}

function dateKeyToStartOfDayMs(dateKey: string): number {
    const parts = dateKey.split('-');
    if (parts.length !== 3) { return 0; }
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) { return 0; }
    return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

const ARCHIVE_CUTOFF_FUTURE_TOLERANCE_MS = 60 * 1000;

function isUsableArchiveCutoff(cutoff: string, nowMs = Date.now()): boolean {
    const cutoffMs = Date.parse(cutoff);
    return !Number.isNaN(cutoffMs)
        && cutoffMs <= nowMs + ARCHIVE_CUTOFF_FUTURE_TOLERANCE_MS;
}

/** Stable call fingerprint (`executionId` or composite of createdAt + model + inputTokens/usage). */
export function computeGMCallFingerprint(call: GMCallEntry): string {
    if (call.executionId) {
        return `exec:${call.executionId}`;
    }
    return [
        'archive',
        buildGMArchiveKey(call),
        `in:${call.inputTokens}`,
        `out:${call.outputTokens}`,
        `think:${call.thinkingTokens}`,
        `cache:${call.cacheReadTokens}`,
        `start:${call.startStepIndex}`,
    ].join('|');
}

function ledgerCallIdentity(call: GMCallEntry): string {
    return computeGMCallFingerprint(call);
}

/** Enriching a missing timestamp must not turn an already recorded call into a new one. */
function sameLedgerCallIdentity(previous: string, current: string): boolean {
    if (previous === current) { return true; }
    const withoutDate = (identity: string): { key: string; date: string } | null => {
        if (!identity.startsWith('archive|')) { return null; }
        const start = identity.lastIndexOf('|created:');
        const end = identity.indexOf('|in:', start);
        if (start < 0 || end < 0) { return null; }
        return { key: identity.slice(0, start) + identity.slice(end), date: identity.slice(start + '|created:'.length, end) };
    };
    const old = withoutDate(previous);
    const next = withoutDate(current);
    if (!old || !next || old.key !== next.key) { return false; }
    return !isValidCallTimestamp(old.date) || !isValidCallTimestamp(next.date)
        || Date.parse(old.date) === Date.parse(next.date);
}

/**
 * Durable logical call ID independent of mutable array indices.
 * Scoped by `cascadeId` + stable call fingerprint (`exec:<executionId>` or `archive|...`).
 */
export function ledgerDedupKey(cascadeId: string, call: GMCallEntry): string {
    return `${cascadeId}|${encodeURIComponent(ledgerCallIdentity(call))}`;
}

function parseLedgerDedupConversation(dedupKey: string): string | null {
    if (!dedupKey) { return null; }
    const pipeIdx = dedupKey.indexOf('|');
    if (pipeIdx > 0) {
        const prefix = dedupKey.slice(0, pipeIdx);
        return prefix.replace(/:\d+$/, '') || null;
    }
    const colonIdx = dedupKey.lastIndexOf(':');
    if (colonIdx > 0) {
        return dedupKey.slice(0, colonIdx);
    }
    return null;
}

function parseLedgerDedupPosition(dedupKey: string): { conversationId: string; index: number } | null {
    const prefix = dedupKey.split('|', 1)[0];
    const splitAt = prefix.lastIndexOf(':');
    if (splitAt <= 0) { return null; }
    const indexPart = prefix.slice(splitAt + 1);
    if (!/^\d+$/.test(indexPart)) { return null; }
    const index = Number.parseInt(indexPart, 10);
    if (Number.isNaN(index)) { return null; }
    return {
        conversationId: prefix.slice(0, splitAt),
        index,
    };
}


/** Deduplicate checkpoint summaries from multiple GM calls, keyed by stepIndex */
function deduplicateCheckpoints(calls: GMCallEntry[]): GMCheckpointSummary[] {
    const byStep = new Map<number, GMCheckpointSummary>();
    for (const call of calls) {
        for (const cp of call.checkpointSummaries) {
            const existing = byStep.get(cp.stepIndex);
            if (!existing || cp.fullText.length > existing.fullText.length) {
                byStep.set(cp.stepIndex, cp);
            }
        }
    }
    return [...byStep.values()].sort((a, b) => a.stepIndex - b.stepIndex);
}

/** Deduplicate system context items from multiple GM calls, keyed by type+stepIndex */
function deduplicateSystemContextItems(calls: GMCallEntry[]): GMSystemContextItem[] {
    const byKey = new Map<string, GMSystemContextItem>();
    for (const call of calls) {
        for (const item of call.systemContextItems) {
            const key = `${item.type}:${item.stepIndex}`;
            const existing = byKey.get(key);
            if (!existing || item.fullText.length > existing.fullText.length) {
                byKey.set(key, item);
            }
        }
    }
    return [...byKey.values()].sort((a, b) => a.stepIndex - b.stepIndex);
}

const ACTIVE_IDLE_RECHECK_MS = 60_000;
const IDLE_ERROR_BACKOFF_BASE_MS = 60 * 1000;
const IDLE_ERROR_BACKOFF_MAX_MS = 10 * 60 * 1000;
/** Bounded concurrency for GMTracker.fetchAll() per-conversation RPC fetches. */
export const GM_FETCH_CONCURRENCY = 3;

function sameStepIndices(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, idx) => v === b[idx]);
}

function hasConflictingExecutionId(
    a: Pick<GMCallEntry, 'executionId'>,
    b: Pick<GMCallEntry, 'executionId'>,
): boolean {
    return Boolean(a.executionId && b.executionId && a.executionId !== b.executionId);
}

// Worker GM records can omit timestamps. Read the indexed planner steps for the
// recent calls shown by the ledger, bounded independently of the worker's history.
async function dateRecentMemberCalls(
    ls: LSInfo, cascadeId: string, stepCount: number, calls: GMCallEntry[], signal?: AbortSignal,
): Promise<GMCallEntry[]> {
    const recent = calls.slice(-20).filter(call => !isValidCallTimestamp(call.createdAt));
    const indices = recent.flatMap(call => call.stepIndices).filter(idx => Number.isSafeInteger(idx) && idx >= 0 && idx < stepCount);
    if (!indices.length) { return calls; }
    const last = indices.reduce((max, idx) => Math.max(max, idx), -1);
    const first = Math.max(last - 39, indices.reduce((min, idx) => Math.min(min, idx), last));
    const read = async (start: number) => {
        const response = await rpcCall(ls, 'GetCascadeTrajectorySteps', {
            cascadeId, stepOffset: start, startIndex: start, endIndex: last + 1,
        }, 4_000, signal, { maxResponseBytes: 2 * 1024 * 1024 });
        const page = validateStepsPageResponse(response, start);
        if (!page.ok || page.steps.length < last - start + 1 || page.steps.length > stepCount - start) {
            throw new Error('Incomplete member planner step range');
        }
        const steps = page.steps.slice(0, last - start + 1).map((step, i) => ({ ...step, stepIndex: start + i }));
        const covered = recent.filter(call => call.stepIndices.length && call.stepIndices.every(idx => idx >= start && idx <= last));
        const enriched = applyTrajectoryModelHints(covered, steps);
        const byCall = new Map(covered.map((call, i) => [call, enriched[i]]));
        return calls.map(call => byCall.get(call) ?? call);
    };
    try {
        return await read(first);
    } catch (err) {
        if (signal?.aborted || first === last || !/response (?:exceeded|too large)|Incomplete member planner step range/i.test(String(err))) { throw err; }
        // A large tool result or short page may obscure only the earlier calls.
        const mostRecent = [...recent].reverse().find(call => call.stepIndices.includes(last));
        const retryFrom = mostRecent?.stepIndices.reduce((min, idx) => Math.min(min, idx), last);
        if (retryFrom === undefined || retryFrom <= first) { throw err; }
        return read(retryFrom);
    }
}

function inheritEnrichedCallFields(calls: GMCallEntry[], cachedCalls: GMCallEntry[] | undefined): GMCallEntry[] {
    if (!cachedCalls || cachedCalls.length === 0 || calls.length === 0) { return calls; }

    const cachedByMatchKey = new Map<string, GMCallEntry[]>();
    const cachedByExecId = new Map<string, GMCallEntry[]>();
    for (const prev of cachedCalls) {
        const matchKey = buildGMMatchKey(prev);
        const byKey = cachedByMatchKey.get(matchKey);
        if (byKey) { byKey.push(prev); } else { cachedByMatchKey.set(matchKey, [prev]); }
        if (prev.executionId) {
            const byExec = cachedByExecId.get(prev.executionId);
            if (byExec) { byExec.push(prev); } else { cachedByExecId.set(prev.executionId, [prev]); }
        }
    }

    const callsExecIdCount = new Map<string, number>();
    for (const call of calls) {
        if (call.executionId) {
            callsExecIdCount.set(call.executionId, (callsExecIdCount.get(call.executionId) ?? 0) + 1);
        }
    }

    return calls.map((call, i) => {
        let prev: GMCallEntry | undefined;

        const exactMatches = cachedByMatchKey.get(buildGMMatchKey(call));
        if (exactMatches && exactMatches.length === 1 && !hasConflictingExecutionId(call, exactMatches[0])) {
            prev = exactMatches[0];
        }

        if (!prev && call.executionId) {
            const execCandidates = cachedByExecId.get(call.executionId) || [];
            if (execCandidates.length === 1 && callsExecIdCount.get(call.executionId) === 1) {
                prev = execCandidates[0];
            } else if (execCandidates.length > 0 && call.stepIndices.length > 0) {
                const overlapping = execCandidates.filter(c =>
                    c.stepIndices.some(idx => call.stepIndices.includes(idx)),
                );
                if (overlapping.length === 1) {
                    prev = overlapping[0];
                }
            }
        }

        if (!prev && i < cachedCalls.length) {
            const candidate = cachedCalls[i];
            if (!hasConflictingExecutionId(call, candidate)) {
                const stepsMatch = call.stepIndices.length > 0 && candidate.stepIndices.length > 0
                    && sameStepIndices(call.stepIndices, candidate.stepIndices);
                const fallbackMatch = candidate.startStepIndex === call.startStepIndex
                    && candidate.inputTokens === call.inputTokens
                    && candidate.outputTokens === call.outputTokens;
                if (stepsMatch || fallbackMatch) {
                    prev = candidate;
                }
            }
        }

        if (!prev) { return call; }
        const merged = mergeGMCallEntries(call, prev);
        if (merged.modelAccuracy !== 'exact' && prev.modelAccuracy === 'exact') {
            return { ...merged, modelAccuracy: 'exact' };
        }
        return merged;
    });
}

// PendingArchiveEntry is now defined in ./types and re-exported from this module.

export class GMTracker {
    private _cache = new Map<string, GMConversationData>();
    private _lastFetchedAt = '';
    /** Cached summary for instant access after restore */
    private _lastSummary: GMSummary | null = null;
    /** Per-conversation baseline call counts — calls[0..baseline-1] are from prior cycles */
    private _callBaselines = new Map<string, number>();
    /** When true, first fetchAll() baselines all existing API data before counting new calls. */
    private _needsBaselineInit = true;
    private _pendingStartupBaselines = new Set<string>();
    /** executionIds of calls already archived by per-pool resets — excluded from _buildSummary() */
    private _archivedCallIds = new Set<string>();
    /** Model ID → ISO cutoff: calls with createdAt ≤ cutoff are excluded — survives empty _cache.calls */
    private _archivedModelCutoffs = new Map<string, string>();
    /** Current active account email — stamped onto newly fetched GM calls */
    private _currentAccountEmail = '';
    /** Persistent map: executionId -> accountEmail. Survives cache overwrites from re-fetches. */
    private _callAccountMap = new Map<string, string>();
    /** Per-account+model ISO cutoffs: key="email|normalizedModel" — calls before cutoff are excluded */
    private _archivedAccountModelCutoffs = new Map<string, string>();
    /** Per-account+model exact archival coverage: when present, prefer archivedCallIds
     *  over cutoff-time filtering so later same-model calls are not hidden by stale timestamps. */
    private _exactArchivedAccountModels = new Set<string>();
    /** Persisted tool call counts — survives restarts via serialize/restore.
     *  Merged with freshly computed counts (max-wins) since API re-fetch
     *  may not return messagePrompts for all conversations. */
    private _persistedToolCounts: Record<string, number> = {};
    /** Persisted per-conversation tool call counts — same semantics. */
    private _persistedToolCountsByConv: Record<string, Record<string, number>> = {};
    /** Persisted recent error messages — survives restarts and reinstalls. */
    private _persistedRecentErrors: string[] = [];
    /** Persisted error code frequency — survives restarts and reinstalls. */
    private _persistedRetryErrorCodes: Record<string, number> = {};
    /** Per-account persisted error code counts: email → { code → count }.
     *  Survives account switches — each account retains its own error history. */
    private _persistedRetryErrorCodesByAccount: Record<string, Record<string, number>> = {};
    /** Per-account persisted recent error messages: email → string[]. */
    private _persistedRecentErrorsByAccount: Record<string, string[]> = {};
    /** Per-account deduplicated unique errors: email → { errorCode → { message, firstSeen } }.
     *  Only the first occurrence of each error code is kept. */
    private _persistedUniqueErrorsByAccount: Record<string, Record<string, { message: string; firstSeen: string }>> = {};
    /** Per-account tool catalog: email → { toolName → { firstSeen, description? } }.
     *  Tracks the first usage of each tool for building a persistent inventory. */
    private _persistedToolCatalogByAccount: Record<string, Record<string, { firstSeen: string; description?: string }>> = {};
    /** Tracks per-conversation RUNNING status to detect RUNNING→IDLE transition. */
    private _lastRunningStatus = new Map<string, boolean>();
    /** In-memory only: non-running conversations settled at stepCount (not serialized). */
    private _settledIdle = new Map<string, { stepCount: number; revision: string; fetchedAt: number }>();
    /** In-memory only: latest stepCount:callCount snapshot already enriched via GetCascadeTrajectory. */
    private _enrichedSnapshots = new Map<string, string>();
    /** In-memory only: bounded exponential backoff for idle RPC failures. */
    private _errorBackoffByCascade = new Map<string, { stepCount: number; revision: string; attempts: number; nextRetryAt: number }>();
    /** Per-conversation call position already submitted to DailyLedger.
     *  Key = cascadeId, Value = number of calls already recorded.
     *  Used by getNewCallsSinceLastRecord() to extract incremental diff. */
    private _ledgerPositions = new Map<string, number>();
    /** Per-conversation submitted call identities by calls[] index.
     *  Lets reverted conversations skip unchanged calls that later return
     *  and detects equal-length or longer branch rewinds via prefix comparison. */
    private _ledgerCallIdentities = new Map<string, string[]>();
    /** Per-conversation set of durably acknowledged logical call identities (handles out-of-order persistence without cursor skipping). */
    private _ledgerAcknowledgedIds = new Map<string, Set<string>>();
    /** Conversations reverted all the way to stepCount === 0 since the last getNewCallsSinceLastRecord() call. */
    private _pendingRevertedCascadeIds = new Set<string>();
    /** Whether fetchAll() has successfully repopulated calls[] since restore.
     *  When false, _cache.calls is empty (stripped during serialize) and
     *  _buildSummary() would return totalCalls=0. In that state, getters
     *  should use _lastSummary (persisted snapshot) instead of rebuilding. */
    private _hasFetchedCalls = true;

    private _purgeUnusableArchiveCutoffs(nowMs = Date.now()): void {
        for (const [key, cutoff] of this._archivedAccountModelCutoffs) {
            if (isUsableArchiveCutoff(cutoff, nowMs)) { continue; }
            this._archivedAccountModelCutoffs.delete(key);
            this._exactArchivedAccountModels.delete(key);
        }
    }

    private _recordIdleErrorBackoff(cascadeId: string, stepCount: number, revision: string, nowMs: number): void {
        const prev = this._errorBackoffByCascade.get(cascadeId);
        const attempts = prev && prev.stepCount === stepCount && prev.revision === revision ? prev.attempts + 1 : 1;
        const delayMs = Math.min(
            IDLE_ERROR_BACKOFF_MAX_MS,
            IDLE_ERROR_BACKOFF_BASE_MS * Math.pow(2, attempts - 1),
        );
        this._errorBackoffByCascade.set(cascadeId, {
            stepCount,
            revision,
            attempts,
            nextRetryAt: nowMs + delayMs,
        });
    }

    /**
     * Reset idle RPC/enrichment error backoff timers (e.g. on manual refresh)
     * so previously failed conversations retry immediately on the next fetchAll().
     */
    clearErrorBackoff(activeCascadeId?: string): void {
        if (activeCascadeId) {
            this._settledIdle.delete(activeCascadeId);
            this._enrichedSnapshots.delete(activeCascadeId);
        }
        for (const [cascadeId, entry] of this._errorBackoffByCascade.entries()) {
            this._errorBackoffByCascade.set(cascadeId, {
                ...entry,
                attempts: 0,
                nextRetryAt: 0,
            });
        }
    }

    /** Clear cached GM state for a conversation that was reset/rewound to 0 steps. */
    private _clearConversationForZeroSteps(cascadeId: string): void {
        const hadCached = this._cache.delete(cascadeId);
        this._settledIdle.delete(cascadeId);
        this._enrichedSnapshots.delete(cascadeId);
        this._errorBackoffByCascade.delete(cascadeId);
        this._lastRunningStatus.delete(cascadeId);
        this._callBaselines.delete(cascadeId);
        this._pendingStartupBaselines.delete(cascadeId);
        const prevPos = this._ledgerPositions.get(cascadeId) || 0;
        if (prevPos > 0) {
            this._ledgerPositions.set(cascadeId, 0);
            this._pendingRevertedCascadeIds.add(cascadeId);
        } else if (hadCached) {
            this._ledgerPositions.delete(cascadeId);
        }
    }

    /**
     * Fetch GM data for the given trajectories using a bounded concurrency pool (concurrency = 3).
     * Only re-fetches RUNNING conversations; IDLE ones use cache.
     * Immediately aborts and rethrows when `signal` is aborted without recording backoff errors.
     */
    async fetchAll(
        ls: LSInfo,
        trajectories: { cascadeId: string; title: string; stepCount: number; status: string; manifestMember?: boolean; lastModifiedTime?: string; trajectoryId?: string; killed?: boolean }[],
        activeCascadeId?: string,
        signal?: AbortSignal,
        fetchManifestMetadata?: (cascadeId: string) => Promise<RawGeneratorMetadataEntry[]>,
    ): Promise<GMSummary> {
        if (signal?.aborted) {
            throw new Error('RPC aborted');
        }

        const meta = { metadata: { ideName: 'antigravity', extensionName: 'antigravity' } };
        const nowMs = Date.now();

        // Deduplicate by cascadeId preserving input order, and clear cached state for stepCount === 0.
        const seenIds = new Set<string>();
        const toProcess: typeof trajectories = [];
        for (const t of trajectories) {
            if (!t.cascadeId || seenIds.has(t.cascadeId)) { continue; }
            seenIds.add(t.cascadeId);
            if (t.stepCount === 0) {
                this._clearConversationForZeroSteps(t.cascadeId);
                if (t.manifestMember) {
                    this._pendingStartupBaselines.delete(t.cascadeId);
                    this._callBaselines.set(t.cascadeId, 0);
                }
                continue;
            }
            // A historical worker can be discovered after the initial inventory. Keep
            // its full call history for inspection, and start recording deltas only
            // after a successful read. Preserve existing member cursors on restore.
            if (t.manifestMember && !this._callBaselines.has(t.cascadeId)
                && !this._ledgerPositions.has(t.cascadeId) && !this._ledgerCallIdentities.has(t.cascadeId)) {
                this._pendingStartupBaselines.add(t.cascadeId);
            }
            toProcess.push(t);
        }

        if (this._needsBaselineInit) {
            for (const t of toProcess) {
                if (!this._callBaselines.has(t.cascadeId)) { this._pendingStartupBaselines.add(t.cascadeId); }
            }
            this._needsBaselineInit = false;
        }
        const baselineIfPending = (id: string, calls: GMCallEntry[]) => {
            if (this._pendingStartupBaselines.delete(id)) {
                this._callBaselines.set(id, calls.length);
                this._rememberLedgerCallIdentities(id, calls, calls.length);
            }
        };

        const processOne = async (
            t: (typeof trajectories)[number],
        ): Promise<void> => {
            if (signal?.aborted) {
                throw new Error('RPC aborted');
            }

            const cached = this._cache.get(t.cascadeId);
            // Skip IDLE conversations that haven't changed AND already have calls data
            // (or settled at this stepCount after a real fetch during this process lifetime).
            // After restore (calls stripped for storage), cached.calls is empty and
            // _settledIdle is empty — must re-fetch once to hydrate.
            // EXCEPTION: force one re-fetch when a conversation JUST transitioned from
            // RUNNING → IDLE, because the last GM call may not have been captured
            // during the final RUNNING poll (GM API lags behind Steps API).
            const wasRunning = this._lastRunningStatus.get(t.cascadeId) === true;
            const isRunning = t.status === 'CASCADE_RUN_STATUS_RUNNING';
            this._lastRunningStatus.set(t.cascadeId, isRunning);
            const justBecameIdle = wasRunning && !isRunning;

            const revision = `${t.trajectoryId || ''}|${t.lastModifiedTime || ''}`;
            const settled = this._settledIdle.get(t.cascadeId);
            const revisionChanged = !!settled && settled.revision !== revision;
            const trajectoryReplaced = !!t.trajectoryId && !!cached?.trajectoryId && cached.trajectoryId !== t.trajectoryId;
            if (justBecameIdle || revisionChanged || trajectoryReplaced || (cached && t.stepCount < cached.totalSteps)) {
                this._enrichedSnapshots.delete(t.cascadeId);
                this._settledIdle.delete(t.cascadeId);
            }

            let retryingAfterBackoff = false;
            const existingBackoff = this._errorBackoffByCascade.get(t.cascadeId);
            if (existingBackoff) {
                if (isRunning || justBecameIdle || existingBackoff.stepCount !== t.stepCount || existingBackoff.revision !== revision) {
                    this._errorBackoffByCascade.delete(t.cascadeId);
                } else if (nowMs < existingBackoff.nextRetryAt) {
                    return;
                } else {
                    retryingAfterBackoff = true;
                }
            }

            const alreadyHydrated = !!cached
                && cached.calls.length > 0
                && cached.calls.every(call => isValidCallTimestamp(call.createdAt));
            // A selected, idle conversation can receive delayed GM records even when the
            // summary revision stays unchanged. Bound that probe to one per minute.
            const watchForLateCalls = t.cascadeId === activeCascadeId || (t.manifestMember === true && !t.killed);
            const alreadySettledAtSteps = !!settled && settled.stepCount === t.stepCount && !revisionChanged;
            const needsActiveProbe = watchForLateCalls && (!settled || nowMs - settled.fetchedAt >= ACTIVE_IDLE_RECHECK_MS);
            const canSkipIdle = !!cached
                && !isRunning
                && !justBecameIdle
                && !revisionChanged
                && !trajectoryReplaced
                && !needsActiveProbe
                && !retryingAfterBackoff
                && cached.totalSteps === t.stepCount
                && (alreadySettledAtSteps || (alreadyHydrated && !t.trajectoryId && !t.lastModifiedTime));

            if (canSkipIdle) {
                baselineIfPending(t.cascadeId, cached.calls);
                return;
            }

            try {
                let rawGM: RawGeneratorMetadataEntry[];
                if (t.manifestMember && fetchManifestMetadata) {
                    rawGM = await fetchManifestMetadata(t.cascadeId);
                } else {
                    rawGM = requireGeneratorMetadata(await fetchTrajectoryGeneratorMetadataResult(ls, t.cascadeId, signal, 30_000));
                }

                const previous = trajectoryReplaced ? undefined : cached;
                let calls = inheritEnrichedCallFields(rawGM.map(parseGMEntry), previous?.calls);
                const recentWorkerCalls = t.manifestMember ? calls.slice(-20) : [];
                const enrichKey = [t.stepCount, calls.length, recentWorkerCalls.filter(c => isValidCallTimestamp(c.createdAt)).length,
                    recentWorkerCalls.length ? buildGMMatchKey(recentWorkerCalls[recentWorkerCalls.length - 1]) : ''].join(':');
                const skipCachedEnrichment = !isRunning
                    && !justBecameIdle
                    && this._enrichedSnapshots.get(t.cascadeId) === enrichKey;
                let trajectorySteps: any[] = [];
                let enrichmentFailed = false;
                if (t.manifestMember && !skipCachedEnrichment && recentWorkerCalls.some(c => !isValidCallTimestamp(c.createdAt))) {
                    try {
                        calls = await dateRecentMemberCalls(ls, t.cascadeId, t.stepCount, calls, signal);
                        if (!isRunning) { this._enrichedSnapshots.set(t.cascadeId, enrichKey); }
                    } catch (err) {
                        if (signal?.aborted) { throw err; }
                        enrichmentFailed = true;
                    }
                }
                if (!t.manifestMember && !skipCachedEnrichment && shouldEnrichConversation(t.stepCount, calls)) {
                    try {
                        const fullResp = await rpcCall(ls, 'GetCascadeTrajectory',
                            { cascadeId: t.cascadeId, ...meta }, 60000, signal) as Record<string, unknown>;
                        const trajectory = (fullResp.trajectory || {}) as Record<string, unknown>;
                        if (Array.isArray(trajectory.steps)) {
                            trajectorySteps = trajectory.steps;
                        }
                        const embeddedRawGM = (trajectory.generatorMetadata || []) as Record<string, unknown>[];
                        if (embeddedRawGM.length > 0) {
                            calls = maybeEnrichCallsFromTrajectory(
                                calls,
                                embeddedRawGM.map(parseGMEntry),
                            );
                        }
                        calls = applyTrajectoryModelHints(calls, trajectorySteps);
                        if (!isRunning) {
                            this._enrichedSnapshots.set(t.cascadeId, enrichKey);
                        }
                    } catch (enrichErr) {
                        if (signal?.aborted) {
                            throw enrichErr;
                        }
                        enrichmentFailed = true;
                        // Enrichment is best-effort only; keep lightweight GM payload.
                    }
                }

                // Restore/tag accountEmail using persistent call-key map.
                // The map survives cache overwrites — each call's account is
                // recorded once and never overwritten on subsequent re-fetches.
                // Key = executionId (unique per call). Falls back to
                // cascadeId:stepIndices for calls without executionId.
                // v1.17.6: changed from cascadeId:arrayIndex to identity-based keys
                // to prevent stale account tags after extension restart when the
                // API returns the same calls at different array positions.
                for (let i = 0; i < calls.length; i++) {
                    const c = calls[i];
                    const key = c.executionId
                        ? `exec:${c.executionId}`
                        : `${t.cascadeId}:${c.stepIndices.join(',')}:${c.model}`;
                    // Also check legacy index-based key for migration
                    const legacyKey = `${t.cascadeId}:${i}`;
                    const known = this._callAccountMap.get(key)
                        || this._callAccountMap.get(legacyKey);
                    if (known) {
                        // Already tracked — restore original account
                        c.accountEmail = known;
                        // Migrate legacy key to new identity-based key
                        if (!this._callAccountMap.has(key)) {
                            this._callAccountMap.set(key, known);
                        }
                    } else if (this._currentAccountEmail) {
                        // New call — tag with current active account
                        c.accountEmail = this._currentAccountEmail;
                        this._callAccountMap.set(key, this._currentAccountEmail);
                    }
                }

                let coveredSteps = 0;
                for (const c of calls) { coveredSteps += c.stepIndices.length; }

                const trajCheckpoints = extractCheckpointsFromTrajectorySteps(trajectorySteps);

                const finalCPs = deduplicateCheckpoints(calls);
                const existingCPNums = new Set(finalCPs.map(c => c.checkpointNumber));
                for (const tcp of trajCheckpoints) {
                    if (!existingCPNums.has(tcp.checkpointNumber)) {
                        existingCPNums.add(tcp.checkpointNumber);
                        finalCPs.push(tcp);
                    }
                }
                if (trajectorySteps.length === 0 && previous && previous.totalSteps <= t.stepCount) {
                    for (const prevCp of previous.checkpointSummaries || []) {
                        if (!existingCPNums.has(prevCp.checkpointNumber)) {
                            existingCPNums.add(prevCp.checkpointNumber);
                            finalCPs.push(prevCp);
                        }
                    }
                }
                finalCPs.sort((a, b) => a.checkpointNumber - b.checkpointNumber);

                const finalContextItems = deduplicateSystemContextItems(calls);
                const existingCPStepsInContext = new Set(finalContextItems.filter(i => i.type === 'checkpoint').map(i => i.stepIndex));
                for (const tcp of trajCheckpoints) {
                    if (!existingCPStepsInContext.has(tcp.stepIndex)) {
                        existingCPStepsInContext.add(tcp.stepIndex);
                        finalContextItems.push({
                            type: 'checkpoint',
                            stepIndex: tcp.stepIndex,
                            tokens: tcp.tokens,
                            label: `Checkpoint ${tcp.checkpointNumber}`,
                            fullText: tcp.fullText,
                            checkpointNumber: tcp.checkpointNumber
                        });
                    }
                }
                if (trajectorySteps.length === 0 && previous && previous.totalSteps <= t.stepCount) {
                    const existingCtxKeys = new Set(finalContextItems.map(i => `${i.type}:${i.stepIndex}`));
                    for (const prevItem of previous.systemContextItems || []) {
                        const itemKey = `${prevItem.type}:${prevItem.stepIndex}`;
                        if (!existingCtxKeys.has(itemKey)) {
                            existingCtxKeys.add(itemKey);
                            finalContextItems.push(prevItem);
                        }
                    }
                }
                finalContextItems.sort((a, b) => a.stepIndex - b.stepIndex);

                this._cache.set(t.cascadeId, {
                    cascadeId: t.cascadeId,
                    title: t.title,
                    trajectoryId: t.trajectoryId,
                    totalSteps: t.stepCount,
                    calls,
                    lifetimeCalls: Math.max(cached?.lifetimeCalls ?? cached?.calls.length ?? 0, calls.length),
                    coveredSteps,
                    coverageRate: t.stepCount > 0 ? coveredSteps / t.stepCount : 0,
                    checkpointSummaries: finalCPs,
                    systemContextItems: finalContextItems,
                });
                baselineIfPending(t.cascadeId, calls);
                if (enrichmentFailed && !isRunning) {
                    this._settledIdle.delete(t.cascadeId);
                    this._recordIdleErrorBackoff(t.cascadeId, t.stepCount, revision, nowMs);
                } else {
                    this._errorBackoffByCascade.delete(t.cascadeId);
                    if (!isRunning) {
                        this._settledIdle.set(t.cascadeId, { stepCount: t.stepCount, revision, fetchedAt: nowMs });
                    } else {
                        this._settledIdle.delete(t.cascadeId);
                    }
                }
            } catch (err) {
                if (signal?.aborted) {
                    throw err;
                }
                // An exhausted local scheduling allowance is not an idle backend error.
                // Leave deferred members eligible for the next fair polling round.
                if (t.manifestMember && /Trajectory poll (?:byte )?budget exhausted/i.test(String(err))) { return; }
                if (!isRunning) {
                    this._recordIdleErrorBackoff(t.cascadeId, t.stepCount, revision, nowMs);
                }
                // Keep stale cache on error
                if (!cached) {
                    this._cache.set(t.cascadeId, {
                        cascadeId: t.cascadeId,
                        title: t.title,
                        totalSteps: t.stepCount,
                        calls: [],
                        lifetimeCalls: 0,
                        coveredSteps: 0,
                        coverageRate: 0,
                        checkpointSummaries: [],
                        systemContextItems: [],
                    });
                }
            }
        };

        // Bounded concurrency pool (concurrency = 3)
        let cursor = 0;
        let abortError: unknown = null;
        const workerCount = Math.min(GM_FETCH_CONCURRENCY, toProcess.length);
        const workers: Promise<void>[] = [];
        for (let w = 0; w < workerCount; w++) {
            workers.push((async () => {
                while (cursor < toProcess.length && !abortError && !signal?.aborted) {
                    const item = toProcess[cursor++];
                    try {
                        await processOne(item);
                    } catch (err) {
                        if (!abortError) {
                            abortError = err;
                        }
                        break;
                    }
                }
            })());
        }
        await Promise.allSettled(workers);

        if (abortError) {
            throw abortError;
        }
        if (signal?.aborted) {
            throw new Error('RPC aborted');
        }

        this._lastFetchedAt = new Date().toISOString();

        this._hasFetchedCalls = true;
        // _lastSummary stores the FULL cross-account summary so that
        // serialize() → restore() → getArchivalSummary() can fall back to
        // the complete picture even after calls[] are stripped.
        this._lastSummary = this._buildSummary(true, true);
        // Return account-filtered view for the UI.
        return this._buildSummary();
    }

    /** Build aggregated summary from cached data */
    private _buildSummary(skipAccountFilter = false, skipArchivalFilter = false): GMSummary {
        if (!skipArchivalFilter) {
            this._purgeUnusableArchiveCutoffs();
        }

        const conversations: GMConversationData[] = [];
        const modelAgg = new Map<string, {
            callCount: number; stepsCovered: number;
            totalInput: number; totalOutput: number; totalThinking: number;
            totalCache: number; totalCacheCreation: number; totalCredits: number;
            ttfts: number[]; streams: number[];
            timedOutputTokens: number; timedStreamingSeconds: number;
            cacheHits: number;
            responseModel: string; apiProvider: string;
            completionConfig: GMCompletionConfig | null;
            hasSystemPrompt: boolean;
            toolCount: number;
            promptSectionTitles: string[];
            totalRetries: number;
            errorCount: number;
            /** Number of calls that consumed credits (credits > 0) */
            creditCallCount: number;
            exactCallCount: number;
            placeholderOnlyCalls: number;
            contextWindowCapacity: number;
        }>();

        let totalCalls = 0;
        let totalStepsCovered = 0;
        let totalCredits = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let totalCache = 0;
        let totalCacheCreation = 0;
        let totalThinking = 0;
        let totalRetryTokens = 0;
        let totalRetryCredits = 0;
        let totalRetryCount = 0;
        let latestTokenBreakdown: TokenBreakdownGroup[] = [];
        const stopReasonCounts: Record<string, number> = {};
        const retryErrorCodes: Record<string, number> = {};
        const recentErrors: string[] = [];
        const toolCallCounts: Record<string, number> = {};
        const toolCallCountsByConv: Record<string, Record<string, number>> = {};
        const retryErrorCodesByConv: Record<string, Record<string, number>> = {};
        const toolCatalogMap = new Map<string, ToolCatalogEntry>();
        const contextGrowth: { step: number; tokens: number; model: string }[] = [];
        const todayKey = toLocalDateKey();
        const dayStartMs = dateKeyToStartOfDayMs(todayKey);

        for (const [, conv] of this._cache) {
            // Only aggregate calls from the current cycle (after baseline)
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const sliced = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;

            // Filter out calls already archived by per-pool resets
            // skipArchivalFilter: used by getArchivalSummary() for midnight archival
            // — includes both pending-archive and active calls for DailyStore.
            const hasCallFilter = !skipArchivalFilter && this._archivedCallIds.size > 0;
            const hasAccountModelFilter = !skipArchivalFilter && this._archivedAccountModelCutoffs.size > 0;
            const activeCalls = (hasCallFilter || hasAccountModelFilter)
                ? sliced.filter(c => {
                    const archiveKey = buildGMArchiveKey(c);
                    const exactArchived = hasCallFilter
                        && (this._archivedCallIds.has(c.executionId)
                            || this._archivedCallIds.has(archiveKey));
                    if (exactArchived) {
                        return false;
                    }
                    // Per-account+model cutoff is only a fallback for restore-time cases
                    // where we had no hydrated calls to archive individually.
                    if (hasAccountModelFilter && c.accountEmail) {
                        const amKey = `${c.accountEmail}|${c.model}`;
                        const amCutoff = this._archivedAccountModelCutoffs.get(amKey);
                        if (amCutoff && !this._exactArchivedAccountModels.has(amKey)) {
                            if (!isUsableArchiveCutoff(amCutoff)) {
                                return true;
                            }
                            const callMs = Date.parse(c.createdAt || '');
                            const cutoffMs = Date.parse(amCutoff);
                            if (!isNaN(callMs) && !isNaN(cutoffMs) && callMs <= cutoffMs) {
                                return false;
                            }
                        }
                    }
                    return true;
                })
                : sliced;

            // Prevent history data pollution: only count calls from today in active metrics (global totals & breakdown)
            const todayFilteredCalls = dayStartMs > 0
                ? activeCalls.filter(c => {
                    if (!c.createdAt) { return true; }
                    const callMs = Date.parse(c.createdAt);
                    return isNaN(callMs) || callMs >= dayStartMs;
                })
                : activeCalls;

            // ── Account-level filtering for model statistics ──
            // The conversations[] array keeps ALL calls (all accounts) so the UI
            // can still show per-account breakdown tags. But modelBreakdown and
            // global totals only count calls belonging to the current online account.
            // Calls with empty accountEmail (legacy / pre-tagging data) are included
            // as a migration courtesy — they'll be tagged on next re-fetch.
            const accountFilteredCalls = (this._currentAccountEmail && !skipAccountFilter)
                ? todayFilteredCalls.filter(c =>
                    !c.accountEmail || c.accountEmail === this._currentAccountEmail)
                : todayFilteredCalls;

            // conversations array keeps activeCalls (NO dayStartMs filtering) so timeline shows full history!
            const activeStepsCovered = activeCalls.reduce((sum, c) => sum + c.stepIndices.length, 0);
            const accountCredits = accountFilteredCalls.reduce((sum, c) => sum + c.credits, 0);
            conversations.push({
                ...conv,
                calls: activeCalls,
                lifetimeCalls: conv.lifetimeCalls ?? conv.calls.length,
                coveredSteps: activeStepsCovered,
                coverageRate: conv.totalSteps > 0 ? activeStepsCovered / conv.totalSteps : 0,
                checkpointSummaries: conv.checkpointSummaries || deduplicateCheckpoints(activeCalls),
                systemContextItems: conv.systemContextItems || deduplicateSystemContextItems(activeCalls),
                accountCredits,
            });

            // ── Tool call counting (ALL accounts, immune to quota-reset archival) ──
            // Uses `todayFilteredSliced` (post-baseline, pre-archival, today-only) so tool counts represent today's rank.
            const countedToolSteps = new Set<number>();
            const convToolCounts: Record<string, number> = {};
            const todayFilteredSliced = dayStartMs > 0
                ? sliced.filter(c => {
                    if (!c.createdAt) { return true; }
                    const callMs = Date.parse(c.createdAt);
                    return isNaN(callMs) || callMs >= dayStartMs;
                })
                : sliced;
            for (const c of todayFilteredSliced) {
                const callTime = c.createdAt || '';
                for (const stepIdx of c.stepIndices) {
                    if (countedToolSteps.has(stepIdx)) { continue; }
                    const toolNames = c.toolCallsByStep[stepIdx];
                    if (toolNames) {
                        countedToolSteps.add(stepIdx);
                        for (const name of toolNames) {
                            toolCallCounts[name] = (toolCallCounts[name] || 0) + 1;
                            convToolCounts[name] = (convToolCounts[name] || 0) + 1;
                            // Track first-seen for tool catalog
                            const existing = toolCatalogMap.get(name);
                            if (!existing || (callTime && callTime < existing.firstSeen)) {
                                toolCatalogMap.set(name, { name, firstSeen: callTime });
                            }
                        }
                    }
                }
            }
            if (Object.keys(convToolCounts).length > 0) {
                toolCallCountsByConv[conv.cascadeId] = convToolCounts;
            }

            // ── Per-conversation error counting (account-filtered + archive-filtered) ──
            // Uses `accountFilteredCalls` (same source as retryErrorCodes totals)
            // so the per-conv delta (+x) never exceeds the global total.
            // Quota resets clear errors for the archived account; midnight reset()
            // clears all counts for a new day.
            const convErrorCodes: Record<string, number> = {};
            for (const c of accountFilteredCalls) {
                for (const errMsg of c.retryErrors) {
                    const code = parseErrorCode(errMsg);
                    convErrorCodes[code] = (convErrorCodes[code] || 0) + 1;
                }
                if (c.hasError && c.errorMessage && c.retryErrors.length === 0) {
                    const code = parseErrorCode(c.errorMessage);
                    convErrorCodes[code] = (convErrorCodes[code] || 0) + 1;
                }
            }
            if (Object.keys(convErrorCodes).length > 0) {
                retryErrorCodesByConv[conv.cascadeId] = convErrorCodes;
            }

            for (const c of accountFilteredCalls) {
                totalCalls++;
                totalStepsCovered += c.stepIndices.length;
                totalCredits += c.credits;
                totalInput += c.inputTokens;
                totalOutput += c.outputTokens;
                totalCache += c.cacheReadTokens;
                totalCacheCreation += c.cacheCreationTokens;
                totalThinking += c.thinkingTokens;

                // Context growth
                if (c.contextTokensUsed > 0 && c.stepIndices.length > 0) {
                    contextGrowth.push({
                        step: c.stepIndices[0],
                        tokens: c.contextTokensUsed,
                        model: normalizeModelDisplayName(c.modelDisplay || c.model) || c.modelDisplay || c.model,
                    });
                }

                // Per-model aggregation
                const key = normalizeModelDisplayName(c.modelDisplay || c.model) || c.modelDisplay || c.model;
                if (!key) { continue; }

                let agg = modelAgg.get(key);
                if (!agg) {
                    agg = {
                        callCount: 0, stepsCovered: 0,
                        totalInput: 0, totalOutput: 0, totalThinking: 0,
                        totalCache: 0, totalCacheCreation: 0, totalCredits: 0,
                        ttfts: [], streams: [],
                        timedOutputTokens: 0, timedStreamingSeconds: 0,
                        cacheHits: 0,
                        responseModel: c.responseModel,
                        apiProvider: c.apiProvider,
                        completionConfig: c.completionConfig,
                        hasSystemPrompt: false,
                        toolCount: 0,
                        promptSectionTitles: [],
                        totalRetries: 0,
                        errorCount: 0,
                        creditCallCount: 0,
                        exactCallCount: 0,
                        placeholderOnlyCalls: 0,
                        contextWindowCapacity: 0,
                    };
                    modelAgg.set(key, agg);
                }
                agg.callCount++;
                agg.stepsCovered += c.stepIndices.length;
                agg.totalInput += c.inputTokens;
                agg.totalOutput += c.outputTokens;
                agg.totalThinking += c.thinkingTokens;
                agg.totalCache += c.cacheReadTokens;
                agg.totalCacheCreation += c.cacheCreationTokens;
                agg.totalCredits += c.credits;
                if (c.credits > 0) { agg.creditCallCount++; }
                if (c.ttftSeconds > 0) { agg.ttfts.push(c.ttftSeconds); }
                if (c.streamingSeconds > 0) { agg.streams.push(c.streamingSeconds); }
                if (c.streamingSeconds >= MIN_STREAM_SECONDS && c.outputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
                    agg.timedOutputTokens += c.outputTokens;
                    agg.timedStreamingSeconds += c.streamingSeconds;
                }
                if (c.cacheReadTokens > 0) { agg.cacheHits++; }
                if (c.responseModel) { agg.responseModel = c.responseModel; }
                if (c.apiProvider) { agg.apiProvider = c.apiProvider; }
                if (c.completionConfig) { agg.completionConfig = c.completionConfig; }
                if (c.systemPromptSnippet) { agg.hasSystemPrompt = true; }
                if (c.toolCount > agg.toolCount) { agg.toolCount = c.toolCount; }
                if (c.promptSectionTitles.length > agg.promptSectionTitles.length) {
                    agg.promptSectionTitles = c.promptSectionTitles;
                }
                agg.totalRetries += c.retries;
                if (c.hasError) { agg.errorCount++; }
                if (c.modelAccuracy === 'exact') { agg.exactCallCount++; }
                else { agg.placeholderOnlyCalls++; }
                if (c.contextWindowCapacity > 0) { agg.contextWindowCapacity = c.contextWindowCapacity; }

                // Retry overhead aggregation
                const retryTok = c.retryTokensIn + c.retryTokensOut;
                if (retryTok > 0) {
                    totalRetryTokens += retryTok;
                    totalRetryCredits += c.retryCredits;
                    totalRetryCount++;
                }

                // Stop reason distribution
                if (c.stopReason) {
                    const sr = c.stopReason.replace('STOP_REASON_', '');
                    stopReasonCounts[sr] = (stopReasonCounts[sr] || 0) + 1;
                }
                // Aggregate error codes from retryErrors
                for (const errMsg of c.retryErrors) {
                    const code = parseErrorCode(errMsg);
                    retryErrorCodes[code] = (retryErrorCodes[code] || 0) + 1;
                    if (recentErrors.length < MAX_RECENT_ERRORS) { recentErrors.push(errMsg); }
                }
                // Fallback: use top-level errorMessage only when retryErrors is empty
                // (retryInfos and gm.error often contain the same error text)
                if (c.hasError && c.errorMessage && c.retryErrors.length === 0) {
                    const code = parseErrorCode(c.errorMessage);
                    retryErrorCodes[code] = (retryErrorCodes[code] || 0) + 1;
                    if (recentErrors.length < MAX_RECENT_ERRORS) { recentErrors.push(c.errorMessage); }
                }

                // Keep latest tokenBreakdown snapshot
                if (c.tokenBreakdownGroups.length > 0) {
                    latestTokenBreakdown = c.tokenBreakdownGroups;
                }
            }
        }

        // Sort conversations by step count desc
        conversations.sort((a, b) => b.totalSteps - a.totalSteps);
        contextGrowth.sort((a, b) => a.step - b.step);

        // Build model breakdown
        const modelBreakdown: Record<string, GMModelStats> = {};
        for (const [name, agg] of modelAgg) {
            const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
            const min = (arr: number[]) => arr.length ? Math.min(...arr) : 0;
            const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;
            modelBreakdown[name] = {
                callCount: agg.callCount,
                stepsCovered: agg.stepsCovered,
                totalInputTokens: agg.totalInput,
                totalOutputTokens: agg.totalOutput,
                totalThinkingTokens: agg.totalThinking,
                totalCacheRead: agg.totalCache,
                totalCacheCreation: agg.totalCacheCreation,
                totalCredits: agg.totalCredits,
                avgTTFT: avg(agg.ttfts),
                minTTFT: min(agg.ttfts),
                maxTTFT: max(agg.ttfts),
                avgStreaming: avg(agg.streams),
                cacheHitRate: agg.callCount > 0 ? agg.cacheHits / agg.callCount : 0,
                ttftSampleCount: agg.ttfts.length,
                streamingSampleCount: agg.streams.length,
                timedOutputTokens: agg.timedOutputTokens,
                timedStreamingSeconds: agg.timedStreamingSeconds,
                cacheHitCalls: agg.cacheHits,
                responseModel: agg.responseModel,
                apiProvider: agg.apiProvider,
                completionConfig: agg.completionConfig,
                hasSystemPrompt: agg.hasSystemPrompt,
                toolCount: agg.toolCount,
                promptSectionTitles: agg.promptSectionTitles,
                totalRetries: agg.totalRetries,
                errorCount: agg.errorCount,
                creditCallCount: agg.creditCallCount,
                exactCallCount: agg.exactCallCount,
                placeholderOnlyCalls: agg.placeholderOnlyCalls,
                contextWindowCapacity: agg.contextWindowCapacity,
            };
        }

        const result: GMSummary = {
            conversations,
            modelBreakdown,
            totalCalls,
            totalStepsCovered,
            totalCredits,
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            totalCacheRead: totalCache,
            totalCacheCreation: totalCacheCreation,
            totalThinkingTokens: totalThinking,
            contextGrowth,
            fetchedAt: this._lastFetchedAt,
            totalRetryTokens,
            totalRetryCredits,
            totalRetryCount,
            latestTokenBreakdown,
            stopReasonCounts,
            retryErrorCodes,
            recentErrors,
            toolCallCounts,
            toolCallCountsByConv,
            retryErrorCodesByConv,
        };

        // ── Collect unique error types (cross-account, like tool ranking) ──
        // Iterates ALL calls from ALL accounts (no account filter) so the error
        // catalog shows every error kind encountered, regardless of which account
        // triggered it. Uses conversations[] which contain activeCalls (post-archival).
        // Key = normalizeErrorMessage(msg) to group semantically identical errors
        // (e.g. same 429 with different reset wait times) while keeping distinct
        // messages (different TCP endpoints, different file paths) separate.
        const uniqueErrorMap = new Map<string, UniqueErrorEntry>();
        for (const conv of conversations) {
            for (const c of conv.calls) {
                const callTime = c.createdAt || '';
                for (const errMsg of c.retryErrors) {
                    const code = parseErrorCode(errMsg);
                    const normKey = normalizeErrorMessage(errMsg);
                    const existing = uniqueErrorMap.get(normKey);
                    if (!existing || (callTime && callTime < existing.firstSeen)) {
                        uniqueErrorMap.set(normKey, { code, message: normKey, firstSeen: callTime });
                    }
                }
                if (c.hasError && c.errorMessage && c.retryErrors.length === 0) {
                    const code = parseErrorCode(c.errorMessage);
                    const normKey = normalizeErrorMessage(c.errorMessage);
                    const existing = uniqueErrorMap.get(normKey);
                    if (!existing || (callTime && callTime < existing.firstSeen)) {
                        uniqueErrorMap.set(normKey, { code, message: normKey, firstSeen: callTime });
                    }
                }
            }
        }
        result.uniqueErrors = [...uniqueErrorMap.values()].sort((a, b) =>
            a.firstSeen.localeCompare(b.firstSeen),
        );

        // ── Collect recent error entries (current-account only) ──
        // Structured entries with parsed code + timestamp, filtered to current
        // account for consistency with retryErrorCodes totals.
        const allErrorEntries: RecentErrorEntry[] = [];
        for (const conv of conversations) {
            for (const c of conv.calls) {
                if (this._currentAccountEmail && !skipAccountFilter
                    && c.accountEmail && c.accountEmail !== this._currentAccountEmail) {
                    continue;
                }
                const callTime = c.createdAt || '';
                for (const errMsg of c.retryErrors) {
                    allErrorEntries.push({ message: errMsg, code: parseErrorCode(errMsg), createdAt: callTime });
                }
                if (c.hasError && c.errorMessage && c.retryErrors.length === 0) {
                    allErrorEntries.push({ message: c.errorMessage, code: parseErrorCode(c.errorMessage), createdAt: callTime });
                }
            }
        }
        // Recent error entries: newest first, capped at 20
        result.recentErrorEntries = allErrorEntries
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 20);

        // ── Merge tool catalog with persisted data (globally shared across all accounts) ──
        // Tool catalog is a permanent, cross-account inventory — merge ALL per-account
        // buckets so switching accounts never loses previously discovered tools.
        for (const [, acctCatalog] of Object.entries(this._persistedToolCatalogByAccount)) {
            for (const [name, persisted] of Object.entries(acctCatalog)) {
                const fresh = toolCatalogMap.get(name);
                if (!fresh) {
                    toolCatalogMap.set(name, { name, firstSeen: persisted.firstSeen, description: persisted.description });
                } else if (persisted.firstSeen && persisted.firstSeen < fresh.firstSeen) {
                    fresh.firstSeen = persisted.firstSeen;
                    if (persisted.description) { fresh.description = persisted.description; }
                } else if (persisted.description && !fresh.description) {
                    fresh.description = persisted.description;
                }
            }
        }
        result.toolCatalog = [...toolCatalogMap.values()].sort((a, b) =>
            a.firstSeen.localeCompare(b.firstSeen),
        );
        // Write back to a single shared bucket, consolidating all per-account data.
        // Only persist from the primary path (normal poll cycle). The full-summary path
        // (skipAccountFilter=true, used by Cost tab / getFullSummary) must NOT write back,
        // otherwise clearToolCatalog() gets instantly undone by makePanelPayload() calling
        // getFullSummary() which always runs _buildSummary(true).
        if (!skipAccountFilter) {
            const catalogPersist: Record<string, { firstSeen: string; description?: string }> = {};
            for (const entry of result.toolCatalog) {
                catalogPersist[entry.name] = { firstSeen: entry.firstSeen };
                if (entry.description) { catalogPersist[entry.name].description = entry.description; }
            }
            this._persistedToolCatalogByAccount = { '__shared__': catalogPersist };
        }

        // Merge persisted baselines with fresh data (max-wins per tool)
        // This ensures tool counts survive restarts even if the API doesn't
        // return messagePrompts (which contains toolCallsByStep) for all calls.
        for (const [name, count] of Object.entries(this._persistedToolCounts)) {
            if (!result.toolCallCounts[name] || result.toolCallCounts[name] < count) {
                result.toolCallCounts[name] = count;
            }
        }
        if (result.toolCallCountsByConv) {
            for (const [convId, counts] of Object.entries(this._persistedToolCountsByConv)) {
                if (!result.toolCallCountsByConv[convId]) {
                    result.toolCallCountsByConv[convId] = { ...counts };
                } else {
                    for (const [name, count] of Object.entries(counts)) {
                        const existing = result.toolCallCountsByConv[convId][name] || 0;
                        if (count > existing) {
                            result.toolCallCountsByConv[convId][name] = count;
                        }
                    }
                }
            }
        }

        // Update persisted baseline to current merged state
        this._persistedToolCounts = { ...result.toolCallCounts };
        this._persistedToolCountsByConv = JSON.parse(JSON.stringify(result.toolCallCountsByConv || {}));

        // Merge persisted error data — per-account scoped (v1.17.2+)
        // Each account's errors are stored independently, so switching accounts
        // doesn't lose data and returning to an account restores its errors.
        //
        // IMPORTANT: Unlike tool counts (which use ALL calls across accounts and
        // legitimately need max-wins to survive API not returning messagePrompts),
        // error counts are account-filtered — they're already accurate when
        // accountFilteredCalls is populated. Use persisted data ONLY as a fallback
        // when fresh data is zero (API hasn't repopulated calls yet after restart),
        // NOT as an unconditional max-wins inflate. This prevents cross-account
        // error contamination and ensures error totals stay in sync with actual
        // calls — matching the behavior of totalCalls/totalCredits.
        const accountKey = this._currentAccountEmail || '__global__';
        const freshErrorTotal = Object.values(result.retryErrorCodes).reduce((a, b) => a + b, 0);
        if (freshErrorTotal === 0) {
            // API hasn't repopulated — use persisted data as fallback
            const acctCodes = this._persistedRetryErrorCodesByAccount[accountKey] || {};
            for (const [code, count] of Object.entries(acctCodes)) {
                result.retryErrorCodes[code] = count;
            }
            // Also restore per-conv error codes from persisted retryErrorCodesByConv
            // (not needed — retryErrorCodesByConv is only used for +x delta display,
            //  which is meaningless when all data comes from persisted fallback)

            // Legacy global persisted data fallback (migration from v1.17.1)
            if (Object.keys(result.retryErrorCodes).length === 0) {
                for (const [code, count] of Object.entries(this._persistedRetryErrorCodes)) {
                    result.retryErrorCodes[code] = count;
                }
            }
        }
        // Persisted recent errors: use fresh data when available, persisted as fallback
        const acctRecentErrors = this._persistedRecentErrorsByAccount[accountKey] || [];
        if (result.recentErrors.length === 0 && acctRecentErrors.length > 0) {
            result.recentErrors = [...acctRecentErrors];
        } else if (result.recentErrors.length === 0 && this._persistedRecentErrors.length > 0) {
            // Legacy fallback
            result.recentErrors = [...this._persistedRecentErrors];
        }

        // Update per-account persisted baselines (only when we have fresh data)
        if (freshErrorTotal > 0) {
            // Fresh data exists — persist directly (no inflation)
            this._persistedRetryErrorCodesByAccount[accountKey] = { ...result.retryErrorCodes };
        }
        if (result.recentErrors.length > 0) {
            this._persistedRecentErrorsByAccount[accountKey] = [...result.recentErrors];
        }
        // Clear legacy global fields — migrated to per-account
        this._persistedRetryErrorCodes = {};
        this._persistedRecentErrors = [];

        // ── Merge persisted unique errors (globally shared across all accounts) ──
        // Unique error catalog is a permanent, cross-account inventory — merge ALL
        // per-account buckets so switching accounts never loses error history.
        // Migration: re-key ALL persisted entries through normalizeErrorMessage()
        // to collapse old errorCode-keyed entries into the new format.
        const mergedUniqueErrors: Record<string, { message: string; firstSeen: string }> = {};
        for (const [, acctUE] of Object.entries(this._persistedUniqueErrorsByAccount)) {
            for (const [, value] of Object.entries(acctUE)) {
                if (!value.message) { continue; } // skip corrupt entries
                const normKey = normalizeErrorMessage(value.message);
                const existing = mergedUniqueErrors[normKey];
                if (!existing || (value.firstSeen && value.firstSeen < existing.firstSeen)) {
                    mergedUniqueErrors[normKey] = { message: normKey, firstSeen: value.firstSeen };
                }
            }
        }
        if (result.uniqueErrors && result.uniqueErrors.length > 0) {
            // Merge fresh unique errors with persisted: keep earliest firstSeen per normalized message
            for (const entry of result.uniqueErrors) {
                const normKey = normalizeErrorMessage(entry.message);
                const persisted = mergedUniqueErrors[normKey];
                if (!persisted || (entry.firstSeen && entry.firstSeen < persisted.firstSeen)) {
                    mergedUniqueErrors[normKey] = { message: normKey, firstSeen: entry.firstSeen };
                }
            }
        }
        // Rebuild uniqueErrors from merged state (re-parse code from message)
        // Apply deduplicateApiErrorText() to clean persisted messages that were saved
        // before the parser cleanup was added (old "MSG: MSG" duplicates).
        if (Object.keys(mergedUniqueErrors).length > 0) {
            const cleanedUniqueErrors: Record<string, { message: string; firstSeen: string }> = {};
            for (const [, { message, firstSeen }] of Object.entries(mergedUniqueErrors)) {
                const cleaned = deduplicateApiErrorText(message);
                const normKey = normalizeErrorMessage(cleaned);
                const existing = cleanedUniqueErrors[normKey];
                if (!existing || (firstSeen && firstSeen < existing.firstSeen)) {
                    cleanedUniqueErrors[normKey] = { message: cleaned, firstSeen };
                }
            }
            result.uniqueErrors = Object.entries(cleanedUniqueErrors)
                .map(([, { message, firstSeen }]) => ({ code: parseErrorCode(message), message, firstSeen }))
                .sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
            // Persist back to a single shared bucket, consolidating all per-account data
            this._persistedUniqueErrorsByAccount = { '__shared__': cleanedUniqueErrors };
        }

        return result;
    }

    /** Authoritative observations can fill metadata/price gaps in already-recorded calls. */
    getLedgerReconciliationEntries(): LedgerCallEntry[] {
        const entries: LedgerCallEntry[] = [];
        for (const [id, conversation] of this._cache) {
            conversation.calls.forEach((call, index) => {
                entries.push({
                    call,
                    dedupKey: ledgerDedupKey(id, call),
                    cascadeId: id,
                    callIndex: index,
                });
            });
        }
        return entries;
    }

    private _isCallAcknowledged(conversationId: string, identity: string): boolean {
        const acked = this._ledgerAcknowledgedIds.get(conversationId);
        if (!acked || acked.size === 0) { return false; }
        if (acked.has(identity)) { return true; }
        for (const prev of acked) {
            if (sameLedgerCallIdentity(prev, identity)) {
                return true;
            }
        }
        return false;
    }

    private _recordAcknowledgedIdentity(conversationId: string, identity: string): void {
        if (!identity) { return; }
        let acked = this._ledgerAcknowledgedIds.get(conversationId);
        if (!acked) {
            acked = new Set<string>();
            this._ledgerAcknowledgedIds.set(conversationId, acked);
        }
        acked.add(identity);
    }

    /**
     * Extract GM calls that have not yet been recorded by the DailyLedger.
     * Compares each conversation's call count against the last recorded position.
     * Only returns calls from the current cycle (after baseline), allowing late
     * cross-midnight calls within the bounded 48h window to route into their true
     * local date bucket without rescanning first-start baselined calls.
     * Call this after fetchAll() in the polling loop.
     */
    getNewCallsSinceLastRecord(): { entries: LedgerCallEntry[]; debug: string[]; revertedCascadeIds: string[] } {
        const entries: LedgerCallEntry[] = [];
        const debug: string[] = [];
        const revertedSet = new Set<string>(this._pendingRevertedCascadeIds);
        this._pendingRevertedCascadeIds.clear();

        const nowMs = Date.now();
        const todayKey = toLocalDateKey(new Date(nowMs));
        const dayStartMs = dateKeyToStartOfDayMs(todayKey);
        const minEligibleMs = dayStartMs > 0
            ? Math.min(dayStartMs, nowMs - LATE_CROSS_MIDNIGHT_WINDOW_MS)
            : 0;

        for (const [id, conv] of this._cache) {
            let baseline = this._callBaselines.get(id) || 0;
            let lastRecorded = this._ledgerPositions.get(id) || 0;
            let knownIdentities = this._ledgerCallIdentities.get(id) || [];

            // Compare stable fingerprints across the recorded/baselined prefix `0..limit-1`
            // so equal-length or longer branch rewinds are detected and never skipped.
            const prefixEnd = Math.min(Math.max(baseline, lastRecorded), conv.calls.length, knownIdentities.length);
            let divergedAt = -1;
            for (let i = 0; i < prefixEnd; i++) {
                const expectedIdentity = knownIdentities[i];
                if (!expectedIdentity) { continue; }
                const actualIdentity = ledgerCallIdentity(conv.calls[i]);
                if (!sameLedgerCallIdentity(expectedIdentity, actualIdentity)) {
                    divergedAt = i;
                    break;
                }
            }

            if (divergedAt >= 0) {
                debug.push(`${id.substring(0, 8)}: BRANCH REWIND pos=${lastRecorded} → ${divergedAt} (len=${conv.calls.length})`);
                lastRecorded = divergedAt;
                this._ledgerPositions.set(id, divergedAt);
                if (baseline > divergedAt) {
                    baseline = divergedAt;
                    this._callBaselines.set(id, divergedAt);
                }
                knownIdentities = knownIdentities.slice(0, divergedAt);
                this._ledgerCallIdentities.set(id, knownIdentities);
                // Rebuild acknowledged set strictly from the surviving prefix
                const surviving = new Set<string>();
                for (const ident of knownIdentities) {
                    if (ident) { surviving.add(ident); }
                }
                if (surviving.size > 0) {
                    this._ledgerAcknowledgedIds.set(id, surviving);
                } else {
                    this._ledgerAcknowledgedIds.delete(id);
                }
                revertedSet.add(id);
            } else if (lastRecorded > conv.calls.length) {
                // Conversation revert: user went back to an earlier step, shrinking
                // the calls array. Clamp position down so new calls from the
                // reverted point onwards get captured. Signal caller to clear
                // stale dedup IDs for this conversation, while preserving
                // knownIdentities so unchanged calls returning later are not double-counted.
                debug.push(`${id.substring(0, 8)}: REVERT pos=${lastRecorded} → ${conv.calls.length}`);
                lastRecorded = conv.calls.length;
                this._ledgerPositions.set(id, lastRecorded);
                if (baseline > conv.calls.length) {
                    baseline = conv.calls.length;
                    this._callBaselines.set(id, baseline);
                }
                revertedSet.add(id);
            } else if (lastRecorded > 0 && lastRecorded <= conv.calls.length) {
                this._rememberLedgerCallIdentities(id, conv.calls, lastRecorded);
                knownIdentities = this._ledgerCallIdentities.get(id) || knownIdentities;
            }

            if (conv.calls.length === 0) { continue; }
            // Start from whichever is higher: baseline or last recorded position
            let start = Math.max(baseline, lastRecorded);
            const originalStart = start;
            while (start < conv.calls.length
                && knownIdentities[start]
                && sameLedgerCallIdentity(knownIdentities[start], ledgerCallIdentity(conv.calls[start]))) {
                start++;
            }
            if (start > originalStart) {
                debug.push(`${id.substring(0, 8)}: skipped ${start - originalStart} unchanged returned calls`);
                const existingPosition = this._ledgerPositions.get(id) || 0;
                if (start > existingPosition) {
                    this._ledgerPositions.set(id, start);
                }
            }
            const delta = conv.calls.length - start;
            if (delta > 0) {
                debug.push(`${id.substring(0, 8)}: bl=${baseline} pos=${lastRecorded} len=${conv.calls.length} → +${delta}`);
            }

            for (let i = start; i < conv.calls.length; i++) {
                const call = conv.calls[i];
                // Bounded cross-midnight window: allow late calls within the last 48h to reach
                // DailyLedger's true local date bucket while excluding ancient multi-day history.
                if (minEligibleMs > 0 && call.createdAt) {
                    const callMs = Date.parse(call.createdAt);
                    if (!isNaN(callMs) && callMs < minEligibleMs) {
                        continue;
                    }
                }
                const identity = ledgerCallIdentity(call);
                if (this._isCallAcknowledged(id, identity)) {
                    continue;
                }
                entries.push({
                    call,
                    dedupKey: ledgerDedupKey(id, call),
                    cascadeId: id,
                    callIndex: i,
                });
            }
        }
        return { entries, debug, revertedCascadeIds: [...revertedSet] };
    }

    private _rememberLedgerCallIdentities(conversationId: string, calls: GMCallEntry[], submittedCount: number): void {
        const limit = Math.min(submittedCount, calls.length);
        if (limit <= 0) { return; }
        const identities = this._ledgerCallIdentities.get(conversationId) || [];
        let changed = false;
        for (let i = 0; i < limit; i++) {
            if (identities[i]) { continue; }
            const ident = ledgerCallIdentity(calls[i]);
            identities[i] = ident;
            this._recordAcknowledgedIdentity(conversationId, ident);
            changed = true;
        }
        if (changed) {
            this._ledgerCallIdentities.set(conversationId, identities);
        }
    }

    /**
     * Commit DailyLedger positions after recordCalls/recordCallsDetailed accepted a batch.
     * Advances each conversation's cursor strictly along contiguously persisted calls
     * (never jumping past a retryable/unpersisted gap), while remembering acknowledged
     * durable logical identities so out-of-order persisted calls are not re-emitted.
     */
    markLedgerEntriesRecorded(
        entries: LedgerCallEntry[],
        statuses?: readonly RecordCallStatus[],
    ): void {
        const ackedIndicesByConversation = new Map<string, Set<number>>();
        const touchedConversations = new Set<string>();

        for (let i = 0; i < entries.length; i++) {
            if (statuses && i < statuses.length && statuses[i] === 'retryable') {
                continue;
            }
            const entry = entries[i];
            const parsedLegacy = parseLedgerDedupPosition(entry.dedupKey);
            const conversationId = entry.cascadeId
                || parsedLegacy?.conversationId
                || parseLedgerDedupConversation(entry.dedupKey);
            if (!conversationId) { continue; }

            const identity = ledgerCallIdentity(entry.call);
            this._recordAcknowledgedIdentity(conversationId, identity);
            touchedConversations.add(conversationId);

            let resolvedIndex: number | undefined = typeof entry.callIndex === 'number' && Number.isInteger(entry.callIndex) && entry.callIndex >= 0
                ? entry.callIndex
                : parsedLegacy?.index;

            if (resolvedIndex === undefined) {
                const cachedConv = this._cache.get(conversationId);
                if (cachedConv) {
                    const cursorFloor = Math.max(
                        this._callBaselines.get(conversationId) || 0,
                        this._ledgerPositions.get(conversationId) || 0,
                    );
                    for (let idx = cursorFloor; idx < cachedConv.calls.length; idx++) {
                        if (sameLedgerCallIdentity(identity, ledgerCallIdentity(cachedConv.calls[idx]))) {
                            resolvedIndex = idx;
                            break;
                        }
                    }
                    if (resolvedIndex === undefined) {
                        for (let idx = 0; idx < cursorFloor && idx < cachedConv.calls.length; idx++) {
                            if (sameLedgerCallIdentity(identity, ledgerCallIdentity(cachedConv.calls[idx]))) {
                                resolvedIndex = idx;
                                break;
                            }
                        }
                    }
                }
            }

            if (resolvedIndex !== undefined) {
                const identities = this._ledgerCallIdentities.get(conversationId) || [];
                identities[resolvedIndex] = identity;
                this._ledgerCallIdentities.set(conversationId, identities);
                let set = ackedIndicesByConversation.get(conversationId);
                if (!set) {
                    set = new Set<number>();
                    ackedIndicesByConversation.set(conversationId, set);
                }
                set.add(resolvedIndex);
            }
        }

        const nowMs = Date.now();
        const todayKey = toLocalDateKey(new Date(nowMs));
        const dayStartMs = dateKeyToStartOfDayMs(todayKey);
        const minEligibleMs = dayStartMs > 0
            ? Math.min(dayStartMs, nowMs - LATE_CROSS_MIDNIGHT_WINDOW_MS)
            : 0;

        for (const conversationId of touchedConversations) {
            const baseline = this._callBaselines.get(conversationId) || 0;
            const existingPos = this._ledgerPositions.get(conversationId) || 0;
            const ackedIndices = ackedIndicesByConversation.get(conversationId) || new Set<number>();
            const cachedConv = this._cache.get(conversationId);
            const maxAckedIndex = ackedIndices.size > 0 ? Math.max(...ackedIndices) : -1;

            let cursor = Math.max(baseline, existingPos);
            while (true) {
                if (ackedIndices.has(cursor)) {
                    cursor++;
                    continue;
                }
                if (cachedConv && cursor < cachedConv.calls.length) {
                    const call = cachedConv.calls[cursor];
                    const ident = ledgerCallIdentity(call);
                    if (this._isCallAcknowledged(conversationId, ident)) {
                        const identities = this._ledgerCallIdentities.get(conversationId) || [];
                        if (!identities[cursor]) {
                            identities[cursor] = ident;
                            this._ledgerCallIdentities.set(conversationId, identities);
                        }
                        cursor++;
                        continue;
                    }
                    // Only step past an unacknowledged slot if it is permanently outside the 48h window
                    // AND a later call in the same conversation was already acknowledged.
                    if (cursor < maxAckedIndex && minEligibleMs > 0 && call.createdAt) {
                        const callMs = Date.parse(call.createdAt);
                        if (!isNaN(callMs) && callMs < minEligibleMs) {
                            cursor++;
                            continue;
                        }
                    }
                }
                break;
            }

            if (cursor > existingPos) {
                this._ledgerPositions.set(conversationId, cursor);
            }
        }
    }

    /**
     * Quota-cycle baseline: mark calls from the target account's reset pool as archived
     * so _buildSummary() excludes them. The new cycle starts with zero counts.
     * Calls remain in cache — midnight's performDailyArchival() will sweep them.
     *
     * @param targetEmail  Optional — baselines calls for this account.
     *                     Defaults to _currentAccountEmail (active account).
     * @param poolModelFilter  Optional — model names (display labels or IDs) to filter by.
     *                         Only calls matching these models are archived.
     *                         If omitted, ALL models for the account are archived.
     * @returns number of calls baselined
     */
    baselineForQuotaReset(targetEmail?: string, poolModelFilter?: string[], cutoffTime?: string): number {
        const email = targetEmail || this._currentAccountEmail;
        const cutoff = cutoffTime || new Date().toISOString();
        const cutoffMs = Date.parse(cutoff);

        // Build a set of model IDs for pool matching.
        // poolModelFilter can contain model IDs ("MODEL_PLACEHOLDER_M26")
        // or display labels ("Claude Opus 4.6 (Thinking)" / "Claude Opus 4.6 (思考)").
        // Resolve everything to model IDs for stable, language-independent matching.
        const poolModelIds = poolModelFilter && poolModelFilter.length > 0
            ? new Set(poolModelFilter.map(m => resolveModelId(m) || m))
            : null; // null = all models

        // Helper: check if a call belongs to the target pool (by model ID or label fuzzy fallback)
        const callMatchesPool = (call: GMCallEntry): boolean => {
            if (!poolModelIds) { return true; }
            
            // 1. Direct Model ID match (Highest priority & 100% precise)
            if (poolModelIds.has(call.model) || (call.responseModel && poolModelIds.has(call.responseModel))) {
                return true;
            }
            
            // 2. Display Name fuzzy fallback (Backward compatibility for legacy snapshots or translation mismatches)
            const callDisplay = normalizeModelDisplayName(call.modelDisplay || call.model) || call.responseModel || call.model;
            const callDisplayLower = callDisplay.toLowerCase();
            
            for (const item of poolModelFilter || []) {
                const itemLower = item.toLowerCase();
                if (call.model.toLowerCase() === itemLower) {
                    return true;
                }
                // Compare DISPLAY LABELS, never raw IDs. Two reasons:
                //  - it bridges a platform renumber: an archived call can carry the retired M264 while
                //    the pool is expressed with the live M71, and only their shared label matches;
                //  - M-numbers are plain decimal and therefore prefix-collide, so substring-matching
                //    raw IDs would put 'model_placeholder_m187' in M18's pool and 'm298' in M29's.
                // normalizeModelDisplayName() returns the input unchanged when it resolves nothing,
                // so anything still ID-shaped after normalization is skipped rather than guessed at.
                const itemLabel = (normalizeModelDisplayName(item) || item).toLowerCase();
                if (isRawModelId(itemLabel) || isRawModelId(callDisplayLower)) {
                    continue;
                }
                if (callDisplayLower.includes(itemLabel) || itemLabel.includes(callDisplayLower)) {
                    return true;
                }
            }
            return false;
        };

        const shouldArchiveByCutoff = (call: GMCallEntry): boolean => {
            if (isNaN(cutoffMs)) { return true; }
            const callMs = Date.parse(call.createdAt || '');
            if (isNaN(callMs)) { return false; }
            return callMs <= cutoffMs;
        };

        // ── Step 1: Compute accurate stats from _lastSummary (full picture) ──
        const summary = this._lastSummary;
        let summaryCount = 0;
        const archivedModelIds = new Set<string>();

        if (summary) {
            for (const conv of summary.conversations) {
                for (const call of conv.calls) {
                    if (email && call.accountEmail && call.accountEmail !== email) { continue; }
                    if (!call.accountEmail && email) { continue; }
                    if (!callMatchesPool(call)) { continue; }
                    if (!shouldArchiveByCutoff(call)) { continue; }
                    summaryCount++;
                    archivedModelIds.add(call.model); // model ID, not display name
                }
            }
        }

        // ── Step 2: Set per-account+model cutoffs to Cutoff ──
        // Key = "email|MODEL_ID" (language-independent, stable)
        for (const modelId of archivedModelIds) {
            const amKey = `${email}|${modelId}`;
            this._archivedAccountModelCutoffs.set(amKey, cutoff);
        }
        // Also set cutoffs for all pool model IDs (belt and suspenders)
        if (poolModelIds && email) {
            for (const mid of poolModelIds) {
                const amKey = `${email}|${mid}`;
                if (!this._archivedAccountModelCutoffs.has(amKey)) {
                    this._archivedAccountModelCutoffs.set(amKey, cutoff);
                }
            }
        }

        // ── Step 3: Also mark individual calls in _archivedCallIds (from _cache) ──
        let cacheCount = 0;

        const todayKey = toLocalDateKey();
        const dayStartMs = dateKeyToStartOfDayMs(todayKey);

        for (const [, conv] of this._cache) {
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const activeCalls = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;
            for (const call of activeCalls) {
                if (email && call.accountEmail && call.accountEmail !== email) { continue; }
                if (!callMatchesPool(call)) { continue; }
                if (!shouldArchiveByCutoff(call)) { continue; }
                
                // Prevent history data pollution
                if (dayStartMs > 0 && call.createdAt) {
                    const callMs = Date.parse(call.createdAt);
                    if (!isNaN(callMs) && callMs < dayStartMs) {
                        continue;
                    }
                }

                const archKey = buildGMArchiveKey(call);
                if (this._archivedCallIds.has(call.executionId) || this._archivedCallIds.has(archKey)) { continue; }
                if (call.executionId) { this._archivedCallIds.add(call.executionId); }
                this._archivedCallIds.add(archKey);
                if (email && call.model) {
                    this._exactArchivedAccountModels.add(`${email}|${call.model}`);
                }
                cacheCount++;
                archivedModelIds.add(call.model); // also capture from cache path
            }
        }

        // ── Step 4: Use the more accurate of summary vs cache stats ──
        const useSummary = summaryCount >= cacheCount;
        const finalCount = useSummary ? summaryCount : cacheCount;

        // ── Step 5: Clear persisted error data for the archived account ──
        // Clear ALL persisted error baselines — after archiving calls, the max-wins
        // merge must recalculate from actual remaining calls instead of restoring
        // stale totals that included now-archived data.
        // Note: unique error catalog and tool catalog are permanent — NOT cleared here.
        this._persistedRetryErrorCodesByAccount = {};
        this._persistedRecentErrorsByAccount = {};
        this._persistedRetryErrorCodes = {};
        this._persistedRecentErrors = [];

        // Rebuild _lastSummary from remaining active calls.
        // CRITICAL: do NOT null this — if extension restarts before next fetchAll,
        // the persisted snapshot would be null, and getArchivalSummary() would
        // fall back to empty cache → DailyStore gets totalCalls=0 (data loss).
        this._lastSummary = this._buildSummary(true, true);
        return finalCount;
    }

    /**
     * Check if a pool has already been archived for a given account.
     * Returns true ONLY if cutoff entries exist AND there are NO un-archived
     * calls for this account+pool. This prevents stale cutoffs from a
     * previous quota cycle from blocking new archival.
     */
    isPoolArchived(email: string, modelLabels: string[]): boolean {
        this._purgeUnusableArchiveCutoffs();
        if (this._archivedAccountModelCutoffs.size === 0) { return false; }

        // Supports both model ID and model label matching. Keep the ORIGINAL casing alongside the
        // lower-cased set: resolveModelId — and therefore normalizeModelDisplayName — is
        // case-sensitive, so normalizing an already-lower-cased identifier resolves nothing and the
        // renumber bridge below would silently be dead code.
        const filterSet = new Set(modelLabels.map(l => l.toLowerCase()));
        const filterLabels = modelLabels.map(l => (normalizeModelDisplayName(l) || l).toLowerCase());

        const hasCutoff = [...this._archivedAccountModelCutoffs.keys()].some(key => {
            if (!key.startsWith(`${email}|`)) { return false; }
            const cutoff = this._archivedAccountModelCutoffs.get(key);
            if (!cutoff || !isUsableArchiveCutoff(cutoff)) { return false; }
            const archivedModelRaw = key.substring(email.length + 1);
            const archivedModel = archivedModelRaw.toLowerCase();

            // Direct model ID match
            if (filterSet.has(archivedModel)) { return true; }

            // Display label fuzzy match — labels only, never raw IDs (see isRawModelId), and both
            // sides normalized BEFORE lower-casing so a retired placeholder still matches its
            // renumbered replacement through their shared label.
            const archivedDisplay = (normalizeModelDisplayName(archivedModelRaw) || archivedModelRaw).toLowerCase();
            if (isRawModelId(archivedDisplay)) { return false; }
            return filterLabels.some(itemLabel =>
                !isRawModelId(itemLabel)
                && (archivedDisplay.includes(itemLabel) || itemLabel.includes(archivedDisplay)),
            );
        });
        if (!hasCutoff) { return false; }

        // Check if there are any un-archived calls for this account+pool
        const resolvedFilterIds = new Set(modelLabels.map(l => resolveModelId(l) || l));
        
        for (const [, conv] of this._cache) {
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const activeCalls = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;
            for (const call of activeCalls) {
                if (call.accountEmail && call.accountEmail !== email) { continue; }
                if (!call.accountEmail && email) { continue; }
                
                // Check if call belongs to this pool (with display name fallback)
                let matchesPool = resolvedFilterIds.has(call.model)
                    || (call.responseModel && resolvedFilterIds.has(call.responseModel));
                if (!matchesPool) {
                    const callDisplay = normalizeModelDisplayName(call.modelDisplay || call.model) || call.responseModel || call.model;
                    const callDisplayLower = callDisplay.toLowerCase();
                    // Labels only, never raw IDs (see isRawModelId), both sides normalized so a
                    // retired placeholder still matches its renumbered replacement. Treating an
                    // unresolved raw ID as fuzzy-matchable would let one model be counted as archived
                    // under another's pool, zeroing today's running total for a model still in use.
                    // filterLabels is normalized from the ORIGINAL casing — normalizing an
                    // already-lower-cased identifier resolves nothing (resolveModelId is
                    // case-sensitive) and the bridge would be dead code.
                    matchesPool = !isRawModelId(callDisplayLower) && filterLabels.some(itemLabel =>
                        !isRawModelId(itemLabel)
                        && (callDisplayLower.includes(itemLabel) || itemLabel.includes(callDisplayLower)),
                    );
                }
                if (!matchesPool) { continue; }
                
                // Check if this call is already archived
                const archKey = buildGMArchiveKey(call);
                if (!this._archivedCallIds.has(call.executionId) && !this._archivedCallIds.has(archKey)) {
                    return false; // Found an un-archived call → pool NOT fully archived
                }
            }
        }
        return true; // All calls are archived (or no calls exist)
    }

    reset(): void {
        // Record call baselines: for conversations that were fetched from API
        // (calls.length > 0), set baseline to their absolute call count.
        // Stubs (calls=[]) keep their existing baseline from previous reset.
        for (const [, conv] of this._cache) {
            if (conv.calls.length > 0) {
                this._callBaselines.set(conv.cascadeId, conv.calls.length);
            }
        }
        // Keep cache entries with stepCount so fetchAll() skips unchanged IDLE
        // conversations, but clear calls to save memory.
        for (const [id, conv] of this._cache) {
            this._cache.set(id, {
                ...conv,
                calls: [],
                lifetimeCalls: conv.lifetimeCalls ?? conv.calls.length,
                coveredSteps: 0,
                coverageRate: 0,
                checkpointSummaries: conv.checkpointSummaries || [],
            });
        }
        this._archivedCallIds.clear();
        this._archivedModelCutoffs.clear();
        this._archivedAccountModelCutoffs.clear();
        this._exactArchivedAccountModels.clear();
        this._callAccountMap.clear();
        this._ledgerPositions.clear();
        this._ledgerCallIdentities.clear();
        this._ledgerAcknowledgedIds.clear();
        this._pendingRevertedCascadeIds.clear();
        this._persistedToolCounts = {};
        this._persistedToolCountsByConv = {};
        this._persistedRecentErrors = [];
        this._persistedRetryErrorCodes = {};
        this._persistedRetryErrorCodesByAccount = {};
        this._persistedRecentErrorsByAccount = {};
        // Note: _persistedUniqueErrorsByAccount is NOT cleared here — unique error
        // catalog is permanent, recording all error kinds ever encountered (never reset).
        // Note: _persistedToolCatalogByAccount is NOT cleared here — tool catalog
        // is permanent and accumulates across all days (never reset).
        this._lastSummary = null;
        this._lastFetchedAt = '';
        this._settledIdle.clear();
        this._enrichedSnapshots.clear();
        this._errorBackoffByCascade.clear();
    }

    /**
     * Nuclear reset — clears all internal state and starts counting from zero.
     * Next fetchAll() will baseline all existing API data, so only truly new
     * calls (made after this reset) are counted.
     */
    fullReset(): void {
        this._cache.clear();
        this._callBaselines.clear();
        this._pendingStartupBaselines.clear();
        this._archivedCallIds.clear();
        this._archivedModelCutoffs.clear();
        this._archivedAccountModelCutoffs.clear();
        this._exactArchivedAccountModels.clear();
        this._callAccountMap.clear();
        this._ledgerPositions.clear();
        this._ledgerCallIdentities.clear();
        this._ledgerAcknowledgedIds.clear();
        this._pendingRevertedCascadeIds.clear();
        this._persistedToolCounts = {};
        this._persistedToolCountsByConv = {};
        this._persistedRecentErrors = [];
        this._persistedRetryErrorCodes = {};
        this._persistedRetryErrorCodesByAccount = {};
        this._persistedRecentErrorsByAccount = {};
        this._persistedUniqueErrorsByAccount = {};
        this._persistedToolCatalogByAccount = {};
        this._lastSummary = null;
        this._lastFetchedAt = '';
        this._lastRunningStatus.clear();
        this._settledIdle.clear();
        this._enrichedSnapshots.clear();
        this._errorBackoffByCascade.clear();
        this._needsBaselineInit = true;
    }

    /**
     * Clear only the tool catalog — removes all persisted tool inventory entries.
     * Does NOT affect tool call counts (ranking) or any other tracking data.
     * Use this to clean up stale tools that are no longer in use.
     */
    clearToolCatalog(): void {
        this._persistedToolCatalogByAccount = {};
        // Patch the cached summary's toolCatalog to empty instead of nulling _lastSummary.
        // Nulling would force serialize() → _buildSummary() → repopulate from cached calls,
        // instantly undoing the clear. Patching preserves the summary for serialize()
        // while showing an empty catalog immediately. The next poll cycle's _buildSummary()
        // will rebuild from active calls only (persisted is now empty, so historical tools
        // that are no longer in the cache won't come back).
        if (this._lastSummary) {
            this._lastSummary = { ...this._lastSummary, toolCatalog: [] };
        }
    }

    /**
     * One-time repair path for persisted detailed summaries that still contain
     * calls from quota cycles already archived by the quota tracker.
     */
    repairSummaryFromQuotaHistory(
        detailedSummary: GMSummary | null | undefined,
        history: QuotaSession[],
        configs: ModelConfig[],
    ): GMSummary | null {
        if (!detailedSummary || history.length === 0) {
            return detailedSummary || null;
        }

        const labelToModelId = new Map<string, string>();
        for (const config of configs) {
            labelToModelId.set(config.label, config.model);
        }

        const contaminatedCutoffByModelId = new Map<string, number>();
        for (const session of history) {
            if (!session.endTime || !session.poolModels || session.poolModels.length === 0) { continue; }
            const endMs = Date.parse(session.endTime);
            if (Number.isNaN(endMs)) { continue; }
            const config = configs.find(item => item.model === session.modelId);
            const actualPoolKey = getQuotaPoolKey(session.modelId, config?.quotaInfo?.resetTime);
            const actualPoolModelIds = new Set(
                configs
                    .filter(item => getQuotaPoolKey(item.model, item.quotaInfo?.resetTime) === actualPoolKey)
                    .map(item => item.model),
            );

            for (const label of session.poolModels) {
                const modelId = labelToModelId.get(label);
                if (!modelId || actualPoolModelIds.has(modelId)) { continue; }
                const prev = contaminatedCutoffByModelId.get(modelId) || 0;
                if (endMs > prev) {
                    contaminatedCutoffByModelId.set(modelId, endMs);
                }
            }
        }
        if (contaminatedCutoffByModelId.size === 0) {
            return detailedSummary;
        }

        const removedIds = new Set<string>();
        const keptConversations: GMConversationData[] = [];
        for (const conversation of detailedSummary.conversations) {
            const keptCalls = conversation.calls.filter(call => {
                const poolEndMs = contaminatedCutoffByModelId.get(call.model) || 0;
                const createdMs = Date.parse(call.createdAt || '');
                const shouldArchive = poolEndMs > 0 && !Number.isNaN(createdMs) && createdMs <= poolEndMs;
                if (shouldArchive && call.executionId) {
                    removedIds.add(call.executionId);
                }
                if (shouldArchive) {
                    removedIds.add(buildGMArchiveKey(call));
                }
                return !shouldArchive;
            });
            if (keptCalls.length > 0) {
                keptConversations.push({
                    ...conversation,
                    calls: keptCalls,
                });
            }
        }

        if (removedIds.size === 0) {
            return detailedSummary;
        }

        for (const id of removedIds) {
            this._archivedCallIds.add(id);
        }

        const rebuilt = buildSummaryFromConversations(keptConversations, detailedSummary.fetchedAt);
        this._lastSummary = rebuilt ? normalizeGMSummary(rebuilt) : null;
        return rebuilt;
    }

    // ─── Serialization ───────────────────────────────────────────────────

    /**
     * Return the last computed summary without re-computing.
     * Used on startup to instantly display persisted data.
     */
    getCachedSummary(): GMSummary | null {
        if (!this._lastSummary) { return null; }
        this._lastSummary = normalizeGMSummary(this._lastSummary);
        return this._lastSummary;
    }

    /** Full current-cycle summary for UI persistence (retains per-call data). */
    getDetailedSummary(): GMSummary | null {
        // _lastSummary holds the full cross-account snapshot; rebuild if null.
        const summary = normalizeGMSummary(this._lastSummary || this._buildSummary(true, true));
        if (!summary) { return null; }
        this._lastSummary = summary;
        return {
            ...summary,
            conversations: summary.conversations.map(cloneConversationData),
            contextGrowth: summary.contextGrowth.map(point => ({ ...point })),
            latestTokenBreakdown: cloneTokenBreakdownGroups(summary.latestTokenBreakdown),
            modelBreakdown: Object.fromEntries(
                Object.entries(summary.modelBreakdown).map(([name, stats]) => [name, { ...stats }]),
            ),
            stopReasonCounts: { ...summary.stopReasonCounts },
            retryErrorCodes: { ...(summary.retryErrorCodes || {}) },
            recentErrors: [...(summary.recentErrors || [])],
        };
    }

    /**
     * Full summary with ALL accounts' calls included in totals (no account filtering).
     * Used by DailyStore archival to ensure cross-account data is preserved in calendar.
     * Unlike getDetailedSummary(), this always rebuilds from cache (not cached).
     */
    getFullSummary(): GMSummary | null {
        // After restore (before first fetchAll), calls[] is empty — use persisted snapshot
        if (!this._hasFetchedCalls && this._lastSummary) {
            return normalizeGMSummary(this._lastSummary);
        }
        const summary = normalizeGMSummary(this._buildSummary(true));
        if (!summary) { return null; }
        return {
            ...summary,
            conversations: summary.conversations.map(cloneConversationData),
            contextGrowth: summary.contextGrowth.map(point => ({ ...point })),
            latestTokenBreakdown: cloneTokenBreakdownGroups(summary.latestTokenBreakdown),
            modelBreakdown: Object.fromEntries(
                Object.entries(summary.modelBreakdown).map(([name, stats]) => [name, { ...stats }]),
            ),
            stopReasonCounts: { ...summary.stopReasonCounts },
            retryErrorCodes: { ...(summary.retryErrorCodes || {}) },
            recentErrors: [...(summary.recentErrors || [])],
        };
    }

    /** Full cross-account summary for UI tabs only. Never replays persisted snapshots as live data. */
    getUiFullSummary(): GMSummary | null {
        if (!this._hasFetchedCalls) { return null; }
        return this.getFullSummary();
    }

    /**
     * Full summary for midnight archival — includes ALL calls from this cycle:
     * both "pending archive" (already baselined by quota resets) and still-active calls.
     * Skips both account filtering and archival filtering so DailyStore receives
     * the true complete picture of the day's usage.
     */
    getArchivalSummary(): GMSummary | null {
        // After restore (before first fetchAll), calls[] is empty — use persisted snapshot
        // to avoid archiving totalCalls=0 which would lose the day's data.
        if (!this._hasFetchedCalls && this._lastSummary) {
            return normalizeGMSummary(this._lastSummary);
        }
        const summary = normalizeGMSummary(this._buildSummary(true, true));
        if (!summary) { return null; }
        return {
            ...summary,
            conversations: summary.conversations.map(cloneConversationData),
            contextGrowth: summary.contextGrowth.map(point => ({ ...point })),
            latestTokenBreakdown: cloneTokenBreakdownGroups(summary.latestTokenBreakdown),
            modelBreakdown: Object.fromEntries(
                Object.entries(summary.modelBreakdown).map(([name, stats]) => [name, { ...stats }]),
            ),
            stopReasonCounts: { ...summary.stopReasonCounts },
            retryErrorCodes: { ...(summary.retryErrorCodes || {}) },
            recentErrors: [...(summary.recentErrors || [])],
        };
    }

    /** Read member histories for session costs, including calls before a quota reset. */
    getGroupCostConversations(memberIds: readonly string[]): Pick<GMConversationData, 'cascadeId' | 'calls'>[] {
        const conversations: Pick<GMConversationData, 'cascadeId' | 'calls'>[] = [];
        for (const cascadeId of new Set(memberIds)) {
            const conversation = this._cache.get(cascadeId);
            if (!conversation) { continue; }
            const calls = this._currentAccountEmail
                ? conversation.calls.filter(call => !call.accountEmail || call.accountEmail === this._currentAccountEmail)
                : conversation.calls;
            conversations.push({ cascadeId, calls });
        }
        return conversations;
    }

    getUnmeasuredMemberIds(ids: readonly string[]): string[] {
        return ids.filter(id => !this._cache.get(id)?.calls.length);
    }

    /** Raw conversation cache for monitor persistence (ignores quota-cycle filtering). */
    getAllConversationData(): GMConversationData[] {
        return [...this._cache.values()]
            .map(cloneConversationData)
            .sort((a, b) => b.totalSteps - a.totalSteps);
    }

    /** Replace the cached summary used for UI restore / dev snapshot rollback. */
    setDetailedSummary(summary: GMSummary | null): void {
        this._lastSummary = summary ? normalizeGMSummary(summary) : null;
        this._lastFetchedAt = this._lastSummary?.fetchedAt || '';
    }

    /** Export state for globalState persistence */
    serialize(): GMTrackerState {
        this._purgeUnusableArchiveCutoffs();
        const baselines: Record<string, number> = {};
        for (const [id, conv] of this._cache) {
            baselines[id] = conv.totalSteps;
        }
        // Persist call baselines for cycle isolation across extension restarts
        const callBaselines: Record<string, number> = {};
        for (const [id, count] of this._callBaselines) {
            callBaselines[id] = count;
        }
        // Strip calls[] from conversations to keep globalState small.
        // calls will be re-fetched from API on next fetchAll().
        // _lastSummary already holds the full cross-account summary (set by fetchAll).
        // Fall back to a full rebuild only if it's somehow null.
        const raw = normalizeGMSummary(this._lastSummary || this._buildSummary(true, true));
        this._lastSummary = raw;
        const slim: GMSummary = {
            ...raw,
            conversations: raw.conversations.map(c => ({
                ...c, calls: [],
            })),
        };
        return {
            version: 1, summary: slim, baselines, callBaselines,
            ...(this._needsBaselineInit ? { needsStartupBaseline: true } : {}),
            ...(this._pendingStartupBaselines.size ? { pendingStartupBaselines: [...this._pendingStartupBaselines] } : {}),
            archivedCallIds: this._archivedCallIds.size > 0 ? [...this._archivedCallIds] : undefined,
            archivedModelCutoffs: this._archivedModelCutoffs.size > 0 ? Object.fromEntries(this._archivedModelCutoffs) : undefined,
            currentAccountEmail: this._currentAccountEmail || undefined,
            callAccountMap: this._callAccountMap.size > 0 ? Object.fromEntries(this._callAccountMap) : undefined,
            archivedAccountModelCutoffs: this._archivedAccountModelCutoffs.size > 0 ? Object.fromEntries(this._archivedAccountModelCutoffs) : undefined,
            exactArchivedAccountModels: this._exactArchivedAccountModels.size > 0 ? [...this._exactArchivedAccountModels] : undefined,
            persistedToolCallCounts: Object.keys(this._persistedToolCounts).length > 0 ? this._persistedToolCounts : undefined,
            persistedToolCallCountsByConv: Object.keys(this._persistedToolCountsByConv).length > 0 ? this._persistedToolCountsByConv : undefined,
            persistedRecentErrors: this._persistedRecentErrors.length > 0 ? this._persistedRecentErrors : undefined,
            persistedRetryErrorCodes: Object.keys(this._persistedRetryErrorCodes).length > 0 ? this._persistedRetryErrorCodes : undefined,
            persistedRetryErrorCodesByAccount: Object.keys(this._persistedRetryErrorCodesByAccount).length > 0 ? this._persistedRetryErrorCodesByAccount : undefined,
            persistedRecentErrorsByAccount: Object.keys(this._persistedRecentErrorsByAccount).length > 0 ? this._persistedRecentErrorsByAccount : undefined,
            persistedUniqueErrorsByAccount: Object.keys(this._persistedUniqueErrorsByAccount).length > 0 ? this._persistedUniqueErrorsByAccount : undefined,
            persistedToolCatalogByAccount: Object.keys(this._persistedToolCatalogByAccount).length > 0 ? this._persistedToolCatalogByAccount : undefined,
            ledgerPositions: this._ledgerPositions.size > 0 ? Object.fromEntries(this._ledgerPositions) : undefined,
            ledgerCallIdentities: this._ledgerCallIdentities.size > 0
                ? Object.fromEntries(
                    [...this._ledgerCallIdentities.entries()].map(([cid, list]) => [
                        cid,
                        Array.from(list, item => (typeof item === 'string' ? item : '')),
                    ]),
                )
                : undefined,
        };
    }

    /** Restore from persisted state. Cache is empty — API will backfill. */
    static restore(data: GMTrackerState): GMTracker {
        const tracker = new GMTracker();
        if (!data || data.version !== 1) { return tracker; }

        tracker._needsBaselineInit = data.needsStartupBaseline === true;
        if (Array.isArray(data.pendingStartupBaselines)) {
            tracker._pendingStartupBaselines = new Set(data.pendingStartupBaselines.filter(id => typeof id === 'string' && id));
        }
        tracker._hasFetchedCalls = false;    // calls[] stripped — don't rebuild from empty cache
        tracker._lastSummary = normalizeGMSummary(data.summary);
        tracker._lastFetchedAt = tracker._lastSummary.fetchedAt || '';

        // Seed baseline stubs so fetchAll() skips unchanged IDLE conversations
        for (const [id, stepCount] of Object.entries(data.baselines)) {
            const savedConv = tracker._lastSummary?.conversations.find(c => c.cascadeId === id);
            tracker._cache.set(id, {
                cascadeId: id,
                title: savedConv?.title || '',
                totalSteps: stepCount,
                calls: savedConv?.calls ? [...savedConv.calls] : [],
                lifetimeCalls: savedConv?.lifetimeCalls ?? 0,
                coveredSteps: savedConv?.coveredSteps ?? 0,
                coverageRate: savedConv?.coverageRate ?? 0,
                checkpointSummaries: savedConv?.checkpointSummaries || [],
                systemContextItems: savedConv?.systemContextItems || [],
            });
        }

        // Restore call baselines for cycle isolation
        if (data.callBaselines) {
            for (const [id, count] of Object.entries(data.callBaselines)) {
                tracker._callBaselines.set(id, count);
            }
        } else {
            // Migrating from pre-callBaselines version: no cycle boundary info.
            tracker._needsBaselineInit = true;
        }

        // Restore archived call IDs from per-pool resets
        if (Array.isArray(data.archivedCallIds)) {
            for (const id of data.archivedCallIds) {
                tracker._archivedCallIds.add(id);
            }
        }
        // Restore model-level cutoff timestamps (legacy v1.14.0 – v1.15.x)
        // MIGRATION: skip if the new per-account-model cutoffs are present.
        // The old global cutoffs were NOT account-scoped and caused cross-account
        // contamination — one account's baseline would hide other accounts' calls.
        if (!data.archivedAccountModelCutoffs) {
            if (data.archivedModelCutoffs && typeof data.archivedModelCutoffs === 'object') {
                for (const [id, cutoff] of Object.entries(data.archivedModelCutoffs)) {
                    if (typeof cutoff === 'string') {
                        tracker._archivedModelCutoffs.set(id, cutoff);
                    }
                }
            }
        }
        // else: archivedAccountModelCutoffs supersedes archivedModelCutoffs — don't load legacy data

        // Restore current account email
        if (typeof (data as any).currentAccountEmail === 'string') {
            tracker._currentAccountEmail = (data as any).currentAccountEmail;
        }

        // Restore executionId → accountEmail map
        if (data.callAccountMap && typeof data.callAccountMap === 'object') {
            for (const [execId, email] of Object.entries(data.callAccountMap)) {
                if (typeof email === 'string') {
                    tracker._callAccountMap.set(execId, email);
                }
            }
        }

        // Restore per-account+model cutoffs (added v1.16.0)
        if (data.archivedAccountModelCutoffs && typeof data.archivedAccountModelCutoffs === 'object') {
            for (const [key, cutoff] of Object.entries(data.archivedAccountModelCutoffs)) {
                if (typeof cutoff === 'string' && isUsableArchiveCutoff(cutoff)) {
                    tracker._archivedAccountModelCutoffs.set(key, cutoff);
                }
            }
        }
        if (Array.isArray(data.exactArchivedAccountModels)) {
            for (const key of data.exactArchivedAccountModels) {
                if (typeof key === 'string' && key.length > 0) {
                    tracker._exactArchivedAccountModels.add(key);
                }
            }
        }
        // Restore persisted tool call counts (added v1.17.0)
        if (data.persistedToolCallCounts && typeof data.persistedToolCallCounts === 'object') {
            tracker._persistedToolCounts = { ...data.persistedToolCallCounts };
        }
        if (data.persistedToolCallCountsByConv && typeof data.persistedToolCallCountsByConv === 'object') {
            tracker._persistedToolCountsByConv = JSON.parse(JSON.stringify(data.persistedToolCallCountsByConv));
        }
        // Restore persisted error data (added v1.17.1)
        if (Array.isArray(data.persistedRecentErrors)) {
            tracker._persistedRecentErrors = [...data.persistedRecentErrors];
        }
        if (data.persistedRetryErrorCodes && typeof data.persistedRetryErrorCodes === 'object') {
            tracker._persistedRetryErrorCodes = { ...data.persistedRetryErrorCodes };
        }
        // Restore per-account error data (added v1.17.2)
        if (data.persistedRetryErrorCodesByAccount && typeof data.persistedRetryErrorCodesByAccount === 'object') {
            tracker._persistedRetryErrorCodesByAccount = JSON.parse(JSON.stringify(data.persistedRetryErrorCodesByAccount));
        }
        if (data.persistedRecentErrorsByAccount && typeof data.persistedRecentErrorsByAccount === 'object') {
            tracker._persistedRecentErrorsByAccount = JSON.parse(JSON.stringify(data.persistedRecentErrorsByAccount));
        }
        // Migration: if legacy global error data exists but no per-account data,
        // attribute it to the current account (if known)
        if (Object.keys(tracker._persistedRetryErrorCodesByAccount).length === 0
            && Object.keys(tracker._persistedRetryErrorCodes).length > 0
            && tracker._currentAccountEmail) {
            tracker._persistedRetryErrorCodesByAccount[tracker._currentAccountEmail] = { ...tracker._persistedRetryErrorCodes };
        }
        if (Object.keys(tracker._persistedRecentErrorsByAccount).length === 0
            && tracker._persistedRecentErrors.length > 0
            && tracker._currentAccountEmail) {
            tracker._persistedRecentErrorsByAccount[tracker._currentAccountEmail] = [...tracker._persistedRecentErrors];
        }
        // Restore per-account unique errors (added v1.17.x)
        if (data.persistedUniqueErrorsByAccount && typeof data.persistedUniqueErrorsByAccount === 'object') {
            tracker._persistedUniqueErrorsByAccount = JSON.parse(JSON.stringify(data.persistedUniqueErrorsByAccount));
        }
        // Restore per-account tool catalog (added v1.17.x)
        if (data.persistedToolCatalogByAccount && typeof data.persistedToolCatalogByAccount === 'object') {
            tracker._persistedToolCatalogByAccount = JSON.parse(JSON.stringify(data.persistedToolCatalogByAccount));
        }
        // Restore DailyLedger positions (added v1.18.0)
        if (data.ledgerPositions && typeof data.ledgerPositions === 'object') {
            for (const [id, pos] of Object.entries(data.ledgerPositions)) {
                if (typeof pos === 'number') {
                    tracker._ledgerPositions.set(id, pos);
                }
            }
        }
        if (data.ledgerCallIdentities && typeof data.ledgerCallIdentities === 'object') {
            for (const [id, identities] of Object.entries(data.ledgerCallIdentities)) {
                if (Array.isArray(identities)) {
                    // Preserve positional alignment across sparse holes (serialized as '' or null)
                    const aligned = identities.map(item => (typeof item === 'string' ? item : ''));
                    tracker._ledgerCallIdentities.set(id, aligned);
                    const ackSet = new Set<string>();
                    for (const ident of aligned) {
                        if (ident) { ackSet.add(ident); }
                    }
                    if (ackSet.size > 0) {
                        tracker._ledgerAcknowledgedIds.set(id, ackSet);
                    }
                }
            }
        }

        return tracker;
    }

    /** Set the current account email. New calls will be tagged with this. */
    setCurrentAccount(email: string): void {
        this._currentAccountEmail = email;
    }

    /** Get the current account email. */
    getCurrentAccount(): string {
        return this._currentAccountEmail;
    }

    /** Account-filtered and archive-filtered summary for active UI display. */
    getUiSummary(): GMSummary | null {
        // UI must wait for live GM hydration instead of replaying persisted snapshots.
        if (!this._hasFetchedCalls) { return null; }
        const summary = normalizeGMSummary(this._buildSummary(false, false));
        if (!summary) { return null; }
        return {
            ...summary,
            conversations: summary.conversations.map(cloneConversationData),
            contextGrowth: summary.contextGrowth.map(point => ({ ...point })),
            latestTokenBreakdown: cloneTokenBreakdownGroups(summary.latestTokenBreakdown),
            modelBreakdown: Object.fromEntries(
                Object.entries(summary.modelBreakdown).map(([name, stats]) => [name, { ...stats }]),
            ),
            stopReasonCounts: { ...summary.stopReasonCounts },
            retryErrorCodes: { ...(summary.retryErrorCodes || {}) },
            recentErrors: [...(summary.recentErrors || [])],
        };
    }
}

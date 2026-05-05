// ─── GM Tracker Class ────────────────────────────────────────────────────────
// Core GMTracker class: fetch, aggregate, reset, serialize.

import { LSInfo } from '../discovery';
import { rpcCall } from '../rpc-client';
import { normalizeModelDisplayName, getQuotaPoolKey, resolveModelId, type ModelConfig } from '../models';
import type { QuotaSession } from '../quota-tracker';
import { findPricing } from '../pricing-store';
import type {
    GMCallEntry,
    GMCheckpointSummary,
    GMCompletionConfig,
    GMConversationData,
    GMModelStats,
    GMSummary,
    GMSystemContextItem,
    GMTrackerState,
    PendingArchiveEntry,
    TokenBreakdownGroup,
    UniqueErrorEntry,
    RecentErrorEntry,
    ToolCatalogEntry,
} from './types';
import { cloneConversationData, cloneTokenBreakdownGroups } from './types';
import {
    parseGMEntry,
    maybeEnrichCallsFromTrajectory,
    shouldEnrichConversation,
    buildGMArchiveKey,
    deduplicateApiErrorText,
} from './parser';
import { buildSummaryFromConversations, normalizeGMSummary, parseErrorCode, normalizeErrorMessage, MAX_RECENT_ERRORS } from './summary';

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
    /** executionIds of calls already archived by per-pool resets — excluded from _buildSummary() */
    private _archivedCallIds = new Set<string>();
    /** Model ID → ISO cutoff: calls with createdAt ≤ cutoff are excluded — survives empty _cache.calls */
    private _archivedModelCutoffs = new Map<string, string>();
    /** Current active account email — stamped onto newly fetched GM calls */
    private _currentAccountEmail = '';
    /** Persistent map: executionId → accountEmail. Survives cache overwrites from re-fetches. */
    private _callAccountMap = new Map<string, string>();
    /** Per-account+model ISO cutoffs: key="email|normalizedModel" — calls before cutoff are excluded */
    private _archivedAccountModelCutoffs = new Map<string, string>();
    /** Baselined cycle snapshots waiting for midnight archival */
    private _pendingArchives: PendingArchiveEntry[] = [];
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

    /**
     * Fetch GM data for the given trajectories.
     * Only re-fetches RUNNING conversations; IDLE ones use cache.
     */
    async fetchAll(
        ls: LSInfo,
        trajectories: { cascadeId: string; title: string; stepCount: number; status: string }[],
        signal?: AbortSignal,
    ): Promise<GMSummary> {
        const meta = { metadata: { ideName: 'antigravity', extensionName: 'antigravity' } };

        for (const t of trajectories) {
            if (t.stepCount === 0) { continue; }

            const cached = this._cache.get(t.cascadeId);
            // Skip IDLE conversations that haven't changed AND already have calls data.
            // After restore (calls stripped for storage), cached.calls is empty —
            // must re-fetch to repopulate. Once populated, normal skip logic resumes.
            // EXCEPTION: force one re-fetch when a conversation JUST transitioned from
            // RUNNING → IDLE, because the last GM call may not have been captured
            // during the final RUNNING poll (GM API lags behind Steps API).
            const wasRunning = this._lastRunningStatus.get(t.cascadeId) === true;
            const isRunning = t.status === 'CASCADE_RUN_STATUS_RUNNING';
            this._lastRunningStatus.set(t.cascadeId, isRunning);
            const justBecameIdle = wasRunning && !isRunning;
            if (cached && cached.calls.length > 0
                && !isRunning
                && !justBecameIdle
                && cached.totalSteps === t.stepCount) {
                continue;
            }

            try {
                const resp = await rpcCall(ls, 'GetCascadeTrajectoryGeneratorMetadata',
                    { cascadeId: t.cascadeId, ...meta }, 30000, signal) as Record<string, unknown>;
                const rawGM = (resp.generatorMetadata || []) as Record<string, unknown>[];

                let calls = rawGM.map(parseGMEntry);
                if (shouldEnrichConversation(t.stepCount, calls)) {
                    try {
                        const fullResp = await rpcCall(ls, 'GetCascadeTrajectory',
                            { cascadeId: t.cascadeId, ...meta }, 60000, signal) as Record<string, unknown>;
                        const trajectory = (fullResp.trajectory || {}) as Record<string, unknown>;
                        const embeddedRawGM = (trajectory.generatorMetadata || []) as Record<string, unknown>[];
                        if (embeddedRawGM.length > 0) {
                            calls = maybeEnrichCallsFromTrajectory(
                                calls,
                                embeddedRawGM.map(parseGMEntry),
                            );
                        }
                    } catch {
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
                        // New call — tag with current account and remember
                        c.accountEmail = this._currentAccountEmail;
                        this._callAccountMap.set(key, this._currentAccountEmail);
                    }
                }

                let coveredSteps = 0;
                for (const c of calls) { coveredSteps += c.stepIndices.length; }

                this._cache.set(t.cascadeId, {
                    cascadeId: t.cascadeId,
                    title: t.title,
                    totalSteps: t.stepCount,
                    calls,
                    lifetimeCalls: Math.max(cached?.lifetimeCalls ?? cached?.calls.length ?? 0, calls.length),
                    coveredSteps,
                    coverageRate: t.stepCount > 0 ? coveredSteps / t.stepCount : 0,
                    checkpointSummaries: deduplicateCheckpoints(calls),
                    systemContextItems: deduplicateSystemContextItems(calls),
                });
            } catch {
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
        }

        this._lastFetchedAt = new Date().toISOString();

        // On fresh start (no persisted state), baseline all existing API data
        // so only calls from this point forward are counted.
        if (this._needsBaselineInit) {
            for (const [id, conv] of this._cache) {
                if (!this._callBaselines.has(id)) {
                    this._callBaselines.set(id, conv.calls.length);
                }
            }
            this._needsBaselineInit = false;
        }

        this._lastSummary = this._buildSummary();
        return this._lastSummary;
    }

    /** Build aggregated summary from cached data */
    private _buildSummary(skipAccountFilter = false, skipArchivalFilter = false): GMSummary {
        const conversations: GMConversationData[] = [];
        const modelAgg = new Map<string, {
            callCount: number; stepsCovered: number;
            totalInput: number; totalOutput: number; totalThinking: number;
            totalCache: number; totalCacheCreation: number; totalCredits: number;
            ttfts: number[]; streams: number[];
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
                    // Per-account+model cutoff (pool-scoped archival)
                    // Key uses model ID (e.g. MODEL_PLACEHOLDER_M26) — language-independent
                    if (hasAccountModelFilter && c.accountEmail) {
                        const amKey = `${c.accountEmail}|${c.model}`;
                        const amCutoff = this._archivedAccountModelCutoffs.get(amKey);
                        if (amCutoff) {
                            const callMs = Date.parse(c.createdAt || '');
                            const cutoffMs = Date.parse(amCutoff);
                            if (isNaN(callMs) || callMs <= cutoffMs) {
                                return false;
                            }
                        }
                    }
                    if (hasCallFilter
                        && (this._archivedCallIds.has(c.executionId)
                            || this._archivedCallIds.has(buildGMArchiveKey(c)))) {
                        return false;
                    }
                    return true;
                })
                : sliced;

            // ── Account-level filtering for model statistics ──
            // The conversations[] array keeps ALL calls (all accounts) so the UI
            // can still show per-account breakdown tags. But modelBreakdown and
            // global totals only count calls belonging to the current online account.
            // Calls with empty accountEmail (legacy / pre-tagging data) are included
            // as a migration courtesy — they'll be tagged on next re-fetch.
            const accountFilteredCalls = (this._currentAccountEmail && !skipAccountFilter)
                ? activeCalls.filter(c =>
                    !c.accountEmail || c.accountEmail === this._currentAccountEmail)
                : activeCalls;

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
            // Uses `sliced` (post-baseline, pre-archival) so quota resets during
            // the day don't cause tool counts to drop. Only midnight reset()
            // (which advances baselines) clears the counts for a new day.
            const countedToolSteps = new Set<number>();
            const convToolCounts: Record<string, number> = {};
            for (const c of sliced) {
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
    baselineForQuotaReset(targetEmail?: string, poolModelFilter?: string[]): number {
        const email = targetEmail || this._currentAccountEmail;
        const now = new Date().toISOString();

        // Build a set of model IDs for pool matching.
        // poolModelFilter can contain model IDs ("MODEL_PLACEHOLDER_M26")
        // or display labels ("Claude Opus 4.6 (Thinking)" / "Claude Opus 4.6 (思考)").
        // Resolve everything to model IDs for stable, language-independent matching.
        const poolModelIds = poolModelFilter && poolModelFilter.length > 0
            ? new Set(poolModelFilter.map(m => resolveModelId(m) || m))
            : null; // null = all models

        // Helper: check if a call belongs to the target pool (by model ID)
        const callMatchesPool = (call: GMCallEntry): boolean => {
            if (!poolModelIds) { return true; }
            return poolModelIds.has(call.model)
                || (call.responseModel ? poolModelIds.has(call.responseModel) : false);
        };

        // ── Step 1: Compute accurate stats from _lastSummary (full picture) ──
        const summary = this._lastSummary;
        let summaryCount = 0;
        let summaryInputTokens = 0;
        let summaryOutputTokens = 0;
        let summaryCacheRead = 0;
        let summaryCredits = 0;
        let summaryCost = 0;
        const summaryModelCalls = new Map<string, number>();
        const archivedModelIds = new Set<string>();

        if (summary) {
            for (const conv of summary.conversations) {
                for (const call of conv.calls) {
                    if (email && call.accountEmail && call.accountEmail !== email) { continue; }
                    if (!call.accountEmail && email) { continue; }
                    if (!callMatchesPool(call)) { continue; }
                    summaryCount++;
                    summaryInputTokens += call.inputTokens;
                    summaryOutputTokens += call.outputTokens;
                    summaryCacheRead += call.cacheReadTokens;
                    summaryCredits += call.credits;
                    // Per-call cost using responseModel pricing
                    if (call.responseModel) {
                        const pr = findPricing(call.responseModel);
                        if (pr) {
                            const respOut = Math.max(0, (call.outputTokens || 0) - (call.thinkingTokens || 0));
                            summaryCost += (
                                (call.inputTokens || 0) * pr.input +
                                respOut * pr.output +
                                (call.cacheReadTokens || 0) * pr.cacheRead +
                                (call.thinkingTokens || 0) * pr.thinking
                            ) / 1_000_000;
                        }
                    }
                    const modelKey = normalizeModelDisplayName(
                        call.modelDisplay || call.model,
                    ) || call.responseModel || call.model;
                    summaryModelCalls.set(modelKey, (summaryModelCalls.get(modelKey) || 0) + 1);
                    archivedModelIds.add(call.model); // model ID, not display name
                }
            }
        }

        // ── Step 2: Set per-account+model cutoffs to NOW ──
        // Key = "email|MODEL_ID" (language-independent, stable)
        for (const modelId of archivedModelIds) {
            const amKey = `${email}|${modelId}`;
            this._archivedAccountModelCutoffs.set(amKey, now);
        }
        // Also set cutoffs for all pool model IDs (belt and suspenders)
        if (poolModelIds && email) {
            for (const mid of poolModelIds) {
                const amKey = `${email}|${mid}`;
                if (!this._archivedAccountModelCutoffs.has(amKey)) {
                    this._archivedAccountModelCutoffs.set(amKey, now);
                }
            }
        }

        // ── Step 3: Also mark individual calls in _archivedCallIds (from _cache) ──
        let cacheCount = 0;
        let cacheInputTokens = 0;
        let cacheOutputTokens = 0;
        let cacheCacheRead = 0;
        let cacheCredits = 0;
        let cacheCost = 0;
        const cacheModelCalls = new Map<string, number>();

        for (const [, conv] of this._cache) {
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const activeCalls = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;
            for (const call of activeCalls) {
                if (email && call.accountEmail && call.accountEmail !== email) { continue; }
                if (!callMatchesPool(call)) { continue; }
                const archKey = buildGMArchiveKey(call);
                if (this._archivedCallIds.has(call.executionId) || this._archivedCallIds.has(archKey)) { continue; }
                if (call.executionId) { this._archivedCallIds.add(call.executionId); }
                this._archivedCallIds.add(archKey);
                cacheCount++;
                cacheInputTokens += call.inputTokens;
                cacheOutputTokens += call.outputTokens;
                cacheCacheRead += call.cacheReadTokens;
                cacheCredits += call.credits;
                // Per-call cost using responseModel pricing
                if (call.responseModel) {
                    const pr = findPricing(call.responseModel);
                    if (pr) {
                        const respOut = Math.max(0, (call.outputTokens || 0) - (call.thinkingTokens || 0));
                        cacheCost += (
                            (call.inputTokens || 0) * pr.input +
                            respOut * pr.output +
                            (call.cacheReadTokens || 0) * pr.cacheRead +
                            (call.thinkingTokens || 0) * pr.thinking
                        ) / 1_000_000;
                    }
                }
                const modelKey = normalizeModelDisplayName(
                    call.modelDisplay || call.model,
                ) || call.responseModel || call.model;
                cacheModelCalls.set(modelKey, (cacheModelCalls.get(modelKey) || 0) + 1);
                archivedModelIds.add(call.model); // also capture from cache path
            }
        }

        // ── Step 4: Use the more accurate of summary vs cache stats ──
        const useSummary = summaryCount >= cacheCount;
        const finalCount = useSummary ? summaryCount : cacheCount;
        const finalInputTokens = useSummary ? summaryInputTokens : cacheInputTokens;
        const finalOutputTokens = useSummary ? summaryOutputTokens : cacheOutputTokens;
        const finalCacheRead = useSummary ? summaryCacheRead : cacheCacheRead;
        const finalCredits = useSummary ? summaryCredits : cacheCredits;
        const finalModelCalls = useSummary ? summaryModelCalls : cacheModelCalls;
        const finalCost = useSummary ? summaryCost : cacheCost;

        // Record pending archive entry
        if (finalCount > 0) {
            const modelCalls: Record<string, number> = {};
            for (const [model, c] of finalModelCalls) { modelCalls[model] = c; }
            this._pendingArchives.push({
                timestamp: now,
                accountEmail: email,
                totalCalls: finalCount,
                totalInputTokens: finalInputTokens,
                totalOutputTokens: finalOutputTokens,
                totalCacheRead: finalCacheRead,
                totalCredits: finalCredits,
                modelCalls,
                estimatedCost: finalCost,
            });
        }

        // ── Step 5: Clear persisted error data for the archived account ──
        // Clear ALL persisted error baselines — after archiving calls, the max-wins
        // merge must recalculate from actual remaining calls instead of restoring
        // stale totals that included now-archived data.
        // Note: unique error catalog and tool catalog are permanent — NOT cleared here.
        this._persistedRetryErrorCodesByAccount = {};
        this._persistedRecentErrorsByAccount = {};
        this._persistedRetryErrorCodes = {};
        this._persistedRecentErrors = [];

        // Invalidate cached summary so next access rebuilds
        this._lastSummary = null;
        return finalCount;
    }

    /** Get all pending archive entries (waiting for midnight sweep). */
    getPendingArchives(): PendingArchiveEntry[] {
        return this._pendingArchives;
    }

    /**
     * Check if a pool has already been archived for a given account.
     * Returns true ONLY if cutoff entries exist AND there are NO un-archived
     * calls for this account+pool. This prevents stale cutoffs from a
     * previous quota cycle from blocking new archival.
     */
    isPoolArchived(email: string, modelLabels: string[]): boolean {
        if (this._archivedAccountModelCutoffs.size === 0) { return false; }

        // Must have at least one cutoff entry for this pool
        const poolModelIds = new Set(modelLabels.map(l => resolveModelId(l) || l));
        const hasCutoff = [...poolModelIds].some(mid =>
            this._archivedAccountModelCutoffs.has(`${email}|${mid}`)
        );
        if (!hasCutoff) { return false; }

        // Check if there are any un-archived calls for this account+pool
        for (const [, conv] of this._cache) {
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const activeCalls = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;
            for (const call of activeCalls) {
                if (call.accountEmail && call.accountEmail !== email) { continue; }
                if (!call.accountEmail && email) { continue; }
                // Check if call belongs to this pool
                if (!poolModelIds.has(call.model) &&
                    !(call.responseModel && poolModelIds.has(call.responseModel))) { continue; }
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
        this._callAccountMap.clear();
        this._pendingArchives = [];
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
    }

    /**
     * Nuclear reset — clears all internal state and starts counting from zero.
     * Next fetchAll() will baseline all existing API data, so only truly new
     * calls (made after this reset) are counted.
     */
    fullReset(): void {
        this._cache.clear();
        this._callBaselines.clear();
        this._archivedCallIds.clear();
        this._archivedModelCutoffs.clear();
        this._archivedAccountModelCutoffs.clear();
        this._callAccountMap.clear();
        this._pendingArchives = [];
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
        const summary = normalizeGMSummary(this._lastSummary || this._buildSummary());
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

    /**
     * Full summary for midnight archival — includes ALL calls from this cycle:
     * both "pending archive" (already baselined by quota resets) and still-active calls.
     * Skips both account filtering and archival filtering so DailyStore receives
     * the true complete picture of the day's usage.
     */
    getArchivalSummary(): GMSummary | null {
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
        const raw = normalizeGMSummary(this._lastSummary || this._buildSummary());
        this._lastSummary = raw;
        const slim: GMSummary = {
            ...raw,
            conversations: raw.conversations.map(c => ({
                ...c, calls: [],
            })),
        };
        return {
            version: 1, summary: slim, baselines, callBaselines,
            archivedCallIds: this._archivedCallIds.size > 0 ? [...this._archivedCallIds] : undefined,
            archivedModelCutoffs: this._archivedModelCutoffs.size > 0 ? Object.fromEntries(this._archivedModelCutoffs) : undefined,
            currentAccountEmail: this._currentAccountEmail || undefined,
            callAccountMap: this._callAccountMap.size > 0 ? Object.fromEntries(this._callAccountMap) : undefined,
            pendingArchives: this._pendingArchives.length > 0 ? this._pendingArchives : undefined,
            archivedAccountModelCutoffs: this._archivedAccountModelCutoffs.size > 0 ? Object.fromEntries(this._archivedAccountModelCutoffs) : undefined,
            persistedToolCallCounts: Object.keys(this._persistedToolCounts).length > 0 ? this._persistedToolCounts : undefined,
            persistedToolCallCountsByConv: Object.keys(this._persistedToolCountsByConv).length > 0 ? this._persistedToolCountsByConv : undefined,
            persistedRecentErrors: this._persistedRecentErrors.length > 0 ? this._persistedRecentErrors : undefined,
            persistedRetryErrorCodes: Object.keys(this._persistedRetryErrorCodes).length > 0 ? this._persistedRetryErrorCodes : undefined,
            persistedRetryErrorCodesByAccount: Object.keys(this._persistedRetryErrorCodesByAccount).length > 0 ? this._persistedRetryErrorCodesByAccount : undefined,
            persistedRecentErrorsByAccount: Object.keys(this._persistedRecentErrorsByAccount).length > 0 ? this._persistedRecentErrorsByAccount : undefined,
            persistedUniqueErrorsByAccount: Object.keys(this._persistedUniqueErrorsByAccount).length > 0 ? this._persistedUniqueErrorsByAccount : undefined,
            persistedToolCatalogByAccount: Object.keys(this._persistedToolCatalogByAccount).length > 0 ? this._persistedToolCatalogByAccount : undefined,
        };
    }

    /** Restore from persisted state. Cache is empty — API will backfill. */
    static restore(data: GMTrackerState): GMTracker {
        const tracker = new GMTracker();
        if (!data || data.version !== 1) { return tracker; }

        tracker._needsBaselineInit = false; // restored = not a manual clear
        tracker._lastSummary = normalizeGMSummary(data.summary);
        tracker._lastFetchedAt = tracker._lastSummary.fetchedAt || '';

        // Seed baseline stubs so fetchAll() skips unchanged IDLE conversations
        for (const [id, stepCount] of Object.entries(data.baselines)) {
            tracker._cache.set(id, {
                cascadeId: id,
                title: '',  // will be filled on next fetchAll
                totalSteps: stepCount,
                calls: [],
                lifetimeCalls: tracker._lastSummary.conversations.find(c => c.cascadeId === id)?.lifetimeCalls ?? 0,
                coveredSteps: 0,
                coverageRate: 0,
                checkpointSummaries: [],
                systemContextItems: [],
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

        // Restore pending archives (added v1.16.0)
        if (Array.isArray(data.pendingArchives)) {
            tracker._pendingArchives = data.pendingArchives;
        }

        // Restore per-account+model cutoffs (added v1.16.0)
        if (data.archivedAccountModelCutoffs && typeof data.archivedAccountModelCutoffs === 'object') {
            for (const [key, cutoff] of Object.entries(data.archivedAccountModelCutoffs)) {
                if (typeof cutoff === 'string') {
                    tracker._archivedAccountModelCutoffs.set(key, cutoff);
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
}

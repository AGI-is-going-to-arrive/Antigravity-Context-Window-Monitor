// ─── GM Tracker Class ────────────────────────────────────────────────────────
// Core GMTracker class: fetch, aggregate, reset, serialize.

import { LSInfo } from '../discovery';
import { rpcCall } from '../rpc-client';
import { normalizeModelDisplayName, getQuotaPoolKey, type ModelConfig } from '../models';
import type { QuotaSession } from '../quota-tracker';
import type {
    GMCallEntry,
    GMCheckpointSummary,
    GMCompletionConfig,
    GMConversationData,
    GMModelStats,
    GMSummary,
    GMTrackerState,
    PendingArchiveEntry,
    TokenBreakdownGroup,
} from './types';
import { cloneConversationData, cloneTokenBreakdownGroups } from './types';
import {
    parseGMEntry,
    maybeEnrichCallsFromTrajectory,
    shouldEnrichConversation,
    buildGMArchiveKey,
} from './parser';
import { buildSummaryFromConversations, normalizeGMSummary } from './summary';

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
            if (cached && cached.calls.length > 0
                && t.status !== 'CASCADE_RUN_STATUS_RUNNING'
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
                // Key = cascadeId + array index. The GM API returns calls in stable
                // chronological order; new calls are appended at the end, so existing
                // calls maintain their index across re-fetches.
                for (let i = 0; i < calls.length; i++) {
                    const c = calls[i];
                    const key = `${t.cascadeId}:${i}`;
                    const known = this._callAccountMap.get(key);
                    if (known) {
                        // Already tracked — restore original account
                        c.accountEmail = known;
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
    private _buildSummary(): GMSummary {
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
            exactCallCount: number;
            placeholderOnlyCalls: number;
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
        const contextGrowth: { step: number; tokens: number; model: string }[] = [];

        for (const [, conv] of this._cache) {
            // Only aggregate calls from the current cycle (after baseline)
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const sliced = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;
            // Filter out calls already archived by per-pool resets
            const hasCallFilter = this._archivedCallIds.size > 0;
            const hasModelFilter = this._archivedModelCutoffs.size > 0;
            const hasAccountModelFilter = this._archivedAccountModelCutoffs.size > 0;
            const activeCalls = (hasCallFilter || hasModelFilter || hasAccountModelFilter)
                ? sliced.filter(c => {
                    // Per-account+model cutoff (pool-scoped archival)
                    if (hasAccountModelFilter && c.accountEmail) {
                        const modelName = normalizeModelDisplayName(c.modelDisplay || c.model)
                            || c.modelDisplay || c.model;
                        const amKey = `${c.accountEmail}|${modelName}`;
                        const amCutoff = this._archivedAccountModelCutoffs.get(amKey);
                        if (amCutoff) {
                            const callMs = Date.parse(c.createdAt || '');
                            const cutoffMs = Date.parse(amCutoff);
                            if (isNaN(callMs) || callMs <= cutoffMs) {
                                return false;
                            }
                        }
                    }
                    if (hasModelFilter) {
                        const cutoff = this._archivedModelCutoffs.get(c.model)
                            || (c.responseModel ? this._archivedModelCutoffs.get(c.responseModel) : undefined);
                        if (cutoff) {
                            const callMs = Date.parse(c.createdAt || '');
                            const cutoffMs = Date.parse(cutoff);
                            // If createdAt is missing or unparseable, assume old call -> filter it out
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
            const accountFilteredCalls = this._currentAccountEmail
                ? activeCalls.filter(c =>
                    !c.accountEmail || c.accountEmail === this._currentAccountEmail)
                : activeCalls;

            const activeStepsCovered = activeCalls.reduce((sum, c) => sum + c.stepIndices.length, 0);
            conversations.push({
                ...conv,
                calls: activeCalls,
                lifetimeCalls: conv.lifetimeCalls ?? conv.calls.length,
                coveredSteps: activeStepsCovered,
                coverageRate: conv.totalSteps > 0 ? activeStepsCovered / conv.totalSteps : 0,
                checkpointSummaries: conv.checkpointSummaries || deduplicateCheckpoints(activeCalls),
            });

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
                        exactCallCount: 0,
                        placeholderOnlyCalls: 0,
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
                exactCallCount: agg.exactCallCount,
                placeholderOnlyCalls: agg.placeholderOnlyCalls,
            };
        }

        return {
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
        };
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

        // Build a normalized set of pool model names for matching
        const poolSet = poolModelFilter && poolModelFilter.length > 0
            ? new Set(poolModelFilter.flatMap(m => {
                const norm = normalizeModelDisplayName(m);
                return norm ? [m, norm] : [m];
            }))
            : null; // null = all models

        // Helper: check if a call belongs to the target pool
        const callMatchesPool = (call: GMCallEntry): boolean => {
            if (!poolSet) { return true; }
            const candidates = [
                call.model,
                call.modelDisplay,
                call.responseModel,
                normalizeModelDisplayName(call.modelDisplay || call.model),
                normalizeModelDisplayName(call.responseModel),
            ].filter(Boolean) as string[];
            return candidates.some(c => poolSet.has(c));
        };

        // ── Step 1: Compute accurate stats from _lastSummary (full picture) ──
        // The summary has already been built by fetchAll() and includes all loaded calls.
        // Using it ensures we don't undercount due to partial cache loading.
        const summary = this._lastSummary;
        let summaryCount = 0;
        let summaryInputTokens = 0;
        let summaryOutputTokens = 0;
        let summaryCredits = 0;
        const summaryModelCalls = new Map<string, number>();
        const archivedModelNames = new Set<string>();

        if (summary) {
            for (const conv of summary.conversations) {
                for (const call of conv.calls) {
                    if (email && call.accountEmail && call.accountEmail !== email) { continue; }
                    if (!call.accountEmail && email) { continue; } // skip untagged when filtering by email
                    if (!callMatchesPool(call)) { continue; }
                    summaryCount++;
                    summaryInputTokens += call.inputTokens;
                    summaryOutputTokens += call.outputTokens;
                    summaryCredits += call.credits;
                    const modelKey = normalizeModelDisplayName(
                        call.modelDisplay || call.model,
                    ) || call.responseModel || call.model;
                    summaryModelCalls.set(modelKey, (summaryModelCalls.get(modelKey) || 0) + 1);
                    archivedModelNames.add(modelKey);
                }
            }
        }

        // ── Step 2: Set per-account+model cutoffs to NOW ──
        // This guarantees ALL existing calls for this account+model combo
        // are excluded in future _buildSummary() calls, even if _cache
        // wasn't fully loaded when this method ran.
        for (const modelName of archivedModelNames) {
            const amKey = `${email}|${modelName}`;
            this._archivedAccountModelCutoffs.set(amKey, now);
        }
        // Also set cutoffs for pool model names (belt and suspenders)
        if (poolSet && email) {
            for (const m of poolSet) {
                const norm = normalizeModelDisplayName(m) || m;
                const amKey = `${email}|${norm}`;
                if (!this._archivedAccountModelCutoffs.has(amKey)) {
                    this._archivedAccountModelCutoffs.set(amKey, now);
                }
            }
        }

        // ── Step 3: Also mark individual calls in _archivedCallIds (from _cache) ──
        let cacheCount = 0;
        let cacheInputTokens = 0;
        let cacheOutputTokens = 0;
        let cacheCredits = 0;
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
                cacheCredits += call.credits;
                const modelKey = normalizeModelDisplayName(
                    call.modelDisplay || call.model,
                ) || call.responseModel || call.model;
                cacheModelCalls.set(modelKey, (cacheModelCalls.get(modelKey) || 0) + 1);
            }
        }

        // ── Step 4: Use the more accurate of summary vs cache stats ──
        const useSummary = summaryCount >= cacheCount;
        const finalCount = useSummary ? summaryCount : cacheCount;
        const finalInputTokens = useSummary ? summaryInputTokens : cacheInputTokens;
        const finalOutputTokens = useSummary ? summaryOutputTokens : cacheOutputTokens;
        const finalCredits = useSummary ? summaryCredits : cacheCredits;
        const finalModelCalls = useSummary ? summaryModelCalls : cacheModelCalls;

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
                totalCredits: finalCredits,
                modelCalls,
            });
        }
        // Invalidate cached summary so next access rebuilds
        this._lastSummary = null;
        return finalCount;
    }

    /** Get all pending archive entries (waiting for midnight sweep). */
    getPendingArchives(): PendingArchiveEntry[] {
        return this._pendingArchives;
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
        this._lastSummary = null;
        this._lastFetchedAt = '';
        this._needsBaselineInit = true;
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
        // Restore model-level cutoff timestamps (added v1.14.0)
        if (data.archivedModelCutoffs && typeof data.archivedModelCutoffs === 'object') {
            for (const [id, cutoff] of Object.entries(data.archivedModelCutoffs)) {
                if (typeof cutoff === 'string') {
                    tracker._archivedModelCutoffs.set(id, cutoff);
                }
            }
        }

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

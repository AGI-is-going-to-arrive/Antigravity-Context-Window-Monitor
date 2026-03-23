// ─── GM Tracker ──────────────────────────────────────────────────────────────
// Fetches generatorMetadata from GetCascadeTrajectoryGeneratorMetadata endpoint.
// Provides precise model attribution, performance metrics, and token usage
// — data that the existing activity-tracker.ts cannot access.
//
// This module is ADDITIVE — it does NOT modify any existing tracker logic.

import { LSInfo } from './discovery';
import { rpcCall } from './rpc-client';
import { getModelDisplayName } from './models';

// ─── Exported Types ──────────────────────────────────────────────────────────

/** completionConfig extracted from chatModel */
export interface GMCompletionConfig {
    maxTokens: number;
    temperature: number;
    firstTemperature: number;
    topK: number;
    topP: number;
    numCompletions: number;
    stopPatternCount: number;
}

/** A single LLM invocation entry from generatorMetadata */
export interface GMCallEntry {
    stepIndices: number[];
    executionId: string;
    model: string;           // e.g. MODEL_PLACEHOLDER_M26
    modelDisplay: string;    // e.g. Claude Opus 4
    responseModel: string;   // e.g. claude-opus-4-6-thinking
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    responseTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    apiProvider: string;     // e.g. API_PROVIDER_ANTHROPIC_VERTEX
    ttftSeconds: number;
    streamingSeconds: number;
    credits: number;
    creditType: string;
    hasError: boolean;
    errorMessage: string;
    /** Context window usage at call time (if available) */
    contextTokensUsed: number;
    /** Model configuration parameters */
    completionConfig: GMCompletionConfig | null;
    /** First N chars of system prompt (if available) */
    systemPromptSnippet: string;
    /** Number of tools available */
    toolCount: number;
    /** Tool names list */
    toolNames: string[];
    /** Prompt section titles */
    promptSectionTitles: string[];
    /** Number of retries for this call */
    retries: number;
}

/** Aggregated per-model statistics */
export interface GMModelStats {
    callCount: number;
    stepsCovered: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalCredits: number;
    avgTTFT: number;        // seconds
    minTTFT: number;
    maxTTFT: number;
    avgStreaming: number;    // seconds
    cacheHitRate: number;   // fraction of calls with cache > 0
    responseModel: string;
    apiProvider: string;
    /** Model DNA: completionConfig (latest seen) */
    completionConfig: GMCompletionConfig | null;
    /** Whether system prompt was seen for this model */
    hasSystemPrompt: boolean;
    /** Number of tools available */
    toolCount: number;
    /** Names of prompt sections */
    promptSectionTitles: string[];
    /** Total retries across all calls */
    totalRetries: number;
    /** Total error count */
    errorCount: number;
}

/** Per-conversation GM data */
export interface GMConversationData {
    cascadeId: string;
    title: string;
    totalSteps: number;
    calls: GMCallEntry[];
    coveredSteps: number;
    coverageRate: number;   // coveredSteps / totalSteps
}

/** Full GM summary for UI rendering */
export interface GMSummary {
    conversations: GMConversationData[];
    modelBreakdown: Record<string, GMModelStats>;
    totalCalls: number;
    totalStepsCovered: number;
    totalCredits: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalThinkingTokens: number;
    /** Context growth data points: step → tokens */
    contextGrowth: { step: number; tokens: number; model: string }[];
    fetchedAt: string;
}

/** Serialized form for globalState persistence */
export interface GMTrackerState {
    version: 1;
    summary: GMSummary;
    /** cascadeId → stepCount baselines to skip unchanged IDLE conversations */
    baselines: Record<string, number>;
    /** cascadeId → call count baselines to isolate quota cycles (added v1.13.2) */
    callBaselines?: Record<string, number>;
}

// ─── Parser Helpers ──────────────────────────────────────────────────────────

function parseDuration(s: string | undefined): number {
    if (!s || typeof s !== 'string') { return 0; }
    const n = parseFloat(s.replace('s', ''));
    return isNaN(n) ? 0 : n;
}

function parseInt0(s: string | undefined): number {
    if (!s) { return 0; }
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
}

function parseCompletionConfig(cc: Record<string, unknown> | undefined): GMCompletionConfig | null {
    if (!cc || typeof cc !== 'object') { return null; }
    const stopPatterns = cc.stopPatterns as unknown[];
    return {
        maxTokens: parseInt0(cc.maxTokens as string),
        temperature: typeof cc.temperature === 'number' ? cc.temperature : 0,
        firstTemperature: typeof cc.firstTemperature === 'number' ? cc.firstTemperature : 0,
        topK: parseInt0(cc.topK as string),
        topP: typeof cc.topP === 'number' ? cc.topP : 0,
        numCompletions: parseInt0(cc.numCompletions as string),
        stopPatternCount: Array.isArray(stopPatterns) ? stopPatterns.length : 0,
    };
}

function parseGMEntry(gm: Record<string, unknown>): GMCallEntry {
    const cm = (gm.chatModel || {}) as Record<string, unknown>;
    const usage = (cm.usage || {}) as Record<string, unknown>;
    const csm = (cm.chatStartMetadata || {}) as Record<string, unknown>;
    const cwm = (csm.contextWindowMetadata || {}) as Record<string, unknown>;

    // Credits
    let credits = 0;
    let creditType = '';
    const consumedCredits = cm.consumedCredits as Record<string, string>[] | undefined;
    if (Array.isArray(consumedCredits) && consumedCredits.length > 0) {
        credits = parseInt0(consumedCredits[0].creditAmount);
        creditType = consumedCredits[0].creditType || '';
    }

    const modelId = (cm.model as string) || '';

    // Model DNA fields
    const completionConfig = parseCompletionConfig(cm.completionConfig as Record<string, unknown>);

    const systemPrompt = (cm.systemPrompt as string) || '';
    const systemPromptSnippet = systemPrompt.length > 120
        ? systemPrompt.substring(0, 120) + '...'
        : systemPrompt;

    const tools = (cm.tools as Record<string, unknown>[]) || [];
    const toolNames = tools.map(t => (t.name as string) || '?');

    const promptSections = (cm.promptSections as Record<string, unknown>[]) || [];
    const promptSectionTitles = promptSections.map(p => (p.title as string) || '?');

    const retries = parseInt0(cm.retries as string);
    const errorMessage = (gm.error as string) || '';

    return {
        stepIndices: (gm.stepIndices as number[]) || [],
        executionId: (gm.executionId as string) || '',
        model: modelId,
        modelDisplay: modelId ? getModelDisplayName(modelId) : modelId,
        responseModel: (cm.responseModel as string) || '',
        inputTokens: parseInt0(usage.inputTokens as string),
        outputTokens: parseInt0(usage.outputTokens as string),
        thinkingTokens: parseInt0(usage.thinkingOutputTokens as string),
        responseTokens: parseInt0(usage.responseOutputTokens as string),
        cacheReadTokens: parseInt0(usage.cacheReadTokens as string),
        cacheCreationTokens: parseInt0(usage.cacheCreationTokens as string),
        apiProvider: (usage.apiProvider as string) || '',
        ttftSeconds: parseDuration(cm.timeToFirstToken as string),
        streamingSeconds: parseDuration(cm.streamingDuration as string),
        credits,
        creditType,
        hasError: !!(errorMessage),
        errorMessage,
        contextTokensUsed: (cwm?.estimatedTokensUsed as number) || 0,
        completionConfig,
        systemPromptSnippet,
        toolCount: tools.length,
        toolNames,
        promptSectionTitles,
        retries,
    };
}

// ─── GMTracker Class ─────────────────────────────────────────────────────────

export class GMTracker {
    private _cache = new Map<string, GMConversationData>();
    private _lastFetchedAt = '';
    /** Cached summary for instant access after restore */
    private _lastSummary: GMSummary | null = null;
    /** Per-conversation baseline call counts — calls[0..baseline-1] are from prior cycles */
    private _callBaselines = new Map<string, number>();
    /** When true, first fetchAll() baselines all existing API data (set only by fullReset) */
    private _needsBaselineInit = false;

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

                const calls = rawGM.map(parseGMEntry);
                let coveredSteps = 0;
                for (const c of calls) { coveredSteps += c.stepIndices.length; }

                this._cache.set(t.cascadeId, {
                    cascadeId: t.cascadeId,
                    title: t.title,
                    totalSteps: t.stepCount,
                    calls,
                    coveredSteps,
                    coverageRate: t.stepCount > 0 ? coveredSteps / t.stepCount : 0,
                });
            } catch {
                // Keep stale cache on error
                if (!cached) {
                    this._cache.set(t.cascadeId, {
                        cascadeId: t.cascadeId,
                        title: t.title,
                        totalSteps: t.stepCount,
                        calls: [],
                        coveredSteps: 0,
                        coverageRate: 0,
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
        }>();

        let totalCalls = 0;
        let totalStepsCovered = 0;
        let totalCredits = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let totalCache = 0;
        let totalCacheCreation = 0;
        let totalThinking = 0;
        const contextGrowth: { step: number; tokens: number; model: string }[] = [];

        for (const [, conv] of this._cache) {
            // Only aggregate calls from the current cycle (after baseline)
            const baseline = this._callBaselines.get(conv.cascadeId) || 0;
            const activeCalls = baseline > 0 ? conv.calls.slice(baseline) : conv.calls;
            const activeStepsCovered = activeCalls.reduce((sum, c) => sum + c.stepIndices.length, 0);
            conversations.push({
                ...conv,
                calls: activeCalls,
                coveredSteps: activeStepsCovered,
                coverageRate: conv.totalSteps > 0 ? activeStepsCovered / conv.totalSteps : 0,
            });

            for (const c of activeCalls) {
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
                        model: c.modelDisplay,
                    });
                }

                // Per-model aggregation
                const key = c.modelDisplay || c.model;
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
        };
    }

    /**
     * Full reset on quota boundary.
     * Pre-reset snapshot is already archived to dailyStore.addCycle()
     * in extension.ts, so no data is lost.
     * Preserves call baselines so _buildSummary() only counts new-cycle calls.
     * Analogous to activityTracker's trajectory baseline preservation.
     */
    reset(): void {
        // Record call baselines: for conversations that were fetched from API
        // (calls.length > 0), set baseline to their absolute call count.
        // Stubs (calls=[]) keep their existing baseline from previous reset.
        for (const [id, conv] of this._cache) {
            if (conv.calls.length > 0) {
                this._callBaselines.set(id, conv.calls.length);
            }
        }
        // Keep cache entries with stepCount so fetchAll() skips unchanged IDLE
        // conversations, but clear calls to save memory.
        for (const [id, conv] of this._cache) {
            this._cache.set(id, {
                ...conv,
                calls: [],
                coveredSteps: 0,
                coverageRate: 0,
            });
        }
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
        this._lastSummary = null;
        this._lastFetchedAt = '';
        this._needsBaselineInit = true;
    }

    // ─── Serialization ───────────────────────────────────────────────────

    /**
     * Return the last computed summary without re-computing.
     * Used on startup to instantly display persisted data.
     */
    getCachedSummary(): GMSummary | null {
        return this._lastSummary;
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
        const raw = this._lastSummary || this._buildSummary();
        const slim: GMSummary = {
            ...raw,
            conversations: raw.conversations.map(c => ({
                ...c, calls: [],
            })),
        };
        return { version: 1, summary: slim, baselines, callBaselines };
    }

    /** Restore from persisted state. Cache is empty — API will backfill. */
    static restore(data: GMTrackerState): GMTracker {
        const tracker = new GMTracker();
        if (!data || data.version !== 1) { return tracker; }

        tracker._needsBaselineInit = false; // restored = not a manual clear
        tracker._lastSummary = data.summary;
        tracker._lastFetchedAt = data.summary.fetchedAt || '';

        // Seed baseline stubs so fetchAll() skips unchanged IDLE conversations
        for (const [id, stepCount] of Object.entries(data.baselines)) {
            tracker._cache.set(id, {
                cascadeId: id,
                title: '',  // will be filled on next fetchAll
                totalSteps: stepCount,
                calls: [],
                coveredSteps: 0,
                coverageRate: 0,
            });
        }

        // Restore call baselines for cycle isolation
        if (data.callBaselines) {
            for (const [id, count] of Object.entries(data.callBaselines)) {
                tracker._callBaselines.set(id, count);
            }
        } else {
            // Migrating from pre-callBaselines version: no cycle boundary info.
            // Baseline all existing API data on first fetch to avoid showing
            // data from previous archived cycles.
            tracker._needsBaselineInit = true;
        }

        return tracker;
    }
}

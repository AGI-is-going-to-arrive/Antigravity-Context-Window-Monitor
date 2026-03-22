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
    /** Context window usage at call time (if available) */
    contextTokensUsed: number;
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
        hasError: !!(cm.error as string),
        contextTokensUsed: (cwm?.estimatedTokensUsed as number) || 0,
    };
}

// ─── GMTracker Class ─────────────────────────────────────────────────────────

export class GMTracker {
    private _cache = new Map<string, GMConversationData>();
    private _lastFetchedAt = '';

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
            // Skip IDLE conversations that haven't changed
            if (cached && t.status !== 'CASCADE_RUN_STATUS_RUNNING' && cached.totalSteps === t.stepCount) {
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
        return this._buildSummary();
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
            conversations.push(conv);

            for (const c of conv.calls) {
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

    /** Clear all cached data */
    reset(): void {
        this._cache.clear();
        this._lastFetchedAt = '';
    }
}

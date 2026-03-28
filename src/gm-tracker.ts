// ─── GM Tracker ──────────────────────────────────────────────────────────────
// Fetches generatorMetadata from GetCascadeTrajectoryGeneratorMetadata endpoint.
// Provides precise model attribution, performance metrics, and token usage
// — data that the existing activity-tracker.ts cannot access.
//
// This module is ADDITIVE — it does NOT modify any existing tracker logic.

import { LSInfo } from './discovery';
import { rpcCall } from './rpc-client';
import { getModelDisplayName, getQuotaPoolKey, normalizeModelDisplayName, type ModelConfig } from './models';
import type { QuotaSession } from './quota-tracker';

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

/** Token source breakdown group from chatStartMetadata.contextWindowMetadata.tokenBreakdown */
export interface TokenBreakdownGroup {
    name: string;     // e.g. "System Prompt", "Chat Messages"
    type: string;     // e.g. TOKEN_TYPE_SYSTEM_PROMPT
    tokens: number;
    children: { name: string; tokens: number }[];
}

export type GMModelAccuracy = 'exact' | 'placeholder';
export type GMPromptSource = 'none' | 'messagePrompts' | 'messageMetadata';

export interface GMUserMessageAnchor {
    stepIndex: number;
    text: string;
}

/** A single LLM invocation entry from generatorMetadata */
export interface GMCallEntry {
    stepIndices: number[];
    executionId: string;
    model: string;           // e.g. MODEL_PLACEHOLDER_M26
    modelDisplay: string;    // e.g. Claude Opus 4
    responseModel: string;   // e.g. claude-opus-4-6-thinking
    modelAccuracy: GMModelAccuracy;
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
    /** Best-effort prompt snippet recovered from GM payload */
    promptSnippet: string;
    /** Which GM field produced promptSnippet */
    promptSource: GMPromptSource;
    /** Number of messagePrompts entries if present */
    messagePromptCount: number;
    /** messageMetadata top-level keys */
    messageMetadataKeys: string[];
    /** responseHeader top-level keys */
    responseHeaderKeys: string[];
    /** Explicit user messages recovered from messagePrompts */
    userMessageAnchors: GMUserMessageAnchor[];
    /** Number of retries for this call */
    retries: number;
    /** Stop reason from plannerResponse (e.g. STOP_REASON_STOP_PATTERN) */
    stopReason: string;
    /** Retry overhead: total input tokens wasted across all retries */
    retryTokensIn: number;
    /** Retry overhead: total output tokens wasted across all retries */
    retryTokensOut: number;
    /** Retry overhead: total credits consumed by retries */
    retryCredits: number;
    /** Retry error messages */
    retryErrors: string[];
    /** Seconds since last LLM invocation */
    timeSinceLastInvocation: number;
    /** Token breakdown groups: context composition at call time */
    tokenBreakdownGroups: TokenBreakdownGroup[];
    /** chatStartMetadata.createdAt */
    createdAt: string;
    /** chatStartMetadata.latestStableMessageIndex */
    latestStableMessageIndex: number;
    /** chatStartMetadata.startStepIndex */
    startStepIndex: number;
    /** chatStartMetadata.checkpointIndex */
    checkpointIndex: number;
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
    /** Calls with exact responseModel */
    exactCallCount: number;
    /** Calls that only expose placeholder model IDs */
    placeholderOnlyCalls: number;
}

/** Per-conversation GM data */
export interface GMConversationData {
    cascadeId: string;
    title: string;
    totalSteps: number;
    calls: GMCallEntry[];
    /** Max calls observed for this conversation across rewinds/reloads. */
    lifetimeCalls?: number;
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
    /** Global retry overhead: total tokens wasted (input + output) */
    totalRetryTokens: number;
    /** Global retry overhead: credits consumed */
    totalRetryCredits: number;
    /** Global retry count */
    totalRetryCount: number;
    /** Latest token breakdown snapshot (from most recent GM entry) */
    latestTokenBreakdown: TokenBreakdownGroup[];
    /** Stop reason distribution: reason → count */
    stopReasonCounts: Record<string, number>;
}

/** Serialized form for globalState persistence */
export interface GMTrackerState {
    version: 1;
    summary: GMSummary;
    /** cascadeId → stepCount baselines to skip unchanged IDLE conversations */
    baselines: Record<string, number>;
    /** cascadeId → call count baselines to isolate quota cycles (added v1.13.2) */
    callBaselines?: Record<string, number>;
    /** executionIds of calls archived to dailyStore by per-pool resets (added v1.13.4) */
    archivedCallIds?: string[];
    /** Model ID → ISO cutoff timestamp: calls created before cutoff are excluded (added v1.14.0) */
    archivedModelCutoffs?: Record<string, string>;
}

export function filterGMSummaryByModels(
    summary: GMSummary | null | undefined,
    modelIds: string[],
): GMSummary | null {
    if (!summary || modelIds.length === 0) {
        return null;
    }

    const modelSet = new Set(modelIds);
    const conversations: GMConversationData[] = [];
    const modelBreakdown: Record<string, GMModelStats> = {};
    const stopReasonCounts: Record<string, number> = {};
    const contextGrowth: { step: number; tokens: number; model: string }[] = [];

    let totalCalls = 0;
    let totalStepsCovered = 0;
    let totalCredits = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalThinkingTokens = 0;
    let totalRetryTokens = 0;
    let totalRetryCredits = 0;
    let totalRetryCount = 0;
    let latestTokenBreakdown: TokenBreakdownGroup[] = [];

    for (const conversation of summary.conversations) {
        const matchingCalls = conversation.calls.filter(call => modelSet.has(call.model));
        if (matchingCalls.length === 0) {
            continue;
        }

        const calls = matchingCalls.map(call => ({
            ...call,
            modelDisplay: normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model,
        }));

        const coveredSteps = calls.reduce((sum, call) => sum + call.stepIndices.length, 0);
        conversations.push({
            ...conversation,
            calls,
            lifetimeCalls: calls.length,
            coveredSteps,
            coverageRate: conversation.totalSteps > 0 ? coveredSteps / conversation.totalSteps : 0,
        });

        for (const call of calls) {
            const normalizedDisplay = normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model;
            totalCalls++;
            totalStepsCovered += call.stepIndices.length;
            totalCredits += call.credits;
            totalInputTokens += call.inputTokens;
            totalOutputTokens += call.outputTokens;
            totalCacheRead += call.cacheReadTokens;
            totalCacheCreation += call.cacheCreationTokens;
            totalThinkingTokens += call.thinkingTokens;
            totalRetryTokens += call.retryTokensIn + call.retryTokensOut;
            totalRetryCredits += call.retryCredits;
            if (call.retries > 0) {
                totalRetryCount++;
            }
            if (call.contextTokensUsed > 0 && call.stepIndices.length > 0) {
                contextGrowth.push({
                    step: call.stepIndices[0],
                    tokens: call.contextTokensUsed,
                    model: normalizedDisplay || call.modelDisplay,
                });
            }
            if (call.stopReason) {
                const stopReason = call.stopReason.replace('STOP_REASON_', '');
                stopReasonCounts[stopReason] = (stopReasonCounts[stopReason] || 0) + 1;
            }
            if (call.tokenBreakdownGroups.length > 0) {
                latestTokenBreakdown = call.tokenBreakdownGroups;
            }

            const key = normalizedDisplay || call.modelDisplay || call.model;
            const existing = modelBreakdown[key];
            if (existing) {
                const ttftSamples = existing.callCount;
                existing.callCount += 1;
                existing.stepsCovered += call.stepIndices.length;
                existing.totalInputTokens += call.inputTokens;
                existing.totalOutputTokens += call.outputTokens;
                existing.totalThinkingTokens += call.thinkingTokens;
                existing.totalCacheRead += call.cacheReadTokens;
                existing.totalCacheCreation += call.cacheCreationTokens;
                existing.totalCredits += call.credits;
                existing.avgTTFT = call.ttftSeconds > 0
                    ? ((existing.avgTTFT * ttftSamples) + call.ttftSeconds) / (ttftSamples + 1)
                    : existing.avgTTFT;
                existing.minTTFT = existing.minTTFT > 0
                    ? Math.min(existing.minTTFT, call.ttftSeconds || existing.minTTFT)
                    : call.ttftSeconds;
                existing.maxTTFT = Math.max(existing.maxTTFT, call.ttftSeconds);
                existing.avgStreaming = call.streamingSeconds > 0
                    ? ((existing.avgStreaming * ttftSamples) + call.streamingSeconds) / (ttftSamples + 1)
                    : existing.avgStreaming;
                const cacheHitCalls = Math.round(existing.cacheHitRate * ttftSamples) + (call.cacheReadTokens > 0 ? 1 : 0);
                existing.cacheHitRate = existing.callCount > 0 ? cacheHitCalls / existing.callCount : 0;
                if (call.responseModel) {
                    existing.responseModel = call.responseModel;
                }
                if (call.apiProvider) {
                    existing.apiProvider = call.apiProvider;
                }
                if (call.completionConfig) {
                    existing.completionConfig = call.completionConfig;
                }
                existing.hasSystemPrompt = existing.hasSystemPrompt || !!call.systemPromptSnippet;
                existing.toolCount = Math.max(existing.toolCount, call.toolCount);
                if (call.promptSectionTitles.length > existing.promptSectionTitles.length) {
                    existing.promptSectionTitles = call.promptSectionTitles;
                }
                existing.totalRetries += call.retries;
                if (call.hasError) {
                    existing.errorCount += 1;
                }
                if (call.modelAccuracy === 'exact') {
                    existing.exactCallCount += 1;
                } else {
                    existing.placeholderOnlyCalls += 1;
                }
                continue;
            }

            modelBreakdown[key] = {
                callCount: 1,
                stepsCovered: call.stepIndices.length,
                totalInputTokens: call.inputTokens,
                totalOutputTokens: call.outputTokens,
                totalThinkingTokens: call.thinkingTokens,
                totalCacheRead: call.cacheReadTokens,
                totalCacheCreation: call.cacheCreationTokens,
                totalCredits: call.credits,
                avgTTFT: call.ttftSeconds,
                minTTFT: call.ttftSeconds,
                maxTTFT: call.ttftSeconds,
                avgStreaming: call.streamingSeconds,
                cacheHitRate: call.cacheReadTokens > 0 ? 1 : 0,
                responseModel: call.responseModel,
                apiProvider: call.apiProvider,
                completionConfig: call.completionConfig,
                hasSystemPrompt: !!call.systemPromptSnippet,
                toolCount: call.toolCount,
                promptSectionTitles: call.promptSectionTitles,
                totalRetries: call.retries,
                errorCount: call.hasError ? 1 : 0,
                exactCallCount: call.modelAccuracy === 'exact' ? 1 : 0,
                placeholderOnlyCalls: call.modelAccuracy === 'placeholder' ? 1 : 0,
            };
        }
    }

    if (totalCalls === 0) {
        return null;
    }

    conversations.sort((a, b) => b.totalSteps - a.totalSteps);
    contextGrowth.sort((a, b) => a.step - b.step);

    return {
        conversations,
        modelBreakdown,
        totalCalls,
        totalStepsCovered,
        totalCredits,
        totalInputTokens,
        totalOutputTokens,
        totalCacheRead,
        totalCacheCreation,
        totalThinkingTokens,
        contextGrowth,
        fetchedAt: summary.fetchedAt,
        totalRetryTokens,
        totalRetryCredits,
        totalRetryCount,
        latestTokenBreakdown,
        stopReasonCounts,
    };
}

function mergeGMModelStats(target: GMModelStats, source: GMModelStats): void {
    const targetCallsBefore = target.callCount;
    const sourceCalls = source.callCount;
    const totalCalls = targetCallsBefore + sourceCalls;

    target.callCount = totalCalls;
    target.stepsCovered += source.stepsCovered;
    target.totalInputTokens += source.totalInputTokens;
    target.totalOutputTokens += source.totalOutputTokens;
    target.totalThinkingTokens += source.totalThinkingTokens;
    target.totalCacheRead += source.totalCacheRead;
    target.totalCacheCreation += source.totalCacheCreation;
    target.totalCredits += source.totalCredits;
    target.minTTFT = target.minTTFT > 0 && source.minTTFT > 0
        ? Math.min(target.minTTFT, source.minTTFT)
        : Math.max(target.minTTFT, source.minTTFT);
    target.maxTTFT = Math.max(target.maxTTFT, source.maxTTFT);
    target.avgTTFT = totalCalls > 0
        ? ((target.avgTTFT * targetCallsBefore) + (source.avgTTFT * sourceCalls)) / totalCalls
        : 0;
    target.avgStreaming = totalCalls > 0
        ? ((target.avgStreaming * targetCallsBefore) + (source.avgStreaming * sourceCalls)) / totalCalls
        : 0;
    const targetCacheHits = Math.round(target.cacheHitRate * targetCallsBefore);
    const sourceCacheHits = Math.round(source.cacheHitRate * sourceCalls);
    target.cacheHitRate = totalCalls > 0 ? (targetCacheHits + sourceCacheHits) / totalCalls : 0;
    if (source.responseModel) { target.responseModel = source.responseModel; }
    if (source.apiProvider) { target.apiProvider = source.apiProvider; }
    if (source.completionConfig) { target.completionConfig = source.completionConfig; }
    target.hasSystemPrompt = target.hasSystemPrompt || source.hasSystemPrompt;
    target.toolCount = Math.max(target.toolCount, source.toolCount);
    if (source.promptSectionTitles.length > target.promptSectionTitles.length) {
        target.promptSectionTitles = [...source.promptSectionTitles];
    }
    target.totalRetries += source.totalRetries;
    target.errorCount += source.errorCount;
    target.exactCallCount += source.exactCallCount;
    target.placeholderOnlyCalls += source.placeholderOnlyCalls;
}

function normalizeGMSummary(summary: GMSummary): GMSummary {
    const normalizedConversations = summary.conversations.map(conversation => ({
        ...conversation,
        calls: conversation.calls.map(call => ({
            ...call,
            modelDisplay: normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model,
        })),
    }));

    const modelBreakdown: Record<string, GMModelStats> = {};
    for (const [name, stats] of Object.entries(summary.modelBreakdown)) {
        const key = normalizeModelDisplayName(name) || name;
        const existing = modelBreakdown[key];
        if (existing) {
            mergeGMModelStats(existing, stats);
        } else {
            modelBreakdown[key] = {
                ...stats,
                promptSectionTitles: [...stats.promptSectionTitles],
                completionConfig: stats.completionConfig ? { ...stats.completionConfig } : null,
            };
        }
    }

    return {
        ...summary,
        conversations: normalizedConversations,
        modelBreakdown,
        contextGrowth: summary.contextGrowth.map(point => ({
            ...point,
            model: normalizeModelDisplayName(point.model) || point.model,
        })),
        latestTokenBreakdown: cloneTokenBreakdownGroups(summary.latestTokenBreakdown),
        stopReasonCounts: { ...summary.stopReasonCounts },
    };
}

function buildSummaryFromConversations(
    inputConversations: GMConversationData[],
    fetchedAt: string,
): GMSummary | null {
    const conversations: GMConversationData[] = [];
    const modelBreakdown: Record<string, GMModelStats> = {};
    const stopReasonCounts: Record<string, number> = {};
    const contextGrowth: { step: number; tokens: number; model: string }[] = [];

    let totalCalls = 0;
    let totalStepsCovered = 0;
    let totalCredits = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalThinkingTokens = 0;
    let totalRetryTokens = 0;
    let totalRetryCredits = 0;
    let totalRetryCount = 0;
    let latestTokenBreakdown: TokenBreakdownGroup[] = [];

    for (const conversation of inputConversations) {
        if (conversation.calls.length === 0) { continue; }
        const calls = conversation.calls.map(call => ({
            ...call,
            modelDisplay: normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model,
        }));
        const coveredSteps = calls.reduce((sum, call) => sum + call.stepIndices.length, 0);
        conversations.push({
            ...conversation,
            calls,
            coveredSteps,
            coverageRate: conversation.totalSteps > 0 ? coveredSteps / conversation.totalSteps : 0,
        });

        for (const call of calls) {
            const normalizedDisplay = normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model;
            totalCalls++;
            totalStepsCovered += call.stepIndices.length;
            totalCredits += call.credits;
            totalInputTokens += call.inputTokens;
            totalOutputTokens += call.outputTokens;
            totalCacheRead += call.cacheReadTokens;
            totalCacheCreation += call.cacheCreationTokens;
            totalThinkingTokens += call.thinkingTokens;
            totalRetryTokens += call.retryTokensIn + call.retryTokensOut;
            totalRetryCredits += call.retryCredits;
            if (call.retries > 0) {
                totalRetryCount++;
            }
            if (call.contextTokensUsed > 0 && call.stepIndices.length > 0) {
                contextGrowth.push({
                    step: call.stepIndices[0],
                    tokens: call.contextTokensUsed,
                    model: normalizedDisplay || call.modelDisplay,
                });
            }
            if (call.stopReason) {
                const stopReason = call.stopReason.replace('STOP_REASON_', '');
                stopReasonCounts[stopReason] = (stopReasonCounts[stopReason] || 0) + 1;
            }
            if (call.tokenBreakdownGroups.length > 0) {
                latestTokenBreakdown = call.tokenBreakdownGroups;
            }

            const key = normalizedDisplay || call.modelDisplay || call.model;
            const existing = modelBreakdown[key];
            if (existing) {
                mergeGMModelStats(existing, {
                    callCount: 1,
                    stepsCovered: call.stepIndices.length,
                    totalInputTokens: call.inputTokens,
                    totalOutputTokens: call.outputTokens,
                    totalThinkingTokens: call.thinkingTokens,
                    totalCacheRead: call.cacheReadTokens,
                    totalCacheCreation: call.cacheCreationTokens,
                    totalCredits: call.credits,
                    avgTTFT: call.ttftSeconds,
                    minTTFT: call.ttftSeconds,
                    maxTTFT: call.ttftSeconds,
                    avgStreaming: call.streamingSeconds,
                    cacheHitRate: call.cacheReadTokens > 0 ? 1 : 0,
                    responseModel: call.responseModel,
                    apiProvider: call.apiProvider,
                    completionConfig: call.completionConfig,
                    hasSystemPrompt: !!call.systemPromptSnippet,
                    toolCount: call.toolCount,
                    promptSectionTitles: call.promptSectionTitles,
                    totalRetries: call.retries,
                    errorCount: call.hasError ? 1 : 0,
                    exactCallCount: call.modelAccuracy === 'exact' ? 1 : 0,
                    placeholderOnlyCalls: call.modelAccuracy === 'placeholder' ? 1 : 0,
                });
            } else {
                modelBreakdown[key] = {
                    callCount: 1,
                    stepsCovered: call.stepIndices.length,
                    totalInputTokens: call.inputTokens,
                    totalOutputTokens: call.outputTokens,
                    totalThinkingTokens: call.thinkingTokens,
                    totalCacheRead: call.cacheReadTokens,
                    totalCacheCreation: call.cacheCreationTokens,
                    totalCredits: call.credits,
                    avgTTFT: call.ttftSeconds,
                    minTTFT: call.ttftSeconds,
                    maxTTFT: call.ttftSeconds,
                    avgStreaming: call.streamingSeconds,
                    cacheHitRate: call.cacheReadTokens > 0 ? 1 : 0,
                    responseModel: call.responseModel,
                    apiProvider: call.apiProvider,
                    completionConfig: call.completionConfig,
                    hasSystemPrompt: !!call.systemPromptSnippet,
                    toolCount: call.toolCount,
                    promptSectionTitles: call.promptSectionTitles,
                    totalRetries: call.retries,
                    errorCount: call.hasError ? 1 : 0,
                    exactCallCount: call.modelAccuracy === 'exact' ? 1 : 0,
                    placeholderOnlyCalls: call.modelAccuracy === 'placeholder' ? 1 : 0,
                };
            }
        }
    }

    if (totalCalls === 0) { return null; }

    conversations.sort((a, b) => b.totalSteps - a.totalSteps);
    contextGrowth.sort((a, b) => a.step - b.step);

    return {
        conversations,
        modelBreakdown,
        totalCalls,
        totalStepsCovered,
        totalCredits,
        totalInputTokens,
        totalOutputTokens,
        totalCacheRead,
        totalCacheCreation,
        totalThinkingTokens,
        contextGrowth,
        fetchedAt,
        totalRetryTokens,
        totalRetryCredits,
        totalRetryCount,
        latestTokenBreakdown,
        stopReasonCounts,
    };
}

function cloneTokenBreakdownGroups(groups: TokenBreakdownGroup[]): TokenBreakdownGroup[] {
    return groups.map(group => ({
        ...group,
        children: group.children.map(child => ({ ...child })),
    }));
}

function cloneGMCallEntry(call: GMCallEntry): GMCallEntry {
    return {
        ...call,
        stepIndices: [...call.stepIndices],
        toolNames: [...call.toolNames],
        promptSectionTitles: [...call.promptSectionTitles],
        messageMetadataKeys: [...call.messageMetadataKeys],
        responseHeaderKeys: [...call.responseHeaderKeys],
        userMessageAnchors: call.userMessageAnchors.map(anchor => ({ ...anchor })),
        retryErrors: [...call.retryErrors],
        tokenBreakdownGroups: cloneTokenBreakdownGroups(call.tokenBreakdownGroups),
        completionConfig: call.completionConfig ? { ...call.completionConfig } : null,
    };
}

function cloneConversationData(conversation: GMConversationData): GMConversationData {
    return {
        ...conversation,
        calls: conversation.calls.map(cloneGMCallEntry),
    };
}

// ─── Parser Helpers ──────────────────────────────────────────────────────────

function parseDuration(s: unknown): number {
    if (typeof s === 'number') { return s; }
    if (!s || typeof s !== 'string') { return 0; }
    const n = parseFloat(s.replace('s', ''));
    return isNaN(n) ? 0 : n;
}

function parseInt0(s: unknown): number {
    if (typeof s === 'number') { return Math.round(s); }
    if (!s) { return 0; }
    const n = parseInt(String(s), 10);
    return isNaN(n) ? 0 : n;
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        if (!value || seen.has(value)) { continue; }
        seen.add(value);
        out.push(value);
    }
    return out;
}

function collectStringLeaves(
    value: unknown,
    prefix: string,
    out: Array<{ path: string; value: string }>,
    depth = 0,
): void {
    if (depth > 4 || value === null || value === undefined) { return; }
    if (typeof value === 'string') {
        const trimmed = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (trimmed.length > 0) {
            out.push({ path: prefix, value: trimmed });
        }
        return;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 6); i++) {
            collectStringLeaves(value[i], `${prefix}[${i}]`, out, depth + 1);
        }
        return;
    }
    if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            collectStringLeaves(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
        }
    }
}

function pickPromptSnippet(value: unknown): string {
    const strings: Array<{ path: string; value: string }> = [];
    collectStringLeaves(value, '', strings);
    if (strings.length === 0) { return ''; }

    const preferred = [
        'text',
        'content',
        'message',
        'prompt',
        'summary',
        'query',
        'command',
        'task',
        'title',
        'name',
        'path',
    ];

    const filtered = strings
        .filter(entry => {
            const lowerPath = entry.path.toLowerCase();
            const lowerValue = entry.value.toLowerCase();
            if (lowerPath.includes('systemprompt')) { return false; }
            if (lowerPath.includes('checksum')) { return false; }
            if (lowerValue.startsWith('http://') || lowerValue.startsWith('https://')) { return false; }
            return entry.value.length >= 8;
        })
        .sort((a, b) => {
            const aScore = preferred.findIndex(token => a.path.toLowerCase().includes(token));
            const bScore = preferred.findIndex(token => b.path.toLowerCase().includes(token));
            const aRank = aScore === -1 ? 999 : aScore;
            const bRank = bScore === -1 ? 999 : bScore;
            if (aRank !== bRank) { return aRank - bRank; }
            return b.value.length - a.value.length;
        });

    return filtered[0]?.value || '';
}

function cleanUserPromptText(prompt: string): string {
    return prompt
        .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, ' ')
        .replace(/<USER_REQUEST>/gi, ' ')
        .replace(/<\/USER_REQUEST>/gi, ' ')
        .replace(/Step Id:\s*\d+/gi, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractUserMessageAnchors(messagePrompts: unknown): GMUserMessageAnchor[] {
    if (!Array.isArray(messagePrompts)) { return []; }
    const anchors: GMUserMessageAnchor[] = [];
    const seen = new Set<number>();

    for (const item of messagePrompts) {
        if (!item || typeof item !== 'object') { continue; }
        const prompt = String((item as Record<string, unknown>).prompt || '');
        const source = String((item as Record<string, unknown>).source || '');
        if (!prompt) { continue; }

        const explicit = prompt.match(/Step Id:\s*(\d+)[\s\S]*?<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
        if (explicit) {
            const stepIndex = parseInt0(explicit[1]);
            const text = cleanUserPromptText(explicit[2]);
            if (stepIndex > 0 && text && !seen.has(stepIndex)) {
                anchors.push({ stepIndex, text });
                seen.add(stepIndex);
            }
            continue;
        }

        if (source !== 'CHAT_MESSAGE_SOURCE_USER') { continue; }
        if (/^<(user_information|mcp_servers|artifacts|conversation_history|system_prompt|tools?)>/i.test(prompt.trim())) {
            continue;
        }
        const generic = prompt.match(/Step Id:\s*(\d+)\s*([\s\S]*)/i);
        if (!generic) { continue; }
        const stepIndex = parseInt0(generic[1]);
        const text = cleanUserPromptText(generic[2]);
        if (stepIndex > 0 && text && !seen.has(stepIndex)) {
            anchors.push({ stepIndex, text });
            seen.add(stepIndex);
        }
    }

    anchors.sort((a, b) => a.stepIndex - b.stepIndex);
    return anchors;
}

function extractPromptData(cm: Record<string, unknown>): {
    promptSnippet: string;
    promptSource: GMPromptSource;
    messagePromptCount: number;
    messageMetadataKeys: string[];
    responseHeaderKeys: string[];
    userMessageAnchors: GMUserMessageAnchor[];
} {
    const messagePrompts = cm.messagePrompts;
    const messageMetadata = cm.messageMetadata;
    const responseHeader = cm.responseHeader;
    const userMessageAnchors = extractUserMessageAnchors(messagePrompts);

    const fromPrompts = pickPromptSnippet(messagePrompts);
    if (fromPrompts) {
        return {
            promptSnippet: fromPrompts,
            promptSource: 'messagePrompts',
            messagePromptCount: Array.isArray(messagePrompts) ? messagePrompts.length : 0,
            messageMetadataKeys: messageMetadata && typeof messageMetadata === 'object' && !Array.isArray(messageMetadata)
                ? Object.keys(messageMetadata as Record<string, unknown>)
                : [],
            responseHeaderKeys: responseHeader && typeof responseHeader === 'object' && !Array.isArray(responseHeader)
                ? Object.keys(responseHeader as Record<string, unknown>)
                : [],
            userMessageAnchors,
        };
    }

    const fromMetadata = pickPromptSnippet(messageMetadata);
    return {
        promptSnippet: fromMetadata,
        promptSource: fromMetadata ? 'messageMetadata' : 'none',
        messagePromptCount: Array.isArray(messagePrompts) ? messagePrompts.length : 0,
        messageMetadataKeys: messageMetadata && typeof messageMetadata === 'object' && !Array.isArray(messageMetadata)
            ? Object.keys(messageMetadata as Record<string, unknown>)
            : [],
        responseHeaderKeys: responseHeader && typeof responseHeader === 'object' && !Array.isArray(responseHeader)
            ? Object.keys(responseHeader as Record<string, unknown>)
            : [],
        userMessageAnchors,
    };
}

function buildGMMatchKey(call: Pick<GMCallEntry, 'executionId' | 'stepIndices' | 'model' | 'responseModel'>): string {
    if (call.executionId) {
        return `exec:${call.executionId}`;
    }
    return `steps:${call.stepIndices.join(',')}|model:${call.responseModel || call.model}`;
}

function buildGMArchiveKey(call: Pick<GMCallEntry, 'stepIndices' | 'model' | 'responseModel' | 'createdAt'>): string {
    return `steps:${call.stepIndices.join(',')}|model:${call.responseModel || call.model}|created:${call.createdAt || ''}`;
}

function mergeGMCallEntries(primary: GMCallEntry, fallback: GMCallEntry): GMCallEntry {
    const useFallbackPrompt = !primary.promptSnippet && !!fallback.promptSnippet;
    return {
        ...primary,
        responseModel: primary.responseModel || fallback.responseModel,
        modelAccuracy: primary.responseModel || fallback.responseModel ? 'exact' : primary.modelAccuracy,
        systemPromptSnippet: primary.systemPromptSnippet || fallback.systemPromptSnippet,
        toolCount: Math.max(primary.toolCount, fallback.toolCount),
        toolNames: uniqueStrings([...primary.toolNames, ...fallback.toolNames]),
        promptSectionTitles: primary.promptSectionTitles.length >= fallback.promptSectionTitles.length
            ? primary.promptSectionTitles
            : fallback.promptSectionTitles,
        promptSnippet: useFallbackPrompt ? fallback.promptSnippet : primary.promptSnippet,
        promptSource: useFallbackPrompt ? fallback.promptSource : primary.promptSource,
        messagePromptCount: Math.max(primary.messagePromptCount, fallback.messagePromptCount),
        messageMetadataKeys: primary.messageMetadataKeys.length > 0
            ? primary.messageMetadataKeys
            : fallback.messageMetadataKeys,
        responseHeaderKeys: primary.responseHeaderKeys.length > 0
            ? primary.responseHeaderKeys
            : fallback.responseHeaderKeys,
        userMessageAnchors: primary.userMessageAnchors.length > 0
            ? primary.userMessageAnchors
            : fallback.userMessageAnchors,
        stopReason: primary.stopReason || fallback.stopReason,
        createdAt: primary.createdAt || fallback.createdAt,
        latestStableMessageIndex: primary.latestStableMessageIndex || fallback.latestStableMessageIndex,
        startStepIndex: primary.startStepIndex || fallback.startStepIndex,
        checkpointIndex: primary.checkpointIndex || fallback.checkpointIndex,
    };
}

function maybeEnrichCallsFromTrajectory(calls: GMCallEntry[], embeddedCalls: GMCallEntry[]): GMCallEntry[] {
    if (calls.length === 0 || embeddedCalls.length === 0) { return calls; }
    const embeddedByKey = new Map<string, GMCallEntry>();
    for (const call of embeddedCalls) {
        embeddedByKey.set(buildGMMatchKey(call), call);
    }
    return calls.map(call => {
        const embedded = embeddedByKey.get(buildGMMatchKey(call));
        return embedded ? mergeGMCallEntries(call, embedded) : call;
    });
}

function shouldEnrichConversation(stepCount: number, calls: GMCallEntry[]): boolean {
    if (calls.some(call => call.modelAccuracy === 'placeholder')) {
        return true;
    }
    return stepCount >= 350;
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
    const responseModel = (cm.responseModel as string) || '';
    const modelAccuracy: GMModelAccuracy = responseModel ? 'exact' : 'placeholder';

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
    const promptData = extractPromptData(cm);

    const retries = parseInt0(cm.retries as string);
    const errorMessage = (gm.error as string) || '';

    // ── retryInfos aggregation ─────────────────────────────────────────────
    let retryTokensIn = 0, retryTokensOut = 0, retryCredits = 0;
    const retryErrors: string[] = [];
    const retryInfos = cm.retryInfos as Record<string, unknown>[] | undefined;
    if (Array.isArray(retryInfos)) {
        for (const ri of retryInfos) {
            const ru = (ri.usage || {}) as Record<string, unknown>;
            retryTokensIn += parseInt0(ru.inputTokens as string);
            retryTokensOut += parseInt0(ru.outputTokens as string);
            const rCredits = ri.consumedCredits as Record<string, string>[] | undefined;
            if (Array.isArray(rCredits)) {
                for (const rc of rCredits) { retryCredits += parseInt0(rc.creditAmount); }
            }
            const errMsg = ri.error as string;
            if (errMsg) { retryErrors.push(errMsg.substring(0, 120)); }
        }
    }

    // ── stopReason ─────────────────────────────────────────────────────────
    const stopReason = (cm.stopReason as string) || '';

    // ── timeSinceLastInvocation ────────────────────────────────────────────
    const timeSinceLastInvocation = parseDuration(csm.timeSinceLastInvocation as string);

    // ── tokenBreakdown groups ─────────────────────────────────────────────
    const tokenBreakdownGroups: TokenBreakdownGroup[] = [];
    const tb = (cwm.tokenBreakdown || {}) as Record<string, unknown>;
    const tbGroups = (tb.groups || []) as Record<string, unknown>[];
    for (const g of tbGroups) {
        const children = ((g.children || []) as Record<string, unknown>[]).map(c => ({
            name: (c.name as string) || '',
            tokens: typeof c.numTokens === 'number' ? c.numTokens : parseInt0(c.numTokens as string),
        }));
        tokenBreakdownGroups.push({
            name: (g.name as string) || '',
            type: (g.type as string) || '',
            tokens: typeof g.numTokens === 'number' ? g.numTokens : parseInt0(g.numTokens as string),
            children,
        });
    }

    return {
        stepIndices: (gm.stepIndices as number[]) || [],
        executionId: (gm.executionId as string) || '',
        model: modelId,
        modelDisplay: normalizeModelDisplayName(modelId || ''),
        responseModel,
        modelAccuracy,
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
        promptSnippet: promptData.promptSnippet,
        promptSource: promptData.promptSource,
        messagePromptCount: promptData.messagePromptCount,
        messageMetadataKeys: promptData.messageMetadataKeys,
        responseHeaderKeys: promptData.responseHeaderKeys,
        userMessageAnchors: promptData.userMessageAnchors,
        retries,
        stopReason,
        retryTokensIn,
        retryTokensOut,
        retryCredits,
        retryErrors,
        timeSinceLastInvocation,
        tokenBreakdownGroups,
        createdAt: (csm.createdAt as string) || '',
        latestStableMessageIndex: parseInt0(csm.latestStableMessageIndex),
        startStepIndex: parseInt0(csm.startStepIndex),
        checkpointIndex: parseInt0(csm.checkpointIndex),
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
    /** executionIds of calls already archived by per-pool resets — excluded from _buildSummary() */
    private _archivedCallIds = new Set<string>();
    /** Model ID → ISO cutoff: calls with createdAt ≤ cutoff are excluded — survives empty _cache.calls */
    private _archivedModelCutoffs = new Map<string, string>();

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
            const activeCalls = (hasCallFilter || hasModelFilter)
                ? sliced.filter(c => {
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
            const activeStepsCovered = activeCalls.reduce((sum, c) => sum + c.stepIndices.length, 0);
            conversations.push({
                ...conv,
                calls: activeCalls,
                lifetimeCalls: conv.lifetimeCalls ?? conv.calls.length,
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
     * Per-pool reset: archive only calls from specified models.
     * When modelIds is empty/undefined, falls back to global reset (all calls).
     * Pre-reset snapshot is already archived to dailyStore.addCycle()
     * in extension.ts, so no data is lost.
     */
    reset(modelIds?: string[]): void {
        if (modelIds && modelIds.length > 0) {
            // ── Per-pool reset: only archive calls from specified models ──
            const modelSet = new Set(modelIds);
            // Always record model-level cutoff timestamps — effective even when
            // _cache.calls is empty (e.g. after serialize/restore strips calls).
            // Calls with createdAt ≤ cutoff are excluded; newer calls pass through.
            const cutoff = new Date().toISOString();
            for (const id of modelIds) {
                this._archivedModelCutoffs.set(id, cutoff);
            }
            for (const [, conv] of this._cache) {
                for (const c of conv.calls) {
                    if (modelSet.has(c.model) || modelSet.has(c.responseModel)) {
                        if (c.executionId) {
                            this._archivedCallIds.add(c.executionId);
                        }
                        this._archivedCallIds.add(buildGMArchiveKey(c));
                    }
                }
            }
            this._lastSummary = this._buildSummary();
            return;
        }
        // ── Global reset (fallback) ──
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
            });
        }
        this._archivedCallIds.clear();
        this._archivedModelCutoffs.clear();
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

        return tracker;
    }
}

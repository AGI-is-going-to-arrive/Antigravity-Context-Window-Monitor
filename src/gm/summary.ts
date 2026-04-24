// ─── GM Summary ──────────────────────────────────────────────────────────────
// Summary aggregation, filtering, normalization, and merge utilities.

import { normalizeModelDisplayName } from '../models';
import type {
    GMCallEntry,
    GMConversationData,
    GMModelStats,
    GMSummary,
    TokenBreakdownGroup,
} from './types';
import { cloneTokenBreakdownGroups } from './types';

/** Maximum number of recent error messages to keep */
const MAX_RECENT_ERRORS = 20;

/**
 * Parse an error message into a short error code for bucketing.
 * Examples:
 *   'RESOURCE_EXHAUSTED (code 429): You have...' → '429'
 *   'UNAVAILABLE (code 503): No capacity...'     → '503'
 *   'stream reading error: unexpected EOF...'     → 'stream_error'
 *   'INVALID_ARGUMENT (code 400): ...'            → '400'
 *   'unknown error message'                       → 'unknown'
 */
export function parseErrorCode(errorMsg: string): string {
    // Pattern: (code NNN)
    const codeMatch = errorMsg.match(/\(code\s+(\d{3})\)/);
    if (codeMatch) { return codeMatch[1]; }
    // Pattern: gRPC/HTTP status codes like RESOURCE_EXHAUSTED, UNAVAILABLE
    if (/RESOURCE_EXHAUSTED/i.test(errorMsg)) { return '429'; }
    if (/UNAVAILABLE/i.test(errorMsg)) { return '503'; }
    if (/INVALID_ARGUMENT/i.test(errorMsg)) { return '400'; }
    if (/PERMISSION_DENIED/i.test(errorMsg)) { return '403'; }
    if (/NOT_FOUND/i.test(errorMsg)) { return '404'; }
    if (/DEADLINE_EXCEEDED/i.test(errorMsg)) { return '504'; }
    if (/INTERNAL/i.test(errorMsg)) { return '500'; }
    // Stream errors
    if (/stream.*error|unexpected.*EOF/i.test(errorMsg)) { return 'stream_error'; }
    // Timeout
    if (/timeout/i.test(errorMsg)) { return 'timeout'; }
    return 'unknown';
}

/**
 * Normalize an error message for content-based deduplication.
 * Strips volatile parts (port numbers, reset wait times) while preserving
 * the semantic identity of the error. Two errors are considered the same
 * "kind" if their normalized forms match.
 *
 * Examples:
 *   'RESOURCE_EXHAUSTED ... reset after 0s.'      → same kind as 'reset after 19h22m14s.'
 *   'RESOURCE_EXHAUSTED ... reset after 3h12m38s.' → same kind as 'reset after 1s.'
 *   'write tcp 198.18.0.1:14266->...:443'          → same kind as '198.18.0.1:5167->...:443'
 *   'failed to read file: open e:/path/file1.txt'  → different from 'file2.txt'
 */
export function normalizeErrorMessage(msg: string): string {
    let result = msg
        // Normalize "Your quota will reset after Xh Ym Zs." — compound duration is volatile
        // Matches: "1s", "22m14s", "19h22m14s", "3h12m38s" etc.
        .replace(/reset after \d+[hms][\dhms]*/g, 'reset after <time>')
        // Normalize TCP source port: "198.18.0.1:14266->" → "198.18.0.1:PORT->"
        .replace(/(\d+\.\d+\.\d+\.\d+):\d+(->)/g, '$1:PORT$2')
        // Trim trailing whitespace for consistency
        .trim();
    // Collapse API-duplicated messages: "MSG.: MSG." → "MSG." or "MSG: MSG" → "MSG"
    // The API server sometimes returns the same error text doubled with ": " separator.
    // parser.ts already handles this with ".: " detection, but we add a fallback here
    // for messages that slip through (e.g. different separator patterns).
    // Scan ALL ": " positions (not just the first) because the message itself may contain ": ".
    let searchFrom = 0;
    while (searchFrom < result.length) {
        const colonIdx = result.indexOf(': ', searchFrom);
        if (colonIdx < 0 || colonIdx >= result.length - 2) { break; }
        const first = result.substring(0, colonIdx);
        const second = result.substring(colonIdx + 2);
        if (first === second) { result = first; break; }
        searchFrom = colonIdx + 2;
    }
    return result;
}

/** Aggregate retryErrors from a call into error code counts and recent errors list */
function aggregateRetryErrors(
    call: GMCallEntry,
    retryErrorCodes: Record<string, number>,
    recentErrors: string[],
): void {
    for (const errMsg of call.retryErrors) {
        const code = parseErrorCode(errMsg);
        retryErrorCodes[code] = (retryErrorCodes[code] || 0) + 1;
        if (recentErrors.length < MAX_RECENT_ERRORS) {
            recentErrors.push(errMsg);
        }
    }
    // Fallback: use top-level errorMessage only when retryErrors is empty
    if (call.hasError && call.errorMessage && call.retryErrors.length === 0) {
        const code = parseErrorCode(call.errorMessage);
        retryErrorCodes[code] = (retryErrorCodes[code] || 0) + 1;
        if (recentErrors.length < MAX_RECENT_ERRORS) {
            recentErrors.push(call.errorMessage);
        }
    }
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
    const toolCallCounts: Record<string, number> = {};
    const retryErrorCodes: Record<string, number> = {};
    const recentErrors: string[] = [];
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
        const matchingCalls = conversation.calls.filter(call =>
            modelSet.has(call.model)
        );
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
            checkpointSummaries: conversation.checkpointSummaries || [],
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
            // Aggregate error codes from retryErrors
            aggregateRetryErrors(call, retryErrorCodes, recentErrors);
            // Aggregate tool call counts from source summary (preserves existing counts)
            // Note: toolCallsByStep-based counting happens in _buildSummary();
            // here we just pass through any pre-computed counts from the source.
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
                if (call.credits > 0) { existing.creditCallCount = (existing.creditCallCount || 0) + 1; }
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
                if (call.credits > 0) { existing.creditCallCount = (existing.creditCallCount || 0) + 1; }
                if (call.modelAccuracy === 'exact') {
                    existing.exactCallCount += 1;
                } else {
                    existing.placeholderOnlyCalls += 1;
                }
                if (call.contextWindowCapacity > 0) { existing.contextWindowCapacity = call.contextWindowCapacity; }
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
                creditCallCount: call.credits > 0 ? 1 : 0,
                exactCallCount: call.modelAccuracy === 'exact' ? 1 : 0,
                placeholderOnlyCalls: call.modelAccuracy === 'placeholder' ? 1 : 0,
                contextWindowCapacity: call.contextWindowCapacity || 0,
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
        retryErrorCodes,
        recentErrors,
        toolCallCounts: Object.keys(toolCallCounts).length > 0
            ? toolCallCounts
            : { ...(summary.toolCallCounts || {}) },
    };
}

export function mergeGMModelStats(target: GMModelStats, source: GMModelStats): void {
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
    target.creditCallCount = (target.creditCallCount || 0) + (source.creditCallCount || 0);
    target.exactCallCount += source.exactCallCount;
    target.placeholderOnlyCalls += source.placeholderOnlyCalls;
    if (source.contextWindowCapacity > 0) { target.contextWindowCapacity = source.contextWindowCapacity; }
}

export function normalizeGMSummary(summary: GMSummary): GMSummary {
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
        retryErrorCodes: { ...(summary.retryErrorCodes || {}) },
        recentErrors: [...(summary.recentErrors || [])],
        toolCallCounts: { ...(summary.toolCallCounts || {}) },
    };
}

export function buildSummaryFromConversations(
    inputConversations: GMConversationData[],
    fetchedAt: string,
): GMSummary | null {
    const conversations: GMConversationData[] = [];
    const modelBreakdown: Record<string, GMModelStats> = {};
    const stopReasonCounts: Record<string, number> = {};
    const retryErrorCodes: Record<string, number> = {};
    const recentErrors: string[] = [];
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
            checkpointSummaries: conversation.checkpointSummaries || [],
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
            // Aggregate error codes from retryErrors
            aggregateRetryErrors(call, retryErrorCodes, recentErrors);
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
                    creditCallCount: call.credits > 0 ? 1 : 0,
                    exactCallCount: call.modelAccuracy === 'exact' ? 1 : 0,
                    placeholderOnlyCalls: call.modelAccuracy === 'placeholder' ? 1 : 0,
                    contextWindowCapacity: call.contextWindowCapacity || 0,
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
                    creditCallCount: call.credits > 0 ? 1 : 0,
                    exactCallCount: call.modelAccuracy === 'exact' ? 1 : 0,
                    placeholderOnlyCalls: call.modelAccuracy === 'placeholder' ? 1 : 0,
                    contextWindowCapacity: call.contextWindowCapacity || 0,
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
        retryErrorCodes,
        recentErrors,
        toolCallCounts: {},
    };
}

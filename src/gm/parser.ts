// ─── GM Parser ───────────────────────────────────────────────────────────────
// Parsing helpers, prompt extraction, and entry builder for GM data.

import { normalizeModelDisplayName } from '../models';
import type {
    GMCallEntry,
    GMCheckpointSummary,
    GMCompletionConfig,
    GMModelAccuracy,
    GMPromptSource,
    GMUserMessageAnchor,
    TokenBreakdownGroup,
} from './types';

// ─── Primitive Parsers ───────────────────────────────────────────────────────

export function parseDuration(s: unknown): number {
    if (typeof s === 'number') { return s; }
    if (!s || typeof s !== 'string') { return 0; }
    const n = parseFloat(s.replace('s', ''));
    return isNaN(n) ? 0 : n;
}

export function parseInt0(s: unknown): number {
    if (typeof s === 'number') { return Math.round(s); }
    if (!s) { return 0; }
    const n = parseInt(String(s), 10);
    return isNaN(n) ? 0 : n;
}

export function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        if (!value || seen.has(value)) { continue; }
        seen.add(value);
        out.push(value);
    }
    return out;
}

// ─── Prompt Extraction ───────────────────────────────────────────────────────

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

function tokenizePromptPath(path: string): string[] {
    return path
        .toLowerCase()
        .replace(/\[\d+\]/g, '.')
        .split('.')
        .filter(Boolean);
}

function isInternalPromptValue(value: string): boolean {
    const clean = value.trim();
    return /^bot-[0-9a-f-]{8,}$/i.test(clean)
        || /^toolu_[a-z0-9_-]{8,}$/i.test(clean)
        || /^req_vrtx_[a-z0-9_-]{8,}$/i.test(clean)
        || /^session-[0-9a-f-]{8,}$/i.test(clean);
}

export function pickPromptSnippet(value: unknown): string {
    const strings: Array<{ path: string; value: string }> = [];
    collectStringLeaves(value, '', strings);
    if (strings.length === 0) { return ''; }

    const preferred = [
        'text',
        'content',
        'prompt',
        'summary',
        'query',
        'command',
        'task',
        'title',
        'message',
        'description',
    ];

    const filtered = strings
        .filter(entry => {
            const lowerPath = entry.path.toLowerCase();
            const lowerValue = entry.value.toLowerCase();
            const pathTokens = tokenizePromptPath(lowerPath);
            const hasPreferredPath = preferred.some(token => pathTokens.some(part => part.includes(token)));
            if (lowerPath.includes('systemprompt')) { return false; }
            if (lowerPath.includes('checksum')) { return false; }
            if (pathTokens.some(part => part === 'messageid' || part === 'responseid' || part === 'sessionid' || part === 'executionid')) {
                return false;
            }
            if (lowerValue.startsWith('http://') || lowerValue.startsWith('https://')) { return false; }
            if (isInternalPromptValue(entry.value)) { return false; }
            if (!hasPreferredPath) { return false; }
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

// ─── User & AI Message Extraction ────────────────────────────────────────────

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

export function extractUserMessageAnchors(messagePrompts: unknown): GMUserMessageAnchor[] {
    const anchors: GMUserMessageAnchor[] = [];
    if (!Array.isArray(messagePrompts)) { return anchors; }

    for (const item of messagePrompts) {
        if (!item || typeof item !== 'object') { continue; }
        const rec = item as Record<string, unknown>;
        const source = String(rec.source || '');
        if (source !== 'CHAT_MESSAGE_SOURCE_USER') { continue; }

        const stepIdx = typeof rec.stepIdx === 'number' ? rec.stepIdx : -1;
        const prompt = String(rec.prompt || '');
        if (!prompt) { continue; }

        const cleaned = cleanUserPromptText(prompt);
        if (!cleaned || cleaned.length < 2) { continue; }

        const text = cleaned.length > 80 ? cleaned.substring(0, 77) + '...' : cleaned;
        anchors.push({ stepIndex: stepIdx, text });
    }
    return anchors;
}

/** Extract checkpoint summaries from {{ CHECKPOINT N }} messages in messagePrompts */
export function extractCheckpointSummaries(messagePrompts: unknown): GMCheckpointSummary[] {
    const summaries: GMCheckpointSummary[] = [];
    if (!Array.isArray(messagePrompts)) { return summaries; }

    for (const item of messagePrompts) {
        if (!item || typeof item !== 'object') { continue; }
        const rec = item as Record<string, unknown>;
        const source = String(rec.source || '');
        if (source !== 'CHAT_MESSAGE_SOURCE_USER') { continue; }

        const prompt = String(rec.prompt || '');
        const match = prompt.match(/\{\{\s*CHECKPOINT\s+(\d+)\s*\}\}/i);
        if (!match) { continue; }

        const checkpointNumber = parseInt(match[1], 10);
        const stepIndex = typeof rec.stepIdx === 'number' ? rec.stepIdx : -1;
        const tokens = typeof rec.numTokens === 'number' ? rec.numTokens : 0;

        // Extract ONLY from {{ CHECKPOINT N }} onwards — skip system preamble
        // (user_information, MCP servers, user_rules, workflows etc.)
        const cpStart = prompt.indexOf(match[0]);
        let summaryText = prompt.substring(cpStart).trim();

        // Cap length to avoid bloating UI with huge context dumps
        const MAX_CP_TEXT = 8000;
        if (summaryText.length > MAX_CP_TEXT) {
            summaryText = summaryText.substring(0, MAX_CP_TEXT) + '\n\n... (truncated)';
        }

        summaries.push({ checkpointNumber, stepIndex, tokens, fullText: summaryText });
    }
    return summaries;
}

/**
 * Extract AI response snippets from SYSTEM messages in messagePrompts,
 * keyed by their stepIdx (a direct field on each message entry).
 * This allows each GM call to look up its OWN specific AI response text.
 *
 * For tool-call-only steps (no prompt text), stores tool names as the snippet.
 * Confirmed via live-watcher: each entry has { source, prompt, stepIdx, toolCalls, ... }
 */
export function extractAISnippetsByStep(messagePrompts: unknown): Record<number, string> {
    const snippets: Record<number, string> = {};
    if (!Array.isArray(messagePrompts)) { return snippets; }

    for (const item of messagePrompts) {
        if (!item || typeof item !== 'object') { continue; }
        const rec = item as Record<string, unknown>;
        const source = String(rec.source || '');
        if (source !== 'CHAT_MESSAGE_SOURCE_SYSTEM') { continue; }

        const stepIdx = typeof rec.stepIdx === 'number' ? rec.stepIdx : -1;
        if (stepIdx < 0) { continue; }

        const prompt = String(rec.prompt || '');

        // Extract tool call names from SYSTEM message
        const toolCalls = rec.toolCalls as Array<Record<string, unknown>> | undefined;
        const toolNames = Array.isArray(toolCalls)
            ? toolCalls.map(tc => String(tc.name || '')).filter(n => n.length > 0)
            : [];

        // Clean prompt text
        const cleaned = prompt.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        const isToolResult = /^(File Path:|No results found|The command completed|Created file|The following changes)/i.test(cleaned);

        if (cleaned.length >= 1 && !isToolResult) {
            // Has meaningful text
            if (toolNames.length > 0) {
                const textPart = cleaned.length > 80 ? cleaned.substring(0, 77) + '...' : cleaned;
                snippets[stepIdx] = `${textPart}  🔧${toolNames.slice(0, 3).join(', ')}`;
            } else {
                snippets[stepIdx] = cleaned.length > 120 ? cleaned.substring(0, 117) + '...' : cleaned;
            }
        } else if (toolNames.length > 0) {
            // No text but has tool calls
            snippets[stepIdx] = `🔧 ${toolNames.join(', ')}`;
        }
    }
    return snippets;
}

/**
 * Extract AI-invoked tool call names from SYSTEM messages in messagePrompts,
 * keyed by stepIdx. Each entry contains the tool names the AI decided to call
 * at that particular step. Used for tool call frequency statistics.
 */
export function extractToolCallsByStep(messagePrompts: unknown): Record<number, string[]> {
    const result: Record<number, string[]> = {};
    if (!Array.isArray(messagePrompts)) { return result; }

    for (const item of messagePrompts) {
        if (!item || typeof item !== 'object') { continue; }
        const rec = item as Record<string, unknown>;
        if (String(rec.source || '') !== 'CHAT_MESSAGE_SOURCE_SYSTEM') { continue; }

        const stepIdx = typeof rec.stepIdx === 'number' ? rec.stepIdx : -1;
        if (stepIdx < 0) { continue; }

        const toolCalls = rec.toolCalls as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) { continue; }

        const names = toolCalls.map(tc => String(tc.name || '')).filter(n => n.length > 0);
        if (names.length > 0) {
            result[stepIdx] = names;
        }
    }
    return result;
}

export function extractPromptData(cm: Record<string, unknown>): {
    promptSnippet: string;
    promptSource: GMPromptSource;
    messagePromptCount: number;
    messageMetadataKeys: string[];
    responseHeaderKeys: string[];
    userMessageAnchors: GMUserMessageAnchor[];
    aiSnippetsByStep: Record<number, string>;
    checkpointSummaries: GMCheckpointSummary[];
    toolCallsByStep: Record<number, string[]>;
} {
    const messagePrompts = cm.messagePrompts;
    const messageMetadata = cm.messageMetadata;
    const responseHeader = cm.responseHeader;
    const userMessageAnchors = extractUserMessageAnchors(messagePrompts);
    const aiSnippetsByStep = extractAISnippetsByStep(messagePrompts);
    const checkpointSummaries = extractCheckpointSummaries(messagePrompts);
    const toolCallsByStep = extractToolCallsByStep(messagePrompts);

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
            aiSnippetsByStep,
            checkpointSummaries,
            toolCallsByStep,
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
        aiSnippetsByStep,
        checkpointSummaries,
        toolCallsByStep,
    };
}

// ─── Entry Parsing & Enrichment ──────────────────────────────────────────────

export function buildGMMatchKey(call: Pick<GMCallEntry, 'executionId' | 'stepIndices' | 'model' | 'responseModel'>): string {
    if (call.executionId) {
        return `exec:${call.executionId}`;
    }
    return `steps:${call.stepIndices.join(',')}|model:${call.responseModel || call.model}`;
}

export function buildGMArchiveKey(call: Pick<GMCallEntry, 'stepIndices' | 'model' | 'responseModel' | 'createdAt'>): string {
    return `steps:${call.stepIndices.join(',')}|model:${call.responseModel || call.model}|created:${call.createdAt || ''}`;
}

export function mergeGMCallEntries(primary: GMCallEntry, fallback: GMCallEntry): GMCallEntry {
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
        aiSnippetsByStep: Object.keys(primary.aiSnippetsByStep).length > 0
            ? primary.aiSnippetsByStep
            : fallback.aiSnippetsByStep,
        checkpointSummaries: primary.checkpointSummaries.length > 0
            ? primary.checkpointSummaries
            : fallback.checkpointSummaries,
        toolCallsByStep: Object.keys(primary.toolCallsByStep).length > 0
            ? primary.toolCallsByStep
            : fallback.toolCallsByStep,
        stopReason: primary.stopReason || fallback.stopReason,
        createdAt: primary.createdAt || fallback.createdAt,
        latestStableMessageIndex: primary.latestStableMessageIndex || fallback.latestStableMessageIndex,
        startStepIndex: primary.startStepIndex || fallback.startStepIndex,
        checkpointIndex: primary.checkpointIndex || fallback.checkpointIndex,
    };
}

export function maybeEnrichCallsFromTrajectory(calls: GMCallEntry[], embeddedCalls: GMCallEntry[]): GMCallEntry[] {
    if (calls.length === 0 || embeddedCalls.length === 0) { return calls; }
    const embeddedByKey = new Map<string, GMCallEntry>();
    for (const call of embeddedCalls) {
        embeddedByKey.set(buildGMMatchKey(call), call);
    }
    const merged = calls.map(call => {
        const embedded = embeddedByKey.get(buildGMMatchKey(call));
        return embedded ? mergeGMCallEntries(call, embedded) : call;
    });

    // Broadcast: only ONE embedded call typically has messagePrompts (→ aiSnippetsByStep).
    // Share the richest map across ALL calls so each can look up its own AI snippet.
    let richestSnippets: Record<number, string> = {};
    for (const call of [...merged, ...embeddedCalls]) {
        if (Object.keys(call.aiSnippetsByStep).length > Object.keys(richestSnippets).length) {
            richestSnippets = call.aiSnippetsByStep;
        }
    }
    if (Object.keys(richestSnippets).length > 0) {
        for (const call of merged) {
            if (Object.keys(call.aiSnippetsByStep).length < Object.keys(richestSnippets).length) {
                call.aiSnippetsByStep = richestSnippets;
            }
        }
    }

    // Broadcast: checkpoint summaries are conversation-level data.
    // Only ONE embedded call has messagePrompts → only that call has checkpointSummaries.
    // Share the richest set across ALL calls so deduplication at conversation level works.
    let richestCheckpoints: GMCheckpointSummary[] = [];
    for (const call of [...merged, ...embeddedCalls]) {
        if (call.checkpointSummaries.length > richestCheckpoints.length) {
            richestCheckpoints = call.checkpointSummaries;
        }
    }
    if (richestCheckpoints.length > 0) {
        for (const call of merged) {
            if (call.checkpointSummaries.length < richestCheckpoints.length) {
                call.checkpointSummaries = richestCheckpoints;
            }
        }
    }

    // Broadcast: toolCallsByStep for tool invocation statistics.
    let richestToolCalls: Record<number, string[]> = {};
    for (const call of [...merged, ...embeddedCalls]) {
        if (Object.keys(call.toolCallsByStep).length > Object.keys(richestToolCalls).length) {
            richestToolCalls = call.toolCallsByStep;
        }
    }
    if (Object.keys(richestToolCalls).length > 0) {
        for (const call of merged) {
            if (Object.keys(call.toolCallsByStep).length < Object.keys(richestToolCalls).length) {
                call.toolCallsByStep = richestToolCalls;
            }
        }
    }

    return merged;
}

export function shouldEnrichConversation(stepCount: number, calls: GMCallEntry[]): boolean {
    if (calls.some(call => call.modelAccuracy === 'placeholder')) {
        return true;
    }
    // Conversations with checkpoints have been context-compressed;
    // enrichment is needed to extract checkpoint summaries from messagePrompts
    // (only available in GetCascadeTrajectory, not the lightweight GM metadata API).
    if (calls.some(call => call.checkpointIndex > 0)) {
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

export function parseGMEntry(gm: Record<string, unknown>): GMCallEntry {
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

    let retries = parseInt0(cm.retries as string);
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
        // Derive retries from retryInfos when cm.retries is missing/zero.
        // retryInfos always includes the successful attempt (no error) as an entry,
        // so only count entries WITH errors as actual retries.
        if (retries === 0 && retryErrors.length > 0) {
            retries = retryErrors.length;
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
        aiSnippetsByStep: promptData.aiSnippetsByStep,
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
        checkpointSummaries: promptData.checkpointSummaries,
        toolCallsByStep: promptData.toolCallsByStep,
    };
}

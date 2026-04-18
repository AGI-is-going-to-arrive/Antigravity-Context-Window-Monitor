// ─── Activity Helpers ────────────────────────────────────────────────────────
// Standalone helper functions used by ActivityTracker and external consumers.

import { normalizeModelDisplayName } from '../models';
import { tBi } from '../i18n';
import type { GMCallEntry, GMModelStats } from '../gm-tracker';
import type { StepCategory, StepClassification, StepEvent, ModelActivityStats } from './types';

// ─── Step Type Classification ────────────────────────────────────────────────

const STEP_CATEGORIES: Record<string, StepClassification> = {
    'CORTEX_STEP_TYPE_PLANNER_RESPONSE': { icon: '🧠', label: 'reasoning', category: 'reasoning' },
    'CORTEX_STEP_TYPE_VIEW_FILE': { icon: '📄', label: 'view_file', category: 'tool' },
    'CORTEX_STEP_TYPE_CODE_ACTION': { icon: '✏️', label: 'code_action', category: 'tool' },
    'CORTEX_STEP_TYPE_RUN_COMMAND': { icon: '⚡', label: 'run_command', category: 'tool' },
    'CORTEX_STEP_TYPE_COMMAND_STATUS': { icon: '📟', label: 'cmd_status', category: 'tool' },
    'CORTEX_STEP_TYPE_SEND_COMMAND_INPUT': { icon: '⌨️', label: 'send_input', category: 'tool' },
    'CORTEX_STEP_TYPE_LIST_DIRECTORY': { icon: '📂', label: 'list_dir', category: 'tool' },
    'CORTEX_STEP_TYPE_FIND': { icon: '🔍', label: 'find', category: 'tool' },
    'CORTEX_STEP_TYPE_GREP_SEARCH': { icon: '🔎', label: 'grep_search', category: 'tool' },
    'CORTEX_STEP_TYPE_CODEBASE_SEARCH': { icon: '🗂️', label: 'code_search', category: 'tool' },
    'CORTEX_STEP_TYPE_MCP_TOOL': { icon: '🔌', label: 'mcp_tool', category: 'tool' },
    'CORTEX_STEP_TYPE_SEARCH_WEB': { icon: '🌐', label: 'search_web', category: 'tool' },
    'CORTEX_STEP_TYPE_READ_URL_CONTENT': { icon: '🌐', label: 'read_url', category: 'tool' },
    'CORTEX_STEP_TYPE_BROWSER_SUBAGENT': { icon: '🤖', label: 'browser', category: 'tool' },
    'CORTEX_STEP_TYPE_ERROR_MESSAGE': { icon: '❌', label: 'error', category: 'system' },
    'CORTEX_STEP_TYPE_USER_INPUT': { icon: '💬', label: 'user_input', category: 'user' },
    'CORTEX_STEP_TYPE_CHECKPOINT': { icon: '💾', label: 'checkpoint', category: 'system' },
    'CORTEX_STEP_TYPE_CONVERSATION_HISTORY': { icon: '📜', label: 'history', category: 'system' },
    'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS': { icon: '📚', label: 'knowledge', category: 'system' },
    'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE': { icon: '💨', label: 'ephemeral', category: 'system' },
    'CORTEX_STEP_TYPE_TASK_BOUNDARY': { icon: '📌', label: 'task_boundary', category: 'system' },
    'CORTEX_STEP_TYPE_NOTIFY_USER': { icon: '📢', label: 'notify_user', category: 'system' },
};

export function classifyStep(type: string): StepClassification {
    return STEP_CATEGORIES[type] || { icon: '❓', label: type.replace('CORTEX_STEP_TYPE_', ''), category: 'system' };
}

// ─── Utility Functions ───────────────────────────────────────────────────────

export function truncate(s: string, max: number): string {
    const clean = s.replace(/[\r\n]+/g, ' ').trim();
    return clean.length > max ? clean.substring(0, max - 3) + '...' : clean;
}

export function stepDurationReasoning(meta: Record<string, unknown>): number {
    const created = meta?.createdAt as string | undefined;
    if (!created) { return 0; }
    const end = (meta.finishedGeneratingAt || meta.viewableAt || meta.completedAt) as string | undefined;
    if (!end) { return 0; }
    try { return Math.max(0, new Date(end).getTime() - new Date(created).getTime()); } catch { return 0; }
}

export function stepDurationTool(meta: Record<string, unknown>): number {
    const created = meta?.createdAt as string | undefined;
    if (!created) { return 0; }
    const end = (meta.completedAt || meta.finishedGeneratingAt || meta.viewableAt) as string | undefined;
    if (!end) { return 0; }
    try { return Math.max(0, new Date(end).getTime() - new Date(created).getTime()); } catch { return 0; }
}

export function extractToolDetail(step: Record<string, unknown>): string {
    const type = ((step.type as string) || '').replace('CORTEX_STEP_TYPE_', '');
    try {
        const meta = step.metadata as Record<string, unknown> | undefined;
        const toolCall = meta?.toolCall as Record<string, unknown> | undefined;
        const argsStr = toolCall?.argumentsJson as string | undefined;
        if (argsStr) {
            const args = JSON.parse(argsStr) as Record<string, string>;
            switch (type) {
                case 'VIEW_FILE': {
                    const p = args.AbsolutePath || '';
                    const name = p.split(/[\\/]/).pop() || p;
                    const lines = args.StartLine && args.EndLine ? `:${args.StartLine}-${args.EndLine}` : '';
                    return `${name}${lines}`;
                }
                case 'CODE_ACTION': return (args.TargetFile || args.target_file || '').split(/[\\/]/).pop() || '';
                case 'RUN_COMMAND': { const cmd = args.CommandLine || args.command || ''; return cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd; }
                case 'COMMAND_STATUS': return `ID:${(args.CommandId || '').substring(0, 8)}`;
                case 'LIST_DIRECTORY': return (args.DirectoryPath || '').split(/[\\/]/).pop() || '';
                case 'FIND': return `"${args.Pattern || ''}" in ${(args.SearchDirectory || '').split(/[\\/]/).pop() || '.'}`;
                case 'GREP_SEARCH': return `"${args.Query || ''}" in ${(args.SearchPath || '').split(/[\\/]/).pop() || '.'}`;
                case 'CODEBASE_SEARCH': return `"${args.Query || args.query || ''}"`;
                case 'MCP_TOOL': { const tn = (toolCall?.name as string) || ''; return tn.replace(/^mcp_/, '').replace(/^github-mcp-server_/, 'gh/'); }
                case 'SEARCH_WEB': return `"${args.query || ''}"`;
                case 'READ_URL_CONTENT': { const url = args.Url || args.url || ''; return url.length > 50 ? url.substring(0, 47) + '...' : url; }
                case 'BROWSER_SUBAGENT': return args.TaskName || args.RecordingName || '';
            }
            // MCP web-fetcher URL extraction
            const toolName = (toolCall?.name as string) || '';
            if (toolName.startsWith('mcp_web-fetcher_')) {
                const shortTool = toolName.replace('mcp_web-fetcher_', '');
                const url = args.url || '';
                const shortUrl = url.length > 40 ? url.substring(0, 37) + '...' : url;
                return shortUrl ? `${shortTool} → ${shortUrl}` : shortTool;
            }
        }
        // Fallback: step-level detail fields
        const viewFile = step.viewFile as Record<string, string> | undefined;
        if (viewFile?.absolutePathUri) { return viewFile.absolutePathUri.replace('file:///', '').split(/[\\/]/).pop() || ''; }
        const find = step.find as Record<string, string> | undefined;
        if (find?.pattern) { return `"${find.pattern}"`; }
    } catch { /* Swallow parse errors */ }
    return '';
}

/** Extract human-readable tool name for display in timeline */
export function extractToolName(step: Record<string, unknown>, fallbackLabel: string): string {
    try {
        const meta = step.metadata as Record<string, unknown> | undefined;
        const toolCall = meta?.toolCall as Record<string, unknown> | undefined;
        const name = (toolCall?.name as string) || '';
        if (name) {
            // MCP tools: shorten prefixes
            if (name.startsWith('mcp_github-mcp-server_')) { return 'gh/' + name.replace('mcp_github-mcp-server_', ''); }
            if (name.startsWith('mcp_web-fetcher_')) { return name.replace('mcp_web-fetcher_', ''); }
            if (name.startsWith('mcp_memory-store_')) { return name.replace('mcp_memory-store_', ''); }
            if (name.startsWith('mcp_sandbox_')) { return name.replace('mcp_sandbox_', ''); }
            if (name.startsWith('mcp_sequential-thinking_')) { return 'thinking'; }
            if (name.startsWith('mcp_')) { return name.replace('mcp_', ''); }
            return name;
        }
    } catch { /* fallback */ }
    return fallbackLabel;
}

export function sameTriggeredByScope(a?: string[], b?: string[]): boolean {
    if (!a?.length && !b?.length) {
        return true;
    }
    if (!a?.length || !b?.length || a.length !== b.length) {
        return false;
    }
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
}

export function buildGMEventKey(cascadeId: string | undefined, stepIndex: number | undefined): string {
    return `${cascadeId || 'unknown'}::${stepIndex ?? -1}`;
}

export function buildRawStepFingerprint(step: Record<string, unknown>, cascadeId?: string): string | undefined {
    const type = (step.type as string) || '';
    const meta = (step.metadata || {}) as Record<string, unknown>;
    const createdAt = (meta.createdAt as string) || '';
    if (!cascadeId || !type || !createdAt) { return undefined; }
    return `${cascadeId}|${type}|${createdAt}`;
}

export function buildLegacyStepEventIdentity(event: StepEvent): string {
    return [
        event.cascadeId || '',
        event.source || '',
        event.category,
        event.timestamp || '',
        event.icon || '',
        event.toolName || '',
        event.detail || '',
        event.userInput || '',
        event.fullUserInput || '',
        event.aiResponse || '',
        event.fullAiResponse || '',
    ].join('|');
}

export function isLowSignalPromptSnippet(snippet: string): boolean {
    const clean = snippet.replace(/\s+/g, ' ').trim();
    if (!clean) { return true; }
    if (clean.length < 12) { return true; }
    if (/^bot-[0-9a-f-]{8,}$/i.test(clean)) { return true; }
    if (/^toolu_[a-z0-9_-]{8,}$/i.test(clean)) { return true; }
    if (/^req_vrtx_[a-z0-9_-]{8,}$/i.test(clean)) { return true; }
    if (/^Step Id:\s*\d+\s+\{\{\s*CHECKPOINT/i.test(clean)) { return true; }
    if (/earlier parts of this conversation/i.test(clean)) { return true; }
    if (/conversation have been compressed/i.test(clean)) { return true; }
    return false;
}

/**
 * Extract notify_user Message from plannerResponse.toolCalls.
 * When AI calls notify_user, the actual reply text is in toolCalls[].argumentsJson.Message.
 */
export function extractNotifyMessage(toolCalls: unknown[] | undefined): string {
    if (!Array.isArray(toolCalls)) { return ''; }
    for (const tc of toolCalls) {
        const call = tc as Record<string, unknown>;
        if (call.name !== 'notify_user') { continue; }
        const argsJson = (call.argumentsJson as string) || '';
        if (!argsJson) { continue; }
        try {
            const args = JSON.parse(argsJson) as Record<string, unknown>;
            const msg = (args.Message as string) || '';
            if (msg.trim()) { return msg.trim(); }
        } catch { /* ignore parse errors */ }
    }
    return '';
}

export function buildGMVirtualPreview(call: GMCallEntry): { detail: string; aiResponse?: string; fullAiResponse?: string } {
    // Priority 0: Interrupted/cancelled call (0 tokens)
    if (call.inputTokens === 0 && call.outputTokens === 0) {
        return { detail: tBi('⚡ interrupted', '⚡ 已中断') };
    }

    // Priority 1: AI response snippet matched by stepIndex
    // aiSnippetsByStep is built from embedded GM's messagePrompts (GetCascadeTrajectory)
    // and broadcast to ALL calls via maybeEnrichCallsFromTrajectory.
    if (Object.keys(call.aiSnippetsByStep).length > 0) {
        for (const idx of call.stepIndices) {
            if (call.aiSnippetsByStep[idx]) {
                return { detail: call.aiSnippetsByStep[idx] };
            }
        }
    }

    // Priority 2: promptSnippet from GM payload (non-low-signal)
    if (call.promptSnippet && !isLowSignalPromptSnippet(call.promptSnippet)) {
        const preview = call.promptSnippet.length > 80
            ? call.promptSnippet.substring(0, 77) + '...'
            : call.promptSnippet;
        return { detail: preview };
    }

    // Priority 3: step count hint (how many steps this call covers)
    if (call.stepIndices.length > 1) {
        return { detail: `+${call.stepIndices.length} steps (estimated)` };
    }

    return { detail: tBi('GM call', 'GM 调用') };
}

export function sameStepDistribution(a: Record<string, number>, b: Record<string, number>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if ((a[key] || 0) !== (b[key] || 0)) { return false; }
    }
    return true;
}

export function mergeCountRecord(target: Record<string, number>, source: Record<string, number>): Record<string, number> {
    for (const [key, value] of Object.entries(source)) {
        if (!value) { continue; }
        target[key] = (target[key] || 0) + value;
    }
    return target;
}

export function mergeActivityStats(target: ModelActivityStats, source: ModelActivityStats): void {
    target.userInputs += source.userInputs || 0;
    target.reasoning += source.reasoning;
    target.toolCalls += source.toolCalls;
    target.errors += source.errors;
    target.checkpoints += source.checkpoints;
    target.totalSteps += source.totalSteps;
    target.thinkingTimeMs += source.thinkingTimeMs;
    target.toolTimeMs += source.toolTimeMs;
    target.inputTokens += source.inputTokens;
    target.outputTokens += source.outputTokens;
    target.toolReturnTokens += source.toolReturnTokens;
    target.estSteps += source.estSteps;
    mergeCountRecord(target.toolBreakdown, source.toolBreakdown);
    if (source.firstSeenAt && (!target.firstSeenAt || new Date(source.firstSeenAt).getTime() < new Date(target.firstSeenAt).getTime())) {
        target.firstSeenAt = source.firstSeenAt;
    }
}

export function mergeGMStats(target: GMModelStats, source: GMModelStats): void {
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

export function normalizeStepsByModelRecord(stepsByModel: Record<string, number>): Record<string, number> {
    const normalized: Record<string, number> = {};
    for (const [modelName, steps] of Object.entries(stepsByModel)) {
        const key = normalizeModelDisplayName(modelName) || modelName;
        normalized[key] = (normalized[key] || 0) + steps;
    }
    return normalized;
}

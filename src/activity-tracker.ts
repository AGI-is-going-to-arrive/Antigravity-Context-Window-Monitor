// ─── Activity Tracker ────────────────────────────────────────────────────────
// Tracks real-time model activity: reasoning calls, tool usage, tokens, timing.
// Ported from ls-monitor.ts (terminal script) into a reusable class module.

import { LSInfo } from './discovery';
import { rpcCall } from './rpc-client';
import { getModelDisplayName } from './models';

// ─── Step Type Classification ────────────────────────────────────────────────

export type StepCategory = 'reasoning' | 'tool' | 'user' | 'system';

interface StepClassification {
    icon: string;
    label: string;
    category: StepCategory;
}

const STEP_CATEGORIES: Record<string, StepClassification> = {
    'CORTEX_STEP_TYPE_PLANNER_RESPONSE':     { icon: '🧠', label: 'reasoning',    category: 'reasoning' },
    'CORTEX_STEP_TYPE_VIEW_FILE':            { icon: '📄', label: 'view_file',    category: 'tool' },
    'CORTEX_STEP_TYPE_CODE_ACTION':          { icon: '✏️', label: 'code_action',  category: 'tool' },
    'CORTEX_STEP_TYPE_RUN_COMMAND':          { icon: '⚡', label: 'run_command',  category: 'tool' },
    'CORTEX_STEP_TYPE_COMMAND_STATUS':       { icon: '📟', label: 'cmd_status',   category: 'tool' },
    'CORTEX_STEP_TYPE_SEND_COMMAND_INPUT':   { icon: '⌨️', label: 'send_input',   category: 'tool' },
    'CORTEX_STEP_TYPE_LIST_DIRECTORY':       { icon: '📂', label: 'list_dir',     category: 'tool' },
    'CORTEX_STEP_TYPE_FIND':                 { icon: '🔍', label: 'find',         category: 'tool' },
    'CORTEX_STEP_TYPE_GREP_SEARCH':          { icon: '🔎', label: 'grep_search',  category: 'tool' },
    'CORTEX_STEP_TYPE_CODEBASE_SEARCH':      { icon: '🗂️', label: 'code_search',  category: 'tool' },
    'CORTEX_STEP_TYPE_MCP_TOOL':             { icon: '🔌', label: 'mcp_tool',     category: 'tool' },
    'CORTEX_STEP_TYPE_SEARCH_WEB':           { icon: '🌐', label: 'search_web',   category: 'tool' },
    'CORTEX_STEP_TYPE_READ_URL_CONTENT':     { icon: '🌐', label: 'read_url',     category: 'tool' },
    'CORTEX_STEP_TYPE_BROWSER_SUBAGENT':     { icon: '🤖', label: 'browser',      category: 'tool' },
    'CORTEX_STEP_TYPE_ERROR_MESSAGE':        { icon: '❌', label: 'error',         category: 'system' },
    'CORTEX_STEP_TYPE_USER_INPUT':           { icon: '💬', label: 'user_input',    category: 'user' },
    'CORTEX_STEP_TYPE_CHECKPOINT':           { icon: '💾', label: 'checkpoint',    category: 'system' },
    'CORTEX_STEP_TYPE_CONVERSATION_HISTORY': { icon: '📜', label: 'history',       category: 'system' },
    'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS':  { icon: '📚', label: 'knowledge',     category: 'system' },
    'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE':    { icon: '💨', label: 'ephemeral',     category: 'system' },
    'CORTEX_STEP_TYPE_TASK_BOUNDARY':        { icon: '📌', label: 'task_boundary', category: 'system' },
    'CORTEX_STEP_TYPE_NOTIFY_USER':          { icon: '📢', label: 'notify_user',  category: 'system' },
};

function classifyStep(type: string): StepClassification {
    return STEP_CATEGORIES[type] || { icon: '❓', label: type.replace('CORTEX_STEP_TYPE_', ''), category: 'system' };
}

// ─── Exported Types ──────────────────────────────────────────────────────────

export interface ModelActivityStats {
    modelName: string;
    reasoning: number;
    toolCalls: number;
    errors: number;
    checkpoints: number;
    totalSteps: number;
    thinkingTimeMs: number;
    toolTimeMs: number;
    inputTokens: number;
    outputTokens: number;
    toolReturnTokens: number;
    toolBreakdown: Record<string, number>;
    /** Estimated steps from stepCount delta (beyond API ~500 step window) */
    estSteps: number;
}

/** A single step event for the timeline */
export interface StepEvent {
    timestamp: string;      // ISO string
    icon: string;
    category: StepCategory;
    model: string;
    detail: string;         // human-readable description
    durationMs: number;
    userInput?: string;     // user message preview (category='user')
    aiResponse?: string;    // AI response brief preview (category='reasoning')
    browserSub?: string;    // browser sub-step summary
    toolName?: string;      // tool type label (e.g. 'view_file', 'gh/search_issues')
    stepIndex?: number;     // step position within conversation (e.g. 142)
}

/** Archived activity snapshot (saved on quota reset) */
export interface ActivityArchive {
    /** ISO: when this period started */
    startTime: string;
    /** ISO: when this period ended (quota reset) */
    endTime: string;
    /** The full summary snapshot */
    summary: ActivitySummary;
    /** Model IDs whose quota reset triggered this archive */
    triggeredBy?: string[];
}

/** Sub-agent token consumption (e.g. FLASH_LITE for checkpoint summaries) */
export interface SubAgentTokenEntry {
    modelId: string;
    displayName: string;
    inputTokens: number;
    outputTokens: number;
    count: number;  // how many checkpoints used this sub-agent
}

/** Per-checkpoint snapshot for context growth trend */
export interface CheckpointSnapshot {
    timestamp: string;    // ISO
    inputTokens: number;
    outputTokens: number;
    compressed: boolean;  // inputTokens < previous → compression detected
}

/** Per-conversation breakdown */
export interface ConversationBreakdown {
    id: string;           // cascadeId (first 8 chars)
    steps: number;
    inputTokens: number;
    outputTokens: number;
}

export interface ActivitySummary {
    totalUserInputs: number;
    totalReasoning: number;
    totalToolCalls: number;
    totalErrors: number;
    totalCheckpoints: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalToolReturnTokens: number;
    /** Total estimated steps across all models (stepCount delta) */
    estSteps: number;
    modelStats: Record<string, ModelActivityStats>;
    globalToolStats: Record<string, number>;
    recentSteps: StepEvent[];
    sessionStartTime: string;   // ISO
    /** Sub-agent token consumption detected from CHECKPOINT.modelUsage */
    subAgentTokens: SubAgentTokenEntry[];
    /** Context growth trend across checkpoints */
    checkpointHistory: CheckpointSnapshot[];
    /** Per-conversation stats */
    conversationBreakdown: ConversationBreakdown[];
}

/** Serialized form for globalState persistence */
export interface ActivityTrackerState {
    version: 1;
    summary: ActivitySummary;
    trajectoryBaselines: Record<string, { stepCount: number; processedIndex: number; dominantModel?: string }>;
    warmedUp: boolean;
    archives?: ActivityArchive[];
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
    const clean = s.replace(/[\r\n]+/g, ' ').trim();
    return clean.length > max ? clean.substring(0, max - 3) + '...' : clean;
}

function stepDurationReasoning(meta: Record<string, unknown>): number {
    const created = meta?.createdAt as string | undefined;
    if (!created) { return 0; }
    const end = (meta.finishedGeneratingAt || meta.viewableAt || meta.completedAt) as string | undefined;
    if (!end) { return 0; }
    try { return Math.max(0, new Date(end).getTime() - new Date(created).getTime()); } catch { return 0; }
}

function stepDurationTool(meta: Record<string, unknown>): number {
    const created = meta?.createdAt as string | undefined;
    if (!created) { return 0; }
    const end = (meta.completedAt || meta.finishedGeneratingAt || meta.viewableAt) as string | undefined;
    if (!end) { return 0; }
    try { return Math.max(0, new Date(end).getTime() - new Date(created).getTime()); } catch { return 0; }
}

function extractToolDetail(step: Record<string, unknown>): string {
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
function extractToolName(step: Record<string, unknown>, fallbackLabel: string): string {
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

// ─── ActivityTracker Class ───────────────────────────────────────────────────

/** Maximum recent step events kept in memory (configurable via settings) */
function getMaxRecentSteps(): number {
    try {
        const vscode = require('vscode');
        return vscode.workspace.getConfiguration('antigravityContextMonitor').get('activity.maxRecentSteps', 100) || 100;
    } catch { return 100; }
}

/** Maximum archives kept (configurable via settings) */
function getMaxArchives(): number {
    try {
        const vscode = require('vscode');
        return vscode.workspace.getConfiguration('antigravityContextMonitor').get('activity.maxArchives', 20) || 20;
    } catch { return 20; }
}

export class ActivityTracker {
    // Model stats
    private _modelStats = new Map<string, ModelActivityStats>();
    private _subAgentTokens = new Map<string, SubAgentTokenEntry>();
    private _checkpointHistory: CheckpointSnapshot[] = [];
    private _conversationBreakdown = new Map<string, ConversationBreakdown>();
    private _globalToolStats = new Map<string, number>();
    private _totalUserInputs = 0;
    private _totalCheckpoints = 0;
    private _totalErrors = 0;

    // Sample distribution — built from the ~500 steps API can return.
    // When API can't return new steps, delta is distributed using these ratios.
    //   key = model name (or '' for no-model steps)
    //   value = { reasoning, toolCalls, errors, other } counts from sample
    private _sampleDist = new Map<string, { reasoning: number; toolCalls: number; errors: number; other: number }>();
    private _sampleTotal = 0;  // total sampled steps

    // Trajectory baselines — dominantModel is detected from sampled steps
    private _trajectories = new Map<string, { stepCount: number; processedIndex: number; dominantModel: string; lastStatus: string }>();
    private _warmedUp = false;

    // Recent steps (ring buffer)
    private _recentSteps: StepEvent[] = [];
    private _sessionStartTime: string;

    // Archive history
    private _archives: ActivityArchive[] = [];

    constructor() {
        this._sessionStartTime = new Date().toISOString();
    }

    // ─── Core Update ─────────────────────────────────────────────────────

    /**
     * Process trajectory changes. Called from the main poll loop with
     * already-fetched trajectory data — no redundant RPC.
     *
     * DESIGN NOTES:
     * - Warm-up processes ALL conversations (including IDLE) so cumulative
     *   stats reflect the FULL usage within this quota cycle.
     * - When quota resets, archiveAndReset() snapshots everything and clears.
     */
    async processTrajectories(
        ls: LSInfo,
        trajectories: { cascadeId: string; stepCount: number; status: string }[],
        signal?: AbortSignal,
    ): Promise<boolean> {
        const trajMap = new Map<string, { stepCount: number; status: string }>();
        for (const t of trajectories) {
            trajMap.set(t.cascadeId, { stepCount: t.stepCount, status: t.status });
        }

        // Warm-up: process ALL conversations' steps for full quota-cycle stats
        if (!this._warmedUp) {
            // Collect RUNNING conversations' steps for post-warm-up timeline injection
            const runningSteps: { steps: Record<string, unknown>[]; status: string }[] = [];

            for (const [id, info] of trajMap) {
                const sc = info.stepCount || 0;
                if (sc === 0) {
                    this._trajectories.set(id, { stepCount: 0, processedIndex: 0, dominantModel: '', lastStatus: info.status });
                    continue;
                }
                try {
                    const sr = await rpcCall(ls, 'GetCascadeTrajectorySteps',
                        { cascadeId: id, startIndex: 0, endIndex: sc },
                        15000, signal) as Record<string, unknown>;
                    const allSteps = (sr.steps || []) as Record<string, unknown>[];
                    const detectedModel = this._detectDominantModel(allSteps);
                    for (const step of allSteps) {
                        this._processStep(step, false, undefined, detectedModel);
                    }
                    this._trajectories.set(id, { stepCount: sc, processedIndex: allSteps.length, dominantModel: this._detectDominantModel(allSteps), lastStatus: info.status });

                    // Track per-conversation breakdown
                    this._updateConversationBreakdown(id, allSteps);

                    // Keep RUNNING conversations' steps for timeline injection
                    if (info.status === 'CASCADE_RUN_STATUS_RUNNING' && allSteps.length > 0) {
                        runningSteps.push({ steps: allSteps, status: info.status });
                    }
                } catch {
                    this._trajectories.set(id, { stepCount: sc, processedIndex: 0, dominantModel: '', lastStatus: info.status });
                }
            }
            this._warmedUp = true;

            // Post-warm-up: inject recent timeline events from RUNNING conversations
            // Stats already counted above — this only creates StepEvent objects.
            for (const { steps } of runningSteps) {
                const tail = steps.slice(-30);
                const startIdx = steps.length - tail.length;
                for (let i = 0; i < tail.length; i++) {
                    this._injectTimelineEvent(tail[i], startIdx + i);
                }
            }

            return true;
        }

        // Incremental update
        let hasChanges = false;
        for (const [id, info] of trajMap) {
            const currSteps = info.stepCount || 0;
            let entry = this._trajectories.get(id);

            if (!entry) {
                // New conversation with no steps yet — don't create entry, wait for steps
                if (currSteps === 0) { continue; }
                entry = { stepCount: 0, processedIndex: 0, dominantModel: '', lastStatus: '' };
                this._trajectories.set(id, entry);
            }

            // Detect status transition FIRST (before any skip logic)
            const statusChanged = info.status === 'CASCADE_RUN_STATUS_RUNNING' && entry.lastStatus !== 'CASCADE_RUN_STATUS_RUNNING';
            entry.lastStatus = info.status;

            // Detect rollback/resend: stepCount decreased = steps were replaced
            if (currSteps < entry.stepCount) {
                entry.processedIndex = Math.min(entry.processedIndex, currSteps);
            }

            // Skip if no new steps AND no status change
            if (currSteps <= entry.processedIndex && !statusChanged) {
                entry.stepCount = currSteps;
                continue;
            }

            // Skip IDLE conversations only if stepCount hasn't changed.
            if (entry.processedIndex > 0 && info.status !== 'CASCADE_RUN_STATUS_RUNNING' && currSteps <= entry.stepCount && !statusChanged) {
                continue;
            }

            try {
                // LS API returns the EARLIEST ~500 steps (fixed window, NOT sliding).
                // Steps beyond this window are not accessible via API.
                // Strategy: process returned steps once, then use stepCount delta for new steps.

                if (entry.processedIndex === 0) {
                    // FIRST TIME: fetch and process all available steps
                    const sr = await rpcCall(ls, 'GetCascadeTrajectorySteps',
                        { cascadeId: id, startIndex: 0, endIndex: currSteps },
                        15000, signal) as Record<string, unknown>;
                    const steps = (sr.steps || []) as Record<string, unknown>[];

                    const ctxModel = this._detectDominantModel(steps);
                    for (let si = 0; si < steps.length; si++) {
                        this._processStep(steps[si], this._warmedUp, si, ctxModel);
                    }
                    hasChanges = steps.length > 0;
                    entry.processedIndex = currSteps;
                    entry.dominantModel = this._detectDominantModel(steps);
                    this._updateConversationBreakdown(id, steps);
                } else {
                    // INCREMENTAL: re-fetch steps to capture new ones precisely.
                    // API returns earliest ~500 steps; any beyond that use estimation.
                    const sr = await rpcCall(ls, 'GetCascadeTrajectorySteps',
                        { cascadeId: id, startIndex: 0, endIndex: currSteps },
                        15000, signal) as Record<string, unknown>;
                    const fetchedSteps = (sr.steps || []) as Record<string, unknown>[];

                    // Process individually any NEW steps within API window
                    if (fetchedSteps.length > entry.processedIndex) {
                        const incModel = entry.dominantModel || this._detectDominantModel(fetchedSteps);
                        for (let i = entry.processedIndex; i < fetchedSteps.length; i++) {
                            this._processStep(fetchedSteps[i], true, i, incModel);
                        }
                        hasChanges = true;
                        entry.processedIndex = fetchedSteps.length;
                        entry.dominantModel = this._detectDominantModel(fetchedSteps);
                    } else if (statusChanged && fetchedSteps.length > 0) {
                        // Conversation switched/resumed: inject recent timeline events
                        // even if processedIndex hasn't changed (covers resend scenarios)
                        const tail = fetchedSteps.slice(-20);
                        const startIdx = fetchedSteps.length - tail.length;
                        for (let i = 0; i < tail.length; i++) {
                            this._injectTimelineEvent(tail[i], startIdx + i);
                        }
                        hasChanges = true;
                    }

                    // Any steps beyond API window → delta estimation (fallback)
                    const beyondApi = currSteps - Math.max(fetchedSteps.length, entry.stepCount);
                    if (beyondApi > 0 && entry.dominantModel) {
                        const s = this._getOrCreateStats(entry.dominantModel);
                        s.totalSteps += beyondApi;
                        s.estSteps += beyondApi;
                        const estStart = Math.max(fetchedSteps.length, entry.stepCount);
                        this._pushEvent({
                            timestamp: new Date().toISOString(),
                            icon: '📊', category: 'reasoning', model: entry.dominantModel,
                            detail: `+${beyondApi} steps (estimated)`, durationMs: 0,
                            stepIndex: estStart,
                        });
                        hasChanges = true;
                    }
                }

                entry.stepCount = currSteps;
            } catch {
                entry.stepCount = currSteps;
            }
        }

        return hasChanges;
    }

    // ─── Step Processing ─────────────────────────────────────────────────

    private _processStep(step: Record<string, unknown>, emitEvent = true, stepIndex?: number, contextModel?: string): void {
        const type = (step.type as string) || '';
        const meta = (step.metadata || {}) as Record<string, unknown>;
        const modelId = (meta.generatorModel as string) || '';
        const model = modelId ? getModelDisplayName(modelId) : '';
        const cls = classifyStep(type);
        const dur = cls.category === 'tool' ? stepDurationTool(meta) : stepDurationReasoning(meta);
        // Use our own clock for reliable local timezone; LS's createdAt may lack TZ info
        const timestamp = emitEvent ? new Date().toISOString() : '';

        // USER_INPUT
        if (cls.category === 'user') {
            this._totalUserInputs++;
            this._trackSample('', 'other');
            const userInput = step.userInput as Record<string, unknown> | undefined;
            const items = userInput?.items as Record<string, string>[] | undefined;
            const text = Array.isArray(items) && items.length > 0 ? (items[0].text || '') : '';
            if (emitEvent) {
                this._pushEvent({ timestamp, icon: cls.icon, category: 'user', model: '', detail: '', durationMs: 0, userInput: text ? truncate(text, 80) : undefined, stepIndex });
            }
            return;
        }

        // CHECKPOINT — extract token data
        // BUG FIX: modelUsage.model is a "ghost" field — always reports FLASH_LITE
        // regardless of the actual generating model. Use contextModel (detected from
        // surrounding steps' generatorModel) for accurate token attribution.
        // Sub-agent tracking: when modelUsage.model differs from the attributed model,
        // record it as sub-agent consumption for transparent display.
        if (type === 'CORTEX_STEP_TYPE_CHECKPOINT') {
            this._totalCheckpoints++;
            this._trackSample('', 'other');
            const mu = meta.modelUsage as Record<string, string> | undefined;
            if (mu) {
                const inTok = parseInt(mu.inputTokens || '0', 10);
                const outTok = parseInt(mu.outputTokens || '0', 10);
                // Priority: contextModel (from dominantModel) > generatorModel > modelUsage.model (ghost)
                const attrModel = contextModel || model || (mu.model ? getModelDisplayName(mu.model) : '');
                if (attrModel) {
                    const s = this._getOrCreateStats(attrModel);
                    s.totalSteps++;
                    s.checkpoints++;
                    s.inputTokens += inTok;
                    s.outputTokens += outTok;
                }
                // Track sub-agent: when modelUsage.model differs from attrModel
                const rawModel = mu.model || '';
                const rawDisplay = rawModel ? getModelDisplayName(rawModel) : '';
                if (rawModel && rawDisplay && rawDisplay !== attrModel) {
                    const key = rawModel;
                    const existing = this._subAgentTokens.get(key);
                    if (existing) {
                        existing.inputTokens += inTok;
                        existing.outputTokens += outTok;
                        existing.count++;
                    } else {
                        this._subAgentTokens.set(key, {
                            modelId: rawModel,
                            displayName: rawDisplay,
                            inputTokens: inTok,
                            outputTokens: outTok,
                            count: 1,
                        });
                    }
                }
                // Record checkpoint snapshot for context growth trend
                const prevCp = this._checkpointHistory.length > 0
                    ? this._checkpointHistory[this._checkpointHistory.length - 1] : undefined;
                this._checkpointHistory.push({
                    timestamp,
                    inputTokens: inTok,
                    outputTokens: outTok,
                    compressed: prevCp ? inTok < prevCp.inputTokens * 0.7 : false,
                });
            }
            return;
        }

        // ERROR_MESSAGE — count even without model
        if (type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
            this._totalErrors++;
            this._trackSample(model, 'errors');
            if (model) {
                const s = this._getOrCreateStats(model);
                s.totalSteps++;
                s.errors++;
            }
            if (emitEvent) {
                this._pushEvent({ timestamp, icon: cls.icon, category: 'system', model: model || 'unknown', detail: 'error', durationMs: 0, stepIndex });
            }
            return;
        }

        // Skip system steps without model
        if (!model) { return; }

        const s = this._getOrCreateStats(model);
        s.totalSteps++;

        if (cls.category === 'reasoning') {
            s.reasoning++;
            this._trackSample(model, 'reasoning');
            const pr = step.plannerResponse as Record<string, unknown> | undefined;
            const tdStr = pr?.thinkingDuration as string | undefined;
            if (tdStr && typeof tdStr === 'string') {
                const secs = parseFloat(tdStr.replace('s', ''));
                s.thinkingTimeMs += (!isNaN(secs) && secs > 0) ? Math.round(secs * 1000) : dur;
            } else {
                s.thinkingTimeMs += dur;
            }
            let detail = '';
            const toolCalls = pr?.toolCalls as unknown[] | undefined;
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                detail = `→ ${toolCalls.length} ${toolCalls.length === 1 ? 'tool' : 'tools'}`;
            }
            let resp = ((pr?.modifiedResponse || pr?.response || '') as string);
            // Fallback: show thinking duration if no response text
            if (!resp && tdStr) {
                resp = '正在思考';
            }
            if (emitEvent) {
                // durationMs=0 for timeline: per-step thinking time is unreliable with 3s polling
                this._pushEvent({ timestamp, icon: cls.icon, category: 'reasoning', model, detail, durationMs: 0, aiResponse: resp ? truncate(resp, 80) : undefined, stepIndex });
            }

        } else if (cls.category === 'tool') {
            s.toolCalls++;
            this._trackSample(model, 'toolCalls');
            s.toolTimeMs += dur;
            s.toolBreakdown[cls.label] = (s.toolBreakdown[cls.label] || 0) + 1;
            this._globalToolStats.set(cls.label, (this._globalToolStats.get(cls.label) || 0) + 1);
            const tokens = parseInt((meta.toolCallOutputTokens as string) || '0', 10);
            if (tokens > 0) { s.toolReturnTokens += tokens; }
            const detail = extractToolDetail(step);
            const toolName = extractToolName(step, cls.label);
            if (emitEvent) {
                this._pushEvent({ timestamp, icon: cls.icon, category: 'tool', model, detail, durationMs: dur, toolName, stepIndex });
            }
        }
    }

    /**
     * Inject a timeline event from a step WITHOUT modifying any stats or counters.
     * Used after warm-up to populate the timeline with recent activity.
     * Uses LS's metadata.createdAt for timestamps since these are historical events.
     */
    private _injectTimelineEvent(step: Record<string, unknown>, stepIndex: number): void {
        const type = (step.type as string) || '';
        const meta = (step.metadata || {}) as Record<string, unknown>;
        const modelId = (meta.generatorModel as string) || '';
        const model = modelId ? getModelDisplayName(modelId) : '';
        const cls = classifyStep(type);

        // Use LS createdAt for historical timestamp, fallback to session start
        const createdAt = (meta.createdAt as string) || '';
        const timestamp = createdAt || this._sessionStartTime;

        if (cls.category === 'user') {
            const userInput = step.userInput as Record<string, unknown> | undefined;
            const items = userInput?.items as Record<string, string>[] | undefined;
            const text = Array.isArray(items) && items.length > 0 ? (items[0].text || '') : '';
            this._pushEvent({ timestamp, icon: cls.icon, category: 'user', model: '', detail: '', durationMs: 0, userInput: text ? truncate(text, 80) : undefined, stepIndex });
            return;
        }

        if (cls.category === 'system') { return; }
        if (!model) { return; }

        if (cls.category === 'reasoning') {
            const pr = step.plannerResponse as Record<string, unknown> | undefined;
            let detail = '';
            const toolCalls = pr?.toolCalls as unknown[] | undefined;
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                detail = `→ ${toolCalls.length} ${toolCalls.length === 1 ? 'tool' : 'tools'}`;
            }
            const resp = ((pr?.modifiedResponse || pr?.response || '') as string);
            const tdStr = pr?.thinkingDuration as string | undefined;
            let aiResp = resp;
            if (!aiResp && tdStr) {
                aiResp = '正在思考';
            }
            this._pushEvent({ timestamp, icon: cls.icon, category: 'reasoning', model, detail, durationMs: 0, aiResponse: aiResp ? truncate(aiResp, 80) : undefined, stepIndex });
        } else if (cls.category === 'tool') {
            const dur = stepDurationTool(meta);
            const detail = extractToolDetail(step);
            const toolName = extractToolName(step, cls.label);
            this._pushEvent({ timestamp, icon: cls.icon, category: 'tool', model, detail, durationMs: dur, toolName, stepIndex });
        }
    }

    // ─── Sample Distribution ────────────────────────────────────────────

    /** Record a step's model+category into the sample distribution table */
    private _trackSample(model: string, cat: 'reasoning' | 'toolCalls' | 'errors' | 'other'): void {
        this._sampleTotal++;
        let d = this._sampleDist.get(model);
        if (!d) { d = { reasoning: 0, toolCalls: 0, errors: 0, other: 0 }; this._sampleDist.set(model, d); }
        d[cat]++;
    }

    /**
     * Detect the dominant (most-used) model in a set of steps.
     * Used to attribute future delta steps to the correct model.
     */
    private _detectDominantModel(steps: Record<string, unknown>[]): string {
        const counts = new Map<string, number>();
        for (const step of steps) {
            const meta = (step.metadata || {}) as Record<string, unknown>;
            const modelId = (meta.generatorModel as string) || '';
            if (!modelId) { continue; }
            const model = getModelDisplayName(modelId);
            counts.set(model, (counts.get(model) || 0) + 1);
        }
        let topModel = '';
        let topCount = 0;
        for (const [m, c] of counts) {
            if (c > topCount) { topCount = c; topModel = m; }
        }
        return topModel;
    }

    /** Update per-conversation breakdown from fetched steps */
    private _updateConversationBreakdown(cascadeId: string, steps: Record<string, unknown>[]): void {
        // CHECKPOINT modelUsage.inputTokens/outputTokens are CUMULATIVE snapshots,
        // so we just take the LAST checkpoint's values as the conversation total.
        let lastIn = 0, lastOut = 0;
        for (const step of steps) {
            const meta = (step.metadata || {}) as Record<string, unknown>;
            const type = (step.type as string) || '';
            if (type === 'CORTEX_STEP_TYPE_CHECKPOINT') {
                const mu = meta.modelUsage as Record<string, string> | undefined;
                if (mu) {
                    const inTok = parseInt(mu.inputTokens || '0', 10);
                    const outTok = parseInt(mu.outputTokens || '0', 10);
                    if (inTok > lastIn) { lastIn = inTok; }
                    if (outTok > lastOut) { lastOut = outTok; }
                }
            }
        }
        this._conversationBreakdown.set(cascadeId, {
            id: cascadeId.slice(0, 8),
            steps: steps.length,
            inputTokens: lastIn,
            outputTokens: lastOut,
        });
    }

    // ─── State Accessors ─────────────────────────────────────────────────

    getSummary(): ActivitySummary {
        const modelStats: Record<string, ModelActivityStats> = {};
        let totalReasoning = 0, totalToolCalls = 0, totalErrors = 0;
        let estSteps = 0;
        let totalInputTokens = 0, totalOutputTokens = 0, totalToolReturnTokens = 0;

        for (const [name, s] of this._modelStats) {
            modelStats[name] = { ...s };
            totalReasoning += s.reasoning;
            totalToolCalls += s.toolCalls;
            totalErrors += s.errors;
            estSteps += s.estSteps;
            totalInputTokens += s.inputTokens;
            totalOutputTokens += s.outputTokens;
            totalToolReturnTokens += s.toolReturnTokens;
        }

        const globalToolStats: Record<string, number> = {};
        for (const [k, v] of this._globalToolStats) { globalToolStats[k] = v; }

        const subAgentTokens: SubAgentTokenEntry[] = [];
        for (const [, entry] of this._subAgentTokens) {
            subAgentTokens.push({ ...entry });
        }

        const conversationBreakdown: ConversationBreakdown[] = [];
        for (const [, entry] of this._conversationBreakdown) {
            conversationBreakdown.push({ ...entry });
        }
        conversationBreakdown.sort((a, b) => b.steps - a.steps);

        return {
            totalUserInputs: this._totalUserInputs,
            totalReasoning,
            totalToolCalls,
            totalErrors: this._totalErrors,
            totalCheckpoints: this._totalCheckpoints,
            totalInputTokens,
            totalOutputTokens,
            totalToolReturnTokens,
            estSteps,
            modelStats,
            globalToolStats,
            recentSteps: [...this._recentSteps],
            sessionStartTime: this._sessionStartTime,
            subAgentTokens,
            checkpointHistory: [...this._checkpointHistory],
            conversationBreakdown,
        };
    }

    /**
     * Get a compact status bar text string.
     * Example: "🧠5 ⚡12 🪙3.2k"
     */
    getStatusBarText(): string {
        const s = this.getSummary();
        const parts: string[] = [];
        if (s.totalReasoning > 0) { parts.push(`🧠${s.totalReasoning}`); }
        if (s.totalToolCalls > 0) { parts.push(`⚡${s.totalToolCalls}`); }
        if (s.estSteps > 0) { parts.push(`📊+${s.estSteps}`); }
        const totalTokens = s.totalInputTokens + s.totalOutputTokens;
        if (totalTokens > 0) {
            parts.push(`🪙${totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'k' : String(totalTokens)}`);
        }
        return parts.length > 0 ? parts.join(' ') : '🧠0 ⚡0';
    }

    /**
     * Get status bar text for a specific model only.
     * Falls back to global text if the model has no stats.
     */
    getModelStatusBarText(modelDisplayName: string): string {
        const ms = this._modelStats.get(modelDisplayName);
        if (!ms || ms.totalSteps === 0) { return this.getStatusBarText(); }
        const parts: string[] = [];
        if (ms.reasoning > 0) { parts.push(`🧠${ms.reasoning}`); }
        if (ms.toolCalls > 0) { parts.push(`⚡${ms.toolCalls}`); }
        if (ms.estSteps > 0) { parts.push(`📊+${ms.estSteps}`); }
        const tokens = ms.inputTokens + ms.outputTokens;
        if (tokens > 0) {
            parts.push(`🪙${tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : String(tokens)}`);
        }
        return parts.length > 0 ? parts.join(' ') : '🧠0 ⚡0';
    }

    /** Whether the tracker has been warmed up */
    get isReady(): boolean { return this._warmedUp; }

    /** Get archived snapshots */
    getArchives(): ActivityArchive[] { return [...this._archives]; }

    /**
     * Archive current activity data and reset all stats.
     * Called when quota resets (fraction jumps back to 1.0).
     * @param modelIds - Optional model IDs whose quota triggered this archive
     */
    archiveAndReset(modelIds?: string[]): void {
        const summary = this.getSummary();
        const maxArchives = getMaxArchives();
        // Only archive if there's meaningful activity
        if (summary.totalReasoning > 0 || summary.totalToolCalls > 0) {
            const now = Date.now();
            const lastArchive = this._archives[0];
            const lastEndMs = lastArchive ? new Date(lastArchive.endTime).getTime() : 0;
            const MIN_ARCHIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

            if (lastArchive && (now - lastEndMs) < MIN_ARCHIVE_INTERVAL_MS) {
                // Debounce: merge into the most recent archive
                lastArchive.endTime = new Date().toISOString();
                lastArchive.summary = summary;
                if (modelIds) {
                    lastArchive.triggeredBy = [
                        ...new Set([...(lastArchive.triggeredBy || []), ...modelIds]),
                    ];
                }
            } else {
                this._archives.unshift({
                    startTime: this._sessionStartTime,
                    endTime: new Date().toISOString(),
                    summary,
                    triggeredBy: modelIds,
                });
                // Trim to max
                if (this._archives.length > maxArchives) {
                    this._archives = this._archives.slice(0, maxArchives);
                }
            }
        }
        // Reset stats only — keep trajectories as baselines so warm-up doesn't re-count history
        this._modelStats.clear();
        this._subAgentTokens.clear();
        this._checkpointHistory = [];
        this._conversationBreakdown.clear();
        this._globalToolStats.clear();
        this._totalUserInputs = 0;
        this._totalCheckpoints = 0;
        this._totalErrors = 0;
        this._recentSteps = [];
        this._sessionStartTime = new Date().toISOString();
        // DO NOT clear _trajectories or set _warmedUp=false!
        // Existing processedIndex values serve as baselines — only new steps after this point are counted.
    }

    /**
     * Full reset: clear all stats, timeline, and archives.
     * Keeps trajectory baselines to avoid re-counting old steps.
     */
    reset(): void {
        this._modelStats.clear();
        this._subAgentTokens.clear();
        this._checkpointHistory = [];
        this._conversationBreakdown.clear();
        this._globalToolStats.clear();
        this._totalUserInputs = 0;
        this._totalCheckpoints = 0;
        this._totalErrors = 0;
        this._recentSteps = [];
        this._archives = [];
        this._sessionStartTime = new Date().toISOString();
    }

    // ─── Serialization ───────────────────────────────────────────────────

    serialize(): ActivityTrackerState {
        const baselines: Record<string, { stepCount: number; processedIndex: number; dominantModel: string; lastStatus: string }> = {};
        for (const [k, v] of this._trajectories) { baselines[k] = { ...v }; }
        return {
            version: 1,
            summary: this.getSummary(),
            trajectoryBaselines: baselines,
            warmedUp: this._warmedUp,
            archives: this._archives,
        };
    }

    static restore(data: ActivityTrackerState): ActivityTracker {
        const tracker = new ActivityTracker();
        if (!data || data.version !== 1) { return tracker; }

        const s = data.summary;
        tracker._sessionStartTime = s.sessionStartTime;
        tracker._archives = data.archives || [];

        // Fully restore all model stats from persisted summary
        for (const [name, ms] of Object.entries(s.modelStats)) {
            const stats = tracker._getOrCreateStats(name);
            stats.reasoning = ms.reasoning;
            stats.toolCalls = ms.toolCalls;
            stats.errors = ms.errors;
            stats.checkpoints = ms.checkpoints;
            stats.totalSteps = ms.totalSteps;
            stats.thinkingTimeMs = ms.thinkingTimeMs;
            stats.toolTimeMs = ms.toolTimeMs;
            stats.inputTokens = ms.inputTokens;
            stats.outputTokens = ms.outputTokens;
            stats.toolReturnTokens = ms.toolReturnTokens;
            stats.toolBreakdown = { ...ms.toolBreakdown };
            stats.estSteps = ms.estSteps;
        }

        // Restore global counters
        tracker._totalUserInputs = s.totalUserInputs;
        tracker._totalCheckpoints = s.totalCheckpoints;
        tracker._totalErrors = s.totalErrors;

        // Restore global tool stats
        for (const [k, v] of Object.entries(s.globalToolStats)) {
            tracker._globalToolStats.set(k, v);
        }

        // Restore sub-agent tokens (backward compatible: absent in older data)
        if (Array.isArray(s.subAgentTokens)) {
            for (const entry of s.subAgentTokens) {
                tracker._subAgentTokens.set(entry.modelId, { ...entry });
            }
        }

        // Restore checkpoint history (backward compatible)
        if (Array.isArray((s as unknown as Record<string, unknown>).checkpointHistory)) {
            tracker._checkpointHistory = [...s.checkpointHistory];
        }

        // Restore conversation breakdown (backward compatible)
        if (Array.isArray((s as unknown as Record<string, unknown>).conversationBreakdown)) {
            for (const cb of s.conversationBreakdown) {
                tracker._conversationBreakdown.set(cb.id, { ...cb });
            }
        }

        // Restore recent steps (timeline)
        tracker._recentSteps = [...s.recentSteps];

        // Restore trajectory baselines (including dominantModel)
        if (data.trajectoryBaselines) {
            for (const [id, baseline] of Object.entries(data.trajectoryBaselines)) {
                tracker._trajectories.set(id, {
                    stepCount: baseline.stepCount,
                    processedIndex: baseline.processedIndex,
                    dominantModel: (baseline as { dominantModel?: string }).dominantModel || '',
                    lastStatus: (baseline as { lastStatus?: string }).lastStatus || '',
                });
            }
        }

        // ── Migration: sub-agent token tracking ──
        const needsSubAgentMigration = s.totalCheckpoints > 0
            && (!Array.isArray(s.subAgentTokens) || s.subAgentTokens.length === 0);

        // ── Migration: checkpoint history & conversation breakdown ──
        // Also triggers when conversationBreakdown was populated with bad data (all zeros)
        const cbEntries = [...tracker._conversationBreakdown.values()];
        const cbAllZero = cbEntries.length > 0 && cbEntries.every(e => e.inputTokens === 0 && e.outputTokens === 0);
        const needsHistoryMigration = s.totalCheckpoints > 0
            && (tracker._checkpointHistory.length === 0 || cbAllZero);

        if (needsSubAgentMigration || needsHistoryMigration) {
            // Nuclear reset: clear all stats, reset trajectory processedIndex to 0
            // so warm-up re-scans all existing steps and builds sub-agent map
            tracker._modelStats.clear();
            tracker._subAgentTokens.clear();
            tracker._checkpointHistory = [];
            tracker._conversationBreakdown.clear();
            tracker._globalToolStats.clear();
            tracker._totalUserInputs = 0;
            tracker._totalCheckpoints = 0;
            tracker._totalErrors = 0;
            tracker._recentSteps = [];
            for (const [id, t] of tracker._trajectories) {
                tracker._trajectories.set(id, { ...t, processedIndex: 0 });
            }
            tracker._warmedUp = false; // force full re-warm-up
        } else if (Object.keys(data.trajectoryBaselines || {}).length > 0) {
            tracker._warmedUp = true;  // use incremental path — only new steps
        } else {
            tracker._warmedUp = false; // no baselines: full warm-up needed
        }

        return tracker;
    }

    // ─── Private Helpers ─────────────────────────────────────────────────

    private _getOrCreateStats(model: string): ModelActivityStats {
        if (!this._modelStats.has(model)) {
            this._modelStats.set(model, {
                modelName: model, reasoning: 0, toolCalls: 0, errors: 0, checkpoints: 0,
                totalSteps: 0, thinkingTimeMs: 0, toolTimeMs: 0, inputTokens: 0,
                estSteps: 0,
                outputTokens: 0, toolReturnTokens: 0, toolBreakdown: {},
            });
        }
        return this._modelStats.get(model)!;
    }

    private _pushEvent(event: StepEvent): void {
        this._recentSteps.push(event);
        const max = getMaxRecentSteps();
        if (this._recentSteps.length > max) {
            this._recentSteps = this._recentSteps.slice(-max);
        }
    }
}

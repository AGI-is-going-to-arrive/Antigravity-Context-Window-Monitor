// ─── Activity Tracker Class ──────────────────────────────────────────────────
// Core ActivityTracker class: trajectory processing, step recording, GM injection,
// summary generation, archive management, and state serialization.

import { LSInfo } from '../discovery';
import { rpcCall } from '../rpc-client';
import { normalizeModelDisplayName } from '../models';
import { tBi } from '../i18n';
import type { GMSummary, GMCallEntry, GMModelStats } from '../gm-tracker';
import type {
    StepCategory,
    ModelActivityStats,
    StepEvent,
    ActivityArchive,
    ArchiveResetOptions,
    SubAgentTokenEntry,
    CheckpointSnapshot,
    ConversationBreakdown,
    ActivitySummary,
    ActivityTrackerState,
} from './types';
import {
    classifyStep,
    truncate,
    stepDurationReasoning,
    stepDurationTool,
    extractToolDetail,
    extractToolName,
    sameTriggeredByScope,
    buildGMEventKey,
    buildRawStepFingerprint,
    buildLegacyStepEventIdentity,
    isLowSignalPromptSnippet,
    extractNotifyMessage,
    buildGMVirtualPreview,
    sameStepDistribution,
    mergeCountRecord,
    mergeActivityStats,
    mergeGMStats,
    normalizeStepsByModelRecord,
    slimStepEventForPersistence,
} from './helpers';

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

/**
 * Re-scan a small tail window so late-filled planner responses can replace
 * earlier empty placeholder steps without rebuilding the whole timeline.
 */
const STEP_TAIL_REFRESH_WINDOW = 12;
const STEP_TAIL_RESTORE_WINDOW = 64;
const MAX_PENDING_PLANNER_REFRESH_ATTEMPTS = 6;

export class ActivityTracker {
    // Model stats
    private _modelStats = new Map<string, ModelActivityStats>();
    private _subAgentTokens = new Map<string, SubAgentTokenEntry>();
    private _checkpointHistory: CheckpointSnapshot[] = [];
    private _conversationBreakdown = new Map<string, ConversationBreakdown>();
    private _globalToolStats = new Map<string, number>();
    // GM-sourced sub-agent supplements (runtime-only, rebuilt each injectGMData() call)
    // Covers GM calls OUTSIDE the Steps API ~500 step window → no double-count with CP-based data
    private _gmSubAgentTokens = new Map<string, SubAgentTokenEntry>();
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
    private _trajectories = new Map<string, {
        stepCount: number;
        processedIndex: number;
        dominantModel: string;
        lastStatus: string;
        requestedModel: string;
        generatorModel: string;
    }>();
    private _warmedUp = false;

    // Recent steps (ring buffer)
    private _recentSteps: StepEvent[] = [];
    private _pendingPlannerSteps = new Map<string, Map<number, number>>();
    private _tailRefreshQueue = new Set<string>();
    private _sessionStartTime: string;

    // Archive history
    private _archives: ActivityArchive[] = [];

    // ── Cached GM global aggregates (prevents flicker between poll paths) ──
    private _gmTotals: {
        inputTokens: number;
        outputTokens: number;
        cacheRead: number;
        credits: number;
        retries: number;
    } | null = null;
    private _gmModelBreakdown: Record<string, GMModelStats> | null = null;
    private _windowOutsideAttribution = new Map<string, {
        basis: 'estimated' | 'gm_recovered';
        stepsByModel: Record<string, number>;
        categoriesByModel?: Record<string, { reasoning: number; toolCalls: number; errors: number; userInputs: number }>;
    }>();

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
        trajectories: {
            cascadeId: string;
            stepCount: number;
            status: string;
            requestedModel?: string;
            generatorModel?: string;
        }[],
        signal?: AbortSignal,
    ): Promise<boolean> {
        this._normalizeModelState();
        const trajMap = new Map<string, {
            stepCount: number;
            status: string;
            requestedModel: string;
            generatorModel: string;
        }>();
        for (const t of trajectories) {
            trajMap.set(t.cascadeId, {
                stepCount: t.stepCount,
                status: t.status,
                requestedModel: t.requestedModel ? normalizeModelDisplayName(t.requestedModel) : '',
                generatorModel: t.generatorModel ? normalizeModelDisplayName(t.generatorModel) : '',
            });
        }

        // Warm-up: process ALL conversations' steps for full quota-cycle stats
        if (!this._warmedUp) {
            // Collect ALL conversations' steps for post-warm-up timeline injection
            // BUG FIX: previously only RUNNING conversations got timeline events,
            // causing IDLE conversations' history to be permanently lost.
            const allConvSteps: { cascadeId: string; steps: Record<string, unknown>[]; totalSteps: number }[] = [];

            for (const [id, info] of trajMap) {
                const sc = info.stepCount || 0;
                if (sc === 0) {
                    this._trajectories.set(id, {
                        stepCount: 0,
                        processedIndex: 0,
                        dominantModel: '',
                        lastStatus: info.status,
                        requestedModel: info.requestedModel,
                        generatorModel: info.generatorModel,
                    });
                    continue;
                }
                try {
                    const sr = await rpcCall(ls, 'GetCascadeTrajectorySteps',
                        { cascadeId: id, startIndex: 0, endIndex: sc },
                        15000, signal) as Record<string, unknown>;
                    const allSteps = (sr.steps || []) as Record<string, unknown>[];
                    const detectedModel = this._detectDominantModel(allSteps);
                    for (const step of allSteps) {
                        this._processStep(step, false, undefined, detectedModel, id);
                    }
                    this._trajectories.set(id, {
                        stepCount: sc,
                        processedIndex: allSteps.length,
                        dominantModel: this._detectDominantModel(allSteps),
                        lastStatus: info.status,
                        requestedModel: info.requestedModel,
                        generatorModel: info.generatorModel,
                    });

                    // Track per-conversation breakdown
                    this._updateConversationBreakdown(id, allSteps);

                    // Collect steps from ALL conversations for timeline injection
                    if (allSteps.length > 0) {
                        allConvSteps.push({ cascadeId: id, steps: allSteps, totalSteps: sc });
                    }
                } catch {
                    this._trajectories.set(id, {
                        stepCount: sc,
                        processedIndex: 0,
                        dominantModel: '',
                        lastStatus: info.status,
                        requestedModel: info.requestedModel,
                        generatorModel: info.generatorModel,
                    });
                }
            }
            this._warmedUp = true;

            // Post-warm-up: inject recent timeline events from ALL conversations
            // Stats already counted above — this only creates StepEvent objects.
            // stepIndex uses ABSOLUTE index (offset-based) to align with GM stepIndices.
            // Collect all candidate events, then sort by timestamp and take the most recent.
            const maxEvents = getMaxRecentSteps();
            const candidateEvents: { step: Record<string, unknown>; absIdx: number; createdAt: string; cascadeId?: string }[] = [];
            for (const conv of allConvSteps) {
                const id = conv.cascadeId;
                const ts = conv.totalSteps;
                const steps = conv.steps;
                const offset = ts - steps.length; // absolute index offset
                const tail = steps.slice(-30);
                const startIdx = steps.length - tail.length;
                for (let i = 0; i < tail.length; i++) {
                    const step = tail[i];
                    const meta = (step.metadata || {}) as Record<string, unknown>;
                    const createdAt = (meta.createdAt as string) || '';
                    candidateEvents.push({ step, absIdx: startIdx + i + offset, createdAt, cascadeId: id });
                }
            }
            // Sort by timestamp descending, take the most recent maxEvents
            candidateEvents.sort((a, b) => {
                if (!a.createdAt || !b.createdAt) { return 0; }
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            const toInject = candidateEvents.slice(0, maxEvents).reverse(); // oldest first for chronological order
            for (const { step, absIdx, cascadeId } of toInject) {
                this._injectTimelineEvent(step, absIdx, cascadeId);
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
                entry = {
                    stepCount: 0,
                    processedIndex: 0,
                    dominantModel: '',
                    lastStatus: '',
                    requestedModel: info.requestedModel,
                    generatorModel: info.generatorModel,
                };
                this._trajectories.set(id, entry);
            }

            // Detect status transition FIRST (before any skip logic)
            const statusChanged = info.status === 'CASCADE_RUN_STATUS_RUNNING' && entry.lastStatus !== 'CASCADE_RUN_STATUS_RUNNING';
            entry.lastStatus = info.status;
            entry.requestedModel = info.requestedModel;
            entry.generatorModel = info.generatorModel;

            // Detect rollback/resend: stepCount decreased = steps were replaced
            if (currSteps < entry.stepCount) {
                entry.processedIndex = Math.min(entry.processedIndex, currSteps);
                this._clearWindowOutsideAttribution(id);
                this._clearPendingPlannerStepsFrom(id, currSteps);
                this._recentSteps = this._recentSteps.filter(ev =>
                    ev.cascadeId !== id || ev.stepIndex === undefined || ev.stepIndex < currSteps
                );
            }

            const hasPendingPlannerSteps = this._hasPendingPlannerSteps(id);
            const needsTailRefresh = this._tailRefreshQueue.has(id);

            // Skip if no new steps AND no status change
            if (currSteps <= entry.processedIndex && !statusChanged && !hasPendingPlannerSteps && !needsTailRefresh) {
                entry.stepCount = currSteps;
                continue;
            }

            // Skip IDLE conversations only if stepCount hasn't changed.
            if (
                entry.processedIndex > 0
                && info.status !== 'CASCADE_RUN_STATUS_RUNNING'
                && currSteps <= entry.stepCount
                && !statusChanged
                && !hasPendingPlannerSteps
                && !needsTailRefresh
            ) {
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
                    const absOffset = currSteps - steps.length; // absolute index offset

                    const ctxModel = this._detectDominantModel(steps);
                    for (let si = 0; si < steps.length; si++) {
                        this._processStep(steps[si], this._warmedUp, si + absOffset, ctxModel, id);
                    }
                    hasChanges = steps.length > 0;
                    // IMPORTANT: Steps API may expose only the visible window (~500 steps).
                    // processedIndex must track fetched visible steps, not declared total steps,
                    // otherwise window-outside GM calls are misclassified as already visible.
                    entry.processedIndex = steps.length;
                    entry.dominantModel = this._detectDominantModel(steps);
                    this._updateConversationBreakdown(id, steps);
                    if (this._refreshTimelineTail(steps, absOffset, id)) {
                        hasChanges = true;
                    }
                    this._tailRefreshQueue.delete(id);
                } else {
                    // INCREMENTAL: re-fetch steps to capture new ones precisely.
                    // API returns earliest ~500 steps; any beyond that use estimation.
                    const sr = await rpcCall(ls, 'GetCascadeTrajectorySteps',
                        { cascadeId: id, startIndex: 0, endIndex: currSteps },
                        15000, signal) as Record<string, unknown>;
                    const fetchedSteps = (sr.steps || []) as Record<string, unknown>[];

                    // Process individually any NEW steps within API window
                    // stepIndex uses ABSOLUTE index (offset-based) to align with GM stepIndices
                    const incOffset = currSteps - fetchedSteps.length;
                    const previousProcessedIndex = entry.processedIndex;
                    if (fetchedSteps.length > entry.processedIndex) {
                        const incModel = entry.dominantModel || this._detectDominantModel(fetchedSteps);
                        for (let i = entry.processedIndex; i < fetchedSteps.length; i++) {
                            this._processStep(fetchedSteps[i], true, i + incOffset, incModel, id);
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
                            this._injectTimelineEvent(tail[i], startIdx + i + incOffset, id);
                        }
                        hasChanges = true;
                    }

                    if (
                        fetchedSteps.length > 0
                        && (
                            previousProcessedIndex !== entry.processedIndex
                            || statusChanged
                            || hasPendingPlannerSteps
                            || needsTailRefresh
                        )
                    ) {
                        if (this._refreshTimelineTail(fetchedSteps, incOffset, id)) {
                            hasChanges = true;
                        }
                    }
                    this._tailRefreshQueue.delete(id);

                    // Any steps beyond API window → delta estimation (fallback)
                    const beyondApi = currSteps - Math.max(fetchedSteps.length, entry.stepCount);
                    const estimatedModel = entry.requestedModel || entry.generatorModel || entry.dominantModel;
                    const estimatedBasis = entry.requestedModel
                        ? 'summary'
                        : entry.generatorModel
                            ? 'generator'
                            : 'dominant';
                    if (beyondApi > 0 && estimatedModel) {
                        const estStart = Math.max(fetchedSteps.length, entry.stepCount);
                        this._pushEvent({
                            timestamp: new Date().toISOString(),
                            icon: '📊',
                            category: 'reasoning',
                            model: estimatedModel,
                            detail: `+${beyondApi} steps (estimated)`,
                            durationMs: 0,
                            stepIndex: estStart,
                            cascadeId: id,
                            source: 'estimated',
                            modelBasis: estimatedBasis,
                            estimatedCount: beyondApi,
                            estimatedResolved: false,
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

    private _processStep(step: Record<string, unknown>, emitEvent = true, stepIndex?: number, contextModel?: string, cascadeId?: string): void {
        const type = (step.type as string) || '';
        const meta = (step.metadata || {}) as Record<string, unknown>;
        const modelId = (meta.generatorModel as string) || '';
        const model = normalizeModelDisplayName(modelId);
        const cls = classifyStep(type);
        const dur = cls.category === 'tool' ? stepDurationTool(meta) : stepDurationReasoning(meta);
        const observedAt = (meta.createdAt as string) || new Date().toISOString();
        const timestamp = emitEvent ? observedAt : '';
        const stepFingerprint = buildRawStepFingerprint(step, cascadeId);

        // USER_INPUT
        if (cls.category === 'user') {
            this._totalUserInputs++;
            this._trackSample('', 'other');
            if (contextModel) {
                const s = this._getOrCreateStats(contextModel);
                s.userInputs++;
                if (!s.firstSeenAt || new Date(observedAt).getTime() < new Date(s.firstSeenAt).getTime()) {
                    s.firstSeenAt = observedAt;
                }
            }
            const userInput = step.userInput as Record<string, unknown> | undefined;
            const items = userInput?.items as Record<string, string>[] | undefined;
            const text = (Array.isArray(items) && items.length > 0 ? (items[0].text || '') : '')
                || (typeof userInput?.userResponse === 'string' ? userInput.userResponse : '');
            if (emitEvent) {
                this._upsertStepTimelineEvent({
                    timestamp,
                    icon: cls.icon,
                    category: 'user',
                    model: '',
                    detail: '',
                    durationMs: 0,
                    userInput: text ? truncate(text.replace(/\s*\n\s*/g, ' '), 40) : undefined,
                    fullUserInput: text || undefined,
                    stepIndex,
                    cascadeId,
                    source: 'step',
                    modelBasis: 'step',
                    stepFingerprint,
                });
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
                const attrModel = normalizeModelDisplayName(contextModel || model || mu.model || '');
                if (attrModel) {
                    const s = this._getOrCreateStats(attrModel);
                    s.totalSteps++;
                    s.checkpoints++;
                    s.inputTokens += inTok;
                    s.outputTokens += outTok;
                    if (!s.firstSeenAt || new Date(observedAt).getTime() < new Date(s.firstSeenAt).getTime()) {
                        s.firstSeenAt = observedAt;
                    }
                }
                // Track sub-agent: when modelUsage.model differs from attrModel
                const rawModel = mu.model || '';
                const rawDisplay = normalizeModelDisplayName(rawModel);
                const cacheTok = parseInt(mu.cacheReadTokens || '0', 10);
                if (rawModel && rawDisplay && rawDisplay !== attrModel) {
                    const key = `${rawModel}::${attrModel || 'unknown'}`;
                    const existing = this._subAgentTokens.get(key);
                    if (existing) {
                        // Detect compression: inputTokens dropped ≥30% vs previous checkpoint
                        const isCompression = existing.lastInputTokens > 0 && inTok < existing.lastInputTokens * 0.7;
                        existing.inputTokens += inTok;
                        existing.outputTokens += outTok;
                        existing.cacheReadTokens += cacheTok;
                        existing.count++;
                        if (isCompression) { existing.compressionEvents++; }
                        existing.lastInputTokens = inTok;
                        // Track conversation attribution
                        if (cascadeId && !existing.cascadeIds?.includes(cascadeId)) {
                            (existing.cascadeIds ??= []).push(cascadeId);
                        }
                    } else {
                        this._subAgentTokens.set(key, {
                            modelId: rawModel,
                            displayName: rawDisplay,
                            ownerModel: attrModel || undefined,
                            cascadeIds: cascadeId ? [cascadeId] : [],
                            inputTokens: inTok,
                            outputTokens: outTok,
                            cacheReadTokens: cacheTok,
                            count: 1,
                            compressionEvents: 0,
                            lastInputTokens: inTok,
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
                if (!s.firstSeenAt || new Date(observedAt).getTime() < new Date(s.firstSeenAt).getTime()) {
                    s.firstSeenAt = observedAt;
                }
            }
            if (emitEvent) {
                this._pushEvent({
                    timestamp,
                    icon: cls.icon,
                    category: 'system',
                    model: model || 'unknown',
                    detail: 'error',
                    durationMs: 0,
                    stepIndex,
                    cascadeId,
                    source: 'step',
                    modelBasis: 'step',
                });
            }
            return;
        }

        // NOTIFY_USER — AI 回复用户的实际正文
        if (type === 'CORTEX_STEP_TYPE_NOTIFY_USER') {
            const nu = (step.notifyUser || {}) as Record<string, unknown>;
            const text = ((nu.notificationContent || nu.message || '') as string).trim();
            if (text && emitEvent) {
                this._upsertStepTimelineEvent({
                    timestamp,
                    icon: '📢',
                    category: 'reasoning',
                    model: model || '',
                    detail: '',
                    durationMs: 0,
                    aiResponse: truncate(text, 96),
                    fullAiResponse: text.length > 96 ? truncate(text, 2000) : undefined,
                    stepIndex,
                    cascadeId,
                    source: 'step',
                    modelBasis: model ? 'step' : undefined,
                    stepFingerprint,
                });
            }
            return;
        }

        // Skip system steps without model
        if (!model) { return; }

        const s = this._getOrCreateStats(model);
        s.totalSteps++;
        if (!s.firstSeenAt || new Date(observedAt).getTime() < new Date(s.firstSeenAt).getTime()) {
            s.firstSeenAt = observedAt;
        }

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
            // Fallback: extract notify_user Message from toolCalls (actual AI reply)
            const notifyMsg = extractNotifyMessage(toolCalls as unknown[] | undefined);
            if (!resp && notifyMsg) {
                resp = notifyMsg;
                detail = '';  // 清除 '→ N tools'，这不是工具调用，是 AI 回复
            }
            // Fallback: show thinking duration if no response text
            if (!resp && tdStr) {
                resp = '正在思考';
            }
            // BUG FIX: skip empty PLANNER_RESPONSE events (no response, no thinking,
            // no toolCalls). These are LS internal decision steps that clutter the timeline.
            // Stats are still counted above — only the StepEvent is skipped.
            const hasContent = resp || (Array.isArray(toolCalls) && toolCalls.length > 0);
            if (emitEvent && hasContent) {
                // durationMs=0 for timeline: per-step thinking time is unreliable with 3s polling
                this._upsertStepTimelineEvent({
                    timestamp,
                    icon: cls.icon,
                    category: 'reasoning',
                    model,
                    detail,
                    durationMs: 0,
                    aiResponse: resp ? truncate(resp, 80) : undefined,
                    fullAiResponse: resp && resp.length > 80 ? truncate(resp, 2000) : undefined,
                    stepIndex,
                    cascadeId,
                    source: 'step',
                    modelBasis: 'step',
                    stepFingerprint,
                });
                this._clearPendingPlannerStep(cascadeId, stepIndex);
            } else if (emitEvent) {
                this._markPendingPlannerStep(cascadeId, stepIndex);
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
                this._upsertStepTimelineEvent({
                    timestamp,
                    icon: cls.icon,
                    category: 'tool',
                    model,
                    detail,
                    durationMs: dur,
                    toolName,
                    stepIndex,
                    cascadeId,
                    source: 'step',
                    modelBasis: 'step',
                    stepFingerprint,
                });
            }
        }
    }

    /**
     * Inject a timeline event from a step WITHOUT modifying any stats or counters.
     * Used after warm-up to populate the timeline with recent activity.
     * Uses LS's metadata.createdAt for timestamps since these are historical events.
     */
    private _injectTimelineEvent(step: Record<string, unknown>, stepIndex: number, cascadeId?: string): void {
        const event = this._buildStepTimelineEvent(step, stepIndex, cascadeId);
        if (event) {
            this._upsertStepTimelineEvent(event);
            this._clearPendingPlannerStep(cascadeId, stepIndex);
            return;
        }
        if ((step.type as string) === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
            this._markPendingPlannerStep(cascadeId, stepIndex);
        }
    }

    private _buildStepTimelineEvent(step: Record<string, unknown>, stepIndex: number, cascadeId?: string): StepEvent | null {
        const type = (step.type as string) || '';
        const meta = (step.metadata || {}) as Record<string, unknown>;
        const modelId = (meta.generatorModel as string) || '';
        const model = normalizeModelDisplayName(modelId);
        const cls = classifyStep(type);
        const createdAt = (meta.createdAt as string) || '';
        const timestamp = createdAt || this._sessionStartTime;
        const stepFingerprint = buildRawStepFingerprint(step, cascadeId);

        if (cls.category === 'user') {
            const userInput = step.userInput as Record<string, unknown> | undefined;
            const items = userInput?.items as Record<string, string>[] | undefined;
            const text = (Array.isArray(items) && items.length > 0 ? (items[0].text || '') : '')
                || (typeof userInput?.userResponse === 'string' ? userInput.userResponse : '');
            return {
                timestamp,
                icon: cls.icon,
                category: 'user',
                model: '',
                detail: '',
                durationMs: 0,
                userInput: text ? truncate(text.replace(/\s*\n\s*/g, ' '), 40) : undefined,
                fullUserInput: text || undefined,
                stepIndex,
                cascadeId,
                source: 'step',
                modelBasis: 'step',
                stepFingerprint,
            };
        }

        if (type === 'CORTEX_STEP_TYPE_NOTIFY_USER') {
            const nu = (step.notifyUser || {}) as Record<string, unknown>;
            const text = ((nu.notificationContent || nu.message || '') as string).trim();
            if (!text) { return null; }
            return {
                timestamp,
                icon: '📢',
                category: 'reasoning',
                model: model || '',
                detail: '',
                durationMs: 0,
                aiResponse: truncate(text, 96),
                fullAiResponse: text.length > 96 ? truncate(text, 2000) : undefined,
                stepIndex,
                cascadeId,
                source: 'step',
                modelBasis: model ? 'step' : undefined,
                stepFingerprint,
            };
        }

        if (cls.category === 'system' || !model) { return null; }

        if (cls.category === 'reasoning') {
            const pr = step.plannerResponse as Record<string, unknown> | undefined;
            let detail = '';
            const toolCalls = pr?.toolCalls as unknown[] | undefined;
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                detail = `→ ${toolCalls.length} ${toolCalls.length === 1 ? 'tool' : 'tools'}`;
            }
            const tdStr = pr?.thinkingDuration as string | undefined;
            let aiResp = ((pr?.modifiedResponse || pr?.response || '') as string);
            const notifyMsg = extractNotifyMessage(toolCalls as unknown[] | undefined);
            if (!aiResp && notifyMsg) {
                aiResp = notifyMsg;
                detail = '';
            }
            if (!aiResp && tdStr) {
                aiResp = '正在思考';
            }
            const hasContent = aiResp || (Array.isArray(toolCalls) && toolCalls.length > 0);
            if (!hasContent) { return null; }
            return {
                timestamp,
                icon: cls.icon,
                category: 'reasoning',
                model,
                detail,
                durationMs: 0,
                aiResponse: aiResp ? truncate(aiResp, 80) : undefined,
                fullAiResponse: aiResp && aiResp.length > 80 ? truncate(aiResp, 2000) : undefined,
                stepIndex,
                cascadeId,
                source: 'step',
                modelBasis: 'step',
                stepFingerprint,
            };
        }

        if (cls.category === 'tool') {
            return {
                timestamp,
                icon: cls.icon,
                category: 'tool',
                model,
                detail: extractToolDetail(step),
                durationMs: stepDurationTool(meta),
                toolName: extractToolName(step, cls.label),
                stepIndex,
                cascadeId,
                source: 'step',
                modelBasis: 'step',
                stepFingerprint,
            };
        }

        return null;
    }

    private _findMatchingStepTimelineEvent(event: StepEvent): StepEvent | undefined {
        const fingerprint = event.stepFingerprint;
        const legacyIdentity = buildLegacyStepEventIdentity(event);
        return this._recentSteps.find(ev =>
            ev.source === 'step'
            && ev.cascadeId === event.cascadeId
            && (
                (!!fingerprint && !!ev.stepFingerprint && ev.stepFingerprint === fingerprint)
                || (!fingerprint && !ev.stepFingerprint && buildLegacyStepEventIdentity(ev) === legacyIdentity)
            )
        );
    }

    private _mergeStepTimelineEvent(existing: StepEvent, event: StepEvent): boolean {
        let changed = false;
        const mergeKeys: Array<keyof StepEvent> = [
            'timestamp',
            'icon',
            'category',
            'model',
            'detail',
            'durationMs',
            'userInput',
            'fullUserInput',
            'aiResponse',
            'fullAiResponse',
            'browserSub',
            'toolName',
            'modelBasis',
            'stepIndex',
            'stepFingerprint',
        ];
        for (const key of mergeKeys) {
            if (!(key in event)) { continue; }
            if (existing[key] !== event[key]) {
                existing[key] = event[key] as never;
                changed = true;
            }
        }
        return changed;
    }

    private _sanitizeUserTimelineEvent(event: StepEvent): boolean {
        if (event.category !== 'user') { return false; }
        let changed = false;
        if (event.model) {
            event.model = '';
            changed = true;
        }
        if (event.source === 'step' && event.modelBasis !== 'step') {
            event.modelBasis = 'step';
            changed = true;
        }
        const gmKeys: Array<keyof StepEvent> = [
            'gmInputTokens',
            'gmOutputTokens',
            'gmThinkingTokens',
            'gmCacheReadTokens',
            'gmCredits',
            'gmTTFT',
            'gmStreamingDuration',
            'gmRetries',
            'gmRetryHas429',
            'gmModel',
            'gmModelAccuracy',
            'gmPromptSnippet',
            'gmPromptSource',
            'gmExecutionId',
            'gmLatestStableMessageIndex',
            'gmStartStepIndex',
            'gmContextTokensUsed',
        ];
        for (const key of gmKeys) {
            if (event[key] !== undefined) {
                delete event[key];
                changed = true;
            }
        }
        return changed;
    }

    private _compactRecentSteps(): void {
        const deduped = new Map<string, StepEvent>();
        for (const rawEvent of this._recentSteps) {
            const event = { ...rawEvent };
            this._sanitizeUserTimelineEvent(event);
            const dedupeKey = event.source === 'step'
                ? `${event.cascadeId || ''}|${event.stepFingerprint || buildLegacyStepEventIdentity(event)}`
                : `${event.cascadeId || ''}|${event.source || ''}|${buildLegacyStepEventIdentity(event)}`;
            const existing = deduped.get(dedupeKey);
            if (!existing) {
                deduped.set(dedupeKey, event);
                continue;
            }
            this._mergeStepTimelineEvent(existing, event);
        }
        this._recentSteps = [...deduped.values()];
        this._sortRecentSteps();
        const max = getMaxRecentSteps();
        if (this._recentSteps.length > max) {
            this._recentSteps = this._recentSteps.slice(-max);
        }
    }

    private _upsertStepTimelineEvent(event: StepEvent): boolean {
        const existing = this._findMatchingStepTimelineEvent(event);
        if (!existing) {
            this._pushEvent(event);
            return true;
        }

        const changed = this._mergeStepTimelineEvent(existing, event);
        if (changed) {
            this._compactRecentSteps();
        }
        return changed;
    }

    private _refreshTimelineTail(steps: Record<string, unknown>[], absOffset: number, cascadeId: string): boolean {
        if (steps.length === 0) { return false; }

        const pending = this._pendingPlannerSteps.get(cascadeId);
        const targetIndices = new Set<number>();
        const tailStart = Math.max(0, steps.length - STEP_TAIL_REFRESH_WINDOW);
        for (let i = tailStart; i < steps.length; i++) {
            targetIndices.add(i);
        }
        if (pending) {
            for (const stepIndex of pending.keys()) {
                const localIndex = stepIndex - absOffset;
                if (localIndex >= 0 && localIndex < steps.length) {
                    targetIndices.add(localIndex);
                }
            }
        }

        let changed = false;
        for (const localIndex of [...targetIndices].sort((a, b) => a - b)) {
            const step = steps[localIndex];
            const stepIndex = localIndex + absOffset;
            const event = this._buildStepTimelineEvent(step, stepIndex, cascadeId);
            if (event) {
                if (this._upsertStepTimelineEvent(event)) {
                    changed = true;
                }
                this._clearPendingPlannerStep(cascadeId, stepIndex);
                continue;
            }

            if (this._removeStepTimelineEvent(cascadeId, stepIndex, step)) {
                changed = true;
            }

            if ((step.type as string) !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
                continue;
            }
            if (this._markPendingPlannerStep(cascadeId, stepIndex)) {
                changed = true;
            }
        }

        return changed;
    }

    private _removeStepTimelineEvent(cascadeId: string, stepIndex: number, rawStep?: Record<string, unknown>): boolean {
        const fingerprint = rawStep ? buildRawStepFingerprint(rawStep, cascadeId) : undefined;
        const category = rawStep ? classifyStep((rawStep.type as string) || '').category : undefined;
        const before = this._recentSteps.length;
        this._recentSteps = this._recentSteps.filter(ev =>
            !(
                ev.source === 'step'
                && ev.cascadeId === cascadeId
                && (
                    (!!fingerprint && ev.stepFingerprint === fingerprint)
                    || (
                        ev.stepIndex === stepIndex
                        && (
                            category === undefined
                            || (category === 'system' ? ev.category === 'reasoning' : ev.category === category)
                        )
                    )
                )
            )
        );
        return this._recentSteps.length !== before;
    }

    private _hasPendingPlannerSteps(cascadeId: string): boolean {
        return (this._pendingPlannerSteps.get(cascadeId)?.size || 0) > 0;
    }

    private _markPendingPlannerStep(cascadeId?: string, stepIndex?: number): boolean {
        if (!cascadeId || stepIndex === undefined) { return false; }
        let pending = this._pendingPlannerSteps.get(cascadeId);
        if (!pending) {
            pending = new Map<number, number>();
            this._pendingPlannerSteps.set(cascadeId, pending);
        }
        const attempts = pending.get(stepIndex);
        if (attempts === undefined) {
            pending.set(stepIndex, 0);
            return true;
        }
        if (attempts + 1 >= MAX_PENDING_PLANNER_REFRESH_ATTEMPTS) {
            pending.delete(stepIndex);
            if (pending.size === 0) {
                this._pendingPlannerSteps.delete(cascadeId);
            }
            return false;
        }
        pending.set(stepIndex, attempts + 1);
        return false;
    }

    private _clearPendingPlannerStep(cascadeId?: string, stepIndex?: number): void {
        if (!cascadeId || stepIndex === undefined) { return; }
        const pending = this._pendingPlannerSteps.get(cascadeId);
        if (!pending) { return; }
        pending.delete(stepIndex);
        if (pending.size === 0) {
            this._pendingPlannerSteps.delete(cascadeId);
        }
    }

    private _clearPendingPlannerStepsFrom(cascadeId: string, minStepIndexExclusive: number): void {
        const pending = this._pendingPlannerSteps.get(cascadeId);
        if (!pending) { return; }
        for (const stepIndex of [...pending.keys()]) {
            if (stepIndex >= minStepIndexExclusive) {
                pending.delete(stepIndex);
            }
        }
        if (pending.size === 0) {
            this._pendingPlannerSteps.delete(cascadeId);
        }
    }

    // ─── Sample Distribution ────────────────────────────────────────────

    /** Record a step's model+category into the sample distribution table */
    private _trackSample(model: string, cat: 'reasoning' | 'toolCalls' | 'errors' | 'other'): void {
        this._sampleTotal++;
        const normalizedModel = normalizeModelDisplayName(model) || model;
        let d = this._sampleDist.get(normalizedModel);
        if (!d) { d = { reasoning: 0, toolCalls: 0, errors: 0, other: 0 }; this._sampleDist.set(normalizedModel, d); }
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
            const model = normalizeModelDisplayName(modelId);
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

    // ─── GM Data Injection ─────────────────────────────────────────────────

    /**
     * Inject GM precision data into existing StepEvents.
     * Called from pollActivity() after gmTracker.fetchAll().
     * Uses stepIndex matching to correlate GM calls → StepEvents.
     */
    injectGMData(gmSummary: GMSummary | null): boolean {
        this._normalizeModelState();
        let timelineChanged = false;
        // Cache global aggregates — getSummary() will always return these
        // regardless of which poll path triggers the panel update
        if (gmSummary) {
            this._gmTotals = {
                inputTokens: gmSummary.totalInputTokens,
                outputTokens: gmSummary.totalOutputTokens,
                cacheRead: gmSummary.totalCacheRead,
                credits: gmSummary.totalCredits,
                retries: Object.values(gmSummary.modelBreakdown)
                    .reduce((sum, m) => sum + m.totalRetries, 0),
            };
            const mergedBreakdown: Record<string, GMModelStats> = {};
            for (const [name, stats] of Object.entries(gmSummary.modelBreakdown)) {
                const normalizedName = normalizeModelDisplayName(name) || name;
                const existing = mergedBreakdown[normalizedName];
                if (existing) {
                    mergeGMStats(existing, stats);
                } else {
                    mergedBreakdown[normalizedName] = {
                        ...stats,
                        promptSectionTitles: [...stats.promptSectionTitles],
                        completionConfig: stats.completionConfig ? { ...stats.completionConfig } : null,
                    };
                }
            }
            this._gmModelBreakdown = mergedBreakdown;
        }
        if (!gmSummary) { return false; }

        // Rebuild virtual GM events on every inject to avoid duplicate timeline rows.
        this._recentSteps = this._recentSteps.filter(ev => ev.source !== 'gm_virtual' && ev.source !== 'gm_user');

        // Build cascadeId+stepIndex → GMCallEntry lookup from all conversations
        const gmByStep = new Map<string, GMCallEntry>();
        const virtualEvents: StepEvent[] = [];
        const userAnchorEvents: StepEvent[] = [];
        const seenVirtualKeys = new Set<string>();
        const seenUserAnchors = new Set<string>();
        for (const conv of gmSummary.conversations) {
            for (const call of conv.calls) {
                for (const idx of call.stepIndices) {
                    gmByStep.set(buildGMEventKey(conv.cascadeId, idx), call);
                }
            }
            const trajEntry = this._trajectories.get(conv.cascadeId);
            const visibleStepCount = trajEntry?.processedIndex || 0;
            // All GM calls (for unified virtual events)
            const allCallsForVirtual = conv.calls.filter(call =>
                call.stepIndices.length > 0
            );
            // Outside-window calls only (for category counting & attribution)
            const outsideCalls = allCallsForVirtual.filter(call =>
                call.stepIndices.every(idx => idx >= visibleStepCount)
            );

            const sortedOutsideCalls = [...outsideCalls].sort((a, b) => {
                const aIdx = a.stepIndices.length > 0 ? Math.min(...a.stepIndices) : -1;
                const bIdx = b.stepIndices.length > 0 ? Math.min(...b.stepIndices) : -1;
                return aIdx - bIdx;
            });
            const recoveredStepsByModel: Record<string, number> = {};
            const categoriesByModel: Record<string, { reasoning: number; toolCalls: number; errors: number; userInputs: number }> = {};
            const seenOutsideUsers = new Set<string>();
            for (const call of sortedOutsideCalls) {
                const mn = normalizeModelDisplayName(call.modelDisplay || call.model) || call.responseModel || call.modelDisplay || call.model;
                if (!mn) { continue; }
                recoveredStepsByModel[mn] = (recoveredStepsByModel[mn] || 0) + call.stepIndices.length;
                if (!categoriesByModel[mn]) {
                    categoriesByModel[mn] = { reasoning: 0, toolCalls: 0, errors: 0, userInputs: 0 };
                }
                // Skip interrupted calls for category counting
                if (call.inputTokens === 0 && call.outputTokens === 0) { continue; }
                // Each non-interrupted GM call = 1 reasoning step (1 LLM invocation)
                categoriesByModel[mn].reasoning++;
                // Tool calls = remaining steps in this call (stepIndices minus the PLANNER_RESPONSE itself)
                categoriesByModel[mn].toolCalls += Math.max(0, call.stepIndices.length - 1);
                // Errors
                if (call.hasError) { categoriesByModel[mn].errors++; }
                // User inputs from anchors
                for (const anchor of call.userMessageAnchors) {
                    if (anchor.stepIndex < visibleStepCount) { continue; }
                    const uKey = `${conv.cascadeId}:${anchor.stepIndex}`;
                    if (seenOutsideUsers.has(uKey)) { continue; }
                    seenOutsideUsers.add(uKey);
                    categoriesByModel[mn].userInputs++;
                }
            }
            if (Object.keys(recoveredStepsByModel).length > 0) {
                this._reconcileWindowOutsideAttribution(conv.cascadeId, 'gm_recovered', recoveredStepsByModel, categoriesByModel);
            }

            for (const call of sortedOutsideCalls) {
                for (const anchor of call.userMessageAnchors) {
                    if (anchor.stepIndex < visibleStepCount) { continue; }
                    // Filter out EPHEMERAL/system messages that GM captures as user anchors
                    const anchorText = (anchor.text || '').trim();
                    if (anchorText.startsWith('The following is an <EPHEMERAL_MESSAGE>')) { continue; }
                    if (anchorText.startsWith('Step Id:') && /CHECKPOINT/.test(anchorText)) { continue; }
                    const anchorKey = `${conv.cascadeId}:${anchor.stepIndex}`;
                    if (seenUserAnchors.has(anchorKey)) { continue; }
                    seenUserAnchors.add(anchorKey);
                    // Deduplicate by trimmed text — same user message can appear as
                    // anchors across multiple GM calls with different stepIndex offsets.
                    const anchorTextKey = `${conv.cascadeId}:${(anchor.text || '').trim().slice(0, 120)}`;
                    if (seenUserAnchors.has(anchorTextKey)) { continue; }
                    seenUserAnchors.add(anchorTextKey);
                    const nextCall = sortedOutsideCalls.find(candidate =>
                        candidate.stepIndices.length > 0
                        && Math.min(...candidate.stepIndices) > anchor.stepIndex
                    );
                    const anchorTimestamp = nextCall?.createdAt || call.createdAt || '';
                    userAnchorEvents.push({
                        timestamp: anchorTimestamp,
                        icon: '💬',
                        category: 'user',
                        model: '',
                        detail: '',
                        durationMs: 0,
                        cascadeId: conv.cascadeId,
                        source: 'gm_user',
                        modelBasis: 'gm_exact',
                        stepIndex: anchor.stepIndex,
                        userInput: truncate(anchor.text.replace(/\s*\n\s*/g, ' '), 40),
                        fullUserInput: anchor.text || undefined,
                    });
                }
            }

            for (const call of allCallsForVirtual) {
                const firstIdx = Math.min(...call.stepIndices);
                // IMPORTANT: one execution round may contain multiple distinct LLM calls.
                // Deduplicating by executionId collapses real recent activity into a single row.
                // Use per-call step span as the identity so every GM call can surface.
                const virtualKey = `${conv.cascadeId}:${call.stepIndices.join(',')}:${call.responseModel || call.model}`;
                if (seenVirtualKeys.has(virtualKey)) { continue; }
                seenVirtualKeys.add(virtualKey);

                const preview = buildGMVirtualPreview(call);
                const virtualDetail = preview.detail;
                virtualEvents.push({
                    timestamp: call.createdAt || '',
                    icon: '🧠',
                    category: 'reasoning',
                    model: normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model || '',
                    detail: virtualDetail,
                    durationMs: Math.round((call.ttftSeconds + call.streamingSeconds) * 1000),
                    cascadeId: conv.cascadeId,
                    source: 'gm_virtual',
                    modelBasis: call.modelAccuracy === 'exact' ? 'gm_exact' : 'gm_placeholder',
                    stepIndex: firstIdx,
                    aiResponse: preview.aiResponse,
                    gmInputTokens: call.inputTokens,
                    gmOutputTokens: call.outputTokens,
                    gmThinkingTokens: call.thinkingTokens,
                    gmCacheReadTokens: call.cacheReadTokens,
                    gmCredits: call.credits,
                    gmTTFT: call.ttftSeconds,
                    gmStreamingDuration: call.streamingSeconds,
                    gmRetries: call.retries,
                    gmRetryHas429: call.retryErrors.some(e => e.includes('429') || e.includes('RESOURCE_EXHAUSTED')),
                    gmModel: call.responseModel || call.model,
                    gmModelAccuracy: call.modelAccuracy,
                    gmPromptSnippet: call.promptSnippet || undefined,
                    gmPromptSource: call.promptSource,
                    gmExecutionId: call.executionId || undefined,
                    gmLatestStableMessageIndex: call.latestStableMessageIndex || undefined,
                    gmStartStepIndex: call.startStepIndex || undefined,
                    gmContextTokensUsed: call.contextTokensUsed || undefined,
                });
            }
        }

        if (gmByStep.size === 0) { return timelineChanged; }

        // Annotate existing StepEvents
        for (const ev of this._recentSteps) {
            if (ev.category === 'user') {
                if (this._sanitizeUserTimelineEvent(ev)) {
                    timelineChanged = true;
                }
                continue;
            }
            if (ev.source === 'step' && ev.category !== 'reasoning') {
                continue;
            }
            if (ev.stepIndex === undefined || !ev.cascadeId) { continue; }
            let gm = gmByStep.get(buildGMEventKey(ev.cascadeId, ev.stepIndex));
            // Fallback: some PLANNER_RESPONSE steps share an LLM call with adjacent steps
            // but their stepIndex isn't in GM's stepIndices. Try ±1..3 neighbors.
            if (!gm && ev.category === 'reasoning') {
                for (let d = 1; d <= 3 && !gm; d++) {
                    gm = gmByStep.get(buildGMEventKey(ev.cascadeId, ev.stepIndex + d))
                        || gmByStep.get(buildGMEventKey(ev.cascadeId, ev.stepIndex - d));
                }
            }
            if (!gm) { continue; }
            // Detect first-time GM annotation → triggers panel refresh
            if (ev.gmInputTokens === undefined && gm.inputTokens !== undefined) {
                timelineChanged = true;
            }
            ev.gmInputTokens = gm.inputTokens;
            ev.gmOutputTokens = gm.outputTokens;
            ev.gmThinkingTokens = gm.thinkingTokens;
            ev.gmCacheReadTokens = gm.cacheReadTokens;
            ev.gmCredits = gm.credits;
            ev.gmTTFT = gm.ttftSeconds;
            ev.gmStreamingDuration = gm.streamingSeconds;
            ev.gmRetries = gm.retries;
            ev.gmRetryHas429 = gm.retryErrors.some(e => e.includes('429') || e.includes('RESOURCE_EXHAUSTED'));
            ev.gmModel = gm.responseModel || gm.model;
            ev.gmModelAccuracy = gm.modelAccuracy;
            ev.gmPromptSnippet = gm.promptSnippet || undefined;
            ev.gmPromptSource = gm.promptSource;
            ev.gmExecutionId = gm.executionId || undefined;
            ev.gmLatestStableMessageIndex = gm.latestStableMessageIndex || undefined;
            ev.gmStartStepIndex = gm.startStepIndex || undefined;
            ev.gmContextTokensUsed = gm.contextTokensUsed || undefined;
            // When GM proves the real model for an estimated/virtual row, the row title
            // must follow the GM result as well. Otherwise users see "Opus" on the left
            // but "exact sonnet" in GM tags on the right, which is misleading.
            if (gm.modelDisplay && (ev.source === 'estimated' || ev.source === 'gm_virtual' || gm.modelAccuracy === 'exact')) {
                ev.model = normalizeModelDisplayName(gm.modelDisplay || gm.model) || gm.modelDisplay || gm.model;
            }
            if (gm.modelAccuracy === 'exact') {
                ev.modelBasis = 'gm_exact';
            } else if (ev.source !== 'estimated') {
                ev.modelBasis = 'gm_placeholder';
            }
            if (ev.source === 'estimated' && gm.modelDisplay) {
                ev.model = normalizeModelDisplayName(gm.modelDisplay || gm.model) || gm.modelDisplay || gm.model;
            }
        }

        // Resolve estimated placeholders using nearby recovered GM calls from the same conversation.
        for (const ev of this._recentSteps) {
            if (ev.source !== 'estimated' || ev.stepIndex === undefined || !ev.cascadeId || !ev.estimatedCount) {
                continue;
            }
            const conv = gmSummary.conversations.find(item => item.cascadeId === ev.cascadeId);
            if (!conv) { continue; }
            const rangeStart = ev.stepIndex;
            const rangeEnd = ev.stepIndex + ev.estimatedCount + 1; // tolerate LS/GM off-by-one
            const matchedCalls = conv.calls.filter(call => {
                if (call.stepIndices.length === 0) { return false; }
                const firstIdx = Math.min(...call.stepIndices);
                return firstIdx >= rangeStart && firstIdx <= rangeEnd;
            });
            if (matchedCalls.length === 0) { continue; }

            ev.estimatedResolved = true;
            timelineChanged = true;
            const modelNames = [...new Set(
                matchedCalls
                    .map(call => normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model)
                    .filter(Boolean)
            )];
            if (modelNames.length === 1) {
                ev.model = modelNames[0];
            }
            const exactOnly = matchedCalls.every(call => call.modelAccuracy === 'exact');
            const placeholderOnly = matchedCalls.every(call => call.modelAccuracy === 'placeholder');
            if (exactOnly) {
                ev.modelBasis = 'gm_exact';
            } else if (placeholderOnly) {
                ev.modelBasis = 'gm_placeholder';
            }
            ev.detail = `+${ev.estimatedCount} steps (${matchedCalls.length} GM)`;
        }

        // Remove resolved estimated events — gm_virtual rows now cover them with richer data.
        this._recentSteps = this._recentSteps.filter(ev =>
            ev.source !== 'estimated' || !ev.estimatedResolved
        );

        // Filter gm_user anchors whose text duplicates an existing step-source user event.
        const stepUserTexts = new Set(
            this._recentSteps
                .filter(ev => ev.source === 'step' && ev.category === 'user' && ev.userInput)
                .map(ev => (ev.userInput || '').trim().slice(0, 120))
        );
        const dedupedUserAnchors = userAnchorEvents.filter(ev =>
            !stepUserTexts.has((ev.userInput || '').trim().slice(0, 120))
        );

        if (dedupedUserAnchors.length > 0 || virtualEvents.length > 0) {
            timelineChanged = true;

            // Suppress step-source reasoning/tool events that are now covered by
            // richer GM virtual events. Use RANGE-based suppression: for each
            // conversation, find the max stepIndex covered by GM, then suppress
            // all step-source events with stepIndex <= maxGMStep. This catches
            // gap steps (CHECKPOINT, ERROR, system) that fall between GM calls.
            const maxGMStepByConv = new Map<string, number>();
            for (const conv of gmSummary.conversations) {
                let maxStep = -1;
                for (const call of conv.calls) {
                    for (const idx of call.stepIndices) {
                        if (idx > maxStep) maxStep = idx;
                    }
                }
                if (maxStep >= 0) {
                    maxGMStepByConv.set(conv.cascadeId, maxStep);
                }
            }
            // Remove step-source events whose stepIndex falls within GM coverage range
            this._recentSteps = this._recentSteps.filter(ev => {
                if (ev.source !== 'step') return true;
                if (ev.category === 'user') return true; // keep user events
                if (ev.stepIndex === undefined || !ev.cascadeId) return true;
                const maxStep = maxGMStepByConv.get(ev.cascadeId);
                if (maxStep === undefined) return true; // no GM data for this conv
                return ev.stepIndex > maxStep; // keep only steps beyond GM coverage
            });

            this._recentSteps = [...this._recentSteps, ...dedupedUserAnchors, ...virtualEvents];
            this._compactRecentSteps();
        }

        // ── GM-based sub-agent supplement: covers calls OUTSIDE the Steps API window ──
        // Rebuilt from scratch each call → no dedup state needed
        this._gmSubAgentTokens.clear();
        for (const conv of gmSummary.conversations) {
            // Determine the CP processing window boundary for this conversation
            const trajEntry = this._trajectories.get(conv.cascadeId);
            const visibleStepCount = trajEntry?.processedIndex || 0;

            // Determine dominant model: prefer trajectory cache, fall back to GM frequency
            let dominantModel = trajEntry?.requestedModel || trajEntry?.generatorModel || trajEntry?.dominantModel || '';
            if (!dominantModel && conv.calls.length > 0) {
                const freq = new Map<string, number>();
                for (const c of conv.calls) {
                    const dm = normalizeModelDisplayName(c.modelDisplay || c.model) || c.responseModel || c.modelDisplay || c.model || '';
                    if (dm) { freq.set(dm, (freq.get(dm) || 0) + 1); }
                }
                let topCount = 0;
                for (const [m, cnt] of freq) {
                    if (cnt > topCount) { topCount = cnt; dominantModel = m; }
                }
            }
            if (!dominantModel) { continue; }

            for (const call of conv.calls) {
                // Skip calls within the CP processing window (already captured by _processStep)
                const allInsideWindow = call.stepIndices.length > 0
                    && call.stepIndices.every(idx => idx < visibleStepCount);
                if (allInsideWindow) { continue; }

                // Skip if this is the main model (not a sub-agent)
                const callDisplay = normalizeModelDisplayName(call.modelDisplay || call.model) || call.responseModel || call.modelDisplay || call.model || '';
                if (!callDisplay || callDisplay === dominantModel) { continue; }

                // This is a sub-agent call from OUTSIDE the CP window → supplement
                const key = `${call.model}::${dominantModel}`;
                const existing = this._gmSubAgentTokens.get(key);
                if (existing) {
                    existing.inputTokens += call.inputTokens;
                    existing.outputTokens += call.outputTokens;
                    existing.cacheReadTokens += call.cacheReadTokens;
                    existing.count++;
                    if (conv.cascadeId && !existing.cascadeIds?.includes(conv.cascadeId)) {
                        (existing.cascadeIds ??= []).push(conv.cascadeId);
                    }
                } else {
                    this._gmSubAgentTokens.set(key, {
                        modelId: call.model,
                        displayName: callDisplay,
                        ownerModel: dominantModel,
                        cascadeIds: [conv.cascadeId],
                        inputTokens: call.inputTokens,
                        outputTokens: call.outputTokens,
                        cacheReadTokens: call.cacheReadTokens,
                        count: 1,
                        compressionEvents: 0,
                        lastInputTokens: call.inputTokens,
                    });
                }
            }
        }

        // ── P2: Correct conversationBreakdown steps count from GM ──
        // Steps API window limits the step count visible to _updateConversationBreakdown.
        // GM's totalSteps is accurate (no window limit).
        for (const conv of gmSummary.conversations) {
            const existing = this._conversationBreakdown.get(conv.cascadeId);
            if (existing && conv.totalSteps > existing.steps) {
                existing.steps = conv.totalSteps;
            }
        }

        // ── P3: Supplement checkpointHistory with GM contextGrowth ──
        // GM contextGrowth has per-call context token snapshots (no window limit).
        // Append data points from OUTSIDE the visible step window to fill history gaps.
        // Guard: only inject once (detect by checking if head already has virtual snapshots)
        const alreadyInjected = this._checkpointHistory.some(point => point.timestamp === '');
        const visibleBoundary = Math.max(
            0,
            ...Array.from(this._trajectories.values()).map(entry => entry.processedIndex),
        );
        if (!alreadyInjected && gmSummary.contextGrowth.length > 0 && visibleBoundary > 0) {
            const outsideGrowth = gmSummary.contextGrowth
                .filter(pt => pt.step >= visibleBoundary && pt.tokens > 0);

            if (outsideGrowth.length > 0) {
                // Build virtual CheckpointSnapshots from GM contextGrowth
                const virtualHistory: CheckpointSnapshot[] = outsideGrowth.map(pt => ({
                    timestamp: '',   // GM doesn't provide per-point timestamps
                    inputTokens: pt.tokens,
                    outputTokens: 0, // GM contextGrowth only provides total context size
                    compressed: false,
                }));
                // Detect compression in virtual history
                for (let i = 1; i < virtualHistory.length; i++) {
                    if (virtualHistory[i].inputTokens < virtualHistory[i - 1].inputTokens * 0.7) {
                        virtualHistory[i].compressed = true;
                    }
                }
                // Append to existing checkpoint history (which only covers the visible window)
                this._checkpointHistory = [...this._checkpointHistory, ...virtualHistory];
            }
        }
        this._compactRecentSteps();
        return timelineChanged;
    }

    // ─── State Accessors ───────────────────────────────────────────────────

    getSummary(): ActivitySummary {
        this._normalizeModelState();
        const modelStats: Record<string, ModelActivityStats> = {};
        let totalUserInputs = 0, totalReasoning = 0, totalToolCalls = 0, totalErrors = 0, totalCheckpoints = 0;
        let estSteps = 0;
        let totalInputTokens = 0, totalOutputTokens = 0, totalToolReturnTokens = 0;
        let sessionStartTime = this._sessionStartTime;

        for (const [name, s] of this._modelStats) {
            modelStats[name] = { ...s };
            totalUserInputs += s.userInputs;
            totalReasoning += s.reasoning;
            totalToolCalls += s.toolCalls;
            totalErrors += s.errors;
            totalCheckpoints += s.checkpoints;
            estSteps += s.estSteps;
            totalInputTokens += s.inputTokens;
            totalOutputTokens += s.outputTokens;
            totalToolReturnTokens += s.toolReturnTokens;
            if (s.firstSeenAt && (!sessionStartTime || new Date(s.firstSeenAt).getTime() < new Date(sessionStartTime).getTime())) {
                sessionStartTime = s.firstSeenAt;
            }
        }

        const globalToolStats: Record<string, number> = {};
        for (const stats of Object.values(modelStats)) {
            for (const [toolName, count] of Object.entries(stats.toolBreakdown)) {
                globalToolStats[toolName] = (globalToolStats[toolName] || 0) + count;
            }
        }

        // Merge CP-based sub-agent data with GM supplements (window-outside calls)
        const subAgentMerged = new Map<string, SubAgentTokenEntry>();
        // 1. Start with CP-based data (persisted, within step window)
        for (const [key, entry] of this._subAgentTokens) {
            subAgentMerged.set(key, { ...entry });
        }
        // 2. Merge GM supplements (outside step window, runtime-only)
        for (const [key, gmEntry] of this._gmSubAgentTokens) {
            const existing = subAgentMerged.get(key);
            if (existing) {
                existing.inputTokens += gmEntry.inputTokens;
                existing.outputTokens += gmEntry.outputTokens;
                existing.cacheReadTokens += gmEntry.cacheReadTokens;
                existing.count += gmEntry.count;
                // Merge cascadeIds
                if (gmEntry.cascadeIds) {
                    for (const cid of gmEntry.cascadeIds) {
                        if (!existing.cascadeIds?.includes(cid)) {
                            (existing.cascadeIds ??= []).push(cid);
                        }
                    }
                }
            } else {
                subAgentMerged.set(key, { ...gmEntry, cascadeIds: [...(gmEntry.cascadeIds || [])] });
            }
        }
        const subAgentTokens: SubAgentTokenEntry[] = [...subAgentMerged.values()];

        const conversationBreakdown: ConversationBreakdown[] = [];
        for (const [, entry] of this._conversationBreakdown) {
            conversationBreakdown.push({ ...entry });
        }
        conversationBreakdown.sort((a, b) => b.steps - a.steps);

        // GM precision aggregates from annotated recent steps
        let gmIn = 0, gmOut = 0, gmCache = 0, gmCredits = 0, gmRetries = 0;
        let gmAnnotated = 0;
        const gmSeen = new Set<string>();  // deduplicate by cascadeId+stepIndex
        for (const ev of this._recentSteps) {
            const gmKey = ev.stepIndex !== undefined ? buildGMEventKey(ev.cascadeId, ev.stepIndex) : '';
            if (ev.stepIndex !== undefined && ev.gmInputTokens !== undefined && gmKey && !gmSeen.has(gmKey)) {
                gmSeen.add(gmKey);
                gmAnnotated++;
                gmIn += ev.gmInputTokens;
                gmOut += (ev.gmOutputTokens || 0);
                gmCache += (ev.gmCacheReadTokens || 0);
                gmCredits += (ev.gmCredits || 0);
                gmRetries += (ev.gmRetries || 0);
            }
        }
        const gmEligible = this._recentSteps.filter(e =>
            e.category === 'reasoning' || e.category === 'tool'
        ).length;

        return {
            totalUserInputs,
            totalReasoning,
            totalToolCalls,
            totalErrors,
            totalCheckpoints,
            totalInputTokens,
            totalOutputTokens,
            totalToolReturnTokens,
            estSteps,
            modelStats,
            globalToolStats,
            recentSteps: [...this._recentSteps],
            sessionStartTime,
            subAgentTokens,
            checkpointHistory: [...this._checkpointHistory],
            conversationBreakdown,
            // Use cached GM totals (full precision) when available; fall back to per-step aggregation
            gmTotalInputTokens: this._gmTotals?.inputTokens || gmIn || undefined,
            gmTotalOutputTokens: this._gmTotals?.outputTokens || gmOut || undefined,
            gmTotalCacheRead: this._gmTotals?.cacheRead || gmCache || undefined,
            gmTotalCredits: this._gmTotals?.credits || gmCredits || undefined,
            gmCoverageRate: gmEligible > 0 ? gmAnnotated / gmEligible : undefined,
            gmTotalRetries: this._gmTotals?.retries || gmRetries || undefined,
            gmModelBreakdown: this._gmModelBreakdown || undefined,
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
        this._normalizeModelState();
        const ms = this._modelStats.get(normalizeModelDisplayName(modelDisplayName) || modelDisplayName);
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
     * Get total step count currently recorded for the given model IDs.
     * Used to detect zero-usage pools (likely a false archival trigger from
     * an account switch rather than a genuine quota reset).
     */
    getCurrentStepCountForModels(modelIds: string[]): number {
        const normalizedIds = new Set(modelIds.map(id => normalizeModelDisplayName(id) || id));
        let total = 0;
        for (const [name, stats] of this._modelStats) {
            if (normalizedIds.has(name)) {
                total += stats.reasoning + stats.toolCalls;
            }
        }
        return total;
    }

    /**
     * Archive current activity data and reset stats.
     * Called when quota resets (fraction jumps back to 1.0).
     * @param modelIds - Optional model IDs whose quota triggered this archive.
     *   When provided, only stats for those models are archived and cleared;
     *   other models' data is preserved (per-pool isolation).
     */
    archiveAndReset(modelIds?: string[], options?: ArchiveResetOptions): ActivityArchive | null {
        this._normalizeModelState();
        const maxArchives = getMaxArchives();
        const archiveStartTime = options?.startTime || this._sessionStartTime;
        const archiveEndTime = options?.endTime || new Date().toISOString();

        // ── Determine which display names belong to the resetting pool ──
        const poolDisplayNames = new Set<string>();
        if (modelIds && modelIds.length > 0) {
            for (const id of modelIds) {
                poolDisplayNames.add(normalizeModelDisplayName(id));
            }
        }
        const isPoolReset = poolDisplayNames.size > 0;

        // ── Build summary ──
        // For pool resets: build a filtered summary containing only pool models.
        // For global resets (no modelIds): use full summary.
        const fullSummary = this.getSummary();
        let archiveSummary: ActivitySummary = fullSummary;

        if (isPoolReset) {
            // Filter modelStats to pool models only
            const poolModelStats: Record<string, ModelActivityStats> = {};
            let poolReasoning = 0, poolToolCalls = 0, poolErrors = 0;
            let poolEstSteps = 0, poolInputTokens = 0, poolOutputTokens = 0, poolToolReturnTokens = 0;
            for (const [name, s] of Object.entries(fullSummary.modelStats)) {
                if (poolDisplayNames.has(name)) {
                    poolModelStats[name] = { ...s };
                    poolReasoning += s.reasoning;
                    poolToolCalls += s.toolCalls;
                    poolErrors += s.errors;
                    poolEstSteps += s.estSteps;
                    poolInputTokens += s.inputTokens;
                    poolOutputTokens += s.outputTokens;
                    poolToolReturnTokens += s.toolReturnTokens;
                }
            }
            // Filter timeline events to pool models
            const poolSteps = fullSummary.recentSteps.filter(ev =>
                !ev.model || poolDisplayNames.has(ev.model)
            );
            archiveSummary = {
                ...fullSummary,
                modelStats: poolModelStats,
                totalReasoning: poolReasoning,
                totalToolCalls: poolToolCalls,
                totalErrors: poolErrors,
                estSteps: poolEstSteps,
                totalInputTokens: poolInputTokens,
                totalOutputTokens: poolOutputTokens,
                totalToolReturnTokens: poolToolReturnTokens,
                recentSteps: poolSteps,
                subAgentTokens: archiveSummary.subAgentTokens.filter(entry =>
                    !!entry.ownerModel && poolDisplayNames.has(entry.ownerModel)
                ),
                // Filter GM breakdown to pool models
                gmModelBreakdown: fullSummary.gmModelBreakdown
                    ? Object.fromEntries(
                        Object.entries(fullSummary.gmModelBreakdown)
                            .filter(([name]) => poolDisplayNames.has(name))
                    )
                    : undefined,
            };
        } else {
            archiveSummary = fullSummary;
        }

        // BUG FIX: preserve timeline events into archive before clearing
        const archivedSteps = isPoolReset
            ? archiveSummary.recentSteps
            : [...this._recentSteps];

        // Only archive if there's meaningful activity for the pool
        const hasActivity = archiveSummary.totalReasoning > 0 || archiveSummary.totalToolCalls > 0;
        let archivedEntry: ActivityArchive | null = null;
        if (hasActivity) {
            const now = Date.now();
            const lastArchive = this._archives[0];
            const lastEndMs = lastArchive ? new Date(lastArchive.endTime).getTime() : 0;
            const MIN_ARCHIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

            if (lastArchive
                && (now - lastEndMs) < MIN_ARCHIVE_INTERVAL_MS
                && sameTriggeredByScope(lastArchive.triggeredBy, modelIds)) {
                // Debounce: merge into the most recent archive
                lastArchive.endTime = archiveEndTime;
                lastArchive.summary = archiveSummary;
                lastArchive.recentSteps = archivedSteps;
                if (modelIds) {
                    lastArchive.triggeredBy = [
                        ...new Set([...(lastArchive.triggeredBy || []), ...modelIds]),
                    ];
                }
                archivedEntry = lastArchive;
            } else {
                archivedEntry = {
                    startTime: archiveStartTime,
                    endTime: archiveEndTime,
                    summary: archiveSummary,
                    triggeredBy: modelIds,
                    recentSteps: archivedSteps,
                };
                this._archives.unshift(archivedEntry);
                // Trim to max
                if (this._archives.length > maxArchives) {
                    this._archives = this._archives.slice(0, maxArchives);
                }
            }
        }

        // ── Reset: pool-scoped or global ──
        if (isPoolReset) {
            // Only clear stats for models in the resetting pool
            for (const name of poolDisplayNames) {
                this._modelStats.delete(name);
            }
            // Remove pool-model timeline events, keep others
            this._recentSteps = this._recentSteps.filter(ev =>
                ev.model && !poolDisplayNames.has(ev.model)
            );
            // Clear pool-specific GM breakdown entries
            if (this._gmModelBreakdown) {
                for (const name of poolDisplayNames) {
                    delete this._gmModelBreakdown[name];
                }
            }
            for (const [key, entry] of this._subAgentTokens) {
                if (entry.ownerModel && poolDisplayNames.has(entry.ownerModel)) {
                    this._subAgentTokens.delete(key);
                }
            }
            for (const [key, entry] of this._gmSubAgentTokens) {
                if (entry.ownerModel && poolDisplayNames.has(entry.ownerModel)) {
                    this._gmSubAgentTokens.delete(key);
                }
            }
            for (const [cascadeId, attribution] of [...this._windowOutsideAttribution.entries()]) {
                const remaining = Object.fromEntries(
                    Object.entries(attribution.stepsByModel)
                        .filter(([modelName]) => !poolDisplayNames.has(modelName)),
                );
                if (Object.keys(remaining).length === 0) {
                    this._windowOutsideAttribution.delete(cascadeId);
                } else if (!sameStepDistribution(remaining, attribution.stepsByModel)) {
                    this._windowOutsideAttribution.set(cascadeId, {
                        basis: attribution.basis,
                        stepsByModel: remaining,
                    });
                }
            }
            // Recompute _gmTotals from remaining breakdown
            if (this._gmModelBreakdown && Object.keys(this._gmModelBreakdown).length > 0) {
                let inp = 0, out = 0, cache = 0, credits = 0, retries = 0;
                for (const m of Object.values(this._gmModelBreakdown)) {
                    inp += m.totalInputTokens || 0;
                    out += m.totalOutputTokens || 0;
                    cache += m.totalCacheRead || 0;
                    credits += m.totalCredits || 0;
                    retries += m.totalRetries || 0;
                }
                this._gmTotals = { inputTokens: inp, outputTokens: out, cacheRead: cache, credits, retries };
            } else {
                this._gmTotals = null;
                this._gmModelBreakdown = null;
            }
            // Note: _subAgentTokens, _checkpointHistory, _conversationBreakdown,
            // _globalToolStats are conversation-scoped (not model-scoped) — keep intact.
            // They'll be fully reset on next global reset or cleared via clearActivityData.
        } else {
            // Global reset — clear everything
            this._modelStats.clear();
            this._subAgentTokens.clear();
            this._gmSubAgentTokens.clear();
            this._checkpointHistory = [];
            this._conversationBreakdown.clear();
            this._globalToolStats.clear();
            this._sampleDist.clear();
            this._sampleTotal = 0;
            this._totalUserInputs = 0;
            this._totalCheckpoints = 0;
            this._totalErrors = 0;
            this._recentSteps = [];
            this._pendingPlannerSteps.clear();
            this._tailRefreshQueue.clear();
            this._gmTotals = null;
            this._gmModelBreakdown = null;
            this._windowOutsideAttribution.clear();
            this._sessionStartTime = new Date().toISOString();
        }
        // DO NOT clear _trajectories or set _warmedUp=false!
        // Existing processedIndex values serve as baselines — only new steps after this point are counted.
        return archivedEntry;
    }

    /**
     * Full reset: clear all stats, timeline, and archives.
     * Keeps trajectory baselines to avoid re-counting old steps.
     */
    reset(): void {
        this._modelStats.clear();
        this._subAgentTokens.clear();
        this._gmSubAgentTokens.clear();
        this._checkpointHistory = [];
        this._conversationBreakdown.clear();
        this._globalToolStats.clear();
        this._totalUserInputs = 0;
        this._totalCheckpoints = 0;
        this._totalErrors = 0;
        this._recentSteps = [];
        this._pendingPlannerSteps.clear();
        this._tailRefreshQueue.clear();
        this._archives = [];
        this._gmTotals = null;
        this._gmModelBreakdown = null;
        this._windowOutsideAttribution.clear();
        this._sessionStartTime = new Date().toISOString();
    }

    // ─── Serialization ───────────────────────────────────────────────────

    serialize(): ActivityTrackerState {
        const baselines: Record<string, {
            stepCount: number;
            processedIndex: number;
            dominantModel: string;
            lastStatus: string;
            requestedModel: string;
            generatorModel: string;
        }> = {};
        for (const [k, v] of this._trajectories) { baselines[k] = { ...v }; }
        const windowOutsideAttribution: Record<string, {
            basis: 'estimated' | 'gm_recovered';
            stepsByModel: Record<string, number>;
            categoriesByModel?: Record<string, { reasoning: number; toolCalls: number; errors: number; userInputs: number }>;
        }> = {};
        for (const [cascadeId, attribution] of this._windowOutsideAttribution) {
            windowOutsideAttribution[cascadeId] = {
                basis: attribution.basis,
                stepsByModel: { ...attribution.stepsByModel },
                categoriesByModel: attribution.categoriesByModel
                    ? Object.fromEntries(Object.entries(attribution.categoriesByModel).map(([k, v]) => [k, { ...v }]))
                    : undefined,
            };
        }
        const summary = this.getSummary();
        summary.recentSteps = summary.recentSteps.map(slimStepEventForPersistence);
        const slimArchives = this._archives.map(archive => ({
            ...archive,
            summary: {
                ...archive.summary,
                recentSteps: archive.summary.recentSteps.map(slimStepEventForPersistence),
            },
            recentSteps: archive.recentSteps?.map(slimStepEventForPersistence),
        }));
        return {
            version: 1,
            summary,
            trajectoryBaselines: baselines,
            warmedUp: this._warmedUp,
            archives: slimArchives,
            gmTotals: this._gmTotals || undefined,
            gmModelBreakdown: this._gmModelBreakdown || undefined,
            windowOutsideAttribution: Object.keys(windowOutsideAttribution).length > 0
                ? windowOutsideAttribution
                : undefined,
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
            const normalizedName = normalizeModelDisplayName(name) || name;
            const existing = tracker._modelStats.get(normalizedName);
            const restoredStats: ModelActivityStats = {
                ...ms,
                modelName: normalizedName,
                userInputs: ms.userInputs || 0,
                toolBreakdown: { ...ms.toolBreakdown },
            };
            if (existing) {
                mergeActivityStats(existing, restoredStats);
            } else {
                tracker._modelStats.set(normalizedName, restoredStats);
            }
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
                // Use composite key matching creation logic (rawModel::ownerModel)
                const restoreKey = `${entry.modelId}::${entry.ownerModel || 'unknown'}`;
                tracker._subAgentTokens.set(restoreKey, { ...entry });
            }
        }

        // Restore checkpoint history (backward compatible)
        if (Array.isArray((s as unknown as Record<string, unknown>).checkpointHistory)) {
            tracker._checkpointHistory = [...s.checkpointHistory];
        }

        // Restore conversation breakdown (backward compatible)
        // BUG FIX: ConversationBreakdown.id stores short 8-char ID, but Map key should be
        // full cascadeId (matching _updateConversationBreakdown). Use trajectory baselines to
        // reconstruct full cascadeId keys.
        if (Array.isArray((s as unknown as Record<string, unknown>).conversationBreakdown)) {
            const trajKeys = Object.keys(data.trajectoryBaselines || {});
            for (const cb of s.conversationBreakdown) {
                // Try to find full cascadeId from trajectory baselines
                const fullKey = trajKeys.find(k => k.startsWith(cb.id)) || cb.id;
                tracker._conversationBreakdown.set(fullKey, { ...cb });
            }
        }

        // Restore recent steps (timeline)
        tracker._recentSteps = [...s.recentSteps];
        tracker._compactRecentSteps();

        // Restore cached GM totals (prevents flicker on startup)
        if (data.gmTotals) {
            tracker._gmTotals = { ...data.gmTotals };
        }
        const restoredGMBreakdown = data.gmModelBreakdown || s.gmModelBreakdown;
        if (restoredGMBreakdown) {
            tracker._gmModelBreakdown = { ...restoredGMBreakdown };
        }
        if (data.windowOutsideAttribution) {
            for (const [cascadeId, attribution] of Object.entries(data.windowOutsideAttribution)) {
                const cats = (attribution as any).categoriesByModel as Record<string, { reasoning: number; toolCalls: number; errors: number; userInputs: number }> | undefined;
                tracker._windowOutsideAttribution.set(cascadeId, {
                    basis: attribution.basis,
                    stepsByModel: { ...attribution.stepsByModel },
                    categoriesByModel: cats
                        ? Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, { ...v }]))
                        : undefined,
                });
            }
        }

        // Restore trajectory baselines (including dominantModel)
        if (data.trajectoryBaselines) {
            for (const [id, baseline] of Object.entries(data.trajectoryBaselines)) {
                tracker._trajectories.set(id, {
                    stepCount: baseline.stepCount,
                    processedIndex: baseline.processedIndex,
                    dominantModel: (baseline as { dominantModel?: string }).dominantModel || '',
                    lastStatus: (baseline as { lastStatus?: string }).lastStatus || '',
                    requestedModel: (baseline as { requestedModel?: string }).requestedModel || '',
                    generatorModel: (baseline as { generatorModel?: string }).generatorModel || '',
                });
            }
        }

        // ── Migration: sub-agent token tracking ──
        // Only trigger when sub-agent data is entirely absent (old format).
        // Removed aggressive ratio-based check that falsely triggered nuclear reset
        // when sub-agent activity was legitimately low relative to checkpoints.
        const needsSubAgentMigration = s.totalCheckpoints > 0
            && (!Array.isArray(s.subAgentTokens) || s.subAgentTokens.length === 0);

        // ── Migration: checkpoint history & conversation breakdown ──
        // Also triggers when conversationBreakdown was populated with bad data (all zeros)
        const cbEntries = [...tracker._conversationBreakdown.values()];
        const cbAllZero = cbEntries.length > 0 && cbEntries.every(e => e.inputTokens === 0 && e.outputTokens === 0);
        const needsHistoryMigration = s.totalCheckpoints > 0
            && (tracker._checkpointHistory.length === 0 || cbAllZero);

        // ── Migration: GM data persistence (new field added) ──
        const needsGMMigration = !data.gmTotals && s.totalCheckpoints > 0;

        if (needsSubAgentMigration || needsHistoryMigration || needsGMMigration) {
            // Nuclear reset: clear all stats, reset trajectory processedIndex to 0
            // so warm-up re-scans all existing steps and builds sub-agent map
            tracker._modelStats.clear();
            tracker._subAgentTokens.clear();
            tracker._checkpointHistory = [];
            tracker._conversationBreakdown.clear();
            tracker._globalToolStats.clear();
            tracker._sampleDist.clear();
            tracker._sampleTotal = 0;
            tracker._totalUserInputs = 0;
            tracker._totalCheckpoints = 0;
            tracker._totalErrors = 0;
            tracker._recentSteps = [];
            tracker._pendingPlannerSteps.clear();
            tracker._tailRefreshQueue.clear();
            tracker._windowOutsideAttribution.clear();
            for (const [id, t] of tracker._trajectories) {
                tracker._trajectories.set(id, { ...t, processedIndex: 0 });
            }
            tracker._warmedUp = false; // force full re-warm-up
        } else if (Object.keys(data.trajectoryBaselines || {}).length > 0) {
            tracker._warmedUp = true;  // use incremental path — only new steps
            for (const [id, baseline] of Object.entries(data.trajectoryBaselines || {})) {
                if (baseline.processedIndex > 0 && baseline.stepCount > 0 && baseline.stepCount <= STEP_TAIL_RESTORE_WINDOW) {
                    tracker._tailRefreshQueue.add(id);
                }
            }
        } else {
            tracker._warmedUp = false; // no baselines: full warm-up needed
        }

        tracker._normalizeModelState();
        return tracker;
    }

    // ─── Private Helpers ─────────────────────────────────────────────────

    private _normalizeModelState(): void {
        if (this._modelStats.size > 0) {
            const merged = new Map<string, ModelActivityStats>();
            for (const [name, stats] of this._modelStats) {
                const normalizedName = normalizeModelDisplayName(name) || name;
                const existing = merged.get(normalizedName);
                if (existing) {
                    mergeActivityStats(existing, stats);
                } else {
                    merged.set(normalizedName, {
                        ...stats,
                        modelName: normalizedName,
                        toolBreakdown: { ...stats.toolBreakdown },
                    });
                }
            }
            this._modelStats = merged;
        }

        if (this._sampleDist.size > 0) {
            const merged = new Map<string, { reasoning: number; toolCalls: number; errors: number; other: number }>();
            for (const [name, dist] of this._sampleDist) {
                const normalizedName = normalizeModelDisplayName(name) || name;
                const existing = merged.get(normalizedName);
                if (existing) {
                    existing.reasoning += dist.reasoning;
                    existing.toolCalls += dist.toolCalls;
                    existing.errors += dist.errors;
                    existing.other += dist.other;
                } else {
                    merged.set(normalizedName, { ...dist });
                }
            }
            this._sampleDist = merged;
        }

        if (this._recentSteps.length > 0) {
            this._recentSteps = this._recentSteps.map(event => event.model
                ? { ...event, model: normalizeModelDisplayName(event.model) || event.model }
                : event
            );
        }

        if (this._gmModelBreakdown) {
            const merged: Record<string, GMModelStats> = {};
            for (const [name, stats] of Object.entries(this._gmModelBreakdown)) {
                const normalizedName = normalizeModelDisplayName(name) || name;
                const existing = merged[normalizedName];
                if (existing) {
                    mergeGMStats(existing, stats);
                } else {
                    merged[normalizedName] = {
                        ...stats,
                        promptSectionTitles: [...stats.promptSectionTitles],
                        completionConfig: stats.completionConfig ? { ...stats.completionConfig } : null,
                    };
                }
            }
            this._gmModelBreakdown = Object.keys(merged).length > 0 ? merged : null;
        }

        const normalizeSubAgentMap = (source: Map<string, SubAgentTokenEntry>): Map<string, SubAgentTokenEntry> => {
            const normalized = new Map<string, SubAgentTokenEntry>();
            for (const entry of source.values()) {
                const displayName = normalizeModelDisplayName(entry.displayName || entry.modelId) || entry.displayName || entry.modelId;
                const ownerModel = entry.ownerModel ? (normalizeModelDisplayName(entry.ownerModel) || entry.ownerModel) : undefined;
                const key = `${entry.modelId}::${ownerModel || 'unknown'}`;
                const existing = normalized.get(key);
                if (existing) {
                    existing.inputTokens += entry.inputTokens;
                    existing.outputTokens += entry.outputTokens;
                    existing.cacheReadTokens += entry.cacheReadTokens;
                    existing.count += entry.count;
                    existing.compressionEvents += entry.compressionEvents;
                    existing.lastInputTokens = Math.max(existing.lastInputTokens, entry.lastInputTokens);
                    if (entry.cascadeIds) {
                        for (const cascadeId of entry.cascadeIds) {
                            if (!existing.cascadeIds?.includes(cascadeId)) {
                                (existing.cascadeIds ??= []).push(cascadeId);
                            }
                        }
                    }
                } else {
                    normalized.set(key, {
                        ...entry,
                        displayName,
                        ownerModel,
                        cascadeIds: entry.cascadeIds ? [...entry.cascadeIds] : [],
                    });
                }
            }
            return normalized;
        };

        if (this._subAgentTokens.size > 0) {
            this._subAgentTokens = normalizeSubAgentMap(this._subAgentTokens);
        }
        if (this._gmSubAgentTokens.size > 0) {
            this._gmSubAgentTokens = normalizeSubAgentMap(this._gmSubAgentTokens);
        }

        if (this._windowOutsideAttribution.size > 0) {
            for (const [cascadeId, attribution] of this._windowOutsideAttribution) {
                this._windowOutsideAttribution.set(cascadeId, {
                    basis: attribution.basis,
                    stepsByModel: normalizeStepsByModelRecord(attribution.stepsByModel),
                    categoriesByModel: attribution.categoriesByModel,
                });
            }
        }

        if (this._trajectories.size > 0) {
            for (const [cascadeId, baseline] of this._trajectories) {
                this._trajectories.set(cascadeId, {
                    ...baseline,
                    dominantModel: normalizeModelDisplayName(baseline.dominantModel) || baseline.dominantModel,
                    requestedModel: normalizeModelDisplayName(baseline.requestedModel) || baseline.requestedModel,
                    generatorModel: normalizeModelDisplayName(baseline.generatorModel) || baseline.generatorModel,
                });
            }
        }
    }

    private _getOrCreateStats(model: string): ModelActivityStats {
        const normalizedModel = normalizeModelDisplayName(model) || model;
        if (!this._modelStats.has(normalizedModel)) {
            this._modelStats.set(normalizedModel, {
                modelName: normalizedModel, userInputs: 0, reasoning: 0, toolCalls: 0, errors: 0, checkpoints: 0,
                totalSteps: 0, thinkingTimeMs: 0, toolTimeMs: 0, inputTokens: 0,
                estSteps: 0,
                outputTokens: 0, toolReturnTokens: 0, toolBreakdown: {},
            });
        }
        return this._modelStats.get(normalizedModel)!;
    }

    private _applyWindowOutsideDelta(
        stepsByModel: Record<string, number>,
        categoriesByModel: Record<string, { reasoning: number; toolCalls: number; errors: number; userInputs: number }> | undefined,
        direction: 1 | -1,
    ): void {
        for (const [model, steps] of Object.entries(normalizeStepsByModelRecord(stepsByModel))) {
            if (!model || !steps) { continue; }
            const stats = this._getOrCreateStats(model);
            stats.totalSteps = Math.max(0, stats.totalSteps + (steps * direction));
            // GM-driven categories: use precise data when available, else fallback to estSteps
            const cats = categoriesByModel?.[model];
            if (cats) {
                stats.reasoning = Math.max(0, stats.reasoning + (cats.reasoning * direction));
                stats.toolCalls = Math.max(0, stats.toolCalls + (cats.toolCalls * direction));
                stats.errors = Math.max(0, stats.errors + (cats.errors * direction));
                stats.userInputs = Math.max(0, stats.userInputs + (cats.userInputs * direction));
                // estSteps = only truly uncategorized remainder
                const categorized = cats.reasoning + cats.toolCalls + cats.errors + cats.userInputs;
                const uncategorized = Math.max(0, steps - categorized);
                stats.estSteps = Math.max(0, stats.estSteps + (uncategorized * direction));
            } else {
                stats.estSteps = Math.max(0, stats.estSteps + (steps * direction));
            }
        }
    }

    private _reconcileWindowOutsideAttribution(
        cascadeId: string,
        basis: 'estimated' | 'gm_recovered',
        stepsByModel: Record<string, number>,
        categoriesByModel?: Record<string, { reasoning: number; toolCalls: number; errors: number; userInputs: number }>,
    ): void {
        const normalizedStepsByModel = normalizeStepsByModelRecord(stepsByModel);
        const existing = this._windowOutsideAttribution.get(cascadeId);
        if (existing && existing.basis === basis && sameStepDistribution(existing.stepsByModel, normalizedStepsByModel)) {
            return;
        }
        if (existing) {
            this._applyWindowOutsideDelta(existing.stepsByModel, existing.categoriesByModel, -1);
        }
        this._applyWindowOutsideDelta(normalizedStepsByModel, categoriesByModel, 1);
        this._windowOutsideAttribution.set(cascadeId, {
            basis,
            stepsByModel: { ...normalizedStepsByModel },
            categoriesByModel: categoriesByModel
                ? Object.fromEntries(Object.entries(categoriesByModel).map(([k, v]) => [k, { ...v }]))
                : undefined,
        });
    }

    private _clearWindowOutsideAttribution(cascadeId: string): void {
        const existing = this._windowOutsideAttribution.get(cascadeId);
        if (!existing) { return; }
        this._applyWindowOutsideDelta(existing.stepsByModel, existing.categoriesByModel, -1);
        this._windowOutsideAttribution.delete(cascadeId);
    }

    private _sortRecentSteps(): void {
        const sourceRank = (source?: StepEvent['source']): number => {
            if (source === 'step') { return 0; }
            if (source === 'gm_user') { return 1; }
            if (source === 'gm_virtual') { return 2; }
            if (source === 'estimated') { return 3; }
            return 4;
        };

        this._recentSteps.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            if (aTime !== bTime) { return aTime - bTime; }
            const aStep = a.stepIndex ?? -1;
            const bStep = b.stepIndex ?? -1;
            if (aStep !== bStep) { return aStep - bStep; }
            const aSource = sourceRank(a.source);
            const bSource = sourceRank(b.source);
            if (aSource !== bSource) { return aSource - bSource; }
            return (a.cascadeId || '').localeCompare(b.cascadeId || '');
        });
    }

    private _pushEvent(event: StepEvent): void {
        this._recentSteps.push(event);
        this._compactRecentSteps();
    }
}


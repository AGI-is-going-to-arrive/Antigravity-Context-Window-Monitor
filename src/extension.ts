import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { discoverLanguageServer, LSInfo } from './discovery';
import {
    getAllTrajectories,
    getContextUsage,
    getContextLimit,
    getModelDisplayName,
    normalizeModelDisplayName,
    normalizeUri,
    fetchFullUserStatus,
    updateModelDisplayNames,
    ContextUsage,
    TrajectorySummary,
    UserStatusInfo,
} from './tracker';
import { getQuotaPoolKey, setShowModelShortId, overrideContextLimits, resolveModelId, type ModelConfig, updateModelSpec } from './models';
import { rpcCall } from './rpc-client';
import { StatusBarManager, formatContextLimit, setTooltipDiagLogger } from './statusbar';
import { initI18n, initI18nFromState, setLanguageToState, showLanguagePicker, tBi } from './i18n';
import { showMonitorPanel, updateMonitorPanel, isMonitorPanelVisible, setPanelDurableState, PanelPayload, LARGE_STATE_FILE_WARN_BYTES } from './webview-panel';
import { ActivityTracker, ActivityTrackerState } from './activity-tracker';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, MAX_DISCOVERY_BACKOFF_MS, COMPRESSION_PERSIST_POLLS } from './constants';
import { QuotaTracker } from './quota-tracker';
import { GMTracker, GMSummary, GMTrackerState, slimSummaryForPersistence } from './gm-tracker';
import { PricingStore } from './pricing-store';
import { DailyStore, type DailyStoreState } from './daily-store';
import { MonitorStore } from './monitor-store';
import {
    performDailyArchival as performDailyArchivalCore,
    type DailyArchivalContext,
} from './daily-archival';
import { DurableState, StateBucket } from './durable-state';
import { mergeModelDNAState, PersistedModelDNA, restoreModelDNAState, serializeModelDNAState, type ModelDNAStoreState } from './model-dna-store';
import type { StorageDiagnostics } from './webview-settings-tab';
import type { AccountSnapshot } from './activity-panel';
import { isBillingDay, isBillingDaySetting } from './billing-day';
import { expandModelIdsToPool } from './pool-utils';
import { DailyLedger, toLocalDateKey, type DailyLedgerState } from './daily-ledger';

// ─── Extension State ──────────────────────────────────────────────────────────
// Each VS Code window runs its own extension instance, so module-level
// variables are window-isolated — perfect for per-window cascade tracking.

let statusBar: StatusBarManager;
let pollingTimer: ReturnType<typeof setTimeout> | undefined;
let pollGeneration = 0;
let disposed = false;
let cachedLsInfo: LSInfo | null = null;
let currentUsage: ContextUsage | null = null;
let allTrajectoryUsages: ContextUsage[] = [];
let lastTrajectories: TrajectorySummary[] = [];
let cachedModelConfigs: import('./models').ModelConfig[] = [];
let cachedUserInfo: UserStatusInfo | null = null;
let statusPollCount = 0;
/** Refresh user status every N poll cycles (~10s at default 5s interval) */
const STATUS_REFRESH_INTERVAL = 2;
let outputChannel: vscode.OutputChannel;
let quotaTracker: QuotaTracker;
let activityTracker: ActivityTracker;
let gmTracker: GMTracker;
let lastGMSummary: GMSummary | null = null;
let pricingStore: PricingStore;
let dailyStore: DailyStore;
let dailyLedger: DailyLedger;
let monitorStore: MonitorStore;
let durableState: DurableState;
let durableGlobalState: StateBucket;
let durableWorkspaceState: StateBucket;
let durableFileGlobalState: StateBucket;
let durableFileWorkspaceState: StateBucket;
let persistedModelDNA: Record<string, PersistedModelDNA> = {};

// ─── Multi-Account Snapshot State ─────────────────────────────────────────────
/** Map of email → AccountSnapshot, persisted across sessions. */
let accountSnapshots = new Map<string, AccountSnapshot>();
/** Tracks already-notified reset events to avoid duplicate popups. Key = `email:resetTime` */
const notifiedAccountResets = new Set<string>();
/** Currently active account email for switch detection. */
let currentAccountEmail = '';
/** Per-account billing day map (email → day 1-31), persisted in durable state. */
let billingDaysMap: Record<string, number> = {};

/** Last archived local date key ('YYYY-MM-DD'), used to detect date rollover. */
let lastArchivalDateKey: string = '';

/** Throttle activity persistence: max once per 30s */
let lastActivityPersistTime = 0;

/** Extension context reference — needed for workspaceState persistence. */
let extensionContext: vscode.ExtensionContext;

/** The cascade ID that THIS window instance is tracking. */
let trackedCascadeId: string | null = null;

/** Previous poll's step counts per cascade — used to detect activity. */
const previousStepCounts = new Map<string, number>();

/** Models that have already triggered a low-quota notification (cleared when recovered). */
const quotaNotifiedModels = new Set<string>();

/** Previous poll's known trajectory IDs — used to detect new conversations. */
const previousTrajectoryIds = new Set<string>();

/** Previous poll's contextUsed per cascade — used to detect context compression. */
const previousContextUsedMap = new Map<string, number>();



/** Whether we've completed at least one poll cycle. */
let firstPollDone = false;

/** Prevents concurrent pollContextUsage() reentrance. */
let isPolling = false;
let hasSyncedCheckpointer = false;
let isSyncingCheckpointer = false;

/** Prevents schedulePoll() from creating new timers after deactivate. */
// disposed declared at top of module

/** Generation counter — prevents orphan timer chains. */
// pollGeneration declared at top of module

// isExplicitlyIdle: Reserved for future UI improvement — differentiate between
// "cascade deleted → actively idle" vs "window just opened → no cascade yet".
let isExplicitlyIdle = false;

/** The last known model identifier — used to show correct context limit in idle state. */
let lastKnownModel = '';

// ─── Exponential Backoff State ────────────────────────────────────────────────
let baseIntervalMs = 5000;
let currentIntervalMs = 5000;

// ─── LS PID Revalidation ──────────────────────────────────────────────────────
// BUG FIX: When Antigravity updates its LS, the old process may stay alive and
// keep responding to RPC calls with stale data. The plugin caches the old
// connection and never discovers the new LS. This counter forces periodic
// re-discovery to compare PIDs and detect stale connections.
let lsRevalidationCounter = 0;
/** Re-validate LS PID every N poll cycles. At 5s polling = ~30s. */
const LS_REVALIDATION_INTERVAL = 6;
/** Tracks consecutive polls where workspace has 0 RUNNING conversations. */
let consecutiveIdlePolls = 0;
/** If we're tracking a cascade and it stays IDLE for this many polls, assume stale LS. */
const STALE_LS_IDLE_THRESHOLD = 4;
/** Set after staleness check confirms same PID — avoids repeated discovery for genuinely idle workspaces. */
let stalenessConfirmedIdle = false;
let consecutiveFailures = 0;

// AbortController — cancel in-flight RPC requests on extension deactivate.
let abortController = new AbortController();

/** Last polled workspace URI — used to detect workspace switches mid-session. */
let lastPolledWorkspaceUri: string | undefined;

/** Map of cascadeId → remaining polls to show compression indicator. */
const compressionPersistCounters = new Map<string, number>();

function clonePlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function hasSameUsageInputs(
    cached: ContextUsage | null | undefined,
    trajectory: Pick<TrajectorySummary, 'cascadeId' | 'stepCount' | 'lastModifiedTime'>,
): cached is ContextUsage {
    return !!cached
        && cached.cascadeId === trajectory.cascadeId
        && cached.stepCount === trajectory.stepCount
        && cached.lastModifiedTime === trajectory.lastModifiedTime;
}

function rehydrateUsageForDisplay(
    usage: ContextUsage,
    customLimits?: Record<string, number>,
): ContextUsage {
    const model = usage.model || usage.lastModelUsage?.model || lastKnownModel || '';
    const modelDisplayName = normalizeModelDisplayName(model);
    const contextLimit = getContextLimit(model, customLimits);
    const usagePercent = contextLimit > 0 ? (usage.contextUsed / contextLimit) * 100 : 0;
    if (
        model === usage.model
        && modelDisplayName === usage.modelDisplayName
        && contextLimit === usage.contextLimit
        && usagePercent === usage.usagePercent
    ) {
        return usage;
    }
    return {
        ...usage,
        model,
        modelDisplayName,
        contextLimit,
        usagePercent,
    };
}

function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

function stableValueSignature(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableValueSignature).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${stableRecordSignature(value as Record<string, unknown>)}}`;
    }
    if (typeof value === 'string') {
        return hashText(value);
    }
    return String(value);
}

function stableRecordSignature(record: Record<string, unknown> | null | undefined): string {
    if (!record) { return ''; }
    return Object.entries(record)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${stableValueSignature(value)}`)
        .join('|');
}

function buildGMModelStatsSignature(summary: GMSummary): string {
    return Object.entries(summary.modelBreakdown)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([modelName, stats]) => {
            const cfg = stats.completionConfig;
            const cfgSig = cfg
                ? `${cfg.maxTokens},${cfg.temperature},${cfg.firstTemperature},${cfg.topK},${cfg.topP},${cfg.numCompletions},${cfg.stopPatternCount}`
                : '';
            return [
                modelName,
                stats.callCount,
                stats.stepsCovered,
                stats.totalInputTokens,
                stats.totalOutputTokens,
                stats.totalThinkingTokens,
                stats.totalCacheRead,
                stats.totalCacheCreation,
                stats.totalCredits,
                stats.avgTTFT,
                stats.minTTFT,
                stats.maxTTFT,
                stats.avgStreaming,
                stats.cacheHitRate,
                stats.responseModel,
                stats.apiProvider,
                stats.hasSystemPrompt ? 1 : 0,
                stats.toolCount,
                stats.promptSectionTitles.join(','),
                stats.totalRetries,
                stats.errorCount,
                stats.creditCallCount,
                stats.exactCallCount,
                stats.placeholderOnlyCalls,
                stats.contextWindowCapacity,
                cfgSig,
            ].join('~');
        })
        .join('||');
}

function buildGMConversationSignature(summary: GMSummary): string {
    return [...summary.conversations]
        .sort((a, b) => a.cascadeId.localeCompare(b.cascadeId))
        .map(conversation => {
            const latestCall = conversation.calls[conversation.calls.length - 1];
            const totalConvCredits = conversation.calls.reduce((sum, call) => sum + call.credits, 0);
            const callIds = conversation.calls
                .map(call => call.executionId || `${call.model}:${call.createdAt}:${call.stepIndices.join(',')}`)
                .join(',');
            const checkpointSig = (conversation.checkpointSummaries || [])
                .map(cp => `${cp.checkpointNumber}:${cp.stepIndex}:${cp.tokens}:${hashText(cp.fullText || '')}`)
                .join(';');
            const contextSig = (conversation.systemContextItems || [])
                .map(item => `${item.type}:${item.stepIndex}:${item.tokens}:${item.label}:${hashText(item.fullText || '')}`)
                .join(';');
            return [
                conversation.cascadeId,
                conversation.title,
                conversation.totalSteps,
                conversation.coveredSteps,
                conversation.coverageRate,
                conversation.lifetimeCalls || 0,
                conversation.accountCredits || 0,
                conversation.calls.length,
                totalConvCredits,
                latestCall?.createdAt || '',
                latestCall?.responseModel || latestCall?.modelDisplay || latestCall?.model || '',
                callIds,
                checkpointSig,
                contextSig,
            ].join('~');
        })
        .join('||');
}

function buildGMSummarySignature(summary: GMSummary): string {
    const recentErrorEntriesSig = (summary.recentErrorEntries || [])
        .map(entry => `${entry.code}:${entry.createdAt}:${hashText(entry.message || '')}`)
        .join('|');
    const uniqueErrorsSig = (summary.uniqueErrors || [])
        .map(entry => `${entry.code}:${entry.firstSeen}:${hashText(entry.message || '')}`)
        .join('|');
    const toolCatalogSig = (summary.toolCatalog || [])
        .map(entry => `${entry.name}:${entry.firstSeen}:${hashText(entry.description || '')}`)
        .join('|');
    const contextGrowthSig = summary.contextGrowth
        .map(point => `${point.step}:${point.tokens}:${point.model}`)
        .join('|');

    return [
        summary.totalCalls,
        summary.totalStepsCovered,
        summary.totalCredits,
        summary.totalInputTokens,
        summary.totalOutputTokens,
        summary.totalCacheRead,
        summary.totalCacheCreation,
        summary.totalThinkingTokens,
        summary.totalRetryCount,
        summary.totalRetryTokens,
        summary.totalRetryCredits,
        stableRecordSignature(summary.stopReasonCounts),
        stableRecordSignature(summary.retryErrorCodes),
        stableRecordSignature(summary.toolCallCounts),
        stableRecordSignature(summary.toolCallCountsByConv as Record<string, unknown> | undefined),
        stableRecordSignature(summary.retryErrorCodesByConv as Record<string, unknown> | undefined),
        summary.recentErrors.map(item => hashText(item)).join('|'),
        recentErrorEntriesSig,
        uniqueErrorsSig,
        toolCatalogSig,
        contextGrowthSig,
        buildGMModelStatsSignature(summary),
        buildGMConversationSignature(summary),
    ].join('@@');
}

export function hasGMSummaryChanged(prev: GMSummary | null | undefined, next: GMSummary | null | undefined): boolean {
    if (!!prev !== !!next) { return true; }
    if (!prev || !next) { return false; }
    return buildGMSummarySignature(prev) !== buildGMSummarySignature(next);
}

function persistResetSensitiveState(): void {
    durableGlobalState.update('activityTrackerState', activityTracker.serialize());
    durableGlobalState.update('gmTrackerState', gmTracker.serialize());
    persistGMSummaryToFile(lastGMSummary);
}

/** Write GM summary to external file, stripping heavy text/metadata fields. */
function persistGMSummaryToFile(summary: GMSummary | null | undefined): void {
    durableFileGlobalState.update('gmDetailedSummary', summary ? slimSummaryForPersistence(summary) : null);
}

interface StateWriter {
    update(key: string, value: unknown): unknown;
}

export function persistClearedToolCatalog(
    tracker: GMTracker,
    globalState: StateWriter,
    fileState: StateWriter,
): GMSummary | null {
    tracker.clearToolCatalog();
    const summary = tracker.getCachedSummary();
    globalState.update('gmTrackerState', tracker.serialize());
    fileState.update('gmDetailedSummary', summary ? slimSummaryForPersistence(summary) : null);
    return summary;
}

export interface RunningTrajectorySelection {
    candidateId: string | null;
    selectionReason: string;
    qualifiedRunning: TrajectorySummary[];
    selectedOutsideWorkspace: boolean;
}

export function selectRunningTrajectoryCandidate(
    trajectories: TrajectorySummary[],
    qualifiedTrajectories: TrajectorySummary[],
    trackedCascadeId: string | null,
): RunningTrajectorySelection {
    const qualifiedRunning = qualifiedTrajectories.filter(t => t.status === CascadeStatus.RUNNING);

    if (qualifiedRunning.length > 0) {
        const currentStillRunning = qualifiedRunning.find(t => t.cascadeId === trackedCascadeId);
        if (currentStillRunning) {
            return {
                candidateId: currentStillRunning.cascadeId,
                selectionReason: 'tracked cascade is RUNNING',
                qualifiedRunning,
                selectedOutsideWorkspace: false,
            };
        }
        return {
            candidateId: qualifiedRunning[0].cascadeId,
            selectionReason: 'new RUNNING cascade in ws',
            qualifiedRunning,
            selectedOutsideWorkspace: false,
        };
    }

    // Shared LS instances can expose active cascades from another workspace even
    // when the IDE window keeps reporting a stale workspace URI after a switch.
    const crossWorkspaceRunning = trajectories
        .filter(t => t.status === CascadeStatus.RUNNING)
        .filter(t => !qualifiedTrajectories.some(q => q.cascadeId === t.cascadeId));

    if (crossWorkspaceRunning.length === 0) {
        return {
            candidateId: null,
            selectionReason: '',
            qualifiedRunning,
            selectedOutsideWorkspace: false,
        };
    }

    const selected = crossWorkspaceRunning[0];
    const hasWorkspaceUri = selected.workspaceUris.length > 0;
    return {
        candidateId: selected.cascadeId,
        selectionReason: hasWorkspaceUri
            ? 'RUNNING cascade from another workspace (cross-workspace tracking)'
            : 'RUNNING cascade without workspace (new conversation)',
        qualifiedRunning,
        selectedOutsideWorkspace: true,
    };
}

export function buildUsageScopeTrajectories(
    qualifiedTrajectories: TrajectorySummary[],
    trajectories: TrajectorySummary[],
    activeTrajectory: TrajectorySummary | null,
): TrajectorySummary[] {
    const scope = qualifiedTrajectories.length > 0 ? qualifiedTrajectories : trajectories;
    if (!activeTrajectory || scope.some(t => t.cascadeId === activeTrajectory.cascadeId)) {
        return scope;
    }
    return [activeTrajectory, ...scope];
}

function makePanelPayload(extra: Partial<PanelPayload> = {}): PanelPayload {
    return {
        currentUsage,
        allTrajectoryUsages,
        allTrajectories: lastTrajectories,
        modelConfigs: cachedModelConfigs,
        userInfo: cachedUserInfo,
        workspaceUri: getWorkspaceUri(),
        activitySummary: activityTracker?.getSummary() ?? null,
        archives: activityTracker?.getArchives(),
        activityTracker,
        gmSummary: gmTracker.getUiSummary(),
        gmFullSummary: gmTracker.getUiFullSummary(),
        gmConversations: monitorStore.getGMConversations(),
        pricingStore,
        dailyStore,
        storageDiagnostics: getStorageDiagnostics(),
        modelDNA: persistedModelDNA,
        accountSnapshots: getAccountSnapshotArray(),
        todayLedgerActive: dailyLedger.getTodayActive(),
        ledgerSettled: dailyLedger.getSettledEntries(),
        ...extra,
    };
}

// ─── Account Snapshot Helpers ─────────────────────────────────────────────────

/**
 * Build a set of model IDs that have confirmed LLM calls in the current cycle
 * for the given account. Used by both account snapshot hasUsage detection and
 * QuotaTracker's early tracking entry.
 */
function buildUsedModelIds(email?: string): Set<string> {
    const ids = new Set<string>();
    if (!lastGMSummary?.conversations) { return ids; }
    for (const conv of lastGMSummary.conversations) {
        for (const call of conv.calls) {
            if ((!call.accountEmail || call.accountEmail === email) && call.model) {
                ids.add(call.model);
            }
        }
    }
    return ids;
}

export interface ModelQuotaPoolGroup {
    key: string;
    resetTime: string;
    labels: string[];
    modelIds: string[];
    minFraction: number;
}

export function groupModelConfigsByQuotaPool(configs: ModelConfig[]): ModelQuotaPoolGroup[] {
    const poolMap = new Map<string, { labels: string[]; modelIds: string[]; resetTimes: string[]; minFraction: number }>();
    for (const c of configs) {
        if (!c.quotaInfo) { continue; }
        const key = getQuotaPoolKey(c.model, c.quotaInfo.resetTime);
        const pool = poolMap.get(key) || { labels: [], modelIds: [], resetTimes: [], minFraction: 1 };
        const label = c.label || c.model;
        if (label && !pool.labels.includes(label)) {
            pool.labels.push(label);
        }
        if (c.model && !pool.modelIds.includes(c.model)) {
            pool.modelIds.push(c.model);
        }
        if (c.quotaInfo.resetTime && !pool.resetTimes.includes(c.quotaInfo.resetTime)) {
            pool.resetTimes.push(c.quotaInfo.resetTime);
        }
        pool.minFraction = Math.min(pool.minFraction, c.quotaInfo.remainingFraction ?? 1);
        poolMap.set(key, pool);
    }

    return [...poolMap.entries()].map(([key, pool]) => {
        const resetTimes = [...pool.resetTimes].sort((a, b) => a.localeCompare(b));
        return {
            key,
            resetTime: resetTimes[0] || '',
            labels: pool.labels,
            modelIds: pool.modelIds,
            minFraction: pool.minFraction,
        };
    });
}

const RESET_TIME_TURNOVER_MIN_JUMP_MS = 10 * 60 * 1000;

/**
 * resetTime 会在同一周期内轻微漂移，不能把“任何变化”都当成真正的额度重置。
 * 只有旧 resetTime 已经过期，且新的 resetTime 重新跳回未来并明显大于旧值时，
 * 才认为发生了新周期切换。
 */
export function shouldSettleOnResetTimeChange(
    oldResetTime: string,
    newResetTime: string,
    nowMs: number = Date.now(),
): boolean {
    if (!oldResetTime || !newResetTime || oldResetTime === newResetTime) {
        return false;
    }
    const oldMs = Date.parse(oldResetTime);
    const newMs = Date.parse(newResetTime);
    if (Number.isNaN(oldMs) || Number.isNaN(newMs)) {
        return false;
    }
    if (oldMs > nowMs || newMs <= nowMs) {
        return false;
    }
    return (newMs - oldMs) >= RESET_TIME_TURNOVER_MIN_JUMP_MS;
}

async function fetchAndOverrideCheckpointerLimits(ls: LSInfo): Promise<boolean> {
    try {
        log('[Checkpointer Sync] Fetching official checkpointer parameters via LS RPC GetAvailableModels...');
        const resp = await rpcCall(ls, 'GetAvailableModels', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 10000);
        const models = (resp as any)?.response?.models || {};
        const overrides: Record<string, number> = {};
        const allFetchedInfo: string[] = [];

        for (const config of Object.values(models)) {
            const c = config as any;
            const modelVal = c.model || '';
            const modelIdVal = c.modelId || c.model_id || '';
            if (!modelVal && !modelIdVal) continue;

            const resolved = (modelVal ? resolveModelId(modelVal) : undefined)
                || (modelIdVal ? resolveModelId(modelIdVal) : undefined);

            const exps = c.modelExperiments?.experiments || {};
            const checkpointerStr = exps.CASCADE_USE_EXPERIMENT_CHECKPOINTER?.stringValue;
            let limitNum = 0;
            let thresholdNum = 0;

            if (checkpointerStr) {
                allFetchedInfo.push(`[${modelIdVal || modelVal}] Exp JSON: ${checkpointerStr}`);
                try {
                    const cp = JSON.parse(checkpointerStr);
                    const cpLimit = cp.max_token_limit || cp.max_limit;
                    if (typeof cpLimit === 'number') {
                        limitNum = cpLimit;
                    } else if (typeof cpLimit === 'string') {
                        limitNum = parseInt(cpLimit, 10);
                    }

                    const cpThreshold = cp.token_threshold || cp.threshold;
                    if (typeof cpThreshold === 'number') {
                        thresholdNum = cpThreshold;
                    } else if (typeof cpThreshold === 'string') {
                        thresholdNum = parseInt(cpThreshold, 10);
                    }

                    if (limitNum && !isNaN(limitNum) && limitNum > 0) {
                        const resolvedKey = resolved || modelVal || modelIdVal;
                        if (resolvedKey) {
                            overrides[resolvedKey] = limitNum;
                        }
                        if (modelVal) overrides[modelVal] = limitNum;
                        if (modelIdVal) overrides[modelIdVal] = limitNum;
                    }
                } catch { /* ignore JSON parse error */ }
            } else {
                allFetchedInfo.push(`[${modelIdVal || modelVal}] Exp JSON: undefined (No active checkpointer experiment)`);
            }

            // 同步更新 activeModelSpecs 数据库
            if (resolved) {
                updateModelSpec(resolved, {
                    modelId: modelIdVal || modelVal,
                    apiProvider: (c.apiProvider || '').replace('API_PROVIDER_', ''),
                    maxTokens: typeof c.maxTokens === 'number' ? c.maxTokens : 0,
                    maxOutputTokens: typeof c.maxOutputTokens === 'number' ? c.maxOutputTokens : 0,
                    thinkingBudget: typeof c.thinkingBudget === 'number' ? c.thinkingBudget : 0,
                    supportsThinking: !!c.supportsThinking,
                    ...(limitNum > 0 ? { cpLimit: limitNum } : {}),
                    ...(thresholdNum > 0 ? { cpThreshold: thresholdNum } : {}),
                });
            }
        }

        if (allFetchedInfo.length > 0) {
            log(`[Checkpointer Sync] Official checkpointer parameters fetched for ${allFetchedInfo.length} models.`);
        }



        if (Object.keys(overrides).length > 0) {
            overrideContextLimits(overrides);
            log(`[Checkpointer Sync] Dynamically resolved and overridden ${Object.keys(overrides).length} model context limits from official Checkpointer!`);
        } else {
            log('[Checkpointer Sync] Sync completed successfully, but no active checkpointer overrides were found in models.');
        }
        return true;
    } catch (e: any) {
        log(`[Checkpointer Sync] Optional dynamic capture failed: ${e.message}. Using built-in static fallbacks.`);
        return false;
    }
}

function updateAccountSnapshot(
    userInfo: UserStatusInfo,
    configs: ModelConfig[],
): void {
    const email = userInfo.email;
    if (!email) { return; }
    const nowMs = Date.now();

    // Group models by their stable quota pool first — we need the NEW resetTimes.
    const poolMap = new Map<string, { resetTime: string; labels: string[]; modelIds: string[]; hasUsage: boolean; minFraction: number }>();
    for (const group of groupModelConfigsByQuotaPool(configs)) {
        poolMap.set(group.key, {
            resetTime: group.resetTime,
            labels: group.labels,
            modelIds: group.modelIds,
            hasUsage: group.minFraction < 1.0,
            minFraction: group.minFraction,
        });
    }

    // ── Cycle-change settlement: detect real turnover only ──
    // resetTime often drifts by a few minutes inside the SAME cycle.
    // Do not settle unless the old reset time has actually expired and the
    // new reset time jumps back into the future by more than normal drift.
    const oldSnap = accountSnapshots.get(email);
    if (oldSnap) {
        // Build old resetTime lookup: modelId → resetTime
        const oldResetByModel = new Map<string, string>();
        for (const pool of (oldSnap.resetPools || [])) {
            if (!pool.resetTime) { continue; }
            for (const mid of (pool.modelIds || [])) {
                oldResetByModel.set(mid, pool.resetTime);
            }
        }

        // Check each new pool: if resetTime changed, settle the old pool
        for (const [, newPool] of poolMap) {
            if (!newPool.resetTime || !newPool.modelIds?.length) { continue; }
            // Find old resetTime for any model in this pool
            let oldResetTime: string | undefined;
            for (const mid of newPool.modelIds) {
                oldResetTime = oldResetByModel.get(mid);
                if (oldResetTime) { break; }
            }
            if (!oldResetTime) { continue; }
            if (!shouldSettleOnResetTimeChange(oldResetTime, newPool.resetTime, nowMs)) { continue; }
            const oldResetMs = Date.parse(oldResetTime);
            const cutoffTime = Number.isNaN(oldResetMs) ? undefined : oldResetMs;
            if (dailyLedger.isPoolSettled(newPool.modelIds, email, cutoffTime)) { continue; }
            // Settle both DailyLedger and GMTracker using oldResetTime as cutoff
            const baselinedCount = gmTracker.baselineForQuotaReset(email, newPool.modelIds, oldResetTime);
            const settled = dailyLedger.settleForQuotaReset(newPool.modelIds, email, cutoffTime);
            if (baselinedCount > 0 || settled) {
                log(`[DailyLedger] cycle-change settlement: ${baselinedCount} GM calls baselined, ${settled ? settled.totalCalls : 0} ledger calls settled for [${newPool.labels.slice(0, 3).join(', ')}] (${email}) — resetTime changed ${oldResetTime} → ${newPool.resetTime}`);
                lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                durableGlobalState.update('gmTrackerState', gmTracker.serialize());
                durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                persistGMSummaryToFile(lastGMSummary);
            }
        }
    }

    // ── Enhanced usage detection: GMTracker cross-reference ──────────────
    // remainingFraction is quantized in 20% steps (1.0→0.8→0.6→0.4→0.2→0.0),
    // so frac=1.0 does NOT mean "unused" — it could mean consumption < 20%.
    // The reliable signal: check GMTracker's actual call records for this cycle.
    // If any model in a pool has been called by THIS account, the pool is "used".
    //
    // Match by model ID (language-independent), NOT display name.
    // e.g. pool has "Gemini 3.1 Pro (High)" but call.modelDisplay may differ
    //      both share model ID "MODEL_PLACEHOLDER_M37" — this always matches.
    const usedModelIds = buildUsedModelIds(email);
    if (usedModelIds.size > 0) {
        for (const [, pool] of poolMap) {
            if (pool.hasUsage) { continue; } // already confirmed ≥20% consumed
            for (const mid of pool.modelIds) {
                if (usedModelIds.has(mid)) {
                    pool.hasUsage = true;
                    break;
                }
            }
        }
    }

    // Build resetPools sorted by resetTime (earliest first)
    const resetPools: import('./activity-panel').ResetPool[] = [];
    const allResetTimes: string[] = [];
    for (const [, pool] of [...poolMap.entries()].sort((a, b) => a[1].resetTime.localeCompare(b[1].resetTime))) {
        const resetTime = pool.resetTime;
        const remainingPct = pool.hasUsage ? Math.round(pool.minFraction * 100) : undefined;
        resetPools.push({ resetTime, modelLabels: pool.labels, modelIds: pool.modelIds, hasUsage: pool.hasUsage, remainingPercent: remainingPct });
        if (resetTime && !allResetTimes.includes(resetTime)) {
            allResetTimes.push(resetTime);
        }
    }
    const earliestResetTime = allResetTimes.length > 0 ? allResetTimes[0] : '';

    // Mark all existing snapshots as inactive
    for (const snap of accountSnapshots.values()) {
        snap.isActive = false;
    }

    // Upsert current account
    const validCredits = (userInfo.availableCredits || [])
        .filter(c => c.creditAmount > 0)
        .map(c => ({ creditType: c.creditType, creditAmount: c.creditAmount }));

    accountSnapshots.set(email, {
        email,
        name: userInfo.name || '',
        planName: userInfo.planName || '',
        tierName: userInfo.userTierName || '',
        earliestResetTime,
        allResetTimes,
        resetPools,
        isActive: true,
        lastSeen: new Date().toISOString(),
        credits: validCredits.length > 0 ? validCredits : undefined,
    });

    // Persist to durable state
    persistAccountSnapshots();
}

function persistAccountSnapshots(): void {
    const arr: AccountSnapshot[] = [];
    for (const snap of accountSnapshots.values()) {
        arr.push(snap);
    }
    durableFileGlobalState.update('accountSnapshots', arr);
}

function restoreAccountSnapshots(): void {
    const saved = durableFileGlobalState.get<AccountSnapshot[] | null>('accountSnapshots', null);
    if (saved && Array.isArray(saved)) {
        accountSnapshots = new Map();
        for (const snap of saved) {
            if (snap.email) {
                // All restored snapshots start as inactive until a live fetch confirms
                accountSnapshots.set(snap.email, { ...snap, isActive: false });
            }
        }
    }
}

/** Remove a cached (non-active) account snapshot. Returns updated snapshot list. */
export function removeAccountSnapshot(email: string): AccountSnapshot[] {
    const snap = accountSnapshots.get(email);
    if (!snap || snap.isActive) {
        // Don't remove the currently active account
        return [...accountSnapshots.values()];
    }
    accountSnapshots.delete(email);
    persistAccountSnapshots();
    return [...accountSnapshots.values()];
}

function getAccountSnapshotArray(): AccountSnapshot[] {
    return [...accountSnapshots.values()];
}

// ─── Per-Account Billing Days (durable) ──────────────────────────────────────

function persistBillingDays(): void {
    void durableFileGlobalState.update('accountBillingDays', billingDaysMap).then(undefined, err => {
        log(`Failed to persist account billing days: ${err}`);
    });
}

function restoreBillingDays(): void {
    const saved = durableFileGlobalState.get<unknown>('accountBillingDays', null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        billingDaysMap = {};
        return;
    }

    const restored: Record<string, number> = {};
    for (const [rawEmail, day] of Object.entries(saved)) {
        const email = rawEmail.trim();
        if (email && isBillingDay(day)) {
            restored[email] = day;
        }
    }
    billingDaysMap = restored;
}

/** Get the full billing days map. */
export function getBillingDaysMap(): Record<string, number> {
    return billingDaysMap;
}

function isKnownAccountEmail(email: string): boolean {
    return accountSnapshots.has(email) || email === currentAccountEmail || email === cachedUserInfo?.email;
}

/** Set billing day for a specific account email. day=0 removes it. */
export function setAccountBillingDay(email: string, day: number): boolean {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !isBillingDaySetting(day) || !isKnownAccountEmail(normalizedEmail)) {
        return false;
    }

    if (day > 0) {
        billingDaysMap[normalizedEmail] = day;
    } else {
        delete billingDaysMap[normalizedEmail];
    }
    persistBillingDays();
    if (normalizedEmail === currentAccountEmail && typeof statusBar !== 'undefined') {
        applyDisplayPrefs();
        if (currentUsage) {
            statusBar.update(currentUsage);
        }
    }
    return true;
}

/**
 * Detect account switch for GM call attribution.
 * Also checks expired quota pools for BOTH the outgoing and incoming accounts,
 * since checkCachedAccountResets() only covers inactive accounts and would miss
    * the incoming account once it becomes active.
 */
function handleAccountSwitchIfNeeded(newEmail: string): boolean {
    if (!newEmail) { return false; }
    if (currentAccountEmail && currentAccountEmail !== newEmail) {
        log(`Account switch detected: ${currentAccountEmail} → ${newEmail}`);

        // Before switching, check both accounts for expired pools that need archival.
        // The OLD account (currentAccountEmail) is about to become "cached" (inactive),
        // and the NEW account (newEmail) is about to become "active".
        // checkCachedAccountResets() only checks isActive===false, so the new account
        // would be skipped once it becomes active. We must handle it HERE.
        baselineExpiredPoolsForAccount(currentAccountEmail);
        baselineExpiredPoolsForAccount(newEmail);

        currentAccountEmail = newEmail;
        gmTracker.setCurrentAccount(newEmail);
        applyDisplayPrefs(); // refresh billing day for new account
        return true;
    }
    if (!currentAccountEmail) {
        currentAccountEmail = newEmail;
        gmTracker.setCurrentAccount(newEmail);
        applyDisplayPrefs(); // set billing day for initial account
        // On first connection after extension restart, the account may already
        // have expired pools from a previous session. Baseline them now before
        // updateAccountSnapshot() refreshes the snapshot with a new resetTime.
        baselineExpiredPoolsForAccount(newEmail);
    }
    return false;
}

/**
 * Check a specific account's snapshot for expired quota pools and baseline them.
 * This is the same logic as checkCachedAccountResets() but operates on a single
 * account regardless of its isActive state. Used during account switching to
 * ensure expired pools are archived before the account's active state changes.
 */
function baselineExpiredPoolsForAccount(email: string): void {
    const snap = accountSnapshots.get(email);
    if (!snap) { return; }

    const nowMs = Date.now();
    const pools = snap.resetPools || [];
    for (const pool of pools) {
        if (!pool.resetTime) { continue; }
        const resetDate = new Date(pool.resetTime);
        if (isNaN(resetDate.getTime())) { continue; }

        const diffMs = resetDate.getTime() - nowMs;
        if (diffMs > 0) { continue; } // Not yet expired

        // Skip pools with no confirmed usage — matches UI "Ready" logic
        // Also check ledger for actual data (snapshot hasUsage may be stale)
        if (pool.hasUsage === false
            && !dailyLedger.hasActiveCallsForPool(pool.modelIds || pool.modelLabels, email)) { continue; }

        // Skip if already notified/archived
        const key = `${email}:${pool.resetTime}:${pool.modelLabels.join('|')}`;
        if (notifiedAccountResets.has(key)) { continue; }

        // Skip if already archived in persisted state
        if (gmTracker.isPoolArchived(email, pool.modelIds || pool.modelLabels)) {
            notifiedAccountResets.add(key);
            log(`Account switch baseline: ${email} pool [${pool.modelLabels.slice(0, 3).join(', ')}] already archived — skipped`);
            continue;
        }

        notifiedAccountResets.add(key);

        // ── Baseline GM calls for the expired pool ──
        const baselinedCount = gmTracker.baselineForQuotaReset(email, pool.modelIds || pool.modelLabels, pool.resetTime);
        // ── Settle in DailyLedger too ──
        const cutoffTime = Number.isNaN(resetDate.getTime()) ? undefined : resetDate.getTime();
        const settled = dailyLedger.settleForQuotaReset(pool.modelIds || pool.modelLabels, email, cutoffTime);
        if (baselinedCount > 0 || settled) {
            log(`Account switch baseline: ${email} — ${baselinedCount} GM calls baselined for pool [${pool.modelLabels.slice(0, 3).join(', ')}]`);
            if (settled) {
                log(`  DailyLedger settled: ${settled.totalCalls} calls`);
            }
            lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
            persistGMSummaryToFile(lastGMSummary);
        }

        // ── Step 3: Show notification ──
        const modelNames = pool.modelLabels.slice(0, 3).join(', ');
        const extra = pool.modelLabels.length > 3 ? ` +${pool.modelLabels.length - 3}` : '';
        const displayName = snap.name || snap.email;
        const openMonitorLabel = tBi('Open Monitor', '打开监控');
        vscode.window.showInformationMessage(
            tBi(
                `✅ ${displayName}: ${modelNames}${extra} quota has reset. You can switch to this account now.`,
                `✅ ${displayName}: ${modelNames}${extra} 额度已重置，可以切换到该账号了。`,
            ),
            openMonitorLabel,
        ).then(choice => {
            if (choice === openMonitorLabel) {
                vscode.commands.executeCommand('antigravity-context-monitor.showDetails');
            }
        });
        log(`Account switch reset notification: ${displayName} — ${modelNames}${extra}`);
    }
}

/**
 * Perform daily archival by delegating to the testable core logic.
 * Wires module-level state into a DailyArchivalContext.
 */
function performDailyArchival(force = false): void {
    const ctx: DailyArchivalContext = {
        activityTracker,
        gmTracker,
        dailyStore,
        pricingStore,
        lastGMSummary,
        persistedModelDNA,
        lastArchivalDateKey,
        dailyLedger,
        persist: (updates) => {
            lastArchivalDateKey = updates.lastArchivalDateKey;
            lastGMSummary = updates.lastGMSummary;
            if (updates.modelDNAChanged && updates.persistedModelDNA) {
                persistedModelDNA = updates.persistedModelDNA;
                durableGlobalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
            }
            durableGlobalState.update('lastArchivalDateKey', lastArchivalDateKey);
            durableGlobalState.update('activityTrackerState', activityTracker.serialize());
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
            persistGMSummaryToFile(lastGMSummary);
        },
        log,
    };
    performDailyArchivalCore(ctx, force);
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    extensionContext = context;
    abortController = new AbortController();
    disposed = false;
    outputChannel = vscode.window.createOutputChannel('Antigravity Context Monitor');
    log('Extension activating...');
    const workspaceKey = normalizeUri(getWorkspaceUri() || 'no-workspace');
    durableState = new DurableState();
    durableGlobalState = durableState.globalBucket(context.globalState);
    durableWorkspaceState = durableState.workspaceBucket(workspaceKey, context.workspaceState);
    durableFileGlobalState = durableState.globalBucket();
    durableFileWorkspaceState = durableState.workspaceBucket(workspaceKey);

    // Inject durable state into webview-panel for zoom persistence
    setPanelDurableState(durableFileGlobalState);

    // Initialize quota tracker
    quotaTracker = new QuotaTracker(context, durableGlobalState);
    // The UI toggle is gone, but quota cycle detection still feeds GM repair and daily settlement.
    quotaTracker.setEnabled(true);
    quotaTracker.onQuotaReset = (modelIds: string[], cutoffTime?: string) => {
        // ── Baseline current account's GM calls for the reset pool ──
        const expandedIds = expandModelIdsToPool(modelIds, cachedModelConfigs);
        const cutoffMs = cutoffTime ? Date.parse(cutoffTime) : NaN;
        const ledgerCutoff = Number.isNaN(cutoffMs) ? undefined : cutoffMs;
        const baselinedCount = gmTracker.baselineForQuotaReset(undefined, expandedIds, cutoffTime);
        log(`Quota reset detected: [${modelIds.join(', ')}] (expanded to [${expandedIds.join(', ')}]) — ${baselinedCount} GM calls baselined for new cycle`);

        // ── Settle this pool's data in DailyLedger ──
        // Moves matching model data from "active" to "settled" (pending midnight flush)
        const settled = dailyLedger.settleForQuotaReset(expandedIds, currentAccountEmail, ledgerCutoff);
        if (settled) {
            log(`DailyLedger settled: ${settled.totalCalls} calls for pool [${settled.poolModelLabels.join(', ')}]`);
            durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
        }

        // Update cached summary and persist
        lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
        durableGlobalState.update('gmTrackerState', gmTracker.serialize());
        persistGMSummaryToFile(lastGMSummary);

        // Refresh panel immediately so user sees fresh counts
        if (isMonitorPanelVisible()) {
            updateMonitorPanel(makePanelPayload());
        }
    };

    // Initialize i18n from persisted state
    initI18n(context);
    initI18nFromState(durableGlobalState);

    // Restore persisted lastKnownModel from workspaceState
    lastKnownModel = durableWorkspaceState.get<string>('lastKnownModel', '');
    if (lastKnownModel) {
        log(`Restored lastKnownModel from workspaceState: ${lastKnownModel}`);
    }
    monitorStore = new MonitorStore();
    monitorStore.init(durableFileWorkspaceState);
    const restoredMonitor = monitorStore.restore();
    currentUsage = restoredMonitor.currentUsage;
    allTrajectoryUsages = restoredMonitor.allUsages;

    statusBar = new StatusBarManager();
    setTooltipDiagLogger(log);

    // Initialize activity tracker
    const savedActivity = durableGlobalState.get<ActivityTrackerState | undefined>('activityTrackerState', undefined);
    activityTracker = savedActivity ? ActivityTracker.restore(savedActivity) : new ActivityTracker();
    if (savedActivity) {
        const normalizedActivityState = activityTracker.serialize();
        if (JSON.stringify(savedActivity) !== JSON.stringify(normalizedActivityState)) {
            durableGlobalState.update('activityTrackerState', normalizedActivityState);
            log('Activity tracker state normalized during startup repair');
        }
    }
    const savedGM = durableGlobalState.get<GMTrackerState | undefined>('gmTrackerState', undefined);
    gmTracker = savedGM ? GMTracker.restore(savedGM) : new GMTracker();
    lastGMSummary = durableFileGlobalState.get<GMSummary | null>('gmDetailedSummary', gmTracker.getCachedSummary());
    persistedModelDNA = restoreModelDNAState(
        durableGlobalState.get<ModelDNAStoreState | null>('modelDNAState', null),
    );
    pricingStore = new PricingStore();
    pricingStore.init(durableGlobalState);
    // Restore multi-account snapshots from file-backed state
    restoreAccountSnapshots();
    restoreBillingDays();
    // Restore current account email from GMTracker persisted state
    currentAccountEmail = gmTracker.getCurrentAccount();
    dailyStore = new DailyStore();
    dailyStore.init(durableGlobalState);
    // Initialize DailyLedger — restores from durable state
    const savedLedger = durableGlobalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
    dailyLedger = DailyLedger.restore(savedLedger);
    if (savedLedger?.version === 1 && savedLedger.dateKey && savedLedger.dateKey !== dailyLedger.dateKey) {
        // Log only — never persist a normalization-only (still empty) ledger:
        // flushing an empty full snapshot can overwrite another window's
        // just-written data (last-writer-wins). restore() re-normalizes
        // idempotently on every startup, and the first added>0 persist
        // writes the corrected dateKey to disk.
        log(`[DailyLedger] normalized empty ledger date ${savedLedger.dateKey} → ${dailyLedger.dateKey} during startup restore`);
    }

    // ── Immediate cross-day archival on startup ──
    // If the ledger has data from a previous day (IDE was off overnight),
    // archive it NOW — don't wait for the polling loop or conversation load.
    if (dailyLedger.hasData && dailyLedger.dateKey !== toLocalDateKey()) {
        log(`[Startup] Ledger has stale data from ${dailyLedger.dateKey}, archiving immediately`);
        // Override lastArchivalDateKey to the stale date so performDailyArchival's
        // "sameDay" guard doesn't reject it (it may already be today's date if a
        // previous instance or polling cycle set it without rolling over the ledger).
        lastArchivalDateKey = dailyLedger.dateKey;
        performDailyArchival();
    }

    // ── One-time migration: auto-recover data from legacy Antigravity (pre-2.0) ──
    // Detects old "Antigravity" globalState DB and imports calendar + language.
    // Also supports manual migration-import.json as a fallback.
    try {
        const migrationDir = path.dirname(durableState.getFilePath());
        const migrationDone = durableFileGlobalState.get<boolean>('legacyMigrationDone', false);

        // --- Auto-detect old Antigravity DB ---
        if (!migrationDone) {
            const { extractLegacyData, runLegacyMigrationOnce } = require('./legacy-migration') as typeof import('./legacy-migration');
            runLegacyMigrationOnce({
                migrationDone,
                extractLegacyData: () => extractLegacyData(log),
                importLegacyData: (legacyData) => {
                    if (legacyData.dailyStoreState) {
                        const added = dailyStore.mergeRecords(legacyData.dailyStoreState);
                        log(`Legacy migration: merged ${added} calendar records`);
                    }
                    if (legacyData.displayLanguage && ['zh', 'en', 'both'].includes(legacyData.displayLanguage)) {
                        setLanguageToState(legacyData.displayLanguage as any, durableGlobalState);
                        context.globalState.update('displayLanguage', legacyData.displayLanguage);
                        log(`Legacy migration: restored language to '${legacyData.displayLanguage}'`);
                    }
                },
                markDone: () => {
                    durableFileGlobalState.update('legacyMigrationDone', true);
                },
                log,
            });
        } else {
            log('Legacy migration: data OK, no migration needed');
        }

        // --- Manual migration file (fallback / advanced recovery) ---
        const migrationFile = path.join(migrationDir, 'migration-import.json');
        if (fs.existsSync(migrationFile)) {
            log(`Migration: found manual migration file, importing...`);
            const raw = fs.readFileSync(migrationFile, 'utf8');
            const migration = JSON.parse(raw) as {
                dailyStoreState?: DailyStoreState;
                displayLanguage?: string;
            };
            if (migration.dailyStoreState) {
                const added = dailyStore.mergeRecords(migration.dailyStoreState);
                log(`Migration: merged ${added} calendar records from manual file`);
            }
            if (migration.displayLanguage && ['zh', 'en', 'both'].includes(migration.displayLanguage)) {
                setLanguageToState(migration.displayLanguage as any, durableGlobalState);
                context.globalState.update('displayLanguage', migration.displayLanguage);
                log(`Migration: restored language preference to '${migration.displayLanguage}'`);
            }
            const donePath = migrationFile.replace('.json', '.done.json');
            fs.renameSync(migrationFile, donePath);
            log(`Migration: completed, file renamed to ${donePath}`);
        }
    } catch (migrationErr) {
        log(`Migration: failed — ${migrationErr}`);
    }

    // Restore daily archival date key
    lastArchivalDateKey = durableGlobalState.get<string>('lastArchivalDateKey', '');

    // Restore cached user status from globalState for instant tooltip display
    const savedConfigs = durableGlobalState.get<import('./models').ModelConfig[]>('cachedModelConfigs', []);
    const savedPlan = durableGlobalState.get<string>('cachedPlanName', '');
    const savedTier = durableGlobalState.get<string>('cachedTierName', '');
    if (savedConfigs && savedConfigs.length > 0) {
        cachedModelConfigs = savedConfigs;
        statusBar.setModelConfigs(savedConfigs);
    }
    if (savedPlan) {
        statusBar.setPlanName(savedPlan, savedTier);
    }

    if (lastGMSummary && cachedModelConfigs.length > 0) {
        const repairedGMSummary = gmTracker.repairSummaryFromQuotaHistory(
            lastGMSummary,
            quotaTracker.getHistory(),
            cachedModelConfigs,
        );
        if (repairedGMSummary !== lastGMSummary) {
            lastGMSummary = repairedGMSummary;
            gmTracker.setDetailedSummary(lastGMSummary);
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            persistGMSummaryToFile(lastGMSummary);
            log('GM summary repaired from quota history during startup');
        }
    }

    if (lastGMSummary) {
        gmTracker.setDetailedSummary(lastGMSummary);
    }

    // Bootstrap timeline from file-backed GM summary after reinstall.
    // When globalState is wiped (uninstall/reinstall), activityTracker starts fresh
    // but gmDetailedSummary survives in file storage. Use it to pre-populate the
    // timeline so users see historical data immediately, not an empty panel.
    if (!savedActivity && lastGMSummary && lastGMSummary.conversations.length > 0) {
        const bootstrapped = activityTracker.injectGMData(lastGMSummary);
        if (bootstrapped) {
            durableGlobalState.update('activityTrackerState', activityTracker.serialize());
            log(`Timeline bootstrapped from file-backed GM summary (${lastGMSummary.conversations.length} convs, ${lastGMSummary.totalCalls} calls)`);
        }
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-context-monitor.showDetails', () => {
            showMonitorPanel(makePanelPayload({ context }));
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.refresh', () => {
            log('Manual refresh triggered');
            cachedLsInfo = null;
            hasSyncedCheckpointer = false;
            consecutiveFailures = 0;
            currentIntervalMs = baseIntervalMs;
            restartPolling();
            pollContextUsage();
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.switchLanguage', () => {
            showLanguagePicker(context, durableGlobalState).then(() => {
                // Rebuild statusBar and WebView to reflect new language immediately
                if (currentUsage) {
                    statusBar.update(currentUsage);
                }
                if (isMonitorPanelVisible()) {
                    updateMonitorPanel(makePanelPayload());
                }
            });
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.showActivityPanel', () => {
            showMonitorPanel(makePanelPayload({ context, initialTab: 'gmdata' }));
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.clearToolCatalog', () => {
            // Update the module-level lastGMSummary with the patched summary (empty catalog)
            // so makePanelPayload() doesn't serve stale data with the old catalog.
            lastGMSummary = persistClearedToolCatalog(gmTracker, durableGlobalState, durableFileGlobalState);
            log('[UI] Tool catalog cleared');
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(makePanelPayload());
            }
        }),
        statusBar,
        outputChannel
    );

    // Start polling
    const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const intervalSec = Math.max(1, config.get<number>('pollingInterval', 5));
    baseIntervalMs = intervalSec * 1000;
    currentIntervalMs = baseIntervalMs;



    // Apply status bar display preferences
    applyDisplayPrefs();

    // Apply model internal ID display setting
    setShowModelShortId(config.get<boolean>('showModelInternalId', false));

    schedulePoll();

    // Ensure timer and abort controller are cleaned up when extension is disposed
    context.subscriptions.push({
        dispose: () => {
            if (pollingTimer) {
                clearTimeout(pollingTimer);
                pollingTimer = undefined;
            }
            // Persist GM tracker state on dispose
            if (gmTracker) {
                durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            }
            abortController.abort();
        }
    });

    // Listen for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityContextMonitor.pollingInterval')) {
                const newConfig = vscode.workspace.getConfiguration('antigravityContextMonitor');
                const newIntervalSec = Math.max(1, newConfig.get<number>('pollingInterval', 5));
                baseIntervalMs = newIntervalSec * 1000;
                currentIntervalMs = baseIntervalMs;
                consecutiveFailures = 0;
                restartPolling();
            }

            if (e.affectsConfiguration('antigravityContextMonitor.statusBar')) {
                applyDisplayPrefs();
                if (currentUsage) { statusBar.update(currentUsage); }
                log('Status bar display preferences updated');
            }
            // issue #63: zoom / tooltip density → re-render tooltip (idle/no-conv/update)
            if (
                e.affectsConfiguration('window.zoomLevel')
                || e.affectsConfiguration('antigravityContextMonitor.statusBar.tooltipDensity')
            ) {
                statusBar.refreshFromConfig();
                log('Status bar tooltip density/zoom updated — tooltip re-rendered');
            }
            if (e.affectsConfiguration('antigravityContextMonitor.showModelInternalId')) {
                const newConfig = vscode.workspace.getConfiguration('antigravityContextMonitor');
                setShowModelShortId(newConfig.get<boolean>('showModelInternalId', false));
                log('Model internal ID display setting updated');
            }
        }),
        // ─── Workspace Switch Detection ─────────────────────────────────────
        // When workspace folders change (open different project, add/remove folder),
        // the cached LS and tracked cascade may be stale. Force full re-discovery
        // so trajectories are re-filtered for the new workspace URI.
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            log('Workspace folders changed — forcing LS re-discovery');
            cachedLsInfo = null;
            trackedCascadeId = null;
            lastPolledWorkspaceUri = undefined;
            consecutiveFailures = 0;
            currentIntervalMs = baseIntervalMs;
            lsRevalidationCounter = 0;
            consecutiveIdlePolls = 0;
            stalenessConfirmedIdle = false;
            restartPolling();
            void pollContextUsage();
        })
    );

    log(`Extension activated. Polling every ${intervalSec}s`);

    // Immediate first poll: reduces panel "waiting" state from ~6s to ~1-2s.
    // Activity processing is now merged into pollContextUsage — single unified loop.
    void pollContextUsage();
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
    disposed = true;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = undefined;
    }
    abortController.abort();
    // Persist activity data on deactivate
    if (activityTracker && extensionContext) {
        durableGlobalState.update('activityTrackerState', activityTracker.serialize());
    }
    if (statusBar) {
        statusBar.dispose();
    }

    log('Extension deactivated');
}

// ─── Display Preferences ──────────────────────────────────────────────────────

function applyDisplayPrefs(): void {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    statusBar.setDisplayPrefs({
        showContext: cfg.get<boolean>('statusBar.showContext', true),
        showQuota: cfg.get<boolean>('statusBar.showQuota', true),
        showResetCountdown: cfg.get<boolean>('statusBar.showResetCountdown', true),
        showAiCredits: cfg.get<boolean>('statusBar.showAiCredits', true),
    });
    statusBar.setBillingDay(billingDaysMap[currentAccountEmail] ?? 0);
}

/**
 * Push current account's total AI credits to the status bar.
 */
function updateStatusBarCredits(userInfo: UserStatusInfo | null): void {
    if (!userInfo) { statusBar.setCredits(0); return; }
    const total = (userInfo.availableCredits || [])
        .reduce((sum, c) => sum + (c.creditAmount > 0 ? c.creditAmount : 0), 0);
    statusBar.setCredits(total);
}

/**
 * Extract the latest GM contextTokensUsed for a given cascade from a GMSummary.
 * Returns the value if found and > 0, otherwise 0.
 */
function getLatestGMContextUsed(summary: GMSummary, cascadeId: string): number {
    const conv = summary.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length === 0) { return 0; }
    let latest = 0;
    let latestTime = '';
    for (const call of conv.calls) {
        if (call.contextTokensUsed > 0 && call.createdAt > latestTime) {
            latestTime = call.createdAt;
            latest = call.contextTokensUsed;
        }
    }
    return latest;
}

/** Apply GM precision contextTokensUsed to a ContextUsage object. Returns true if value changed. */
function applyGMContextToUsage(usage: ContextUsage, gmContextUsed: number): boolean {
    if (gmContextUsed <= 0 || gmContextUsed === usage.contextUsed) { return false; }
    usage.contextUsed = gmContextUsed;
    usage.isEstimated = false;
    usage.usagePercent = usage.contextLimit > 0
        ? (gmContextUsed / usage.contextLimit) * 100 : 0;
    return true;
}

// ─── Polling Logic ────────────────────────────────────────────────────────────

async function pollContextUsage(): Promise<void> {
    if (isPolling) { return; }
    isPolling = true;
    let lsInfo = cachedLsInfo;
    try {
        // 1. Determine workspace URI for this window
        const workspaceUri = getWorkspaceUri();
        const normalizedWs = workspaceUri ? normalizeUri(workspaceUri) : '(none)';

        // ─── Workspace URI Change Detection (fallback) ──────────────────
        // If the workspace URI changed since the last poll (e.g., user opened
        // a different folder), invalidate the cached LS and tracked cascade
        // so we re-discover and re-filter trajectories for the new workspace.
        // This is a fallback — the primary detection is onDidChangeWorkspaceFolders.
        if (lastPolledWorkspaceUri !== undefined && lastPolledWorkspaceUri !== normalizedWs) {
            log(`Workspace URI changed: ${lastPolledWorkspaceUri} → ${normalizedWs} — resetting LS cache`);
            cachedLsInfo = null;
            lsInfo = null;
            trackedCascadeId = null;
            consecutiveIdlePolls = 0;
            stalenessConfirmedIdle = false;
        }
        lastPolledWorkspaceUri = normalizedWs;

        // 午夜归档必须在本轮轮询前半段执行：
        // 1. 不能被“无会话 / 无活跃对话”的提前 return 跳过
        // 2. 新一天的 GM / DailyLedger 记录必须建立在已 rollover 的干净状态上
        performDailyArchival();

        // 2. Discover LS (with caching + periodic PID revalidation)
        if (!lsInfo) {
            log('Discovering language server...');
            statusBar.showInitializing();
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal, log);
            cachedLsInfo = lsInfo;
            lsRevalidationCounter = 0;
            consecutiveIdlePolls = 0;

            if (!lsInfo) {
                handleLsFailure('LS not found', true);
                return;
            }
            resetBackoff();
            log(`LS found: pid=${lsInfo.pid} port=${lsInfo.port}, tls=${lsInfo.useTls}`);

            // Dynamically update model display names from GetUserStatus
            try {
                const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                if (fullStatus.configs.length > 0) {
                    updateModelDisplayNames(fullStatus.configs);
                    cachedModelConfigs = fullStatus.configs;
                    statusBar.setModelConfigs(fullStatus.configs);
                    // Detect account switch BEFORE quota processing
                    if (fullStatus.userInfo?.email) {
                        handleAccountSwitchIfNeeded(fullStatus.userInfo.email);
                    }
                    quotaTracker.processUpdate(fullStatus.configs, buildUsedModelIds(fullStatus.userInfo?.email), fullStatus.userInfo?.email);
                    checkQuotaNotification(fullStatus.configs);
                    log(`Updated model display names: ${fullStatus.configs.map(c => c.label).join(', ')}`);
                }
                if (fullStatus.userInfo) {
                    cachedUserInfo = fullStatus.userInfo;
                    updateStatusBarCredits(fullStatus.userInfo);
                    statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                    // Persist for instant display on next activation
                    durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                    durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                    durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                    log(`User: ${fullStatus.userInfo.name} (${fullStatus.userInfo.planName}) credits: prompt=${fullStatus.userInfo.availablePromptCredits} flow=${fullStatus.userInfo.availableFlowCredits}`);
                    updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
                }
            } catch { /* Silent degradation */ }
        } else {
            // ─── Periodic LS PID Revalidation ─────────────────────────────────
            // BUG FIX: When Antigravity updates, a new LS may start while the old
            // one is still alive and responding with stale data. This periodic
            // check detects PID changes and forces reconnection.
            lsRevalidationCounter++;
            if (lsRevalidationCounter >= LS_REVALIDATION_INTERVAL) {
                lsRevalidationCounter = 0;
                try {
                    const freshLs = await discoverLanguageServer(workspaceUri, abortController.signal, log);
                    if (freshLs && freshLs.pid !== lsInfo.pid) {
                        log(`⚠ LS PID changed: ${lsInfo.pid} → ${freshLs.pid} (port: ${lsInfo.port} → ${freshLs.port}). Reconnecting to new LS.`);
                        lsInfo = freshLs;
                        cachedLsInfo = freshLs;
                        hasSyncedCheckpointer = false;
                        consecutiveIdlePolls = 0;
                        // Re-fetch user status from new LS
                        try {
                            const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                            if (fullStatus.configs.length > 0) {
                                updateModelDisplayNames(fullStatus.configs);
                                cachedModelConfigs = fullStatus.configs;
                                statusBar.setModelConfigs(fullStatus.configs);
                                if (fullStatus.userInfo?.email) {
                                    handleAccountSwitchIfNeeded(fullStatus.userInfo.email);
                                }
                                quotaTracker.processUpdate(fullStatus.configs, buildUsedModelIds(fullStatus.userInfo?.email), fullStatus.userInfo?.email);
                                checkQuotaNotification(fullStatus.configs);
                            }
                            if (fullStatus.userInfo) {
                                cachedUserInfo = fullStatus.userInfo;
                                updateStatusBarCredits(fullStatus.userInfo);
                                statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                                durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                                durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                                durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                                updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
                            }
                        } catch { /* Silent */ }
                    }
                } catch {
                    // Discovery failed — keep using current connection
                    log('LS revalidation: discovery failed, keeping current connection');
                }
            }

            // Periodic refresh of user status (every STATUS_REFRESH_INTERVAL polls)
            // IMPORTANT: force refresh on first poll (!firstPollDone) so that
            // _currentAccountEmail is set BEFORE the first fetchAll(). Without this,
            // fetchAll() on restart would tag new calls with the stale account email
            // restored from persistence, causing error attribution mismatch.
            statusPollCount++;
            if (statusPollCount >= STATUS_REFRESH_INTERVAL || !firstPollDone) {
                statusPollCount = 0;
                try {
                    const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                    if (fullStatus.configs.length > 0) {
                        cachedModelConfigs = fullStatus.configs;
                        statusBar.setModelConfigs(fullStatus.configs);
                        if (fullStatus.userInfo?.email) {
                            handleAccountSwitchIfNeeded(fullStatus.userInfo.email);
                        }
                        quotaTracker.processUpdate(fullStatus.configs, buildUsedModelIds(fullStatus.userInfo?.email), fullStatus.userInfo?.email);
                        checkQuotaNotification(fullStatus.configs);
                    }
                    if (fullStatus.userInfo) {
                        cachedUserInfo = fullStatus.userInfo;
                        updateStatusBarCredits(fullStatus.userInfo);
                        statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                        durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                        durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                        durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                        updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
                    }
                    log('Refreshed user status (periodic)');
                } catch { /* Silent — keep cached data */ }
            }
        }

        // Dynamically override context limits once per LS connection with retry on failure
        if (lsInfo && !hasSyncedCheckpointer && !isSyncingCheckpointer) {
            isSyncingCheckpointer = true;
            fetchAndOverrideCheckpointerLimits(lsInfo).then((success) => {
                isSyncingCheckpointer = false;
                if (success) {
                    hasSyncedCheckpointer = true;
                }
            }).catch(() => {
                isSyncingCheckpointer = false;
            });
        }

        // 3. Get all trajectories
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
        } catch (err) {
            log(`RPC failed, retrying discovery: ${err}`);
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal, log);
            cachedLsInfo = lsInfo;
            if (!lsInfo) {
                handleLsFailure('LS connection lost', true);
                return;
            }
            resetBackoff();
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
        }

        resetBackoff();
        lastTrajectories = trajectories;

        if (trajectories.length === 0) {
            const noConvLimit = getContextLimit(lastKnownModel);
            const noConvLimitStr = formatContextLimit(noConvLimit);
            statusBar.showNoConversation(noConvLimitStr, lastKnownModel);
            currentUsage = null;
            allTrajectoryUsages = monitorStore.getAll();
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(makePanelPayload({ currentUsage: null }));
            }
            updateBaselines(trajectories);
            return;
        }

        for (const t of trajectories.slice(0, 5)) {
            const wsUris = t.workspaceUris.map(u => `"${u}" → "${normalizeUri(u)}"`).join(', ');
            log(`  Trajectory "${t.summary?.substring(0, 30)}" status=${t.status} steps=${t.stepCount} workspaces=[${wsUris}]`);
        }

        // 4. Per-window cascade tracking — Workspace Isolation
        // With a workspace: strict filter — only show trajectories belonging to this workspace.
        // Without a workspace (no folder opened): show ALL trajectories, since there is
        // no folder to filter by and Antigravity assigns workspace URIs to all conversations.
        const qualifiedTrajectories = workspaceUri
            ? trajectories.filter(t => t.workspaceUris.some(u => normalizeUri(u) === normalizedWs))
            : trajectories;

        const runningSelection = selectRunningTrajectoryCandidate(
            trajectories,
            qualifiedTrajectories,
            trackedCascadeId,
        );
        const qualifiedRunning = runningSelection.qualifiedRunning;
        let newCandidateId = runningSelection.candidateId;
        let selectionReason = runningSelection.selectionReason;

        log(`Trajectories: ${trajectories.length} total, ${qualifiedTrajectories.length} qualified in ws, ${qualifiedRunning.length} running in ws`);

        // ─── Staleness Heuristic ───────────────────────────────────────────
        // BUG FIX: If we're tracking a RUNNING cascade but LS reports it as IDLE
        // for too many consecutive polls, the LS is probably stale. Force re-discovery.
        if (qualifiedRunning.length === 0 && trackedCascadeId) {
            consecutiveIdlePolls++;
            if (consecutiveIdlePolls >= STALE_LS_IDLE_THRESHOLD && !stalenessConfirmedIdle) {
                log(`⚠ Staleness detected: tracked cascade ${trackedCascadeId.substring(0, 8)} has been IDLE for ${consecutiveIdlePolls} consecutive polls. Forcing LS re-discovery.`);
                consecutiveIdlePolls = 0;
                try {
                    const freshLs = await discoverLanguageServer(workspaceUri, abortController.signal, log);
                    if (freshLs && freshLs.pid !== lsInfo.pid) {
                        log(`⚠ Stale LS confirmed: PID ${lsInfo.pid} → ${freshLs.pid}. Reconnecting.`);
                        lsInfo = freshLs;
                        cachedLsInfo = freshLs;
                        hasSyncedCheckpointer = false;
                        lsRevalidationCounter = 0;
                        stalenessConfirmedIdle = false;
                        // Re-fetch trajectories from the new LS
                        trajectories = await getAllTrajectories(lsInfo, abortController.signal);
                        lastTrajectories = trajectories;
                    } else if (freshLs) {
                        log('LS PID unchanged — staleness was a false alarm (cascade genuinely IDLE)');
                        stalenessConfirmedIdle = true;
                    }
                } catch {
                    log('Staleness re-discovery failed, keeping current connection');
                }
            }
        } else {
            consecutiveIdlePolls = 0;
            stalenessConfirmedIdle = false;
        }

        if (runningSelection.selectedOutsideWorkspace && newCandidateId) {
            const selected = trajectories.find(t => t.cascadeId === newCandidateId);
            const hasWs = !!selected && selected.workspaceUris.length > 0;
            log(`Priority 1b: found RUNNING trajectory ${newCandidateId.substring(0, 8)} ${hasWs ? 'in other workspace' : 'without workspace URI'}`);
        }
        // --- Priority 2: stepCount CHANGE detection ---
        if (!newCandidateId && firstPollDone) {
            const activeChanges = qualifiedTrajectories.filter(t => {
                const prev = previousStepCounts.get(t.cascadeId);
                return prev !== undefined && t.stepCount !== prev;
            });
            const trackedChange = activeChanges.find(t => t.cascadeId === trackedCascadeId);
            if (trackedChange) {
                newCandidateId = trackedChange.cascadeId;
                const prev = previousStepCounts.get(trackedChange.cascadeId) || 0;
                const direction = trackedChange.stepCount > prev ? 'increased' : 'decreased (undo/rewind)';
                selectionReason = `stepCount ${direction}: ${prev} → ${trackedChange.stepCount}`;
            } else if (!trackedCascadeId && activeChanges.length > 0) {
                newCandidateId = activeChanges[0].cascadeId;
                selectionReason = 'stepCount changed in ws';
            }
        }

        // --- Priority 3: New trajectory detection ---
        // Switch to new conversations immediately — even if we're already tracking
        // another cascade. Without this, a new conversation would be ignored on
        // its first poll cycle, causing a visible one-cycle delay before data appears.
        if (!newCandidateId && firstPollDone) {
            const newlyCreated = qualifiedTrajectories.filter(t => !previousTrajectoryIds.has(t.cascadeId));
            if (newlyCreated.length > 0) {
                newCandidateId = newlyCreated[0].cascadeId;
                selectionReason = 'new trajectory appeared in ws';
            }
        }

        // --- Priority 3b: Keep tracked cascade stable if still present ---
        if (!newCandidateId && trackedCascadeId) {
            const trackedQualified = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId)
                || trajectories.find(t => t.cascadeId === trackedCascadeId);
            if (trackedQualified) {
                newCandidateId = trackedQualified.cascadeId;
                selectionReason = 'sticky tracked cascade';
            }
        }

        // --- Priority 4: Most recently modified trajectory in workspace ---
        if (!newCandidateId && qualifiedTrajectories.length > 0) {
            const mostRecent = qualifiedTrajectories[0];
            newCandidateId = mostRecent.cascadeId;
            selectionReason = 'most recently modified in ws (fallback)';
        }

        // Update tracked cascade
        if (newCandidateId) {
            if (trackedCascadeId !== newCandidateId) {
                log(`Switched cascade: ${trackedCascadeId?.substring(0, 8) || 'none'} → ${newCandidateId.substring(0, 8)} (${selectionReason})`);
                trackedCascadeId = newCandidateId;
                isExplicitlyIdle = false;
                consecutiveIdlePolls = 0;
                stalenessConfirmedIdle = false;
            } else if (selectionReason) {
                log(`Refreshing cascade ${trackedCascadeId?.substring(0, 8)} (${selectionReason})`);
            }
        } else if (trackedCascadeId) {
            const currentTracked = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId)
                || trajectories.find(t => t.cascadeId === trackedCascadeId);
            if (!currentTracked) {
                log(`Tracked cascade ${trackedCascadeId.substring(0, 8)} no longer in any list, clearing`);
                trackedCascadeId = null;
                isExplicitlyIdle = true;
            }
        }

        // --- Find the trajectory to display ---
        let activeTrajectory: TrajectorySummary | null = null;

        if (trackedCascadeId) {
            activeTrajectory = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId)
                || trajectories.find(t => t.cascadeId === trackedCascadeId)
                || null;
            if (activeTrajectory && !selectionReason) {
                selectionReason = 'tracked cascade';
            }
        }

        if (!activeTrajectory) {
            const idleLimit = getContextLimit(lastKnownModel);
            const idleLimitStr = formatContextLimit(idleLimit);
            log(`No active trajectory — showing idle (model=${lastKnownModel || 'default'}, limit=${idleLimitStr})`);
            statusBar.showIdle(idleLimitStr, lastKnownModel);
            currentUsage = null;
            allTrajectoryUsages = monitorStore.getAll();
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(makePanelPayload({ currentUsage: null }));
            }
            updateBaselines(trajectories);
            return;
        }

        log(`Selected: "${activeTrajectory.summary}" (${activeTrajectory.cascadeId.substring(0, 8)}) reason=${selectionReason} status=${activeTrajectory.status}`);

        // 5. Get context usage for selected trajectory
        const persistedUsage = monitorStore.getSnapshot(activeTrajectory.cascadeId);
        if (hasSameUsageInputs(currentUsage, activeTrajectory)) {
            currentUsage = rehydrateUsageForDisplay(currentUsage);
        } else if (hasSameUsageInputs(persistedUsage, activeTrajectory)) {
            currentUsage = rehydrateUsageForDisplay(persistedUsage);
        } else {
            currentUsage = await getContextUsage(lsInfo, activeTrajectory, undefined, abortController.signal);
        }
        log(`  → contextUsed=${currentUsage.contextUsed} model=${currentUsage.model} steps=${currentUsage.stepCount} estimated=${currentUsage.isEstimated} ckpt_in=${currentUsage.lastModelUsage?.inputTokens ?? 'none'} ckpt_out=${currentUsage.lastModelUsage?.outputTokens ?? 'none'} estDelta=${currentUsage.estimatedDeltaSinceCheckpoint}`);

        // ── Pre-enhance with cached GM data to prevent step→GM flickering ──
        if (lastGMSummary && trackedCascadeId) {
            applyGMContextToUsage(currentUsage, getLatestGMContextUsed(lastGMSummary, trackedCascadeId));
        }
        statusBar.update(currentUsage);

        // Track the model for idle-state display
        if (currentUsage.model) {
            lastKnownModel = currentUsage.model;
            durableWorkspaceState.update('lastKnownModel', lastKnownModel);
        }

        // ─── Compression Detection ─────────────────────────────────────────
        const prevUsed = previousContextUsedMap.get(currentUsage.cascadeId);
        const prevSteps = previousStepCounts.get(activeTrajectory.cascadeId);
        const isUndo = prevSteps !== undefined && activeTrajectory.stepCount < prevSteps;

        if (!currentUsage.compressionDetected && !isUndo
            && prevUsed !== undefined && currentUsage.contextUsed < prevUsed) {
            const drop = prevUsed - currentUsage.contextUsed;
            if (drop > currentUsage.contextLimit * 0.01) {
                currentUsage.compressionDetected = true;
                currentUsage.previousContextUsed = prevUsed;
                compressionPersistCounters.set(currentUsage.cascadeId, COMPRESSION_PERSIST_POLLS);
                log(`Compression detected (fallback) for ${currentUsage.cascadeId.substring(0, 8)}: ${prevUsed} → ${currentUsage.contextUsed} (dropped ${drop})`);
            }
        }

        if (currentUsage.compressionDetected && !compressionPersistCounters.has(currentUsage.cascadeId)) {
            if (prevUsed !== undefined) {
                currentUsage.previousContextUsed = prevUsed;
            }
            compressionPersistCounters.set(currentUsage.cascadeId, COMPRESSION_PERSIST_POLLS);
            if (currentUsage.checkpointCompressionDrop > 0) {
                log(`Compression detected (checkpoint) for ${currentUsage.cascadeId.substring(0, 8)}: checkpoint inputTokens dropped ${currentUsage.checkpointCompressionDrop}`);
            } else {
                log(`Compression detected (checkpoint) for ${currentUsage.cascadeId.substring(0, 8)}: checkpoint inputTokens dropped`);
            }
        }

        if (!currentUsage.compressionDetected) {
            const remaining = compressionPersistCounters.get(currentUsage.cascadeId);
            if (remaining && remaining > 0) {
                currentUsage.compressionDetected = true;
                if (prevUsed !== undefined) {
                    currentUsage.previousContextUsed = prevUsed;
                }
                compressionPersistCounters.set(currentUsage.cascadeId, remaining - 1);
            }
        }
        previousContextUsedMap.set(currentUsage.cascadeId, currentUsage.contextUsed);

        const sourceLabel = currentUsage.isEstimated ? 'estimated' : 'precise';
        log(`Context: ${currentUsage.contextUsed} tokens (${sourceLabel}) | ${currentUsage.usagePercent.toFixed(1)}% | modelOut=${currentUsage.totalOutputTokens} | toolOut=${currentUsage.totalToolCallOutputTokens} | delta=${currentUsage.estimatedDeltaSinceCheckpoint} | imageGen=${currentUsage.imageGenStepCount}`);

        // 6. Background: compute usage for other recent trajectories
        const scopeTrajectories = buildUsageScopeTrajectories(qualifiedTrajectories, trajectories, activeTrajectory);
        const recentTrajectories = scopeTrajectories.slice(0, 5);
        const usagePromises = recentTrajectories.map(async (t) => {
            if (t.cascadeId === activeTrajectory!.cascadeId) {
                return currentUsage!;
            }
            const cachedUsage = monitorStore.getSnapshot(t.cascadeId);
            if (hasSameUsageInputs(cachedUsage, t)) {
                return rehydrateUsageForDisplay(cachedUsage);
            }
            try {
                return await getContextUsage(lsInfo!, t, undefined, abortController.signal);
            } catch {
                return null;
            }
        });
        const usageResults = await Promise.all(usagePromises);
        allTrajectoryUsages = usageResults.filter((u): u is ContextUsage => u !== null);
        monitorStore.record(allTrajectoryUsages, currentUsage.cascadeId);
        allTrajectoryUsages = monitorStore.getAll();

        // 6c. Activity processing (merged — reuses already-fetched trajectories, no duplicate RPC)
        if (activityTracker && lsInfo) {
            try {
                const activityChanged = await activityTracker.processTrajectories(
                    lsInfo,
                    trajectories.map(t => ({
                        cascadeId: t.cascadeId,
                        stepCount: t.stepCount,
                        status: t.status,
                        requestedModel: t.requestedModel,
                        generatorModel: t.generatorModel,
                    })),
                    abortController.signal,
                );

                // Fetch GM data (piggyback on same poll cycle)
                let gmChanged = false;
                try {
                    const prevSummary = lastGMSummary;
                    const gmSummary = await gmTracker.fetchAll(
                        lsInfo,
                        trajectories.map(t => ({ cascadeId: t.cascadeId, title: t.summary || t.cascadeId.substring(0, 8), stepCount: t.stepCount, status: t.status })),
                        currentUsage?.cascadeId,
                        abortController.signal,
                    );
                    const detailedSummary = gmTracker.getDetailedSummary() || gmSummary;
                    gmChanged = hasGMSummaryChanged(prevSummary, detailedSummary);
                    lastGMSummary = detailedSummary;
                    monitorStore.recordGMConversations(gmTracker.getAllConversationData());
                    if (gmChanged || !prevSummary) {
                        persistGMSummaryToFile(detailedSummary);
                        const mergedDNA = mergeModelDNAState(persistedModelDNA, detailedSummary);
                        if (mergedDNA.changed) {
                            persistedModelDNA = mergedDNA.entries;
                            durableGlobalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
                        }
                    }
                } catch { /* GM fetch failure is non-critical */ }

                // ── DailyLedger: record new GM calls incrementally ──
                // This is the core "write-once" mechanism: once a call is recorded
                // in the ledger, it survives even if the LS drops the conversation.
                try {
                    const { entries: newEntries, debug: ledgerDebug, revertedCascadeIds } = gmTracker.getNewCallsSinceLastRecord();
                    // Clear stale dedup IDs for reverted conversations BEFORE recording
                    for (const cid of revertedCascadeIds) {
                        dailyLedger.clearRecordedIdsForConversation(cid);
                        log(`[DailyLedger] cleared dedup IDs for reverted conversation ${cid.substring(0, 8)}`);
                    }
                    if (newEntries.length > 0) {
                        const ledgerDateBeforeRecord = dailyLedger.dateKey;
                        const ledgerNormalizedBeforeRecord = dailyLedger.normalizeIfStaleEmpty();
                        if (ledgerNormalizedBeforeRecord) {
                            log(`[DailyLedger] normalized empty ledger date ${ledgerDateBeforeRecord} → ${dailyLedger.dateKey} before recording`);
                        }
                        const added = dailyLedger.recordCalls(newEntries);
                        log(`[DailyLedger] extracted=${newEntries.length} added=${added} dedup_rejected=${newEntries.length - added}`);
                        for (const d of ledgerDebug) { log(`[DailyLedger]   ${d}`); }
                        if (added === newEntries.length) {
                            gmTracker.markLedgerEntriesRecorded(newEntries);
                        } else {
                            log('[DailyLedger] ledger positions retained for retry because not all entries were accepted');
                        }
                        // Persist only when calls were actually added — a normalization-only
                        // (still empty) flush could overwrite another window's fresh data (LWW).
                        if (added > 0) {
                            durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                        }
                    }
                    if (revertedCascadeIds.length > 0) {
                        durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                    }
                } catch { /* Ledger recording failure is non-critical */ }

                // ── DailyLedger: proactive settlement by resetTime ──
                // Unlike QuotaTracker's heuristic detection, this directly checks
                // whether each pool's resetTime has passed and settles unsettled pools.
                try {
                    const nowMs = Date.now();
                    for (const snap of accountSnapshots.values()) {
                        for (const pool of (snap.resetPools || [])) {
                            if (!pool.resetTime || !pool.modelIds?.length) { continue; }
                            const resetMs = new Date(pool.resetTime).getTime();
                            if (isNaN(resetMs) || resetMs > nowMs) { continue; }


                            // Skip if no usage or already settled
                            // hasUsage from snapshot may be stale for inactive accounts,
                            // so also check if ledger has actual recorded calls for this pool
                            if (pool.hasUsage === false
                                && !dailyLedger.hasActiveCallsForPool(pool.modelIds, snap.email)) { continue; }
                            if (dailyLedger.isPoolSettled(pool.modelIds, snap.email, resetMs)) { continue; }
                            // Settle!
                            const settled = dailyLedger.settleForQuotaReset(pool.modelIds, snap.email, resetMs);
                            if (settled) {
                                log(`[DailyLedger] proactive settlement: ${settled.totalCalls} calls for [${settled.poolModelLabels.join(', ')}] (${snap.email})`);
                                durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                                
                                // 同步对 GMTracker 进行 quota-reset 归档
                                try {
                                    const blCount = gmTracker.baselineForQuotaReset(snap.email, pool.modelIds, pool.resetTime);
                                    log(`[GMTracker] proactive baseline: ${blCount} calls for [${pool.modelIds.join(', ')}] (${snap.email})`);
                                    lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                                    durableGlobalState.update('gmTrackerState', gmTracker.serialize());
                                    persistGMSummaryToFile(lastGMSummary);
                                } catch (e) {
                                    log(`[GMTracker] proactive baseline failed: ${e}`);
                                }
                            }
                        }
                    }
                } catch { /* Proactive settlement failure is non-critical */ }

                // Inject GM precision data into activity timeline events.
                // GM is the SOLE source of truth for timeline — always inject when data exists.
                let timelineChanged = false;
                if (lastGMSummary) {
                    timelineChanged = activityTracker.injectGMData(lastGMSummary);

                    // ── Enhance status bar with fresh GM data (new calls since last poll) ──
                    if (currentUsage && trackedCascadeId) {
                        const gmCtx = getLatestGMContextUsed(lastGMSummary, trackedCascadeId);
                        const oldUsed = currentUsage.contextUsed;
                        if (applyGMContextToUsage(currentUsage, gmCtx)) {
                            statusBar.update(currentUsage);
                            log(`Status bar enhanced with GM precision: contextUsed ${oldUsed} → ${gmCtx}`);
                        }
                    }
                }

                // Throttled activity persistence (max once per 30s)
                const now = Date.now();
                if ((activityChanged || gmChanged || timelineChanged) && now - lastActivityPersistTime > 30_000) {
                    durableGlobalState.update('activityTrackerState', activityTracker.serialize());
                    if (gmTracker) {
                        durableGlobalState.update('gmTrackerState', gmTracker.serialize());
                        if (lastGMSummary) {
                            persistGMSummaryToFile(lastGMSummary);
                        }
                    }
                    lastActivityPersistTime = now;
                }
            } catch (err) {
                log(`Activity processing error: ${err}`);
            }
        }

        // 6d. Update WebView panel if visible (single unified refresh point)
        if (isMonitorPanelVisible()) {
            updateMonitorPanel(makePanelPayload());
        }

        // 7. Update baselines for next poll
        updateBaselines(trajectories);

    } catch (err) {
        log(`Polling error: ${err}`);
        handleLsFailure(`Error: ${err}`);
        lsInfo = null;
        cachedLsInfo = null;
    } finally {
        // Always run cached-account reset check — independent of polling success/failure.
        // Wrapped in its own try/catch so errors are logged, never silently swallowed.
        try {
            checkCachedAccountResets();
        } catch (resetErr) {
            log(`[ResetCheck] ERROR: ${resetErr}`);
        }
        isPolling = false;
    }
}

function handleLsFailure(message: string, isDiscoveryFailure = false): void {
    consecutiveFailures++;
    currentUsage = null;
    allTrajectoryUsages = monitorStore.getAll();
    statusBar.showDisconnected(message);
    if (isMonitorPanelVisible()) {
        updateMonitorPanel(makePanelPayload({ currentUsage: null }));
    }

    // Use a lower cap for discovery failures (LS not yet started) so the
    // extension detects a newly launched LS within ~15s instead of ~60s.
    const maxBackoff = isDiscoveryFailure ? MAX_DISCOVERY_BACKOFF_MS : MAX_BACKOFF_INTERVAL_MS;
    const backoffMs = Math.min(baseIntervalMs * Math.pow(2, consecutiveFailures - 1), maxBackoff);

    if (backoffMs !== currentIntervalMs) {
        currentIntervalMs = backoffMs;
        restartPolling();
        log(`Backoff: ${consecutiveFailures} consecutive failures, polling every ${currentIntervalMs / 1000}s`);
    }
}

function resetBackoff(): void {
    if (consecutiveFailures > 0) {
        log(`Backoff reset: LS reconnected after ${consecutiveFailures} failures`);
        consecutiveFailures = 0;
        currentIntervalMs = baseIntervalMs;
        restartPolling();
    }
}

function updateBaselines(trajectories: TrajectorySummary[]): void {
    previousStepCounts.clear();
    previousTrajectoryIds.clear();
    const activeIds = new Set<string>();
    for (const t of trajectories) {
        previousStepCounts.set(t.cascadeId, t.stepCount);
        previousTrajectoryIds.add(t.cascadeId);
        activeIds.add(t.cascadeId);
    }
    for (const id of previousContextUsedMap.keys()) {
        if (!activeIds.has(id)) {
            previousContextUsedMap.delete(id);
        }
    }
    for (const id of compressionPersistCounters.keys()) {
        if (!activeIds.has(id)) {
            compressionPersistCounters.delete(id);
        }
    }
    firstPollDone = true;
}

function schedulePoll(): void {
    if (disposed) { return; }
    const myGeneration = ++pollGeneration;
    pollingTimer = setTimeout(async () => {
        try {
            await pollContextUsage();
        } catch (err) {
            try { log(`Unexpected polling error: ${err}`); } catch { /* ignore */ }
        } finally {
            if (pollGeneration === myGeneration) {
                schedulePoll();
            }
        }
    }, currentIntervalMs);
}

function restartPolling(): void {
    if (pollingTimer) {
        clearTimeout(pollingTimer);
    }
    schedulePoll();
    log(`Polling restarted: ${currentIntervalMs / 1000}s interval`);
}
// ─── Low Quota Notification ───────────────────────────────────────────────────

function checkQuotaNotification(configs: import('./models').ModelConfig[]): void {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const thresholdPct = cfg.get<number>('quotaNotificationThreshold', 20);
    if (thresholdPct <= 0) { return; } // disabled

    const thresholdFrac = thresholdPct / 100;

    // Group models by stable quota pool. Known pools must not be merged just
    // because their resetTime strings happen to match.
    const groups = new Map<string, { labels: string[]; minFraction: number }>();
    for (const group of groupModelConfigsByQuotaPool(configs)) {
        groups.set(group.key, { labels: group.labels, minFraction: group.minFraction });
    }

    for (const [groupKey, group] of groups) {
        if (group.minFraction <= thresholdFrac) {
            // Only notify once per group per threshold crossing
            if (!quotaNotifiedModels.has(groupKey)) {
                quotaNotifiedModels.add(groupKey);
                const pct = (group.minFraction * 100).toFixed(1);
                const names = group.labels.join(', ');
                const openMonitorLabel = tBi('Open Monitor', '打开监控');
                vscode.window.showWarningMessage(
                    tBi(
                        `⚠ ${names} quota low: ${pct}% remaining`,
                        `⚠ ${names} 额度偏低：剩余 ${pct}%`,
                    ),
                    openMonitorLabel,
                ).then(choice => {
                    if (choice === openMonitorLabel) {
                        vscode.commands.executeCommand('antigravity-context-monitor.showDetails');
                    }
                });
                log(`Low quota notification (group): ${names} at ${pct}%`);
            }
        } else {
            // Recovered above threshold — re-arm notification
            quotaNotifiedModels.delete(groupKey);
        }
    }
}

/**
 * Check if any cached (non-active) account's quota has reset.
 * Sends a one-time VS Code notification per reset event.
 */
function checkCachedAccountResets(): void {
    const nowMs = Date.now();
    for (const snap of accountSnapshots.values()) {
        if (snap.isActive) { continue; }

        const pools = snap.resetPools || [];
        for (const pool of pools) {
            if (!pool.resetTime) { continue; }
            const resetDate = new Date(pool.resetTime);
            if (isNaN(resetDate.getTime())) { continue; }

            const diffMs = resetDate.getTime() - nowMs;
            if (diffMs > 0) { continue; }



            // Skip pools with no confirmed usage — matches UI "Ready" logic
            // Also check ledger for actual data (snapshot hasUsage may be stale
            // for accounts that haven't been active since the last API refresh)
            if (pool.hasUsage === false
                && !dailyLedger.hasActiveCallsForPool(pool.modelIds || pool.modelLabels, snap.email)) { continue; }

            const modelNames = pool.modelLabels.slice(0, 3).join(', ');
            const key = `${snap.email}:${pool.resetTime}:${pool.modelLabels.join('|')}`;
            if (notifiedAccountResets.has(key)) { continue; }

            // ── Guard: skip if this pool was already archived (persisted state) ──
            if (gmTracker.isPoolArchived(snap.email, pool.modelIds || pool.modelLabels)) {
                notifiedAccountResets.add(key);
                log(`[ResetCheck] ${snap.email} [${modelNames}]: already-archived — skipped`);
                continue;
            }

            // ── WILL TRIGGER ──
            log(`[ResetCheck]   [${modelNames}] >>> TRIGGERING archival for ${snap.email}`);
            notifiedAccountResets.add(key);

            const extra = pool.modelLabels.length > 3 ? ` +${pool.modelLabels.length - 3}` : '';
            const displayName = snap.name || snap.email;
            const openMonitorLabel = tBi('Open Monitor', '打开监控');

            // ── Baseline this cached account's GM calls for the expired pool only ──
            const baselinedCount = gmTracker.baselineForQuotaReset(snap.email, pool.modelIds || pool.modelLabels, pool.resetTime);
            // Also archive any active QuotaTracker sessions for this cached account's pool.
            // Without this, sessions stay in 'tracking' forever because processUpdate()
            // never receives API configs for non-active accounts.
            const archivedSessions = quotaTracker.archiveExpiredSessions(snap.email, pool.modelIds || pool.modelLabels);
            // ── Settle this pool in DailyLedger ──
            const cutoffTime = Number.isNaN(resetDate.getTime()) ? undefined : resetDate.getTime();
            const settled = dailyLedger.settleForQuotaReset(pool.modelIds || pool.modelLabels, snap.email, cutoffTime);
            if (baselinedCount > 0 || archivedSessions > 0 || settled) {
                log(`[ResetCheck]   ${baselinedCount} GM calls baselined, ${archivedSessions} quota sessions archived`);
                if (settled) {
                    log(`[ResetCheck]   DailyLedger settled: ${settled.totalCalls} calls for [${settled.poolModelLabels.join(', ')}]`);
                }
                lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                durableGlobalState.update('gmTrackerState', gmTracker.serialize());
                durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                persistGMSummaryToFile(lastGMSummary);
            } else {
                log(`[ResetCheck]   baselineForQuotaReset returned 0 — no calls to archive`);
            }

            vscode.window.showInformationMessage(
                tBi(
                    `✅ ${displayName}: ${modelNames}${extra} quota has reset. You can switch to this account now.`,
                    `✅ ${displayName}: ${modelNames}${extra} 额度已重置，可以切换到该账号了。`,
                ),
                openMonitorLabel,
            ).then(choice => {
                if (choice === openMonitorLabel) {
                    vscode.commands.executeCommand('antigravity-context-monitor.showDetails');
                }
            });
            log(`[ResetCheck]   Notification sent: ${displayName} — ${modelNames}${extra}`);
        }
    }
}


function getStorageDiagnostics(): StorageDiagnostics {
    const stateFilePath = durableState.getFilePath();
    const stateFileExists = durableState.exists();
    let stateFileSizeBytes = 0;
    try {
        stateFileSizeBytes = stateFileExists ? fs.statSync(stateFilePath).size : 0;
    } catch { /* ignore stat errors */ }

    return {
        stateFilePath,
        stateFileExists,
        stateFileSizeBytes,
        stateFileOpenWarnBytes: LARGE_STATE_FILE_WARN_BYTES,
        calendarDayCount: dailyStore?.totalDays || 0,
    };
}

function log(message: string): void {
    const timestamp = new Date().toISOString().substring(11, 23);
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}

// ─── Workspace Detection ──────────────────────────────────────────────────────

function getWorkspaceUri(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    const uri = folders[0].uri.toString();
    // Log remote URIs for diagnostic purposes
    if (uri.startsWith('vscode-remote://')) {
        log(`Remote workspace URI detected: ${uri}`);
    }
    return uri;
}

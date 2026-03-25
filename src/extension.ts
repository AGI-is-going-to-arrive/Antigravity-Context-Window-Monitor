import * as vscode from 'vscode';
import { discoverLanguageServer, LSInfo } from './discovery';
import {
    getAllTrajectories,
    getContextUsage,
    getContextLimit,
    normalizeUri,
    fetchFullUserStatus,
    updateModelDisplayNames,
    ContextUsage,
    TrajectorySummary,
    UserStatusInfo,
} from './tracker';
import { StatusBarManager, formatContextLimit } from './statusbar';
import { initI18n, initI18nFromState, showLanguagePicker, tBi } from './i18n';
import { showMonitorPanel, updateMonitorPanel, isMonitorPanelVisible } from './webview-panel';
import { ActivityTracker, ActivityTrackerState } from './activity-tracker';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, COMPRESSION_PERSIST_POLLS } from './constants';
import { QuotaTracker } from './quota-tracker';
import { GMTracker, GMSummary, GMTrackerState, filterGMSummaryByModels } from './gm-tracker';
import { PricingStore } from './pricing-store';
import { DailyStore } from './daily-store';
import { MonitorStore } from './monitor-store';
import { findLatestQuotaSessionForPool, groupModelIdsByResetPool } from './pool-utils';
import { DurableState, StateBucket } from './durable-state';
import type { StorageDiagnostics } from './webview-settings-tab';

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
let monitorStore: MonitorStore;
let durableState: DurableState;
let durableGlobalState: StateBucket;
let durableWorkspaceState: StateBucket;
let durableFileGlobalState: StateBucket;
let durableFileWorkspaceState: StateBucket;

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
let consecutiveFailures = 0;

// AbortController — cancel in-flight RPC requests on extension deactivate.
let abortController = new AbortController();

/** Map of cascadeId → remaining polls to show compression indicator. */
const compressionPersistCounters = new Map<string, number>();

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

    // Initialize quota tracker
    quotaTracker = new QuotaTracker(context, durableGlobalState);
    quotaTracker.onQuotaReset = (modelIds: string[]) => {
        if (activityTracker) {
            const preResetGMSummary = lastGMSummary;
            const quotaHistory = quotaTracker.getHistory();
            const resetPools = groupModelIdsByResetPool(modelIds, cachedModelConfigs);

            for (const poolModelIds of resetPools) {
                log(`Quota reset [${poolModelIds.join(', ')}] — archiving pool snapshot`);

                const quotaSession = findLatestQuotaSessionForPool(
                    poolModelIds,
                    cachedModelConfigs,
                    quotaHistory,
                );
                const poolGMSummary = filterGMSummaryByModels(preResetGMSummary, poolModelIds);
                const archive = activityTracker.archiveAndReset(poolModelIds, {
                    startTime: quotaSession?.startTime,
                    endTime: quotaSession?.endTime,
                });

                if (archive && dailyStore) {
                    let costTotal: number | undefined;
                    let costPerModel: Record<string, number> | undefined;
                    if (poolGMSummary && pricingStore) {
                        const result = pricingStore.calculateCosts(poolGMSummary);
                        if (result.grandTotal > 0) {
                            costTotal = result.grandTotal;
                        }
                        costPerModel = {};
                        for (const row of result.rows) {
                            if (row.totalCost > 0) {
                                costPerModel[row.name] = row.totalCost;
                            }
                        }
                    }
                    dailyStore.addCycle(archive, poolGMSummary, costTotal, costPerModel);
                }

                gmTracker.reset(poolModelIds);
            }

            durableGlobalState.update('activityTrackerState', activityTracker.serialize());
            lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            durableFileGlobalState.update('gmDetailedSummary', lastGMSummary);
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

    // Initialize activity tracker
    const savedActivity = durableGlobalState.get<ActivityTrackerState | undefined>('activityTrackerState', undefined);
    activityTracker = savedActivity ? ActivityTracker.restore(savedActivity) : new ActivityTracker();
    const savedGM = durableGlobalState.get<GMTrackerState | undefined>('gmTrackerState', undefined);
    gmTracker = savedGM ? GMTracker.restore(savedGM) : new GMTracker();
    lastGMSummary = durableFileGlobalState.get<GMSummary | null>('gmDetailedSummary', gmTracker.getCachedSummary());
    pricingStore = new PricingStore();
    pricingStore.init(durableGlobalState);
    dailyStore = new DailyStore();
    dailyStore.init(durableGlobalState);

    // Retroactive import: backfill existing archives into calendar
    const existingArchives = activityTracker.getArchives();
    if (existingArchives.length > 0) {
        const imported = dailyStore.importArchives(existingArchives);
        if (imported > 0) {
            log(`Calendar: retroactively imported ${imported} archive(s) from activity history`);
        }
    }

    // NOTE: live-snapshot removed — calendar data is written exclusively via
    // onQuotaReset callback (authoritative source) + importArchives cold-start backfill.
    // This eliminates duplicate cycle entries and GM data inconsistencies.

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

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-context-monitor.showDetails', () => {
            showMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, context, quotaTracker, activityTracker?.getSummary() ?? null, undefined, activityTracker?.getArchives(), activityTracker, lastGMSummary, monitorStore.getGMConversations(), pricingStore, dailyStore, getStorageDiagnostics());
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.refresh', () => {
            log('Manual refresh triggered');
            cachedLsInfo = null;
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
                    updateMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, undefined, undefined, undefined, undefined, monitorStore.getGMConversations(), getStorageDiagnostics());
                }
                });
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.showActivityPanel', () => {
            showMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, context, quotaTracker, activityTracker?.getSummary() ?? null, 'gmdata', activityTracker?.getArchives(), activityTracker, lastGMSummary, monitorStore.getGMConversations(), pricingStore, dailyStore, getStorageDiagnostics());
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.devSimulateReset', () => {
            if (!activityTracker) { return; }
            log('[Dev] Simulating quota reset...');
            const modelIds = ['[simulate]'];
            activityTracker.archiveAndReset(modelIds);
            durableGlobalState.update('activityTrackerState', activityTracker.serialize());
            const archives = activityTracker.getArchives();
            if (archives.length > 0 && dailyStore) {
                const latest = archives[0];
                let costTotal: number | undefined;
                let costPerModel: Record<string, number> | undefined;
                if (lastGMSummary && pricingStore) {
                    const result = pricingStore.calculateCosts(lastGMSummary);
                    costTotal = result.grandTotal;
                    costPerModel = {};
                    for (const row of result.rows) {
                        if (row.totalCost > 0) { costPerModel[row.name] = row.totalCost; }
                    }
                }
                dailyStore.addCycle(latest, lastGMSummary, costTotal, costPerModel);
            }
            gmTracker.reset(); // dev simulate = global reset
            lastGMSummary = null;
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            durableFileGlobalState.update('gmDetailedSummary', null);
            log('[Dev] Quota reset simulated — activity archived, GM baselines set');
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.devClearGM', () => {
            log('[Dev] Full GM reset (clear all data + baselines)...');
            gmTracker.fullReset();
            monitorStore.clearGMConversations();
            lastGMSummary = null;
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            durableFileGlobalState.update('gmDetailedSummary', null);
            log('[Dev] GM data fully cleared — next fetch will baseline all API data');
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.devPersistActivity', () => {
            if (activityTracker) {
                durableGlobalState.update('activityTrackerState', activityTracker.serialize());
                log('[Dev] Activity tracker state persisted to globalState');
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

    // Apply compression warning threshold
    const threshold = config.get<number>('compressionWarningThreshold', 200_000);
    statusBar.setWarningThreshold(threshold);

    // Apply status bar display preferences
    applyDisplayPrefs();

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
            if (e.affectsConfiguration('antigravityContextMonitor.compressionWarningThreshold')) {
                const newConfig = vscode.workspace.getConfiguration('antigravityContextMonitor');
                const newThreshold = newConfig.get<number>('compressionWarningThreshold', 200_000);
                statusBar.setWarningThreshold(newThreshold);
                log(`Compression warning threshold updated to ${newThreshold}`);
            }
            if (e.affectsConfiguration('antigravityContextMonitor.statusBar')) {
                applyDisplayPrefs();
                log('Status bar display preferences updated');
            }
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
    });
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

        // 2. Discover LS (with caching)
        if (!lsInfo) {
            log('Discovering language server...');
            statusBar.showInitializing();
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal);
            cachedLsInfo = lsInfo;

            if (!lsInfo) {
                handleLsFailure('LS not found');
                return;
            }
            resetBackoff();
            log(`LS found: port=${lsInfo.port}, tls=${lsInfo.useTls}`);

            // Dynamically update model display names from GetUserStatus
            try {
                const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                if (fullStatus.configs.length > 0) {
                    updateModelDisplayNames(fullStatus.configs);
                    cachedModelConfigs = fullStatus.configs;
                    statusBar.setModelConfigs(fullStatus.configs);
                    quotaTracker.processUpdate(fullStatus.configs);
                    checkQuotaNotification(fullStatus.configs);
                    log(`Updated model display names: ${fullStatus.configs.map(c => c.label).join(', ')}`);
                }
                if (fullStatus.userInfo) {
                    cachedUserInfo = fullStatus.userInfo;
                    statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                    // Persist for instant display on next activation
                    durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                    durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                    durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                    log(`User: ${fullStatus.userInfo.name} (${fullStatus.userInfo.planName}) credits: prompt=${fullStatus.userInfo.availablePromptCredits} flow=${fullStatus.userInfo.availableFlowCredits}`);
                }
            } catch { /* Silent degradation */ }
        } else {
            // Periodic refresh of user status (every STATUS_REFRESH_INTERVAL polls)
            statusPollCount++;
            if (statusPollCount >= STATUS_REFRESH_INTERVAL) {
                statusPollCount = 0;
                try {
                    const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                    if (fullStatus.configs.length > 0) {
                        cachedModelConfigs = fullStatus.configs;
                        statusBar.setModelConfigs(fullStatus.configs);
                        quotaTracker.processUpdate(fullStatus.configs);
                        checkQuotaNotification(fullStatus.configs);
                    }
                    if (fullStatus.userInfo) {
                        cachedUserInfo = fullStatus.userInfo;
                        statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                        durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                        durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                        durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                    }
                    log('Refreshed user status (periodic)');
                } catch { /* Silent — keep cached data */ }
            }
        }

        // 3. Get all trajectories
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
        } catch (err) {
            log(`RPC failed, retrying discovery: ${err}`);
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal);
            cachedLsInfo = lsInfo;
            if (!lsInfo) {
                handleLsFailure('LS connection lost');
                return;
            }
            resetBackoff();
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
        }

        resetBackoff();

        if (trajectories.length === 0) {
            const config0 = vscode.workspace.getConfiguration('antigravityContextMonitor');
            const customLimits0 = config0.get<Record<string, number>>('contextLimits');
            const noConvLimit = getContextLimit(lastKnownModel, customLimits0);
            const noConvLimitStr = formatContextLimit(noConvLimit);
            statusBar.showNoConversation(noConvLimitStr);
            currentUsage = null;
            allTrajectoryUsages = monitorStore.getAll();
            updateBaselines(trajectories);
            return;
        }

        for (const t of trajectories.slice(0, 5)) {
            const wsUris = t.workspaceUris.map(u => `"${u}" → "${normalizeUri(u)}"`).join(', ');
            log(`  Trajectory "${t.summary?.substring(0, 30)}" status=${t.status} steps=${t.stepCount} workspaces=[${wsUris}]`);
        }

        // 4. Per-window cascade tracking — STRICT Workspace Isolation
        const qualifiedTrajectories = trajectories.filter(t => {
            if (workspaceUri) {
                return t.workspaceUris.some(u => normalizeUri(u) === normalizedWs);
            }
            return t.workspaceUris.length === 0;
        });

        const qualifiedRunning = qualifiedTrajectories.filter(t => t.status === CascadeStatus.RUNNING);
        let newCandidateId: string | null = null;
        let selectionReason = '';

        log(`Trajectories: ${trajectories.length} total, ${qualifiedTrajectories.length} qualified in ws, ${qualifiedRunning.length} running in ws`);

        // --- Priority 1: RUNNING status detection ---
        if (qualifiedRunning.length > 0) {
            const currentStillRunning = qualifiedRunning.find(t => t.cascadeId === trackedCascadeId);
            if (currentStillRunning) {
                newCandidateId = currentStillRunning.cascadeId;
                selectionReason = 'tracked cascade is RUNNING';
            } else {
                newCandidateId = qualifiedRunning[0].cascadeId;
                selectionReason = 'new RUNNING cascade in ws';
            }
        }
        // --- Priority 1b: RUNNING without workspace URI ---
        if (!newCandidateId) {
            const allRunning = trajectories.filter(t =>
                t.status === CascadeStatus.RUNNING &&
                t.workspaceUris.length === 0
            );
            if (allRunning.length > 0) {
                newCandidateId = allRunning[0].cascadeId;
                selectionReason = 'RUNNING cascade without workspace (new conversation)';
                log(`Priority 1b: found RUNNING trajectory ${newCandidateId!.substring(0, 8)} without workspace URI`);
            }
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
        if (!newCandidateId && firstPollDone && !trackedCascadeId) {
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
            const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
            const customLimits = config.get<Record<string, number>>('contextLimits');
            const idleLimit = getContextLimit(lastKnownModel, customLimits);
            const idleLimitStr = formatContextLimit(idleLimit);
            log(`No active trajectory — showing idle (model=${lastKnownModel || 'default'}, limit=${idleLimitStr})`);
            statusBar.showIdle(idleLimitStr);
            currentUsage = null;
            allTrajectoryUsages = monitorStore.getAll();
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(null, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, quotaTracker, activityTracker?.getSummary() ?? null, activityTracker?.getArchives(), lastGMSummary, monitorStore.getGMConversations(), getStorageDiagnostics());
            }
            updateBaselines(trajectories);
            return;
        }

        log(`Selected: "${activeTrajectory.summary}" (${activeTrajectory.cascadeId.substring(0, 8)}) reason=${selectionReason} status=${activeTrajectory.status}`);

        // 5. Get context usage for selected trajectory
        const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
        const customLimits = config.get<Record<string, number>>('contextLimits');

        currentUsage = await getContextUsage(lsInfo, activeTrajectory, customLimits, abortController.signal);
        log(`  → contextUsed=${currentUsage.contextUsed} model=${currentUsage.model} steps=${currentUsage.stepCount} estimated=${currentUsage.isEstimated} ckpt_in=${currentUsage.lastModelUsage?.inputTokens ?? 'none'} ckpt_out=${currentUsage.lastModelUsage?.outputTokens ?? 'none'} estDelta=${currentUsage.estimatedDeltaSinceCheckpoint}`);
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
        const scopeTrajectories = qualifiedTrajectories.length > 0 ? qualifiedTrajectories : trajectories;
        const recentTrajectories = scopeTrajectories.slice(0, 5);
        const usagePromises = recentTrajectories.map(async (t) => {
            if (t.cascadeId === activeTrajectory!.cascadeId) {
                return currentUsage!;
            }
            try {
                return await getContextUsage(lsInfo!, t, customLimits, abortController.signal);
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
                    const gmSummary = await gmTracker.fetchAll(
                        lsInfo,
                        trajectories.map(t => ({ cascadeId: t.cascadeId, title: t.summary || t.cascadeId.substring(0, 8), stepCount: t.stepCount, status: t.status })),
                        abortController.signal,
                    );
                    const detailedSummary = gmTracker.getDetailedSummary() || gmSummary;
                    monitorStore.recordGMConversations(gmTracker.getAllConversationData());
                    durableFileGlobalState.update('gmDetailedSummary', detailedSummary);
                    const prevSummary = lastGMSummary;
                    lastGMSummary = detailedSummary;
                    if (!lastGMSummary
                        || !prevSummary
                        || gmSummary.totalCalls !== prevSummary.totalCalls
                        || gmSummary.totalStepsCovered !== prevSummary.totalStepsCovered
                        || gmSummary.totalRetryCount !== prevSummary.totalRetryCount
                        || gmSummary.totalCredits !== prevSummary.totalCredits) {
                        gmChanged = true;
                    }
                } catch { /* GM fetch failure is non-critical */ }

                // Inject GM precision data into activity timeline events
                let timelineChanged = false;
                if (lastGMSummary) {
                    timelineChanged = activityTracker.injectGMData(lastGMSummary);
                }

                // Throttled activity persistence (max once per 30s)
                const now = Date.now();
                if (now - lastActivityPersistTime > 30_000) {
                    durableGlobalState.update('activityTrackerState', activityTracker.serialize());
                    if (gmTracker) {
                        durableGlobalState.update('gmTrackerState', gmTracker.serialize());
                        durableFileGlobalState.update('gmDetailedSummary', gmTracker.getDetailedSummary());
                    }
                    lastActivityPersistTime = now;
                }
            } catch (err) {
                log(`Activity processing error: ${err}`);
            }
        }

        // 6d. Update WebView panel if visible (single unified refresh point)
        if (isMonitorPanelVisible()) {
            updateMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, quotaTracker, activityTracker?.getSummary() ?? null, activityTracker?.getArchives(), lastGMSummary, monitorStore.getGMConversations(), getStorageDiagnostics());
        }

        // 7. Update baselines for next poll
        updateBaselines(trajectories);

    } catch (err) {
        log(`Polling error: ${err}`);
        handleLsFailure(`Error: ${err}`);
        lsInfo = null;
        cachedLsInfo = null;
    } finally {
        isPolling = false;
    }
}

function handleLsFailure(message: string): void {
    consecutiveFailures++;
    currentUsage = null;
    allTrajectoryUsages = monitorStore.getAll();
    statusBar.showDisconnected(message);
    if (isMonitorPanelVisible()) {
        updateMonitorPanel(null, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, quotaTracker, activityTracker?.getSummary() ?? null, activityTracker?.getArchives(), lastGMSummary, monitorStore.getGMConversations(), getStorageDiagnostics());
    }

    const backoffMs = Math.min(baseIntervalMs * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_INTERVAL_MS);

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

    // Group models by resetTime — shared resetTime = shared quota pool
    const groups = new Map<string, { labels: string[]; minFraction: number }>();
    for (const c of configs) {
        if (!c.quotaInfo) { continue; }
        const key = c.quotaInfo.resetTime || c.model; // fallback to model if no resetTime
        const g = groups.get(key) || { labels: [], minFraction: 1 };
        g.labels.push(c.label || c.model);
        g.minFraction = Math.min(g.minFraction, c.quotaInfo.remainingFraction ?? 0);
        groups.set(key, g);
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

function getStorageDiagnostics(): StorageDiagnostics {
    let calendarCycleCount = 0;
    if (dailyStore) {
        for (const date of dailyStore.getDatesWithData()) {
            const record = dailyStore.getRecord(date);
            if (record) {
                calendarCycleCount += record.cycles.length;
            }
        }
    }

    return {
        stateFilePath: durableState.getFilePath(),
        stateFileExists: durableState.exists(),
        monitorSnapshotCount: monitorStore?.getAll().length || 0,
        monitorGMConversationCount: Object.keys(monitorStore?.getGMConversations() || {}).length,
        gmConversationCount: lastGMSummary?.conversations.length || 0,
        gmCallCount: lastGMSummary?.totalCalls || 0,
        quotaHistoryCount: quotaTracker?.getHistory().length || 0,
        activityArchiveCount: activityTracker?.getArchives().length || 0,
        calendarDayCount: dailyStore?.totalDays || 0,
        calendarCycleCount,
        pricingOverrideCount: Object.keys(pricingStore?.getCustom() || {}).length,
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

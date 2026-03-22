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
import { initI18n, showLanguagePicker } from './i18n';
import { showMonitorPanel, updateMonitorPanel, isMonitorPanelVisible } from './webview-panel';
import { ActivityTracker, ActivityTrackerState } from './activity-tracker';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, COMPRESSION_PERSIST_POLLS } from './constants';
import { QuotaTracker } from './quota-tracker';
import { GMTracker, GMSummary } from './gm-tracker';

// ─── Extension State ──────────────────────────────────────────────────────────
// Each VS Code window runs its own extension instance, so module-level
// variables are window-isolated — perfect for per-window cascade tracking.

let statusBar: StatusBarManager;
let pollingTimer: ReturnType<typeof setTimeout> | undefined;
let activityPollingTimer: ReturnType<typeof setTimeout> | undefined;
let pollGeneration = 0;
let activityPollGeneration = 0;
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
let isActivityPolling = false;

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

    // Initialize quota tracker
    quotaTracker = new QuotaTracker(context);
    quotaTracker.onQuotaReset = (modelIds: string[]) => {
        if (activityTracker) {
            log(`Quota reset [${modelIds.join(', ')}] — archiving activity snapshot`);
            activityTracker.archiveAndReset(modelIds);
            context.globalState.update('activityTrackerState', activityTracker.serialize());
        }
    };

    // Initialize i18n from persisted state
    initI18n(context);

    // Restore persisted lastKnownModel from workspaceState
    lastKnownModel = context.workspaceState.get<string>('lastKnownModel', '');
    if (lastKnownModel) {
        log(`Restored lastKnownModel from workspaceState: ${lastKnownModel}`);
    }

    statusBar = new StatusBarManager();

    // Initialize activity tracker
    const savedActivity = context.globalState.get<ActivityTrackerState>('activityTrackerState');
    activityTracker = savedActivity ? ActivityTracker.restore(savedActivity) : new ActivityTracker();
    gmTracker = new GMTracker();

    // Restore cached user status from globalState for instant tooltip display
    const savedConfigs = context.globalState.get<import('./models').ModelConfig[]>('cachedModelConfigs');
    const savedPlan = context.globalState.get<string>('cachedPlanName', '');
    const savedTier = context.globalState.get<string>('cachedTierName', '');
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
            showMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, context, quotaTracker, activityTracker?.getSummary() ?? null, undefined, activityTracker?.getArchives(), activityTracker);
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
            showLanguagePicker(context).then(() => {
                // Rebuild statusBar and WebView to reflect new language immediately
                if (currentUsage) {
                    statusBar.update(currentUsage);
                }
                if (isMonitorPanelVisible()) {
                    updateMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo);
                }
                });
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.showActivityPanel', () => {
            showMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, context, quotaTracker, activityTracker?.getSummary() ?? null, 'activity', activityTracker?.getArchives(), activityTracker);
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

    // Start independent activity polling (3s default)
    scheduleActivityPoll();
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
    disposed = true;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = undefined;
    }
    if (activityPollingTimer) {
        clearTimeout(activityPollingTimer);
        activityPollingTimer = undefined;
    }
    abortController.abort();
    // Persist activity data on deactivate
    if (activityTracker && extensionContext) {
        extensionContext.globalState.update('activityTrackerState', activityTracker.serialize());
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
                    extensionContext.globalState.update('cachedModelConfigs', cachedModelConfigs);
                    extensionContext.globalState.update('cachedPlanName', fullStatus.userInfo.planName);
                    extensionContext.globalState.update('cachedTierName', fullStatus.userInfo.userTierName);
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
                        extensionContext.globalState.update('cachedModelConfigs', cachedModelConfigs);
                        extensionContext.globalState.update('cachedPlanName', fullStatus.userInfo.planName);
                        extensionContext.globalState.update('cachedTierName', fullStatus.userInfo.userTierName);
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
            allTrajectoryUsages = [];
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
        else if (firstPollDone) {
            const activeChanges = qualifiedTrajectories.filter(t => {
                const prev = previousStepCounts.get(t.cascadeId);
                return prev !== undefined && t.stepCount !== prev;
            });
            if (activeChanges.length > 0) {
                const trackedChange = activeChanges.find(t => t.cascadeId === trackedCascadeId);
                if (trackedChange) {
                    newCandidateId = trackedChange.cascadeId;
                    const prev = previousStepCounts.get(trackedChange.cascadeId) || 0;
                    const direction = trackedChange.stepCount > prev ? 'increased' : 'decreased (undo/rewind)';
                    selectionReason = `stepCount ${direction}: ${prev} → ${trackedChange.stepCount}`;
                } else {
                    newCandidateId = activeChanges[0].cascadeId;
                    selectionReason = 'stepCount changed in ws';
                }
            }
        }

        // --- Priority 3: New trajectory detection ---
        if (!newCandidateId && firstPollDone) {
            const newlyCreated = qualifiedTrajectories.filter(t => !previousTrajectoryIds.has(t.cascadeId));
            if (newlyCreated.length > 0) {
                newCandidateId = newlyCreated[0].cascadeId;
                selectionReason = 'new trajectory appeared in ws';
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
            allTrajectoryUsages = [];
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(null, [], cachedModelConfigs, cachedUserInfo, quotaTracker);
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
            extensionContext.workspaceState.update('lastKnownModel', lastKnownModel);
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

        // 6c. Update WebView panel if visible (context data only; activity is updated independently)
        if (isMonitorPanelVisible()) {
            updateMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, quotaTracker, activityTracker?.getSummary() ?? null, activityTracker?.getArchives());
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
    allTrajectoryUsages = [];
    statusBar.showDisconnected(message);

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

// ─── Independent Activity Polling ─────────────────────────────────────────────

const ACTIVITY_POLL_INTERVAL_MS = 3000;

async function pollActivity(): Promise<void> {
    if (isActivityPolling || disposed) { return; }
    isActivityPolling = true;
    try {
        const lsInfo = cachedLsInfo;
        if (!lsInfo || !activityTracker) { return; }

        // Fetch trajectories — lightweight RPC
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
        } catch {
            return; // LS temporarily unavailable; global poll will handle reconnect
        }

        const activityChanged = await activityTracker.processTrajectories(
            lsInfo,
            trajectories.map(t => ({ cascadeId: t.cascadeId, stepCount: t.stepCount, status: t.status })),
            abortController.signal,
        );

        // Fetch GM data (piggyback on activity poll)
        let gmChanged = false;
        try {
            const gmSummary = await gmTracker.fetchAll(
                lsInfo,
                trajectories.map(t => ({ cascadeId: t.cascadeId, title: t.summary || t.cascadeId.substring(0, 8), stepCount: t.stepCount, status: t.status })),
                abortController.signal,
            );
            if (gmSummary.totalCalls !== (lastGMSummary?.totalCalls ?? 0)
                || gmSummary.totalStepsCovered !== (lastGMSummary?.totalStepsCovered ?? 0)) {
                lastGMSummary = gmSummary;
                gmChanged = true;
            }
        } catch { /* GM fetch failure is non-critical */ }

        if (activityChanged || gmChanged || !activityTracker.isReady) {
            const summary = activityTracker.getSummary();

            // Refresh WebView immediately when activity changes
            if (isMonitorPanelVisible() && currentUsage) {
                updateMonitorPanel(currentUsage, allTrajectoryUsages, cachedModelConfigs, cachedUserInfo, quotaTracker, summary, activityTracker.getArchives(), lastGMSummary);
            }
        }

        // Throttled persistence (max once per 30s)
        const now = Date.now();
        if (now - lastActivityPersistTime > 30_000) {
            extensionContext.globalState.update('activityTrackerState', activityTracker.serialize());
            lastActivityPersistTime = now;
        }
    } catch (err) {
        log(`Activity poll error: ${err}`);
    } finally {
        isActivityPolling = false;
    }
}

function scheduleActivityPoll(): void {
    if (disposed) { return; }
    const myGeneration = ++activityPollGeneration;
    activityPollingTimer = setTimeout(async () => {
        try {
            await pollActivity();
        } catch { /* ignore */ }
        finally {
            if (activityPollGeneration === myGeneration) {
                scheduleActivityPoll();
            }
        }
    }, ACTIVITY_POLL_INTERVAL_MS);
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
                vscode.window.showWarningMessage(
                    `⚠ ${names} quota low: ${pct}% remaining`,
                    'Open Monitor',
                ).then(choice => {
                    if (choice === 'Open Monitor') {
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

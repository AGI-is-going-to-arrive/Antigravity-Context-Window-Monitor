import * as vscode from 'vscode';
import { discoverLanguageServer, LSInfo } from './discovery';
import {
    getAllTrajectories,
    getContextUsage,
    getContextLimit,
    normalizeUri,
    ContextUsage,
    TrajectorySummary
} from './tracker';
import { StatusBarManager, formatContextLimit } from './statusbar';

// ─── Extension State ──────────────────────────────────────────────────────────
// Each VS Code window runs its own extension instance, so module-level
// variables are window-isolated — perfect for per-window cascade tracking.

let statusBar: StatusBarManager;
let pollingTimer: NodeJS.Timeout | undefined;
let cachedLsInfo: LSInfo | null = null;
let currentUsage: ContextUsage | null = null;
let allTrajectoryUsages: ContextUsage[] = [];
let outputChannel: vscode.OutputChannel;

/** Extension context reference — needed for workspaceState persistence. */
let extensionContext: vscode.ExtensionContext;

/** The cascade ID that THIS window instance is tracking. */
let trackedCascadeId: string | null = null;

/** Previous poll's step counts per cascade — used to detect activity (both increase AND decrease). */
const previousStepCounts = new Map<string, number>();

/** Previous poll's known trajectory IDs — used to detect new conversations. */
const previousTrajectoryIds = new Set<string>();

/** C3: Previous poll's contextUsed per cascade — used to detect context compression. */
const previousContextUsedMap = new Map<string, number>();

/** Whether we've completed at least one poll cycle (to populate baselines). */
let firstPollDone = false;

/** Whether we explicitly cleared the tracked cascade because the user deleted it. */
let isExplicitlyIdle = false;

/** The last known model identifier — used to show correct context limit in idle state. */
let lastKnownModel = '';

// ─── Exponential Backoff State ────────────────────────────────────────────────
/** Base polling interval in milliseconds (from config, default 5s). */
let baseIntervalMs = 5000;
/** Current polling interval (increases on failure, resets on success). */
let currentIntervalMs = 5000;
/** Maximum backoff interval: 60 seconds. */
const MAX_BACKOFF_INTERVAL_MS = 60_000;
/** Number of consecutive LS discovery failures. */
let consecutiveFailures = 0;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('Antigravity Context Monitor');
    log('Extension activating...');

    // M4: Restore persisted lastKnownModel from workspaceState
    lastKnownModel = context.workspaceState.get<string>('lastKnownModel', '');
    if (lastKnownModel) {
        log(`Restored lastKnownModel from workspaceState: ${lastKnownModel}`);
    }

    statusBar = new StatusBarManager();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-context-monitor.showDetails', () => {
            statusBar.showDetailsPanel(currentUsage, allTrajectoryUsages);
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.refresh', () => {
            log('Manual refresh triggered');
            cachedLsInfo = null; // Force re-discovery
            consecutiveFailures = 0; // Reset backoff on manual refresh
            currentIntervalMs = baseIntervalMs;
            restartPolling();
            pollContextUsage();
        }),
        statusBar,
        outputChannel
    );

    // Start polling
    const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const intervalSec = config.get<number>('pollingInterval', 5);
    baseIntervalMs = intervalSec * 1000;
    currentIntervalMs = baseIntervalMs;

    pollContextUsage();
    pollingTimer = setInterval(pollContextUsage, currentIntervalMs);

    // Ensure timer is cleaned up when extension is disposed
    context.subscriptions.push({
        dispose: () => {
            if (pollingTimer) {
                clearInterval(pollingTimer);
                pollingTimer = undefined;
            }
        }
    });

    // Listen for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityContextMonitor.pollingInterval')) {
                const newConfig = vscode.workspace.getConfiguration('antigravityContextMonitor');
                const newIntervalSec = newConfig.get<number>('pollingInterval', 5);
                baseIntervalMs = newIntervalSec * 1000;
                currentIntervalMs = baseIntervalMs;
                consecutiveFailures = 0;
                restartPolling();
            }
        })
    );

    log(`Extension activated. Polling every ${intervalSec}s`);
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = undefined;
    }
    log('Extension deactivated');
}

// ─── Polling Logic ────────────────────────────────────────────────────────────

async function pollContextUsage(): Promise<void> {
    try {
        // 1. Determine workspace URI for this window first so we can find the correct LS
        const workspaceUri = getWorkspaceUri();
        const normalizedWs = workspaceUri ? normalizeUri(workspaceUri) : '(none)';

        // 2. Discover LS (with caching)
        if (!cachedLsInfo) {
            log('Discovering language server...');
            statusBar.showInitializing();
            cachedLsInfo = await discoverLanguageServer(workspaceUri);

            if (!cachedLsInfo) {
                handleLsFailure('LS not found / 未找到 Antigravity 语言服务器');
                return;
            }
            // LS found — reset backoff
            resetBackoff();
            log(`LS found: port=${cachedLsInfo.port}, tls=${cachedLsInfo.useTls}`);
        }

        // 3. Get all trajectories
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await getAllTrajectories(cachedLsInfo);
        } catch (err) {
            // LS might have restarted, invalidate cache and retry
            log(`RPC failed, retrying discovery: ${err}`);
            cachedLsInfo = null;
            cachedLsInfo = await discoverLanguageServer(workspaceUri);
            if (!cachedLsInfo) {
                handleLsFailure('LS connection lost / 语言服务器连接断开');
                return;
            }
            resetBackoff();
            trajectories = await getAllTrajectories(cachedLsInfo);
        }

        // Successful poll — ensure backoff is reset
        resetBackoff();

        if (trajectories.length === 0) {
            // Use last known model's limit (M4 fix: was always defaulting to '1000k')
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

        // Log each trajectory's workspace URIs for debugging
        for (const t of trajectories.slice(0, 5)) {
            const wsUris = t.workspaceUris.map(u => `"${u}" → "${normalizeUri(u)}"`).join(', ');
            log(`  Trajectory "${t.summary?.substring(0, 30)}" status=${t.status} steps=${t.stepCount} workspaces=[${wsUris}]`);
        }

        // 4. Per-window cascade tracking — STRICT Workspace Isolation.
        //
        // A window should ONLY track trajectories belonging to its workspace.
        // If a window has no workspace (no folder opened), it only sees orphans.
        //
        // CRITICAL: We NEVER auto-lock to a stale IDLE trajectory.
        // We only track a trajectory when there is EVIDENCE it's the current one:
        //   Priority 1: RUNNING status in our workspace
        //   Priority 2: stepCount CHANGED (increase OR decrease) in our workspace
        //   Priority 3: New trajectory appeared in our workspace
        //
        // If none of these fire, we show idle — this is correct for new
        // conversations that haven't registered in the LS yet.

        const qualifiedTrajectories = trajectories.filter(t => {
            if (workspaceUri) {
                return t.workspaceUris.some(u => normalizeUri(u) === normalizedWs);
            }
            return t.workspaceUris.length === 0;
        });

        const qualifiedRunning = qualifiedTrajectories.filter(t => t.status === 'CASCADE_RUN_STATUS_RUNNING');
        let newCandidateId: string | null = null;
        let selectionReason = '';

        log(`Trajectories: ${trajectories.length} total, ${qualifiedTrajectories.length} qualified in ws, ${qualifiedRunning.length} running in ws`);

        // --- Priority 1: RUNNING status detection ---
        if (qualifiedRunning.length > 0) {
            // Keep current if still running, otherwise pick the first new one
            const currentStillRunning = qualifiedRunning.find(t => t.cascadeId === trackedCascadeId);
            if (currentStillRunning) {
                newCandidateId = currentStillRunning.cascadeId;
                selectionReason = 'tracked cascade is RUNNING';
            } else {
                newCandidateId = qualifiedRunning[0].cascadeId;
                selectionReason = 'new RUNNING cascade in ws';
            }
        }
        // --- Priority 2: stepCount CHANGE detection (increase OR decrease) ---
        // Detecting decrease is essential for Undo/Rewind: when the user undoes
        // a conversation step, stepCount drops and we must refresh the usage data.
        else if (firstPollDone) {
            const activeChanges = qualifiedTrajectories.filter(t => {
                const prev = previousStepCounts.get(t.cascadeId);
                return prev !== undefined && t.stepCount !== prev; // ← detect ANY change, not just increase
            });
            if (activeChanges.length > 0) {
                // If currently tracked cascade had a change, prefer keeping it
                const trackedChange = activeChanges.find(t => t.cascadeId === trackedCascadeId);
                if (trackedChange) {
                    newCandidateId = trackedChange.cascadeId;
                    const prev = previousStepCounts.get(trackedChange.cascadeId) || 0;
                    const direction = trackedChange.stepCount > prev ? 'increased' : 'decreased (undo/rewind)';
                    selectionReason = `stepCount ${direction}: ${prev} → ${trackedChange.stepCount}`;
                } else {
                    // Pick the most recently modified among those that changed
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
            // Ensure tracked cascade is still in our qualified list
            const currentTracked = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId);
            if (!currentTracked) {
                log(`Tracked cascade ${trackedCascadeId.substring(0, 8)} no longer in qualified list (deleted or moved), clearing`);
                trackedCascadeId = null;
                isExplicitlyIdle = true;
            }
        }

        // --- Find the trajectory to display ---
        let activeTrajectory: TrajectorySummary | null = null;
        selectionReason = '';

        if (trackedCascadeId) {
            activeTrajectory = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId) || null;
            if (activeTrajectory) {
                selectionReason = 'tracked cascade';
            }
        }

        // NO FALLBACK: We intentionally do NOT auto-select a stale IDLE trajectory.
        // This ensures new conversations show 0k until their trajectory registers.

        if (!activeTrajectory) {
            // Determine the context limit to display in idle state.
            // Use the last known model's limit, or fall back to the default.
            const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
            const customLimits = config.get<Record<string, number>>('contextLimits');
            const idleLimit = getContextLimit(lastKnownModel, customLimits);
            const idleLimitStr = formatContextLimit(idleLimit);
            log(`No active trajectory — showing idle (model=${lastKnownModel || 'default'}, limit=${idleLimitStr})`);
            statusBar.showIdle(idleLimitStr);
            currentUsage = null;
            allTrajectoryUsages = [];
            updateBaselines(trajectories);
            return;
        }

        log(`Selected: "${activeTrajectory.summary}" (${activeTrajectory.cascadeId.substring(0, 8)}) reason=${selectionReason} status=${activeTrajectory.status}`);

        // 5. Get context usage for selected trajectory
        const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
        const customLimits = config.get<Record<string, number>>('contextLimits');

        currentUsage = await getContextUsage(cachedLsInfo, activeTrajectory, customLimits);
        statusBar.update(currentUsage);

        // Track the model for idle-state display
        if (currentUsage.model) {
            lastKnownModel = currentUsage.model;
            // M4: Persist to workspaceState so it survives extension restarts
            extensionContext.workspaceState.update('lastKnownModel', lastKnownModel);
        }

        // C3: Cross-poll compression detection
        // If contextUsed dropped significantly compared to the previous poll,
        // it means the model compressed its context window.
        const prevUsed = previousContextUsedMap.get(currentUsage.cascadeId);
        if (prevUsed !== undefined && currentUsage.contextUsed < prevUsed) {
            const drop = prevUsed - currentUsage.contextUsed;
            // Only flag as compression if the drop is meaningful (>1% of context limit)
            if (drop > currentUsage.contextLimit * 0.01) {
                currentUsage.compressionDetected = true;
                currentUsage.previousContextUsed = prevUsed;
                log(`Compression detected for ${currentUsage.cascadeId.substring(0, 8)}: ${prevUsed} → ${currentUsage.contextUsed} (dropped ${drop})`);
            }
        }
        // Store current contextUsed for next poll comparison
        previousContextUsedMap.set(currentUsage.cascadeId, currentUsage.contextUsed);

        const sourceLabel = currentUsage.isEstimated ? 'estimated' : 'precise';
        log(`Context: ${currentUsage.contextUsed} tokens (${sourceLabel}) | ${currentUsage.usagePercent.toFixed(1)}% | modelOut=${currentUsage.totalOutputTokens} | toolOut=${currentUsage.totalToolCallOutputTokens} | delta=${currentUsage.estimatedDeltaSinceCheckpoint} | imageGen=${currentUsage.imageGenStepCount}`);

        // 6. Background: compute usage for other recent trajectories
        const scopeTrajectories = qualifiedTrajectories.length > 0 ? qualifiedTrajectories : trajectories;
        const recentTrajectories = scopeTrajectories.slice(0, 5);
        const usages: ContextUsage[] = [];
        for (const t of recentTrajectories) {
            if (t.cascadeId === activeTrajectory.cascadeId) {
                usages.push(currentUsage);
            } else {
                try {
                    const u = await getContextUsage(cachedLsInfo, t, customLimits);
                    usages.push(u);
                } catch {
                    // Skip failed trajectories
                }
            }
        }
        allTrajectoryUsages = usages;

        // 7. Update baselines for next poll
        updateBaselines(trajectories);

    } catch (err) {
        log(`Polling error: ${err}`);
        handleLsFailure(`Error / 错误: ${err}`);
        cachedLsInfo = null; // Force re-discovery next time
    }
}

/**
 * Handle LS discovery or connection failure with exponential backoff.
 * Increases polling interval progressively: 5s → 10s → 20s → 60s
 * Resets when LS reconnects.
 */
function handleLsFailure(message: string): void {
    consecutiveFailures++;
    statusBar.showDisconnected(message);

    // Calculate backoff: double the interval on each failure, up to MAX
    const backoffMs = Math.min(baseIntervalMs * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_INTERVAL_MS);

    if (backoffMs !== currentIntervalMs) {
        currentIntervalMs = backoffMs;
        restartPolling();
        log(`Backoff: ${consecutiveFailures} consecutive failures, polling every ${currentIntervalMs / 1000}s`);
    }
}

/**
 * Reset backoff to base interval after successful LS connection.
 */
function resetBackoff(): void {
    if (consecutiveFailures > 0) {
        log(`Backoff reset: LS reconnected after ${consecutiveFailures} failures`);
        consecutiveFailures = 0;
        currentIntervalMs = baseIntervalMs;
        restartPolling();
    }
}

/**
 * Update baseline data (stepCounts, trajectory IDs) for next poll comparison.
 */
function updateBaselines(trajectories: TrajectorySummary[]): void {
    previousStepCounts.clear();
    previousTrajectoryIds.clear();
    for (const t of trajectories) {
        previousStepCounts.set(t.cascadeId, t.stepCount);
        previousTrajectoryIds.add(t.cascadeId);
    }
    firstPollDone = true;
}

function restartPolling(): void {
    if (pollingTimer) {
        clearInterval(pollingTimer);
    }
    pollingTimer = setInterval(pollContextUsage, currentIntervalMs);
    log(`Polling restarted: ${currentIntervalMs / 1000}s interval`);
}

function log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}

// ─── Workspace Detection ──────────────────────────────────────────────────────

/**
 * Get the workspace URI for the current VS Code window.
 * This is used to filter trajectories so each window only shows
 * context for conversations that belong to its workspace.
 */
function getWorkspaceUri(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    // Use the first workspace folder's URI (file:// format)
    return folders[0].uri.toString();
}

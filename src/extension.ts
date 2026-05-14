import * as fs from 'fs';
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
import { setShowModelShortId } from './models';
import { StatusBarManager, formatContextLimit } from './statusbar';
import { initI18n, initI18nFromState, showLanguagePicker, tBi } from './i18n';
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
let monitorStore: MonitorStore;
let durableState: DurableState;
let durableGlobalState: StateBucket;
let durableWorkspaceState: StateBucket;
let durableFileGlobalState: StateBucket;
let durableFileWorkspaceState: StateBucket;
let persistedModelDNA: Record<string, PersistedModelDNA> = {};
type DevResetSnapshot = {
    activityState: ActivityTrackerState;
    gmTrackerState: GMTrackerState;
    gmDetailedSummary: GMSummary | null;
    dailyState: DailyStoreState;
};
let devResetSnapshot: DevResetSnapshot | null = null;

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
    const model = usage.model || usage.lastModelUsage?.model || '';
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

function hasGMSummaryChanged(prev: GMSummary | null | undefined, next: GMSummary | null | undefined): boolean {
    if (!!prev !== !!next) { return true; }
    if (!prev || !next) { return false; }
    return prev.totalCalls !== next.totalCalls
        || prev.totalStepsCovered !== next.totalStepsCovered
        || prev.totalCredits !== next.totalCredits
        || prev.totalInputTokens !== next.totalInputTokens
        || prev.totalOutputTokens !== next.totalOutputTokens
        || prev.totalCacheRead !== next.totalCacheRead
        || prev.totalCacheCreation !== next.totalCacheCreation
        || prev.totalThinkingTokens !== next.totalThinkingTokens
        || prev.totalRetryCount !== next.totalRetryCount
        || prev.totalRetryTokens !== next.totalRetryTokens
        || prev.totalRetryCredits !== next.totalRetryCredits
        || prev.conversations.length !== next.conversations.length
        || Object.keys(prev.modelBreakdown).length !== Object.keys(next.modelBreakdown).length;
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

function captureDevResetSnapshot(): void {
    devResetSnapshot = {
        activityState: clonePlain(activityTracker.serialize()),
        gmTrackerState: clonePlain(gmTracker.serialize()),
        gmDetailedSummary: lastGMSummary ? clonePlain(lastGMSummary) : null,
        dailyState: clonePlain(dailyStore.serialize()),
    };
}

function restoreDevResetSnapshot(): boolean {
    if (!devResetSnapshot) { return false; }
    activityTracker = ActivityTracker.restore(clonePlain(devResetSnapshot.activityState));
    gmTracker = GMTracker.restore(clonePlain(devResetSnapshot.gmTrackerState));
    gmTracker.setDetailedSummary(devResetSnapshot.gmDetailedSummary ? clonePlain(devResetSnapshot.gmDetailedSummary) : null);
    lastGMSummary = devResetSnapshot.gmDetailedSummary ? clonePlain(devResetSnapshot.gmDetailedSummary) : null;
    dailyStore.restoreSnapshot(clonePlain(devResetSnapshot.dailyState));
    devResetSnapshot = null;
    persistResetSensitiveState();
    return true;
}

function makePanelPayload(extra: Partial<PanelPayload> = {}): PanelPayload {
    return {
        currentUsage,
        allTrajectoryUsages,
        allTrajectories: lastTrajectories,
        modelConfigs: cachedModelConfigs,
        userInfo: cachedUserInfo,
        workspaceUri: getWorkspaceUri(),
        tracker: quotaTracker,
        activitySummary: activityTracker?.getSummary() ?? null,
        archives: activityTracker?.getArchives(),
        activityTracker,
        gmSummary: lastGMSummary,
        gmFullSummary: gmTracker.getFullSummary(),
        gmConversations: monitorStore.getGMConversations(),
        pricingStore,
        dailyStore,
        storageDiagnostics: getStorageDiagnostics(),
        modelDNA: persistedModelDNA,
        accountSnapshots: getAccountSnapshotArray(),
        pendingArchives: gmTracker.getPendingArchives(),
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

function updateAccountSnapshot(
    userInfo: UserStatusInfo,
    configs: import('./models').ModelConfig[],
): void {
    const email = userInfo.email;
    if (!email) { return; }

    // Group models by their resetTime to form pools, tracking usage
    // Also build a modelId → resetTime mapping for GMTracker cross-reference
    const poolMap = new Map<string, { labels: string[]; modelIds: string[]; hasUsage: boolean; minFraction: number }>();
    for (const c of configs) {
        if (c.quotaInfo?.resetTime) {
            const rt = c.quotaInfo.resetTime;
            if (!poolMap.has(rt)) { poolMap.set(rt, { labels: [], modelIds: [], hasUsage: false, minFraction: 1.0 }); }
            const pool = poolMap.get(rt)!;
            if (!pool.labels.includes(c.label)) {
                pool.labels.push(c.label);
            }
            if (c.model && !pool.modelIds.includes(c.model)) {
                pool.modelIds.push(c.model);
            }
            // remainingFraction < 1.0 means quota has been consumed (crossed 20% threshold)
            const frac = c.quotaInfo.remainingFraction;
            if (frac < 1.0) {
                pool.hasUsage = true;
            }
            if (frac !== undefined && frac < pool.minFraction) {
                pool.minFraction = frac;
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
    for (const [resetTime, pool] of [...poolMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const remainingPct = pool.hasUsage ? Math.round(pool.minFraction * 100) : undefined;
        resetPools.push({ resetTime, modelLabels: pool.labels, hasUsage: pool.hasUsage, remainingPercent: remainingPct });
        allResetTimes.push(resetTime);
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
        if (pool.hasUsage === false) { continue; }

        // Skip if already notified/archived
        const key = `${email}:${pool.resetTime}`;
        if (notifiedAccountResets.has(key)) { continue; }

        // Skip if already archived in persisted state
        if (gmTracker.isPoolArchived(email, pool.modelLabels)) {
            notifiedAccountResets.add(key);
            log(`Account switch baseline: ${email} pool [${pool.modelLabels.slice(0, 3).join(', ')}] already archived — skipped`);
            continue;
        }

        notifiedAccountResets.add(key);

        // ── Baseline GM calls for the expired pool ──
        // No DailyStore snapshot here — midnight archival will use
        // getArchivalSummary() which includes both pending-archive and
        // active calls, giving DailyStore the complete day's picture.
        const baselinedCount = gmTracker.baselineForQuotaReset(email, pool.modelLabels);
        if (baselinedCount > 0) {
            log(`Account switch baseline: ${email} — ${baselinedCount} GM calls baselined for pool [${pool.modelLabels.slice(0, 3).join(', ')}]`);
            lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
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
    quotaTracker.onQuotaReset = (modelIds: string[]) => {
        // ── Baseline current account's GM calls for the reset pool ──
        // No DailyStore snapshot here — midnight archival will use
        // getArchivalSummary() which includes both pending-archive and
        // active calls, giving DailyStore the complete day's picture.
        const baselinedCount = gmTracker.baselineForQuotaReset(undefined, modelIds);
        log(`Quota reset detected: [${modelIds.join(', ')}] — ${baselinedCount} GM calls baselined for new cycle`);

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

    // ── One-time migration: contextLimits 1M → 160K/120K (platform truncation thresholds) ──
    // Old versions used 1M (model native limits) as default contextLimits.
    // GM data confirmed the platform actually truncates at 160K (Claude) / ~120K (Gemini Pro).
    // This migration detects stale 1M values and resets to package.json new defaults.
    {
        const migrationKey = 'contextLimitsMigrationV';
        const migrationVersion = durableGlobalState.get<number>(migrationKey, 0);
        if (migrationVersion < 1) {
            const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
            const inspection = cfg.inspect<Record<string, number>>('contextLimits');
            // Check if user has explicit global/workspace settings with old 1M values
            const hasOldGlobal = inspection?.globalValue && Object.values(inspection.globalValue).some(v => v >= 1_000_000);
            const hasOldWorkspace = inspection?.workspaceValue && Object.values(inspection.workspaceValue).some(v => v >= 1_000_000);
            if (hasOldGlobal) {
                cfg.update('contextLimits', undefined, vscode.ConfigurationTarget.Global);
                log('Migration v1: Reset global contextLimits from 1M to new platform defaults (160K/120K)');
            }
            if (hasOldWorkspace) {
                cfg.update('contextLimits', undefined, vscode.ConfigurationTarget.Workspace);
                log('Migration v1: Reset workspace contextLimits from 1M to new platform defaults (160K/120K)');
            }
            durableGlobalState.update(migrationKey, 1);
            if (hasOldGlobal || hasOldWorkspace) {
                log('Context limits migration complete — old 1M values cleared, new package.json defaults (160K/120K) will take effect');
            }
        }
    }

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
            durableGlobalState.update('gmTrackerState', gmTracker.serialize());
            persistGMSummaryToFile(lastGMSummary);
            log('GM summary repaired from quota history during startup');
        }
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
        vscode.commands.registerCommand('antigravity-context-monitor.devSimulateReset', () => {
            if (!activityTracker) { return; }
            captureDevResetSnapshot();
            log('[Dev] Simulating daily archival...');
            performDailyArchival(true);
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(makePanelPayload());
            }
            log('[Dev] Daily archival simulated — snapshot captured, data archived & reset');
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.devRestoreReset', () => {
            const restored = restoreDevResetSnapshot();
            if (restored && isMonitorPanelVisible()) {
                updateMonitorPanel(makePanelPayload());
            }
            log(restored
                ? '[Dev] Restored simulated quota reset snapshot'
                : '[Dev] No simulated quota reset snapshot to restore');
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.devPersistActivity', () => {
            if (activityTracker) {
                durableGlobalState.update('activityTrackerState', activityTracker.serialize());
                log('[Dev] Activity tracker state persisted to globalState');
            }
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

    // Apply compression warning threshold
    const threshold = config.get<number>('compressionWarningThreshold', 150_000);
    statusBar.setWarningThreshold(threshold);

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
            if (e.affectsConfiguration('antigravityContextMonitor.compressionWarningThreshold')) {
                const newConfig = vscode.workspace.getConfiguration('antigravityContextMonitor');
                const newThreshold = newConfig.get<number>('compressionWarningThreshold', 150_000);
                statusBar.setWarningThreshold(newThreshold);
                log(`Compression warning threshold updated to ${newThreshold}`);
            }
            if (e.affectsConfiguration('antigravityContextMonitor.statusBar')) {
                applyDisplayPrefs();
                if (currentUsage) { statusBar.update(currentUsage); }
                log('Status bar display preferences updated');
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

        // 2. Discover LS (with caching + periodic PID revalidation)
        if (!lsInfo) {
            log('Discovering language server...');
            statusBar.showInitializing();
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal);
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
                    const freshLs = await discoverLanguageServer(workspaceUri, abortController.signal);
                    if (freshLs && freshLs.pid !== lsInfo.pid) {
                        log(`⚠ LS PID changed: ${lsInfo.pid} → ${freshLs.pid} (port: ${lsInfo.port} → ${freshLs.port}). Reconnecting to new LS.`);
                        lsInfo = freshLs;
                        cachedLsInfo = freshLs;
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

        // 3. Get all trajectories
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
        } catch (err) {
            log(`RPC failed, retrying discovery: ${err}`);
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal);
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
                    const freshLs = await discoverLanguageServer(workspaceUri, abortController.signal);
                    if (freshLs && freshLs.pid !== lsInfo.pid) {
                        log(`⚠ Stale LS confirmed: PID ${lsInfo.pid} → ${freshLs.pid}. Reconnecting.`);
                        lsInfo = freshLs;
                        cachedLsInfo = freshLs;
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
            const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
            const customLimits = config.get<Record<string, number>>('contextLimits');
            const idleLimit = getContextLimit(lastKnownModel, customLimits);
            const idleLimitStr = formatContextLimit(idleLimit);
            log(`No active trajectory — showing idle (model=${lastKnownModel || 'default'}, limit=${idleLimitStr})`);
            statusBar.showIdle(idleLimitStr);
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
        const config = vscode.workspace.getConfiguration('antigravityContextMonitor');
        const customLimits = config.get<Record<string, number>>('contextLimits');

        const persistedUsage = monitorStore.getSnapshot(activeTrajectory.cascadeId);
        if (hasSameUsageInputs(currentUsage, activeTrajectory)) {
            currentUsage = rehydrateUsageForDisplay(currentUsage, customLimits);
        } else if (hasSameUsageInputs(persistedUsage, activeTrajectory)) {
            currentUsage = rehydrateUsageForDisplay(persistedUsage, customLimits);
        } else {
            currentUsage = await getContextUsage(lsInfo, activeTrajectory, customLimits, abortController.signal);
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
                return rehydrateUsageForDisplay(cachedUsage, customLimits);
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
                    const prevSummary = lastGMSummary;
                    const gmSummary = await gmTracker.fetchAll(
                        lsInfo,
                        trajectories.map(t => ({ cascadeId: t.cascadeId, title: t.summary || t.cascadeId.substring(0, 8), stepCount: t.stepCount, status: t.status })),
                        abortController.signal,
                    );
                    gmChanged = hasGMSummaryChanged(prevSummary, gmSummary);
                    if (gmChanged || !lastGMSummary) {
                        const detailedSummary = gmTracker.getDetailedSummary() || gmSummary;
                        monitorStore.recordGMConversations(gmTracker.getAllConversationData());
                        persistGMSummaryToFile(detailedSummary);
                        const mergedDNA = mergeModelDNAState(persistedModelDNA, detailedSummary);
                        if (mergedDNA.changed) {
                            persistedModelDNA = mergedDNA.entries;
                            durableGlobalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
                        }
                        lastGMSummary = detailedSummary;
                    }
                } catch { /* GM fetch failure is non-critical */ }

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

        // 6d. Daily archival — archive & reset when local date rolls over
        performDailyArchival();

        // 6e. Update WebView panel if visible (single unified refresh point)
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

    // Group models by resetTime — shared resetTime = shared quota pool
    const groups = new Map<string, { labels: string[]; minFraction: number }>();
    for (const c of configs) {
        if (!c.quotaInfo) { continue; }
        const key = c.quotaInfo.resetTime || c.model; // fallback to model if no resetTime
        const g = groups.get(key) || { labels: [], minFraction: 1 };
        g.labels.push(c.label || c.model);
        g.minFraction = Math.min(g.minFraction, c.quotaInfo.remainingFraction ?? 1);
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
            if (pool.hasUsage === false) { continue; }

            const modelNames = pool.modelLabels.slice(0, 3).join(', ');
            const key = `${snap.email}:${pool.resetTime}`;
            if (notifiedAccountResets.has(key)) { continue; }

            // ── Guard: skip if this pool was already archived (persisted state) ──
            if (gmTracker.isPoolArchived(snap.email, pool.modelLabels)) {
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
            // No DailyStore snapshot here — midnight archival will use
            // getArchivalSummary() which includes both pending-archive and
            // active calls, giving DailyStore the complete day's picture.
            const baselinedCount = gmTracker.baselineForQuotaReset(snap.email, pool.modelLabels);
            // Also archive any active QuotaTracker sessions for this cached account's pool.
            // Without this, sessions stay in 'tracking' forever because processUpdate()
            // never receives API configs for non-active accounts.
            const archivedSessions = quotaTracker.archiveExpiredSessions(snap.email, pool.modelLabels);
            if (baselinedCount > 0 || archivedSessions > 0) {
                log(`[ResetCheck]   ${baselinedCount} GM calls baselined, ${archivedSessions} quota sessions archived`);
                lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                durableGlobalState.update('gmTrackerState', gmTracker.serialize());
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
        hasDevResetSnapshot: !!devResetSnapshot,
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

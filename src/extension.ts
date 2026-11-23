import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LSInfo } from './discovery';
import {
    discoverPreferredBackend,
    doesConnectionMatchActiveHint,
    getActiveBackendHint,
    isSameBackendConnection,
} from './backend-connection';
import {
    getAllTrajectories,
    getContextUsage,
    refreshWorkflowImageUsage,
    resetImageWorkflowCache,
    getContextLimit,
    normalizeModelDisplayName,
    normalizeUri,
    fetchFullUserStatus,
    fetchOrchestratorSettings,
    fetchUserQuotaSummary,
    fetchTrajectoryGeneratorMetadata,
    fetchTrajectorySteps,
    parseStrictResetTimestamp,
    updateModelDisplayNames,
    ContextUsage,
    TrajectorySummary,
    UserStatusInfo,
} from './tracker';
import { getQuotaPoolKey, setShowModelShortId, overrideContextLimits, resolveModelId, registerResponseModelAlias, setAvailableImageModelIds, type ModelConfig, type FullUserStatus, type OrchestratorSettings, type UserQuotaSummary, updateModelSpec, getModelSpecs } from './models';
import { rpcCall } from './rpc-client';
import { StatusBarManager, formatContextLimit, setTooltipDiagLogger } from './statusbar';
import { getLanguage, initI18n, initI18nFromState, setLanguageToState, showLanguagePicker, tBi } from './i18n';
import { parseContextBreakdown, type ContextBreakdownSnapshot } from './context-breakdown';
import { analyzeTurnDiagnostics, type TurnDiagnosticsSummary } from './turn-diagnostics';
import {
    QuotaRunwayTracker,
    StaleCacheGuard,
    isCustomModel,
    type QuotaRunwayEstimate,
    type SerializedQuotaRunwayState,
} from './quota-runway';
import {
    buildConversationOptions,
    resolveTargetConversation,
    type ConversationOption,
} from './conversation-selector';
import type { MonitorStaleState } from './webview-overview-tab';
import { aiCreditTotal, currentAICredits } from './account-credits';
import { groupModelQuotas } from './model-quota';
import { MONITOR_COMMAND } from './monitor-overview';
import { showMonitorPanel, refreshMonitorPanelLanguage, updateMonitorPanel, syncMonitorPanelSettings, isMonitorPanelVisible, setPanelDurableState, PanelPayload, LARGE_STATE_FILE_WARN_BYTES } from './webview-panel';
import { ActivityTracker, ActivityTrackerState } from './activity-tracker';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, MAX_DISCOVERY_BACKOFF_MS, COMPRESSION_PERSIST_POLLS } from './constants';
import { QuotaTracker } from './quota-tracker';
import { GMTracker, GMSummary, GMTrackerState, slimSummaryForPersistence } from './gm-tracker';
import { PricingStore, calculateLedgerModelCosts, costFromTokens, findPricingForDate, normalizeOrchestratorPricingMode, selectPricingModel, type OrchestratorPricingMode } from './pricing-store';
import { DailyStore, type DailyStoreState } from './daily-store';
import { MonitorStore } from './monitor-store';
import {
    performDailyArchival as performDailyArchivalCore,
    type DailyArchivalContext,
} from './daily-archival';
import {
    DEFAULT_APP_SETTINGS,
    DurableState,
    StateBucket,
    normalizeAppSettings,
    type AppSettings,
    type LastUpdateCheckRecord,
} from './durable-state';
import { mergeModelDNAState, PersistedModelDNA, restoreModelDNAState, serializeModelDNAState, type ModelDNAStoreState } from './model-dna-store';
import type { StorageDiagnostics, UpdateStatusView } from './webview-settings-tab';
import type { AccountSnapshot } from './activity-panel';
import { isBillingDay, isBillingDaySetting } from './billing-day';
import { expandModelIdsToPool } from './pool-utils';
import { DailyLedger, toLocalDateKey, type DailyLedgerState } from './daily-ledger';
import {
    CliUsageScanner,
    type CliDailyUsageRecord,
    type SubscriptionPlanPresetId,
} from './cli-usage-scanner';
import { checkForUpdates } from './app/plugin-updater';
import type { UpdateCheckResult } from './app/sidecar-types';
import { parseTooltipDensity } from './tooltip-budget';

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
let cachedOrchestratorSettings: OrchestratorSettings | null = null;
let cachedQuotaSummary: UserQuotaSummary | null = null;
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

// ─── v1.17.5 Telemetry, Runway, Stale Guard & Conversation Lock State ─────────
let lockToMainAgent = false;
let pinnedConversationId: string | null = null;
let lockedMainCascadeId: string | null = null;
let quotaRunwayTracker = new QuotaRunwayTracker();
let lastRunwayPersistMs = 0;
const userStatusStaleGuard = new StaleCacheGuard<FullUserStatus>();
const trajectoriesStaleGuard = new StaleCacheGuard<TrajectorySummary[]>();
let lastContextBreakdown: ContextBreakdownSnapshot | null = null;
let lastContextBreakdownKey = '';
let lastTurnDiagnostics: TurnDiagnosticsSummary | null = null;
const maxObservedStepCounts = new Map<string, number>();
const previousBreakdownUsedTokens = new Map<string, number>();

// ─── v1.17.6 Shared App Settings, CLI Scanner, Updates & Bidirectional Hot Sync ─
export const OPEN_VSX_EXTENSION_URL = 'https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor';
const CLI_SCAN_TTL_MS = 60_000;

let sharedAppSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, showNativeHudBar: false };
let sharedSubscriptionPlan: SubscriptionPlanPresetId = 'none';
let lastSyncedDiskAppSettings: AppSettings | null = null;
let hasHydratedSharedSettings = false;
let pendingConfigSyncCount = 0;
const cliUsageScanner = new CliUsageScanner();
let cachedCliDays: CliDailyUsageRecord[] = [];
let lastCliScanAtMs = 0;
let lastUpdateStatusView: UpdateStatusView | null = null;
let autoUpdateCheckInFlight = false;

function clampNum(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function inferIdeSubscriptionPlan(
    rawPlan: unknown,
    monthlyFee: number | null,
): SubscriptionPlanPresetId {
    if (rawPlan === 'none' || rawPlan === 'google-ai-pro' || rawPlan === 'google-ai-ultra' || rawPlan === 'custom') {
        return rawPlan;
    }
    if (monthlyFee !== null && monthlyFee > 0) {
        if (Math.abs(monthlyFee - 19.99) < 0.01) { return 'google-ai-pro'; }
        if (Math.abs(monthlyFee - 249.99) < 0.01) { return 'google-ai-ultra'; }
        return 'custom';
    }
    return 'none';
}

function getIdeExtensionVersion(): string {
    const raw = (extensionContext?.extension?.packageJSON as { version?: unknown } | undefined)?.version;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : '1.17.6';
}

const VSCODE_TO_APP_SETTING_MAP: ReadonlyArray<{
    vscodeKey: string;
    appKey: keyof AppSettings;
}> = [
    { vscodeKey: 'pollingInterval', appKey: 'pollingInterval' },
    { vscodeKey: 'quotaNotificationThreshold', appKey: 'quotaNotificationThreshold' },
    { vscodeKey: 'statusBar.showContext', appKey: 'showContext' },
    { vscodeKey: 'statusBar.showQuota', appKey: 'showQuota' },
    { vscodeKey: 'statusBar.showResetCountdown', appKey: 'showResetCountdown' },
    { vscodeKey: 'statusBar.showAiCredits', appKey: 'showAiCredits' },
    { vscodeKey: 'statusBar.showSpeed', appKey: 'showSpeed' },
    { vscodeKey: 'statusBar.showCacheHit', appKey: 'showCacheHit' },
    { vscodeKey: 'statusBar.showSessionCost', appKey: 'showSessionCost' },
    { vscodeKey: 'statusBar.tooltipDensity', appKey: 'tooltipDensity' },
    { vscodeKey: 'showModelInternalId', appKey: 'showModelInternalId' },
    { vscodeKey: 'activity.maxRecentSteps', appKey: 'activityMaxRecentSteps' },
    { vscodeKey: 'activity.maxArchives', appKey: 'activityMaxArchives' },
    { vscodeKey: 'orchestratorPricingMode', appKey: 'orchestratorPricingMode' },
    { vscodeKey: 'displayCurrency', appKey: 'displayCurrency' },
    { vscodeKey: 'customFxRate', appKey: 'customFxRate' },
    { vscodeKey: 'subscriptionMonthlyFee', appKey: 'subscriptionMonthlyFee' },
    { vscodeKey: 'subscriptionCurrency', appKey: 'subscriptionCurrency' },
    { vscodeKey: 'calendarRetentionDays', appKey: 'calendarRetentionDays' },
    { vscodeKey: 'autoCheckUpdates', appKey: 'autoCheckUpdates' },
    { vscodeKey: 'showNativeHudBar', appKey: 'showNativeHudBar' },
];

function mirrorVscodeKeysFromAppSettings(
    prev: AppSettings | null,
    next: AppSettings,
    nextPlan: SubscriptionPlanPresetId,
    prevPlan: SubscriptionPlanPresetId,
    initialDiskKeys?: ReadonlySet<string>,
): void {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    if (typeof cfg.update !== 'function') { return; }

    const updates: Array<[string, unknown]> = [];
    for (const { vscodeKey, appKey } of VSCODE_TO_APP_SETTING_MAP) {
        const shouldMirror = prev
            ? prev[appKey] !== next[appKey]
            : Boolean(initialDiskKeys && initialDiskKeys.has(appKey));
        if (!shouldMirror) { continue; }
        const currentVal = cfg.get(vscodeKey);
        if (currentVal !== next[appKey]) {
            updates.push([vscodeKey, next[appKey]]);
        }
    }
    const shouldMirrorPlan = prev
        ? prevPlan !== nextPlan
        : Boolean(initialDiskKeys && initialDiskKeys.has('subscriptionPlan'));
    if (shouldMirrorPlan && cfg.get('subscriptionPlan') !== nextPlan) {
        updates.push(['subscriptionPlan', nextPlan]);
    }
    if (updates.length === 0) { return; }

    pendingConfigSyncCount++;
    void Promise.allSettled(
        updates.map(([k, v]) => Promise.resolve(cfg.update(k, v, vscode.ConfigurationTarget?.Global))),
    ).finally(() => {
        pendingConfigSyncCount = Math.max(0, pendingConfigSyncCount - 1);
    });
}

function hydrateSharedAppSettingsFromDisk(initialLoad: boolean): {
    changed: boolean;
    prevSettings: AppSettings | null;
} {
    if (!durableState || !durableFileGlobalState) {
        return { changed: false, prevSettings: lastSyncedDiskAppSettings };
    }
    const prevSettings = lastSyncedDiskAppSettings ? { ...lastSyncedDiskAppSettings } : null;
    const prevPlan = sharedSubscriptionPlan;
    const rawDisk = durableFileGlobalState.get<Record<string, unknown> | null>('appSettings', null);
    const hasRawDiskObj = Boolean(rawDisk && typeof rawDisk === 'object' && !Array.isArray(rawDisk));
    const diskNormalized = durableState.getAppSettings();
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');

    // Reconcile orchestratorPricingMode between appSettings and PricingStore
    const explicitDiskOrch = hasRawDiskObj ? rawDisk!.orchestratorPricingMode : undefined;
    const resolvedOrchMode: OrchestratorPricingMode = (explicitDiskOrch === 'mapped' || explicitDiskOrch === 'strict')
        ? explicitDiskOrch
        : (pricingStore ? pricingStore.getOrchestratorPricingMode() : normalizeOrchestratorPricingMode(cfg.get('orchestratorPricingMode', 'mapped')));
    if (pricingStore && pricingStore.getOrchestratorPricingMode() !== resolvedOrchMode) {
        pricingStore.setOrchestratorPricingModeSync(resolvedOrchMode);
    }

    // Reconcile lockToMainAgent
    const persistedLock = durableFileGlobalState.get<boolean | undefined>('lockToMainAgent', undefined);
    const resolvedLock = typeof persistedLock === 'boolean' ? persistedLock : diskNormalized.lockToMainAgent;
    lockToMainAgent = resolvedLock;

    // Respect explicit disk showNativeHudBar (including hot-reloads); otherwise preserve IDE's default false / prior value
    const explicitDiskHud = hasRawDiskObj && typeof rawDisk!.showNativeHudBar === 'boolean'
        ? rawDisk!.showNativeHudBar
        : undefined;
    const resolvedNativeHud = explicitDiskHud !== undefined
        ? explicitDiskHud
        : (prevSettings ? prevSettings.showNativeHudBar : cfg.get<boolean>('showNativeHudBar', false));

    const nextSettings: AppSettings = {
        ...diskNormalized,
        lockToMainAgent: resolvedLock,
        orchestratorPricingMode: resolvedOrchMode,
        showNativeHudBar: resolvedNativeHud,
    };

    const persistedPlan = durableFileGlobalState.get<string>('subscriptionPlan', '');
    const nextPlan = inferIdeSubscriptionPlan(
        persistedPlan || (initialLoad ? cfg.get<string>('subscriptionPlan', 'none') : ''),
        nextSettings.subscriptionMonthlyFee,
    );

    // On initial load when DurableState has no appSettings yet, seed from VS Code config
    if (initialLoad && !hasRawDiskObj) {
        const seeded = normalizeAppSettings({
            pollingInterval: cfg.get<number>('pollingInterval', 5),
            quotaNotificationThreshold: cfg.get<number>('quotaNotificationThreshold', 20),
            showContext: cfg.get<boolean>('statusBar.showContext', true),
            showQuota: cfg.get<boolean>('statusBar.showQuota', true),
            showResetCountdown: cfg.get<boolean>('statusBar.showResetCountdown', true),
            showAiCredits: cfg.get<boolean>('statusBar.showAiCredits', true),
            showSpeed: cfg.get<boolean>('statusBar.showSpeed', false),
            showCacheHit: cfg.get<boolean>('statusBar.showCacheHit', false),
            showSessionCost: cfg.get<boolean>('statusBar.showSessionCost', false),
            tooltipDensity: parseTooltipDensity(cfg.get('statusBar.tooltipDensity', 'auto')),
            showModelInternalId: cfg.get<boolean>('showModelInternalId', false),
            activityMaxRecentSteps: cfg.get<number>('activity.maxRecentSteps', 100),
            activityMaxArchives: cfg.get<number>('activity.maxArchives', 20),
            orchestratorPricingMode: cfg.get<string>('orchestratorPricingMode', resolvedOrchMode),
            displayCurrency: cfg.get<string>('displayCurrency', 'USD'),
            customFxRate: cfg.get<number | null>('customFxRate', null),
            subscriptionMonthlyFee: cfg.get<number | null>('subscriptionMonthlyFee', null),
            subscriptionCurrency: cfg.get<string>('subscriptionCurrency', 'USD'),
            calendarRetentionDays: cfg.get<number>('calendarRetentionDays', 400),
            autoCheckUpdates: cfg.get<boolean>('autoCheckUpdates', true),
            showNativeHudBar: cfg.get<boolean>('showNativeHudBar', false),
            lockToMainAgent: resolvedLock,
        });
        sharedAppSettings = seeded;
        sharedSubscriptionPlan = inferIdeSubscriptionPlan(cfg.get<string>('subscriptionPlan', 'none'), seeded.subscriptionMonthlyFee);
        lastSyncedDiskAppSettings = { ...seeded };
        hasHydratedSharedSettings = true;
        return { changed: false, prevSettings };
    }

    const changed = !prevSettings || JSON.stringify(prevSettings) !== JSON.stringify(nextSettings) || prevPlan !== nextPlan;
    sharedAppSettings = nextSettings;
    sharedSubscriptionPlan = nextPlan;
    lastSyncedDiskAppSettings = { ...nextSettings };
    hasHydratedSharedSettings = true;

    // Hydrate update status view from persisted lastUpdateCheck
    if (nextSettings.lastUpdateCheck) {
        const luc = nextSettings.lastUpdateCheck;
        if (!lastUpdateStatusView || (luc.checkedAt && (!lastUpdateStatusView.checkedAt || luc.checkedAt > lastUpdateStatusView.checkedAt))) {
            lastUpdateStatusView = {
                currentVersion: getIdeExtensionVersion(),
                latestVersion: luc.latestVersion ?? null,
                updateAvailable: Boolean(luc.hasUpdate),
                hasUpdate: Boolean(luc.hasUpdate),
                status: luc.error ? 'error' : (luc.hasUpdate ? 'update_available' : 'up_to_date'),
                checkedAt: luc.checkedAt,
                releaseUrl: luc.releaseUrl ?? null,
                releaseNotesSummary: luc.releaseNotesSummary ?? null,
                error: luc.error ?? null,
            };
        }
    }

    if (initialLoad && hasRawDiskObj) {
        const presentKeys = new Set<string>(Object.keys(rawDisk!));
        if (explicitDiskOrch === 'mapped' || explicitDiskOrch === 'strict' || pricingStore) {
            presentKeys.add('orchestratorPricingMode');
        }
        if (persistedPlan) {
            presentKeys.add('subscriptionPlan');
        }
        mirrorVscodeKeysFromAppSettings(null, nextSettings, nextPlan, prevPlan, presentKeys);
    } else if (!initialLoad && changed) {
        mirrorVscodeKeysFromAppSettings(prevSettings, nextSettings, nextPlan, prevPlan);
    }

    return { changed, prevSettings };
}

/**
 * Check whether the shared DurableState file was modified externally (e.g. by
 * Antigravity App Sidecar or another IDE window) and re-hydrate all shared
 * state in-place without restarting the extension.
 */
export function syncFromDurableStateIfChanged(refreshUi = true): boolean {
    if (!durableState || !durableFileGlobalState) { return false; }
    const reloaded = durableState.reloadIfChanged();
    if (!reloaded) { return false; }

    const prevLang = getLanguage();
    initI18nFromState(durableFileGlobalState);
    const nextLang = getLanguage();
    const langChanged = prevLang !== nextLang;
    if (langChanged && extensionContext?.globalState) {
        void extensionContext.globalState.update('displayLanguage', nextLang);
    }

    if (pricingStore) {
        pricingStore.init(durableGlobalState);
    }

    const { prevSettings } = hydrateSharedAppSettingsFromDisk(false);

    if (dailyStore) {
        dailyStore.init(durableGlobalState, { maxDays: sharedAppSettings.calendarRetentionDays });
        dailyStore.setMaxDays(sharedAppSettings.calendarRetentionDays);
    }

    restoreAccountSnapshots();
    restoreBillingDays();

    // Re-hydrate DailyLedger if disk has newer date or additional records
    const diskLedger = durableFileGlobalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
    if (diskLedger && dailyLedger) {
        if (diskLedger.dateKey === dailyLedger.dateKey) {
            const restored = DailyLedger.restore(diskLedger);
            restored.setSurface('ide');
            if (restored.getTodayActive().length >= dailyLedger.getTodayActive().length
                && restored.getSettledEntries().length >= dailyLedger.getSettledEntries().length) {
                dailyLedger = restored;
            }
        } else if (diskLedger.dateKey && diskLedger.dateKey > dailyLedger.dateKey) {
            dailyLedger = DailyLedger.restore(diskLedger);
            dailyLedger.setSurface('ide');
        }
    }

    // Apply live runtime side effects
    setShowModelShortId(sharedAppSettings.showModelInternalId);
    if (prevSettings && prevSettings.pollingInterval !== sharedAppSettings.pollingInterval) {
        baseIntervalMs = Math.max(1, sharedAppSettings.pollingInterval) * 1000;
        currentIntervalMs = baseIntervalMs;
        if (!disposed) { restartPolling(); }
    }

    if (refreshUi) {
        if (typeof statusBar !== 'undefined') {
            applyDisplayPrefs();
            syncStatusBarTelemetry(true);
        }
        if (isMonitorPanelVisible()) {
            if (langChanged) {
                refreshMonitorPanelLanguage();
            } else {
                updateMonitorPanel(makePanelPayload());
                syncMonitorPanelSettings();
            }
        }
    }
    return true;
}

/** Alias exported for webview-panel.ts & external callers. */
export const syncDurableStateFromDisk = syncFromDurableStateIfChanged;

export function isSharedAppSettingsHydrated(): boolean {
    return Boolean(durableState && hasHydratedSharedSettings);
}

export function getSharedAppSettings(): AppSettings & { subscriptionPlan: SubscriptionPlanPresetId } {
    return { ...sharedAppSettings, subscriptionPlan: sharedSubscriptionPlan };
}

export async function flushDurableState(): Promise<void> {
    if (durableState) {
        await durableState.flush();
    }
}

export async function setSharedOrchestratorPricingMode(mode: OrchestratorPricingMode): Promise<void> {
    const normalized = normalizeOrchestratorPricingMode(mode);
    sharedAppSettings.orchestratorPricingMode = normalized;
    const pStore = pricingStore ? pricingStore.setOrchestratorPricingMode(normalized) : undefined;
    if (durableState) {
        const pSettings = durableState.updateAppSettings({ orchestratorPricingMode: normalized });
        await durableState.flush();
        sharedAppSettings = await pSettings;
        lastSyncedDiskAppSettings = { ...sharedAppSettings };
    }
    if (pStore) { await pStore; }
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    if (typeof cfg.update === 'function') {
        pendingConfigSyncCount++;
        try {
            await cfg.update('orchestratorPricingMode', normalized, vscode.ConfigurationTarget?.Global);
        } finally {
            pendingConfigSyncCount = Math.max(0, pendingConfigSyncCount - 1);
        }
    }
    syncStatusBarTelemetry(true);
}

export async function updateSharedAppSetting(
    key: string,
    value: unknown,
): Promise<{ ok: boolean; normalizedKey: string; error?: string }> {
    const cleanKey = key.trim();
    const patch: Partial<AppSettings> = {};
    let normalizedKey = cleanKey;
    let vscodeMirrorKey: string | undefined;
    let vscodeMirrorValue: unknown;
    let mirrorPlan: SubscriptionPlanPresetId | undefined;

    switch (cleanKey) {
        case 'appComposerRingEnabled':
            patch.appComposerRingEnabled = Boolean(value);
            break;
        case 'appTopBarEnabled':
            patch.appTopBarEnabled = Boolean(value);
            break;
        case 'showNativeHudBar':
            patch.showNativeHudBar = Boolean(value);
            vscodeMirrorKey = 'showNativeHudBar';
            vscodeMirrorValue = patch.showNativeHudBar;
            break;
        case 'orchestratorPricingMode': {
            if (value !== 'mapped' && value !== 'strict') {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid orchestratorPricingMode' };
            }
            await setSharedOrchestratorPricingMode(value);
            return { ok: true, normalizedKey: 'orchestratorPricingMode' };
        }
        case 'displayCurrency': {
            if (typeof value !== 'string' || !value.trim()) {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid displayCurrency' };
            }
            const norm = normalizeAppSettings({ displayCurrency: value });
            patch.displayCurrency = norm.displayCurrency;
            vscodeMirrorKey = 'displayCurrency';
            vscodeMirrorValue = norm.displayCurrency;
            break;
        }
        case 'customFxRate': {
            if (value === null || value === '' || value === undefined) {
                patch.customFxRate = null;
            } else {
                const n = Number(value);
                if (!Number.isFinite(n) || n <= 0 || n > 100_000) {
                    return { ok: false, normalizedKey: cleanKey, error: 'Invalid customFxRate' };
                }
                patch.customFxRate = n;
            }
            vscodeMirrorKey = 'customFxRate';
            vscodeMirrorValue = patch.customFxRate;
            break;
        }
        case 'subscriptionPlan': {
            if (value !== 'none' && value !== 'google-ai-pro' && value !== 'google-ai-ultra' && value !== 'custom') {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid subscriptionPlan' };
            }
            sharedSubscriptionPlan = value;
            mirrorPlan = value;
            if (value === 'none') {
                patch.subscriptionMonthlyFee = null;
            } else if (value === 'google-ai-pro') {
                patch.subscriptionMonthlyFee = 19.99;
                patch.subscriptionCurrency = 'USD';
            } else if (value === 'google-ai-ultra') {
                patch.subscriptionMonthlyFee = 249.99;
                patch.subscriptionCurrency = 'USD';
            }
            break;
        }
        case 'subscriptionMonthlyFee': {
            if (value === null || value === '' || value === undefined) {
                patch.subscriptionMonthlyFee = null;
            } else {
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
                    return { ok: false, normalizedKey: cleanKey, error: 'Invalid subscriptionMonthlyFee' };
                }
                patch.subscriptionMonthlyFee = n > 0 ? n : null;
                if (patch.subscriptionMonthlyFee !== null && sharedSubscriptionPlan === 'none') {
                    sharedSubscriptionPlan = 'custom';
                    mirrorPlan = 'custom';
                }
            }
            vscodeMirrorKey = 'subscriptionMonthlyFee';
            vscodeMirrorValue = patch.subscriptionMonthlyFee;
            break;
        }
        case 'subscriptionCurrency': {
            if (typeof value !== 'string' || !value.trim()) {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid subscriptionCurrency' };
            }
            const norm = normalizeAppSettings({ subscriptionCurrency: value });
            patch.subscriptionCurrency = norm.subscriptionCurrency;
            vscodeMirrorKey = 'subscriptionCurrency';
            vscodeMirrorValue = norm.subscriptionCurrency;
            break;
        }
        case 'calendarRetentionDays': {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid calendarRetentionDays' };
            }
            const clamped = clampNum(Math.round(n), 30, 3650);
            patch.calendarRetentionDays = clamped;
            dailyStore?.setMaxDays(clamped);
            vscodeMirrorKey = 'calendarRetentionDays';
            vscodeMirrorValue = clamped;
            break;
        }
        case 'autoCheckUpdates':
            patch.autoCheckUpdates = Boolean(value);
            vscodeMirrorKey = 'autoCheckUpdates';
            vscodeMirrorValue = patch.autoCheckUpdates;
            break;
        case 'activityMaxRecentSteps':
        case 'maxRecentSteps':
        case 'activity.maxRecentSteps': {
            const n = Number(value);
            if (!Number.isFinite(n)) { return { ok: false, normalizedKey: cleanKey, error: 'Invalid activityMaxRecentSteps' }; }
            const clamped = clampNum(Math.round(n), 10, 500);
            patch.activityMaxRecentSteps = clamped;
            patch.maxRecentSteps = clamped;
            normalizedKey = 'activityMaxRecentSteps';
            vscodeMirrorKey = 'activity.maxRecentSteps';
            vscodeMirrorValue = clamped;
            break;
        }
        case 'activityMaxArchives':
        case 'maxArchives':
        case 'activity.maxArchives': {
            const n = Number(value);
            if (!Number.isFinite(n)) { return { ok: false, normalizedKey: cleanKey, error: 'Invalid activityMaxArchives' }; }
            const clamped = clampNum(Math.round(n), 1, 100);
            patch.activityMaxArchives = clamped;
            patch.maxArchives = clamped;
            normalizedKey = 'activityMaxArchives';
            vscodeMirrorKey = 'activity.maxArchives';
            vscodeMirrorValue = clamped;
            break;
        }
        case 'quotaNotificationThreshold': {
            const n = Number(value);
            if (!Number.isFinite(n)) { return { ok: false, normalizedKey: cleanKey, error: 'Invalid quotaNotificationThreshold' }; }
            const clamped = clampNum(Math.round(n), 0, 99);
            patch.quotaNotificationThreshold = clamped;
            vscodeMirrorKey = 'quotaNotificationThreshold';
            vscodeMirrorValue = clamped;
            break;
        }
        case 'pollingInterval': {
            const n = Number(value);
            if (!Number.isFinite(n)) { return { ok: false, normalizedKey: cleanKey, error: 'Invalid pollingInterval' }; }
            const clamped = clampNum(Math.round(n), 1, 60);
            patch.pollingInterval = clamped;
            baseIntervalMs = clamped * 1000;
            currentIntervalMs = baseIntervalMs;
            if (!disposed) { restartPolling(); }
            vscodeMirrorKey = 'pollingInterval';
            vscodeMirrorValue = clamped;
            break;
        }
        case 'showModelInternalId':
            patch.showModelInternalId = Boolean(value);
            setShowModelShortId(patch.showModelInternalId);
            vscodeMirrorKey = 'showModelInternalId';
            vscodeMirrorValue = patch.showModelInternalId;
            break;
        case 'lockToMainAgent':
            setLockToMainAgent(Boolean(value));
            return { ok: true, normalizedKey: 'lockToMainAgent' };
        case 'statusBar.tooltipDensity':
        case 'tooltipDensity':
            patch.tooltipDensity = parseTooltipDensity(value);
            normalizedKey = 'statusBar.tooltipDensity';
            vscodeMirrorKey = 'statusBar.tooltipDensity';
            vscodeMirrorValue = patch.tooltipDensity;
            break;
        case 'statusBar.showContext':
        case 'showContext':
            patch.showContext = Boolean(value);
            normalizedKey = 'statusBar.showContext';
            vscodeMirrorKey = 'statusBar.showContext';
            vscodeMirrorValue = patch.showContext;
            break;
        case 'statusBar.showQuota':
        case 'showQuota':
            patch.showQuota = Boolean(value);
            normalizedKey = 'statusBar.showQuota';
            vscodeMirrorKey = 'statusBar.showQuota';
            vscodeMirrorValue = patch.showQuota;
            break;
        case 'statusBar.showResetCountdown':
        case 'showResetCountdown':
            patch.showResetCountdown = Boolean(value);
            normalizedKey = 'statusBar.showResetCountdown';
            vscodeMirrorKey = 'statusBar.showResetCountdown';
            vscodeMirrorValue = patch.showResetCountdown;
            break;
        case 'statusBar.showAiCredits':
        case 'showAiCredits':
            patch.showAiCredits = Boolean(value);
            normalizedKey = 'statusBar.showAiCredits';
            vscodeMirrorKey = 'statusBar.showAiCredits';
            vscodeMirrorValue = patch.showAiCredits;
            break;
        case 'statusBar.showSpeed':
        case 'showSpeed':
            patch.showSpeed = Boolean(value);
            normalizedKey = 'statusBar.showSpeed';
            vscodeMirrorKey = 'statusBar.showSpeed';
            vscodeMirrorValue = patch.showSpeed;
            break;
        case 'statusBar.showCacheHit':
        case 'showCacheHit':
            patch.showCacheHit = Boolean(value);
            normalizedKey = 'statusBar.showCacheHit';
            vscodeMirrorKey = 'statusBar.showCacheHit';
            vscodeMirrorValue = patch.showCacheHit;
            break;
        case 'statusBar.showSessionCost':
        case 'showSessionCost':
            patch.showSessionCost = Boolean(value);
            normalizedKey = 'statusBar.showSessionCost';
            vscodeMirrorKey = 'statusBar.showSessionCost';
            vscodeMirrorValue = patch.showSessionCost;
            break;
        default:
            return { ok: false, normalizedKey: cleanKey, error: `Unknown setting key: ${cleanKey}` };
    }

    sharedAppSettings = { ...sharedAppSettings, ...patch };
    if (durableState) {
        const pSettings = durableState.updateAppSettings(patch);
        const pPlan = durableFileGlobalState
            ? durableFileGlobalState.update('subscriptionPlan', sharedSubscriptionPlan)
            : undefined;
        await durableState.flush();
        sharedAppSettings = await pSettings;
        if (pPlan) { await pPlan; }
        lastSyncedDiskAppSettings = { ...sharedAppSettings };
    }

    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    if (typeof cfg.update === 'function') {
        const cfgWrites: Array<[string, unknown]> = [];
        if (vscodeMirrorKey) {
            cfgWrites.push([vscodeMirrorKey, vscodeMirrorValue]);
        }
        if (mirrorPlan !== undefined) {
            cfgWrites.push(['subscriptionPlan', mirrorPlan]);
            if (patch.subscriptionMonthlyFee !== undefined) {
                cfgWrites.push(['subscriptionMonthlyFee', patch.subscriptionMonthlyFee]);
            }
            if (patch.subscriptionCurrency !== undefined) {
                cfgWrites.push(['subscriptionCurrency', patch.subscriptionCurrency]);
            }
        }
        if (cfgWrites.length > 0) {
            pendingConfigSyncCount++;
            try {
                await Promise.allSettled(
                    cfgWrites.map(([k, v]) => Promise.resolve(cfg.update(k, v, vscode.ConfigurationTarget?.Global))),
                );
            } finally {
                pendingConfigSyncCount = Math.max(0, pendingConfigSyncCount - 1);
            }
        }
    }

    if (typeof statusBar !== 'undefined') {
        applyDisplayPrefs();
        syncStatusBarTelemetry(true);
    }

    return { ok: true, normalizedKey };
}

export function getCachedCliUsageDays(force = false): CliDailyUsageRecord[] {
    const nowMs = Date.now();
    if (!force && lastCliScanAtMs > 0 && nowMs - lastCliScanAtMs < CLI_SCAN_TTL_MS) {
        return cachedCliDays;
    }
    try {
        const res = cliUsageScanner.scan({
            cliRootDir: process.env.ANTIGRAVITY_CLI_DATA_DIR || undefined,
            customPricing: pricingStore?.getCustom(),
            now: nowMs,
        });
        cachedCliDays = res.available ? res.days : [];
        lastCliScanAtMs = nowMs;
    } catch {
        cachedCliDays = [];
        lastCliScanAtMs = nowMs;
    }
    return cachedCliDays;
}

export function getLastUpdateStatusView(): UpdateStatusView | null {
    return lastUpdateStatusView;
}

export async function checkIdeReleaseUpdates(force = true): Promise<UpdateCheckResult> {
    const prev = sharedAppSettings.lastUpdateCheck;
    const currentVersion = getIdeExtensionVersion();
    const res = await checkForUpdates({
        currentVersion,
        force,
        etag: prev?.etag ?? null,
        lastCheckedAt: prev?.checkedAt ?? null,
    });
    if (res.status !== 'throttled') {
        const record: LastUpdateCheckRecord = {
            checkedAt: res.checkedAt,
            latestVersion: res.latestVersion ?? (res.status === 'not_modified' ? prev?.latestVersion ?? null : null),
            hasUpdate: res.status === 'not_modified' ? Boolean(prev?.hasUpdate) : Boolean(res.hasUpdate),
            etag: res.etag ?? prev?.etag ?? null,
            releaseUrl: res.releaseInfo?.releaseUrl ?? (res.status === 'not_modified' ? prev?.releaseUrl ?? null : null),
            releaseNotesSummary: res.releaseInfo?.releaseNotesSummary ?? (res.status === 'not_modified' ? prev?.releaseNotesSummary ?? null : null),
            assetName: res.releaseInfo?.assetName ?? (res.status === 'not_modified' ? prev?.assetName ?? null : null),
            assetUrl: res.releaseInfo?.assetUrl ?? (res.status === 'not_modified' ? prev?.assetUrl ?? null : null),
            checksumsUrl: res.releaseInfo?.checksumsUrl ?? (res.status === 'not_modified' ? prev?.checksumsUrl ?? null : null),
            error: res.status === 'error' ? (res.error ?? 'Update check failed') : null,
        };
        if (durableState) {
            const pSettings = durableState.updateAppSettings({ lastUpdateCheck: record });
            await durableState.flush();
            sharedAppSettings = await pSettings;
            lastSyncedDiskAppSettings = { ...sharedAppSettings };
        } else {
            sharedAppSettings = { ...sharedAppSettings, lastUpdateCheck: record };
        }
        lastUpdateStatusView = {
            currentVersion,
            latestVersion: record.latestVersion,
            updateAvailable: Boolean(record.hasUpdate),
            hasUpdate: Boolean(record.hasUpdate),
            status: res.status,
            checkedAt: record.checkedAt,
            releaseUrl: record.releaseUrl,
            releaseNotesSummary: record.releaseNotesSummary,
            error: record.error,
        };
    }
    return res;
}

function triggerIdeBackgroundUpdateCheck(): void {
    if (disposed || autoUpdateCheckInFlight || !sharedAppSettings.autoCheckUpdates) { return; }
    if (process.env.VITEST) { return; }
    autoUpdateCheckInFlight = true;
    void checkIdeReleaseUpdates(false)
        .catch(() => { /* offline-safe */ })
        .finally(() => { autoUpdateCheckInFlight = false; });
}

/** Discover the Antigravity IDE language server (explicitly preferring IDE when both App + IDE run). */
function discoverLanguageServer(
    workspaceUri?: string,
    signal?: AbortSignal,
    logger?: (message: string) => void,
): Promise<LSInfo | null> {
    return discoverPreferredBackend({
        workspaceUri,
        signal,
        log: logger,
        preferredSurface: 'ide',
    });
}

/** Get whether Main-Agent Lock is enabled. */
export function getLockToMainAgent(): boolean {
    return lockToMainAgent;
}

/** Toggle or explicitly set Main-Agent Lock, persisting in shared DurableState. */
export function setLockToMainAgent(locked?: boolean): boolean {
    const next = typeof locked === 'boolean' ? locked : !lockToMainAgent;
    lockToMainAgent = next;
    sharedAppSettings.lockToMainAgent = next;
    if (next && trackedCascadeId) {
        lockedMainCascadeId = trackedCascadeId;
    } else if (!next) {
        lockedMainCascadeId = null;
    }
    if (durableFileGlobalState) {
        void durableFileGlobalState.update('lockToMainAgent', lockToMainAgent);
    }
    if (durableState) {
        void durableState.updateAppSettings({ lockToMainAgent: next }).then((updated) => {
            sharedAppSettings = updated;
            lastSyncedDiskAppSettings = { ...updated };
            return durableState.flush();
        });
    }
    return lockToMainAgent;
}

/** Get the manually pinned conversation ID (or null for Follow Active). */
export function getPinnedConversationId(): string | null {
    return pinnedConversationId;
}

function clearActiveContextTelemetry(): void {
    lastContextBreakdown = null;
    lastContextBreakdownKey = '';
    lastTurnDiagnostics = null;
}

/** Pin a specific conversation ID or pass null/empty to return to Follow Active. */
export function selectPinnedConversation(cascadeId: string | null): void {
    const normalized = typeof cascadeId === 'string' && cascadeId.trim() ? cascadeId.trim() : null;
    pinnedConversationId = normalized;
    if (normalized) {
        trackedCascadeId = normalized;
    }
    clearActiveContextTelemetry();
    if (durableFileWorkspaceState) {
        void durableFileWorkspaceState.update('pinnedConversationId', pinnedConversationId);
    }
}

function recordQuotaRunwaysFromState(
    configs: ModelConfig[],
    quotaSummary?: UserQuotaSummary | null,
    nowMs = Date.now(),
): void {
    const recordedPools = new Set<string>();
    if (quotaSummary?.groups) {
        for (const group of quotaSummary.groups) {
            const win = group.fiveHour;
            if (!win || typeof win.remainingFraction !== 'number' || !Number.isFinite(win.remainingFraction)) {
                continue;
            }
            const poolKey = group.pool || group.displayName;
            if (!poolKey || recordedPools.has(poolKey)) { continue; }
            recordedPools.add(poolKey);
            const resetMs = win.resetTime ? parsePositivePoolResetMs(win.resetTime) : null;
            quotaRunwayTracker.record(poolKey, win.remainingFraction, nowMs, resetMs);
        }
    }
    for (const group of groupModelQuotas(configs, quotaSummary)) {
        const poolKey = group.pool || group.key;
        if (!poolKey || recordedPools.has(poolKey) || group.minimum === null) { continue; }
        recordedPools.add(poolKey);
        const resetMs = group.resetTime ? parsePositivePoolResetMs(group.resetTime) : null;
        quotaRunwayTracker.record(poolKey, group.minimum, nowMs, resetMs);
    }
    if (durableFileGlobalState && nowMs - lastRunwayPersistMs >= 30_000) {
        lastRunwayPersistMs = nowMs;
        void durableFileGlobalState.update('quotaRunwayState', quotaRunwayTracker.serialize());
    }
}

function getCurrentQuotaRunways(nowMs = Date.now()): Record<string, QuotaRunwayEstimate> {
    const isCustomActive = isCustomModel(currentUsage?.model, currentUsage?.modelDisplayName);
    return quotaRunwayTracker.estimateAll(nowMs, {
        modelId: currentUsage?.model,
        modelLabel: currentUsage?.modelDisplayName,
        isCustomModel: isCustomActive,
    });
}

function getCurrentStaleState(): MonitorStaleState | null {
    const userSnap = userStatusStaleGuard.getSnapshot();
    const trajSnap = trajectoriesStaleGuard.getSnapshot();
    const staleSnap = trajSnap.isStale
        ? trajSnap
        : (userSnap.isStale ? userSnap : null);
    if (!staleSnap || staleSnap.lastSuccessAtMs === null) {
        return null;
    }
    return {
        isStale: true,
        lastSuccessAtMs: staleSnap.lastSuccessAtMs,
        lastError: staleSnap.lastError,
    };
}

/** Previous poll's step counts per cascade — used to detect activity. */
const previousStepCounts = new Map<string, number>();

/** Models that have already triggered a low-quota notification (cleared when recovered). */
const quotaNotifiedModels = new Set<string>();

/** Previous poll's known trajectory IDs — used to detect new conversations. */
const previousTrajectoryIds = new Set<string>();

type ContextObservation = Pick<ContextUsage, 'contextUsed' | 'isEstimated' | 'model' | 'tokenUsageSource'>
    & Partial<Pick<ContextUsage, 'lastModelUsage'>>;
/** Compare like-for-like measurements, never an estimate against a provider count. */
const previousContextObservations = new Map<string, ContextObservation>();



/** Whether we've completed at least one poll cycle. */
let firstPollDone = false;

/** Prevents concurrent pollContextUsage() reentrance. */
let isPolling = false;
let hasSyncedCheckpointer = false;
let isSyncingCheckpointer = false;
/** Consecutive checkpointer sync attempts since the last successful sync or reconnect. */
let checkpointerSyncAttempts = 0;
/** Upper bound on those attempts, so an account with no checkpointer experiments stops re-asking. */
const MAX_CHECKPOINTER_SYNC_ATTEMPTS = 5;
let isRefreshingAuxiliaryMetadata = false;
let auxMetadataConsecutiveFailures = 0;
const MAX_AUX_METADATA_FAILURES = 3;
let modelMetadataGeneration = 0;

/** Do not carry tool-model availability across accounts or backend lifetimes. */
export function invalidateLiveModelMetadata(): void {
    modelMetadataGeneration++;
    resetImageWorkflowCache();
    setAvailableImageModelIds([]);
    hasSyncedCheckpointer = false;
    isSyncingCheckpointer = false;
    checkpointerSyncAttempts = 0;
    isRefreshingAuxiliaryMetadata = false;
    auxMetadataConsecutiveFailures = 0;
    cachedOrchestratorSettings = null;
    cachedQuotaSummary = null;
    lastContextBreakdown = null;
    lastContextBreakdownKey = '';
    lastTurnDiagnostics = null;
    if (typeof statusBar !== 'undefined') {
        statusBar.setOrchestratorSettings(null);
        statusBar.setQuotaSummary(null);
        statusBar.setStaleState(null);
        statusBar.setQuotaRunways(null);
        statusBar.clearStabilizedResetTimes();
    }
}

/** Prevents schedulePoll() from creating new timers after deactivate. */
// disposed declared at top of module

/** Generation counter — prevents orphan timer chains. */
// pollGeneration declared at top of module

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

export function hasSameUsageInputs(
    cached: ContextUsage | null | undefined,
    trajectory: Pick<TrajectorySummary, 'cascadeId' | 'stepCount' | 'lastModifiedTime' | 'status'>,
): cached is ContextUsage {
    return !!cached
        && cached.tokenUsageSource !== undefined
        && cached.imageWorkflow !== undefined
        && (!cached.compressionDetected || cached.checkpointCompressionDrop > 0)
        && trajectory.status !== CascadeStatus.RUNNING
        && cached.status === trajectory.status
        && cached.cascadeId === trajectory.cascadeId
        && cached.stepCount === trajectory.stepCount
        && cached.lastModifiedTime === trajectory.lastModifiedTime;
}

export function measuredContextDrop(
    previous: ContextObservation | undefined,
    current: ContextObservation & Pick<ContextUsage, 'contextLimit'>,
    isUndo: boolean,
): number {
    if (!previous || isUndo || previous.isEstimated || current.isEstimated
        || !previous.model || !current.model || !previous.tokenUsageSource
        || previous.tokenUsageSource !== current.tokenUsageSource
        || (resolveModelId(previous.model) || previous.model) !== (resolveModelId(current.model) || current.model)
        || !Number.isFinite(previous.contextUsed) || !Number.isFinite(current.contextUsed)
        || !Number.isFinite(current.contextLimit) || current.contextLimit <= 0) { return 0; }
    // A coordinator may keep its selected identity while an execution worker
    // reports a different context snapshot. That transition is not compression.
    const previousMeasuredModel = previous.lastModelUsage?.model || previous.model;
    const currentMeasuredModel = current.lastModelUsage?.model || current.model;
    if ((resolveModelId(previousMeasuredModel) || previousMeasuredModel)
        !== (resolveModelId(currentMeasuredModel) || currentMeasuredModel)) { return 0; }
    const drop = previous.contextUsed - current.contextUsed;
    return drop > current.contextLimit * 0.01 ? drop : 0;
}

function rehydrateUsageForDisplay(
    usage: ContextUsage,
    customLimits?: Record<string, number>,
): ContextUsage {
    const model = usage.model || usage.lastModelUsage?.model || lastKnownModel || '';
    const modelDisplayName = normalizeModelDisplayName(model);
    const limitModel = usage.tokenUsageSource === 'planner' && usage.lastModelUsage?.model
        ? usage.lastModelUsage.model
        : model;
    const contextLimit = getContextLimit(limitModel, customLimits);
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

function computeLiveCostSnapshot(
    summary: GMSummary | null,
    activeCascadeId?: string,
): { todayCostUsd: number; todayHasUnpriced: boolean; sessionCostUsd: number; sessionHasUnpriced: boolean } {
    const custom = pricingStore?.getCustom() ?? {};
    const orchMode = sharedAppSettings.orchestratorPricingMode;

    // Today's total from DailyLedger (active + settled)
    let todayCostUsd = 0;
    let todayHasUnpriced = false;
    if (typeof dailyLedger !== 'undefined') {
        for (const bucket of dailyLedger.getTodayActive()) {
            for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
                if (ms.calls <= 0) { continue; }
                const res = calculateLedgerModelCosts(modelKey, ms, bucket, custom, undefined, orchMode);
                todayCostUsd += res.totalCost;
                if (!res.pricing) { todayHasUnpriced = true; }
            }
        }
        for (const entry of dailyLedger.getSettledEntries()) {
            todayCostUsd += entry.totalEstimatedCost || 0;
            if (!todayHasUnpriced && entry.totalCalls > 0 && entry.modelCalls) {
                for (const [modelKey, calls] of Object.entries(entry.modelCalls)) {
                    if (calls > 0 && !findPricingForDate(modelKey, custom, entry.settledAt, undefined, orchMode)) {
                        todayHasUnpriced = true;
                        break;
                    }
                }
            }
        }
    }

    // Active conversation (or session fallback) cost from account-filtered GM summary
    let sessionCostUsd = 0;
    let sessionHasUnpriced = false;
    if (summary && summary.conversations.length > 0) {
        const activeConv = activeCascadeId
            ? summary.conversations.find(c => c.cascadeId === activeCascadeId)
            : undefined;
        const calls = activeConv && activeConv.calls.length > 0
            ? activeConv.calls
            : summary.conversations.flatMap(c => c.calls);
        for (const call of calls) {
            const pricingModel = selectPricingModel(call.model || call.modelDisplay, call.responseModel, custom);
            const pricing = findPricingForDate(pricingModel, custom, call.createdAt || '', undefined, orchMode);
            if (pricing) {
                sessionCostUsd += costFromTokens(call, pricing);
            } else {
                sessionHasUnpriced = true;
            }
        }
    }

    return { todayCostUsd, todayHasUnpriced, sessionCostUsd, sessionHasUnpriced };
}

function makePanelPayload(extra: Partial<PanelPayload> = {}): PanelPayload {
    const gmSummary = gmTracker.getUiSummary();
    const activeId = currentUsage?.cascadeId ?? trackedCascadeId ?? undefined;
    const costs = computeLiveCostSnapshot(gmSummary, activeId);
    const workspaceUri = getWorkspaceUri();
    const isCustomActive = isCustomModel(currentUsage?.model, currentUsage?.modelDisplayName);
    const quotaRunways = getCurrentQuotaRunways();
    const staleState = getCurrentStaleState();
    const conversationOptions: ConversationOption[] = buildConversationOptions(
        lastTrajectories,
        activeId ?? null,
        lockedMainCascadeId,
        {
            workspaceUris: workspaceUri ? [workspaceUri] : [],
            lang: getLanguage(),
        },
    );
    return {
        currentUsage,
        monitorStatus: statusBar?.monitorStatus,
        allTrajectoryUsages,
        allTrajectories: lastTrajectories,
        modelConfigs: cachedModelConfigs,
        userInfo: cachedUserInfo,
        workspaceUri,
        activitySummary: activityTracker?.getSummary() ?? null,
        archives: activityTracker?.getArchives(),
        activityTracker,
        gmSummary,
        gmFullSummary: gmTracker.getUiFullSummary(),
        gmConversations: monitorStore.getGMConversations(),
        pricingStore,
        dailyStore,
        storageDiagnostics: getStorageDiagnostics(),
        modelDNA: persistedModelDNA,
        accountSnapshots: getAccountSnapshotArray(),
        todayLedgerActive: dailyLedger.getTodayActive(),
        customPricing: pricingStore.getCustom(),
        ledgerSettled: dailyLedger.getSettledEntries(),
        orchestratorSettings: cachedOrchestratorSettings,
        quotaSummary: cachedQuotaSummary,
        todayCostUsd: costs.todayCostUsd > 0 ? costs.todayCostUsd : undefined,
        sessionCostUsd: costs.sessionCostUsd > 0 ? costs.sessionCostUsd : undefined,
        contextBreakdown: lastContextBreakdown,
        turnDiagnostics: lastTurnDiagnostics,
        quotaRunways,
        isCustomModelActive: isCustomActive,
        staleState,
        conversationOptions,
        activeConversationId: activeId ?? null,
        pinnedConversationId,
        lockToMainAgent,
        cliDays: getCachedCliUsageDays(false),
        orchestratorPricingMode: sharedAppSettings.orchestratorPricingMode,
        appSettings: getSharedAppSettings(),
        updateStatus: lastUpdateStatusView,
        ...extra,
    };
}

/** Compare auxiliary live metadata payloads structurally to skip redundant status bar & panel refreshes. */
export function hasAuxiliaryMetadataChanged(prev: unknown, next: unknown): boolean {
    if (prev === next) { return false; }
    if (!prev || !next) { return true; }
    try {
        return JSON.stringify(prev) !== JSON.stringify(next);
    } catch {
        return true;
    }
}

/**
 * Refresh auxiliary live metadata (global Orchestrator Settings + dual-window
 * RetrieveUserQuotaSummary) non-blockingly in the background.
 * Guarded by in-flight dedup, per-generation failure backoff, and modelMetadataGeneration
 * so a stalled JetboxSubscribeToState stream never blocks core trajectory/context polling.
 */
function triggerLiveAuxiliaryMetadataRefresh(
    ls: LSInfo,
    configs: readonly ModelConfig[],
    generation: number,
    signal?: AbortSignal,
): void {
    if (isRefreshingAuxiliaryMetadata || auxMetadataConsecutiveFailures >= MAX_AUX_METADATA_FAILURES) {
        return;
    }
    isRefreshingAuxiliaryMetadata = true;
    void (async () => {
        try {
            const [orchRes, quotaRes] = await Promise.allSettled([
                fetchOrchestratorSettings(ls, configs, signal),
                fetchUserQuotaSummary(ls, signal),
            ]);
            if (generation !== modelMetadataGeneration || disposed) { return; }
            let updated = false;
            const gotOrch = orchRes.status === 'fulfilled' && !!orchRes.value;
            const gotQuota = quotaRes.status === 'fulfilled' && !!quotaRes.value;
            if (gotOrch) {
                const orchChanged = hasAuxiliaryMetadataChanged(cachedOrchestratorSettings, orchRes.value);
                cachedOrchestratorSettings = orchRes.value;
                if (typeof statusBar !== 'undefined') {
                    statusBar.setOrchestratorSettings(orchRes.value);
                }
                if (orchChanged) { updated = true; }
            }
            if (gotQuota) {
                const quotaChanged = hasAuxiliaryMetadataChanged(cachedQuotaSummary, quotaRes.value);
                cachedQuotaSummary = quotaRes.value;
                recordQuotaRunwaysFromState(cachedModelConfigs, cachedQuotaSummary);
                if (typeof statusBar !== 'undefined') {
                    statusBar.setQuotaSummary(quotaRes.value);
                    statusBar.setQuotaRunways(getCurrentQuotaRunways());
                }
                if (quotaChanged) { updated = true; }
            }
            if (gotOrch || gotQuota) {
                auxMetadataConsecutiveFailures = 0;
            } else {
                auxMetadataConsecutiveFailures++;
            }
            if (updated) {
                if (typeof statusBar !== 'undefined') {
                    statusBar.refreshFromConfig();
                }
                if (isMonitorPanelVisible()) {
                    updateMonitorPanel(makePanelPayload());
                }
            }
        } finally {
            if (generation === modelMetadataGeneration) {
                isRefreshingAuxiliaryMetadata = false;
            }
        }
    })();
}

interface LiveModelStatusHandlers {
    replaceConfigs(configs: ModelConfig[]): void;
    switchAccount(email: string): void;
    updateQuota(configs: ModelConfig[], email?: string): void;
}

/** Apply an authenticated empty picker, while retaining cached state on RPC failure.
 *  The same transition is used on discovery, LS replacement, and periodic refresh. */
export function applyLiveModelStatus(
    fullStatus: Pick<FullUserStatus, 'configs' | 'userInfo'>,
    handlers: LiveModelStatusHandlers = {
        replaceConfigs: configs => {
            cachedModelConfigs = configs;
            statusBar.setModelConfigs(configs);
        },
        switchAccount: handleAccountSwitchIfNeeded,
        updateQuota: (configs, email) => {
            quotaTracker.processUpdate(configs, buildUsedModelIds(email), email);
            recordQuotaRunwaysFromState(configs, cachedQuotaSummary);
            if (typeof statusBar !== 'undefined') {
                statusBar.setQuotaRunways(getCurrentQuotaRunways());
            }
            checkQuotaNotification(configs);
        },
    },
): boolean {
    if (fullStatus.configs.length === 0 && !fullStatus.userInfo) { return false; }
    updateModelDisplayNames(fullStatus.configs, { authoritative: true });
    handlers.replaceConfigs(fullStatus.configs);
    if (fullStatus.userInfo?.email) { handlers.switchAccount(fullStatus.userInfo.email); }
    handlers.updateQuota(fullStatus.configs, fullStatus.userInfo?.email);
    return true;
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

/**
 * Parse a quota pool resetTime strictly as an ISO-8601 timestamp with timezone
 * and valid calendar date, rejecting proto3 epoch-0 (`1970-01-01T00:00:00Z`,
 * `.000Z`, `+00:00`), negative epochs, and malformed date strings.
 */
export function parsePositivePoolResetMs(raw: unknown): number | null {
    const ms = parseStrictResetTimestamp(raw);
    return ms !== null && ms > 0 ? ms : null;
}

/** Sort pool resetTime strings chronologically by UTC epoch ms (valid positive timestamps first). */
export function comparePoolResetTimes(a: string, b: string): number {
    const aMs = parsePositivePoolResetMs(a);
    const bMs = parsePositivePoolResetMs(b);
    if (aMs !== null && bMs !== null) {
        return aMs - bMs || a.localeCompare(b);
    }
    if (aMs !== null) { return -1; }
    if (bMs !== null) { return 1; }
    return a.localeCompare(b);
}

export function groupModelConfigsByQuotaPool(configs: ModelConfig[]): ModelQuotaPoolGroup[] {
    const poolMap = new Map<string, { labels: string[]; modelIds: string[]; resetEntries: Map<string, number>; minFraction: number }>();
    for (const c of configs) {
        if (!c.quotaInfo) { continue; }
        const rawReset = typeof c.quotaInfo.resetTime === 'string' ? c.quotaInfo.resetTime.trim() : '';
        const resetMs = parsePositivePoolResetMs(rawReset);
        const resetTime = resetMs !== null ? rawReset : '';
        const key = getQuotaPoolKey(c.model, resetTime || undefined);
        const pool = poolMap.get(key) || { labels: [], modelIds: [], resetEntries: new Map<string, number>(), minFraction: 1 };
        const label = c.label || c.model;
        if (label && !pool.labels.includes(label)) {
            pool.labels.push(label);
        }
        if (c.model && !pool.modelIds.includes(c.model)) {
            pool.modelIds.push(c.model);
        }
        if (resetTime && resetMs !== null && !pool.resetEntries.has(resetTime)) {
            pool.resetEntries.set(resetTime, resetMs);
        }
        const fraction = c.quotaInfo.remainingFraction;
        if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
            pool.minFraction = Math.min(pool.minFraction, fraction);
        }
        poolMap.set(key, pool);
    }

    return [...poolMap.entries()].map(([key, pool]) => {
        const sortedResets = [...pool.resetEntries.entries()]
            .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
        return {
            key,
            resetTime: sortedResets[0]?.[0] || '',
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
    const oldMs = parsePositivePoolResetMs(oldResetTime);
    const newMs = parsePositivePoolResetMs(newResetTime);
    if (oldMs === null || newMs === null) {
        return false;
    }
    if (oldMs > nowMs || newMs <= nowMs) {
        return false;
    }
    return (newMs - oldMs) >= RESET_TIME_TURNOVER_MIN_JUMP_MS;
}

/**
 * Whether a value has the shape of a canonical platform model identifier
 * (MODEL_PLACEHOLDER_M298, MODEL_OPENAI_GPT_OSS_120B_MEDIUM, …).
 * Used to accept models the platform ships before the local registry knows about them.
 * MODEL_UNSPECIFIED is excluded — it is a sentinel, not an addressable model.
 */
function isPlatformModelId(value: string): boolean {
    const clean = (value || '').trim();
    return /^MODEL_[A-Z0-9_]+$/.test(clean) && !clean.includes('UNSPECIFIED');
}

interface AvailableModelMetadata {
    model?: string;
    displayName?: string;
    modelId?: string;
    model_id?: string;
    apiProvider?: string;
    maxTokens?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
    supportsThinking?: boolean;
    supportsAdaptiveThinking?: boolean;
    thinkingLevel?: number;
    modelExperiments?: { experiments?: Record<string, { stringValue?: string }> };
}

function positiveTokenLimit(value: unknown): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) { return 0; }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function fetchAndOverrideCheckpointerLimits(
    ls: LSInfo, logMessage: (message: string) => void = log, isCurrent: () => boolean = () => true,
): Promise<boolean> {
    try {
        logMessage('[Checkpointer Sync] Fetching official checkpointer parameters via LS RPC GetAvailableModels...');
        const resp = await rpcCall(ls, 'GetAvailableModels', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 10000);
        if (!isCurrent()) { return false; }
        const response = resp.response as { models?: Record<string, AvailableModelMetadata>; imageGenerationModelIds?: unknown } | undefined;
        const models = response?.models || (resp.models as Record<string, AvailableModelMetadata> | undefined) || {};
        const rawImageIds = response?.imageGenerationModelIds ?? resp.imageGenerationModelIds;
        const hasImageList = Array.isArray(rawImageIds) && rawImageIds.every(id => typeof id === 'string');
        const imageIds = new Set<string>(hasImageList ? (rawImageIds as string[]).map(id => id.trim()).filter(Boolean) : []);
        const overrides: Record<string, number> = {};
        const allFetchedInfo: string[] = [];
        let imageMetadataSynced = false;

        for (const [catalogId, c] of Object.entries(models)) {
            if (!c || typeof c !== 'object') { continue; }
            const modelVal = typeof c.model === 'string' ? c.model : '';
            // Current LS catalog entries carry their response/model ID in the map
            // key, not a modelId field. Keeping it prevents live sync replacing a
            // useful catalog alias with the opaque placeholder.
            const modelIdVal = (typeof c.modelId === 'string' && c.modelId)
                || (typeof c.model_id === 'string' && c.model_id) || catalogId;
            if (!modelVal && !modelIdVal) continue;

            // The platform hands us the canonical placeholder in `model` (e.g. MODEL_PLACEHOLDER_M298).
            // Trust that shape directly instead of requiring it to already be in the local registry:
            // a model the platform ships BEFORE we register it would otherwise resolve to undefined,
            // skip the updateModelSpec() call below, and be stuck with no spec at all — which is how a
            // brand-new model ends up showing a permanent "calculating threshold…" shimmer even though
            // its real parameters were sitting in the response we just parsed.
            const resolved = (isPlatformModelId(modelVal) ? modelVal : undefined)
                || (modelVal ? resolveModelId(modelVal) : undefined)
                || (modelIdVal ? resolveModelId(modelIdVal) : undefined);

            const exps = c.modelExperiments?.experiments || {};
            const checkpointerStr = exps.CASCADE_USE_EXPERIMENT_CHECKPOINTER?.stringValue;
            let limitNum = 0;
            let thresholdNum = 0;

            if (checkpointerStr) {
                allFetchedInfo.push(`[${modelIdVal || modelVal}] Exp JSON: ${checkpointerStr}`);
                try {
                    const cp = JSON.parse(checkpointerStr) as Record<string, unknown>;
                    limitNum = positiveTokenLimit(cp.max_token_limit ?? cp.max_limit);
                    thresholdNum = positiveTokenLimit(cp.token_threshold ?? cp.threshold);

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
            // Update anything already registered, but only CREATE a spec for a model the platform
            // actually describes. The catalog also carries internal entries (MODEL_CHAT_*, the tab
            // completion models) whose checkpointer and token fields are null — filing
            // specs for those would pad the registry with rows that render as a bare ID and a zero
            // context limit.
            const previousSpec = resolved ? getModelSpecs().find(s => s.placeholderId === resolved) : undefined;
            const alreadyRegistered = !!previousSpec;
            const imageModel = imageIds.has(catalogId) || imageIds.has(modelIdVal)
                || !!previousSpec?.isImageGeneration;
            // A model the user can actually pick must always get a spec, even before the platform
            // enables a checkpointer experiment on it: without one, getQuotaPoolKey() has no provider
            // to pool by and the new model splits into its own phantom quota pool — the exact failure
            // the provider fallback in models.ts exists to prevent.
            const inLivePicker = !!resolved && cachedModelConfigs.some(cfg => cfg.model === resolved);
            const maxTokens = positiveTokenLimit(c.maxTokens);
            const maxOutputTokens = positiveTokenLimit(c.maxOutputTokens);
            // Image tools are real catalog models even though they have no chat
            // checkpointer and are intentionally absent from the chat picker.
            const describesARealModel = (limitNum > 0 || imageModel) && maxTokens > 0;
            if (resolved && (alreadyRegistered || inLivePicker || describesARealModel)) {
                registerResponseModelAlias(modelIdVal, resolved);
                // Full protobuf catalog records omit default-valued fields. When
                // the provider and both token capacities are present, an absent
                // thinking budget/flag means zero/false, not "keep last month's
                // value". Partial or malformed records must preserve known data.
                const completeMetadata = isPlatformModelId(modelVal)
                    && typeof c.apiProvider === 'string' && !!c.apiProvider.trim()
                    && maxTokens > 0 && maxOutputTokens > 0;
                // Missing data in a partial response must not erase a known route.
                // A full record with no plan/execute experiment clears an old route.
                const executionLink: Partial<import('./models').ModelSpec> = {};
                const planExecute = exps['plan-execute-config'];
                if (typeof planExecute?.stringValue === 'string') {
                    try {
                        const parsed: unknown = JSON.parse(planExecute.stringValue);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            const candidate = (parsed as Record<string, unknown>).executionModel;
                            if (typeof candidate === 'string' && isPlatformModelId(candidate)
                                && candidate === candidate.trim() && candidate !== resolved) {
                                executionLink.executionModelId = candidate;
                            }
                        }
                    } catch { /* Preserve last known route for malformed metadata. */ }
                } else if (completeMetadata && planExecute === undefined) {
                    executionLink.executionModelId = undefined;
                }
                updateModelSpec(resolved, {
                    ...executionLink,
                    modelId: modelIdVal || modelVal,
                    ...(typeof c.displayName === 'string' && c.displayName.trim() ? { displayName: c.displayName.trim() } : {}),
                    ...(imageModel ? { isImageGeneration: true, thinkingCapabilityReported: typeof c.supportsThinking === 'boolean' } : {}),
                    ...(typeof c.apiProvider === 'string' ? { apiProvider: c.apiProvider.replace('API_PROVIDER_', '') } : {}),
                    ...(maxTokens ? { maxTokens } : {}),
                    ...(maxOutputTokens ? { maxOutputTokens } : {}),
                    ...(typeof c.thinkingBudget === 'number' && Number.isFinite(c.thinkingBudget) ? { thinkingBudget: c.thinkingBudget } : {}),
                    ...(completeMetadata && c.thinkingBudget === undefined ? { thinkingBudget: 0 } : {}),
                    ...(typeof c.supportsThinking === 'boolean' ? { supportsThinking: c.supportsThinking } : {}),
                    ...(completeMetadata && c.supportsThinking === undefined ? { supportsThinking: false } : {}),
                    ...(typeof c.supportsAdaptiveThinking === 'boolean' ? { supportsAdaptiveThinking: c.supportsAdaptiveThinking } : {}),
                    ...(completeMetadata && c.supportsAdaptiveThinking === undefined ? { supportsAdaptiveThinking: false } : {}),
                    ...(typeof c.thinkingLevel === 'number' && Number.isSafeInteger(c.thinkingLevel) && c.thinkingLevel >= 0
                        ? { thinkingLevel: c.thinkingLevel } : {}),
                    ...(completeMetadata && c.thinkingLevel === undefined ? { thinkingLevel: 0 } : {}),
                    ...(limitNum > 0 ? { cpLimit: limitNum } : {}),
                    ...(thresholdNum > 0 ? { cpThreshold: thresholdNum } : {}),
                    ...(imageModel && completeMetadata && !checkpointerStr ? { cpLimit: 0, cpThreshold: 0 } : {}),
                });
                if (imageModel && completeMetadata) { imageMetadataSynced = true; }
            }
        }
        if (hasImageList) { setAvailableImageModelIds([...imageIds]); }

        if (allFetchedInfo.length > 0) {
            logMessage(`[Checkpointer Sync] Official checkpointer parameters fetched for ${allFetchedInfo.length} models.`);
        }



        if (Object.keys(overrides).length > 0) {
            overrideContextLimits(overrides);
            logMessage(`[Checkpointer Sync] Dynamically resolved and overridden ${Object.keys(overrides).length} model context limits from official Checkpointer!`);
            return true;
        }
        if (imageMetadataSynced) {
            logMessage('[Checkpointer Sync] Image model metadata synchronized; no chat compression limit was reported.');
            return true;
        }

        // Parsed fine but produced nothing. Report failure so the caller retries on the next poll
        // instead of latching hasSyncedCheckpointer and never syncing again for the whole session:
        // an empty result means either the platform moved the response envelope (this reader is the
        // only nested `response.models` reader in the codebase — everything else reads a top-level
        // field) or no model currently carries a checkpointer experiment. Both are transient states
        // that a later poll can resolve, and both otherwise leave every model on its static fallback
        // while the log cheerfully reports success.
        logMessage(`[Checkpointer Sync] Parsed the response but found no checkpointer overrides — will retry. Envelope keys: ${Object.keys(resp ?? {}).join(', ') || '(none)'}`);
        return false;
    } catch (e: any) {
        logMessage(`[Checkpointer Sync] Optional dynamic capture failed: ${e.message}. Using built-in static fallbacks.`);
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
            const oldResetMs = parsePositivePoolResetMs(oldResetTime);
            const cutoffTime = oldResetMs ?? undefined;
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
                syncStatusBarTelemetry(true);
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

    // Build resetPools sorted by resetTime (earliest first, chronologically by epoch ms)
    const resetPools: import('./activity-panel').ResetPool[] = [];
    const allResetTimes: string[] = [];
    for (const [, pool] of [...poolMap.entries()].sort((a, b) => comparePoolResetTimes(a[1].resetTime, b[1].resetTime))) {
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
    const validCredits = currentAICredits(userInfo.availableCredits || []).flatMap(c =>
        c.creditAmount === null ? [] : [{ creditType: c.creditType, creditAmount: c.creditAmount }]);

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
                const sanitizedCredits = Array.isArray(snap.credits)
                    ? currentAICredits(snap.credits.map(c => ({
                        creditType: c.creditType,
                        creditAmount: c.creditAmount,
                        minimumCreditAmountForUsage: 0,
                    }))).flatMap(c => c.creditAmount === null ? [] : [{ creditType: c.creditType, creditAmount: c.creditAmount }])
                    : undefined;
                // All restored snapshots start as inactive until a live fetch confirms
                accountSnapshots.set(snap.email, {
                    ...snap,
                    credits: sanitizedCredits && sanitizedCredits.length > 0 ? sanitizedCredits : undefined,
                    isActive: false,
                });
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
        statusBar.refreshFromConfig();
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
        invalidateLiveModelMetadata();
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
        if (typeof statusBar !== 'undefined') {
            statusBar.setCredits(null);
            statusBar.setPlanName('', '');
            statusBar.setTelemetry(null);
        }
        applyDisplayPrefs(); // refresh billing day for new account
        return true;
    }
    if (!currentAccountEmail) {
        invalidateLiveModelMetadata();
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
        const resetMs = parsePositivePoolResetMs(pool.resetTime);
        if (resetMs === null) { continue; }

        const diffMs = resetMs - nowMs;
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
        const cutoffTime = resetMs;
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
            syncStatusBarTelemetry(true);
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
        surface: 'ide',
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
            syncStatusBarTelemetry(true);
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
    const customStatePath = process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH?.trim() || undefined;
    durableState = new DurableState(customStatePath);
    durableGlobalState = durableState.globalBucket(context.globalState);
    durableWorkspaceState = durableState.workspaceBucket(workspaceKey, context.workspaceState);
    durableFileGlobalState = durableState.globalBucket();
    durableFileWorkspaceState = durableState.workspaceBucket(workspaceKey);

    // Inject durable state into webview-panel for zoom persistence
    setPanelDurableState(durableFileGlobalState);

    // Restore v1.17.5 conversation lock, pinned session, and quota runway history
    lockToMainAgent = durableFileGlobalState.get<boolean>('lockToMainAgent', false);
    pinnedConversationId = durableFileWorkspaceState.get<string | null>('pinnedConversationId', null);
    const savedRunway = durableFileGlobalState.get<SerializedQuotaRunwayState | undefined>('quotaRunwayState', undefined);
    quotaRunwayTracker = savedRunway ? QuotaRunwayTracker.deserialize(savedRunway) : new QuotaRunwayTracker();

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
        syncStatusBarTelemetry(true);

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
    // Hydrate v1.17.6 shared app settings (reconciles orchestratorPricingMode, retention, currency, etc.)
    hydrateSharedAppSettingsFromDisk(true);
    // Restore multi-account snapshots from file-backed state
    restoreAccountSnapshots();
    restoreBillingDays();
    // Restore current account email from GMTracker persisted state
    currentAccountEmail = gmTracker.getCurrentAccount();
    dailyStore = new DailyStore();
    dailyStore.init(durableGlobalState, { maxDays: sharedAppSettings.calendarRetentionDays });
    // Initialize DailyLedger — restores from durable state and tags IDE surface
    const savedLedger = durableGlobalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
    dailyLedger = DailyLedger.restore(savedLedger);
    dailyLedger.setSurface('ide');
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

    // ── Self-healing cost backfill ──
    // Days archived while their model had no price row carry no cost. Re-pricing them from
    // their stored tokens only fills gaps and never overwrites, so it runs on every startup
    // rather than behind a "migration done" flag: a row still unpriced today is filled by
    // whichever future release adds that price. Placed after the startup archival and both
    // migration merges so anything they just wrote is covered in this same session.
    const backfilledCostRows = dailyStore.backfillMissingCosts(pricingStore.getCustom());
    if (backfilledCostRows > 0) {
        log(`Cost backfill: re-priced ${backfilledCostRows} archived per-model row(s) that had no cost`);
    }

    // Restore daily archival date key
    lastArchivalDateKey = durableGlobalState.get<string>('lastArchivalDateKey', '');

    // Restore cached user status from globalState for instant tooltip display
    const savedConfigs = durableGlobalState.get<import('./models').ModelConfig[]>('cachedModelConfigs', []);
    const savedPlan = durableGlobalState.get<string>('cachedPlanName', '');
    const savedTier = durableGlobalState.get<string>('cachedTierName', '');
    if (savedConfigs && savedConfigs.length > 0) {
        // Seed the label table from the last known good configs so that everything running before the
        // first successful LS fetch (ledger restore, GM summary repair, the status bar) resolves model
        // names instead of writing raw placeholder strings into persisted keys. The live fetch below
        // overwrites this as soon as it lands.
        updateModelDisplayNames(savedConfigs);
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
        vscode.commands.registerCommand(MONITOR_COMMAND, (destination: unknown) => {
            const initialTab = destination === 'models' || destination === 'settings' || destination === 'gmdata' || destination === 'pricing'
                ? destination
                : 'overview';
            showMonitorPanel(makePanelPayload({ context, initialTab }));
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.refresh', () => {
            log('Manual refresh triggered');
            statusBar.refreshFromConfig();
            cachedLsInfo = null;
            invalidateLiveModelMetadata();
            consecutiveFailures = 0;
            currentIntervalMs = baseIntervalMs;
            restartPolling();
            pollContextUsage(true);
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.switchLanguage', () => {
            showLanguagePicker(context, durableGlobalState).then(async () => {
                await flushDurableState();
                // Rebuild statusBar and WebView to reflect new language immediately
                statusBar.refreshFromConfig();
                refreshMonitorPanelLanguage();
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

    // Listen for config changes (and mirror shared v1.17.6 settings into DurableState for App ↔ IDE sync)
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
                statusBar.refreshFromConfig();
                if (isMonitorPanelVisible()) {
                    updateMonitorPanel(makePanelPayload());
                    syncMonitorPanelSettings();
                }
                log('Status bar display preferences updated');
            }
            if (e.affectsConfiguration('window.zoomLevel')) {
                statusBar.refreshFromConfig();
                log('Window zoom updated — status bar tooltip re-rendered');
            }
            if (e.affectsConfiguration('antigravityContextMonitor.showModelInternalId')) {
                const newConfig = vscode.workspace.getConfiguration('antigravityContextMonitor');
                setShowModelShortId(newConfig.get<boolean>('showModelInternalId', false));
                log('Model internal ID display setting updated');
            }

            // Mirror any affected shared setting to DurableState (guarded against self-triggered loop)
            if (pendingConfigSyncCount === 0 && e.affectsConfiguration('antigravityContextMonitor')) {
                const cfgNow = vscode.workspace.getConfiguration('antigravityContextMonitor');
                const patch: Partial<AppSettings> = {};
                let anyChanged = false;
                let orchModeChanged = false;
                let retentionChanged = false;

                for (const { vscodeKey, appKey } of VSCODE_TO_APP_SETTING_MAP) {
                    if (!e.affectsConfiguration(`antigravityContextMonitor.${vscodeKey}`)) { continue; }
                    const rawVal = cfgNow.get(vscodeKey);
                    const normPatch = normalizeAppSettings({ ...sharedAppSettings, [appKey]: rawVal });
                    const normalizedVal = normPatch[appKey];
                    if (sharedAppSettings[appKey] !== normalizedVal) {
                        (patch as Record<string, unknown>)[appKey] = normalizedVal;
                        anyChanged = true;
                        if (appKey === 'orchestratorPricingMode') { orchModeChanged = true; }
                        if (appKey === 'calendarRetentionDays') { retentionChanged = true; }
                    }
                }

                let planChanged = false;
                if (e.affectsConfiguration('antigravityContextMonitor.subscriptionPlan')) {
                    const nextPlan = inferIdeSubscriptionPlan(cfgNow.get<string>('subscriptionPlan', 'none'), patch.subscriptionMonthlyFee ?? sharedAppSettings.subscriptionMonthlyFee);
                    if (nextPlan !== sharedSubscriptionPlan) {
                        sharedSubscriptionPlan = nextPlan;
                        planChanged = true;
                        if (nextPlan === 'none') {
                            patch.subscriptionMonthlyFee = null;
                            anyChanged = true;
                        } else if (nextPlan === 'google-ai-pro') {
                            patch.subscriptionMonthlyFee = 19.99;
                            patch.subscriptionCurrency = 'USD';
                            anyChanged = true;
                        } else if (nextPlan === 'google-ai-ultra') {
                            patch.subscriptionMonthlyFee = 249.99;
                            patch.subscriptionCurrency = 'USD';
                            anyChanged = true;
                        }
                    }
                }

                if (anyChanged || planChanged) {
                    if (orchModeChanged && patch.orchestratorPricingMode && pricingStore) {
                        void pricingStore.setOrchestratorPricingMode(patch.orchestratorPricingMode);
                    }
                    if (retentionChanged && typeof patch.calendarRetentionDays === 'number' && dailyStore) {
                        dailyStore.setMaxDays(patch.calendarRetentionDays);
                    }
                    sharedAppSettings = { ...sharedAppSettings, ...patch };
                    if (durableState) {
                        void durableState.updateAppSettings(patch).then(async (updated) => {
                            sharedAppSettings = updated;
                            lastSyncedDiskAppSettings = { ...updated };
                            if (planChanged && durableFileGlobalState) {
                                await durableFileGlobalState.update('subscriptionPlan', sharedSubscriptionPlan);
                            }
                            await durableState.flush();
                        });
                    }
                    syncStatusBarTelemetry(true);
                    if (isMonitorPanelVisible()) {
                        updateMonitorPanel(makePanelPayload());
                        syncMonitorPanelSettings();
                    }
                }
            }
        }),
        // ─── Workspace Switch Detection ─────────────────────────────────────
        // When workspace folders change (open different project, add/remove folder),
        // the cached LS and tracked cascade may be stale. Force full re-discovery
        // so trajectories are re-filtered for the new workspace URI.
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            log('Workspace folders changed — forcing LS re-discovery');
            cachedLsInfo = null;
            invalidateLiveModelMetadata();
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
    triggerIdeBackgroundUpdateCheck();
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export async function deactivate(): Promise<void> {
    disposed = true;
    hasHydratedSharedSettings = false;
    resetImageWorkflowCache();
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = undefined;
    }
    abortController.abort();
    // Persist activity & GM data on deactivate
    const pendingUpdates: Array<PromiseLike<unknown>> = [];
    if (activityTracker && durableGlobalState) {
        pendingUpdates.push(durableGlobalState.update('activityTrackerState', activityTracker.serialize()));
    }
    if (gmTracker && durableGlobalState) {
        pendingUpdates.push(durableGlobalState.update('gmTrackerState', gmTracker.serialize()));
    }
    if (durableState) {
        await durableState.flush();
    }
    if (pendingUpdates.length > 0) {
        await Promise.allSettled(pendingUpdates);
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
        showSpeed: cfg.get<boolean>('statusBar.showSpeed', false),
        showCacheHit: cfg.get<boolean>('statusBar.showCacheHit', false),
        showSessionCost: cfg.get<boolean>('statusBar.showSessionCost', false),
    });
    statusBar.setBillingDay(billingDaysMap[currentAccountEmail] ?? 0);
}

/**
 * Push live account-filtered GM telemetry into StatusBarManager.
 * Pass `activeCascadeOverride = null` when idle/no-conversation to fall back to session scope.
 */
function syncStatusBarTelemetry(refresh = false, activeCascadeOverride?: string | null): void {
    if (typeof statusBar === 'undefined' || typeof gmTracker === 'undefined') { return; }
    const summary = gmTracker.getUiSummary();
    const activeCascadeId = activeCascadeOverride === null
        ? undefined
        : (activeCascadeOverride ?? currentUsage?.cascadeId ?? trackedCascadeId ?? undefined);
    const customPricing = pricingStore?.getCustom();
    statusBar.setTelemetry(summary, activeCascadeId, customPricing);
    const costs = computeLiveCostSnapshot(summary, activeCascadeId);
    statusBar.setCostSnapshot({
        todayCostUsd: costs.todayCostUsd > 0 ? costs.todayCostUsd : null,
        todayHasUnpriced: costs.todayHasUnpriced,
        sessionCostUsd: costs.sessionCostUsd > 0 ? costs.sessionCostUsd : null,
        sessionHasUnpriced: costs.sessionHasUnpriced,
    });
    if (refresh) {
        statusBar.refreshFromConfig();
    }
}

/** Recompute and re-render status bar telemetry (e.g. after custom pricing edits). */
export function refreshStatusBarTelemetry(): void {
    syncStatusBarTelemetry(true);
}

/**
 * Push current account's total AI credits to the status bar.
 * Passes `null` when credits are unknown/unreported so the UI never fabricates `0`.
 */
function updateStatusBarCredits(userInfo: UserStatusInfo | null): void {
    statusBar.setCredits(aiCreditTotal(userInfo?.availableCredits || []));
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

/** Fill missing provider usage with the GM pre-request context estimate. */
export function applyGMContextToUsage(usage: ContextUsage, gmContextUsed: number): boolean {
    if (usage.lastModelUsage || !Number.isSafeInteger(gmContextUsed)
        || gmContextUsed <= 0 || gmContextUsed === usage.contextUsed) { return false; }
    usage.contextUsed = gmContextUsed;
    // The source field is estimatedTokensUsed, not a measured provider token count.
    usage.isEstimated = true;
    usage.usagePercent = usage.contextLimit > 0
        ? (gmContextUsed / usage.contextLimit) * 100 : 0;
    return true;
}

// ─── Polling Logic ────────────────────────────────────────────────────────────

async function pollContextUsage(isManualRefresh = false): Promise<void> {
    if (isPolling) {
        if (isManualRefresh && typeof statusBar !== 'undefined') {
            statusBar.showInitializing();
        }
        return;
    }
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
            invalidateLiveModelMetadata();
            lsInfo = null;
            trackedCascadeId = null;
            consecutiveIdlePolls = 0;
            stalenessConfirmedIdle = false;
        }
        lastPolledWorkspaceUri = normalizedWs;

        // Hot-reload shared DurableState changes written externally (e.g. by App Sidecar)
        syncFromDurableStateIfChanged(false);

        // 午夜归档必须在本轮轮询前半段执行：
        // 1. 不能被“无会话 / 无活跃对话”的提前 return 跳过
        // 2. 新一天的 GM / DailyLedger 记录必须建立在已 rollover 的干净状态上
        performDailyArchival();

        // 2. Discover LS (with caching + fast hint-change reconnect + periodic revalidation)
        if (lsInfo) {
            const activeHint = getActiveBackendHint();
            if (!doesConnectionMatchActiveHint(lsInfo, activeHint)) {
                log('Active IDE backend connection changed — forcing LS re-discovery');
                cachedLsInfo = null;
                lsInfo = null;
                invalidateLiveModelMetadata();
                lsRevalidationCounter = 0;
                consecutiveIdlePolls = 0;
                stalenessConfirmedIdle = false;
            }
        }
        if (!lsInfo) {
            log('Discovering language server...');
            if (isManualRefresh || statusBar.monitorStatus.state !== 'disconnected') {
                statusBar.showInitializing();
            }
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal, log);
            cachedLsInfo = lsInfo;
            lsRevalidationCounter = 0;
            consecutiveIdlePolls = 0;

            if (!lsInfo) {
                handleLsFailure('LS not found', true);
                return;
            }
            resetBackoff();
            log(`LS found: pid=${lsInfo.pid} port=${lsInfo.port}, tls=${lsInfo.useTls}${lsInfo.hostname ? `, host=${lsInfo.hostname}` : ''}`);

            // Dynamically update model display names from GetUserStatus
            try {
                const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                userStatusStaleGuard.recordSuccess(fullStatus);
                statusBar.setStaleState(getCurrentStaleState());
                if (applyLiveModelStatus(fullStatus)) {
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
                    log(`User plan: ${fullStatus.userInfo.planName}`);
                    updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
                }
                triggerLiveAuxiliaryMetadataRefresh(lsInfo, cachedModelConfigs, modelMetadataGeneration, abortController.signal);
            } catch (statusErr) {
                userStatusStaleGuard.recordFailure(statusErr);
                statusBar.setStaleState(getCurrentStaleState());
            }
        } else {
            // ─── Periodic LS Connection Revalidation ─────────────────────────
            // BUG FIX: When Antigravity updates or restarts, a new LS may start
            // while the old one is still alive or port/token/TLS changed (even
            // when pid=0 via direct hint). Compare full connection identity.
            lsRevalidationCounter++;
            if (lsRevalidationCounter >= LS_REVALIDATION_INTERVAL) {
                lsRevalidationCounter = 0;
                try {
                    const freshLs = await discoverLanguageServer(workspaceUri, abortController.signal, log);
                    if (freshLs && !isSameBackendConnection(freshLs, lsInfo)) {
                        log(`⚠ LS connection changed: pid=${lsInfo.pid}→${freshLs.pid} port=${lsInfo.port}→${freshLs.port} tls=${lsInfo.useTls}→${freshLs.useTls}. Reconnecting to new LS.`);
                        lsInfo = freshLs;
                        cachedLsInfo = freshLs;
                        invalidateLiveModelMetadata();
                        consecutiveIdlePolls = 0;
                        // Re-fetch user status from new LS
                        try {
                            const fullStatus = await fetchFullUserStatus(lsInfo, abortController.signal);
                            applyLiveModelStatus(fullStatus);
                            if (fullStatus.userInfo) {
                                cachedUserInfo = fullStatus.userInfo;
                                updateStatusBarCredits(fullStatus.userInfo);
                                statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                                durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                                durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                                durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                                updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
                            }
                            triggerLiveAuxiliaryMetadataRefresh(lsInfo, cachedModelConfigs, modelMetadataGeneration, abortController.signal);
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
                    userStatusStaleGuard.recordSuccess(fullStatus);
                    statusBar.setStaleState(getCurrentStaleState());
                    applyLiveModelStatus(fullStatus);
                    if (fullStatus.userInfo) {
                        cachedUserInfo = fullStatus.userInfo;
                        updateStatusBarCredits(fullStatus.userInfo);
                        statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
                        durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
                        durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
                        durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
                        updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
                    }
                    triggerLiveAuxiliaryMetadataRefresh(lsInfo, cachedModelConfigs, modelMetadataGeneration, abortController.signal);
                    log('Refreshed user status (periodic)');
                } catch (statusErr) {
                    userStatusStaleGuard.recordFailure(statusErr);
                    statusBar.setStaleState(getCurrentStaleState());
                }
            }
        }

        // Dynamically override context limits once per LS connection, with BOUNDED retry on failure.
        // A failed sync must be retried — a transient empty response used to latch permanently and
        // leave every model on its static fallback for the whole session. But it must not retry
        // forever either: an account that genuinely has no checkpointer experiments would otherwise
        // issue this RPC on every poll for as long as the window stays open. Give up after a handful
        // of attempts and let a reconnect (which resets the counter below) be the way back in.
        if (lsInfo && !hasSyncedCheckpointer && !isSyncingCheckpointer
            && checkpointerSyncAttempts < MAX_CHECKPOINTER_SYNC_ATTEMPTS) {
            isSyncingCheckpointer = true;
            checkpointerSyncAttempts++;
            const attemptNo = checkpointerSyncAttempts;
            const generation = modelMetadataGeneration;
            fetchAndOverrideCheckpointerLimits(lsInfo, log, () => generation === modelMetadataGeneration && !disposed).then((success) => {
                if (generation !== modelMetadataGeneration) { return; }
                isSyncingCheckpointer = false;
                if (success) {
                    hasSyncedCheckpointer = true;
                } else if (attemptNo >= MAX_CHECKPOINTER_SYNC_ATTEMPTS) {
                    log(`[Checkpointer Sync] Giving up after ${attemptNo} attempts — staying on the built-in static limits. A reconnect will retry.`);
                }
            }).catch(() => {
                if (generation === modelMetadataGeneration) { isSyncingCheckpointer = false; }
            });
        }

        // 3. Get all trajectories
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
            trajectoriesStaleGuard.recordSuccess(trajectories);
            statusBar.setStaleState(getCurrentStaleState());
        } catch (err) {
            log(`RPC failed, retrying discovery: ${err}`);
            trajectoriesStaleGuard.recordFailure(err);
            statusBar.setStaleState(getCurrentStaleState());
            invalidateLiveModelMetadata();
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal, log);
            cachedLsInfo = lsInfo;
            if (!lsInfo) {
                handleLsFailure('LS connection lost', true);
                return;
            }
            resetBackoff();
            trajectories = await getAllTrajectories(lsInfo, abortController.signal);
            trajectoriesStaleGuard.recordSuccess(trajectories);
            statusBar.setStaleState(getCurrentStaleState());
        }

        resetBackoff();
        lastTrajectories = trajectories;

        if (trajectories.length === 0) {
            const noConvLimit = getContextLimit(lastKnownModel);
            const noConvLimitStr = formatContextLimit(noConvLimit);
            syncStatusBarTelemetry(false, null);
            statusBar.showNoConversation(noConvLimitStr, lastKnownModel);
            currentUsage = null;
            clearActiveContextTelemetry();
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
                    if (freshLs && !isSameBackendConnection(freshLs, lsInfo)) {
                        log(`⚠ Stale LS confirmed: pid=${lsInfo.pid}→${freshLs.pid} port=${lsInfo.port}→${freshLs.port}. Reconnecting.`);
                        lsInfo = freshLs;
                        cachedLsInfo = freshLs;
                        invalidateLiveModelMetadata();
                        lsRevalidationCounter = 0;
                        stalenessConfirmedIdle = false;
                        // Re-fetch trajectories from the new LS
                        trajectories = await getAllTrajectories(lsInfo, abortController.signal);
                        lastTrajectories = trajectories;
                    } else if (freshLs) {
                        log('LS connection unchanged — staleness was a false alarm (cascade genuinely IDLE)');
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

        // --- v1.17.5 Override: Manual Conversation Pin or Lock to Main Agent ---
        if (pinnedConversationId || lockToMainAgent) {
            const resolved = resolveTargetConversation({
                trajectories,
                pinnedId: pinnedConversationId,
                lockToMainAgent,
                lockedMainId: lockedMainCascadeId,
                currentActiveId: newCandidateId || trackedCascadeId,
                workspaceUris: workspaceUri ? [workspaceUri] : [],
            });
            if (resolved.pinnedFallback && pinnedConversationId) {
                log(`Pinned conversation ${pinnedConversationId.substring(0, 8)} no longer exists — returning to auto-follow`);
                pinnedConversationId = null;
                if (durableFileWorkspaceState) {
                    void durableFileWorkspaceState.update('pinnedConversationId', null);
                }
            }
            lockedMainCascadeId = resolved.lockedMainId;
            if (resolved.cascadeId) {
                newCandidateId = resolved.cascadeId;
                selectionReason = resolved.reason;
            }
        }

        // Update tracked cascade
        if (newCandidateId) {
            if (trackedCascadeId !== newCandidateId) {
                log(`Switched cascade: ${trackedCascadeId?.substring(0, 8) || 'none'} → ${newCandidateId.substring(0, 8)} (${selectionReason})`);
                trackedCascadeId = newCandidateId;
                consecutiveIdlePolls = 0;
                stalenessConfirmedIdle = false;
                clearActiveContextTelemetry();
            } else if (selectionReason) {
                log(`Refreshing cascade ${trackedCascadeId?.substring(0, 8)} (${selectionReason})`);
            }
        } else if (trackedCascadeId) {
            const currentTracked = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId)
                || trajectories.find(t => t.cascadeId === trackedCascadeId);
            if (!currentTracked) {
                log(`Tracked cascade ${trackedCascadeId.substring(0, 8)} no longer in any list, clearing`);
                trackedCascadeId = null;
                clearActiveContextTelemetry();
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
            syncStatusBarTelemetry(false, null);
            statusBar.showIdle(idleLimitStr, lastKnownModel);
            currentUsage = null;
            clearActiveContextTelemetry();
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
            currentUsage = await refreshWorkflowImageUsage(lsInfo, rehydrateUsageForDisplay(currentUsage), abortController.signal);
        } else if (hasSameUsageInputs(persistedUsage, activeTrajectory)) {
            currentUsage = await refreshWorkflowImageUsage(lsInfo, rehydrateUsageForDisplay(persistedUsage), abortController.signal);
        } else {
            currentUsage = await getContextUsage(lsInfo, activeTrajectory, undefined, abortController.signal);
        }
        log(`  → contextUsed=${currentUsage.contextUsed} model=${currentUsage.model} steps=${currentUsage.stepCount} estimated=${currentUsage.isEstimated} ckpt_in=${currentUsage.lastModelUsage?.inputTokens ?? 'none'} ckpt_out=${currentUsage.lastModelUsage?.outputTokens ?? 'none'} estDelta=${currentUsage.estimatedDeltaSinceCheckpoint}`);

        // ── Pre-enhance with cached GM data to prevent step→GM flickering ──
        if (lastGMSummary && trackedCascadeId) {
            applyGMContextToUsage(currentUsage, getLatestGMContextUsed(lastGMSummary, trackedCascadeId));
        }

        // Track the model for idle-state display
        if (currentUsage.model) {
            lastKnownModel = currentUsage.model;
            durableWorkspaceState.update('lastKnownModel', lastKnownModel);
        }

        // ─── Compression Detection ─────────────────────────────────────────
        // Run before statusBar.update() so compression flags land in a single render pass.
        const previousObservation = previousContextObservations.get(currentUsage.cascadeId);
        const prevUsed = previousObservation?.contextUsed;
        const prevSteps = previousStepCounts.get(activeTrajectory.cascadeId);
        const isUndo = prevSteps !== undefined && activeTrajectory.stepCount < prevSteps;

        if (!currentUsage.compressionDetected) {
            const drop = measuredContextDrop(previousObservation, currentUsage, isUndo);
            if (drop > 0) {
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
        previousContextObservations.set(currentUsage.cascadeId, {
            lastModelUsage: currentUsage.lastModelUsage,
            contextUsed: currentUsage.contextUsed, isEstimated: currentUsage.isEstimated,
            model: currentUsage.model, tokenUsageSource: currentUsage.tokenUsageSource,
        });

        syncStatusBarTelemetry(false, currentUsage.cascadeId);
        statusBar.update(currentUsage);

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
                return refreshWorkflowImageUsage(lsInfo!, rehydrateUsageForDisplay(cachedUsage), abortController.signal);
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
                const hadUiSummary = gmTracker.getUiSummary() !== null;
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
                        const added = dailyLedger.recordCalls(newEntries, 'ide');
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
                    const reconciled = dailyLedger.reconcileRecordedCalls(gmTracker.getLedgerReconciliationEntries());
                    if (reconciled > 0) {
                        // This may repair old unpriced calls even when the normal
                        // write-once cursor produces no new entries this poll.
                        durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                        log(`[DailyLedger] reconciled metadata/pricing for ${reconciled} recorded calls without adding calls`);
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
                            const resetMs = parsePositivePoolResetMs(pool.resetTime);
                            if (resetMs === null || resetMs > nowMs) { continue; }


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
                let gmEnhancedStatusBar = false;
                if (lastGMSummary) {
                    timelineChanged = activityTracker.injectGMData(lastGMSummary);

                    // ── Enhance status bar with fresh GM data (new calls since last poll) ──
                    if (currentUsage && trackedCascadeId) {
                        const gmCtx = getLatestGMContextUsed(lastGMSummary, trackedCascadeId);
                        const oldUsed = currentUsage.contextUsed;
                        if (applyGMContextToUsage(currentUsage, gmCtx)) {
                            gmEnhancedStatusBar = true;
                            log(`Status bar enhanced with GM precision: contextUsed ${oldUsed} → ${gmCtx}`);
                        }
                    }
                }
                syncStatusBarTelemetry(false, currentUsage?.cascadeId || trackedCascadeId || undefined);
                if (gmEnhancedStatusBar && currentUsage) {
                    statusBar.update(currentUsage);
                } else if (gmChanged || timelineChanged || (!hadUiSummary && gmTracker.getUiSummary() !== null)) {
                    statusBar.refreshFromConfig();
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

        // 6d. Compute v1.17.5 Context Composition Breakdown & Turn Diagnostics for active conversation
        if (!activeTrajectory || !currentUsage) {
            clearActiveContextTelemetry();
        } else if (lsInfo && isMonitorPanelVisible()) {
            const breakdownKey = `${activeTrajectory.cascadeId}:${activeTrajectory.stepCount}:${activeTrajectory.lastModifiedTime}:${currentUsage.contextUsed}:${currentUsage.contextLimit}`;
            if (breakdownKey !== lastContextBreakdownKey) {
                try {
                    const rawMeta = await fetchTrajectoryGeneratorMetadata(lsInfo, activeTrajectory.cascadeId, abortController.signal);
                    const hasPromptSections = rawMeta.some(entry => {
                        const cm = entry?.chatModel as { promptSections?: unknown[] } | undefined;
                        return Array.isArray(cm?.promptSections) && cm.promptSections.length > 0;
                    });
                    let rawSteps: Array<Record<string, unknown>> | undefined;
                    if (!hasPromptSections && activeTrajectory.stepCount > 0) {
                        const fetched = await fetchTrajectorySteps(lsInfo, activeTrajectory.cascadeId, activeTrajectory.stepCount, abortController.signal);
                        rawSteps = fetched.steps;
                    }
                    const prevMaxSteps = maxObservedStepCounts.get(activeTrajectory.cascadeId);
                    const prevUsedTokens = previousBreakdownUsedTokens.get(activeTrajectory.cascadeId);
                    lastContextBreakdown = parseContextBreakdown({
                        generatorMetadata: rawMeta,
                        steps: rawSteps,
                        currentStepCount: activeTrajectory.stepCount,
                        previousMaxStepCount: prevMaxSteps,
                        previousUsedTokens: prevUsedTokens,
                        model: currentUsage.model,
                        modelDisplayName: currentUsage.modelDisplayName,
                        effectiveBudgetTokens: currentUsage.contextLimit,
                    });
                    maxObservedStepCounts.set(
                        activeTrajectory.cascadeId,
                        Math.max(prevMaxSteps ?? 0, activeTrajectory.stepCount),
                    );
                    if (lastContextBreakdown.usedTokens > 0) {
                        previousBreakdownUsedTokens.set(activeTrajectory.cascadeId, lastContextBreakdown.usedTokens);
                    }
                    lastTurnDiagnostics = rawMeta.length > 0 ? analyzeTurnDiagnostics(rawMeta) : null;
                    lastContextBreakdownKey = breakdownKey;
                } catch (bdErr) {
                    log(`Context breakdown fetch error: ${bdErr}`);
                }
            }
        }

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
        invalidateLiveModelMetadata();
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
    trajectoriesStaleGuard.recordFailure(message);
    statusBar.setStaleState(getCurrentStaleState());
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
    for (const id of previousContextObservations.keys()) {
        if (!activeIds.has(id)) {
            previousContextObservations.delete(id);
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
    // Suppress Google quota pool alert popups when active session uses a custom / BYOK model
    if (isCustomModel(currentUsage?.model, currentUsage?.modelDisplayName)) { return; }
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const thresholdPct = cfg.get<number>('quotaNotificationThreshold', 20);
    if (thresholdPct <= 0) { return; } // disabled

    const thresholdFrac = thresholdPct / 100;

    // Group models by stable quota pool and merge effort levels into base-model names.
    const mergedLabelsByPool = new Map<string, string[]>();
    for (const quotaGroup of groupModelQuotas(configs)) {
        const key = quotaGroup.pool || quotaGroup.key;
        const labels = quotaGroup.members.map(m => m.label).filter(Boolean);
        if (labels.length > 0) {
            mergedLabelsByPool.set(key, labels);
        }
    }

    const groups = new Map<string, { labels: string[]; minFraction: number }>();
    for (const group of groupModelConfigsByQuotaPool(configs)) {
        const displayLabels = mergedLabelsByPool.get(group.key) || group.labels;
        groups.set(group.key, { labels: displayLabels, minFraction: group.minFraction });
    }

    for (const [groupKey, group] of groups) {
        if (group.minFraction <= thresholdFrac) {
            // Only notify once per group per threshold crossing
            if (!quotaNotifiedModels.has(groupKey)) {
                quotaNotifiedModels.add(groupKey);
                const pct = (group.minFraction * 100).toFixed(1);
                // Cap the model list the same way the reset notification does (see the pool
                // notification above). The shared gemini pool now spans three Flash generations
                // plus Pro — joining all of them produces a warning so long that VS Code truncates
                // it before the percentage, which is the only number that matters here.
                const shownLabels = group.labels.slice(0, 3).join(', ');
                const names = group.labels.length > 3
                    ? `${shownLabels} +${group.labels.length - 3}`
                    : shownLabels;
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
            const resetMs = parsePositivePoolResetMs(pool.resetTime);
            if (resetMs === null) { continue; }

            const diffMs = resetMs - nowMs;
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
            const cutoffTime = resetMs;
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
                syncStatusBarTelemetry(true);
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
    if (!outputChannel) { return; }
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

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
    readUnlistedMemberStepCount,
    requireGeneratorMetadata,
    getContextUsage,
    refreshWorkflowImageUsage,
    resetImageWorkflowCache,
    getContextLimit,
    normalizeModelDisplayName,
    fetchFullUserStatus,
    fetchOrchestratorSettings,
    fetchUserQuotaSummary,
    fetchTrajectoryGeneratorMetadataResult,
    fetchTrajectorySteps,
    updateModelDisplayNames,
    ContextUsage,
    TrajectorySummary,
    UserStatusInfo,
    type FetchTrajectoryGeneratorMetadataResult,
    type FetchTrajectoryStepsResult,
    type FullUserStatusFetchResult,
} from './tracker';
import {
    applyModelCatalogSync,
    clearLiveModelSyncProvenance,
    getQuotaPoolKey,
    resolveModelContextLimits,
    resolveModelId,
    setAvailableImageModelIds,
    setShowModelShortId,
    type FullUserStatus,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
} from './models';
import { rpcCall } from './rpc-client';
import { StatusBarManager, formatContextLimit, setTooltipDiagLogger } from './statusbar';
import {
    getIdeLocaleSources,
    getLanguage,
    initI18nForIde,
    initI18nFromState,
    setLanguageToState,
    showLanguagePicker,
    tBi,
} from './i18n';
import { isLanguagePreference, setLanguagePreferenceInMemory } from './i18n-core';
import { advanceBranchStepPeak, parseContextBreakdown, type BranchStepPeakState, type ContextBreakdownSnapshot } from './context-breakdown';
import { analyzeTurnDiagnostics, type TurnDiagnosticsSummary } from './turn-diagnostics';
import {
    QuotaRunwayTracker,
    StaleCacheGuard,
    isCustomModel,
    type QuotaRunwayEstimate,
    type SerializedQuotaRunwayState,
    type WeeklyQuotaRunwayEstimate,
    type WeeklyQuotaSeriesState,
} from './quota-runway';
import {
    PromptCacheTtlTracker,
    computeWeightedSpeedMetric,
    type PromptCacheTtlEvaluation,
    type WeightedSpeedMetricSummary,
} from './telemetry-metrics';
import {
    advanceWindowBackendEpoch,
    buildConversationOptions,
    clearInspect,
    createWindowSelectionState,
    disableLockToMainAgent,
    enableLockToMainAgent,
    filterTrajectoriesByWorkspaces,
    inspectMember,
    isSubagentTrajectory,
    normalizeWorkspaceUri,
    resolveIdeAutoFollowConversation,
    retargetLockedRoot,
    selectConversation,
    type ConversationOption,
    type NormalizeWorkspaceUriOptions,
    type WindowSelectionState,
} from './conversation-selector';
import type { MonitorStaleState } from './webview-overview-tab';
import { aiCreditTotal, currentAICredits } from './account-credits';
import { groupModelQuotas } from './model-quota';
import { MONITOR_COMMAND } from './monitor-overview';
import {
    OPEN_VSX_EXTENSION_URL,
    registerIdePanelHostBridge,
    type PanelPayload,
} from './ide-panel-types';
export { OPEN_VSX_EXTENSION_URL };
import {
    showMonitorPanel,
    refreshMonitorPanelLanguage,
    updateMonitorPanel,
    syncMonitorPanelSettings,
    isMonitorPanelVisible,
    setPanelDurableState,
    LARGE_STATE_FILE_WARN_BYTES,
} from './webview-panel';
import { ActivityTracker, ActivityTrackerState } from './activity-tracker';
import { SwarmMemberInventory } from './core/swarm-member-inventory';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, MAX_DISCOVERY_BACKOFF_MS, COMPRESSION_PERSIST_POLLS } from './constants';
import { QuotaTracker } from './quota-tracker';
import { GMTracker, GMSummary, GMTrackerState, slimSummaryForPersistence } from './gm-tracker';
import { PricingStore, calculateLedgerModelCosts, costFromTokens, findPricingForDate, normalizeOrchestratorPricingMode, selectPricingModel, type OrchestratorPricingMode } from './pricing-store';
import { DailyStore, type DailyStoreState } from './daily-store';
import { MonitorStore } from './monitor-store';
import {
    calculateSettledEntryCosts,
    flushLateDaysToDailyStoreAsync,
    performDailyArchivalAsync,
    type DailyArchivalContext,
    type DailyArchivalResult,
} from './daily-archival';
import {
    DEFAULT_APP_SETTINGS,
    DurableState,
    StateBucket,
    isUpdateAvailableForVersion,
    normalizeAppSettings,
    type AppSettings,
    type DurableStateCommitReceipt,
    type LastUpdateCheckRecord,
} from './durable-state';
import { extractLegacyDataAsync, runLegacyMigrationOnceAsync } from './legacy-migration';
import { mergeModelDNAState, PersistedModelDNA, restoreModelDNAState, serializeModelDNAState, type ModelDNAStoreState } from './model-dna-store';
import type { StorageDiagnostics, UpdateStatusView } from './webview-settings-tab';
import type { AccountSnapshot } from './activity-panel';
import { isBillingDay, isBillingDaySetting } from './billing-day';
import {
    comparePoolResetTimes,
    expandModelIdsToPool,
    groupModelConfigsByQuotaPool,
    parsePositivePoolResetMs,
    type ModelQuotaPoolGroup,
} from './pool-utils';
export {
    comparePoolResetTimes,
    groupModelConfigsByQuotaPool,
    parsePositivePoolResetMs,
    type ModelQuotaPoolGroup,
};
import { DailyLedger, toLocalDateKey, type DailyLedgerState } from './daily-ledger';
import {
    CliUsageScanner,
    type CliDailyUsageRecord,
} from './cli-usage-scanner';
import { checkForUpdates } from './app/plugin-updater';
import {
    CompactionRecoveryBriefTracker,
    buildRedactedDiagnostics,
    buildSettingsBackupJson,
    combineSerializedRunwayWithWeekly,
    enrichLedgerEntriesForIngestion,
    isCdpOverlayFontSize,
    normalizeCdpOverlayFontSize,
    parseAndValidateSettingsBackup,
    registerIdeV118HostHooks,
    type CdpOverlayFontSizePreset,
    type CompactionRecoveryBrief,
    type UpdateCheckResult,
} from './app/sidecar-types';
import { WEBVIEW_CLIENT_BUILD_ID } from './client/generated/client-bundles.generated';
import { parseTooltipDensity } from './tooltip-budget';
import { resolveRuntimeVersion } from './core/version';
import {
    getLatestGMContextUsedForCascade,
    type GMCompactionBoundary,
} from './core/gm-context-fallback';
import {
    bindCustomFxRate,
    switchDisplayCurrency,
} from './core/currency';
import {
    SUBSCRIPTION_PLAN_PRESETS,
    normalizeSubscriptionPlanId,
    validateCustomFxRate,
    validateDisplayCurrency,
    validateOrchestratorPricingMode,
    validateSubscriptionCurrency,
    validateSubscriptionMonthlyFee,
    validateSubscriptionPlan,
    type SubscriptionPlanPresetId,
} from './core/pricing-validation';
import {
    DiagnosticAliasMap,
    buildPublishedMonitorObservation,
    type ContextLimitProvenance as ObservationLimitProvenance,
    type ContextTokenSource,
    type ObservationSubjectKind,
    type PublishedMonitorObservation,
} from './core/context-display';
import type { ContextLimitProvenance as CatalogLimitProvenance } from './core/model-catalog-sync';
import {
    DEFAULT_SWARM_POLL_BUDGET,
    withTrajectoryPollBudget, withTrajectoryRequestShare, withoutTrajectoryPollBudget,
    priceSwarmGroup,
    orderTelemetryPoll,
    SwarmPollScheduler,
    SwarmTopologyRegistry,
    type BrainRootScopeOptions,
    type RpcTopologyLinkProjection,
    type SwarmTopologySnapshot,
} from './core/swarm-registry';

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
/** Timestamp when `trackedCascadeId` became active (anchors brand-new 0-step chats). */
let trackedCascadeSinceMs: number | undefined;
/** Monotonic backend generation incremented on reconnect / metadata invalidation. */
let backendEpoch = 0;
/** Flag set when workspace folders change or a manual refresh arrives mid-poll so no change is dropped. */
let repollNeeded = false;
let repollForceManual = false;
/** Tracks whether the user explicitly modified displayLanguage during async activation. */
let displayLanguageModifiedByUser = false;
/** In-flight startup archival promise (awaited before the first poll cycle). */
let startupArchivalPromise: Promise<void> | null = null;
/** In-flight non-blocking legacy migration promise (for deterministic test awaiting). */
let legacyMigrationPromise: Promise<unknown> | null = null;
/** Set of explicitly linked child/subagent cascade IDs observed in this session. */
const knownSubagentCascadeIds = new Set<string>();

/** Mark displayLanguage as explicitly modified by the user during the current activation. */
export function markDisplayLanguageModified(): void {
    displayLanguageModifiedByUser = true;
}

/** Return the in-flight async legacy migration promise launched during activate(), if any. */
export function getLegacyMigrationPromise(): Promise<unknown> | null {
    return legacyMigrationPromise;
}

/** Inspect whether a follow-up repoll is queued (e.g. after workspace folder change mid-poll). */
export function isRepollNeeded(): boolean {
    return repollNeeded;
}

// ─── Single-Poll RPC Deduplication Cache (PERF-02) ───────────────────────────

export interface PollRpcCacheKey {
    backendEpoch: number;
    authority: string;
    method: string;
    cascadeId: string;
    range: string;
    branchRevision: string;
}

export interface PollRpcCacheOptions<T> {
    /** Predicate deciding whether a fulfilled response may be cached for subsequent calls in the same poll. */
    shouldCache?: (value: T) => boolean;
}

/** Build a collision-free canonical wire-request key from all 6 required dimensions. */
export function buildPollRpcCacheKey(key: PollRpcCacheKey): string {
    return JSON.stringify([
        key.backendEpoch,
        key.authority,
        key.method,
        key.cascadeId,
        key.range,
        key.branchRevision,
    ]);
}

/** Build a secret-free authority string identifying the active LS endpoint. */
export function getLsAuthority(ls: Pick<LSInfo, 'hostname' | 'port' | 'useTls' | 'pid'>): string {
    const host = (ls.hostname || '127.0.0.1').trim().toLowerCase();
    return `${host}:${ls.port}:${ls.useTls ? 'tls' : 'http'}:pid=${ls.pid}`;
}

interface PollRpcInFlightEntry<T> {
    controller: AbortController;
    waiters: Set<{
        resolve: (value: T) => void;
        reject: (err: unknown) => void;
        cleanup: () => void;
    }>;
    settled: boolean;
}

/**
 * Single-poll wire-request deduplication cache keyed by
 * `{ backendEpoch, authority, method, cascadeId, range, branchRevision }`.
 *
 * Guarantees:
 * - Deduplicates ONLY equivalent wire requests sharing all 6 key fields.
 * - Single consumer cancellation rejects ONLY that consumer and NEVER aborts or
 *   poisons sibling consumers sharing the in-flight upstream RPC.
 * - Upstream is aborted ONLY when EVERY subscribed consumer cancels.
 * - Incomplete/gapped/failed responses (where `shouldCache(val) === false` or rejected)
 *   are NEVER cached for subsequent callers.
 */
export class PollRpcCache {
    private readonly _resolved = new Map<string, unknown>();
    private readonly _inFlight = new Map<string, PollRpcInFlightEntry<unknown>>();

    get size(): number {
        return this._resolved.size;
    }

    get inFlightCount(): number {
        return this._inFlight.size;
    }

    getOrFetch<T>(
        key: PollRpcCacheKey,
        fetcher: (upstreamSignal: AbortSignal) => Promise<T>,
        consumerSignal?: AbortSignal,
        options?: PollRpcCacheOptions<T>,
    ): Promise<T> {
        if (consumerSignal?.aborted) {
            return Promise.reject(new Error('RPC aborted'));
        }

        const cacheKey = buildPollRpcCacheKey(key);
        if (this._resolved.has(cacheKey)) {
            return Promise.resolve(this._resolved.get(cacheKey) as T);
        }

        let entry = this._inFlight.get(cacheKey) as PollRpcInFlightEntry<T> | undefined;
        let isStarter = false;
        if (!entry) {
            entry = {
                controller: new AbortController(),
                waiters: new Set(),
                settled: false,
            };
            this._inFlight.set(cacheKey, entry as PollRpcInFlightEntry<unknown>);
            isStarter = true;
        }

        const activeEntry = entry;
        const consumerPromise = new Promise<T>((resolve, reject) => {
            let done = false;
            const onAbort = () => {
                if (done) { return; }
                done = true;
                waiter.cleanup();
                activeEntry.waiters.delete(waiter);
                reject(new Error('RPC aborted'));
                // Abort upstream ONLY if every single consumer cancelled
                if (!activeEntry.settled && activeEntry.waiters.size === 0) {
                    activeEntry.settled = true;
                    if (this._inFlight.get(cacheKey) === (activeEntry as PollRpcInFlightEntry<unknown>)) {
                        this._inFlight.delete(cacheKey);
                    }
                    activeEntry.controller.abort();
                }
            };

            const waiter = {
                resolve: (value: T) => {
                    if (done) { return; }
                    done = true;
                    waiter.cleanup();
                    resolve(value);
                },
                reject: (err: unknown) => {
                    if (done) { return; }
                    done = true;
                    waiter.cleanup();
                    reject(err);
                },
                cleanup: () => {
                    if (consumerSignal) {
                        consumerSignal.removeEventListener('abort', onAbort);
                    }
                },
            };

            activeEntry.waiters.add(waiter);
            if (consumerSignal) {
                consumerSignal.addEventListener('abort', onAbort, { once: true });
            }
        });

        if (isStarter) {
            let upstreamPromise: Promise<T>;
            try {
                upstreamPromise = Promise.resolve(fetcher(activeEntry.controller.signal));
            } catch (syncErr) {
                upstreamPromise = Promise.reject(syncErr);
            }
            upstreamPromise.then(
                (value) => {
                    if (activeEntry.settled) { return; }
                    activeEntry.settled = true;
                    if (this._inFlight.get(cacheKey) === (activeEntry as PollRpcInFlightEntry<unknown>)) {
                        this._inFlight.delete(cacheKey);
                        const allowCache = options?.shouldCache ? options.shouldCache(value) : true;
                        if (allowCache) {
                            this._resolved.set(cacheKey, value);
                        }
                    }
                    const waiters = [...activeEntry.waiters];
                    activeEntry.waiters.clear();
                    for (const w of waiters) {
                        w.resolve(value);
                    }
                },
                (err) => {
                    if (activeEntry.settled) { return; }
                    activeEntry.settled = true;
                    if (this._inFlight.get(cacheKey) === (activeEntry as PollRpcInFlightEntry<unknown>)) {
                        this._inFlight.delete(cacheKey);
                    }
                    const waiters = [...activeEntry.waiters];
                    activeEntry.waiters.clear();
                    for (const w of waiters) {
                        w.reject(err);
                    }
                },
            );
        }

        return consumerPromise;
    }

    clear(): void {
        const entries = [...this._inFlight.values()];
        this._inFlight.clear();
        this._resolved.clear();
        for (const entry of entries) {
            if (!entry.settled) {
                entry.settled = true;
                entry.controller.abort();
                const waiters = [...entry.waiters];
                entry.waiters.clear();
                for (const w of waiters) {
                    w.reject(new Error('RPC aborted'));
                }
            }
        }
    }
}

// ─── v1.17.5 / v1.18 Telemetry, Runway, Stale Guard & 3-Field Selection State ─
let lockToMainAgent = false;
let pinnedConversationId: string | null = null;
let lockedMainCascadeId: string | null = null;
let windowId = 'ide-default';
let windowSelectionState: WindowSelectionState = createWindowSelectionState({
    backendEpoch,
    windowId,
});
let dataRevision = 0;
let lastPublishedObservation: PublishedMonitorObservation | null = null;
let swarmRegistry = new SwarmTopologyRegistry({ scope: resolveIdeBrainRootScope([]) });
const swarmMemberInventory = new SwarmMemberInventory();
let swarmRegistryScopeKey = '';
let swarmPollScheduler = new SwarmPollScheduler();
let telemetryPollTick = 0;
let lastSwarmTopology: SwarmTopologySnapshot | null = null;
const missingCascadeAbsenceCounts = new Map<string, number>();
const confirmedDeletedCascadeIds = new Set<string>();
const cascadeCompactionBoundaries = new Map<string, GMCompactionBoundary>();
let quotaRunwayTracker = new QuotaRunwayTracker();
let lastRunwayPersistMs = 0;
let runwayStateDirty = false;
let lastWeeklyQuotaRunways: Record<string, WeeklyQuotaRunwayEstimate> = {};
const promptCacheTtlTracker = new PromptCacheTtlTracker();
let lastRecordedCacheTtlCallKey = '';
let latestPromptCacheTtl: PromptCacheTtlEvaluation | null = null;
let latestSpeedMetric: WeightedSpeedMetricSummary | null = null;
const recoveryBriefTracker = new CompactionRecoveryBriefTracker();
let activeRecoveryBrief: CompactionRecoveryBrief | null = null;
const diagnosticAliasMap = new DiagnosticAliasMap();
let lastGmCallActivityMs = 0;
let sharedCdpOverlayFontSize: CdpOverlayFontSizePreset = 'normal';
let sharedCdpOverlayHighContrast = false;
const userStatusStaleGuard = new StaleCacheGuard<FullUserStatus>();
const trajectoriesStaleGuard = new StaleCacheGuard<TrajectorySummary[]>();
let lastContextBreakdown: ContextBreakdownSnapshot | null = null;
let lastContextBreakdownKey = '';
let lastActiveUsageReadAt = 0;
const ACTIVE_TELEMETRY_RECHECK_MS = 60_000;
let lastTurnDiagnostics: TurnDiagnosticsSummary | null = null;
const branchStepPeaks = new Map<string, BranchStepPeakState>();
const previousBreakdownUsedTokens = new Map<string, number>();

// ─── v1.18 Shared App Settings, CLI Scanner, Updates & Bidirectional Hot Sync ─
const CLI_SCAN_TTL_MS = 60_000;

let sharedAppSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, showNativeHudBar: false, ideShowNativeHudBar: false };
let sharedSubscriptionPlan: SubscriptionPlanPresetId = 'none';
let lastSyncedDiskAppSettings: AppSettings | null = null;
let hasHydratedSharedSettings = false;
let pendingConfigSyncCount = 0;
const cliUsageScanner = new CliUsageScanner();
let lastUpdateStatusView: UpdateStatusView | null = null;
let autoUpdateCheckInFlight = false;

/**
 * Resolve host-scoped `brain/` root options for `SwarmTopologyRegistry`.
 * When VS Code is connected to a Remote-SSH / WSL / tunnel / container host
 * without a verified remote brain directory, local `~/.gemini/antigravity/brain`
 * is strictly disabled (`isRemoteHost: true`, `remoteBrainVerified: false`).
 */
export function resolveIdeBrainRootScope(
    workspaceUris: readonly string[] = [],
    options?: { remoteName?: string | null; env?: Record<string, string | undefined> },
): BrainRootScopeOptions {
    const envObj = options?.env ?? process.env;
    const vscodeRemoteName = options?.remoteName !== undefined
        ? (options.remoteName || '').trim()
        : (typeof (vscode.env as { remoteName?: unknown } | undefined)?.remoteName === 'string'
            ? ((vscode.env as { remoteName: string }).remoteName || '').trim()
            : '');
    if (vscodeRemoteName) {
        return {
            env: envObj,
            isRemoteHost: true,
            remoteAuthority: vscodeRemoteName,
            remoteBrainVerified: false,
        };
    }
    for (const rawUri of workspaceUris) {
        const uri = typeof rawUri === 'string' ? rawUri.trim() : '';
        const remoteMatch = /^vscode-remote:\/\/([^/]+)/i.exec(uri) || /^ssh:\/\/([^/]+)/i.exec(uri);
        if (remoteMatch) {
            return {
                env: envObj,
                isRemoteHost: true,
                remoteAuthority: remoteMatch[1],
                remoteBrainVerified: false,
            };
        }
    }
    return {
        env: envObj,
        isRemoteHost: false,
    };
}

function ensureSwarmRegistryForWorkspaces(workspaceUris: readonly string[]): void {
    const scope = resolveIdeBrainRootScope(workspaceUris);
    const key = `${scope.isRemoteHost ? 'remote' : 'local'}:${scope.remoteAuthority ?? ''}:${scope.brainDir ?? ''}`;
    if (key !== swarmRegistryScopeKey) {
        swarmRegistryScopeKey = key;
        swarmMemberInventory.reset();
        swarmRegistry = new SwarmTopologyRegistry({ scope });
        swarmRegistry.setBackendEpoch(backendEpoch);
        lastSwarmTopology = null;
    }
}

function mapCatalogProvenanceToObservation(
    provenance: CatalogLimitProvenance,
): ObservationLimitProvenance {
    switch (provenance) {
        case 'custom_override': return 'explicit_override';
        case 'live_checkpointer': return 'planner_config';
        case 'live_catalog': return 'ls_metadata';
        case 'static_verified': return 'model_catalog';
        case 'heuristic_guess':
        case 'default_fallback':
            return 'model_guess';
        case 'none':
        default:
            return 'unavailable';
    }
}

function computeScopedConversationSpeed(
    summary: GMSummary | null,
    cascadeId: string | null,
    speedMode: 'decode' | 'e2e',
    isStreaming = false,
): {
    tps: number | null;
    scope: 'latest_call' | 'conversation_weighted' | 'none';
    callId: string | null;
    metric: WeightedSpeedMetricSummary | null;
} {
    if (!summary || !cascadeId) {
        return { tps: null, scope: 'none', callId: null, metric: null };
    }
    const conv = summary.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length === 0) {
        return { tps: null, scope: 'none', callId: null, metric: null };
    }
    const metric = computeWeightedSpeedMetric(conv.calls, speedMode, { isStreaming });
    const latestCall = conv.calls[conv.calls.length - 1];
    const isLatestCallValidForMode = Boolean(
        latestCall
        && typeof latestCall.outputTokens === 'number' && latestCall.outputTokens >= 8
        && typeof latestCall.streamingSeconds === 'number' && latestCall.streamingSeconds >= 0.3
        && (speedMode === 'decode' || (typeof latestCall.ttftSeconds === 'number' && Number.isFinite(latestCall.ttftSeconds) && latestCall.ttftSeconds > 0)),
    );
    if (isLatestCallValidForMode && metric.latestTokPerSec !== null && Number.isFinite(metric.latestTokPerSec) && metric.latestTokPerSec > 0) {
        return {
            tps: metric.latestTokPerSec,
            scope: 'latest_call',
            callId: latestCall?.executionId || `${cascadeId}:${conv.calls.length - 1}`,
            metric,
        };
    }
    if (metric.weightedTokPerSec !== null && Number.isFinite(metric.weightedTokPerSec) && metric.weightedTokPerSec > 0) {
        return {
            tps: metric.weightedTokPerSec,
            scope: 'conversation_weighted',
            callId: null,
            metric,
        };
    }
    return { tps: null, scope: 'none', callId: null, metric };
}

/**
 * Construct and publish a single deeply-frozen `PublishedMonitorObservation` for the
 * current IDE `(backendEpoch, windowId, subjectCascadeId, selectionRevision, dataRevision)`
 * so IDE Status Bar and Webview Overview render 100% identical percentage, denominator,
 * rounding, health status, and threshold markers.
 */
export function buildIdePublishedObservation(
    usage: ContextUsage | null,
    options?: {
        summary?: GMSummary | null;
        gmEnhanced?: boolean;
        breakdown?: Pick<ContextBreakdownSnapshot, 'measurementState' | 'usedTokens'> | null;
        bumpRevision?: boolean;
        nowMs?: number;
    },
): PublishedMonitorObservation | null {
    if (!usage) {
        lastPublishedObservation = null;
        return null;
    }
    if (options?.bumpRevision !== false) {
        dataRevision++;
    }
    const subjectCascadeId = usage.cascadeId || trackedCascadeId || null;
    const rootFromTopology = subjectCascadeId ? swarmRegistry.resolveRootId(subjectCascadeId) : null;
    const rootCascadeId = (windowSelectionState.inspectedMemberId ? rootFromTopology : null)
        || windowSelectionState.lockedRootId
        || rootFromTopology
        || subjectCascadeId;

    let subjectKind: ObservationSubjectKind = 'main';
    if (subjectCascadeId) {
        const node = swarmRegistry.getNode(subjectCascadeId);
        if (node && (node.relationshipKind === 'direct_subagent' || node.relationshipKind === 'nested_helper')) {
            subjectKind = 'subagent';
        } else if (swarmRegistry.isKnownWorkerOrSubagent(subjectCascadeId)) {
            subjectKind = 'worker';
        } else if (knownSubagentCascadeIds.has(subjectCascadeId)) {
            subjectKind = 'subagent';
        }
    }

    const measuredModel = usage.lastModelUsage?.model || usage.model || null;
    const limitModel = usage.tokenUsageSource === 'planner' && usage.lastModelUsage?.model
        ? usage.lastModelUsage.model
        : (usage.model || measuredModel || '');
    const limits = limitModel ? resolveModelContextLimits(limitModel) : null;

    // Preserve explicit live/custom/verified limits; fall back to usage.contextLimit if model is unknown
    let compactionLimit = limits?.compactionLimit ?? null;
    let compactionProv: ObservationLimitProvenance = limits
        ? mapCatalogProvenanceToObservation(limits.compactionLimitProvenance)
        : 'unavailable';
    if (compactionLimit === null && !limits?.isNativeOnly && usage.contextLimit > 0) {
        compactionLimit = usage.contextLimit;
        compactionProv = 'model_guess';
    }
    const nativeLimit = limits?.nativeLimit ?? null;
    const nativeProv: ObservationLimitProvenance = limits
        ? mapCatalogProvenanceToObservation(limits.nativeLimitProvenance)
        : 'unavailable';

    const breakdown = options?.breakdown ?? (usage === currentUsage ? lastContextBreakdown : null);
    const pendingCompaction = breakdown?.measurementState === 'estimated_post_compaction';
    const hasBreakdownTokens = !!breakdown && breakdown.usedTokens > 0;
    const usedTokens = (hasBreakdownTokens || pendingCompaction) ? breakdown.usedTokens : usage.contextUsed;
    const isZeroStepFresh = usage.stepCount === 0
        && usage.contextUsed === 0
        && !usage.lastModelUsage
        && !usage.hasGaps;
    const isSuffixRecovered = Boolean((usage as { suffixRecovered?: boolean } | null | undefined)?.suffixRecovered);
    const hasValidCurrentMeasurement = Boolean(
        (isSuffixRecovered && (usage.lastModelUsage || usage.postCompactionPending) && usedTokens > 0)
        || (options?.gmEnhanced && usage.contextUsed > 0),
    );
    const isIncomplete = Boolean(
        (pendingCompaction && usedTokens <= 0)
        || (usage.hasGaps && !hasValidCurrentMeasurement)
        || (!isZeroStepFresh && usedTokens <= 0 && !usage.lastModelUsage),
    );

    let tokenSource: ContextTokenSource;
    if (isZeroStepFresh) {
        tokenSource = 'zero_step_fresh';
    } else if (isIncomplete) {
        tokenSource = 'unavailable';
    } else if (hasBreakdownTokens) {
        tokenSource = breakdown.measurementState === 'measured' ? 'gm_usage' : 'breakdown_buckets';
    } else if (usage.lastModelUsage) {
        tokenSource = 'tracker_usage';
    } else if (options?.gmEnhanced) {
        tokenSource = 'gm_usage';
    } else if (usage.isEstimated) {
        tokenSource = 'step_estimate';
    } else {
        tokenSource = 'tracker_usage';
    }

    const summary = options?.summary !== undefined
        ? options.summary
        : (typeof gmTracker !== 'undefined' ? gmTracker.getUiSummary() : lastGMSummary);
    const speedMode = sharedAppSettings.speedMetricMode;
    const obsNowMs = options?.nowMs ?? Date.now();
    const speedInfo = isZeroStepFresh
        ? { tps: null, scope: 'none' as const, callId: null, metric: null }
        : computeScopedConversationSpeed(summary, subjectCascadeId, speedMode, usage.status === CascadeStatus.RUNNING);
    latestSpeedMetric = speedInfo.metric;
    if (!isZeroStepFresh && subjectCascadeId) {
        const convCalls = summary?.conversations.find(c => c.cascadeId === subjectCascadeId)?.calls ?? [];
        const ttlKey = {
            account: cachedUserInfo?.email || currentAccountEmail || 'default',
            backend: cachedLsInfo ? getLsAuthority(cachedLsInfo) : 'default',
            conversation: subjectCascadeId,
            model: measuredModel || 'unknown',
            branch: usage.branchName || 'main',
        };
        const latestCall = convCalls.length > 0 ? convCalls[convCalls.length - 1] : null;
        let measured: { inputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number; cacheTelemetryAvailable?: boolean } | null = null;
        if (latestCall) {
            const callMs = latestCall.createdAt ? Date.parse(latestCall.createdAt) : NaN;
            const eventMs = Number.isFinite(callMs) && callMs > 0 ? callMs : obsNowMs;
            const callKey = `${subjectCascadeId}|${latestCall.executionId || ''}|${latestCall.createdAt || ''}|${convCalls.length}`;
            const explicitAvail = (latestCall as { cacheTelemetryAvailable?: boolean }).cacheTelemetryAvailable;
            const cacheTelemetryAvailable = explicitAvail === false
                ? false
                : (explicitAvail === true
                    || typeof latestCall.cacheReadTokens === 'number'
                    || typeof latestCall.cacheCreationTokens === 'number');
            measured = {
                inputTokens: latestCall.inputTokens,
                cacheReadTokens: latestCall.cacheReadTokens,
                cacheCreationTokens: latestCall.cacheCreationTokens,
                cacheTelemetryAvailable,
            };
            if (callKey !== lastRecordedCacheTtlCallKey) {
                lastRecordedCacheTtlCallKey = callKey;
                promptCacheTtlTracker.recordEvent({
                    key: ttlKey,
                    eventMs,
                    measured,
                    modelConfirmed: Boolean(measuredModel),
                    branchConfirmed: Boolean(usage.branchName),
                });
            }
        }
        latestPromptCacheTtl = promptCacheTtlTracker.evaluate({ key: ttlKey, nowMs: obsNowMs, measured });
    } else {
        latestPromptCacheTtl = null;
    }
    if (typeof statusBar !== 'undefined') {
        statusBar.setPromptCacheTtl(latestPromptCacheTtl);
    }
    const scopedCost = isZeroStepFresh || !subjectCascadeId
        ? null
        : (() => {
            const c = computeLiveCostSnapshot(summary, subjectCascadeId);
            return c.sessionCostUsd > 0 ? c.sessionCostUsd : null;
        })();

    const extraThresholds = limits?.compactionThreshold && limits.compactionThreshold > 0
        ? [{ id: 'checkpointer_trigger', label: 'Compaction trigger', tokens: limits.compactionThreshold }]
        : undefined;

    const observation = buildPublishedMonitorObservation({
        backendEpoch,
        windowId,
        rootCascadeId,
        subjectCascadeId,
        subjectKind,
        selectionRevision: windowSelectionState.selectionRevision,
        dataRevision,
        measuredModel,
        tokenSource,
        usedTokens: isIncomplete ? null : usedTokens,
        compactionLimit,
        compactionLimitProvenance: compactionProv,
        nativeLimit,
        nativeLimitProvenance: nativeProv,
        requestedBasis: sharedAppSettings.contextPctBasis,
        speedMode,
        speedSampleScope: speedInfo.scope,
        speedCallId: speedInfo.callId,
        displaySpeedTps: speedInfo.tps,
        isZeroStepFresh,
        isIncomplete,
        sessionCostUsd: scopedCost,
        extraThresholds,
        observedAtMs: options?.nowMs ?? Date.now(),
    });
    lastPublishedObservation = observation;
    return observation;
}

function clampNum(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function inferIdeSubscriptionPlan(
    rawPlan: unknown,
    monthlyFee: number | null,
): SubscriptionPlanPresetId {
    return normalizeSubscriptionPlanId(rawPlan, monthlyFee);
}

function getIdeExtensionVersion(): string {
    const raw = (extensionContext?.extension?.packageJSON as { version?: unknown } | undefined)?.version;
    return resolveRuntimeVersion({
        explicitVersion: typeof raw === 'string' && raw.trim() ? raw.trim() : null,
    });
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
    { vscodeKey: 'customFxCurrency', appKey: 'customFxCurrency' },
    { vscodeKey: 'subscriptionMonthlyFee', appKey: 'subscriptionMonthlyFee' },
    { vscodeKey: 'subscriptionCurrency', appKey: 'subscriptionCurrency' },
    { vscodeKey: 'calendarRetentionDays', appKey: 'calendarRetentionDays' },
    { vscodeKey: 'autoCheckUpdates', appKey: 'autoCheckUpdates' },
    { vscodeKey: 'showNativeHudBar', appKey: 'showNativeHudBar' },
    { vscodeKey: 'nativeHudAutoHideOnOverview', appKey: 'nativeHudAutoHideOnOverview' },
    { vscodeKey: 'languagePreference', appKey: 'languagePreference' },
    { vscodeKey: 'contextPctBasis', appKey: 'contextPctBasis' },
    { vscodeKey: 'speedMetricMode', appKey: 'speedMetricMode' },
    { vscodeKey: 'quotaWindowMode', appKey: 'quotaWindowMode' },
    { vscodeKey: 'quotaDirectionMode', appKey: 'quotaDirectionMode' },
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

    // Reconcile lockToMainAgent via single-time legacy migration guard:
    // once `legacyLockMigrated === true`, legacy top-level `lockToMainAgent` NEVER overrides appSettings!
    const migratedLock = durableState.resolveMigratedLegacyLock();
    const resolvedLock = migratedLock.lockToMainAgent;
    lockToMainAgent = resolvedLock;
    windowSelectionState = {
        ...windowSelectionState,
        lockToMainAgent: resolvedLock,
        lockedRootId: resolvedLock ? windowSelectionState.lockedRootId : null,
    };
    if (!resolvedLock) {
        lockedMainCascadeId = null;
    }

    // Respect explicit disk ideShowNativeHudBar / showNativeHudBar; otherwise preserve IDE's default false / prior value
    const explicitDiskIdeHud = hasRawDiskObj && typeof rawDisk!.ideShowNativeHudBar === 'boolean'
        ? rawDisk!.ideShowNativeHudBar
        : (hasRawDiskObj && typeof rawDisk!.showNativeHudBar === 'boolean'
            ? rawDisk!.showNativeHudBar
            : undefined);
    const resolvedNativeHud = explicitDiskIdeHud !== undefined
        ? explicitDiskIdeHud
        : (prevSettings ? prevSettings.ideShowNativeHudBar : cfg.get<boolean>('showNativeHudBar', false));

    const persistedPlan = durableFileGlobalState.get<string>('subscriptionPlan', '');
    const rawDiskPlan = hasRawDiskObj && typeof rawDisk!.subscriptionPlan === 'string' && rawDisk!.subscriptionPlan.trim()
        ? rawDisk!.subscriptionPlan.trim()
        : '';
    const nextPlan = inferIdeSubscriptionPlan(
        rawDiskPlan || persistedPlan || (initialLoad ? cfg.get<string>('subscriptionPlan', 'none') : ''),
        diskNormalized.subscriptionMonthlyFee,
    );

    const nextSettings: AppSettings = {
        ...diskNormalized,
        lockToMainAgent: resolvedLock,
        legacyLockMigrated: diskNormalized.legacyLockMigrated || migratedLock.needsMigrationPersist,
        orchestratorPricingMode: resolvedOrchMode,
        subscriptionPlan: nextPlan,
        showNativeHudBar: resolvedNativeHud,
        ideShowNativeHudBar: resolvedNativeHud,
    };

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
            subscriptionPlan: cfg.get<string>('subscriptionPlan', 'none'),
            subscriptionMonthlyFee: cfg.get<number | null>('subscriptionMonthlyFee', null),
            subscriptionCurrency: cfg.get<string>('subscriptionCurrency', 'USD'),
            calendarRetentionDays: cfg.get<number>('calendarRetentionDays', 400),
            autoCheckUpdates: cfg.get<boolean>('autoCheckUpdates', true),
            showNativeHudBar: cfg.get<boolean>('showNativeHudBar', false),
            ideShowNativeHudBar: cfg.get<boolean>('showNativeHudBar', false),
            nativeHudAutoHideOnOverview: cfg.get<boolean>('nativeHudAutoHideOnOverview', true),
            languagePreference: cfg.get<string>('languagePreference', 'auto'),
            contextPctBasis: cfg.get<string>('contextPctBasis', 'compaction'),
            speedMetricMode: cfg.get<string>('speedMetricMode', 'decode'),
            quotaWindowMode: cfg.get<string>('quotaWindowMode', '5h'),
            quotaDirectionMode: cfg.get<string>('quotaDirectionMode', 'remaining'),
            customFxCurrency: cfg.get<string | null>('customFxCurrency', null),
            lockToMainAgent: resolvedLock,
            legacyLockMigrated: migratedLock.needsMigrationPersist,
        });
        sharedCdpOverlayFontSize = normalizeCdpOverlayFontSize(
            durableFileGlobalState.get<unknown>('cdpOverlayFontSize', cfg.get<string>('cdpOverlayFontSize', 'normal')),
        );
        sharedCdpOverlayHighContrast = Boolean(
            durableFileGlobalState.get<boolean>('cdpOverlayHighContrast', cfg.get<boolean>('cdpOverlayHighContrast', false)),
        );
        sharedAppSettings = seeded;
        sharedSubscriptionPlan = seeded.subscriptionPlan;
        lastSyncedDiskAppSettings = { ...seeded };
        hasHydratedSharedSettings = true;
        return { changed: false, prevSettings };
    }

    sharedCdpOverlayFontSize = normalizeCdpOverlayFontSize(
        durableFileGlobalState.get<unknown>('cdpOverlayFontSize', cfg.get<string>('cdpOverlayFontSize', sharedCdpOverlayFontSize)),
    );
    sharedCdpOverlayHighContrast = Boolean(
        durableFileGlobalState.get<boolean>('cdpOverlayHighContrast', cfg.get<boolean>('cdpOverlayHighContrast', sharedCdpOverlayHighContrast)),
    );
    const changed = !prevSettings || JSON.stringify(prevSettings) !== JSON.stringify(nextSettings) || prevPlan !== nextPlan;
    sharedAppSettings = nextSettings;
    sharedSubscriptionPlan = nextPlan;
    lastSyncedDiskAppSettings = { ...nextSettings };
    hasHydratedSharedSettings = true;

    // Hydrate update status view from persisted lastUpdateCheck using version-aware comparison
    if (nextSettings.lastUpdateCheck) {
        const luc = nextSettings.lastUpdateCheck;
        const currentVersion = getIdeExtensionVersion();
        const updateAvailable = isUpdateAvailableForVersion(luc, currentVersion);
        if (!lastUpdateStatusView || (luc.checkedAt && (!lastUpdateStatusView.checkedAt || luc.checkedAt > lastUpdateStatusView.checkedAt))) {
            lastUpdateStatusView = {
                currentVersion,
                latestVersion: luc.latestVersion ?? null,
                updateAvailable,
                hasUpdate: updateAvailable,
                status: luc.error ? 'error' : (updateAvailable ? 'update_available' : 'up_to_date'),
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
    initI18nFromState(durableFileGlobalState, getIdeLocaleSources());
    const nextLang = getLanguage();
    const langChanged = prevLang !== nextLang;
    if (langChanged) {
        markDisplayLanguageModified();
        if (extensionContext?.globalState) {
            void extensionContext.globalState.update('displayLanguage', nextLang);
        }
    }
    mergeDiskQuotaRunwaysIntoIdeTracker();
    recoveryBriefTracker.restoreDismissedKeys(
        durableFileGlobalState.get<string[]>('dismissedRecoveryBriefKeys', []),
    );

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
    if (activityTracker) {
        activityTracker.updateConfig({
            maxRecentSteps: sharedAppSettings.activityMaxRecentSteps,
            maxArchives: sharedAppSettings.activityMaxArchives,
        });
    }
    if (prevSettings && prevSettings.pollingInterval !== sharedAppSettings.pollingInterval) {
        baseIntervalMs = Math.max(1, sharedAppSettings.pollingInterval) * 1000;
        currentIntervalMs = baseIntervalMs;
        if (!disposed) { restartPolling(); }
    }

    if (refreshUi) {
        if (typeof statusBar !== 'undefined') {
            applyDisplayPrefs();
            if (currentUsage) {
                const obs = buildIdePublishedObservation(currentUsage, { bumpRevision: true });
                statusBar.update(currentUsage, obs);
            }
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

export const MONITOR_COMMAND_DESTINATIONS: ReadonlySet<string> = new Set([
    'overview',
    'gm',
    'gmdata',
    'gm-data',
    'activity',
    'sessions',
    'chats',
    'chat-history',
    'calendar',
    'usage',
    'cost',
    'pricing',
    'models',
    'profile',
    'account',
    'accounts',
    'settings',
    'about',
]);

/**
 * Normalize the argument passed to `antigravity-context-monitor.showDetails`
 * (including hover tooltip command URIs, array-wrapped command args, and object payloads)
 * while accepting ALL canonical and legacy tab destinations.
 */
export function resolveMonitorCommandDestination(destination: unknown): string {
    let raw: unknown = destination;
    if (Array.isArray(raw)) {
        raw = raw[0];
    }
    if (raw && typeof raw === 'object') {
        const rec = raw as Record<string, unknown>;
        raw = rec.tab ?? rec.destination ?? rec.initialTab ?? '';
    }
    if (typeof raw !== 'string') {
        return 'overview';
    }
    const normalized = raw.trim().toLowerCase().replace(/^#(?:tab-)?/, '');
    if (normalized && MONITOR_COMMAND_DESTINATIONS.has(normalized)) {
        return normalized;
    }
    return 'overview';
}

export function isSharedAppSettingsHydrated(): boolean {
    return Boolean(durableState && hasHydratedSharedSettings);
}

export function getSharedAppSettings(): AppSettings & { subscriptionPlan: SubscriptionPlanPresetId } {
    return { ...sharedAppSettings, subscriptionPlan: sharedSubscriptionPlan };
}

function makeMemoryCommittedReceipt(): DurableStateCommitReceipt {
    return {
        committed: true,
        revision: 0,
        pendingRevision: 0,
        status: 'committed',
        retryScheduled: false,
    };
}

export async function flushDurableState(): Promise<DurableStateCommitReceipt> {
    if (!durableState) {
        return makeMemoryCommittedReceipt();
    }
    return durableState.flush();
}

export async function setSharedOrchestratorPricingMode(
    mode: OrchestratorPricingMode,
): Promise<{ ok: boolean; committed: boolean; receipt: DurableStateCommitReceipt; error?: string }> {
    const validated = validateOrchestratorPricingMode(mode);
    const normalized = validated.ok ? validated.value : normalizeOrchestratorPricingMode(mode);
    sharedAppSettings.orchestratorPricingMode = normalized;
    const pStore = pricingStore ? pricingStore.setOrchestratorPricingMode(normalized) : undefined;
    let receipt: DurableStateCommitReceipt = makeMemoryCommittedReceipt();
    if (durableState) {
        const writeRes = await durableState.patchAppSettingsWithReceipt({ orchestratorPricingMode: normalized });
        const flushReceipt = await durableState.flush();
        receipt = flushReceipt.committed ? writeRes.receipt : flushReceipt;
        sharedAppSettings = writeRes.settings;
        if (receipt.committed && flushReceipt.committed) {
            lastSyncedDiskAppSettings = { ...sharedAppSettings };
        } else {
            log(`[DurableState] Failed to commit orchestratorPricingMode: ${flushReceipt.status}`);
        }
    }
    if (pStore) { await pStore; }
    if (!receipt.committed) {
        syncStatusBarTelemetry(true);
        return {
            ok: false,
            committed: false,
            receipt,
            error: receipt.error || 'Failed to persist orchestratorPricingMode to disk',
        };
    }
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
    return { ok: true, committed: true, receipt };
}

export async function updateSharedAppSetting(
    key: string,
    value: unknown,
): Promise<{ ok: boolean; normalizedKey: string; committed?: boolean; receipt?: DurableStateCommitReceipt; error?: string }> {
    const cleanKey = key.trim();
    const patch: Partial<AppSettings> = {};
    let normalizedKey = cleanKey;
    let vscodeMirrorKey: string | undefined;
    let vscodeMirrorValue: unknown;
    let mirrorPlan: SubscriptionPlanPresetId | undefined;
    let refreshObservation = false;

    switch (cleanKey) {
        case 'appComposerRingEnabled':
            patch.appComposerRingEnabled = Boolean(value);
            break;
        case 'appTopBarEnabled':
            patch.appTopBarEnabled = Boolean(value);
            break;
        case 'appShowNativeHudBar':
            patch.appShowNativeHudBar = Boolean(value);
            break;
        case 'appOnboardingDismissed':
            patch.appOnboardingDismissed = Boolean(value);
            break;
        case 'ideShowNativeHudBar':
        case 'showNativeHudBar':
            patch.ideShowNativeHudBar = Boolean(value);
            patch.showNativeHudBar = Boolean(value);
            vscodeMirrorKey = 'showNativeHudBar';
            vscodeMirrorValue = patch.ideShowNativeHudBar;
            break;
        case 'nativeHudAutoHideOnOverview':
            patch.nativeHudAutoHideOnOverview = Boolean(value);
            vscodeMirrorKey = 'nativeHudAutoHideOnOverview';
            vscodeMirrorValue = patch.nativeHudAutoHideOnOverview;
            break;
        case 'languagePreference': {
            if (!isLanguagePreference(value)) {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid languagePreference' };
            }
            patch.languagePreference = value;
            setLanguagePreferenceInMemory(value, getIdeLocaleSources());
            vscodeMirrorKey = 'languagePreference';
            vscodeMirrorValue = value;
            break;
        }
        case 'contextPctBasis': {
            if (value !== 'compaction' && value !== 'native') {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid contextPctBasis' };
            }
            patch.contextPctBasis = value;
            vscodeMirrorKey = 'contextPctBasis';
            vscodeMirrorValue = value;
            refreshObservation = true;
            break;
        }
        case 'speedMetricMode': {
            if (value !== 'decode' && value !== 'e2e') {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid speedMetricMode' };
            }
            patch.speedMetricMode = value;
            vscodeMirrorKey = 'speedMetricMode';
            vscodeMirrorValue = value;
            refreshObservation = true;
            break;
        }
        case 'quotaWindowMode': {
            if (value !== '5h' && value !== '7d' && value !== 'tightest') {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid quotaWindowMode' };
            }
            patch.quotaWindowMode = value;
            vscodeMirrorKey = 'quotaWindowMode';
            vscodeMirrorValue = value;
            break;
        }
        case 'quotaDirectionMode': {
            if (value !== 'remaining' && value !== 'used') {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid quotaDirectionMode' };
            }
            patch.quotaDirectionMode = value;
            vscodeMirrorKey = 'quotaDirectionMode';
            vscodeMirrorValue = value;
            break;
        }
        case 'cdpOverlayFontSize': {
            if (!isCdpOverlayFontSize(value)) {
                return { ok: false, normalizedKey: cleanKey, error: 'Invalid cdpOverlayFontSize' };
            }
            sharedCdpOverlayFontSize = value;
            let fontReceipt: DurableStateCommitReceipt = makeMemoryCommittedReceipt();
            if (durableState) {
                const r = await durableState.updateGlobalWithReceipt('cdpOverlayFontSize', value);
                const f = await durableState.flush();
                fontReceipt = r.committed ? f : r;
            }
            if (!fontReceipt.committed) {
                return { ok: false, normalizedKey: cleanKey, committed: false, receipt: fontReceipt, error: fontReceipt.error };
            }
            const cfgFont = vscode.workspace.getConfiguration('antigravityContextMonitor');
            if (typeof cfgFont.update === 'function') {
                pendingConfigSyncCount++;
                try { await cfgFont.update('cdpOverlayFontSize', value, vscode.ConfigurationTarget?.Global); }
                finally { pendingConfigSyncCount = Math.max(0, pendingConfigSyncCount - 1); }
            }
            return { ok: true, normalizedKey: 'cdpOverlayFontSize', committed: true, receipt: fontReceipt };
        }
        case 'cdpOverlayHighContrast': {
            const nextHc = Boolean(value);
            sharedCdpOverlayHighContrast = nextHc;
            let hcReceipt: DurableStateCommitReceipt = makeMemoryCommittedReceipt();
            if (durableState) {
                const r = await durableState.updateGlobalWithReceipt('cdpOverlayHighContrast', nextHc);
                const f = await durableState.flush();
                hcReceipt = r.committed ? f : r;
            }
            if (!hcReceipt.committed) {
                return { ok: false, normalizedKey: cleanKey, committed: false, receipt: hcReceipt, error: hcReceipt.error };
            }
            const cfgHc = vscode.workspace.getConfiguration('antigravityContextMonitor');
            if (typeof cfgHc.update === 'function') {
                pendingConfigSyncCount++;
                try { await cfgHc.update('cdpOverlayHighContrast', nextHc, vscode.ConfigurationTarget?.Global); }
                finally { pendingConfigSyncCount = Math.max(0, pendingConfigSyncCount - 1); }
            }
            return { ok: true, normalizedKey: 'cdpOverlayHighContrast', committed: true, receipt: hcReceipt };
        }
        case 'orchestratorPricingMode': {
            const validated = validateOrchestratorPricingMode(value);
            if (!validated.ok) {
                return { ok: false, normalizedKey: cleanKey, committed: false, error: validated.error };
            }
            const res = await setSharedOrchestratorPricingMode(validated.value);
            return {
                ok: res.ok,
                normalizedKey: 'orchestratorPricingMode',
                committed: res.committed,
                receipt: res.receipt,
                ...(res.error ? { error: res.error } : {}),
            };
        }
        case 'displayCurrency': {
            const validated = validateDisplayCurrency(value);
            if (!validated.ok) {
                return { ok: false, normalizedKey: cleanKey, error: validated.error };
            }
            const switched = switchDisplayCurrency(
                {
                    displayCurrency: sharedAppSettings.displayCurrency,
                    customFxRate: sharedAppSettings.customFxRate,
                    customFxCurrency: sharedAppSettings.customFxCurrency,
                },
                validated.value,
            );
            patch.displayCurrency = switched.displayCurrency;
            patch.customFxRate = switched.customFxRate;
            patch.customFxCurrency = switched.customFxCurrency;
            vscodeMirrorKey = 'displayCurrency';
            vscodeMirrorValue = switched.displayCurrency;
            break;
        }
        case 'customFxRate': {
            const validated = validateCustomFxRate(value);
            if (!validated.ok) {
                return { ok: false, normalizedKey: cleanKey, error: validated.error };
            }
            const bound = bindCustomFxRate(sharedAppSettings.displayCurrency, validated.value);
            patch.customFxRate = bound.customFxRate;
            patch.customFxCurrency = bound.customFxCurrency;
            vscodeMirrorKey = 'customFxRate';
            vscodeMirrorValue = patch.customFxRate;
            break;
        }
        case 'customFxCurrency': {
            if (value === null || value === '' || value === undefined) {
                patch.customFxCurrency = null;
                patch.customFxRate = null;
            } else {
                const validated = validateDisplayCurrency(value);
                if (!validated.ok) {
                    return { ok: false, normalizedKey: cleanKey, error: validated.error };
                }
                patch.customFxCurrency = validated.value;
            }
            break;
        }
        case 'subscriptionPlan': {
            const validated = validateSubscriptionPlan(value, sharedAppSettings.subscriptionMonthlyFee);
            if (!validated.ok) {
                return { ok: false, normalizedKey: cleanKey, error: validated.error };
            }
            const nextPlan = validated.value;
            const preset = SUBSCRIPTION_PLAN_PRESETS[nextPlan];
            sharedSubscriptionPlan = nextPlan;
            mirrorPlan = nextPlan;
            patch.subscriptionPlan = nextPlan;
            if (nextPlan === 'none') {
                patch.subscriptionMonthlyFee = null;
            } else if (preset.monthlyUsd > 0) {
                patch.subscriptionMonthlyFee = preset.monthlyUsd;
                patch.subscriptionCurrency = 'USD';
            }
            break;
        }
        case 'subscriptionMonthlyFee': {
            const validated = validateSubscriptionMonthlyFee(value);
            if (!validated.ok) {
                return { ok: false, normalizedKey: cleanKey, error: validated.error };
            }
            patch.subscriptionMonthlyFee = validated.value;
            if (patch.subscriptionMonthlyFee !== null && sharedSubscriptionPlan === 'none') {
                sharedSubscriptionPlan = 'custom';
                mirrorPlan = 'custom';
                patch.subscriptionPlan = 'custom';
            }
            vscodeMirrorKey = 'subscriptionMonthlyFee';
            vscodeMirrorValue = patch.subscriptionMonthlyFee;
            break;
        }
        case 'subscriptionCurrency': {
            const validated = validateSubscriptionCurrency(value);
            if (!validated.ok) {
                return { ok: false, normalizedKey: cleanKey, error: validated.error };
            }
            patch.subscriptionCurrency = validated.value;
            vscodeMirrorKey = 'subscriptionCurrency';
            vscodeMirrorValue = validated.value;
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
            activityTracker?.updateConfig({ maxRecentSteps: clamped });
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
            activityTracker?.updateConfig({ maxArchives: clamped });
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
        case 'lockToMainAgent': {
            setLockToMainAgent(Boolean(value));
            const receipt = await flushDurableState();
            return {
                ok: receipt.committed,
                normalizedKey: 'lockToMainAgent',
                committed: receipt.committed,
                receipt,
                ...(receipt.committed ? {} : { error: receipt.error || 'Failed to persist lockToMainAgent' }),
            };
        }
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
    let commitReceipt: DurableStateCommitReceipt = makeMemoryCommittedReceipt();
    if (durableState) {
        const writeRes = await durableState.patchAppSettingsWithReceipt(patch);
        let planReceipt: DurableStateCommitReceipt = makeMemoryCommittedReceipt();
        if (durableFileGlobalState && (mirrorPlan !== undefined || patch.subscriptionPlan !== undefined)) {
            planReceipt = await durableState.updateGlobalWithReceipt('subscriptionPlan', sharedSubscriptionPlan);
        }
        if (durableFileGlobalState && patch.languagePreference !== undefined) {
            await durableState.updateGlobalWithReceipt('languagePreference', patch.languagePreference);
            await durableState.updateGlobalWithReceipt(
                'displayLanguage',
                patch.languagePreference === 'auto' ? undefined : patch.languagePreference,
            );
        }
        const flushReceipt = await durableState.flush();
        sharedAppSettings = writeRes.settings;
        const allCommitted = writeRes.receipt.committed && planReceipt.committed && flushReceipt.committed;
        commitReceipt = !writeRes.receipt.committed
            ? writeRes.receipt
            : (!planReceipt.committed ? planReceipt : flushReceipt);
        if (allCommitted) {
            lastSyncedDiskAppSettings = { ...sharedAppSettings };
        } else {
            log(`[DurableState] Failed to commit setting '${normalizedKey}': ${commitReceipt.status}`);
            return {
                ok: false,
                normalizedKey,
                committed: false,
                receipt: commitReceipt,
                error: commitReceipt.error || `Failed to persist setting '${normalizedKey}' to disk`,
            };
        }
    }

    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    if (typeof cfg.update === 'function') {
        const cfgWrites: Array<[string, unknown]> = [];
        if (vscodeMirrorKey) {
            cfgWrites.push([vscodeMirrorKey, vscodeMirrorValue]);
        }
        if (cleanKey === 'displayCurrency' && patch.customFxRate === null) {
            cfgWrites.push(['customFxRate', null]);
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
        if (refreshObservation && currentUsage) {
            const obs = buildIdePublishedObservation(currentUsage, { bumpRevision: true });
            statusBar.update(currentUsage, obs);
        }
        syncStatusBarTelemetry(true);
    }

    return { ok: true, normalizedKey, committed: true, receipt: commitReceipt };
}

export function getCachedCliUsageDays(force = false): CliDailyUsageRecord[] {
    const options = {
        cliRootDir: process.env.ANTIGRAVITY_CLI_DATA_DIR || undefined,
        customPricing: pricingStore?.getCustom(),
    };
    if (force) { void cliUsageScanner.scanAsync(options).catch(() => {}); }
    return cliUsageScanner.getCachedScan({ ...options, maxAgeMs: CLI_SCAN_TTL_MS, triggerRefresh: !force })?.days ?? [];
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
        const versionAwareHasUpdate = isUpdateAvailableForVersion(record, currentVersion);
        record.hasUpdate = versionAwareHasUpdate;
        if (durableState) {
            const writeRes = await durableState.patchAppSettingsWithReceipt({ lastUpdateCheck: record });
            const flushReceipt = await durableState.flush();
            sharedAppSettings = writeRes.settings;
            if (writeRes.receipt.committed && flushReceipt.committed) {
                lastSyncedDiskAppSettings = { ...sharedAppSettings };
            }
        } else {
            sharedAppSettings = { ...sharedAppSettings, lastUpdateCheck: record };
        }
        lastUpdateStatusView = {
            currentVersion,
            latestVersion: record.latestVersion,
            updateAvailable: versionAwareHasUpdate,
            hasUpdate: versionAwareHasUpdate,
            status: res.status === 'not_modified'
                ? (versionAwareHasUpdate ? 'update_available' : 'up_to_date')
                : res.status,
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

/** Get the current per-window 3-field selection state (D9). */
export function getWindowSelectionState(): WindowSelectionState {
    return windowSelectionState;
}

/** Get the latest immutable PublishedMonitorObservation (D9). */
export function getPublishedMonitorObservation(): PublishedMonitorObservation | null {
    return lastPublishedObservation;
}

/** Get the latest reconciled SwarmTopologySnapshot (D9). */
export function getSwarmTopologySnapshot(): SwarmTopologySnapshot | null {
    return lastSwarmTopology;
}

/** Get whether Main-Agent Lock is enabled. */
export function getLockToMainAgent(): boolean {
    return lockToMainAgent;
}

/** Toggle or explicitly set Main-Agent Lock synchronously, persisting atomically in shared AppSettings. */
export function setLockToMainAgent(locked?: boolean): boolean {
    const next = typeof locked === 'boolean' ? locked : !lockToMainAgent;
    if (next) {
        windowSelectionState = enableLockToMainAgent(windowSelectionState, {
            trajectories: lastTrajectories,
            currentActiveId: trackedCascadeId,
            workspaceUris: getWorkspaceUris(),
            knownSubagentIds: knownSubagentCascadeIds,
            topologyResolveRootId: (id) => swarmRegistry.resolveRootId(id),
            ...getWorkspaceNormOptions(),
        });
    } else {
        windowSelectionState = disableLockToMainAgent(windowSelectionState);
    }
    lockToMainAgent = next;
    lockedMainCascadeId = windowSelectionState.lockedRootId;
    sharedAppSettings.lockToMainAgent = next;
    sharedAppSettings.legacyLockMigrated = true;

    if (durableState) {
        void durableState.patchAppSettingsWithReceipt({
            lockToMainAgent: next,
            legacyLockMigrated: true,
        }).then(async ({ settings, receipt }) => {
            sharedAppSettings = settings;
            const flushReceipt = await durableState.flush();
            if (receipt.committed && flushReceipt.committed) {
                lastSyncedDiskAppSettings = { ...settings };
            }
        });
    }
    return lockToMainAgent;
}

/** Inspect a swarm worker / subagent member without overwriting `lockedRootId`. */
export function inspectSwarmMember(memberCascadeId: string): WindowSelectionState {
    const clean = typeof memberCascadeId === 'string' ? memberCascadeId.trim() : '';
    if (!clean) { return windowSelectionState; }
    windowSelectionState = inspectMember(windowSelectionState, clean, trackedCascadeId);
    trackedCascadeId = clean;
    clearActiveContextTelemetry();
    return windowSelectionState;
}

/** Exit swarm member inspection ("Back to Main"), instantly restoring `lockedRootId`. */
export function clearInspectedSwarmMember(): WindowSelectionState {
    const restore = windowSelectionState.lockedRootId || pinnedConversationId || windowSelectionState.inspectionReturnId;
    windowSelectionState = clearInspect(windowSelectionState);
    if (restore) { trackedCascadeId = restore; }
    clearActiveContextTelemetry();
    return windowSelectionState;
}

/** Explicitly retarget `lockedRootId` to a new main conversation (clearing inspection & retarget offers). */
export function retargetLockedRootConversation(newRootId: string): WindowSelectionState {
    const clean = typeof newRootId === 'string' ? newRootId.trim() : '';
    if (!clean) { return windowSelectionState; }
    windowSelectionState = retargetLockedRoot(windowSelectionState, clean, {
        trajectories: lastTrajectories,
        currentActiveId: trackedCascadeId,
        workspaceUris: getWorkspaceUris(),
        knownSubagentIds: knownSubagentCascadeIds,
        topologyResolveRootId: (id) => swarmRegistry.resolveRootId(id),
        ...getWorkspaceNormOptions(),
    });
    lockToMainAgent = true;
    lockedMainCascadeId = windowSelectionState.lockedRootId;
    if (lockedMainCascadeId) {
        trackedCascadeId = lockedMainCascadeId;
    }
    sharedAppSettings.lockToMainAgent = true;
    sharedAppSettings.legacyLockMigrated = true;
    clearActiveContextTelemetry();
    if (durableState) {
        void durableState.patchAppSettingsWithReceipt({
            lockToMainAgent: true,
            legacyLockMigrated: true,
        }).then(async ({ settings, receipt }) => {
            sharedAppSettings = settings;
            const flushReceipt = await durableState.flush();
            if (receipt.committed && flushReceipt.committed) {
                lastSyncedDiskAppSettings = { ...settings };
            }
        });
    }
    return windowSelectionState;
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
    windowSelectionState = clearInspect(windowSelectionState);
    pinnedConversationId = normalized;
    if (normalized) {
        trackedCascadeId = normalized;
    }
    clearActiveContextTelemetry();
    if (durableFileWorkspaceState) {
        void durableFileWorkspaceState.update('pinnedConversationId', pinnedConversationId);
    }
}

export function exportIdeSettingsBackup(nowMs = Date.now()): {
    filename: string;
    content: string;
    schemaVersion: number;
    keyCount: number;
} {
    const fullSettings = {
        ...getSharedAppSettings(),
        cdpOverlayFontSize: sharedCdpOverlayFontSize,
        cdpOverlayHighContrast: sharedCdpOverlayHighContrast,
    };
    const built = buildSettingsBackupJson(fullSettings, pricingStore?.getCustom() ?? {}, nowMs);
    const filename = `antigravity-settings-backup-${toLocalDateKey(new Date(nowMs))}.json`;
    return {
        filename,
        content: built.json,
        schemaVersion: built.payload.schemaVersion,
        keyCount: Object.keys(built.payload.settings).length,
    };
}

export async function importIdeSettingsBackup(rawJson: unknown): Promise<{
    ok: boolean;
    appliedKeys?: string[];
    strippedKeys?: string[];
    customPricingImported?: boolean;
    error?: string;
}> {
    const parsed = parseAndValidateSettingsBackup(rawJson);
    if (!parsed.ok) {
        return { ok: false, strippedKeys: parsed.strippedKeys, error: parsed.error };
    }
    const prevSettings = { ...sharedAppSettings };
    const prevPlan = sharedSubscriptionPlan;
    const prevFont = sharedCdpOverlayFontSize;
    const prevHc = sharedCdpOverlayHighContrast;
    const prevCustomPricing = pricingStore?.getCustom() ?? {};

    const appPatch: Partial<AppSettings> = {};
    const appliedKeys: string[] = [];
    let nextFont = sharedCdpOverlayFontSize;
    let nextHc = sharedCdpOverlayHighContrast;
    let hasFont = false;
    let hasHc = false;
    for (const [k, v] of Object.entries(parsed.settingsPatch)) {
        if (k === 'cdpOverlayFontSize' && isCdpOverlayFontSize(v)) {
            nextFont = v;
            hasFont = true;
            appliedKeys.push(k);
        } else if (k === 'cdpOverlayHighContrast' && typeof v === 'boolean') {
            nextHc = v;
            hasHc = true;
            appliedKeys.push(k);
        } else {
            (appPatch as Record<string, unknown>)[k] = v;
            appliedKeys.push(k);
        }
    }
    const prevLangPref = sharedAppSettings.languagePreference;

    let durableCommitted = false;
    try {
        if (durableState) {
            // Stage EVERY imported mutation into durableState BEFORE flushing once atomically so a
            // partial failure never commits half the backup to disk while rolling back only memory.
            const stagedPromises: Array<Promise<unknown>> = [];
            if (Object.keys(appPatch).length > 0) {
                stagedPromises.push(durableState.patchAppSettingsWithReceipt(appPatch));
            }
            if (hasFont) {
                stagedPromises.push(durableState.updateGlobalWithReceipt('cdpOverlayFontSize', nextFont));
            }
            if (hasHc) {
                stagedPromises.push(durableState.updateGlobalWithReceipt('cdpOverlayHighContrast', nextHc));
            }
            if (appPatch.languagePreference) {
                stagedPromises.push(durableState.updateGlobalWithReceipt('languagePreference', appPatch.languagePreference));
                stagedPromises.push(durableState.updateGlobalWithReceipt(
                    'displayLanguage',
                    appPatch.languagePreference === 'auto' ? undefined : appPatch.languagePreference,
                ));
            }
            if (parsed.customPricing !== undefined && pricingStore) {
                stagedPromises.push(durableState.updateGlobalWithReceipt('customModelPricing', parsed.customPricing));
            }
            const flushReceipt = await durableState.flush();
            if (!flushReceipt.committed) {
                throw new Error(flushReceipt.error || 'Failed to flush imported settings');
            }
            await Promise.all(stagedPromises);
            durableCommitted = true;
            if (parsed.customPricing !== undefined && pricingStore) {
                // Sync from the committed durable state in memory only so we never overwrite concurrent merged App edits.
                pricingStore.reloadFromStorage();
            }
            sharedAppSettings = durableState.getAppSettings();
            if (appPatch.subscriptionPlan) {
                sharedSubscriptionPlan = appPatch.subscriptionPlan;
            }
            sharedCdpOverlayFontSize = nextFont;
            sharedCdpOverlayHighContrast = nextHc;
            if (appPatch.languagePreference && isLanguagePreference(appPatch.languagePreference)) {
                setLanguagePreferenceInMemory(appPatch.languagePreference, getIdeLocaleSources());
            }
            lastSyncedDiskAppSettings = { ...sharedAppSettings };
        } else {
            if (parsed.customPricing !== undefined && pricingStore) {
                await pricingStore.setAll(parsed.customPricing);
            }
            if (appPatch.subscriptionPlan) {
                sharedSubscriptionPlan = appPatch.subscriptionPlan;
            }
            if (appPatch.languagePreference && isLanguagePreference(appPatch.languagePreference)) {
                setLanguagePreferenceInMemory(appPatch.languagePreference, getIdeLocaleSources());
            }
            sharedAppSettings = { ...sharedAppSettings, ...appPatch };
            sharedCdpOverlayFontSize = nextFont;
            sharedCdpOverlayHighContrast = nextHc;
        }
    } catch (err) {
        if (!durableCommitted) {
            sharedAppSettings = prevSettings;
            sharedSubscriptionPlan = prevPlan;
            sharedCdpOverlayFontSize = prevFont;
            sharedCdpOverlayHighContrast = prevHc;
            if (prevLangPref && isLanguagePreference(prevLangPref)) {
                setLanguagePreferenceInMemory(prevLangPref, getIdeLocaleSources());
            }
            if (durableState) {
                // Re-sync durableState from last committed disk state so staged dirty mutations are rolled back.
                durableState.patchAppSettings(prevSettings);
                if (hasFont) { void durableFileGlobalState?.update('cdpOverlayFontSize', prevFont); }
                if (hasHc) { void durableFileGlobalState?.update('cdpOverlayHighContrast', prevHc); }
                if (appPatch.languagePreference && prevLangPref) {
                    void durableFileGlobalState?.update('languagePreference', prevLangPref);
                    void durableFileGlobalState?.update('displayLanguage', prevLangPref === 'auto' ? undefined : prevLangPref);
                }
                if (parsed.customPricing !== undefined && pricingStore) {
                    void durableFileGlobalState?.update('customModelPricing', prevCustomPricing);
                    pricingStore.reloadFromStorage();
                }
            } else if (parsed.customPricing !== undefined && pricingStore) {
                await pricingStore.setAll(prevCustomPricing).catch(() => {});
            }
        }
        return {
            ok: false,
            strippedKeys: parsed.strippedKeys,
            error: err instanceof Error ? err.message : 'Failed to import settings backup',
        };
    }

    if (typeof appPatch.showModelInternalId === 'boolean') {
        setShowModelShortId(appPatch.showModelInternalId);
    }
    if (typeof appPatch.calendarRetentionDays === 'number' && dailyStore) {
        dailyStore.setMaxDays(appPatch.calendarRetentionDays);
    }
    if (typeof statusBar !== 'undefined') {
        applyDisplayPrefs();
        if (currentUsage) {
            const obs = buildIdePublishedObservation(currentUsage, { bumpRevision: true });
            statusBar.update(currentUsage, obs);
        }
        syncStatusBarTelemetry(true);
    }
    return {
        ok: true,
        appliedKeys,
        strippedKeys: parsed.strippedKeys,
        customPricingImported: parsed.customPricing !== undefined,
    };
}

export async function dismissIdeRecoveryBrief(eventKey: string): Promise<{
    ok: boolean;
    dismissed?: boolean;
    error?: string;
}> {
    const clean = typeof eventKey === 'string' ? eventKey.trim() : (activeRecoveryBrief?.eventKey ?? '');
    if (!clean) {
        return { ok: false, error: 'Missing recovery brief eventKey' };
    }
    recoveryBriefTracker.dismiss(clean);
    if (durableState) {
        const r = await durableState.updateGlobalWithReceipt(
            'dismissedRecoveryBriefKeys',
            recoveryBriefTracker.exportDismissedKeys(),
        );
        const f = await durableState.flush();
        if (!r.committed || !f.committed) {
            return { ok: false, error: f.error || r.error || 'Failed to persist recovery brief dismissal' };
        }
    }
    if (activeRecoveryBrief?.eventKey === clean) {
        activeRecoveryBrief = null;
    }
    return { ok: true, dismissed: true };
}

export function exportIdeRedactedDiagnostics(nowMs = Date.now()) {
    const obs = lastPublishedObservation ?? (currentUsage ? buildIdePublishedObservation(currentUsage, { bumpRevision: false, nowMs }) : null);
    const stale = getCurrentStaleState();
    const rootId = obs?.rootCascadeId ?? windowSelectionState.lockedRootId ?? null;
    const activeGroup = rootId && lastSwarmTopology ? lastSwarmTopology.groupsByRootId.get(rootId) : undefined;
    const runways = getCurrentQuotaRunways(nowMs);
    const runwayRows = Object.entries(runways).map(([poolKey, r]) => {
        const wk = lastWeeklyQuotaRunways[poolKey];
        return {
            poolKey,
            status: r.status,
            ...(wk ? {
                weeklyStatus: wk.status,
                activeHours: wk.coverage.activeHours,
                activeDays: wk.coverage.activeDays,
                meetsThreshold: wk.coverage.meetsThreshold,
            } : {}),
        };
    });
    let stateSize = 0;
    try {
        const p = durableState?.getFilePath();
        if (p && fs.existsSync(p)) { stateSize = fs.statSync(p).size; }
    } catch { /* ignore */ }
    const built = buildRedactedDiagnostics({
        surface: 'ide',
        version: getIdeExtensionVersion(),
        nowMs,
        buildIds: { webviewClient: WEBVIEW_CLIENT_BUILD_ID },
        counters: {
            backendEpoch,
            selectionRevision: windowSelectionState.selectionRevision,
            dataRevision,
            trajectoryCount: lastTrajectories.length,
            modelConfigCount: cachedModelConfigs.length,
            accountCount: accountSnapshots.size,
            dailyStoreDayCount: dailyStore?.totalDays ?? 0,
            stateFileSizeBytes: stateSize,
        },
        freshness: {
            isStale: Boolean(stale?.isStale),
            lastSuccessAtMs: stale?.lastSuccessAtMs ?? null,
            staleSources: stale?.isStale ? ['ide'] : [],
            lastError: stale?.lastError ?? null,
        },
        observation: obs,
        aliasMap: diagnosticAliasMap,
        selection: {
            mode: lockToMainAgent ? 'lock_main' : (pinnedConversationId ? 'pinned' : 'auto_follow'),
            lockToMainAgent,
            lockedRootId: windowSelectionState.lockedRootId,
            inspectedMemberId: windowSelectionState.inspectedMemberId,
            lockPendingUnavailable: Boolean(windowSelectionState.lockPendingUnavailable),
        },
        swarm: lastSwarmTopology
            ? {
                groupCount: lastSwarmTopology.groupsByRootId.size,
                totalNodes: lastSwarmTopology.nodesById.size,
                activeMembers: activeGroup?.activeMemberIds.length ?? 0,
                activeRootId: rootId,
            }
            : undefined,
        cacheTtl: latestPromptCacheTtl
            ? {
                ttlEstimateState: latestPromptCacheTtl.ttlEstimateState,
                measuredCacheState: latestPromptCacheTtl.measuredCacheState,
                clockAnomaly: latestPromptCacheTtl.clockAnomaly,
                idleSeconds: latestPromptCacheTtl.idleSeconds,
                causeKinds: latestPromptCacheTtl.possibleCauses.map(c => c.cause),
            }
            : null,
        quotaRunway: runwayRows,
        preferences: {
            languagePreference: sharedAppSettings.languagePreference,
            displayCurrency: sharedAppSettings.displayCurrency,
            contextPctBasis: sharedAppSettings.contextPctBasis,
            speedMetricMode: sharedAppSettings.speedMetricMode,
            quotaWindowMode: sharedAppSettings.quotaWindowMode,
            quotaDirectionMode: sharedAppSettings.quotaDirectionMode,
            nativeHudAutoHideOnOverview: sharedAppSettings.nativeHudAutoHideOnOverview,
            orchestratorPricingMode: sharedAppSettings.orchestratorPricingMode,
        },
    });
    const filename = `antigravity-diagnostics-redacted-${toLocalDateKey(new Date(nowMs))}.json`;
    return { filename, content: built.json, diagnostics: built.diagnostics };
}

function bindIdePanelHostBridge(): void {
    registerIdePanelHostBridge({
        removeAccountSnapshot,
        getBillingDaysMap,
        setAccountBillingDay,
        getLockToMainAgent,
        setLockToMainAgent,
        getPinnedConversationId,
        selectPinnedConversation,
        refreshStatusBarTelemetry,
        markDisplayLanguageModified,
        getSharedAppSettings,
        isSharedAppSettingsHydrated,
        updateSharedAppSetting,
        setSharedOrchestratorPricingMode,
        flushDurableState,
        syncDurableStateFromDisk: syncFromDurableStateIfChanged,
        getCachedCliUsageDays,
        checkIdeReleaseUpdates,
        getLastUpdateStatusView,
        getWindowSelectionState,
        inspectSwarmMember,
        refreshSelection: () => { void pollContextUsage(true); },
        clearInspectedSwarmMember,
        retargetLockedRoot: retargetLockedRootConversation,
    });
    registerIdeV118HostHooks({
        getWeeklyQuotaRunways: () => ({ ...lastWeeklyQuotaRunways }),
        getPromptCacheTtl: () => latestPromptCacheTtl,
        getRecoveryBrief: () => activeRecoveryBrief,
        dismissRecoveryBrief: dismissIdeRecoveryBrief,
        getOverlayVisualPrefs: () => ({
            cdpOverlayFontSize: sharedCdpOverlayFontSize,
            cdpOverlayHighContrast: sharedCdpOverlayHighContrast,
        }),
        exportSettingsBackup: exportIdeSettingsBackup,
        importSettingsBackup: importIdeSettingsBackup,
        exportRedactedDiagnostics: exportIdeRedactedDiagnostics,
        getCurrentObservationMeta: () => ({
            subjectCascadeId: lastPublishedObservation?.subjectCascadeId ?? currentUsage?.cascadeId ?? trackedCascadeId ?? null,
            dataRevision: lastPublishedObservation?.dataRevision ?? dataRevision,
            rootCascadeId: lastPublishedObservation?.rootCascadeId ?? windowSelectionState.lockedRootId ?? null,
        }),
        getSwarmSummary: () => {
            const rootId = lastPublishedObservation?.rootCascadeId ?? windowSelectionState.lockedRootId;
            if (!rootId || !lastSwarmTopology) { return null; }
            const grp = lastSwarmTopology.groupsByRootId.get(rootId);
            if (!grp || grp.memberIds.length <= 1) { return null; }
            const rootTraj = lastTrajectories.find(t => t.cascadeId === rootId);
            return {
                rootCascadeId: rootId,
                rootTitle: rootTraj?.summary || rootId.slice(0, 8),
                activeCount: grp.activeMemberIds.length,
                totalCount: grp.memberIds.length,
                members: grp.memberIds.slice(0, 8).map(cid => {
                    const node = lastSwarmTopology!.nodesById.get(cid);
                    const tr = lastTrajectories.find(t => t.cascadeId === cid);
                    const usageSnap = allTrajectoryUsages.find(u => u.cascadeId === cid);
                    return {
                        name: node?.memberName || tr?.summary || cid.slice(0, 8),
                        pct: usageSnap && usageSnap.contextLimit > 0
                            ? Math.round((usageSnap.contextUsed / usageSnap.contextLimit) * 1000) / 10
                            : null,
                        phase: node?.killed || tr?.killed ? 'killed' : (tr?.status === CascadeStatus.RUNNING ? 'running' : 'idle'),
                        isInspected: windowSelectionState.inspectedMemberId === cid,
                    };
                }),
            };
        },
    });
}
// Bind once on module load so decoupled webview-panel.ts resolves live IDE host callbacks
bindIdePanelHostBridge();

function mergeDiskQuotaRunwaysIntoIdeTracker(): void {
    if (!durableFileGlobalState) { return; }
    const diskRunway = durableFileGlobalState.get<SerializedQuotaRunwayState | null>('quotaRunwayState', null);
    const diskWeekly = durableFileGlobalState.get<Record<string, WeeklyQuotaSeriesState> | null>('quotaRunwayWeeklyBuckets', null);
    const combined = combineSerializedRunwayWithWeekly(diskRunway, diskWeekly);
    if (combined) {
        quotaRunwayTracker.mergeFrom(combined as unknown as SerializedQuotaRunwayState);
    }
}

function persistIdeQuotaRunwaysIfDue(nowMs = Date.now(), forcePersist = false): void {
    if (!durableFileGlobalState || !runwayStateDirty) { return; }
    if (!forcePersist && lastRunwayPersistMs > 0 && (nowMs - lastRunwayPersistMs) < 30_000) {
        return;
    }
    durableState?.reloadIfChanged();
    mergeDiskQuotaRunwaysIntoIdeTracker();
    const serialized = quotaRunwayTracker.serialize();
    void durableFileGlobalState.update('quotaRunwayState', serialized);
    if (serialized.weeklyBuckets && Object.keys(serialized.weeklyBuckets).length > 0) {
        void durableFileGlobalState.update('quotaRunwayWeeklyBuckets', serialized.weeklyBuckets);
    }
    lastRunwayPersistMs = nowMs;
    runwayStateDirty = false;
}

function getCurrentWeeklyQuotaRunways(nowMs = Date.now()): Record<string, WeeklyQuotaRunwayEstimate> {
    const acct = cachedUserInfo?.email || currentAccountEmail || 'default';
    const isCustomActive = isCustomModel(currentUsage?.model, currentUsage?.modelDisplayName);
    const out: Record<string, WeeklyQuotaRunwayEstimate> = {};
    const seenPools = new Set<string>();
    for (const g of groupModelQuotas(cachedModelConfigs, cachedQuotaSummary)) {
        const poolKey = g.pool || g.key;
        if (!poolKey || seenPools.has(poolKey)) { continue; }
        seenPools.add(poolKey);
        const has7d = g.weeklyQuota?.remainingFraction !== undefined;
        out[poolKey] = quotaRunwayTracker.estimateWeekly(
            { account: acct, pool: poolKey, window: has7d ? '7d' : '5h' },
            nowMs,
            {
                modelId: currentUsage?.model,
                modelLabel: currentUsage?.modelDisplayName,
                isCustomModel: isCustomActive,
            },
        );
    }
    return out;
}

function recordQuotaRunwaysFromState(
    configs: ModelConfig[],
    quotaSummary?: UserQuotaSummary | null,
    nowMs = Date.now(),
): void {
    const acct = cachedUserInfo?.email || currentAccountEmail || 'default';
    const hasActivityEvidence = (lastGmCallActivityMs > 0 && (nowMs - lastGmCallActivityMs) < 300_000)
        || lastTrajectories.some(t => t.status === CascadeStatus.RUNNING);
    const recordedPools = new Set<string>();
    let recordedAny = false;
    if (quotaSummary?.groups) {
        for (const group of quotaSummary.groups) {
            const poolKey = group.pool || group.displayName;
            if (!poolKey) { continue; }
            const win = group.fiveHour;
            if (win && typeof win.remainingFraction === 'number' && Number.isFinite(win.remainingFraction)) {
                if (!recordedPools.has(poolKey)) {
                    recordedPools.add(poolKey);
                    const resetMs = win.resetTime ? parsePositivePoolResetMs(win.resetTime) : null;
                    quotaRunwayTracker.record(poolKey, win.remainingFraction, nowMs, resetMs);
                    quotaRunwayTracker.recordWeeklyObservation({
                        account: acct,
                        pool: poolKey,
                        window: '5h',
                        remainingFraction: win.remainingFraction,
                        timestampMs: nowMs,
                        resetTimeMs: resetMs,
                        userActivityEvidence: hasActivityEvidence,
                        surface: 'ide',
                    });
                    recordedAny = true;
                }
            }
            const wk = group.weekly;
            if (wk && typeof wk.remainingFraction === 'number' && Number.isFinite(wk.remainingFraction)) {
                const resetMs = wk.resetTime ? parsePositivePoolResetMs(wk.resetTime) : null;
                quotaRunwayTracker.recordWeeklyObservation({
                    account: acct,
                    pool: poolKey,
                    window: '7d',
                    remainingFraction: wk.remainingFraction,
                    timestampMs: nowMs,
                    resetTimeMs: resetMs,
                    userActivityEvidence: hasActivityEvidence,
                    surface: 'ide',
                });
                recordedAny = true;
            }
        }
    }
    for (const group of groupModelQuotas(configs, quotaSummary)) {
        const poolKey = group.pool || group.key;
        if (!poolKey) { continue; }
        if (!recordedPools.has(poolKey) && group.minimum !== null) {
            recordedPools.add(poolKey);
            const resetMs = group.resetTime ? parsePositivePoolResetMs(group.resetTime) : null;
            quotaRunwayTracker.record(poolKey, group.minimum, nowMs, resetMs);
            quotaRunwayTracker.recordWeeklyObservation({
                account: acct,
                pool: poolKey,
                window: '5h',
                remainingFraction: group.minimum,
                timestampMs: nowMs,
                resetTimeMs: resetMs,
                userActivityEvidence: hasActivityEvidence,
                surface: 'ide',
            });
            recordedAny = true;
        }
        const f7d = group.weeklyQuota?.remainingFraction;
        if (typeof f7d === 'number' && Number.isFinite(f7d)) {
            quotaRunwayTracker.recordWeeklyObservation({
                account: acct,
                pool: poolKey,
                window: '7d',
                remainingFraction: f7d,
                timestampMs: nowMs,
                resetTimeMs: group.weeklyQuota?.resetTime ? parsePositivePoolResetMs(group.weeklyQuota.resetTime) : null,
                userActivityEvidence: hasActivityEvidence,
                surface: 'ide',
            });
            recordedAny = true;
        }
    }
    if (recordedAny) {
        runwayStateDirty = true;
        lastWeeklyQuotaRunways = getCurrentWeeklyQuotaRunways(nowMs);
        if (typeof statusBar !== 'undefined') {
            statusBar.setWeeklyQuotaRunways(lastWeeklyQuotaRunways);
        }
    }
    persistIdeQuotaRunwaysIfDue(nowMs, false);
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
    const candidates = [trajSnap, userSnap].filter(
        (snap): snap is typeof trajSnap & { lastSuccessAtMs: number } =>
            snap.isStale && snap.lastSuccessAtMs !== null,
    );
    if (candidates.length === 0) {
        return null;
    }
    // Never let a fresher source mask an older stale source: report the stalest (oldest lastSuccessAtMs).
    candidates.sort((a, b) => a.lastSuccessAtMs - b.lastSuccessAtMs);
    const stalest = candidates[0];
    return {
        isStale: true,
        lastSuccessAtMs: stalest.lastSuccessAtMs,
        lastError: stalest.lastError,
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
    backendEpoch++;
    modelMetadataGeneration++;
    clearLiveModelSyncProvenance();
    windowSelectionState = advanceWindowBackendEpoch(windowSelectionState, backendEpoch);
    lockedMainCascadeId = windowSelectionState.lockedRootId;
    swarmRegistry.setBackendEpoch(backendEpoch);
    swarmPollScheduler.resetForBackendEpoch();
    swarmMemberInventory.reset();
    missingCascadeAbsenceCounts.clear();
    confirmedDeletedCascadeIds.clear();
    cascadeCompactionBoundaries.clear();
    branchStepPeaks.clear();
    lastPublishedObservation = null;
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
        statusBar.setPublishedObservation(null);
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
    trajectory: Pick<TrajectorySummary, 'cascadeId' | 'stepCount' | 'lastModifiedTime' | 'status' | 'branchName'> & { trajectoryId?: string },
): cached is ContextUsage {
    return !!cached
        && !cached.hasGaps
        && cached.tokenUsageSource !== undefined
        && cached.imageWorkflow !== undefined
        && (!cached.compressionDetected || cached.checkpointCompressionDrop > 0)
        && trajectory.status !== CascadeStatus.RUNNING
        && cached.status === trajectory.status
        && cached.cascadeId === trajectory.cascadeId
        && (cached.trajectoryId || '') === (trajectory.trajectoryId || '')
        && cached.branchName === trajectory.branchName
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
                .map(call => `${call.executionId || `${call.model}:${call.stepIndices.join(',')}`}:${call.createdAt || ''}`)
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
            todayCostUsd += calculateSettledEntryCosts(entry, dailyLedger.dateKey, custom, orchMode).totalCost;
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

    // Active conversation cost strictly scoped to activeCascadeId (NEVER fall back to
    // other conversations' calls when a specific conversation has 0 calls!).
    let sessionCostUsd = 0;
    let sessionHasUnpriced = false;
    if (summary && activeCascadeId) {
        const calls = summary.conversations.find(c => c.cascadeId === activeCascadeId)?.calls ?? [];
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
    const workspaceUris = getWorkspaceUris();
    const workspaceUri = workspaceUris[0];
    const isCustomActive = isCustomModel(currentUsage?.model, currentUsage?.modelDisplayName);
    const quotaRunways = getCurrentQuotaRunways();
    const staleState = getCurrentStaleState();
    const conversationOptions: ConversationOption[] = buildConversationOptions(
        lastTrajectories,
        activeId ?? null,
        windowSelectionState.lockedRootId ?? lockedMainCascadeId,
        {
            workspaceUris,
            knownSubagentIds: knownSubagentCascadeIds,
            lang: getLanguage(),
            ...getWorkspaceNormOptions(),
        },
    );
    const root = lastPublishedObservation?.rootCascadeId;
    const custom = pricingStore.getCustom();
    const group = root ? lastSwarmTopology?.groupsByRootId.get(root) : undefined;
    const swarmConversations = group ? gmTracker.getGroupCostConversations([group.rootId, ...group.memberIds]) : [];
    const swarmGroupCost = priceSwarmGroup(group, swarmConversations, call => {
        const model = selectPricingModel(call.model || call.modelDisplay, call.responseModel, custom);
        const price = findPricingForDate(model, custom, call.createdAt || '', undefined, sharedAppSettings.orchestratorPricingMode);
        return price ? costFromTokens(call, price) : null;
    });
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
        ledgerDateKey: dailyLedger.dateKey,
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
        publishedObservation: lastPublishedObservation,
        windowSelectionState,
        swarmTopology: lastSwarmTopology,
        swarmGroupCost,
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
    fullStatus: Pick<FullUserStatus, 'configs' | 'userInfo' | 'ok'>,
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
    if (fullStatus.ok === false) { return false; }
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

export async function fetchAndOverrideCheckpointerLimits(
    ls: LSInfo, logMessage: (message: string) => void = log, isCurrent: () => boolean = () => true,
): Promise<boolean> {
    try {
        logMessage('[Checkpointer Sync] Fetching official checkpointer parameters via LS RPC GetAvailableModels...');
        const resp = await rpcCall(ls, 'GetAvailableModels', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 10000);
        if (!isCurrent()) { return false; }

        const syncRes = applyModelCatalogSync(resp, {
            isInLivePicker: (resolvedId) => cachedModelConfigs.some(cfg => cfg.model === resolvedId),
        });

        if (syncRes.diagnostics.length > 0) {
            logMessage(`[Checkpointer Sync] Official checkpointer parameters fetched for ${syncRes.diagnostics.length} models.`);
        }

        const overrideCount = Object.keys(syncRes.contextLimitOverrides).length;
        if (overrideCount > 0) {
            logMessage(`[Checkpointer Sync] Dynamically resolved and overridden ${overrideCount} model context limits from official Checkpointer!`);
            return true;
        }
        if (syncRes.imageMetadataSynced) {
            logMessage('[Checkpointer Sync] Image model metadata synchronized; no chat compression limit was reported.');
            return true;
        }

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
    // Preserve `minFraction: number | null` so all-NaN / unknown pools never fabricate 100% or 0%.
    const poolMap = new Map<string, { resetTime: string; labels: string[]; modelIds: string[]; hasUsage: boolean; minFraction: number | null }>();
    for (const group of groupModelConfigsByQuotaPool(configs)) {
        poolMap.set(group.key, {
            resetTime: group.resetTime,
            labels: group.labels,
            modelIds: group.modelIds,
            hasUsage: group.minFraction !== null && group.minFraction < 1.0,
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
                log(`[DailyLedger] cycle-change settlement: ${baselinedCount} GM calls baselined, ${settled ? settled.totalCalls : 0} ledger calls settled for [${newPool.labels.slice(0, 3).join(', ')}] (${diagnosticAliasMap.aliasLabel(email)}) — resetTime changed ${oldResetTime} → ${newPool.resetTime}`);
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
        const remainingPct = pool.hasUsage && pool.minFraction !== null
            ? Math.round(pool.minFraction * 100)
            : undefined;
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
        log(`Failed to persist account billing days: ${err instanceof Error ? err.name : 'Error'}`);
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
        log(`Account switch detected: ${diagnosticAliasMap.aliasLabel(currentAccountEmail)} → ${diagnosticAliasMap.aliasLabel(newEmail)}`);

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
            log(`Account switch baseline: ${diagnosticAliasMap.aliasLabel(email)} pool [${pool.modelLabels.slice(0, 3).join(', ')}] already archived — skipped`);
            continue;
        }

        notifiedAccountResets.add(key);

        // ── Baseline GM calls for the expired pool ──
        const baselinedCount = gmTracker.baselineForQuotaReset(email, pool.modelIds || pool.modelLabels, pool.resetTime);
        // ── Settle in DailyLedger too ──
        const cutoffTime = resetMs;
        const settled = dailyLedger.settleForQuotaReset(pool.modelIds || pool.modelLabels, email, cutoffTime);
        if (baselinedCount > 0 || settled) {
            log(`Account switch baseline: ${diagnosticAliasMap.aliasLabel(email)} — ${baselinedCount} GM calls baselined for pool [${pool.modelLabels.slice(0, 3).join(', ')}]`);
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
        log(`Account switch reset notification: ${diagnosticAliasMap.aliasLabel(displayName)} — ${modelNames}${extra}`);
    }
}

async function confirmDurablePersist(): Promise<boolean> {
    if (!durableState) { return true; }
    const receipt = await durableState.flush();
    return receipt.committed;
}

/**
 * Record newly extracted GM calls into DailyLedger using Wave 1A's `recordCallsDetailed`,
 * advancing per-conversation cursors strictly via `detailed.statuses` (never skipping
 * retryable entries) and persisting whenever new calls or rewinds occurred.
 */
function recordGMCallsIntoDailyLedgerDetailed(): { added: number; extracted: number } {
    if (!gmTracker || !dailyLedger) { return { added: 0, extracted: 0 }; }
    const { entries: newEntries, revertedCascadeIds } = gmTracker.getNewCallsSinceLastRecord();
    for (const cid of revertedCascadeIds) {
        dailyLedger.clearRecordedIdsForConversation(cid);
        log(`[DailyLedger] cleared dedup IDs for reverted conversation ${diagnosticAliasMap.aliasConversation(cid)}`);
    }
    let added = 0;
    if (newEntries.length > 0) {
        const ledgerDateBeforeRecord = dailyLedger.dateKey;
        const ledgerNormalizedBeforeRecord = dailyLedger.normalizeIfStaleEmpty();
        if (ledgerNormalizedBeforeRecord) {
            log(`[DailyLedger] normalized empty ledger date ${ledgerDateBeforeRecord} → ${dailyLedger.dateKey} before recording`);
        }
        const wsUris = getWorkspaceUris();
        const enrichedEntries = enrichLedgerEntriesForIngestion(newEntries, {
            trajectories: lastTrajectories,
            activeCascadeId: currentUsage?.cascadeId ?? trackedCascadeId,
            activeWorkspaceUri: wsUris[0],
            fallbackAuthority: resolveIdeBrainRootScope(wsUris).remoteAuthority || 'local',
            fallbackAccount: cachedUserInfo?.email || currentAccountEmail,
        });
        const detailed = dailyLedger.recordCallsDetailed(enrichedEntries, 'ide');
        added = detailed.added;
        const nonAdded = detailed.statuses.filter(s => s !== 'added').length;
        log(`[DailyLedger] extracted=${newEntries.length} added=${detailed.added} non_added=${nonAdded} advance=${detailed.contiguousAdvanceCount}`);
        if (detailed.added > 0) {
            lastGmCallActivityMs = Date.now();
            durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
        }
        if (detailed.contiguousAdvanceCount > 0 || detailed.statuses.some(s => s !== 'retryable')) {
            gmTracker.markLedgerEntriesRecorded(newEntries, detailed.statuses);
        } else {
            log('[DailyLedger] ledger positions retained for retry because all entries were retryable');
        }
    }
    if (revertedCascadeIds.length > 0) {
        durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
    }
    return { added, extracted: newEntries.length };
}

/**
 * Perform daily archival asynchronously by delegating to `performDailyArchivalAsync`.
 * Runs an explicit async `preArchivalFlush` (fetching final GM telemetry before midnight
 * rollover when LS is available) and requires durable commit confirmation before draining
 * pending late-day queues.
 */
async function performDailyArchival(force = false, activeLs?: LSInfo | null): Promise<DailyArchivalResult> {
    if (!force && dailyLedger && dailyLedger.hasData && dailyLedger.dateKey && dailyLedger.dateKey !== toLocalDateKey()) {
        lastArchivalDateKey = dailyLedger.dateKey;
    }
    const lsForPreFlush = activeLs ?? cachedLsInfo;
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
        preArchivalFlush: async () => {
            if (lsForPreFlush && !disposed && gmTracker) {
                try {
                    const trajs = lastTrajectories.length > 0
                        ? lastTrajectories
                        : await getAllTrajectories(lsForPreFlush, abortController.signal);
                    if (trajs.length > 0) {
                        const gmSummary = await gmTracker.fetchAll(
                            lsForPreFlush,
                            trajs.map(t => ({
                                cascadeId: t.cascadeId,
                                title: t.summary || t.cascadeId.substring(0, 8),
                                stepCount: t.stepCount,
                                status: t.status,
                                lastModifiedTime: t.lastModifiedTime,
                                trajectoryId: t.trajectoryId,
                                killed: t.killed,
                                manifestMember: t.manifestMember,
                            })),
                            currentUsage?.cascadeId,
                            abortController.signal,
                        );
                        lastGMSummary = gmTracker.getDetailedSummary() || gmSummary;
                    }
                } catch {
                    // Non-fatal: still flush already-cached GM calls below
                }
            }
            recordGMCallsIntoDailyLedgerDetailed();
        },
        confirmPersist: confirmDurablePersist,
        persist: async (updates) => {
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
            if (durableState) {
                await durableState.flush();
            }
            syncStatusBarTelemetry(true);
        },
        log,
    };
    return performDailyArchivalAsync(ctx, force);
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    extensionContext = context;
    bindIdePanelHostBridge();
    abortController = new AbortController();
    disposed = false;
    repollNeeded = false;
    repollForceManual = false;
    displayLanguageModifiedByUser = false;
    startupArchivalPromise = null;
    legacyMigrationPromise = null;
    trackedCascadeSinceMs = undefined;
    knownSubagentCascadeIds.clear();
    missingCascadeAbsenceCounts.clear();
    confirmedDeletedCascadeIds.clear();
    cascadeCompactionBoundaries.clear();
    branchStepPeaks.clear();
    lastPublishedObservation = null;
    lastSwarmTopology = null;
    swarmPollScheduler.resetForBackendEpoch();
    swarmMemberInventory.reset();
    outputChannel = vscode.window.createOutputChannel('Antigravity Context Monitor');
    log('Extension activating...');
    const initialWorkspaceUris = getWorkspaceUris();
    const workspaceKey = initialWorkspaceUris.length > 0
        ? initialWorkspaceUris.map(u => normalizeWorkspaceUri(u, getWorkspaceNormOptions())).filter(Boolean).sort().join('|') || 'no-workspace'
        : 'no-workspace';
    windowId = `ide:${hashText(workspaceKey)}`;
    swarmRegistryScopeKey = '';
    ensureSwarmRegistryForWorkspaces(initialWorkspaceUris);
    const customStatePath = process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH?.trim() || undefined;
    durableState = new DurableState(customStatePath);
    durableGlobalState = durableState.globalBucket(context.globalState);
    durableWorkspaceState = durableState.workspaceBucket(workspaceKey, context.workspaceState);
    durableFileGlobalState = durableState.globalBucket();
    durableFileWorkspaceState = durableState.workspaceBucket(workspaceKey);

    // Inject durable state into webview-panel for zoom persistence
    setPanelDurableState(durableFileGlobalState);

    // Single-time migration of legacy top-level `lockToMainAgent` into `appSettings`
    const initialMigratedLock = durableState.resolveMigratedLegacyLock();
    lockToMainAgent = initialMigratedLock.lockToMainAgent;
    if (initialMigratedLock.needsMigrationPersist) {
        void durableState.migrateLegacyLockOnce();
    }
    windowSelectionState = createWindowSelectionState({
        backendEpoch,
        windowId,
        lockToMainAgent,
        lockedRootId: null,
    });
    pinnedConversationId = durableFileWorkspaceState.get<string | null>('pinnedConversationId', null);
    const savedRunway = durableFileGlobalState.get<SerializedQuotaRunwayState | undefined>('quotaRunwayState', undefined);
    const savedRunwayWeekly = durableFileGlobalState.get<Record<string, WeeklyQuotaSeriesState> | undefined>('quotaRunwayWeeklyBuckets', undefined);
    const combinedSavedRunway = combineSerializedRunwayWithWeekly(savedRunway, savedRunwayWeekly);
    quotaRunwayTracker = combinedSavedRunway ? QuotaRunwayTracker.deserialize(combinedSavedRunway) : new QuotaRunwayTracker();
    recoveryBriefTracker.restoreDismissedKeys(
        durableFileGlobalState.get<string[]>('dismissedRecoveryBriefKeys', []),
    );
    promptCacheTtlTracker.reset();
    lastRecordedCacheTtlCallKey = '';
    latestPromptCacheTtl = null;
    activeRecoveryBrief = null;

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

    // Initialize i18n from persisted state with IDE locale priority (`vscode.env.language` before OS/Node)
    initI18nForIde(context, durableGlobalState);

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

    pricingStore = new PricingStore();
    pricingStore.init(durableGlobalState);
    // Hydrate v1.18 shared app settings BEFORE restoring ActivityTracker so constructor-injected limits apply immediately
    hydrateSharedAppSettingsFromDisk(true);

    // Initialize activity tracker with constructor-injected retention limits (zero vscode dependency in ActivityTracker)
    const activityCfg = {
        maxRecentSteps: sharedAppSettings.activityMaxRecentSteps,
        maxArchives: sharedAppSettings.activityMaxArchives,
    };
    const savedActivity = durableGlobalState.get<ActivityTrackerState | undefined>('activityTrackerState', undefined);
    activityTracker = savedActivity ? ActivityTracker.restore(savedActivity, activityCfg) : new ActivityTracker(activityCfg);
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

    // Restore daily archival date key BEFORE checking for cross-day startup archival
    lastArchivalDateKey = durableGlobalState.get<string>('lastArchivalDateKey', '');

    // ── Immediate cross-day archival on startup (async, awaited before first poll) ──
    // If the ledger has data from a previous day (IDE was off overnight),
    // archive it immediately — without blocking activate() synchronously.
    if (dailyLedger.hasData && dailyLedger.dateKey !== toLocalDateKey()) {
        log(`[Startup] Ledger has stale data from ${dailyLedger.dateKey}, archiving immediately`);
        // Override lastArchivalDateKey to the stale date so performDailyArchivalAsync's
        // "sameDay" guard doesn't reject it (it may already be today's date if a
        // previous instance or polling cycle set it without rolling over the ledger).
        lastArchivalDateKey = dailyLedger.dateKey;
        startupArchivalPromise = performDailyArchival(false, null)
            .then(() => {
                const backfilled = dailyStore.backfillMissingCosts(pricingStore.getCustom());
                if (backfilled > 0) {
                    log(`Cost backfill (post-startup archival): re-priced ${backfilled} archived per-model row(s)`);
                }
            })
            .catch((archErr) => {
                log(`[Startup] Cross-day archival failed: ${archErr instanceof Error ? archErr.name : 'Error'}`);
            })
            .finally(() => {
                startupArchivalPromise = null;
            });
    }

    // ── One-time migration: auto-recover data from legacy Antigravity (pre-2.0) ──
    // Non-blocking async runner (`runLegacyMigrationOnceAsync`) with `settingsGuard`
    // so user edits made during async activation are NEVER clobbered.
    try {
        const migrationDir = path.dirname(durableState.getFilePath());
        const migrationDone = durableFileGlobalState.get<boolean>('legacyMigrationDone', false);
        const initialPersistedDisplayLang =
            durableGlobalState.get<string | undefined>('displayLanguage', undefined)
            ?? context.globalState.get<string | undefined>('displayLanguage', undefined);

        // --- Auto-detect old Antigravity DB (non-blocking async) ---
        if (!migrationDone) {
            legacyMigrationPromise = runLegacyMigrationOnceAsync({
                migrationDone,
                extractLegacyData: () => extractLegacyDataAsync(log),
                settingsGuard: {
                    getCurrentDisplayLanguage: () =>
                        durableGlobalState.get<string | undefined>('displayLanguage', undefined)
                        ?? context.globalState.get<string | undefined>('displayLanguage', undefined)
                        ?? getLanguage(),
                    isDisplayLanguageModified: () =>
                        displayLanguageModifiedByUser || Boolean(initialPersistedDisplayLang),
                },
                importLegacyData: async (legacyData) => {
                    if (disposed) { return; }
                    if (legacyData.dailyStoreState) {
                        const added = dailyStore.mergeRecords(legacyData.dailyStoreState);
                        log(`Legacy migration: merged ${added} calendar records`);
                        if (added > 0) {
                            const backfilled = dailyStore.backfillMissingCosts(pricingStore.getCustom());
                            if (backfilled > 0) {
                                log(`Legacy migration cost backfill: re-priced ${backfilled} archived per-model row(s)`);
                            }
                        }
                    }
                    if (legacyData.displayLanguage && ['zh', 'en', 'both'].includes(legacyData.displayLanguage)) {
                        await setLanguageToState(legacyData.displayLanguage as any, durableGlobalState);
                        await context.globalState.update('displayLanguage', legacyData.displayLanguage);
                        log(`Legacy migration: restored language to '${legacyData.displayLanguage}'`);
                        if (typeof statusBar !== 'undefined') {
                            statusBar.refreshFromConfig();
                        }
                        if (isMonitorPanelVisible()) {
                            refreshMonitorPanelLanguage();
                        }
                    }
                    if (durableState) {
                        await durableState.flush();
                    }
                },
                markDone: async () => {
                    await durableFileGlobalState.update('legacyMigrationDone', true);
                    if (durableState) {
                        await durableState.flush();
                    }
                },
                log,
            }).catch((migrationAsyncErr) => {
                log(`Legacy migration (async): failed — ${migrationAsyncErr instanceof Error ? migrationAsyncErr.name : 'Error'}`);
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
            if (
                migration.displayLanguage
                && ['zh', 'en', 'both'].includes(migration.displayLanguage)
                && !displayLanguageModifiedByUser
                && !initialPersistedDisplayLang
            ) {
                setLanguageToState(migration.displayLanguage as any, durableGlobalState);
                context.globalState.update('displayLanguage', migration.displayLanguage);
                log(`Migration: restored language preference to '${migration.displayLanguage}'`);
            }
            const donePath = migrationFile.replace('.json', '.done.json');
            fs.renameSync(migrationFile, donePath);
            log(`Migration: completed, input file archived`);
        }
    } catch (migrationErr) {
        log(`Migration: failed — ${migrationErr instanceof Error ? migrationErr.name : 'Error'}`);
    }

    // ── Self-healing cost backfill ──
    // Days archived while their model had no price row carry no cost. Re-pricing them from
    // their stored tokens only fills gaps and never overwrites, so it runs on every startup
    // rather than behind a "migration done" flag: a row still unpriced today is filled by
    // whichever future release adds that price.
    const backfilledCostRows = dailyStore.backfillMissingCosts(pricingStore.getCustom());
    if (backfilledCostRows > 0) {
        log(`Cost backfill: re-priced ${backfilledCostRows} archived per-model row(s) that had no cost`);
    }

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
            const initialTab = resolveMonitorCommandDestination(destination) as PanelPayload['initialTab'];
            showMonitorPanel(makePanelPayload({ context, initialTab }));
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.refresh', () => {
            log('Manual refresh triggered');
            statusBar.refreshFromConfig();
            // Revalidate the live connection. An unchanged backend retains its inspected member.
            lsRevalidationCounter = LS_REVALIDATION_INTERVAL;
            statusPollCount = STATUS_REFRESH_INTERVAL;
            hasSyncedCheckpointer = false;
            checkpointerSyncAttempts = 0;
            consecutiveFailures = 0;
            currentIntervalMs = baseIntervalMs;
            restartPolling();
            pollContextUsage(true);
        }),
        vscode.commands.registerCommand('antigravity-context-monitor.switchLanguage', () => {
            showLanguagePicker(context, durableGlobalState).then(async () => {
                markDisplayLanguageModified();
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

                if (e.affectsConfiguration('antigravityContextMonitor.cdpOverlayFontSize')) {
                    const nextFont = normalizeCdpOverlayFontSize(cfgNow.get<string>('cdpOverlayFontSize', 'normal'));
                    if (nextFont !== sharedCdpOverlayFontSize) {
                        sharedCdpOverlayFontSize = nextFont;
                        if (durableState) {
                            void durableState.updateGlobalWithReceipt('cdpOverlayFontSize', nextFont).then(() => durableState.flush());
                        }
                        if (isMonitorPanelVisible()) { syncMonitorPanelSettings(); }
                    }
                }
                if (e.affectsConfiguration('antigravityContextMonitor.cdpOverlayHighContrast')) {
                    const nextHc = Boolean(cfgNow.get<boolean>('cdpOverlayHighContrast', false));
                    if (nextHc !== sharedCdpOverlayHighContrast) {
                        sharedCdpOverlayHighContrast = nextHc;
                        if (durableState) {
                            void durableState.updateGlobalWithReceipt('cdpOverlayHighContrast', nextHc).then(() => durableState.flush());
                        }
                        if (isMonitorPanelVisible()) { syncMonitorPanelSettings(); }
                    }
                }

                let planChanged = false;
                if (e.affectsConfiguration('antigravityContextMonitor.subscriptionPlan')) {
                    const nextPlan = inferIdeSubscriptionPlan(cfgNow.get<string>('subscriptionPlan', 'none'), patch.subscriptionMonthlyFee ?? sharedAppSettings.subscriptionMonthlyFee);
                    if (nextPlan !== sharedSubscriptionPlan) {
                        sharedSubscriptionPlan = nextPlan;
                        planChanged = true;
                        const preset = SUBSCRIPTION_PLAN_PRESETS[nextPlan];
                        if (nextPlan === 'none') {
                            patch.subscriptionMonthlyFee = null;
                            anyChanged = true;
                        } else if (preset.monthlyUsd > 0) {
                            patch.subscriptionMonthlyFee = preset.monthlyUsd;
                            patch.subscriptionCurrency = 'USD';
                            anyChanged = true;
                        }
                    }
                }

                if (anyChanged || planChanged) {
                    if (patch.displayCurrency !== undefined && patch.displayCurrency !== sharedAppSettings.displayCurrency) {
                        const switched = switchDisplayCurrency(
                            {
                                displayCurrency: sharedAppSettings.displayCurrency,
                                customFxRate: sharedAppSettings.customFxRate,
                                customFxCurrency: sharedAppSettings.customFxCurrency,
                            },
                            patch.displayCurrency,
                        );
                        patch.customFxRate = switched.customFxRate;
                        patch.customFxCurrency = switched.customFxCurrency;
                    } else if (patch.customFxRate !== undefined) {
                        const bound = bindCustomFxRate(
                            patch.displayCurrency ?? sharedAppSettings.displayCurrency,
                            patch.customFxRate,
                        );
                        patch.customFxCurrency = bound.customFxCurrency;
                    }
                    if (patch.showNativeHudBar !== undefined) {
                        patch.ideShowNativeHudBar = patch.showNativeHudBar;
                    }
                    if (planChanged) {
                        patch.subscriptionPlan = sharedSubscriptionPlan;
                    }
                    if (orchModeChanged && patch.orchestratorPricingMode && pricingStore) {
                        void pricingStore.setOrchestratorPricingMode(patch.orchestratorPricingMode);
                    }
                    if (retentionChanged && typeof patch.calendarRetentionDays === 'number' && dailyStore) {
                        dailyStore.setMaxDays(patch.calendarRetentionDays);
                    }
                    if (
                        (typeof patch.activityMaxRecentSteps === 'number' || typeof patch.activityMaxArchives === 'number')
                        && activityTracker
                    ) {
                        activityTracker.updateConfig({
                            ...(typeof patch.activityMaxRecentSteps === 'number' ? { maxRecentSteps: patch.activityMaxRecentSteps } : {}),
                            ...(typeof patch.activityMaxArchives === 'number' ? { maxArchives: patch.activityMaxArchives } : {}),
                        });
                    }
                    sharedAppSettings = { ...sharedAppSettings, ...patch };
                    if (durableState) {
                        void durableState.patchAppSettings(patch).then(async (updated) => {
                            sharedAppSettings = updated;
                            lastSyncedDiskAppSettings = { ...updated };
                            if (planChanged && durableFileGlobalState) {
                                await durableFileGlobalState.update('subscriptionPlan', sharedSubscriptionPlan);
                            }
                            await durableState.flush();
                        });
                    }
                    applyDisplayPrefs();
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
        // the cached LS and tracked cascade may be stale. Mark `repollNeeded = true`
        // so an active poll never drops the change, and force full re-discovery so
        // trajectories are re-filtered across ALL active multi-root workspace folders.
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            log('Workspace folders changed — marking repollNeeded and forcing LS re-discovery');
            cachedLsInfo = null;
            invalidateLiveModelMetadata();
            ensureSwarmRegistryForWorkspaces(getWorkspaceUris());
            trackedCascadeId = null;
            trackedCascadeSinceMs = undefined;
            lastPolledWorkspaceUri = undefined;
            consecutiveFailures = 0;
            currentIntervalMs = baseIntervalMs;
            lsRevalidationCounter = 0;
            consecutiveIdlePolls = 0;
            stalenessConfirmedIdle = false;
            repollNeeded = true;
            restartPolling();
            if (!isPolling) {
                void pollContextUsage();
            }
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
    repollNeeded = false;
    repollForceManual = false;
    hasHydratedSharedSettings = false;
    cachedLsInfo = null;
    lastUpdateStatusView = null;
    lastContextBreakdownKey = '';
    firstPollDone = false;
    trackedCascadeId = null;
    trackedCascadeSinceMs = undefined;
    lastPolledWorkspaceUri = undefined;
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
    persistIdeQuotaRunwaysIfDue(Date.now(), true);
    if (durableState) {
        await durableState.flush();
    }
    if (pendingUpdates.length > 0) {
        await Promise.allSettled(pendingUpdates);
    }
    cachedUserInfo = null;
    cachedModelConfigs = [];
    currentAccountEmail = '';
    accountSnapshots.clear();
    billingDaysMap = {};
    lastGMSummary = null;
    currentUsage = null;
    allTrajectoryUsages = [];
    lastTrajectories = [];
    pinnedConversationId = null;
    lockedMainCascadeId = null;
    lastPublishedObservation = null;
    lastSwarmTopology = null;
    windowSelectionState = createWindowSelectionState({ backendEpoch, windowId: 'ide-default' });
    swarmPollScheduler.resetForBackendEpoch();
    swarmMemberInventory.reset();
    missingCascadeAbsenceCounts.clear();
    confirmedDeletedCascadeIds.clear();
    cascadeCompactionBoundaries.clear();
    branchStepPeaks.clear();
    knownSubagentCascadeIds.clear();
    previousStepCounts.clear();
    previousTrajectoryIds.clear();
    previousContextObservations.clear();
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
    statusBar.setCurrencyConfig({
        code: sharedAppSettings.displayCurrency,
        customRatePerUsd: sharedAppSettings.customFxRate,
        customFxCurrency: sharedAppSettings.customFxCurrency,
    });
    statusBar.setQuotaDisplayModes({
        quotaWindowMode: sharedAppSettings.quotaWindowMode,
        quotaDirectionMode: sharedAppSettings.quotaDirectionMode,
        speedMetricMode: sharedAppSettings.speedMetricMode,
    });
    statusBar.setWeeklyQuotaRunways(lastWeeklyQuotaRunways);
    statusBar.setPromptCacheTtl(latestPromptCacheTtl);
    statusBar.setBillingDay(billingDaysMap[currentAccountEmail] ?? 0);
}

/**
 * Push live account-filtered GM telemetry into StatusBarManager.
 * Pass `activeCascadeOverride = null` when idle/no-conversation to fall back to session scope.
 */
function syncStatusBarTelemetry(refresh = false, activeCascadeOverride?: string | null): void {
    if (typeof statusBar === 'undefined' || typeof gmTracker === 'undefined') { return; }
    statusBar.setCurrencyConfig({
        code: sharedAppSettings.displayCurrency,
        customRatePerUsd: sharedAppSettings.customFxRate,
        customFxCurrency: sharedAppSettings.customFxCurrency,
    });
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
 * Extract the latest GM contextTokensUsed for a given cascade from a GMSummary via the
 * shared rewind/compaction-safe `getLatestGMContextUsedForCascade` selector.
 */
function getLatestGMContextUsed(summary: GMSummary, cascadeId: string): number {
    const boundary = cascadeCompactionBoundaries.get(cascadeId);
    return getLatestGMContextUsedForCascade(
        summary,
        cascadeId,
        boundary ? { compactionBoundary: boundary } : undefined,
    );
}

/** Fill missing provider usage with the GM pre-request context estimate. */
export function applyGMContextToUsage(usage: ContextUsage, gmContextUsed: number): boolean {
    if (usage.postCompactionPending || usage.lastModelUsage || !Number.isSafeInteger(gmContextUsed)
        || gmContextUsed <= 0 || gmContextUsed === usage.contextUsed) { return false; }
    usage.contextUsed = gmContextUsed;
    // The source field is estimatedTokensUsed, not a measured provider token count.
    usage.isEstimated = true;
    usage.usagePercent = usage.contextLimit > 0
        ? (gmContextUsed / usage.contextLimit) * 100 : 0;
    return true;
}

// ─── Polling Logic ────────────────────────────────────────────────────────────

function applyFullUserStatusIfOk(
    fullStatus: FullUserStatusFetchResult,
    lsForAux: LSInfo,
    contextLabel: string,
): boolean {
    if (fullStatus.ok !== true) {
        const errMsg = fullStatus.error || `GetUserStatus returned ok=false (${contextLabel})`;
        userStatusStaleGuard.recordFailure(errMsg);
        if (typeof statusBar !== 'undefined') {
            statusBar.setStaleState(getCurrentStaleState());
        }
        log(`GetUserStatus failed (${contextLabel})`);
        return false;
    }
    userStatusStaleGuard.recordSuccess(fullStatus);
    if (typeof statusBar !== 'undefined') {
        statusBar.setStaleState(getCurrentStaleState());
    }
    if (applyLiveModelStatus(fullStatus)) {
        log(`Updated model display names (${contextLabel}): ${fullStatus.configs.map(c => c.label).join(', ')}`);
    }
    if (fullStatus.userInfo) {
        cachedUserInfo = fullStatus.userInfo;
        updateStatusBarCredits(fullStatus.userInfo);
        statusBar.setPlanName(fullStatus.userInfo.planName, fullStatus.userInfo.userTierName);
        durableGlobalState.update('cachedModelConfigs', cachedModelConfigs);
        durableGlobalState.update('cachedPlanName', fullStatus.userInfo.planName);
        durableGlobalState.update('cachedTierName', fullStatus.userInfo.userTierName);
        log(`User plan (${contextLabel}): ${fullStatus.userInfo.planName}`);
        updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
    }
    triggerLiveAuxiliaryMetadataRefresh(lsForAux, cachedModelConfigs, modelMetadataGeneration, abortController.signal);
    return true;
}

async function fetchFullStatusViaPollCache(
    pollCache: PollRpcCache,
    ls: LSInfo,
    signal?: AbortSignal,
): Promise<FullUserStatusFetchResult> {
    return pollCache.getOrFetch(
        {
            backendEpoch,
            authority: getLsAuthority(ls),
            method: 'GetUserStatus',
            cascadeId: '',
            range: 'all',
            branchRevision: `epoch:${backendEpoch}`,
        },
        (upstreamSignal) => fetchFullUserStatus(ls, upstreamSignal),
        signal,
        { shouldCache: (res) => res.ok === true },
    );
}

async function fetchAllTrajectoriesViaPollCache(
    pollCache: PollRpcCache,
    ls: LSInfo,
    signal?: AbortSignal,
): Promise<TrajectorySummary[]> {
    return pollCache.getOrFetch(
        {
            backendEpoch,
            authority: getLsAuthority(ls),
            method: 'GetAllCascadeTrajectories',
            cascadeId: '',
            range: 'all',
            branchRevision: `epoch:${backendEpoch}`,
        },
        (upstreamSignal) => getAllTrajectories(ls, upstreamSignal),
        signal,
    );
}

function pollContextUsage(isManualRefresh = false): Promise<void> {
    return withTrajectoryPollBudget(DEFAULT_SWARM_POLL_BUDGET, () => runContextPoll(isManualRefresh));
}

async function runContextPoll(isManualRefresh: boolean): Promise<void> {
    if (isPolling) {
        if (isManualRefresh) {
            repollNeeded = true;
            repollForceManual = true;
            if (typeof statusBar !== 'undefined') {
                statusBar.showInitializing();
            }
        }
        return;
    }
    isPolling = true;
    repollNeeded = false;
    repollForceManual = false;
    const pollCache = new PollRpcCache();
    let lsInfo = cachedLsInfo;
    const fetchMemberMetadata = (ls: LSInfo, id: string) => pollCache.getOrFetch(
        { backendEpoch, authority: getLsAuthority(ls), method: 'GetCascadeTrajectoryGeneratorMetadata', cascadeId: id, range: 'all', branchRevision: 'manifest-member' },
        signal => fetchTrajectoryGeneratorMetadataResult(ls, id, signal),
        abortController.signal, { shouldCache: result => result.ok },
    );
    try {
        if (startupArchivalPromise) {
            await startupArchivalPromise;
        }

        // 1. Determine multi-root workspace URIs for this window
        const workspaceUris = getWorkspaceUris();
        const workspaceUri = workspaceUris[0];
        const normOpts = getWorkspaceNormOptions();
        const workspaceSignature = buildWorkspaceSignature(workspaceUris, normOpts);
        ensureSwarmRegistryForWorkspaces(workspaceUris);

        // ─── Workspace URI Change Detection (fallback) ──────────────────
        // If the workspace folder set changed since the last poll (e.g., user opened
        // a different folder or added/removed a multi-root folder), invalidate the
        // cached LS and tracked cascade so we re-discover and re-filter trajectories.
        if (lastPolledWorkspaceUri !== undefined && lastPolledWorkspaceUri !== workspaceSignature) {
            log(`Workspace folders changed: ${workspaceUris.length} registered roots — resetting LS cache`);
            cachedLsInfo = null;
            invalidateLiveModelMetadata();
            lsInfo = null;
            trackedCascadeId = null;
            trackedCascadeSinceMs = undefined;
            consecutiveIdlePolls = 0;
            stalenessConfirmedIdle = false;
        }
        lastPolledWorkspaceUri = workspaceSignature;

        // Hot-reload shared DurableState changes written externally (e.g. by App Sidecar)
        syncFromDurableStateIfChanged(false);

        // 午夜归档必须在本轮轮询前半段执行（异步等待 preArchivalFlush 与持久化确认）：
        // 1. 不能被“无会话 / 无活跃对话”的提前 return 跳过
        // 2. 新一天的 GM / DailyLedger 记录必须建立在已 rollover 的干净状态上
        await withoutTrajectoryPollBudget(() => performDailyArchival(false, lsInfo));

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
            const discoveryEpoch = backendEpoch;
            lsInfo = await discoverLanguageServer(workspaceUri, abortController.signal, log);
            if (disposed || backendEpoch !== discoveryEpoch) {
                log('Discarding stale LS discovery result after workspace/backend invalidation');
                return;
            }
            cachedLsInfo = lsInfo;
            lsRevalidationCounter = 0;
            consecutiveIdlePolls = 0;

            if (!lsInfo) {
                handleLsFailure('LS not found', true);
                return;
            }
            resetBackoff();
            log(`LS found: pid=${lsInfo.pid} port=${lsInfo.port}, tls=${lsInfo.useTls}${lsInfo.hostname ? `, host=${lsInfo.hostname}` : ''}`);

            // Dynamically update model display names from GetUserStatus (verify fullStatus.ok === true)
            try {
                const fullStatus = await fetchFullStatusViaPollCache(pollCache, lsInfo, abortController.signal);
                applyFullUserStatusIfOk(fullStatus, lsInfo, 'initial');
            } catch (statusErr) {
                userStatusStaleGuard.recordFailure(statusErr);
                statusBar.setStaleState(getCurrentStaleState());
            }
        } else {
            // ─── Periodic LS Connection Revalidation ─────────────────────────
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
                        // Re-fetch user status from new LS (verify fullStatus.ok === true)
                        try {
                            const fullStatus = await fetchFullStatusViaPollCache(pollCache, lsInfo, abortController.signal);
                            applyFullUserStatusIfOk(fullStatus, lsInfo, 'revalidation');
                        } catch (statusErr) {
                            userStatusStaleGuard.recordFailure(statusErr);
                            statusBar.setStaleState(getCurrentStaleState());
                        }
                    }
                } catch {
                    log('LS revalidation: discovery failed, keeping current connection');
                }
            }

            // Periodic refresh of user status (every STATUS_REFRESH_INTERVAL polls)
            statusPollCount++;
            if (statusPollCount >= STATUS_REFRESH_INTERVAL || !firstPollDone) {
                statusPollCount = 0;
                try {
                    const fullStatus = await fetchFullStatusViaPollCache(pollCache, lsInfo, abortController.signal);
                    applyFullUserStatusIfOk(fullStatus, lsInfo, 'periodic');
                } catch (statusErr) {
                    userStatusStaleGuard.recordFailure(statusErr);
                    statusBar.setStaleState(getCurrentStaleState());
                }
            }
        }

        // Dynamically override context limits once per LS connection, with BOUNDED retry on failure.
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

        // 3. Get all trajectories (deduplicated per poll via PollRpcCache)
        let trajectories: TrajectorySummary[];
        try {
            trajectories = await fetchAllTrajectoriesViaPollCache(pollCache, lsInfo, abortController.signal);
            trajectoriesStaleGuard.recordSuccess(trajectories);
            statusBar.setStaleState(getCurrentStaleState());
        } catch (err) {
            log(`RPC failed, retrying discovery: ${err instanceof Error ? err.name : 'Error'}`);
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
            // Verify fullStatus.ok === true on RPC-failure rediscovery path
            try {
                const fullStatus = await fetchFullStatusViaPollCache(pollCache, lsInfo, abortController.signal);
                applyFullUserStatusIfOk(fullStatus, lsInfo, 'rediscovery');
            } catch (statusErr) {
                userStatusStaleGuard.recordFailure(statusErr);
                statusBar.setStaleState(getCurrentStaleState());
            }
            trajectories = await fetchAllTrajectoriesViaPollCache(pollCache, lsInfo, abortController.signal);
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

        // 4. Multi-root workspace filtering (Remote-SSH / WSL / APFS-safe via conversation-selector.ts)
        let qualifiedTrajectories = filterTrajectoriesByWorkspaces(trajectories, workspaceUris, normOpts);
        let qualifiedRunning = qualifiedTrajectories.filter(t => t.status === CascadeStatus.RUNNING);

        log(`Trajectories: ${trajectories.length} total, ${qualifiedTrajectories.length} qualified across ${workspaceUris.length} ws root(s), ${qualifiedRunning.length} running in ws`);

        // ─── Staleness Heuristic ───────────────────────────────────────────
        if (qualifiedRunning.length === 0 && trackedCascadeId) {
            consecutiveIdlePolls++;
            if (consecutiveIdlePolls >= STALE_LS_IDLE_THRESHOLD && !stalenessConfirmedIdle) {
                log(`⚠ Staleness detected: tracked cascade ${diagnosticAliasMap.aliasConversation(trackedCascadeId)} has been IDLE for ${consecutiveIdlePolls} consecutive polls. Forcing LS re-discovery.`);
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
                        // Verify fullStatus.ok === true on staleness rediscovery path
                        try {
                            const fullStatus = await fetchFullStatusViaPollCache(pollCache, lsInfo, abortController.signal);
                            applyFullUserStatusIfOk(fullStatus, lsInfo, 'staleness_rediscovery');
                        } catch (statusErr) {
                            userStatusStaleGuard.recordFailure(statusErr);
                            statusBar.setStaleState(getCurrentStaleState());
                        }
                        trajectories = await fetchAllTrajectoriesViaPollCache(pollCache, lsInfo, abortController.signal);
                        lastTrajectories = trajectories;
                        qualifiedTrajectories = filterTrajectoriesByWorkspaces(trajectories, workspaceUris, normOpts);
                        qualifiedRunning = qualifiedTrajectories.filter(t => t.status === CascadeStatus.RUNNING);
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

        // ─── Bounded Swarm Topology Sweep & Reconciliation (Remote-SSH/WSL safe) ─
        const presentCascadeIds = new Set(trajectories.map(t => t.cascadeId));
        for (const cid of presentCascadeIds) {
            missingCascadeAbsenceCounts.delete(cid);
            confirmedDeletedCascadeIds.delete(cid);
        }
        const trackedAbsenceCandidates = new Set<string>([
            ...previousTrajectoryIds,
            ...(windowSelectionState.lockedRootId ? [windowSelectionState.lockedRootId] : []),
            ...(windowSelectionState.inspectedMemberId ? [windowSelectionState.inspectedMemberId] : []),
        ]);
        for (const cid of trackedAbsenceCandidates) {
            if (!presentCascadeIds.has(cid)) {
                const count = (missingCascadeAbsenceCounts.get(cid) ?? 0) + 1;
                missingCascadeAbsenceCounts.set(cid, count);
                if (count >= 2) {
                    confirmedDeletedCascadeIds.add(cid);
                }
            }
        }
        try {
            const priorityIds = [
                windowSelectionState.lockedRootId,
                windowSelectionState.inspectedMemberId,
                trackedCascadeId,
            ].filter((x): x is string => Boolean(x));
            await swarmRegistry.sweepManifests({ priorityCascadeIds: priorityIds });
            lastSwarmTopology = swarmRegistry.reconcile({
                backendEpoch,
                trajectories,
                deletedConversationIds: confirmedDeletedCascadeIds,
            });
            for (const [cid] of lastSwarmTopology.nodesById) {
                if (swarmRegistry.isKnownWorkerOrSubagent(cid)) {
                    knownSubagentCascadeIds.add(cid);
                }
            }
        } catch {
            // Non-fatal: continue with RPC trajectories if manifest sweep errors
        }

        if (lastSwarmTopology) {
            const inspected = windowSelectionState.inspectedMemberId;
            const epoch = backendEpoch;
            trajectories = await withTrajectoryRequestShare(() => swarmMemberInventory.expand(
                trajectories, lastSwarmTopology!, [inspected, pinnedConversationId, windowSelectionState.lockedRootId, trackedCascadeId, qualifiedTrajectories[0]?.cascadeId],
                inspected, id => readUnlistedMemberStepCount(lsInfo!, id, abortController.signal, fetchMemberMetadata), Date.now(),
            ));
            if (epoch !== backendEpoch || abortController.signal.aborted) { return; }
            for (const tr of trajectories) {
                if (tr.manifestMember) {
                    missingCascadeAbsenceCounts.delete(tr.cascadeId);
                    confirmedDeletedCascadeIds.delete(tr.cascadeId);
                }
            }
            lastTrajectories = trajectories;
            qualifiedTrajectories = filterTrajectoriesByWorkspaces(trajectories, workspaceUris, normOpts);
        }

        // ─── Unified 3-Field Lock & Worker-Isolated Multi-Root IDE Selection ─
        const newlyCreatedIds = firstPollDone
            ? new Set(trajectories.filter(t => !previousTrajectoryIds.has(t.cascadeId)).map(t => t.cascadeId))
            : undefined;
        let resolved: ReturnType<typeof resolveIdeAutoFollowConversation>;
        if (windowSelectionState.lockToMainAgent || windowSelectionState.inspectedMemberId !== null) {
            const selRes = selectConversation(windowSelectionState, {
                trajectories,
                backendEpoch,
                workspaceUris,
                pinnedId: pinnedConversationId,
                currentActiveId: trackedCascadeId,
                currentActiveSinceMs: trackedCascadeSinceMs,
                knownSubagentIds: knownSubagentCascadeIds,
                newlyCreatedIds,
                deletedConversationIds: confirmedDeletedCascadeIds,
                strictWorkspaceIsolation: true,
                isolateWorkers: true,
                topologyResolveRootId: (id) => swarmRegistry.resolveRootId(id),
                ...normOpts,
            });
            windowSelectionState = selRes.state;
            resolved = selRes.resolution;
            lockedMainCascadeId = windowSelectionState.lockedRootId;
        } else {
            resolved = resolveIdeAutoFollowConversation({
                trajectories,
                workspaceUris,
                pinnedId: pinnedConversationId,
                lockToMainAgent,
                lockedMainId: lockedMainCascadeId,
                currentActiveId: trackedCascadeId,
                currentActiveSinceMs: trackedCascadeSinceMs,
                knownSubagentIds: knownSubagentCascadeIds,
                newlyCreatedIds,
                previousStepCounts: firstPollDone ? previousStepCounts : undefined,
                strictWorkspaceIsolation: true,
                isolateWorkers: true,
                ...normOpts,
            });
            lockedMainCascadeId = resolved.lockedMainId;
        }
        if (resolved.pinnedFallback && pinnedConversationId) {
            log(`Pinned conversation ${diagnosticAliasMap.aliasConversation(pinnedConversationId)} no longer exists — returning to auto-follow`);
            pinnedConversationId = null;
            if (durableFileWorkspaceState) {
                void durableFileWorkspaceState.update('pinnedConversationId', null);
            }
        }
        const newCandidateId = resolved.cascadeId;
        let selectionReason = resolved.reason;
        if (resolved.ignoredSubagentBurst) {
            log(`Ignored background subagent/worker burst while tracking ${diagnosticAliasMap.aliasConversation(newCandidateId) || 'none'} (${selectionReason})`);
        }

        // Update tracked cascade
        if (newCandidateId) {
            if (trackedCascadeId !== newCandidateId) {
                log(`Switched cascade: ${diagnosticAliasMap.aliasConversation(trackedCascadeId) || 'none'} → ${diagnosticAliasMap.aliasConversation(newCandidateId)} (${selectionReason})`);
                trackedCascadeId = newCandidateId;
                trackedCascadeSinceMs = Date.now();
                consecutiveIdlePolls = 0;
                stalenessConfirmedIdle = false;
                clearActiveContextTelemetry();
            } else if (selectionReason) {
                log(`Refreshing cascade ${diagnosticAliasMap.aliasConversation(trackedCascadeId)} (${selectionReason})`);
            }
        } else if (trackedCascadeId) {
            const currentTracked = qualifiedTrajectories.find(t => t.cascadeId === trackedCascadeId)
                || trajectories.find(t => t.cascadeId === trackedCascadeId);
            if (!currentTracked) {
                log(`Tracked cascade ${diagnosticAliasMap.aliasConversation(trackedCascadeId)} no longer in any list, clearing`);
                trackedCascadeId = null;
                trackedCascadeSinceMs = undefined;
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
            lastPublishedObservation = null;
            statusBar.setPublishedObservation(null);
            syncStatusBarTelemetry(false, null);
            statusBar.showIdle(idleLimitStr, lastKnownModel);
            currentUsage = null;
            clearActiveContextTelemetry();
            allTrajectoryUsages = monitorStore.getAll();
            if (isMonitorPanelVisible()) {
                updateMonitorPanel(makePanelPayload({ currentUsage: null, publishedObservation: null }));
            }
            updateBaselines(trajectories);
            return;
        }

        log(`Selected: (${diagnosticAliasMap.aliasConversation(activeTrajectory.cascadeId)}) reason=${selectionReason} status=${activeTrajectory.status}`);

        // 5. Get context usage for selected trajectory
        const persistedUsage = monitorStore.getSnapshot(activeTrajectory.cascadeId);
        const activeReadAge = Date.now() - lastActiveUsageReadAt;
        const recheckActive = isManualRefresh || !lastContextBreakdownKey || activeReadAge < 0 || activeReadAge >= ACTIVE_TELEMETRY_RECHECK_MS;
        if (!recheckActive && hasSameUsageInputs(currentUsage, activeTrajectory)) {
            currentUsage = await refreshWorkflowImageUsage(lsInfo, rehydrateUsageForDisplay(currentUsage), abortController.signal);
        } else if (!recheckActive && hasSameUsageInputs(persistedUsage, activeTrajectory)) {
            currentUsage = await refreshWorkflowImageUsage(lsInfo, rehydrateUsageForDisplay(persistedUsage), abortController.signal);
        } else {
            currentUsage = await getContextUsage(lsInfo, activeTrajectory, undefined, abortController.signal);
            lastActiveUsageReadAt = Date.now();
        }
        const linkedForActive = currentUsage.imageWorkflow?.linkedCascadeIds || [];
        if (linkedForActive.length > 0) {
            const rpcLinks: RpcTopologyLinkProjection[] = [];
            const observedAtMs = Date.now();
            for (const linkedId of linkedForActive) {
                if (!linkedId) { continue; }
                knownSubagentCascadeIds.add(linkedId);
                rpcLinks.push({
                    parentCascadeId: currentUsage.cascadeId,
                    childCascadeId: linkedId,
                    kind: 'direct_subagent',
                    observedAtMs,
                });
            }
            if (rpcLinks.length > 0) {
                swarmRegistry.ingestRpcProjections(rpcLinks, backendEpoch);
            }
        }
        log(`  → contextUsed=${currentUsage.contextUsed} model=${currentUsage.model} steps=${currentUsage.stepCount} estimated=${currentUsage.isEstimated} ckpt_in=${currentUsage.lastModelUsage?.inputTokens ?? 'none'} ckpt_out=${currentUsage.lastModelUsage?.outputTokens ?? 'none'} estDelta=${currentUsage.estimatedDeltaSinceCheckpoint}`);

        // Track the model for idle-state display
        if (currentUsage.model) {
            lastKnownModel = currentUsage.model;
            durableWorkspaceState.update('lastKnownModel', lastKnownModel);
        }

        // ─── Compression Detection & Rewind/Compaction Boundary Recording ───
        const previousObservation = previousContextObservations.get(currentUsage.cascadeId);
        const prevUsed = previousObservation?.contextUsed;
        const prevSteps = previousStepCounts.get(activeTrajectory.cascadeId);
        const activeBranchRevision = JSON.stringify([activeTrajectory.trajectoryId, activeTrajectory.branchName]);
        const previousBranchRevision = branchStepPeaks.get(activeTrajectory.cascadeId)?.lastBranchRevision;
        const branchChanged = Boolean(previousBranchRevision && previousBranchRevision !== activeBranchRevision);
        const isUndo = !branchChanged && prevSteps !== undefined && activeTrajectory.stepCount < prevSteps;

        if (branchChanged || isUndo || currentUsage.compressionDetected) {
            cascadeCompactionBoundaries.set(currentUsage.cascadeId, {
                stepIndex: activeTrajectory.stepCount, timestampMs: activeTrajectory.lastModifiedTime || Date.now(),
            });
        }

        // ── Pre-enhance with cached GM data to prevent step→GM flickering ──
        let gmEnhancedPre = false;
        if (lastGMSummary && trackedCascadeId) {
            gmEnhancedPre = applyGMContextToUsage(currentUsage, getLatestGMContextUsed(lastGMSummary, trackedCascadeId));
        }

        if (!branchChanged && !currentUsage.compressionDetected) {
            const drop = measuredContextDrop(previousObservation, currentUsage, isUndo);
            if (drop > 0) {
                currentUsage.compressionDetected = true;
                currentUsage.previousContextUsed = prevUsed;
                compressionPersistCounters.set(currentUsage.cascadeId, COMPRESSION_PERSIST_POLLS);
                log(`Compression detected (fallback) for ${diagnosticAliasMap.aliasConversation(currentUsage.cascadeId)}: ${prevUsed} → ${currentUsage.contextUsed} (dropped ${drop})`);
            }
        }

        if (currentUsage.compressionDetected || isUndo) {
            cascadeCompactionBoundaries.set(currentUsage.cascadeId, {
                stepIndex: activeTrajectory.stepCount,
                timestampMs: activeTrajectory.lastModifiedTime || Date.now(),
            });
        }

        if (currentUsage.compressionDetected && !compressionPersistCounters.has(currentUsage.cascadeId)) {
            if (prevUsed !== undefined) {
                currentUsage.previousContextUsed = prevUsed;
            }
            compressionPersistCounters.set(currentUsage.cascadeId, COMPRESSION_PERSIST_POLLS);
            if (currentUsage.checkpointCompressionDrop > 0) {
                log(`Compression detected (checkpoint) for ${diagnosticAliasMap.aliasConversation(currentUsage.cascadeId)}: checkpoint inputTokens dropped ${currentUsage.checkpointCompressionDrop}`);
            } else {
                log(`Compression detected (checkpoint) for ${diagnosticAliasMap.aliasConversation(currentUsage.cascadeId)}: checkpoint inputTokens dropped`);
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
        const ideRole = currentUsage.tokenUsageSource === 'planner'
            ? 'planner'
            : (currentUsage.orchestratorConfig ? 'executor' : 'single');
        const ideCpAnchor = cascadeCompactionBoundaries.get(currentUsage.cascadeId)?.stepIndex ?? activeTrajectory.stepCount;
        activeRecoveryBrief = recoveryBriefTracker.evaluate({
            cascadeId: currentUsage.cascadeId,
            model: currentUsage.model || 'unknown',
            role: ideRole,
            branch: currentUsage.branchName || activeTrajectory.branchName || 'main',
            stepCount: activeTrajectory.stepCount,
            compactionEventAnchor: ideCpAnchor,
            previousTokens: prevUsed ?? null,
            currentTokens: currentUsage.contextUsed,
            dropTokens: currentUsage.checkpointCompressionDrop > 0 ? currentUsage.checkpointCompressionDrop : null,
            limitTokens: currentUsage.contextLimit,
            compressionDetected: Boolean(currentUsage.compressionDetected),
            isUndo,
            nowMs: Date.now(),
            lang: getLanguage(),
        });

        // The status bar also needs the post-compaction boundary when the panel is closed.
        const branchRevision = `${activeTrajectory.trajectoryId}:${activeTrajectory.stepCount}:${activeTrajectory.lastModifiedTime}:${activeTrajectory.status}:${activeTrajectory.branchName || ''}`;
        const activeCalls = lastGMSummary?.conversations.find(c => c.cascadeId === activeTrajectory.cascadeId)?.calls;
        const latestCall = activeCalls && activeCalls[activeCalls.length - 1];
        const breakdownKey = `${backendEpoch}:${activeTrajectory.cascadeId}:${branchRevision}:${currentUsage.contextUsed}:${currentUsage.contextLimit}:${activeCalls?.length ?? 0}:${latestCall?.createdAt ?? ''}`;
        if (recheckActive || breakdownKey !== lastContextBreakdownKey) {
            if (breakdownKey !== lastContextBreakdownKey) {
                // A failed read for this revision must not publish the prior revision's counts.
                clearActiveContextTelemetry();
            }
            try {
                const authority = getLsAuthority(lsInfo);
                const metaRes: FetchTrajectoryGeneratorMetadataResult = activeTrajectory.manifestMember
                    ? await fetchMemberMetadata(lsInfo, activeTrajectory.cascadeId)
                    : await pollCache.getOrFetch(
                    {
                        backendEpoch,
                        authority,
                        method: 'GetCascadeTrajectoryGeneratorMetadata',
                        cascadeId: activeTrajectory.cascadeId,
                        range: 'all',
                        branchRevision,
                    },
                    (upstreamSignal) => fetchTrajectoryGeneratorMetadataResult(lsInfo!, activeTrajectory!.cascadeId, upstreamSignal),
                    abortController.signal,
                    { shouldCache: (r) => r.ok },
                );
                const embeddedSteps = currentUsage._fetchedSteps;
                let stepsRes: FetchTrajectoryStepsResult = { ok: true, steps: [], hasGaps: false };
                let rawSteps: Array<Record<string, unknown>> | undefined;
                if (Array.isArray(embeddedSteps) && embeddedSteps.length > 0) {
                    stepsRes = {
                        ok: !currentUsage.hasGaps,
                        steps: embeddedSteps,
                        hasGaps: Boolean(currentUsage.hasGaps),
                        ...(currentUsage.suffixRecovered ? { suffixRecovered: true, suffixStartOffset: currentUsage.suffixStartOffset } : {}),
                    };
                    rawSteps = embeddedSteps;
                } else if (metaRes.ok && activeTrajectory.stepCount > 0) {
                    stepsRes = await pollCache.getOrFetch(
                        {
                            backendEpoch,
                            authority,
                            method: 'GetCascadeTrajectorySteps',
                            cascadeId: activeTrajectory.cascadeId,
                            range: `0:${activeTrajectory.stepCount}`,
                            branchRevision,
                        },
                        (upstreamSignal) => fetchTrajectorySteps(lsInfo!, activeTrajectory!.cascadeId, activeTrajectory!.stepCount, upstreamSignal),
                        abortController.signal,
                        { shouldCache: (r) => r.ok && !r.hasGaps },
                    );
                    rawSteps = stepsRes.steps;
                }
                const stepsSuffixRecovered = Boolean(
                    stepsRes.steps.length > 0
                    && (stepsRes.suffixRecovered || stepsRes.suffixStartOffset !== undefined),
                );
                const stepsComplete = stepsRes.ok && !stepsRes.hasGaps;
                const stepsUsable = stepsComplete || stepsSuffixRecovered;
                if (metaRes.ok && stepsUsable) {
                    const peak = advanceBranchStepPeak(branchStepPeaks.get(activeTrajectory.cascadeId), {
                        stepCount: activeTrajectory.stepCount,
                        branchRevision: activeBranchRevision,
                    });
                    const prevUsedTokens = previousBreakdownUsedTokens.get(activeTrajectory.cascadeId);
                    lastContextBreakdown = parseContextBreakdown({
                        generatorMetadata: metaRes.metadata,
                        steps: rawSteps,
                        ...(stepsRes.suffixStartOffset !== undefined ? { suffixStartOffset: stepsRes.suffixStartOffset } : {}),
                        currentStepCount: activeTrajectory.stepCount,
                        branchPeakStepCount: peak.effectiveBranchPeakStepCount,
                        previousUsedTokens: prevUsedTokens,
                        model: currentUsage.model,
                        modelDisplayName: currentUsage.modelDisplayName,
                        effectiveBudgetTokens: currentUsage.contextLimit,
                    });
                    lastTurnDiagnostics = metaRes.metadata.length > 0 ? analyzeTurnDiagnostics(metaRes.metadata) : null;
                    // Only latch caches and peak tracking when history is complete (never cache partial suffix steps as complete).
                    if (stepsComplete && !currentUsage.hasGaps) {
                        branchStepPeaks.set(activeTrajectory.cascadeId, peak.state);
                        if (lastContextBreakdown.usedTokens > 0) {
                            previousBreakdownUsedTokens.set(activeTrajectory.cascadeId, lastContextBreakdown.usedTokens);
                        }
                        lastContextBreakdownKey = breakdownKey;
                    }
                } else {
                    log(`Skipped latching context breakdown cache for ${diagnosticAliasMap.aliasConversation(activeTrajectory.cascadeId)} (metaOk=${metaRes.ok}, stepsOk=${stepsRes.ok}, stepsHasGaps=${stepsRes.hasGaps})`);
                }
            } catch (bdErr) {
                log(`Context breakdown fetch error: ${bdErr instanceof Error ? bdErr.name : 'Error'}`);
            }
        }

        syncStatusBarTelemetry(false, currentUsage.cascadeId);
        const initialObservation = buildIdePublishedObservation(currentUsage, {
            gmEnhanced: gmEnhancedPre,
            bumpRevision: true,
        });
        statusBar.update(currentUsage, initialObservation);

        const sourceLabel = currentUsage.isEstimated ? 'estimated' : 'precise';
        log(`Context: ${currentUsage.contextUsed} tokens (${sourceLabel}) | ${currentUsage.usagePercent.toFixed(1)}% | modelOut=${currentUsage.totalOutputTokens} | toolOut=${currentUsage.totalToolCallOutputTokens} | delta=${currentUsage.estimatedDeltaSinceCheckpoint} | imageGen=${currentUsage.imageGenStepCount}`);

        // 6. Background: compute usage for other recent trajectories via fair SwarmPollScheduler (<= 3 concurrency)
        const baseScope = buildUsageScopeTrajectories(qualifiedTrajectories, trajectories, activeTrajectory);
        const baseIds = new Set(baseScope.map(t => t.cascadeId));
        const scopeTrajectories = [...baseScope, ...trajectories.filter(t => t.manifestMember && !baseIds.has(t.cascadeId))];
        const scopedById = new Map(scopeTrajectories.map(t => [t.cascadeId, t]));
        const usageById = new Map<string, ContextUsage>([[activeTrajectory.cascadeId, currentUsage]]);

        const otherTrajectories = scopeTrajectories.filter(t => t.cascadeId !== activeTrajectory!.cascadeId);
        if (otherTrajectories.length > 0) {
            await withTrajectoryRequestShare(() => swarmPollScheduler.runTick({
                rootCascadeId: swarmRegistry.resolveRootId(activeTrajectory.cascadeId) ?? activeTrajectory.cascadeId,
                inspectedMemberId: windowSelectionState.inspectedMemberId,
                members: otherTrajectories.map(t => ({
                    cascadeId: t.cascadeId,
                    isRunning: t.status === CascadeStatus.RUNNING,
                    isKilled: swarmRegistry.getNode(t.cascadeId)?.killed === true,
                })),
                budget: { maxConcurrency: 3 },
                pollMember: async (cid) => {
                    const t = scopedById.get(cid);
                    if (!t) { return { ok: true, requestsUsed: 0, pagesUsed: 0 }; }
                    const cachedUsage = monitorStore.getSnapshot(t.cascadeId);
                    if (hasSameUsageInputs(cachedUsage, t)) {
                        const refreshed = await refreshWorkflowImageUsage(lsInfo!, rehydrateUsageForDisplay(cachedUsage), abortController.signal);
                        usageById.set(cid, refreshed);
                        return { ok: true, requestsUsed: 0, pagesUsed: 0 };
                    }
                    try {
                        const fetched = await getContextUsage(lsInfo!, t, undefined, abortController.signal);
                        usageById.set(cid, fetched);
                        return { ok: true, requestsUsed: 1, pagesUsed: 1 };
                    } catch {
                        return { ok: false, requestsUsed: 1, pagesUsed: 1 };
                    }
                },
            }));
        }
        allTrajectoryUsages = scopeTrajectories
            .map(t => usageById.get(t.cascadeId))
            .filter((u): u is ContextUsage => u !== undefined);
        lastSwarmTopology = swarmRegistry.recordMemberMeasurements(backendEpoch, new Map(allTrajectoryUsages.map(u => {
            const limits = resolveModelContextLimits(u.lastModelUsage?.model || u.model);
            const limit = sharedAppSettings.contextPctBasis === 'native' ? limits.nativeLimit ?? u.contextLimit : u.contextLimit;
            return [u.cascadeId, {
                lastObservedAt: Date.now(), measuredModel: u.lastModelUsage?.model || undefined,
                contextPct: !u.hasGaps && limit > 0 ? Math.round(u.contextUsed / limit * 1000) / 10 : undefined,
            }];
        })));
        const bgRpcLinks: RpcTopologyLinkProjection[] = [];
        const bgObservedAtMs = Date.now();
        for (const u of allTrajectoryUsages) {
            for (const linkedId of u.imageWorkflow?.linkedCascadeIds || []) {
                if (linkedId) {
                    knownSubagentCascadeIds.add(linkedId);
                    bgRpcLinks.push({
                        parentCascadeId: u.cascadeId,
                        childCascadeId: linkedId,
                        kind: 'direct_subagent',
                        observedAtMs: bgObservedAtMs,
                    });
                }
            }
        }
        if (bgRpcLinks.length > 0) {
            swarmRegistry.ingestRpcProjections(bgRpcLinks, backendEpoch);
        }
        monitorStore.record(allTrajectoryUsages, currentUsage.cascadeId);
        allTrajectoryUsages = monitorStore.getAll();

        // 6c. Activity processing (merged — reuses already-fetched trajectories, no duplicate RPC)
        if (activityTracker && lsInfo) {
            try {
                const groupRoot = swarmRegistry.resolveRootId(activeTrajectory.cascadeId) ?? activeTrajectory.cascadeId;
                const groupIds = lastSwarmTopology?.groupsByRootId.get(groupRoot)?.memberIds ?? [];
                const telemetryOrder = orderTelemetryPoll(trajectories, [activeTrajectory.cascadeId, groupRoot,
                    ...gmTracker.getUnmeasuredMemberIds(groupIds)], telemetryPollTick++);
                const activityChanged = await withTrajectoryRequestShare(() => activityTracker.processTrajectories(
                    lsInfo!,
                    telemetryOrder.filter(t => !t.manifestMember || t.cascadeId === activeTrajectory.cascadeId).map(t => ({
                        cascadeId: t.cascadeId,
                        stepCount: t.stepCount,
                        status: t.status,
                        requestedModel: t.requestedModel,
                        generatorModel: t.generatorModel,
                    })),
                    abortController.signal,
                )).catch(() => {
                    log('Activity refresh failed; continuing with model calls');
                    return false;
                });

                // Fetch GM data (piggyback on same poll cycle)
                let gmChanged = false;
                const hadUiSummary = gmTracker.getUiSummary() !== null;
                try {
                    const prevSummary = lastGMSummary;
                    if (isManualRefresh) {
                        gmTracker.clearErrorBackoff(activeTrajectory.cascadeId);
                    }
                    const gmSummary = await gmTracker.fetchAll(
                        lsInfo,
                        telemetryOrder.map(t => ({ cascadeId: t.cascadeId, title: t.summary || t.cascadeId.substring(0, 8), stepCount: t.stepCount, status: t.status,
                            lastModifiedTime: t.lastModifiedTime, trajectoryId: t.trajectoryId,
                            manifestMember: t.manifestMember, killed: t.killed })),
                        currentUsage?.cascadeId,
                        abortController.signal,
                        async id => requireGeneratorMetadata(await fetchMemberMetadata(lsInfo!, id)),
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

                // ── DailyLedger: record new GM calls via recordCallsDetailed + idempotent late-day flush ──
                try {
                    recordGMCallsIntoDailyLedgerDetailed();
                    if (dailyLedger.getLateDaySnapshots().length > 0 && dailyStore) {
                        const lateFlushed = await flushLateDaysToDailyStoreAsync(
                            dailyLedger,
                            dailyStore,
                            pricingStore?.getCustom(),
                            'ide',
                            log,
                            sharedAppSettings.orchestratorPricingMode,
                            confirmDurablePersist,
                        );
                        if (lateFlushed > 0) {
                            durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                        }
                    }
                    const reconciled = dailyLedger.reconcileRecordedCalls(gmTracker.getLedgerReconciliationEntries());
                    if (reconciled > 0) {
                        durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());
                        log(`[DailyLedger] reconciled metadata/pricing for ${reconciled} recorded calls without adding calls`);
                    }
                } catch { /* Ledger recording failure is non-critical */ }

                // ── DailyLedger: proactive settlement by resetTime ──
                try {
                    const nowMs = Date.now();
                    for (const snap of accountSnapshots.values()) {
                        for (const pool of (snap.resetPools || [])) {
                            if (!pool.resetTime || !pool.modelIds?.length) { continue; }
                            const resetMs = parsePositivePoolResetMs(pool.resetTime);
                            if (resetMs === null || resetMs > nowMs) { continue; }

                            if (pool.hasUsage === false
                                && !dailyLedger.hasActiveCallsForPool(pool.modelIds, snap.email)) { continue; }
                            if (dailyLedger.isPoolSettled(pool.modelIds, snap.email, resetMs)) { continue; }
                            const settled = dailyLedger.settleForQuotaReset(pool.modelIds, snap.email, resetMs);
                            if (settled) {
                                log(`[DailyLedger] proactive settlement: ${settled.totalCalls} calls for [${settled.poolModelLabels.join(', ')}] (${diagnosticAliasMap.aliasLabel(snap.email)})`);
                                durableGlobalState.update('dailyLedgerState', dailyLedger.serialize());

                                try {
                                    const blCount = gmTracker.baselineForQuotaReset(snap.email, pool.modelIds, pool.resetTime);
                                    log(`[GMTracker] proactive baseline: ${blCount} calls for [${pool.modelIds.join(', ')}] (${diagnosticAliasMap.aliasLabel(snap.email)})`);
                                    lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                                    durableGlobalState.update('gmTrackerState', gmTracker.serialize());
                                    persistGMSummaryToFile(lastGMSummary);
                                } catch (e) {
                                    log(`[GMTracker] proactive baseline failed: ${e instanceof Error ? e.name : 'Error'}`);
                                }
                            }
                        }
                    }
                } catch { /* Proactive settlement failure is non-critical */ }

                // Inject GM precision data into activity timeline events.
                let timelineChanged = false;
                let gmEnhancedStatusBar = false;
                if (lastGMSummary) {
                    timelineChanged = activityTracker.injectGMData(lastGMSummary);

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
                    const updatedObs = buildIdePublishedObservation(currentUsage, {
                        gmEnhanced: true,
                        bumpRevision: true,
                    });
                    statusBar.update(currentUsage, updatedObs);
                } else if (gmChanged || timelineChanged || (!hadUiSummary && gmTracker.getUiSummary() !== null)) {
                    if (currentUsage) {
                        const refreshedObs = buildIdePublishedObservation(currentUsage, {
                            bumpRevision: true,
                        });
                        statusBar.update(currentUsage, refreshedObs);
                    } else {
                        statusBar.refreshFromConfig();
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
                log(`Activity processing error: ${err instanceof Error ? err.name : 'Error'}`);
            }
        }

        // 6e. Update WebView panel if visible (single unified refresh point)
        if (isMonitorPanelVisible()) {
            updateMonitorPanel(makePanelPayload());
        }

        // 7. Update baselines for next poll
        updateBaselines(trajectories);

    } catch (err) {
        log(`Polling error: ${err instanceof Error ? err.name : 'Error'}`);
        handleLsFailure(`Error: ${err}`);
        lsInfo = null;
        cachedLsInfo = null;
        invalidateLiveModelMetadata();
    } finally {
        pollCache.clear();
        // Always run cached-account reset check — independent of polling success/failure.
        try {
            checkCachedAccountResets();
        } catch (resetErr) {
            log(`[ResetCheck] ERROR: ${resetErr instanceof Error ? resetErr.name : 'Error'}`);
        }
        isPolling = false;
        if (repollNeeded && !disposed) {
            const nextManual = repollForceManual;
            repollNeeded = false;
            repollForceManual = false;
            void pollContextUsage(nextManual);
        }
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
            try { log(`Unexpected polling error: ${err instanceof Error ? err.name : 'Error'}`); } catch { /* ignore */ }
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

    const groups = new Map<string, { labels: string[]; minFraction: number | null }>();
    for (const group of groupModelConfigsByQuotaPool(configs)) {
        const displayLabels = mergedLabelsByPool.get(group.key) || group.labels;
        groups.set(group.key, { labels: displayLabels, minFraction: group.minFraction });
    }

    for (const [groupKey, group] of groups) {
        // Never treat unknown (`minFraction === null`) quota pools as 0% or 100%.
        if (group.minFraction === null) {
            continue;
        }
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
                log(`[ResetCheck] ${diagnosticAliasMap.aliasLabel(snap.email)} [${modelNames}]: already-archived — skipped`);
                continue;
            }

            // ── WILL TRIGGER ──
            log(`[ResetCheck]   [${modelNames}] >>> TRIGGERING archival for ${diagnosticAliasMap.aliasLabel(snap.email)}`);
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
            log(`[ResetCheck]   Notification sent: ${diagnosticAliasMap.aliasLabel(displayName)} — ${modelNames}${extra}`);
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

function getWorkspaceNormOptions(): NormalizeWorkspaceUriOptions {
    const wslDistro = process.env.WSL_DISTRO_NAME?.trim() || undefined;
    return {
        platform: process.platform,
        ...(wslDistro ? { wslDistro } : {}),
    };
}

function buildWorkspaceSignature(
    uris: readonly string[],
    normOpts: NormalizeWorkspaceUriOptions = getWorkspaceNormOptions(),
): string {
    if (!uris || uris.length === 0) {
        return '(none)';
    }
    const normalized = [...new Set(
        uris
            .map(u => normalizeWorkspaceUri(u, normOpts))
            .filter(Boolean),
    )].sort();
    return normalized.length > 0 ? normalized.join('\0') : '(none)';
}

/** Collect all active workspace folder URIs in this IDE window (multi-root aware). */
export function getWorkspaceUris(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return [];
    }
    const uris: string[] = [];
    for (const folder of folders) {
        const uri = folder?.uri?.toString?.();
        if (uri && !uris.includes(uri)) {
            if (uri.startsWith('vscode-remote://')) {
                log(`Remote workspace detected`);
            }
            uris.push(uri);
        }
    }
    return uris;
}

function getWorkspaceUri(): string | undefined {
    return getWorkspaceUris()[0];
}

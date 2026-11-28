/**
 * Live Antigravity App Sidecar backend runtime engine.
 *
 * 100% pure Node/TypeScript — ZERO `vscode` runtime imports, ZERO external npm
 * dependencies. Shares the exact platform-native `state-v1.json` (`DurableState`)
 * with the Antigravity IDE extension, discovers the Antigravity App standalone
 * Language Server (`preferredSurface: 'app'`), runs the full v1.17.5 telemetry
 * pipeline (Context Breakdown, Turn Diagnostics, Quota Runway, StaleCacheGuard,
 * Main-Agent Lock, GM/Activity/Quota/DailyLedger/Pricing trackers), and serves
 * all interactive Sidecar UI actions.
 */

import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { currentAICredits } from '../account-credits';
import { SwarmMemberInventory } from '../core/swarm-member-inventory';
import { ActivityTracker, type ActivitySummary, type ActivityTrackerState, type StepEvent } from '../activity-tracker';
import type { AccountSnapshot, ResetPool } from '../activity-panel';
import { isBillingDay, isBillingDaySetting } from '../billing-day';
import {
    buildCalendarExportCsv,
    buildCalendarExportJson,
    buildCalendarExportMarkdown,
    CliUsageScanner,
    estimateSubscriptionRoi,
    type CliDailyUsageRecord,
    type SubscriptionConfig,
} from '../cli-usage-scanner';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, MAX_DISCOVERY_BACKOFF_MS } from '../constants';
import {
    advanceBranchStepPeak,
    type BranchStepPeakState,
    formatContextTextReport,
    parseContextBreakdown,
    type ContextBreakdownSnapshot,
    type ContextQuotaSummaryLine,
} from '../context-breakdown';
import {
    advanceWindowBackendEpoch,
    buildConversationOptions,
    clearInspect as clearWindowInspect,
    createWindowSelectionState,
    detectPathCaseSensitivity,
    disableLockToMainAgent,
    enableLockToMainAgent,
    inspectMember as inspectWindowMember,
    isSubagentTrajectory,
    recordObservedHostFocus,
    retargetLockedRoot as retargetWindowLockedRoot,
    selectConversation,
    type ConversationOption,
    type FocusAuthorityLevel,
    type PathCaseProbeFs,
    type ResolvedConversationTarget,
    type WindowSelectionState,
} from '../conversation-selector';
import {
    buildPublishedMonitorObservation,
    type BuildObservationInput,
    DiagnosticAliasMap,
    projectForCdpComposerRing,
    projectForCdpTopbar,
    type ContextDisplayBasis,
    type ContextLimitProvenance,
    type ContextTokenSource,
    type ObservationSubjectKind,
    type PublishedMonitorObservation,
    type SpeedDisplayMode,
    type SpeedSampleScope,
} from '../core/context-display';
import {
    bindCustomFxRate,
    formatCurrencyAmount,
    isCurrencyCode,
    normalizeCurrencyCode,
    switchDisplayCurrency,
    type CurrencyConfig,
    type DisplayCurrencyCode,
} from '../core/currency';
import {
    getLatestGMContextUsedForCascade,
    type GMContextFallbackOptions,
} from '../core/gm-context-fallback';
import {
    parseAvailableModelsSyncPayload,
    resolveModelLimitsWithProvenance,
    type ContextLimitProvenance as CatalogContextLimitProvenance,
} from '../core/model-catalog-sync';
import {
    isSubscriptionPlanPresetId,
    normalizeOrchestratorPricingMode,
    normalizeSubscriptionPlanId,
    sanitizeCustomPricingOverrides,
    SUBSCRIPTION_PLAN_PRESETS,
    validateCustomFxRate,
    validateDisplayCurrency,
    validateOrchestratorPricingMode,
    validateSubscriptionCurrency,
    validateSubscriptionMonthlyFee,
    validateSubscriptionPlan,
    type OrchestratorPricingMode,
    type SubscriptionPlanPresetId,
} from '../core/pricing-validation';
import {
    DEFAULT_SWARM_POLL_BUDGET,
    getTrajectoryPollBudgetSnapshot, withTrajectoryPollBudget, withTrajectoryRequestShare, withoutTrajectoryPollBudget,
    priceSwarmGroup,
    orderTelemetryPoll,
    SwarmPollScheduler,
    SwarmTopologyRegistry,
    type RpcTopologyLinkProjection,
    type SwarmGroupCostSummary,
    type SwarmPollBudgetConfig,
    type SwarmPollTickResult,
    type SwarmScanBudgets,
    type SwarmSchedulableMember,
    type SwarmTopologySnapshot,
} from '../core/swarm-registry';
import { resolveRuntimeVersion } from '../core/version';
import {
    flushLateDaysToDailyStoreAsync,
    mergeArchivedAndLiveRecords,
    performDailyArchival as performDailyArchivalCore,
    performDailyArchivalAsync as performDailyArchivalAsyncCore,
    type DailyArchivalContext,
} from '../daily-archival';
import {
    DailyLedger,
    toLocalDateKey,
    type DailyLedgerState,
    type LedgerAccountBucket,
    type LedgerSettledEntry,
    type LedgerRecordedCall,
    type WorkspaceUsageStats,
} from '../daily-ledger';
import {
    computeAdditiveTokens,
    computeCycleTokenTotals,
    DailyStore,
    redactDailyRecordIdentities,
    type DailyStoreState,
} from '../daily-store';
import {
    discoverLanguageServer,
    type DiscoverLanguageServerOptions,
    type LSInfo,
} from '../discovery';
import {
    DEFAULT_APP_SETTINGS,
    DurableState,
    isUpdateAvailableForVersion,
    type AppSettings,
    type DurableStateCommitReceipt,
    type LastUpdateCheckRecord,
    type StateBucket,
} from '../durable-state';
import {
    GMTracker,
    slimSummaryForPersistence,
    type GMCallEntry,
    type GMConversationData,
    type GMSummary,
    type GMTrackerState,
} from '../gm-tracker';
import {
    DEFAULT_GLOBAL_RULES_TEMPLATE,
    GLOBAL_RULES_MAX_BYTES,
    getGlobalRulesPath,
    readGlobalRulesStatus,
    validateGlobalRulesRevealTarget,
    writeGlobalRulesFile,
    type GlobalRulesStatus,
} from '../global-rules';
import {
    formatClockTime,
    getLanguage,
    getRuntimeLocaleSources,
    initI18nFromState,
    isLanguage,
    isLanguagePreference,
    resolvePerViewEffectiveLanguage,
    setLanguageInMemory,
    setLanguagePreferenceInMemory,
    setLanguageToState,
    t,
    tBi,
    type Language,
    type LanguagePreference,
} from '../i18n-core';
import {
    mergeModelDNAState,
    restoreModelDNAState,
    serializeModelDNAState,
    type ModelDNAStoreState,
    type PersistedModelDNA,
} from '../model-dna-store';
import {
    getModelSpecs,
    guessContextLimitSpec,
    overrideContextLimits,
    registerResponseModelAlias,
    resolveModelId,
    setAvailableImageModelIds,
    setShowModelShortId,
    updateModelSpec,
    type FullUserStatus,
    type ModelConfig,
    type ModelSpec,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../models';
import {
    extractOverviewTelemetry,
    resetCountdown,
    selectMonitorQuotaGroups,
    type MonitorStatus,
} from '../monitor-overview';
import { MonitorStore } from '../monitor-store';
import {
    analyzeUserTurnCacheStates,
    evaluateSpeedSample,
} from '../orchestrator-attribution';
import {
    comparePoolResetTimes,
    expandModelIdsToPool,
    groupModelConfigsByQuotaPool,
    parsePositivePoolResetMs,
} from '../pool-utils';
import {
    calculateLedgerModelCosts,
    costFromTokens,
    findPricingForDate,
    PricingStore,
    selectPricingModel,
    type ModelPricing,
} from '../pricing-store';
import {
    isCustomModel,
    QuotaRunwayTracker,
    StaleCacheGuard,
    type QuotaDirectionMode,
    type QuotaRunwayEstimate,
    type QuotaWindowMode,
    type SerializedQuotaRunwayState,
    type WeeklyQuotaRunwayEstimate,
    type WeeklyQuotaSeriesState,
} from '../quota-runway';
import { QuotaTracker } from '../quota-tracker';
import { formatResetCountdown } from '../reset-time';
import { rpcCall } from '../rpc-client';
import {
    computeWeightedSpeedMetric,
    PromptCacheTtlTracker,
    type PromptCacheTtlEvaluation,
    type WeightedSpeedMetricSummary,
} from '../telemetry-metrics';
import {
    CDP_OVERLAY_CLIENT_BUILD_ID,
    WEBVIEW_CLIENT_BUILD_ID,
} from '../client/generated/client-bundles.generated';
import { parseTooltipDensity } from '../tooltip-budget';
import {
    fetchFullUserStatus,
    fetchOrchestratorSettings,
    fetchTrajectoryGeneratorMetadata,
    fetchTrajectoryGeneratorMetadataResult,
    fetchTrajectorySteps,
    fetchUserQuotaSummary,
    getAllTrajectories,
    readUnlistedMemberStepCount,
    requireGeneratorMetadata,
    getContextLimit,
    getContextUsage,
    normalizeModelDisplayName,
    normalizeUri,
    refreshWorkflowImageUsage,
    resetImageWorkflowCache,
    updateModelDisplayNames,
    type ContextUsage,
    type FetchTrajectoryGeneratorMetadataResult,
    type FullUserStatusFetchResult,
    type RawGeneratorMetadataEntry,
    type TrajectorySummary,
} from '../tracker';
import { analyzeTurnDiagnostics, type TurnDiagnosticsSummary } from '../turn-diagnostics';
import {
    buildCalendarExportData,
    type CalendarMetricMode,
    type CalendarPeriodMode,
    type CalendarRenderOptions,
    type CalendarSourceFilter,
    type CalendarViewMode,
} from '../webview-calendar-tab';
import {
    buildMonitorDocumentHtml,
    buildMonitorTabsPayload,
    type MonitorTabId,
} from '../webview-document';
import type {
    PanelHintPreferences,
    StorageDiagnostics,
    UpdateStatusView,
} from '../webview-settings-tab';
import {
    createCdpAmbientOverlayManager,
    createOverlayActionBridge,
    generateSessionToken,
    type CdpAmbientOverlayManager,
    type CdpAmbientOverlayManagerOptions,
} from './cdp-injector';
import {
    createCdpLauncher,
    inspectCdpLauncher,
    removeCdpLauncher,
    revealCdpLauncher,
    type CdpLauncherOptions,
} from './cdp-launcher';
import {
    applyAppPluginUpdate,
    checkForUpdates,
    EXPECTED_PLUGIN_NAME,
    type ApplyAppPluginUpdateOptions,
    type CheckForUpdatesOptions,
} from './plugin-updater';
import {
    DEFAULT_SIDECAR_VERSION,
    type SidecarActionHttpBody,
    type SidecarOverlayBridgeRequest,
} from './sidecar-server';
import {
    buildAllowlistedHandoffV2,
    buildRedactedDiagnostics,
    buildSettingsBackupJson,
    combineSerializedRunwayWithWeekly,
    CompactionRecoveryBriefTracker,
    enrichLedgerEntriesForIngestion,
    formatCompactionRecoveryBriefForPrivacy,
    isCdpOverlayFontSize,
    normalizeCdpOverlayFontSize,
    parseAndValidateSettingsBackup,
    SETTINGS_ENUM_VALUES,
    SETTINGS_INT_BOUNDS,
    type AppSettingsWithV118,
    type ApplyPluginUpdateResult,
    type CdpLauncherActionResult,
    type CdpLauncherStatus,
    type CdpOverlayBridgeActionCommand,
    type CdpOverlayFontSizePreset,
    type CdpOverlayPayload,
    type CdpOverlayQuotaPool,
    type CdpOverlaySwarmSummary,
    type CdpOverlayTargetTab,
    type CdpStatus,
    type CompactionRecoveryBrief,
    type HandoffV2Result,
    type PluginReleaseInfo,
    type SidecarActionRequest,
    type SidecarConversationOption,
    type SidecarProvider,
    type SidecarRenderContext,
    type SidecarSnapshotPayload,
    type SidecarSnapshotQuery,
    type SidecarViewMode,
    type UpdateCheckResult,
} from './sidecar-types';

// ─── Public Contracts ────────────────────────────────────────────────────────

export interface MonitorDocumentSettings {
    pollingInterval: number;
    quotaNotificationThreshold: number;
    showContext: boolean;
    showQuota: boolean;
    showResetCountdown: boolean;
    showAiCredits: boolean;
    showSpeed: boolean;
    showCacheHit: boolean;
    showSessionCost: boolean;
    tooltipDensity: 'auto' | 'compact' | 'full';
    showModelInternalId: boolean;
    maxRecentSteps?: number;
    maxArchives?: number;
    lockToMainAgent?: boolean;
    appComposerRingEnabled?: boolean;
    appTopBarEnabled?: boolean;
    showNativeHudBar?: boolean;
    appShowNativeHudBar?: boolean;
    ideShowNativeHudBar?: boolean;
    nativeHudAutoHideOnOverview?: boolean;
    orchestratorPricingMode?: OrchestratorPricingMode;
    displayCurrency?: DisplayCurrencyCode;
    customFxRate?: number | null;
    customFxCurrency?: DisplayCurrencyCode | null;
    subscriptionPlan?: SubscriptionPlanPresetId;
    subscriptionMonthlyFee?: number | null;
    subscriptionCurrency?: DisplayCurrencyCode;
    calendarRetentionDays?: number;
    autoCheckUpdates?: boolean;
    activityMaxRecentSteps?: number;
    activityMaxArchives?: number;
    languagePreference?: LanguagePreference;
    contextPctBasis?: ContextDisplayBasis;
    speedMetricMode?: SpeedDisplayMode;
    quotaWindowMode?: QuotaWindowMode;
    quotaDirectionMode?: QuotaDirectionMode;
    cdpOverlayFontSize?: CdpOverlayFontSizePreset;
    cdpOverlayHighContrast?: boolean;
}

export interface SidecarStaleSourceState {
    isStale: boolean;
    lastSuccessAtMs: number | null;
    lastError?: string | null;
}

export interface SidecarStaleState {
    isStale: boolean;
    lastSuccessAtMs: number | null;
    lastError?: string | null;
    staleSources?: Array<'userStatus' | 'trajectories'>;
    sources?: {
        userStatus: SidecarStaleSourceState;
        trajectories: SidecarStaleSourceState;
    };
}

export interface MonitorDocumentV1175Extras {
    surface?: 'ide' | 'app-sidecar';
    version?: string;
    contextBreakdown?: ContextBreakdownSnapshot | null;
    turnDiagnostics?: TurnDiagnosticsSummary | null;
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    isCustomModelActive?: boolean;
    staleState?: SidecarStaleState | null;
    conversationOptions?: ConversationOption[];
    activeConversationId?: string | null;
    pinnedConversationId?: string | null;
    lockToMainAgent?: boolean;
    extraHeadHtml?: string;
    extraBodyEndHtml?: string;
    imagesBaseUri?: string;
    calendarOptions?: CalendarRenderOptions;
    orchestratorPricingMode?: OrchestratorPricingMode;
    appSettings?: Partial<AppSettingsWithV118>;
    cdpStatus?: CdpStatus | null;
    updateStatus?: UpdateStatusView | UpdateCheckResult | null;
    privacyMasked?: boolean;
    accountHandle?: string;
    // D9 unified observation & per-window lock/inspect/swarm state (optional)
    observation?: PublishedMonitorObservation | null;
    inspectedMemberId?: string | null;
    inspectedMemberLabel?: string | null;
    lockedRootId?: string | null;
    lockPendingUnavailable?: boolean;
    retargetOfferId?: string | null;
    retargetOfferTitle?: string | null;
    swarmTopology?: SwarmTopologySnapshot | null;
    swarmGroupCost?: SwarmGroupCostSummary | null;
    weeklyQuotaRunways?: Record<string, WeeklyQuotaRunwayEstimate>;
    weeklyRunways?: Record<string, WeeklyQuotaRunwayEstimate>;
    promptCacheTtl?: PromptCacheTtlEvaluation | null;
    cacheTtl?: PromptCacheTtlEvaluation | null;
    recoveryBrief?: CompactionRecoveryBrief | null;
    speedCoverage?: { measuredCount: number; totalCount: number } | null;
    globalRules?: GlobalRulesStatus | null;
}

/**
 * Unified parameter object passed to `buildMonitorDocumentHtml` (from
 * `src/webview-document.ts`) and optional injected `renderDocument` callbacks.
 * Includes both `PanelPayload` canonical keys and App Sidecar contract aliases
 * so integration across IDE and App surfaces stays seamless.
 */
export interface SidecarDocumentParams extends MonitorDocumentV1175Extras {
    surface: 'app-sidecar';
    version: string;
    viewMode: SidecarViewMode;
    language: Language;
    lastUpdatedTime: string;
    // Primary telemetry (canonical + alias)
    data: ContextUsage | null;
    currentUsage: ContextUsage | null;
    allTrajectoryUsages: ContextUsage[];
    allTrajectories: TrajectorySummary[];
    userStatus: FullUserStatus;
    userInfo: UserStatusInfo | null;
    modelConfigs: ModelConfig[];
    workspaceUri: string;
    gmSummary: GMSummary | null;
    gmFullSummary: GMSummary | null;
    gmConversations: Record<string, GMConversationData>;
    activitySummary: ActivitySummary | null;
    dailyLedger: DailyLedger | { active: LedgerAccountBucket[]; settled: LedgerSettledEntry[] };
    todayLedgerActive: LedgerAccountBucket[];
    ledgerSettled: LedgerSettledEntry[];
    dailyStore: DailyStore;
    dailyStoreSnapshot: DailyStoreState;
    pricingStore: PricingStore;
    pricingOverrides: Record<string, ModelPricing>;
    customPricing: Record<string, ModelPricing>;
    accountSnapshots: AccountSnapshot[];
    activeAccountKey: string;
    billingDays: Record<string, number>;
    billingDaysMap: Record<string, number>;
    orchestratorSettings: OrchestratorSettings | null;
    quotaSummary: UserQuotaSummary | null;
    todayCostUsd?: number;
    sessionCostUsd?: number;
    settings: MonitorDocumentSettings;
    panelHintPrefs: PanelHintPreferences;
    panelPrefs: PanelHintPreferences;
    zoomLevel: number;
    calendarYear: number;
    calendarMonth: number;
    storageDiagnostics: StorageDiagnostics;
    modelDNA: Record<string, PersistedModelDNA>;
    isPaused: boolean;
    paused: boolean;
    backendStatus: MonitorStatus;
    monitorStatus: MonitorStatus;
    initialTab?: MonitorTabId;
    now: number;
    imagesBaseUri?: string;
    extras: MonitorDocumentV1175Extras;
}

export interface SidecarRuntimeDeps {
    discoverLS: (options: DiscoverLanguageServerOptions) => Promise<LSInfo | null>;
    fetchFullUserStatus: (ls: LSInfo, signal?: AbortSignal) => Promise<FullUserStatus | FullUserStatusFetchResult>;
    getAllTrajectories: (ls: LSInfo, signal?: AbortSignal) => Promise<TrajectorySummary[]>;
    readUnlistedMemberStepCount: typeof readUnlistedMemberStepCount;
    getContextUsage: (
        ls: LSInfo,
        trajectory: TrajectorySummary,
        customLimits?: Record<string, number>,
        signal?: AbortSignal,
    ) => Promise<ContextUsage>;
    refreshWorkflowImageUsage: (ls: LSInfo, usage: ContextUsage, signal?: AbortSignal) => Promise<ContextUsage>;
    fetchTrajectoryGeneratorMetadata: (
        ls: LSInfo,
        cascadeId: string,
        signal?: AbortSignal,
    ) => Promise<RawGeneratorMetadataEntry[]>;
    fetchTrajectoryGeneratorMetadataResult?: (
        ls: LSInfo,
        cascadeId: string,
        signal?: AbortSignal,
    ) => Promise<FetchTrajectoryGeneratorMetadataResult>;
    fetchTrajectorySteps: (
        ls: LSInfo,
        cascadeId: string,
        totalSteps: number,
        signal?: AbortSignal,
    ) => Promise<{ ok?: boolean; steps: Array<Record<string, unknown>>; hasGaps: boolean; error?: string }>;
    fetchOrchestratorSettings: (
        ls: LSInfo,
        configs: readonly ModelConfig[],
        signal?: AbortSignal,
    ) => Promise<OrchestratorSettings | null>;
    fetchUserQuotaSummary: (ls: LSInfo, signal?: AbortSignal) => Promise<UserQuotaSummary | null>;
    fetchAvailableModels: (ls: LSInfo, signal?: AbortSignal) => Promise<Record<string, unknown> | null>;
    processActivity?: (
        ls: LSInfo,
        trajectories: TrajectorySummary[],
        signal?: AbortSignal,
    ) => Promise<boolean>;
    fetchGM?: (
        ls: LSInfo,
        trajectories: TrajectorySummary[],
        activeCascadeId?: string,
        signal?: AbortSignal,
    ) => Promise<GMSummary | null>;
    revealInOs: (targetPath: string, isDirectory: boolean) => Promise<void>;
    openFileInOs?: (targetPath: string) => Promise<void>;
    openExternalUrl: (url: string) => Promise<void>;
    createCdpOverlayManager: (opts: CdpAmbientOverlayManagerOptions) => CdpAmbientOverlayManager;
    createOverlayBridge: typeof createOverlayActionBridge;
    inspectCdpLauncher: (opts?: CdpLauncherOptions) => CdpLauncherStatus;
    createCdpLauncher: (opts?: CdpLauncherOptions) => CdpLauncherActionResult;
    removeCdpLauncher: (opts?: CdpLauncherOptions) => CdpLauncherActionResult;
    revealCdpLauncher: (opts?: CdpLauncherOptions) => CdpLauncherActionResult;
    checkForUpdates: (opts: CheckForUpdatesOptions) => Promise<UpdateCheckResult>;
    applyAppPluginUpdate: (opts: ApplyAppPluginUpdateOptions) => Promise<ApplyPluginUpdateResult>;
    cliUsageScanner: CliUsageScanner;
    now: () => number;
    homedir: () => string;
}

export interface SidecarRuntimeOptions {
    /** Semantic version string (defaults to core/version resolver). */
    version?: string;
    /** Override path for DurableState `state-v1.json` (defaults to platform-native shared path). */
    statePath?: string;
    /** Optional host profile directory containing brain/. */
    dataDir?: string;
    /** Optional explicit brain directory for read-only swarm manifest scanning. */
    brainDir?: string;
    /** True when running connected to a remote host (disables unrelated local brain scanning). */
    isRemoteHost?: boolean;
    /** Optional remote authority string (disables unrelated local brain scanning). */
    remoteAuthority?: string | null;
    /** Optional swarm manifest scan budget overrides. */
    swarmScanBudgets?: Partial<SwarmScanBudgets>;
    /** Optional swarm poll scheduler budget overrides (`maxConcurrency` hard-capped <= 3). */
    swarmPollBudget?: Partial<SwarmPollBudgetConfig>;
    /** Optional plugin root directory (for reading plugin.json version). */
    pluginRoot?: string;
    /** Optional explicit target directory for in-app plugin self-upgrade. */
    targetPluginDir?: string;
    /** Optional Antigravity CLI data directory override for Calendar CLI usage scanning. */
    cliDataDir?: string;
    /** Disable CLI usage scanning (useful for isolated unit tests). */
    disableCliScan?: boolean;
    /** Explicit opt-in/out for background GitHub release auto-checks at startup. */
    enableAutoUpdateCheck?: boolean;
    /** Optional pre-configured 256-bit overlay bridge auth token. */
    overlayBridgeToken?: string;
    /** Optional sidecar listening port(s) to exclude from CDP Hub target discovery. */
    excludeTargetPorts?: number[];
    /** Initial workspace URIs if known at startup. */
    initialWorkspaceUris?: string[];
    /** Automatically start background adaptive polling (default: true). */
    autoStart?: boolean;
    /** Idle threshold in ms after last client request before switching to idle backoff (default: 60_000). */
    idleThresholdMs?: number;
    /** Polling interval in ms when idle with no recent client activity (default: 30_000). */
    idlePollIntervalMs?: number;
    /** Optional host locale (e.g. from App UI / OS) used for per-view auto language priority. */
    hostLocale?: string;
    /** Optional diagnostic logger. */
    log?: (msg: string) => void;
    /** Optional injected document renderer (overrides dynamic `../webview-document` load). */
    renderDocument?: (params: SidecarDocumentParams) => string;
    /** Optional injected incremental tabs renderer (overrides dynamic `../webview-document` load). */
    renderTabs?: (params: SidecarDocumentParams) => Record<string, string | boolean>;
    /** Optional dependency overrides for deterministic unit tests. */
    deps?: Partial<SidecarRuntimeDeps>;
}

export interface SidecarRuntimeStateSnapshot {
    lsInfo: LSInfo | null;
    monitorStatus: MonitorStatus;
    currentUsage: ContextUsage | null;
    allTrajectories: TrajectorySummary[];
    modelConfigs: ModelConfig[];
    userInfo: UserStatusInfo | null;
    contextBreakdown: ContextBreakdownSnapshot | null;
    turnDiagnostics: TurnDiagnosticsSummary | null;
    quotaRunways: Record<string, QuotaRunwayEstimate>;
    weeklyQuotaRunways?: Record<string, WeeklyQuotaRunwayEstimate>;
    weeklyRunways?: Record<string, WeeklyQuotaRunwayEstimate>;
    promptCacheTtl?: PromptCacheTtlEvaluation | null;
    cacheTtl?: PromptCacheTtlEvaluation | null;
    recoveryBrief?: CompactionRecoveryBrief | null;
    speedCoverage?: { measuredCount: number; totalCount: number } | null;
    isCustomModelActive: boolean;
    staleState: SidecarStaleState;
    conversationOptions: ConversationOption[];
    activeConversationId: string | null;
    pinnedConversationId: string | null;
    lockToMainAgent: boolean;
    lockedMainId: string | null;
    inspectedMemberId: string | null;
    lockPendingUnavailable: boolean;
    retargetOfferId: string | null;
    windowSelectionState: WindowSelectionState;
    latestObservation: PublishedMonitorObservation | null;
    swarmTopology: SwarmTopologySnapshot;
    swarmGroupCost: SwarmGroupCostSummary | null;
    lastSwarmPollTick: SwarmPollTickResult | null;
    isPaused: boolean;
    settings: MonitorDocumentSettings;
    appSettings: AppSettingsWithV118;
    orchestratorPricingMode: OrchestratorPricingMode;
    cdpStatus: CdpStatus;
    updateStatus: UpdateStatusView | null;
    lastUpdatedTime: string;
    pollCount: number;
    lastPollAtMs: number;
}

export interface SidecarRuntimeProvider extends SidecarProvider {
    pollNow(force?: boolean): Promise<void>;
    getState(): SidecarRuntimeStateSnapshot;
    getDurableState(): DurableState;
    getStorageDiagnostics(): StorageDiagnostics;
    getOverlayBridgeAuth(): { token: string; allowedOrigin?: string };
    validateOverlayBridgeAuth(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): boolean;
    resolveOverlayTargetId(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): string | undefined;
    handleOverlayAction(action: SidecarOverlayBridgeRequest): Promise<SidecarActionHttpBody>;
    getCdpStatus(): CdpStatus;
    buildOverlayPayload(nowMs?: number): CdpOverlayPayload;
    getLatestObservation(): PublishedMonitorObservation | null;
    getWindowSelectionState(windowId?: string): WindowSelectionState;
    getSwarmTopology(): SwarmTopologySnapshot;
    getSwarmGroupCost(): SwarmGroupCostSummary | null;
    getAppSettings(): AppSettingsWithV118;
    setListeningPort?(port: number): void;
    dispose(): Promise<void>;
}

// ─── Constants & Defaults ────────────────────────────────────────────────────

const LARGE_STATE_FILE_WARN_BYTES = 1 * 1024 * 1024;
const DEFAULT_IDLE_THRESHOLD_MS = 60_000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 30_000;
const STATUS_REFRESH_INTERVAL = 2;
const LS_REVALIDATION_INTERVAL = 6;
const MAX_CHECKPOINTER_SYNC_ATTEMPTS = 5;
const MAX_AUX_METADATA_FAILURES = 3;
const RESET_TIME_TURNOVER_MIN_JUMP_MS = 10 * 60 * 1000;
const HOST_CONVERSATION_STALE_MS = 20_000;
const HOST_PENDING_MAX_MS = 60_000;
const SAFE_CASCADE_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;
const ALLOWED_OVERLAY_TARGET_TABS: ReadonlySet<CdpOverlayTargetTab> = new Set([
    'overview',
    'gm',
    'sessions',
    'cost',
    'models',
    'calendar',
    'accounts',
    'settings',
]);

const DEFAULT_DOCUMENT_SETTINGS: MonitorDocumentSettings = {
    pollingInterval: 5,
    quotaNotificationThreshold: 20,
    showContext: true,
    showQuota: true,
    showResetCountdown: true,
    showAiCredits: true,
    showSpeed: false,
    showCacheHit: false,
    showSessionCost: false,
    tooltipDensity: 'auto',
    showModelInternalId: false,
    maxRecentSteps: 100,
    maxArchives: 20,
    lockToMainAgent: false,
};

// ─── Pure Helper Functions ───────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function isSameLSConnection(a: LSInfo | null | undefined, b: LSInfo | null | undefined): boolean {
    if (!a || !b) { return false; }
    return a.pid === b.pid
        && a.port === b.port
        && a.csrfToken === b.csrfToken
        && a.useTls === b.useTls
        && (a.hostname || '127.0.0.1') === (b.hostname || '127.0.0.1');
}

function isFullUserStatusOk(res: FullUserStatus | FullUserStatusFetchResult | null | undefined): boolean {
    if (!res || typeof res !== 'object') { return false; }
    if ('ok' in res && typeof res.ok === 'boolean') {
        return res.ok === true;
    }
    return Boolean(res.userInfo || (Array.isArray(res.configs) && res.configs.length > 0));
}

function shouldSettleOnResetTimeChange(oldResetTime: string, newResetTime: string, nowMs: number): boolean {
    if (!oldResetTime || !newResetTime || oldResetTime === newResetTime) { return false; }
    const oldMs = parsePositivePoolResetMs(oldResetTime);
    const newMs = parsePositivePoolResetMs(newResetTime);
    if (oldMs === null || newMs === null) { return false; }
    if (oldMs > nowMs || newMs <= nowMs) { return false; }
    return (newMs - oldMs) >= RESET_TIME_TURNOVER_MIN_JUMP_MS;
}

// ─── Per-Poll Wire-Equivalent RPC Coalescing Cache (PERF-02) ─────────────────

export interface PollRpcCacheKey {
    backendEpoch: number;
    authority: string;
    method: string;
    cascadeId?: string | null;
    range?: string | null;
    branchRevision?: string | number | null;
}

interface PollRpcCacheEntry<T> {
    status: 'pending' | 'resolved';
    controller: AbortController;
    refCount: number;
    promise: Promise<T>;
    value?: T;
}

function createAbortError(reason?: unknown): Error {
    if (reason instanceof Error) { return reason; }
    const err = new Error(typeof reason === 'string' && reason ? reason : 'RPC aborted');
    err.name = 'AbortError';
    return err;
}

/**
 * Coalesces equivalent in-flight and completed RPC calls within a single poll cycle
 * keyed strictly by `{ backendEpoch, authority, method, cascadeId, range, branchRevision }`.
 *
 * Consumer cancellation isolation: each caller may pass its own `consumerSignal`.
 * Aborting one consumer rejects ONLY that consumer's promise and decrements the
 * entry's refCount — upstream cancellation fires ONLY when every active consumer
 * has cancelled (or `abortAll()` is called), preventing sibling poisoning.
 */
export class PollRpcCache {
    private readonly _entries = new Map<string, PollRpcCacheEntry<unknown>>();
    static formatKey(k: PollRpcCacheKey): string {
        return JSON.stringify([k.backendEpoch, k.authority, k.method, k.cascadeId ?? '', k.range ?? '', k.branchRevision ?? '']);
    }
    get size(): number { return this._entries.size; }
    getOrFetch<T>(
        key: PollRpcCacheKey,
        fetcher: (upstreamSignal: AbortSignal) => Promise<T>,
        consumerSignal?: AbortSignal,
        options?: { shouldCache?: (val: T) => boolean },
    ): Promise<T> {
        if (consumerSignal?.aborted) { return Promise.reject(createAbortError(consumerSignal.reason)); }
        const cacheKey = PollRpcCache.formatKey(key);
        const checkCacheable = (v: T) => { if (!options?.shouldCache) { return true; } try { return Boolean(options.shouldCache(v)); } catch { return false; } };
        let entry = this._entries.get(cacheKey) as PollRpcCacheEntry<T> | undefined;
        if (entry?.status === 'resolved') {
            if (checkCacheable(entry.value as T)) { return Promise.resolve(entry.value as T); }
            this._entries.delete(cacheKey);
            entry = undefined;
        }
        if (!entry) {
            const controller = new AbortController();
            const created: PollRpcCacheEntry<T> = { status: 'pending', controller, refCount: 0, promise: null as unknown as Promise<T> };
            let raw: Promise<T>;
            try { raw = Promise.resolve(fetcher(controller.signal)); } catch (e) { raw = Promise.reject(e); }
            const upstream = raw.then((val) => {
                if (this._entries.get(cacheKey) === created) {
                    if (checkCacheable(val)) { created.status = 'resolved'; created.value = val; } else { this._entries.delete(cacheKey); }
                }
                return val;
            }).catch((err) => { if (this._entries.get(cacheKey) === created) { this._entries.delete(cacheKey); } throw err; });
            upstream.catch(() => {});
            created.promise = upstream;
            this._entries.set(cacheKey, created as PollRpcCacheEntry<unknown>);
            entry = created;
        }
        const active = entry;
        active.refCount++;
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const done = (fn: () => void) => {
                if (settled) { return; }
                settled = true;
                consumerSignal?.removeEventListener('abort', onAbort);
                active.refCount = Math.max(0, active.refCount - 1);
                fn();
            };
            const onAbort = () => done(() => {
                if (active.refCount === 0 && active.status === 'pending') {
                    if (this._entries.get(cacheKey) === active) { this._entries.delete(cacheKey); }
                    active.controller.abort(consumerSignal?.reason);
                }
                reject(createAbortError(consumerSignal?.reason));
            });
            consumerSignal?.addEventListener('abort', onAbort, { once: true });
            active.promise.then((v) => done(() => resolve(v)), (e) => done(() => reject(e)));
        });
    }
    abortAll(): void {
        for (const e of this._entries.values()) { if (e.status === 'pending') { e.controller.abort(); } }
        this._entries.clear();
    }
    clear(): void { this._entries.clear(); }
}

function mapCatalogProvenance(p: CatalogContextLimitProvenance): ContextLimitProvenance {
    switch (p) {
        case 'live_checkpointer': return 'planner_config';
        case 'live_catalog': return 'ls_metadata';
        case 'static_verified': return 'model_catalog';
        case 'custom_override': return 'explicit_override';
        case 'heuristic_guess':
        case 'default_fallback': return 'model_guess';
        case 'none':
        default: return 'unavailable';
    }
}

function isSuffixRecoveredResult(val: unknown): boolean {
    return Boolean((val as { suffixRecovered?: boolean } | null | undefined)?.suffixRecovered);
}

function hasSameUsageInputs(
    cached: ContextUsage | null | undefined,
    trajectory: Pick<TrajectorySummary, 'cascadeId' | 'stepCount' | 'lastModifiedTime' | 'status'>,
): cached is ContextUsage {
    return !!cached
        && !cached.hasGaps
        && cached.tokenUsageSource !== undefined
        && cached.imageWorkflow !== undefined
        && (!cached.compressionDetected || cached.checkpointCompressionDrop > 0)
        && trajectory.status !== CascadeStatus.RUNNING
        && cached.status === trajectory.status
        && cached.cascadeId === trajectory.cascadeId
        && cached.stepCount === trajectory.stepCount
        && cached.lastModifiedTime === trajectory.lastModifiedTime;
}

function applyGMContextToUsage(usage: ContextUsage, gmContextUsed: number): boolean {
    if (usage.lastModelUsage || !Number.isSafeInteger(gmContextUsed)
        || gmContextUsed <= 0 || gmContextUsed === usage.contextUsed) { return false; }
    usage.contextUsed = gmContextUsed;
    usage.isEstimated = true;
    usage.usagePercent = usage.contextLimit > 0 ? (gmContextUsed / usage.contextLimit) * 100 : 0;
    return true;
}

function buildGMFallbackOptions(
    currentStepCount?: number,
    previousMaxStepCount?: number,
    breakdown?: ContextBreakdownSnapshot | null,
    compressionDetected?: boolean,
): GMContextFallbackOptions | undefined {
    const opts: GMContextFallbackOptions = {};
    let hasBound = false;

    const checkpoints = breakdown?.compactionCheckpoints;
    if (Array.isArray(checkpoints) && checkpoints.length > 0) {
        let maxStep = -1;
        for (const cp of checkpoints) {
            if (typeof cp.stepIndex === 'number' && Number.isSafeInteger(cp.stepIndex) && cp.stepIndex > maxStep) {
                maxStep = cp.stepIndex;
            }
        }
        if (maxStep >= 0) {
            opts.compactionBoundary = { stepIndex: maxStep, exclusive: true };
            hasBound = true;
        }
    }

    if (
        typeof previousMaxStepCount === 'number'
        && typeof currentStepCount === 'number'
        && previousMaxStepCount > currentStepCount
        && currentStepCount >= 0
    ) {
        // Rewind detected: reject pre-rewind high-water calls beyond/before the rewind boundary
        opts.minStepIndex = currentStepCount;
        opts.exclusive = false;
        hasBound = true;
    } else if (compressionDetected && !hasBound && typeof currentStepCount === 'number' && currentStepCount > 0) {
        opts.minStepIndex = currentStepCount;
        opts.exclusive = false;
        hasBound = true;
    }

    return hasBound ? opts : undefined;
}

// ─── Safe Cross-Platform Reveal-Path Security Boundary ───────────────────────

export interface RevealPathValidationResult {
    ok: boolean;
    statusCode?: number;
    error?: string;
    resolvedPath?: string;
    isDirectory?: boolean;
}

export interface RevealPathFsOps {
    existsSync?: (targetPath: string) => boolean;
    realpathSync?: (targetPath: string) => string;
    statSync?: (targetPath: string) => { isFile(): boolean; isDirectory(): boolean; dev?: number | bigint; ino?: number | bigint };
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    caseProbeFs?: PathCaseProbeFs;
}

interface ParsedWslUncPath {
    distro: string;
    posixPath: string;
}

function parseWslUncPath(raw: string): ParsedWslUncPath | null {
    const m = /^(?:\\\\|\/\/)(?:wsl\$|wsl\.localhost)[\\/]([^\\/]+)(?:[\\/](.*))?$/i.exec(raw);
    if (!m) { return null; }
    const distro = m[1].trim().toLowerCase();
    if (!distro) { return null; }
    const rest = (m[2] || '').replace(/\\/g, '/');
    const posixPath = path.posix.normalize('/' + rest);
    return { distro, posixPath };
}

function uriOrPathToFsPath(raw: string, platform: NodeJS.Platform = process.platform): string | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('\0')) { return null; }
    // Preserve WSL UNC paths directly without mangling through POSIX path.resolve
    if (/^(?:\\\\|\/\/)(?:wsl\$|wsl\.localhost)[\\/]/i.test(trimmed)) {
        return trimmed;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
        if (!/^file:\/\//i.test(trimmed)) {
            return null;
        }
        try {
            const parsed = new URL(trimmed);
            const host = (parsed.hostname || '').toLowerCase();
            if (host && host !== 'localhost' && host !== 'wsl$' && host !== 'wsl.localhost' && platform !== 'win32') {
                return null;
            }
            if (host === 'wsl$' || host === 'wsl.localhost') {
                const segs = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
                return `\\\\${host}\\${segs.replace(/\//g, '\\')}`;
            }
            return fileURLToPath(trimmed);
        } catch {
            return null;
        }
    }
    if (platform === 'win32' && /^[a-zA-Z]:[\\/]/.test(trimmed)) {
        return path.win32.resolve(trimmed);
    }
    return path.resolve(trimmed);
}

function isRelativeContained(rel: string, sep: '/' | '\\', isAbsFn: (p: string) => boolean): boolean {
    if (rel === '') { return true; }
    if (rel === '..' || rel.startsWith(`..${sep}`)) { return false; }
    return !isAbsFn(rel);
}

function isPathInsideRoot(
    targetReal: string,
    rootReal: string,
    platform: NodeJS.Platform = process.platform,
    probeCaseSensitivity?: (fsPath: string) => boolean | null,
): boolean {
    // 1. WSL UNC paths: enforce strict distro isolation AND POSIX case-sensitive containment
    const targetWsl = parseWslUncPath(targetReal);
    const rootWsl = parseWslUncPath(rootReal);
    if (targetWsl || rootWsl) {
        if (!targetWsl || !rootWsl) { return false; }
        if (targetWsl.distro !== rootWsl.distro) { return false; }
        const rel = path.posix.relative(rootWsl.posixPath, targetWsl.posixPath);
        return isRelativeContained(rel, '/', path.posix.isAbsolute);
    }

    // 2. Native Windows paths (drive letters / standard UNC shares)
    if (platform === 'win32') {
        const rel = path.win32.relative(rootReal.toLowerCase(), targetReal.toLowerCase());
        return isRelativeContained(rel, '\\', path.win32.isAbsolute);
    }

    // 3. macOS: exact canonical match always passes; case-folded match is allowed ONLY
    //    when BOTH root and target positively probe as case-insensitive (`=== false`).
    //    Case-sensitive APFS (`true`) or indeterminate / cross-mount (`null`) FAILS CLOSED.
    if (platform === 'darwin') {
        const exactRel = path.posix.relative(rootReal, targetReal);
        if (isRelativeContained(exactRel, '/', path.posix.isAbsolute)) {
            return true;
        }
        const probe = probeCaseSensitivity ?? ((p: string) => detectPathCaseSensitivity(p));
        const rootSensitive = probe(rootReal);
        const targetSensitive = probe(targetReal);
        if (rootSensitive === false && targetSensitive === false) {
            const foldedRel = path.posix.relative(rootReal.toLowerCase(), targetReal.toLowerCase());
            return isRelativeContained(foldedRel, '/', path.posix.isAbsolute);
        }
        return false;
    }

    // 4. Linux / POSIX: strict case-sensitive containment
    const rel = path.posix.relative(rootReal, targetReal);
    return isRelativeContained(rel, '/', path.posix.isAbsolute);
}

/**
 * Strictly validate a target path before revealing in OS file manager using POSITIVE
 * authorization ONLY against canonicalized existing allowed roots.
 *
 * Security invariants:
 * - Zero lexical fallback (`path.resolve`) when canonicalizing roots fails — fails closed (403).
 * - Rejects non-local / remote URI schemes (`vscode-remote://`, `http://`, etc.) fail-closed.
 * - Honors target filesystem semantics (macOS APFS case-sensitivity probe, WSL distro & POSIX
 *   case-sensitivity isolation, Windows drive/UNC authority, strict POSIX on Linux) and fails
 *   closed on indeterminate containment.
 */
export function validateRevealTargetPath(
    rawPath: unknown,
    allowedRoots: readonly string[],
    platform: NodeJS.Platform = process.platform,
    fsOps?: RevealPathFsOps,
): RevealPathValidationResult {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, statusCode: 400, error: 'Target path is required' };
    }
    if (rawPath.includes('\0')) {
        return { ok: false, statusCode: 400, error: 'Invalid target path' };
    }
    const candidate = uriOrPathToFsPath(rawPath, platform);
    if (!candidate) {
        return { ok: false, statusCode: 403, error: 'Unsupported path scheme' };
    }

    const existsSync = fsOps?.existsSync ?? fs.existsSync;
    const realpathSync = fsOps?.realpathSync ?? fs.realpathSync;
    const statSync = fsOps?.statSync ?? fs.statSync;
    const probeCase = fsOps?.isCaseSensitivePath
        ?? (fsOps?.caseProbeFs ? ((p: string) => detectPathCaseSensitivity(p, fsOps.caseProbeFs)) : undefined);

    if (!existsSync(candidate)) {
        return { ok: false, statusCode: 404, error: 'Target path does not exist' };
    }

    let realTarget: string;
    let stat: { isFile(): boolean; isDirectory(): boolean };
    try {
        realTarget = realpathSync(candidate);
        stat = statSync(realTarget);
    } catch {
        return { ok: false, statusCode: 404, error: 'Target path cannot be accessed' };
    }

    if (!stat.isFile() && !stat.isDirectory()) {
        return { ok: false, statusCode: 403, error: 'Target path must be a file or directory' };
    }

    const resolvedRoots: string[] = [];
    for (const root of allowedRoots) {
        const fsRoot = uriOrPathToFsPath(root, platform);
        if (!fsRoot) { continue; }
        try {
            if (!existsSync(fsRoot)) { continue; }
            resolvedRoots.push(realpathSync(fsRoot));
        } catch {
            // Fail-closed: NEVER fall back to lexical path.resolve when canonicalization fails
            continue;
        }
    }

    if (resolvedRoots.length === 0) {
        return { ok: false, statusCode: 403, error: 'Path is outside allowed directories' };
    }

    const allowed = resolvedRoots.some(rootReal => isPathInsideRoot(realTarget, rootReal, platform, probeCase));
    if (!allowed) {
        return { ok: false, statusCode: 403, error: 'Path is outside allowed directories' };
    }

    return {
        ok: true,
        resolvedPath: realTarget,
        isDirectory: stat.isDirectory(),
    };
}

export interface RevealCommandSpec {
    cmd: string;
    args: string[];
    options: {
        windowsHide: boolean;
        timeout: number;
        shell: false;
        windowsVerbatimArguments?: boolean;
    };
}

/**
 * Build a shell-free, cross-platform command spec to reveal a validated local
 * file or directory in the OS file manager.
 *
 * - macOS: `open -R <file>` / `open <dir>`
 * - Windows: `explorer.exe /select, "<file>"` with `windowsVerbatimArguments: true`
 *   and `shell: false` so paths containing spaces AND commas select cleanly without
 *   invoking `cmd.exe`.
 * - Linux: `xdg-open <parentDir|dir>`
 */
const EXEC_OPTS = { windowsHide: true, timeout: 10_000, shell: false as const };
function runExecSpec(build: () => RevealCommandSpec): Promise<void> {
    return new Promise((resolve, reject) => {
        let spec: RevealCommandSpec;
        try { spec = build(); } catch (err) { reject(err); return; }
        execFile(spec.cmd, spec.args, spec.options, (err) => { if (err) { reject(err); } else { resolve(); } });
    });
}

function validateOsTargetPath(targetPath: string, verb: string): void {
    if (typeof targetPath !== 'string' || !targetPath.trim()) { throw new Error(`${verb} target path is required`); }
    if (/[\0\r\n]/.test(targetPath)) { throw new Error(`${verb} target path contains forbidden control characters`); }
}

export function buildRevealInOsCommand(targetPath: string, isDirectory: boolean, platform: NodeJS.Platform = process.platform): RevealCommandSpec {
    validateOsTargetPath(targetPath, 'Reveal');
    if (platform === 'darwin') { return { cmd: 'open', args: isDirectory ? [targetPath] : ['-R', targetPath], options: { ...EXEC_OPTS } }; }
    if (platform === 'win32') {
        if (targetPath.includes('"')) { throw new Error('Windows reveal target path contains forbidden quote character'); }
        const q = `"${targetPath}"`;
        return { cmd: 'explorer.exe', args: isDirectory ? [q] : ['/select,', q], options: { ...EXEC_OPTS, windowsVerbatimArguments: true } };
    }
    return { cmd: 'xdg-open', args: [isDirectory ? targetPath : path.dirname(targetPath)], options: { ...EXEC_OPTS } };
}

export function defaultRevealInOs(targetPath: string, isDirectory: boolean): Promise<void> {
    return runExecSpec(() => buildRevealInOsCommand(targetPath, isDirectory, process.platform));
}

export function buildOpenFileInOsCommand(targetPath: string, platform: NodeJS.Platform = process.platform): RevealCommandSpec {
    validateOsTargetPath(targetPath, 'Open');
    if (platform === 'darwin') { return { cmd: 'open', args: [targetPath], options: { ...EXEC_OPTS } }; }
    if (platform === 'win32') {
        if (targetPath.includes('"')) { throw new Error('Windows open target path contains forbidden quote character'); }
        return { cmd: 'explorer.exe', args: [`"${targetPath}"`], options: { ...EXEC_OPTS, windowsVerbatimArguments: true } };
    }
    return { cmd: 'xdg-open', args: [targetPath], options: { ...EXEC_OPTS } };
}

export function defaultOpenFileInOs(targetPath: string): Promise<void> {
    return runExecSpec(() => buildOpenFileInOsCommand(targetPath, process.platform));
}

export const ALLOWED_EXTERNAL_URL_HOSTS: ReadonlySet<string> = new Set([
    'github.com', 'docs.github.com', 'raw.githubusercontent.com', 'open-vsx.org', 'marketplace.visualstudio.com', 'antigravity.google',
]);

export function validateExternalUrl(rawUrl: unknown): string | null {
    if (typeof rawUrl !== 'string') { return null; }
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.length > 2048 || /[\0\r\n"&|^<>`%]/.test(trimmed.replace(/%[0-9A-Fa-f]{2}/g, ''))) { return null; }
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !ALLOWED_EXTERNAL_URL_HOSTS.has(u.hostname.toLowerCase())) { return null; }
        return u.toString();
    } catch { return null; }
}

export function buildOpenExternalUrlCommand(safeUrl: string, platform: NodeJS.Platform = process.platform): RevealCommandSpec {
    const validated = validateExternalUrl(safeUrl);
    if (!validated) { throw new Error('External URL rejected by strict HTTPS allowlist'); }
    if (platform === 'darwin') { return { cmd: 'open', args: [validated], options: { ...EXEC_OPTS } }; }
    if (platform === 'win32') { return { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', validated], options: { ...EXEC_OPTS } }; }
    return { cmd: 'xdg-open', args: [validated], options: { ...EXEC_OPTS } };
}

export function defaultOpenExternalUrl(rawUrl: string): Promise<void> {
    return runExecSpec(() => buildOpenExternalUrlCommand(rawUrl, process.platform));
}

// ─── Runtime Engine Factory ──────────────────────────────────────────────────

/**
 * Create the live Antigravity App Sidecar backend provider.
 */
export function createSidecarRuntimeProvider(
    options: SidecarRuntimeOptions = {},
): SidecarRuntimeProvider {
    const version = resolveRuntimeVersion({
        explicitVersion: options.version,
        pluginRoot: options.pluginRoot,
        fallbackVersion: DEFAULT_SIDECAR_VERSION,
    });
    const log = options.log || (() => {});
    const idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    const idlePollIntervalMs = options.idlePollIntervalMs ?? DEFAULT_IDLE_POLL_INTERVAL_MS;

    const deps: SidecarRuntimeDeps = {
        discoverLS: options.deps?.discoverLS ?? ((opts) => discoverLanguageServer(opts)),
        fetchFullUserStatus: options.deps?.fetchFullUserStatus ?? fetchFullUserStatus,
        getAllTrajectories: options.deps?.getAllTrajectories ?? getAllTrajectories,
        readUnlistedMemberStepCount: options.deps?.readUnlistedMemberStepCount ?? readUnlistedMemberStepCount,
        getContextUsage: options.deps?.getContextUsage ?? getContextUsage,
        refreshWorkflowImageUsage: options.deps?.refreshWorkflowImageUsage ?? refreshWorkflowImageUsage,
        fetchTrajectoryGeneratorMetadata: options.deps?.fetchTrajectoryGeneratorMetadata ?? fetchTrajectoryGeneratorMetadata,
        fetchTrajectoryGeneratorMetadataResult: options.deps?.fetchTrajectoryGeneratorMetadataResult
            ?? (options.deps?.fetchTrajectoryGeneratorMetadata
                ? (async (ls, cid, signal) => {
                    try {
                        const metadata = await options.deps!.fetchTrajectoryGeneratorMetadata!(ls, cid, signal);
                        return { ok: true, metadata };
                    } catch (err) {
                        return { ok: false, metadata: [], error: err instanceof Error ? err.message : String(err) };
                    }
                })
                : fetchTrajectoryGeneratorMetadataResult),
        fetchTrajectorySteps: options.deps?.fetchTrajectorySteps ?? fetchTrajectorySteps,
        fetchOrchestratorSettings: options.deps?.fetchOrchestratorSettings ?? fetchOrchestratorSettings,
        fetchUserQuotaSummary: options.deps?.fetchUserQuotaSummary ?? fetchUserQuotaSummary,
        fetchAvailableModels: options.deps?.fetchAvailableModels ?? (async (ls, signal) => {
            try {
                return await rpcCall(ls, 'GetAvailableModels', {
                    metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
                }, 10_000, signal);
            } catch {
                return null;
            }
        }),
        revealInOs: options.deps?.revealInOs ?? defaultRevealInOs,
        openFileInOs: options.deps?.openFileInOs
            ?? (options.deps?.revealInOs
                ? (targetPath: string) => options.deps!.revealInOs!(targetPath, false)
                : defaultOpenFileInOs),
        openExternalUrl: options.deps?.openExternalUrl ?? defaultOpenExternalUrl,
        createCdpOverlayManager: options.deps?.createCdpOverlayManager ?? createCdpAmbientOverlayManager,
        createOverlayBridge: options.deps?.createOverlayBridge ?? createOverlayActionBridge,
        inspectCdpLauncher: options.deps?.inspectCdpLauncher ?? inspectCdpLauncher,
        createCdpLauncher: options.deps?.createCdpLauncher ?? createCdpLauncher,
        removeCdpLauncher: options.deps?.removeCdpLauncher ?? removeCdpLauncher,
        revealCdpLauncher: options.deps?.revealCdpLauncher ?? revealCdpLauncher,
        checkForUpdates: options.deps?.checkForUpdates ?? checkForUpdates,
        applyAppPluginUpdate: options.deps?.applyAppPluginUpdate ?? applyAppPluginUpdate,
        cliUsageScanner: options.deps?.cliUsageScanner ?? new CliUsageScanner(),
        processActivity: options.deps?.processActivity,
        fetchGM: options.deps?.fetchGM,
        now: options.deps?.now ?? (() => Date.now()),
        homedir: options.deps?.homedir ?? (() => os.homedir()),
    };

    // ── Shared Persistence (DurableState) ────────────────────────────────────
    const durableState = new DurableState(options.statePath);
    const globalState: StateBucket = durableState.globalBucket();
    const workspacesByWindow = new Map<string, string[]>();
    const initialWorkspaces = Array.isArray(options.initialWorkspaceUris)
        ? options.initialWorkspaceUris.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : [];
    if (initialWorkspaces.length > 0) {
        workspacesByWindow.set('default', [...new Set(initialWorkspaces)]);
    }
    let activeWorkspaceUris: string[] = [...new Set(initialWorkspaces)];
    const rebuildActiveWorkspaceUris = (): void => {
        const union = new Set<string>();
        for (const list of workspacesByWindow.values()) {
            for (const uri of list) {
                if (uri) { union.add(uri); }
            }
        }
        activeWorkspaceUris = [...union];
    };
    const getPrimaryWorkspaceKey = (): string =>
        activeWorkspaceUris.length > 0 ? normalizeUri(activeWorkspaceUris[0]) : 'app-sidecar';
    let workspaceState: StateBucket = durableState.workspaceBucket(getPrimaryWorkspaceKey());

    // ── Full-Chain Privacy Mask & Opaque Account Handle Registry (SEC-04) ────
    const privacyMaskedByWindow = new Map<string, boolean>();
    function extractExplicitWindowId(rawWindowId?: unknown): string | undefined {
        return typeof rawWindowId === 'string' && rawWindowId.trim() ? rawWindowId.trim() : undefined;
    }
    function resolvePrivacyWindowId(rawWindowId?: unknown): string {
        return extractExplicitWindowId(rawWindowId) ?? activeWindowId;
    }
    function isPrivacyMaskedForWindow(rawWindowId?: unknown): boolean {
        const winId = extractExplicitWindowId(rawWindowId);
        if (!winId) { return true; }
        const explicit = privacyMaskedByWindow.get(winId);
        return explicit !== undefined ? explicit : true;
    }
    const privacyHandleSalt = crypto.randomBytes(16);
    const emailToHandle = new Map<string, string>();
    const handleToEmail = new Map<string, string>();
    const emailToAccountIndex = new Map<string, number>();

    function getAccountHandle(email: string): string {
        const clean = (email || '').trim();
        if (!clean) { return 'acct_unknown'; }
        const lower = clean.toLowerCase();
        let handle = emailToHandle.get(lower);
        if (!handle) {
            const digest = crypto.createHmac('sha256', privacyHandleSalt)
                .update(lower)
                .digest('hex')
                .slice(0, 12);
            handle = `acct_${digest}`;
            emailToHandle.set(lower, handle);
            handleToEmail.set(handle, clean);
            emailToAccountIndex.set(lower, emailToAccountIndex.size + 1);
        }
        return handle;
    }

    function getRedactedAccountLabel(email: string): string {
        const clean = (email || '').trim();
        if (!clean) { return 'Account'; }
        getAccountHandle(clean);
        const idx = emailToAccountIndex.get(clean.toLowerCase()) || 1;
        return `Account #${idx}`;
    }

    function resolveAccountIdentifier(raw: unknown): string {
        if (typeof raw !== 'string') { return ''; }
        const clean = raw.trim();
        if (!clean) { return ''; }
        const mapped = handleToEmail.get(clean);
        if (mapped) { return mapped; }
        return clean;
    }

    function escapeRegExp(literal: string): string {
        return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function redactTextForPrivacy(raw: string): string {
        if (!raw) { return raw; }
        let out = raw;
        const rep = (needle: string, r: string, flags = 'g') => { if (needle) { out = out.replace(new RegExp(escapeRegExp(needle), flags), () => r); } };
        const emails = new Set<string>(Object.keys(billingDaysMap).filter(Boolean));
        const names = new Map<string, string>();
        const addAcc = (e?: string, n?: string) => { if (e) { emails.add(e); if (n) { names.set(n, getRedactedAccountLabel(e)); } } };
        addAcc(cachedUserInfo?.email, cachedUserInfo?.name);
        if (currentAccountEmail) { emails.add(currentAccountEmail); }
        for (const s of accountSnapshots.values()) { addAcc(s.email, s.name); }
        for (const e of emails) {
            rep(e, '****@redacted', 'gi');
            const at = e.indexOf('@');
            if (at > 0 && e.slice(at + 1).trim().length >= 4) { rep(e.slice(at + 1).trim(), 'redacted', 'gi'); }
        }
        for (const [n, r] of names) { if (n.trim().length >= 2) { rep(n, r); } }
        const sf = durableState.getFilePath();
        if (sf) {
            rep(sf, '[Redacted State Path]');
            const sd = path.dirname(sf);
            if (sd.length > 4) { rep(sd, '[Redacted State Dir]'); }
        }
        const wsSet = new Set<string>();
        const addWs = (u?: string) => { if (!u) { return; } wsSet.add(u); const f = uriOrPathToFsPath(u); if (f) { wsSet.add(f); } };
        activeWorkspaceUris.forEach(addWs);
        for (const tr of allTrajectories) { (tr.workspaceUris || []).forEach(addWs); addWs(tr.gitRootUri); }
        for (const ws of [...wsSet].sort((a, b) => b.length - a.length)) {
            if (ws.length >= 4) { rep(ws, '[Redacted Workspace]'); }
            const base = path.basename(ws.replace(/[\\/]+$/, ''));
            if (base.length >= 4 && !ws.startsWith('[')) { rep(base, '[Redacted Workspace]'); }
        }
        const home = deps.homedir();
        if (home && home.length >= 4) { rep(home, '[Redacted Home]'); }
        return out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '****@redacted');
    }

    const appLocaleSources = getRuntimeLocaleSources({ hostLocale: options.hostLocale });
    initI18nFromState(globalState, appLocaleSources);

    // ── Core Trackers & Stores ───────────────────────────────────────────────
    const quotaTracker = new QuotaTracker(globalState, globalState);
    quotaTracker.setEnabled(true);

    const savedActivity = globalState.get<ActivityTrackerState | undefined>('activityTrackerState', undefined);
    const activityTracker = savedActivity ? ActivityTracker.restore(savedActivity) : new ActivityTracker();

    const savedGM = globalState.get<GMTrackerState | undefined>('gmTrackerState', undefined);
    const gmTracker = savedGM ? GMTracker.restore(savedGM) : new GMTracker();
    let lastGMSummary: GMSummary | null = globalState.get<GMSummary | null>('gmDetailedSummary', gmTracker.getCachedSummary());

    let persistedModelDNA: Record<string, PersistedModelDNA> = restoreModelDNAState(
        globalState.get<ModelDNAStoreState | null>('modelDNAState', null),
    );

    const pricingStore = new PricingStore();
    pricingStore.init(globalState);

    const initialAppSettings = durableState.getAppSettings();
    const dailyStore = new DailyStore(initialAppSettings.calendarRetentionDays);
    dailyStore.init(globalState, { maxDays: initialAppSettings.calendarRetentionDays });
    dailyStore.backfillMissingCosts(pricingStore.getCustom());

    const savedLedger = globalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
    let dailyLedger = DailyLedger.restore(savedLedger);
    dailyLedger.setSurface('app');
    let lastArchivalDateKey = globalState.get<string>('lastArchivalDateKey', '');

    const monitorStore = new MonitorStore();
    monitorStore.init(workspaceState);
    const restoredMonitor = monitorStore.restore();

    const savedRunway = globalState.get<SerializedQuotaRunwayState | null>('quotaRunwayState', null);
    const savedRunwayWeekly = globalState.get<Record<string, WeeklyQuotaSeriesState> | null>('quotaRunwayWeeklyBuckets', null);
    const combinedSavedRunway = combineSerializedRunwayWithWeekly(savedRunway, savedRunwayWeekly);
    const quotaRunwayTracker = combinedSavedRunway ? QuotaRunwayTracker.deserialize(combinedSavedRunway) : new QuotaRunwayTracker();

    const promptCacheTtlTracker = new PromptCacheTtlTracker();
    const recoveryBriefTracker = new CompactionRecoveryBriefTracker();
    recoveryBriefTracker.restoreDismissedKeys(globalState.get<string[]>('dismissedRecoveryBriefKeys', []));
    const diagnosticAliasMap = new DiagnosticAliasMap();
    let lastRecordedCacheTtlCallKey = '';
    let lastGmCallActivityMs = 0;

    const userStatusGuard = new StaleCacheGuard<FullUserStatus>();
    const trajectoriesGuard = new StaleCacheGuard<TrajectorySummary[]>();

    // ── Multi-Account, Billing Days & Shared Settings State ──────────────────
    let accountSnapshots = new Map<string, AccountSnapshot>();
    let billingDaysMap: Record<string, number> = {};
    let currentAccountEmail = gmTracker.getCurrentAccount();
    let selectedAccountKey = '';
    const notifiedAccountResets = new Set<string>();

    let appSettings: AppSettingsWithV118 = {
        ...DEFAULT_APP_SETTINGS,
        ...initialAppSettings,
        displayCurrency: normalizeCurrencyCode(initialAppSettings.displayCurrency, 'USD'),
        subscriptionCurrency: normalizeCurrencyCode(initialAppSettings.subscriptionCurrency, 'USD'),
        customFxCurrency: initialAppSettings.customFxCurrency ?? null,
        subscriptionPlan: initialAppSettings.subscriptionPlan ?? 'none',
        languagePreference: initialAppSettings.languagePreference ?? 'auto',
        contextPctBasis: initialAppSettings.contextPctBasis ?? 'compaction',
        speedMetricMode: initialAppSettings.speedMetricMode ?? 'decode',
        quotaWindowMode: initialAppSettings.quotaWindowMode ?? '5h',
        quotaDirectionMode: initialAppSettings.quotaDirectionMode ?? 'remaining',
        appShowNativeHudBar: initialAppSettings.appShowNativeHudBar ?? true,
        ideShowNativeHudBar: initialAppSettings.ideShowNativeHudBar ?? false,
        nativeHudAutoHideOnOverview: initialAppSettings.nativeHudAutoHideOnOverview ?? true,
        cdpOverlayFontSize: normalizeCdpOverlayFontSize(globalState.get('cdpOverlayFontSize', 'normal')),
        cdpOverlayHighContrast: Boolean(globalState.get('cdpOverlayHighContrast', false)),
        appOnboardingDismissed: Boolean(initialAppSettings.appOnboardingDismissed),
        legacyLockMigrated: Boolean(initialAppSettings.legacyLockMigrated),
    };
    let subscriptionPlan: SubscriptionPlanPresetId = 'none';
    let settings: MonitorDocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS };
    let panelHintPrefs: PanelHintPreferences = {
        showTabScrollHint: true,
        showScrollbar: false,
        showEndOfContent: true,
    };
    let zoomLevel = 100;
    let calendarYear = new Date(deps.now()).getFullYear();
    let calendarMonth = new Date(deps.now()).getMonth() + 1;
    let calendarSourceFilter: CalendarSourceFilter = 'all';
    let calendarMetricMode: CalendarMetricMode = 'tokens';
    let calendarPeriodMode: CalendarPeriodMode = 'daily';
    let calendarViewMode: CalendarViewMode | undefined = undefined;
    let calendarSelectedDate = '';

    // ── Authoritative Swarm Registry & Fair-Budget Poll Scheduler (D9 §3.3) ──
    const resolvedHomeDir = deps.homedir();
    const hasExplicitBrainScope = Boolean(
        options.brainDir
        || options.dataDir
        || (options.deps?.homedir && path.resolve(resolvedHomeDir) !== path.resolve(os.homedir())),
    );
    const suppressHostBrainScanInTests = Boolean(process.env.VITEST) && !hasExplicitBrainScope;
    const swarmMemberInventory = new SwarmMemberInventory();
    const swarmRegistry = new SwarmTopologyRegistry({
        scope: {
            brainDir: options.brainDir,
            dataDir: options.dataDir,
            homeDir: resolvedHomeDir,
            isRemoteHost: options.isRemoteHost || suppressHostBrainScanInTests,
            remoteAuthority: options.remoteAuthority,
        },
        budgets: options.swarmScanBudgets,
        now: deps.now,
    });
    const swarmPollScheduler = new SwarmPollScheduler({
        budget: options.swarmPollBudget,
        now: deps.now,
    });
    let lastSwarmTopology: SwarmTopologySnapshot = swarmRegistry.getSnapshot();
    let lastSwarmGroupCost: SwarmGroupCostSummary | null = null;
    let lastSwarmPollTick: SwarmPollTickResult | null = null;

    // ── D9 Unified Immutable Observation & Per-Window Lock State Machine ─────
    let latestObservation: PublishedMonitorObservation | null = null;
    const observationsByWindow = new Map<string, { signature: string; value: PublishedMonitorObservation }>();
    const windowSelectionStates = new Map<string, WindowSelectionState>();
    let activeWindowId = 'default';
    const missingPollCountByCascade = new Map<string, number>();

    // ── CLI Scanner Cache (Lazy, Non-Blocking Async, 60s TTL) ────────────────
    const CLI_SCAN_TTL_MS = 60_000;
    const QUOTA_RUNWAY_PERSIST_INTERVAL_MS = 30_000;
    let cachedCliDays: CliDailyUsageRecord[] = [];
    let lastCliScanAtMs = 0;
    let cliScanInFlight: Promise<CliDailyUsageRecord[]> | null = null;
    let lastRunwayPersistMs = 0;
    let runwayStateDirty = false;

    // ── Update Checker & Self-Updater State ──────────────────────────────────
    let lastUpdateStatusView: UpdateStatusView | null = null;
    let lastCachedReleaseInfo: PluginReleaseInfo | null = null;
    let autoUpdateCheckInFlight = false;

    // ── Opt-In CDP Ambient Overlays & Authenticated Bridge State ─────────────
    const overlayBridgeToken = (options.overlayBridgeToken && options.overlayBridgeToken.length >= 32)
        ? options.overlayBridgeToken
        : generateSessionToken();
    let lastSyncedOverlayToggles = {
        appComposerRingEnabled: false,
        appTopBarEnabled: false,
    };
    let overlayAllowedOrigin: string | undefined;
    let overlayTabSeq = 0;
    let overlayTargetTab: { seq: number; tab: CdpOverlayTargetTab } | null = null;

    const excludedCdpPorts: number[] = [];
    const addExcludedCdpPort = (raw: unknown): void => {
        const parsed = typeof raw === 'number'
            ? raw
            : (typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : NaN);
        if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65535 && !excludedCdpPorts.includes(parsed)) {
            excludedCdpPorts.push(parsed);
        }
    };
    addExcludedCdpPort(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT);
    addExcludedCdpPort(process.env.ANTIGRAVITY_SIDECAR_PORT);
    if (Array.isArray(options.excludeTargetPorts)) {
        for (const p of options.excludeTargetPorts) { addExcludedCdpPort(p); }
    }

    const overlayManager = deps.createCdpOverlayManager({
        excludeTargetPorts: excludedCdpPorts,
        inspectLauncher: () => deps.inspectCdpLauncher(),
        createBridge: (bridgeOpts) => deps.createOverlayBridge({
            ...bridgeOpts,
            token: overlayBridgeToken,
        }),
        payloadForTarget: (targetId) => {
            const winId = `cdp:${targetId}`;
            const target = windowSelectionStates.get(winId);
            if (!target?.observedHostFocus) { return buildCdpOverlayPayload(deps.now(), winId, true); }
            const sdk = [...windowSelectionStates.values()].filter(w => w.observedHostFocus?.authority === 'host_sdk'
                && w.observedHostFocus.cascadeId && w.observedHostFocus.cascadeId === target.observedHostFocus?.cascadeId);
            const scopedId = sdk.length === 1 ? sdk[0].windowId : winId;
            const scopedMasked = sdk.length === 1 ? isPrivacyMaskedForWindow(scopedId) : true;
            return buildCdpOverlayPayload(deps.now(), scopedId, scopedMasked);
        },
        onBridgeAction: async (bridgeAction) => {
            const response = await handleOverlayAction(bridgeAction);
            if (!response.ok) { throw new Error(response.error || 'Overlay command failed'); }
            if (bridgeAction.command === 'focusConversation') {
                const ack = response.result as { accepted: boolean; ackFocusRevision: number };
                return { accepted: ack.accepted, ackFocusRevision: ack.ackFocusRevision };
            }
        },
        log,
        now: deps.now,
    });

    // ── Live Telemetry State ─────────────────────────────────────────────────
    let cachedLsInfo: LSInfo | null = null;
    let currentUsage: ContextUsage | null = restoredMonitor.currentUsage;
    let allTrajectoryUsages: ContextUsage[] = restoredMonitor.allUsages;
    let allTrajectories: TrajectorySummary[] = [];
    let cachedModelConfigs: ModelConfig[] = [];
    let cachedUserInfo: UserStatusInfo | null = null;
    let cachedOrchestratorSettings: OrchestratorSettings | null = null;
    let cachedQuotaSummary: UserQuotaSummary | null = null;
    let monitorStatus: MonitorStatus = { state: 'connecting' };

    let contextBreakdown: ContextBreakdownSnapshot | null = null;
    let contextBreakdownCascadeId: string | null = null;
    let turnDiagnostics: TurnDiagnosticsSummary | null = null;
    let turnDiagnosticsCascadeId: string | null = null;
    let quotaRunways: Record<string, QuotaRunwayEstimate> = {};
    let weeklyQuotaRunways: Record<string, WeeklyQuotaRunwayEstimate> = {};
    let latestPromptCacheTtl: PromptCacheTtlEvaluation | null = null;
    let latestSpeedMetric: WeightedSpeedMetricSummary | null = null;
    let activeRecoveryBrief: CompactionRecoveryBrief | null = null;
    let isCustomModelActive = false;

    let hostConversationId: string | null = (process.env.ANTIGRAVITY_CONVERSATION_ID || '').trim() || null;
    let hostConversationSource: 'env' | 'aux' | 'cdp' | 'query' | null = hostConversationId ? 'env' : null;
    let hostConversationUpdatedAtMs: number = hostConversationId ? deps.now() : 0;
    let hostNewConversationPending = false;
    let hostNewConversationAtMs = 0;
    const pinsByWindow = new Map<string, string>();
    let pinnedConversationId: string | null = null;
    let lockToMainAgent = false;
    let lockedMainId: string | null = null;
    let trackedCascadeId: string | null = null;
    let trackedCascadeSinceMs = 0;
    let lastResolution: ResolvedConversationTarget = {
        target: null,
        cascadeId: null,
        mode: 'auto_follow',
        lockedMainId: null,
        pinnedFallback: false,
        ignoredSubagentBurst: false,
        hostPending: false,
        reason: 'initializing',
    };
    let conversationOptions: ConversationOption[] = [];

    // Rewind, cross-session isolation & per-conversation telemetry caches
    const branchStepPeaks = new Map<string, BranchStepPeakState>();
    const minGmTimestampByCascade = new Map<string, string | number>();
    const prevUsedTokensByCascade = new Map<string, number>();
    const knownSubagentIds = new Set<string>();
    const seenTrajectoryIds = new Set<string>();
    const deletedConversationIds = new Set<string>();
    let hasCompletedInitialTrajectoryScan = false;
    let latestNewlyCreatedIds = new Set<string>();
    let telemetryRefreshSeq = 0;
    let cachedRawTelemetryKey = '';
    let cachedRawGmEntries: RawGeneratorMetadataEntry[] = [];
    let cachedRawSteps: Array<Record<string, unknown>> = [];

    // Polling / lifecycle state
    let isPaused = false;
    let disposed = false;
    let isPolling = false;
    let activePollPromise: Promise<void> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollGeneration = 0;
    let pollCount = 0;
    let lastPollAtMs = 0;
    let lastDataSignature = '';
    let lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
    let lastClientActivityMs = deps.now();
    let scheduledPollDelayMs = 0;
    let stateRevision = 0;
    let dataRevision = 0;
    let selectionRevision = 0;
    let selectionGeneration = 0;
    let backendEpoch = 1;
    const focusReceiptByWindow = new Map<string, {
        source: string;
        revision: number;
        signature: string;
        retiredSources: Set<string>;
    }>();
    let activityChangeSeq = 0;
    const MAX_SNAPSHOT_CACHE_ENTRIES = 8;
    const snapshotCache = new Map<string, SidecarSnapshotPayload>();
    let consecutiveFailures = 0;
    let statusPollCount = 0;
    let lsRevalidationCounter = 0;
    let lastActivityPersistTime = 0;
    let hasSyncedCheckpointer = false;
    let checkpointerSyncAttempts = 0;
    let auxMetadataConsecutiveFailures = 0;
    let modelMetadataGeneration = 0;
    const abortController = new AbortController();

    function bumpStateRevision(): void {
        stateRevision++;
        snapshotCache.clear();
    }

    function markClientActivity(): void {
        lastClientActivityMs = deps.now();
        const baseMs = clamp(settings.pollingInterval, 1, 60) * 1000;
        if (pollTimer && scheduledPollDelayMs > baseMs && consecutiveFailures === 0) {
            scheduleNextPoll();
        }
    }

    // ── State Restoration Helpers ────────────────────────────────────────────

    function restoreAccountSnapshotsFromDisk(): void {
        const saved = globalState.get<AccountSnapshot[] | null>('accountSnapshots', null);
        if (!saved || !Array.isArray(saved)) { return; }
        const prevActive = currentAccountEmail;
        const nextMap = new Map<string, AccountSnapshot>();
        for (const snap of saved) {
            if (!snap || typeof snap.email !== 'string' || !snap.email) { continue; }
            const sanitizedCredits = Array.isArray(snap.credits)
                ? currentAICredits(snap.credits.map(c => ({
                    creditType: c.creditType,
                    creditAmount: c.creditAmount,
                    minimumCreditAmountForUsage: 0,
                }))).flatMap(c => c.creditAmount === null ? [] : [{ creditType: c.creditType, creditAmount: c.creditAmount }])
                : undefined;
            nextMap.set(snap.email, {
                ...snap,
                credits: sanitizedCredits && sanitizedCredits.length > 0 ? sanitizedCredits : undefined,
                isActive: prevActive ? snap.email === prevActive : false,
            });
        }
        accountSnapshots = nextMap;
    }

    function restoreBillingDaysFromDisk(): void {
        const saved = globalState.get<unknown>('accountBillingDays', null);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
            billingDaysMap = {};
            return;
        }
        const restored: Record<string, number> = {};
        for (const [rawEmail, day] of Object.entries(saved as Record<string, unknown>)) {
            const email = rawEmail.trim();
            if (email && typeof day === 'number' && isBillingDay(day)) {
                restored[email] = day;
            }
        }
        billingDaysMap = restored;
    }

    function inferSubscriptionPlan(
        rawPlan: unknown,
        monthlyFee: number | null,
    ): SubscriptionPlanPresetId {
        return normalizeSubscriptionPlanId(rawPlan, monthlyFee);
    }

    const updateCheckFailedMsg = () => tBi('Update check failed.', '更新检查失败。');
    const formatAccountSnaps = (masked: boolean): AccountSnapshot[] => [...accountSnapshots.values()].map(s => {
        const h = getAccountHandle(s.email);
        return masked ? { ...s, accountHandle: h, email: '****@redacted', name: getRedactedAccountLabel(s.email) } : { ...s, accountHandle: h };
    });

    function getFullAppSettings(masked = true): AppSettingsWithV118 {
        return {
            ...appSettings, subscriptionPlan,
            ...(masked && appSettings.lastUpdateCheck?.error ? {
                lastUpdateCheck: { ...appSettings.lastUpdateCheck, error: updateCheckFailedMsg() },
            } : {}),
        };
    }

    function buildCurrencyConfig(): CurrencyConfig {
        return {
            code: appSettings.displayCurrency,
            ...(appSettings.customFxRate !== null && appSettings.customFxRate > 0
                ? {
                    customRatePerUsd: appSettings.customFxRate,
                    ...(appSettings.customFxCurrency
                        ? { customFxCurrency: appSettings.customFxCurrency }
                        : {}),
                }
                : {}),
        };
    }

    function buildSubscriptionConfig(): SubscriptionConfig | null {
        if (subscriptionPlan === 'none') { return null; }
        const feeCurrency = appSettings.subscriptionCurrency as SubscriptionConfig['feeCurrency'];
        const fxBoundCurrency = appSettings.customFxCurrency ?? appSettings.displayCurrency;
        const canApplyCustomFx = appSettings.customFxRate !== null
            && appSettings.customFxRate > 0
            && feeCurrency !== 'USD'
            && fxBoundCurrency === feeCurrency;
        return {
            planId: subscriptionPlan,
            ...(appSettings.subscriptionMonthlyFee !== null && appSettings.subscriptionMonthlyFee > 0
                ? { monthlyFee: appSettings.subscriptionMonthlyFee }
                : {}),
            feeCurrency,
            ...(canApplyCustomFx
                ? { customRatePerUsd: appSettings.customFxRate! }
                : {}),
        };
    }

    function hydrateV118SettingsFromDisk(
        rawDisk: Record<string, unknown> | null,
        normalizedBase: AppSettings,
        persistedLegacyLock: boolean | undefined,
        persistedLegacyPlan: string,
    ): { hydrated: AppSettingsWithV118; migratedLegacyLock: boolean; plan: SubscriptionPlanPresetId } {
        const d = rawDisk && typeof rawDisk === 'object' && !Array.isArray(rawDisk) ? rawDisk : {};
        const alreadyMigrated = d.legacyLockMigrated === true;
        const hasModernLock = typeof d.lockToMainAgent === 'boolean';
        const resolvedLock = (alreadyMigrated || hasModernLock)
            ? (hasModernLock ? (d.lockToMainAgent as boolean) : normalizedBase.lockToMainAgent)
            : (typeof persistedLegacyLock === 'boolean' ? persistedLegacyLock : normalizedBase.lockToMainAgent);
        const migratedLegacyLock = (alreadyMigrated || hasModernLock)
            ? (!alreadyMigrated && hasModernLock)
            : typeof persistedLegacyLock === 'boolean';

        const displayCurrency: DisplayCurrencyCode = normalizeCurrencyCode(isCurrencyCode(d.displayCurrency) ? d.displayCurrency : normalizedBase.displayCurrency, 'USD');
        const subscriptionCurrency: DisplayCurrencyCode = normalizeCurrencyCode(isCurrencyCode(d.subscriptionCurrency) ? d.subscriptionCurrency : normalizedBase.subscriptionCurrency, 'USD');
        const fxVal = validateCustomFxRate(d.customFxRate !== undefined ? d.customFxRate : normalizedBase.customFxRate);
        let customFxRate = fxVal.ok ? fxVal.value : normalizedBase.customFxRate;
        let customFxCurrency: DisplayCurrencyCode | null = isCurrencyCode(d.customFxCurrency) ? normalizeCurrencyCode(d.customFxCurrency, 'USD') : null;
        if (displayCurrency === 'USD' || customFxRate === null || (customFxCurrency !== null && customFxCurrency !== displayCurrency)) {
            if (displayCurrency === 'USD' || (customFxCurrency !== null && customFxCurrency !== displayCurrency)) { customFxRate = null; }
            customFxCurrency = null;
        } else if (customFxCurrency === null && d.customFxCurrency === undefined) {
            customFxCurrency = displayCurrency;
        }

        const resolvedOrchMode: OrchestratorPricingMode = (d.orchestratorPricingMode === 'mapped' || d.orchestratorPricingMode === 'strict')
            ? d.orchestratorPricingMode
            : pricingStore.getOrchestratorPricingMode();
        const plan = inferSubscriptionPlan(d.subscriptionPlan !== undefined ? d.subscriptionPlan : persistedLegacyPlan, normalizedBase.subscriptionMonthlyFee);
        const hydrated: AppSettingsWithV118 = {
            ...normalizedBase,
            lockToMainAgent: resolvedLock,
            orchestratorPricingMode: resolvedOrchMode,
            displayCurrency,
            customFxRate,
            customFxCurrency,
            subscriptionPlan: plan,
            subscriptionCurrency,
            languagePreference: isLanguagePreference(d.languagePreference) ? d.languagePreference : normalizedBase.languagePreference,
            contextPctBasis: d.contextPctBasis === 'native' ? 'native' : 'compaction',
            speedMetricMode: d.speedMetricMode === 'e2e' ? 'e2e' : 'decode',
            quotaWindowMode: d.quotaWindowMode === '7d' || d.quotaWindowMode === 'tightest' || d.quotaWindowMode === '5h' ? d.quotaWindowMode : normalizedBase.quotaWindowMode,
            quotaDirectionMode: d.quotaDirectionMode === 'used' ? 'used' : 'remaining',
            appShowNativeHudBar: typeof d.appShowNativeHudBar === 'boolean' ? d.appShowNativeHudBar : (typeof d.showNativeHudBar === 'boolean' ? d.showNativeHudBar : DEFAULT_APP_SETTINGS.appShowNativeHudBar),
            ideShowNativeHudBar: typeof d.ideShowNativeHudBar === 'boolean' ? d.ideShowNativeHudBar : DEFAULT_APP_SETTINGS.ideShowNativeHudBar,
            nativeHudAutoHideOnOverview: typeof d.nativeHudAutoHideOnOverview === 'boolean' ? d.nativeHudAutoHideOnOverview : DEFAULT_APP_SETTINGS.nativeHudAutoHideOnOverview,
            cdpOverlayFontSize: normalizeCdpOverlayFontSize(d.cdpOverlayFontSize ?? globalState.get<unknown>('cdpOverlayFontSize', 'normal')),
            cdpOverlayHighContrast: typeof d.cdpOverlayHighContrast === 'boolean' ? d.cdpOverlayHighContrast : Boolean(globalState.get<boolean>('cdpOverlayHighContrast', false)),
            appOnboardingDismissed: typeof d.appOnboardingDismissed === 'boolean' ? d.appOnboardingDismissed : Boolean(normalizedBase.appOnboardingDismissed),
            legacyLockMigrated: alreadyMigrated || migratedLegacyLock,
        };
        return { hydrated, migratedLegacyLock, plan };
    }

    function syncOverlayTogglesIfChanged(): Promise<CdpStatus> | null {
        const nextComposer = Boolean(appSettings.appComposerRingEnabled);
        const nextTopBar = Boolean(appSettings.appTopBarEnabled);
        if (nextComposer === lastSyncedOverlayToggles.appComposerRingEnabled
            && nextTopBar === lastSyncedOverlayToggles.appTopBarEnabled) {
            return null;
        }
        lastSyncedOverlayToggles = {
            appComposerRingEnabled: nextComposer,
            appTopBarEnabled: nextTopBar,
        };
        return overlayManager.setToggles({
            appComposerRingEnabled: nextComposer,
            appTopBarEnabled: nextTopBar,
        }).then((status) => {
            if (status.targetUrl) {
                try { overlayAllowedOrigin = new URL(status.targetUrl).origin; } catch { /* ignore */ }
            } else if (status.state === 'disabled') {
                overlayAllowedOrigin = undefined;
            }
            bumpStateRevision();
            return status;
        });
    }

    function restoreSharedSettingsFromDisk(): void {
        const rawDisk = globalState.get<Record<string, unknown> | null>('appSettings', null);
        const normalized = durableState.getAppSettings();
        const persistedLock = globalState.get<boolean | undefined>('lockToMainAgent', undefined);
        const persistedPlan = globalState.get<string>('subscriptionPlan', '');

        const { hydrated, migratedLegacyLock, plan } = hydrateV118SettingsFromDisk(
            rawDisk,
            normalized,
            persistedLock,
            persistedPlan,
        );

        if (pricingStore.getOrchestratorPricingMode() !== hydrated.orchestratorPricingMode) {
            pricingStore.setOrchestratorPricingModeSync(hydrated.orchestratorPricingMode);
        }

        appSettings = hydrated;
        subscriptionPlan = plan;

        // Single-time migration of legacy `lockToMainAgent` global key into `appSettings`
        if (migratedLegacyLock && !disposed) {
            const diskObj = rawDisk && typeof rawDisk === 'object' && !Array.isArray(rawDisk) ? { ...rawDisk } : {};
            diskObj.lockToMainAgent = hydrated.lockToMainAgent;
            diskObj.legacyLockMigrated = true;
            void durableState.updateGlobalWithReceipt('appSettings', diskObj);
        }

        if (!lastUpdateStatusView && appSettings.lastUpdateCheck) {
            lastUpdateStatusView = toUpdateStatusView(appSettings.lastUpdateCheck);
        }

        lockToMainAgent = appSettings.lockToMainAgent;
        syncSettingsMirrorFromAppSettings();

        // Sync lock flag into default window selection state without losing an already anchored lockedRootId
        const defaultWin = windowSelectionStates.get(activeWindowId);
        if (defaultWin && defaultWin.lockToMainAgent !== lockToMainAgent) {
            windowSelectionStates.set(activeWindowId, {
                ...defaultWin,
                lockToMainAgent,
                ...(lockToMainAgent ? {} : { lockedRootId: null, lockPendingUnavailable: false, retargetOfferId: null }),
            });
        }

        setShowModelShortId(settings.showModelInternalId);
        dailyStore.setMaxDays(appSettings.calendarRetentionDays);

        panelHintPrefs = {
            showTabScrollHint: globalState.get<boolean>('panelShowTabScrollHint', true),
            showScrollbar: globalState.get<boolean>('panelShowScrollbar', false),
            showEndOfContent: globalState.get<boolean>('panelShowEndOfContent', true),
        };
        zoomLevel = clamp(Math.round(Number(globalState.get<number>('panelZoomLevel', 100)) || 100), 50, 200);
        void syncOverlayTogglesIfChanged();
    }

    function mergeDiskRunwayIntoTracker(): void {
        const diskRunway = globalState.get<SerializedQuotaRunwayState | null>('quotaRunwayState', null);
        const diskWeekly = globalState.get<Record<string, WeeklyQuotaSeriesState> | null>('quotaRunwayWeeklyBuckets', null);
        const combined = combineSerializedRunwayWithWeekly(diskRunway, diskWeekly);
        if (combined) {
            quotaRunwayTracker.mergeFrom(combined as unknown as SerializedQuotaRunwayState);
        }
    }

    function syncFromDurableStateIfChanged(): boolean {
        const changed = durableState.reloadIfChanged();
        if (!changed) { return false; }
        initI18nFromState(globalState, appLocaleSources);
        pricingStore.init(globalState);
        const reloadedAppSettings = durableState.getAppSettings();
        dailyStore.init(globalState, { maxDays: reloadedAppSettings.calendarRetentionDays });
        restoreAccountSnapshotsFromDisk();
        restoreBillingDaysFromDisk();
        restoreSharedSettingsFromDisk();
        recoveryBriefTracker.restoreDismissedKeys(globalState.get<string[]>('dismissedRecoveryBriefKeys', []));
        mergeDiskRunwayIntoTracker();
        const diskLedger = globalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
        if (diskLedger && diskLedger.dateKey === dailyLedger.dateKey) {
            const restored = DailyLedger.restore(diskLedger);
            restored.setSurface('app');
            if (restored.getTodayActive().length >= dailyLedger.getTodayActive().length
                && restored.getSettledEntries().length >= dailyLedger.getSettledEntries().length) {
                dailyLedger = restored;
            }
        } else if (diskLedger && diskLedger.dateKey && diskLedger.dateKey > dailyLedger.dateKey) {
            dailyLedger = DailyLedger.restore(diskLedger);
            dailyLedger.setSurface('app');
        }
        bumpStateRevision();
        return true;
    }

    // Initial seed restore
    restoreAccountSnapshotsFromDisk();
    restoreBillingDaysFromDisk();
    restoreSharedSettingsFromDisk();

    const savedConfigs = globalState.get<ModelConfig[]>('cachedModelConfigs', []);
    if (Array.isArray(savedConfigs) && savedConfigs.length > 0) {
        updateModelDisplayNames(savedConfigs);
        cachedModelConfigs = savedConfigs;
    }

    quotaTracker.onQuotaReset = (modelIds: string[], cutoffTime?: string) => {
        const expandedIds = expandModelIdsToPool(modelIds, cachedModelConfigs);
        const cutoffMs = cutoffTime ? Date.parse(cutoffTime) : NaN;
        gmTracker.baselineForQuotaReset(undefined, expandedIds, cutoffTime);
        persistQuotaSettlement(Boolean(dailyLedger.settleForQuotaReset(expandedIds, currentAccountEmail, Number.isNaN(cutoffMs) ? undefined : cutoffMs)));
    };

    function buildDailyArchivalContext(withAsyncPreFlush: boolean): DailyArchivalContext {
        return {
            activityTracker,
            gmTracker,
            dailyStore,
            pricingStore,
            lastGMSummary,
            persistedModelDNA,
            lastArchivalDateKey,
            dailyLedger,
            surface: 'app',
            ...(withAsyncPreFlush
                ? {
                    preArchivalFlush: async () => {
                        if (disposed || !cachedLsInfo || allTrajectories.length === 0) { return; }
                        const preEpoch = backendEpoch;
                        try {
                            const gmSummary = deps.fetchGM
                                ? await deps.fetchGM(cachedLsInfo, allTrajectories, currentUsage?.cascadeId, abortController.signal)
                                : await gmTracker.fetchAll(
                                    cachedLsInfo,
                                    allTrajectories.map(tr => ({
                                        cascadeId: tr.cascadeId,
                                        title: tr.summary || tr.cascadeId.slice(0, 8),
                                        stepCount: tr.stepCount,
                                        status: tr.status,
                                    })),
                                    currentUsage?.cascadeId,
                                    abortController.signal,
                                );
                            if (disposed || backendEpoch !== preEpoch) { return; }
                            if (gmSummary) {
                                lastGMSummary = deps.fetchGM ? gmSummary : (gmTracker.getDetailedSummary() || gmSummary);
                            }
                            const { entries: preEntries, revertedCascadeIds } = gmTracker.getNewCallsSinceLastRecord();
                            for (const cid of revertedCascadeIds) {
                                dailyLedger.clearRecordedIdsForConversation(cid);
                            }
                            if (preEntries.length > 0) {
                                const enrichedPre = enrichLedgerEntriesForIngestion(preEntries, {
                                    trajectories: allTrajectories,
                                    activeCascadeId: lastResolution.cascadeId ?? currentUsage?.cascadeId,
                                    activeWorkspaceUri: activeWorkspaceUris[0],
                                    fallbackAuthority: options.remoteAuthority || 'local',
                                    fallbackAccount: cachedUserInfo?.email || currentAccountEmail,
                                });
                                const detailed = dailyLedger.recordCallsDetailed(enrichedPre, 'app');
                                gmTracker.markLedgerEntriesRecorded(preEntries, detailed.statuses);
                                if (detailed.added > 0) { lastGmCallActivityMs = deps.now(); }
                            }
                        } catch {
                            // Non-critical pre-archival flush failure
                        }
                    },
                    confirmPersist: async () => (await durableState.flush()).committed,
                }
                : {}),
            persist: async (updates) => {
                const isActualRollover = Boolean(lastArchivalDateKey && updates.lastArchivalDateKey !== lastArchivalDateKey);
                lastArchivalDateKey = updates.lastArchivalDateKey;
                lastGMSummary = updates.lastGMSummary;
                if (updates.modelDNAChanged && updates.persistedModelDNA) {
                    persistedModelDNA = updates.persistedModelDNA;
                    void globalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
                }
                void globalState.update('lastArchivalDateKey', lastArchivalDateKey);
                void globalState.update('activityTrackerState', activityTracker.serialize());
                void globalState.update('gmTrackerState', gmTracker.serialize());
                void globalState.update('dailyLedgerState', dailyLedger.serialize());
                void globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
                bumpStateRevision();
                if (withAsyncPreFlush && isActualRollover) {
                    await durableState.flush();
                }
            },
            log,
        };
    }

    function performDailyArchival(force = false): void {
        performDailyArchivalCore(buildDailyArchivalContext(false), force, new Date(deps.now()));
    }

    async function performDailyArchivalAsync(force = false): Promise<void> {
        await performDailyArchivalAsyncCore(buildDailyArchivalContext(true), force, new Date(deps.now()));
    }

    // ── CLI Scanner, Update Checker & CDP Overlay Helpers ────────────────────

    async function refreshCliUsageCacheAsync(force = false): Promise<CliDailyUsageRecord[]> {
        if (options.disableCliScan || disposed) { return []; }
        const nowMs = deps.now();
        if (!force && lastCliScanAtMs > 0 && nowMs - lastCliScanAtMs < CLI_SCAN_TTL_MS) {
            return cachedCliDays;
        }
        if (cliScanInFlight) {
            return cliScanInFlight;
        }
        const scanOpts = {
            cliRootDir: options.cliDataDir,
            customPricing: pricingStore.getCustom(),
            now: nowMs,
        };
        const exec = (async (): Promise<CliDailyUsageRecord[]> => {
            try {
                const scanner = deps.cliUsageScanner as CliUsageScanner & {
                    scanAsync?: CliUsageScanner['scanAsync'];
                };
                const res = typeof scanner.scanAsync === 'function'
                    ? await scanner.scanAsync(scanOpts)
                    : await Promise.resolve().then(() => scanner.scan(scanOpts));
                if (!disposed) {
                    const prevSig = JSON.stringify(cachedCliDays.map(d => `${d.date}:${d.calls}:${d.totalTokens}`));
                    const nextDays = res.days;
                    const nextSig = JSON.stringify(nextDays.map(d => `${d.date}:${d.calls}:${d.totalTokens}`));
                    cachedCliDays = nextDays;
                    lastCliScanAtMs = deps.now();
                    if (prevSig !== nextSig) {
                        bumpStateRevision();
                    }
                }
            } catch {
                if (!disposed) {
                    lastCliScanAtMs = deps.now();
                }
            }
            return cachedCliDays;
        })();
        cliScanInFlight = exec;
        try {
            return await exec;
        } finally {
            if (cliScanInFlight === exec) {
                cliScanInFlight = null;
            }
        }
    }

    function getCachedCliDays(force = false): CliDailyUsageRecord[] {
        if (options.disableCliScan) { return []; }
        const nowMs = deps.now();
        if (force || lastCliScanAtMs === 0 || nowMs - lastCliScanAtMs >= CLI_SCAN_TTL_MS) {
            // Non-blocking background refresh on render/read paths (awaited explicitly in poll & export paths)
            void refreshCliUsageCacheAsync(force).catch(() => {});
        }
        return cachedCliDays;
    }

    function buildCalendarRenderOptions(nowMs = deps.now()): CalendarRenderOptions {
        const customPricing = pricingStore.getCustom();
        const todayLedgerActive = dailyLedger.getTodayActive();
        const ledgerSettled = dailyLedger.getSettledEntries();
        const cliDays = getCachedCliDays(false);
        return {
            liveLedger: {
                ledger: dailyLedger,
                active: todayLedgerActive,
                settled: ledgerSettled,
                customPricing,
                defaultSurface: 'app',
            },
            cliDays,
            sourceFilter: calendarSourceFilter,
            metricMode: calendarMetricMode,
            periodMode: calendarPeriodMode,
            ...(calendarViewMode ? { viewMode: calendarViewMode } : {}),
            ...(calendarSelectedDate ? { selectedDate: calendarSelectedDate } : {}),
            currency: buildCurrencyConfig() as unknown as CalendarRenderOptions['currency'],
            subscription: buildSubscriptionConfig(),
            customPricing,
            now: nowMs,
        };
    }

    function computeRecordedHistoryTelemetry(nowMs = deps.now()): {
        cumulativeTokens: number;
        cumulativeCostUsd: number;
        todayTokens: number;
        todayCostUsd: number;
        recordedDaysCount: number;
        earliestDateKey: string | null;
        todayKey: string;
    } {
        const todayKey = toLocalDateKey(new Date(nowMs));
        let cumulativeTokens = 0;
        let cumulativeCostUsd = 0;
        let todayTokens = 0;
        let todayCostUsd = 0;
        const recordedDayKeys = new Set<string>();
        const merged = mergeArchivedAndLiveRecords({
            store: dailyStore,
            liveLedger: dailyLedger,
            customPricing: pricingStore.getCustom(),
            defaultSurface: 'app',
            now: nowMs,
        });
        for (const [dateKey, rec] of merged.entries()) {
            let dayTokens = 0;
            let dayCost = 0;
            let dayCalls = 0;
            for (const cycle of rec.cycles || []) {
                dayTokens += computeCycleTokenTotals(cycle).totalTokens;
                if (typeof cycle.estimatedCost === 'number' && Number.isFinite(cycle.estimatedCost) && cycle.estimatedCost > 0) {
                    dayCost += cycle.estimatedCost;
                }
                dayCalls += cycle.gmTotalCalls || 0;
            }
            cumulativeTokens += dayTokens;
            cumulativeCostUsd += dayCost;
            if (dayTokens > 0 || dayCost > 0 || dayCalls > 0) {
                recordedDayKeys.add(dateKey);
            }
            if (dateKey === todayKey) {
                todayTokens += dayTokens;
                todayCostUsd += dayCost;
            }
        }
        // Add CLI scanned daily tokens & costs
        for (const cliDay of getCachedCliDays(false)) {
            const cliTok = cliDay.totalTokens > 0 ? cliDay.totalTokens : computeAdditiveTokens(cliDay);
            const cliCost = typeof cliDay.estimatedCost === 'number' && Number.isFinite(cliDay.estimatedCost) && cliDay.estimatedCost > 0
                ? cliDay.estimatedCost
                : 0;
            cumulativeTokens += cliTok;
            cumulativeCostUsd += cliCost;
            if (cliDay.date && (cliTok > 0 || cliCost > 0 || cliDay.calls > 0)) {
                recordedDayKeys.add(cliDay.date);
            }
            if (cliDay.date === todayKey) {
                todayTokens += cliTok;
                todayCostUsd += cliCost;
            }
        }
        let earliestDateKey: string | null = null;
        for (const k of recordedDayKeys) {
            if (earliestDateKey === null || k < earliestDateKey) {
                earliestDateKey = k;
            }
        }
        return {
            cumulativeTokens,
            cumulativeCostUsd,
            todayTokens,
            todayCostUsd,
            recordedDaysCount: recordedDayKeys.size,
            earliestDateKey,
            todayKey,
        };
    }

    function getActiveUiGmSummary(): GMSummary | null {
        return deps.fetchGM ? lastGMSummary : (gmTracker.getUiSummary() || lastGMSummary);
    }

    function evaluateActivePromptCacheTtl(
        nowMs: number,
        activeId: string | null,
        activeConvCalls: readonly GMCallEntry[],
        measuredModel: string | null,
        branchName: string,
        checkpointIndex: number | null,
    ): PromptCacheTtlEvaluation | null {
        if (!activeId) { return (latestPromptCacheTtl = null); }
        const key = {
            account: selectedAccountKey || cachedUserInfo?.email || currentAccountEmail || 'default',
            backend: cachedLsInfo ? getLsAuthority(cachedLsInfo) : 'default',
            conversation: activeId,
            model: measuredModel || 'unknown',
            branch: branchName || 'main',
        };
        const last = activeConvCalls[activeConvCalls.length - 1];
        const explicitCacheAvail = last ? (last as { cacheTelemetryAvailable?: boolean }).cacheTelemetryAvailable : undefined;
        const cacheTelemetryAvailable = last
            ? (explicitCacheAvail === false
                ? false
                : (explicitCacheAvail === true
                    || typeof last.cacheReadTokens === 'number'
                    || typeof last.cacheCreationTokens === 'number'))
            : false;
        const measured = last ? {
            inputTokens: last.inputTokens,
            cacheReadTokens: last.cacheReadTokens,
            cacheCreationTokens: last.cacheCreationTokens,
            cacheTelemetryAvailable,
        } : null;
        if (last) {
            const callKey = `${activeId}|${last.executionId || ''}|${last.createdAt || ''}|${activeConvCalls.length}`;
            if (callKey !== lastRecordedCacheTtlCallKey) {
                lastRecordedCacheTtlCallKey = callKey;
                const callMs = last.createdAt ? Date.parse(last.createdAt) : NaN;
                promptCacheTtlTracker.recordEvent({
                    key,
                    eventMs: Number.isFinite(callMs) && callMs > 0 ? callMs : nowMs,
                    measured,
                    checkpointIndex,
                    modelConfirmed: Boolean(measuredModel),
                    branchConfirmed: Boolean(branchName),
                });
            }
        }
        return (latestPromptCacheTtl = promptCacheTtlTracker.evaluate({
            key, nowMs, measured, transition: { currentCheckpointIndex: checkpointIndex },
        }));
    }

    function buildCdpSwarmSummary(obs: PublishedMonitorObservation, masked = isPrivacyMaskedForWindow(obs.windowId)): CdpOverlaySwarmSummary | null {
        const rootId = obs.rootCascadeId;
        const group = rootId ? lastSwarmTopology.groupsByRootId.get(rootId) : undefined;
        if (!rootId || !group || group.memberIds.length <= 1) { return null; }
        const curWin = getOrCreateWindowSelectionState(obs.windowId);
        const rootTitle = masked ? 'Swarm Session' : (allTrajectories.find(t => t.cascadeId === rootId)?.summary || rootId.slice(0, 8));
        return {
            rootTitle,
            activeCount: group.activeMemberIds.length,
            totalCount: group.memberIds.length,
            members: group.memberIds.slice(0, 8).map((cid, idx) => {
                const node = lastSwarmTopology.nodesById.get(cid);
                const tr = allTrajectories.find(t => t.cascadeId === cid);
                const u = allTrajectoryUsages.find(x => x.cascadeId === cid);
                return {
                    name: masked ? (cid === rootId ? 'Root' : `Member #${idx + 1}`) : (node?.memberName || tr?.summary || cid.slice(0, 8)),
                    pct: obs.subjectCascadeId === cid ? obs.primaryPct : (node?.contextPct ?? (u && u.contextLimit > 0 ? Math.round((u.contextUsed / u.contextLimit) * 1000) / 10 : null)),
                    phase: node?.killed || tr?.killed ? 'killed' : (tr?.status === CascadeStatus.RUNNING ? 'running' : 'idle'),
                    isInspected: curWin.inspectedMemberId === cid,
                };
            }),
        };
    }

    function publishCurrentObservation(
        nowMs = deps.now(), windowId = activeWindowId, resolution = lastResolution, usage = currentUsage,
    ): PublishedMonitorObservation {
        const winState = getOrCreateWindowSelectionState(windowId), uiGm = getActiveUiGmSummary();
        const customPricing = pricingStore.getCustom(), orchMode = appSettings.orchestratorPricingMode;
        const active = windowId === activeWindowId;
        const newChat = active ? hostNewConversationPending : winState.observedHostFocus?.isNewConversation === true;
        const isPendingNew = Boolean(resolution.hostPending || (newChat && !winState.lockedRootId && !winState.inspectedMemberId));
        const subjectCascadeId = resolution.cascadeId ?? null;
        const rootCascadeId = resolution.rootCascadeId ?? winState.lockedRootId ?? (subjectCascadeId ? (swarmRegistry.resolveRootId(subjectCascadeId) || subjectCascadeId) : null);
        const node = subjectCascadeId ? swarmRegistry.getNode(subjectCascadeId) : undefined;
        const subjectKind: ObservationSubjectKind = node && subjectCascadeId && swarmRegistry.isKnownWorkerOrSubagent(subjectCascadeId)
            ? (node.relationshipKind === 'swarm_member' ? 'worker' : 'subagent')
            : resolution.subjectKind ?? 'main';
        const matchedUsage = !isPendingNew && usage && subjectCascadeId && usage.cascadeId === subjectCascadeId ? usage : null;
        const matchedBd = !isPendingNew && contextBreakdown && subjectCascadeId && contextBreakdownCascadeId === subjectCascadeId ? contextBreakdown : null;
        const subjTraj = subjectCascadeId ? (allTrajectories.find(tr => tr.cascadeId === subjectCascadeId) ?? null) : null;
        const measuredModel = matchedUsage?.model || matchedBd?.model || subjTraj?.requestedModel || subjTraj?.generatorModel || null;
        const resMid = measuredModel ? (resolveModelId(measuredModel) || measuredModel) : '';
        const liveSpec = resMid ? getModelSpecs().find(s => s.placeholderId === resMid) : undefined;
        const guessSpec = measuredModel ? guessContextLimitSpec(measuredModel) : undefined;
        const explicitNativeOnly = Boolean((liveSpec && (liveSpec.isImageGeneration || liveSpec.cpLimit === 0)) || guessSpec?.cpLimit === 0);
        const rtEff = !explicitNativeOnly ? (matchedBd?.effectiveBudgetTokens ? matchedBd.effectiveBudgetTokens : (matchedUsage?.contextLimit && matchedUsage.contextLimit > 0 ? matchedUsage.contextLimit : null)) : null;
        const lim = resolveModelLimitsWithProvenance({
            liveCheckpointerLimit: rtEff, liveCheckpointerThreshold: liveSpec?.cpThreshold ?? null,
            staticCompactionLimit: !explicitNativeOnly ? (liveSpec?.cpLimit ?? guessSpec?.cpLimit ?? null) : 0,
            staticCompactionThreshold: guessSpec?.cpThreshold ?? null,
            liveNativeLimit: (matchedBd?.nativeLimitTokens ? matchedBd.nativeLimitTokens : null) ?? liveSpec?.maxTokens ?? null,
            staticNativeLimit: liveSpec?.maxTokens ?? guessSpec?.maxTokens ?? null, explicitNativeOnly,
        });
        const isZeroStepFresh = (isPendingNew && !subjectCascadeId && newChat)
            || Boolean(matchedUsage && !matchedUsage.hasGaps && matchedUsage.contextUsed === 0 && matchedUsage.stepCount === 0 && !matchedUsage.lastModelUsage && (!matchedBd || matchedBd.usedTokens === 0))
            || Boolean(!matchedUsage && subjTraj && subjTraj.stepCount === 0 && (!matchedBd || matchedBd.usedTokens === 0));
        const hasSuffixRecoveredMeasurement = Boolean(
            isSuffixRecoveredResult(matchedUsage) && matchedUsage?.lastModelUsage && matchedUsage.contextUsed > 0,
        );
        let usedTokens: number | null, tokenSource: ContextTokenSource, isIncomplete = false;
        if (isZeroStepFresh) { usedTokens = 0; tokenSource = 'zero_step_fresh'; }
        else if (matchedUsage?.hasGaps && !hasSuffixRecoveredMeasurement) { usedTokens = null; tokenSource = 'unavailable'; isIncomplete = true; }
        else if (matchedBd && matchedBd.usedTokens > 0) { usedTokens = matchedBd.usedTokens; tokenSource = matchedBd.measurementState === 'measured' ? 'gm_usage' : 'breakdown_buckets'; }
        else if (matchedUsage && matchedUsage.contextUsed > 0) { usedTokens = matchedUsage.contextUsed; tokenSource = matchedUsage.isEstimated ? 'step_estimate' : 'tracker_usage'; }
        else { usedTokens = null; tokenSource = 'unavailable'; isIncomplete = true; }

        const requestedSpeedMode: SpeedDisplayMode = appSettings.speedMetricMode === 'e2e' ? 'e2e' : 'decode';
        let displaySpeedTps: number | null = null, speedSampleScope: SpeedSampleScope = 'none', speedCallId: string | null = null, sessionCostUsd: number | null = null;
        if (active) { latestSpeedMetric = null; }
        if (!isZeroStepFresh && !isIncomplete && subjectCascadeId) {
            const activeCalls = uiGm?.conversations.find(c => c.cascadeId === subjectCascadeId)?.calls ?? [];
            const ss = computeWeightedSpeedMetric(activeCalls, requestedSpeedMode, { isStreaming: subjTraj?.status === CascadeStatus.RUNNING });
            if (active) { latestSpeedMetric = ss; }
            const primary = extractOverviewTelemetry(uiGm, subjectCascadeId, customPricing, orchMode)?.primary ?? null;
            const latestCall = primary?.latestCall ?? null;
            const speedEval = primary?.latestSpeedSample ?? (latestCall ? evaluateSpeedSample(latestCall) : null);
            const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
            if (!speedEval?.isShortSample && !speedEval?.isWaitingTtft) {
                const latestVal = requestedSpeedMode === 'e2e' ? ss.latestTokPerSec : speedEval?.displaySpeed;
                const weightedVal = pos(ss.weightedTokPerSec) ? ss.weightedTokPerSec : (requestedSpeedMode === 'decode' ? primary?.weightedGenTokPerSec : null);
                if (pos(latestVal)) { displaySpeedTps = Math.round((latestVal as number) * 10) / 10; speedSampleScope = 'latest_call'; speedCallId = latestCall?.createdAt || null; }
                else if (pos(weightedVal)) { displaySpeedTps = Math.round((weightedVal as number) * 10) / 10; speedSampleScope = 'conversation_weighted'; }
            }
            const sc = computeLiveCostSnapshot(uiGm, subjectCascadeId, true).sessionCostUsd;
            sessionCostUsd = sc > 0 ? sc : null;
            const cps = matchedBd?.compactionCheckpoints;
            if (active) { evaluateActivePromptCacheTtl(nowMs, subjectCascadeId, activeCalls, measuredModel, matchedUsage?.branchName || subjTraj?.branchName || 'main', cps?.length ? cps[cps.length - 1].stepIndex : null); }
        } else if (active) { latestPromptCacheTtl = null; }

        const fields: Omit<BuildObservationInput, 'dataRevision' | 'observedAtMs'> = {
            backendEpoch, windowId, rootCascadeId, subjectCascadeId, subjectKind, selectionRevision: active ? selectionRevision : winState.selectionRevision,
            measuredModel, tokenSource, usedTokens, compactionLimit: lim.compactionLimit,
            compactionLimitProvenance: mapCatalogProvenance(lim.compactionLimitProvenance),
            nativeLimit: lim.nativeLimit, nativeLimitProvenance: mapCatalogProvenance(lim.nativeLimitProvenance),
            requestedBasis: appSettings.contextPctBasis === 'native' ? 'native' : 'compaction',
            speedMode: requestedSpeedMode, speedSampleScope, speedCallId, displaySpeedTps, isZeroStepFresh, isIncomplete, sessionCostUsd,
        };
        const signature = JSON.stringify(fields);
        const previous = observationsByWindow.get(windowId);
        if (previous?.signature === signature && previous.value.dataRevision === dataRevision) {
            if (active) { latestObservation = previous.value; }
            return previous.value;
        }
        if (previous && previous.signature !== signature && previous.value.dataRevision === dataRevision) { dataRevision++; }
        const value = buildPublishedMonitorObservation({ ...fields, dataRevision, observedAtMs: nowMs });
        observationsByWindow.set(windowId, { signature, value });
        if (active) { latestObservation = value; }
        return value;
    }

    function buildCdpOverlayPayload(nowMs = deps.now(), windowId = activeWindowId, privacyMaskedOverride?: boolean): CdpOverlayPayload {
        const lang = getLanguage(), customPricing = pricingStore.getCustom(), orchMode = appSettings.orchestratorPricingMode;
        const overlayMasked = typeof privacyMaskedOverride === 'boolean' ? privacyMaskedOverride : isPrivacyMaskedForWindow(windowId);
        const active = windowId === activeWindowId;
        const resolution = active ? lastResolution : resolveWindowState(getOrCreateWindowSelectionState(windowId)).resolution;
        const subjectId = resolution.cascadeId;
        const usage = subjectId && currentUsage?.cascadeId === subjectId ? currentUsage
            : subjectId ? monitorStore.getSnapshot(subjectId) ?? null : null;
        const uiGmSummary = getActiveUiGmSummary(), obs = publishCurrentObservation(nowMs, windowId, resolution, usage);
        const top = projectForCdpTopbar(obs), ring = projectForCdpComposerRing(obs);
        const activeId = obs.subjectCascadeId ?? undefined, fresh = obs.isZeroStepFresh;
        const matchedUsage = !fresh && usage && activeId && usage.cascadeId === activeId ? usage : null;
        const matchedTd = !fresh && turnDiagnostics && matchedUsage && turnDiagnosticsCascadeId === matchedUsage.cascadeId ? turnDiagnostics : null;
        const costs = computeLiveCostSnapshot(uiGmSummary, activeId), currencyCfg = buildCurrencyConfig();
        const estCostUsd = obs.sessionCostUsd;
        const estCostFormatted = estCostUsd !== null ? formatCurrencyAmount(estCostUsd, { code: 'USD' }) : '—';
        const localCostFormatted = estCostUsd !== null && currencyCfg.code !== 'USD' ? formatCurrencyAmount(estCostUsd, currencyCfg) : null;
        const contextUsedTokens = top.usedTokens ?? 0;
        const contextEffectiveLimit = obs.compactionLimit ?? top.denominatorTokens ?? 0;
        const contextNativeLimit = obs.nativeLimit ?? top.denominatorTokens ?? contextEffectiveLimit;
        const compactionThresholdPct = top.markers.find(m => m.id === 'compaction' || m.id === 'compaction_limit')?.positionPct ?? null;
        const tier200kMarkerPct = top.markers.find(m => m.id === 'tier_200k' || m.id === '200k' || m.tokens === 200_000)?.positionPct ?? null;
        const ready = !fresh && !obs.isIncomplete;
        const telemetry = ready ? extractOverviewTelemetry(uiGmSummary, activeId, customPricing, orchMode) : null;
        const primary = telemetry?.primary ?? null, latestCall = primary?.latestCall ?? null;
        const speedEval = primary?.latestSpeedSample ?? (latestCall ? evaluateSpeedSample(latestCall) : null);
        const activeConvCalls = ready && activeId ? (uiGmSummary?.conversations.find(c => c.cascadeId === activeId)?.calls ?? []) : [];
        let peakOutputSpeedTps: number | null = null;
        let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0;
        for (const c of activeConvCalls) {
            const ev = evaluateSpeedSample(c);
            if (!ev.isShortSample && !ev.isWaitingTtft && typeof ev.displaySpeed === 'number' && Number.isFinite(ev.displaySpeed) && ev.displaySpeed > 0 && (peakOutputSpeedTps === null || ev.displaySpeed > peakOutputSpeedTps)) {
                peakOutputSpeedTps = ev.displaySpeed;
            }
            inputTokens += c.inputTokens || 0; outputTokens += c.outputTokens || 0;
            cacheReadTokens += c.cacheReadTokens || 0; cacheCreationTokens += c.cacheCreationTokens || 0;
        }
        if (ready && activeConvCalls.length === 0 && matchedUsage?.lastModelUsage) {
            const u = matchedUsage.lastModelUsage;
            inputTokens = u.inputTokens || 0; outputTokens = u.outputTokens || 0;
            cacheReadTokens = u.cacheReadTokens || 0; cacheCreationTokens = u.cacheCreationTokens || 0;
        }
        const liveOutputSpeedTps = obs.displaySpeedTps;
        if (peakOutputSpeedTps === null && typeof liveOutputSpeedTps === 'number' && Number.isFinite(liveOutputSpeedTps) && liveOutputSpeedTps > 0) { peakOutputSpeedTps = liveOutputSpeedTps; }
        if (peakOutputSpeedTps !== null) { peakOutputSpeedTps = Math.round(peakOutputSpeedTps * 10) / 10; }
        const turnCache = !fresh && activeConvCalls.length > 0 ? analyzeUserTurnCacheStates(activeConvCalls, {
            orchestratorConfig: matchedUsage?.orchestratorConfig, orchestratorHistory: matchedUsage?.orchestratorHistory,
            orchestratorSettings: cachedOrchestratorSettings, orchestratorPricingMode: orchMode,
        }) : null;
        const history = computeRecordedHistoryTelemetry(nowMs);
        const effToday = history.todayCostUsd > 0 ? history.todayCostUsd : (costs.todayCostUsd > 0 ? costs.todayCostUsd : 0);
        const effCum = history.cumulativeCostUsd > 0 ? history.cumulativeCostUsd : effToday;
        let subscriptionRoiSummary: string | null = null;
        const subCfg = buildSubscriptionConfig();
        if (subCfg) {
            let spanDays = Math.max(1, history.recordedDaysCount);
            if (history.earliestDateKey) {
                const sMs = Date.parse(`${history.earliestDateKey}T00:00:00Z`), eMs = Date.parse(`${history.todayKey}T00:00:00Z`);
                if (Number.isFinite(sMs) && Number.isFinite(eMs) && eMs >= sMs) { spanDays = Math.max(1, Math.round((eMs - sMs) / 86_400_000) + 1); }
            }
            const roi = estimateSubscriptionRoi(effCum > 0 ? effCum : (effToday > 0 ? effToday : (estCostUsd ?? 0)), spanDays, subCfg, currencyCfg as unknown as Parameters<typeof estimateSubscriptionRoi>[3]);
            if (roi?.enabled) { subscriptionRoiSummary = `${lang === 'zh' ? roi.planLabelZh : roi.planLabelEn} · ${roi.roiMultiple !== null && Number.isFinite(roi.roiMultiple) ? `${roi.roiMultiple.toFixed(1)}×` : '—'}`; }
        }
        const quotaPools: CdpOverlayQuotaPool[] = [];
        let tightestQuotaPct: number | null = null, tightestQuotaWindowTag: string | undefined;
        let sessionQuota5hPct: number | null = null, sessionQuota5hReset: string | undefined;
        let sessionQuotaWeeklyPct: number | null = null, sessionQuotaWeeklyReset: string | undefined;
        if (!isCustomModelActive && cachedModelConfigs.length > 0) {
            const activeModelId = matchedUsage?.model ? (resolveModelId(matchedUsage.model) || matchedUsage.model) : '';
            for (const g of selectMonitorQuotaGroups(cachedModelConfigs, matchedUsage?.model, cachedQuotaSummary)) {
                const isAct = Boolean(activeModelId && g.readings.some(r => r.model === activeModelId));
                const f5 = g.fiveHourQuota?.remainingFraction ?? g.minimum;
                const p5 = typeof f5 === 'number' && f5 >= 0 && f5 <= 1 ? f5 * 100 : null;
                const r5Iso = g.fiveHourQuota?.resetTime ?? g.resetTime ?? undefined;
                const r5Cd = r5Iso ? resetCountdown(Date.parse(r5Iso), nowMs) : undefined;
                const fw = g.weeklyQuota?.remainingFraction ?? null;
                const pw = typeof fw === 'number' && fw >= 0 && fw <= 1 ? fw * 100 : null;
                const rwIso = g.weeklyQuota?.resetTime ?? undefined;
                const rwCd = rwIso ? resetCountdown(Date.parse(rwIso), nowMs) : undefined;
                const effPct = p5 !== null && pw !== null ? Math.min(p5, pw) : (p5 ?? pw);
                const wTag = pw !== null && (p5 === null || pw < p5) ? '7d' : (p5 !== null ? '5h' : undefined);
                if (effPct !== null && (tightestQuotaPct === null || effPct < tightestQuotaPct)) { tightestQuotaPct = effPct; tightestQuotaWindowTag = wTag; }
                if (isAct) { sessionQuota5hPct = p5; sessionQuota5hReset = r5Cd; sessionQuotaWeeklyPct = pw; sessionQuotaWeeklyReset = rwCd; }
                quotaPools.push({
                    poolKey: g.pool || g.key, label: g.label, modelChips: g.members.map(m => m.label).filter(Boolean),
                    remainingPct: p5, windowTag: g.fiveHourQuota ? '5h' : undefined, resetCountdown: r5Cd, resetAtIso: r5Iso,
                    weeklyRemainingPct: pw, weeklyResetCountdown: rwCd, isCurrentSessionModel: isAct,
                    health: effPct === null ? 'unknown' : effPct <= 20 ? 'danger' : effPct < 50 ? 'warn' : 'good',
                });
            }
        }
        const fontSizePreset = normalizeCdpOverlayFontSize(appSettings.cdpOverlayFontSize);
        const highContrast: boolean | 'auto' = appSettings.cdpOverlayHighContrast ? true : 'auto';
        return {
            updatedAt: new Date(nowMs).toISOString(), nextRefreshSec: clamp(settings.pollingInterval, 1, 60), language: lang, theme: 'auto',
            cascadeId: obs.subjectCascadeId, subjectCascadeId: obs.subjectCascadeId, rootCascadeId: obs.rootCascadeId, subjectKind: obs.subjectKind,
            selectionRevision: obs.selectionRevision, dataRevision: obs.dataRevision,
            actualBasis: top.actualBasis, requestedBasis: top.requestedBasis, primaryPct: top.primaryPct, primaryPctRaw: top.primaryPctRaw, primaryPctText: top.primaryPctText,
            geometryFillPct: ring.geometryFillPct, healthStatus: top.healthStatus, isZeroStepFresh: top.isZeroStepFresh, isIncomplete: top.isIncomplete,
            compactionWarningActive: top.compactionWarningActive, compactionWarningLevel: top.compactionWarningLevel, compactionPct: top.compactionPct,
            measuredModel: obs.measuredModel, speedMode: obs.speedMode, speedMetricMode: obs.speedMode,
            speedCoverage: active && latestSpeedMetric ? { measuredCount: latestSpeedMetric.coverage.measuredCount, totalCount: latestSpeedMetric.coverage.totalCount } : null,
            speedSampleScope: obs.speedSampleScope, speedCallId: obs.speedCallId, displaySpeedTps: obs.displaySpeedTps, markers: top.markers,
            fontSizePreset, overlayFontSize: fontSizePreset, highContrast, overlayHighContrast: highContrast,
            compactionDetected: Boolean(matchedUsage?.compressionDetected), checkpointCompressionDrop: matchedUsage?.checkpointCompressionDrop ?? null,
            promptCacheTtlState: active ? latestPromptCacheTtl?.ttlEstimateState ?? 'unknown' : 'unknown', swarmSummary: buildCdpSwarmSummary(obs, overlayMasked),
            quotaWindowMode: appSettings.quotaWindowMode ?? '5h', quotaDirectionMode: appSettings.quotaDirectionMode ?? 'remaining',
            modelName: matchedUsage?.modelDisplayName || (obs.measuredModel ? normalizeModelDisplayName(obs.measuredModel) : ''),
            contextUsedTokens, contextEffectiveLimit, contextNativeLimit, contextPct: top.primaryPct ?? 0,
            compactionThresholdPct, tier200kMarkerPct, outputSpeedTps: liveOutputSpeedTps,
            avgOutputSpeedTps: active && latestSpeedMetric?.weightedTokPerSec != null ? Math.round(latestSpeedMetric.weightedTokPerSec * 10) / 10 : (primary?.weightedGenTokPerSec ?? null),
            peakOutputSpeedTps, recentCallCount: !fresh && activeConvCalls.length > 0 ? activeConvCalls.length : null,
            isShortSample: Boolean(speedEval?.isShortSample), isWaitingTtft: Boolean(speedEval?.isWaitingTtft),
            ttftMs: telemetry?.ttftPrimary != null ? Math.round(telemetry.ttftPrimary * 1000) : null,
            recentCacheHitPct: ready ? (turnCache?.latestTurn?.cacheHitPct != null ? Math.round(turnCache.latestTurn.cacheHitPct * 10) / 10 : (matchedTd?.lastTurnCacheHitPct ?? null)) : null,
            avgCacheHitPct: ready ? (primary?.tokenCacheHitRate != null ? Math.round(primary.tokenCacheHitRate * 1000) / 10 : (matchedTd?.sessionCacheHitPct ?? null)) : null,
            turnCacheState: ready ? (turnCache?.latestTurn?.cacheStart ?? (matchedTd?.lastTurnStartKind === 'warm' || matchedTd?.lastTurnStartKind === 'partial' || matchedTd?.lastTurnStartKind === 'cold' ? matchedTd.lastTurnStartKind : 'unknown')) : 'unknown',
            estCostUsd, estCostFormatted, localCostFormatted, inputTokens, outputTokens, cacheReadTokens,
            totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
            cumulativeRecordedTokens: history.cumulativeTokens,
            todayTokens: history.todayTokens > 0 ? history.todayTokens : null,
            todayCostFormatted: effToday > 0 ? formatCurrencyAmount(effToday, currencyCfg) : null,
            cumulativeCostFormatted: effCum > 0 ? formatCurrencyAmount(effCum, currencyCfg) : null,
            recordedDaysCount: history.recordedDaysCount > 0 ? history.recordedDaysCount : null,
            sessionCount: allTrajectories.length > 0 ? allTrajectories.length : (uiGmSummary?.conversations.length || null),
            subscriptionRoiSummary, tightestQuotaPct, tightestQuotaWindowTag,
            sessionQuota5hPct, sessionQuota5hReset, sessionQuotaWeeklyPct, sessionQuotaWeeklyReset, quotaPools,
        };
    }

    function pushOverlayPayloadAsync(nowMs = deps.now()): void {
        try {
            const prevCdp = overlayManager.getStatus();
            const payload = buildCdpOverlayPayload(nowMs, activeWindowId, true);
            void overlayManager.updatePayload(payload).then((status) => {
                if (status.targetUrl) {
                    try { overlayAllowedOrigin = new URL(status.targetUrl).origin; } catch { /* ignore */ }
                }
                if (status.state !== prevCdp.state
                    || status.diagnosticCode !== prevCdp.diagnosticCode
                    || status.composerEnabled !== prevCdp.composerEnabled
                    || status.topBarEnabled !== prevCdp.topBarEnabled
                    || status.targetUrl !== prevCdp.targetUrl
                    || status.targetTitle !== prevCdp.targetTitle
                    || status.discoveredPort !== prevCdp.discoveredPort
                    || status.portFilePath !== prevCdp.portFilePath
                    || status.errorMessage !== prevCdp.errorMessage) {
                    bumpStateRevision();
                }
            }).catch(() => {});
        } catch {
            // Never let optional CDP overlay payload formatting disrupt core telemetry
        }
    }

    function resolveLivePluginDir(): string {
        if (options.targetPluginDir && options.targetPluginDir.trim()) {
            return path.resolve(options.targetPluginDir.trim());
        }
        const envDir = process.env.ANTIGRAVITY_PLUGIN_DIR;
        if (typeof envDir === 'string' && envDir.trim()) {
            return path.resolve(envDir.trim());
        }
        if (options.pluginRoot && options.pluginRoot.trim()) {
            const resolvedRoot = path.resolve(options.pluginRoot.trim());
            const isPackagedInstalledLayout = path.basename(resolvedRoot) === EXPECTED_PLUGIN_NAME
                || fs.existsSync(path.join(resolvedRoot, 'sidecars', 'context_monitor', 'runtime'));
            if (isPackagedInstalledLayout && fs.existsSync(path.join(resolvedRoot, 'plugin.json'))) {
                return resolvedRoot;
            }
        }
        return path.join(deps.homedir(), '.gemini', 'config', 'plugins', EXPECTED_PLUGIN_NAME);
    }

    function toUpdateStatusView(rec: LastUpdateCheckRecord, curVer = version, statusOverride?: UpdateStatusView['status']): UpdateStatusView {
        const avail = isUpdateAvailableForVersion(rec, version);
        return {
            currentVersion: curVer, latestVersion: rec.latestVersion ?? null, updateAvailable: avail, hasUpdate: avail,
            status: statusOverride ?? (rec.error ? 'error' : (avail ? 'update_available' : 'up_to_date')),
            checkedAt: rec.checkedAt, releaseUrl: rec.releaseUrl ?? null, releaseNotesSummary: rec.releaseNotesSummary ?? null, error: rec.error ?? null,
        };
    }

    async function persistUpdateCheckResult(res: UpdateCheckResult): Promise<void> {
        const prev = appSettings.lastUpdateCheck;
        const latest = res.latestVersion ?? (res.status === 'not_modified' || res.status === 'throttled' ? prev?.latestVersion ?? null : null);
        let releaseInfo: PluginReleaseInfo | undefined;
        if (res.releaseInfo) { releaseInfo = lastCachedReleaseInfo = res.releaseInfo; }
        else if (res.status === 'not_modified') {
            if (lastCachedReleaseInfo && (!latest || lastCachedReleaseInfo.version === latest)) { releaseInfo = lastCachedReleaseInfo; }
            else { lastCachedReleaseInfo = null; }
        } else if (res.status !== 'throttled') { lastCachedReleaseInfo = null; }
        const keep = (res.status === 'not_modified' || res.status === 'throttled') && (!latest || !prev?.latestVersion || prev.latestVersion === latest);
        const record: LastUpdateCheckRecord = {
            checkedAt: res.checkedAt, latestVersion: latest,
            etag: res.etag ?? (keep ? prev?.etag ?? null : null),
            releaseUrl: releaseInfo?.releaseUrl ?? (keep ? prev?.releaseUrl ?? null : null),
            releaseNotesSummary: releaseInfo?.releaseNotesSummary ?? (keep ? prev?.releaseNotesSummary ?? null : null),
            assetName: releaseInfo?.assetName ?? (keep ? prev?.assetName ?? null : null),
            assetUrl: releaseInfo?.assetUrl ?? (keep ? prev?.assetUrl ?? null : null),
            checksumsUrl: releaseInfo?.checksumsUrl ?? (keep ? prev?.checksumsUrl ?? null : null),
            error: res.status === 'error' ? (res.error ?? 'Update check failed') : null,
        };
        const r = await persistAppSettingsPatch({ lastUpdateCheck: record });
        if (!r.committed) { appSettings = { ...appSettings, lastUpdateCheck: record }; }
        const avail = isUpdateAvailableForVersion(record, version);
        lastUpdateStatusView = toUpdateStatusView(record, res.currentVersion, res.status === 'throttled' || res.status === 'not_modified' ? (avail ? 'update_available' : 'up_to_date') : res.status);
        bumpStateRevision();
    }

    async function runUpdateCheck(force: boolean): Promise<UpdateCheckResult> {
        const prev = appSettings.lastUpdateCheck;
        const res = await deps.checkForUpdates({ currentVersion: version, force, etag: prev?.etag ?? null, lastCheckedAt: prev?.checkedAt ?? null, now: deps.now });
        if (res.status !== 'throttled') { await persistUpdateCheckResult(res); }
        else if (!lastUpdateStatusView && prev) { lastUpdateStatusView = toUpdateStatusView(prev, version, isUpdateAvailableForVersion(prev, version) ? 'update_available' : 'up_to_date'); bumpStateRevision(); }
        return res;
    }

    function triggerBackgroundUpdateCheck(): void {
        if (disposed || autoUpdateCheckInFlight || !appSettings.autoCheckUpdates || options.enableAutoUpdateCheck === false) { return; }
        if (process.env.VITEST && options.enableAutoUpdateCheck !== true && !options.deps?.checkForUpdates) { return; }
        autoUpdateCheckInFlight = true;
        void runUpdateCheck(false).catch(() => {}).finally(() => { autoUpdateCheckInFlight = false; });
    }

    async function handleOverlayAction(action: SidecarOverlayBridgeRequest): Promise<SidecarActionHttpBody> {
        if (action.command !== 'ping') { markClientActivity(); }
        switch (action.command) {
            case 'ping': return { ok: true, result: { pong: true, version, source: action.source } };
            case 'refresh': await runPollCycle(true); return { ok: true, result: { refreshed: true, time: lastUpdatedTime, source: action.source } };
            case 'togglePause': return handleAction({ command: 'togglePause' });
            case 'focusConversation': {
                const rawId = typeof action.conversationId === 'string' ? action.conversationId.trim() : '';
                if (rawId && !SAFE_CASCADE_ID_RE.test(rawId)) { return { ok: false, statusCode: 400, error: 'Invalid conversationId' }; }
                const isNew = action.isNewConversation === true;
                const winId = action.targetId ? `cdp:${action.targetId}` : activeWindowId;
                const win = getOrCreateWindowSelectionState(winId);
                const previous = win.observedHostFocus;
                const revision = action.focusRevision ?? ((win.acknowledgedFocusRevision ?? 0) + 1);
                if (!Number.isSafeInteger(revision) || revision < 0) { return { ok: false, statusCode: 400, error: 'Invalid focusRevision' }; }
                const result = (accepted: boolean, ackFocusRevision: number) => ({
                    ok: true, result: { focused: accepted, accepted, ackFocusRevision, activeConversationId: lastResolution.cascadeId, hostPending: Boolean(lastResolution.hostPending), source: action.source },
                });
                if (previous?.authority === 'cdp_passive' && revision <= previous.focusRevision) {
                    return result(revision === previous.focusRevision && previous.cascadeId === (rawId || null) && previous.isNewConversation === isNew, previous.focusRevision);
                }
                // The first verified Hub can drive the default view before an SDK window reports focus.
                // Other targets keep independent observations and never activate themselves over that window.
                if (activeWindowId === 'default' && action.targetId && !getOrCreateWindowSelectionState().observedHostFocus) {
                    activeWindowId = winId;
                }
                const focus = setHostConversationFocus(rawId || null, 'cdp', { windowId: winId, focusRevision: revision, isNewConversation: isNew });
                if (focus.accepted && focus.changed && winId === activeWindowId) {
                    selectionGeneration++; selectionRevision++;
                    await syncActiveTelemetryForResolved(recomputeConversationResolution(), backendEpoch, selectionGeneration);
                    bumpStateRevision(); pushOverlayPayloadAsync();
                }
                return result(focus.accepted, focus.accepted ? revision : (win.acknowledgedFocusRevision ?? 0));
            }
            case 'openSidecar': case 'togglePanel': case 'openPanel': {
                const rawTab = typeof action.targetTab === 'string' ? action.targetTab.trim() as CdpOverlayTargetTab : undefined;
                const validTab = rawTab && ALLOWED_OVERLAY_TARGET_TABS.has(rawTab) ? rawTab : undefined;
                if (validTab) { overlayTargetTab = { seq: ++overlayTabSeq, tab: validTab }; bumpStateRevision(); }
                return {
                    ok: true,
                    result: {
                        acknowledged: true, command: action.command, sidecarUri: 'sidecar://antigravity-context-monitor/context_monitor/', source: action.source,
                        ...(validTab && overlayTargetTab ? { targetTab: overlayTargetTab.tab, targetTabSeq: overlayTargetTab.seq } : {}),
                    },
                };
            }
            default: return { ok: false, statusCode: 400, error: `Unsupported overlay command: ${String(action.command)}` };
        }
    }

    // Immediate startup cross-day archival
    if (dailyLedger.hasData && dailyLedger.dateKey !== toLocalDateKey(new Date(deps.now()))) {
        lastArchivalDateKey = dailyLedger.dateKey;
        performDailyArchival();
    }

    // ── Telemetry Helpers ────────────────────────────────────────────────────

    function invalidateLiveModelMetadata(): void {
        modelMetadataGeneration++;
        resetImageWorkflowCache();
        setAvailableImageModelIds([]);
        hasSyncedCheckpointer = false;
        checkpointerSyncAttempts = 0;
        auxMetadataConsecutiveFailures = 0;
        cachedOrchestratorSettings = null;
        cachedQuotaSummary = null;
    }

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

    function persistQuotaSettlement(withLedger = true): void {
        lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
        void globalState.update('gmTrackerState', gmTracker.serialize());
        if (withLedger) { void globalState.update('dailyLedgerState', dailyLedger.serialize()); }
        void globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
        bumpStateRevision();
    }

    function baselineExpiredPoolsForAccount(email: string): void {
        const snap = accountSnapshots.get(email);
        if (!snap) { return; }
        const nowMs = deps.now();
        for (const pool of snap.resetPools || []) {
            if (!pool.resetTime) { continue; }
            const resetMs = parsePositivePoolResetMs(pool.resetTime);
            const mids = pool.modelIds || pool.modelLabels;
            if (resetMs === null || resetMs > nowMs || (pool.hasUsage === false && !dailyLedger.hasActiveCallsForPool(mids, email))) { continue; }
            const key = `${email}:${pool.resetTime}:${pool.modelLabels.join('|')}`;
            if (notifiedAccountResets.has(key)) { continue; }
            notifiedAccountResets.add(key);
            if (gmTracker.isPoolArchived(email, mids)) { continue; }
            const b = gmTracker.baselineForQuotaReset(email, mids, pool.resetTime);
            const a = quotaTracker.archiveExpiredSessions(email, mids);
            const s = dailyLedger.settleForQuotaReset(mids, email, resetMs);
            if (b > 0 || a > 0 || s) { persistQuotaSettlement(true); }
        }
    }

    function handleAccountSwitchIfNeeded(newEmail: string): void {
        if (!newEmail) { return; }
        if (currentAccountEmail && currentAccountEmail !== newEmail) {
            advanceAllWindowsBackendEpoch(backendEpoch + 1);
            invalidateLiveModelMetadata();
            baselineExpiredPoolsForAccount(currentAccountEmail);
            baselineExpiredPoolsForAccount(newEmail);
            currentAccountEmail = newEmail;
            gmTracker.setCurrentAccount(newEmail);
        } else if (!currentAccountEmail) {
            currentAccountEmail = newEmail;
            gmTracker.setCurrentAccount(newEmail);
            baselineExpiredPoolsForAccount(newEmail);
        }
    }

    function persistAccountSnapshots(): void { void globalState.update('accountSnapshots', [...accountSnapshots.values()]); }

    function updateAccountSnapshot(userInfo: UserStatusInfo, configs: ModelConfig[]): void {
        const email = userInfo.email;
        if (!email) { return; }
        const nowMs = deps.now();
        const poolMap = new Map(groupModelConfigsByQuotaPool(configs).map(g => [g.key, { resetTime: g.resetTime, labels: g.labels, modelIds: g.modelIds, hasUsage: g.minFraction !== null && g.minFraction < 1.0, minFraction: g.minFraction }]));
        const oldSnap = accountSnapshots.get(email);
        if (oldSnap) {
            const oldResetByModel = new Map<string, string>();
            for (const p of oldSnap.resetPools || []) { if (p.resetTime) { for (const mid of p.modelIds || []) { oldResetByModel.set(mid, p.resetTime); } } }
            for (const p of poolMap.values()) {
                if (!p.resetTime || !p.modelIds.length) { continue; }
                const oldReset = p.modelIds.map(m => oldResetByModel.get(m)).find(Boolean);
                if (!oldReset || !shouldSettleOnResetTimeChange(oldReset, p.resetTime, nowMs)) { continue; }
                const oldMs = parsePositivePoolResetMs(oldReset) ?? undefined;
                if (dailyLedger.isPoolSettled(p.modelIds, email, oldMs)) { continue; }
                const baselined = gmTracker.baselineForQuotaReset(email, p.modelIds, oldReset) > 0;
                const settled = dailyLedger.settleForQuotaReset(p.modelIds, email, oldMs);
                if (baselined || settled) { persistQuotaSettlement(true); }
            }
        }
        const usedIds = buildUsedModelIds(email);
        if (usedIds.size) { for (const p of poolMap.values()) { if (!p.hasUsage && p.modelIds.some(m => usedIds.has(m))) { p.hasUsage = true; } } }
        const resetPools: ResetPool[] = [], allResetTimes: string[] = [];
        for (const [, p] of [...poolMap.entries()].sort((a, b) => comparePoolResetTimes(a[1].resetTime, b[1].resetTime))) {
            resetPools.push({ resetTime: p.resetTime, modelLabels: p.labels, modelIds: p.modelIds, hasUsage: p.hasUsage, remainingPercent: p.hasUsage && p.minFraction !== null ? Math.round(p.minFraction * 100) : undefined });
            if (p.resetTime && !allResetTimes.includes(p.resetTime)) { allResetTimes.push(p.resetTime); }
        }
        for (const [k, s] of accountSnapshots) { if (k !== email && s.isActive) { accountSnapshots.set(k, { ...s, isActive: false }); } }
        const validCredits = currentAICredits(userInfo.availableCredits || []).flatMap(c => c.creditAmount === null ? [] : [{ creditType: c.creditType, creditAmount: c.creditAmount }]);
        accountSnapshots.set(email, {
            email, name: userInfo.name || '', planName: userInfo.planName || '', tierName: userInfo.userTierName || '',
            earliestResetTime: allResetTimes[0] || '', allResetTimes, resetPools, isActive: true, lastSeen: new Date(nowMs).toISOString(),
            credits: validCredits.length ? validCredits : undefined,
        });
        persistAccountSnapshots();
    }

    function persistQuotaRunwaysIfDue(nowMs: number, forcePersist = false): void {
        if (!runwayStateDirty || (!forcePersist && lastRunwayPersistMs > 0 && nowMs - lastRunwayPersistMs < QUOTA_RUNWAY_PERSIST_INTERVAL_MS)) { return; }
        durableState.reloadIfChanged();
        mergeDiskRunwayIntoTracker();
        const snap = quotaRunwayTracker.serialize();
        void globalState.update('quotaRunwayState', snap);
        if (snap.weeklyBuckets && Object.keys(snap.weeklyBuckets).length > 0) {
            void globalState.update('quotaRunwayWeeklyBuckets', snap.weeklyBuckets);
        }
        lastRunwayPersistMs = nowMs;
        runwayStateDirty = false;
    }

    function computeWeeklyQuotaRunways(
        nowMs: number,
        opts?: { modelId?: string; modelLabel?: string; isCustomModel?: boolean },
    ): Record<string, WeeklyQuotaRunwayEstimate> {
        const account = cachedUserInfo?.email || currentAccountEmail || 'default';
        const out: Record<string, WeeklyQuotaRunwayEstimate> = {};
        for (const g of selectMonitorQuotaGroups(cachedModelConfigs, opts?.modelId ?? currentUsage?.model, cachedQuotaSummary)) {
            const pool = g.pool || g.key;
            if (!pool || out[pool]) { continue; }
            out[pool] = quotaRunwayTracker.estimateWeekly({ account, pool, window: g.weeklyQuota?.remainingFraction !== undefined ? '7d' : '5h' }, nowMs, opts);
        }
        return out;
    }

    function recordQuotaRunways(configs: readonly ModelConfig[], nowMs: number, forcePersist = false): void {
        const account = cachedUserInfo?.email || currentAccountEmail || 'default';
        const userActivityEvidence = (lastGmCallActivityMs > 0 && nowMs - lastGmCallActivityMs < 300_000)
            || allTrajectories.some(t => t.status === CascadeStatus.RUNNING);
        let recordedAny = false;
        const recWk = (pool: string, window: '5h' | '7d', f: number | null | undefined, resetIso?: string | null) => {
            if (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1) { return; }
            quotaRunwayTracker.recordWeeklyObservation({
                account, pool, window, remainingFraction: f, timestampMs: nowMs,
                resetTimeMs: parsePositivePoolResetMs(resetIso), userActivityEvidence, surface: 'app',
            });
            recordedAny = true;
        };
        for (const p of groupModelConfigsByQuotaPool(configs)) {
            if (p.minFraction === null) { continue; }
            quotaRunwayTracker.record(p.key, p.minFraction, nowMs, parsePositivePoolResetMs(p.resetTime));
            recWk(p.key, '5h', p.minFraction, p.resetTime);
        }
        if (cachedQuotaSummary) {
            for (const g of selectMonitorQuotaGroups(configs, currentUsage?.model, cachedQuotaSummary)) {
                const pk = g.pool || g.key;
                if (!pk) { continue; }
                recWk(pk, '5h', g.fiveHourQuota?.remainingFraction, g.fiveHourQuota?.resetTime);
                recWk(pk, '7d', g.weeklyQuota?.remainingFraction, g.weeklyQuota?.resetTime);
            }
        }
        if (recordedAny) {
            runwayStateDirty = true;
            weeklyQuotaRunways = computeWeeklyQuotaRunways(nowMs, {
                modelId: currentUsage?.model, modelLabel: currentUsage?.modelDisplayName, isCustomModel: isCustomModelActive,
            });
        }
        persistQuotaRunwaysIfDue(nowMs, forcePersist);
    }

    function applyFullUserStatus(fullStatus: FullUserStatus, nowMs: number): boolean {
        if (fullStatus.configs.length === 0 && !fullStatus.userInfo) {
            return false;
        }
        updateModelDisplayNames(fullStatus.configs, { authoritative: true });
        cachedModelConfigs = fullStatus.configs;
        if (fullStatus.userInfo) {
            cachedUserInfo = fullStatus.userInfo;
            if (fullStatus.userInfo.email) {
                handleAccountSwitchIfNeeded(fullStatus.userInfo.email);
            }
            void globalState.update('cachedModelConfigs', cachedModelConfigs);
            void globalState.update('cachedPlanName', fullStatus.userInfo.planName);
            void globalState.update('cachedTierName', fullStatus.userInfo.userTierName);
            updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
        }
        quotaTracker.processUpdate(fullStatus.configs, buildUsedModelIds(fullStatus.userInfo?.email), fullStatus.userInfo?.email);
        recordQuotaRunways(fullStatus.configs, nowMs);
        return true;
    }

    function getLsAuthority(ls: LSInfo): string {
        return `${ls.useTls ? 'https' : 'http'}://${ls.hostname || '127.0.0.1'}:${ls.port}:${ls.pid}`;
    }

    async function fetchAndApplyUserStatus(
        ls: LSInfo,
        nowMs: number,
        expectedEpoch: number,
        pollRpcCache?: PollRpcCache,
    ): Promise<boolean> {
        try {
            const fullStatus = pollRpcCache
                ? await pollRpcCache.getOrFetch(
                    { backendEpoch: expectedEpoch, authority: getLsAuthority(ls), method: 'GetUserStatus' },
                    (sig) => deps.fetchFullUserStatus(ls, sig),
                    abortController.signal,
                    { shouldCache: (res) => isFullUserStatusOk(res) },
                )
                : await deps.fetchFullUserStatus(ls, abortController.signal);
            if (disposed || backendEpoch !== expectedEpoch) {
                return false;
            }
            if (!isFullUserStatusOk(fullStatus)) {
                const errMsg = ('error' in fullStatus && typeof fullStatus.error === 'string' && fullStatus.error)
                    ? fullStatus.error
                    : 'GetUserStatus returned non-ok status';
                userStatusGuard.recordFailure(errMsg);
                return false;
            }
            userStatusGuard.recordSuccess(fullStatus, nowMs);
            applyFullUserStatus(fullStatus, nowMs);
            return true;
        } catch (err) {
            if (!disposed && backendEpoch === expectedEpoch) {
                userStatusGuard.recordFailure(err);
            }
            return false;
        }
    }

    async function syncCheckpointerLimitsOnce(ls: LSInfo, generation: number): Promise<void> {
        if (hasSyncedCheckpointer || checkpointerSyncAttempts >= MAX_CHECKPOINTER_SYNC_ATTEMPTS) {
            return;
        }
        checkpointerSyncAttempts++;
        try {
            const resp = await deps.fetchAvailableModels(ls, abortController.signal);
            if (!resp || generation !== modelMetadataGeneration || disposed) { return; }
            const existingSpecs = getModelSpecs();
            const parsed = parseAvailableModelsSyncPayload(resp, {
                resolveKnownModelId: (raw) => resolveModelId(raw),
                getExistingSpec: (resolvedId) => existingSpecs.find(s => s.placeholderId === resolvedId),
                isInLivePicker: (resolvedId) => cachedModelConfigs.some(cfg => cfg.model === resolvedId),
            });
            for (const entry of parsed.entries) {
                registerResponseModelAlias(entry.responseModelAlias, entry.resolvedId);
                const patch: Partial<ModelSpec> = {
                    modelId: entry.specPatch.modelId,
                    ...(entry.specPatch.displayName ? { displayName: entry.specPatch.displayName } : {}),
                    ...(entry.specPatch.isImageGeneration ? { isImageGeneration: true } : {}),
                    ...(entry.specPatch.apiProvider ? { apiProvider: entry.specPatch.apiProvider } : {}),
                    ...(entry.specPatch.maxTokens ? { maxTokens: entry.specPatch.maxTokens } : {}),
                    ...(entry.specPatch.maxOutputTokens ? { maxOutputTokens: entry.specPatch.maxOutputTokens } : {}),
                    ...(entry.specPatch.cpLimit !== undefined ? { cpLimit: entry.specPatch.cpLimit } : {}),
                    ...(entry.specPatch.cpThreshold !== undefined ? { cpThreshold: entry.specPatch.cpThreshold } : {}),
                };
                updateModelSpec(entry.resolvedId, patch);
            }
            if (parsed.hasImageModelList) {
                setAvailableImageModelIds(parsed.imageModelIds);
            }
            if (Object.keys(parsed.contextLimitOverrides).length > 0) {
                overrideContextLimits(parsed.contextLimitOverrides);
            }
            if (parsed.hasEffectiveUpdates) {
                hasSyncedCheckpointer = true;
            }
        } catch {
            // Optional checkpointer sync degrades cleanly to built-in limits
        }
    }

    async function refreshAuxiliaryMetadata(ls: LSInfo, generation: number): Promise<void> {
        if (auxMetadataConsecutiveFailures >= MAX_AUX_METADATA_FAILURES) { return; }
        try {
            const [orchRes, quotaRes] = await Promise.allSettled([
                deps.fetchOrchestratorSettings(ls, cachedModelConfigs, abortController.signal),
                deps.fetchUserQuotaSummary(ls, abortController.signal),
            ]);
            if (generation !== modelMetadataGeneration || disposed) { return; }
            const gotOrch = orchRes.status === 'fulfilled' && !!orchRes.value;
            const gotQuota = quotaRes.status === 'fulfilled' && !!quotaRes.value;
            if (gotOrch) { cachedOrchestratorSettings = orchRes.value; }
            if (gotQuota) {
                cachedQuotaSummary = quotaRes.value;
                if (cachedModelConfigs.length > 0) {
                    recordQuotaRunways(cachedModelConfigs, deps.now());
                }
            }
            if (gotOrch || gotQuota) {
                auxMetadataConsecutiveFailures = 0;
            } else {
                auxMetadataConsecutiveFailures++;
            }
        } catch {
            auxMetadataConsecutiveFailures++;
        }
    }

    function computeLiveCostSnapshot(
        summary: GMSummary | null,
        activeCascadeId?: string,
        strictActiveOnly = false,
    ): {
        todayCostUsd: number;
        sessionCostUsd: number;
    } {
        const custom = pricingStore.getCustom();
        const orchMode = appSettings.orchestratorPricingMode;
        let todayCostUsd = 0;
        for (const bucket of dailyLedger.getTodayActive()) {
            for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
                if (ms.calls <= 0) { continue; }
                todayCostUsd += calculateLedgerModelCosts(modelKey, ms, bucket, custom, undefined, orchMode).totalCost;
            }
        }
        for (const entry of dailyLedger.getSettledEntries()) {
            todayCostUsd += entry.totalEstimatedCost || 0;
        }

        let sessionCostUsd = 0;
        if (summary && summary.conversations.length > 0 && activeCascadeId) {
            const activeConv = summary.conversations.find(c => c.cascadeId === activeCascadeId);
            // Strictly scope session cost to the active conversation (zero cross-conversation fallback)
            const calls = activeConv && activeConv.calls.length > 0 ? activeConv.calls : [];
            for (const call of calls) {
                const pricingModel = selectPricingModel(call.model || call.modelDisplay, call.responseModel, custom);
                const pricing = findPricingForDate(pricingModel, custom, call.createdAt || '', undefined, orchMode);
                if (pricing) {
                    sessionCostUsd += costFromTokens(call, pricing);
                }
            }
        }
        return { todayCostUsd, sessionCostUsd };
    }

    function getCombinedStaleState(nowMs = deps.now()): SidecarStaleState {
        const u = userStatusGuard.getSnapshot(nowMs), tr = trajectoriesGuard.getSnapshot(nowMs);
        const staleSources: Array<'userStatus' | 'trajectories'> = [...(u.isStale ? ['userStatus' as const] : []), ...(tr.isStale ? ['trajectories' as const] : [])];
        const minTs = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.min(a, b) : (b ?? a ?? null));
        const lastSuccessAtMs = u.isStale && tr.isStale ? minTs(u.lastSuccessAtMs, tr.lastSuccessAtMs) : (u.isStale ? (u.lastSuccessAtMs ?? null) : (tr.isStale ? (tr.lastSuccessAtMs ?? null) : minTs(u.lastSuccessAtMs, tr.lastSuccessAtMs)));
        const lastError = (tr.isStale ? tr.lastError : null) || (u.isStale ? u.lastError : null) || tr.lastError || u.lastError || null;
        return {
            isStale: staleSources.length > 0, lastSuccessAtMs, lastError, staleSources,
            sources: {
                userStatus: { isStale: Boolean(u.isStale), lastSuccessAtMs: u.lastSuccessAtMs ?? null, lastError: u.lastError ?? null },
                trajectories: { isStale: Boolean(tr.isStale), lastSuccessAtMs: tr.lastSuccessAtMs ?? null, lastError: tr.lastError ?? null },
            },
        };
    }

    function getOrCreateWindowSelectionState(windowId = activeWindowId): WindowSelectionState {
        const cleanWin = (windowId || 'default').trim() || 'default';
        let winState = windowSelectionStates.get(cleanWin);
        if (!winState) {
            winState = createWindowSelectionState({
                backendEpoch,
                windowId: cleanWin,
                lockToMainAgent: cleanWin === activeWindowId ? lockToMainAgent : false,
                lockedRootId: cleanWin === activeWindowId ? lockedMainId : null,
                selectionRevision,
            });
            windowSelectionStates.set(cleanWin, winState);
        }
        return winState;
    }

    function setWindowSelectionState(next: WindowSelectionState): void {
        windowSelectionStates.set(next.windowId, next);
        if (next.windowId === activeWindowId) {
            lockToMainAgent = typeof next.lockToMainAgent === 'boolean'
                ? next.lockToMainAgent
                : next.lockedRootId !== null;
            lockedMainId = next.lockedRootId;
            if (next.selectionRevision > selectionRevision) {
                selectionRevision = next.selectionRevision;
            }
        }
    }

    function advanceAllWindowsBackendEpoch(nextEpoch: number): void {
        backendEpoch = nextEpoch;
        missingPollCountByCascade.clear();
        deletedConversationIds.clear();
        focusReceiptByWindow.clear();
        observationsByWindow.clear();
        latestObservation = null;
        branchStepPeaks.clear();
        minGmTimestampByCascade.clear();
        prevUsedTokensByCascade.clear();
        for (const [winId, winState] of windowSelectionStates.entries()) {
            const advanced = advanceWindowBackendEpoch(winState, nextEpoch);
            windowSelectionStates.set(winId, advanced);
        }
        swarmRegistry.setBackendEpoch(nextEpoch);
        swarmPollScheduler.resetForBackendEpoch();
        swarmMemberInventory.reset();
        promptCacheTtlTracker.reset();
        lastRecordedCacheTtlCallKey = '';
    }

    function getEffectiveKnownSubagentIds(): Set<string> {
        const merged = new Set<string>(knownSubagentIds);
        for (const id of lastSwarmTopology.nodesById.keys()) {
            if (swarmRegistry.isKnownWorkerOrSubagent(id)) {
                merged.add(id);
            }
        }
        return merged;
    }

    function resolveTopologyRootId(cascadeId: string): string | null {
        const root = swarmRegistry.resolveRootId(cascadeId);
        return root && root !== cascadeId ? root : null;
    }

    function parseTrajectoryTimeMs(raw: string | undefined): number {
        const clean = (raw || '').trim();
        if (!clean) { return 0; }
        const ms = Date.parse(clean);
        return Number.isFinite(ms) && ms > 0 ? ms : 0;
    }

    function setHostConversationFocus(
        nextId: string | null,
        source: 'aux' | 'cdp' | 'query',
        opts?: {
            isNewConversation?: boolean;
            conversationCleared?: boolean;
            windowId?: string;
            focusRevision?: number;
            viewMode?: string;
            sourceInstanceId?: string;
            isFocusedPane?: boolean;
            inferredFromVisibleComposer?: boolean;
            inferredFromFirstUrlUuid?: boolean;
            fromSdkCallback?: boolean;
        },
    ): { accepted: boolean; changed: boolean; reason: string } {
        const nowMs = deps.now();
        const winId = (opts?.windowId || activeWindowId || 'default').trim() || 'default';
        const authority: FocusAuthorityLevel = source === 'cdp' ? 'cdp_passive' : 'host_sdk';
        const winState = getOrCreateWindowSelectionState(winId);
        const focusRev = typeof opts?.focusRevision === 'number' && Number.isSafeInteger(opts.focusRevision)
            ? opts.focusRevision
            : ((winState.acknowledgedFocusRevision ?? 0) + 1);

        const recorded = recordObservedHostFocus(
            winState,
            {
                cascadeId: nextId && nextId.trim() ? nextId.trim() : null,
                authority,
                focusRevision: focusRev,
                observedAtMs: nowMs,
                isNewConversation: opts?.isNewConversation === true,
                viewMode: opts?.viewMode ?? (source === 'aux' ? 'aux' : (source === 'cdp' ? 'topbar' : undefined)),
                sourceInstanceId: opts?.sourceInstanceId,
                isFocusedPane: opts?.isFocusedPane,
                inferredFromVisibleComposer: opts?.inferredFromVisibleComposer,
                inferredFromFirstUrlUuid: opts?.inferredFromFirstUrlUuid,
                fromSdkCallback: opts?.fromSdkCallback,
            },
            { backendEpoch },
        );

        if (!recorded.accepted) {
            return { accepted: false, changed: false, reason: recorded.reason };
        }
        setWindowSelectionState(recorded.state);

        if (winId !== activeWindowId) {
            return { accepted: true, changed: true, reason: recorded.reason };
        }

        const acceptedFocus = recorded.state.observedHostFocus;
        if (acceptedFocus?.isNewConversation === true && !acceptedFocus.cascadeId) {
            const changed = !hostNewConversationPending || hostConversationId !== null;
            hostConversationId = null;
            hostConversationSource = source;
            hostConversationUpdatedAtMs = nowMs;
            hostNewConversationPending = true;
            hostNewConversationAtMs = nowMs;
            return { accepted: true, changed, reason: recorded.reason };
        }
        if (acceptedFocus?.cascadeId) {
            const clean = acceptedFocus.cascadeId;
            const changed = clean !== hostConversationId || hostNewConversationPending;
            hostConversationId = clean;
            hostConversationSource = source;
            hostConversationUpdatedAtMs = nowMs;
            hostNewConversationPending = false;
            hostNewConversationAtMs = 0;
            deletedConversationIds.delete(clean);
            missingPollCountByCascade.delete(clean);
            return { accepted: true, changed, reason: recorded.reason };
        }
        const changed = hostConversationId !== null || hostNewConversationPending;
        hostConversationId = hostConversationSource = null;
        hostConversationUpdatedAtMs = hostNewConversationAtMs = 0;
        hostNewConversationPending = false;
        return { accepted: true, changed, reason: recorded.reason };
    }

    function reconcileHostFocusBeforeResolution(trajectories: TrajectorySummary[], nowMs: number): void {
        const currentIds = new Set<string>();
        for (const tr of trajectories) {
            if (tr.cascadeId) { currentIds.add(tr.cascadeId); missingPollCountByCascade.delete(tr.cascadeId); deletedConversationIds.delete(tr.cascadeId); }
        }
        if (trajectories.length > 0) {
            for (const prevId of seenTrajectoryIds) {
                if (!currentIds.has(prevId)) {
                    const nextMiss = (missingPollCountByCascade.get(prevId) ?? 0) + 1;
                    missingPollCountByCascade.set(prevId, nextMiss);
                    if (nextMiss >= 2) { deletedConversationIds.add(prevId); }
                }
            }
        }
        const clearHost = (pred: (f: WindowSelectionState['observedHostFocus']) => boolean) => {
            hostConversationId = hostConversationSource = null; hostConversationUpdatedAtMs = 0;
            const cw = getOrCreateWindowSelectionState(activeWindowId);
            if (cw.observedHostFocus && pred(cw.observedHostFocus)) { setWindowSelectionState({ ...cw, observedHostFocus: null }); }
        };
        const activeWin = getOrCreateWindowSelectionState(activeWindowId);
        if (hostConversationId && trajectories.length > 0 && !currentIds.has(hostConversationId)
            && (deletedConversationIds.has(hostConversationId) || (seenTrajectoryIds.has(hostConversationId) && activeWin.lockedRootId !== hostConversationId))) {
            const staleId = hostConversationId;
            clearHost(f => f?.cascadeId === staleId);
        }
        if (hostConversationId && !currentIds.has(hostConversationId) && hostConversationUpdatedAtMs > 0 && nowMs - hostConversationUpdatedAtMs > HOST_PENDING_MAX_MS) {
            clearHost(f => Boolean(f?.cascadeId && !currentIds.has(f.cascadeId)));
        }
        const effSub = getEffectiveKnownSubagentIds();
        const hasNewMain = latestNewlyCreatedIds.size > 0 && trajectories.some(tr => latestNewlyCreatedIds.has(tr.cascadeId) && tr.killed !== true && !isSubagentTrajectory(tr, effSub));
        if (hostNewConversationPending && (hasNewMain || nowMs - hostNewConversationAtMs > HOST_PENDING_MAX_MS)) {
            hostNewConversationPending = false; hostNewConversationAtMs = 0;
            const cw = getOrCreateWindowSelectionState(activeWindowId);
            if (cw.observedHostFocus?.isNewConversation) { setWindowSelectionState({ ...cw, observedHostFocus: null }); }
        }
        if (hostConversationId) {
            const age = hostConversationUpdatedAtMs > 0 ? Math.max(0, nowMs - hostConversationUpdatedAtMs) : 0;
            const isStale = hostConversationSource === 'env' ? (age > HOST_CONVERSATION_STALE_MS || hasNewMain) : (hostConversationUpdatedAtMs > 0 && age > HOST_CONVERSATION_STALE_MS);
            if (isStale) {
                const hTraj = trajectories.find(tr => tr.cascadeId === hostConversationId);
                const hostRunning = hTraj?.status === CascadeStatus.RUNNING && hTraj.killed !== true;
                const anotherRunning = trajectories.some(tr =>
                    tr.cascadeId !== hostConversationId && tr.status === CascadeStatus.RUNNING && tr.killed !== true && !isSubagentTrajectory(tr, effSub)
                    && Math.max(parseTrajectoryTimeMs(tr.lastUserInputTime), parseTrajectoryTimeMs(tr.lastModifiedTime), parseTrajectoryTimeMs(tr.createdTime)) > hostConversationUpdatedAtMs);
                if (hasNewMain || (!hostRunning && anotherRunning)) { clearHost(() => true); }
            }
        }
    }

    function clearActiveConversationTelemetry(pendingCascadeId: string | null, nowMs: number): void {
        telemetryRefreshSeq++;
        currentUsage = null;
        contextBreakdown = (pendingCascadeId || hostNewConversationPending)
            ? parseContextBreakdown({
                generatorMetadata: [],
                steps: [],
                currentStepCount: 0,
            })
            : null;
        contextBreakdownCascadeId = pendingCascadeId;
        turnDiagnostics = null;
        turnDiagnosticsCascadeId = pendingCascadeId;
        cachedRawTelemetryKey = '';
        cachedRawGmEntries = [];
        cachedRawSteps = [];
        isCustomModelActive = false;
        quotaRunways = quotaRunwayTracker.estimateAll(nowMs);
        weeklyQuotaRunways = computeWeeklyQuotaRunways(nowMs);
        latestPromptCacheTtl = null;
        latestSpeedMetric = null;
        activeRecoveryBrief = null;
        monitorStatus = (pendingCascadeId || hostNewConversationPending)
            ? { state: 'idle' }
            : { state: 'empty' };
        publishCurrentObservation(nowMs);
    }

    function resolveWindowState(winState: WindowSelectionState) {
        const active = winState.windowId === activeWindowId;
        return selectConversation(winState, {
            trajectories: allTrajectories,
            backendEpoch,
            pinnedId: active ? pinnedConversationId : pinsByWindow.get(winState.windowId),
            currentActiveId: active ? trackedCascadeId : winState.observedHostFocus?.cascadeId,
            currentActiveSinceMs: active ? trackedCascadeSinceMs : 0,
            workspaceUris: activeWorkspaceUris,
            knownSubagentIds: getEffectiveKnownSubagentIds(),
            newlyCreatedIds: latestNewlyCreatedIds,
            isolateWorkers: allTrajectories.some(tr => tr.manifestMember),
            deletedConversationIds,
            hostConversationPendingAllowed: !active || (hostConversationSource !== null && hostConversationSource !== 'env'),
            topologyResolveRootId: resolveTopologyRootId,
        });
    }

    function recomputeConversationResolution(windowId = activeWindowId): ResolvedConversationTarget {
        const effectiveSubagents = getEffectiveKnownSubagentIds();
        let winState = getOrCreateWindowSelectionState(windowId);
        // Seed initial env hostConversationId into observedHostFocus when not yet present
        if (windowId === activeWindowId && !winState.observedHostFocus && hostConversationId && hostConversationSource === 'env') {
            winState = {
                ...winState,
                observedHostFocus: {
                    cascadeId: hostConversationId,
                    authority: 'host_sdk',
                    focusRevision: winState.acknowledgedFocusRevision ?? 0,
                    observedAtMs: hostConversationUpdatedAtMs || deps.now(),
                    isNewConversation: false,
                },
            };
        }

        const { state: nextWinState, resolution: resolved } = resolveWindowState(winState);


        setWindowSelectionState(nextWinState);

        if (windowId === activeWindowId) {
            lastResolution = resolved;
            if (resolved.cascadeId) {
                if (resolved.cascadeId !== trackedCascadeId) {
                    trackedCascadeSinceMs = deps.now();
                }
                trackedCascadeId = resolved.cascadeId;
            } else if (resolved.hostPending) {
                trackedCascadeId = null;
                trackedCascadeSinceMs = 0;
            }
            conversationOptions = buildConversationOptions(
                allTrajectories,
                resolved.cascadeId,
                nextWinState.lockedRootId ?? resolved.lockedMainId,
                {
                    workspaceUris: activeWorkspaceUris,
                    knownSubagentIds: effectiveSubagents,
                    lang: getLanguage(),
                },
            );
        }
        return resolved;
    }

    async function refreshSwarmTopology(trajectories: TrajectorySummary[], nowMs: number): Promise<SwarmTopologySnapshot> {
        const curWin = getOrCreateWindowSelectionState(activeWindowId);
        const priorityIds: string[] = [];
        const addPriority = (id: string | null | undefined): void => {
            if (typeof id === 'string' && id.trim() && !priorityIds.includes(id.trim())) {
                priorityIds.push(id.trim());
            }
        };
        addPriority(curWin.lockedRootId);
        addPriority(curWin.inspectedMemberId);
        addPriority(trackedCascadeId);
        for (const tr of trajectories) {
            if (tr.status === CascadeStatus.RUNNING && tr.killed !== true) {
                addPriority(tr.cascadeId);
            }
        }
        try {
            await swarmRegistry.sweepManifests({
                priorityCascadeIds: priorityIds,
                nowMs,
            });
        } catch {
            // Read-only manifest sweep failure degrades cleanly to RPC/trajectory topology
        }

        const rpcLinks: RpcTopologyLinkProjection[] = [];
        if (currentUsage?.cascadeId && currentUsage.imageWorkflow?.linkedCascadeIds) {
            for (const childId of currentUsage.imageWorkflow.linkedCascadeIds) {
                if (childId && childId !== currentUsage.cascadeId) {
                    rpcLinks.push({
                        parentCascadeId: currentUsage.cascadeId,
                        childCascadeId: childId,
                        kind: 'direct_subagent',
                        observedAtMs: nowMs,
                    });
                }
            }
        }

        lastSwarmTopology = swarmRegistry.reconcile({
            backendEpoch,
            nowMs,
            trajectories,
            rpcLinks,
            deletedConversationIds,
        });

        for (const nodeId of lastSwarmTopology.nodesById.keys()) {
            if (swarmRegistry.isKnownWorkerOrSubagent(nodeId)) {
                knownSubagentIds.add(nodeId);
            }
        }
        return lastSwarmTopology;
    }

    function computeActiveSwarmGroupCost(): SwarmGroupCostSummary | null {
        const curWin = getOrCreateWindowSelectionState(activeWindowId);
        const rootId = lastResolution.rootCascadeId
            ?? curWin.lockedRootId
            ?? (lastResolution.cascadeId ? swarmRegistry.resolveRootId(lastResolution.cascadeId) : null);
        return lastSwarmGroupCost = computeWindowSwarmGroupCost(rootId);
    }

    function computeWindowSwarmGroupCost(rootId: string | null | undefined): SwarmGroupCostSummary | null {
        const group = rootId ? lastSwarmTopology.groupsByRootId.get(rootId) : undefined;
        if (!group) { return null; }
        const custom = pricingStore.getCustom();
        const conversations = deps.fetchGM ? lastGMSummary?.conversations ?? []
            : gmTracker.getGroupCostConversations([group.rootId, ...group.memberIds]);
        return priceSwarmGroup(group, conversations, call => {
            const model = selectPricingModel(call.model || call.modelDisplay, call.responseModel, custom);
            const price = findPricingForDate(model, custom, call.createdAt || '', undefined, appSettings.orchestratorPricingMode);
            return price ? costFromTokens(call, price) : null;
        });
    }

    function fetchGmMetaCached(
        ls: LSInfo,
        cascadeId: string,
        branchRevision: string,
        epoch: number,
        pollRpcCache?: PollRpcCache,
    ): Promise<FetchTrajectoryGeneratorMetadataResult> {
        const run = (sig: AbortSignal) => deps.fetchTrajectoryGeneratorMetadataResult
            ? deps.fetchTrajectoryGeneratorMetadataResult(ls, cascadeId, sig)
            : deps.fetchTrajectoryGeneratorMetadata(ls, cascadeId, sig).then((metadata) => ({ ok: true, metadata }));
        return pollRpcCache
            ? pollRpcCache.getOrFetch(
                { backendEpoch: epoch, authority: getLsAuthority(ls), method: 'GetCascadeTrajectoryGeneratorMetadata', cascadeId, branchRevision },
                run, abortController.signal, { shouldCache: (res) => res.ok !== false },
            )
            : run(abortController.signal);
    }

    async function runSwarmSchedulerTick(
        lsInfo: LSInfo,
        trajectories: TrajectorySummary[],
        nowMs: number,
        pollEpoch: number,
        pollRpcCache: PollRpcCache,
    ): Promise<SwarmPollTickResult | null> {
        const curWin = getOrCreateWindowSelectionState(activeWindowId);
        const activeRootId = lastResolution.rootCascadeId
            ?? curWin.lockedRootId
            ?? (lastResolution.cascadeId ? swarmRegistry.resolveRootId(lastResolution.cascadeId) : null);
        if (!activeRootId) { return null; }

        const group = lastSwarmTopology.groupsByRootId.get(activeRootId);
        if (!group || group.memberIds.length <= 1) { return null; }

        const trajById = new Map<string, TrajectorySummary>();
        for (const tr of trajectories) {
            if (tr.cascadeId) { trajById.set(tr.cascadeId, tr); }
        }

        const members: SwarmSchedulableMember[] = [];
        const seenMembers = new Set<string>();
        for (const cid of [activeRootId, ...group.memberIds]) {
            if (!cid || seenMembers.has(cid)) { continue; }
            seenMembers.add(cid);
            const node = lastSwarmTopology.nodesById.get(cid);
            const tr = trajById.get(cid);
            const isKilled = Boolean(node?.killed || tr?.killed);
            const status = tr?.status;
            const isTerminal = isKilled
                || (typeof status === 'string' && /(?:COMPLETED|FAILED|CANCELLED|TERMINATED|STOPPED)/i.test(status));
            const isRunning = status === CascadeStatus.RUNNING && !isKilled;
            members.push({ cascadeId: cid, isKilled, isTerminal, isRunning });
        }

        if (members.length === 0) { return null; }

        const measurements = new Map<string, { lastObservedAt: number; measuredModel?: string; contextPct?: number }>();
        const tick = await swarmPollScheduler.runTick({
            rootCascadeId: activeRootId,
            inspectedMemberId: curWin.inspectedMemberId,
            members,
            nowMs,
            pollMember: async (cascadeId) => {
                if (disposed || backendEpoch !== pollEpoch) {
                    return { ok: false, requestsUsed: 0, pagesUsed: 0 };
                }
                const tr = trajById.get(cascadeId);
                if (!tr) {
                    return { ok: false, requestsUsed: 0, pagesUsed: 0 };
                }
                try {
                    const branchRev = `${tr.stepCount}:${tr.lastModifiedTime}:${tr.status}`;
                    const res = await fetchGmMetaCached(lsInfo, cascadeId, tr.manifestMember ? 'manifest-member' : branchRev, pollEpoch, pollRpcCache);
                    const bytesUsed = Buffer.byteLength(JSON.stringify(res.metadata || []));
                    if (res.ok !== false && !disposed && backendEpoch === pollEpoch) {
                        const breakdown = parseContextBreakdown({ generatorMetadata: res.metadata, currentStepCount: tr.stepCount });
                        const measuredModel = breakdown.model || undefined;
                        const limit = appSettings.contextPctBasis === 'native'
                            ? breakdown.nativeLimitTokens : breakdown.effectiveBudgetTokens;
                        const measured = breakdown.usedTokens > 0 && limit > 0;
                        measurements.set(cascadeId, { lastObservedAt: deps.now(), measuredModel,
                            contextPct: measured ? Math.round(breakdown.usedTokens / limit * 1000) / 10 : (tr.stepCount === 0 ? 0 : undefined),
                        });
                    }
                    return { ok: res.ok !== false, requestsUsed: 1, pagesUsed: 1, bytesUsed };
                } catch {
                    return { ok: false, requestsUsed: 1, pagesUsed: 1 };
                }
            },
        });

        if (disposed || backendEpoch !== pollEpoch) { return null; }
        lastSwarmTopology = swarmRegistry.recordMemberMeasurements(pollEpoch, measurements);
        lastSwarmPollTick = tick;
        return tick;
    }

    function findResolvedTrajectory(resolved: ResolvedConversationTarget): TrajectorySummary | null {
        if (!resolved.cascadeId) { return null; }
        return allTrajectories.find(tr => tr.cascadeId === resolved.cascadeId) ?? null;
    }

    async function refreshActiveConversationTelemetry(
        ls: LSInfo,
        activeTrajectory: TrajectorySummary,
        nowMs: number,
        expectedEpoch = backendEpoch,
        expectedSelGen = selectionGeneration,
        pollRpcCache?: PollRpcCache,
    ): Promise<void> {
        const mySeq = ++telemetryRefreshSeq;
        const isStale = (): boolean =>
            mySeq !== telemetryRefreshSeq
            || expectedEpoch !== backendEpoch
            || expectedSelGen !== selectionGeneration
            || disposed;

        // 1. ContextUsage (computed into local variable — never mutated mid-await!)
        const persistedUsage = monitorStore.getSnapshot(activeTrajectory.cascadeId);
        let nextUsage: ContextUsage;
        if (hasSameUsageInputs(currentUsage, activeTrajectory)) {
            nextUsage = await deps.refreshWorkflowImageUsage(ls, currentUsage, abortController.signal);
        } else if (hasSameUsageInputs(persistedUsage, activeTrajectory)) {
            nextUsage = await deps.refreshWorkflowImageUsage(ls, persistedUsage, abortController.signal);
        } else {
            nextUsage = await deps.getContextUsage(ls, activeTrajectory, undefined, abortController.signal);
        }
        if (isStale()) { return; }

        if (nextUsage?.imageWorkflow?.linkedCascadeIds) {
            const linkedRpc: RpcTopologyLinkProjection[] = [];
            for (const subId of nextUsage.imageWorkflow.linkedCascadeIds) {
                knownSubagentIds.add(subId);
                if (subId && subId !== activeTrajectory.cascadeId) {
                    linkedRpc.push({
                        parentCascadeId: activeTrajectory.cascadeId,
                        childCascadeId: subId,
                        kind: 'direct_subagent',
                        observedAtMs: nowMs,
                    });
                }
            }
            if (linkedRpc.length > 0) {
                swarmRegistry.ingestRpcProjections(linkedRpc, expectedEpoch);
            }
        }
        const previousPeak = branchStepPeaks.get(activeTrajectory.cascadeId);
        const peak = advanceBranchStepPeak(previousPeak, {
            stepCount: activeTrajectory.stepCount, branchRevision: activeTrajectory.branchName,
        });
        const minGmTimestamp = peak.peakReset || nextUsage.compressionDetected
            ? activeTrajectory.lastModifiedTime || nowMs
            : minGmTimestampByCascade.get(activeTrajectory.cascadeId);
        if (lastGMSummary && nextUsage) {
            const opts = buildGMFallbackOptions(activeTrajectory.stepCount, previousPeak?.lastObservedStepCount,
                contextBreakdownCascadeId === activeTrajectory.cascadeId ? contextBreakdown : null, nextUsage.compressionDetected);
            applyGMContextToUsage(nextUsage, getLatestGMContextUsedForCascade(lastGMSummary, activeTrajectory.cascadeId, {
                ...opts, minTimestampMs: minGmTimestamp,
            }));
        }

        // 2. Raw GeneratorMetadata + Raw Steps for Context Breakdown & Turn Diagnostics
        const rawCacheKey = `${activeTrajectory.cascadeId}:${activeTrajectory.stepCount}:${activeTrajectory.lastModifiedTime}:${activeTrajectory.status}`;
        const canReuseRawCache = activeTrajectory.status !== CascadeStatus.RUNNING
            && cachedRawTelemetryKey === rawCacheKey;

        let rawGmEntries = canReuseRawCache ? cachedRawGmEntries : [];
        let rawSteps = canReuseRawCache ? cachedRawSteps : [];
        let stepsSuffixStartOffset: number | undefined;
        let canLatchRawCache = canReuseRawCache;
        if (!canReuseRawCache) {
            const authority = getLsAuthority(ls);
            const branchRev = `${activeTrajectory.stepCount}:${activeTrajectory.lastModifiedTime}:${activeTrajectory.status}`;
            const fetchGmMeta = () => fetchGmMetaCached(ls, activeTrajectory.cascadeId, activeTrajectory.manifestMember ? 'manifest-member' : branchRev, expectedEpoch, pollRpcCache);
            const embeddedSteps = nextUsage._fetchedSteps;
            const fetchSteps = () => {
                if (Array.isArray(embeddedSteps) && embeddedSteps.length > 0) {
                    return Promise.resolve({
                        ok: !nextUsage.hasGaps,
                        steps: embeddedSteps,
                        hasGaps: Boolean(nextUsage.hasGaps),
                        ...(isSuffixRecoveredResult(nextUsage) ? { suffixRecovered: true, suffixStartOffset: nextUsage.suffixStartOffset } : {}),
                    });
                }
                const run = (sig: AbortSignal) => deps.fetchTrajectorySteps(ls, activeTrajectory.cascadeId, activeTrajectory.stepCount, sig);
                return pollRpcCache
                    ? pollRpcCache.getOrFetch(
                        { backendEpoch: expectedEpoch, authority, method: 'GetCascadeTrajectorySteps', cascadeId: activeTrajectory.cascadeId, range: `0:${activeTrajectory.stepCount}`, branchRevision: branchRev },
                        run, abortController.signal, { shouldCache: (res) => res.ok !== false && !res.hasGaps },
                    )
                    : run(abortController.signal);
            };

            const gmMetaRes = await fetchGmMeta().then(
                (value) => ({ status: 'fulfilled' as const, value }),
                (reason) => ({ status: 'rejected' as const, reason }),
            );
            if (isStale()) { return; }
            const gmOk = gmMetaRes.status === 'fulfilled' && gmMetaRes.value.ok !== false;
            rawGmEntries = gmMetaRes.status === 'fulfilled' ? gmMetaRes.value.metadata : [];
            const latestGmWithChat = gmOk ? [...rawGmEntries].reverse().find((entry) => Boolean(entry?.chatModel)) : undefined;
            const latestCm = latestGmWithChat?.chatModel as { promptSections?: unknown[] } | undefined;
            const hasPromptSections = gmOk && Array.isArray(latestCm?.promptSections) && latestCm.promptSections.length > 0;
            let stepsOk = true;
            if (Array.isArray(embeddedSteps) && embeddedSteps.length > 0) {
                rawSteps = embeddedSteps;
                stepsOk = !nextUsage.hasGaps;
                stepsSuffixStartOffset = isSuffixRecoveredResult(nextUsage) ? nextUsage.suffixStartOffset : undefined;
            } else if (!hasPromptSections && activeTrajectory.stepCount > 0) {
                const stepsRes = await fetchSteps().then(
                    (value) => ({ status: 'fulfilled' as const, value }),
                    (reason) => ({ status: 'rejected' as const, reason }),
                );
                if (isStale()) { return; }
                stepsOk = stepsRes.status === 'fulfilled'
                    && stepsRes.value.ok !== false
                    && !stepsRes.value.hasGaps;
                rawSteps = stepsRes.status === 'fulfilled' ? stepsRes.value.steps : [];
                stepsSuffixStartOffset = stepsRes.status === 'fulfilled' && isSuffixRecoveredResult(stepsRes.value)
                    ? (stepsRes.value as { suffixStartOffset?: number }).suffixStartOffset
                    : undefined;
            } else {
                rawSteps = [];
            }
            canLatchRawCache = gmOk && stepsOk && !nextUsage.hasGaps;
        }

        // 3. Rewind tracking & Dual-Cap Context Breakdown
        const prevUsedTokens = prevUsedTokensByCascade.get(activeTrajectory.cascadeId);
        const effectiveModel = nextUsage?.model || activeTrajectory.requestedModel || activeTrajectory.generatorModel || '';
        const modelDisplayName = nextUsage?.modelDisplayName || normalizeModelDisplayName(effectiveModel);
        const spec = effectiveModel ? guessContextLimitSpec(effectiveModel) : undefined;
        const effectiveBudgetTokens = nextUsage?.contextLimit || getContextLimit(effectiveModel);
        const nativeLimitTokens = Math.max(spec?.maxTokens || 0, effectiveBudgetTokens);

        const nextBreakdown = parseContextBreakdown({
            generatorMetadata: rawGmEntries,
            steps: rawSteps,
            ...(stepsSuffixStartOffset !== undefined ? { suffixStartOffset: stepsSuffixStartOffset } : {}),
            currentStepCount: activeTrajectory.stepCount,
            branchPeakStepCount: peak.effectiveBranchPeakStepCount,
            previousUsedTokens: prevUsedTokens,
            model: effectiveModel,
            modelDisplayName,
            effectiveBudgetTokens,
            nativeLimitTokens,
        });

        // 4. Turn Diagnostics (prefer raw GM entries; fall back to active GMTracker calls)
        const activeGmConvCalls = lastGMSummary?.conversations.find(c => c.cascadeId === activeTrajectory.cascadeId)?.calls || [];
        const nextTurnDiagnostics = analyzeTurnDiagnostics(rawGmEntries.length > 0 ? rawGmEntries : activeGmConvCalls);

        // 5. Custom-model isolation, Quota Runway & Compaction Recovery Brief
        const nextIsCustomModel = isCustomModel(effectiveModel, modelDisplayName);
        const nextQuotaRunways = quotaRunwayTracker.estimateAll(nowMs, {
            modelId: effectiveModel,
            modelLabel: modelDisplayName,
            isCustomModel: nextIsCustomModel,
        });
        const nextWeeklyRunways = computeWeeklyQuotaRunways(nowMs, {
            modelId: effectiveModel,
            modelLabel: modelDisplayName,
            isCustomModel: nextIsCustomModel,
        });
        const convRole = nextUsage?.tokenUsageSource === 'planner'
            ? 'planner'
            : (nextUsage?.orchestratorConfig ? 'executor' : 'single');
        const convBranch = nextUsage?.branchName || activeTrajectory.branchName || 'main';
        const checkpoints = nextBreakdown.compactionCheckpoints || [];
        const cpAnchorStep = checkpoints.length > 0
            ? checkpoints[checkpoints.length - 1].stepIndex
            : activeTrajectory.stepCount;
        const isUndoStep = peak.isRewind;
        const nextRecoveryBrief = recoveryBriefTracker.evaluate({
            cascadeId: activeTrajectory.cascadeId,
            model: effectiveModel || 'unknown',
            role: convRole,
            branch: convBranch,
            stepCount: activeTrajectory.stepCount,
            compactionEventAnchor: cpAnchorStep,
            previousTokens: prevUsedTokens ?? null,
            currentTokens: nextBreakdown.usedTokens > 0 ? nextBreakdown.usedTokens : (nextUsage?.contextUsed ?? null),
            dropTokens: nextUsage && nextUsage.checkpointCompressionDrop > 0 ? nextUsage.checkpointCompressionDrop : null,
            limitTokens: effectiveBudgetTokens,
            compressionDetected: Boolean(nextUsage?.compressionDetected || checkpoints.length > 0),
            isUndo: isUndoStep,
            nowMs,
            lang: getLanguage(),
        });

        // 6. Atomic commit — guarantees currentUsage, contextBreakdown, and turnDiagnostics
        //    never tear across conversations and stale out-of-order RPCs are discarded.
        if (isStale()) { return; }
        currentUsage = nextUsage;
        cachedRawGmEntries = rawGmEntries;
        cachedRawSteps = rawSteps;
        cachedRawTelemetryKey = canLatchRawCache ? rawCacheKey : '';
        contextBreakdown = nextBreakdown;
        contextBreakdownCascadeId = activeTrajectory.cascadeId;
        turnDiagnostics = nextTurnDiagnostics;
        turnDiagnosticsCascadeId = activeTrajectory.cascadeId;
        isCustomModelActive = nextIsCustomModel;
        quotaRunways = nextQuotaRunways;
        weeklyQuotaRunways = nextWeeklyRunways;
        activeRecoveryBrief = nextRecoveryBrief;

        branchStepPeaks.set(activeTrajectory.cascadeId, peak.state);
        if (minGmTimestamp !== undefined) { minGmTimestampByCascade.set(activeTrajectory.cascadeId, minGmTimestamp); }
        if (nextBreakdown.usedTokens > 0) {
            prevUsedTokensByCascade.set(activeTrajectory.cascadeId, nextBreakdown.usedTokens);
        }

        monitorStatus = currentUsage
            ? { state: 'active' }
            : { state: 'idle' };
        publishCurrentObservation(nowMs);
    }

    function computeDataSignature(): string {
        const stale = getCombinedStaleState();
        const cdp = overlayManager.getStatus();
        const uiGm = getActiveUiGmSummary();
        const act = activityTracker.getSummary();
        const curWin = getOrCreateWindowSelectionState(activeWindowId);
        const rootId = lastResolution.rootCascadeId ?? curWin.lockedRootId ?? lastResolution.cascadeId;
        const grp = rootId ? lastSwarmTopology.groupsByRootId.get(rootId) : undefined;
        const gmSig = uiGm ? [
            uiGm.totalCalls, uiGm.totalInputTokens, uiGm.totalOutputTokens, uiGm.totalCacheRead, uiGm.totalCacheCreation,
            uiGm.totalThinkingTokens, uiGm.totalCredits, uiGm.totalRetryCount, uiGm.totalRetryTokens,
            Object.entries(uiGm.retryErrorCodes || {}).sort(([a], [b]) => a.localeCompare(b)),
            Object.entries(uiGm.toolCallCounts || {}).sort(([a], [b]) => a.localeCompare(b)),
            uiGm.toolCatalog?.length ?? 0, uiGm.uniqueErrors?.length ?? 0,
            Object.entries(uiGm.modelBreakdown || {}).sort(([a], [b]) => a.localeCompare(b)).map(([m, s]) => `${m}:${s.callCount}:${s.totalInputTokens}:${s.totalOutputTokens}:${s.errorCount}:${s.exactCallCount}:${s.placeholderOnlyCalls}`),
            (uiGm.conversations || []).map(c => `${c.cascadeId}:${c.totalSteps}:${(c.calls || []).length}:${(c.checkpointSummaries || []).length}:${(c.systemContextItems || []).length}:${(c.calls || []).map(x => `${x.model}:${x.responseModel}:${x.executionModel ?? ''}:${x.modelAccuracy}:${x.inputTokens ?? 0}:${x.outputTokens ?? 0}:${x.cacheReadTokens ?? 0}:${x.cacheCreationTokens ?? 0}:${x.ttftSeconds ?? ''}:${x.streamingSeconds ?? ''}:${(x.userMessageAnchors || []).length}:${x.createdAt}:${x.hasError ? 1 : 0}`).join(',')}`),
        ] : null;
        return JSON.stringify([
            monitorStatus.state, monitorStatus.state === 'disconnected' ? monitorStatus.backendIssue : '',
            backendEpoch, cachedLsInfo?.pid, cachedLsInfo?.port, cachedLsInfo?.surface, cachedLsInfo?.source,
            stale.isStale, stale.staleSources ?? [], stale.isStale ? stale.lastSuccessAtMs : null, stale.isStale ? (stale.lastError ?? '') : '',
            [...privacyMaskedByWindow.entries()].sort(([a], [b]) => a.localeCompare(b)), getLanguage(), isPaused, lastResolution.cascadeId, lastResolution.mode, selectionRevision,
            pinnedConversationId, lockToMainAgent, curWin.lockedRootId ?? lastResolution.lockedMainId, curWin.inspectedMemberId,
            Boolean(curWin.lockPendingUnavailable), curWin.retargetOfferId ?? null, lastResolution.pinnedFallback, lastResolution.ignoredSubagentBurst,
            Boolean(lastResolution.hostPending), hostNewConversationPending,
            currentUsage ? `${currentUsage.cascadeId}:${currentUsage.contextUsed}:${currentUsage.stepCount}:${currentUsage.model}:${currentUsage.modelDisplayName}:${currentUsage.status}:${currentUsage.lastModifiedTime}:${currentUsage.totalOutputTokens}:${currentUsage.totalToolCallOutputTokens}:${currentUsage.contextLimit}:${currentUsage.isEstimated ? 1 : 0}:${currentUsage.compressionDetected ? 1 : 0}:${currentUsage.imageGenStepCount}` : '',
            contextBreakdown?.usedTokens, contextBreakdown?.measurementState, contextBreakdown?.effectiveBudgetTokens, contextBreakdown?.nativeLimitTokens, Boolean(contextBreakdown?.hasDualCap),
            turnDiagnostics?.totalTurns, turnDiagnostics?.lastTurnCacheHitPct, turnDiagnostics?.sessionCacheHitPct, turnDiagnostics?.lastTurnStartKind,
            isCustomModelActive,
            allTrajectories.map(tr => `${tr.cascadeId}:${tr.status}:${tr.stepCount}:${tr.summary || ''}:${tr.lastModifiedTime || ''}`),
            cachedUserInfo ? `${cachedUserInfo.email}:${cachedUserInfo.name}:${cachedUserInfo.planName}:${cachedUserInfo.userTierName}:${(cachedUserInfo.availableCredits || []).map(c => `${c.creditType}=${c.creditAmount}`).join(',')}` : '',
            selectedAccountKey || cachedUserInfo?.email || currentAccountEmail || '',
            [...accountSnapshots.values()].map(s => `${s.email}:${s.isActive ? 1 : 0}:${s.planName}:${s.tierName}:${s.earliestResetTime}:${(s.credits || []).map(c => `${c.creditType}=${c.creditAmount}`).join(',')}:${(s.resetPools || []).map(p => `${p.resetTime}=${p.remainingPercent ?? ''}:${p.hasUsage ? 1 : 0}`).join(';')}`),
            cachedModelConfigs.map(c => `${c.model}:${c.label}:${c.quotaInfo?.remainingFraction ?? ''}:${c.quotaInfo?.resetTime ?? ''}`),
            Object.entries(quotaRunways).map(([k, v]) => `${k}:${v.status}:${v.burnRatePctPerHour}:${v.estExhaustMs ?? ''}`),
            Object.entries(weeklyQuotaRunways).map(([k, v]) => `${k}:${v.status}:${v.coverage.activeHours}`),
            latestPromptCacheTtl ? `${latestPromptCacheTtl.ttlEstimateState}:${latestPromptCacheTtl.measuredCacheState}` : '',
            activeRecoveryBrief?.eventKey ?? '', cachedQuotaSummary, cachedOrchestratorSettings, gmSig,
            [activityChangeSeq, act?.totalUserInputs, act?.totalReasoning, act?.totalToolCalls, act?.totalErrors, act?.totalCheckpoints, act?.estSteps, act?.recentSteps?.length, act?.recentSteps?.[0]?.stepFingerprint || act?.recentSteps?.[0]?.timestamp || ''],
            [dailyLedger.dateKey, dailyLedger.getTodayActive().map(b => `${b.accountEmail}:${b.totalCalls}:${b.totalInputTokens}:${b.totalOutputTokens}:${b.totalCacheRead}:${b.totalEstimatedCost.toFixed(6)}`), dailyLedger.getSettledEntries().map(s => `${s.accountEmail}:${s.settledAt}:${s.totalCalls}:${s.totalInputTokens}:${s.totalOutputTokens}:${s.totalEstimatedCost.toFixed(6)}`)],
            cachedCliDays.map(d => `${d.date}:${d.calls}:${d.totalTokens}:${d.estimatedCost.toFixed(6)}`),
            billingDaysMap, settings, pricingStore.getCustom(), panelHintPrefs, zoomLevel,
            appSettings.orchestratorPricingMode, appSettings.displayCurrency, appSettings.customFxRate, appSettings.customFxCurrency,
            subscriptionPlan, appSettings.subscriptionMonthlyFee, appSettings.subscriptionCurrency,
            appSettings.contextPctBasis, appSettings.speedMetricMode, appSettings.quotaWindowMode, appSettings.quotaDirectionMode,
            appSettings.appShowNativeHudBar, appSettings.nativeHudAutoHideOnOverview, appSettings.cdpOverlayFontSize, appSettings.cdpOverlayHighContrast, Boolean(appSettings.appOnboardingDismissed),
            grp ? `${grp.rootId}:${grp.memberIds.length}:${grp.activeMemberIds.length}` : '',
            lastSwarmGroupCost ? `${lastSwarmGroupCost.rootId}:${lastSwarmGroupCost.inclusiveGroupCostUsd.toFixed(6)}:${lastSwarmGroupCost.uniqueCallCount}` : '',
            `${cdp.state}:${cdp.diagnosticCode ?? ''}:${cdp.composerEnabled}:${cdp.topBarEnabled}:${cdp.targetUrl ?? ''}:${cdp.targetTitle ?? ''}:${cdp.discoveredPort ?? ''}:${cdp.portFilePath ?? ''}:${cdp.errorMessage ?? ''}:${cdp.hostHasDebugFlag ?? ''}:${cdp.launcherStatus?.installed ? 1 : 0}:${cdp.launcherStatus?.launcherPath ?? ''}`,
            lastUpdateStatusView ? `${lastUpdateStatusView.status}:${lastUpdateStatusView.latestVersion ?? ''}:${lastUpdateStatusView.hasUpdate}:${lastUpdateStatusView.requiresReload ?? false}:${lastUpdateStatusView.error ?? ''}` : '',
            `${calendarYear}-${calendarMonth}-${dailyStore.totalDays}-${calendarSourceFilter}-${calendarMetricMode}-${calendarPeriodMode}-${calendarViewMode ?? 'both'}-${calendarSelectedDate}`,
        ]);
    }

    // ── Core Poll Cycle ──────────────────────────────────────────────────────

    async function runPollCycle(isManualRefresh = false): Promise<void> {
        if (disposed) { return; }
        if (isPolling && activePollPromise) { return activePollPromise; }
        isPolling = true;
        const discoverAppLs = () => deps.discoverLS({ preferredSurface: 'app', workspaceUri: activeWorkspaceUris[0], signal: abortController.signal, log });
        const fetchAllTraj = (ls: LSInfo, epoch: number, cache: PollRpcCache) => cache.getOrFetch(
            { backendEpoch: epoch, authority: getLsAuthority(ls), method: 'GetAllCascadeTrajectories' },
            (sig) => deps.getAllTrajectories(ls, sig),
            abortController.signal,
        );
        const exec = withTrajectoryPollBudget({ ...DEFAULT_SWARM_POLL_BUDGET, ...options.swarmPollBudget }, async () => {
            const nowMs = deps.now();
            const pollRpcCache = new PollRpcCache();
            try {
                syncFromDurableStateIfChanged();
                await withoutTrajectoryPollBudget(() => performDailyArchivalAsync());
                await refreshCliUsageCacheAsync(false);

                let lsInfo = cachedLsInfo;
                let pollEpoch = backendEpoch;
                if (!lsInfo) {
                    lsInfo = await discoverAppLs();
                    cachedLsInfo = lsInfo;
                    lsRevalidationCounter = 0;
                    if (!lsInfo) {
                        consecutiveFailures++;
                        userStatusGuard.recordFailure('Antigravity App language server not found');
                        trajectoriesGuard.recordFailure('Antigravity App language server not found');
                        if (!trajectoriesGuard.hasData()) { monitorStatus = { state: 'disconnected', backendIssue: 'notFound' }; }
                        return;
                    }
                    pollEpoch = backendEpoch;
                    await fetchAndApplyUserStatus(lsInfo, nowMs, pollEpoch, pollRpcCache);
                    if (disposed || backendEpoch !== pollEpoch) { return; }
                    await Promise.allSettled([syncCheckpointerLimitsOnce(lsInfo, modelMetadataGeneration), refreshAuxiliaryMetadata(lsInfo, modelMetadataGeneration)]);
                } else {
                    if (lsInfo.source !== 'env' && ++lsRevalidationCounter >= LS_REVALIDATION_INTERVAL) {
                        lsRevalidationCounter = 0;
                        try {
                            const freshLs = await discoverAppLs();
                            if (freshLs && !isSameLSConnection(freshLs, lsInfo)) {
                                log(`[sidecar-runtime] LS reconnected: port=${lsInfo.port} -> ${freshLs.port}`);
                                lsInfo = cachedLsInfo = freshLs;
                                advanceAllWindowsBackendEpoch(backendEpoch + 1);
                                pollEpoch = backendEpoch;
                                invalidateLiveModelMetadata();
                                await fetchAndApplyUserStatus(lsInfo, nowMs, pollEpoch, pollRpcCache);
                                if (disposed || backendEpoch !== pollEpoch) { return; }
                            }
                        } catch { /* keep current LS */ }
                    }
                    if (++statusPollCount >= STATUS_REFRESH_INTERVAL || pollCount === 0 || isManualRefresh) {
                        statusPollCount = 0;
                        await fetchAndApplyUserStatus(lsInfo, nowMs, pollEpoch, pollRpcCache);
                        if (disposed || backendEpoch !== pollEpoch) { return; }
                        await Promise.allSettled([syncCheckpointerLimitsOnce(lsInfo, modelMetadataGeneration), refreshAuxiliaryMetadata(lsInfo, modelMetadataGeneration)]);
                    }
                }

                let trajectories: TrajectorySummary[];
                try {
                    trajectories = await fetchAllTraj(lsInfo, pollEpoch, pollRpcCache);
                    if (disposed || backendEpoch !== pollEpoch) { return; }
                    trajectoriesGuard.recordSuccess(trajectories, nowMs);
                } catch (firstErr) {
                    log('[sidecar-runtime] GetAllCascadeTrajectories failed; rediscovering LS');
                    invalidateLiveModelMetadata();
                    const rediscovered = await discoverAppLs();
                    cachedLsInfo = rediscovered;
                    if (!rediscovered) {
                        consecutiveFailures++;
                        trajectoriesGuard.recordFailure(firstErr);
                        if (!trajectoriesGuard.hasData()) { monitorStatus = { state: 'disconnected', backendIssue: 'lost' }; }
                        return;
                    }
                    lsInfo = rediscovered;
                    advanceAllWindowsBackendEpoch(backendEpoch + 1);
                    pollEpoch = backendEpoch;
                    await fetchAndApplyUserStatus(lsInfo, nowMs, pollEpoch, pollRpcCache);
                    if (disposed || backendEpoch !== pollEpoch) { return; }
                    try {
                        trajectories = await fetchAllTraj(lsInfo, pollEpoch, pollRpcCache);
                        if (disposed || backendEpoch !== pollEpoch) { return; }
                        trajectoriesGuard.recordSuccess(trajectories, nowMs);
                    } catch (secondErr) {
                        consecutiveFailures++;
                        trajectoriesGuard.recordFailure(secondErr);
                        if (!trajectoriesGuard.hasData()) { monitorStatus = { state: 'disconnected', backendIssue: 'lost' }; }
                        return;
                    }
                }

                consecutiveFailures = 0;
                allTrajectories = trajectories;

                // Track brand-new trajectories appearing after the initial baseline scan
                const nextNewlyCreated = new Set<string>();
                if (hasCompletedInitialTrajectoryScan) {
                    for (const tr of trajectories) {
                        if (tr.cascadeId && !seenTrajectoryIds.has(tr.cascadeId)) {
                            nextNewlyCreated.add(tr.cascadeId);
                        }
                    }
                }
                latestNewlyCreatedIds = nextNewlyCreated;
                // Sweep read-only allowlisted swarm manifests & reconcile authoritative topology before resolution
                await refreshSwarmTopology(trajectories, nowMs);
                if (disposed || backendEpoch !== pollEpoch) { return; }

                const selection = getOrCreateWindowSelectionState(activeWindowId);
                const inspected = selection.inspectedMemberId;
                trajectories = await withTrajectoryRequestShare(() => swarmMemberInventory.expand(
                    trajectories, lastSwarmTopology, [inspected, pinnedConversationId, selection.lockedRootId, hostConversationId, trackedCascadeId],
                    inspected, id => deps.readUnlistedMemberStepCount(lsInfo!, id, abortController.signal,
                        () => fetchGmMetaCached(lsInfo!, id, 'manifest-member', pollEpoch, pollRpcCache)), nowMs,
                ));
                if (disposed || backendEpoch !== pollEpoch) { return; }
                allTrajectories = trajectories;
                reconcileHostFocusBeforeResolution(trajectories, nowMs);
                for (const tr of trajectories) {
                    if (tr.cascadeId) {
                        seenTrajectoryIds.add(tr.cascadeId);
                    }
                }
                hasCompletedInitialTrajectoryScan = true;

                if (trajectories.length === 0) {
                    const emptyResolved = recomputeConversationResolution();
                    clearActiveConversationTelemetry(emptyResolved.hostPending ? emptyResolved.cascadeId : null, nowMs);
                    if (!emptyResolved.hostPending) {
                        monitorStatus = { state: 'empty' };
                    }
                    return;
                }

                // 3. Resolve target conversation (pin -> lock-to-main -> hostConversationId -> new main -> workspace/latest)
                const prevActiveId = lastResolution.cascadeId;
                const resolved = recomputeConversationResolution();
                if (resolved.cascadeId !== prevActiveId) {
                    selectionRevision++;
                }
                const pollSelGen = selectionGeneration;
                const activeTrajectory = findResolvedTrajectory(resolved);
                if (resolved.hostPending || !activeTrajectory) {
                    clearActiveConversationTelemetry(resolved.hostPending ? resolved.cascadeId : null, nowMs);
                    if (!resolved.hostPending) {
                        monitorStatus = { state: 'empty' };
                    }
                    return;
                }

                // 4. Fetch active conversation context usage, breakdown, turn diagnostics, runways
                const isSwitchingConversation = Boolean(currentUsage && currentUsage.cascadeId !== activeTrajectory.cascadeId);
                try {
                    await refreshActiveConversationTelemetry(lsInfo, activeTrajectory, nowMs, pollEpoch, pollSelGen, pollRpcCache);
                } catch (err) {
                    // Outer catch guard: ONLY clear pending state if this target is still current!
                    if (
                        isSwitchingConversation
                        && !disposed
                        && backendEpoch === pollEpoch
                        && selectionGeneration === pollSelGen
                        && lastResolution.cascadeId === activeTrajectory.cascadeId
                    ) {
                        clearActiveConversationTelemetry(activeTrajectory.cascadeId, nowMs);
                    }
                    throw err;
                }

                if (disposed || backendEpoch !== pollEpoch) { return; }

                // 5. Record usage snapshot in MonitorStore (guarded by epoch & selection generation)
                if (currentUsage && selectionGeneration === pollSelGen && currentUsage.cascadeId === activeTrajectory.cascadeId) {
                    const existing = allTrajectoryUsages.filter(u => u.cascadeId !== currentUsage!.cascadeId);
                    allTrajectoryUsages = [currentUsage, ...existing].slice(0, 10);
                    monitorStore.record(allTrajectoryUsages, currentUsage.cascadeId);
                    allTrajectoryUsages = monitorStore.getAll();
                }

                // Coordinator and inspected members get the first background slots. Leave wire capacity for activity and GM.
                try {
                    await withTrajectoryRequestShare(() => runSwarmSchedulerTick(lsInfo!, trajectories, nowMs, pollEpoch, pollRpcCache));
                } catch { /* topology samples are optional */ }
                if (disposed || backendEpoch !== pollEpoch) { return; }
                const groupIds = lastSwarmTopology.groupsByRootId.get(lastResolution.rootCascadeId ?? activeTrajectory.cascadeId)?.memberIds ?? [];
                const telemetryOrder = orderTelemetryPoll(trajectories, [activeTrajectory.cascadeId, lastResolution.rootCascadeId,
                    ...gmTracker.getUnmeasuredMemberIds(groupIds)], pollCount);

                // 6. Activity + GM + DailyLedger pipeline (non-critical failures isolated; guarded across EVERY await)
                try {
                    // The roster can discover a large historical transcript. Its
                    // cost comes from lightweight GM; do not replay old activity.
                    const activityOrder = telemetryOrder.filter(tr => !tr.manifestMember || tr.cascadeId === activeTrajectory.cascadeId);
                    const activityChanged = await withTrajectoryRequestShare(() => deps.processActivity
                        ? deps.processActivity(lsInfo!, activityOrder, abortController.signal)
                        : activityTracker.processTrajectories(
                            lsInfo!,
                            activityOrder.map(tr => ({
                                cascadeId: tr.cascadeId,
                                stepCount: tr.stepCount,
                                status: tr.status,
                                requestedModel: tr.requestedModel,
                                generatorModel: tr.generatorModel,
                            })),
                            abortController.signal,
                        ));
                    if (disposed || backendEpoch !== pollEpoch) { return; }
                    if (activityChanged) {
                        activityChangeSeq++;
                    }

                    if (isManualRefresh) {
                        gmTracker.clearErrorBackoff();
                    }

                    try {
                        const gmSummary = deps.fetchGM
                            ? await deps.fetchGM(lsInfo, telemetryOrder, activeTrajectory.cascadeId, abortController.signal)
                            : await gmTracker.fetchAll(
                                lsInfo,
                                telemetryOrder.map(tr => ({
                                    cascadeId: tr.cascadeId,
                                    title: tr.summary || tr.cascadeId.slice(0, 8),
                                    manifestMember: tr.manifestMember,
                                    stepCount: tr.stepCount,
                                    status: tr.status,
                                })),
                                activeTrajectory.cascadeId,
                                abortController.signal,
                                async id => requireGeneratorMetadata(await fetchGmMetaCached(lsInfo!, id, 'manifest-member', pollEpoch, pollRpcCache)),
                            );
                        if (disposed || backendEpoch !== pollEpoch) { return; }
                        if (gmSummary) {
                            const detailed = deps.fetchGM ? gmSummary : (gmTracker.getDetailedSummary() || gmSummary);
                            lastGMSummary = detailed;
                            if (!deps.fetchGM) {
                                monitorStore.recordGMConversations(gmTracker.getAllConversationData());
                            }
                            const mergedDNA = mergeModelDNAState(persistedModelDNA, detailed);
                            if (mergedDNA.changed) {
                                persistedModelDNA = mergedDNA.entries;
                                void globalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
                            }
                        }
                    } catch { /* Non-critical GM fetch failure */ }

                    if (disposed || backendEpoch !== pollEpoch) { return; }

                    try {
                        const { entries: newEntries, revertedCascadeIds } = gmTracker.getNewCallsSinceLastRecord();
                        for (const cid of revertedCascadeIds) {
                            dailyLedger.clearRecordedIdsForConversation(cid);
                        }
                        if (newEntries.length > 0) {
                            dailyLedger.normalizeIfStaleEmpty();
                            const enrichedNew = enrichLedgerEntriesForIngestion(newEntries, {
                                trajectories,
                                activeCascadeId: activeTrajectory.cascadeId,
                                activeWorkspaceUri: activeWorkspaceUris[0],
                                fallbackAuthority: options.remoteAuthority || 'local',
                                fallbackAccount: cachedUserInfo?.email || currentAccountEmail,
                            });
                            const detailedRec = dailyLedger.recordCallsDetailed(enrichedNew, 'app');
                            gmTracker.markLedgerEntriesRecorded(newEntries, detailedRec.statuses);
                            if (detailedRec.added > 0) {
                                lastGmCallActivityMs = deps.now();
                                void globalState.update('dailyLedgerState', dailyLedger.serialize());
                            }
                        }
                        if (revertedCascadeIds.length > 0) {
                            void globalState.update('dailyLedgerState', dailyLedger.serialize());
                        }
                        const reconciled = dailyLedger.reconcileRecordedCalls(gmTracker.getLedgerReconciliationEntries());
                        if (reconciled > 0) {
                            void globalState.update('dailyLedgerState', dailyLedger.serialize());
                        }
                        if (dailyLedger.getLateDaySnapshots().length > 0) {
                            const flushedLate = await flushLateDaysToDailyStoreAsync(
                                dailyLedger,
                                dailyStore,
                                pricingStore.getCustom(),
                                'app',
                                log,
                                appSettings.orchestratorPricingMode,
                                async () => (await durableState.flush()).committed,
                            );
                            if (flushedLate > 0) {
                                void globalState.update('dailyLedgerState', dailyLedger.serialize());
                                bumpStateRevision();
                            }
                        }
                    } catch { /* Non-critical ledger error */ }

                    if (disposed || backendEpoch !== pollEpoch) { return; }

                    // Proactive settlement for expired pools
                    for (const snap of accountSnapshots.values()) {
                        if (!snap.isActive) {
                            baselineExpiredPoolsForAccount(snap.email);
                        }
                    }

                    if (lastGMSummary) {
                        try {
                            activityTracker.injectGMData(lastGMSummary);
                        } catch { /* Non-critical timeline injection failure */ }
                        // Guard active-conversation mutations against mid-poll switch / epoch change
                        const selectionStillCurrent =
                            backendEpoch === pollEpoch
                            && selectionGeneration === pollSelGen
                            && lastResolution.cascadeId === activeTrajectory.cascadeId;
                        if (selectionStillCurrent && currentUsage && currentUsage.cascadeId === activeTrajectory.cascadeId) {
                            const gmFallbackOpts = buildGMFallbackOptions(
                                activeTrajectory.stepCount,
                                branchStepPeaks.get(activeTrajectory.cascadeId)?.lastObservedStepCount,
                                contextBreakdownCascadeId === activeTrajectory.cascadeId ? contextBreakdown : null,
                                currentUsage.compressionDetected,
                            );
                            applyGMContextToUsage(
                                currentUsage,
                                getLatestGMContextUsedForCascade(lastGMSummary, activeTrajectory.cascadeId, { ...gmFallbackOpts, minTimestampMs: minGmTimestampByCascade.get(activeTrajectory.cascadeId) }),
                            );
                        }
                        // If raw GM entries were empty, refresh turnDiagnostics from GMTracker calls
                        if (selectionStillCurrent && cachedRawGmEntries.length === 0 && turnDiagnosticsCascadeId === activeTrajectory.cascadeId) {
                            const convCalls = lastGMSummary.conversations.find(c => c.cascadeId === activeTrajectory.cascadeId)?.calls || [];
                            if (convCalls.length > 0) {
                                turnDiagnostics = analyzeTurnDiagnostics(convCalls);
                            }
                        }
                    }

                    if (activityChanged || nowMs - lastActivityPersistTime > 30_000) {
                        void globalState.update('activityTrackerState', activityTracker.serialize());
                        void globalState.update('gmTrackerState', gmTracker.serialize());
                        if (lastGMSummary) {
                            void globalState.update('gmDetailedSummary', slimSummaryForPersistence(lastGMSummary));
                        }
                        lastActivityPersistTime = nowMs;
                    }
                } catch {
                    // Isolate non-critical activity/GM errors so core context & quota stay live
                }

                if (!disposed && backendEpoch === pollEpoch) { computeActiveSwarmGroupCost(); }
            } finally {
                pollRpcCache.abortAll();
                pollCount++;
                const nextSig = computeDataSignature();
                if (isManualRefresh || pollCount === 1 || nextSig !== lastDataSignature) {
                    if (nextSig !== lastDataSignature) {
                        dataRevision++;
                    }
                    lastDataSignature = nextSig;
                    lastPollAtMs = nowMs;
                    lastUpdatedTime = formatClockTime(new Date(nowMs), getLanguage());
                    bumpStateRevision();
                }
                // Publish ONE frozen observation for this poll/dataRevision before pushing overlay payload
                publishCurrentObservation(nowMs);
                pushOverlayPayloadAsync(nowMs);
                isPolling = false;
                activePollPromise = null;
            }
        });
        activePollPromise = exec;
        return exec;
    }

    function computeNextPollDelayMs(): number {
        const baseMs = clamp(settings.pollingInterval, 1, 60) * 1000;
        if (consecutiveFailures > 0) {
            const cap = cachedLsInfo ? MAX_BACKOFF_INTERVAL_MS : MAX_DISCOVERY_BACKOFF_MS;
            return Math.min(baseMs * Math.pow(2, consecutiveFailures - 1), cap);
        }
        if (allTrajectories.some(tr => tr.status === CascadeStatus.RUNNING)) {
            return baseMs;
        }
        const idleMs = deps.now() - lastClientActivityMs;
        if (idleMs > idleThresholdMs) {
            return Math.max(baseMs, idlePollIntervalMs);
        }
        return baseMs;
    }

    function scheduleNextPoll(): void {
        if (disposed || isPaused || options.autoStart === false) {
            return;
        }
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
        const myGen = ++pollGeneration;
        const delayMs = computeNextPollDelayMs();
        scheduledPollDelayMs = delayMs;
        pollTimer = setTimeout(() => {
            pollTimer = undefined;
            if (disposed || isPaused || myGen !== pollGeneration) { return; }
            void runPollCycle(false).finally(() => {
                if (!disposed && !isPaused && myGen === pollGeneration) {
                    scheduleNextPoll();
                }
            });
        }, delayMs);
        if (typeof pollTimer.unref === 'function') {
            pollTimer.unref();
        }
    }

    // ── Document Params & Snapshot Builders ──────────────────────────────────

    function getStorageDiagnostics(): StorageDiagnostics {
        const stateFilePath = durableState.getFilePath();
        const stateFileExists = durableState.exists();
        let stateFileSizeBytes = 0;
        try {
            stateFileSizeBytes = stateFileExists ? fs.statSync(stateFilePath).size : 0;
        } catch { /* ignore */ }
        return {
            stateFilePath,
            stateFileExists,
            stateFileSizeBytes,
            stateFileOpenWarnBytes: LARGE_STATE_FILE_WARN_BYTES,
            calendarDayCount: dailyStore.totalDays || 0,
        };
    }

    function redactStrs(arr?: readonly unknown[]) { return arr?.map(v => redactTextForPrivacy(String(v ?? ''))); }
    function redactCheckpoints<T extends { fullText?: string }>(arr?: readonly T[]) { return arr?.map(cp => ({ ...cp, fullText: cp.fullText ? '[Redacted]' : '' })); }
    function redactSysItems<T extends { label?: string; fullText?: string }>(arr?: readonly T[]) { return arr?.map(it => ({ ...it, label: redactTextForPrivacy(it.label || ''), fullText: it.fullText ? '[Redacted]' : '' })); }
    function redactGroups<T extends { name?: string; children?: Array<{ name?: string }> }>(arr?: readonly T[]) { return arr?.map(g => ({ ...g, name: redactTextForPrivacy(g.name || ''), children: (g.children || []).map(ch => ({ ...ch, name: redactTextForPrivacy(ch.name || '') })) })); }

    function redactGMCallForPrivacy(call: GMCallEntry): GMCallEntry {
        const aiSnips = call.aiSnippetsByStep && typeof call.aiSnippetsByStep === 'object'
            ? Object.fromEntries(Object.entries(call.aiSnippetsByStep).map(([k, v]) => [k, redactTextForPrivacy(String(v ?? ''))]))
            : call.aiSnippetsByStep;
        return {
            ...call,
            ...(call.accountEmail ? { accountEmail: getAccountHandle(call.accountEmail) } : {}),
            ...(call.errorMessage ? { errorMessage: redactTextForPrivacy(call.errorMessage) } : {}),
            ...(Array.isArray(call.retryErrors) ? { retryErrors: redactStrs(call.retryErrors) } : {}),
            ...(call.systemPromptSnippet ? { systemPromptSnippet: redactTextForPrivacy(call.systemPromptSnippet) } : {}),
            ...(call.promptSnippet ? { promptSnippet: redactTextForPrivacy(call.promptSnippet) } : {}),
            ...(Array.isArray(call.promptSectionTitles) ? { promptSectionTitles: redactStrs(call.promptSectionTitles) } : {}),
            ...(Array.isArray(call.userMessageAnchors) ? { userMessageAnchors: call.userMessageAnchors.map(a => ({ ...a, text: redactTextForPrivacy(a.text || '') })) } : {}),
            ...(aiSnips !== undefined ? { aiSnippetsByStep: aiSnips } : {}),
            ...(Array.isArray(call.checkpointSummaries) ? { checkpointSummaries: redactCheckpoints(call.checkpointSummaries) } : {}),
            ...(Array.isArray(call.systemContextItems) ? { systemContextItems: redactSysItems(call.systemContextItems) } : {}),
            ...(Array.isArray(call.tokenBreakdownGroups) ? { tokenBreakdownGroups: redactGroups(call.tokenBreakdownGroups) } : {}),
        };
    }

    function redactGMConversationDataForPrivacy(conv: GMConversationData): GMConversationData {
        return {
            ...conv,
            title: redactTextForPrivacy(conv.title || ''),
            calls: (conv.calls || []).map(redactGMCallForPrivacy),
            checkpointSummaries: redactCheckpoints(conv.checkpointSummaries || [])!,
            ...(Array.isArray(conv.systemContextItems) ? { systemContextItems: redactSysItems(conv.systemContextItems) } : {}),
        };
    }

    function redactModelBreakdown<T extends { promptSectionTitles?: unknown[] }>(mb?: Record<string, T>): Record<string, T> {
        return Object.fromEntries(Object.entries(mb || {}).map(([k, st]) => [
            k, { ...st, ...(Array.isArray(st.promptSectionTitles) ? { promptSectionTitles: redactStrs(st.promptSectionTitles) } : {}) },
        ])) as Record<string, T>;
    }

    function redactGMSummaryForPrivacy(summary: GMSummary | null): GMSummary | null {
        if (!summary) { return null; }
        const redactErrEntries = <T extends { message?: string }>(arr?: readonly T[]) => arr?.map(e => ({ ...e, message: redactTextForPrivacy(e.message || '') }));
        return {
            ...summary,
            conversations: (summary.conversations || []).map(redactGMConversationDataForPrivacy),
            modelBreakdown: redactModelBreakdown(summary.modelBreakdown),
            ...(Array.isArray(summary.latestTokenBreakdown) ? { latestTokenBreakdown: redactGroups(summary.latestTokenBreakdown) } : {}),
            ...(Array.isArray(summary.recentErrors) ? { recentErrors: redactStrs(summary.recentErrors) } : {}),
            ...(Array.isArray(summary.recentErrorEntries) ? { recentErrorEntries: redactErrEntries(summary.recentErrorEntries) } : {}),
            ...(Array.isArray(summary.uniqueErrors) ? { uniqueErrors: redactErrEntries(summary.uniqueErrors) } : {}),
        };
    }

    function redactGMConversationsForPrivacy(convs: Record<string, GMConversationData>): Record<string, GMConversationData> {
        return Object.fromEntries(Object.entries(convs || {}).map(([cid, conv]) => [cid, redactGMConversationDataForPrivacy(conv)]));
    }

    function redactStepEventForPrivacy(step: StepEvent): StepEvent {
        const out: StepEvent = { ...step };
        for (const k of ['detail', 'userInput', 'fullUserInput', 'aiResponse', 'fullAiResponse', 'browserSub', 'gmPromptSnippet'] as const) {
            if (typeof out[k] === 'string') { out[k] = redactTextForPrivacy(out[k] as string); }
        }
        return out;
    }

    function redactStaleStateForPrivacy(stale: SidecarStaleState): SidecarStaleState {
        const redErr = <T extends { lastError?: string | null }>(s: T): T => (typeof s.lastError === 'string' ? { ...s, lastError: redactTextForPrivacy(s.lastError) } : s);
        return {
            ...redErr(stale),
            ...(stale.sources ? { sources: { userStatus: redErr(stale.sources.userStatus), trajectories: redErr(stale.sources.trajectories) } } : {}),
        };
    }

    function buildRedactedDailyStore(snap: DailyStoreState): DailyStore {
        const clone = new DailyStore(dailyStore.maxDays);
        clone.restoreSnapshot(snap);
        return clone;
    }

    function redactUsageForPrivacy(u: ContextUsage | null): ContextUsage | null {
        return u ? { ...u, title: redactTextForPrivacy(u.title || ''), repositoryName: u.repositoryName ? '[Redacted Repo]' : '', branchName: u.branchName ? '[Redacted Branch]' : '', gitOriginUrl: '', gitRootUri: '' } : null;
    }

    function redactTrajectoryForPrivacy(tr: TrajectorySummary): TrajectorySummary {
        return { ...tr, summary: redactTextForPrivacy(tr.summary || ''), workspaceUris: (tr.workspaceUris || []).length > 0 ? ['[Redacted Workspace]'] : [], repositoryName: tr.repositoryName ? '[Redacted Repo]' : '', branchName: tr.branchName ? '[Redacted Branch]' : '', gitOriginUrl: '', gitRootUri: '' };
    }

    function redactCdpStatusForPrivacy(cdp: CdpStatus): CdpStatus {
        return {
            ...cdp,
            ...(cdp.targetUrl ? { targetUrl: '[Redacted Target]' } : {}),
            ...(cdp.portFilePath ? { portFilePath: '[Redacted Path]' } : {}),
            ...(cdp.targetTitle ? { targetTitle: redactTextForPrivacy(cdp.targetTitle) } : {}),
            ...(cdp.errorMessage ? { errorMessage: redactTextForPrivacy(cdp.errorMessage) } : {}),
            ...(cdp.launcherStatus ? {
                launcherStatus: {
                    ...cdp.launcherStatus,
                    launcherPath: cdp.launcherStatus.launcherPath ? '[Redacted Path]' : '',
                    ...(cdp.launcherStatus.targetAppPath ? { targetAppPath: '[Redacted Path]' } : {}),
                    safeTerminalCommand: redactTextForPrivacy(cdp.launcherStatus.safeTerminalCommand || ''),
                    noteEn: redactTextForPrivacy(cdp.launcherStatus.noteEn || ''),
                    noteZh: redactTextForPrivacy(cdp.launcherStatus.noteZh || ''),
                },
            } : {}),
        };
    }

    function redactBillingDaysForPrivacy(raw: Record<string, number>): Record<string, number> {
        return Object.fromEntries(Object.entries(raw).map(([e, d]) => [getAccountHandle(e), d]));
    }

    function opaqueLedgerIdentity(value: string): string {
        const accountHandle = emailToHandle.get(value.toLowerCase());
        if (accountHandle) { return accountHandle; }
        // Workspace keys and call IDs remain case-sensitive. Never insert them
        // into the mutable account lookup used by billing actions.
        return 'id_' + crypto.createHmac('sha256', privacyHandleSalt).update(value).digest('hex').slice(0, 16);
    }

    function redactWorkspaceStats(stats?: Record<string, WorkspaceUsageStats>) {
        return stats && Object.fromEntries(Object.entries(stats).map(([key, value]) => [
            key === '__unattributed__' ? key : opaqueLedgerIdentity(key),
            { ...value, authority: value.authority && opaqueLedgerIdentity(value.authority) },
        ]));
    }

    function redactLedgerCall(call: LedgerRecordedCall): LedgerRecordedCall {
        return {
            ...call, callId: opaqueLedgerIdentity(call.callId), account: call.account && opaqueLedgerIdentity(call.account),
            authority: call.authority && opaqueLedgerIdentity(call.authority), cascadeId: call.cascadeId && opaqueLedgerIdentity(call.cascadeId),
            workspace: call.workspace && (call.workspace === '__unattributed__' ? call.workspace : opaqueLedgerIdentity(call.workspace)),
        };
    }

    function redactActiveLedgerBucket(bucket: LedgerAccountBucket): LedgerAccountBucket {
        return {
            ...bucket, accountEmail: bucket.accountEmail ? getAccountHandle(bucket.accountEmail) : '',
            workspaceBreakdown: redactWorkspaceStats(bucket.workspaceBreakdown),
            recordedCalls: bucket.recordedCalls.map(redactLedgerCall),
            recordedCallIds: bucket.recordedCallIds.map(opaqueLedgerIdentity),
        };
    }

    function redactSettledLedgerEntry(entry: LedgerSettledEntry): LedgerSettledEntry {
        return {
            ...entry, accountEmail: entry.accountEmail ? getAccountHandle(entry.accountEmail) : '',
            workspaceBreakdown: redactWorkspaceStats(entry.workspaceBreakdown),
            settledCalls: entry.settledCalls?.map(redactLedgerCall),
            recordedCallIds: entry.recordedCallIds?.map(opaqueLedgerIdentity),
        };
    }

    function redactDailyStoreSnapshotForPrivacy(snap: DailyStoreState): DailyStoreState {
        return {
            ...snap,
            records: Object.fromEntries(Object.entries(snap.records || {}).map(([dk, rec]) => [
                dk, redactDailyRecordIdentities(rec, opaqueLedgerIdentity),
            ])),
        };
    }

    function redactContextBreakdownForPrivacy(bd: ContextBreakdownSnapshot | null): ContextBreakdownSnapshot | null {
        if (!bd) { return null; }
        const redItems = <T extends { title: string }>(arr?: readonly T[]) => (arr || []).map(it => ({ ...it, title: redactTextForPrivacy(it.title) }));
        return { ...bd, segments: (bd.segments || []).map(seg => ({ ...seg, topItems: redItems(seg.topItems) })), largestItems: redItems(bd.largestItems) };
    }

    function buildDocumentParams(
        viewMode: SidecarViewMode,
        langOverride?: Language,
        privacyMaskedOverride?: boolean,
        requestedWindowId?: string,
    ): SidecarDocumentParams {
        const lang = langOverride ?? getLanguage();
        const nowMs = deps.now();
        const explicitWinId = extractExplicitWindowId(requestedWindowId);
        const winId = explicitWinId && windowSelectionStates.has(explicitWinId) ? explicitWinId : activeWindowId;
        const effectivePrivacyMasked = typeof privacyMaskedOverride === 'boolean'
            ? privacyMaskedOverride
            : isPrivacyMaskedForWindow(explicitWinId);
        const active = winId === activeWindowId;
        const curWin = getOrCreateWindowSelectionState(winId);
        const resolution = active ? lastResolution : resolveWindowState(curWin).resolution;
        const subjectId = resolution.cascadeId;
        const usage = subjectId && !resolution.hostPending
            ? (currentUsage?.cascadeId === subjectId ? currentUsage : monitorStore.getSnapshot(subjectId)) ?? null : null;
        const displayBreakdown = subjectId && contextBreakdownCascadeId === subjectId ? contextBreakdown : null;
        const displayDiagnostics = subjectId && turnDiagnosticsCascadeId === subjectId ? turnDiagnostics : null;
        const displayLock = Boolean(curWin.lockToMainAgent);
        const options = active ? conversationOptions : buildConversationOptions(allTrajectories, subjectId, curWin.lockedRootId, {
            workspaceUris: activeWorkspaceUris, knownSubagentIds: getEffectiveKnownSubagentIds(), lang,
        });
        const uiGmSummary = getActiveUiGmSummary();
        const uiGmFullSummary = deps.fetchGM ? uiGmSummary : (gmTracker.getUiFullSummary() || uiGmSummary);
        const isPendingOrEmptyNewChat = Boolean(
            resolution.hostPending || (usage && usage.stepCount === 0 && !usage.lastModelUsage),
        );
        const costs = computeLiveCostSnapshot(
            uiGmSummary,
            subjectId ?? undefined,
            isPendingOrEmptyNewChat,
        );
        const staleState = getCombinedStaleState(nowMs);
        const activeEmail = selectedAccountKey || cachedUserInfo?.email || currentAccountEmail || '';
        const activeAccountHandle = activeEmail ? getAccountHandle(activeEmail) : '';
        const customPricing = pricingStore.getCustom();

        const snapArray = formatAccountSnaps(effectivePrivacyMasked);

        const rawTodayLedgerActive = dailyLedger.getTodayActive();
        const rawLedgerSettled = dailyLedger.getSettledEntries();
        const todayLedgerActive = effectivePrivacyMasked ? rawTodayLedgerActive.map(redactActiveLedgerBucket) : rawTodayLedgerActive;
        const ledgerSettled = effectivePrivacyMasked ? rawLedgerSettled.map(redactSettledLedgerEntry) : rawLedgerSettled;

        const outUserInfo: UserStatusInfo | null = cachedUserInfo
            ? (effectivePrivacyMasked ? { ...cachedUserInfo, name: getRedactedAccountLabel(cachedUserInfo.email), email: '****@redacted', _rawResponse: undefined } : { ...cachedUserInfo })
            : null;

        const outCurrentUsage = effectivePrivacyMasked ? redactUsageForPrivacy(usage) : usage;
        const outAllTrajectoryUsages = effectivePrivacyMasked ? allTrajectoryUsages.map(u => redactUsageForPrivacy(u)!) : allTrajectoryUsages;
        const outAllTrajectories = effectivePrivacyMasked ? allTrajectories.map(redactTrajectoryForPrivacy) : allTrajectories;
        const outConversationOptions: ConversationOption[] = effectivePrivacyMasked
            ? options.map(opt => ({ ...opt, title: redactTextForPrivacy(opt.title), workspaceLabel: opt.workspaceLabel ? '[Redacted Workspace]' : '', ...(opt.branchName ? { branchName: '[Redacted Branch]' } : {}) }))
            : options;
        const outContextBreakdown = effectivePrivacyMasked ? redactContextBreakdownForPrivacy(displayBreakdown) : displayBreakdown;
        const outGmSummary = effectivePrivacyMasked ? redactGMSummaryForPrivacy(uiGmSummary) : uiGmSummary;
        const outGmFullSummary = effectivePrivacyMasked ? redactGMSummaryForPrivacy(uiGmFullSummary) : uiGmFullSummary;
        const outGmConversations = effectivePrivacyMasked ? redactGMConversationsForPrivacy(monitorStore.getGMConversations()) : monitorStore.getGMConversations();
        const rawActivitySummary = activityTracker.getSummary();
        const outActivitySummary = effectivePrivacyMasked && rawActivitySummary
            ? { ...rawActivitySummary, recentSteps: (rawActivitySummary.recentSteps || []).map(redactStepEventForPrivacy), ...(rawActivitySummary.gmModelBreakdown ? { gmModelBreakdown: redactModelBreakdown(rawActivitySummary.gmModelBreakdown) } : {}) }
            : rawActivitySummary;
        const outStaleState = effectivePrivacyMasked ? redactStaleStateForPrivacy(staleState) : staleState;
        const outBillingDays = effectivePrivacyMasked ? redactBillingDaysForPrivacy(billingDaysMap) : { ...billingDaysMap };
        const outActiveAccountKey = effectivePrivacyMasked ? activeAccountHandle : activeEmail;
        const outWorkspaceUri = effectivePrivacyMasked ? (activeWorkspaceUris.length > 0 ? '[Redacted Workspace]' : '') : (activeWorkspaceUris[0] || '');
        const rawStorageDiag = getStorageDiagnostics();
        const outStorageDiag: StorageDiagnostics = effectivePrivacyMasked ? { ...rawStorageDiag, stateFilePath: '[Redacted State Path]' } : rawStorageDiag;
        const rawCdpStatus = overlayManager.getStatus();
        const outCdpStatus = effectivePrivacyMasked ? redactCdpStatusForPrivacy(rawCdpStatus) : rawCdpStatus;
        const rawDailyStoreSnap = dailyStore.serialize();
        const outDailyStoreSnap = effectivePrivacyMasked ? redactDailyStoreSnapshotForPrivacy(rawDailyStoreSnap) : rawDailyStoreSnap;
        const outDailyStore = effectivePrivacyMasked ? buildRedactedDailyStore(outDailyStoreSnap) : dailyStore;
        const outDailyLedger: DailyLedger | { active: LedgerAccountBucket[]; settled: LedgerSettledEntry[] } = effectivePrivacyMasked
            ? { active: todayLedgerActive, settled: ledgerSettled }
            : dailyLedger;

        const maskedSwarmGroups = effectivePrivacyMasked && lastSwarmTopology.groupsByRootId.size > 0
            ? [...lastSwarmTopology.groupsByRootId.values()].map(g => ({
                rootId: opaqueLedgerIdentity(g.rootId),
                memberIds: g.memberIds.map(opaqueLedgerIdentity),
            }))
            : undefined;
        const baseCalendarOptions = buildCalendarRenderOptions(nowMs);
        const calendarOptions: CalendarRenderOptions = effectivePrivacyMasked
            ? {
                ...baseCalendarOptions,
                liveLedger: { active: todayLedgerActive, settled: ledgerSettled, customPricing, defaultSurface: 'app' },
                ...(maskedSwarmGroups ? { swarmGroups: maskedSwarmGroups } : {}),
            }
            : baseCalendarOptions;
        const fullAppSettings = getFullAppSettings(effectivePrivacyMasked);
        const obs = publishCurrentObservation(nowMs, winId, resolution, usage);
        const maskLabel = (raw: string | null) => raw ? (effectivePrivacyMasked ? redactTextForPrivacy(raw) : raw) : null;
        const inspectedMemberLabel = maskLabel(
            (curWin.inspectedMemberId && (lastSwarmTopology.nodesById.get(curWin.inspectedMemberId)?.memberName || allTrajectories.find(tr => tr.cascadeId === curWin.inspectedMemberId)?.summary || curWin.inspectedMemberId.slice(0, 8))) || null,
        );
        const retargetOfferTitle = maskLabel(
            (curWin.retargetOfferId && (allTrajectories.find(tr => tr.cascadeId === curWin.retargetOfferId)?.summary || curWin.retargetOfferId.slice(0, 8))) || null,
        );

        const outWeeklyQuotaRunways: Record<string, WeeklyQuotaRunwayEstimate> = effectivePrivacyMasked
            ? Object.fromEntries(
                Object.entries(weeklyQuotaRunways).map(([k, w]) => [
                    k,
                    { ...w, account: w.account ? getAccountHandle(w.account) : 'default' },
                ]),
            )
            : weeklyQuotaRunways;
        const outPromptCacheTtl: PromptCacheTtlEvaluation | null = active && latestPromptCacheTtl
            ? (effectivePrivacyMasked
                ? (() => {
                    const k = latestPromptCacheTtl.key;
                    const redAcct = k.account ? getAccountHandle(k.account) : 'default';
                    const redKey = { ...k, account: redAcct, branch: '[Redacted Branch]' };
                    return {
                        ...latestPromptCacheTtl,
                        cacheKey: [redAcct, k.backend, k.conversation, k.model, '[Redacted Branch]'].join('|'),
                        key: redKey,
                    };
                })()
                : latestPromptCacheTtl)
            : null;
        const outRecoveryBrief = active && activeRecoveryBrief
            ? formatCompactionRecoveryBriefForPrivacy(activeRecoveryBrief, {
                privacyMasked: effectivePrivacyMasked,
                redactText: redactTextForPrivacy,
                lang,
            })
            : null;
        const outGlobalRulesRaw = readGlobalRulesStatus({ homedir: deps.homedir(), includeContent: false });
        const outGlobalRules: GlobalRulesStatus = {
            ...outGlobalRulesRaw,
            path: effectivePrivacyMasked ? '~/.gemini/GEMINI.md' : outGlobalRulesRaw.path,
            content: '',
        };
        const extras: MonitorDocumentV1175Extras = {
            surface: 'app-sidecar',
            version,
            globalRules: outGlobalRules,
            contextBreakdown: outContextBreakdown,
            turnDiagnostics: displayDiagnostics,
            quotaRunways,
            weeklyQuotaRunways: outWeeklyQuotaRunways,
            weeklyRunways: outWeeklyQuotaRunways,
            promptCacheTtl: outPromptCacheTtl,
            cacheTtl: outPromptCacheTtl,
            recoveryBrief: outRecoveryBrief,
            speedCoverage: active && latestSpeedMetric
                ? { measuredCount: latestSpeedMetric.coverage.measuredCount, totalCount: latestSpeedMetric.coverage.totalCount }
                : null,
            isCustomModelActive,
            staleState: outStaleState,
            conversationOptions: outConversationOptions,
            activeConversationId: subjectId,
            pinnedConversationId: active ? pinnedConversationId : pinsByWindow.get(winId) ?? null,
            lockToMainAgent: displayLock,
            calendarOptions,
            orchestratorPricingMode: appSettings.orchestratorPricingMode,
            appSettings: fullAppSettings,
            cdpStatus: outCdpStatus,
            updateStatus: effectivePrivacyMasked && lastUpdateStatusView?.error ? { ...lastUpdateStatusView, error: updateCheckFailedMsg() } : lastUpdateStatusView,
            privacyMasked: effectivePrivacyMasked,
            accountHandle: activeAccountHandle || undefined,
            observation: obs,
            inspectedMemberId: curWin.inspectedMemberId,
            inspectedMemberLabel,
            lockedRootId: curWin.lockedRootId,
            lockPendingUnavailable: Boolean(curWin.lockPendingUnavailable),
            retargetOfferId: curWin.retargetOfferId ?? null,
            retargetOfferTitle,
            swarmTopology: effectivePrivacyMasked ? {
                ...lastSwarmTopology,
                nodesById: new Map([...lastSwarmTopology.nodesById].map(([id, node]) => [id, {
                    ...node, workspaceDisplay: undefined, conflictDetails: undefined,
                    memberName: node.memberName && redactTextForPrivacy(node.memberName),
                    assignedRole: node.assignedRole && redactTextForPrivacy(node.assignedRole),
                }])),
                groupsByRootId: new Map([...lastSwarmTopology.groupsByRootId].map(([id, group]) => [id, {
                    ...group, title: group.title && redactTextForPrivacy(group.title),
                }])),
                anomalies: lastSwarmTopology.anomalies.map(a => ({ ...a, detail: a.kind })),
            } : lastSwarmTopology,
            swarmGroupCost: active && lastSwarmGroupCost?.rootId === obs.rootCascadeId ? lastSwarmGroupCost : computeWindowSwarmGroupCost(obs.rootCascadeId),
        };

        return {
            ...extras,
            surface: 'app-sidecar',
            version,
            viewMode, language: lang, lastUpdatedTime,
            data: outCurrentUsage, currentUsage: outCurrentUsage,
            allTrajectoryUsages: outAllTrajectoryUsages, allTrajectories: outAllTrajectories,
            userStatus: { configs: cachedModelConfigs, userInfo: outUserInfo },
            userInfo: outUserInfo, modelConfigs: cachedModelConfigs, workspaceUri: outWorkspaceUri,
            gmSummary: outGmSummary, gmFullSummary: outGmFullSummary, gmConversations: outGmConversations,
            activitySummary: outActivitySummary, dailyLedger: outDailyLedger, todayLedgerActive, ledgerSettled,
            dailyStore: outDailyStore, dailyStoreSnapshot: outDailyStoreSnap,
            pricingStore, pricingOverrides: customPricing, customPricing,
            accountSnapshots: snapArray, activeAccountKey: outActiveAccountKey,
            billingDays: outBillingDays, billingDaysMap: outBillingDays,
            orchestratorSettings: cachedOrchestratorSettings, quotaSummary: cachedQuotaSummary,
            todayCostUsd: costs.todayCostUsd > 0 ? costs.todayCostUsd : undefined,
            sessionCostUsd: costs.sessionCostUsd > 0 ? costs.sessionCostUsd : undefined,
            settings: { ...settings, lockToMainAgent: displayLock },
            panelHintPrefs: { ...panelHintPrefs }, panelPrefs: { ...panelHintPrefs },
            zoomLevel, calendarYear, calendarMonth, storageDiagnostics: outStorageDiag,
            modelDNA: persistedModelDNA, isPaused, paused: isPaused,
            backendStatus: monitorStatus, monitorStatus, now: nowMs, extras,
        };
    }

    function renderDocumentHtml(params: SidecarDocumentParams): string {
        if (options.renderDocument) {
            return options.renderDocument(params);
        }
        return buildMonitorDocumentHtml(params);
    }

    function renderTabsPayload(params: SidecarDocumentParams): Record<string, string | boolean> {
        if (options.renderTabs) {
            return options.renderTabs(params);
        }
        return buildMonitorTabsPayload(params);
    }

    function buildQuotaSummaryLines(lang: Language = getLanguage()): ContextQuotaSummaryLine[] {
        if (isCustomModelActive) { return []; }
        const nowMs = deps.now();
        return groupModelConfigsByQuotaPool(cachedModelConfigs)
            .filter((pool): pool is typeof pool & { minFraction: number } => pool.minFraction !== null)
            .map(pool => {
                const rw = quotaRunways[pool.key];
                const runwayLabel = rw?.status === 'safe_until_reset'
                    ? t('quota.safeBeforeReset', lang)
                    : rw?.status === 'at_risk' && rw.estExhaustMs !== null
                        ? `${t('quota.exhaustsIn', lang)} ${Math.max(1, Math.round(rw.estExhaustMs / 60_000))}m`
                        : undefined;
                return {
                    poolName: pool.labels.slice(0, 2).join(', ') || pool.key,
                    remainingPct: Math.round(pool.minFraction * 100),
                    resetCountdown: pool.resetTime ? formatResetCountdown(pool.resetTime, nowMs) : undefined,
                    runwayLabel,
                };
            });
    }

    function buildContextReportText(lang: Language = getLanguage(), masked = true, requestedWindowId?: string): string {
        const explicitWinId = extractExplicitWindowId(requestedWindowId);
        const winKnown = Boolean(explicitWinId && windowSelectionStates.has(explicitWinId));
        const winId = winKnown ? explicitWinId! : activeWindowId;
        const active = winId === activeWindowId && (!explicitWinId || winKnown);
        const effectiveMasked = masked || (Boolean(explicitWinId) && !winKnown && windowSelectionStates.size > 0);
        const curWin = getOrCreateWindowSelectionState(winId);
        const resolution = active
            ? lastResolution
            : (winKnown ? resolveWindowState(curWin).resolution : { cascadeId: null, target: null, hostPending: false });
        const subjectId = resolution.cascadeId;
        const scopedUsage = subjectId && !resolution.hostPending
            ? (currentUsage?.cascadeId === subjectId ? currentUsage : monitorStore.getSnapshot(subjectId) ?? null)
            : null;
        const scopedTraj = subjectId ? allTrajectories.find(tr => tr.cascadeId === subjectId) ?? null : null;
        const scopedBd = subjectId && contextBreakdown && contextBreakdownCascadeId === subjectId ? contextBreakdown : null;
        const scopedTd = subjectId && turnDiagnostics && turnDiagnosticsCascadeId === subjectId ? turnDiagnostics : null;
        const rawSnapshot = scopedBd ?? parseContextBreakdown({
            model: scopedUsage?.model,
            modelDisplayName: scopedUsage?.modelDisplayName,
            effectiveBudgetTokens: scopedUsage?.contextLimit,
            currentStepCount: scopedUsage?.stepCount ?? 0,
        });
        const snapshot = effectiveMasked
            ? redactContextBreakdownForPrivacy(rawSnapshot)!
            : rawSnapshot;
        const rawTitle = scopedUsage?.title || scopedTraj?.summary || resolution.target?.summary || undefined;
        const rawBranch = scopedUsage?.branchName || scopedTraj?.branchName || resolution.target?.branchName || undefined;
        const rawWs = (scopedTraj?.workspaceUris && scopedTraj.workspaceUris[0])
            || (explicitWinId ? workspacesByWindow.get(explicitWinId)?.[0] : undefined)
            || (active ? activeWorkspaceUris[0] : undefined)
            || undefined;
        const report = formatContextTextReport({
            snapshot,
            title: rawTitle ? (effectiveMasked ? redactTextForPrivacy(rawTitle) : rawTitle) : undefined,
            workspacePath: rawWs
                ? (effectiveMasked ? '[Redacted Workspace]' : rawWs)
                : undefined,
            branchName: rawBranch ? (effectiveMasked ? '[Redacted Branch]' : rawBranch) : undefined,
            cacheHitPct: scopedTd?.lastTurnCacheHitPct ?? scopedTd?.sessionCacheHitPct ?? null,
            turnStartKind: scopedTd?.lastTurnStartKind ?? 'unknown',
            quotaSummary: buildQuotaSummaryLines(lang),
        }, lang);
        return effectiveMasked ? redactTextForPrivacy(report) : report;
    }

    function buildHandoffV2ForCurrentSubject(
        lang: Language = getLanguage(),
        windowId?: string,
        privacyOverride?: boolean,
    ): HandoffV2Result {
        const explicitWinId = extractExplicitWindowId(windowId);
        const winId = explicitWinId ?? activeWindowId;
        const masked = typeof privacyOverride === 'boolean' ? privacyOverride : isPrivacyMaskedForWindow(explicitWinId);
        const active = winId === activeWindowId;
        const curWin = getOrCreateWindowSelectionState(winId);
        const resolution = active ? lastResolution : resolveWindowState(curWin).resolution;
        const expectedSelRev = active ? selectionRevision : curWin.selectionRevision;
        const scopedUsage = resolution.cascadeId && !resolution.hostPending
            ? (currentUsage?.cascadeId === resolution.cascadeId ? currentUsage : monitorStore.getSnapshot(resolution.cascadeId) ?? null)
            : null;
        const cachedObs = observationsByWindow.get(winId)?.value;
        const obs = (cachedObs && cachedObs.subjectCascadeId === resolution.cascadeId && cachedObs.selectionRevision === expectedSelRev)
            ? cachedObs
            : publishCurrentObservation(deps.now(), winId, resolution, scopedUsage);
        const subjectId = obs.subjectCascadeId;
        const matchedUsage = subjectId && scopedUsage && scopedUsage.cascadeId === subjectId
            ? scopedUsage
            : (subjectId && currentUsage && currentUsage.cascadeId === subjectId ? currentUsage : null);
        const subjectTraj = subjectId ? allTrajectories.find(tr => tr.cascadeId === subjectId) : null;
        const matchedBd = subjectId && contextBreakdown && contextBreakdownCascadeId === subjectId ? contextBreakdown : null;
        const swarmSum = buildCdpSwarmSummary(obs, masked);
        const wsUri = (subjectTraj?.workspaceUris && subjectTraj.workspaceUris[0])
            || (workspacesByWindow.get(winId)?.[0])
            || activeWorkspaceUris[0]
            || '';
        const canonicalModel = matchedUsage?.modelDisplayName
            || (obs.measuredModel ? normalizeModelDisplayName(obs.measuredModel) : null)
            || matchedUsage?.model
            || null;
        return buildAllowlistedHandoffV2({
            observation: obs,
            subjectCascadeId: subjectId,
            dataRevision: obs.dataRevision,
            canonicalModel,
            title: matchedUsage?.title || subjectTraj?.summary || null,
            workspaceUriOrLabel: wsUri || null,
            branchName: matchedUsage?.branchName || subjectTraj?.branchName || null,
            turnStatus: {
                status: subjectTraj?.status || matchedUsage?.status || undefined,
                stepCount: matchedUsage?.stepCount ?? subjectTraj?.stepCount ?? null,
                cacheState: active ? (turnDiagnostics?.lastTurnStartKind ?? undefined) : undefined,
                speedMode: obs.speedMode,
                speedTps: obs.displaySpeedTps,
                compressionDetected: Boolean(matchedUsage?.compressionDetected || matchedBd?.compactionCheckpoints?.length),
            },
            swarmSummary: swarmSum
                ? {
                    activeCount: swarmSum.activeCount,
                    totalCount: swarmSum.totalCount,
                    members: swarmSum.members.map(m => ({
                        name: m.name,
                        phase: m.phase,
                        killed: m.phase === 'killed',
                    })),
                }
                : null,
            privacyMasked: masked,
            redactText: redactTextForPrivacy,
            lang,
        });
    }

    function buildHandoffPromptText(lang: Language = getLanguage()): string {
        return buildHandoffV2ForCurrentSubject(lang).previewText;
    }

    function buildSnapshotPayload(
        viewMode: SidecarViewMode,
        langOverride?: Language,
        useCache = false,
        snapshotOpts?: {
            includeHtml?: boolean;
            windowId?: string;
            authScope?: string;
            privacyMasked?: boolean;
        },
    ): SidecarSnapshotPayload {
        const prevLang = getLanguage();
        const effectiveLang = (langOverride && isLanguage(langOverride)) ? langOverride : prevLang;
        const explicitWinId = extractExplicitWindowId(snapshotOpts?.windowId);
        const effectiveWindowId = (explicitWinId || activeWindowId).trim() || 'default';
        const effectivePrivacyMasked = typeof snapshotOpts?.privacyMasked === 'boolean'
            ? snapshotOpts.privacyMasked
            : isPrivacyMaskedForWindow(explicitWinId);
        const effectiveAuthScope = (snapshotOpts?.authScope || 'default').trim() || 'default';
        const effectiveIncludeHtml = Boolean(snapshotOpts?.includeHtml);
        const effectivePollIntervalMs = computeNextPollDelayMs();
        // Keep countdown ticks client-side: no minuteBucket churn in cacheKey!
        const cacheKey = `${stateRevision}|${dataRevision}|${selectionRevision}|${viewMode}|${effectiveLang}|${effectivePrivacyMasked ? 1 : 0}|${effectiveAuthScope}|${effectiveWindowId}|${effectiveIncludeHtml ? 1 : 0}|${effectivePollIntervalMs}`;

        const cachedPayload = useCache ? snapshotCache.get(cacheKey) : undefined;
        if (cachedPayload) {
            const cachedMeta = cachedPayload.meta;
            if (cachedMeta && typeof cachedMeta === 'object' && cachedMeta.pollCount !== pollCount) {
                const updatedPayload: SidecarSnapshotPayload = {
                    ...cachedPayload,
                    meta: {
                        ...cachedMeta,
                        pollCount,
                    },
                };
                snapshotCache.set(cacheKey, updatedPayload);
                return updatedPayload;
            }
            return cachedPayload;
        }

        if (langOverride && isLanguage(langOverride) && langOverride !== prevLang) {
            setLanguageInMemory(langOverride);
        }
        try {
            const docParams = buildDocumentParams(viewMode, langOverride, effectivePrivacyMasked, effectiveWindowId);
            const tabs = renderTabsPayload(docParams);
            const outConvOpts = docParams.conversationOptions || [];
            const conversations: SidecarConversationOption[] = outConvOpts.map(opt => ({
                id: opt.cascadeId,
                title: opt.title,
                stepCount: opt.stepCount,
                isSubagent: opt.isSubagent,
                workspace: opt.workspaceLabel || undefined,
                lastModifiedTime: opt.lastModifiedTime || undefined,
            }));

            const dataSigHash = crypto.createHash('sha256')
                .update(computeDataSignature())
                .update(`|${viewMode}|${effectiveLang}|${effectivePrivacyMasked ? 1 : 0}|${effectiveAuthScope}|${effectiveWindowId}|${effectiveIncludeHtml ? 1 : 0}|${dataRevision}|${selectionRevision}`)
                .digest('hex')
                .slice(0, 24);

            const payload: SidecarSnapshotPayload = {
                ...(effectiveIncludeHtml ? { html: renderDocumentHtml(docParams) } : {}),
                tabs,
                time: docParams.lastUpdatedTime,
                language: docParams.language,
                paused: isPaused,
                privacyMasked: effectivePrivacyMasked,
                isStale: docParams.staleState?.isStale ?? false,
                staleState: docParams.staleState ?? null,
                activeConversationId: docParams.activeConversationId ?? null,
                pinnedConversationId: docParams.pinnedConversationId ?? null,
                lockToMainAgent: docParams.lockToMainAgent ?? false,
                conversations,
                conversationOptions: outConvOpts,
                isCustomModelActive,
                contextBreakdown: docParams.contextBreakdown ?? null,
                turnDiagnostics: docParams.turnDiagnostics,
                quotaRunways,
                weeklyQuotaRunways: docParams.weeklyQuotaRunways ?? {},
                promptCacheTtl: docParams.promptCacheTtl ?? null,
                recoveryBrief: docParams.recoveryBrief ?? null,
                data: {
                    usage: docParams.currentUsage ? { ...docParams.currentUsage } : null,
                    monitorStatus,
                    userInfo: docParams.userInfo,
                    modelConfigs: cachedModelConfigs,
                    orchestratorSettings: cachedOrchestratorSettings,
                    quotaSummary: cachedQuotaSummary,
                    todayCostUsd: docParams.todayCostUsd,
                    sessionCostUsd: docParams.sessionCostUsd,
                    settings: docParams.settings,
                    appSettings: docParams.appSettings,
                    orchestratorPricingMode: docParams.orchestratorPricingMode,
                    cdpStatus: docParams.cdpStatus,
                    updateStatus: docParams.updateStatus,
                    accountSnapshots: docParams.accountSnapshots,
                    activeAccountKey: docParams.activeAccountKey,
                    billingDays: docParams.billingDays,
                    globalRules: docParams.globalRules ?? null,
                    privacyMasked: effectivePrivacyMasked,
                },
                meta: {
                    surface: 'app-sidecar',
                    viewMode,
                    version,
                    privacyMasked: effectivePrivacyMasked,
                    authScope: effectiveAuthScope,
                    windowId: effectiveWindowId,
                    includeHtml: effectiveIncludeHtml,
                    dataRevision,
                    selectionRevision,
                    backendEpoch,
                    dataSignatureHash: dataSigHash,
                    lsPid: cachedLsInfo?.pid ?? null,
                    lsPort: cachedLsInfo?.port ?? null,
                    lsSurface: cachedLsInfo?.surface ?? null,
                    lsSource: cachedLsInfo?.source ?? null,
                    selectionMode: lastResolution.mode,
                    selectionReason: lastResolution.reason,
                    ignoredSubagentBurst: lastResolution.ignoredSubagentBurst,
                    pinnedFallback: lastResolution.pinnedFallback,
                    hostPending: Boolean(lastResolution.hostPending),
                    pollCount,
                    lastPollAtMs,
                    effectivePollIntervalMs,
                    ...(overlayTargetTab ? { overlayTargetTab: { ...overlayTargetTab } } : {}),
                },
            };

            if (useCache) {
                if (!snapshotCache.has(cacheKey) && snapshotCache.size >= MAX_SNAPSHOT_CACHE_ENTRIES) {
                    const oldestKey = snapshotCache.keys().next().value;
                    if (oldestKey !== undefined) {
                        snapshotCache.delete(oldestKey);
                    }
                }
                snapshotCache.set(cacheKey, payload);
            }
            return payload;
        } finally {
            if (langOverride && langOverride !== prevLang) {
                setLanguageInMemory(prevLang);
            }
        }
    }

    /** Positive authorization roots for workspace reveal (`revealPath`, `historyAction(workspace)`):
     *  ONLY active host registered workspace roots — NEVER historical trajectories or swarm metadata! */
    function getWorkspaceRevealRoots(requestWindowId: unknown): string[] {
        const winId = typeof requestWindowId === 'string' && requestWindowId.trim() ? requestWindowId.trim() : activeWindowId;
        return workspacesByWindow.get(winId) ?? [];
    }

    /** Positive authorization root for `revealStateFile` / `openStateFile`: ONLY durableState directory. */
    function getStateFileRevealRoots(): string[] {
        return [path.dirname(durableState.getFilePath())];
    }

    /** Positive authorization root for `historyAction(record | pb)`: ONLY `~/.gemini/antigravity`. */
    function getHistoryArtifactRevealRoots(): string[] {
        return [path.join(deps.homedir(), '.gemini', 'antigravity')];
    }

    function makeCommitFailureResponse(
        key: string,
        receipt: DurableStateCommitReceipt,
        masked = true,
    ): SidecarActionHttpBody {
        const errMsg = masked || !receipt.error
            ? tBi('Failed to save changes to disk.', '无法将更改保存到磁盘。')
            : receipt.error;
        return {
            ok: false,
            statusCode: 503,
            error: errMsg,
            result: {
                committed: false,
                commitReceipt: { ...receipt, error: errMsg },
            },
            messages: [
                {
                    command: 'configSaveFailed',
                    key,
                    error: errMsg,
                    retryScheduled: receipt.retryScheduled,
                },
            ],
        };
    }

    interface MutableSettingsSnapshot {
        appSettings: AppSettingsWithV118;
        settings: MonitorDocumentSettings;
        lockToMainAgent: boolean;
        subscriptionPlan: SubscriptionPlanPresetId;
        panelHintPrefs: PanelHintPreferences;
        zoomLevel: number;
        orchestratorPricingMode: OrchestratorPricingMode;
        dailyStoreMaxDays: number;
        dailyStoreSnapshot: DailyStoreState;
        language: Language;
        languagePreference: LanguagePreference;
        windowSelectionStates: Array<[string, WindowSelectionState]>;
    }

    function captureSettingsSnapshot(): MutableSettingsSnapshot {
        return {
            appSettings: { ...appSettings },
            settings: { ...settings },
            lockToMainAgent,
            subscriptionPlan,
            panelHintPrefs: { ...panelHintPrefs },
            zoomLevel,
            orchestratorPricingMode: pricingStore.getOrchestratorPricingMode(),
            dailyStoreMaxDays: dailyStore.maxDays,
            dailyStoreSnapshot: dailyStore.serialize(),
            language: getLanguage(),
            languagePreference: appSettings.languagePreference,
            windowSelectionStates: [...windowSelectionStates.entries()].map(([id, st]) => [id, { ...st }]),
        };
    }

    function restoreSettingsSnapshot(snap: MutableSettingsSnapshot): void {
        const pollingChanged = appSettings.pollingInterval !== snap.appSettings.pollingInterval;
        const retentionChanged = dailyStore.maxDays !== snap.dailyStoreMaxDays;
        appSettings = { ...snap.appSettings };
        settings = { ...snap.settings };
        lockToMainAgent = snap.lockToMainAgent;
        subscriptionPlan = snap.subscriptionPlan;
        panelHintPrefs = { ...snap.panelHintPrefs };
        zoomLevel = snap.zoomLevel;
        setShowModelShortId(settings.showModelInternalId);
        pricingStore.setOrchestratorPricingModeSync(snap.orchestratorPricingMode);
        setLanguagePreferenceInMemory(snap.languagePreference, appLocaleSources);
        setLanguageInMemory(snap.language);
        windowSelectionStates.clear();
        for (const [id, st] of snap.windowSelectionStates) {
            windowSelectionStates.set(id, { ...st });
        }
        if (retentionChanged) {
            dailyStore.setMaxDays(snap.dailyStoreMaxDays);
            dailyStore.restoreSnapshot(snap.dailyStoreSnapshot);
        }
        if (pollingChanged) {
            scheduleNextPoll();
        }
    }

    function syncSettingsMirrorFromAppSettings(): void {
        settings = {
            ...appSettings,
            maxRecentSteps: appSettings.activityMaxRecentSteps,
            maxArchives: appSettings.activityMaxArchives,
            lockToMainAgent,
            subscriptionPlan,
            nativeHudAutoHideOnOverview: Boolean(appSettings.nativeHudAutoHideOnOverview),
            customFxCurrency: appSettings.customFxCurrency ?? null,
            languagePreference: appSettings.languagePreference ?? 'auto',
            contextPctBasis: appSettings.contextPctBasis ?? 'compaction',
            speedMetricMode: appSettings.speedMetricMode ?? 'decode',
            quotaWindowMode: appSettings.quotaWindowMode ?? '5h',
            quotaDirectionMode: appSettings.quotaDirectionMode ?? 'remaining',
            cdpOverlayFontSize: normalizeCdpOverlayFontSize(appSettings.cdpOverlayFontSize),
            cdpOverlayHighContrast: Boolean(appSettings.cdpOverlayHighContrast),
        };
    }

    async function persistAppSettingsPatch(
        patch: Partial<AppSettingsWithV118>,
        extraGlobalUpdates?: Record<string, unknown>,
    ): Promise<DurableStateCommitReceipt> {
        const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const extraPromises = Object.entries(extraGlobalUpdates ?? {}).map(([k, v]) => durableState.updateGlobalWithReceipt(k, v));
        const pPatched = Object.keys(cleanPatch).length > 0
            ? durableState.patchAppSettingsWithReceipt(cleanPatch as Partial<AppSettings>)
            : undefined;
        const flushReceipt = await durableState.flush();
        if (!flushReceipt.committed) { return flushReceipt; }
        await Promise.all([...(pPatched ? [pPatched] : []), ...extraPromises]);
        const { hydrated, plan } = hydrateV118SettingsFromDisk(
            globalState.get<Record<string, unknown> | null>('appSettings', null),
            durableState.getAppSettings(),
            globalState.get<boolean | undefined>('lockToMainAgent', undefined),
            globalState.get<string>('subscriptionPlan', ''),
        );
        appSettings = hydrated;
        subscriptionPlan = plan;
        lockToMainAgent = hydrated.lockToMainAgent;
        syncSettingsMirrorFromAppSettings();
        return flushReceipt;
    }

    function buildSyncSettingsControlsMessage(masked = true): Record<string, unknown> {
        const { maxRecentSteps: _a, maxArchives: _b, ...syncBase } = settings;
        return {
            command: 'syncSettingsControls',
            ...syncBase,
            lockToMainAgent,
            subscriptionPlan,
            cdpStatus: masked ? redactCdpStatusForPrivacy(overlayManager.getStatus()) : overlayManager.getStatus(),
            updateStatus: masked && lastUpdateStatusView?.error ? { ...lastUpdateStatusView, error: updateCheckFailedMsg() } : lastUpdateStatusView,
        };
    }

    const PANEL_HINT_MAP: Record<string, [keyof PanelHintPreferences, string]> = {
        showTips: ['showTabScrollHint', 'panelShowTabScrollHint'], panelShowTabScrollHint: ['showTabScrollHint', 'panelShowTabScrollHint'],
        customScrollbar: ['showScrollbar', 'panelShowScrollbar'], panelShowScrollbar: ['showScrollbar', 'panelShowScrollbar'],
        showEndOfContent: ['showEndOfContent', 'panelShowEndOfContent'], panelShowEndOfContent: ['showEndOfContent', 'panelShowEndOfContent'],
    };

    function applySingleSetting(key: string, value: unknown): {
        ok: boolean; normalizedKey: string; patch?: Partial<AppSettingsWithV118>;
        globalUpdates?: Record<string, unknown>; overlayChanged?: boolean; error?: string;
    } {
        const sRec = settings as unknown as Record<string, unknown>;
        const aRec = appSettings as unknown as Record<string, unknown>;
        if ((key === 'pollingInterval' || key === 'quotaNotificationThreshold' || key === 'calendarRetentionDays') && SETTINGS_INT_BOUNDS[key]) {
            const n = Number(value);
            if (!Number.isFinite(n)) { return { ok: false, normalizedKey: key, error: `Invalid ${key}` }; }
            const [min, max] = SETTINGS_INT_BOUNDS[key];
            const clamped = clamp(Math.round(n), min, max);
            sRec[key] = aRec[key] = clamped;
            if (key === 'pollingInterval') { scheduleNextPoll(); }
            if (key === 'calendarRetentionDays') { dailyStore.setMaxDays(clamped); }
            return { ok: true, normalizedKey: key, patch: { [key]: clamped } };
        }
        if ((key === 'contextPctBasis' || key === 'speedMetricMode' || key === 'quotaWindowMode' || key === 'quotaDirectionMode') && SETTINGS_ENUM_VALUES[key]) {
            if (typeof value !== 'string' || !SETTINGS_ENUM_VALUES[key].includes(value)) {
                return { ok: false, normalizedKey: key, error: `Invalid ${key}` };
            }
            sRec[key] = aRec[key] = value;
            return { ok: true, normalizedKey: key, patch: { [key]: value } };
        }
        if (key === 'showModelInternalId' || key === 'ideShowNativeHudBar' || key === 'nativeHudAutoHideOnOverview' || key === 'autoCheckUpdates' || key === 'appOnboardingDismissed') {
            const b = Boolean(value);
            sRec[key] = aRec[key] = b;
            if (key === 'showModelInternalId') { setShowModelShortId(b); }
            return { ok: true, normalizedKey: key, patch: { [key]: b } };
        }
        if (key === 'appComposerRingEnabled' || key === 'appTopBarEnabled') {
            const next = Boolean(value);
            const changed = aRec[key] !== next;
            sRec[key] = aRec[key] = next;
            return { ok: true, normalizedKey: key, overlayChanged: changed, patch: { [key]: next } };
        }
        if (key === 'showNativeHudBar' || key === 'appShowNativeHudBar') {
            const b = Boolean(value);
            appSettings.showNativeHudBar = appSettings.appShowNativeHudBar = settings.showNativeHudBar = settings.appShowNativeHudBar = b;
            return { ok: true, normalizedKey: key, patch: { showNativeHudBar: b, appShowNativeHudBar: b } };
        }
        if (PANEL_HINT_MAP[key]) {
            const [prop, norm] = PANEL_HINT_MAP[key];
            const b = Boolean(value);
            panelHintPrefs[prop] = b;
            return { ok: true, normalizedKey: norm, globalUpdates: { [norm]: b } };
        }
        switch (key) {
            case 'lockToMainAgent': {
                const nextLock = Boolean(value);
                lockToMainAgent = settings.lockToMainAgent = appSettings.lockToMainAgent = nextLock;
                const curWin = getOrCreateWindowSelectionState(activeWindowId);
                setWindowSelectionState(nextLock ? enableLockToMainAgent(curWin, {
                    trajectories: allTrajectories, currentActiveId: trackedCascadeId,
                    knownSubagentIds: getEffectiveKnownSubagentIds(), workspaceUris: activeWorkspaceUris,
                    topologyResolveRootId: resolveTopologyRootId,
                }) : disableLockToMainAgent(curWin));
                return { ok: true, normalizedKey: 'lockToMainAgent', patch: { lockToMainAgent: nextLock, legacyLockMigrated: true } };
            }
            case 'cdpOverlayFontSize': {
                if (!isCdpOverlayFontSize(value)) { return { ok: false, normalizedKey: key, error: 'Invalid cdpOverlayFontSize' }; }
                appSettings.cdpOverlayFontSize = settings.cdpOverlayFontSize = value;
                return { ok: true, normalizedKey: key, globalUpdates: { cdpOverlayFontSize: value } };
            }
            case 'cdpOverlayHighContrast': {
                const b = Boolean(value);
                appSettings.cdpOverlayHighContrast = settings.cdpOverlayHighContrast = b;
                return { ok: true, normalizedKey: key, globalUpdates: { cdpOverlayHighContrast: b } };
            }
            case 'languagePreference': {
                if (!isLanguagePreference(value)) { return { ok: false, normalizedKey: key, error: 'Invalid languagePreference' }; }
                appSettings.languagePreference = settings.languagePreference = value;
                setLanguagePreferenceInMemory(value, appLocaleSources);
                return { ok: true, normalizedKey: key, patch: { languagePreference: value }, globalUpdates: { languagePreference: value, displayLanguage: value === 'auto' ? undefined : value } };
            }
            case 'orchestratorPricingMode': {
                const v = validateOrchestratorPricingMode(value);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                appSettings.orchestratorPricingMode = settings.orchestratorPricingMode = v.value;
                pricingStore.setOrchestratorPricingModeSync(v.value);
                return { ok: true, normalizedKey: key, patch: { orchestratorPricingMode: v.value } };
            }
            case 'displayCurrency': {
                const v = validateDisplayCurrency(value);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                const b = switchDisplayCurrency({ displayCurrency: appSettings.displayCurrency, customFxRate: appSettings.customFxRate, customFxCurrency: appSettings.customFxCurrency }, v.value);
                Object.assign(appSettings, b); Object.assign(settings, b);
                return { ok: true, normalizedKey: key, patch: b };
            }
            case 'customFxRate': {
                const v = validateCustomFxRate(value);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                const b = bindCustomFxRate(appSettings.displayCurrency, v.value);
                Object.assign(appSettings, b); Object.assign(settings, b);
                return { ok: true, normalizedKey: key, patch: b };
            }
            case 'customFxCurrency': {
                if (value === null || value === '' || value === undefined) {
                    appSettings.customFxCurrency = settings.customFxCurrency = appSettings.customFxRate = settings.customFxRate = null;
                    return { ok: true, normalizedKey: key, patch: { customFxCurrency: null, customFxRate: null } };
                }
                const v = validateDisplayCurrency(value);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                appSettings.customFxCurrency = settings.customFxCurrency = v.value;
                return { ok: true, normalizedKey: key, patch: { customFxCurrency: v.value } };
            }
            case 'subscriptionPlan': {
                const v = validateSubscriptionPlan(value, appSettings.subscriptionMonthlyFee);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                const nextPlan = v.value;
                const preset = SUBSCRIPTION_PLAN_PRESETS[nextPlan];
                subscriptionPlan = appSettings.subscriptionPlan = settings.subscriptionPlan = nextPlan;
                const patch: Partial<AppSettingsWithV118> = { subscriptionPlan: nextPlan };
                if (nextPlan === 'none') {
                    appSettings.subscriptionMonthlyFee = settings.subscriptionMonthlyFee = patch.subscriptionMonthlyFee = null;
                } else if (preset.monthlyUsd > 0) {
                    appSettings.subscriptionMonthlyFee = settings.subscriptionMonthlyFee = patch.subscriptionMonthlyFee = preset.monthlyUsd;
                    appSettings.subscriptionCurrency = settings.subscriptionCurrency = patch.subscriptionCurrency = 'USD';
                }
                return { ok: true, normalizedKey: key, patch };
            }
            case 'subscriptionMonthlyFee': {
                const v = validateSubscriptionMonthlyFee(value);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                appSettings.subscriptionMonthlyFee = settings.subscriptionMonthlyFee = v.value;
                const patch: Partial<AppSettingsWithV118> = { subscriptionMonthlyFee: v.value };
                if (v.value !== null && subscriptionPlan === 'none') {
                    subscriptionPlan = appSettings.subscriptionPlan = settings.subscriptionPlan = patch.subscriptionPlan = 'custom';
                }
                return { ok: true, normalizedKey: key, patch };
            }
            case 'subscriptionCurrency': {
                const v = validateSubscriptionCurrency(value);
                if (!v.ok) { return { ok: false, normalizedKey: key, error: v.error }; }
                appSettings.subscriptionCurrency = settings.subscriptionCurrency = v.value;
                return { ok: true, normalizedKey: key, patch: { subscriptionCurrency: v.value } };
            }
            case 'uiZoom':
            case 'panelZoomLevel': {
                const z = Number(value);
                if (!Number.isFinite(z)) { return { ok: false, normalizedKey: key, error: 'Invalid uiZoom' }; }
                zoomLevel = clamp(Math.round(z), 50, 200);
                return { ok: true, normalizedKey: 'panelZoomLevel', globalUpdates: { panelZoomLevel: zoomLevel } };
            }
            case 'activityMaxRecentSteps': case 'maxRecentSteps': case 'activity.maxRecentSteps':
            case 'activityMaxArchives': case 'maxArchives': case 'activity.maxArchives': {
                const isSteps = key.includes('RecentSteps');
                const n = Number(value);
                const norm = isSteps ? 'activityMaxRecentSteps' : 'activityMaxArchives';
                if (!Number.isFinite(n)) { return { ok: false, normalizedKey: key, error: `Invalid ${norm}` }; }
                const clamped = clamp(Math.round(n), isSteps ? 10 : 1, isSteps ? 500 : 100);
                if (isSteps) { settings.maxRecentSteps = settings.activityMaxRecentSteps = appSettings.activityMaxRecentSteps = clamped; }
                else { settings.maxArchives = settings.activityMaxArchives = appSettings.activityMaxArchives = clamped; }
                return { ok: true, normalizedKey: norm, patch: { [norm]: clamped } };
            }
            case 'tooltipDensity':
            case 'statusBar.tooltipDensity': {
                const d = parseTooltipDensity(value);
                settings.tooltipDensity = appSettings.tooltipDensity = d;
                return { ok: true, normalizedKey: 'statusBar.tooltipDensity', patch: { tooltipDensity: d } };
            }
            default: {
                const sbKey = key.startsWith('statusBar.') ? key.slice(10) : key;
                if (['showContext', 'showQuota', 'showResetCountdown', 'showAiCredits', 'showSpeed', 'showCacheHit', 'showSessionCost'].includes(sbKey)) {
                    const b = Boolean(value);
                    sRec[sbKey] = aRec[sbKey] = b;
                    return { ok: true, normalizedKey: `statusBar.${sbKey}`, patch: { [sbKey]: b } };
                }
                return { ok: false, normalizedKey: key, error: `Unknown setting key: ${key}` };
            }
        }
    }

    // ── SidecarProvider Interface Implementation ─────────────────────────────

    async function syncActiveTelemetryForResolved(
        resolved: ResolvedConversationTarget,
        myEpoch: number,
        mySelGen: number,
        opts?: { allowSkipSameId?: boolean; clearIfNoTarget?: boolean; requireSwitchOnCatch?: boolean },
    ): Promise<void> {
        const targetTrajectory = findResolvedTrajectory(resolved);
        if (resolved.hostPending || (!targetTrajectory && opts?.clearIfNoTarget !== false)) {
            clearActiveConversationTelemetry(resolved.hostPending ? resolved.cascadeId : (opts?.clearIfNoTarget === false ? resolved.cascadeId : null), deps.now());
            return;
        }
        if (!targetTrajectory || !cachedLsInfo) { return; }
        const targetId = targetTrajectory.cascadeId;
        if (opts?.allowSkipSameId !== false && targetId === currentUsage?.cascadeId) { return; }
        const isSwitch = Boolean(currentUsage && currentUsage.cascadeId !== targetId);
        try {
            const runRefresh = () => refreshActiveConversationTelemetry(cachedLsInfo!, targetTrajectory, deps.now(), myEpoch, mySelGen);
            if (getTrajectoryPollBudgetSnapshot()) {
                await runRefresh();
            } else {
                await withTrajectoryPollBudget({ ...DEFAULT_SWARM_POLL_BUDGET, ...options.swarmPollBudget }, runRefresh);
            }
        } catch {
            if ((!opts?.requireSwitchOnCatch || isSwitch) && backendEpoch === myEpoch && selectionGeneration === mySelGen && lastResolution.cascadeId === targetId) {
                clearActiveConversationTelemetry(targetId, deps.now());
            }
        }
    }

    async function commitSettingsBatch(
        entries: Array<[string, unknown]>,
        extra?: { customPricing?: Record<string, ModelPricing>; fallbackKey?: string; masked?: boolean },
    ): Promise<{ ok: true; appliedKeys: string[]; anyOverlayChanged: boolean } | { ok: false; statusCode: number; error: string; commitFailureResponse?: SidecarActionHttpBody }> {
        const prevSnap = captureSettingsSnapshot();
        const prevPricing = extra?.customPricing !== undefined ? pricingStore.getCustom() : undefined;
        const mergedPatch: Partial<AppSettingsWithV118> = {};
        const mergedGlobal: Record<string, unknown> = {};
        let anyOverlayChanged = false;
        let orchChanged = false;
        const appliedKeys: string[] = [];
        const ordered = [...entries].sort(([a], [b]) => (a === 'displayCurrency' ? -1 : b === 'displayCurrency' ? 1 : 0));
        for (const [k, v] of ordered) {
            const applied = applySingleSetting(k, v);
            if (!applied.ok) {
                restoreSettingsSnapshot(prevSnap);
                return { ok: false, statusCode: 400, error: applied.error || `Invalid setting: ${k}` };
            }
            if (applied.patch) { Object.assign(mergedPatch, applied.patch); }
            if (applied.globalUpdates) { Object.assign(mergedGlobal, applied.globalUpdates); }
            if (applied.overlayChanged) { anyOverlayChanged = true; }
            if (applied.normalizedKey === 'orchestratorPricingMode') { orchChanged = true; }
            appliedKeys.push(applied.normalizedKey);
        }
        const pOrch = orchChanged ? pricingStore.setOrchestratorPricingMode(appSettings.orchestratorPricingMode) : undefined;
        const pPrice = extra?.customPricing !== undefined ? pricingStore.setAll(extra.customPricing) : undefined;
        const commitReceipt = await persistAppSettingsPatch(mergedPatch, mergedGlobal);
        if (!commitReceipt.committed) {
            restoreSettingsSnapshot(prevSnap);
            if (prevPricing !== undefined) { void pricingStore.setAll(prevPricing); }
            return { ok: false, statusCode: 500, error: commitReceipt.error || 'Failed to persist settings', commitFailureResponse: makeCommitFailureResponse(extra?.fallbackKey || appliedKeys[0] || 'settings', commitReceipt, extra?.masked ?? true) };
        }
        if (pOrch) { await pOrch; }
        if (pPrice) { await pPrice; }
        publishCurrentObservation(deps.now());
        if (anyOverlayChanged) {
            const p = syncOverlayTogglesIfChanged();
            if (p) { await p; }
            if (appSettings.appComposerRingEnabled || appSettings.appTopBarEnabled) {
                await overlayManager.updatePayload(buildCdpOverlayPayload(deps.now(), activeWindowId, true)).catch(() => {});
            }
        } else if (appSettings.appComposerRingEnabled || appSettings.appTopBarEnabled) {
            pushOverlayPayloadAsync();
        }
        return { ok: true, appliedKeys, anyOverlayChanged };
    }

    async function renderHtml(ctx: SidecarRenderContext): Promise<string> {
        markClientActivity();
        syncFromDurableStateIfChanged();
        const renderStartMs = Date.now();
        const runBoundedWait = async (work: Promise<void>, capMs: number): Promise<void> => {
            if (capMs <= 0) { return; }
            let waitTimer: ReturnType<typeof setTimeout> | null = null;
            const boundedWait = new Promise<void>((resolve) => {
                waitTimer = setTimeout(resolve, capMs);
                if (typeof (waitTimer as { unref?: () => void }).unref === 'function') {
                    (waitTimer as { unref: () => void }).unref();
                }
            });
            try {
                await Promise.race([work, boundedWait]);
            } finally {
                if (waitTimer) { clearTimeout(waitTimer); }
            }
        };
        if (pollCount === 0 && options.autoStart !== false) {
            const initialPoll = runPollCycle(false).catch((err) => {
                log(`[sidecar-runtime] Initial renderHtml poll failed gracefully: ${err instanceof Error ? err.message : String(err)}`);
            });
            await runBoundedWait(initialPoll, 2_500);
        }
        if (allTrajectories.length > 0 || hostConversationId || hostNewConversationPending) {
            const remainingBudgetMs = Math.max(0, 2_500 - (Date.now() - renderStartMs));
            const syncWork = syncActiveTelemetryForResolved(recomputeConversationResolution(), backendEpoch, selectionGeneration, { clearIfNoTarget: false }).catch(() => {});
            await runBoundedWait(syncWork, remainingBudgetMs);
        }
        const prevLang = getLanguage();
        const langOverride = ctx.lang && isLanguage(ctx.lang) ? ctx.lang : undefined;
        if (langOverride && langOverride !== prevLang) {
            setLanguageInMemory(langOverride);
        }
        try {
            const params = buildDocumentParams(
                ctx.viewMode,
                langOverride,
                typeof ctx.privacyMasked === 'boolean' ? ctx.privacyMasked : undefined,
                ctx.windowId,
            );
            return renderDocumentHtml(params);
        } finally {
            if (langOverride && langOverride !== prevLang) {
                setLanguageInMemory(prevLang);
            }
        }
    }

    async function getSnapshot(
        query: SidecarSnapshotQuery & {
            lang?: Language;
            includeHtml?: boolean;
            conversationCleared?: boolean;
            isNewConversation?: boolean;
        },
    ): Promise<SidecarSnapshotPayload> {
        syncFromDurableStateIfChanged();
        // GET /api/snapshot is strictly read-only: ignore focus/workspace/pin/lock fields
        if (query.userActive === true) {
            markClientActivity();
        }
        const viewMode: SidecarViewMode = query.viewMode || 'aux';
        const langOverride = query.lang && isLanguage(query.lang) ? query.lang : undefined;
        return buildSnapshotPayload(viewMode, langOverride, true, {
            includeHtml: Boolean(query.includeHtml),
            windowId: typeof query.windowId === 'string' ? query.windowId : undefined,
            authScope: typeof query.authScope === 'string' ? query.authScope : undefined,
            privacyMasked: typeof query.privacyMasked === 'boolean' ? query.privacyMasked : undefined,
        });
    }

    async function handleAction(action: SidecarActionRequest): Promise<SidecarActionHttpBody> {
        const isPassiveReadAction = action.command === 'ping' || action.command === 'getSnapshot';
        if (!isPassiveReadAction) {
            markClientActivity();
        }
        syncFromDurableStateIfChanged();

        const viewMode: SidecarViewMode = action.viewMode === 'sidebar' || action.viewMode === 'standalone'
            ? action.viewMode
            : 'aux';
        const reqWindowId = extractExplicitWindowId(action.windowId);
        const reqMasked = isPrivacyMaskedForWindow(reqWindowId);
        const fail = (statusCode: number, error: string, extra?: Partial<SidecarActionHttpBody>): SidecarActionHttpBody =>
            ({ ok: false, statusCode, error, ...extra });
        const batchErr = (b: { statusCode: number; error: string; commitFailureResponse?: SidecarActionHttpBody }): SidecarActionHttpBody =>
            b.commitFailureResponse ?? fail(b.statusCode, b.error);
        const actionSnapshot = () => buildSnapshotPayload(viewMode, undefined, false, {
            ...(reqWindowId ? { windowId: reqWindowId } : {}),
            privacyMasked: reqMasked,
        });
        // ZERO pre-dispatch side effects: never mutate host focus or workspace roots before command validation!

        try {
        switch (action.command) {
            case 'ping':
                return { ok: true, result: { pong: true, version } };

            case 'tabShown':
                return { ok: true };

            case 'syncHostFocus': {
                const rawRev = action.focusRevision;
                if (typeof rawRev !== 'number' || !Number.isSafeInteger(rawRev) || rawRev < 0) { return { ok: false, statusCode: 400, error: 'Invalid focusRevision' }; }
                const rawConv = action.conversationId;
                let nextId: string | null = null;
                if (rawConv === null || rawConv === undefined || rawConv === '') { nextId = null; }
                else if (typeof rawConv === 'string') {
                    const trimmed = rawConv.trim();
                    if (trimmed && !SAFE_CASCADE_ID_RE.test(trimmed)) { return { ok: false, statusCode: 400, error: 'Invalid conversationId' }; }
                    nextId = trimmed || null;
                } else { return { ok: false, statusCode: 400, error: 'Invalid conversationId' }; }
                const winId = typeof action.windowId === 'string' && action.windowId.trim() ? action.windowId.trim() : 'default';
                const source = typeof action.sourceInstanceId === 'string' ? action.sourceInstanceId : '';
                const prior = focusReceiptByWindow.get(winId);
                const reject = (reason: string) => ({
                    ok: true, result: { accepted: false, ackFocusRevision: prior?.revision ?? 0, backendEpoch, reason },
                });
                if (action.backendEpoch !== undefined) {
                    if (typeof action.backendEpoch !== 'number' || !Number.isSafeInteger(action.backendEpoch) || action.backendEpoch < 0) { return { ok: false, statusCode: 400, error: 'Invalid backendEpoch' }; }
                    if (action.backendEpoch !== backendEpoch) { return reject('stale_epoch'); }
                }
                const isNewConv = action.isNewConversation === true;
                const signature = JSON.stringify([nextId, isNewConv, viewMode, action.isFocusedPane !== false, action.fromSdkCallback === true]);
                if (prior?.retiredSources.has(source)) { return reject('stale_source'); }
                if (prior?.source === source) {
                    if (rawRev < prior.revision) { return reject('stale_revision'); }
                    if (rawRev === prior.revision) {
                        if (signature !== prior.signature) { return reject('conflicting_revision'); }
                        return { ok: true, result: { accepted: true, idempotent: true, ackFocusRevision: rawRev, backendEpoch } };
                    }
                }
                // Create the destination state before activating it, so a new window cannot inherit another window's lock.
                const switching = action.isFocusedPane !== false && winId !== activeWindowId;
                const priorWindow = activeWindowId;
                const priorState = getOrCreateWindowSelectionState(winId);
                const firstAlias = switching && priorWindow === 'default' && !prior && windowSelectionStates.get('default');
                const destination = firstAlias ? { ...firstAlias, windowId: winId } : priorState;
                if (prior && prior.source !== source) {
                    setWindowSelectionState({ ...destination, observedHostFocus: null, acknowledgedFocusRevision: 0 });
                } else {
                    setWindowSelectionState(destination);
                }
                if (switching) { activeWindowId = winId; }
                const focus = setHostConversationFocus(nextId, viewMode === 'aux' ? 'aux' : 'query', {
                    isNewConversation: isNewConv, windowId: winId, focusRevision: rawRev, viewMode,
                    sourceInstanceId: source, isFocusedPane: action.isFocusedPane !== false,
                    fromSdkCallback: action.fromSdkCallback === true,
                });
                if (!focus.accepted) {
                    activeWindowId = priorWindow;
                    setWindowSelectionState(priorState);
                    return reject(focus.reason);
                }
                if (switching) {
                    if (firstAlias && pinnedConversationId) { pinsByWindow.set(winId, pinnedConversationId); }
                    pinnedConversationId = pinsByWindow.get(winId) ?? null;
                }
                const retiredSources = prior?.retiredSources ?? new Set<string>();
                if (prior && prior.source !== source) { retiredSources.add(prior.source); }
                focusReceiptByWindow.set(winId, { source, revision: rawRev, signature, retiredSources });
                if (winId === activeWindowId && (focus.changed || switching)) { selectionGeneration++; selectionRevision++; bumpStateRevision(); }
                const myEpoch = backendEpoch, mySelGen = selectionGeneration;
                if (winId === activeWindowId && (allTrajectories.length > 0 || hostConversationId || hostNewConversationPending)) {
                    await syncActiveTelemetryForResolved(recomputeConversationResolution(winId), myEpoch, mySelGen);
                    if (myEpoch === backendEpoch && mySelGen === selectionGeneration && winId === activeWindowId) {
                        publishCurrentObservation(deps.now(), winId);
                        bumpStateRevision();
                        pushOverlayPayloadAsync();
                    }
                } else if (winId !== activeWindowId) { recomputeConversationResolution(winId); }
                const winResolved = getOrCreateWindowSelectionState(winId);
                return {
                    ok: true,
                    result: {
                        accepted: true, ackFocusRevision: rawRev, backendEpoch, windowId: winId,
                        activeConversationId: winId === activeWindowId ? lastResolution.cascadeId : (winResolved.inspectedMemberId ?? winResolved.lockedRootId ?? winResolved.observedHostFocus?.cascadeId ?? null),
                        hostPending: winId === activeWindowId ? Boolean(lastResolution.hostPending) : false,
                    },
                    snapshot: buildSnapshotPayload(viewMode, undefined, false, { windowId: winId, privacyMasked: reqMasked }),
                };
            }

            case 'registerWorkspaces': {
                if (!Array.isArray(action.workspaceUris)) {
                    return { ok: false, statusCode: 400, error: 'workspaceUris must be an array of strings' };
                }
                const cleanUris: string[] = [];
                for (const rawUri of action.workspaceUris) {
                    if (typeof rawUri !== 'string') {
                        return { ok: false, statusCode: 400, error: 'workspaceUris entries must be strings' };
                    }
                    const trimmed = rawUri.trim();
                    if (trimmed && !cleanUris.includes(trimmed)) {
                        cleanUris.push(trimmed);
                    }
                }
                const hasExplicitWindow = typeof action.windowId === 'string' && action.windowId.trim().length > 0;
                const winId = hasExplicitWindow ? (action.windowId as string).trim() : 'default';
                if (cleanUris.length === 0) {
                    if (hasExplicitWindow) {
                        workspacesByWindow.delete(winId);
                    } else {
                        // Explicit host-wide `workspaceUris: []` revokes ALL previously registered workspace roots!
                        workspacesByWindow.clear();
                    }
                } else {
                    workspacesByWindow.set(winId, cleanUris);
                }
                rebuildActiveWorkspaceUris();
                workspaceState = durableState.workspaceBucket(getPrimaryWorkspaceKey());
                monitorStore.init(workspaceState);
                selectionGeneration++;
                selectionRevision++;
                recomputeConversationResolution();
                bumpStateRevision();
                return {
                    ok: true,
                    result: {
                        windowId: winId,
                        workspaceUris: reqMasked ? [] : cleanUris,
                        activeWorkspaceUris: reqMasked ? [] : [...activeWorkspaceUris],
                        registeredCount: cleanUris.length,
                    },
                    snapshot: actionSnapshot(),
                };
            }

            case 'setPrivacyMask':
            case 'togglePrivacyMask': {
                const winId = reqWindowId;
                const curWinMasked = isPrivacyMaskedForWindow(winId);
                let nextMasked: boolean;
                if (action.command === 'togglePrivacyMask') {
                    nextMasked = !curWinMasked;
                } else {
                    const rawMask = action.masked !== undefined
                        ? action.masked
                        : (action.privacyMasked !== undefined ? action.privacyMasked : action.value);
                    if (typeof rawMask !== 'boolean') {
                        return { ok: false, statusCode: 400, error: 'Invalid masked value (expected boolean)' };
                    }
                    nextMasked = rawMask;
                }
                if (!winId) {
                    if (!nextMasked) {
                        return { ok: false, statusCode: 400, error: 'windowId is required to disable privacy mask' };
                    }
                    privacyMaskedByWindow.clear();
                } else {
                    privacyMaskedByWindow.set(winId, nextMasked);
                }
                // Evict ALL cached HTML/snapshots immediately (especially on mask-on so unmasked cache never survives)
                snapshotCache.clear();
                dataRevision++;
                bumpStateRevision();
                pushOverlayPayloadAsync();
                return {
                    ok: true,
                    result: {
                        ...(winId ? { windowId: winId } : {}),
                        privacyMasked: nextMasked,
                        masked: nextMasked,
                    },
                    messages: [{
                        command: 'privacyMaskState',
                        ...(winId ? { windowId: winId } : {}),
                        masked: nextMasked,
                        privacyMasked: nextMasked,
                    }],
                    snapshot: buildSnapshotPayload(viewMode, undefined, false, {
                        ...(winId ? { windowId: winId } : {}),
                        privacyMasked: nextMasked,
                    }),
                };
            }

            case 'refresh': {
                await runPollCycle(true);
                return {
                    ok: true,
                    result: { refreshed: true, time: lastUpdatedTime },
                    snapshot: actionSnapshot(),
                };
            }

            case 'panelReady':
            case 'getSnapshot':
                return {
                    ok: true,
                    snapshot: actionSnapshot(),
                };

            case 'switchTab': {
                const tab = typeof action.tab === 'string' ? action.tab.trim() : '';
                if (!tab) {
                    return { ok: false, statusCode: 400, error: 'Missing tab name' };
                }
                return {
                    ok: true,
                    result: { tab },
                    messages: [{ command: 'switchToTab', tab }],
                    snapshot: actionSnapshot(),
                };
            }

            case 'switchLanguage': {
                const lang = action.lang;
                if (!isLanguage(lang)) {
                    return { ok: false, statusCode: 400, error: 'Invalid language' };
                }
                const prevLang = getLanguage();
                setLanguageInMemory(lang);
                const pLang = durableState.updateGlobalWithReceipt('displayLanguage', lang);
                const receipt = await durableState.flush();
                if (!receipt.committed) {
                    setLanguageInMemory(prevLang);
                    return makeCommitFailureResponse('displayLanguage', receipt);
                }
                await pLang;
                void setLanguageToState(lang, globalState);
                lastUpdatedTime = formatClockTime(new Date(lastPollAtMs || deps.now()), lang);
                recomputeConversationResolution();
                bumpStateRevision();
                return {
                    ok: true,
                    result: { language: lang, committed: true },
                    reload: true,
                    snapshot: actionSnapshot(),
                };
            }

            case 'selectConversation':
            case 'pinConversation': {
                const winId = resolvePrivacyWindowId(action.windowId);
                let pin: string | null;
                const rawTarget = action.conversationId !== undefined ? action.conversationId : action.cascadeId;
                if (rawTarget === null || rawTarget === undefined || rawTarget === '' || rawTarget === 'auto' || rawTarget === '__auto__') {
                    pin = null;
                } else if (typeof rawTarget === 'string' && rawTarget.trim()) {
                    const cleanTarget = rawTarget.trim();
                    if (!SAFE_CASCADE_ID_RE.test(cleanTarget)) { return fail(400, 'Invalid conversationId'); }
                    pin = cleanTarget;
                } else { return fail(400, 'Invalid conversationId'); }
                setWindowSelectionState(clearWindowInspect(getOrCreateWindowSelectionState(winId)));
                if (pin) { pinsByWindow.set(winId, pin); } else { pinsByWindow.delete(winId); }
                if (winId !== activeWindowId) {
                    const resolved = recomputeConversationResolution(winId);
                    bumpStateRevision();
                    return { ok: true, result: { pinnedConversationId: pin, activeConversationId: resolved.cascadeId, mode: resolved.mode }, snapshot: actionSnapshot() };
                }
                pinnedConversationId = pin;
                if (pin) { hostNewConversationPending = false; }
                selectionGeneration++; selectionRevision++;
                await syncActiveTelemetryForResolved(recomputeConversationResolution(), backendEpoch, selectionGeneration, { allowSkipSameId: false, requireSwitchOnCatch: true });
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                bumpStateRevision(); pushOverlayPayloadAsync();
                return { ok: true, result: { pinnedConversationId, activeConversationId: lastResolution.cascadeId, mode: lastResolution.mode }, snapshot: actionSnapshot() };
            }

            case 'inspectMember':
            case 'clearInspect': {
                const isInspect = action.command === 'inspectMember';
                let cleanTarget = '';
                if (isInspect) {
                    const rawTarget = action.cascadeId !== undefined ? action.cascadeId : action.conversationId;
                    cleanTarget = typeof rawTarget === 'string' ? rawTarget.trim() : '';
                    if (!cleanTarget || !SAFE_CASCADE_ID_RE.test(cleanTarget)) { return fail(400, 'Invalid cascadeId'); }
                }
                const winId = resolvePrivacyWindowId(action.windowId);
                const prevWin = getOrCreateWindowSelectionState(winId);
                const activeWindow = winId === activeWindowId;
                const priorTarget = activeWindow ? lastResolution.cascadeId : resolveWindowState(prevWin).resolution.cascadeId;
                const nextWin = isInspect ? inspectWindowMember(prevWin, cleanTarget, priorTarget) : clearWindowInspect(prevWin);
                if (!isInspect && activeWindow && prevWin.inspectionReturnId) { trackedCascadeId = prevWin.inspectionReturnId; }
                setWindowSelectionState(nextWin);
                selectionGeneration++;
                selectionRevision = Math.max(selectionRevision + 1, nextWin.selectionRevision);
                const resolved = recomputeConversationResolution(winId);
                if (winId === activeWindowId) {
                    const epoch = backendEpoch, generation = selectionGeneration;
                    await syncActiveTelemetryForResolved(resolved, epoch, generation);
                    if (epoch !== backendEpoch || generation !== selectionGeneration || winId !== activeWindowId) {
                        return { ok: true, result: { superseded: true }, snapshot: actionSnapshot() };
                    }
                    publishCurrentObservation(deps.now(), winId);
                    lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                    bumpStateRevision(); pushOverlayPayloadAsync();
                }
                const curWin = getOrCreateWindowSelectionState(winId);
                return { ok: true, result: { windowId: winId, inspectedMemberId: curWin.inspectedMemberId, lockedRootId: curWin.lockedRootId, activeConversationId: resolved.cascadeId, mode: resolved.mode }, snapshot: actionSnapshot() };
            }

            case 'retargetLockedRoot': {
                const rawTarget = action.cascadeId !== undefined ? action.cascadeId : action.conversationId;
                const cleanTarget = typeof rawTarget === 'string' ? rawTarget.trim() : '';
                if (!cleanTarget || !SAFE_CASCADE_ID_RE.test(cleanTarget)) { return fail(400, 'Invalid cascadeId'); }
                const winId = resolvePrivacyWindowId(action.windowId);
                const prevWin = getOrCreateWindowSelectionState(winId);
                const prevLock = lockToMainAgent;
                const nextWin = retargetWindowLockedRoot(prevWin, cleanTarget, {
                    trajectories: allTrajectories, knownSubagentIds: getEffectiveKnownSubagentIds(), topologyResolveRootId: resolveTopologyRootId,
                });
                setWindowSelectionState(nextWin);
                if (winId === activeWindowId) { lockToMainAgent = settings.lockToMainAgent = appSettings.lockToMainAgent = true; }
                selectionGeneration++;
                selectionRevision = Math.max(selectionRevision + 1, nextWin.selectionRevision);
                const myEpoch = backendEpoch, mySelGen = selectionGeneration;
                const preResolved = recomputeConversationResolution(winId);
                if (winId === activeWindowId && !prevLock) {
                    const commitReceipt = await persistAppSettingsPatch({ lockToMainAgent: true, legacyLockMigrated: true });
                    if (!commitReceipt.committed) {
                        if (selectionGeneration === mySelGen) {
                            setWindowSelectionState(prevWin);
                            lockToMainAgent = settings.lockToMainAgent = appSettings.lockToMainAgent = prevLock;
                            recomputeConversationResolution(winId);
                        }
                        return makeCommitFailureResponse('lockToMainAgent', commitReceipt, reqMasked);
                    }
                }
                if (winId === activeWindowId && backendEpoch === myEpoch && selectionGeneration === mySelGen) {
                    await syncActiveTelemetryForResolved(preResolved, myEpoch, mySelGen);
                    if (myEpoch !== backendEpoch || mySelGen !== selectionGeneration || winId !== activeWindowId) {
                        return { ok: true, result: { superseded: true }, snapshot: actionSnapshot() };
                    }
                    publishCurrentObservation(deps.now(), winId);
                    lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                    bumpStateRevision(); pushOverlayPayloadAsync();
                }
                const curWin = getOrCreateWindowSelectionState(winId);
                return {
                    ok: true,
                    result: { windowId: winId, lockToMainAgent: Boolean(curWin.lockToMainAgent), lockedRootId: curWin.lockedRootId, lockedMainId: curWin.lockedRootId, inspectedMemberId: curWin.inspectedMemberId, activeConversationId: preResolved.cascadeId },
                    messages: [buildSyncSettingsControlsMessage(reqMasked)],
                    snapshot: actionSnapshot(),
                };
            }

            case 'toggleLockMain':
            case 'toggleLockToMainAgent':
            case 'setLockToMainAgent': {
                const winId = resolvePrivacyWindowId(action.windowId);
                const prevWin = getOrCreateWindowSelectionState(winId);
                const prevLock = winId === activeWindowId ? lockToMainAgent : Boolean(prevWin.lockToMainAgent);
                const prevLockedMainId = prevWin.lockedRootId;
                const nextLock = typeof action.locked === 'boolean' ? action.locked : (typeof action.enabled === 'boolean' ? action.enabled : (typeof action.value === 'boolean' ? action.value : !prevLock));
                const nextWin = nextLock
                    ? enableLockToMainAgent(prevWin, { trajectories: allTrajectories, currentActiveId: trackedCascadeId, knownSubagentIds: getEffectiveKnownSubagentIds(), workspaceUris: activeWorkspaceUris, topologyResolveRootId: resolveTopologyRootId })
                    : disableLockToMainAgent(prevWin);
                setWindowSelectionState(nextWin);
                if (winId === activeWindowId) { lockToMainAgent = settings.lockToMainAgent = appSettings.lockToMainAgent = nextLock; }
                selectionGeneration++;
                selectionRevision = Math.max(selectionRevision + 1, nextWin.selectionRevision);
                const myEpoch = backendEpoch, mySelGen = selectionGeneration;
                const preResolved = recomputeConversationResolution(winId);
                if (winId === activeWindowId) {
                    const commitReceipt = await persistAppSettingsPatch({ lockToMainAgent: nextLock, legacyLockMigrated: true });
                    if (!commitReceipt.committed) {
                        if (selectionGeneration === mySelGen) {
                            setWindowSelectionState(prevWin);
                            lockToMainAgent = settings.lockToMainAgent = appSettings.lockToMainAgent = prevLock;
                            lockedMainId = prevLockedMainId;
                            recomputeConversationResolution(winId);
                        }
                        return makeCommitFailureResponse('lockToMainAgent', commitReceipt, reqMasked);
                    }
                }
                if (winId === activeWindowId && backendEpoch === myEpoch && selectionGeneration === mySelGen) {
                    await syncActiveTelemetryForResolved(preResolved, myEpoch, mySelGen);
                    if (myEpoch !== backendEpoch || mySelGen !== selectionGeneration || winId !== activeWindowId) {
                        return { ok: true, result: { superseded: true }, snapshot: actionSnapshot() };
                    }
                    publishCurrentObservation(deps.now(), winId);
                }
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                bumpStateRevision(); pushOverlayPayloadAsync();
                const curWin = getOrCreateWindowSelectionState(winId);
                return {
                    ok: true,
                    result: { windowId: winId, lockToMainAgent: Boolean(curWin.lockToMainAgent), lockedMainId: curWin.lockedRootId ?? preResolved.lockedMainId, lockedRootId: curWin.lockedRootId, inspectedMemberId: curWin.inspectedMemberId, activeConversationId: preResolved.cascadeId, committed: true },
                    messages: [buildSyncSettingsControlsMessage(reqMasked)],
                    snapshot: actionSnapshot(),
                };
            }

            case 'togglePause': {
                isPaused = typeof action.paused === 'boolean' ? action.paused : !isPaused;
                if (isPaused) {
                    if (pollTimer) {
                        clearTimeout(pollTimer);
                        pollTimer = undefined;
                    }
                    scheduledPollDelayMs = 0;
                } else {
                    scheduleNextPoll();
                }
                return {
                    ok: true,
                    result: { paused: isPaused },
                    messages: [{ command: 'setPaused', paused: isPaused }],
                    snapshot: actionSnapshot(),
                };
            }

            case 'toggleNativeHud': {
                return {
                    ok: true,
                    result: { expanded: Boolean(action.expanded) },
                };
            }

            case 'copyContextReport': {
                const text = buildContextReportText(getLanguage(), reqMasked, reqWindowId);
                const copiedHint = t('action.copied');
                return {
                    ok: true,
                    text,
                    copiedHint,
                    result: { text, copiedHint },
                };
            }

            case 'copyHandoffPrompt': {
                const winId = resolvePrivacyWindowId(reqWindowId);
                const handoff = buildHandoffV2ForCurrentSubject(getLanguage(), reqWindowId, reqMasked);
                const text = handoff.previewText;
                const copiedHint = t('action.copied');
                return {
                    ok: true,
                    text,
                    copiedHint,
                    result: {
                        text,
                        copiedHint,
                        windowId: winId,
                        subjectCascadeId: handoff.subjectCascadeId,
                        dataRevision: handoff.dataRevision,
                        allowlistedFields: handoff.allowlistedFields,
                    },
                };
            }

            case 'previewHandoffV2': {
                const winId = resolvePrivacyWindowId(reqWindowId);
                const active = winId === activeWindowId;
                const curWin = getOrCreateWindowSelectionState(winId);
                const resolution = active ? lastResolution : resolveWindowState(curWin).resolution;
                const expectedSelRev = active ? selectionRevision : curWin.selectionRevision;
                const scopedUsage = resolution.cascadeId && !resolution.hostPending
                    ? (currentUsage?.cascadeId === resolution.cascadeId ? currentUsage : monitorStore.getSnapshot(resolution.cascadeId) ?? null)
                    : null;
                const cachedObs = observationsByWindow.get(winId)?.value;
                const obs = (cachedObs && cachedObs.subjectCascadeId === resolution.cascadeId && cachedObs.selectionRevision === expectedSelRev)
                    ? cachedObs
                    : publishCurrentObservation(deps.now(), winId, resolution, scopedUsage);
                const reqCid = typeof action.cascadeId === 'string' && action.cascadeId.trim() ? action.cascadeId.trim() : null;
                if (reqCid && obs.subjectCascadeId && reqCid !== obs.subjectCascadeId) {
                    return { ok: false, statusCode: 409, error: 'Handoff subject mismatch', result: { staleSubject: true, windowId: winId, expectedCascadeId: obs.subjectCascadeId, requestedCascadeId: reqCid, dataRevision: obs.dataRevision } };
                }
                const handoff = buildHandoffV2ForCurrentSubject(getLanguage(), reqWindowId, reqMasked);
                const revisionMismatch = typeof action.dataRevision === 'number' && Number.isSafeInteger(action.dataRevision) && action.dataRevision !== handoff.dataRevision;
                if (revisionMismatch) {
                    const stalePayload = {
                        ok: false,
                        windowId: winId,
                        subjectCascadeId: handoff.subjectCascadeId,
                        dataRevision: handoff.dataRevision,
                        requestedDataRevision: action.dataRevision,
                        revisionMismatch: true,
                    };
                    return {
                        ok: false,
                        statusCode: 409,
                        error: 'Handoff data revision mismatch',
                        result: stalePayload,
                        messages: [{ command: 'handoffV2PreviewResult', ...stalePayload }],
                    };
                }
                const payload = { ...handoff, windowId: winId, markdown: handoff.previewText, text: handoff.previewText, revisionMismatch: false };
                return { ok: true, text: handoff.previewText, result: payload, messages: [{ command: 'handoffV2PreviewResult', ok: true, ...payload }] };
            }

            case 'dismissRecoveryBrief': {
                const eventKey = (typeof action.eventKey === 'string' && action.eventKey.trim()) || activeRecoveryBrief?.eventKey || '';
                if (!eventKey) { return { ok: false, statusCode: 400, error: 'Missing eventKey' }; }
                recoveryBriefTracker.dismiss(eventKey);
                const pDismiss = durableState.updateGlobalWithReceipt('dismissedRecoveryBriefKeys', recoveryBriefTracker.exportDismissedKeys());
                const commitReceipt = await durableState.flush();
                if (!commitReceipt.committed) { return makeCommitFailureResponse('dismissedRecoveryBriefKeys', commitReceipt); }
                await pDismiss;
                if (activeRecoveryBrief?.eventKey === eventKey) { activeRecoveryBrief = null; }
                return { ok: true, result: { dismissed: true, eventKey, committed: true }, messages: [{ command: 'recoveryBriefDismissed', eventKey }], snapshot: actionSnapshot() };
            }

            case 'exportSettingsBackup': {
                const nowMs = deps.now();
                const { payload, json } = buildSettingsBackupJson(getFullAppSettings(), pricingStore.getCustom(), nowMs);
                const filename = `antigravity-settings-backup-${toLocalDateKey(new Date(nowMs))}.json`;
                const mimeType = 'application/json;charset=utf-8';
                return {
                    ok: true, filename, content: json, mimeType,
                    result: { filename, content: json, mimeType, schemaVersion: payload.schemaVersion, keyCount: Object.keys(payload.settings).length },
                    messages: [{ command: 'settingsBackupExportResult', filename, content: json, ok: true }],
                };
            }

            case 'importSettingsBackup': {
                const parsed = parseAndValidateSettingsBackup(action.json ?? action.content ?? action.backup);
                if (!parsed.ok) {
                    return { ok: false, statusCode: 400, error: parsed.error, result: { ok: false, committed: false, error: parsed.error, strippedKeys: parsed.strippedKeys }, messages: [{ command: 'settingsBackupImportResult', ok: false, error: parsed.error }] };
                }
                const batch = await commitSettingsBatch(Object.entries(parsed.settingsPatch), { customPricing: parsed.customPricing, fallbackKey: 'settingsBackup' });
                if (!batch.ok) {
                    return batch.commitFailureResponse ?? { ok: false, statusCode: batch.statusCode, error: batch.error, result: { ok: false, committed: false, error: batch.error }, messages: [{ command: 'settingsBackupImportResult', ok: false, error: batch.error }] };
                }
                const resBody = { ok: true, committed: true, appliedKeys: batch.appliedKeys, strippedKeys: parsed.strippedKeys, customPricingImported: parsed.customPricing !== undefined, appSettings: getFullAppSettings(reqMasked) };
                return { ok: true, result: resBody, messages: [{ command: 'settingsBackupImportResult', ...resBody }, buildSyncSettingsControlsMessage(reqMasked)], snapshot: actionSnapshot() };
            }

            case 'exportRedactedDiagnostics': {
                const nowMs = deps.now();
                const obs = latestObservation ?? publishCurrentObservation(nowMs);
                const stale = getCombinedStaleState(nowMs);
                const curWin = getOrCreateWindowSelectionState(activeWindowId);
                const cdp = overlayManager.getStatus();
                const rootId = obs.rootCascadeId;
                const grp = rootId ? lastSwarmTopology.groupsByRootId.get(rootId) : undefined;
                const built = buildRedactedDiagnostics({
                    surface: 'app-sidecar', version, nowMs,
                    buildIds: { webviewClient: WEBVIEW_CLIENT_BUILD_ID, cdpOverlay: CDP_OVERLAY_CLIENT_BUILD_ID },
                    counters: {
                        pollCount, backendEpoch, selectionRevision, dataRevision, isPaused,
                        trajectoryCount: allTrajectories.length, modelConfigCount: cachedModelConfigs.length,
                        accountCount: accountSnapshots.size, dailyStoreDayCount: dailyStore.totalDays || 0,
                        stateFileSizeBytes: getStorageDiagnostics().stateFileSizeBytes, consecutiveFailures,
                    },
                    freshness: { isStale: stale.isStale, lastSuccessAtMs: stale.lastSuccessAtMs, staleSources: stale.staleSources, lastError: stale.lastError },
                    observation: obs, aliasMap: diagnosticAliasMap,
                    selection: { mode: lastResolution.mode, lockToMainAgent, lockedRootId: curWin.lockedRootId, inspectedMemberId: curWin.inspectedMemberId, lockPendingUnavailable: Boolean(curWin.lockPendingUnavailable) },
                    swarm: { groupCount: lastSwarmTopology.groupsByRootId.size, totalNodes: lastSwarmTopology.nodesById.size, activeMembers: grp?.activeMemberIds.length ?? 0, activeRootId: rootId, lastTickPolledCount: lastSwarmPollTick?.executedMemberIds.length ?? 0, lastTickDeferredCount: lastSwarmPollTick?.deferredMemberIds.length ?? 0 },
                    cacheTtl: latestPromptCacheTtl ? { ttlEstimateState: latestPromptCacheTtl.ttlEstimateState, measuredCacheState: latestPromptCacheTtl.measuredCacheState, clockAnomaly: latestPromptCacheTtl.clockAnomaly, idleSeconds: latestPromptCacheTtl.idleSeconds, causeKinds: latestPromptCacheTtl.possibleCauses.map(c => c.cause) } : null,
                    quotaRunway: Object.entries(quotaRunways).map(([poolKey, r]) => {
                        const wk = weeklyQuotaRunways[poolKey];
                        return { poolKey, status: r.status, ...(wk ? { weeklyStatus: wk.status, activeHours: wk.coverage.activeHours, activeDays: wk.coverage.activeDays, meetsThreshold: wk.coverage.meetsThreshold } : {}) };
                    }),
                    cdp: { state: cdp.state, diagnosticCode: cdp.diagnosticCode, composerEnabled: cdp.composerEnabled, topBarEnabled: cdp.topBarEnabled, fontSizePreset: appSettings.cdpOverlayFontSize, highContrast: appSettings.cdpOverlayHighContrast },
                    preferences: appSettings,
                });
                const filename = `antigravity-diagnostics-redacted-${toLocalDateKey(new Date(nowMs))}.json`;
                const mimeType = 'application/json;charset=utf-8';
                return { ok: true, filename, content: built.json, mimeType, result: { filename, content: built.json, mimeType, diagnostics: built.diagnostics }, messages: [{ command: 'redactedDiagnosticsResult', filename, content: built.json, ok: true }] };
            }

            case 'copyStatePath': {
                const text = reqMasked ? '[Redacted State Path]' : durableState.getFilePath();
                const copiedHint = t('action.copied');
                return {
                    ok: true,
                    text,
                    copiedHint,
                    result: { text, copiedHint },
                    messages: [{ command: 'configSaved', key: 'statePath' }],
                };
            }

            case 'setOrchestratorPricingMode': {
                const rawMode = action.mode !== undefined ? action.mode : action.value;
                const batch = await commitSettingsBatch([['orchestratorPricingMode', rawMode]], { fallbackKey: 'orchestratorPricingMode' });
                if (!batch.ok) { return batchErr(batch); }
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                return {
                    ok: true,
                    result: { orchestratorPricingMode: appSettings.orchestratorPricingMode, appSettings: getFullAppSettings(reqMasked), committed: true },
                    messages: [{ command: 'configSaved', key: 'orchestratorPricingMode' }, buildSyncSettingsControlsMessage(reqMasked)],
                    snapshot: actionSnapshot(),
                };
            }

            case 'setAppSetting':
            case 'updateSetting':
            case 'setConfig':
            case 'setPanelPref': {
                const key = typeof action.key === 'string' ? action.key.trim() : '';
                if (!key) { return fail(400, 'Missing setting key'); }
                const prevEffectiveLang = getLanguage();
                const batch = await commitSettingsBatch([[key, action.value]]);
                if (!batch.ok) { return batchErr(batch); }
                const normKey = batch.appliedKeys[0] || key;
                const langChanged = getLanguage() !== prevEffectiveLang;
                if (normKey === 'autoCheckUpdates' && appSettings.autoCheckUpdates) { triggerBackgroundUpdateCheck(); }
                const cdpStatus = overlayManager.getStatus();
                const outCdpStatus = reqMasked ? redactCdpStatusForPrivacy(cdpStatus) : cdpStatus;
                const msgs: Array<Record<string, unknown>> = [{ command: 'configSaved', key: normKey }, buildSyncSettingsControlsMessage(reqMasked)];
                if (action.command === 'setPanelPref') { msgs.unshift({ command: 'panelPrefUpdated', key: normKey, value: Boolean(action.value) }); }
                return {
                    ok: true,
                    ...(langChanged ? { reload: true } : {}),
                    result: { key: normKey, committed: true, settings: { ...settings }, appSettings: getFullAppSettings(reqMasked), cdpStatus: outCdpStatus, panelPrefs: { ...panelHintPrefs }, zoomLevel },
                    messages: msgs,
                    snapshot: actionSnapshot(),
                };
            }

            case 'setPollingInterval': {
                const batch = await commitSettingsBatch([['pollingInterval', action.value]], { fallbackKey: 'pollingInterval' });
                if (!batch.ok) { return batchErr(batch); }
                return { ok: true, result: { pollingInterval: settings.pollingInterval, committed: true }, messages: [{ command: 'configSaved', key: 'pollingInterval' }], snapshot: actionSnapshot() };
            }

            case 'setZoomLevel': {
                const batch = await commitSettingsBatch([['uiZoom', action.value]], { fallbackKey: 'panelZoomLevel' });
                if (!batch.ok) { return batchErr(batch); }
                return { ok: true, result: { zoomLevel, committed: true } };
            }

            case 'dismissAppOnboarding': {
                const rawDismissed = action.dismissed !== undefined ? action.dismissed : action.value;
                const nextDismissed = rawDismissed === undefined ? true : Boolean(rawDismissed);
                const batch = await commitSettingsBatch([['appOnboardingDismissed', nextDismissed]], { fallbackKey: 'appOnboardingDismissed' });
                if (!batch.ok) { return batchErr(batch); }
                const dismissed = Boolean(appSettings.appOnboardingDismissed);
                return {
                    ok: true,
                    result: { appOnboardingDismissed: dismissed, dismissed, committed: true, appSettings: getFullAppSettings(reqMasked) },
                    messages: [
                        { command: 'appOnboardingDismissed', ok: true, dismissed, appOnboardingDismissed: dismissed },
                        { command: 'configSaved', key: 'appOnboardingDismissed' },
                        buildSyncSettingsControlsMessage(reqMasked),
                    ],
                    snapshot: actionSnapshot(),
                };
            }

            case 'updateAppSettings':
            case 'updateSettings': {
                const bag = (action.settings && typeof action.settings === 'object' && !Array.isArray(action.settings))
                    ? (action.settings as Record<string, unknown>)
                    : ((action.patch && typeof action.patch === 'object' && !Array.isArray(action.patch))
                        ? (action.patch as Record<string, unknown>)
                        : action);
                const ignoredKeys = new Set([
                    'command', 'settings', 'patch', 'conversationId', 'workspaceUris', 'viewMode', 'windowId', 'sourceInstanceId',
                    'focusRevision', 'backendEpoch', 'conversationCleared', 'isNewConversation',
                    'lastUpdateCheck', 'updateStatus', 'releaseInfo', 'assetUrl', 'assetName', 'checksumsUrl',
                ]);
                const prevEffectiveLang = getLanguage();
                const batch = await commitSettingsBatch(Object.entries(bag).filter(([k]) => !ignoredKeys.has(k)));
                if (!batch.ok) { return batchErr(batch); }
                const langChanged = getLanguage() !== prevEffectiveLang;
                const cdpStatus = overlayManager.getStatus();
                return {
                    ok: true,
                    ...(langChanged ? { reload: true } : {}),
                    result: { updatedKeys: batch.appliedKeys, committed: true, settings: { ...settings }, appSettings: getFullAppSettings(reqMasked), cdpStatus: reqMasked ? redactCdpStatusForPrivacy(cdpStatus) : cdpStatus, panelPrefs: { ...panelHintPrefs }, zoomLevel },
                    messages: [...batch.appliedKeys.map(k => ({ command: 'configSaved', key: k })), buildSyncSettingsControlsMessage(reqMasked)],
                    snapshot: actionSnapshot(),
                };
            }

            case 'checkForUpdates': {
                const res = await runUpdateCheck(action.force !== false);
                const avail = lastUpdateStatusView?.hasUpdate ?? Boolean(res.hasUpdate);
                const msgPayload: Record<string, unknown> = {
                    type: 'updateCheckResult', command: 'updateCheckResult', status: res.status,
                    currentVersion: res.currentVersion, latestVersion: res.latestVersion ?? lastUpdateStatusView?.latestVersion ?? null,
                    hasUpdate: avail, updateAvailable: avail, checkedAt: res.checkedAt,
                    releaseUrl: res.releaseInfo?.releaseUrl ?? lastUpdateStatusView?.releaseUrl ?? null,
                    releaseNotesSummary: res.releaseInfo?.releaseNotesSummary ?? lastUpdateStatusView?.releaseNotesSummary ?? null,
                    releaseInfo: res.releaseInfo ?? lastCachedReleaseInfo ?? null,
                    error: reqMasked && res.error ? updateCheckFailedMsg() : (res.error ?? null),
                };
                return { ok: res.status !== 'error', statusCode: 200, result: msgPayload, messages: [msgPayload], snapshot: actionSnapshot() };
            }

            case 'applyPluginUpdate': {
                const diskLatest = appSettings.lastUpdateCheck?.latestVersion ?? null;
                let releaseInfo: PluginReleaseInfo | null = lastCachedReleaseInfo;
                if (releaseInfo && ((diskLatest && releaseInfo.version !== diskLatest) || !isUpdateAvailableForVersion({ checkedAt: deps.now(), latestVersion: releaseInfo.version }, version))) {
                    releaseInfo = lastCachedReleaseInfo = null;
                }
                let targetTagOrVersion: string | undefined = releaseInfo?.tagName || releaseInfo?.version;
                const mkRes = (ok: boolean, payload: Record<string, unknown>, error?: string): SidecarActionHttpBody => ({
                    ok, statusCode: 200, ...(error ? { error } : {}), result: payload, messages: [payload], snapshot: actionSnapshot(),
                });
                if (!releaseInfo) {
                    const checked = await runUpdateCheck(true);
                    const checkedAvail = checked.latestVersion
                        ? isUpdateAvailableForVersion({ checkedAt: checked.checkedAt, latestVersion: checked.latestVersion }, version)
                        : Boolean(checked.hasUpdate);
                    if (checked.releaseInfo && checkedAvail) {
                        releaseInfo = checked.releaseInfo;
                        targetTagOrVersion = checked.releaseInfo.tagName || checked.releaseInfo.version;
                    } else if (checkedAvail && checked.latestVersion) {
                        targetTagOrVersion = `v${checked.latestVersion.replace(/^v/i, '')}`;
                    } else if (!checkedAvail && checked.status !== 'error') {
                        return mkRes(true, { type: 'pluginUpdateResult', command: 'pluginUpdateResult', ok: true, previousVersion: version, installedVersion: version, requiresReload: false, message: tBi(`Already on the latest version (v${version}).`, `当前已是最新版本（v${version}）。`) });
                    } else {
                        const errMsg = (!reqMasked && checked.error) || tBi('No downloadable plugin release found. Run Check for Updates first.', '未找到可下载的插件版本，请先检查更新。');
                        return mkRes(false, { type: 'pluginUpdateResult', command: 'pluginUpdateResult', ok: false, previousVersion: version, installedVersion: version, requiresReload: false, message: errMsg, error: errMsg }, errMsg);
                    }
                }
                const targetPluginDir = resolveLivePluginDir();
                const applied = await deps.applyAppPluginUpdate({ targetPluginDir, ...(releaseInfo ? { releaseInfo } : {}), ...(targetTagOrVersion ? { targetTagOrVersion } : {}), currentVersion: version, reResolveRelease: true });
                if (applied.ok) {
                    lastUpdateStatusView = {
                        currentVersion: version, latestVersion: applied.installedVersion, updateAvailable: false, hasUpdate: false, status: 'applied', checkedAt: deps.now(),
                        releaseUrl: releaseInfo?.releaseUrl ?? lastUpdateStatusView?.releaseUrl ?? null,
                        releaseNotesSummary: releaseInfo?.releaseNotesSummary ?? lastUpdateStatusView?.releaseNotesSummary ?? null,
                        error: null, requiresReload: applied.requiresReload !== false,
                    };
                    bumpStateRevision();
                }
                const error = !applied.ok && reqMasked
                    ? tBi('Plugin update failed.', '插件更新失败。') : (applied.error || applied.message);
                const msgPayload: Record<string, unknown> = {
                    type: 'pluginUpdateResult', command: 'pluginUpdateResult', ok: applied.ok,
                    previousVersion: applied.previousVersion, installedVersion: applied.installedVersion,
                    requiresReload: applied.ok ? true : Boolean(applied.requiresReload),
                    checksumVerified: applied.checksumVerified, rolledBack: applied.rolledBack,
                    targetPluginDir: reqMasked ? '[Redacted Plugin Dir]' : targetPluginDir,
                    message: applied.ok ? ((!reqMasked && applied.message) || tBi(`Updated to v${applied.installedVersion}. Toggle the plugin Off -> On in Antigravity Customizations to reload (do not force-kill Antigravity).`, `已升级至 v${applied.installedVersion}。请在 Antigravity 插件管理中将插件关闭再重新开启以安全重载。`)) : error,
                    ...(!applied.ok && error ? { error } : {}),
                };
                return mkRes(applied.ok, msgPayload, applied.ok ? undefined : error);
            }

            case 'openExternalUrl': {
                const safeUrl = validateExternalUrl(action.url);
                if (!safeUrl) {
                    return { ok: false, statusCode: 403, error: 'External URL rejected by strict HTTPS allowlist' };
                }
                await deps.openExternalUrl(safeUrl);
                return {
                    ok: true,
                    result: { opened: safeUrl },
                };
            }

            case 'saveCustomPricing':
            case 'savePricing':
            case 'updatePricingOverrides':
            case 'resetCustomPricing':
            case 'resetPricing': {
                const isReset = action.command === 'resetCustomPricing' || action.command === 'resetPricing';
                let pOp: Promise<void>;
                if (isReset) {
                    pOp = pricingStore.reset();
                } else {
                    const sanitized = sanitizeCustomPricingOverrides(action.overrides ?? action.pricing ?? action.value);
                    if (!sanitized) { return fail(400, 'Invalid pricing overrides payload'); }
                    pOp = pricingStore.setAll(sanitized);
                }
                const commitReceipt = await durableState.flush();
                if (!commitReceipt.committed) { return makeCommitFailureResponse('customPricing', commitReceipt, reqMasked); }
                await pOp;
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                return {
                    ok: true,
                    result: { customPricing: pricingStore.getCustom(), committed: true },
                    messages: [{ command: isReset ? 'pricingReset' : 'pricingSaved' }],
                    snapshot: actionSnapshot(),
                };
            }

            case 'selectAccount': {
                const rawAccount = action.accountHandle ?? action.accountKey ?? action.email;
                if (rawAccount === null || rawAccount === undefined || rawAccount === '') { selectedAccountKey = ''; }
                else if (typeof rawAccount === 'string') {
                    const resolvedEmail = resolveAccountIdentifier(rawAccount);
                    if (resolvedEmail && !accountSnapshots.has(resolvedEmail) && resolvedEmail !== cachedUserInfo?.email && resolvedEmail !== currentAccountEmail) {
                        return fail(404, 'Account snapshot not found');
                    }
                    selectedAccountKey = resolvedEmail;
                } else { return fail(400, 'Invalid account identifier'); }
                const effectiveEmail = selectedAccountKey || cachedUserInfo?.email || currentAccountEmail || '';
                const effectiveHandle = effectiveEmail ? getAccountHandle(effectiveEmail) : '';
                return { ok: true, result: { activeAccountKey: reqMasked ? effectiveHandle : effectiveEmail, accountHandle: effectiveHandle }, snapshot: actionSnapshot() };
            }

            case 'removeAccountSnapshot':
            case 'removeAccount': {
                const email = resolveAccountIdentifier(action.accountHandle ?? action.email ?? action.accountKey);
                if (!email) { return fail(400, 'Missing account identifier'); }
                const snap = accountSnapshots.get(email);
                if (!snap) { return fail(404, 'Account snapshot not found'); }
                if (snap.isActive) { return fail(400, 'Cannot remove the currently active account'); }
                const removedHandle = getAccountHandle(email);
                accountSnapshots.delete(email);
                const prevSelected = selectedAccountKey;
                if (selectedAccountKey === email) { selectedAccountKey = ''; }
                const pAcc = durableState.updateGlobalWithReceipt('accountSnapshots', [...accountSnapshots.values()]);
                const commitReceipt = await durableState.flush();
                if (!commitReceipt.committed) {
                    accountSnapshots.set(email, snap);
                    selectedAccountKey = prevSelected;
                    return makeCommitFailureResponse('accountSnapshots', commitReceipt, reqMasked);
                }
                await pAcc;
                return { ok: true, result: { removed: reqMasked ? removedHandle : email, removedHandle, accountSnapshots: formatAccountSnaps(reqMasked), committed: true }, snapshot: actionSnapshot() };
            }

            case 'setAccountBillingDay': {
                const email = resolveAccountIdentifier(action.accountHandle ?? action.email ?? action.accountKey);
                const day = Number(action.day);
                if (!email || !isBillingDaySetting(day) || !(accountSnapshots.has(email) || email === currentAccountEmail || email === cachedUserInfo?.email)) {
                    return { ok: false, statusCode: 400, error: 'Invalid account identifier or billing day (0-31)' };
                }
                const prevDay = billingDaysMap[email];
                if (day > 0) { billingDaysMap[email] = day; } else { delete billingDaysMap[email]; }
                const pBill = durableState.updateGlobalWithReceipt('accountBillingDays', { ...billingDaysMap });
                const commitReceipt = await durableState.flush();
                if (!commitReceipt.committed) {
                    if (prevDay !== undefined) { billingDaysMap[email] = prevDay; } else { delete billingDaysMap[email]; }
                    return makeCommitFailureResponse('accountBillingDay', commitReceipt, reqMasked);
                }
                await pBill;
                const handle = getAccountHandle(email);
                return {
                    ok: true,
                    result: { ...(reqMasked ? { accountHandle: handle } : { email, accountHandle: handle }), day, billingDays: reqMasked ? redactBillingDaysForPrivacy(billingDaysMap) : { ...billingDaysMap }, committed: true },
                    messages: [{ command: 'configSaved', key: 'accountBillingDay' }],
                    snapshot: actionSnapshot(),
                };
            }

            case 'openFileInAuxPane': {
                const check = validateRevealTargetPath(action.uri, getWorkspaceRevealRoots(action.windowId));
                if (!check.ok || check.isDirectory) {
                    return { ok: false, statusCode: check.statusCode ?? 403, error: 'File is outside the registered workspace or unavailable' };
                }
                return { ok: true };
            }
            case 'revealPath': {
                const rawPath = action.path !== undefined
                    ? action.path
                    : (action.targetPath !== undefined ? action.targetPath : action.uri);
                // Positive authorization ONLY against active host registered workspace roots!
                const check = validateRevealTargetPath(rawPath, getWorkspaceRevealRoots(action.windowId));
                if (!check.ok || !check.resolvedPath) {
                    return { ok: false, statusCode: check.statusCode ?? 403, error: check.error || 'Forbidden path' };
                }
                await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory));
                return {
                    ok: true,
                    result: { revealed: reqMasked ? '[Redacted Path]' : check.resolvedPath },
                    messages: [{ command: 'stateFileActionResult', action: 'reveal', ok: true }],
                };
            }

            case 'revealStateFile':
            case 'openStateFile': {
                const filePath = durableState.getFilePath();
                const target = fs.existsSync(filePath) ? filePath : path.dirname(filePath);
                const check = validateRevealTargetPath(target, getStateFileRevealRoots());
                if (!check.ok || !check.resolvedPath) {
                    return {
                        ok: false,
                        statusCode: check.statusCode ?? 404,
                        error: check.error || 'State file does not exist',
                        messages: [{ command: 'stateFileActionResult', action: 'reveal', ok: false }],
                    };
                }
                await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory));
                return {
                    ok: true,
                    result: { revealed: reqMasked ? '[Redacted State Path]' : check.resolvedPath },
                    messages: [{ command: 'stateFileActionResult', action: 'reveal', ok: true }],
                };
            }

            case 'readGlobalRulesFile':
            case 'saveGlobalRulesFile':
            case 'openGlobalRulesFile':
            case 'revealGlobalRulesFile': {
                const home = deps.homedir();
                const safePath = reqMasked ? '~/.gemini/GEMINI.md' : getGlobalRulesPath(home);
                const grSymErr = tBi('Refused: global rules symlink rejected.', '已拒绝全局规则操作：不允许符号链接目标。');
                const mkGrErr = (command: string, statusCode: number, error: string, extra?: Record<string, unknown>): SidecarActionHttpBody => {
                    const p = { command, ok: false, error, path: safePath, ...extra };
                    return { ok: false, statusCode, error, result: p, messages: [p] };
                };
                if (action.command === 'readGlobalRulesFile') {
                    const raw = readGlobalRulesStatus({ homedir: home, includeContent: true });
                    const pPath = reqMasked ? '~/.gemini/GEMINI.md' : raw.path;
                    if (raw.error) {
                        const isSym = raw.error === 'SYMLINK_ESCAPE';
                        return mkGrErr('globalRulesFileContent', isSym ? 403 : 500, isSym ? grSymErr : tBi('Failed to read global rules file.', '读取全局规则文件失败。'), {
                            errorCode: raw.error, path: pPath, exists: isSym ? false : raw.exists, sizeBytes: isSym ? 0 : raw.sizeBytes, tooLarge: false, content: '',
                        });
                    }
                    const s: GlobalRulesStatus = { ...raw, path: pPath };
                    return { ok: true, result: { ok: true, ...s }, messages: [{ command: 'globalRulesFileContent', ok: true, ...s }] };
                }
                if (action.command === 'saveGlobalRulesFile') {
                    if (typeof action.content !== 'string') {
                        return mkGrErr('globalRulesSaveResult', 400, tBi('Global rules content must be a string.', '全局规则内容必须为字符串。'));
                    }
                    const byteLen = Buffer.byteLength(action.content, 'utf8');
                    if (byteLen > GLOBAL_RULES_MAX_BYTES) {
                        const maxKiB = Math.round(GLOBAL_RULES_MAX_BYTES / 1024);
                        return mkGrErr('globalRulesSaveResult', 413, tBi(`Global rules file exceeds the ${maxKiB} KiB limit.`, `全局规则内容超过 ${maxKiB} KiB 上限。`), {
                            errorCode: 'TOO_LARGE', maxBytes: GLOBAL_RULES_MAX_BYTES, sizeBytes: byteLen, tooLarge: true,
                        });
                    }
                    try {
                        const saved = writeGlobalRulesFile(action.content, home, { createOnly: action.createOnly === true });
                        const meta: GlobalRulesStatus = { path: reqMasked ? '~/.gemini/GEMINI.md' : saved.path, exists: saved.exists, sizeBytes: saved.sizeBytes, tooLarge: saved.tooLarge, content: '' };
                        dataRevision++;
                        bumpStateRevision();
                        return { ok: true, result: { ok: true, ...meta }, messages: [{ command: 'globalRulesSaveResult', ok: true, ...meta }], snapshot: actionSnapshot() };
                    } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        const isConflict = (err as NodeJS.ErrnoException)?.code === 'EEXIST';
                        if (isConflict) {
                            return mkGrErr('globalRulesSaveResult', 409, tBi('Global rules file was created externally. Click Load & Edit before saving.', '全局规则文件已由外部创建，请先点击「加载并编辑」再保存。'), {
                                errorCode: 'ALREADY_EXISTS', exists: true,
                            });
                        }
                        const isSym = /symlink|outside ~\/\.gemini/i.test(m), isNotFile = /not a regular file/i.test(m);
                        return mkGrErr('globalRulesSaveResult', isSym || isNotFile ? 403 : 500,
                            isSym ? grSymErr : (isNotFile ? tBi('Target path is not a regular file.', '目标路径不是常规文件。') : tBi('Failed to save global rules file.', '保存全局规则文件失败。')),
                            isSym ? { errorCode: 'SYMLINK_ESCAPE' } : undefined);
                    }
                }
                const isOpen = action.command === 'openGlobalRulesFile';
                const actName = isOpen ? 'open' : 'reveal';
                const pre = validateGlobalRulesRevealTarget({ homedir: home });
                if (!pre.ok && (isOpen ? pre.statusCode === 403 : true)) {
                    const code = pre.statusCode ?? (isOpen ? 403 : 404);
                    return mkGrErr('globalRulesActionResult', code, code === 403 ? grSymErr : tBi('Global rules directory (~/.gemini/) does not exist yet.', '全局规则目录（~/.gemini/）尚未创建。'), {
                        action: actName, exists: false, ...(code === 403 ? { errorCode: 'SYMLINK_ESCAPE' } : {}),
                    });
                }
                if (isOpen && !pre.exists) {
                    try {
                        writeGlobalRulesFile(DEFAULT_GLOBAL_RULES_TEMPLATE, home, { createOnly: true });
                    } catch (err) {
                        if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') {
                            const isSym = /symlink|outside ~\/\.gemini/i.test(err instanceof Error ? err.message : String(err));
                            return mkGrErr('globalRulesActionResult', isSym ? 403 : 500, isSym ? grSymErr : tBi('Failed to initialize global rules file.', '初始化全局规则文件失败。'), {
                                action: 'open', exists: false, ...(isSym ? { errorCode: 'SYMLINK_ESCAPE' } : {}),
                            });
                        }
                    }
                }
                const check = isOpen ? validateGlobalRulesRevealTarget({ homedir: home }) : pre;
                if (!check.ok || !check.resolvedPath || (isOpen && check.isDirectory)) {
                    return mkGrErr('globalRulesActionResult', check.statusCode ?? 403, tBi('Global rules path validation failed.', '无法验证全局规则文件路径。'), { action: actName, exists: false });
                }
                try {
                    if (isOpen) { await (deps.openFileInOs ?? defaultOpenFileInOs)(check.resolvedPath); }
                    else { await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory)); }
                } catch {
                    return mkGrErr('globalRulesActionResult', 500, isOpen ? tBi('Failed to open global rules file.', '打开全局规则文件失败。') : tBi('Failed to reveal global rules file.', '定位全局规则文件失败。'), {
                        action: actName, exists: Boolean(check.exists),
                    });
                }
                const rawMeta = readGlobalRulesStatus({ homedir: home, includeContent: false });
                const meta: GlobalRulesStatus = { ...rawMeta, path: reqMasked ? '~/.gemini/GEMINI.md' : rawMeta.path, content: '' };
                if (isOpen) { dataRevision++; bumpStateRevision(); }
                const extra = isOpen
                    ? { opened: meta.path }
                    : { revealed: reqMasked ? (check.isDirectory ? '~/.gemini/' : '~/.gemini/GEMINI.md') : check.resolvedPath, isDirectory: Boolean(check.isDirectory) };
                const okMsg = { command: 'globalRulesActionResult', action: actName, ok: true, ...(isOpen ? {} : { isDirectory: Boolean(check.isDirectory) }), ...meta };
                return { ok: true, result: { ok: true, action: actName, ...extra, ...meta }, messages: [okMsg], ...(isOpen ? { snapshot: actionSnapshot() } : {}) };
            }

            case 'historyAction': {
                const histAction = typeof action.action === 'string' ? action.action : '';
                let targetPath = '';
                let allowedRoots: string[] = [];
                if (histAction === 'workspace') {
                    targetPath = typeof action.uri === 'string' ? action.uri : '';
                    // Positive authorization ONLY against active host registered workspace roots (NEVER historical trajectories!)
                    allowedRoots = getWorkspaceRevealRoots(action.windowId);
                } else if (histAction === 'record' || histAction === 'pb') {
                    const cid = typeof action.cascadeId === 'string' ? action.cascadeId.trim() : '';
                    if (!SAFE_CASCADE_ID_RE.test(cid)) {
                        return { ok: false, statusCode: 400, error: 'Invalid cascadeId' };
                    }
                    const agyRoot = path.join(deps.homedir(), '.gemini', 'antigravity');
                    allowedRoots = getHistoryArtifactRevealRoots();
                    if (histAction === 'pb') {
                        targetPath = path.join(agyRoot, 'conversations', `${cid}.pb`);
                    } else {
                        const candidates = [
                            path.join(agyRoot, 'brain', cid),
                            path.join(agyRoot, 'browser_recordings', cid),
                            path.join(agyRoot, 'conversations'),
                        ];
                        targetPath = candidates.find(c => fs.existsSync(c)) || candidates[2];
                    }
                } else {
                    return { ok: false, statusCode: 400, error: 'Unknown history action' };
                }
                const check = validateRevealTargetPath(targetPath, allowedRoots);
                if (!check.ok || !check.resolvedPath) {
                    return { ok: false, statusCode: check.statusCode ?? 403, error: check.error || 'Path not allowed' };
                }
                await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory));
                return { ok: true, result: { revealed: reqMasked ? '[Redacted Path]' : check.resolvedPath } };
            }

            case 'calendarFilterSource': {
                const v = action.source ?? action.value;
                if (v !== 'all' && v !== 'app' && v !== 'ide' && v !== 'cli') { return fail(400, 'Invalid calendar source filter'); }
                calendarSourceFilter = v;
                return { ok: true, result: { sourceFilter: v }, snapshot: actionSnapshot() };
            }
            case 'calendarSetMetric': {
                const v = action.metric ?? action.value;
                if (v !== 'tokens' && v !== 'cost') { return fail(400, 'Invalid calendar metric mode'); }
                calendarMetricMode = v;
                return { ok: true, result: { metricMode: v }, snapshot: actionSnapshot() };
            }
            case 'calendarSetPeriod': {
                const v = action.period ?? action.value;
                if (v !== 'daily' && v !== 'weekly' && v !== 'monthly' && v !== 'year' && v !== 'all') { return fail(400, 'Invalid calendar period mode'); }
                calendarPeriodMode = v;
                return { ok: true, result: { periodMode: v }, snapshot: actionSnapshot() };
            }
            case 'calendarSetView': {
                const v = action.view ?? action.value;
                if (v === '' || v === null || v === undefined || v === 'both') { calendarViewMode = undefined; }
                else if (v === 'heatmap' || v === 'monthGrid') { calendarViewMode = v; }
                else { return fail(400, 'Invalid calendar view mode'); }
                return { ok: true, result: { viewMode: calendarViewMode ?? 'both' }, snapshot: actionSnapshot() };
            }
            case 'calendarSelectDate': {
                const v = action.date;
                if (v === null || v === undefined || v === '') { calendarSelectedDate = ''; }
                else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) { calendarSelectedDate = v.trim(); }
                else { return fail(400, 'Invalid calendar date (expected YYYY-MM-DD)'); }
                return { ok: true, result: { selectedDate: calendarSelectedDate || null }, snapshot: actionSnapshot() };
            }
            case 'calendarJumpDate': {
                const rawDate = typeof action.date === 'string' ? action.date.trim() : '';
                if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) { return fail(400, 'Invalid calendar jump date (expected YYYY-MM-DD)'); }
                const parts = rawDate.split('-');
                const yr = Number(action.year ?? parts[0]), mo = Number(action.month ?? parts[1]);
                if (Number.isInteger(yr) && yr >= 2020 && yr <= 2100 && Number.isInteger(mo) && mo >= 1 && mo <= 12) { calendarYear = yr; calendarMonth = mo; }
                calendarSelectedDate = rawDate;
                calendarPeriodMode = 'daily';
                return { ok: true, result: { selectedDate: calendarSelectedDate, year: calendarYear, month: calendarMonth }, snapshot: actionSnapshot() };
            }

            case 'calendarExportCsv':
            case 'calendarExportJson':
            case 'calendarExportMarkdown': {
                const fmt = action.command === 'calendarExportCsv' ? 'csv' : (action.command === 'calendarExportMarkdown' ? 'markdown' : 'json');
                const nowMs = deps.now();
                await refreshCliUsageCacheAsync(false);
                const baseOpts = buildCalendarRenderOptions(nowMs);
                const reqSrc = action.surfaceFilter ?? action.sourceFilter ?? action.source;
                const sourceFilter: CalendarSourceFilter = (reqSrc === 'all' || reqSrc === 'app' || reqSrc === 'ide' || reqSrc === 'cli') ? reqSrc : (baseOpts.sourceFilter ?? calendarSourceFilter);
                const rawStart = String(action.startDate ?? action.rangeStart ?? '').trim();
                const rawEnd = String(action.endDate ?? action.rangeEnd ?? '').trim();
                const validSelectedDates = Array.isArray(action.selectedDates)
                    ? (action.selectedDates as unknown[]).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())).map(d => d.trim()).sort()
                    : null;
                const ext = fmt === 'csv' ? 'csv' : (fmt === 'markdown' ? 'md' : 'json');
                const filename = `antigravity-usage-${sourceFilter}-${calendarPeriodMode}-${toLocalDateKey(new Date(nowMs))}.${ext}`;
                const mimeType = fmt === 'csv' ? 'text/csv;charset=utf-8' : (fmt === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8');
                if (validSelectedDates && validSelectedDates.length === 0) {
                    const emptyContent = fmt === 'json' ? '[]' : '';
                    return { ok: true, filename, content: emptyContent, mimeType, result: { filename, content: emptyContent, mimeType, rowCount: 0 } };
                }
                const exportStore = reqMasked ? buildRedactedDailyStore(redactDailyStoreSnapshotForPrivacy(dailyStore.serialize())) : dailyStore;
                const mergedOpts: CalendarRenderOptions = {
                    ...baseOpts, sourceFilter,
                    ...(rawStart ? { rangeStart: rawStart } : {}), ...(rawEnd ? { rangeEnd: rawEnd } : {}),
                    ...(!rawStart && !rawEnd && validSelectedDates?.length ? { rangeStart: validSelectedDates[0], rangeEnd: validSelectedDates[validSelectedDates.length - 1] } : {}),
                    ...(typeof action.selectedDate === 'string' ? { selectedDate: action.selectedDate.trim() } : {}),
                    ...(action.exportSelectedDateOnly === true ? { exportSelectedDateOnly: true } : {}),
                    ...(reqMasked ? {
                        liveLedger: {
                            active: dailyLedger.getTodayActive().map(redactActiveLedgerBucket),
                            settled: dailyLedger.getSettledEntries().map(redactSettledLedgerEntry),
                            customPricing: pricingStore.getCustom(), defaultSurface: 'app',
                        },
                    } : {}),
                };
                const bundle = buildCalendarExportData(exportStore, calendarYear, calendarMonth, mergedOpts);
                const rows = validSelectedDates ? bundle.rows.filter(r => validSelectedDates.includes(r.date)) : bundle.rows;
                const rebuilt = Boolean(validSelectedDates && rows.length !== bundle.rows.length);
                const rawContent = fmt === 'markdown'
                    ? (rows.length === 0 ? '' : (rebuilt ? buildCalendarExportMarkdown(rows, bundle.meta) : bundle.markdown))
                    : (fmt === 'csv' ? (rebuilt ? buildCalendarExportCsv(rows, bundle.meta) : bundle.csv) : (rebuilt ? buildCalendarExportJson(rows, bundle.meta) : bundle.json));
                const content = reqMasked && rawContent ? redactTextForPrivacy(rawContent) : rawContent;
                return { ok: true, filename, content, mimeType, result: { filename, content, mimeType, rowCount: rows.length } };
            }

            case 'switchCalendarMonth': {
                const yr = Number(action.year), mo = Number(action.month);
                if (!Number.isInteger(yr) || yr < 2020 || yr > 2100 || !Number.isInteger(mo) || mo < 1 || mo > 12) { return { ok: false, statusCode: 400, error: 'Invalid calendar year/month' }; }
                calendarYear = yr; calendarMonth = mo;
                return { ok: true, result: { year: calendarYear, month: calendarMonth }, snapshot: actionSnapshot() };
            }

            case 'clearCalendarHistory': {
                dailyStore.clear();
                calendarSelectedDate = '';
                const r = await durableState.flush();
                if (!r.committed) { return makeCommitFailureResponse('calendarHistory', r, reqMasked); }
                return { ok: true, result: { cleared: true, committed: true }, snapshot: actionSnapshot() };
            }

            case 'clearToolCatalog': {
                gmTracker.clearToolCatalog();
                lastGMSummary = gmTracker.getCachedSummary();
                const pGm = durableState.updateGlobalWithReceipt('gmTrackerState', gmTracker.serialize());
                const pSum = durableState.updateGlobalWithReceipt('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
                const r = await durableState.flush();
                if (!r.committed) { return makeCommitFailureResponse('toolCatalog', r, reqMasked); }
                await Promise.all([pGm, pSum]);
                return { ok: true, result: { cleared: true, committed: true }, snapshot: actionSnapshot() };
            }

            case 'recheckCdp': {
                const enabled = Boolean(appSettings.appComposerRingEnabled || appSettings.appTopBarEnabled);
                let cdpStatus: CdpStatus = typeof overlayManager.recheck === 'function'
                    ? await overlayManager.recheck().catch(() => overlayManager.getStatus())
                    : await overlayManager.setToggles({ appComposerRingEnabled: Boolean(appSettings.appComposerRingEnabled), appTopBarEnabled: Boolean(appSettings.appTopBarEnabled) }).catch(() => overlayManager.getStatus());
                if (enabled && cdpStatus.state === 'connected') { cdpStatus = await overlayManager.updatePayload(buildCdpOverlayPayload(deps.now(), activeWindowId, true)).catch(() => cdpStatus); }
                if (cdpStatus.targetUrl) { try { overlayAllowedOrigin = new URL(cdpStatus.targetUrl).origin; } catch { /* ignore */ } }
                else if (cdpStatus.state === 'disabled') { overlayAllowedOrigin = undefined; }
                bumpStateRevision();
                const outCdpStatus = reqMasked ? redactCdpStatusForPrivacy(cdpStatus) : cdpStatus;
                const msg = { type: 'cdpStatusResult', command: 'cdpStatusResult', cdpStatus: outCdpStatus };
                return { ok: true, result: msg, messages: [msg, buildSyncSettingsControlsMessage(reqMasked)], snapshot: actionSnapshot() };
            }

            case 'setupCdpLauncher':
            case 'removeCdpLauncher':
            case 'revealCdpLauncher': {
                const isReveal = action.command === 'revealCdpLauncher';
                const launcherRes = action.command === 'setupCdpLauncher' ? deps.createCdpLauncher() : (isReveal ? deps.revealCdpLauncher() : deps.removeCdpLauncher());
                let cdpStatus: CdpStatus = !isReveal && typeof overlayManager.recheck === 'function'
                    ? await overlayManager.recheck().catch(() => overlayManager.getStatus())
                    : overlayManager.getStatus();
                if (!isReveal && (appSettings.appComposerRingEnabled || appSettings.appTopBarEnabled) && cdpStatus.state === 'connected') {
                    cdpStatus = await overlayManager.updatePayload(buildCdpOverlayPayload(deps.now(), activeWindowId, true)).catch(() => cdpStatus);
                }
                const outCdpStatus = reqMasked ? redactCdpStatusForPrivacy({ ...cdpStatus, launcherStatus: launcherRes.status }) : { ...cdpStatus, launcherStatus: launcherRes.status };
                if (!isReveal) { bumpStateRevision(); }
                const errOut = launcherRes.error ? (reqMasked ? redactTextForPrivacy(launcherRes.error) : launcherRes.error) : undefined;
                const launcherMsg: Record<string, unknown> = {
                    type: 'cdpLauncherResult', command: 'cdpLauncherResult', action: action.command, ok: launcherRes.ok,
                    launcherStatus: outCdpStatus.launcherStatus,
                    messageEn: reqMasked ? redactTextForPrivacy(launcherRes.messageEn) : launcherRes.messageEn,
                    messageZh: reqMasked ? redactTextForPrivacy(launcherRes.messageZh) : launcherRes.messageZh,
                    ...(errOut ? { error: errOut } : {}), cdpStatus: outCdpStatus,
                };
                const syncMsg = { ...buildSyncSettingsControlsMessage(reqMasked), cdpStatus: outCdpStatus };
                const msgs = isReveal ? [launcherMsg, syncMsg] : [launcherMsg, { type: 'cdpStatusResult', command: 'cdpStatusResult', cdpStatus: outCdpStatus }, syncMsg];
                return { ok: launcherRes.ok, ...(errOut ? { error: errOut } : {}), result: launcherMsg, messages: msgs, snapshot: actionSnapshot() };
            }

            default:
                return { ok: false, statusCode: 400, error: `Unknown action: ${action.command}` };
        }
        } finally {
            if (!isPassiveReadAction) {
                bumpStateRevision();
            }
        }
    }

    function validateOverlayBridgeAuth(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): boolean {
        if (typeof token !== 'string' || !token) { return false; }
        if (typeof overlayManager.validateBridgeGrant === 'function') {
            return overlayManager.validateBridgeGrant(token, origin, command);
        }
        // Fail-closed fallback for custom mocks without per-target grant registry:
        // require connected CDP state, explicit non-empty Origin matching overlayAllowedOrigin, and constant-time token match
        const st = overlayManager.getStatus();
        if (st.state !== 'connected') { return false; }
        if (typeof origin !== 'string' || !origin.trim()) { return false; }
        if (overlayAllowedOrigin && origin.trim() !== overlayAllowedOrigin) { return false; }
        const a = Buffer.from(token, 'utf8');
        const b = Buffer.from(overlayBridgeToken, 'utf8');
        return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
    }

    async function dispose(): Promise<void> {
        if (disposed) { return; }
        disposed = true;
        pollGeneration++;
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
        scheduledPollDelayMs = 0;
        abortController.abort();
        persistQuotaRunwaysIfDue(deps.now(), true);
        try {
            await overlayManager.dispose();
        } catch { /* ignore */ }
        await durableState.flush();
    }

    if (options.autoStart !== false) {
        scheduleNextPoll();
        triggerBackgroundUpdateCheck();
    }

    return {
        version,
        renderHtml,
        getSnapshot,
        handleAction,
        getOverlayBridgeAuth: () => ({
            token: overlayBridgeToken,
            allowedOrigin: overlayAllowedOrigin,
        }),
        validateOverlayBridgeAuth,
        resolveOverlayTargetId: (token, origin, command) => overlayManager.resolveBridgeTargetId?.(token, origin, command) ?? undefined,
        handleOverlayAction,
        getCdpStatus: () => overlayManager.getStatus(),
        buildOverlayPayload: (nowMs?: number) => buildCdpOverlayPayload(nowMs),
        getLatestObservation: () => latestObservation,
        getWindowSelectionState: (windowId?: string) => ({ ...getOrCreateWindowSelectionState(windowId ?? activeWindowId) }),
        getSwarmTopology: () => lastSwarmTopology,
        getSwarmGroupCost: () => lastSwarmGroupCost,
        getAppSettings: () => getFullAppSettings(),
        setListeningPort: (port: number) => {
            addExcludedCdpPort(port);
            overlayManager.addExcludedPort?.(port);
        },
        pollNow: (force = true) => runPollCycle(force),
        getState: () => {
            const curWin = getOrCreateWindowSelectionState(activeWindowId);
            return {
                lsInfo: cachedLsInfo,
                monitorStatus,
                currentUsage,
                allTrajectories,
                modelConfigs: cachedModelConfigs,
                userInfo: cachedUserInfo,
                contextBreakdown,
                turnDiagnostics,
                quotaRunways,
                weeklyQuotaRunways,
                promptCacheTtl: latestPromptCacheTtl,
                recoveryBrief: activeRecoveryBrief,
                speedCoverage: latestSpeedMetric
                    ? { measuredCount: latestSpeedMetric.coverage.measuredCount, totalCount: latestSpeedMetric.coverage.totalCount }
                    : null,
                isCustomModelActive,
                staleState: getCombinedStaleState(),
                conversationOptions,
                activeConversationId: lastResolution.cascadeId,
                pinnedConversationId,
                lockToMainAgent,
                lockedMainId: curWin.lockedRootId ?? lockedMainId,
                inspectedMemberId: curWin.inspectedMemberId,
                lockPendingUnavailable: Boolean(curWin.lockPendingUnavailable),
                retargetOfferId: curWin.retargetOfferId ?? null,
                windowSelectionState: { ...curWin },
                latestObservation,
                swarmTopology: lastSwarmTopology,
                swarmGroupCost: lastSwarmGroupCost,
                lastSwarmPollTick,
                isPaused,
                settings: { ...settings, lockToMainAgent },
                appSettings: getFullAppSettings(),
                orchestratorPricingMode: appSettings.orchestratorPricingMode,
                cdpStatus: overlayManager.getStatus(),
                updateStatus: lastUpdateStatusView,
                lastUpdatedTime,
                pollCount,
                lastPollAtMs,
            };
        },
        getDurableState: () => durableState,
        getStorageDiagnostics,
        dispose,
    };
}

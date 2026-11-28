// ─── Shared Pure Webview Document Builder ────────────────────────────────────
// Renders the complete Studio Telemetry Ledger HTML document and incremental
// tab payloads for BOTH Antigravity IDE (VS Code Webview) and Antigravity App
// (Desktop 2.0+ native Sidecar plugin).
//
// ZERO `vscode` runtime imports — safe in pure Node / Sidecar / unit tests.

import {
    detectHostLocaleLanguage,
    formatClockTime,
    getLanguage,
    getLanguagePreference,
    getRuntimeLocaleSources,
    resolvePerViewEffectiveLanguage,
    t,
    tBi,
    tHtml,
    type LanguagePreference,
    type PrimaryLanguage,
} from './i18n-core';
import type { ContextUsage, TrajectorySummary } from './tracker';
import {
    localizePickerEffortLabel,
    resolveModelId,
    type FullUserStatus,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from './models';
import type { ActivitySummary } from './activity-tracker';
import {
    buildAccountStatusPanel,
    buildGMDataTabContent,
    getGMDataTabStyles,
    hasAccountReadyPool,
    type AccountSnapshot,
} from './activity-panel';
import type {
    DailyLedger,
    LedgerAccountBucket,
    LedgerSettledEntry,
    SwarmGroupAttributionSpec,
} from './daily-ledger';
import { buildPricingTabContent, getPricingTabStyles } from './pricing-panel';
import { PricingStore, type ModelPricing, type OrchestratorPricingMode } from './pricing-store';
import type { GMConversationData, GMSummary } from './gm-tracker';
import { ICON } from './webview-icons';
import { esc, richTipAttrs as docRichTipAttrs, tBiHtml } from './webview-helpers';
import { buildModelsTabContent } from './webview-models-tab';
import { buildProfileContent } from './webview-profile-tab';
import {
    buildSettingsContent,
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
    normalizeMonitorDocumentSettings,
    type MonitorDocumentSettings,
    type MonitorDocumentSettingsInput,
    type PanelHintPreferences,
    type StorageDiagnostics,
    type UpdateStatusView,
} from './webview-settings-tab';
import { buildAboutTabContent, getAboutTabStyles } from './webview-about-tab';
import {
    buildCalendarTabContent,
    getCalendarTabStyles,
    type CalendarRenderOptions,
} from './webview-calendar-tab';
import { buildChatHistoryTabContent } from './webview-chat-history-tab';
import { DailyStore, type DailyStoreState } from './daily-store';
import { getScript } from './webview-script';
import { getStyles } from './webview-styles';
import { getEditorialStyles } from './webview-editorial-styles';
import {
    buildOverviewTabContent,
    getOverviewStyles,
    deriveSwarmOverviewFromTopology,
    type CompactionRecoveryBriefData,
    type HandoffV2PreviewData,
    type LowQuotaWarningItem,
    type LowQuotaWarningState,
    type MonitorStaleState,
    type SwarmOverviewDisplayData,
} from './webview-overview-tab';
import type { SwarmGroupCostSummary, SwarmTopologySnapshot } from './core/swarm-registry';
import type { ContextDisplayBasis } from './core/context-display';
import { projectQuotaDisplay, type QuotaDirectionMode, type QuotaRunwayEstimate, type QuotaWindowMode, type WeeklyQuotaRunwayEstimate } from './quota-runway';
import type { PromptCacheTtlEvaluation, SpeedMetricMode } from './telemetry-metrics';
import {
    extractOverviewTelemetry,
    formatCompactTokens,
    formatQuotaWindowPercent,
    getContextReading,
    resetCountdown,
    resolveActiveOrchestratorRoute,
    selectMonitorQuotaGroups,
    type MonitorStatus,
    type OverviewDestination,
} from './monitor-overview';
import type { ContextBreakdownSnapshot } from './context-breakdown';
import type { TurnDiagnosticsSummary } from './turn-diagnostics';
import type { ConversationOption } from './conversation-selector';
import {
    analyzeUserTurnCacheStates,
    computeContextWatermarks,
    evaluateSpeedSample,
    getOrchestratorAttributionStyles,
    type ContextDualWatermark,
    type OrchestratorSplitSummary,
    type SpeedSampleEvaluation,
    type UserTurnCacheSummary,
} from './orchestrator-attribution';
import { formatCachePercent, formatLatency, formatSpeed } from './telemetry-metrics';
import {
    projectForNativeHud,
    type PublishedMonitorObservation,
} from './core/context-display';
import {
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    resolveCurrencyConfig,
    type CurrencyConfig,
    type CurrencyInput,
} from './core/currency';
import {
    normalizeSubscriptionPlanId,
    type SubscriptionPlanPresetId,
} from './core/pricing-validation';
import type { SubscriptionConfig } from './cli-usage-scanner';
import { isUpdateAvailableForVersion, type LastUpdateCheckRecord } from './durable-state';
import type { AppSettingsWithV118, CdpStatus, UpdateCheckResult } from './app/sidecar-types';
import type { GlobalRulesStatus } from './global-rules';

export {
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
    normalizeMonitorDocumentSettings,
};
export type {
    LowQuotaWarningItem,
    LowQuotaWarningState,
    MonitorDocumentSettings,
    MonitorStaleState,
    PanelHintPreferences,
    StorageDiagnostics,
    UpdateStatusView,
};

// ─── Contracts ───────────────────────────────────────────────────────────────

export type MonitorSurface = 'ide' | 'app-sidecar';

export type CanonicalMainTabId = 'overview' | 'gm' | 'sessions' | 'calendar' | 'models' | 'settings';
export type CanonicalUtilityViewId = 'about';
export type CanonicalViewId = CanonicalMainTabId | CanonicalUtilityViewId;

export const CANONICAL_MAIN_TABS: readonly CanonicalMainTabId[] = [
    'overview',
    'gm',
    'sessions',
    'calendar',
    'models',
    'settings',
];

export interface ResolvedTabRoute {
    tab: CanonicalViewId;
    anchor?: string;
}

/** Complete 18-alias navigation table mapping all historical and canonical IDs to v1.18 views. */
export const ALL_TAB_ALIASES: Readonly<Record<string, ResolvedTabRoute>> = Object.freeze({
    overview: { tab: 'overview' },
    gm: { tab: 'gm' },
    gmdata: { tab: 'gm' },
    'gm-data': { tab: 'gm' },
    activity: { tab: 'gm', anchor: 'slot-activity' },
    sessions: { tab: 'sessions' },
    chats: { tab: 'sessions' },
    'chat-history': { tab: 'sessions' },
    calendar: { tab: 'calendar' },
    usage: { tab: 'calendar' },
    cost: { tab: 'calendar', anchor: 'slot-pricing' },
    pricing: { tab: 'calendar', anchor: 'slot-pricing' },
    models: { tab: 'models' },
    profile: { tab: 'models', anchor: 'slot-profile' },
    account: { tab: 'models', anchor: 'slot-profile' },
    accounts: { tab: 'models', anchor: 'slot-profile' },
    settings: { tab: 'settings' },
    about: { tab: 'about' },
});

export function resolveTabAlias(raw: string | null | undefined): ResolvedTabRoute | null {
    if (typeof raw !== 'string') { return null; }
    const norm = raw.trim().toLowerCase().replace(/^#(?:tab-)?/, '');
    if (!norm) { return null; }
    if (norm === 'updates' || norm === 'aboutupdatessection' || norm === 'updatessettingscard') {
        return { tab: 'settings', anchor: 'updatesSettingsCard' };
    }
    if (norm === 'settings-cdp-card' || norm === 'appoverlayscard') {
        return { tab: 'settings', anchor: 'settings-cdp-card' };
    }
    if (norm === 'globalrulescard' || norm === 'global-rules') {
        return { tab: 'settings', anchor: 'globalRulesCard' };
    }
    return ALL_TAB_ALIASES[norm] ?? null;
}

export type MonitorTabId =
    | OverviewDestination
    | CanonicalViewId
    | 'gmdata'
    | 'gm-data'
    | 'activity'
    | 'chats'
    | 'chat-history'
    | 'usage'
    | 'cost'
    | 'pricing'
    | 'profile'
    | 'account'
    | 'accounts';

export interface MonitorDocumentV1175Extras {
    surface?: MonitorSurface;
    version?: string;
    contextBreakdown?: ContextBreakdownSnapshot | null;
    turnDiagnostics?: TurnDiagnosticsSummary | null;
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    isCustomModelActive?: boolean;
    staleState?: MonitorStaleState | null;
    conversationOptions?: ConversationOption[];
    activeConversationId?: string | null;
    pinnedConversationId?: string | null;
    lockToMainAgent?: boolean;
    extraHeadHtml?: string;
    extraBodyEndHtml?: string;
    imagesBaseUri?: string;
    // v1.17.6 optional extras
    calendarOptions?: CalendarRenderOptions;
    orchestratorPricingMode?: OrchestratorPricingMode;
    appSettings?: Partial<AppSettingsWithV118>;
    cdpStatus?: CdpStatus | null;
    updateStatus?: UpdateStatusView | UpdateCheckResult | null;
    lowQuotaWarning?: LowQuotaWarningState | null;
    turnCacheInfo?: UserTurnCacheSummary | null;
    watermarks?: ContextDualWatermark | null;
    speedSample?: SpeedSampleEvaluation | null;
    orchestratorSplit?: OrchestratorSplitSummary | null;
    /** When true (default, fail-closed), redact account & identity markup across tabs and popovers. */
    privacyMasked?: boolean;
    /** Opaque account handle for active account controls (replaces plaintext `data-email`). */
    accountHandle?: string;
    // v1.18 D9 / D3 / Plan C optional extras (all optional for 100% IDE backward compatibility)
    observation?: PublishedMonitorObservation | null;
    inspectedMemberId?: string | null;
    inspectedMemberLabel?: string | null;
    lockedRootId?: string | null;
    lockPendingUnavailable?: boolean;
    retargetOfferId?: string | null;
    retargetOfferTitle?: string | null;
    languagePreference?: LanguagePreference;
    primaryCompactLang?: PrimaryLanguage;
    viewportWidthPx?: number | null;
    nativeHudAutoHideOnOverview?: boolean;
    swarmOverview?: SwarmOverviewDisplayData | null;
    swarmTopology?: SwarmTopologySnapshot | null;
    swarmGroupCost?: SwarmGroupCostSummary | null;
    handoffPreview?: HandoffV2PreviewData | null;
    recoveryBrief?: CompactionRecoveryBriefData | null;
    cacheTtl?: PromptCacheTtlEvaluation | null;
    promptCacheTtl?: PromptCacheTtlEvaluation | null;
    weeklyRunways?: Record<string, WeeklyQuotaRunwayEstimate> | readonly WeeklyQuotaRunwayEstimate[];
    weeklyQuotaRunways?: Record<string, WeeklyQuotaRunwayEstimate>;
    contextPctBasis?: ContextDisplayBasis;
    speedMetricMode?: SpeedMetricMode;
    quotaWindowMode?: QuotaWindowMode;
    quotaDirectionMode?: QuotaDirectionMode;
    /** Optional metadata-only Antigravity global rules file snapshot for the Settings tab (`null` hides card). */
    globalRules?: GlobalRulesStatus | null;
    /** Optional per-response CSP script nonce (emitted only when caller supplies a nonce compatible with all head/body scripts). */
    cspNonce?: string;
}

export interface MonitorDocumentBuildParams extends MonitorDocumentV1175Extras {
    /** Active conversation context usage (IDE name). */
    currentUsage?: ContextUsage | null;
    /** Alias for `currentUsage` accepted from App Sidecar runtime. */
    data?: ContextUsage | null;
    /** Backend / monitor connection status (IDE name). */
    monitorStatus?: MonitorStatus;
    /** Alias for `monitorStatus` accepted from App Sidecar runtime. */
    backendStatus?: MonitorStatus | 'connected' | 'disconnected' | 'connecting' | 'idle' | 'active' | 'empty';
    allTrajectoryUsages?: ContextUsage[];
    allTrajectories?: TrajectorySummary[];
    modelConfigs?: ModelConfig[];
    userInfo?: UserStatusInfo | null;
    /** Optional combined user status (populates `userInfo` & `modelConfigs` when omitted). */
    userStatus?: FullUserStatus | null;
    workspaceUri?: string;
    activitySummary?: ActivitySummary | null;
    gmSummary?: GMSummary | null;
    gmFullSummary?: GMSummary | null;
    gmConversations?: Record<string, GMConversationData>;
    pricingStore?: PricingStore;
    customPricing?: Record<string, ModelPricing>;
    /** Alias for `customPricing` accepted from App Sidecar runtime. */
    pricingOverrides?: Record<string, ModelPricing>;
    dailyStore?: DailyStore;
    /** Optional serialized DailyStore snapshot (auto-hydrated when `dailyStore` is omitted). */
    dailyStoreSnapshot?: DailyStoreState | null;
    /** Optional DailyLedger instance or active/settled snapshot (accepted from App Sidecar runtime). */
    dailyLedger?: Pick<DailyLedger, 'getTodayActive' | 'getSettledEntries'> | { active?: LedgerAccountBucket[]; settled?: LedgerSettledEntry[] } | null;
    storageDiagnostics?: StorageDiagnostics;
    panelHintPrefs?: PanelHintPreferences;
    zoomLevel?: number;
    accountSnapshots?: AccountSnapshot[];
    activeAccountKey?: string;
    billingDays?: Record<string, number>;
    todayLedgerActive?: LedgerAccountBucket[];
    ledgerSettled?: LedgerSettledEntry[];
    ledgerDateKey?: string;
    orchestratorSettings?: OrchestratorSettings | null;
    quotaSummary?: UserQuotaSummary | null;
    todayCostUsd?: number;
    sessionCostUsd?: number;
    calendarYear?: number;
    calendarMonth?: number;
    paused?: boolean;
    /** Alias for `paused` accepted from App Sidecar runtime. */
    isPaused?: boolean;
    initialTab?: MonitorTabId;
    /** Plain document settings (zero `vscode` dependency). */
    settings?: MonitorDocumentSettingsInput;
    /** Explicit formatted clock string (defaults to `formatClockTime(new Date(now), getLanguage())`). */
    lastUpdatedTime?: string;
    /** Optional deterministic timestamp (ms) for tests. */
    now?: number;
    /** Optional nested v1.17.5 / v1.17.6 extras (merged with top-level flat fields; flat fields take precedence). */
    extras?: MonitorDocumentV1175Extras;
}

export interface MonitorTabsPayload {
    overview: string;
    gm: string;
    gmdata: string;
    sessions: string;
    chats: string;
    pricing: string;
    models: string;
    calendar: string;
    profile: string;
    about: string;
    accountPopover: string;
    accountPopoverHasReady: boolean;
    mastheadControls: string;
    nativeHud: string;
    [key: string]: string | boolean;
}

export interface MonitorShellParams {
    tabs: MonitorTabsPayload;
    settingsHtml: string;
    extras: MonitorDocumentV1175Extras;
    paused: boolean;
    initialTab?: MonitorTabId;
    panelHintPrefs: PanelHintPreferences;
    zoomLevel: number;
    accountSnapshots: AccountSnapshot[];
    billingDays: Record<string, number>;
    lastUpdatedTime: string;
}

export interface NativeHudBuildInput {
    quotaWindowMode?: QuotaWindowMode;
    quotaDirectionMode?: QuotaDirectionMode;
    usage: ContextUsage | null;
    modelConfigs: readonly ModelConfig[];
    quotaSummary?: UserQuotaSummary | null;
    gmSummary?: GMSummary | null;
    gmConversations?: Record<string, GMConversationData>;
    customPricing?: Record<string, ModelPricing>;
    sessionCostUsd?: number;
    todayCostUsd?: number;
    displayCurrency?: CurrencyInput;
    contextBreakdown?: ContextBreakdownSnapshot | null;
    isCustomModelActive?: boolean;
    activeCascadeId?: string | null;
    speedSample?: SpeedSampleEvaluation | null;
    watermarks?: ContextDualWatermark | null;
    turnCacheInfo?: UserTurnCacheSummary | null;
    orchestratorSettings?: OrchestratorSettings | null;
    orchestratorPricingMode?: OrchestratorPricingMode;
    /** v1.18 D9: Single frozen observation projected into Native HUD for 100% surface parity. */
    observation?: PublishedMonitorObservation | null;
    now?: number;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

const LOCK_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const UNLOCK_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.3"/></svg>';
const HUD_CHEVRON_SVG = '<svg class="native-hud-toggle-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

function buildEocSentinel(): string {
    return `<div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBiHtml('End of content', '已到底')}</span></div>`;
}

function resolveExtras(params: MonitorDocumentBuildParams): MonitorDocumentV1175Extras {
    const nested = params.extras ?? {};
    const appS = params.appSettings ?? nested.appSettings;
    const pick = <K extends keyof MonitorDocumentV1175Extras>(k: K): MonitorDocumentV1175Extras[K] =>
        (params[k] !== undefined ? params[k] : nested[k]);
    return {
        surface: params.surface ?? nested.surface ?? 'ide',
        version: pick('version'),
        contextBreakdown: pick('contextBreakdown'),
        turnDiagnostics: pick('turnDiagnostics'),
        quotaRunways: pick('quotaRunways'),
        isCustomModelActive: pick('isCustomModelActive'),
        staleState: pick('staleState'),
        conversationOptions: pick('conversationOptions'),
        activeConversationId: pick('activeConversationId'),
        pinnedConversationId: pick('pinnedConversationId'),
        lockToMainAgent: pick('lockToMainAgent') ?? params.settings?.lockToMainAgent ?? appS?.lockToMainAgent ?? false,
        extraHeadHtml: pick('extraHeadHtml'),
        extraBodyEndHtml: pick('extraBodyEndHtml'),
        imagesBaseUri: pick('imagesBaseUri'),
        calendarOptions: pick('calendarOptions'),
        orchestratorPricingMode: pick('orchestratorPricingMode'),
        appSettings: appS,
        cdpStatus: pick('cdpStatus'),
        updateStatus: pick('updateStatus'),
        lowQuotaWarning: pick('lowQuotaWarning'),
        turnCacheInfo: pick('turnCacheInfo'),
        watermarks: pick('watermarks'),
        speedSample: pick('speedSample'),
        orchestratorSplit: pick('orchestratorSplit'),
        privacyMasked: pick('privacyMasked') ?? true,
        accountHandle: pick('accountHandle'),
        observation: pick('observation'),
        inspectedMemberId: pick('inspectedMemberId'),
        inspectedMemberLabel: pick('inspectedMemberLabel'),
        lockedRootId: pick('lockedRootId'),
        lockPendingUnavailable: pick('lockPendingUnavailable'),
        retargetOfferId: pick('retargetOfferId'),
        retargetOfferTitle: pick('retargetOfferTitle'),
        languagePreference: pick('languagePreference') ?? appS?.languagePreference,
        primaryCompactLang: pick('primaryCompactLang'),
        viewportWidthPx: pick('viewportWidthPx'),
        nativeHudAutoHideOnOverview: pick('nativeHudAutoHideOnOverview') ?? appS?.nativeHudAutoHideOnOverview,
        swarmOverview: pick('swarmOverview'),
        swarmTopology: pick('swarmTopology'),
        swarmGroupCost: pick('swarmGroupCost'),
        handoffPreview: pick('handoffPreview'),
        recoveryBrief: pick('recoveryBrief'),
        cacheTtl: pick('cacheTtl') ?? pick('promptCacheTtl'),
        promptCacheTtl: pick('promptCacheTtl') ?? pick('cacheTtl'),
        weeklyRunways: pick('weeklyRunways') ?? pick('weeklyQuotaRunways'),
        weeklyQuotaRunways: pick('weeklyQuotaRunways'),
        contextPctBasis: pick('contextPctBasis') ?? appS?.contextPctBasis,
        speedMetricMode: pick('speedMetricMode') ?? appS?.speedMetricMode,
        quotaWindowMode: pick('quotaWindowMode') ?? appS?.quotaWindowMode,
        quotaDirectionMode: pick('quotaDirectionMode') ?? appS?.quotaDirectionMode,
        globalRules: pick('globalRules'),
        cspNonce: pick('cspNonce'),
    };
}

function resolveUpdateStatusView(
    raw: UpdateStatusView | UpdateCheckResult | null | undefined,
    fallbackCheck: LastUpdateCheckRecord | null | undefined,
    currentVersion?: string,
): UpdateStatusView | null {
    if (raw) {
        const latestVer = raw.latestVersion ?? ('releaseInfo' in raw ? raw.releaseInfo?.version : undefined) ?? null;
        const versionAwareAvailable = currentVersion && latestVer
            ? isUpdateAvailableForVersion({
                checkedAt: raw.checkedAt ?? 0,
                latestVersion: latestVer,
                hasUpdate: Boolean(raw.hasUpdate || ('updateAvailable' in raw && raw.updateAvailable)),
                etag: null,
            }, currentVersion)
            : Boolean(('updateAvailable' in raw && raw.updateAvailable) || raw.hasUpdate || raw.status === 'update_available');
        return {
            currentVersion: ('currentVersion' in raw && raw.currentVersion) ? raw.currentVersion : currentVersion,
            latestVersion: latestVer,
            updateAvailable: versionAwareAvailable,
            hasUpdate: versionAwareAvailable,
            status: raw.status === 'update_available' && !versionAwareAvailable ? 'up_to_date' : raw.status,
            checkedAt: raw.checkedAt ?? null,
            releaseUrl: ('releaseUrl' in raw ? raw.releaseUrl : undefined) ?? ('releaseInfo' in raw ? raw.releaseInfo?.releaseUrl : undefined) ?? null,
            releaseNotesSummary: ('releaseNotesSummary' in raw ? raw.releaseNotesSummary : undefined) ?? ('releaseInfo' in raw ? raw.releaseInfo?.releaseNotesSummary : undefined) ?? null,
            error: raw.error ?? null,
            requiresReload: 'requiresReload' in raw ? raw.requiresReload : undefined,
        };
    }
    if (fallbackCheck) {
        const versionAwareAvailable = currentVersion
            ? isUpdateAvailableForVersion(fallbackCheck, currentVersion)
            : Boolean(fallbackCheck.hasUpdate);
        return {
            currentVersion,
            latestVersion: fallbackCheck.latestVersion ?? null,
            updateAvailable: versionAwareAvailable,
            hasUpdate: versionAwareAvailable,
            status: fallbackCheck.error
                ? 'error'
                : (versionAwareAvailable ? 'update_available' : 'up_to_date'),
            checkedAt: fallbackCheck.checkedAt,
            releaseUrl: fallbackCheck.releaseUrl ?? null,
            releaseNotesSummary: fallbackCheck.releaseNotesSummary ?? null,
            error: fallbackCheck.error ?? null,
        };
    }
    return null;
}

function resolveDisplayCurrencyFromSettings(
    settings: MonitorDocumentSettingsInput | undefined,
    appSettings: Partial<AppSettingsWithV118> | undefined,
): CurrencyConfig {
    const code = appSettings?.displayCurrency ?? settings?.displayCurrency ?? 'USD';
    const customRate = appSettings?.customFxRate !== undefined
        ? appSettings.customFxRate
        : settings?.customFxRate;
    const customFxCurrency = appSettings?.customFxCurrency !== undefined
        ? appSettings.customFxCurrency
        : settings?.customFxCurrency;
    return {
        code,
        ...(typeof customRate === 'number' && Number.isFinite(customRate) && customRate > 0
            ? { customRatePerUsd: customRate }
            : {}),
        ...(customFxCurrency !== undefined ? { customFxCurrency } : {}),
    };
}

function resolveSubscriptionFromSettings(
    settings: MonitorDocumentSettingsInput | undefined,
    appSettings: Partial<AppSettingsWithV118> | undefined,
    currency: CurrencyConfig,
): SubscriptionConfig | null {
    const fee = appSettings?.subscriptionMonthlyFee !== undefined
        ? appSettings.subscriptionMonthlyFee
        : settings?.subscriptionMonthlyFee;
    const rawPlan = appSettings?.subscriptionPlan ?? settings?.subscriptionPlan;
    const planId = normalizeSubscriptionPlanId(rawPlan, typeof fee === 'number' ? fee : null);
    if (planId === 'none') { return null; }
    const feeCurrency = appSettings?.subscriptionCurrency ?? settings?.subscriptionCurrency ?? currency.code;
    return {
        planId,
        ...(typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? { monthlyFee: fee } : {}),
        feeCurrency: feeCurrency as SubscriptionConfig['feeCurrency'],
        ...(currency.customRatePerUsd ? { customRatePerUsd: currency.customRatePerUsd } : {}),
    };
}

function resolvePricingStore(params: MonitorDocumentBuildParams): {
    store: PricingStore | undefined;
    customPricing: Record<string, ModelPricing>;
} {
    if (params.pricingStore) {
        return {
            store: params.pricingStore,
            customPricing: params.pricingStore.getCustom(),
        };
    }
    const overrides = params.customPricing ?? params.pricingOverrides;
    if (overrides !== undefined || params.gmSummary || params.gmFullSummary) {
        const ephemeral = new PricingStore();
        ephemeral.init({
            get: <T>(_k: string, d: T): T => (overrides !== undefined ? (overrides as unknown as T) : d),
            update: async () => {},
        });
        return {
            store: ephemeral,
            customPricing: overrides ?? {},
        };
    }
    return { store: undefined, customPricing: {} };
}

function resolveDailyStore(params: MonitorDocumentBuildParams): DailyStore | undefined {
    if (params.dailyStore) { return params.dailyStore; }
    if (params.dailyStoreSnapshot) {
        const hydrated = new DailyStore();
        hydrated.restoreSnapshot(params.dailyStoreSnapshot);
        return hydrated;
    }
    return undefined;
}

function truncateText(text: string, maxLen: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) { return clean; }
    return `${clean.slice(0, Math.max(1, maxLen - 1))}…`;
}

function formatConversationOptionLabel(opt: ConversationOption): string {
    const tags: string[] = [];
    if (opt.isRunning) { tags.push(tBi('Running', '运行中')); }
    if (opt.isSubagent) { tags.push(tBi('Subagent', '子智能体')); }
    if (opt.isLockedMain) { tags.push(tBi('Main', '主会话')); }
    if (opt.workspaceLabel) { tags.push(truncateText(opt.workspaceLabel, 18)); }
    const titlePart = truncateText(opt.title || opt.cascadeId.slice(0, 8), 38);
    return tags.length > 0 ? `${titlePart} [${tags.join(' · ')}]` : titlePart;
}

// ─── Native Sidecar Collapsible Ambient HUD (v1.17.6, Zero-CDP) ─────────────

/**
 * Render the sleek Studio-Telemetry collapsible ambient HUD strip placed right
 * below the topbar. Works out of the box with zero CDP on both App and IDE.
 */
export function buildNativeHudHtml(input: NativeHudBuildInput): string {
    const now = input.now ?? Date.now();
    const obsProj = input.observation ? projectForNativeHud(input.observation) : null;
    const legacyReading = input.usage ? getContextReading(input.usage) : null;
    const reading = obsProj
        ? {
            used: obsProj.usedTokens,
            limit: obsProj.denominatorTokens,
            percent: obsProj.primaryPct,
        }
        : legacyReading;
    const rawPct = reading?.percent ?? null;
    const clampedPct = obsProj
        ? obsProj.geometryFillPct
        : (rawPct !== null && Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : 0);
    const ringCircumference = 2 * Math.PI * 8; // r = 8 -> 50.265
    const ringOffset = ringCircumference * (1 - clampedPct / 100);
    // Aligned with Overview & D9 observation healthStatus + compactionWarningActive
    const ringTone = obsProj
        ? (obsProj.isIncomplete
            ? ' is-muted'
            : (obsProj.healthStatus === 'overflow'
                || obsProj.healthStatus === 'high_pressure'
                || obsProj.compactionWarningLevel === 'critical'
                || obsProj.compactionWarningLevel === 'overflow')
                ? ' is-danger'
                : (obsProj.healthStatus === 'elevated' || obsProj.compactionWarningLevel === 'elevated')
                    ? ' is-warn'
                    : ' is-good')
        : (rawPct === null
            ? ' is-muted'
            : rawPct >= 80
                ? ' is-danger'
                : rawPct >= 65
                    ? ' is-warn'
                    : ' is-good');
    const ctxPctText = obsProj
        ? obsProj.primaryPctText
        : (rawPct !== null && Number.isFinite(rawPct) ? `${Math.round(rawPct)}%` : '—');

    const watermarks = input.watermarks !== undefined
        ? input.watermarks
        : (input.usage && reading && reading.used !== null && reading.limit !== null
            ? computeContextWatermarks({
                contextUsed: reading.used,
                compactionLimit: reading.limit,
                physicalContextWindow: input.contextBreakdown?.nativeLimitTokens,
                model: input.usage.model,
            })
            : null);

    const ctxDetails: string[] = [];
    if (reading && reading.used !== null && reading.limit !== null) {
        ctxDetails.push(`${tBi('Context', '上下文')}: ${formatCompactTokens(reading.used)} / ${formatCompactTokens(reading.limit)}`);
    }
    if (watermarks?.hasDistinctPhysicalWindow) {
        ctxDetails.push(`${t('context.basisNative')}: ${formatCompactTokens(watermarks.physicalContextWindow)}`);
    }
    if (watermarks?.showLongContextMarker) {
        ctxDetails.push(watermarks.exceedsLongContextTier ? tBi('> 200k tier', '已超 200k 阶梯') : tBi('Below 200k tier', '低于 200k 阶梯'));
    }
    const ctxTipAttr = docRichTipAttrs({
        key: 'hud:chip:context',
        title: tBi('Context Usage', '上下文占用'),
        body: ctxDetails.join(' · ') || tBi('Context vs auto-compaction ceiling.', '按自动压缩上限计算的上下文占用。'),
        meta: tBi('<65% normal · ≥65% warn · ≥80% danger', '<65% 正常 · ≥65% 预警 · ≥80% 高危'),
        focusable: true,
    });

    // Telemetry (Speed with Short sample guard, TTFT, Cache Hit %)
    const activeCascadeId = obsProj ? obsProj.subjectCascadeId : (input.activeCascadeId ?? input.usage?.cascadeId);
    const telemetry = obsProj && (!obsProj.subjectCascadeId || obsProj.isZeroStepFresh)
        ? null
        : extractOverviewTelemetry(input.gmSummary, activeCascadeId ?? undefined, input.customPricing, input.orchestratorPricingMode);
    const primary = telemetry?.primary ?? null;
    const speedSample = obsProj?.isZeroStepFresh
        ? null
        : (input.speedSample
            ?? primary?.latestSpeedSample
            ?? (primary?.latestCall
                ? evaluateSpeedSample({
                    outputTokens: primary.latestCall.outputTokens,
                    streamingSeconds: primary.latestCall.streamingSeconds,
                    ttftSeconds: primary.latestCall.ttftSeconds,
                })
                : null));

    let speedValHtml = '—';
    let speedChipCls = ' is-muted';
    let speedAttr = '';
    let speedTip = '';
    let speedTipBody = tBi('Streaming token speed.', '流式输出速度。');
    const effectiveSpeedPrimary = obsProj ? obsProj.displaySpeedTps : (telemetry?.speedPrimary ?? null);
    if (!obsProj && speedSample?.isWaitingTtft) {
        speedValHtml = tBiHtml('Waiting TTFT', '等待首字');
        speedAttr = ' data-hud-speed="waiting-ttft"';
        speedTip = tBi('Waiting for first token', '等待首字输出');
        speedTipBody = speedTip;
    } else if (!obsProj && speedSample?.isShortSample) {
        speedValHtml = tBiHtml('Short sample', '短样本');
        speedAttr = ' data-hud-speed="short-sample"';
        speedTip = speedSample.rawSpeed !== null
            ? `${tBi('Raw', '原始')}: ${formatSpeed(speedSample.rawSpeed)}`
            : tBi('<16 tokens or <0.3s', '<16 tokens 或 <0.3s');
        speedTipBody = speedTip;
    } else if (effectiveSpeedPrimary !== null && effectiveSpeedPrimary !== undefined) {
        speedValHtml = esc(formatSpeed(effectiveSpeedPrimary));
        speedChipCls = '';
        speedTip = primary?.weightedGenTokPerSec != null ? `${tBi('Avg', '均值')}: ${formatSpeed(primary.weightedGenTokPerSec)}` : '';
        if (speedTip) { speedTipBody = `${speedTipBody}\n${speedTip}`; }
    }
    const speedTipAttr = docRichTipAttrs({
        key: 'hud:chip:speed',
        title: obsProj?.speedMode === 'e2e' ? t('speed.e2eModelCall') : t('speed.decode'),
        body: speedTipBody,
        meta: obsProj?.speedMode === 'e2e' ? 'outputTokens / (TTFT + streamingSeconds)' : 'outputTokens / streamingSeconds',
        focusable: true,
    });

    const ttftVal = telemetry ? formatLatency(telemetry.ttftPrimary) : '—';
    const ttftCls = ttftVal === '—' ? ' is-muted' : '';
    const ttftDetails = [
        primary?.avgTtftSeconds != null ? `${tBi('Avg', '均值')}: ${formatLatency(primary.avgTtftSeconds)}` : '',
        primary?.medianTtftSeconds != null ? `p50: ${formatLatency(primary.medianTtftSeconds)}` : '',
        primary?.cachedAvgTtftSeconds != null ? `${tBi('Cached', '缓存')}: ${formatLatency(primary.cachedAvgTtftSeconds)}` : '',
        primary?.uncachedAvgTtftSeconds != null ? `${tBi('Cache Miss', '缓存未命中')}: ${formatLatency(primary.uncachedAvgTtftSeconds)}` : '',
    ].filter(Boolean);
    const ttftTipAttr = docRichTipAttrs({
        key: 'hud:chip:ttft',
        title: t('speed.ttft'),
        body: ttftDetails.join(' · ') || tBi('Time to first token.', '等待首个输出 Token 耗时。'),
        focusable: true,
    });

    const cacheVal = primary ? formatCachePercent(primary.tokenCacheHitRate) : '—';
    const cacheCls = primary?.tokenCacheHitRate != null && primary.tokenCacheHitRate > 0 ? ' is-good' : ' is-muted';
    const cacheTipAttr = docRichTipAttrs({
        key: 'hud:chip:cache',
        title: tBi('Prompt Cache Hit', '缓存命中率'),
        body: primary && primary.totalPromptTokens > 0
            ? `${formatCompactTokens(primary.totalCacheReadTokens)} / ${formatCompactTokens(primary.totalPromptTokens)} tokens · ${primary.cachedCallCount}/${primary.totalCalls}`
            : tBi('Server-side prompt cache reuse.', '服务端提示词缓存复用。'),
        focusable: true,
    });

    // Cost (selected display currency)
    const obsSessionCostUsd = obsProj
        ? obsProj.sessionCostUsd
        : (typeof input.sessionCostUsd === 'number' && Number.isFinite(input.sessionCostUsd) && input.sessionCostUsd >= 0
            ? input.sessionCostUsd
            : null);
    const primaryCostUsd = typeof obsSessionCostUsd === 'number' && Number.isFinite(obsSessionCostUsd) && obsSessionCostUsd >= 0
        ? obsSessionCostUsd
        : (obsProj
            ? null
            : (typeof input.todayCostUsd === 'number' && Number.isFinite(input.todayCostUsd) && input.todayCostUsd >= 0
                ? input.todayCostUsd
                : null));
    const { preset: currencyPreset } = resolveCurrencyConfig(input.displayCurrency);
    const costDisplay = primaryCostUsd !== null ? formatCurrencyAmount(primaryCostUsd, input.displayCurrency) : '—';
    const costCls = costDisplay === '—' ? ' is-muted' : '';
    const costRefLine = primaryCostUsd !== null
        ? (currencyPreset.code !== 'USD' ? formatDualCurrencyAmount(primaryCostUsd, input.displayCurrency) : costDisplay)
        : tBi('No priced calls yet.', '暂无计价调用。');
    const costTipAttr = docRichTipAttrs({
        key: 'hud:chip:cost',
        title: tBi('API Reference Cost', 'API 参考费用'),
        body: costRefLine,
        meta: tBi('Reference estimate only.', '仅作参考费用估算。'),
        focusable: true,
    });

    // Tightest Quota % + reset tag
    const quotaGroups = selectMonitorQuotaGroups(input.modelConfigs, input.usage?.model, input.quotaSummary);
    const quotaRows = quotaGroups.map(group => {
        const fiveHour = group.fiveHourQuota;
        const weekly = group.weeklyQuota;
        const quota = projectQuotaDisplay({
            windowMode: input.quotaWindowMode ?? '5h',
            directionMode: input.quotaDirectionMode ?? 'remaining',
            window5h: fiveHour ?? { remainingFraction: group.minimum },
            window7d: weekly,
        });
        const reset = quota.effectiveWindow === '7d' ? weekly?.resetTime : fiveHour?.resetTime ?? group.resetTime;
        const label = quota.displayPct === null ? '—' : `${tBi(quota.metricLabelEn, quota.metricLabelZh)} ${formatQuotaWindowPercent(quota.displayPct / 100)}`;
        return { group, quota, reset, label };
    });
    let tightestQuotaHtml = '—';
    let tightestQuotaCls = ' is-muted';
    let tightestQuotaTip = '';
    if (input.isCustomModelActive) {
        tightestQuotaHtml = tBiHtml('BYOK', '自定义');
        tightestQuotaCls = '';
        tightestQuotaTip = tBi('Custom / BYOK model isolated', '自定义模型配额独立');
    } else {
        const lowest = quotaRows.filter(row => row.quota.remainingPct !== null)
            .sort((a, b) => a.quota.remainingPct! - b.quota.remainingPct!)[0];
        if (lowest) {
            const remaining = lowest.quota.remainingPct!;
            const reset = lowest.reset ? resetCountdown(Date.parse(lowest.reset), now) : '';
            tightestQuotaHtml = esc(lowest.label);
            tightestQuotaCls = remaining <= 20 ? ' is-danger' : remaining < 50 ? ' is-warn' : ' is-good';
            tightestQuotaTip = `${lowest.group.label}: ${lowest.label}${reset ? ` · ${reset}` : ''}`;
        }
    }
    const quotaTipAttr = docRichTipAttrs({
        key: 'hud:chip:quota',
        title: tBi('Model quota', '模型配额'),
        body: tightestQuotaTip || tBi('Waiting for quota data.', '等待配额数据。'),
        focusable: true,
    });

    // Turn cache start (for expanded micro-breakdown drawer)
    let turnCache = input.turnCacheInfo ?? null;
    if (!turnCache && activeCascadeId) {
        const calls = input.gmConversations?.[activeCascadeId]?.calls
            ?? input.gmSummary?.conversations?.find(c => c.cascadeId === activeCascadeId)?.calls
            ?? [];
        if (calls.length > 0) {
            turnCache = analyzeUserTurnCacheStates(calls, {
                orchestratorConfig: input.usage?.orchestratorConfig,
                orchestratorHistory: input.usage?.orchestratorHistory,
                orchestratorSettings: input.orchestratorSettings,
                orchestratorPricingMode: input.orchestratorPricingMode,
            });
        }
    }

    // Drawer micro-breakdown content
    const modelLabel = input.usage
        ? localizePickerEffortLabel(resolveModelId(input.usage.model) || input.usage.model, input.usage.modelDisplayName, getLanguage())
        : tBi('No active conversation', '无活跃会话');
    const activeRoute = input.usage ? resolveActiveOrchestratorRoute(input.usage) : null;
    const routeText = activeRoute ? ` · ${activeRoute.plannerLabel} → ${activeRoute.executorLabel}` : '';

    const topSegmentsText = input.contextBreakdown && input.contextBreakdown.segments.length > 0
        ? input.contextBreakdown.segments
            .slice(0, 3)
            .map(s => `${tBi(s.labelEn, s.labelZh)} ${formatCompactTokens(s.tokens)}`)
            .join(' · ')
        : (reading && reading.used !== null && reading.limit !== null
            ? `${formatCompactTokens(reading.used)} / ${formatCompactTokens(reading.limit)} tokens`
            : tBi('Awaiting context telemetry', '等待上下文数据'));

    const turnCacheLabel = turnCache?.latestTurn && turnCache.latestTurn.cacheStart !== 'unknown'
        ? (() => {
            const lt = turnCache.latestTurn;
            const stateStr = lt.cacheStart === 'warm'
                ? tBi('Warm', '热缓存')
                : lt.cacheStart === 'partial'
                    ? tBi('Partial', '部分命中')
                    : tBi('Cold', '冷启动');
            const deltaStr = lt.netContextDeltaTokens !== null
                ? ` · Δ ${lt.netContextDeltaTokens >= 0 ? '+' : '−'}${formatCompactTokens(Math.abs(lt.netContextDeltaTokens))}`
                : '';
            return `${stateStr}${lt.cacheHitPct !== null ? ` (${lt.cacheHitPct.toFixed(0)}%)` : ''}${deltaStr}`;
        })()
        : cacheVal;

    const todayCostDisplay = typeof input.todayCostUsd === 'number' && Number.isFinite(input.todayCostUsd) && input.todayCostUsd >= 0
        ? formatCurrencyAmount(input.todayCostUsd, input.displayCurrency)
        : null;
    const sessionCostDisplay = typeof obsSessionCostUsd === 'number' && Number.isFinite(obsSessionCostUsd) && obsSessionCostUsd >= 0
        ? formatCurrencyAmount(obsSessionCostUsd, input.displayCurrency)
        : null;

    const quotaSummaryText = input.isCustomModelActive
        ? tBi('Custom model isolated', '自定义模型配额独立')
        : quotaRows.length > 0
            ? quotaRows.slice(0, 3).map(row => `${row.group.label} ${row.label}`).join(' · ')
            : '—';

    const hudObsAttrs = obsProj
        ? ` data-observation-subject="${esc(obsProj.subjectCascadeId ?? '')}" data-observation-data-rev="${obsProj.dataRevision}" data-observation-pct="${esc(obsProj.primaryPctText)}" data-observation-denom="${obsProj.denominatorTokens ?? ''}" data-observation-basis="${esc(obsProj.actualBasis)}" data-observation-health="${esc(obsProj.healthStatus)}" data-observation-fill="${obsProj.geometryFillPct}" data-compaction-warning="${esc(obsProj.compactionWarningActive ? obsProj.compactionWarningLevel : 'none')}"`
        : '';

    return `<section class="native-hud-bar" id="nativeHudBar" data-native-hud="true" data-hud-expanded="false"${hudObsAttrs} aria-label="${esc(tBi('Ambient telemetry HUD', '顶部紧凑遥测 HUD'))}">
        <div class="native-hud-strip">
            <div class="native-hud-metrics">
                <span class="native-hud-chip${ringTone}" data-hud-metric="context"${ctxTipAttr}>
                    <svg class="native-hud-ring-svg" viewBox="0 0 24 24" aria-hidden="true">
                        <circle class="native-hud-ring-track" cx="12" cy="12" r="8"></circle>
                        <circle class="native-hud-ring-fill" cx="12" cy="12" r="8" stroke-dasharray="${ringCircumference.toFixed(2)}" stroke-dashoffset="${ringOffset.toFixed(2)}"></circle>
                    </svg>
                    <span class="native-hud-chip-label">${tBiHtml('Ctx', '上下文')}</span>
                    <span class="native-hud-chip-val">${esc(ctxPctText)}</span>
                </span>
                <span class="native-hud-chip${speedChipCls}" data-hud-metric="speed"${speedAttr}${speedTipAttr}>
                    <span class="native-hud-chip-label">${tBiHtml('Speed', '速度')}</span>
                    <span class="native-hud-chip-val">${speedValHtml}</span>
                </span>
                <span class="native-hud-chip${ttftCls}" data-hud-metric="ttft"${ttftTipAttr}>
                    <span class="native-hud-chip-label">${tHtml('speed.ttft')}</span>
                    <span class="native-hud-chip-val">${esc(ttftVal)}</span>
                </span>
                <span class="native-hud-chip${cacheCls}" data-hud-metric="cache"${cacheTipAttr}>
                    <span class="native-hud-chip-label">${tBiHtml('Cache', '缓存')}</span>
                    <span class="native-hud-chip-val">${esc(cacheVal)}</span>
                </span>
                <span class="native-hud-chip${costCls}" data-hud-metric="cost"${costTipAttr}>
                    <span class="native-hud-chip-label">${tBiHtml('Cost', '费用')}</span>
                    <span class="native-hud-chip-val">${esc(costDisplay)}</span>
                </span>
                <span class="native-hud-chip${tightestQuotaCls}" data-hud-metric="quota"${quotaTipAttr}>
                    <span class="native-hud-chip-label">${tBiHtml('Quota', '配额')}</span>
                    <span class="native-hud-chip-val">${tightestQuotaHtml}</span>
                </span>
            </div>
            <button type="button" class="native-hud-toggle" id="nativeHudToggle"
                data-action="toggleNativeHud" aria-expanded="false" aria-controls="nativeHudDrawer"
                aria-label="${esc(tBi('Toggle HUD micro-breakdown', '展开或收起 HUD 明细'))}">
                <span>${tBiHtml('Details', '明细')}</span>
                ${HUD_CHEVRON_SVG}
            </button>
        </div>
        <div class="native-hud-drawer" id="nativeHudDrawer" hidden>
            <div class="native-hud-drawer-head">
                <span class="native-hud-drawer-model">${esc(modelLabel)}${esc(routeText)}</span>
                ${reading && reading.used !== null && reading.limit !== null
            ? `<span>${esc(formatCompactTokens(reading.used))} / ${esc(formatCompactTokens(reading.limit))} tokens</span>`
            : ''}
            </div>
            <div class="native-hud-drawer-grid">
                <div class="native-hud-card">
                    <span class="native-hud-card-label">${tBiHtml('Context Breakdown', '上下文构成')}</span>
                    <span class="native-hud-card-val">${esc(ctxPctText)}</span>
                    <span class="native-hud-card-sub">${esc(topSegmentsText)}</span>
                </div>
                <div class="native-hud-card">
                    <span class="native-hud-card-label">${tBiHtml('Speed & TTFT', '速度与首字延迟')}</span>
                    <span class="native-hud-card-val">${speedValHtml} · ${esc(ttftVal)}</span>
                    <span class="native-hud-card-sub">${esc(speedTip || (primary?.weightedGenTokPerSec ? `${tBi('Avg', '均值')} ${formatSpeed(primary.weightedGenTokPerSec)}` : '—'))}</span>
                </div>
                <div class="native-hud-card">
                    <span class="native-hud-card-label">${tBiHtml('Prompt Cache & Turn', '提示词缓存与轮次')}</span>
                    <span class="native-hud-card-val">${esc(cacheVal)}</span>
                    <span class="native-hud-card-sub">${esc(turnCacheLabel)}</span>
                </div>
                <div class="native-hud-card">
                    <span class="native-hud-card-label">${tBiHtml('Cost & Quotas', '费用与配额')}</span>
                    <span class="native-hud-card-val">${esc(sessionCostDisplay || costDisplay)}${todayCostDisplay && sessionCostDisplay ? ` (${tBi('Today', '今日')} ${esc(todayCostDisplay)})` : ''}</span>
                    <span class="native-hud-card-sub">${esc(quotaSummaryText)}</span>
                </div>
            </div>
        </div>
    </section>`;
}

// ─── Masthead Context Controls (Conversation Switcher, Lock, Surface, Stale) ─

/**
 * Render the compact masthead toolbar inner HTML containing:
 * - Conversation Switcher `<select>` (Follow Active + conversation options)
 * - Persistent "Lock to Main Agent" toggle button
 * - Surface badge (`Antigravity App` / `Antigravity IDE`)
 * - Cached / Stale badge when `staleState?.isStale` is true
 */
export function buildMonitorMastheadControlsHtml(extras: MonitorDocumentV1175Extras): string {
    const surface: MonitorSurface = extras.surface ?? 'ide';
    const options = extras.conversationOptions ?? [];
    const pinnedId = extras.pinnedConversationId || '';
    const activeId = extras.activeConversationId || '';
    const locked = Boolean(extras.lockToMainAgent);
    const currentLang = getLanguage();

    const activeOption = activeId ? options.find(o => o.cascadeId === activeId) : undefined;
    const followSuffix = !pinnedId && activeOption
        ? ` · ${truncateText(activeOption.title || activeId.slice(0, 8), 24)}`
        : '';
    const followLabel = `${tBi('Follow Active', '跟随活跃会话')}${followSuffix}`;

    const optionTags: string[] = [
        `<option value=""${!pinnedId ? ' selected' : ''}>${esc(followLabel)}</option>`,
    ];
    for (const opt of options) {
        const isSelected = Boolean(pinnedId && opt.cascadeId === pinnedId);
        const label = formatConversationOptionLabel(opt);
        optionTags.push(
            `<option value="${esc(opt.cascadeId)}"${isSelected ? ' selected' : ''} data-subagent="${opt.isSubagent ? 'true' : 'false'}" data-active="${opt.isActive ? 'true' : 'false'}">${esc(label)}</option>`,
        );
    }

    const surfaceLabelHtml = surface === 'app-sidecar'
        ? tBiHtml('Antigravity App', 'Antigravity App')
        : tBiHtml('Antigravity IDE', 'Antigravity IDE');

    const staleBadgeHtml = extras.staleState?.isStale ? (() => {
        const ts = extras.staleState.lastSuccessAtMs ? ` · ${esc(formatClockTime(new Date(extras.staleState.lastSuccessAtMs), currentLang))}` : '';
        const errLine = extras.staleState.lastError ? `\n${extras.staleState.lastError}` : '';
        const staleTipAttrs = docRichTipAttrs({
            key: 'topbar:stale-badge',
            title: tBi('Cached / Stale Data', '缓存数据（待刷新）'),
            body: `${tBi('Local service unreachable; keeping last snapshot.', '暂时无法连接本地服务，保留上次快照。')}${errLine}`,
            focusable: true,
        });
        return `<span class="stale-badge" id="staleBadge" role="status"${staleTipAttrs}><span class="stale-dot" aria-hidden="true"></span><span>${tBiHtml('Cached / Stale', '缓存数据（待刷新）')}${ts}</span></span>`;
    })() : '';

    const lockTipAttrs = docRichTipAttrs({
        key: 'topbar:lock-main',
        title: tBi('Lock to Main Agent', '锁定主会话'),
        body: tBi('Ignore background subagents and stay on the main conversation.', '忽略后台子智能体，保持聚焦主会话。'),
        meta: locked ? tBi('Locked', '已锁定') : tBi('Unlocked', '未锁定'),
    });

    const surfaceTipAttrs = docRichTipAttrs({
        key: 'topbar:surface-badge',
        title: surface === 'app-sidecar' ? 'Antigravity App' : 'Antigravity IDE',
        body: surface === 'app-sidecar'
            ? tBi('Native Antigravity App Sidecar plugin.', 'Antigravity App 原生 Sidecar 插件。')
            : tBi('Antigravity IDE extension webview.', 'Antigravity IDE 扩展面板。'),
        focusable: true,
    });

    return `
        <div class="masthead-context-controls">
            <label class="conv-switcher-wrap" for="conversationSwitcher">
                <span class="sr-only">${tBiHtml('Conversation Switcher', '会话切换器')}</span>
                <select id="conversationSwitcher" class="conv-switcher-select" aria-label="${esc(tBi('Conversation Switcher', '会话切换器'))}" data-active-id="${esc(activeId)}" data-pinned-id="${esc(pinnedId)}">
                    ${optionTags.join('')}
                </select>
            </label>
            <button type="button" class="lock-main-btn${locked ? ' is-locked' : ''}" id="lockMainBtn"
                data-action="toggleLockMain" aria-pressed="${locked ? 'true' : 'false'}"${lockTipAttrs}>
                ${locked ? LOCK_ICON_SVG : UNLOCK_ICON_SVG}
                <span>${tBiHtml('Lock to Main Agent', '锁定主会话')}</span>
            </button>
        </div>
        <div class="masthead-context-badges">
            ${staleBadgeHtml}
            <span class="surface-badge" data-surface="${surface}"${surfaceTipAttrs}>${surfaceLabelHtml}</span>
        </div>`;
}

// ─── Public Tab & Document Builders ──────────────────────────────────────────

function normalizeMonitorStatus(
    status: MonitorDocumentBuildParams['monitorStatus'] | MonitorDocumentBuildParams['backendStatus'],
    usage: ContextUsage | null,
): MonitorStatus | undefined {
    if (!status) { return undefined; }
    if (typeof status === 'string') {
        if (status === 'connected') {
            return { state: usage ? 'active' : 'empty' };
        }
        if (status === 'disconnected') {
            return { state: 'disconnected', backendIssue: 'lost' };
        }
        return { state: status };
    }
    return status;
}

function resolveDailyLedgerBuckets(params: MonitorDocumentBuildParams): {
    todayLedgerActive: LedgerAccountBucket[];
    ledgerSettled: LedgerSettledEntry[];
} {
    let todayLedgerActive = params.todayLedgerActive;
    let ledgerSettled = params.ledgerSettled;
    const dl = params.dailyLedger;
    if (dl) {
        if (!todayLedgerActive) {
            if ('getTodayActive' in dl && typeof dl.getTodayActive === 'function') {
                todayLedgerActive = dl.getTodayActive();
            } else if ('active' in dl && Array.isArray(dl.active)) {
                todayLedgerActive = dl.active;
            }
        }
        if (!ledgerSettled) {
            if ('getSettledEntries' in dl && typeof dl.getSettledEntries === 'function') {
                ledgerSettled = dl.getSettledEntries();
            } else if ('settled' in dl && Array.isArray(dl.settled)) {
                ledgerSettled = dl.settled;
            }
        }
    }
    return {
        todayLedgerActive: todayLedgerActive ?? [],
        ledgerSettled: ledgerSettled ?? [],
    };
}

/**
 * Build incremental tab HTML fragments (shared by initial document build,
 * VS Code `updateTabs` messages, and App Sidecar `/api/snapshot`).
 */
export function buildMonitorTabsPayload(params: MonitorDocumentBuildParams): MonitorTabsPayload {
    const extras = resolveExtras(params);
    const rawUsage = params.currentUsage !== undefined ? params.currentUsage : (params.data ?? null);
    const usage = extras.observation && extras.observation.subjectCascadeId !== rawUsage?.cascadeId ? null : rawUsage;
    const monitorStatus = normalizeMonitorStatus(params.monitorStatus ?? params.backendStatus, usage);
    const allUsages = params.allTrajectoryUsages ?? (usage ? [usage] : []);
    const allTrajectories = params.allTrajectories ?? [];
    const userInfo = params.userInfo !== undefined ? params.userInfo : (params.userStatus?.userInfo ?? null);
    const modelConfigs = params.modelConfigs ?? params.userStatus?.configs ?? [];
    const workspaceUri = params.workspaceUri ?? '';
    const accountSnapshots = params.accountSnapshots ?? [];
    const billingDays = params.billingDays ?? {};
    const privacyMasked = extras.privacyMasked !== false;
    const activeAccountHandle = extras.accountHandle
        || accountSnapshots.find(s => s.isActive)?.accountHandle
        || params.activeAccountKey
        || '';
    const activeBillingDay = billingDays[activeAccountHandle]
        ?? billingDays[userInfo?.email ?? params.activeAccountKey ?? '']
        ?? 0;
    const resolvedActiveCascadeId = extras.observation ? extras.observation.subjectCascadeId ?? undefined : extras.activeConversationId ?? usage?.cascadeId ?? undefined;
    const { todayLedgerActive, ledgerSettled } = resolveDailyLedgerBuckets(params);
    const gmSummary = params.gmSummary ?? null;
    const gmFullSummary = params.gmFullSummary ?? gmSummary;
    const gmConversations = params.gmConversations ?? {};
    const { store: pricingStore, customPricing } = resolvePricingStore(params);
    const dailyStore = resolveDailyStore(params);
    const now = params.now ?? Date.now();
    const nowDate = new Date(now);
    const calYear = params.calendarYear ?? nowDate.getFullYear();
    const calMonth = params.calendarMonth ?? (nowDate.getMonth() + 1);
    const eoc = buildEocSentinel();

    const orchestratorPricingMode: OrchestratorPricingMode | undefined = extras.orchestratorPricingMode
        ?? extras.appSettings?.orchestratorPricingMode
        ?? params.settings?.orchestratorPricingMode
        ?? pricingStore?.getOrchestratorPricingMode?.();
    const displayCurrency = resolveDisplayCurrencyFromSettings(params.settings, extras.appSettings);
    const subscriptionConfig = resolveSubscriptionFromSettings(params.settings, extras.appSettings, displayCurrency);
    const quotaNotificationThreshold = extras.appSettings?.quotaNotificationThreshold
        ?? params.settings?.quotaNotificationThreshold;
    const resolvedUpdateStatus = resolveUpdateStatusView(
        extras.updateStatus,
        extras.appSettings?.lastUpdateCheck,
        extras.version,
    );

    const swarmOverview = extras.swarmOverview ?? deriveSwarmOverviewFromTopology(
        extras.swarmTopology, resolvedActiveCascadeId, extras.inspectedMemberId, extras.lockedRootId, extras.swarmGroupCost,
    );
    const overviewHtml = buildOverviewTabContent(
        usage,
        modelConfigs,
        userInfo,
        activeBillingDay,
        monitorStatus,
        now,
        {
            gmSummary,
            gmConversations,
            customPricing,
            activeCascadeId: resolvedActiveCascadeId,
            readableMemberIds: new Set(allTrajectories.map(tr => tr.cascadeId)),
            orchestratorSettings: params.orchestratorSettings,
            orchestratorPricingMode,
            quotaSummary: params.quotaSummary,
            todayCostUsd: params.todayCostUsd,
            sessionCostUsd: params.sessionCostUsd,
            contextBreakdown: extras.contextBreakdown,
            quotaRunways: extras.quotaRunways,
            isCustomModelActive: extras.isCustomModelActive,
            staleState: extras.staleState,
            surface: extras.surface,
            displayCurrency,
            quotaNotificationThreshold,
            lowQuotaWarning: extras.lowQuotaWarning,
            turnCacheInfo: extras.turnCacheInfo,
            watermarks: extras.watermarks,
            speedSample: extras.speedSample,
            orchestratorSplit: extras.orchestratorSplit,
            observation: extras.observation,
            inspectedMemberId: extras.inspectedMemberId,
            inspectedMemberLabel: extras.inspectedMemberLabel,
            lockedRootId: extras.lockedRootId,
            lockPendingUnavailable: extras.lockPendingUnavailable,
            retargetOfferId: extras.retargetOfferId,
            retargetOfferTitle: extras.retargetOfferTitle,
            swarmOverview,
            swarmTopology: extras.swarmTopology,
            swarmGroupCost: extras.swarmGroupCost,
            handoffPreview: extras.handoffPreview,
            recoveryBrief: extras.recoveryBrief,
            cacheTtl: extras.cacheTtl,
            contextPctBasis: extras.contextPctBasis,
            speedMetricMode: extras.speedMetricMode,
            quotaWindowMode: extras.quotaWindowMode,
            quotaDirectionMode: extras.quotaDirectionMode,
            appOnboardingDismissed: Boolean(
                extras.appSettings?.appOnboardingDismissed
                ?? params.settings?.appOnboardingDismissed,
            ),
            cdpStatus: extras.cdpStatus,
            appTopBarEnabled: extras.appSettings?.appTopBarEnabled ?? params.settings?.appTopBarEnabled,
            appComposerRingEnabled: extras.appSettings?.appComposerRingEnabled ?? params.settings?.appComposerRingEnabled,
        },
    );

    const gmDataHtml = buildGMDataTabContent(
        params.activitySummary ?? null,
        gmSummary,
        usage,
        accountSnapshots,
        todayLedgerActive,
        ledgerSettled,
        customPricing,
        extras.turnDiagnostics,
        {
            privacyMasked,
            cacheTtl: extras.cacheTtl ?? extras.promptCacheTtl ?? null,
            speedMetricMode: extras.speedMetricMode,
            currency: displayCurrency,
            nowMs: now,
        },
    );

    const chatsHtml = buildChatHistoryTabContent(
        allTrajectories,
        usage,
        gmSummary,
        gmConversations,
        workspaceUri,
        undefined,
        {
            swarmTopology: extras.swarmTopology,
            swarmOverview,
            inspectedMemberId: extras.inspectedMemberId,
            lockedRootId: extras.lockedRootId,
            displayCurrency,
            privacyMasked,
        },
    );

    const pricingHtml = pricingStore
        ? buildPricingTabContent(
            gmFullSummary,
            pricingStore,
            dailyStore?.getMonthCostBreakdown(nowDate.getFullYear(), nowDate.getMonth() + 1),
            ledgerSettled,
            todayLedgerActive,
            [usage, ...allUsages].some(item => (item?.imageGenStepCount || 0) > 0),
            {
                orchestratorSettings: params.orchestratorSettings,
                ledgerDateKey: params.ledgerDateKey,
                orchestratorPricingMode,
                currency: displayCurrency,
            },
        )
        : `<p class="empty-msg">${tBiHtml('Initializing...', '初始化中...')}</p>`;

    const modelsHtml = buildModelsTabContent(userInfo, modelConfigs, {
        orchestratorSettings: params.orchestratorSettings,
        quotaSummary: params.quotaSummary,
        customPricing,
        orchestratorPricingMode,
        quotaRunways: extras.quotaRunways,
        weeklyRunways: extras.weeklyRunways ?? extras.weeklyQuotaRunways,
        quotaWindowMode: extras.quotaWindowMode,
        quotaDirectionMode: extras.quotaDirectionMode,
        isCustomModelActive: extras.isCustomModelActive,
        staleState: extras.staleState,
    });

    const hasLiveLedgerData = todayLedgerActive.length > 0 || ledgerSettled.length > 0;
    const derivedSwarmGroups: SwarmGroupAttributionSpec[] | undefined = extras.swarmTopology && extras.swarmTopology.groupsByRootId.size > 0
        ? [...extras.swarmTopology.groupsByRootId.values()].map(g => ({
            rootId: g.rootId,
            memberIds: [...g.memberIds],
        }))
        : undefined;
    const activeSourceFilter = extras.calendarOptions?.sourceFilter ?? 'all';
    const liveSurface: 'app' | 'ide' = extras.surface === 'app-sidecar' ? 'app' : 'ide';
    const liveMatchesSourceFilter = activeSourceFilter === 'all' || activeSourceFilter === liveSurface;
    const derivedSwarmGroupCosts: Record<string, SwarmGroupCostSummary> | undefined = extras.swarmGroupCost && liveMatchesSourceFilter
        ? { [extras.swarmGroupCost.rootId]: extras.swarmGroupCost }
        : undefined;
    const defaultCalendarOptions: CalendarRenderOptions = {
        ...(hasLiveLedgerData
            ? {
                liveLedger: {
                    active: todayLedgerActive,
                    settled: ledgerSettled,
                    customPricing,
                    defaultSurface: extras.surface === 'app-sidecar' ? 'app' : 'ide',
                },
            }
            : {}),
        currency: displayCurrency as CalendarRenderOptions['currency'],
        subscription: subscriptionConfig as CalendarRenderOptions['subscription'],
        customPricing,
        privacyMasked,
        swarmTopology: privacyMasked ? undefined : extras.swarmTopology ?? undefined,
        ...(derivedSwarmGroups ? { swarmGroups: derivedSwarmGroups } : {}),
        ...(derivedSwarmGroupCosts ? { swarmGroupCosts: derivedSwarmGroupCosts } : {}),
        now,
    };
    const mergedCalendarOptions: CalendarRenderOptions = extras.calendarOptions
        ? { ...defaultCalendarOptions, ...extras.calendarOptions }
        : defaultCalendarOptions;

    const calendarHtml = buildCalendarTabContent(dailyStore, calYear, calMonth, mergedCalendarOptions);
    const profileHtml = buildProfileContent(userInfo, activeBillingDay, {
        privacyMasked,
        accountHandle: activeAccountHandle || undefined,
    });
    const aboutHtml = buildAboutTabContent(extras.version, {
        surface: extras.surface ?? 'ide',
        updateStatus: resolvedUpdateStatus,
        now,
    });

    const surfaceNativeHudSetting = extras.surface === 'app-sidecar'
        ? extras.appSettings?.appShowNativeHudBar
        : extras.appSettings?.ideShowNativeHudBar;
    const showNativeHudBar = surfaceNativeHudSetting
        ?? extras.appSettings?.showNativeHudBar
        ?? params.settings?.showNativeHudBar
        ?? (extras.surface === 'app-sidecar');
    const nativeHudHtml = showNativeHudBar
        ? buildNativeHudHtml({
            quotaWindowMode: extras.quotaWindowMode,
            quotaDirectionMode: extras.quotaDirectionMode,
            usage,
            modelConfigs,
            quotaSummary: params.quotaSummary,
            gmSummary,
            gmConversations,
            customPricing,
            sessionCostUsd: params.sessionCostUsd,
            todayCostUsd: params.todayCostUsd,
            displayCurrency,
            contextBreakdown: extras.contextBreakdown,
            isCustomModelActive: extras.isCustomModelActive,
            activeCascadeId: resolvedActiveCascadeId,
            speedSample: extras.speedSample,
            watermarks: extras.watermarks,
            turnCacheInfo: extras.turnCacheInfo,
            orchestratorSettings: params.orchestratorSettings,
            orchestratorPricingMode,
            observation: extras.observation,
            now,
        })
        : '';

    return {
        overview: overviewHtml + eoc,
        gm: gmDataHtml,
        gmdata: gmDataHtml,
        sessions: chatsHtml,
        chats: chatsHtml,
        pricing: pricingHtml,
        models: modelsHtml,
        calendar: calendarHtml,
        profile: profileHtml,
        about: aboutHtml + eoc,
        accountPopover: accountSnapshots.length > 0 ? buildAccountStatusPanel(accountSnapshots, billingDays, { privacyMasked }) : '',
        accountPopoverHasReady: accountSnapshots.length > 0 ? hasAccountReadyPool(accountSnapshots) : false,
        mastheadControls: buildMonitorMastheadControlsHtml(extras),
        nativeHud: nativeHudHtml,
    };
}

/**
 * Assemble the full HTML5 document shell from prebuilt tab panes and settings markup.
 */
export function buildMonitorShellHtml(params: MonitorShellParams): string {
    const {
        tabs,
        settingsHtml,
        extras,
        paused,
        initialTab,
        panelHintPrefs,
        zoomLevel,
        accountSnapshots,
        billingDays,
        lastUpdatedTime,
    } = params;
    const surface: MonitorSurface = extras.surface ?? 'ide';
    const privacyMasked = extras.privacyMasked !== false;
    const currentLang = getLanguage();
    const langPref = extras.languagePreference ?? extras.appSettings?.languagePreference ?? getLanguagePreference();
    const primaryCompactLang: PrimaryLanguage = extras.primaryCompactLang
        ?? detectHostLocaleLanguage(getRuntimeLocaleSources());
    const viewLang = resolvePerViewEffectiveLanguage(
        currentLang === 'both' ? 'both' : currentLang,
        {
            hostLocale: primaryCompactLang === 'zh' ? 'zh-CN' : 'en-US',
            viewportWidthPx: extras.viewportWidthPx ?? null,
        },
    );
    const htmlLang = viewLang === 'zh' ? 'zh-CN' : 'en';
    const eoc = buildEocSentinel();
    const imagesAttr = extras.imagesBaseUri ? ` data-images-base-uri="${esc(extras.imagesBaseUri)}"` : '';
    const nativeHudHtml = typeof tabs.nativeHud === 'string' ? tabs.nativeHud : '';
    const hudAutoHideOnOverview = extras.nativeHudAutoHideOnOverview !== undefined
        ? Boolean(extras.nativeHudAutoHideOnOverview)
        : (extras.appSettings?.nativeHudAutoHideOnOverview !== undefined
            ? Boolean(extras.appSettings.nativeHudAutoHideOnOverview)
            : true);

    const resolvedInitial = resolveTabAlias(initialTab);
    const activeView: CanonicalViewId = resolvedInitial?.tab ?? 'overview';
    const initialAnchor = resolvedInitial?.anchor ?? '';
    const initialTabAttr = resolvedInitial ? ` data-initial-tab="${esc(resolvedInitial.tab)}"` : '';
    const initialAnchorAttr = initialAnchor ? ` data-initial-anchor="${esc(initialAnchor)}"` : '';

    const isMainActive = (id: CanonicalMainTabId): boolean => activeView === id;
    const settingsTabTipAttrs = docRichTipAttrs({
        key: 'nav:tab:settings',
        title: tBi('Settings', '设置'),
        body: tBi(
            'Overlays & CDP setup, display language & currency, telemetry thresholds, ~/.gemini/GEMINI.md Global Rules, and updates.',
            '配置悬浮层与 CDP 启动器、界面语言与币种、遥测阈值、~/.gemini/GEMINI.md 全局规则与版本更新。',
        ),
    });
    const mainTabSpecs: ReadonlyArray<{ id: CanonicalMainTabId; color: string; labelHtml: string; extraAttrs?: string }> = [
        { id: 'overview', color: 'blue', labelHtml: tHtml('nav.overview') },
        { id: 'gm', color: 'orange', labelHtml: tHtml('nav.modelCalls') },
        { id: 'sessions', color: 'cyan', labelHtml: tHtml('nav.sessions') },
        { id: 'calendar', color: 'blue', labelHtml: tHtml('nav.usageCost') },
        { id: 'models', color: 'green', labelHtml: tHtml('nav.modelsQuotas') },
        { id: 'settings', color: 'slate', labelHtml: tHtml('nav.settings'), extraAttrs: settingsTabTipAttrs },
    ];
    const firstTabFocusFallback = !CANONICAL_MAIN_TABS.includes(activeView as CanonicalMainTabId);
    const mainTabButtonsHtml = mainTabSpecs.map((tab, idx) => {
        const active = isMainActive(tab.id);
        const tabIndex = active || (firstTabFocusFallback && idx === 0) ? '0' : '-1';
        return `<button type="button" class="tab-btn${active ? ' active' : ''}" id="tabBtn-${tab.id}" role="tab" data-tab="${tab.id}" data-color="${tab.color}" aria-selected="${active ? 'true' : 'false'}" aria-controls="tab-${tab.id}" tabindex="${tabIndex}"${active ? ' aria-current="page"' : ''}${tab.extraAttrs || ''}><span class="tab-label">${tab.labelHtml}</span></button>`;
    }).join('\n        ');

    const aboutActive = activeView === 'about';
    const freezeLabel = t('panel.freeze');
    const unfreezeLabel = t('panel.unfreeze');
    const frozenHint = t('panel.frozenHint');
    const gmSlotHtml = typeof tabs.gm === 'string' ? tabs.gm : tabs.gmdata;
    const activitySlotHtml = typeof tabs.activity === 'string' ? tabs.activity : '';
    const sessionsSlotHtml = typeof tabs.sessions === 'string' ? tabs.sessions : tabs.chats;
    const rawCspNonce = typeof extras.cspNonce === 'string' ? extras.cspNonce.trim() : '';
    const safeCspNonce = /^[A-Za-z0-9+/=_-]{8,128}$/.test(rawCspNonce) ? rawCspNonce : '';
    const cspMetaHtml = safeCspNonce
        ? `\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${esc(safeCspNonce)}';">`
        : '';
    const scriptNonceAttr = safeCspNonce ? ` nonce="${esc(safeCspNonce)}"` : '';

    return `<!DOCTYPE html>
<html lang="${htmlLang}" data-hide-scrollbar="${panelHintPrefs.showScrollbar ? 'false' : 'true'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">${cspMetaHtml}
<title>${esc(tBi('Antigravity Monitor', 'Antigravity 监控面板'))}</title>
<style>
${getStyles()}
${getOverviewStyles()}
${getGMDataTabStyles()}
${getPricingTabStyles()}
${getCalendarTabStyles()}
${getOrchestratorAttributionStyles()}
${getAboutTabStyles()}
${getEditorialStyles()}
</style>
${extras.extraHeadHtml || ''}
</head>
<body data-editorial="true" data-acm-surface="${surface}" data-lang="${currentLang}" data-lang-pref="${esc(langPref)}" data-primary-lang="${primaryCompactLang}" data-view-lang="${viewLang}" data-active-tab="${activeView}" data-hud-auto-hide-overview="${hudAutoHideOnOverview ? 'true' : 'false'}"${initialTabAttr}${initialAnchorAttr}${imagesAttr} data-privacy-default="true" data-privacy-masked="${privacyMasked ? 'true' : 'false'}" data-zoom="${zoomLevel}" data-tab-hint-enabled="false" data-hide-scrollbar="${panelHintPrefs.showScrollbar ? 'false' : 'true'}" data-hide-eoc="${panelHintPrefs.showEndOfContent ? 'false' : 'true'}">
    <div class="panel-topbar">
        <header class="topbar-title">
            <div class="topbar-title-left">
                <h1>
                    ${ICON.chart}
                    <span class="topbar-brand-text">${tBiHtml('Antigravity Monitor', 'Antigravity 监控面板')}</span>
                </h1>
                <div class="acct-popover-anchor">
                    <button type="button" class="acct-popover-trigger" id="acctPopoverTrigger" aria-expanded="false" aria-controls="acctPopoverPanel">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16.5 6.5l2 -2M18 8l2.5 -1M18.5 4.5L20 2.5" opacity="0.5"/></svg>
                        <span>${tBiHtml('Account Panel', '账号面板')}</span>
                        ${hasAccountReadyPool(accountSnapshots) ? '<span class="acct-popover-dot" aria-hidden="true"></span>' : ''}
                    </button>
                </div>
            </div>
            <div class="header-actions">
                <div class="lang-switcher">
                    <button type="button" class="lang-btn${currentLang === 'zh' ? ' active' : ''}" data-lang="zh">中文</button>
                    <button type="button" class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
                    <button type="button" class="lang-btn${currentLang === 'both' ? ' active' : ''}" data-lang="both">${tBiHtml('Both', '双语')}</button>
                </div>
                <button type="button" class="action-btn${paused ? ' paused' : ''}" id="pauseBtn"
                    aria-pressed="${paused}" aria-label="${esc(paused ? unfreezeLabel : freezeLabel)}"
                    data-label-pause="${esc(freezeLabel)}"
                    data-label-resume="${esc(unfreezeLabel)}"
                    data-label-paused="${esc(tBi('FROZEN', '已冻结'))}"
                    data-tip-body-pause="${esc(tBi('Freeze panel polling.', '冻结面板轮询。'))}"
                    data-tip-body-resume="${esc(frozenHint)}"
                    data-popover-key="topbar:pause"
                    data-tip-title="${esc(paused ? unfreezeLabel : freezeLabel)}"
                    data-tip-body="${esc(paused ? frozenHint : tBi('Freeze panel polling.', '冻结面板轮询。'))}">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${paused
            ? '<path fill="currentColor" d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>'
            : '<path fill="currentColor" d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>'
        }</svg>
                </button>
                <button type="button" class="action-btn" id="refreshBtn" aria-label="${esc(tBi('Refresh', '刷新'))}"
                    data-popover-key="topbar:refresh"
                    data-tip-title="${esc(tBi('Refresh Now', '立即刷新'))}"
                    data-tip-body="${esc(tBi('Fetch latest telemetry now.', '立即拉取最新遥测数据。'))}">
                    ${ICON.refresh}
                </button>
                <button type="button" class="action-btn topbar-util-btn${aboutActive ? ' active' : ''}" id="topbarAboutBtn"
                    data-utility-view="about" aria-pressed="${aboutActive ? 'true' : 'false'}" aria-controls="tab-about"
                    aria-label="${esc(t('nav.about'))}"
                    data-popover-key="topbar:about"
                    data-tip-title="${esc(tBi('About Antigravity Monitor', '关于 Antigravity 监控面板'))}"
                    data-tip-body="${esc(tBi('Version, supported features, privacy, and project links.', '查看运行版本、各项功能、隐私说明与开源项目链接。'))}">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
                </button>
                <span class="update-time">${paused ? `<span class="paused-indicator">${tBiHtml('FROZEN', '已冻结')}</span>` : ''} ${esc(lastUpdatedTime)}</span>
            </div>
        </header>

        <div class="masthead-context-bar" id="mastheadContextBar">
            ${tabs.mastheadControls}
        </div>

        <div class="tab-bar-wrapper">
        <nav class="tab-bar" id="tabBar" role="tablist" aria-label="${esc(tBi('Monitor sections', '监控面板分区'))}">
        <div class="tab-slider" aria-hidden="true"></div>
        ${mainTabButtonsHtml}
    </nav>
    </div>

    <div class="acct-popover-dropdown" id="acctPopoverPanel" hidden>
        <div class="acct-popover-body" id="acctPopoverBody">
            ${accountSnapshots.length > 0 ? buildAccountStatusPanel(accountSnapshots, billingDays, { privacyMasked }) : `<p class="empty-msg">${tBiHtml('No account data yet.', '暂无账号数据。')}</p>`}
        </div>
    </div>
    </div>
    <div class="native-hud-host" id="nativeHudHost" data-hud-enabled="${nativeHudHtml ? 'true' : 'false'}"${nativeHudHtml ? '' : ' hidden'}>${nativeHudHtml}</div>
    <main id="monitor-content">
    <div class="tab-pane${activeView === 'overview' ? ' active' : ''}" id="tab-overview" role="tabpanel" aria-labelledby="tabBtn-overview">
        ${tabs.overview}
    </div>
    <div class="tab-pane${activeView === 'gm' ? ' active' : ''}" id="tab-gm" role="tabpanel" aria-labelledby="tabBtn-gm">
        <div class="tab-slot" id="slot-gm" data-tab-slot="gm">${gmSlotHtml}</div>
        <div class="tab-slot tab-slot-secondary" id="slot-activity" data-tab-slot="activity"${activitySlotHtml ? '' : ' hidden'}>${activitySlotHtml}</div>
        ${eoc}
    </div>
    <div class="tab-pane${activeView === 'sessions' ? ' active' : ''}" id="tab-sessions" role="tabpanel" aria-labelledby="tabBtn-sessions">
        <div class="tab-slot" id="slot-sessions" data-tab-slot="sessions">${sessionsSlotHtml}</div>
        ${eoc}
    </div>
    <div class="tab-pane${activeView === 'calendar' ? ' active' : ''}" id="tab-calendar" role="tabpanel" aria-labelledby="tabBtn-calendar">
        <div class="tab-slot" id="slot-calendar" data-tab-slot="calendar">${tabs.calendar}</div>
        <div class="tab-slot tab-slot-secondary" id="slot-pricing" data-tab-slot="pricing">${tabs.pricing}</div>
        ${eoc}
    </div>
    <div class="tab-pane${activeView === 'models' ? ' active' : ''}" id="tab-models" role="tabpanel" aria-labelledby="tabBtn-models">
        <div class="tab-slot" id="slot-models" data-tab-slot="models">${tabs.models}</div>
        <div class="tab-slot tab-slot-secondary" id="slot-profile" data-tab-slot="profile">${tabs.profile}</div>
        ${eoc}
    </div>
    <div class="tab-pane${activeView === 'settings' ? ' active' : ''}" id="tab-settings" role="tabpanel" aria-labelledby="tabBtn-settings">
        ${settingsHtml}
        ${eoc}
    </div>
    <div class="tab-pane${activeView === 'about' ? ' active' : ''}" id="tab-about" role="region" aria-label="${esc(t('nav.about'))}">
        ${tabs.about}
    </div>

    </main>
    <div id="acmLiveRegion" class="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label="${esc(t('a11y.statusRegionLabel'))}"></div>
    <div id="acmRichTipPopover" class="acm-rich-tip" role="tooltip" hidden data-pinned="false" data-placement="top" aria-hidden="true">
        <div class="acm-rich-tip-head" id="acmRichTipHead" hidden>
            <div class="acm-rich-tip-title" id="acmRichTipTitle"></div>
            <button type="button" class="acm-rich-tip-close" id="acmRichTipClose" aria-label="${esc(tBi('Close tip', '关闭说明'))}" hidden>×</button>
        </div>
        <div class="acm-rich-tip-body" id="acmRichTipBody"></div>
        <div class="acm-rich-tip-meta" id="acmRichTipMeta" hidden></div>
    </div>
    <script${scriptNonceAttr}>
        ${getScript()}
    </script>
    ${extras.extraBodyEndHtml || ''}
</body>
</html>`;
}

/**
 * Render a complete, self-contained Monitor HTML document for either
 * Antigravity IDE (`surface: 'ide'`) or Antigravity App (`surface: 'app-sidecar'`).
 */
export function buildMonitorDocumentHtml(params: MonitorDocumentBuildParams): string {
    const extras = resolveExtras(params);
    const tabs = buildMonitorTabsPayload(params);
    const modelConfigs = params.modelConfigs ?? params.userStatus?.configs ?? [];
    const panelHintPrefs: PanelHintPreferences = params.panelHintPrefs ?? {
        showTabScrollHint: true,
        showScrollbar: false,
        showEndOfContent: true,
    };
    const mergedSettings = params.settings
        ? {
            ...params.settings,
            ...(extras.lockToMainAgent !== undefined ? { lockToMainAgent: extras.lockToMainAgent } : {}),
            ...(extras.orchestratorPricingMode !== undefined ? { orchestratorPricingMode: extras.orchestratorPricingMode } : {}),
        }
        : (extras.surface === 'app-sidecar'
            ? {
                ...DEFAULT_MONITOR_DOCUMENT_SETTINGS,
                lockToMainAgent: !!extras.lockToMainAgent,
                ...(extras.orchestratorPricingMode !== undefined ? { orchestratorPricingMode: extras.orchestratorPricingMode } : {}),
            }
            : undefined);

    const resolvedUpdateStatus = resolveUpdateStatusView(
        extras.updateStatus,
        extras.appSettings?.lastUpdateCheck,
        extras.version,
    );
    const zoomLevel = params.zoomLevel ?? 100;

    const mergedAppSettingsForSettingsTab: Partial<AppSettingsWithV118> | undefined = (
        extras.appSettings
        || extras.languagePreference !== undefined
        || extras.nativeHudAutoHideOnOverview !== undefined
        || extras.contextPctBasis !== undefined
        || extras.speedMetricMode !== undefined
        || extras.quotaWindowMode !== undefined
        || extras.quotaDirectionMode !== undefined
    )
        ? {
            ...(extras.appSettings ?? {}),
            ...(extras.languagePreference !== undefined ? { languagePreference: extras.languagePreference } : {}),
            ...(extras.nativeHudAutoHideOnOverview !== undefined ? { nativeHudAutoHideOnOverview: extras.nativeHudAutoHideOnOverview } : {}),
            ...(extras.contextPctBasis !== undefined ? { contextPctBasis: extras.contextPctBasis } : {}),
            ...(extras.speedMetricMode !== undefined ? { speedMetricMode: extras.speedMetricMode } : {}),
            ...(extras.quotaWindowMode !== undefined ? { quotaWindowMode: extras.quotaWindowMode } : {}),
            ...(extras.quotaDirectionMode !== undefined ? { quotaDirectionMode: extras.quotaDirectionMode } : {}),
        }
        : undefined;

    const settingsHtml = buildSettingsContent(
        modelConfigs,
        params.storageDiagnostics,
        panelHintPrefs,
        {
            settings: mergedSettings,
            appSettings: mergedAppSettingsForSettingsTab,
            surface: extras.surface ?? 'ide',
            zoomLevel,
            version: extras.version,
            cdpStatus: extras.cdpStatus,
            updateStatus: resolvedUpdateStatus,
            globalRules: extras.globalRules,
            privacyMasked: extras.privacyMasked !== false,
        },
    );

    const paused = Boolean(params.paused ?? params.isPaused ?? false);
    const now = params.now ?? Date.now();
    const lastUpdatedTime = params.lastUpdatedTime || formatClockTime(new Date(now), getLanguage());

    return buildMonitorShellHtml({
        tabs,
        settingsHtml,
        extras,
        paused,
        initialTab: params.initialTab,
        panelHintPrefs,
        zoomLevel,
        accountSnapshots: params.accountSnapshots ?? [],
        billingDays: params.billingDays ?? {},
        lastUpdatedTime,
    });
}

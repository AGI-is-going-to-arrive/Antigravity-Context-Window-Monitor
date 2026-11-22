// ─── Shared Pure Webview Document Builder ────────────────────────────────────
// Renders the complete Studio Telemetry Ledger HTML document and incremental
// tab payloads for BOTH Antigravity IDE (VS Code Webview) and Antigravity App
// (Desktop 2.0+ native Sidecar plugin).
//
// ZERO `vscode` runtime imports — safe in pure Node / Sidecar / unit tests.

import { formatClockTime, getLanguage, tBi } from './i18n-core';
import type { ContextUsage, TrajectorySummary } from './tracker';
import type { FullUserStatus, ModelConfig, OrchestratorSettings, UserQuotaSummary, UserStatusInfo } from './models';
import type { ActivitySummary } from './activity-tracker';
import {
    buildAccountStatusPanel,
    buildGMDataTabContent,
    getGMDataTabStyles,
    hasAccountReadyPool,
    type AccountSnapshot,
} from './activity-panel';
import type { DailyLedger, LedgerAccountBucket, LedgerSettledEntry } from './daily-ledger';
import { buildPricingTabContent, getPricingTabStyles } from './pricing-panel';
import { PricingStore, type ModelPricing } from './pricing-store';
import type { GMConversationData, GMSummary } from './gm-tracker';
import { ICON } from './webview-icons';
import { esc, tBiHtml } from './webview-helpers';
import { buildModelsTabContent } from './webview-models-tab';
import { buildProfileContent } from './webview-profile-tab';
import {
    buildSettingsContent,
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
    normalizeMonitorDocumentSettings,
    type MonitorDocumentSettings,
    type PanelHintPreferences,
    type StorageDiagnostics,
} from './webview-settings-tab';
import { buildAboutTabContent, getAboutTabStyles } from './webview-about-tab';
import { buildCalendarTabContent, getCalendarTabStyles } from './webview-calendar-tab';
import { buildChatHistoryTabContent } from './webview-chat-history-tab';
import { DailyStore, type DailyStoreState } from './daily-store';
import { getScript } from './webview-script';
import { getStyles } from './webview-styles';
import { getEditorialStyles } from './webview-editorial-styles';
import {
    buildOverviewTabContent,
    getOverviewStyles,
    type MonitorStaleState,
} from './webview-overview-tab';
import type { MonitorStatus, OverviewDestination } from './monitor-overview';
import type { ContextBreakdownSnapshot } from './context-breakdown';
import type { TurnDiagnosticsSummary } from './turn-diagnostics';
import type { QuotaRunwayEstimate } from './quota-runway';
import type { ConversationOption } from './conversation-selector';

export {
    DEFAULT_MONITOR_DOCUMENT_SETTINGS,
    normalizeMonitorDocumentSettings,
};
export type {
    MonitorDocumentSettings,
    MonitorStaleState,
    PanelHintPreferences,
    StorageDiagnostics,
};

// ─── Contracts ───────────────────────────────────────────────────────────────

export type MonitorSurface = 'ide' | 'app-sidecar';

export type MonitorTabId =
    | OverviewDestination
    | 'gmdata'
    | 'pricing'
    | 'chats'
    | 'calendar'
    | 'profile'
    | 'about';

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
    settings?: Partial<MonitorDocumentSettings>;
    /** Explicit formatted clock string (defaults to `formatClockTime(new Date(now), getLanguage())`). */
    lastUpdatedTime?: string;
    /** Optional deterministic timestamp (ms) for tests. */
    now?: number;
    /** Optional nested v1.17.5 extras (merged with top-level flat fields; flat fields take precedence). */
    extras?: MonitorDocumentV1175Extras;
}

export interface MonitorTabsPayload {
    overview: string;
    gmdata: string;
    chats: string;
    pricing: string;
    models: string;
    calendar: string;
    profile: string;
    about: string;
    accountPopover: string;
    accountPopoverHasReady: boolean;
    mastheadControls: string;
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

// ─── Internal Helpers ────────────────────────────────────────────────────────

const LOCK_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const UNLOCK_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.3"/></svg>';

function buildEocSentinel(): string {
    return `<div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBiHtml('End of content', '已到底')}</span></div>`;
}

function resolveExtras(params: MonitorDocumentBuildParams): MonitorDocumentV1175Extras {
    const nested = params.extras ?? {};
    return {
        surface: params.surface ?? nested.surface ?? 'ide',
        version: params.version ?? nested.version,
        contextBreakdown: params.contextBreakdown !== undefined ? params.contextBreakdown : nested.contextBreakdown,
        turnDiagnostics: params.turnDiagnostics !== undefined ? params.turnDiagnostics : nested.turnDiagnostics,
        quotaRunways: params.quotaRunways ?? nested.quotaRunways,
        isCustomModelActive: params.isCustomModelActive !== undefined ? params.isCustomModelActive : nested.isCustomModelActive,
        staleState: params.staleState !== undefined ? params.staleState : nested.staleState,
        conversationOptions: params.conversationOptions ?? nested.conversationOptions,
        activeConversationId: params.activeConversationId !== undefined ? params.activeConversationId : nested.activeConversationId,
        pinnedConversationId: params.pinnedConversationId !== undefined ? params.pinnedConversationId : nested.pinnedConversationId,
        lockToMainAgent: params.lockToMainAgent !== undefined
            ? params.lockToMainAgent
            : (nested.lockToMainAgent ?? params.settings?.lockToMainAgent ?? false),
        extraHeadHtml: params.extraHeadHtml ?? nested.extraHeadHtml,
        extraBodyEndHtml: params.extraBodyEndHtml ?? nested.extraBodyEndHtml,
        imagesBaseUri: params.imagesBaseUri ?? nested.imagesBaseUri,
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
        const ts = extras.staleState.lastSuccessAtMs
            ? ` · ${esc(formatClockTime(new Date(extras.staleState.lastSuccessAtMs), currentLang))}`
            : '';
        const errTitle = extras.staleState.lastError ? ` title="${esc(extras.staleState.lastError)}"` : '';
        return `<span class="stale-badge" id="staleBadge" role="status"${errTitle}>
            <span class="stale-dot" aria-hidden="true"></span>
            <span>${tBiHtml('Cached / Stale', '缓存数据（待刷新）')}${ts}</span>
        </span>`;
    })() : '';

    return `
        <div class="masthead-context-controls">
            <label class="conv-switcher-wrap" for="conversationSwitcher">
                <span class="sr-only">${tBiHtml('Conversation Switcher', '会话切换器')}</span>
                <select id="conversationSwitcher" class="conv-switcher-select" aria-label="${esc(tBi('Conversation Switcher', '会话切换器'))}" data-active-id="${esc(activeId)}" data-pinned-id="${esc(pinnedId)}">
                    ${optionTags.join('')}
                </select>
            </label>
            <button type="button" class="lock-main-btn${locked ? ' is-locked' : ''}" id="lockMainBtn"
                data-action="toggleLockMain" aria-pressed="${locked ? 'true' : 'false'}"
                title="${esc(tBi('Ignore background subagents and keep tracking the main conversation', '忽略后台子智能体并持续锁定当前主会话'))}">
                ${locked ? LOCK_ICON_SVG : UNLOCK_ICON_SVG}
                <span>${tBiHtml('Lock to Main Agent', '锁定主会话')}</span>
            </button>
        </div>
        <div class="masthead-context-badges">
            ${staleBadgeHtml}
            <span class="surface-badge" data-surface="${surface}">${surfaceLabelHtml}</span>
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
    const usage = params.currentUsage !== undefined ? params.currentUsage : (params.data ?? null);
    const monitorStatus = normalizeMonitorStatus(params.monitorStatus ?? params.backendStatus, usage);
    const allUsages = params.allTrajectoryUsages ?? (usage ? [usage] : []);
    const allTrajectories = params.allTrajectories ?? [];
    const userInfo = params.userInfo !== undefined ? params.userInfo : (params.userStatus?.userInfo ?? null);
    const modelConfigs = params.modelConfigs ?? params.userStatus?.configs ?? [];
    const workspaceUri = params.workspaceUri ?? '';
    const accountSnapshots = params.accountSnapshots ?? [];
    const billingDays = params.billingDays ?? {};
    const activeBillingDay = billingDays[userInfo?.email ?? params.activeAccountKey ?? ''] ?? 0;
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

    const overviewHtml = buildOverviewTabContent(
        usage,
        modelConfigs,
        userInfo,
        activeBillingDay,
        monitorStatus,
        now,
        {
            gmSummary,
            customPricing,
            activeCascadeId: usage?.cascadeId ?? extras.activeConversationId ?? undefined,
            orchestratorSettings: params.orchestratorSettings,
            quotaSummary: params.quotaSummary,
            todayCostUsd: params.todayCostUsd,
            sessionCostUsd: params.sessionCostUsd,
            contextBreakdown: extras.contextBreakdown,
            quotaRunways: extras.quotaRunways,
            isCustomModelActive: extras.isCustomModelActive,
            staleState: extras.staleState,
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
    );

    const chatsHtml = buildChatHistoryTabContent(
        allTrajectories,
        usage,
        gmSummary,
        gmConversations,
        workspaceUri,
    );

    const pricingHtml = pricingStore
        ? buildPricingTabContent(
            gmFullSummary,
            pricingStore,
            dailyStore?.getMonthCostBreakdown(nowDate.getFullYear(), nowDate.getMonth() + 1),
            ledgerSettled,
            todayLedgerActive,
            [usage, ...allUsages].some(item => (item?.imageGenStepCount || 0) > 0),
        )
        : `<p class="empty-msg">${tBiHtml('Initializing...', '初始化中...')}</p>`;

    const modelsHtml = buildModelsTabContent(userInfo, modelConfigs, {
        orchestratorSettings: params.orchestratorSettings,
        quotaSummary: params.quotaSummary,
        customPricing,
        quotaRunways: extras.quotaRunways,
        isCustomModelActive: extras.isCustomModelActive,
        staleState: extras.staleState,
    });

    const calendarHtml = buildCalendarTabContent(dailyStore, calYear, calMonth);
    const profileHtml = buildProfileContent(userInfo, modelConfigs, activeBillingDay, params.quotaSummary);
    const aboutHtml = buildAboutTabContent(extras.version);

    return {
        overview: overviewHtml + eoc,
        gmdata: gmDataHtml + eoc,
        chats: chatsHtml + eoc,
        pricing: pricingHtml + eoc,
        models: modelsHtml + eoc,
        calendar: calendarHtml + eoc,
        profile: profileHtml + eoc,
        about: aboutHtml + eoc,
        accountPopover: accountSnapshots.length > 0 ? buildAccountStatusPanel(accountSnapshots, billingDays) : '',
        accountPopoverHasReady: accountSnapshots.length > 0 ? hasAccountReadyPool(accountSnapshots) : false,
        mastheadControls: buildMonitorMastheadControlsHtml(extras),
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
    const currentLang = getLanguage();
    const htmlLang = currentLang === 'zh' ? 'zh-CN' : currentLang === 'en' ? 'en' : 'zh-CN';
    const eoc = buildEocSentinel();
    const imagesAttr = extras.imagesBaseUri ? ` data-images-base-uri="${esc(extras.imagesBaseUri)}"` : '';

    return `<!DOCTYPE html>
<html lang="${htmlLang}" data-hide-scrollbar="${panelHintPrefs.showScrollbar ? 'false' : 'true'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getStyles()}
${getOverviewStyles()}
${getGMDataTabStyles()}
${getPricingTabStyles()}
${getCalendarTabStyles()}
${getAboutTabStyles()}
${getEditorialStyles()}
</style>
${extras.extraHeadHtml || ''}
</head>
<body data-editorial="true" data-acm-surface="${surface}" data-lang="${currentLang}"${initialTab ? ` data-initial-tab="${esc(initialTab)}"` : ''}${imagesAttr} data-privacy-default="true" data-zoom="${zoomLevel}" data-tab-hint-enabled="${panelHintPrefs.showTabScrollHint ? 'true' : 'false'}" data-hide-scrollbar="${panelHintPrefs.showScrollbar ? 'false' : 'true'}" data-hide-eoc="${panelHintPrefs.showEndOfContent ? 'false' : 'true'}">
    <div class="panel-topbar">
        <header class="topbar-title">
            <div class="topbar-title-left">
                <h1>
                    ${ICON.chart}
                    <span class="topbar-brand-text">${tBiHtml('Antigravity Monitor', 'Antigravity 监控面板')}</span>
                </h1>
                <div class="acct-popover-anchor">
                    <button class="acct-popover-trigger" id="acctPopoverTrigger" aria-expanded="false" aria-controls="acctPopoverPanel">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16.5 6.5l2 -2M18 8l2.5 -1M18.5 4.5L20 2.5" opacity="0.5"/></svg>
                        <span>${tBiHtml('Account Panel', '账号面板')}</span>
                        ${hasAccountReadyPool(accountSnapshots) ? '<span class="acct-popover-dot" aria-hidden="true"></span>' : ''}
                    </button>
                </div>
            </div>
            <div class="header-actions">
                <div class="lang-switcher">
                    <button class="lang-btn${currentLang === 'zh' ? ' active' : ''}" data-lang="zh">中文</button>
                    <button class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
                    <button class="lang-btn${currentLang === 'both' ? ' active' : ''}" data-lang="both">${tBiHtml('Both', '双语')}</button>
                </div>
                <button class="action-btn${paused ? ' paused' : ''}" id="pauseBtn"
                    aria-pressed="${paused}" aria-label="${esc(tBi(paused ? 'Resume auto-refresh' : 'Pause auto-refresh', paused ? '恢复自动刷新' : '暂停自动刷新'))}"
                    data-label-pause="${esc(tBi('Pause auto-refresh', '暂停自动刷新'))}"
                    data-label-resume="${esc(tBi('Resume auto-refresh', '恢复自动刷新'))}"
                    data-label-paused="${esc(tBi('PAUSED', '已暂停'))}"
                    data-tooltip="${esc(tBi(paused ? 'Resume auto-refresh' : 'Pause auto-refresh', paused ? '恢复自动刷新' : '暂停自动刷新'))}">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${paused
            ? '<path fill="currentColor" d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>'
            : '<path fill="currentColor" d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>'
        }</svg>
                </button>
                <button class="action-btn" id="refreshBtn" aria-label="${esc(tBi('Refresh', '刷新'))}" data-tooltip="${esc(tBi('Refresh', '刷新'))}">
                    ${ICON.refresh}
                </button>
                <span class="update-time">${paused ? `<span class="paused-indicator">${tBiHtml('PAUSED', '已暂停')}</span>` : ''} ${esc(lastUpdatedTime)}</span>
            </div>
        </header>

        <div class="masthead-context-bar" id="mastheadContextBar">
            ${tabs.mastheadControls}
        </div>

        <div class="tab-bar-wrapper">
        <button class="tab-arrow tab-arrow-left is-faded" id="tabArrowLeft" aria-label="${esc(tBi('Scroll tabs left', '向左滚动标签'))}">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/></svg>
        </button>
        <nav class="tab-bar" id="tabBar" aria-label="${esc(tBi('Monitor sections', '监控面板分区'))}">
        <div class="tab-slider"></div>
        <button class="tab-btn active" data-tab="overview" data-color="blue" aria-current="page">${ICON.chart}<span class="tab-label">${tBiHtml('Overview', '总览')}</span></button>
        <button class="tab-btn" data-tab="gmdata" data-color="orange">${ICON.bolt}<span class="tab-label">${tBiHtml('GM Data', 'GM 数据')}</span></button>
        <button class="tab-btn" data-tab="chats" data-color="cyan">${ICON.chat}<span class="tab-label">${tBiHtml('Sessions', '会话')}</span></button>
        <button class="tab-btn" data-tab="pricing" data-color="blue"><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.315 0-1.667-1.104-2.512-3.233-3.037l-.445-.107V3.63c1.213.183 1.968.91 2.141 1.88h1.762c-.112-1.796-1.519-2.965-3.455-3.124V1.036H8.59v1.383C6.408 2.583 5.008 3.9 5.003 5.54c0 1.592 1.063 2.457 3.146 2.963l.399.1v3.979c-1.29-.183-2.113-.879-2.275-1.8H4zm4.586-4.34C7.494 6.137 6.94 5.695 6.94 5.092c0-.66.52-1.183 1.575-1.37v2.72h.071zm.889 2.283c1.335.36 1.942.846 1.942 1.548 0 .781-.633 1.35-1.823 1.493V8.851l-.119-.127z"/></svg><span class="tab-label">${tBiHtml('Cost', '成本')}</span></button>
        <button class="tab-btn" data-tab="models" data-color="green">${ICON.bolt}<span class="tab-label">${tBiHtml('Models', '模型')}</span></button>
        <button class="tab-btn" data-tab="calendar" data-color="cyan"><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg><span class="tab-label">${tBiHtml('Calendar', '日历')}</span></button>
        <button class="tab-btn" data-tab="profile" data-color="gray">${ICON.user}<span class="tab-label">${tBiHtml('Profile', '个人')}</span></button>
        <button class="tab-btn" data-tab="settings" data-color="gray">${ICON.shield}<span class="tab-label">${tBiHtml('Settings', '设置')}</span></button>
        <button class="tab-btn" data-tab="about" data-color="orange"><svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg><span class="tab-label">${tBiHtml('About', '关于')}</span></button>
    </nav>
        <button class="tab-arrow tab-arrow-right is-faded" id="tabArrowRight" aria-label="${esc(tBi('Scroll tabs right', '向右滚动标签'))}">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>
        </button>
    </div>

    <div class="tab-scroll-hint" id="tabScrollHint" hidden>
        <span class="tab-scroll-hint-text">${ICON.timeline} <span>${tBiHtml('Too many tabs? Hold Shift and use the mouse wheel to scroll horizontally.', '标签过多时，可按住 Shift 再滚动鼠标滚轮进行横向滚动。')}</span></span>
        <button class="tab-scroll-hint-close" id="dismissTabScrollHint" aria-label="${esc(tBi('Dismiss tab scroll hint', '关闭标签滚动提示'))}">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06"/></svg>
        </button>
    </div>
    <div class="acct-popover-dropdown" id="acctPopoverPanel" hidden>
        <div class="acct-popover-body" id="acctPopoverBody">
            ${accountSnapshots.length > 0 ? buildAccountStatusPanel(accountSnapshots, billingDays) : `<p class="empty-msg">${tBiHtml('No account data yet.', '暂无账号数据。')}</p>`}
        </div>
    </div>
    </div>
    <main id="monitor-content">
    <div class="tab-pane active" id="tab-overview">
        ${tabs.overview}
    </div>
    <div class="tab-pane" id="tab-gmdata">
        ${tabs.gmdata}
    </div>
    <div class="tab-pane" id="tab-chats">
        ${tabs.chats}
    </div>
    <div class="tab-pane" id="tab-pricing">
        ${tabs.pricing}
    </div>
    <div class="tab-pane" id="tab-models">
        ${tabs.models}
    </div>
    <div class="tab-pane" id="tab-calendar">
        ${tabs.calendar}
    </div>
    <div class="tab-pane" id="tab-profile">
        ${tabs.profile}
    </div>
    <div class="tab-pane" id="tab-settings">
        ${settingsHtml}
        ${eoc}
    </div>
    <div class="tab-pane" id="tab-about">
        ${tabs.about}
    </div>

    </main>
    <script>
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
        }
        : (extras.surface === 'app-sidecar'
            ? { ...DEFAULT_MONITOR_DOCUMENT_SETTINGS, lockToMainAgent: !!extras.lockToMainAgent }
            : undefined);

    const settingsHtml = buildSettingsContent(
        modelConfigs,
        params.storageDiagnostics,
        panelHintPrefs,
        {
            settings: mergedSettings,
            surface: extras.surface ?? 'ide',
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
        zoomLevel: params.zoomLevel ?? 100,
        accountSnapshots: params.accountSnapshots ?? [],
        billingDays: params.billingDays ?? {},
        lastUpdatedTime,
    });
}

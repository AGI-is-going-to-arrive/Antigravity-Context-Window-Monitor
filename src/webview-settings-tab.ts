// ─── Settings Tab Content Builder ────────────────────────────────────────────
// Builds HTML for the "Settings" tab: storage diagnostics, App Ambient Overlays
// (Opt-In CDP), Updates & Release Checks, Cost/Currency/History, quota threshold,
// polling, collapsible IDE status bar toggles, advanced display, zoom, and panel prefs.
//
// Pure Node/TypeScript safe: ZERO top-level `vscode` import so Antigravity App
// Sidecar and pure Node tests can render Settings without VS Code.

import { tBi } from './i18n-core';
import type { ModelConfig } from './models';
import { parseTooltipDensity } from './tooltip-budget';
import {
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    ROI_DISCLAIMER_EN,
    ROI_DISCLAIMER_ZH,
    SUBSCRIPTION_PLAN_PRESETS,
    type SubscriptionPlanPresetId,
} from './cli-usage-scanner';
import {
    SUPPORTED_DISPLAY_CURRENCIES,
    type AppSettings,
    type DisplayCurrencyCode,
    type OrchestratorPricingMode,
} from './durable-state';
import type { CdpDiagnosticCode, CdpStatus } from './app/sidecar-types';
import { ICON } from './webview-icons';
import { esc, formatFileSize, tBiHtml } from './webview-helpers';

export interface StorageDiagnostics {
    stateFilePath: string;
    stateFileExists: boolean;
    stateFileSizeBytes: number;
    stateFileOpenWarnBytes: number;
    calendarDayCount: number;
}

export interface PanelHintPreferences {
    showTabScrollHint: boolean;
    showScrollbar: boolean;
    showEndOfContent: boolean;
}

export interface UpdateStatusView {
    currentVersion?: string;
    latestVersion?: string | null;
    updateAvailable?: boolean;
    hasUpdate?: boolean;
    status?: 'idle' | 'checking' | 'update_available' | 'up_to_date' | 'not_modified' | 'throttled' | 'error' | 'applying' | 'applied';
    checkedAt?: number | null;
    releaseUrl?: string | null;
    releaseNotesSummary?: string | null;
    error?: string | null;
    requiresReload?: boolean;
}

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
    // v1.17.6 optional settings (100% backward-compatible with v1.17.5 callers)
    appComposerRingEnabled?: boolean;
    appTopBarEnabled?: boolean;
    showNativeHudBar?: boolean;
    orchestratorPricingMode?: OrchestratorPricingMode;
    displayCurrency?: DisplayCurrencyCode;
    customFxRate?: number | null;
    subscriptionPlan?: SubscriptionPlanPresetId;
    subscriptionMonthlyFee?: number | null;
    subscriptionCurrency?: DisplayCurrencyCode;
    calendarRetentionDays?: number;
    autoCheckUpdates?: boolean;
    activityMaxRecentSteps?: number;
    activityMaxArchives?: number;
}

export interface SettingsTabOptions {
    settings?: Partial<MonitorDocumentSettings>;
    appSettings?: Partial<AppSettings> & { subscriptionPlan?: SubscriptionPlanPresetId };
    surface?: 'ide' | 'app-sidecar' | 'app';
    zoomLevel?: number;
    version?: string;
    cdpStatus?: CdpStatus | null;
    updateStatus?: UpdateStatusView | null;
}

export const DEFAULT_MONITOR_DOCUMENT_SETTINGS: MonitorDocumentSettings = {
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
    appComposerRingEnabled: false,
    appTopBarEnabled: false,
    showNativeHudBar: true,
    orchestratorPricingMode: 'mapped',
    displayCurrency: 'USD',
    customFxRate: null,
    subscriptionPlan: 'none',
    subscriptionMonthlyFee: null,
    subscriptionCurrency: 'USD',
    calendarRetentionDays: 400,
    autoCheckUpdates: true,
    activityMaxRecentSteps: 100,
    activityMaxArchives: 20,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) { return fallback; }
    return Math.min(Math.max(Math.round(n), min), max);
}

function normalizeCurrency(value: unknown, fallback: DisplayCurrencyCode = 'USD'): DisplayCurrencyCode {
    if (typeof value !== 'string') { return fallback; }
    const upper = value.trim().toUpperCase();
    return (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(upper)
        ? (upper as DisplayCurrencyCode)
        : fallback;
}

function normalizeNullablePositive(value: unknown, allowZero = false): number | null {
    if (value === null || value === undefined || value === '') { return null; }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) { return null; }
    if (allowZero ? n < 0 : n <= 0) { return null; }
    return n;
}

function normalizeSubscriptionPlan(
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

/** Normalize partial plain settings into a complete, bounds-checked settings object. */
export function normalizeMonitorDocumentSettings(
    partial?: Partial<MonitorDocumentSettings> | null,
): MonitorDocumentSettings {
    const src = partial ?? {};
    const maxRecentSteps = src.activityMaxRecentSteps !== undefined
        ? clampNumber(src.activityMaxRecentSteps, 100, 10, 500)
        : (src.maxRecentSteps !== undefined
            ? clampNumber(src.maxRecentSteps, 100, 10, 500)
            : DEFAULT_MONITOR_DOCUMENT_SETTINGS.maxRecentSteps!);
    const maxArchives = src.activityMaxArchives !== undefined
        ? clampNumber(src.activityMaxArchives, 20, 1, 100)
        : (src.maxArchives !== undefined
            ? clampNumber(src.maxArchives, 20, 1, 100)
            : DEFAULT_MONITOR_DOCUMENT_SETTINGS.maxArchives!);
    const subscriptionMonthlyFee = normalizeNullablePositive(src.subscriptionMonthlyFee, true);
    const subscriptionPlan = normalizeSubscriptionPlan(src.subscriptionPlan, subscriptionMonthlyFee);

    return {
        pollingInterval: clampNumber(src.pollingInterval, DEFAULT_MONITOR_DOCUMENT_SETTINGS.pollingInterval, 1, 60),
        quotaNotificationThreshold: clampNumber(src.quotaNotificationThreshold, DEFAULT_MONITOR_DOCUMENT_SETTINGS.quotaNotificationThreshold, 0, 99),
        showContext: src.showContext ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showContext,
        showQuota: src.showQuota ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showQuota,
        showResetCountdown: src.showResetCountdown ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showResetCountdown,
        showAiCredits: src.showAiCredits ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showAiCredits,
        showSpeed: src.showSpeed ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showSpeed,
        showCacheHit: src.showCacheHit ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showCacheHit,
        showSessionCost: src.showSessionCost ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showSessionCost,
        tooltipDensity: parseTooltipDensity(src.tooltipDensity ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.tooltipDensity),
        showModelInternalId: src.showModelInternalId ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.showModelInternalId,
        maxRecentSteps,
        maxArchives,
        lockToMainAgent: src.lockToMainAgent ?? DEFAULT_MONITOR_DOCUMENT_SETTINGS.lockToMainAgent,
        appComposerRingEnabled: typeof src.appComposerRingEnabled === 'boolean'
            ? src.appComposerRingEnabled
            : DEFAULT_MONITOR_DOCUMENT_SETTINGS.appComposerRingEnabled,
        appTopBarEnabled: typeof src.appTopBarEnabled === 'boolean'
            ? src.appTopBarEnabled
            : DEFAULT_MONITOR_DOCUMENT_SETTINGS.appTopBarEnabled,
        showNativeHudBar: typeof src.showNativeHudBar === 'boolean'
            ? src.showNativeHudBar
            : undefined,
        orchestratorPricingMode: src.orchestratorPricingMode === 'strict' ? 'strict' : 'mapped',
        displayCurrency: normalizeCurrency(src.displayCurrency, 'USD'),
        customFxRate: normalizeNullablePositive(src.customFxRate, false),
        subscriptionPlan,
        subscriptionMonthlyFee,
        subscriptionCurrency: normalizeCurrency(src.subscriptionCurrency, 'USD'),
        calendarRetentionDays: clampNumber(src.calendarRetentionDays, DEFAULT_MONITOR_DOCUMENT_SETTINGS.calendarRetentionDays!, 30, 3650),
        autoCheckUpdates: typeof src.autoCheckUpdates === 'boolean'
            ? src.autoCheckUpdates
            : DEFAULT_MONITOR_DOCUMENT_SETTINGS.autoCheckUpdates,
        activityMaxRecentSteps: maxRecentSteps,
        activityMaxArchives: maxArchives,
    };
}

let hostSettingsProvider: (() => Partial<MonitorDocumentSettings>) | null = null;

/**
 * Register a host-specific settings reader (e.g. VS Code `workspace.getConfiguration`)
 * used when `buildSettingsContent` is invoked without explicit `options.settings`.
 * Keeps `webview-settings-tab.ts` 100% pure Node/TypeScript with zero `vscode` imports.
 */
export function registerSettingsProvider(
    provider: (() => Partial<MonitorDocumentSettings>) | null,
): void {
    hostSettingsProvider = provider;
}

/**
 * Lazy optional VS Code configuration reader — used only when `settings` is
 * omitted by legacy IDE callers/tests. Never fails in pure Node / App Sidecar.
 */
function readOptionalVsCodeSettings(): Partial<MonitorDocumentSettings> {
    if (hostSettingsProvider) {
        try {
            return hostSettingsProvider() || {};
        } catch {
            return {};
        }
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscodeApi = require('vscode') as {
            workspace?: {
                getConfiguration?: (section: string) => {
                    get<T>(key: string, defaultValue: T): T;
                };
            };
        };
        const cfg = vscodeApi?.workspace?.getConfiguration?.('antigravityContextMonitor');
        if (!cfg) { return {}; }
        return {
            pollingInterval: cfg.get<number>('pollingInterval', 5),
            quotaNotificationThreshold: cfg.get<number>('quotaNotificationThreshold', 20),
            showContext: cfg.get<boolean>('statusBar.showContext', true),
            showQuota: cfg.get<boolean>('statusBar.showQuota', true),
            showResetCountdown: cfg.get<boolean>('statusBar.showResetCountdown', true),
            showAiCredits: cfg.get<boolean>('statusBar.showAiCredits', true),
            showSpeed: cfg.get<boolean>('statusBar.showSpeed', false),
            showCacheHit: cfg.get<boolean>('statusBar.showCacheHit', false),
            showSessionCost: cfg.get<boolean>('statusBar.showSessionCost', false),
            tooltipDensity: parseTooltipDensity(cfg.get<string>('statusBar.tooltipDensity', 'auto')),
            showModelInternalId: cfg.get<boolean>('showModelInternalId', false),
            maxRecentSteps: cfg.get<number>('activity.maxRecentSteps', 100),
            maxArchives: cfg.get<number>('activity.maxArchives', 20),
            lockToMainAgent: cfg.get<boolean>('lockToMainAgent', false),
        };
    } catch {
        return {};
    }
}

function resolveCdpDiagnosticCode(
    cdpStatus: CdpStatus | null | undefined,
    composerEnabled: boolean,
    topBarEnabled: boolean,
): CdpDiagnosticCode {
    if (cdpStatus?.diagnosticCode) {
        return cdpStatus.diagnosticCode;
    }
    const anyEnabled = composerEnabled || topBarEnabled;
    const state = cdpStatus?.state ?? (anyEnabled ? 'cdp_unavailable' : 'disabled');
    if (state === 'connected') { return 'connected'; }
    if (state === 'error') { return 'ws_error'; }
    if (state === 'cdp_unavailable') { return 'missing_port_file'; }
    return 'disabled';
}

function buildCdpStatusPillHtml(
    cdpStatus: CdpStatus | null | undefined,
    composerEnabled: boolean,
    topBarEnabled: boolean,
): string {
    const anyEnabled = composerEnabled || topBarEnabled;
    const state = cdpStatus?.state ?? (anyEnabled ? 'cdp_unavailable' : 'disabled');
    const diagCode = resolveCdpDiagnosticCode(cdpStatus, composerEnabled, topBarEnabled);
    if (state === 'connected') {
        const title = cdpStatus?.targetTitle
            ? ` title="${esc(cdpStatus.targetTitle)}"`
            : '';
        return `<span class="stg-status-pill is-connected" id="cdpStatusPill" data-cdp-state="connected" data-cdp-diagnostic="${esc(diagCode)}"${title}>${tBiHtml('Connected', '已连接')}</span>`;
    }
    if (state === 'error') {
        const title = cdpStatus?.errorMessage ? ` title="${esc(cdpStatus.errorMessage)}"` : '';
        return `<span class="stg-status-pill is-error" id="cdpStatusPill" data-cdp-state="error" data-cdp-diagnostic="${esc(diagCode)}"${title}>${tBiHtml('CDP Error', 'CDP 异常')}</span>`;
    }
    if (state === 'cdp_unavailable') {
        return `<span class="stg-status-pill is-inactive" id="cdpStatusPill" data-cdp-state="cdp_unavailable" data-cdp-diagnostic="${esc(diagCode)}">${tBiHtml('CDP Inactive', 'CDP 未就绪')}</span>`;
    }
    return `<span class="stg-status-pill is-disabled" id="cdpStatusPill" data-cdp-state="disabled" data-cdp-diagnostic="disabled">${tBiHtml('Disabled', '未启用')}</span>`;
}

function buildCdpDiagnosticHintHtml(
    cdpStatus: CdpStatus | null | undefined,
    composerEnabled: boolean,
    topBarEnabled: boolean,
): string {
    const anyEnabled = composerEnabled || topBarEnabled;
    const state = cdpStatus?.state ?? (anyEnabled ? 'cdp_unavailable' : 'disabled');
    const diagCode = resolveCdpDiagnosticCode(cdpStatus, composerEnabled, topBarEnabled);
    if (state === 'disabled' || diagCode === 'disabled') {
        return `<div class="stg-diagnostic-hint" id="cdpDiagnosticHint" data-cdp-diagnostic="disabled" role="status" hidden></div>`;
    }
    const portSuffixEn = typeof cdpStatus?.discoveredPort === 'number' ? ` (port ${cdpStatus.discoveredPort})` : '';
    const portSuffixZh = typeof cdpStatus?.discoveredPort === 'number' ? `（端口 ${cdpStatus.discoveredPort}）` : '';
    const titleSuffix = cdpStatus?.targetTitle ? ` — ${cdpStatus.targetTitle}` : '';
    const errSuffixEn = cdpStatus?.errorMessage ? `: ${cdpStatus.errorMessage}` : '';
    const errSuffixZh = cdpStatus?.errorMessage ? `：${cdpStatus.errorMessage}` : '';

    let toneClass = 'is-warn';
    let messageHtml = '';
    switch (diagCode) {
        case 'connected':
            toneClass = 'is-good';
            messageHtml = tBiHtml(
                `Connected to Antigravity Hub${portSuffixEn}${titleSuffix}.`,
                `已连接到 Antigravity 主窗口${portSuffixZh}${titleSuffix}。`,
            );
            break;
        case 'port_unreachable':
            toneClass = 'is-warn';
            messageHtml = tBiHtml(
                `Found DevToolsActivePort${portSuffixEn}, but the CDP port is unreachable (stale file from an earlier run). Fully quit Antigravity App, relaunch with --remote-debugging-port=0, then click Recheck CDP.`,
                `检测到 DevToolsActivePort${portSuffixZh}，但调试端口无响应（可能是旧会话残留文件）。请完全退出 Antigravity App 并以 --remote-debugging-port=0 重启，再点击「重新检测」。`,
            );
            break;
        case 'no_hub_target':
            toneClass = 'is-warn';
            messageHtml = tBiHtml(
                `CDP port${portSuffixEn} is listening, but no Antigravity Hub window target was found (only sidecar or DevTools targets detected). Open an Antigravity workspace window and click Recheck CDP.`,
                `CDP 端口${portSuffixZh}已响应，但未找到 Antigravity 主窗口目标（仅检测到侧栏或 DevTools 页面）。请打开 Antigravity 主窗口后点击「重新检测」。`,
            );
            break;
        case 'ws_error':
            toneClass = 'is-error';
            messageHtml = tBiHtml(
                `CDP WebSocket connection failed${errSuffixEn}. Click Recheck CDP or relaunch Antigravity App with --remote-debugging-port=0.`,
                `CDP WebSocket 连接失败${errSuffixZh}。请点击「重新检测」或以 --remote-debugging-port=0 重启 Antigravity App。`,
            );
            break;
        case 'eval_error':
            toneClass = 'is-error';
            messageHtml = tBiHtml(
                `Connected to Antigravity Hub, but overlay injection failed${errSuffixEn}. Click Recheck CDP once the window finishes loading.`,
                `已连接 Antigravity 主窗口，但悬浮组件注入失败${errSuffixZh}。请待窗口加载完成后点击「重新检测」。`,
            );
            break;
        case 'missing_port_file':
        default:
            toneClass = 'is-warn';
            messageHtml = tBiHtml(
                'DevToolsActivePort not found — Antigravity App was launched without --remote-debugging-port=0 (or an auto-update restart dropped the flag). Quit completely first (Cmd+Q on macOS), relaunch with the command below, then click Recheck CDP.',
                '未检测到 DevToolsActivePort —— Antigravity App 未使用 --remote-debugging-port=0 启动（或自动更新重启丢弃了启动参数）。请先完全退出（macOS 按 Cmd+Q），按下方命令重启后再点击「重新检测」。',
            );
            break;
    }
    return `<div class="stg-diagnostic-hint ${toneClass}" id="cdpDiagnosticHint" data-cdp-diagnostic="${esc(diagCode)}" role="status">${messageHtml}</div>`;
}

function buildUpdateStatusPillHtml(
    currentVersion: string,
    updateStatus: UpdateStatusView | null | undefined,
): { pillHtml: string; updateAvailable: boolean; latestTag: string | null } {
    const curTag = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
    const rawLatest = updateStatus?.latestVersion?.trim() || null;
    const latestTag = rawLatest ? (rawLatest.startsWith('v') ? rawLatest : `v${rawLatest}`) : null;
    const updateAvailable = Boolean(
        updateStatus?.updateAvailable
        || updateStatus?.hasUpdate
        || updateStatus?.status === 'update_available',
    );
    if (updateAvailable && latestTag) {
        return {
            updateAvailable: true,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-update" id="updateStatusPill" data-update-status="update_available">${tBiHtml(`Update available: ${latestTag}`, `有可用更新：${latestTag}`)}</span>`,
        };
    }
    if (updateStatus?.status === 'error') {
        const title = updateStatus.error ? ` title="${esc(updateStatus.error)}"` : '';
        return {
            updateAvailable: false,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-error" id="updateStatusPill" data-update-status="error"${title}>${tBiHtml('Check failed', '检查失败')}</span>`,
        };
    }
    if (updateStatus?.status === 'up_to_date' || updateStatus?.status === 'not_modified' || (updateStatus?.checkedAt && !updateAvailable)) {
        return {
            updateAvailable: false,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-uptodate" id="updateStatusPill" data-update-status="up_to_date">${tBiHtml(`Up to date (${curTag})`, `已是最新（${curTag}）`)}</span>`,
        };
    }
    return {
        updateAvailable: false,
        latestTag,
        pillHtml: `<span class="stg-status-pill" id="updateStatusPill" data-update-status="idle">${tBiHtml(`Current ${curTag}`, `当前版本 ${curTag}`)}</span>`,
    };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the Settings tab HTML from plain settings (or lazy VS Code config fallback). */
export function buildSettingsContent(
    _configs: ModelConfig[],
    storage?: StorageDiagnostics,
    panelPrefs?: PanelHintPreferences,
    options?: SettingsTabOptions,
): string {
    const surface = options?.surface ?? 'ide';
    const isAppSidecar = surface === 'app-sidecar' || surface === 'app';
    const baseSettings = options?.settings ? options.settings : readOptionalVsCodeSettings();
    const mergedRaw: Partial<MonitorDocumentSettings> = {
        ...baseSettings,
        ...(options?.appSettings ?? {}),
    };
    const resolved = normalizeMonitorDocumentSettings(mergedRaw);

    const {
        pollingInterval,
        showContext,
        showQuota,
        showResetCountdown,
        showAiCredits,
        showSpeed,
        showCacheHit,
        showSessionCost,
        tooltipDensity,
        showModelInternalId,
        quotaNotificationThreshold: quotaNotifyThreshold,
    } = resolved;
    const lockToMainAgent = !!resolved.lockToMainAgent;
    const appComposerRingEnabled = !!resolved.appComposerRingEnabled;
    const appTopBarEnabled = !!resolved.appTopBarEnabled;
    const showNativeHudBar = resolved.showNativeHudBar ?? isAppSidecar;
    const orchestratorPricingMode: OrchestratorPricingMode = resolved.orchestratorPricingMode === 'strict' ? 'strict' : 'mapped';
    const displayCurrency: DisplayCurrencyCode = resolved.displayCurrency ?? 'USD';
    const customFxRate = resolved.customFxRate ?? null;
    const subscriptionPlan: SubscriptionPlanPresetId = resolved.subscriptionPlan ?? 'none';
    const subscriptionMonthlyFee = resolved.subscriptionMonthlyFee ?? null;
    const subscriptionCurrency: DisplayCurrencyCode = resolved.subscriptionCurrency ?? 'USD';
    const calendarRetentionDays = resolved.calendarRetentionDays ?? 400;
    const autoCheckUpdates = resolved.autoCheckUpdates ?? true;
    const activityMaxRecentSteps = resolved.activityMaxRecentSteps ?? resolved.maxRecentSteps ?? 100;
    const activityMaxArchives = resolved.activityMaxArchives ?? resolved.maxArchives ?? 20;

    const resolvedZoom = clampNumber(options?.zoomLevel, 100, 60, 150);
    const currentVersion = (options?.version && options.version.trim()) || options?.updateStatus?.currentVersion || '1.17.6';
    const activePlatform = options?.cdpStatus?.platformGuide?.platform;

    const tabScrollHintEnabled = panelPrefs?.showTabScrollHint ?? true;
    const showScrollbar = panelPrefs?.showScrollbar ?? false;
    const showEndOfContent = panelPrefs?.showEndOfContent ?? true;
    const stateFileSizeLabel = storage ? formatFileSize(storage.stateFileSizeBytes) : '0 B';
    const ideOnlyDisabledAttr = isAppSidecar ? ' disabled aria-disabled="true"' : '';

    const storageCard = storage ? `
        <section class="stg-card" data-accent="storage">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.database}</span>
                <h2>${tBiHtml('Persistent Storage', '持久化存储')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'This file is shared between Antigravity IDE and Antigravity App outside the editor state database, so history survives uninstall and reinstall unless deleted manually.',
        '该文件在 Antigravity IDE 与 Antigravity App 之间共享，存储在扩展状态数据库之外，因此只要你不手动删除，历史数据会跨卸载或重装保留。',
    )}</p>
            <div class="storage-path-box">
                <code class="storage-path-text">${esc(storage.stateFilePath)}</code>
                <span class="storage-path-state ${storage.stateFileExists ? 'is-ready' : 'is-missing'}">
                    <span>${storage.stateFileExists ? tBiHtml('Ready', '已存在') : tBiHtml('Missing', '不存在')}</span>
                </span>
            </div>
            <div class="storage-actions">
                <button type="button" class="action-btn" id="copyStatePath">${ICON.copy} <span>${tBiHtml('Copy Path', '复制路径')}</span></button>
                ${isAppSidecar ? '' : `<button type="button" class="action-btn" id="openStateFile">${ICON.file} <span>${tBiHtml('Open File', '打开文件')}</span></button>`}
                <button type="button" class="action-btn" id="revealStateFile">${ICON.folder} <span>${tBiHtml('Reveal', '定位文件')}</span></button>
                <span id="statePathFeedback" class="threshold-feedback" role="status"></span>
            </div>
            <div class="storage-stat-grid">
                <div class="storage-stat"><span class="storage-stat-val">${stateFileSizeLabel}</span><span class="storage-stat-label">${tBiHtml('File Size', '文件大小')}</span></div>
                <div class="storage-stat"><span class="storage-stat-val">${storage.calendarDayCount}</span><span class="storage-stat-label">${tBiHtml('Calendar Days', '日历天数')}</span></div>
            </div>
        </section>` : '';

    // ── App Ambient Overlays (Opt-In CDP) & Native Panel Compact HUD Card ──
    const cdpPillHtml = buildCdpStatusPillHtml(options?.cdpStatus, appComposerRingEnabled, appTopBarEnabled);
    const cdpDiagnosticHintHtml = buildCdpDiagnosticHintHtml(options?.cdpStatus, appComposerRingEnabled, appTopBarEnabled);
    const appOverlaysCard = `
        <section class="stg-card" id="appOverlaysCard" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <h2>${tBiHtml('App Ambient Overlays (Opt-In CDP)', 'App 桌面悬浮组件（可选 CDP）')}</h2>
                ${cdpPillHtml}
            </div>
            <p class="raw-desc">${tBiHtml(
        'Native Panel Compact HUD renders immediately at the top of this monitor panel with zero CDP. The two desktop floating overlays below attach read-only Shadow DOM widgets inside Antigravity App when launched with --remote-debugging-port=0 — zero app.asar patching and 100% ToS-safe.',
        '「面板顶部紧凑 HUD」会直接渲染在本监控面板顶部，无需 CDP 即开即用；下方两项桌面悬浮组件需先以 --remote-debugging-port=0 启动 Antigravity App 才会在主窗口内以只读 Shadow DOM 渲染，零 app.asar 修改且 100% 合规。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleNativeHudBar" class="toggle-cb" data-app-setting="showNativeHudBar" data-feedback-id="appOverlaysFeedback" ${showNativeHudBar ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Native Panel Compact HUD (in-panel top bar, no CDP)', '面板顶部紧凑 HUD（本面板顶部常驻，无需 CDP）')}</span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleAppComposerRing" class="toggle-cb" data-app-setting="appComposerRingEnabled" data-feedback-id="appOverlaysFeedback" ${appComposerRingEnabled ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Composer Context Ring — Left of Turbo (CDP)', '对话框悬浮环（Turbo 左侧，需 CDP）')}</span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleAppTopBar" class="toggle-cb" data-app-setting="appTopBarEnabled" data-feedback-id="appOverlaysFeedback" ${appTopBarEnabled ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Top-Right Status Bar & Quota Board (CDP)', '右上角常驻状态栏与额度看板（需 CDP）')}</span>
                </label>
            </div>
            ${cdpDiagnosticHintHtml}
            <div class="storage-actions stg-cdp-actions">
                <button type="button" class="action-btn" id="cdpRecheckBtn" data-action="recheckCdp">${ICON.refresh} <span>${tBiHtml('Recheck CDP', '重新检测')}</span></button>
                <span id="appOverlaysFeedback" class="threshold-feedback" role="status"></span>
            </div>
            <details id="settings-cdp-guide" class="stg-guide-details" data-state-key="settings-cdp-guide">
                <summary>${tBiHtml('Cross-platform CDP launch guide (macOS / Windows / Linux)', '跨平台 CDP 启动指引（macOS / Windows / Linux）')}</summary>
                <div class="stg-guide-body">
                    <p>${tBiHtml(
        'Zero app.asar patching · 100% ToS-safe read-only observation.',
        '零 app.asar 篡改 · 100% 合规只读观测。',
    )}</p>
                    <p class="stg-guide-step">${tBiHtml(
        'Step 1 — Quit Antigravity App completely first (macOS: Cmd+Q; Windows/Linux: close all windows & tray icon). If Antigravity is still running, macOS "open -a" silently ignores --args.',
        '第一步 — 先完全退出 Antigravity App（macOS 按 Cmd+Q；Windows/Linux 关闭所有窗口及托盘图标）。若应用仍在运行，macOS 的 open -a 会直接忽略 --args 参数。',
    )}</p>
                    <p class="stg-guide-step">${tBiHtml(
        'Step 2 — Relaunch Antigravity App with --remote-debugging-port=0, then click Recheck CDP:',
        '第二步 — 使用 --remote-debugging-port=0 重新启动 Antigravity App，然后点击「重新检测」：',
    )}</p>
                    <div class="stg-code-list">
                        <div class="stg-code-item${activePlatform === 'darwin' ? ' is-current-platform' : ''}">
                            <strong>macOS (Terminal)</strong>
                            <code>open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0</code>
                        </div>
                        <div class="stg-code-item${activePlatform === 'win32' ? ' is-current-platform' : ''}">
                            <strong>Windows (PowerShell)</strong>
                            <code>&amp; "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0</code>
                        </div>
                        <div class="stg-code-item${activePlatform === 'win32' ? ' is-current-platform' : ''}">
                            <strong>Windows (CMD / Shortcut)</strong>
                            <code>"%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0</code>
                        </div>
                        <div class="stg-code-item${activePlatform === 'linux' ? ' is-current-platform' : ''}">
                            <strong>Linux</strong>
                            <code>antigravity --remote-debugging-port=0</code>
                        </div>
                    </div>
                    <p class="stg-guide-note">${tBiHtml(
        'Note: Antigravity auto-updates restart the app without CLI flags. After an update, quit completely and relaunch with --remote-debugging-port=0 (or use a persistent launcher/shortcut), then click Recheck CDP.',
        '提示：Antigravity 自动更新重启后会丢弃启动参数。更新后请完全退出并重新以 --remote-debugging-port=0 启动（或使用持久化快捷方式），再点击「重新检测」。',
    )}</p>
                </div>
            </details>
        </section>`;

    // ── Updates & Release Checks Card ──
    const updateInfo = buildUpdateStatusPillHtml(currentVersion, options?.updateStatus);
    const updatesCard = `
        <section class="stg-card" id="updatesSettingsCard" data-accent="storage">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.refresh}</span>
                <h2>${tBiHtml('Updates & Release Checks', '版本更新与检查')}</h2>
                ${updateInfo.pillHtml}
            </div>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleAutoCheckUpdates" class="toggle-cb" data-app-setting="autoCheckUpdates" data-feedback-id="updatesFeedback" ${autoCheckUpdates ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Automatically check GitHub Releases for new versions', '自动检查 GitHub Releases 新版本')}</span>
                </label>
            </div>
            <div class="storage-actions">
                <button type="button" class="action-btn" id="settingsCheckUpdatesBtn" data-action="checkForUpdates">${ICON.refresh} <span>${tBiHtml('Check for Updates', '检查更新')}</span></button>
                ${isAppSidecar && updateInfo.updateAvailable
            ? `<button type="button" class="action-btn stg-btn-primary" id="settingsUpgradeNowBtn" data-action="applyPluginUpdate"><span>${tBiHtml('Upgrade Now', '立即升级')}</span></button>`
            : ''}
                <span id="updatesFeedback" class="threshold-feedback" role="status"></span>
            </div>
            ${isAppSidecar
            ? ''
            : `<p class="stg-hint-note">${tBiHtml(
                'Antigravity IDE extensions update automatically via Open VSX, or you can install the latest VSIX from GitHub Releases.',
                'Antigravity IDE 扩展会通过 Open VSX 自动更新，也可从 GitHub Releases 手动安装最新 VSIX。',
            )}</p>`}
        </section>`;

    // ── Cost, Currency & History Card ──
    const currencyOptionsHtml = CURRENCY_CODES.map((code) => {
        const preset = CURRENCY_PRESETS[code];
        const label = `${code} — ${tBi(preset.nameEn, preset.nameZh)}`;
        return `<option value="${code}"${displayCurrency === code ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    const subCurrencyOptionsHtml = CURRENCY_CODES.map((code) => {
        const preset = CURRENCY_PRESETS[code];
        const label = `${code} — ${tBi(preset.nameEn, preset.nameZh)}`;
        return `<option value="${code}"${subscriptionCurrency === code ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    const planOptionsHtml = (['none', 'google-ai-pro', 'google-ai-ultra', 'custom'] as const).map((planId) => {
        const preset = SUBSCRIPTION_PLAN_PRESETS[planId];
        const feeHint = preset.monthlyUsd > 0 ? ` ($${preset.monthlyUsd}/mo)` : '';
        const label = `${tBi(preset.labelEn, preset.labelZh)}${feeHint}`;
        return `<option value="${planId}"${subscriptionPlan === planId ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    const defaultFxPlaceholder = String(CURRENCY_PRESETS[displayCurrency]?.defaultRatePerUsd ?? 1);

    const costCurrencyHistoryCard = `
        <section class="stg-card" id="costCurrencyHistoryCard" data-accent="history">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Cost, Currency & History', '费用、货币与历史')}</h2>
            </div>
            <div class="setting-row">
                <label>${tBiHtml('Orchestrator pricing mode', '编排模型计费模式')}</label>
                <p class="raw-desc">${tBiHtml(
        'Mapped Base estimates legacy fixed Orchestrator IDs (M537/M667/M681/M669) using their base model official rate; Strict mode marks them Unpriced until custom rates are entered.',
        '按底座估算会使用对应底座模型的官方单价估算旧版固定编排模型（M537/M667/M681/M669）；严格模式在填写自定义价格前将其标记为未定价。',
    )}</p>
                <div class="stg-seg-group" role="radiogroup" aria-label="${esc(tBi('Orchestrator pricing mode', '编排模型计费模式'))}">
                    <button type="button" class="stg-seg-btn${orchestratorPricingMode === 'mapped' ? ' is-active' : ''}" id="stgOrchModeMapped" data-action="setOrchestratorPricingMode" data-mode="mapped" role="radio" aria-checked="${orchestratorPricingMode === 'mapped' ? 'true' : 'false'}">${tBiHtml('Mapped Base', '按底座估算')}</button>
                    <button type="button" class="stg-seg-btn${orchestratorPricingMode === 'strict' ? ' is-active' : ''}" id="stgOrchModeStrict" data-action="setOrchestratorPricingMode" data-mode="strict" role="radio" aria-checked="${orchestratorPricingMode === 'strict' ? 'true' : 'false'}">${tBiHtml('Strict', '严格模式')}</button>
                </div>
                <span id="orchPricingModeFeedback" class="threshold-feedback" role="status"></span>
            </div>

            <div class="stg-divider"></div>

            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="displayCurrencySelect">${tBiHtml('Display currency', '显示货币')}</label>
                    <select id="displayCurrencySelect" data-app-setting="displayCurrency" data-feedback-id="customFxRateFeedback">
                        ${currencyOptionsHtml}
                    </select>
                </div>
                <div class="stg-field">
                    <label for="customFxRateInput">${tBiHtml('Custom FX rate (per 1 USD)', '自定义汇率（每 1 USD）')}</label>
                    <input type="number" id="customFxRateInput" class="threshold-input"
                           data-app-setting="customFxRate" data-setting-type="nullable-float" data-feedback-id="customFxRateFeedback"
                           min="0.0001" max="1000000" step="0.01"
                           value="${customFxRate !== null ? esc(String(customFxRate)) : ''}"
                           placeholder="${esc(defaultFxPlaceholder)}" />
                    <span id="customFxRateFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>

            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="subscriptionPlanSelect">${tBiHtml('Subscription plan (ROI)', '订阅方案（ROI 参考）')}</label>
                    <select id="subscriptionPlanSelect" data-app-setting="subscriptionPlan" data-feedback-id="subscriptionFeedback">
                        ${planOptionsHtml}
                    </select>
                </div>
                <div class="stg-field">
                    <label for="subscriptionFeeInput">${tBiHtml('Monthly fee', '月费金额')}</label>
                    <input type="number" id="subscriptionFeeInput" class="threshold-input"
                           data-app-setting="subscriptionMonthlyFee" data-setting-type="nullable-float" data-feedback-id="subscriptionFeedback"
                           min="0" max="100000" step="0.01"
                           value="${subscriptionMonthlyFee !== null ? esc(String(subscriptionMonthlyFee)) : ''}"
                           placeholder="${esc(subscriptionPlan === 'google-ai-ultra' ? '249.99' : '19.99')}" />
                </div>
                <div class="stg-field">
                    <label for="subscriptionCurrencySelect">${tBiHtml('Fee currency', '月费币种')}</label>
                    <select id="subscriptionCurrencySelect" data-app-setting="subscriptionCurrency" data-feedback-id="subscriptionFeedback">
                        ${subCurrencyOptionsHtml}
                    </select>
                    <span id="subscriptionFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
            <p class="stg-hint-note">${tBiHtml(ROI_DISCLAIMER_EN, ROI_DISCLAIMER_ZH)}</p>

            <div class="stg-divider"></div>

            <div class="setting-row">
                <label for="calendarRetentionInput">${tBiHtml('Calendar retention (days)', '日历历史保留天数')}</label>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" data-target="calendarRetentionInput" aria-label="${esc(tBi('Decrease calendar retention days', '减少日历保留天数'))}">−</button>
                        <input type="number" id="calendarRetentionInput" class="threshold-input"
                               data-app-setting="calendarRetentionDays" data-setting-type="int" data-feedback-id="calendarRetentionFeedback"
                               value="${calendarRetentionDays}" min="30" max="3650" step="30" />
                        <button type="button" class="num-spinner-btn increment" data-target="calendarRetentionInput" aria-label="${esc(tBi('Increase calendar retention days', '增加日历保留天数'))}">+</button>
                    </div>
                    <button type="button" class="action-btn" id="calendarRetentionSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="calendarRetentionFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>

            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="activityMaxRecentStepsInput">${tBiHtml('Max recent activity steps', '最近活动步骤上限')}</label>
                    <div class="threshold-input-row">
                        <div class="num-spinner">
                            <button type="button" class="num-spinner-btn decrement" data-target="activityMaxRecentStepsInput" aria-label="${esc(tBi('Decrease max recent activity steps', '减小最近活动步骤上限'))}">−</button>
                            <input type="number" id="activityMaxRecentStepsInput" class="threshold-input"
                                   data-app-setting="activityMaxRecentSteps" data-setting-type="int" data-feedback-id="activityMaxRecentStepsFeedback"
                                   value="${activityMaxRecentSteps}" min="10" max="500" step="10" />
                            <button type="button" class="num-spinner-btn increment" data-target="activityMaxRecentStepsInput" aria-label="${esc(tBi('Increase max recent activity steps', '增大最近活动步骤上限'))}">+</button>
                        </div>
                        <span id="activityMaxRecentStepsFeedback" class="threshold-feedback" role="status"></span>
                    </div>
                </div>
                <div class="stg-field">
                    <label for="activityMaxArchivesInput">${tBiHtml('Max archived activity sessions', '活动归档会话上限')}</label>
                    <div class="threshold-input-row">
                        <div class="num-spinner">
                            <button type="button" class="num-spinner-btn decrement" data-target="activityMaxArchivesInput" aria-label="${esc(tBi('Decrease max archived activity sessions', '减小活动归档会话上限'))}">−</button>
                            <input type="number" id="activityMaxArchivesInput" class="threshold-input"
                                   data-app-setting="activityMaxArchives" data-setting-type="int" data-feedback-id="activityMaxArchivesFeedback"
                                   value="${activityMaxArchives}" min="1" max="100" step="5" />
                            <button type="button" class="num-spinner-btn increment" data-target="activityMaxArchivesInput" aria-label="${esc(tBi('Increase max archived activity sessions', '增大活动归档会话上限'))}">+</button>
                        </div>
                        <span id="activityMaxArchivesFeedback" class="threshold-feedback" role="status"></span>
                    </div>
                </div>
            </div>
        </section>`;

    const statusBarTitleHtml = isAppSidecar
        ? tBiHtml('Antigravity IDE Status Bar', 'Antigravity IDE 状态栏')
        : tBiHtml('Status Bar Display', '状态栏显示');
    const statusBarDescHtml = isAppSidecar
        ? tBiHtml(
            'These status bar toggles apply to the Antigravity IDE extension. In Antigravity App, use App Ambient Overlays above or view telemetry in the side pane.',
            '以下状态栏开关仅对 Antigravity IDE 扩展生效。在 Antigravity App 中，请使用上方的 App 桌面悬浮组件或在辅助面板中查看。',
        )
        : tBiHtml(
            'Toggle which elements appear in the status bar.',
            '控制状态栏显示哪些元素。',
        );

    const zoomPresetButtons = [80, 90, 100, 110, 120, 130]
        .map(pct => `<button type="button" class="preset-btn zoom-preset${resolvedZoom === pct ? ' is-active' : ''}" data-zoom="${pct}">${pct}%</button>`)
        .join('\n                    ');

    return `
        ${storageCard}

        ${appOverlaysCard}

        ${updatesCard}

        ${costCurrencyHistoryCard}

        <section class="stg-card" data-accent="quota">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <h2>${tBiHtml('Quota Notification', '配额通知')}</h2>
            </div>
            <div class="setting-row">
                <label for="quotaNotifyInput">${tBiHtml(
        'Low quota warning threshold (%)',
        '低配额警告阈值（%）',
    )}</label>
                <p class="raw-desc">${tBiHtml(
        'Show a warning banner (App & IDE) and system notification (IDE) when any quota pool drops to or below this percentage. Set to 0 to disable.',
        '当任何配额池剩余比例降至或低于此百分比时，在面板顶部显示警告横幅（App 与 IDE 均生效）并在 IDE 弹出通知。设为 0 可禁用。',
    )}</p>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" aria-label="${esc(tBi('Decrease quota warning threshold', '降低配额警告阈值'))}">−</button>
                        <input type="number" id="quotaNotifyInput" class="threshold-input"
                               value="${quotaNotifyThreshold}" min="0" max="99" step="5" />
                        <button type="button" class="num-spinner-btn increment" aria-label="${esc(tBi('Increase quota warning threshold', '提高配额警告阈值'))}">+</button>
                    </div>
                    <button type="button" class="action-btn" id="quotaNotifySaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="quotaNotifyFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="poll">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.clock}</span>
                <h2>${tBiHtml('Polling', '轮询')}</h2>
            </div>
            <div class="setting-row">
                <label for="pollingInput">${tBiHtml(
        'Polling interval (seconds)',
        '轮询间隔（秒）',
    )}</label>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" data-target="pollingInput" aria-label="${esc(tBi('Decrease polling interval', '减小轮询间隔'))}">−</button>
                        <input type="number" id="pollingInput" class="threshold-input"
                               value="${pollingInterval}" min="1" max="60" step="1" />
                        <button type="button" class="num-spinner-btn increment" data-target="pollingInput" aria-label="${esc(tBi('Increase polling interval', '增大轮询间隔'))}">+</button>
                    </div>
                    <button type="button" class="action-btn" id="pollingSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="pollingFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
        </section>

        <section class="stg-card${isAppSidecar ? ' is-ide-only' : ''}" data-accent="display" data-surface-scope="ide-only">
            <details id="settings-ide-status-bar" class="stg-card-details" data-state-key="settings-ide-status-bar"${isAppSidecar ? '' : ' open'}>
                <summary class="stg-header stg-card-summary">
                    <span class="stg-header-icon">${ICON.chart}</span>
                    <h2>${statusBarTitleHtml}</h2>
                    ${isAppSidecar ? `<span class="stg-ide-only-badge">${tBiHtml('IDE Only', '仅 IDE')}</span>` : ''}
                </summary>
                <div class="stg-card-details-body">
                    <p class="raw-desc">${statusBarDescHtml}</p>
                    <div class="toggle-group">
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleContext" class="toggle-cb" ${showContext ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('Context usage', '上下文用量')} <code>45k/1M</code></span>
                        </label>
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleQuota" class="toggle-cb" ${showQuota ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('Quota remaining', '剩余配额')} <code>85%</code></span>
                        </label>
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleCountdown" class="toggle-cb" ${showResetCountdown ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('Reset countdown', '重置倒计时')} <code>4h32m</code></span>
                        </label>
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleAiCredits" class="toggle-cb" ${showAiCredits ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('AI Credits balance', 'AI 积分余额')} <code>14,701</code></span>
                        </label>
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleSpeed" class="toggle-cb" ${showSpeed ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('Generation speed', '生成速度')} <code>64 tok/s</code></span>
                        </label>
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleCacheHit" class="toggle-cb" ${showCacheHit ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('Prompt cache hit rate', '提示词缓存命中率')} <code>Cache 84%</code></span>
                        </label>
                        <label class="toggle-row">
                            <input type="checkbox" id="toggleSessionCost" class="toggle-cb" ${showSessionCost ? 'checked' : ''}${ideOnlyDisabledAttr} />
                            <span class="toggle-track"><span class="toggle-thumb"></span></span>
                            <span>${tBiHtml('Session cost', '当前会话费用')} <code>$0.27</code></span>
                        </label>
                    </div>
                    <label class="stg-select-row" for="statusTooltipDensity">
                        <span>${tBiHtml('Hover density', '悬停摘要密度')}</span>
                        <select id="statusTooltipDensity"${ideOnlyDisabledAttr}>
                            <option value="auto"${tooltipDensity === 'auto' ? ' selected' : ''}>${esc(tBi('Automatic', '自动'))}</option>
                            <option value="compact"${tooltipDensity === 'compact' ? ' selected' : ''}>${esc(tBi('Compact', '精简'))}</option>
                            <option value="full"${tooltipDensity === 'full' ? ' selected' : ''}>${esc(tBi('Full', '完整'))}</option>
                        </select>
                    </label>
                </div>
            </details>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Advanced Display', '高级显示')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Control diagnostic visibility and conversation focus behavior across Antigravity IDE and App.',
        '控制诊断信息展示及跨 Antigravity IDE 与 App 的会话跟踪行为。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleLockMainAgent" class="toggle-cb" ${lockToMainAgent ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Lock to Main Agent (ignore background subagents)', '锁定主会话（忽略后台子智能体）')}</span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleModelInternalId" class="toggle-cb" ${showModelInternalId ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Show model internal ID', '显示模型内部 ID')} <code>(M16)</code></span>
                </label>
            </div>
        </section>

        <section class="stg-card" data-accent="zoom">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.zoom}</span>
                <h2>${tBiHtml('Interface Zoom', '界面缩放')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Scale all content in the panel. Applies to text, icons, and spacing.',
        '缩放面板中的所有内容。对文字、图标和间距统一生效。',
    )}</p>
            <div class="zoom-control">
                <div class="zoom-presets">
                    ${zoomPresetButtons}
                </div>
                <div class="zoom-slider-row">
                    <input type="range" id="zoomRange" class="zoom-range" aria-label="${esc(tBi('Interface zoom', '界面缩放'))}"
                           min="60" max="150" step="5" value="${resolvedZoom}" />
                    <span class="zoom-value" id="zoomValue">${resolvedZoom}%</span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="history">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.timeline}</span>
                <h2>${tBiHtml('Panel Tips', '界面提示')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'This state only means whether auto-display is enabled. It does not mean the hint is currently visible at the top. Use the button below to show it immediately once.',
        '这里的状态只表示“是否启用自动提示”，不代表顶部当前一定可见。要立刻看到这条提示，请用下面的按钮显示一次。',
    )}</p>
            <div class="storage-actions">
                <button type="button" class="action-btn" id="restoreTabScrollHint">${ICON.refresh} <span>${tBiHtml('Show Hint Now', '立即显示一次提示')}</span></button>
                <span class="storage-path-state ${tabScrollHintEnabled ? 'is-ready' : 'is-missing'}" id="tabHintState">
                    <span>${tabScrollHintEnabled ? tBiHtml('Auto Hint Enabled', '自动提示已开启') : tBiHtml('Auto Hint Disabled', '自动提示已关闭')}</span>
                </span>
                <span id="panelHintFeedback" class="threshold-feedback" role="status"></span>
            </div>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Scrollbar Appearance', '滚动条外观')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Control scrollbar visibility and end-of-content indicators across all tabs.',
        '控制所有选项卡的滚动条可见性和「已到底」提示。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleScrollbar" class="toggle-cb" ${showScrollbar ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Show scrollbar', '显示滚动条')}</span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleEndOfContent" class="toggle-cb" ${showEndOfContent ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Show "end of content" indicator', '显示「已到底」提示')}</span>
                </label>
            </div>
        </section>
    `;
}

// ─── Settings Tab Content Builder ────────────────────────────────────────────
// Builds HTML for the "Settings" tab: storage diagnostics, Antigravity global
// rules (`~/.gemini/GEMINI.md`) inline editor, App Ambient Overlays
// (Opt-In CDP), Updates & Release Checks, Cost/Currency/History, quota threshold,
// polling, collapsible IDE status bar toggles, advanced display, zoom, and panel prefs.
//
// Pure Node/TypeScript safe: ZERO top-level `vscode` import so Antigravity App
// Sidecar and pure Node tests can render Settings without VS Code.

import { tBi } from './i18n-core';
import type { ModelConfig } from './models';
import { parseTooltipDensity } from './tooltip-budget';
import {
    GLOBAL_RULES_MAX_BYTES,
    readGlobalRulesStatus,
    type GlobalRulesStatus,
} from './global-rules';
import {
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    normalizeSubscriptionPlanId,
    ROI_DISCLAIMER_EN,
    ROI_DISCLAIMER_ZH,
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    SUBSCRIPTION_PLAN_PRESETS,
    type SubscriptionPlanPresetId,
} from './cli-usage-scanner';
import {
    SUPPORTED_DISPLAY_CURRENCIES,
    type AppSettings,
    type DisplayCurrencyCode,
    type OrchestratorPricingMode,
} from './durable-state';
import type { CdpDiagnosticCode, CdpLauncherStatus, CdpStatus } from './app/sidecar-types';
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
    /** Global rules file snapshot; computed lazily via `readGlobalRulesStatus()` when omitted. Pass `null` to hide the card. */
    globalRules?: GlobalRulesStatus | null;
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
    return normalizeSubscriptionPlanId(rawPlan, monthlyFee);
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
    if (state === 'probing') { return 'probing'; }
    if (state === 'error') { return 'ws_error'; }
    if (state === 'cdp_unavailable') { return 'missing_port_file'; }
    return 'disabled';
}

function stgRichTipAttrs(
    key: string,
    titleEn: string,
    titleZh: string,
    bodyEn: string,
    bodyZh: string,
    metaEn?: string,
    metaZh?: string,
): string {
    const title = tBi(titleEn, titleZh);
    const body = tBi(bodyEn, bodyZh);
    const meta = metaEn || metaZh ? tBi(metaEn || '', metaZh || '') : '';
    return ` data-popover-key="${esc(key)}" data-tip-title="${esc(title)}" data-tip-body="${esc(body)}"${meta ? ` data-tip-meta="${esc(meta)}"` : ''}`;
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
        const portPart = typeof cdpStatus?.discoveredPort === 'number' ? `:${cdpStatus.discoveredPort}` : '';
        const targetInfo = cdpStatus?.targetTitle
            ? `${cdpStatus.targetTitle}${portPart ? ` (${portPart})` : ''}`
            : (portPart ? `CDP ${portPart}` : 'Antigravity Hub');
        const tip = stgRichTipAttrs(
            'settings-cdp-status-pill',
            'CDP Overlay Connected',
            'CDP 悬浮层已连接',
            `Connected to Antigravity window: ${targetInfo}.`,
            `已连接到 Antigravity 主窗口：${targetInfo}。`,
            'Read-only desktop overlay connection active.',
            '只读桌面悬浮层连接正常。',
        );
        return `<span class="stg-status-pill is-connected" id="cdpStatusPill" data-cdp-state="connected" data-cdp-diagnostic="${esc(diagCode)}"${tip}>${tBiHtml('Connected', '已连接')}</span>`;
    }
    if (state === 'probing') {
        const probingTip = stgRichTipAttrs(
            'settings-cdp-status-pill',
            'Checking CDP Connection',
            '正在检测 CDP 连接',
            'Checking whether Antigravity App is currently running with its local Chrome debugging port enabled.',
            '正在检测当前运行的 Antigravity App 是否已开启本地浏览器调试端口（CDP）。',
            'This usually finishes in under a second.',
            '检测通常在 1 秒内完成。',
        );
        return `<span class="stg-status-pill" id="cdpStatusPill" data-cdp-state="probing" data-cdp-diagnostic="probing"${probingTip}>${tBiHtml('Checking…', '检测中…')}</span>`;
    }
    if (state === 'error') {
        const errBody = cdpStatus?.errorMessage?.trim()
            || tBi('Unable to connect to the Antigravity CDP debugging session.', '无法连接到 Antigravity 的 CDP 调试会话。');
        const tip = ` data-popover-key="settings-cdp-status-pill" data-tip-title="${esc(tBi('CDP Connection Error', 'CDP 连接异常'))}" data-tip-body="${esc(errBody)}" data-tip-meta="${esc(tBi(`Diagnostic code: ${diagCode} · Click Recheck CDP after relaunching.`, `诊断码：${diagCode} · 请重启后点击「重新检测」。`))}"`;
        return `<span class="stg-status-pill is-error" id="cdpStatusPill" data-cdp-state="error" data-cdp-diagnostic="${esc(diagCode)}"${tip}>${tBiHtml('CDP Error', 'CDP 异常')}</span>`;
    }
    if (state === 'cdp_unavailable') {
        const tip = stgRichTipAttrs(
            'settings-cdp-status-pill',
            'CDP Not Ready Yet',
            'CDP 尚未就绪',
            'Antigravity App is running without its Chrome debugging port enabled, so desktop floating overlays cannot attach yet.',
            '当前运行的 Antigravity App 未开启浏览器调试端口（CDP），桌面悬浮层暂无法挂载。',
            `Diagnostic code: ${diagCode} · Launch via "Antigravity (CDP)" then click Recheck CDP.`,
            `诊断码：${diagCode} · 请从「Antigravity (CDP)」启动后点击「重新检测」。`,
        );
        return `<span class="stg-status-pill is-inactive" id="cdpStatusPill" data-cdp-state="cdp_unavailable" data-cdp-diagnostic="${esc(diagCode)}"${tip}>${tBiHtml('CDP Inactive', 'CDP 未就绪')}</span>`;
    }
    const disabledTip = stgRichTipAttrs(
        'settings-cdp-status-pill',
        'Desktop Overlays Disabled',
        '桌面悬浮层未启用',
        'Both optional CDP desktop overlays are currently turned off. The in-panel Compact HUD works without CDP.',
        '下方两项可选 CDP 桌面悬浮层当前均为关闭状态；面板顶部紧凑 HUD 无需 CDP 即可使用。',
        'Toggle either CDP overlay on to enable connection checks.',
        '开启任一 CDP 悬浮开关后将自动检测连接状态。',
    );
    return `<span class="stg-status-pill is-disabled" id="cdpStatusPill" data-cdp-state="disabled" data-cdp-diagnostic="disabled"${disabledTip}>${tBiHtml('Disabled', '未启用')}</span>`;
}

function getRevealLauncherLabel(platform?: string): { en: string; zh: string } {
    if (platform === 'win32') {
        return { en: 'Show in Explorer', zh: '在资源管理器中显示' };
    }
    if (platform === 'linux') {
        return { en: 'Open Folder', zh: '打开所在目录' };
    }
    return { en: 'Reveal in Finder', zh: '在访达中显示' };
}

function buildCdpDiagnosticHintHtml(
    cdpStatus: CdpStatus | null | undefined,
    composerEnabled: boolean,
    topBarEnabled: boolean,
    activePlatform?: string,
): string {
    const anyEnabled = composerEnabled || topBarEnabled;
    const state = cdpStatus?.state ?? (anyEnabled ? 'cdp_unavailable' : 'disabled');
    const diagCode = resolveCdpDiagnosticCode(cdpStatus, composerEnabled, topBarEnabled);
    if (state === 'disabled' || diagCode === 'disabled') {
        return `<div class="stg-diagnostic-hint" id="cdpDiagnosticHint" data-cdp-diagnostic="disabled" role="status" hidden></div>`;
    }
    if (state === 'probing' || diagCode === 'probing') {
        return `<div class="stg-diagnostic-hint" id="cdpDiagnosticHint" data-cdp-diagnostic="probing" role="status">${tBiHtml(
            'Checking Antigravity App CDP connection…',
            '正在检测 Antigravity App 的 CDP 连接状态…',
        )}</div>`;
    }
    const portSuffixEn = typeof cdpStatus?.discoveredPort === 'number' ? ` (port ${cdpStatus.discoveredPort})` : '';
    const portSuffixZh = typeof cdpStatus?.discoveredPort === 'number' ? `（端口 ${cdpStatus.discoveredPort}）` : '';
    const titleSuffix = cdpStatus?.targetTitle ? ` — ${cdpStatus.targetTitle}` : '';
    const errSuffixEn = cdpStatus?.errorMessage ? `: ${cdpStatus.errorMessage}` : '';
    const errSuffixZh = cdpStatus?.errorMessage ? `：${cdpStatus.errorMessage}` : '';
    const launcherInstalled = Boolean(cdpStatus?.launcherStatus?.installed);
    const resolvedPlatform = cdpStatus?.launcherStatus?.platform || activePlatform || cdpStatus?.platformGuide?.platform || 'darwin';

    const buildInstalledLauncherHint = (prefixEn: string, prefixZh: string): string => {
        if (resolvedPlatform === 'win32') {
            return tBiHtml(
                `${prefixEn}Persistent launcher is ready, but this session was opened from the original Antigravity app (without --remote-debugging-port=0). Launch from the direct "Antigravity (CDP)" shortcut instead (you can right-click it to Pin to Taskbar, or click "Show in Explorer" below), then click Recheck CDP.`,
                `${prefixZh}持久化启动器已就绪，但本次打开的是原版 Antigravity（未启用 --remote-debugging-port=0）。请改从「Antigravity (CDP)」直连快捷方式启动（支持原生「固定到任务栏」，可点击下方「在资源管理器中显示」定位），启动后点击「重新检测」。`,
            );
        }
        if (resolvedPlatform === 'linux') {
            return tBiHtml(
                `${prefixEn}Persistent launcher is ready, but this session was opened from the original Antigravity app (without --remote-debugging-port=0). Launch from the "Antigravity (CDP)" app launcher entry (pin that launcher entry to Ubuntu Dock — avoid pinning an already-running non-CDP window; click "Open Folder" below to locate it), then click Recheck CDP.`,
                `${prefixZh}持久化启动器已就绪，但本次打开的是原版 Antigravity（未启用 --remote-debugging-port=0）。请改从应用菜单中的「Antigravity (CDP)」启动（建议从应用启动器直接固定到 Ubuntu Dock，避免固定无参运行中的窗口；可点击下方「打开所在目录」定位），启动后点击「重新检测」。`,
            );
        }
        return tBiHtml(
            `${prefixEn}Persistent launcher is ready, but this session was opened from the original Antigravity app (without --remote-debugging-port=0). Launch from "Antigravity (CDP)" instead (click "Reveal in Finder" below and drag it from Finder into your Dock — NEVER right-click the running icon to choose "Keep in Dock"), then click Recheck CDP.`,
            `${prefixZh}持久化启动器已就绪，但本次打开的是原版 Antigravity（未启用 --remote-debugging-port=0）。请改从「Antigravity (CDP)」启动（点击下方「在访达中显示」并从访达拖入程序坞——切勿右键运行中图标选「在程序坞中保留」），启动后点击「重新检测」。`,
        );
    };

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
        case 'host_missing_flag':
            toneClass = 'is-warn';
            messageHtml = launcherInstalled
                ? buildInstalledLauncherHint('', '')
                : tBiHtml(
                    'Antigravity App is running without --remote-debugging-port=0 (e.g. opened from the original icon, auto-updated, or relaunched during the ~5s shutdown after Cmd+Q). Step 1: click "Create Persistent Launcher" below to create a separate launcher. Step 2: launch from the new "Antigravity (CDP)" icon instead (the original Antigravity icon is never modified), then click Recheck CDP.',
                    '当前运行的 Antigravity App 未启用 --remote-debugging-port=0（例如从原版图标启动、自动更新重启，或按 Cmd+Q 后约 5 秒后台清理尚未完成）。步骤 1：点击下方「一键生成持久化启动器」创建独立启动器；步骤 2：之后改从新建的「Antigravity (CDP)」图标启动（原版 Antigravity 图标不会被修改），启动后点击「重新检测」。',
                );
            break;
        case 'missing_port_file':
        default:
            toneClass = 'is-warn';
            messageHtml = launcherInstalled
                ? buildInstalledLauncherHint('DevToolsActivePort not found — ', '未检测到 DevToolsActivePort —— ')
                : tBiHtml(
                    'DevToolsActivePort not found — Antigravity App is running without --remote-debugging-port=0 (or was relaunched during the ~5s shutdown after Cmd+Q). Step 1: click "Create Persistent Launcher" below to create a separate launcher. Step 2: launch from the new "Antigravity (CDP)" icon instead (the original Antigravity icon is never modified), then click Recheck CDP.',
                    '未检测到 DevToolsActivePort —— 当前运行的 Antigravity App 未启用 --remote-debugging-port=0（或按 Cmd+Q 后约 5 秒后台清理尚未完成）。步骤 1：点击下方「一键生成持久化启动器」创建独立启动器；步骤 2：之后改从新建的「Antigravity (CDP)」图标启动（原版 Antigravity 图标不会被修改），启动后点击「重新检测」。',
                );
            break;
    }
    return `<div class="stg-diagnostic-hint ${toneClass}" id="cdpDiagnosticHint" data-cdp-diagnostic="${esc(diagCode)}" role="status">${messageHtml}</div>`;
}

function getDefaultLauncherDisplayPath(platform?: string): string {
    if (platform === 'win32') { return '%USERPROFILE%\\Desktop\\Antigravity (CDP).lnk'; }
    if (platform === 'linux') { return '~/.local/share/applications/antigravity-cdp.desktop'; }
    return '/Applications/Antigravity (CDP).app';
}

function getDefaultLauncherNote(platform?: string): { en: string; zh: string } {
    if (platform === 'win32') {
        return {
            en: 'Zero-patch direct .lnk shortcut (survives auto-updates, no CMD flash). Right-click the shortcut to Pin to Taskbar natively.',
            zh: '零魔改直连 .lnk 快捷方式（跨自动更新生效，无黑框闪烁），支持右键原生「固定到任务栏」。',
        };
    }
    if (platform === 'linux') {
        return {
            en: 'Zero-patch desktop launcher (survives auto-updates). Pin "Antigravity (CDP)" from your app menu to Ubuntu Dock — avoid pinning an argless running window.',
            zh: '零魔改桌面入口（跨自动更新生效）。请从应用启动器将「Antigravity (CDP)」固定到 Ubuntu Dock，避免固定无参运行中的窗口。',
        };
    }
    return {
        en: 'Zero-patch launcher saved to /Applications (or ~/Applications if read-only) — survives auto-updates and waits cleanly through macOS\'s ~5s shutdown after Cmd+Q. Drag it from Finder into your Dock; NEVER right-click the running icon to choose "Keep in Dock".',
        zh: '零魔改启动器优先写入 /Applications（无写权限时回退 ~/Applications），跨自动更新持久生效并自动等待 Cmd+Q 后约 5 秒清理。请从访达拖入程序坞，切勿右键运行中图标选「在程序坞中保留」。',
    };
}

function buildCdpLauncherRowHtml(
    launcherStatus: CdpLauncherStatus | null | undefined,
    activePlatform?: string,
): string {
    const installed = Boolean(launcherStatus?.installed);
    const resolvedPlatform = launcherStatus?.platform || activePlatform || 'darwin';
    const displayPath = launcherStatus?.launcherPath?.trim()
        || getDefaultLauncherDisplayPath(resolvedPlatform);
    const statusBadgeHtml = installed
        ? `<span class="stg-cdp-launcher-badge is-installed">${tBiHtml('Installed', '已创建')}</span>`
        : `<span class="stg-cdp-launcher-badge">${tBiHtml('Not created', '未创建')}</span>`;
    const setupLabelHtml = installed
        ? tBiHtml('Recreate Launcher', '重新生成启动器')
        : tBiHtml('Create Persistent Launcher', '一键生成持久化启动器');
    const revealLabel = getRevealLauncherLabel(resolvedPlatform);
    const revealLabelHtml = tBiHtml(revealLabel.en, revealLabel.zh);
    const defaultNote = getDefaultLauncherNote(resolvedPlatform);
    const noteHtml = launcherStatus?.noteEn && launcherStatus?.noteZh
        ? tBiHtml(launcherStatus.noteEn, launcherStatus.noteZh)
        : tBiHtml(defaultNote.en, defaultNote.zh);
    return `
            <div class="stg-cdp-launcher-box" id="cdpLauncherBox">
                <div class="stg-cdp-launcher-head">
                    <span class="stg-cdp-launcher-title">${tBiHtml('Persistent CDP Launcher (Zero-Patch)', '持久化 CDP 启动器（零魔改）')}</span>
                    <span class="stg-cdp-launcher-status" id="cdpLauncherStatus" data-launcher-installed="${installed ? 'true' : 'false'}" data-launcher-platform="${esc(resolvedPlatform)}" data-launcher-path="${esc(displayPath)}">${statusBadgeHtml}<code class="stg-cdp-launcher-path">${esc(displayPath)}</code></span>
                </div>
                <p class="stg-cdp-launcher-note" id="cdpLauncherNote">${noteHtml}</p>
                <div class="storage-actions stg-cdp-launcher-actions">
                    <button type="button" class="action-btn${installed ? '' : ' stg-btn-primary'}" id="cdpSetupLauncherBtn" data-action="setupCdpLauncher"><span>${setupLabelHtml}</span></button>
                    <button type="button" class="action-btn${installed ? ' stg-btn-primary' : ''}" id="cdpRevealLauncherBtn" data-action="revealCdpLauncher" data-launcher-platform="${esc(resolvedPlatform)}"${installed ? '' : ' hidden'}>${ICON.folder} <span>${revealLabelHtml}</span></button>
                    <button type="button" class="action-btn" id="cdpRemoveLauncherBtn" data-action="removeCdpLauncher"${installed ? '' : ' hidden'}><span>${tBiHtml('Remove Launcher', '移除启动器')}</span></button>
                    <span id="cdpLauncherFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>`;
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
        const tip = stgRichTipAttrs(
            'settings-update-status-pill',
            `Update Available (${latestTag})`,
            `有可用更新（${latestTag}）`,
            `A newer release (${latestTag}) is published on GitHub Releases (installed: ${curTag}).`,
            `GitHub Releases 已发布新版本 ${latestTag}（当前已安装：${curTag}）。`,
            'Click Upgrade Now (App) or update via Open VSX (IDE).',
            'App 端可点击「立即升级」，IDE 端可通过 Open VSX 更新。',
        );
        return {
            updateAvailable: true,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-update" id="updateStatusPill" data-update-status="update_available"${tip}>${tBiHtml(`Update available: ${latestTag}`, `有可用更新：${latestTag}`)}</span>`,
        };
    }
    if (updateStatus?.status === 'error') {
        const errDetail = updateStatus.error?.trim()
            || tBi('Unable to reach GitHub Releases to check for updates.', '无法连接 GitHub Releases 检查更新。');
        const tip = ` data-popover-key="settings-update-status-pill" data-tip-title="${esc(tBi('Update Check Failed', '更新检查失败'))}" data-tip-body="${esc(errDetail)}" data-tip-meta="${esc(tBi('Click "Check for Updates" to retry once network access is available.', '网络恢复后可点击「检查更新」重试。'))}"`;
        return {
            updateAvailable: false,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-error" id="updateStatusPill" data-update-status="error"${tip}>${tBiHtml('Check failed', '检查失败')}</span>`,
        };
    }
    if (updateStatus?.status === 'up_to_date' || updateStatus?.status === 'not_modified' || (updateStatus?.checkedAt && !updateAvailable)) {
        const tip = stgRichTipAttrs(
            'settings-update-status-pill',
            `Up to Date (${curTag})`,
            `已是最新版本（${curTag}）`,
            `Installed version ${curTag} matches the latest GitHub Release.`,
            `当前已安装的 ${curTag} 已是 GitHub Releases 最新版本。`,
        );
        return {
            updateAvailable: false,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-uptodate" id="updateStatusPill" data-update-status="up_to_date"${tip}>${tBiHtml(`Up to date (${curTag})`, `已是最新（${curTag}）`)}</span>`,
        };
    }
    const idleTip = stgRichTipAttrs(
        'settings-update-status-pill',
        `Installed Version ${curTag}`,
        `当前已安装版本 ${curTag}`,
        'No update check has run yet in this session.',
        '本次会话尚未执行更新检查。',
        'Click "Check for Updates" to query GitHub Releases.',
        '点击「检查更新」可立即查询 GitHub Releases。',
    );
    return {
        updateAvailable: false,
        latestTag,
        pillHtml: `<span class="stg-status-pill" id="updateStatusPill" data-update-status="idle"${idleTip}>${tBiHtml(`Current ${curTag}`, `当前版本 ${curTag}`)}</span>`,
    };
}

// ─── Antigravity Global Rules Card (~/.gemini/GEMINI.md) ─────────────────────

function buildGlobalRulesCardHtml(gr: GlobalRulesStatus): string {
    const sizeLabel = formatFileSize(gr.sizeBytes);
    const maxLabel = formatFileSize(GLOBAL_RULES_MAX_BYTES);
    const stateHtml = gr.exists
        ? `<span class="storage-path-state is-ready" id="globalRulesState" data-gr-exists="true" data-gr-too-large="${gr.tooLarge ? 'true' : 'false'}"><span>${tBiHtml('Ready', '已存在')}</span></span>`
        : `<span class="storage-path-state is-missing" id="globalRulesState" data-gr-exists="false" data-gr-too-large="false"><span>${tBiHtml('Missing', '不存在')}</span></span>`;
    const editorValue = gr.tooLarge ? '' : gr.content;
    const editorPlaceholder = gr.tooLarge
        ? tBi(`File exceeds ${maxLabel} — edit it in an external editor.`, `文件超过 ${maxLabel}，请使用外部编辑器修改。`)
        : tBi('Write your global rules in Markdown…', '用 Markdown 书写你的全局规则…');
    return `
        <section class="stg-card" id="globalRulesCard" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.file}</span>
                <h2>${tBiHtml('Antigravity Global Rules', 'Antigravity 全局规则')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        `Manage the machine-global rules file (~/.gemini/GEMINI.md) that Antigravity applies to every agent conversation across all workspaces. Edit inline below and click Save, or open the file in your editor of choice.`,
        `管理 Antigravity 的机器级全局规则文件（~/.gemini/GEMINI.md），对所有工作区的所有智能体会话生效。可直接在下方文本框编辑后点击「保存」，也可以点击「打开文件」用外部编辑器修改。`,
    )}</p>
            <div class="storage-path-box">
                <code class="storage-path-text" id="globalRulesPathText">${esc(gr.path)}</code>
                ${stateHtml}
            </div>
            <div class="storage-actions">
                <button type="button" class="action-btn" id="globalRulesOpenBtn">${ICON.file} <span>${tBiHtml('Open File', '打开文件')}</span></button>
                <button type="button" class="action-btn" id="globalRulesRevealBtn">${ICON.folder} <span>${tBiHtml('Reveal', '定位文件')}</span></button>
                <button type="button" class="action-btn" id="globalRulesReloadBtn">${ICON.refresh} <span>${tBiHtml('Reload', '重新加载')}</span></button>
                <button type="button" class="action-btn stg-btn-primary" id="globalRulesSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                <span id="globalRulesFeedback" class="threshold-feedback" role="status"></span>
            </div>
            <textarea id="globalRulesEditor" class="stg-globalrules-editor"
                      spellcheck="false" aria-label="${esc(tBi('Global rules content', '全局规则内容'))}"
                      placeholder="${esc(editorPlaceholder)}">${esc(editorValue)}</textarea>
            <div class="storage-stat-grid" style="margin-top: 12px;">
                <div class="storage-stat"><span class="storage-stat-val" id="globalRulesSizeVal">${esc(sizeLabel)}</span><span class="storage-stat-label">${tBiHtml('File Size', '文件大小')}</span></div>
                <div class="storage-stat"><span class="storage-stat-val">${tBiHtml('All workspaces', '全部工作区')}</span><span class="storage-stat-label">${tBiHtml('Applies to every conversation', '对所有会话生效')}</span></div>
            </div>
            <p class="stg-hint-note">${tBiHtml(
        `Saving writes ${maxLabel} max and only touches ~/.gemini/GEMINI.md — workspace rules are never modified.`,
        `保存上限为 ${maxLabel}，且只写入 ~/.gemini/GEMINI.md，绝不会修改任何工作区规则。`,
    )}</p>
        </section>`;
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
    const currentVersion = (options?.version && options.version.trim()) || options?.updateStatus?.currentVersion || '1.18.0';
    const currentVersion = (options?.version && options.version.trim()) || options?.updateStatus?.currentVersion || '1.17.11';
    const activePlatform = options?.cdpStatus?.launcherStatus?.platform
        || options?.cdpStatus?.platformGuide?.platform
        || (typeof process !== 'undefined' ? process.platform : 'darwin');

    const tabScrollHintEnabled = panelPrefs?.showTabScrollHint ?? true;
    const showScrollbar = panelPrefs?.showScrollbar ?? false;
    const showEndOfContent = panelPrefs?.showEndOfContent ?? true;
    const stateFileSizeLabel = storage ? formatFileSize(storage.stateFileSizeBytes) : '0 B';
    const ideOnlyDisabledAttr = isAppSidecar ? ' disabled aria-disabled="true"' : '';

    // Antigravity global rules (~/.gemini/GEMINI.md): lazy pure-Node read when
    // the host did not supply a snapshot; explicit `null` hides the card.
    const globalRulesStatus = options?.globalRules !== undefined
        ? options.globalRules
        : readGlobalRulesStatus({ includeContent: true });
    const globalRulesCard = globalRulesStatus ? buildGlobalRulesCardHtml(globalRulesStatus) : '';

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
    const cdpDiagnosticHintHtml = buildCdpDiagnosticHintHtml(options?.cdpStatus, appComposerRingEnabled, appTopBarEnabled, activePlatform);
    const cdpLauncherRowHtml = buildCdpLauncherRowHtml(options?.cdpStatus?.launcherStatus, activePlatform);
    const macWaitLaunchCmd = `while pgrep -f '^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`;
    const winPsCmd = '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    const winCmdShortcut = '"%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    const linuxLaunchCmd = 'antigravity --remote-debugging-port=0';
    const nativeHudTip = stgRichTipAttrs(
        'settings-tip-native-hud',
        'Native Panel Compact HUD',
        '面板顶部紧凑状态条 (HUD)',
        'HUD (Heads-Up Display) pins a compact telemetry strip at the top of this monitor panel showing context %, speed, TTFT, cache hit, cost, and quota.',
        'HUD（抬头状态条）直接固定在本监控面板顶部，一栏展示上下文占比、速度、首字延迟、缓存、费用与配额。',
        'Works 100% natively — no CDP debugging port required.',
        '纯原生运行，无需开启 CDP 调试端口。',
    );
    const composerRingTip = stgRichTipAttrs(
        'settings-tip-composer-ring',
        'Composer Context Ring (CDP)',
        '输入框上下文圆环（需 CDP）',
        'Adds a small circular context usage ring inside the Antigravity chat input box (Composer), placed right next to the Turbo / submit mode control.',
        '在 Antigravity 聊天输入框（Composer）的 Turbo / 提交模式按钮左侧显示迷你上下文进度环。',
        'Requires launching Antigravity App via the Persistent CDP Launcher (Chrome debugging port).',
        '需通过持久化 CDP 启动器（开启 Chrome 调试端口）启动 Antigravity App。',
    );
    const topBarOverlayTip = stgRichTipAttrs(
        'settings-tip-topbar-overlay',
        'Top-Right Status Bar & Quota Board (CDP)',
        '右上角状态栏与额度看板（需 CDP）',
        'Pins a floating status capsule and expandable quota board in the top-right corner of the Antigravity App window.',
        '在 Antigravity App 主窗口右上角悬浮显示实时状态胶囊与可展开的配额看板。',
        'Requires launching Antigravity App via the Persistent CDP Launcher (Chrome debugging port).',
        '需通过持久化 CDP 启动器（开启 Chrome 调试端口）启动 Antigravity App。',
    );
    const appOverlaysCard = `
        <section class="stg-card" id="appOverlaysCard" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <h2>${tBiHtml('App Ambient Overlays (Opt-In CDP)', '桌面悬浮层（可选 CDP）')}</h2>
                ${cdpPillHtml}
            </div>
            <p class="raw-desc">${tBiHtml(
        'The Compact HUD (status strip) works immediately at the top of this monitor panel with no extra setup. The two optional desktop overlays display live widgets directly inside the Antigravity App window (next to the chat input / Turbo area and in the top-right corner) once Antigravity is started with Chrome debugging (CDP) enabled — never modifying the app itself.',
        '「面板顶部紧凑 HUD」（状态条）会直接显示在本监控面板顶部，无需任何额外配置。下方两项桌面悬浮层会在开启浏览器调试端口（CDP）后，直接浮现于 Antigravity 主窗口的聊天输入框（Turbo 按钮左侧）与右上角，全程不修改应用本身。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row"${nativeHudTip}>
                    <input type="checkbox" id="toggleNativeHudBar" class="toggle-cb" data-app-setting="showNativeHudBar" data-feedback-id="appOverlaysFeedback" ${showNativeHudBar ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Native Panel Compact HUD (in-panel top bar, no CDP)', '面板顶部紧凑 HUD（本面板顶部状态条，无需 CDP）')}</span>
                </label>
                <label class="toggle-row"${composerRingTip}>
                    <input type="checkbox" id="toggleAppComposerRing" class="toggle-cb" data-app-setting="appComposerRingEnabled" data-feedback-id="appOverlaysFeedback" ${appComposerRingEnabled ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Composer Context Ring — Left of Turbo (CDP)', '输入框上下文环（Turbo 按钮左侧，需 CDP）')}</span>
                </label>
                <label class="toggle-row"${topBarOverlayTip}>
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
            ${cdpLauncherRowHtml}
            <details id="settings-cdp-guide" class="stg-guide-details" data-state-key="settings-cdp-guide">
                <summary>${tBiHtml('Technical details & manual terminal CDP launch guide (macOS / Windows / Linux)', '技术原理与手动终端 CDP 启动指引（macOS / Windows / Linux）')}</summary>
                <div class="stg-guide-body">
                    <p>${tBiHtml(
        'How it works: overlays mount read-only Shadow DOM widgets via Chrome DevTools Protocol (DevToolsActivePort) — zero app.asar patching and 100% ToS-safe.',
        '实现原理：通过 Chrome 调试协议（DevToolsActivePort）在主窗口挂载只读 Shadow DOM 悬浮组件——零 app.asar 篡改，100% 合规。',
    )}</p>
                    <p class="stg-guide-step">${tBiHtml(
        'Step 1 — Quit Antigravity App completely first (macOS: Cmd+Q and wait ~5s for background language_server teardown; Windows/Linux: close all windows & tray icon). If Antigravity is still exiting, macOS "open -a" silently drops --args.',
        '第一步 — 先完全退出 Antigravity App（macOS 按 Cmd+Q 后需等待约 5 秒后台 language_server 清理完成；Windows/Linux 关闭所有窗口及托盘图标）。若旧进程仍在退出中，macOS 的 open -a 会静默丢弃 --args 参数。',
    )}</p>
                    <p class="stg-guide-step">${tBiHtml(
        'Step 2 — Relaunch Antigravity App with --remote-debugging-port=0 (the macOS command below automatically waits out the 5s teardown), then click Recheck CDP:',
        '第二步 — 使用 --remote-debugging-port=0 重新启动 Antigravity App（下方 macOS 命令会自动等待 5 秒后台清理结束），然后点击「重新检测」：',
    )}</p>
                    <div class="stg-code-list">
                        <div class="stg-code-item${activePlatform === 'darwin' ? ' is-current-platform' : ''}">
                            <div class="stg-code-item-head">
                                <strong>macOS (Terminal — race-free wait &amp; launch)</strong>
                                <button type="button" class="action-btn cdp-copy-btn" data-copy-command="${esc(macWaitLaunchCmd)}" aria-label="${esc(tBi('Copy macOS command', '复制 macOS 命令'))}">${ICON.copy} <span>${tBiHtml('Copy', '复制')}</span></button>
                            </div>
                            <code>${esc(macWaitLaunchCmd)}</code>
                        </div>
                        <div class="stg-code-item${activePlatform === 'win32' ? ' is-current-platform' : ''}">
                            <div class="stg-code-item-head">
                                <strong>Windows (PowerShell)</strong>
                                <button type="button" class="action-btn cdp-copy-btn" data-copy-command="${esc(winPsCmd)}" aria-label="${esc(tBi('Copy Windows PowerShell command', '复制 Windows PowerShell 命令'))}">${ICON.copy} <span>${tBiHtml('Copy', '复制')}</span></button>
                            </div>
                            <code>${esc(winPsCmd)}</code>
                        </div>
                        <div class="stg-code-item${activePlatform === 'win32' ? ' is-current-platform' : ''}">
                            <div class="stg-code-item-head">
                                <strong>Windows (CMD / Shortcut)</strong>
                                <button type="button" class="action-btn cdp-copy-btn" data-copy-command="${esc(winCmdShortcut)}" aria-label="${esc(tBi('Copy Windows CMD command', '复制 Windows CMD 命令'))}">${ICON.copy} <span>${tBiHtml('Copy', '复制')}</span></button>
                            </div>
                            <code>${esc(winCmdShortcut)}</code>
                        </div>
                        <div class="stg-code-item${activePlatform === 'linux' ? ' is-current-platform' : ''}">
                            <div class="stg-code-item-head">
                                <strong>Linux</strong>
                                <button type="button" class="action-btn cdp-copy-btn" data-copy-command="${esc(linuxLaunchCmd)}" aria-label="${esc(tBi('Copy Linux command', '复制 Linux 命令'))}">${ICON.copy} <span>${tBiHtml('Copy', '复制')}</span></button>
                            </div>
                            <code>${esc(linuxLaunchCmd)}</code>
                        </div>
                    </div>
                    <p class="stg-guide-note">${tBiHtml(
        'Dock & Taskbar tips: on macOS, drag "Antigravity (CDP).app" from /Applications (or Finder) into the Dock — NEVER right-click the running icon and choose "Keep in Dock" (that saves the original app without --remote-debugging-port=0). On Windows, right-click the direct .lnk shortcut to Pin to Taskbar natively. On Linux, pin "Antigravity (CDP)" from your app launcher to Ubuntu Dock.',
        '固定到 Dock / 任务栏提示：macOS 请从访达将「Antigravity (CDP).app」拖入程序坞，切勿右键运行中图标选「在程序坞中保留」（否则会固定无参原版应用）；Windows 直连 .lnk 支持右键原生「固定到任务栏」；Linux 请从应用启动器将「Antigravity (CDP)」固定到 Ubuntu Dock。',
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
    const planOptionsHtml = SUBSCRIPTION_PLAN_PRESET_ORDER.map((planId) => {
        const preset = SUBSCRIPTION_PLAN_PRESETS[planId];
        const feeHint = preset.monthlyUsd > 0 ? ` ($${preset.monthlyUsd}/mo)` : '';
        const label = `${tBi(preset.labelEn, preset.labelZh)}${feeHint}`;
        return `<option value="${planId}"${subscriptionPlan === planId ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    const subscriptionFeePlaceholder = String(
        SUBSCRIPTION_PLAN_PRESETS[subscriptionPlan]?.monthlyUsd > 0
            ? SUBSCRIPTION_PLAN_PRESETS[subscriptionPlan].monthlyUsd
            : SUBSCRIPTION_PLAN_PRESETS['google-ai-pro'].monthlyUsd,
    );
    const defaultFxPlaceholder = String(CURRENCY_PRESETS[displayCurrency]?.defaultRatePerUsd ?? 1);

    const orchMappedTip = stgRichTipAttrs(
        'settings-tip-orch-mapped',
        'Mapped Base Mode',
        '按底座估算模式',
        'Estimates fixed server-managed Orchestrator models using their corresponding underlying base model official API rate.',
        '使用对应底座模型的公开官方单价，估算服务端固定编排模型的参考费用。',
        'Recommended for complete cost charts.',
        '推荐开启，让成本图表完整覆盖编排调用。',
    );
    const orchStrictTip = stgRichTipAttrs(
        'settings-tip-orch-strict',
        'Strict Pricing Mode',
        '严格计价模式',
        'Marks fixed server-managed Orchestrator models as Unpriced until you manually enter a custom rate in the Cost tab.',
        '在你于「成本」页手动填写自定义单价前，将无公开标价的固定编排模型标记为「未定价」。',
        'Use when you only want strictly published API prices included in totals.',
        '适合仅希望统计明确公开标价模型的场景。',
    );
    const customFxTip = stgRichTipAttrs(
        'settings-tip-custom-fx',
        'Custom FX (Foreign Exchange) Rate',
        '自定义汇率 (FX)',
        'Optional exchange rate per 1 USD used to convert API reference costs into your selected display currency.',
        '可选的 1 USD 兑换目标显示货币的汇率（FX = 外汇汇率），用于换算参考费用。',
        'Leave blank to automatically use the built-in reference exchange rate.',
        '留空时自动采用内置参考汇率。',
    );
    const subRoiTip = stgRichTipAttrs(
        'settings-tip-subscription-roi',
        'Subscription Plan (ROI Reference)',
        '订阅方案（ROI 参考）',
        'ROI (Return on Investment) compares your estimated API reference value against your prorated monthly subscription fee in the Calendar tab.',
        'ROI（投入产出比）用于在「日历」页将你的等效 API 参考估值与按天折算的订阅月费进行对比。',
        'Prorated fee = monthly fee × (range days ÷ 30). Local estimate only.',
        '折算公式：月费 ×（区间天数 ÷ 30）。仅作本地参考。',
    );
    const calRetentionTip = stgRichTipAttrs(
        'settings-tip-calendar-retention',
        'Calendar Retention (Days)',
        '日历历史保留天数',
        'How many daily usage archive records are retained in local persistent storage (30 to 3,650 days).',
        '本地持久化存储中保留的每日用量归档天数上限（范围 30–3,650 天）。',
        'Older archived days beyond this limit are automatically trimmed on save.',
        '超出保留天数的较早归档会在保存时自动清理。',
    );
    const maxRecentStepsTip = stgRichTipAttrs(
        'settings-tip-max-recent-steps',
        'Max Recent Activity Steps',
        '最近活动步骤上限',
        'Maximum number of recent tool/reasoning steps kept in memory for the current session in GM Data (10 to 500).',
        '当前会话在「GM 数据」时间线中保留的最近步骤条数上限（范围 10–500）。',
        'Higher values show deeper step history at slightly higher memory usage.',
        '数值越大可回看越多步骤细节，内存占用略微增加。',
    );
    const maxArchivesTip = stgRichTipAttrs(
        'settings-tip-max-archives',
        'Max Archived Activity Sessions',
        '活动归档会话上限',
        'Maximum number of past conversation activity summaries kept locally before older sessions rotate out (1 to 100).',
        '本地保留的过往会话活动归档份数上限（范围 1–100），超出后自动淘汰最早归档。',
        'Applies to GM Data session archives; Calendar daily totals follow Calendar retention above.',
        '仅影响「GM 数据」会话归档；日历按天汇总遵循上方日历保留天数。',
    );

    const costCurrencyHistoryCard = `
        <section class="stg-card" id="costCurrencyHistoryCard" data-accent="history">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Cost, Currency & History', '费用、货币与历史')}</h2>
            </div>
            <div class="setting-row">
                <label>${tBiHtml('Orchestrator pricing mode', '编排模型计费模式')}</label>
                <p class="raw-desc">${tBiHtml(
        'Mapped Base estimates fixed server-managed Orchestrator models (such as Orchestrator Neon, Carbon, and Argon) using their underlying base model\'s official rate; Strict mode marks them Unpriced until custom rates are entered.',
        '按底座估算会使用对应底座模型的官方单价估算服务端固定编排模型（如 Orchestrator Neon、Carbon、Argon 等）；严格模式在填写自定义价格前将其标记为未定价。',
    )}</p>
                <div class="stg-seg-group" role="radiogroup" aria-label="${esc(tBi('Orchestrator pricing mode', '编排模型计费模式'))}">
                    <button type="button" class="stg-seg-btn${orchestratorPricingMode === 'mapped' ? ' is-active' : ''}" id="stgOrchModeMapped" data-action="setOrchestratorPricingMode" data-mode="mapped" role="radio" aria-checked="${orchestratorPricingMode === 'mapped' ? 'true' : 'false'}"${orchMappedTip}>${tBiHtml('Mapped Base', '按底座估算')}</button>
                    <button type="button" class="stg-seg-btn${orchestratorPricingMode === 'strict' ? ' is-active' : ''}" id="stgOrchModeStrict" data-action="setOrchestratorPricingMode" data-mode="strict" role="radio" aria-checked="${orchestratorPricingMode === 'strict' ? 'true' : 'false'}"${orchStrictTip}>${tBiHtml('Strict', '严格模式')}</button>
                </div>
                <span id="orchPricingModeFeedback" class="threshold-feedback" role="status"></span>
            </div>

            <div class="stg-divider"></div>

            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="displayCurrencySelect">${tBiHtml('Display currency', '显示货币')}</label>
                    <select id="displayCurrencySelect" class="stg-select" data-app-setting="displayCurrency" data-feedback-id="customFxRateFeedback">
                        ${currencyOptionsHtml}
                    </select>
                </div>
                <div class="stg-field">
                    <label for="customFxRateInput"${customFxTip}>${tBiHtml('Custom FX rate (per 1 USD)', '自定义汇率（每 1 USD）')}</label>
                    <input type="number" id="customFxRateInput" class="threshold-input"
                           data-app-setting="customFxRate" data-setting-type="nullable-float" data-feedback-id="customFxRateFeedback"
                           min="0.0001" max="1000000" step="0.01"
                           value="${customFxRate !== null ? esc(String(customFxRate)) : ''}"
                           placeholder="${esc(defaultFxPlaceholder)}" />
                    <span id="customFxRateFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
            <p class="stg-hint-note">${tBiHtml('FX = foreign exchange rate per 1 USD. Leave blank to use the built-in reference rate.', 'FX 为每 1 USD 折算汇率，留空自动使用内置参考汇率。')}</p>

            <div class="stg-form-grid stg-form-grid-subscription">
                <div class="stg-field stg-field-plan">
                    <label for="subscriptionPlanSelect"${subRoiTip}>${tBiHtml('Subscription plan (ROI)', '订阅方案（ROI 参考）')}</label>
                    <select id="subscriptionPlanSelect" class="stg-select" data-app-setting="subscriptionPlan" data-feedback-id="subscriptionFeedback">
                        ${planOptionsHtml}
                    </select>
                </div>
                <div class="stg-field">
                    <label for="subscriptionFeeInput">${tBiHtml('Monthly fee', '月费金额')}</label>
                    <input type="number" id="subscriptionFeeInput" class="threshold-input"
                           data-app-setting="subscriptionMonthlyFee" data-setting-type="nullable-float" data-feedback-id="subscriptionFeedback"
                           min="0" max="100000" step="0.01"
                           value="${subscriptionMonthlyFee !== null ? esc(String(subscriptionMonthlyFee)) : ''}"
                           placeholder="${esc(subscriptionFeePlaceholder)}" />
                </div>
                <div class="stg-field">
                    <label for="subscriptionCurrencySelect">${tBiHtml('Fee currency', '月费币种')}</label>
                    <select id="subscriptionCurrencySelect" class="stg-select" data-app-setting="subscriptionCurrency" data-feedback-id="subscriptionFeedback">
                        ${subCurrencyOptionsHtml}
                    </select>
                    <span id="subscriptionFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
            <p class="stg-hint-note">${tBiHtml(ROI_DISCLAIMER_EN, ROI_DISCLAIMER_ZH)}</p>

            <div class="stg-divider"></div>

            <div class="setting-row">
                <label for="calendarRetentionInput"${calRetentionTip}>${tBiHtml('Calendar retention (days)', '日历历史保留天数')}</label>
                <p class="raw-desc">${tBiHtml('Number of daily usage archive days kept locally (30–3,650 days).', '本地保留的每日用量归档天数（30–3,650 天），超出自动清理较早记录。')}</p>
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
                    <label for="activityMaxRecentStepsInput"${maxRecentStepsTip}>${tBiHtml('Max recent activity steps', '最近活动步骤上限')}</label>
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
                    <label for="activityMaxArchivesInput"${maxArchivesTip}>${tBiHtml('Max archived activity sessions', '活动归档会话上限')}</label>
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

        ${globalRulesCard}

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
                <label for="pollingInput"${stgRichTipAttrs(
        'settings-tip-polling-interval',
        'Polling Interval',
        '轮询间隔',
        'How frequently the monitor queries the local Antigravity service for updated context and quota metrics.',
        '监控向本地 Antigravity 服务拉取上下文与配额更新的时间间隔。',
        '1–60s · Shorter intervals feel fresher; longer intervals reduce background CPU usage (default: 5s).',
        '范围 1–60 秒 · 间隔越短刷新越及时，间隔越长后台 CPU 占用越低（默认 5 秒）。',
    )}>${tBiHtml(
        'Polling interval (seconds)',
        '轮询间隔（秒）',
    )}</label>
                <p class="raw-desc">${tBiHtml(
        'How often to refresh context and quota data (1–60s). Shorter intervals update faster; longer intervals use less CPU.',
        '多久刷新一次上下文与配额数据（1–60 秒）。间隔越短更新越及时，间隔越长后台占用越低。',
    )}</p>
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
                        <label class="toggle-row"${stgRichTipAttrs(
        'settings-tip-cache-hit',
        'Prompt Cache Hit Rate',
        '提示词缓存命中率',
        'Shows the percentage of prompt tokens served directly from provider cache in the IDE status bar (higher means faster responses and lower reference cost).',
        '在 IDE 状态栏中显示提示词缓存复用占比（越高代表首字响应越快、等效费用越低）。',
        'Formula: Cache Read ÷ (Fresh Input + Cache Read + Cache Write).',
        '口径：缓存读取 ÷（新输入 + 缓存读取 + 缓存写入）。',
    )}>
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
                    <label class="stg-select-row" for="statusTooltipDensity"${stgRichTipAttrs(
        'settings-tip-hover-density',
        'IDE Status Bar Hover Density',
        'IDE 状态栏悬停摘要密度',
        'Controls how many detail sections appear when hovering the Antigravity IDE status bar item.',
        '控制鼠标悬停在 Antigravity IDE 状态栏上时展示的摘要详细程度。',
        'Automatic: adapts to window zoom & pool count · Compact: ≤14 lines · Full: ≤32 lines (all sections).',
        '自动：随缩放和配额池数自适应 · 精简：≤14 行 · 完整：≤32 行（展示全部板块）。',
    )}>
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
                <label class="toggle-row"${stgRichTipAttrs(
        'settings-tip-lock-main-agent',
        'Lock to Main Agent',
        '锁定主会话',
        'Keeps the monitor focused on your main conversation instead of jumping whenever a background subagent runs.',
        '持续跟踪你的主对话，不会因为后台子智能体运行而自动切换视图焦点。',
        'You can still switch conversations manually using the header switcher.',
        '开启后仍可通过顶栏会话切换器手动查看任意对话。',
    )}>
                    <input type="checkbox" id="toggleLockMainAgent" class="toggle-cb" ${lockToMainAgent ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Lock to Main Agent (ignore background subagents)', '锁定主会话（忽略后台子智能体）')}</span>
                </label>
                <label class="toggle-row"${stgRichTipAttrs(
        'settings-tip-model-internal-id',
        'Show Model Internal ID',
        '显示模型内部 ID',
        'Appends Antigravity\'s short internal catalog ID (such as M16 or M535) next to model names.',
        '在模型名称旁附加 Antigravity 内部目录短编号（例如 M16 或 M535）。',
        'Helpful when debugging model routing, effort tiers, or custom pricing rules.',
        '适合排查模型路由、推理档位或自定义定价匹配时开启。',
    )}>
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
                <h2${stgRichTipAttrs(
        'settings-tip-panel-tips',
        'Tab-Bar Scroll Hint',
        '顶栏横向滚动提示',
        'Controls the brief tip reminding you that the top navigation tab bar scrolls horizontally in narrow side panes.',
        '控制窄侧栏顶部标签导航栏可横向滚动的引导提示。',
        'Click "Show Hint Now" to re-display the tab-bar horizontal scroll hint immediately once.',
        '点击「立即显示一次提示」可在顶部立刻重新显示一次标签栏滚动提示。',
    )}>${tBiHtml('Panel Tips', '界面提示')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Controls the top tab-bar horizontal scroll hint (useful in narrow side panes). The badge below shows whether auto-display is enabled; click the button to re-show the tab-bar scroll hint immediately once.',
        '控制顶部标签导航栏的横向滚动提示（在窄侧栏中方便发现更多标签页）。下方状态仅表示是否启用自动提示，点击按钮可立即重新显示一次标签栏滚动提示。',
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

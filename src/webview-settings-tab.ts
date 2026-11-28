// ─── Settings Tab Content Builder ────────────────────────────────────────────
// Builds HTML for the "Settings" tab: storage diagnostics, App Ambient Overlays
// (Opt-In CDP), Updates & Release Checks, Cost/Currency/History, quota threshold,
// polling, collapsible IDE status bar toggles, advanced display, zoom, and panel prefs.
//
// Pure Node/TypeScript safe: ZERO top-level `vscode` import so Antigravity App
// Sidecar and pure Node tests can render Settings without VS Code.

import { getLanguage, t, tBi, tHtml } from './i18n-core';
import type { ModelConfig } from './models';
import { parseTooltipDensity } from './tooltip-budget';
import {
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    SUPPORTED_DISPLAY_CURRENCIES,
    normalizeCurrencyCode,
    resolveAppCurrencyConfig,
    type CurrencyCode,
} from './core/currency';
import {
    normalizeSubscriptionPlanId,
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    SUBSCRIPTION_PLAN_PRESETS,
    type SubscriptionPlanPresetId,
} from './core/pricing-validation';
import { resolveRuntimeVersion } from './core/version';
import type { ContextDisplayBasis, SpeedDisplayMode } from './core/context-display';
import type { QuotaDirectionMode, QuotaWindowMode } from './quota-runway';
import {
    type DisplayCurrencyCode as BaseDisplayCurrencyCode,
    type OrchestratorPricingMode,
} from './durable-state';
import type { AppSettingsWithV118, CdpDiagnosticCode, CdpLauncherStatus, CdpStatus } from './app/sidecar-types';
import { GLOBAL_RULES_MAX_BYTES, type GlobalRulesStatus } from './global-rules';
import { ICON } from './webview-icons';
import { esc, formatFileSize, richTipBiAttrs as stgRichTipAttrs, tBiHtml } from './webview-helpers';

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
    displayCurrency?: BaseDisplayCurrencyCode;
    customFxRate?: number | null;
    customFxCurrency?: CurrencyCode | null;
    subscriptionPlan?: SubscriptionPlanPresetId;
    subscriptionMonthlyFee?: number | null;
    subscriptionCurrency?: BaseDisplayCurrencyCode;
    calendarRetentionDays?: number;
    autoCheckUpdates?: boolean;
    activityMaxRecentSteps?: number;
    activityMaxArchives?: number;
    // v1.18 optional settings
    languagePreference?: 'auto' | 'en' | 'zh' | 'both';
    contextPctBasis?: ContextDisplayBasis;
    speedMetricMode?: SpeedDisplayMode;
    quotaWindowMode?: QuotaWindowMode;
    quotaDirectionMode?: QuotaDirectionMode;
    appShowNativeHudBar?: boolean;
    ideShowNativeHudBar?: boolean;
    nativeHudAutoHideOnOverview?: boolean;
    cdpOverlayFontSize?: 'compact' | 'normal' | 'large';
    cdpOverlayHighContrast?: boolean;
    appOnboardingDismissed?: boolean;
}

export type MonitorDocumentSettingsInput = Partial<Omit<MonitorDocumentSettings, 'displayCurrency' | 'subscriptionCurrency'>> & {
    displayCurrency?: CurrencyCode | BaseDisplayCurrencyCode;
    subscriptionCurrency?: CurrencyCode | BaseDisplayCurrencyCode;
};

export interface SettingsTabOptions {
    settings?: MonitorDocumentSettingsInput;
    appSettings?: Partial<AppSettingsWithV118>;
    surface?: 'ide' | 'app-sidecar' | 'app';
    zoomLevel?: number;
    version?: string;
    cdpStatus?: CdpStatus | null;
    updateStatus?: UpdateStatusView | null;
    globalRules?: GlobalRulesStatus | null;
    privacyMasked?: boolean;
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

function normalizeCurrency(value: unknown, fallback: CurrencyCode = 'USD'): CurrencyCode {
    if (typeof value !== 'string') { return fallback; }
    const upper = value.trim().toUpperCase();
    return (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(upper)
        ? normalizeCurrencyCode(upper, fallback)
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
    partial?: MonitorDocumentSettingsInput | null,
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
        displayCurrency: normalizeCurrency(src.displayCurrency, 'USD') as unknown as BaseDisplayCurrencyCode,
        customFxRate: normalizeNullablePositive(src.customFxRate, false),
        customFxCurrency: src.customFxCurrency ? normalizeCurrency(src.customFxCurrency, 'USD') : null,
        subscriptionPlan,
        subscriptionMonthlyFee,
        subscriptionCurrency: normalizeCurrency(src.subscriptionCurrency, 'USD') as unknown as BaseDisplayCurrencyCode,
        calendarRetentionDays: clampNumber(src.calendarRetentionDays, DEFAULT_MONITOR_DOCUMENT_SETTINGS.calendarRetentionDays!, 30, 3650),
        autoCheckUpdates: typeof src.autoCheckUpdates === 'boolean'
            ? src.autoCheckUpdates
            : DEFAULT_MONITOR_DOCUMENT_SETTINGS.autoCheckUpdates,
        activityMaxRecentSteps: maxRecentSteps,
        activityMaxArchives: maxArchives,
        ...(src.languagePreference === 'auto' || src.languagePreference === 'en' || src.languagePreference === 'zh' || src.languagePreference === 'both'
            ? { languagePreference: src.languagePreference }
            : {}),
        ...(src.contextPctBasis === 'compaction' || src.contextPctBasis === 'native'
            ? { contextPctBasis: src.contextPctBasis }
            : {}),
        ...(src.speedMetricMode === 'decode' || src.speedMetricMode === 'e2e'
            ? { speedMetricMode: src.speedMetricMode }
            : {}),
        ...(src.quotaWindowMode === '5h' || src.quotaWindowMode === '7d' || src.quotaWindowMode === 'tightest'
            ? { quotaWindowMode: src.quotaWindowMode }
            : {}),
        ...(src.quotaDirectionMode === 'remaining' || src.quotaDirectionMode === 'used'
            ? { quotaDirectionMode: src.quotaDirectionMode }
            : {}),
        ...(typeof src.appShowNativeHudBar === 'boolean'
            ? { appShowNativeHudBar: src.appShowNativeHudBar }
            : {}),
        ...(typeof src.ideShowNativeHudBar === 'boolean'
            ? { ideShowNativeHudBar: src.ideShowNativeHudBar }
            : {}),
        ...(typeof src.nativeHudAutoHideOnOverview === 'boolean'
            ? { nativeHudAutoHideOnOverview: src.nativeHudAutoHideOnOverview }
            : {}),
        ...(src.cdpOverlayFontSize === 'compact' || src.cdpOverlayFontSize === 'normal' || src.cdpOverlayFontSize === 'large'
            ? { cdpOverlayFontSize: src.cdpOverlayFontSize }
            : {}),
        ...(typeof src.cdpOverlayHighContrast === 'boolean'
            ? { cdpOverlayHighContrast: src.cdpOverlayHighContrast }
            : {}),
        ...(typeof src.appOnboardingDismissed === 'boolean'
            ? { appOnboardingDismissed: src.appOnboardingDismissed }
            : {}),
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

const STG_SHARED_RAW = `cdpProbingText\tChecking…\t检测中…
cdpConnectedText\tConnected\t已连接
cdpErrorText\tCDP Error\tCDP 异常
cdpInactiveText\tCDP Inactive\tCDP 未就绪
cdpDisabledText\tDisabled\t未启用
cdpDiagProbingText\tChecking Antigravity App CDP connection…\t正在检测 Antigravity App 的 CDP 连接状态…
cdpLauncherInstalledText\tInstalled\t已创建
cdpLauncherNotInstalledText\tNot created\t未创建
cdpLauncherCreateBtnText\tCreate Persistent Launcher\t一键生成持久化启动器
cdpLauncherRecreateBtnText\tRecreate Launcher\t重新生成启动器
cdpLauncherRevealDarwinText\tReveal in Finder\t在访达中显示
cdpLauncherRevealWinText\tShow in Explorer\t在资源管理器中显示
cdpLauncherRevealLinuxText\tOpen Folder\t打开所在目录
updateAvailablePillTpl\tUpdate available: {ver}\t有可用更新：{ver}
upToDatePillTpl\tUp to date ({ver})\t已是最新（{ver}）
currentVerPillTpl\tCurrent {ver}\t当前版本 {ver}
aboutReadyText\tReady\t就绪
aboutUpToDatePlainText\tUp to date\t已是最新
checkFailedText\tCheck failed\t检查失败
updateTipTitleAvailable\tUpdate Available\t发现新版本
updateTipTitleError\tUpdate Check Failed\t更新检查失败
updateTipTitleOk\tPlugin Up to Date\t已是最新版本
updateTipTitleIdle\tVersion Check Status\t版本检查状态
updateTipBodyAvailableTpl\tRelease {ver} is available on GitHub Releases.\tGitHub Releases 已发布新版本 {ver}。
updateTipMetaAvailable\tClick "Upgrade Now" (App) or update from Open VSX (IDE).\tApp 可点击「立即升级」，IDE 可在 Open VSX 更新。
updateTipBodyErrorFallback\tUnable to query GitHub Releases.\t暂时无法连接 GitHub Releases。
updateTipMetaError\tCheck network/proxy and retry.\t请检查网络或代理后重试。
updateTipBodyOk\tRunning the latest published version.\t当前已是最新版本。
updateTipBodyIdle\tClick "Check for Updates" to check GitHub Releases.\t点击「检查更新」查看最新版本。
cdpPillTipTitle\tDesktop Overlays (CDP) Status\t桌面悬浮层 (CDP) 状态
cdpPillTipConnectedFallback\tConnected via local CDP port.\t已通过本地 CDP 端口连接。
cdpPillTipProbingBody\tChecking local CDP debugging port.\t正在检测本地 CDP 调试端口。
cdpPillTipInactiveBody\tRunning without --remote-debugging-port=0. Launch via "Antigravity (CDP)" and click Recheck CDP.\t未启用 --remote-debugging-port=0，请从「Antigravity (CDP)」启动后点击「重新检测」。
cdpPillTipDisabledBody\tOptional desktop overlays are turned off.\t可选桌面悬浮层已关闭。
cdpPillTipErrorFallback\tFailed to attach to local CDP target.\t连接本地 CDP 目标失败。
cdpPillTipMeta\tCore panel and in-panel HUD work natively without CDP.\t核心面板与顶部 HUD 均原生工作，不依赖 CDP。
tabHintEnabledText\tAuto Hint Enabled\t自动提示已开启
tabHintDisabledText\tAuto Hint Disabled\t自动提示已关闭
grLoadEditBtnText\tLoad / Edit\t加载并编辑
grReloadBtnText\tReload\t重新加载
grTooLargeText\tExceeds 200 KiB limit — use Open File.\t超过 200 KiB 上限，请点「打开文件」。
grTooLargePillText\tToo Large\t超出上限
grInvalidPathText\tInvalid Path\t路径异常
grSymlinkErrorText\tRefused: ~/.gemini/GEMINI.md cannot be a symlink.\t已拒绝：~/.gemini/GEMINI.md 不能为符号链接。
grMissingText\tMissing\t不存在
grUnloadedPlaceholderText\tClick "Load / Edit" to load ~/.gemini/GEMINI.md on demand.\t点击「加载并编辑」按需加载 ~/.gemini/GEMINI.md。
grEditablePlaceholderText\tWrite global rules, then click Save…\t输入全局规则后点击「保存」…`;

export const STG_SHARED_PAIRS: Readonly<Record<string, readonly [string, string]>> = Object.fromEntries(
    STG_SHARED_RAW.split('\n').map(l => {
        const [k, en, zh] = l.split('\t');
        return [k, [en, zh] as const];
    }),
);

const sBi = (k: string): string => {
    const p = STG_SHARED_PAIRS[k];
    return tBi(p[0], p[1]);
};
const sHtml = (k: string): string => {
    const p = STG_SHARED_PAIRS[k];
    return tBiHtml(p[0], p[1]);
};

function buildCdpStatusPillHtml(
    cdpStatus: CdpStatus | null | undefined,
    composerEnabled: boolean,
    topBarEnabled: boolean,
): string {
    const anyEnabled = composerEnabled || topBarEnabled;
    const state = cdpStatus?.state ?? (anyEnabled ? 'cdp_unavailable' : 'disabled');
    const diagCode = resolveCdpDiagnosticCode(cdpStatus, composerEnabled, topBarEnabled);
    const title = sBi('cdpPillTipTitle');
    const meta = diagCode && state !== 'connected' && state !== 'probing' && state !== 'disabled'
        ? `${diagCode} · ${sBi('cdpPillTipMeta')}`
        : sBi('cdpPillTipMeta');
    const tipAttrs = (body: string) =>
        ` data-popover-key="settings-cdp-status-pill" data-tip-title="${esc(title)}" data-tip-body="${esc(body)}" data-tip-meta="${esc(meta)}"`;
    if (state === 'connected') {
        const portPart = typeof cdpStatus?.discoveredPort === 'number' ? `:${cdpStatus.discoveredPort}` : '';
        const targetInfo = cdpStatus?.targetTitle
            ? `${cdpStatus.targetTitle}${portPart ? ` (${portPart})` : ''}`
            : (portPart ? `CDP ${portPart}` : sBi('cdpPillTipConnectedFallback'));
        return `<span class="stg-status-pill is-connected" id="cdpStatusPill" data-cdp-state="connected" data-cdp-diagnostic="${esc(diagCode)}"${tipAttrs(targetInfo)}>${sHtml('cdpConnectedText')}</span>`;
    }
    if (state === 'probing') {
        return `<span class="stg-status-pill" id="cdpStatusPill" data-cdp-state="probing" data-cdp-diagnostic="probing"${tipAttrs(sBi('cdpPillTipProbingBody'))}>${sHtml('cdpProbingText')}</span>`;
    }
    if (state === 'error') {
        const errBody = cdpStatus?.errorMessage?.trim() || sBi('cdpPillTipErrorFallback');
        return `<span class="stg-status-pill is-error" id="cdpStatusPill" data-cdp-state="error" data-cdp-diagnostic="${esc(diagCode)}"${tipAttrs(errBody)}>${sHtml('cdpErrorText')}</span>`;
    }
    if (state === 'cdp_unavailable') {
        return `<span class="stg-status-pill is-inactive" id="cdpStatusPill" data-cdp-state="cdp_unavailable" data-cdp-diagnostic="${esc(diagCode)}"${tipAttrs(sBi('cdpPillTipInactiveBody'))}>${sHtml('cdpInactiveText')}</span>`;
    }
    return `<span class="stg-status-pill is-disabled" id="cdpStatusPill" data-cdp-state="disabled" data-cdp-diagnostic="disabled"${tipAttrs(sBi('cdpPillTipDisabledBody'))}>${sHtml('cdpDisabledText')}</span>`;
}

function getRevealLauncherKey(platform?: string): string {
    if (platform === 'win32') { return 'cdpLauncherRevealWinText'; }
    if (platform === 'linux') { return 'cdpLauncherRevealLinuxText'; }
    return 'cdpLauncherRevealDarwinText';
}

const CDP_DIAG_RAW = `stepsEn\tStep 1: click "Create Persistent Launcher" below. Step 2: launch from "Antigravity (CDP)" (original icon untouched), then click Recheck CDP.
stepsZh\t步骤 1：点击下方「一键生成持久化启动器」；步骤 2：改从「Antigravity (CDP)」启动（不修改原图标），再点「重新检测」。
instPrefixEn\tPersistent launcher is ready, but this session lacks --remote-debugging-port=0. Launch from 
instPrefixZh\t持久化启动器已就绪，但当前会话未启用 --remote-debugging-port=0。请改从
darwinTailEn\t"Antigravity (CDP)" ("Reveal in Finder" below and drag into Dock — never "Keep in Dock" on running icon)
darwinTailZh\t「Antigravity (CDP)」（点「在访达中显示」拖入程序坞，勿选运行中图标「在程序坞中保留」）
winTailEn\tdirect "Antigravity (CDP)" shortcut (right-click to Pin to Taskbar, or "Show in Explorer" below)
winTailZh\t「Antigravity (CDP)」直连快捷方式（支持原生「固定到任务栏」或点「在资源管理器中显示」）
linuxTailEn\t"Antigravity (CDP)" app launcher entry (pin to Ubuntu Dock, or "Open Folder" below)
linuxTailZh\t「Antigravity (CDP)」应用入口（可固定到 Ubuntu Dock 或点「打开所在目录」）
connectedEn\tConnected to Antigravity Hub{port}{title}.
connectedZh\t已连接到 Antigravity 主窗口{port}{title}。
unreachableEn\tDevToolsActivePort{port} unreachable (stale). Quit Antigravity, relaunch with --remote-debugging-port=0, then click Recheck CDP.
unreachableZh\tDevToolsActivePort{port}无响应（旧残留）。请完全退出并以 --remote-debugging-port=0 重启后点「重新检测」。
noHubEn\tCDP port{port} open, but no Hub window target found. Open a workspace window and click Recheck CDP.
noHubZh\tCDP 端口{port}已响应但未找到主窗口目标。请打开工作区窗口后点「重新检测」。
wsErrorEn\tCDP WebSocket failed{err}. Click Recheck CDP or relaunch with --remote-debugging-port=0.
wsErrorZh\tCDP WebSocket 失败{err}。请点「重新检测」或带参数重启。
evalErrorEn\tConnected to Hub, but overlay injection failed{err}. Click Recheck CDP after loading.
evalErrorZh\t已连主窗口但悬浮组件注入失败{err}。加载后请点「重新检测」。
missingPrefixEn\tDevToolsActivePort not found — 
missingPrefixZh\t未检测到 DevToolsActivePort —— 
hostMissingPrefixEn\tAntigravity App lacks --remote-debugging-port=0 (or relaunched within ~5s after Cmd+Q). 
hostMissingPrefixZh\tAntigravity App 未启用 --remote-debugging-port=0（或按 Cmd+Q 后约 5 秒清理未完成）。`;

export const CDP_DIAG_SHARED: Readonly<Record<string, string>> = Object.fromEntries(
    CDP_DIAG_RAW.split('\n').map(l => {
        const i = l.indexOf('\t');
        return [l.slice(0, i), l.slice(i + 1)];
    }),
);

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
        return `<div class="stg-diagnostic-hint" id="cdpDiagnosticHint" data-cdp-diagnostic="probing" role="status">${sHtml('cdpDiagProbingText')}</div>`;
    }
    const portEn = typeof cdpStatus?.discoveredPort === 'number' ? ` (port ${cdpStatus.discoveredPort})` : '';
    const portZh = typeof cdpStatus?.discoveredPort === 'number' ? `（端口 ${cdpStatus.discoveredPort}）` : '';
    const titleSuffix = cdpStatus?.targetTitle ? ` — ${cdpStatus.targetTitle}` : '';
    const errEn = cdpStatus?.errorMessage ? `: ${cdpStatus.errorMessage}` : '';
    const errZh = cdpStatus?.errorMessage ? `：${cdpStatus.errorMessage}` : '';
    const launcherInstalled = Boolean(cdpStatus?.launcherStatus?.installed);
    const resolvedPlatform = cdpStatus?.launcherStatus?.platform || activePlatform || cdpStatus?.platformGuide?.platform || 'darwin';
    const d = CDP_DIAG_SHARED;
    const fill = (tpl: string, port: string, err: string) =>
        tpl.replace('{port}', () => port).replace('{title}', () => titleSuffix).replace('{err}', () => err);

    const buildInstalledLauncherHint = (prefixEn: string, prefixZh: string): string => {
        const tailEn = resolvedPlatform === 'win32' ? d.winTailEn : resolvedPlatform === 'linux' ? d.linuxTailEn : d.darwinTailEn;
        const tailZh = resolvedPlatform === 'win32' ? d.winTailZh : resolvedPlatform === 'linux' ? d.linuxTailZh : d.darwinTailZh;
        return tBiHtml(`${prefixEn}${d.instPrefixEn}${tailEn}, then click Recheck CDP.`, `${prefixZh}${d.instPrefixZh}${tailZh}启动，再点「重新检测」。`);
    };

    const noLauncherStepsEn = `${d.hostMissingPrefixEn}${d.stepsEn}`;
    const noLauncherStepsZh = `${d.hostMissingPrefixZh}${d.stepsZh}`;

    let toneClass = 'is-warn';
    let messageHtml = '';
    switch (diagCode) {
        case 'connected':
            toneClass = 'is-good';
            messageHtml = tBiHtml(fill(d.connectedEn, portEn, errEn), fill(d.connectedZh, portZh, errZh));
            break;
        case 'port_unreachable':
            messageHtml = tBiHtml(fill(d.unreachableEn, portEn, errEn), fill(d.unreachableZh, portZh, errZh));
            break;
        case 'no_hub_target':
            messageHtml = tBiHtml(fill(d.noHubEn, portEn, errEn), fill(d.noHubZh, portZh, errZh));
            break;
        case 'ws_error':
            toneClass = 'is-error';
            messageHtml = tBiHtml(fill(d.wsErrorEn, portEn, errEn), fill(d.wsErrorZh, portZh, errZh));
            break;
        case 'eval_error':
            toneClass = 'is-error';
            messageHtml = tBiHtml(fill(d.evalErrorEn, portEn, errEn), fill(d.evalErrorZh, portZh, errZh));
            break;
        case 'host_missing_flag':
            messageHtml = launcherInstalled ? buildInstalledLauncherHint('', '') : tBiHtml(noLauncherStepsEn, noLauncherStepsZh);
            break;
        case 'missing_port_file':
        default:
            messageHtml = launcherInstalled
                ? buildInstalledLauncherHint(d.missingPrefixEn, d.missingPrefixZh)
                : tBiHtml(`${d.missingPrefixEn}${noLauncherStepsEn}`, `${d.missingPrefixZh}${noLauncherStepsZh}`);
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
        ? `<span class="stg-cdp-launcher-badge is-installed">${sHtml('cdpLauncherInstalledText')}</span>`
        : `<span class="stg-cdp-launcher-badge">${launcherStatus ? sHtml('cdpLauncherNotInstalledText') : tBiHtml('Not checked', '尚未检查')}</span>`;
    const setupLabelHtml = installed
        ? sHtml('cdpLauncherRecreateBtnText')
        : sHtml('cdpLauncherCreateBtnText');
    const revealLabelHtml = sHtml(getRevealLauncherKey(resolvedPlatform));
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

export function buildUpdateStatusPillHtml(
    currentVersion: string,
    updateStatus: UpdateStatusView | null | undefined,
    mode: 'settings' | 'about' = 'settings',
): { pillHtml: string; updateAvailable: boolean; latestTag: string | null } {
    const isAbout = mode === 'about';
    const curTag = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
    const rawLatest = updateStatus?.latestVersion?.trim() || null;
    const latestTag = rawLatest ? (rawLatest.startsWith('v') ? rawLatest : `v${rawLatest}`) : null;
    const updateAvailable = Boolean(
        updateStatus?.updateAvailable
        || updateStatus?.hasUpdate
        || updateStatus?.status === 'update_available',
    );
    const tipKey = isAbout ? 'about-update-status-pill' : 'settings-update-status-pill';
    const statusAttr = (st: string) => isAbout
        ? `data-about-update-status="${st}"`
        : `id="updateStatusPill" data-update-status="${st}"`;
    const fillVer = (k: string, v: string) => {
        const [en, zh] = STG_SHARED_PAIRS[k];
        return tBiHtml(en.replace('{ver}', () => v), zh.replace('{ver}', () => v));
    };
    const mkTip = (title: string, body: string, meta?: string) =>
        ` data-popover-key="${tipKey}" data-tip-title="${esc(title)}" data-tip-body="${esc(body)}"${meta ? ` data-tip-meta="${esc(meta)}"` : ''}`;
    if (updateAvailable && latestTag) {
        const [bEn, bZh] = STG_SHARED_PAIRS.updateTipBodyAvailableTpl;
        const tip = mkTip(
            sBi('updateTipTitleAvailable'),
            tBi(bEn.replace('{ver}', () => latestTag), bZh.replace('{ver}', () => latestTag)),
            sBi('updateTipMetaAvailable'),
        );
        return {
            updateAvailable: true,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-update" ${statusAttr('update_available')}${tip}>${fillVer('updateAvailablePillTpl', latestTag)}</span>`,
        };
    }
    if (updateStatus?.status === 'error') {
        const errDetail = updateStatus.error?.trim() || sBi('updateTipBodyErrorFallback');
        const tip = mkTip(sBi('updateTipTitleError'), errDetail, sBi('updateTipMetaError'));
        return {
            updateAvailable: false,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-error" ${statusAttr('error')}${tip}>${sHtml('checkFailedText')}</span>`,
        };
    }
    if (updateStatus?.status === 'up_to_date' || updateStatus?.status === 'not_modified' || (updateStatus?.checkedAt && !updateAvailable)) {
        const tip = mkTip(sBi('updateTipTitleOk'), sBi('updateTipBodyOk'));
        return {
            updateAvailable: false,
            latestTag,
            pillHtml: `<span class="stg-status-pill is-uptodate" ${statusAttr('up_to_date')}${tip}>${isAbout ? sHtml('aboutUpToDatePlainText') : fillVer('upToDatePillTpl', curTag)}</span>`,
        };
    }
    const tip = mkTip(sBi('updateTipTitleIdle'), sBi('updateTipBodyIdle'));
    return {
        updateAvailable: false,
        latestTag,
        pillHtml: `<span class="stg-status-pill" ${statusAttr('idle')}${tip}>${isAbout ? sHtml('aboutReadyText') : fillVer('currentVerPillTpl', curTag)}</span>`,
    };
}

function buildGlobalRulesCardHtml(
    grInput: GlobalRulesStatus | null | undefined,
    privacyMasked: boolean,
): string {
    const gr: GlobalRulesStatus = grInput ?? {
        path: '~/.gemini/GEMINI.md', exists: false, sizeBytes: 0, tooLarge: false, content: '',
    };
    const ex = Boolean(gr.exists);
    const tooLarge = Boolean(gr.tooLarge);
    const hasErr = Boolean(gr.error);
    // Safety guard: never inline GEMINI.md during SSR; lock Save until loaded when file exists.
    const loaded = !ex && !tooLarge && !hasErr;
    const displayPath = privacyMasked ? '~/.gemini/GEMINI.md' : (gr.path || '~/.gemini/GEMINI.md');
    const sizeLabel = formatFileSize(typeof gr.sizeBytes === 'number' && Number.isFinite(gr.sizeBytes) && gr.sizeBytes >= 0 ? gr.sizeBytes : 0);
    const stateClass = ex && !tooLarge && !hasErr ? 'is-ready' : 'is-missing';
    const stateLabelHtml = hasErr ? sHtml('grInvalidPathText')
        : tooLarge ? sHtml('grTooLargePillText')
            : ex ? tBiHtml('Ready', '已存在') : sHtml('grMissingText');
    const loadPrimary = ex && !tooLarge && !hasErr;
    const editorAttrs = (tooLarge || hasErr) ? ' disabled' : (ex ? ' readonly' : '');
    const ph = gr.error === 'SYMLINK_ESCAPE' ? sBi('grSymlinkErrorText')
        : tooLarge ? sBi('grTooLargeText')
            : ex ? sBi('grUnloadedPlaceholderText') : sBi('grEditablePlaceholderText');
    return `<details class="stg-card stg-group" id="globalRulesCard" data-settings-group="global-rules" data-accent="rules" data-gr-loaded="${loaded}" data-gr-exists="${ex}" data-gr-too-large="${tooLarge}" data-gr-max-bytes="${GLOBAL_RULES_MAX_BYTES}">
        <summary class="stg-header"><span class="stg-header-icon">${ICON.file}</span><span class="stg-group-label">${tBiHtml('Antigravity Global Rules', 'Antigravity 全局规则')}</span></summary>
        <span class="storage-path-state ${stateClass}" id="globalRulesState" data-gr-exists="${ex}" data-gr-too-large="${tooLarge}"${hasErr ? ` data-gr-error="${esc(gr.error!)}"` : ''}><span>${stateLabelHtml}</span></span>
        <p class="raw-desc">${tBiHtml('User-global instructions in ~/.gemini/GEMINI.md (never modifies workspace rules).', '全局指令文件 ~/.gemini/GEMINI.md（跨全部工作区生效，绝不修改工作区规则）。')}</p>
        <div class="storage-path-box"><code class="storage-path-text" id="globalRulesPathText" data-masked-path="~/.gemini/GEMINI.md">${esc(displayPath)}</code></div>
        <div class="storage-actions stg-globalrules-actions">
            <button type="button" class="action-btn${loadPrimary ? ' stg-btn-primary' : ''}" id="globalRulesReloadBtn" data-action="readGlobalRulesFile">${ICON.refresh} <span>${loadPrimary ? sHtml('grLoadEditBtnText') : sHtml('grReloadBtnText')}</span></button>
            <button type="button" class="action-btn" id="globalRulesOpenBtn" data-action="openGlobalRulesFile">${ICON.file} <span>${tBiHtml('Open File', '打开文件')}</span></button>
            <button type="button" class="action-btn" id="globalRulesRevealBtn" data-action="revealGlobalRulesFile">${ICON.folder} <span>${tBiHtml('Reveal', '定位文件')}</span></button>
            <button type="button" class="action-btn${loaded ? ' stg-btn-primary' : ''}" id="globalRulesSaveBtn" data-action="saveGlobalRulesFile"${loaded ? '' : ' disabled aria-disabled="true" data-gr-save-locked="true"'}><span>${tBiHtml('Save', '保存')}</span></button>
            <span id="globalRulesFeedback" class="threshold-feedback" role="status"></span>
        </div>
        <textarea id="globalRulesEditor" class="stg-globalrules-editor" rows="8" spellcheck="false" aria-label="${esc(tBi('Antigravity Global Rules', 'Antigravity 全局规则'))}" placeholder="${esc(ph)}"${editorAttrs}></textarea>
        <div class="storage-stat-grid">
            <div class="storage-stat"><span class="storage-stat-val" id="globalRulesSizeVal">${esc(sizeLabel)}</span><span class="storage-stat-label">${tBiHtml('File Size', '文件大小')}</span></div>
            <div class="storage-stat"><span class="storage-stat-val">${tBiHtml('All workspaces', '全部工作区')}</span><span class="storage-stat-label">${tBiHtml('Scope', '范围')}</span></div>
        </div>
        <p class="stg-hint-note">${tBiHtml('On-demand load · 200 KiB cap · symlink-safe · idea by @gitstq.', '按需读取 · 200 KiB 上限 · 防符号链接越界 · 灵感来自 @gitstq。')}</p>
    </details>`;
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
    const mergedRaw: MonitorDocumentSettingsInput = {
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
    const appShowNativeHudBar = resolved.appShowNativeHudBar ?? resolved.showNativeHudBar ?? true;
    const ideShowNativeHudBar = resolved.ideShowNativeHudBar ?? (isAppSidecar ? false : (resolved.showNativeHudBar ?? false));
    const activeSurfaceHudEnabled = isAppSidecar ? appShowNativeHudBar : ideShowNativeHudBar;
    const nativeHudAutoHideOnOverview = resolved.nativeHudAutoHideOnOverview ?? true;
    const languagePreference = resolved.languagePreference ?? 'auto';
    const contextPctBasis: ContextDisplayBasis = resolved.contextPctBasis === 'native' ? 'native' : 'compaction';
    const speedMetricMode: SpeedDisplayMode = resolved.speedMetricMode === 'e2e' ? 'e2e' : 'decode';
    const quotaWindowMode: QuotaWindowMode = resolved.quotaWindowMode ?? '5h';
    const quotaDirectionMode: QuotaDirectionMode = resolved.quotaDirectionMode === 'used' ? 'used' : 'remaining';
    const cdpOverlayFontSize = resolved.cdpOverlayFontSize ?? 'normal';
    const cdpOverlayHighContrast = !!resolved.cdpOverlayHighContrast;
    const appOnboardingDismissed = Boolean(resolved.appOnboardingDismissed);
    const privacyMasked = options?.privacyMasked !== false;
    const orchestratorPricingMode: OrchestratorPricingMode = resolved.orchestratorPricingMode === 'strict' ? 'strict' : 'mapped';
    const displayCurrency: CurrencyCode = normalizeCurrency(resolved.displayCurrency, 'USD');
    const hasExplicitBoundCurrency = Object.prototype.hasOwnProperty.call(mergedRaw, 'customFxCurrency')
        && mergedRaw.customFxCurrency !== undefined;
    const resolvedFx = resolveAppCurrencyConfig({
        displayCurrency,
        customFxRate: resolved.customFxRate ?? null,
        ...(hasExplicitBoundCurrency ? { customFxCurrency: resolved.customFxCurrency } : {}),
    });
    const customFxRate = resolvedFx.isCustomRate ? resolvedFx.ratePerUsd : null;
    const boundFxCurrency = resolvedFx.customFxCurrency;
    const subscriptionPlan: SubscriptionPlanPresetId = resolved.subscriptionPlan ?? 'none';
    const subscriptionMonthlyFee = resolved.subscriptionMonthlyFee ?? null;
    const subscriptionCurrency: CurrencyCode = normalizeCurrency(resolved.subscriptionCurrency, 'USD');
    const calendarRetentionDays = resolved.calendarRetentionDays ?? 400;
    const autoCheckUpdates = resolved.autoCheckUpdates ?? true;
    const activityMaxRecentSteps = resolved.activityMaxRecentSteps ?? resolved.maxRecentSteps ?? 100;
    const activityMaxArchives = resolved.activityMaxArchives ?? resolved.maxArchives ?? 20;

    const resolvedZoom = clampNumber(options?.zoomLevel, 100, 60, 150);
    const currentVersion = (options?.version && options.version.trim()) || options?.updateStatus?.currentVersion || resolveRuntimeVersion();
    const activePlatform = options?.cdpStatus?.launcherStatus?.platform
        || options?.cdpStatus?.platformGuide?.platform
        || (typeof process !== 'undefined' ? process.platform : 'darwin');

    const tabScrollHintEnabled = panelPrefs?.showTabScrollHint ?? true;
    const showScrollbar = panelPrefs?.showScrollbar ?? false;
    const showEndOfContent = panelPrefs?.showEndOfContent ?? true;
    const stateFileSizeLabel = storage ? formatFileSize(storage.stateFileSizeBytes) : '0 B';
    const ideOnlyDisabledAttr = isAppSidecar ? ' disabled aria-disabled="true"' : '';

    // ── Shared Rich-Tip Attributes ──
    const stgTipsCatalog = `nativeHud\tsettings-tip-native-hud\tNative Panel Compact HUD\t面板顶部紧凑状态条 (HUD)\tPins a compact strip atop this panel (split for App vs IDE, no CDP).\t固定在面板顶部的紧凑状态条（App 与 IDE 独立开关，无需 CDP）。
composerRing\tsettings-tip-composer-ring\tComposer Context Ring (CDP)\t输入框上下文圆环（需 CDP）\tRead-only ring beside the chat input when CDP is enabled.\t开启 CDP 后在输入框旁显示的只读上下文环。
topBarOverlay\tsettings-tip-topbar-overlay\tTop-Right Status Bar & Quota Board (CDP)\t右上角状态栏与配额看板（需 CDP）\tRead-only floating capsule and quota board in the top-right corner.\t主窗口右上角悬浮的只读状态胶囊与配额看板。
orchMapped\tsettings-tip-orch-mapped\tMapped Base Mode\t按底座估算模式\tEstimates fixed Orchestrator models via underlying base official API rate.\t按对应底座官方单价估算固定编排模型参考费用。
orchStrict\tsettings-tip-orch-strict\tStrict Pricing Mode\t严格计价模式\tMarks fixed Orchestrator models Unpriced until custom rates are entered.\t填写自定义单价前将固定编排模型标记为未定价。
customFx\tsettings-tip-custom-fx\tCustom FX Rate (Currency-Bound)\t自定义汇率（绑定当前币种）\tRate per 1 USD bound strictly to the selected currency.\t每 1 USD 汇率，严格绑定至当前币种。
subRoi\tsettings-tip-subscription-roi\tSubscription Plan (ROI Reference)\t订阅方案（ROI 参考）\tCompares API reference value vs prorated fee in Advanced ROI.\t在可折叠高级 ROI 区对比等效 API 参考值与订阅月费。
calRetention\tsettings-tip-calendar-retention\tCalendar Retention (Days)\t日历历史保留天数\tDaily usage archive retention limit (30–3,650 days).\t每日用量归档保留天数上限（30–3,650 天）。
maxRecentSteps\tsettings-tip-max-recent-steps\tMax Recent Activity Steps\t最近活动步骤上限\tMax recent timeline steps in Model Calls (10–500).\t模型调用时间线保留的最近步骤上限（10–500）。
maxArchives\tsettings-tip-max-archives\tMax Archived Activity Sessions\t活动归档会话上限\tMax past conversation activity archives (1–100).\t本地保留的过往会话活动归档份数上限（1–100）。
panelTips\tsettings-tip-panel-tips\tTab-Bar Scroll Hint\t顶栏横向滚动提示\tControls the top tab-bar horizontal scroll hint in narrow side panes.\t控制顶部标签导航栏的横向滚动提示（窄侧栏中方便发现更多视图）。
cacheHit\tsettings-tip-cache-hit\tPrompt Cache Hit Rate\t提示词缓存命中率\tShows the percentage of prompt tokens served from provider cache in the IDE status bar.\t在 IDE 状态栏中显示提示词缓存复用占比。
hoverDensity\tsettings-tip-hover-density\tIDE Status Bar Hover Density\tIDE 状态栏悬停摘要密度\tControls how many detail sections appear when hovering the IDE status bar item.\t控制鼠标悬停在 IDE 状态栏上时展示的摘要详细程度。
polling\tsettings-tip-polling-interval\tPolling Interval\t轮询间隔\tLocal service polling interval (1–60s).\t本地服务轮询间隔（1–60 秒）。
lockMain\tsettings-tip-lock-main-agent\tLock to Main Agent\t锁定主会话\tAnchors focus on the main root conversation.\t锚定跟踪主根会话，忽略后台子智能体。
modelInternalId\tsettings-tip-model-internal-id\tShow Model Internal ID\t显示模型内部 ID\tAppends internal catalog ID next to model names.\t在模型名称旁附加内部目录短编号。`;
    const stgTip: Record<string, string> = {};
    for (const row of stgTipsCatalog.split('\n')) {
        const [k, pKey, tEn, tZh, bEn, bZh] = row.split('\t');
        stgTip[k] = stgRichTipAttrs(pKey, tEn, tZh, bEn, bZh);
    }
    const nativeHudTip = stgTip.nativeHud;
    const composerRingTip = stgTip.composerRing;
    const topBarOverlayTip = stgTip.topBarOverlay;
    const orchMappedTip = stgTip.orchMapped;
    const orchStrictTip = stgTip.orchStrict;
    const customFxTip = stgTip.customFx;
    const subRoiTip = stgTip.subRoi;
    const calRetentionTip = stgTip.calRetention;
    const maxRecentStepsTip = stgTip.maxRecentSteps;
    const maxArchivesTip = stgTip.maxArchives;
    const renderToggleRow = (id: string, checked: boolean, labelHtml: string, inputAttrs = '', labelAttrs = ''): string =>
        `<label class="toggle-row"${labelAttrs}><input type="checkbox" id="${id}" class="toggle-cb"${inputAttrs}${checked ? ' checked' : ''} /><span class="toggle-track"><span class="toggle-thumb"></span></span><span>${labelHtml}</span></label>`;
    const renderSelectField = (
        id: string,
        settingKey: string,
        feedbackId: string,
        labelHtml: string,
        opts: ReadonlyArray<readonly [string, string]>,
        selected: string,
    ): string => `<div class="stg-field"><label for="${id}">${labelHtml}</label><select id="${id}" class="stg-select" data-app-setting="${settingKey}" data-feedback-id="${feedbackId}">${opts.map(([v, txt]) => `<option value="${v}"${selected === v ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select></div>`;

    const renderNumSpinner = (
        id: string,
        val: number,
        min: number,
        max: number,
        step: number,
        decLabel: string,
        incLabel: string,
        extraInputAttrs = '',
        withTarget = true,
    ): string => {
        const tgt = withTarget ? ` data-target="${id}"` : '';
        return `<div class="num-spinner"><button type="button" class="num-spinner-btn decrement"${tgt} aria-label="${esc(decLabel)}">−</button><input type="number" id="${id}" class="threshold-input" ${extraInputAttrs} value="${val}" min="${min}" max="${max}" step="${step}" /><button type="button" class="num-spinner-btn increment"${tgt} aria-label="${esc(incLabel)}">+</button></div>`;
    };
    const buildCurrencyOptions = (selected: CurrencyCode): string => CURRENCY_CODES.map((code) => {
        const p = CURRENCY_PRESETS[code];
        return `<option value="${code}"${selected === code ? ' selected' : ''}>${esc(`${code} — ${tBi(p.nameEn, p.nameZh)}`)}</option>`;
    }).join('');

    const zoomPresetButtons = [80, 90, 100, 110, 120, 130]
        .map(pct => `<button type="button" class="preset-btn zoom-preset${resolvedZoom === pct ? ' is-active' : ''}" data-zoom="${pct}">${pct}%</button>`)
        .join('\n                    ');

    const statusBarTitleHtml = isAppSidecar
        ? tBiHtml('Antigravity IDE Status Bar', 'Antigravity IDE 状态栏')
        : tBiHtml('Status Bar Display', '状态栏显示');
    const statusBarDescHtml = isAppSidecar
        ? tBiHtml(
            'These status bar toggles apply to the Antigravity IDE extension.',
            '以下状态栏开关仅对 Antigravity IDE 扩展生效。',
        )
        : tBiHtml(
            'Toggle which elements appear in the status bar.',
            '控制状态栏显示哪些元素。',
        );

    // ── Group 1: Display & Language ──
    const group1DisplayLanguage = `
        <details class="stg-card stg-group" id="settingsGroupDisplay" data-settings-group="display-language" data-accent="display">
            <summary class="stg-header">
                <span class="stg-header-icon">${ICON.zoom}</span>
                <span class="stg-group-label">${tHtml('settings.group.general')}</span>
            </summary>
            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="languagePreferenceSelect">${tHtml('settings.languagePreference')}</label>
                    <select id="languagePreferenceSelect" class="stg-select" data-app-setting="languagePreference" data-feedback-id="languagePreferenceFeedback">
                        <option value="auto"${languagePreference === 'auto' ? ' selected' : ''}>${esc(tBi('Auto (Follow System)', '自动（跟随系统）'))}</option>
                        <option value="en"${languagePreference === 'en' ? ' selected' : ''}>English</option>
                        <option value="zh"${languagePreference === 'zh' ? ' selected' : ''}>简体中文</option>
                        <option value="both"${languagePreference === 'both' ? ' selected' : ''}>${esc(tBi('Bilingual (EN + ZH)', '中英双语'))}</option>
                    </select>
                </div>
            </div>
            <p class="stg-hint-note">${tHtml('settings.narrowCompactNote')}</p>

            <div class="stg-divider"></div>

            <div class="toggle-group">
                ${renderToggleRow('toggleNativeHudBar', activeSurfaceHudEnabled, isAppSidecar ? tHtml('settings.hudApp') : tHtml('settings.hudIde'), ` data-app-setting="${isAppSidecar ? 'appShowNativeHudBar' : 'ideShowNativeHudBar'}" data-feedback-id="languagePreferenceFeedback"`, nativeHudTip)}
                ${renderToggleRow(isAppSidecar ? 'toggleIdeNativeHudBar' : 'toggleAppNativeHudBar', isAppSidecar ? ideShowNativeHudBar : appShowNativeHudBar, isAppSidecar ? tHtml('settings.hudIde') : tHtml('settings.hudApp'), ` data-app-setting="${isAppSidecar ? 'ideShowNativeHudBar' : 'appShowNativeHudBar'}" data-feedback-id="languagePreferenceFeedback"`)}
                ${renderToggleRow('toggleNativeHudAutoHide', nativeHudAutoHideOnOverview, `${tHtml('settings.hudAutoHideOverview')} (${tBiHtml('uncheck to Always Show', '取消勾选以始终显示')})`, ' data-app-setting="nativeHudAutoHideOnOverview" data-feedback-id="languagePreferenceFeedback"')}
                <span id="languagePreferenceFeedback" class="threshold-feedback" role="status"></span>
            </div>

            <div class="stg-divider"></div>

            <div class="setting-row">
                <label for="zoomRange">${tBiHtml('Interface Zoom', '界面缩放')}</label>
                <div class="zoom-control">
                    <div class="zoom-presets">${zoomPresetButtons}</div>
                    <div class="zoom-slider-row">
                        <input type="range" id="zoomRange" class="zoom-range" aria-label="${esc(tBi('Interface zoom', '界面缩放'))}" min="60" max="150" step="5" value="${resolvedZoom}" />
                        <span class="zoom-value" id="zoomValue">${resolvedZoom}%</span>
                    </div>
                </div>
            </div>

            <div class="toggle-group">
                ${renderToggleRow('toggleScrollbar', showScrollbar, tBiHtml('Show scrollbar', '显示滚动条'))}
                ${renderToggleRow('toggleEndOfContent', showEndOfContent, tBiHtml('Show "end of content" indicator', '显示「已到底」提示'))}
            </div>

            <div class="storage-actions" style="margin-top:8px">
                <button type="button" class="action-btn" id="restoreTabScrollHint"${stgTip.panelTips}>${ICON.refresh} <span>${tBiHtml('Show Hint Now', '立即显示一次提示')}</span></button>
                <span class="storage-path-state ${tabScrollHintEnabled ? 'is-ready' : 'is-missing'}" id="tabHintState"><span>${tabScrollHintEnabled ? sHtml('tabHintEnabledText') : sHtml('tabHintDisabledText')}</span></span>
                <span id="panelHintFeedback" class="threshold-feedback" role="status"></span>
            </div>

            <div class="stg-divider"></div>

            <details id="settings-ide-status-bar" class="stg-card-details${isAppSidecar ? ' is-ide-only' : ''}" data-surface-scope="ide-only" data-state-key="settings-ide-status-bar"${isAppSidecar ? '' : ' open'}>
                <summary class="stg-header stg-card-summary">
                    <span class="stg-header-icon">${ICON.chart}</span>
                    <h3>${statusBarTitleHtml}</h3>
                    ${isAppSidecar ? `<span class="stg-ide-only-badge">${tBiHtml('IDE Only', '仅 IDE')}</span>` : ''}
                </summary>
                <div class="stg-card-details-body">
                    <p class="raw-desc">${statusBarDescHtml}</p>
                    <div class="toggle-group">
                        ${renderToggleRow('toggleContext', showContext, `${tBiHtml('Context usage', '上下文用量')} <code>45k/1M</code>`, ideOnlyDisabledAttr)}
                        ${renderToggleRow('toggleQuota', showQuota, `${tBiHtml('Quota remaining', '剩余配额')} <code>85%</code>`, ideOnlyDisabledAttr)}
                        ${renderToggleRow('toggleCountdown', showResetCountdown, `${tBiHtml('Reset countdown', '重置倒计时')} <code>4h32m</code>`, ideOnlyDisabledAttr)}
                        ${renderToggleRow('toggleAiCredits', showAiCredits, `${tBiHtml('AI Credits balance', 'AI 积分余额')} <code>14,701</code>`, ideOnlyDisabledAttr)}
                        ${renderToggleRow('toggleSpeed', showSpeed, `${tBiHtml('Generation speed', '生成速度')} <code>64 tok/s</code>`, ideOnlyDisabledAttr)}
                        ${renderToggleRow('toggleCacheHit', showCacheHit, `${tBiHtml('Prompt cache hit rate', '提示词缓存命中率')} <code>Cache 84%</code>`, ideOnlyDisabledAttr, stgTip.cacheHit)}
                        ${renderToggleRow('toggleSessionCost', showSessionCost, `${tBiHtml('Session cost', '当前会话费用')} <code>$0.27</code>`, ideOnlyDisabledAttr)}
                    </div>
                    <label class="stg-select-row" for="statusTooltipDensity"${stgTip.hoverDensity}>
                        <span>${tBiHtml('Hover density', '悬停摘要密度')}</span>
                        <select id="statusTooltipDensity"${ideOnlyDisabledAttr}>
                            <option value="auto"${tooltipDensity === 'auto' ? ' selected' : ''}>${esc(tBi('Automatic', '自动'))}</option>
                            <option value="compact"${tooltipDensity === 'compact' ? ' selected' : ''}>${esc(tBi('Compact', '精简'))}</option>
                            <option value="full"${tooltipDensity === 'full' ? ' selected' : ''}>${esc(tBi('Full', '完整'))}</option>
                        </select>
                    </label>
                </div>
            </details>
        </details>`;

    // ── Group 2: Telemetry & Metrics ──
    const group2TelemetryMetrics = `
        <details class="stg-card stg-group" id="settingsGroupTelemetry" data-settings-group="telemetry-metrics" data-accent="poll">
            <summary class="stg-header">
                <span class="stg-header-icon">${ICON.clock}</span>
                <span class="stg-group-label">${tHtml('settings.group.telemetry')}</span>
            </summary>
            <div class="stg-form-grid">
                ${renderSelectField('contextPctBasisSelect', 'contextPctBasis', 'telemetryMetricsFeedback', tBiHtml('Context % Basis', '上下文百分比基准'), [['compaction', tBi('Compaction Limit', '自动压缩上限')], ['native', tBi('Native Window Limit', '原生窗口上限')]], contextPctBasis)}
                ${renderSelectField('speedMetricModeSelect', 'speedMetricMode', 'telemetryMetricsFeedback', tBiHtml('Speed Mode', '速度指标口径'), [['decode', tBi('Decode Speed', '生成解码速度')], ['e2e', tBi('Model-Call E2E', '模型调用 E2E 速度')]], speedMetricMode)}
                ${renderSelectField('quotaWindowModeSelect', 'quotaWindowMode', 'telemetryMetricsFeedback', tBiHtml('Quota Window', '配额窗口'), [['5h', t('quota.window5h')], ['7d', t('quota.window7d')], ['tightest', t('quota.windowTightest')]], quotaWindowMode)}
                ${renderSelectField('quotaDirectionModeSelect', 'quotaDirectionMode', 'telemetryMetricsFeedback', tBiHtml('Quota Direction', '配额显示方向'), [['remaining', tBi('Remaining %', '剩余配额 %')], ['used', tBi('Used %', '已用配额 %')]], quotaDirectionMode)}
            </div>
            <span id="telemetryMetricsFeedback" class="threshold-feedback" role="status"></span>

            <div class="stg-divider"></div>

            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="pollingInput"${stgTip.polling}>${tBiHtml('Polling interval (seconds)', '轮询间隔（秒）')}</label>
                    <div class="threshold-input-row">
                        ${renderNumSpinner('pollingInput', pollingInterval, 1, 60, 1, tBi('Decrease polling interval', '减小轮询间隔'), tBi('Increase polling interval', '增大轮询间隔'))}
                        <button type="button" class="action-btn" id="pollingSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                        <span id="pollingFeedback" class="threshold-feedback" role="status"></span>
                    </div>
                </div>
                <div class="stg-field">
                    <label for="quotaNotifyInput">${tBiHtml('Low quota warning threshold (%)', '低配额警告阈值（%）')}</label>
                    <div class="threshold-input-row">
                        ${renderNumSpinner('quotaNotifyInput', quotaNotifyThreshold, 0, 99, 5, tBi('Decrease quota warning threshold', '降低配额警告阈值'), tBi('Increase quota warning threshold', '提高配额警告阈值'), '', false)}
                        <button type="button" class="action-btn" id="quotaNotifySaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                        <span id="quotaNotifyFeedback" class="threshold-feedback" role="status"></span>
                    </div>
                </div>
            </div>

            <div class="toggle-group" style="margin-top:10px">
                ${renderToggleRow('toggleLockMainAgent', lockToMainAgent, tBiHtml('Lock to Main Agent (ignore background subagents)', '锁定主会话（忽略后台子智能体）'), '', stgTip.lockMain)}
                ${renderToggleRow('toggleModelInternalId', showModelInternalId, `${tBiHtml('Show model internal ID', '显示模型内部 ID')} <code>(M16)</code>`, '', stgTip.modelInternalId)}
            </div>

            <div class="stg-form-grid" style="margin-top:10px">
                <div class="stg-field">
                    <label for="activityMaxRecentStepsInput"${maxRecentStepsTip}>${tBiHtml('Max recent activity steps', '最近活动步骤上限')}</label>
                    <div class="threshold-input-row">
                        ${renderNumSpinner('activityMaxRecentStepsInput', activityMaxRecentSteps, 10, 500, 10, tBi('Decrease max recent activity steps', '减小最近活动步骤上限'), tBi('Increase max recent activity steps', '增大最近活动步骤上限'), 'data-app-setting="activityMaxRecentSteps" data-setting-type="int" data-feedback-id="activityMaxRecentStepsFeedback"')}
                        <span id="activityMaxRecentStepsFeedback" class="threshold-feedback" role="status"></span>
                    </div>
                </div>
                <div class="stg-field">
                    <label for="activityMaxArchivesInput"${maxArchivesTip}>${tBiHtml('Max archived activity sessions', '活动归档会话上限')}</label>
                    <div class="threshold-input-row">
                        ${renderNumSpinner('activityMaxArchivesInput', activityMaxArchives, 1, 100, 5, tBi('Decrease max archived activity sessions', '减小活动归档会话上限'), tBi('Increase max archived activity sessions', '增大活动归档会话上限'), 'data-app-setting="activityMaxArchives" data-setting-type="int" data-feedback-id="activityMaxArchivesFeedback"')}
                        <span id="activityMaxArchivesFeedback" class="threshold-feedback" role="status"></span>
                    </div>
                </div>
            </div>
        </details>`;

    // ── Group 3: Currency & Pricing ──
    const currencyOptionsHtml = buildCurrencyOptions(displayCurrency);
    const subCurrencyOptionsHtml = buildCurrencyOptions(subscriptionCurrency);
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

    const group3CurrencyPricing = `
        <details class="stg-card stg-group" id="costCurrencyHistoryCard" data-settings-group="currency-pricing" data-accent="history">
            <summary class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <span class="stg-group-label">${tBiHtml('Currency & Pricing', '币种与费用计价')}</span>
            </summary>
            <div class="stg-form-grid">
                <div class="stg-field">
                    <label for="displayCurrencySelect">${tBiHtml('Display currency', '显示币种')}</label>
                    <select id="displayCurrencySelect" class="stg-select" data-app-setting="displayCurrency" data-feedback-id="customFxRateFeedback">
                        ${currencyOptionsHtml}
                    </select>
                </div>
                <div class="stg-field">
                    <label for="customFxRateInput"${customFxTip}>${tBiHtml('Custom FX rate (per 1 USD)', '自定义汇率（每 1 USD）')}</label>
                    <input type="number" id="customFxRateInput" class="threshold-input"
                           data-app-setting="customFxRate" data-setting-type="nullable-float" data-custom-fx-currency="${esc(boundFxCurrency || '')}" data-feedback-id="customFxRateFeedback"
                           min="0.0001" max="100000" step="0.01"
                           value="${customFxRate !== null ? esc(String(customFxRate)) : ''}"
                           placeholder="${esc(defaultFxPlaceholder)}" />
                    <span id="customFxRateFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
            <p class="stg-hint-note">${tBiHtml('Custom FX rate is bound to the selected currency; leave blank for the built-in reference rate.', '自定义汇率绑定至当前币种，切换币种时不会误沿用旧汇率；留空使用内置参考汇率。')}</p>

            <div class="stg-divider"></div>

            <div class="setting-row">
                <label>${tBiHtml('Orchestrator pricing mode', '编排模型计费模式')}</label>
                <div class="stg-seg-group" role="radiogroup" aria-label="${esc(tBi('Orchestrator pricing mode', '编排模型计费模式'))}">
                    <button type="button" class="stg-seg-btn${orchestratorPricingMode === 'mapped' ? ' is-active' : ''}" id="stgOrchModeMapped" data-action="setOrchestratorPricingMode" data-mode="mapped" role="radio" aria-checked="${orchestratorPricingMode === 'mapped' ? 'true' : 'false'}"${orchMappedTip}>${tBiHtml('Mapped Base', '按底座估算')}</button>
                    <button type="button" class="stg-seg-btn${orchestratorPricingMode === 'strict' ? ' is-active' : ''}" id="stgOrchModeStrict" data-action="setOrchestratorPricingMode" data-mode="strict" role="radio" aria-checked="${orchestratorPricingMode === 'strict' ? 'true' : 'false'}"${orchStrictTip}>${tBiHtml('Strict', '严格模式')}</button>
                </div>
                <span id="orchPricingModeFeedback" class="threshold-feedback" role="status"></span>
            </div>

            <div class="stg-divider"></div>

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
            <p class="stg-hint-note">${tBiHtml('API Equivalent Reference Ratio, Not Actual Bill — Plan ROI is shown inside the collapsible Advanced section of Usage & Cost.', 'API 等效参考比，非实际账单 —— 订阅方案 ROI 参考已收敛至「用量与费用」页可折叠高级区。')}</p>
        </details>`;

    // ── Group 4: Overlays & CDP ──
    const cdpPillHtml = buildCdpStatusPillHtml(options?.cdpStatus, appComposerRingEnabled, appTopBarEnabled);
    const cdpDiagnosticHintHtml = buildCdpDiagnosticHintHtml(options?.cdpStatus, appComposerRingEnabled, appTopBarEnabled, activePlatform);
    const cdpLauncherRowHtml = buildCdpLauncherRowHtml(options?.cdpStatus?.launcherStatus, activePlatform);
    const macWaitLaunchCmd = `while pgrep -f '^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`;
    const winPsCmd = '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    const winCmdShortcut = '"%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    const linuxLaunchCmd = 'antigravity --remote-debugging-port=0';

    const showResetOnboardingBtn = isAppSidecar && appOnboardingDismissed && options?.cdpStatus?.state !== 'connected';
    const group4OverlaysCdp = `
        <details class="stg-card stg-group" id="settings-cdp-card" data-settings-group="overlays-cdp" data-accent="display">
            <summary class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <span class="stg-group-label">${tHtml('settings.group.overlays')}</span>
            </summary>
            <div id="appOverlaysCard">
            ${cdpPillHtml}
            <p class="raw-desc">${tBiHtml(
        'Optional desktop overlays mount read-only Shadow DOM widgets via local Chrome DevTools Protocol (CDP) without modifying app.asar or host binaries.',
        '可选桌面悬浮层仅在开启本机 Chrome 调试端口（CDP）后挂载只读 Shadow DOM 组件，零 app.asar 或宿主二进制修改。',
    )}</p>
            <div class="toggle-group">
                ${renderToggleRow('toggleAppComposerRing', appComposerRingEnabled, tBiHtml('Composer Context Ring — Left of Turbo (CDP)', '输入框上下文环（Turbo 按钮左侧，需 CDP）'), ' data-app-setting="appComposerRingEnabled" data-feedback-id="appOverlaysFeedback"', composerRingTip)}
                ${renderToggleRow('toggleAppTopBar', appTopBarEnabled, tBiHtml('Top-Right Status Bar & Quota Board (CDP)', '右上角常驻状态栏与配额看板（需 CDP）'), ' data-app-setting="appTopBarEnabled" data-feedback-id="appOverlaysFeedback"', topBarOverlayTip)}
                ${renderToggleRow('toggleCdpOverlayHighContrast', cdpOverlayHighContrast, tBiHtml('Overlay High Contrast preset', '悬浮层高对比度档位'), ' data-app-setting="cdpOverlayHighContrast" data-feedback-id="appOverlaysFeedback"')}
            </div>
            <div class="stg-form-grid" style="margin-top:8px">
                ${renderSelectField('cdpOverlayFontSizeSelect', 'cdpOverlayFontSize', 'appOverlaysFeedback', tBiHtml('Overlay font size', '悬浮层字号档位'), [['compact', tBi('Compact', '紧凑')], ['normal', tBi('Normal', '标准')], ['large', tBi('Large', '放大')]], cdpOverlayFontSize)}
            </div>
            ${cdpDiagnosticHintHtml}
            <div class="storage-actions stg-cdp-actions">
                <button type="button" class="action-btn" id="cdpRecheckBtn" data-action="recheckCdp">${ICON.refresh} <span>${tBiHtml('Recheck CDP', '重新检测')}</span></button>
                ${isAppSidecar ? `<button type="button" class="action-btn" id="settingsResetOnboardingBtn" data-action="resetAppOnboarding"${showResetOnboardingBtn ? '' : ' hidden'}><span>${tBiHtml('Show Overview Setup Tip', '在概览重新显示引导')}</span></button>` : ''}
                <span id="appOverlaysFeedback" class="threshold-feedback" role="status"></span>
            </div>
            ${cdpLauncherRowHtml}
            <details id="settings-cdp-guide" class="stg-guide-details" data-state-key="settings-cdp-guide">
                <summary>${tBiHtml('Technical details & manual terminal CDP launch guide (macOS / Windows / Linux)', '技术原理与手动终端 CDP 启动指引（macOS / Windows / Linux）')}</summary>
                <div class="stg-guide-body">
                    <p>${tBiHtml(
        'How it works: overlays mount read-only Shadow DOM widgets via Chrome DevTools Protocol (DevToolsActivePort) — zero app.asar or host binary modification, local loopback only.',
        '实现原理：通过 Chrome 调试协议（DevToolsActivePort）挂载只读 Shadow DOM 悬浮组件——零 app.asar 或宿主二进制修改，仅使用本机回环接口。',
    )}</p>
                    <p class="stg-guide-step">${tBiHtml(
        'Step 1 — Quit Antigravity App completely first (macOS: Cmd+Q and wait ~5s for background teardown; Windows/Linux: close all windows & tray icon).',
        '第一步 — 先完全退出 Antigravity App（macOS 按 Cmd+Q 后等待约 5 秒后台清理；Windows/Linux 关闭所有窗口及托盘图标）。',
    )}</p>
                    <p class="stg-guide-step">${tBiHtml(
        'Step 2 — Relaunch Antigravity App with --remote-debugging-port=0, then click Recheck CDP:',
        '第二步 — 使用 --remote-debugging-port=0 重启 Antigravity App，然后点击「重新检测」：',
    )}</p>
                    <div class="stg-code-list">${([
                        ['darwin', 'macOS (Terminal — race-free wait &amp; launch)', macWaitLaunchCmd, 'Copy macOS command', '复制 macOS 命令'],
                        ['win32', 'Windows (PowerShell)', winPsCmd, 'Copy Windows PowerShell command', '复制 Windows PowerShell 命令'],
                        ['win32', 'Windows (CMD / Shortcut)', winCmdShortcut, 'Copy Windows CMD command', '复制 Windows CMD 命令'],
                        ['linux', 'Linux', linuxLaunchCmd, 'Copy Linux command', '复制 Linux 命令'],
                    ] as const).map(([plat, title, cmd, ariaEn, ariaZh]) =>
                        `<div class="stg-code-item${activePlatform === plat ? ' is-current-platform' : ''}"><div class="stg-code-item-head"><strong>${title}</strong><button type="button" class="action-btn cdp-copy-btn" data-copy-command="${esc(cmd)}" aria-label="${esc(tBi(ariaEn, ariaZh))}">${ICON.copy} <span>${tBiHtml('Copy', '复制')}</span></button></div><code>${esc(cmd)}</code></div>`,
                    ).join('')}</div>
                    <p class="stg-guide-note">${tBiHtml(
        'Dock & Taskbar tips: macOS drag "Antigravity (CDP).app" from Finder into Dock (never choose "Keep in Dock" on the running icon); Windows right-click .lnk to Pin to Taskbar; Linux pin "Antigravity (CDP)" from launcher to Ubuntu Dock.',
        '固定到 Dock / 任务栏提示：macOS 请从访达拖入程序坞（切勿选「在程序坞中保留」）；Windows 右键 .lnk 原生「固定到任务栏」；Linux 从应用启动器固定到 Ubuntu Dock。',
    )}</p>
                </div>
            </details>
            </div>
        </details>`;

    // ── Group 5: Data, Backup & Diagnostics ──
    const updateInfo = buildUpdateStatusPillHtml(currentVersion, options?.updateStatus);
    const storageSectionHtml = storage ? `
            <div class="stg-divider"></div>
            <div class="setting-row">
                <label>${tBiHtml('Persistent Storage', '持久化存储')}</label>
                <div class="storage-path-box">
                    <code class="storage-path-text">${esc(storage.stateFilePath)}</code>
                    <span class="storage-path-state ${storage.stateFileExists ? 'is-ready' : 'is-missing'}"><span>${storage.stateFileExists ? tBiHtml('Ready', '已存在') : tBiHtml('Missing', '不存在')}</span></span>
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
            </div>` : '';

    const group5DataBackupDiag = `
        <details class="stg-card stg-group" id="settingsBackupCard" data-settings-group="data-backup-diagnostics" data-accent="storage">
            <summary class="stg-header">
                <span class="stg-header-icon">${ICON.database}</span>
                <span class="stg-group-label">${tHtml('settings.group.backupDiag')}</span>
            </summary>
            <div class="setting-row" data-backup-diagnostics="true">
                <label>${tBiHtml('Settings Backup & Redacted Diagnostics', '设置备份与脱敏诊断包')}</label>
                <div class="storage-actions">
                    <button type="button" class="action-btn" id="exportSettingsBackupBtn" data-action="exportSettingsBackup">${ICON.file} <span>${tHtml('settings.exportJsonBackup')}</span></button>
                    <button type="button" class="action-btn" id="importSettingsBackupBtn" data-action="importSettingsBackup">${ICON.folder} <span>${tHtml('settings.importJsonBackup')}</span></button>
                    <input type="file" id="settingsBackupFileInput" accept=".json,application/json" hidden />
                    <button type="button" class="action-btn" id="exportRedactedDiagBtn" data-action="exportRedactedDiagnostics">${ICON.shield} <span>${tHtml('settings.exportRedactedDiag')}</span></button>
                    <span id="settingsBackupFeedback" class="threshold-feedback" role="status"></span>
                </div>
                <p class="stg-hint-note" data-backup-exclusions="true">${tBiHtml('Versioned allowlist (schema v1, ≤64 KB).', '版本化白名单校验（schema v1，≤64 KB）。')} ${tHtml('settings.backupExclusions')}</p>
            </div>

            <div class="stg-divider"></div>

            <div class="setting-row">
                <label for="calendarRetentionInput"${calRetentionTip}>${tBiHtml('Calendar retention (days)', '日历历史保留天数')}</label>
                <div class="threshold-input-row">
                    ${renderNumSpinner('calendarRetentionInput', calendarRetentionDays, 30, 3650, 30, tBi('Decrease calendar retention days', '减少日历保留天数'), tBi('Increase calendar retention days', '增加日历保留天数'), 'data-app-setting="calendarRetentionDays" data-setting-type="int" data-feedback-id="calendarRetentionFeedback"')}
                    <button type="button" class="action-btn" id="calendarRetentionSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="calendarRetentionFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>

            ${storageSectionHtml}
        </details>`;

    const groupGlobalRules = buildGlobalRulesCardHtml(options?.globalRules, privacyMasked);

    const tag = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
    const checkedAt = options?.updateStatus?.checkedAt;
    const checkedTime = typeof checkedAt === 'number' ? new Date(checkedAt) : null;
    const validTime = checkedTime && Number.isFinite(checkedTime.getTime()) && checkedTime.getTime() > 0;
    const openVsxUrl = 'https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor';
    const updates = `
        <section class="stg-card stg-updates" id="updatesSettingsCard" data-settings-group="version-updates">
            <div class="stg-header"><span class="stg-header-icon">${ICON.refresh}</span>
                <h2>${tBiHtml('Version & Updates', '版本与更新')}</h2>
                ${updateInfo.pillHtml}
            </div>
            <div class="stg-update-summary">
                <p>${tBiHtml('Installed', '已安装')} <strong>${esc(tag)}</strong>
                    <span class="stg-checked-at">${tBiHtml('Last checked', '上次检查')} <time id="settingsUpdateCheckedAt"${validTime ? ` datetime="${checkedTime.toISOString()}"` : ''}>${validTime ? esc(checkedTime.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US')) : tBiHtml('Not checked yet', '尚未检查')}</time></span>
                </p>
                <div class="storage-actions">
                    <button type="button" class="action-btn" id="settingsCheckUpdatesBtn" data-action="checkForUpdates">${ICON.refresh} <span>${tBiHtml('Check for Updates', '检查更新')}</span></button>
                    ${isAppSidecar
            ? `<button type="button" class="action-btn stg-btn-primary" id="settingsUpgradeNowBtn" data-action="applyPluginUpdate"${updateInfo.updateAvailable ? '' : ' hidden'}>${tBiHtml('Upgrade Now', '立即升级')}</button>`
            : `<a class="action-btn" id="settingsOpenVsxLink" data-action="openExternalUrl" data-url="${openVsxUrl}" href="${openVsxUrl}" target="_blank" rel="noopener noreferrer">${ICON.externalLink} <span>${tBiHtml('Open VSX', 'Open VSX 市场')}</span></a>`}
                    <span id="updatesFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
            <label class="toggle-row">
                <input type="checkbox" id="toggleAutoCheckUpdates" class="toggle-cb" data-app-setting="autoCheckUpdates" data-feedback-id="updatesFeedback"${autoCheckUpdates ? ' checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span>${tBiHtml('Automatically check GitHub Releases for new versions', '自动检查 GitHub Releases 新版本')}</span>
            </label>
            <details id="settings-agent-install" class="stg-guide-details">
                <summary>${tBiHtml('Install or upgrade with an AI agent', '通过 AI 智能体安装或升级')}</summary>
                <p class="stg-hint-note"><code>${esc(tBi('Follow AGENTS.md in AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor to install or upgrade this plugin.', '请按 AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor 仓库的 AGENTS.md 安装或升级该插件。'))}</code></p>
            </details>
        </section>`;

    return `${updates}<div class="stg-categories">
        <div class="stg-column">${isAppSidecar ? group4OverlaysCdp : ''}${group1DisplayLanguage}${group2TelemetryMetrics}${isAppSidecar ? '' : group3CurrencyPricing}</div>
        <div class="stg-column">${isAppSidecar ? group3CurrencyPricing : group4OverlaysCdp}${groupGlobalRules}${group5DataBackupDiag}</div>
    </div>`;
}

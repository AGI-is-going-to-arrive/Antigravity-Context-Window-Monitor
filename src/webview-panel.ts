import * as vscode from 'vscode';
import * as path from 'path';
import { tBi, getLanguage, setLanguage, Language } from './i18n';
import { ContextUsage } from './tracker';
import { ModelConfig, UserStatusInfo } from './models';
import { QuotaTracker } from './quota-tracker';
import { ActivityTracker, ActivitySummary, ActivityArchive } from './activity-tracker';
import { buildGMDataTabContent, getGMDataTabStyles } from './activity-panel';
import { buildPricingTabContent, getPricingTabStyles } from './pricing-panel';
import { PricingStore, ModelPricing } from './pricing-store';
import { GMSummary, GMConversationData } from './gm-tracker';
import { ICON } from './webview-icons';
import { buildMonitorSections } from './webview-monitor-tab';
import { buildModelsTabContent } from './webview-models-tab';
import { buildProfileContent } from './webview-profile-tab';
import { buildSettingsContent, StorageDiagnostics } from './webview-settings-tab';
import { buildHistoryHtml } from './webview-history-tab';
import { buildCalendarTabContent, getCalendarTabStyles } from './webview-calendar-tab';
import { DailyStore } from './daily-store';
import { getScript } from './webview-script';
import { getStyles } from './webview-styles';
import type { StateBucket } from './durable-state';
import type { PersistedModelDNA } from './model-dna-store';

// ─── Panel State ──────────────────────────────────────────────────────────────

let panel: vscode.WebviewPanel | undefined;
let extensionCtx: vscode.ExtensionContext | undefined;

/** Cached data for re-rendering after language switch. */
let lastUsage: ContextUsage | null = null;
let lastAllUsages: ContextUsage[] = [];
let lastConfigs: ModelConfig[] = [];
let lastUserInfo: UserStatusInfo | null = null;
let lastQuotaTracker: QuotaTracker | undefined;
let lastActivitySummary: ActivitySummary | null = null;
let lastActivityTracker: ActivityTracker | undefined;
let lastArchives: ActivityArchive[] = [];
let lastGMSummary: GMSummary | null = null;
let lastGMConversations: Record<string, GMConversationData> = {};
let lastPricingStore: PricingStore | undefined;
let lastDailyStore: DailyStore | undefined;
let lastStorageDiagnostics: StorageDiagnostics | undefined;
let panelDurableState: StateBucket | undefined;
let lastModelDNA: Record<string, PersistedModelDNA> = {};

/** Provide a durable state bucket for panel-level persistence (zoom, etc.). */
export function setPanelDurableState(state: StateBucket): void {
    panelDurableState = state;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function sanitizeConfigValue(key: string, value: unknown): unknown {
    switch (key) {
        case 'statusBar.showContext':
        case 'statusBar.showQuota':
        case 'statusBar.showResetCountdown':
            return !!value;
        case 'quotaNotificationThreshold':
            return clamp(Number(value) || 0, 0, 99);
        case 'activity.maxRecentSteps':
            return clamp(Number(value) || 100, 10, 500);
        case 'activity.maxArchives':
            return clamp(Number(value) || 20, 1, 100);
        case 'contextLimits': {
            const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
            const normalized: Record<string, number> = {};
            for (const [model, limit] of Object.entries(raw)) {
                normalized[model] = Math.max(1000, Math.round(Number(limit) || 1000));
            }
            return normalized;
        }
        default:
            return value;
    }
}

function refreshLocalStorageDiagnostics(): void {
    if (!lastStorageDiagnostics) { return; }
    let calendarCycleCount = 0;
    if (lastDailyStore) {
        for (const date of lastDailyStore.getDatesWithData()) {
            const record = lastDailyStore.getRecord(date);
            if (record) {
                calendarCycleCount += record.cycles.length;
            }
        }
    }
    lastStorageDiagnostics = {
        ...lastStorageDiagnostics,
        monitorSnapshotCount: lastAllUsages.length,
        monitorGMConversationCount: Object.keys(lastGMConversations).length,
        gmConversationCount: lastGMSummary?.conversations.length || 0,
        gmCallCount: lastGMSummary?.totalCalls || 0,
        quotaHistoryCount: lastQuotaTracker?.getHistory().length || 0,
        activityArchiveCount: lastArchives.length,
        calendarDayCount: lastDailyStore?.totalDays || 0,
        calendarCycleCount,
        pricingOverrideCount: Object.keys(lastPricingStore?.getCustom() || {}).length,
    };
}

function clearDisposedPanel(): void {
    panel = undefined;
    isPaused = false;
}

function isDisposedWebviewError(err: unknown): boolean {
    return err instanceof Error && /disposed/i.test(err.message);
}

/**
 * VS Code currently throws disposed WebView errors synchronously from postMessage().
 * Keep this as a sync try/catch so non-disposed failures preserve their call stack.
 */
function safePostMessage(message: unknown): void {
    if (!panel) { return; }
    try {
        panel.webview.postMessage(message);
    } catch (err) {
        if (isDisposedWebviewError(err)) {
            clearDisposedPanel();
            return;
        }
        throw err;
    }
}

/** When true, auto-refresh updates are buffered but not rendered. */
let isPaused = false;

/** Calendar month navigation state (defaults to current month) */
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show or reveal the WebView monitor panel.
 * Creates the panel on first call, reveals it on subsequent calls.
 */
export function showMonitorPanel(
    currentUsage: ContextUsage | null,
    allTrajectoryUsages: ContextUsage[],
    modelConfigs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    context?: vscode.ExtensionContext,
    tracker?: QuotaTracker,
    activitySummary?: ActivitySummary | null,
    initialTab?: string,
    archives?: ActivityArchive[],
    activityTracker?: ActivityTracker,
    gmSummary?: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
    pricingStore?: PricingStore,
    dailyStore?: DailyStore,
    storageDiagnostics?: StorageDiagnostics,
    modelDNA?: Record<string, PersistedModelDNA>,
): void {
    lastUsage = currentUsage;
    lastAllUsages = allTrajectoryUsages;
    lastConfigs = modelConfigs;
    lastUserInfo = userInfo;
    if (context) { extensionCtx = context; }
    if (tracker) { lastQuotaTracker = tracker; }
    if (activitySummary !== undefined) { lastActivitySummary = activitySummary; }
    if (archives) { lastArchives = archives; }
    if (activityTracker) { lastActivityTracker = activityTracker; }
    if (gmSummary !== undefined) { lastGMSummary = gmSummary; }
    if (gmConversations) { lastGMConversations = gmConversations; }
    if (pricingStore) { lastPricingStore = pricingStore; }
    if (dailyStore) { lastDailyStore = dailyStore; }
    if (storageDiagnostics) { lastStorageDiagnostics = storageDiagnostics; }
    if (modelDNA) { lastModelDNA = modelDNA; }

    if (panel) {
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused, lastQuotaTracker);
        panel.reveal(vscode.ViewColumn.Two, true);
        if (initialTab) { setTimeout(() => safePostMessage({ command: 'switchToTab', tab: initialTab }), 100); }
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Context Monitor', '上下文监控')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused, lastQuotaTracker);
    if (initialTab) { setTimeout(() => safePostMessage({ command: 'switchToTab', tab: initialTab }), 100); }

    panel.webview.onDidReceiveMessage(async (msg: { command: string; lang?: string; value?: unknown; key?: string }) => {
        if (msg.command === 'switchLanguage' && msg.lang && extensionCtx) {
            await setLanguage(msg.lang as Language, extensionCtx);
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'refresh') {
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'togglePause') {
            isPaused = !isPaused;
            if (!isPaused && panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            } else if (panel) {
                safePostMessage({ command: 'setPaused', paused: isPaused });
            }
        } else if (msg.command === 'setThreshold' && typeof msg.value === 'number') {
            const val = Math.max(10_000, msg.value);
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('compressionWarningThreshold', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                safePostMessage({ command: 'thresholdSaved' });
            }
        } else if (msg.command === 'setPollingInterval' && typeof msg.value === 'number') {
            const val = Math.max(1, Math.min(60, msg.value));
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('pollingInterval', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                safePostMessage({ command: 'configSaved', key: 'pollingInterval' });
            }
        } else if (msg.command === 'setConfig' && msg.key) {
            const allowedKeys = [
                'statusBar.showContext',
                'statusBar.showQuota',
                'statusBar.showResetCountdown',
                'contextLimits',
                'quotaNotificationThreshold',
                'activity.maxRecentSteps',
                'activity.maxArchives',

            ];
            if (allowedKeys.includes(msg.key)) {
                const normalizedValue = sanitizeConfigValue(msg.key, msg.value);
                await vscode.workspace.getConfiguration('antigravityContextMonitor')
                    .update(msg.key, normalizedValue, vscode.ConfigurationTarget.Global);
                if (panel) {
                    safePostMessage({ command: 'configSaved', key: msg.key });
                }
            }
        } else if (msg.command === 'copyStatePath' && lastStorageDiagnostics?.stateFilePath) {
            await vscode.env.clipboard.writeText(lastStorageDiagnostics.stateFilePath);
            safePostMessage({ command: 'configSaved', key: 'statePath' });
        } else if (msg.command === 'openStateFile' && lastStorageDiagnostics?.stateFilePath) {
            const uri = vscode.Uri.file(lastStorageDiagnostics.stateFilePath);
            const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
            if (!exists) {
                void vscode.window.showWarningMessage(tBi('State file has not been created yet.', '状态文件尚未生成。'));
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        } else if (msg.command === 'revealStateFile' && lastStorageDiagnostics?.stateFilePath) {
            const uri = vscode.Uri.file(lastStorageDiagnostics.stateFilePath);
            const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
            const target = exists ? uri : vscode.Uri.file(path.dirname(lastStorageDiagnostics.stateFilePath));
            await vscode.commands.executeCommand('revealFileInOS', target);
        } else if (msg.command === 'clearActiveTracking') {
            if (lastQuotaTracker) {
                lastQuotaTracker.resetTrackingStates();
                refreshLocalStorageDiagnostics();
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                }
            }
        } else if (msg.command === 'clearQuotaHistory') {
            if (lastQuotaTracker) {
                lastQuotaTracker.resetTrackingStates();
                lastQuotaTracker.clearHistory();
                refreshLocalStorageDiagnostics();
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                }
            }
        } else if (msg.command === 'setQuotaMaxHistory' && typeof msg.value === 'number') {
            if (lastQuotaTracker) {
                lastQuotaTracker.setMaxHistory(clamp(msg.value, 1, 100));
                if (panel) {
                    safePostMessage({ command: 'configSaved', key: 'quotaMaxHistory' });
                }
            }
        } else if (msg.command === 'toggleQuotaTracking') {
            if (lastQuotaTracker) {
                lastQuotaTracker.setEnabled(!lastQuotaTracker.isEnabled());
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                }
            }
        } else if (msg.command === 'setZoomLevel' && typeof msg.value === 'number') {
            const zoom = clamp(Math.round(msg.value as number), 50, 200);
            if (panelDurableState) {
                panelDurableState.update('panelZoomLevel', zoom);
            }
        } else if (msg.command === 'clearActivityData') {
            if (lastActivityTracker) {
                lastActivityTracker.reset();
                lastActivitySummary = lastActivityTracker.getSummary();
                lastArchives = lastActivityTracker.getArchives();
            }
            // Also clear quota tracking states + history (ghost sessions, etc.)
            if (lastQuotaTracker) {
                lastQuotaTracker.resetTrackingStates();
                lastQuotaTracker.clearHistory();
            }
            // Clear calendar data — prevents stale highlights after reinstall
            if (lastDailyStore) {
                lastDailyStore.clear();
            }
            // Clear GM cached data so it matches the reset activity state
            lastGMSummary = null;
            lastGMConversations = {};
            refreshLocalStorageDiagnostics();
            await vscode.commands.executeCommand('antigravity-context-monitor.devClearGM');
            // Persist cleared activity state to globalState — prevents restore from
            // resurrecting old archives after reinstall → importArchives re-populating calendar
            await vscode.commands.executeCommand('antigravity-context-monitor.devPersistActivity');
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'savePricing' && lastPricingStore) {
            const data = msg.value as Record<string, ModelPricing>;
            if (data && typeof data === 'object') {
                lastPricingStore.setAll(data).then(() => {
                    refreshLocalStorageDiagnostics();
                    if (panel) {
                        panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                        safePostMessage({ command: 'pricingSaved' });
                    }
                });
            }
        } else if (msg.command === 'resetPricing' && lastPricingStore) {
            lastPricingStore.reset().then(() => {
                refreshLocalStorageDiagnostics();
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                    safePostMessage({ command: 'pricingReset' });
                }
            });
        } else if (msg.command === 'clearCalendarHistory' && lastDailyStore) {
            lastDailyStore.clear();
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'switchCalendarMonth' && typeof (msg as Record<string,unknown>).year === 'number') {
            calendarYear = (msg as Record<string,unknown>).year as number;
            calendarMonth = (msg as Record<string,unknown>).month as number;
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'devSimulateReset') {
            await vscode.commands.executeCommand('antigravity-context-monitor.devSimulateReset');
            lastGMSummary = null;
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'devClearGM') {
            await vscode.commands.executeCommand('antigravity-context-monitor.devClearGM');
            lastGMSummary = null;
            lastGMConversations = {};
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        }
    });

    panel.onDidDispose(() => {
        clearDisposedPanel();
    });
}

/**
 * Silently update the panel if it is already visible.
 * Does NOT steal focus or create a new panel.
 * When paused, data is cached but the panel is NOT re-rendered.
 */
export function updateMonitorPanel(
    currentUsage: ContextUsage | null,
    allTrajectoryUsages: ContextUsage[],
    modelConfigs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    tracker?: QuotaTracker,
    activitySummary?: ActivitySummary | null,
    archives?: ActivityArchive[],
    gmSummary?: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
    storageDiagnostics?: StorageDiagnostics,
    modelDNA?: Record<string, PersistedModelDNA>,
): void {
    lastUsage = currentUsage;
    lastAllUsages = allTrajectoryUsages;
    lastConfigs = modelConfigs;
    lastUserInfo = userInfo;
    if (tracker) { lastQuotaTracker = tracker; }
    if (activitySummary !== undefined) { lastActivitySummary = activitySummary; }
    if (archives) { lastArchives = archives; }
    if (gmSummary !== undefined) { lastGMSummary = gmSummary; }
    if (gmConversations) { lastGMConversations = gmConversations; }
    if (storageDiagnostics) { lastStorageDiagnostics = storageDiagnostics; }
    if (modelDNA) { lastModelDNA = modelDNA; }
    if (panel && !isPaused) {
        // Incremental update: send tab contents via postMessage — no DOM teardown
        safePostMessage({
            command: 'updateTabs',
            tabs: buildTabContents(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, lastQuotaTracker),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
    }
}

/** Build HTML for each tab pane (shared between full rebuild and incremental refresh). */
function buildTabContents(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    tracker?: QuotaTracker,
): Record<string, string> {
    return {
        monitor: buildMonitorSections(usage, allUsages, configs, userInfo, lastGMSummary, lastGMConversations),
        gmdata: buildGMDataTabContent(lastActivitySummary, lastGMSummary, usage),
        pricing: lastPricingStore
            ? buildPricingTabContent(lastGMSummary, lastPricingStore)
            : `<p class="empty-msg">${tBi('Initializing...', '初始化中...')}</p>`,
        models: buildModelsTabContent(userInfo, configs, lastGMSummary, lastModelDNA),
        history: buildHistoryHtml(tracker),
        calendar: buildCalendarTabContent(lastDailyStore ?? undefined, calendarYear, calendarMonth),
        profile: buildProfileContent(userInfo, configs),
        // Settings tab excluded from incremental updates: its content is mostly static
        // and replacing innerHTML destroys event listeners on toggles, buttons, inputs.
        // Settings is only rendered via full buildHtml() (panel open, language switch, etc.).
    };
}

/** Whether the monitor panel is currently open. */
export function isMonitorPanelVisible(): boolean {
    return panel !== undefined;
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildHtml(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    paused = false,
    tracker?: QuotaTracker,
): string {
    const monitorHtml = buildMonitorSections(usage, allUsages, configs, userInfo, lastGMSummary, lastGMConversations);
    const gmDataHtml = buildGMDataTabContent(lastActivitySummary, lastGMSummary, usage);
    const pricingHtml = lastPricingStore
        ? buildPricingTabContent(lastGMSummary, lastPricingStore)
        : `<p class="empty-msg">${tBi('Initializing...', '初始化中...')}</p>`;
    const modelsHtml = buildModelsTabContent(userInfo, configs, lastGMSummary, lastModelDNA);
    const historyHtml = buildHistoryHtml(tracker);
    const calendarHtml = buildCalendarTabContent(lastDailyStore ?? undefined, calendarYear, calendarMonth);
    const profileHtml = buildProfileContent(userInfo, configs);
    const settingsHtml = buildSettingsContent(configs, tracker, lastStorageDiagnostics);

    const currentLang = getLanguage();
    const htmlLang = currentLang === 'zh' ? 'zh-CN' : currentLang === 'en' ? 'en' : 'zh-CN';
    return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getStyles()}
${getGMDataTabStyles()}
${getPricingTabStyles()}
${getCalendarTabStyles()}
</style>
</head>
<body data-privacy-default="true" data-zoom="${panelDurableState?.get<number>('panelZoomLevel', 100) ?? 100}">
    <div class="panel-topbar">
        <header class="topbar-title">
            <h1>
                ${ICON.chart}
                ${tBi('Context Monitor', '上下文监控')}
            </h1>
            <div class="header-actions">
                <div class="lang-switcher">
                    <button class="lang-btn${currentLang === 'zh' ? ' active' : ''}" data-lang="zh">中文</button>
                    <button class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
                    <button class="lang-btn${currentLang === 'both' ? ' active' : ''}" data-lang="both">${tBi('Both', '双语')}</button>
                </div>
                <button class="action-btn${paused ? ' paused' : ''}" id="pauseBtn" data-tooltip="${tBi(paused ? 'Resume auto-refresh' : 'Pause auto-refresh', paused ? '恢复自动刷新' : '暂停自动刷新')}">
                    <svg viewBox="0 0 16 16" width="14" height="14">${paused
                        ? '<path fill="currentColor" d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>'
                        : '<path fill="currentColor" d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>'
                    }</svg>
                </button>
                <button class="action-btn" id="refreshBtn" data-tooltip="${tBi('Refresh', '刷新')}">
                    ${ICON.refresh}
                </button>
                <span class="update-time">${paused ? `<span class="paused-indicator">${tBi('PAUSED', '已暂停')}</span>` : ''} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
        </header>
        <div class="topbar-chips">
            <button class="info-chip chip-github" data-chip="github">
                ${ICON.git}
                <span>GitHub</span>
                ${ICON.externalLink}
            </button>
            <button class="info-chip chip-warn" data-chip="notice">
                ${ICON.windows}
                <span>${tBi('Notice', '提示')}</span>
            </button>
            <button class="info-chip chip-warn" data-chip="disclaimer">
                <svg class="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
                <span>${tBi('Disclaimer', '声明')}</span>
            </button>
        </div>
        <div class="chip-dropdown chip-dropdown-github" id="chip-github" hidden>
            <div class="chip-dropdown-content">
                <span class="chip-dropdown-text">
                    ${tBi(
                        'By <strong>AGI-is-going-to-arrive</strong> — open-source on GitHub. If you find it helpful, a',
                        '作者 <strong>AGI-is-going-to-arrive</strong> — 项目已在 GitHub 开源。如果觉得有帮助，点个',
                    )}
                    <span class="star-inline">${ICON.star}</span>
                    ${tBi('would be appreciated.', '就是最大的支持。')}
                    <span class="heart-inline">${ICON.heart}</span>
                </span>
                <a class="info-banner-link" href="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor" target="_blank" rel="noopener noreferrer">
                    ${ICON.externalLink} GitHub
                </a>
            </div>
        </div>
        <div class="chip-dropdown chip-dropdown-notice" id="chip-notice" hidden>
            <div class="chip-dropdown-content">
                <span class="chip-dropdown-text">
                    ${tBi(
                        'Recommended: use a single IDE window. Multi-window setups may cause data desync between instances (e.g. activity timeline, quota tracking).',
                        '建议使用单窗口运行。多窗口可能导致实例间数据不同步（如活动时间线、额度追踪等）。',
                    )}
                </span>
            </div>
        </div>
        <div class="chip-dropdown chip-dropdown-disclaimer" id="chip-disclaimer" hidden>
            <div class="chip-dropdown-content disclaimer-body">
                ${tBi(
                    '<p>Data is derived from <strong>internal interfaces that are undocumented and may change without notice</strong>. Items marked with a <strong style="color:var(--color-ok)">GM</strong> badge come from Generator Metadata and have <strong>higher per-call fidelity</strong>. Other metrics (context usage, token estimates) are derived from checkpoint snapshots or character-based heuristics and may have deviations. <strong>All numbers are best-effort approximations.</strong> This extension is an independent, community project with <strong>no official endorsement</strong>. Use this data as a reference only.</p><p style="margin-top:var(--space-2)"><strong>⚠️ Context Window Limitation:</strong> Antigravity (Windsurf) does not utilize the full 1M context window advertised by the underlying model. The effective context is roughly <strong>128K–200K tokens</strong>. The compression warning threshold defaults to <strong>150K</strong> accordingly.</p><p style="margin-top:var(--space-2)"><strong>🌐 Language:</strong> This extension supports <strong>Chinese / English / Bilingual</strong> display. Use the <strong>中文 | EN | 双语</strong> buttons in the top-right corner of this panel to switch.</p>',
                    '<p>数据通过<strong>内部接口</strong>获取，这些接口<strong>未公开文档且可能随时变更</strong>。标有 <strong style="color:var(--color-ok)">GM</strong> 徽章的数据来自 <strong>Generator Metadata（生成元数据）</strong>，<strong>单次调用精度较高</strong>。其余指标（上下文用量、Token 估算）基于 <strong>Checkpoint（检查点）</strong> 快照或字符启发式计算，可能存在偏差。<strong>所有数值均为尽力计算的近似值。</strong>本扩展为独立社区项目，<strong>未获得官方认可</strong>。请仅将数据作为参考。</p><p style="margin-top:var(--space-2)"><strong>⚠️ 上下文窗口限制：</strong>Antigravity（Windsurf）并未适配底层模型标称的 1M 上下文窗口，实际有效上下文大致为 <strong>128K–200K Token</strong>。压缩警告阈值默认设为 <strong>150K</strong>。</p><p style="margin-top:var(--space-2)"><strong>🌐 语言切换：</strong>本插件支持 <strong>中文 / English / 双语</strong> 显示。请使用面板右上角的 <strong>中文 | EN | 双语</strong> 按钮切换。</p>'
                )}
            </div>
        </div>
        <nav class="tab-bar">
        <div class="tab-slider"></div>
        <button class="tab-btn active" data-tab="monitor" data-color="blue">${ICON.chart} ${tBi('Monitor', '监控')}</button>
        <button class="tab-btn" data-tab="gmdata" data-color="orange">${ICON.bolt} ${tBi('GM Data', 'GM 数据')}</button>
        <button class="tab-btn" data-tab="pricing" data-color="purple"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.315 0-1.667-1.104-2.512-3.233-3.037l-.445-.107V3.63c1.213.183 1.968.91 2.141 1.88h1.762c-.112-1.796-1.519-2.965-3.455-3.124V1.036H8.59v1.383C6.408 2.583 5.008 3.9 5.003 5.54c0 1.592 1.063 2.457 3.146 2.963l.399.1v3.979c-1.29-.183-2.113-.879-2.275-1.8H4zm4.586-4.34C7.494 6.137 6.94 5.695 6.94 5.092c0-.66.52-1.183 1.575-1.37v2.72h.071zm.889 2.283c1.335.36 1.942.846 1.942 1.548 0 .781-.633 1.35-1.823 1.493V8.851l-.119-.127z"/></svg> ${tBi('Cost', '成本')}</button>
        <button class="tab-btn" data-tab="models" data-color="green">${ICON.bolt} ${tBi('Models', '模型')}</button>
        <button class="tab-btn" data-tab="history" data-color="yellow">${ICON.timeline} ${tBi('Quota Tracking', '额度追踪')}</button>
        <button class="tab-btn" data-tab="calendar" data-color="cyan"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg> ${tBi('Calendar', '日历')}</button>
        <button class="tab-btn" data-tab="profile" data-color="gray">${ICON.user} ${tBi('Profile', '个人')}</button>
        <button class="tab-btn" data-tab="settings" data-color="gray">${ICON.shield} ${tBi('Settings', '设置')}</button>
    </nav>
    </div>
    <div class="tab-pane active" id="tab-monitor">
        ${monitorHtml}
    </div>
    <div class="tab-pane" id="tab-gmdata">
        ${gmDataHtml}
    </div>
    <div class="tab-pane" id="tab-pricing">
        ${pricingHtml}
    </div>
    <div class="tab-pane" id="tab-models">
        ${modelsHtml}
    </div>
    <div class="tab-pane" id="tab-history">
        ${historyHtml}
    </div>
    <div class="tab-pane" id="tab-calendar">
        ${calendarHtml}
    </div>
    <div class="tab-pane" id="tab-profile">
        ${profileHtml}
    </div>
    <div class="tab-pane" id="tab-settings">
        ${settingsHtml}
    </div>
    <script>
        ${getScript()}
    </script>
</body>
</html>`;
}

import * as vscode from 'vscode';
import { tBi, getLanguage, setLanguage, Language } from './i18n';
import { ContextUsage } from './tracker';
import { ModelConfig, UserStatusInfo } from './models';
import { QuotaTracker } from './quota-tracker';
import { ActivityTracker, ActivitySummary, ActivityArchive } from './activity-tracker';
import { buildActivityTabContent, getActivityTabStyles } from './activity-panel';
import { buildGMTabContent, getGMTabStyles } from './gm-panel';
import { buildPricingTabContent, getPricingTabStyles } from './pricing-panel';
import { PricingStore, ModelPricing } from './pricing-store';
import { GMSummary } from './gm-tracker';
import { ICON } from './webview-icons';
import { buildMonitorSections } from './webview-monitor-tab';
import { buildProfileContent } from './webview-profile-tab';
import { buildSettingsContent } from './webview-settings-tab';
import { buildHistoryHtml } from './webview-history-tab';
import { getScript } from './webview-script';
import { getStyles } from './webview-styles';

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
let lastPricingStore: PricingStore | undefined;

/** When true, auto-refresh updates are buffered but not rendered. */
let isPaused = false;

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
    pricingStore?: PricingStore,
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
    if (pricingStore) { lastPricingStore = pricingStore; }

    if (panel) {
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused, lastQuotaTracker);
        panel.reveal(vscode.ViewColumn.Two, true);
        if (initialTab) { setTimeout(() => panel?.webview.postMessage({ command: 'switchToTab', tab: initialTab }), 100); }
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Context Monitor', '上下文监控')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused, lastQuotaTracker);
    if (initialTab) { setTimeout(() => panel?.webview.postMessage({ command: 'switchToTab', tab: initialTab }), 100); }

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
                panel.webview.postMessage({ command: 'setPaused', paused: isPaused });
            }
        } else if (msg.command === 'setThreshold' && typeof msg.value === 'number') {
            const val = Math.max(10_000, msg.value);
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('compressionWarningThreshold', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                panel.webview.postMessage({ command: 'thresholdSaved' });
            }
        } else if (msg.command === 'setPollingInterval' && typeof msg.value === 'number') {
            const val = Math.max(1, Math.min(60, msg.value));
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('pollingInterval', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                panel.webview.postMessage({ command: 'configSaved', key: 'pollingInterval' });
            }
        } else if (msg.command === 'setConfig' && msg.key) {
            const allowedKeys = [
                'statusBar.showContext',
                'statusBar.showQuota',
                'statusBar.showResetCountdown',
                'statusBar.showActivity',
                'statusBar.activityDisplayMode',
                'contextLimits',
                'quotaNotificationThreshold',
                'activity.maxRecentSteps',
                'activity.maxArchives',
                'privacy.defaultMask',
            ];
            if (allowedKeys.includes(msg.key)) {
                await vscode.workspace.getConfiguration('antigravityContextMonitor')
                    .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
                if (panel) {
                    panel.webview.postMessage({ command: 'configSaved', key: msg.key });
                }
            }
        } else if (msg.command === 'clearQuotaHistory') {
            if (lastQuotaTracker) {
                lastQuotaTracker.clearHistory();
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                }
            }
        } else if (msg.command === 'setQuotaMaxHistory' && typeof msg.value === 'number') {
            if (lastQuotaTracker) {
                lastQuotaTracker.setMaxHistory(Math.max(1, msg.value));
                if (panel) {
                    panel.webview.postMessage({ command: 'configSaved', key: 'quotaMaxHistory' });
                }
            }
        } else if (msg.command === 'toggleQuotaTracking') {
            if (lastQuotaTracker) {
                lastQuotaTracker.setEnabled(!lastQuotaTracker.isEnabled());
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                }
            }
        } else if (msg.command === 'clearActivityData') {
            if (lastActivityTracker) {
                lastActivityTracker.reset();
            }
            // Also clear quota tracking states + history (ghost sessions, etc.)
            if (lastQuotaTracker) {
                lastQuotaTracker.resetTrackingStates();
                lastQuotaTracker.clearHistory();
            }
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'savePricing' && lastPricingStore) {
            const data = msg.value as Record<string, ModelPricing>;
            if (data && typeof data === 'object') {
                lastPricingStore.setAll(data).then(() => {
                    if (panel) {
                        panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                        panel.webview.postMessage({ command: 'pricingSaved' });
                    }
                });
            }
        } else if (msg.command === 'resetPricing' && lastPricingStore) {
            lastPricingStore.reset().then(() => {
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                    panel.webview.postMessage({ command: 'pricingReset' });
                }
            });
        }
    });

    panel.onDidDispose(() => {
        panel = undefined;
        isPaused = false;  // Reset pause on close
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
): void {
    lastUsage = currentUsage;
    lastAllUsages = allTrajectoryUsages;
    lastConfigs = modelConfigs;
    lastUserInfo = userInfo;
    if (tracker) { lastQuotaTracker = tracker; }
    if (activitySummary !== undefined) { lastActivitySummary = activitySummary; }
    if (archives) { lastArchives = archives; }
    if (gmSummary !== undefined) { lastGMSummary = gmSummary; }
    if (panel && !isPaused) {
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused, lastQuotaTracker);
    }
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
    const monitorHtml = buildMonitorSections(usage, allUsages, configs, userInfo);
    const profileHtml = buildProfileContent(userInfo, configs);
    const settingsHtml = buildSettingsContent(configs, tracker);
    const historyHtml = buildHistoryHtml(tracker, lastArchives);
    const activityHtml = buildActivityTabContent(lastActivitySummary, configs, tracker, lastArchives);
    const gmHtml = buildGMTabContent(lastGMSummary);
    const pricingHtml = lastPricingStore
        ? buildPricingTabContent(lastGMSummary, lastPricingStore)
        : `<p class="empty-msg">${tBi('Initializing...', '初始化中...')}</p>`;

    const currentLang = getLanguage();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getStyles()}
${getActivityTabStyles()}
${getGMTabStyles()}
${getPricingTabStyles()}
</style>
</head>
<body data-privacy-default="${vscode.workspace.getConfiguration('antigravityContextMonitor').get('privacy.defaultMask', false)}">
    <header class="panel-header">
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
    <nav class="tab-bar">
        <button class="tab-btn active" data-tab="monitor">${ICON.chart} ${tBi('Monitor', '监控')}</button>
        <button class="tab-btn" data-tab="profile">${ICON.user} ${tBi('Profile', '个人')}</button>
        <button class="tab-btn" data-tab="activity">${ICON.bolt} ${tBi('Activity', '活动')}</button>
        <button class="tab-btn" data-tab="gmdata"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 4a.5.5 0 0 1 .5.5V6H10a.5.5 0 0 1 0 1H8.5v1.5a.5.5 0 0 1-1 0V7H6a.5.5 0 0 1 0-1h1.5V4.5A.5.5 0 0 1 8 4M3.732 12H4.5a.5.5 0 0 1 0 1H1.5a.5.5 0 0 1 0-1h.768l3.5-7H4.5a.5.5 0 0 1 0-1h3a.5.5 0 0 1 0 1h-.768zM7.5 11h3a.5.5 0 0 1 0 1H9.268l1.75 3.5H12.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1h1.232l-1.75-3.5H7.5a.5.5 0 0 1 0-1"/></svg> ${tBi('GM Data', 'GM 数据')}</button>
        <button class="tab-btn" data-tab="pricing"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.315 0-1.667-1.104-2.512-3.233-3.037l-.445-.107V3.63c1.213.183 1.968.91 2.141 1.88h1.762c-.112-1.796-1.519-2.965-3.455-3.124V1.036H8.59v1.383C6.408 2.583 5.008 3.9 5.003 5.54c0 1.592 1.063 2.457 3.146 2.963l.399.1v3.979c-1.29-.183-2.113-.879-2.275-1.8H4zm4.586-4.34C7.494 6.137 6.94 5.695 6.94 5.092c0-.66.52-1.183 1.575-1.37v2.72h.071zm.889 2.283c1.335.36 1.942.846 1.942 1.548 0 .781-.633 1.35-1.823 1.493V8.851l-.119-.127z"/></svg> ${tBi('Pricing', '价格')}</button>
        <button class="tab-btn" data-tab="history">${ICON.timeline} ${tBi('History', '历史')}</button>
        <button class="tab-btn" data-tab="settings">${ICON.shield} ${tBi('Settings', '设置')}</button>
    </nav>
    <div class="tab-pane active" id="tab-monitor">
        ${monitorHtml}
    </div>
    <div class="tab-pane" id="tab-profile">
        ${profileHtml}
    </div>
    <div class="tab-pane" id="tab-activity">
        ${activityHtml}
    </div>
    <div class="tab-pane" id="tab-gmdata">
        ${gmHtml}
    </div>
    <div class="tab-pane" id="tab-pricing">
        ${pricingHtml}
    </div>
    <div class="tab-pane" id="tab-history">
        ${historyHtml}
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

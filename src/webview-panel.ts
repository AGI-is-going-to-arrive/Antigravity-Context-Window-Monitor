import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { tBi, getLanguage, setLanguage, Language } from './i18n';
import { ContextUsage, TrajectorySummary } from './tracker';
import { ModelConfig, UserStatusInfo } from './models';
import { QuotaTracker } from './quota-tracker';
import { ActivityTracker, ActivitySummary, ActivityArchive } from './activity-tracker';
import { buildGMDataTabContent, getGMDataTabStyles, buildAccountStatusPanel, hasAccountReadyPool, type AccountSnapshot } from './activity-panel';
import { removeAccountSnapshot, getBillingDaysMap, setAccountBillingDay } from './extension';
import type { PendingArchiveEntry } from './gm-tracker';
import { buildPricingTabContent, getPricingTabStyles } from './pricing-panel';
import { PricingStore, ModelPricing } from './pricing-store';
import { GMSummary, GMConversationData } from './gm-tracker';
import { ICON } from './webview-icons';
import { formatFileSize } from './webview-helpers';
// Monitor tab removed — GM Data is now the primary dashboard
import { buildModelsTabContent } from './webview-models-tab';
import { buildProfileContent } from './webview-profile-tab';
import { buildSettingsContent, StorageDiagnostics, PanelHintPreferences } from './webview-settings-tab';
import { buildHistoryHtml } from './webview-history-tab';
import { buildAboutTabContent, getAboutTabStyles } from './webview-about-tab';
import { buildCalendarTabContent, getCalendarTabStyles } from './webview-calendar-tab';
import { buildChatHistoryTabContent } from './webview-chat-history-tab';
import { DailyStore } from './daily-store';
import { getScript } from './webview-script';
import { getStyles } from './webview-styles';
import type { StateBucket } from './durable-state';
import type { PersistedModelDNA } from './model-dna-store';

// ─── Panel Payload ────────────────────────────────────────────────────────────

/** Unified data payload for showMonitorPanel / updateMonitorPanel. */
export interface PanelPayload {
    currentUsage: ContextUsage | null;
    allTrajectoryUsages: ContextUsage[];
    allTrajectories?: TrajectorySummary[];
    modelConfigs: ModelConfig[];
    userInfo: UserStatusInfo | null;
    workspaceUri?: string;
    context?: vscode.ExtensionContext;
    tracker?: QuotaTracker;
    activitySummary?: ActivitySummary | null;
    initialTab?: string;
    archives?: ActivityArchive[];
    activityTracker?: ActivityTracker;
    gmSummary?: GMSummary | null;
    /** Full summary with ALL accounts (no account filtering) — used by Cost tab. */
    gmFullSummary?: GMSummary | null;
    gmConversations?: Record<string, GMConversationData>;
    pricingStore?: PricingStore;
    dailyStore?: DailyStore;
    storageDiagnostics?: StorageDiagnostics;
    modelDNA?: Record<string, PersistedModelDNA>;
    accountSnapshots?: AccountSnapshot[];
    pendingArchives?: PendingArchiveEntry[];
}

// ─── Panel State ──────────────────────────────────────────────────────────────

let panel: vscode.WebviewPanel | undefined;
let extensionCtx: vscode.ExtensionContext | undefined;

/** Cached data for re-rendering after language switch. */
let lastUsage: ContextUsage | null = null;
let lastAllUsages: ContextUsage[] = [];
let lastTrajectories: TrajectorySummary[] = [];
let lastConfigs: ModelConfig[] = [];
let lastUserInfo: UserStatusInfo | null = null;
let lastWorkspaceUri = '';
let lastQuotaTracker: QuotaTracker | undefined;
let lastActivitySummary: ActivitySummary | null = null;
let lastActivityTracker: ActivityTracker | undefined;
let lastArchives: ActivityArchive[] = [];
let lastGMSummary: GMSummary | null = null;
/** Full summary with ALL accounts — Cost tab uses this for cross-account cost calculation. */
let lastGMFullSummary: GMSummary | null = null;
let lastGMConversations: Record<string, GMConversationData> = {};
let lastPricingStore: PricingStore | undefined;
let lastDailyStore: DailyStore | undefined;
let lastStorageDiagnostics: StorageDiagnostics | undefined;
let panelDurableState: StateBucket | undefined;
let lastModelDNA: Record<string, PersistedModelDNA> = {};
let lastAccountSnapshots: AccountSnapshot[] = [];
let lastPendingArchives: PendingArchiveEntry[] = [];
export const LARGE_STATE_FILE_WARN_BYTES = 1 * 1024 * 1024;

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
        case 'statusBar.showAiCredits':
        case 'showModelInternalId':
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
    const stateFileExists = fs.existsSync(lastStorageDiagnostics.stateFilePath);
    let stateFileSizeBytes = 0;
    try {
        stateFileSizeBytes = stateFileExists ? fs.statSync(lastStorageDiagnostics.stateFilePath).size : 0;
    } catch { /* ignore stat errors */ }
    lastStorageDiagnostics = {
        ...lastStorageDiagnostics,
        stateFileExists,
        stateFileSizeBytes,
        stateFileOpenWarnBytes: LARGE_STATE_FILE_WARN_BYTES,
        calendarDayCount: lastDailyStore?.totalDays || 0,
    };
}

function clearDisposedPanel(): void {
    panel = undefined;
    isPaused = false;
}

export async function openUriInEditor(target: vscode.Uri): Promise<void> {
    const options: vscode.TextDocumentShowOptions = {
        preview: false,
        preserveFocus: false,
        viewColumn: panel?.viewColumn ?? vscode.ViewColumn.Active,
    };
    try {
        await vscode.commands.executeCommand('vscode.open', target, options);
        return;
    } catch {
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc, options);
    }
}

function reportStateFileError(action: 'open' | 'reveal', err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    const warning = action === 'open'
        ? tBi('Failed to open state file.', '打开状态文件失败。')
        : tBi('Failed to reveal state file.', '定位状态文件失败。');
    void vscode.window.showWarningMessage(`${warning} ${reason}`);
    safePostMessage({ command: 'stateFileActionResult', action, ok: false, message: warning });
}

// formatFileSize is re-exported from webview-helpers for external consumers
export { formatFileSize } from './webview-helpers';

export async function confirmLargeStateFileOpen(fileSizeBytes: number): Promise<'open' | 'reveal' | 'cancel'> {
    if (fileSizeBytes < LARGE_STATE_FILE_WARN_BYTES) {
        return 'open';
    }

    const openLabel = tBi('Open Anyway', '仍然打开');
    const revealLabel = tBi('Reveal Instead', '改为定位');
    const message = tBi(
        `The state file is ${formatFileSize(fileSizeBytes)}. Opening it as plain text may stall the editor. Recommended: reveal it in the file manager instead.`,
        `状态文件大小为 ${formatFileSize(fileSizeBytes)}。直接作为文本打开可能导致编辑器卡顿。更推荐先在文件管理器中定位它。`,
    );
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, openLabel, revealLabel);
    if (choice === openLabel) {
        return 'open';
    }
    if (choice === revealLabel) {
        return 'reveal';
    }
    return 'cancel';
}

function getPanelHintPreferences(): PanelHintPreferences {
    return {
        showTabScrollHint: panelDurableState?.get<boolean>('panelShowTabScrollHint', true) ?? true,
        showScrollbar: panelDurableState?.get<boolean>('panelShowScrollbar', false) ?? false,
        showEndOfContent: panelDurableState?.get<boolean>('panelShowEndOfContent', true) ?? true,
    };
}

function getAntigravityRoot(): string {
    return path.join(os.homedir(), '.gemini', 'antigravity');
}

function workspaceTargetFromUri(workspaceUri: string): vscode.Uri | null {
    if (!workspaceUri) { return null; }
    if (workspaceUri.startsWith('file:')) {
        try {
            return vscode.Uri.parse(workspaceUri);
        } catch {
            return null;
        }
    }
    try {
        return vscode.Uri.file(workspaceUri);
    } catch {
        return null;
    }
}

function getConversationTarget(cascadeId: string, kind: 'record' | 'pb'): vscode.Uri {
    const root = getAntigravityRoot();
    const pbPath = path.join(root, 'conversations', `${cascadeId}.pb`);
    if (kind === 'pb') {
        return vscode.Uri.file(pbPath);
    }

    const brainDir = path.join(root, 'brain', cascadeId);
    const recordingDir = path.join(root, 'browser_recordings', cascadeId);
    const conversationDir = path.join(root, 'conversations');
    const preferred = [brainDir, recordingDir, conversationDir];
    for (const target of preferred) {
        if (fs.existsSync(target)) {
            return vscode.Uri.file(target);
        }
    }
    return vscode.Uri.file(conversationDir);
}

async function revealUriOrParent(target: vscode.Uri | null): Promise<void> {
    if (!target) {
        void vscode.window.showWarningMessage(tBi('Unable to resolve that location.', '无法解析这个定位目标。'));
        return;
    }
    const exists = await vscode.workspace.fs.stat(target).then(() => true, () => false);
    if (exists) {
        await vscode.commands.executeCommand('revealFileInOS', target);
        return;
    }
    if (target.scheme === 'file') {
        const parent = vscode.Uri.file(path.dirname(target.fsPath));
        const parentExists = await vscode.workspace.fs.stat(parent).then(() => true, () => false);
        if (parentExists) {
            await vscode.commands.executeCommand('revealFileInOS', parent);
            return;
        }
    }
    void vscode.window.showWarningMessage(tBi('The target path does not exist yet.', '目标路径当前不存在。'));
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
export function showMonitorPanel(p: PanelPayload): void {
    lastUsage = p.currentUsage;
    lastAllUsages = p.allTrajectoryUsages;
    if (p.allTrajectories) { lastTrajectories = p.allTrajectories; }
    lastConfigs = p.modelConfigs;
    lastUserInfo = p.userInfo;
    if (p.workspaceUri) { lastWorkspaceUri = p.workspaceUri; }
    if (p.context) { extensionCtx = p.context; }
    if (p.tracker) { lastQuotaTracker = p.tracker; }
    if (p.activitySummary !== undefined) { lastActivitySummary = p.activitySummary; }
    if (p.archives) { lastArchives = p.archives; }
    if (p.activityTracker) { lastActivityTracker = p.activityTracker; }
    if (p.gmSummary !== undefined) { lastGMSummary = p.gmSummary; }
    if (p.gmFullSummary !== undefined) { lastGMFullSummary = p.gmFullSummary; }
    if (p.gmConversations) { lastGMConversations = p.gmConversations; }
    if (p.pricingStore) { lastPricingStore = p.pricingStore; }
    if (p.dailyStore) { lastDailyStore = p.dailyStore; }
    if (p.storageDiagnostics) { lastStorageDiagnostics = p.storageDiagnostics; }
    if (p.modelDNA) { lastModelDNA = p.modelDNA; }
    if (p.accountSnapshots) { lastAccountSnapshots = p.accountSnapshots; }

    if (panel) {
        panel.webview.html = buildHtml(p.currentUsage, p.allTrajectoryUsages, p.modelConfigs, p.userInfo, isPaused, lastQuotaTracker);
        panel.reveal(vscode.ViewColumn.Two, true);
        if (p.initialTab) { setTimeout(() => safePostMessage({ command: 'switchToTab', tab: p.initialTab }), 100); }
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Antigravity Monitor', 'Antigravity 监控面板')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
        { enableScripts: true },
    );

    panel.webview.html = buildHtml(p.currentUsage, p.allTrajectoryUsages, p.modelConfigs, p.userInfo, isPaused, lastQuotaTracker);
    if (p.initialTab) { setTimeout(() => safePostMessage({ command: 'switchToTab', tab: p.initialTab }), 100); }

    panel.webview.onDidReceiveMessage(async (msg: { command: string; lang?: string; value?: unknown; key?: string; action?: string; cascadeId?: string; uri?: string; email?: string; day?: number }) => {
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
                'statusBar.showAiCredits',
                'showModelInternalId',
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
        } else if (msg.command === 'setAccountBillingDay' && msg.email && typeof msg.day === 'number') {
            const saved = setAccountBillingDay(msg.email, msg.day);
            if (saved && panel) {
                safePostMessage({ command: 'configSaved', key: 'accountBillingDay' });
            }
        } else if (msg.command === 'copyStatePath' && lastStorageDiagnostics?.stateFilePath) {
            await vscode.env.clipboard.writeText(lastStorageDiagnostics.stateFilePath);
            safePostMessage({ command: 'configSaved', key: 'statePath' });
        } else if (msg.command === 'openStateFile' && lastStorageDiagnostics?.stateFilePath) {
            const uri = vscode.Uri.file(lastStorageDiagnostics.stateFilePath);
            const stat = await vscode.workspace.fs.stat(uri).then(result => result, () => null);
            if (!stat) {
                const warning = tBi('State file has not been created yet.', '状态文件尚未生成。');
                void vscode.window.showWarningMessage(warning);
                safePostMessage({ command: 'stateFileActionResult', action: 'open', ok: false, message: warning });
                return;
            }
            const decision = await confirmLargeStateFileOpen(typeof stat.size === 'number' ? stat.size : 0);
            if (decision === 'cancel') {
                safePostMessage({
                    command: 'stateFileActionResult',
                    action: 'open',
                    ok: false,
                    message: tBi('Open cancelled.', '已取消打开。'),
                });
                return;
            }
            if (decision === 'reveal') {
                try {
                    await vscode.commands.executeCommand('revealFileInOS', uri);
                    safePostMessage({ command: 'stateFileActionResult', action: 'reveal', ok: true });
                } catch (err) {
                    reportStateFileError('reveal', err);
                }
                return;
            }
            try {
                await openUriInEditor(uri);
                safePostMessage({ command: 'stateFileActionResult', action: 'open', ok: true });
            } catch (err) {
                reportStateFileError('open', err);
            }
        } else if (msg.command === 'revealStateFile' && lastStorageDiagnostics?.stateFilePath) {
            const uri = vscode.Uri.file(lastStorageDiagnostics.stateFilePath);
            const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
            const target = exists ? uri : vscode.Uri.file(path.dirname(lastStorageDiagnostics.stateFilePath));
            try {
                await vscode.commands.executeCommand('revealFileInOS', target);
                safePostMessage({ command: 'stateFileActionResult', action: 'reveal', ok: true });
            } catch (err) {
                reportStateFileError('reveal', err);
            }
        } else if (msg.command === 'historyAction' && msg.action) {
            if (msg.action === 'workspace') {
                await revealUriOrParent(workspaceTargetFromUri(msg.uri || ''));
            } else if ((msg.action === 'record' || msg.action === 'pb') && msg.cascadeId) {
                await revealUriOrParent(getConversationTarget(msg.cascadeId, msg.action));
            }
        } else if (msg.command === 'setPanelPref' && msg.key && ['panelShowTabScrollHint', 'panelShowScrollbar', 'panelShowEndOfContent'].includes(msg.key)) {
            if (panelDurableState) {
                panelDurableState.update(msg.key, !!msg.value);
            }
            safePostMessage({ command: 'panelPrefUpdated', key: msg.key, value: !!msg.value });
            safePostMessage({ command: 'configSaved', key: msg.key });
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
            // Persist cleared activity state to globalState
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
        } else if (msg.command === 'switchCalendarMonth' && typeof (msg as Record<string, unknown>).year === 'number') {
            calendarYear = (msg as Record<string, unknown>).year as number;
            calendarMonth = (msg as Record<string, unknown>).month as number;
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'devSimulateReset') {
            await vscode.commands.executeCommand('antigravity-context-monitor.devSimulateReset');
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                safePostMessage({ command: 'switchToTab', tab: 'settings' });
            }
        } else if (msg.command === 'devRestoreReset') {
            await vscode.commands.executeCommand('antigravity-context-monitor.devRestoreReset');
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
                safePostMessage({ command: 'switchToTab', tab: 'settings' });
            }
        } else if (msg.command === 'removeAccount' && typeof (msg as Record<string, unknown>).email === 'string') {
            const email = (msg as Record<string, unknown>).email as string;
            const updated = removeAccountSnapshot(email);
            lastAccountSnapshots = updated;
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        } else if (msg.command === 'clearToolCatalog') {
            await vscode.commands.executeCommand('antigravity-context-monitor.clearToolCatalog');
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused, lastQuotaTracker);
            }
        }
    });

    // Refresh content immediately when panel becomes visible again after being hidden.
    // Without retainContextWhenHidden, VS Code destroys the webview DOM when hidden
    // and restores from the stale webview.html when re-shown. This listener ensures
    // the panel is updated with the latest cached data as soon as it reappears,
    // instead of waiting for the next polling cycle.
    panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible && !isPaused) {
            safePostMessage({
                command: 'updateTabs',
                tabs: buildTabContents(
                    lastUsage, lastAllUsages, lastConfigs, lastUserInfo, lastQuotaTracker,
                ),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            });
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
export function updateMonitorPanel(p: PanelPayload): void {
    lastUsage = p.currentUsage;
    lastAllUsages = p.allTrajectoryUsages;
    if (p.allTrajectories) { lastTrajectories = p.allTrajectories; }
    lastConfigs = p.modelConfigs;
    lastUserInfo = p.userInfo;
    if (p.workspaceUri) { lastWorkspaceUri = p.workspaceUri; }
    if (p.tracker) { lastQuotaTracker = p.tracker; }
    if (p.activitySummary !== undefined) { lastActivitySummary = p.activitySummary; }
    if (p.archives) { lastArchives = p.archives; }
    if (p.gmSummary !== undefined) { lastGMSummary = p.gmSummary; }
    if (p.gmFullSummary !== undefined) { lastGMFullSummary = p.gmFullSummary; }
    if (p.gmConversations) { lastGMConversations = p.gmConversations; }
    if (p.storageDiagnostics) { lastStorageDiagnostics = p.storageDiagnostics; }
    if (p.modelDNA) { lastModelDNA = p.modelDNA; }
    if (p.accountSnapshots) { lastAccountSnapshots = p.accountSnapshots; }
    if (p.pendingArchives !== undefined) { lastPendingArchives = p.pendingArchives; }
    if (panel && !isPaused) {
        // Incremental update: send tab contents via postMessage — no DOM teardown
        safePostMessage({
            command: 'updateTabs',
            tabs: buildTabContents(p.currentUsage, p.allTrajectoryUsages, p.modelConfigs, p.userInfo, lastQuotaTracker),
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
): Record<string, string | boolean> {
    const eoc = `<div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>`;
    return {

        gmdata: buildGMDataTabContent(lastActivitySummary, lastGMSummary, usage, lastAccountSnapshots, lastPendingArchives) + eoc,
        chats: buildChatHistoryTabContent(lastTrajectories, usage, lastGMSummary, lastGMConversations, lastWorkspaceUri) + eoc,
        pricing: (lastPricingStore
            ? buildPricingTabContent(
                lastGMFullSummary || lastGMSummary,
                lastPricingStore,
                lastDailyStore?.getMonthCostBreakdown(new Date().getFullYear(), new Date().getMonth() + 1),
                lastPendingArchives.reduce((s, e) => s + (e.estimatedCost || 0), 0),
            )
            : `<p class="empty-msg">${tBi('Initializing...', '初始化中...')}</p>`) + eoc,
        models: buildModelsTabContent(userInfo, configs, lastGMSummary, lastModelDNA) + eoc,
        history: buildHistoryHtml(tracker, lastUserInfo?.email) + eoc,
        calendar: buildCalendarTabContent(lastDailyStore ?? undefined, calendarYear, calendarMonth) + eoc,
        profile: buildProfileContent(userInfo, configs, getBillingDaysMap()[userInfo?.email ?? ''] ?? 0) + eoc,
        about: buildAboutTabContent() + eoc,
        // Account popover: content-only update, does NOT affect open/close state
        accountPopover: lastAccountSnapshots.length > 0 ? buildAccountStatusPanel(lastAccountSnapshots, getBillingDaysMap()) : '',
        accountPopoverHasReady: lastAccountSnapshots.length > 0 ? hasAccountReadyPool(lastAccountSnapshots) : false,
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

    const gmDataHtml = buildGMDataTabContent(lastActivitySummary, lastGMSummary, usage, lastAccountSnapshots, lastPendingArchives);
    const chatsHtml = buildChatHistoryTabContent(lastTrajectories, usage, lastGMSummary, lastGMConversations, lastWorkspaceUri);
    const pricingHtml = lastPricingStore
        ? buildPricingTabContent(
            lastGMFullSummary || lastGMSummary,
            lastPricingStore,
            lastDailyStore?.getMonthCostBreakdown(new Date().getFullYear(), new Date().getMonth() + 1),
            lastPendingArchives.reduce((s, e) => s + (e.estimatedCost || 0), 0),
        )
        : `<p class="empty-msg">${tBi('Initializing...', '初始化中...')}</p>`;
    const modelsHtml = buildModelsTabContent(userInfo, configs, lastGMSummary, lastModelDNA);
    const historyHtml = buildHistoryHtml(tracker, lastUserInfo?.email);
    const calendarHtml = buildCalendarTabContent(lastDailyStore ?? undefined, calendarYear, calendarMonth);
    const profileHtml = buildProfileContent(userInfo, configs, getBillingDaysMap()[userInfo?.email ?? ''] ?? 0);
    const settingsHtml = buildSettingsContent(configs, tracker, lastStorageDiagnostics, getPanelHintPreferences());
    const panelHintPrefs = getPanelHintPreferences();

    const currentLang = getLanguage();
    const htmlLang = currentLang === 'zh' ? 'zh-CN' : currentLang === 'en' ? 'en' : 'zh-CN';
    return `<!DOCTYPE html>
<html lang="${htmlLang}" data-hide-scrollbar="${panelHintPrefs.showScrollbar ? 'false' : 'true'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getStyles()}
${getGMDataTabStyles()}
${getPricingTabStyles()}
${getCalendarTabStyles()}
${getAboutTabStyles()}
</style>
</head>
<body data-privacy-default="true" data-zoom="${panelDurableState?.get<number>('panelZoomLevel', 100) ?? 100}" data-tab-hint-enabled="${panelHintPrefs.showTabScrollHint ? 'true' : 'false'}" data-hide-scrollbar="${panelHintPrefs.showScrollbar ? 'false' : 'true'}" data-hide-eoc="${panelHintPrefs.showEndOfContent ? 'false' : 'true'}">
    <div class="panel-topbar">
        <header class="topbar-title">
            <div class="topbar-title-left">
                <h1>
                    ${ICON.chart}
                    ${tBi('Antigravity Monitor', 'Antigravity 监控面板')}
                </h1>
                <div class="acct-popover-anchor">
                    <button class="acct-popover-trigger" id="acctPopoverTrigger">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16.5 6.5l2 -2M18 8l2.5 -1M18.5 4.5L20 2.5" opacity="0.5"/></svg>
                        <span>${tBi('Account Panel', '账号面板')}</span>
                        ${hasAccountReadyPool(lastAccountSnapshots) ? '<span class="acct-popover-dot"></span>' : ''}
                    </button>
                </div>
            </div>
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

        <div class="tab-bar-wrapper">
        <button class="tab-arrow tab-arrow-left is-faded" id="tabArrowLeft" aria-label="${tBi('Scroll tabs left', '向左滚动标签')}">
            <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/></svg>
        </button>
        <nav class="tab-bar" id="tabBar">
        <div class="tab-slider"></div>
        <button class="tab-btn active" data-tab="gmdata" data-color="orange">${ICON.bolt} ${tBi('GM Data', 'GM 数据')}</button>
        <button class="tab-btn" data-tab="chats" data-color="cyan">${ICON.chat} ${tBi('Sessions', '会话')}</button>
        <button class="tab-btn" data-tab="pricing" data-color="blue"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.315 0-1.667-1.104-2.512-3.233-3.037l-.445-.107V3.63c1.213.183 1.968.91 2.141 1.88h1.762c-.112-1.796-1.519-2.965-3.455-3.124V1.036H8.59v1.383C6.408 2.583 5.008 3.9 5.003 5.54c0 1.592 1.063 2.457 3.146 2.963l.399.1v3.979c-1.29-.183-2.113-.879-2.275-1.8H4zm4.586-4.34C7.494 6.137 6.94 5.695 6.94 5.092c0-.66.52-1.183 1.575-1.37v2.72h.071zm.889 2.283c1.335.36 1.942.846 1.942 1.548 0 .781-.633 1.35-1.823 1.493V8.851l-.119-.127z"/></svg> ${tBi('Cost', '成本')}</button>
        <button class="tab-btn" data-tab="models" data-color="green">${ICON.bolt} ${tBi('Models', '模型')}</button>
        <button class="tab-btn" data-tab="history" data-color="yellow">${ICON.timeline} ${tBi('Quota Tracking', '额度追踪')}</button>
        <button class="tab-btn" data-tab="calendar" data-color="cyan"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg> ${tBi('Calendar', '日历')}</button>
        <button class="tab-btn" data-tab="profile" data-color="gray">${ICON.user} ${tBi('Profile', '个人')}</button>
        <button class="tab-btn" data-tab="settings" data-color="gray">${ICON.shield} ${tBi('Settings', '设置')}</button>
        <button class="tab-btn" data-tab="about" data-color="orange"><svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg> ${tBi('About', '关于')}</button>
    </nav>
        <button class="tab-arrow tab-arrow-right is-faded" id="tabArrowRight" aria-label="${tBi('Scroll tabs right', '向右滚动标签')}">
            <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>
        </button>
    </div>

    <div class="tab-scroll-hint" id="tabScrollHint" hidden>
        <span class="tab-scroll-hint-text">${ICON.timeline} <span>${tBi('Too many tabs? Hold Shift and use the mouse wheel to scroll horizontally.', '标签过多时，可按住 Shift 再滚动鼠标滚轮进行横向滚动。')}</span></span>
        <button class="tab-scroll-hint-close" id="dismissTabScrollHint" aria-label="${tBi('Dismiss tab scroll hint', '关闭标签滚动提示')}">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06"/></svg>
        </button>
    </div>
    <div class="acct-popover-dropdown" id="acctPopoverPanel" hidden>
        <div class="acct-popover-body" id="acctPopoverBody">
            ${lastAccountSnapshots.length > 0 ? buildAccountStatusPanel(lastAccountSnapshots, getBillingDaysMap()) : `<p class="empty-msg">${tBi('No account data yet.', '暂无账号数据。')}</p>`}
        </div>
    </div>
    </div>
    <div class="tab-pane active" id="tab-gmdata">
        ${gmDataHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-chats">
        ${chatsHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-pricing">
        ${pricingHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-models">
        ${modelsHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-history">
        ${historyHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-calendar">
        ${calendarHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-profile">
        ${profileHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-settings">
        ${settingsHtml}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>
    <div class="tab-pane" id="tab-about">
        ${buildAboutTabContent()}
        <div class="eoc-sentinel"><span class="eoc-sentinel-text">${tBi('— End of content —', '— 已到底 —')}</span></div>
    </div>

    <script>
        ${getScript()}
    </script>
</body>
</html>`;
}

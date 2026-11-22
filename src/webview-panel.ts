import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { tBi, getLanguage, setLanguage, isLanguage, formatClockTime } from './i18n';
import { ContextUsage, TrajectorySummary } from './tracker';
import { ModelConfig, UserStatusInfo, type OrchestratorSettings, type UserQuotaSummary } from './models';
import { ActivityTracker, ActivitySummary, ActivityArchive } from './activity-tracker';
import type { AccountSnapshot } from './activity-panel';
import {
    removeAccountSnapshot,
    getBillingDaysMap,
    setAccountBillingDay,
    refreshStatusBarTelemetry,
    getLockToMainAgent,
    setLockToMainAgent,
    selectPinnedConversation,
} from './extension';
import type { LedgerAccountBucket, LedgerSettledEntry } from './daily-ledger';
import { PricingStore, ModelPricing } from './pricing-store';
import { GMSummary, GMConversationData } from './gm-tracker';
import { formatFileSize } from './webview-helpers';
import {
    registerSettingsProvider,
    type StorageDiagnostics,
    type PanelHintPreferences,
    type MonitorDocumentSettings,
} from './webview-settings-tab';
import { DailyStore } from './daily-store';
import { parseTooltipDensity } from './tooltip-budget';
import type { MonitorStatus, OverviewDestination } from './monitor-overview';
import type { StateBucket } from './durable-state';
import type { PersistedModelDNA } from './model-dna-store';
import {
    formatContextTextReport,
    formatHandoffPrompt,
    parseContextBreakdown,
    type ContextBreakdownSnapshot,
    type ContextQuotaSummaryLine,
} from './context-breakdown';
import { selectMonitorQuotaGroups } from './monitor-overview';
import { formatResetCountdown } from './reset-time';
import { t } from './i18n-core';
import type { TurnDiagnosticsSummary } from './turn-diagnostics';
import type { QuotaRunwayEstimate } from './quota-runway';
import type { ConversationOption } from './conversation-selector';
import type { MonitorStaleState } from './webview-overview-tab';
import {
    buildMonitorDocumentHtml,
    buildMonitorTabsPayload,
    type MonitorDocumentBuildParams,
} from './webview-document';

// ─── Panel Payload ────────────────────────────────────────────────────────────

/** Unified data payload for showMonitorPanel / updateMonitorPanel. */
export interface PanelPayload {
    currentUsage: ContextUsage | null;
    monitorStatus?: MonitorStatus;
    allTrajectoryUsages: ContextUsage[];
    allTrajectories?: TrajectorySummary[];
    modelConfigs: ModelConfig[];
    userInfo: UserStatusInfo | null;
    workspaceUri?: string;
    context?: vscode.ExtensionContext;
    activitySummary?: ActivitySummary | null;
    initialTab?: OverviewDestination | 'gmdata' | 'pricing';
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
    /** DailyLedger: today's active (unsettled) account buckets */
    todayLedgerActive?: LedgerAccountBucket[];
    /** DailyLedger: settled entries from quota resets */
    ledgerSettled?: LedgerSettledEntry[];
    /** User custom model prices — applied when re-pricing Today's Ledger from tokens */
    customPricing?: Record<string, ModelPricing>;
    /** Global Orchestrator Settings (Orchestrator Model + Executor Model + roles). */
    orchestratorSettings?: OrchestratorSettings | null;
    /** Dual-window (5h + weekly) quota summary from RetrieveUserQuotaSummary. */
    quotaSummary?: UserQuotaSummary | null;
    /** Today's total estimated cost in USD (active + settled ledger). */
    todayCostUsd?: number;
    /** Current session/active conversation estimated cost in USD. */
    sessionCostUsd?: number;
    /** v1.17.5 Context Composition Breakdown snapshot. */
    contextBreakdown?: ContextBreakdownSnapshot | null;
    /** v1.17.5 Per-turn cache / delta diagnostics. */
    turnDiagnostics?: TurnDiagnosticsSummary | null;
    /** v1.17.5 Per-pool quota burn-rate runway estimates. */
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    /** v1.17.5 True when active model is a custom-* / BYOK / local model. */
    isCustomModelActive?: boolean;
    /** v1.17.5 Stale-cache status during transient RPC hiccups. */
    staleState?: MonitorStaleState | null;
    /** v1.17.5 Conversation Switcher options. */
    conversationOptions?: ConversationOption[];
    /** v1.17.5 Currently active conversation cascadeId. */
    activeConversationId?: string | null;
    /** v1.17.5 Manually pinned conversation cascadeId (null = Follow Active). */
    pinnedConversationId?: string | null;
    /** v1.17.5 Whether Lock to Main Agent is active. */
    lockToMainAgent?: boolean;
}

// ─── Panel State ──────────────────────────────────────────────────────────────

let panel: vscode.WebviewPanel | undefined;
let extensionCtx: vscode.ExtensionContext | undefined;
let nextTabRequest = 0;
let pendingTab: { tab: string; requestId: number } | undefined;

/** Cached data for re-rendering after language switch. */
let lastUsage: ContextUsage | null = null;
let lastMonitorStatus: MonitorStatus | undefined;
let lastAllUsages: ContextUsage[] = [];
let lastTrajectories: TrajectorySummary[] = [];
let lastConfigs: ModelConfig[] = [];
let lastUserInfo: UserStatusInfo | null = null;
let lastWorkspaceUri = '';
let lastActivitySummary: ActivitySummary | null = null;
let lastGMSummary: GMSummary | null = null;
/** Full summary with ALL accounts — Cost tab uses this for cross-account cost calculation. */
let lastGMFullSummary: GMSummary | null = null;
let lastGMConversations: Record<string, GMConversationData> = {};
let lastPricingStore: PricingStore | undefined;
let lastDailyStore: DailyStore | undefined;
let lastStorageDiagnostics: StorageDiagnostics | undefined;
let panelDurableState: StateBucket | undefined;
let lastAccountSnapshots: AccountSnapshot[] = [];
let lastTodayLedgerActive: LedgerAccountBucket[] = [];
let lastLedgerSettled: LedgerSettledEntry[] = [];
let lastCustomPricing: Record<string, ModelPricing> = {};
let lastOrchestratorSettings: OrchestratorSettings | null = null;
let lastQuotaSummary: UserQuotaSummary | null = null;
let lastTodayCostUsd: number | undefined;
let lastSessionCostUsd: number | undefined;
let lastContextBreakdown: ContextBreakdownSnapshot | null = null;
let lastTurnDiagnostics: TurnDiagnosticsSummary | null = null;
let lastQuotaRunways: Record<string, QuotaRunwayEstimate> | undefined;
let lastIsCustomModelActive = false;
let lastStaleState: MonitorStaleState | null = null;
let lastConversationOptions: ConversationOption[] = [];
let lastActiveConversationId: string | null = null;
let lastPinnedConversationId: string | null = null;
let lastLockToMainAgent = false;
export const LARGE_STATE_FILE_WARN_BYTES = 1 * 1024 * 1024;
const SAFE_CASCADE_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;

/** Provide a durable state bucket for panel-level persistence (zoom, etc.). */
export function setPanelDurableState(state: StateBucket): void {
    panelDurableState = state;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function sanitizeConfigValue(key: string, value: unknown): unknown {
    switch (key) {
        case 'statusBar.tooltipDensity':
            return parseTooltipDensity(value);
        case 'statusBar.showContext':
        case 'statusBar.showQuota':
        case 'statusBar.showResetCountdown':
        case 'statusBar.showAiCredits':
        case 'statusBar.showSpeed':
        case 'statusBar.showCacheHit':
        case 'statusBar.showSessionCost':
        case 'showModelInternalId':
            return !!value;
        case 'quotaNotificationThreshold':
            return clamp(Number(value) || 0, 0, 99);
        case 'activity.maxRecentSteps':
            return clamp(Number(value) || 100, 10, 500);
        case 'activity.maxArchives':
            return clamp(Number(value) || 20, 1, 100);
        default:
            return value;
    }
}

function readIdeDocumentSettings(): MonitorDocumentSettings {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
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
        tooltipDensity: parseTooltipDensity(cfg.get('statusBar.tooltipDensity', 'auto')),
        showModelInternalId: cfg.get<boolean>('showModelInternalId', false),
        maxRecentSteps: cfg.get<number>('activity.maxRecentSteps', 100),
        maxArchives: cfg.get<number>('activity.maxArchives', 20),
        lockToMainAgent: getLockToMainAgent(),
    };
}

registerSettingsProvider(readIdeDocumentSettings);

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
    pendingTab = undefined;
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

function buildFallbackSnapshotForReport(): ContextBreakdownSnapshot {
    if (lastContextBreakdown) {
        return lastContextBreakdown;
    }
    return parseContextBreakdown({
        model: lastUsage?.model,
        modelDisplayName: lastUsage?.modelDisplayName,
        effectiveBudgetTokens: lastUsage?.contextLimit,
        currentStepCount: lastUsage?.stepCount,
        previousUsedTokens: lastUsage?.contextUsed,
    });
}

function buildIdeQuotaSummaryLines(): ContextQuotaSummaryLine[] {
    if (lastIsCustomModelActive || lastConfigs.length === 0) {
        return [];
    }
    const lang = getLanguage();
    const groups = selectMonitorQuotaGroups(lastConfigs, lastUsage?.model, lastQuotaSummary);
    return groups.map(group => {
        const pct = group.minimum !== null ? Math.round(group.minimum * 100) : 0;
        const rw = lastQuotaRunways
            ? ((group.pool && lastQuotaRunways[group.pool]) || lastQuotaRunways[group.key])
            : undefined;
        const runwayLabel = rw?.status === 'safe_until_reset'
            ? t('quota.safeBeforeReset', lang)
            : rw?.status === 'at_risk' && rw.estExhaustMs !== null
                ? `${t('quota.exhaustsIn', lang)} ${Math.max(1, Math.round(rw.estExhaustMs / 60_000))}m`
                : undefined;
        return {
            poolName: group.label,
            remainingPct: pct,
            resetCountdown: group.resetTime ? formatResetCountdown(group.resetTime) : undefined,
            runwayLabel,
        };
    });
}

function cachePayload(p: PanelPayload): void {
    lastUsage = p.currentUsage;
    lastMonitorStatus = p.monitorStatus;
    lastAllUsages = p.allTrajectoryUsages;
    if (p.allTrajectories) { lastTrajectories = p.allTrajectories; }
    lastConfigs = p.modelConfigs;
    lastUserInfo = p.userInfo;
    if (p.workspaceUri) { lastWorkspaceUri = p.workspaceUri; }
    if (p.context) { extensionCtx = p.context; }
    if (p.activitySummary !== undefined) { lastActivitySummary = p.activitySummary; }
    if (p.gmSummary !== undefined) { lastGMSummary = p.gmSummary; }
    if (p.gmFullSummary !== undefined) { lastGMFullSummary = p.gmFullSummary; }
    if (p.gmConversations) { lastGMConversations = p.gmConversations; }
    if (p.pricingStore) { lastPricingStore = p.pricingStore; }
    if (p.dailyStore) { lastDailyStore = p.dailyStore; }
    if (p.storageDiagnostics) { lastStorageDiagnostics = p.storageDiagnostics; }
    if (p.accountSnapshots) { lastAccountSnapshots = p.accountSnapshots; }
    if (p.todayLedgerActive) { lastTodayLedgerActive = p.todayLedgerActive; }
    if (p.ledgerSettled) { lastLedgerSettled = p.ledgerSettled; }
    if (p.customPricing !== undefined) { lastCustomPricing = p.customPricing; }
    if (p.orchestratorSettings !== undefined) { lastOrchestratorSettings = p.orchestratorSettings; }
    if (p.quotaSummary !== undefined) { lastQuotaSummary = p.quotaSummary; }
    if ('todayCostUsd' in p) { lastTodayCostUsd = p.todayCostUsd; }
    if ('sessionCostUsd' in p) { lastSessionCostUsd = p.sessionCostUsd; }
    if ('contextBreakdown' in p) { lastContextBreakdown = p.contextBreakdown ?? null; }
    if ('turnDiagnostics' in p) { lastTurnDiagnostics = p.turnDiagnostics ?? null; }
    if ('quotaRunways' in p) { lastQuotaRunways = p.quotaRunways; }
    if ('isCustomModelActive' in p) { lastIsCustomModelActive = !!p.isCustomModelActive; }
    if ('staleState' in p) { lastStaleState = p.staleState ?? null; }
    if ('conversationOptions' in p) { lastConversationOptions = p.conversationOptions ?? []; }
    if ('activeConversationId' in p) { lastActiveConversationId = p.activeConversationId ?? null; }
    if ('pinnedConversationId' in p) { lastPinnedConversationId = p.pinnedConversationId ?? null; }
    if ('lockToMainAgent' in p) { lastLockToMainAgent = !!p.lockToMainAgent; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show or reveal the WebView monitor panel.
 * Creates the panel on first call, reveals it on subsequent calls.
 */
export function showMonitorPanel(p: PanelPayload): void {
    cachePayload(p);

    if (panel) {
        const wasVisible = panel.visible;
        if (p.initialTab) { pendingTab = { tab: p.initialTab, requestId: ++nextTabRequest }; }
        panel.reveal(undefined, false);
        if (wasVisible) { sendPendingTab(); }
        if (!isPaused) { postCurrentTabs(); }
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Antigravity Monitor', 'Antigravity 监控面板')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
        { enableScripts: true },
    );

    panel.webview.onDidReceiveMessage(async (msg: {
        command: string;
        lang?: string;
        value?: unknown;
        key?: string;
        action?: string;
        cascadeId?: string;
        conversationId?: string | null;
        locked?: boolean;
        uri?: string;
        email?: string;
        day?: number;
        requestId?: number;
    }) => {
        if (msg.command === 'panelReady') {
            sendPendingTab();
            if (!isPaused) { postCurrentTabs(); }
        } else if (msg.command === 'tabShown') {
            if (msg.requestId === pendingTab?.requestId) { pendingTab = undefined; }
        } else if (msg.command === 'switchLanguage' && extensionCtx) {
            if (!isLanguage(msg.lang)) {
                console.warn('[Antigravity Context Monitor] Ignoring invalid language switch request:', msg.lang);
                return;
            }
            await setLanguage(msg.lang, extensionCtx, panelDurableState);
            refreshMonitorPanelLanguage();
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'refresh') {
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'togglePause') {
            isPaused = !isPaused;
            safePostMessage({ command: 'setPaused', paused: isPaused });
            if (!isPaused) { postCurrentTabs(); }
        } else if (msg.command === 'selectConversation' || msg.command === 'pinConversation') {
            const rawTarget = msg.conversationId !== undefined ? msg.conversationId : msg.cascadeId;
            const targetId = typeof rawTarget === 'string' && rawTarget.trim() && rawTarget !== 'auto' && rawTarget !== '__auto__'
                ? rawTarget.trim()
                : null;
            lastPinnedConversationId = targetId;
            selectPinnedConversation(targetId);
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'toggleLockMain' || msg.command === 'setLockToMainAgent') {
            const explicitLocked = typeof msg.locked === 'boolean'
                ? msg.locked
                : (typeof msg.value === 'boolean' ? msg.value : undefined);
            const nextLocked = setLockToMainAgent(explicitLocked);
            lastLockToMainAgent = nextLocked;
            safePostMessage({ command: 'syncSettingsControls', lockToMainAgent: nextLocked });
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'copyContextReport') {
            const snapshot = buildFallbackSnapshotForReport();
            const text = formatContextTextReport({
                snapshot,
                title: lastUsage?.title,
                workspacePath: lastWorkspaceUri || undefined,
                branchName: lastUsage?.branchName || undefined,
                cacheHitPct: lastTurnDiagnostics?.lastTurnCacheHitPct ?? lastTurnDiagnostics?.sessionCacheHitPct ?? null,
                turnStartKind: lastTurnDiagnostics?.lastTurnStartKind,
                quotaSummary: buildIdeQuotaSummaryLines(),
            }, getLanguage());
            await vscode.env.clipboard.writeText(text);
            safePostMessage({ command: 'copyActionResult', action: 'copyContextReport', ok: true });
        } else if (msg.command === 'copyHandoffPrompt') {
            const snapshot = buildFallbackSnapshotForReport();
            const activeTools = lastGMSummary?.toolCallCounts
                ? Object.entries(lastGMSummary.toolCallCounts)
                    .filter(([, count]) => count > 0)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([name]) => name)
                : [];
            const text = formatHandoffPrompt({
                snapshot,
                title: lastUsage?.title,
                workspacePath: lastWorkspaceUri || undefined,
                branchName: lastUsage?.branchName || undefined,
                model: lastUsage?.model,
                modelDisplayName: lastUsage?.modelDisplayName,
                activeTools,
            }, getLanguage());
            await vscode.env.clipboard.writeText(text);
            safePostMessage({ command: 'copyActionResult', action: 'copyHandoffPrompt', ok: true });
        } else if (msg.command === 'setPollingInterval' && typeof msg.value === 'number') {
            const val = Math.max(1, Math.min(60, msg.value));
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('pollingInterval', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                safePostMessage({ command: 'configSaved', key: 'pollingInterval' });
            }
        } else if (msg.command === 'setConfig' && msg.key) {
            const allowedKeys = [
                'statusBar.tooltipDensity',
                'statusBar.showContext',
                'statusBar.showQuota',
                'statusBar.showResetCountdown',
                'statusBar.showAiCredits',
                'statusBar.showSpeed',
                'statusBar.showCacheHit',
                'statusBar.showSessionCost',
                'showModelInternalId',
                'quotaNotificationThreshold',
                'activity.maxRecentSteps',
                'activity.maxArchives',
            ];
            if (allowedKeys.includes(msg.key)) {
                const normalizedValue = sanitizeConfigValue(msg.key, msg.value);
                await vscode.workspace.getConfiguration('antigravityContextMonitor')
                    .update(msg.key, normalizedValue, vscode.ConfigurationTarget?.Global);
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
            } else if ((msg.action === 'record' || msg.action === 'pb') && msg.cascadeId && SAFE_CASCADE_ID_RE.test(msg.cascadeId.trim())) {
                await revealUriOrParent(getConversationTarget(msg.cascadeId.trim(), msg.action));
            }
        } else if (msg.command === 'setPanelPref' && msg.key && ['panelShowTabScrollHint', 'panelShowScrollbar', 'panelShowEndOfContent'].includes(msg.key)) {
            if (panelDurableState) {
                panelDurableState.update(msg.key, !!msg.value);
            }
            safePostMessage({ command: 'panelPrefUpdated', key: msg.key, value: !!msg.value });
            safePostMessage({ command: 'configSaved', key: msg.key });
        } else if (msg.command === 'setZoomLevel' && typeof msg.value === 'number') {
            const zoom = clamp(Math.round(msg.value as number), 50, 200);
            if (panelDurableState) {
                panelDurableState.update('panelZoomLevel', zoom);
            }
        } else if ((msg.command === 'savePricing' || msg.command === 'saveCustomPricing') && lastPricingStore) {
            const rawRec = msg as Record<string, unknown>;
            const data = (rawRec.overrides ?? rawRec.value) as Record<string, ModelPricing>;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                lastPricingStore.setAll(data).then(() => {
                    lastCustomPricing = lastPricingStore!.getCustom();
                    refreshLocalStorageDiagnostics();
                    refreshStatusBarTelemetry();
                    if (panel) {
                        panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
                        safePostMessage({ command: 'pricingSaved' });
                    }
                });
            }
        } else if ((msg.command === 'resetPricing' || msg.command === 'resetCustomPricing') && lastPricingStore) {
            lastPricingStore.reset().then(() => {
                lastCustomPricing = lastPricingStore!.getCustom();
                refreshLocalStorageDiagnostics();
                refreshStatusBarTelemetry();
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
                    safePostMessage({ command: 'pricingReset' });
                }
            });
        } else if (msg.command === 'clearCalendarHistory' && lastDailyStore) {
            lastDailyStore.clear();
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        } else if (msg.command === 'switchCalendarMonth' && typeof (msg as Record<string, unknown>).year === 'number') {
            calendarYear = (msg as Record<string, unknown>).year as number;
            calendarMonth = (msg as Record<string, unknown>).month as number;
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        } else if ((msg.command === 'removeAccount' || msg.command === 'removeAccountSnapshot') && typeof (msg as Record<string, unknown>).email === 'string') {
            const email = (msg as Record<string, unknown>).email as string;
            const updated = removeAccountSnapshot(email);
            lastAccountSnapshots = updated;
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        } else if (msg.command === 'clearToolCatalog') {
            await vscode.commands.executeCommand('antigravity-context-monitor.clearToolCatalog');
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        }
    });

    panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
            sendPendingTab();
            if (!isPaused) { postCurrentTabs(); }
        }
    });

    panel.onDidDispose(() => {
        clearDisposedPanel();
    });

    panel.webview.html = buildHtml(p.currentUsage, p.allTrajectoryUsages, p.modelConfigs, p.userInfo, isPaused, p.initialTab);
}

function sendPendingTab(): void {
    if (pendingTab) { safePostMessage({ command: 'switchToTab', ...pendingTab }); }
}

export function refreshMonitorPanelLanguage(): void {
    if (!panel) { return; }
    panel.title = tBi('Antigravity Monitor', 'Antigravity 监控面板');
    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
}

/**
 * Silently update the panel if it is already visible.
 * Does NOT steal focus or create a new panel.
 * When paused, data is cached but the panel is NOT re-rendered.
 */
export function updateMonitorPanel(p: PanelPayload): void {
    cachePayload(p);
    if (panel?.visible && !isPaused) { postCurrentTabs(); }
}

function getExtensionVersion(): string | undefined {
    const raw = (extensionCtx?.extension?.packageJSON as { version?: unknown } | undefined)?.version;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function postSettingsControlSync(): void {
    if (!panel) { return; }
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    safePostMessage({
        command: 'syncSettingsControls',
        showContext: cfg.get<boolean>('statusBar.showContext', true),
        showQuota: cfg.get<boolean>('statusBar.showQuota', true),
        showResetCountdown: cfg.get<boolean>('statusBar.showResetCountdown', true),
        showAiCredits: cfg.get<boolean>('statusBar.showAiCredits', true),
        showSpeed: cfg.get<boolean>('statusBar.showSpeed', false),
        showCacheHit: cfg.get<boolean>('statusBar.showCacheHit', false),
        showSessionCost: cfg.get<boolean>('statusBar.showSessionCost', false),
        showModelInternalId: cfg.get<boolean>('showModelInternalId', false),
        lockToMainAgent: getLockToMainAgent(),
        tooltipDensity: parseTooltipDensity(cfg.get('statusBar.tooltipDensity', 'auto')),
    });
}

/**
 * Sync live VS Code settings changes (e.g. external Settings JSON/UI edits) into
 * the open WebView's Settings controls and optionally force-refresh all tabs
 * even when auto-refresh is paused.
 */
export function syncMonitorPanelSettings(forceRefreshTabs = false): void {
    if (!panel) { return; }
    postSettingsControlSync();
    if (forceRefreshTabs) {
        postCurrentTabs();
    }
}

function makeDocumentParams(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    paused = false,
    initialTab?: PanelPayload['initialTab'],
): MonitorDocumentBuildParams {
    return {
        surface: 'ide',
        version: getExtensionVersion(),
        currentUsage: usage,
        monitorStatus: lastMonitorStatus,
        allTrajectoryUsages: allUsages,
        allTrajectories: lastTrajectories,
        modelConfigs: configs,
        userInfo,
        workspaceUri: lastWorkspaceUri,
        activitySummary: lastActivitySummary,
        gmSummary: lastGMSummary,
        gmFullSummary: lastGMFullSummary,
        gmConversations: lastGMConversations,
        pricingStore: lastPricingStore,
        customPricing: lastPricingStore?.getCustom() ?? lastCustomPricing,
        dailyStore: lastDailyStore,
        storageDiagnostics: lastStorageDiagnostics,
        panelHintPrefs: getPanelHintPreferences(),
        zoomLevel: panelDurableState?.get<number>('panelZoomLevel', 100) ?? 100,
        accountSnapshots: lastAccountSnapshots,
        billingDays: getBillingDaysMap(),
        todayLedgerActive: lastTodayLedgerActive,
        ledgerSettled: lastLedgerSettled,
        orchestratorSettings: lastOrchestratorSettings,
        quotaSummary: lastQuotaSummary,
        todayCostUsd: lastTodayCostUsd,
        sessionCostUsd: lastSessionCostUsd,
        calendarYear,
        calendarMonth,
        paused,
        initialTab,
        settings: readIdeDocumentSettings(),
        contextBreakdown: lastContextBreakdown,
        turnDiagnostics: lastTurnDiagnostics,
        quotaRunways: lastQuotaRunways,
        isCustomModelActive: lastIsCustomModelActive,
        staleState: lastStaleState,
        conversationOptions: lastConversationOptions,
        activeConversationId: lastActiveConversationId ?? usage?.cascadeId ?? null,
        pinnedConversationId: lastPinnedConversationId,
        lockToMainAgent: lastLockToMainAgent,
    };
}

function postCurrentTabs(): void {
    if (!panel) { return; }
    const params = makeDocumentParams(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
    safePostMessage({
        command: 'updateTabs',
        tabs: buildMonitorTabsPayload(params),
        time: formatClockTime(new Date(), getLanguage()),
    });
}

/** Whether the monitor panel is currently open. */
export function isMonitorPanelVisible(): boolean {
    return panel !== undefined;
}

// ─── HTML Builder (delegates directly to pure webview-document.ts) ───────────

function buildHtml(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    paused = false,
    initialTab?: PanelPayload['initialTab'],
): string {
    return buildMonitorDocumentHtml(
        makeDocumentParams(usage, allUsages, configs, userInfo, paused, initialTab),
    );
}

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as vscode from 'vscode';
import { tBi, getLanguage, setLanguage, isLanguage, formatClockTime } from './i18n';
import { ContextUsage, TrajectorySummary } from './tracker';
import { ModelConfig, UserStatusInfo, normalizeModelDisplayName, type OrchestratorSettings, type UserQuotaSummary } from './models';
import { ActivitySummary } from './activity-tracker';
import type { AccountSnapshot } from './activity-panel';
import {
    OPEN_VSX_EXTENSION_URL,
    getIdePanelHostBridge,
    type PanelPayload,
} from './ide-panel-types';
import type { LedgerAccountBucket, LedgerRecordedCall, LedgerSettledEntry, WorkspaceUsageStats } from './daily-ledger';
import { PricingStore, ModelPricing, normalizeOrchestratorPricingMode, type OrchestratorPricingMode } from './pricing-store';
import { GMSummary, GMConversationData } from './gm-tracker';
import { formatFileSize } from './webview-helpers';
import {
    registerSettingsProvider,
    type StorageDiagnostics,
    type PanelHintPreferences,
    type MonitorDocumentSettings,
    type UpdateStatusView,
} from './webview-settings-tab';
import { DailyStore, redactDailyRecordIdentities } from './daily-store';
import { parseTooltipDensity } from './tooltip-budget';
import type { MonitorStatus } from './monitor-overview';
import { isUpdateAvailableForVersion, type AppSettings, type StateBucket } from './durable-state';
import {
    formatContextTextReport,
    parseContextBreakdown,
    type ContextBreakdownSnapshot,
    type ContextQuotaSummaryLine,
} from './context-breakdown';
import { selectMonitorQuotaGroups } from './monitor-overview';
import { formatResetCountdown } from './reset-time';
import { t } from './i18n-core';
import type { TurnDiagnosticsSummary } from './turn-diagnostics';
import type { QuotaRunwayEstimate } from './quota-runway';
import {
    detectPathCaseSensitivity,
    normalizeWorkspaceUri,
    type ConversationOption,
    type PathCaseProbeFs,
    type WindowSelectionState,
} from './conversation-selector';
import type { LowQuotaWarningState, MonitorStaleState } from './webview-overview-tab';
import {
    buildMonitorDocumentHtml,
    buildMonitorTabsPayload,
    type MonitorDocumentBuildParams,
} from './webview-document';
import { buildProfileContent } from './webview-profile-tab';
import {
    buildCalendarExportData,
    type CalendarMetricMode,
    type CalendarPeriodMode,
    type CalendarRenderOptions,
    type CalendarSourceFilter,
    type CalendarViewMode,
} from './webview-calendar-tab';
import { toLocalDateKey } from './daily-archival';
import {
    buildCalendarExportCsv,
    buildCalendarExportJson,
    buildCalendarExportMarkdown,
    normalizeSubscriptionPlanId,
    type CliDailyUsageRecord,
    type SubscriptionConfig,
    type SubscriptionPlanPresetId,
} from './cli-usage-scanner';
import {
    normalizeCurrencyCode,
    resolveAppCurrencyConfig,
    type CurrencyConfig,
} from './core/currency';
import { validateExternalUrl } from './core/external-url';
import { resolveRuntimeVersion } from './core/version';
import { validateCustomPricingOverrides } from './core/pricing-validation';
import type { PublishedMonitorObservation } from './core/context-display';
import type { SwarmTopologySnapshot } from './core/swarm-registry';
import {
    getCdpPlatformGuide,
    inspectCdpLauncherStatus,
    probeCdpAvailability,
} from './app/cdp-discovery';
import {
    assertSafeMacOsBundleWriteTarget,
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    isOwnedMacCdpBundle,
    isSymlinkPath,
    resolveCoreCdpLauncherPaths,
    type CoreLauncherPathOptions,
} from './core/cdp-launcher-core';
import {
    buildAllowlistedHandoffV2,
    formatCompactionRecoveryBriefForPrivacy,
    getIdeV118HostHooks,
    normalizeCdpOverlayFontSize,
    type CdpLauncherStatus,
    type CdpStatus,
    type CompactionRecoveryBrief,
    type HandoffV2Result,
} from './app/sidecar-types';
import {
    DEFAULT_GLOBAL_RULES_TEMPLATE,
    GLOBAL_RULES_MAX_BYTES,
    getGlobalRulesPath,
    readGlobalRulesStatus,
    validateGlobalRulesRevealTarget,
    writeGlobalRulesFile,
    type GlobalRulesStatus,
} from './global-rules';

export type { PanelPayload };

// ─── Lightweight Core CDP Launcher Actions (Zero `cdp-launcher.ts` Import) ───

export interface IdeCdpLauncherActionResult {
    ok: boolean;
    status: CdpLauncherStatus;
    messageEn: string;
    messageZh: string;
    error?: string;
}

const IDE_WINDOWS_SHORTCUT_PS_SCRIPT = [
    '$ErrorActionPreference = "Stop"',
    '$iconLoc = ""',
    'if ($env:ACM_TARGET_EXE -and (Test-Path -LiteralPath $env:ACM_TARGET_EXE)) { $iconLoc = "$env:ACM_TARGET_EXE,0" }',
    '$ws = New-Object -ComObject WScript.Shell',
    '$targets = @($env:ACM_LNK_DESKTOP, $env:ACM_LNK_STARTMENU) | Where-Object { $_ -and $_.Trim().Length -gt 0 }',
    'foreach ($lnkPath in $targets) {',
    '  $dir = Split-Path -Parent $lnkPath',
    '  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '  $sc = $ws.CreateShortcut($lnkPath)',
    '  $sc.TargetPath = $env:ACM_TARGET_EXE',
    '  $sc.Arguments = "--remote-debugging-port=0"',
    '  $sc.WorkingDirectory = $env:ACM_WORKDIR',
    '  $sc.WindowStyle = 1',
    '  $sc.Description = "Launch Antigravity with CDP remote debugging enabled (zero-patch)"',
    '  if ($iconLoc) { $sc.IconLocation = $iconLoc }',
    '  $sc.Save()',
    '}',
].join('\n');

export type IdeCdpLauncherCoreOptions = CoreLauncherPathOptions & {
    execFileSyncFn?: (file: string, args: readonly string[], options?: Record<string, unknown>) => unknown;
};

function writeMacOsIdeBundleAt(appDir: string, targetAppPath: string, opts: IdeCdpLauncherCoreOptions): void {
    assertSafeMacOsBundleWriteTarget(appDir, opts.fsOps);
    const contentsDir = path.join(appDir, 'Contents');
    const macOsDir = path.join(contentsDir, 'MacOS');
    fs.mkdirSync(macOsDir, { recursive: true });
    const launcherScriptPath = path.join(macOsDir, 'launch');
    fs.writeFileSync(launcherScriptPath, buildMacOsLauncherScript(targetAppPath), { mode: 0o755 });
    fs.chmodSync(launcherScriptPath, 0o755);
    fs.writeFileSync(path.join(contentsDir, 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
}

function createIdeCdpLauncherCore(opts: IdeCdpLauncherCoreOptions = {}): IdeCdpLauncherActionResult {
    const resolved = resolveCoreCdpLauncherPaths(opts);
    const platform = resolved.platform;
    try {
        if (platform === 'darwin' && (resolved.macPreferredAppDir || resolved.macAppDir)) {
            const primaryDir = resolved.macPreferredAppDir ?? resolved.macAppDir!;
            const fallbackDir = resolved.macUserAppDir ?? primaryDir;
            let createdDir = primaryDir;
            try {
                writeMacOsIdeBundleAt(primaryDir, resolved.targetAppPath, opts);
            } catch (err) {
                const code = (err as NodeJS.ErrnoException)?.code;
                const isPermError = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
                if (isPermError && path.posix.normalize(primaryDir) !== path.posix.normalize(fallbackDir)) {
                    createdDir = fallbackDir;
                    writeMacOsIdeBundleAt(fallbackDir, resolved.targetAppPath, opts);
                } else {
                    throw err;
                }
            }
            const createdNorm = path.posix.normalize(createdDir);
            for (const candidate of resolved.macCandidateAppDirs ?? []) {
                if (path.posix.normalize(candidate) !== createdNorm && isOwnedMacCdpBundle(candidate, opts.fsOps)) {
                    try { fs.rmSync(candidate, { recursive: true, force: true }); } catch { /* best-effort */ }
                }
            }
            const status = inspectCdpLauncherStatus({ ...opts, preferredMacAppDir: createdDir });
            return {
                ok: status.installed,
                status,
                messageEn: `Created persistent CDP launcher at ${status.launcherPath}.`,
                messageZh: `已在 ${status.launcherPath} 创建持久化 CDP 启动器。`,
            };
        }
        if (platform === 'win32' && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
            if (resolved.winCmdPath && fs.existsSync(resolved.winCmdPath)) {
                try { fs.rmSync(resolved.winCmdPath, { force: true }); } catch { /* best-effort legacy cleanup */ }
            }
            const runner = opts.execFileSyncFn ?? ((file: string, args: readonly string[], execOpts?: Record<string, unknown>) =>
                execFileSync(file, [...args], {
                    env: execOpts?.env as NodeJS.ProcessEnv | undefined,
                    windowsHide: true,
                    stdio: 'pipe',
                    timeout: 15_000,
                }));
            const targetExe = resolved.targetAppPath;
            const psEnv: NodeJS.ProcessEnv = {
                ...(opts.env ?? process.env),
                ACM_LNK_DESKTOP: resolved.winDesktopLnkPath,
                ACM_LNK_STARTMENU: resolved.winStartMenuLnkPath,
                ACM_TARGET_EXE: targetExe,
                ACM_WORKDIR: path.win32.dirname(targetExe),
                ACM_BADGE_ICON_PATH: resolved.winIconPath || '',
            };
            runner(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', IDE_WINDOWS_SHORTCUT_PS_SCRIPT],
                { env: psEnv, windowsHide: true, stdio: 'pipe', timeout: 15_000 },
            );
            if (
                resolved.winFallbackDesktopLnkPath
                && resolved.winFallbackDesktopLnkPath.toLowerCase() !== resolved.winDesktopLnkPath.toLowerCase()
                && fs.existsSync(resolved.winDesktopLnkPath)
                && fs.existsSync(resolved.winFallbackDesktopLnkPath)
            ) {
                try { fs.rmSync(resolved.winFallbackDesktopLnkPath, { force: true }); } catch { /* best-effort */ }
            }
            const status = inspectCdpLauncherStatus({ ...opts, ...(resolved.winDesktopDir ? { desktopDir: resolved.winDesktopDir } : {}) });
            return {
                ok: status.installed,
                status,
                messageEn: `Created persistent Windows CDP shortcuts at ${status.launcherPath}.`,
                messageZh: `已在 ${status.launcherPath} 创建 Windows 持久化 CDP 快捷方式。`,
            };
        }
        if (platform === 'linux' && resolved.linuxWrapperPath && resolved.linuxDesktopEntryPath) {
            fs.mkdirSync(path.dirname(resolved.linuxWrapperPath), { recursive: true });
            fs.writeFileSync(resolved.linuxWrapperPath, buildLinuxLauncherScript(resolved.targetAppPath), { mode: 0o755 });
            fs.chmodSync(resolved.linuxWrapperPath, 0o755);
            let iconValue = 'antigravity';
            if (resolved.linuxIconPath) {
                fs.mkdirSync(path.dirname(resolved.linuxIconPath), { recursive: true });
                fs.writeFileSync(resolved.linuxIconPath, buildLinuxBadgedSvg(), 'utf8');
                iconValue = resolved.linuxIconPath;
            }
            fs.mkdirSync(path.dirname(resolved.linuxDesktopEntryPath), { recursive: true });
            fs.writeFileSync(
                resolved.linuxDesktopEntryPath,
                buildLinuxDesktopEntry(resolved.linuxWrapperPath, iconValue),
                'utf8',
            );
            const status = inspectCdpLauncherStatus(opts);
            return {
                ok: status.installed,
                status,
                messageEn: `Created persistent CDP desktop entry at ${status.launcherPath}.`,
                messageZh: `已在 ${status.launcherPath} 创建持久化 CDP 启动入口。`,
            };
        }
        const status = inspectCdpLauncherStatus(opts);
        return {
            ok: false,
            status,
            error: `Run \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\` to create the ${platform} CDP launcher.`,
            messageEn: 'On this platform, create the persistent CDP launcher from Antigravity App Settings or via `node scripts/install-app-plugin.mjs --setup-cdp-launcher`.',
            messageZh: '当前平台请在 Antigravity App 设置页或运行 `node scripts/install-app-plugin.mjs --setup-cdp-launcher` 创建持久化 CDP 启动器。',
        };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const status = inspectCdpLauncherStatus(opts);
        return {
            ok: false,
            status,
            error,
            messageEn: `Failed to create persistent CDP launcher: ${error}`,
            messageZh: `创建持久化 CDP 启动器失败：${error}`,
        };
    }
}

function removeIdeCdpLauncherCore(opts: CoreLauncherPathOptions = {}): IdeCdpLauncherActionResult {
    const resolved = resolveCoreCdpLauncherPaths(opts);
    const platform = resolved.platform;
    try {
        if (platform === 'darwin') {
            const candidates = resolved.macCandidateAppDirs ?? (resolved.macAppDir ? [resolved.macAppDir] : []);
            for (const dir of candidates) {
                if (!dir) { continue; }
                if (isSymlinkPath(dir, opts.fsOps)) {
                    throw new Error(`Refusing to remove symlink launcher target: ${dir}`);
                }
                if (fs.existsSync(dir)) {
                    if (!isOwnedMacCdpBundle(dir, opts.fsOps)) {
                        throw new Error(`Refusing to remove unowned app bundle: ${dir}`);
                    }
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            }
        } else if (platform === 'linux') {
            for (const target of [resolved.linuxDesktopEntryPath, resolved.linuxWrapperPath, resolved.linuxIconPath]) {
                if (target && fs.existsSync(target) && !isSymlinkPath(target, opts.fsOps)) {
                    fs.rmSync(target, { force: true });
                }
            }
        } else if (platform === 'win32') {
            for (const target of [
                resolved.winDesktopLnkPath,
                resolved.winFallbackDesktopLnkPath,
                resolved.winStartMenuLnkPath,
                resolved.winIconPath,
            ]) {
                if (target && fs.existsSync(target) && !isSymlinkPath(target, opts.fsOps)) {
                    fs.rmSync(target, { force: true });
                }
            }
        }
        const status = inspectCdpLauncherStatus(opts);
        return {
            ok: !status.installed,
            status,
            messageEn: 'Removed persistent CDP launcher.',
            messageZh: '已移除持久化 CDP 启动器。',
        };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const status = inspectCdpLauncherStatus(opts);
        return {
            ok: false,
            status,
            error,
            messageEn: `Failed to remove persistent CDP launcher: ${error}`,
            messageZh: `移除持久化 CDP 启动器失败：${error}`,
        };
    }
}

async function revealIdeCdpLauncherCore(opts: CoreLauncherPathOptions = {}): Promise<IdeCdpLauncherActionResult> {
    const status = inspectCdpLauncherStatus(opts);
    if (!status.installed || !status.launcherPath) {
        return {
            ok: false,
            status,
            error: 'Persistent CDP launcher is not installed yet.',
            messageEn: 'Persistent CDP launcher is not installed yet.',
            messageZh: '持久化 CDP 启动器尚未创建。',
        };
    }
    try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(status.launcherPath));
        return {
            ok: true,
            status,
            messageEn: 'Revealed persistent launcher.',
            messageZh: '已定位持久化启动器。',
        };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            status,
            error,
            messageEn: `Failed to reveal persistent launcher: ${error}`,
            messageZh: `定位持久化启动器失败：${error}`,
        };
    }
}

/** Injectable lightweight CDP launcher actions for IDE Settings (zero `cdp-launcher.ts` import). */
export const ideCdpLauncherActions = {
    inspect: (opts: CoreLauncherPathOptions = {}): CdpLauncherStatus => inspectCdpLauncherStatus(opts),
    create: (opts: CoreLauncherPathOptions = {}): IdeCdpLauncherActionResult => createIdeCdpLauncherCore(opts),
    remove: (opts: CoreLauncherPathOptions = {}): IdeCdpLauncherActionResult => removeIdeCdpLauncherCore(opts),
    reveal: (opts: CoreLauncherPathOptions = {}): Promise<IdeCdpLauncherActionResult> => revealIdeCdpLauncherCore(opts),
};

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
let lastLedgerDateKey: string | undefined;
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
let lastCliDays: CliDailyUsageRecord[] | undefined;
let lastOrchestratorPricingMode: OrchestratorPricingMode | undefined;
let lastAppSettings: (Partial<AppSettings> & { subscriptionPlan?: SubscriptionPlanPresetId }) | undefined;
let lastUpdateStatus: UpdateStatusView | null = null;
let lastCdpStatus: CdpStatus | null = null;
let ideCdpProbeSeq = 0;
let ideCdpProbeInFlight: Promise<void> | null = null;
let lastLowQuotaWarning: LowQuotaWarningState | null | undefined;
let lastPublishedObservation: PublishedMonitorObservation | null = null;
let lastWindowSelectionState: WindowSelectionState | null = null;
let lastSwarmTopology: SwarmTopologySnapshot | null = null;
let lastSwarmGroupCost: PanelPayload['swarmGroupCost'] = null;
export const LARGE_STATE_FILE_WARN_BYTES = 1 * 1024 * 1024;
const SAFE_CASCADE_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;

// ─── SEC-04 Full-Chain Privacy Mask & Opaque Account Handles ──────────────────

/** Fail-closed privacy mask state for the active IDE WebView panel (default: true). */
let panelPrivacyMasked = true;
/** Per-panel ephemeral HMAC secret for irreversible opaque account handles. */
let panelPrivacySecret = crypto.randomBytes(16);
const emailToOpaqueHandle = new Map<string, string>();
const opaqueHandleToEmail = new Map<string, string>();

/** Reset ephemeral opaque handle maps and return panel privacy state to fail-closed masked. */
function resetPanelPrivacyState(): void {
    panelPrivacyMasked = true;
    panelPrivacySecret = crypto.randomBytes(16);
    emailToOpaqueHandle.clear();
    opaqueHandleToEmail.clear();
}

/** Return whether IDE WebView privacy masking is currently ON (fail-closed default: true). */
export function isIdePanelPrivacyMasked(): boolean {
    return panelPrivacyMasked;
}

/** Explicitly set IDE WebView privacy masking state (re-renders open panel if visible). */
export function setIdePanelPrivacyMasked(masked: boolean): void {
    panelPrivacyMasked = Boolean(masked);
    if (panel) {
        safePostMessage({
            command: 'privacyMaskState',
            masked: panelPrivacyMasked,
            privacyMasked: panelPrivacyMasked,
        });
        postCurrentTabs();
    }
}

/**
 * Derive a deterministic-per-panel, irreversible opaque account handle (`acct_<12hex>`)
 * for `email`, recording the reverse map strictly in host memory.
 */
export function getOpaqueAccountHandle(email: string): string {
    const raw = typeof email === 'string' ? email.trim() : '';
    if (!raw) { return ''; }
    if (/^acct_[0-9a-f]{12}$/i.test(raw)) {
        return raw.toLowerCase();
    }
    const key = raw.toLowerCase();
    const existing = emailToOpaqueHandle.get(key);
    if (existing) {
        return existing;
    }
    const digest = crypto
        .createHmac('sha256', panelPrivacySecret)
        .update(key)
        .digest('hex')
        .slice(0, 12);
    const handle = `acct_${digest}`;
    emailToOpaqueHandle.set(key, handle);
    opaqueHandleToEmail.set(handle, raw);
    return handle;
}

/**
 * Resolve an incoming `accountHandle` (preferred) or legacy `email` identifier back to
 * the real account email in host memory.
 */
export function resolveOpaqueAccountHandle(rawIdentifier: unknown): string | null {
    if (typeof rawIdentifier !== 'string') { return null; }
    const trimmed = rawIdentifier.trim();
    if (!trimmed) { return null; }
    const byHandle = opaqueHandleToEmail.get(trimmed) || opaqueHandleToEmail.get(trimmed.toLowerCase());
    if (byHandle) {
        return byHandle;
    }
    // Check known host emails (e.g. when unmasked or legacy client message)
    const lower = trimmed.toLowerCase();
    if (lastUserInfo?.email && lastUserInfo.email.trim().toLowerCase() === lower) {
        return lastUserInfo.email.trim();
    }
    for (const snap of lastAccountSnapshots) {
        if (snap.email && snap.email.trim().toLowerCase() === lower) {
            return snap.email.trim();
        }
    }
    return !panelPrivacyMasked ? trimmed : null;
}

interface SensitiveRedactionContext {
    emails: Set<string>;
    names: Set<string>;
    paths: Set<string>;
}

function escapeRegExpLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectSensitiveContext(): SensitiveRedactionContext {
    const emails = new Set<string>();
    const names = new Set<string>();
    const paths = new Set<string>();

    const addEmail = (val?: string | null) => {
        const s = typeof val === 'string' ? val.trim() : '';
        if (s && s.includes('@')) {
            emails.add(s);
            // Register opaque handle eagerly so reverse resolution always works
            getOpaqueAccountHandle(s);
        }
    };
    const addName = (val?: string | null) => {
        const s = typeof val === 'string' ? val.trim() : '';
        if (s.length >= 2) { names.add(s); }
    };
    const addPathLike = (val?: string | null) => {
        const s = typeof val === 'string' ? val.trim() : '';
        if (!s || s.length < 3) { return; }
        paths.add(s);
        if (/^file:\/\//i.test(s)) {
            try {
                const fsP = fileURLToPath(s);
                if (fsP && fsP.length >= 3) { paths.add(fsP); }
            } catch { /* ignore */ }
        }
    };

    addEmail(lastUserInfo?.email);
    addName(lastUserInfo?.name);
    for (const snap of lastAccountSnapshots) {
        addEmail(snap.email);
        addName(snap.name);
    }
    for (const key of Object.keys(getIdePanelHostBridge().getBillingDaysMap())) {
        addEmail(key);
    }
    for (const bucket of lastTodayLedgerActive) {
        addEmail(bucket.accountEmail);
    }
    for (const settled of lastLedgerSettled) {
        addEmail(settled.accountEmail);
    }
    for (const summary of [lastGMSummary, lastGMFullSummary]) {
        if (!summary) { continue; }
        for (const conv of summary.conversations || []) {
            for (const call of conv.calls || []) {
                addEmail(call.accountEmail);
            }
        }
    }
    for (const conv of Object.values(lastGMConversations || {})) {
        for (const call of conv.calls || []) {
            addEmail(call.accountEmail);
        }
    }
    if (lastDailyStore) {
        const state = lastDailyStore.serialize();
        for (const rec of Object.values(state.records || {})) {
            for (const cycle of rec.cycles || []) {
                addEmail(cycle.accountEmail);
                if (cycle.lateMergedCalls) {
                    for (const lc of Object.values(cycle.lateMergedCalls)) {
                        addEmail(lc.accountEmail);
                    }
                }
            }
        }
    }

    addPathLike(lastCdpStatus?.launcherStatus?.launcherPath);
    addPathLike(lastCdpStatus?.launcherStatus?.targetAppPath);
    addPathLike(lastWorkspaceUri);
    for (const folder of vscode.workspace.workspaceFolders || []) {
        addPathLike(folder?.uri?.toString?.());
        addPathLike(folder?.uri?.fsPath);
    }
    for (const traj of lastTrajectories) {
        for (const u of traj.workspaceUris || []) { addPathLike(u); }
        addPathLike(traj.gitRootUri);
        addPathLike(traj.gitOriginUrl);
        if (traj.repositoryName && traj.repositoryName.trim().length >= 2) {
            paths.add(traj.repositoryName.trim());
        }
    }
    for (const u of [lastUsage, ...lastAllUsages]) {
        if (!u) { continue; }
        addPathLike(u.gitRootUri);
        addPathLike(u.gitOriginUrl);
        if (u.repositoryName && u.repositoryName.trim().length >= 2) {
            paths.add(u.repositoryName.trim());
        }
    }
    addPathLike(lastStorageDiagnostics?.stateFilePath);
    if (lastStorageDiagnostics?.stateFilePath) {
        const dir = path.dirname(lastStorageDiagnostics.stateFilePath);
        if (dir && dir.length >= 4) { addPathLike(dir); }
    }
    const home = os.homedir();
    if (home && home.length >= 4 && home !== '/' && home !== '\\') {
        addPathLike(home);
    }

    return { emails, names, paths };
}

/**
 * Redact known sentinel emails (including 1-character local-part emails like `a@domain.tld`),
 * display names, workspace/filesystem paths, and generic email addresses from arbitrary text.
 */
function scrubSensitiveText(text: string, ctx: SensitiveRedactionContext): string {
    if (!text) { return text; }
    let out = text;

    // 1. Replace known emails (longest first) with opaque account handles (both raw and URL-encoded)
    const sortedEmails = [...ctx.emails].sort((a, b) => b.length - a.length);
    for (const email of sortedEmails) {
        const handle = getOpaqueAccountHandle(email);
        const variants = new Set<string>([email]);
        try {
            const encoded = encodeURIComponent(email);
            if (encoded !== email) { variants.add(encoded); }
        } catch { /* ignore */ }
        for (const variant of variants) {
            out = out.replace(new RegExp(escapeRegExpLiteral(variant), 'gi'), () => handle);
        }
    }

    // 2. Generic RFC-like email fallback (explicitly handles 1-char local parts like `a@x.io`)
    out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (matched) =>
        getOpaqueAccountHandle(matched),
    );

    // 3. Replace known workspace/home/state paths (longest first)
    const sortedPaths = [...ctx.paths].sort((a, b) => b.length - a.length);
    for (const p of sortedPaths) {
        const variants = new Set<string>([p]);
        try {
            const encoded = encodeURI(p);
            if (encoded !== p) { variants.add(encoded); }
        } catch { /* ignore */ }
        for (const variant of variants) {
            if (variant.length < 3) { continue; }
            out = out.replace(new RegExp(escapeRegExpLiteral(variant), 'g'), '[redacted-path]');
        }
    }

    // 4. Replace known account names (longest first)
    const sortedNames = [...ctx.names].sort((a, b) => b.length - a.length);
    for (const name of sortedNames) {
        out = out.replace(new RegExp(escapeRegExpLiteral(name), 'g'), '[redacted]');
    }

    return out;
}

function redactStateFilePath(rawPath: string): string {
    if (!rawPath) { return ''; }
    const base = path.basename(rawPath) || 'state-v1.json';
    return `[redacted]/${base}`;
}

function redactGMCallForPrivacy(
    call: GMConversationData['calls'][number],
    ctx: SensitiveRedactionContext,
): GMConversationData['calls'][number] {
    const scrub = (s?: string) => (typeof s === 'string' ? scrubSensitiveText(s, ctx) : s);
    const scrubArr = (arr?: readonly unknown[]) => arr?.map(v => scrubSensitiveText(String(v ?? ''), ctx));
    const aiSnips = call.aiSnippetsByStep && typeof call.aiSnippetsByStep === 'object'
        ? Object.fromEntries(Object.entries(call.aiSnippetsByStep).map(([k, v]) => [k, scrubSensitiveText(String(v ?? ''), ctx)]))
        : call.aiSnippetsByStep;
    const rawAny = call as unknown as Record<string, unknown>;
    const redactedContextItems = Array.isArray(rawAny.contextItems)
        ? (rawAny.contextItems as Array<Record<string, unknown>>).map(it => (
            it && typeof it === 'object'
                ? {
                    ...it,
                    ...(typeof it.label === 'string' ? { label: scrubSensitiveText(it.label, ctx) } : {}),
                    ...(typeof it.name === 'string' ? { name: scrubSensitiveText(it.name, ctx) } : {}),
                    ...(typeof it.path === 'string' ? { path: '[redacted-path]' } : {}),
                    ...(typeof it.fullText === 'string' ? { fullText: '[Redacted]' } : {}),
                    ...(typeof it.text === 'string' ? { text: '[Redacted]' } : {}),
                    ...(typeof it.body === 'string' ? { body: '[Redacted]' } : {}),
                }
                : '[Redacted]'
        ))
        : undefined;
    return {
        ...call,
        ...(call.accountEmail ? { accountEmail: getOpaqueAccountHandle(call.accountEmail) } : {}),
        ...(call.errorMessage ? { errorMessage: scrubSensitiveText(call.errorMessage, ctx) } : {}),
        ...(Array.isArray(call.retryErrors) ? { retryErrors: scrubArr(call.retryErrors) } : {}),
        ...(call.systemPromptSnippet ? { systemPromptSnippet: scrub(call.systemPromptSnippet) } : {}),
        ...(call.promptSnippet ? { promptSnippet: scrub(call.promptSnippet) } : {}),
        ...(Array.isArray(call.promptSectionTitles) ? { promptSectionTitles: scrubArr(call.promptSectionTitles) } : {}),
        ...(Array.isArray(call.userMessageAnchors)
            ? { userMessageAnchors: call.userMessageAnchors.map(a => ({ ...a, text: scrubSensitiveText(a.text || '', ctx) })) }
            : {}),
        ...(aiSnips !== undefined ? { aiSnippetsByStep: aiSnips } : {}),
        ...(Array.isArray(call.checkpointSummaries)
            ? { checkpointSummaries: call.checkpointSummaries.map(cp => ({ ...cp, fullText: cp.fullText ? '[Redacted]' : '' })) }
            : {}),
        ...(Array.isArray(call.systemContextItems)
            ? {
                systemContextItems: call.systemContextItems.map(it => ({
                    ...it,
                    label: scrubSensitiveText(it.label || '', ctx),
                    fullText: it.fullText ? '[Redacted]' : '',
                })),
            }
            : {}),
        ...(Array.isArray(call.tokenBreakdownGroups)
            ? {
                tokenBreakdownGroups: call.tokenBreakdownGroups.map(g => ({
                    ...g,
                    name: scrubSensitiveText(g.name || '', ctx),
                    children: (g.children || []).map(ch => ({ ...ch, name: scrubSensitiveText(ch.name || '', ctx) })),
                })),
            }
            : {}),
        ...(redactedContextItems !== undefined ? { contextItems: redactedContextItems } : {}),
    };
}

function redactGMConversationDataForPrivacy(
    conv: GMConversationData,
    ctx: SensitiveRedactionContext,
): GMConversationData {
    return {
        ...conv,
        title: scrubSensitiveText(conv.title || '', ctx),
        calls: (conv.calls || []).map(call => redactGMCallForPrivacy(call, ctx)),
        ...(Array.isArray(conv.checkpointSummaries)
            ? { checkpointSummaries: conv.checkpointSummaries.map(cp => ({ ...cp, fullText: cp.fullText ? '[Redacted]' : '' })) }
            : {}),
        ...(Array.isArray(conv.systemContextItems)
            ? {
                systemContextItems: conv.systemContextItems.map(it => ({
                    ...it,
                    label: scrubSensitiveText(it.label || '', ctx),
                    fullText: it.fullText ? '[Redacted]' : '',
                })),
            }
            : {}),
    };
}

function redactGMSummaryForPrivacy(
    summary: GMSummary | null,
    ctx: SensitiveRedactionContext,
): GMSummary | null {
    if (!summary) { return null; }
    const modelBreakdown = summary.modelBreakdown
        ? Object.fromEntries(Object.entries(summary.modelBreakdown).map(([k, st]) => [
            k,
            {
                ...st,
                ...(Array.isArray(st.promptSectionTitles)
                    ? { promptSectionTitles: st.promptSectionTitles.map(s => scrubSensitiveText(String(s ?? ''), ctx)) }
                    : {}),
            },
        ])) as GMSummary['modelBreakdown']
        : summary.modelBreakdown;
    return {
        ...summary,
        conversations: (summary.conversations || []).map(conv => redactGMConversationDataForPrivacy(conv, ctx)),
        ...(modelBreakdown ? { modelBreakdown } : {}),
        ...(Array.isArray(summary.latestTokenBreakdown)
            ? {
                latestTokenBreakdown: summary.latestTokenBreakdown.map(g => ({
                    ...g,
                    name: scrubSensitiveText(g.name || '', ctx),
                    children: (g.children || []).map(ch => ({ ...ch, name: scrubSensitiveText(ch.name || '', ctx) })),
                })),
            }
            : {}),
        recentErrors: (summary.recentErrors || []).map(e => scrubSensitiveText(e, ctx)),
        ...(summary.recentErrorEntries
            ? {
                recentErrorEntries: summary.recentErrorEntries.map(e => ({
                    ...e,
                    message: scrubSensitiveText(e.message || '', ctx),
                })),
            }
            : {}),
        ...(summary.uniqueErrors
            ? {
                uniqueErrors: summary.uniqueErrors.map(e => ({
                    ...e,
                    message: scrubSensitiveText(e.message || '', ctx),
                })),
            }
            : {}),
    };
}

function redactGMConversationsForPrivacy(
    convs: Record<string, GMConversationData>,
    ctx: SensitiveRedactionContext,
): Record<string, GMConversationData> {
    const out: Record<string, GMConversationData> = {};
    for (const [id, conv] of Object.entries(convs || {})) {
        out[id] = redactGMConversationDataForPrivacy(conv, ctx);
    }
    return out;
}

function opaqueArchiveIdentity(value: string): string {
    return emailToOpaqueHandle.get(value.toLowerCase())
        ?? crypto.createHmac('sha256', panelPrivacySecret).update(value).digest('hex').slice(0, 24);
}

function redactWorkspaceStatsForPrivacy(
    stats?: Record<string, WorkspaceUsageStats>,
): Record<string, WorkspaceUsageStats> | undefined {
    if (!stats) { return undefined; }
    return Object.fromEntries(Object.entries(stats).map(([key, value]) => [
        key === '__unattributed__' ? key : opaqueArchiveIdentity(key),
        { ...value, ...(value.authority ? { authority: opaqueArchiveIdentity(value.authority) } : {}) },
    ]));
}

function redactLedgerCallForPrivacy(call: LedgerRecordedCall): LedgerRecordedCall {
    return {
        ...call,
        callId: opaqueArchiveIdentity(call.callId),
        ...(call.account ? { account: opaqueArchiveIdentity(call.account) } : {}),
        ...(call.authority ? { authority: opaqueArchiveIdentity(call.authority) } : {}),
        ...(call.cascadeId ? { cascadeId: opaqueArchiveIdentity(call.cascadeId) } : {}),
        ...(call.workspace ? { workspace: call.workspace === '__unattributed__' ? call.workspace : opaqueArchiveIdentity(call.workspace) } : {}),
    };
}

function redactActiveLedgerBucketForPrivacy(bucket: LedgerAccountBucket): LedgerAccountBucket {
    return {
        ...bucket,
        ...(bucket.accountEmail ? { accountEmail: getOpaqueAccountHandle(bucket.accountEmail) } : {}),
        ...(bucket.workspaceBreakdown ? { workspaceBreakdown: redactWorkspaceStatsForPrivacy(bucket.workspaceBreakdown) } : {}),
        ...(bucket.recordedCalls ? { recordedCalls: bucket.recordedCalls.map(redactLedgerCallForPrivacy) } : {}),
        ...(bucket.recordedCallIds ? { recordedCallIds: bucket.recordedCallIds.map(opaqueArchiveIdentity) } : {}),
    };
}

function redactSettledLedgerEntryForPrivacy(entry: LedgerSettledEntry): LedgerSettledEntry {
    return {
        ...entry,
        ...(entry.accountEmail ? { accountEmail: getOpaqueAccountHandle(entry.accountEmail) } : {}),
        ...(entry.workspaceBreakdown ? { workspaceBreakdown: redactWorkspaceStatsForPrivacy(entry.workspaceBreakdown) } : {}),
        ...(entry.settledCalls ? { settledCalls: entry.settledCalls.map(redactLedgerCallForPrivacy) } : {}),
        ...(entry.recordedCallIds ? { recordedCallIds: entry.recordedCallIds.map(opaqueArchiveIdentity) } : {}),
    };
}

function redactDailyStoreForPrivacy(store: DailyStore | undefined): DailyStore | undefined {
    if (!store) { return undefined; }
    const serialized = store.serialize();
    // Unlike an account control, an archive identifier never needs a reversible grant.
    const clone = new DailyStore(store.maxDays);
    clone.restoreSnapshot({
        version: 1,
        records: Object.fromEntries(Object.entries(serialized.records).map(([key, record]) => [
            key, redactDailyRecordIdentities(record, opaqueArchiveIdentity),
        ])),
    });
    return clone;
}

function redactContextBreakdownForPrivacy(
    snapshot: ContextBreakdownSnapshot | null,
    ctx: SensitiveRedactionContext,
): ContextBreakdownSnapshot | null {
    if (!snapshot) { return null; }
    return {
        ...snapshot,
        segments: snapshot.segments.map(seg => ({
            ...seg,
            topItems: seg.topItems.map(item => ({
                ...item,
                title: scrubSensitiveText(item.title, ctx),
            })),
        })),
        largestItems: snapshot.largestItems.map(item => ({
            ...item,
            title: scrubSensitiveText(item.title, ctx),
        })),
    };
}

function redactUsageForPrivacy(
    usage: ContextUsage | null,
    ctx: SensitiveRedactionContext,
): ContextUsage | null {
    if (!usage) { return null; }
    return {
        ...usage,
        title: scrubSensitiveText(usage.title || '', ctx),
        repositoryName: '',
        gitOriginUrl: '',
        gitRootUri: '',
    };
}

function redactActivitySummaryForPrivacy(
    summary: ActivitySummary | null,
    ctx: SensitiveRedactionContext,
): ActivitySummary | null {
    if (!summary) { return null; }
    return {
        ...summary,
        recentSteps: (summary.recentSteps || []).map(step => ({
            ...step,
            detail: scrubSensitiveText(step.detail || '', ctx),
            ...(step.userInput ? { userInput: scrubSensitiveText(step.userInput, ctx) } : {}),
            ...(step.fullUserInput ? { fullUserInput: scrubSensitiveText(step.fullUserInput, ctx) } : {}),
            ...(step.aiResponse ? { aiResponse: scrubSensitiveText(step.aiResponse, ctx) } : {}),
            ...(step.fullAiResponse ? { fullAiResponse: scrubSensitiveText(step.fullAiResponse, ctx) } : {}),
            ...(step.browserSub ? { browserSub: scrubSensitiveText(step.browserSub, ctx) } : {}),
            ...(step.gmPromptSnippet ? { gmPromptSnippet: scrubSensitiveText(step.gmPromptSnippet, ctx) } : {}),
        })),
    };
}

function redactCdpStatusForPrivacy(
    cdp: CdpStatus | undefined,
    ctx: SensitiveRedactionContext,
): CdpStatus | undefined {
    if (!cdp) { return undefined; }
    return {
        ...cdp,
        ...(cdp.targetTitle ? { targetTitle: scrubSensitiveText(cdp.targetTitle, ctx) } : {}),
        ...(cdp.targetUrl ? { targetUrl: '' } : {}),
        ...(cdp.portFilePath ? { portFilePath: redactStateFilePath(cdp.portFilePath) } : {}),
        ...(cdp.errorMessage ? { errorMessage: scrubSensitiveText(cdp.errorMessage, ctx) } : {}),
        ...(cdp.launcherStatus
            ? {
                launcherStatus: {
                    ...cdp.launcherStatus,
                    safeTerminalCommand: scrubSensitiveText(cdp.launcherStatus.safeTerminalCommand, ctx),
                    noteEn: scrubSensitiveText(cdp.launcherStatus.noteEn, ctx),
                    noteZh: scrubSensitiveText(cdp.launcherStatus.noteZh, ctx),
                    ...(cdp.launcherStatus.launcherPath
                        ? { launcherPath: redactStateFilePath(cdp.launcherStatus.launcherPath) }
                        : {}),
                    ...(cdp.launcherStatus.targetAppPath
                        ? { targetAppPath: redactStateFilePath(cdp.launcherStatus.targetAppPath) }
                        : {}),
                },
            }
            : {}),
    };
}

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
    const bridge = getIdePanelHostBridge();
    bridge.syncDurableStateFromDisk(false);
    const hydrated = bridge.isSharedAppSettingsHydrated();
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const shared = bridge.getSharedAppSettings();

    if (hydrated) {
        const maxRecentSteps = shared.activityMaxRecentSteps;
        const maxArchives = shared.activityMaxArchives;
        return {
            pollingInterval: shared.pollingInterval,
            quotaNotificationThreshold: shared.quotaNotificationThreshold,
            showContext: shared.showContext,
            showQuota: shared.showQuota,
            showResetCountdown: shared.showResetCountdown,
            showAiCredits: shared.showAiCredits,
            showSpeed: shared.showSpeed,
            showCacheHit: shared.showCacheHit,
            showSessionCost: shared.showSessionCost,
            tooltipDensity: shared.tooltipDensity,
            showModelInternalId: shared.showModelInternalId,
            maxRecentSteps,
            maxArchives,
            lockToMainAgent: bridge.getLockToMainAgent(),
            appComposerRingEnabled: shared.appComposerRingEnabled,
            appTopBarEnabled: shared.appTopBarEnabled,
            showNativeHudBar: shared.showNativeHudBar,
            orchestratorPricingMode: shared.orchestratorPricingMode,
            displayCurrency: shared.displayCurrency,
            customFxRate: shared.customFxRate,
            subscriptionPlan: normalizeSubscriptionPlanId(shared.subscriptionPlan, shared.subscriptionMonthlyFee),
            subscriptionMonthlyFee: shared.subscriptionMonthlyFee,
            subscriptionCurrency: shared.subscriptionCurrency,
            calendarRetentionDays: shared.calendarRetentionDays,
            autoCheckUpdates: shared.autoCheckUpdates,
            activityMaxRecentSteps: maxRecentSteps,
            activityMaxArchives: maxArchives,
            customFxCurrency: shared.customFxCurrency ?? null,
            appShowNativeHudBar: shared.appShowNativeHudBar,
            ideShowNativeHudBar: shared.ideShowNativeHudBar,
            nativeHudAutoHideOnOverview: shared.nativeHudAutoHideOnOverview,
            languagePreference: shared.languagePreference,
            contextPctBasis: shared.contextPctBasis,
            speedMetricMode: shared.speedMetricMode,
        } as MonitorDocumentSettings;
    }

    const maxRecentSteps = cfg.get<number>('activity.maxRecentSteps', shared.activityMaxRecentSteps ?? 100);
    const maxArchives = cfg.get<number>('activity.maxArchives', shared.activityMaxArchives ?? 20);
    const orchRaw = cfg.get<string>('orchestratorPricingMode', shared.orchestratorPricingMode ?? 'mapped');
    const orchestratorPricingMode = normalizeOrchestratorPricingMode(orchRaw);
    const displayCurrency = normalizeCurrencyCode(cfg.get<string>('displayCurrency', shared.displayCurrency ?? 'USD'), 'USD');
    const customFxRate = cfg.get<number | null>('customFxRate', shared.customFxRate ?? null);
    const subscriptionMonthlyFee = cfg.get<number | null>('subscriptionMonthlyFee', shared.subscriptionMonthlyFee ?? null);
    const subscriptionPlan = normalizeSubscriptionPlanId(
        cfg.get<string>('subscriptionPlan', shared.subscriptionPlan ?? 'none'),
        subscriptionMonthlyFee,
    );
    const subscriptionCurrency = normalizeCurrencyCode(cfg.get<string>('subscriptionCurrency', shared.subscriptionCurrency ?? 'USD'), 'USD');
    const calendarRetentionDays = cfg.get<number>('calendarRetentionDays', shared.calendarRetentionDays ?? 400);
    const autoCheckUpdates = cfg.get<boolean>('autoCheckUpdates', shared.autoCheckUpdates ?? true);
    const showNativeHudBar = cfg.get<boolean>('showNativeHudBar', false);

    return {
        pollingInterval: cfg.get<number>('pollingInterval', shared.pollingInterval ?? 5),
        quotaNotificationThreshold: cfg.get<number>('quotaNotificationThreshold', shared.quotaNotificationThreshold ?? 20),
        showContext: cfg.get<boolean>('statusBar.showContext', shared.showContext ?? true),
        showQuota: cfg.get<boolean>('statusBar.showQuota', shared.showQuota ?? true),
        showResetCountdown: cfg.get<boolean>('statusBar.showResetCountdown', shared.showResetCountdown ?? true),
        showAiCredits: cfg.get<boolean>('statusBar.showAiCredits', shared.showAiCredits ?? true),
        showSpeed: cfg.get<boolean>('statusBar.showSpeed', shared.showSpeed ?? false),
        showCacheHit: cfg.get<boolean>('statusBar.showCacheHit', shared.showCacheHit ?? false),
        showSessionCost: cfg.get<boolean>('statusBar.showSessionCost', shared.showSessionCost ?? false),
        tooltipDensity: parseTooltipDensity(cfg.get('statusBar.tooltipDensity', shared.tooltipDensity ?? 'auto')),
        showModelInternalId: cfg.get<boolean>('showModelInternalId', shared.showModelInternalId ?? false),
        maxRecentSteps,
        maxArchives,
        lockToMainAgent: bridge.getLockToMainAgent(),
        appComposerRingEnabled: shared.appComposerRingEnabled,
        appTopBarEnabled: shared.appTopBarEnabled,
        showNativeHudBar,
        orchestratorPricingMode,
        displayCurrency,
        customFxRate,
        subscriptionPlan,
        subscriptionMonthlyFee,
        subscriptionCurrency,
        calendarRetentionDays,
        autoCheckUpdates,
        activityMaxRecentSteps: maxRecentSteps,
        activityMaxArchives: maxArchives,
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

/** Per-panel cryptographic host->webview nonce (authenticates extension host postMessage under VS Code's window.parent rewrite). */
let panelHostNonce = '';

/** Expose active panel host nonce for unit test verification (never rendered into DOM attributes). */
export function getCurrentIdePanelHostNonce(): string {
    return panelHostNonce;
}

function clearDisposedPanel(): void {
    awaitingSelectionUpdate = false;
    panel = undefined;
    panelHostNonce = '';
    pendingTab = undefined;
    isPaused = false;
    lastCdpStatus = null;
    ideCdpProbeSeq += 1;
    ideCdpProbeInFlight = null;
    resetPanelPrivacyState();
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

// ─── Positive IDE File Reveal Authorization (SEC-04) ──────────────────────────
// Abolishes denylists, lexical canonicalization fallbacks, parent-dir fallbacks,
// and blind macOS case-folding. Positively authorizes ONLY active registered
// roots (`vscode.workspace.workspaceFolders` for workspace reveal; owned
// antigravity artifact subdirs for `record`/`pb`), canonicalizes existing
// targets with target filesystem semantics (APFS / WSL / Windows / POSIX), and
// fails closed on indeterminate containment or canonicalization failure.

export interface IdeRevealValidationFsOps {
    realpathSync: (targetPath: string) => string;
    statSync: (targetPath: string) => {
        isFile(): boolean;
        isDirectory(): boolean;
        dev: number | bigint;
        ino: number | bigint;
    };
    readdirSync?: (targetPath: string) => string[];
}

export interface ValidateIdeRevealOptions {
    /** Positively authorized root URIs or absolute paths (never denylists or historical trajectories). */
    authorizedRoots: readonly string[];
    platform?: NodeJS.Platform;
    /** Optional case-sensitivity probe override for macOS APFS testing. */
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    /** Optional active WSL distro name (defaults to `process.env.WSL_DISTRO_NAME`). */
    wslDistro?: string;
    /** Optional injectable fs operations for deterministic cross-platform tests. */
    fsOps?: IdeRevealValidationFsOps;
}

export interface IdeRevealValidationResult {
    ok: boolean;
    resolvedPath?: string;
    isDirectory?: boolean;
    error?: string;
}

const DEFAULT_IDE_REVEAL_FS_OPS: IdeRevealValidationFsOps = {
    realpathSync: (p: string) =>
        typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native(p) : fs.realpathSync(p),
    statSync: (p: string) => fs.statSync(p),
    readdirSync: (p: string) => fs.readdirSync(p),
};

interface ParsedWslRef {
    distro: string;
    posixPath: string;
}

function parseWslRef(raw: string, platform: NodeJS.Platform, wslDistro?: string): ParsedWslRef | null {
    const trimmed = raw.trim();
    const looksWsl = /^vscode-remote:\/\/wsl(?:\+|%2b)/i.test(trimmed)
        || /^(?:\\\\\?\\UNC\\|\/\/\?\/UNC\/|\\\\|\/\/)(?:wsl(?:\$|%24)|wsl\.localhost)[\\/]/i.test(trimmed)
        || /^file:\/\/(?:\/\/)?(?:wsl(?:\$|%24)|wsl\.localhost)\//i.test(trimmed);
    if (!looksWsl && !(wslDistro && platform === 'linux' && (/^file:\/\/\//i.test(trimmed) || trimmed.startsWith('/')))) {
        return null;
    }
    const normalized = normalizeWorkspaceUri(trimmed, { platform, wslDistro });
    const match = normalized.match(/^vscode-remote:\/\/wsl\+([^/]+)(\/.*)?$/i);
    if (!match) { return null; }
    const distro = match[1].toLowerCase();
    const posixPath = match[2] || '/';
    return distro ? { distro, posixPath } : null;
}

function isWindowsDriveAbsolute(p: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(p);
}

function isWindowsUncAbsolute(p: string): boolean {
    return /^\\\\[^\\]+[\\/][^\\]+/.test(p) || /^\/\/[^/]+\/[^/]+/.test(p);
}

function parseLocalRevealCandidate(raw: string, platform: NodeJS.Platform): string | null {
    const trimmed = raw.trim();
    if (!trimmed || /[\0\r\n]/.test(trimmed)) {
        return null;
    }
    // Reject non-file schemes explicitly (allow only file:// or absolute local paths)
    const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
        const scheme = schemeMatch[1].toLowerCase();
        // Single-letter scheme on Windows (e.g. `C:\...`) is a drive letter, not a URL scheme
        if (scheme.length === 1 && platform === 'win32' && isWindowsDriveAbsolute(trimmed)) {
            return trimmed;
        }
        if (scheme !== 'file') {
            return null;
        }
        // Reject file:// with credentials or non-empty query/hash that cannot map safely
        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch {
            return null;
        }
        if (parsed.username || parsed.password) {
            return null;
        }
        if (platform === 'win32') {
            // Convert file:// URI on Windows (handles drive letters and UNC hosts)
            if (parsed.host && parsed.host.toLowerCase() !== 'localhost') {
                let decodedPath: string;
                try {
                    decodedPath = decodeURIComponent(parsed.pathname);
                } catch {
                    return null;
                }
                if (/[\0\r\n]/.test(decodedPath)) {
                    return null;
                }
                const winRest = decodedPath.replace(/\//g, '\\');
                return `\\\\${parsed.host}${winRest}`;
            }
            let decodedPath: string;
            try {
                decodedPath = decodeURIComponent(parsed.pathname);
            } catch {
                return null;
            }
            if (/[\0\r\n]/.test(decodedPath)) {
                return null;
            }
            const stripped = decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
            if (!isWindowsDriveAbsolute(stripped)) {
                return null;
            }
            return stripped.replace(/\//g, '\\');
        }
        // POSIX file:// URI must target localhost or empty host
        if (parsed.host && parsed.host.toLowerCase() !== 'localhost') {
            return null;
        }
        if (process.platform === platform) {
            try {
                const fsPath = fileURLToPath(parsed);
                return /[\0\r\n]/.test(fsPath) ? null : fsPath;
            } catch {
                return null;
            }
        }
        try {
            const decoded = decodeURIComponent(parsed.pathname);
            if (/[\0\r\n]/.test(decoded)) {
                return null;
            }
            return decoded.startsWith('/') ? decoded : null;
        } catch {
            return null;
        }
    }

    if (platform === 'win32') {
        if (isWindowsDriveAbsolute(trimmed) || isWindowsUncAbsolute(trimmed)) {
            return trimmed.replace(/\//g, '\\');
        }
        return null;
    }
    return trimmed.startsWith('/') ? trimmed : null;
}

function stripWindowsExtendedPrefix(p: string): string {
    if (/^\\\\\?\\UNC\\/i.test(p)) {
        return `\\\\${p.slice('\\\\?\\UNC\\'.length)}`;
    }
    if (/^\\\\\?\\[a-zA-Z]:[\\/]/.test(p)) {
        return p.slice('\\\\?\\'.length);
    }
    return p;
}

function isPosixContained(realTarget: string, realRoot: string): boolean {
    const rel = path.posix.relative(realRoot, realTarget);
    return rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel));
}

function extractWindowsRootAnchor(p: string): string | null {
    const normalized = stripWindowsExtendedPrefix(p).replace(/\//g, '\\');
    const uncMatch = normalized.match(/^\\\\([^\\]+)\\([^\\]+)/);
    if (uncMatch) {
        return `\\\\${uncMatch[1].toLowerCase()}\\${uncMatch[2].toLowerCase()}`;
    }
    const driveMatch = normalized.match(/^([a-zA-Z]:)\\/);
    if (driveMatch) {
        return `${driveMatch[1].toLowerCase()}\\`;
    }
    return null;
}

function isWindowsContained(realTarget: string, realRoot: string): boolean {
    const cleanTarget = stripWindowsExtendedPrefix(realTarget);
    const cleanRoot = stripWindowsExtendedPrefix(realRoot);
    const targetAnchor = extractWindowsRootAnchor(cleanTarget);
    const rootAnchor = extractWindowsRootAnchor(cleanRoot);
    if (!targetAnchor || !rootAnchor || targetAnchor !== rootAnchor) {
        return false;
    }
    const rel = path.win32.relative(cleanRoot.toLowerCase(), cleanTarget.toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel));
}

function isTargetContainedInCanonicalRoot(
    realTarget: string,
    realRoot: string,
    platform: NodeJS.Platform,
    probeCaseSensitivity: (fsPath: string) => boolean | null,
): boolean {
    const normalizedTarget = platform === 'win32' ? stripWindowsExtendedPrefix(realTarget) : realTarget;
    const normalizedRoot = platform === 'win32' ? stripWindowsExtendedPrefix(realRoot) : realRoot;
    // WSL UNC paths on Windows (`\\wsl$\<distro>\...` or `\\wsl.localhost\<distro>\...`)
    // MUST preserve distro identity AND POSIX case sensitivity!
    const targetWsl = parseWslRef(normalizedTarget, platform);
    const rootWsl = parseWslRef(normalizedRoot, platform);
    if (targetWsl || rootWsl) {
        if (!targetWsl || !rootWsl) {
            return false;
        }
        if (targetWsl.distro !== rootWsl.distro) {
            return false;
        }
        return isPosixContained(targetWsl.posixPath, rootWsl.posixPath);
    }

    if (platform === 'win32') {
        return isWindowsContained(normalizedTarget, normalizedRoot);
    }

    if (platform === 'darwin') {
        // 1. Exact case-sensitive match is determinate on both APFS modes.
        if (isPosixContained(realTarget, realRoot)) {
            return true;
        }
        // 2. Check whether containment depends on case folding.
        if (!isPosixContained(realTarget.toLowerCase(), realRoot.toLowerCase())) {
            return false;
        }
        // 3. NEVER blindly fold case on macOS: require BOTH root and target volumes to be
        //    positively confirmed case-insensitive (`false`). If either is case-sensitive
        //    (`true`) or indeterminate (`null`), FAIL CLOSED!
        const rootSensitive = probeCaseSensitivity(realRoot);
        const targetSensitive = probeCaseSensitivity(realTarget);
        return rootSensitive === false && targetSensitive === false;
    }

    // Linux & other POSIX filesystems are strictly case-sensitive.
    return isPosixContained(realTarget, realRoot);
}

/**
 * Positively authorize a reveal target against an explicit list of active roots.
 *
 * Security invariants:
 * - Zero denylist logic; only targets strictly inside a canonicalized authorized root pass.
 * - Zero lexical fallback: canonicalization (`realpathSync`) failure on target OR root fails closed.
 * - Zero blind macOS case-folding: honors APFS case-sensitivity probing and fails closed when indeterminate.
 * - Honors WSL distro boundaries and POSIX case sensitivity (Ubuntu != Debian, `/Dev` != `/dev`).
 */
export function validateIdeRevealTarget(
    rawTarget: unknown,
    options: ValidateIdeRevealOptions,
): IdeRevealValidationResult {
    if (typeof rawTarget !== 'string' || !rawTarget.trim()) {
        return { ok: false, error: 'Reveal target is required' };
    }
    if (/[\0\r\n]/.test(rawTarget)) {
        return { ok: false, error: 'Invalid reveal target' };
    }
    const platform = options.platform ?? process.platform;
    const fsOps = options.fsOps ?? DEFAULT_IDE_REVEAL_FS_OPS;
    const authorizedRoots = Array.isArray(options.authorizedRoots) ? options.authorizedRoots : [];
    if (authorizedRoots.length === 0) {
        return { ok: false, error: 'No active authorized roots available' };
    }

    // If rawTarget is a `vscode-remote://wsl+<distro>/...` URI on Linux inside that exact WSL distro,
    // translate to local POSIX path ONLY when active distro matches; otherwise reject non-local remote URIs!
    let effectiveRawTarget = rawTarget.trim();
    const rawWslTarget = parseWslRef(effectiveRawTarget, platform, options.wslDistro);
    if (/^vscode-remote:\/\//i.test(effectiveRawTarget)) {
        if (!rawWslTarget) {
            return { ok: false, error: 'Remote non-local URI cannot be revealed locally' };
        }
        const activeDistro = options.wslDistro?.trim().toLowerCase();
        if (platform === 'linux' && activeDistro && rawWslTarget.distro === activeDistro) {
            effectiveRawTarget = rawWslTarget.posixPath;
        } else if (platform === 'win32') {
            effectiveRawTarget = `\\\\wsl.localhost\\${rawWslTarget.distro}${rawWslTarget.posixPath.replace(/\//g, '\\')}`;
        } else {
            return { ok: false, error: 'WSL URI distro does not match local reveal environment' };
        }
    }

    const candidateFsPath = parseLocalRevealCandidate(effectiveRawTarget, platform);
    if (!candidateFsPath) {
        return { ok: false, error: 'Unsupported or non-absolute reveal path' };
    }

    // Target MUST exist and canonicalize cleanly — zero lexical fallback, zero parent-dir fallback
    let realTarget: string;
    let targetStat: { isFile(): boolean; isDirectory(): boolean; dev: number | bigint; ino: number | bigint };
    try {
        realTarget = fsOps.realpathSync(candidateFsPath);
        targetStat = fsOps.statSync(realTarget);
    } catch {
        return { ok: false, error: 'Target path does not exist or cannot be canonicalized' };
    }

    if (!targetStat.isFile() && !targetStat.isDirectory()) {
        return { ok: false, error: 'Target must be a regular file or directory' };
    }

    // Canonicalize authorized roots strictly (skip any root that fails canonicalization — NEVER lexical fallback!)
    const canonicalRoots: string[] = [];
    for (const rawRoot of authorizedRoots) {
        if (typeof rawRoot !== 'string' || !rawRoot.trim()) { continue; }
        const trimmedRoot = rawRoot.trim();
        const rootWsl = parseWslRef(trimmedRoot, platform, options.wslDistro);
        const rootCandidates: string[] = [];
        if (/^vscode-remote:\/\//i.test(trimmedRoot)) {
            if (!rootWsl) { continue; }
            const activeDistro = options.wslDistro?.trim().toLowerCase();
            if (platform === 'linux' && activeDistro && rootWsl.distro === activeDistro) {
                rootCandidates.push(rootWsl.posixPath);
            } else if (platform === 'win32') {
                const winSuffix = rootWsl.posixPath.replace(/\//g, '\\');
                rootCandidates.push(`\\\\wsl.localhost\\${rootWsl.distro}${winSuffix}`);
                rootCandidates.push(`\\\\wsl$\\${rootWsl.distro}${winSuffix}`);
            } else {
                continue;
            }
        } else {
            const localRoot = parseLocalRevealCandidate(trimmedRoot, platform);
            if (localRoot) { rootCandidates.push(localRoot); }
        }
        for (const rootCandidate of rootCandidates) {
            try {
                const realRoot = fsOps.realpathSync(rootCandidate);
                const rootStat = fsOps.statSync(realRoot);
                if (rootStat.isDirectory()) {
                    canonicalRoots.push(realRoot);
                    break;
                }
            } catch {
                // Fail closed on uncanonicalizable roots (never fall back to lexical path.resolve)
            }
        }
    }

    if (canonicalRoots.length === 0) {
        return { ok: false, error: 'No canonicalizable authorized roots available' };
    }

    const probeFs: PathCaseProbeFs | undefined = options.fsOps
        ? {
            statSync: (p) => fsOps.statSync(p),
            ...(fsOps.readdirSync ? { readdirSync: (p) => fsOps.readdirSync!(p) } : {}),
            useCache: false,
        }
        : undefined;
    const probeCaseSensitivity = options.isCaseSensitivePath
        ?? ((p: string) => detectPathCaseSensitivity(p, probeFs));

    // When target originated from WSL URI on Linux, also verify the target's distro matches at least one root's distro
    if (rawWslTarget && platform === 'linux') {
        const activeDistro = options.wslDistro?.trim().toLowerCase();
        if (!activeDistro || rawWslTarget.distro !== activeDistro) {
            return { ok: false, error: 'WSL distro mismatch' };
        }
    }

    const allowed = canonicalRoots.some(rootReal =>
        isTargetContainedInCanonicalRoot(realTarget, rootReal, platform, probeCaseSensitivity),
    );
    if (!allowed) {
        return { ok: false, error: 'Target path is outside active authorized roots' };
    }

    return {
        ok: true,
        resolvedPath: realTarget,
        isDirectory: targetStat.isDirectory(),
    };
}

function getActiveWorkspaceRevealRoots(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return [];
    }
    const roots: string[] = [];
    for (const folder of folders) {
        const uri = folder?.uri?.toString?.();
        if (uri && !roots.includes(uri)) {
            roots.push(uri);
        }
    }
    return roots;
}

function getAuthorizedConversationTarget(
    cascadeId: string,
    kind: 'record' | 'pb',
): IdeRevealValidationResult {
    const root = getAntigravityRoot();
    const authorizedRoots = [
        path.join(root, 'brain'),
        path.join(root, 'browser_recordings'),
        path.join(root, 'conversations'),
    ];
    const candidates = kind === 'pb'
        ? [path.join(root, 'conversations', `${cascadeId}.pb`)]
        : [
            path.join(root, 'brain', cascadeId),
            path.join(root, 'browser_recordings', cascadeId),
        ];

    for (const candidate of candidates) {
        const res = validateIdeRevealTarget(candidate, {
            authorizedRoots,
            wslDistro: process.env.WSL_DISTRO_NAME?.trim() || undefined,
        });
        if (res.ok) {
            return res;
        }
    }
    return { ok: false, error: 'Conversation artifact does not exist inside authorized directory' };
}

async function revealAuthorizedResult(
    result: IdeRevealValidationResult,
    action: string,
): Promise<boolean> {
    if (!result.ok || !result.resolvedPath) {
        const warning = tBi(
            'Blocked reveal request: path is missing or outside active authorized workspace folders.',
            '已阻止定位请求：目标路径不存在或不在当前已打开的工作区目录内。',
        );
        void vscode.window.showWarningMessage(warning);
        safePostMessage({
            command: 'historyActionResult',
            action,
            ok: false,
            error: result.error || 'Reveal not authorized',
        });
        return false;
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.resolvedPath));
    safePostMessage({ command: 'historyActionResult', action, ok: true });
    return true;
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
    const outbound = panelHostNonce && message && typeof message === 'object' && !Array.isArray(message)
        ? { ...(message as Record<string, unknown>), __acmHostNonce: panelHostNonce }
        : message;
    try {
        panel.webview.postMessage(outbound);
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
// User-directed selection changes deliver one result even when periodic UI updates are paused.
let awaitingSelectionUpdate = false;

/** Calendar interactive navigation & filter state */
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;
let calendarSourceFilter: CalendarSourceFilter = 'all';
let calendarMetricMode: CalendarMetricMode = 'tokens';
let calendarPeriodMode: CalendarPeriodMode = 'daily';
let calendarViewMode: CalendarViewMode | undefined = undefined;
let calendarSelectedDate = '';

function buildIdeCurrencyConfig(docSettings: MonitorDocumentSettings): CurrencyConfig {
    const shared = getIdePanelHostBridge().getSharedAppSettings();
    const boundCurrency = lastAppSettings?.customFxCurrency !== undefined
        ? lastAppSettings.customFxCurrency
        : shared.customFxCurrency;
    const resolved = resolveAppCurrencyConfig({
        displayCurrency: docSettings.displayCurrency ?? 'USD',
        customFxRate: docSettings.customFxRate ?? null,
        ...(boundCurrency !== undefined ? { customFxCurrency: boundCurrency } : {}),
    });
    return {
        code: resolved.preset.code,
        ...(resolved.isCustomRate
            ? { customRatePerUsd: resolved.ratePerUsd, customFxCurrency: resolved.customFxCurrency }
            : {}),
    };
}

function buildIdeSubscriptionConfig(docSettings: MonitorDocumentSettings): SubscriptionConfig | null {
    const planId = normalizeSubscriptionPlanId(docSettings.subscriptionPlan, docSettings.subscriptionMonthlyFee);
    if (planId === 'none') { return null; }
    const feeCurrency = normalizeCurrencyCode(docSettings.subscriptionCurrency ?? 'USD', 'USD');
    const shared = getIdePanelHostBridge().getSharedAppSettings();
    const boundCurrency = lastAppSettings?.customFxCurrency !== undefined
        ? lastAppSettings.customFxCurrency
        : shared.customFxCurrency;
    const resolvedFeeFx = resolveAppCurrencyConfig({
        displayCurrency: feeCurrency,
        customFxRate: docSettings.customFxRate ?? null,
        ...(boundCurrency !== undefined ? { customFxCurrency: boundCurrency } : {}),
    });
    return {
        planId,
        ...(typeof docSettings.subscriptionMonthlyFee === 'number' && Number.isFinite(docSettings.subscriptionMonthlyFee) && docSettings.subscriptionMonthlyFee > 0
            ? { monthlyFee: docSettings.subscriptionMonthlyFee }
            : {}),
        feeCurrency,
        ...(resolvedFeeFx.isCustomRate ? { customRatePerUsd: resolvedFeeFx.ratePerUsd } : {}),
    };
}

function buildIdeCalendarOptions(
    docSettings: MonitorDocumentSettings,
    nowMs = Date.now(),
    redactPrivacy = false,
): CalendarRenderOptions {
    const customPricing = lastPricingStore?.getCustom() ?? lastCustomPricing;
    const cliDays = lastCliDays !== undefined ? lastCliDays : getIdePanelHostBridge().getCachedCliUsageDays(false);
    const activeBuckets = redactPrivacy
        ? lastTodayLedgerActive.map(redactActiveLedgerBucketForPrivacy)
        : lastTodayLedgerActive;
    const settledEntries = redactPrivacy
        ? lastLedgerSettled.map(redactSettledLedgerEntryForPrivacy)
        : lastLedgerSettled;
    const maskedSwarmGroups = redactPrivacy && lastSwarmTopology && lastSwarmTopology.groupsByRootId.size > 0
        ? [...lastSwarmTopology.groupsByRootId.values()].map(g => ({
            rootId: opaqueArchiveIdentity(g.rootId),
            memberIds: g.memberIds.map(opaqueArchiveIdentity),
        }))
        : undefined;
    return {
        liveLedger: {
            active: activeBuckets,
            settled: settledEntries,
            customPricing,
            defaultSurface: 'ide',
        },
        ...(maskedSwarmGroups ? { swarmGroups: maskedSwarmGroups } : {}),
        cliDays,
        sourceFilter: calendarSourceFilter,
        metricMode: calendarMetricMode,
        periodMode: calendarPeriodMode,
        ...(calendarViewMode ? { viewMode: calendarViewMode } : {}),
        ...(calendarSelectedDate ? { selectedDate: calendarSelectedDate } : {}),
        currency: buildIdeCurrencyConfig(docSettings),
        subscription: buildIdeSubscriptionConfig(docSettings),
        customPricing,
        now: nowMs,
    };
}

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
        // Preserve unknown (`minimum === null`) as NaN so formatContextTextReport prints 'N/A' instead of fabricated '0%'.
        const pct = group.minimum !== null ? Math.round(group.minimum * 100) : Number.NaN;
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
    if (p.todayLedgerActive) {
        lastTodayLedgerActive = p.todayLedgerActive;
        lastLedgerDateKey = p.ledgerDateKey;
    }
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
    if ('cliDays' in p) { lastCliDays = p.cliDays; }
    if ('orchestratorPricingMode' in p) { lastOrchestratorPricingMode = p.orchestratorPricingMode; }
    if ('appSettings' in p) { lastAppSettings = p.appSettings; }
    if ('updateStatus' in p) { lastUpdateStatus = p.updateStatus ?? null; }
    if ('lowQuotaWarning' in p) { lastLowQuotaWarning = p.lowQuotaWarning; }
    if ('publishedObservation' in p) { lastPublishedObservation = p.publishedObservation ?? null; }
    if ('windowSelectionState' in p) { lastWindowSelectionState = p.windowSelectionState ?? null; }
    if ('swarmTopology' in p) { lastSwarmTopology = p.swarmTopology ?? null; }
    if ('swarmGroupCost' in p) { lastSwarmGroupCost = p.swarmGroupCost ?? null; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show or reveal the WebView monitor panel.
 * Creates the panel on first call, reveals it on subsequent calls.
 */
export function showMonitorPanel(p: PanelPayload): void {
    getIdePanelHostBridge().syncDurableStateFromDisk(false);
    cachePayload(p);

    if (panel) {
        const wasVisible = panel.visible;
        if (p.initialTab) { pendingTab = { tab: p.initialTab, requestId: ++nextTabRequest }; }
        panel.reveal(undefined, false);
        if (!isPaused) { postCurrentTabs(); }
        if (wasVisible || panel.visible) { sendPendingTab(); }
        scheduleIdeCdpProbeIfEnabled();
        return;
    }

    // Fresh panel always starts fail-closed with privacy mask enabled and a fresh cryptographic host nonce.
    resetPanelPrivacyState();
    panelHostNonce = crypto.randomBytes(24).toString('hex');

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Antigravity Monitor', 'Antigravity 监控面板')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
        { enableScripts: true },
    );
    try {
        void vscode.commands.executeCommand?.('setContext', 'antigravityContextMonitor.panelFocused', true);
    } catch { /* test mock without executeCommand */ }

    const buildIdeHandoffV2 = (): HandoffV2Result => {
        const privacyCtx = panelPrivacyMasked ? collectSensitiveContext() : null;
        const hooks = getIdeV118HostHooks();
        const meta = hooks?.getCurrentObservationMeta?.();
        const obs = lastPublishedObservation;
        const subjectCascadeId = obs ? obs.subjectCascadeId : (meta?.subjectCascadeId ?? lastUsage?.cascadeId ?? lastActiveConversationId ?? null);
        const dataRevision = obs?.dataRevision ?? meta?.dataRevision ?? 0;
        const matchedUsage = lastUsage?.cascadeId === subjectCascadeId ? lastUsage : lastAllUsages.find(u => u.cascadeId === subjectCascadeId);
        const matchedTraj = subjectCascadeId ? lastTrajectories.find(tr => tr.cascadeId === subjectCascadeId) : undefined;
        const wsRaw = matchedTraj?.workspaceUris?.[0] || matchedUsage?.gitRootUri || '';
        const swarmSum = hooks?.getSwarmSummary?.() ?? null;
        const canonicalModel = matchedUsage?.modelDisplayName
            || (obs?.measuredModel ? normalizeModelDisplayName(obs.measuredModel) : null)
            || matchedUsage?.model
            || null;
        return buildAllowlistedHandoffV2({
            observation: obs,
            subjectCascadeId,
            dataRevision,
            canonicalModel,
            title: matchedUsage?.title ?? matchedTraj?.summary ?? null,
            workspaceUriOrLabel: wsRaw || null,
            branchName: matchedUsage?.branchName ?? matchedTraj?.branchName ?? null,
            turnStatus: {
                status: matchedTraj?.status ?? matchedUsage?.status ?? undefined,
                stepCount: matchedUsage?.stepCount ?? matchedTraj?.stepCount ?? null,
                cacheState: lastUsage && matchedUsage === lastUsage ? lastTurnDiagnostics?.lastTurnStartKind : undefined,
                speedMode: obs?.speedMode,
                speedTps: obs?.displaySpeedTps ?? null,
                compressionDetected: Boolean(matchedUsage?.compressionDetected || (lastUsage && matchedUsage === lastUsage && lastContextBreakdown?.compactionCheckpoints?.length)),
            },
            swarmSummary: swarmSum
                ? {
                    activeCount: swarmSum.activeCount ?? 0,
                    totalCount: swarmSum.totalCount ?? 0,
                    members: (swarmSum.members || []).map(m => ({
                        name: m.name,
                        phase: m.phase,
                        killed: m.phase === 'killed',
                    })),
                }
                : null,
            privacyMasked: panelPrivacyMasked,
            redactText: privacyCtx ? (s: string) => scrubSensitiveText(s, privacyCtx) : undefined,
            lang: getLanguage(),
        });
    };

    panel.webview.onDidReceiveMessage(async (msg: {
        command: string;
        lang?: string;
        text?: string;
        value?: unknown;
        key?: string;
        action?: string;
        mode?: string;
        url?: string;
        force?: boolean;
        expanded?: boolean;
        masked?: boolean;
        privacyMasked?: boolean;
        source?: string;
        sourceFilter?: string;
        surfaceFilter?: string;
        metric?: string;
        period?: string;
        view?: string;
        date?: string | null;
        startDate?: string;
        endDate?: string;
        rangeStart?: string;
        rangeEnd?: string;
        selectedDates?: string[];
        selectedDate?: string;
        exportSelectedDateOnly?: boolean;
        year?: number;
        month?: number;
        cascadeId?: string;
        conversationId?: string | null;
        dataRevision?: number;
        eventKey?: string;
        json?: unknown;
        content?: unknown;
        backup?: unknown;
        copy?: boolean;
        locked?: boolean;
        uri?: string;
        email?: string;
        accountHandle?: string;
        accountKey?: string;
        day?: number;
        tab?: string;
        dismissed?: boolean;
        requestId?: number;
        createOnly?: boolean;
    }) => {
        if (msg.command === 'panelReady') {
            if (!isPaused) { postCurrentTabs(); }
            sendPendingTab();
            scheduleIdeCdpProbeIfEnabled();
        } else if (msg.command === 'tabShown') {
            if (pendingTab && (msg.requestId === pendingTab.requestId || (msg.requestId === undefined && msg.tab === pendingTab.tab))) {
                pendingTab = undefined;
            }
        } else if (
            msg.command === 'setPrivacyMask'
            || msg.command === 'togglePrivacyMask'
            || msg.command === 'setPrivacyMasked'
            || msg.command === 'unmaskPrivacy'
            || msg.command === 'remaskPrivacy'
        ) {
            let nextMasked: boolean;
            if (msg.command === 'unmaskPrivacy') {
                nextMasked = false;
            } else if (msg.command === 'remaskPrivacy') {
                nextMasked = true;
            } else if (typeof msg.masked === 'boolean') {
                nextMasked = msg.masked;
            } else if (typeof msg.privacyMasked === 'boolean') {
                nextMasked = msg.privacyMasked;
            } else if (typeof msg.value === 'boolean') {
                nextMasked = msg.value;
            } else {
                nextMasked = !panelPrivacyMasked;
            }
            panelPrivacyMasked = nextMasked;
            safePostMessage({
                command: 'privacyMaskState',
                masked: panelPrivacyMasked,
                privacyMasked: panelPrivacyMasked,
                ...(panelPrivacyMasked ? { clearRevealedCache: true } : {}),
            });
            // Explicit host re-render on unmask (reveals real identity) and re-mask (evicts revealed DOM)
            postCurrentTabs();
            postSettingsControlSync();
        } else if (msg.command === 'switchLanguage' && extensionCtx) {
            if (!isLanguage(msg.lang)) {
                console.warn('[Antigravity Context Monitor] Ignoring invalid language switch request:', msg.lang);
                return;
            }
            const bridge = getIdePanelHostBridge();
            bridge.markDisplayLanguageModified();
            await setLanguage(msg.lang, extensionCtx, panelDurableState);
            await bridge.updateSharedAppSetting('languagePreference', msg.lang).catch(() => {});
            await bridge.flushDurableState();
            refreshMonitorPanelLanguage();
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'refresh') {
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'togglePause') {
            isPaused = !isPaused;
            safePostMessage({ command: 'setPaused', paused: isPaused });
            if (!isPaused) { postCurrentTabs(); }
        } else if (msg.command === 'toggleNativeHud') {
            // Expanded state is persisted in webview state; no host-side mutation required
            return;
        } else if (msg.command === 'selectConversation' || msg.command === 'pinConversation') {
            const rawTarget = msg.conversationId !== undefined ? msg.conversationId : msg.cascadeId;
            const targetId = typeof rawTarget === 'string' && rawTarget.trim() && rawTarget !== 'auto' && rawTarget !== '__auto__'
                ? rawTarget.trim()
                : null;
            lastPinnedConversationId = targetId;
            getIdePanelHostBridge().selectPinnedConversation(targetId);
            refreshPanelSelection();
        } else if (msg.command === 'inspectMember' || msg.command === 'inspectSwarmMember') {
            const rawTarget = msg.cascadeId !== undefined ? msg.cascadeId : msg.conversationId;
            const targetId = typeof rawTarget === 'string' ? rawTarget.trim() : '';
            if (targetId) {
                const updatedSel = getIdePanelHostBridge().inspectSwarmMember?.(targetId) ?? null;
                if (updatedSel) { lastWindowSelectionState = updatedSel; }
                refreshPanelSelection();
            }
        } else if (msg.command === 'clearInspect' || msg.command === 'backToMain') {
            const updatedSel = getIdePanelHostBridge().clearInspectedSwarmMember?.() ?? null;
            if (updatedSel) { lastWindowSelectionState = updatedSel; }
            refreshPanelSelection();
        } else if (msg.command === 'retargetLock' || msg.command === 'retargetLockedRoot') {
            const rawTarget = msg.cascadeId !== undefined ? msg.cascadeId : msg.conversationId;
            const targetId = typeof rawTarget === 'string' ? rawTarget.trim() : '';
            if (targetId) {
                const updatedSel = getIdePanelHostBridge().retargetLockedRoot?.(targetId) ?? null;
                if (updatedSel) { lastWindowSelectionState = updatedSel; }
                lastLockToMainAgent = true;
                refreshPanelSelection();
            }
        } else if (msg.command === 'toggleLockMain' || msg.command === 'setLockToMainAgent') {
            const explicitLocked = typeof msg.locked === 'boolean'
                ? msg.locked
                : (typeof msg.value === 'boolean' ? msg.value : undefined);
            const nextLocked = getIdePanelHostBridge().setLockToMainAgent(explicitLocked);
            lastLockToMainAgent = nextLocked;
            const latestSel = getIdePanelHostBridge().getWindowSelectionState?.();
            if (latestSel !== undefined) { lastWindowSelectionState = latestSel; }
            safePostMessage({ command: 'syncSettingsControls', lockToMainAgent: nextLocked });
            refreshPanelSelection();
        } else if (msg.command === 'copyContextReport') {
            const rawSnapshot = buildFallbackSnapshotForReport();
            const privacyCtx = panelPrivacyMasked ? collectSensitiveContext() : null;
            const snapshot = privacyCtx ? (redactContextBreakdownForPrivacy(rawSnapshot, privacyCtx) ?? rawSnapshot) : rawSnapshot;
            const rawText = formatContextTextReport({
                snapshot,
                title: privacyCtx && lastUsage?.title ? scrubSensitiveText(lastUsage.title, privacyCtx) : lastUsage?.title,
                workspacePath: privacyCtx ? undefined : (lastWorkspaceUri || undefined),
                branchName: privacyCtx && lastUsage?.branchName ? scrubSensitiveText(lastUsage.branchName, privacyCtx) : (lastUsage?.branchName || undefined),
                cacheHitPct: lastTurnDiagnostics?.lastTurnCacheHitPct ?? lastTurnDiagnostics?.sessionCacheHitPct ?? null,
                turnStartKind: lastTurnDiagnostics?.lastTurnStartKind,
                quotaSummary: buildIdeQuotaSummaryLines(),
            }, getLanguage());
            const text = privacyCtx ? scrubSensitiveText(rawText, privacyCtx) : rawText;
            await vscode.env.clipboard.writeText(text);
            safePostMessage({ command: 'copyActionResult', action: 'copyContextReport', ok: true });
        } else if (msg.command === 'copyHandoffPrompt') {
            const handoff = buildIdeHandoffV2();
            await vscode.env.clipboard.writeText(handoff.previewText);
            safePostMessage({
                command: 'copyActionResult',
                action: 'copyHandoffPrompt',
                ok: true,
                subjectCascadeId: handoff.subjectCascadeId,
                dataRevision: handoff.dataRevision,
            });
        } else if (msg.command === 'previewHandoffV2') {
            const handoff = buildIdeHandoffV2();
            const reqCid = typeof msg.cascadeId === 'string' && msg.cascadeId.trim() ? msg.cascadeId.trim() : null;
            if (reqCid && reqCid !== handoff.subjectCascadeId) {
                safePostMessage({
                    command: 'handoffV2PreviewResult',
                    ok: false,
                    staleSubject: true,
                    expectedCascadeId: handoff.subjectCascadeId,
                    requestedCascadeId: reqCid,
                    dataRevision: handoff.dataRevision,
                });
                return;
            }
            const reqRev = typeof msg.dataRevision === 'number' && Number.isSafeInteger(msg.dataRevision) ? msg.dataRevision : null;
            const revisionMismatch = reqRev !== null && reqRev !== handoff.dataRevision;
            if (revisionMismatch) {
                safePostMessage({
                    command: 'handoffV2PreviewResult',
                    ok: false,
                    subjectCascadeId: handoff.subjectCascadeId,
                    dataRevision: handoff.dataRevision,
                    requestedDataRevision: reqRev,
                    revisionMismatch: true,
                });
                return;
            }
            if (msg.copy === true) {
                await vscode.env.clipboard.writeText(handoff.previewText);
            }
            safePostMessage({
                command: 'handoffV2PreviewResult',
                ok: true,
                ...handoff,
                markdown: handoff.previewText,
                text: handoff.previewText,
                revisionMismatch: false,
            });
        } else if (msg.command === 'dismissRecoveryBrief') {
            const hooks = getIdeV118HostHooks();
            const key = typeof msg.eventKey === 'string' ? msg.eventKey.trim() : (hooks?.getRecoveryBrief?.()?.eventKey ?? '');
            const res = hooks?.dismissRecoveryBrief
                ? await hooks.dismissRecoveryBrief(key)
                : { ok: false, error: 'Recovery brief dismissal unavailable' };
            safePostMessage({
                command: 'recoveryBriefDismissed',
                ok: res.ok,
                eventKey: key,
                ...(res.error ? { error: res.error } : {}),
            });
            if (res.ok && panel) {
                postCurrentTabs();
            }
        } else if (msg.command === 'exportSettingsBackup') {
            const hooks = getIdeV118HostHooks();
            if (!hooks?.exportSettingsBackup) {
                safePostMessage({ command: 'settingsBackupExportResult', ok: false, error: 'Settings backup unavailable' });
                return;
            }
            const backup = hooks.exportSettingsBackup();
            if (typeof vscode.window.showSaveDialog === 'function') {
                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), backup.filename)),
                    filters: { JSON: ['json'] },
                });
                if (!targetUri) {
                    safePostMessage({
                        command: 'settingsBackupExportResult',
                        ok: false,
                        canceled: true,
                        filename: backup.filename,
                    });
                    return;
                }
                if (typeof vscode.workspace.fs?.writeFile === 'function') {
                    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(backup.content, 'utf8'));
                } else if (targetUri.fsPath) {
                    await fs.promises.writeFile(targetUri.fsPath, backup.content, 'utf8');
                }
                safePostMessage({
                    command: 'settingsBackupExportResult',
                    ok: true,
                    saved: true,
                    filename: backup.filename,
                    schemaVersion: backup.schemaVersion,
                    keyCount: backup.keyCount,
                });
                return;
            }
            safePostMessage({
                command: 'settingsBackupExportResult',
                ok: true,
                filename: backup.filename,
                content: backup.content,
                schemaVersion: backup.schemaVersion,
                keyCount: backup.keyCount,
            });
        } else if (msg.command === 'importSettingsBackup') {
            const hooks = getIdeV118HostHooks();
            if (!hooks?.importSettingsBackup) {
                safePostMessage({ command: 'settingsBackupImportResult', ok: false, error: 'Settings import unavailable' });
                return;
            }
            let rawInput = msg.json !== undefined ? msg.json : (msg.content !== undefined ? msg.content : msg.backup);
            if (rawInput === undefined && typeof vscode.window.showOpenDialog === 'function') {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { JSON: ['json'] },
                });
                const fileUri = picked?.[0];
                if (!fileUri) { return; }
                if (typeof vscode.workspace.fs?.readFile === 'function') {
                    rawInput = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
                } else if (fileUri.fsPath) {
                    rawInput = await fs.promises.readFile(fileUri.fsPath, 'utf8');
                }
            }
            const res = await hooks.importSettingsBackup(rawInput);
            safePostMessage({
                command: 'settingsBackupImportResult',
                ok: res.ok,
                appliedKeys: res.appliedKeys ?? [],
                strippedKeys: res.strippedKeys ?? [],
                customPricingImported: Boolean(res.customPricingImported),
                ...(res.error ? { error: res.error } : {}),
            });
            if (res.ok && panel) {
                lastAppSettings = getIdePanelHostBridge().getSharedAppSettings();
                postSettingsControlSync();
                postCurrentTabs();
            }
        } else if (msg.command === 'exportRedactedDiagnostics') {
            const hooks = getIdeV118HostHooks();
            if (!hooks?.exportRedactedDiagnostics) {
                safePostMessage({ command: 'redactedDiagnosticsResult', ok: false, error: 'Diagnostics export unavailable' });
                return;
            }
            const diag = hooks.exportRedactedDiagnostics();
            if (typeof vscode.window.showSaveDialog === 'function') {
                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), diag.filename)),
                    filters: { JSON: ['json'] },
                });
                if (!targetUri) {
                    safePostMessage({
                        command: 'redactedDiagnosticsResult',
                        ok: false,
                        canceled: true,
                        filename: diag.filename,
                    });
                    return;
                }
                if (typeof vscode.workspace.fs?.writeFile === 'function') {
                    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(diag.content, 'utf8'));
                } else if (targetUri.fsPath) {
                    await fs.promises.writeFile(targetUri.fsPath, diag.content, 'utf8');
                }
                safePostMessage({
                    command: 'redactedDiagnosticsResult',
                    ok: true,
                    saved: true,
                    filename: diag.filename,
                    diagnostics: diag.diagnostics,
                });
                return;
            }
            safePostMessage({
                command: 'redactedDiagnosticsResult',
                ok: true,
                filename: diag.filename,
                content: diag.content,
                diagnostics: diag.diagnostics,
            });
        } else if (msg.command === 'setOrchestratorPricingMode') {
            const rawMode = msg.mode !== undefined ? msg.mode : msg.value;
            if (rawMode === 'mapped' || rawMode === 'strict') {
                const mode = normalizeOrchestratorPricingMode(rawMode);
                const bridge = getIdePanelHostBridge();
                const commitRes = await bridge.setSharedOrchestratorPricingMode(mode);
                lastOrchestratorPricingMode = mode;
                lastAppSettings = bridge.getSharedAppSettings();
                if (panel) {
                    if (commitRes.ok && commitRes.committed) {
                        safePostMessage({ command: 'configSaved', key: 'orchestratorPricingMode' });
                    } else {
                        safePostMessage({
                            command: 'configSaveFailed',
                            key: 'orchestratorPricingMode',
                            error: commitRes.error || 'Failed to persist setting',
                        });
                    }
                    postSettingsControlSync();
                    postCurrentTabs();
                }
            }
        } else if (msg.command === 'setAppSetting' && msg.key) {
            const bridge = getIdePanelHostBridge();
            const res = await bridge.updateSharedAppSetting(msg.key, msg.value);
            if (res.ok && res.committed !== false) {
                lastAppSettings = bridge.getSharedAppSettings();
                lastOrchestratorPricingMode = lastAppSettings.orchestratorPricingMode;
                const isOverlayToggle = res.normalizedKey === 'appComposerRingEnabled' || res.normalizedKey === 'appTopBarEnabled';
                if (isOverlayToggle) {
                    const seq = ++ideCdpProbeSeq;
                    ideCdpProbeInFlight = null;
                    const composerOn = Boolean(lastAppSettings.appComposerRingEnabled);
                    const topBarOn = Boolean(lastAppSettings.appTopBarEnabled);
                    if (!composerOn && !topBarOn) {
                        lastCdpStatus = {
                            state: 'disabled',
                            diagnosticCode: 'disabled',
                            composerEnabled: false,
                            topBarEnabled: false,
                            launcherStatus: ideCdpLauncherActions.inspect({ env: process.env }),
                            platformGuide: getCdpPlatformGuide(process.platform),
                        };
                    } else {
                        const probed = await probeIdeCdpStatus(composerOn, topBarOn);
                        if (!panel || seq !== ideCdpProbeSeq) { return; }
                        const latestApp = bridge.getSharedAppSettings();
                        const latestComposerOn = Boolean(latestApp.appComposerRingEnabled);
                        const latestTopBarOn = Boolean(latestApp.appTopBarEnabled);
                        lastAppSettings = latestApp;
                        if (!latestComposerOn && !latestTopBarOn) {
                            lastCdpStatus = {
                                state: 'disabled',
                                diagnosticCode: 'disabled',
                                composerEnabled: false,
                                topBarEnabled: false,
                                launcherStatus: ideCdpLauncherActions.inspect({ env: process.env }),
                                platformGuide: getCdpPlatformGuide(process.platform),
                            };
                        } else {
                            lastCdpStatus = {
                                ...probed,
                                composerEnabled: latestComposerOn,
                                topBarEnabled: latestTopBarOn,
                            };
                        }
                    }
                }
                if (panel) {
                    safePostMessage({ command: 'configSaved', key: res.normalizedKey });
                    if (isOverlayToggle && lastCdpStatus) {
                        const outboundCdp = panelPrivacyMasked
                            ? redactCdpStatusForPrivacy(lastCdpStatus, collectSensitiveContext())
                            : lastCdpStatus;
                        safePostMessage({
                            type: 'cdpStatusResult',
                            command: 'cdpStatusResult',
                            cdpStatus: outboundCdp,
                        });
                    }
                    postSettingsControlSync();
                    postCurrentTabs();
                }
            } else if (panel) {
                safePostMessage({
                    command: 'configSaveFailed',
                    key: res.normalizedKey || msg.key,
                    error: res.error || 'Failed to persist setting',
                });
            }
        } else if (msg.command === 'recheckCdp') {
            const seq = ++ideCdpProbeSeq;
            ideCdpProbeInFlight = null;
            const docSettings = readIdeDocumentSettings();
            const cdpStatus = await probeIdeCdpStatus(
                Boolean(docSettings.appComposerRingEnabled),
                Boolean(docSettings.appTopBarEnabled),
            );
            if (!panel || seq !== ideCdpProbeSeq) { return; }
            if (!cdpStatus.composerEnabled && !cdpStatus.topBarEnabled && !cdpStatus.launcherStatus) {
                cdpStatus.launcherStatus = ideCdpLauncherActions.inspect({ env: process.env });
            }
            lastCdpStatus = cdpStatus;
            const outboundCdp = panelPrivacyMasked
                ? redactCdpStatusForPrivacy(cdpStatus, collectSensitiveContext())
                : cdpStatus;
            safePostMessage({
                type: 'cdpStatusResult',
                command: 'cdpStatusResult',
                cdpStatus: outboundCdp,
            });
            if (panel) {
                postSettingsControlSync();
            }
        } else if (msg.command === 'setupCdpLauncher' || msg.command === 'removeCdpLauncher') {
            const seq = ++ideCdpProbeSeq;
            ideCdpProbeInFlight = null;
            const launcherRes = msg.command === 'setupCdpLauncher'
                ? ideCdpLauncherActions.create({ env: process.env })
                : ideCdpLauncherActions.remove({ env: process.env });
            const docSettings = readIdeDocumentSettings();
            const probed = await probeIdeCdpStatus(
                Boolean(docSettings.appComposerRingEnabled),
                Boolean(docSettings.appTopBarEnabled),
            );
            if (!panel || seq !== ideCdpProbeSeq) { return; }
            const cdpStatus: CdpStatus = {
                ...probed,
                launcherStatus: launcherRes.status,
            };
            lastCdpStatus = cdpStatus;
            const privacyCtx = panelPrivacyMasked ? collectSensitiveContext() : null;
            const outboundCdp = privacyCtx ? redactCdpStatusForPrivacy(cdpStatus, privacyCtx) : cdpStatus;
            safePostMessage({
                type: 'cdpLauncherResult',
                command: 'cdpLauncherResult',
                action: msg.command,
                ok: launcherRes.ok,
                launcherStatus: outboundCdp?.launcherStatus,
                messageEn: privacyCtx ? scrubSensitiveText(launcherRes.messageEn, privacyCtx) : launcherRes.messageEn,
                messageZh: privacyCtx ? scrubSensitiveText(launcherRes.messageZh, privacyCtx) : launcherRes.messageZh,
                ...(launcherRes.error ? { error: privacyCtx ? scrubSensitiveText(launcherRes.error, privacyCtx) : launcherRes.error } : {}),
                cdpStatus: outboundCdp,
            });
            safePostMessage({
                type: 'cdpStatusResult',
                command: 'cdpStatusResult',
                cdpStatus: outboundCdp,
            });
            if (panel) {
                postSettingsControlSync();
                postCurrentTabs();
            }
        } else if (msg.command === 'revealCdpLauncher') {
            const launcherRes = await ideCdpLauncherActions.reveal({ env: process.env });
            const docSettings = readIdeDocumentSettings();
            const baseStatus = resolveEffectiveIdeCdpStatus(docSettings) ?? {
                state: 'disabled' as const,
                diagnosticCode: 'disabled' as const,
                composerEnabled: Boolean(docSettings.appComposerRingEnabled),
                topBarEnabled: Boolean(docSettings.appTopBarEnabled),
                platformGuide: getCdpPlatformGuide(process.platform),
            };
            const cdpStatus: CdpStatus = {
                ...baseStatus,
                launcherStatus: launcherRes.status,
            };
            lastCdpStatus = cdpStatus;
            const privacyCtx = panelPrivacyMasked ? collectSensitiveContext() : null;
            const outboundCdp = privacyCtx ? redactCdpStatusForPrivacy(cdpStatus, privacyCtx) : cdpStatus;
            safePostMessage({
                type: 'cdpLauncherResult',
                command: 'cdpLauncherResult',
                action: 'revealCdpLauncher',
                ok: launcherRes.ok,
                launcherStatus: outboundCdp?.launcherStatus,
                messageEn: privacyCtx ? scrubSensitiveText(launcherRes.messageEn, privacyCtx) : launcherRes.messageEn,
                messageZh: privacyCtx ? scrubSensitiveText(launcherRes.messageZh, privacyCtx) : launcherRes.messageZh,
                ...(launcherRes.error ? { error: privacyCtx ? scrubSensitiveText(launcherRes.error, privacyCtx) : launcherRes.error } : {}),
                cdpStatus: outboundCdp,
            });
            if (panel) {
                postSettingsControlSync();
            }
        } else if (msg.command === 'setPollingInterval' && typeof msg.value === 'number') {
            const val = Math.max(1, Math.min(60, msg.value));
            const res = await getIdePanelHostBridge().updateSharedAppSetting('pollingInterval', val);
            if (res.ok && res.committed !== false) {
                const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
                if (typeof cfg.update === 'function') {
                    await cfg.update('pollingInterval', val, vscode.ConfigurationTarget?.Global);
                }
                if (panel) {
                    safePostMessage({ command: 'configSaved', key: 'pollingInterval' });
                }
            } else if (panel) {
                safePostMessage({
                    command: 'configSaveFailed',
                    key: 'pollingInterval',
                    error: res.error || 'Failed to persist pollingInterval',
                });
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
                const res = await getIdePanelHostBridge().updateSharedAppSetting(msg.key, normalizedValue);
                if (res.ok && res.committed !== false) {
                    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
                    if (typeof cfg.update === 'function') {
                        await cfg.update(msg.key, normalizedValue, vscode.ConfigurationTarget?.Global);
                    }
                    if (panel) {
                        safePostMessage({ command: 'configSaved', key: msg.key });
                    }
                } else if (panel) {
                    safePostMessage({
                        command: 'configSaveFailed',
                        key: msg.key,
                        error: res.error || `Failed to persist ${msg.key}`,
                    });
                }
            }
        } else if (msg.command === 'checkForUpdates') {
            const bridge = getIdePanelHostBridge();
            const res = await bridge.checkIdeReleaseUpdates(msg.force !== false);
            lastUpdateStatus = bridge.getLastUpdateStatusView();
            const resolvedLatest = res.latestVersion ?? lastUpdateStatus?.latestVersion ?? null;
            const versionAwareHasUpdate = isUpdateAvailableForVersion(
                {
                    checkedAt: res.checkedAt,
                    latestVersion: resolvedLatest,
                    hasUpdate: Boolean(res.hasUpdate || (res.status === 'not_modified' && lastUpdateStatus?.hasUpdate)),
                    etag: res.etag ?? null,
                    releaseUrl: res.releaseInfo?.releaseUrl ?? lastUpdateStatus?.releaseUrl ?? null,
                    releaseNotesSummary: res.releaseInfo?.releaseNotesSummary ?? lastUpdateStatus?.releaseNotesSummary ?? null,
                    assetName: null,
                    assetUrl: null,
                    checksumsUrl: null,
                    error: res.error ?? null,
                },
                res.currentVersion,
            );
            safePostMessage({
                type: 'updateCheckResult',
                command: 'updateCheckResult',
                status: res.status,
                currentVersion: res.currentVersion,
                latestVersion: resolvedLatest,
                hasUpdate: versionAwareHasUpdate,
                updateAvailable: versionAwareHasUpdate,
                checkedAt: res.checkedAt,
                releaseUrl: res.releaseInfo?.releaseUrl ?? lastUpdateStatus?.releaseUrl ?? null,
                releaseNotesSummary: res.releaseInfo?.releaseNotesSummary ?? lastUpdateStatus?.releaseNotesSummary ?? null,
                openVsxUrl: OPEN_VSX_EXTENSION_URL,
                updateStatus: lastUpdateStatus,
                error: res.error ?? null,
            });
            if (panel) {
                postSettingsControlSync();
                postCurrentTabs();
            }
        } else if (msg.command === 'applyPluginUpdate') {
            safePostMessage({
                type: 'pluginUpdateResult',
                command: 'pluginUpdateResult',
                ok: false,
                requiresReload: false,
                openVsxUrl: OPEN_VSX_EXTENSION_URL,
                message: tBi(
                    'In Antigravity IDE, update the extension via Open VSX Marketplace (AGI-is-going-to-arrive.antigravity-context-monitor) or Extensions view.',
                    '在 Antigravity IDE 中，请通过 Open VSX 商店（AGI-is-going-to-arrive.antigravity-context-monitor）或扩展面板更新扩展。',
                ),
            });
        } else if (msg.command === 'openExternalUrl') {
            const safeUrl = validateExternalUrl(msg.url);
            if (safeUrl && typeof vscode.env?.openExternal === 'function') {
                await vscode.env.openExternal(vscode.Uri.parse(safeUrl));
            }
        } else if (msg.command === 'setAccountBillingDay' && typeof msg.day === 'number') {
            const rawIdentifier = msg.accountHandle ?? msg.accountKey ?? msg.email;
            const resolvedEmail = resolveOpaqueAccountHandle(rawIdentifier);
            if (!resolvedEmail) {
                if (panel) {
                    safePostMessage({
                        command: 'configSaveFailed',
                        key: 'accountBillingDay',
                        error: 'Unknown account handle',
                    });
                }
                return;
            }
            const bridge = getIdePanelHostBridge();
            const saved = bridge.setAccountBillingDay(resolvedEmail, msg.day);
            const receipt = await bridge.flushDurableState();
            if (saved && receipt.committed && panel) {
                safePostMessage({ command: 'configSaved', key: 'accountBillingDay' });
            } else if (panel) {
                safePostMessage({
                    command: 'configSaveFailed',
                    key: 'accountBillingDay',
                    error: receipt.error || 'Failed to persist billing day',
                });
            }
        } else if (msg.command === 'copyStatePath' && lastStorageDiagnostics?.stateFilePath) {
            const toCopy = panelPrivacyMasked
                ? redactStateFilePath(lastStorageDiagnostics.stateFilePath)
                : lastStorageDiagnostics.stateFilePath;
            await vscode.env.clipboard.writeText(toCopy);
            safePostMessage({ command: 'configSaved', key: 'statePath' });
        } else if (msg.command === 'copyText' && typeof msg.text === 'string' && msg.text.length <= 4096) {
            const toCopy = panelPrivacyMasked
                ? scrubSensitiveText(msg.text, collectSensitiveContext())
                : msg.text;
            await vscode.env.clipboard.writeText(toCopy);
            safePostMessage({ command: 'copyActionResult', action: 'copyText', ok: true });
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
                const authorizedRoots = getActiveWorkspaceRevealRoots();
                const validation = validateIdeRevealTarget(msg.uri, {
                    authorizedRoots,
                    wslDistro: process.env.WSL_DISTRO_NAME?.trim() || undefined,
                });
                await revealAuthorizedResult(validation, 'workspace');
            } else if ((msg.action === 'record' || msg.action === 'pb') && msg.cascadeId && SAFE_CASCADE_ID_RE.test(msg.cascadeId.trim())) {
                const validation = getAuthorizedConversationTarget(msg.cascadeId.trim(), msg.action);
                await revealAuthorizedResult(validation, msg.action);
            } else {
                await revealAuthorizedResult({ ok: false, error: 'Unsupported history reveal action' }, msg.action);
            }
        } else if (msg.command === 'setPanelPref' && msg.key && ['panelShowTabScrollHint', 'panelShowScrollbar', 'panelShowEndOfContent'].includes(msg.key)) {
            let committed = true;
            let errorMsg: string | undefined;
            if (panelDurableState) {
                await panelDurableState.update(msg.key, !!msg.value);
                const receipt = await getIdePanelHostBridge().flushDurableState();
                committed = receipt.committed;
                errorMsg = receipt.error;
            }
            if (committed) {
                safePostMessage({ command: 'panelPrefUpdated', key: msg.key, value: !!msg.value });
                safePostMessage({ command: 'configSaved', key: msg.key });
            } else {
                safePostMessage({
                    command: 'configSaveFailed',
                    key: msg.key,
                    error: errorMsg || `Failed to persist ${msg.key}`,
                });
            }
        } else if (msg.command === 'setZoomLevel' && typeof msg.value === 'number') {
            const zoom = clamp(Math.round(msg.value as number), 50, 200);
            if (panelDurableState) {
                await panelDurableState.update('panelZoomLevel', zoom);
                await getIdePanelHostBridge().flushDurableState();
            }
        } else if ((msg.command === 'savePricing' || msg.command === 'saveCustomPricing') && lastPricingStore) {
            const rawRec = msg as Record<string, unknown>;
            const rawData = rawRec.overrides ?? rawRec.value;
            const validated = validateCustomPricingOverrides(rawData);
            if (!validated.ok) {
                if (panel) {
                    safePostMessage({
                        command: 'configSaveFailed',
                        key: 'customPricing',
                        error: validated.error,
                    });
                }
            } else {
                const bridge = getIdePanelHostBridge();
                await lastPricingStore.setAll(validated.value);
                const receipt = await bridge.flushDurableState();
                lastCustomPricing = lastPricingStore.getCustom();
                refreshLocalStorageDiagnostics();
                bridge.refreshStatusBarTelemetry();
                if (panel) {
                    if (receipt.committed) {
                        panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
                        safePostMessage({ command: 'pricingSaved' });
                    } else {
                        safePostMessage({
                            command: 'configSaveFailed',
                            key: 'customPricing',
                            error: receipt.error || 'Failed to persist custom pricing',
                        });
                    }
                }
            }
        } else if ((msg.command === 'resetPricing' || msg.command === 'resetCustomPricing') && lastPricingStore) {
            const bridge = getIdePanelHostBridge();
            await lastPricingStore.reset();
            const receipt = await bridge.flushDurableState();
            lastCustomPricing = lastPricingStore.getCustom();
            refreshLocalStorageDiagnostics();
            bridge.refreshStatusBarTelemetry();
            if (panel) {
                if (receipt.committed) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
                    safePostMessage({ command: 'pricingReset' });
                } else {
                    safePostMessage({
                        command: 'configSaveFailed',
                        key: 'customPricing',
                        error: receipt.error || 'Failed to persist custom pricing reset',
                    });
                }
            }
        } else if (msg.command === 'calendarFilterSource') {
            const rawSrc = msg.source !== undefined ? msg.source : msg.value;
            if (rawSrc === 'all' || rawSrc === 'app' || rawSrc === 'ide' || rawSrc === 'cli') {
                calendarSourceFilter = rawSrc;
                postCurrentTabs();
            }
        } else if (msg.command === 'calendarSetMetric') {
            const rawMet = msg.metric !== undefined ? msg.metric : msg.value;
            if (rawMet === 'tokens' || rawMet === 'cost') {
                calendarMetricMode = rawMet;
                postCurrentTabs();
            }
        } else if (msg.command === 'calendarSetPeriod') {
            const rawPer = msg.period !== undefined ? msg.period : msg.value;
            if (rawPer === 'daily' || rawPer === 'weekly' || rawPer === 'monthly' || rawPer === 'year' || rawPer === 'all') {
                calendarPeriodMode = rawPer;
                postCurrentTabs();
            }
        } else if (msg.command === 'calendarSetView') {
            const rawView = msg.view !== undefined ? msg.view : msg.value;
            if (rawView === '' || rawView === null || rawView === undefined || rawView === 'both') {
                calendarViewMode = undefined;
                postCurrentTabs();
            } else if (rawView === 'heatmap' || rawView === 'monthGrid') {
                calendarViewMode = rawView;
                postCurrentTabs();
            }
        } else if (msg.command === 'calendarSelectDate') {
            const rawDate = msg.date;
            if (rawDate === null || rawDate === undefined || rawDate === '') {
                calendarSelectedDate = '';
                postCurrentTabs();
            } else if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
                calendarSelectedDate = rawDate.trim();
                postCurrentTabs();
            }
        } else if (msg.command === 'calendarJumpDate') {
            const rawDate = typeof msg.date === 'string' ? msg.date.trim() : '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
                const parts = rawDate.split('-');
                const yr = Number(msg.year ?? parts[0]);
                const mo = Number(msg.month ?? parts[1]);
                if (Number.isInteger(yr) && yr >= 2020 && yr <= 2100 && Number.isInteger(mo) && mo >= 1 && mo <= 12) {
                    calendarYear = yr;
                    calendarMonth = mo;
                }
                calendarSelectedDate = rawDate;
                calendarPeriodMode = 'daily';
                postCurrentTabs();
            }
        } else if (
            msg.command === 'calendarExportCsv'
            || msg.command === 'calendarExportJson'
            || msg.command === 'calendarExportMarkdown'
        ) {
            const fmt = msg.command === 'calendarExportCsv'
                ? 'csv'
                : (msg.command === 'calendarExportMarkdown' ? 'markdown' : 'json');
            const docSettings = readIdeDocumentSettings();
            const nowMs = Date.now();
            const privacyCtx = panelPrivacyMasked ? collectSensitiveContext() : null;
            const exportStore = panelPrivacyMasked ? redactDailyStoreForPrivacy(lastDailyStore) : lastDailyStore;
            const baseOpts = buildIdeCalendarOptions(docSettings, nowMs, panelPrivacyMasked);
            const reqSrc = msg.surfaceFilter ?? msg.sourceFilter ?? msg.source;
            const effSource: CalendarSourceFilter = (reqSrc === 'all' || reqSrc === 'app' || reqSrc === 'ide' || reqSrc === 'cli')
                ? reqSrc
                : (baseOpts.sourceFilter ?? calendarSourceFilter);
            const rawStart = typeof msg.startDate === 'string'
                ? msg.startDate.trim()
                : (typeof msg.rangeStart === 'string' ? msg.rangeStart.trim() : '');
            const rawEnd = typeof msg.endDate === 'string'
                ? msg.endDate.trim()
                : (typeof msg.rangeEnd === 'string' ? msg.rangeEnd.trim() : '');
            const hasSelectedDatesArr = Array.isArray(msg.selectedDates);
            const validSelectedDates = hasSelectedDatesArr
                ? msg.selectedDates!
                    .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()))
                    .map(d => d.trim())
                    .sort()
                : null;
            const explicitEmptyDates = hasSelectedDatesArr && validSelectedDates!.length === 0;
            const exportOpts: CalendarRenderOptions = {
                ...baseOpts,
                sourceFilter: effSource,
                ...(rawStart ? { rangeStart: rawStart } : {}),
                ...(rawEnd ? { rangeEnd: rawEnd } : {}),
                ...(!rawStart && !rawEnd && validSelectedDates && validSelectedDates.length > 0
                    ? { rangeStart: validSelectedDates[0], rangeEnd: validSelectedDates[validSelectedDates.length - 1] }
                    : {}),
                ...(typeof msg.selectedDate === 'string' ? { selectedDate: msg.selectedDate.trim() } : {}),
                ...(msg.exportSelectedDateOnly === true ? { exportSelectedDateOnly: true } : {}),
            };
            const dateStamp = toLocalDateKey(new Date(nowMs));
            const ext = fmt === 'csv' ? 'csv' : (fmt === 'markdown' ? 'md' : 'json');
            const filename = `antigravity-usage-${effSource}-${calendarPeriodMode}-${dateStamp}.${ext}`;
            let content = '';
            let rowCount = 0;
            if (explicitEmptyDates) {
                content = fmt === 'json' ? '[]' : '';
            } else {
                const bundle = buildCalendarExportData(exportStore, calendarYear, calendarMonth, exportOpts);
                const rows = validSelectedDates
                    ? bundle.rows.filter(r => validSelectedDates.includes(r.date))
                    : bundle.rows;
                rowCount = rows.length;
                const rebuilt = validSelectedDates && rows.length !== bundle.rows.length;
                let rawContent: string;
                if (fmt === 'markdown') {
                    rawContent = rows.length === 0
                        ? ''
                        : (rebuilt ? buildCalendarExportMarkdown(rows, bundle.meta) : bundle.markdown);
                } else if (fmt === 'csv') {
                    rawContent = rebuilt ? buildCalendarExportCsv(rows, bundle.meta) : bundle.csv;
                } else {
                    rawContent = rebuilt ? buildCalendarExportJson(rows, bundle.meta) : bundle.json;
                }
                content = privacyCtx && rawContent ? scrubSensitiveText(rawContent, privacyCtx) : rawContent;
            }
            safePostMessage({
                command: 'calendarExportResult',
                format: fmt,
                filename,
                content,
                rowCount,
                ok: true,
            });
            if (typeof vscode.window.showSaveDialog === 'function') {
                const targetUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), filename)),
                    filters: fmt === 'csv'
                        ? { CSV: ['csv'] }
                        : (fmt === 'markdown' ? { Markdown: ['md'] } : { JSON: ['json'] }),
                });
                if (targetUri) {
                    if (typeof vscode.workspace.fs?.writeFile === 'function') {
                        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, 'utf8'));
                    } else if (targetUri.fsPath) {
                        await fs.promises.writeFile(targetUri.fsPath, content, 'utf8');
                    }
                    const displayDest = panelPrivacyMasked ? filename : (targetUri.fsPath || filename);
                    void vscode.window.showInformationMessage(
                        tBi(`Exported usage history to ${displayDest}`, `已导出用量记录到 ${displayDest}`),
                    );
                }
            }
        } else if (msg.command === 'clearCalendarHistory' && lastDailyStore) {
            lastDailyStore.clear();
            calendarSelectedDate = '';
            await getIdePanelHostBridge().flushDurableState();
            refreshLocalStorageDiagnostics();
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        } else if (msg.command === 'switchCalendarMonth') {
            const { year, month } = msg;
            if (typeof year !== 'number' || !Number.isInteger(year) || year < 2020 || year > 2100
                || typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) { return; }
            calendarYear = year;
            calendarMonth = month;
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        } else if (msg.command === 'removeAccount' || msg.command === 'removeAccountSnapshot') {
            const rawRec = msg as Record<string, unknown>;
            const rawIdentifier = rawRec.accountHandle ?? rawRec.accountKey ?? rawRec.email;
            const resolvedEmail = resolveOpaqueAccountHandle(rawIdentifier);
            if (resolvedEmail) {
                const bridge = getIdePanelHostBridge();
                const updated = bridge.removeAccountSnapshot(resolvedEmail);
                await bridge.flushDurableState();
                lastAccountSnapshots = updated;
                if (panel) {
                    panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
                }
            }
        } else if (msg.command === 'clearToolCatalog') {
            await vscode.commands.executeCommand('antigravity-context-monitor.clearToolCatalog');
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
        } else if (msg.command === 'dismissAppOnboarding') {
            const nextDismissed = msg.dismissed === undefined && msg.value === undefined
                ? true
                : Boolean(msg.dismissed !== undefined ? msg.dismissed : msg.value);
            const res = await getIdePanelHostBridge().updateSharedAppSetting('appOnboardingDismissed', nextDismissed);
            safePostMessage({
                command: 'appOnboardingDismissed',
                ok: res.ok && res.committed !== false,
                dismissed: nextDismissed,
                appOnboardingDismissed: nextDismissed,
                ...(res.error ? { error: res.error } : {}),
            });
            if (res.ok && res.committed !== false) {
                safePostMessage({ command: 'configSaved', key: 'appOnboardingDismissed' });
                postSettingsControlSync();
            }
        } else if (msg.command === 'readGlobalRulesFile') {
            const raw = readGlobalRulesStatus({ includeContent: true });
            const safePath = panelPrivacyMasked ? '~/.gemini/GEMINI.md' : raw.path;
            if (raw.error) {
                const isSymlink = raw.error === 'SYMLINK_ESCAPE';
                const errMsg = isSymlink
                    ? tBi(
                        'Refused to read global rules: symlink target rejected.',
                        '已拒绝读取全局规则：不允许符号链接目标。',
                    )
                    : tBi(
                        'Failed to read global rules file.',
                        '读取全局规则文件失败。',
                    );
                safePostMessage({
                    command: 'globalRulesFileContent',
                    ok: false,
                    error: errMsg,
                    errorCode: raw.error,
                    path: safePath,
                    exists: isSymlink ? false : raw.exists,
                    sizeBytes: isSymlink ? 0 : raw.sizeBytes,
                    tooLarge: false,
                    content: '',
                });
                void vscode.window.showErrorMessage?.(errMsg);
            } else {
                safePostMessage({
                    command: 'globalRulesFileContent',
                    ok: true,
                    ...raw,
                    path: safePath,
                });
            }
        } else if (msg.command === 'saveGlobalRulesFile') {
            const safePath = panelPrivacyMasked ? '~/.gemini/GEMINI.md' : getGlobalRulesPath();
            if (typeof msg.content !== 'string') {
                const errMsg = tBi('Global rules content must be a string.', '全局规则内容必须为字符串。');
                safePostMessage({ command: 'globalRulesSaveResult', ok: false, error: errMsg, path: safePath });
            } else {
                const byteLen = Buffer.byteLength(msg.content, 'utf8');
                if (byteLen > GLOBAL_RULES_MAX_BYTES) {
                    const maxKiB = Math.round(GLOBAL_RULES_MAX_BYTES / 1024);
                    const errMsg = tBi(
                        `Global rules file exceeds the ${maxKiB} KiB limit.`,
                        `全局规则内容超过 ${maxKiB} KiB 上限。`,
                    );
                    safePostMessage({
                        command: 'globalRulesSaveResult',
                        ok: false,
                        error: errMsg,
                        errorCode: 'TOO_LARGE',
                        maxBytes: GLOBAL_RULES_MAX_BYTES,
                        sizeBytes: byteLen,
                        tooLarge: true,
                        path: safePath,
                    });
                    void vscode.window.showErrorMessage?.(errMsg);
                } else {
                    try {
                        const saved = writeGlobalRulesFile(msg.content, undefined, { createOnly: msg.createOnly === true });
                        const outPath = panelPrivacyMasked ? '~/.gemini/GEMINI.md' : saved.path;
                        safePostMessage({
                            command: 'globalRulesSaveResult',
                            ok: true,
                            path: outPath,
                            exists: saved.exists,
                            sizeBytes: saved.sizeBytes,
                            tooLarge: saved.tooLarge,
                            content: '',
                        });
                    } catch (err) {
                        const rawMsg = err instanceof Error ? err.message : String(err);
                        const isConflict = (err as NodeJS.ErrnoException)?.code === 'EEXIST';
                        const isSymlink = /symlink|outside ~\/\.gemini/i.test(rawMsg);
                        const errMsg = isConflict
                            ? tBi('Global rules file was created externally. Click Load & Edit before saving.', '全局规则文件已由外部创建，请先点击「加载并编辑」再保存。')
                            : isSymlink
                                ? tBi('Refused to save global rules: symlink points outside ~/.gemini/.', '已拒绝保存全局规则：符号链接指向 ~/.gemini/ 目录之外。')
                                : tBi('Failed to save global rules file.', '保存全局规则文件失败。');
                        safePostMessage({
                            command: 'globalRulesSaveResult',
                            ok: false,
                            error: errMsg,
                            ...(isConflict ? { errorCode: 'ALREADY_EXISTS', exists: true } : {}),
                            ...(isSymlink ? { errorCode: 'SYMLINK_ESCAPE' } : {}),
                            path: safePath,
                        });
                        void vscode.window.showErrorMessage?.(errMsg);
                    }
                }
            }
        } else if (msg.command === 'openGlobalRulesFile') {
            const safePath = panelPrivacyMasked ? '~/.gemini/GEMINI.md' : getGlobalRulesPath();
            const preCheck = validateGlobalRulesRevealTarget();
            if (!preCheck.ok && preCheck.statusCode === 403) {
                const errMsg = tBi(
                    'Refused to open global rules: symlink points outside ~/.gemini/.',
                    '已拒绝打开全局规则：符号链接指向 ~/.gemini/ 目录之外。',
                );
                safePostMessage({
                    command: 'globalRulesActionResult',
                    action: 'open',
                    ok: false,
                    error: errMsg,
                    errorCode: 'SYMLINK_ESCAPE',
                    exists: false,
                    path: safePath,
                });
                void vscode.window.showErrorMessage?.(errMsg);
            } else {
                try {
                    if (!preCheck.exists) {
                        try {
                            writeGlobalRulesFile(DEFAULT_GLOBAL_RULES_TEMPLATE, undefined, { createOnly: true });
                        } catch (initErr) {
                            if ((initErr as NodeJS.ErrnoException)?.code !== 'EEXIST') { throw initErr; }
                        }
                    }
                    const check = validateGlobalRulesRevealTarget();
                    if (!check.ok || !check.resolvedPath || check.isDirectory) {
                        throw new Error(check.error || 'Global rules file could not be validated');
                    }
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(check.resolvedPath));
                    await vscode.window.showTextDocument(doc, { preview: false });
                    const updatedMeta = readGlobalRulesStatus({ includeContent: false });
                    safePostMessage({
                        command: 'globalRulesActionResult',
                        action: 'open',
                        ok: true,
                        ...updatedMeta,
                        path: panelPrivacyMasked ? '~/.gemini/GEMINI.md' : updatedMeta.path,
                        content: '',
                    });
                } catch (err) {
                    const rawMsg = err instanceof Error ? err.message : String(err);
                    const isSymlink = /symlink|outside ~\/\.gemini/i.test(rawMsg);
                    const errMsg = isSymlink
                        ? tBi('Refused to open global rules: symlink points outside ~/.gemini/.', '已拒绝打开全局规则：符号链接指向 ~/.gemini/ 目录之外。')
                        : tBi('Failed to open global rules file.', '打开全局规则文件失败。');
                    safePostMessage({
                        command: 'globalRulesActionResult',
                        action: 'open',
                        ok: false,
                        error: errMsg,
                        ...(isSymlink ? { errorCode: 'SYMLINK_ESCAPE' } : {}),
                        path: safePath,
                    });
                    void vscode.window.showErrorMessage?.(errMsg);
                }
            }
        } else if (msg.command === 'revealGlobalRulesFile') {
            const safePath = panelPrivacyMasked ? '~/.gemini/GEMINI.md' : getGlobalRulesPath();
            const check = validateGlobalRulesRevealTarget();
            if (!check.ok || !check.resolvedPath) {
                const isForbidden = check.statusCode === 403;
                const errMsg = isForbidden
                    ? tBi('Refused to reveal global rules: symlink points outside ~/.gemini/.', '已拒绝定位全局规则：符号链接指向 ~/.gemini/ 目录之外。')
                    : tBi('Global rules directory (~/.gemini/) does not exist yet.', '全局规则目录（~/.gemini/）尚未创建。');
                safePostMessage({
                    command: 'globalRulesActionResult',
                    action: 'reveal',
                    ok: false,
                    error: errMsg,
                    ...(isForbidden ? { errorCode: 'SYMLINK_ESCAPE' } : {}),
                    exists: false,
                    path: safePath,
                });
                if (isForbidden) {
                    void vscode.window.showErrorMessage?.(errMsg);
                } else {
                    void vscode.window.showWarningMessage?.(errMsg);
                }
            } else {
                try {
                    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(check.resolvedPath));
                    const meta = readGlobalRulesStatus({ includeContent: false });
                    safePostMessage({
                        command: 'globalRulesActionResult',
                        action: 'reveal',
                        ok: true,
                        isDirectory: Boolean(check.isDirectory),
                        ...meta,
                        path: panelPrivacyMasked ? '~/.gemini/GEMINI.md' : meta.path,
                        content: '',
                    });
                } catch {
                    const errMsg = tBi('Failed to reveal global rules file in file manager.', '在文件管理器中定位全局规则文件失败。');
                    safePostMessage({
                        command: 'globalRulesActionResult',
                        action: 'reveal',
                        ok: false,
                        error: errMsg,
                        exists: Boolean(check.exists),
                        path: safePath,
                    });
                    void vscode.window.showErrorMessage?.(errMsg);
                }
            }
        }
    });

    panel.onDidChangeViewState((e) => {
        try {
            void vscode.commands.executeCommand?.('setContext', 'antigravityContextMonitor.panelFocused', Boolean(e.webviewPanel.active));
        } catch { /* test mock without executeCommand */ }
        if (e.webviewPanel.visible) {
            getIdePanelHostBridge().syncDurableStateFromDisk(false);
            if (!isPaused) { postCurrentTabs(); }
            sendPendingTab();
            scheduleIdeCdpProbeIfEnabled();
        }
    });

    panel.onDidDispose(() => {
        try {
            void vscode.commands.executeCommand?.('setContext', 'antigravityContextMonitor.panelFocused', false);
        } catch { /* test mock without executeCommand */ }
        clearDisposedPanel();
    });

    panel.webview.html = buildHtml(p.currentUsage, p.allTrajectoryUsages, p.modelConfigs, p.userInfo, isPaused, p.initialTab);
    scheduleIdeCdpProbeIfEnabled();
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
function refreshPanelSelection(): void {
    awaitingSelectionUpdate = true;
    getIdePanelHostBridge().refreshSelection?.();
}

export function updateMonitorPanel(p: PanelPayload): void {
    cachePayload(p);
    if (panel?.visible && (!isPaused || awaitingSelectionUpdate)) {
        const id = lastWindowSelectionState?.inspectedMemberId;
        if (id && lastUsage && lastUsage.cascadeId !== id) { return; }
        awaitingSelectionUpdate = false;
        postCurrentTabs();
        if (pendingTab) { sendPendingTab(); }
    }
}

function getExtensionVersion(): string {
    const raw = (extensionCtx?.extension?.packageJSON as { version?: unknown } | undefined)?.version;
    return resolveRuntimeVersion({
        explicitVersion: typeof raw === 'string' ? raw : undefined,
    });
}

async function probeIdeCdpStatus(
    composerEnabled: boolean,
    topBarEnabled: boolean,
): Promise<CdpStatus> {
    return probeCdpAvailability({
        composerEnabled,
        topBarEnabled,
        platform: process.platform,
        env: process.env,
        inspectHostProcess: false,
        inspectLauncherStatusFn: () => ideCdpLauncherActions.inspect({ env: process.env }),
    });
}

function resolveEffectiveIdeCdpStatus(docSettings: MonitorDocumentSettings): CdpStatus | undefined {
    const composerEnabled = Boolean(docSettings.appComposerRingEnabled);
    const topBarEnabled = Boolean(docSettings.appTopBarEnabled);
    const launcherStatus = lastCdpStatus?.launcherStatus;
    if (!composerEnabled && !topBarEnabled) {
        return {
            ...(lastCdpStatus ?? { platformGuide: getCdpPlatformGuide(process.platform) }),
            state: 'disabled',
            diagnosticCode: 'disabled',
            composerEnabled: false,
            topBarEnabled: false,
            launcherStatus,
        };
    }
    if (!lastCdpStatus || lastCdpStatus.state === 'disabled') {
        return {
            state: 'probing',
            diagnosticCode: 'probing',
            composerEnabled,
            topBarEnabled,
            launcherStatus,
            platformGuide: getCdpPlatformGuide(process.platform),
        };
    }
    return {
        ...lastCdpStatus,
        composerEnabled,
        topBarEnabled,
        launcherStatus,
    };
}

function scheduleIdeCdpProbeIfEnabled(force = false): void {
    if (!panel) { return; }
    const docSettings = readIdeDocumentSettings();
    const composerEnabled = Boolean(docSettings.appComposerRingEnabled);
    const topBarEnabled = Boolean(docSettings.appTopBarEnabled);
    if (!composerEnabled && !topBarEnabled) {
        return;
    }
    if (!force && lastCdpStatus && lastCdpStatus.state !== 'disabled' && lastCdpStatus.state !== 'probing') {
        return;
    }
    if (!force && ideCdpProbeInFlight) {
        return;
    }
    const seq = ++ideCdpProbeSeq;
    let probePromise: Promise<void> | null = null;
    probePromise = (async () => {
        try {
            const probed = await probeIdeCdpStatus(composerEnabled, topBarEnabled);
            if (!panel || seq !== ideCdpProbeSeq) { return; }
            const latestSettings = readIdeDocumentSettings();
            const latestComposerOn = Boolean(latestSettings.appComposerRingEnabled);
            const latestTopBarOn = Boolean(latestSettings.appTopBarEnabled);
            if (!latestComposerOn && !latestTopBarOn) {
                lastCdpStatus = {
                    state: 'disabled',
                    diagnosticCode: 'disabled',
                    composerEnabled: false,
                    topBarEnabled: false,
                    launcherStatus: probed.launcherStatus ?? ideCdpLauncherActions.inspect({ env: process.env }),
                    platformGuide: probed.platformGuide ?? getCdpPlatformGuide(process.platform),
                };
            } else {
                lastCdpStatus = {
                    ...probed,
                    composerEnabled: latestComposerOn,
                    topBarEnabled: latestTopBarOn,
                };
            }
            const outboundCdp = panelPrivacyMasked
                ? redactCdpStatusForPrivacy(lastCdpStatus, collectSensitiveContext())
                : lastCdpStatus;
            safePostMessage({
                type: 'cdpStatusResult',
                command: 'cdpStatusResult',
                cdpStatus: outboundCdp,
            });
            postSettingsControlSync();
        } catch (err) {
            if (!panel || seq !== ideCdpProbeSeq) { return; }
            const latestSettings = readIdeDocumentSettings();
            const latestComposerOn = Boolean(latestSettings.appComposerRingEnabled);
            const latestTopBarOn = Boolean(latestSettings.appTopBarEnabled);
            if (!latestComposerOn && !latestTopBarOn) { return; }
            lastCdpStatus = {
                state: 'error',
                diagnosticCode: 'ws_error',
                composerEnabled: latestComposerOn,
                topBarEnabled: latestTopBarOn,
                errorMessage: err instanceof Error ? err.message : String(err),
                launcherStatus: ideCdpLauncherActions.inspect({ env: process.env }),
                platformGuide: getCdpPlatformGuide(process.platform),
            };
            const outboundErrCdp = panelPrivacyMasked
                ? redactCdpStatusForPrivacy(lastCdpStatus, collectSensitiveContext())
                : lastCdpStatus;
            safePostMessage({
                type: 'cdpStatusResult',
                command: 'cdpStatusResult',
                cdpStatus: outboundErrCdp,
            });
            postSettingsControlSync();
        } finally {
            if (ideCdpProbeInFlight === probePromise) {
                ideCdpProbeInFlight = null;
            }
        }
    })();
    ideCdpProbeInFlight = probePromise;
}

function postSettingsControlSync(): void {
    if (!panel) { return; }
    const bridge = getIdePanelHostBridge();
    const docSettings = readIdeDocumentSettings();
    const shared = bridge.getSharedAppSettings();
    const effectiveUpdateStatus = lastUpdateStatus ?? bridge.getLastUpdateStatusView();
    const rawCdpStatus = resolveEffectiveIdeCdpStatus(docSettings);
    const effectiveCdpStatus = panelPrivacyMasked
        ? redactCdpStatusForPrivacy(rawCdpStatus, collectSensitiveContext())
        : rawCdpStatus;
    safePostMessage({
        command: 'syncSettingsControls',
        pollingInterval: docSettings.pollingInterval,
        quotaNotificationThreshold: docSettings.quotaNotificationThreshold,
        showContext: docSettings.showContext,
        showQuota: docSettings.showQuota,
        showResetCountdown: docSettings.showResetCountdown,
        showAiCredits: docSettings.showAiCredits,
        showSpeed: docSettings.showSpeed,
        showCacheHit: docSettings.showCacheHit,
        showSessionCost: docSettings.showSessionCost,
        showModelInternalId: docSettings.showModelInternalId,
        lockToMainAgent: docSettings.lockToMainAgent,
        tooltipDensity: docSettings.tooltipDensity,
        appComposerRingEnabled: docSettings.appComposerRingEnabled,
        appTopBarEnabled: docSettings.appTopBarEnabled,
        showNativeHudBar: docSettings.showNativeHudBar,
        appShowNativeHudBar: shared.appShowNativeHudBar,
        ideShowNativeHudBar: shared.ideShowNativeHudBar,
        nativeHudAutoHideOnOverview: shared.nativeHudAutoHideOnOverview,
        appOnboardingDismissed: Boolean(shared.appOnboardingDismissed),
        autoCheckUpdates: docSettings.autoCheckUpdates,
        orchestratorPricingMode: docSettings.orchestratorPricingMode,
        displayCurrency: docSettings.displayCurrency,
        customFxRate: docSettings.customFxRate,
        customFxCurrency: shared.customFxCurrency,
        subscriptionPlan: docSettings.subscriptionPlan,
        subscriptionMonthlyFee: docSettings.subscriptionMonthlyFee,
        subscriptionCurrency: docSettings.subscriptionCurrency,
        calendarRetentionDays: docSettings.calendarRetentionDays,
        activityMaxRecentSteps: docSettings.activityMaxRecentSteps,
        activityMaxArchives: docSettings.activityMaxArchives,
        languagePreference: shared.languagePreference,
        contextPctBasis: shared.contextPctBasis,
        speedMetricMode: shared.speedMetricMode,
        quotaWindowMode: shared.quotaWindowMode,
        quotaDirectionMode: shared.quotaDirectionMode,
        cdpOverlayFontSize: normalizeCdpOverlayFontSize(getIdeV118HostHooks()?.getOverlayVisualPrefs?.().cdpOverlayFontSize),
        cdpOverlayHighContrast: Boolean(getIdeV118HostHooks()?.getOverlayVisualPrefs?.().cdpOverlayHighContrast),
        privacyMasked: panelPrivacyMasked,
        ...(effectiveCdpStatus ? { cdpStatus: effectiveCdpStatus } : {}),
        ...(effectiveUpdateStatus ? { updateStatus: effectiveUpdateStatus } : {}),
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
    scheduleIdeCdpProbeIfEnabled();
}

type ExtendedDocumentParams = MonitorDocumentBuildParams & {
    privacyMasked?: boolean;
    accountHandle?: string;
    swarmTopology?: SwarmTopologySnapshot | null;
    recoveryBrief?: CompactionRecoveryBrief | null;
    globalRules?: GlobalRulesStatus | null;
    ideHostNonce?: string;
};

function makeDocumentParams(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    paused = false,
    initialTab?: PanelPayload['initialTab'],
): ExtendedDocumentParams {
    const bridge = getIdePanelHostBridge();
    const docSettings = readIdeDocumentSettings();
    const hydrated = bridge.isSharedAppSettingsHydrated();
    const shared = bridge.getSharedAppSettings();
    const effectiveAppSettings: Partial<AppSettings> & { subscriptionPlan?: SubscriptionPlanPresetId } = hydrated
        ? {
            ...shared,
            showNativeHudBar: docSettings.showNativeHudBar,
            orchestratorPricingMode: docSettings.orchestratorPricingMode,
            displayCurrency: docSettings.displayCurrency,
            customFxRate: docSettings.customFxRate,
            subscriptionPlan: docSettings.subscriptionPlan,
            subscriptionMonthlyFee: docSettings.subscriptionMonthlyFee,
            subscriptionCurrency: docSettings.subscriptionCurrency,
            calendarRetentionDays: docSettings.calendarRetentionDays,
            autoCheckUpdates: docSettings.autoCheckUpdates,
            activityMaxRecentSteps: docSettings.activityMaxRecentSteps,
            activityMaxArchives: docSettings.activityMaxArchives,
        }
        : {
            ...shared,
            ...(lastAppSettings ?? {}),
            showNativeHudBar: lastAppSettings?.showNativeHudBar ?? docSettings.showNativeHudBar,
            orchestratorPricingMode: lastAppSettings?.orchestratorPricingMode ?? docSettings.orchestratorPricingMode,
            displayCurrency: lastAppSettings?.displayCurrency ?? docSettings.displayCurrency,
            customFxRate: lastAppSettings?.customFxRate !== undefined ? lastAppSettings.customFxRate : docSettings.customFxRate,
            subscriptionPlan: lastAppSettings?.subscriptionPlan ?? docSettings.subscriptionPlan,
            subscriptionMonthlyFee: lastAppSettings?.subscriptionMonthlyFee !== undefined ? lastAppSettings.subscriptionMonthlyFee : docSettings.subscriptionMonthlyFee,
            subscriptionCurrency: lastAppSettings?.subscriptionCurrency ?? docSettings.subscriptionCurrency,
            calendarRetentionDays: lastAppSettings?.calendarRetentionDays ?? docSettings.calendarRetentionDays,
            autoCheckUpdates: lastAppSettings?.autoCheckUpdates ?? docSettings.autoCheckUpdates,
            activityMaxRecentSteps: lastAppSettings?.activityMaxRecentSteps ?? docSettings.activityMaxRecentSteps,
            activityMaxArchives: lastAppSettings?.activityMaxArchives ?? docSettings.activityMaxArchives,
        };
    const effectiveOrchMode = hydrated
        ? (docSettings.orchestratorPricingMode ?? 'mapped')
        : (lastOrchestratorPricingMode ?? docSettings.orchestratorPricingMode ?? 'mapped');
    const effectiveUpdateStatus = lastUpdateStatus ?? bridge.getLastUpdateStatusView();
    const rawCdpStatus = resolveEffectiveIdeCdpStatus(docSettings);
    const rawBillingDays = bridge.getBillingDaysMap();
    const activeAccountHandle = userInfo?.email ? getOpaqueAccountHandle(userInfo.email) : undefined;
    const v118Hooks = getIdeV118HostHooks();
    const ideWeeklyRunways = v118Hooks?.getWeeklyQuotaRunways?.();
    const idePromptCacheTtl = v118Hooks?.getPromptCacheTtl?.() ?? null;
    const rawRecoveryBrief = v118Hooks?.getRecoveryBrief?.() ?? null;

    const selection = lastWindowSelectionState;
    const observationFields = {
        observation: lastPublishedObservation,
        swarmGroupCost: lastSwarmGroupCost?.rootId === lastPublishedObservation?.rootCascadeId ? lastSwarmGroupCost : null,
        inspectedMemberId: selection?.inspectedMemberId,
        lockedRootId: selection?.lockedRootId,
        lockPendingUnavailable: selection?.lockPendingUnavailable,
        retargetOfferId: selection?.retargetOfferId,
    };

    const rawGlobalRules = readGlobalRulesStatus({ includeContent: false });
    const unmaskedGlobalRulesMeta: GlobalRulesStatus = {
        ...rawGlobalRules,
        content: '',
    };
    const maskedGlobalRulesMeta: GlobalRulesStatus = {
        ...rawGlobalRules,
        path: '~/.gemini/GEMINI.md',
        content: '',
    };
    const ideHostNonceBootstrapHtml = panelHostNonce
        ? `<script>(function(){var n=${JSON.stringify(panelHostNonce)},s=document.currentScript;window.__ACM_CONSUME_HOST_NONCE__=function(){var v=n;n='';try{delete window.__ACM_CONSUME_HOST_NONCE__;}catch(_){window.__ACM_CONSUME_HOST_NONCE__=undefined;}return v;};if(s&&s.parentNode){s.parentNode.removeChild(s);}})();</script>`
        : undefined;

    if (!panelPrivacyMasked) {
        return {
            surface: 'ide',
            version: getExtensionVersion(),
            privacyMasked: false,
            globalRules: unmaskedGlobalRulesMeta,
            ...(panelHostNonce ? { ideHostNonce: panelHostNonce, extraHeadHtml: ideHostNonceBootstrapHtml } : {}),
            ...(activeAccountHandle ? { accountHandle: activeAccountHandle } : {}),
            ...(ideWeeklyRunways ? { weeklyQuotaRunways: ideWeeklyRunways, weeklyRunways: ideWeeklyRunways } : {}),
            ...(idePromptCacheTtl ? { promptCacheTtl: idePromptCacheTtl, cacheTtl: idePromptCacheTtl } : {}),
            ...(rawRecoveryBrief ? { recoveryBrief: rawRecoveryBrief } : {}),
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
            billingDays: rawBillingDays,
            ledgerDateKey: lastLedgerDateKey,
            todayLedgerActive: lastTodayLedgerActive,
            ledgerSettled: lastLedgerSettled,
            orchestratorSettings: lastOrchestratorSettings,
            quotaSummary: lastQuotaSummary,
            todayCostUsd: lastTodayCostUsd,
            sessionCostUsd: lastSessionCostUsd,
            calendarYear,
            calendarMonth,
            calendarOptions: buildIdeCalendarOptions(docSettings, Date.now(), false),
            orchestratorPricingMode: effectiveOrchMode,
            appSettings: effectiveAppSettings,
            ...(rawCdpStatus ? { cdpStatus: rawCdpStatus } : {}),
            updateStatus: effectiveUpdateStatus,
            ...(lastLowQuotaWarning !== undefined ? { lowQuotaWarning: lastLowQuotaWarning } : {}),
            ...observationFields,
            ...(lastSwarmTopology ? { swarmTopology: lastSwarmTopology } : {}),
            paused,
            initialTab,
            settings: docSettings,
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

    // ─── SEC-04 Pre-Serialization Full-Chain Privacy Redaction ───────────────
    // Redact every identity, email (including 1-char local parts), billing map key,
    // workspace path, git URI, state path, and ledger/dailyStore/GM account tag
    // BEFORE handing parameters to any HTML/JSON serializer.
    const privacyCtx = collectSensitiveContext();
    const redactedUserInfo: UserStatusInfo | null = userInfo
        ? {
            ...userInfo,
            name: '',
            email: activeAccountHandle || '',
        }
        : null;
    const redactedSnapshots: AccountSnapshot[] = lastAccountSnapshots.map(snap => ({
        ...snap,
        name: '',
        email: getOpaqueAccountHandle(snap.email),
    }));
    const redactedBillingDays: Record<string, number> = {};
    for (const [emailKey, day] of Object.entries(rawBillingDays)) {
        const handle = getOpaqueAccountHandle(emailKey);
        if (handle) {
            redactedBillingDays[handle] = day;
        }
    }
    const redactedTodayLedger = lastTodayLedgerActive.map(redactActiveLedgerBucketForPrivacy);
    const redactedSettled = lastLedgerSettled.map(redactSettledLedgerEntryForPrivacy);
    const redactedTrajectories: TrajectorySummary[] = lastTrajectories.map(t => ({
        ...t,
        summary: scrubSensitiveText(t.summary || '', privacyCtx),
        workspaceUris: [],
        repositoryName: '',
        branchName: '',
        gitOriginUrl: '',
        gitRootUri: '',
    }));
    const redactedUsage = redactUsageForPrivacy(usage, privacyCtx);
    const redactedAllUsages = allUsages
        .map(u => redactUsageForPrivacy(u, privacyCtx))
        .filter((u): u is ContextUsage => u !== null);
    const redactedConversationOptions: ConversationOption[] = lastConversationOptions.map(opt => ({
        ...opt,
        title: scrubSensitiveText(opt.title, privacyCtx),
        workspaceLabel: '',
        branchName: scrubSensitiveText(opt.branchName, privacyCtx),
    }));
    const redactedStorageDiag: StorageDiagnostics | undefined = lastStorageDiagnostics
        ? {
            ...lastStorageDiagnostics,
            stateFilePath: redactStateFilePath(lastStorageDiagnostics.stateFilePath),
        }
        : undefined;
    const redactedCdpStatus = redactCdpStatusForPrivacy(rawCdpStatus, privacyCtx);
    const redactedSwarmTopology: SwarmTopologySnapshot | null = lastSwarmTopology
        ? {
            ...lastSwarmTopology,
            nodesById: new Map(
                [...lastSwarmTopology.nodesById.entries()].map(([id, node]) => [
                    id,
                    {
                        ...node,
                        ...(node.workspaceDisplay ? { workspaceDisplay: undefined } : {}),
                        ...(node.memberName ? { memberName: scrubSensitiveText(node.memberName, privacyCtx) } : {}),
                    },
                ]),
            ),
            groupsByRootId: new Map(
                [...lastSwarmTopology.groupsByRootId.entries()].map(([rootId, group]) => [
                    rootId,
                    {
                        ...group,
                        ...(group.title ? { title: scrubSensitiveText(group.title, privacyCtx) } : {}),
                    },
                ]),
            ),
        }
        : null;

    const redactedWeeklyRunways = ideWeeklyRunways
        ? Object.fromEntries(
            Object.entries(ideWeeklyRunways).map(([k, v]) => [
                k,
                v && typeof v.account === 'string'
                    ? { ...v, account: getOpaqueAccountHandle(v.account) || 'default' }
                    : v,
            ]),
        )
        : undefined;
    const redactedPromptCacheTtl = idePromptCacheTtl
        ? (() => {
            const kObj = idePromptCacheTtl.key;
            const redAcct = kObj && typeof kObj.account === 'string' ? (getOpaqueAccountHandle(kObj.account) || 'default') : 'default';
            const redKey = kObj ? { ...kObj, account: redAcct, branch: '[Redacted Branch]' } : undefined;
            return {
                ...idePromptCacheTtl,
                ...(redKey
                    ? { cacheKey: [redAcct, String(kObj.backend ?? 'default'), String(kObj.conversation ?? ''), String(kObj.model ?? ''), '[Redacted Branch]'].join('|'), key: redKey }
                    : { cacheKey: scrubSensitiveText(idePromptCacheTtl.cacheKey, privacyCtx) }),
            };
        })()
        : null;
    const redactedRecoveryBrief: CompactionRecoveryBrief | null = rawRecoveryBrief
        ? formatCompactionRecoveryBriefForPrivacy(rawRecoveryBrief, {
            privacyMasked: true,
            redactText: (s) => scrubSensitiveText(s, privacyCtx),
            lang: getLanguage(),
        })
        : null;

    return {
        surface: 'ide',
        version: getExtensionVersion(),
        privacyMasked: true,
        globalRules: maskedGlobalRulesMeta,
        ...(panelHostNonce ? { ideHostNonce: panelHostNonce, extraHeadHtml: ideHostNonceBootstrapHtml } : {}),
        ...(activeAccountHandle ? { accountHandle: activeAccountHandle } : {}),
        ...(redactedWeeklyRunways ? { weeklyQuotaRunways: redactedWeeklyRunways, weeklyRunways: redactedWeeklyRunways } : {}),
        ...(redactedPromptCacheTtl ? { promptCacheTtl: redactedPromptCacheTtl, cacheTtl: redactedPromptCacheTtl } : {}),
        ...(redactedRecoveryBrief ? { recoveryBrief: redactedRecoveryBrief } : {}),
        currentUsage: redactedUsage,
        monitorStatus: lastMonitorStatus,
        allTrajectoryUsages: redactedAllUsages,
        allTrajectories: redactedTrajectories,
        modelConfigs: configs,
        userInfo: redactedUserInfo,
        workspaceUri: '',
        activitySummary: redactActivitySummaryForPrivacy(lastActivitySummary, privacyCtx),
        gmSummary: redactGMSummaryForPrivacy(lastGMSummary, privacyCtx),
        gmFullSummary: redactGMSummaryForPrivacy(lastGMFullSummary, privacyCtx),
        gmConversations: redactGMConversationsForPrivacy(lastGMConversations, privacyCtx),
        pricingStore: lastPricingStore,
        customPricing: lastPricingStore?.getCustom() ?? lastCustomPricing,
        dailyStore: redactDailyStoreForPrivacy(lastDailyStore),
        storageDiagnostics: redactedStorageDiag,
        panelHintPrefs: getPanelHintPreferences(),
        zoomLevel: panelDurableState?.get<number>('panelZoomLevel', 100) ?? 100,
        accountSnapshots: redactedSnapshots,
        billingDays: redactedBillingDays,
        ledgerDateKey: lastLedgerDateKey,
        todayLedgerActive: redactedTodayLedger,
        ledgerSettled: redactedSettled,
        orchestratorSettings: lastOrchestratorSettings,
        quotaSummary: lastQuotaSummary,
        todayCostUsd: lastTodayCostUsd,
        sessionCostUsd: lastSessionCostUsd,
        calendarYear,
        calendarMonth,
        calendarOptions: buildIdeCalendarOptions(docSettings, Date.now(), true),
        orchestratorPricingMode: effectiveOrchMode,
        appSettings: effectiveAppSettings,
        ...(redactedCdpStatus ? { cdpStatus: redactedCdpStatus } : {}),
        updateStatus: effectiveUpdateStatus,
        ...(lastLowQuotaWarning !== undefined ? { lowQuotaWarning: lastLowQuotaWarning } : {}),
        ...observationFields,
        ...(redactedSwarmTopology ? { swarmTopology: redactedSwarmTopology } : {}),
        paused,
        initialTab,
        settings: docSettings,
        contextBreakdown: redactContextBreakdownForPrivacy(lastContextBreakdown, privacyCtx),
        turnDiagnostics: lastTurnDiagnostics,
        quotaRunways: lastQuotaRunways,
        isCustomModelActive: lastIsCustomModelActive,
        staleState: lastStaleState,
        conversationOptions: redactedConversationOptions,
        activeConversationId: lastActiveConversationId ?? usage?.cascadeId ?? null,
        pinnedConversationId: lastPinnedConversationId,
        lockToMainAgent: lastLockToMainAgent,
    };
}

function applyUnmaskedProfileFallback(
    profileHtml: string,
    params: ExtendedDocumentParams,
): string {
    if (panelPrivacyMasked || !params.userInfo) {
        return profileHtml;
    }
    // If webview-document.ts rendered profile with default privacyMasked=true (aria-pressed="true"),
    // render explicit unmasked profile markup directly so host unmask reveals real identity cleanly.
    if (!profileHtml.includes('id="privacyToggle" aria-pressed="true"')) {
        return profileHtml;
    }
    const billingDay = params.userInfo.email && params.billingDays
        ? (params.billingDays[params.userInfo.email] ?? 0)
        : 0;
    const unmaskedProfile = buildProfileContent(
        params.userInfo,
        billingDay,
        { privacyMasked: false },
    );
    const eocIndex = profileHtml.indexOf('<div class="eoc-sentinel"');
    const eocSuffix = eocIndex >= 0 ? profileHtml.slice(eocIndex) : '';
    return unmaskedProfile + eocSuffix;
}

function postCurrentTabs(): void {
    if (!panel) { return; }
    const params = makeDocumentParams(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
    const tabs = buildMonitorTabsPayload(params);
    if (!panelPrivacyMasked) {
        tabs.profile = applyUnmaskedProfileFallback(tabs.profile, params);
    }
    safePostMessage({
        command: 'updateTabs',
        tabs,
        privacyMasked: panelPrivacyMasked,
        time: formatClockTime(new Date(), getLanguage()),
        ...(params.cdpStatus ? { cdpStatus: params.cdpStatus } : {}),
        ...(params.updateStatus ? { updateStatus: params.updateStatus } : {}),
        ...(params.globalRules ? { globalRules: params.globalRules } : {}),
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
    const params = makeDocumentParams(usage, allUsages, configs, userInfo, paused, initialTab);
    let html = buildMonitorDocumentHtml(params);
    if (!panelPrivacyMasked && params.userInfo && html.includes('id="privacyToggle" aria-pressed="true"')) {
        const billingDay = params.userInfo.email && params.billingDays
            ? (params.billingDays[params.userInfo.email] ?? 0)
            : 0;
        const unmaskedProfile = buildProfileContent(
            params.userInfo,
            billingDay,
            { privacyMasked: false },
        );
        html = html.replace(
            /(<div class="tab-pane" id="tab-profile">\s*)[\s\S]*?(\s*<div class="eoc-sentinel")/,
            (_match, openTag: string, closeTag: string) => `${openTag}${unmaskedProfile}${closeTag}`,
        );
    }
    return html;
}

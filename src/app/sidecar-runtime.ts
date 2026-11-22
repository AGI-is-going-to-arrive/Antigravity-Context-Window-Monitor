/**
 * Live Antigravity App Sidecar backend runtime engine.
 *
 * 100% pure Node/TypeScript — ZERO `vscode` runtime imports, ZERO external npm
 * dependencies. Shares the exact platform-native `state-v1.json` (`DurableState`)
 * with the Antigravity IDE extension, discovers the Antigravity App standalone
 * Language Server (`preferredSurface: 'app'`), runs the full v1.17.5 telemetry
 * pipeline (Context Breakdown, Turn Diagnostics, Quota Runway, StaleCacheGuard,
 * Main-Agent Lock, GM/Activity/Quota/DailyLedger/Pricing trackers), and serves
 * all interactive Sidecar UI actions.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { currentAICredits } from '../account-credits';
import { ActivityTracker, type ActivitySummary, type ActivityTrackerState } from '../activity-tracker';
import type { AccountSnapshot, ResetPool } from '../activity-panel';
import { isBillingDay, isBillingDaySetting } from '../billing-day';
import { CascadeStatus, MAX_BACKOFF_INTERVAL_MS, MAX_DISCOVERY_BACKOFF_MS } from '../constants';
import {
    buildDotMatrix,
    formatContextTextReport,
    formatHandoffPrompt,
    parseContextBreakdown,
    type ContextBreakdownSnapshot,
    type ContextQuotaSummaryLine,
} from '../context-breakdown';
import {
    buildConversationOptions,
    resolveTargetConversation,
    type ConversationOption,
    type ResolvedConversationTarget,
} from '../conversation-selector';
import {
    performDailyArchival as performDailyArchivalCore,
    type DailyArchivalContext,
} from '../daily-archival';
import {
    DailyLedger,
    toLocalDateKey,
    type DailyLedgerState,
    type LedgerAccountBucket,
    type LedgerSettledEntry,
} from '../daily-ledger';
import { DailyStore, type DailyStoreState } from '../daily-store';
import {
    discoverLanguageServer,
    type DiscoverLanguageServerOptions,
    type LSInfo,
} from '../discovery';
import { DurableState, type StateBucket } from '../durable-state';
import {
    GMTracker,
    slimSummaryForPersistence,
    type GMConversationData,
    type GMSummary,
    type GMTrackerState,
} from '../gm-tracker';
import {
    formatClockTime,
    formatNumber,
    getLanguage,
    initI18nFromState,
    isLanguage,
    setLanguageInMemory,
    setLanguageToState,
    t,
    tBi,
    tBiHtml,
    type Language,
} from '../i18n-core';
import {
    mergeModelDNAState,
    restoreModelDNAState,
    serializeModelDNAState,
    type ModelDNAStoreState,
    type PersistedModelDNA,
} from '../model-dna-store';
import {
    getModelSpecs,
    getQuotaPoolKey,
    guessContextLimitSpec,
    overrideContextLimits,
    registerResponseModelAlias,
    resolveModelId,
    setAvailableImageModelIds,
    setShowModelShortId,
    updateModelSpec,
    type FullUserStatus,
    type ModelConfig,
    type ModelSpec,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../models';
import type { MonitorStatus } from '../monitor-overview';
import { MonitorStore } from '../monitor-store';
import { expandModelIdsToPool } from '../pool-utils';
import {
    calculateLedgerModelCosts,
    costFromTokens,
    findPricingForDate,
    PricingStore,
    selectPricingModel,
    type ModelPricing,
} from '../pricing-store';
import {
    isCustomModel,
    QuotaRunwayTracker,
    StaleCacheGuard,
    type QuotaRunwayEstimate,
    type SerializedQuotaRunwayState,
} from '../quota-runway';
import { QuotaTracker } from '../quota-tracker';
import { formatResetCountdown } from '../reset-time';
import { rpcCall } from '../rpc-client';
import { parseTooltipDensity } from '../tooltip-budget';
import {
    fetchFullUserStatus,
    fetchOrchestratorSettings,
    fetchTrajectoryGeneratorMetadata,
    fetchTrajectorySteps,
    fetchUserQuotaSummary,
    getAllTrajectories,
    getContextLimit,
    getContextUsage,
    normalizeModelDisplayName,
    normalizeUri,
    parseStrictResetTimestamp,
    refreshWorkflowImageUsage,
    resetImageWorkflowCache,
    updateModelDisplayNames,
    type ContextUsage,
    type RawGeneratorMetadataEntry,
    type TrajectorySummary,
} from '../tracker';
import { analyzeTurnDiagnostics, type TurnDiagnosticsSummary } from '../turn-diagnostics';
import {
    buildMonitorDocumentHtml,
    buildMonitorTabsPayload,
    type MonitorTabId,
} from '../webview-document';
import { esc, formatFileSize } from '../webview-helpers';
import type { PanelHintPreferences, StorageDiagnostics } from '../webview-settings-tab';
import { DEFAULT_SIDECAR_VERSION, type SidecarActionHttpBody } from './sidecar-server';
import type {
    SidecarActionRequest,
    SidecarConversationOption,
    SidecarProvider,
    SidecarRenderContext,
    SidecarSnapshotPayload,
    SidecarSnapshotQuery,
    SidecarViewMode,
} from './sidecar-types';

// ─── Public Contracts ────────────────────────────────────────────────────────

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
}

export interface SidecarStaleState {
    isStale: boolean;
    lastSuccessAtMs: number | null;
    lastError?: string | null;
}

export interface MonitorDocumentV1175Extras {
    surface?: 'ide' | 'app-sidecar';
    version?: string;
    contextBreakdown?: ContextBreakdownSnapshot | null;
    turnDiagnostics?: TurnDiagnosticsSummary | null;
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    isCustomModelActive?: boolean;
    staleState?: SidecarStaleState | null;
    conversationOptions?: ConversationOption[];
    activeConversationId?: string | null;
    pinnedConversationId?: string | null;
    lockToMainAgent?: boolean;
    extraHeadHtml?: string;
    extraBodyEndHtml?: string;
    imagesBaseUri?: string;
}

/**
 * Unified parameter object passed to `buildMonitorDocumentHtml` (from
 * `src/webview-document.ts`) and optional injected `renderDocument` callbacks.
 * Includes both `PanelPayload` canonical keys and App Sidecar contract aliases
 * so integration across IDE and App surfaces stays seamless.
 */
export interface SidecarDocumentParams extends MonitorDocumentV1175Extras {
    surface: 'app-sidecar';
    version: string;
    viewMode: SidecarViewMode;
    language: Language;
    lastUpdatedTime: string;
    // Primary telemetry (canonical + alias)
    data: ContextUsage | null;
    currentUsage: ContextUsage | null;
    allTrajectoryUsages: ContextUsage[];
    allTrajectories: TrajectorySummary[];
    userStatus: FullUserStatus;
    userInfo: UserStatusInfo | null;
    modelConfigs: ModelConfig[];
    workspaceUri: string;
    gmSummary: GMSummary | null;
    gmFullSummary: GMSummary | null;
    gmConversations: Record<string, GMConversationData>;
    activitySummary: ActivitySummary | null;
    dailyLedger: DailyLedger;
    todayLedgerActive: LedgerAccountBucket[];
    ledgerSettled: LedgerSettledEntry[];
    dailyStore: DailyStore;
    dailyStoreSnapshot: DailyStoreState;
    pricingStore: PricingStore;
    pricingOverrides: Record<string, ModelPricing>;
    customPricing: Record<string, ModelPricing>;
    accountSnapshots: AccountSnapshot[];
    activeAccountKey: string;
    billingDays: Record<string, number>;
    billingDaysMap: Record<string, number>;
    orchestratorSettings: OrchestratorSettings | null;
    quotaSummary: UserQuotaSummary | null;
    todayCostUsd?: number;
    sessionCostUsd?: number;
    settings: MonitorDocumentSettings;
    panelHintPrefs: PanelHintPreferences;
    panelPrefs: PanelHintPreferences;
    zoomLevel: number;
    calendarYear: number;
    calendarMonth: number;
    storageDiagnostics: StorageDiagnostics;
    modelDNA: Record<string, PersistedModelDNA>;
    isPaused: boolean;
    paused: boolean;
    backendStatus: MonitorStatus;
    monitorStatus: MonitorStatus;
    initialTab?: MonitorTabId;
    now: number;
    imagesBaseUri: string;
    extras: MonitorDocumentV1175Extras;
}

export interface SidecarRuntimeDeps {
    discoverLS: (options: DiscoverLanguageServerOptions) => Promise<LSInfo | null>;
    fetchFullUserStatus: (ls: LSInfo, signal?: AbortSignal) => Promise<FullUserStatus>;
    getAllTrajectories: (ls: LSInfo, signal?: AbortSignal) => Promise<TrajectorySummary[]>;
    getContextUsage: (
        ls: LSInfo,
        trajectory: TrajectorySummary,
        customLimits?: Record<string, number>,
        signal?: AbortSignal,
    ) => Promise<ContextUsage>;
    refreshWorkflowImageUsage: (ls: LSInfo, usage: ContextUsage, signal?: AbortSignal) => Promise<ContextUsage>;
    fetchTrajectoryGeneratorMetadata: (
        ls: LSInfo,
        cascadeId: string,
        signal?: AbortSignal,
    ) => Promise<RawGeneratorMetadataEntry[]>;
    fetchTrajectorySteps: (
        ls: LSInfo,
        cascadeId: string,
        totalSteps: number,
        signal?: AbortSignal,
    ) => Promise<{ steps: Array<Record<string, unknown>>; hasGaps: boolean }>;
    fetchOrchestratorSettings: (
        ls: LSInfo,
        configs: readonly ModelConfig[],
        signal?: AbortSignal,
    ) => Promise<OrchestratorSettings | null>;
    fetchUserQuotaSummary: (ls: LSInfo, signal?: AbortSignal) => Promise<UserQuotaSummary | null>;
    fetchAvailableModels: (ls: LSInfo, signal?: AbortSignal) => Promise<Record<string, unknown> | null>;
    processActivity?: (
        ls: LSInfo,
        trajectories: TrajectorySummary[],
        signal?: AbortSignal,
    ) => Promise<boolean>;
    fetchGM?: (
        ls: LSInfo,
        trajectories: TrajectorySummary[],
        activeCascadeId?: string,
        signal?: AbortSignal,
    ) => Promise<GMSummary | null>;
    revealInOs: (targetPath: string, isDirectory: boolean) => Promise<void>;
    now: () => number;
    homedir: () => string;
}

export interface SidecarRuntimeOptions {
    /** Semantic version string (defaults to package.json / '1.17.5'). */
    version?: string;
    /** Override path for DurableState `state-v1.json` (defaults to platform-native shared path). */
    statePath?: string;
    /** Optional sidecar executable data directory metadata. */
    dataDir?: string;
    /** Optional plugin root directory (for reading plugin.json version). */
    pluginRoot?: string;
    /** Initial workspace URIs if known at startup. */
    initialWorkspaceUris?: string[];
    /** Automatically start background adaptive polling (default: true). */
    autoStart?: boolean;
    /** Idle threshold in ms after last client request before switching to idle backoff (default: 60_000). */
    idleThresholdMs?: number;
    /** Polling interval in ms when idle with no recent client activity (default: 30_000). */
    idlePollIntervalMs?: number;
    /** Optional diagnostic logger. */
    log?: (msg: string) => void;
    /** Optional injected document renderer (overrides dynamic `../webview-document` load). */
    renderDocument?: (params: SidecarDocumentParams) => string;
    /** Optional injected incremental tabs renderer (overrides dynamic `../webview-document` load). */
    renderTabs?: (params: SidecarDocumentParams) => Record<string, string | boolean>;
    /** Optional dependency overrides for deterministic unit tests. */
    deps?: Partial<SidecarRuntimeDeps>;
}

export interface SidecarRuntimeStateSnapshot {
    lsInfo: LSInfo | null;
    monitorStatus: MonitorStatus;
    currentUsage: ContextUsage | null;
    allTrajectories: TrajectorySummary[];
    modelConfigs: ModelConfig[];
    userInfo: UserStatusInfo | null;
    contextBreakdown: ContextBreakdownSnapshot | null;
    turnDiagnostics: TurnDiagnosticsSummary | null;
    quotaRunways: Record<string, QuotaRunwayEstimate>;
    isCustomModelActive: boolean;
    staleState: SidecarStaleState;
    conversationOptions: ConversationOption[];
    activeConversationId: string | null;
    pinnedConversationId: string | null;
    lockToMainAgent: boolean;
    lockedMainId: string | null;
    isPaused: boolean;
    settings: MonitorDocumentSettings;
    lastUpdatedTime: string;
    pollCount: number;
    lastPollAtMs: number;
}

export interface SidecarRuntimeProvider extends SidecarProvider {
    pollNow(force?: boolean): Promise<void>;
    getState(): SidecarRuntimeStateSnapshot;
    getDurableState(): DurableState;
    getStorageDiagnostics(): StorageDiagnostics;
    dispose(): Promise<void>;
}

// ─── Constants & Defaults ────────────────────────────────────────────────────

const LARGE_STATE_FILE_WARN_BYTES = 1 * 1024 * 1024;
const DEFAULT_IDLE_THRESHOLD_MS = 60_000;
const DEFAULT_IDLE_POLL_INTERVAL_MS = 30_000;
const STATUS_REFRESH_INTERVAL = 2;
const LS_REVALIDATION_INTERVAL = 6;
const MAX_CHECKPOINTER_SYNC_ATTEMPTS = 5;
const MAX_AUX_METADATA_FAILURES = 3;
const RESET_TIME_TURNOVER_MIN_JUMP_MS = 10 * 60 * 1000;
const SAFE_CASCADE_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;

const DEFAULT_DOCUMENT_SETTINGS: MonitorDocumentSettings = {
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
};

// ─── Pure Helper Functions ───────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function isSameLSConnection(a: LSInfo | null | undefined, b: LSInfo | null | undefined): boolean {
    if (!a || !b) { return false; }
    return a.pid === b.pid
        && a.port === b.port
        && a.csrfToken === b.csrfToken
        && a.useTls === b.useTls
        && (a.hostname || '127.0.0.1') === (b.hostname || '127.0.0.1');
}

function parsePositivePoolResetMs(raw: unknown): number | null {
    const ms = parseStrictResetTimestamp(raw);
    return ms !== null && ms > 0 ? ms : null;
}

function comparePoolResetTimes(a: string, b: string): number {
    const aMs = parsePositivePoolResetMs(a);
    const bMs = parsePositivePoolResetMs(b);
    if (aMs !== null && bMs !== null) {
        return aMs - bMs || a.localeCompare(b);
    }
    if (aMs !== null) { return -1; }
    if (bMs !== null) { return 1; }
    return a.localeCompare(b);
}

function shouldSettleOnResetTimeChange(oldResetTime: string, newResetTime: string, nowMs: number): boolean {
    if (!oldResetTime || !newResetTime || oldResetTime === newResetTime) { return false; }
    const oldMs = parsePositivePoolResetMs(oldResetTime);
    const newMs = parsePositivePoolResetMs(newResetTime);
    if (oldMs === null || newMs === null) { return false; }
    if (oldMs > nowMs || newMs <= nowMs) { return false; }
    return (newMs - oldMs) >= RESET_TIME_TURNOVER_MIN_JUMP_MS;
}

interface ModelQuotaPoolGroup {
    key: string;
    resetTime: string;
    labels: string[];
    modelIds: string[];
    minFraction: number;
}

function groupModelConfigsByQuotaPool(configs: readonly ModelConfig[]): ModelQuotaPoolGroup[] {
    const poolMap = new Map<string, { labels: string[]; modelIds: string[]; resetEntries: Map<string, number>; minFraction: number }>();
    for (const c of configs) {
        if (!c.quotaInfo) { continue; }
        const rawReset = typeof c.quotaInfo.resetTime === 'string' ? c.quotaInfo.resetTime.trim() : '';
        const resetMs = parsePositivePoolResetMs(rawReset);
        const resetTime = resetMs !== null ? rawReset : '';
        const key = getQuotaPoolKey(c.model, resetTime || undefined);
        const pool = poolMap.get(key) || { labels: [], modelIds: [], resetEntries: new Map<string, number>(), minFraction: 1 };
        const label = c.label || c.model;
        if (label && !pool.labels.includes(label)) { pool.labels.push(label); }
        if (c.model && !pool.modelIds.includes(c.model)) { pool.modelIds.push(c.model); }
        if (resetTime && resetMs !== null && !pool.resetEntries.has(resetTime)) {
            pool.resetEntries.set(resetTime, resetMs);
        }
        const fraction = c.quotaInfo.remainingFraction;
        if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
            pool.minFraction = Math.min(pool.minFraction, fraction);
        }
        poolMap.set(key, pool);
    }
    return [...poolMap.entries()].map(([key, pool]) => {
        const sortedResets = [...pool.resetEntries.entries()]
            .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
        return {
            key,
            resetTime: sortedResets[0]?.[0] || '',
            labels: pool.labels,
            modelIds: pool.modelIds,
            minFraction: pool.minFraction,
        };
    });
}

function isPlatformModelId(value: string): boolean {
    const clean = (value || '').trim();
    return /^MODEL_[A-Z0-9_]+$/.test(clean) && !clean.includes('UNSPECIFIED');
}

function positiveTokenLimit(value: unknown): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) { return 0; }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function hasSameUsageInputs(
    cached: ContextUsage | null | undefined,
    trajectory: Pick<TrajectorySummary, 'cascadeId' | 'stepCount' | 'lastModifiedTime' | 'status'>,
): cached is ContextUsage {
    return !!cached
        && cached.tokenUsageSource !== undefined
        && cached.imageWorkflow !== undefined
        && (!cached.compressionDetected || cached.checkpointCompressionDrop > 0)
        && trajectory.status !== CascadeStatus.RUNNING
        && cached.status === trajectory.status
        && cached.cascadeId === trajectory.cascadeId
        && cached.stepCount === trajectory.stepCount
        && cached.lastModifiedTime === trajectory.lastModifiedTime;
}

function applyGMContextToUsage(usage: ContextUsage, gmContextUsed: number): boolean {
    if (usage.lastModelUsage || !Number.isSafeInteger(gmContextUsed)
        || gmContextUsed <= 0 || gmContextUsed === usage.contextUsed) { return false; }
    usage.contextUsed = gmContextUsed;
    usage.isEstimated = true;
    usage.usagePercent = usage.contextLimit > 0 ? (gmContextUsed / usage.contextLimit) * 100 : 0;
    return true;
}

function getLatestGMContextUsed(summary: GMSummary | null, cascadeId: string): number {
    if (!summary) { return 0; }
    const conv = summary.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length === 0) { return 0; }
    for (let i = conv.calls.length - 1; i >= 0; i--) {
        const call = conv.calls[i];
        if (call.contextTokensUsed && call.contextTokensUsed > 0) {
            return call.contextTokensUsed;
        }
    }
    return 0;
}

function resolveVersionFromDisk(explicitVersion?: string, pluginRoot?: string): string {
    if (explicitVersion && explicitVersion.trim()) {
        return explicitVersion.trim();
    }
    const candidates = [
        ...(pluginRoot ? [path.join(pluginRoot, 'plugin.json')] : []),
        path.resolve(__dirname, '..', '..', 'package.json'),
        path.resolve(__dirname, '..', '..', '..', 'package.json'),
    ];
    for (const candidate of candidates) {
        try {
            if (!fs.existsSync(candidate)) { continue; }
            const raw = fs.readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw) as { version?: unknown };
            if (typeof parsed.version === 'string' && parsed.version.trim()) {
                return parsed.version.trim();
            }
        } catch {
            // Try next candidate
        }
    }
    return DEFAULT_SIDECAR_VERSION;
}

// ─── Safe Cross-Platform Reveal-Path Security Boundary ───────────────────────

export interface RevealPathValidationResult {
    ok: boolean;
    statusCode?: number;
    error?: string;
    resolvedPath?: string;
    isDirectory?: boolean;
}

function uriOrPathToFsPath(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('\0')) { return null; }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
        if (!/^file:\/\//i.test(trimmed)) {
            return null;
        }
        try {
            return fileURLToPath(trimmed);
        } catch {
            return null;
        }
    }
    return path.resolve(trimmed);
}

function isPathInsideRoot(targetReal: string, rootReal: string, platform: NodeJS.Platform = process.platform): boolean {
    const normTarget = platform === 'win32' || platform === 'darwin'
        ? targetReal.toLowerCase()
        : targetReal;
    const normRoot = platform === 'win32' || platform === 'darwin'
        ? rootReal.toLowerCase()
        : rootReal;
    const rel = path.relative(normRoot, normTarget);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Strictly validate a target path before revealing in OS file manager.
 * Only existing files/directories whose canonical `realpath` sits inside:
 *   - `~/.gemini/antigravity/`
 *   - `~/.gemini/config/`
 *   - durable state directory
 *   - an active workspace URI
 * are permitted. Rejects path traversal, symlink escapes, non-file URLs, and arbitrary paths.
 */
export function validateRevealTargetPath(
    rawPath: unknown,
    allowedRoots: readonly string[],
    platform: NodeJS.Platform = process.platform,
): RevealPathValidationResult {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { ok: false, statusCode: 400, error: 'Target path is required' };
    }
    if (rawPath.includes('\0')) {
        return { ok: false, statusCode: 400, error: 'Invalid target path' };
    }
    const candidate = uriOrPathToFsPath(rawPath);
    if (!candidate) {
        return { ok: false, statusCode: 403, error: 'Unsupported path scheme' };
    }
    if (!fs.existsSync(candidate)) {
        return { ok: false, statusCode: 404, error: 'Target path does not exist' };
    }

    let realTarget: string;
    let stat: fs.Stats;
    try {
        realTarget = fs.realpathSync(candidate);
        stat = fs.statSync(realTarget);
    } catch {
        return { ok: false, statusCode: 404, error: 'Target path cannot be accessed' };
    }

    if (!stat.isFile() && !stat.isDirectory()) {
        return { ok: false, statusCode: 403, error: 'Target path must be a file or directory' };
    }

    const resolvedRoots: string[] = [];
    for (const root of allowedRoots) {
        const fsRoot = uriOrPathToFsPath(root);
        if (!fsRoot) { continue; }
        try {
            resolvedRoots.push(fs.existsSync(fsRoot) ? fs.realpathSync(fsRoot) : path.resolve(fsRoot));
        } catch {
            resolvedRoots.push(path.resolve(fsRoot));
        }
    }

    const allowed = resolvedRoots.some(rootReal => isPathInsideRoot(realTarget, rootReal, platform));
    if (!allowed) {
        return { ok: false, statusCode: 403, error: 'Path is outside allowed directories' };
    }

    return {
        ok: true,
        resolvedPath: realTarget,
        isDirectory: stat.isDirectory(),
    };
}

function defaultRevealInOs(targetPath: string, isDirectory: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        let cmd: string;
        let args: string[];
        if (process.platform === 'darwin') {
            cmd = 'open';
            args = isDirectory ? [targetPath] : ['-R', targetPath];
        } else if (process.platform === 'win32') {
            cmd = 'explorer.exe';
            args = isDirectory ? [targetPath] : [`/select,${targetPath}`];
        } else {
            cmd = 'xdg-open';
            args = [isDirectory ? targetPath : path.dirname(targetPath)];
        }
        execFile(cmd, args, { windowsHide: true, timeout: 10_000 }, (err) => {
            if (err) { reject(err); return; }
            resolve();
        });
    });
}

// ─── Clean Rich Fallback Renderer (Explicit Diagnostics / Unit Tests) ────────

function formatCompactNum(n: number): string {
    if (!Number.isFinite(n) || n <= 0) { return '0'; }
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`; }
    if (n >= 1_000) { return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`; }
    return String(Math.round(n));
}

function measurementLabel(state: ContextBreakdownSnapshot['measurementState'], lang: Language): string {
    switch (state) {
        case 'measured': return t('context.measured', lang);
        case 'estimated_post_compaction': return t('context.postCompaction', lang);
        case 'estimated_rewind': return t('context.rewind', lang);
        case 'awaiting_generation': return t('context.awaitingGeneration', lang);
    }
}

export function buildFallbackTabsPayload(params: SidecarDocumentParams): Record<string, string | boolean> {
    const lang = params.language;
    const usage = params.currentUsage;
    const bd = params.contextBreakdown;
    const td = params.turnDiagnostics;

    // ── Overview Tab ──
    const used = bd?.usedTokens ?? usage?.contextUsed ?? 0;
    const effBudget = bd?.effectiveBudgetTokens ?? usage?.contextLimit ?? 0;
    const effPct = bd?.effectivePct ?? (effBudget > 0 ? Math.round((used / effBudget) * 1000) / 10 : 0);
    const nativeCap = bd?.nativeLimitTokens ?? effBudget;
    const nativePct = bd?.nativePct ?? effPct;
    const modelLabel = bd?.modelDisplayName || usage?.modelDisplayName || usage?.model || tBi('No active model', '暂无活跃模型', ' / ', lang);

    const dualCapHtml = bd?.hasDualCap
        ? `<div class="acm-dual-cap">${esc(t('context.effectiveBudget', lang))}: <strong>${formatCompactNum(effBudget)}</strong> (${effPct.toFixed(1)}%) · ${esc(t('context.nativeCeiling', lang))}: <strong>${formatCompactNum(nativeCap)}</strong> (${nativePct.toFixed(1)}%)</div>`
        : '';

    const measureHtml = bd
        ? `<span class="acm-pill">${esc(measurementLabel(bd.measurementState, lang))}</span>`
        : '';

    const segmentsHtml = bd && bd.segments.length > 0
        ? `<div class="acm-seg-bar">${bd.segments.map(seg =>
            `<span class="acm-seg" style="width:${Math.max(1, seg.sharePct)}%;background:var(${esc(seg.colorToken)},#5B9CF6)" title="${esc(lang === 'zh' ? seg.labelZh : seg.labelEn)}: ${formatNumber(seg.tokens, undefined, lang)} (${seg.pct}%)"></span>`,
        ).join('')}</div>
           <div class="acm-dot-grid" aria-label="${esc(t('context.dotMatrix', lang))}">${buildDotMatrix(bd.segments, bd.usedTokens, bd.effectiveBudgetTokens, 100).map(cell =>
            `<span class="acm-dot${cell.isFree ? ' is-free' : ''}" data-cat="${esc(cell.category)}" title="${esc(lang === 'zh' ? cell.labelZh : cell.labelEn)}"></span>`,
        ).join('')}</div>
           <ul class="acm-legend">${bd.segments.map(seg =>
            `<li><span>${esc(lang === 'zh' ? seg.labelZh : seg.labelEn)}</span><span>${formatCompactNum(seg.tokens)} (${seg.pct}%)</span></li>`,
        ).join('')}</ul>`
        : `<p class="acm-muted">${esc(t('context.awaitingGeneration', lang))}</p>`;

    const largestHtml = bd && bd.largestItems.length > 0
        ? `<details class="acm-largest" id="acm-largest-items"><summary>${esc(t('context.largestItems', lang))} (${bd.largestItems.length})</summary><ul>${bd.largestItems.map(item =>
            `<li><span>${esc(item.title)}</span><span>${formatCompactNum(item.tokens)} (${item.pct}%)</span></li>`,
        ).join('')}</ul></details>`
        : '';

    const quotaSectionHtml = params.isCustomModelActive
        ? `<div class="acm-banner is-custom">${esc(t('quota.customModelIsolated', lang))}</div>`
        : (params.modelConfigs.length > 0
            ? `<div class="acm-runway-grid">${groupModelConfigsByQuotaPool(params.modelConfigs).map(pool => {
                const rw = params.quotaRunways?.[pool.key];
                const pct = Math.round(pool.minFraction * 100);
                const rwText = rw?.status === 'safe_until_reset'
                    ? t('quota.safeBeforeReset', lang)
                    : rw?.status === 'at_risk' && rw.estExhaustMs !== null
                        ? `${t('quota.exhaustsIn', lang)} ${Math.max(1, Math.round(rw.estExhaustMs / 60_000))}m`
                        : rw?.status === 'exhausted'
                            ? '0%'
                            : (pool.resetTime ? formatResetCountdown(pool.resetTime) : '—');
                return `<div class="acm-card"><div class="acm-row"><strong>${esc(pool.labels.slice(0, 2).join(', '))}</strong><span>${pct}%</span></div><div class="acm-muted">${esc(rwText)}</div></div>`;
            }).join('')}</div>`
            : `<p class="acm-muted">${esc(tBi('Waiting for model quota telemetry...', '正在等待模型配额数据...', ' / ', lang))}</p>`);

    const overview = `
        <section class="acm-card">
            <div class="acm-row">
                <h2>${esc(modelLabel)}</h2>
                ${measureHtml}
            </div>
            <div class="acm-hero-metric">${formatCompactNum(used)} / ${formatCompactNum(effBudget)} <small>(${effPct.toFixed(1)}%)</small></div>
            ${dualCapHtml}
            <div class="acm-actions-row">
                <button type="button" class="action-btn" data-action="copyContextReport">${esc(t('action.copyContextReport', lang))}</button>
                <button type="button" class="action-btn" data-action="copyHandoffPrompt">${esc(t('action.copyHandoffPrompt', lang))}</button>
            </div>
        </section>
        <section class="acm-card">
            <h3>${esc(t('context.breakdown', lang))}</h3>
            ${segmentsHtml}
            ${largestHtml}
        </section>
        <section class="acm-card">
            <h3>${esc(t('quota.runway', lang))}</h3>
            ${quotaSectionHtml}
        </section>
    `;

    // ── GM Data / Turn Diagnostics Tab ──
    const gmdata = `
        <section class="acm-card">
            <h3>${esc(tBi('Prompt Cache & Turn Diagnostics', '提示词缓存与轮次诊断', ' / ', lang))}</h3>
            <div class="acm-kpi-row">
                <div><span>${esc(t('turn.lastTurnCache', lang))}</span><strong>${td?.lastTurnCacheHitPct != null ? `${td.lastTurnCacheHitPct}%` : '—'}</strong></div>
                <div><span>${esc(t('turn.sessionCache', lang))}</span><strong>${td?.sessionCacheHitPct != null ? `${td.sessionCacheHitPct}%` : '—'}</strong></div>
                <div><span>${esc(tBi('Turns', '轮次', ' / ', lang))}</span><strong>${td?.totalTurns ?? 0}</strong></div>
            </div>
            ${td && td.turns.length > 0 ? `<ul class="acm-turn-list">${td.turns.slice(-10).reverse().map(turn => {
                const deltaStr = turn.deltaTokens === null ? '—' : `${turn.deltaTokens >= 0 ? '+' : ''}${formatCompactNum(turn.deltaTokens)}`;
                return `<li><span>#${turn.turnIndex}</span><span class="acm-pill is-${esc(turn.startKind)}">${esc(turn.startKind)}</span><span>${turn.cacheHitPct !== null ? `${turn.cacheHitPct}%` : '—'}</span><span>Δ ${esc(deltaStr)}</span></li>`;
            }).join('')}</ul>` : `<p class="acm-muted">${esc(tBi('No model turns recorded yet.', '暂无模型调用记录。', ' / ', lang))}</p>`}
        </section>
    `;

    const chats = `<section class="acm-card"><h3>${esc(tBi('Sessions', '会话', ' / ', lang))} (${params.allTrajectories.length})</h3><ul>${params.allTrajectories.slice(0, 20).map(tr =>
        `<li><span>${esc(tr.summary || tr.cascadeId.slice(0, 8))}</span><span class="acm-muted">${tr.stepCount} steps</span></li>`,
    ).join('')}</ul></section>`;

    const pricing = `<section class="acm-card"><h3>${esc(tBi('Cost', '成本', ' / ', lang))}</h3><p>${esc(tBi('Today', '今日', ' / ', lang))}: $${(params.todayCostUsd ?? 0).toFixed(4)} · ${esc(tBi('Session', '会话', ' / ', lang))}: $${(params.sessionCostUsd ?? 0).toFixed(4)}</p></section>`;
    const models = `<section class="acm-card"><h3>${esc(tBi('Models', '模型', ' / ', lang))} (${params.modelConfigs.length})</h3><ul>${params.modelConfigs.map(m =>
        `<li><span>${esc(m.label)}</span><span>${m.quotaInfo && Number.isFinite(m.quotaInfo.remainingFraction) ? `${Math.round(m.quotaInfo.remainingFraction * 100)}%` : '—'}</span></li>`,
    ).join('')}</ul></section>`;
    const calendar = `<section class="acm-card"><h3>${esc(tBi('Calendar', '日历', ' / ', lang))}</h3><p>${params.calendarYear}-${String(params.calendarMonth).padStart(2, '0')} (${params.dailyStore.totalDays} days)</p></section>`;
    const profile = `<section class="acm-card"><h3>${esc(tBi('Profile', '账号信息', ' / ', lang))}</h3><p>${esc(params.userInfo?.planName || '—')}</p></section>`;
    const about = `<section class="acm-card"><h3>Antigravity Context Monitor v${esc(params.version)}</h3><p>${esc(t('surface.antigravityApp', lang))} Sidecar Runtime</p></section>`;

    return {
        overview,
        gmdata,
        chats,
        pricing,
        models,
        calendar,
        profile,
        about,
        accountPopover: '',
        accountPopoverHasReady: false,
    };
}

export function renderFallbackDocumentHtml(params: SidecarDocumentParams): string {
    const lang = params.language;
    const htmlLang = lang === 'zh' ? 'zh-CN' : 'en';
    const tabs = buildFallbackTabsPayload(params);
    const convOptions = params.conversationOptions || [];
    const staleBadge = params.staleState?.isStale
        ? `<span class="acm-stale-badge" id="acmStaleBadge">${esc(t('quota.cachedStale', lang))}</span>`
        : '';

    return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(tBi('Antigravity Context Monitor', 'Antigravity 上下文监控', ' / ', lang))}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--ed-bg, #0D1014); color: var(--ed-ink, #F2F4F8); }
    .panel-topbar { position: sticky; top: 0; z-index: 10; background: var(--ed-surface, #14181F); border-bottom: 1px solid var(--ed-border, #232A35); }
    .topbar-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; flex-wrap: wrap; }
    .topbar-title h1 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 6px; }
    .acm-surface-badge, .acm-pill, .acm-stale-badge { font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--ed-border, #232A35); }
    .acm-stale-badge { color: var(--ed-warn, #F5B841); border-color: var(--ed-warn, #F5B841); }
    .header-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .acm-conv-bar { display: flex; align-items: center; gap: 6px; padding: 0 14px 8px; flex-wrap: wrap; }
    .acm-conv-select { flex: 1; min-width: 140px; padding: 4px 8px; border-radius: 6px; background: var(--ed-surface-well, #1B212B); color: inherit; border: 1px solid var(--ed-border, #232A35); font-size: 12px; }
    .tab-bar { display: flex; gap: 4px; padding: 6px 14px; overflow-x: auto; }
    .tab-btn { background: transparent; color: var(--ed-ink-muted, #8C98A9); border: 1px solid transparent; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; white-space: nowrap; }
    .tab-btn.active { color: var(--ed-ink, #F2F4F8); background: var(--ed-surface-well, #1B212B); border-color: var(--ed-border, #232A35); }
    .tab-pane { display: none; padding: 12px 14px; }
    .tab-pane.active { display: block; }
    .acm-card { border: 1px solid var(--ed-border, #232A35); background: var(--ed-surface, #14181F); border-radius: 10px; padding: 12px; margin-bottom: 10px; }
    .acm-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .acm-hero-metric { font-size: 20px; font-weight: 600; margin: 6px 0; }
    .acm-dual-cap, .acm-muted { font-size: 12px; color: var(--ed-ink-muted, #8C98A9); }
    .acm-actions-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .action-btn, .lang-btn { padding: 4px 9px; border-radius: 6px; border: 1px solid var(--ed-border, #232A35); background: var(--ed-surface-well, #1B212B); color: inherit; cursor: pointer; font-size: 12px; }
    .action-btn.is-active, .lang-btn.active { border-color: var(--ed-accent, #5B9CF6); color: var(--ed-accent, #5B9CF6); }
    .acm-seg-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--ed-surface-well, #1B212B); margin: 8px 0; }
    .acm-dot-grid { display: grid; grid-template-columns: repeat(20, 1fr); gap: 3px; margin: 8px 0; }
    .acm-dot { width: 100%; aspect-ratio: 1; border-radius: 2px; background: var(--ed-accent, #5B9CF6); }
    .acm-dot.is-free { opacity: 0.18; }
    .acm-legend, .acm-turn-list { list-style: none; padding: 0; margin: 6px 0 0; font-size: 12px; }
    .acm-legend li, .acm-turn-list li { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--ed-border, #232A35); }
    .acm-kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
    .acm-banner { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--ed-accent, #5B9CF6); font-size: 12px; }
  </style>
  ${params.extraHeadHtml || ''}
</head>
<body data-editorial="true" data-lang="${lang}" data-acm-surface="app-sidecar" data-acm-view="${params.viewMode}" data-zoom="${params.zoomLevel}">
  <div class="panel-topbar">
    <header class="topbar-title">
      <h1>
        <span>${tBiHtml('Antigravity Monitor', 'Antigravity 监控面板', ' / ', lang)}</span>
        <span class="acm-surface-badge">${esc(t('surface.antigravityApp', lang))}</span>
        ${staleBadge}
      </h1>
      <div class="header-actions">
        <div class="lang-switcher">
          <button type="button" class="lang-btn${lang === 'zh' ? ' active' : ''}" data-lang="zh">中文</button>
          <button type="button" class="lang-btn${lang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
          <button type="button" class="lang-btn${lang === 'both' ? ' active' : ''}" data-lang="both">${tBiHtml('Both', '双语', ' / ', lang)}</button>
        </div>
        <button type="button" class="action-btn${params.isPaused ? ' is-active' : ''}" id="pauseBtn" data-action="togglePause">${esc(params.isPaused ? tBi('Resume', '继续', ' / ', lang) : tBi('Pause', '暂停', ' / ', lang))}</button>
        <button type="button" class="action-btn" id="refreshBtn" data-action="refresh">${esc(tBi('Refresh', '刷新', ' / ', lang))}</button>
        <span class="update-time">${esc(params.lastUpdatedTime)}</span>
      </div>
    </header>
    <div class="acm-conv-bar">
      <select class="acm-conv-select" id="conversationSwitcher" aria-label="${esc(t('agent.conversationSwitcher', lang))}">
        <option value="">${esc(t('agent.followActive', lang))}</option>
        ${convOptions.map(opt => `<option value="${esc(opt.cascadeId)}"${params.pinnedConversationId === opt.cascadeId ? ' selected' : ''}>${esc(opt.isSubagent ? `[Sub] ${opt.title}` : opt.title)}</option>`).join('')}
      </select>
      <button type="button" class="action-btn${params.lockToMainAgent ? ' is-active' : ''}" id="lockMainBtn" data-action="toggleLockMain" aria-pressed="${params.lockToMainAgent ? 'true' : 'false'}">${esc(t('agent.lockToMain', lang))}</button>
    </div>
    <nav class="tab-bar" id="tabBar">
      <button type="button" class="tab-btn active" data-tab="overview">${tBiHtml('Overview', '总览', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="gmdata">${tBiHtml('GM Data', 'GM 数据', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="chats">${tBiHtml('Sessions', '会话', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="pricing">${tBiHtml('Cost', '成本', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="models">${tBiHtml('Models', '模型', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="calendar">${tBiHtml('Calendar', '日历', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="profile">${tBiHtml('Profile', '账号', ' / ', lang)}</button>
      <button type="button" class="tab-btn" data-tab="about">${tBiHtml('About', '关于', ' / ', lang)}</button>
    </nav>
  </div>
  <main id="monitor-content">
    <div class="tab-pane active" id="tab-overview">${tabs.overview}</div>
    <div class="tab-pane" id="tab-gmdata">${tabs.gmdata}</div>
    <div class="tab-pane" id="tab-chats">${tabs.chats}</div>
    <div class="tab-pane" id="tab-pricing">${tabs.pricing}</div>
    <div class="tab-pane" id="tab-models">${tabs.models}</div>
    <div class="tab-pane" id="tab-calendar">${tabs.calendar}</div>
    <div class="tab-pane" id="tab-profile">${tabs.profile}</div>
    <div class="tab-pane" id="tab-about">${tabs.about}</div>
  </main>
  <script>
    (function() {
      var bridge = window.__ACM_BRIDGE__;
      if (!bridge) { return; }
      var state = bridge.getState() || {};
      var activeTab = state.activeTab || 'overview';
      function setTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
        document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.toggle('active', p.id === 'tab-' + tab); });
        var s = bridge.getState() || {}; s.activeTab = tab; bridge.setState(s);
      }
      setTab(activeTab);
      document.addEventListener('click', function(e) {
        var btn = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!btn) { return; }
        if (btn.classList.contains('tab-btn') && btn.dataset.tab) { setTab(btn.dataset.tab); return; }
        if (btn.classList.contains('lang-btn') && btn.dataset.lang) { bridge.sendAction({ command: 'switchLanguage', lang: btn.dataset.lang }); return; }
        if (btn.dataset.action) { bridge.sendAction({ command: btn.dataset.action }); }
      });
      var sel = document.getElementById('conversationSwitcher');
      if (sel) {
        sel.addEventListener('change', function() {
          bridge.selectConversation(this.value || null);
        });
      }
      window.addEventListener('message', function(ev) {
        var msg = ev.data;
        if (!msg || msg.command !== 'updateTabs' || !msg.tabs) { return; }
        for (var k in msg.tabs) {
          var pane = document.getElementById('tab-' + k);
          if (pane && typeof msg.tabs[k] === 'string' && pane.innerHTML !== msg.tabs[k]) {
            pane.innerHTML = msg.tabs[k];
          }
        }
        var tEl = document.querySelector('.update-time');
        if (tEl && msg.time) { tEl.textContent = msg.time; }
      });
      bridge.postMessage({ command: 'panelReady' });
    })();
  </script>
  ${params.extraBodyEndHtml || ''}
</body>
</html>`;
}

// ─── Runtime Engine Factory ──────────────────────────────────────────────────

/**
 * Create the live Antigravity App Sidecar backend provider.
 */
export function createSidecarRuntimeProvider(
    options: SidecarRuntimeOptions = {},
): SidecarRuntimeProvider {
    const version = resolveVersionFromDisk(options.version, options.pluginRoot);
    const log = options.log || (() => {});
    const idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
    const idlePollIntervalMs = options.idlePollIntervalMs ?? DEFAULT_IDLE_POLL_INTERVAL_MS;

    const deps: SidecarRuntimeDeps = {
        discoverLS: options.deps?.discoverLS ?? ((opts) => discoverLanguageServer(opts)),
        fetchFullUserStatus: options.deps?.fetchFullUserStatus ?? fetchFullUserStatus,
        getAllTrajectories: options.deps?.getAllTrajectories ?? getAllTrajectories,
        getContextUsage: options.deps?.getContextUsage ?? getContextUsage,
        refreshWorkflowImageUsage: options.deps?.refreshWorkflowImageUsage ?? refreshWorkflowImageUsage,
        fetchTrajectoryGeneratorMetadata: options.deps?.fetchTrajectoryGeneratorMetadata ?? fetchTrajectoryGeneratorMetadata,
        fetchTrajectorySteps: options.deps?.fetchTrajectorySteps ?? fetchTrajectorySteps,
        fetchOrchestratorSettings: options.deps?.fetchOrchestratorSettings ?? fetchOrchestratorSettings,
        fetchUserQuotaSummary: options.deps?.fetchUserQuotaSummary ?? fetchUserQuotaSummary,
        fetchAvailableModels: options.deps?.fetchAvailableModels ?? (async (ls, signal) => {
            try {
                return await rpcCall(ls, 'GetAvailableModels', {
                    metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
                }, 10_000, signal);
            } catch {
                return null;
            }
        }),
        revealInOs: options.deps?.revealInOs ?? defaultRevealInOs,
        processActivity: options.deps?.processActivity,
        fetchGM: options.deps?.fetchGM,
        now: options.deps?.now ?? (() => Date.now()),
        homedir: options.deps?.homedir ?? (() => os.homedir()),
    };

    // ── Shared Persistence (DurableState) ────────────────────────────────────
    const durableState = new DurableState(options.statePath);
    const globalState: StateBucket = durableState.globalBucket();
    let activeWorkspaceUris: string[] = Array.isArray(options.initialWorkspaceUris)
        ? options.initialWorkspaceUris.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : [];
    const getPrimaryWorkspaceKey = (): string =>
        activeWorkspaceUris.length > 0 ? normalizeUri(activeWorkspaceUris[0]) : 'app-sidecar';
    let workspaceState: StateBucket = durableState.workspaceBucket(getPrimaryWorkspaceKey());

    initI18nFromState(globalState);

    // ── Core Trackers & Stores ───────────────────────────────────────────────
    const quotaTracker = new QuotaTracker(globalState, globalState);
    quotaTracker.setEnabled(true);

    const savedActivity = globalState.get<ActivityTrackerState | undefined>('activityTrackerState', undefined);
    const activityTracker = savedActivity ? ActivityTracker.restore(savedActivity) : new ActivityTracker();

    const savedGM = globalState.get<GMTrackerState | undefined>('gmTrackerState', undefined);
    const gmTracker = savedGM ? GMTracker.restore(savedGM) : new GMTracker();
    let lastGMSummary: GMSummary | null = globalState.get<GMSummary | null>('gmDetailedSummary', gmTracker.getCachedSummary());

    let persistedModelDNA: Record<string, PersistedModelDNA> = restoreModelDNAState(
        globalState.get<ModelDNAStoreState | null>('modelDNAState', null),
    );

    const pricingStore = new PricingStore();
    pricingStore.init(globalState);

    const dailyStore = new DailyStore();
    dailyStore.init(globalState);
    dailyStore.backfillMissingCosts(pricingStore.getCustom());

    const savedLedger = globalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
    let dailyLedger = DailyLedger.restore(savedLedger);
    let lastArchivalDateKey = globalState.get<string>('lastArchivalDateKey', '');

    const monitorStore = new MonitorStore();
    monitorStore.init(workspaceState);
    const restoredMonitor = monitorStore.restore();

    const savedRunway = globalState.get<SerializedQuotaRunwayState | null>('quotaRunwayState', null);
    const quotaRunwayTracker = savedRunway ? QuotaRunwayTracker.deserialize(savedRunway) : new QuotaRunwayTracker();

    const userStatusGuard = new StaleCacheGuard<FullUserStatus>();
    const trajectoriesGuard = new StaleCacheGuard<TrajectorySummary[]>();

    // ── Multi-Account, Billing Days & Shared Settings State ──────────────────
    let accountSnapshots = new Map<string, AccountSnapshot>();
    let billingDaysMap: Record<string, number> = {};
    let currentAccountEmail = gmTracker.getCurrentAccount();
    let selectedAccountKey = '';
    const notifiedAccountResets = new Set<string>();

    let settings: MonitorDocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS };
    let panelHintPrefs: PanelHintPreferences = {
        showTabScrollHint: true,
        showScrollbar: false,
        showEndOfContent: true,
    };
    let zoomLevel = 100;
    let calendarYear = new Date(deps.now()).getFullYear();
    let calendarMonth = new Date(deps.now()).getMonth() + 1;

    // ── Live Telemetry State ─────────────────────────────────────────────────
    let cachedLsInfo: LSInfo | null = null;
    let currentUsage: ContextUsage | null = restoredMonitor.currentUsage;
    let allTrajectoryUsages: ContextUsage[] = restoredMonitor.allUsages;
    let allTrajectories: TrajectorySummary[] = [];
    let cachedModelConfigs: ModelConfig[] = [];
    let cachedUserInfo: UserStatusInfo | null = null;
    let cachedOrchestratorSettings: OrchestratorSettings | null = null;
    let cachedQuotaSummary: UserQuotaSummary | null = null;
    let monitorStatus: MonitorStatus = { state: 'connecting' };

    let contextBreakdown: ContextBreakdownSnapshot | null = null;
    let turnDiagnostics: TurnDiagnosticsSummary | null = null;
    let quotaRunways: Record<string, QuotaRunwayEstimate> = {};
    let isCustomModelActive = false;

    let hostConversationId: string | null = (process.env.ANTIGRAVITY_CONVERSATION_ID || '').trim() || null;
    let pinnedConversationId: string | null = null;
    let lockToMainAgent = false;
    let lockedMainId: string | null = null;
    let trackedCascadeId: string | null = null;
    let lastResolution: ResolvedConversationTarget = {
        target: null,
        cascadeId: null,
        mode: 'auto_follow',
        lockedMainId: null,
        pinnedFallback: false,
        ignoredSubagentBurst: false,
        reason: 'initializing',
    };
    let conversationOptions: ConversationOption[] = [];

    // Rewind & per-conversation telemetry caches
    const maxStepCountByCascade = new Map<string, number>();
    const prevUsedTokensByCascade = new Map<string, number>();
    const knownSubagentIds = new Set<string>();
    let cachedRawTelemetryKey = '';
    let cachedRawGmEntries: RawGeneratorMetadataEntry[] = [];
    let cachedRawSteps: Array<Record<string, unknown>> = [];

    // Polling / lifecycle state
    let isPaused = false;
    let disposed = false;
    let isPolling = false;
    let activePollPromise: Promise<void> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollGeneration = 0;
    let pollCount = 0;
    let lastPollAtMs = 0;
    let lastDataSignature = '';
    let lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
    let lastClientActivityMs = deps.now();
    let consecutiveFailures = 0;
    let statusPollCount = 0;
    let lsRevalidationCounter = 0;
    let lastActivityPersistTime = 0;
    let hasSyncedCheckpointer = false;
    let checkpointerSyncAttempts = 0;
    let auxMetadataConsecutiveFailures = 0;
    let modelMetadataGeneration = 0;
    const abortController = new AbortController();

    // ── State Restoration Helpers ────────────────────────────────────────────

    function restoreAccountSnapshotsFromDisk(): void {
        const saved = globalState.get<AccountSnapshot[] | null>('accountSnapshots', null);
        if (!saved || !Array.isArray(saved)) { return; }
        const prevActive = currentAccountEmail;
        const nextMap = new Map<string, AccountSnapshot>();
        for (const snap of saved) {
            if (!snap || typeof snap.email !== 'string' || !snap.email) { continue; }
            const sanitizedCredits = Array.isArray(snap.credits)
                ? currentAICredits(snap.credits.map(c => ({
                    creditType: c.creditType,
                    creditAmount: c.creditAmount,
                    minimumCreditAmountForUsage: 0,
                }))).flatMap(c => c.creditAmount === null ? [] : [{ creditType: c.creditType, creditAmount: c.creditAmount }])
                : undefined;
            nextMap.set(snap.email, {
                ...snap,
                credits: sanitizedCredits && sanitizedCredits.length > 0 ? sanitizedCredits : undefined,
                isActive: prevActive ? snap.email === prevActive : false,
            });
        }
        accountSnapshots = nextMap;
    }

    function restoreBillingDaysFromDisk(): void {
        const saved = globalState.get<unknown>('accountBillingDays', null);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
            billingDaysMap = {};
            return;
        }
        const restored: Record<string, number> = {};
        for (const [rawEmail, day] of Object.entries(saved as Record<string, unknown>)) {
            const email = rawEmail.trim();
            if (email && typeof day === 'number' && isBillingDay(day)) {
                restored[email] = day;
            }
        }
        billingDaysMap = restored;
    }

    function restoreSharedSettingsFromDisk(): void {
        const savedApp = globalState.get<Record<string, unknown> | null>('appSettings', null);
        const raw = (savedApp && typeof savedApp === 'object' && !Array.isArray(savedApp)) ? savedApp : {};
        const persistedLock = globalState.get<boolean | undefined>('lockToMainAgent', undefined);
        const resolvedLock = typeof persistedLock === 'boolean'
            ? persistedLock
            : (typeof raw.lockToMainAgent === 'boolean' ? raw.lockToMainAgent : DEFAULT_DOCUMENT_SETTINGS.lockToMainAgent ?? false);

        settings = {
            pollingInterval: clamp(Number(raw.pollingInterval ?? DEFAULT_DOCUMENT_SETTINGS.pollingInterval) || 5, 1, 60),
            quotaNotificationThreshold: clamp(Number(raw.quotaNotificationThreshold ?? DEFAULT_DOCUMENT_SETTINGS.quotaNotificationThreshold) || 0, 0, 99),
            showContext: typeof raw.showContext === 'boolean' ? raw.showContext : DEFAULT_DOCUMENT_SETTINGS.showContext,
            showQuota: typeof raw.showQuota === 'boolean' ? raw.showQuota : DEFAULT_DOCUMENT_SETTINGS.showQuota,
            showResetCountdown: typeof raw.showResetCountdown === 'boolean' ? raw.showResetCountdown : DEFAULT_DOCUMENT_SETTINGS.showResetCountdown,
            showAiCredits: typeof raw.showAiCredits === 'boolean' ? raw.showAiCredits : DEFAULT_DOCUMENT_SETTINGS.showAiCredits,
            showSpeed: typeof raw.showSpeed === 'boolean' ? raw.showSpeed : DEFAULT_DOCUMENT_SETTINGS.showSpeed,
            showCacheHit: typeof raw.showCacheHit === 'boolean' ? raw.showCacheHit : DEFAULT_DOCUMENT_SETTINGS.showCacheHit,
            showSessionCost: typeof raw.showSessionCost === 'boolean' ? raw.showSessionCost : DEFAULT_DOCUMENT_SETTINGS.showSessionCost,
            tooltipDensity: parseTooltipDensity(raw.tooltipDensity ?? DEFAULT_DOCUMENT_SETTINGS.tooltipDensity),
            showModelInternalId: typeof raw.showModelInternalId === 'boolean' ? raw.showModelInternalId : DEFAULT_DOCUMENT_SETTINGS.showModelInternalId,
            maxRecentSteps: clamp(Number(raw.maxRecentSteps ?? DEFAULT_DOCUMENT_SETTINGS.maxRecentSteps) || 100, 10, 500),
            maxArchives: clamp(Number(raw.maxArchives ?? DEFAULT_DOCUMENT_SETTINGS.maxArchives) || 20, 1, 100),
            lockToMainAgent: resolvedLock,
        };
        lockToMainAgent = resolvedLock;
        setShowModelShortId(settings.showModelInternalId);

        panelHintPrefs = {
            showTabScrollHint: globalState.get<boolean>('panelShowTabScrollHint', true),
            showScrollbar: globalState.get<boolean>('panelShowScrollbar', false),
            showEndOfContent: globalState.get<boolean>('panelShowEndOfContent', true),
        };
        zoomLevel = clamp(Math.round(Number(globalState.get<number>('panelZoomLevel', 100)) || 100), 50, 200);
    }

    function syncFromDurableStateIfChanged(): boolean {
        const changed = durableState.reloadIfChanged();
        if (!changed) { return false; }
        initI18nFromState(globalState);
        pricingStore.init(globalState);
        dailyStore.init(globalState);
        restoreAccountSnapshotsFromDisk();
        restoreBillingDaysFromDisk();
        restoreSharedSettingsFromDisk();
        const diskLedger = globalState.get<DailyLedgerState | undefined>('dailyLedgerState', undefined);
        if (diskLedger && diskLedger.dateKey === dailyLedger.dateKey) {
            const restored = DailyLedger.restore(diskLedger);
            if (restored.getTodayActive().length >= dailyLedger.getTodayActive().length
                && restored.getSettledEntries().length >= dailyLedger.getSettledEntries().length) {
                dailyLedger = restored;
            }
        } else if (diskLedger && diskLedger.dateKey && diskLedger.dateKey > dailyLedger.dateKey) {
            dailyLedger = DailyLedger.restore(diskLedger);
        }
        return true;
    }

    // Initial seed restore
    restoreAccountSnapshotsFromDisk();
    restoreBillingDaysFromDisk();
    restoreSharedSettingsFromDisk();

    const savedConfigs = globalState.get<ModelConfig[]>('cachedModelConfigs', []);
    if (Array.isArray(savedConfigs) && savedConfigs.length > 0) {
        updateModelDisplayNames(savedConfigs);
        cachedModelConfigs = savedConfigs;
    }

    // Wire QuotaTracker reset callback -> baseline GMTracker + settle DailyLedger
    quotaTracker.onQuotaReset = (modelIds: string[], cutoffTime?: string) => {
        const expandedIds = expandModelIdsToPool(modelIds, cachedModelConfigs);
        const cutoffMs = cutoffTime ? Date.parse(cutoffTime) : NaN;
        const ledgerCutoff = Number.isNaN(cutoffMs) ? undefined : cutoffMs;
        gmTracker.baselineForQuotaReset(undefined, expandedIds, cutoffTime);
        const settled = dailyLedger.settleForQuotaReset(expandedIds, currentAccountEmail, ledgerCutoff);
        if (settled) {
            void globalState.update('dailyLedgerState', dailyLedger.serialize());
        }
        lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
        void globalState.update('gmTrackerState', gmTracker.serialize());
        void globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
    };

    function performDailyArchival(force = false): void {
        const ctx: DailyArchivalContext = {
            activityTracker,
            gmTracker,
            dailyStore,
            pricingStore,
            lastGMSummary,
            persistedModelDNA,
            lastArchivalDateKey,
            dailyLedger,
            persist: (updates) => {
                lastArchivalDateKey = updates.lastArchivalDateKey;
                lastGMSummary = updates.lastGMSummary;
                if (updates.modelDNAChanged && updates.persistedModelDNA) {
                    persistedModelDNA = updates.persistedModelDNA;
                    void globalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
                }
                void globalState.update('lastArchivalDateKey', lastArchivalDateKey);
                void globalState.update('activityTrackerState', activityTracker.serialize());
                void globalState.update('gmTrackerState', gmTracker.serialize());
                void globalState.update('dailyLedgerState', dailyLedger.serialize());
                void globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
            },
            log,
        };
        performDailyArchivalCore(ctx, force);
    }

    // Immediate startup cross-day archival
    if (dailyLedger.hasData && dailyLedger.dateKey !== toLocalDateKey()) {
        lastArchivalDateKey = dailyLedger.dateKey;
        performDailyArchival();
    }

    // ── Telemetry Helpers ────────────────────────────────────────────────────

    function invalidateLiveModelMetadata(): void {
        modelMetadataGeneration++;
        resetImageWorkflowCache();
        setAvailableImageModelIds([]);
        hasSyncedCheckpointer = false;
        checkpointerSyncAttempts = 0;
        auxMetadataConsecutiveFailures = 0;
        cachedOrchestratorSettings = null;
        cachedQuotaSummary = null;
    }

    function buildUsedModelIds(email?: string): Set<string> {
        const ids = new Set<string>();
        if (!lastGMSummary?.conversations) { return ids; }
        for (const conv of lastGMSummary.conversations) {
            for (const call of conv.calls) {
                if ((!call.accountEmail || call.accountEmail === email) && call.model) {
                    ids.add(call.model);
                }
            }
        }
        return ids;
    }

    function baselineExpiredPoolsForAccount(email: string): void {
        const snap = accountSnapshots.get(email);
        if (!snap) { return; }
        const nowMs = deps.now();
        for (const pool of (snap.resetPools || [])) {
            if (!pool.resetTime) { continue; }
            const resetMs = parsePositivePoolResetMs(pool.resetTime);
            if (resetMs === null || resetMs > nowMs) { continue; }
            if (pool.hasUsage === false && !dailyLedger.hasActiveCallsForPool(pool.modelIds || pool.modelLabels, email)) {
                continue;
            }
            const key = `${email}:${pool.resetTime}:${pool.modelLabels.join('|')}`;
            if (notifiedAccountResets.has(key)) { continue; }
            if (gmTracker.isPoolArchived(email, pool.modelIds || pool.modelLabels)) {
                notifiedAccountResets.add(key);
                continue;
            }
            notifiedAccountResets.add(key);
            const baselinedCount = gmTracker.baselineForQuotaReset(email, pool.modelIds || pool.modelLabels, pool.resetTime);
            const archivedSessions = quotaTracker.archiveExpiredSessions(email, pool.modelIds || pool.modelLabels);
            const settled = dailyLedger.settleForQuotaReset(pool.modelIds || pool.modelLabels, email, resetMs);
            if (baselinedCount > 0 || archivedSessions > 0 || settled) {
                lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                void globalState.update('gmTrackerState', gmTracker.serialize());
                void globalState.update('dailyLedgerState', dailyLedger.serialize());
                void globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
            }
        }
    }

    function handleAccountSwitchIfNeeded(newEmail: string): void {
        if (!newEmail) { return; }
        if (currentAccountEmail && currentAccountEmail !== newEmail) {
            invalidateLiveModelMetadata();
            baselineExpiredPoolsForAccount(currentAccountEmail);
            baselineExpiredPoolsForAccount(newEmail);
            currentAccountEmail = newEmail;
            gmTracker.setCurrentAccount(newEmail);
        } else if (!currentAccountEmail) {
            currentAccountEmail = newEmail;
            gmTracker.setCurrentAccount(newEmail);
            baselineExpiredPoolsForAccount(newEmail);
        }
    }

    function persistAccountSnapshots(): void {
        void globalState.update('accountSnapshots', [...accountSnapshots.values()]);
    }

    function updateAccountSnapshot(userInfo: UserStatusInfo, configs: ModelConfig[]): void {
        const email = userInfo.email;
        if (!email) { return; }
        const nowMs = deps.now();

        const poolMap = new Map<string, { resetTime: string; labels: string[]; modelIds: string[]; hasUsage: boolean; minFraction: number }>();
        for (const group of groupModelConfigsByQuotaPool(configs)) {
            poolMap.set(group.key, {
                resetTime: group.resetTime,
                labels: group.labels,
                modelIds: group.modelIds,
                hasUsage: group.minFraction < 1.0,
                minFraction: group.minFraction,
            });
        }

        const oldSnap = accountSnapshots.get(email);
        if (oldSnap) {
            const oldResetByModel = new Map<string, string>();
            for (const pool of (oldSnap.resetPools || [])) {
                if (!pool.resetTime) { continue; }
                for (const mid of (pool.modelIds || [])) {
                    oldResetByModel.set(mid, pool.resetTime);
                }
            }
            for (const [, newPool] of poolMap) {
                if (!newPool.resetTime || !newPool.modelIds.length) { continue; }
                let oldResetTime: string | undefined;
                for (const mid of newPool.modelIds) {
                    oldResetTime = oldResetByModel.get(mid);
                    if (oldResetTime) { break; }
                }
                if (!oldResetTime || !shouldSettleOnResetTimeChange(oldResetTime, newPool.resetTime, nowMs)) { continue; }
                const oldResetMs = parsePositivePoolResetMs(oldResetTime) ?? undefined;
                if (dailyLedger.isPoolSettled(newPool.modelIds, email, oldResetMs)) { continue; }
                const baselinedCount = gmTracker.baselineForQuotaReset(email, newPool.modelIds, oldResetTime);
                const settled = dailyLedger.settleForQuotaReset(newPool.modelIds, email, oldResetMs);
                if (baselinedCount > 0 || settled) {
                    lastGMSummary = gmTracker.getDetailedSummary() || gmTracker.getCachedSummary();
                    void globalState.update('gmTrackerState', gmTracker.serialize());
                    void globalState.update('dailyLedgerState', dailyLedger.serialize());
                    void globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
                }
            }
        }

        const usedModelIds = buildUsedModelIds(email);
        if (usedModelIds.size > 0) {
            for (const [, pool] of poolMap) {
                if (pool.hasUsage) { continue; }
                if (pool.modelIds.some(mid => usedModelIds.has(mid))) {
                    pool.hasUsage = true;
                }
            }
        }

        const resetPools: ResetPool[] = [];
        const allResetTimes: string[] = [];
        for (const [, pool] of [...poolMap.entries()].sort((a, b) => comparePoolResetTimes(a[1].resetTime, b[1].resetTime))) {
            const remainingPercent = pool.hasUsage ? Math.round(pool.minFraction * 100) : undefined;
            resetPools.push({
                resetTime: pool.resetTime,
                modelLabels: pool.labels,
                modelIds: pool.modelIds,
                hasUsage: pool.hasUsage,
                remainingPercent,
            });
            if (pool.resetTime && !allResetTimes.includes(pool.resetTime)) {
                allResetTimes.push(pool.resetTime);
            }
        }

        for (const snap of accountSnapshots.values()) {
            snap.isActive = false;
        }

        const validCredits = currentAICredits(userInfo.availableCredits || []).flatMap(c =>
            c.creditAmount === null ? [] : [{ creditType: c.creditType, creditAmount: c.creditAmount }]);

        accountSnapshots.set(email, {
            email,
            name: userInfo.name || '',
            planName: userInfo.planName || '',
            tierName: userInfo.userTierName || '',
            earliestResetTime: allResetTimes[0] || '',
            allResetTimes,
            resetPools,
            isActive: true,
            lastSeen: new Date(nowMs).toISOString(),
            credits: validCredits.length > 0 ? validCredits : undefined,
        });

        persistAccountSnapshots();
    }

    function recordQuotaRunways(configs: readonly ModelConfig[], nowMs: number): void {
        const pools = groupModelConfigsByQuotaPool(configs);
        for (const pool of pools) {
            const resetMs = parsePositivePoolResetMs(pool.resetTime);
            quotaRunwayTracker.record(pool.key, pool.minFraction, nowMs, resetMs);
        }
        void globalState.update('quotaRunwayState', quotaRunwayTracker.serialize());
    }

    function applyFullUserStatus(fullStatus: FullUserStatus, nowMs: number): boolean {
        if (fullStatus.configs.length === 0 && !fullStatus.userInfo) {
            return false;
        }
        updateModelDisplayNames(fullStatus.configs, { authoritative: true });
        cachedModelConfigs = fullStatus.configs;
        if (fullStatus.userInfo) {
            cachedUserInfo = fullStatus.userInfo;
            if (fullStatus.userInfo.email) {
                handleAccountSwitchIfNeeded(fullStatus.userInfo.email);
            }
            void globalState.update('cachedModelConfigs', cachedModelConfigs);
            void globalState.update('cachedPlanName', fullStatus.userInfo.planName);
            void globalState.update('cachedTierName', fullStatus.userInfo.userTierName);
            updateAccountSnapshot(fullStatus.userInfo, fullStatus.configs);
        }
        quotaTracker.processUpdate(fullStatus.configs, buildUsedModelIds(fullStatus.userInfo?.email), fullStatus.userInfo?.email);
        recordQuotaRunways(fullStatus.configs, nowMs);
        return true;
    }

    async function syncCheckpointerLimitsOnce(ls: LSInfo, generation: number): Promise<void> {
        if (hasSyncedCheckpointer || checkpointerSyncAttempts >= MAX_CHECKPOINTER_SYNC_ATTEMPTS) {
            return;
        }
        checkpointerSyncAttempts++;
        try {
            const resp = await deps.fetchAvailableModels(ls, abortController.signal);
            if (!resp || generation !== modelMetadataGeneration || disposed) { return; }
            const response = resp.response as { models?: Record<string, Record<string, unknown>>; imageGenerationModelIds?: unknown } | undefined;
            const models = response?.models || (resp.models as Record<string, Record<string, unknown>> | undefined) || {};
            const rawImageIds = response?.imageGenerationModelIds ?? resp.imageGenerationModelIds;
            const hasImageList = Array.isArray(rawImageIds) && rawImageIds.every(id => typeof id === 'string');
            const imageIds = new Set<string>(hasImageList ? (rawImageIds as string[]).map(id => id.trim()).filter(Boolean) : []);
            const overrides: Record<string, number> = {};
            let imageMetadataSynced = false;

            for (const [catalogId, c] of Object.entries(models)) {
                if (!c || typeof c !== 'object') { continue; }
                const modelVal = typeof c.model === 'string' ? c.model : '';
                const modelIdVal = (typeof c.modelId === 'string' && c.modelId)
                    || (typeof c.model_id === 'string' && c.model_id) || catalogId;
                if (!modelVal && !modelIdVal) { continue; }
                const resolved = (isPlatformModelId(modelVal) ? modelVal : undefined)
                    || (modelVal ? resolveModelId(modelVal) : undefined)
                    || (modelIdVal ? resolveModelId(modelIdVal) : undefined);

                const exps = ((c.modelExperiments as Record<string, unknown> | undefined)?.experiments as Record<string, { stringValue?: string }> | undefined) || {};
                const checkpointerStr = exps.CASCADE_USE_EXPERIMENT_CHECKPOINTER?.stringValue;
                let limitNum = 0;
                let thresholdNum = 0;
                if (checkpointerStr) {
                    try {
                        const cp = JSON.parse(checkpointerStr) as Record<string, unknown>;
                        limitNum = positiveTokenLimit(cp.max_token_limit ?? cp.max_limit);
                        thresholdNum = positiveTokenLimit(cp.token_threshold ?? cp.threshold);
                        if (limitNum > 0) {
                            const resolvedKey = resolved || modelVal || modelIdVal;
                            if (resolvedKey) { overrides[resolvedKey] = limitNum; }
                            if (modelVal) { overrides[modelVal] = limitNum; }
                            if (modelIdVal) { overrides[modelIdVal] = limitNum; }
                        }
                    } catch { /* ignore */ }
                }

                const previousSpec = resolved ? getModelSpecs().find(s => s.placeholderId === resolved) : undefined;
                const imageModel = imageIds.has(catalogId) || imageIds.has(modelIdVal) || !!previousSpec?.isImageGeneration;
                const inLivePicker = !!resolved && cachedModelConfigs.some(cfg => cfg.model === resolved);
                const maxTokens = positiveTokenLimit(c.maxTokens);
                const maxOutputTokens = positiveTokenLimit(c.maxOutputTokens);
                const describesARealModel = (limitNum > 0 || imageModel) && maxTokens > 0;
                if (resolved && (previousSpec || inLivePicker || describesARealModel)) {
                    registerResponseModelAlias(modelIdVal, resolved);
                    const patch: Partial<ModelSpec> = {
                        modelId: modelIdVal || modelVal,
                        ...(typeof c.displayName === 'string' && c.displayName.trim() ? { displayName: c.displayName.trim() } : {}),
                        ...(imageModel ? { isImageGeneration: true } : {}),
                        ...(typeof c.apiProvider === 'string' ? { apiProvider: c.apiProvider.replace('API_PROVIDER_', '') } : {}),
                        ...(maxTokens ? { maxTokens } : {}),
                        ...(maxOutputTokens ? { maxOutputTokens } : {}),
                        ...(limitNum > 0 ? { cpLimit: limitNum } : {}),
                        ...(thresholdNum > 0 ? { cpThreshold: thresholdNum } : {}),
                    };
                    updateModelSpec(resolved, patch);
                    if (imageModel && maxTokens > 0) { imageMetadataSynced = true; }
                }
            }
            if (hasImageList) { setAvailableImageModelIds([...imageIds]); }
            if (Object.keys(overrides).length > 0) {
                overrideContextLimits(overrides);
                hasSyncedCheckpointer = true;
            } else if (imageMetadataSynced) {
                hasSyncedCheckpointer = true;
            }
        } catch {
            // Optional checkpointer sync degrades cleanly to built-in limits
        }
    }

    async function refreshAuxiliaryMetadata(ls: LSInfo, generation: number): Promise<void> {
        if (auxMetadataConsecutiveFailures >= MAX_AUX_METADATA_FAILURES) { return; }
        try {
            const [orchRes, quotaRes] = await Promise.allSettled([
                deps.fetchOrchestratorSettings(ls, cachedModelConfigs, abortController.signal),
                deps.fetchUserQuotaSummary(ls, abortController.signal),
            ]);
            if (generation !== modelMetadataGeneration || disposed) { return; }
            const gotOrch = orchRes.status === 'fulfilled' && !!orchRes.value;
            const gotQuota = quotaRes.status === 'fulfilled' && !!quotaRes.value;
            if (gotOrch) { cachedOrchestratorSettings = orchRes.value; }
            if (gotQuota) { cachedQuotaSummary = quotaRes.value; }
            if (gotOrch || gotQuota) {
                auxMetadataConsecutiveFailures = 0;
            } else {
                auxMetadataConsecutiveFailures++;
            }
        } catch {
            auxMetadataConsecutiveFailures++;
        }
    }

    function computeLiveCostSnapshot(summary: GMSummary | null, activeCascadeId?: string): {
        todayCostUsd: number;
        sessionCostUsd: number;
    } {
        const custom = pricingStore.getCustom();
        let todayCostUsd = 0;
        for (const bucket of dailyLedger.getTodayActive()) {
            for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
                if (ms.calls <= 0) { continue; }
                todayCostUsd += calculateLedgerModelCosts(modelKey, ms, bucket, custom).totalCost;
            }
        }
        for (const entry of dailyLedger.getSettledEntries()) {
            todayCostUsd += entry.totalEstimatedCost || 0;
        }

        let sessionCostUsd = 0;
        if (summary && summary.conversations.length > 0) {
            const activeConv = activeCascadeId
                ? summary.conversations.find(c => c.cascadeId === activeCascadeId)
                : undefined;
            const calls = activeConv && activeConv.calls.length > 0
                ? activeConv.calls
                : summary.conversations.flatMap(c => c.calls);
            for (const call of calls) {
                const pricingModel = selectPricingModel(call.model || call.modelDisplay, call.responseModel, custom);
                const pricing = findPricingForDate(pricingModel, custom, call.createdAt || '');
                if (pricing) {
                    sessionCostUsd += costFromTokens(call, pricing);
                }
            }
        }
        return { todayCostUsd, sessionCostUsd };
    }

    function getCombinedStaleState(nowMs = deps.now()): SidecarStaleState {
        const usSnap = userStatusGuard.getSnapshot(nowMs);
        const trSnap = trajectoriesGuard.getSnapshot(nowMs);
        const isStale = Boolean(usSnap.isStale || trSnap.isStale);
        const lastSuccessAtMs = usSnap.lastSuccessAtMs !== null && trSnap.lastSuccessAtMs !== null
            ? Math.max(usSnap.lastSuccessAtMs, trSnap.lastSuccessAtMs)
            : (trSnap.lastSuccessAtMs ?? usSnap.lastSuccessAtMs ?? null);
        const lastError = trSnap.lastError || usSnap.lastError || null;
        return { isStale, lastSuccessAtMs, lastError };
    }

    function recomputeConversationResolution(): ResolvedConversationTarget {
        const resolved = resolveTargetConversation({
            trajectories: allTrajectories,
            pinnedId: pinnedConversationId,
            lockToMainAgent,
            lockedMainId,
            hostConversationId,
            currentActiveId: trackedCascadeId,
            workspaceUris: activeWorkspaceUris,
            knownSubagentIds,
        });
        lastResolution = resolved;
        if (resolved.lockedMainId) {
            lockedMainId = resolved.lockedMainId;
        }
        if (resolved.cascadeId) {
            trackedCascadeId = resolved.cascadeId;
        }
        conversationOptions = buildConversationOptions(
            allTrajectories,
            resolved.cascadeId,
            resolved.lockedMainId,
            {
                workspaceUris: activeWorkspaceUris,
                knownSubagentIds,
                lang: getLanguage(),
            },
        );
        return resolved;
    }

    function findResolvedTrajectory(resolved: ResolvedConversationTarget): TrajectorySummary | null {
        if (!resolved.cascadeId) { return null; }
        return allTrajectories.find(tr => tr.cascadeId === resolved.cascadeId) ?? null;
    }

    async function refreshActiveConversationTelemetry(
        ls: LSInfo,
        activeTrajectory: TrajectorySummary,
        nowMs: number,
    ): Promise<void> {
        // 1. ContextUsage
        const persistedUsage = monitorStore.getSnapshot(activeTrajectory.cascadeId);
        if (hasSameUsageInputs(currentUsage, activeTrajectory)) {
            currentUsage = await deps.refreshWorkflowImageUsage(ls, currentUsage, abortController.signal);
        } else if (hasSameUsageInputs(persistedUsage, activeTrajectory)) {
            currentUsage = await deps.refreshWorkflowImageUsage(ls, persistedUsage, abortController.signal);
        } else {
            currentUsage = await deps.getContextUsage(ls, activeTrajectory, undefined, abortController.signal);
        }

        if (currentUsage?.imageWorkflow?.linkedCascadeIds) {
            for (const subId of currentUsage.imageWorkflow.linkedCascadeIds) {
                knownSubagentIds.add(subId);
            }
        }
        if (lastGMSummary && currentUsage) {
            applyGMContextToUsage(currentUsage, getLatestGMContextUsed(lastGMSummary, activeTrajectory.cascadeId));
        }

        // 2. Raw GeneratorMetadata + Raw Steps for Context Breakdown & Turn Diagnostics
        const rawCacheKey = `${activeTrajectory.cascadeId}:${activeTrajectory.stepCount}:${activeTrajectory.lastModifiedTime}:${activeTrajectory.status}`;
        const canReuseRawCache = activeTrajectory.status !== CascadeStatus.RUNNING
            && cachedRawTelemetryKey === rawCacheKey;

        let rawGmEntries = cachedRawGmEntries;
        let rawSteps = cachedRawSteps;
        if (!canReuseRawCache) {
            const [gmMetaRes, stepsRes] = await Promise.allSettled([
                deps.fetchTrajectoryGeneratorMetadata(ls, activeTrajectory.cascadeId, abortController.signal),
                deps.fetchTrajectorySteps(ls, activeTrajectory.cascadeId, activeTrajectory.stepCount, abortController.signal),
            ]);
            rawGmEntries = gmMetaRes.status === 'fulfilled' ? gmMetaRes.value : [];
            rawSteps = stepsRes.status === 'fulfilled' ? stepsRes.value.steps : [];
            cachedRawGmEntries = rawGmEntries;
            cachedRawSteps = rawSteps;
            cachedRawTelemetryKey = rawCacheKey;
        }

        // 3. Rewind tracking & Dual-Cap Context Breakdown
        const prevMaxSteps = maxStepCountByCascade.get(activeTrajectory.cascadeId);
        const prevUsedTokens = prevUsedTokensByCascade.get(activeTrajectory.cascadeId);
        const effectiveModel = currentUsage?.model || activeTrajectory.requestedModel || activeTrajectory.generatorModel || '';
        const modelDisplayName = currentUsage?.modelDisplayName || normalizeModelDisplayName(effectiveModel);
        const spec = effectiveModel ? guessContextLimitSpec(effectiveModel) : undefined;
        const effectiveBudgetTokens = currentUsage?.contextLimit || getContextLimit(effectiveModel);
        const nativeLimitTokens = Math.max(spec?.maxTokens || 0, effectiveBudgetTokens);

        contextBreakdown = parseContextBreakdown({
            generatorMetadata: rawGmEntries,
            steps: rawSteps,
            currentStepCount: activeTrajectory.stepCount,
            previousMaxStepCount: prevMaxSteps,
            previousUsedTokens: prevUsedTokens,
            model: effectiveModel,
            modelDisplayName,
            effectiveBudgetTokens,
            nativeLimitTokens,
        });

        maxStepCountByCascade.set(
            activeTrajectory.cascadeId,
            Math.max(prevMaxSteps ?? 0, activeTrajectory.stepCount),
        );
        if (contextBreakdown.usedTokens > 0) {
            prevUsedTokensByCascade.set(activeTrajectory.cascadeId, contextBreakdown.usedTokens);
        }

        // 4. Turn Diagnostics (prefer raw GM entries; fall back to active GMTracker calls)
        const activeGmConvCalls = lastGMSummary?.conversations.find(c => c.cascadeId === activeTrajectory.cascadeId)?.calls || [];
        turnDiagnostics = analyzeTurnDiagnostics(rawGmEntries.length > 0 ? rawGmEntries : activeGmConvCalls);

        // 5. Custom-model isolation & Quota Runway estimates
        isCustomModelActive = isCustomModel(effectiveModel, modelDisplayName);
        quotaRunways = quotaRunwayTracker.estimateAll(nowMs, {
            modelId: effectiveModel,
            modelLabel: modelDisplayName,
            isCustomModel: isCustomModelActive,
        });

        monitorStatus = activeTrajectory.status === CascadeStatus.RUNNING
            ? { state: 'active' }
            : { state: 'idle' };
    }

    function computeDataSignature(): string {
        const stale = getCombinedStaleState();
        return JSON.stringify({
            status: monitorStatus.state,
            stale: stale.isStale,
            lang: getLanguage(),
            paused: isPaused,
            activeId: lastResolution.cascadeId,
            pinnedId: pinnedConversationId,
            lock: lockToMainAgent,
            used: currentUsage?.contextUsed ?? 0,
            steps: currentUsage?.stepCount ?? 0,
            model: currentUsage?.model ?? '',
            bdUsed: contextBreakdown?.usedTokens ?? 0,
            bdState: contextBreakdown?.measurementState ?? '',
            tdTurns: turnDiagnostics?.totalTurns ?? 0,
            tdLastCache: turnDiagnostics?.lastTurnCacheHitPct ?? null,
            gmCalls: lastGMSummary?.totalCalls ?? 0,
            quotas: cachedModelConfigs.map(c => `${c.model}:${c.quotaInfo?.remainingFraction ?? ''}:${c.quotaInfo?.resetTime ?? ''}`),
            runways: Object.entries(quotaRunways).map(([k, v]) => `${k}:${v.status}:${v.burnRatePctPerHour}`),
            trajCount: allTrajectories.length,
            acctCount: accountSnapshots.size,
            billingDays: billingDaysMap,
            settings,
            calendar: `${calendarYear}-${calendarMonth}-${dailyStore.totalDays}`,
        });
    }

    // ── Core Poll Cycle ──────────────────────────────────────────────────────

    async function runPollCycle(isManualRefresh = false): Promise<void> {
        if (disposed) { return; }
        if (isPolling && activePollPromise) {
            return activePollPromise;
        }
        isPolling = true;
        const exec = (async () => {
            const nowMs = deps.now();
            try {
                syncFromDurableStateIfChanged();
                performDailyArchival();

                // 1. Discover / revalidate LS with preferredSurface: 'app'
                let lsInfo = cachedLsInfo;
                if (!lsInfo) {
                    lsInfo = await deps.discoverLS({
                        preferredSurface: 'app',
                        workspaceUri: activeWorkspaceUris[0],
                        signal: abortController.signal,
                        log,
                    });
                    cachedLsInfo = lsInfo;
                    lsRevalidationCounter = 0;

                    if (!lsInfo) {
                        consecutiveFailures++;
                        userStatusGuard.recordFailure('Antigravity App language server not found');
                        trajectoriesGuard.recordFailure('Antigravity App language server not found');
                        if (!trajectoriesGuard.hasData()) {
                            monitorStatus = { state: 'disconnected', backendIssue: 'notFound' };
                        }
                        return;
                    }

                    // Initial user status fetch
                    try {
                        const fullStatus = await deps.fetchFullUserStatus(lsInfo, abortController.signal);
                        userStatusGuard.recordSuccess(fullStatus, nowMs);
                        applyFullUserStatus(fullStatus, nowMs);
                    } catch (err) {
                        userStatusGuard.recordFailure(err);
                    }
                    await Promise.allSettled([
                        syncCheckpointerLimitsOnce(lsInfo, modelMetadataGeneration),
                        refreshAuxiliaryMetadata(lsInfo, modelMetadataGeneration),
                    ]);
                } else {
                    lsRevalidationCounter++;
                    if (lsRevalidationCounter >= LS_REVALIDATION_INTERVAL) {
                        lsRevalidationCounter = 0;
                        try {
                            const freshLs = await deps.discoverLS({
                                preferredSurface: 'app',
                                workspaceUri: activeWorkspaceUris[0],
                                signal: abortController.signal,
                                log,
                            });
                            if (freshLs && !isSameLSConnection(freshLs, lsInfo)) {
                                log(`[sidecar-runtime] LS reconnected: port=${lsInfo.port} -> ${freshLs.port}`);
                                lsInfo = freshLs;
                                cachedLsInfo = freshLs;
                                invalidateLiveModelMetadata();
                                try {
                                    const fullStatus = await deps.fetchFullUserStatus(lsInfo, abortController.signal);
                                    userStatusGuard.recordSuccess(fullStatus, nowMs);
                                    applyFullUserStatus(fullStatus, nowMs);
                                } catch (err) {
                                    userStatusGuard.recordFailure(err);
                                }
                            }
                        } catch {
                            // Keep current LS connection on discovery hiccup
                        }
                    }

                    statusPollCount++;
                    if (statusPollCount >= STATUS_REFRESH_INTERVAL || pollCount === 0 || isManualRefresh) {
                        statusPollCount = 0;
                        try {
                            const fullStatus = await deps.fetchFullUserStatus(lsInfo, abortController.signal);
                            userStatusGuard.recordSuccess(fullStatus, nowMs);
                            applyFullUserStatus(fullStatus, nowMs);
                        } catch (err) {
                            userStatusGuard.recordFailure(err);
                        }
                        await Promise.allSettled([
                            syncCheckpointerLimitsOnce(lsInfo, modelMetadataGeneration),
                            refreshAuxiliaryMetadata(lsInfo, modelMetadataGeneration),
                        ]);
                    }
                }

                // 2. Fetch all trajectories (with automatic re-discovery on RPC failure + stale preservation)
                let trajectories: TrajectorySummary[];
                try {
                    trajectories = await deps.getAllTrajectories(lsInfo, abortController.signal);
                    trajectoriesGuard.recordSuccess(trajectories, nowMs);
                } catch (firstErr) {
                    log(`[sidecar-runtime] getAllTrajectories failed, rediscovering LS: ${firstErr}`);
                    invalidateLiveModelMetadata();
                    const rediscovered = await deps.discoverLS({
                        preferredSurface: 'app',
                        workspaceUri: activeWorkspaceUris[0],
                        signal: abortController.signal,
                        log,
                    });
                    cachedLsInfo = rediscovered;
                    if (!rediscovered) {
                        consecutiveFailures++;
                        trajectoriesGuard.recordFailure(firstErr);
                        if (!trajectoriesGuard.hasData()) {
                            monitorStatus = { state: 'disconnected', backendIssue: 'lost' };
                        }
                        return;
                    }
                    lsInfo = rediscovered;
                    try {
                        trajectories = await deps.getAllTrajectories(lsInfo, abortController.signal);
                        trajectoriesGuard.recordSuccess(trajectories, nowMs);
                    } catch (secondErr) {
                        consecutiveFailures++;
                        trajectoriesGuard.recordFailure(secondErr);
                        if (!trajectoriesGuard.hasData()) {
                            monitorStatus = { state: 'disconnected', backendIssue: 'lost' };
                        }
                        return;
                    }
                }

                consecutiveFailures = 0;
                allTrajectories = trajectories;

                if (trajectories.length === 0) {
                    currentUsage = null;
                    contextBreakdown = null;
                    turnDiagnostics = null;
                    isCustomModelActive = false;
                    quotaRunways = quotaRunwayTracker.estimateAll(nowMs);
                    recomputeConversationResolution();
                    monitorStatus = { state: 'empty' };
                    return;
                }

                // 3. Resolve target conversation (pin -> lock-to-main -> hostConversationId -> workspace/latest)
                const resolved = recomputeConversationResolution();
                const activeTrajectory = findResolvedTrajectory(resolved);
                if (!activeTrajectory) {
                    monitorStatus = { state: 'empty' };
                    return;
                }

                // 4. Fetch active conversation context usage, breakdown, turn diagnostics, runways
                await refreshActiveConversationTelemetry(lsInfo, activeTrajectory, nowMs);

                // 5. Record usage snapshot in MonitorStore
                if (currentUsage) {
                    const existing = allTrajectoryUsages.filter(u => u.cascadeId !== currentUsage!.cascadeId);
                    allTrajectoryUsages = [currentUsage, ...existing].slice(0, 10);
                    monitorStore.record(allTrajectoryUsages, currentUsage.cascadeId);
                    allTrajectoryUsages = monitorStore.getAll();
                }

                // 6. Activity + GM + DailyLedger pipeline (non-critical failures isolated)
                try {
                    const activityChanged = deps.processActivity
                        ? await deps.processActivity(lsInfo, trajectories, abortController.signal)
                        : await activityTracker.processTrajectories(
                            lsInfo,
                            trajectories.map(tr => ({
                                cascadeId: tr.cascadeId,
                                stepCount: tr.stepCount,
                                status: tr.status,
                                requestedModel: tr.requestedModel,
                                generatorModel: tr.generatorModel,
                            })),
                            abortController.signal,
                        );

                    try {
                        const gmSummary = deps.fetchGM
                            ? await deps.fetchGM(lsInfo, trajectories, currentUsage?.cascadeId, abortController.signal)
                            : await gmTracker.fetchAll(
                                lsInfo,
                                trajectories.map(tr => ({
                                    cascadeId: tr.cascadeId,
                                    title: tr.summary || tr.cascadeId.slice(0, 8),
                                    stepCount: tr.stepCount,
                                    status: tr.status,
                                })),
                                currentUsage?.cascadeId,
                                abortController.signal,
                            );
                        if (gmSummary) {
                            const detailed = deps.fetchGM ? gmSummary : (gmTracker.getDetailedSummary() || gmSummary);
                            lastGMSummary = detailed;
                            if (!deps.fetchGM) {
                                monitorStore.recordGMConversations(gmTracker.getAllConversationData());
                            }
                            const mergedDNA = mergeModelDNAState(persistedModelDNA, detailed);
                            if (mergedDNA.changed) {
                                persistedModelDNA = mergedDNA.entries;
                                void globalState.update('modelDNAState', serializeModelDNAState(persistedModelDNA));
                            }
                        }
                    } catch { /* Non-critical GM fetch failure */ }

                    try {
                        const { entries: newEntries, revertedCascadeIds } = gmTracker.getNewCallsSinceLastRecord();
                        for (const cid of revertedCascadeIds) {
                            dailyLedger.clearRecordedIdsForConversation(cid);
                        }
                        if (newEntries.length > 0) {
                            dailyLedger.normalizeIfStaleEmpty();
                            const added = dailyLedger.recordCalls(newEntries);
                            if (added === newEntries.length) {
                                gmTracker.markLedgerEntriesRecorded(newEntries);
                            }
                            if (added > 0) {
                                void globalState.update('dailyLedgerState', dailyLedger.serialize());
                            }
                        }
                        if (revertedCascadeIds.length > 0) {
                            void globalState.update('dailyLedgerState', dailyLedger.serialize());
                        }
                        const reconciled = dailyLedger.reconcileRecordedCalls(gmTracker.getLedgerReconciliationEntries());
                        if (reconciled > 0) {
                            void globalState.update('dailyLedgerState', dailyLedger.serialize());
                        }
                    } catch { /* Non-critical ledger error */ }

                    // Proactive settlement for expired pools
                    for (const snap of accountSnapshots.values()) {
                        if (!snap.isActive) {
                            baselineExpiredPoolsForAccount(snap.email);
                        }
                    }

                    if (lastGMSummary) {
                        activityTracker.injectGMData(lastGMSummary);
                        if (currentUsage && activeTrajectory) {
                            applyGMContextToUsage(currentUsage, getLatestGMContextUsed(lastGMSummary, activeTrajectory.cascadeId));
                        }
                        // If raw GM entries were empty, refresh turnDiagnostics from GMTracker calls
                        if (cachedRawGmEntries.length === 0) {
                            const convCalls = lastGMSummary.conversations.find(c => c.cascadeId === activeTrajectory.cascadeId)?.calls || [];
                            if (convCalls.length > 0) {
                                turnDiagnostics = analyzeTurnDiagnostics(convCalls);
                            }
                        }
                    }

                    if (activityChanged || nowMs - lastActivityPersistTime > 30_000) {
                        void globalState.update('activityTrackerState', activityTracker.serialize());
                        void globalState.update('gmTrackerState', gmTracker.serialize());
                        if (lastGMSummary) {
                            void globalState.update('gmDetailedSummary', slimSummaryForPersistence(lastGMSummary));
                        }
                        lastActivityPersistTime = nowMs;
                    }
                } catch {
                    // Isolate non-critical activity/GM errors so core context & quota stay live
                }
            } finally {
                pollCount++;
                const nextSig = computeDataSignature();
                if (isManualRefresh || pollCount === 1 || nextSig !== lastDataSignature) {
                    lastDataSignature = nextSig;
                    lastPollAtMs = nowMs;
                    lastUpdatedTime = formatClockTime(new Date(nowMs), getLanguage());
                }
                isPolling = false;
                activePollPromise = null;
            }
        })();
        activePollPromise = exec;
        return exec;
    }

    function computeNextPollDelayMs(): number {
        const baseMs = clamp(settings.pollingInterval, 1, 60) * 1000;
        if (consecutiveFailures > 0) {
            const cap = cachedLsInfo ? MAX_BACKOFF_INTERVAL_MS : MAX_DISCOVERY_BACKOFF_MS;
            return Math.min(baseMs * Math.pow(2, consecutiveFailures - 1), cap);
        }
        const idleMs = deps.now() - lastClientActivityMs;
        if (idleMs > idleThresholdMs) {
            return Math.max(baseMs, idlePollIntervalMs);
        }
        return baseMs;
    }

    function scheduleNextPoll(): void {
        if (disposed || isPaused || options.autoStart === false) {
            return;
        }
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
        const myGen = ++pollGeneration;
        const delayMs = computeNextPollDelayMs();
        pollTimer = setTimeout(() => {
            pollTimer = undefined;
            if (disposed || isPaused || myGen !== pollGeneration) { return; }
            void runPollCycle(false).finally(() => {
                if (!disposed && !isPaused && myGen === pollGeneration) {
                    scheduleNextPoll();
                }
            });
        }, delayMs);
        if (typeof pollTimer.unref === 'function') {
            pollTimer.unref();
        }
    }

    // ── Document Params & Snapshot Builders ──────────────────────────────────

    function getStorageDiagnostics(): StorageDiagnostics {
        const stateFilePath = durableState.getFilePath();
        const stateFileExists = durableState.exists();
        let stateFileSizeBytes = 0;
        try {
            stateFileSizeBytes = stateFileExists ? fs.statSync(stateFilePath).size : 0;
        } catch { /* ignore */ }
        return {
            stateFilePath,
            stateFileExists,
            stateFileSizeBytes,
            stateFileOpenWarnBytes: LARGE_STATE_FILE_WARN_BYTES,
            calendarDayCount: dailyStore.totalDays || 0,
        };
    }

    function buildDocumentParams(viewMode: SidecarViewMode, langOverride?: Language): SidecarDocumentParams {
        const lang = langOverride ?? getLanguage();
        const nowMs = deps.now();
        const uiGmSummary = gmTracker.getUiSummary() || lastGMSummary;
        const uiGmFullSummary = gmTracker.getUiFullSummary() || uiGmSummary;
        const costs = computeLiveCostSnapshot(uiGmSummary, currentUsage?.cascadeId ?? lastResolution.cascadeId ?? undefined);
        const staleState = getCombinedStaleState(nowMs);
        const activeEmail = selectedAccountKey || cachedUserInfo?.email || currentAccountEmail || '';
        const customPricing = pricingStore.getCustom();
        const snapArray = [...accountSnapshots.values()];
        const todayLedgerActive = dailyLedger.getTodayActive();
        const ledgerSettled = dailyLedger.getSettledEntries();

        const extras: MonitorDocumentV1175Extras = {
            surface: 'app-sidecar',
            version,
            contextBreakdown,
            turnDiagnostics,
            quotaRunways,
            isCustomModelActive,
            staleState,
            conversationOptions,
            activeConversationId: lastResolution.cascadeId,
            pinnedConversationId,
            lockToMainAgent,
            imagesBaseUri: '/assets/images',
        };

        return {
            ...extras,
            surface: 'app-sidecar',
            version,
            viewMode,
            language: lang,
            lastUpdatedTime,
            data: currentUsage,
            currentUsage,
            allTrajectoryUsages,
            allTrajectories,
            userStatus: {
                configs: cachedModelConfigs,
                userInfo: cachedUserInfo,
            },
            userInfo: cachedUserInfo,
            modelConfigs: cachedModelConfigs,
            workspaceUri: activeWorkspaceUris[0] || '',
            gmSummary: uiGmSummary,
            gmFullSummary: uiGmFullSummary,
            gmConversations: monitorStore.getGMConversations(),
            activitySummary: activityTracker.getSummary(),
            dailyLedger,
            todayLedgerActive,
            ledgerSettled,
            dailyStore,
            dailyStoreSnapshot: dailyStore.serialize(),
            pricingStore,
            pricingOverrides: customPricing,
            customPricing,
            accountSnapshots: snapArray,
            activeAccountKey: activeEmail,
            billingDays: { ...billingDaysMap },
            billingDaysMap: { ...billingDaysMap },
            orchestratorSettings: cachedOrchestratorSettings,
            quotaSummary: cachedQuotaSummary,
            todayCostUsd: costs.todayCostUsd > 0 ? costs.todayCostUsd : undefined,
            sessionCostUsd: costs.sessionCostUsd > 0 ? costs.sessionCostUsd : undefined,
            settings: { ...settings, lockToMainAgent },
            panelHintPrefs: { ...panelHintPrefs },
            panelPrefs: { ...panelHintPrefs },
            zoomLevel,
            calendarYear,
            calendarMonth,
            storageDiagnostics: getStorageDiagnostics(),
            modelDNA: persistedModelDNA,
            isPaused,
            paused: isPaused,
            backendStatus: monitorStatus,
            monitorStatus,
            now: nowMs,
            imagesBaseUri: '/assets/images',
            extras,
        };
    }

    function renderDocumentHtml(params: SidecarDocumentParams): string {
        if (options.renderDocument) {
            return options.renderDocument(params);
        }
        return buildMonitorDocumentHtml(params);
    }

    function renderTabsPayload(params: SidecarDocumentParams): Record<string, string | boolean> {
        if (options.renderTabs) {
            return options.renderTabs(params);
        }
        return buildMonitorTabsPayload(params);
    }

    function buildQuotaSummaryLines(lang: Language = getLanguage()): ContextQuotaSummaryLine[] {
        if (isCustomModelActive) { return []; }
        const nowMs = deps.now();
        return groupModelConfigsByQuotaPool(cachedModelConfigs).map(pool => {
            const rw = quotaRunways[pool.key];
            const runwayLabel = rw?.status === 'safe_until_reset'
                ? t('quota.safeBeforeReset', lang)
                : rw?.status === 'at_risk' && rw.estExhaustMs !== null
                    ? `${t('quota.exhaustsIn', lang)} ${Math.max(1, Math.round(rw.estExhaustMs / 60_000))}m`
                    : undefined;
            return {
                poolName: pool.labels.slice(0, 2).join(', ') || pool.key,
                remainingPct: Math.round(pool.minFraction * 100),
                resetCountdown: pool.resetTime ? formatResetCountdown(pool.resetTime, nowMs) : undefined,
                runwayLabel,
            };
        });
    }

    function buildContextReportText(lang: Language = getLanguage()): string {
        const snapshot = contextBreakdown ?? parseContextBreakdown({
            model: currentUsage?.model,
            modelDisplayName: currentUsage?.modelDisplayName,
            effectiveBudgetTokens: currentUsage?.contextLimit,
            currentStepCount: currentUsage?.stepCount ?? 0,
        });
        return formatContextTextReport({
            snapshot,
            title: currentUsage?.title || lastResolution.target?.summary || undefined,
            workspacePath: activeWorkspaceUris[0] || undefined,
            branchName: currentUsage?.branchName || lastResolution.target?.branchName || undefined,
            cacheHitPct: turnDiagnostics?.lastTurnCacheHitPct ?? turnDiagnostics?.sessionCacheHitPct ?? null,
            turnStartKind: turnDiagnostics?.lastTurnStartKind ?? 'unknown',
            quotaSummary: buildQuotaSummaryLines(lang),
        }, lang);
    }

    function buildHandoffPromptText(lang: Language = getLanguage()): string {
        const recentTopics: string[] = [];
        for (let i = cachedRawSteps.length - 1; i >= 0 && recentTopics.length < 4; i--) {
            const ui = cachedRawSteps[i]?.userInput as Record<string, unknown> | undefined;
            const text = typeof ui?.userResponse === 'string' ? ui.userResponse.trim() : '';
            if (text) {
                recentTopics.push(text.replace(/\s+/g, ' ').slice(0, 120));
            }
        }
        recentTopics.reverse();

        const activeTools: string[] = [];
        if (lastGMSummary?.toolCallCounts) {
            const sortedTools = Object.entries(lastGMSummary.toolCallCounts)
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([name]) => name);
            activeTools.push(...sortedTools);
        }

        return formatHandoffPrompt({
            snapshot: contextBreakdown ?? undefined,
            title: currentUsage?.title || lastResolution.target?.summary || undefined,
            workspacePath: activeWorkspaceUris[0] || undefined,
            branchName: currentUsage?.branchName || lastResolution.target?.branchName || undefined,
            model: currentUsage?.model || undefined,
            modelDisplayName: currentUsage?.modelDisplayName || undefined,
            recentTopics,
            activeTools,
        }, lang);
    }

    function buildSnapshotPayload(viewMode: SidecarViewMode, langOverride?: Language): SidecarSnapshotPayload {
        const prevLang = getLanguage();
        if (langOverride && isLanguage(langOverride) && langOverride !== prevLang) {
            setLanguageInMemory(langOverride);
        }
        try {
            const docParams = buildDocumentParams(viewMode, langOverride);
            const tabs = renderTabsPayload(docParams);
            const conversations: SidecarConversationOption[] = conversationOptions.map(opt => ({
                id: opt.cascadeId,
                title: opt.title,
                stepCount: opt.stepCount,
                isSubagent: opt.isSubagent,
                workspace: opt.workspaceLabel || undefined,
                lastModifiedTime: opt.lastModifiedTime || undefined,
            }));

            return {
                tabs,
                time: docParams.lastUpdatedTime,
                language: docParams.language,
                paused: isPaused,
                isStale: docParams.staleState?.isStale ?? false,
                staleState: docParams.staleState ?? null,
                activeConversationId: docParams.activeConversationId ?? null,
                pinnedConversationId: docParams.pinnedConversationId ?? null,
                lockToMainAgent: docParams.lockToMainAgent ?? false,
                conversations,
                conversationOptions,
                isCustomModelActive,
                contextBreakdown,
                turnDiagnostics,
                quotaRunways,
                data: {
                    usage: currentUsage,
                    monitorStatus,
                    userInfo: cachedUserInfo,
                    modelConfigs: cachedModelConfigs,
                    orchestratorSettings: cachedOrchestratorSettings,
                    quotaSummary: cachedQuotaSummary,
                    todayCostUsd: docParams.todayCostUsd,
                    sessionCostUsd: docParams.sessionCostUsd,
                    settings: docParams.settings,
                    accountSnapshots: docParams.accountSnapshots,
                    activeAccountKey: docParams.activeAccountKey,
                    billingDays: docParams.billingDays,
                },
                meta: {
                    surface: 'app-sidecar',
                    viewMode,
                    version,
                    lsPid: cachedLsInfo?.pid ?? null,
                    lsPort: cachedLsInfo?.port ?? null,
                    lsSurface: cachedLsInfo?.surface ?? null,
                    lsSource: cachedLsInfo?.source ?? null,
                    selectionMode: lastResolution.mode,
                    selectionReason: lastResolution.reason,
                    ignoredSubagentBurst: lastResolution.ignoredSubagentBurst,
                    pinnedFallback: lastResolution.pinnedFallback,
                    pollCount,
                    lastPollAtMs,
                },
            };
        } finally {
            if (langOverride && langOverride !== prevLang) {
                setLanguageInMemory(prevLang);
            }
        }
    }

    function applyContextFromRequest(
        reqConvId?: string,
        reqWorkspaces?: string[],
        reqPinnedId?: string,
        reqLockMain?: boolean,
    ): boolean {
        let selectionChanged = false;
        if (reqConvId && reqConvId.trim() && reqConvId.trim() !== hostConversationId) {
            hostConversationId = reqConvId.trim();
            selectionChanged = true;
        }
        if (Array.isArray(reqWorkspaces) && reqWorkspaces.length > 0) {
            const cleanWs = reqWorkspaces.filter(u => typeof u === 'string' && u.trim().length > 0);
            if (cleanWs.length > 0 && JSON.stringify(cleanWs) !== JSON.stringify(activeWorkspaceUris)) {
                activeWorkspaceUris = cleanWs;
                workspaceState = durableState.workspaceBucket(getPrimaryWorkspaceKey());
                monitorStore.init(workspaceState);
                selectionChanged = true;
            }
        }
        if (typeof reqPinnedId === 'string' && reqPinnedId.trim() && reqPinnedId.trim() !== pinnedConversationId) {
            pinnedConversationId = reqPinnedId.trim();
            selectionChanged = true;
        }
        if (typeof reqLockMain === 'boolean' && reqLockMain && !lockToMainAgent) {
            lockToMainAgent = true;
            selectionChanged = true;
        }
        return selectionChanged;
    }

    function getAllowedRevealRoots(): string[] {
        const home = deps.homedir();
        const roots = [
            path.join(home, '.gemini', 'antigravity'),
            path.join(home, '.gemini', 'config'),
            path.dirname(durableState.getFilePath()),
            ...activeWorkspaceUris,
        ];
        for (const tr of allTrajectories) {
            for (const wsUri of tr.workspaceUris) {
                if (wsUri) { roots.push(wsUri); }
            }
        }
        return roots;
    }

    function applySingleSetting(key: string, value: unknown): { ok: boolean; normalizedKey: string; error?: string } {
        switch (key) {
            case 'pollingInterval': {
                const n = Number(value);
                if (!Number.isFinite(n)) { return { ok: false, normalizedKey: key, error: 'Invalid pollingInterval' }; }
                settings.pollingInterval = clamp(Math.round(n), 1, 60);
                scheduleNextPoll();
                return { ok: true, normalizedKey: 'pollingInterval' };
            }
            case 'quotaNotificationThreshold': {
                const n = Number(value);
                if (!Number.isFinite(n)) { return { ok: false, normalizedKey: key, error: 'Invalid quotaNotificationThreshold' }; }
                settings.quotaNotificationThreshold = clamp(Math.round(n), 0, 99);
                return { ok: true, normalizedKey: 'quotaNotificationThreshold' };
            }
            case 'showModelInternalId': {
                settings.showModelInternalId = Boolean(value);
                setShowModelShortId(settings.showModelInternalId);
                return { ok: true, normalizedKey: 'showModelInternalId' };
            }
            case 'lockToMainAgent': {
                lockToMainAgent = Boolean(value);
                settings.lockToMainAgent = lockToMainAgent;
                void globalState.update('lockToMainAgent', lockToMainAgent);
                return { ok: true, normalizedKey: 'lockToMainAgent' };
            }
            case 'uiZoom':
            case 'panelZoomLevel': {
                const z = Number(value);
                if (!Number.isFinite(z)) { return { ok: false, normalizedKey: key, error: 'Invalid uiZoom' }; }
                zoomLevel = clamp(Math.round(z), 50, 200);
                void globalState.update('panelZoomLevel', zoomLevel);
                return { ok: true, normalizedKey: 'panelZoomLevel' };
            }
            case 'showTips':
            case 'panelShowTabScrollHint': {
                panelHintPrefs.showTabScrollHint = Boolean(value);
                void globalState.update('panelShowTabScrollHint', panelHintPrefs.showTabScrollHint);
                return { ok: true, normalizedKey: 'panelShowTabScrollHint' };
            }
            case 'customScrollbar':
            case 'panelShowScrollbar': {
                panelHintPrefs.showScrollbar = Boolean(value);
                void globalState.update('panelShowScrollbar', panelHintPrefs.showScrollbar);
                return { ok: true, normalizedKey: 'panelShowScrollbar' };
            }
            case 'showEndOfContent':
            case 'panelShowEndOfContent': {
                panelHintPrefs.showEndOfContent = Boolean(value);
                void globalState.update('panelShowEndOfContent', panelHintPrefs.showEndOfContent);
                return { ok: true, normalizedKey: 'panelShowEndOfContent' };
            }
            case 'maxRecentSteps':
            case 'activity.maxRecentSteps': {
                settings.maxRecentSteps = clamp(Number(value) || 100, 10, 500);
                return { ok: true, normalizedKey: 'activity.maxRecentSteps' };
            }
            case 'maxArchives':
            case 'activity.maxArchives': {
                settings.maxArchives = clamp(Number(value) || 20, 1, 100);
                return { ok: true, normalizedKey: 'activity.maxArchives' };
            }
            case 'tooltipDensity':
            case 'statusBar.tooltipDensity': {
                settings.tooltipDensity = parseTooltipDensity(value);
                return { ok: true, normalizedKey: 'statusBar.tooltipDensity' };
            }
            case 'showContext':
            case 'statusBar.showContext':
                settings.showContext = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showContext' };
            case 'showQuota':
            case 'statusBar.showQuota':
                settings.showQuota = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showQuota' };
            case 'showResetCountdown':
            case 'statusBar.showResetCountdown':
                settings.showResetCountdown = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showResetCountdown' };
            case 'showAiCredits':
            case 'statusBar.showAiCredits':
                settings.showAiCredits = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showAiCredits' };
            case 'showSpeed':
            case 'statusBar.showSpeed':
                settings.showSpeed = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showSpeed' };
            case 'showCacheHit':
            case 'statusBar.showCacheHit':
                settings.showCacheHit = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showCacheHit' };
            case 'showSessionCost':
            case 'statusBar.showSessionCost':
                settings.showSessionCost = Boolean(value);
                return { ok: true, normalizedKey: 'statusBar.showSessionCost' };
            default:
                return { ok: false, normalizedKey: key, error: `Unknown setting key: ${key}` };
        }
    }

    function sanitizePricingOverrides(raw: unknown): Record<string, ModelPricing> | null {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const out: Record<string, ModelPricing> = {};
        for (const [model, entry] of Object.entries(raw as Record<string, unknown>)) {
            const cleanModel = model.trim();
            if (!cleanModel || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return null;
            }
            const rec = entry as Record<string, unknown>;
            const input = Number(rec.input);
            const output = Number(rec.output);
            const cacheRead = Number(rec.cacheRead ?? 0);
            const cacheWrite = Number(rec.cacheWrite ?? 0);
            const thinking = Number(rec.thinking ?? output);
            if (![input, output, cacheRead, cacheWrite, thinking].every(v => Number.isFinite(v) && v >= 0)) {
                return null;
            }
            out[cleanModel] = { input, output, cacheRead, cacheWrite, thinking };
        }
        return out;
    }

    // ── SidecarProvider Interface Implementation ─────────────────────────────

    async function renderHtml(ctx: SidecarRenderContext): Promise<string> {
        lastClientActivityMs = deps.now();
        syncFromDurableStateIfChanged();
        applyContextFromRequest(ctx.conversationId, ctx.workspaceUris);
        if (pollCount === 0 && options.autoStart !== false) {
            await runPollCycle(false);
        }
        const prevLang = getLanguage();
        const langOverride = ctx.lang && isLanguage(ctx.lang) ? ctx.lang : undefined;
        if (langOverride && langOverride !== prevLang) {
            setLanguageInMemory(langOverride);
        }
        try {
            if (allTrajectories.length > 0) {
                recomputeConversationResolution();
            }
            const params = buildDocumentParams(ctx.viewMode, langOverride);
            return renderDocumentHtml(params);
        } finally {
            if (langOverride && langOverride !== prevLang) {
                setLanguageInMemory(prevLang);
            }
        }
    }

    async function getSnapshot(
        query: SidecarSnapshotQuery & { lang?: Language; includeHtml?: boolean },
    ): Promise<SidecarSnapshotPayload> {
        lastClientActivityMs = deps.now();
        syncFromDurableStateIfChanged();
        const selectionChanged = applyContextFromRequest(
            query.conversationId,
            query.workspaceUris,
            query.pinnedConversationId,
            query.lockToMainAgent,
        );
        if (selectionChanged && allTrajectories.length > 0) {
            const resolved = recomputeConversationResolution();
            const targetTrajectory = findResolvedTrajectory(resolved);
            if (targetTrajectory && cachedLsInfo && targetTrajectory.cascadeId !== currentUsage?.cascadeId) {
                try {
                    await refreshActiveConversationTelemetry(cachedLsInfo, targetTrajectory, deps.now());
                } catch { /* keep cached */ }
            }
        }
        const viewMode: SidecarViewMode = query.viewMode || 'aux';
        const langOverride = query.lang && isLanguage(query.lang) ? query.lang : undefined;
        return buildSnapshotPayload(viewMode, langOverride);
    }

    async function handleAction(action: SidecarActionRequest): Promise<SidecarActionHttpBody> {
        lastClientActivityMs = deps.now();
        syncFromDurableStateIfChanged();

        const viewMode: SidecarViewMode = action.viewMode === 'sidebar' || action.viewMode === 'standalone'
            ? action.viewMode
            : 'aux';
        if (typeof action.conversationId === 'string' && action.command !== 'selectConversation' && action.command !== 'pinConversation') {
            applyContextFromRequest(action.conversationId, Array.isArray(action.workspaceUris) ? action.workspaceUris as string[] : undefined);
        }

        switch (action.command) {
            case 'ping':
                return { ok: true, result: { pong: true, version } };

            case 'tabShown':
                return { ok: true };

            case 'refresh': {
                await runPollCycle(true);
                return {
                    ok: true,
                    result: { refreshed: true, time: lastUpdatedTime },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'panelReady':
            case 'getSnapshot':
                return {
                    ok: true,
                    snapshot: buildSnapshotPayload(viewMode),
                };

            case 'switchTab': {
                const tab = typeof action.tab === 'string' ? action.tab.trim() : '';
                if (!tab) {
                    return { ok: false, statusCode: 400, error: 'Missing tab name' };
                }
                return {
                    ok: true,
                    result: { tab },
                    messages: [{ command: 'switchToTab', tab }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'switchLanguage': {
                const lang = action.lang;
                if (!isLanguage(lang)) {
                    return { ok: false, statusCode: 400, error: 'Invalid language' };
                }
                await setLanguageToState(lang, globalState);
                await durableState.flush();
                lastUpdatedTime = formatClockTime(new Date(lastPollAtMs || deps.now()), lang);
                recomputeConversationResolution();
                return {
                    ok: true,
                    result: { language: lang },
                    reload: true,
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'selectConversation':
            case 'pinConversation': {
                const rawTarget = action.conversationId !== undefined ? action.conversationId : action.cascadeId;
                if (rawTarget === null || rawTarget === undefined || rawTarget === '' || rawTarget === 'auto' || rawTarget === '__auto__') {
                    pinnedConversationId = null;
                } else if (typeof rawTarget === 'string' && rawTarget.trim()) {
                    pinnedConversationId = rawTarget.trim();
                } else {
                    return { ok: false, statusCode: 400, error: 'Invalid conversationId' };
                }
                const resolved = recomputeConversationResolution();
                const targetTrajectory = findResolvedTrajectory(resolved);
                if (targetTrajectory && cachedLsInfo) {
                    try {
                        await refreshActiveConversationTelemetry(cachedLsInfo, targetTrajectory, deps.now());
                    } catch { /* keep last good state */ }
                }
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                return {
                    ok: true,
                    result: {
                        pinnedConversationId,
                        activeConversationId: resolved.cascadeId,
                        mode: resolved.mode,
                    },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'toggleLockMain':
            case 'setLockToMainAgent': {
                if (typeof action.locked === 'boolean') {
                    lockToMainAgent = action.locked;
                } else if (typeof action.value === 'boolean') {
                    lockToMainAgent = action.value;
                } else {
                    lockToMainAgent = !lockToMainAgent;
                }
                settings.lockToMainAgent = lockToMainAgent;
                await globalState.update('lockToMainAgent', lockToMainAgent);
                await globalState.update('appSettings', { ...settings });
                await durableState.flush();
                const resolved = recomputeConversationResolution();
                const targetTrajectory = findResolvedTrajectory(resolved);
                if (targetTrajectory && cachedLsInfo && targetTrajectory.cascadeId !== currentUsage?.cascadeId) {
                    try {
                        await refreshActiveConversationTelemetry(cachedLsInfo, targetTrajectory, deps.now());
                    } catch { /* keep last good state */ }
                }
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                return {
                    ok: true,
                    result: {
                        lockToMainAgent,
                        lockedMainId: resolved.lockedMainId,
                        activeConversationId: resolved.cascadeId,
                    },
                    messages: [{ command: 'syncSettingsControls', lockToMainAgent }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'togglePause': {
                isPaused = typeof action.paused === 'boolean' ? action.paused : !isPaused;
                if (isPaused && pollTimer) {
                    clearTimeout(pollTimer);
                    pollTimer = undefined;
                } else if (!isPaused) {
                    scheduleNextPoll();
                }
                return {
                    ok: true,
                    result: { paused: isPaused },
                    messages: [{ command: 'setPaused', paused: isPaused }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'copyContextReport': {
                const text = buildContextReportText(getLanguage());
                const copiedHint = t('action.copied');
                return {
                    ok: true,
                    text,
                    copiedHint,
                    result: { text, copiedHint },
                };
            }

            case 'copyHandoffPrompt': {
                const text = buildHandoffPromptText(getLanguage());
                const copiedHint = t('action.copied');
                return {
                    ok: true,
                    text,
                    copiedHint,
                    result: { text, copiedHint },
                };
            }

            case 'copyStatePath': {
                const text = durableState.getFilePath();
                const copiedHint = t('action.copied');
                return {
                    ok: true,
                    text,
                    copiedHint,
                    result: { text, copiedHint },
                    messages: [{ command: 'configSaved', key: 'statePath' }],
                };
            }

            case 'updateSetting':
            case 'setConfig':
            case 'setPanelPref': {
                const key = typeof action.key === 'string' ? action.key.trim() : '';
                if (!key) {
                    return { ok: false, statusCode: 400, error: 'Missing setting key' };
                }
                const applied = applySingleSetting(key, action.value);
                if (!applied.ok) {
                    return { ok: false, statusCode: 400, error: applied.error };
                }
                await globalState.update('appSettings', { ...settings });
                await durableState.flush();
                const msgs: Array<Record<string, unknown>> = [{ command: 'configSaved', key: applied.normalizedKey }];
                if (action.command === 'setPanelPref') {
                    msgs.unshift({ command: 'panelPrefUpdated', key: applied.normalizedKey, value: Boolean(action.value) });
                }
                return {
                    ok: true,
                    result: { settings: { ...settings }, panelPrefs: { ...panelHintPrefs }, zoomLevel },
                    messages: msgs,
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'setPollingInterval': {
                const applied = applySingleSetting('pollingInterval', action.value);
                if (!applied.ok) {
                    return { ok: false, statusCode: 400, error: applied.error };
                }
                await globalState.update('appSettings', { ...settings });
                await durableState.flush();
                return {
                    ok: true,
                    result: { pollingInterval: settings.pollingInterval },
                    messages: [{ command: 'configSaved', key: 'pollingInterval' }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'setZoomLevel': {
                const applied = applySingleSetting('uiZoom', action.value);
                if (!applied.ok) {
                    return { ok: false, statusCode: 400, error: applied.error };
                }
                await durableState.flush();
                return {
                    ok: true,
                    result: { zoomLevel },
                };
            }

            case 'updateSettings': {
                const bag = (action.settings && typeof action.settings === 'object' && !Array.isArray(action.settings))
                    ? (action.settings as Record<string, unknown>)
                    : action;
                const ignoredKeys = new Set(['command', 'settings', 'conversationId', 'workspaceUris', 'viewMode']);
                const updatedKeys: string[] = [];
                for (const [k, v] of Object.entries(bag)) {
                    if (ignoredKeys.has(k)) { continue; }
                    const applied = applySingleSetting(k, v);
                    if (!applied.ok) {
                        return { ok: false, statusCode: 400, error: applied.error };
                    }
                    updatedKeys.push(applied.normalizedKey);
                }
                await globalState.update('appSettings', { ...settings });
                await durableState.flush();
                return {
                    ok: true,
                    result: { updatedKeys, settings: { ...settings }, panelPrefs: { ...panelHintPrefs }, zoomLevel },
                    messages: updatedKeys.map(k => ({ command: 'configSaved', key: k })),
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'saveCustomPricing':
            case 'savePricing':
            case 'updatePricingOverrides': {
                const rawOverrides = action.overrides !== undefined
                    ? action.overrides
                    : (action.pricing !== undefined ? action.pricing : action.value);
                const sanitized = sanitizePricingOverrides(rawOverrides);
                if (!sanitized) {
                    return { ok: false, statusCode: 400, error: 'Invalid pricing overrides payload' };
                }
                await pricingStore.setAll(sanitized);
                await durableState.flush();
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                return {
                    ok: true,
                    result: { customPricing: pricingStore.getCustom() },
                    messages: [{ command: 'pricingSaved' }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'resetCustomPricing':
            case 'resetPricing': {
                await pricingStore.reset();
                await durableState.flush();
                lastUpdatedTime = formatClockTime(new Date(deps.now()), getLanguage());
                return {
                    ok: true,
                    result: { customPricing: pricingStore.getCustom() },
                    messages: [{ command: 'pricingReset' }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'selectAccount': {
                const rawAccount = action.accountKey !== undefined ? action.accountKey : action.email;
                if (rawAccount === null || rawAccount === undefined || rawAccount === '') {
                    selectedAccountKey = '';
                } else if (typeof rawAccount === 'string') {
                    const clean = rawAccount.trim();
                    if (clean && !accountSnapshots.has(clean) && clean !== cachedUserInfo?.email && clean !== currentAccountEmail) {
                        return { ok: false, statusCode: 404, error: 'Account snapshot not found' };
                    }
                    selectedAccountKey = clean;
                } else {
                    return { ok: false, statusCode: 400, error: 'Invalid account identifier' };
                }
                return {
                    ok: true,
                    result: { activeAccountKey: selectedAccountKey || cachedUserInfo?.email || currentAccountEmail },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'removeAccountSnapshot':
            case 'removeAccount': {
                const email = typeof action.email === 'string'
                    ? action.email.trim()
                    : (typeof action.accountKey === 'string' ? action.accountKey.trim() : '');
                if (!email) {
                    return { ok: false, statusCode: 400, error: 'Missing account email' };
                }
                const snap = accountSnapshots.get(email);
                if (!snap) {
                    return { ok: false, statusCode: 404, error: 'Account snapshot not found' };
                }
                if (snap.isActive) {
                    return { ok: false, statusCode: 400, error: 'Cannot remove the currently active account' };
                }
                accountSnapshots.delete(email);
                if (selectedAccountKey === email) { selectedAccountKey = ''; }
                persistAccountSnapshots();
                await durableState.flush();
                return {
                    ok: true,
                    result: { removed: email, accountSnapshots: [...accountSnapshots.values()] },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'setAccountBillingDay': {
                const email = typeof action.email === 'string' ? action.email.trim() : '';
                const day = Number(action.day);
                const known = Boolean(email) && (accountSnapshots.has(email) || email === currentAccountEmail || email === cachedUserInfo?.email);
                if (!email || !isBillingDaySetting(day) || !known) {
                    return { ok: false, statusCode: 400, error: 'Invalid account email or billing day (0-31)' };
                }
                if (day > 0) {
                    billingDaysMap[email] = day;
                } else {
                    delete billingDaysMap[email];
                }
                await globalState.update('accountBillingDays', { ...billingDaysMap });
                await durableState.flush();
                return {
                    ok: true,
                    result: { email, day, billingDays: { ...billingDaysMap } },
                    messages: [{ command: 'configSaved', key: 'accountBillingDay' }],
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'revealPath': {
                const rawPath = action.path !== undefined
                    ? action.path
                    : (action.targetPath !== undefined ? action.targetPath : action.uri);
                const check = validateRevealTargetPath(rawPath, getAllowedRevealRoots());
                if (!check.ok || !check.resolvedPath) {
                    return { ok: false, statusCode: check.statusCode ?? 403, error: check.error || 'Forbidden path' };
                }
                await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory));
                return {
                    ok: true,
                    result: { revealed: check.resolvedPath },
                    messages: [{ command: 'stateFileActionResult', action: 'reveal', ok: true }],
                };
            }

            case 'revealStateFile':
            case 'openStateFile': {
                const filePath = durableState.getFilePath();
                const target = fs.existsSync(filePath) ? filePath : path.dirname(filePath);
                const check = validateRevealTargetPath(target, getAllowedRevealRoots());
                if (!check.ok || !check.resolvedPath) {
                    return {
                        ok: false,
                        statusCode: check.statusCode ?? 404,
                        error: check.error || 'State file does not exist',
                        messages: [{ command: 'stateFileActionResult', action: 'reveal', ok: false }],
                    };
                }
                await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory));
                return {
                    ok: true,
                    result: { revealed: check.resolvedPath },
                    messages: [{ command: 'stateFileActionResult', action: 'reveal', ok: true }],
                };
            }

            case 'historyAction': {
                const histAction = typeof action.action === 'string' ? action.action : '';
                let targetPath = '';
                if (histAction === 'workspace') {
                    targetPath = typeof action.uri === 'string' ? action.uri : '';
                } else if (histAction === 'record' || histAction === 'pb') {
                    const cid = typeof action.cascadeId === 'string' ? action.cascadeId.trim() : '';
                    if (!SAFE_CASCADE_ID_RE.test(cid)) {
                        return { ok: false, statusCode: 400, error: 'Invalid cascadeId' };
                    }
                    const agyRoot = path.join(deps.homedir(), '.gemini', 'antigravity');
                    if (histAction === 'pb') {
                        targetPath = path.join(agyRoot, 'conversations', `${cid}.pb`);
                    } else {
                        const candidates = [
                            path.join(agyRoot, 'brain', cid),
                            path.join(agyRoot, 'browser_recordings', cid),
                            path.join(agyRoot, 'conversations'),
                        ];
                        targetPath = candidates.find(c => fs.existsSync(c)) || candidates[2];
                    }
                } else {
                    return { ok: false, statusCode: 400, error: 'Unknown history action' };
                }
                const check = validateRevealTargetPath(targetPath, getAllowedRevealRoots());
                if (!check.ok || !check.resolvedPath) {
                    return { ok: false, statusCode: check.statusCode ?? 403, error: check.error || 'Path not allowed' };
                }
                await deps.revealInOs(check.resolvedPath, Boolean(check.isDirectory));
                return { ok: true, result: { revealed: check.resolvedPath } };
            }

            case 'switchCalendarMonth': {
                const yr = Number(action.year);
                const mo = Number(action.month);
                if (!Number.isInteger(yr) || yr < 2020 || yr > 2100 || !Number.isInteger(mo) || mo < 1 || mo > 12) {
                    return { ok: false, statusCode: 400, error: 'Invalid calendar year/month' };
                }
                calendarYear = yr;
                calendarMonth = mo;
                return {
                    ok: true,
                    result: { year: calendarYear, month: calendarMonth },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'clearCalendarHistory': {
                dailyStore.clear();
                await durableState.flush();
                return {
                    ok: true,
                    result: { cleared: true },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            case 'clearToolCatalog': {
                gmTracker.clearToolCatalog();
                lastGMSummary = gmTracker.getCachedSummary();
                await globalState.update('gmTrackerState', gmTracker.serialize());
                await globalState.update('gmDetailedSummary', lastGMSummary ? slimSummaryForPersistence(lastGMSummary) : null);
                await durableState.flush();
                return {
                    ok: true,
                    result: { cleared: true },
                    snapshot: buildSnapshotPayload(viewMode),
                };
            }

            default:
                return { ok: false, statusCode: 400, error: `Unknown action: ${action.command}` };
        }
    }

    async function dispose(): Promise<void> {
        if (disposed) { return; }
        disposed = true;
        pollGeneration++;
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
        abortController.abort();
        await durableState.flush();
    }

    if (options.autoStart !== false) {
        scheduleNextPoll();
    }

    return {
        version,
        renderHtml,
        getSnapshot,
        handleAction,
        pollNow: (force = true) => runPollCycle(force),
        getState: () => ({
            lsInfo: cachedLsInfo,
            monitorStatus,
            currentUsage,
            allTrajectories,
            modelConfigs: cachedModelConfigs,
            userInfo: cachedUserInfo,
            contextBreakdown,
            turnDiagnostics,
            quotaRunways,
            isCustomModelActive,
            staleState: getCombinedStaleState(),
            conversationOptions,
            activeConversationId: lastResolution.cascadeId,
            pinnedConversationId,
            lockToMainAgent,
            lockedMainId,
            isPaused,
            settings: { ...settings, lockToMainAgent },
            lastUpdatedTime,
            pollCount,
            lastPollAtMs,
        }),
        getDurableState: () => durableState,
        getStorageDiagnostics,
        dispose,
    };
}

/**
 * Shared types for the Antigravity App native Sidecar UI plugin.
 * Pure Node/TypeScript — zero `vscode` imports so both the sidecar runtime
 * and unit tests can import this module without an IDE host.
 */

import {
    DiagnosticAliasMap,
    formatObservationDiagnostic,
    type CompactionWarningLevel,
    type ContextDisplayBasis,
    type ContextHealthStatus,
    type ContextThresholdMarker,
    type ObservationSubjectKind,
    type PublishedMonitorObservation,
    type SanitizedObservationDiagnostic,
    type SpeedDisplayMode,
    type SpeedSampleScope,
} from '../core/context-display';
import {
    bindCustomFxRate,
    isCurrencyCode,
    normalizeCurrencyCode,
    type CurrencyCode,
} from '../core/currency';
import {
    validateCustomFxRate,
    validateCustomPricingOverrides,
    validateDisplayCurrency,
    validateOrchestratorPricingMode,
    validateSubscriptionCurrency,
    validateSubscriptionMonthlyFee,
    validateSubscriptionPlan,
    type SubscriptionPlanPresetId,
    type ValidatedModelPricing,
} from '../core/pricing-validation';
import type { AppSettings as BaseAppSettings } from '../durable-state';
import type { WeeklyQuotaRunwayEstimate } from '../quota-runway';
import type { PromptCacheTtlEvaluation } from '../telemetry-metrics';

export {
    CURRENCY_CODES,
    SUPPORTED_DISPLAY_CURRENCIES,
    type CurrencyCode,
    type DisplayCurrencyCode,
} from '../core/currency';

export {
    DEFAULT_APP_SETTINGS,
    normalizeAppSettings,
    type AppSettings,
    type LastUpdateCheckRecord,
    type OrchestratorPricingMode,
} from '../durable-state';

/**
 * Forward-compatible v1.18 AppSettings extension fields shared between App sidecar
 * and IDE (`src/durable-state.ts`). All fields are optional so pre- and post-merge
 * builds stay 100% source-compatible across parallel Wave 2B branches.
 */
export interface AppSettingsV118Ext {
    languagePreference?: 'auto' | 'en' | 'zh' | 'both';
    displayCurrency?: CurrencyCode;
    customFxCurrency?: CurrencyCode | null;
    subscriptionPlan?: SubscriptionPlanPresetId;
    subscriptionMonthlyFee?: number | null;
    subscriptionCurrency?: CurrencyCode;
    contextPctBasis?: ContextDisplayBasis;
    speedMetricMode?: SpeedDisplayMode;
    quotaWindowMode?: 'tightest' | '5h' | '7d';
    quotaDirectionMode?: 'remaining' | 'used';
    appShowNativeHudBar?: boolean;
    ideShowNativeHudBar?: boolean;
    nativeHudAutoHideOnOverview?: boolean;
    appOnboardingDismissed?: boolean;
    cdpOverlayFontSize?: CdpOverlayFontSizePreset;
    cdpOverlayHighContrast?: boolean;
    legacyLockMigrated?: boolean;
}

export type CdpOverlayFontSizePreset = 'compact' | 'normal' | 'large';

export interface CdpOverlaySwarmMemberSummary {
    name: string;
    pct?: number | null;
    phase?: string;
    isInspected?: boolean;
}

export interface CdpOverlaySwarmSummary {
    rootTitle?: string;
    activeCount: number;
    totalCount: number;
    members: CdpOverlaySwarmMemberSummary[];
}

export type AppSettingsWithV118 =
    Omit<BaseAppSettings, 'displayCurrency' | 'subscriptionCurrency'>
    & {
        displayCurrency: CurrencyCode;
        subscriptionCurrency: CurrencyCode;
    }
    & AppSettingsV118Ext;

export type SidecarViewMode = 'aux' | 'sidebar' | 'standalone';

// ─── Opt-In CDP Ambient Overlay Contracts (v1.17.6) ──────────────────────────

export type CdpConnectionState = 'disabled' | 'probing' | 'connected' | 'cdp_unavailable' | 'error';

export type CdpDiagnosticCode =
    | 'disabled'
    | 'probing'
    | 'host_missing_flag'
    | 'missing_port_file'
    | 'port_unreachable'
    | 'no_hub_target'
    | 'ws_error'
    | 'eval_error'
    | 'connected';

export interface CdpPlatformGuide {
    platform: 'darwin' | 'win32' | 'linux';
    command: string;
    en: string;
    zh: string;
}

export interface CdpLauncherStatus {
    supported: boolean;
    platform: NodeJS.Platform;
    installed: boolean;
    launcherPath: string;
    displayName: string;
    targetAppFound: boolean;
    targetAppPath?: string;
    safeTerminalCommand: string;
    noteEn: string;
    noteZh: string;
}

export interface CdpLauncherActionResult {
    ok: boolean;
    status: CdpLauncherStatus;
    messageEn: string;
    messageZh: string;
    error?: string;
}

export interface CdpStatus {
    state: CdpConnectionState;
    diagnosticCode?: CdpDiagnosticCode;
    composerEnabled: boolean;
    topBarEnabled: boolean;
    targetUrl?: string;
    targetTitle?: string;
    portFilePath?: string;
    discoveredPort?: number;
    lastInjectedAt?: number;
    errorMessage?: string;
    hostHasDebugFlag?: boolean;
    launcherStatus?: CdpLauncherStatus;
    platformGuide: CdpPlatformGuide;
}

export interface CdpOverlayToggles {
    appComposerRingEnabled: boolean;
    appTopBarEnabled: boolean;
}

export type CdpOverlayTurnCacheState = 'cold' | 'partial' | 'warm' | 'unknown';

export interface CdpOverlayQuotaPool {
    poolKey: string;
    label: string;
    modelChips: string[];
    remainingPct: number | null;
    windowTag?: string;
    resetCountdown?: string;
    resetAtIso?: string;
    weeklyRemainingPct?: number | null;
    weeklyResetCountdown?: string;
    isCurrentSessionModel?: boolean;
    health?: 'good' | 'warn' | 'danger' | 'unknown';
}

export interface CdpOverlayPayload {
    updatedAt: string;
    nextRefreshSec?: number;
    language: 'en' | 'zh' | 'both';
    theme?: 'auto' | 'dark' | 'light';
    /** Active conversation cascade ID represented by this overlay payload (null when idle/pending). */
    cascadeId?: string | null;
    /** Canonical D9 observation subject cascade ID (coordinator or inspected worker). */
    subjectCascadeId?: string | null;
    /** Canonical D9 root coordinator cascade ID for the observed subject. */
    rootCascadeId?: string | null;
    /** Canonical D9 subject kind ('coordinator' | 'subagent' | 'swarm_worker' | 'standalone' | 'none'). */
    subjectKind?: ObservationSubjectKind;
    /** Monotonic selection revision matching the host selection state that produced this payload. */
    selectionRevision?: number;
    /** Monotonic data revision matching the telemetry snapshot that produced this payload. */
    dataRevision?: number;
    /** Active denominator basis used to compute `primaryPct` ('effective' | 'native'). */
    actualBasis?: ContextDisplayBasis;
    /** User-requested denominator basis ('effective' | 'native'). */
    requestedBasis?: ContextDisplayBasis;
    /** Canonical D9 primary percentage rounded to 1 decimal (null when incomplete; preserves overflow >100%). */
    primaryPct?: number | null;
    /** Unclamped raw percentage numerator/denominator*100 (null when incomplete). */
    primaryPctRaw?: number | null;
    /** Canonical formatted primary percentage text ('—', '0%', '21.4%', '112%'). */
    primaryPctText?: string;
    /** Geometry-only clamped bar/ring fill percentage in [0, 100]. */
    geometryFillPct?: number;
    /** Canonical health status ('healthy' | 'caution' | 'warning' | 'critical' | 'incomplete'). */
    healthStatus?: ContextHealthStatus;
    /** True ONLY when this subject is confirmed to have 0 steps & 0 tokens (displays 0% & Healthy). */
    isZeroStepFresh?: boolean;
    /** True when context telemetry is unavailable/incomplete (displays '—', NEVER 0% or Healthy). */
    isIncomplete?: boolean;
    /** True when compaction threshold warning is active (remains true even under `native` basis!). */
    compactionWarningActive?: boolean;
    /** Severity level of compaction warning ('none' | 'caution' | 'warning' | 'critical'). */
    compactionWarningLevel?: CompactionWarningLevel;
    /** Compaction pressure percentage on effective basis (independent of displayed basis). */
    compactionPct?: number | null;
    /** Measured model identifier backing the active observation (never substituted from another conversation). */
    measuredModel?: string | null;
    /** Active speed display mode ('decode' | 'e2e'). */
    speedMode?: SpeedDisplayMode;
    /** Explicit v1.18 speed metric mode alias for CDP overlay consumers. */
    speedMetricMode?: SpeedDisplayMode;
    /** Valid sample coverage for model-call speed aggregation. */
    speedCoverage?: { measuredCount: number; totalCount: number } | null;
    /** Strict scope of the speed reading ('latest_call' | 'conversation_weighted' | 'none'). */
    speedSampleScope?: SpeedSampleScope;
    /** Call identifier of the speed sample when `speedMode === 'latest_call'`. */
    speedCallId?: string | null;
    /** Canonical display output speed (tok/s) strictly scoped to `subjectCascadeId`. */
    displaySpeedTps?: number | null;
    /** Axis-aligned threshold markers positioned strictly on `actualBasis`. */
    markers?: readonly ContextThresholdMarker[];
    /** Optional overlay typography preset ('compact' | 'normal' | 'large'). */
    fontSizePreset?: CdpOverlayFontSizePreset;
    overlayFontSize?: CdpOverlayFontSizePreset;
    /** Optional explicit overlay high-contrast override (or 'auto' to allow host/OS HC detection). */
    highContrast?: boolean | 'auto';
    overlayHighContrast?: boolean | 'auto';
    /** Optional compaction detection state for overlay composer notice. */
    compactionDetected?: boolean;
    checkpointCompressionDrop?: number | null;
    /** Optional 5m idle prompt cache TTL heuristic state. */
    promptCacheTtlState?: 'warm' | 'cooling' | 'cold' | 'unknown';
    /** Optional lightweight Swarm summary embedded in existing context popover. */
    swarmSummary?: CdpOverlaySwarmSummary | null;
    /** Active quota display horizon ('5h' | '7d' | 'tightest') & direction ('remaining' | 'used'). */
    quotaWindowMode?: '5h' | '7d' | 'tightest';
    quotaDirectionMode?: 'remaining' | 'used';
    // Current session / context telemetry
    modelName: string;
    contextUsedTokens: number;
    contextEffectiveLimit: number;
    contextNativeLimit?: number;
    contextPct: number;
    compactionThresholdPct?: number | null;
    tier200kMarkerPct?: number | null;
    // Performance
    outputSpeedTps: number | null;
    avgOutputSpeedTps: number | null;
    peakOutputSpeedTps?: number | null;
    recentCallCount?: number | null;
    isShortSample: boolean;
    isWaitingTtft?: boolean;
    ttftMs: number | null;
    // Cache
    recentCacheHitPct: number | null;
    avgCacheHitPct: number | null;
    turnCacheState: CdpOverlayTurnCacheState;
    // Tokens & Cost
    estCostUsd: number | null;
    estCostFormatted?: string;
    localCostFormatted?: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    // Top bar aggregate / quota board
    cumulativeRecordedTokens: number;
    todayTokens?: number | null;
    todayCostFormatted?: string | null;
    cumulativeCostFormatted?: string | null;
    recordedDaysCount?: number | null;
    sessionCount?: number | null;
    subscriptionRoiSummary?: string | null;
    tightestQuotaPct: number | null;
    tightestQuotaWindowTag?: string;
    sessionQuota5hPct?: number | null;
    sessionQuota5hReset?: string;
    sessionQuotaWeeklyPct?: number | null;
    sessionQuotaWeeklyReset?: string;
    quotaPools: CdpOverlayQuotaPool[];
    // Authenticated loopback action bridge (127.0.0.1 + 256-bit X-Monitor-Token)
    bridgeUrl?: string;
    bridgeToken?: string;
}

export type CdpOverlayBridgeActionCommand = 'openPanel' | 'refresh' | 'togglePause' | 'focusConversation';

export type CdpOverlayTargetTab =
    | 'overview'
    | 'gm'
    | 'sessions'
    | 'cost'
    | 'models'
    | 'calendar'
    | 'accounts'
    | 'settings';

export interface CdpFocusAck {
    accepted: boolean;
    ackFocusRevision: number;
}

export interface CdpOverlayBridgeAction {
    /** Derived from the authenticated grant, never supplied by page content. */
    targetId?: string;
    /** Monotonic revision for focus events in this target. */
    focusRevision?: number;
    command: CdpOverlayBridgeActionCommand;
    source?: 'composer' | 'topbar';
    targetTab?: CdpOverlayTargetTab;
    conversationId?: string | null;
    isNewConversation?: boolean;
}

// ─── Self-Updater Engine Contracts (v1.17.6) ─────────────────────────────────

export interface PluginReleaseInfo {
    version: string;
    tagName: string;
    releaseUrl: string;
    publishedAt?: string;
    releaseNotesSummary: string;
    assetName: string;
    assetUrl: string;
    assetSize?: number;
    checksumsUrl?: string | null;
}

export interface UpdateCheckResult {
    status: 'update_available' | 'up_to_date' | 'not_modified' | 'throttled' | 'error';
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    etag?: string | null;
    checkedAt: number;
    releaseInfo?: PluginReleaseInfo;
    error?: string;
}

export interface ApplyPluginUpdateResult {
    ok: boolean;
    previousVersion: string;
    installedVersion: string;
    requiresReload: boolean;
    checksumVerified?: boolean;
    rolledBack?: boolean;
    message: string;
    error?: string;
}

export type SidecarSurface = 'vscode' | 'sidecar' | 'standalone';

export interface SidecarRenderContext {
    /** Active UI entrypoint mode ('aux' for AUX_PANE, 'sidebar' for SIDEBAR full pane). */
    viewMode: SidecarViewMode;
    /** Requested URL path (e.g. '/' or '/full'). */
    pathname: string;
    /** Active conversation ID passed via query param or host context. */
    conversationId?: string;
    /** Active workspace folder URIs if known at render time. */
    workspaceUris?: string[];
    /** Optional per-request display language override (without mutating persisted state). */
    lang?: 'zh' | 'en' | 'both';
    /** True when running inside Antigravity App's Sidecar SDK environment. */
    isSidecarEnv: boolean;
    /** Plugin/extension semantic version string. */
    version: string;
    /** Optional host window identifier for multi-window isolation. */
    windowId?: string;
    /** Optional authenticated request scope ('sdk' | 'standalone' | 'cdp'). */
    authScope?: string;
    /** Optional per-request privacy mask override (defaults to host privacy mask state). */
    privacyMasked?: boolean;
}

export interface SidecarSnapshotQuery {
    /** Active host conversation ID (deprecated on GET; ignored for focus mutation — use syncHostFocus). */
    conversationId?: string;
    /** Active workspace folder URIs (deprecated on GET; ignored for root mutation — use registerWorkspaces). */
    workspaceUris?: string[];
    /** Client's previously received snapshot hash/ETag for unchanged short-circuiting. */
    etag?: string;
    /** Current view mode ('aux' | 'sidebar' | 'standalone'). */
    viewMode?: SidecarViewMode;
    /** Optional per-request display language override. */
    lang?: 'zh' | 'en' | 'both';
    /** When true, request rendered document HTML alongside snapshot data. */
    includeHtml?: boolean;
    /** Optional host window identifier. */
    windowId?: string;
    /** Optional authenticated request scope ('sdk' | 'standalone' | 'cdp'). */
    authScope?: string;
    /** Optional per-request privacy mask state override. */
    privacyMasked?: boolean;
    /** Optional manually pinned conversation ID (deprecated on GET; use selectConversation/pinConversation). */
    pinnedConversationId?: string;
    /** Whether the user enabled "Lock to Main Agent" (deprecated on GET; use toggleLockMain). */
    lockToMainAgent?: boolean;
    /** Explicit signal that genuine user interaction occurred since the previous snapshot request. */
    userActive?: boolean;
}

export interface SidecarConversationOption {
    id: string;
    title: string;
    stepCount?: number;
    isSubagent?: boolean;
    workspace?: string;
    lastModifiedTime?: string;
}

export interface SidecarSnapshotPayload {
    /** Rendered tab pane HTML fragments matching the webview incremental update contract. */
    tabs?: Record<string, string | boolean>;
    /** Formatted update clock time (24h HH:MM:SS). */
    time?: string;
    /** Currently targeted conversation ID. */
    activeConversationId?: string | null;
    /** Available conversations for the switcher dropdown. */
    conversations?: SidecarConversationOption[];
    /** Optional plain-text CLI-style /context report for one-click copy. */
    contextReport?: string;
    /** Optional compact handoff prompt for one-click copy. */
    handoffPrompt?: string;
    /** Active display language. */
    language?: 'zh' | 'en' | 'both';
    /** Whether polling updates are currently paused. */
    paused?: boolean;
    /** True when serving cached telemetry during a transient RPC outage. */
    isStale?: boolean;
    /** Surface metadata / diagnostics. */
    meta?: Record<string, unknown>;
    /** Allow Wave 2 runtime extensions without breaking strict typing. */
    [key: string]: unknown;
}

export interface SidecarSnapshotUnchangedResponse {
    unchanged: true;
    hash: string;
}

export interface SidecarSnapshotChangedResponse {
    unchanged: false;
    hash: string;
    snapshot: SidecarSnapshotPayload;
}

export type SidecarSnapshotResponse =
    | SidecarSnapshotUnchangedResponse
    | SidecarSnapshotChangedResponse;

export type SidecarActionCommand =
    | 'syncHostFocus'
    | 'registerWorkspaces'
    | 'setPrivacyMask'
    | 'togglePrivacyMask'
    | 'inspectMember'
    | 'clearInspect'
    | 'retargetLockedRoot'
    | 'setLockToMainAgent'
    | 'toggleLockToMainAgent'
    | 'toggleLockMain'
    | 'recheckCdp'
    | 'setupCdpLauncher'
    | 'removeCdpLauncher'
    | 'revealCdpLauncher'
    | 'previewHandoffV2'
    | 'dismissRecoveryBrief'
    | 'dismissAppOnboarding'
    | 'updateAppSettings'
    | 'readGlobalRulesFile'
    | 'saveGlobalRulesFile'
    | 'openGlobalRulesFile'
    | 'revealGlobalRulesFile'
    | 'exportSettingsBackup'
    | 'importSettingsBackup'
    | 'exportRedactedDiagnostics'
    | 'calendarExportMarkdown'
    | (string & {});

export interface SidecarActionRequest {
    command: SidecarActionCommand;
    [key: string]: unknown;
}

export interface SidecarActionResponse {
    ok: boolean;
    result?: unknown;
    /** Optional VS Code-compatible messages to dispatch to window listeners in the webview. */
    messages?: Array<Record<string, unknown>>;
    /** When true, instructs the client bridge to perform a clean page reload. */
    reload?: boolean;
    /** Optional updated snapshot returned inline after a mutating action. */
    snapshot?: SidecarSnapshotPayload;
    /** Hash of the returned snapshot, if present. */
    hash?: string;
    /** Sanitized user-safe error message (never raw stack traces). */
    error?: string;
    /** Optional explicit HTTP status hint (e.g. 400 for invalid/unknown actions). */
    statusCode?: number;
}

export interface SidecarHealthResponse {
    buildId?: string;
    ok: true;
    version: string;
    surface: 'app-sidecar';
    pid: number;
    mode: 'sidecar' | 'standalone';
    uptimeMs: number;
}

export interface SidecarProvider {
    /** Plugin version exposed via /api/health and render context. */
    readonly version?: string;
    /** Render the initial full HTML document for '/' or '/full'. */
    renderHtml(ctx: SidecarRenderContext): Promise<string> | string;
    /** Return the current telemetry snapshot for incremental ETag polling. */
    getSnapshot(query: SidecarSnapshotQuery): Promise<SidecarSnapshotPayload> | SidecarSnapshotPayload;
    /** Execute a user UI action posted from the webview bridge. */
    handleAction(action: SidecarActionRequest): Promise<SidecarActionResponse> | SidecarActionResponse;
    /** Optional overlay bridge auth snapshot (legacy single-token compatibility). */
    getOverlayBridgeAuth?(): { token: string; allowedOrigin?: string };
    /** Optional per-target overlay bridge credential validator backed by active CDP grants. */
    validateOverlayBridgeAuth?(token: string, origin?: string): boolean;
    /** Optional accessor for the latest frozen D9 observation backing all projected surfaces. */
    getLatestObservation?(): PublishedMonitorObservation | null;
    /** Optional graceful cleanup on SIGINT/SIGTERM or server shutdown. */
    dispose?(): Promise<void> | void;
}

// ─── Shared v1.18 Dual-Host Pure Feature Engines (Zero `vscode` Deps) ────────

export function normalizeCdpOverlayFontSize(raw: unknown): CdpOverlayFontSizePreset {
    return raw === 'compact' || raw === 'large' || raw === 'normal' ? raw : 'normal';
}

export function isCdpOverlayFontSize(raw: unknown): raw is CdpOverlayFontSizePreset {
    return raw === 'compact' || raw === 'normal' || raw === 'large';
}

// ── 1. Ingestion-Time Workspace Attribution ──────────────────────────────────

export interface LedgerAttributionTrajectoryLike {
    cascadeId: string;
    workspaceUris?: readonly string[];
    gitRootUri?: string;
}

export function extractAuthorityFromWorkspaceUri(uri?: string | null, fallback?: string | null): string {
    const s = typeof uri === 'string' ? uri.trim() : '';
    if (s) {
        let m = /^vscode-remote:\/\/([^/]+)/i.exec(s);
        if (m?.[1]) { return decodeURIComponent(m[1]); }
        if ((m = /^ssh:\/\/([^/]+)/i.exec(s))?.[1]) { return `ssh-remote+${m[1]}`; }
        if ((m = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)/i.exec(s))?.[1]) { return `wsl+${m[1]}`; }
    }
    return (typeof fallback === 'string' && fallback.trim()) || 'local';
}

export function enrichLedgerEntriesForIngestion<
    T extends { dedupKey: string; cascadeId?: string; account?: string; accountEmail?: string; authority?: string; workspace?: string; call: { accountEmail?: string } },
>(
    entries: readonly T[],
    ctx: { trajectories?: readonly LedgerAttributionTrajectoryLike[]; activeCascadeId?: string | null; activeWorkspaceUri?: string | null; fallbackAuthority?: string | null; fallbackAccount?: string | null },
): T[] {
    if (!entries.length) { return []; }
    const byId = new Map<string, LedgerAttributionTrajectoryLike>();
    for (const tr of ctx.trajectories || []) { if (tr?.cascadeId) { byId.set(tr.cascadeId, tr); } }
    const aCid = (ctx.activeCascadeId || '').trim(), aWs = (ctx.activeWorkspaceUri || '').trim();
    const fAuth = (ctx.fallbackAuthority || '').trim(), fAcct = (ctx.fallbackAccount || '').trim();
    return entries.map((e) => {
        const dk = (e.dedupKey || '').trim();
        const bar = dk.indexOf('|');
        const pfx = bar > 0 ? dk.slice(0, bar).replace(/:\d+$/, '').trim() : '';
        const cascadeId = (e.cascadeId || '').trim() || (pfx && !/^(?:steps:|exec:|archive)/.test(pfx) ? pfx : undefined);
        const tr = cascadeId ? byId.get(cascadeId) : undefined;
        let workspace = typeof e.workspace === 'string' ? e.workspace.trim() : '';
        if (!workspace && tr) { workspace = ((tr.workspaceUris || []).find(u => typeof u === 'string' && u.trim()) || tr.gitRootUri || '').trim(); }
        if (!workspace && aWs && cascadeId && cascadeId === aCid) { workspace = aWs; }
        const authority = (typeof e.authority === 'string' && e.authority.trim()) || (workspace ? extractAuthorityFromWorkspaceUri(workspace, fAuth || undefined) : (fAuth || undefined));
        const account = (e.account || e.accountEmail || e.call?.accountEmail || fAcct || '').trim() || undefined;
        return { ...e, ...(cascadeId ? { cascadeId } : {}), ...(workspace ? { workspace } : {}), ...(authority ? { authority } : {}), ...(account ? { account } : {}) };
    });
}

// ── 2. Handoff v2 Strict Allowlist Generator ─────────────────────────────────

export const HANDOFF_V2_ALLOWED_FIELDS = Object.freeze([
    'subjectCascadeId',
    'dataRevision',
    'subjectKind',
    'canonicalModel',
    'contextPct',
    'actualBasis',
    'usedTokens',
    'primaryLimit',
    'secondaryLimit',
    'compactionWarningActive',
    'workspaceLabel',
    'branchName',
    'swarmSummary',
    'turnStatus',
] as const);

export interface HandoffV2SwarmMemberField {
    label: string;
    role: string;
    phase: string;
    killed: boolean;
}

export interface HandoffV2AllowlistedFields {
    subjectCascadeId: string | null;
    dataRevision: number;
    subjectKind: ObservationSubjectKind;
    canonicalModel: string | null;
    contextPct: number | null;
    primaryPctText: string;
    actualBasis: ContextDisplayBasis;
    usedTokens: number | null;
    primaryLimit: number | null;
    secondaryLimit: number | null;
    compactionWarningActive: boolean;
    workspaceLabel: string | null;
    branchName: string | null;
    swarmSummary: {
        activeCount: number;
        totalCount: number;
        members: HandoffV2SwarmMemberField[];
    } | null;
    turnStatus: {
        status: string;
        stepCount: number | null;
        callCount: number | null;
        cacheState: string;
        speedMode: SpeedDisplayMode;
        speedTps: number | null;
        compressionDetected: boolean;
    };
}

export interface HandoffV2Input {
    observation?: PublishedMonitorObservation | null;
    subjectCascadeId?: string | null;
    dataRevision?: number;
    canonicalModel?: string | null;
    title?: string | null;
    workspaceUriOrLabel?: string | null;
    branchName?: string | null;
    swarmSummary?: {
        activeCount: number;
        totalCount: number;
        members: Array<{ name: string; role?: string; phase?: string; killed?: boolean }>;
    } | null;
    turnStatus?: {
        status?: string;
        stepCount?: number | null;
        callCount?: number | null;
        cacheState?: string;
        speedMode?: SpeedDisplayMode;
        speedTps?: number | null;
        compressionDetected?: boolean;
    };
    privacyMasked: boolean;
    redactText?: (raw: string) => string;
    lang?: 'en' | 'zh' | 'both';
}

export interface HandoffV2Result {
    subjectCascadeId: string | null;
    dataRevision: number;
    privacyMasked: boolean;
    allowlistedFields: readonly string[];
    fields: HandoffV2AllowlistedFields;
    previewText: string;
}

function deriveSafeWorkspaceBasename(raw?: string | null): string | null {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) { return null; }
    let p = s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
        try { p = decodeURIComponent(new URL(p).pathname || ''); } catch { p = p.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''); }
    }
    const segs = p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
    return segs[segs.length - 1] || s;
}

const fmtTok = (n: number | null): string =>
    n === null || !Number.isFinite(n) || n < 0 ? '—'
        : n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
            : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(n));

const numOpt = (v: unknown, gt0 = false): number | null =>
    typeof v === 'number' && Number.isFinite(v) && (gt0 ? v > 0 : v >= 0) ? Math.round(v) : null;

export function buildAllowlistedHandoffV2(i: HandoffV2Input): HandoffV2Result {
    const o = i.observation ?? null, masked = i.privacyMasked, red = (s: string) => (masked && i.redactText ? i.redactText(s) : s);
    const subjectCascadeId = o?.subjectCascadeId ?? (i.subjectCascadeId?.trim() || null);
    const dataRevision = o?.dataRevision ?? (typeof i.dataRevision === 'number' ? Math.max(0, Math.floor(i.dataRevision)) : 0);
    const subjectKind: ObservationSubjectKind = o?.subjectKind ?? 'main';
    const canonicalModel = i.canonicalModel?.trim() || o?.measuredModel?.trim() || null;
    const actualBasis: ContextDisplayBasis = o?.actualBasis ?? 'compaction';
    const ok = Boolean(o && !o.isIncomplete);
    const usedTokens = ok ? o!.usedTokens : null, primaryLimit = ok ? o!.primaryLimit : null, secondaryLimit = ok ? o!.secondaryLimit : null, contextPct = ok ? o!.primaryPct : null;
    const primaryPctText = contextPct === null ? '—' : (o?.isZeroStepFresh ? '0%' : `${contextPct.toFixed(1).replace(/\.0$/, '')}%`);
    const compactionWarningActive = Boolean(o?.compactionWarningActive);
    const rawWs = deriveSafeWorkspaceBasename(i.workspaceUriOrLabel), rawBr = typeof i.branchName === 'string' ? i.branchName.trim() : '';
    const workspaceLabel = rawWs ? (masked ? '[Redacted Workspace]' : rawWs) : null;
    const branchName = rawBr ? (masked ? '[Redacted Branch]' : rawBr) : null;
    const sw = i.swarmSummary;
    const swarmSummary = sw && sw.totalCount > 0 ? {
        activeCount: Math.max(0, Math.round(sw.activeCount)), totalCount: Math.max(0, Math.round(sw.totalCount)),
        members: (sw.members || []).slice(0, 8).map((m, idx) => ({
            label: masked ? `member_${idx + 1}` : red((m.name || `member_${idx + 1}`).slice(0, 48)),
            role: (m.role || 'worker').slice(0, 24), phase: (m.phase || 'UNKNOWN').slice(0, 24), killed: Boolean(m.killed),
        })),
    } : null;
    const ts = i.turnStatus ?? {}, rawTps = ts.speedTps ?? o?.displaySpeedTps;
    const turnStatus = {
        status: (ts.status || 'unknown').slice(0, 32), stepCount: numOpt(ts.stepCount), callCount: numOpt(ts.callCount),
        cacheState: (ts.cacheState || 'unknown').slice(0, 24),
        speedMode: (ts.speedMode === 'e2e' || o?.speedMode === 'e2e' ? 'e2e' : 'decode') as SpeedDisplayMode,
        speedTps: typeof rawTps === 'number' && Number.isFinite(rawTps) ? Math.round(rawTps * 10) / 10 : null,
        compressionDetected: Boolean(ts.compressionDetected),
    };
    const fields: HandoffV2AllowlistedFields = {
        subjectCascadeId: subjectCascadeId ? (masked ? `conv:${subjectCascadeId.slice(0, 6)}` : subjectCascadeId) : null,
        dataRevision, subjectKind, canonicalModel, contextPct, primaryPctText, actualBasis, usedTokens,
        primaryLimit, secondaryLimit, compactionWarningActive, workspaceLabel, branchName, swarmSummary, turnStatus,
    };
    const zh = i.lang === 'zh';
    const L = zh
        ? [`## 上下文交接摘要 (HANDOFF v2 · rev ${dataRevision})`, '会话标题', '会话对象', '模型', '上下文', ' · 接近自动压缩', '工作区', '分支', '轮次状态', '状态', '步数', '模型调用', '缓存', '已压缩', '请基于以上结构化上下文继续当前任务，避免重复已完成步骤。']
        : [`## Context HANDOFF Brief (v2 · rev ${dataRevision})`, 'Session', 'Subject', 'Model', 'Context', ' · compaction alert', 'Workspace', 'Branch', 'Turn Status', 'status', 'steps', 'calls', 'cache', 'compacted', 'Continue from the structured state above without repeating completed work.'];
    // Free-text title is NOT in HANDOFF_V2_ALLOWED_FIELDS — omit it completely when privacyMasked is true.
    const safeTitle = !masked && typeof i.title === 'string' && i.title.trim() ? red(i.title.trim().slice(0, 120)) : '';
    const tp = [`${L[9]}=${turnStatus.status}`, ...(turnStatus.stepCount !== null ? [`${L[10]}=${turnStatus.stepCount}`] : []), ...(turnStatus.callCount !== null ? [`${L[11]}=${turnStatus.callCount}`] : []), `${L[12]}=${turnStatus.cacheState}`, ...(turnStatus.speedTps !== null ? [`${turnStatus.speedMode}=${turnStatus.speedTps} tok/s`] : []), ...(turnStatus.compressionDetected ? [L[13]] : [])];
    const lines = [
        L[0], ...(safeTitle ? [`- ${L[1]}: ${safeTitle}`] : []), `- ${L[2]}: \`${fields.subjectCascadeId ?? 'none'}\` (${subjectKind})`,
        `- ${L[3]}: ${canonicalModel ?? '—'}`, `- ${L[4]}: ${primaryPctText} (${fmtTok(usedTokens)} / ${fmtTok(primaryLimit)} · ${actualBasis}${compactionWarningActive ? L[5] : ''})`,
        ...(workspaceLabel ? [`- ${L[6]}: ${workspaceLabel}${branchName ? ` (${branchName})` : ''}`] : branchName ? [`- ${L[7]}: ${branchName}`] : []),
        `- ${L[8]}: ${tp.join(' · ')}`,
        ...(swarmSummary ? [`- Swarm: ${swarmSummary.activeCount}/${swarmSummary.totalCount} active (${swarmSummary.members.map(m => `${m.label}[${m.role}:${m.killed ? 'killed' : m.phase}]`).join(', ')})`] : []),
        '', L[14],
    ];
    return { subjectCascadeId, dataRevision, privacyMasked: masked, allowlistedFields: HANDOFF_V2_ALLOWED_FIELDS, fields, previewText: red(lines.join('\n')) };
}

// ── 3. Read-Only Compaction Recovery Brief Deduplication Tracker ─────────────

export interface CompactionRecoveryBrief {
    eventKey: string;
    cascadeId: string;
    model: string;
    role: string;
    branch: string;
    previousTokens: number | null;
    currentTokens: number | null;
    dropTokens: number | null;
    beforeTokens: number | null;
    afterTokens: number | null;
    savedTokens: number | null;
    dropPercent: number | null;
    detectedAtIso: string;
    summaryText: string;
    readonly readOnly: true;
    readonly autoInject: false;
}

export interface RecoveryBriefEvaluationInput {
    cascadeId: string | null | undefined;
    model: string | null | undefined;
    role?: 'planner' | 'executor' | 'single' | string | null;
    branch?: string | null;
    stepCount?: number | null;
    compactionEventAnchor?: string | number | null;
    previousTokens?: number | null;
    currentTokens?: number | null;
    dropTokens?: number | null;
    limitTokens?: number | null;
    compressionDetected?: boolean;
    isUndo?: boolean;
    privacyMasked?: boolean;
    redactText?: (raw: string) => string;
    lang?: 'en' | 'zh' | 'both';
    nowMs?: number;
}

function hashOpaqueBranchToken(rawBranch: string): string {
    // Deterministic non-reversible FNV-1a 64-bit hex digest (pure JS, zero Node crypto import needed)
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < rawBranch.length; i++) {
        const ch = rawBranch.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
    }
    return `br_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function buildCompactionRecoveryEventKey(parts: {
    cascadeId: string; model: string; role: string; branch: string; eventStepOrTimestamp: string | number;
}): string {
    const f = (v: unknown, d: string) => ((typeof v === 'string' ? v.trim() : (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : '')) || d).replace(/[:\r\n]+/g, '_');
    const rawBranch = (typeof parts.branch === 'string' && parts.branch.trim()) || 'main';
    // Never embed raw Git branch names into DOM-exposed event keys
    const opaqueBranch = rawBranch === 'main' || rawBranch === 'master' ? rawBranch : hashOpaqueBranchToken(rawBranch);
    return `${f(parts.cascadeId, 'none')}:${f(parts.model, 'unknown')}:${f(parts.role, 'single')}:${opaqueBranch}:${f(parts.eventStepOrTimestamp, '0')}`;
}

export function formatCompactionRecoveryBriefForPrivacy(
    brief: CompactionRecoveryBrief,
    opts?: { privacyMasked?: boolean; redactText?: (raw: string) => string; lang?: 'en' | 'zh' | 'both' },
): CompactionRecoveryBrief {
    const masked = opts?.privacyMasked === true;
    const safeBr = masked ? '[Redacted Branch]' : brief.branch;
    const dropStr = brief.dropTokens
        ? (opts?.lang === 'zh'
            ? `（减少 ${fmtTok(brief.dropTokens)}${brief.dropPercent !== null ? ` / ${brief.dropPercent}%` : ''}）`
            : ` (-${fmtTok(brief.dropTokens)}${brief.dropPercent !== null ? ` / ${brief.dropPercent}%` : ''})`)
        : '';
    const summaryRaw = opts?.lang === 'zh'
        ? `检测到上下文压缩（${brief.model} · ${brief.role} · ${safeBr}）：${fmtTok(brief.previousTokens)} → ${fmtTok(brief.currentTokens)}${dropStr}。仅只读摘要，不会自动注入。`
        : `Context compaction detected (${brief.model} · ${brief.role} · ${safeBr}): ${fmtTok(brief.previousTokens)} → ${fmtTok(brief.currentTokens)}${dropStr}. Read-only brief (never auto-injected).`;
    return {
        ...brief,
        branch: safeBr,
        summaryText: masked && opts?.redactText ? opts.redactText(summaryRaw) : summaryRaw,
    };
}

export class CompactionRecoveryBriefTracker {
    private readonly dismissed = new Set<string>();
    private readonly last = new Map<string, { tokens: number; step: number; anchor?: string }>();
    private readonly active = new Map<string, CompactionRecoveryBrief>();
    private curKey: string | null = null;

    restoreDismissedKeys(keys: unknown): void {
        if (!Array.isArray(keys)) { return; }
        for (const k of keys) { if (typeof k === 'string' && k.trim()) { this.dismissed.add(k.trim()); } }
        while (this.dismissed.size > 200) { const o = this.dismissed.values().next().value; if (!o) { break; } this.dismissed.delete(o); }
    }
    exportDismissedKeys(): string[] { return [...this.dismissed]; }
    isDismissed(k: string): boolean { return this.dismissed.has(k.trim()); }
    dismiss(k: string): boolean {
        const c = typeof k === 'string' ? k.trim() : '';
        if (!c) { return false; }
        this.dismissed.add(c);
        if (this.dismissed.size > 200) { const o = this.dismissed.values().next().value; if (o) { this.dismissed.delete(o); } }
        this.active.delete(c);
        if (this.curKey === c) { this.curKey = null; }
        return true;
    }
    getActiveBrief(cascadeId?: string | null): CompactionRecoveryBrief | null {
        if (!this.curKey || this.dismissed.has(this.curKey)) { return null; }
        const b = this.active.get(this.curKey) ?? null;
        return b && (!cascadeId || b.cascadeId === cascadeId) ? b : null;
    }
    evaluate(i: RecoveryBriefEvaluationInput): CompactionRecoveryBrief | null {
        const cid = typeof i.cascadeId === 'string' ? i.cascadeId.trim() : '';
        const model = typeof i.model === 'string' ? i.model.trim() : '';
        if (!cid || !model) { return null; }
        const role = (typeof i.role === 'string' && i.role.trim()) || 'single';
        const branch = (typeof i.branch === 'string' && i.branch.trim()) || 'main';
        const sk = `${cid}|${model}|${role}|${branch}`, prev = this.last.get(sk);
        const curTok = numOpt(i.currentTokens), step = numOpt(i.stepCount) ?? 0;
        if (i.isUndo) {
            if (curTok !== null) { this.last.set(sk, { tokens: curTok, step, anchor: prev?.anchor }); }
            return this.getActiveBrief(cid);
        }
        const prevTok = numOpt(i.previousTokens, true) ?? prev?.tokens ?? null, limit = numOpt(i.limitTokens, true) ?? 0;
        const delta = prev && curTok !== null && prev.tokens > curTok ? prev.tokens - curTok : 0;
        if (!i.compressionDetected && !(delta > 0 && (limit > 0 ? delta > limit * 0.01 : delta >= 1000))) {
            if (curTok !== null) { this.last.set(sk, { tokens: curTok, step, anchor: prev?.anchor }); }
            return this.getActiveBrief(cid);
        }
        const anchor = (i.compactionEventAnchor != null && String(i.compactionEventAnchor).trim())
            || (prev?.anchor && curTok !== null && curTok <= prev.tokens ? prev.anchor : String(step));
        const eventKey = buildCompactionRecoveryEventKey({ cascadeId: cid, model, role, branch, eventStepOrTimestamp: anchor });
        if (curTok !== null) { this.last.set(sk, { tokens: curTok, step, anchor }); }
        if (this.dismissed.has(eventKey)) { if (this.curKey === eventKey) { this.curKey = null; } return null; }
        const ex = this.active.get(eventKey);
        if (ex) { this.curKey = eventKey; return ex; }
        const dropTokens = numOpt(i.dropTokens, true) ?? (prevTok !== null && curTok !== null && prevTok > curTok ? prevTok - curTok : null);
        const dropPercent = dropTokens !== null && prevTok ? Math.round((dropTokens / prevTok) * 1000) / 10 : null;
        const safeBr = i.privacyMasked ? '[Redacted Branch]' : branch;
        const dropStr = dropTokens ? (i.lang === 'zh' ? `（减少 ${fmtTok(dropTokens)}${dropPercent !== null ? ` / ${dropPercent}%` : ''}）` : ` (-${fmtTok(dropTokens)}${dropPercent !== null ? ` / ${dropPercent}%` : ''})`) : '';
        const raw = i.lang === 'zh'
            ? `检测到上下文压缩（${model} · ${role} · ${safeBr}）：${fmtTok(prevTok)} → ${fmtTok(curTok)}${dropStr}。仅只读摘要，不会自动注入。`
            : `Context compaction detected (${model} · ${role} · ${safeBr}): ${fmtTok(prevTok)} → ${fmtTok(curTok)}${dropStr}. Read-only brief (never auto-injected).`;
        const brief: CompactionRecoveryBrief = {
            eventKey, cascadeId: cid, model, role, branch: safeBr, previousTokens: prevTok, currentTokens: curTok,
            dropTokens, beforeTokens: prevTok, afterTokens: curTok, savedTokens: dropTokens,
            dropPercent, detectedAtIso: new Date(typeof i.nowMs === 'number' && Number.isFinite(i.nowMs) ? i.nowMs : Date.now()).toISOString(),
            summaryText: i.privacyMasked && i.redactText ? i.redactText(raw) : raw, readOnly: true, autoInject: false,
        };
        this.active.set(eventKey, brief);
        this.curKey = eventKey;
        if (this.active.size > 32) { const o = this.active.keys().next().value; if (o && o !== eventKey) { this.active.delete(o); } }
        return brief;
    }
}

// ── 4. Versioned Allowlisted Settings JSON Backup & Atomic Import ────────────

export const SETTINGS_BACKUP_SCHEMA_VERSION = 1 as const;
export const SETTINGS_BACKUP_MAX_BYTES = 64 * 1024;
export const SETTINGS_INT_BOUNDS: Record<string, [number, number]> = {
    pollingInterval: [1, 60], quotaNotificationThreshold: [0, 99], calendarRetentionDays: [30, 3650],
    activityMaxRecentSteps: [10, 500], activityMaxArchives: [1, 100],
};
export const SETTINGS_ENUM_VALUES: Record<string, readonly string[]> = {
    tooltipDensity: ['auto', 'compact', 'full'], languagePreference: ['auto', 'en', 'zh', 'both'],
    contextPctBasis: ['compaction', 'native'], speedMetricMode: ['decode', 'e2e'],
    quotaWindowMode: ['5h', '7d', 'tightest'], quotaDirectionMode: ['remaining', 'used'],
    cdpOverlayFontSize: ['compact', 'normal', 'large'],
};
const BOOL_KEYS = new Set('showContext showQuota showResetCountdown showAiCredits showSpeed showCacheHit showSessionCost showModelInternalId lockToMainAgent appComposerRingEnabled appTopBarEnabled autoCheckUpdates showNativeHudBar appShowNativeHudBar ideShowNativeHudBar nativeHudAutoHideOnOverview cdpOverlayHighContrast'.split(' '));
const INT_BOUNDS = SETTINGS_INT_BOUNDS;
const ENUM_VALUES = SETTINGS_ENUM_VALUES;
const CUSTOM_VALIDATORS: Record<string, (v: unknown) => { ok: true; value: unknown } | { ok: false; error: string }> = {
    orchestratorPricingMode: validateOrchestratorPricingMode,
    displayCurrency: validateDisplayCurrency,
    subscriptionCurrency: validateSubscriptionCurrency,
    customFxRate: validateCustomFxRate,
    subscriptionPlan: validateSubscriptionPlan,
    subscriptionMonthlyFee: validateSubscriptionMonthlyFee,
};
export const PORTABLE_SETTINGS_ALLOWLIST: readonly string[] = Object.freeze([
    ...BOOL_KEYS, ...Object.keys(INT_BOUNDS), ...Object.keys(ENUM_VALUES),
    ...Object.keys(CUSTOM_VALIDATORS), 'customFxCurrency',
]);
const ALLOWLIST_SET = new Set<string>(PORTABLE_SETTINGS_ALLOWLIST);
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface SettingsBackupPayload {
    schemaVersion: 1;
    kind: 'antigravity-context-monitor-settings-backup';
    exportedAt: string;
    settings: Partial<AppSettingsWithV118>;
    customPricing?: Record<string, ValidatedModelPricing>;
}
export interface ParsedSettingsBackupSuccess {
    ok: true;
    settingsPatch: Partial<AppSettingsWithV118>;
    overlayPrefsPatch: { cdpOverlayFontSize?: CdpOverlayFontSizePreset; cdpOverlayHighContrast?: boolean };
    customPricing?: Record<string, ValidatedModelPricing>;
    appliedKeys: string[];
    strippedKeys: string[];
}
export interface ParsedSettingsBackupFailure { ok: false; error: string; strippedKeys: string[]; }
export type ParsedSettingsBackupResult = ParsedSettingsBackupSuccess | ParsedSettingsBackupFailure;

export function buildSettingsBackupJson(
    settings: Partial<AppSettingsWithV118>,
    customPricing?: Record<string, unknown> | null,
    nowMs = Date.now(),
): { payload: SettingsBackupPayload; json: string } {
    const out: Record<string, unknown> = {};
    const src = settings as Record<string, unknown>;
    for (const k of PORTABLE_SETTINGS_ALLOWLIST) {
        if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) { out[k] = src[k]; }
    }
    const res = customPricing && typeof customPricing === 'object' && !Array.isArray(customPricing) && Object.keys(customPricing).length
        ? validateCustomPricingOverrides(customPricing) : null;
    const vp = res?.ok && Object.keys(res.value).length ? res.value : undefined;
    const payload: SettingsBackupPayload = {
        schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION, kind: 'antigravity-context-monitor-settings-backup',
        exportedAt: new Date(nowMs).toISOString(), settings: out as Partial<AppSettingsWithV118>, ...(vp ? { customPricing: vp } : {}),
    };
    let json = JSON.stringify(payload, null, 2) + '\n';
    if (Buffer.byteLength(json, 'utf8') > SETTINGS_BACKUP_MAX_BYTES) {
        // Share exact 64 KiB budget with parseAndValidateSettingsBackup: switch to compact JSON if needed.
        json = JSON.stringify(payload) + '\n';
    }
    if (Buffer.byteLength(json, 'utf8') > SETTINGS_BACKUP_MAX_BYTES) {
        throw new Error(`Settings backup exceeds ${SETTINGS_BACKUP_MAX_BYTES} bytes (64 KB) export limit`);
    }
    return { payload, json };
}

function hasProtoKey(obj: unknown, d = 0): boolean {
    if (!obj || typeof obj !== 'object' || d > 8) { return false; }
    return Array.isArray(obj) ? obj.some(v => hasProtoKey(v, d + 1)) : Object.keys(obj as Record<string, unknown>).some(k => PROTO_KEYS.has(k) || hasProtoKey((obj as Record<string, unknown>)[k], d + 1));
}

export function parseAndValidateSettingsBackup(rawInput: unknown): ParsedSettingsBackupResult {
    const strippedKeys: string[] = [];
    const fail = (error: string): ParsedSettingsBackupFailure => ({ ok: false, error, strippedKeys });
    let rawStr = '';
    if (typeof rawInput === 'string') { rawStr = rawInput; }
    else if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
        try { rawStr = JSON.stringify(rawInput); } catch { return fail('Not serializable'); }
    } else { return fail('Expected JSON string or object'); }

    const bytes = Buffer.byteLength(rawStr, 'utf8');
    if (!bytes) { return fail('Empty backup'); }
    if (bytes > SETTINGS_BACKUP_MAX_BYTES) { return fail(`Exceeds ${SETTINGS_BACKUP_MAX_BYTES} bytes (64 KB)`); }

    let parsed: unknown;
    try { parsed = JSON.parse(rawStr); } catch { return fail('Invalid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return fail('Root must be object'); }
    if (hasProtoKey(parsed)) { return fail('Forbidden prototype key'); }

    const root = parsed as Record<string, unknown>;
    if (root.schemaVersion !== SETTINGS_BACKUP_SCHEMA_VERSION) { return fail('Unsupported schemaVersion (expected 1)'); }
    for (const k of Object.keys(root)) {
        if (!['schemaVersion', 'kind', 'exportedAt', 'settings', 'customPricing'].includes(k)) { strippedKeys.push(k.slice(0, 64)); }
    }

    const patch: Record<string, unknown> = {};
    const overlayPrefsPatch: ParsedSettingsBackupSuccess['overlayPrefsPatch'] = {};
    const appliedKeys: string[] = [];

    if (root.settings !== undefined) {
        if (!root.settings || typeof root.settings !== 'object' || Array.isArray(root.settings)) { return fail('"settings" must be object'); }
        for (const [k, val] of Object.entries(root.settings as Record<string, unknown>)) {
            if (!ALLOWLIST_SET.has(k)) { strippedKeys.push(k.slice(0, 64)); continue; }
            if (BOOL_KEYS.has(k)) {
                if (typeof val !== 'boolean') { return fail(`Invalid ${k}`); }
                patch[k] = val;
                if (k === 'cdpOverlayHighContrast') { overlayPrefsPatch.cdpOverlayHighContrast = val; }
            } else if (INT_BOUNDS[k]) {
                const [min, max] = INT_BOUNDS[k];
                if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) { return fail(`Invalid ${k}`); }
                patch[k] = Math.round(val);
            } else if (ENUM_VALUES[k]) {
                if (typeof val !== 'string' || !ENUM_VALUES[k].includes(val)) { return fail(`Invalid ${k}`); }
                patch[k] = val;
                if (k === 'cdpOverlayFontSize') { overlayPrefsPatch.cdpOverlayFontSize = val as CdpOverlayFontSizePreset; }
            } else if (CUSTOM_VALIDATORS[k]) {
                const v = CUSTOM_VALIDATORS[k](val);
                if (!v.ok) { return fail(v.error); }
                patch[k] = v.value;
            } else if (k === 'customFxCurrency') {
                if (val === null) { patch[k] = null; }
                else if (typeof val === 'string' && isCurrencyCode(val)) { patch[k] = normalizeCurrencyCode(val); }
                else { return fail('Invalid customFxCurrency'); }
            }
            appliedKeys.push(k);
        }
        if (patch.displayCurrency === 'USD') {
            patch.customFxRate = patch.customFxCurrency = null;
        } else if (patch.customFxRate !== undefined) {
            const targetCur = (patch.customFxCurrency ?? patch.displayCurrency) as CurrencyCode | undefined;
            if (targetCur && patch.displayCurrency && targetCur !== patch.displayCurrency) {
                patch.customFxRate = patch.customFxCurrency = null;
            } else if (targetCur) {
                Object.assign(patch, bindCustomFxRate(targetCur, patch.customFxRate as number | null));
            }
        }
    }

    let customPricing: Record<string, ValidatedModelPricing> | undefined;
    if (root.customPricing !== undefined) {
        const res = validateCustomPricingOverrides(root.customPricing);
        if (!res.ok) { return fail(res.error); }
        customPricing = res.value;
    }
    if (!appliedKeys.length && customPricing === undefined) { return fail('No valid portable settings'); }
    return {
        ok: true, settingsPatch: patch as Partial<AppSettingsWithV118>, overlayPrefsPatch,
        ...(customPricing !== undefined ? { customPricing } : {}), appliedKeys, strippedKeys,
    };
}

// ── 5. Redacted Diagnostics Export (Run-Scoped Opaque Aliases) ───────────────

const DIAG_ERR_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [/\bETIMEDOUT\b|timeout|timed\s*out/i, 'ETIMEDOUT'],
    [/\bECONNREFUSED\b|connection\s*refused/i, 'ECONNREFUSED'],
    [/\bECONNRESET\b|socket\s*hang\s*up/i, 'ECONNRESET'],
    [/\bENOENT\b|not\s*found/i, 'ENOENT'],
    [/\bEACCES\b|\bEPERM\b|permission/i, 'EPERM'],
    [/\bEBUSY\b|locked/i, 'EBUSY'],
    [/\b401\b|\b403\b|unauth|forbidden/i, 'AUTH_ERROR'],
    [/\b429\b|rate\s*limit|resource_exhausted/i, 'RATE_LIMITED'],
    [/\b5\d\d\b|internal|unavailable/i, 'UPSTREAM_5XX'],
    [/abort/i, 'ABORTED'],
];

export function sanitizeDiagnosticErrorCode(rawError: unknown): string | null {
    if (!rawError) { return null; }
    const msg = rawError instanceof Error ? `${rawError.name} ${rawError.message}` : String(rawError);
    return DIAG_ERR_PATTERNS.find(([re]) => re.test(msg))?.[1] ?? 'RUNTIME_ERROR';
}

export interface RedactedDiagnosticsInput {
    surface: 'app-sidecar' | 'ide';
    version: string;
    buildIds?: { webviewClient?: string; cdpOverlay?: string };
    nowMs?: number;
    observation?: PublishedMonitorObservation | null;
    aliasMap?: DiagnosticAliasMap;
    counters: {
        pollCount?: number;
        backendEpoch?: number;
        selectionRevision?: number;
        dataRevision?: number;
        isPaused?: boolean;
        trajectoryCount?: number;
        modelConfigCount?: number;
        accountCount?: number;
        dailyStoreDayCount?: number;
        stateFileSizeBytes?: number;
        consecutiveFailures?: number;
    };
    freshness?: {
        isStale?: boolean;
        lastSuccessAtMs?: number | null;
        staleSources?: string[];
        lastError?: unknown;
    } | null;
    selection?: {
        mode?: string;
        lockToMainAgent?: boolean;
        lockedRootId?: string | null;
        inspectedMemberId?: string | null;
        lockPendingUnavailable?: boolean;
    };
    swarm?: {
        groupCount?: number;
        totalNodes?: number;
        activeMembers?: number;
        activeRootId?: string | null;
        lastTickPolledCount?: number;
        lastTickDeferredCount?: number;
    };
    cacheTtl?: {
        ttlEstimateState?: string;
        measuredCacheState?: string;
        clockAnomaly?: string;
        idleSeconds?: number | null;
        causeKinds?: string[];
    } | null;
    quotaRunway?: Array<{
        poolKey: string;
        status: string;
        weeklyStatus?: string;
        activeHours?: number;
        activeDays?: number;
        meetsThreshold?: boolean;
    }>;
    cdp?: {
        state?: string;
        diagnosticCode?: string;
        composerEnabled?: boolean;
        topBarEnabled?: boolean;
        fontSizePreset?: CdpOverlayFontSizePreset;
        highContrast?: boolean;
    } | null;
    preferences?: Partial<AppSettingsWithV118>;
}

/**
 * Build a strictly redacted, sentinel-clean diagnostics JSON bundle using run-scoped
 * opaque aliases (`DiagnosticAliasMap`) — ZERO emails, ZERO workspace paths, ZERO tokens
 * or credentials, ZERO titles or prompts.
 */
const PUBLIC_DIAGNOSTIC_POOL_KEYS: ReadonlySet<string> = new Set([
    'gemini', 'gemini_pro', 'gemini_flash', 'gemini-pro', 'gemini-flash',
    'claude', 'claude_gpt', 'claude-gpt', 'premium', 'gpt', 'openai',
    'image', 'images', 'other', 'default', 'unknown', 'all', '5h', '7d',
]);

function sanitizeDiagnosticPoolKey(rawKey: string, unknownPoolAliases: Map<string, string>): string {
    const clean = typeof rawKey === 'string' ? rawKey.trim().toLowerCase() : '';
    if (clean && PUBLIC_DIAGNOSTIC_POOL_KEYS.has(clean)) {
        return clean;
    }
    const existing = unknownPoolAliases.get(rawKey);
    if (existing) { return existing; }
    const assigned = `pool_${unknownPoolAliases.size + 1}`;
    unknownPoolAliases.set(rawKey, assigned);
    return assigned;
}

export function buildRedactedDiagnostics(input: RedactedDiagnosticsInput): { diagnostics: Record<string, unknown>; json: string } {
    const alias = input.aliasMap ?? new DiagnosticAliasMap();
    const unknownPoolAliases = new Map<string, string>();
    const { selection: s, swarm: w, preferences: p, counters: c, freshness: f, cacheTtl: t, cdp } = input;
    const diagnostics: Record<string, unknown> = {
        schemaVersion: 1,
        kind: 'antigravity-context-monitor-redacted-diagnostics',
        exportedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
        surface: input.surface,
        version: input.version,
        buildIds: { ...(input.buildIds?.webviewClient ? { webviewClient: input.buildIds.webviewClient } : {}), ...(input.buildIds?.cdpOverlay ? { cdpOverlay: input.buildIds.cdpOverlay } : {}) },
        environment: { platform: process.platform, arch: process.arch, nodeVersion: process.version },
        counters: {
            pollCount: 0, backendEpoch: 0, selectionRevision: 0, dataRevision: 0, trajectoryCount: 0, modelConfigCount: 0,
            accountCount: 0, dailyStoreDayCount: 0, stateFileSizeBytes: 0, consecutiveFailures: 0, ...c, isPaused: Boolean(c.isPaused),
        },
        freshness: { isStale: Boolean(f?.isStale), lastSuccessAtMs: f?.lastSuccessAtMs ?? null, staleSources: f?.staleSources ? [...f.staleSources] : [], errorCode: sanitizeDiagnosticErrorCode(f?.lastError) },
        observation: input.observation ? formatObservationDiagnostic(input.observation, alias) : null,
        selection: s ? { mode: s.mode ?? 'unknown', lockToMainAgent: Boolean(s.lockToMainAgent), hasLockedRoot: Boolean(s.lockedRootId), hasInspectedMember: Boolean(s.inspectedMemberId), lockPendingUnavailable: Boolean(s.lockPendingUnavailable), rootAlias: alias.aliasConversation(s.lockedRootId), inspectedAlias: alias.aliasConversation(s.inspectedMemberId) } : null,
        swarm: w ? { groupCount: w.groupCount ?? 0, totalNodes: w.totalNodes ?? 0, activeMembers: w.activeMembers ?? 0, activeGroupAlias: alias.aliasConversation(w.activeRootId), lastTickPolledCount: w.lastTickPolledCount ?? 0, lastTickDeferredCount: w.lastTickDeferredCount ?? 0 } : null,
        cacheTtl: t ? { ttlEstimateState: t.ttlEstimateState ?? 'unknown', measuredCacheState: t.measuredCacheState ?? 'unknown', clockAnomaly: t.clockAnomaly ?? 'none', idleSeconds: t.idleSeconds ?? null, causeKinds: t.causeKinds ? [...t.causeKinds] : [] } : null,
        quotaRunway: (input.quotaRunway || []).map(({ poolKey, ...rest }) => ({ poolKey: sanitizeDiagnosticPoolKey(poolKey, unknownPoolAliases), ...rest })),
        cdp: cdp ? { state: cdp.state ?? 'disabled', diagnosticCode: cdp.diagnosticCode ?? 'disabled', composerEnabled: Boolean(cdp.composerEnabled), topBarEnabled: Boolean(cdp.topBarEnabled), fontSizePreset: normalizeCdpOverlayFontSize(cdp.fontSizePreset), highContrast: Boolean(cdp.highContrast) } : null,
        preferences: p ? { languagePreference: p.languagePreference ?? 'auto', displayCurrency: p.displayCurrency ?? 'USD', contextPctBasis: p.contextPctBasis ?? 'compaction', speedMetricMode: p.speedMetricMode ?? 'decode', quotaWindowMode: p.quotaWindowMode ?? '5h', quotaDirectionMode: p.quotaDirectionMode ?? 'remaining', nativeHudAutoHideOnOverview: p.nativeHudAutoHideOnOverview !== false, orchestratorPricingMode: p.orchestratorPricingMode ?? 'mapped' } : null,
    };
    return { diagnostics, json: JSON.stringify(diagnostics, null, 2) + '\n' };
}

/** Combine `quotaRunwayState` and auxiliary `quotaRunwayWeeklyBuckets` safely for lossless App+IDE restore/merge. */
export function combineSerializedRunwayWithWeekly(
    r: { version?: number; pools?: Record<string, unknown>; weeklyBuckets?: Record<string, unknown> } | null | undefined,
    w: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
    const hasW = isObj(w) && Object.keys(w).length > 0;
    if (!isObj(r) && !hasW) { return null; }
    const mergedW = { ...(isObj(r?.weeklyBuckets) ? r!.weeklyBuckets : {}), ...(hasW ? w! : {}) };
    return { version: 1, pools: isObj(r?.pools) ? r!.pools : {}, ...(Object.keys(mergedW).length ? { weeklyBuckets: mergedW } : {}) };
}

/** Optional runtime hook bridge registered by `extension.ts` for `webview-panel.ts` v1.18 features. */
export interface IdeV118HostHooks {
    getWeeklyQuotaRunways?: () => Record<string, WeeklyQuotaRunwayEstimate>;
    getPromptCacheTtl?: () => PromptCacheTtlEvaluation | null;
    getRecoveryBrief?: () => CompactionRecoveryBrief | null;
    dismissRecoveryBrief?: (eventKey: string) => Promise<{ ok: boolean; dismissed?: boolean; error?: string }>;
    getOverlayVisualPrefs?: () => { cdpOverlayFontSize: CdpOverlayFontSizePreset; cdpOverlayHighContrast: boolean };
    exportSettingsBackup?: () => { filename: string; content: string; schemaVersion: number; keyCount: number };
    importSettingsBackup?: (rawJson: unknown) => Promise<{
        ok: boolean;
        appliedKeys?: string[];
        strippedKeys?: string[];
        customPricingImported?: boolean;
        error?: string;
    }>;
    exportRedactedDiagnostics?: () => { filename: string; content: string; diagnostics: Record<string, unknown> };
    getCurrentObservationMeta?: () => { subjectCascadeId: string | null; dataRevision: number; rootCascadeId: string | null };
    getSwarmSummary?: () => {
        rootCascadeId?: string | null;
        rootTitle?: string | null;
        activeCount?: number;
        totalCount?: number;
        members?: Array<{ name: string; pct?: number | null; phase?: string; isInspected?: boolean }>;
    } | null;
}

let registeredIdeV118HostHooks: IdeV118HostHooks | null = null;

export function registerIdeV118HostHooks(hooks: IdeV118HostHooks | null): void {
    registeredIdeV118HostHooks = hooks;
}

export function getIdeV118HostHooks(): IdeV118HostHooks | null {
    return registeredIdeV118HostHooks;
}

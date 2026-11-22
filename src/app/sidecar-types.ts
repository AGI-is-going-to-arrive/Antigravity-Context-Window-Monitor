/**
 * Shared types for the Antigravity App native Sidecar UI plugin.
 * Pure Node/TypeScript — zero `vscode` imports so both the sidecar runtime
 * and unit tests can import this module without an IDE host.
 */

export {
    DEFAULT_APP_SETTINGS,
    SUPPORTED_DISPLAY_CURRENCIES,
    normalizeAppSettings,
    type AppSettings,
    type DisplayCurrencyCode,
    type LastUpdateCheckRecord,
    type OrchestratorPricingMode,
} from '../durable-state';

export type SidecarViewMode = 'aux' | 'sidebar' | 'standalone';

// ─── Opt-In CDP Ambient Overlay Contracts (v1.17.6) ──────────────────────────

export type CdpConnectionState = 'disabled' | 'connected' | 'cdp_unavailable' | 'error';

export interface CdpPlatformGuide {
    platform: 'darwin' | 'win32' | 'linux';
    command: string;
    en: string;
    zh: string;
}

export interface CdpStatus {
    state: CdpConnectionState;
    composerEnabled: boolean;
    topBarEnabled: boolean;
    targetUrl?: string;
    targetTitle?: string;
    lastInjectedAt?: number;
    errorMessage?: string;
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

export type CdpOverlayBridgeActionCommand = 'openPanel' | 'refresh' | 'togglePause';

export interface CdpOverlayBridgeAction {
    command: CdpOverlayBridgeActionCommand;
    source?: 'composer' | 'topbar';
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
}

export interface SidecarSnapshotQuery {
    /** Active host conversation ID (from window.sidecar.conversationId). */
    conversationId?: string;
    /** Active workspace folder URIs (from window.sidecar.getWorkspaceUris()). */
    workspaceUris?: string[];
    /** Client's previously received snapshot hash/ETag for unchanged short-circuiting. */
    etag?: string;
    /** Current view mode ('aux' | 'sidebar' | 'standalone'). */
    viewMode?: SidecarViewMode;
    /** Optional manually pinned conversation ID. */
    pinnedConversationId?: string;
    /** Whether the user enabled "Lock to Main Agent". */
    lockToMainAgent?: boolean;
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

export interface SidecarActionRequest {
    command: string;
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
    /** Optional graceful cleanup on SIGINT/SIGTERM or server shutdown. */
    dispose?(): Promise<void> | void;
}

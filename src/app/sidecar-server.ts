/**
 * Antigravity App Sidecar HTTP/API router and standalone loopback server.
 *
 * Pure Node/TypeScript — zero `vscode` imports, zero external npm dependencies.
 * Works seamlessly both inside Antigravity App's `SidecarApp` (`sidecar_sdk`)
 * and as a standalone `127.0.0.1` HTTP server with strict one-time bootstrap
 * pairing, pre-body Host/Origin/auth/Content-Type validation, scope-separated
 * capability sets, and bodyless HTTP 304 ETag caching.
 */

import * as crypto from 'crypto';
import * as http from 'http';
import { isLanguage, tBi, tBiHtml, type Language } from '../i18n-core';
import type * as net from 'net';
import { getRuntimeVersion, resolveRuntimeBuildId } from '../core/version';
import {
    generateSessionToken,
    parseOverlayConversationId,
    validateOverlayBridgeRequest,
} from './cdp-injector';
import { getHostBridgeScript, type HostBridgeOptions } from './host-bridge';
import { getThemeAdapterStyles } from './theme-adapter';
import type {
    CdpOverlayTargetTab,
    SidecarActionRequest,
    SidecarActionResponse,
    SidecarHealthResponse,
    SidecarProvider,
    SidecarRenderContext,
    SidecarSnapshotPayload,
    SidecarSnapshotQuery,
    SidecarViewMode,
} from './sidecar-types';

export const MAX_ACTION_BODY_BYTES = 512 * 1024;
export const MAX_OVERLAY_ACTION_BODY_BYTES = 16 * 1024;
export const MAX_PAIR_BODY_BYTES = 4 * 1024;
export const DEFAULT_SIDECAR_VERSION = getRuntimeVersion();
export const DEFAULT_STANDALONE_PAIRING_TTL_MS = 60_000;
export const MAX_STANDALONE_SESSIONS = 16;
export const MAX_PAIRING_FAILURES = 5;
export const MAX_WORKSPACE_URIS = 64;
export const MAX_WORKSPACE_URI_LENGTH = 4096;

const LOOPBACK_BIND_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const LOOPBACK_URL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export type SidecarAuthScope = 'sdk' | 'standalone' | 'cdp';

export type CdpAllowedOverlayCommand =
    | 'openPanel'
    | 'refresh'
    | 'togglePause'
    | 'focusConversation';

/** Backward-compatible union for `SidecarOverlayBridgeRequest`; runtime CDP enforcement strictly allows only `CDP_ALLOWED_OVERLAY_COMMANDS`. */
export type SidecarOverlayBridgeCommand =
    | CdpAllowedOverlayCommand
    | 'openSidecar'
    | 'togglePanel'
    | 'ping';

/** Minimal capability set permitted on the CDP overlay action bridge (`cdp` scope). */
export const CDP_ALLOWED_OVERLAY_COMMANDS: ReadonlySet<CdpAllowedOverlayCommand> = new Set([
    'openPanel',
    'refresh',
    'togglePause',
    'focusConversation',
]);

/** Host-privileged commands restricted strictly to Antigravity App `sdk` scope. */
export const SDK_ONLY_ACTION_COMMANDS: ReadonlySet<string> = new Set([
    'applyPluginUpdate',
    'setupCdpLauncher',
    'removeCdpLauncher',
    'revealCdpLauncher',
    'openStateFile',
    'revealStateFile',
    'readGlobalRulesFile',
    'saveGlobalRulesFile',
    'openGlobalRulesFile',
    'revealGlobalRulesFile',
    'revealPath',
    'openExternalUrl',
    'openFileInAuxPane',
    'historyAction',
    'registerWorkspaces',
    'toggleConversation',
]);

/** Standalone grants only these dashboard actions. Future SDK commands require explicit review here. */
const STANDALONE_ACTION_COMMANDS: ReadonlySet<string> = new Set([
    'ping', 'tabShown', 'refresh', 'panelReady', 'getSnapshot', 'switchTab', 'switchLanguage',
    'syncHostFocus', 'selectConversation', 'pinConversation', 'inspectMember', 'clearInspect',
    'retargetLockedRoot', 'toggleLockMain', 'toggleLockToMainAgent', 'setLockToMainAgent',
    'setPrivacyMask', 'togglePrivacyMask', 'togglePause', 'toggleNativeHud',
    'copyContextReport', 'copyHandoffPrompt', 'previewHandoffV2', 'dismissRecoveryBrief',
    'dismissAppOnboarding',
    'exportSettingsBackup', 'importSettingsBackup', 'exportRedactedDiagnostics', 'copyStatePath',
    'setOrchestratorPricingMode', 'setAppSetting', 'updateSetting', 'setConfig', 'setPanelPref',
    'setPollingInterval', 'setZoomLevel', 'updateSettings', 'updateAppSettings', 'checkForUpdates', 'recheckCdp',
    'saveCustomPricing', 'savePricing', 'updatePricingOverrides', 'resetCustomPricing', 'resetPricing',
    'selectAccount', 'removeAccountSnapshot', 'removeAccount', 'setAccountBillingDay',
    'calendarFilterSource', 'calendarSetMetric', 'calendarSetPeriod', 'calendarSetView',
    'calendarSelectDate', 'calendarJumpDate', 'calendarExportCsv', 'calendarExportJson',
    'calendarExportMarkdown', 'switchCalendarMonth', 'clearCalendarHistory', 'clearToolCatalog',
]);

/** Commands explicitly permitted to carry a `conversationId` argument. */
const CONVERSATION_TARGETED_COMMANDS: ReadonlySet<string> = new Set([
    'selectConversation',
    'pinConversation',
    'toggleConversation',
    'focusConversation',
    'syncHostFocus',
    'inspectMember',
    'retargetLockedRoot',
    'historyAction',
]);

const ALLOWED_OVERLAY_TARGET_TABS: ReadonlySet<CdpOverlayTargetTab> = new Set([
    'overview',
    'gm',
    'sessions',
    'cost',
    'models',
    'calendar',
    'accounts',
    'settings',
]);

export function isCommandAllowedForScope(scope: SidecarAuthScope, command: string): boolean {
    const clean = typeof command === 'string' ? command.trim() : '';
    if (!clean) { return false; }
    if (scope === 'cdp') {
        return CDP_ALLOWED_OVERLAY_COMMANDS.has(clean as CdpAllowedOverlayCommand);
    }
    if (scope === 'standalone') {
        return STANDALONE_ACTION_COMMANDS.has(clean);
    }
    return true;
}

export interface SidecarOverlayBridgeRequest {
    command: SidecarOverlayBridgeCommand;
    source?: 'composer' | 'topbar';
    targetTab?: CdpOverlayTargetTab;
    /** Currently focused Hub conversation ID (or null when leaving a conversation). */
    conversationId?: string | null;
    /** True when the Hub is showing a brand-new empty conversation screen before an ID exists. */
    isNewConversation?: boolean;
    /** Optional monotonic focus revision supplied by overlay focus events. */
    focusRevision?: number;
    /** Identified by the authenticated CDP grant. */
    targetId?: string;
    /** Optional Hub window identifier. */
    windowId?: string;
}

export interface SidecarOverlayBridgeOptions {
    /** 256-bit hex session token for `X-Monitor-Token` validation. */
    token?: string;
    /** Optional pinned Hub origin (e.g. `http://127.0.0.1:49999`). */
    allowedOrigin?: string;
    /** Optional custom action handler for authenticated overlay actions. */
    onAction?: (action: SidecarOverlayBridgeRequest) => Promise<SidecarActionResponse | void> | SidecarActionResponse | void;
}

export interface SidecarOverlayAwareProvider extends SidecarProvider {
    getOverlayBridgeAuth?(): { token: string; allowedOrigin?: string };
    validateOverlayBridgeAuth?(token: string, origin?: string, command?: CdpAllowedOverlayCommand): boolean;
    resolveOverlayTargetId?(token: string, origin: string, command: CdpAllowedOverlayCommand): string | undefined;
    handleOverlayAction?(action: SidecarOverlayBridgeRequest): Promise<SidecarActionResponse | void> | SidecarActionResponse | void;
}

export interface StandaloneBootstrapPairing {
    mode: 'one-time-exchange';
    code: string;
    codeSha256: string;
    singleUse: true;
    ttlMs: number;
    expiresAtMs: number;
    exchangeEndpoint: string;
    deliveryChannel: string;
}

export interface StandaloneAuthOptions {
    /** Require one-time pairing before granting access to telemetry/actions (default: true in standalone mode). */
    requirePairing?: boolean;
    /** Serve an inert empty pairing HTML shell on unpaired GET / and /full (default: true when requirePairing is true). */
    unpairedShellOnly?: boolean;
    /** Single-use bootstrap pairing contract (generated automatically if omitted). */
    bootstrapPairing?: StandaloneBootstrapPairing;
    /** Optional clock override for deterministic TTL testing. */
    now?: () => number;
    /** Optional callback fired immediately once the single-use pairing code is consumed/burned. */
    onPairingConsumed?: () => void;
}

export interface SidecarHandlerOptions {
    buildId?: string;
    /** Plugin version returned by /api/health and passed to renderHtml. */
    version?: string;
    /** True when hosted by Antigravity App's SidecarApp (injects `/preload.js`). */
    isSidecarEnv?: boolean;
    /** Optional overrides for the injected host bridge script. */
    hostBridgeOptions?: HostBridgeOptions;
    /** Optional auth & handler config for loopback `POST /api/overlay/action`. */
    overlayBridge?: SidecarOverlayBridgeOptions;
    /** Optional standalone HTTP pairing and session authentication config. */
    standaloneAuth?: StandaloneAuthOptions;
    /** Bound loopback port (set automatically by `startStandaloneServer`) for strict Host validation. */
    boundPort?: number;
}

export interface SidecarRequestContext {
    /** Transport layer: `'http'` returns bodyless 304 on ETag match; `'sdk'` returns documented 200 `{ unchanged: true, hash }`. */
    transport?: 'http' | 'sdk';
    /** Effective capability scope for the request. */
    authScope?: SidecarAuthScope;
    /** Opaque authorized subject identifier included in ETag validators. */
    authSubject?: string;
}

export interface SnapshotValidatorContext {
    authScope: SidecarAuthScope;
    authSubject: string;
    viewMode: SidecarViewMode;
    effectiveLanguage: string;
    includeHtml: boolean;
}

export interface RenderedPageResult {
    status: number;
    contentType: string;
    body: string;
    headers: Record<string, string>;
}

export type SidecarSnapshotHttpBody =
    | { unchanged: true; hash: string }
    | {
        unchanged: false;
        hash: string;
        snapshot: SidecarSnapshotPayload;
        html?: string;
    }
    | null;

export type SidecarActionHttpBody = SidecarActionResponse & {
    text?: string;
    copiedHint?: string;
    filename?: string;
    content?: string;
    mimeType?: string;
    type?: string;
};

export interface SidecarOverlayActionResult {
    status: number;
    headers: Record<string, string>;
    body?: Record<string, unknown>;
}

export interface SidecarHandler {
    renderPage(viewMode: SidecarViewMode, rawUrl?: string, windowId?: string, authScope?: SidecarAuthScope, privacyMasked?: boolean): Promise<RenderedPageResult>;
    handleSnapshotQuery(
        query: Record<string, string | string[] | undefined>,
        ifNoneMatch?: string,
        requestCtx?: SidecarRequestContext,
    ): Promise<{ status: number; headers: Record<string, string>; body: SidecarSnapshotHttpBody }>;
    handleActionPayload(
        rawBody: unknown,
        requestCtx?: SidecarRequestContext,
    ): Promise<{ status: number; body: SidecarActionHttpBody }>;
    handleOverlayAction(params: {
        method: string;
        originHeader?: string;
        tokenHeader?: string;
        rawBody?: unknown;
    }): Promise<SidecarOverlayActionResult>;
    getOverlayBridgeToken(): string;
    setOverlayAllowedOrigin(origin: string | undefined): void;
    setBoundPort(port: number): void;
    getBootstrapPairing(): StandaloneBootstrapPairing | undefined;
    getHealth(): SidecarHealthResponse & { pairingRequired?: boolean };
    handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
}

export interface StandaloneServerOptions {
    buildId?: string;
    port?: number;
    host?: string;
    version?: string;
    hostBridgeOptions?: HostBridgeOptions;
    /** @deprecated Dead `/assets/images/*` route removed in v1.18; retained as ignored option for caller compatibility. */
    imagesDir?: string;
    overlayBridge?: SidecarOverlayBridgeOptions;
    standaloneAuth?: StandaloneAuthOptions;
}

export interface StandaloneServerHandle {
    server: http.Server;
    host: string;
    port: number;
    url: string;
    overlayBridgeToken: string;
    /** Single-use bootstrap pairing contract (kept strictly in-process; never logged/printed). */
    bootstrapPairing?: StandaloneBootstrapPairing;
    /** Relative pairing exchange endpoint path (`/api/auth/pair`; `/api/pair` is also accepted). */
    pairingEndpoint?: string;
    close(): Promise<void>;
}

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Buf(value: string): Buffer {
    return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeHexEquals(aHex: string, bHex: string): boolean {
    if (!aHex || !bHex || aHex.length !== bHex.length) { return false; }
    const a = Buffer.from(aHex, 'utf8');
    const b = Buffer.from(bHex, 'utf8');
    if (a.length !== b.length) { return false; }
    return crypto.timingSafeEqual(a, b);
}

/** Deterministic canonical JSON stringification so ETag hashes are stable regardless of key order. */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(item => (item === undefined ? 'null' : stableStringify(item))).join(',') + ']';
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
}

/** Compute a strong deterministic content hash for snapshot ETag comparison. */
export function computeSnapshotHash(snapshot: unknown): string {
    let hashInput = snapshot;
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        const snapObj = snapshot as Record<string, unknown>;
        const meta = snapObj.meta;
        if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
            const { pollCount: _ignoredPollCount, ...stableMeta } = meta as Record<string, unknown>;
            hashInput = { ...snapObj, meta: stableMeta };
        }
    }
    return crypto.createHash('sha256').update(stableStringify(hashInput)).digest('hex').slice(0, 32);
}

function extractPrivacyMasked(snapshot: SidecarSnapshotPayload): boolean | null {
    const rec = snapshot as Record<string, unknown>;
    if (typeof rec.privacyMasked === 'boolean') { return rec.privacyMasked; }
    const meta = rec.meta && typeof rec.meta === 'object' ? rec.meta as Record<string, unknown> : null;
    if (meta && typeof meta.privacyMasked === 'boolean') { return meta.privacyMasked; }
    const data = rec.data && typeof rec.data === 'object' ? rec.data as Record<string, unknown> : null;
    if (data && typeof data.privacyMasked === 'boolean') { return data.privacyMasked; }
    return null;
}

function extractDataRevision(snapshot: SidecarSnapshotPayload): string | number | null {
    const rec = snapshot as Record<string, unknown>;
    if (typeof rec.dataRevision === 'number' || typeof rec.dataRevision === 'string') {
        return rec.dataRevision;
    }
    const meta = rec.meta && typeof rec.meta === 'object' ? rec.meta as Record<string, unknown> : null;
    if (meta) {
        if (typeof meta.dataRevision === 'number' || typeof meta.dataRevision === 'string') {
            return meta.dataRevision;
        }
        if (typeof meta.stateRevision === 'number' || typeof meta.stateRevision === 'string') {
            return meta.stateRevision;
        }
    }
    return null;
}

/**
 * Compute an HTTP/SDK validator ETag that binds the snapshot hash to the
 * authorized subject, viewMode, effective language, privacy mask state,
 * `includeHtml` flag, and real data revision.
 */
export function computeSnapshotValidatorEtag(
    snapshot: SidecarSnapshotPayload,
    context: SnapshotValidatorContext,
): string {
    const snapshotHash = computeSnapshotHash(snapshot);
    const privacyMasked = extractPrivacyMasked(snapshot);
    const dataRevision = extractDataRevision(snapshot);
    const effectiveLanguage = context.effectiveLanguage || (typeof snapshot.language === 'string' ? snapshot.language : '');
    const validatorInput = {
        v: 2,
        authScope: context.authScope,
        authSubject: context.authSubject,
        viewMode: context.viewMode,
        effectiveLanguage,
        privacyMasked,
        includeHtml: context.includeHtml,
        dataRevision,
        snapshotHash,
    };
    return crypto.createHash('sha256').update(stableStringify(validatorInput)).digest('hex').slice(0, 32);
}

function normalizeEtag(raw: string | undefined): string {
    if (!raw || typeof raw !== 'string') { return ''; }
    let trimmed = raw.trim();
    if (trimmed.startsWith('W/')) { trimmed = trimmed.slice(2).trim(); }
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        trimmed = trimmed.slice(1, -1);
    }
    return trimmed;
}

function matchesClientEtag(
    ifNoneMatch: string | undefined,
    queryEtag: string | undefined,
    currentHash: string,
): boolean {
    if (!currentHash) { return false; }
    const normalizedQuery = normalizeEtag(queryEtag);
    if (normalizedQuery && normalizedQuery === currentHash) {
        return true;
    }
    if (!ifNoneMatch || typeof ifNoneMatch !== 'string') {
        return false;
    }
    const trimmed = ifNoneMatch.trim();
    if (!trimmed) { return false; }
    if (trimmed === '*') { return true; }
    const parts = trimmed.split(',');
    for (const part of parts) {
        if (normalizeEtag(part) === currentHash) {
            return true;
        }
    }
    return false;
}

function firstString(value: string | string[] | undefined): string | undefined {
    if (typeof value === 'string') { return value; }
    if (Array.isArray(value) && typeof value[0] === 'string') { return value[0]; }
    return undefined;
}

function parseViewMode(raw: string | undefined, fallback: SidecarViewMode): SidecarViewMode {
    if (raw === 'aux' || raw === 'sidebar' || raw === 'standalone') {
        return raw;
    }
    return fallback;
}

function sanitizeOptionalId(raw: unknown, maxLen = 128): string | undefined {
    if (typeof raw !== 'string') { return undefined; }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > maxLen || /[\r\n\0]/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}

/**
 * Strictly validate the incoming HTTP `Host` header against loopback addresses
 * (and bound port when known) to block DNS-rebinding attacks before body reads.
 */
export function validateLoopbackHostHeader(
    hostHeader: string | string[] | undefined,
    expectedPort?: number,
): { ok: true; host: string; hostname: string; port: number | null; origin: string } | { ok: false; status: number; error: string } {
    if (typeof hostHeader !== 'string') {
        return { ok: false, status: 403, error: 'Missing or invalid Host header' };
    }
    const raw = hostHeader.trim();
    if (!raw || /[\s@/?#\\]/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) {
        return { ok: false, status: 403, error: 'Malformed Host header' };
    }
    let parsed: URL;
    try {
        parsed = new URL(`http://${raw}`);
    } catch {
        return { ok: false, status: 403, error: 'Invalid Host header' };
    }
    if (!LOOPBACK_URL_HOSTNAMES.has(parsed.hostname)) {
        return { ok: false, status: 403, error: 'Non-loopback Host header rejected' };
    }
    const parsedPort = parsed.port ? Number(parsed.port) : null;
    if (parsedPort !== null && (!Number.isSafeInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
        return { ok: false, status: 403, error: 'Invalid Host port' };
    }
    if (typeof expectedPort === 'number' && expectedPort > 0) {
        const effectivePort = parsedPort ?? 80;
        if (effectivePort !== expectedPort) {
            return { ok: false, status: 403, error: 'Host port does not match bound server port' };
        }
    }
    return {
        ok: true,
        host: raw,
        hostname: parsed.hostname,
        port: parsedPort,
        origin: parsed.origin,
    };
}

function isJsonContentType(contentTypeHeader: string | string[] | undefined): boolean {
    if (typeof contentTypeHeader !== 'string') { return false; }
    const mediaType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() || '';
    return mediaType === 'application/json';
}

function validateSameOriginHeader(params: {
    originHeader: string | string[] | undefined;
    refererHeader: string | string[] | undefined;
    secFetchSiteHeader: string | string[] | undefined;
    secFetchModeHeader: string | string[] | undefined;
    secFetchDestHeader?: string | string[] | undefined;
    expectedOrigin: string;
    isWrite: boolean;
    usesBrowserSessionHeader: boolean;
    isHtmlNavigation?: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
    const secFetchSite = typeof params.secFetchSiteHeader === 'string'
        ? params.secFetchSiteHeader.trim().toLowerCase()
        : '';
    const secFetchMode = typeof params.secFetchModeHeader === 'string'
        ? params.secFetchModeHeader.trim().toLowerCase()
        : '';
    const secFetchDest = typeof params.secFetchDestHeader === 'string'
        ? params.secFetchDestHeader.trim().toLowerCase()
        : '';

    if (params.isWrite) {
        if (secFetchSite && secFetchSite !== 'same-origin') {
            return { ok: false, status: 403, error: 'Cross-origin write rejected' };
        }
    } else if (secFetchSite) {
        // Different local ports share a site but not an origin.
        // Reject `same-site` / `cross-site` on all reads; allow `none` only for direct HTML navigations.
        const allowedReadFetchSite = params.isHtmlNavigation
            ? (secFetchSite === 'same-origin' || secFetchSite === 'none')
            : (secFetchSite === 'same-origin');
        if (!allowedReadFetchSite) {
            return { ok: false, status: 403, error: 'Cross-origin or same-site cross-port read rejected' };
        }
    }

    if (Array.isArray(params.originHeader)) {
        return { ok: false, status: 403, error: 'Multiple Origin headers rejected' };
    }
    const hasOriginHeader = params.originHeader !== undefined;
    const rawOrigin = typeof params.originHeader === 'string' ? params.originHeader.trim() : '';

    if (hasOriginHeader && !rawOrigin) {
        return { ok: false, status: 403, error: 'Empty Origin header rejected' };
    }

    if (rawOrigin) {
        if (rawOrigin === 'null') {
            return { ok: false, status: 403, error: 'Null Origin rejected' };
        }
        let parsedOrigin: URL;
        try {
            parsedOrigin = new URL(rawOrigin);
        } catch {
            return { ok: false, status: 403, error: 'Malformed Origin header' };
        }
        if ((parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:')
            || !LOOPBACK_URL_HOSTNAMES.has(parsedOrigin.hostname)
            || parsedOrigin.origin !== params.expectedOrigin) {
            return { ok: false, status: 403, error: 'Cross-origin request rejected' };
        }
    } else if (params.isWrite) {
        // Writes using the browser session header or ANY Fetch Metadata header MUST supply same-origin Origin.
        if (params.usesBrowserSessionHeader) {
            return { ok: false, status: 403, error: 'Origin header required for browser session write' };
        }
        if (secFetchMode || secFetchSite || secFetchDest) {
            return { ok: false, status: 403, error: 'Origin header required for browser write' };
        }
    }

    if (params.isWrite && typeof params.refererHeader === 'string' && params.refererHeader.trim()) {
        try {
            const parsedRef = new URL(params.refererHeader.trim());
            if (parsedRef.origin !== params.expectedOrigin) {
                return { ok: false, status: 403, error: 'Cross-origin Referer rejected' };
            }
        } catch {
            return { ok: false, status: 403, error: 'Malformed Referer header' };
        }
    }

    return { ok: true };
}

function createDefaultBootstrapPairing(nowMs: number): StandaloneBootstrapPairing {
    const code = crypto.randomBytes(32).toString('hex');
    return {
        mode: 'one-time-exchange',
        code,
        codeSha256: sha256Hex(code),
        singleUse: true,
        ttlMs: DEFAULT_STANDALONE_PAIRING_TTL_MS,
        expiresAtMs: nowMs + DEFAULT_STANDALONE_PAIRING_TTL_MS,
        exchangeEndpoint: '/api/auth/pair',
        deliveryChannel: 'in-memory',
    };
}

/**
 * Inert, zero-data HTML pairing shell served to unpaired standalone HTTP clients.
 * Contains ZERO private telemetry, ZERO account/workspace data, and ZERO tokens.
 */
export function renderStandalonePairingShellHtml(
    viewMode: SidecarViewMode,
    exchangeEndpoint = '/api/auth/pair',
    version = DEFAULT_SIDECAR_VERSION,
    language: Language = 'en',
): string {
    const safeEndpoint = exchangeEndpoint === '/api/pair' ? '/api/pair' : '/api/auth/pair';
    const safeVersion = String(version || DEFAULT_SIDECAR_VERSION).replace(/[^0-9A-Za-z._+-]/g, '');
    const label = (en: string, zh: string) => tBi(en, zh, ' / ', language);
    const visible = (en: string, zh: string) => tBiHtml(en, zh, ' / ', language);
    const pairFail = JSON.stringify(label('Pairing failed', '配对失败'));
    const sessErr = JSON.stringify(label('Session unavailable', '会话不可用'));
    return `<!DOCTYPE html><html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Antigravity Context Monitor — ${label('Pair session', '会话配对')}</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0D1014;color:#F2F4F8;display:flex;align-items:center;justify-content:center;min-height:100vh}.acm-pair-card{width:min(420px,calc(100vw - 32px));border:1px solid #232A35;border-radius:12px;padding:24px;background:#14181F;box-sizing:border-box}.acm-pair-card h1{margin:0 0 8px;font-size:17px}.acm-pair-card p{margin:0 0 16px;font-size:13px;color:#8C98A9;line-height:1.5}.acm-pair-card input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #2C3544;background:#0D1014;color:#F2F4F8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;margin-bottom:12px}.acm-pair-card button{width:100%;padding:10px 14px;border-radius:8px;border:0;background:#2258B5;color:#fff;font-weight:600;font-size:13px;cursor:pointer}.acm-pair-status{margin-top:12px;font-size:12px;min-height:18px;color:#F87171}</style></head><body data-acm-surface="app-sidecar" data-acm-view="${viewMode}" data-acm-paired="false"><main class="acm-pair-card" id="acmPairingShell"><h1>Antigravity Context Monitor</h1><p>${visible('Enter the single-use code from your private pairing file to open the dashboard.', '请输入私有配对文件中的一次性配对码以打开面板。')} (v${safeVersion})</p><form id="acmPairingForm" autocomplete="off"><label for="acmPairingCodeInput" style="display:block;font-size:12px;margin-bottom:6px;color:#C2CAD6">${visible('One-time pairing code', '一次性配对码')}</label><input id="acmPairingCodeInput" name="pairingCode" type="password" autocomplete="off" spellcheck="false" required /><button type="submit" id="acmPairingSubmit">${visible('Pair browser session', '配对此浏览器会话')}</button><div class="acm-pair-status" id="acmPairingStatus" role="status" aria-live="polite"></div></form></main><script>(function(){var f=document.getElementById('acmPairingForm'),i=document.getElementById('acmPairingCodeInput'),s=document.getElementById('acmPairingStatus'),k='acm_standalone_session';if(!f||!i)return;async function o(t){var r=await fetch(location.pathname+location.search,{mode:'same-origin',redirect:'error',credentials:'omit',headers:{'X-Monitor-Session':t}});if(!r.ok){if(r.status===401)sessionStorage.removeItem(k);throw new Error(${sessErr}+' (HTTP '+r.status+')')}var h=await r.text();document.open();document.write(h);document.close()}function e(x){if(s)s.textContent=x&&x.message?x.message:${pairFail}}try{var p=sessionStorage.getItem(k);if(p)o(p).catch(e)}catch(_){}f.addEventListener('submit',function(ev){ev.preventDefault();var c=(i.value||'').trim();if(!c)return;if(s)s.textContent='';window.fetch(${JSON.stringify(safeEndpoint)},{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({pairingCode:c})}).then(function(r){if(!r.ok)throw new Error(${pairFail}+' (HTTP '+r.status+')');return r.json()}).then(function(d){i.value='';sessionStorage.setItem(k,d.sessionToken);return o(d.sessionToken)}).catch(e)})})();</script></body></html>`;
}

function sanitizeInlineStyleTagContent(css: string): string {
    return css.replace(/<\/style/gi, (match) => `<\\/${match.slice(2)}`);
}

function sanitizeInlineScriptTagContent(js: string): string {
    return js
        .replace(/<\/script/gi, (match) => `<\\/${match.slice(2)}`)
        .replace(/<!--/g, '<\\!--');
}

/**
 * Injects Antigravity Sidecar `/preload.js` (when in sidecar mode), the
 * theme-adapter stylesheet, and the host-bridge script into an HTML document,
 * and stamps `data-acm-surface` / `data-acm-view` onto `<body>`.
 */
export function injectSidecarHeadAndScripts(
    html: string,
    opts: {
        isSidecarEnv: boolean;
        viewMode: SidecarViewMode;
        hostBridgeScript?: string;
        themeAdapterCss?: string;
    },
): string {
    let out = html;
    const themeCss = sanitizeInlineStyleTagContent(opts.themeAdapterCss ?? getThemeAdapterStyles());
    const bridgeJs = sanitizeInlineScriptTagContent(opts.hostBridgeScript ?? getHostBridgeScript());

    const headSnippets: string[] = [];
    if (opts.isSidecarEnv && !out.includes('src="/preload.js"')) {
        headSnippets.push('<script src="/preload.js"></script>');
    }
    if (!out.includes('data-acm-theme-adapter')) {
        headSnippets.push(`<style data-acm-theme-adapter="true">\n${themeCss}\n</style>`);
    }
    if (!out.includes('data-acm-host-bridge')) {
        headSnippets.push(`<script data-acm-host-bridge="true">\n${bridgeJs}\n</script>`);
    }

    if (headSnippets.length > 0) {
        const injection = headSnippets.join('\n');
        // Always use callback replacers so `$&`, `$$`, `$'`, `$`` inside minified JS/CSS
        // are inserted verbatim and can NEVER expand into `</head>` or `<body>`!
        if (/<\/head>/i.test(out)) {
            out = out.replace(/<\/head>/i, (match) => `${injection}\n${match}`);
        } else if (/<body[\s>]/i.test(out)) {
            out = out.replace(/<body([\s>])/i, (match) => `${injection}\n${match}`);
        } else {
            out = `${injection}\n${out}`;
        }
    }

    if (/<body([^>]*)>/i.test(out)) {
        out = out.replace(/<body([^>]*)>/i, (_full, attrs: string) => {
            let nextAttrs = attrs;
            if (!/data-acm-surface=/i.test(nextAttrs)) {
                nextAttrs += ' data-acm-surface="app-sidecar"';
            }
            if (!/data-acm-view=/i.test(nextAttrs)) {
                nextAttrs += ` data-acm-view="${opts.viewMode}"`;
            }
            return `<body${nextAttrs}>`;
        });
    }

    // Never serve a blank main body inside `#tab-overview` on cold boot or empty initial render.
    if (out.includes('id="monitor-content"')) {
        out = out.replace(
            /(<div\b[^>]*\bid="tab-overview"[^>]*>)(\s*(?:<div class="eoc-sentinel">[\s\S]*?<\/div>\s*)?)(<\/div>)/i,
            (_full, open: string, inner: string, close: string) => {
                const initCard = `<section class="monitor-overview" data-monitor-overview data-monitor-state="connecting" data-acm-initializing="true">`
                    + `<header class="overview-header"><h2 id="overview-heading">${tBiHtml('Context & quota', '上下文与配额')}</h2></header>`
                    + `<div class="overview-connection"><h3 class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${tBiHtml('Connecting to Antigravity', '正在连接 Antigravity')}</span></h3>`
                    + `<p class="overview-empty">${tBiHtml('Loading live context and quota telemetry…', '正在加载实时上下文与配额遥测…')}</p></div>`
                    + `</section>`;
                return `${open}\n${initCard}${inner}${close}`;
            },
        );
    }

    return out;
}

function readJsonBodyWithLimit(
    req: http.IncomingMessage,
    limitBytes: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let settled = false;

        const finish = (res: { ok: true; data: unknown } | { ok: false; status: number; error: string }) => {
            if (settled) { return; }
            settled = true;
            resolve(res);
        };

        const contentLengthHeader = req.headers['content-length'];
        if (typeof contentLengthHeader === 'string') {
            const declared = Number(contentLengthHeader);
            if (Number.isFinite(declared) && declared > limitBytes) {
                req.pause();
                finish({ ok: false, status: 413, error: `Request body exceeds ${limitBytes} byte limit` });
                return;
            }
        }

        const onData = (chunk: Buffer | string) => {
            if (settled) { return; }
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
            if (totalBytes + buf.length > limitBytes) {
                chunks.length = 0;
                req.off('data', onData);
                req.pause();
                finish({ ok: false, status: 413, error: `Request body exceeds ${limitBytes} byte limit` });
                return;
            }
            totalBytes += buf.length;
            chunks.push(buf);
        };

        req.on('data', onData);

        req.on('error', () => {
            chunks.length = 0;
            finish({ ok: false, status: 400, error: 'Failed to read request body' });
        });

        req.on('end', () => {
            if (settled) { return; }
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            chunks.length = 0;
            if (!raw) {
                finish({ ok: false, status: 400, error: 'Request body is required' });
                return;
            }
            try {
                finish({ ok: true, data: JSON.parse(raw) });
            } catch {
                finish({ ok: false, status: 400, error: 'Invalid JSON body' });
            }
        });
    });
}

function sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders: Record<string, string | string[]> = {},
): void {
    const body = JSON.stringify(payload);
    const headers: Record<string, string | string[]> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
    };
    if (status === 413) {
        headers['Connection'] = 'close';
    }
    res.writeHead(status, headers);
    res.end(body);
}

interface StandaloneSessionRecord {
    id: string;
    tokenHash: Buffer;
    createdAtMs: number;
    scope: 'standalone';
}

function sanitizeActionRequest(
    record: Record<string, unknown>,
    command: string,
    scope: SidecarAuthScope,
): { ok: true; action: SidecarActionRequest } | { ok: false; status: number; error: string } {
    const rawViewMode = typeof record.viewMode === 'string' ? record.viewMode : undefined;
    const viewMode = (rawViewMode === 'aux' || rawViewMode === 'sidebar' || rawViewMode === 'standalone')
        ? rawViewMode
        : undefined;
    const windowId = sanitizeOptionalId(record.windowId);
    if (record.windowId !== undefined && !windowId) {
        return { ok: false, status: 400, error: 'Invalid window identifier' };
    }

    if (command === 'syncHostFocus') {
        const rawConv = record.conversationId;
        let conversationId: string | null;
        if (rawConv === null) {
            conversationId = null;
        } else if (typeof rawConv === 'string') {
            const trimmed = rawConv.trim();
            conversationId = trimmed ? trimmed : null;
        } else {
            return { ok: false, status: 400, error: 'syncHostFocus requires conversationId to be string or null' };
        }

        const focusRevision = record.focusRevision;
        if (typeof focusRevision !== 'number' || !Number.isSafeInteger(focusRevision) || focusRevision < 0) {
            return { ok: false, status: 400, error: 'syncHostFocus requires non-negative integer focusRevision' };
        }

        const action: SidecarActionRequest = {
            command: 'syncHostFocus',
            conversationId,
            focusRevision,
            ...(viewMode ? { viewMode } : {}),
            ...(windowId ? { windowId } : {}),
        };
        if (scope === 'sdk') {
            if (typeof record.fromSdkCallback === 'boolean') { action.fromSdkCallback = record.fromSdkCallback; }
            if (typeof record.isFocusedPane === 'boolean') { action.isFocusedPane = record.isFocusedPane; }
        }
        if (record.backendEpoch !== undefined) {
            if (typeof record.backendEpoch !== 'number' || !Number.isSafeInteger(record.backendEpoch) || record.backendEpoch < 0) {
                return { ok: false, status: 400, error: 'Invalid backendEpoch' };
            }
            action.backendEpoch = record.backendEpoch;
        }
        const sourceInstanceId = sanitizeOptionalId(record.sourceInstanceId);
        if (sourceInstanceId) { action.sourceInstanceId = sourceInstanceId; }
        if (typeof record.conversationCleared === 'boolean') {
            action.conversationCleared = record.conversationCleared;
        }
        if (typeof record.isNewConversation === 'boolean') {
            action.isNewConversation = record.isNewConversation;
        }
        return { ok: true, action };
    }

    if (command === 'registerWorkspaces') {
        if (!Array.isArray(record.workspaceUris)) {
            return { ok: false, status: 400, error: 'registerWorkspaces requires workspaceUris array' };
        }
        if (record.workspaceUris.length > MAX_WORKSPACE_URIS) {
            return { ok: false, status: 400, error: `workspaceUris exceeds max count (${MAX_WORKSPACE_URIS})` };
        }
        const cleaned: string[] = [];
        for (const item of record.workspaceUris) {
            if (typeof item !== 'string') {
                return { ok: false, status: 400, error: 'workspaceUris entries must be strings' };
            }
            const trimmed = item.trim();
            if (!trimmed) { continue; }
            if (trimmed.length > MAX_WORKSPACE_URI_LENGTH || trimmed.includes('\0')) {
                return { ok: false, status: 400, error: 'Invalid workspace URI entry' };
            }
            cleaned.push(trimmed);
        }
        // Explicit `workspaceUris: []` is preserved so the runtime revokes all old roots.
        return {
            ok: true,
            action: {
                command: 'registerWorkspaces',
                workspaceUris: cleaned,
                ...(windowId ? { windowId } : {}),
            },
        };
    }

    if (command === 'setPrivacyMask' || command === 'togglePrivacyMask') {
        const rawMasked = record.masked ?? record.privacyMasked ?? record.value;
        if (command === 'setPrivacyMask' && typeof rawMasked !== 'boolean') {
            return { ok: false, status: 400, error: 'setPrivacyMask requires boolean masked' };
        }
        if (command === 'togglePrivacyMask' && rawMasked !== undefined && typeof rawMasked !== 'boolean') {
            return { ok: false, status: 400, error: 'togglePrivacyMask masked must be boolean when provided' };
        }
        return {
            ok: true,
            action: {
                command,
                ...(typeof rawMasked === 'boolean' ? { masked: rawMasked, privacyMasked: rawMasked } : {}),
                ...(viewMode ? { viewMode } : {}),
                ...(windowId ? { windowId } : {}),
            },
        };
    }

    // Generic commands: strip unauthorized cross-command focus & workspace side-effect fields!
    const sanitized: Record<string, unknown> = { ...record, command, ...(windowId ? { windowId } : {}) };
    delete sanitized.workspaceUris;
    delete sanitized.focusRevision;
    delete sanitized.conversationCleared;
    delete sanitized.isNewConversation;
    if (!CONVERSATION_TARGETED_COMMANDS.has(command)) {
        delete sanitized.conversationId;
    }
    return { ok: true, action: sanitized as SidecarActionRequest };
}

/**
 * Create the unified HTTP & SidecarApp router bound to a `SidecarProvider`.
 */
export function createSidecarHandler(
    provider: SidecarOverlayAwareProvider,
    options: SidecarHandlerOptions = {},
): SidecarHandler {
    const startedAtMs = Date.now();
    const version = options.version || provider.version || DEFAULT_SIDECAR_VERSION;
    const isSidecarEnv = options.isSidecarEnv ?? Boolean(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT);
    const buildId = resolveRuntimeBuildId({ explicitBuildId: options.buildId, explicitVersion: version });
    const cachedThemeCss = getThemeAdapterStyles();
    const cachedBridgeJs = getHostBridgeScript(options.hostBridgeOptions);
    const fallbackOverlayToken = options.overlayBridge?.token && options.overlayBridge.token.length >= 32
        ? options.overlayBridge.token
        : generateSessionToken();
    let explicitAllowedOrigin = options.overlayBridge?.allowedOrigin;
    let boundPort = typeof options.boundPort === 'number' && options.boundPort > 0 ? options.boundPort : 0;

    // Standalone one-time pairing & in-memory session store (fail-closed by default outside SDK).
    const nowFn = options.standaloneAuth?.now ?? (() => Date.now());
    const requirePairing = !isSidecarEnv && (options.standaloneAuth?.requirePairing ?? true);
    const unpairedShellOnly = requirePairing && (options.standaloneAuth?.unpairedShellOnly ?? true);
    const bootstrapPairing: StandaloneBootstrapPairing | undefined = requirePairing
        ? (options.standaloneAuth?.bootstrapPairing
            ? { ...options.standaloneAuth.bootstrapPairing }
            : createDefaultBootstrapPairing(nowFn()))
        : undefined;
    const expectedPairingSha256 = bootstrapPairing
        ? (bootstrapPairing.codeSha256 || sha256Hex(bootstrapPairing.code))
        : '';
    let pairingUsed = false;
    let pairingFailedAttempts = 0;
    const activeSessions = new Map<string, StandaloneSessionRecord>();

    function setBoundPort(port: number): void {
        if (Number.isSafeInteger(port) && port > 0 && port <= 65535) {
            boundPort = port;
        }
    }

    function getBootstrapPairing(): StandaloneBootstrapPairing | undefined {
        return bootstrapPairing ? { ...bootstrapPairing } : undefined;
    }

    function getOverlayBridgeToken(): string {
        if (options.overlayBridge?.token && options.overlayBridge.token.length >= 32) {
            return options.overlayBridge.token;
        }
        const providerToken = provider.getOverlayBridgeAuth?.().token;
        if (providerToken && providerToken.length >= 32) {
            return providerToken;
        }
        return fallbackOverlayToken;
    }

    function getOverlayAllowedOrigin(): string | undefined {
        return explicitAllowedOrigin ?? provider.getOverlayBridgeAuth?.().allowedOrigin;
    }

    function setOverlayAllowedOrigin(origin: string | undefined): void {
        explicitAllowedOrigin = origin;
    }

    function authorizeOverlayRequest(params: {
        originHeader: string | undefined;
        tokenHeader: string | undefined;
        isPreflight: boolean;
    }): { ok: true; status: 200; origin: string } | { ok: false; status: number; error: string } {
        const hasExplicitTokenOverride = Boolean(options.overlayBridge?.token && options.overlayBridge.token.length >= 32);
        if (!hasExplicitTokenOverride && typeof provider.validateOverlayBridgeAuth === 'function') {
            // Validate Origin syntax & loopback first
            const originCheck = validateOverlayBridgeRequest({
                originHeader: params.originHeader,
                tokenHeader: undefined,
                expectedToken: fallbackOverlayToken,
                allowedOrigin: explicitAllowedOrigin,
                isPreflight: true,
            });
            if (!originCheck.ok || !originCheck.origin) {
                return { ok: false, status: originCheck.status, error: originCheck.error || 'Forbidden Origin' };
            }
            if (params.isPreflight) {
                return { ok: true, status: 200, origin: originCheck.origin };
            }
            const provided = typeof params.tokenHeader === 'string' ? params.tokenHeader.trim() : '';
            if (!provided) {
                return { ok: false, status: 401, error: 'Invalid or missing X-Monitor-Token' };
            }
            let valid = false;
            try {
                valid = Boolean(provider.validateOverlayBridgeAuth(provided, originCheck.origin));
            } catch {
                valid = false;
            }
            if (!valid) {
                return { ok: false, status: 401, error: 'Invalid or revoked overlay bridge token or origin' };
            }
            return { ok: true, status: 200, origin: originCheck.origin };
        }

        const check = validateOverlayBridgeRequest({
            originHeader: params.originHeader,
            tokenHeader: params.tokenHeader,
            expectedToken: getOverlayBridgeToken(),
            allowedOrigin: getOverlayAllowedOrigin(),
            isPreflight: params.isPreflight,
        });
        if (!check.ok || !check.origin) {
            return { ok: false, status: check.status, error: check.error || 'Unauthorized' };
        }
        return { ok: true, status: 200, origin: check.origin };
    }

    function authenticateStandaloneHttp(req: http.IncomingMessage): {
        authenticated: boolean;
        sessionId: string;
        authMethod: 'none' | 'bearer' | 'header';
    } {
        if (!requirePairing) {
            return { authenticated: true, sessionId: isSidecarEnv ? 'sdk' : 'standalone-open', authMethod: 'none' };
        }
        const candidates: Array<{ token: string; method: 'bearer' | 'header' }> = [];

        const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
        if (/^Bearer\s+\S+$/i.test(authHeader)) {
            const token = authHeader.replace(/^Bearer\s+/i, '').trim();
            if (token) { candidates.push({ token, method: 'bearer' }); }
        }
        const sessionHdr = typeof req.headers['x-monitor-session'] === 'string'
            ? req.headers['x-monitor-session'].trim()
            : '';
        if (sessionHdr) {
            candidates.push({ token: sessionHdr, method: 'header' });
        }
        for (const cand of candidates) {
            const candHash = sha256Buf(cand.token);
            for (const rec of activeSessions.values()) {
                if (rec.tokenHash.length === candHash.length && crypto.timingSafeEqual(rec.tokenHash, candHash)) {
                    return { authenticated: true, sessionId: rec.id, authMethod: cand.method };
                }
            }
        }
        return { authenticated: false, sessionId: '', authMethod: 'none' };
    }

    async function renderPage(
        viewMode: SidecarViewMode,
        rawUrl = '/',
        windowId?: string,
        authScope?: SidecarAuthScope,
        privacyMasked?: boolean,
    ): Promise<RenderedPageResult> {
        const parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
        const rawLang = parsedUrl.searchParams.get('lang') || undefined;
        const lang = (rawLang === 'en' || rawLang === 'zh' || rawLang === 'both') ? rawLang : undefined;
        const effectiveMasked = typeof privacyMasked === 'boolean' ? privacyMasked : (!windowId ? true : undefined);
        // GET / and /full are strictly read-only projections: NEVER forward conversationId or workspaceUris from URL.
        const ctx: SidecarRenderContext = {
            viewMode,
            pathname: parsedUrl.pathname,
            ...(windowId ? { windowId } : {}),
            ...(authScope ? { authScope } : {}),
            ...(typeof effectiveMasked === 'boolean' ? { privacyMasked: effectiveMasked } : {}),
            ...(lang ? { lang } : {}),
            isSidecarEnv,
            version,
        };
        const rawHtml = await provider.renderHtml(ctx);
        const body = injectSidecarHeadAndScripts(rawHtml, {
            isSidecarEnv,
            viewMode,
            themeAdapterCss: cachedThemeCss,
            hostBridgeScript: cachedBridgeJs,
        });
        return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body,
            headers: {
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        };
    }

    async function handleSnapshotQuery(
        query: Record<string, string | string[] | undefined>,
        ifNoneMatch?: string,
        requestCtx: SidecarRequestContext = {},
    ): Promise<{ status: number; headers: Record<string, string>; body: SidecarSnapshotHttpBody }> {
        const transport = requestCtx.transport ?? (isSidecarEnv ? 'sdk' : 'http');
        const authScope: SidecarAuthScope = requestCtx.authScope ?? (isSidecarEnv ? 'sdk' : 'standalone');
        const authSubject = requestCtx.authSubject ?? (authScope === 'sdk' ? 'sdk' : 'standalone');

        const queryEtag = firstString(query.etag);
        const clientEtag = normalizeEtag(queryEtag || ifNoneMatch);
        const rawView = firstString(query.viewMode) || firstString(query.view);
        const viewMode = parseViewMode(rawView, isSidecarEnv ? 'aux' : 'standalone');
        const rawLang = firstString(query.lang);
        const lang = (rawLang === 'en' || rawLang === 'zh' || rawLang === 'both') ? rawLang : undefined;
        const includeHtml = firstString(query.includeHtml) === 'true' || firstString(query.includeHtml) === '1';
        const rawActive = firstString(query.active);
        const userActive = rawActive === '1' || rawActive === 'true';
        const windowId = sanitizeOptionalId(firstString(query.windowId));

        // Strictly read-only GET /api/snapshot contract:
        // NEVER extract or forward conversationId, workspaceUris, pinnedConversationId,
        // lockToMainAgent, conversationCleared, or isNewConversation on GET!
        const snapshotQuery: SidecarSnapshotQuery & {
            lang?: 'en' | 'zh' | 'both';
            includeHtml?: boolean;
            windowId?: string;
            authScope?: SidecarAuthScope;
        } = {
            ...(clientEtag ? { etag: clientEtag } : {}),
            viewMode,
            ...(lang ? { lang } : {}),
            ...(includeHtml ? { includeHtml: true } : {}),
            ...(windowId ? { windowId } : {}),
            ...(userActive ? { userActive: true } : {}),
            authScope,
        };

        const providerSnapshot = await provider.getSnapshot(snapshotQuery);
        const { html: snapshotHtml, ...snapshot } = providerSnapshot;
        const effectiveLanguage = lang || (typeof snapshot.language === 'string' ? snapshot.language : '');
        const hash = computeSnapshotValidatorEtag(includeHtml ? providerSnapshot : snapshot, {
            authScope,
            authSubject,
            viewMode,
            effectiveLanguage,
            includeHtml,
        });
        const headers: Record<string, string> = {
            'ETag': `"${hash}"`,
            'Cache-Control': 'no-store',
            'Vary': 'Origin, X-Monitor-Session, Authorization',
        };

        if (matchesClientEtag(ifNoneMatch, queryEtag, hash)) {
            if (transport === 'http') {
                return {
                    status: 304,
                    headers,
                    body: null,
                };
            }
            return {
                status: 200,
                headers,
                body: { unchanged: true, hash },
            };
        }

        let html = includeHtml && typeof snapshotHtml === 'string'
            ? injectSidecarHeadAndScripts(snapshotHtml, { isSidecarEnv, viewMode, themeAdapterCss: cachedThemeCss, hostBridgeScript: cachedBridgeJs })
            : undefined;
        if (includeHtml && html === undefined) {
            const qs = new URLSearchParams();
            if (lang) { qs.set('lang', lang); }
            const pagePath = viewMode === 'sidebar' ? '/full' : '/';
            const pageUrl = qs.toString() ? `${pagePath}?${qs.toString()}` : pagePath;
            const rendered = await renderPage(viewMode, pageUrl, windowId, authScope);
            html = rendered.body;
        }
        return {
            status: 200,
            headers,
            body: {
                unchanged: false,
                hash,
                snapshot,
                ...(html !== undefined ? { html } : {}),
            },
        };
    }

    async function handleActionPayload(
        rawBody: unknown,
        requestCtx: SidecarRequestContext = {},
    ): Promise<{ status: number; body: SidecarActionHttpBody }> {
        if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
            return { status: 400, body: { ok: false, error: 'Action payload must be a JSON object' } };
        }
        const record = rawBody as Record<string, unknown>;
        const command = typeof record.command === 'string' ? record.command.trim() : '';
        if (!command || command.length > 128) {
            return { status: 400, body: { ok: false, error: 'Missing or invalid action command' } };
        }

        const authScope: SidecarAuthScope = requestCtx.authScope ?? (isSidecarEnv ? 'sdk' : 'standalone');
        const authSubject = requestCtx.authSubject ?? (authScope === 'sdk' ? 'sdk' : 'standalone');

        if (!isCommandAllowedForScope(authScope, command)) {
            return {
                status: 403,
                body: { ok: false, error: `Command "${command}" is not permitted for ${authScope} capability scope` },
            };
        }

        const validated = sanitizeActionRequest(record, command, authScope);
        if (!validated.ok) {
            return { status: validated.status, body: { ok: false, error: validated.error } };
        }

        const viewMode = parseViewMode(
            typeof validated.action.viewMode === 'string' ? validated.action.viewMode : undefined,
            isSidecarEnv ? 'aux' : 'standalone',
        );

        try {
            const response = await provider.handleAction(validated.action) as SidecarActionHttpBody | undefined;
            // Always derive the subject/view/language/privacy-bound validator ETag so POST and GET
            // produce identical ETag validators (never let an unwrapped provider hash break binding).
            const computedHash = response?.snapshot !== undefined
                ? computeSnapshotValidatorEtag(response.snapshot, {
                    authScope,
                    authSubject,
                    viewMode,
                    effectiveLanguage: typeof response.snapshot.language === 'string' ? response.snapshot.language : '',
                    includeHtml: false,
                })
                : undefined;

            const sanitized: SidecarActionHttpBody = {
                ok: Boolean(response?.ok),
                ...(typeof response?.type === 'string' ? { type: response.type } : {}),
                ...(response?.result !== undefined ? { result: response.result } : {}),
                ...(typeof response?.text === 'string' ? { text: response.text } : {}),
                ...(typeof response?.copiedHint === 'string' ? { copiedHint: response.copiedHint } : {}),
                ...(typeof response?.filename === 'string' ? { filename: response.filename } : {}),
                ...(typeof response?.content === 'string' ? { content: response.content } : {}),
                ...(typeof response?.mimeType === 'string' ? { mimeType: response.mimeType } : {}),
                ...(Array.isArray(response?.messages) ? { messages: response.messages } : {}),
                ...(response?.reload ? { reload: true } : {}),
                ...(response?.snapshot !== undefined
                    ? {
                        snapshot: response.snapshot,
                        hash: computedHash,
                    }
                    : {}),
                ...(typeof response?.error === 'string' && response.error
                    ? { error: response.error }
                    : {}),
            };
            const explicitStatus = typeof response?.statusCode === 'number'
                && response.statusCode >= 200 && response.statusCode <= 599
                ? response.statusCode
                : (sanitized.ok ? 200 : 400);
            return { status: explicitStatus, body: sanitized };
        } catch {
            // Never leak raw Error stacks or internal file paths over HTTP
            return { status: 500, body: { ok: false, error: 'Internal action error' } };
        }
    }

    function buildOverlayCorsHeaders(origin: string | undefined): Record<string, string> {
        if (!origin) { return {}; }
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Monitor-Token',
            'Vary': 'Origin',
        };
    }

    async function handleOverlayAction(params: {
        method: string;
        originHeader?: string;
        tokenHeader?: string;
        rawBody?: unknown;
    }): Promise<SidecarOverlayActionResult> {
        const method = (params.method || 'GET').toUpperCase();

        if (method === 'OPTIONS') {
            const check = authorizeOverlayRequest({
                originHeader: params.originHeader,
                tokenHeader: params.tokenHeader,
                isPreflight: true,
            });
            if (!check.ok) {
                return { status: check.status, headers: {}, body: { ok: false, error: check.error } };
            }
            return {
                status: 204,
                headers: {
                    ...buildOverlayCorsHeaders(check.origin),
                    'Access-Control-Max-Age': '300',
                },
            };
        }

        if (method !== 'POST') {
            return { status: 405, headers: {}, body: { ok: false, error: 'Method Not Allowed' } };
        }

        const check = authorizeOverlayRequest({
            originHeader: params.originHeader,
            tokenHeader: params.tokenHeader,
            isPreflight: false,
        });
        if (!check.ok) {
            return { status: check.status, headers: {}, body: { ok: false, error: check.error } };
        }

        const corsHeaders = buildOverlayCorsHeaders(check.origin);
        if (!params.rawBody || typeof params.rawBody !== 'object' || Array.isArray(params.rawBody)) {
            return { status: 400, headers: corsHeaders, body: { ok: false, error: 'Invalid overlay action payload' } };
        }
        const rec = params.rawBody as Record<string, unknown>;
        const rawCmdStr = typeof rec.command === 'string' ? rec.command.trim() : '';
        if (!rawCmdStr || rawCmdStr.length > 128) {
            return { status: 400, headers: corsHeaders, body: { ok: false, error: 'Missing or invalid overlay command' } };
        }
        if (!isCommandAllowedForScope('cdp', rawCmdStr)) {
            return {
                status: 403,
                headers: corsHeaders,
                body: { ok: false, error: 'Command not permitted for cdp capability scope' },
            };
        }
        const rawCmd = rawCmdStr as CdpAllowedOverlayCommand;
        const token = params.tokenHeader?.trim() || '';
        const usesProviderGrant = !options.overlayBridge?.token && Boolean(provider.validateOverlayBridgeAuth);
        if (usesProviderGrant && !provider.validateOverlayBridgeAuth?.(token, check.origin, rawCmd)) {
            return { status: 403, headers: corsHeaders, body: { ok: false, error: 'Command not permitted by overlay grant' } };
        }
        const targetId = usesProviderGrant ? provider.resolveOverlayTargetId?.(token, check.origin, rawCmd) : undefined;
        const source = rec.source === 'composer' || rec.source === 'topbar' ? rec.source : undefined;
        const rawTargetTab = typeof rec.targetTab === 'string' ? rec.targetTab.trim() as CdpOverlayTargetTab : undefined;
        const targetTab = rawTargetTab && ALLOWED_OVERLAY_TARGET_TABS.has(rawTargetTab) ? rawTargetTab : undefined;
        const rawConvId = rawCmd === 'focusConversation' ? parseOverlayConversationId(rec.conversationId) : undefined;
        const isNewConversation = rawCmd === 'focusConversation' && rec.isNewConversation === true;
        const focusRevision = rawCmd === 'focusConversation' && typeof rec.focusRevision === 'number'
            && Number.isSafeInteger(rec.focusRevision) && rec.focusRevision >= 0 ? rec.focusRevision : undefined;
        if (rawCmd === 'focusConversation' && (
            (rawConvId === undefined && (rec.conversationId !== undefined || !isNewConversation))
            || (rec.focusRevision !== undefined && focusRevision === undefined)
        )) {
            return { status: 400, headers: corsHeaders, body: { ok: false, error: 'Invalid conversation focus payload' } };
        }

        const overlayReq: SidecarOverlayBridgeRequest = {
            command: rawCmd,
            source,
            ...(targetTab ? { targetTab } : {}),
            ...(rawConvId !== undefined ? { conversationId: rawConvId } : {}),
            ...(isNewConversation ? { isNewConversation: true } : {}),
            ...(focusRevision !== undefined ? { focusRevision } : {}),
            ...(targetId ? { targetId } : {}),
        };

        try {
            const customHandler = options.overlayBridge?.onAction
                ?? (typeof provider.handleOverlayAction === 'function' ? (r: SidecarOverlayBridgeRequest) => provider.handleOverlayAction!(r) : null);
            if (customHandler) {
                const res = await customHandler(overlayReq);
                if (res && typeof res === 'object') {
                    return {
                        status: res.ok === false ? (res.statusCode || 400) : 200,
                        headers: corsHeaders,
                        body: { ok: res.ok !== false, command: rawCmd, ...(res.result !== undefined ? { result: res.result } : {}), ...(res.error ? { error: res.error } : {}) },
                    };
                }
                return { status: 200, headers: corsHeaders, body: { ok: true, command: rawCmd } };
            }
            if (rawCmd === 'refresh' || rawCmd === 'togglePause') {
                const actionRes = await provider.handleAction({ command: rawCmd, source });
                return {
                    status: actionRes?.ok === false ? (actionRes.statusCode || 400) : 200,
                    headers: corsHeaders,
                    body: { ok: actionRes?.ok !== false, command: rawCmd, ...(actionRes?.result !== undefined ? { result: actionRes.result } : {}) },
                };
            }
            return { status: 200, headers: corsHeaders, body: { ok: true, command: rawCmd, result: { acknowledged: true, command: rawCmd } } };
        } catch {
            return { status: 500, headers: corsHeaders, body: { ok: false, error: 'Overlay action failed' } };
        }
    }

    function getHealth(): SidecarHealthResponse & { pairingRequired?: boolean } {
        return {
            ok: true,
            version,
            surface: 'app-sidecar',
            buildId,
            pid: process.pid,
            mode: isSidecarEnv ? 'sidecar' : 'standalone',
            uptimeMs: Math.max(0, Date.now() - startedAtMs),
            ...(requirePairing ? { pairingRequired: true } : {}),
        };
    }

    async function handleStandalonePairHttp(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        expectedOrigin: string,
    ): Promise<void> {
        if (!requirePairing || !bootstrapPairing) {
            sendJson(res, 404, { ok: false, error: 'Pairing endpoint not enabled' });
            return;
        }
        const originCheck = validateSameOriginHeader({
            originHeader: req.headers.origin,
            refererHeader: req.headers.referer,
            secFetchSiteHeader: req.headers['sec-fetch-site'],
            secFetchModeHeader: req.headers['sec-fetch-mode'],
            secFetchDestHeader: req.headers['sec-fetch-dest'],
            expectedOrigin,
            isWrite: true,
            usesBrowserSessionHeader: false,
        });
        if (!originCheck.ok) {
            sendJson(res, originCheck.status, { ok: false, error: originCheck.error });
            return;
        }
        if (!isJsonContentType(req.headers['content-type'])) {
            sendJson(res, 415, { ok: false, error: 'Content-Type must be application/json' });
            return;
        }

        const parsed = await readJsonBodyWithLimit(req, MAX_PAIR_BODY_BYTES);
        if (!parsed.ok) {
            sendJson(res, parsed.status, { ok: false, error: parsed.error });
            return;
        }
        if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
            sendJson(res, 400, { ok: false, error: 'Pairing payload must be a JSON object' });
            return;
        }
        const rec = parsed.data as Record<string, unknown>;
        const rawCode = typeof rec.pairingCode === 'string'
            ? rec.pairingCode
            : (typeof rec.pairingToken === 'string'
                ? rec.pairingToken
                : (typeof rec.code === 'string' ? rec.code : ''));
        const candidateCode = rawCode.trim();
        if (!candidateCode) {
            sendJson(res, 400, { ok: false, error: 'Missing pairing code' });
            return;
        }

        const nowMs = nowFn();
        const isExpired = nowMs > bootstrapPairing.expiresAtMs;
        const matches = !pairingUsed
            && !isExpired
            && expectedPairingSha256.length > 0
            && constantTimeHexEquals(sha256Hex(candidateCode), expectedPairingSha256);

        if (!matches) {
            if (!pairingUsed && !isExpired) {
                pairingFailedAttempts += 1;
                if (pairingFailedAttempts >= MAX_PAIRING_FAILURES) {
                    pairingUsed = true;
                    bootstrapPairing.code = '';
                    try { options.standaloneAuth?.onPairingConsumed?.(); } catch { /* ignore */ }
                }
            }
            sendJson(res, 401, { ok: false, error: 'Invalid, expired, or already used pairing code' });
            return;
        }

        // Immediately burn the single-use pairing code before minting session credentials.
        pairingUsed = true;
        bootstrapPairing.code = '';
        try { options.standaloneAuth?.onPairingConsumed?.(); } catch { /* ignore */ }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionId = `sess-${crypto.randomBytes(8).toString('hex')}`;
        if (activeSessions.size >= MAX_STANDALONE_SESSIONS) {
            const oldestKey = activeSessions.keys().next().value;
            if (oldestKey !== undefined) {
                activeSessions.delete(oldestKey);
            }
        }
        activeSessions.set(sessionId, {
            id: sessionId,
            tokenHash: sha256Buf(sessionToken),
            createdAtMs: nowMs,
            scope: 'standalone',
        });

        sendJson(res, 200, {
            ok: true,
            paired: true,
            sessionId,
            sessionToken,
        }, {
            'Pragma': 'no-cache',
        });
    }

    async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const method = (req.method || 'GET').toUpperCase();

        // 1. Validate bound loopback Host BEFORE route dispatch or reading any body (DNS-rebinding defense)
        const effectiveExpectedPort = boundPort > 0
            ? boundPort
            : (typeof req.socket?.localPort === 'number' && req.socket.localPort > 0 ? req.socket.localPort : undefined);
        const hostCheck = validateLoopbackHostHeader(req.headers.host, effectiveExpectedPort);
        if (!hostCheck.ok) {
            sendJson(res, hostCheck.status, { ok: false, error: hostCheck.error });
            return;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(req.url || '/', hostCheck.origin);
        } catch {
            sendJson(res, 400, { ok: false, error: 'Invalid request URL' });
            return;
        }
        const pathname = parsedUrl.pathname;

        const checkOrigin = (opts: { isWrite: boolean; usesBrowserSessionHeader?: boolean; isHtmlNavigation?: boolean }) => {
            const c = validateSameOriginHeader({
                originHeader: req.headers.origin,
                refererHeader: req.headers.referer,
                secFetchSiteHeader: req.headers['sec-fetch-site'],
                secFetchModeHeader: req.headers['sec-fetch-mode'],
                secFetchDestHeader: req.headers['sec-fetch-dest'],
                expectedOrigin: hostCheck.origin,
                isWrite: opts.isWrite,
                usesBrowserSessionHeader: Boolean(opts.usesBrowserSessionHeader),
                isHtmlNavigation: opts.isHtmlNavigation,
            });
            if (!c.ok) { sendJson(res, c.status, { ok: false, error: c.error }); return false; }
            return true;
        };

        try {
            if (pathname === '/api/auth/pair' || pathname === '/api/pair') {
                if (method !== 'POST') { sendJson(res, 405, { ok: false, error: 'Method Not Allowed' }); return; }
                await handleStandalonePairHttp(req, res, hostCheck.origin);
                return;
            }

            if (pathname === '/' || pathname === '/full') {
                if (method !== 'GET' && method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'Method Not Allowed' }); return; }
                if (!checkOrigin({ isWrite: false, isHtmlNavigation: true })) { return; }
                const viewMode: SidecarViewMode = pathname === '/full' ? 'sidebar' : (isSidecarEnv ? 'aux' : 'standalone');
                const auth = authenticateStandaloneHttp(req);
                if (requirePairing && !auth.authenticated) {
                    if (req.headers['x-monitor-session'] || req.headers.authorization) { sendJson(res, 401, { ok: false, error: 'Session expired' }); return; }
                    if (unpairedShellOnly) {
                        const requestedLang = parsedUrl.searchParams.get('lang');
                        const lang = isLanguage(requestedLang) ? requestedLang : (/^zh(?:-|,|;|$)/i.test(req.headers['accept-language'] || '') ? 'zh' : 'en');
                        const shell = renderStandalonePairingShellHtml(viewMode, bootstrapPairing?.exchangeEndpoint || '/api/auth/pair', version, lang);
                        res.writeHead(200, {
                            'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
                            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
                        });
                        res.end(method === 'HEAD' ? undefined : shell);
                        return;
                    }
                    sendJson(res, 401, { ok: false, error: 'Authentication required' });
                    return;
                }
                const rendered = await renderPage(viewMode, req.url || pathname);
                res.writeHead(rendered.status, {
                    'Content-Type': rendered.contentType, ...rendered.headers,
                    ...(isSidecarEnv ? {} : { 'X-Frame-Options': 'SAMEORIGIN' }),
                });
                res.end(method === 'HEAD' ? undefined : rendered.body);
                return;
            }

            if (pathname === '/api/health') {
                if (method !== 'GET' && method !== 'HEAD') { sendJson(res, 405, { ok: false, error: 'Method Not Allowed' }); return; }
                if (!checkOrigin({ isWrite: false })) { return; }
                if (method === 'HEAD') {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                    res.end();
                    return;
                }
                sendJson(res, 200, getHealth());
                return;
            }

            if (pathname === '/api/snapshot') {
                if (method !== 'GET') { sendJson(res, 405, { ok: false, error: 'Method Not Allowed' }); return; }
                if (!checkOrigin({ isWrite: false })) { return; }
                const auth = authenticateStandaloneHttp(req);
                if (!auth.authenticated) { sendJson(res, 401, { ok: false, error: 'Authentication required' }); return; }
                const query: Record<string, string> = {};
                parsedUrl.searchParams.forEach((v, k) => { query[k] = v; });
                const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : undefined;
                const result = await handleSnapshotQuery(query, ifNoneMatch, { transport: 'http', authScope: isSidecarEnv ? 'sdk' : 'standalone', authSubject: auth.sessionId });
                if (result.status === 304) {
                    res.writeHead(304, { 'X-Content-Type-Options': 'nosniff', ...result.headers });
                    res.end();
                    return;
                }
                sendJson(res, result.status, result.body, result.headers);
                return;
            }

            if (pathname === '/api/action') {
                if (method !== 'POST') { sendJson(res, 405, { ok: false, error: 'Method Not Allowed' }); return; }
                const auth = authenticateStandaloneHttp(req);
                if (!checkOrigin({ isWrite: true, usesBrowserSessionHeader: auth.authMethod === 'header' })) { return; }
                if (!auth.authenticated) { sendJson(res, 401, { ok: false, error: 'Authentication required' }); return; }
                if (!isJsonContentType(req.headers['content-type'])) { sendJson(res, 415, { ok: false, error: 'Content-Type must be application/json' }); return; }
                const parsed = await readJsonBodyWithLimit(req, MAX_ACTION_BODY_BYTES);
                if (!parsed.ok) { sendJson(res, parsed.status, { ok: false, error: parsed.error }); return; }
                const result = await handleActionPayload(parsed.data, { transport: 'http', authScope: isSidecarEnv ? 'sdk' : 'standalone', authSubject: auth.sessionId });
                sendJson(res, result.status, result.body);
                return;
            }

            if (pathname === '/api/overlay/action') {
                const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
                const tokenHeader = typeof req.headers['x-monitor-token'] === 'string'
                    ? req.headers['x-monitor-token']
                    : undefined;
                if (method === 'OPTIONS') {
                    const preflight = await handleOverlayAction({ method, originHeader, tokenHeader });
                    if (preflight.status === 204) {
                        res.writeHead(204, preflight.headers);
                        res.end();
                    } else {
                        sendJson(res, preflight.status, preflight.body || { ok: false, error: 'Forbidden' }, preflight.headers);
                    }
                    return;
                }
                if (method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
                    return;
                }
                // Validate Origin + X-Monitor-Token + Content-Type BEFORE reading body!
                const authCheck = authorizeOverlayRequest({
                    originHeader,
                    tokenHeader,
                    isPreflight: false,
                });
                if (!authCheck.ok) {
                    sendJson(res, authCheck.status, { ok: false, error: authCheck.error });
                    return;
                }
                if (!isJsonContentType(req.headers['content-type'])) {
                    sendJson(
                        res,
                        415,
                        { ok: false, error: 'Content-Type must be application/json' },
                        buildOverlayCorsHeaders(authCheck.origin),
                    );
                    return;
                }
                const parsed = await readJsonBodyWithLimit(req, MAX_OVERLAY_ACTION_BODY_BYTES);
                if (!parsed.ok) {
                    sendJson(res, parsed.status, { ok: false, error: parsed.error }, buildOverlayCorsHeaders(authCheck.origin));
                    return;
                }
                const result = await handleOverlayAction({
                    method,
                    originHeader,
                    tokenHeader,
                    rawBody: parsed.data,
                });
                sendJson(res, result.status, result.body || { ok: true }, result.headers);
                return;
            }

            sendJson(res, 404, { ok: false, error: 'Not Found' });
        } catch {
            sendJson(res, 500, { ok: false, error: 'Internal Server Error' });
        }
    }

    return {
        renderPage,
        handleSnapshotQuery,
        handleActionPayload,
        handleOverlayAction,
        getOverlayBridgeToken,
        setOverlayAllowedOrigin,
        setBoundPort,
        getBootstrapPairing,
        getHealth,
        handleHttp,
    };
}

/**
 * Starts a loopback-only HTTP server (`127.0.0.1`) for standalone testing,
 * headless Chromium verification, or local development outside Antigravity App.
 * Enforces one-time bootstrap pairing by default (`standaloneAuth.requirePairing = true`).
 */
export async function startStandaloneServer(
    provider: SidecarOverlayAwareProvider,
    options: StandaloneServerOptions = {},
): Promise<StandaloneServerHandle> {
    const host = options.host || '127.0.0.1';
    if (!LOOPBACK_BIND_HOSTS.has(host)) {
        throw new Error(`Refusing to bind sidecar standalone server to non-loopback host: ${host}`);
    }
    const port = typeof options.port === 'number' ? options.port : 0;
    const handler = createSidecarHandler(provider, {
        version: options.version,
        buildId: options.buildId,
        isSidecarEnv: false,
        hostBridgeOptions: options.hostBridgeOptions,
        overlayBridge: options.overlayBridge,
        standaloneAuth: options.standaloneAuth,
    });

    const server = http.createServer((req, res) => {
        void handler.handleHttp(req, res);
    });

    const activeSockets = new Set<net.Socket>();
    server.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => { activeSockets.delete(socket); });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const addr = server.address();
    const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
    handler.setBoundPort(resolvedPort);
    (provider as { setListeningPort?: (p: number) => void }).setListeningPort?.(resolvedPort);
    const urlHost = host === '::1' ? '[::1]' : host;

    let closePromise: Promise<void> | null = null;
    const close = (): Promise<void> => {
        if (closePromise) { return closePromise; }
        closePromise = (async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                        reject(err);
                        return;
                    }
                    resolve();
                });
                if (typeof server.closeIdleConnections === 'function') {
                    server.closeIdleConnections();
                }
                for (const socket of activeSockets) {
                    socket.destroy();
                }
                activeSockets.clear();
            });
            await Promise.resolve(provider.dispose?.());
        })();
        return closePromise;
    };

    const bootstrapPairing = handler.getBootstrapPairing();

    return {
        server,
        host,
        port: resolvedPort,
        url: `http://${urlHost}:${resolvedPort}`,
        overlayBridgeToken: handler.getOverlayBridgeToken(),
        ...(bootstrapPairing ? {
            bootstrapPairing,
            pairingEndpoint: bootstrapPairing.exchangeEndpoint || '/api/auth/pair',
        } : {}),
        close,
    };
}

/**
 * Clean fallback provider used when the full compiled runtime provider
 * (`sidecar-runtime.js`) is not yet wired in. Supports health, snapshot ETag
 * polling, focus/workspace separation, privacy mask state, and safe basic actions.
 */
export function createFallbackSidecarProvider(
    options: { version?: string } = {},
): SidecarProvider {
    const version = options.version || DEFAULT_SIDECAR_VERSION;
    let paused = false;
    let language: 'zh' | 'en' | 'both' = 'both';
    let privacyMasked = true;
    let refreshCount = 0;
    let activeConversationId: string | null = null;
    let ackFocusRevision = 0;
    let registeredWorkspaces: string[] = [];
    let dataRevision = 1;

    function formatUtcClock(): string {
        const now = new Date();
        return now.toISOString().slice(11, 19);
    }

    function buildSnapshot(query: SidecarSnapshotQuery): SidecarSnapshotPayload {
        return {
            time: formatUtcClock(),
            language,
            paused,
            privacyMasked,
            activeConversationId,
            conversations: [],
            tabs: {
                overview: `<section class="acm-fallback-card"><h2>Antigravity Context Monitor</h2><p>Sidecar runtime ready (v${version}). Waiting for telemetry provider binding.</p></section>`,
            },
            meta: {
                fallback: true,
                refreshCount,
                dataRevision,
                privacyMasked,
                workspaceCount: registeredWorkspaces.length,
                viewMode: query.viewMode || 'aux',
            },
        };
    }

    return {
        version,
        renderHtml(ctx: SidecarRenderContext): string {
            const title = ctx.viewMode === 'sidebar' ? 'Antigravity Context Monitor — Sidebar' : 'Antigravity Context Monitor';
            return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--ed-bg,#0D1014);color:var(--ed-ink,#F2F4F8)}.acm-shell{padding:16px;max-width:960px;margin:0 auto}.acm-fallback-card{border:1px solid var(--ed-border,#232A35);border-radius:10px;padding:16px;background:var(--ed-surface,#14181F)}.acm-fallback-card h2{margin:0 0 8px;font-size:16px}.acm-fallback-card p{margin:0;color:var(--ed-ink-muted,#8C98A9);font-size:13px}</style></head><body data-lang="${language}" data-privacy-default="true" data-privacy-masked="${String(privacyMasked)}"><main class="acm-shell" id="monitor-content"><div class="tab-pane active" id="tab-overview"><section class="acm-fallback-card"><h2>Antigravity Context Monitor</h2><p>Sidecar surface initialized (v${version}, view: ${ctx.viewMode}).</p></section></div></main></body></html>`;
        },
        getSnapshot(query: SidecarSnapshotQuery): SidecarSnapshotPayload {
            return buildSnapshot(query);
        },
        handleAction(action: SidecarActionRequest): SidecarActionResponse {
            switch (action.command) {
                case 'ping':
                    return { ok: true, result: { pong: true, version } };
                case 'refresh':
                    refreshCount += 1;
                    dataRevision += 1;
                    return { ok: true, snapshot: buildSnapshot({}) };
                case 'togglePause':
                    paused = !paused;
                    dataRevision += 1;
                    return {
                        ok: true,
                        result: { paused },
                        messages: [{ command: 'setPaused', paused }],
                    };
                case 'syncHostFocus': {
                    const rev = typeof action.focusRevision === 'number' ? action.focusRevision : 0;
                    if (rev >= ackFocusRevision) {
                        ackFocusRevision = rev;
                        activeConversationId = typeof action.conversationId === 'string' && action.conversationId
                            ? action.conversationId
                            : null;
                        dataRevision += 1;
                    }
                    return {
                        ok: true,
                        result: {
                            accepted: rev >= ackFocusRevision,
                            ackFocusRevision,
                            backendEpoch: 1,
                        },
                        snapshot: buildSnapshot({}),
                    };
                }
                case 'registerWorkspaces': {
                    registeredWorkspaces = Array.isArray(action.workspaceUris)
                        ? action.workspaceUris.filter((u): u is string => typeof u === 'string' && u.length > 0)
                        : [];
                    dataRevision += 1;
                    return {
                        ok: true,
                        result: { workspaceUris: [...registeredWorkspaces] },
                    };
                }
                case 'setPrivacyMask':
                case 'togglePrivacyMask': {
                    const nextMasked = typeof action.masked === 'boolean'
                        ? action.masked
                        : !privacyMasked;
                    privacyMasked = nextMasked;
                    dataRevision += 1;
                    return {
                        ok: true,
                        result: { command: 'privacyMaskState', masked: privacyMasked, privacyMasked },
                        messages: [{ command: 'privacyMaskState', masked: privacyMasked, privacyMasked }],
                        snapshot: buildSnapshot({}),
                    };
                }
                case 'switchLanguage': {
                    const lang = action.lang;
                    if (lang !== 'zh' && lang !== 'en' && lang !== 'both') {
                        return { ok: false, statusCode: 400, error: 'Invalid language' };
                    }
                    language = lang;
                    dataRevision += 1;
                    return { ok: true, result: { language }, reload: true };
                }
                default:
                    return { ok: false, statusCode: 400, error: `Unknown action: ${action.command}` };
            }
        },
    };
}

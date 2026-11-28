/**
 * Opt-In CDP Ambient Overlay Injector & Pure-Node RFC 6455 WebSocket Client.
 *
 * Critical Compliance & Security Guarantees:
 * - ZERO modification of Antigravity App binaries, `app.asar`, `Info.plist`, or `codesign`.
 * - Strictly opt-in: both `appComposerRingEnabled` and `appTopBarEnabled` default to `false`.
 *   While disabled, performs zero CDP discovery, zero socket connections, and zero script evaluations.
 * - Zero external npm dependencies (uses Node built-ins only: `http`, `net`, `crypto`, `fs`, `os`, `path`).
 * - Strictly loopback-only (`127.0.0.1` / `localhost` / `::1`) for CDP discovery, target filtering,
 *   WebSocket attachment, and the authenticated overlay action bridge (256-bit `X-Monitor-Token` +
 *   strict `Origin` validation).
 */

import * as crypto from 'crypto';
import * as http from 'http';
import type * as net from 'net';
import {
    discoverDevToolsActivePort,
    isAuthorizedCdpBrowserSession,
    isCdpWebSocketAtPort,
    inspectAntigravityHostProcessAsync,
    resolveDevToolsActivePortPaths,
    type DevToolsActivePortInfo,
    type HostProcessInspectionResult,
} from './cdp-discovery';
export {
    isAuthorizedCdpBrowserSession,
    discoverDevToolsActivePort,
    inspectAntigravityHostProcess,
    inspectAntigravityHostProcessAsync,
    parseAntigravityHostCommandLine,
    parseDevToolsActivePortContent,
    resolveDevToolsActivePortPaths,
    type DevToolsActivePortInfo,
    type DevToolsPortDiscoveryOptions,
    type HostProcessInspectionResult,
    type InspectHostProcessOptions,
    type InspectHostProcessAsyncOptions,
    type ProcessTableEntry,
} from './cdp-discovery';
import { getSafeCdpLaunchCommand, inspectCdpLauncher } from './cdp-launcher';
import {
    CDP_OVERLAY_BUILD_ID,
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    safeJsonForScript,
    buildOverlayUpdateScript,
} from './cdp-overlay-assets';
import type {
    CdpConnectionState,
    CdpDiagnosticCode,
    CdpLauncherStatus,
    CdpFocusAck,
    CdpOverlayBridgeAction,
    CdpOverlayBridgeActionCommand,
    CdpOverlayPayload,
    CdpOverlayTargetTab,
    CdpOverlayToggles,
    CdpPlatformGuide,
    CdpStatus,
} from './sidecar-types';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_TARGETS_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BRIDGE_BODY_BYTES = 16 * 1024;
const DEFAULT_CDP_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_BACKOFF_MS = 15_000;
const DEFAULT_FAST_RECOVER_BACKOFF_MS = 2_500;
const WINDOWS_HOST_PROBE_TTL_MS = 30_000;

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ALLOWED_BRIDGE_COMMANDS = new Set<CdpOverlayBridgeActionCommand>([
    'openPanel',
    'refresh',
    'togglePause',
    'focusConversation',
]);
/** Aligned with `SAFE_CASCADE_ID_RE` in `sidecar-runtime.ts` (accepts UUIDs and safe cascade IDs; rejects HTML/control chars). */
const OVERLAY_CONVERSATION_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/;

/**
 * Full 5-tab + legacy alias CDP `openPanel` target tab allowlist (D2, §5.1).
 * Covers all 5 primary tabs, topbar Settings/About entries, and every historical tab ID/alias.
 */
export type CdpOverlayTargetTabAlias =
    | CdpOverlayTargetTab
    | 'gmdata'
    | 'gm-data'
    | 'activity'
    | 'chats'
    | 'chat-history'
    | 'usage'
    | 'pricing'
    | 'profile'
    | 'account'
    | 'about';

export const ALLOWED_OVERLAY_TARGET_TABS: ReadonlySet<CdpOverlayTargetTabAlias> = new Set<CdpOverlayTargetTabAlias>([
    'overview',
    'gm',
    'gmdata',
    'gm-data',
    'activity',
    'sessions',
    'chats',
    'chat-history',
    'usage',
    'cost',
    'pricing',
    'calendar',
    'models',
    'profile',
    'account',
    'accounts',
    'settings',
    'about',
]);

export function parseOverlayTargetTab(raw: unknown): CdpOverlayTargetTabAlias | undefined {
    if (typeof raw !== 'string') { return undefined; }
    const normalized = raw.trim().toLowerCase() as CdpOverlayTargetTabAlias;
    return ALLOWED_OVERLAY_TARGET_TABS.has(normalized) ? normalized : undefined;
}

export function parseOverlayConversationId(raw: unknown): string | null | undefined {
    if (raw === null) { return null; }
    if (typeof raw !== 'string') { return undefined; }
    const trimmed = raw.trim();
    return OVERLAY_CONVERSATION_ID_RE.test(trimmed) ? trimmed : undefined;
}

/**
 * Concise, zero-patch launch instructions for opting into Chromium's documented
 * `--remote-debugging-port=0` flag across macOS, Windows, and Linux.
 */
export function getCdpPlatformGuide(platform: NodeJS.Platform = process.platform): CdpPlatformGuide {
    const command = getSafeCdpLaunchCommand(platform);
    if (platform === 'darwin') {
        return {
            platform: 'darwin',
            command,
            en: `Recommended: create the zero-patch CDP-badged Persistent Launcher (/Applications/Antigravity (CDP).app, fallback ~/Applications/Antigravity (CDP).app) via Settings or \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\`. To pin it, drag "Antigravity (CDP).app" from Finder into your Dock — NEVER right-click the running Antigravity icon to choose "Keep in Dock" (that saves argless Antigravity.app). Or quit Antigravity App (Cmd+Q), wait ~5s for background shutdown (until the Dock dot disappears — running \`open -a\` during teardown silently drops \`--args\`), and run \`${command}\`. Auto-updates restart without CLI flags.`,
            zh: `推荐：在设置中一键创建带 CDP 角标的零侵入持久化启动器（优先 /Applications/Antigravity (CDP).app，无权限回退 ~/Applications/Antigravity (CDP).app，或运行 \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\`）。固定程序坞时请直接从访达将「Antigravity (CDP).app」拖入程序坞，切勿右键运行中的图标选「在程序坞中保留」（否则会保存无参原版 Antigravity.app）。若手动启动，请先按 Cmd+Q 退出并等待约 5 秒后台清理完成（待程序坞指示灯消失，否则 open -a 会静默丢弃 --args），再执行 \`${command}\`。自动更新重启后需再次通过启动器或带参命令启动。`,
        };
    }
    if (platform === 'win32') {
        return {
            platform: 'win32',
            command,
            en: `Recommended: create the zero-patch Persistent Launcher shortcuts (OneDrive-aware Desktop & Start Menu, pointing directly to Antigravity.exe --remote-debugging-port=0 with native right-click "Pin to taskbar" and zero CMD flash) via Settings or \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\`. Or close all Antigravity windows and tray processes first, then launch in PowerShell with \`${command}\` (or CMD / shortcut target: \`"%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0\`). Auto-updates restart without CLI flags.`,
            zh: `推荐：在设置中一键创建直连 Antigravity.exe --remote-debugging-port=0 的桌面（兼容 OneDrive）与开始菜单持久化快捷方式（支持原生右键「固定到任务栏」、无黑框闪烁；请勿直接右键运行中的任务栏图标固定；或运行 \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\`）。若手动启动，请先完全退出 Antigravity（含托盘进程），再在 PowerShell 运行 \`${command}\`（或 CMD / 快捷方式目标 \`"%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0\`）。自动更新重启后需重新带参启动。`,
        };
    }
    return {
        platform: 'linux',
        command,
        en: `Recommended: create the zero-patch Persistent Launcher (~/.local/share/applications/antigravity-cdp.desktop) via Settings or \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\`. On Ubuntu, pin "Antigravity (CDP)" from Show Apps / Application Launcher ("Pin to Dash" / "Add to Favorites") — avoid pinning the running Dock icon directly (StartupWMClass=Antigravity merges with the argless system entry). Or close all running Antigravity instances first, then launch with \`${command}\`. Auto-updates restart without CLI flags.`,
        zh: `推荐：在设置中一键创建零侵入持久化启动入口（~/.local/share/applications/antigravity-cdp.desktop，或运行 \`node scripts/install-app-plugin.mjs --setup-cdp-launcher\`）。Ubuntu 固定停靠栏时，请在「显示应用」菜单中搜索「Antigravity (CDP)」并选「固定到停靠栏 / 添加到收藏夹」，勿右键运行中的窗口图标固定（因 StartupWMClass=Antigravity 会与无参原版合并）。若手动启动，请先完全退出正在运行的 Antigravity，再运行 \`${command}\`。自动更新重启后需重新带参启动。`,
    };
}

// ─── Loopback & Hub Target Validation ────────────────────────────────────────

export interface CdpTargetInfo {
    id?: string;
    type?: string;
    title?: string;
    url?: string;
    webSocketDebuggerUrl?: string;
}

export function isLoopbackHostname(hostname: string): boolean {
    const clean = hostname.trim().toLowerCase();
    return LOOPBACK_HOSTNAMES.has(clean);
}

export function isLoopbackUrl(rawUrl: string, allowedProtocols: readonly string[] = ['http:', 'https:', 'ws:', 'wss:']): boolean {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) { return false; }
    try {
        const parsed = new URL(rawUrl.trim());
        if (!allowedProtocols.includes(parsed.protocol)) { return false; }
        if (parsed.username || parsed.password) { return false; }
        return isLoopbackHostname(parsed.hostname);
    } catch {
        return false;
    }
}

function parseSidecarWebPort(env: NodeJS.ProcessEnv = process.env): number[] {
    const ports: number[] = [];
    for (const raw of [env.ANTIGRAVITY_SIDECAR_WEB_PORT, env.ANTIGRAVITY_SIDECAR_PORT]) {
        if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) { continue; }
        const port = Number(raw.trim());
        if (Number.isSafeInteger(port) && port >= 1 && port <= 65535 && !ports.includes(port)) {
            ports.push(port);
        }
    }
    return ports;
}

function isExcludedSidecarOrDevToolsTitle(titleLower: string, isHttps = false): boolean {
    if (!titleLower) { return false; }
    if (titleLower.includes('devtools')) { return true; }
    // Antigravity Hub pages on https://127.0.0.1:<port>/ embed the active workspace or
    // conversation name in their title (e.g. "Swarm Fix - antigravity context monitor - Antigravity").
    // Never self-exclude a real HTTPS Hub window because of its workspace/conversation title.
    if (isHttps && (
        titleLower === 'antigravity'
        || titleLower.endsWith(' - antigravity')
        || titleLower.includes('jetski web')
        || titleLower === 'jetski'
    )) {
        return false;
    }
    return titleLower.includes('antigravity context monitor')
        || titleLower.includes('antigravity monitor')
        || titleLower.includes('antigravity 监控面板')
        || /\bswarm\b/i.test(titleLower);
}

export interface CdpBrowserVersionInfo {
    Browser?: string;
    'User-Agent'?: string;
    webSocketDebuggerUrl?: string;
}

/**
 * Select ALL positively identified Antigravity Hub target pages from CDP `/json/list` targets,
 * ordered highest-confidence first.
 *
 * Security guarantee:
 * - Requires POSITIVE Antigravity / Jetski Hub identification — NEVER score-selects an
 *   unidentified loopback page (e.g. a local dev server, notebook, or unrelated Electron page).
 * - Excludes unrelated websites, DevTools pages, extensions, `plugin://` targets, and sidecar views.
 */
export function selectAntigravityHubTargets(
    targets: readonly CdpTargetInfo[],
    options: { excludePorts?: readonly number[]; env?: NodeJS.ProcessEnv } = {},
): CdpTargetInfo[] {
    const excluded = new Set(options.excludePorts ?? []);
    for (const ownPort of parseSidecarWebPort(options.env ?? process.env)) {
        excluded.add(ownPort);
    }

    const scored: Array<{ target: CdpTargetInfo; score: number }> = [];
    const seenKeys = new Set<string>();

    for (const target of targets) {
        if (!target || target.type !== 'page') { continue; }
        if (!target.webSocketDebuggerUrl || !isLoopbackUrl(target.webSocketDebuggerUrl, ['ws:'])) {
            continue;
        }
        if (!target.url || /^plugin:\/\//i.test(target.url.trim()) || !isLoopbackUrl(target.url, ['http:', 'https:'])) {
            continue;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(target.url);
        } catch {
            continue;
        }

        const port = parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);
        if (excluded.has(port)) { continue; }

        const pathname = parsedUrl.pathname || '/';
        // Never attach to sidecar API/full views or DevTools endpoints
        if (pathname.startsWith('/api/') || pathname === '/full') { continue; }

        const isHttps = parsedUrl.protocol === 'https:';
        const titleLower = (target.title || '').trim().toLowerCase();
        if (isExcludedSidecarOrDevToolsTitle(titleLower, isHttps)) {
            continue;
        }

        const isRootPath = pathname === '/' || pathname === '/index.html' || pathname.startsWith('/hub');
        const hasAgyTitle = titleLower === 'antigravity'
            || titleLower.endsWith(' - antigravity')
            || titleLower.includes('antigravity hub')
            || (isHttps && titleLower.includes('antigravity'));
        const isJetskiTitle = titleLower.includes('jetski web') || titleLower === 'jetski';

        // Positive Hub identification required: NEVER fall back to an unidentified loopback page!
        if (!hasAgyTitle && !isJetskiTitle) {
            continue;
        }

        let score: number;
        if (hasAgyTitle && isRootPath) {
            score = 100;
        } else if (isJetskiTitle && isRootPath) {
            score = 95;
        } else if (hasAgyTitle) {
            score = 75;
        } else {
            score = 70;
        }

        // Antigravity 2.33+ Desktop Hub serves over https://127.0.0.1:<port>/,
        // whereas sidecars use http://127.0.0.1:<port>/ or plugin://.
        if (isHttps) {
            score += 40;
        }

        const dedupKey = (target.id && target.id.trim()) || target.webSocketDebuggerUrl;
        if (seenKeys.has(dedupKey)) { continue; }
        seenKeys.add(dedupKey);
        scored.push({ target, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map(entry => entry.target);
}

/**
 * Select the highest-confidence positively identified Antigravity Hub target page from CDP `/json/list` targets.
 * Guarantees unrelated websites, unidentified loopback pages, DevTools pages, extensions, and sidecar views are NEVER touched.
 */
export function selectAntigravityHubTarget(
    targets: readonly CdpTargetInfo[],
    options: { excludePorts?: readonly number[]; env?: NodeJS.ProcessEnv } = {},
): CdpTargetInfo | null {
    return selectAntigravityHubTargets(targets, options)[0] ?? null;
}

function fetchCdpJsonFromHost<T>(hostname: string, port: number, reqPath: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
            reject(new Error(`Invalid CDP port: ${port}`));
            return;
        }
        let settled = false;
        const finish = (err: Error | null, data?: T) => {
            if (settled) { return; }
            settled = true;
            if (err) { reject(err); } else { resolve(data as T); }
        };
        const req = http.request({
            hostname,
            port,
            path: reqPath,
            method: 'GET',
            timeout: timeoutMs,
        }, (res) => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                finish(new Error(`CDP ${reqPath} returned HTTP ${res.statusCode ?? 'unknown'}`));
                return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (chunk: Buffer | string) => {
                const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                total += buf.length;
                if (total > MAX_TARGETS_BODY_BYTES) {
                    req.destroy();
                    finish(new Error(`CDP ${reqPath} response exceeded size cap`));
                    return;
                }
                chunks.push(buf);
            });
            res.on('error', (err) => finish(err));
            res.on('end', () => {
                try {
                    finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
                } catch {
                    finish(new Error(`Failed to parse CDP ${reqPath} JSON`));
                }
            });
        });
        req.on('error', (err) => finish(err));
        req.on('timeout', () => {
            req.destroy();
            finish(new Error(`CDP ${reqPath} timed out`));
        });
        req.end();
    });
}

/**
 * Fetch CDP `/json/version` metadata from loopback to positively verify browser-session ownership.
 */
export async function fetchCdpBrowserVersion(
    port: number,
    timeoutMs = 2_000,
    options: { hosts?: readonly string[] } = {},
): Promise<CdpBrowserVersionInfo | null> {
    const hosts = options.hosts && options.hosts.length > 0 ? options.hosts : ['127.0.0.1', '::1'];
    for (let i = 0; i < hosts.length; i++) {
        try {
            const parsed = await fetchCdpJsonFromHost<unknown>(hosts[i], port, '/json/version', timeoutMs);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as CdpBrowserVersionInfo;
            }
            return null;
        } catch (err) {
            if (i + 1 < hosts.length && isConnectionRefusedError(err)) {
                continue;
            }
            return null;
        }
    }
    return null;
}

function fetchCdpTargetsFromHost(hostname: string, port: number, timeoutMs: number): Promise<CdpTargetInfo[]> {
    return new Promise((resolve, reject) => {
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
            reject(new Error(`Invalid CDP port: ${port}`));
            return;
        }

        let settled = false;
        const finish = (err: Error | null, targets?: CdpTargetInfo[]) => {
            if (settled) { return; }
            settled = true;
            if (err) { reject(err); } else { resolve(targets || []); }
        };

        const req = http.request({
            hostname,
            port,
            path: '/json/list',
            method: 'GET',
            timeout: timeoutMs,
        }, (res) => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                finish(new Error(`CDP /json/list returned HTTP ${res.statusCode ?? 'unknown'}`));
                return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (chunk: Buffer | string) => {
                const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                total += buf.length;
                if (total > MAX_TARGETS_BODY_BYTES) {
                    req.destroy();
                    finish(new Error('CDP /json/list response exceeded size cap'));
                    return;
                }
                chunks.push(buf);
            });
            res.on('error', (err) => finish(err));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (!Array.isArray(parsed)) {
                        finish(new Error('CDP /json/list payload is not an array'));
                        return;
                    }
                    finish(null, parsed as CdpTargetInfo[]);
                } catch {
                    finish(new Error('Failed to parse CDP /json/list JSON'));
                }
            });
        });

        req.on('error', (err) => finish(err));
        req.on('timeout', () => {
            req.destroy();
            finish(new Error('CDP /json/list timed out'));
        });
        req.end();
    });
}

function isConnectionRefusedError(err: unknown): boolean {
    if (!err || typeof err !== 'object') { return false; }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED') { return true; }
    const msg = err instanceof Error ? err.message : String(err);
    return /ECONNREFUSED/i.test(msg);
}

/**
 * Fetch the CDP target list from `http://127.0.0.1:<port>/json/list`,
 * falling back to IPv6 loopback `http://[::1]:<port>/json/list` if IPv4 returns `ECONNREFUSED`.
 */
export async function fetchCdpTargets(
    port: number,
    timeoutMs = 3_000,
    options: { hosts?: readonly string[] } = {},
): Promise<CdpTargetInfo[]> {
    const hosts = options.hosts && options.hosts.length > 0 ? options.hosts : ['127.0.0.1', '::1'];
    let lastErr: unknown;
    for (let i = 0; i < hosts.length; i++) {
        try {
            return await fetchCdpTargetsFromHost(hosts[i], port, timeoutMs);
        } catch (err) {
            lastErr = err;
            if (i + 1 < hosts.length && isConnectionRefusedError(err)) {
                continue;
            }
            throw err;
        }
    }
    throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'Failed to fetch CDP targets')));
}

// ─── Pure-Node RFC 6455 WebSocket Framing & CDP Client ───────────────────────

export const WS_OPCODE = {
    CONTINUATION: 0x0,
    TEXT: 0x1,
    BINARY: 0x2,
    CLOSE: 0x8,
    PING: 0x9,
    PONG: 0xa,
} as const;

export interface DecodedWebSocketMessage {
    opcode: number;
    payload: Buffer;
}

export function computeWebSocketAcceptKey(secWebSocketKey: string): string {
    return crypto.createHash('sha1').update(`${secWebSocketKey}${WS_MAGIC_GUID}`).digest('base64');
}

/**
 * Encode a single RFC 6455 WebSocket frame.
 * Client-to-server frames MUST set `mask: true` (default).
 */
export function encodeWebSocketFrame(options: {
    opcode: number;
    payload?: Buffer;
    fin?: boolean;
    mask?: boolean;
    maskKey?: Buffer;
}): Buffer {
    const fin = options.fin !== false;
    const mask = options.mask !== false;
    const payload = options.payload ?? Buffer.alloc(0);
    const len = payload.length;

    let headerLen = 2;
    if (len >= 126 && len <= 0xffff) {
        headerLen += 2;
    } else if (len > 0xffff) {
        headerLen += 8;
    }
    const maskLen = mask ? 4 : 0;
    const out = Buffer.allocUnsafe(headerLen + maskLen + len);

    out[0] = (fin ? 0x80 : 0x00) | (options.opcode & 0x0f);
    const maskBit = mask ? 0x80 : 0x00;
    let offset = 2;
    if (len < 126) {
        out[1] = maskBit | len;
    } else if (len <= 0xffff) {
        out[1] = maskBit | 126;
        out.writeUInt16BE(len, 2);
        offset = 4;
    } else {
        out[1] = maskBit | 127;
        out.writeBigUInt64BE(BigInt(len), 2);
        offset = 10;
    }

    if (mask) {
        const key = options.maskKey && options.maskKey.length === 4
            ? options.maskKey
            : crypto.randomBytes(4);
        key.copy(out, offset, 0, 4);
        offset += 4;
        for (let i = 0; i < len; i++) {
            out[offset + i] = payload[i] ^ key[i & 3];
        }
    } else if (len > 0) {
        payload.copy(out, offset);
    }

    return out;
}

/**
 * Streaming RFC 6455 frame decoder supporting fragmented data messages,
 * interleaved control frames (ping/pong/close), 16-bit & 64-bit extended lengths,
 * masked/unmasked frames, and arbitrary TCP chunk boundaries.
 */
export class WebSocketFrameDecoder {
    private _buf: Buffer = Buffer.alloc(0);
    private _fragOpcode: number | null = null;
    private _fragChunks: Buffer[] = [];
    private _fragTotalBytes = 0;
    private readonly _maxMessageBytes: number;

    constructor(maxMessageBytes = MAX_WS_FRAME_BYTES) {
        this._maxMessageBytes = maxMessageBytes;
    }

    push(chunk: Buffer): DecodedWebSocketMessage[] {
        if (chunk.length === 0) { return []; }
        this._buf = this._buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this._buf, chunk]);
        const messages: DecodedWebSocketMessage[] = [];

        while (this._buf.length >= 2) {
            const b0 = this._buf[0];
            const b1 = this._buf[1];
            const fin = (b0 & 0x80) !== 0;
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let payloadLen = b1 & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
                if (this._buf.length < 4) { break; }
                payloadLen = this._buf.readUInt16BE(2);
                offset = 4;
            } else if (payloadLen === 127) {
                if (this._buf.length < 10) { break; }
                const bigLen = this._buf.readBigUInt64BE(2);
                if (bigLen > BigInt(this._maxMessageBytes)) {
                    throw new Error(`WebSocket frame exceeds maximum allowed size (${this._maxMessageBytes} bytes)`);
                }
                payloadLen = Number(bigLen);
                offset = 10;
            }

            if (payloadLen > this._maxMessageBytes) {
                throw new Error(`WebSocket frame exceeds maximum allowed size (${this._maxMessageBytes} bytes)`);
            }

            const maskBytes = masked ? 4 : 0;
            const frameTotalLen = offset + maskBytes + payloadLen;
            if (this._buf.length < frameTotalLen) {
                break;
            }

            let payload = Buffer.from(this._buf.subarray(offset + maskBytes, frameTotalLen));
            if (masked) {
                const maskKey = this._buf.subarray(offset, offset + 4);
                for (let i = 0; i < payload.length; i++) {
                    payload[i] ^= maskKey[i & 3];
                }
            }
            this._buf = this._buf.subarray(frameTotalLen);

            // Control frames (opcode >= 0x8) may interleave inside fragmented data messages.
            if (opcode >= 0x8) {
                messages.push({ opcode, payload });
                continue;
            }

            if (opcode === WS_OPCODE.CONTINUATION) {
                if (this._fragOpcode === null) {
                    throw new Error('Unexpected WebSocket continuation frame');
                }
                this._fragTotalBytes += payload.length;
                if (this._fragTotalBytes > this._maxMessageBytes) {
                    throw new Error('Fragmented WebSocket message exceeds maximum allowed size');
                }
                this._fragChunks.push(payload);
                if (fin) {
                    const combined = Buffer.concat(this._fragChunks);
                    const finalOpcode = this._fragOpcode;
                    this._fragOpcode = null;
                    this._fragChunks = [];
                    this._fragTotalBytes = 0;
                    messages.push({ opcode: finalOpcode, payload: combined });
                }
            } else if (!fin) {
                if (this._fragOpcode !== null) {
                    throw new Error('Received new data frame while fragmented message is incomplete');
                }
                this._fragOpcode = opcode;
                this._fragChunks = [payload];
                this._fragTotalBytes = payload.length;
            } else {
                messages.push({ opcode, payload });
            }
        }

        return messages;
    }
}

export interface CdpClientLike {
    readonly isOpen: boolean;
    send<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
    evaluate<T = unknown>(expression: string, timeoutMs?: number): Promise<T>;
    onClose?(listener: () => void): () => void;
    onEvent?(listener: (method: string, params?: Record<string, unknown>) => void): () => void;
    close(): Promise<void>;
}

interface PendingCdpCall {
    resolve: (val: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Lightweight, zero-dependency Chrome DevTools Protocol WebSocket client
 * using `node:http` Upgrade + RFC 6455 framing. Strictly enforces loopback targets.
 */
export class CdpWebSocketClient implements CdpClientLike {
    private readonly _socket: net.Socket;
    private readonly _decoder = new WebSocketFrameDecoder();
    private readonly _pending = new Map<number, PendingCdpCall>();
    private readonly _closeListeners = new Set<() => void>();
    private readonly _eventListeners = new Set<(method: string, params?: Record<string, unknown>) => void>();
    private _nextId = 1;
    private _closed = false;

    private constructor(socket: net.Socket, initialHead?: Buffer) {
        this._socket = socket;
        this._socket.on('data', (chunk: Buffer) => this._handleData(chunk));
        this._socket.on('error', (err) => this._failAll(err));
        this._socket.on('close', () => this._failAll(new Error('CDP WebSocket closed')));
        if (initialHead && initialHead.length > 0) {
            this._handleData(initialHead);
        }
    }

    get isOpen(): boolean {
        return !this._closed && !this._socket.destroyed;
    }

    onClose(listener: () => void): () => void {
        if (this._closed) {
            try { listener(); } catch { /* ignore */ }
            return () => {};
        }
        this._closeListeners.add(listener);
        return () => { this._closeListeners.delete(listener); };
    }

    onEvent(listener: (method: string, params?: Record<string, unknown>) => void): () => void {
        this._eventListeners.add(listener);
        return () => { this._eventListeners.delete(listener); };
    }

    static connect(wsUrl: string, options: { timeoutMs?: number } = {}): Promise<CdpWebSocketClient> {
        return new Promise((resolve, reject) => {
            if (!isLoopbackUrl(wsUrl, ['ws:'])) {
                reject(new Error(`Refusing non-loopback or unsupported CDP WebSocket URL: ${wsUrl}`));
                return;
            }
            const parsed = new URL(wsUrl);
            const port = parsed.port ? Number(parsed.port) : 80;
            const timeoutMs = options.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS;
            const key = crypto.randomBytes(16).toString('base64');
            const expectedAccept = computeWebSocketAcceptKey(key);

            let settled = false;
            const settle = (err: Error | null, client?: CdpWebSocketClient) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(connectTimer);
                if (err) { reject(err); } else { resolve(client!); }
            };

            const req = http.request({
                hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
                port,
                path: `${parsed.pathname}${parsed.search}`,
                method: 'GET',
                headers: {
                    'Connection': 'Upgrade',
                    'Upgrade': 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': key,
                },
            });

            const connectTimer = setTimeout(() => {
                req.destroy();
                settle(new Error(`CDP WebSocket handshake timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            req.on('upgrade', (res, socket, head) => {
                const accept = typeof res.headers['sec-websocket-accept'] === 'string'
                    ? res.headers['sec-websocket-accept'].trim()
                    : '';
                if (res.statusCode !== 101 || accept !== expectedAccept) {
                    socket.destroy();
                    settle(new Error('CDP WebSocket handshake rejected (invalid 101/Sec-WebSocket-Accept)'));
                    return;
                }
                const client = new CdpWebSocketClient(socket, head);
                settle(null, client);
            });

            req.on('response', (res) => {
                res.resume();
                settle(new Error(`CDP WebSocket upgrade failed with HTTP ${res.statusCode ?? 'unknown'}`));
            });

            req.on('error', (err) => {
                settle(err);
            });

            req.end();
        });
    }

    send<T = unknown>(
        method: string,
        params: Record<string, unknown> = {},
        timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
    ): Promise<T> {
        if (!this.isOpen) {
            return Promise.reject(new Error('CDP WebSocket is not open'));
        }
        const id = this._nextId++;
        const payload = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');
        const frame = encodeWebSocketFrame({ opcode: WS_OPCODE.TEXT, payload, fin: true, mask: true });

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this._pending.set(id, {
                resolve: (val) => resolve(val as T),
                reject,
                timer,
            });

            try {
                this._socket.write(frame);
            } catch (err) {
                clearTimeout(timer);
                this._pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    async evaluate<T = unknown>(expression: string, timeoutMs = DEFAULT_CDP_TIMEOUT_MS): Promise<T> {
        const res = await this.send<{
            result?: { value?: T; description?: string };
            exceptionDetails?: { text?: string; exception?: { description?: string } };
        }>('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: false,
        }, timeoutMs);
        if (res?.exceptionDetails) {
            const desc = res.exceptionDetails.exception?.description
                || res.exceptionDetails.text
                || 'CDP Runtime.evaluate exception';
            throw new Error(desc);
        }
        return res?.result?.value as T;
    }

    async close(): Promise<void> {
        if (this._closed) { return; }
        this._closed = true;
        try {
            if (!this._socket.destroyed) {
                const closeFrame = encodeWebSocketFrame({ opcode: WS_OPCODE.CLOSE, mask: true });
                this._socket.write(closeFrame);
                this._socket.end();
            }
        } catch {
            // ignore socket close errors
        } finally {
            this._socket.destroy();
            this._failAll(new Error('CDP WebSocket closed by client'));
        }
    }

    private _handleData(chunk: Buffer): void {
        let messages: DecodedWebSocketMessage[];
        try {
            messages = this._decoder.push(chunk);
        } catch (err) {
            this._socket.destroy();
            this._failAll(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        for (const msg of messages) {
            if (msg.opcode === WS_OPCODE.PING) {
                if (this.isOpen) {
                    const pong = encodeWebSocketFrame({ opcode: WS_OPCODE.PONG, payload: msg.payload, mask: true });
                    try { this._socket.write(pong); } catch { /* ignore */ }
                }
                continue;
            }
            if (msg.opcode === WS_OPCODE.CLOSE) {
                this._closed = true;
                this._socket.destroy();
                this._failAll(new Error('CDP WebSocket closed by peer'));
                return;
            }
            if (msg.opcode === WS_OPCODE.TEXT) {
                this._handleTextMessage(msg.payload.toString('utf8'));
            }
        }
    }

    private _handleTextMessage(raw: string): void {
        let parsed: {
            id?: number;
            method?: string;
            params?: Record<string, unknown>;
            result?: unknown;
            error?: { code?: number; message?: string };
        };
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        if (typeof parsed.id !== 'number') {
            if (typeof parsed.method === 'string' && this._eventListeners.size > 0) {
                for (const listener of [...this._eventListeners]) {
                    try { listener(parsed.method, parsed.params); } catch { /* ignore */ }
                }
            }
            return;
        }
        const pending = this._pending.get(parsed.id);
        if (!pending) { return; }
        this._pending.delete(parsed.id);
        clearTimeout(pending.timer);
        if (parsed.error) {
            pending.reject(new Error(`CDP error ${parsed.error.code ?? ''}: ${parsed.error.message || 'unknown'}`.trim()));
        } else {
            pending.resolve(parsed.result);
        }
    }

    private _failAll(err: Error): void {
        const wasOpen = !this._closed;
        this._closed = true;
        for (const [id, pending] of this._pending.entries()) {
            this._pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        if (wasOpen && this._closeListeners.size > 0) {
            const listeners = [...this._closeListeners];
            this._closeListeners.clear();
            for (const listener of listeners) {
                try { listener(); } catch { /* ignore */ }
            }
        }
    }
}

// ─── Authenticated Loopback Action Bridge ────────────────────────────────────

export interface OverlayBridgeValidationResult {
    ok: boolean;
    status: number;
    origin?: string;
    error?: string;
}

export function generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function constantTimeTokenEquals(actual: string, expected: string): boolean {
    if (!actual || !expected) { return false; }
    const a = Buffer.from(actual, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) { return false; }
    return crypto.timingSafeEqual(a, b);
}

/**
 * Strictly validate an incoming loopback overlay bridge request:
 * 1. `Origin` header MUST exist and parse to a loopback `http:`/`https:` origin
 *    (and match `allowedOrigin` when pinned to a specific Hub target).
 * 2. `X-Monitor-Token` MUST match the 256-bit random session token in constant time
 *    (unless `isPreflight` is true for CORS `OPTIONS`).
 */
export function validateOverlayBridgeRequest(params: {
    originHeader: string | undefined;
    tokenHeader: string | undefined;
    expectedToken: string;
    allowedOrigin?: string;
    isPreflight?: boolean;
}): OverlayBridgeValidationResult {
    const rawOrigin = typeof params.originHeader === 'string' ? params.originHeader.trim() : '';
    if (!rawOrigin || rawOrigin === 'null') {
        return { ok: false, status: 403, error: 'Missing or null Origin header' };
    }
    let parsedOrigin: URL;
    try {
        parsedOrigin = new URL(rawOrigin);
    } catch {
        return { ok: false, status: 403, error: 'Malformed Origin header' };
    }
    if ((parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:')
        || !isLoopbackHostname(parsedOrigin.hostname)) {
        return { ok: false, status: 403, error: 'Non-loopback Origin rejected' };
    }
    const normalizedOrigin = parsedOrigin.origin;
    if (params.allowedOrigin && normalizedOrigin !== params.allowedOrigin) {
        return { ok: false, status: 403, error: 'Origin does not match authorized Antigravity Hub target' };
    }

    if (!params.isPreflight) {
        const provided = typeof params.tokenHeader === 'string' ? params.tokenHeader.trim() : '';
        if (!constantTimeTokenEquals(provided, params.expectedToken)) {
            return { ok: false, status: 401, error: 'Invalid or missing X-Monitor-Token' };
        }
    }

    return { ok: true, status: 200, origin: normalizedOrigin };
}

export interface OverlayTargetGrant {
    targetId: string;
    token: string;
    allowedOrigin: string;
    allowedCommands: ReadonlySet<CdpOverlayBridgeActionCommand>;
    issuedAt: number;
    targetUrl: string;
}

export interface OverlayActionBridgeHandle {
    readonly url: string;
    readonly port: number;
    readonly token: string;
    setAllowedOrigin(origin: string | undefined): void;
    registerTargetGrant?(grant: OverlayTargetGrant): void;
    revokeTargetGrant?(targetId: string): void;
    revokeAllGrants?(): void;
    validateGrant?(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): boolean;
    close(): Promise<void>;
}

function parseLoopbackOriginHeader(rawOrigin: string | undefined): { ok: true; origin: string } | { ok: false; error: string } {
    const clean = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
    if (!clean || clean === 'null') {
        return { ok: false, error: 'Missing or null Origin header' };
    }
    let parsed: URL;
    try {
        parsed = new URL(clean);
    } catch {
        return { ok: false, error: 'Malformed Origin header' };
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        || !isLoopbackHostname(parsed.hostname)) {
        return { ok: false, error: 'Non-loopback Origin rejected' };
    }
    return { ok: true, origin: parsed.origin };
}

/**
 * Start a loopback-only (`127.0.0.1`) authenticated HTTP bridge for overlay quick actions
 * (`openPanel`, `refresh`, `togglePause`, `focusConversation`).
 * Enforces strict loopback `Origin`, per-target 256-bit `X-Monitor-Token` grants,
 * minimal capability checks, and immediate revocation on navigation/detach/restart.
 */
export async function createOverlayActionBridge(options: {
    onAction?: (action: CdpOverlayBridgeAction) => Promise<void | CdpFocusAck> | void | CdpFocusAck;
    allowedOrigin?: string;
    token?: string;
} = {}): Promise<OverlayActionBridgeHandle> {
    const token = options.token && options.token.length >= 32 ? options.token : generateSessionToken();
    let allowedOrigin = options.allowedOrigin;
    const targetGrants = new Map<string, OverlayTargetGrant>();
    let grantModeActive = false;

    function findMatchingTargetGrant(
        providedToken: string,
        normalizedOrigin: string | undefined,
        command?: CdpOverlayBridgeActionCommand,
    ): OverlayTargetGrant | null {
        if (!providedToken || !normalizedOrigin) { return null; }
        let matched: OverlayTargetGrant | null = null;
        for (const grant of targetGrants.values()) {
            const originMatches = grant.allowedOrigin === normalizedOrigin;
            const tokenMatches = constantTimeTokenEquals(providedToken, grant.token);
            const cmdMatches = !command || grant.allowedCommands.has(command);
            if (originMatches && tokenMatches && cmdMatches && !matched) {
                matched = grant;
            }
        }
        return matched;
    }

    function hasActiveGrantForOrigin(normalizedOrigin: string): boolean {
        for (const grant of targetGrants.values()) {
            if (grant.allowedOrigin === normalizedOrigin) {
                return true;
            }
        }
        return false;
    }

    function validateGrant(
        providedToken: string,
        originHeader?: string,
        command?: CdpOverlayBridgeActionCommand,
    ): boolean {
        const trimmedToken = typeof providedToken === 'string' ? providedToken.trim() : '';
        if (!trimmedToken) { return false; }
        const parsed = parseLoopbackOriginHeader(originHeader);
        if (!parsed.ok || !parsed.origin) { return false; }
        const normalizedOrigin = parsed.origin;
        if (grantModeActive) {
            return findMatchingTargetGrant(trimmedToken, normalizedOrigin, command) !== null;
        }
        if (allowedOrigin && normalizedOrigin !== allowedOrigin) {
            return false;
        }
        if (command && !ALLOWED_BRIDGE_COMMANDS.has(command)) {
            return false;
        }
        return constantTimeTokenEquals(trimmedToken, token);
    }

    const server = http.createServer((req, res) => {
        const method = (req.method || 'GET').toUpperCase();
        const pathname = (req.url || '/').split('?')[0];
        const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
        const tokenHeader = typeof req.headers['x-monitor-token'] === 'string' ? req.headers['x-monitor-token'] : undefined;

        const send = (status: number, body: Record<string, unknown>, corsOrigin?: string) => {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            };
            if (corsOrigin) {
                headers['Access-Control-Allow-Origin'] = corsOrigin;
                headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
                headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Monitor-Token';
                headers['Vary'] = 'Origin';
            }
            res.writeHead(status, headers);
            res.end(JSON.stringify(body));
        };

        // This bridge advertises its literal IPv4 loopback endpoint. Bind HTTP
        // authority to the same listener before preflight, authorization or body reads.
        if (req.headers.host !== `127.0.0.1:${req.socket.localPort}`) {
            send(403, { ok: false, error: 'Host does not match the overlay bridge' });
            return;
        }

        if (pathname !== '/api/overlay/action') {
            send(404, { ok: false, error: 'Not Found' });
            return;
        }

        if (method === 'OPTIONS') {
            if (grantModeActive) {
                const parsed = parseLoopbackOriginHeader(originHeader);
                if (!parsed.ok) {
                    send(403, { ok: false, error: parsed.error });
                    return;
                }
                if (!hasActiveGrantForOrigin(parsed.origin)) {
                    send(403, { ok: false, error: 'Origin does not match any active Antigravity Hub target' });
                    return;
                }
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': parsed.origin,
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Monitor-Token',
                    'Access-Control-Max-Age': '300',
                    'Vary': 'Origin',
                });
                res.end();
                return;
            }
            const check = validateOverlayBridgeRequest({
                originHeader,
                tokenHeader,
                expectedToken: token,
                allowedOrigin,
                isPreflight: true,
            });
            if (!check.ok) {
                send(check.status, { ok: false, error: check.error });
                return;
            }
            res.writeHead(204, {
                'Access-Control-Allow-Origin': check.origin!,
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-Monitor-Token',
                'Access-Control-Max-Age': '300',
                'Vary': 'Origin',
            });
            res.end();
            return;
        }

        if (method !== 'POST') {
            send(405, { ok: false, error: 'Method Not Allowed' });
            return;
        }

        let matchedOrigin: string;
        let matchedGrant: OverlayTargetGrant | null = null;
        if (grantModeActive) {
            const parsed = parseLoopbackOriginHeader(originHeader);
            if (!parsed.ok) {
                send(403, { ok: false, error: parsed.error });
                return;
            }
            if (!hasActiveGrantForOrigin(parsed.origin)) {
                send(403, { ok: false, error: 'Origin does not match any active Antigravity Hub target' });
                return;
            }
            const provided = typeof tokenHeader === 'string' ? tokenHeader.trim() : '';
            matchedGrant = findMatchingTargetGrant(provided, parsed.origin);
            if (!matchedGrant) {
                send(401, { ok: false, error: 'Invalid, revoked, or mismatched X-Monitor-Token' });
                return;
            }
            matchedOrigin = parsed.origin;
        } else {
            const check = validateOverlayBridgeRequest({
                originHeader,
                tokenHeader,
                expectedToken: token,
                allowedOrigin,
                isPreflight: false,
            });
            if (!check.ok) {
                send(check.status, { ok: false, error: check.error });
                return;
            }
            matchedOrigin = check.origin!;
        }

        const mediaType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (mediaType !== 'application/json') {
            send(415, { ok: false, error: 'Content-Type must be application/json' }, matchedOrigin);
            return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        let finished = false;
        req.on('data', (chunk: Buffer | string) => {
            if (finished) { return; }
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
            total += buf.length;
            if (total > MAX_BRIDGE_BODY_BYTES) {
                finished = true;
                req.resume();
                send(413, { ok: false, error: 'Payload too large' }, matchedOrigin);
                return;
            }
            chunks.push(buf);
        });
        req.on('error', () => {
            if (!finished) {
                finished = true;
                send(400, { ok: false, error: 'Request stream error' }, matchedOrigin);
            }
        });
        req.on('end', () => {
            if (finished) { return; }
            finished = true;
            if (grantModeActive && (!matchedGrant || targetGrants.get(matchedGrant.targetId) !== matchedGrant)) {
                send(401, { ok: false, error: 'Overlay target grant was revoked' }, matchedOrigin);
                return;
            }
            let parsed: Record<string, unknown>;
            try {
                const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!json || typeof json !== 'object' || Array.isArray(json)) {
                    send(400, { ok: false, error: 'Invalid JSON body' }, matchedOrigin);
                    return;
                }
                parsed = json as Record<string, unknown>;
            } catch {
                send(400, { ok: false, error: 'Malformed JSON body' }, matchedOrigin);
                return;
            }
            const cmd = typeof parsed.command === 'string' ? parsed.command.trim() as CdpOverlayBridgeActionCommand : '' as CdpOverlayBridgeActionCommand;
            if (!ALLOWED_BRIDGE_COMMANDS.has(cmd) || (matchedGrant && !matchedGrant.allowedCommands.has(cmd))) {
                send(400, { ok: false, error: 'Unsupported overlay action' }, matchedOrigin);
                return;
            }
            const source = parsed.source === 'composer' || parsed.source === 'topbar' ? parsed.source : undefined;
            const targetTab = parseOverlayTargetTab(parsed.targetTab);
            if (cmd === 'focusConversation') {
                const conversationId = parseOverlayConversationId(parsed.conversationId);
                const isNewConversation = typeof parsed.isNewConversation === 'boolean'
                    ? parsed.isNewConversation
                    : false;
                const revision = parsed.focusRevision;
                if ((parsed.conversationId !== undefined && conversationId === undefined)
                    || (conversationId === undefined && !isNewConversation)
                    || (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0))) {
                    send(400, { ok: false, error: 'Invalid conversation focus payload' }, matchedOrigin);
                    return;
                }
                const sanitizedId = typeof conversationId === 'string' ? conversationId : null;
                Promise.resolve().then(() => options.onAction?.({
                    command: cmd,
                    source,
                    conversationId: sanitizedId,
                    isNewConversation,
                    ...(matchedGrant ? { targetId: matchedGrant.targetId } : {}),
                    ...(typeof revision === 'number' ? { focusRevision: revision } : {}),
                }))
                    .then(ack => send(200, { ok: true, command: cmd, ...(ack ? { result: { accepted: ack.accepted, ackFocusRevision: ack.ackFocusRevision } } : {}) }, matchedOrigin))
                    .catch(() => send(500, { ok: false, error: 'Action handler failed' }, matchedOrigin));
                return;
            }
            Promise.resolve().then(() => options.onAction?.({
                command: cmd,
                source,
                ...(targetTab ? { targetTab: targetTab as CdpOverlayTargetTab } : {}),
            }))
                .then(() => send(200, { ok: true, command: cmd }, matchedOrigin))
                .catch(() => send(500, { ok: false, error: 'Action handler failed' }, matchedOrigin));
        });
    });

    const activeSockets = new Set<net.Socket>();
    server.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => activeSockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    let closePromise: Promise<void> | null = null;

    return {
        url: `http://127.0.0.1:${port}`,
        port,
        token,
        setAllowedOrigin(nextOrigin: string | undefined) {
            allowedOrigin = nextOrigin;
        },
        registerTargetGrant(grant: OverlayTargetGrant) {
            grantModeActive = true;
            targetGrants.set(grant.targetId, grant);
        },
        revokeTargetGrant(targetId: string) {
            targetGrants.delete(targetId);
        },
        revokeAllGrants() {
            targetGrants.clear();
        },
        validateGrant,
        close(): Promise<void> {
            grantModeActive = true;
            targetGrants.clear();
            if (closePromise) { return closePromise; }
            closePromise = new Promise<void>((resolve) => {
                server.close(() => resolve());
                if (typeof server.closeIdleConnections === 'function') {
                    server.closeIdleConnections();
                }
                for (const s of activeSockets) { s.destroy(); }
                activeSockets.clear();
            });
            return closePromise;
        },
    };
}

// ─── High-Level Opt-In Ambient Overlay Manager ───────────────────────────────

export interface CdpAmbientOverlayManagerOptions {
    payloadForTarget?: (targetId: string, common: CdpOverlayPayload) => CdpOverlayPayload;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    reconnectBackoffMs?: number;
    /** Fast recovery polling interval (2–3s default: 2500ms) when in `no_hub_target` / macOS Dock reopen state. */
    fastRecoveryBackoffMs?: number;
    enableActionBridge?: boolean;
    excludeTargetPorts?: readonly number[];
    onBridgeAction?: (action: CdpOverlayBridgeAction) => Promise<void | CdpFocusAck> | void | CdpFocusAck;
    log?: (msg: string) => void;
    now?: () => number;
    // Injectable dependencies for deterministic testing
    discoverActivePort?: (opts?: { customUserDataDir?: string }) => DevToolsActivePortInfo | null;
    inspectHostProcess?: () => HostProcessInspectionResult | Promise<HostProcessInspectionResult>;
    inspectLauncher?: () => CdpLauncherStatus;
    fetchVersion?: (port: number) => Promise<CdpBrowserVersionInfo | null>;
    fetchTargets?: (port: number) => Promise<CdpTargetInfo[]>;
    connectClient?: (wsUrl: string) => Promise<CdpClientLike>;
    createBridge?: (opts: {
        onAction?: (action: CdpOverlayBridgeAction) => Promise<void | CdpFocusAck> | void | CdpFocusAck;
        allowedOrigin?: string;
    }) => Promise<OverlayActionBridgeHandle>;
}

export interface CdpAmbientOverlayManager {
    getStatus(): CdpStatus;
    setToggles(toggles: CdpOverlayToggles): Promise<CdpStatus>;
    updatePayload(payload: CdpOverlayPayload): Promise<CdpStatus>;
    recheck?(): Promise<CdpStatus>;
    addExcludedPort?(port: number): void;
    /** Validate a per-target overlay bridge token + origin + optional minimal capability command. */
    validateBridgeGrant?(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): boolean;
    resolveBridgeTargetId?(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): string | undefined;
    /** Inspect active target grants (without exposing secret tokens). */
    getActiveGrants?(): ReadonlyArray<{ targetId: string; allowedOrigin: string; targetUrl: string }>;
    dispose(): Promise<void>;
}

interface AttachedHubTarget {
    targetId: string;
    wsUrl: string;
    targetUrl: string;
    targetTitle?: string;
    allowedOrigin: string;
    client: CdpClientLike;
    bootstrapped: boolean;
    grant: OverlayTargetGrant;
    unsubClose?: () => void;
    unsubEvent?: () => void;
}

/**
 * Manages the full opt-in lifecycle for Antigravity App ambient Shadow DOM overlays:
 * - Strictly disabled by default (ZERO CDP discovery, ZERO OS process probing, ZERO socket/eval until enabled).
 * - Multi-window trust isolation: requires positive host/browser-session/Hub identification,
 *   explicit `--remote-debugging-port=N` outranking stale `DevToolsActivePort`,
 *   per-target allowed Origin & 256-bit minimal-capability action credential, and immediate
 *   grant revocation on navigation, reload, detach, close, disable, or restart.
 */
export function createCdpAmbientOverlayManager(
    options: CdpAmbientOverlayManagerOptions = {},
): CdpAmbientOverlayManager & {
    recheck(): Promise<CdpStatus>;
    addExcludedPort(port: number): void;
    validateBridgeGrant(token: string, origin?: string, command?: CdpOverlayBridgeActionCommand): boolean;
    getActiveGrants(): ReadonlyArray<{ targetId: string; allowedOrigin: string; targetUrl: string }>;
} {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const reconnectBackoffMs = options.reconnectBackoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
    const fastRecoveryBackoffMs = typeof options.fastRecoveryBackoffMs === 'number'
        && Number.isFinite(options.fastRecoveryBackoffMs)
        && options.fastRecoveryBackoffMs >= 10
        ? options.fastRecoveryBackoffMs
        : DEFAULT_FAST_RECOVER_BACKOFF_MS;
    const enableActionBridge = options.enableActionBridge !== false;
    const nowFn = options.now ?? (() => Date.now());
    const log = options.log ?? (() => {});
    const dynamicExcludedPorts = new Set<number>();

    function addExcludedPort(port: number): void {
        if (Number.isSafeInteger(port) && port >= 1 && port <= 65535) {
            dynamicExcludedPorts.add(port);
        }
    }

    const discoverPortFn = options.discoverActivePort
        ?? ((discOpts?: { customUserDataDir?: string }) => discoverDevToolsActivePort({
            platform,
            env,
            customUserDataDir: discOpts?.customUserDataDir,
        }));

    // Low-frequency cached host process inspection (async on Windows; ZERO OS probing while disabled)
    let cachedWindowsHostInfo: HostProcessInspectionResult | null = null;
    let lastWindowsHostProbeAt = -Infinity;
    let windowsHostProbeInFlight: Promise<HostProcessInspectionResult> | null = null;

    async function inspectHostProcessAsync(forceRefresh = false): Promise<HostProcessInspectionResult> {
        const runProbe = async (): Promise<HostProcessInspectionResult> => {
            if (options.inspectHostProcess) {
                return await Promise.resolve(options.inspectHostProcess());
            }
            // When a test injects `discoverActivePort` without `inspectHostProcess`, keep it hermetic
            // rather than inspecting the live developer/CI host process tree.
            if (options.discoverActivePort) {
                return { found: false, hasRemoteDebuggingFlag: false };
            }
            return inspectAntigravityHostProcessAsync({ platform });
        };

        if (platform === 'win32') {
            const nowMs = nowFn();
            if (!forceRefresh && cachedWindowsHostInfo && Math.abs(nowMs - lastWindowsHostProbeAt) < WINDOWS_HOST_PROBE_TTL_MS) {
                return cachedWindowsHostInfo;
            }
            if (!windowsHostProbeInFlight) {
                windowsHostProbeInFlight = runProbe()
                    .then((res) => {
                        cachedWindowsHostInfo = res;
                        lastWindowsHostProbeAt = nowFn();
                        return res;
                    })
                    .catch(() => ({ found: false, hasRemoteDebuggingFlag: false }))
                    .finally(() => {
                        windowsHostProbeInFlight = null;
                    });
            }
            return windowsHostProbeInFlight;
        }
        return runProbe();
    }

    const inspectLauncherFn = options.inspectLauncher ?? (() => inspectCdpLauncher({ platform, env }));
    const fetchTargetsFn = options.fetchTargets ?? ((port: number) => fetchCdpTargets(port));
    const fetchVersionFn = options.fetchVersion
        ?? (options.fetchTargets ? undefined : ((port: number) => fetchCdpBrowserVersion(port)));
    const connectClientFn = options.connectClient ?? ((wsUrl: string) => CdpWebSocketClient.connect(wsUrl));
    const createBridgeFn = options.createBridge ?? createOverlayActionBridge;

    let toggles: CdpOverlayToggles = {
        appComposerRingEnabled: false,
        appTopBarEnabled: false,
    };
    let state: CdpConnectionState = 'disabled';
    let diagnosticCode: CdpDiagnosticCode = 'disabled';
    let targetUrl: string | undefined;
    let targetTitle: string | undefined;
    let portFilePath: string | undefined;
    let discoveredPort: number | undefined;
    let lastInjectedAt: number | undefined;
    let errorMessage: string | undefined;
    let hostHasDebugFlag: boolean | undefined;
    let cachedLauncherStatus: CdpLauncherStatus | undefined;
    let lastLauncherCheckAt = -Infinity;
    let lastPayload: CdpOverlayPayload | null = null;
    let lastFailedAttemptAt = 0;
    let fastRecoveryActive = false;
    let fastRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

    const attachedTargets = new Map<string, AttachedHubTarget>();
    const activeGrants = new Map<string, OverlayTargetGrant>();
    let bridge: OverlayActionBridgeHandle | null = null;
    let disposed = false;
    let opQueue: Promise<unknown> = Promise.resolve();

    function clearFastRecoveryTimer(): void {
        if (fastRecoveryTimer !== null) {
            clearTimeout(fastRecoveryTimer);
            fastRecoveryTimer = null;
        }
    }

    function scheduleFastRecovery(): void {
        if (disposed || !anyEnabled() || !fastRecoveryActive || attachedTargets.size > 0) {
            clearFastRecoveryTimer();
            return;
        }
        if (fastRecoveryTimer !== null) {
            return;
        }
        fastRecoveryTimer = setTimeout(() => {
            fastRecoveryTimer = null;
            if (disposed || !anyEnabled() || !fastRecoveryActive || attachedTargets.size > 0) {
                return;
            }
            void enqueue(async () => {
                if (disposed || !anyEnabled() || !fastRecoveryActive || attachedTargets.size > 0) {
                    return;
                }
                // Clear lastFailedAttemptAt so 1ms timer jitter never skips a scheduled fast recovery tick.
                lastFailedAttemptAt = 0;
                await syncToHub(false);
            });
        }, fastRecoveryBackoffMs);
        if (typeof (fastRecoveryTimer as { unref?: () => void }).unref === 'function') {
            (fastRecoveryTimer as { unref: () => void }).unref();
        }
    }

    function handleTargetDisconnected(tid: string): void {
        attachedTargets.delete(tid);
        revokeGrantForTarget(tid);
        refreshPrimaryTargetMetadata();
        if (!disposed && anyEnabled() && attachedTargets.size === 0) {
            // All Hub windows closed (e.g. macOS Dock without quitting Antigravity):
            // drop immediately into fast 2–3s recovery so clicking Dock reattaches quickly.
            state = 'cdp_unavailable';
            diagnosticCode = 'no_hub_target';
            errorMessage = 'All Antigravity Hub windows closed; waiting for window reopen';
            lastFailedAttemptAt = 0;
            fastRecoveryActive = true;
            scheduleFastRecovery();
        }
    }

    const platformGuide = getCdpPlatformGuide(platform);
    const LAUNCHER_CACHE_TTL_MS = 2_000;

    function getLauncherStatus(forceRefresh = false): CdpLauncherStatus | undefined {
        const nowMs = nowFn();
        if (forceRefresh || !cachedLauncherStatus || Math.abs(nowMs - lastLauncherCheckAt) >= LAUNCHER_CACHE_TTL_MS) {
            try {
                cachedLauncherStatus = inspectLauncherFn();
                lastLauncherCheckAt = nowMs;
            } catch {
                // Best-effort launcher inspection must never break status reporting.
            }
        }
        return cachedLauncherStatus;
    }

    function anyEnabled(): boolean {
        return toggles.appComposerRingEnabled || toggles.appTopBarEnabled;
    }

    function enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = opQueue.then(fn, fn);
        opQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    function refreshPrimaryTargetMetadata(): void {
        const first = attachedTargets.values().next().value as AttachedHubTarget | undefined;
        if (first) {
            targetUrl = first.targetUrl;
            targetTitle = first.targetTitle;
        } else {
            targetUrl = undefined;
            targetTitle = undefined;
        }
    }

    function mintGrantForTarget(targetId: string, origin: string, url: string): OverlayTargetGrant {
        const grant: OverlayTargetGrant = {
            targetId,
            token: generateSessionToken(),
            allowedOrigin: origin,
            allowedCommands: new Set(ALLOWED_BRIDGE_COMMANDS),
            issuedAt: nowFn(),
            targetUrl: url,
        };
        activeGrants.set(targetId, grant);
        bridge?.registerTargetGrant?.(grant);
        bridge?.setAllowedOrigin(origin);
        return grant;
    }

    function revokeGrantForTarget(targetId: string): void {
        activeGrants.delete(targetId);
        bridge?.revokeTargetGrant?.(targetId);
    }

    function revokeAllTargetGrants(): void {
        activeGrants.clear();
        bridge?.revokeAllGrants?.();
    }

    function resolveBridgeTargetId(
        providedToken: string,
        originHeader?: string,
        command?: CdpOverlayBridgeActionCommand,
    ): string | undefined {
        const trimmed = typeof providedToken === 'string' ? providedToken.trim() : '';
        if (!trimmed || activeGrants.size === 0) {
            return undefined;
        }
        const parsed = parseLoopbackOriginHeader(originHeader);
        if (!parsed.ok || !parsed.origin) {
            return undefined;
        }
        const normalizedOrigin = parsed.origin;
        for (const grant of activeGrants.values()) {
            const tokenOk = constantTimeTokenEquals(trimmed, grant.token);
            const originOk = grant.allowedOrigin === normalizedOrigin;
            const cmdOk = !command || grant.allowedCommands.has(command);
            if (tokenOk && originOk && cmdOk) {
                return grant.targetId;
            }
        }
        return undefined;
    }

    function getActiveGrants(): ReadonlyArray<{ targetId: string; allowedOrigin: string; targetUrl: string }> {
        return [...activeGrants.values()].map(g => ({
            targetId: g.targetId,
            allowedOrigin: g.allowedOrigin,
            targetUrl: g.targetUrl,
        }));
    }

    function getStatus(): CdpStatus {
        const launcherStatus = anyEnabled() ? getLauncherStatus(false) : cachedLauncherStatus;
        return {
            state,
            diagnosticCode,
            composerEnabled: toggles.appComposerRingEnabled,
            topBarEnabled: toggles.appTopBarEnabled,
            ...(targetUrl ? { targetUrl } : {}),
            ...(targetTitle ? { targetTitle } : {}),
            ...(portFilePath ? { portFilePath } : {}),
            ...(discoveredPort !== undefined ? { discoveredPort } : {}),
            ...(lastInjectedAt !== undefined ? { lastInjectedAt } : {}),
            ...(errorMessage ? { errorMessage } : {}),
            ...(hostHasDebugFlag !== undefined ? { hostHasDebugFlag } : {}),
            ...(launcherStatus ? { launcherStatus } : {}),
            platformGuide,
        };
    }

    // A page can navigate between target discovery and Runtime.evaluate.
    // Check the actual document origin in the same evaluation as the operation.
    function evaluateOnHub<T = unknown>(entry: AttachedHubTarget, expression: string, timeoutMs?: number): Promise<T> {
        const guarded = `(function(){ if (window.location.origin !== ${safeJsonForScript(entry.allowedOrigin)}) {
            return { ok: false, origin: window.location.origin };
        } return ${expression} })()`;
        return entry.client.evaluate<T>(guarded, timeoutMs);
    }

    async function detachTarget(targetId: string, unmountAll: boolean): Promise<void> {
        const entry = attachedTargets.get(targetId);
        attachedTargets.delete(targetId);
        // Revoke credential IMMEDIATELY before awaiting async teardown
        revokeGrantForTarget(targetId);
        if (!entry) {
            refreshPrimaryTargetMetadata();
            return;
        }
        try { entry.unsubClose?.(); } catch { /* ignore */ }
        try { entry.unsubEvent?.(); } catch { /* ignore */ }
        if (entry.client.isOpen) {
            if (unmountAll) {
                try {
                    await evaluateOnHub(entry, buildOverlayUnmountScript('all'), 2_000);
                } catch {
                    // Best-effort cleanup; ignore errors if Hub is closing.
                }
            }
            await entry.client.close().catch(() => {});
        }
        refreshPrimaryTargetMetadata();
    }

    async function detachAllTargets(unmountAll: boolean): Promise<void> {
        revokeAllTargetGrants();
        const ids = [...attachedTargets.keys()];
        for (const id of ids) {
            await detachTarget(id, unmountAll);
        }
        refreshPrimaryTargetMetadata();
    }

    async function closeBridge(): Promise<void> {
        revokeAllTargetGrants();
        const active = bridge;
        bridge = null;
        if (active) {
            await active.close().catch(() => {});
        }
    }

    function pruneClosedTargets(): void {
        for (const [id, entry] of [...attachedTargets.entries()]) {
            if (!entry.client.isOpen) {
                attachedTargets.delete(id);
                revokeGrantForTarget(id);
                try { entry.unsubClose?.(); } catch { /* ignore */ }
                try { entry.unsubEvent?.(); } catch { /* ignore */ }
            }
        }
        refreshPrimaryTargetMetadata();
    }

    async function ensureConnected(forceRetry: boolean): Promise<boolean> {
        if (disposed || !anyEnabled()) { return false; }
        pruneClosedTargets();
        if (attachedTargets.size > 0 && !forceRetry) { return true; }

        const nowMs = nowFn();
        const effectiveBackoffMs = fastRecoveryActive
            ? Math.min(reconnectBackoffMs, fastRecoveryBackoffMs)
            : reconnectBackoffMs;
        if (!forceRetry && lastFailedAttemptAt > 0 && nowMs - lastFailedAttemptAt < effectiveBackoffMs) {
            return false;
        }

        let hostInfo: HostProcessInspectionResult = { found: false, hasRemoteDebuggingFlag: false };
        try {
            hostInfo = await inspectHostProcessAsync(forceRetry);
        } catch {
            hostInfo = { found: false, hasRemoteDebuggingFlag: false };
        }
        if (disposed || !anyEnabled()) { return false; }
        hostHasDebugFlag = hostInfo.found ? hostInfo.hasRemoteDebuggingFlag : undefined;

        let targetPort: number;
        let expectedBrowserWsPath: string | undefined;
        if (hostInfo.found && typeof hostInfo.explicitPort === 'number' && hostInfo.explicitPort > 0) {
            // Explicit live host `--remote-debugging-port=N` ALWAYS outranks any stale DevToolsActivePort file.
            portFilePath = undefined;
            discoveredPort = hostInfo.explicitPort;
            targetPort = hostInfo.explicitPort;
        } else if (hostInfo.found && hostInfo.hasRemoteDebuggingFlag === false) {
            // Host process confirmed running WITHOUT `--remote-debugging-port` -> ignore stale DevToolsActivePort files.
            await detachAllTargets(false);
            fastRecoveryActive = false;
            clearFastRecoveryTimer();
            lastFailedAttemptAt = nowMs;
            state = 'cdp_unavailable';
            diagnosticCode = 'host_missing_flag';
            portFilePath = resolveDevToolsActivePortPaths({
                platform,
                env,
                customUserDataDir: hostInfo.customUserDataDir,
            })[0];
            discoveredPort = undefined;
            targetUrl = undefined;
            targetTitle = undefined;
            errorMessage = undefined;
            return false;
        } else {
            const portInfo = discoverPortFn({ customUserDataDir: hostInfo.customUserDataDir });
            if (portInfo) {
                portFilePath = portInfo.filePath;
                discoveredPort = portInfo.port;
                targetPort = portInfo.port;
                expectedBrowserWsPath = portInfo.wsPath;
            } else {
                await detachAllTargets(false);
                fastRecoveryActive = false;
                clearFastRecoveryTimer();
                lastFailedAttemptAt = nowMs;
                state = 'cdp_unavailable';
                diagnosticCode = 'missing_port_file';
                portFilePath = resolveDevToolsActivePortPaths({
                    platform,
                    env,
                    customUserDataDir: hostInfo.customUserDataDir,
                })[0];
                discoveredPort = undefined;
                targetUrl = undefined;
                targetTitle = undefined;
                errorMessage = undefined;
                return false;
            }
        }

        // Verify positive browser-session ownership via /json/version when available.
        // Fail closed when expectedBrowserWsPath (from DevToolsActivePort) is set and /json/version
        // returns null or throws, so browser-session verification is never silently bypassed.
        if (fetchVersionFn) {
            let versionInfo: CdpBrowserVersionInfo | null = null;
            let versionErr: unknown = null;
            try {
                versionInfo = await fetchVersionFn(targetPort);
            } catch (err) {
                versionErr = err;
            }
            if (disposed || !anyEnabled()) { return false; }
            if (versionErr !== null || !isAuthorizedCdpBrowserSession(versionInfo, expectedBrowserWsPath, targetPort)) {
                await detachAllTargets(false);
                fastRecoveryActive = false;
                clearFastRecoveryTimer();
                lastFailedAttemptAt = nowMs;
                state = 'cdp_unavailable';
                diagnosticCode = 'no_hub_target';
                targetUrl = undefined;
                targetTitle = undefined;
                errorMessage = 'CDP browser session verification failed (missing or mismatched browser/wsPath)';
                return false;
            }
        }

        let targets: CdpTargetInfo[];
        try {
            targets = await fetchTargetsFn(targetPort);
        } catch (err) {
            if (disposed || !anyEnabled()) { return false; }
            await detachAllTargets(false);
            fastRecoveryActive = false;
            clearFastRecoveryTimer();
            lastFailedAttemptAt = nowMs;
            state = 'cdp_unavailable';
            diagnosticCode = 'port_unreachable';
            targetUrl = undefined;
            targetTitle = undefined;
            errorMessage = err instanceof Error ? err.message : String(err);
            return false;
        }

        if (disposed || !anyEnabled()) { return false; }

        const ownSidecarPorts = parseSidecarWebPort(env);
        const excludedPorts = [
            ...(options.excludeTargetPorts ?? []),
            ...dynamicExcludedPorts,
            ...ownSidecarPorts,
            ...(bridge ? [bridge.port] : []),
        ];
        const hubTargets = selectAntigravityHubTargets(targets.filter(target =>
            isCdpWebSocketAtPort(target.webSocketDebuggerUrl, targetPort)), { excludePorts: excludedPorts, env });
        if (hubTargets.length === 0) {
            await detachAllTargets(false);
            lastFailedAttemptAt = nowMs;
            state = 'cdp_unavailable';
            diagnosticCode = 'no_hub_target';
            targetUrl = undefined;
            targetTitle = undefined;
            errorMessage = 'No positively identified Antigravity Hub target page found on CDP port';
            // Genuine reachable CDP port with zero Hub windows (e.g. macOS Dock closed-window state):
            // activate fast 2–3s self-healing recovery polling.
            fastRecoveryActive = true;
            scheduleFastRecovery();
            return false;
        }

        // Reconcile existing attached targets against live target list: revoke & detach disappeared or cross-origin navigated windows
        const liveById = new Map<string, { target: CdpTargetInfo; origin: string }>();
        for (const t of hubTargets) {
            if (!t.url || !t.webSocketDebuggerUrl) { continue; }
            try {
                const origin = new URL(t.url).origin;
                const tid = (t.id && t.id.trim()) || t.webSocketDebuggerUrl;
                liveById.set(tid, { target: t, origin });
            } catch { /* ignore malformed URL */ }
        }
        for (const [existingId, entry] of [...attachedTargets.entries()]) {
            const live = liveById.get(existingId);
            if (!live || live.origin !== entry.allowedOrigin || live.target.webSocketDebuggerUrl !== entry.wsUrl) {
                await detachTarget(existingId, false);
            }
        }

        // Connect any newly discovered Hub windows first (so bridge is never started if WS connect fails),
        // then start the loopback action bridge and register per-target Origin-bound credentials.
        let lastConnectErr: unknown;
        for (const [tid, { target: hubTarget, origin: targetOrigin }] of liveById.entries()) {
            const existing = attachedTargets.get(tid);
            if (existing && existing.client.isOpen) {
                existing.targetUrl = hubTarget.url!;
                existing.targetTitle = hubTarget.title;
                continue;
            }
            try {
                const connected = await connectClientFn(hubTarget.webSocketDebuggerUrl!);
                if (disposed || !anyEnabled()) {
                    await connected.close().catch(() => {});
                    return false;
                }
                const grant = mintGrantForTarget(tid, targetOrigin, hubTarget.url!);
                const entry: AttachedHubTarget = {
                    targetId: tid,
                    wsUrl: hubTarget.webSocketDebuggerUrl!,
                    targetUrl: hubTarget.url!,
                    targetTitle: hubTarget.title,
                    allowedOrigin: targetOrigin,
                    client: connected,
                    bootstrapped: false,
                    grant,
                };
                if (typeof connected.onClose === 'function') {
                    entry.unsubClose = connected.onClose(() => {
                        handleTargetDisconnected(tid);
                    });
                }
                if (typeof connected.onEvent === 'function') {
                    entry.unsubEvent = connected.onEvent((method, params) => {
                        if (method === 'Inspector.detached' || method === 'Target.detachedFromTarget') {
                            handleTargetDisconnected(tid);
                        } else if (method === 'Page.frameNavigated') {
                            const frame = params?.frame as { parentId?: string; url?: string } | undefined;
                            // Main-frame navigation -> revoke immediately if origin changed or rotate token on reload
                            if (frame && !frame.parentId) {
                                let navOrigin = '';
                                try { navOrigin = frame.url ? new URL(frame.url).origin : ''; } catch { navOrigin = ''; }
                                revokeGrantForTarget(tid);
                                entry.bootstrapped = false;
                                if (!navOrigin || navOrigin !== entry.allowedOrigin) {
                                    handleTargetDisconnected(tid);
                                    void connected.close().catch(() => {});
                                } else {
                                    entry.grant = mintGrantForTarget(tid, entry.allowedOrigin, frame.url || entry.targetUrl);
                                }
                            }
                        }
                    });
                }
                attachedTargets.set(tid, entry);
                // Enable the CDP Page domain so Chromium/Electron emits Page.frameNavigated on reload/navigation.
                if (typeof connected.send === 'function') {
                    await connected.send('Page.enable').catch(() => {});
                    if (disposed || !anyEnabled()) {
                        await detachAllTargets(false);
                        return false;
                    }
                    if (!connected.isOpen) {
                        await detachTarget(tid, false);
                    }
                }
            } catch (err) {
                lastConnectErr = err;
                revokeGrantForTarget(tid);
            }
        }

        refreshPrimaryTargetMetadata();
        if (attachedTargets.size === 0) {
            await detachAllTargets(false);
            if (disposed || !anyEnabled()) { return false; }
            fastRecoveryActive = false;
            clearFastRecoveryTimer();
            lastFailedAttemptAt = nowMs;
            state = 'error';
            diagnosticCode = 'ws_error';
            errorMessage = lastConnectErr instanceof Error ? lastConnectErr.message : String(lastConnectErr ?? 'WebSocket connection failed');
            log(`[CDP Overlay] Connection error: ${errorMessage}`);
            return false;
        }

        // Ensure loopback action bridge is ready and bind all active target grants.
        // If bridge startup fails, immediately detach & close all open WebSockets (zero socket leak!).
        if (enableActionBridge && !bridge) {
            const primaryOrigin = attachedTargets.values().next().value?.allowedOrigin;
            try {
                const createdBridge = await createBridgeFn({
                    onAction: options.onBridgeAction,
                    allowedOrigin: primaryOrigin,
                });
                if (disposed || !anyEnabled()) {
                    await createdBridge.close().catch(() => {});
                    await detachAllTargets(false);
                    return false;
                }
                bridge = createdBridge;
                for (const entry of attachedTargets.values()) {
                    bridge.registerTargetGrant?.(entry.grant);
                }
            } catch (err) {
                await detachAllTargets(false);
                if (disposed || !anyEnabled()) { return false; }
                fastRecoveryActive = false;
                clearFastRecoveryTimer();
                lastFailedAttemptAt = nowMs;
                state = 'error';
                diagnosticCode = 'ws_error';
                errorMessage = err instanceof Error ? err.message : String(err);
                log(`[CDP Overlay] Bridge startup error: ${errorMessage}`);
                return false;
            }
        }

        fastRecoveryActive = false;
        clearFastRecoveryTimer();
        errorMessage = undefined;
        state = 'connected';
        diagnosticCode = 'connected';
        return true;
    }

    async function syncToHub(forceRetry: boolean, allowStaleSocketRetry = forceRetry): Promise<CdpStatus> {
        if (disposed || !anyEnabled()) {
            return getStatus();
        }
        const ok = await ensureConnected(forceRetry);
        if (!ok || attachedTargets.size === 0 || disposed || !anyEnabled()) {
            return getStatus();
        }

        let anySuccess = false;
        let lastEvalError: string | undefined;

        for (const [tid, entry] of [...attachedTargets.entries()]) {
            if (disposed || !anyEnabled()) { break; }
            if (!entry.client.isOpen) {
                await detachTarget(tid, false);
                continue;
            }
            try {
                if (!entry.bootstrapped || (forceRetry && !lastPayload)) {
                    await evaluateOnHub(entry, buildOverlayBootstrapScript());
                    entry.bootstrapped = true;
                }
                if (lastPayload) {
                    const scopedPayload = options.payloadForTarget?.(tid, lastPayload) ?? lastPayload;
                    const enrichedPayload: CdpOverlayPayload = bridge
                        ? { ...scopedPayload, bridgeUrl: bridge.url, bridgeToken: entry.grant.token }
                        : scopedPayload;
                    const res = await evaluateOnHub<{
                        ok?: boolean;
                        missingRuntime?: boolean;
                        buildIdMismatch?: boolean;
                        origin?: string;
                    }>(entry, buildOverlayUpdateScript(enrichedPayload, toggles, { expectedBuildId: CDP_OVERLAY_BUILD_ID }));

                    // Detect cross-origin navigation -> revoke grant IMMEDIATELY and detach!
                    if (res && typeof res.origin === 'string' && res.origin && res.origin !== entry.allowedOrigin) {
                        log(`[CDP Overlay] Origin changed on target ${tid} (${entry.allowedOrigin} -> ${res.origin}); revoking grant`);
                        await detachTarget(tid, true);
                        continue;
                    }

                    // If Hub reloaded or bundle buildId drifted between ticks, rotate per-target credential and re-bootstrap once.
                    if (res && res.missingRuntime) {
                        revokeGrantForTarget(tid);
                        entry.grant = mintGrantForTarget(tid, entry.allowedOrigin, entry.targetUrl);
                        await evaluateOnHub(entry, buildOverlayBootstrapScript());
                        const rotatedPayload: CdpOverlayPayload = bridge
                            ? { ...scopedPayload, bridgeUrl: bridge.url, bridgeToken: entry.grant.token }
                            : scopedPayload;
                        await evaluateOnHub(entry, buildOverlayUpdateScript(rotatedPayload, toggles, { expectedBuildId: CDP_OVERLAY_BUILD_ID }));
                    }
                }
                anySuccess = true;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                lastEvalError = msg;
                await detachTarget(tid, false);
                log(`[CDP Overlay] Evaluation error on target ${tid}: ${msg}`);
            }
        }

        refreshPrimaryTargetMetadata();
        // On explicit Recheck CDP, if every previously open socket failed eval (e.g. half-open stale WS),
        // retry discovery & connect once immediately so manual Recheck recovers in a single click.
        if (!anySuccess && lastEvalError && allowStaleSocketRetry && attachedTargets.size === 0 && !disposed && anyEnabled()) {
            lastFailedAttemptAt = 0;
            return syncToHub(true, false);
        }

        if (anySuccess) {
            lastInjectedAt = nowFn();
            fastRecoveryActive = false;
            clearFastRecoveryTimer();
            state = 'connected';
            diagnosticCode = 'connected';
            errorMessage = undefined;
        } else if (lastEvalError) {
            fastRecoveryActive = false;
            clearFastRecoveryTimer();
            errorMessage = lastEvalError;
            state = 'error';
            diagnosticCode = 'eval_error';
            lastFailedAttemptAt = nowFn();
        } else if (attachedTargets.size === 0) {
            state = 'cdp_unavailable';
            diagnosticCode = 'no_hub_target';
            lastFailedAttemptAt = nowFn();
            fastRecoveryActive = true;
            scheduleFastRecovery();
        }
        return getStatus();
    }

    function setToggles(nextToggles: CdpOverlayToggles): Promise<CdpStatus> {
        return enqueue(async () => {
            if (disposed) { return getStatus(); }
            const prev = { ...toggles };
            toggles = {
                appComposerRingEnabled: Boolean(nextToggles.appComposerRingEnabled),
                appTopBarEnabled: Boolean(nextToggles.appTopBarEnabled),
            };

            if (!anyEnabled()) {
                fastRecoveryActive = false;
                clearFastRecoveryTimer();
                await detachAllTargets(true);
                await closeBridge();
                state = 'disabled';
                diagnosticCode = 'disabled';
                targetUrl = undefined;
                targetTitle = undefined;
                portFilePath = undefined;
                discoveredPort = undefined;
                hostHasDebugFlag = undefined;
                errorMessage = undefined;
                lastFailedAttemptAt = 0;
                return getStatus();
            }

            // If one toggle was turned off while the other stayed on, unmount the disabled slot immediately on all windows.
            for (const entry of attachedTargets.values()) {
                if (!entry.client.isOpen) { continue; }
                if (prev.appComposerRingEnabled && !toggles.appComposerRingEnabled) {
                    await evaluateOnHub(entry, buildOverlayUnmountScript('composer'), 2_000).catch(() => {});
                }
                if (prev.appTopBarEnabled && !toggles.appTopBarEnabled) {
                    await evaluateOnHub(entry, buildOverlayUnmountScript('topbar'), 2_000).catch(() => {});
                }
            }

            getLauncherStatus(true);
            return syncToHub(true);
        });
    }

    function updatePayload(payload: CdpOverlayPayload): Promise<CdpStatus> {
        lastPayload = payload;
        if (disposed || !anyEnabled()) {
            return Promise.resolve(getStatus());
        }
        return enqueue(async () => {
            if (disposed || !anyEnabled()) {
                return getStatus();
            }
            return syncToHub(false);
        });
    }

    function recheck(): Promise<CdpStatus> {
        return enqueue(async () => {
            getLauncherStatus(true);
            if (disposed || !anyEnabled()) {
                return getStatus();
            }
            // Bypass all caches, backoff, and stale sockets on explicit Recheck CDP.
            cachedWindowsHostInfo = null;
            lastWindowsHostProbeAt = -Infinity;
            lastFailedAttemptAt = 0;
            clearFastRecoveryTimer();
            pruneClosedTargets();
            return syncToHub(true);
        });
    }

    function dispose(): Promise<void> {
        if (disposed) {
            return opQueue.then(() => undefined, () => undefined);
        }
        disposed = true;
        fastRecoveryActive = false;
        clearFastRecoveryTimer();
        toggles = { appComposerRingEnabled: false, appTopBarEnabled: false };
        return enqueue(async () => {
            await detachAllTargets(true);
            await closeBridge();
            state = 'disabled';
            diagnosticCode = 'disabled';
            targetUrl = undefined;
            targetTitle = undefined;
            portFilePath = undefined;
            discoveredPort = undefined;
            hostHasDebugFlag = undefined;
            errorMessage = undefined;
            lastFailedAttemptAt = 0;
        });
    }

    return {
        getStatus,
        setToggles,
        updatePayload,
        recheck,
        addExcludedPort,
        resolveBridgeTargetId,
        validateBridgeGrant: (token, origin, command) => Boolean(resolveBridgeTargetId(token, origin, command)),
        getActiveGrants,
        dispose,
    };
}

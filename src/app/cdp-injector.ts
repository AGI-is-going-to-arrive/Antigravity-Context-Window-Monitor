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

import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { getSafeCdpLaunchCommand, inspectCdpLauncher } from './cdp-launcher';
import {
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    buildOverlayUpdateScript,
} from './cdp-overlay-assets';
import type {
    CdpConnectionState,
    CdpDiagnosticCode,
    CdpLauncherStatus,
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

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ALLOWED_BRIDGE_COMMANDS = new Set<CdpOverlayBridgeActionCommand>(['openPanel', 'refresh', 'togglePause']);
const ALLOWED_OVERLAY_TARGET_TABS = new Set<CdpOverlayTargetTab>([
    'overview',
    'gm',
    'sessions',
    'cost',
    'models',
    'calendar',
    'accounts',
    'settings',
]);

function parseOverlayTargetTab(raw: unknown): CdpOverlayTargetTab | undefined {
    if (typeof raw !== 'string') { return undefined; }
    const trimmed = raw.trim() as CdpOverlayTargetTab;
    return ALLOWED_OVERLAY_TARGET_TABS.has(trimmed) ? trimmed : undefined;
}

// ─── Cross-Platform DevToolsActivePort Discovery ─────────────────────────────

export interface DevToolsPortDiscoveryOptions {
    platform?: NodeJS.Platform;
    homedir?: string;
    env?: NodeJS.ProcessEnv;
    explicitPaths?: readonly string[];
    customUserDataDir?: string;
    readFileSyncFn?: (filePath: string, encoding: 'utf8') => string;
}

export interface DevToolsActivePortInfo {
    port: number;
    wsPath: string;
    filePath: string;
}

/**
 * Resolve cross-platform candidate paths for Antigravity's `DevToolsActivePort` file.
 * Prepends `<customUserDataDir>/DevToolsActivePort` when a custom `--user-data-dir` is detected,
 * checks `AGY_BROWSER_ACTIVE_PORT_FILE` next (if set), followed by default OS paths:
 * - macOS: `~/Library/Application Support/Antigravity/DevToolsActivePort`
 * - Windows: `%APPDATA%\Antigravity\DevToolsActivePort`
 * - Linux: `${XDG_CONFIG_HOME:-~/.config}/Antigravity/DevToolsActivePort`
 */
export function resolveDevToolsActivePortPaths(options: DevToolsPortDiscoveryOptions = {}): string[] {
    if (options.explicitPaths && options.explicitPaths.length > 0) {
        return [...options.explicitPaths];
    }
    const platform = options.platform ?? process.platform;
    const home = options.homedir ?? os.homedir();
    const env = options.env ?? process.env;
    const paths: string[] = [];
    const pushUnique = (candidate: string) => {
        const trimmed = candidate.trim();
        if (trimmed && !paths.includes(trimmed)) {
            paths.push(trimmed);
        }
    };

    if (typeof options.customUserDataDir === 'string' && options.customUserDataDir.trim()) {
        const customDir = options.customUserDataDir.trim();
        if (platform === 'win32' && (/^[A-Za-z]:/.test(customDir) || customDir.includes('\\'))) {
            pushUnique(path.win32.join(customDir, 'DevToolsActivePort'));
        } else {
            pushUnique(path.posix.join(customDir, 'DevToolsActivePort'));
        }
    }

    if (typeof env.AGY_BROWSER_ACTIVE_PORT_FILE === 'string' && env.AGY_BROWSER_ACTIVE_PORT_FILE.trim()) {
        pushUnique(env.AGY_BROWSER_ACTIVE_PORT_FILE);
    }

    if (platform === 'darwin') {
        pushUnique(path.posix.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
    } else if (platform === 'win32') {
        const appData = typeof env.APPDATA === 'string' && env.APPDATA.trim()
            ? env.APPDATA.trim()
            : '';
        if (appData) {
            pushUnique(path.win32.join(appData, 'Antigravity', 'DevToolsActivePort'));
        }
        pushUnique(path.win32.join(home, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
    } else {
        const xdgConfig = typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()
            ? env.XDG_CONFIG_HOME.trim()
            : path.posix.join(home, '.config');
        pushUnique(path.posix.join(xdgConfig, 'Antigravity', 'DevToolsActivePort'));
    }
    return paths;
}

/**
 * Parse the 2-line Chromium `DevToolsActivePort` file (`<port>\n<wsPath>`).
 */
export function parseDevToolsActivePortContent(raw: string): { port: number; wsPath: string } | null {
    if (typeof raw !== 'string') { return null; }
    const cleaned = raw.replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { return null; }
    if (!/^\d+$/.test(lines[0])) { return null; }
    const port = Number(lines[0]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { return null; }
    const wsPath = lines[1];
    if (!wsPath.startsWith('/') || /\s/.test(wsPath)) { return null; }
    return { port, wsPath };
}

/**
 * Read and parse Antigravity's `DevToolsActivePort` file if present.
 * Returns `null` silently when absent or unreadable (normal on Antigravity 2.33+
 * unless the user opted in via `--remote-debugging-port=0`).
 */
export function discoverDevToolsActivePort(
    options: DevToolsPortDiscoveryOptions = {},
): DevToolsActivePortInfo | null {
    const readFn = options.readFileSyncFn ?? ((p: string, enc: 'utf8') => fs.readFileSync(p, enc));
    for (const filePath of resolveDevToolsActivePortPaths(options)) {
        try {
            const raw = readFn(filePath, 'utf8');
            const parsed = parseDevToolsActivePortContent(raw);
            if (parsed) {
                return { ...parsed, filePath };
            }
        } catch {
            // Missing or unreadable DevToolsActivePort is expected when CDP is disabled.
        }
    }
    return null;
}

// ─── Read-Only Grandparent Antigravity Host Process Inspection ───────────────

export interface HostProcessInspectionResult {
    found: boolean;
    pid?: number;
    commandLine?: string;
    hasRemoteDebuggingFlag: boolean;
    /** Explicit port N when `--remote-debugging-port=N` with N > 0 (`undefined` when `=0` or absent). */
    explicitPort?: number;
    /** Custom `--user-data-dir=<dir>` if passed to the host Antigravity process. */
    customUserDataDir?: string;
}

export interface ProcessTableEntry {
    pid: number;
    ppid: number;
    command: string;
}

export interface InspectHostProcessOptions {
    platform?: NodeJS.Platform;
    startPid?: number;
    timeoutMs?: number;
    maxHops?: number;
    readProcessEntry?: (pid: number) => ProcessTableEntry | null;
}

function extractExecutableToken(commandLine: string): string {
    const trimmed = commandLine.trim();
    if (!trimmed) { return ''; }
    if (trimmed.startsWith('"')) {
        const end = trimmed.indexOf('"', 1);
        return end > 1 ? trimmed.slice(1, end) : trimmed.slice(1);
    }
    if (trimmed.startsWith('\'')) {
        const end = trimmed.indexOf('\'', 1);
        return end > 1 ? trimmed.slice(1, end) : trimmed.slice(1);
    }
    const flagIdx = trimmed.search(/\s+--/);
    const prefix = flagIdx >= 0 ? trimmed.slice(0, flagIdx) : trimmed;
    const firstSpace = prefix.search(/\s/);
    if (firstSpace < 0) { return prefix; }
    // Handle macOS/Windows unquoted app paths containing spaces (e.g. "/My Apps/Antigravity.app/Contents/MacOS/Antigravity ...")
    // while strictly rejecting shell wrappers like "zsh -c '/Applications/Antigravity.app/...'"
    const macMatch = prefix.match(/^(\/[^"']+\.app\/Contents\/MacOS\/[^\s"']+)(?=\s|$)/i);
    if (macMatch && !/\s-\S/.test(macMatch[1])) { return macMatch[1]; }
    const exeMatch = prefix.match(/^([A-Za-z]:\\[^"']+\.exe)(?=\s|$)/i);
    if (exeMatch && !/\s-\S/.test(exeMatch[1])) { return exeMatch[1]; }
    return prefix.slice(0, firstSpace);
}

/**
 * Pure parser for an Antigravity App main process command line.
 * Identifies the Antigravity Desktop main process (strictly excluding Antigravity IDE,
 * Electron helper/renderer processes, `language_server`, and sidecar processes) and extracts
 * `--remote-debugging-port` and `--user-data-dir`.
 */
export function parseAntigravityHostCommandLine(commandLine: string): {
    isAntigravityHost: boolean;
    hasRemoteDebuggingFlag: boolean;
    explicitPort?: number;
    customUserDataDir?: string;
} {
    const raw = typeof commandLine === 'string' ? commandLine.trim() : '';
    if (!raw) {
        return { isAntigravityHost: false, hasRemoteDebuggingFlag: false };
    }

    // Strictly exclude Antigravity IDE, Antigravity Tools, Electron helper/child processes,
    // language_server, and our own sidecar/launcher scripts.
    if (
        /\bantigravity[\s-]+ide\b/i.test(raw)
        || /\bantigravity[\s-]+tools\b/i.test(raw)
        || /\bantigravity\s+helper\b/i.test(raw)
        || /\blanguage_server\b/i.test(raw)
        || /\bantigravity-context-monitor\b/i.test(raw)
        || /\bantigravity-cdp\b/i.test(raw)
        || /(?:^|\s)--type=/i.test(raw)
    ) {
        return { isAntigravityHost: false, hasRemoteDebuggingFlag: false };
    }

    const exe = extractExecutableToken(raw);
    const isMacMain = /\/Antigravity\.app\/Contents\/MacOS\/Antigravity$/i.test(exe);
    const isWinMain = /(?:^|[\\/])Antigravity\.exe$/i.test(exe);
    const isLinuxMain = /(?:^|\/)antigravity$/.test(exe);

    if (!isMacMain && !isWinMain && !isLinuxMain) {
        return { isAntigravityHost: false, hasRemoteDebuggingFlag: false };
    }

    let hasRemoteDebuggingFlag = false;
    let explicitPort: number | undefined;
    const portMatch = raw.match(/(?:^|\s)--remote-debugging-port(?:=|\s+)["']?(\d+)["']?(?=\s|$)/);
    if (portMatch) {
        hasRemoteDebuggingFlag = true;
        const parsedPort = Number(portMatch[1]);
        if (Number.isSafeInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
            explicitPort = parsedPort;
        }
    } else if (/(?:^|\s)--remote-debugging-port(?==|\s|$)/.test(raw)) {
        hasRemoteDebuggingFlag = true;
    }

    const quotedDirMatch = raw.match(/(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)')(?=\s|$)/);
    const unquotedDirMatch = quotedDirMatch
        ? null
        : raw.match(/(?:^|\s)--user-data-dir(?:=|\s+)([^\s"'](?:.*?))(?=\s+--|$)/);
    const customUserDataDir = (quotedDirMatch?.[1] ?? quotedDirMatch?.[2] ?? unquotedDirMatch?.[1] ?? '').trim() || undefined;

    return {
        isAntigravityHost: true,
        hasRemoteDebuggingFlag,
        ...(explicitPort !== undefined ? { explicitPort } : {}),
        ...(customUserDataDir ? { customUserDataDir } : {}),
    };
}

function readLinuxProcEntry(pid: number): ProcessTableEntry | null {
    try {
        const statRaw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const closeParen = statRaw.lastIndexOf(')');
        if (closeParen < 0) { return null; }
        const after = statRaw.slice(closeParen + 1).trim().split(/\s+/);
        // after[0] is process state, after[1] is ppid
        const ppid = Number(after[1]);
        if (!Number.isSafeInteger(ppid) || ppid < 0) { return null; }
        const cmdlineBuf = fs.readFileSync(`/proc/${pid}/cmdline`);
        const args = cmdlineBuf
            .toString('utf8')
            .split('\0')
            .filter(Boolean)
            .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg));
        if (args.length === 0) { return null; }
        return { pid, ppid, command: args.join(' ') };
    } catch {
        return null;
    }
}

function readPosixPsEntry(pid: number, timeoutMs: number): ProcessTableEntry | null {
    try {
        const out = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
            encoding: 'utf8',
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const line = out.trim();
        if (!line) { return null; }
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (!match) { return null; }
        const ppid = Number(match[1]);
        if (!Number.isSafeInteger(ppid) || ppid < 0) { return null; }
        return { pid, ppid, command: match[2].trim() };
    } catch {
        return null;
    }
}

/**
 * Read-only walk up `process.ppid` -> grandparent PID to locate the host Antigravity App
 * main process and inspect its `--remote-debugging-port` and `--user-data-dir` argv flags.
 * Fast (~100ms timeout cap) and completely fail-safe (returns `{ found: false }` on any error).
 */
export function inspectAntigravityHostProcess(
    options: InspectHostProcessOptions = {},
): HostProcessInspectionResult {
    const platform = options.platform ?? process.platform;
    const timeoutMs = options.timeoutMs ?? 120;
    const maxHops = options.maxHops ?? 6;
    const startPid = options.startPid ?? process.ppid;

    if (!Number.isSafeInteger(startPid) || startPid <= 1) {
        return { found: false, hasRemoteDebuggingFlag: false };
    }

    const readEntry = options.readProcessEntry ?? ((pid: number): ProcessTableEntry | null => {
        if (platform === 'linux') {
            return readLinuxProcEntry(pid) ?? readPosixPsEntry(pid, timeoutMs);
        }
        if (platform === 'darwin') {
            return readPosixPsEntry(pid, timeoutMs);
        }
        // On Windows, spawning PowerShell/CIM synchronously risks blocking the sidecar event loop
        // beyond the ~100ms budget; skip cleanly unless an explicit reader is injected.
        return null;
    });

    const visited = new Set<number>();
    let currentPid = startPid;

    for (let hop = 0; hop < maxHops && currentPid > 1 && !visited.has(currentPid); hop++) {
        visited.add(currentPid);
        let entry: ProcessTableEntry | null = null;
        try {
            entry = readEntry(currentPid);
        } catch {
            entry = null;
        }
        if (!entry) { break; }

        const parsed = parseAntigravityHostCommandLine(entry.command);
        if (parsed.isAntigravityHost) {
            return {
                found: true,
                pid: entry.pid,
                commandLine: entry.command,
                hasRemoteDebuggingFlag: parsed.hasRemoteDebuggingFlag,
                ...(parsed.explicitPort !== undefined ? { explicitPort: parsed.explicitPort } : {}),
                ...(parsed.customUserDataDir ? { customUserDataDir: parsed.customUserDataDir } : {}),
            };
        }

        if (!Number.isSafeInteger(entry.ppid) || entry.ppid <= 1 || entry.ppid === currentPid) {
            break;
        }
        currentPid = entry.ppid;
    }

    return { found: false, hasRemoteDebuggingFlag: false };
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

/**
 * Select ONLY the Antigravity Hub target page from CDP `/json/list` targets.
 * Guarantees unrelated websites, DevTools pages, extensions, and sidecar views/iframes are NEVER touched.
 */
export function selectAntigravityHubTarget(
    targets: readonly CdpTargetInfo[],
    options: { excludePorts?: readonly number[]; env?: NodeJS.ProcessEnv } = {},
): CdpTargetInfo | null {
    const excluded = new Set(options.excludePorts ?? []);
    for (const ownPort of parseSidecarWebPort(options.env ?? process.env)) {
        excluded.add(ownPort);
    }

    let bestTarget: CdpTargetInfo | null = null;
    let bestScore = -1;

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

        let score = 10;
        const isRootPath = pathname === '/' || pathname === '/index.html' || pathname.startsWith('/hub');
        const hasAgyTitle = titleLower.includes('antigravity');
        const isJetskiTitle = titleLower.includes('jetski web') || titleLower === 'jetski';

        if (hasAgyTitle && isRootPath) {
            score = 100;
        } else if (isJetskiTitle && isRootPath) {
            score = 95;
        } else if (hasAgyTitle) {
            score = 75;
        } else if (isJetskiTitle) {
            score = 70;
        } else if (isRootPath) {
            score = 40;
        }

        // Antigravity 2.33+ Desktop Hub serves over https://127.0.0.1:<port>/,
        // whereas sidecars use http://127.0.0.1:<port>/ or plugin://.
        if (isHttps) {
            score += 40;
        }

        if (score > bestScore) {
            bestScore = score;
            bestTarget = target;
        }
    }

    return bestTarget;
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
        let parsed: { id?: number; result?: unknown; error?: { code?: number; message?: string } };
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        if (typeof parsed.id !== 'number') { return; }
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
        this._closed = true;
        for (const [id, pending] of this._pending.entries()) {
            this._pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(err);
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

export interface OverlayActionBridgeHandle {
    readonly url: string;
    readonly port: number;
    readonly token: string;
    setAllowedOrigin(origin: string | undefined): void;
    close(): Promise<void>;
}

/**
 * Start a loopback-only (`127.0.0.1`) authenticated HTTP bridge for overlay quick actions
 * (`openPanel`, `refresh`, `togglePause`). Enforces 256-bit `X-Monitor-Token` and strict `Origin`.
 */
export async function createOverlayActionBridge(options: {
    onAction?: (action: CdpOverlayBridgeAction) => Promise<void> | void;
    allowedOrigin?: string;
    token?: string;
} = {}): Promise<OverlayActionBridgeHandle> {
    const token = options.token && options.token.length >= 32 ? options.token : generateSessionToken();
    let allowedOrigin = options.allowedOrigin;

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

        if (pathname !== '/api/overlay/action') {
            send(404, { ok: false, error: 'Not Found' });
            return;
        }

        if (method === 'OPTIONS') {
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
                send(413, { ok: false, error: 'Payload too large' }, check.origin);
                return;
            }
            chunks.push(buf);
        });
        req.on('error', () => {
            if (!finished) {
                finished = true;
                send(400, { ok: false, error: 'Request stream error' }, check.origin);
            }
        });
        req.on('end', () => {
            if (finished) { return; }
            finished = true;
            let parsed: Record<string, unknown>;
            try {
                const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!json || typeof json !== 'object' || Array.isArray(json)) {
                    send(400, { ok: false, error: 'Invalid JSON body' }, check.origin);
                    return;
                }
                parsed = json as Record<string, unknown>;
            } catch {
                send(400, { ok: false, error: 'Malformed JSON body' }, check.origin);
                return;
            }
            const cmd = typeof parsed.command === 'string' ? parsed.command.trim() as CdpOverlayBridgeActionCommand : '' as CdpOverlayBridgeActionCommand;
            if (!ALLOWED_BRIDGE_COMMANDS.has(cmd)) {
                send(400, { ok: false, error: 'Unsupported overlay action' }, check.origin);
                return;
            }
            const source = parsed.source === 'composer' || parsed.source === 'topbar' ? parsed.source : undefined;
            const targetTab = parseOverlayTargetTab(parsed.targetTab);
            Promise.resolve(options.onAction?.({ command: cmd, source, ...(targetTab ? { targetTab } : {}) }))
                .then(() => send(200, { ok: true, command: cmd }, check.origin))
                .catch(() => send(500, { ok: false, error: 'Action handler failed' }, check.origin));
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
        close(): Promise<void> {
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
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    reconnectBackoffMs?: number;
    enableActionBridge?: boolean;
    excludeTargetPorts?: readonly number[];
    onBridgeAction?: (action: CdpOverlayBridgeAction) => Promise<void> | void;
    log?: (msg: string) => void;
    now?: () => number;
    // Injectable dependencies for deterministic testing
    discoverActivePort?: (opts?: { customUserDataDir?: string }) => DevToolsActivePortInfo | null;
    inspectHostProcess?: () => HostProcessInspectionResult;
    inspectLauncher?: () => CdpLauncherStatus;
    fetchTargets?: (port: number) => Promise<CdpTargetInfo[]>;
    connectClient?: (wsUrl: string) => Promise<CdpClientLike>;
    createBridge?: (opts: {
        onAction?: (action: CdpOverlayBridgeAction) => Promise<void> | void;
        allowedOrigin?: string;
    }) => Promise<OverlayActionBridgeHandle>;
}

export interface CdpAmbientOverlayManager {
    getStatus(): CdpStatus;
    setToggles(toggles: CdpOverlayToggles): Promise<CdpStatus>;
    updatePayload(payload: CdpOverlayPayload): Promise<CdpStatus>;
    recheck?(): Promise<CdpStatus>;
    addExcludedPort?(port: number): void;
    dispose(): Promise<void>;
}

/**
 * Manages the full opt-in lifecycle for Antigravity App ambient Shadow DOM overlays:
 * - Strictly disabled by default (zero CDP probing until user turns a toggle on).
 * - Independent `appComposerRingEnabled` and `appTopBarEnabled` toggles with immediate unmount on disable.
 * - Silent, structured `cdp_unavailable` degradation with explicit `diagnosticCode` when Antigravity runs without `--remote-debugging-port`.
 * - Serialized connection/sync queue so concurrent `setToggles` / `updatePayload` / `recheck` calls never open duplicate WebSockets.
 * - Authenticated `127.0.0.1` loopback action bridge with 256-bit `X-Monitor-Token` & strict `Origin`.
 */
export function createCdpAmbientOverlayManager(
    options: CdpAmbientOverlayManagerOptions = {},
): CdpAmbientOverlayManager & { recheck(): Promise<CdpStatus>; addExcludedPort(port: number): void } {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const reconnectBackoffMs = options.reconnectBackoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
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
    // When a test injects `discoverActivePort` without `inspectHostProcess`, keep it hermetic
    // rather than inspecting the live developer/CI host process tree.
    const inspectHostProcessFn = options.inspectHostProcess
        ?? (options.discoverActivePort
            ? () => ({ found: false, hasRemoteDebuggingFlag: false })
            : () => inspectAntigravityHostProcess({ platform }));
    const inspectLauncherFn = options.inspectLauncher ?? (() => inspectCdpLauncher({ platform, env }));
    const fetchTargetsFn = options.fetchTargets ?? ((port: number) => fetchCdpTargets(port));
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

    let client: CdpClientLike | null = null;
    let bootstrapped = false;
    let bridge: OverlayActionBridgeHandle | null = null;
    let disposed = false;
    let opQueue: Promise<unknown> = Promise.resolve();

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

    function getStatus(): CdpStatus {
        const launcherStatus = getLauncherStatus(false);
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

    async function detachClient(unmountAll: boolean): Promise<void> {
        const active = client;
        client = null;
        bootstrapped = false;
        if (active && active.isOpen) {
            if (unmountAll) {
                try {
                    await active.evaluate(buildOverlayUnmountScript('all'), 2_000);
                } catch {
                    // Best-effort cleanup; ignore errors if Hub is closing.
                }
            }
            await active.close().catch(() => {});
        }
    }

    async function closeBridge(): Promise<void> {
        const active = bridge;
        bridge = null;
        if (active) {
            await active.close().catch(() => {});
        }
    }

    async function ensureConnected(forceRetry: boolean): Promise<boolean> {
        if (disposed || !anyEnabled()) { return false; }
        if (client && client.isOpen) { return true; }
        if (client && !client.isOpen) {
            client = null;
            bootstrapped = false;
        }

        const nowMs = nowFn();
        if (!forceRetry && lastFailedAttemptAt > 0 && nowMs - lastFailedAttemptAt < reconnectBackoffMs) {
            return false;
        }

        let hostInfo: HostProcessInspectionResult = { found: false, hasRemoteDebuggingFlag: false };
        try {
            hostInfo = inspectHostProcessFn();
        } catch {
            hostInfo = { found: false, hasRemoteDebuggingFlag: false };
        }
        hostHasDebugFlag = hostInfo.found ? hostInfo.hasRemoteDebuggingFlag : undefined;

        const portInfo = discoverPortFn({ customUserDataDir: hostInfo.customUserDataDir });
        let targetPort: number;
        if (portInfo) {
            portFilePath = portInfo.filePath;
            discoveredPort = portInfo.port;
            targetPort = portInfo.port;
        } else if (hostInfo.found && typeof hostInfo.explicitPort === 'number' && hostInfo.explicitPort > 0) {
            // Host process passed an explicit fixed port (e.g. `--remote-debugging-port=9222`);
            // probe it directly even when DevToolsActivePort is absent.
            portFilePath = undefined;
            discoveredPort = hostInfo.explicitPort;
            targetPort = hostInfo.explicitPort;
        } else {
            lastFailedAttemptAt = nowMs;
            state = 'cdp_unavailable';
            diagnosticCode = hostInfo.found && hostInfo.hasRemoteDebuggingFlag === false
                ? 'host_missing_flag'
                : 'missing_port_file';
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

        let targets: CdpTargetInfo[];
        try {
            targets = await fetchTargetsFn(targetPort);
        } catch (err) {
            if (disposed || !anyEnabled()) { return false; }
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
        const hubTarget = selectAntigravityHubTarget(targets, { excludePorts: excludedPorts, env });
        if (!hubTarget || !hubTarget.webSocketDebuggerUrl) {
            lastFailedAttemptAt = nowMs;
            state = 'cdp_unavailable';
            diagnosticCode = 'no_hub_target';
            targetUrl = undefined;
            targetTitle = undefined;
            errorMessage = 'No Antigravity Hub target page found on CDP port';
            return false;
        }

        try {
            const connected = await connectClientFn(hubTarget.webSocketDebuggerUrl);
            if (disposed || !anyEnabled()) {
                await connected.close().catch(() => {});
                return false;
            }
            client = connected;
            bootstrapped = false;
            targetUrl = hubTarget.url;
            targetTitle = hubTarget.title;
            errorMessage = undefined;
            state = 'connected';
            diagnosticCode = 'connected';

            if (enableActionBridge) {
                const targetOrigin = hubTarget.url ? new URL(hubTarget.url).origin : undefined;
                if (!bridge) {
                    const createdBridge = await createBridgeFn({
                        onAction: options.onBridgeAction,
                        allowedOrigin: targetOrigin,
                    });
                    if (disposed || !anyEnabled()) {
                        await createdBridge.close().catch(() => {});
                        await detachClient(false);
                        return false;
                    }
                    bridge = createdBridge;
                } else {
                    bridge.setAllowedOrigin(targetOrigin);
                }
            }
            return true;
        } catch (err) {
            await detachClient(false);
            if (disposed || !anyEnabled()) { return false; }
            lastFailedAttemptAt = nowMs;
            state = 'error';
            diagnosticCode = 'ws_error';
            targetUrl = undefined;
            targetTitle = undefined;
            errorMessage = err instanceof Error ? err.message : String(err);
            log(`[CDP Overlay] Connection error: ${errorMessage}`);
            return false;
        }
    }

    async function syncToHub(forceRetry: boolean): Promise<CdpStatus> {
        if (disposed || !anyEnabled()) {
            return getStatus();
        }
        const ok = await ensureConnected(forceRetry);
        if (!ok || !client || disposed || !anyEnabled()) {
            return getStatus();
        }

        try {
            if (!bootstrapped) {
                await client.evaluate(buildOverlayBootstrapScript());
                bootstrapped = true;
            }
            if (lastPayload) {
                const enrichedPayload: CdpOverlayPayload = bridge
                    ? { ...lastPayload, bridgeUrl: bridge.url, bridgeToken: bridge.token }
                    : lastPayload;
                const res = await client.evaluate<{ ok?: boolean; missingRuntime?: boolean }>(
                    buildOverlayUpdateScript(enrichedPayload, toggles),
                );
                // If Hub reloaded between ticks, re-bootstrap seamlessly once.
                if (res && res.missingRuntime) {
                    await client.evaluate(buildOverlayBootstrapScript());
                    await client.evaluate(buildOverlayUpdateScript(enrichedPayload, toggles));
                }
            }
            lastInjectedAt = nowFn();
            state = 'connected';
            diagnosticCode = 'connected';
            errorMessage = undefined;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errorMessage = msg;
            state = 'error';
            diagnosticCode = 'eval_error';
            lastFailedAttemptAt = nowFn();
            await detachClient(false);
            log(`[CDP Overlay] Evaluation error: ${msg}`);
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
                await detachClient(true);
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
                getLauncherStatus(true);
                return getStatus();
            }

            // If one toggle was turned off while the other stayed on, unmount the disabled slot immediately.
            if (client && client.isOpen) {
                if (prev.appComposerRingEnabled && !toggles.appComposerRingEnabled) {
                    await client.evaluate(buildOverlayUnmountScript('composer'), 2_000).catch(() => {});
                }
                if (prev.appTopBarEnabled && !toggles.appTopBarEnabled) {
                    await client.evaluate(buildOverlayUnmountScript('topbar'), 2_000).catch(() => {});
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
            lastFailedAttemptAt = 0;
            if (client && !client.isOpen) {
                client = null;
                bootstrapped = false;
            }
            return syncToHub(true);
        });
    }

    function dispose(): Promise<void> {
        if (disposed) {
            return opQueue.then(() => undefined, () => undefined);
        }
        disposed = true;
        toggles = { appComposerRingEnabled: false, appTopBarEnabled: false };
        return enqueue(async () => {
            await detachClient(true);
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
        dispose,
    };
}

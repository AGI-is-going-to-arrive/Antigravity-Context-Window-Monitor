/**
 * Lightweight, Pure-Node CDP Availability & Status Discovery Probe (§4.1).
 *
 * Strictly zero `vscode` imports, zero external npm dependencies, and ZERO
 * import of `cdp-overlay-assets.ts` or `cdp-injector.ts` overlay scripts.
 *
 * Enables IDE Settings (`webview-panel.ts`) to probe CDP availability, inspect
 * persistent launcher status, and display platform launch guides without pulling
 * the 157 KB browser overlay assets or WebSocket injector runtime into the IDE
 * VSIX bundle.
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
    CDP_LAUNCHER_DISPLAY_NAME,
    LINUX_APPIMAGE_PROCESS_RE,
    defaultCommandExists,
    getCdpLauncherPlatformNotes,
    getSafeCdpLaunchCommand,
    isMacAppBundleInstalled,
    resolveCoreCdpLauncherPaths,
    resolveLinuxFlatpakPortFilePath,
    resolveLinuxXdgConfigHome,
    type CoreLauncherPathOptions,
} from '../core/cdp-launcher-core';
import type { CdpLauncherStatus, CdpPlatformGuide, CdpStatus } from './sidecar-types';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_CDP_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const WINDOWS_HOST_PROBE_TIMEOUT_MS = 1_500;

// ─── DevToolsActivePort Discovery ────────────────────────────────────────────

export interface DevToolsPortDiscoveryOptions {
    platform?: NodeJS.Platform;
    homedir?: string;
    env?: NodeJS.ProcessEnv;
    /** Optional custom `--user-data-dir` detected from host process argv. */
    customUserDataDir?: string;
    explicitPaths?: readonly string[];
    readFileSyncFn?: (filePath: string, encoding: 'utf8') => string;
}

export interface DevToolsActivePortInfo {
    port: number;
    wsPath: string;
    filePath: string;
}

/**
 * Resolve cross-platform candidate paths for Antigravity's `DevToolsActivePort` file.
 * Checks custom `--user-data-dir`, `AGY_BROWSER_ACTIVE_PORT_FILE`, default OS profile
 * locations, and Linux Flatpak sandbox config path.
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
        const pathApi = platform === 'win32' ? path.win32 : path.posix;
        // A known host profile is authoritative. Its missing port file cannot
        // authorize a sibling profile, even if that profile is running.
        return pathApi.isAbsolute(customDir) ? [pathApi.join(customDir, 'DevToolsActivePort')] : [];
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
        const xdgConfig = resolveLinuxXdgConfigHome(home, env);
        pushUnique(path.posix.join(xdgConfig, 'Antigravity', 'DevToolsActivePort'));
        pushUnique(resolveLinuxFlatpakPortFilePath(home));
    }
    return paths;
}

/**
 * Parse Chromium's 2-line `DevToolsActivePort` file (`<port>\n<wsPath>`).
 */
export function parseDevToolsActivePortContent(raw: string): { port: number; wsPath: string } | null {
    if (typeof raw !== 'string') { return null; }
    const cleaned = raw.replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
            // Absent/unreadable port file is normal when CDP is disabled.
        }
    }
    return null;
}

// ─── Read-Only Host Process `--remote-debugging-port` Detection ──────────────

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

export interface InspectHostProcessAsyncOptions extends InspectHostProcessOptions {
    readProcessEntryAsync?: (pid: number) => Promise<ProcessTableEntry | null>;
    execFileAsync?: (
        file: string,
        args: readonly string[],
        opts: { timeout: number; windowsHide: boolean },
    ) => Promise<{ stdout: string; stderr?: string }>;
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
    const macMatch = prefix.match(/^(\/[^"']+\.app\/Contents\/MacOS\/[^\s"']+)(?=\s|$)/i);
    if (macMatch && !/\s-\S/.test(macMatch[1])) { return macMatch[1]; }
    const exeMatch = prefix.match(/^([A-Za-z]:\\[^"']+\.exe)(?=\s|$)/i);
    if (exeMatch && !/\s-\S/.test(exeMatch[1])) { return exeMatch[1]; }
    return prefix.slice(0, firstSpace);
}

/**
 * Pure parser for an Antigravity App main process command line.
 * Strictly excludes Antigravity IDE, Tools, Electron helpers/renderers, `language_server`,
 * and sidecar/launcher scripts, and extracts `--remote-debugging-port` and `--user-data-dir`.
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

    const exe = extractExecutableToken(raw);
    if (
        /\bantigravity[\s-]+ide\b/i.test(exe)
        || /\bantigravity[\s-]+tools\b/i.test(exe)
        || /\bantigravity\s+helper\b/i.test(exe)
        || /\blanguage_server\b/i.test(exe)
        || /\bantigravity-context-monitor\b/i.test(exe)
        || /\bantigravity-cdp\b/i.test(exe)
        || /(?:^|\s)["']?--type=/i.test(raw)
    ) {
        return { isAntigravityHost: false, hasRemoteDebuggingFlag: false };
    }

    const isMacMain = /\/Antigravity\.app\/Contents\/MacOS\/Antigravity$/i.test(exe);
    const isWinMain = /(?:^|[\\/])Antigravity\.exe$/i.test(exe);
    const isLinuxMain = /(?:^|\/)antigravity$/.test(exe) || LINUX_APPIMAGE_PROCESS_RE.test(exe);

    if (!isMacMain && !isWinMain && !isLinuxMain) {
        return { isAntigravityHost: false, hasRemoteDebuggingFlag: false };
    }

    const args = (raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [])
        .map((arg) => arg.replace(/["']/g, ''));
    const portOption = '--remote-debugging-port';
    const portIndex = args.findIndex((arg) => arg === portOption || arg.startsWith(portOption + '='));
    const portText = portIndex === -1 ? '' : args[portIndex] === portOption
        ? args[portIndex + 1] ?? ''
        : args[portIndex].slice(portOption.length + 1);
    const parsedPort = /^\d+$/.test(portText) ? Number(portText) : NaN;
    const hasRemoteDebuggingFlag = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535;
    const explicitPort = hasRemoteDebuggingFlag && parsedPort > 0 ? parsedPort : undefined;

    // Windows command lines and Linux /proc rendering may quote the whole switch.
    const quotedSwitch = raw.match(/(?:^|\s)"--user-data-dir=([^"]+)"(?=\s|$)/)
        ?? raw.match(/(?:^|\s)'--user-data-dir=([^']+)'(?=\s|$)/);
    const quotedDirMatch = raw.match(/(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)')(?=\s|$)/);
    const unquotedDirMatch = quotedDirMatch
        ? null
        : raw.match(/(?:^|\s)--user-data-dir(?:=|\s+)([^\s"'](?:.*?))(?=\s+--|$)/);
    const customUserDataDir = (quotedSwitch?.[1] ?? quotedDirMatch?.[1] ?? quotedDirMatch?.[2] ?? unquotedDirMatch?.[1] ?? '').trim() || undefined;

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

function toFoundHostResult(
    entry: ProcessTableEntry,
    parsed: ReturnType<typeof parseAntigravityHostCommandLine>,
): HostProcessInspectionResult {
    return {
        found: true,
        pid: entry.pid,
        commandLine: entry.command,
        hasRemoteDebuggingFlag: parsed.hasRemoteDebuggingFlag,
        ...(parsed.explicitPort !== undefined ? { explicitPort: parsed.explicitPort } : {}),
        ...(parsed.customUserDataDir ? { customUserDataDir: parsed.customUserDataDir } : {}),
    };
}

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
            return toFoundHostResult(entry, parsed);
        }

        if (!Number.isSafeInteger(entry.ppid) || entry.ppid <= 1 || entry.ppid === currentPid) {
            break;
        }
        currentPid = entry.ppid;
    }

    return { found: false, hasRemoteDebuggingFlag: false };
}

function defaultExecFileAsync(
    file: string,
    args: readonly string[],
    opts: { timeout: number; windowsHide: boolean },
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, [...args], {
            encoding: 'utf8',
            timeout: opts.timeout,
            windowsHide: opts.windowsHide,
            maxBuffer: 256 * 1024,
        }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        });
    });
}

function parseWindowsProcessJson(rawStdout: string): Map<number, ProcessTableEntry> {
    const table = new Map<number, ProcessTableEntry>();
    const trimmed = rawStdout.replace(/^\uFEFF/, '').trim();
    if (!trimmed) { return table; }
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return table;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
        if (!item || typeof item !== 'object') { continue; }
        const rec = item as Record<string, unknown>;
        const pid = Number(rec.ProcessId ?? rec.pid);
        const ppid = Number(rec.ParentProcessId ?? rec.ppid);
        const command = typeof rec.CommandLine === 'string'
            ? rec.CommandLine.trim()
            : (typeof rec.command === 'string' ? rec.command.trim() : '');
        if (Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(ppid) && ppid >= 0 && command) {
            table.set(pid, { pid, ppid, command });
        }
    }
    return table;
}

export async function inspectAntigravityHostProcessAsync(
    options: InspectHostProcessAsyncOptions = {},
): Promise<HostProcessInspectionResult> {
    const platform = options.platform ?? process.platform;
    const maxHops = options.maxHops ?? 6;
    const startPid = options.startPid ?? process.ppid;

    if (!Number.isSafeInteger(startPid) || startPid <= 1) {
        return { found: false, hasRemoteDebuggingFlag: false };
    }

    if (options.readProcessEntryAsync) {
        const visited = new Set<number>();
        let currentPid = startPid;
        for (let hop = 0; hop < maxHops && currentPid > 1 && !visited.has(currentPid); hop++) {
            visited.add(currentPid);
            let entry: ProcessTableEntry | null = null;
            try {
                entry = await options.readProcessEntryAsync(currentPid);
            } catch {
                entry = null;
            }
            if (!entry) { break; }
            const parsed = parseAntigravityHostCommandLine(entry.command);
            if (parsed.isAntigravityHost) {
                return toFoundHostResult(entry, parsed);
            }
            if (!Number.isSafeInteger(entry.ppid) || entry.ppid <= 1 || entry.ppid === currentPid) {
                break;
            }
            currentPid = entry.ppid;
        }
        return { found: false, hasRemoteDebuggingFlag: false };
    }

    if (platform !== 'win32' || options.readProcessEntry) {
        return inspectAntigravityHostProcess(options);
    }

    const timeoutMs = options.timeoutMs ?? WINDOWS_HOST_PROBE_TIMEOUT_MS;
    const execAsync = options.execFileAsync ?? defaultExecFileAsync;
    const safeStartPid = Math.floor(startPid);
    const safeHops = Math.min(10, Math.max(1, Math.floor(maxHops)));
    const psScript = [
        `$p=${safeStartPid}; $seen=@{}; $out=@();`,
        `for($i=0; $i -lt ${safeHops} -and $p -gt 1 -and -not $seen.ContainsKey($p); $i++) {`,
        '  $seen[$p]=$true;',
        '  $proc=Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p) -ErrorAction SilentlyContinue;',
        '  if(-not $proc){ break }',
        '  $out += [pscustomobject]@{ ProcessId=[int]$proc.ProcessId; ParentProcessId=[int]$proc.ParentProcessId; CommandLine=[string]$proc.CommandLine };',
        '  $p=[int]$proc.ParentProcessId;',
        '}',
        '$out | ConvertTo-Json -Compress',
    ].join(' ');

    try {
        const { stdout } = await execAsync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
            { timeout: timeoutMs, windowsHide: true },
        );
        const procTable = parseWindowsProcessJson(stdout);
        if (procTable.size === 0) {
            return { found: false, hasRemoteDebuggingFlag: false };
        }
        return inspectAntigravityHostProcess({
            platform: 'win32',
            startPid: safeStartPid,
            maxHops: safeHops,
            readProcessEntry: (pid) => procTable.get(pid) ?? null,
        });
    } catch {
        return { found: false, hasRemoteDebuggingFlag: false };
    }
}

// ─── Loopback Validation & Positive Hub Target Identification ────────────────

export interface CdpTargetInfo {
    id?: string;
    type?: string;
    title?: string;
    url?: string;
    webSocketDebuggerUrl?: string;
}

export interface CdpBrowserVersionInfo {
    Browser?: string;
    'User-Agent'?: string;
    webSocketDebuggerUrl?: string;
}

export function isLoopbackHostname(hostname: string): boolean {
    const clean = hostname.trim().toLowerCase();
    return LOOPBACK_HOSTNAMES.has(clean);
}

export function isLoopbackUrl(
    rawUrl: string,
    allowedProtocols: readonly string[] = ['http:', 'https:', 'ws:', 'wss:'],
): boolean {
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

/** A discovery response may only advertise sockets on the inspected loopback port. */
export function isCdpWebSocketAtPort(rawUrl: unknown, port: number): boolean {
    if (typeof rawUrl !== 'string' || !isLoopbackUrl(rawUrl, ['ws:'])) { return false; }
    return Number(new URL(rawUrl).port || 80) === port;
}

function parseSidecarWebPorts(env: NodeJS.ProcessEnv = process.env): number[] {
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
 * Positively verify browser-session ownership for a discovered CDP port.
 * Rejects recycled ports owned by a different browser instance when `expectedWsPath`
 * (from `DevToolsActivePort`) does not match `/json/version`'s `webSocketDebuggerUrl`.
 */
export function isAuthorizedCdpBrowserSession(
    versionInfo: CdpBrowserVersionInfo | null | undefined,
    expectedWsPath?: string,
    expectedPort?: number,
): boolean {
    if (!versionInfo || typeof versionInfo !== 'object') {
        return false;
    }
    const wsUrl = typeof versionInfo.webSocketDebuggerUrl === 'string' ? versionInfo.webSocketDebuggerUrl.trim() : '';
    if (!isLoopbackUrl(wsUrl, ['ws:'])) { return false; }
    const socket = new URL(wsUrl);
    if (!/^\/devtools\/browser\/[\w-]+$/.test(socket.pathname) || socket.search || socket.hash) { return false; }
    if (expectedPort !== undefined && Number(socket.port || 80) !== expectedPort) { return false; }
    if (expectedWsPath !== undefined && socket.pathname !== expectedWsPath) { return false; }
    const browserStr = `${versionInfo.Browser || ''} ${versionInfo['User-Agent'] || ''}`.trim();
    if (browserStr && !/(?:antigravity|electron|chrome|chromium|headlesschrome)/i.test(browserStr)) {
        return false;
    }
    return true;
}

/**
 * Select ALL positively identified Antigravity / Jetski Hub target pages from CDP `/json/list`,
 * ordered highest-confidence first. NEVER selects unidentified loopback pages.
 */
export function selectAntigravityHubTargets(
    targets: readonly CdpTargetInfo[],
    options: { excludePorts?: readonly number[]; env?: NodeJS.ProcessEnv } = {},
): CdpTargetInfo[] {
    const excluded = new Set(options.excludePorts ?? []);
    for (const ownPort of parseSidecarWebPorts(options.env ?? process.env)) {
        excluded.add(ownPort);
    }

    const scored: Array<{ target: CdpTargetInfo; score: number }> = [];
    const seenKeys = new Set<string>();

    for (const target of targets) {
        if (!target || target.type !== 'page' || typeof target.url !== 'string' || typeof target.title !== 'string'
            || (target.id !== undefined && typeof target.id !== 'string')) { continue; }
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

        if (isHttps) {
            score += 40;
        }

        const dedupKey = (target.id && target.id.trim()) || target.webSocketDebuggerUrl;
        if (seenKeys.has(dedupKey)) { continue; }
        seenKeys.add(dedupKey);
        scored.push({ target, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.target);
}

export function selectAntigravityHubTarget(
    targets: readonly CdpTargetInfo[],
    options: { excludePorts?: readonly number[]; env?: NodeJS.ProcessEnv } = {},
): CdpTargetInfo | null {
    return selectAntigravityHubTargets(targets, options)[0] ?? null;
}

// ─── Loopback HTTP Probes (`/json/version` & `/json/list`) ───────────────────

function isConnectionRefusedError(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH';
}

function fetchCdpJsonFromHost<T>(
    hostname: string,
    port: number,
    reqPath: string,
    timeoutMs: number,
): Promise<T> {
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
                if (total > MAX_CDP_HTTP_BODY_BYTES) {
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

async function fetchCdpJsonWithHostFallback<T>(
    port: number,
    reqPath: string,
    timeoutMs: number,
    options: { hosts?: readonly string[] },
    validate: (parsed: unknown) => T,
): Promise<T> {
    const hosts = options.hosts && options.hosts.length > 0 ? options.hosts : ['127.0.0.1', '::1'];
    let lastErr: unknown = null;
    for (let i = 0; i < hosts.length; i++) {
        try {
            return validate(await fetchCdpJsonFromHost<unknown>(hosts[i], port, reqPath, timeoutMs));
        } catch (err) {
            lastErr = err;
            if (i + 1 < hosts.length && isConnectionRefusedError(err)) {
                continue;
            }
            throw err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch CDP ${reqPath}`);
}

export async function fetchCdpBrowserVersion(
    port: number,
    timeoutMs = 2_000,
    options: { hosts?: readonly string[] } = {},
): Promise<CdpBrowserVersionInfo | null> {
    try {
        return await fetchCdpJsonWithHostFallback(port, '/json/version', timeoutMs, options, (parsed) => (
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as CdpBrowserVersionInfo
                : null
        ));
    } catch {
        return null;
    }
}

export async function fetchCdpTargets(
    port: number,
    timeoutMs = 2_500,
    options: { hosts?: readonly string[] } = {},
): Promise<CdpTargetInfo[]> {
    return fetchCdpJsonWithHostFallback(port, '/json/list', timeoutMs, options, (parsed) => {
        if (!Array.isArray(parsed)) {
            throw new Error('CDP /json/list returned non-array JSON');
        }
        return parsed as CdpTargetInfo[];
    });
}

// ─── Lightweight Platform Guide & Launcher Status Inspection ─────────────────

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

/**
 * Pure-Node non-blocking launcher status check using `src/core/cdp-launcher-core.ts`.
 * Safe for IDE Settings without pulling in icon generators or overlay assets.
 */
export function inspectCdpLauncherStatus(opts: CoreLauncherPathOptions = {}): CdpLauncherStatus {
    const resolved = resolveCoreCdpLauncherPaths(opts);
    const safeTerminalCommand = getSafeCdpLaunchCommand(resolved.platform);
    const { noteEn, noteZh } = getCdpLauncherPlatformNotes(resolved.platform, resolved.launcherPath);
    const existsFn = opts.fsOps?.existsSync ?? fs.existsSync;

    let installed = false;
    let targetAppFound = false;

    if (resolved.platform === 'darwin') {
        const candidates = resolved.macCandidateAppDirs ?? (resolved.macAppDir ? [resolved.macAppDir] : []);
        installed = candidates.some((dir) => isMacAppBundleInstalled(dir, opts.fsOps));
        targetAppFound = Boolean(resolved.targetAppPath && existsFn(resolved.targetAppPath));
    } else if (resolved.platform === 'win32' && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
        const hasDesktopLnk = existsFn(resolved.winDesktopLnkPath)
            || Boolean(
                resolved.winFallbackDesktopLnkPath
                && resolved.winFallbackDesktopLnkPath.toLowerCase() !== resolved.winDesktopLnkPath.toLowerCase()
                && existsFn(resolved.winFallbackDesktopLnkPath),
            );
        installed = hasDesktopLnk || existsFn(resolved.winStartMenuLnkPath);
        targetAppFound = Boolean(resolved.targetAppPath && existsFn(resolved.targetAppPath));
    } else if (resolved.platform === 'linux' && resolved.linuxDesktopEntryPath && resolved.linuxWrapperPath) {
        installed = existsFn(resolved.linuxDesktopEntryPath) && existsFn(resolved.linuxWrapperPath);
        const existsCmdFn = opts.commandExistsFn
            ?? ((cmd: string) => defaultCommandExists(cmd, opts.env ?? process.env, opts.fsOps));
        if (resolved.targetAppPath && resolved.targetAppPath.startsWith('flatpak:')) {
            targetAppFound = existsCmdFn('flatpak');
        } else if (resolved.targetAppPath && resolved.targetAppPath !== 'antigravity') {
            targetAppFound = existsFn(resolved.targetAppPath);
        } else {
            targetAppFound = existsCmdFn('antigravity');
        }
    }

    return {
        supported: resolved.supported,
        platform: resolved.platform,
        installed,
        launcherPath: resolved.launcherPath,
        displayName: CDP_LAUNCHER_DISPLAY_NAME,
        targetAppFound,
        ...(resolved.targetAppPath ? { targetAppPath: resolved.targetAppPath } : {}),
        safeTerminalCommand,
        noteEn,
        noteZh,
    };
}

// ─── High-Level Lightweight CDP Availability Probe (for IDE Settings) ────────

export interface ProbeCdpAvailabilityOptions {
    composerEnabled: boolean;
    topBarEnabled: boolean;
    /** When `true`, probe CDP even if both overlays are currently disabled (e.g. manual Recheck). */
    probeEvenWhenDisabled?: boolean;
    /** Whether to inspect the ancestor host process for `--remote-debugging-port` flags. Default: `false` (IDE runs outside App host process). */
    inspectHostProcess?: boolean;
    platform?: NodeJS.Platform;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    launcherOptions?: CoreLauncherPathOptions;
    // Injectable hooks for hermetic testing
    inspectLauncherStatusFn?: () => CdpLauncherStatus;
    inspectHostProcessFn?: () => Promise<HostProcessInspectionResult> | HostProcessInspectionResult;
    discoverActivePortFn?: (opts?: DevToolsPortDiscoveryOptions) => DevToolsActivePortInfo | null;
    fetchBrowserVersionFn?: (port: number, timeoutMs?: number) => Promise<CdpBrowserVersionInfo | null>;
    fetchTargetsFn?: (port: number, timeoutMs?: number) => Promise<CdpTargetInfo[]>;
}

/**
 * Lightweight, zero-overlay-asset CDP status probe for IDE Settings.
 *
 * Behavior:
 * - Zero OS/network probing when both `composerEnabled` and `topBarEnabled` are false
 *   (unless `probeEvenWhenDisabled` is explicitly set).
 * - Honors live host `--remote-debugging-port=N` over stale `DevToolsActivePort` files,
 *   and reports `host_missing_flag` when host is confirmed running without the flag.
 * - Verifies `/json/version` browser-session ownership (fail-closed when `wsPath`
 *   from `DevToolsActivePort` does not match).
 * - Requires positive Antigravity/Jetski Hub target identification via `/json/list`.
 */
export async function probeCdpAvailability(
    options: ProbeCdpAvailabilityOptions,
): Promise<CdpStatus> {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const timeoutMs = options.timeoutMs ?? 2_500;
    const platformGuide = getCdpPlatformGuide(platform);

    if (!options.composerEnabled && !options.topBarEnabled && !options.probeEvenWhenDisabled) {
        return {
            state: 'disabled',
            diagnosticCode: 'disabled',
            composerEnabled: false,
            topBarEnabled: false,
            platformGuide,
        };
    }

    const launcherStatus = options.inspectLauncherStatusFn
        ? options.inspectLauncherStatusFn()
        : inspectCdpLauncherStatus({
            platform,
            homeDir: options.homeDir,
            env,
            ...options.launcherOptions,
        });

    let hostInfo: HostProcessInspectionResult = { found: false, hasRemoteDebuggingFlag: false };
    if (options.inspectHostProcess || options.inspectHostProcessFn) {
        try {
            hostInfo = options.inspectHostProcessFn
                ? await options.inspectHostProcessFn()
                : await inspectAntigravityHostProcessAsync({ platform });
        } catch {
            hostInfo = { found: false, hasRemoteDebuggingFlag: false };
        }
    }

    const hostHasDebugFlag = hostInfo.found ? hostInfo.hasRemoteDebuggingFlag : undefined;
    let targetPort: number;
    let portFilePath: string | undefined;
    let expectedWsPath: string | undefined;
    const makeUnavailable = (
        diagnosticCode: CdpStatus['diagnosticCode'],
        extra: Partial<CdpStatus> = {},
    ): CdpStatus => ({
        state: 'cdp_unavailable',
        diagnosticCode,
        ...(portFilePath ? { portFilePath } : {}),
        composerEnabled: options.composerEnabled,
        topBarEnabled: options.topBarEnabled,
        ...(hostHasDebugFlag !== undefined ? { hostHasDebugFlag } : {}),
        launcherStatus,
        platformGuide,
        ...extra,
    });
    const firstCandidatePortFile = () => resolveDevToolsActivePortPaths({
        platform,
        homedir: options.homeDir,
        env,
        customUserDataDir: hostInfo.customUserDataDir,
    })[0];

    if (hostInfo.found && typeof hostInfo.explicitPort === 'number' && hostInfo.explicitPort > 0) {
        targetPort = hostInfo.explicitPort;
    } else if (hostInfo.found && hostInfo.hasRemoteDebuggingFlag === false) {
        return makeUnavailable('host_missing_flag', {
            portFilePath: firstCandidatePortFile(),
            hostHasDebugFlag: false,
        });
    } else {
        const discoverFn = options.discoverActivePortFn ?? discoverDevToolsActivePort;
        const portInfo = discoverFn({
            platform,
            homedir: options.homeDir,
            env,
            customUserDataDir: hostInfo.customUserDataDir,
        });
        if (!portInfo) {
            return makeUnavailable('missing_port_file', { portFilePath: firstCandidatePortFile() });
        }
        targetPort = portInfo.port;
        portFilePath = portInfo.filePath;
        expectedWsPath = portInfo.wsPath;
    }

    // Verify both fixed and dynamic endpoints before inspecting any pages.
    const fetchVersionFn = options.fetchBrowserVersionFn ?? fetchCdpBrowserVersion;
    let versionInfo: CdpBrowserVersionInfo | null = null;
    let versionErr: unknown = null;
    try {
        versionInfo = await fetchVersionFn(targetPort, Math.min(timeoutMs, 2_000));
    } catch (err) {
        versionErr = err;
    }

    if (versionErr !== null || versionInfo === null) {
        return makeUnavailable('port_unreachable', {
            discoveredPort: targetPort,
            errorMessage: versionErr instanceof Error
                ? `CDP browser session verification failed: ${versionErr.message}`
                : 'CDP browser session verification failed (/json/version unavailable)',
        });
    } else if (!isAuthorizedCdpBrowserSession(versionInfo, expectedWsPath, targetPort)) {
        return makeUnavailable('no_hub_target', {
            discoveredPort: targetPort,
            errorMessage: 'CDP browser session verification failed (mismatched browser/wsPath)',
        });
    }

    const fetchTargetsFn = options.fetchTargetsFn ?? fetchCdpTargets;
    let targets: CdpTargetInfo[];
    try {
        targets = await fetchTargetsFn(targetPort, timeoutMs);
    } catch (err) {
        return makeUnavailable('port_unreachable', {
            discoveredPort: targetPort,
            errorMessage: err instanceof Error ? err.message : String(err),
        });
    }

    const hubTarget = selectAntigravityHubTargets(targets, { env })
        .find((target) => isCdpWebSocketAtPort(target.webSocketDebuggerUrl, targetPort));
    if (!hubTarget || !hubTarget.webSocketDebuggerUrl) {
        return makeUnavailable('no_hub_target', {
            discoveredPort: targetPort,
            errorMessage: 'No Antigravity Hub target page found on CDP port',
        });
    }

    return {
        state: 'connected',
        diagnosticCode: 'connected',
        ...(portFilePath ? { portFilePath } : {}),
        discoveredPort: targetPort,
        targetUrl: hubTarget.url,
        targetTitle: hubTarget.title,
        composerEnabled: options.composerEnabled,
        topBarEnabled: options.topBarEnabled,
        ...(hostHasDebugFlag !== undefined ? { hostHasDebugFlag } : {}),
        launcherStatus,
        platformGuide,
    };
}

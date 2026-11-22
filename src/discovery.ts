import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';
import { readFileSync, existsSync, readdirSync, readlinkSync, statSync } from 'fs';
import { homedir, userInfo } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

// ─── WSL Detection & Dynamic Windows Host Bridging ───────────────────────────
// Cached tri-state: null = untested, true = WSL, false = not WSL.
let wslDetected: boolean | null = null;
let cachedWslWinRoot: string | null = null;
let cachedWslUserProfile: string | null | undefined = undefined;

/**
 * Detect if running inside Windows Subsystem for Linux.
 * Checks /proc/version for Microsoft/WSL signature. Result is cached.
 */
export function isWSL(): boolean {
    if (wslDetected !== null) {
        return wslDetected;
    }
    if (process.platform !== 'linux') {
        wslDetected = false;
        return false;
    }
    try {
        const version = readFileSync('/proc/version', 'utf-8');
        wslDetected = /microsoft|wsl/i.test(version);
    } catch {
        wslDetected = false;
    }
    return wslDetected;
}

/** Reset WSL detection & path caches (exported for testing). */
export function resetWslCache(): void {
    wslDetected = null;
    cachedWslWinRoot = null;
    cachedWslUserProfile = undefined;
}

function unescapeProcMountPath(raw: string): string {
    return raw.replace(/\\([0-7]{3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Parse `/proc/mounts` lines to discover WSL Windows drive mount points (both
 * WSL1 `drvfs` and WSL2 `9p ... aname=drvfs;path=D:\` entries, including custom
 * `/etc/wsl.conf` `[automount] root` paths like `/c` or `/win/d`).
 * Returns a map of uppercase drive letter (e.g. `'C'`, `'D'`) -> POSIX mount path.
 */
export function parseWslDrvFsMounts(procMountsContent: string): Map<string, string> {
    const mounts = new Map<string, string>();
    for (const rawLine of procMountsContent.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) { continue; }
        const cols = line.split(/\s+/);
        if (cols.length < 4) { continue; }
        const source = unescapeProcMountPath(cols[0]);
        const mountPoint = unescapeProcMountPath(cols[1]).replace(/\/+$/, '') || '/';
        const fsType = cols[2].toLowerCase();
        const opts = cols[3];

        if (fsType === 'drvfs') {
            const driveMatch = source.match(/^([A-Za-z]):/);
            if (driveMatch) {
                mounts.set(driveMatch[1].toUpperCase(), mountPoint);
            }
            continue;
        }

        if (fsType === '9p') {
            // WSL2 mounts Windows drives via 9p with `aname=drvfs;path=C:\;...`
            if (/(?:^|,)aname=drvfs(?:;|,|$)/i.test(opts)) {
                const pathMatch = opts.match(/(?:^|;|,)path=([A-Za-z]):/i);
                if (pathMatch) {
                    mounts.set(pathMatch[1].toUpperCase(), mountPoint);
                    continue;
                }
            }
            const srcDrive = source.match(/^([A-Za-z]):[\\/]?$/);
            if (srcDrive) {
                mounts.set(srcDrive[1].toUpperCase(), mountPoint);
            }
        }
    }
    return mounts;
}

/**
 * Convert a Windows drive-qualified path (e.g. `D:\Windows`, `C:\Users\Alice`)
 * into its WSL POSIX path using discovered `/proc/mounts` drvfs mount points
 * (falling back to `/mnt/<drive>` when mount table is unavailable).
 */
export function convertWindowsPathToWsl(
    winPath: string,
    mounts?: ReadonlyMap<string, string>,
    fallbackMountRoot = '/mnt',
): string | null {
    const trimmed = winPath.trim();
    const match = trimmed.match(/^([A-Za-z]):(?:[\\/](.*))?$/);
    if (!match) { return null; }
    const drive = match[1].toUpperCase();
    const rest = (match[2] || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const baseMount = (mounts?.get(drive) || `${fallbackMountRoot.replace(/\/+$/, '')}/${drive.toLowerCase()}`)
        .replace(/\/+$/, '');
    return rest ? `${baseMount}/${rest}` : baseMount;
}

export interface WslPathResolveOptions {
    env?: NodeJS.ProcessEnv;
    procMountsContent?: string;
    existsSyncFn?: (filePath: string) => boolean;
    username?: string;
}

function readProcMountsSafe(overrideContent?: string): string {
    if (overrideContent !== undefined) { return overrideContent; }
    try {
        return readFileSync('/proc/mounts', 'utf-8');
    } catch {
        return '';
    }
}

/**
 * Dynamically resolve the Windows system root directory from inside WSL
 * (e.g. `/mnt/c/Windows`, `/mnt/d/Windows`, `/c/Windows`) without hardcoding `/mnt/c`.
 *
 * Resolution order:
 * 1. Env vars (`SystemRoot` / `SYSTEMROOT` / `windir` / `WINDIR`) mapped through `/proc/mounts`
 * 2. Inherited Windows `System32` directory in `PATH`
 * 3. Mounted drvfs drives from `/proc/mounts` containing `<mount>/Windows/System32`
 * 4. Default `/mnt/c/Windows` fallback
 */
export function resolveWslWindowsRoot(options?: WslPathResolveOptions): string {
    const useCache = !options;
    if (useCache && cachedWslWinRoot !== null) {
        return cachedWslWinRoot;
    }

    const env = options?.env ?? process.env;
    const existsFn = options?.existsSyncFn ?? existsSync;
    const mounts = parseWslDrvFsMounts(readProcMountsSafe(options?.procMountsContent));

    const finish = (resolved: string): string => {
        const clean = resolved.replace(/\/+$/, '') || '/mnt/c/Windows';
        if (useCache) { cachedWslWinRoot = clean; }
        return clean;
    };

    // 1. Explicit Windows SystemRoot/windir env var (e.g. forwarded via WSLENV)
    for (const rawWinRoot of [env.SystemRoot, env.SYSTEMROOT, env.windir, env.WINDIR]) {
        if (!rawWinRoot || !rawWinRoot.trim()) { continue; }
        const trimmed = rawWinRoot.trim();
        if (trimmed.startsWith('/')) {
            return finish(trimmed);
        }
        const converted = convertWindowsPathToWsl(trimmed, mounts);
        if (converted) {
            return finish(converted);
        }
    }

    // 2. WSL interop inherits Windows System32 on PATH (works for any drive & custom automount root)
    const pathVar = env.PATH || env.Path || '';
    for (const entry of pathVar.split(':')) {
        const clean = entry.trim().replace(/\/+$/, '');
        const sys32Match = clean.match(/^(\/[^:]+\/Windows)\/System32(?:\/.*)?$/i);
        if (sys32Match) {
            return finish(sys32Match[1]);
        }
    }

    // 3. Probe drvfs mounts from /proc/mounts (preferring C:, then sorted remaining drives)
    if (mounts.size > 0) {
        const orderedDrives = [...mounts.keys()].sort((a, b) => {
            if (a === 'C') { return -1; }
            if (b === 'C') { return 1; }
            return a.localeCompare(b);
        });
        for (const drive of orderedDrives) {
            const mountPoint = mounts.get(drive)!;
            const candidate = `${mountPoint}/Windows`;
            if (existsFn(`${candidate}/System32`) || existsFn(`${candidate}/system32`)) {
                return finish(candidate);
            }
        }
        const preferredMount = mounts.get('C') || mounts.get(orderedDrives[0])!;
        return finish(`${preferredMount}/Windows`);
    }

    return finish('/mnt/c/Windows');
}

/**
 * Async WSL Windows root resolver that augments `resolveWslWindowsRoot()` with
 * `wslpath -u` when sync env/PATH/mount discovery fell back to the default path.
 */
export async function resolveWslWindowsRootAsync(options?: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
}): Promise<string> {
    const syncRoot = resolveWslWindowsRoot(options?.env ? { env: options.env } : undefined);
    if (existsSync(`${syncRoot}/System32`) || existsSync(`${syncRoot}/system32`)) {
        return syncRoot;
    }
    const env = options?.env ?? process.env;
    const rawWinRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR || 'C:\\Windows';
    try {
        const res = await execFileAsync('wslpath', ['-u', rawWinRoot], {
            encoding: 'utf-8',
            timeout: 2000,
            signal: options?.signal,
            windowsHide: true,
        });
        const converted = res.stdout.trim().replace(/\/+$/, '');
        if (converted.startsWith('/')) {
            if (!options?.env) { cachedWslWinRoot = converted; }
            return converted;
        }
    } catch {
        // wslpath unavailable or failed; keep sync resolution
    }
    return syncRoot;
}

/**
 * Build the WSL POSIX path to a Windows system executable given the resolved
 * WSL Windows root directory (e.g. `/mnt/d/Windows` or `/c/Windows`).
 */
export function buildWslWindowsExePath(wslWinRoot: string | null | undefined, kind: WindowsExeKind): string {
    const bare: Record<WindowsExeKind, string> = {
        wmic: 'WMIC.exe',
        powershell: 'powershell.exe',
        netstat: 'netstat.exe',
    };
    if (!wslWinRoot || !wslWinRoot.trim()) {
        return bare[kind];
    }
    const root = wslWinRoot.trim().replace(/\/+$/, '');
    const rel: Record<WindowsExeKind, string> = {
        wmic: 'System32/wbem/WMIC.exe',
        powershell: 'System32/WindowsPowerShell/v1.0/powershell.exe',
        netstat: 'System32/netstat.exe',
    };
    return `${root}/${rel[kind]}`;
}

/**
 * Resolve the Windows host `%USERPROFILE%` path accessible from inside WSL
 * (e.g. `/mnt/c/Users/Alice` or `/win/d/Users/Alice`) so Antigravity data stored
 * under `%USERPROFILE%\.gemini\antigravity` can be bridged cleanly from WSL.
 */
export function resolveWslWindowsUserProfile(options?: WslPathResolveOptions): string | null {
    const useCache = !options;
    if (useCache && cachedWslUserProfile !== undefined) {
        return cachedWslUserProfile;
    }

    const env = options?.env ?? process.env;
    const existsFn = options?.existsSyncFn ?? existsSync;
    const mounts = parseWslDrvFsMounts(readProcMountsSafe(options?.procMountsContent));

    const finish = (resolved: string | null): string | null => {
        const clean = resolved ? resolved.replace(/\/+$/, '') : null;
        if (useCache) { cachedWslUserProfile = clean; }
        return clean;
    };

    // 1. Explicit Windows USERPROFILE env vars (e.g. via WSLENV)
    for (const rawProfile of [env.ANTIGRAVITY_WIN_USERPROFILE, env.USERPROFILE]) {
        if (!rawProfile || !rawProfile.trim()) { continue; }
        const trimmed = rawProfile.trim();
        if (trimmed.startsWith('/')) {
            return finish(trimmed);
        }
        const converted = convertWindowsPathToWsl(trimmed, mounts);
        if (converted) {
            return finish(converted);
        }
    }

    // 2. Infer Windows user profile from inherited Windows AppData entries in WSL PATH
    const pathVar = env.PATH || env.Path || '';
    for (const entry of pathVar.split(':')) {
        const clean = entry.trim().replace(/\/+$/, '');
        const userMatch = clean.match(/^(\/[^:]+\/Users\/[^/:]+)\/AppData(?:\/|$)/i);
        if (userMatch) {
            return finish(userMatch[1]);
        }
    }

    // 3. Probe `<mount>/Users/<username>` on drvfs mounts if `.gemini/antigravity` exists there
    let uname = options?.username ?? env.USER ?? env.LOGNAME ?? '';
    if (!uname) {
        try { uname = userInfo().username; } catch { uname = ''; }
    }
    if (uname && mounts.size > 0) {
        const orderedDrives = [...mounts.keys()].sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a.localeCompare(b)));
        for (const drive of orderedDrives) {
            const candidate = `${mounts.get(drive)!}/Users/${uname}`;
            if (existsFn(`${candidate}/.gemini/antigravity`) || existsFn(`${candidate}/.gemini`)) {
                return finish(candidate);
            }
        }
    }

    return finish(null);
}

// ─── Windows Process Discovery: wmic availability cache ──────────────────────
// Tri-state: null = untested, true = wmic works, false = wmic missing.
// Once set to false (e.g. Windows 11 25H2), subsequent poll cycles skip
// straight to PowerShell Get-CimInstance, avoiding ~170ms wasted per poll.
let wmicAvailable: boolean | null = null;

/** Reset wmic availability cache (exported for testing). */
export function resetWmicCache(): void {
    wmicAvailable = null;
}

// ─── Windows Executable Absolute Paths (CR-#62) ──────────────────────────────
// The native Windows branch previously invoked wmic/powershell.exe/netstat by
// BARE NAME, relying on the Extension Host's inherited PATH. A GUI-launched
// Electron Extension Host is NOT guaranteed to inherit the PATH entries for
// System32\wbem (wmic) or System32\WindowsPowerShell\v1.0 (powershell.exe), so
// execFile could throw `spawn <name> ENOENT` and discovery silently returned
// null ("LS not found"). Deriving absolute paths from %SystemRoot% removes this
// PATH dependence — mirroring what the WSL branch already did with /mnt/c/...
export type WindowsExeKind = 'wmic' | 'powershell' | 'netstat';

/**
 * Build the absolute path to a Windows system executable from %SystemRoot%.
 * Pure function (systemRoot injected) so it is unit-testable on any OS.
 * Falls back to the bare command name when systemRoot is empty/undefined —
 * it NEVER produces a broken "undefined\System32\..." path.
 */
export function buildWindowsExePath(systemRoot: string | undefined, kind: WindowsExeKind): string {
    const bare: Record<WindowsExeKind, string> = {
        wmic: 'wmic',
        powershell: 'powershell.exe',
        netstat: 'netstat',
    };
    if (!systemRoot || !systemRoot.trim()) {
        return bare[kind];
    }
    // Normalize: strip trailing slashes/backslashes, then use backslash separators.
    const root = systemRoot.trim().replace(/[\\/]+$/, '');
    const rel: Record<WindowsExeKind, string> = {
        wmic: 'System32\\wbem\\WMIC.exe',
        powershell: 'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        netstat: 'System32\\NETSTAT.EXE',
    };
    return `${root}\\${rel[kind]}`;
}

// CR-#62: one-time PATH diagnostic. Printed on the first discovery attempt so a
// truncated/sanitized Extension Host PATH (missing System32\wbem or
// WindowsPowerShell\v1.0) is immediately visible in the output channel. This is
// what turns the high-confidence PATH-ENOENT hypothesis into a closed loop.
// Emits no secrets — only presence booleans and SystemRoot.
let pathDiagLogged = false;

/** Reset one-time PATH diagnostic flag (exported for testing). */
export function resetPathDiagLog(): void {
    pathDiagLogged = false;
}

function logDiscoveryPathOnce(log?: (msg: string) => void): void {
    if (pathDiagLogged || !log) { return; }
    pathDiagLogged = true;
    if (process.platform !== 'win32') { return; }
    const p = process.env.Path || process.env.PATH || '';
    const low = p.toLowerCase();
    log(`PATH check: hasWbem=${low.includes('wbem')} hasWindowsPowerShell=${low.includes('windowspowershell')} SystemRoot=${process.env.SystemRoot || process.env.windir || '(unset)'}`);
}

export type LSSurface = 'app' | 'ide' | 'cli' | 'unknown';
export type LSDiscoverySource = 'env' | 'hub-file' | 'process' | 'hint';

export interface LSInfo {
    pid: number;
    csrfToken: string;
    port: number;
    useTls: boolean;
    /** Loopback hostname; omitted when default '127.0.0.1', set to '::1' for IPv6-only sockets. */
    hostname?: string;
    /** Detected Antigravity runtime surface (populated by options-based discovery & discoverFromEnv). */
    surface?: LSSurface;
    /** How this LS endpoint was discovered (populated by options-based discovery & discoverFromEnv). */
    source?: LSDiscoverySource;
}

/** Alias preserving camelCase naming for consumers expecting `LsInfo`. */
export type LsInfo = LSInfo;

/** Optional connection identity exported by the current IDE's built-in extension. */
export interface LSConnectionHint {
    port: number;
    csrfToken: string;
}

/** Options object for unified Antigravity App + IDE discovery. */
export interface DiscoverLanguageServerOptions {
    workspaceUri?: string;
    signal?: AbortSignal;
    log?: (msg: string) => void;
    hint?: LSConnectionHint;
    /** Prefer Antigravity App standalone hub or Antigravity IDE hub when both are running. */
    preferredSurface?: 'app' | 'ide';
    /** Environment map to read ANTIGRAVITY_LS_ADDRESS / ANTIGRAVITY_CSRF_TOKEN from (defaults to process.env). */
    env?: NodeJS.ProcessEnv;
    /** Override daemon directory containing hub_<port>.json files (defaults to ~/.gemini/antigravity/daemon). */
    daemonDir?: string;
    /** Explicitly enable or disable env-var discovery. Defaults to true unless preferredSurface === 'ide' or hint is provided. */
    useEnv?: boolean;
}

/** Parsed loopback address from ANTIGRAVITY_LS_ADDRESS. */
export interface ParsedLsAddress {
    hostname: string;
    port: number;
    useTls?: boolean;
    ipv6Only?: boolean;
    allowIpv6Fallback?: boolean;
}

/** Parsed record from ~/.gemini/antigravity/daemon/hub_<port>.json. */
export interface HubDiscoveryRecord {
    pid: number;
    httpPort: number | null;
    httpsPort: number | null;
    csrfToken: string;
    lsVersion?: string;
}

/**
 * Ordered read-only CSRF-authenticated Connect-RPC endpoints used to probe candidate ports.
 * - GetStatus: lightweight 2-byte `{}` response on agy v1.5.14+ and modern language_server (CSRF-enforced).
 * - GetUnleashData: legacy fallback for older language_server builds (removed in agy v1.5.14).
 * - GetUserStatus: core RPC the extension requires anyway; ultimate future-proofing if both above are removed.
 */
export const PROBE_ENDPOINTS = ['GetStatus', 'GetUnleashData', 'GetUserStatus'] as const;

function validPortNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65535
        ? value : null;
}

/** Parse a daemon hub_<port>.json payload into a validated HubDiscoveryRecord. */
export function parseHubDiscoveryJson(raw: string): HubDiscoveryRecord | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
        const obj = parsed as Record<string, unknown>;
        const csrfToken = typeof obj.csrfToken === 'string' ? obj.csrfToken : '';
        if (!csrfToken || /\s/.test(csrfToken)) { return null; }
        const pid = typeof obj.pid === 'number' && Number.isSafeInteger(obj.pid)
            && obj.pid > 0 && obj.pid <= 0xffffffff
            ? obj.pid : 0;
        const httpPort = validPortNumber(obj.httpPort);
        const httpsPort = validPortNumber(obj.httpsPort);
        if (httpPort === null && httpsPort === null) { return null; }
        const lsVersion = typeof obj.lsVersion === 'string' && obj.lsVersion.trim()
            ? obj.lsVersion.trim() : undefined;
        return { pid, httpPort, httpsPort, csrfToken, ...(lsVersion ? { lsVersion } : {}) };
    } catch {
        return null;
    }
}

export interface AntigravityAppDataDirOptions extends WslPathResolveOptions {
    homedir?: string;
    inWsl?: boolean;
}

/**
 * Resolve all candidate `.gemini/antigravity` data directories.
 * On macOS/Windows/native Linux, returns `[~/.gemini/antigravity]`.
 * Inside WSL, returns the local Linux directory first AND bridges the Windows
 * host `%USERPROFILE%\.gemini\antigravity` directory when resolvable.
 */
export function getAntigravityAppDataDirs(options?: AntigravityAppDataDirOptions): string[] {
    const home = options?.homedir ?? homedir();
    const dirs: string[] = [join(home, '.gemini', 'antigravity')];
    const inWsl = options?.inWsl ?? isWSL();
    if (inWsl) {
        const winProfile = resolveWslWindowsUserProfile(options);
        if (winProfile) {
            const winDataDir = join(winProfile, '.gemini', 'antigravity');
            if (!dirs.includes(winDataDir)) {
                dirs.push(winDataDir);
            }
        }
    }
    return dirs;
}

/**
 * Resolve all candidate Antigravity daemon directories containing `hub_<port>.json`.
 * Inside WSL this includes both the distro-local dir and the bridged Windows host dir.
 */
export function getAntigravityDaemonDirs(options?: AntigravityAppDataDirOptions): string[] {
    return getAntigravityAppDataDirs(options).map(dir => join(dir, 'daemon'));
}

export function getAntigravityDaemonDir(): string {
    const dirs = getAntigravityDaemonDirs();
    if (dirs.length > 1 && !existsSync(dirs[0]) && existsSync(dirs[1])) {
        return dirs[1];
    }
    return dirs[0];
}

export function readHubDiscoveryFile(
    port: number,
    daemonDir: string = getAntigravityDaemonDir(),
): HubDiscoveryRecord | null {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { return null; }
    try {
        const raw = readFileSync(join(daemonDir, `hub_${port}.json`), 'utf-8');
        return parseHubDiscoveryJson(raw);
    } catch {
        return null;
    }
}

export function readAllHubDiscoveryFiles(
    daemonDir: string = getAntigravityDaemonDir(),
): HubDiscoveryRecord[] {
    return readAllHubDiscoveryFilesFromDirs([daemonDir]);
}

export function readAllHubDiscoveryFilesFromDirs(
    daemonDirs: readonly string[],
): HubDiscoveryRecord[] {
    const records: Array<{ record: HubDiscoveryRecord; mtimeMs: number }> = [];
    const seenKeys = new Set<string>();
    const visitedDirs = new Set<string>();

    for (const daemonDir of daemonDirs) {
        if (!daemonDir || visitedDirs.has(daemonDir)) { continue; }
        visitedDirs.add(daemonDir);
        try {
            const entries = readdirSync(daemonDir).filter(name => /^hub_\d+\.json$/i.test(name));
            for (const name of entries) {
                const filePath = join(daemonDir, name);
                try {
                    const raw = readFileSync(filePath, 'utf-8');
                    const record = parseHubDiscoveryJson(raw);
                    if (!record) { continue; }
                    const key = `${record.pid}:${record.httpPort ?? ''}:${record.httpsPort ?? ''}:${record.csrfToken}`;
                    if (seenKeys.has(key)) { continue; }
                    seenKeys.add(key);
                    let mtimeMs = 0;
                    try { mtimeMs = statSync(filePath).mtimeMs; } catch { /* order last */ }
                    records.push({ record, mtimeMs });
                } catch { /* ignore unreadable or transient file */ }
            }
        } catch {
            // ignore missing/unreadable daemon dir
        }
    }
    records.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return records.map(item => item.record);
}

// ─── CR2-Fix4: Exported Parsing Functions ────────────────────────────────────
// Extracted from discoverLanguageServer() so tests can validate production code
// directly, instead of re-implementing the same regex logic in test files.

/**
 * Build the expected workspace_id from a workspace URI.
 * Mirrors the conversion Antigravity uses for --workspace_id process argument.
 */
export function buildExpectedWorkspaceId(workspaceUri: string): string {
    let id = workspaceUri;
    // NOTE: Do NOT decodeURIComponent here. The LS builds workspace_id from
    // the RAW URI, replacing ALL non-alphanumeric characters with underscores.
    // Decoding first would convert %20→space, losing the "20" digits that the
    // LS preserves as "_20". This caused workspace_id mismatches for any path
    // containing percent-encoded characters (e.g., spaces → %20).

    // Handle vscode-remote:// URIs — strip scheme+authority to get file path
    // e.g., vscode-remote://wsl%2BUbuntu/home/user/project → /home/user/project
    // (The regex works on raw URIs: %2B is part of the authority, not a slash.)
    const remoteMatch = id.match(/^vscode-remote:\/\/[^/]+(\/.*)/);
    if (remoteMatch) {
        // Reconstruct as file URI for consistent workspace_id generation
        id = 'file://' + remoteMatch[1];
    }
    // Step 1: Strip the URI scheme separator (including RFC 8089 file://localhost/)
    id = id.replace(/^file:\/\/localhost\//i, 'file:///');
    id = id.replace(/:\/\/\//, '_');
    if (process.platform === 'win32' || isWSL()) {
        // Windows / WSL: the LS hex-encodes the drive-letter colon as _3A_
        // Encode colon BEFORE the catch-all replacement to preserve the
        // hex-encoding format (c:/ -> c_3A_/ -> c_3A_).
        id = id.replace(/:/g, '_3A_');
    }
    // Catch-all: replace ANY non-alphanumeric, non-underscore character with '_'.
    // This mirrors the LS behavior exactly and covers all special characters:
    // slashes (/), hyphens (-), percent signs (%), spaces, parens, etc.
    // Using a catch-all prevents future mismatches if paths contain unusual chars.
    id = id.replace(/[^a-zA-Z0-9_]/g, '_');
    // Collapse consecutive underscores on ALL platforms.
    // The LS does this universally — adjacent special chars (e.g., /% in
    // percent-encoded CJK paths like /%E7%AE%80) produce __ which the LS
    // collapses to _. Previously this was Windows-only, causing workspace_id
    // mismatches for CJK folder names on macOS/Linux.
    id = id.replace(/__+/g, '_');
    return id;
}

/**
 * Extract PID from a ps output line.
 */
export function extractPid(line: string): number | null {
    const pidMatch = line.trim().match(/^\s*(\d+)\s/);
    return pidMatch ? parseInt(pidMatch[1], 10) : null;
}

/**
 * Extract the PID from a Windows process-discovery CSV line, supporting BOTH
 * output formats we consume, with field-boundary anchoring so command-line
 * "decoy" numbers (ports, hex tokens, pipe paths ending in digits) are ignored:
 *   - wmic /format:csv        → "Node,CommandLine,ProcessId"   (PID is LAST column)
 *   - PowerShell ConvertTo-Csv → "\"ProcessId\",\"CommandLine\"" (PID is FIRST, quoted)
 * Header rows and malformed lines return null. Replaces the previous inline
 * `/(\d+)\s*$/` + "any 2+ digit number" fallback which could grab a port.
 */
export function extractWindowsPid(line: string): number | null {
    const trimmed = line.replace(/\r+$/, '').trim();
    if (!trimmed) { return null; }
    // Anchoring (CSV field boundaries) already excludes decoy numbers, so the
    // only sanity bound is a positive 32-bit value: Windows PIDs are DWORDs and
    // can legitimately exceed 1e6 on high-uptime systems. NO <1_000_000 cap
    // (CR-#62 adversarial review: such a cap would reject large real PIDs).
    const inRange = (n: number) => n > 0 && n <= 0xffffffff;
    // PowerShell ConvertTo-Csv: PID is the first, quoted column → "12345","...".
    // Anchored at start so a trailing digit inside CommandLine cannot win.
    const psMatch = trimmed.match(/^\s*"?(\d+)"?\s*,/);
    if (psMatch) {
        const n = parseInt(psMatch[1], 10);
        if (inRange(n)) { return n; }
    }
    // wmic /format:csv: PID is the last column → ...,12345
    const wmicMatch = trimmed.match(/,(\d+)\s*$/);
    if (wmicMatch) {
        const n = parseInt(wmicMatch[1], 10);
        if (inRange(n)) { return n; }
    }
    return null;
}

/** Decode a CSV row without losing commas or doubled quotes in CommandLine. */
function parseCsvRow(line: string): string[] {
    const fields: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { field += '"'; i++; }
            else { quoted = !quoted; }
        } else if (ch === ',' && !quoted) {
            fields.push(field);
            field = '';
        } else { field += ch; }
    }
    fields.push(field);
    return fields;
}

/** Accept ps PID/command rows, bare commands, and both Windows CSV layouts. */
function processCommandLine(line: string): string {
    const trimmed = line.trim();
    if (/^"?\d+"?\s*,/.test(trimmed)) {
        const fields = parseCsvRow(trimmed);
        if (fields.length === 2) { return fields[1]; }
    }
    if (/,[0-9]+$/.test(trimmed)) {
        const fields = parseCsvRow(trimmed);
        if (fields.length === 3) { return fields[1]; }
    }
    return trimmed.replace(/^\d+\s+/, '');
}

/** Tokenize arguments without interpreting shell escapes or Windows path slashes. */
function commandArguments(line: string): string[] {
    const args: string[] = [];
    const command = processCommandLine(line);
    let value = '';
    let quote = '';
    let started = false;
    for (const ch of command) {
        if (quote) {
            if (ch === quote) { quote = ''; }
            else { value += ch; }
        } else if ((ch === '"' || ch === "'") && (!started || value.endsWith('='))) {
            quote = ch;
            started = true;
        } else if (/\s/.test(ch)) {
            if (started) { args.push(value); value = ''; started = false; }
        } else { value += ch; started = true; }
    }
    // A truncated/unterminated quoted token is not safe to use as a credential.
    if (quote) { return []; }
    if (started) { args.push(value); }
    return args;
}

function commandFlag(line: string, name: string): string | null {
    const args = commandArguments(line);
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg.toLowerCase().startsWith(`${name}=`)) {
            return arg.slice(name.length + 1) || null;
        }
        if (arg.toLowerCase() === name) {
            const next = args[i + 1];
            return next && !next.startsWith('--') ? next : null;
        }
    }
    return null;
}

function commandFlagAny(line: string, names: readonly string[]): string | null {
    for (const name of names) {
        const value = commandFlag(line, name);
        if (value !== null) { return value; }
    }
    return null;
}

export function extractCsrfToken(line: string): string | null {
    return commandFlagAny(line, ['--csrf_token', '--csrf-token']);
}

export function extractWorkspaceId(line: string): string | null {
    return commandFlagAny(line, ['--workspace_id', '--workspace-id']);
}

/** The new IDE hosts the same Connect RPC API in an agy --hub process. */
export function isAgyHubProcess(line: string): boolean {
    const command = processCommandLine(line);
    const executable = command.match(/^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|((?:[A-Za-z]:[\\/]|\/)[^"\r\n]*?[\\/]agy(?:\.exe)?|agy(?:\.exe)?))(?=\s|$)/i);
    if (!executable) { return false; }
    const path = executable[1] || executable[2] || executable[3];
    if (!/(?:^|[\\/])agy(?:\.exe)?$/i.test(path)) { return false; }
    // ps does not quote executable paths with spaces. Accept those, but never
    // mistake a shell/node command mentioning another executable for the hub.
    if (!executable[1] && !executable[2] && /\s+(?:[-/]|['"]?[A-Za-z]:[\\/]|['"]\/)/.test(path)) { return false; }
    const args = commandArguments(line).map(arg => arg.toLowerCase());
    const hub = args.includes('--hub') || args.includes('--hub=true');
    const appDataDir = commandFlagAny(line, ['--app_data_dir', '--app-data-dir']);
    return hub && !!appDataDir && /(?:^|[\\/])antigravity(?:-ide)?[\\/]?$/i.test(appDataDir);
}

export function extractHubPort(line: string): number | null {
    const raw = commandFlagAny(line, ['--hub-port', '--hub_port']);
    if (!raw || !/^\d+$/.test(raw)) { return null; }
    const port = Number(raw);
    return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/**
 * Recognize Antigravity App (2.0 / v2.34+) standalone hub Language Server:
 * `language_server` / `language_server.exe` launched with `--standalone` and
 * `--subclient_type hub` (which intentionally omits `--csrf_token` from argv
 * and publishes its CSRF token + ports in `~/.gemini/antigravity/daemon/hub_<port>.json`).
 */
export function isAppStandaloneHubProcess(line: string): boolean {
    const command = processCommandLine(line);
    const executable = command.match(
        /^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|((?:[A-Za-z]:[\\/]|\/)[^"\r\n]*?[\\/]language_server(?:_[a-z0-9_]+)?(?:\.exe)?|language_server(?:_[a-z0-9_]+)?(?:\.exe)?))(?=\s|$)/i,
    );
    if (!executable) { return false; }
    const exePath = executable[1] || executable[2] || executable[3];
    if (!/(?:^|[\\/])language_server(?:_[a-z0-9_]+)?(?:\.exe)?$/i.test(exePath)) { return false; }
    if (!executable[1] && !executable[2] && /\s+(?:[-/]|['"]?[A-Za-z]:[\\/]|['"]\/)/.test(exePath)) { return false; }
    const args = commandArguments(line).map(arg => arg.toLowerCase());
    const standalone = args.includes('--standalone') || args.includes('--standalone=true');
    const subclientType = commandFlagAny(line, ['--subclient_type', '--subclient-type'])?.toLowerCase();
    if (!standalone || subclientType !== 'hub') { return false; }
    return line.toLowerCase().includes('antigravity');
}

/** Classify which Antigravity surface owns a discovered LS process line. */
export function classifyProcessSurface(line: string): LSSurface {
    const low = line.toLowerCase();
    if (isAppStandaloneHubProcess(line)) {
        const appDataDir = commandFlagAny(line, ['--app_data_dir', '--app-data-dir']) || '';
        if (/antigravity[- ]ide/i.test(appDataDir) || /antigravity ide/i.test(low)) {
            return 'ide';
        }
        return 'app';
    }
    if (isAgyHubProcess(line)) {
        const subclient = commandFlagAny(line, ['--subclient_type', '--subclient-type'])?.toLowerCase();
        if (subclient === 'cli') { return 'cli'; }
        return 'ide';
    }
    if (isStandaloneLanguageServer(line) || (low.includes('language_server_') && low.includes('antigravity'))) {
        return 'ide';
    }
    return 'unknown';
}

/** Classify which Antigravity surface owns a daemon hub_<port>.json record by matching its PID against process lines. */
export function classifyHubRecordSurface(
    record: HubDiscoveryRecord,
    processLines: readonly string[],
    windowsProcesses: boolean = process.platform === 'win32' || isWSL(),
): LSSurface {
    if (record.pid > 0) {
        for (const line of processLines) {
            const pid = windowsProcesses ? extractWindowsPid(line) : extractPid(line);
            if (pid === record.pid) {
                return classifyProcessSurface(line);
            }
        }
    }
    return 'unknown';
}

/**
 * Order daemon hub_<port>.json records with optional surface preference
 * while preserving newest-mtime-first ordering within the same surface rank.
 */
export function selectMatchingHubRecords(
    records: readonly HubDiscoveryRecord[],
    processLines: readonly string[],
    preferredSurface?: 'app' | 'ide',
    windowsProcesses: boolean = process.platform === 'win32' || isWSL(),
): HubDiscoveryRecord[] {
    if (!preferredSurface || records.length <= 1) {
        return [...records];
    }
    const rank = (record: HubDiscoveryRecord): number => {
        const surface = classifyHubRecordSurface(record, processLines, windowsProcesses);
        if (surface === preferredSurface) { return 0; }
        if (surface === 'unknown') { return 1; }
        return 2;
    };
    return records
        .map((record, index) => ({ record, index, rank: rank(record) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(item => item.record);
}

/**
 * Select the LS process line for the current workspace (and optional preferred surface).
 *
 * PRIORITY ORDER (Antigravity 1.22.2+ / 2.34+ compatibility):
 * - When `preferredSurface === 'app'`: App standalone hub -> agy hub -> shared LS -> workspace match -> first
 * - When `preferredSurface === 'ide'`: agy hub -> non-App IDE LS -> App standalone hub -> first
 * - When `preferredSurface` is omitted: agy hub -> shared LS (no workspace_id) -> workspace match -> first
 */
export function selectMatchingProcessLine(
    lines: readonly string[],
    workspaceUri?: string,
    preferredSurface?: 'app' | 'ide',
): string | null {
    if (lines.length === 0) {
        return null;
    }
    if (lines.length === 1) {
        return lines[0];
    }

    if (preferredSurface === 'app') {
        const appHub = lines.find(isAppStandaloneHubProcess);
        if (appHub) { return appHub; }
    }

    const hub = lines.find(isAgyHubProcess);
    if (hub) { return hub; }

    if (preferredSurface === 'ide') {
        const ideCandidates = lines.filter(line => !isAppStandaloneHubProcess(line));
        if (ideCandidates.length > 0) {
            return selectLegacyOrSharedLine(ideCandidates, workspaceUri);
        }
    }

    return selectLegacyOrSharedLine(lines, workspaceUri);
}

function selectLegacyOrSharedLine(lines: readonly string[], workspaceUri?: string): string {
    // Separate processes into new-style (no workspace_id) and old-style (has workspace_id)
    const newStyleLines = lines.filter(line => extractWorkspaceId(line) === null);
    const oldStyleLines = lines.filter(line => extractWorkspaceId(line) !== null);

    // Priority 1: Prefer new-style shared LS (no workspace_id)
    if (newStyleLines.length > 0) {
        return newStyleLines[0];
    }

    // Priority 2: Old-style LS — match by workspace_id if available
    if (workspaceUri && oldStyleLines.length > 0) {
        const expectedWorkspaceId = buildExpectedWorkspaceId(workspaceUri);
        const match = oldStyleLines.find(line => extractWorkspaceId(line) === expectedWorkspaceId);
        if (match) {
            return match;
        }
    }

    // Priority 3: First discovered line
    return lines[0];
}

/** Recognize Antigravity's standalone language_server(.exe) without platform suffix. */
function isStandaloneLanguageServer(line: string): boolean {
    const command = processCommandLine(line);
    const executable = command.match(/^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|((?:[A-Za-z]:[\\/]|\/)[^"\r\n]*?[\\/]language_server(?:\.exe)?|language_server(?:\.exe)?))(?=\s|$)/i);
    if (!executable) { return false; }
    const path = executable[1] || executable[2] || executable[3];
    if (!/(?:^|[\\/])language_server(?:\.exe)?$/i.test(path)) { return false; }
    if (!executable[1] && !executable[2] && /\s+(?:[-/]|['"]?[A-Za-z]:[\\/]|['"]\/)/.test(path)) { return false; }
    return line.toLowerCase().includes('antigravity');
}

/**
 * Filter ps output lines for LS processes.
 * In WSL, looks for the Windows binary name since the LS runs on the Windows host.
 */
export function filterLsProcessLines(psOutput: string, binaryOverride?: string): string[] {
    const binaryName = binaryOverride || ((process.platform === 'win32' || isWSL())
        ? 'language_server_windows'
        : process.platform === 'linux'
            ? 'language_server_linux'
            : 'language_server_macos');
    return psOutput.split('\n').filter(l => {
        // CR-#62: case-INSENSITIVE membership test (install paths / flags may vary
        // in case), but return the ORIGINAL line unchanged — downstream
        // extractCsrfToken and the request headers depend on the case-sensitive
        // csrf_token value, so the line must never be lower-cased in place.
        const low = l.toLowerCase();
        return isAgyHubProcess(l)
            || isAppStandaloneHubProcess(l)
            || isStandaloneLanguageServer(l)
            || (low.includes(binaryName.toLowerCase()) && low.includes('antigravity'));
    });
}

interface PortCandidate {
    port: number;
    ipv6Only?: boolean;
}

/**
 * Whether a socket bound to `host` can be reached by connecting to 127.0.0.1.
 * Loopback itself plus the wildcard forms every tool spells differently
 * (`0.0.0.0`, `*`, `::`, `[::]`), which all include the loopback interface.
 * `[::1]` is IPv6-only loopback: on a dual-stack Windows socket the same port is
 * also open on IPv4, and when it isn't the probe falls back to `::1`.
 */
function isLoopbackReachableHost(host: string): boolean {
    // `ss` appends the bound interface to a SO_BINDTODEVICE socket (`127.0.0.1%lo`). Dropping it
    // leaves an address that is still judged on its own merits — `[fe80::1%12]` becomes
    // `[fe80::1]`, which is link-local and still rejected.
    const bare = host.replace(/%[^\]]*(?=\]?$)/, '');
    return bare === '127.0.0.1' || bare === '0.0.0.0' || bare === '*'
        || bare === '::' || bare === '[::]' || bare === '[::1]';
}

function portCandidateFromAddressToken(token: string): PortCandidate | null {
    const m = token.match(/^(.*):(\d+)$/);
    if (!m || !isLoopbackReachableHost(m[1])) { return null; }
    const port = parseInt(m[2], 10);
    // Out of range is not just a port that cannot work: Node throws ERR_SOCKET_BAD_PORT
    // synchronously from inside the probe's promise executor, and the resulting rejection is
    // caught above the loop — so one bad value would abandon every remaining port rather than
    // skipping itself.
    if (port <= 0 || port > 65535) { return null; }
    const bare = m[1].replace(/%[^\]]*(?=\]?$)/, '');
    return bare === '[::1]' ? { port, ipv6Only: true } : { port };
}

/**
 * Extract the port from an `address:port` token, but only when a client on
 * loopback could actually reach it. Returns null for port 0, which is what a
 * foreign-address column reads as on a listening row.
 */
function portFromAddressToken(token: string): number | null {
    return portCandidateFromAddressToken(token)?.port ?? null;
}

function extractPortCandidate(line: string): PortCandidate | null {
    const tokens = line.trim().split(/\s+/);
    for (let i = tokens.length - 1; i >= 0; i--) {
        const candidate = portCandidateFromAddressToken(tokens[i]);
        if (candidate !== null) { return candidate; }
    }
    return null;
}

/**
 * Extract port from a lsof output line.
 * `lsof -nP` prints the bind address as `*:PORT` when the server listened on all
 * interfaces rather than on loopback specifically, so matching 127.0.0.1 alone
 * would miss a reachable LS (issue #64, same root cause as the netstat case).
 */
export function extractPort(line: string): number | null {
    // Right to left: NAME is the last column, and COMMAND — the first — is a process name that a
    // program can set for itself, so it is the one column whose contents could also look like an
    // address. Scanning forwards would let it shadow the real port, and since only the first match
    // per line is taken the real one would never be seen at all.
    return extractPortCandidate(line)?.port ?? null;
}

function extractPortCandidateFromSs(line: string): PortCandidate | null {
    const cols = line.trim().split(/\s+/);
    // The header is not tokenizable the same way — it runs "Peer Address:PortProcess" together
    // with no separating space — so anchor on the state column instead of on column count.
    if (cols.length < 4 || cols[0].toUpperCase() !== 'LISTEN') { return null; }
    return portCandidateFromAddressToken(cols[3]);
}

/**
 * Extract port from a Linux `ss -tlnp` output line.
 * Matches patterns like `127.0.0.1:12345`, `*:12345`, `0.0.0.0:12345`, `:::12345`, `[::]:12345`
 *
 * Reads the Local Address column positionally — with `-t` selecting a single protocol there is no
 * Netid column, so the layout is `State Recv-Q Send-Q Local Peer Process`. Pattern matching missed
 * every bracketed IPv6 form that iproute2 has printed since 4.13 (`[::]:8082`, `[::1]:8083`),
 * because in those the `::` is followed by `]` rather than by the port separator. That left a
 * v6-bound server reproducing issue #64 exactly — the row passes the PID filter, no port comes out,
 * and discovery reports the server missing. It matters more than it looks: a WSL-hosted extension
 * skips netstat and a minimal distro image often has no lsof, which makes `ss` the primary port
 * source there rather than a rarely-used fallback.
 */
export function extractPortFromSs(line: string): number | null {
    return extractPortCandidateFromSs(line)?.port ?? null;
}

function extractPortCandidateFromNetstat(line: string): PortCandidate | null {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) { return null; }
    return portCandidateFromAddressToken(cols[1]);
}

/**
 * Extract port from a Windows `netstat -ano` output line.
 * Matches patterns like `TCP    127.0.0.1:12345    0.0.0.0:0    LISTENING    1234`
 *
 * Reads the local-address column positionally rather than scanning the whole line.
 * A `netstat -ano` row is `<Proto> <Local> <Foreign> [<State>] <PID>`, so the local
 * address is always column 1. Scanning instead would match the foreign column, which
 * on a listening row reads `0.0.0.0:0` and yields port 0 for any row whose local
 * address is a real interface IP rather than loopback.
 */
export function extractPortFromNetstat(line: string): number | null {
    return extractPortCandidateFromNetstat(line)?.port ?? null;
}

/**
 * Whether a Windows `netstat -ano` line is LISTENING and owned by EXACTLY `pid`.
 * CR-#62: the previous `line.trim().endsWith(String(pid))` matched PID 123
 * against a line owned by 1123 (substring suffix). Anchor on the final
 * whitespace-delimited field (the PID column) for an exact match instead.
 */
export function netstatLineMatchesPid(line: string, pid: number): boolean {
    const trimmed = line.trim();
    const m = trimmed.match(/\s(\d+)$/);
    if (m === null || m[1] !== String(pid)) { return false; }
    if (trimmed.includes('LISTENING')) { return true; }
    // Some localized Windows builds translate the State column — German netstat prints "ABHÖREN"
    // (the one translation with documented evidence; French and Spanish builds were checked and do
    // print the English "LISTENING"). On those machines the English literal above rejected every
    // candidate line and discovery reported "LS not found" forever.
    // Fall back on structure, which is locale-independent: a listening TCP row is
    // `TCP <local> <foreign> <STATE> <PID>` with a wildcard foreign address. Connected rows carry a
    // real remote address and UDP rows have no State column at all, so both still fail here.
    const cols = trimmed.split(/\s+/);
    if (cols.length !== 5 || cols[0].toUpperCase() !== 'TCP') { return false; }
    return cols[2] === '0.0.0.0:0' || cols[2] === '[::]:0' || cols[2] === '*:*';
}

/**
 * Extract WSL distro name from a vscode-remote:// workspace URI.
 * e.g., "vscode-remote://wsl%2Bubuntu/path" → "Ubuntu"
 *       "vscode-remote://wsl+Ubuntu/path"  → "Ubuntu"
 * Returns null if the URI is not a WSL remote URI.
 */
export function extractWslDistro(uri: string): string | null {
    // Handle both URL-encoded (%2B → +) and raw + in WSL authority
    try {
        const decoded = decodeURIComponent(uri);
        const match = decoded.match(/^vscode-remote:\/\/wsl\+([^/]+)\//i);
        return match ? match[1] : null;
    } catch { return null; }
}

function pushPortCandidate(list: PortCandidate[], candidate: PortCandidate | null): void {
    if (!candidate) { return; }
    const existing = list.find(c => c.port === candidate.port);
    if (existing) {
        if (candidate.ipv6Only) { existing.ipv6Only = true; }
    } else {
        list.push(candidate);
    }
}

async function execCommandWithFallbacks(
    binaries: readonly string[],
    args: string[],
    timeout: number,
    signal?: AbortSignal,
): Promise<string | null> {
    for (const bin of binaries) {
        if (signal?.aborted) { return null; }
        try {
            const result = await execFileAsync(bin, args, { encoding: 'utf-8', timeout, signal, windowsHide: true });
            return result.stdout;
        } catch (e) {
            if (signal?.aborted) { return null; }
            const code = (e as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') { continue; }
            return null;
        }
    }
    return null;
}

/**
 * Parse Linux `/proc/net/tcp` or `/proc/net/tcp6` content for LISTEN sockets (`st === '0A'`)
 * bound to loopback/wildcard whose socket inode belongs to `targetInodes`.
 */
export function parseProcNetTcp(
    content: string,
    isIpv6: boolean,
    targetInodes: ReadonlySet<string>,
): PortCandidate[] {
    if (targetInodes.size === 0) { return []; }
    const ports: PortCandidate[] = [];
    for (const rawLine of content.split('\n')) {
        const cols = rawLine.trim().split(/\s+/);
        if (cols.length < 10) { continue; }
        // Column 3 is socket state: '0A' === TCP_LISTEN
        if (cols[3].toUpperCase() !== '0A') { continue; }
        const inode = cols[9];
        if (!targetInodes.has(inode)) { continue; }

        const addrParts = cols[1].split(':');
        if (addrParts.length !== 2) { continue; }
        const hexAddr = addrParts[0].toUpperCase();
        const port = parseInt(addrParts[1], 16);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { continue; }

        if (!isIpv6) {
            if (hexAddr === '00000000' || hexAddr === '0100007F' || hexAddr === '7F000001') {
                pushPortCandidate(ports, { port });
            }
        } else {
            if (hexAddr === '00000000000000000000000000000000'
                || hexAddr === '0000000000000000FFFF00000100007F'
                || hexAddr === '00000000000000000000FFFF7F000001') {
                pushPortCandidate(ports, { port });
            } else if (hexAddr === '00000000000000000000000001000000'
                || hexAddr === '00000000000000000000000000000001') {
                pushPortCandidate(ports, { port, ipv6Only: true });
            }
        }
    }
    return ports;
}

/**
 * Pure-Node Linux fallback when both `lsof` and `ss` are unavailable:
 * inspects `/proc/<pid>/fd` symlinks for `socket:[<inode>]` and correlates
 * them against `/proc/net/tcp` and `/proc/net/tcp6`.
 */
export function findListeningPortsFromProc(pid: number, procRoot = '/proc'): PortCandidate[] {
    if (!Number.isSafeInteger(pid) || pid <= 0) { return []; }
    const fdDir = join(procRoot, String(pid), 'fd');
    const inodes = new Set<string>();
    try {
        const entries = readdirSync(fdDir);
        for (const fd of entries) {
            try {
                const link = readlinkSync(join(fdDir, fd));
                const match = link.match(/^socket:\[(\d+)\]$/);
                if (match) { inodes.add(match[1]); }
            } catch { /* ignore closed or unreadable fd */ }
        }
    } catch {
        return [];
    }
    if (inodes.size === 0) { return []; }

    const ports: PortCandidate[] = [];
    for (const [file, isIpv6] of [['tcp', false], ['tcp6', true]] as const) {
        try {
            const content = readFileSync(join(procRoot, 'net', file), 'utf-8');
            for (const candidate of parseProcNetTcp(content, isIpv6, inodes)) {
                pushPortCandidate(ports, candidate);
            }
        } catch { /* tcp6 may be absent if IPv6 is disabled */ }
    }
    return ports;
}

const LOOPBACK_ENV_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Parse `ANTIGRAVITY_LS_ADDRESS` (e.g. `localhost:62502`, `127.0.0.1:62502`,
 * `[::1]:62502`, `http://localhost:62502`, `https://127.0.0.1:62501`).
 * Strictly accepts loopback hosts only; rejects remote addresses and malformed values.
 */
export function parseLsAddressEnv(rawAddress: string | undefined): ParsedLsAddress | null {
    if (typeof rawAddress !== 'string') { return null; }
    const trimmed = rawAddress.trim();
    if (!trimmed || /\s/.test(trimmed)) { return null; }

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    let parsed: URL;
    try {
        parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return null; }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) { return null; }
    if (parsed.pathname && parsed.pathname !== '/') { return null; }

    const hostLower = parsed.hostname.toLowerCase();
    if (!LOOPBACK_ENV_HOSTS.has(hostLower)) { return null; }

    const rawPort = parsed.port;
    if (!rawPort || !/^\d+$/.test(rawPort)) { return null; }
    const port = Number(rawPort);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { return null; }

    const isIpv6 = hostLower === '::1' || hostLower === '[::1]';
    const isLocalhost = hostLower === 'localhost';
    return {
        hostname: isIpv6 ? '::1' : '127.0.0.1',
        port,
        ...(hasScheme ? { useTls: parsed.protocol === 'https:' } : {}),
        ...(isIpv6 ? { ipv6Only: true } : {}),
        ...(isLocalhost ? { allowIpv6Fallback: true } : {}),
    };
}

function inferEnvSurface(env: NodeJS.ProcessEnv): LSSurface {
    const exe = (env.ANTIGRAVITY_AGENTAPI_EXE || '').toLowerCase();
    if (exe.includes('antigravity ide') || exe.includes('agy-ide')) {
        return 'ide';
    }
    return 'app';
}

/**
 * First-priority env-var discovery for Antigravity App Sidecar / agent subprocesses:
 * reads `ANTIGRAVITY_LS_ADDRESS` + `ANTIGRAVITY_CSRF_TOKEN`, enforces loopback-only
 * targeting, and verifies reachability via Connect-RPC probe. Never logs the CSRF token.
 */
export async function discoverFromEnv(
    env: NodeJS.ProcessEnv = process.env,
    signal?: AbortSignal,
    log?: (msg: string) => void,
    daemonDir?: string,
): Promise<LSInfo | null> {
    if (signal?.aborted) { return null; }
    const parsed = parseLsAddressEnv(env.ANTIGRAVITY_LS_ADDRESS);
    const csrfToken = typeof env.ANTIGRAVITY_CSRF_TOKEN === 'string' ? env.ANTIGRAVITY_CSRF_TOKEN.trim() : '';
    if (!parsed || !csrfToken || /\s/.test(csrfToken)) {
        return null;
    }

    const effectiveDaemonDir = daemonDir
        || (typeof env.ANTIGRAVITY_APP_DATA_DIR === 'string' && env.ANTIGRAVITY_APP_DATA_DIR.trim()
            ? join(env.ANTIGRAVITY_APP_DATA_DIR.trim(), 'daemon')
            : getAntigravityDaemonDir());
    const directHub = readHubDiscoveryFile(parsed.port, effectiveDaemonDir);
    const matchedHub = (directHub && (directHub.httpPort === parsed.port || directHub.httpsPort === parsed.port))
        ? directHub
        : readAllHubDiscoveryFiles(effectiveDaemonDir).find(
            r => r.httpPort === parsed.port || r.httpsPort === parsed.port,
        );
    const pid = matchedHub && matchedHub.pid > 0 ? matchedHub.pid : 0;
    const schemes: boolean[] = parsed.useTls === true ? [true, false] : [false, true];
    const diagnostics: string[] = [];
    const surface = inferEnvSurface(env);

    for (const useTls of schemes) {
        if (signal?.aborted) { return null; }
        let found: LSInfo | null = null;
        if (parsed.ipv6Only) {
            const v6 = await probePortWithDetail(parsed.port, csrfToken, useTls, signal, '::1');
            if (v6.ok) {
                found = { pid, csrfToken, port: parsed.port, useTls, hostname: '::1' };
            } else {
                diagnostics.push(`${useTls ? 'https' : 'http'}://[::1]:${parsed.port} (${v6.summary})`);
            }
        } else {
            found = await probeSchemeWithLoopbackFallback(
                parsed.port, csrfToken, useTls, pid, !!parsed.allowIpv6Fallback, signal, diagnostics,
            );
        }
        if (found) {
            const result: LSInfo = { ...found, surface, source: 'env' };
            log?.(`Found backend via ANTIGRAVITY_LS_ADDRESS (pid=${result.pid}, port=${result.port}, tls=${result.useTls}, surface=${surface})`);
            return result;
        }
    }

    if (diagnostics.length > 0) {
        log?.(`ANTIGRAVITY_LS_ADDRESS probe failed for port ${parsed.port}: ${diagnostics.join('; ')}`);
    }
    return null;
}

/**
 * Discover the Antigravity LS running INSIDE a WSL distro.
 * This handles the Remote-WSL scenario where the IDE spawns
 * language_server_linux_x64 inside the WSL environment.
 *
 * Strategy:
 * 1. Run `wsl -d <distro> -- ps -axww -o pid=,command=` to find the LS process
 * 2. Match workspace_id if available
 * 3. Extract CSRF token and PID
 * 4. Run `wsl -d <distro> -- ss -tlnp` to find listening ports
 * 5. Probe ports from Windows (WSL2 auto-forwards to localhost)
 */
async function discoverWslLanguageServer(
    distro: string,
    workspaceUri: string,
    signal?: AbortSignal,
    log?: (msg: string) => void,
    hint?: LSConnectionHint,
): Promise<LSInfo | null> {
    // CR-#62: invoke wsl.exe by absolute path when %SystemRoot% is known, so
    // Remote-WSL discovery does not depend on the Extension Host PATH either.
    const winRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const wslExe = winRoot && existsSync(`${winRoot}\\System32\\wsl.exe`)
        ? `${winRoot}\\System32\\wsl.exe`
        : 'wsl';
    try {
        const psResult = await execFileAsync(wslExe, [
            '-d', distro, '--', 'ps', '-axww', '-o', 'pid=,command='
        ], { encoding: 'utf-8', timeout: 10000, signal, windowsHide: true });
        const lines = filterLsProcessLines(psResult.stdout, 'language_server_linux');
        if (lines.length === 0) {
            log?.(`WSL[${distro}]: no Antigravity server process found inside distro`);
            return null;
        }

        for (const line of orderedProcessLines(lines, workspaceUri, hint)) {
            if (signal?.aborted) { return null; }
            const pid = extractPid(line);
            const csrfToken = extractCsrfToken(line);
            if (!pid || !csrfToken) { continue; }
            const found = await probeProcess(line, pid, csrfToken, async () => {
                for (const ssBin of ['ss', '/usr/sbin/ss', '/bin/ss']) {
                    if (signal?.aborted) { return []; }
                    try {
                        const ssResult = await execFileAsync(wslExe, [
                            '-d', distro, '--', ssBin, '-tlnp'
                        ], { encoding: 'utf-8', timeout: 5000, signal, windowsHide: true });
                        const ports: PortCandidate[] = [];
                        for (const socket of ssResult.stdout.split('\n')) {
                            if (socket.includes(`pid=${pid},`) || socket.includes(`pid=${pid})`)) {
                                pushPortCandidate(ports, extractPortCandidateFromSs(socket));
                            }
                        }
                        if (ports.length > 0) { return ports; }
                        return [];
                    } catch { /* try next ss path */ }
                }
                return [];
            }, signal, log, hint?.port);
            if (found) { return found; }
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Discover Windows LS processes via wmic (preferred) or Get-CimInstance (fallback).
 * Caches wmic availability to avoid retrying a missing executable every poll cycle.
 * Returns raw CSV output containing CommandLine and ProcessId fields.
 *
 * When running inside WSL, dynamically resolves the Windows system root via
 * `/proc/mounts`, inherited PATH, or `wslpath` (never hardcoding `/mnt/c`),
 * falling back to bare exe names if needed.
 */
async function discoverWindowsProcesses(signal?: AbortSignal, log?: (msg: string) => void): Promise<string> {
    const inWSL = isWSL();
    const winRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const wslWinRoot = inWSL ? await resolveWslWindowsRootAsync({ signal }) : null;

    // Determine executable paths.
    // - WSL: dynamically resolved Windows mount root (e.g. /mnt/c/Windows, /mnt/d/Windows, /c/Windows)
    // - Native Windows: absolute %SystemRoot% paths so discovery does not depend
    //   on the Extension Host's inherited PATH. buildWindowsExePath falls back to
    //   bare names when %SystemRoot% is somehow unset.
    const wmicExe = inWSL ? buildWslWindowsExePath(wslWinRoot, 'wmic') : buildWindowsExePath(winRoot, 'wmic');
    const psExe = inWSL ? buildWslWindowsExePath(wslWinRoot, 'powershell') : buildWindowsExePath(winRoot, 'powershell');

    // Try wmic unless already known unavailable, or the executable is absent on
    // disk. Win11 24H2+/25H2 removed WMIC by default (KB 5067470); pre-checking
    // existence makes PowerShell the deliberate primary rather than an
    // exception-driven afterthought.
    const wmicOnDisk = inWSL || !winRoot || existsSync(wmicExe);
    if (wmicAvailable !== false && wmicOnDisk) {
        try {
            const result = await execFileAsync(wmicExe, [
                'process', 'where',
                "name like 'language_server%' or name = 'agy.exe'",
                'get', 'ProcessId,CommandLine', '/format:csv'
            ], { encoding: 'utf-8', timeout: 5000, signal, windowsHide: true });
            // CR-#62: only trust/cache wmic when it actually returned LS rows.
            // A transient empty stdout must NOT cache wmicAvailable=true, else the
            // PowerShell fallback would be permanently skipped.
            if (filterLsProcessLines(result.stdout, 'language_server_windows').length > 0) {
                wmicAvailable = true;
                return result.stdout;
            }
            log?.('wmic returned no language_server rows; trying Get-CimInstance');
        } catch (e) {
            wmicAvailable = false;
            const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
            log?.(`wmic unavailable (${code}); falling back to Get-CimInstance`);
        }
    } else if (!wmicOnDisk) {
        log?.(`wmic not present at ${wmicExe} (Win11 24H2+ removes it); using Get-CimInstance`);
    }

    // Fallback: PowerShell Get-CimInstance with UTF-8 stdout and server-side WMI filter.
    // Setting OutputEncoding=UTF8 prevents OEM codepage corruption on CJK/non-ASCII user paths.
    // CR-#62: wrapped in try/catch so a powershell.exe ENOENT is logged and
    // downgraded to an empty result instead of collapsing into an unhandled error.
    const psArgs = [
        '-NoProfile', '-NoLogo', '-Command',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "Name like \'language_server%\' or Name = \'agy.exe\'" | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation',
    ];
    const psCandidates = inWSL && psExe !== 'powershell.exe' ? [psExe, 'powershell.exe'] : [psExe];
    for (let i = 0; i < psCandidates.length; i++) {
        const candidate = psCandidates[i];
        try {
            const result = await execFileAsync(candidate, psArgs, { encoding: 'utf-8', timeout: 10000, signal, windowsHide: true });
            return result.stdout;
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
            if (code === 'ENOENT' && i + 1 < psCandidates.length) {
                continue;
            }
            log?.(`PowerShell discovery failed (${code}); exe=${candidate}`);
            return '';
        }
    }
    return '';
}

/**
 * Find listening TCP port candidates for a given PID.
 * Uses lsof (macOS + most Linux), with fallback to /usr/sbin/lsof (macOS) or
 * ss / /usr/sbin/ss / /bin/ss and `/proc/<pid>/fd` + `/proc/net/tcp{,6}` (Linux).
 * In WSL, uses Windows netstat.exe since the LS is a Windows host process.
 *
 * `forceNative` skips that WSL assumption: when the PID belongs to a Linux LS running
 * inside this distro, its ports are in the distro's own network namespace and Windows
 * netstat.exe cannot see them.
 */
async function findListeningPortCandidates(
    pid: number, signal?: AbortSignal, log?: (msg: string) => void, forceNative = false,
): Promise<PortCandidate[]> {
    // Windows (or WSL): use netstat -ano to find Windows host ports
    if (!forceNative && (process.platform === 'win32' || isWSL())) {
        const inWSL = isWSL();
        const winRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
        const wslWinRoot = inWSL ? await resolveWslWindowsRootAsync({ signal }) : null;
        const netstatExe = inWSL ? buildWslWindowsExePath(wslWinRoot, 'netstat') : buildWindowsExePath(winRoot, 'netstat');
        const netstatCandidates = inWSL && netstatExe !== 'netstat.exe' ? [netstatExe, 'netstat.exe'] : [netstatExe];
        for (let i = 0; i < netstatCandidates.length; i++) {
            const candidate = netstatCandidates[i];
            try {
                const result = await execFileAsync(candidate, [
                    '-ano'
                ], { encoding: 'utf-8', timeout: 5000, signal, windowsHide: true });
                const ports: PortCandidate[] = [];
                for (const line of result.stdout.split('\n')) {
                    // netstat -ano format: TCP    127.0.0.1:PORT    0.0.0.0:0    LISTENING    PID
                    // CR-#62: exact PID-column match (previous endsWith matched 123 vs 1123).
                    if (netstatLineMatchesPid(line, pid)) {
                        pushPortCandidate(ports, extractPortCandidateFromNetstat(line));
                    }
                }
                return ports;
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
                if (code === 'ENOENT' && i + 1 < netstatCandidates.length) {
                    continue;
                }
                log?.(`netstat failed (${code}); exe=${candidate}`);
            }
        }
        return [];
    }

    // macOS + Linux: try lsof first (on macOS also fall back to /usr/sbin/lsof when PATH omits /usr/sbin)
    const lsofBins = process.platform === 'darwin' ? ['lsof', '/usr/sbin/lsof'] : ['lsof'];
    const lsofOut = await execCommandWithFallbacks(
        lsofBins,
        ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)],
        5000,
        signal,
    );
    if (lsofOut && lsofOut.trim()) {
        const ports: PortCandidate[] = [];
        for (const line of lsofOut.trim().split('\n')) {
            pushPortCandidate(ports, extractPortCandidate(line));
        }
        if (ports.length > 0) {
            return ports;
        }
    }

    // Linux fallback: ss command (installed by default via iproute2), with absolute path fallbacks
    if (process.platform === 'linux') {
        const ssOut = await execCommandWithFallbacks(
            ['ss', '/usr/sbin/ss', '/bin/ss'],
            ['-tlnp'],
            5000,
            signal,
        );
        if (ssOut) {
            const ports: PortCandidate[] = [];
            for (const line of ssOut.split('\n')) {
                // ss output includes process info like: users:(("language_server_linux",pid=1234,fd=5))
                if (line.includes(`pid=${pid},`) || line.includes(`pid=${pid})`)) {
                    pushPortCandidate(ports, extractPortCandidateFromSs(line));
                }
            }
            if (ports.length > 0) {
                return ports;
            }
        }

        // Minimal Linux fallback: inspect /proc/<pid>/fd + /proc/net/tcp{,6} directly
        const procPorts = findListeningPortsFromProc(pid);
        if (procPorts.length > 0) {
            return procPorts;
        }
    }

    return [];
}

/** Keep workspace/shared-server preference, but do not let a stale PID hide a live one. */
function orderedProcessLines(
    lines: readonly string[],
    workspaceUri?: string,
    hint?: LSConnectionHint,
    preferredSurface?: 'app' | 'ide',
): string[] {
    // When the active IDE exports its connection, never silently attach to a
    // different hub/account if that connection has not started or has gone away.
    // Allow extractHubPort === null for --hub-port=0 / ephemeral port allocation
    // as long as the per-window CSRF token matches exactly.
    const remaining = hint
        ? lines.filter(line => {
            if (extractCsrfToken(line) !== hint.csrfToken) { return false; }
            if (!isAgyHubProcess(line)) { return true; }
            const hubPort = extractHubPort(line);
            return hubPort === null || hubPort === hint.port;
        })
        : [...lines];
    const ordered: string[] = [];
    while (remaining.length > 0) {
        const preferred = selectMatchingProcessLine(remaining, workspaceUri, preferredSurface);
        if (preferred === null) { break; }
        ordered.push(preferred);
        remaining.splice(remaining.indexOf(preferred), 1);
    }
    return ordered;
}

/**
 * True when the OS process table already shows another Antigravity hub owning
 * `hint.port` with a DIFFERENT CSRF token — meaning the hinted instance is
 * absent and we must NOT probe `hint.port` or cross into another instance.
 */
function hasConflictingProcessForHint(lines: readonly string[], hint: LSConnectionHint): boolean {
    return lines.some(line => {
        const token = extractCsrfToken(line);
        if (!token || token === hint.csrfToken) { return false; }
        return isAgyHubProcess(line) && extractHubPort(line) === hint.port;
    });
}

/** If a hub process matches hint.port without exposing --csrf_token in argv, recover its real PID. */
function findPidForHintPortWithoutToken(
    lines: readonly string[],
    hint: LSConnectionHint,
    windowsProcesses: boolean,
): number {
    for (const line of lines) {
        if (!isAgyHubProcess(line)) { continue; }
        if (extractHubPort(line) !== hint.port) { continue; }
        if (extractCsrfToken(line) !== null) { continue; }
        const pid = windowsProcesses ? extractWindowsPid(line) : extractPid(line);
        if (pid) { return pid; }
    }
    return 0;
}

async function probeSchemeWithLoopbackFallback(
    port: number,
    csrfToken: string,
    useTls: boolean,
    pid: number,
    allowIpv6Fallback: boolean,
    signal: AbortSignal | undefined,
    diagnostics: string[],
): Promise<LSInfo | null> {
    if (signal?.aborted) { return null; }
    const v4 = await probePortWithDetail(port, csrfToken, useTls, signal, '127.0.0.1');
    if (v4.ok) {
        return { pid, csrfToken, port, useTls };
    }
    diagnostics.push(`${useTls ? 'https' : 'http'}://127.0.0.1:${port} (${v4.summary})`);
    if ((allowIpv6Fallback || v4.connectionRefused) && !signal?.aborted) {
        const v6 = await probePortWithDetail(port, csrfToken, useTls, signal, '::1');
        if (v6.ok) {
            return { pid, csrfToken, port, useTls, hostname: '::1' };
        }
        if (allowIpv6Fallback || !v6.connectionRefused) {
            diagnostics.push(`${useTls ? 'https' : 'http'}://[::1]:${port} (${v6.summary})`);
        }
    }
    return null;
}

async function probeProcess(
    line: string,
    pid: number,
    csrfToken: string,
    getPorts: () => Promise<PortCandidate[]>,
    signal?: AbortSignal,
    log?: (msg: string) => void,
    hintPort?: number,
    attemptedKeys?: Set<string>,
): Promise<LSInfo | null> {
    if (signal?.aborted) { return null; }
    const hub = isAgyHubProcess(line);
    const declaredPort = hub ? extractHubPort(line) : null;
    const attempted = new Set<number>();
    const diagnostics: string[] = [];
    const tryPort = async (candidate: PortCandidate, preferHttp: boolean): Promise<LSInfo | null> => {
        const { port, ipv6Only } = candidate;
        if (attempted.has(port) || signal?.aborted) { return null; }
        attempted.add(port);
        attemptedKeys?.add(`${port}:${csrfToken}`);
        // agy serves its primary/declared hub port over HTTP, while secondary listening ports
        // (e.g. agy >=1.5.14 paired httpsPort) and legacy language_server processes typically use TLS.
        for (const useTls of preferHttp ? [false, true] : [true, false]) {
            const found = await probeSchemeWithLoopbackFallback(
                port, csrfToken, useTls, pid, !!ipv6Only, signal, diagnostics,
            );
            if (found) { return found; }
        }
        return null;
    };
    const primaryPort = declaredPort !== null ? declaredPort : hintPort;
    if (primaryPort !== undefined) {
        // Declared --hub-port (or IDE-hinted port for ephemeral --hub-port=0 / omitted port):
        // try before socket tooling; prefer HTTP for agy hubs and TLS for legacy servers.
        const found = await tryPort({ port: primaryPort }, hub);
        if (found) { return found; }
    }
    if (signal?.aborted) { return null; }
    for (const candidate of await getPorts()) {
        // When a hub's declared/hinted primary port already failed, secondary ports
        // (e.g. agy >=1.5.14 paired httpsPort) typically use TLS; trying TLS first avoids
        // spurious HTTP-to-HTTPS handshake errors in hub stderr.
        const found = await tryPort(candidate, hub && primaryPort === undefined);
        if (found) { return found; }
    }
    if (diagnostics.length > 0) {
        log?.(`RPC probe diagnostics for pid ${pid}: ${diagnostics.join('; ')}`);
    }
    return null;
}

/**
 * Probe a daemon hub_<port>.json record using its explicit HTTP/HTTPS ports.
 * Never logs the CSRF token.
 */
async function probeHubRecord(
    record: HubDiscoveryRecord,
    preferredPort: number | undefined,
    attemptedKeys: Set<string>,
    signal?: AbortSignal,
    log?: (msg: string) => void,
): Promise<LSInfo | null> {
    const attempts: Array<{ port: number; useTls: boolean }> = [];
    const addAttempt = (port: number | null, useTls: boolean) => {
        if (port === null) { return; }
        if (!attempts.some(a => a.port === port && a.useTls === useTls)) {
            attempts.push({ port, useTls });
        }
    };
    if (preferredPort !== undefined && preferredPort === record.httpsPort) {
        addAttempt(record.httpsPort, true);
        addAttempt(record.httpPort, false);
        addAttempt(record.httpsPort, false);
    } else {
        addAttempt(record.httpPort, false);
        addAttempt(record.httpsPort, true);
        addAttempt(record.httpPort, true);
    }

    const diagnostics: string[] = [];
    for (const { port, useTls } of attempts) {
        if (signal?.aborted) { return null; }
        const key = `${port}:${record.csrfToken}:${useTls ? 'tls' : 'http'}`;
        if (attemptedKeys.has(key) || attemptedKeys.has(`${port}:${record.csrfToken}`)) { continue; }
        attemptedKeys.add(key);
        const found = await probeSchemeWithLoopbackFallback(
            port, record.csrfToken, useTls, record.pid, false, signal, diagnostics,
        );
        if (found) { return found; }
    }
    if (diagnostics.length > 0) {
        log?.(`Daemon hub probe failed for pid ${record.pid}: ${diagnostics.join('; ')}`);
    }
    return null;
}

/**
 * Hint-first daemon JSON + direct hint.port fallback when OS process listing
 * fails (e.g. Windows WMI/PowerShell blocked, Linux hidepid) or argv omits
 * --csrf_token / --hub-port. Preserves strict single-instance affinity.
 */
async function probeHintFallback(
    hint: LSConnectionHint,
    lines: readonly string[],
    windowsProcesses: boolean,
    attemptedKeys: Set<string>,
    signal?: AbortSignal,
    log?: (msg: string) => void,
    daemonDir: string = getAntigravityDaemonDir(),
    includeMetadata = false,
): Promise<LSInfo | null> {
    if (signal?.aborted) { return null; }

    // 1. Check ~/.gemini/antigravity/daemon/hub_<hint.port>.json (verifying exact CSRF token match).
    const hubRecord = readHubDiscoveryFile(hint.port, daemonDir);
    if (hubRecord && hubRecord.csrfToken === hint.csrfToken
        && (hubRecord.httpPort === hint.port || hubRecord.httpsPort === hint.port)) {
        const found = await probeHubRecord(hubRecord, hint.port, attemptedKeys, signal, log);
        if (found) {
            log?.(`Found backend via daemon hub_${hint.port}.json (pid=${found.pid}, port=${found.port}, tls=${found.useTls})`);
            return includeMetadata
                ? { ...found, surface: classifyHubRecordSurface(hubRecord, lines, windowsProcesses) === 'unknown' ? 'ide' : classifyHubRecordSurface(hubRecord, lines, windowsProcesses), source: 'hub-file' }
                : found;
        }
    }

    // 2. Direct probe of hint.port with hint.csrfToken (works even without daemon dir or process list).
    if (signal?.aborted || attemptedKeys.has(`${hint.port}:${hint.csrfToken}`)) { return null; }
    const pid = (hubRecord && hubRecord.csrfToken === hint.csrfToken && hubRecord.pid > 0)
        ? hubRecord.pid
        : findPidForHintPortWithoutToken(lines, hint, windowsProcesses);
    const diagnostics: string[] = [];
    for (const useTls of [false, true]) {
        if (signal?.aborted) { return null; }
        const schemeKey = `${hint.port}:${hint.csrfToken}:${useTls ? 'tls' : 'http'}`;
        if (attemptedKeys.has(schemeKey)) { continue; }
        attemptedKeys.add(schemeKey);
        const found = await probeSchemeWithLoopbackFallback(
            hint.port, hint.csrfToken, useTls, pid, false, signal, diagnostics,
        );
        if (found) {
            log?.(`Found backend via direct IDE hint probe (pid=${found.pid}, port=${found.port}, tls=${found.useTls})`);
            return includeMetadata ? { ...found, surface: 'ide', source: 'hint' } : found;
        }
    }
    attemptedKeys.add(`${hint.port}:${hint.csrfToken}`);
    if (diagnostics.length > 0) {
        log?.(`Direct IDE hint probe failed for port ${hint.port}: ${diagnostics.join('; ')}`);
    }
    return null;
}

/**
 * Standalone daemon hub_<port>.json fallback (scanned ONLY when no built-in IDE hint is present).
 * Orders records by `preferredSurface` when requested (App vs IDE) while preserving mtime order within a surface.
 */
async function probeStandaloneHubFiles(
    attemptedKeys: Set<string>,
    signal?: AbortSignal,
    log?: (msg: string) => void,
    processLines: readonly string[] = [],
    preferredSurface?: 'app' | 'ide',
    windowsProcesses = process.platform === 'win32' || isWSL(),
    daemonDirs: string | readonly string[] = getAntigravityDaemonDirs(),
    includeMetadata = false,
): Promise<LSInfo | null> {
    if (signal?.aborted) { return null; }
    const dirs = typeof daemonDirs === 'string' ? [daemonDirs] : daemonDirs;
    const records = selectMatchingHubRecords(
        readAllHubDiscoveryFilesFromDirs(dirs),
        processLines,
        preferredSurface,
        windowsProcesses,
    );
    for (const record of records) {
        if (signal?.aborted) { return null; }
        const found = await probeHubRecord(record, undefined, attemptedKeys, signal, log);
        if (found) {
            log?.(`Found standalone backend via daemon hub file (pid=${found.pid}, port=${found.port}, tls=${found.useTls})`);
            if (!includeMetadata) { return found; }
            const surface = classifyHubRecordSurface(record, processLines, windowsProcesses);
            return { ...found, surface, source: 'hub-file' };
        }
    }
    return null;
}

/**
 * Discover an Antigravity LS running natively inside this WSL distro.
 *
 * Under Remote-WSL the IDE spawns `language_server_linux_x64` inside the distro, and when
 * the extension host runs inside that same distro the server is directly reachable on
 * 127.0.0.1. The main discovery path treated "we are under WSL" as "the server is on the
 * Windows host" and went straight to /mnt/c interop, so this — the one case a WSL-hosted
 * extension can actually connect to — was never attempted. Discovery would then find the
 * Windows LS, report its pid and port, and fail every probe: a socket bound to the Windows
 * loopback address is not routable from inside the WSL VM under the default NAT
 * networking, so no host value the extension could pick would reach it.
 */
async function discoverLocalLinuxLanguageServer(
    workspaceUri?: string, signal?: AbortSignal, log?: (msg: string) => void,
    hint?: LSConnectionHint, preferredSurface?: 'app' | 'ide', includeMetadata = false,
): Promise<LSInfo | null> {
    let psOutput: string;
    try {
        const result = await execFileAsync('ps', ['-axww', '-o', 'pid=,command='], {
            encoding: 'utf-8', timeout: 5000, signal, windowsHide: true,
        });
        psOutput = result.stdout;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
        log?.(`WSL: local ps discovery failed (${code})`);
        return null;
    }

    const lines = filterLsProcessLines(psOutput, 'language_server_linux');
    if (lines.length === 0) { return null; }

    for (const line of orderedProcessLines(lines, workspaceUri, hint, preferredSurface)) {
        if (signal?.aborted) { return null; }
        const pid = extractPid(line);
        const csrfToken = extractCsrfToken(line);
        if (!pid || !csrfToken) { continue; }
        const found = await probeProcess(line, pid, csrfToken,
            () => findListeningPortCandidates(pid, signal, log, true), signal, log, hint?.port);
        if (found) {
            return includeMetadata
                ? { ...found, surface: classifyProcessSurface(line), source: 'process' }
                : found;
        }
    }
    return null;
}

/**
 * Discover the Antigravity language server process (supporting both Antigravity App 2.0
 * and Antigravity IDE across macOS, Windows, Linux, and WSL).
 *
 * Accepts either the options object (`DiscoverLanguageServerOptions`, enabling first-priority
 * `ANTIGRAVITY_LS_ADDRESS` env discovery, `preferredSurface` disambiguation, and `surface`/`source`
 * metadata) or the legacy positional parameters `(workspaceUri?, signal?, log?, hint?)`.
 */
export async function discoverLanguageServer(options: DiscoverLanguageServerOptions): Promise<LSInfo | null>;
export async function discoverLanguageServer(
    workspaceUri?: string,
    signal?: AbortSignal,
    log?: (msg: string) => void,
    hint?: LSConnectionHint,
): Promise<LSInfo | null>;
export async function discoverLanguageServer(
    workspaceUriOrOptions?: string | DiscoverLanguageServerOptions,
    signalArg?: AbortSignal,
    logArg?: (msg: string) => void,
    hintArg?: LSConnectionHint,
): Promise<LSInfo | null> {
    const isOptionsCall = typeof workspaceUriOrOptions === 'object' && workspaceUriOrOptions !== null;
    const workspaceUri = isOptionsCall ? workspaceUriOrOptions.workspaceUri : workspaceUriOrOptions;
    const signal = isOptionsCall ? workspaceUriOrOptions.signal : signalArg;
    const log = isOptionsCall ? workspaceUriOrOptions.log : logArg;
    const hint = isOptionsCall ? workspaceUriOrOptions.hint : hintArg;
    const preferredSurface = isOptionsCall ? workspaceUriOrOptions.preferredSurface : undefined;
    const env = isOptionsCall ? (workspaceUriOrOptions.env ?? process.env) : process.env;
    const explicitDaemonDir = isOptionsCall ? workspaceUriOrOptions.daemonDir : undefined;
    const daemonDirs: string[] = explicitDaemonDir
        ? [explicitDaemonDir]
        : (isOptionsCall && typeof env.ANTIGRAVITY_APP_DATA_DIR === 'string' && env.ANTIGRAVITY_APP_DATA_DIR.trim()
            ? [join(env.ANTIGRAVITY_APP_DATA_DIR.trim(), 'daemon')]
            : getAntigravityDaemonDirs({ env }));
    const daemonDir = daemonDirs[0] || getAntigravityDaemonDir();
    const useEnv = isOptionsCall
        ? (workspaceUriOrOptions.useEnv ?? (preferredSurface !== 'ide' && !hint))
        : false;
    const includeMetadata = isOptionsCall;

    // CR-#62: one-time PATH visibility so a missing Wbem / WindowsPowerShell dir
    // (the suspected root cause of "LS not found") is immediately diagnosable.
    if (signal?.aborted) { return null; }
    if (hint && (!Number.isInteger(hint.port) || hint.port < 1 || hint.port > 65535
        || !hint.csrfToken || /\s/.test(hint.csrfToken))) {
        log?.('Ignoring invalid IDE connection hint; no alternate account will be selected');
        return null;
    }
    logDiscoveryPathOnce(log);
    try {
        // ─── Priority 1 (App / options mode): ANTIGRAVITY_LS_ADDRESS + CSRF env vars ─
        if (useEnv && !hint) {
            const envResult = await discoverFromEnv(env, signal, log, daemonDir);
            if (envResult) {
                return envResult;
            }
        }

        // ─── Remote-WSL: discover LS running inside WSL distro ──────────
        // When workspace is vscode-remote://wsl+<distro>/..., the IDE
        // spawns language_server_linux_x64 inside the WSL environment.
        // Try WSL discovery FIRST before falling back to Windows LS.
        if (process.platform === 'win32' && workspaceUri) {
            const wslDistro = extractWslDistro(workspaceUri);
            if (wslDistro) {
                log?.(`Attempting WSL LS discovery in distro "${wslDistro}"`);
                const wslResult = await discoverWslLanguageServer(wslDistro, workspaceUri, signal, log, hint);
                if (wslResult) {
                    log?.(`Found WSL LS: port=${wslResult.port}, pid=${wslResult.pid}`);
                    return includeMetadata ? { ...wslResult, surface: 'ide', source: 'process' } : wslResult;
                }
                log?.('WSL LS not found, falling back to Windows LS');
            }
        }

        // ─── Extension host inside WSL: prefer the LS in this distro ─────
        // Reachable on 127.0.0.1; the Windows-host LS below is not (see
        // discoverLocalLinuxLanguageServer). Try it first, fall through if absent.
        if (isWSL()) {
            const localResult = await discoverLocalLinuxLanguageServer(
                workspaceUri, signal, log, hint, preferredSurface, includeMetadata,
            );
            if (localResult) {
                log?.(`Found LS inside WSL distro: port=${localResult.port}, pid=${localResult.pid}`);
                return localResult;
            }
            log?.('No LS inside this WSL distro, trying the Windows host LS');
        }

        let lines: string[] = [];
        const windowsProcesses = process.platform === 'win32' || isWSL();
        try {
            if (windowsProcesses) {
                const output = await discoverWindowsProcesses(signal, log);
                lines = filterLsProcessLines(output, 'language_server_windows');
            } else {
                const result = await execFileAsync('ps', ['-axww', '-o', 'pid=,command='], {
                    encoding: 'utf-8', timeout: 5000, signal, windowsHide: true,
                });
                lines = filterLsProcessLines(result.stdout);
            }
        } catch (e) {
            if (signal?.aborted) { return null; }
            const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
            log?.(`process listing failed (${code}); will try daemon/hint fallback`);
            lines = [];
        }

        if (signal?.aborted) { return null; }

        const attemptedKeys = new Set<string>();
        const ordered = orderedProcessLines(lines, workspaceUri, hint, preferredSurface);
        let hubRecordsCache: HubDiscoveryRecord[] | null = null;
        const getHubRecords = (): HubDiscoveryRecord[] => {
            if (hubRecordsCache === null) {
                hubRecordsCache = readAllHubDiscoveryFilesFromDirs(daemonDirs);
            }
            return hubRecordsCache;
        };

        for (const line of ordered) {
            if (signal?.aborted) { return null; }
            const pid = windowsProcesses ? extractWindowsPid(line) : extractPid(line);
            if (!pid) { continue; }
            const csrfToken = extractCsrfToken(line);
            if (csrfToken) {
                const result = await probeProcess(
                    line, pid, csrfToken,
                    () => findListeningPortCandidates(pid, signal, log),
                    signal, log, hint?.port, attemptedKeys,
                );
                if (result) {
                    return includeMetadata
                        ? { ...result, surface: classifyProcessSurface(line), source: 'process' }
                        : result;
                }
                log?.(`RPC probe failed for candidate pid ${pid}; trying remaining processes`);
                continue;
            }

            // Antigravity App v2.34+ standalone hub (`language_server --standalone --subclient_type hub`)
            // intentionally omits --csrf_token from argv and writes ~/.gemini/antigravity/daemon/hub_<port>.json.
            // Pair the process PID against hub_*.json when no conflicting hint restricts us.
            if (!hint) {
                const matchingHub = getHubRecords().find(r => r.pid === pid);
                if (matchingHub) {
                    const hubResult = await probeHubRecord(matchingHub, undefined, attemptedKeys, signal, log);
                    if (hubResult) {
                        const surface = classifyProcessSurface(line);
                        log?.(`Paired pid=${pid} (${surface}) with daemon hub file (port=${hubResult.port}, tls=${hubResult.useTls})`);
                        return includeMetadata
                            ? { ...hubResult, surface, source: 'hub-file' }
                            : hubResult;
                    }
                }
            }
        }

        if (hint) {
            if (hasConflictingProcessForHint(lines, hint)) {
                log?.(`Hinted port ${hint.port} is owned by another Antigravity instance; waiting`);
                return null;
            }
            return await probeHintFallback(
                hint, lines, windowsProcesses, attemptedKeys, signal, log, daemonDir, includeMetadata,
            );
        }

        // Standalone / App hub file fallback (no built-in google.google-antigravity hint):
        // scan ~/.gemini/antigravity/daemon/hub_*.json preferring `preferredSurface` when set.
        const standaloneResult = await probeStandaloneHubFiles(
            attemptedKeys, signal, log, lines, preferredSurface, windowsProcesses, daemonDirs, includeMetadata,
        );
        if (standaloneResult) { return standaloneResult; }

        if (lines.length === 0) {
            log?.('matched 0 Antigravity language_server or agy hub processes');
        }
        if (isWSL()) {
            log?.('This extension host runs inside WSL and no reachable local server was found. '
                + 'A Windows-host server bound to loopback is unreachable under default WSL2 NAT; '
                + 'install this extension on the Windows side or use WSL mirrored networking.');
        }
        return null;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
        log?.(`discovery error: ${code}`);
        return null;
    }
}

type SingleProbeResult =
    | { kind: 'ok' }
    | { kind: 'unimplemented'; statusCode: number }
    | { kind: 'fail'; reason: string; connectionRefused?: boolean };

interface PortProbeDetail {
    ok: boolean;
    connectionRefused: boolean;
    summary: string;
}

/**
 * Send a single CSRF-authenticated Connect-RPC probe to `endpoint`.
 * Returns `unimplemented` ONLY on HTTP 404/501 so callers fall through to the
 * next compatible endpoint while stopping immediately on 401/403/400/TLS/socket/timeout.
 */
async function probeEndpoint(
    port: number,
    csrfToken: string,
    useTls: boolean,
    endpoint: string,
    hostname: string,
    signal?: AbortSignal,
): Promise<SingleProbeResult> {
    return new Promise((resolve) => {
        // CR-C2: Early abort check
        if (signal?.aborted) {
            resolve({ kind: 'fail', reason: 'aborted' });
            return;
        }

        let settled = false;
        const settle = (value: SingleProbeResult) => {
            if (settled) { return; }
            settled = true;
            cleanupAbortListener();
            resolve(value);
        };

        const postData = JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                ideVersion: 'unknown',
                locale: 'en'
            }
        });

        const options: https.RequestOptions = {
            hostname,
            port,
            path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': csrfToken,
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 3000,
            rejectUnauthorized: false // Self-signed cert
        };

        // CR-C2: Abort listener — destroy request on signal abort
        let onAbort: (() => void) | undefined;
        const cleanupAbortListener = () => {
            if (onAbort && signal) {
                signal.removeEventListener('abort', onAbort);
                onAbort = undefined;
            }
        };

        const transport = useTls ? https : http;
        // CR-M1: probePort body limit — enough for GetUserStatus fallback (~55KB-500KB), cap at 2MB
        const PROBE_MAX_BODY = 2 * 1024 * 1024;
        const req = transport.request(options, (res) => {
            let body = '';
            let bodySize = 0;
            res.on('data', (chunk: Buffer | string) => {
                bodySize += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
                if (bodySize > PROBE_MAX_BODY) {
                    req.destroy();
                    settle({ kind: 'fail', reason: 'response too large' });
                    return;
                }
                body += chunk;
            });
            // CR2-Fix3: Handle response-side stream errors (e.g. TCP RST,
            // half-broken connections). Without this, the Promise would hang
            // until the req.on('timeout') fires.
            res.on('error', (err) => settle({
                kind: 'fail',
                reason: (err as NodeJS.ErrnoException).code || err.message || 'response error',
            }));
            res.on('end', () => {
                const status = res.statusCode;
                if (status === 404 || status === 501) {
                    settle({ kind: 'unimplemented', statusCode: status });
                    return;
                }
                // M3: Check HTTP status code — 401/403/400/5xx are not valid RPC endpoints
                if (!status || status < 200 || status >= 300) {
                    settle({ kind: 'fail', reason: `HTTP ${status ?? 'unknown'}` });
                    return;
                }
                try {
                    const parsed: unknown = JSON.parse(body);
                    // Connect JSON messages are objects (including `{}` from GetStatus / GetUnleashData).
                    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        // On the GetUserStatus fallback, verify a non-null, non-array userStatus object
                        // so soft-200 JSON error responses (`{}`, `{ userStatus: [] }`, `{ userStatus: null }`)
                        // cannot falsely match a non-LS server.
                        if (endpoint === 'GetUserStatus') {
                            const userStatus = (parsed as Record<string, unknown>).userStatus;
                            if (typeof userStatus !== 'object' || userStatus === null || Array.isArray(userStatus)) {
                                settle({ kind: 'fail', reason: 'invalid GetUserStatus body' });
                                return;
                            }
                        }
                        settle({ kind: 'ok' });
                    } else {
                        settle({ kind: 'fail', reason: 'non-object JSON' });
                    }
                } catch {
                    settle({ kind: 'fail', reason: 'invalid JSON' });
                }
            });
        });

        req.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            settle({
                kind: 'fail',
                reason: code || err.message || 'socket error',
                connectionRefused: code === 'ECONNREFUSED',
            });
        });
        req.on('timeout', () => { req.destroy(); settle({ kind: 'fail', reason: 'timeout' }); });

        if (signal) {
            onAbort = () => { req.destroy(); settle({ kind: 'fail', reason: 'aborted' }); };
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) { onAbort(); return; }
        }

        req.write(postData);
        req.end();
    });
}

/**
 * Probe a port across PROBE_ENDPOINTS (`GetStatus` → `GetUnleashData` → `GetUserStatus`).
 * Advances ONLY on HTTP 404/501 (endpoint removed/unimplemented); stops immediately on
 * auth errors (401/403), transport/TLS errors, invalid JSON, timeout, or abort.
 */
async function probePortWithDetail(
    port: number,
    csrfToken: string,
    useTls: boolean,
    signal?: AbortSignal,
    hostname = '127.0.0.1',
): Promise<PortProbeDetail> {
    const attempts: string[] = [];
    for (const endpoint of PROBE_ENDPOINTS) {
        if (signal?.aborted) {
            return { ok: false, connectionRefused: false, summary: 'aborted' };
        }
        const res = await probeEndpoint(port, csrfToken, useTls, endpoint, hostname, signal);
        if (res.kind === 'ok') {
            return { ok: true, connectionRefused: false, summary: `${endpoint}:200` };
        }
        if (res.kind === 'unimplemented') {
            attempts.push(`${endpoint}:HTTP ${res.statusCode}`);
            continue;
        }
        attempts.push(`${endpoint}:${res.reason}`);
        return { ok: false, connectionRefused: !!res.connectionRefused, summary: attempts.join(' → ') };
    }
    return { ok: false, connectionRefused: false, summary: attempts.join(' → ') };
}

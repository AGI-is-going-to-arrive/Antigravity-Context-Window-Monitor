import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';
import { readFileSync, existsSync } from 'fs';

const execFileAsync = promisify(execFile);

// ─── WSL Detection ────────────────────────────────────────────────────────────
// Cached tri-state: null = untested, true = WSL, false = not WSL.
let wslDetected: boolean | null = null;

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

/** Reset WSL detection cache (exported for testing). */
export function resetWslCache(): void {
    wslDetected = null;
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

export interface LSInfo {
    pid: number;
    csrfToken: string;
    port: number;
    useTls: boolean;
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
    // Step 1: Strip the URI scheme separator
    id = id.replace(':///', '_');
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

/**
 * Extract CSRF token from a ps output line.
 */
export function extractCsrfToken(line: string): string | null {
    const csrfMatch = line.match(/--csrf_token\s+([^\s]+)/);
    return csrfMatch ? csrfMatch[1] : null;
}

/**
 * Extract workspace_id from a ps output line.
 */
export function extractWorkspaceId(line: string): string | null {
    const match = line.match(/--workspace_id\s+([^\s]+)/);
    return match ? match[1] : null;
}

/**
 * Select the LS process line for the current workspace.
 *
 * PRIORITY ORDER (Antigravity 1.22.2+ compatibility):
 * 1. Processes WITHOUT --workspace_id → new shared LS architecture (preferred)
 * 2. Processes WITH matching workspace_id → old per-workspace LS (fallback)
 * 3. First discovered LS → last resort
 *
 * BUG FIX: Antigravity 1.22.2+ launches a single shared LS without
 * --workspace_id. When an old LS (with workspace_id) is still alive,
 * the previous logic always picked the old stale LS because it had a
 * matching workspace_id. The new shared LS (without workspace_id) is
 * the active instance and should be preferred.
 */
export function selectMatchingProcessLine(lines: readonly string[], workspaceUri?: string): string | null {
    if (lines.length === 0) {
        return null;
    }
    if (lines.length === 1) {
        return lines[0];
    }

    // Separate processes into new-style (no workspace_id) and old-style (has workspace_id)
    const newStyleLines = lines.filter(line => extractWorkspaceId(line) === null);
    const oldStyleLines = lines.filter(line => extractWorkspaceId(line) !== null);

    // Priority 1: Prefer new-style shared LS (no workspace_id)
    // These are Antigravity 1.22.2+ processes — the active instance.
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
        return low.includes(binaryName) && low.includes('antigravity');
    });
}

/**
 * Whether a socket bound to `host` can be reached by connecting to 127.0.0.1.
 * Loopback itself plus the wildcard forms every tool spells differently
 * (`0.0.0.0`, `*`, `::`, `[::]`), which all include the loopback interface.
 * `[::1]` is IPv6-only loopback: on a dual-stack Windows socket the same port is
 * also open on IPv4, and when it isn't the probe just fails, so accepting it
 * costs one failed connect and buys the dual-stack case.
 */
function isLoopbackReachableHost(host: string): boolean {
    return host === '127.0.0.1' || host === '0.0.0.0' || host === '*'
        || host === '::' || host === '[::]' || host === '[::1]';
}

/**
 * Extract the port from an `address:port` token, but only when a client on
 * 127.0.0.1 could actually reach it. Returns null for port 0, which is what a
 * foreign-address column reads as on a listening row.
 */
function portFromAddressToken(token: string): number | null {
    const m = token.match(/^(.*):(\d+)$/);
    if (!m || !isLoopbackReachableHost(m[1])) { return null; }
    const port = parseInt(m[2], 10);
    return port > 0 ? port : null;
}

/**
 * Extract port from a lsof output line.
 * `lsof -nP` prints the bind address as `*:PORT` when the server listened on all
 * interfaces rather than on loopback specifically, so matching 127.0.0.1 alone
 * would miss a reachable LS (issue #64, same root cause as the netstat case).
 */
export function extractPort(line: string): number | null {
    for (const token of line.trim().split(/\s+/)) {
        const port = portFromAddressToken(token);
        if (port !== null) { return port; }
    }
    return null;
}

/**
 * Extract port from a Linux `ss -tlnp` output line.
 * Matches patterns like `127.0.0.1:12345`, `*:12345`, `0.0.0.0:12345`, `:::12345`
 */
export function extractPortFromSs(line: string): number | null {
    const portMatch = line.match(/(?:127\.0\.0\.1|\*|0\.0\.0\.0|::):([\d]+)\s/);
    return portMatch ? parseInt(portMatch[1], 10) : null;
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
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) { return null; }
    return portFromAddressToken(cols[1]);
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
    const decoded = decodeURIComponent(uri);
    const match = decoded.match(/^vscode-remote:\/\/wsl\+([^/]+)\//i);
    return match ? match[1] : null;
}

/**
 * Discover the Antigravity LS running INSIDE a WSL distro.
 * This handles the Remote-WSL scenario where the IDE spawns
 * language_server_linux_x64 inside the WSL environment.
 *
 * Strategy:
 * 1. Run `wsl -d <distro> -- ps aux` to find the LS process
 * 2. Match workspace_id if available
 * 3. Extract CSRF token and PID
 * 4. Run `wsl -d <distro> -- ss -tlnp` to find listening ports
 * 5. Probe ports from Windows (WSL2 auto-forwards to localhost)
 */
async function discoverWslLanguageServer(
    distro: string,
    workspaceUri: string,
    signal?: AbortSignal,
    log?: (msg: string) => void
): Promise<LSInfo | null> {
    // CR-#62: invoke wsl.exe by absolute path when %SystemRoot% is known, so
    // Remote-WSL discovery does not depend on the Extension Host PATH either.
    const winRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const wslExe = winRoot && existsSync(`${winRoot}\\System32\\wsl.exe`)
        ? `${winRoot}\\System32\\wsl.exe`
        : 'wsl';
    try {
        // 1. Find LS process inside WSL
        const psResult = await execFileAsync(wslExe, [
            '-d', distro, '--', 'bash', '-c',
            // -i so an install path spelled with capitals still matches (the JS-side filter below
            // cannot rescue a line this grep already dropped), and the [l] bracket trick excludes
            // this grep's own process without `grep -v grep` — which would also drop a REAL language
            // server whose command line merely contains "grep" (e.g. a workspace under /home/u/grep-tools).
            'ps aux | grep -i "[l]anguage_server"'
        ], { encoding: 'utf-8', timeout: 10000, signal });

        // Case-insensitive, matching filterLsProcessLines() and the native Windows branch. The
        // install path can be spelled "Antigravity", so a case-sensitive test finds nothing and
        // Remote-WSL discovery reports "no language_server process" on a perfectly healthy machine.
        // Lower-case a COPY for the test only — the original line still carries the CSRF token.
        const psLines = psResult.stdout.split('\n').filter(l => {
            const lower = l.toLowerCase();
            return lower.includes('language_server') && lower.includes('antigravity');
        });

        if (psLines.length === 0) {
            log?.(`WSL[${distro}]: no language_server process found inside distro`);
            return null;
        }

        // 2. Match workspace_id if possible
        const targetLine = selectMatchingProcessLine(psLines, workspaceUri);
        if (!targetLine) {
            return null;
        }

        // 3. Extract CSRF token
        const csrfToken = extractCsrfToken(targetLine);
        if (!csrfToken) {
            return null;
        }

        // 4. Extract PID from ps aux format (column 2)
        const pidMatch = targetLine.trim().match(/^\S+\s+(\d+)/);
        const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;
        if (!pid) {
            return null;
        }

        // 5. Find listening ports via ss inside WSL
        let ports: number[] = [];
        try {
            const ssResult = await execFileAsync(wslExe, [
                '-d', distro, '--', 'ss', '-tlnp'
            ], { encoding: 'utf-8', timeout: 5000, signal });

            for (const line of ssResult.stdout.split('\n')) {
                if (line.includes(`pid=${pid},`) || line.includes(`pid=${pid})`)) {
                    const port = extractPortFromSs(line);
                    if (port !== null) {
                        ports.push(port);
                    }
                }
            }
        } catch { /* ss failed */ }

        if (ports.length === 0) {
            return null;
        }

        // 6. Probe ports from Windows (WSL2 auto-forwards localhost ports)
        for (const port of ports) {
            const httpsOk = await probePort(port, csrfToken, true, signal);
            if (httpsOk) {
                return { pid, csrfToken, port, useTls: true };
            }
            const httpOk = await probePort(port, csrfToken, false, signal);
            if (httpOk) {
                return { pid, csrfToken, port, useTls: false };
            }
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
 * When running inside WSL, uses full paths under /mnt/c/ for Windows executables
 * via WSL interop, falling back to bare exe names (which WSL also resolves).
 */
async function discoverWindowsProcesses(signal?: AbortSignal, log?: (msg: string) => void): Promise<string> {
    const inWSL = isWSL();
    const winRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';

    // Determine executable paths.
    // - WSL: explicit /mnt/c paths (Windows host binaries via interop) — including
    //   powershell.exe, which was previously a bare no-op ternary (CR-#62).
    // - Native Windows: absolute %SystemRoot% paths so discovery does not depend
    //   on the Extension Host's inherited PATH. buildWindowsExePath falls back to
    //   bare names when %SystemRoot% is somehow unset.
    const wmicExe = inWSL ? '/mnt/c/Windows/System32/wbem/WMIC.exe' : buildWindowsExePath(winRoot, 'wmic');
    const psExe = inWSL ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : buildWindowsExePath(winRoot, 'powershell');

    // Try wmic unless already known unavailable, or the executable is absent on
    // disk. Win11 24H2+/25H2 removed WMIC by default (KB 5067470); pre-checking
    // existence makes PowerShell the deliberate primary rather than an
    // exception-driven afterthought.
    const wmicOnDisk = inWSL || !winRoot || existsSync(wmicExe);
    if (wmicAvailable !== false && wmicOnDisk) {
        try {
            const result = await execFileAsync(wmicExe, [
                'process', 'where',
                "name like 'language_server_windows%'",
                'get', 'ProcessId,CommandLine', '/format:csv'
            ], { encoding: 'utf-8', timeout: 5000, signal });
            // CR-#62: only trust/cache wmic when it actually returned LS rows.
            // A transient empty stdout must NOT cache wmicAvailable=true, else the
            // PowerShell fallback would be permanently skipped.
            if (result.stdout && result.stdout.includes('language_server_windows')) {
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

    // Fallback: PowerShell Get-CimInstance with server-side WMI filter.
    // CR-#62: wrapped in try/catch so a powershell.exe ENOENT is logged and
    // downgraded to an empty result (→ caller returns a reasoned null) instead of
    // an unhandled rejection that collapses into the silent outer catch.
    try {
        const result = await execFileAsync(psExe, [
            '-NoProfile', '-NoLogo', '-Command',
            'Get-CimInstance Win32_Process -Filter "Name like \'language_server_windows%\'" | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation'
        ], { encoding: 'utf-8', timeout: 10000, signal });
        return result.stdout;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
        log?.(`PowerShell discovery failed (${code}); exe=${psExe}`);
        return '';
    }
}

/**
 * Find listening TCP ports for a given PID.
 * Uses lsof (macOS + most Linux), with fallback to ss (Linux default).
 * In WSL, uses Windows netstat.exe since the LS is a Windows host process.
 *
 * `forceNative` skips that WSL assumption: when the PID belongs to a Linux LS running
 * inside this distro, its ports are in the distro's own network namespace and Windows
 * netstat.exe cannot see them.
 */
async function findListeningPorts(
    pid: number, signal?: AbortSignal, log?: (msg: string) => void, forceNative = false,
): Promise<number[]> {
    // Windows (or WSL): use netstat -ano to find Windows host ports
    if (!forceNative && (process.platform === 'win32' || isWSL())) {
        const winRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
        const netstatExe = isWSL() ? '/mnt/c/Windows/System32/netstat.exe' : buildWindowsExePath(winRoot, 'netstat');
        try {
            const result = await execFileAsync(netstatExe, [
                '-ano'
            ], { encoding: 'utf-8', timeout: 5000, signal });
            const ports: number[] = [];
            for (const line of result.stdout.split('\n')) {
                // netstat -ano format: TCP    127.0.0.1:PORT    0.0.0.0:0    LISTENING    PID
                // CR-#62: exact PID-column match (previous endsWith matched 123 vs 1123).
                if (netstatLineMatchesPid(line, pid)) {
                    const port = extractPortFromNetstat(line);
                    if (port !== null) {
                        ports.push(port);
                    }
                }
            }
            return ports;
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
            log?.(`netstat failed (${code}); exe=${netstatExe}`);
        }
        return [];
    }

    // macOS + Linux: try lsof first
    try {
        const result = await execFileAsync('lsof', [
            '-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)
        ], { encoding: 'utf-8', timeout: 5000, signal });
        const lsofOutput = result.stdout.trim();
        if (lsofOutput) {
            const ports: number[] = [];
            for (const line of lsofOutput.split('\n')) {
                const port = extractPort(line);
                if (port !== null) {
                    ports.push(port);
                }
            }
            if (ports.length > 0) {
                return ports;
            }
        }
    } catch { /* lsof not available or failed — try fallback */ }

    // Linux fallback: ss command (installed by default via iproute2)
    if (process.platform === 'linux') {
        try {
            const result = await execFileAsync('ss', [
                '-tlnp'
            ], { encoding: 'utf-8', timeout: 5000, signal });
            const ports: number[] = [];
            for (const line of result.stdout.split('\n')) {
                // ss output includes process info like: users:(("language_server_linux",pid=1234,fd=5))
                if (line.includes(`pid=${pid},`) || line.includes(`pid=${pid})`)) {
                    const port = extractPortFromSs(line);
                    if (port !== null) {
                        ports.push(port);
                    }
                }
            }
            return ports;
        } catch { /* ss also failed */ }
    }

    return [];
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
): Promise<LSInfo | null> {
    let psOutput: string;
    try {
        const result = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='], {
            encoding: 'utf-8', timeout: 5000, signal,
        });
        psOutput = result.stdout;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
        log?.(`WSL: local ps discovery failed (${code})`);
        return null;
    }

    const lines = filterLsProcessLines(psOutput, 'language_server_linux');
    if (lines.length === 0) { return null; }

    const targetLine = selectMatchingProcessLine(lines, workspaceUri);
    if (!targetLine) { return null; }

    const trimmed = targetLine.trim();
    const pid = extractPid(trimmed);
    const csrfToken = extractCsrfToken(trimmed);
    if (!pid || !csrfToken) { return null; }

    const ports = await findListeningPorts(pid, signal, log, true);
    for (const port of ports) {
        if (await probePort(port, csrfToken, true, signal)) { return { pid, csrfToken, port, useTls: true }; }
        if (await probePort(port, csrfToken, false, signal)) { return { pid, csrfToken, port, useTls: false }; }
    }
    return null;
}

/**
 * Discover the Antigravity language server process that belongs to this workspace.
 * Extracts PID, CSRF token from process args, and finds the listening port.
 *
 * S2 fix: Uses async execFile instead of execSync to avoid blocking the VS Code UI thread.
 * S3 fix: Uses execFile (no shell) to prevent command injection risks.
 * CR-#3: Accepts AbortSignal for cancellation on extension deactivate.
 */
export async function discoverLanguageServer(workspaceUri?: string, signal?: AbortSignal, log?: (msg: string) => void): Promise<LSInfo | null> {
    // CR-#62: one-time PATH visibility so a missing Wbem / WindowsPowerShell dir
    // (the suspected root cause of "LS not found") is immediately diagnosable.
    logDiscoveryPathOnce(log);
    try {
        // ─── Remote-WSL: discover LS running inside WSL distro ──────────
        // When workspace is vscode-remote://wsl+<distro>/..., the IDE
        // spawns language_server_linux_x64 inside the WSL environment.
        // Try WSL discovery FIRST before falling back to Windows LS.
        if (process.platform === 'win32' && workspaceUri) {
            const wslDistro = extractWslDistro(workspaceUri);
            if (wslDistro) {
                log?.(`Attempting WSL LS discovery in distro "${wslDistro}"`);
                const wslResult = await discoverWslLanguageServer(wslDistro, workspaceUri, signal, log);
                if (wslResult) {
                    log?.(`Found WSL LS: port=${wslResult.port}, pid=${wslResult.pid}`);
                    return wslResult;
                }
                log?.('WSL LS not found, falling back to Windows LS');
            }
        }

        // ─── Extension host inside WSL: prefer the LS in this distro ─────
        // Reachable on 127.0.0.1; the Windows-host LS below is not (see
        // discoverLocalLinuxLanguageServer). Try it first, fall through if absent.
        if (isWSL()) {
            const localResult = await discoverLocalLinuxLanguageServer(workspaceUri, signal, log);
            if (localResult) {
                log?.(`Found LS inside WSL distro: port=${localResult.port}, pid=${localResult.pid}`);
                return localResult;
            }
            log?.('No LS inside this WSL distro, trying the Windows host LS');
        }

        let pid: number | null = null;
        let csrfToken: string | null = null;

        if (process.platform === 'win32' || isWSL()) {
            // ─── Windows: wmic.exe (preferred) or Get-CimInstance (fallback) ───
            // Uses cached wmic availability to skip missing wmic on subsequent polls.
            let wmicOutput: string;
            try {
                wmicOutput = await discoverWindowsProcesses(signal, log);
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
                log?.(`Windows process discovery threw (${code})`);
                return null;
            }

            // Parse wmic CSV or PowerShell CSV output. Both contain lines with
            // CommandLine and ProcessId fields.
            // CR-#62: case-INSENSITIVE membership test (see filterLsProcessLines),
            // returning the ORIGINAL line so the case-sensitive csrf_token survives.
            const lines = wmicOutput.split('\n').filter(l => {
                const low = l.toLowerCase();
                return low.includes('language_server_windows') && low.includes('antigravity');
            });

            if (lines.length === 0) {
                log?.(`matched 0 language_server_windows lines (${wmicOutput.length}B from process discovery)`);
                return null;
            }

            // Find the line matching our workspace
            const targetLine = selectMatchingProcessLine(lines, workspaceUri);
            if (!targetLine) {
                log?.(`no matching LS process line among ${lines.length} candidate(s)`);
                return null;
            }

            // Extract CSRF token from the command line string
            csrfToken = extractCsrfToken(targetLine);
            if (!csrfToken) {
                log?.('LS process line has no --csrf_token');
                return null;
            }

            // Extract PID — handles both wmic (PID last column) and PowerShell
            // ConvertTo-Csv (PID first, quoted column) formats.
            pid = extractWindowsPid(targetLine);
            if (!pid) {
                log?.('could not parse PID from LS process line');
                return null;
            }
        } else {
            // ─── macOS / Linux: ps for process discovery ──────────────────
            // S2/S3: async execFile — does not block the Extension Host event loop,
            // and does not spawn a shell (no command injection risk).
            let psOutput: string;
            try {
                const result = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='], {
                    encoding: 'utf-8',
                    timeout: 5000,
                    signal
                });
                psOutput = result.stdout;
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
                log?.(`ps process discovery failed (${code})`);
                return null;
            }

            const lines = filterLsProcessLines(psOutput);

            if (lines.length === 0) {
                log?.('matched 0 language_server lines from ps');
                return null;
            }

            const targetLine = selectMatchingProcessLine(lines, workspaceUri);
            if (!targetLine) {
                log?.(`no matching LS process line among ${lines.length} candidate(s)`);
                return null;
            }

            const firstLine = targetLine.trim();

            // Extract PID (first number)
            pid = extractPid(firstLine);
            if (!pid) {
                log?.('could not parse PID from ps line');
                return null;
            }

            // Extract CSRF token
            csrfToken = extractCsrfToken(firstLine);
            if (!csrfToken) {
                log?.('LS process line has no --csrf_token');
                return null;
            }
        }

        // 2. Find listening ports
        // Cross-platform: netstat (Windows), lsof (macOS + Linux), ss fallback (Linux)
        const ports = await findListeningPorts(pid, signal, log);

        if (ports.length === 0) {
            log?.(`no listening ports found for pid ${pid}`);
            return null;
        }

        // 3. Probe each port to find the Connect-RPC endpoint
        for (const port of ports) {
            // Try HTTPS first (LS typically uses self-signed cert)
            const httpsResult = await probePort(port, csrfToken, true, signal);
            if (httpsResult) {
                return { pid, csrfToken, port, useTls: true };
            }

            // Fallback to HTTP
            const httpResult = await probePort(port, csrfToken, false, signal);
            if (httpResult) {
                return { pid, csrfToken, port, useTls: false };
            }
        }

        log?.(`probe failed on all ${ports.length} port(s) [${ports.join(', ')}] for pid ${pid}`);
        if (isWSL()) {
            // Reaching here means the Windows-host LS was located but is unreachable, which
            // is the expected outcome under WSL2's default NAT networking rather than a
            // transient failure — worth saying so, because the generic message above reads
            // like the server is down when it is running perfectly well.
            log?.('This extension host runs inside WSL and the language server runs on the Windows host. '
                + 'Its port is bound to the Windows loopback address, which WSL2 cannot route to under the '
                + 'default NAT networking. Install this extension on the Windows side instead, or set '
                + '[wsl2] networkingMode=mirrored in %UserProfile%\\.wslconfig and run `wsl --shutdown`.');
        }
        return null;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? 'error';
        log?.(`discovery error: ${code}`);
        return null;
    }
}

/**
 * Probe a port by sending a lightweight RPC request.
 * M3 fix: Now checks HTTP status code — rejects non-2xx responses.
 */
async function probePort(port: number, csrfToken: string, useTls: boolean, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        // CR-C2: Early abort check
        if (signal?.aborted) {
            resolve(false);
            return;
        }

        let settled = false;
        const settle = (value: boolean) => {
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
            hostname: '127.0.0.1',
            port,
            // Use GetUnleashData for lightweight port probing (per openusage docs)
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
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
        // CR-M1: probePort body limit — only need to validate JSON, cap at 1MB
        const PROBE_MAX_BODY = 1024 * 1024;
        const req = transport.request(options, (res) => {
            let body = '';
            let bodySize = 0;
            res.on('data', (chunk: Buffer | string) => {
                bodySize += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
                if (bodySize > PROBE_MAX_BODY) {
                    req.destroy();
                    settle(false);
                    return;
                }
                body += chunk;
            });
            // CR2-Fix3: Handle response-side stream errors (e.g. TCP RST,
            // half-broken connections). Without this, the Promise would hang
            // until the req.on('timeout') fires.
            res.on('error', () => settle(false));
            res.on('end', () => {
                // M3: Check HTTP status code — 4xx/5xx are not valid RPC endpoints
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    settle(false);
                    return;
                }
                try {
                    JSON.parse(body);
                    // Any valid JSON response with 2xx status indicates a working RPC endpoint
                    settle(true);
                } catch {
                    settle(false);
                }
            });
        });

        req.on('error', () => settle(false));
        req.on('timeout', () => { req.destroy(); settle(false); });

        if (signal) {
            onAbort = () => { req.destroy(); settle(false); };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        req.write(postData);
        req.end();
    });
}

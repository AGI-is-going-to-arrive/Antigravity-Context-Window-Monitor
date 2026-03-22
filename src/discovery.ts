import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';
import { readFileSync } from 'fs';

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
    // Handle vscode-remote:// URIs — strip scheme+authority to get file path
    // e.g., vscode-remote://wsl+Ubuntu/home/user/project → /home/user/project
    const remoteMatch = id.match(/^vscode-remote:\/\/[^/]+(\/.*)/);
    if (remoteMatch) {
        // Reconstruct as file URI for consistent workspace_id generation
        id = 'file://' + remoteMatch[1];
    }
    // Step 1: Strip the URI scheme separator
    id = id.replace(':///', '_');
    if (process.platform === 'win32' || isWSL()) {
        // Windows / WSL: the LS hex-encodes the drive-letter colon as _3A_ and
        // replaces hyphens with underscores. Encode colon BEFORE replacing
        // slashes to avoid double-underscore artifacts (c:/ -> c_3A_/ -> c_3A_).
        id = id.replace(/:/g, '_3A_');
    }
    // Replace path separators
    id = id.replace(/\//g, '_');
    // The LS replaces hyphens with underscores on ALL platforms
    id = id.replace(/-/g, '_');
    if (process.platform === 'win32' || isWSL()) {
        // Collapse any double underscores from adjacent special chars (e.g., c_3A_/)
        id = id.replace(/__+/g, '_');
    }
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
 * Filter ps output lines for LS processes.
 * In WSL, looks for the Windows binary name since the LS runs on the Windows host.
 */
export function filterLsProcessLines(psOutput: string): string[] {
    const binaryName = (process.platform === 'win32' || isWSL())
        ? 'language_server_windows'
        : process.platform === 'linux'
            ? 'language_server_linux'
            : 'language_server_macos';
    return psOutput.split('\n').filter(l =>
        l.includes(binaryName) && l.includes('antigravity')
    );
}

/**
 * Extract port from a lsof output line.
 */
export function extractPort(line: string): number | null {
    const portMatch = line.match(/127\.0\.0\.1:(\d+)\s/);
    return portMatch ? parseInt(portMatch[1], 10) : null;
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
 */
export function extractPortFromNetstat(line: string): number | null {
    const portMatch = line.match(/\s+127\.0\.0\.1:(\d+)\s/);
    return portMatch ? parseInt(portMatch[1], 10) : null;
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
    signal?: AbortSignal
): Promise<LSInfo | null> {
    try {
        // 1. Find LS process inside WSL
        const psResult = await execFileAsync('wsl', [
            '-d', distro, '--', 'bash', '-c',
            'ps aux | grep language_server | grep -v grep'
        ], { encoding: 'utf-8', timeout: 10000, signal });

        const psLines = psResult.stdout.split('\n').filter(l =>
            l.includes('language_server') && l.includes('antigravity')
        );

        if (psLines.length === 0) {
            return null;
        }

        // 2. Match workspace_id if possible
        let targetLine = psLines[0];
        const expectedWsId = buildExpectedWorkspaceId(workspaceUri);
        const matchedLine = psLines.find(line => {
            const wsId = extractWorkspaceId(line);
            return wsId === expectedWsId;
        });
        if (matchedLine) {
            targetLine = matchedLine;
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
            const ssResult = await execFileAsync('wsl', [
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
async function discoverWindowsProcesses(signal?: AbortSignal): Promise<string> {
    const inWSL = isWSL();

    // Determine executable paths — WSL needs explicit /mnt/c paths or bare .exe names
    const wmicExe = inWSL ? '/mnt/c/Windows/System32/wbem/WMIC.exe' : 'wmic';
    const psExe = inWSL ? 'powershell.exe' : 'powershell.exe'; // WSL resolves via interop PATH

    // Try wmic unless already known to be unavailable
    if (wmicAvailable !== false) {
        try {
            const result = await execFileAsync(wmicExe, [
                'process', 'where',
                "name like 'language_server_windows%'",
                'get', 'ProcessId,CommandLine', '/format:csv'
            ], { encoding: 'utf-8', timeout: 5000, signal });
            wmicAvailable = true;
            return result.stdout;
        } catch {
            wmicAvailable = false;
            console.log('[ContextMonitor] wmic not available, falling back to Get-CimInstance');
        }
    }

    // Fallback: PowerShell Get-CimInstance with server-side WMI filter
    const result = await execFileAsync(psExe, [
        '-NoProfile', '-NoLogo', '-Command',
        'Get-CimInstance Win32_Process -Filter "Name like \'language_server_windows%\'" | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation'
    ], { encoding: 'utf-8', timeout: 10000, signal });
    return result.stdout;
}

/**
 * Find listening TCP ports for a given PID.
 * Uses lsof (macOS + most Linux), with fallback to ss (Linux default).
 * In WSL, uses Windows netstat.exe since the LS is a Windows host process.
 */
async function findListeningPorts(pid: number, signal?: AbortSignal): Promise<number[]> {
    // Windows (or WSL): use netstat -ano to find Windows host ports
    if (process.platform === 'win32' || isWSL()) {
        const netstatExe = isWSL() ? '/mnt/c/Windows/System32/netstat.exe' : 'netstat';
        try {
            const result = await execFileAsync(netstatExe, [
                '-ano'
            ], { encoding: 'utf-8', timeout: 5000, signal });
            const ports: number[] = [];
            const pidStr = String(pid);
            for (const line of result.stdout.split('\n')) {
                // netstat -ano format: TCP    127.0.0.1:PORT    0.0.0.0:0    LISTENING    PID
                if (line.includes('LISTENING') && line.trim().endsWith(pidStr)) {
                    const port = extractPortFromNetstat(line);
                    if (port !== null) {
                        ports.push(port);
                    }
                }
            }
            return ports;
        } catch { /* netstat failed */ }
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
 * Discover the Antigravity language server process that belongs to this workspace.
 * Extracts PID, CSRF token from process args, and finds the listening port.
 *
 * S2 fix: Uses async execFile instead of execSync to avoid blocking the VS Code UI thread.
 * S3 fix: Uses execFile (no shell) to prevent command injection risks.
 * CR-#3: Accepts AbortSignal for cancellation on extension deactivate.
 */
export async function discoverLanguageServer(workspaceUri?: string, signal?: AbortSignal): Promise<LSInfo | null> {
    try {
        // ─── Remote-WSL: discover LS running inside WSL distro ──────────
        // When workspace is vscode-remote://wsl+<distro>/..., the IDE
        // spawns language_server_linux_x64 inside the WSL environment.
        // Try WSL discovery FIRST before falling back to Windows LS.
        if (process.platform === 'win32' && workspaceUri) {
            const wslDistro = extractWslDistro(workspaceUri);
            if (wslDistro) {
                console.log(`[ContextMonitor] Attempting WSL LS discovery in distro "${wslDistro}"`);
                const wslResult = await discoverWslLanguageServer(wslDistro, workspaceUri, signal);
                if (wslResult) {
                    console.log(`[ContextMonitor] Found WSL LS: port=${wslResult.port}, pid=${wslResult.pid}`);
                    return wslResult;
                }
                console.log('[ContextMonitor] WSL LS not found, falling back to Windows LS');
            }
        }

        let pid: number | null = null;
        let csrfToken: string | null = null;

        if (process.platform === 'win32' || isWSL()) {
            // ─── Windows: wmic.exe (preferred) or Get-CimInstance (fallback) ───
            // Uses cached wmic availability to skip missing wmic on subsequent polls.
            let wmicOutput: string;
            try {
                wmicOutput = await discoverWindowsProcesses(signal);
            } catch {
                return null;
            }

            // Parse wmic CSV or PowerShell CSV output
            // Both contain lines with CommandLine and ProcessId fields
            const lines = wmicOutput.split('\n').filter(l =>
                l.includes('language_server_windows') && l.includes('antigravity')
            );

            if (lines.length === 0) {
                return null;
            }

            // Find the line matching our workspace
            let targetLine = lines[0];
            if (workspaceUri) {
                const expectedWorkspaceId = buildExpectedWorkspaceId(workspaceUri);
                const matchedLine = lines.find(line => {
                    const wsId = extractWorkspaceId(line);
                    return wsId === expectedWorkspaceId;
                });
                if (matchedLine) {
                    targetLine = matchedLine;
                }
            }

            // Extract CSRF token from the command line string
            csrfToken = extractCsrfToken(targetLine);
            if (!csrfToken) {
                return null;
            }

            // Extract PID: in wmic CSV, ProcessId is the last field on the line
            const pidMatch = targetLine.match(/(\d+)\s*$/);
            if (pidMatch) {
                pid = parseInt(pidMatch[1], 10);
            }
            // Also try the standard ps-style PID extraction (for PowerShell CSV)
            if (!pid) {
                // PowerShell CSV: "ProcessId","CommandLine" or similar column order
                // Try extracting any standalone number that looks like a PID
                const allNumbers = targetLine.match(/(?:^|,|")(\d{2,})(?:"|,|$)/g);
                if (allNumbers) {
                    for (const m of allNumbers) {
                        const n = parseInt(m.replace(/[",]/g, ''), 10);
                        // A reasonable PID range
                        if (n > 0 && n < 1000000) {
                            pid = n;
                            break;
                        }
                    }
                }
            }
            if (!pid) {
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
            } catch {
                return null;
            }

            const lines = filterLsProcessLines(psOutput);

            if (lines.length === 0) {
                return null;
            }

            let targetLine = lines[0]; // fallback to first if no specific match

            if (workspaceUri) {
                // Antigravity replaces ':///' with '_' and '/' with '_' for the workspace_id arg
                // e.g. file:///Users/foo/bar -> file_Users_foo_bar
                const expectedWorkspaceId = buildExpectedWorkspaceId(workspaceUri);

                // Look for the specific process serving this workspace
                const matchedLine = lines.find(line => {
                    const wsId = extractWorkspaceId(line);
                    return wsId === expectedWorkspaceId;
                });

                if (matchedLine) {
                    targetLine = matchedLine;
                }
            }

            const firstLine = targetLine.trim();

            // Extract PID (first number)
            pid = extractPid(firstLine);
            if (!pid) {
                return null;
            }

            // Extract CSRF token
            csrfToken = extractCsrfToken(firstLine);
            if (!csrfToken) {
                return null;
            }
        }

        // 2. Find listening ports
        // Cross-platform: netstat (Windows), lsof (macOS + Linux), ss fallback (Linux)
        const ports = await findListeningPorts(pid, signal);

        if (ports.length === 0) {
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

        return null;
    } catch {
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

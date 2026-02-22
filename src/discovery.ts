import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';

const execFileAsync = promisify(execFile);

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
    return workspaceUri.replace(':///', '_').replace(/\//g, '_');
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
 */
export function filterLsProcessLines(psOutput: string): string[] {
    return psOutput.split('\n').filter(l =>
        l.includes('language_server_macos') && l.includes('antigravity')
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
 * Discover the Antigravity language server process that belongs to this workspace.
 * Extracts PID, CSRF token from process args, and finds the listening port.
 *
 * S2 fix: Uses async execFile instead of execSync to avoid blocking the VS Code UI thread.
 * S3 fix: Uses execFile (no shell) to prevent command injection risks.
 * CR-#3: Accepts AbortSignal for cancellation on extension deactivate.
 */
export async function discoverLanguageServer(workspaceUri?: string, signal?: AbortSignal): Promise<LSInfo | null> {
    try {
        // 1. Find all LS processes
        // S2/S3: async execFile — does not block the Extension Host event loop,
        // and does not spawn a shell (no command injection risk).
        // We use `ps -ax -o pid=,command=` to list all processes, then filter in JS
        // instead of piping through grep (execFile does not support shell pipes).
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
        const pid = extractPid(firstLine);
        if (!pid) {
            return null;
        }

        // Extract CSRF token
        const csrfToken = extractCsrfToken(firstLine);
        if (!csrfToken) {
            return null;
        }

        // 2. Find listening ports
        // S2/S3: async execFile with argument array — no shell, no injection risk.
        let lsofOutput: string;
        try {
            const result = await execFileAsync('lsof', [
                '-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)
            ], { encoding: 'utf-8', timeout: 5000, signal });
            lsofOutput = result.stdout.trim();
        } catch {
            return null;
        }

        if (!lsofOutput) {
            return null;
        }

        // Parse ports from lsof output
        const ports: number[] = [];
        for (const line of lsofOutput.split('\n')) {
            const port = extractPort(line);
            if (port !== null) {
                ports.push(port);
            }
        }

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

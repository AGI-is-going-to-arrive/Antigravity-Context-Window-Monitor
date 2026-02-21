import { execSync } from 'child_process';
import * as https from 'https';
import * as http from 'http';

export interface LSInfo {
    pid: number;
    csrfToken: string;
    port: number;
    useTls: boolean;
}

/**
 * Discover the Antigravity language server process that belongs to this workspace.
 * Extracts PID, CSRF token from process args, and finds the listening port.
 */
export async function discoverLanguageServer(workspaceUri?: string): Promise<LSInfo | null> {
    try {
        // 1. Find all LS processes
        const psOutput = execSync(
            `ps -ax -o pid=,command= | grep 'language_server_macos.*antigravity' | grep -v grep`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        if (!psOutput) {
            return null;
        }

        const lines = psOutput.split('\n').filter(l => l.trim() !== '');
        let targetLine = lines[0]; // fallback to first if no specific match

        if (workspaceUri) {
            // Antigravity replaces ':///' with '_' and '/' with '_' for the workspace_id arg
            // e.g. file:///Users/foo/bar -> file_Users_foo_bar
            const expectedWorkspaceId = workspaceUri.replace(':///', '_').replace(/\//g, '_');

            // Look for the specific process serving this workspace
            const matchedLine = lines.find(line => {
                const match = line.match(/--workspace_id\s+([^\s]+)/);
                return match && match[1] === expectedWorkspaceId;
            });

            if (matchedLine) {
                targetLine = matchedLine;
            }
        }

        const firstLine = targetLine.trim();

        // Extract PID (first number)
        const pidMatch = firstLine.match(/^\s*(\d+)\s/);
        if (!pidMatch) {
            return null;
        }
        const pid = parseInt(pidMatch[1], 10);

        // Extract CSRF token
        const csrfMatch = firstLine.match(/--csrf_token\s+([^\s]+)/);
        if (!csrfMatch) {
            return null;
        }
        const csrfToken = csrfMatch[1];

        // 2. Find listening ports
        const lsofOutput = execSync(
            `lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        if (!lsofOutput) {
            return null;
        }

        // Parse ports from lsof output
        const ports: number[] = [];
        for (const line of lsofOutput.split('\n')) {
            const portMatch = line.match(/127\.0\.0\.1:(\d+)\s/);
            if (portMatch) {
                ports.push(parseInt(portMatch[1], 10));
            }
        }

        if (ports.length === 0) {
            return null;
        }

        // 3. Probe each port to find the Connect-RPC endpoint
        for (const port of ports) {
            // Try HTTPS first (LS typically uses self-signed cert)
            const httpsResult = await probePort(port, csrfToken, true);
            if (httpsResult) {
                return { pid, csrfToken, port, useTls: true };
            }

            // Fallback to HTTP
            const httpResult = await probePort(port, csrfToken, false);
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
 */
async function probePort(port: number, csrfToken: string, useTls: boolean): Promise<boolean> {
    return new Promise((resolve) => {
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

        const transport = useTls ? https : http;
        const req = transport.request(options, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer | string) => { body += chunk; });
            res.on('end', () => {
                try {
                    JSON.parse(body);
                    // Any valid JSON response indicates a working RPC endpoint
                    resolve(true);
                } catch {
                    resolve(false);
                }
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(postData);
        req.end();
    });
}

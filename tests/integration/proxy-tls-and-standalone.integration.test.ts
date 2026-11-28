import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    defaultHttpsTransport,
    establishHttpConnectTunnel,
    fetchAllowedHttps,
    isHostBypassedByNoProxy,
    resolveHttpsProxyUrl,
} from '../../src/app/plugin-updater';
import { createTempDirTracker } from '../helpers/factories';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');
const MAIN_MJS_PATH = path.join(REPO_ROOT, 'app-plugin', 'sidecars', 'context_monitor', 'main.mjs');

interface TestTlsPki {
    caPem: string;
    validKeyPem: string;
    validCertPem: string;
    wrongHostKeyPem: string;
    wrongHostCertPem: string;
}

function generateTestPki(dir: string): TestTlsPki {
    const caKey = path.join(dir, 'ca.key');
    const caCert = path.join(dir, 'ca.crt');
    const caExt = path.join(dir, 'ca.ext');
    fs.writeFileSync(caExt, [
        'basicConstraints=critical,CA:TRUE',
        'keyUsage=critical,keyCertSign,cRLSign',
        'subjectKeyIdentifier=hash',
    ].join('\n'));
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', caKey, '-out', caCert, '-days', '2',
        '-subj', '/CN=ACM-Test-Root-CA',
        '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ], { stdio: 'pipe' });

    const issueLeaf = (prefix: string, cn: string, san: string) => {
        const keyPath = path.join(dir, `${prefix}.key`);
        const csrPath = path.join(dir, `${prefix}.csr`);
        const certPath = path.join(dir, `${prefix}.crt`);
        const extPath = path.join(dir, `${prefix}.ext`);
        fs.writeFileSync(extPath, [
            'basicConstraints=CA:FALSE',
            'keyUsage=digitalSignature,keyEncipherment',
            'extendedKeyUsage=serverAuth',
            `subjectAltName=${san}`,
        ].join('\n'));
        execFileSync('openssl', [
            'req', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', keyPath, '-out', csrPath,
            '-subj', `/CN=${cn}`,
        ], { stdio: 'pipe' });
        execFileSync('openssl', [
            'x509', '-req', '-in', csrPath,
            '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
            '-out', certPath, '-days', '2',
            '-extfile', extPath,
        ], { stdio: 'pipe' });
        return {
            keyPem: fs.readFileSync(keyPath, 'utf8'),
            certPem: fs.readFileSync(certPath, 'utf8'),
        };
    };

    const validLeaf = issueLeaf(
        'github-valid',
        'github.com',
        'DNS:github.com,DNS:api.github.com,DNS:objects.githubusercontent.com,DNS:release-assets.githubusercontent.com,IP:127.0.0.1',
    );
    const wrongLeaf = issueLeaf('wrong-host', 'evil.example.com', 'DNS:evil.example.com');

    return {
        caPem: fs.readFileSync(caCert, 'utf8'),
        validKeyPem: validLeaf.keyPem,
        validCertPem: validLeaf.certPem,
        wrongHostKeyPem: wrongLeaf.keyPem,
        wrongHostCertPem: wrongLeaf.certPem,
    };
}

function cleanSidecarEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    delete env.ANTIGRAVITY_SIDECAR_WEB_PORT;
    delete env.ANTIGRAVITY_LS_ADDRESS;
    delete env.ANTIGRAVITY_CSRF_TOKEN;
    return env;
}

describe('Real-System Integration: Local HTTP CONNECT Proxy TLS & Standalone Live Auth Pairing', () => {
    const tracker = createTempDirTracker('acm-int-tls-');
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = tracker.make();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        tracker.cleanup();
    });

    it('W1A-FIX-6: tunnels HTTPS requests & redirects over HTTP CONNECT with intact TLS CA/hostname verification and respects NO_PROXY', async () => {
        const installer = await import(INSTALLER_PATH);
        const pki = generateTestPki(tempRoot);

        const validTlsServer = https.createServer({
            key: pki.validKeyPem,
            cert: pki.validCertPem,
        }, (req, res) => {
            if (req.url === '/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/pkg.zip') {
                res.writeHead(302, {
                    Location: 'https://objects.githubusercontent.com/dl/v1.18.0/pkg.zip',
                });
                res.end();
                return;
            }
            if (req.url === '/dl/v1.18.0/pkg.zip') {
                res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                res.end(Buffer.from('TUNNELED-LOCAL-TLS-SENTINEL-PAYLOAD', 'utf8'));
                return;
            }
            if (req.url === '/direct-no-proxy') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(Buffer.from('DIRECT-NO-PROXY-TLS-OK', 'utf8'));
                return;
            }
            res.writeHead(404);
            res.end('not found');
        });

        const wrongHostTlsServer = https.createServer({
            key: pki.wrongHostKeyPem,
            cert: pki.wrongHostCertPem,
        }, (_req, res) => {
            res.writeHead(200);
            res.end('SHOULD-NEVER-PASS-HOSTNAME-CHECK');
        });

        await new Promise<void>((r) => validTlsServer.listen(0, '127.0.0.1', r));
        await new Promise<void>((r) => wrongHostTlsServer.listen(0, '127.0.0.1', r));
        const validPort = (validTlsServer.address() as net.AddressInfo).port;
        const wrongHostPort = (wrongHostTlsServer.address() as net.AddressInfo).port;

        const connectLog: Array<{ authority: string; auth?: string | string[] }> = [];
        const activeSockets = new Set<net.Socket>();
        const proxyServer = http.createServer((_req, res) => {
            res.writeHead(405);
            res.end();
        });
        proxyServer.on('connect', (req, clientSocket, head) => {
            const authority = String(req.url || '');
            connectLog.push({ authority, auth: req.headers['proxy-authorization'] });
            activeSockets.add(clientSocket);
            clientSocket.once('close', () => activeSockets.delete(clientSocket));

            const targetPort = authority.startsWith('api.github.com:') ? wrongHostPort : validPort;
            const upstream = net.connect(targetPort, '127.0.0.1', () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head && head.length > 0) {
                    upstream.write(head);
                }
                upstream.pipe(clientSocket);
                clientSocket.pipe(upstream);
            });
            activeSockets.add(upstream);
            upstream.once('close', () => activeSockets.delete(upstream));
            upstream.on('error', () => clientSocket.destroy());
            clientSocket.on('error', () => upstream.destroy());
        });
        await new Promise<void>((r) => proxyServer.listen(0, '127.0.0.1', r));
        const proxyPort = (proxyServer.address() as net.AddressInfo).port;
        const proxyEnv: NodeJS.ProcessEnv = {
            HTTPS_PROXY: `http://bob:p4ssw0rd@127.0.0.1:${proxyPort}`,
        };
        const expectedAuth = `Basic ${Buffer.from('bob:p4ssw0rd', 'utf8').toString('base64')}`;

        try {
            const startUrl = 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/pkg.zip';

            // 1A. plugin-updater.ts traverses CONNECT tunnel on BOTH initial hop & 302 redirect hop with CA verification
            connectLog.length = 0;
            const updaterRes = await fetchAllowedHttps(startUrl, {
                env: proxyEnv,
                ca: pki.caPem,
                timeoutMs: 5_000,
            });
            expect(updaterRes.statusCode).toBe(200);
            expect(updaterRes.body.toString('utf8')).toBe('TUNNELED-LOCAL-TLS-SENTINEL-PAYLOAD');
            expect(updaterRes.finalUrl).toBe('https://objects.githubusercontent.com/dl/v1.18.0/pkg.zip');
            expect(connectLog).toEqual([
                { authority: 'github.com:443', auth: expectedAuth },
                { authority: 'objects.githubusercontent.com:443', auth: expectedAuth },
            ]);

            // 1B. scripts/install-app-plugin.mjs traverses CONNECT tunnel on BOTH hops with CA verification
            connectLog.length = 0;
            const installerRes = await installer.fetchBufferWithAllowlist(startUrl, {
                env: proxyEnv,
                ca: pki.caPem,
                timeoutMs: 5_000,
            });
            expect(installerRes.statusCode).toBe(200);
            expect(installerRes.buffer.toString('utf8')).toBe('TUNNELED-LOCAL-TLS-SENTINEL-PAYLOAD');
            expect(installerRes.url).toBe('https://objects.githubusercontent.com/dl/v1.18.0/pkg.zip');
            expect(connectLog).toEqual([
                { authority: 'github.com:443', auth: expectedAuth },
                { authority: 'objects.githubusercontent.com:443', auth: expectedAuth },
            ]);

            // 2. Untrusted CA fails TLS verification inside CONNECT tunnel
            await expect(fetchAllowedHttps(startUrl, {
                env: proxyEnv,
                timeoutMs: 5_000,
            })).rejects.toThrow(/self-signed|unable to verify|certificate/i);

            await expect(installer.fetchBufferWithAllowlist(startUrl, {
                env: proxyEnv,
                timeoutMs: 5_000,
            })).rejects.toThrow(/self-signed|unable to verify|certificate/i);

            // 3. Valid CA but mismatched certificate hostname fails SNI/hostname check
            await expect(fetchAllowedHttps('https://api.github.com/repos/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/latest', {
                env: proxyEnv,
                ca: pki.caPem,
                timeoutMs: 5_000,
            })).rejects.toThrow(/altname|hostname|does not match/i);

            await expect(installer.fetchBufferWithAllowlist('https://api.github.com/repos/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/latest', {
                env: proxyEnv,
                ca: pki.caPem,
                timeoutMs: 5_000,
            })).rejects.toThrow(/altname|hostname|does not match/i);

            // 4. NO_PROXY port-aware bypass talks directly over loopback TLS without proxy CONNECT
            const apiUrl = new URL('https://api.github.com/test');
            expect(resolveHttpsProxyUrl(apiUrl, { ...proxyEnv, NO_PROXY: 'api.github.com:8443' })?.port).toBe(String(proxyPort));
            expect(resolveHttpsProxyUrl(apiUrl, { ...proxyEnv, NO_PROXY: 'api.github.com:443' })).toBeNull();
            expect(installer.resolveInstallerProxyUrl(apiUrl, { ...proxyEnv, NO_PROXY: 'api.github.com:8443' })?.port).toBe(String(proxyPort));
            expect(installer.resolveInstallerProxyUrl(apiUrl, { ...proxyEnv, NO_PROXY: 'api.github.com:443' })).toBeNull();

            connectLog.length = 0;
            const directUrl = new URL(`https://127.0.0.1:${validPort}/direct-no-proxy`);
            const noProxyEnv: NodeJS.ProcessEnv = { ...proxyEnv, NO_PROXY: '127.0.0.1' };
            const directUpdaterRes = await defaultHttpsTransport(directUrl, {
                headers: {},
                timeoutMs: 5_000,
                maxBytes: 1024,
                env: noProxyEnv,
                ca: pki.caPem,
            });
            expect(directUpdaterRes.statusCode).toBe(200);
            expect(directUpdaterRes.body.toString('utf8')).toBe('DIRECT-NO-PROXY-TLS-OK');
            expect(connectLog).toHaveLength(0);

            const directInstallerRes = await installer.defaultHttpsGet(directUrl, {}, 5_000, 1024, {
                env: noProxyEnv,
                ca: pki.caPem,
            });
            expect(directInstallerRes.statusCode).toBe(200);
            expect(directInstallerRes.buffer.toString('utf8')).toBe('DIRECT-NO-PROXY-TLS-OK');
            expect(connectLog).toHaveLength(0);
        } finally {
            for (const s of activeSockets) { s.destroy(); }
            proxyServer.closeAllConnections?.();
            validTlsServer.closeAllConnections?.();
            wrongHostTlsServer.closeAllConnections?.();
            await Promise.all([
                new Promise<void>((r) => proxyServer.close(() => r())),
                new Promise<void>((r) => validTlsServer.close(() => r())),
                new Promise<void>((r) => wrongHostTlsServer.close(() => r())),
            ]);
        }
    }, 20_000);

    it('resolves HTTPS_PROXY / ALL_PROXY / NO_PROXY and establishes an HTTP CONNECT tunnel with Proxy-Authorization', async () => {
        const target = new URL('https://api.github.com/repos/a/b/releases/latest');
        expect(resolveHttpsProxyUrl(target, { HTTPS_PROXY: 'http://127.0.0.1:8080' })?.toString())
            .toBe('http://127.0.0.1:8080/');
        expect(resolveHttpsProxyUrl(target, { ALL_PROXY: 'http://proxy.corp:3128' })?.toString())
            .toBe('http://proxy.corp:3128/');
        expect(resolveHttpsProxyUrl(target, {
            HTTPS_PROXY: 'http://127.0.0.1:8080',
            NO_PROXY: 'localhost,.github.com',
        })).toBeNull();
        expect(isHostBypassedByNoProxy('api.github.com', '443', 'github.com')).toBe(true);
        expect(isHostBypassedByNoProxy('api.github.com', '443', 'example.com')).toBe(false);

        const observed: Array<{ url?: string; proxyAuth?: string | string[] }> = [];
        const openSockets = new Set<net.Socket>();
        const proxyServer = http.createServer();
        proxyServer.on('connect', (req, clientSocket) => {
            openSockets.add(clientSocket);
            clientSocket.once('close', () => openSockets.delete(clientSocket));
            observed.push({ url: req.url, proxyAuth: req.headers['proxy-authorization'] });
            if (req.url === 'reject.github.com:443') {
                clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
                return;
            }
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            clientSocket.once('data', (chunk) => {
                clientSocket.end(Buffer.concat([Buffer.from('TUNNELED:'), chunk]));
            });
        });

        await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
        const proxyPort = (proxyServer.address() as net.AddressInfo).port;
        try {
            const proxyUrl = new URL(`http://alice:s3cr3t@127.0.0.1:${proxyPort}`);
            const tunnelSock = await establishHttpConnectTunnel(proxyUrl, 'api.github.com', 443, 5_000);
            try {
                const echo = await new Promise<string>((resolve, reject) => {
                    tunnelSock.once('error', reject);
                    tunnelSock.once('data', (d) => resolve(d.toString('utf8')));
                    tunnelSock.write('HELLO');
                });
                expect(echo).toBe('TUNNELED:HELLO');
            } finally {
                tunnelSock.destroy();
            }

            expect(observed[0]).toEqual({
                url: 'api.github.com:443',
                proxyAuth: `Basic ${Buffer.from('alice:s3cr3t').toString('base64')}`,
            });

            await expect(establishHttpConnectTunnel(proxyUrl, 'reject.github.com', 443, 5_000))
                .rejects.toThrow(/HTTP 407/);
        } finally {
            for (const s of openSockets) { s.destroy(); }
            proxyServer.closeAllConnections?.();
            await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
        }
    });

    it('SEC-02: refuses to silently bind port 17835 when sidecar_sdk env vars are missing and exits non-zero with usage', () => {
        let exitCode = 0;
        let stderr = '';
        try {
            execFileSync(process.execPath, [MAIN_MJS_PATH], {
                env: cleanSidecarEnv(),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5_000,
            });
        } catch (err: unknown) {
            const e = err as { status?: number; stderr?: string };
            exitCode = e.status ?? 1;
            stderr = String(e.stderr ?? '');
        }
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('--standalone-port');
        expect(stderr).not.toContain('17835');

        let invalidCode = 0;
        try {
            execFileSync(process.execPath, [MAIN_MJS_PATH, '--standalone-port=99999'], {
                env: cleanSidecarEnv(),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5_000,
            });
        } catch (err: unknown) {
            invalidCode = (err as { status?: number }).status ?? 1;
        }
        expect(invalidCode).not.toBe(0);
    });

    it('SEC-02: never prints long-lived bearer/API credentials to stdout or stderr and enforces live HTTP one-time pairing from private 0600 --pairing-file', async () => {
        const launchOnce = async (
            extraArgs: string[],
            onRunning?: (ctx: { url: string; pairingPath: string | null; pairingPayload?: Record<string, unknown> }) => Promise<void>,
        ): Promise<{ url: string; stdout: string; stderr: string; pairingPayload?: Record<string, unknown>; pairingMode?: number }> => {
            const statePath = path.join(tempRoot, `state-${Math.random().toString(16).slice(2)}.json`);
            const pairingArg = extraArgs.find((a) => a.startsWith('--pairing-file='));
            const pairingPath = pairingArg ? pairingArg.slice('--pairing-file='.length) : null;
            const child = spawn(process.execPath, [MAIN_MJS_PATH, '--standalone-port=0', ...extraArgs], {
                env: cleanSidecarEnv({
                    ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: statePath,
                    ANTIGRAVITY_BRAIN_DIR: path.join(tempRoot, 'empty-brain'),
                }),
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            try {
                let stdout = '';
                let stderr = '';
                const url = await new Promise<string>((resolveUrl, rejectUrl) => {
                    const timer = setTimeout(() => {
                        rejectUrl(new Error(`Timed out waiting for standalone output.\nstdout=${stdout}\nstderr=${stderr}`));
                    }, 8_000);
                    const check = () => {
                        const urlMatch = stdout.match(/(http:\/\/127\.0\.0\.1:\d+)/);
                        if (urlMatch && stdout.includes('\n')) {
                            clearTimeout(timer);
                            resolveUrl(urlMatch[1]);
                        }
                    };
                    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); check(); });
                    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
                    child.once('exit', (code) => {
                        clearTimeout(timer);
                        rejectUrl(new Error(`Exited early (${code}): stdout=${stdout} stderr=${stderr}`));
                    });
                });
                await new Promise((r) => setTimeout(r, 100));
                let pairingPayload: Record<string, unknown> | undefined;
                let pairingMode: number | undefined;
                if (pairingPath && fs.existsSync(pairingPath)) {
                    pairingPayload = JSON.parse(fs.readFileSync(pairingPath, 'utf8'));
                    pairingMode = fs.statSync(pairingPath).mode & 0o777;
                }
                if (onRunning) {
                    await onRunning({ url, pairingPath, pairingPayload });
                }
                return { url, stdout, stderr, pairingPayload, pairingMode };
            } finally {
                child.kill('SIGTERM');
                await new Promise<void>((resolveExit) => {
                    const t = setTimeout(resolveExit, 2_000);
                    child.once('exit', () => { clearTimeout(t); resolveExit(); });
                });
            }
        };

        const assertNoLeakedCredentials = (label: string, res: { url: string; stdout: string; stderr: string }) => {
            const combined = `${res.stdout}\n${res.stderr}`;
            expect(res.url, `${label} loopback URL`).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
            expect(combined, `${label} must not print X-Monitor-Token`).not.toContain('X-Monitor-Token');
            expect(combined, `${label} must not print sessionToken`).not.toContain('sessionToken');
            expect(combined, `${label} must not print standaloneToken`).not.toContain('standaloneToken');
            expect(combined, `${label} must not print overlayBridgeToken`).not.toContain('overlayBridgeToken');
            expect(combined, `${label} must not print Bearer credentials`).not.toMatch(/\bBearer\s+\S+/i);
            expect(combined, `${label} must not print any 256-bit hex secret`).not.toMatch(/[a-f0-9]{64}/i);
        };

        // 1. Default standalone output
        const defaultRun = await launchOnce([]);
        assertNoLeakedCredentials('default', defaultRun);
        expect(defaultRun.stdout.trim()).toBe(`[context_monitor] standalone listening on ${defaultRun.url}`);

        // 2. --print-url output
        const printUrlRun = await launchOnce(['--print-url']);
        assertNoLeakedCredentials('--print-url', printUrlRun);
        expect(printUrlRun.stdout).toBe(`${printUrlRun.url}\n`);
        expect(printUrlRun.stderr.trim()).toBe('');

        // 3. Private one-time --pairing-file contract + LIVE HTTP pairing & burn enforcement
        const pairing1Path = path.join(tempRoot, 'pair-1.json');
        const pairing2Path = path.join(tempRoot, 'pair-2.json');
        const paired1 = await launchOnce(['--print-url', `--pairing-file=${pairing1Path}`], async ({ url, pairingPath, pairingPayload }) => {
            const code = String(pairingPayload?.pairingCode || '');
            expect(code).toMatch(/^[a-f0-9]{64}$/);

            const shellRes = await fetch(`${url}/`);
            expect(shellRes.status).toBe(200);
            const shellHtml = await shellRes.text();
            expect(shellHtml).toContain('data-acm-paired="false"');
            expect(shellHtml).not.toContain(code);

            const unauthSnap = await fetch(`${url}/api/snapshot`);
            expect(unauthSnap.status).toBe(401);

            const pairRes = await fetch(`${url}/api/auth/pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: url },
                body: JSON.stringify({ pairingCode: code }),
            });
            expect(pairRes.status).toBe(200);
            const pairJson = await pairRes.json() as { ok: boolean; paired: boolean; sessionToken?: string };
            expect(pairJson.ok).toBe(true);
            expect(pairJson.paired).toBe(true);
            expect(String(pairJson.sessionToken || '')).toMatch(/^[a-f0-9]{64}$/);
            expect(pairRes.headers.has('set-cookie')).toBe(false);

            if (pairingPath) {
                expect(fs.existsSync(pairingPath)).toBe(false);
            }
            const replayRes = await fetch(`${url}/api/auth/pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: url },
                body: JSON.stringify({ pairingCode: code }),
            });
            expect(replayRes.status).toBe(401);

            const authSnap1 = await fetch(`${url}/api/snapshot`, {
                headers: { Authorization: `Bearer ${pairJson.sessionToken}` },
            });
            expect(authSnap1.status).toBe(200);
            const etag = authSnap1.headers.get('etag');
            expect(etag).toBeTruthy();

            const authSnap304 = await fetch(`${url}/api/snapshot`, {
                headers: {
                    Authorization: `Bearer ${pairJson.sessionToken}`,
                    'If-None-Match': etag!,
                },
            });
            expect(authSnap304.status).toBe(304);
            expect(await authSnap304.text()).toBe('');
        });
        const paired2 = await launchOnce(['--print-url', `--pairing-file=${pairing2Path}`]);
        assertNoLeakedCredentials('--pairing-file #1', paired1);
        assertNoLeakedCredentials('--pairing-file #2', paired2);
        expect(paired1.pairingPayload).toMatchObject({
            url: paired1.url,
            exchangeEndpoint: '/api/auth/pair',
            singleUse: true,
        });
        expect(String(paired1.pairingPayload?.pairingCode)).toMatch(/^[a-f0-9]{64}$/);
        expect(String(paired2.pairingPayload?.pairingCode)).toMatch(/^[a-f0-9]{64}$/);
        expect(paired1.pairingPayload?.pairingCode).not.toBe(paired2.pairingPayload?.pairingCode);
        expect(paired1.pairingPayload).not.toHaveProperty('sessionToken');
        expect(paired1.pairingPayload).not.toHaveProperty('overlayBridgeToken');
        expect(paired1.stdout + paired1.stderr).not.toContain(String(paired1.pairingPayload?.pairingCode));
        if (process.platform !== 'win32') {
            expect(paired1.pairingMode).toBe(0o600);
        }
        expect(fs.existsSync(pairing1Path)).toBe(false);
        expect(fs.existsSync(pairing2Path)).toBe(false);

        // A user-supplied path can be an unrelated existing file.
        const existingPair = path.join(tempRoot, 'existing.json');
        fs.writeFileSync(existingPair, 'existing content');
        expect(() => execFileSync(process.execPath, [MAIN_MJS_PATH, '--standalone-port=0', `--pairing-file=${existingPair}`], {
            env: cleanSidecarEnv({
                ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: path.join(tempRoot, 'state-existing.json'),
                ANTIGRAVITY_BRAIN_DIR: path.join(tempRoot, 'empty-brain'),
            }),
            stdio: 'pipe', timeout: 5000,
        })).toThrow();
        expect(fs.readFileSync(existingPair, 'utf8')).toBe('existing content');

        // 4. Refuses symlink target for --pairing-file
        const victimFile = path.join(tempRoot, 'victim.txt');
        fs.writeFileSync(victimFile, 'untouched', 'utf8');
        const symlinkPair = path.join(tempRoot, 'pair-symlink.json');
        fs.symlinkSync(victimFile, symlinkPair);
        let symCode = 0;
        try {
            execFileSync(process.execPath, [MAIN_MJS_PATH, '--standalone-port=0', `--pairing-file=${symlinkPair}`], {
                env: cleanSidecarEnv({
                    ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: path.join(tempRoot, 'state-sym.json'),
                    ANTIGRAVITY_BRAIN_DIR: path.join(tempRoot, 'empty-brain'),
                }),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5_000,
            });
        } catch (err: unknown) {
            symCode = (err as { status?: number }).status ?? 1;
        }
        expect(symCode).not.toBe(0);
        expect(fs.readFileSync(victimFile, 'utf8')).toBe('untouched');
    }, 20_000);
});

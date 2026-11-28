import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https';
import type { AddressInfo } from 'net';

function derLen(n: number): Buffer {
    if (n < 0x80) { return Buffer.from([n]); }
    const bytes: number[] = [];
    let v = n;
    while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derTag(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
function derSeq(...items: Buffer[]): Buffer { return derTag(0x30, Buffer.concat(items)); }
function derSet(...items: Buffer[]): Buffer { return derTag(0x31, Buffer.concat(items)); }
function derOid(bytes: number[]): Buffer { return derTag(0x06, Buffer.from(bytes)); }
function derInt(buf: Buffer): Buffer {
    return derTag(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
}
function derBitString(buf: Buffer): Buffer { return derTag(0x03, Buffer.concat([Buffer.from([0]), buf])); }

/** Generate an ephemeral self-signed P-256 cert in pure Node crypto (no openssl binary, no static key in repo). */
function createEphemeralTestTlsCreds(): { key: string; cert: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const ecdsaSha256 = derSeq(derOid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
    const cn = derSeq(derSet(derSeq(derOid([0x55, 0x04, 0x03]), derTag(0x0c, Buffer.from('127.0.0.1', 'utf8')))));
    const validity = derSeq(
        derTag(0x17, Buffer.from('200101000000Z', 'ascii')),
        derTag(0x17, Buffer.from('491231235959Z', 'ascii')),
    );
    const tbs = derSeq(derInt(Buffer.from([0x01])), ecdsaSha256, cn, validity, cn, spki);
    const signature = sign('sha256', tbs, privateKey);
    const certDer = derSeq(tbs, ecdsaSha256, derBitString(signature));
    const cert = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    const key = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    return { key, cert };
}

const TEST_TLS_CREDS = createEphemeralTestTlsCreds();

interface MockDaemonFile {
    content: string;
    mtimeMs?: number;
}

const commands = vi.hoisted(() => ({
    run: vi.fn<(file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>>(),
    wsl: false,
    daemonFiles: {} as Record<string, MockDaemonFile>,
}));

vi.mock('child_process', async () => {
    const { promisify } = await import('util');
    return { execFile: Object.assign(vi.fn(), { [promisify.custom]: commands.run }) };
});

vi.mock('fs', async importOriginal => {
    const fs = await importOriginal<typeof import('fs')>();
    const isDaemonDir = (p: unknown): boolean =>
        typeof p === 'string' && p.replace(/\\/g, '/').endsWith('/.gemini/antigravity/daemon');
    const daemonBasename = (p: unknown): string | null => {
        if (typeof p !== 'string') { return null; }
        const norm = p.replace(/\\/g, '/');
        const idx = norm.indexOf('/.gemini/antigravity/daemon/');
        return idx >= 0 ? norm.slice(idx + '/.gemini/antigravity/daemon/'.length) : null;
    };
    return {
        ...fs,
        existsSync: () => true,
        readdirSync: (...args: Parameters<typeof fs.readdirSync>) => {
            if (isDaemonDir(args[0])) {
                return Object.keys(commands.daemonFiles) as ReturnType<typeof fs.readdirSync>;
            }
            return fs.readdirSync(...args);
        },
        statSync: (...args: Parameters<typeof fs.statSync>) => {
            const name = daemonBasename(args[0]);
            if (name !== null) {
                const entry = commands.daemonFiles[name];
                if (!entry) { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
                return { mtimeMs: entry.mtimeMs ?? 1000 } as ReturnType<typeof fs.statSync>;
            }
            return fs.statSync(...args);
        },
        readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
            if (args[0] === '/proc/version') {
                return (commands.wsl ? 'Linux Microsoft WSL2' : 'Linux generic') as ReturnType<typeof fs.readFileSync>;
            }
            const name = daemonBasename(args[0]);
            if (name !== null) {
                const entry = commands.daemonFiles[name];
                if (!entry) { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
                return entry.content as ReturnType<typeof fs.readFileSync>;
            }
            return fs.readFileSync(...args);
        },
    };
});

import { discoverLanguageServer, resetPathDiagLog, resetWmicCache, resetWslCache } from '../src/discovery';
import { rpcCall } from '../src/rpc-client';

describe('hub discovery through real loopback HTTP and mocked OS process listings', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const servers: Array<Server | HttpsServer> = [];
    const received: Array<{ port: number; token: string | string[] | undefined; path: string | undefined }> = [];

    async function server(status = 200, body = '{}'): Promise<number> {
        return customServer((_req, res) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(body);
        });
    }

    async function customServer(
        handler: (req: IncomingMessage, res: ServerResponse) => void,
        host = '127.0.0.1',
    ): Promise<number> {
        const httpServer = createServer((req, res) => {
            received.push({ port: (httpServer.address() as AddressInfo).port, token: req.headers['x-codeium-csrf-token'], path: req.url });
            req.resume();
            handler(req, res);
        });
        servers.push(httpServer);
        await new Promise<void>((resolve, reject) => {
            httpServer.once('error', reject);
            httpServer.listen(0, host, resolve);
        });
        return (httpServer.address() as AddressInfo).port;
    }

    async function customTlsServer(
        handler: (req: IncomingMessage, res: ServerResponse) => void,
        host = '127.0.0.1',
    ): Promise<{ port: number; tlsErrors: string[] }> {
        const tlsErrors: string[] = [];
        const httpsServer = createHttpsServer(TEST_TLS_CREDS, (req, res) => {
            received.push({ port: (httpsServer.address() as AddressInfo).port, token: req.headers['x-codeium-csrf-token'], path: req.url });
            req.resume();
            handler(req, res);
        });
        httpsServer.on('tlsClientError', err => {
            tlsErrors.push((err as NodeJS.ErrnoException).code || err.message || 'tlsClientError');
        });
        servers.push(httpsServer);
        await new Promise<void>((resolve, reject) => {
            httpsServer.once('error', reject);
            httpsServer.listen(0, host, resolve);
        });
        return { port: (httpsServer.address() as AddressInfo).port, tlsErrors };
    }

    function platform(name: NodeJS.Platform): void {
        Object.defineProperty(process, 'platform', { value: name, configurable: true });
        resetWslCache();
    }

    function row(port: number, pid = 123, token = 'Mixed-Case-Token'): string {
        const cmd = `"C:\\Users\\测试 User\\.gemini\\bin\\agy.exe" --hub --hub-port=${port} --app_data_dir=antigravity --csrf_token=${token}`;
        return process.platform === 'win32'
            ? `"${pid}","${cmd.replace(/"/g, '""')}"`
            : `${pid} /home/测试 User/.gemini/bin/agy --hub --hub-port=${port} --app_data_dir=antigravity --csrf_token=${token}`;
    }

    beforeEach(() => {
        commands.run.mockReset();
        commands.wsl = false;
        commands.daemonFiles = {};
        received.length = 0;
        resetWslCache();
        resetWmicCache();
        resetPathDiagLog();
    });

    afterEach(async () => {
        Object.defineProperty(process, 'platform', originalPlatform);
        resetWslCache();
        await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve, reject) => {
            s.closeAllConnections();
            s.close(err => err ? reject(err) : resolve());
        })));
    });

    it.each(['darwin', 'linux', 'win32'] as const)('finds the hub on %s without socket tooling', async os => {
        platform(os);
        const port = await server();
        commands.run.mockResolvedValue({ stdout: row(port), stderr: '' });

        const found = await discoverLanguageServer('file:///test%20folder');

        expect(found).toEqual({ pid: 123, port, csrfToken: 'Mixed-Case-Token', useTls: false });
        expect(received).toEqual([{ port, token: 'Mixed-Case-Token', path: '/exa.language_server_pb.LanguageServerService/GetStatus' }]);
        expect(commands.run.mock.calls.length).toBeGreaterThanOrEqual(1);
        if (os === 'win32') {
            expect(commands.run.mock.calls[0][1].join(' ')).toContain("name like 'language_server%' or name = 'agy.exe'");
        } else {
            expect(commands.run.mock.calls[0].slice(0, 2)).toEqual(['ps', ['-axww', '-o', 'pid=,command=']]);
        }
    });

    it('uses UTF-8 PowerShell on Windows when WMIC is unavailable, then caches that decision', async () => {
        platform('win32');
        const port = await server();
        commands.run.mockImplementation(async (file, args) => {
            if (/WMIC\.exe$/i.test(file)) { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            expect(file).toMatch(/powershell\.exe$/i);
            const joined = args.join(' ');
            expect(joined).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;');
            expect(joined).toContain("Name like 'language_server%' or Name = 'agy.exe'");
            return { stdout: row(port), stderr: '' };
        });
        expect((await discoverLanguageServer())?.port).toBe(port);
        expect((await discoverLanguageServer())?.port).toBe(port);
        expect(commands.run.mock.calls.filter(([file]) => /WMIC\.exe$/i.test(file))).toHaveLength(1);
    });

    it('connects to agy v1.5.14 hubs where GetUnleashData returns 404 via GetStatus', async () => {
        platform('darwin');
        const port = await customServer((req, res) => {
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetStatus'
                && req.headers['x-codeium-csrf-token'] === 'Mixed-Case-Token') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{}');
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 page not found\n');
        });
        commands.run.mockResolvedValue({ stdout: row(port), stderr: '' });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 123, port, csrfToken: 'Mixed-Case-Token', useTls: false });
        expect(received.map(r => r.path)).toEqual(['/exa.language_server_pb.LanguageServerService/GetStatus']);
    });

    it('falls back from GetStatus 404 to GetUnleashData for legacy servers', async () => {
        platform('darwin');
        const port = await customServer((req, res) => {
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetUnleashData') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{}');
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 page not found\n');
        });
        commands.run.mockResolvedValue({ stdout: row(port), stderr: '' });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 123, port, csrfToken: 'Mixed-Case-Token', useTls: false });
        expect(received.map(r => r.path)).toEqual([
            '/exa.language_server_pb.LanguageServerService/GetStatus',
            '/exa.language_server_pb.LanguageServerService/GetUnleashData',
        ]);
    });

    it('falls back through 404 and 501 to GetUserStatus when both lightweight probes are absent', async () => {
        platform('darwin');
        const port = await customServer((req, res) => {
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetStatus') {
                res.writeHead(404);
                res.end('404 page not found');
                return;
            }
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetUnleashData') {
                res.writeHead(501, { 'Content-Type': 'application/json' });
                res.end('{"code":"unimplemented"}');
                return;
            }
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetUserStatus') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"userStatus":{}}');
                return;
            }
            res.writeHead(404);
            res.end();
        });
        commands.run.mockResolvedValue({ stdout: row(port), stderr: '' });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 123, port, csrfToken: 'Mixed-Case-Token', useTls: false });
        expect(received.map(r => r.path)).toEqual([
            '/exa.language_server_pb.LanguageServerService/GetStatus',
            '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        ]);
    });

    it.each([401, 403, 400, 500])('stops immediately on HTTP %i without probing fallback endpoints and never logs CSRF token', async status => {
        platform('darwin');
        const secret = 'SuperSecret-Csrf-Token-999';
        const port = await server(status, '{"code":"unauthenticated"}');
        const logs: string[] = [];
        commands.run.mockImplementation(async file => ({ stdout: file === 'ps' ? row(port, 123, secret) : '', stderr: '' }));

        expect(await discoverLanguageServer(undefined, undefined, m => logs.push(m))).toBeNull();
        // Should hit GetStatus only once on HTTP (TLS fails at handshake before reaching handler)
        expect(received.map(r => r.path)).toEqual(['/exa.language_server_pb.LanguageServerService/GetStatus']);
        expect(logs.some(m => m.includes(`HTTP ${status}`))).toBe(true);
        expect(logs.join('\n')).not.toContain(secret);
    });

    it('falls back from an unreachable preferred hub to the next process', async () => {
        platform('darwin');
        const stalePort = await server(404, '{}');
        const goodPort = await server();
        commands.run.mockImplementation(async file => ({
            stdout: file === 'ps' ? `${row(stalePort, 101)}\n${row(goodPort, 102)}` : '', stderr: '',
        }));
        expect(await discoverLanguageServer()).toEqual({ pid: 102, port: goodPort, csrfToken: 'Mixed-Case-Token', useTls: false });
        expect(commands.run.mock.calls.some(([file]) => file === 'lsof')).toBe(true);
    });

    it('discovers a hub via socket ownership when its port flag is invalid', async () => {
        platform('linux');
        const port = await server();
        commands.run.mockImplementation(async file => {
            if (file === 'ps') { return { stdout: row(99999), stderr: '' }; }
            if (file === 'lsof') { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            expect(file).toBe('ss');
            return { stdout: `LISTEN 0 4096 127.0.0.1:${port} 0.0.0.0:* users:(("agy",pid=123,fd=7))`, stderr: '' };
        });
        expect((await discoverLanguageServer())?.port).toBe(port);
        expect(received).toHaveLength(1);
    });

    it('falls back to /usr/sbin/lsof on macOS when lsof is missing from minimal PATH', async () => {
        platform('darwin');
        const port = await server();
        commands.run.mockImplementation(async file => {
            if (file === 'ps') { return { stdout: '12 /Applications/Antigravity/language_server_macos --csrf_token LegacyToken --antigravity', stderr: '' }; }
            if (file === 'lsof') { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            expect(file).toBe('/usr/sbin/lsof');
            return { stdout: `language 12 user 7u IPv4 TCP 127.0.0.1:${port} (LISTEN)`, stderr: '' };
        });
        expect(await discoverLanguageServer()).toEqual({ pid: 12, port, csrfToken: 'LegacyToken', useTls: false });
    });

    it('falls back to /usr/sbin/ss on Linux when both lsof and bare ss are missing from PATH', async () => {
        platform('linux');
        const port = await server();
        commands.run.mockImplementation(async file => {
            if (file === 'ps') { return { stdout: row(99999), stderr: '' }; }
            if (file === 'lsof' || file === 'ss') { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            expect(file).toBe('/usr/sbin/ss');
            return { stdout: `LISTEN 0 4096 127.0.0.1:${port} 0.0.0.0:* users:(("agy",pid=123,fd=7))`, stderr: '' };
        });
        expect((await discoverLanguageServer())?.port).toBe(port);
    });

    it('preserves the legacy server fallback when no hub is present', async () => {
        platform('darwin');
        const port = await server();
        commands.run.mockImplementation(async file => ({
            stdout: file === 'ps'
                ? '12 /Applications/Antigravity/language_server_macos --csrf_token LegacyToken --antigravity'
                : `language 12 user 7u IPv4 TCP 127.0.0.1:${port} (LISTEN)`,
            stderr: '',
        }));
        expect(await discoverLanguageServer()).toEqual({ pid: 12, port, csrfToken: 'LegacyToken', useTls: false });
    });

    it('finds the distro-local hub before Windows interop when the extension runs in WSL', async () => {
        platform('linux');
        commands.wsl = true;
        const port = await server();
        commands.run.mockResolvedValue({ stdout: row(port), stderr: '' });
        expect((await discoverLanguageServer())?.port).toBe(port);
        expect(commands.run.mock.calls[0][0]).toBe('ps');
        expect(commands.run.mock.calls.every(([file]) => !/wmic|powershell|netstat/i.test(file))).toBe(true);
    });

    it('finds an agy hub inside the selected Remote-WSL distro', async () => {
        platform('win32');
        const port = await server();
        commands.run.mockImplementation(async (file, args) => {
            expect(file).toMatch(/wsl\.exe$/);
            if (args.includes('ps')) {
                expect(args).toEqual(['-d', 'Ubuntu', '--', 'ps', '-axww', '-o', 'pid=,command=']);
                return { stdout: `123 /home/test/.gemini/bin/agy --hub --hub-port=${port} --csrf_token=Mixed-Case-Token --app_data_dir=antigravity`, stderr: '' };
            }
            return { stdout: `LISTEN 0 128 127.0.0.1:${port} 0.0.0.0:* users:(("agy",pid=123,fd=9))`, stderr: '' };
        });
        expect((await discoverLanguageServer('vscode-remote://wsl%2BUbuntu/home/test'))?.port).toBe(port);
        expect(commands.run).toHaveBeenCalledTimes(2);
    });

    it('matches ephemeral --hub-port=0 process with matching IDE hint without socket tooling', async () => {
        platform('darwin');
        const port = await server();
        commands.run.mockResolvedValue({
            stdout: '321 /Users/test/.gemini/bin/agy --hub --hub-port=0 --app_data_dir=antigravity --csrf_token=EphemeralTok',
            stderr: '',
        });
        const found = await discoverLanguageServer(undefined, undefined, undefined, { port, csrfToken: 'EphemeralTok' });
        expect(found).toEqual({ pid: 321, port, csrfToken: 'EphemeralTok', useTls: false });
        expect(commands.run.mock.calls[0][0]).toBe('ps');
    });

    it('does not execute discovery commands after cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await discoverLanguageServer(undefined, controller.signal)).toBeNull();
        expect(commands.run).not.toHaveBeenCalled();
        expect(received).toEqual([]);
    });

    it('settles an in-flight probe promptly when cancelled', async () => {
        platform('darwin');
        const controller = new AbortController();
        const hanging = createServer(req => { req.resume(); controller.abort(); });
        servers.push(hanging);
        await new Promise<void>(resolve => hanging.listen(0, '127.0.0.1', resolve));
        const port = (hanging.address() as AddressInfo).port;
        commands.run.mockResolvedValue({ stdout: row(port), stderr: '' });
        expect(await discoverLanguageServer(undefined, controller.signal)).toBeNull();
        expect(commands.run.mock.calls[0][0]).toBe('ps');
    });

    it('uses the current IDE hint instead of the first running hub', async () => {
        platform('darwin');
        const otherPort = await server();
        const currentPort = await server();
        commands.run.mockResolvedValue({ stdout: `${row(otherPort, 111, 'OtherToken')}\n${row(currentPort, 222, 'CurrentToken')}`, stderr: '' });
        expect(await discoverLanguageServer(undefined, undefined, undefined, { port: currentPort, csrfToken: 'CurrentToken' }))
            .toEqual({ pid: 222, port: currentPort, csrfToken: 'CurrentToken', useTls: false });
        expect(received.map(r => r.port)).toEqual([currentPort]);
    });

    it('does not attach to another IDE when the hinted port is owned by a different token', async () => {
        platform('darwin');
        const otherPort = await server();
        commands.run.mockResolvedValue({ stdout: row(otherPort, 111, 'OtherToken'), stderr: '' });
        expect(await discoverLanguageServer(undefined, undefined, undefined, { port: otherPort, csrfToken: 'CurrentToken' })).toBeNull();
        expect(received).toEqual([]);
    });

    it('uses daemon hub_<port>.json fallback with matching hint when Windows WMI/PowerShell fail', async () => {
        platform('win32');
        const port = await server();
        commands.run.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'EACCES' }));
        commands.daemonFiles[`hub_${port}.json`] = {
            content: JSON.stringify({ pid: 4567, httpPort: port, httpsPort: port + 1, lsVersion: '2.34.0', csrfToken: 'HintToken' }),
        };

        const found = await discoverLanguageServer(undefined, undefined, undefined, { port, csrfToken: 'HintToken' });
        expect(found).toEqual({ pid: 4567, port, csrfToken: 'HintToken', useTls: false });
    });

    it('does not double-probe a dead hinted port after matching daemon hub_<port>.json fails', async () => {
        platform('win32');
        const port = await server(401, '{"code":"unauthenticated"}');
        commands.run.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'EACCES' }));
        commands.daemonFiles[`hub_${port}.json`] = {
            content: JSON.stringify({ pid: 4567, httpPort: port, csrfToken: 'HintToken' }),
        };

        expect(await discoverLanguageServer(undefined, undefined, undefined, { port, csrfToken: 'HintToken' })).toBeNull();
        // Should probe HTTP once inside probeHubRecord and NOT re-probe HTTP again in direct fallback
        expect(received.filter(r => r.port === port)).toHaveLength(1);
    });

    it('falls back to direct hint probe when ps fails and daemon hub JSON is absent', async () => {
        platform('linux');
        const port = await server();
        commands.run.mockRejectedValue(Object.assign(new Error('hidepid'), { code: 'ENOENT' }));

        const found = await discoverLanguageServer(undefined, undefined, undefined, { port, csrfToken: 'DirectToken' });
        expect(found).toEqual({ pid: 0, port, csrfToken: 'DirectToken', useTls: false });
    });

    it('recovers real PID from argv when future agy omits --csrf_token from CLI args', async () => {
        platform('darwin');
        const port = await server();
        commands.run.mockResolvedValue({
            stdout: `777 /Users/test/.gemini/bin/agy --hub --hub-port=${port} --app_data_dir=antigravity`,
            stderr: '',
        });

        const found = await discoverLanguageServer(undefined, undefined, undefined, { port, csrfToken: 'HiddenToken' });
        expect(found).toEqual({ pid: 777, port, csrfToken: 'HiddenToken', useTls: false });
    });

    it('never uses an unrelated daemon hub file when an explicit hint is present', async () => {
        platform('darwin');
        const otherPort = await server();
        commands.run.mockResolvedValue({ stdout: '', stderr: '' });
        commands.daemonFiles[`hub_${otherPort}.json`] = {
            content: JSON.stringify({ pid: 888, httpPort: otherPort, csrfToken: 'OtherToken' }),
        };

        // Hint points at a closed/different port -> must NOT attach to otherPort!
        const closedPort = await server();
        const closedSrv = servers.pop()!;
        await new Promise<void>(resolve => closedSrv.close(() => resolve()));

        expect(await discoverLanguageServer(undefined, undefined, undefined, { port: closedPort, csrfToken: 'CurrentToken' })).toBeNull();
        expect(received.every(r => r.port !== otherPort)).toBe(true);
    });

    it('uses standalone daemon hub_*.json fallback ONLY when hint is undefined (newest mtime first)', async () => {
        platform('darwin');
        const olderPort = await server();
        const newerPort = await server();
        commands.run.mockResolvedValue({ stdout: '', stderr: '' });
        commands.daemonFiles[`hub_${olderPort}.json`] = {
            content: JSON.stringify({ pid: 500, httpPort: olderPort, csrfToken: 'OlderTok' }),
            mtimeMs: 1000,
        };
        commands.daemonFiles[`hub_${newerPort}.json`] = {
            content: JSON.stringify({ pid: 501, httpPort: newerPort, csrfToken: 'NewerTok' }),
            mtimeMs: 2000,
        };

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 501, port: newerPort, csrfToken: 'NewerTok', useTls: false });
    });

    it('connects to an IPv6-only [::1] loopback server and supports rpcCall over IPv6', async () => {
        platform('linux');
        let port: number;
        try {
            port = await customServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"ok":true}');
            }, '::1');
        } catch {
            // Skip cleanly on environments without IPv6 loopback enabled.
            return;
        }
        commands.run.mockImplementation(async file => {
            if (file === 'ps') { return { stdout: row(99999, 601, 'V6Token'), stderr: '' }; }
            if (file === 'lsof') { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            return { stdout: `LISTEN 0 128 [::1]:${port} [::]:* users:(("agy",pid=601,fd=9))`, stderr: '' };
        });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 601, port, csrfToken: 'V6Token', useTls: false, hostname: '::1' });
        const rpcRes = await rpcCall(found!, 'GetStatus', {});
        expect(rpcRes).toEqual({ ok: true });
    });

    it('rejects malformed IDE hints without running commands', async () => {
        expect(await discoverLanguageServer(undefined, undefined, undefined, { port: 99999, csrfToken: 'Token' })).toBeNull();
        expect(commands.run).not.toHaveBeenCalled();
    });

    it.each([[200, '<html>not RPC</html>'], [403, '{}'], [200, 'not JSON'], [200, 'null'], [200, '[]'], [200, 'true']] as const)('rejects invalid probe response %s %s', async (status, body) => {
        platform('darwin');
        const port = await server(status, body);
        commands.run.mockImplementation(async file => ({ stdout: file === 'ps' ? row(port) : '', stderr: '' }));
        expect(await discoverLanguageServer()).toBeNull();
    });

    it.each([
        '{}',
        JSON.stringify({ userStatus: null }),
        JSON.stringify({ userStatus: [] }),
        JSON.stringify({ userStatus: 'not-an-object' }),
        JSON.stringify({ error: 'soft-200-error' }),
    ])('rejects invalid GetUserStatus fallback body %s after GetStatus/GetUnleashData return 404/501', async body => {
        platform('darwin');
        const secret = 'Validate-UserStatus-Token-74';
        const logs: string[] = [];
        const port = await customServer((req, res) => {
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetStatus') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 page not found');
                return;
            }
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetUnleashData') {
                res.writeHead(501, { 'Content-Type': 'application/json' });
                res.end('{"code":"unimplemented"}');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(body);
        });
        commands.run.mockImplementation(async file => ({ stdout: file === 'ps' ? row(port, 123, secret) : '', stderr: '' }));

        expect(await discoverLanguageServer(undefined, undefined, msg => logs.push(msg))).toBeNull();
        expect(received.map(r => r.path)).toEqual([
            '/exa.language_server_pb.LanguageServerService/GetStatus',
            '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        ]);
        expect(logs.some(m => m.includes('invalid GetUserStatus body'))).toBe(true);
        expect(logs.join('\n')).not.toContain(secret);
    });

    it.each(['win32', 'darwin', 'linux'] as const)(
        'probes secondary TLS port before HTTP on %s after declared --hub-port fails (zero TLS handshake errors)',
        async os => {
            platform(os);
            const hubPort = await server(404, '404 page not found');
            const { port: tlsPort, tlsErrors } = await customTlsServer((req, res) => {
                if (req.url === '/exa.language_server_pb.LanguageServerService/GetStatus') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                    return;
                }
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 page not found');
            });

            commands.run.mockImplementation(async file => {
                if (os === 'win32') {
                    if (/WMIC\.exe$/i.test(file)) { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
                    if (/powershell\.exe$/i.test(file)) { return { stdout: row(hubPort, 6108), stderr: '' }; }
                    return {
                        stdout: [
                            `  TCP    127.0.0.1:${hubPort}        0.0.0.0:0              LISTENING       6108`,
                            `  TCP    127.0.0.1:${tlsPort}        0.0.0.0:0              LISTENING       6108`,
                        ].join('\n'),
                        stderr: '',
                    };
                }
                if (file === 'ps') { return { stdout: row(hubPort, 6108), stderr: '' }; }
                if (os === 'darwin' && file === 'lsof') {
                    return {
                        stdout: [
                            `agy 6108 user 10u IPv4 TCP 127.0.0.1:${tlsPort} (LISTEN)`,
                            `agy 6108 user 11u IPv4 TCP 127.0.0.1:${hubPort} (LISTEN)`,
                        ].join('\n'),
                        stderr: '',
                    };
                }
                if (os === 'linux' && file === 'lsof') {
                    throw Object.assign(new Error('not found'), { code: 'ENOENT' });
                }
                if (os === 'linux' && file === 'ss') {
                    return {
                        stdout: [
                            `LISTEN 0 4096 127.0.0.1:${tlsPort} 0.0.0.0:* users:(("agy",pid=6108,fd=10))`,
                            `LISTEN 0 4096 127.0.0.1:${hubPort} 0.0.0.0:* users:(("agy",pid=6108,fd=11))`,
                        ].join('\n'),
                        stderr: '',
                    };
                }
                return { stdout: '', stderr: '' };
            });

            const found = await discoverLanguageServer();
            expect(found).toEqual({ pid: 6108, port: tlsPort, csrfToken: 'Mixed-Case-Token', useTls: true });
            // Critical assertion: TLS was attempted FIRST, so zero plain HTTP traffic ever hit the HTTPS port.
            expect(tlsErrors).toEqual([]);
            expect(received.filter(r => r.port === tlsPort).map(r => r.path)).toEqual([
                '/exa.language_server_pb.LanguageServerService/GetStatus',
            ]);
        },
    );

    it('probes secondary TLS port before HTTP after ephemeral --hub-port=0 hint port fails', async () => {
        platform('darwin');
        const failedHintPort = await server(404, '404 page not found');
        const { port: tlsPort, tlsErrors } = await customTlsServer((req, res) => {
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetUserStatus') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ userStatus: { name: 'TLS User' } }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 page not found');
        });
        commands.run.mockImplementation(async file => {
            if (file === 'ps') {
                return {
                    stdout: '321 /Users/test/.gemini/bin/agy --hub --hub-port=0 --app_data_dir=antigravity --csrf_token=EphemeralTok',
                    stderr: '',
                };
            }
            return {
                stdout: `agy 321 user 10u IPv4 TCP 127.0.0.1:${tlsPort} (LISTEN)\nagy 321 user 11u IPv4 TCP 127.0.0.1:${failedHintPort} (LISTEN)`,
                stderr: '',
            };
        });

        const found = await discoverLanguageServer(undefined, undefined, undefined, { port: failedHintPort, csrfToken: 'EphemeralTok' });
        expect(found).toEqual({ pid: 321, port: tlsPort, csrfToken: 'EphemeralTok', useTls: true });
        expect(tlsErrors).toEqual([]);
        expect(received.filter(r => r.port === tlsPort).map(r => r.path)).toEqual([
            '/exa.language_server_pb.LanguageServerService/GetStatus',
            '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        ]);
    });

    it('still falls back from TLS to plain HTTP on a secondary HTTP port after declared --hub-port fails', async () => {
        platform('win32');
        const hubPort = await server(404, '404 page not found');
        const secondaryHttpPort = await customServer((req, res) => {
            if (req.url === '/exa.language_server_pb.LanguageServerService/GetUserStatus') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ userStatus: { name: 'HTTP Secondary' } }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 page not found');
        });
        commands.run.mockImplementation(async file => {
            if (/WMIC\.exe$/i.test(file)) { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            if (/powershell\.exe$/i.test(file)) { return { stdout: row(hubPort, 6108), stderr: '' }; }
            return {
                stdout: [
                    `  TCP    127.0.0.1:${hubPort}        0.0.0.0:0              LISTENING       6108`,
                    `  TCP    127.0.0.1:${secondaryHttpPort}        0.0.0.0:0              LISTENING       6108`,
                ].join('\n'),
                stderr: '',
            };
        });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 6108, port: secondaryHttpPort, csrfToken: 'Mixed-Case-Token', useTls: false });
    });

    it('probes IPv6-only [::1] secondary TLS port before HTTP after declared --hub-port fails', async () => {
        platform('linux');
        const hubPort = await server(404, '404 page not found');
        let tlsPort: number;
        let tlsErrors: string[];
        try {
            ({ port: tlsPort, tlsErrors } = await customTlsServer((req, res) => {
                if (req.url === '/exa.language_server_pb.LanguageServerService/GetStatus') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                    return;
                }
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 page not found');
            }, '::1'));
        } catch {
            // Skip cleanly on environments without IPv6 loopback enabled.
            return;
        }
        commands.run.mockImplementation(async file => {
            if (file === 'ps') { return { stdout: row(hubPort, 6109, 'V6TlsToken'), stderr: '' }; }
            if (file === 'lsof') { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            return {
                stdout: `LISTEN 0 128 [::1]:${tlsPort} [::]:* users:(("agy",pid=6109,fd=10))`,
                stderr: '',
            };
        });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 6109, port: tlsPort, csrfToken: 'V6TlsToken', useTls: true, hostname: '::1' });
        expect(tlsErrors).toEqual([]);
    });

    it('P2-9: probes PID-owned [::1] listener directly even when an unrelated IPv4 listener occupies the same port number', async () => {
        platform('linux');
        // Bind an unrelated IPv4 server returning 404 first to grab an ephemeral port
        const ipv4DecoyHits: Array<{ token: string | string[] | undefined; path: string | undefined }> = [];
        const ipv4Decoy = createServer((req, res) => {
            ipv4DecoyHits.push({ token: req.headers['x-codeium-csrf-token'], path: req.url });
            req.resume();
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end('{"code":"unauthenticated"}');
        });
        servers.push(ipv4Decoy);
        await new Promise<void>((resolve, reject) => {
            ipv4Decoy.once('error', reject);
            ipv4Decoy.listen(0, '127.0.0.1', resolve);
        });
        const sharedPort = (ipv4Decoy.address() as AddressInfo).port;

        // Bind the real hub on [::1]:sharedPort (same port, IPv6 loopback family!)
        const ipv6Hub = createServer((req, res) => {
            received.push({ port: sharedPort, token: req.headers['x-codeium-csrf-token'], path: req.url });
            req.resume();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        try {
            await new Promise<void>((resolve, reject) => {
                ipv6Hub.once('error', reject);
                ipv6Hub.listen(sharedPort, '::1', resolve);
            });
            servers.push(ipv6Hub);
        } catch {
            // Skip cleanly on environments without dual IPv4+IPv6 same-port loopback support.
            return;
        }

        // Hub argv declares --hub-port=sharedPort (probed on IPv4 first, which hits decoy 401),
        // then socket inspection returns PID-owned [::1]:sharedPort.
        commands.run.mockImplementation(async file => {
            if (file === 'ps') { return { stdout: row(sharedPort, 6110, 'DualStackV6Tok'), stderr: '' }; }
            if (file === 'lsof') { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            return {
                stdout: `LISTEN 0 128 [::1]:${sharedPort} [::]:* users:(("agy",pid=6110,fd=12))`,
                stderr: '',
            };
        });

        const found = await discoverLanguageServer();
        expect(found).toEqual({ pid: 6110, port: sharedPort, csrfToken: 'DualStackV6Tok', useTls: false, hostname: '::1' });
        expect(received).toEqual([{ port: sharedPort, token: 'DualStackV6Tok', path: '/exa.language_server_pb.LanguageServerService/GetStatus' }]);
        // R2-P1-12: PID socket ownership verified FIRST -> unrelated IPv4 decoy receives ZERO credentialed probes!
        expect(ipv4DecoyHits).toHaveLength(0);
    });
});

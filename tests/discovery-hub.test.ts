import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

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
    const servers: Server[] = [];
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
        expect(commands.run).toHaveBeenCalledTimes(1);
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
        expect(commands.run.mock.calls.map(([file]) => file)).toEqual(['ps']);
    });

    it('finds an agy hub inside the selected Remote-WSL distro', async () => {
        platform('win32');
        const port = await server();
        commands.run.mockImplementation(async (file, args) => {
            expect(file).toMatch(/wsl\.exe$/);
            expect(args).toEqual(['-d', 'Ubuntu', '--', 'ps', '-axww', '-o', 'pid=,command=']);
            return { stdout: `123 /home/test/.gemini/bin/agy --hub --hub-port=${port} --csrf_token=Mixed-Case-Token --app_data_dir=antigravity`, stderr: '' };
        });
        expect((await discoverLanguageServer('vscode-remote://wsl%2BUbuntu/home/test'))?.port).toBe(port);
        expect(commands.run).toHaveBeenCalledTimes(1);
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
        expect(commands.run).toHaveBeenCalledTimes(1);
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
        expect(commands.run).toHaveBeenCalledTimes(1);
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
});

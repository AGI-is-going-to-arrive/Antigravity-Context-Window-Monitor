import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

const commands = vi.hoisted(() => ({
    run: vi.fn<(file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>>(),
    wsl: false,
}));

vi.mock('child_process', async () => {
    const { promisify } = await import('util');
    return { execFile: Object.assign(vi.fn(), { [promisify.custom]: commands.run }) };
});

vi.mock('fs', async importOriginal => {
    const fs = await importOriginal<typeof import('fs')>();
    return {
        ...fs,
        existsSync: () => true,
        readFileSync: (...args: Parameters<typeof fs.readFileSync>) =>
            args[0] === '/proc/version'
                ? (commands.wsl ? 'Linux Microsoft WSL2' : 'Linux generic')
                : fs.readFileSync(...args),
    };
});

import { discoverLanguageServer, resetPathDiagLog, resetWmicCache, resetWslCache } from '../src/discovery';

describe('hub discovery through real loopback HTTP and mocked OS process listings', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const servers: Server[] = [];
    const received: Array<{ port: number; token: string | string[] | undefined; path: string | undefined }> = [];

    async function server(status = 200, body = '{}'): Promise<number> {
        const httpServer = createServer((req, res) => {
            received.push({ port: (httpServer.address() as AddressInfo).port, token: req.headers['x-codeium-csrf-token'], path: req.url });
            req.resume();
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(body);
        });
        servers.push(httpServer);
        await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
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
        expect(received).toEqual([{ port, token: 'Mixed-Case-Token', path: '/exa.language_server_pb.LanguageServerService/GetUnleashData' }]);
        expect(commands.run).toHaveBeenCalledTimes(1);
        if (os === 'win32') {
            expect(commands.run.mock.calls[0][1].join(' ')).toContain("name = 'agy.exe'");
        } else {
            expect(commands.run.mock.calls[0].slice(0, 2)).toEqual(['ps', ['-ax', '-o', 'pid=,command=']]);
        }
    });

    it('uses PowerShell on Windows when WMIC is unavailable, then caches that decision', async () => {
        platform('win32');
        const port = await server();
        commands.run.mockImplementation(async (file, args) => {
            if (/WMIC\.exe$/i.test(file)) { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }
            expect(file).toMatch(/powershell\.exe$/i);
            expect(args.join(' ')).toContain("Name = 'agy.exe'");
            return { stdout: row(port), stderr: '' };
        });
        expect((await discoverLanguageServer())?.port).toBe(port);
        expect((await discoverLanguageServer())?.port).toBe(port);
        expect(commands.run.mock.calls.filter(([file]) => /WMIC\.exe$/i.test(file))).toHaveLength(1);
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
            expect(args).toEqual(['-d', 'Ubuntu', '--', 'ps', '-ax', '-o', 'pid=,command=']);
            return { stdout: `123 /home/test/.gemini/bin/agy --hub --hub-port=${port} --csrf_token=Mixed-Case-Token --app_data_dir=antigravity`, stderr: '' };
        });
        expect((await discoverLanguageServer('vscode-remote://wsl%2BUbuntu/home/test'))?.port).toBe(port);
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

    it('does not attach to another IDE when the hinted hub is absent', async () => {
        platform('darwin');
        const otherPort = await server();
        commands.run.mockResolvedValue({ stdout: row(otherPort, 111, 'OtherToken'), stderr: '' });
        expect(await discoverLanguageServer(undefined, undefined, undefined, { port: otherPort, csrfToken: 'CurrentToken' })).toBeNull();
        expect(received).toEqual([]);
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

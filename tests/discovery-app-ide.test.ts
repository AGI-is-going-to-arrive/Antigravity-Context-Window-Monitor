import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

const commands = vi.hoisted(() => ({
    run: vi.fn<(file: string, args: string[], options?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }>>(),
    wsl: false,
}));

vi.mock('child_process', async () => {
    const { promisify } = await import('util');
    return { execFile: Object.assign(vi.fn(), { [promisify.custom]: commands.run }) };
});

import {
    discoverLanguageServer,
    discoverFromEnv,
    parseLsAddressEnv,
    isAppStandaloneHubProcess,
    classifyProcessSurface,
    classifyHubRecordSurface,
    selectMatchingHubRecords,
    selectMatchingProcessLine,
    filterLsProcessLines,
    parseProcNetTcp,
    findListeningPortsFromProc,
    parseWslDrvFsMounts,
    convertWindowsPathToWsl,
    resolveWslWindowsRoot,
    buildWslWindowsExePath,
    resolveWslWindowsUserProfile,
    getAntigravityAppDataDirs,
    getAntigravityDaemonDirs,
    readAllHubDiscoveryFilesFromDirs,
    resetPathDiagLog,
    resetWmicCache,
    resetWslCache,
    type HubDiscoveryRecord,
    type LSInfo,
} from '../src/discovery';
import { getEnvBackendHint } from '../src/backend-connection';
import {
    normalizeUri,
    isRpcUnimplementedError,
    fetchTrajectoryGeneratorMetadata,
    fetchTrajectorySteps,
    fetchCommandModelConfigsSafe,
    getAllTrajectories,
} from '../src/tracker';

describe('Antigravity App + IDE unified discovery & cross-platform hardening', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const servers: Server[] = [];
    let tempDir: string;

    async function startHttpServer(
        handler: (req: IncomingMessage, res: ServerResponse) => void,
        host = '127.0.0.1',
    ): Promise<number> {
        const srv = createServer((req, res) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                (req as IncomingMessage & { rawBody?: string }).rawBody = body;
                handler(req, res);
            });
        });
        servers.push(srv);
        await new Promise<void>((resolve, reject) => {
            srv.once('error', reject);
            srv.listen(0, host, resolve);
        });
        return (srv.address() as AddressInfo).port;
    }

    function setPlatform(name: NodeJS.Platform): void {
        Object.defineProperty(process, 'platform', { value: name, configurable: true });
        resetWslCache();
    }

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-discovery-app-ide-'));
        commands.run.mockReset();
        commands.wsl = false;
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
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('parseLsAddressEnv & getEnvBackendHint (loopback-only enforcement)', () => {
        it('accepts valid loopback addresses in bare host:port and URL forms', () => {
            expect(parseLsAddressEnv('localhost:62502')).toEqual({
                hostname: '127.0.0.1', port: 62502, allowIpv6Fallback: true,
            });
            expect(parseLsAddressEnv('127.0.0.1:62502')).toEqual({
                hostname: '127.0.0.1', port: 62502,
            });
            expect(parseLsAddressEnv('[::1]:62502')).toEqual({
                hostname: '::1', port: 62502, ipv6Only: true,
            });
            expect(parseLsAddressEnv('http://localhost:62502/')).toEqual({
                hostname: '127.0.0.1', port: 62502, useTls: false, allowIpv6Fallback: true,
            });
            expect(parseLsAddressEnv('https://127.0.0.1:62501')).toEqual({
                hostname: '127.0.0.1', port: 62501, useTls: true,
            });
            expect(parseLsAddressEnv('https://[::1]:62501')).toEqual({
                hostname: '::1', port: 62501, useTls: true, ipv6Only: true,
            });
        });

        it.each([
            '',
            '   ',
            'localhost',
            'localhost:0',
            'localhost:70000',
            'evil.example.com:62502',
            'http://evil.example.com:62502',
            '192.168.1.50:62502',
            '0.0.0.0:62502',
            'http://user:pass@127.0.0.1:62502',
            'http://127.0.0.1:62502/extra/path',
            'ftp://127.0.0.1:62502',
        ])('rejects unsafe or malformed ANTIGRAVITY_LS_ADDRESS %j', raw => {
            expect(parseLsAddressEnv(raw)).toBeNull();
        });

        it('extracts loopback env backend hint cleanly while rejecting remote addresses and whitespace tokens', () => {
            expect(getEnvBackendHint({
                ANTIGRAVITY_LS_ADDRESS: 'localhost:62502',
                ANTIGRAVITY_CSRF_TOKEN: 'tok-abc-123',
            })).toEqual({ port: 62502, csrfToken: 'tok-abc-123' });

            expect(getEnvBackendHint({
                ANTIGRAVITY_LS_ADDRESS: 'https://evil.example.com:62502',
                ANTIGRAVITY_CSRF_TOKEN: 'tok-abc-123',
            })).toBeNull();

            expect(getEnvBackendHint({
                ANTIGRAVITY_LS_ADDRESS: 'localhost:62502',
                ANTIGRAVITY_CSRF_TOKEN: 'bad token',
            })).toBeNull();
        });
    });

    describe('first-priority env discovery (ANTIGRAVITY_LS_ADDRESS + ANTIGRAVITY_CSRF_TOKEN)', () => {
        it('connects via env vars first for App Sidecar, recovers PID from hub JSON even with per-subclient CSRF token, and skips ps', async () => {
            const port = await startHttpServer((req, res) => {
                if (req.url === '/exa.language_server_pb.LanguageServerService/GetStatus'
                    && req.headers['x-codeium-csrf-token'] === 'Subclient-Csrf-Token') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                    return;
                }
                res.writeHead(401);
                res.end('{}');
            });

            fs.writeFileSync(path.join(tempDir, `hub_${port}.json`), JSON.stringify({
                pid: 81757,
                httpPort: port,
                httpsPort: port + 1,
                lsVersion: '2.34.0',
                csrfToken: 'Hub-Root-Csrf-Token',
            }));

            const found = await discoverLanguageServer({
                preferredSurface: 'app',
                daemonDir: tempDir,
                env: {
                    ANTIGRAVITY_LS_ADDRESS: `localhost:${port}`,
                    ANTIGRAVITY_CSRF_TOKEN: 'Subclient-Csrf-Token',
                    ANTIGRAVITY_AGENTAPI_EXE: '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
                },
            });

            expect(found).toEqual({
                pid: 81757,
                port,
                csrfToken: 'Subclient-Csrf-Token',
                useTls: false,
                surface: 'app',
                source: 'env',
            });
            expect(commands.run).not.toHaveBeenCalled();
        });

        it('never logs CSRF token when env probe fails with 401', async () => {
            const secret = 'Env-Secret-Do-Not-Log-999';
            const port = await startHttpServer((_req, res) => {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end('{"code":"unauthenticated"}');
            });
            const logs: string[] = [];

            const res = await discoverFromEnv(
                { ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${port}`, ANTIGRAVITY_CSRF_TOKEN: secret },
                undefined,
                m => logs.push(m),
                tempDir,
            );
            expect(res).toBeNull();
            expect(logs.join('\n')).not.toContain(secret);
        });
    });

    describe('Antigravity App v2.34+ standalone hub recognition & App vs IDE disambiguation', () => {
        const macAppLine = '81757 /Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone --override_ide_name antigravity --subclient_type hub --override_ide_version 2.34.0 --app_data_dir antigravity --enable_sidecars';
        const winAppLine = '"81757","""C:\\Users\\Alice\\AppData\\Local\\Programs\\Antigravity\\resources\\bin\\language_server.exe"" --standalone --override_ide_name antigravity --subclient_type hub --app_data_dir antigravity"';
        const linuxAppLine = '81757 /opt/Antigravity/resources/bin/language_server --standalone --subclient_type=hub --app_data_dir=antigravity';
        const macIdeLine = '82276 /Users/alice/.gemini/bin/agy --hub --hub-port=62541 --app_data_dir=antigravity --csrf_token=IdeToken123';

        it('recognizes App standalone hub processes across macOS, Windows, and Linux without --csrf_token in argv', () => {
            expect(isAppStandaloneHubProcess(macAppLine)).toBe(true);
            expect(isAppStandaloneHubProcess(winAppLine)).toBe(true);
            expect(isAppStandaloneHubProcess(linuxAppLine)).toBe(true);
            expect(isAppStandaloneHubProcess(macIdeLine)).toBe(false);
            expect(isAppStandaloneHubProcess('999 /bin/sh -c "echo language_server --standalone --subclient_type hub antigravity"')).toBe(false);

            expect(classifyProcessSurface(macAppLine)).toBe('app');
            expect(classifyProcessSurface(winAppLine)).toBe('app');
            expect(classifyProcessSurface(macIdeLine)).toBe('ide');

            const filtered = filterLsProcessLines(`${macAppLine}\n999 /usr/bin/node app.js\n${macIdeLine}`);
            expect(filtered).toEqual([macAppLine, macIdeLine]);
        });

        it('selects App vs IDE accurately when BOTH Antigravity App and Antigravity IDE run concurrently', async () => {
            setPlatform('darwin');
            const appPort = await startHttpServer((req, res) => {
                if (req.headers['x-codeium-csrf-token'] === 'AppHubToken') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                    return;
                }
                res.writeHead(401);
                res.end('{}');
            });
            const idePort = await startHttpServer((req, res) => {
                if (req.headers['x-codeium-csrf-token'] === 'IdeHubToken') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                    return;
                }
                res.writeHead(401);
                res.end('{}');
            });

            const ideRow = `82276 /Users/alice/.gemini/bin/agy --hub --hub-port=${idePort} --app_data_dir=antigravity --csrf_token=IdeHubToken`;
            commands.run.mockResolvedValue({
                stdout: `${ideRow}\n${macAppLine}`,
                stderr: '',
            });

            fs.writeFileSync(path.join(tempDir, `hub_${appPort}.json`), JSON.stringify({
                pid: 81757, httpPort: appPort, httpsPort: appPort + 1, lsVersion: '2.34.0', csrfToken: 'AppHubToken',
            }));
            fs.writeFileSync(path.join(tempDir, `hub_${idePort}.json`), JSON.stringify({
                pid: 82276, httpPort: idePort, httpsPort: idePort + 1, lsVersion: '2.34.0', csrfToken: 'IdeHubToken',
            }));

            // App preference picks App standalone hub (PID 81757 paired with hub_<appPort>.json)
            const appFound = await discoverLanguageServer({
                preferredSurface: 'app',
                useEnv: false,
                daemonDir: tempDir,
            });
            expect(appFound).toEqual({
                pid: 81757,
                port: appPort,
                csrfToken: 'AppHubToken',
                useTls: false,
                surface: 'app',
                source: 'hub-file',
            });

            // IDE preference picks IDE agy --hub (PID 82276)
            const ideFound = await discoverLanguageServer({
                preferredSurface: 'ide',
                daemonDir: tempDir,
            });
            expect(ideFound).toEqual({
                pid: 82276,
                port: idePort,
                csrfToken: 'IdeHubToken',
                useTls: false,
                surface: 'ide',
                source: 'process',
            });
        });

        it('orders hub records and process lines by preferredSurface cleanly', () => {
            const lines = [macIdeLine, macAppLine];
            expect(selectMatchingProcessLine(lines, undefined, 'app')).toBe(macAppLine);
            expect(selectMatchingProcessLine(lines, undefined, 'ide')).toBe(macIdeLine);

            const ideRec: HubDiscoveryRecord = { pid: 82276, httpPort: 62541, httpsPort: 62544, csrfToken: 'ide' };
            const appRec: HubDiscoveryRecord = { pid: 81757, httpPort: 62502, httpsPort: 62501, csrfToken: 'app' };

            expect(classifyHubRecordSurface(appRec, lines, false)).toBe('app');
            expect(classifyHubRecordSurface(ideRec, lines, false)).toBe('ide');
            expect(selectMatchingHubRecords([ideRec, appRec], lines, 'app', false).map(r => r.pid)).toEqual([81757, 82276]);
            expect(selectMatchingHubRecords([appRec, ideRec], lines, 'ide', false).map(r => r.pid)).toEqual([82276, 81757]);
        });
    });

    describe('Cross-platform hardening (windowsHide, Linux /proc fallback, Windows file:///C:/ normalization)', () => {
        it('passes windowsHide: true on EVERY Windows execFile invocation (WMIC, PowerShell, netstat, wsl)', async () => {
            setPlatform('win32');
            const port = await startHttpServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{}');
            });

            commands.run.mockImplementation(async (file, _args, opts) => {
                expect(opts?.windowsHide).toBe(true);
                if (/WMIC\.exe$/i.test(file)) {
                    throw Object.assign(new Error('not found'), { code: 'ENOENT' });
                }
                if (/powershell\.exe$/i.test(file)) {
                    return {
                        stdout: `"4321","""C:\\Users\\Alice\\.gemini\\bin\\agy.exe"" --hub --hub-port=0 --app_data_dir=antigravity --csrf_token=WinTok"`,
                        stderr: '',
                    };
                }
                if (/NETSTAT\.EXE$/i.test(file)) {
                    return {
                        stdout: `  TCP    127.0.0.1:${port}    0.0.0.0:0    LISTENING    4321`,
                        stderr: '',
                    };
                }
                return { stdout: '', stderr: '' };
            });

            const found = await discoverLanguageServer({ preferredSurface: 'ide', daemonDir: tempDir });
            expect(found?.port).toBe(port);
            expect(commands.run.mock.calls.length).toBeGreaterThanOrEqual(2);
            for (const call of commands.run.mock.calls) {
                expect(call[2]?.windowsHide).toBe(true);
            }
        });

        it('parses Linux /proc/net/tcp & /proc/net/tcp6 and correlates /proc/<pid>/fd socket inodes', () => {
            // Port 62502 = 0xF426, Port 62501 = 0xF425, Port 8080 = 0x1F90
            const tcpContent = [
                '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
                '   0: 0100007F:F426 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111111 1 0',
                '   1: 0A000001:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 222222 1 0',
                '   2: 0100007F:1F90 0100007F:C000 01 00000000:00000000 00:00000000 00000000  1000        0 333333 1 0',
            ].join('\n');
            const tcp6Content = [
                '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
                '   0: 00000000000000000000000001000000:F425 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 444444 1 0',
            ].join('\n');

            const inodes = new Set(['111111', '222222', '333333', '444444']);
            // Rejects 10.0.0.1 (non-loopback) and st=01 (ESTABLISHED), keeps 127.0.0.1:62502 with explicit loopback family
            expect(parseProcNetTcp(tcpContent, false, inodes)).toEqual([{ port: 62502, hostname: '127.0.0.1' }]);
            // Keeps [::1]:62501 marked ipv6Only with explicit ::1 hostname so IPv4 probes are never sent
            expect(parseProcNetTcp(tcp6Content, true, inodes)).toEqual([{ port: 62501, ipv6Only: true, hostname: '::1' }]);

            // Full synthetic /proc tree with real symlinks on POSIX
            if (process.platform !== 'win32') {
                const fakeProc = path.join(tempDir, 'proc');
                fs.mkdirSync(path.join(fakeProc, '9876', 'fd'), { recursive: true });
                fs.mkdirSync(path.join(fakeProc, 'net'), { recursive: true });
                fs.symlinkSync('socket:[111111]', path.join(fakeProc, '9876', 'fd', '3'));
                fs.symlinkSync('socket:[444444]', path.join(fakeProc, '9876', 'fd', '4'));
                fs.symlinkSync('/dev/null', path.join(fakeProc, '9876', 'fd', '5'));
                fs.writeFileSync(path.join(fakeProc, 'net', 'tcp'), tcpContent, 'utf8');
                fs.writeFileSync(path.join(fakeProc, 'net', 'tcp6'), tcp6Content, 'utf8');

                expect(findListeningPortsFromProc(9876, fakeProc)).toEqual([
                    { port: 62502, hostname: '127.0.0.1' },
                    { port: 62501, ipv6Only: true, hostname: '::1' },
                ]);
            }
        });

        it('normalizes Windows file:///C:/, FILE://localhost/C:/, encoded colons, and backslashes consistently', () => {
            expect(normalizeUri('file:///C:/Users/Alice/Project/', 'win32')).toBe('c:/users/alice/project');
            expect(normalizeUri('FILE:///c%3A/Users/Alice/Project', 'win32')).toBe('c:/users/alice/project');
            expect(normalizeUri('file://localhost/C:/Users/Alice/Project/', 'win32')).toBe('c:/users/alice/project');
            expect(normalizeUri('C:\\Users\\Alice\\Project\\', 'win32')).toBe('c:/users/alice/project');
            // Even when inspected on a POSIX host (e.g. WSL/macOS cross-check), strips leading slash before Windows drive letter.
            expect(normalizeUri('file:///C:/Users/Alice/Project/', 'linux')).toBe('C:/Users/Alice/Project');
        });
    });

    describe('tracker.ts v2.34+ RPC resilience (501 handling, promptSections, stepOffset, trajectory metadata)', () => {
        it('handles 501 unimplemented gracefully, preserves raw promptSections, supports stepOffset pagination, and keeps trajectoryType/parentCascadeId', async () => {
            const receivedRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
            const port = await startHttpServer((req, res) => {
                const rawBody = (req as IncomingMessage & { rawBody?: string }).rawBody || '{}';
                const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
                receivedRequests.push({ url: req.url || '', body: parsedBody });

                if (req.url?.endsWith('/GetCommandModelConfigs')) {
                    res.writeHead(501, { 'Content-Type': 'application/json' });
                    res.end('{"code":"unimplemented"}');
                    return;
                }
                if (req.url?.endsWith('/GetUserStatus')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        userStatus: {
                            name: 'Test User',
                            cascadeModelConfigData: {
                                clientModelConfigs: [{
                                    label: 'Gemini 4 Neon (High)',
                                    modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' },
                                    quotaInfo: { remainingFraction: 0.85, resetTime: '2026-11-23T12:00:00Z' },
                                }],
                            },
                        },
                    }));
                    return;
                }
                if (req.url?.endsWith('/GetCascadeTrajectoryGeneratorMetadata')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        generatorMetadata: [{
                            stepIndices: [1, 2],
                            chatModel: {
                                model: 'MODEL_PLACEHOLDER_M532',
                                promptSections: [
                                    { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 4000 },
                                    { title: 'Skills', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 1200 },
                                ],
                                usage: { inputTokens: '5000', outputTokens: '300', cacheReadTokens: '2000' },
                            },
                        }],
                    }));
                    return;
                }
                if (req.url?.endsWith('/GetCascadeTrajectorySteps')) {
                    // Simulate v2.34+ server returning all 60 steps on first batch (ignoring endIndex).
                    const steps = Array.from({ length: 60 }, (_, idx) => ({ type: 'CORTEX_STEP_TYPE_USER_INPUT', idx }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                    return;
                }
                if (req.url?.endsWith('/GetAllCascadeTrajectories')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        trajectorySummaries: {
                            'sub-1': {
                                trajectoryId: 't-sub-1',
                                summary: 'Worker Subagent',
                                stepCount: 5,
                                status: 'CASCADE_RUN_STATUS_RUNNING',
                                lastModifiedTime: '2026-11-22T12:00:00Z',
                                trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT',
                                trajectoryMetadata: { parentCascadeId: 'main-1', role: 'worker' },
                                killed: false,
                            },
                        },
                    }));
                    return;
                }
                res.writeHead(404);
                res.end();
            });

            const ls: LSInfo = { pid: 81757, port, csrfToken: 'test-tok', useTls: false, surface: 'app', source: 'env' };

            expect(isRpcUnimplementedError(new Error('RPC HTTP 501: {"code":"unimplemented"}'))).toBe(true);
            expect(isRpcUnimplementedError(new Error('RPC HTTP 500: internal'))).toBe(false);

            // Relies on GetUserStatus without hitting GetCommandModelConfigs.
            const configs = await fetchCommandModelConfigsSafe(ls);
            expect(configs).toHaveLength(1);
            expect(configs[0].model).toBe('MODEL_PLACEHOLDER_M532');
            expect(receivedRequests.some(r => r.url.endsWith('/GetCommandModelConfigs'))).toBe(false);

            // Preserves raw promptSections intact.
            const rawGm = await fetchTrajectoryGeneratorMetadata(ls, 'main-1');
            expect(rawGm).toHaveLength(1);
            expect(rawGm[0].chatModel?.promptSections).toEqual([
                { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 4000 },
                { title: 'Skills', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 1200 },
            ]);

            // Sends stepOffset and short-circuits on full-batch v2.34+ response (only 1 RPC, no duplication).
            const stepsResult = await fetchTrajectorySteps(ls, 'main-1', 60);
            expect(stepsResult.steps).toHaveLength(60);
            expect(stepsResult.hasGaps).toBe(false);
            const stepCalls = receivedRequests.filter(r => r.url.endsWith('/GetCascadeTrajectorySteps'));
            expect(stepCalls).toHaveLength(1);
            expect(stepCalls[0].body.stepOffset).toBe(0);

            // Preserves trajectoryType, parentCascadeId, trajectoryMetadata, killed.
            const trajectories = await getAllTrajectories(ls);
            expect(trajectories).toHaveLength(1);
            expect(trajectories[0]).toMatchObject({
                cascadeId: 'sub-1',
                trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT',
                parentCascadeId: 'main-1',
                trajectoryMetadata: { parentCascadeId: 'main-1', role: 'worker' },
                killed: false,
            });
        });
    });

    describe('WSL dynamic drive/mount root & Windows host %USERPROFILE% bridging', () => {
        const sampleProcMounts = [
            'none /mnt/wsl tmpfs rw,relatime 0 0',
            'C:\\134 /win/c drvfs rw,noatime 0 0',
            'drvfs /win/d 9p rw,dirsync,noatime,aname=drvfs;path=D:\\;uid=1000;gid=1000 0 0',
            'tools /init 9p ro,dirsync,aname=tools 0 0',
        ].join('\n');

        it('parses both WSL1 drvfs and WSL2 9p drvfs mount tables with custom automount roots', () => {
            const mounts = parseWslDrvFsMounts(sampleProcMounts);
            expect(mounts.get('C')).toBe('/win/c');
            expect(mounts.get('D')).toBe('/win/d');
            expect(mounts.size).toBe(2);

            expect(convertWindowsPathToWsl('D:\\Windows\\System32', mounts)).toBe('/win/d/Windows/System32');
            expect(convertWindowsPathToWsl('C:\\Users\\Alice', mounts)).toBe('/win/c/Users/Alice');
            expect(convertWindowsPathToWsl('E:\\Data', mounts)).toBe('/mnt/e/Data');
            expect(convertWindowsPathToWsl('/already/posix', mounts)).toBeNull();
        });

        it('resolves non-C Windows roots via env SystemRoot, inherited PATH, or /proc/mounts without hardcoding /mnt/c', () => {
            // 1. Explicit SystemRoot on D: mapped via custom mount table
            const viaEnv = resolveWslWindowsRoot({
                env: { SystemRoot: 'D:\\Windows' },
                procMountsContent: sampleProcMounts,
                existsSyncFn: () => false,
            });
            expect(viaEnv).toBe('/win/d/Windows');
            expect(buildWslWindowsExePath(viaEnv, 'wmic')).toBe('/win/d/Windows/System32/wbem/WMIC.exe');
            expect(buildWslWindowsExePath(viaEnv, 'powershell')).toBe('/win/d/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');
            expect(buildWslWindowsExePath(viaEnv, 'netstat')).toBe('/win/d/Windows/System32/netstat.exe');

            // 2. Inherited Windows System32 on WSL PATH
            const viaPath = resolveWslWindowsRoot({
                env: { PATH: '/usr/bin:/custom-mnt/e/Windows/System32:/custom-mnt/e/Windows' },
                procMountsContent: '',
                existsSyncFn: () => false,
            });
            expect(viaPath).toBe('/custom-mnt/e/Windows');

            // 3. Probe drvfs mounts for Windows/System32 when env/PATH unset
            const viaMounts = resolveWslWindowsRoot({
                env: {},
                procMountsContent: sampleProcMounts,
                existsSyncFn: (p) => p === '/win/d/Windows/System32',
            });
            expect(viaMounts).toBe('/win/d/Windows');
        });

        it('bridges Windows host %USERPROFILE%\\.gemini\\antigravity and deduplicates multi-dir hub records in WSL', () => {
            // Via USERPROFILE env
            expect(resolveWslWindowsUserProfile({
                env: { USERPROFILE: 'D:\\Users\\Alice' },
                procMountsContent: sampleProcMounts,
                existsSyncFn: () => false,
            })).toBe('/win/d/Users/Alice');

            // Via inherited Windows AppData PATH entry
            expect(resolveWslWindowsUserProfile({
                env: { PATH: '/usr/local/bin:/win/c/Users/Bob/AppData/Local/Microsoft/WindowsApps' },
                procMountsContent: '',
                existsSyncFn: () => false,
            })).toBe('/win/c/Users/Bob');

            // AppData & daemon dirs include both WSL Linux home and bridged Windows host profile
            const dataDirs = getAntigravityAppDataDirs({
                homedir: '/home/bob',
                inWsl: true,
                env: { USERPROFILE: 'D:\\Users\\Bob' },
                procMountsContent: sampleProcMounts,
                existsSyncFn: () => false,
            });
            expect(dataDirs).toEqual([
                path.join('/home/bob', '.gemini', 'antigravity'),
                path.join('/win/d/Users/Bob', '.gemini', 'antigravity'),
            ]);

            const daemonDirs = getAntigravityDaemonDirs({
                homedir: '/home/bob',
                inWsl: true,
                env: { USERPROFILE: 'D:\\Users\\Bob' },
                procMountsContent: sampleProcMounts,
                existsSyncFn: () => false,
            });
            expect(daemonDirs).toEqual([
                path.join('/home/bob', '.gemini', 'antigravity', 'daemon'),
                path.join('/win/d/Users/Bob', '.gemini', 'antigravity', 'daemon'),
            ]);

            // Multi-dir hub file scan merges & deduplicates records cleanly
            const dirA = path.join(tempDir, 'daemon-a');
            const dirB = path.join(tempDir, 'daemon-b');
            fs.mkdirSync(dirA, { recursive: true });
            fs.mkdirSync(dirB, { recursive: true });
            const sharedRec = JSON.stringify({ pid: 100, httpPort: 62502, httpsPort: 62501, csrfToken: 'TokShared' });
            const winOnlyRec = JSON.stringify({ pid: 200, httpPort: 62602, httpsPort: 62601, csrfToken: 'TokWin' });
            fs.writeFileSync(path.join(dirA, 'hub_62502.json'), sharedRec, 'utf8');
            fs.writeFileSync(path.join(dirB, 'hub_62502.json'), sharedRec, 'utf8');
            fs.writeFileSync(path.join(dirB, 'hub_62602.json'), winOnlyRec, 'utf8');

            const merged = readAllHubDiscoveryFilesFromDirs([dirA, dirB]);
            expect(merged.map(r => r.pid).sort()).toEqual([100, 200]);
        });
    });
});

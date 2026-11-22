import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    computeSnapshotHash,
    createFallbackSidecarProvider,
    createSidecarHandler,
    injectSidecarHeadAndScripts,
    MAX_ACTION_BODY_BYTES,
    startStandaloneServer,
    type StandaloneServerHandle,
} from '../src/app/sidecar-server';
import type { SidecarProvider, SidecarSnapshotPayload } from '../src/app/sidecar-types';
import { getThemeAdapterStyles } from '../src/app/theme-adapter';

interface HttpResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    text: string;
    json(): any;
}

function httpRequest(
    baseUrl: string,
    method: string,
    reqPath: string,
    options: { headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const url = new URL(reqPath, baseUrl);
        const body = options.body;
        const headers: Record<string, string> = { ...(options.headers || {}) };
        if (body !== undefined && !headers['Content-Length']) {
            headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
        }
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    text,
                    json: () => JSON.parse(text),
                });
            });
        });
        req.on('error', reject);
        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

describe('host-bridge script generator', () => {
    it('generates syntactically valid JS containing VS Code, Sidecar, and Standalone bridge hooks', () => {
        const script = getHostBridgeScript({ pollIntervalMs: 3500, autoPoll: true });
        // Verify valid JS syntax without executing browser globals
        expect(() => new Function(script)).not.toThrow();

        expect(script).toContain('window.__ACM_BRIDGE__');
        expect(script).toContain('acquireVsCodeApi');
        expect(script).toContain('window.sidecar');
        expect(script).toContain('/api/snapshot');
        expect(script).toContain('/api/action');
        expect(script).toContain('document.hidden');
        expect(script).toContain('visibilitychange');
        expect(script).toContain('onWorkspaceChange');
        expect(script).toContain('getWorkspaceUris');
        expect(script).toContain('toggleConversation');
        expect(script).toContain('theme-change');
        expect(script).toContain('navigator.clipboard');
        expect(script).toContain("execCommand('copy')");
    });

    it('clamps out-of-range polling intervals safely', () => {
        expect(getHostBridgeScript({ pollIntervalMs: 50 })).toContain('DEFAULT_POLL_MS = 1000');
        expect(getHostBridgeScript({ pollIntervalMs: 999999 })).toContain('DEFAULT_POLL_MS = 60000');
        expect(getHostBridgeScript({ pollIntervalMs: Number.NaN })).toContain('DEFAULT_POLL_MS = 4000');
    });
});

describe('theme-adapter stylesheet generator', () => {
    it('maps all VS Code CSS tokens from Antigravity host tokens and covers light/dark/hc + aux/sidebar', () => {
        const css = getThemeAdapterStyles();
        const requiredVscodeTokens = [
            '--vscode-editor-background',
            '--vscode-editorWidget-background',
            '--vscode-foreground',
            '--vscode-descriptionForeground',
            '--vscode-widget-border',
            '--vscode-contrastBorder',
            '--vscode-focusBorder',
            '--vscode-textLink-foreground',
            '--vscode-progressBar-background',
            '--vscode-list-hoverBackground',
            '--vscode-toolbar-hoverBackground',
            '--vscode-errorForeground',
            '--vscode-editorError-foreground',
            '--vscode-editorWarning-foreground',
            '--vscode-scrollbarSlider-background',
            '--vscode-font-size',
            '--vscode-editor-font-family',
        ];
        for (const token of requiredVscodeTokens) {
            expect(css).toContain(token);
        }

        expect(css).toContain('body[data-acm-theme="dark"]');
        expect(css).toContain('body[data-acm-theme="light"]');
        expect(css).toContain('body[data-acm-theme="hc"]');
        expect(css).toContain('body[data-acm-view="aux"]');
        expect(css).toContain('body[data-acm-view="sidebar"]');
        expect(css).toContain('@media (max-width: 520px)');
        expect(css).toContain('@media (min-width: 900px)');
        // Guard against dangling comma syntax errors before @media
        expect(css).not.toMatch(/,\s*@media/);
    });
});

describe('HTML injection & ETag hashing helpers', () => {
    it('injects /preload.js only in sidecar mode and places bridge before body scripts', () => {
        const raw = '<!DOCTYPE html><html><head><title>T</title></head><body><script>window.run=1;</script></body></html>';

        const sidecarHtml = injectSidecarHeadAndScripts(raw, {
            isSidecarEnv: true,
            viewMode: 'aux',
            themeAdapterCss: 'body { color: red; }',
            hostBridgeScript: 'window.__ACM_BRIDGE__ = {};',
        });
        expect(sidecarHtml).toContain('<script src="/preload.js"></script>');
        expect(sidecarHtml).toContain('data-acm-theme-adapter="true"');
        expect(sidecarHtml).toContain('data-acm-host-bridge="true"');
        expect(sidecarHtml).toContain('data-acm-surface="app-sidecar"');
        expect(sidecarHtml).toContain('data-acm-view="aux"');
        expect(sidecarHtml.indexOf('data-acm-host-bridge')).toBeLessThan(sidecarHtml.indexOf('window.run=1'));

        const standaloneHtml = injectSidecarHeadAndScripts(raw, {
            isSidecarEnv: false,
            viewMode: 'sidebar',
            themeAdapterCss: '',
            hostBridgeScript: '',
        });
        expect(standaloneHtml).not.toContain('src="/preload.js"');
        expect(standaloneHtml).toContain('data-acm-view="sidebar"');
    });

    it('produces deterministic snapshot hashes independent of object key order', () => {
        const h1 = computeSnapshotHash({ b: 2, a: { y: 1, x: 2 } });
        const h2 = computeSnapshotHash({ a: { x: 2, y: 1 }, b: 2 });
        const h3 = computeSnapshotHash({ a: { x: 2, y: 9 }, b: 2 });
        expect(h1).toBe(h2);
        expect(h1).not.toBe(h3);
    });
});

describe('sidecar HTTP server lifecycle & routes', () => {
    const handles: StandaloneServerHandle[] = [];

    afterEach(async () => {
        while (handles.length > 0) {
            const h = handles.pop();
            if (h) { await h.close(); }
        }
    });

    it('refuses non-loopback host bindings', async () => {
        const provider = createFallbackSidecarProvider({ version: '1.17.5' });
        await expect(startStandaloneServer(provider, { host: '0.0.0.0', port: 0 }))
            .rejects.toThrow(/non-loopback/i);
    });

    it('serves /, /full, /api/health, /api/snapshot ETag unchanged short-circuit, and /api/action', async () => {
        let counter = 1;
        let lastSeenQuery: Record<string, unknown> = {};
        const provider: SidecarProvider = {
            version: '1.17.5',
            renderHtml(ctx) {
                return `<!DOCTYPE html><html><head><title>ACM ${ctx.viewMode}</title></head><body><main>${ctx.pathname}</main></body></html>`;
            },
            getSnapshot(query): SidecarSnapshotPayload {
                lastSeenQuery = { ...query };
                return {
                    time: '12:00:00',
                    activeConversationId: query.conversationId || 'conv-default',
                    tabs: { overview: `<div>v${counter}</div>` },
                };
            },
            handleAction(action) {
                if (action.command === 'bump') {
                    counter += 1;
                    return {
                        ok: true,
                        result: { counter },
                        snapshot: { time: '12:00:01', tabs: { overview: `<div>v${counter}</div>` } },
                    };
                }
                if (action.command === 'explode') {
                    throw new Error('secret internal stack /Users/private/token.txt');
                }
                return { ok: false, statusCode: 400, error: `Unknown action: ${action.command}` };
            },
        };

        const handle = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
        handles.push(handle);
        expect(handle.host).toBe('127.0.0.1');
        expect(handle.port).toBeGreaterThan(0);

        // GET /
        const rootRes = await httpRequest(handle.url, 'GET', '/');
        expect(rootRes.status).toBe(200);
        expect(rootRes.headers['content-type']).toContain('text/html');
        expect(rootRes.text).toContain('data-acm-host-bridge="true"');
        expect(rootRes.text).toContain('data-acm-theme-adapter="true"');
        expect(rootRes.text).toContain('data-acm-view="standalone"');

        // GET /full
        const fullRes = await httpRequest(handle.url, 'GET', '/full');
        expect(fullRes.status).toBe(200);
        expect(fullRes.text).toContain('ACM sidebar');
        expect(fullRes.text).toContain('data-acm-view="sidebar"');

        // GET /api/health
        const healthRes = await httpRequest(handle.url, 'GET', '/api/health');
        expect(healthRes.status).toBe(200);
        expect(healthRes.json()).toMatchObject({
            ok: true,
            version: '1.17.5',
            surface: 'app-sidecar',
            pid: process.pid,
            mode: 'standalone',
        });

        // GET /api/snapshot (initial)
        const snap1 = await httpRequest(
            handle.url,
            'GET',
            '/api/snapshot?conversationId=conv-42&workspaceUris=%5B%22file%3A%2F%2F%2Ftmp%2Frepo%22%5D&lockToMainAgent=true',
        );
        expect(snap1.status).toBe(200);
        const snap1Body = snap1.json();
        expect(snap1Body.unchanged).toBe(false);
        expect(typeof snap1Body.hash).toBe('string');
        expect(snap1Body.snapshot.activeConversationId).toBe('conv-42');
        expect(snap1.headers.etag).toBe(`"${snap1Body.hash}"`);
        expect(lastSeenQuery).toMatchObject({
            conversationId: 'conv-42',
            workspaceUris: ['file:///tmp/repo'],
            lockToMainAgent: true,
        });

        // GET /api/snapshot with matching ?etag= -> 200 { unchanged: true, hash }
        const snap2 = await httpRequest(
            handle.url,
            'GET',
            `/api/snapshot?conversationId=conv-42&etag=${encodeURIComponent(snap1Body.hash)}`,
        );
        expect(snap2.status).toBe(200);
        expect(snap2.json()).toEqual({ unchanged: true, hash: snap1Body.hash });

        // GET /api/snapshot with matching If-None-Match header -> unchanged: true
        const snap2Header = await httpRequest(handle.url, 'GET', '/api/snapshot?conversationId=conv-42', {
            headers: { 'If-None-Match': `"${snap1Body.hash}"` },
        });
        expect(snap2Header.status).toBe(200);
        expect(snap2Header.json()).toEqual({ unchanged: true, hash: snap1Body.hash });

        // POST /api/action (valid mutating command)
        const actOk = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'bump' }),
        });
        expect(actOk.status).toBe(200);
        expect(actOk.json()).toMatchObject({
            ok: true,
            result: { counter: 2 },
        });

        // Snapshot now reflects updated data (hash changed)
        const snap3 = await httpRequest(
            handle.url,
            'GET',
            `/api/snapshot?conversationId=conv-42&etag=${encodeURIComponent(snap1Body.hash)}`,
        );
        expect(snap3.status).toBe(200);
        const snap3Body = snap3.json();
        expect(snap3Body.unchanged).toBe(false);
        expect(snap3Body.hash).not.toBe(snap1Body.hash);

        // POST /api/action invalid JSON -> 400
        const badJson = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: '{not-valid-json',
        });
        expect(badJson.status).toBe(400);
        expect(badJson.json()).toEqual({ ok: false, error: 'Invalid JSON body' });

        // POST /api/action missing command -> 400
        const noCmd = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ foo: 'bar' }),
        });
        expect(noCmd.status).toBe(400);
        expect(noCmd.json().ok).toBe(false);

        // POST /api/action unknown command -> 400
        const unknownCmd = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'doesNotExist' }),
        });
        expect(unknownCmd.status).toBe(400);
        expect(unknownCmd.json()).toEqual({ ok: false, error: 'Unknown action: doesNotExist' });

        // POST /api/action oversized body (>256KB) -> 413
        const huge = JSON.stringify({ command: 'bump', pad: 'x'.repeat(MAX_ACTION_BODY_BYTES + 1024) });
        const tooBig = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: huge,
        });
        expect(tooBig.status).toBe(413);
        expect(tooBig.json().ok).toBe(false);

        // POST /api/action provider throw -> 500 without leaking secret message or stack trace
        const exploded = await httpRequest(handle.url, 'POST', '/api/action', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'explode' }),
        });
        expect(exploded.status).toBe(500);
        expect(exploded.json()).toEqual({ ok: false, error: 'Internal action error' });
        expect(exploded.text).not.toContain('secret internal stack');

        // 405 & 404
        const wrongMethod = await httpRequest(handle.url, 'POST', '/api/health');
        expect(wrongMethod.status).toBe(405);

        const notFound = await httpRequest(handle.url, 'GET', '/api/nonexistent');
        expect(notFound.status).toBe(404);
    });

    it('renders SidecarApp mode with /preload.js via direct createSidecarHandler methods', async () => {
        const provider = createFallbackSidecarProvider({ version: '1.17.5' });
        const handler = createSidecarHandler(provider, { isSidecarEnv: true, version: '1.17.5' });

        const aux = await handler.renderPage('aux', '/?conversationId=c1');
        expect(aux.status).toBe(200);
        expect(aux.body).toContain('<script src="/preload.js"></script>');
        expect(aux.body).toContain('data-acm-view="aux"');

        const sidebar = await handler.renderPage('sidebar', '/full');
        expect(sidebar.body).toContain('data-acm-view="sidebar"');

        const pauseRes = await handler.handleActionPayload({ command: 'togglePause' });
        expect(pauseRes.status).toBe(200);
        expect(pauseRes.body.ok).toBe(true);
        expect(pauseRes.body.messages).toEqual([{ command: 'setPaused', paused: true }]);
    });
});

describe('pure-Node archive builders & installer dry-run/install/uninstall', () => {
    const tmpDirs: string[] = [];

    afterEach(() => {
        while (tmpDirs.length > 0) {
            const d = tmpDirs.pop();
            if (d) { fs.rmSync(d, { recursive: true, force: true }); }
        }
    });

    it('builds valid PKZIP and USTAR TAR.GZ archives without external binaries', async () => {
        const packagerPath = path.resolve(__dirname, '..', 'scripts', 'package-app-plugin.mjs');
        const mod = await import(packagerPath);
        const entries = [
            { name: 'antigravity-context-monitor/plugin.json', data: Buffer.from('{"name":"test"}\n', 'utf8'), mode: 0o100644 },
            { name: 'antigravity-context-monitor/sidecars/context_monitor/main.mjs', data: Buffer.from('console.log("ok");\n', 'utf8'), mode: 0o100755 },
        ];

        const zipBuf: Buffer = mod.buildZipBuffer(entries);
        // PKZIP local header signature PK\x03\x04 and EOCD signature PK\x05\x06
        expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50);
        expect(zipBuf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
        expect(zipBuf.includes(Buffer.from('antigravity-context-monitor/plugin.json'))).toBe(true);

        const tgzBuf: Buffer = mod.buildTarGzBuffer(entries);
        // GZIP magic bytes 0x1f 0x8b
        expect(tgzBuf[0]).toBe(0x1f);
        expect(tgzBuf[1]).toBe(0x8b);
    });

    it('supports --dry-run, --install, and --uninstall cleanly against an isolated target dir', async () => {
        const installerPath = path.resolve(__dirname, '..', 'scripts', 'install-app-plugin.mjs');
        const mod = await import(installerPath);

        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-installer-test-'));
        tmpDirs.push(tmpBase);

        const fakeSource = path.join(tmpBase, 'src-plugin');
        fs.mkdirSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
        fs.writeFileSync(path.join(fakeSource, 'plugin.json'), JSON.stringify({ name: 'antigravity-context-monitor', version: '1.17.5' }), 'utf8');
        fs.writeFileSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'), 'module.exports = {};', 'utf8');

        const targetDir = path.join(tmpBase, 'installed', 'antigravity-context-monitor');

        // Dry run creates nothing
        const dry = mod.runInstaller({ action: 'install', source: fakeSource, target: targetDir, dryRun: true });
        expect(dry.dryRun).toBe(true);
        expect(fs.existsSync(targetDir)).toBe(false);

        // Real install copies real files with no BOM
        const installed = mod.runInstaller({ action: 'install', source: fakeSource, target: targetDir, dryRun: false });
        expect(installed.version).toBe('1.17.5');
        expect(fs.existsSync(path.join(targetDir, 'plugin.json'))).toBe(true);
        expect(fs.lstatSync(path.join(targetDir, 'plugin.json')).isSymbolicLink()).toBe(false);
        const rawBytes = fs.readFileSync(path.join(targetDir, 'plugin.json'));
        expect(rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf).toBe(false);

        // Uninstall removes target dir
        const removed = mod.runInstaller({ action: 'uninstall', target: targetDir, dryRun: false });
        expect(removed.removed).toBe(true);
        expect(fs.existsSync(targetDir)).toBe(false);
    });
});

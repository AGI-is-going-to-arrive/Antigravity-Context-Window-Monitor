// Consolidated Gate Suite #1: Sidecar Security, Auth, CSRF, Privacy, Reveal & HTTP Server
import * as http from 'http';
import * as vm from 'vm';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { getHostBridgeScript } from '../src/app/host-bridge';
import {
    CDP_ALLOWED_OVERLAY_COMMANDS,
    computeSnapshotHash,
    computeSnapshotValidatorEtag,
    createFallbackSidecarProvider,
    createSidecarHandler,
    injectSidecarHeadAndScripts,
    isCommandAllowedForScope,
    renderStandalonePairingShellHtml,
    MAX_ACTION_BODY_BYTES,
    MAX_OVERLAY_ACTION_BODY_BYTES,
    MAX_PAIR_BODY_BYTES,
    SDK_ONLY_ACTION_COMMANDS,
    type SidecarOverlayAwareProvider,
    type StandaloneServerHandle,
    startStandaloneServer,
    validateLoopbackHostHeader,
} from '../src/app/sidecar-server';
import type { SidecarActionRequest, SidecarProvider, SidecarSnapshotPayload, SidecarSnapshotQuery } from '../src/app/sidecar-types';
import { getScript } from '../src/webview-script';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getThemeAdapterStyles } from '../src/app/theme-adapter';

describe('[sidecar-security]', () => {
    interface RawHttpResult {
        status: number;
        headers: http.IncomingHttpHeaders;
        text: string;
        json(): any;
    }


    function rawHttpRequest(
        baseUrl: string,
        method: string,
        reqPath: string,
        options: {
            headers?: Record<string, string>;
            body?: string;
            chunked?: boolean;
            overrideHostHeader?: string;
        } = {},
    ): Promise<RawHttpResult> {
        return new Promise((resolve, reject) => {
            const url = new URL(reqPath, baseUrl);
            const body = options.body;
            const headers: Record<string, string> = { ...(options.headers || {}) };
            if (options.overrideHostHeader !== undefined) {
                headers.Host = options.overrideHostHeader;
            }
            if (body !== undefined && !options.chunked && !headers['Content-Length'] && !headers['content-length']) {
                headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
            }
            if (options.chunked) {
                headers['Transfer-Encoding'] = 'chunked';
            }
            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method,
                headers,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
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
                if (options.chunked) {
                    const chunkSize = 8192;
                    for (let offset = 0; offset < body.length; offset += chunkSize) {
                        req.write(body.slice(offset, offset + chunkSize));
                    }
                } else {
                    req.write(body);
                }
            }
            req.end();
        });
    }


    describe('SEC-01/02: Sidecar HTTP transport security, standalone pairing, capabilities & ETag/304', () => {
        const servers: StandaloneServerHandle[] = [];

        afterEach(async () => {
            while (servers.length > 0) {
                const h = servers.pop();
                if (h) { await h.close(); }
            }
            vi.restoreAllMocks();
        });

        it('renders the pairing form in the requested language with a named password field', () => {
            for (const language of ['en', 'zh', 'both'] as const) {
                const page = renderStandalonePairingShellHtml('standalone', undefined, '1.18.0', language);
                expect(page).toContain('<label for="acmPairingCodeInput"');
                expect(page.includes('One-time pairing code')).toBe(language !== 'zh');
                expect(page.includes('一次性配对码')).toBe(language !== 'en');
                if (language === 'both') { expect(page).toContain('lang="zh-CN"'); }
            }
        });

        it('serves ONLY an inert empty pairing HTML shell when unpaired and blocks unauthenticated API/includeHtml with 401', async () => {
            const sentinelEmail = 'sentinel-a@private-corp.example';
            const sentinelWorkspace = '/Users/sentinel/top-secret-repo';
            const renderHtmlSpy = vi.fn(() => `<!DOCTYPE html><html><body><div>${sentinelEmail} ${sentinelWorkspace}</div></body></html>`);
            const getSnapshotSpy = vi.fn((): SidecarSnapshotPayload => ({
                time: '10:00:00',
                language: 'en',
                privacyMasked: true,
                activeConversationId: 'conv-secret',
                tabs: { overview: `<div>${sentinelEmail}</div>` },
                meta: { dataRevision: 1 },
            }));
            const handleActionSpy = vi.fn(() => ({ ok: true }));

            const provider: SidecarOverlayAwareProvider = {
                version: '1.18.0',
                renderHtml: renderHtmlSpy,
                getSnapshot: getSnapshotSpy,
                handleAction: handleActionSpy,
            };

            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0, version: '1.18.0' });
            servers.push(handle);
            const pairingCode = handle.bootstrapPairing!.code;
            expect(pairingCode).toMatch(/^[a-f0-9]{64}$/);

            // Unpaired GET / and /full: inert pairing shell ONLY (zero provider data, zero tokens)
            for (const p of ['/', '/full']) {
                const res = await rawHttpRequest(handle.url, 'GET', p);
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toContain('text/html');
                expect(res.headers['x-frame-options']).toBe('DENY');
                expect(res.text).toContain('data-acm-paired="false"');
                expect(res.text).toContain('acmPairingForm');
                expect(res.text).not.toContain(sentinelEmail);
                expect(res.text).not.toContain(sentinelWorkspace);
                expect(res.text).not.toContain(pairingCode);
                expect(res.text).not.toContain(handle.overlayBridgeToken);
            }
            expect(renderHtmlSpy).not.toHaveBeenCalled();

            // Unauthenticated /api/snapshot, /api/snapshot?includeHtml=1, /api/action -> 401
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot')).status).toBe(401);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1')).status).toBe(401);
            expect((await rawHttpRequest(handle.url, 'GET', `/api/snapshot?token=${pairingCode}`)).status).toBe(401);
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(401);

            // CDP overlay token MUST NOT authenticate /api/snapshot or /api/action
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: {
                    Authorization: `Bearer ${handle.overlayBridgeToken}`,
                    'X-Monitor-Token': handle.overlayBridgeToken,
                },
            })).status).toBe(401);
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: handle.url,
                    Authorization: `Bearer ${handle.overlayBridgeToken}`,
                    'X-Monitor-Token': handle.overlayBridgeToken,
                },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(401);

            expect(getSnapshotSpy).not.toHaveBeenCalled();
            expect(handleActionSpy).not.toHaveBeenCalled();
        });

        it('enforces one-time pairing burn on both /api/auth/pair and /api/pair, TTL expiry, and brute-force lockout', async () => {
            const provider: SidecarOverlayAwareProvider = {
                version: '1.18.0',
                renderHtml: () => '<!DOCTYPE html><html><body><div>paired-ok</div></body></html>',
                getSnapshot: () => ({ time: '10:00:00', tabs: { overview: '<div>ok</div>' } }),
                handleAction: () => ({ ok: true }),
            };

            // 1. Valid pairing via /api/pair alias issues origin-bound session + burns immediately
            let consumedCount = 0;
            const handle1 = await startStandaloneServer(provider, {
                host: '127.0.0.1',
                port: 0,
                standaloneAuth: {
                    requirePairing: true,
                    unpairedShellOnly: true,
                    onPairingConsumed: () => { consumedCount += 1; },
                },
            });
            servers.push(handle1);
            const code1 = handle1.bootstrapPairing!.code;

            // Wrong code -> 401
            const badCode = await rawHttpRequest(handle1.url, 'POST', '/api/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle1.url },
                body: JSON.stringify({ pairingToken: '0'.repeat(64) }),
            });
            expect(badCode.status).toBe(401);
            expect(consumedCount).toBe(0);

            // Correct code -> 200 + session credential + burns immediately
            const goodPair = await rawHttpRequest(handle1.url, 'POST', '/api/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle1.url },
                body: JSON.stringify({ pairingToken: code1 }),
            });
            expect(goodPair.status).toBe(200);
            expect(consumedCount).toBe(1);
            expect(goodPair.headers['set-cookie']).toBeUndefined();
            const sessionToken = goodPair.json().sessionToken as string;
            expect((await rawHttpRequest(handle1.url, 'GET', '/api/snapshot', {
                headers: { Cookie: `acm_standalone_session=${sessionToken}` },
            })).status).toBe(401);

            // Immediate replay of same code -> 401 (burned!)
            const replay = await rawHttpRequest(handle1.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle1.url },
                body: JSON.stringify({ pairingCode: code1 }),
            });
            expect(replay.status).toBe(401);

            // Authenticated GET / and GET /api/snapshot?includeHtml=1 succeed with the session header
            const authedPage = await rawHttpRequest(handle1.url, 'GET', '/', { headers: { 'X-Monitor-Session': sessionToken } });
            expect(authedPage.status).toBe(200);
            expect(authedPage.text).toContain('paired-ok');

            const authedHtmlSnap = await rawHttpRequest(handle1.url, 'GET', '/api/snapshot?includeHtml=1', {
                headers: { 'X-Monitor-Session': sessionToken },
            });
            expect(authedHtmlSnap.status).toBe(200);
            expect(authedHtmlSnap.json().html).toContain('paired-ok');

            // 2. Expired pairing code -> 401
            let nowMs = 1_700_000_000_000;
            const handle2 = await startStandaloneServer(provider, {
                host: '127.0.0.1',
                port: 0,
                standaloneAuth: {
                    requirePairing: true,
                    now: () => nowMs,
                },
            });
            servers.push(handle2);
            const code2 = handle2.bootstrapPairing!.code;
            nowMs += 61_000; // Past 60s TTL
            const expiredRes = await rawHttpRequest(handle2.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle2.url },
                body: JSON.stringify({ pairingCode: code2 }),
            });
            expect(expiredRes.status).toBe(401);

            // 3. Brute-force lockout burns pairing code after 5 failed attempts
            const handle3 = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0 });
            servers.push(handle3);
            const code3 = handle3.bootstrapPairing!.code;
            for (let i = 0; i < 5; i++) {
                const failRes = await rawHttpRequest(handle3.url, 'POST', '/api/auth/pair', {
                    headers: { 'Content-Type': 'application/json', Origin: handle3.url },
                    body: JSON.stringify({ pairingCode: 'f'.repeat(64) }),
                });
                expect(failRes.status).toBe(401);
            }
            // Now even the real code is burned
            const afterLockout = await rawHttpRequest(handle3.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle3.url },
                body: JSON.stringify({ pairingCode: code3 }),
            });
            expect(afterLockout.status).toBe(401);
        });

        it('validates Host, Method, Origin, Auth, Content-Type, and hard body byte limits BEFORE reading bodies (403/401/415/413)', async () => {
            const provider: SidecarOverlayAwareProvider = {
                version: '1.18.0',
                renderHtml: () => '<!DOCTYPE html><html><body>ok</body></html>',
                getSnapshot: () => ({ time: '10:00:00', tabs: { overview: 'ok' } }),
                handleAction: () => ({ ok: true }),
            };

            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0 });
            servers.push(handle);

            // Unit-level Host validation edge cases
            expect(validateLoopbackHostHeader('evil.example.com:8080', 8080).ok).toBe(false);
            expect(validateLoopbackHostHeader('127.0.0.1.evil.com:8080', 8080).ok).toBe(false);
            expect(validateLoopbackHostHeader('127.0.0.1:9999', 8080).ok).toBe(false);
            expect(validateLoopbackHostHeader('127.0.0.1:8080', 8080).ok).toBe(true);
            expect(validateLoopbackHostHeader('[::1]:8080', 8080).ok).toBe(true);

            // Pair to get valid session header and bearer
            const pairRes = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
            });
            expect(pairRes.status).toBe(200);
            const sessionToken = pairRes.json().sessionToken as string;

            // 1. DNS rebinding Host header -> 403 BEFORE body read
            const evilHost = await rawHttpRequest(handle.url, 'GET', '/api/health', {
                overrideHostHeader: 'attacker.example:1234',
            });
            expect(evilHost.status).toBe(403);

            const wrongPortHost = await rawHttpRequest(handle.url, 'GET', '/api/health', {
                overrideHostHeader: `127.0.0.1:${handle.port === 65535 ? 65534 : handle.port + 1}`,
            });
            expect(wrongPortHost.status).toBe(403);

            // 2. Same-origin GET / HEAD allows omitted Origin, rejects cross-origin, null, empty, and cross-port same-site
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken },
            })).status).toBe(200);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'same-origin' },
            })).status).toBe(200);
            expect((await rawHttpRequest(handle.url, 'HEAD', '/api/health')).status).toBe(200);
            // HTML navigation allows direct Sec-Fetch-Site: none, rejects same-site (another port on 127.0.0.1)
            expect((await rawHttpRequest(handle.url, 'GET', '/', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'none' },
            })).status).toBe(200);
            expect((await rawHttpRequest(handle.url, 'GET', '/', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'same-site' },
            })).status).toBe(403);
            // API reads reject same-site (same-host different-port cookie leak), cross-site, none, and empty Origin: ""
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'same-site' },
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'none' },
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, Origin: '' },
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, Origin: 'https://evil.example' },
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, Origin: 'null' },
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'cross-site' },
            })).status).toBe(403);

            // 3. Cross-origin / unknown-origin / empty-Origin browser writes -> 403 BEFORE body read (even with oversized body!)
            const hugeBody = JSON.stringify({ command: 'ping', pad: 'x'.repeat(MAX_ACTION_BODY_BYTES + 4096) });
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://evil.example',
                    'X-Monitor-Session': sessionToken,
                },
                body: hugeBody,
            })).status).toBe(403);

            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: '',
                    Authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(403);

            // Cookie-authenticated POST missing Origin -> 403 (CSRF protection)
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Monitor-Session': sessionToken,
                },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(403);

            // Browser fetch metadata with missing Origin (EVEN when Sec-Fetch-Site is same-origin!) -> 403
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionToken}`,
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'cross-site',
                },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionToken}`,
                    'Sec-Fetch-Site': 'same-origin',
                },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(403);
            expect((await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: {
                    'Content-Type': 'application/json',
                    'Sec-Fetch-Mode': 'cors',
                },
                body: JSON.stringify({ pairingCode: 'a'.repeat(64) }),
            })).status).toBe(403);

            // 4. Auth runs BEFORE Content-Type & body size (unauthenticated oversized non-JSON POST -> 401!)
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'text/plain',
                    Origin: handle.url,
                },
                body: hugeBody,
            })).status).toBe(401);

            // 5. POST requires Content-Type: application/json -> 415 BEFORE body read (charset param is allowed)
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(200);
            for (const badCt of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
                const res = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                    headers: {
                        'Content-Type': badCt,
                        Origin: handle.url,
                        'X-Monitor-Session': sessionToken,
                    },
                    body: JSON.stringify({ command: 'ping' }),
                });
                expect(res.status).toBe(415);
            }
            // Missing Content-Type -> 415
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'ping' }),
            })).status).toBe(415);

            // 6. Hard byte cap returns 413 for BOTH declared Content-Length AND chunked streaming (no Content-Length)
            const declared413 = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: hugeBody,
            });
            expect(declared413.status).toBe(413);

            const chunked413 = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: hugeBody,
                chunked: true,
            });
            expect(chunked413.status).toBe(413);

            // Pairing endpoint also enforces 4KB body cap -> 413
            const bigPair = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: 'a'.repeat(MAX_PAIR_BODY_BYTES + 512) }),
            });
            expect(bigPair.status).toBe(413);
        });

        it('separates minimal capability sets across sdk, standalone, and cdp (and supports provider validateOverlayBridgeAuth)', async () => {
            const seenActions: SidecarActionRequest[] = [];
            const seenOverlay: unknown[] = [];
            const validGrants = new Map<string, string>([
                ['a'.repeat(64), 'http://127.0.0.1:41111'],
                ['b'.repeat(64), 'http://127.0.0.1:42222'],
            ]);

            const provider: SidecarOverlayAwareProvider = {
                version: '1.18.0',
                renderHtml: () => '<!DOCTYPE html><html><body>ok</body></html>',
                getSnapshot: () => ({ time: '10:00:00', tabs: { overview: 'ok' } }),
                handleAction: (action) => {
                    seenActions.push(action);
                    return { ok: true, result: { echo: action.command } };
                },
                validateOverlayBridgeAuth: (token, origin) => {
                    if (!origin) { return false; }
                    return validGrants.get(token) === origin;
                },
                handleOverlayAction: (act) => {
                    seenOverlay.push(act);
                    return { ok: true, result: { handled: act.command } };
                },
            };

            // Scope helper invariants
            expect([...CDP_ALLOWED_OVERLAY_COMMANDS].sort()).toEqual([
                'focusConversation',
                'openPanel',
                'refresh',
                'togglePause',
            ]);
            expect(isCommandAllowedForScope('cdp', 'openPanel')).toBe(true);
            expect(isCommandAllowedForScope('cdp', 'ping')).toBe(false);
            expect(isCommandAllowedForScope('cdp', 'openSidecar')).toBe(false);
            expect(isCommandAllowedForScope('cdp', 'togglePanel')).toBe(false);
            expect(isCommandAllowedForScope('cdp', 'revealPath')).toBe(false);
            expect(isCommandAllowedForScope('standalone', 'refresh')).toBe(true);
            expect(isCommandAllowedForScope('standalone', 'syncHostFocus')).toBe(true);
            expect(isCommandAllowedForScope('standalone', 'registerWorkspaces')).toBe(false);
            for (const sdkOnlyCmd of SDK_ONLY_ACTION_COMMANDS) {
                expect(isCommandAllowedForScope('standalone', sdkOnlyCmd)).toBe(false);
                expect(isCommandAllowedForScope('sdk', sdkOnlyCmd)).toBe(true);
            }

            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0 });
            servers.push(handle);

            // Pair standalone session
            const pairRes = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
            });
            const bearer = pairRes.json().sessionToken as string;

            // Standalone scope rejects SDK-only privileged commands with 403
            for (const cmd of ['applyPluginUpdate', 'revealPath', 'openStateFile', 'setupCdpLauncher']) {
                const res = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: handle.url,
                        Authorization: `Bearer ${bearer}`,
                    },
                    body: JSON.stringify({ command: cmd }),
                });
                expect(res.status).toBe(403);
            }
            expect(seenActions).toHaveLength(0);

            // SDK scope permits SDK-only privileged commands
            const sdkHandler = createSidecarHandler(provider, { isSidecarEnv: true });
            const sdkReveal = await sdkHandler.handleActionPayload({ command: 'revealPath', path: '/tmp/a' }, {
                transport: 'sdk',
                authScope: 'sdk',
                authSubject: 'sdk',
            });
            expect(sdkReveal.status).toBe(200);
            expect(sdkReveal.body.ok).toBe(true);

            // CDP multi-window per-target token+origin binding via validateOverlayBridgeAuth
            // Window 1 token with Window 1 origin -> 200 for all 4 allowed commands
            for (const cmd of ['openPanel', 'refresh', 'togglePause', 'focusConversation']) {
                const res = await rawHttpRequest(handle.url, 'POST', '/api/overlay/action', {
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: 'http://127.0.0.1:41111',
                        'X-Monitor-Token': 'a'.repeat(64),
                    },
                    body: JSON.stringify({ command: cmd, ...(cmd === 'focusConversation' ? { conversationId: 'conv-main', focusRevision: 1 } : {}) }),
                });
                expect(res.status).toBe(200);
            }

            // Window 1 token with Window 2 origin -> 401 (origin mismatch!)
            expect((await rawHttpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:42222',
                    'X-Monitor-Token': 'a'.repeat(64),
                },
                body: JSON.stringify({ command: 'refresh' }),
            })).status).toBe(401);

            // Revoking Window 2 grant immediately blocks Window 2 token
            validGrants.delete('b'.repeat(64));
            expect((await rawHttpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:42222',
                    'X-Monitor-Token': 'b'.repeat(64),
                },
                body: JSON.stringify({ command: 'refresh' }),
            })).status).toBe(401);

            // CDP rejects non-allowlisted commands with 403 (including legacy ping/openSidecar/togglePanel & privileged cmds)
            for (const forbidden of ['ping', 'openSidecar', 'togglePanel', 'setAppSetting', 'revealPath', 'syncHostFocus', 'registerWorkspaces']) {
                const res = await rawHttpRequest(handle.url, 'POST', '/api/overlay/action', {
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: 'http://127.0.0.1:41111',
                        'X-Monitor-Token': 'a'.repeat(64),
                    },
                    body: JSON.stringify({ command: forbidden }),
                });
                expect(res.status).toBe(403);
            }

            // CDP enforces Content-Type: application/json (415) and 16KB body limit (413)
            expect((await rawHttpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'text/plain',
                    Origin: 'http://127.0.0.1:41111',
                    'X-Monitor-Token': 'a'.repeat(64),
                },
                body: JSON.stringify({ command: 'refresh' }),
            })).status).toBe(415);

            expect((await rawHttpRequest(handle.url, 'POST', '/api/overlay/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'http://127.0.0.1:41111',
                    'X-Monitor-Token': 'a'.repeat(64),
                },
                body: JSON.stringify({ command: 'refresh', pad: 'z'.repeat(MAX_OVERLAY_ACTION_BODY_BYTES + 256) }),
            })).status).toBe(413);
        });

        it('eliminates pre-dispatch side effects on GET/generic POST and validates syncHostFocus & registerWorkspaces (including empty [])', async () => {
            const receivedQueries: Array<Record<string, unknown>> = [];
            const receivedRenderCtxs: Array<Record<string, unknown>> = [];
            const receivedActions: SidecarActionRequest[] = [];

            const provider: SidecarOverlayAwareProvider = {
                version: '1.18.0',
                renderHtml: (ctx) => {
                    receivedRenderCtxs.push({ ...ctx });
                    return '<!DOCTYPE html><html><body>ok</body></html>';
                },
                getSnapshot: (query: SidecarSnapshotQuery) => {
                    receivedQueries.push({ ...query });
                    return { time: '10:00:00', tabs: { overview: 'ok' } };
                },
                handleAction: (action) => {
                    receivedActions.push({ ...action });
                    return { ok: true, result: { accepted: true, ackFocusRevision: action.focusRevision ?? 0 } };
                },
            };

            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0 });
            servers.push(handle);
            const pairRes = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
            });
            const bearer = pairRes.json().sessionToken as string;
            const headers = { 'Content-Type': 'application/json', Origin: handle.url, Authorization: `Bearer ${bearer}` };

            // 1. GET / and GET /api/snapshot NEVER forward conversationId or workspaceUris
            await rawHttpRequest(handle.url, 'GET', '/?conversationId=hijack&workspaceUris=["file:///etc"]', {
                headers: { Authorization: `Bearer ${bearer}` },
            });
            expect(receivedRenderCtxs[0]).not.toHaveProperty('conversationId');
            expect(receivedRenderCtxs[0]).not.toHaveProperty('workspaceUris');

            await rawHttpRequest(
                handle.url,
                'GET',
                '/api/snapshot?conversationId=hijack&workspaceUris=%5B%22file%3A%2F%2F%2Fetc%22%5D&pinnedConversationId=p1&lockToMainAgent=true&conversationCleared=1&windowId=win-1&active=1',
                { headers: { Authorization: `Bearer ${bearer}` } },
            );
            expect(receivedQueries[0]).toEqual({
                viewMode: 'standalone',
                windowId: 'win-1',
                userActive: true,
                authScope: 'standalone',
            });

            // 2. Generic actions (ping, refresh, calendarExportCsv, updateSetting) strip piggybacked conversationId & workspaceUris
            for (const cmd of ['ping', 'refresh', 'calendarExportCsv', 'updateSetting']) {
                const res = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                    headers,
                    body: JSON.stringify({
                        command: cmd,
                        conversationId: 'hijack-conv',
                        workspaceUris: ['file:///etc/passwd'],
                        focusRevision: 99,
                        key: 'pollingInterval',
                        value: 5,
                    }),
                });
                expect(res.status).toBe(200);
            }
            expect(receivedActions).toHaveLength(4);
            for (const act of receivedActions) {
                expect(act).not.toHaveProperty('conversationId');
                expect(act).not.toHaveProperty('workspaceUris');
                expect(act).not.toHaveProperty('focusRevision');
            }

            // 3. Dedicated syncHostFocus validates focusRevision and strips workspaceUris
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers,
                body: JSON.stringify({ command: 'syncHostFocus', conversationId: 'conv-1' }), // missing focusRevision
            })).status).toBe(400);
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers,
                body: JSON.stringify({ command: 'syncHostFocus', conversationId: 'conv-1', focusRevision: -1 }),
            })).status).toBe(400);

            receivedActions.length = 0;
            const focusOk = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers,
                body: JSON.stringify({
                    command: 'syncHostFocus',
                    conversationId: 'conv-77',
                    focusRevision: 3,
                    backendEpoch: 2,
                    windowId: 'win-abc',
                    sourceInstanceId: 'inst-xyz',
                    viewMode: 'aux',
                    workspaceUris: ['file:///must-be-stripped'],
                }),
            });
            expect(focusOk.status).toBe(200);
            expect(receivedActions[0]).toEqual({
                command: 'syncHostFocus',
                conversationId: 'conv-77',
                focusRevision: 3,
                backendEpoch: 2,
                windowId: 'win-abc',
                sourceInstanceId: 'inst-xyz',
                viewMode: 'aux',
            });

            // Only the SDK host can register/revoke local workspace roots.
            expect((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers, body: JSON.stringify({ command: 'registerWorkspaces', workspaceUris: [] }),
            })).status).toBe(403);
            const sdk = createSidecarHandler(provider, { isSidecarEnv: true });
            expect((await sdk.handleActionPayload({ command: 'registerWorkspaces', workspaceUris: 'not-an-array' })).status).toBe(400);
            receivedActions.length = 0;
            const wsRevoke = await sdk.handleActionPayload({
                command: 'registerWorkspaces', workspaceUris: [], windowId: 'win-abc',
                conversationId: 'must-be-stripped',
            });
            expect(wsRevoke.status).toBe(200);
            expect(receivedActions[0]).toEqual({
                command: 'registerWorkspaces',
                workspaceUris: [],
                windowId: 'win-abc',
            });
        });

        it('returns bodyless HTTP 304 on ETag hit, SDK 200 unchanged sentinel, and varies ETag on subject/viewMode/lang/privacy/includeHtml/dataRevision', async () => {
            let privacyMasked = true;
            let dataRevision = 10;
            const provider: SidecarOverlayAwareProvider = {
                version: '1.18.0',
                renderHtml: () => '<!DOCTYPE html><html><body>ok</body></html>',
                getSnapshot: (q) => ({
                    time: '10:00:00',
                    language: (q as { lang?: 'en' | 'zh' | 'both' }).lang || 'en',
                    privacyMasked,
                    tabs: { overview: `<div>rev-${dataRevision}-${privacyMasked}</div>` },
                    meta: { dataRevision, privacyMasked },
                }),
                handleAction: () => ({
                    ok: true,
                    // Intentionally return an unwrapped internal provider hash to verify sidecar-server
                    // ALWAYS wraps it into the subject/view/lang/privacy-bound validator ETag!
                    hash: 'unwrapped-provider-internal-hash',
                    snapshot: {
                        time: '10:00:00',
                        language: 'en',
                        privacyMasked,
                        tabs: { overview: `<div>rev-${dataRevision}-${privacyMasked}</div>` },
                        meta: { dataRevision, privacyMasked },
                    },
                }),
            };

            // Direct validator sensitivity checks
            const baseSnap: SidecarSnapshotPayload = {
                time: '10:00:00',
                language: 'en',
                privacyMasked: true,
                tabs: { overview: '<div>a</div>' },
                meta: { dataRevision: 1, pollCount: 1 },
            };
            const baseCtx = {
                authScope: 'standalone' as const,
                authSubject: 'sess-1',
                viewMode: 'aux' as const,
                effectiveLanguage: 'en',
                includeHtml: false,
            };
            const hBase = computeSnapshotValidatorEtag(baseSnap, baseCtx);
            // pollCount increment keeps ETag stable
            expect(computeSnapshotValidatorEtag({ ...baseSnap, meta: { dataRevision: 1, pollCount: 99 } }, baseCtx)).toBe(hBase);
            // Changing ANY security/display dimension MUST invalidate ETag
            expect(computeSnapshotValidatorEtag(baseSnap, { ...baseCtx, authSubject: 'sess-2' })).not.toBe(hBase);
            expect(computeSnapshotValidatorEtag(baseSnap, { ...baseCtx, viewMode: 'sidebar' })).not.toBe(hBase);
            expect(computeSnapshotValidatorEtag(baseSnap, { ...baseCtx, effectiveLanguage: 'zh' })).not.toBe(hBase);
            expect(computeSnapshotValidatorEtag({ ...baseSnap, privacyMasked: false }, baseCtx)).not.toBe(hBase);
            expect(computeSnapshotValidatorEtag(baseSnap, { ...baseCtx, includeHtml: true })).not.toBe(hBase);
            expect(computeSnapshotValidatorEtag({ ...baseSnap, meta: { dataRevision: 2 } }, baseCtx)).not.toBe(hBase);

            // Live HTTP 304 vs SDK 200 unchanged
            const handle = await startStandaloneServer(provider, { host: '127.0.0.1', port: 0 });
            servers.push(handle);
            const pairRes = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
            });
            const bearer = pairRes.json().sessionToken as string;

            const s1 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux&lang=en', {
                headers: { Authorization: `Bearer ${bearer}` },
            });
            expect(s1.status).toBe(200);
            const etag1 = s1.headers.etag as string;
            expect(etag1).toBe(`"${s1.json().hash}"`);

            // HTTP ETag hit -> bodyless 304 Not Modified
            const s304 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux&lang=en', {
                headers: { Authorization: `Bearer ${bearer}`, 'If-None-Match': etag1 },
            });
            expect(s304.status).toBe(304);
            expect(s304.text).toBe('');
            expect(s304.headers.etag).toBe(etag1);

            // Switching privacyMasked invalidates ETag -> 200 fresh response
            privacyMasked = false;
            const sUnmasked = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux&lang=en', {
                headers: { Authorization: `Bearer ${bearer}`, 'If-None-Match': etag1 },
            });
            expect(sUnmasked.status).toBe(200);
            expect(sUnmasked.headers.etag).not.toBe(etag1);

            // POST /api/action MUST overwrite unwrapped provider hash with subject-bound validator ETag
            // so the very next GET /api/snapshot with that hash hits HTTP 304!
            const postRefresh = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: {
                    'Content-Type': 'application/json',
                    Origin: handle.url,
                    Authorization: `Bearer ${bearer}`,
                },
                body: JSON.stringify({ command: 'refresh', viewMode: 'aux' }),
            });
            expect(postRefresh.status).toBe(200);
            const postHash = postRefresh.json().hash as string;
            expect(postHash).not.toBe('unwrapped-provider-internal-hash');
            expect(postHash).toBe(sUnmasked.json().hash);

            const afterPost304 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?viewMode=aux&lang=en', {
                headers: { Authorization: `Bearer ${bearer}`, 'If-None-Match': `"${postHash}"` },
            });
            expect(afterPost304.status).toBe(304);
            expect(afterPost304.text).toBe('');

            // SDK adapter returns documented 200 { unchanged: true, hash }
            const sdkHandler = createSidecarHandler(provider, { isSidecarEnv: true });
            const sdk1 = await sdkHandler.handleSnapshotQuery({ viewMode: 'aux', lang: 'en' }, undefined, {
                transport: 'sdk',
                authScope: 'sdk',
                authSubject: 'sdk',
            });
            expect(sdk1.status).toBe(200);
            const sdkHash = (sdk1.body as { hash: string }).hash;
            const sdk2 = await sdkHandler.handleSnapshotQuery({ viewMode: 'aux', lang: 'en', etag: sdkHash }, undefined, {
                transport: 'sdk',
                authScope: 'sdk',
                authSubject: 'sdk',
            });
            expect(sdk2.status).toBe(200);
            expect(sdk2.body).toEqual({ unchanged: true, hash: sdkHash });
        });
    });


    describe('host-bridge.ts: window.message validation, SDK precedence, syncHostFocus/registerWorkspaces, HTTP 304 & ordering', () => {
        function createBridgeHarness(options: {
            withSidecarApi?: boolean;
            initialGetterConvId?: string;
            urlSearch?: string;
            autoPoll?: boolean;
        } = {}) {
            const winListeners: Record<string, Array<(ev: any) => void>> = {};
            const docListeners: Record<string, Array<(ev: any) => void>> = {};
            const timers = new Map<number, { id: number; fn: () => void; delay: number }>();
            let nextTimerId = 1;

            const fetchCalls: Array<{ url: string; opts: any; resolve: (v: any) => void; reject: (e: any) => void }> = [];
            const dispatchedMessages: Array<{ ev: any; data: any }> = [];

            let getterConvId = options.initialGetterConvId ?? '';
            let convChangeCb: ((next: any) => void) | null = null;
            let wsChangeCb: ((uris: string[]) => void) | null = null;

            const storage = new Map<string, string>();

            class FakeMessageEvent {
                type: string;
                data: any;
                origin: string;
                source: any;
                constructor(type: string, init?: { data?: any; origin?: string; source?: any }) {
                    this.type = type;
                    this.data = init?.data;
                    this.origin = init?.origin ?? '';
                    this.source = init?.source ?? null;
                }
            }
            class FakeCustomEvent {
                type: string;
                detail: any;
                constructor(type: string, init?: { detail?: any }) {
                    this.type = type;
                    this.detail = init?.detail;
                }
            }

            const docStub: any = {
                hidden: false,
                readyState: 'complete',
                documentElement: {
                    style: {
                        props: {} as Record<string, string>,
                        getPropertyValue(k: string) { return this.props[k] || ''; },
                        setProperty(k: string, v: string) { this.props[k] = v; },
                    },
                },
                body: {
                    attrs: { 'data-acm-view': 'aux' } as Record<string, string>,
                    getAttribute(k: string) { return this.attrs[k] ?? null; },
                    setAttribute(k: string, v: string) { this.attrs[k] = v; },
                    classList: { toggle: () => {} },
                },
                getElementById: () => null,
                addEventListener: (t: string, fn: (ev: any) => void) => { (docListeners[t] ||= []).push(fn); },
            };

            const fetchImpl = (url: string, opts: any = {}) => new Promise((resolve, reject) => {
                fetchCalls.push({ url, opts, resolve, reject });
            });

            const sidecarApi = options.withSidecarApi ? {
                get conversationId() { return getterConvId; },
                onConversationChange: (cb: (next: any) => void) => { convChangeCb = cb; },
                getWorkspaceUris: async () => ['file:///initial-ws'],
                onWorkspaceChange: (cb: (uris: string[]) => void) => { wsChangeCb = cb; },
                fetch: fetchImpl,
            } : undefined;

            const winStub: any = {
                location: {
                    origin: 'http://127.0.0.1:49999',
                    href: `http://127.0.0.1:49999/${options.urlSearch || ''}`,
                    pathname: '/',
                    search: options.urlSearch || '',
                    reload: vi.fn(),
                    replace: vi.fn(),
                },
                sessionStorage: {
                    getItem: (k: string) => storage.get(k) ?? null,
                    setItem: (k: string, v: string) => { storage.set(k, v); },
                },
                sidecar: sidecarApi,
                addEventListener: (t: string, fn: (ev: any) => void) => { (winListeners[t] ||= []).push(fn); },
                dispatchEvent: (ev: any) => {
                    if (ev?.type === 'message') {
                        dispatchedMessages.push({ ev, data: ev.data });
                    }
                    for (const fn of winListeners[ev?.type] || []) { fn(ev); }
                    return true;
                },
                fetch: fetchImpl,
                MessageEvent: FakeMessageEvent,
                CustomEvent: FakeCustomEvent,
            };
            winStub.window = winStub;

            const ctx = vm.createContext({
                window: winStub,
                document: docStub,
                URL,
                URLSearchParams,
                Promise,
                WeakSet,
                Math,
                Number,
                String,
                Boolean,
                Array,
                Object,
                JSON,
                Error,
                Date,
                Uint8Array,
                MessageEvent: FakeMessageEvent,
                CustomEvent: FakeCustomEvent,
                navigator: {},
                setTimeout: (fn: () => void, delay: number) => {
                    const id = nextTimerId++;
                    timers.set(id, { id, fn, delay });
                    return id;
                },
                clearTimeout: (id: number) => { timers.delete(id); },
            });
            vm.runInContext(getHostBridgeScript({ pollIntervalMs: 4000, autoPoll: options.autoPoll ?? false }), ctx);

            const flushMicrotasks = async () => {
                for (let i = 0; i < 8; i++) { await Promise.resolve(); }
            };

            return {
                win: winStub,
                doc: docStub,
                bridge: winStub.__ACM_BRIDGE__,
                fetchCalls,
                dispatchedMessages,
                timers,
                winListeners,
                setGetterConvId: (id: string) => { getterConvId = id; },
                fireConvChange: (next: any) => { convChangeCb?.(next); },
                fireWorkspaceChange: (uris: string[]) => { wsChangeCb?.(uris); },
                flushMicrotasks,
            };
        }

        it('rejects cross-origin and foreign-window messages while enforcing SDK callback precedence over stale getters and initial URL', async () => {
            const h = createBridgeHarness({
                withSidecarApi: true,
                initialGetterConvId: 'conv-stale-getter',
                urlSearch: '?conversationId=conv-initial-url',
            });
            await h.flushMicrotasks();

            // Drain initial startup focus & workspace requests
            while (h.fetchCalls.length > 0) {
                const c = h.fetchCalls.shift()!;
                const parsed = JSON.parse(c.opts.body || '{}');
                c.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: true, result: { accepted: true, ackFocusRevision: parsed.focusRevision ?? 1 } }),
                });
            }
            await h.flushMicrotasks();
            expect(h.bridge.getConversationId()).toBe('conv-stale-getter');

            // 1. Cross-origin & foreign-source window.message MUST be ignored
            const evilWin = {};
            for (const badEv of [
                { type: 'message', source: evilWin, origin: 'https://evil.example', data: { type: 'conversation-change', conversationId: 'conv-evil' } },
                { type: 'message', source: evilWin, origin: 'http://127.0.0.1:49999', data: { type: 'conversation-change', conversationId: 'conv-evil-sameorigin' } },
                { type: 'message', source: h.win, origin: 'https://evil.example', data: { type: 'conversation-change', conversationId: 'conv-evil-origin' } },
                { type: 'message', source: h.win, origin: 'null', data: { type: 'conversation-change', conversationId: 'conv-null-origin' } },
                { type: 'message', source: evilWin, origin: 'https://evil.example', data: { type: 'theme-change', payload: { cssVariables: { '--background': '#ff0000' } } } },
            ]) {
                for (const fn of h.winListeners.message || []) { fn(badEv); }
            }
            expect(h.bridge.getConversationId()).toBe('conv-stale-getter');
            expect(h.doc.documentElement.style.props['--background']).toBeUndefined();
            expect(h.fetchCalls).toHaveLength(0);

            // 2. Newer SDK onConversationChange callback outranks stale non-empty getter!
            h.fireConvChange('conv-newer-cb');
            expect(h.bridge.getConversationId()).toBe('conv-newer-cb');

            // 3. Clearing via callback ('') ALSO outranks stale non-empty getter AND NEVER reverts to initialUrlConversationId!
            h.fireConvChange('');
            expect(h.bridge.getConversationId()).toBe('');

            // 4. Only if getter itself genuinely changes to a brand-new ID does it take effect
            h.setGetterConvId('conv-fresh-getter');
            expect(h.bridge.getConversationId()).toBe('conv-fresh-getter');
        });

        it('sends focus ONLY via syncHostFocus POST with focusRevision ack/retry and workspaces ONLY via registerWorkspaces POST (including [])', async () => {
            const h = createBridgeHarness({ withSidecarApi: true, initialGetterConvId: 'conv-1' });
            await h.flushMicrotasks();

            // Startup emits syncHostFocus (rev 1) + registerWorkspaces(['file:///initial-ws'])
            const startupBodies = h.fetchCalls.map((c) => JSON.parse(c.opts.body));
            expect(startupBodies.some((b) => b.command === 'syncHostFocus' && b.conversationId === 'conv-1' && b.focusRevision === 1)).toBe(true);
            expect(startupBodies.some((b) => b.command === 'registerWorkspaces' && JSON.stringify(b.workspaceUris) === '["file:///initial-ws"]')).toBe(true);

            // Acknowledge startup calls
            while (h.fetchCalls.length > 0) {
                const c = h.fetchCalls.shift()!;
                const b = JSON.parse(c.opts.body);
                c.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        ok: true,
                        result: { accepted: true, ackFocusRevision: b.focusRevision ?? 1, backendEpoch: 7 },
                    }),
                });
            }
            await h.flushMicrotasks();
            expect(h.bridge.getFocusSyncState().ackedFocusRevision).toBe(1);
            expect(h.bridge.getFocusSyncState().backendEpoch).toBe(7);
            expect(h.bridge.getFocusSyncState().pendingFocusEvent).toBeNull();

            // Trigger focus change to conv-2 -> sends syncHostFocus rev 2 with backendEpoch/windowId/sourceInstanceId
            h.fireConvChange('conv-2');
            await h.flushMicrotasks();
            expect(h.fetchCalls).toHaveLength(1);
            const firstAttempt = h.fetchCalls.shift()!;
            const focusBody1 = JSON.parse(firstAttempt.opts.body);
            expect(focusBody1).toMatchObject({
                command: 'syncHostFocus',
                conversationId: 'conv-2',
                focusRevision: 2,
                backendEpoch: 7,
                viewMode: 'aux',
            });
            expect(focusBody1.windowId).toBeTruthy();
            expect(focusBody1.sourceInstanceId).toBeTruthy();

            // Server replies with STALE ackFocusRevision: 1 -> pending MUST NOT clear and MUST schedule idempotent retry!
            firstAttempt.resolve({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { accepted: false, ackFocusRevision: 1, backendEpoch: 7 } }),
            });
            await h.flushMicrotasks();
            expect(h.bridge.getFocusSyncState().pendingFocusEvent?.focusRevision).toBe(2);
            expect(h.timers.size).toBe(1);

            // Fire retry timer -> resends EXACT same focusRevision: 2 (idempotent retry)
            const retryTimer = [...h.timers.values()][0];
            h.timers.delete(retryTimer.id);
            retryTimer.fn();
            await h.flushMicrotasks();
            expect(h.fetchCalls).toHaveLength(1);
            const secondAttempt = h.fetchCalls.shift()!;
            expect(JSON.parse(secondAttempt.opts.body).focusRevision).toBe(2);

            // Server now acknowledges matching ackFocusRevision: 2 -> pending clears cleanly!
            secondAttempt.resolve({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { accepted: true, ackFocusRevision: 2, backendEpoch: 7 } }),
            });
            await h.flushMicrotasks();
            expect(h.bridge.getFocusSyncState().pendingFocusEvent).toBeNull();
            expect(h.bridge.getFocusSyncState().ackedFocusRevision).toBe(2);

            // Workspace revocation: onWorkspaceChange([]) sends registerWorkspaces with explicit []!
            h.fireWorkspaceChange([]);
            await h.flushMicrotasks();
            const wsIdx = h.fetchCalls.findIndex((c) => c.opts.method === 'POST' && JSON.parse(c.opts.body).command === 'registerWorkspaces');
            expect(wsIdx).toBeGreaterThanOrEqual(0);
            const wsCall = h.fetchCalls.splice(wsIdx, 1)[0];
            expect(JSON.parse(wsCall.opts.body)).toMatchObject({
                command: 'registerWorkspaces',
                workspaceUris: [],
            });
            wsCall.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });

            // Resolve any automatic snapshot poll kicked off by onWorkspaceChange and verify GET URL is strictly read-only
            while (h.fetchCalls.length > 0) {
                const pendingPoll = h.fetchCalls.shift()!;
                expect(pendingPoll.url).toContain('/api/snapshot?');
                expect(pendingPoll.url).not.toContain('conversationId');
                expect(pendingPoll.url).not.toContain('workspaceUris');
                pendingPoll.resolve({ ok: true, status: 200, json: async () => ({ unchanged: true, hash: 'h0' }) });
            }
            await h.flushMicrotasks();

            // Network-error idempotent retry + superseded newer focusRevision flush
            h.fireConvChange('conv-3');
            await h.flushMicrotasks();
            const rev3Attempt1 = h.fetchCalls.shift()!;
            expect(JSON.parse(rev3Attempt1.opts.body)).toMatchObject({ command: 'syncHostFocus', conversationId: 'conv-3', focusRevision: 3 });
            // While rev 3 is in-flight, user switches again to conv-4 (rev 4); rev 3 fails with network error -> rev 4 flushes immediately!
            h.fireConvChange('conv-4');
            rev3Attempt1.reject(new Error('transient disconnect'));
            await h.flushMicrotasks();
            const rev4Call = h.fetchCalls.shift()!;
            expect(JSON.parse(rev4Call.opts.body)).toMatchObject({ command: 'syncHostFocus', conversationId: 'conv-4', focusRevision: 4 });
            rev4Call.resolve({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { accepted: true, ackFocusRevision: 4, backendEpoch: 7 } }),
            });
            await h.flushMicrotasks();
            expect(h.bridge.getFocusSyncState().pendingFocusEvent).toBeNull();
            expect(h.bridge.getFocusSyncState().ackedFocusRevision).toBe(4);

            // Explicit pollNow & generic POST /api/action NEVER carry conversationId or workspaceUris!
            const pollP = h.bridge.pollNow(true);
            const pollCall = h.fetchCalls.shift()!;
            expect(pollCall.url).toContain('/api/snapshot?');
            expect(pollCall.url).not.toContain('conversationId');
            expect(pollCall.url).not.toContain('workspaceUris');
            pollCall.resolve({ ok: true, status: 200, json: async () => ({ unchanged: false, hash: 'h1', snapshot: { tabs: { overview: '1' } } }) });
            await pollP;

            const pingP = h.bridge.sendAction({ command: 'ping' });
            const pingCall = h.fetchCalls.shift()!;
            const pingBody = JSON.parse(pingCall.opts.body);
            expect(pingBody).not.toHaveProperty('conversationId');
            expect(pingBody).not.toHaveProperty('workspaceUris');
            pingCall.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
            await pingP;
        });

        it('keeps the most recent focus pending across an unaccepted future acknowledgement', async () => {
            const h = createBridgeHarness({ withSidecarApi: true, initialGetterConvId: 'main-first' });
            await h.flushMicrotasks();
            const first = h.fetchCalls.find(c => JSON.parse(c.opts.body).command === 'syncHostFocus')!;
            h.fireConvChange('main-second');
            first.resolve({ ok: true, json: async () => ({
                ok: true, result: { accepted: false, ackFocusRevision: 8, backendEpoch: 2 },
            }) });
            await h.flushMicrotasks();
            const pending = h.bridge.getFocusSyncState().pendingFocusEvent;
            expect(pending).toMatchObject({ conversationId: 'main-second', focusRevision: 2 });
            const second = h.fetchCalls.find(c => JSON.parse(c.opts.body).focusRevision === 2)!;
            expect(JSON.parse(second.opts.body)).toMatchObject({ backendEpoch: 2, fromSdkCallback: true });
        });

        it('discards an old export and a pending GET immediately when privacy is requested', async () => {
            const h = createBridgeHarness({ withSidecarApi: false });
            const output = h.bridge.sendAction({ command: 'calendarExportJson' });
            const poll = h.bridge.pollNow(true);
            const change = h.bridge.sendAction({ command: 'setPrivacyMask', masked: true });
            const [oldExport, oldGet, mask] = h.fetchCalls;
            oldExport.resolve({ ok: true, json: async () => ({ ok: true, content: 'private data' }) });
            oldGet.resolve({ ok: true, json: async () => ({ unchanged: false, snapshot: { tabs: { overview: 'private data' } } }) });
            expect(await output).toEqual({ ok: false });
            expect(await poll).toBeNull();
            expect(h.dispatchedMessages).toHaveLength(0);
            mask.resolve({ ok: true, json: async () => ({ ok: true }) });
            await change;
        });

        it('handles bodyless HTTP 304 without JSON decode errors and suppresses out-of-order stale GET & POST responses', async () => {
            const h = createBridgeHarness({ withSidecarApi: false, autoPoll: false });
            const appliedTabs: string[] = [];
            h.bridge.onSnapshot((snap: any) => {
                appliedTabs.push(snap?.tabs?.overview || '');
            });

            // 1. Initial GET -> 200 (gen 1)
            const p1 = h.bridge.pollNow(true);
            const c1 = h.fetchCalls.shift()!;
            c1.resolve({
                ok: true,
                status: 200,
                json: async () => ({ unchanged: false, hash: 'etag-v1', snapshot: { tabs: { overview: 'v1' } } }),
            });
            await p1;
            expect(appliedTabs).toEqual(['v1']);

            // 2. Subsequent GET receives HTTP 304 Not Modified (res.json() throws if ever called!)
            const p304 = h.bridge.pollNow(false);
            const c304 = h.fetchCalls.shift()!;
            expect(c304.opts.headers['If-None-Match']).toBe('"etag-v1"');
            const jsonShouldNotBeCalled = vi.fn(() => { throw new Error('Should not decode JSON on 304'); });
            c304.resolve({
                ok: false, // standard Fetch API: res.ok is false for 304!
                status: 304,
                headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? '"etag-v1"' : null) },
                json: jsonShouldNotBeCalled,
            });
            const res304 = await p304;
            expect(jsonShouldNotBeCalled).not.toHaveBeenCalled();
            expect(res304).toMatchObject({ unchanged: true, hash: 'etag-v1' });
            expect(appliedTabs).toEqual(['v1']);

            // 3. Out-of-order suppression: slow GET (gen 3) starts, then POST (gen 4) completes first -> stale GET MUST NOT overwrite!
            const slowGetP = h.bridge.pollNow(true);
            const slowGetCall = h.fetchCalls.shift()!;

            const fastPostP = h.bridge.sendAction({ command: 'refresh' });
            const fastPostCall = h.fetchCalls.shift()!;

            fastPostCall.resolve({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, hash: 'etag-post-newer', snapshot: { tabs: { overview: 'v2-from-post' } } }),
            });
            await fastPostP;
            expect(appliedTabs).toEqual(['v1', 'v2-from-post']);

            // Now resolve older slow GET -> MUST be discarded!
            slowGetCall.resolve({
                ok: true,
                status: 200,
                json: async () => ({ unchanged: false, hash: 'etag-stale-get', snapshot: { tabs: { overview: 'v-stale-get' } } }),
            });
            await slowGetP;
            expect(appliedTabs).toEqual(['v1', 'v2-from-post']);

            // 4. Out-of-order POST suppression: slow POST #1 (gen 5) starts, fast POST #2 (gen 6) completes first -> stale POST #1 MUST NOT overwrite!
            const slowPost1 = h.bridge.sendAction({ command: 'selectConversation', conversationId: 'old' });
            const slowPost1Call = h.fetchCalls.shift()!;
            const fastPost2 = h.bridge.sendAction({ command: 'selectConversation', conversationId: 'new' });
            const fastPost2Call = h.fetchCalls.shift()!;

            fastPost2Call.resolve({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, hash: 'etag-new', snapshot: { tabs: { overview: 'v3-new' } } }),
            });
            await fastPost2;
            expect(appliedTabs).toEqual(['v1', 'v2-from-post', 'v3-new']);

            slowPost1Call.resolve({
                ok: true,
                status: 200,
                json: async () => ({ ok: true, hash: 'etag-old', snapshot: { tabs: { overview: 'v-stale-post' } } }),
            });
            await slowPost1;
            expect(appliedTabs).toEqual(['v1', 'v2-from-post', 'v3-new']);
        });
    });


    describe('webview-script.ts: window.message channel validation & privacy unmask/re-mask purge', () => {
        function createWebviewScriptHarness(opts: {
            withHostBridge?: boolean;
            initialMasked?: boolean;
            persistedStateMasked?: boolean;
        } = {}) {
            const winListeners: Record<string, Array<(ev: any) => void>> = {};
            const bodyListeners: Record<string, Array<(ev: any) => void>> = {};
            const postedToHost: any[] = [];
            let state: Record<string, any> = {
                privacyMasked: opts.persistedStateMasked !== undefined ? opts.persistedStateMasked : (opts.initialMasked ?? true),
            };
            let clearedBridgeCaches = 0;

            class MiniNode {
                id = '';
                tagName: string;
                className = '';
                attrs: Record<string, string> = {};
                dataset: Record<string, string> = {};
                textContent = '';
                innerHTML = '';
                hidden = false;
                value = '';
                defaultValue = '';
                style: Record<string, string> = {};
                children: MiniNode[] = [];
                parentElement: MiniNode | null = null;
                classList = {
                    set: new Set<string>(),
                    add: (c: string) => { this.classList.set.add(c); },
                    remove: (c: string) => { this.classList.set.delete(c); },
                    toggle: (c: string, f?: boolean) => {
                        const next = f !== undefined ? !!f : !this.classList.set.has(c);
                        if (next) { this.classList.set.add(c); } else { this.classList.set.delete(c); }
                        return next;
                    },
                    contains: (c: string) => this.classList.set.has(c),
                };
                constructor(tag = 'DIV') { this.tagName = tag.toUpperCase(); }
                setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
                getAttribute(k: string) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
                removeAttribute(k: string) { delete this.attrs[k]; }
                hasAttribute(k: string) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
                appendChild(c: MiniNode) { c.parentElement = this; this.children.push(c); return c; }
                addEventListener(t: string, fn: (e: any) => void) { (bodyListeners[t] ||= []).push(fn); }
                closest(sel: string): MiniNode | null {
                    if (sel === '#privacyToggle' && this.id === 'privacyToggle') { return this; }
                    if (sel === '#profileBillingDaySaveBtn' && this.id === 'profileBillingDaySaveBtn') { return this; }
                    if (sel === '.acct-delete-btn' && this.classList.contains('acct-delete-btn')) { return this; }
                    return this.parentElement ? this.parentElement.closest(sel) : null;
                }
                querySelector(_sel: string): MiniNode | null { return null; }
                querySelectorAll(_sel: string): MiniNode[] { return []; }
                contains() { return false; }
            }

            const body = new MiniNode('body');
            body.setAttribute('data-privacy-default', 'true');
            body.setAttribute('data-privacy-masked', String(opts.initialMasked ?? true));

            const overviewPane = new MiniNode('div');
            overviewPane.id = 'tab-overview';
            overviewPane.innerHTML = '<div>initial-safe</div>';

            const privacyBtn = new MiniNode('button');
            privacyBtn.id = 'privacyToggle';
            privacyBtn.setAttribute('aria-pressed', String(opts.initialMasked ?? true));

            const revealedEmailNode = new MiniNode('span');
            revealedEmailNode.className = 'acct-email';
            revealedEmailNode.setAttribute('data-masked', 'a***@e***.com');
            revealedEmailNode.setAttribute('data-privacy-sensitive', 'true');
            revealedEmailNode.textContent = 'alice@example.com';

            const rawJsonNode = new MiniNode('pre');
            rawJsonNode.id = 'rawJsonContent';
            rawJsonNode.textContent = '{"email":"alice@example.com"}';

            const popBody = new MiniNode('div');
            popBody.id = 'acctPopoverBody';
            popBody.innerHTML = '<div>alice@example.com</div>';

            const billingInput = new MiniNode('input');
            billingInput.id = 'profileBillingDayInput';
            billingInput.setAttribute('data-account-handle', 'acct_opaque_01');
            billingInput.value = '15';

            const billingSaveBtn = new MiniNode('button');
            billingSaveBtn.id = 'profileBillingDaySaveBtn';

            const acctDeleteBtn = new MiniNode('button');
            acctDeleteBtn.classList.add('acct-delete-btn');
            acctDeleteBtn.setAttribute('data-account-handle', 'acct_opaque_02');

            const byId: Record<string, MiniNode> = {
                'tab-overview': overviewPane,
                privacyToggle: privacyBtn,
                rawJsonContent: rawJsonNode,
                acctPopoverBody: popBody,
                profileBillingDayInput: billingInput,
                profileBillingDaySaveBtn: billingSaveBtn,
            };

            const docStub: any = {
                body,
                documentElement: new MiniNode('html'),
                activeElement: null,
                createElement: (tag: string) => new MiniNode(tag),
                getElementById: (id: string) => byId[id] || null,
                querySelector: (sel: string) => {
                    if (sel === '#tab-overview') { return overviewPane; }
                    return null;
                },
                querySelectorAll: (sel: string) => {
                    if (sel === '[data-masked]') { return [revealedEmailNode]; }
                    if (sel.includes('[data-privacy-sensitive]')) { return [revealedEmailNode]; }
                    if (sel === '[data-email]') { return []; }
                    return [];
                },
                addEventListener: () => {},
            };

            const trustedEvents = new WeakSet<object>();
            const bridgeStub = opts.withHostBridge ? {
                surface: 'standalone',
                isTrustedHostEvent: (ev: any) => !!(ev && typeof ev === 'object' && trustedEvents.has(ev)),
                clearClientCaches: () => { clearedBridgeCaches += 1; },
                asVsCodeApi: () => ({
                    getState: () => state,
                    setState: (s: any) => { state = s; },
                    postMessage: (m: any) => { postedToHost.push(m); },
                }),
            } : null;

            const winStub: any = {
                location: { origin: 'http://127.0.0.1:49999', href: 'http://127.0.0.1:49999/' },
                __ACM_BRIDGE__: bridgeStub,
                scrollY: 0,
                scrollTo: () => {},
                innerWidth: 600,
                innerHeight: 600,
                addEventListener: (t: string, fn: (ev: any) => void) => { (winListeners[t] ||= []).push(fn); },
                removeEventListener: () => {},
                requestAnimationFrame: (fn: () => void) => { fn(); return 1; },
                setTimeout: () => 1,
                clearTimeout: () => {},
            };
            winStub.window = winStub;
            winStub.parent = {};

            const ctx = vm.createContext({
                window: winStub,
                document: docStub,
                Element: MiniNode,
                URL,
                Map,
                Set,
                Array,
                Object,
                JSON,
                Number,
                String,
                Boolean,
                Math,
                isFinite,
                parseInt,
                parseFloat,
                navigator: {},
                console,
                requestAnimationFrame: winStub.requestAnimationFrame,
                setTimeout: winStub.setTimeout,
                clearTimeout: winStub.clearTimeout,
                acquireVsCodeApi: () => ({
                    getState: () => state,
                    setState: (s: any) => { state = s; },
                    postMessage: (m: any) => { postedToHost.push(m); },
                }),
            });
            vm.runInContext(getScript(), ctx);

            const dispatchWinMessage = (ev: any, markTrusted = false) => {
                if (markTrusted) { trustedEvents.add(ev); }
                for (const fn of winListeners.message || []) { fn(ev); }
            };
            const clickNode = (node: MiniNode) => {
                for (const fn of bodyListeners.click || []) {
                    fn({ target: node, preventDefault: () => {}, stopPropagation: () => {} });
                }
            };

            return {
                win: winStub,
                body,
                overviewPane,
                privacyBtn,
                revealedEmailNode,
                rawJsonNode,
                popBody,
                billingSaveBtn,
                acctDeleteBtn,
                postedToHost,
                getState: () => state,
                getClearedBridgeCaches: () => clearedBridgeCaches,
                dispatchWinMessage,
                clickNode,
            };
        }

        it('rejects untrusted cross-origin and spoofed window.message attempts to inject tab HTML', () => {
            // 1. Standalone/Sidecar mode with active host-bridge
            const hBridge = createWebviewScriptHarness({ withHostBridge: true });

            // Cross-origin attacker attempt -> REJECTED
            hBridge.dispatchWinMessage({
                origin: 'https://evil.example',
                source: {},
                data: { command: 'updateTabs', tabs: { overview: '<img src=x onerror=alert(1)>' } },
            }, false);
            expect(hBridge.overviewPane.innerHTML).toBe('<div>initial-safe</div>');

            // Same-origin spoofed message NOT originating from host-bridge -> REJECTED
            hBridge.dispatchWinMessage({
                origin: 'http://127.0.0.1:49999',
                source: hBridge.win,
                data: { command: 'updateTabs', tabs: { overview: '<div id="spoofed">spoof</div>' } },
            }, false);
            expect(hBridge.overviewPane.innerHTML).toBe('<div>initial-safe</div>');

            // Legitimate host-bridge trusted event -> ACCEPTED
            hBridge.dispatchWinMessage({
                origin: 'http://127.0.0.1:49999',
                source: hBridge.win,
                data: { command: 'updateTabs', tabs: { overview: '<div>trusted-update</div>' } },
            }, true);
            expect(hBridge.overviewPane.innerHTML).toBe('<div>trusted-update</div>');

            // 2. VS Code webview mode (no host-bridge) STILL rejects cross-origin, null-origin, and foreign-source messages
            const hVscode = createWebviewScriptHarness({ withHostBridge: false });
            hVscode.dispatchWinMessage({
                origin: 'https://evil.example',
                source: {},
                data: { command: 'updateTabs', tabs: { overview: '<div>xss-cross-origin</div>' } },
            });
            hVscode.dispatchWinMessage({
                origin: 'null',
                source: hVscode.win,
                data: { command: 'updateTabs', tabs: { overview: '<div>xss-null-origin</div>' } },
            });
            hVscode.dispatchWinMessage({
                origin: 'http://127.0.0.1:49999',
                source: {}, // foreign window
                data: { command: 'updateTabs', tabs: { overview: '<div>xss-foreign-source</div>' } },
            });
            expect(hVscode.overviewPane.innerHTML).toBe('<div>initial-safe</div>');
        });

        it('requests host re-render on privacy unmask, purges revealed DOM & caches immediately on re-mask, and sends opaque accountHandle', () => {
            const h = createWebviewScriptHarness({ withHostBridge: true, initialMasked: true });
            h.postedToHost.length = 0;

            // 1. Click #privacyToggle to UNMASK -> posts setPrivacyMask { masked: false } to host (no data-real dependency!)
            h.clickNode(h.privacyBtn);
            expect(h.getState().privacyMasked).toBe(false);
            expect(h.postedToHost).toContainEqual({ command: 'setPrivacyMask', masked: false, privacyMasked: false });

            // Simulate host re-rendering unmasked tab HTML
            h.dispatchWinMessage({
                origin: 'http://127.0.0.1:49999',
                source: h.win,
                data: { command: 'updateTabs', tabs: { overview: '<div>alice@example.com</div>' }, privacyMasked: false },
            }, true);
            expect(h.overviewPane.innerHTML).toBe('<div>alice@example.com</div>');
            h.revealedEmailNode.textContent = 'alice@example.com';
            h.rawJsonNode.textContent = '{"email":"alice@example.com"}';
            h.popBody.innerHTML = '<div>alice@example.com</div>';

            // 2. Click #privacyToggle to RE-MASK -> immediately scrubs revealed DOM, clears caches, and notifies host!
            h.postedToHost.length = 0;
            h.clickNode(h.privacyBtn);
            expect(h.getState().privacyMasked).toBe(true);
            expect(h.revealedEmailNode.textContent).toBe('a***@e***.com');
            expect(h.rawJsonNode.textContent).toBe('');
            expect(h.popBody.innerHTML).not.toContain('alice@example.com');
            expect(h.getClearedBridgeCaches()).toBeGreaterThanOrEqual(1);
            expect(h.postedToHost).toContainEqual({ command: 'setPrivacyMask', masked: true, privacyMasked: true });

            // 3. Billing day save & account delete read opaque data-account-handle (zero data-email needed!)
            h.postedToHost.length = 0;
            h.clickNode(h.billingSaveBtn);
            expect(h.postedToHost).toContainEqual({ command: 'setAccountBillingDay', day: 15, accountHandle: 'acct_opaque_01' });

            h.postedToHost.length = 0;
            h.clickNode(h.acctDeleteBtn);
            expect(h.postedToHost).toContainEqual({ command: 'removeAccount', accountHandle: 'acct_opaque_02' });

            // 4. Reload fail-closed sync: stale persisted state { privacyMasked: false } MUST yield to
            // authoritative host <body data-privacy-masked="true"> at startup!
            const reloaded = createWebviewScriptHarness({
                withHostBridge: true,
                initialMasked: true,
                persistedStateMasked: false,
            });
            expect(reloaded.body.getAttribute('data-privacy-masked')).toBe('true');
            expect(reloaded.getState().privacyMasked).toBe(true);
            expect(reloaded.privacyBtn.getAttribute('aria-pressed')).toBe('true');
            expect(reloaded.privacyBtn.classList.contains('active')).toBe(true);

            // First click cleanly requests unmask (no desynced double-toggle!)
            reloaded.postedToHost.length = 0;
            reloaded.clickNode(reloaded.privacyBtn);
            expect(reloaded.body.getAttribute('data-privacy-masked')).toBe('false');
            expect(reloaded.getState().privacyMasked).toBe(false);
            expect(reloaded.postedToHost).toContainEqual({ command: 'setPrivacyMask', masked: false, privacyMasked: false });
        });
    });
});

describe('[app-sidecar-server]', () => {
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
            expect(css).toContain('body[data-acm-theme="hc-light"]');
            expect(css).toContain('--ed-good: #005A32;');
            expect(css).toContain('--ed-warn: #7A4F01;');
            expect(css).toContain('--ed-chart-cache: #005A32;');
            expect(css).toContain('body[data-acm-view="aux"]');
            expect(css).toContain('body[data-acm-view="sidebar"]');
            expect(css).toContain('@media (max-width: 520px)');
            expect(css).toContain('@media (min-width: 900px)');
            expect(css).toContain('#nativeHudHost');
            expect(css).toContain('.stg-form-grid');
            // Guard against dangling comma syntax errors before @media
            expect(css).not.toMatch(/,\s*@media/);
        });

        it('overrides Antigravity /preload.js inline body background/color while preserving host CSS variables', () => {
            const css = getThemeAdapterStyles();
            // Dedicated body[data-acm-surface="app-sidecar"] rule (not :root) must force --ed-bg / --ed-ink
            // so /preload.js inline body.style.background/color fallbacks (#fafafa/#333) cannot cause low contrast
            // in Dark or High-Contrast modes when host --background is unset.
            expect(css).toMatch(
                /(?:^|\n)\s*body\[data-acm-surface="app-sidecar"\]\s*\{\s*background:\s*var\(--ed-bg\)\s*!important;\s*color:\s*var\(--ed-ink\)\s*!important;\s*\}/,
            );
            // Each theme polarity must still respect host --background / --foreground when pushed via theme-change.
            expect(css).toMatch(/body\[data-acm-theme="dark"\][\s\S]*?--ed-bg:\s*var\(--background,\s*#0D1014\);[\s\S]*?--ed-ink:\s*var\(--foreground,\s*#F2F4F8\);/);
            expect(css).toMatch(/body\[data-acm-theme="light"\][\s\S]*?--ed-bg:\s*var\(--background,\s*#FAFBFC\);[\s\S]*?--ed-ink:\s*var\(--foreground,\s*#111318\);/);
            expect(css).toMatch(/body\[data-acm-theme="hc"\][\s\S]*?--ed-bg:\s*var\(--background,\s*#000000\);[\s\S]*?--ed-ink:\s*var\(--foreground,\s*#FFFFFF\);/);
            expect(css).toMatch(/body\[data-acm-theme="hc-light"\][\s\S]*?--ed-bg:\s*var\(--background,\s*#FFFFFF\);[\s\S]*?--ed-ink:\s*var\(--foreground,\s*#000000\);/);
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

        it('serves pairing shell, one-time pairing, /, /full, /api/health, /api/snapshot HTTP 304, and /api/action', async () => {
            let counter = 1;
            let lastSeenQuery: Record<string, unknown> = {};
            let renderHtmlCalls = 0;
            const provider: SidecarProvider = {
                version: '1.17.5',
                renderHtml(ctx) {
                    renderHtmlCalls += 1;
                    return `<!DOCTYPE html><html><head><title>ACM ${ctx.viewMode}</title></head><body><main>${ctx.pathname}</main></body></html>`;
                },
                getSnapshot(query): SidecarSnapshotPayload {
                    lastSeenQuery = { ...query };
                    return {
                        time: '12:00:00',
                        activeConversationId: 'conv-default',
                        tabs: { overview: `<div>v${counter}</div>` },
                    };
                },
                handleAction(action) {
                    if (action.command === 'refresh') {
                        counter += 1;
                        return {
                            ok: true,
                            result: { counter },
                            snapshot: { time: '12:00:01', tabs: { overview: `<div>v${counter}</div>` } },
                        };
                    }
                    if (action.command === 'togglePause') {
                        throw new Error('secret internal stack /Users/private/token.txt');
                    }
                    return { ok: false, statusCode: 400, error: `Unknown action: ${action.command}` };
                },
            };

            const handle = await startStandaloneServer(provider, { port: 0, host: '127.0.0.1' });
            handles.push(handle);
            expect(handle.host).toBe('127.0.0.1');
            expect(handle.port).toBeGreaterThan(0);
            expect(handle.bootstrapPairing?.code).toMatch(/^[a-f0-9]{64}$/);

            // Unpaired GET / and /full return inert pairing shell without invoking provider.renderHtml
            const unpairedRoot = await httpRequest(handle.url, 'GET', '/');
            expect(unpairedRoot.status).toBe(200);
            expect(unpairedRoot.headers['content-type']).toContain('text/html');
            expect(unpairedRoot.text).toContain('data-acm-paired="false"');
            expect(unpairedRoot.text).not.toContain('ACM standalone');
            expect(unpairedRoot.text).not.toContain(handle.bootstrapPairing!.code);
            expect(renderHtmlCalls).toBe(0);

            // Unauthenticated GET /api/snapshot & POST /api/action -> 401
            const unauthSnap = await httpRequest(handle.url, 'GET', '/api/snapshot');
            expect(unauthSnap.status).toBe(401);
            const unauthAct = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ command: 'refresh' }),
            });
            expect(unauthAct.status).toBe(401);

            // Pair once via POST /api/auth/pair -> issues origin-bound session + burns single-use code
            const pairRes = await httpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
            });
            expect(pairRes.status).toBe(200);
            const pairBody = pairRes.json();
            expect(pairBody.ok).toBe(true);
            expect(pairBody.paired).toBe(true);
            expect(pairRes.headers['set-cookie']).toBeUndefined();
            const sessionToken = pairBody.sessionToken as string;
            const authHeaders = { 'X-Monitor-Session': sessionToken, Origin: handle.url };

            // Replaying burned pairing code -> 401
            const replayPair = await httpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: handle.bootstrapPairing!.code }),
            });
            expect(replayPair.status).toBe(401);

            // Authenticated GET /
            const rootRes = await httpRequest(handle.url, 'GET', '/', { headers: { 'X-Monitor-Session': sessionToken } });
            expect(rootRes.status).toBe(200);
            expect(rootRes.headers['content-type']).toContain('text/html');
            expect(rootRes.text).toContain('data-acm-host-bridge="true"');
            expect(rootRes.text).toContain('data-acm-theme-adapter="true"');
            expect(rootRes.text).toContain('data-acm-view="standalone"');

            // Authenticated GET /full
            const fullRes = await httpRequest(handle.url, 'GET', '/full', { headers: { 'X-Monitor-Session': sessionToken } });
            expect(fullRes.status).toBe(200);
            expect(fullRes.text).toContain('ACM sidebar');
            expect(fullRes.text).toContain('data-acm-view="sidebar"');

            // GET /api/health (minimal metadata)
            const healthRes = await httpRequest(handle.url, 'GET', '/api/health');
            expect(healthRes.status).toBe(200);
            expect(healthRes.json()).toMatchObject({
                ok: true,
                version: '1.17.5',
                surface: 'app-sidecar',
                pid: process.pid,
                mode: 'standalone',
                pairingRequired: true,
            });

            // GET /api/snapshot (initial) — MUST NOT forward conversationId / workspaceUris / lockToMainAgent!
            const snap1 = await httpRequest(
                handle.url,
                'GET',
                '/api/snapshot?conversationId=conv-42&workspaceUris=%5B%22file%3A%2F%2F%2Ftmp%2Frepo%22%5D&lockToMainAgent=true',
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(snap1.status).toBe(200);
            const snap1Body = snap1.json();
            expect(snap1Body.unchanged).toBe(false);
            expect(typeof snap1Body.hash).toBe('string');
            expect(snap1Body.snapshot.activeConversationId).toBe('conv-default');
            expect(snap1.headers.etag).toBe(`"${snap1Body.hash}"`);
            expect(lastSeenQuery).not.toHaveProperty('conversationId');
            expect(lastSeenQuery).not.toHaveProperty('workspaceUris');
            expect(lastSeenQuery).not.toHaveProperty('lockToMainAgent');
            expect(lastSeenQuery).toMatchObject({ viewMode: 'standalone', authScope: 'standalone' });

            // GET /api/snapshot with matching ?etag= -> bodyless HTTP 304 Not Modified with ETag header
            const snap2 = await httpRequest(
                handle.url,
                'GET',
                `/api/snapshot?etag=${encodeURIComponent(snap1Body.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(snap2.status).toBe(304);
            expect(snap2.text).toBe('');
            expect(snap2.headers.etag).toBe(`"${snap1Body.hash}"`);

            // GET /api/snapshot with matching If-None-Match header -> bodyless HTTP 304 Not Modified
            const snap2Header = await httpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, 'If-None-Match': `"${snap1Body.hash}"` },
            });
            expect(snap2Header.status).toBe(304);
            expect(snap2Header.text).toBe('');
            expect(snap2Header.headers.etag).toBe(`"${snap1Body.hash}"`);

            // POST /api/action (valid mutating command)
            const actOk = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'refresh' }),
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
                `/api/snapshot?etag=${encodeURIComponent(snap1Body.hash)}`,
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            expect(snap3.status).toBe(200);
            const snap3Body = snap3.json();
            expect(snap3Body.unchanged).toBe(false);
            expect(snap3Body.hash).not.toBe(snap1Body.hash);

            // POST /api/action invalid JSON -> 400
            const badJson = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: '{not-valid-json',
            });
            expect(badJson.status).toBe(400);
            expect(badJson.json()).toEqual({ ok: false, error: 'Invalid JSON body' });

            // POST /api/action missing command -> 400
            const noCmd = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ foo: 'bar' }),
            });
            expect(noCmd.status).toBe(400);
            expect(noCmd.json().ok).toBe(false);

            // New commands are excluded from standalone until explicitly granted.
            const unknownCmd = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'doesNotExist' }),
            });
            expect(unknownCmd.status).toBe(403);
            expect(unknownCmd.json()).toMatchObject({ ok: false });

            // POST /api/action wrong Content-Type -> 415
            const wrongCt = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'text/plain', ...authHeaders },
                body: JSON.stringify({ command: 'refresh' }),
            });
            expect(wrongCt.status).toBe(415);

            // POST /api/action oversized body (>256KB) -> 413
            const huge = JSON.stringify({ command: 'refresh', pad: 'x'.repeat(MAX_ACTION_BODY_BYTES + 1024) });
            const tooBig = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: huge,
            });
            expect(tooBig.status).toBe(413);
            expect(tooBig.json().ok).toBe(false);

            // POST /api/action provider throw -> 500 without leaking secret message or stack trace
            const exploded = await httpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ command: 'togglePause' }),
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

        it('renders SidecarApp mode with /preload.js and returns SDK 200 unchanged sentinel via createSidecarHandler', async () => {
            const provider = createFallbackSidecarProvider({ version: '1.17.5' });
            const handler = createSidecarHandler(provider, { isSidecarEnv: true, version: '1.17.5' });

            const aux = await handler.renderPage('aux', '/?conversationId=c1');
            expect(aux.status).toBe(200);
            expect(aux.body).toContain('<script src="/preload.js"></script>');
            expect(aux.body).toContain('data-acm-view="aux"');

            const sidebar = await handler.renderPage('sidebar', '/full');
            expect(sidebar.body).toContain('data-acm-view="sidebar"');

            const sdkSnap1 = await handler.handleSnapshotQuery({ viewMode: 'aux' }, undefined, {
                transport: 'sdk',
                authScope: 'sdk',
                authSubject: 'sdk',
            });
            expect(sdkSnap1.status).toBe(200);
            expect(sdkSnap1.body && !sdkSnap1.body.unchanged ? sdkSnap1.body.hash : '').toMatch(/^[a-f0-9]{32}$/);
            const hash1 = (sdkSnap1.body as { hash: string }).hash;

            const sdkSnap2 = await handler.handleSnapshotQuery({ viewMode: 'aux', etag: hash1 }, undefined, {
                transport: 'sdk',
                authScope: 'sdk',
                authSubject: 'sdk',
            });
            expect(sdkSnap2.status).toBe(200);
            expect(sdkSnap2.body).toEqual({ unchanged: true, hash: hash1 });

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
            fs.writeFileSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }));
            fs.writeFileSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'main.mjs'), 'export {};');
            fs.writeFileSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js'), 'module.exports = {};', 'utf8');
            fs.writeFileSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'), 'module.exports = {};', 'utf8');
            fs.writeFileSync(path.join(fakeSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'), 'module.exports = {};', 'utf8');

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
});

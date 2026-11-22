import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CDP_COMPOSER_HOST_ID,
    CDP_RUNTIME_GLOBAL_KEY,
    CDP_TOPBAR_HOST_ID,
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    buildOverlayUpdateScript,
    getComposerOverlayCss,
    getTopBarOverlayCss,
    safeJsonForScript,
} from '../src/app/cdp-overlay-assets';
import {
    CdpWebSocketClient,
    WS_OPCODE,
    WebSocketFrameDecoder,
    computeWebSocketAcceptKey,
    createCdpAmbientOverlayManager,
    createOverlayActionBridge,
    discoverDevToolsActivePort,
    encodeWebSocketFrame,
    getCdpPlatformGuide,
    isLoopbackUrl,
    parseDevToolsActivePortContent,
    resolveDevToolsActivePortPaths,
    selectAntigravityHubTarget,
    validateOverlayBridgeRequest,
    type CdpClientLike,
    type CdpTargetInfo,
} from '../src/app/cdp-injector';
import type { CdpOverlayBridgeAction, CdpOverlayPayload } from '../src/app/sidecar-types';

function makeSamplePayload(overrides: Partial<CdpOverlayPayload> = {}): CdpOverlayPayload {
    return {
        updatedAt: '14:25:08',
        nextRefreshSec: 5,
        language: 'both',
        theme: 'dark',
        modelName: 'Gemini 4 Carbon (High)',
        contextUsedTokens: 241_000,
        contextEffectiveLimit: 256_000,
        contextNativeLimit: 1_000_000,
        contextPct: 94.1,
        compactionThresholdPct: 85,
        tier200kMarkerPct: 78.1,
        outputSpeedTps: 36.9,
        avgOutputSpeedTps: 34.2,
        isShortSample: false,
        isWaitingTtft: false,
        ttftMs: 1240,
        recentCacheHitPct: 99,
        avgCacheHitPct: 96,
        turnCacheState: 'warm',
        estCostUsd: 13.04,
        estCostFormatted: '$13.04',
        localCostFormatted: '¥94.50',
        inputTokens: 12_400,
        outputTokens: 4_200,
        cacheReadTokens: 182_000,
        totalTokens: 198_600,
        cumulativeRecordedTokens: 927_600_000,
        tightestQuotaPct: 80,
        tightestQuotaWindowTag: '5h',
        sessionQuota5hPct: 80,
        sessionQuota5hReset: '3h 42m',
        sessionQuotaWeeklyPct: 68,
        sessionQuotaWeeklyReset: '4d 6h',
        quotaPools: [
            {
                poolKey: 'carbon-pool',
                label: 'Gemini 4 Carbon / Argon',
                modelChips: ['Carbon High', 'Argon High', 'Orchestrator (Carbon)'],
                remainingPct: 80,
                windowTag: '5h',
                resetCountdown: '3h 42m',
                isCurrentSessionModel: true,
                health: 'good',
            },
            {
                poolKey: 'claude-pool',
                label: 'Claude Opus / Sonnet',
                modelChips: ['Claude Opus 4.6', 'Claude Sonnet 4.6'],
                remainingPct: 18,
                windowTag: '5h',
                resetCountdown: '1h 12m',
                health: 'danger',
            },
        ],
        ...overrides,
    };
}

// ─── Minimal Synthetic DOM + Shadow DOM Harness for Script Verification ──────

class FakeElement {
    readonly nodeType = 1;
    readonly tagName: string;
    id = '';
    className = '';
    textContent = '';
    parentNode: FakeElement | null = null;
    childNodes: FakeElement[] = [];
    shadowRoot: FakeElement | null = null;
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    listeners = new Map<string, Array<(ev: unknown) => void>>();
    type = '';

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    get parentElement(): FakeElement | null { return this.parentNode; }
    get firstChild(): FakeElement | null { return this.childNodes[0] ?? null; }
    get firstElementChild(): FakeElement | null { return this.childNodes.find(n => n.nodeType === 1) ?? null; }
    get isConnected(): boolean {
        let cur: FakeElement | null = this;
        while (cur) {
            if (cur.tagName === 'BODY' || cur.tagName === 'HTML') { return true; }
            cur = cur.parentNode;
        }
        return false;
    }

    get classList() {
        const self = this;
        const list = () => self.className.split(/\s+/).filter(Boolean);
        return {
            add(...names: string[]) {
                const cur = new Set(list());
                for (const n of names) { if (n) { cur.add(n); } }
                self.className = [...cur].join(' ');
            },
            remove(...names: string[]) {
                const cur = new Set(list());
                for (const n of names) { cur.delete(n); }
                self.className = [...cur].join(' ');
            },
            toggle(name: string, force?: boolean) {
                const cur = new Set(list());
                const next = force !== undefined ? force : !cur.has(name);
                if (next) { cur.add(name); } else { cur.delete(name); }
                self.className = [...cur].join(' ');
                return next;
            },
            contains(name: string) {
                return list().includes(name);
            },
        };
    }

    appendChild(child: FakeElement): FakeElement {
        if (child.parentNode) { child.parentNode.removeChild(child); }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    insertBefore(child: FakeElement, ref: FakeElement | null): FakeElement {
        if (child.parentNode) { child.parentNode.removeChild(child); }
        child.parentNode = this;
        if (!ref) {
            this.childNodes.push(child);
            return child;
        }
        const idx = this.childNodes.indexOf(ref);
        if (idx < 0) {
            this.childNodes.push(child);
        } else {
            this.childNodes.splice(idx, 0, child);
        }
        return child;
    }

    removeChild(child: FakeElement): FakeElement {
        const idx = this.childNodes.indexOf(child);
        if (idx >= 0) { this.childNodes.splice(idx, 1); }
        child.parentNode = null;
        return child;
    }

    setAttribute(name: string, value: string): void {
        if (name === 'id') { this.id = value; }
        if (name === 'class') { this.className = value; }
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        if (name === 'id') { return this.id || null; }
        if (name === 'class') { return this.className || null; }
        return this.attributes.get(name) ?? null;
    }

    attachShadow(_opts: { mode: string }): FakeElement {
        this.shadowRoot = new FakeElement('#shadow-root');
        return this.shadowRoot;
    }

    addEventListener(type: string, fn: (ev: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, fn: (ev: unknown) => void): void {
        const list = this.listeners.get(type);
        if (!list) { return; }
        const idx = list.indexOf(fn);
        if (idx >= 0) { list.splice(idx, 1); }
    }

    getBoundingClientRect() {
        return { top: 400, left: 600, right: 626, bottom: 426, width: 26, height: 26 };
    }

    private _matchesSimple(sel: string): boolean {
        const s = sel.trim();
        if (!s) { return false; }
        if (s.startsWith('.')) {
            return this.classList.contains(s.slice(1));
        }
        if (s.startsWith('#')) {
            return this.id === s.slice(1);
        }
        const attrMatch = s.match(/^\[([a-zA-Z0-9_-]+)(?:(\*?)=["']([^"']+)["'])?\]$/);
        if (attrMatch) {
            const val = this.getAttribute(attrMatch[1]);
            if (val === null) { return false; }
            if (!attrMatch[3]) { return true; }
            return attrMatch[2] === '*' ? val.includes(attrMatch[3]) : val === attrMatch[3];
        }
        return this.tagName === s.toUpperCase();
    }

    matches(selector: string): boolean {
        return selector.split(',').some(part => this._matchesSimple(part));
    }

    querySelectorAll(selector: string): FakeElement[] {
        const out: FakeElement[] = [];
        const walk = (node: FakeElement) => {
            for (const c of node.childNodes) {
                if (c.matches(selector)) { out.push(c); }
                walk(c);
            }
        };
        walk(this);
        return out;
    }

    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    collectText(): string {
        const parts: string[] = [];
        if (this.textContent) { parts.push(this.textContent); }
        for (const c of this.childNodes) {
            parts.push(c.collectText());
        }
        return parts.filter(Boolean).join(' ');
    }
}

function createFakeDomContext(options: { innerWidth?: number; userAgent?: string } = {}) {
    const html = new FakeElement('html');
    const body = new FakeElement('body');
    html.appendChild(body);

    const footer = new FakeElement('div');
    footer.className = 'agy-composer-footer';
    const footerGroup = new FakeElement('div');
    const turboBtn = new FakeElement('button');
    turboBtn.textContent = 'Turbo';
    footerGroup.appendChild(turboBtn);
    footer.appendChild(footerGroup);
    body.appendChild(footer);

    const titlebar = new FakeElement('div');
    titlebar.setAttribute('data-testid', 'pane-titlebar-toolbar');
    const auxBtn = new FakeElement('button');
    auxBtn.setAttribute('data-testid', 'toggle-aux-sidebar');
    titlebar.appendChild(auxBtn);
    body.appendChild(titlebar);

    const doc = {
        documentElement: html,
        body,
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        createTextNode: (text: string) => {
            const t = new FakeElement('#text');
            t.textContent = text;
            return t;
        },
        getElementById: (id: string) => {
            const walk = (node: FakeElement): FakeElement | null => {
                if (node.id === id) { return node; }
                for (const c of node.childNodes) {
                    const hit = walk(c);
                    if (hit) { return hit; }
                }
                return null;
            };
            return walk(html);
        },
        querySelector: (sel: string) => html.querySelector(sel),
        querySelectorAll: (sel: string) => html.querySelectorAll(sel),
        addEventListener: () => {},
        removeEventListener: () => {},
    };

    const win: Record<string, unknown> = {
        innerWidth: options.innerWidth ?? 1440,
        innerHeight: 900,
        addEventListener: () => {},
        removeEventListener: () => {},
        getComputedStyle: () => ({ backgroundColor: 'rgb(13, 16, 20)' }),
        matchMedia: () => ({ matches: false }),
    };

    const sandbox: Record<string, unknown> = {
        window: win,
        document: doc,
        navigator: {
            userAgent: options.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
            platform: options.userAgent?.includes('Windows') ? 'Win32' : 'MacIntel',
        },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        fetch: vi.fn().mockResolvedValue({ ok: true }),
    };
    win.window = win;
    const ctx = vm.createContext(sandbox);
    return { ctx, win, doc, footerGroup, turboBtn, titlebar, auxBtn };
}

describe('App Opt-In CDP Ambient Overlays & Pure-Node WebSocket Client', () => {
    const servers: http.Server[] = [];
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cdp-test-'));
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve) => {
            s.closeAllConnections();
            s.close(() => resolve());
        })));
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Cross-platform DevToolsActivePort discovery & platform launch guides', () => {
        it('resolves exact DevToolsActivePort paths on macOS, Windows, and Linux', () => {
            expect(resolveDevToolsActivePortPaths({
                platform: 'darwin',
                homedir: '/Users/alice',
                env: {},
            })).toEqual(['/Users/alice/Library/Application Support/Antigravity/DevToolsActivePort']);

            expect(resolveDevToolsActivePortPaths({
                platform: 'win32',
                homedir: 'C:\\Users\\Alice',
                env: { APPDATA: 'D:\\RoamingData' },
            })).toEqual([
                'D:\\RoamingData\\Antigravity\\DevToolsActivePort',
                'C:\\Users\\Alice\\AppData\\Roaming\\Antigravity\\DevToolsActivePort',
            ]);

            expect(resolveDevToolsActivePortPaths({
                platform: 'linux',
                homedir: '/home/alice',
                env: { XDG_CONFIG_HOME: '/home/alice/.xdg' },
            })).toEqual(['/home/alice/.xdg/Antigravity/DevToolsActivePort']);

            expect(resolveDevToolsActivePortPaths({
                platform: 'linux',
                homedir: '/home/alice',
                env: {},
            })).toEqual(['/home/alice/.config/Antigravity/DevToolsActivePort']);
        });

        it('parses valid DevToolsActivePort payloads and rejects malformed entries', () => {
            expect(parseDevToolsActivePortContent('\uFEFF9222\r\n/devtools/browser/abc-123\r\n')).toEqual({
                port: 9222,
                wsPath: '/devtools/browser/abc-123',
            });
            expect(parseDevToolsActivePortContent('0\n/devtools/browser/abc')).toBeNull();
            expect(parseDevToolsActivePortContent('70000\n/devtools/browser/abc')).toBeNull();
            expect(parseDevToolsActivePortContent('9222\nrelative/no-slash')).toBeNull();
            expect(parseDevToolsActivePortContent('9222\n')).toBeNull();
            expect(parseDevToolsActivePortContent('')).toBeNull();
        });

        it('discovers DevToolsActivePort from disk and returns null silently when absent', () => {
            const portFile = path.join(tempDir, 'DevToolsActivePort');
            expect(discoverDevToolsActivePort({ explicitPaths: [portFile] })).toBeNull();

            fs.writeFileSync(portFile, '61234\n/devtools/browser/test-uuid\n', 'utf8');
            expect(discoverDevToolsActivePort({ explicitPaths: [portFile] })).toEqual({
                port: 61234,
                wsPath: '/devtools/browser/test-uuid',
                filePath: portFile,
            });
        });

        it('provides concise zero-patch launch guides for macOS, Windows, and Linux', () => {
            for (const plat of ['darwin', 'win32', 'linux'] as const) {
                const guide = getCdpPlatformGuide(plat);
                expect(guide.platform).toBe(plat);
                expect(guide.command).toContain('--remote-debugging-port=0');
                expect(guide.en.length).toBeGreaterThan(20);
                expect(guide.zh.length).toBeGreaterThan(15);
            }
        });
    });

    describe('Antigravity Hub target filtering (loopback only)', () => {
        it('selects only the Antigravity Hub loopback page and ignores unrelated or sidecar targets', () => {
            const targets: CdpTargetInfo[] = [
                {
                    id: 'ext',
                    type: 'page',
                    title: 'GitHub',
                    url: 'https://github.com/AGI-is-going-to-arrive',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ext',
                },
                {
                    id: 'devtools',
                    type: 'page',
                    title: 'DevTools',
                    url: 'devtools://devtools/bundled/inspector.html',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/devtools',
                },
                {
                    id: 'sidecar',
                    type: 'page',
                    title: 'Antigravity Context Monitor',
                    url: 'http://127.0.0.1:53760/',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/sidecar',
                },
                {
                    id: 'worker',
                    type: 'service_worker',
                    title: 'Antigravity Hub SW',
                    url: 'https://127.0.0.1:62501/sw.js',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/worker/1',
                },
                {
                    id: 'hub',
                    type: 'page',
                    title: 'Antigravity',
                    url: 'https://127.0.0.1:62501/',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/hub',
                },
            ];

            const selected = selectAntigravityHubTarget(targets, { excludePorts: [53760] });
            expect(selected?.id).toBe('hub');

            // Never touches external pages if Hub isn't present
            expect(selectAntigravityHubTarget([targets[0], targets[1], targets[3]])).toBeNull();
            expect(isLoopbackUrl('https://evil.example.com/')).toBe(false);
            expect(isLoopbackUrl('ws://127.0.0.1:9222/devtools/page/1', ['ws:'])).toBe(true);
        });
    });

    describe('Pure-Node RFC 6455 WebSocket framing & live loopback CDP handshake', () => {
        it('encodes and decodes short, 16-bit, and 64-bit frames with masking and arbitrary chunk splits', () => {
            const decoder = new WebSocketFrameDecoder();
            const small = Buffer.from('{"id":1,"result":{"ok":true}}', 'utf8');
            const medium = Buffer.alloc(1024, 0x41);
            const large = Buffer.alloc(70_000, 0x42);

            const f1 = encodeWebSocketFrame({ opcode: WS_OPCODE.TEXT, payload: small, mask: true });
            const f2 = encodeWebSocketFrame({ opcode: WS_OPCODE.BINARY, payload: medium, mask: true });
            const f3 = encodeWebSocketFrame({ opcode: WS_OPCODE.BINARY, payload: large, mask: false });

            // Verify client mask bit is set on masked frames
            expect((f1[1] & 0x80) !== 0).toBe(true);
            expect((f3[1] & 0x80) !== 0).toBe(false);

            const combined = Buffer.concat([f1, f2, f3]);
            const decoded: Array<{ opcode: number; payload: Buffer }> = [];
            // Feed in uneven tiny chunks to stress streaming boundary handling
            for (let offset = 0; offset < combined.length; offset += 7) {
                decoded.push(...decoder.push(combined.subarray(offset, Math.min(combined.length, offset + 7))));
            }
            expect(decoded).toHaveLength(3);
            expect(decoded[0].opcode).toBe(WS_OPCODE.TEXT);
            expect(decoded[0].payload.equals(small)).toBe(true);
            expect(decoded[1].payload.equals(medium)).toBe(true);
            expect(decoded[2].payload.equals(large)).toBe(true);
        });

        it('reassembles fragmented messages while delivering interleaved PING control frames', () => {
            const decoder = new WebSocketFrameDecoder();
            const part1 = encodeWebSocketFrame({ opcode: WS_OPCODE.TEXT, payload: Buffer.from('hello '), fin: false, mask: false });
            const ping = encodeWebSocketFrame({ opcode: WS_OPCODE.PING, payload: Buffer.from('hb'), fin: true, mask: false });
            const part2 = encodeWebSocketFrame({ opcode: WS_OPCODE.CONTINUATION, payload: Buffer.from('world'), fin: true, mask: false });

            const msgs = decoder.push(Buffer.concat([part1, ping, part2]));
            expect(msgs).toHaveLength(2);
            expect(msgs[0]).toEqual({ opcode: WS_OPCODE.PING, payload: Buffer.from('hb') });
            expect(msgs[1].opcode).toBe(WS_OPCODE.TEXT);
            expect(msgs[1].payload.toString('utf8')).toBe('hello world');
        });

        it('rejects oversized frames and unexpected continuation frames', () => {
            const smallLimitDecoder = new WebSocketFrameDecoder(64);
            const bigFrame = encodeWebSocketFrame({ opcode: WS_OPCODE.TEXT, payload: Buffer.alloc(128, 0x61), mask: false });
            expect(() => smallLimitDecoder.push(bigFrame)).toThrow(/exceeds maximum/);

            const freshDecoder = new WebSocketFrameDecoder();
            const strayCont = encodeWebSocketFrame({ opcode: WS_OPCODE.CONTINUATION, payload: Buffer.from('x'), mask: false });
            expect(() => freshDecoder.push(strayCont)).toThrow(/continuation/i);
        });

        it('connects to a real local WebSocket server, verifies Sec-WebSocket-Accept, auto-pongs, and runs Runtime.evaluate', async () => {
            const pongsReceived: string[] = [];
            const upgradedSockets = new Set<import('stream').Duplex>();
            const srv = http.createServer((_req, res) => {
                res.writeHead(426);
                res.end();
            });
            srv.on('clientError', (_err, sock) => { sock.destroy(); });
            srv.on('upgrade', (req, socket) => {
                socket.on('error', () => {});
                upgradedSockets.add(socket);
                socket.on('close', () => upgradedSockets.delete(socket));
                const key = req.headers['sec-websocket-key'];
                if (typeof key !== 'string') {
                    socket.destroy();
                    return;
                }
                const accept = req.url?.includes('bad-accept')
                    ? 'INVALID_ACCEPT_KEY'
                    : computeWebSocketAcceptKey(key);
                socket.write(
                    'HTTP/1.1 101 Switching Protocols\r\n'
                    + 'Upgrade: websocket\r\n'
                    + 'Connection: Upgrade\r\n'
                    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
                );
                // Immediately send a PING frame to verify client auto-PONG
                socket.write(encodeWebSocketFrame({ opcode: WS_OPCODE.PING, payload: Buffer.from('ping-1'), mask: false }));

                const srvDecoder = new WebSocketFrameDecoder();
                socket.on('data', (chunk: Buffer) => {
                    for (const msg of srvDecoder.push(chunk)) {
                        if (msg.opcode === WS_OPCODE.CLOSE) {
                            socket.destroy();
                            return;
                        }
                        if (msg.opcode === WS_OPCODE.PONG) {
                            pongsReceived.push(msg.payload.toString('utf8'));
                        } else if (msg.opcode === WS_OPCODE.TEXT) {
                            const reqJson = JSON.parse(msg.payload.toString('utf8')) as {
                                id: number;
                                method: string;
                                params?: { expression?: string };
                            };
                            const reply = JSON.stringify({
                                id: reqJson.id,
                                result: { result: { value: { evaluated: reqJson.params?.expression } } },
                            });
                            socket.write(encodeWebSocketFrame({
                                opcode: WS_OPCODE.TEXT,
                                payload: Buffer.from(reply, 'utf8'),
                                mask: false,
                            }));
                        }
                    }
                });
            });
            servers.push(srv);
            await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve));
            const port = (srv.address() as AddressInfo).port;

            try {
                // Rejects non-loopback URLs
                await expect(CdpWebSocketClient.connect('ws://evil.example.com:9222/devtools/page/1')).rejects.toThrow(/non-loopback/i);
                // Rejects bad Sec-WebSocket-Accept
                await expect(CdpWebSocketClient.connect(`ws://127.0.0.1:${port}/bad-accept`)).rejects.toThrow(/Sec-WebSocket-Accept/i);

                // Real connect + Runtime.evaluate + auto-pong
                const client = await CdpWebSocketClient.connect(`ws://127.0.0.1:${port}/devtools/page/hub`);
                expect(client.isOpen).toBe(true);
                const result = await client.evaluate<{ evaluated: string }>('1 + 1');
                expect(result).toEqual({ evaluated: '1 + 1' });
                expect(pongsReceived).toEqual(['ping-1']);
                await client.close();
                expect(client.isOpen).toBe(false);
            } finally {
                for (const s of upgradedSockets) { s.destroy(); }
                upgradedSockets.clear();
            }
        });
    });

    describe('Authenticated loopback overlay action bridge (127.0.0.1 + 256-bit token + strict Origin)', () => {
        it('enforces strict Origin and constant-time X-Monitor-Token validation', async () => {
            const receivedActions: CdpOverlayBridgeAction[] = [];
            const bridge = await createOverlayActionBridge({
                allowedOrigin: 'https://127.0.0.1:62501',
                onAction: (action) => { receivedActions.push(action); },
            });
            try {
                expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
                expect(bridge.token).toMatch(/^[a-f0-9]{64}$/); // 256-bit hex

                const post = (headers: Record<string, string>, body: string) => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
                    const req = http.request(`${bridge.url}/api/overlay/action`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...headers },
                    }, (res) => {
                        let data = '';
                        res.on('data', c => { data += c; });
                        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
                    });
                    req.on('error', reject);
                    req.end(body);
                });

                // Missing Origin -> 403
                expect((await post({ 'X-Monitor-Token': bridge.token }, '{"command":"refresh"}')).status).toBe(403);
                // External Origin -> 403
                expect((await post({ Origin: 'https://evil.example.com', 'X-Monitor-Token': bridge.token }, '{"command":"refresh"}')).status).toBe(403);
                // Wrong loopback port Origin -> 403
                expect((await post({ Origin: 'https://127.0.0.1:9999', 'X-Monitor-Token': bridge.token }, '{"command":"refresh"}')).status).toBe(403);
                // Wrong token -> 401
                expect((await post({ Origin: 'https://127.0.0.1:62501', 'X-Monitor-Token': 'deadbeef' }, '{"command":"refresh"}')).status).toBe(401);
                // Unknown command -> 400
                expect((await post({ Origin: 'https://127.0.0.1:62501', 'X-Monitor-Token': bridge.token }, '{"command":"execShell"}')).status).toBe(400);

                // Valid request -> 200 and dispatches action
                const okRes = await post(
                    { Origin: 'https://127.0.0.1:62501', 'X-Monitor-Token': bridge.token },
                    JSON.stringify({ command: 'openPanel', source: 'composer' }),
                );
                expect(okRes.status).toBe(200);
                expect(okRes.headers['access-control-allow-origin']).toBe('https://127.0.0.1:62501');
                expect(receivedActions).toEqual([{ command: 'openPanel', source: 'composer' }]);

                // Pure validator rejects 'null' origin
                expect(validateOverlayBridgeRequest({
                    originHeader: 'null',
                    tokenHeader: bridge.token,
                    expectedToken: bridge.token,
                }).status).toBe(403);
            } finally {
                await bridge.close();
            }
        });
    });

    describe('Shadow DOM overlay asset security (ZERO innerHTML) & runtime mounting behavior', () => {
        it('contains ZERO innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function and compiles cleanly', () => {
            const payload = makeSamplePayload({
                modelName: '<script>alert("xss")</script>',
                bridgeUrl: 'http://127.0.0.1:55555',
                bridgeToken: crypto.randomBytes(32).toString('hex'),
            });
            const scripts = [
                buildOverlayBootstrapScript(),
                buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
                buildOverlayUnmountScript('all'),
            ];

            for (const script of scripts) {
                expect(script).not.toMatch(/\binnerHTML\b/);
                expect(script).not.toMatch(/\bouterHTML\b/);
                expect(script).not.toMatch(/\binsertAdjacentHTML\b/);
                expect(script).not.toMatch(/\bdocument\.write\b/);
                expect(script).not.toMatch(/\beval\s*\(/);
                expect(script).not.toMatch(/\bnew\s+Function\b/);
                // Syntax validation via Node vm.Script
                expect(() => new vm.Script(script)).not.toThrow();
            }

            // safeJsonForScript neutralizes closing script tags and line separators
            const encoded = safeJsonForScript({ x: '</script>\u2028\u2029&<>' });
            expect(encoded).not.toContain('</script>');
            expect(encoded).toContain('\\u003c/script\\u003e');

            // Styles include both dark & light themes and reduced-motion rules
            expect(getComposerOverlayCss()).toContain(':host([data-theme="light"])');
            expect(getComposerOverlayCss()).toContain('prefers-reduced-motion');
            expect(getTopBarOverlayCss()).toContain('.acm-wco-spacer');
            expect(getTopBarOverlayCss()).toContain('.acm-overflow-menu');
        });

        it('mounts Composer Ring left of Turbo and TopBar beside aux-sidebar inside Shadow DOM, renders telemetry, and unmounts cleanly', () => {
            const dom = createFakeDomContext({ innerWidth: 800, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });

            // 1. Bootstrap (idempotent)
            const boot1 = vm.runInContext(buildOverlayBootstrapScript(), dom.ctx) as { installed: boolean; reused: boolean };
            expect(boot1.installed).toBe(true);
            expect(boot1.reused).toBe(false);
            const boot2 = vm.runInContext(buildOverlayBootstrapScript(), dom.ctx) as { installed: boolean; reused: boolean };
            expect(boot2.reused).toBe(true);

            // 2. Mount BOTH composer ring & top bar with short-sample payload
            const payload = makeSamplePayload({ isShortSample: true, turnCacheState: 'cold' });
            const res = vm.runInContext(
                buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            ) as { ok: boolean; composerMounted: boolean; topBarMounted: boolean };
            expect(res.ok).toBe(true);
            expect(res.composerMounted).toBe(true);
            expect(res.topBarMounted).toBe(true);

            // Composer host is inserted directly BEFORE Turbo button
            const composerHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
            expect(composerHost).toBeTruthy();
            expect(dom.footerGroup.childNodes[0]).toBe(composerHost);
            expect(dom.footerGroup.childNodes[1]).toBe(dom.turboBtn);
            expect(composerHost.shadowRoot).toBeTruthy();
            const composerText = composerHost.shadowRoot!.collectText();
            expect(composerText).toContain('Usage / 用量');
            expect(composerText).toContain('Short sample / 短样本');
            expect(composerText).toContain('Cold / 冷启动');
            expect(composerText).toContain('$13.04');
            expect(composerText).toContain('¥94.50');
            expect(composerText).toContain('200k');

            // TopBar host is inserted directly BEFORE toggle-aux-sidebar
            const topBarHost = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            expect(topBarHost).toBeTruthy();
            expect(dom.titlebar.childNodes[0]).toBe(topBarHost);
            expect(dom.titlebar.childNodes[1]).toBe(dom.auxBtn);
            expect(topBarHost.shadowRoot).toBeTruthy();
            const topBarText = topBarHost.shadowRoot!.collectText();
            expect(topBarText).toContain('80%');
            expect(topBarText).toContain('5h');
            expect(topBarText).toContain('94%');
            expect(topBarText).toContain('927.6M');
            expect(topBarText).toContain('Model Quota Board / 模型配额面板');
            expect(topBarText).toContain('Claude Opus 4.6');

            // Narrow width (800px) activates ··· overflow trigger
            const overflowBtn = topBarHost.shadowRoot!.querySelector('[aria-label="More telemetry"]')!;
            expect(overflowBtn.classList.contains('is-hidden')).toBe(false);

            // 3. Unmount only composer
            vm.runInContext(buildOverlayUnmountScript('composer'), dom.ctx);
            expect(dom.doc.getElementById(CDP_COMPOSER_HOST_ID)).toBeNull();
            expect(dom.doc.getElementById(CDP_TOPBAR_HOST_ID)).toBeTruthy();

            // 4. Unmount all
            vm.runInContext(buildOverlayUnmountScript('all'), dom.ctx);
            expect(dom.doc.getElementById(CDP_TOPBAR_HOST_ID)).toBeNull();
            expect(dom.win[CDP_RUNTIME_GLOBAL_KEY]).toBeUndefined();
        });
    });

    describe('CdpAmbientOverlayManager opt-in lifecycle & silent degradation', () => {
        it('stays completely idle when disabled and degrades silently to cdp_unavailable without throwing', async () => {
            const discoverSpy = vi.fn().mockReturnValue(null);
            let nowMs = 1_000_000;
            const mgr = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: false,
                reconnectBackoffMs: 15_000,
                now: () => nowMs,
                discoverActivePort: discoverSpy,
            });

            expect(mgr.getStatus().state).toBe('disabled');
            await mgr.updatePayload(makeSamplePayload());
            expect(discoverSpy).not.toHaveBeenCalled();

            // User opts in, but Antigravity wasn't launched with --remote-debugging-port=0
            const st1 = await mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: false });
            expect(st1.state).toBe('cdp_unavailable');
            expect(st1.platformGuide.command).toContain('--remote-debugging-port=0');
            expect(discoverSpy).toHaveBeenCalledTimes(1);

            // Respects backoff on subsequent payload ticks (no polling spam)
            nowMs += 5_000;
            await mgr.updatePayload(makeSamplePayload());
            expect(discoverSpy).toHaveBeenCalledTimes(1);

            // Retries once backoff elapses
            nowMs += 15_000;
            await mgr.updatePayload(makeSamplePayload());
            expect(discoverSpy).toHaveBeenCalledTimes(2);

            // Turning toggle back off returns cleanly to disabled
            const stOff = await mgr.setToggles({ appComposerRingEnabled: false, appTopBarEnabled: false });
            expect(stOff.state).toBe('disabled');
            await mgr.dispose();
        });

        it('bootstraps, injects updates with bridge auth, unmounts individual slots, and cleans up on disable', async () => {
            const evaluatedExprs: string[] = [];
            let open = true;
            const fakeClient: CdpClientLike = {
                get isOpen() { return open; },
                send: vi.fn().mockResolvedValue({}),
                evaluate: vi.fn().mockImplementation(async (expr: string) => {
                    evaluatedExprs.push(expr);
                    return { ok: true };
                }),
                close: vi.fn().mockImplementation(async () => { open = false; }),
            };

            const mgr = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: true,
                discoverActivePort: () => ({ port: 9222, wsPath: '/devtools/browser/1', filePath: '/tmp/DevToolsActivePort' }),
                fetchTargets: async () => [{
                    id: 'hub-1',
                    type: 'page',
                    title: 'Antigravity',
                    url: 'https://127.0.0.1:62501/',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/hub-1',
                }],
                connectClient: async () => fakeClient,
            });

            await mgr.updatePayload(makeSamplePayload());
            const connected = await mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: true });
            expect(connected.state).toBe('connected');
            expect(connected.targetUrl).toBe('https://127.0.0.1:62501/');
            expect(connected.lastInjectedAt).toBeGreaterThan(0);

            // Verify bootstrap + update scripts were evaluated and bridgeUrl/bridgeToken injected
            expect(evaluatedExprs.length).toBe(2);
            expect(evaluatedExprs[1]).toContain('http://127.0.0.1:');
            expect(evaluatedExprs[1]).toContain('bridgeToken');

            // Turn off composer ring only -> evaluates composer unmount script while staying connected
            const topOnly = await mgr.setToggles({ appComposerRingEnabled: false, appTopBarEnabled: true });
            expect(topOnly.state).toBe('connected');
            expect(topOnly.composerEnabled).toBe(false);
            expect(topOnly.topBarEnabled).toBe(true);
            expect(evaluatedExprs.some(e => e.includes('"composer"'))).toBe(true);

            // Turn off both -> evaluates unmount('all'), closes client & bridge, returns disabled
            const off = await mgr.setToggles({ appComposerRingEnabled: false, appTopBarEnabled: false });
            expect(off.state).toBe('disabled');
            expect(evaluatedExprs.some(e => e.includes('"all"'))).toBe(true);
            expect(fakeClient.close).toHaveBeenCalledTimes(1);

            await mgr.dispose();
        });
    });
});

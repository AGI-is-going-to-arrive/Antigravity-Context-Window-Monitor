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
    fetchCdpTargets,
    getCdpPlatformGuide,
    inspectAntigravityHostProcess,
    isLoopbackUrl,
    parseAntigravityHostCommandLine,
    parseDevToolsActivePortContent,
    resolveDevToolsActivePortPaths,
    selectAntigravityHubTarget,
    validateOverlayBridgeRequest,
    type CdpClientLike,
    type CdpTargetInfo,
    type ProcessTableEntry,
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
    hidden = false;
    _rect: { top: number; left: number; right: number; bottom: number; width: number; height: number } | null = null;
    clickCount = 0;

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    get parentElement(): FakeElement | null { return this.parentNode; }
    get firstChild(): FakeElement | null { return this.childNodes[0] ?? null; }
    get firstElementChild(): FakeElement | null { return this.childNodes.find(n => n.nodeType === 1) ?? null; }
    get lastElementChild(): FakeElement | null {
        for (let i = this.childNodes.length - 1; i >= 0; i--) {
            if (this.childNodes[i].nodeType === 1) { return this.childNodes[i]; }
        }
        return null;
    }
    get nextSibling(): FakeElement | null {
        if (!this.parentNode) { return null; }
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
    }
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

    click(): void {
        this.clickCount += 1;
        const handlers = this.listeners.get('click') ?? [];
        for (const fn of handlers) {
            fn({ stopPropagation: () => {}, target: this });
        }
    }

    getBoundingClientRect() {
        return this._rect ?? { top: 400, left: 600, right: 626, bottom: 426, width: 26, height: 26 };
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

            // AGY_BROWSER_ACTIVE_PORT_FILE takes precedence ahead of OS defaults
            expect(resolveDevToolsActivePortPaths({
                platform: 'darwin',
                homedir: '/Users/alice',
                env: { AGY_BROWSER_ACTIVE_PORT_FILE: '/custom/run/DevToolsActivePort' },
            })).toEqual([
                '/custom/run/DevToolsActivePort',
                '/Users/alice/Library/Application Support/Antigravity/DevToolsActivePort',
            ]);

            // Custom --user-data-dir prepends <dir>/DevToolsActivePort ahead of all defaults
            expect(resolveDevToolsActivePortPaths({
                platform: 'darwin',
                homedir: '/Users/alice',
                customUserDataDir: '/tmp/custom-agy-profile',
                env: { AGY_BROWSER_ACTIVE_PORT_FILE: '/custom/run/DevToolsActivePort' },
            })).toEqual([
                '/tmp/custom-agy-profile/DevToolsActivePort',
                '/custom/run/DevToolsActivePort',
                '/Users/alice/Library/Application Support/Antigravity/DevToolsActivePort',
            ]);
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

        it('provides concise zero-patch launch guides with macOS 5s teardown wait & persistent launcher guidance', () => {
            for (const plat of ['darwin', 'win32', 'linux'] as const) {
                const guide = getCdpPlatformGuide(plat);
                expect(guide.platform).toBe(plat);
                expect(guide.command).toContain('--remote-debugging-port=0');
                expect(guide.en).toContain('--setup-cdp-launcher');
                expect(guide.zh).toContain('--setup-cdp-launcher');
                expect(guide.en.length).toBeGreaterThan(20);
                expect(guide.zh.length).toBeGreaterThan(15);
            }
            const macGuide = getCdpPlatformGuide('darwin');
            expect(macGuide.command).toContain('while pgrep -f');
            expect(macGuide.en).toMatch(/5s|5-second/);
            expect(macGuide.zh).toContain('5 秒');
        });

        it('parses Antigravity main host argv and walks grandparent PIDs read-only while excluding IDE/Helper processes', () => {
            // macOS main process without flag
            expect(parseAntigravityHostCommandLine('/Applications/Antigravity.app/Contents/MacOS/Antigravity')).toEqual({
                isAntigravityHost: true,
                hasRemoteDebuggingFlag: false,
            });
            // macOS main process with =0 and quoted --user-data-dir
            expect(parseAntigravityHostCommandLine(
                '/Applications/Antigravity.app/Contents/MacOS/Antigravity --user-data-dir="/tmp/my agy profile" --remote-debugging-port=0',
            )).toEqual({
                isAntigravityHost: true,
                hasRemoteDebuggingFlag: true,
                customUserDataDir: '/tmp/my agy profile',
            });
            // macOS main process with fixed port 9222 and unquoted --user-data-dir containing spaces
            expect(parseAntigravityHostCommandLine(
                '/Applications/Antigravity.app/Contents/MacOS/Antigravity --user-data-dir=/tmp/space profile --remote-debugging-port=9222',
            )).toEqual({
                isAntigravityHost: true,
                hasRemoteDebuggingFlag: true,
                explicitPort: 9222,
                customUserDataDir: '/tmp/space profile',
            });
            // Windows main process
            expect(parseAntigravityHostCommandLine(
                '"C:\\Users\\Alice\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=9333',
            )).toEqual({
                isAntigravityHost: true,
                hasRemoteDebuggingFlag: true,
                explicitPort: 9333,
            });
            // Linux main process
            expect(parseAntigravityHostCommandLine('/opt/Antigravity/antigravity --remote-debugging-port=0')).toEqual({
                isAntigravityHost: true,
                hasRemoteDebuggingFlag: true,
            });
            // Excluded non-host processes (Antigravity IDE, Helper/Renderer, language_server, sidecar)
            for (const nonHost of [
                '/Applications/Antigravity IDE.app/Contents/MacOS/Electron --remote-debugging-port=9222',
                '/Applications/Antigravity Tools.app/Contents/MacOS/Antigravity Tools',
                '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer) --type=renderer',
                '/Applications/Antigravity.app/Contents/Resources/bin/language_server_macos_arm --csrf_token=abc',
                'node /Users/alice/.gemini/config/plugins/antigravity-context-monitor/sidecars/context_monitor/main.mjs',
                '/bin/zsh -c "pgrep -f /Applications/Antigravity.app/Contents/MacOS/Antigravity"',
                'bash -c "/Applications/Antigravity.app/Contents/MacOS/Antigravity"',
            ]) {
                expect(parseAntigravityHostCommandLine(nonHost).isAntigravityHost).toBe(false);
            }

            // Grandparent walk: sidecar -> ppid 52018 (language_server) -> ppid 51565 (Antigravity main)
            const procTable = new Map<number, ProcessTableEntry>([
                [52018, { pid: 52018, ppid: 51565, command: '/Applications/Antigravity.app/Contents/Resources/bin/language_server_macos_arm' }],
                [51565, { pid: 51565, ppid: 1, command: '/Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9222 --user-data-dir=/tmp/agy-alt' }],
            ]);
            const inspected = inspectAntigravityHostProcess({
                platform: 'darwin',
                startPid: 52018,
                readProcessEntry: (pid) => procTable.get(pid) ?? null,
            });
            expect(inspected).toMatchObject({
                found: true,
                pid: 51565,
                hasRemoteDebuggingFlag: true,
                explicitPort: 9222,
                customUserDataDir: '/tmp/agy-alt',
            });
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

        it('excludes own ANTIGRAVITY_SIDECAR_WEB_PORT, sidecar titles, plugin:// URLs, prefers https Hub, and recognizes Jetski Web', () => {
            const sidecarZh: CdpTargetInfo = {
                id: 'sidecar-zh',
                type: 'page',
                title: 'Antigravity 监控面板',
                url: 'http://127.0.0.1:53761/',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/sidecar-zh',
            };
            const sidecarEnvPort: CdpTargetInfo = {
                id: 'sidecar-env',
                type: 'page',
                title: 'Antigravity',
                url: 'http://127.0.0.1:54999/',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/sidecar-env',
            };
            const swarmTarget: CdpTargetInfo = {
                id: 'swarm',
                type: 'page',
                title: 'Swarm Board',
                url: 'http://127.0.0.1:53762/',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/swarm',
            };
            const pluginTarget: CdpTargetInfo = {
                id: 'plugin',
                type: 'page',
                title: 'Antigravity Plugin',
                url: 'plugin://antigravity-context-monitor/index.html',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/plugin',
            };
            const httpOther: CdpTargetInfo = {
                id: 'http-other',
                type: 'page',
                title: 'Local Helper',
                url: 'http://127.0.0.1:41234/',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/http-other',
            };
            const jetskiHub: CdpTargetInfo = {
                id: 'jetski-hub',
                type: 'page',
                title: 'Jetski Web',
                url: 'https://127.0.0.1:62505/',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/jetski-hub',
            };

            const picked = selectAntigravityHubTarget(
                [sidecarZh, sidecarEnvPort, swarmTarget, pluginTarget, httpOther, jetskiHub],
                { env: { ANTIGRAVITY_SIDECAR_WEB_PORT: '54999' } },
            );
            expect(picked?.id).toBe('jetski-hub');

            // Only excluded sidecar/plugin/swarm targets -> returns null
            expect(selectAntigravityHubTarget(
                [sidecarZh, sidecarEnvPort, swarmTarget, pluginTarget],
                { env: { ANTIGRAVITY_SIDECAR_WEB_PORT: '54999' } },
            )).toBeNull();

            // Also excludes ANTIGRAVITY_SIDECAR_PORT alongside ANTIGRAVITY_SIDECAR_WEB_PORT
            expect(selectAntigravityHubTarget(
                [sidecarEnvPort],
                { env: { ANTIGRAVITY_SIDECAR_PORT: '54999' } },
            )).toBeNull();

            // Does NOT self-exclude a real HTTPS Antigravity Hub conversation whose workspace/title contains
            // "antigravity context monitor" or "swarm"
            const workspaceHub: CdpTargetInfo = {
                id: 'workspace-hub',
                type: 'page',
                title: 'Swarm Plugin Bug Fix - antigravity context monitor - Antigravity',
                url: 'https://127.0.0.1:60154/c/abc-123',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/workspace-hub',
            };
            expect(selectAntigravityHubTarget([sidecarZh, swarmTarget, workspaceHub])?.id).toBe('workspace-hub');
        });

        it('falls back to IPv6 [::1] in fetchCdpTargets when 127.0.0.1 refuses connections', async () => {
            const srv = http.createServer((req, res) => {
                if (req.url === '/json/list') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify([{
                        id: 'v6-hub',
                        type: 'page',
                        title: 'Jetski Web',
                        url: 'https://127.0.0.1:62501/',
                        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/v6-hub',
                    }]));
                    return;
                }
                res.writeHead(404);
                res.end();
            });
            servers.push(srv);
            let listeningOnV6 = false;
            await new Promise<void>((resolve) => {
                srv.once('error', () => resolve());
                srv.listen(0, '::1', () => {
                    listeningOnV6 = true;
                    resolve();
                });
            });
            if (!listeningOnV6) { return; }

            const port = (srv.address() as AddressInfo).port;
            const targets = await fetchCdpTargets(port, 1500);
            expect(targets).toHaveLength(1);
            expect(targets[0].id).toBe('v6-hub');
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

            // Styles include both dark & light themes, reduced-motion rules, and single-column popover rows (zero label truncation)
            const composerCss = getComposerOverlayCss();
            expect(composerCss).toContain(':host([data-theme="light"])');
            expect(composerCss).toContain('prefers-reduced-motion');
            expect(composerCss).toMatch(/\.acm-kv-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
            expect(composerCss).not.toMatch(/\.acm-kv-grid\s*\{[^}]*repeat\(2,/);
            expect(composerCss).toMatch(/\.acm-v\s*\{[^}]*flex-shrink:\s*0;/);
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

        it('anchors TopBar before toggle-maximize-pane without double WCO spacing, adapts to open aux sidebar, re-anchors hidden Composer Ring, detects Hub themes, and opens collapsed sidebar directly', () => {
            const dom = createFakeDomContext({ innerWidth: 1280, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });

            // Add toggle-maximize-pane directly before toggle-aux-sidebar (Antigravity 2.35+ right cluster)
            const maxBtn = dom.doc.createElement('button');
            maxBtn.setAttribute('data-testid', 'toggle-maximize-pane');
            dom.titlebar.insertBefore(maxBtn, dom.auxBtn);
            dom.auxBtn.setAttribute('aria-expanded', 'true');

            // Add native window-controls-reserve + mock Windows WCO API to verify ZERO double spacer in inline mode
            const wcoReserve = dom.doc.createElement('div');
            wcoReserve.setAttribute('data-testid', 'window-controls-reserve');
            dom.doc.body.appendChild(wcoReserve);
            (dom.ctx as { navigator: Record<string, unknown> }).navigator.windowControlsOverlay = {
                visible: true,
                getTitlebarAreaRect: () => ({ right: 1140 }),
            };

            // Hide first composer tab (simulating background tab) and add a visible active tab with Material ligature Turbo text
            const firstFooter = dom.footerGroup.parentNode!;
            firstFooter._rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
            dom.turboBtn._rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };

            const activeFooter = dom.doc.createElement('div');
            activeFooter.setAttribute('data-testid', 'input-box-bottom-toolbar');
            const leftGroup = dom.doc.createElement('div');
            const rightGroup = dom.doc.createElement('div');
            const activeTurbo = dom.doc.createElement('button');
            activeTurbo.setAttribute('data-testid', 'permissions-selector-trigger');
            activeTurbo.textContent = 'Turbokeyboard_arrow_down';
            rightGroup.appendChild(activeTurbo);
            activeFooter.appendChild(leftGroup);
            activeFooter.appendChild(rightGroup);
            dom.doc.body.appendChild(activeFooter);

            // Detect theme via colorScheme='light' and theme-light / dark-theme classes
            dom.doc.documentElement.style.colorScheme = 'light';

            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makeSamplePayload({ theme: undefined }), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            // 1. TopBar inserted BEFORE toggle-maximize-pane (never splitting [max, aux])
            const topBarHost = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            expect(dom.titlebar.childNodes[0]).toBe(topBarHost);
            expect(dom.titlebar.childNodes[1]).toBe(maxBtn);
            expect(dom.titlebar.childNodes[2]).toBe(dom.auxBtn);
            expect(topBarHost.getAttribute('data-theme')).toBe('light');

            // 2. No double WCO spacer when inline & window-controls-reserve exists
            const wcoSpacer = topBarHost.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(wcoSpacer.style.display).toBe('none');
            expect(wcoSpacer.style.width).toBe('0px');

            // 3. Aux pane open on 1280px collapses overflow trigger earlier (threshold 1360)
            const overflowBtn = topBarHost.shadowRoot!.querySelector('[aria-label="More telemetry"]')!;
            expect(overflowBtn.classList.contains('is-hidden')).toBe(false);

            // 4. Composer Ring mounted in the VISIBLE active tab before activeTurbo
            const composerHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
            expect(rightGroup.childNodes[0]).toBe(composerHost);
            expect(rightGroup.childNodes[1]).toBe(activeTurbo);
            expect(composerHost.getAttribute('data-theme')).toBe('light');

            // 5. Switching to dark-theme class updates theme, and hiding active tab re-anchors to newly visible tab
            dom.doc.documentElement.style.colorScheme = '';
            dom.doc.body.className = 'dark-theme';
            activeFooter._rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
            composerHost._rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
            const tab3Footer = dom.doc.createElement('div');
            tab3Footer.className = 'agy-composer-footer';
            const tab3Left = dom.doc.createElement('div');
            const tab3Right = dom.doc.createElement('div');
            const sendBtn = dom.doc.createElement('button');
            sendBtn.setAttribute('data-testid', 'send-button');
            tab3Right.appendChild(sendBtn);
            tab3Footer.appendChild(tab3Left);
            tab3Footer.appendChild(tab3Right);
            dom.doc.body.appendChild(tab3Footer);

            vm.runInContext(
                buildOverlayUpdateScript(makeSamplePayload({ theme: undefined }), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );
            expect(composerHost.getAttribute('data-theme')).toBe('dark');
            expect(tab3Right.childNodes[0]).toBe(composerHost);
            expect(tab3Right.childNodes[1]).toBe(sendBtn);

            // 6. Clicking Open Panel directly clicks collapsed toggle-aux-sidebar even without bridgeUrl
            dom.auxBtn.setAttribute('aria-expanded', 'false');
            const openBtn = composerHost.shadowRoot!.querySelector('.is-primary')!;
            expect(openBtn.style.display).not.toBe('none');
            openBtn.click();
            expect(dom.auxBtn.clickCount).toBe(1);
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
            expect(off.diagnosticCode).toBe('disabled');
            expect(evaluatedExprs.some(e => e.includes('"all"'))).toBe(true);
            expect(fakeClient.close).toHaveBeenCalledTimes(1);

            await mgr.dispose();
        });

        it('populates structured diagnosticCode across all failure modes, serializes concurrent sync calls, and bypasses backoff on recheck()', async () => {
            let nowMs = 2_000_000;
            let activePort: { port: number; wsPath: string; filePath: string } | null = null;
            let targetsImpl: () => Promise<CdpTargetInfo[]> = async () => { throw new Error('ECONNREFUSED'); };
            let connectCalls = 0;
            let evaluateError: Error | null = null;

            const makeClient = (): CdpClientLike => {
                let open = true;
                return {
                    get isOpen() { return open; },
                    send: vi.fn().mockResolvedValue({}),
                    evaluate: vi.fn().mockImplementation(async () => {
                        if (evaluateError) { throw evaluateError; }
                        return { ok: true };
                    }),
                    close: vi.fn().mockImplementation(async () => { open = false; }),
                };
            };

            const mgr = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: false,
                reconnectBackoffMs: 60_000,
                now: () => nowMs,
                discoverActivePort: () => activePort,
                fetchTargets: async () => targetsImpl(),
                connectClient: async () => {
                    connectCalls += 1;
                    await new Promise(resolve => setTimeout(resolve, 25));
                    return makeClient();
                },
            });

            // 1. disabled
            expect(mgr.getStatus().diagnosticCode).toBe('disabled');

            // 2. missing_port_file
            const stMissing = await mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: false });
            expect(stMissing.state).toBe('cdp_unavailable');
            expect(stMissing.diagnosticCode).toBe('missing_port_file');

            // 3. port_unreachable (recheck bypasses 60s backoff immediately!)
            activePort = { port: 9229, wsPath: '/devtools/browser/1', filePath: '/tmp/DevToolsActivePort' };
            const stUnreachable = await mgr.recheck();
            expect(stUnreachable.state).toBe('cdp_unavailable');
            expect(stUnreachable.diagnosticCode).toBe('port_unreachable');
            expect(stUnreachable.discoveredPort).toBe(9229);
            expect(stUnreachable.portFilePath).toBe('/tmp/DevToolsActivePort');

            // 4. no_hub_target
            targetsImpl = async () => [{
                id: 'dt',
                type: 'page',
                title: 'DevTools',
                url: 'devtools://devtools/bundled/inspector.html',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/dt',
            }];
            const stNoHub = await mgr.recheck();
            expect(stNoHub.state).toBe('cdp_unavailable');
            expect(stNoHub.diagnosticCode).toBe('no_hub_target');
            expect(stNoHub.discoveredPort).toBe(9229);

            // 5. Concurrent setToggles + updatePayload + recheck must serialize and open ONLY ONE WebSocket
            targetsImpl = async () => [{
                id: 'hub-1',
                type: 'page',
                title: 'Jetski Web',
                url: 'https://127.0.0.1:62501/',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/hub-1',
            }];
            const [r1, r2, r3] = await Promise.all([
                mgr.recheck(),
                mgr.updatePayload(makeSamplePayload()),
                mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: true }),
            ]);
            expect(connectCalls).toBe(1);
            expect(r1.state).toBe('connected');
            expect(r1.diagnosticCode).toBe('connected');
            expect(r1.discoveredPort).toBe(9229);
            expect(r2.state).toBe('connected');
            expect(r3.state).toBe('connected');

            // 6. eval_error
            evaluateError = new Error('Target crashed');
            const stEvalErr = await mgr.updatePayload(makeSamplePayload({ contextPct: 50 }));
            expect(stEvalErr.state).toBe('error');
            expect(stEvalErr.diagnosticCode).toBe('eval_error');
            expect(stEvalErr.errorMessage).toContain('Target crashed');

            await mgr.dispose();
        });

        it('detaches open WebSocket and honors reconnectBackoffMs when createBridgeFn() throws (zero socket leak)', async () => {
            let nowMs = 3_000_000;
            let open = true;
            const closeSpy = vi.fn().mockImplementation(async () => { open = false; });
            const evalSpy = vi.fn().mockResolvedValue({ ok: true });
            const fakeClient: CdpClientLike = {
                get isOpen() { return open; },
                send: vi.fn().mockResolvedValue({}),
                evaluate: evalSpy,
                close: closeSpy,
            };
            const connectSpy = vi.fn().mockImplementation(async () => {
                open = true;
                return fakeClient;
            });
            const bridgeSpy = vi.fn().mockRejectedValue(new Error('EADDRINUSE bridge failure'));

            const mgr = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: true,
                reconnectBackoffMs: 15_000,
                now: () => nowMs,
                discoverActivePort: () => ({ port: 9222, wsPath: '/devtools/browser/1', filePath: '/tmp/DevToolsActivePort' }),
                fetchTargets: async () => [{
                    id: 'hub-1',
                    type: 'page',
                    title: 'Antigravity',
                    url: 'https://127.0.0.1:62501/',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/hub-1',
                }],
                connectClient: connectSpy,
                createBridge: bridgeSpy,
            });

            const stErr = await mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: false });
            expect(stErr.state).toBe('error');
            expect(stErr.diagnosticCode).toBe('ws_error');
            expect(stErr.errorMessage).toContain('EADDRINUSE bridge failure');
            // Open WebSocket MUST have been detached & closed immediately on bridge failure
            expect(closeSpy).toHaveBeenCalledTimes(1);
            expect(fakeClient.isOpen).toBe(false);
            expect(evalSpy).not.toHaveBeenCalled();

            // Subsequent payload tick inside reconnectBackoffMs MUST respect backoff (no reconnect, no eval with null bridge)
            nowMs += 5_000;
            const stBackoff = await mgr.updatePayload(makeSamplePayload());
            expect(stBackoff.state).toBe('error');
            expect(connectSpy).toHaveBeenCalledTimes(1);
            expect(evalSpy).not.toHaveBeenCalled();

            // Once backoff expires, retries cleanly
            nowMs += 15_000;
            await mgr.updatePayload(makeSamplePayload());
            expect(connectSpy).toHaveBeenCalledTimes(2);
            expect(closeSpy).toHaveBeenCalledTimes(2);

            await mgr.dispose();
        });

        it('reports host_missing_flag, discovers custom --user-data-dir DevToolsActivePort, falls back to fixed --remote-debugging-port=9222, and attaches launcherStatus', async () => {
            // 1. Host confirmed running WITHOUT --remote-debugging-port -> host_missing_flag + hostHasDebugFlag: false
            const mgrNoFlag = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: false,
                discoverActivePort: () => null,
                inspectHostProcess: () => ({
                    found: true,
                    pid: 51565,
                    commandLine: '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
                    hasRemoteDebuggingFlag: false,
                }),
            });
            const stNoFlag = await mgrNoFlag.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: false });
            expect(stNoFlag.state).toBe('cdp_unavailable');
            expect(stNoFlag.diagnosticCode).toBe('host_missing_flag');
            expect(stNoFlag.hostHasDebugFlag).toBe(false);
            expect(stNoFlag.launcherStatus).toBeDefined();
            expect(stNoFlag.launcherStatus?.platform).toBe('darwin');
            await mgrNoFlag.dispose();

            // 2. Custom --user-data-dir DevToolsActivePort discovery via host argv
            const customProfileDir = path.join(tempDir, 'custom-profile');
            fs.mkdirSync(customProfileDir, { recursive: true });
            const customPortFile = path.join(customProfileDir, 'DevToolsActivePort');
            fs.writeFileSync(customPortFile, '61444\n/devtools/browser/custom-uuid\n', 'utf8');

            const fetchedPorts: number[] = [];
            const makeMockClient = (): CdpClientLike => {
                let open = true;
                return {
                    get isOpen() { return open; },
                    send: vi.fn().mockResolvedValue({}),
                    evaluate: vi.fn().mockResolvedValue({ ok: true }),
                    close: vi.fn().mockImplementation(async () => { open = false; }),
                };
            };

            const mgrCustomDir = createCdpAmbientOverlayManager({
                platform: 'darwin',
                env: { HOME: path.join(tempDir, 'empty-home') },
                enableActionBridge: false,
                inspectHostProcess: () => ({
                    found: true,
                    pid: 60001,
                    hasRemoteDebuggingFlag: true,
                    customUserDataDir: customProfileDir,
                }),
                fetchTargets: async (port) => {
                    fetchedPorts.push(port);
                    return [{
                        id: 'hub-custom',
                        type: 'page',
                        title: 'Antigravity',
                        url: 'https://127.0.0.1:62501/',
                        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/hub-custom`,
                    }];
                },
                connectClient: async () => makeMockClient(),
            });

            const stCustom = await mgrCustomDir.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: false });
            expect(stCustom.state).toBe('connected');
            expect(stCustom.discoveredPort).toBe(61444);
            expect(stCustom.portFilePath).toBe(customPortFile);
            expect(stCustom.hostHasDebugFlag).toBe(true);
            expect(fetchedPorts).toEqual([61444]);
            await mgrCustomDir.dispose();

            // 3. Fixed --remote-debugging-port=9222 fallback when DevToolsActivePort is missing
            const probedFixedPorts: number[] = [];
            const mgrFixedPort = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: false,
                discoverActivePort: () => null,
                inspectHostProcess: () => ({
                    found: true,
                    pid: 60002,
                    hasRemoteDebuggingFlag: true,
                    explicitPort: 9222,
                }),
                fetchTargets: async (port) => {
                    probedFixedPorts.push(port);
                    return [{
                        id: 'hub-9222',
                        type: 'page',
                        title: 'Jetski Web',
                        url: 'https://127.0.0.1:62501/',
                        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/hub-9222`,
                    }];
                },
                connectClient: async () => makeMockClient(),
            });

            const stFixed = await mgrFixedPort.setToggles({ appComposerRingEnabled: false, appTopBarEnabled: true });
            expect(stFixed.state).toBe('connected');
            expect(stFixed.diagnosticCode).toBe('connected');
            expect(stFixed.discoveredPort).toBe(9222);
            expect(stFixed.hostHasDebugFlag).toBe(true);
            expect(probedFixedPorts).toEqual([9222]);
            await mgrFixedPort.dispose();
        });
    });
});

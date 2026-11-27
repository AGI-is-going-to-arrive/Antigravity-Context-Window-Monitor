import * as crypto from 'crypto';
import * as vm from 'vm';
import { describe, expect, it, vi } from 'vitest';
import {
    CDP_OVERLAY_SCRIPT_VERSION,
    CDP_RUNTIME_GLOBAL_KEY,
    CDP_TOPBAR_HOST_ID,
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    buildOverlayUpdateScript,
    getTopBarOverlayCss,
} from '../src/app/cdp-overlay-assets';
import type { CdpOverlayPayload } from '../src/app/sidecar-types';

class TestElement {
    readonly nodeType = 1;
    readonly tagName: string;
    id = '';
    className = '';
    textContent = '';
    parentNode: TestElement | null = null;
    childNodes: TestElement[] = [];
    shadowRoot: TestElement | null = null;
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    listeners = new Map<string, Array<(ev: unknown) => void>>();
    type = '';
    hidden = false;
    offsetWidth = 360;
    offsetHeight = 320;
    _rect: { top: number; left: number; right: number; bottom: number; width: number; height: number } | null = null;
    clickCount = 0;

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    get parentElement(): TestElement | null { return this.parentNode; }
    get firstChild(): TestElement | null { return this.childNodes[0] ?? null; }
    get firstElementChild(): TestElement | null { return this.childNodes.find(n => n.nodeType === 1) ?? null; }
    get lastElementChild(): TestElement | null {
        for (let i = this.childNodes.length - 1; i >= 0; i--) {
            if (this.childNodes[i].nodeType === 1) { return this.childNodes[i]; }
        }
        return null;
    }
    get nextSibling(): TestElement | null {
        if (!this.parentNode) { return null; }
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
    }
    get isConnected(): boolean {
        let cur: TestElement | null = this;
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

    appendChild(child: TestElement): TestElement {
        if (child.parentNode) { child.parentNode.removeChild(child); }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    insertBefore(child: TestElement, ref: TestElement | null): TestElement {
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

    removeChild(child: TestElement): TestElement {
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

    removeAttribute(name: string): void {
        if (name === 'id') { this.id = ''; }
        if (name === 'class') { this.className = ''; }
        this.attributes.delete(name);
    }

    attachShadow(_opts: { mode: string }): TestElement {
        this.shadowRoot = new TestElement('#shadow-root');
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
            fn({ stopPropagation: () => {}, target: this, composedPath: () => [this] });
        }
    }

    getBoundingClientRect() {
        return this._rect ?? { top: 8, left: 1080, right: 1160, bottom: 30, width: 80, height: 22 };
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

    querySelectorAll(selector: string): TestElement[] {
        const out: TestElement[] = [];
        const walk = (node: TestElement) => {
            for (const c of node.childNodes) {
                if (c.matches(selector)) { out.push(c); }
                walk(c);
            }
        };
        walk(this);
        return out;
    }

    querySelector(selector: string): TestElement | null {
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

function createTopBarDomHarness(options: { innerWidth?: number; innerHeight?: number } = {}) {
    const html = new TestElement('html');
    const body = new TestElement('body');
    html.appendChild(body);

    const titlebar = new TestElement('div');
    titlebar.setAttribute('data-testid', 'pane-titlebar-toolbar');
    const innerWidth = options.innerWidth ?? 1440;
    const innerHeight = options.innerHeight ?? 900;
    titlebar._rect = { top: 0, left: 0, right: innerWidth, bottom: 38, width: innerWidth, height: 38 };
    const auxBtn = new TestElement('button');
    auxBtn.setAttribute('data-testid', 'toggle-aux-sidebar');
    auxBtn.setAttribute('aria-expanded', 'false');
    titlebar.appendChild(auxBtn);
    body.appendChild(titlebar);

    const docListeners = new Map<string, Array<(ev: unknown) => void>>();
    const winListeners = new Map<string, Array<(ev: unknown) => void>>();
    const fetchCalls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }> = [];

    const doc = {
        documentElement: html,
        body,
        createElement: (tag: string) => new TestElement(tag),
        createElementNS: (_ns: string, tag: string) => new TestElement(tag),
        createTextNode: (text: string) => {
            const t = new TestElement('#text');
            t.textContent = text;
            return t;
        },
        getElementById: (id: string) => {
            const walk = (node: TestElement): TestElement | null => {
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
        addEventListener: (type: string, fn: (ev: unknown) => void) => {
            const list = docListeners.get(type) ?? [];
            list.push(fn);
            docListeners.set(type, list);
        },
        removeEventListener: (type: string, fn: (ev: unknown) => void) => {
            const list = docListeners.get(type);
            if (!list) { return; }
            const idx = list.indexOf(fn);
            if (idx >= 0) { list.splice(idx, 1); }
        },
    };

    const win: Record<string, unknown> = {
        innerWidth,
        innerHeight,
        addEventListener: (type: string, fn: (ev: unknown) => void) => {
            const list = winListeners.get(type) ?? [];
            list.push(fn);
            winListeners.set(type, list);
        },
        removeEventListener: (type: string, fn: (ev: unknown) => void) => {
            const list = winListeners.get(type);
            if (!list) { return; }
            const idx = list.indexOf(fn);
            if (idx >= 0) { list.splice(idx, 1); }
        },
        getComputedStyle: () => ({ backgroundColor: 'rgb(13, 16, 20)' }),
        matchMedia: () => ({ matches: false }),
    };
    win.window = win;

    const fetchMock = vi.fn().mockImplementation((url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
        fetchCalls.push({ url, init });
        return Promise.resolve({ ok: true });
    });

    const sandbox: Record<string, unknown> = {
        window: win,
        document: doc,
        navigator: {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
            platform: 'MacIntel',
        },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        fetch: fetchMock,
    };

    const ctx = vm.createContext(sandbox);

    function dispatchDocumentClick(path: TestElement[] = [body]) {
        for (const fn of (docListeners.get('click') ?? [])) {
            fn({ composedPath: () => path, target: path[0] ?? body });
        }
    }

    function dispatchKeyDown(key: string) {
        for (const fn of (docListeners.get('keydown') ?? [])) {
            fn({ key });
        }
    }

    function dispatchResize(nextWidth: number, nextHeight = innerHeight) {
        win.innerWidth = nextWidth;
        win.innerHeight = nextHeight;
        titlebar._rect = { top: 0, left: 0, right: nextWidth, bottom: 38, width: nextWidth, height: 38 };
        for (const fn of (winListeners.get('resize') ?? [])) {
            fn({});
        }
    }

    return {
        ctx,
        win,
        doc,
        titlebar,
        auxBtn,
        fetchMock,
        fetchCalls,
        dispatchDocumentClick,
        dispatchKeyDown,
        dispatchResize,
    };
}

function makeRichPayload(overrides: Partial<CdpOverlayPayload> = {}): CdpOverlayPayload {
    return {
        updatedAt: '2026-11-24T23:05:01.104Z',
        nextRefreshSec: 4,
        language: 'both',
        theme: 'dark',
        modelName: 'Gemini 4 Carbon (High)',
        contextUsedTokens: 115_200,
        contextEffectiveLimit: 256_000,
        contextNativeLimit: 1_000_000,
        contextPct: 45,
        compactionThresholdPct: 85,
        tier200kMarkerPct: 78.1,
        outputSpeedTps: 113.0,
        avgOutputSpeedTps: 98.4,
        peakOutputSpeedTps: 146.2,
        recentCallCount: 27,
        isShortSample: false,
        isWaitingTtft: false,
        ttftMs: 840,
        recentCacheHitPct: 97,
        avgCacheHitPct: 92,
        turnCacheState: 'warm',
        estCostUsd: 4.25,
        estCostFormatted: '$4.25',
        localCostFormatted: '¥30.80',
        inputTokens: 18_500,
        outputTokens: 6_400,
        cacheReadTokens: 142_000,
        totalTokens: 166_900,
        cumulativeRecordedTokens: 717_300_000,
        todayTokens: 12_400_000,
        todayCostFormatted: '$18.60',
        cumulativeCostFormatted: '$412.50',
        recordedDaysCount: 14,
        sessionCount: 38,
        subscriptionRoiSummary: '2.1x Ultra ($199.99/mo)',
        tightestQuotaPct: 84,
        tightestQuotaWindowTag: '5h',
        sessionQuota5hPct: 84,
        sessionQuota5hReset: '3h 15m',
        sessionQuotaWeeklyPct: 72,
        sessionQuotaWeeklyReset: '5d 2h',
        quotaPools: [
            {
                poolKey: 'gemini-pool',
                label: 'Gemini 4 Carbon / Argon',
                modelChips: ['Carbon High', 'Argon High'],
                remainingPct: 84,
                windowTag: '5h',
                resetCountdown: '3h 15m',
                isCurrentSessionModel: true,
                health: 'good',
            },
            {
                poolKey: 'claude-pool',
                label: 'Claude Opus / Sonnet',
                modelChips: ['Claude Opus 4.6', 'Claude Sonnet 4.6'],
                remainingPct: 35,
                windowTag: '5h',
                resetCountdown: '1h 40m',
                health: 'warn',
            },
        ],
        bridgeUrl: 'http://127.0.0.1:54321',
        bridgeToken: crypto.randomBytes(32).toString('hex'),
        ...overrides,
    };
}

function getTopBarControls(doc: ReturnType<typeof createTopBarDomHarness>['doc']) {
    const host = doc.getElementById(CDP_TOPBAR_HOST_ID)!;
    const sr = host.shadowRoot!;
    return {
        host,
        sr,
        quotaPill: sr.querySelector('[data-view="quota"]')!,
        ctxPill: sr.querySelector('[data-view="context"]')!,
        speedPill: sr.querySelector('[data-view="speed"]')!,
        totalPill: sr.querySelector('[data-view="total"]')!,
        overflowBtn: sr.querySelector('[aria-label="More telemetry"]')!,
        overflowMenu: sr.querySelector('.acm-overflow-menu')!,
        popover: sr.querySelector('.acm-quota-popover')!,
        title: sr.querySelector('.acm-qp-title')!,
        meta: sr.querySelector('.acm-qp-meta')!,
        body: sr.querySelector('.acm-qp-body')!,
        footer: sr.querySelector('.acm-qp-footer')!,
        closeBtn: sr.querySelector('[aria-label="Close"]')!,
        openBtn: sr.querySelector('.is-primary')!,
        tabFor: (view: 'quota' | 'context' | 'speed' | 'total') => sr.querySelector(`[data-tab-view="${view}"]`)!,
        overflowItemFor: (view: 'quota' | 'context' | 'speed' | 'total') => sr.querySelector(`[data-overflow-view="${view}"]`)!,
    };
}

describe('Top-Right Persistent Status Bar 4-View Popover (v1.18.0)', () => {
    it('bumps CDP_OVERLAY_SCRIPT_VERSION to 1.18.0 and passes strict ZERO-innerHTML / syntax security audit', () => {
        expect(CDP_OVERLAY_SCRIPT_VERSION).toBe('1.18.0');
describe('Top-Right Persistent Status Bar 4-View Popover (v1.17.11)', () => {
    it('bumps CDP_OVERLAY_SCRIPT_VERSION to 1.17.11 and passes strict ZERO-innerHTML / syntax security audit', () => {
        expect(CDP_OVERLAY_SCRIPT_VERSION).toBe('1.17.11');

        const xssPayload = makeRichPayload({
            modelName: '<img src=x onerror=alert(1)>',
            todayCostFormatted: '<script>evil()</script>',
            cumulativeCostFormatted: '<b>$99</b>',
            subscriptionRoiSummary: '"><svg onload=alert(2)>',
            updatedAt: '2026-11-24T23:05:01.104Z',
        });

        const scripts = [
            buildOverlayBootstrapScript(),
            buildOverlayUpdateScript(xssPayload, { appComposerRingEnabled: false, appTopBarEnabled: true }),
            buildOverlayUnmountScript('topbar'),
        ];

        for (const script of scripts) {
            expect(script).not.toMatch(/\binnerHTML\b/);
            expect(script).not.toMatch(/\bouterHTML\b/);
            expect(script).not.toMatch(/\binsertAdjacentHTML\b/);
            expect(script).not.toMatch(/\bdocument\.write\b/);
            expect(script).not.toMatch(/\beval\s*\(/);
            expect(script).not.toMatch(/\bnew\s+Function\b/);
            expect(() => new vm.Script(script)).not.toThrow();
        }

        const css = getTopBarOverlayCss();
        expect(css).toContain('.acm-qp-tabs');
        expect(css).toContain('.acm-qp-tab.is-active');
        expect(css).toContain('.acm-qp-hero-card');
        expect(css).toContain('.acm-qp-stat-grid');
        expect(css).toContain('.acm-qp-watermark-tick');
        expect(css).toContain('.acm-overflow-row');
    });

    it('opens each of the 4 pills on its own dedicated view, highlights ONLY that pill, switches seamlessly, and toggles closed cleanly', () => {
        const dom = createTopBarDomHarness({ innerWidth: 1440, innerHeight: 900 });
        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makeRichPayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const ui = getTopBarControls(dom.doc);
        const allPills = [ui.quotaPill, ui.ctxPill, ui.speedPill, ui.totalPill];

        // Initially closed: zero active pills, all aria-expanded="false"
        expect(ui.popover.classList.contains('is-open')).toBe(false);
        for (const pill of allPills) {
            expect(pill.classList.contains('is-active')).toBe(false);
            expect(pill.getAttribute('aria-expanded')).toBe('false');
        }

        const assertOnlyActive = (expectedView: 'quota' | 'context' | 'speed' | 'total') => {
            expect(ui.popover.classList.contains('is-open')).toBe(true);
            expect(ui.popover.getAttribute('data-active-view')).toBe(expectedView);
            const rt = dom.win[CDP_RUNTIME_GLOBAL_KEY] as { getStatus: () => { topBarActiveView: string | null } };
            expect(rt.getStatus().topBarActiveView).toBe(expectedView);
            for (const pill of allPills) {
                const isTarget = pill.getAttribute('data-view') === expectedView;
                expect(pill.classList.contains('is-active')).toBe(isTarget);
                expect(pill.getAttribute('aria-expanded')).toBe(isTarget ? 'true' : 'false');
            }
            for (const viewKey of ['quota', 'context', 'speed', 'total'] as const) {
                const tab = ui.tabFor(viewKey);
                const isTarget = viewKey === expectedView;
                expect(tab.classList.contains('is-active')).toBe(isTarget);
                expect(tab.getAttribute('aria-selected')).toBe(isTarget ? 'true' : 'false');
            }
            // Viewport clamping sanity
            const leftPx = parseInt(ui.popover.style.left || '0', 10);
            const topPx = parseInt(ui.popover.style.top || '0', 10);
            expect(leftPx).toBeGreaterThanOrEqual(10);
            expect(leftPx + ui.popover.offsetWidth).toBeLessThanOrEqual(1440 - 10);
            expect(topPx).toBeGreaterThanOrEqual(10);
        };

        // 1. Click quota pill -> Model Quota Board
        ui.quotaPill.click();
        assertOnlyActive('quota');
        expect(ui.title.textContent).toBe('Model Quota Board / 模型配额面板');
        const quotaBody = ui.body.collectText();
        expect(quotaBody).toContain('Gemini 4 Carbon (High)');
        expect(quotaBody).toContain('84%');
        expect(quotaBody).toContain('3h 15m');
        expect(quotaBody).toContain('72%');
        expect(quotaBody).toContain('5d 2h');
        expect(quotaBody).toContain('Claude Opus 4.6');

        // 2. Click context pill while open -> seamlessly switches to Context Usage (stays open!)
        ui.ctxPill.click();
        assertOnlyActive('context');
        expect(ui.title.textContent).toBe('Context Usage / 上下文用量');
        const ctxBody = ui.body.collectText();
        expect(ctxBody).toContain('45%');
        expect(ctxBody).toContain('115k / 256k (1M max)');
        expect(ctxBody).toContain('18.5k / 6.4k');
        expect(ctxBody).toContain('142k');
        expect(ctxBody).toContain('167k');
        expect(ctxBody).toContain('97%');
        expect(ctxBody).toContain('92%');
        expect(ctxBody).toContain('Warm / 热缓存');
        expect(ctxBody).toContain('200k');
        expect(ctxBody).not.toContain('Shared Quota Pools');
        expect(ui.body.querySelector('.is-compaction')).toBeTruthy();
        expect(ui.body.querySelector('.is-tier200k')).toBeTruthy();

        // 3. Click speed pill while open -> seamlessly switches to Speed & Throughput
        ui.speedPill.click();
        assertOnlyActive('speed');
        expect(ui.title.textContent).toBe('Speed & Throughput / 生成速度与吞吐');
        const speedBody = ui.body.collectText();
        expect(speedBody).toContain('113.0 tok/s');
        expect(speedBody).toContain('98.4 tok/s');
        expect(speedBody).toContain('146.2 tok/s');
        expect(speedBody).toContain('840ms');
        expect(speedBody).toContain('27');
        expect(speedBody).toContain('97%');
        expect(speedBody).toContain('Warm / 热缓存');
        expect(speedBody).not.toContain('Claude Opus 4.6');

        // 4. Click total pill while open -> seamlessly switches to Total Usage & Cost
        ui.totalPill.click();
        assertOnlyActive('total');
        expect(ui.title.textContent).toBe('Total Usage & Cost / 本机累计用量与成本');
        const totalBody = ui.body.collectText();
        expect(totalBody).toContain('717.3M');
        expect(totalBody).toContain('12.4M');
        expect(totalBody).toContain('$18.60');
        expect(totalBody).toContain('$412.50');
        expect(totalBody).toContain('14 days · 38 sessions');
        expect(totalBody).toContain('2.1x Ultra ($199.99/mo)');
        expect(totalBody).toContain('$4.25');
        expect(totalBody).toContain('¥30.80');
        expect(totalBody).toContain('18.5k / 6.4k');
        expect(totalBody).not.toContain('113.0 tok/s');

        // 5. Clicking the SAME active pill closes the popover and clears active/expanded states
        ui.totalPill.click();
        expect(ui.popover.classList.contains('is-open')).toBe(false);
        for (const pill of allPills) {
            expect(pill.classList.contains('is-active')).toBe(false);
            expect(pill.getAttribute('aria-expanded')).toBe('false');
        }

        // 6. Close via × button, outside click, and Escape key
        ui.ctxPill.click();
        expect(ui.popover.classList.contains('is-open')).toBe(true);
        ui.closeBtn.click();
        expect(ui.popover.classList.contains('is-open')).toBe(false);
        expect(ui.ctxPill.classList.contains('is-active')).toBe(false);

        ui.speedPill.click();
        expect(ui.popover.classList.contains('is-open')).toBe(true);
        dom.dispatchDocumentClick();
        expect(ui.popover.classList.contains('is-open')).toBe(false);
        expect(ui.speedPill.classList.contains('is-active')).toBe(false);

        ui.quotaPill.click();
        expect(ui.popover.classList.contains('is-open')).toBe(true);
        dom.dispatchKeyDown('Escape');
        expect(ui.popover.classList.contains('is-open')).toBe(false);
        expect(ui.quotaPill.classList.contains('is-active')).toBe(false);
    });

    it('switches views via in-popover 4-segment switcher and narrow-viewport overflow menu (···)', () => {
        const dom = createTopBarDomHarness({ innerWidth: 560, innerHeight: 720 });
        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makeRichPayload({ language: 'zh' }), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const ui = getTopBarControls(dom.doc);

        // At 560px: ctxPill, speedPill, and totalPill collapse into ··· overflow button
        expect(ui.ctxPill.classList.contains('is-hidden')).toBe(true);
        expect(ui.speedPill.classList.contains('is-hidden')).toBe(true);
        expect(ui.totalPill.classList.contains('is-hidden')).toBe(true);
        expect(ui.overflowBtn.classList.contains('is-hidden')).toBe(false);

        // Overflow menu item -> opens directly on THAT exact view (never snapping to quota)
        for (const target of [
            { view: 'context' as const, title: '上下文用量' },
            { view: 'speed' as const, title: '生成速度与吞吐' },
            { view: 'total' as const, title: '本机累计用量与成本' },
            { view: 'quota' as const, title: '模型配额面板' },
        ]) {
            ui.overflowBtn.click();
            expect(ui.overflowMenu.classList.contains('is-open')).toBe(true);
            ui.overflowItemFor(target.view).click();
            expect(ui.overflowMenu.classList.contains('is-open')).toBe(false);
            expect(ui.popover.classList.contains('is-open')).toBe(true);
            expect(ui.popover.getAttribute('data-active-view')).toBe(target.view);
            expect(ui.title.textContent).toBe(target.title);
        }

        // In-popover segmented tabs switch views seamlessly and stay open when clicking active tab
        expect(ui.tabFor('quota').textContent).toBe('配额');
        expect(ui.tabFor('context').textContent).toBe('上下文');
        expect(ui.tabFor('speed').textContent).toBe('速度');
        expect(ui.tabFor('total').textContent).toBe('累计');

        ui.tabFor('speed').click();
        expect(ui.popover.getAttribute('data-active-view')).toBe('speed');
        expect(ui.speedPill.classList.contains('is-active')).toBe(true);
        expect(ui.quotaPill.classList.contains('is-active')).toBe(false);

        // Clicking already-active in-popover tab keeps popover open
        ui.tabFor('speed').click();
        expect(ui.popover.classList.contains('is-open')).toBe(true);
        expect(ui.popover.getAttribute('data-active-view')).toBe('speed');
    });

    it('preserves currently open view and refreshes live metrics on incremental update(payload)', () => {
        const dom = createTopBarDomHarness({ innerWidth: 1440 });
        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makeRichPayload({ language: 'en' }), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const ui = getTopBarControls(dom.doc);

        // Open speed view
        ui.speedPill.click();
        expect(ui.popover.getAttribute('data-active-view')).toBe('speed');
        expect(ui.body.collectText()).toContain('113.0 tok/s');

        // Push live telemetry update -> MUST stay on speed view with fresh values!
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({
                    language: 'en',
                    outputSpeedTps: 158.4,
                    peakOutputSpeedTps: 182.0,
                    ttftMs: 520,
                    recentCallCount: 33,
                }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );

        expect(ui.popover.classList.contains('is-open')).toBe(true);
        expect(ui.popover.getAttribute('data-active-view')).toBe('speed');
        expect(ui.title.textContent).toBe('Speed & Throughput');
        expect(ui.speedPill.classList.contains('is-active')).toBe(true);
        expect(ui.speedPill.getAttribute('aria-expanded')).toBe('true');
        expect(ui.quotaPill.classList.contains('is-active')).toBe(false);
        const refreshedSpeed = ui.body.collectText();
        expect(refreshedSpeed).toContain('158.4 tok/s');
        expect(refreshedSpeed).toContain('182.0 tok/s');
        expect(refreshedSpeed).toContain('520ms');
        expect(refreshedSpeed).toContain('33');

        // Switch to total view and verify optional-field graceful degradation + waiting/short-sample speed states
        ui.totalPill.click();
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({
                    language: 'en',
                    cumulativeRecordedTokens: 805_000_000,
                    todayTokens: null,
                    todayCostFormatted: null,
                    cumulativeCostFormatted: null,
                    recordedDaysCount: null,
                    sessionCount: null,
                    subscriptionRoiSummary: null,
                }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.popover.getAttribute('data-active-view')).toBe('total');
        expect(ui.body.collectText()).toContain('805M');
        expect(ui.body.collectText()).toContain('Current Session Breakdown');
        expect(ui.body.collectText()).not.toContain('Subscription ROI');

        // Switch back to speed with Waiting for first token & Short sample states
        ui.speedPill.click();
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'en', isWaitingTtft: true, outputSpeedTps: null }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.body.collectText()).toContain('Waiting for first token');

        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'en', isWaitingTtft: false, isShortSample: true, outputSpeedTps: 42.5 }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.body.collectText()).toContain('Short sample');
        expect(ui.body.collectText()).toContain('42.5 tok/s');

        // Verify warn (>=65%) and danger (>=80%) severity styling on Context view + resize clamping
        ui.ctxPill.click();
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'en', contextPct: 72, turnCacheState: 'partial' }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.body.querySelector('.acm-qp-hero-value')?.classList.contains('is-warn')).toBe(true);
        expect(ui.body.collectText()).toContain('Partial');

        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'en', contextPct: 88, turnCacheState: 'cold' }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.body.querySelector('.acm-qp-hero-value')?.classList.contains('is-danger')).toBe(true);
        expect(ui.body.collectText()).toContain('Cold');

        // Narrow window resize while open keeps popover clamped inside viewport
        dom.dispatchResize(520, 700);
        expect(ui.popover.classList.contains('is-open')).toBe(true);
        const clampedLeft = parseInt(ui.popover.style.left || '0', 10);
        expect(clampedLeft).toBeGreaterThanOrEqual(10);
        expect(clampedLeft + ui.popover.offsetWidth).toBeLessThanOrEqual(520 - 10);
    });

    it('formats raw UTC ISO updatedAt into local HH:MM:SS (never T...Z) and falls back cleanly on invalid strings', () => {
        const dom = createTopBarDomHarness({ innerWidth: 1440 });
        const rawIso = '2026-11-24T23:05:01.104Z';
        const d = new Date(rawIso);
        const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
        const expectedLocalHms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'zh', updatedAt: rawIso, nextRefreshSec: 4 }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );

        const ui = getTopBarControls(dom.doc);
        expect(ui.meta.textContent).toBe(`更新于 ${expectedLocalHms} · 下次刷新 4s`);
        expect(ui.meta.textContent).not.toContain('2026-11-24T');
        expect(ui.meta.textContent).not.toContain('Z');

        // Already-formatted HH:MM:SS stays intact
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'en', updatedAt: '09:15:42', nextRefreshSec: 5 }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.meta.textContent).toBe('Updated 09:15:42 · Next refresh in 5s');

        // Unparseable timestamp falls back gracefully without NaN
        vm.runInContext(
            buildOverlayUpdateScript(
                makeRichPayload({ language: 'en', updatedAt: 'just now', nextRefreshSec: undefined }),
                { appComposerRingEnabled: false, appTopBarEnabled: true },
            ),
            dom.ctx,
        );
        expect(ui.meta.textContent).toBe('Updated just now');
        expect(ui.meta.textContent).not.toContain('NaN');
    });

    it('routes Open Panel action with context-aware targetTab matching each active TopBar view', () => {
        const dom = createTopBarDomHarness({ innerWidth: 1440 });
        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makeRichPayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const ui = getTopBarControls(dom.doc);
        const expectedMapping: Array<{ pill: TestElement; expectedTab: string }> = [
            { pill: ui.quotaPill, expectedTab: 'models' },
            { pill: ui.ctxPill, expectedTab: 'overview' },
            { pill: ui.speedPill, expectedTab: 'gm' },
            { pill: ui.totalPill, expectedTab: 'cost' },
        ];

        for (const { pill, expectedTab } of expectedMapping) {
            dom.fetchCalls.length = 0;
            pill.click();
            ui.openBtn.click();
            expect(dom.fetchCalls).toHaveLength(1);
            const parsed = JSON.parse(dom.fetchCalls[0].init.body || '{}') as {
                command: string;
                source: string;
                targetTab?: string;
            };
            expect(parsed).toEqual({
                command: 'openPanel',
                source: 'topbar',
                targetTab: expectedTab,
            });
        }
    });
});

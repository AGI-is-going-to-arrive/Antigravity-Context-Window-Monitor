import * as crypto from 'crypto';
import * as vm from 'vm';
import { describe, expect, it, vi } from 'vitest';
import {
    CDP_COMPOSER_HOST_ID,
    CDP_RUNTIME_GLOBAL_KEY,
    CDP_TOPBAR_HOST_ID,
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    buildOverlayUpdateScript,
    getComposerOverlayCss,
    getTopBarOverlayCss,
} from '../src/app/cdp-overlay-assets';
import type { CdpOverlayPayload } from '../src/app/sidecar-types';

type RectLike = { top: number; left: number; right: number; bottom: number; width: number; height: number };

class LayoutTestElement {
    readonly nodeType = 1;
    readonly tagName: string;
    id = '';
    className = '';
    textContent = '';
    parentNode: LayoutTestElement | null = null;
    childNodes: LayoutTestElement[] = [];
    shadowRoot: LayoutTestElement | null = null;
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    listeners = new Map<string, Array<(ev: unknown) => void>>();
    type = '';
    hidden = false;
    offsetWidth = 444;
    offsetHeight = 360;
    _rect: RectLike | null = null;
    _popoverOpen = false;
    showPopoverCalls = 0;
    hidePopoverCalls = 0;
    clickCount = 0;

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    get parentElement(): LayoutTestElement | null { return this.parentNode; }
    get firstChild(): LayoutTestElement | null { return this.childNodes[0] ?? null; }
    get firstElementChild(): LayoutTestElement | null { return this.childNodes.find(n => n.nodeType === 1) ?? null; }
    get lastElementChild(): LayoutTestElement | null {
        for (let i = this.childNodes.length - 1; i >= 0; i--) {
            if (this.childNodes[i].nodeType === 1) { return this.childNodes[i]; }
        }
        return null;
    }
    get nextSibling(): LayoutTestElement | null {
        if (!this.parentNode) { return null; }
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
    }
    get isConnected(): boolean {
        let cur: LayoutTestElement | null = this;
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

    appendChild(child: LayoutTestElement): LayoutTestElement {
        if (child.parentNode) { child.parentNode.removeChild(child); }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    insertBefore(child: LayoutTestElement, ref: LayoutTestElement | null): LayoutTestElement {
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

    removeChild(child: LayoutTestElement): LayoutTestElement {
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

    attachShadow(_opts: { mode: string }): LayoutTestElement {
        this.shadowRoot = new LayoutTestElement('#shadow-root');
        return this.shadowRoot;
    }

    showPopover(): void {
        if (this.getAttribute('popover') === null) {
            throw new Error('Not a popover');
        }
        this._popoverOpen = true;
        this.showPopoverCalls += 1;
    }

    hidePopover(): void {
        if (this._popoverOpen) {
            this._popoverOpen = false;
            this.hidePopoverCalls += 1;
        }
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

    getBoundingClientRect(): RectLike {
        return this._rect ?? { top: 6, left: 1080, right: 1360, bottom: 34, width: 280, height: 28 };
    }

    private _matchesSimple(sel: string): boolean {
        const s = sel.trim();
        if (!s) { return false; }
        if (s === ':popover-open') {
            return this._popoverOpen;
        }
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

    querySelectorAll(selector: string): LayoutTestElement[] {
        const out: LayoutTestElement[] = [];
        const walk = (node: LayoutTestElement) => {
            for (const c of node.childNodes) {
                if (c.matches(selector)) { out.push(c); }
                walk(c);
            }
        };
        walk(this);
        return out;
    }

    querySelector(selector: string): LayoutTestElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }
}

interface FakeResizeObserverInstance {
    cb: () => void;
    observed: LayoutTestElement[];
    disconnected: boolean;
}

interface FakeMutationObserverInstance {
    cb: (records: Array<{ type: string; target: LayoutTestElement }>) => void;
    disconnected: boolean;
}

function createAntigravityShellHarness(options: {
    innerWidth?: number;
    innerHeight?: number;
    userAgent?: string;
    sidebarOpen?: boolean;
    sidebarWidth?: number;
    withRightOverlay?: boolean;
    withAuxOpen?: boolean;
    withPaneToolbar?: boolean;
    paneToolbarRevealOnHover?: boolean;
    withWcoReserve?: boolean;
} = {}) {
    const innerWidth = options.innerWidth ?? 1678;
    const innerHeight = options.innerHeight ?? 1085;
    const sidebarOpen = options.sidebarOpen ?? true;
    const sidebarWidth = sidebarOpen ? (options.sidebarWidth ?? 256) : 0;

    const html = new LayoutTestElement('html');
    const body = new LayoutTestElement('body');
    html.appendChild(body);

    const shell = new LayoutTestElement('div');
    shell.className = 'agy-inset-shell';
    shell._rect = { top: 0, left: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    body.appendChild(shell);

    const sidebarSplit = new LayoutTestElement('div');
    sidebarSplit.setAttribute('data-testid', 'sidebar-split');
    sidebarSplit._rect = { top: 0, left: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    shell.appendChild(sidebarSplit);

    const sidebarOuter = new LayoutTestElement('div');
    sidebarOuter.className = 'flex';
    sidebarOuter.style.width = `${sidebarWidth}px`;
    sidebarOuter.style.visibility = sidebarOpen ? 'visible' : 'hidden';
    sidebarOuter._rect = { top: 0, left: 0, right: sidebarWidth, bottom: innerHeight, width: sidebarWidth, height: innerHeight };
    sidebarSplit.appendChild(sidebarOuter);

    const sidebarSash = new LayoutTestElement('div');
    sidebarSplit.appendChild(sidebarSash);

    const mainWrap = new LayoutTestElement('div');
    sidebarSplit.appendChild(mainWrap);

    const agySheet = new LayoutTestElement('div');
    agySheet.className = 'agy-sheet';
    if (!sidebarOpen) {
        agySheet.setAttribute('data-sidebar-closed', 'true');
    }
    agySheet._rect = { top: 0, left: sidebarWidth, right: innerWidth, bottom: innerHeight, width: innerWidth - sidebarWidth, height: innerHeight };
    mainWrap.appendChild(agySheet);

    const auxSplit = new LayoutTestElement('div');
    auxSplit.setAttribute('data-testid', 'aux-pane-split');
    agySheet.appendChild(auxSplit);

    const mainPaneWidth = options.withAuxOpen ? 634 : (innerWidth - sidebarWidth);
    const mainPane = new LayoutTestElement('div');
    mainPane._rect = { top: 0, left: sidebarWidth, right: sidebarWidth + mainPaneWidth, bottom: innerHeight, width: mainPaneWidth, height: innerHeight };
    auxSplit.appendChild(mainPane);

    const titlebarContainer = new LayoutTestElement('div');
    titlebarContainer.className = '@container/titlebar flex justify-between';
    titlebarContainer._rect = { top: 0, left: sidebarWidth, right: sidebarWidth + mainPaneWidth, bottom: 40, width: mainPaneWidth, height: 40 };
    mainPane.appendChild(titlebarContainer);

    const breadcrumbWrap = new LayoutTestElement('div');
    breadcrumbWrap.className = 'agy-layout-vars';
    const breadcrumbNav = new LayoutTestElement('nav');
    breadcrumbNav.setAttribute('aria-label', 'Breadcrumb');
    breadcrumbWrap.appendChild(breadcrumbNav);
    titlebarContainer.appendChild(breadcrumbWrap);

    let paneToolbar: LayoutTestElement | null = null;
    if (options.withPaneToolbar !== false) {
        paneToolbar = new LayoutTestElement('div');
        paneToolbar.setAttribute('data-testid', 'pane-titlebar-toolbar');
        if (options.paneToolbarRevealOnHover) {
            paneToolbar.setAttribute('data-reveal-on-hover', 'true');
        }
        paneToolbar._rect = {
            top: 0,
            left: sidebarWidth + mainPaneWidth - 140,
            right: sidebarWidth + mainPaneWidth,
            bottom: 40,
            width: 140,
            height: 40,
        };
        const moreBtn = new LayoutTestElement('button');
        moreBtn.setAttribute('data-testid', 'titlebar-more-actions');
        moreBtn._rect = { top: 6, left: sidebarWidth + mainPaneWidth - 110, right: sidebarWidth + mainPaneWidth - 82, bottom: 34, width: 28, height: 28 };
        paneToolbar.appendChild(moreBtn);
        titlebarContainer.appendChild(paneToolbar);
    }

    let auxStrip: LayoutTestElement | null = null;
    let auxDragSpacer: LayoutTestElement | null = null;
    if (options.withAuxOpen) {
        const auxPane = new LayoutTestElement('div');
        auxPane._rect = { top: 0, left: 634, right: innerWidth, bottom: innerHeight, width: innerWidth - 634, height: innerHeight };
        auxStrip = new LayoutTestElement('div');
        auxStrip.setAttribute('data-side-panel-strip', 'true');
        auxStrip._rect = { top: 0, left: 634, right: innerWidth, bottom: 40, width: innerWidth - 634, height: 40 };

        const tab = new LayoutTestElement('div');
        tab.className = 'agy-aux-tab';
        tab._rect = { top: 0, left: 640, right: 778, bottom: 40, width: 138, height: 40 };
        // Invisible hover-actions overlay that previously tricked `div.absolute.right-0.top-0`!
        const hoverClose = new LayoutTestElement('div');
        hoverClose.className = 'agy-hover-actions absolute right-0 top-0 bottom-0';
        hoverClose.style.opacity = '0';
        tab.appendChild(hoverClose);
        auxStrip.appendChild(tab);

        const newTabBtn = new LayoutTestElement('button');
        newTabBtn.setAttribute('data-testid', 'side-panel-new-tab-button');
        newTabBtn._rect = { top: 6, left: 780, right: 804, bottom: 34, width: 24, height: 24 };
        auxStrip.appendChild(newTabBtn);

        auxDragSpacer = new LayoutTestElement('div');
        auxDragSpacer.setAttribute('data-testid', 'side-panel-drag-spacer');
        auxDragSpacer._rect = { top: 0, left: 806, right: innerWidth - 80, bottom: 40, width: innerWidth - 886, height: 40 };
        auxStrip.appendChild(auxDragSpacer);

        auxPane.appendChild(auxStrip);
        auxSplit.appendChild(auxPane);
    }

    // Left Chrome Overlay (macOS traffic lights 0..88 + toggle/back/forward/search 88..212)
    const leftOverlay = new LayoutTestElement('div');
    leftOverlay.className = 'absolute left-0 top-0 flex items-center shrink-0 z-50';
    const leftOverlayWidth = options.userAgent?.includes('Windows') ? 124 : 212;
    leftOverlay._rect = { top: 0, left: 0, right: leftOverlayWidth, bottom: 40, width: leftOverlayWidth, height: 40 };
    const leftInner = new LayoutTestElement('div');
    const sidebarToggle = new LayoutTestElement('button');
    sidebarToggle.setAttribute('data-testid', 'sidebar-toggle');
    sidebarToggle.setAttribute('aria-expanded', sidebarOpen ? 'true' : 'false');
    sidebarToggle._rect = { top: 6, left: leftOverlayWidth - 124, right: leftOverlayWidth - 96, bottom: 34, width: 28, height: 28 };
    const searchBtn = new LayoutTestElement('button');
    searchBtn.setAttribute('data-testid', 'sidebar-search-button');
    searchBtn._rect = { top: 6, left: leftOverlayWidth - 28, right: leftOverlayWidth, bottom: 34, width: 28, height: 28 };
    leftInner.appendChild(sidebarToggle);
    leftInner.appendChild(searchBtn);
    leftOverlay.appendChild(leftInner);
    shell.appendChild(leftOverlay);

    // Optional Right Chrome Overlay (z:50, outside agy-sheet)
    let rightOverlayInner: LayoutTestElement | null = null;
    let maxBtn: LayoutTestElement | null = null;
    let auxBtn: LayoutTestElement | null = null;
    let wcoReserve: LayoutTestElement | null = null;

    function mountRightOverlay(withAuxButtons = true, withWco = Boolean(options.withWcoReserve)) {
        if (rightOverlayInner?.parentNode?.parentNode) {
            rightOverlayInner.parentNode.parentNode.removeChild(rightOverlayInner.parentNode);
        }
        const rightOverlay = new LayoutTestElement('div');
        rightOverlay.className = 'absolute right-0 z-50 flex items-center shrink-0';
        rightOverlay.style.top = '0px';
        rightOverlay._rect = { top: 0, left: innerWidth - 68, right: innerWidth, bottom: 40, width: 68, height: 40 };
        rightOverlayInner = new LayoutTestElement('div');
        rightOverlayInner.className = 'relative flex items-center gap-1 pr-2';
        rightOverlayInner._rect = { top: 6, left: innerWidth - 68, right: innerWidth, bottom: 34, width: 68, height: 28 };
        if (withAuxButtons) {
            maxBtn = new LayoutTestElement('button');
            maxBtn.setAttribute('data-testid', 'toggle-maximize-pane');
            maxBtn._rect = { top: 6, left: innerWidth - 68, right: innerWidth - 40, bottom: 34, width: 28, height: 28 };
            auxBtn = new LayoutTestElement('button');
            auxBtn.setAttribute('data-testid', 'toggle-aux-sidebar');
            auxBtn.setAttribute('aria-expanded', options.withAuxOpen ? 'true' : 'false');
            auxBtn._rect = { top: 6, left: innerWidth - 36, right: innerWidth - 8, bottom: 34, width: 28, height: 28 };
            rightOverlayInner.appendChild(maxBtn);
            rightOverlayInner.appendChild(auxBtn);
        } else {
            maxBtn = null;
            auxBtn = null;
        }
        if (withWco) {
            wcoReserve = new LayoutTestElement('div');
            wcoReserve.setAttribute('data-testid', 'window-controls-reserve');
            wcoReserve._rect = { top: 0, left: innerWidth - 138, right: innerWidth, bottom: 32, width: 138, height: 32 };
            rightOverlayInner.appendChild(wcoReserve);
        } else {
            wcoReserve = null;
        }
        rightOverlay.appendChild(rightOverlayInner);
        shell.appendChild(rightOverlay);
        return { rightOverlay, rightOverlayInner, maxBtn, auxBtn, wcoReserve };
    }

    if (options.withRightOverlay) {
        mountRightOverlay(true, Boolean(options.withWcoReserve));
    } else if (options.withWcoReserve) {
        mountRightOverlay(false, true);
    }

    const docListeners = new Map<string, Array<(ev: unknown) => void>>();
    const winListeners = new Map<string, Array<(ev: unknown) => void>>();
    const resizeObservers: FakeResizeObserverInstance[] = [];
    const mutationObservers: FakeMutationObserverInstance[] = [];
    const rafQueue: Array<{ id: number; fn: () => void }> = [];
    let nextRafId = 1;

    class FakeResizeObserver {
        private inst: FakeResizeObserverInstance;
        constructor(cb: () => void) {
            this.inst = { cb, observed: [], disconnected: false };
            resizeObservers.push(this.inst);
        }
        observe(el: LayoutTestElement) {
            this.inst.disconnected = false;
            this.inst.observed.push(el);
        }
        disconnect() {
            this.inst.observed = [];
            this.inst.disconnected = true;
        }
    }

    class FakeMutationObserver {
        private inst: FakeMutationObserverInstance;
        constructor(cb: (records: Array<{ type: string; target: LayoutTestElement }>) => void) {
            this.inst = { cb, disconnected: false };
            mutationObservers.push(this.inst);
        }
        observe() {}
        disconnect() {
            this.inst.disconnected = true;
        }
    }

    const doc = {
        documentElement: html,
        body,
        createElement: (tag: string) => new LayoutTestElement(tag),
        createElementNS: (_ns: string, tag: string) => new LayoutTestElement(tag),
        createTextNode: (text: string) => {
            const t = new LayoutTestElement('#text');
            t.textContent = text;
            return t;
        },
        getElementById: (id: string) => {
            const walk = (node: LayoutTestElement): LayoutTestElement | null => {
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
        getComputedStyle: (el: LayoutTestElement) => ({
            backgroundColor: 'rgb(255, 255, 255)',
            display: el?.style?.display || 'flex',
            visibility: el?.style?.visibility || 'visible',
            opacity: el?.style?.opacity || '1',
        }),
        matchMedia: () => ({ matches: false }),
    };
    win.window = win;

    const sandbox: Record<string, unknown> = {
        window: win,
        document: doc,
        navigator: {
            userAgent: options.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
            platform: options.userAgent?.includes('Windows') ? 'Win32' : 'MacIntel',
        },
        ResizeObserver: FakeResizeObserver,
        MutationObserver: FakeMutationObserver,
        requestAnimationFrame: (fn: () => void) => {
            const id = nextRafId++;
            rafQueue.push({ id, fn });
            return id;
        },
        cancelAnimationFrame: (id: number) => {
            const idx = rafQueue.findIndex(item => item.id === id);
            if (idx >= 0) { rafQueue.splice(idx, 1); }
        },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        fetch: vi.fn().mockResolvedValue({ ok: true }),
    };

    const ctx = vm.createContext(sandbox);

    function flushRaf() {
        while (rafQueue.length > 0) {
            const next = rafQueue.shift()!;
            next.fn();
        }
    }

    function setSidebarState(open: boolean, width = 256) {
        const w = open ? width : 0;
        sidebarOuter.style.width = `${w}px`;
        sidebarOuter.style.visibility = open ? 'visible' : 'hidden';
        sidebarOuter._rect = { top: 0, left: 0, right: w, bottom: innerHeight, width: w, height: innerHeight };
        sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            agySheet.removeAttribute('data-sidebar-closed');
        } else {
            agySheet.setAttribute('data-sidebar-closed', 'true');
        }
        agySheet._rect = { top: 0, left: w, right: Number(win.innerWidth), bottom: innerHeight, width: Number(win.innerWidth) - w, height: innerHeight };
    }

    function triggerResizeObservers() {
        for (const ro of resizeObservers) {
            if (!ro.disconnected) { ro.cb(); }
        }
        flushRaf();
    }

    function triggerLayoutAttributeMutation(target: LayoutTestElement) {
        for (const mo of mutationObservers) {
            if (!mo.disconnected) { mo.cb([{ type: 'attributes', target }]); }
        }
        flushRaf();
    }

    function dispatchTransitionEnd(propertyName = 'width') {
        for (const fn of (docListeners.get('transitionend') ?? [])) {
            fn({ propertyName });
        }
        flushRaf();
    }

    function dispatchResize(nextW: number, nextH = innerHeight) {
        win.innerWidth = nextW;
        win.innerHeight = nextH;
        for (const fn of (winListeners.get('resize') ?? [])) {
            fn({});
        }
    }

    return {
        ctx,
        win,
        doc,
        body,
        shell,
        sidebarSplit,
        sidebarOuter,
        agySheet,
        mainPane,
        titlebarContainer,
        paneToolbar,
        auxStrip,
        auxDragSpacer,
        leftOverlay,
        sidebarToggle,
        searchBtn,
        get rightOverlayInner() { return rightOverlayInner; },
        get maxBtn() { return maxBtn; },
        get auxBtn() { return auxBtn; },
        get wcoReserve() { return wcoReserve; },
        mountRightOverlay,
        setSidebarState,
        triggerResizeObservers,
        triggerLayoutAttributeMutation,
        dispatchTransitionEnd,
        dispatchResize,
        flushRaf,
        resizeObservers,
        mutationObservers,
        docListeners,
    };
}

function makePayload(overrides: Partial<CdpOverlayPayload> = {}): CdpOverlayPayload {
    return {
        updatedAt: '2026-11-25T10:30:00.000Z',
        nextRefreshSec: 5,
        language: 'zh',
        theme: 'light',
        modelName: 'Gemini 4 Neon Extra High',
        contextUsedTokens: 12_000,
        contextEffectiveLimit: 256_000,
        contextNativeLimit: 1_000_000,
        contextPct: 4.7,
        outputSpeedTps: 137.5,
        avgOutputSpeedTps: 156.4,
        peakOutputSpeedTps: 192.0,
        recentCallCount: 854,
        ttftMs: 13_700,
        recentCacheHitPct: 88,
        avgCacheHitPct: 84,
        turnCacheState: 'warm',
        estCostUsd: 106.26,
        estCostFormatted: '$106.26',
        inputTokens: 42_000,
        outputTokens: 14_000,
        cacheReadTokens: 320_000,
        totalTokens: 376_000,
        cumulativeRecordedTokens: 797_500_000,
        todayTokens: 34_000_000,
        todayCostFormatted: '$148.93',
        cumulativeCostFormatted: '$987.72',
        recordedDaysCount: 65,
        sessionCount: 241,
        subscriptionRoiSummary: 'Google AI Ultra 20x · 0.6x',
        tightestQuotaPct: 94,
        tightestQuotaWindowTag: 'wk',
        sessionQuota5hPct: 100,
        sessionQuotaWeeklyPct: 94,
        quotaPools: [
            {
                poolKey: 'gemini-4',
                label: 'Gemini 4 Neon',
                modelChips: ['Neon Extra High'],
                remainingPct: 94,
                windowTag: 'wk',
                resetCountdown: '5d 4h',
                isCurrentSessionModel: true,
                health: 'good',
            },
        ],
        bridgeUrl: 'http://127.0.0.1:54321',
        bridgeToken: crypto.randomBytes(32).toString('hex'),
        ...overrides,
    };
}

function buildLiveComposerDom(
    parent: LayoutTestElement,
    options: {
        metadataBarPosition?: 'top' | 'bottom' | 'none';
        permTestId?: boolean;
        permLabel?: string;
        permAriaLabel?: string;
        withMic?: boolean;
        actionKind?: 'voice-live-pill' | 'send' | 'cancel' | 'loading' | 'none';
        unfocusedPane?: boolean;
    } = {},
) {
    const paneWrap = new LayoutTestElement('div');
    if (options.unfocusedPane) {
        paneWrap.setAttribute('data-pane-unfocused', 'true');
    }
    const inputBox = new LayoutTestElement('div');
    inputBox.setAttribute('data-testid', 'agent-input-box');
    const surfaceComposer = new LayoutTestElement('div');
    surfaceComposer.className = 'surface-composer';
    inputBox.appendChild(surfaceComposer);
    paneWrap.appendChild(inputBox);
    parent.appendChild(paneWrap);

    const makeMetadataBar = () => {
        const metaBar = new LayoutTestElement('div');
        metaBar.setAttribute('data-testid', 'input-box-bottom-toolbar');
        const metaRow = new LayoutTestElement('div');
        metaRow.className = 'flex items-center gap-0.5 min-w-0 flex-1';
        const locBtn = new LayoutTestElement('button');
        locBtn.setAttribute('data-testid', 'location-selector-trigger');
        locBtn.textContent = 'This Computer';
        const projBtn = new LayoutTestElement('button');
        projBtn.setAttribute('data-testid', 'project-selector-trigger');
        projBtn.textContent = 'antigravity context monitor';
        const branchBtn = new LayoutTestElement('button');
        branchBtn.textContent = 'main';
        metaRow.appendChild(locBtn);
        metaRow.appendChild(projBtn);
        metaRow.appendChild(branchBtn);
        metaBar.appendChild(metaRow);
        return { metaBar, metaRow, locBtn, projBtn, branchBtn };
    };

    const metaPos = options.metadataBarPosition ?? 'top';
    const meta = metaPos !== 'none' ? makeMetadataBar() : null;
    if (meta && metaPos === 'top') {
        surfaceComposer.appendChild(meta.metaBar);
    }

    const card = new LayoutTestElement('div');
    card.className = 'surface-composer-card';
    const editor = new LayoutTestElement('div');
    editor.setAttribute('contenteditable', 'true');
    card.appendChild(editor);

    const footer = new LayoutTestElement('div');
    footer.setAttribute('data-agent-composer-root', '');
    footer.className = 'agy-composer-footer @container/input-footer';

    const leftGroup = new LayoutTestElement('div');
    leftGroup.className = 'flex min-w-0 flex-1 items-center';
    const addBtn = new LayoutTestElement('button');
    addBtn.setAttribute('aria-label', 'Add context');
    addBtn.textContent = '+';
    const modelBtn = new LayoutTestElement('button');
    modelBtn.setAttribute('data-testid', 'model-selector-trigger');
    modelBtn.textContent = 'Gemini 4 Neon Extra High';
    leftGroup.appendChild(addBtn);
    leftGroup.appendChild(modelBtn);

    const rightGroup = new LayoutTestElement('div');
    rightGroup.className = 'shrink-0 flex items-center gap-0.5';

    let permBtn: LayoutTestElement | null = null;
    if (options.permTestId !== false || options.permLabel || options.permAriaLabel) {
        permBtn = new LayoutTestElement('button');
        if (options.permTestId !== false) {
            permBtn.setAttribute('data-testid', 'permissions-selector-trigger');
        }
        if (options.permAriaLabel) {
            permBtn.setAttribute('aria-label', options.permAriaLabel);
        } else if (options.permTestId !== false) {
            permBtn.setAttribute('aria-label', `Agent permissions preset selector, current: ${options.permLabel ?? 'Turbo'}`);
        }
        permBtn.textContent = options.permLabel !== undefined ? options.permLabel : 'Turbo';
        rightGroup.appendChild(permBtn);
    }

    const efdGroup = new LayoutTestElement('div');
    efdGroup.className = 'flex items-center gap-1.5';

    if (options.withMic !== false) {
        const micWrap = new LayoutTestElement('div');
        const micBtn = new LayoutTestElement('button');
        micBtn.setAttribute('aria-label', 'Record voice memo');
        micBtn.setAttribute('data-tooltip-id', 'input-send-button-record-tooltip');
        micWrap.appendChild(micBtn);
        efdGroup.appendChild(micWrap);
    }

    const actionKind = options.actionKind ?? 'send';
    let actionBtn: LayoutTestElement | null = null;
    let voiceLivePill: LayoutTestElement | null = null;
    if (actionKind !== 'none') {
        const actionWrap = new LayoutTestElement('div');
        actionWrap.className = 'relative flex items-center gap-1';
        if (actionKind === 'voice-live-pill') {
            const outerSpan = new LayoutTestElement('span');
            voiceLivePill = new LayoutTestElement('span');
            voiceLivePill.setAttribute('data-testid', 'voice-live-pill');
            actionBtn = new LayoutTestElement('button');
            actionBtn.setAttribute('data-testid', 'voice-start-button');
            voiceLivePill.appendChild(actionBtn);
            outerSpan.appendChild(voiceLivePill);
            actionWrap.appendChild(outerSpan);
        } else if (actionKind === 'send') {
            actionBtn = new LayoutTestElement('button');
            actionBtn.setAttribute('data-testid', 'send-button');
            actionBtn.className = 'agy-send-button';
            actionWrap.appendChild(actionBtn);
        } else if (actionKind === 'cancel') {
            actionBtn = new LayoutTestElement('button');
            actionBtn.setAttribute('data-testid', 'input-cancel-button');
            actionWrap.appendChild(actionBtn);
        } else if (actionKind === 'loading') {
            actionBtn = new LayoutTestElement('button');
            actionBtn.setAttribute('data-testid', 'send-button-loading');
            actionWrap.appendChild(actionBtn);
        }
        efdGroup.appendChild(actionWrap);
    }

    if (efdGroup.childNodes.length > 0) {
        rightGroup.appendChild(efdGroup);
    }

    footer.appendChild(leftGroup);
    footer.appendChild(rightGroup);
    card.appendChild(footer);
    surfaceComposer.appendChild(card);

    if (meta && metaPos === 'bottom') {
        surfaceComposer.appendChild(meta.metaBar);
    }

    return {
        paneWrap,
        inputBox,
        surfaceComposer,
        metaBar: meta?.metaBar ?? null,
        metaRow: meta?.metaRow ?? null,
        locBtn: meta?.locBtn ?? null,
        card,
        footer,
        leftGroup,
        rightGroup,
        permBtn,
        efdGroup,
        actionBtn,
        voiceLivePill,
    };
}

describe('Antigravity App CDP Overlay Layout, Top Layer Popover & Composer Anchor Regressions', () => {
    it('enforces Top Layer popover CSS overrides (inset: auto; margin: 0) and flex-shrink: 0 without innerHTML', () => {
        const composerCss = getComposerOverlayCss();
        const topBarCss = getTopBarOverlayCss();
        expect(composerCss).toMatch(/:host\s*\{[^}]*flex-shrink:\s*0;/);
        expect(composerCss).toMatch(/\.acm-popover\s*\{[^}]*inset:\s*auto;[^}]*margin:\s*0;/);
        expect(topBarCss).toMatch(/:host\s*\{[^}]*flex-shrink:\s*0;/);
        expect(topBarCss).toMatch(/\.acm-quota-popover\s*\{[^}]*inset:\s*auto;[^}]*margin:\s*0;/);
        expect(topBarCss).toMatch(/\.acm-overflow-menu\s*\{[^}]*inset:\s*auto;[^}]*margin:\s*0;/);
    });

    it('never mounts TopBar HUD inside @container/titlebar over macOS traffic lights when sidebar is collapsed, and re-anchors to rightOverlay when it appears', () => {
        // Reproduces Screenshot 1: sidebar collapsed, no rightOverlay yet (e.g., Plugins/Settings or New Convo)
        const dom = createAntigravityShellHarness({
            innerWidth: 1440,
            innerHeight: 900,
            sidebarOpen: false,
            withRightOverlay: false,
            withPaneToolbar: true,
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
        expect(host).toBeTruthy();
        // NEVER mounted as firstChild of @container/titlebar (which overlapped traffic lights + toggle + back/forward + search!)
        expect(host.parentNode).not.toBe(dom.titlebarContainer);
        expect(host.parentNode).toBe(dom.paneToolbar);
        expect(host.getAttribute('data-anchor-tier')).toBe('pane-toolbar');
        expect(host.style.flexShrink).toBe('0');

        // When paneToolbar is hover-only / absent (macOS Home / Settings full-sidebar view), falls back cleanly to Tier 4 fixed top-right
        dom.paneToolbar!.setAttribute('data-reveal-on-hover', 'true');
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );
        expect(host.parentNode).toBe(dom.body);
        expect(host.getAttribute('data-anchor')).toBe('fixed');
        expect(host.getAttribute('data-anchor-tier')).toBe('fixed');
        // Fixed maxWidth strictly guarantees clearance from leftOverlay (212px)
        const fixedMaxW = parseInt(host.style.maxWidth || '0', 10);
        expect(fixedMaxW).toBeGreaterThan(0);
        expect(fixedMaxW).toBeLessThanOrEqual(1440 - 10 - 212 - 8);

        // Navigating to a conversation mounts Right Chrome Overlay -> MUST automatically re-anchor out of fixed into rightOverlay!
        const mounted = dom.mountRightOverlay(true, false);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );
        expect(host.parentNode).toBe(mounted.rightOverlayInner);
        expect(host.nextSibling).toBe(mounted.maxBtn);
        expect(host.getAttribute('data-anchor')).toBe('inline');
        expect(host.getAttribute('data-anchor-tier')).toBe('right-overlay');
        // Fixed-only inline styles are cleared when returning to inline mode
        expect(host.style.maxWidth).toBe('');
    });

    it('mounts TopBar before window-controls-reserve on Windows/Linux non-conversation screens without double WCO spacing and ignores invisible hover-actions overlays', () => {
        const dom = createAntigravityShellHarness({
            innerWidth: 1440,
            innerHeight: 900,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            sidebarOpen: false,
            withRightOverlay: false,
            withAuxOpen: true,
            withPaneToolbar: false,
            withWcoReserve: true,
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
        expect(host.parentNode).toBe(dom.rightOverlayInner);
        expect(host.nextSibling).toBe(dom.wcoReserve);
        expect(host.getAttribute('data-anchor-tier')).toBe('right-overlay');
        // Zero double WCO spacer
        const wcoSpacer = host.shadowRoot!.querySelector('.acm-wco-spacer')!;
        expect(wcoSpacer.style.display).toBe('none');
    });

    it('promotes TopBar popover to Top Layer (popover="manual"), clamps clear of open left sidebar across all 4 tabs, and dynamically repositions when sidebar toggles or resizes', () => {
        // Reproduces Screenshots 3 & 4: sidebar OPEN (0..256px), clicking speed ('137.5 tok/s') & total ('797.5M')
        const dom = createAntigravityShellHarness({
            innerWidth: 1440,
            innerHeight: 900,
            sidebarOpen: true,
            sidebarWidth: 256,
            withRightOverlay: true,
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
        const sr = host.shadowRoot!;
        const cluster = sr.querySelector('.acm-bar-cluster')!;
        const popover = sr.querySelector('.acm-quota-popover')!;
        const speedPill = sr.querySelector('[data-view="speed"]')!;
        const totalPill = sr.querySelector('[data-view="total"]')!;
        const quotaPill = sr.querySelector('[data-view="quota"]')!;
        const ctxPill = sr.querySelector('[data-view="context"]')!;

        expect(popover.getAttribute('popover')).toBe('manual');
        expect(sr.querySelector('.acm-overflow-menu')!.getAttribute('popover')).toBe('manual');

        // Even in the worst case where cluster sits immediately right of sidebar (x: 260..540 like Screenshots 3 & 4),
        // the 444px popover MUST NEVER be clipped behind the 256px left sidebar!
        cluster._rect = { top: 6, left: 260, right: 540, bottom: 34, width: 280, height: 28 };
        popover.offsetWidth = 444;
        popover.offsetHeight = 460;

        speedPill.click();
        expect(popover.classList.contains('is-open')).toBe(true);
        expect(popover._popoverOpen).toBe(true);
        expect(popover.showPopoverCalls).toBe(1);

        const speedLeft = parseInt(popover.style.left || '0', 10);
        expect(speedLeft).toBeGreaterThanOrEqual(256 + 8);
        expect(speedLeft + 444).toBeLessThanOrEqual(1440 - 10);

        // Switching across all 4 pills/tabs stays completely clear of sidebar AND stays horizontally steady
        for (const pill of [totalPill, quotaPill, ctxPill, speedPill]) {
            pill.click();
            const curLeft = parseInt(popover.style.left || '0', 10);
            expect(curLeft).toBe(speedLeft);
            expect(curLeft).toBeGreaterThanOrEqual(256 + 8);
            expect(curLeft + 444).toBeLessThanOrEqual(1440 - 10);
        }

        // Dragging left sidebar wider (256px -> 390px) while popover is OPEN dynamically shifts popover right!
        dom.setSidebarState(true, 390);
        dom.triggerResizeObservers();
        const shiftedLeft = parseInt(popover.style.left || '0', 10);
        expect(shiftedLeft).toBeGreaterThanOrEqual(390 + 8);
        expect(shiftedLeft + 444).toBeLessThanOrEqual(1440 - 10);

        // Collapsing sidebar while popover is OPEN updates safeLeft dynamically via attribute mutation / transitionend
        dom.setSidebarState(false, 0);
        cluster._rect = { top: 6, left: 1080, right: 1360, bottom: 34, width: 280, height: 28 };
        dom.triggerLayoutAttributeMutation(dom.agySheet);
        dom.dispatchTransitionEnd('width');
        const collapsedLeft = parseInt(popover.style.left || '0', 10);
        expect(collapsedLeft).toBe(1360 - 444);
        expect(collapsedLeft).toBeGreaterThanOrEqual(10);

        // Ultra-narrow window with wide open sidebar (vw=640, sidebar=320, pw=444 -> 640-320 < 444):
        // falls back to Top Layer float inside [10, vw - pw - 10] instead of clipping off right edge!
        dom.setSidebarState(true, 320);
        dom.dispatchResize(640, 800);
        const narrowLeft = parseInt(popover.style.left || '0', 10);
        expect(narrowLeft).toBeGreaterThanOrEqual(10);
        expect(narrowLeft + 444).toBeLessThanOrEqual(640 - 10);

        // Closing popover calls hidePopover()
        sr.querySelector('[aria-label="Close"]')!.click();
        expect(popover._popoverOpen).toBe(false);
        expect(popover.hidePopoverCalls).toBeGreaterThanOrEqual(1);

        // Unmount('all') disconnects all observers and removes transitionend listener
        const beforeUnmountListeners = dom.docListeners.get('transitionend')?.length ?? 0;
        expect(beforeUnmountListeners).toBe(1);
        vm.runInContext(buildOverlayUnmountScript('all'), dom.ctx);
        expect(dom.docListeners.get('transitionend')?.length ?? 0).toBe(0);
        expect(dom.resizeObservers.every(ro => ro.disconnected)).toBe(true);
        expect(dom.mutationObservers.every(mo => mo.disconnected)).toBe(true);
    });

    it('budgets TopBar pill visibility from real free space when AUX_PANE is open (all 4 pills on wide drag spacer, collapses cleanly when aux tabs crowd)', () => {
        // Reproduces live 1678px window: main pane is 634px, AUX_PANE has 792px drag spacer -> MUST keep all 4 pills visible!
        const dom = createAntigravityShellHarness({
            innerWidth: 1678,
            innerHeight: 1085,
            sidebarOpen: false,
            withRightOverlay: true,
            withAuxOpen: true,
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const sr = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!.shadowRoot!;
        expect(sr.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(false);
        expect(sr.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(false);
        expect(sr.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(false);
        expect(sr.querySelector('[aria-label="More telemetry"]')!.classList.contains('is-hidden')).toBe(true);

        // Crowd aux tabs right up near rightOverlay (free space ~ 120px) -> collapses smoothly into ··· without overlapping tabs!
        dom.auxDragSpacer!._rect = { top: 0, left: 1474, right: 1598, bottom: 40, width: 124, height: 40 };
        dom.triggerResizeObservers();
        expect(sr.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(true);
        expect(sr.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(true);
        expect(sr.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(true);
        expect(sr.querySelector('[aria-label="More telemetry"]')!.classList.contains('is-hidden')).toBe(false);
    });

    it('anchors Composer Context Ring immediately left of Turbo (NEVER next to This Computer in top input-box-bottom-toolbar) on New Conversation', () => {
        // Exact Screenshot 5 repro: New Conversation renders input-box-bottom-toolbar ABOVE surface-composer-card!
        const dom = createAntigravityShellHarness({
            innerWidth: 1440,
            innerHeight: 900,
            sidebarOpen: true,
            withRightOverlay: true,
        });
        const composer = buildLiveComposerDom(dom.mainPane, {
            metadataBarPosition: 'top',
            permTestId: true,
            permLabel: 'Turbo',
            withMic: true,
            actionKind: 'send',
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: false }),
            dom.ctx,
        );

        const composerHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
        expect(composerHost).toBeTruthy();
        expect(composerHost.parentNode).toBe(composer.rightGroup);
        expect(composerHost.nextSibling).toBe(composer.permBtn);
        expect(composerHost.style.flexShrink).toBe('0');
        // Top metadata bar ("This Computer | repo | main") MUST remain completely untouched!
        expect(composer.metaRow!.childNodes).toHaveLength(3);
        expect(composer.metaRow!.childNodes[0]).toBe(composer.locBtn);

        // Composer popover uses Top Layer popover="manual" and clamps clear of open sidebar!
        const popover = composerHost.shadowRoot!.querySelector('.acm-popover')!;
        const trigger = composerHost.shadowRoot!.querySelector('.acm-ring-trigger')!;
        expect(popover.getAttribute('popover')).toBe('manual');
        trigger._rect = { top: 840, left: 300, right: 326, bottom: 866, width: 26, height: 26 };
        popover.offsetWidth = 344;
        popover.offsetHeight = 320;
        trigger.click();
        expect(popover._popoverOpen).toBe(true);
        expect(popover.showPopoverCalls).toBe(1);
        expect(parseInt(popover.style.left || '0', 10)).toBeGreaterThanOrEqual(256 + 8);
        trigger.click();
        expect(popover._popoverOpen).toBe(false);
        expect(popover.hidePopoverCalls).toBe(1);
    });

    it('handles Composer fallback without voice-live-pill trap, re-anchors when permissions-selector-trigger mounts later, and supports all presets/i18n/icon-only/cancel/multi-pane', () => {
        const dom = createAntigravityShellHarness({ innerWidth: 1440, innerHeight: 900 });

        // 1. Metadata bar at top + NO permissions-selector-trigger yet + voice-live-pill active ->
        //    MUST walk up out of voice-live-pill to mount in rightGroup (before efdGroup), NEVER inside voice-live-pill or metadata bar!
        const c1 = buildLiveComposerDom(dom.mainPane, {
            metadataBarPosition: 'top',
            permTestId: false,
            withMic: true,
            actionKind: 'voice-live-pill',
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: false }),
            dom.ctx,
        );

        const composerHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
        expect(composerHost.parentNode).toBe(c1.rightGroup);
        expect(composerHost.parentNode).not.toBe(c1.voiceLivePill);
        expect(composerHost.parentNode).not.toBe(c1.metaRow);
        expect(composerHost.nextSibling).toBe(c1.efdGroup);

        // 2. React later renders permissions-selector-trigger (e.g. <400px icon-only mode with empty text!) ->
        //    anchorComposerHost() MUST NOT be stuck on sticky isConnected; snaps immediately BEFORE permissions-selector-trigger!
        const latePerm = dom.doc.createElement('button');
        latePerm.setAttribute('data-testid', 'permissions-selector-trigger');
        latePerm.setAttribute('aria-label', 'Agent permissions preset selector, current: Request Review');
        latePerm.textContent = ''; // <400px icon-only mode!
        c1.rightGroup.insertBefore(latePerm, c1.efdGroup);

        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: false }),
            dom.ctx,
        );
        expect(composerHost.parentNode).toBe(c1.rightGroup);
        expect(composerHost.nextSibling).toBe(latePerm);

        // 3. Test non-Turbo presets & i18n labels & cancel button without data-testid on permission button
        for (const modeLabel of ['Request Review', 'Default', 'Auto', '请求审核', '默认', '极速']) {
            dom.mainPane.removeChild(c1.paneWrap);
            const cMode = buildLiveComposerDom(dom.mainPane, {
                metadataBarPosition: 'top',
                permTestId: false,
                permLabel: modeLabel,
                withMic: false,
                actionKind: 'cancel',
            });
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: false }),
                dom.ctx,
            );
            expect(composerHost.parentNode).toBe(cMode.rightGroup);
            expect(composerHost.nextSibling).toBe(cMode.permBtn);
            dom.mainPane.removeChild(cMode.paneWrap);
        }

        // 4. Multi-pane: prefers focused pane over unfocused pane ([data-pane-unfocused="true"])
        const unfocused = buildLiveComposerDom(dom.mainPane, {
            metadataBarPosition: 'top',
            permTestId: true,
            permLabel: 'Turbo',
            unfocusedPane: true,
        });
        const focused = buildLiveComposerDom(dom.mainPane, {
            metadataBarPosition: 'top',
            permTestId: true,
            permLabel: 'Request Review',
            unfocusedPane: false,
        });
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: false }),
            dom.ctx,
        );
        expect(composerHost.parentNode).toBe(focused.rightGroup);
        expect(composerHost.nextSibling).toBe(focused.permBtn);
        expect(composerHost.parentNode).not.toBe(unfocused.rightGroup);
    });

    it('avoids double-subtracting WCO inset from fixed host.maxWidth on Windows and clears cluster.maxWidth when leaving fixed mode', () => {
        // Windows narrow viewport (600px) + open sidebar (256px) + WCO fallback (138px), no rightOverlay/paneToolbar
        const dom = createAntigravityShellHarness({
            innerWidth: 600,
            innerHeight: 800,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            sidebarOpen: true,
            sidebarWidth: 256,
            withRightOverlay: false,
            withPaneToolbar: false,
            withWcoReserve: false,
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
        const cluster = host.shadowRoot!.querySelector('.acm-bar-cluster')!;
        const wcoSpacer = host.shadowRoot!.querySelector('.acm-wco-spacer')!;
        expect(host.getAttribute('data-anchor')).toBe('fixed');
        expect(wcoSpacer.style.width).toBe('138px');

        // Total host budget = 600 - 10 - 256 - 8 = 326px (NOT double-subtracting 138px!)
        // Cluster budget = 326 - (138 + 5) = 183px
        expect(parseInt(host.style.maxWidth || '0', 10)).toBe(326);
        expect(parseInt(cluster.style.maxWidth || '0', 10)).toBe(183);

        // Returning to inline right-overlay clears both host.maxWidth and cluster.maxWidth
        dom.mountRightOverlay(true, true);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );
        expect(host.getAttribute('data-anchor')).toBe('inline');
        expect(host.style.maxWidth).toBe('');
        expect(cluster.style.maxWidth).toBe('');
    });

    it('falls through cleanly from hidden toggle-aux-sidebar to visible Tier 3 pane-toolbar (including data-reveal-on-hover="false") or Tier 4 fixed', () => {
        const dom = createAntigravityShellHarness({
            innerWidth: 1440,
            innerHeight: 900,
            sidebarOpen: false,
            withRightOverlay: true,
            withPaneToolbar: true,
        });

        // Hide rightOverlay/toggle-aux-sidebar and explicitly set data-reveal-on-hover="false" on paneToolbar
        dom.rightOverlayInner!.style.display = 'none';
        dom.paneToolbar!.setAttribute('data-reveal-on-hover', 'false');

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );

        const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
        // Must NOT mount inside hidden toggle-aux-sidebar parent; falls through cleanly to Tier 3 pane-toolbar
        expect(host.parentNode).toBe(dom.paneToolbar);
        expect(host.getAttribute('data-anchor-tier')).toBe('pane-toolbar');

        // If paneToolbar also becomes hover-only hidden, falls through cleanly to Tier 4 fixed
        dom.paneToolbar!.setAttribute('data-reveal-on-hover', 'true');
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
            dom.ctx,
        );
        expect(host.parentNode).toBe(dom.body);
        expect(host.getAttribute('data-anchor-tier')).toBe('fixed');
    });

    it('detects deeply nested (>12 ancestor) hidden/faded panes and immediately re-anchors Composer Ring on data-pane-unfocused switch', () => {
        const dom = createAntigravityShellHarness({ innerWidth: 1440, innerHeight: 900 });

        // Build a deeply nested (>18 ancestors) hidden pane (simulating live Antigravity depth ~38-40)
        const hiddenRoot = dom.doc.createElement('div');
        hiddenRoot.style.opacity = '0';
        let deepCursor = hiddenRoot;
        for (let d = 0; d < 20; d++) {
            const wrap = dom.doc.createElement('div');
            deepCursor.appendChild(wrap);
            deepCursor = wrap;
        }
        dom.mainPane.appendChild(hiddenRoot);
        const hiddenComposer = buildLiveComposerDom(deepCursor, {
            metadataBarPosition: 'top',
            permTestId: true,
            permLabel: 'Turbo',
        });

        // Two visible split panes (paneA initially focused, paneB initially unfocused)
        const paneA = buildLiveComposerDom(dom.mainPane, {
            metadataBarPosition: 'top',
            permTestId: true,
            permLabel: 'Turbo',
            unfocusedPane: false,
        });
        const paneB = buildLiveComposerDom(dom.mainPane, {
            metadataBarPosition: 'top',
            permTestId: true,
            permLabel: 'Request Review',
            unfocusedPane: true,
        });

        vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
        vm.runInContext(
            buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: false }),
            dom.ctx,
        );

        const composerHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
        // Skips 20-level-deep opacity:0 pane and unfocused paneB -> mounts in focused paneA
        expect(composerHost.parentNode).toBe(paneA.rightGroup);
        expect(composerHost.nextSibling).toBe(paneA.permBtn);
        expect(composerHost.parentNode).not.toBe(hiddenComposer.rightGroup);

        // User clicks into paneB -> data-pane-unfocused swaps -> MutationObserver immediately re-anchors Composer Ring to paneB!
        paneA.paneWrap.setAttribute('data-pane-unfocused', 'true');
        paneB.paneWrap.removeAttribute('data-pane-unfocused');
        dom.triggerLayoutAttributeMutation(paneB.paneWrap);

        expect(composerHost.parentNode).toBe(paneB.rightGroup);
        expect(composerHost.nextSibling).toBe(paneB.permBtn);
    });
});

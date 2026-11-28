// Consolidated Domain Suite: App CDP Overlays, Topbar Views & P3A Polish
import * as crypto from 'crypto';
import * as vm from 'vm';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    buildOverlayUpdateScript,
    CDP_COMPOSER_HOST_ID,
    CDP_OVERLAY_BUILD_ID,
    CDP_OVERLAY_SCRIPT_VERSION,
    CDP_RUNTIME_GLOBAL_KEY,
    CDP_TOPBAR_HOST_ID,
    getComposerOverlayCss,
    getSharedOverlayThemeCss,
    getTopBarOverlayCss,
} from '../src/app/cdp-overlay-assets';
import type { CdpOverlayBridgeAction, CdpOverlayPayload } from '../src/app/sidecar-types';
import * as http from 'http';
import {
    ALLOWED_OVERLAY_TARGET_TABS,
    type CdpClientLike,
    type CdpTargetInfo,
    createCdpAmbientOverlayManager,
    createOverlayActionBridge,
    parseOverlayTargetTab,
} from '../src/app/cdp-injector';
import type { CdpOverlayRuntimePayload } from '../src/client/browser/cdp-overlay-types';

describe('[app-cdp-overlay-layout-regressions]', () => {
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
        platform?: string;
        sidebarOpen?: boolean;
        sidebarWidth?: number;
        withRightOverlay?: boolean;
        withAuxOpen?: boolean;
        withPaneToolbar?: boolean;
        paneToolbarRevealOnHover?: boolean;
        withWcoReserve?: boolean;
        windowControlsOverlay?: { visible: boolean; rect: Partial<RectLike> };
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
        let moreBtn: LayoutTestElement | null = null;
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
            moreBtn = new LayoutTestElement('button');
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
        const wcoListeners = new Map<string, Array<(ev: unknown) => void>>();
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
                paddingRight: el?.style?.paddingRight || '0px',
                borderRightWidth: el?.style?.borderRightWidth || '0px',
            }),
            matchMedia: () => ({ matches: false }),
        };
        win.window = win;

        let wcoState: { visible: boolean; rect: Partial<RectLike> } | null = options.windowControlsOverlay ?? null;
        const wcoObj = {
            get visible() { return Boolean(wcoState?.visible); },
            getTitlebarAreaRect: () => ({ ...(wcoState?.rect ?? { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) }),
            addEventListener: (type: string, fn: (ev: unknown) => void) => {
                const list = wcoListeners.get(type) ?? [];
                list.push(fn);
                wcoListeners.set(type, list);
            },
            removeEventListener: (type: string, fn: (ev: unknown) => void) => {
                const list = wcoListeners.get(type);
                if (!list) { return; }
                const idx = list.indexOf(fn);
                if (idx >= 0) { list.splice(idx, 1); }
            },
        };

        const inferredPlatform = options.platform
            ?? (options.userAgent?.includes('Windows')
                ? 'Win32'
                : (options.userAgent?.includes('Linux') ? 'Linux x86_64' : 'MacIntel'));

        const navObj: Record<string, unknown> = {
            userAgent: options.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
            platform: inferredPlatform,
        };
        if (wcoState) {
            navObj.windowControlsOverlay = wcoObj;
        }

        const fetchCalls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
        const fetchMock = vi.fn().mockImplementation((url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
            fetchCalls.push({ url, init });
            return Promise.resolve({ ok: true });
        });

        const sandbox: Record<string, unknown> = {
            window: win,
            document: doc,
            navigator: navObj,
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
            fetch: fetchMock,
        };

        const ctx = vm.createContext(sandbox);

        function setWindowControlsOverlay(next: { visible: boolean; rect: Partial<RectLike> } | null) {
            wcoState = next;
            if (next) {
                navObj.windowControlsOverlay = wcoObj;
            } else {
                delete navObj.windowControlsOverlay;
            }
        }

        function dispatchWcoGeometryChange() {
            for (const fn of (wcoListeners.get('geometrychange') ?? [])) {
                fn({ titlebarAreaRect: wcoObj.getTitlebarAreaRect(), visible: wcoObj.visible });
            }
        }

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

        function dispatchWinEvent(type: string) {
            for (const fn of (winListeners.get(type) ?? [])) {
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
            moreBtn,
            auxStrip,
            auxDragSpacer,
            leftOverlay,
            sidebarToggle,
            searchBtn,
            get rightOverlay() { return rightOverlayInner?.parentNode ?? null; },
            get rightOverlayInner() { return rightOverlayInner; },
            get maxBtn() { return maxBtn; },
            get auxBtn() { return auxBtn; },
            get wcoReserve() { return wcoReserve; },
            mountRightOverlay,
            setWindowControlsOverlay,
            dispatchWcoGeometryChange,
            setSidebarState,
            triggerResizeObservers,
            triggerLayoutAttributeMutation,
            dispatchTransitionEnd,
            dispatchResize,
            dispatchWinEvent,
            flushRaf,
            fetchCalls,
            fetchMock,
            resizeObservers,
            mutationObservers,
            docListeners,
            winListeners,
            wcoListeners,
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
            sr.querySelector('[data-action="close"]')!.click();
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
            expect(sr.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(true);

            // Crowd aux tabs right up near rightOverlay (free space ~ 120px) -> collapses smoothly into ··· without overlapping tabs!
            dom.auxDragSpacer!._rect = { top: 0, left: 1474, right: 1598, bottom: 40, width: 124, height: 40 };
            dom.triggerResizeObservers();
            expect(sr.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(true);
            expect(sr.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(true);
            expect(sr.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(true);
            expect(sr.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(false);
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

        it('fixes Issue #77: Windows 2.35.2 two-row inline right-overlay without window-controls-reserve has zero wcoSpacer gap and keeps all 4 pills visible (AUX closed & open)', () => {
            // Exact Issue #77 repro (1024px Windows Antigravity 2.35.2 two-row layout):
            // Row 1 (0..32px): dark OS titlebar with _ □ × (WCO visible, right=886, rightGap=138), NO window-controls-reserve on Row 2.
            // Row 2 (38..78px): conversation header with rightOverlay + toggle-aux-sidebar at left=988, top=50 (>= 48!).
            const dom = createAntigravityShellHarness({
                innerWidth: 1024,
                innerHeight: 768,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: true,
                sidebarWidth: 256,
                withRightOverlay: true,
                withWcoReserve: false,
                withAuxOpen: false,
                withPaneToolbar: true,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 886, width: 886, height: 32 },
                },
            });

            // Remove maxBtn so only toggle-aux-sidebar sits at the far right of Row 2 (exact screenshot DOM)
            dom.rightOverlayInner!.removeChild(dom.maxBtn!);
            dom.rightOverlay!._rect = { top: 38, left: 980, right: 1024, bottom: 78, width: 44, height: 40 };
            dom.rightOverlayInner!._rect = { top: 44, left: 980, right: 1024, bottom: 78, width: 44, height: 34 };
            dom.auxBtn!._rect = { top: 50, left: 988, right: 1016, bottom: 78, width: 28, height: 28 };

            // Row 2 native pane toolbar buttons totaling 136px (more + Open IDE + doc icon):
            // With buggy rightChromeLeft = 1024 - 10 - 146 = 868 -> freeSpace = 868 - 256 - 136 - 140 - 24 = 312 (< 340 -> collapsed!)
            // With fixed rightChromeLeft = 988 (from following sibling auxBtn) -> freeSpace = 988 - 256 - 136 - 140 - 24 = 432 (>= 340 -> all 4 visible!)
            dom.paneToolbar!._rect = { top: 38, left: 450, right: 590, bottom: 74, width: 140, height: 36 };
            dom.moreBtn!._rect = { top: 44, left: 454, right: 482, bottom: 72, width: 28, height: 28 };
            const openIdeBtn = dom.doc.createElement('button');
            openIdeBtn._rect = { top: 44, left: 486, right: 562, bottom: 72, width: 76, height: 28 };
            const docBtn = dom.doc.createElement('button');
            docBtn._rect = { top: 44, left: 566, right: 590, bottom: 72, width: 24, height: 28 };
            dom.paneToolbar!.appendChild(openIdeBtn);
            dom.paneToolbar!.appendChild(docBtn);

            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                dom.ctx,
            );

            const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const sr = host.shadowRoot!;
            const wcoSpacer = sr.querySelector('.acm-wco-spacer')!;
            expect(host.getAttribute('data-anchor')).toBe('inline');
            expect(host.getAttribute('data-anchor-tier')).toBe('right-overlay');
            expect(host.parentNode).toBe(dom.rightOverlayInner);
            expect(host.nextSibling).toBe(dom.auxBtn);
            expect(wcoSpacer.style.display).toBe('none');
            expect(wcoSpacer.style.width).toBe('0px');
            expect(sr.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(false);
            expect(sr.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(false);
            expect(sr.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(false);
            expect(sr.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(true);

            // Same Windows 2.35.2 Row-2 setup with AUX_PANE OPEN:
            // auxTabsRight = 620 -> fixed freeSpace = 988 - 620 - 16 = 352 (>= 340 -> all 4 pills visible!)
            // (buggy 868 - 620 - 16 = 232 < 275 would have hidden both total & speed!)
            const domAux = createAntigravityShellHarness({
                innerWidth: 1024,
                innerHeight: 768,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: false,
                withRightOverlay: true,
                withWcoReserve: false,
                withAuxOpen: true,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 886, width: 886, height: 32 },
                },
            });
            domAux.rightOverlayInner!.removeChild(domAux.maxBtn!);
            domAux.rightOverlay!._rect = { top: 38, left: 980, right: 1024, bottom: 78, width: 44, height: 40 };
            domAux.auxBtn!._rect = { top: 50, left: 988, right: 1016, bottom: 78, width: 28, height: 28 };
            domAux.auxStrip!._rect = { top: 38, left: 500, right: 1024, bottom: 78, width: 524, height: 40 };
            domAux.auxDragSpacer!._rect = { top: 38, left: 620, right: 980, bottom: 78, width: 360, height: 40 };

            vm.runInContext(buildOverlayBootstrapScript(), domAux.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domAux.ctx,
            );

            const hostAux = domAux.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const srAux = hostAux.shadowRoot!;
            const wcoSpacerAux = srAux.querySelector('.acm-wco-spacer')!;
            expect(hostAux.getAttribute('data-anchor')).toBe('inline');
            expect(wcoSpacerAux.style.display).toBe('none');
            expect(wcoSpacerAux.style.width).toBe('0px');
            expect(srAux.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(false);
            expect(srAux.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(false);
            expect(srAux.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(false);
            expect(srAux.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(true);

            // When AUX tabs crowd near 988, it still collapses cleanly into ··· without overlapping tabs
            domAux.auxDragSpacer!._rect = { top: 38, left: 860, right: 980, bottom: 78, width: 120, height: 40 };
            domAux.triggerResizeObservers();
            expect(srAux.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(true);
            expect(srAux.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(true);
            expect(srAux.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(true);
            expect(srAux.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(false);
        });

        it('keeps wcoSpacer at 0px on Windows single-row inline layouts without window-controls-reserve (CSS-padded right-overlay & populated pane-toolbar) and measures pane-toolbar right-chrome accurately', () => {
            // 1. Single-row CSS-padded right-overlay (no window-controls-reserve)
            const domRight = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: false,
                withRightOverlay: true,
                withWcoReserve: false,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 1302, width: 1302, height: 32 },
                },
            });
            domRight.rightOverlayInner!.style.paddingRight = '140px';
            domRight.maxBtn!._rect = { top: 6, left: 1230, right: 1258, bottom: 34, width: 28, height: 28 };
            domRight.auxBtn!._rect = { top: 6, left: 1262, right: 1290, bottom: 34, width: 28, height: 28 };

            vm.runInContext(buildOverlayBootstrapScript(), domRight.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domRight.ctx,
            );

            const rightHost = domRight.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const rightSpacer = rightHost.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(rightHost.getAttribute('data-anchor')).toBe('inline');
            expect(rightHost.getAttribute('data-anchor-tier')).toBe('right-overlay');
            expect(rightHost.nextSibling).toBe(domRight.maxBtn);
            expect(rightSpacer.style.display).toBe('none');
            expect(rightSpacer.style.width).toBe('0px');

            // 2. Populated Tier 3 pane-toolbar without right-overlay / window-controls-reserve (no gap before moreBtn, no phantom WCO subtraction)
            const domTb = createAntigravityShellHarness({
                innerWidth: 1024,
                innerHeight: 768,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: true,
                sidebarWidth: 440,
                withRightOverlay: false,
                withWcoReserve: false,
                withPaneToolbar: true,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 886, width: 886, height: 32 },
                },
            });
            // Row-2 populated pane-toolbar with moreBtn at left=988, top=50:
            // Free space = 988 - 440 - 140 - 24 = 384 >= 340 -> all 4 pills stay visible (no phantom 146px WCO subtraction!)
            domTb.titlebarContainer._rect = { top: 38, left: 440, right: 1024, bottom: 78, width: 584, height: 40 };
            domTb.paneToolbar!._rect = { top: 38, left: 940, right: 1024, bottom: 78, width: 84, height: 40 };
            domTb.moreBtn!._rect = { top: 50, left: 988, right: 1016, bottom: 78, width: 28, height: 28 };

            vm.runInContext(buildOverlayBootstrapScript(), domTb.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domTb.ctx,
            );

            const tbHost = domTb.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const tbSr = tbHost.shadowRoot!;
            const tbSpacer = tbSr.querySelector('.acm-wco-spacer')!;
            expect(tbHost.getAttribute('data-anchor')).toBe('inline');
            expect(tbHost.getAttribute('data-anchor-tier')).toBe('pane-toolbar');
            expect(tbHost.nextSibling).toBe(domTb.moreBtn);
            expect(tbSpacer.style.display).toBe('none');
            expect(tbSpacer.style.width).toBe('0px');
            expect(tbSr.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(false);
            expect(tbSr.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(true);

            // Moving moreBtn left to 720 (crowded toolbar) accurately reflects following-sibling right chrome and collapses to ···
            domTb.moreBtn!._rect = { top: 50, left: 720, right: 748, bottom: 78, width: 28, height: 28 };
            domTb.triggerResizeObservers();
            expect(tbSr.querySelector('[data-view="total"]')!.classList.contains('is-hidden')).toBe(true);
            expect(tbSr.querySelector('[data-view="speed"]')!.classList.contains('is-hidden')).toBe(true);
            expect(tbSr.querySelector('[data-view="context"]')!.classList.contains('is-hidden')).toBe(true);
            expect(tbSr.querySelector('[data-action="overflow"]')!.classList.contains('is-hidden')).toBe(false);
        });

        it('skips empty Row-1 pane-toolbar overlapping right WCO cutout (falling through to Tier 4 fixed) while keeping Row-2 or CSS-padded empty pane-toolbar inline', () => {
            // 1. Windows empty Row-1 pane-toolbar overlapping right WCO -> MUST fall through to Tier 4 fixed with wcoSpacer = 146px
            const domWin = createAntigravityShellHarness({
                innerWidth: 1024,
                innerHeight: 768,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: false,
                withRightOverlay: false,
                withWcoReserve: false,
                withPaneToolbar: true,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 886, width: 886, height: 32 },
                },
            });
            domWin.paneToolbar!.removeChild(domWin.moreBtn!);
            domWin.paneToolbar!._rect = { top: 0, bottom: 32, left: 884, right: 1024, width: 140, height: 32 };

            vm.runInContext(buildOverlayBootstrapScript(), domWin.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );

            const winHost = domWin.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const winSpacer = winHost.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(winHost.parentNode).toBe(domWin.body);
            expect(winHost.getAttribute('data-anchor')).toBe('fixed');
            expect(winHost.getAttribute('data-anchor-tier')).toBe('fixed');
            expect(winSpacer.style.display).toBe('block');
            expect(winSpacer.style.width).toBe('146px');

            // 2. Linux right-WCO empty Row-1 pane-toolbar -> falls through to Tier 4 fixed with wcoSpacer = 118px
            const domLinux = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
                sidebarOpen: false,
                withRightOverlay: false,
                withWcoReserve: false,
                withPaneToolbar: true,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 1330, width: 1330, height: 32 },
                },
            });
            domLinux.paneToolbar!.removeChild(domLinux.moreBtn!);
            domLinux.paneToolbar!._rect = { top: 0, bottom: 32, left: 1280, right: 1440, width: 160, height: 32 };

            vm.runInContext(buildOverlayBootstrapScript(), domLinux.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domLinux.ctx,
            );

            const linuxHost = domLinux.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const linuxSpacer = linuxHost.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(linuxHost.parentNode).toBe(domLinux.body);
            expect(linuxHost.getAttribute('data-anchor')).toBe('fixed');
            expect(linuxSpacer.style.display).toBe('block');
            expect(linuxSpacer.style.width).toBe('118px');

            // 3. Windows empty Row-2 pane-toolbar (top: 36..72, below WCO cutout) -> stays inline with wcoSpacer = 0px
            domWin.paneToolbar!._rect = { top: 36, bottom: 72, left: 884, right: 1024, width: 140, height: 36 };
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );
            expect(winHost.parentNode).toBe(domWin.paneToolbar);
            expect(winHost.getAttribute('data-anchor')).toBe('inline');
            expect(winHost.getAttribute('data-anchor-tier')).toBe('pane-toolbar');
            expect(winSpacer.style.display).toBe('none');
            expect(winSpacer.style.width).toBe('0px');

            // 4. Windows empty Row-1 pane-toolbar WITH paddingRight: '140px' (tbContentRight = 884 <= 886) -> stays inline with wcoSpacer = 0px
            domWin.paneToolbar!._rect = { top: 0, bottom: 32, left: 744, right: 1024, width: 280, height: 32 };
            domWin.paneToolbar!.style.paddingRight = '140px';
            // Also verify resilient handling when getComputedStyle throws on padding lookup (falls back cleanly to style.paddingRight)
            const origGetComputedStyle = domWin.win.getComputedStyle as (el: LayoutTestElement) => Record<string, string>;
            domWin.win.getComputedStyle = (el: LayoutTestElement) => {
                if (el === domWin.paneToolbar) {
                    return { display: 'flex', visibility: 'visible', opacity: '1' };
                }
                return origGetComputedStyle(el);
            };
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );
            expect(winHost.parentNode).toBe(domWin.paneToolbar);
            expect(winHost.getAttribute('data-anchor')).toBe('inline');
            expect(winSpacer.style.display).toBe('none');
            expect(winSpacer.style.width).toBe('0px');
        });

        it('handles Windows fixed <-> inline round-trip transitions cleanly (146px -> 0px -> 146px)', () => {
            const dom = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: false,
                withRightOverlay: false,
                withPaneToolbar: false,
                withWcoReserve: false,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 1302, width: 1302, height: 32 },
                },
            });

            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                dom.ctx,
            );

            const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const wcoSpacer = host.shadowRoot!.querySelector('.acm-wco-spacer')!;

            // 1. Fixed mode reserves WCO via WCO API (1440 - 1302 + 8 = 146px)
            expect(host.getAttribute('data-anchor')).toBe('fixed');
            expect(wcoSpacer.style.display).toBe('block');
            expect(wcoSpacer.style.width).toBe('146px');

            // 2. Navigating to a screen with right-overlay (even without window-controls-reserve) clears wcoSpacer to 0px
            const mounted = dom.mountRightOverlay(true, false);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                dom.ctx,
            );
            expect(host.getAttribute('data-anchor')).toBe('inline');
            expect(host.parentNode).toBe(mounted.rightOverlayInner);
            expect(wcoSpacer.style.display).toBe('none');
            expect(wcoSpacer.style.width).toBe('0px');

            // 3. Leaving conversation removes right-overlay -> returns to fixed and restores 146px
            dom.shell.removeChild(mounted.rightOverlay);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                dom.ctx,
            );
            expect(host.getAttribute('data-anchor')).toBe('fixed');
            expect(host.parentNode).toBe(dom.body);
            expect(wcoSpacer.style.display).toBe('block');
            expect(wcoSpacer.style.width).toBe('146px');
        });

        it('handles computeWcoInsetPx(true) boundary cases: Windows RTL/Fullscreen, empty DOMRect(0,0,0,0), hidden-then-visible reserve, and Linux/macOS WCO sides', () => {
            // 1. Windows Fullscreen / RTL (wco.visible=true, right === vw -> rightGap === 0) MUST return 0px, NOT fall through to 138px!
            const domWin = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: false,
                withRightOverlay: false,
                withPaneToolbar: false,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 1440, width: 1440, height: 32 },
                },
            });
            vm.runInContext(buildOverlayBootstrapScript(), domWin.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );
            const winHost = domWin.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const winSpacer = winHost.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(winHost.getAttribute('data-anchor')).toBe('fixed');
            expect(winSpacer.style.display).toBe('none');
            expect(winSpacer.style.width).toBe('0px');

            // Windows RTL (buttons on left: left=138, right=1440) -> still 0px!
            domWin.setWindowControlsOverlay({
                visible: true,
                rect: { top: 0, bottom: 32, left: 138, right: 1440, width: 1302, height: 32 },
            });
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );
            expect(winSpacer.style.display).toBe('none');
            expect(winSpacer.style.width).toBe('0px');

            // 2. Empty DOMRect(0,0,0,0) -> NEVER produces vw + 8 (1448px); falls back cleanly to 138px on Windows, 0px on macOS/Linux
            domWin.setWindowControlsOverlay({
                visible: true,
                rect: { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
            });
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );
            expect(winSpacer.style.display).toBe('block');
            expect(winSpacer.style.width).toBe('138px');

            const domMac = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
                sidebarOpen: false,
                withRightOverlay: false,
                withPaneToolbar: false,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
                },
            });
            vm.runInContext(buildOverlayBootstrapScript(), domMac.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domMac.ctx,
            );
            const macSpacer = domMac.doc.getElementById(CDP_TOPBAR_HOST_ID)!.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(macSpacer.style.display).toBe('none');
            expect(macSpacer.style.width).toBe('0px');

            // 3. Hidden legacy-window-controls-reserve followed by visible window-controls-reserve (width: 132) in fixed mode -> uses 140px
            const hiddenLegacyReserve = domWin.doc.createElement('div');
            hiddenLegacyReserve.setAttribute('data-testid', 'legacy-window-controls-reserve');
            hiddenLegacyReserve.style.display = 'none';
            hiddenLegacyReserve._rect = { top: 0, left: 1300, right: 1440, bottom: 32, width: 140, height: 32 };
            const visibleReserve = domWin.doc.createElement('div');
            visibleReserve.setAttribute('data-testid', 'window-controls-reserve');
            visibleReserve._rect = { top: 0, left: 1308, right: 1440, bottom: 32, width: 132, height: 32 };
            // Direct body children so Tier 2 skips anchoring to them and Tier 4 fixed exercises computeWcoInsetPx(true)
            domWin.body.appendChild(hiddenLegacyReserve);
            domWin.body.appendChild(visibleReserve);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domWin.ctx,
            );
            expect(winHost.getAttribute('data-anchor')).toBe('fixed');
            expect(winSpacer.style.display).toBe('block');
            expect(winSpacer.style.width).toBe('140px');

            // 4. Linux right-WCO fixed (rightGap = 110 -> 118px) vs Linux/macOS left-WCO fixed (left = 78, right = vw -> 0px)
            const domLinux = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
                sidebarOpen: false,
                withRightOverlay: false,
                withPaneToolbar: false,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 1330, width: 1330, height: 32 },
                },
            });
            vm.runInContext(buildOverlayBootstrapScript(), domLinux.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domLinux.ctx,
            );
            const linuxSpacer = domLinux.doc.getElementById(CDP_TOPBAR_HOST_ID)!.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(linuxSpacer.style.display).toBe('block');
            expect(linuxSpacer.style.width).toBe('118px');

            domLinux.setWindowControlsOverlay({
                visible: true,
                rect: { top: 0, bottom: 32, left: 78, right: 1440, width: 1362, height: 32 },
            });
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domLinux.ctx,
            );
            expect(linuxSpacer.style.display).toBe('none');
            expect(linuxSpacer.style.width).toBe('0px');

            domMac.setWindowControlsOverlay({
                visible: true,
                rect: { top: 0, bottom: 32, left: 78, right: 1440, width: 1362, height: 32 },
            });
            // Visible top-left macOS traffic-light window-controls-reserve (left=0, right=78, width=78)
            // MUST be ignored by both Tier 2 and computeWcoInsetPx(true) -> fixed mode keeps wcoSpacer = 0px!
            const macLeftReserve = domMac.doc.createElement('div');
            macLeftReserve.setAttribute('data-testid', 'window-controls-reserve');
            macLeftReserve._rect = { top: 0, left: 0, right: 78, bottom: 32, width: 78, height: 32 };
            domMac.shell.appendChild(macLeftReserve);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                domMac.ctx,
            );
            const macHost = domMac.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            expect(macHost.getAttribute('data-anchor')).toBe('fixed');
            expect(macSpacer.style.display).toBe('none');
            expect(macSpacer.style.width).toBe('0px');
        });

        it('keeps anchorTopBarHost() (Tier 3 pane-toolbar) and anchorComposerHost() (Tier 2c) idempotent across repeated update ticks without self-referential insertBefore', () => {
            const dom = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                sidebarOpen: false,
                withRightOverlay: false,
                withPaneToolbar: true,
            });
            // Add a Tier 2c composer footer (no perm/action buttons -> returns { parent: rightGroup, before: rightGroup.firstChild })
            const footer = dom.doc.createElement('div');
            footer.className = 'agy-composer-footer';
            const leftGroup = dom.doc.createElement('div');
            const rightGroup = dom.doc.createElement('div');
            const customRightBtn = dom.doc.createElement('button');
            customRightBtn.textContent = 'Custom';
            rightGroup.appendChild(customRightBtn);
            footer.appendChild(leftGroup);
            footer.appendChild(rightGroup);
            dom.mainPane.appendChild(footer);

            const tbInsertSpy = vi.spyOn(dom.paneToolbar!, 'insertBefore');
            const tbAppendSpy = vi.spyOn(dom.paneToolbar!, 'appendChild');
            const compInsertSpy = vi.spyOn(rightGroup, 'insertBefore');
            const compAppendSpy = vi.spyOn(rightGroup, 'appendChild');

            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            const topHost = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const compHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
            expect(dom.paneToolbar!.childNodes[0]).toBe(topHost);
            expect(dom.paneToolbar!.childNodes[1]).toBe(dom.moreBtn);
            expect(topHost.nextSibling).toBe(dom.moreBtn);
            expect(rightGroup.childNodes[0]).toBe(compHost);
            expect(rightGroup.childNodes[1]).toBe(customRightBtn);
            expect(compHost.nextSibling).toBe(customRightBtn);
            expect(tbInsertSpy).toHaveBeenCalledTimes(1);
            expect(compInsertSpy).toHaveBeenCalledTimes(1);

            // Repeat 3 update ticks -> MUST remain strictly before moreBtn / customRightBtn with ZERO extra DOM mutations
            for (let tick = 0; tick < 3; tick++) {
                vm.runInContext(
                    buildOverlayUpdateScript(makePayload({ contextPct: 10 + tick }), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                    dom.ctx,
                );
            }

            expect(dom.paneToolbar!.childNodes[0]).toBe(topHost);
            expect(dom.paneToolbar!.childNodes[1]).toBe(dom.moreBtn);
            expect(topHost.nextSibling).toBe(dom.moreBtn);
            expect(rightGroup.childNodes[0]).toBe(compHost);
            expect(rightGroup.childNodes[1]).toBe(customRightBtn);
            expect(compHost.nextSibling).toBe(customRightBtn);
            expect(tbInsertSpy).toHaveBeenCalledTimes(1);
            expect(tbAppendSpy).toHaveBeenCalledTimes(0);
            expect(compInsertSpy).toHaveBeenCalledTimes(1);
            expect(compAppendSpy).toHaveBeenCalledTimes(0);
        });

        it('updates fixed wcoSpacer live on windowControlsOverlay geometrychange events and removes the listener on unmount("all")', () => {
            const dom = createAntigravityShellHarness({
                innerWidth: 1440,
                innerHeight: 900,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                sidebarOpen: false,
                withRightOverlay: false,
                withPaneToolbar: false,
                windowControlsOverlay: {
                    visible: true,
                    rect: { top: 0, bottom: 32, left: 0, right: 1302, width: 1302, height: 32 },
                },
            });

            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: false, appTopBarEnabled: true }),
                dom.ctx,
            );

            const host = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
            const wcoSpacer = host.shadowRoot!.querySelector('.acm-wco-spacer')!;
            expect(dom.wcoListeners.get('geometrychange')?.length).toBe(1);
            expect(wcoSpacer.style.display).toBe('block');
            expect(wcoSpacer.style.width).toBe('146px');

            // DPI / caption width change fires geometrychange -> wcoSpacer updates immediately without window.resize
            dom.setWindowControlsOverlay({
                visible: true,
                rect: { top: 0, bottom: 32, left: 0, right: 1340, width: 1340, height: 32 },
            });
            dom.dispatchWcoGeometryChange();
            expect(wcoSpacer.style.display).toBe('block');
            expect(wcoSpacer.style.width).toBe('108px');

            // Entering fullscreen fires geometrychange with right === vw -> wcoSpacer collapses to 0px immediately
            dom.setWindowControlsOverlay({
                visible: true,
                rect: { top: 0, bottom: 32, left: 0, right: 1440, width: 1440, height: 32 },
            });
            dom.dispatchWcoGeometryChange();
            expect(wcoSpacer.style.display).toBe('none');
            expect(wcoSpacer.style.width).toBe('0px');

            // unmount('all') removes the geometrychange listener cleanly
            vm.runInContext(buildOverlayUnmountScript('all'), dom.ctx);
            expect(dom.wcoListeners.get('geometrychange')?.length).toBe(0);
        });

        it('makes all 4 watermark tick tooltips (Composer & TopBar compaction + 200k tier) pointer-interactive, keyboard-focusable, edge-clamped, and localized (EN/ZH/both)', () => {
            // 1. CSS rules: tick hit targets MUST have pointer-events: auto (NEVER pointer-events: none!) and render Shadow DOM ::after tooltips
            const composerCss = getComposerOverlayCss();
            const topBarCss = getTopBarOverlayCss();

            const extractRule = (css: string, selector: string) => {
                const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
                return m ? m[1] : '';
            };

            const composerTickRule = extractRule(composerCss, '.acm-watermark-tick');
            const topBarTickRule = extractRule(topBarCss, '.acm-qp-watermark-tick');
            expect(composerTickRule).toContain('pointer-events: auto');
            expect(composerTickRule).not.toContain('pointer-events: none');
            expect(composerTickRule).toContain('cursor: help');
            expect(topBarTickRule).toContain('pointer-events: auto');
            expect(topBarTickRule).not.toContain('pointer-events: none');
            expect(topBarTickRule).toContain('cursor: help');

            // Both Shadow DOM stylesheets include ::before hairline + ::after tooltip + left/right edge alignment + :hover/:focus-visible + Turn Cache pill tooltip
            for (const [css, prefix] of [
                [composerCss, '.acm-watermark-tick'],
                [topBarCss, '.acm-qp-watermark-tick'],
            ] as const) {
                expect(css).toContain(`${prefix}::before`);
                expect(css).toContain(`${prefix}::after`);
                expect(css).toContain('content: attr(data-tooltip)');
                expect(css).toContain(`${prefix}.is-align-left::after`);
                expect(css).toContain(`${prefix}.is-align-right::after`);
                expect(css).toContain(`${prefix}:hover::after`);
                expect(css).toContain(`${prefix}:focus-visible::after`);
                expect(css).toContain('.acm-pill-badge.acm-has-tip::after');
                expect(css).toContain('.acm-pill-badge.acm-has-tip:hover::after');
            }

            // 2. Live VM DOM verification across EN, ZH, and bilingual ('both') modes + edge alignment clamping + Turn Cache plain-language tooltips
            const dom = createAntigravityShellHarness({ innerWidth: 1440, innerHeight: 900 });
            buildLiveComposerDom(dom.mainPane, { metadataBarPosition: 'top', permTestId: true, actionKind: 'send' });
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);

            const scenarios: Array<{
                lang: 'en' | 'zh' | 'both';
                compactionPct: number;
                tier200kPct: number;
                turnCacheState: 'warm' | 'partial' | 'cold';
                expectCompSub: string;
                expectTierSubs: string[];
                expectCacheSubs: string[];
                expectCompAlign: 'left' | 'right' | 'center';
                expectTierAlign: 'left' | 'right' | 'center';
            }> = [
                {
                    lang: 'both',
                    compactionPct: 85,
                    tier200kPct: 20,
                    turnCacheState: 'warm',
                    expectCompSub: 'Auto-compaction limit / 自动压缩上限 85%',
                    expectTierSubs: ['not an extra Antigravity subscription charge', '不会对订阅额外扣费或强制截断'],
                    expectCacheSubs: ['>=70%', 'faster first token', '热缓存命中'],
                    expectCompAlign: 'right',
                    expectTierAlign: 'left',
                },
                {
                    lang: 'en',
                    compactionPct: 50,
                    tier200kPct: 78.1,
                    turnCacheState: 'partial',
                    expectCompSub: 'Auto-compaction limit 50%',
                    expectTierSubs: ['200k long-context tier', 'not an extra Antigravity subscription charge'],
                    expectCacheSubs: ['10-70% reused', 'partial prefix reuse'],
                    expectCompAlign: 'center',
                    expectTierAlign: 'right',
                },
                {
                    lang: 'zh',
                    compactionPct: 85,
                    tier200kPct: 25,
                    turnCacheState: 'cold',
                    expectCompSub: '自动压缩上限 85%',
                    expectTierSubs: ['200k 长上下文参考阶梯', '不会对订阅额外扣费或强制截断'],
                    expectCacheSubs: ['冷启动', '<10%', '切换模型'],
                    expectCompAlign: 'right',
                    expectTierAlign: 'left',
                },
            ];

            for (const sc of scenarios) {
                vm.runInContext(
                    buildOverlayUpdateScript(
                        makePayload({
                            language: sc.lang,
                            compactionThresholdPct: sc.compactionPct,
                            tier200kMarkerPct: sc.tier200kPct,
                            turnCacheState: sc.turnCacheState,
                        }),
                        { appComposerRingEnabled: true, appTopBarEnabled: true },
                    ),
                    dom.ctx,
                );

                // Composer ticks (ticks #1 and #2) + Turn Cache badge
                const compSr = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!.shadowRoot!;
                const compTickComp = compSr.querySelector('.acm-watermark-tick.is-compaction') ?? compSr.querySelector('.is-compaction')!;
                const compTick200k = compSr.querySelector('.acm-watermark-tick.is-tier200k') ?? compSr.querySelector('.is-tier200k')!;
                const compTurnBadge = compSr.querySelector('.acm-has-tip')!;

                // TopBar Context view ticks (ticks #3 and #4) + Turn Cache badge
                const topSr = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!.shadowRoot!;
                const ctxPill = topSr.querySelector('[data-view="context"]')!;
                if (!topSr.querySelector('.acm-quota-popover')!.classList.contains('is-open')) {
                    ctxPill.click();
                } else if (topSr.querySelector('.acm-quota-popover')!.getAttribute('data-active-view') !== 'context') {
                    ctxPill.click();
                }
                const topBody = topSr.querySelector('.acm-qp-body')!;
                const topTickComp = topBody.querySelector('.is-compaction')!;
                const topTick200k = topBody.querySelector('.is-tier200k')!;
                const topCtxTurnBadge = topBody.querySelector('.acm-has-tip')!;

                const verifyTick = (
                    el: LayoutTestElement,
                    expectedSubs: string[],
                    expectedAlign: 'left' | 'right' | 'center',
                ) => {
                    expect(el).toBeTruthy();
                    const tip = el.getAttribute('data-tooltip') ?? '';
                    expect(el.getAttribute('title')).toBeNull();
                    expect(el.getAttribute('aria-label')).toBe(tip);
                    for (const sub of expectedSubs) {
                        expect(tip).toContain(sub);
                    }
                    expect(el.getAttribute('tabindex')).toBe('0');
                    expect(el.getAttribute('role')).toBe('img');
                    expect(el.classList.contains('is-align-left')).toBe(expectedAlign === 'left');
                    expect(el.classList.contains('is-align-right')).toBe(expectedAlign === 'right');
                };

                const verifyTurnBadge = (el: LayoutTestElement, expectedSubs: string[]) => {
                    expect(el).toBeTruthy();
                    const tip = el.getAttribute('data-tooltip') ?? '';
                    expect(el.getAttribute('title')).toBeNull();
                    expect(el.getAttribute('aria-label')).toContain(tip);
                    expect(el.getAttribute('tabindex')).toBe('0');
                    for (const sub of expectedSubs) {
                        expect(tip).toContain(sub);
                    }
                };

                verifyTick(compTickComp, [sc.expectCompSub], sc.expectCompAlign);
                verifyTick(compTick200k, sc.expectTierSubs, sc.expectTierAlign);
                verifyTick(topTickComp, [sc.expectCompSub], sc.expectCompAlign);
                verifyTick(topTick200k, sc.expectTierSubs, sc.expectTierAlign);
                verifyTurnBadge(compTurnBadge, sc.expectCacheSubs);
                verifyTurnBadge(topCtxTurnBadge, sc.expectCacheSubs);
            }
        });

        it('reports Hub focusConversation transitions (UUID, brand-new chat, deduplication, sidebar isolation, and listener cleanup on unmount)', () => {
            const dom = createAntigravityShellHarness({ innerWidth: 1440, innerHeight: 900 });
            buildLiveComposerDom(dom.mainPane, { metadataBarPosition: 'top', permTestId: true, actionKind: 'send' });

            // Add an unrelated historical conversation item inside sidebar to verify it NEVER hijacks New Chat detection
            const sidebarNav = dom.doc.createElement('aside');
            const oldSidebarItem = dom.doc.createElement('div');
            oldSidebarItem.setAttribute('data-conversation-id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
            sidebarNav.appendChild(oldSidebarItem);
            dom.sidebarOuter.appendChild(sidebarNav);

            const uuidA = '0323401e-1fdf-418a-a0eb-8697e0becc9f';
            const uuidB = '11111111-2222-4333-8444-555555555555';
            const loc = { pathname: `/c/${uuidA}`, search: '', hash: '' };
            dom.win.location = loc;

            const payload = makePayload();
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            // 1. Initial mount on /c/<uuidA> reports focusConversation with uuidA
            expect(dom.fetchCalls).toHaveLength(1);
            expect(dom.fetchCalls[0].url).toBe(`${payload.bridgeUrl}/api/overlay/action`);
            expect(dom.fetchCalls[0].init.headers?.['X-Monitor-Token']).toBe(payload.bridgeToken);
            expect(JSON.parse(dom.fetchCalls[0].init.body || '{}')).toEqual({
                command: 'focusConversation',
                source: 'topbar',
                conversationId: uuidA,
                focusRevision: 1,
                isNewConversation: false,
            });

            // 2. Subsequent identical applyState ticks are strictly deduplicated (ZERO extra fetch calls!)
            vm.runInContext(
                buildOverlayUpdateScript(makePayload({ contextPct: 12, bridgeUrl: payload.bridgeUrl, bridgeToken: payload.bridgeToken }), {
                    appComposerRingEnabled: true,
                    appTopBarEnabled: true,
                }),
                dom.ctx,
            );
            expect(dom.fetchCalls).toHaveLength(1);

            // 3. Bare root route '/' with a visible composer MUST NOT fabricate isNewConversation: true (D9 anti-hijack);
            //    only explicit new-chat routes ('/new-chat') or [data-new-conversation="true"] emit isNewConversation: true.
            loc.pathname = '/';
            dom.dispatchWinEvent('popstate');
            expect(dom.fetchCalls).toHaveLength(1);

            loc.pathname = '/new-chat';
            dom.dispatchWinEvent('popstate');
            expect(dom.fetchCalls).toHaveLength(2);
            expect(JSON.parse(dom.fetchCalls[1].init.body || '{}')).toEqual({
                command: 'focusConversation',
                source: 'topbar',
                conversationId: null,
                focusRevision: 2,
                isNewConversation: true,
            });

            // Repeated popstate on same new-chat route is deduplicated
            dom.dispatchWinEvent('popstate');
            expect(dom.fetchCalls).toHaveLength(2);

            // 4. Navigating via hashchange to #/c/<uuidB> reports uuidB immediately
            loc.hash = `#/c/${uuidB}`;
            dom.dispatchWinEvent('hashchange');
            expect(dom.fetchCalls).toHaveLength(3);
            expect(JSON.parse(dom.fetchCalls[2].init.body || '{}')).toEqual({
                command: 'focusConversation',
                source: 'topbar',
                conversationId: uuidB,
                focusRevision: 3,
                isNewConversation: false,
            });

            // 5. unmount('all') removes popstate & hashchange listeners cleanly
            expect(dom.winListeners.get('popstate')?.length).toBe(1);
            expect(dom.winListeners.get('hashchange')?.length).toBe(1);
            vm.runInContext(buildOverlayUnmountScript('all'), dom.ctx);
            expect(dom.winListeners.get('popstate')?.length).toBe(0);
            expect(dom.winListeners.get('hashchange')?.length).toBe(0);
        });
    });
});

describe('[app-cdp-p3a-polish]', () => {
    type RichOverlayPayload = CdpOverlayPayload & Partial<CdpOverlayRuntimePayload>;


    class PolishTestElement {
        readonly nodeType: number;
        readonly tagName: string;
        id = '';
        className = '';
        textContent = '';
        parentNode: PolishTestElement | null = null;
        childNodes: PolishTestElement[] = [];
        shadowRoot: PolishTestElement | null = null;
        attributes = new Map<string, string>();
        style: Record<string, string> = {};
        listeners = new Map<string, Array<(ev: unknown) => void>>();
        type = '';
        hidden = false;
        offsetWidth = 380;
        offsetHeight = 320;
        _rect: { top: number; left: number; right: number; bottom: number; width: number; height: number } | null = null;
        clickCount = 0;
        focusCount = 0;

        constructor(tag: string, nodeType = 1) {
            this.tagName = tag.toUpperCase();
            this.nodeType = nodeType;
        }

        get parentElement(): PolishTestElement | null { return this.parentNode; }
        get firstChild(): PolishTestElement | null { return this.childNodes[0] ?? null; }
        get firstElementChild(): PolishTestElement | null { return this.childNodes.find(n => n.nodeType === 1) ?? null; }
        get lastElementChild(): PolishTestElement | null {
            for (let i = this.childNodes.length - 1; i >= 0; i--) {
                if (this.childNodes[i].nodeType === 1) { return this.childNodes[i]; }
            }
            return null;
        }
        get nextSibling(): PolishTestElement | null {
            if (!this.parentNode) { return null; }
            const idx = this.parentNode.childNodes.indexOf(this);
            return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
        }
        get isConnected(): boolean {
            let cur: PolishTestElement | null = this;
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

        appendChild(child: PolishTestElement): PolishTestElement {
            if (child.parentNode) { child.parentNode.removeChild(child); }
            child.parentNode = this;
            this.childNodes.push(child);
            return child;
        }

        insertBefore(child: PolishTestElement, ref: PolishTestElement | null): PolishTestElement {
            if (child.parentNode) { child.parentNode.removeChild(child); }
            child.parentNode = this;
            if (!ref) {
                this.childNodes.push(child);
                return child;
            }
            const idx = this.childNodes.indexOf(ref);
            if (idx < 0) { this.childNodes.push(child); }
            else { this.childNodes.splice(idx, 0, child); }
            return child;
        }

        removeChild(child: PolishTestElement): PolishTestElement {
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

        attachShadow(): PolishTestElement {
            this.shadowRoot = new PolishTestElement('#shadow-root');
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

        dispatch(type: string, extra: Record<string, unknown> = {}): { defaultPrevented: boolean } {
            let defaultPrevented = false;
            const ev = {
                target: this,
                stopPropagation: () => {},
                preventDefault: () => { defaultPrevented = true; },
                composedPath: () => [this],
                ...extra,
            };
            for (const fn of (this.listeners.get(type) ?? [])) {
                fn(ev);
            }
            return { defaultPrevented };
        }

        click(): void {
            this.clickCount += 1;
            this.dispatch('click');
        }

        focus(): void {
            this.focusCount += 1;
        }

        getBoundingClientRect() {
            return this._rect ?? { top: 10, left: 900, right: 980, bottom: 36, width: 80, height: 26 };
        }

        private _matchesSimple(sel: string): boolean {
            const s = sel.trim();
            if (!s) { return false; }
            if (s.startsWith('.')) { return this.classList.contains(s.slice(1)); }
            if (s.startsWith('#')) { return this.id === s.slice(1); }
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

        querySelectorAll(selector: string): PolishTestElement[] {
            const out: PolishTestElement[] = [];
            const walk = (node: PolishTestElement) => {
                for (const c of node.childNodes) {
                    if (c.nodeType === 1 && c.matches(selector)) { out.push(c); }
                    walk(c);
                }
            };
            walk(this);
            return out;
        }

        querySelector(selector: string): PolishTestElement | null {
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


    interface MockMutationObserverRecord {
        cb: (records: Array<Record<string, unknown>>) => void;
        target: PolishTestElement | null;
        options: Record<string, unknown> | null;
    }


    function createPolishHarness(options: {
        innerWidth?: number;
        location?: { pathname?: string; search?: string; hash?: string };
        auxVisible?: boolean;
        focusReceipt?: (revision: number) => { accepted: boolean; ackFocusRevision: number };
        matchMediaMap?: Record<string, boolean>;
    } = {}) {
        const html = new PolishTestElement('html');
        const body = new PolishTestElement('body');
        html.appendChild(body);

        const footer = new PolishTestElement('div');
        footer.className = 'agy-composer-footer';
        const rightGroup = new PolishTestElement('div');
        const permBtn = new PolishTestElement('button');
        permBtn.setAttribute('data-testid', 'permissions-selector-trigger');
        permBtn.textContent = 'Turbo';
        rightGroup.appendChild(permBtn);
        footer.appendChild(rightGroup);
        body.appendChild(footer);

        const titlebar = new PolishTestElement('div');
        titlebar.setAttribute('data-testid', 'pane-titlebar-toolbar');
        const auxBtn = new PolishTestElement('button');
        auxBtn.setAttribute('data-testid', 'toggle-aux-sidebar');
        auxBtn.setAttribute('aria-expanded', 'false');
        if (options.auxVisible === false) {
            auxBtn.hidden = true;
            auxBtn._rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
        }
        titlebar.appendChild(auxBtn);
        body.appendChild(titlebar);

        const docListeners = new Map<string, Array<(ev: unknown) => void>>();
        const winListeners = new Map<string, Array<(ev: unknown) => void>>();
        const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
        const observers: MockMutationObserverRecord[] = [];
        let layoutQueryCount = 0;

        const origBodyRect = titlebar.getBoundingClientRect.bind(titlebar);
        titlebar.getBoundingClientRect = () => {
            layoutQueryCount += 1;
            return origBodyRect();
        };

        const doc: Record<string, unknown> = {
            documentElement: html,
            body,
            activeElement: null,
            createElement: (tag: string) => new PolishTestElement(tag, 1),
            createElementNS: (_ns: string, tag: string) => new PolishTestElement(tag, 1),
            createTextNode: (text: string) => {
                const t = new PolishTestElement('#text', 3);
                t.textContent = text;
                return t;
            },
            getElementById: (id: string) => {
                const walk = (n: PolishTestElement): PolishTestElement | null => {
                    if (n.id === id) { return n; }
                    for (const c of n.childNodes) {
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

        const loc = {
            pathname: options.location?.pathname ?? '/',
            search: options.location?.search ?? '',
            hash: options.location?.hash ?? '',
            origin: 'https://127.0.0.1:62501',
            href: 'https://127.0.0.1:62501/',
        };

        const win: Record<string, unknown> = {
            innerWidth: options.innerWidth ?? 1440,
            innerHeight: 900,
            location: loc,
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
            getComputedStyle: () => ({ backgroundColor: 'rgb(13, 16, 20)', display: 'block', visibility: 'visible', opacity: '1' }),
            matchMedia: (q: string) => ({ matches: Boolean(options.matchMediaMap?.[q]) }),
        };
        win.window = win;

        class MockMutationObserver {
            private entry: MockMutationObserverRecord;
            constructor(cb: (records: Array<Record<string, unknown>>) => void) {
                this.entry = { cb, target: null, options: null };
                observers.push(this.entry);
            }
            observe(target: PolishTestElement, opts: Record<string, unknown>) {
                this.entry.target = target;
                this.entry.options = opts;
            }
            disconnect() {
                this.entry.target = null;
            }
        }

        const fetchMock = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
            const parsed = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
            fetchCalls.push({ url, body: parsed });
            const revision = Number(parsed.focusRevision);
            const result = options.focusReceipt?.(revision) ?? { accepted: true, ackFocusRevision: revision };
            return Promise.resolve({ ok: true, json: async () => ({ ok: true, result }) });
        });

        const sandbox: Record<string, unknown> = {
            window: win,
            document: doc,
            navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel' },
            MutationObserver: MockMutationObserver,
            Date,
            setTimeout,
            clearTimeout,
            setInterval: () => 1,
            clearInterval: () => {},
            fetch: fetchMock,
        };

        const ctx = vm.createContext(sandbox);
        return {
            ctx,
            win,
            doc,
            html,
            body,
            loc,
            auxBtn,
            rightGroup,
            fetchCalls,
            observers,
            getLayoutQueryCount: () => layoutQueryCount,
            resetLayoutQueryCount: () => { layoutQueryCount = 0; },
            dispatchWin(type: string) {
                for (const fn of (winListeners.get(type) ?? [])) { fn({}); }
            },
            dispatchDocKey(key: string) {
                for (const fn of (docListeners.get('keydown') ?? [])) { fn({ key }); }
            },
        };
    }


    function makePayload(overrides: Partial<RichOverlayPayload> = {}): RichOverlayPayload {
        return {
            updatedAt: '14:25:08',
            nextRefreshSec: 5,
            language: 'both',
            theme: 'dark',
            modelName: 'Gemini 4 Carbon (High)',
            contextUsedTokens: 64_000,
            contextEffectiveLimit: 256_000,
            contextNativeLimit: 1_000_000,
            contextPct: 25,
            outputSpeedTps: 88.5,
            avgOutputSpeedTps: 76.2,
            isShortSample: false,
            isWaitingTtft: false,
            ttftMs: 420,
            recentCacheHitPct: 85,
            avgCacheHitPct: 80,
            turnCacheState: 'warm',
            estCostUsd: 1.25,
            estCostFormatted: '$1.25',
            localCostFormatted: '¥9.05',
            inputTokens: 40_000,
            outputTokens: 3_000,
            cacheReadTokens: 20_000,
            totalTokens: 63_000,
            cumulativeRecordedTokens: 520_000_000,
            todayTokens: 8_200_000,
            todayCostFormatted: '$12.40',
            cumulativeCostFormatted: '$285.00',
            recordedDaysCount: 10,
            sessionCount: 22,
            recentCallCount: 14,
            tightestQuotaPct: 80,
            tightestQuotaWindowTag: '5h',
            sessionQuota5hPct: 80,
            sessionQuota5hReset: '3h 10m',
            sessionQuotaWeeklyPct: 62,
            sessionQuotaWeeklyReset: '4d 8h',
            quotaPools: [
                {
                    poolKey: 'gemini-pool',
                    label: 'Gemini 4 Pool',
                    modelChips: ['Carbon High'],
                    remainingPct: 80,
                    windowTag: '5h',
                    resetCountdown: '3h 10m',
                    weeklyRemainingPct: 62,
                    weeklyResetCountdown: '4d 8h',
                    isCurrentSessionModel: true,
                    health: 'good',
                },
            ],
            bridgeUrl: 'http://127.0.0.1:54321',
            bridgeToken: crypto.randomBytes(32).toString('hex'),
            ...overrides,
        };
    }


    function postBridge(
        url: string,
        origin: string,
        token: string,
        body: Record<string, unknown>,
    ): Promise<{ status: number; json: Record<string, unknown> }> {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const raw = JSON.stringify(body);
            const req = http.request({
                hostname: u.hostname,
                port: u.port,
                path: u.pathname,
                method: 'POST',
                headers: {
                    Origin: origin,
                    'X-Monitor-Token': token,
                    'Content-Type': 'application/json',
                    'Content-Length': String(Buffer.byteLength(raw)),
                },
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode ?? 0,
                        json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
                    });
                });
            });
            req.on('error', reject);
            req.end(raw);
        });
    }


    describe('Phase 3 Wave 3A: CDP Polish, Split-Pane Focus, Dock Self-Heal, Hover-Intent & Glossary', () => {
        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('1. accepts ALL 18 5-tab + legacy alias CDP openPanel targets while rejecting unsafe tabs and keeping 4-command allowlist', async () => {
            const expectedTabs = [
                'overview',
                'gm',
                'gmdata',
                'gm-data',
                'activity',
                'sessions',
                'chats',
                'chat-history',
                'usage',
                'cost',
                'pricing',
                'calendar',
                'models',
                'profile',
                'account',
                'accounts',
                'settings',
                'about',
            ] as const;

            expect(ALLOWED_OVERLAY_TARGET_TABS.size).toBe(expectedTabs.length);
            for (const tab of expectedTabs) {
                expect(parseOverlayTargetTab(tab)).toBe(tab);
                expect(parseOverlayTargetTab(`  ${tab.toUpperCase()}  `)).toBe(tab);
            }
            expect(parseOverlayTargetTab('unknown-tab')).toBeUndefined();
            expect(parseOverlayTargetTab('../settings')).toBeUndefined();
            expect(parseOverlayTargetTab('<script>')).toBeUndefined();

            const received: CdpOverlayBridgeAction[] = [];
            const origin = 'https://127.0.0.1:62501';
            const bridge = await createOverlayActionBridge({
                allowedOrigin: origin,
                onAction: (action) => { received.push(action); },
            });
            try {
                for (const tab of expectedTabs) {
                    const res = await postBridge(`${bridge.url}/api/overlay/action`, origin, bridge.token, {
                        command: 'openPanel',
                        source: 'topbar',
                        targetTab: tab,
                    });
                    expect(res.status).toBe(200);
                }
                expect(received.map(a => a.targetTab)).toEqual([...expectedTabs]);

                // Invalid tab is stripped cleanly without crashing; disallowed command is rejected 400
                const invalidTabRes = await postBridge(`${bridge.url}/api/overlay/action`, origin, bridge.token, {
                    command: 'openPanel',
                    source: 'topbar',
                    targetTab: 'evil-tab',
                });
                expect(invalidTabRes.status).toBe(200);
                expect(received.at(-1)).toEqual({ command: 'openPanel', source: 'topbar' });

                const badCmdRes = await postBridge(`${bridge.url}/api/overlay/action`, origin, bridge.token, {
                    command: 'runArbitraryJs',
                });
                expect(badCmdRes.status).toBe(400);
            } finally {
                await bridge.close();
            }
        });

        it('2. self-heals within 2-3s on no_hub_target / macOS Dock window close & reopen while preserving zero probing when disabled and multi-window Origin isolation', async () => {
            vi.useFakeTimers();
            let nowMs = 10_000;
            let hubTargets: CdpTargetInfo[] = [];
            const closeTriggers = new Map<string, () => void>();
            const inspectSpy = vi.fn().mockResolvedValue({ found: true, hasRemoteDebuggingFlag: true, explicitPort: 9222 });
            let connectCount = 0;

            const makeClient = (wsUrl: string, origin: string): CdpClientLike => {
                let open = true;
                const listeners = new Set<() => void>();
                closeTriggers.set(wsUrl, () => {
                    open = false;
                    for (const fn of [...listeners]) { fn(); }
                });
                return {
                    get isOpen() { return open; },
                    send: async () => ({}),
                    evaluate: async () => ({ ok: true, origin, href: `${origin}/` }),
                    onClose: (fn) => {
                        listeners.add(fn);
                        return () => { listeners.delete(fn); };
                    },
                    onEvent: () => () => {},
                    close: async () => { open = false; },
                };
            };

            const mgr = createCdpAmbientOverlayManager({
                platform: 'darwin',
                reconnectBackoffMs: 15_000,
                fastRecoveryBackoffMs: 2_500,
                enableActionBridge: true,
                now: () => nowMs,
                inspectHostProcess: inspectSpy,
                fetchVersion: async () => ({ Browser: 'Antigravity/2.0 Electron/33.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/live' }),
                fetchTargets: async () => hubTargets,
                connectClient: async (wsUrl) => {
                    connectCount += 1;
                    const matched = hubTargets.find(t => t.webSocketDebuggerUrl === wsUrl);
                    const origin = matched?.url ? new URL(matched.url).origin : 'https://127.0.0.1:62501';
                    return makeClient(wsUrl, origin);
                },
            });

            // Disabled -> ZERO OS probing even after advancing timers
            await mgr.updatePayload(makePayload());
            await vi.advanceTimersByTimeAsync(10_000);
            expect(inspectSpy).not.toHaveBeenCalled();

            // Enable while 0 Hub windows open (macOS Dock closed-window state) -> enters fast 2.5s recovery!
            const stNoHub = await mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: true });
            expect(stNoHub.state).toBe('cdp_unavailable');
            expect(stNoHub.diagnosticCode).toBe('no_hub_target');

            // User clicks macOS Dock icon -> 2 Hub windows open; fast recovery auto-attaches in 2.5s (well under 15s backoff!)
            hubTargets = [
                { id: 'win-1', type: 'page', title: 'Antigravity', url: 'https://127.0.0.1:62501/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/win-1' },
                { id: 'win-2', type: 'page', title: 'Jetski Web', url: 'https://127.0.0.1:62502/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/win-2' },
            ];
            nowMs += 2_500;
            await vi.advanceTimersByTimeAsync(2_500);
            expect(mgr.getStatus().state).toBe('connected');
            expect(mgr.getActiveGrants()).toHaveLength(2);
            expect(connectCount).toBe(2);

            // Close window 1 ONLY -> window 2 stays connected with its Origin-bound grant intact
            closeTriggers.get('ws://127.0.0.1:9222/devtools/page/win-1')!();
            expect(mgr.getActiveGrants()).toHaveLength(1);
            expect(mgr.getActiveGrants()[0].targetId).toBe('win-2');
            expect(mgr.getStatus().state).toBe('connected');

            // Close last Hub window (window 2) -> drops into no_hub_target & fast 2.5s self-healing!
            hubTargets = [];
            closeTriggers.get('ws://127.0.0.1:9222/devtools/page/win-2')!();
            expect(mgr.getActiveGrants()).toHaveLength(0);
            expect(mgr.getStatus().state).toBe('cdp_unavailable');
            expect(mgr.getStatus().diagnosticCode).toBe('no_hub_target');

            // Reopen new Hub window via macOS Dock click -> auto-reattaches within 2.5s!
            hubTargets = [
                { id: 'win-3', type: 'page', title: 'Antigravity', url: 'https://127.0.0.1:62503/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/win-3' },
            ];
            nowMs += 2_500;
            await vi.advanceTimersByTimeAsync(2_500);
            expect(mgr.getStatus().state).toBe('connected');
            expect(mgr.getActiveGrants().map(g => g.allowedOrigin)).toEqual(['https://127.0.0.1:62503']);

            await mgr.dispose();
        });

        it('3. Recheck CDP recovers a half-open stale socket in one click and enforces expectedBuildId on updates', async () => {
            let evalCallCount = 0;
            let connectCount = 0;
            const evalExpressions: string[] = [];

            const mgr = createCdpAmbientOverlayManager({
                platform: 'darwin',
                enableActionBridge: false,
                discoverActivePort: () => ({ port: 9222, wsPath: '/devtools/browser/live', filePath: '/tmp/DevToolsActivePort' }),
                fetchVersion: async () => ({ Browser: 'Antigravity/2.0 Electron/33.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/live' }),
                fetchTargets: async () => [{
                    id: 'hub-recheck',
                    type: 'page',
                    title: 'Antigravity',
                    url: 'https://127.0.0.1:62501/',
                    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/hub-recheck',
                }],
                connectClient: async () => {
                    connectCount += 1;
                    const myConn = connectCount;
                    let open = true;
                    return {
                        get isOpen() { return open; },
                        send: async () => ({}),
                        evaluate: async (expr: string) => {
                            evalCallCount += 1;
                            evalExpressions.push(expr);
                            // Simulate half-open stale socket on first connection's 3rd eval (during recheck)
                            if (myConn === 1 && evalCallCount === 3) {
                                throw new Error('WebSocket write EPIPE');
                            }
                            return { ok: true, origin: 'https://127.0.0.1:62501' };
                        },
                        close: async () => { open = false; },
                    };
                },
            });

            await mgr.updatePayload(makePayload());
            const initSt = await mgr.setToggles({ appComposerRingEnabled: true, appTopBarEnabled: false });
            expect(initSt.state).toBe('connected');
            expect(evalExpressions.some(e => e.includes(CDP_OVERLAY_BUILD_ID))).toBe(true);

            // Recheck hits stale EPIPE on connection 1, detaches it, and immediately reconnects connection 2 in one click!
            const recheckSt = await mgr.recheck();
            expect(recheckSt.state).toBe('connected');
            expect(connectCount).toBe(2);

            await mgr.dispose();
        });

        it('4. parses ?focused= UUID, ?focused= index, and %2B split-pane routes accurately, never guesses first URL UUID or bare root as new chat, and retries unacknowledged focus reports', async () => {
            const uuidA = '11111111-1111-4111-8111-111111111111';
            const uuidB = '22222222-2222-4222-8222-222222222222';
            let allowFocusAck = false;
            const payload = makePayload();

            const dom = createPolishHarness({
                location: { pathname: `/c/${uuidA}%2B${uuidB}`, search: `?focused=${uuidB}`, hash: '' },
                focusReceipt: (revision) => ({ accepted: true, ackFocusRevision: allowFocusAck ? revision : revision - 1 }),
            });

            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            // 1. `?focused=<uuidB>` wins over first UUID `uuidA` in `%2B`-encoded split-pane route
            expect(dom.fetchCalls).toHaveLength(1);
            expect(dom.fetchCalls[0].body).toEqual({
                command: 'focusConversation',
                source: 'topbar',
                conversationId: uuidB,
                focusRevision: 1,
                isNewConversation: false,
            });

            // Wait for failed ack promise microtask -> NOT committed to lastReportedFocusKey -> next tick retries!
            await new Promise(resolve => setImmediate(resolve));
            allowFocusAck = true;
            vm.runInContext(
                buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );
            expect(dom.fetchCalls).toHaveLength(2);
            expect(dom.fetchCalls[1].body).toMatchObject({ conversationId: uuidB, focusRevision: 1 });
            await new Promise(resolve => setImmediate(resolve));

            // Now acknowledged -> subsequent tick is deduplicated!
            vm.runInContext(
                buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );
            expect(dom.fetchCalls).toHaveLength(2);

            // 2. Numeric index `?focused=0` on `%2B` split-pane hash route selects pane 0 (`uuidA`)
            dom.loc.pathname = '/';
            dom.loc.search = '';
            dom.loc.hash = `#/c/${uuidA}%2B${uuidB}?focused=0`;
            dom.dispatchWin('hashchange');
            expect(dom.fetchCalls).toHaveLength(3);
            expect(dom.fetchCalls[2].body.conversationId).toBe(uuidA);
            await Promise.resolve();

            // 3. Split-pane `%2B` WITHOUT `?focused=` and WITHOUT focused DOM pane -> NEVER blindly picks first URL UUID!
            dom.loc.pathname = `/c/${uuidA}%2B${uuidB}`;
            dom.loc.search = '';
            dom.loc.hash = '';
            dom.dispatchWin('popstate');
            expect(dom.fetchCalls).toHaveLength(3);

            // Adding focused pane DOM (paneA unfocused, paneB focused) resolves uuidB cleanly via single isInsideUnfocusedPane
            const paneA = new PolishTestElement('div');
            paneA.setAttribute('data-pane-unfocused', 'true');
            paneA.setAttribute('data-conversation-id', uuidA);
            const paneB = new PolishTestElement('div');
            paneB.setAttribute('data-conversation-id', uuidB);
            dom.body.appendChild(paneA);
            dom.body.appendChild(paneB);
            dom.dispatchWin('popstate');
            expect(dom.fetchCalls).toHaveLength(4);
            expect(dom.fetchCalls[3].body.conversationId).toBe(uuidB);
            await Promise.resolve();

            // 4. Bare root '/' with visible composer (and no pane UUID) NEVER fabricates isNewConversation: true!
            dom.body.removeChild(paneA);
            dom.body.removeChild(paneB);
            dom.loc.pathname = '/';
            dom.dispatchWin('popstate');
            expect(dom.fetchCalls).toHaveLength(4);
        });

        it('reports unchanged focus again after rotation of the window capability at the same bridge URL', async () => {
            const dom = createPolishHarness({ location: { pathname: '/c/11111111-1111-4111-8111-111111111111' } });
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            const apply = (token: string) => vm.runInContext(buildOverlayUpdateScript(makePayload({ bridgeToken: token }), {
                appComposerRingEnabled: true, appTopBarEnabled: false,
            }), dom.ctx);
            apply('first-fixture-token');
            await new Promise(resolve => setImmediate(resolve));
            apply('first-fixture-token');
            apply('rotated-fixture-token');
            expect(dom.fetchCalls.map(call => call.body.focusRevision)).toEqual([1, 2]);
        });

        it('5. preserves composer focus via mousedown preventDefault on triggers/pills without breaking focusable controls inside pinned popovers', () => {
            const dom = createPolishHarness();
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            const compSr = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_COMPOSER_HOST_ID).shadowRoot!;
            const topSr = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_TOPBAR_HOST_ID).shadowRoot!;

            // Composer Ring trigger + all 4 TopBar pills + overflow button prevent focus steal on mousedown
            const ringTrigger = compSr.querySelector('.acm-ring-trigger')!;
            expect(ringTrigger.dispatch('mousedown').defaultPrevented).toBe(true);
            for (const view of ['quota', 'context', 'speed', 'total']) {
                expect(topSr.querySelector(`[data-view="${view}"]`)!.dispatch('mousedown').defaultPrevented).toBe(true);
            }
            expect(topSr.querySelector('[data-action="overflow"]')!.dispatch('mousedown').defaultPrevented).toBe(true);

            // Explicit focusable controls inside pinned popovers do NOT swallow mousedown focus!
            const compOpenBtn = compSr.querySelector('.is-primary')!;
            expect(compOpenBtn.dispatch('mousedown').defaultPrevented).toBe(false);
            const qpOpenBtn = topSr.querySelector('.is-primary')!;
            const qpCloseBtn = topSr.querySelector('[data-action="close"]')!;
            const qpTabCtx = topSr.querySelector('[data-tab-view="context"]')!;
            expect(qpOpenBtn.dispatch('mousedown').defaultPrevented).toBe(false);
            expect(qpCloseBtn.dispatch('mousedown').defaultPrevented).toBe(false);
            expect(qpTabCtx.dispatch('mousedown').defaultPrevented).toBe(false);

            // Nonmodal dialog role + Escape focus restoration when focus was inside shadow host
            const compHost = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_COMPOSER_HOST_ID);
            expect(compSr.querySelector('.acm-popover')!.getAttribute('aria-modal')).toBe('false');
            expect(topSr.querySelector('.acm-quota-popover')!.getAttribute('aria-modal')).toBe('false');
            ringTrigger.click();
            dom.doc.activeElement = compHost;
            dom.dispatchDocKey('Escape');
            expect(ringTrigger.focusCount).toBe(1);
        });

        it('6. narrows MutationObserver to skip streaming response text/markdown mutations with zero reflow jank while still re-anchoring on shell/detach changes', async () => {
            vi.useFakeTimers();
            const dom = createPolishHarness();
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            const bodyObserver = dom.observers.find(o => o.target === dom.body)!;
            expect(bodyObserver).toBeTruthy();
            expect(bodyObserver.options?.characterData).toBe(false);

            // Streaming markdown container + assistant message + contenteditable composer
            const msgBox = new PolishTestElement('div');
            msgBox.setAttribute('data-role', 'assistant');
            msgBox.className = 'prose markdown';
            const codeBlock = new PolishTestElement('pre');
            msgBox.appendChild(codeBlock);
            dom.body.appendChild(msgBox);

            const editable = new PolishTestElement('div');
            editable.setAttribute('contenteditable', 'true');
            dom.body.appendChild(editable);

            dom.resetLayoutQueryCount();
            // Fire 200 streaming text/span/code/aria-expanded mutations inside response stream & contenteditable
            for (let i = 0; i < 200; i++) {
                const textChunk = new PolishTestElement('#text', 3);
                textChunk.textContent = `token-${i}`;
                const inlineSpan = new PolishTestElement('span');
                bodyObserver.cb([
                    { type: 'childList', target: codeBlock, addedNodes: [textChunk, inlineSpan], removedNodes: [] },
                    { type: 'childList', target: editable, addedNodes: [textChunk], removedNodes: [] },
                    { type: 'childList', target: dom.body, addedNodes: [textChunk], removedNodes: [] },
                    { type: 'attributes', target: msgBox, attributeName: 'aria-expanded' },
                ]);
            }
            await vi.advanceTimersByTimeAsync(1_000);
            // ZERO layout queries / reflows during fast streaming!
            expect(dom.getLayoutQueryCount()).toBe(0);

            // Structural shell change (e.g. sidebar attribute or disconnected overlay host) STILL triggers sync!
            const sidebarEl = new PolishTestElement('div');
            sidebarEl.setAttribute('data-testid', 'sidebar-toggle');
            bodyObserver.cb([{ type: 'attributes', target: sidebarEl, attributeName: 'aria-expanded' }]);
            await vi.advanceTimersByTimeAsync(600);
            expect(dom.getLayoutQueryCount()).toBeGreaterThan(0);
        });

        it('7. enforces 250ms Hover-Intent delay before opening hover popovers and 350ms warm sibling window for zero-delay adjacent pill switching', async () => {
            vi.useFakeTimers();
            const dom = createPolishHarness();
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(makePayload(), { appComposerRingEnabled: true, appTopBarEnabled: true }),
                dom.ctx,
            );

            const compSr = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_COMPOSER_HOST_ID).shadowRoot!;
            const topSr = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_TOPBAR_HOST_ID).shadowRoot!;
            const compTrigger = compSr.querySelector('.acm-ring-trigger')!;
            const compPopover = compSr.querySelector('.acm-popover')!;
            const quotaPill = topSr.querySelector('[data-view="quota"]')!;
            const ctxPill = topSr.querySelector('[data-view="context"]')!;
            const speedPill = topSr.querySelector('[data-view="speed"]')!;
            const topPopover = topSr.querySelector('.acm-quota-popover')!;

            // 1. Accidental sweep (<250ms) across Composer Ring -> NEVER opens!
            compTrigger.dispatch('mouseenter');
            await vi.advanceTimersByTimeAsync(150);
            expect(compPopover.classList.contains('is-open')).toBe(false);
            compTrigger.dispatch('mouseleave');
            await vi.advanceTimersByTimeAsync(200);
            expect(compPopover.classList.contains('is-open')).toBe(false);

            // Intentional hover (>=250ms) on Composer Ring -> opens cleanly!
            compTrigger.dispatch('mouseenter');
            await vi.advanceTimersByTimeAsync(250);
            expect(compPopover.classList.contains('is-open')).toBe(true);

            // 2. TopBar cold sweep (<250ms) -> NEVER opens!
            quotaPill.dispatch('mouseenter');
            await vi.advanceTimersByTimeAsync(200);
            expect(topPopover.classList.contains('is-open')).toBe(false);
            quotaPill.dispatch('mouseleave');
            await vi.advanceTimersByTimeAsync(200);
            expect(topPopover.classList.contains('is-open')).toBe(false);

            // 3. TopBar intentional hover (>=250ms) -> opens quota view (unpinned)
            quotaPill.dispatch('mouseenter');
            await vi.advanceTimersByTimeAsync(250);
            expect(topPopover.classList.contains('is-open')).toBe(true);
            expect(topPopover.getAttribute('data-active-view')).toBe('quota');

            // 4. Moving to adjacent ctxPill while hover-open -> ZERO-delay immediate switch!
            quotaPill.dispatch('mouseleave');
            ctxPill.dispatch('mouseenter');
            expect(topPopover.classList.contains('is-open')).toBe(true);
            expect(topPopover.getAttribute('data-active-view')).toBe('context');

            // 5. Leaving ctxPill closes after 160ms, then entering speedPill within 350ms warm window -> ZERO-delay immediate open!
            ctxPill.dispatch('mouseleave');
            await vi.advanceTimersByTimeAsync(160);
            expect(topPopover.classList.contains('is-open')).toBe(false);
            await vi.advanceTimersByTimeAsync(200); // still inside 350ms warm window after close!
            speedPill.dispatch('mouseenter');
            expect(topPopover.classList.contains('is-open')).toBe(true);
            expect(topPopover.getAttribute('data-active-view')).toBe('speed');

            // 6. After > 350ms past close -> warm window expired -> cold 250ms delay required again!
            speedPill.dispatch('mouseleave');
            await vi.advanceTimersByTimeAsync(160 + 400);
            expect(topPopover.classList.contains('is-open')).toBe(false);
            quotaPill.dispatch('mouseenter');
            expect(topPopover.classList.contains('is-open')).toBe(false);
            await vi.advanceTimersByTimeAsync(250);
            expect(topPopover.classList.contains('is-open')).toBe(true);
        });

        it('8. renders 0% Healthy vs — Unknown, /compact states, Open Panel visibility guard, quota window+direction, Decode/E2E speed tag, presets/high-contrast, Swarm popover summary, and mandatory Chinese glossary + ARIA', () => {
            // Check CSS tokens for font-size presets, high-contrast, forced-colors, and Swarm summary
            const sharedCss = getSharedOverlayThemeCss();
            expect(sharedCss).toContain(':host([data-font-size="compact"])');
            expect(sharedCss).toContain(':host([data-font-size="large"])');
            expect(sharedCss).toContain(':host([data-contrast="high"])');
            expect(sharedCss).toContain('@media (forced-colors: active)');
            expect(sharedCss).toContain('.acm-swarm-row');
            expect(getComposerOverlayCss()).toContain('--acm-ring-size');
            expect(getTopBarOverlayCss()).toContain('--acm-pill-h');

            // Hidden toggle-aux-sidebar + no bridge -> Open Panel hidden and NOT clicked
            const hiddenAuxDom = createPolishHarness({ auxVisible: false });
            vm.runInContext(buildOverlayBootstrapScript(), hiddenAuxDom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(
                    makePayload({ bridgeUrl: undefined, bridgeToken: undefined }),
                    { appComposerRingEnabled: true, appTopBarEnabled: true },
                ),
                hiddenAuxDom.ctx,
            );
            const hiddenCompOpen = (hiddenAuxDom.doc.getElementById as (id: string) => PolishTestElement)(CDP_COMPOSER_HOST_ID)
                .shadowRoot!.querySelector('.is-primary')!;
            const hiddenTopOpen = (hiddenAuxDom.doc.getElementById as (id: string) => PolishTestElement)(CDP_TOPBAR_HOST_ID)
                .shadowRoot!.querySelector('.is-primary')!;
            expect(hiddenCompOpen.style.display).toBe('none');
            expect(hiddenTopOpen.style.display).toBe('none');

            // Full Phase 3 polish payload in ZH mode (tests mandatory glossary + presets + Swarm + 7d Used + E2E + /compact)
            const dom = createPolishHarness();
            vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(
                    makePayload({
                        language: 'zh',
                        accountLabel: 'dev@example.com',
                        overlayFontSize: 'large',
                        highContrast: true,
                        actualBasis: 'native',
                        contextPct: 24,
                        primaryPct: 24,
                        primaryPctText: '24%',
                        compactionState: 'compacted',
                        checkpointCompressionDrop: 48_000,
                        quotaWindowMode: '7d',
                        quotaDirectionMode: 'used',
                        speedMode: 'e2e',
                        turnCacheState: 'cold',
                        swarmSummary: {
                            rootTitle: 'Phase 3 Polish Swarm',
                            activeCount: 2,
                            totalCount: 3,
                            members: [
                                { name: 'p3a-cdp-polish', pct: 42, phase: 'RUNNING', isInspected: true },
                                { name: 'p3a-telemetry', pct: 28, phase: 'RUNNING', isInspected: false },
                                { name: 'p3a-i18n', pct: 15, phase: 'WAITING', isInspected: false },
                            ],
                        },
                    }),
                    { appComposerRingEnabled: true, appTopBarEnabled: true },
                ),
                dom.ctx,
            );

            const compHost = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_COMPOSER_HOST_ID);
            const topHost = (dom.doc.getElementById as (id: string) => PolishTestElement)(CDP_TOPBAR_HOST_ID);
            const compSr = compHost.shadowRoot!;
            const topSr = topHost.shadowRoot!;

            // Presets + High-Contrast applied on both Shadow DOM hosts and reported via getStatus()
            expect(compHost.getAttribute('data-font-size')).toBe('large');
            expect(topHost.getAttribute('data-font-size')).toBe('large');
            expect(compHost.getAttribute('data-contrast')).toBe('high');
            expect(topHost.getAttribute('data-contrast')).toBe('high');
            const rt = dom.win[CDP_RUNTIME_GLOBAL_KEY] as { getStatus: () => { fontSizePreset: string; highContrast: boolean } };
            expect(rt.getStatus()).toMatchObject({ fontSizePreset: 'large', highContrast: true });

            // Frozen permanent views: STILL ONLY 4 permanent TopBar pills (quota, context, speed, total)!
            expect(topSr.querySelectorAll('[data-view]').length).toBe(4);

            // TopBar Quota Pill reflects 7d window + Used direction (62% remaining -> 38% Used)
            const quotaPill = topSr.querySelector('[data-view="quota"]')!;
            expect(quotaPill.collectText()).toContain('38%');
            expect(quotaPill.collectText()).toContain('每周配额已用');
            expect(quotaPill.collectText()).toContain('已用');
            expect(quotaPill.getAttribute('aria-label')).toContain('模型配额面板');
            expect(quotaPill.getAttribute('aria-label')).toContain('已用');

            // Quota popover includes mandatory glossary: 账号 / 配额 + 7d + 已用
            quotaPill.click();
            const quotaBody = topSr.querySelector('.acm-qp-body')!.collectText();
            expect(quotaBody).toContain('账号');
            expect(quotaBody).toContain('dev@example.com');
            expect(quotaBody).toContain('配额');
            expect(quotaBody).toContain('38% 已用');

            // Context view + Composer popover include: 原生窗口上限, /compact indicator, Swarm summary, 当前会话费用, 冻结面板, 冷启动
            const compTrigger = compSr.querySelector('.acm-ring-trigger')!;
            compTrigger.click(); // pin -> shows 冻结面板
            const compText = compSr.collectText();
            expect(compText).toContain('冻结面板');
            expect(compText).toContain('原生窗口上限');
            expect(compText).toContain('已压缩 (/compact) -48k');
            expect(compText).toContain('冷启动');
            expect(compText).toContain('首字延迟');
            expect(compText).toContain('当前会话费用（估算）');
            expect(compText).toContain('p3a-cdp-polish');
            expect(compText).toContain('2/3 活跃');
            expect(compText).toContain('查看中');

            const ctxPill = topSr.querySelector('[data-view="context"]')!;
            ctxPill.click();
            const ctxBody = topSr.querySelector('.acm-qp-body')!.collectText();
            expect(ctxBody).toContain('原生窗口上限');
            expect(ctxBody).toContain('已压缩 (/compact) -48k');
            expect(ctxBody).toContain('p3a-cdp-polish');
            expect(ctxBody).toContain('2/3 活跃');
            expect(topSr.querySelector('.acm-qp-footer')!.collectText()).toContain('当前会话费用');

            // Speed view includes E2E tag + 首字延迟 + 模型调用
            const speedPill = topSr.querySelector('[data-view="speed"]')!;
            expect(speedPill.getAttribute('data-speed-mode')).toBe('e2e');
            expect(speedPill.collectText()).toContain('E2E');
            speedPill.click();
            const speedBody = topSr.querySelector('.acm-qp-body')!.collectText();
            expect(speedBody).toContain('端到端 (E2E)');
            expect(speedBody).toContain('首字延迟');
            expect(speedBody).toContain('近期模型调用');

            // Total view uses 费用 (NEVER 成本) and clearly separates Today / Cumulative / Current Chat
            const totalPill = topSr.querySelector('[data-view="total"]')!;
            totalPill.click();
            expect(topSr.querySelector('.acm-qp-title')!.textContent).toBe('本机累计用量与费用');
            const totalBody = topSr.querySelector('.acm-qp-body')!.collectText();
            expect(totalBody).toContain('今日用量与费用');
            expect(totalBody).toContain('当前会话估算费用');
            expect(totalBody).not.toContain('成本');
            expect(topSr.querySelector('[data-action="overflow"]')!.getAttribute('aria-label')).toBe('更多遥测指标');
            expect(topSr.querySelector('[data-action="close"]')!.getAttribute('aria-label')).toBe('关闭');

            // 0% fresh -> Healthy vs incomplete -> — / Unknown
            vm.runInContext(
                buildOverlayUpdateScript(
                    makePayload({ language: 'en', isZeroStepFresh: true, isIncomplete: false, primaryPct: 0, primaryPctText: '0%', contextPct: 0 }),
                    { appComposerRingEnabled: true, appTopBarEnabled: true },
                ),
                dom.ctx,
            );
            ctxPill.click();
            expect(compSr.collectText()).toContain('0%');
            expect(compSr.collectText()).toContain('Healthy');
            expect(topSr.querySelector('.acm-qp-body')!.collectText()).toContain('Healthy');

            vm.runInContext(
                buildOverlayUpdateScript(
                    makePayload({ language: 'en', isZeroStepFresh: false, isIncomplete: true, primaryPct: null, primaryPctText: '—', healthStatus: 'incomplete' }),
                    { appComposerRingEnabled: true, appTopBarEnabled: true },
                ),
                dom.ctx,
            );
            expect(compSr.collectText()).toContain('Unknown');
            expect(compSr.collectText()).not.toContain('Healthy');
            expect(topSr.querySelector('.acm-qp-body')!.collectText()).toContain('Unknown');
            expect(topSr.querySelector('.acm-qp-body')!.collectText()).not.toContain('Healthy');

            // Compact preset + /compact running + forced-colors auto-detection + strict Trusted Types check
            const hcDom = createPolishHarness({ matchMediaMap: { '(forced-colors: active)': true } });
            const bootScript = buildOverlayBootstrapScript();
            expect(bootScript).not.toMatch(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
            vm.runInContext(bootScript, hcDom.ctx);
            vm.runInContext(
                buildOverlayUpdateScript(
                    makePayload({
                        language: 'zh',
                        overlayFontSize: 'compact',
                        highContrast: 'auto',
                        compactionState: 'active',
                    }),
                    { appComposerRingEnabled: true, appTopBarEnabled: true },
                ),
                hcDom.ctx,
            );
            const hcTopHost = (hcDom.doc.getElementById as (id: string) => PolishTestElement)(CDP_TOPBAR_HOST_ID);
            expect(hcTopHost.getAttribute('data-font-size')).toBe('compact');
            expect(hcTopHost.getAttribute('data-contrast')).toBe('high');
            expect(hcTopHost.getAttribute('data-compact-state')).toBe('active');
            hcTopHost.shadowRoot!.querySelector('[data-view="context"]')!.click();
            expect(hcTopHost.shadowRoot!.querySelector('.acm-qp-body')!.collectText()).toContain('正在执行 /compact');
        });
    });
});

describe('[app-cdp-topbar-views]', () => {
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
            overflowBtn: sr.querySelector('[data-action="overflow"]')!,
            overflowMenu: sr.querySelector('.acm-overflow-menu')!,
            popover: sr.querySelector('.acm-quota-popover')!,
            title: sr.querySelector('.acm-qp-title')!,
            meta: sr.querySelector('.acm-qp-meta')!,
            body: sr.querySelector('.acm-qp-body')!,
            footer: sr.querySelector('.acm-qp-footer')!,
            closeBtn: sr.querySelector('[data-action="close"]')!,
            openBtn: sr.querySelector('.is-primary')!,
            tabFor: (view: 'quota' | 'context' | 'speed' | 'total') => sr.querySelector(`[data-tab-view="${view}"]`)!,
            overflowItemFor: (view: 'quota' | 'context' | 'speed' | 'total') => sr.querySelector(`[data-overflow-view="${view}"]`)!,
        };
    }


    describe('Top-Right Persistent Status Bar 4-View Popover (v1.18.0)', () => {
        it('resolves CDP_OVERLAY_SCRIPT_VERSION to 1.18.0 and passes strict ZERO-innerHTML / syntax security audit', () => {
            expect(CDP_OVERLAY_SCRIPT_VERSION).toBe('1.18.0');

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

            // 4. Click total pill while open -> seamlessly switches to Total Usage & Cost (mandatory Chinese glossary: 费用)
            ui.totalPill.click();
            assertOnlyActive('total');
            expect(ui.title.textContent).toBe('Total Usage & Cost / 本机累计用量与费用');
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
                { view: 'total' as const, title: '本机累计用量与费用' },
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
});

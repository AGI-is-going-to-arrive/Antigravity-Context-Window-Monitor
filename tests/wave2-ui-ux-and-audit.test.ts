import * as vm from 'vm';
import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguageInMemory } from '../src/i18n-core';
import {
    ALL_TAB_ALIASES,
    buildMonitorDocumentHtml,
    buildMonitorTabsPayload,
    CANONICAL_MAIN_TABS,
    resolveTabAlias,
    type MonitorDocumentBuildParams,
} from '../src/webview-document';
import { buildAppOnboardingBannerHtml, renderSwarmMemberItemHtml } from '../src/webview-overview-tab';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';
import { buildPricingTabContent, getPricingTabStyles } from '../src/pricing-panel';
import { getGMDataTabStyles } from '../src/activity-panel';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { getStyles } from '../src/webview-styles';
import { getThemeAdapterStyles } from '../src/app/theme-adapter';
import { getHostBridgeScript } from '../src/app/host-bridge';
import { getScript } from '../src/webview-script';
import { CDP_OVERLAY_CLIENT_BUNDLE } from '../src/client/generated/client-bundles.generated';
import { PricingStore } from '../src/pricing-store';
import { DailyStore } from '../src/daily-store';
import type { GlobalRulesStatus } from '../src/global-rules';

class TestEl {
    tagName: string;
    attrs: Record<string, string> = {};
    style: Record<string, string> = {};
    children: TestEl[] = [];
    parentElement: TestEl | null = null;
    listeners = new Map<string, Array<(e: any) => void>>();
    private _textContent = '';
    innerHTML = '';
    value = '';
    defaultValue = '';
    placeholder = '';
    checked = false;
    disabled = false;
    readOnly = false;
    hidden = false;
    scrollTop = 0;
    scrollLeft = 0;
    scrollWidth = 0;
    clientWidth = 400;
    offsetLeft = 0;
    offsetWidth = 80;
    type = '';
    focused = false;
    scrolledIntoView = false;
    doc: TestDoc;
    private cls = new Set<string>();

    constructor(tag: string, doc: TestDoc) {
        this.tagName = tag.toUpperCase();
        this.doc = doc;
    }

    get id(): string { return this.attrs.id || ''; }
    set id(v: string) { this.attrs.id = v; }

    get textContent(): string { return this._textContent; }
    set textContent(v: string) {
        this._textContent = String(v ?? '');
        for (const c of this.children) { c.parentElement = null; }
        this.children = [];
    }

    get className(): string { return [...this.cls].join(' '); }
    set className(v: string) {
        this.cls = new Set(String(v || '').split(/\s+/).filter(Boolean));
        this.attrs.class = this.className;
    }

    get classList() {
        return {
            add: (...xs: string[]) => xs.forEach(x => { if (x) { this.cls.add(x); } }),
            remove: (...xs: string[]) => xs.forEach(x => this.cls.delete(x)),
            toggle: (x: string, force?: boolean) => {
                const next = force !== undefined ? !!force : !this.cls.has(x);
                if (next) { this.cls.add(x); } else { this.cls.delete(x); }
                return next;
            },
            contains: (x: string) => this.cls.has(x),
        };
    }

    get dataset(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(this.attrs)) {
            if (k.startsWith('data-')) {
                const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                out[camel] = v;
            }
        }
        return out;
    }

    setAttribute(k: string, v: string) {
        const s = String(v);
        this.attrs[k] = s;
        if (k === 'class') { this.className = s; }
        if (k === 'disabled') { this.disabled = true; }
        if (k === 'readonly') { this.readOnly = true; }
        if (k === 'hidden') { this.hidden = true; }
    }

    getAttribute(k: string): string | null {
        if (k === 'class') { return this.className || null; }
        return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    }

    removeAttribute(k: string) {
        delete this.attrs[k];
        if (k === 'disabled') { this.disabled = false; }
        if (k === 'readonly') { this.readOnly = false; }
        if (k === 'hidden') { this.hidden = false; }
    }

    hasAttribute(k: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.attrs, k);
    }

    appendChild(child: TestEl): TestEl {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx >= 0) { this.parentElement.children.splice(idx, 1); }
            this.parentElement = null;
        }
    }

    focus() {
        this.focused = true;
        this.doc.activeElement = this;
    }

    scrollIntoView() { this.scrolledIntoView = true; }

    getBoundingClientRect() {
        return { left: this.offsetLeft, right: this.offsetLeft + this.offsetWidth, top: 0, bottom: 28, width: this.offsetWidth, height: 28 };
    }

    addEventListener(type: string, fn: (e: any) => void) {
        const list = this.listeners.get(type) || [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, fn: (e: any) => void) {
        const list = this.listeners.get(type);
        if (!list) { return; }
        const idx = list.indexOf(fn);
        if (idx >= 0) { list.splice(idx, 1); }
    }

    contains(other: TestEl | null): boolean {
        let cur = other;
        while (cur) {
            if (cur === this) { return true; }
            cur = cur.parentElement;
        }
        return false;
    }

    matches(selector: string): boolean {
        const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
        return parts.some(part => this.matchSingle(part));
    }

    private matchSingle(sel: string): boolean {
        for (const nm of sel.matchAll(/:not\(([^)]+)\)/g)) {
            if (this.matchSingle(nm[1])) { return false; }
        }
        const clean = sel.replace(/:not\([^)]+\)/g, '');
        const idM = clean.match(/#([A-Za-z0-9_-]+)/);
        if (idM && this.id !== idM[1]) { return false; }
        for (const cm of clean.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
            if (!this.cls.has(cm[1])) { return false; }
        }
        for (const am of clean.matchAll(/\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/g)) {
            const val = this.getAttribute(am[1]);
            if (val === null) { return false; }
            if (am[2] !== undefined && val !== am[2]) { return false; }
        }
        const tagM = clean.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
        if (tagM && this.tagName !== tagM[1].toUpperCase()) { return false; }
        return true;
    }

    get isConnected(): boolean {
        let cur: TestEl | null = this;
        while (cur) {
            if (cur === this.doc.documentElement) { return true; }
            cur = cur.parentElement;
        }
        return false;
    }

    closest(selector: string): TestEl | null {
        let cur: TestEl | null = this;
        while (cur) {
            if (cur.matches(selector)) { return cur; }
            cur = cur.parentElement;
        }
        return null;
    }

    querySelectorAll(selector: string): TestEl[] {
        const out: TestEl[] = [];
        const walk = (node: TestEl) => {
            for (const c of node.children) {
                if (c.matches(selector)) { out.push(c); }
                walk(c);
            }
        };
        walk(this);
        return out;
    }

    querySelector(selector: string): TestEl | null {
        return this.querySelectorAll(selector)[0] || null;
    }

    dispatch(type: string, extra: Record<string, unknown> = {}) {
        const ev = { type, target: this, currentTarget: this, preventDefault: () => {}, stopPropagation: () => {}, ...extra };
        let cur: TestEl | null = this;
        while (cur) {
            for (const fn of cur.listeners.get(type) || []) { fn(ev); }
            cur = cur.parentElement;
        }
        for (const fn of this.doc.listeners.get(type) || []) { fn(ev); }
    }
}

class TestDoc {
    documentElement: TestEl;
    head: TestEl;
    body: TestEl;
    activeElement: TestEl | null = null;
    listeners = new Map<string, Array<(e: any) => void>>();

    constructor() {
        this.documentElement = new TestEl('html', this);
        this.head = new TestEl('head', this);
        this.body = new TestEl('body', this);
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
    }

    createElement(tag: string) { return new TestEl(tag, this); }
    createElementNS(_ns: string, tag: string) { return new TestEl(tag, this); }
    createTextNode(text: string) { const n = new TestEl('#text', this); n.textContent = text; return n; }
    getElementById(id: string): TestEl | null {
        const walk = (n: TestEl): TestEl | null => {
            if (n.id === id) { return n; }
            for (const c of n.children) { const f = walk(c); if (f) { return f; } }
            return null;
        };
        return walk(this.documentElement);
    }
    querySelectorAll(sel: string) { return this.documentElement.querySelectorAll(sel); }
    querySelector(sel: string) { return this.documentElement.querySelector(sel); }
    addEventListener(t: string, fn: (e: any) => void) {
        const list = this.listeners.get(t) || [];
        list.push(fn);
        this.listeners.set(t, list);
    }
    removeEventListener(t: string, fn: (e: any) => void) {
        const list = this.listeners.get(t);
        if (!list) { return; }
        const idx = list.indexOf(fn);
        if (idx >= 0) { list.splice(idx, 1); }
    }
}

function createWave2Vm(opts: {
    ideHostNonce?: string;
    simulateVscodeParent?: boolean;
    initialTab?: string;
    initialState?: Record<string, unknown>;
    surface?: 'ide' | 'app-sidecar' | 'standalone';
    privacyMasked?: boolean;
    globalRulesExists?: boolean;
    globalRulesTooLarge?: boolean;
    bridgeSendAction?: (action: any) => Promise<any>;
} = {}) {
    const doc = new TestDoc();
    doc.body.setAttribute('data-privacy-default', 'true');
    doc.body.setAttribute('data-privacy-masked', String(opts.privacyMasked ?? true));
    if (opts.initialTab) { doc.body.setAttribute('data-initial-tab', opts.initialTab); }

    const tabBar = doc.createElement('nav');
    tabBar.id = 'tabBar';
    tabBar.setAttribute('role', 'tablist');
    const slider = doc.createElement('div');
    slider.id = 'tabSlider';
    tabBar.appendChild(slider);

    const tabs = ['overview', 'gm', 'sessions', 'calendar', 'models', 'settings'];
    for (let i = 0; i < tabs.length; i++) {
        const tid = tabs[i];
        const btn = doc.createElement('button');
        btn.id = `tabBtn-${tid}`;
        btn.className = 'tab-btn' + (tid === 'overview' ? ' active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('data-tab', tid);
        btn.setAttribute('aria-selected', tid === 'overview' ? 'true' : 'false');
        btn.offsetLeft = i * 80;
        tabBar.appendChild(btn);

        const pane = doc.createElement('div');
        pane.id = `tab-${tid}`;
        pane.className = 'tab-pane' + (tid === 'overview' ? ' active' : '');
        if (tid !== 'overview' && tid !== 'settings') {
            const slot = doc.createElement('div');
            slot.id = `slot-${tid}`;
            slot.setAttribute('data-tab-slot', tid);
            pane.appendChild(slot);
        }
        doc.body.appendChild(pane);
    }
    const aboutPane = doc.createElement('div');
    aboutPane.id = 'tab-about';
    aboutPane.className = 'tab-pane';
    doc.body.appendChild(aboutPane);
    doc.body.appendChild(tabBar);

    const aboutBtn = doc.createElement('button');
    aboutBtn.id = 'topbarAboutBtn';
    aboutBtn.setAttribute('data-utility-view', 'about');
    doc.body.appendChild(aboutBtn);

    const liveRegion = doc.createElement('div');
    liveRegion.id = 'acmLiveRegion';
    doc.body.appendChild(liveRegion);

    // Overview onboarding banner + Handoff v2 box
    const ovPane = doc.getElementById('tab-overview')!;
    const onbBanner = doc.createElement('section');
    onbBanner.id = 'appOnboardingBanner';
    const onbSetupBtn = doc.createElement('button');
    onbSetupBtn.id = 'onboardingSetupCdpBtn';
    onbSetupBtn.setAttribute('data-action', 'setupCdpLauncher');
    onbSetupBtn.setAttribute('data-feedback-id', 'onboardingFeedback');
    onbSetupBtn.appendChild(doc.createElement('span'));
    const onbGoBtn = doc.createElement('button');
    onbGoBtn.id = 'onboardingGoCdpBtn';
    onbGoBtn.setAttribute('data-action', 'openOverlaysCdpSettings');
    const onbDismissBtn = doc.createElement('button');
    onbDismissBtn.id = 'onboardingDismissBtn';
    onbDismissBtn.setAttribute('data-action', 'dismissAppOnboarding');
    const onbFeedback = doc.createElement('span');
    onbFeedback.id = 'onboardingFeedback';
    onbBanner.appendChild(onbSetupBtn);
    onbBanner.appendChild(onbGoBtn);
    onbBanner.appendChild(onbDismissBtn);
    onbBanner.appendChild(onbFeedback);
    ovPane.appendChild(onbBanner);

    const handoffBtn = doc.createElement('button');
    handoffBtn.id = 'previewHandoffV2Btn';
    handoffBtn.setAttribute('data-action', 'previewHandoffV2');
    handoffBtn.setAttribute('data-subject-cascade-id', 'cas-1');
    handoffBtn.setAttribute('data-data-revision', '7');
    const handoffBox = doc.createElement('div');
    handoffBox.id = 'handoffV2PreviewBox';
    handoffBox.setAttribute('data-subject-cascade-id', 'cas-1');
    handoffBox.hidden = true;
    const handoffTa = doc.createElement('textarea');
    handoffTa.id = 'handoffV2PreviewText';
    const handoffCopyBtn = doc.createElement('button');
    handoffCopyBtn.setAttribute('data-action', 'copyHandoffPreviewText');
    handoffBox.appendChild(handoffTa);
    handoffBox.appendChild(handoffCopyBtn);
    ovPane.appendChild(handoffBtn);
    ovPane.appendChild(handoffBox);

    // Settings cards: CDP + Global Rules + Privacy toggle
    const stgPane = doc.getElementById('tab-settings')!;
    const cdpCard = doc.createElement('section');
    cdpCard.id = 'settings-cdp-card';
    const cdpHeading = doc.createElement('h2');
    cdpHeading.textContent = 'Overlays & CDP';
    cdpCard.appendChild(cdpHeading);
    const cdpPill = doc.createElement('span');
    cdpPill.id = 'cdpStatusPill';
    cdpPill.setAttribute('data-cdp-state', 'cdp_unavailable');
    const cdpDiagHint = doc.createElement('div');
    cdpDiagHint.id = 'cdpDiagnosticHint';
    const resetOnbBtn = doc.createElement('button');
    resetOnbBtn.id = 'settingsResetOnboardingBtn';
    resetOnbBtn.setAttribute('data-action', 'resetAppOnboarding');
    resetOnbBtn.hidden = true;
    cdpCard.appendChild(cdpPill);
    cdpCard.appendChild(cdpDiagHint);
    cdpCard.appendChild(resetOnbBtn);
    stgPane.appendChild(cdpCard);

    const grExists = opts.globalRulesExists ?? true;
    const grTooLarge = opts.globalRulesTooLarge ?? false;
    const grLoaded = !grExists && !grTooLarge;
    const grCard = doc.createElement('section');
    grCard.id = 'globalRulesCard';
    grCard.setAttribute('data-gr-loaded', String(grLoaded));
    grCard.setAttribute('data-gr-exists', String(grExists));
    grCard.setAttribute('data-gr-too-large', String(grTooLarge));
    grCard.setAttribute('data-gr-max-bytes', String(200 * 1024));
    const grPath = doc.createElement('code');
    grPath.id = 'globalRulesPathText';
    grPath.setAttribute('data-masked-path', '~/.gemini/GEMINI.md');
    grPath.textContent = '~/.gemini/GEMINI.md';
    const grState = doc.createElement('span');
    grState.id = 'globalRulesState';
    grState.appendChild(doc.createElement('span'));
    const grReload = doc.createElement('button');
    grReload.id = 'globalRulesReloadBtn';
    grReload.setAttribute('data-action', 'readGlobalRulesFile');
    grReload.appendChild(doc.createElement('span'));
    const grOpen = doc.createElement('button');
    grOpen.id = 'globalRulesOpenBtn';
    grOpen.setAttribute('data-action', 'openGlobalRulesFile');
    const grReveal = doc.createElement('button');
    grReveal.id = 'globalRulesRevealBtn';
    grReveal.setAttribute('data-action', 'revealGlobalRulesFile');
    const grSave = doc.createElement('button');
    grSave.id = 'globalRulesSaveBtn';
    grSave.setAttribute('data-action', 'saveGlobalRulesFile');
    if (!grLoaded) {
        grSave.disabled = true;
        grSave.setAttribute('data-gr-save-locked', 'true');
    }
    const grFeedback = doc.createElement('span');
    grFeedback.id = 'globalRulesFeedback';
    const grEditor = doc.createElement('textarea');
    grEditor.id = 'globalRulesEditor';
    grEditor.readOnly = grExists;
    const grSize = doc.createElement('span');
    grSize.id = 'globalRulesSizeVal';
    for (const n of [grPath, grState, grReload, grOpen, grReveal, grSave, grFeedback, grEditor, grSize]) {
        grCard.appendChild(n);
    }
    stgPane.appendChild(grCard);

    const privacyBtn = doc.createElement('button');
    privacyBtn.id = 'privacyToggle';
    doc.body.appendChild(privacyBtn);

    let state: Record<string, unknown> = { ...(opts.initialState || {}) };
    const posted: any[] = [];
    const bridgeActions: any[] = [];
    const winListeners = new Map<string, Array<(e: any) => void>>();
    const pendingTimers: Array<{ id: number; fn: () => void; ms: number; cleared: boolean }> = [];
    let nextTimerId = 1;
    let nonceConsumed = false;

    const bridge = (opts.surface === 'app-sidecar' || opts.surface === 'standalone') ? {
        surface: opts.surface,
        isTrustedHostEvent: () => true,
        clearClientCaches: () => {},
        sendAction: async (action: any) => {
            bridgeActions.push(action);
            if (opts.bridgeSendAction) { return opts.bridgeSendAction(action); }
            return { ok: true, result: { ok: true } };
        },
        asVsCodeApi: () => ({
            getState: () => state,
            setState: (s: any) => { state = s; },
            postMessage: (m: any) => { posted.push(m); },
        }),
    } : null;

    const win: any = {
        location: { origin: 'vscode-webview://test-host', href: 'vscode-webview://test-host/index.html', hash: '' },
        __ACM_BRIDGE__: bridge,
        innerWidth: 900,
        innerHeight: 700,
        scrollY: 0,
        scrollTo: () => {},
        addEventListener: (t: string, fn: (e: any) => void) => {
            const list = winListeners.get(t) || [];
            list.push(fn);
            winListeners.set(t, list);
        },
        removeEventListener: () => {},
        requestAnimationFrame: (fn: () => void) => { fn(); return 1; },
        setTimeout: (fn: () => void, ms: number) => {
            const item = { id: nextTimerId++, fn, ms, cleared: false };
            pendingTimers.push(item);
            return item.id;
        },
        clearTimeout: (id: number) => {
            const item = pendingTimers.find(t => t.id === id);
            if (item) { item.cleared = true; }
        },
    };
    win.window = win;
    win.parent = opts.simulateVscodeParent ? win : {};
    if (opts.ideHostNonce) {
        win.__ACM_CONSUME_HOST_NONCE__ = () => {
            if (nonceConsumed) { return ''; }
            nonceConsumed = true;
            return opts.ideHostNonce;
        };
    }

    const ctx = vm.createContext({
        window: win,
        document: doc,
        Element: TestEl,
        HTMLElement: TestEl,
        URL,
        TextEncoder,
        Map,
        Set,
        Array,
        Object,
        JSON,
        Number,
        String,
        Boolean,
        Math,
        RegExp,
        Error,
        Promise,
        isFinite,
        parseInt,
        parseFloat,
        navigator: {},
        console,
        requestAnimationFrame: win.requestAnimationFrame,
        setTimeout: win.setTimeout,
        clearTimeout: win.clearTimeout,
        acquireVsCodeApi: () => ({
            getState: () => state,
            setState: (s: any) => { state = s; },
            postMessage: (m: any) => { posted.push(m); },
        }),
    });
    vm.runInContext(getScript({ buildId: 'wave2-test-build' }), ctx);

    const sendWinMessage = (data: any, extra: Record<string, unknown> = {}) => {
        const ev = { origin: win.location.origin, source: win, data, ...extra };
        for (const fn of winListeners.get('message') || []) { fn(ev); }
    };
    const dispatchWinEvent = (type: string, ev: Record<string, unknown>) => {
        for (const fn of winListeners.get(type) || []) { fn({ type, ...ev }); }
    };

    return {
        doc,
        win,
        posted,
        bridgeActions,
        pendingTimers,
        getState: () => state,
        sendWinMessage,
        dispatchWinEvent,
        isNonceConsumed: () => nonceConsumed,
    };
}

const flushMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

describe('[wave2-ui-ux-and-audit]', () => {
    const initialLang = getLanguage();
    afterEach(() => { setLanguageInMemory(initialLang); });

    describe('1. 6-Tab Navigation, Rich Tooltips & Responsive Narrow Fit', () => {
        it('promotes Settings to main 6-tab bar, removes #topbarSettingsBtn, and gives Settings + About rich non-duplicated tooltips across en/zh/both', () => {
            expect(CANONICAL_MAIN_TABS).toEqual(['overview', 'gm', 'sessions', 'calendar', 'models', 'settings']);
            expect(Object.keys(ALL_TAB_ALIASES)).toHaveLength(18);
            expect(resolveTabAlias('#settings-cdp-card')).toEqual({ tab: 'settings', anchor: 'settings-cdp-card' });
            expect(resolveTabAlias('#global-rules')).toEqual({ tab: 'settings', anchor: 'globalRulesCard' });

            for (const lang of ['en', 'zh', 'both'] as const) {
                setLanguageInMemory(lang);
                const html = buildMonitorDocumentHtml({
                    usage: null,
                    allUsages: [],
                    userInfo: null,
                    modelConfigs: [],
                    surface: 'app-sidecar',
                    now: Date.UTC(2026, 3, 10, 12, 0, 0),
                });
                expect(html).not.toContain('id="topbarSettingsBtn"');
                expect(html).toContain('id="tabBtn-settings"');
                expect(html).toContain('id="topbarAboutBtn"');
                expect(html).toContain('id="tab-settings"');
                expect(html).toContain('aria-labelledby="tabBtn-settings"');
                expect(html).toMatch(/id="tab-about"[^>]*role="region"[^>]*aria-label="/);

                const aboutTip = html.match(/id="topbarAboutBtn"[^>]*data-tip-title="([^"]+)"[^>]*data-tip-body="([^"]+)"/);
                expect(aboutTip, `missing rich tip on #topbarAboutBtn for ${lang}`).not.toBeNull();
                expect(aboutTip![1]).not.toBe(aboutTip![2]);
                expect(aboutTip![2].length).toBeGreaterThan(20);

                const settingsTip = html.match(/id="tabBtn-settings"[^>]*data-tip-title="([^"]+)"[^>]*data-tip-body="([^"]+)"/);
                expect(settingsTip, `missing rich tip on #tabBtn-settings for ${lang}`).not.toBeNull();
                expect(settingsTip![1]).not.toBe(settingsTip![2]);
                expect(settingsTip![2]).toContain('GEMINI.md');
            }

            const editorial = getEditorialStyles();
            expect(editorial).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
        });
    });

    describe('2. Antigravity App Persistent First-Open Onboarding Banner', () => {
        it('shows only on app-sidecar when undismissed & overlays not fully active, and auto-hides once CDP + an overlay are active', () => {
            setLanguageInMemory('both');
            const shown = buildAppOnboardingBannerHtml({
                surface: 'app-sidecar',
                appOnboardingDismissed: false,
                cdpStatus: { state: 'cdp_unavailable' } as any,
                appTopBarEnabled: false,
                appComposerRingEnabled: false,
            });
            expect(shown).toContain('id="appOnboardingBanner"');
            expect(shown).toContain('id="onboardingSetupCdpBtn"');
            expect(shown).toContain('id="onboardingGoCdpBtn"');
            expect(shown).toContain('id="onboardingDismissBtn"');

            expect(buildAppOnboardingBannerHtml({ surface: 'ide', appOnboardingDismissed: false })).toBe('');
            expect(buildAppOnboardingBannerHtml({ surface: 'app-sidecar', appOnboardingDismissed: true })).toBe('');
            expect(buildAppOnboardingBannerHtml({
                surface: 'app-sidecar',
                appOnboardingDismissed: false,
                cdpStatus: { state: 'connected' } as any,
                appTopBarEnabled: true,
                appComposerRingEnabled: false,
            })).toBe('');
            // Connected CDP with BOTH overlays disabled still shows guidance
            expect(buildAppOnboardingBannerHtml({
                surface: 'app-sidecar',
                appOnboardingDismissed: false,
                cdpStatus: { state: 'connected' } as any,
                appTopBarEnabled: false,
                appComposerRingEnabled: false,
            })).toContain('id="appOnboardingBanner"');
        });

        it('wires Go-to-CDP Settings, 1-Click Create Launcher, and persistent Dismiss in the client runtime', async () => {
            const env = createWave2Vm({
                surface: 'app-sidecar',
                bridgeSendAction: async (action) => {
                    if (action.command === 'setupCdpLauncher') {
                        return {
                            ok: true,
                            result: {
                                ok: true,
                                launcherStatus: { installed: true, platform: 'darwin', launcherPath: '/Applications/Antigravity (CDP).app' },
                            },
                        };
                    }
                    return { ok: true, result: { ok: true } };
                },
            });

            // 1. Go to Overlays & CDP Settings switches to settings tab + scrolls & highlights #settings-cdp-card
            env.doc.getElementById('onboardingGoCdpBtn')!.dispatch('click');
            expect(env.doc.getElementById('tabBtn-settings')!.classList.contains('active')).toBe(true);
            expect(env.doc.getElementById('tab-settings')!.classList.contains('active')).toBe(true);
            expect(env.doc.getElementById('settings-cdp-card')!.scrolledIntoView).toBe(true);

            // 2. 1-Click Create CDP Launcher calls bridge setupCdpLauncher & prints launcher path feedback
            env.doc.getElementById('onboardingSetupCdpBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions.some(a => a.command === 'setupCdpLauncher')).toBe(true);
            expect(env.doc.getElementById('onboardingFeedback')!.textContent).toContain('/Applications/Antigravity (CDP).app');

            // 3. Don't show again persists dismissAppOnboarding and hides banner + reveals reset button in Settings
            env.doc.getElementById('onboardingDismissBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions).toContainEqual({ command: 'dismissAppOnboarding', dismissed: true });
            expect(env.doc.getElementById('appOnboardingBanner')!.hidden).toBe(true);
            expect(env.doc.getElementById('settingsResetOnboardingBtn')!.hidden).toBe(false);
        });
    });

    describe('3. Settings UX Elevation & Hardened Antigravity Global Rules Card (~/.gemini/GEMINI.md)', () => {
        it('places Overlays & CDP at TOP of Settings on app-sidecar and renders hardened metadata-only Global Rules card on both surfaces', () => {
            setLanguageInMemory('both');
            const secretRules: GlobalRulesStatus = {
                path: '/Users/alice/.gemini/GEMINI.md',
                exists: true,
                sizeBytes: 420,
                tooLarge: false,
                content: 'TOP_SECRET_NEVER_INLINE_IN_SSR',
            };
            const appSettingsHtml = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                privacyMasked: true,
                globalRules: secretRules,
            });
            const cdpIdx = appSettingsHtml.indexOf('id="settings-cdp-card"');
            const displayIdx = appSettingsHtml.indexOf('id="settingsGroupDisplay"');
            expect(cdpIdx).toBeGreaterThan(-1);
            expect(displayIdx).toBeGreaterThan(cdpIdx);

            for (const surface of ['app-sidecar', 'ide'] as const) {
                const html = buildSettingsContent([], undefined, undefined, {
                    surface,
                    privacyMasked: true,
                    globalRules: secretRules,
                });
                expect(html).toContain('id="globalRulesCard"');
                expect(html).toContain('~/.gemini/GEMINI.md');
                expect(html).not.toContain('/Users/alice/.gemini/GEMINI.md');
                expect(html).not.toContain('TOP_SECRET_NEVER_INLINE_IN_SSR');
                expect(html).toContain('data-gr-loaded="false"');
                expect(html).toContain('data-gr-save-locked="true"');
                expect(html).toContain('@gitstq');
                expect(html).toContain('200 KiB');
            }
        });

        it('blocks Save before Load when file exists, loads/saves/opens/reveals, handles 403 standalone, and scrubs editor on privacy re-mask', async () => {
            let readResponse: any = {
                ok: true,
                result: { ok: true, path: '/Users/alice/.gemini/GEMINI.md', exists: true, sizeBytes: 24, tooLarge: false, content: '# My Global Rules\nBe concise.' },
            };
            const env = createWave2Vm({
                surface: 'app-sidecar',
                privacyMasked: false,
                globalRulesExists: true,
                bridgeSendAction: async (action) => {
                    if (action.command === 'readGlobalRulesFile') { return readResponse; }
                    if (action.command === 'saveGlobalRulesFile') {
                        return { ok: true, result: { ok: true, exists: true, sizeBytes: Buffer.byteLength(action.content || '', 'utf8') } };
                    }
                    if (action.command === 'openGlobalRulesFile') { return { ok: true, result: { ok: true, action: 'open' } }; }
                    if (action.command === 'revealGlobalRulesFile') { return { ok: true, result: { ok: true, action: 'reveal' } }; }
                    return { ok: true, result: { ok: true } };
                },
            });

            const saveBtn = env.doc.getElementById('globalRulesSaveBtn')!;
            const editor = env.doc.getElementById('globalRulesEditor')!;

            // 1. Clicking Save while unloaded MUST NOT send saveGlobalRulesFile!
            expect(saveBtn.disabled).toBe(true);
            saveBtn.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions.filter(a => a.command === 'saveGlobalRulesFile')).toHaveLength(0);

            // 2. Load / Edit fetches content on demand and unlocks Save
            env.doc.getElementById('globalRulesReloadBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(editor.value).toBe('# My Global Rules\nBe concise.');
            expect(editor.readOnly).toBe(false);
            expect(saveBtn.disabled).toBe(false);
            expect(saveBtn.getAttribute('data-gr-save-locked')).toBeNull();

            // 3. Editing and clicking Save persists updated text
            editor.value = '# Updated Global Rules\nAlways run tests.';
            saveBtn.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions).toContainEqual({
                command: 'saveGlobalRulesFile',
                content: '# Updated Global Rules\nAlways run tests.',
            });

            // 4. Open & Reveal actions dispatch cleanly
            env.doc.getElementById('globalRulesOpenBtn')!.dispatch('click');
            env.doc.getElementById('globalRulesRevealBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions.some(a => a.command === 'openGlobalRulesFile')).toBe(true);
            expect(env.bridgeActions.some(a => a.command === 'revealGlobalRulesFile')).toBe(true);

            // 5. Privacy re-mask scrubs editor content, masks path, and re-locks Save
            env.doc.getElementById('privacyToggle')!.dispatch('click');
            expect(editor.value).toBe('');
            expect(env.doc.getElementById('globalRulesPathText')!.textContent).toBe('~/.gemini/GEMINI.md');
            expect(saveBtn.disabled).toBe(true);
            expect(saveBtn.getAttribute('data-gr-save-locked')).toBe('true');

            // 6. Standalone 403 response shows clear blocked feedback
            readResponse = { ok: false, result: { ok: false, status: 403, errorCode: 'STANDALONE_FORBIDDEN', error: 'Blocked in standalone browser' } };
            env.doc.getElementById('globalRulesReloadBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(env.doc.getElementById('globalRulesFeedback')!.textContent).toMatch(/standalone|独立预览/i);
        });
    });

    describe('4. P0-2 IDE Host Nonce Verification, Secondary Tab Jumps & P2-2 Stale initialTab', () => {
        it('enforces one-shot __ACM_CONSUME_HOST_NONCE__, strips __acmHostNonce, rejects forged messages, and handles repeated switchToTab clicks', () => {
            const env = createWave2Vm({
                ideHostNonce: 'nonce-abc-123',
                simulateVscodeParent: true,
            });
            expect(env.isNonceConsumed()).toBe(true);
            expect(env.win.__ACM_CONSUME_HOST_NONCE__()).toBe('');

            const foreignSource = {};
            // Missing or wrong nonce MUST be rejected even when origin matches
            env.sendWinMessage({ command: 'switchToTab', tab: 'settings', requestId: 90 }, { source: foreignSource });
            expect(env.doc.getElementById('tabBtn-settings')!.classList.contains('active')).toBe(false);

            env.sendWinMessage({ command: 'switchToTab', tab: 'settings', requestId: 91, __acmHostNonce: 'wrong-nonce' }, { source: foreignSource });
            expect(env.doc.getElementById('tabBtn-settings')!.classList.contains('active')).toBe(false);

            // Valid nonce succeeds on EVERY secondary click across all 6 tabs and sends tabShown ACK
            const jumps = [['gmdata', 'gm'], ['pricing', 'calendar'], ['settings', 'settings'], ['models', 'models'], ['overview', 'overview']] as const;
            jumps.forEach(([alias, expectedTab], idx) => {
                env.posted.length = 0;
                const reqId = 100 + idx;
                env.sendWinMessage({ command: 'switchToTab', tab: alias, requestId: reqId, __acmHostNonce: 'nonce-abc-123' }, { source: foreignSource });
                expect(env.doc.getElementById(`tabBtn-${expectedTab}`)!.classList.contains('active')).toBe(true);
                expect(env.posted.some(m => m.command === 'tabShown' && m.requestId === reqId)).toBe(true);
            });
        });

        it('P2-2: ignores already-consumed data-initial-tab on IDE hide/reveal and cancels initial 80ms scroll timer on manual switch', () => {
            const env = createWave2Vm({
                initialTab: 'gm',
                initialState: { activeTab: 'models', initialTabConsumed: 'gm|' },
            });
            // Should stay on savedState.activeTab ('models') instead of replaying stale data-initial-tab ('gm')
            expect(env.doc.getElementById('tabBtn-models')!.classList.contains('active')).toBe(true);
            expect(env.doc.getElementById('tabBtn-gm')!.classList.contains('active')).toBe(false);

            // Saved per-tab scroll schedules an 80ms scroll restore timer; switching tabs before it fires cancels it
            const fresh = createWave2Vm({ initialState: { activeTab: 'overview', tabScrolls: { overview: 320 } } });
            const scrollTimer = fresh.pendingTimers.find(t => t.ms === 80);
            expect(scrollTimer).toBeDefined();
            fresh.doc.getElementById('tabBtn-settings')!.dispatch('click');
            expect(scrollTimer!.cleared).toBe(true);
        });
    });

    describe('5. Remaining Frontend Audit Fixes (P1-1/P1-2/P1-3/P1-12/P2-1/P2-14/P2-15/P2-18/P2-19/P2-20/P2-21)', () => {
        it('P1-1, P2-19: light theme pricing inputs include [data-acm-theme="light"] and .gm-anomaly-count has no opacity: .85', () => {
            const pricingCss = getPricingTabStyles();
            expect(pricingCss).toMatch(/\[data-acm-theme="light"\][^{]*\.prc-edit-input/);

            const gmCss = getGMDataTabStyles();
            const anomalyBlock = gmCss.match(/\.gm-anomaly-count\s*\{[^}]*\}/);
            expect(anomalyBlock).not.toBeNull();
            expect(anomalyBlock![0]).not.toMatch(/opacity\s*:\s*0?\.85/);
        });

        it('P1-2: CDP overlay parses oklch/hsl/color(srgb)/space-rgb as light theme and honors OS high-contrast in auto mode', () => {
            const runOverlayDetect = (bgColor: string, forcedColors: boolean, payload: Record<string, unknown>) => {
                const doc = new TestDoc();
                const createdHosts: TestEl[] = [];
                const origCreate = doc.createElement.bind(doc);
                doc.createElement = (tag: string) => {
                    const el = origCreate(tag);
                    (el as any).attachShadow = () => {
                        const sr = origCreate('shadow-root');
                        (el as any).shadowRoot = sr;
                        createdHosts.push(el);
                        return sr;
                    };
                    return el;
                };
                const win: any = {
                    document: doc,
                    location: { origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' },
                    navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' },
                    innerWidth: 1280,
                    innerHeight: 800,
                    getComputedStyle: () => ({ backgroundColor: bgColor }),
                    matchMedia: (q: string) => ({
                        matches: forcedColors && (q.includes('forced-colors') || q.includes('prefers-contrast')),
                        addEventListener: () => {},
                        removeEventListener: () => {},
                    }),
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    requestAnimationFrame: (fn: () => void) => { fn(); return 1; },
                    setTimeout: () => 1,
                    clearTimeout: () => {},
                };
                win.window = win;
                const ctx = vm.createContext({
                    window: win,
                    document: doc,
                    navigator: win.navigator,
                    Element: TestEl,
                    HTMLElement: TestEl,
                    MutationObserver: class { observe() {} disconnect() {} },
                    ResizeObserver: class { observe() {} disconnect() {} },
                    console,
                    Math,
                    Number,
                    String,
                    Boolean,
                    Object,
                    Array,
                    JSON,
                    Date,
                    RegExp,
                    Map,
                    Set,
                    isFinite,
                    parseInt,
                    parseFloat,
                    requestAnimationFrame: win.requestAnimationFrame,
                    setTimeout: win.setTimeout,
                    clearTimeout: win.clearTimeout,
                    setInterval: () => 1,
                    clearInterval: () => {},
                });
                vm.runInContext(CDP_OVERLAY_CLIENT_BUNDLE, ctx);
                (ctx as any).__ACM_CDP_OVERLAY_FACTORY__.mountCdpOverlayRuntime({
                    globalKey: '__ACM_TEST_OV__',
                    scriptVersion: '1.18.0',
                    buildId: 'test-p1-2',
                    composerHostId: 'acm-comp',
                    topBarHostId: 'acm-top',
                    composerCss: '',
                    topBarCss: '',
                });
                win.__ACM_TEST_OV__.applyState(payload, { appComposerRingEnabled: false, appTopBarEnabled: true });
                const host = createdHosts[0] || doc.getElementById('acm-top');
                return {
                    theme: host?.getAttribute('data-theme'),
                    contrast: host?.getAttribute('data-contrast'),
                };
            };

            for (const lightBg of ['oklch(0.96 0.01 250)', 'hsl(0, 0%, 98%)', '0 0% 98%', 'color(srgb 0.95 0.95 0.95)', 'rgb(250 250 250 / 1)']) {
                const res = runOverlayDetect(lightBg, true, { highContrast: 'auto', overlayHighContrast: false });
                expect(res.theme, `expected light theme for ${lightBg}`).toBe('light');
                expect(res.contrast, `expected high contrast for ${lightBg} under OS forced-colors`).toBe('high');
            }
            const explicitNormal = runOverlayDetect('oklch(0.15 0.01 250)', true, { highContrast: 'normal' });
            expect(explicitNormal.theme).toBe('dark');
            expect(explicitNormal.contrast).toBe('normal');
        });

        it('P1-3: privacy re-mask renders non-blank recovery placeholder and handles failed setPrivacyMask + retry', async () => {
            let shouldFail = true;
            const env = createWave2Vm({
                surface: 'app-sidecar',
                privacyMasked: false,
                bridgeSendAction: async (action) => {
                    if (action.command === 'setPrivacyMask' && shouldFail) {
                        return { ok: false, result: { ok: false, error: 'temporary failure' } };
                    }
                    return { ok: true, result: { ok: true } };
                },
            });

            env.doc.getElementById('privacyToggle')!.dispatch('click');
            await flushMicrotasks();

            const placeholder = env.doc.getElementById('tab-overview')!.querySelector('.privacy-remask-placeholder');
            expect(placeholder).not.toBeNull();
            expect(placeholder!.getAttribute('data-privacy-remask-state')).toBe('error');
            expect(placeholder!.getAttribute('role')).toBe('alert');

            shouldFail = false;
            const retryBtn = placeholder!.querySelector('[data-action="retryPrivacyRemask"]');
            expect(retryBtn).not.toBeNull();
            retryBtn!.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions.filter(a => a.command === 'setPrivacyMask')).toHaveLength(2);
        });

        it('P1-12: Calendar strictly escapes malicious imported date keys and attributes', () => {
            const store = new DailyStore();
            const maliciousDate = '2026-04-01" onmouseover="alert(1)';
            // Verify mergeRecords sanitizes/drops malformed keys
            expect(store.mergeRecords({
                version: 1,
                records: {
                    [maliciousDate]: {
                        date: maliciousDate,
                        cycles: [{
                            archivedAt: '2026-04-01T10:00:00Z',
                            reasoning: 1,
                            toolCalls: 0,
                            errors: 0,
                            estSteps: 1,
                            inputTokens: 1000,
                            outputTokens: 500,
                            models: {},
                            gmCalls: 2,
                            gmCredits: 0,
                            gmInputTokens: 1000,
                            gmOutputTokens: 500,
                            gmCacheRead: 200,
                            gmEstimatedCost: 0.05,
                            gmModels: { 'gemini-3-flash': { calls: 2, credits: 0, inputTokens: 1000, outputTokens: 500, thinkingTokens: 0, avgTTFT: 0.5, cacheHitRate: 0.2, estimatedCost: 0.05 } },
                        }],
                    },
                },
            })).toBe(0);

            // Even if a malicious date key were injected directly into internal _records, calendar HTML must escape attributes cleanly
            ((store as any)._records as Map<string, any>).set(maliciousDate, {
                date: maliciousDate,
                cycles: [{
                    archivedAt: '2026-04-01T10:00:00Z',
                    reasoning: 1,
                    toolCalls: 0,
                    errors: 0,
                    estSteps: 1,
                    inputTokens: 1000,
                    outputTokens: 500,
                    models: {},
                    gmCalls: 2,
                    gmCredits: 0,
                    gmInputTokens: 1000,
                    gmOutputTokens: 500,
                    gmCacheRead: 200,
                    gmEstimatedCost: 0.05,
                    gmModels: { 'gemini-3-flash': { calls: 2, credits: 0, inputTokens: 1000, outputTokens: 500, thinkingTokens: 0, avgTTFT: 0.5, cacheHitRate: 0.2, estimatedCost: 0.05 } },
                }],
            });
            const html = buildCalendarTabContent(store, 2026, 4, { now: new Date(2026, 3, 2) });
            expect(html).not.toContain('" onmouseover="alert(1)');
        });

        it('P2-1: CDP diagnostic template formatting does not expand $& replacement sequences', () => {
            const env = createWave2Vm({ surface: 'app-sidecar' });
            env.sendWinMessage({
                command: 'cdpStatusResult',
                cdpStatus: {
                    state: 'error',
                    diagnosticCode: 'ws_error',
                    errorMessage: 'bad $& token $$',
                },
            });
            expect(env.doc.getElementById('cdpDiagnosticHint')!.textContent).toContain('bad $& token $$');
        });

        it('P2-14, P2-15, P2-18, P2-20, P2-21: Pricing currency, Calendar Swarm filter, ZH Swarm tags, Handoff v2 409 & preserve, and optional cspNonce', async () => {
            setLanguageInMemory('zh');
            const swarmHtml = renderSwarmMemberItemHtml({
                cascadeId: 'worker-1',
                memberName: 'reviewer-1',
                relationshipKind: 'nested_helper',
                isLockedRoot: true,
                contextPct: 45,
            }, 'overview');
            expect(swarmHtml).toContain('嵌套助手');
            expect(swarmHtml).toContain('已锁定');
            expect(swarmHtml).not.toContain('>Nested<');
            expect(swarmHtml).toContain('<details class="swarm-member-details"');
            expect(swarmHtml).toContain('成员详情');
            expect(swarmHtml).toContain('aria-label="在概览中查看: reviewer-1"');

            // P2-14 + P2-15 + P2-21 via buildMonitorTabsPayload & buildMonitorDocumentHtml
            const pricingStore = new PricingStore();
            const dailyStore = new DailyStore();
            const baseDocParams: MonitorDocumentBuildParams = {
                userInfo: null,
                modelConfigs: [],
                pricingStore,
                dailyStore,
                surface: 'app-sidecar',
                settings: { displayCurrency: 'CAD' },
                cspNonce: 'nonceTest12345678',
                swarmGroupCost: {
                    rootId: 'root-live',
                    totalCostUsd: 4.5,
                    unpricedCalls: 0,
                    directCostByMember: { 'root-live': 4.5 },
                    uniqueLogicalCalls: 3,
                    memberCount: 1,
                } as any,
                calendarOptions: { sourceFilter: 'cli' },
                now: Date.UTC(2026, 3, 10, 12, 0, 0),
                gmFullSummary: {
                    totalCalls: 1,
                    totalInputTokens: 100000,
                    totalOutputTokens: 50000,
                    totalCacheRead: 0,
                    totalCacheCreation: 0,
                    totalThinkingTokens: 0,
                    totalCredits: 0,
                    totalErrors: 0,
                    modelBreakdown: {
                        'gemini-2.5-pro': {
                            responseModel: 'gemini-2.5-pro',
                            callCount: 1,
                            totalInputTokens: 100000,
                            totalOutputTokens: 50000,
                            totalCacheRead: 0,
                            totalCacheCreation: 0,
                            totalThinkingTokens: 0,
                            totalCredits: 0,
                            errors: 0,
                        } as any,
                    },
                    conversations: [],
                } as any,
            };
            const tabsCli = buildMonitorTabsPayload(baseDocParams);
            expect(tabsCli.pricing).toContain('CA$');
            expect(tabsCli.calendar).not.toContain('data-swarm-group-cost="true"');

            const tabsApp = buildMonitorTabsPayload({
                ...baseDocParams,
                calendarOptions: { sourceFilter: 'app' },
            });
            expect(tabsApp.calendar).toContain('data-swarm-group-cost="true"');

            const html = buildMonitorDocumentHtml(baseDocParams);
            expect(html).toContain('CA$');
            expect(html).toContain(`script-src 'nonce-nonceTest12345678'`);
            expect(html).toContain('<script nonce="nonceTest12345678">');

            // P2-20: Handoff v2 409 revisionMismatch disables copy & open preview survives Overview incremental patch
            const env = createWave2Vm({
                surface: 'app-sidecar',
                bridgeSendAction: async (action) => {
                    if (action.command === 'previewHandoffV2') {
                        return { ok: false, result: { ok: false, status: 409, revisionMismatch: true, dataRevision: 9 } };
                    }
                    return { ok: true, result: { ok: true } };
                },
            });
            env.doc.getElementById('previewHandoffV2Btn')!.dispatch('click');
            await flushMicrotasks();
            const hBox = env.doc.getElementById('handoffV2PreviewBox')!;
            const hTa = env.doc.getElementById('handoffV2PreviewText')!;
            const hCopy = hBox.querySelector('[data-action="copyHandoffPreviewText"]')!;
            expect(hBox.hidden).toBe(false);
            expect(hCopy.disabled).toBe(true);
            expect(hCopy.getAttribute('data-handoff-stale')).toBe('true');
            expect(hTa.value.length).toBeGreaterThan(5);
        });
    });

    describe('6. Wave 3.5 Frontend & Theme Polish Regressions', () => {
        it('Bug #1: Calendar falls back to live swarmGroupCost when swarmTopology groups have no dailyStore byCascade records, still honoring sourceFilter', () => {
            const pricingStore = new PricingStore();
            const dailyStore = new DailyStore();
            const swarmTopology: any = {
                nodesById: new Map(),
                groupsByRootId: new Map([['root-live', { rootId: 'root-live', coordinatorIds: new Set(['root-live']), memberIds: new Set(['root-live', 'worker-1']) }]]),
            };
            const swarmGroupCost: any = {
                rootId: 'root-live',
                directCostByMember: {
                    'root-live': { cascadeId: 'root-live', directCostUsd: 0.4, callCount: 2, pricedCallCount: 2, unpricedCallCount: 0, totalTokens: 20_000 },
                },
                coordinatorDirectCostUsd: 0.4,
                workersDirectCostUsd: 0.1,
                inclusiveGroupCostUsd: 0.5,
                uniqueCallCount: 3,
                duplicateCallsDeduplicated: 0,
                pricedCallCount: 3,
                unpricedCallCount: 0,
                hasUnpricedCalls: false,
            };
            const baseParams: MonitorDocumentBuildParams = {
                userInfo: null,
                modelConfigs: [],
                pricingStore,
                dailyStore,
                surface: 'ide',
                swarmTopology,
                swarmGroupCost,
                now: Date.UTC(2026, 10, 27, 12, 0, 0),
            };
            const ideTabs = buildMonitorTabsPayload({ ...baseParams, calendarOptions: { sourceFilter: 'all' } });
            expect(ideTabs.calendar).toContain('id="calSwarmGroupCost"');
            expect(ideTabs.calendar).toContain('data-swarm-group-cost="true"');

            const ideFiltered = buildMonitorTabsPayload({ ...baseParams, calendarOptions: { sourceFilter: 'ide' } });
            expect(ideFiltered.calendar).toContain('id="calSwarmGroupCost"');

            const cliFiltered = buildMonitorTabsPayload({ ...baseParams, calendarOptions: { sourceFilter: 'cli' } });
            expect(cliFiltered.calendar).not.toContain('id="calSwarmGroupCost"');
        });

        it('R2-P1-5 + Bug #2: theme-adapter drops :root dark fallback and host-bridge honors kind-only light, OS light, body #fafafa, and hc-light/hc without downgrading', () => {
            const css = getThemeAdapterStyles();
            expect(css).not.toMatch(/:root\s*,/);

            const script = getHostBridgeScript({ autoPoll: false });
            const inlineProps: Record<string, string> = {};
            const bodyAttrs: Record<string, string> = {};
            const winListeners: Record<string, Array<(ev: any) => void>> = {};
            const parentWin = { __isParent: true };
            let osLight = false;
            const doc: any = {
                readyState: 'complete',
                hidden: false,
                documentElement: {
                    style: {
                        setProperty: (k: string, v: string) => { inlineProps[k] = v; },
                        getPropertyValue: (k: string) => inlineProps[k] || '',
                        removeProperty: (k: string) => { delete inlineProps[k]; },
                    },
                    getAttribute: (k: string) => bodyAttrs[`html:${k}`] ?? null,
                    setAttribute: (k: string, v: string) => { bodyAttrs[`html:${k}`] = v; },
                    className: '',
                },
                body: {
                    getAttribute: (k: string) => bodyAttrs[k] ?? null,
                    setAttribute: (k: string, v: string) => { bodyAttrs[k] = v; },
                    classList: { toggle: () => {} },
                    style: { backgroundColor: '#fafafa' },
                },
                getElementById: () => null,
                addEventListener: () => {},
            };
            const win: any = {
                document: doc,
                parent: parentWin,
                location: { origin: 'http://127.0.0.1:41234', href: 'http://127.0.0.1:41234/', pathname: '/', search: '' },
                URL,
                URLSearchParams,
                MutationObserver: class { observe() {} disconnect() {} },
                matchMedia: (q: string) => ({
                    matches: q.includes('prefers-color-scheme: light') ? osLight : false,
                    addEventListener: () => {},
                }),
                // Simulate a stylesheet setting --vscode-editor-background: #0D1014 on :root while --background is unset
                getComputedStyle: () => ({
                    getPropertyValue: (k: string) => inlineProps[k] || (k === '--vscode-editor-background' ? '#0D1014' : ''),
                }),
                addEventListener: (type: string, fn: (ev: any) => void) => { (winListeners[type] ||= []).push(fn); },
                dispatchEvent: () => {},
                sidecar: { fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) },
                setTimeout,
                clearTimeout,
            };
            win.window = win;
            win.self = win;
            vm.runInNewContext(script, { window: win, document: doc, URL, URLSearchParams, MutationObserver: win.MutationObserver, setTimeout, clearTimeout, Promise });

            // 1. /preload.js body #fafafa resolves light even if computed --vscode-editor-background is #0D1014
            expect(bodyAttrs['data-acm-theme']).toBe('light');

            // 2. Dark cssVariables switches to dark, then kind-only light theme-change clears stale dark --background and switches to light
            for (const fn of winListeners.message || []) {
                fn({ source: parentWin, origin: 'plugin://antigravity-context-monitor', data: { type: 'theme-change', payload: { theme: 'dark', cssVariables: { '--background': '#0D1014' } } } });
            }
            expect(bodyAttrs['data-acm-theme']).toBe('dark');
            expect(inlineProps['--background']).toBe('#0D1014');

            for (const fn of winListeners.message || []) {
                fn({ source: parentWin, origin: 'plugin://antigravity-context-monitor', data: { type: 'theme-change', theme: 'light' } });
            }
            expect(inlineProps['--background']).toBeUndefined();
            expect(bodyAttrs['data-acm-theme']).toBe('light');

            // 3. Explicit hc-light and hc hints MUST NOT be downgraded to light/dark when cssVariables are present
            for (const fn of winListeners.message || []) {
                fn({ source: parentWin, origin: 'plugin://antigravity-context-monitor', data: { type: 'theme-change', payload: { theme: 'hc-light', cssVariables: { '--background': '#ffffff' } } } });
            }
            expect(bodyAttrs['data-acm-theme']).toBe('hc-light');

            for (const fn of winListeners.message || []) {
                fn({ source: parentWin, origin: 'plugin://antigravity-context-monitor', data: { type: 'theme-change', payload: { theme: 'hc', cssVariables: { '--background': '#000000' } } } });
            }
            expect(bodyAttrs['data-acm-theme']).toBe('hc');
        });

        it('R2-P1-2: failed privacy re-mask keeps privacyChangePending blocking unmasked GETs and guards delayed error overwrite + non-active tabs', async () => {
            // 1. host-bridge keeps privacyChangePending=true on failed setPrivacyMask(true)
            const script = getHostBridgeScript({ autoPoll: false });
            const fetchQueue: Array<{ url: string; opts: any; resolve: (v: any) => void }> = [];
            const receivedTabs: string[] = [];
            const winListeners: Record<string, Array<(ev: any) => void>> = {};
            const doc: any = {
                readyState: 'complete',
                hidden: true, // suppress automatic retry timers during test
                documentElement: { style: { getPropertyValue: () => '', setProperty: () => {} }, getAttribute: () => null, setAttribute: () => {}, className: '' },
                body: { getAttribute: () => null, setAttribute: () => {}, classList: { toggle: () => {} }, style: {} },
                getElementById: () => null,
                addEventListener: () => {},
            };
            const win: any = {
                document: doc,
                location: { origin: 'http://127.0.0.1:41234', href: 'http://127.0.0.1:41234/', pathname: '/', search: '' },
                URL,
                URLSearchParams,
                matchMedia: () => ({ matches: false, addEventListener: () => {} }),
                getComputedStyle: () => ({ getPropertyValue: () => '' }),
                addEventListener: (t: string, fn: (ev: any) => void) => { (winListeners[t] ||= []).push(fn); },
                dispatchEvent: (ev: any) => { for (const fn of winListeners[ev.type] || []) { fn(ev); } },
                sidecar: {
                    fetch: (url: string, opts: any) => new Promise((resolve) => { fetchQueue.push({ url, opts, resolve }); }),
                },
                setTimeout,
                clearTimeout,
            };
            win.window = win;
            win.self = win;
            vm.runInNewContext(script, { window: win, document: doc, URL, URLSearchParams, setTimeout, clearTimeout, Promise });
            win.addEventListener('message', (ev: any) => { if (ev.data?.command === 'updateTabs') { receivedTabs.push(ev.data.tabs?.overview || ''); } });

            const failReq = win.__ACM_BRIDGE__.sendAction({ command: 'setPrivacyMask', masked: true });
            fetchQueue.shift()!.resolve({ ok: true, status: 200, json: async () => ({ ok: false, error: 'busy' }) });
            await failReq;

            // Unmasked GET MUST be dropped while privacyChangePending stays true!
            const unmaskedPoll = win.__ACM_BRIDGE__.pollNow(true);
            fetchQueue.shift()!.resolve({
                ok: true,
                status: 200,
                json: async () => ({ unchanged: false, hash: 'h-leak', snapshot: { privacyMasked: false, tabs: { overview: 'LEAKED_PII' } } }),
            });
            await unmaskedPoll;
            expect(receivedTabs).not.toContain('LEAKED_PII');

            // Confirmed masked GET repaints cleanly
            const maskedPoll = win.__ACM_BRIDGE__.pollNow(true);
            fetchQueue.shift()!.resolve({
                ok: true,
                status: 200,
                json: async () => ({ unchanged: false, hash: 'h-safe', snapshot: { privacyMasked: true, tabs: { overview: 'SAFE_MASKED' } } }),
            });
            await maskedPoll;
            expect(receivedTabs).toContain('SAFE_MASKED');

            // 2. Client monotonic counter prevents delayed failure from overwriting a newer masked repaint & fills non-active tabs
            let resolveDelayedFail!: (v: any) => void;
            const env = createWave2Vm({
                surface: 'app-sidecar',
                privacyMasked: false,
                bridgeSendAction: (action) => {
                    if (action.command === 'setPrivacyMask') {
                        return new Promise((resolve) => { resolveDelayedFail = resolve; });
                    }
                    return Promise.resolve({ ok: true, result: { ok: true } });
                },
            });
            env.doc.getElementById('privacyToggle')!.dispatch('click');
            expect(env.doc.getElementById('slot-gm')!.querySelector('.privacy-remask-placeholder')).not.toBeNull();
            expect(env.doc.getElementById('tab-about')!.querySelector('.privacy-remask-placeholder')).not.toBeNull();

            // Fresh masked updateTabs arrives BEFORE the delayed failure resolves
            env.sendWinMessage({ command: 'updateTabs', privacyMasked: true, tabs: { overview: '<p>MASKED_OK</p>' } });
            expect(env.doc.getElementById('tab-overview')!.innerHTML).toBe('<p>MASKED_OK</p>');

            // Delayed failure resolves now — MUST NOT clobber #tab-overview with an error placeholder!
            resolveDelayedFail({ ok: false, result: { ok: false, error: 'late timeout' } });
            await flushMicrotasks();
            expect(env.doc.getElementById('tab-overview')!.innerHTML).toBe('<p>MASKED_OK</p>');
            expect(env.doc.getElementById('tab-overview')!.querySelector('.privacy-remask-placeholder')?.getAttribute('data-privacy-remask-state')).not.toBe('error');
        });

        it('R2-P1-3 + R2-P2-2: Global Rules locks Save on exists false->true, preserves outer res.ok on Open/Reveal, and separates SYMLINK_ESCAPE vs TOO_LARGE', async () => {
            let nextRead: any = { ok: false, result: { ok: false, exists: true, errorCode: 'SYMLINK_ESCAPE', error: 'symlink escape' } };
            const env = createWave2Vm({
                surface: 'app-sidecar',
                privacyMasked: false,
                globalRulesExists: false, // starts missing -> Save initially unlocked
                bridgeSendAction: async (action) => {
                    if (action.command === 'openGlobalRulesFile') {
                        // Outer ok: true, inner result omits ok (mirrors App sidecar-runtime before backend fix) and reports exists: true
                        return { ok: true, result: { action: 'open', opened: '~/.gemini/GEMINI.md', exists: true, sizeBytes: 128 } };
                    }
                    if (action.command === 'readGlobalRulesFile') { return nextRead; }
                    return { ok: true, result: { ok: true } };
                },
            });

            const saveBtn = env.doc.getElementById('globalRulesSaveBtn')!;
            const statePill = env.doc.getElementById('globalRulesState')!;
            expect(saveBtn.disabled).toBe(false);

            // Clicking Open File creates GEMINI.md -> feedback MUST show Opened (not failure) AND Save MUST lock!
            env.doc.getElementById('globalRulesOpenBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(env.doc.getElementById('globalRulesFeedback')!.textContent).toMatch(/Opened|已打开/);
            expect(saveBtn.disabled).toBe(true);
            expect(saveBtn.getAttribute('data-gr-save-locked')).toBe('true');

            // Clicking Save now MUST NOT send saveGlobalRulesFile (prevents wiping GEMINI.md to "")!
            saveBtn.dispatch('click');
            await flushMicrotasks();
            expect(env.bridgeActions.filter(a => a.command === 'saveGlobalRulesFile')).toHaveLength(0);

            // SYMLINK_ESCAPE labels pill Invalid Path (NOT Too Large) and locks Save
            env.doc.getElementById('globalRulesReloadBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(statePill.getAttribute('data-gr-error')).toBe('SYMLINK_ESCAPE');
            expect(statePill.querySelector('span')!.textContent).toMatch(/Invalid Path|路径异常/);
            expect(statePill.querySelector('span')!.textContent).not.toMatch(/200 KiB|Too Large|超出上限/);
            expect(saveBtn.disabled).toBe(true);

            // TOO_LARGE labels pill Too Large cleanly (distinct from SYMLINK_ESCAPE)
            nextRead = { ok: false, result: { ok: false, exists: true, tooLarge: true, sizeBytes: 300_000 } };
            env.doc.getElementById('globalRulesReloadBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(statePill.querySelector('span')!.textContent).toMatch(/Too Large|超出上限/);
            expect(saveBtn.disabled).toBe(true);
        });

        it('R2-P1-13 + R2-P2-3/4/5/6: .action-btn[hidden], IDE acm:snapshot nonce gate, 320px 6-tab wrap, standalone onboarding CTA & non-optimistic dismiss, and Pricing currency tooltip', async () => {
            // R2-P1-13: .action-btn[hidden]
            expect(getStyles()).toContain('.action-btn[hidden] { display: none !important; }');

            // R2-P2-4: 320px 6-tab 2-line wrap CSS
            expect(getEditorialStyles()).toMatch(/@media\s*\(max-width:\s*360px\)[\s\S]*-webkit-line-clamp:\s*2/);

            // R2-P2-3: IDE acm:snapshot requires matching per-panel host nonce
            const ideEnv = createWave2Vm({ ideHostNonce: 'ide-secret-99', simulateVscodeParent: true });
            ideEnv.dispatchWinEvent('acm:snapshot', { detail: { snapshot: { tabs: { overview: '<p>FORGED</p>' } } } });
            expect(ideEnv.doc.getElementById('tab-overview')!.innerHTML).not.toBe('<p>FORGED</p>');
            ideEnv.dispatchWinEvent('acm:snapshot', { detail: { __acmHostNonce: 'ide-secret-99', snapshot: { tabs: { overview: '<p>TRUSTED</p>' } } } });
            expect(ideEnv.doc.getElementById('tab-overview')!.innerHTML).toBe('<p>TRUSTED</p>');

            // R2-P2-5: Standalone hides #onboardingSetupCdpBtn & failed dismiss does NOT hide banner
            const stEnv = createWave2Vm({
                surface: 'standalone',
                bridgeSendAction: async (action) => {
                    if (action.command === 'dismissAppOnboarding') { return { ok: false, error: 'persist failed' }; }
                    return { ok: true, result: { ok: true } };
                },
            });
            expect(stEnv.doc.getElementById('onboardingSetupCdpBtn')!.hidden).toBe(true);
            stEnv.doc.getElementById('onboardingDismissBtn')!.dispatch('click');
            await flushMicrotasks();
            expect(stEnv.doc.getElementById('appOnboardingBanner')!.hidden).toBe(false);
            expect(stEnv.doc.getElementById('onboardingFeedback')!.textContent).toContain('persist failed');

            // R2-P2-4: jumping to #settings-cdp-card focuses destination heading
            stEnv.doc.getElementById('onboardingGoCdpBtn')!.dispatch('click');
            expect(stEnv.doc.getElementById('settings-cdp-card')!.querySelector('h2')!.focused).toBe(true);

            // R2-P2-6: Pricing summary tooltips reflect active display currency (CAD, not hardcoded USD)
            setLanguageInMemory('en');
            const prcHtml = buildPricingTabContent(
                {
                    totalCalls: 1,
                    totalInputTokens: 100_000,
                    totalOutputTokens: 20_000,
                    totalCacheRead: 0,
                    totalCacheCreation: 0,
                    totalThinkingTokens: 0,
                    totalCredits: 0,
                    totalErrors: 0,
                    modelBreakdown: {
                        'Gemini 4 Neon': {
                            responseModel: 'gemini-4-neon',
                            callCount: 1,
                            totalInputTokens: 100_000,
                            totalOutputTokens: 20_000,
                            totalCacheRead: 0,
                            totalCacheCreation: 0,
                            totalThinkingTokens: 0,
                            totalCredits: 0,
                            errors: 0,
                        } as any,
                    },
                    conversations: [],
                } as any,
                new PricingStore(),
                undefined,
                undefined,
                undefined,
                false,
                { currency: 'CAD' },
            );
            expect(prcHtml).toContain('Estimated CAD equivalent');
            expect(prcHtml).not.toContain('Estimated USD equivalent');
        });
    });
});

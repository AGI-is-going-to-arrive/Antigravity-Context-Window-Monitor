import * as vm from 'vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    CONTEXT_CATEGORY_META,
    CONTEXT_CATEGORY_ORDER,
    CONTEXT_FREE_SPACE_META,
    parseContextBreakdown,
} from '../src/context-breakdown';
import { getLanguage, setLanguageToState, type Language } from '../src/i18n-core';
import {
    getModelDisplayName,
    type ModelConfig,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../src/models';
import type { ContextUsage } from '../src/tracker';
import type { GMCallEntry, GMSummary } from '../src/gm-tracker';
import type { QuotaRunwayEstimate } from '../src/quota-runway';
import {
    buildMonitorDocumentHtml,
    buildMonitorMastheadControlsHtml,
    buildNativeHudHtml,
} from '../src/webview-document';
import { buildContextBreakdownCard, buildOverviewTabContent } from '../src/webview-overview-tab';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { getStyles } from '../src/webview-styles';
import { getScript } from '../src/webview-script';

const memState = { get: <T>(_k: string, d: T) => d, update: async () => {} };
const initialLang = getLanguage();
const NOW = Date.parse('2026-11-23T10:30:00Z');

// ─── Lightweight DOM Harness for Client-Side VM Behavioral Tests ─────────────

class MiniClassList {
    private set = new Set<string>();
    constructor(private owner: MiniElement) {}
    syncFromClassName(cls: string) {
        this.set = new Set(cls.split(/\s+/).filter(Boolean));
    }
    private flush() {
        this.owner._className = [...this.set].join(' ');
    }
    add(...names: string[]) {
        for (const n of names) { if (n) { this.set.add(n); } }
        this.flush();
    }
    remove(...names: string[]) {
        for (const n of names) { this.set.delete(n); }
        this.flush();
    }
    toggle(name: string, force?: boolean): boolean {
        const next = force !== undefined ? Boolean(force) : !this.set.has(name);
        if (next) { this.set.add(name); } else { this.set.delete(name); }
        this.flush();
        return next;
    }
    contains(name: string): boolean {
        return this.set.has(name);
    }
}

class MiniElement {
    tagName: string;
    id = '';
    _className = '';
    classList: MiniClassList;
    attrs = new Map<string, string>();
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: MiniElement[] = [];
    parentElement: MiniElement | null = null;
    hidden = false;
    disabled = false;
    textContent = '';
    _innerHTML = '';
    scrollTop = 0;
    offsetWidth = 220;
    offsetHeight = 76;
    rect = { left: 100, right: 160, top: 200, bottom: 224, width: 60, height: 24 };
    listeners = new Map<string, Array<(e: any) => void>>();
    content?: { cloneNode: (deep?: boolean) => MiniElement };

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
        this.classList = new MiniClassList(this);
    }

    get className(): string { return this._className; }
    set className(v: string) {
        this._className = v;
        this.classList.syncFromClassName(v);
    }

    get innerHTML(): string { return this._innerHTML; }
    set innerHTML(v: string) {
        this._innerHTML = v;
        this.textContent = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    setAttribute(k: string, v: string) {
        this.attrs.set(k, String(v));
        if (k === 'id') { this.id = String(v); }
        if (k === 'class') { this.className = String(v); }
        if (k.startsWith('data-')) {
            const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[camel] = String(v);
        }
    }
    getAttribute(k: string): string | null {
        if (k === 'id' && this.id) { return this.id; }
        if (k === 'class' && this._className) { return this._className; }
        return this.attrs.has(k) ? this.attrs.get(k)! : null;
    }
    hasAttribute(k: string): boolean {
        return this.attrs.has(k) || (k === 'id' && !!this.id);
    }
    removeAttribute(k: string) {
        this.attrs.delete(k);
    }
    appendChild(child: MiniElement) {
        child.parentElement = this;
        this.children.push(child);
        if (child._innerHTML) {
            this._innerHTML += child._innerHTML;
        }
        if (child.textContent) {
            this.textContent = (this.textContent ? `${this.textContent} ` : '') + child.textContent;
        }
        return child;
    }
    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(c => c !== this);
            this.parentElement = null;
        }
    }
    contains(node: any): boolean {
        let cur: MiniElement | null = node;
        while (cur) {
            if (cur === this) { return true; }
            cur = cur.parentElement;
        }
        return false;
    }
    matches(selector: string): boolean {
        return selector.split(',').some((part) => this.matchesSingle(part.trim()));
    }
    private matchesSingle(sel: string): boolean {
        if (!sel) { return false; }
        let rem = sel;
        const tagMatch = rem.match(/^([a-zA-Z0-9_-]+)/);
        if (tagMatch) {
            if (this.tagName !== tagMatch[1].toUpperCase()) { return false; }
            rem = rem.slice(tagMatch[0].length);
        }
        const idMatches = [...rem.matchAll(/#([a-zA-Z0-9_-]+)/g)];
        for (const m of idMatches) {
            if (this.id !== m[1]) { return false; }
        }
        const clsMatches = [...rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
        for (const m of clsMatches) {
            if (!this.classList.contains(m[1])) { return false; }
        }
        const attrMatches = [...rem.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)];
        for (const m of attrMatches) {
            const attrName = m[1];
            const expectedVal = m[2];
            if (expectedVal !== undefined) {
                if (this.getAttribute(attrName) !== expectedVal) { return false; }
            } else {
                if (!this.hasAttribute(attrName)) { return false; }
            }
        }
        return true;
    }
    closest(selector: string): MiniElement | null {
        let cur: MiniElement | null = this;
        while (cur) {
            if (cur.matches(selector)) { return cur; }
            cur = cur.parentElement;
        }
        return null;
    }
    querySelectorAll(selector: string): MiniElement[] {
        const out: MiniElement[] = [];
        const walk = (node: MiniElement) => {
            for (const c of node.children) {
                if (c.matches(selector)) { out.push(c); }
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector: string): MiniElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }
    getBoundingClientRect() {
        return { ...this.rect };
    }
    addEventListener(type: string, fn: (e: any) => void) {
        const arr = this.listeners.get(type) ?? [];
        arr.push(fn);
        this.listeners.set(type, arr);
    }
    dispatch(type: string, ev: Record<string, any> = {}) {
        const fullEv = { target: this, preventDefault: () => {}, stopPropagation: () => {}, ...ev };
        for (const fn of this.listeners.get(type) ?? []) {
            fn.call(this, fullEv);
        }
    }
    focus() {}
    scrollIntoView() {}
}

function createPopoverTestHarness(opts?: { innerWidth?: number; innerHeight?: number; zoom?: number }) {
    const body = new MiniElement('body');
    if (opts?.zoom) {
        body.setAttribute('data-zoom', String(opts.zoom));
    }
    const docListeners = new Map<string, Array<(e: any) => void>>();
    const winListeners = new Map<string, Array<(e: any) => void>>();
    const timers = new Map<number, { fn: () => void; delay: number }>();
    let nextTimerId = 1;
    let savedState: Record<string, any> = {};
    const postedMessages: any[] = [];

    const doc: any = {
        body,
        activeElement: null as MiniElement | null,
        documentElement: {
            clientWidth: opts?.innerWidth ?? 320,
            clientHeight: opts?.innerHeight ?? 600,
            style: { setProperty: () => {} },
            setAttribute: () => {},
        },
        getElementById(id: string): MiniElement | null {
            if (body.id === id) { return body; }
            return body.querySelector(`#${id}`);
        },
        querySelector(sel: string): MiniElement | null {
            return body.querySelector(sel);
        },
        querySelectorAll(sel: string): MiniElement[] {
            return body.querySelectorAll(sel);
        },
        createElement(tag: string) {
            return new MiniElement(tag);
        },
        addEventListener(type: string, fn: (e: any) => void) {
            const arr = docListeners.get(type) ?? [];
            arr.push(fn);
            docListeners.set(type, arr);
        },
    };

    const win: any = {
        innerWidth: opts?.innerWidth ?? 320,
        innerHeight: opts?.innerHeight ?? 600,
        scrollY: 0,
        scrollTo: () => {},
        location: { href: 'http://127.0.0.1:49999/' },
        addEventListener(type: string, fn: (e: any) => void) {
            const arr = winListeners.get(type) ?? [];
            arr.push(fn);
            winListeners.set(type, arr);
        },
        removeEventListener: () => {},
        requestAnimationFrame: (fn: () => void) => { fn(); return 0; },
        setTimeout: (fn: () => void, delay = 0) => {
            const id = nextTimerId++;
            timers.set(id, { fn, delay });
            return id;
        },
        clearTimeout: (id: number) => { timers.delete(id); },
    };

    const runScript = () => {
        vm.runInNewContext(getScript(), {
            window: win,
            document: doc,
            Element: MiniElement,
            acquireVsCodeApi: () => ({
                getState: () => savedState,
                setState: (s: any) => { savedState = s; },
                postMessage: (m: any) => { postedMessages.push(m); },
            }),
            requestAnimationFrame: win.requestAnimationFrame,
            setTimeout: win.setTimeout,
            clearTimeout: win.clearTimeout,
            navigator: {},
            console,
        });
    };

    const dispatchBody = (type: string, ev: Record<string, any>) => {
        body.dispatch(type, ev);
    };
    const dispatchDoc = (type: string, ev: Record<string, any>) => {
        const fullEv = { preventDefault: () => {}, stopPropagation: () => {}, ...ev };
        for (const fn of docListeners.get(type) ?? []) {
            fn(fullEv);
        }
    };
    const dispatchWin = (type: string, ev: Record<string, any>) => {
        for (const fn of winListeners.get(type) ?? []) {
            fn(ev);
        }
    };
    const flushTimers = (maxDelay = Infinity) => {
        for (const [id, t] of [...timers.entries()]) {
            if (t.delay <= maxDelay) {
                timers.delete(id);
                t.fn();
            }
        }
    };

    return {
        body,
        doc,
        win,
        timers,
        postedMessages,
        runScript,
        dispatchBody,
        dispatchDoc,
        dispatchWin,
        flushTimers,
        getSavedState: () => savedState,
    };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeConfig(model: string, remainingFraction = 0.72): ModelConfig {
    return {
        model,
        label: getModelDisplayName(model),
        supportsImages: true,
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
        quotaInfo: { remainingFraction, resetTime: '2026-11-23T14:30:00Z' },
    };
}

function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        cascadeId: 'conv-ux-001',
        title: 'Rich Popover & Context Overhaul',
        model: 'MODEL_PLACEHOLDER_M535',
        modelDisplayName: 'Gemini 4 Neon (Extra High)',
        contextUsed: 180_000,
        totalOutputTokens: 3_600,
        totalToolCallOutputTokens: 16_000,
        contextLimit: 512_000,
        usagePercent: 35.2,
        stepCount: 18,
        lastModifiedTime: '2026-11-23T10:29:00Z',
        status: 'RUNNING',
        isEstimated: false,
        lastModelUsage: {
            model: 'MODEL_PLACEHOLDER_M535',
            inputTokens: 14_000,
            outputTokens: 800,
            responseOutputTokens: 500,
            cacheReadTokens: 166_000,
            cacheCreationTokens: 2_000,
        },
        estimatedDeltaSinceCheckpoint: 1_200,
        imageGenStepCount: 0,
        compressionDetected: true,
        previousContextUsed: 260_000,
        checkpointCompressionDrop: 80_000,
        hasGaps: false,
        checkpointModel: '',
        createdTime: '2026-11-23T09:00:00Z',
        lastUserInputTime: '2026-11-23T10:28:00Z',
        lastUserInputStepIndex: 16,
        repositoryName: 'antigravity',
        gitOriginUrl: '',
        branchName: 'main',
        gitRootUri: '',
        ...overrides,
    };
}

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        executionId: 'exec-ux-1',
        stepIndices: [1],
        model: 'MODEL_PLACEHOLDER_M535',
        modelDisplay: 'Gemini 4 Neon (Extra High)',
        responseModel: 'gemini-4-neon',
        modelAccuracy: 'exact',
        inputTokens: 18_000,
        outputTokens: 800,
        thinkingTokens: 300,
        responseTokens: 500,
        cacheReadTokens: 82_000,
        cacheCreationTokens: 0,
        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
        ttftSeconds: 0.72,
        streamingSeconds: 8.0,
        credits: 0,
        creditType: '',
        hasError: false,
        errorMessage: '',
        contextTokensUsed: 100_000,
        completionConfig: null,
        systemPromptSnippet: '',
        toolCount: 0,
        toolNames: [],
        promptSectionTitles: [],
        promptSnippet: '',
        promptSource: 'none',
        messagePromptCount: 0,
        messageMetadataKeys: [],
        responseHeaderKeys: [],
        userMessageAnchors: [{ stepIndex: 1, text: 'hello' }],
        aiSnippetsByStep: {},
        retries: 0,
        stopReason: 'STOP',
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        timeSinceLastInvocation: 0,
        tokenBreakdownGroups: [],
        createdAt: '2026-11-23T10:20:00Z',
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        toolCallsByStep: {},
        contextWindowCapacity: 512_000,
        ...overrides,
    };
}

function makeGMSummary(calls: GMCallEntry[]): GMSummary {
    return {
        conversations: [{
            cascadeId: 'conv-ux-001',
            title: 'Rich Popover & Context Overhaul',
            totalSteps: calls.length,
            calls,
            coveredSteps: calls.length,
            coverageRate: 1,
            checkpointSummaries: [],
        }],
        modelBreakdown: {},
        totalCalls: calls.length,
        totalStepsCovered: calls.length,
        totalCredits: 0,
        totalInputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
        totalOutputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
        totalCacheRead: calls.reduce((s, c) => s + c.cacheReadTokens, 0),
        totalCacheCreation: calls.reduce((s, c) => s + c.cacheCreationTokens, 0),
        totalThinkingTokens: calls.reduce((s, c) => s + c.thinkingTokens, 0),
        contextGrowth: [],
        fetchedAt: '2026-11-23T10:30:00Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
        retryErrorCodes: {},
        recentErrors: [],
        toolCallCounts: {},
    };
}

function makeUserInfo(): UserStatusInfo {
    return {
        name: 'Lin',
        email: 'lin@example.test',
        planName: 'Google AI Ultra',
        teamsTier: '',
        userTierName: 'Google AI Ultra',
        userTierId: 'ultra',
        defaultModelLabel: 'Gemini 4 Neon (Extra High)',
        planLimits: {
            maxNumChatInputTokens: 1_000_000,
            maxNumPremiumChatMessages: -1,
            maxCustomChatInstructionCharacters: 12_000,
            maxNumPinnedContextItems: 20,
            maxLocalIndexSize: 100_000,
            monthlyFlexCreditPurchaseAmount: 0,
        },
        teamConfig: {
            allowMcpServers: true,
            allowAutoRunCommands: true,
            allowBrowserExperimentalFeatures: false,
        },
        availableCredits: [{ creditType: 'GOOGLE_ONE_AI', creditAmount: '12500' }],
        canBuyMoreCredits: false,
        browserEnabled: true,
        cascadeWebSearchEnabled: true,
        knowledgeBaseEnabled: true,
        canGenerateCommitMessages: true,
        cascadeCanAutoRunCommands: true,
        canAllowCascadeInBackground: true,
        hasAutocompleteFastMode: true,
        allowStickyPremiumModels: true,
        allowPremiumCommandModels: true,
        hasTabToJump: true,
        canCustomizeAppIcon: true,
        userTierDescription: '',
        upgradeSubscriptionText: '',
        modelSortOrder: [],
    };
}

const SAMPLE_QUOTA_SUMMARY: UserQuotaSummary = {
    groups: [
        {
            pool: 'gemini',
            displayName: 'Gemini Models',
            fiveHour: {
                bucketId: 'gemini-5h',
                window: '5h',
                displayName: 'Five Hour Limit Remaining',
                remainingFraction: 0.62,
                resetTime: '2026-11-23T14:30:00Z',
                resetAt: Date.parse('2026-11-23T14:30:00Z'),
            },
            weekly: {
                bucketId: 'gemini-weekly',
                window: 'weekly',
                displayName: 'Weekly Limit Remaining',
                remainingFraction: 0.88,
                resetTime: '2026-11-29T14:30:00Z',
                resetAt: Date.parse('2026-11-29T14:30:00Z'),
            },
            buckets: [],
        },
    ],
};

const SAMPLE_RUNWAYS: Record<string, QuotaRunwayEstimate> = {
    gemini: {
        poolKey: 'gemini',
        status: 'safe_until_reset',
        burnRatePctPerHour: 8.4,
        estExhaustMs: 420 * 60_000,
        timeToResetMs: 240 * 60_000,
        recoveredRecently: false,
    },
};

beforeEach(async () => {
    await setLanguageToState('both', memState);
});

afterEach(async () => {
    await setLanguageToState(initialLang, memState);
});

// ─── 1. Unified Popover Engine (#acmRichTipPopover) Behavior & Math Tests ────

describe('Unified Body-Level Popover Engine (#acmRichTipPopover)', () => {
    it('mounts #acmRichTipPopover directly on document.body and neutralizes broken CSS [data-tooltip]::after rules', () => {
        const docHtml = buildMonitorDocumentHtml({
            surface: 'app-sidecar',
            data: makeUsage(),
            modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535')],
            now: NOW,
        });
        expect(docHtml).toContain('id="acmRichTipPopover"');
        // Mounted directly after </main> before <script> (direct child of body)
        expect(docHtml.indexOf('</main>')).toBeLessThan(docHtml.indexOf('id="acmRichTipPopover"'));
        expect(docHtml.indexOf('id="acmRichTipPopover"')).toBeLessThan(docHtml.indexOf('<script>'));

        const baseCss = getStyles();
        const editorialCss = getEditorialStyles();
        expect(baseCss).toMatch(/\[data-tooltip\]::after\s*\{[^}]*content:\s*none\s*!important[^}]*display:\s*none\s*!important/);
        expect(editorialCss).toMatch(/\[data-tooltip\]::after\s*\{[^}]*content:\s*none\s*!important[^}]*display:\s*none\s*!important/);
        expect(editorialCss).toContain('.acm-rich-tip');
        expect(editorialCss).toContain('z-index: 950');
        expect(editorialCss).toContain('max-width: min(300px, calc(100vw - 16px))');
        expect(editorialCss).toContain('max-height: min(340px, calc(100vh - 24px))');
        expect(editorialCss).toContain('.rich-tip-disabled-wrap');
        expect((baseCss.match(/\{/g) || []).length).toBe((baseCss.match(/\}/g) || []).length);
        expect((editorialCss.match(/\{/g) || []).length).toBe((editorialCss.match(/\}/g) || []).length);
    });

    it('handles hover preview, 180ms grace timer cancelled on popover entry, template cloning, disabled wrappers, legacy [data-tooltip], click-pin, keyboard, and Esc', () => {
        const h = createPopoverTestHarness({ innerWidth: 320, innerHeight: 600 });

        // 1. Standard two-layer trigger with native title that must be suppressed
        const trigger = new MiniElement('span');
        trigger.setAttribute('data-popover-key', 'test:metric');
        trigger.setAttribute('data-tip-title', 'Cache Hit');
        trigger.setAttribute('data-tip-body', 'Line 1 meaning\nLine 2 detail');
        trigger.setAttribute('data-tip-meta', 'Rule: cacheRead / totalPrompt');
        trigger.setAttribute('title', 'Legacy native title');
        trigger.rect = { left: 100, right: 160, top: 220, bottom: 244, width: 60, height: 24 };
        h.body.appendChild(trigger);

        // 2. Template-backed trigger (GM Timeline Legend pattern)
        const tpl = new MiniElement('template');
        tpl.id = 'gmLegendTpl';
        tpl.innerHTML = '<ul><li>Legend row 1</li><li>Legend row 2</li></ul>';
        h.body.appendChild(tpl);

        const legendBtn = new MiniElement('button');
        legendBtn.setAttribute('data-popover-key', 'gm:legend');
        legendBtn.setAttribute('data-tip-title', 'Timeline Legend');
        legendBtn.setAttribute('data-tip-html-id', 'gmLegendTpl');
        legendBtn.rect = { left: 260, right: 290, top: 250, bottom: 274, width: 30, height: 24 };
        h.body.appendChild(legendBtn);

        // 3. Disabled button wrapper (.rich-tip-disabled-wrap)
        const disWrap = new MiniElement('span');
        disWrap.className = 'rich-tip-disabled-wrap';
        disWrap.setAttribute('tabindex', '0');
        disWrap.setAttribute('data-popover-key', 'chats:disabled-open');
        disWrap.setAttribute('data-tip-title', 'Unavailable');
        disWrap.setAttribute('data-tip-body', 'No local archive file exists for this conversation.');
        const disBtn = new MiniElement('button');
        disBtn.disabled = true;
        disWrap.appendChild(disBtn);
        h.body.appendChild(disWrap);

        // 4. Legacy [data-tooltip] fallback
        const legacyEl = new MiniElement('span');
        legacyEl.setAttribute('data-tooltip', 'Legacy fallback text');
        h.body.appendChild(legacyEl);

        // 5. Banner with nested enabled action button (click on button must NOT pin banner!)
        const banner = new MiniElement('div');
        banner.setAttribute('data-popover-key', 'overview:low-quota-banner');
        banner.setAttribute('data-tip-body', 'Low quota banner tip');
        const settingsBtn = new MiniElement('button');
        settingsBtn.setAttribute('data-overview-target', 'settings');
        banner.appendChild(settingsBtn);
        h.body.appendChild(banner);

        h.runScript();
        const pop = h.doc.getElementById('acmRichTipPopover')!;
        expect(pop).not.toBeNull();
        expect(pop.hidden).toBe(true);

        // Hover preview + suppress native title
        h.dispatchBody('mouseover', { target: trigger });
        expect(pop.hidden).toBe(false);
        expect(pop.getAttribute('data-pinned')).toBe('false');
        expect(trigger.hasAttribute('title')).toBe(false);
        expect(h.doc.getElementById('acmRichTipTitle')!.textContent).toBe('Cache Hit');
        expect(h.doc.getElementById('acmRichTipBody')!.textContent).toBe('Line 1 meaning\nLine 2 detail');
        expect(h.doc.getElementById('acmRichTipMeta')!.textContent).toBe('Rule: cacheRead / totalPrompt');

        // Leaving trigger starts ~180ms grace timer; entering popover cancels it!
        h.dispatchBody('mouseout', { target: trigger, relatedTarget: h.body });
        expect(h.timers.size).toBeGreaterThan(0);
        h.dispatchBody('mouseover', { target: pop });
        h.flushTimers(200);
        expect(pop.hidden).toBe(false); // Stayed open for scrolling!

        // Leaving popover starts grace timer and hides after 180ms
        pop.dispatch('mouseleave', { target: pop, relatedTarget: h.body });
        h.flushTimers(200);
        expect(pop.hidden).toBe(true);

        // Template cloning & click-to-pin
        h.dispatchBody('click', { target: legendBtn });
        expect(pop.hidden).toBe(false);
        expect(pop.getAttribute('data-pinned')).toBe('true');
        expect(h.doc.getElementById('acmRichTipClose')!.hidden).toBe(false);
        expect(h.doc.getElementById('acmRichTipBody')!.innerHTML).toContain('Legend row 2');

        // Click inside popover keeps it open
        h.dispatchBody('click', { target: h.doc.getElementById('acmRichTipBody')! });
        expect(pop.hidden).toBe(false);

        // Esc dismisses pinned popover
        h.dispatchDoc('keydown', { key: 'Escape' });
        expect(pop.hidden).toBe(true);

        // Disabled wrapper shows rich tip on keyboard Enter & click
        h.doc.activeElement = disWrap;
        h.dispatchDoc('keydown', { key: 'Enter' });
        expect(pop.hidden).toBe(false);
        expect(pop.getAttribute('data-pinned')).toBe('true');
        expect(h.doc.getElementById('acmRichTipBody')!.textContent).toContain('No local archive file');

        // Close button dismisses
        h.dispatchBody('click', { target: h.doc.getElementById('acmRichTipClose')! });
        expect(pop.hidden).toBe(true);

        // Legacy [data-tooltip] gracefully renders in #acmRichTipPopover
        h.dispatchBody('mouseover', { target: legacyEl });
        expect(pop.hidden).toBe(false);
        expect(h.doc.getElementById('acmRichTipBody')!.textContent).toBe('Legacy fallback text');
        h.dispatchDoc('keydown', { key: 'Escape' });
        expect(pop.hidden).toBe(true);

        // Clicking nested enabled button inside tip banner does NOT pin banner
        h.dispatchBody('click', { target: settingsBtn });
        expect(pop.hidden).toBe(true);
    });

    it('accurately computes CSS zoom (80%–150%) coordinates, flips topbar triggers to bottom (never clips y<0), and clamps inside 320px AUX_PANE', () => {
        const h = createPopoverTestHarness({ innerWidth: 320, innerHeight: 500, zoom: 125 });

        // Topbar trigger right near y=0 (like #pauseBtn / #refreshBtn at right edge)
        const pauseBtn = new MiniElement('button');
        pauseBtn.id = 'pauseBtn';
        pauseBtn.setAttribute('data-popover-key', 'topbar:pause');
        pauseBtn.setAttribute('data-tip-title', 'Pause');
        pauseBtn.setAttribute('data-tip-body', 'Pause auto-refresh polling.');
        // Visual viewport rect at 125% zoom: top=6, bottom=34, left=282, right=312
        pauseBtn.rect = { left: 282, right: 312, top: 6, bottom: 34, width: 30, height: 28 };
        h.body.appendChild(pauseBtn);

        h.runScript();
        const pop = h.doc.getElementById('acmRichTipPopover')!;
        pop.offsetWidth = 220;
        pop.offsetHeight = 80;

        h.dispatchBody('mouseover', { target: pauseBtn });
        expect(pop.hidden).toBe(false);
        expect(pop.getAttribute('data-placement')).toBe('bottom');
        const topPx = parseInt(pop.style.top, 10);
        const leftPx = parseInt(pop.style.left, 10);
        // At 125% zoom, vpW = 320 / 1.25 = 256; tBottom = 34 / 1.25 = 27.2; top = Math.round(27.2 + 8) = 35 >= 8
        expect(topPx).toBeGreaterThanOrEqual(8);
        expect(topPx).toBe(35);
        // Clamped within zoomed 320px viewport: maxLeft = 256 - 220 - 8 = 28
        expect(leftPx).toBeGreaterThanOrEqual(8);
        expect(leftPx).toBeLessThanOrEqual(28);
    });

    it('re-anchors open popover without flicker on 5s applyIncrementalUpdate and updates both Settings & About update pills + CDP pill rich-tips', () => {
        const h = createPopoverTestHarness({ innerWidth: 640, innerHeight: 700 });

        const tabOverviewBtn = new MiniElement('button');
        tabOverviewBtn.className = 'tab-btn active';
        tabOverviewBtn.setAttribute('data-tab', 'overview');
        const tabModelsBtn = new MiniElement('button');
        tabModelsBtn.className = 'tab-btn';
        tabModelsBtn.setAttribute('data-tab', 'models');
        h.body.appendChild(tabOverviewBtn);
        h.body.appendChild(tabModelsBtn);

        const overviewPane = new MiniElement('div');
        overviewPane.id = 'tab-overview';
        overviewPane.className = 'tab-pane active';
        const speedCell = new MiniElement('div');
        speedCell.setAttribute('data-popover-key', 'overview:telemetry:speed');
        speedCell.setAttribute('data-tip-title', 'Generation Speed');
        speedCell.setAttribute('data-tip-body', 'Latest: 42.0 tok/s');
        overviewPane.appendChild(speedCell);
        h.body.appendChild(overviewPane);

        const modelsPane = new MiniElement('div');
        modelsPane.id = 'tab-models';
        modelsPane.className = 'tab-pane';
        h.body.appendChild(modelsPane);

        // Settings #updateStatusPill, About [data-about-update-status], and Settings #cdpStatusPill
        const settingsUpdatePill = new MiniElement('span');
        settingsUpdatePill.id = 'updateStatusPill';
        settingsUpdatePill.setAttribute('title', 'stale native title');
        const aboutUpdatePill = new MiniElement('span');
        aboutUpdatePill.setAttribute('data-about-update-status', 'idle');
        aboutUpdatePill.setAttribute('title', 'stale about native title');
        const cdpPill = new MiniElement('span');
        cdpPill.id = 'cdpStatusPill';
        cdpPill.setAttribute('title', 'stale cdp native title');
        h.body.appendChild(settingsUpdatePill);
        h.body.appendChild(aboutUpdatePill);
        h.body.appendChild(cdpPill);

        // Intercept innerHTML swap on overviewPane to simulate fresh DOM child replacement
        let swapPhase = 0;
        Object.defineProperty(overviewPane, 'innerHTML', {
            get() { return this._innerHTML; },
            set(val: string) {
                this._innerHTML = val;
                this.children = [];
                swapPhase++;
                if (val.includes('overview:telemetry:speed')) {
                    const nextCell = new MiniElement('div');
                    nextCell.setAttribute('data-popover-key', 'overview:telemetry:speed');
                    nextCell.setAttribute('data-tip-title', 'Generation Speed');
                    nextCell.setAttribute('data-tip-body', 'Latest: 88.5 tok/s');
                    this.appendChild(nextCell);
                }
            },
        });

        h.runScript();
        const pop = h.doc.getElementById('acmRichTipPopover')!;

        // Open pinned popover on speedCell
        h.dispatchBody('click', { target: speedCell });
        expect(pop.hidden).toBe(false);
        expect(h.doc.getElementById('acmRichTipBody')!.textContent).toBe('Latest: 42.0 tok/s');

        // Simulate 5s updateTabs replacing #tab-overview with updated live speed
        h.dispatchWin('message', {
            data: {
                command: 'updateTabs',
                tabs: { overview: '<div data-popover-key="overview:telemetry:speed">88.5</div>' },
            },
        });
        expect(swapPhase).toBe(1);
        expect(pop.hidden).toBe(false);
        expect(h.doc.getElementById('acmRichTipBody')!.textContent).toBe('Latest: 88.5 tok/s');

        // Simulate tab switch -> popover auto-dismisses
        h.dispatchBody('click', { target: tabModelsBtn });
        tabModelsBtn.dispatch('click', { target: tabModelsBtn });
        expect(pop.hidden).toBe(true);

        // Re-open on overview after switching back, then remove element on next poll -> popover dismisses
        tabOverviewBtn.dispatch('click', { target: tabOverviewBtn });
        const freshCell = overviewPane.querySelector('[data-popover-key="overview:telemetry:speed"]')!;
        h.dispatchBody('click', { target: freshCell });
        expect(pop.hidden).toBe(false);
        h.dispatchWin('message', {
            data: { command: 'updateTabs', tabs: { overview: '<div>empty</div>' } },
        });
        expect(pop.hidden).toBe(true);

        // Verify syncUpdateStatusUi updates BOTH #updateStatusPill AND [data-about-update-status] with rich-tip error (no title=)
        h.dispatchWin('message', {
            data: {
                command: 'updateCheckResult',
                status: 'error',
                error: 'GitHub API rate limit exceeded (403)',
            },
        });
        expect(settingsUpdatePill.hasAttribute('title')).toBe(false);
        expect(settingsUpdatePill.getAttribute('data-tip-body')).toContain('GitHub API rate limit exceeded (403)');
        expect(settingsUpdatePill.getAttribute('data-tip-meta')).toBeTruthy();
        expect(aboutUpdatePill.hasAttribute('title')).toBe(false);
        expect(aboutUpdatePill.getAttribute('data-about-update-status')).toBe('error');
        expect(aboutUpdatePill.getAttribute('data-tip-body')).toContain('GitHub API rate limit exceeded (403)');
        expect(aboutUpdatePill.getAttribute('data-tip-meta')).toBeTruthy();

        // Verify syncCdpStatusUi updates #cdpStatusPill with rich-tip (no title=)
        h.dispatchWin('message', {
            data: {
                command: 'cdpStatusResult',
                cdpStatus: { state: 'error', diagnosticCode: 'ws_error', errorMessage: 'ECONNREFUSED 127.0.0.1:9222' },
            },
        });
        expect(cdpPill.hasAttribute('title')).toBe(false);
        expect(cdpPill.getAttribute('data-popover-key')).toBe('settings:cdp-status');
        expect(cdpPill.getAttribute('data-tip-body')).toContain('ECONNREFUSED 127.0.0.1:9222');
        expect(cdpPill.getAttribute('data-tip-meta')).toBeTruthy();
    });
});

// ─── 2. Context Breakdown 4-Theme Palette, 10x10 Dot Matrix & Click-Lock Drawer ─

describe('Context Breakdown Overhaul: 4-Theme Palette, 10x10 Narrow Dot Matrix & Interactive Drawer', () => {
    it('defines all 9 distinct category hexes across Dark, Light, HC-Dark, and fixed HC-Light (+ forced-colors) and 10-col dot matrix at <=420px', () => {
        const css = getEditorialStyles();
        const expectedHexes = [
            // Dark
            '#7C93B0', '#F97352', '#22D3EE', '#F472B6', '#3B82F6', '#A855F7', '#F5B841', '#22C55E', '#A8A29E',
            // Light
            '#475569', '#C2410C', '#0E7490', '#BE185D', '#1D4ED8', '#7E22CE', '#A16207', '#15803D', '#78716C',
            // HC-Dark
            '#9FB8D8', '#FF8C69', '#38E8FF', '#FF85C8', '#60A5FA', '#C084FC', '#FFD15C', '#4ADE80', '#D6D3D1',
            // HC-Light (fixed!)
            '#334155', '#9A3412', '#155E75', '#9D174D', '#1E40AF', '#6B21A8', '#854D0E', '#166534', '#57534E',
        ];
        for (const hex of expectedHexes) {
            expect(css, `missing palette hex ${hex}`).toContain(hex);
        }
        expect(css).toContain('forced-colors: active');
        expect(css).toContain('data-highlight-cat="free"');
        expect(css).toContain('grid-template-columns: repeat(20, minmax(0, 1fr))');
        expect(css).toMatch(/@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\.ctx-dot-matrix\s*\{[^}]*grid-template-columns:\s*repeat\(10,\s*minmax\(0,\s*1fr\)\)/);
    });

    it('renders inline #ctxSelectedDrawer, per-category + free <template>s with Top 3 items & optimization tips, and rich tips on bar/dots/legend', async () => {
        await setLanguageToState('both', memState);
        const snap = parseContextBreakdown({
            model: 'MODEL_PLACEHOLDER_M535',
            effectiveBudgetTokens: 512_000,
            nativeLimitTokens: 1_048_576,
            generatorMetadata: [{
                stepIndices: [5],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M535',
                    promptSections: [
                        { title: 'System Core', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 20_000 },
                        { title: 'AGENTS.md', tokenType: 'TOKEN_TYPE_RULES', numTokens: 10_000 },
                        { title: 'Skill Alpha', tokenType: 'TOKEN_TYPE_SKILLS', numTokens: 8_000 },
                        { title: 'MCP Server', tokenType: 'TOKEN_TYPE_PLUGINS', numTokens: 12_000 },
                        { title: 'Swarm Worker', tokenType: 'TOKEN_TYPE_SUBAGENTS', numTokens: 5_000 },
                        { title: 'Test Output', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 45_000 },
                    ],
                    usage: { inputTokens: 20_000, cacheReadTokens: 80_000, outputTokens: 2_000 },
                },
            }],
        });

        const html = buildContextBreakdownCard(snap);
        expect(html).toContain('id="ctxSelectedDrawer"');
        // Placed between viz wrappers and legend
        expect(html.indexOf('ctx-viz-dots-wrap')).toBeLessThan(html.indexOf('id="ctxSelectedDrawer"'));
        expect(html.indexOf('id="ctxSelectedDrawer"')).toBeLessThan(html.indexOf('<ul class="ctx-legend"'));

        // Templates for every active category + free space
        for (const seg of snap.segments) {
            expect(html).toContain(`<template data-ctx-drawer-cat="${seg.key}">`);
            expect(html).toContain(`data-popover-key="overview:ctx-bar:${seg.key}"`);
            expect(html).toContain(`data-popover-key="overview:ctx-legend:${seg.key}"`);
        }
        expect(html).toContain('<template data-ctx-drawer-cat="free">');
        expect(html).toContain('data-popover-key="overview:ctx-bar:free"');
        expect(html).toContain('200k'); // Free space margin to 200k tier
        expect(html).toContain('子智能体');
        expect(html).not.toContain('子代理');
        expect(html).not.toContain('令牌');
        // Exact 100 .ctx-dot cells preserved
        expect(html.match(/class="ctx-dot(?:\s+is-free)?"/g)).toHaveLength(100);
        // Zero native title= on slices, dots, legend, largest items
        expect(html).not.toMatch(/class="ctx-(?:seg-slice|dot|legend-item|largest-title)[^"]*"[^>]*\s+title="/);
    });

    it('locks category on click, opens #ctxSelectedDrawer from template, preserves across 5s applyIncrementalUpdate, and unlocks on close / re-click / Esc', () => {
        const h = createPopoverTestHarness({ innerWidth: 320, innerHeight: 600 });

        const overviewPane = new MiniElement('div');
        overviewPane.id = 'tab-overview';
        overviewPane.className = 'tab-pane active';
        const buildCardDom = (tokensText: string) => {
            const card = new MiniElement('section');
            card.className = 'ctx-breakdown-card';
            const slice = new MiniElement('span');
            slice.className = 'ctx-seg-slice';
            slice.setAttribute('data-ctx-cat', 'rules_skills');
            slice.setAttribute('data-popover-key', 'overview:ctx-bar:rules_skills');
            slice.setAttribute('data-tip-body', `Rules ${tokensText}`);
            const freeDot = new MiniElement('span');
            freeDot.className = 'ctx-dot is-free';
            freeDot.setAttribute('data-ctx-cat', 'free');
            freeDot.setAttribute('data-popover-key', 'overview:ctx-dot:99:free');
            freeDot.setAttribute('data-tip-body', 'Free Space');
            const drawer = new MiniElement('div');
            drawer.id = 'ctxSelectedDrawer';
            drawer.className = 'ctx-selected-drawer';
            drawer.hidden = true;
            const legendBtn = new MiniElement('button');
            legendBtn.className = 'ctx-legend-item';
            legendBtn.setAttribute('data-ctx-cat', 'rules_skills');
            const tplRules = new MiniElement('template');
            tplRules.setAttribute('data-ctx-drawer-cat', 'rules_skills');
            tplRules.innerHTML = `<div class="ctx-drawer-head">Rules & Skills (${tokensText})</div><button data-action="closeCtxDrawer">×</button>`;
            const tplFree = new MiniElement('template');
            tplFree.setAttribute('data-ctx-drawer-cat', 'free');
            tplFree.innerHTML = '<div class="ctx-drawer-head">Free Space Drawer</div>';
            card.appendChild(slice);
            card.appendChild(freeDot);
            card.appendChild(drawer);
            card.appendChild(legendBtn);
            card.appendChild(tplRules);
            card.appendChild(tplFree);
            return { card, slice, freeDot, drawer, legendBtn };
        };

        const initial = buildCardDom('18k');
        overviewPane.appendChild(initial.card);
        h.body.appendChild(overviewPane);

        Object.defineProperty(overviewPane, 'innerHTML', {
            get() { return this._innerHTML; },
            set(val: string) {
                this._innerHTML = val;
                this.children = [];
                this.appendChild(buildCardDom('24k').card);
            },
        });

        h.runScript();

        // Click legend item -> locks rules_skills & expands inline drawer
        h.dispatchBody('click', { target: initial.legendBtn });
        expect(initial.card.getAttribute('data-locked-cat')).toBe('rules_skills');
        expect(initial.card.getAttribute('data-highlight-cat')).toBe('rules_skills');
        expect(initial.drawer.hidden).toBe(false);
        expect(initial.drawer.innerHTML).toContain('Rules & Skills (18k)');
        expect(initial.legendBtn.classList.contains('is-locked')).toBe(true);

        // 5s applyIncrementalUpdate preserves locked category & refreshes drawer content to 24k
        h.dispatchWin('message', { data: { command: 'updateTabs', tabs: { overview: 'refresh-1' } } });
        const newCard = overviewPane.querySelector('.ctx-breakdown-card')!;
        const newDrawer = overviewPane.querySelector('#ctxSelectedDrawer')!;
        expect(newCard.getAttribute('data-locked-cat')).toBe('rules_skills');
        expect(newCard.getAttribute('data-highlight-cat')).toBe('rules_skills');
        expect(newDrawer.hidden).toBe(false);
        expect(newDrawer.innerHTML).toContain('Rules & Skills (24k)');

        // Clicking free dot switches lock to free space
        const newFreeDot = overviewPane.querySelector('.ctx-dot.is-free')!;
        h.dispatchBody('click', { target: newFreeDot });
        expect(newCard.getAttribute('data-locked-cat')).toBe('free');
        expect(newDrawer.innerHTML).toContain('Free Space Drawer');

        // Esc unlocks and closes inline drawer
        h.dispatchDoc('keydown', { key: 'Escape' });
        expect(newCard.hasAttribute('data-locked-cat')).toBe(false);
        expect(newDrawer.hidden).toBe(true);
    });
});

// ─── 3. Overview, Topbar & Native Ambient HUD Alignment & De-noising ─────────

describe('Overview Tab, Topbar & Native Ambient HUD De-noising & Threshold Alignment', () => {
    it('aligns Native HUD context danger threshold to >= 80% and attaches rich tips to all 6 HUD chips & topbar controls', async () => {
        await setLanguageToState('both', memState);

        // 79% -> is-warn (NOT is-danger); 80% -> is-danger (aligned with Overview!)
        const hud79 = buildNativeHudHtml({
            usage: makeUsage({ contextUsed: 79_000, contextLimit: 100_000, usagePercent: 79 }),
            modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 0.65)],
            gmSummary: makeGMSummary([makeCall()]),
            sessionCostUsd: 0.42,
            now: NOW,
        });
        expect(hud79).toMatch(/class="native-hud-chip is-warn" data-hud-metric="context"/);

        const hud80 = buildNativeHudHtml({
            usage: makeUsage({ contextUsed: 80_000, contextLimit: 100_000, usagePercent: 80 }),
            modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 0.65)],
            gmSummary: makeGMSummary([makeCall()]),
            sessionCostUsd: 0.42,
            now: NOW,
        });
        expect(hud80).toMatch(/class="native-hud-chip is-danger" data-hud-metric="context"/);

        // All 6 HUD chips (including previously missing TTFT & Cache) carry unique data-popover-key & data-tip-body (zero title=)
        for (const metric of ['context', 'speed', 'ttft', 'cache', 'cost', 'quota']) {
            expect(hud80, `missing hud chip key ${metric}`).toContain(`data-popover-key="hud:chip:${metric}"`);
        }
        expect(hud80).not.toMatch(/class="native-hud-chip[^"]*"[^>]*\s+title="/);

        // Topbar controls: #pauseBtn, #refreshBtn, #staleBadge, #lockMainBtn all use rich tips (zero data-tooltip / title=)
        const fullDoc = buildMonitorDocumentHtml({
            surface: 'app-sidecar',
            data: makeUsage(),
            modelConfigs: [makeConfig('MODEL_PLACEHOLDER_M535', 0.62)],
            userInfo: makeUserInfo(),
            quotaSummary: SAMPLE_QUOTA_SUMMARY,
            quotaRunways: SAMPLE_RUNWAYS,
            gmSummary: makeGMSummary([makeCall()]),
            staleState: { isStale: true, lastSuccessAtMs: NOW - 5_000, lastError: 'ECONNRESET' },
            sessionCostUsd: 0.55,
            todayCostUsd: 1.8,
            now: NOW,
        });
        for (const key of ['topbar:pause', 'topbar:refresh', 'topbar:stale-badge', 'topbar:lock-main']) {
            expect(fullDoc, `missing topbar key ${key}`).toContain(`data-popover-key="${key}"`);
        }
        expect(fullDoc).not.toMatch(/id="(?:pauseBtn|refreshBtn|staleBadge|lockMainBtn)"[^>]*\s+(?:title|data-tooltip)="/);
        expect(buildMonitorMastheadControlsHtml({
            surface: 'app-sidecar',
            lockToMainAgent: true,
            staleState: { isStale: true, lastSuccessAtMs: NOW, lastError: 'Timeout' },
        })).toContain('data-popover-key="topbar:stale-badge"');
    });

    it.each(['en', 'zh', 'both'] as Language[])('renders structured Overview rich tips, unique data-popover-keys, unified ZH copy, and zero M537/M667/M681/M669 or 令牌 in %s', async (lang) => {
        await setLanguageToState(lang, memState);
        const cb = parseContextBreakdown({
            model: 'MODEL_PLACEHOLDER_M535',
            effectiveBudgetTokens: 256_000,
            nativeLimitTokens: 1_048_576,
            generatorMetadata: [{
                stepIndices: [5],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M535',
                    promptSections: [
                        { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 30_000 },
                        { title: 'Subagent', tokenType: 'TOKEN_TYPE_SUBAGENTS', numTokens: 10_000 },
                        { title: 'Tool Output', tokenType: 'TOKEN_TYPE_TOOL_RESULTS', numTokens: 175_000 },
                    ],
                    usage: { inputTokens: 15_000, cacheReadTokens: 200_000, outputTokens: 1_200 },
                },
            }],
        });
        const html = buildOverviewTabContent(
            makeUsage({ contextUsed: 215_000, contextLimit: 256_000 }),
            [makeConfig('MODEL_PLACEHOLDER_M535', 0.62)],
            makeUserInfo(),
            15,
            { state: 'active' },
            NOW,
            {
                gmSummary: makeGMSummary([makeCall()]),
                contextBreakdown: cb,
                quotaSummary: SAMPLE_QUOTA_SUMMARY,
                quotaRunways: SAMPLE_RUNWAYS,
                sessionCostUsd: 0.72,
                todayCostUsd: 1.95,
                staleState: { isStale: true, lastSuccessAtMs: NOW - 10_000, lastError: 'ETIMEDOUT' },
            },
        );

        // Globally unique data-popover-key values within Overview
        const keys = [...html.matchAll(/data-popover-key="([^"]+)"/g)].map(m => m[1]);
        expect(keys.length).toBeGreaterThan(20);
        expect(new Set(keys).size).toBe(keys.length);

        // Required structural attributes
        for (const cell of ['speed', 'ttft', 'cache-hit', 'cache-saved', 'cost']) {
            expect(html).toContain(`data-telemetry-cell="${cell}"`);
            expect(html).toContain(`data-popover-key="overview:telemetry:${cell}"`);
        }
        expect(html).toContain('data-pool-key="gemini"');
        expect(html).toContain('data-popover-key="overview:runway:gemini"');
        expect(html).toContain('data-popover-key="overview:quota-win:gemini:5h"');
        expect(html).toContain('data-popover-key="overview:quota-win:gemini:weekly"');
        expect(html).toContain('data-popover-key="overview:ai-credits"');
        expect(html).toContain('id="overview-glossary"');
        expect(html).toContain('data-state-key="overview-glossary"');

        // 45-minute rolling window explanation present on runway tip
        expect(html).toContain('45');
        // Thresholds & reassuring plain-language copy for 200k Tier & Warm/Partial/Cold Start (popover + collapsed glossary)
        expect(html).toContain('70%');
        const glossarySlice = html.slice(html.indexOf('id="overview-glossary"'));
        if (lang === 'en' || lang === 'both') {
            expect(html).toContain('does NOT charge extra money');
            expect(html).toContain('hard-truncate');
            expect(html).toContain('server-side Prompt Cache reuse');
            expect(html).toContain('&gt;5m idle');
            expect(glossarySlice).toContain('200k Long-Context Tier');
            expect(glossarySlice).toContain('does NOT charge extra money');
            expect(glossarySlice).toContain('Prompt Cache (Warm / Partial / Cold Start)');
        }
        if (lang === 'zh' || lang === 'both') {
            expect(html).toContain('不会额外扣费');
            expect(html).toContain('强制截断');
            expect(html).toContain('真实服务端提示词缓存复用');
            expect(html).toContain('5 分钟');
            expect(glossarySlice).toContain('200k 长上下文阶梯');
            expect(glossarySlice).toContain('不会额外扣费');
            expect(glossarySlice).toContain('提示词缓存（热缓存启动 / 部分命中 / 冷启动）');
        }

        // Unified ZH terminology & no forbidden terms or internal codes
        expect(html).not.toMatch(/M537|M667|M681|M669/);
        expect(html).not.toContain('令牌');
        expect(html).not.toContain('子代理');
        if (lang === 'zh') {
            expect(html).toContain('热缓存（已命中）');
            expect(html).toContain('正文速度');
            expect(html).toContain('子智能体');
            expect(html).toContain('自动压缩上限');
            expect(html).not.toContain('resp ');
        }
        // Verify CONTEXT_CATEGORY_ORDER & CONTEXT_FREE_SPACE_META stay intact
        expect(CONTEXT_CATEGORY_ORDER).toHaveLength(9);
        expect(CONTEXT_CATEGORY_META.subagents.labelZh).toBe('子智能体');
        expect(CONTEXT_FREE_SPACE_META.key).toBe('free');
    });
});

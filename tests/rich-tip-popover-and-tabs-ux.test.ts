// Consolidated Domain Suite: Rich-Tip Popovers, VM DOM & Data/Meta Tabs UX Contracts
import * as vm from 'vm';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { CONTEXT_CATEGORY_META, CONTEXT_CATEGORY_ORDER, CONTEXT_FREE_SPACE_META, parseContextBreakdown } from '../src/context-breakdown';
import {
    getLanguage,
    type Language,
    setLanguageInMemory,
    setLanguageToState,
    t,
    translations,
} from '../src/i18n-core';
import {
    getModelDisplayName,
    getModelSpecs,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
    type UserStatusInfo,
} from '../src/models';
import type { ContextUsage, TrajectorySummary } from '../src/tracker';
import type { GMCallEntry, GMModelStats, GMSummary } from '../src/gm-tracker';
import type { QuotaRunwayEstimate } from '../src/quota-runway';
import { buildMonitorDocumentHtml, buildMonitorMastheadControlsHtml, buildNativeHudHtml } from '../src/webview-document';
import { buildContextBreakdownCard, buildOverviewTabContent } from '../src/webview-overview-tab';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { getStyles } from '../src/webview-styles';
import { getScript } from '../src/webview-script';
import { type AccountSnapshot, buildAccountStatusPanel, buildGMDataTabContent, getGMDataTabStyles } from '../src/activity-panel';
import { ActivityTracker } from '../src/activity-tracker';
import type { StateBucket } from '../src/durable-state';
import { buildOrchestratorSplitCardHtml, computeOrchestratorSplit, getOrchestratorAttributionStyles, renderCallRoleBadgeHtml } from '../src/orchestrator-attribution';
import { buildActiveOrchestratorPricingCard, buildPricingTabContent, getPricingTabStyles } from '../src/pricing-panel';
import { PricingStore } from '../src/pricing-store';
import { buildChatHistoryTabContent } from '../src/webview-chat-history-tab';
import type { LedgerAccountBucket, LedgerSettledEntry } from '../src/daily-ledger';
import { DailyStore, type DailyStoreState, type MonthCostBreakdown } from '../src/daily-store';
import * as i18n from '../src/i18n';
import { buildModelInfoGrid, buildModelsTabContent, buildOrchestratorSettingsCard } from '../src/webview-models-tab';
import { buildDefaultModelCard, buildModelQuotaGrid, buildProfileContent } from '../src/webview-profile-tab';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { poolSizeSuffix, selectQuotaRows } from '../src/tooltip-budget';
import type { CdpStatus } from '../src/app/sidecar-types';
import { assertBalancedCssBraces as sharedAssertBalancedCssBraces, assertFrozenRichTipContract as sharedAssertFrozenRichTipContract } from './helpers/rich-tip-contract';

describe('[rich-tip-popover-and-ctx]', () => {
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
            const upgrade = new MiniElement('button');
            upgrade.id = 'settingsUpgradeNowBtn';
            upgrade.hidden = true;
            const checkedAt = new MiniElement('time');
            checkedAt.id = 'settingsUpdateCheckedAt';
            h.body.appendChild(upgrade);
            h.body.appendChild(checkedAt);
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

            // A manual check must reveal the App upgrade action without a page reload.
            const checkedMs = Date.UTC(2026, 10, 28, 8, 15);
            h.dispatchWin('message', { data: {
                command: 'updateCheckResult', status: 'update_available', latestVersion: '2.0.0', checkedAt: checkedMs,
            } });
            expect(upgrade.hidden).toBe(false);
            expect(checkedAt.getAttribute('datetime')).toBe(new Date(checkedMs).toISOString());

            // Verify syncUpdateStatusUi updates BOTH #updateStatusPill AND [data-about-update-status] with rich-tip error (no title=)
            h.dispatchWin('message', {
                data: {
                    command: 'updateCheckResult',
                    status: 'error',
                    error: 'GitHub API rate limit exceeded (403)',
                },
            });
            expect(upgrade.hidden).toBe(true);
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
                expect(html).toContain('热缓存（命中）');
                expect(html).toContain('缓存首字');
                expect(html).not.toContain('cached ');
                expect(html).toContain('正文速度');
                expect(html).toContain('子智能体');
                expect(html).toContain('自动压缩上限');
                expect(html).not.toContain('resp ');
            }
            // Bilingual 320px dual-cap watermark pill wraps cleanly without mid-word crushing
            const editorialCss = getEditorialStyles();
            const watermarkPillRule = editorialCss.match(/body \.overview-watermark-pill\s*\{([^}]*)\}/)?.[1] ?? '';
            expect(watermarkPillRule).toContain('flex-wrap: wrap');
            expect(watermarkPillRule).toContain('max-width: 100%');
            expect(watermarkPillRule).toContain('border-radius: 10px');
            expect(watermarkPillRule).toContain('line-height: 1.4');
            // Verify CONTEXT_CATEGORY_ORDER & CONTEXT_FREE_SPACE_META stay intact
            expect(CONTEXT_CATEGORY_ORDER).toHaveLength(9);
            expect(CONTEXT_CATEGORY_META.subagents.labelZh).toBe('子智能体');
            expect(CONTEXT_FREE_SPACE_META.key).toBe('free');
        });
    });
});

describe('[tabs-data-ux-tooltips]', () => {
    const langState: StateBucket = {
        get: <T>(_key: string, fallback: T) => fallback,
        update: async () => {},
    };


    afterEach(async () => {
        vi.useRealTimers();
        await setLanguageToState('both', langState);
    });


    // ─── Shared Frozen HTML Contract Assertions ──────────────────────────────────

    function extractAttributeValues(html: string, attrName: string): string[] {
        const regex = new RegExp(`${attrName}="([^"]*)"`, 'g');
        const values: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = regex.exec(html)) !== null) {
            values.push(match[1]);
        }
        return values;
    }


    function assertFrozenRichTipContract(html: string, contextLabel: string): void {
        // 1. Zero legacy CSS data-tooltip attributes
        expect(html, `${contextLabel}: must not emit legacy data-tooltip`).not.toMatch(/\bdata-tooltip="/);

        // 2. Zero native title="..." attributes on elements (no duplicate IDE tooltip)
        expect(html, `${contextLabel}: must not emit native title="..."`).not.toMatch(/(?<![a-z-])title="/);

        // 3. Every data-popover-key must be non-empty and globally unique
        const keys = extractAttributeValues(html, 'data-popover-key');
        expect(keys.length, `${contextLabel}: expected at least one data-popover-key`).toBeGreaterThan(0);
        const seen = new Map<string, number>();
        const duplicates: string[] = [];
        for (const key of keys) {
            expect(key.trim().length, `${contextLabel}: empty data-popover-key`).toBeGreaterThan(0);
            const count = (seen.get(key) || 0) + 1;
            seen.set(key, count);
            if (count === 2) {
                duplicates.push(key);
            }
        }
        expect(duplicates, `${contextLabel}: duplicate data-popover-key values`).toEqual([]);

        // 4. Every data-tip-html-id must match an existing <template id="...">
        const htmlIds = extractAttributeValues(html, 'data-tip-html-id');
        for (const id of htmlIds) {
            expect(html, `${contextLabel}: missing <template id="${id}">`).toContain(`<template id="${id}">`);
        }

        // 5. Zero banned terminology
        expect(html, `${contextLabel}: banned term 令牌`).not.toContain('令牌');
        expect(html, `${contextLabel}: banned term 编排器模型`).not.toContain('编排器模型');
        expect(html, `${contextLabel}: banned term 执行器模型`).not.toContain('执行器模型');

        // 6. Inline-flex tags never glue bilingual spans directly next to bare numbers
        expect(
            html,
            `${contextLabel}: glued bilingual span inside inline-flex chip`,
        ).not.toMatch(/class="(?:act-tl-gm-tag|seg-chip|telemetry-pill|telemetry-warmth-badge)[^"]*">[^<]*<span class="bi-en">/);
    }


    function assertBalancedCssBraces(css: string, label: string): void {
        const opens = (css.match(/\{/g) || []).length;
        const closes = (css.match(/\}/g) || []).length;
        expect(opens, `${label}: balanced CSS braces`).toBe(closes);
        expect(opens, `${label}: non-empty CSS`).toBeGreaterThan(10);
    }


    // ─── Fixtures ────────────────────────────────────────────────────────────────

    function makeGMCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        const todayIso = new Date().toISOString();
        return {
            executionId: 'exec-1',
            stepIndices: [2],
            model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
            modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
            responseModel: 'claude-sonnet-4-6',
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            accountEmail: 'alice@example.com',
            inputTokens: 4000,
            outputTokens: 600,
            thinkingTokens: 200,
            responseTokens: 400,
            cacheReadTokens: 16000,
            cacheCreationTokens: 1000,
            toolOutputTokens: 0,
            credits: 1,
            ttftSeconds: 0.72,
            streamingSeconds: 5.0,
            stopReason: 'STOP_REASON_STOP_PATTERN',
            completionConfig: {
                maxTokens: 65536,
                temperature: 1,
                firstTemperature: 0.4,
                topK: 40,
                topP: 0.95,
                stopPatternCount: 1,
                numCompletions: 1,
            },
            hasSystemPrompt: true,
            toolCount: 19,
            promptSectionTitles: ['System Preamble', 'Tool Definitions'],
            systemPromptSnippet: 'You are an expert assistant.',
            createdAt: todayIso,
            contextTokensUsed: 24500,
            maxContextTokens: 200000,
            tokenBreakdown: [
                { name: 'System Prompt', tokens: 6000 },
                { name: 'Conversation', tokens: 18500 },
            ],
            retries: 0,
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            errorMessage: '',
            ephemeralCount: 3,
            ...overrides,
        };
    }


    const ALL_19_TOOLS = [
        'run_command', 'command_status', 'send_command_input', 'read_terminal',
        'view_file', 'view_file_outline', 'view_code_item', 'write_to_file',
        'replace_file_content', 'multi_replace_file_content', 'grep_search',
        'find_by_name', 'list_dir', 'browser_subagent', 'read_url_content',
        'search_web', 'notify_user', 'task_boundary', 'generate_image',
    ];


    function makeRichGMData(): {
        activity: ReturnType<ActivityTracker['getSummary']>;
        gm: GMSummary;
        accounts: AccountSnapshot[];
        todayLedger: LedgerAccountBucket[];
        settledLedger: LedgerSettledEntry[];
    } {
        const nowBase = Date.now() - 120_000;
        const atOffset = (sec: number) => new Date(nowBase + sec * 1000).toISOString();
        const calls: GMCallEntry[] = [
            // 1. Cold start call
            makeGMCall({
                executionId: 'exec-cold',
                stepIndices: [2],
                inputTokens: 18000,
                outputTokens: 500,
                thinkingTokens: 150,
                responseTokens: 350,
                cacheReadTokens: 0,
                cacheCreationTokens: 2000,
                ttftSeconds: 1.9,
                streamingSeconds: 4.5,
                createdAt: atOffset(2),
                contextTokensUsed: 20000,
            }),
            // 2. Compaction drop + Mapped Base model (Gemini 4 Carbon orchestrator placeholder)
            makeGMCall({
                executionId: 'exec-mapped-compact',
                stepIndices: [3],
                model: 'MODEL_PLACEHOLDER_M667',
                modelDisplay: 'Gemini 4 Carbon (Orchestrator)',
                responseModel: 'MODEL_PLACEHOLDER_M667',
                inputTokens: 2000,
                outputTokens: 400,
                thinkingTokens: 100,
                responseTokens: 300,
                cacheReadTokens: 3000,
                cacheCreationTokens: 0,
                ttftSeconds: 0.85,
                streamingSeconds: 4.0,
                createdAt: atOffset(20),
                contextTokensUsed: 5000,
            }),
            // 3. Short-sample + retry call (<16 tokens & <0.3s)
            makeGMCall({
                executionId: 'exec-short-retry',
                stepIndices: [4],
                inputTokens: 4000,
                outputTokens: 5,
                thinkingTokens: 0,
                responseTokens: 5,
                cacheReadTokens: 6000,
                cacheCreationTokens: 0,
                ttftSeconds: 0.5,
                streamingSeconds: 0.1,
                retries: 1,
                retryTokensIn: 500,
                retryTokensOut: 0,
                retryCredits: 0,
                retryErrors: ['503'],
                createdAt: atOffset(35),
                contextTokensUsed: 10500,
            }),
            // 4. HTTP 429 error call (unpriced custom model)
            makeGMCall({
                executionId: 'exec-err-429',
                stepIndices: [5],
                model: 'MODEL_CUSTOM_UNKNOWN_X',
                modelDisplay: 'Unknown Experimental X',
                responseModel: 'unknown-experimental-x',
                inputTokens: 1200,
                outputTokens: 0,
                thinkingTokens: 0,
                responseTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                ttftSeconds: 0,
                streamingSeconds: 0,
                hasError: true,
                errorMessage: 'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded',
                createdAt: atOffset(45),
                contextTokensUsed: 11000,
            }),
            // 5. HTTP 504 timeout error call
            makeGMCall({
                executionId: 'exec-err-504',
                stepIndices: [6],
                model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
                responseModel: 'claude-sonnet-4-6',
                inputTokens: 1200,
                outputTokens: 0,
                thinkingTokens: 0,
                responseTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                ttftSeconds: 0,
                streamingSeconds: 0,
                hasError: true,
                errorMessage: 'HTTP 504 GATEWAY_TIMEOUT: deadline exceeded',
                createdAt: atOffset(55),
                contextTokensUsed: 11000,
            }),
            // 6. Latest warm cached call (keeps latest warmth badge = Warm + gives faster cached TTFT delta)
            makeGMCall({
                executionId: 'exec-warm',
                stepIndices: [7],
                inputTokens: 2500,
                outputTokens: 700,
                thinkingTokens: 250,
                responseTokens: 450,
                cacheReadTokens: 28000,
                cacheCreationTokens: 0,
                ttftSeconds: 0.65,
                streamingSeconds: 5.5,
                createdAt: atOffset(75),
                contextTokensUsed: 30500,
            }),
        ];

        const sonnetStats: GMModelStats = {
            calls: 3,
            callCount: 3,
            stepsCovered: 3,
            totalInputTokens: 24500,
            totalOutputTokens: 1205,
            totalThinkingTokens: 400,
            totalCacheRead: 34000,
            totalCacheCreation: 2000,
            totalCredits: 3,
            avgTTFT: 1.02,
            minTTFT: 0.5,
            maxTTFT: 1.9,
            avgStreaming: 3.37,
            cacheHitRate: 0.56,
            responseModel: 'claude-sonnet-4-6',
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            completionConfig: calls[0].completionConfig,
            hasSystemPrompt: true,
            toolCount: 19,
            promptSectionTitles: ['System Preamble', 'Tool Definitions'],
            totalRetries: 1,
            errorCount: 0,
            creditCallCount: 3,
            exactCallCount: 3,
            placeholderOnlyCalls: 0,
            contextWindowCapacity: 200000,
        };

        const checkpointOnlyStats: GMModelStats = {
            ...sonnetStats,
            calls: 1,
            callCount: 1,
            stepsCovered: 1,
            totalInputTokens: 500,
            totalOutputTokens: 120,
            totalThinkingTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalCredits: 0,
            creditCallCount: 0,
            responseModel: 'gemini-3-flash',
            isCheckpointOnly: true,
        };

        const mappedOpusStats: GMModelStats = {
            ...sonnetStats,
            calls: 1,
            callCount: 1,
            stepsCovered: 1,
            totalInputTokens: 5000,
            totalOutputTokens: 400,
            totalThinkingTokens: 100,
            totalCacheRead: 5000,
            totalCacheCreation: 0,
            totalCredits: 2,
            responseModel: 'MODEL_PLACEHOLDER_M667',
            exactCallCount: 0,
            placeholderOnlyCalls: 1,
        };

        const gm: GMSummary = {
            conversations: [{
                cascadeId: 'conv-ux-1',
                title: 'UX Tooltip Audit Session',
                totalSteps: 6,
                coveredSteps: 5,
                coverageRate: 5 / 6,
                calls,
                checkpointSummaries: [{
                    checkpointNumber: 1,
                    stepIndex: 4,
                    tokens: 500,
                    fullText: 'USER Objective: audit tooltips across tabs.',
                }],
                systemContextItems: [
                    {
                        type: 'checkpoint',
                        checkpointNumber: 1,
                        stepIndex: 4,
                        tokens: 500,
                        label: 'Checkpoint #1',
                        fullText: 'USER Objective: audit tooltips across tabs.',
                    },
                    {
                        type: 'system_preamble',
                        stepIndex: 0,
                        tokens: 1800,
                        label: 'System Preamble',
                        fullText: 'You are an expert assistant.',
                    },
                    {
                        type: 'ephemeral',
                        stepIndex: 3,
                        tokens: 320,
                        label: 'Ephemeral',
                        fullText: 'Open editor: src/activity-panel.ts',
                    },
                ],
            }],
            modelBreakdown: {
                'Claude Sonnet 4.6 (Thinking)': sonnetStats,
                'Claude Opus 5.5 (Orchestrator)': mappedOpusStats,
                'Gemini 3 Flash (Checkpoint)': checkpointOnlyStats,
            },
            totalCalls: 5,
            totalStepsCovered: 5,
            totalCredits: 5,
            totalInputTokens: 30700,
            totalOutputTokens: 1605,
            totalThinkingTokens: 500,
            totalCacheRead: 39000,
            totalCacheCreation: 2000,
            contextGrowth: [
                { stepIndex: 2, tokens: 20000, maxTokens: 200000, timestamp: '2026-11-26T10:00:02.000Z' },
                { stepIndex: 3, tokens: 30500, maxTokens: 200000, timestamp: '2026-11-26T10:00:20.000Z' },
                { stepIndex: 4, tokens: 10000, maxTokens: 200000, timestamp: '2026-11-26T10:00:40.000Z' },
            ],
            fetchedAt: '2026-11-26T10:01:10.000Z',
            totalRetryTokens: 500,
            totalRetryCredits: 0,
            totalRetryCount: 1,
            latestTokenBreakdown: [
                { name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM', tokens: 6000, children: [] },
                { name: 'Conversation', type: 'TOKEN_TYPE_CONVERSATION', tokens: 18500, children: [] },
            ],
            stopReasonCounts: { STOP_REASON_STOP_PATTERN: 4 },
            retryErrorCodes: { '503': 1, '429': 1 },
            recentErrors: [
                'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded',
            ],
            recentErrorEntries: [
                {
                    code: '429',
                    message: 'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded',
                    createdAt: '2026-11-26T10:01:05.000Z',
                },
            ],
            toolCallCounts: { view_file: 4, run_command: 2 },
            toolCatalog: ALL_19_TOOLS.map((name, idx) => ({
                name,
                firstSeen: `2026-11-26T10:00:${String(idx).padStart(2, '0')}.000Z`,
            })),
            accountBreakdown: {
                'alice@example.com': { calls: 4, errorCount: 1, credits: 5, inputTokens: 30000, outputTokens: 1605 },
            },
            modelAccountBreakdown: {
                'Claude Sonnet 4.6 (Thinking)': {
                    'alice@example.com': { calls: 3, errorCount: 1 },
                },
            },
        };

        const activity = new ActivityTracker().getSummary();
        activity.totalReasoning = 4;
        activity.totalToolCalls = 2;
        activity.totalCheckpoints = 1;
        activity.totalUserInputs = 1;
        activity.totalInputTokens = 30700;
        activity.totalOutputTokens = 1605;
        activity.totalToolOutputTokens = 320;
        activity.modelStats['Gemini 3 Flash (Checkpoint)'] = {
            totalSteps: 1,
            reasoning: 0,
            toolCalls: 0,
            checkpoints: 1,
            estSteps: 0,
            inputTokens: 500,
            outputTokens: 120,
            toolOutputTokens: 0,
            totalDurationMs: 0,
            avgDurationMs: 0,
        } as any;
        activity.recentSteps = [
            {
                // Step before any user anchor -> triggers "AI actions (no user anchor)"
                timestamp: '2026-11-26T09:59:55.000Z',
                icon: '🧠',
                category: 'reasoning',
                model: 'Claude Sonnet 4.6 (Thinking)',
                detail: 'Bootstrap analysis',
                durationMs: 900,
                stepIndex: 0,
                cascadeId: 'conv-ux-1',
                gmModel: 'claude-sonnet-4-6',
                gmInputTokens: 1200,
                gmOutputTokens: 120,
                gmTTFT: 0.45,
                gmStreamingDuration: 0.45,
            },
            {
                timestamp: '2026-11-26T10:00:00.000Z',
                icon: '💬',
                category: 'user',
                model: '',
                detail: 'Audit tooltips',
                durationMs: 0,
                stepIndex: 1,
                cascadeId: 'conv-ux-1',
            },
            {
                timestamp: '2026-11-26T10:00:02.000Z',
                icon: '🧠',
                category: 'reasoning',
                model: 'Claude Sonnet 4.6 (Thinking)',
                detail: 'Cold reasoning pass',
                durationMs: 6400,
                stepIndex: 2,
                cascadeId: 'conv-ux-1',
                gmModel: 'claude-sonnet-4-6',
                gmInputTokens: 18000,
                gmOutputTokens: 500,
                gmThinkingTokens: 150,
                gmCacheReadTokens: 0,
                gmCacheCreationTokens: 2000,
                gmTTFT: 1.9,
                gmStreamingDuration: 4.5,
                gmContextTokensUsed: 20000,
            },
            {
                timestamp: '2026-11-26T10:00:20.000Z',
                icon: '🧠',
                category: 'reasoning',
                model: 'Claude Sonnet 4.6 (Thinking)',
                detail: 'Warm reasoning pass',
                durationMs: 6150,
                stepIndex: 3,
                cascadeId: 'conv-ux-1',
                gmModel: 'claude-sonnet-4-6',
                gmInputTokens: 2500,
                gmOutputTokens: 700,
                gmThinkingTokens: 250,
                gmCacheReadTokens: 28000,
                gmTTFT: 0.65,
                gmStreamingDuration: 5.5,
                gmContextTokensUsed: 30500,
            },
        ];

        const futureIso = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
        const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
        const accounts: AccountSnapshot[] = [
            {
                email: 'alice@example.com',
                name: 'Alice',
                planName: 'Pro',
                tierName: 'Pro',
                earliestResetTime: futureIso,
                allResetTimes: [futureIso, pastIso],
                resetPools: [
                    {
                        resetTime: futureIso,
                        modelLabels: ['Claude Opus 5.5', 'Claude Sonnet 4.6 (Thinking)', 'Gemini 3.1 Pro', 'Gemini 4 Neon', 'GPT-OSS 120B'],
                        modelIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
                        hasUsage: true,
                        remainingPercent: 72,
                    },
                    {
                        resetTime: futureIso,
                        modelLabels: ['Gemini 3 Flash'],
                        modelIds: ['m6'],
                        hasUsage: false,
                        remainingPercent: 100,
                    },
                    {
                        resetTime: pastIso,
                        modelLabels: ['Gemini 4 Hydrogen'],
                        modelIds: ['m7'],
                        hasUsage: true,
                        remainingPercent: 100,
                    },
                ],
                isActive: true,
                lastSeen: '2026-11-26T10:01:00.000Z',
            },
            {
                email: 'bob@example.com',
                name: 'Bob',
                planName: 'Free',
                tierName: 'Free',
                earliestResetTime: futureIso,
                allResetTimes: [futureIso],
                resetPools: [
                    {
                        resetTime: futureIso,
                        modelLabels: ['Claude Sonnet 4.6'],
                        modelIds: ['m2'],
                        hasUsage: false,
                        remainingPercent: 100,
                    },
                ],
                isActive: false,
                lastSeen: '2026-11-25T08:00:00.000Z',
            },
        ];

        const todayLedger: LedgerAccountBucket[] = [{
            accountEmail: 'alice@example.com',
            totalCalls: 5,
            totalCredits: 5,
            totalInputTokens: 30700,
            totalOutputTokens: 1605,
            totalCacheRead: 39000,
            totalCacheCreation: 2000,
            totalThinkingTokens: 500,
            totalEstimatedCost: 0.14,
            recordedCallIds: ['exec-cold', 'exec-warm', 'exec-mapped-compact'],
            recordedCalls: [],
            modelStats: {
                'Claude Sonnet 4.6 (Thinking)': {
                    calls: 3,
                    inputTokens: 24500,
                    outputTokens: 1205,
                    cacheReadTokens: 34000,
                    cacheCreationTokens: 2000,
                    thinkingTokens: 400,
                    credits: 3,
                    estimatedCost: 0.11,
                },
                'Claude Opus 5.5 (Orchestrator)': {
                    calls: 1,
                    inputTokens: 5000,
                    outputTokens: 400,
                    cacheReadTokens: 5000,
                    cacheCreationTokens: 0,
                    thinkingTokens: 100,
                    credits: 2,
                    estimatedCost: 0.03,
                },
                'Unknown Experimental X': {
                    calls: 1,
                    inputTokens: 1200,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    thinkingTokens: 0,
                    credits: 0,
                    estimatedCost: 0,
                },
            },
        }];

        const settledLedger: LedgerSettledEntry[] = [{
            settledAt: '2026-11-26T06:00:00.000Z',
            accountEmail: 'alice@example.com',
            poolModelIds: ['claude-sonnet-4-6'],
            poolModelLabels: ['Claude Sonnet 4.6 (Thinking)'],
            totalCalls: 12,
            totalCredits: 10,
            totalInputTokens: 90000,
            totalOutputTokens: 6000,
            totalCacheRead: 120000,
            totalCacheCreation: 5000,
            totalThinkingTokens: 1500,
            totalEstimatedCost: 0.42,
            modelCalls: { 'Claude Sonnet 4.6 (Thinking)': 12 },
        }];

        return { activity, gm, accounts, todayLedger, settledLedger };
    }


    // ─── 1. GM Data + Account Status Popover ─────────────────────────────────────

    describe('GM Data tab & Account Status rich tooltips (tabs-data)', () => {
        it.each(['en', 'zh', 'both'] as Language[])('satisfies frozen contract and rich-tip requirements in %s mode', async language => {
            await setLanguageToState(language, langState);
            const { activity, gm, accounts, todayLedger, settledLedger } = makeRichGMData();
            const html = buildGMDataTabContent(
                activity,
                gm,
                { cascadeId: 'conv-ux-1' } as any,
                accounts,
                todayLedger,
                settledLedger,
                {},
            );

            assertFrozenRichTipContract(html, `GM Data (${language})`);

            // 1. Focusable Timeline '?' button + <template id="gmTimelineLegendTpl"> (no hover-only popup)
            expect(html).toContain('<button type="button" class="act-tl-help-btn rich-tip-trigger" data-popover-key="gm-timeline-legend"');
            expect(html).toContain('data-tip-html-id="gmTimelineLegendTpl"');
            expect(html).toContain('<template id="gmTimelineLegendTpl">');
            expect(html).not.toContain('act-tl-help-popup');

            // 2. Localized TTFT in timeline rows, turn chips, and legend template
            if (language === 'zh') {
                expect(html).toContain('首字延迟 1.90s');
                expect(html).toContain('首字延迟 650ms');
                expect(html).toContain('首字延迟 1.2');
                expect(html).toContain('首字延迟 1.20s');
                expect(html).toContain('平均首字');
                expect(html).not.toContain('平均 TTFT');
                expect(html).not.toMatch(/class="act-tl-gm-tag act-tl-gm-ttft"[^>]*>[^<]*TTFT/);
            } else if (language === 'en') {
                expect(html).toContain('TTFT 1.90s');
                expect(html).toContain('TTFT 650ms');
            } else {
                expect(html).toContain('首字延迟');
                expect(html).toContain('TTFT');
            }

            // 3. Cache warmth unified ZH label ("热缓存（命中）", NOT bare "已命中")
            if (language === 'zh') {
                expect(html).toContain('热缓存（命中）');
                expect(html).not.toMatch(/class="telemetry-warmth-badge is-warm"[^>]*>(?:<span[^>]*>)?已命中/);
            }

            // 4. Turn start pills carry reassuring server-side Prompt Cache explanation + thresholds
            expect(html).toContain('data-turn-start="warm"');
            expect(html).toContain('data-turn-start="cold"');
            expect(html).toContain(language === 'zh' ? '提示词缓存' : 'Prompt Cache');
            expect(html).toContain('≥70%');

            // 5. Telemetry delta pill, mapped-base cost, short-sample, HTTP 429 error, compaction drop
            expect(html).toContain('class="telemetry-delta-pill is-faster"');
            expect(html).toContain('data-popover-key="gm-tel-ttft-delta"');
            expect(html).toContain('class="rc-cost-val" data-popover-key="');
            expect(html).toContain('-cost-mapped"');
            expect(html).toContain('data-pricing-provenance="mapped_base"');
            expect(html).toContain(language === 'zh' ? '底座' : 'base');
            expect(html).toContain('Gemini 4 Carbon');
            expect(html).toContain('class="rc-short-sample"');
            expect(html).toContain('&lt;16');
            expect(html).toContain('class="rc-status is-err"');
            expect(html).toContain('HTTP 429 RESOURCE_EXHAUSTED');
            expect(html).toContain(language === 'zh' ? '限流' : 'rate limit');
            expect(html).toContain('rc-delta-compaction');

            // 6. Model cards: #modelStatsErrToggle, floppy-disk isCheckpointOnly badge, orphan AI actions
            expect(html).toContain('id="modelStatsErrToggle"');
            expect(html).toContain('data-popover-key="gm-model-stats-err-toggle"');
            expect(html).toContain('data-popover-key="gm-mcard-cp-only-');
            expect(html).toContain('data-popover-key="gm-tl-no-anchor-');

            // 7. Context Intelligence sub-terms (Checkpoint, System Preamble, Ephemeral, Model DNA, T=)
            expect(html).toContain('data-popover-key="gm-ci-badge-checkpoint"');
            expect(html).toContain('data-popover-key="gm-ci-badge-system_preamble"');
            expect(html).toContain('data-popover-key="gm-ci-badge-ephemeral"');
            expect(html).toContain('data-popover-key="gm-ci-badge-model-dna"');
            expect(html).toContain('data-popover-key="gm-ci-temp-chip-');

            // The live Model Calls view carries all six observed generation parameters.
            const configRows = [...html.matchAll(/<div class="ci-cfg-row">([\s\S]*?)<\/div>/g)]
                .map(([, body]) => body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
            for (const [en, zh, value] of [
                ['maxOutputTokens', '最大输出 tokens', '65.5k'], ['temperature', '温度', '1'],
                ['firstTemperature', '初始温度', '0.4'], ['topK', 'Top K', '40'],
                ['topP', 'Top P', '0.95'], ['stopPatterns', '停止词', '1'],
            ]) {
                expect(configRows.some(row => row.includes(language === 'zh' ? zh : en) && row.endsWith(' ' + value))).toBe(true);
            }
            for (const key of ['temp', 'topk', 'topp']) {
                expect(html).toContain(`data-popover-key="gm-ci-cfg-${key}-`);
            }

            // 8. All 19 tools in .tool-cat-chip have rich tips (EN in en mode, ZH in zh mode)
            for (const tool of ALL_19_TOOLS) {
                expect(html).toContain(`data-popover-key="gm-tool-cat-${tool}-`);
            }
            if (language === 'en') {
                expect(html).toContain('Execute a terminal command');
                expect(html).toContain('Run automated browser tasks via a subagent');
                expect(html).not.toContain('执行终端命令');
            } else if (language === 'zh') {
                expect(html).toContain('执行终端命令');
                expect(html).toContain('浏览器自动化');
            }

            // 9. Settled ledger + reset time + cycles rich tips
            expect(html).toContain('data-popover-key="gm-settled-title"');
            expect(html).toContain('data-popover-key="gm-settled-cycles"');
            expect(html).toContain('data-popover-key="gm-ledger-reset-0-0"');
        });

        it.each(['en', 'zh', 'both'] as Language[])('attaches rich tips to GM-only summary bar (summary === null) in %s mode', async language => {
            await setLanguageToState(language, langState);
            const { gm } = makeRichGMData();
            const html = buildGMDataTabContent(null, gm);

            assertFrozenRichTipContract(html, `GM-only Summary (${language})`);
            expect(html).toContain('data-popover-key="gm-stat-calls"');
            expect(html).toContain('data-popover-key="gm-stat-in"');
            expect(html).toContain('data-popover-key="gm-stat-out"');
            expect(html).toContain('data-popover-key="gm-stat-cache"');
            expect(html).toContain('data-popover-key="gm-stat-credits"');
        });

        it.each(['en', 'zh', 'both'] as Language[])('upgrades Account Status Popover with visible percent, hidden pool list, badges, and billing expiry tips in %s mode', async language => {
            await setLanguageToState(language, langState);
            const { accounts } = makeRichGMData();
            const todayDay = new Date().getDate();
            const otherDay = todayDay === 28 ? 10 : Math.min(28, todayDay + 5);
            const html = buildAccountStatusPanel(accounts, {
                'alice@example.com': otherDay,
                'bob@example.com': todayDay,
            });

            assertFrozenRichTipContract(html, `Account Status (${language})`);

            // Visible percentage next to .acct-quota-bar + rich tip on bar wrapper
            expect(html).toContain('class="acct-quota-wrap"');
            expect(html).toContain('class="acct-quota-pct">72%</span>');
            expect(html).toContain('data-popover-key="acct-pool-quota-alice-example-com-0-0"');

            // +N hidden pool models lists the hidden model names in rich tip
            expect(html).toContain('class="acct-pool-more"');
            expect(html).toContain('Gemini 4 Neon');
            expect(html).toContain('GPT-OSS 120B');

            // Active / Cached / Idle / Ready badges & Billing Day expiry rich tips
            expect(html).toContain('data-popover-key="acct-status-alice-example-com-0"');
            expect(html).toContain('data-popover-key="acct-status-bob-example-com-1"');
            expect(html).toContain('data-popover-key="acct-pool-state-alice-example-com-0-1"');
            expect(html).toContain('data-popover-key="acct-pool-state-alice-example-com-0-2"');
            expect(html).toContain('data-popover-key="acct-expiry-alice-example-com-0"');
            expect(html).toContain('data-popover-key="acct-expiry-bob-example-com-1"');
            expect(html).toContain(language === 'zh' ? '账单日' : 'billing day');
        });

        it('ships balanced GM Data CSS with removed legacy hover-only timeline popup & data-tooltip::after', () => {
            const css = getGMDataTabStyles();
            assertBalancedCssBraces(css, 'GM Data CSS');
            expect(css).toContain('.acct-quota-pct');
            expect(css).not.toContain('.act-tl-help-popup');
            expect(css).not.toContain('.act-stat[data-tooltip]');
            expect(css).not.toContain('.tool-cat-chip[data-tooltip]');
        });
    });


    // ─── 2. Orchestrator Attribution ─────────────────────────────────────────────

    describe('Orchestrator Attribution rich tooltips (tabs-data)', () => {
        it.each(['en', 'zh', 'both'] as Language[])('attaches rich tips to role badges and avoids duplicate keys across Overview (compact) and GM Data cards in %s mode', async language => {
            await setLanguageToState(language, langState);

            // Standalone role badges
            const badgesHtml = [
                renderCallRoleBadgeHtml('orchestrator', false, true, 'row-1'),
                renderCallRoleBadgeHtml('executor', true, true, 'row-2'),
                renderCallRoleBadgeHtml('subagent', false, true, 'row-3'),
            ].join('');
            assertFrozenRichTipContract(badgesHtml, `Role Badges (${language})`);
            expect(badgesHtml).toContain('data-popover-key="orch-role-orchestrator-row-1"');
            expect(badgesHtml).toContain('data-popover-key="orch-role-executor-row-2"');
            expect(badgesHtml).toContain('data-popover-key="orch-cold-switch-row-2"');
            expect(badgesHtml).toContain('data-popover-key="orch-role-subagent-row-3"');
            if (language === 'zh' || language === 'both') {
                expect(badgesHtml).toContain('子智能体');
            }

            // Combined Overview (compact: true) + GM Data (compact: false) cards
            const orchCalls: GMCallEntry[] = [
                makeGMCall({
                    executionId: 'orch-1',
                    stepIndices: [1],
                    model: 'MODEL_PLACEHOLDER_M667',
                    modelDisplay: 'Claude Opus 5.5 (Orchestrator)',
                    responseModel: 'MODEL_PLACEHOLDER_M667',
                    inputTokens: 10000,
                    outputTokens: 300,
                    cacheReadTokens: 0,
                    createdAt: '2026-11-26T10:00:00.000Z',
                }),
                makeGMCall({
                    executionId: 'exec-2',
                    stepIndices: [2],
                    model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
                    responseModel: 'claude-sonnet-4-6',
                    inputTokens: 12000,
                    outputTokens: 600,
                    cacheReadTokens: 0,
                    createdAt: '2026-11-26T10:00:05.000Z',
                }),
                makeGMCall({
                    executionId: 'sub-3',
                    stepIndices: [3],
                    model: 'MODEL_PLACEHOLDER_M26',
                    modelDisplay: 'Gemini 3 Flash',
                    responseModel: 'gemini-3-flash',
                    inputTokens: 3000,
                    outputTokens: 200,
                    cacheReadTokens: 0,
                    createdAt: '2026-11-26T10:00:08.000Z',
                }),
            ];
            const summary = computeOrchestratorSplit(
                orchCalls,
                {
                    orchestratorConfig: {
                        planModel: 'MODEL_PLACEHOLDER_M667',
                        executionModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    },
                    orchestratorHistory: [
                        {
                            startStepIndex: 1,
                            endStepIndex: 1,
                            planModel: 'MODEL_PLACEHOLDER_M667',
                            executionModel: 'MODEL_PLACEHOLDER_M667',
                        },
                        {
                            startStepIndex: 2,
                            endStepIndex: 3,
                            planModel: 'MODEL_PLACEHOLDER_M667',
                            executionModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                        },
                    ],
                    orchestratorSettings: {
                        configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
                        configuredExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
                        effectiveExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                        effectiveOrchestratorLabel: 'Gemini 4 Carbon (Orchestrator)',
                        effectiveExecutorLabel: 'Claude Sonnet 4.6 (Thinking)',
                        isCustomOrchestrator: true,
                        isCustomExecutor: true,
                    } as OrchestratorSettings,
                },
                {},
            );
            expect(summary).not.toBeNull();

            const overviewCard = buildOrchestratorSplitCardHtml(summary!, { compact: true });
            const gmCard = buildOrchestratorSplitCardHtml(summary!, { compact: false });
            const combined = overviewCard + gmCard;

            assertFrozenRichTipContract(combined, `Combined Orchestrator Split (${language})`);
            expect(overviewCard).toContain('data-popover-key="ov-orch-');
            expect(gmCard).toContain('data-popover-key="gm-orch-');
            expect(combined).toContain('orch-split-mapped-tag');
            expect(combined).toContain('orch-cold-switch-banner');
            expect(combined).toContain('data-popover-key="gm-orch-reconfigured"');
        });

        it('ships balanced Orchestrator Attribution CSS', () => {
            assertBalancedCssBraces(getOrchestratorAttributionStyles(), 'Orchestrator CSS');
        });
    });


    // ─── 3. Cost / Pricing Tab ───────────────────────────────────────

    describe('Cost / Pricing tab rich tooltips (tabs-data)', () => {
        it.each(['en', 'zh', 'both'] as Language[])('eliminates clipped tooltips, raw M537/M667/M681/M669 codes, and explains mapped-base/partial/thinking/cache in %s mode', async language => {
            await setLanguageToState(language, langState);

            // Pin clock within 45 days before 2026-12-01 UTC cutover so scheduled rate banner renders
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'));

            const { gm, todayLedger, settledLedger } = makeRichGMData();
            // Add an unpriced custom model to gm.modelBreakdown so Partial total + Not available render
            gm.modelBreakdown['Unknown Experimental X'] = {
                ...gm.modelBreakdown['Claude Sonnet 4.6 (Thinking)'],
                calls: 1,
                responseModel: 'unknown-experimental-x',
                totalInputTokens: 2000,
                totalOutputTokens: 300,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
            };

            const store = new PricingStore();
            const monthBreakdown: MonthCostBreakdown = {
                year: 2026,
                month: 5,
                grandTotal: 4.56,
                cycleCount: 3,
                earliestDate: '2026-05-01',
                models: [
                    {
                        name: 'Claude Sonnet 4.6 (Thinking)',
                        totalCost: 3.12,
                        calls: 30,
                        inputTokens: 400000,
                        outputTokens: 30000,
                        thinkingTokens: 8000,
                        credits: 30,
                    },
                    {
                        name: 'Claude Opus 5.5 (Orchestrator)',
                        totalCost: 1.44,
                        calls: 10,
                        inputTokens: 80000,
                        outputTokens: 4000,
                        thinkingTokens: 0,
                        credits: 10,
                    },
                ],
            };

            const orchSettings: OrchestratorSettings = {
                configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
                configuredExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M667',
                effectiveExecutorModel: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                effectiveOrchestratorLabel: 'Claude Opus 5.5 (Orchestrator)',
                effectiveExecutorLabel: 'Claude Sonnet 4.6 (Thinking)',
                isCustomOrchestrator: true,
                isCustomExecutor: true,
            } as OrchestratorSettings;

            const mappedHtml = buildPricingTabContent(
                gm,
                store,
                monthBreakdown,
                settledLedger,
                todayLedger,
                false,
                { orchestratorSettings: orchSettings, orchestratorPricingMode: 'mapped' },
            );
            const strictCardHtml = buildActiveOrchestratorPricingCard(orchSettings, {}, 'strict');

            assertFrozenRichTipContract(mappedHtml, `Pricing Tab Mapped (${language})`);
            assertFrozenRichTipContract(strictCardHtml, `Pricing Orchestrator Strict (${language})`);

            // ZERO internal M537/M667/M681/M669 placeholder codes in user-facing copy
            for (const rawCode of ['M537', 'M667', 'M681', 'M669']) {
                expect(mappedHtml, `Pricing mapped must hide ${rawCode}`).not.toContain(rawCode);
                expect(strictCardHtml, `Pricing strict must hide ${rawCode}`).not.toContain(rawCode);
            }

            // Mapped base badge carries exact mappedBaseLabel + Mapped vs Strict explanation
            expect(mappedHtml).toContain('class="prc-mapped-badge"');
            expect(mappedHtml).toContain('Claude Opus 5.5');
            expect(mappedHtml).toContain(language === 'zh' ? '严格模式' : 'Strict Mode');

            // Partial total + API reference vs subscription billing + Thinking exclusion + Cache TTL + Archived cycles
            expect(mappedHtml).toContain('data-popover-key="prc-cost-chip-total"');
            expect(mappedHtml).toContain(language === 'zh' ? '订阅' : 'subscription');
            expect(mappedHtml).toContain('data-popover-key="prc-legend-thinking"');
            expect(mappedHtml).toContain('data-popover-key="prc-legend-cache"');
            expect(mappedHtml).toContain('data-popover-key="prc-monthly-cycles"');

            // Upcoming scheduled rate change banner rich tip (00:00 UTC + per 1M)
            expect(mappedHtml).toContain('data-popover-key="prc-rate-change-banner"');
            expect(mappedHtml).toContain(language === 'zh' ? 'UTC 00:00' : '00:00 UTC');


        });

        it('ships balanced Pricing CSS', () => {
            assertBalancedCssBraces(getPricingTabStyles(), 'Pricing CSS');
        });
    });


    // ─── 4. Sessions / Chat History Tab ──────────────────────────────────────────

    describe('Sessions / Chat History tab rich tooltips & terminology (tabs-data)', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders plain-language empty state without raw trajectory/LS jargon in %s mode', async language => {
            await setLanguageToState(language, langState);
            const html = buildChatHistoryTabContent([], null, null);

            expect(html).not.toContain('trajectory data');
            expect(html).not.toContain('轨迹数据');
            expect(html).not.toContain('LS sync');
            expect(html).not.toContain('LS 同步');
            if (language === 'en' || language === 'both') {
                expect(html).toContain('conversation history');
                expect(html).toContain('local service sync');
            }
            if (language === 'zh' || language === 'both') {
                expect(html).toContain('对话历史');
                expect(html).toContain('本地服务同步');
            }
        });

        it.each(['en', 'zh', 'both'] as Language[])('unifies terminology, wraps disabled action buttons, and migrates all tooltips in %s mode', async language => {
            await setLanguageToState(language, langState);

            const trajectories: TrajectorySummary[] = [
                {
                    cascadeId: '11111111-2222-3333-4444-555555555555',
                    title: 'Active Workspace Investigation',
                    stepCount: 18,
                    status: 'CASCADE_RUN_STATUS_RUNNING',
                    model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    createdTime: '2026-11-26T09:00:00.000Z',
                    lastModifiedTime: '2026-11-26T10:00:00.000Z',
                    lastUserInputTime: '2026-11-26T09:58:00.000Z',
                    workspaceUri: 'file:///Users/dev/project-alpha',
                    repositoryName: 'project-alpha',
                    branchName: 'main',
                },
                {
                    cascadeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    title: 'Idle Conversation With Workspace',
                    stepCount: 6,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                    model: 'MODEL_PLACEHOLDER_M26',
                    createdTime: '2026-11-26T08:00:00.000Z',
                    lastModifiedTime: '2026-11-26T08:30:00.000Z',
                    lastUserInputTime: '2026-11-26T08:25:00.000Z',
                    workspaceUri: 'file:///Users/dev/project-alpha',
                    repositoryName: 'project-alpha',
                    branchName: 'main',
                },
                {
                    cascadeId: '99999999-8888-7777-6666-555555555555',
                    title: 'Finished Unscoped Session',
                    stepCount: 10,
                    status: 'CASCADE_RUN_STATUS_FINISHED',
                    model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
                    createdTime: '2026-11-25T15:00:00.000Z',
                    lastModifiedTime: '2026-11-25T15:40:00.000Z',
                    lastUserInputTime: '2026-11-25T15:35:00.000Z',
                    workspaceUri: '',
                    repositoryName: '',
                    branchName: '',
                },
            ];

            const html = buildChatHistoryTabContent(
                trajectories,
                { cascadeId: '11111111-2222-3333-4444-555555555555' } as any,
                null,
                undefined,
                'file:///Users/dev/project-alpha',
            );

            assertFrozenRichTipContract(html, `Sessions Tab (${language})`);

            // 1. Unified terminology (no legacy abbreviations / button label drift)
            expect(html).not.toContain('>WS<');
            expect(html).not.toContain('>本区<');
            expect(html).not.toContain('Recordable');
            expect(html).not.toContain('Record Folder');
            expect(html).not.toContain('aria-label="记录目录');
            expect(html).not.toContain('PB File');
            expect(html).not.toContain('PB 文件');
            if (language === 'en' || language === 'both') {
                expect(html).toContain('Current Workspace');
                expect(html).toContain('Backup Ready');
                expect(html).toContain('Session Records');
                expect(html).toContain('Archive (.pb)');
            }
            if (language === 'zh' || language === 'both') {
                expect(html).toContain('当前工作区');
                expect(html).toContain('可备份');
                expect(html).toContain('会话记录');
                expect(html).toContain('对话存档 (.pb)');
            }

            // 2. Disabled buttons wrapped in .rich-tip-disabled-wrap with tabindex="0" & disability explanation
            expect(html).toContain('class="rich-tip-disabled-wrap"');
            expect(html).toMatch(/class="rich-tip-disabled-wrap"[^>]*tabindex="0"[^>]*><button[^>]*disabled/);
            expect(html).toContain('data-popover-key="ses-act-ws-');
            expect(html).toContain('data-popover-key="ses-act-pb-');
            expect(html).toContain('data-popover-key="ses-act-records-');

            // 3. Row title shows full title + short ID via rich tip (zero raw UUID native title=)
            expect(html).toContain('data-popover-key="ses-row-title-');
            expect(html).toContain('11111111');

            // 4. Status badges distinguish Idle vs Finished & group N run chip has rich tip
            expect(html).toContain('data-popover-key="ses-badge-status-');
            expect(html).toContain('data-popover-key="ses-grp-run-0"');
            if (language === 'en') {
                expect(html).toContain('ready for your next message');
                expect(html).toContain('Contrast with Idle');
            } else if (language === 'zh') {
                expect(html).toContain('正等待你的下一条消息');
                expect(html).toContain('区别于「空闲」');
            }
        });
    });
});

describe('[tabs-meta-ux-tooltips]', () => {
    const initialLang = getLanguage();


    function makeConfig(model: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
        return {
            model,
            label: overrides.label || getModelDisplayName(model),
            supportsImages: true,
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
            quotaInfo: { remainingFraction: 0.72, resetTime: '2026-11-26T18:00:00Z' },
            ...overrides,
        };
    }


    function makeUserInfo(overrides: Partial<UserStatusInfo> = {}): UserStatusInfo {
        return {
            name: 'Alice',
            email: 'alice@example.test',
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
                monthlyFlexCreditPurchaseAmount: 500,
            },
            teamConfig: {
                allowMcpServers: true,
                allowAutoRunCommands: false,
                allowBrowserExperimentalFeatures: true,
            },
            availableCredits: [
                { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 2_500, minimumCreditAmountForUsage: 1 },
            ],
            canBuyMoreCredits: true,
            browserEnabled: true,
            cascadeWebSearchEnabled: true,
            knowledgeBaseEnabled: true,
            canGenerateCommitMessages: true,
            cascadeCanAutoRunCommands: true,
            canAllowCascadeInBackground: false,
            hasAutocompleteFastMode: true,
            allowStickyPremiumModels: true,
            allowPremiumCommandModels: false,
            hasTabToJump: true,
            canCustomizeAppIcon: false,
            userTierDescription: '',
            upgradeSubscriptionText: '',
            modelSortOrder: [],
            ...overrides,
        };
    }


    const SAMPLE_ORCH: OrchestratorSettings = {
        configuredOrchestratorModel: '',
        configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M537',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorLabel: 'Orchestrator (Neon)',
        effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
        isCustomOrchestrator: false,
        isCustomExecutor: true,
        mode: 'custom',
        settingsSource: 'config_fallback',
        useAiCredits: true,
        roles: {
            orchestrators: ['gemini-4-neon', 'claude-opus-5-5'],
            executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
        },
        orchestratorCandidates: ['MODEL_PLACEHOLDER_M537', 'MODEL_PLACEHOLDER_M401'],
        executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
        lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M537',
    };


    const SAMPLE_QUOTA_SUMMARY: UserQuotaSummary = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.68,
                    resetTime: '2026-11-26T18:00:00Z',
                    resetAt: Date.parse('2026-11-26T18:00:00Z'),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.91,
                    resetTime: '2026-12-02T18:00:00Z',
                    resetAt: Date.parse('2026-12-02T18:00:00Z'),
                },
                buckets: [],
            },
            {
                pool: 'premium',
                displayName: 'Claude and GPT models',
                fiveHour: {
                    bucketId: '3p-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.45,
                    resetTime: '2026-11-26T18:30:00Z',
                    resetAt: Date.parse('2026-11-26T18:30:00Z'),
                },
                weekly: {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.85,
                    resetTime: '2026-12-02T18:30:00Z',
                    resetAt: Date.parse('2026-12-02T18:30:00Z'),
                },
                buckets: [],
            },
        ],
    };


    const SAMPLE_RUNWAYS: Record<string, QuotaRunwayEstimate> = {
        gemini: {
            poolKey: 'gemini',
            status: 'safe_until_reset',
            burnRatePctPerHour: 4.2,
            estExhaustMs: 12 * 60 * 60_000,
            timeToResetMs: 4 * 60 * 60_000,
            recoveredRecently: false,
        },
        premium: {
            poolKey: 'premium',
            status: 'at_risk',
            burnRatePctPerHour: 28.5,
            estExhaustMs: 90 * 60_000,
            timeToResetMs: 240 * 60_000,
            recoveredRecently: false,
        },
    };


    function assertFrozenPopoverContract(html: string, label: string): void {
        // 1. Every element carrying data-tip-body MUST also carry data-popover-key and MUST NOT carry native title="..."
        const tagRegex = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
        const keys: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(html)) !== null) {
            const attrs = match[2];
            const keyMatch = /\bdata-popover-key="([^"]+)"/.exec(attrs);
            const hasTipBody = /\bdata-tip-body="/.test(attrs);
            const hasNativeTitle = /(?:^|\s)title="/.test(attrs);
            if (hasTipBody) {
                expect(keyMatch, `${label}: element with data-tip-body missing data-popover-key: ${match[0]}`).not.toBeNull();
                expect(hasNativeTitle, `${label}: element with data-tip-body must not emit native title=: ${match[0]}`).toBe(false);
            }
            if (keyMatch) {
                keys.push(keyMatch[1]);
            }
        }
        // 2. All data-popover-key values must be globally unique within the rendered HTML
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const k of keys) {
            if (seen.has(k)) { duplicates.push(k); }
            seen.add(k);
        }
        expect(duplicates, `${label}: duplicate data-popover-key values`).toEqual([]);
        expect(keys.length, `${label}: expected rich-tip triggers`).toBeGreaterThan(0);
        // 3. Never emit forbidden machine-translated 令牌
        expect(html, `${label}: forbidden 令牌`).not.toContain('令牌');
    }


    beforeEach(() => {
        setLanguageInMemory('both');
    });


    afterEach(() => {
        setLanguageInMemory(initialLang);
    });


    describe('Models tab UX, unified naming & rich-tip contract', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders unified limits, rich tips, and zero native title= in %s', (lang) => {
            setLanguageInMemory(lang);
            const configs = [
                makeConfig('MODEL_PLACEHOLDER_M537'),
                makeConfig('MODEL_PLACEHOLDER_M528'),
                makeConfig('MODEL_PLACEHOLDER_M401'),
                makeConfig('MODEL_PLACEHOLDER_M669'),
            ];
            const html = buildModelsTabContent(makeUserInfo(), configs, {
                orchestratorSettings: SAMPLE_ORCH,
                quotaSummary: SAMPLE_QUOTA_SUMMARY,
                quotaRunways: SAMPLE_RUNWAYS,
                staleState: { isStale: true, lastSuccessAtMs: Date.UTC(2026, 10, 26) },
            });

            assertFrozenPopoverContract(html, `models-${lang}`);
            // Zero remaining native title="..." attributes inside Models tab
            expect(html).not.toMatch(/\stitle="/);

            // Unified 3-limit naming
            if (lang !== 'zh') {
                expect(html).toContain('Effective Budget (Compaction Limit)');
                expect(html).toContain('Checkpoint Threshold');
                expect(html).toContain('Native Ceiling (Model Context)');
            }
            if (lang !== 'en') {
                expect(html).toContain('自动压缩上限（有效预算）');
                expect(html).toContain('检查点阈值');
                expect(html).toContain('原生窗口上限');
            }

            // Orchestrator Settings rich tips: planner/worker, auto default, pinned, local config, AI Credit Overages, mapped base, pool chips
            expect(html).toContain('data-popover-key="models-orch-role-orchestrator"');
            expect(html).toContain('data-popover-key="models-orch-role-executor"');
            expect(html).toContain('data-popover-key="models-orch-status-orchestrator"');
            expect(html).toContain('data-popover-key="models-orch-status-executor"');
            expect(html).toContain('data-popover-key="models-orch-source"');
            expect(html).toContain('~/.gemini/config/config.json');
            expect(html).toContain('data-popover-key="models-orch-ai-credits"');
            expect(html).toContain('data-popover-key="models-orch-shortid-orchestrator"');
            expect(html).toContain('MODEL_PLACEHOLDER_M537');
            expect(html).toContain('data-popover-key="models-orch-planner-pool-gemini"');
            expect(html).toContain('data-popover-key="models-orch-prov-orchestrator"');

            // Quota Runway rich tips (45-minute rolling window)
            expect(html).toContain('data-popover-key="models-runway-heading"');
            expect(html).toContain('data-popover-key="models-runway-gemini"');
            expect(html).toContain('data-popover-key="models-runway-premium"');
            expect(html).toMatch(/45-minute|45 分钟/);

            expect(html).toContain('data-stale-banner="true"');
            expect(html).toContain('data-popover-key="stale:stale-banner"');

            // Spec cards: provider, short-id, model-id, pricing, thinking, execution route
            expect(html).toContain('data-popover-key="models-spec-provider-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-modelid-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-shortid-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-compaction-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-checkpoint-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-native-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-thinking-chat-0-model_placeholder_m537"');
            expect(html).toContain('data-popover-key="models-spec-pricelabel-chat-0-model_placeholder_m537"');

            // Custom / BYOK isolated summary rich-tip
            const byokHtml = buildModelsTabContent(makeUserInfo(), configs, {
                isCustomModelActive: true,
                quotaSummary: SAMPLE_QUOTA_SUMMARY,
            });
            assertFrozenPopoverContract(byokHtml, `models-byok-${lang}`);
            expect(byokHtml).toContain('data-popover-key="models-byok-pools-summary"');
            expect(byokHtml).toContain('BYOK');
        });

        it('renders Thinking modes (Adaptive, Dynamic, Budget), Custom & Unpriced tips, and replaces raw LS in empty state', () => {
            setLanguageInMemory('both');
            const baseSpec = getModelSpecs()[0];
            const html = buildModelInfoGrid(
                [
                    { ...baseSpec, placeholderId: 'MODEL_A', modelId: 'model-a', supportsThinking: true, supportsAdaptiveThinking: true },
                    { ...baseSpec, placeholderId: 'MODEL_B', modelId: 'model-b', supportsThinking: true, supportsAdaptiveThinking: false, thinkingBudget: -1 },
                    { ...baseSpec, placeholderId: 'MODEL_C', modelId: 'model-c', supportsThinking: true, supportsAdaptiveThinking: false, thinkingBudget: 16_000 },
                ],
                'chat',
                {
                    customPricing: { 'model-a': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, thinking: 2 } },
                    orchestratorPricingMode: 'strict',
                },
            );
            assertFrozenPopoverContract(html, 'models-thinking-pricing');
            expect(html).toContain('Adaptive Thinking');
            expect(html).toContain('Dynamic Thinking');
            expect(html).toContain('Fixed Thinking Budget');
            expect(html).toContain('Custom Rate');
            expect(html).toContain('Unpriced Model');

            // Also check strict unpriced in Orchestrator Settings card
            const strictOrch = buildOrchestratorSettingsCard(SAMPLE_ORCH, { orchestratorPricingMode: 'strict' });
            assertFrozenPopoverContract(strictOrch, 'orch-strict');
            expect(strictOrch).toContain('data-popover-key="models-orch-price-orchestrator"');
            expect(strictOrch).toContain('Unpriced Model');

            // Default model card has rich tip and no native title=
            const defHtml = buildDefaultModelCard(makeUserInfo());
            assertFrozenPopoverContract(defHtml, 'default-model');
            expect(defHtml).not.toMatch(/\stitle="/);
        });
    });


    describe('Profile tab UX: Notice tagDescription bug fix, unified 账号 & accessible Feature/Team flags', () => {
        it('omits unreported plan limits and preserves the host sentinel separately from explicit zero', () => {
            const unknown = { maxNumChatInputTokens: null, maxNumPremiumChatMessages: null, maxCustomChatInstructionCharacters: null,
                maxNumPinnedContextItems: null, maxLocalIndexSize: null, monthlyFlexCreditPurchaseAmount: null };
            const empty = buildProfileContent(makeUserInfo({ planLimits: unknown }), []);
            expect(empty).not.toContain('data-plan-limit=');
            const partial = buildProfileContent(makeUserInfo({ planLimits: { ...unknown,
                maxNumPremiumChatMessages: -1, monthlyFlexCreditPurchaseAmount: 0 } }), []);
            expect(partial.match(/data-plan-limit=/g)).toHaveLength(2);
            expect(partial).toContain('−1');
            expect(partial).toContain('class="profile-metric-value">0</dd>');
        });

        it.each(['en', 'zh', 'both'] as Language[])('surfaces config.tagDescription on Notice badges and eliminates raw LS / 个人 in %s', (lang) => {
            setLanguageInMemory(lang);
            const configs: ModelConfig[] = [
                makeConfig('MODEL_PLACEHOLDER_M535', { tagTitle: 'New', tagDescription: 'Latest flagship reasoning tier' }),
                makeConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', {
                    tagTitle: 'Notice',
                    tagDescription: 'Scheduled for sunset on 2026-12-31; migrate to Gemini 4.',
                }),
                makeConfig('MODEL_CUSTOM_STANDALONE', {
                    label: 'Standalone Experimental',
                    tagTitle: 'Notice',
                    tagDescription: 'Standalone notice text from catalog',
                }),
            ];
            const html = buildProfileContent(makeUserInfo(), configs, 15, SAMPLE_QUOTA_SUMMARY);

            assertFrozenPopoverContract(html, `profile-${lang}`);
            expect(html).not.toMatch(/\stitle="/);

            // Bug fix: Notice badge surfaces real config.tagDescription via rich-tip (NOT redundant title="Notice")
            expect(html).toContain('Scheduled for sunset on 2026-12-31; migrate to Gemini 4.');
            expect(html).toContain('Latest flagship reasoning tier');
            expect(html).toContain('Standalone notice text from catalog');

            // Unified ZH heading 账号 (never 个人 or 账户)
            if (lang !== 'en') {
                expect(html).toContain('账号');
                expect(html).not.toContain('>个人<');
                expect(html).not.toContain('>账户<');
            }

            // Dual-window, efforts, AI credits, billingDay, Plan Limits (with units), Feature Flags & Team Config
            expect(html).toContain('data-popover-key="profile-quota-win-0-pool-gemini-5h"');
            expect(html).toContain('data-popover-key="profile-quota-win-0-pool-gemini-weekly"');
            expect(html).toContain('data-popover-key="profile-ai-credits-heading"');
            expect(html).toContain('data-popover-key="profile-billing-day-label"');
            expect(html).toContain('data-popover-key="profile-limit-max-input"');
            expect(html).toContain('data-popover-key="profile-limit-local-index"');
            expect(html).toContain('data-popover-key="profile-limit-pinned-context"');
            expect(html).toContain('data-popover-key="profile-limit-flex-credits"');
            const plainText = html.replace(/<[^>]+>/g, '');
            expect(plainText).toContain('100,000');
            expect(plainText).not.toMatch(/100,000 (items|条)/);
            expect(plainText).toContain(lang === 'zh' ? '20 项' : '20 items');

            // Accessible Feature Flags & Team Config chips with visible ✓/× status + aria-label + rich-tip
            expect(html).toContain('data-popover-key="profile-flag-sticky-premium"');
            expect(html).toContain('data-popover-key="profile-flag-command-models"');
            expect(html).toContain('data-popover-key="profile-flag-tab-jump"');
            expect(html).toContain('data-popover-key="profile-flag-background"');
            expect(html).toContain('data-popover-key="profile-flag-auto-run"');
            expect(html).toContain('data-popover-key="profile-team-mcp-servers"');
            expect(html).toContain('data-popover-key="profile-team-browser-experimental"');
            expect(html).toContain('class="feature-tag-state"');
            expect(html).toContain('✓');
            expect(html).toContain('×');
            expect(html).toContain('data-flag-state="enabled"');
            expect(html).toContain('data-flag-state="disabled"');

            // Empty state: unified 账号 + local service (no raw LS)
            const emptyHtml = buildProfileContent(null, []);
            expect(emptyHtml).not.toContain('LS');
            expect(emptyHtml).not.toContain('>个人<');
            expect(emptyHtml).toContain(lang === 'en' ? 'local service' : '本地服务');
        });

        it('adds rich-tip for Reported values differ and falls back gracefully when tagDescription is missing', () => {
            setLanguageInMemory('en');
            const html = buildModelQuotaGrid([
                makeConfig('MODEL_PLACEHOLDER_M534', { quotaInfo: { remainingFraction: 0.4, resetTime: '2026-11-26T18:00:00Z' } }),
                makeConfig('MODEL_PLACEHOLDER_M535', { tagTitle: 'Notice', quotaInfo: { remainingFraction: 0.8, resetTime: '2026-11-26T18:00:00Z' } }),
            ]);
            assertFrozenPopoverContract(html, 'profile-diff-fallback');
            expect(html).toContain('Why Reported Values Differ');
            expect(html).toContain('Official notice from the model catalog');
        });
    });


    describe('Calendar tab UX: all broken tooltips migrated, Credits chip fixed & metric explanations', () => {
        function makeRichCalendarStore(): DailyStore {
            const store = new DailyStore();
            const records: DailyStoreState['records'] = {
                '2026-10-15': {
                    date: '2026-10-15',
                    cycles: [{
                        startTime: '2026-10-15T08:00:00Z',
                        endTime: '2026-10-15T12:00:00Z',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['Gemini 4 Neon (High)'],
                        gmTotalCalls: 2, gmTotalCredits: 1, gmTotalTokens: 5_000, gmTotalAllTokens: 15_000,
                        estimatedCost: 0.05, surface: 'ide',
                        gmModelStats: {
                            'Gemini 4 Neon (High)': {
                                calls: 2, credits: 1, inputTokens: 3_000, outputTokens: 2_000, thinkingTokens: 500,
                                cacheReadTokens: 10_000, cacheCreationTokens: 0, avgTTFT: 0.5, avgGenTokPerSec: 90,
                                cacheHitRate: 1, tokenCacheHitRate: 10_000 / 13_000, estimatedCost: 0.05,
                            },
                        },
                    }],
                },
                '2026-11-20': {
                    date: '2026-11-20',
                    cycles: [{
                        startTime: '2026-11-20T09:00:00Z',
                        endTime: '2026-11-20T18:00:00Z',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['Claude Opus 5.5 (High)'],
                        gmTotalCalls: 25, gmTotalCredits: 14, gmTotalTokens: 100_000, gmTotalAllTokens: 450_000,
                        estimatedCost: 3.5, surface: 'app', triggeredBy: ['Claude / GPT'],
                        gmModelStats: {
                            'Claude Opus 5.5 (High)': {
                                calls: 25, credits: 14, inputTokens: 50_000, outputTokens: 50_000, thinkingTokens: 18_000,
                                cacheReadTokens: 320_000, cacheCreationTokens: 30_000, avgTTFT: 0.8, avgGenTokPerSec: 75,
                                cacheHitRate: 1, tokenCacheHitRate: 320_000 / 400_000, estimatedCost: 3.5,
                            },
                        },
                    }],
                },
            };
            store.restoreSnapshot({ version: 1, records });
            return store;
        }

        it.each(['en', 'zh', 'both'] as Language[])('migrates heatmap, month grid, day detail chips, and removes all title= & [data-tooltip] in %s', (lang) => {
            const store = makeRichCalendarStore();
            const now = new Date(2026, 10, 20, 14, 0, 0);
            const dailyHtml = buildCalendarTabContent(store, 2026, 11, {
                selectedDate: '2026-11-20',
                subscription: { planId: 'google-ai-pro' },
                now,
                language: lang,
            });

            assertFrozenPopoverContract(dailyHtml, `cal-daily-${lang}`);
            // Zero native title= and ZERO broken [data-tooltip] anywhere in Calendar
            expect(dailyHtml).not.toMatch(/\stitle="/);
            expect(dailyHtml).not.toContain('data-tooltip=');

            // Heatmap active AND empty cells carry rich-tip keys
            expect(dailyHtml).toContain('data-popover-key="cal-hm-2026-11-20"');
            expect(dailyHtml).toContain('data-popover-key="cal-hm-2026-11-19"');
            expect(dailyHtml).toContain('data-popover-key="cal-hm-legend"');

            // Month Grid cell & dot legend
            expect(dailyHtml).toContain('data-popover-key="cal-grid-2026-11-20"');
            expect(dailyHtml).toContain('data-popover-key="cal-month-dot-legend"');
            expect(dailyHtml).toMatch(/calls &gt; 20|调用 &gt; 20/);

            // Export buttons migrated to rich-tip
            expect(dailyHtml).toContain('data-popover-key="cal-export-csv"');
            expect(dailyHtml).toContain('data-popover-key="cal-export-json"');

            // Credits chip bug fix: visible credits label + aria-label + rich-tip
            expect(dailyHtml).toContain('cal-chip-credits');
            expect(dailyHtml).toContain('data-popover-key="cal-gm-credits-2026-11-20-0"');
            expect(dailyHtml.replace(/<[^>]+>/g, '')).toContain(lang === 'zh' ? '14 积分' : '14 credits');

            // All other Day Detail GM chips & Cycle History & Reset trigger & Range Footer & ROI
            for (const key of [
                'cal-gm-summary-label-2026-11-20',
                'cal-gm-speed-2026-11-20-0',
                'cal-gm-ttft-2026-11-20-0',
                'cal-gm-cache-2026-11-20-0',
                'cal-gm-tokens-2026-11-20-0',
                'cal-gm-model-2026-11-20-0',
                'cal-day-tokbreakdown-2026-11-20',
                'cal-cycles-summary-2026-11-20',
                'cal-cycle-reset-2026-11-20-0',
                'cal-range-cal-avg',
                'cal-range-active-avg',
                'cal-range-roi',
                'cal-src-cli',
            ]) {
                expect(dailyHtml, `missing calendar key ${key}`).toContain(`data-popover-key="${key}"`);
            }

            // All-Time strip (including narrow <10% 2026-10 block!) and Weekly/Monthly/Year bar charts
            const allTimeHtml = buildCalendarTabContent(store, 2026, 11, { periodMode: 'all', now, language: lang });
            assertFrozenPopoverContract(allTimeHtml, `cal-all-${lang}`);
            expect(allTimeHtml).not.toMatch(/\stitle="/);
            expect(allTimeHtml).toContain('data-popover-key="cal-cum-2026-10"');
            expect(allTimeHtml).toContain('data-popover-key="cal-cum-2026-11"');

            const weeklyHtml = buildCalendarTabContent(store, 2026, 11, { periodMode: 'weekly', now, language: lang });
            assertFrozenPopoverContract(weeklyHtml, `cal-weekly-${lang}`);
            expect(weeklyHtml).not.toMatch(/\stitle="/);
            expect(weeklyHtml).toContain('data-popover-key="cal-bar-weekly-');
        });
    });


    describe('Settings & About tabs UX: error pills fixed, plain CDP/Dock copy, no M537 codes, CLI reconciled', () => {
        it.each(['en', 'zh', 'both'] as Language[])('fixes #updateStatusPill & #cdpStatusPill error readability, removes M537 codes, and adds control explanations in %s', (lang) => {
            setLanguageInMemory(lang);
            const cdpErr: CdpStatus = {
                state: 'error',
                diagnosticCode: 'ws_error',
                errorMessage: 'WebSocket handshake refused on 127.0.0.1:9222',
                composerEnabled: true,
                topBarEnabled: false,
                launcherStatus: {
                    supported: true,
                    platform: 'darwin',
                    installed: true,
                    launcherPath: '/Applications/Antigravity (CDP).app',
                    displayName: 'Antigravity (CDP)',
                    targetAppFound: true,
                    safeTerminalCommand: 'open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
                },
            };
            const html = buildSettingsContent([], undefined, undefined, {
                surface: 'app-sidecar',
                appSettings: { appComposerRingEnabled: true },
                cdpStatus: cdpErr,
                updateStatus: {
                    status: 'error',
                    error: 'GitHub API rate limit exceeded (HTTP 403)',
                },
            });

            assertFrozenPopoverContract(html, `settings-${lang}`);
            expect(html).not.toMatch(/\stitle="/);

            // Bug fix: error details visible in rich-tip attributes on #updateStatusPill and #cdpStatusPill
            expect(html).toContain('data-popover-key="settings-update-status-pill"');
            expect(html).toContain('GitHub API rate limit exceeded (HTTP 403)');
            expect(html).toContain('data-popover-key="settings-cdp-status-pill"');
            expect(html).toContain('WebSocket handshake refused on 127.0.0.1:9222');

            // Zero raw M537/M667/M681/M669 internal codes in Orchestrator pricing mode
            expect(html).not.toMatch(/M537|M667|M681|M669/);

            // Module A Dock guidance (macOS, Windows, Linux) present cleanly
            expect(html).toContain('/Applications/Antigravity (CDP).app');
            expect(html).toMatch(/Keep in Dock|在程序坞中保留/);
            expect(html).toMatch(/Pin to Taskbar|固定到任务栏/);
            expect(html).toContain('Ubuntu Dock');

            // All required settings control rich-tips
            for (const key of [
                'settings-tip-native-hud',
                'settings-tip-composer-ring',
                'settings-tip-topbar-overlay',
                'settings-tip-orch-mapped',
                'settings-tip-orch-strict',
                'settings-tip-custom-fx',
                'settings-tip-subscription-roi',
                'settings-tip-calendar-retention',
                'settings-tip-max-recent-steps',
                'settings-tip-max-archives',
                'settings-tip-polling-interval',
                'settings-tip-cache-hit',
                'settings-tip-hover-density',
                'settings-tip-lock-main-agent',
                'settings-tip-model-internal-id',
                'settings-tip-panel-tips',
            ]) {
                expect(html, `missing settings key ${key}`).toContain(`data-popover-key="${key}"`);
            }

            // Panel Tips clarifies top tab-bar horizontal scroll hint
            expect(html).toMatch(/tab-bar horizontal scroll hint|顶部标签导航栏的横向滚动提示/);
        });

        it.each(['en', 'zh', 'both'] as Language[])('fixes About error pill, reconciles CLI note, unifies Sidecar ZH & softens jargon in %s', (lang) => {
            setLanguageInMemory(lang);
            const html = buildAboutTabContent('1.17.11', {
                surface: 'app-sidecar',
                updateStatus: { status: 'error', error: 'TLS certificate expired' },
            });

            assertFrozenPopoverContract(html, `about-${lang}`);
            expect(html).not.toMatch(/\stitle="/);

            // Bug fix: error pill exposes error detail via rich-tip
            expect(html).toContain('data-about-update-status="error"');
            expect(html).toContain('data-popover-key="about-update-status-pill"');
            expect(html).toContain('TLS certificate expired');

            // CLI contradiction reconciled: clarifies runtime plugin unsupported while Calendar reads local CLI logs
            expect(html).toContain('data-popover-key="about-platform-cli"');
            expect(html).toMatch(/local CLI usage logs|本地 CLI 用量日志/);

            // Sidecar ZH unified & jargon softened
            if (lang !== 'en') {
                expect(html).toContain('侧边插件 (Sidecar)');
                expect(html).toContain('模型调用遥测');
                expect(html).toContain('本地会话记录');
                expect(html).toContain('会话存档');
                expect(html).not.toContain('编排器设置');
            }
            if (lang !== 'zh') {
                expect(html).toContain('runtime call telemetry (Generator Metadata)');
                expect(html).toContain('local session records (Brain)');
                expect(html).toContain('conversation archives (.pb / Protobuf)');
            }
        });
    });


    describe('tooltip-budget & i18n-core backward compatibility and unification', () => {
        it('unifies drifted ZH labels in i18n-core while preserving all existing exports from i18n.ts', () => {
            expect(t('orchestrator.settings', 'zh')).toBe('编排设置');
            expect(t('nav.profile', 'zh')).toBe('账号');
            expect(t('telemetry.cacheState.warm', 'zh')).toBe('热缓存');
            expect(t('telemetry.cacheState.warmCached', 'zh')).toBe('热缓存（命中）');
            expect(t('agent.subagents', 'zh')).toBe('子智能体');
            expect(t('context.effectiveBudget', 'zh')).toContain('自动压缩上限');
            expect(t('overview.compactionLimit', 'zh')).toBe('自动压缩上限');
            expect(t('context.nativeCeiling', 'zh')).toBe('原生窗口上限');
            expect(t('service.localService', 'zh')).toBe('本地服务');
            expect(i18n.translations).toBe(translations);
            expect(typeof i18n.t).toBe('function');
            expect(typeof i18n.tBi).toBe('function');
            expect(typeof i18n.tBiHtml).toBe('function');
        });

        it('formats collapsed quota pool rows with models / 个模型 units cleanly', () => {
            expect(poolSizeSuffix(1, 'en')).toBe('');
            expect(poolSizeSuffix(5, 'en')).toBe(' · 5 models');
            expect(poolSizeSuffix(5, 'zh')).toBe(' · 5 个模型');
            const res = selectQuotaRows([
                { model: 'MODEL_PLACEHOLDER_M438', label: 'Gemini 4 Carbon (Low)', quotaInfo: { remainingFraction: 0.5 } },
                { model: 'MODEL_PLACEHOLDER_M427', label: 'Gemini 4 Carbon (High)', quotaInfo: { remainingFraction: 0.5 } },
            ], '', 3, 'zh');
            expect(res.rows[0].label).toBe('Gemini 4 Carbon (High) · 2 个模型');
        });

        it('keeps all data-popover-key values globally unique when rendering all 5 owned tabs together', () => {
            setLanguageInMemory('both');
            const configs = [
                makeConfig('MODEL_PLACEHOLDER_M535', { tagTitle: 'New', tagDescription: 'Flagship' }),
                makeConfig('MODEL_PLACEHOLDER_M401'),
            ];
            const store = new DailyStore();
            store.restoreSnapshot({
                version: 1,
                records: {
                    '2026-11-20': {
                        date: '2026-11-20',
                        cycles: [{
                            startTime: '2026-11-20T09:00:00Z', endTime: '2026-11-20T18:00:00Z',
                            totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                            totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                            modelNames: ['Gemini 4 Neon (High)'], gmTotalCalls: 3, gmTotalCredits: 2,
                            gmTotalTokens: 20_000, gmTotalAllTokens: 80_000, estimatedCost: 0.4, surface: 'app',
                            gmModelStats: {
                                'Gemini 4 Neon (High)': {
                                    calls: 3, credits: 2, inputTokens: 15_000, outputTokens: 5_000, thinkingTokens: 1_000,
                                    cacheReadTokens: 60_000, cacheCreationTokens: 0, avgTTFT: 0.4, avgGenTokPerSec: 85,
                                    cacheHitRate: 1, tokenCacheHitRate: 0.8, estimatedCost: 0.4,
                                },
                            },
                        }],
                    },
                },
            });
            const combined = [
                buildModelsTabContent(makeUserInfo(), configs, {
                    orchestratorSettings: SAMPLE_ORCH,
                    quotaSummary: SAMPLE_QUOTA_SUMMARY,
                    quotaRunways: SAMPLE_RUNWAYS,
                }),
                buildProfileContent(makeUserInfo(), configs, 15, SAMPLE_QUOTA_SUMMARY),
                buildCalendarTabContent(store, 2026, 11, { selectedDate: '2026-11-20', now: new Date(2026, 10, 20, 12, 0), language: 'both' }),
                buildSettingsContent(configs, undefined, undefined, { surface: 'app-sidecar', updateStatus: { status: 'error', error: 'Timeout' } }),
                buildAboutTabContent('1.17.11', { surface: 'app-sidecar', updateStatus: { status: 'error', error: 'Timeout' } }),
            ].join('\n');

            assertFrozenPopoverContract(combined, 'all-5-tabs-combined');
        });
    });
});

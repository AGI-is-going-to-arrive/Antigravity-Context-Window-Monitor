import { createFastDurableState } from './helpers/factories';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CDP_COMPOSER_HOST_ID,
    CDP_TOPBAR_HOST_ID,
    buildOverlayBootstrapScript,
    buildOverlayUpdateScript,
} from '../src/app/cdp-overlay-assets';
import {
    createSidecarRuntimeProvider,
    type SidecarRuntimeDeps,
    type SidecarRuntimeProvider,
} from '../src/app/sidecar-runtime';
import { CascadeStatus } from '../src/constants';
import { getRuntimeVersion } from '../src/core/version';
import { DurableState } from '../src/durable-state';
import { createServer } from 'node:http';
import { getContextUsage, readUnlistedMemberStepCount } from '../src/tracker';
import type {
    ContextUsage,
    FullUserStatus,
    GMCallEntry,
    GMSummary,
    LSInfo,
    RawGeneratorMetadataEntry,
    TrajectorySummary,
} from '../src/models';

// ─── Minimal Synthetic DOM + Shadow DOM Harness (Parity with CDP Browser) ───

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
        if (idx < 0) { this.childNodes.push(child); }
        else { this.childNodes.splice(idx, 0, child); }
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

    removeAttribute(name: string): void {
        if (name === 'id') { this.id = ''; }
        if (name === 'class') { this.className = ''; }
        this.attributes.delete(name);
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
        const handlers = this.listeners.get('click') ?? [];
        for (const fn of handlers) {
            fn({ stopPropagation: () => {}, target: this });
        }
    }

    getBoundingClientRect() {
        return { top: 400, left: 600, right: 626, bottom: 426, width: 26, height: 26 };
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

function createFakeDomContext() {
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
        innerWidth: 1440,
        innerHeight: 900,
        addEventListener: () => {},
        removeEventListener: () => {},
        getComputedStyle: () => ({ backgroundColor: 'rgb(13, 16, 20)' }),
        matchMedia: () => ({ matches: false }),
    };

    const sandbox: Record<string, unknown> = {
        window: win,
        document: doc,
        navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel' },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        fetch: vi.fn().mockResolvedValue({ ok: true }),
    };
    win.window = win;
    const ctx = vm.createContext(sandbox);
    return { ctx, doc };
}

// ─── Shared Test Fixtures ────────────────────────────────────────────────────

function makeLS(): LSInfo {
    return {
        pid: 4242,
        port: 54321,
        csrfToken: 'd9-csrf-token',
        useTls: false,
        surface: 'app',
    };
}

function makeUserStatus(): FullUserStatus {
    return {
        ok: true,
        modelConfigs: [
            {
                label: 'Gemini 3.1 Pro (High)',
                model: 'MODEL_PLACEHOLDER_M37',
                remainingFraction: 0.82,
                resetTime: '2026-11-28T00:00:00.000Z',
                supportsImages: true,
                isRecommended: true,
                quotaInfo: {
                    remainingFraction: 0.82,
                    resetTime: '2026-11-28T00:00:00.000Z',
                },
            },
        ],
        userInfo: {
            name: 'Alice Dev',
            email: 'alice@example.com',
            tierName: 'Pro',
            tierId: 'pro',
            tierDescription: 'Pro',
            planName: 'Pro',
            teamsTier: '',
            upgradeText: '',
            upgradeUri: '',
            promptCredits: 1000,
            flowCredits: 500,
            availableCredits: [],
            browserEnabled: true,
            knowledgeBaseEnabled: true,
            canBuyMoreCredits: true,
            monthlyPromptCredits: 1000,
            monthlyFlowCredits: 500,
        },
    };
}

function makeTraj(cascadeId: string, overrides: Partial<TrajectorySummary> = {}): TrajectorySummary {
    return {
        cascadeId,
        trajectoryId: `traj-${cascadeId}`,
        summary: `Session ${cascadeId}`,
        stepCount: 12,
        status: CascadeStatus.IDLE,
        lastModifiedTime: '2026-11-27T10:00:00.000Z',
        createdTime: '2026-11-27T09:00:00.000Z',
        requestedModel: 'MODEL_PLACEHOLDER_M37',
        generatorModel: 'MODEL_PLACEHOLDER_M37',
        workspaceUris: ['file:///tmp/project-alpha'],
        lastUserInputTime: '2026-11-27T09:58:00.000Z',
        lastUserInputStepIndex: 10,
        repositoryName: 'project-alpha',
        gitOriginUrl: '',
        branchName: 'main',
        gitRootUri: 'file:///tmp/project-alpha',
        ...overrides,
    };
}

function makeUsage(traj: TrajectorySummary, contextUsed: number, contextLimit = 256_000, overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        tokenUsageSource: contextUsed > 0 ? 'planner' : 'none',
        cascadeId: traj.cascadeId,
        title: traj.summary,
        model: traj.requestedModel || 'MODEL_PLACEHOLDER_M37',
        modelDisplayName: 'Gemini 3.1 Pro (High)',
        contextUsed,
        totalOutputTokens: contextUsed > 0 ? 1_200 : 0,
        totalToolCallOutputTokens: 0,
        contextLimit,
        usagePercent: contextLimit > 0 ? (contextUsed / contextLimit) * 100 : 0,
        stepCount: traj.stepCount,
        lastModifiedTime: traj.lastModifiedTime,
        status: traj.status,
        isEstimated: false,
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        imageGenerationModels: [],
        imageGenerationIncomplete: false,
        imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        createdTime: traj.createdTime,
        lastUserInputTime: traj.lastUserInputTime,
        lastUserInputStepIndex: traj.lastUserInputStepIndex,
        repositoryName: traj.repositoryName,
        gitOriginUrl: traj.gitOriginUrl,
        branchName: traj.branchName,
        gitRootUri: traj.gitRootUri,
        ...overrides,
    };
}

function makeGmEntry(inputTokens: number, outputTokens = 0, model = 'MODEL_PLACEHOLDER_M37'): RawGeneratorMetadataEntry {
    return {
        stepIndices: [0, 1, 2],
        chatModel: {
            model,
            usage: {
                model,
                inputTokens,
                outputTokens,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
            },
            timeToFirstToken: '0.4s',
            streamingDuration: '2.0s',
            completionConfig: { maxTokens: 8192 },
        },
    };
}

function makeGmSummary(callsByConv: Record<string, GMCallEntry[]>): GMSummary {
    let totalCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const conversations = Object.entries(callsByConv).map(([cascadeId, calls]) => {
        totalCalls += calls.length;
        for (const c of calls) {
            totalInputTokens += c.inputTokens || 0;
            totalOutputTokens += c.outputTokens || 0;
        }
        return {
            cascadeId,
            title: `Conv ${cascadeId}`,
            calls,
            totalCalls: calls.length,
            totalStepsCovered: calls.length * 2,
            totalCredits: 0,
            totalInputTokens: calls.reduce((s, c) => s + (c.inputTokens || 0), 0),
            totalOutputTokens: calls.reduce((s, c) => s + (c.outputTokens || 0), 0),
            totalCacheRead: calls.reduce((s, c) => s + (c.cacheReadTokens || 0), 0),
            totalCacheCreation: calls.reduce((s, c) => s + (c.cacheCreationTokens || 0), 0),
            totalThinkingTokens: calls.reduce((s, c) => s + (c.thinkingTokens || 0), 0),
            totalResponseTokens: calls.reduce((s, c) => s + (c.outputTokens || 0), 0),
            totalToolCalls: 0,
            totalRetryCount: 0,
            totalRetryTokens: 0,
            totalContextTokens: calls.reduce((s, c) => s + (c.inputTokens || 0), 0),
            lastStepCount: calls.length * 2,
            fetchedAt: Date.parse('2026-11-27T10:00:00.000Z'),
            checkpointSummaries: [],
        };
    });
    return {
        conversations,
        modelBreakdown: {},
        totalCalls,
        totalInputTokens,
        totalOutputTokens,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalThinkingTokens: 0,
        totalResponseTokens: totalOutputTokens,
        totalCredits: 0,
        totalRetryCount: 0,
        totalRetryTokens: 0,
        retryErrorCodes: {},
        toolCallCounts: {},
        toolCatalog: [],
        recentErrors: [],
        recentErrorEntries: [],
        uniqueErrors: [],
        contextGrowth: [],
        latestTokenBreakdown: [],
        fetchedAt: Date.parse('2026-11-27T10:00:00.000Z'),
    };
}

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        executionId: 'exec-1',
        model: 'MODEL_PLACEHOLDER_M37',
        modelDisplay: 'Gemini 3.1 Pro (High)',
        inputTokens: 160_000,
        outputTokens: 1_200,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
        responseTokens: 1_200,
        contextTokens: 160_000,
        ttftSeconds: 0.4,
        streamingSeconds: 2.0,
        credits: 0,
        stepIndices: [1, 2],
        startStepIndex: 1,
        createdAt: '2026-11-27T09:59:00.000Z',
        retryCount: 0,
        retryTokens: 0,
        retryErrors: [],
        userMessageAnchors: [],
        promptSectionTitles: [],
        checkpointSummaries: [],
        systemContextItems: [],
        ...overrides,
    };
}

function renderOverlaysInFakeDom(payload: ReturnType<SidecarRuntimeProvider['buildOverlayPayload']>) {
    const dom = createFakeDomContext();
    vm.runInContext(buildOverlayBootstrapScript(), dom.ctx);
    const res = vm.runInContext(
        buildOverlayUpdateScript(payload, { appComposerRingEnabled: true, appTopBarEnabled: true }),
        dom.ctx,
    ) as { ok: boolean; composerMounted: boolean; topBarMounted: boolean };
    expect(res.ok).toBe(true);
    expect(res.composerMounted).toBe(true);
    expect(res.topBarMounted).toBe(true);
    const composerHost = dom.doc.getElementById(CDP_COMPOSER_HOST_ID)!;
    const topBarHost = dom.doc.getElementById(CDP_TOPBAR_HOST_ID)!;
    // Open TopBar Context view popover so we can verify popover DOM content too
    const ctxPill = topBarHost.shadowRoot!.querySelector('[data-view="context"]');
    if (ctxPill) { ctxPill.click(); }
    return {
        composerHost,
        topBarHost,
        ctxPill,
        composerShadow: composerHost.shadowRoot!,
        topBarShadow: topBarHost.shadowRoot!,
        composerText: composerHost.shadowRoot!.collectText(),
        topBarText: topBarHost.shadowRoot!.collectText(),
    };
}

function createBaseDeps(overrides: Partial<SidecarRuntimeDeps> = {}): Partial<SidecarRuntimeDeps> {
    return {
        discoverLS: async () => makeLS(),
        fetchFullUserStatus: async () => makeUserStatus(),
        getAllTrajectories: async () => [makeTraj('conv-main-001')],
        getContextUsage: async (_ls, tr) => makeUsage(tr, 160_000, 256_000),
        refreshWorkflowImageUsage: async (_ls, u) => u,
        fetchTrajectoryGeneratorMetadata: async () => [makeGmEntry(160_000)],
        fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
        fetchOrchestratorSettings: async () => null,
        fetchUserQuotaSummary: async () => null,
        fetchAvailableModels: async () => null,
        processActivity: async () => false,
        fetchGM: async () => makeGmSummary({ 'conv-main-001': [makeCall({ inputTokens: 160_000, contextTokens: 160_000 })] }),
        revealInOs: async () => {},
        now: () => Date.parse('2026-11-27T10:05:00.000Z'),
        ...overrides,
    };
}

describe('D9 App Runtime Wiring, 4-Surface Observation Parity, Swarm Registry & Compliance', () => {
    const tmpDirs: string[] = [];
    const providers: SidecarRuntimeProvider[] = [];

    function makeTempDir(prefix = 'acm-d9-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tmpDirs.push(dir);
        return dir;
    }

    function makeTempStatePath(): string {
        return path.join(makeTempDir('acm-d9-state-'), 'state-v1.json');
    }

    afterEach(async () => {
        vi.restoreAllMocks();
        while (providers.length > 0) {
            const p = providers.pop();
            if (p) { await p.dispose(); }
        }
        while (tmpDirs.length > 0) {
            const d = tmpDirs.pop();
            if (d) { fs.rmSync(d, { recursive: true, force: true }); }
        }
    });

    // ── 1. 4-Surface Observation Parity (5 Canonical States) ────────────────

    describe('1. Unified PublishedMonitorObservation 4-surface parity', () => {
        it('1a. normal measured conversation (compaction basis): Overview, Native HUD, CDP Topbar & Composer Ring show identical % / denominator / health / revision', async () => {
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps(),
            });
            providers.push(provider);

            await provider.pollNow(true);
            const obs = provider.getLatestObservation()!;
            expect(obs).toBeTruthy();
            expect(Object.isFrozen(obs)).toBe(true);
            expect(obs.subjectCascadeId).toBe('conv-main-001');
            expect(obs.actualBasis).toBe('compaction');
            expect(obs.primaryPct).toBe(62.5);
            expect(obs.compactionLimit).toBe(256_000);
            expect(obs.healthStatus).toBe('healthy');
            expect(obs.isZeroStepFresh).toBe(false);
            expect(obs.isIncomplete).toBe(false);

            const snap = await provider.getSnapshot({ viewMode: 'aux' });
            const docHtml = await provider.renderHtml({ viewMode: 'aux', pathname: '/', isSidecarEnv: true });
            const payload = provider.buildOverlayPayload();
            const dom = renderOverlaysInFakeDom(payload);

            // Exact observation identity propagated across payload & Shadow DOM
            expect(payload.subjectCascadeId).toBe(obs.subjectCascadeId);
            expect(payload.dataRevision).toBe(obs.dataRevision);
            expect(payload.primaryPct).toBe(62.5);
            expect(payload.primaryPctText).toBe('62.5%');
            expect(payload.actualBasis).toBe('compaction');
            expect(dom.topBarHost.getAttribute('data-observation-subject')).toBe('conv-main-001');
            expect(dom.composerHost.getAttribute('data-observation-subject')).toBe('conv-main-001');
            expect(dom.topBarHost.getAttribute('data-observation-data-rev')).toBe(String(obs.dataRevision));
            expect(dom.composerHost.getAttribute('data-observation-data-rev')).toBe(String(obs.dataRevision));
            expect(dom.topBarHost.getAttribute('data-observation-pct')).toBe('62.5%');
            expect(dom.composerHost.getAttribute('data-observation-pct')).toBe('62.5%');
            expect(dom.topBarHost.getAttribute('data-observation-health')).toBe('healthy');
            expect(dom.composerHost.getAttribute('data-observation-health')).toBe('healthy');

            // All 4 surfaces agree on primary percentage (62.5%) and denominator (256k)
            expect(snap.tabs.overview).toContain('62.5%');
            expect(snap.tabs.overview).toContain('256k');
            expect(docHtml).toContain('62.5%');
            expect(docHtml).toContain(`data-observation-subject="conv-main-001"`);
            expect(dom.topBarText).toContain('62.5%');
            expect(dom.topBarText).toContain('256k');
            expect(dom.composerText).toContain('62.5%');
            expect(dom.composerText).toContain('256k');
        });

        it('1b. confirmed 0-step fresh conversation displays 0% & Healthy across all 4 surfaces with zero cross-conversation fallback', async () => {
            const freshTraj = makeTraj('conv-fresh-000', { stepCount: 0 });
            const otherTraj = makeTraj('conv-other-999', { stepCount: 20, lastModifiedTime: '2026-11-27T08:00:00.000Z' });
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [freshTraj, otherTraj],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, tr.cascadeId === 'conv-fresh-000' ? 0 : 180_000, 256_000),
                    fetchTrajectoryGeneratorMetadata: async (_ls, cid) => cid === 'conv-fresh-000' ? [] : [makeGmEntry(180_000)],
                    fetchGM: async () => makeGmSummary({
                        'conv-other-999': [makeCall({ inputTokens: 180_000, contextTokens: 180_000 })],
                    }),
                }),
            });
            providers.push(provider);

            await provider.handleAction({ command: 'selectConversation', cascadeId: 'conv-fresh-000' });
            await provider.pollNow(true);

            const obs = provider.getLatestObservation()!;
            expect(obs.subjectCascadeId).toBe('conv-fresh-000');
            expect(obs.isZeroStepFresh).toBe(true);
            expect(obs.isIncomplete).toBe(false);
            expect(obs.primaryPct).toBe(0);
            expect(obs.healthStatus).toBe('fresh');
            expect(obs.displaySpeedTps).toBeNull();
            expect(obs.sessionCostUsd).toBeNull();

            const snap = await provider.getSnapshot({ viewMode: 'aux' });
            const docHtml = await provider.renderHtml({ viewMode: 'aux', pathname: '/', isSidecarEnv: true });
            const payload = provider.buildOverlayPayload();
            const dom = renderOverlaysInFakeDom(payload);

            expect(payload.isZeroStepFresh).toBe(true);
            expect(payload.isIncomplete).toBe(false);
            expect(payload.primaryPctText).toBe('0%');
            expect(payload.estCostUsd).toBeNull();
            expect(payload.estCostFormatted).toBe('—');
            expect(payload.displaySpeedTps).toBeNull();

            // Overview, Native HUD, Topbar, Composer Ring ALL show 0% and Healthy/Fresh (never other conversation's 180k)
            expect(snap.tabs.overview).toContain('0%');
            expect(snap.tabs.overview).not.toContain('70.3%');
            expect(docHtml).toContain('0%');
            expect(dom.topBarText).toContain('0%');
            expect(dom.topBarText).toMatch(/Healthy|充裕/);
            expect(dom.composerText).toContain('0%');
            expect(dom.composerHost.getAttribute('data-observation-health')).toBe('fresh');
            expect(dom.topBarHost.getAttribute('data-observation-health')).toBe('fresh');
        });

        it('1c. missing/incomplete measurement displays — across all 4 surfaces and NEVER fabricates 0% or Healthy', async () => {
            const incompleteTraj = makeTraj('conv-incomplete-1', { stepCount: 14 });
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [incompleteTraj],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, 0, 256_000, { tokenUsageSource: 'none' }),
                    fetchTrajectoryGeneratorMetadata: async () => [],
                    fetchGM: async () => makeGmSummary({}),
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            const obs = provider.getLatestObservation()!;
            expect(obs.isIncomplete).toBe(true);
            expect(obs.isZeroStepFresh).toBe(false);
            expect(obs.primaryPct).toBeNull();
            expect(obs.healthStatus).toBe('incomplete');

            const snap = await provider.getSnapshot({ viewMode: 'aux' });
            const docHtml = await provider.renderHtml({ viewMode: 'aux', pathname: '/', isSidecarEnv: true });
            const payload = provider.buildOverlayPayload();
            const dom = renderOverlaysInFakeDom(payload);

            expect(payload.isIncomplete).toBe(true);
            expect(payload.primaryPct).toBeNull();
            expect(payload.primaryPctText).toBe('—');
            expect(payload.healthStatus).toBe('incomplete');

            // Topbar pill & Composer ring & Overview MUST show '—', NEVER '0%' or 'Healthy'
            const topBarCtxPillText = dom.ctxPill?.collectText() ?? '';
            expect(topBarCtxPillText).toContain('—');
            expect(topBarCtxPillText).not.toContain('0%');
            expect(dom.topBarHost.getAttribute('data-observation-health')).toBe('incomplete');
            expect(dom.composerHost.getAttribute('data-observation-health')).toBe('incomplete');
            expect(dom.composerText).toContain('—');
            expect(dom.composerText).not.toContain('Healthy');
            expect(dom.composerText).not.toContain('充裕');
            expect(snap.tabs.overview).toContain('—');
            expect(docHtml).toContain('data-observation-health="incomplete"');
        });

        it('1d. overflow (>100%, e.g. 112%) preserves raw overflow text across all 4 surfaces while ONLY geometry clamps to 100%', async () => {
            const overflowTokens = 286_720; // 286,720 / 256,000 = 112.0%
            const traj = makeTraj('conv-overflow-112', { stepCount: 40 });
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [traj],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, overflowTokens, 256_000),
                    fetchTrajectoryGeneratorMetadata: async () => [makeGmEntry(overflowTokens, 0)],
                    fetchGM: async () => makeGmSummary({
                        'conv-overflow-112': [makeCall({ inputTokens: overflowTokens, contextTokens: overflowTokens })],
                    }),
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            const obs = provider.getLatestObservation()!;
            expect(obs.primaryPct).toBe(112);
            expect(obs.primaryPctRaw).toBeCloseTo(112, 4);
            expect(obs.geometryFillPct).toBe(100);
            expect(obs.isOverflow).toBe(true);
            expect(obs.healthStatus).toBe('overflow');

            const snap = await provider.getSnapshot({ viewMode: 'aux' });
            const docHtml = await provider.renderHtml({ viewMode: 'aux', pathname: '/', isSidecarEnv: true });
            const payload = provider.buildOverlayPayload();
            const dom = renderOverlaysInFakeDom(payload);

            expect(payload.primaryPct).toBe(112);
            expect(payload.primaryPctRaw).toBeCloseTo(112, 4);
            expect(payload.primaryPctText).toBe('112%');
            expect(payload.geometryFillPct).toBe(100);

            // All 4 surfaces preserve raw 112% text
            expect(snap.tabs.overview).toContain('112%');
            expect(docHtml).toContain('112%');
            expect(dom.topBarText).toContain('112%');
            expect(dom.composerText).toContain('112%');

            // Geometry ONLY clamps to 100%: SVG arc stroke-dashoffset is 0 (full circle, never negative)
            const composerArc = dom.composerShadow.querySelector('.acm-ring-arc');
            expect(composerArc).toBeTruthy();
            expect(Number(composerArc!.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 2);
            const composerFillBar = dom.composerShadow.querySelector('.acm-meter-fill');
            expect(composerFillBar?.style.width).toBe('100.0%');
        });

        it('1e. native basis preserves axis-aligned markers (200k & compaction on 1M axis) and keeps Compaction warning visible across all 4 surfaces', async () => {
            const usedTokens = 240_000; // 93.8% of 256k compaction, 22.9% of 1,048,576 native
            const traj = makeTraj('conv-native-warn', { stepCount: 32 });
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [traj],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, usedTokens, 256_000),
                    fetchTrajectoryGeneratorMetadata: async () => [makeGmEntry(usedTokens, 0)],
                    fetchGM: async () => makeGmSummary({
                        'conv-native-warn': [makeCall({ inputTokens: usedTokens, contextTokens: usedTokens })],
                    }),
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            // Switch to native basis
            const saveRes = await provider.handleAction({
                command: 'updateSetting',
                key: 'contextPctBasis',
                value: 'native',
            });
            expect(saveRes.ok).toBe(true);

            const obs = provider.getLatestObservation()!;
            expect(obs.requestedBasis).toBe('native');
            expect(obs.actualBasis).toBe('native');
            expect(obs.compactionLimit).toBe(256_000);
            expect(obs.nativeLimit).toBe(1_048_576);
            expect(obs.primaryPct).toBeCloseTo(22.9, 1);
            expect(obs.compactionWarningActive).toBe(true);
            expect(obs.compactionPct).toBeCloseTo(93.8, 1);

            // Threshold markers sit strictly on `native` (1,048,576) axis: 200k -> ~19.1%, 256k compaction -> ~24.4%
            const m200k = obs.markers.find(m => m.tokens === 200_000);
            const mComp = obs.markers.find(m => m.id === 'compaction' || m.id === 'compaction_limit');
            expect(m200k?.axis).toBe('native');
            expect(m200k?.positionPct).toBeCloseTo((200_000 / 1_048_576) * 100, 1);
            expect(mComp?.axis).toBe('native');
            expect(mComp?.positionPct).toBeCloseTo((256_000 / 1_048_576) * 100, 1);

            const snap = await provider.getSnapshot({ viewMode: 'aux' });
            const docHtml = await provider.renderHtml({ viewMode: 'aux', pathname: '/', isSidecarEnv: true });
            const payload = provider.buildOverlayPayload();
            const dom = renderOverlaysInFakeDom(payload);

            expect(payload.actualBasis).toBe('native');
            expect(payload.compactionWarningActive).toBe(true);
            expect(payload.primaryPct).toBeCloseTo(22.9, 1);
            expect(payload.tier200kMarkerPct).toBeCloseTo((200_000 / 1_048_576) * 100, 1);
            expect(payload.compactionThresholdPct).toBeCloseTo((256_000 / 1_048_576) * 100, 1);

            // All 4 surfaces show 22.9% AND surface compaction warning even under native basis
            expect(snap.tabs.overview).toContain('22.9%');
            expect(snap.tabs.overview).toContain('93.8%');
            expect(docHtml).toContain('22.9%');
            expect(docHtml).toContain('data-observation-basis="native"');
            expect(dom.topBarText).toContain('22.9%');
            expect(dom.topBarText).toMatch(/Compaction|压缩/);
            expect(dom.composerText).toContain('22.9%');
            expect(dom.composerText).toMatch(/Compaction|压缩/);
        });
    });

    // ── 2. Per-Window 3-Field Lock State Machine ────────────────────────────

    describe('2. Per-window 3-field lock state machine & topology-aware locking', () => {
        it('reads the requested window and only acknowledges the applied source, intent and backend epoch', async () => {
            const root = makeTraj('main-window-root');
            const other = makeTraj('main-window-other');
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(), autoStart: false, disableCliScan: true, enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [root, other],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, tr.cascadeId === root.cascadeId ? 20_000 : 70_000),
                }),
            });
            providers.push(provider);
            await provider.pollNow(true);
            const send = (windowId: string, conversationId: string | null, source: string, revision: number, extra = {}) =>
                provider.handleAction({ command: 'syncHostFocus', windowId, conversationId, sourceInstanceId: source,
                    focusRevision: revision, fromSdkCallback: true, ...extra });
            await send('first', root.cascadeId, 'old', 20);
            await provider.handleAction({ command: 'setLockToMainAgent', windowId: 'first', enabled: true });
            await send('second', other.cascadeId, 'other', 1);
            expect(provider.getWindowSelectionState('second').lockedRootId).toBeNull();
            expect((await provider.getSnapshot({ windowId: 'first' })).activeConversationId).toBe(root.cascadeId);
            expect((await provider.getSnapshot({ windowId: 'second' })).activeConversationId).toBe(other.cascadeId);
            expect((await send('first', root.cascadeId, 'fresh', 1)).result).toMatchObject({ accepted: true });
            expect((await send('first', other.cascadeId, 'old', 25)).result).toMatchObject({ accepted: false, reason: 'stale_source' });
            expect((await send('first', null, 'fresh', 2, { backendEpoch: 99 })).result).toMatchObject({ accepted: false, reason: 'stale_epoch' });
            expect((await send('first', null, 'fresh', 2, { viewMode: 'sidebar' })).result).toMatchObject({ accepted: false });
            expect((await send('first', null, 'fresh', 2, { isNewConversation: true })).result).toMatchObject({ accepted: true });
            expect((await send('first', null, 'fresh', 2, { conversationCleared: true })).result).toMatchObject({ accepted: false, reason: 'conflicting_revision' });
        });

        it('keeps unseen host and partial step measurements unavailable; unchanged readers share one frozen revision', async () => {
            const tr = makeTraj('partial-one');
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(), autoStart: false, disableCliScan: true, enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [tr],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, 55_000, 256_000, { hasGaps: true }),
                }),
            });
            providers.push(provider);
            await provider.pollNow(true);
            const obs = provider.getLatestObservation()!;
            expect(obs).toMatchObject({ primaryPct: null, isIncomplete: true, isZeroStepFresh: false });
            provider.buildOverlayPayload(obs.observedAtMs + 500);
            expect(provider.getLatestObservation()).toBe(obs);
            await provider.handleAction({ command: 'syncHostFocus', conversationId: 'unseen-existing', focusRevision: 1 });
            expect(provider.getLatestObservation()).toMatchObject({ subjectCascadeId: 'unseen-existing', isZeroStepFresh: false, primaryPct: null });
            await provider.handleAction({ command: 'syncHostFocus', conversationId: null, isNewConversation: true, focusRevision: 2 });
            expect(provider.getLatestObservation()).toMatchObject({ isZeroStepFresh: true, primaryPct: 0 });
        });

        it('reuses member metadata and reads a verified contiguous tail without downloading a long transcript', async () => {
            const offsets: number[] = [];
            const server = createServer(async (req, res) => {
                let body = '';
                for await (const chunk of req) { body += chunk; }
                const offset = Number(JSON.parse(body).stepOffset);
                offsets.push(offset);
                res.setHeader('Content-Type', 'application/json');
                const steps = Array.from({ length: Math.max(0, 200 - offset) }, (_, i) => ({
                    stepIndex: offset + i,
                    type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                    plannerResponse: { response: 'fixture' },
                    metadata: { generatorModel: 'MODEL_PLACEHOLDER_M37', modelUsage: {
                        model: 'MODEL_PLACEHOLDER_M37', inputTokens: 50_000, outputTokens: 100,
                    } },
                }));
                res.end(JSON.stringify({ steps }));
            });
            try {
                await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
                const address = server.address();
                if (!address || typeof address === 'string') { throw new Error('Missing local test port'); }
                const ls: LSInfo = { pid: 1, port: address.port, useTls: false, csrfToken: 'fixture' };
                const gm = vi.fn(async () => ({ ok: true, metadata: [{ stepIndices: [199] }] }));
                expect(await readUnlistedMemberStepCount(ls, 'worker', undefined, gm)).toBe(200);
                const usage = await getContextUsage(ls, makeTraj('worker', { manifestMember: true, stepCount: 200 }));
                expect(usage).toMatchObject({ contextUsed: 50_100, hasGaps: true, suffixRecovered: true, suffixStartOffset: 188 });
                expect(offsets).toEqual([200, 188]);
                expect(gm).toHaveBeenCalledOnce();
            } finally {
                server.closeAllConnections();
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        });

        it('measures unlisted members of the selected manifest, retains an inspected worker through a transient failure, and withdraws removed members', async () => {
            const brainDir = makeTempDir('acm-member-inventory-');
            const root = 'root-inspect', worker = 'worker-inspect', killed = 'worker-killed';
            const rootManifest = path.join(brainDir, root, '.system_generated', 'swarm', 'members.json');
            const writeGroup = (rootId: string, members: Record<string, object>) => {
                const dir = path.join(brainDir, rootId, '.system_generated', 'swarm');
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, 'members.json'), JSON.stringify({ members: {
                    coordinator: { conversation_id: rootId, role: 'coordinator' }, ...members,
                } }));
            };
            writeGroup(root, {
                builder: { conversation_id: worker, role: 'worker', phase: 'RUNNING' },
                completed: { conversation_id: killed, role: 'worker', killed: true, phase: 'KILLED' },
            });
            writeGroup('unrelated', { unknown: { conversation_id: 'unrelated-worker', role: 'worker' } });
            let now = Date.parse('2026-11-27T10:05:00Z');
            let fail = false;
            let workerIndexed = false;
            const queried: string[] = [];
            const gmInputs: TrajectorySummary[][] = [];
            const provider = createSidecarRuntimeProvider({
                brainDir, statePath: makeTempStatePath(), autoStart: false, disableCliScan: true, enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    now: () => now,
                    getAllTrajectories: async () => [
                        ...(workerIndexed ? [makeTraj(worker, { summary: worker, stepCount: 44, status: CascadeStatus.RUNNING })] : []),
                        makeTraj(root),
                    ],
                    readUnlistedMemberStepCount: async (_ls, id) => {
                        queried.push(id);
                        if (fail) { throw new Error('temporarily unavailable'); }
                        return id === worker ? 42 : 19;
                    },
                    fetchGM: async (_ls, trs) => {
                        gmInputs.push(trs);
                        return makeGmSummary({});
                    },
                }),
            });
            providers.push(provider);
            await provider.pollNow(true);
            expect(queried.sort()).toEqual([killed, worker].sort());
            expect(provider.getState().activeConversationId).toBe(root);
            expect(gmInputs[0]).toContainEqual(expect.objectContaining({ cascadeId: worker, manifestMember: true, stepCount: 42 }));
            await provider.handleAction({ command: 'inspectMember', cascadeId: worker });
            expect(provider.getLatestObservation()).toMatchObject({ subjectCascadeId: worker, rootCascadeId: root });
            fail = true;
            now += 31_000;
            await provider.pollNow(true);
            expect(provider.getState().allTrajectories.find(tr => tr.cascadeId === worker)?.stepCount).toBe(42);
            expect(provider.getLatestObservation()?.subjectCascadeId).toBe(worker);
            expect(queried.filter(id => id === killed)).toHaveLength(1);
            fail = false;
            now += 31_000;
            await provider.pollNow(true);
            expect(queried.filter(id => id === worker)).toHaveLength(3);
            await provider.handleAction({ command: 'clearInspect' });
            workerIndexed = true;
            await provider.pollNow(true);
            expect(provider.getState().allTrajectories.find(tr => tr.cascadeId === worker)).toMatchObject({
                summary: 'builder', isSubagent: true, stepCount: 44, manifestMember: true,
            });
            expect(provider.getState().activeConversationId).toBe(root);
            workerIndexed = false;
            fs.unlinkSync(rootManifest);
            await provider.pollNow(true);
            expect(provider.getState().allTrajectories.map(tr => tr.cascadeId)).toEqual([root]);
            expect(queried).not.toContain('unrelated-worker');
        });

        it('anchors synchronously to root, blocks passive hijacks, preserves lock on 1-poll glitch, and supports inspect/clearInspect/retarget + multi-window isolation', async () => {
            const brainDir = makeTempDir('acm-d9-brain-lock-');
            const rootId = '11111111-1111-4111-8111-111111111111';
            const workerId = '22222222-2222-4222-8222-222222222222';
            const otherMainId = '33333333-3333-4333-8333-333333333333';
            const thirdMainId = '44444444-4444-4444-8444-444444444444';

            // Authoritative swarm manifest linking rootId -> workerId
            const swarmDir = path.join(brainDir, rootId, '.system_generated', 'swarm');
            fs.mkdirSync(swarmDir, { recursive: true });
            fs.writeFileSync(path.join(swarmDir, 'members.json'), JSON.stringify({
                title: 'Lock Test Swarm',
                members: {
                    coordinator: { conversation_id: rootId, role: 'coordinator', model: 'MODEL_PLACEHOLDER_M37' },
                    builder: { conversation_id: workerId, role: 'worker', model: 'MODEL_PLACEHOLDER_M37' },
                },
            }));

            let liveTrajs: TrajectorySummary[] = [
                makeTraj(rootId, { stepCount: 20, lastModifiedTime: '2026-11-27T10:00:00.000Z' }),
                makeTraj(workerId, { stepCount: 8, lastModifiedTime: '2026-11-27T10:01:00.000Z', status: CascadeStatus.RUNNING }),
                makeTraj(otherMainId, { stepCount: 5, lastModifiedTime: '2026-11-27T09:30:00.000Z' }),
            ];

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                brainDir,
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => liveTrajs,
                    getContextUsage: async (_ls, tr) => makeUsage(tr, 80_000, 256_000),
                }),
            });
            providers.push(provider);

            await provider.pollNow(true);
            // Focus on worker first, then enable Lock-to-Main -> MUST walk topology upward to rootId!
            await provider.handleAction({ command: 'syncHostFocus', conversationId: workerId, windowId: 'win-a', focusRevision: 1, viewMode: 'aux' });
            const lockRes = await provider.handleAction({ command: 'setLockToMainAgent', enabled: true, windowId: 'win-a' });
            expect(lockRes.ok).toBe(true);
            expect(provider.getState().lockToMainAgent).toBe(true);
            expect(provider.getState().lockedMainId).toBe(rootId);
            expect(provider.getState().activeConversationId).toBe(rootId);
            expect(provider.getWindowSelectionState('win-a').lockedRootId).toBe(rootId);

            // Multi-window isolation: win-b observes otherMainId without disturbing win-a lock
            await provider.handleAction({
                command: 'syncHostFocus',
                conversationId: otherMainId,
                windowId: 'win-b',
                focusRevision: 1,
                viewMode: 'aux',
                isFocusedPane: false,
            });
            expect(provider.getWindowSelectionState('win-b').observedHostFocus?.cascadeId).toBe(otherMainId);
            expect(provider.getWindowSelectionState('win-b').lockedRootId).toBeNull();
            expect(provider.getWindowSelectionState('win-a').lockedRootId).toBe(rootId);

            // Passive hijacks MUST NOT break lock on win-a:
            // (a) blank new chat
            await provider.handleAction({ command: 'syncHostFocus', conversationId: null, isNewConversation: true, windowId: 'win-a', focusRevision: 2, viewMode: 'aux' });
            expect(provider.getState().activeConversationId).toBe(rootId);
            // (b) SIDEBAR null focus
            await provider.handleAction({ command: 'syncHostFocus', conversationId: null, conversationCleared: true, windowId: 'win-a', focusRevision: 3, viewMode: 'sidebar' });
            expect(provider.getState().activeConversationId).toBe(rootId);
            // (c) CDP passive inferred guesses
            const passive = await provider.handleOverlayAction({ command: 'focusConversation', source: 'topbar', conversationId: otherMainId, isNewConversation: false });
            expect(passive.result).toMatchObject({ accepted: false });
            expect(provider.getState().activeConversationId).toBe(rootId);

            // inspectMember displays worker while preserving lockedRootId!
            const inspRes = await provider.handleAction({ command: 'inspectMember', cascadeId: workerId, windowId: 'win-a' });
            expect(inspRes.ok).toBe(true);
            expect(provider.getState().activeConversationId).toBe(workerId);
            expect(provider.getState().inspectedMemberId).toBe(workerId);
            expect(provider.getState().lockedMainId).toBe(rootId);

            // clearInspect ("Back to Main") restores lockedRootId immediately
            const backRes = await provider.handleAction({ command: 'clearInspect', windowId: 'win-a' });
            expect(backRes.ok).toBe(true);
            expect(provider.getState().inspectedMemberId).toBeNull();
            expect(provider.getState().activeConversationId).toBe(rootId);

            // Transient 1-poll absence preserves lockedRootId with lockPendingUnavailable: true (NOT evicted!)
            liveTrajs = [
                makeTraj(workerId, { stepCount: 9 }),
                makeTraj(otherMainId, { stepCount: 6 }),
                makeTraj(thirdMainId, { stepCount: 4, lastModifiedTime: '2026-11-27T09:15:00.000Z' }),
            ];
            await provider.pollNow(false);
            expect(provider.getState().lockedMainId).toBe(rootId);
            expect(provider.getState().lockPendingUnavailable).toBe(true);

            // 2nd consecutive missing poll confirms deletion -> re-anchors to remaining main (NEVER workerId!)
            await provider.pollNow(false);
            expect(provider.getState().lockedMainId).toBe(otherMainId);
            expect(provider.getState().lockPendingUnavailable).toBe(false);

            // Explicit retargetLockedRoot updates lockedRootId cleanly to thirdMainId
            const retargetRes = await provider.handleAction({ command: 'retargetLockedRoot', cascadeId: thirdMainId, windowId: 'win-a' });
            expect(retargetRes.ok).toBe(true);
            expect(provider.getState().lockedMainId).toBe(thirdMainId);
            expect(provider.getState().activeConversationId).toBe(thirdMainId);
        });
    });

    // ── 3. Authoritative Read-Only Swarm Registry, Scheduler (<=3) & Group Cost ──

    describe('3. Authoritative read-only swarm registry, fair-budget scheduler & group cost deduplication', () => {
        it('reads ONLY allowlisted members.json/swarm.json (NEVER board.jsonl/transcript.jsonl/steps/), caps concurrency <= 3, round-robins 20+ workers, and deduplicates group cost', async () => {
            const brainDir = makeTempDir('acm-d9-swarm-22-');
            const rootId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
            const workerIds = Array.from({ length: 22 }, (_, i) =>
                `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}`,
            );

            // Create allowlisted members.json + forbidden files that MUST NEVER be opened
            const swarmDir = path.join(brainDir, rootId, '.system_generated', 'swarm');
            const logsDir = path.join(brainDir, rootId, '.system_generated', 'logs');
            const stepsDir = path.join(brainDir, rootId, '.system_generated', 'steps');
            fs.mkdirSync(swarmDir, { recursive: true });
            fs.mkdirSync(logsDir, { recursive: true });
            fs.mkdirSync(stepsDir, { recursive: true });

            const membersMap: Record<string, unknown> = {
                coordinator: { conversation_id: rootId, role: 'coordinator', model: 'MODEL_PLACEHOLDER_M37' },
            };
            workerIds.forEach((wid, idx) => {
                membersMap[`worker-${idx + 1}`] = {
                    conversation_id: wid,
                    role: 'worker',
                    model: 'MODEL_PLACEHOLDER_M37',
                };
            });
            fs.writeFileSync(path.join(swarmDir, 'members.json'), JSON.stringify({ title: '22-Worker Swarm', members: membersMap }));
            fs.writeFileSync(path.join(swarmDir, 'board.jsonl'), '{"secret":"DO_NOT_READ_BOARD"}\n');
            fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), '{"secret":"DO_NOT_READ_TRANSCRIPT"}\n');
            fs.writeFileSync(path.join(brainDir, rootId, 'plan.json'), '{"secret":"DO_NOT_READ_PLAN"}');
            fs.writeFileSync(path.join(stepsDir, 'step-0.json'), '{"secret":"DO_NOT_READ_STEPS"}');

            const openedPaths: string[] = [];
            const origOpen = fs.promises.open;
            vi.spyOn(fs.promises, 'open').mockImplementation(async (p, ...rest) => {
                openedPaths.push(String(p));
                return origOpen(p, ...rest);
            });

            const trajectories: TrajectorySummary[] = [
                makeTraj(rootId, { stepCount: 15, status: CascadeStatus.RUNNING }),
                ...workerIds.map((wid, idx) => makeTraj(wid, { stepCount: 4 + idx, status: CascadeStatus.RUNNING })),
            ];

            let currentInFlight = 0;
            let maxObservedConcurrency = 0;
            const polledMemberIds = new Set<string>();
            const polledPerTick: string[][] = [];
            let currentTickList: string[] = [];

            const inspectedTarget = workerIds[17]; // worker #18 — must be prioritized immediately!
            let nowMs = Date.parse('2026-11-27T11:00:00.000Z');

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                brainDir,
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                swarmPollBudget: {
                    maxConcurrency: 3,
                    maxRequests: 8,
                    maxPages: 8,
                    maxBytes: 1024 * 1024,
                    maxElapsedMs: 5_000,
                },
                deps: createBaseDeps({
                    now: () => nowMs,
                    getAllTrajectories: async () => trajectories,
                    getContextUsage: async (_ls, tr) => makeUsage(tr, 50_000, 256_000),
                    fetchTrajectoryGeneratorMetadataResult: async (_ls, cid) => {
                        currentInFlight++;
                        if (currentInFlight > maxObservedConcurrency) {
                            maxObservedConcurrency = currentInFlight;
                        }
                        currentTickList.push(cid);
                        polledMemberIds.add(cid);
                        await new Promise(resolve => setTimeout(resolve, 2));
                        currentInFlight--;
                        return { ok: true, metadata: [makeGmEntry(50_000)] };
                    },
                    // Include duplicate executionId across root & worker-1 + unpriced model on worker-2
                    fetchGM: async () => makeGmSummary({
                        [rootId]: [
                            makeCall({ executionId: 'exec-root-only', inputTokens: 100_000, outputTokens: 1_000 }),
                            makeCall({ executionId: 'exec-shared-dup', inputTokens: 50_000, outputTokens: 500 }),
                        ],
                        [workerIds[0]]: [
                            makeCall({ executionId: 'exec-shared-dup', inputTokens: 50_000, outputTokens: 500 }),
                            makeCall({ executionId: 'exec-worker-1', inputTokens: 80_000, outputTokens: 800 }),
                        ],
                        [workerIds[1]]: [
                            makeCall({
                                executionId: 'exec-unpriced',
                                model: 'UNKNOWN_PRIVATE_MODEL_XYZ',
                                modelDisplay: 'Unknown Private Model',
                                inputTokens: 20_000,
                                outputTokens: 200,
                            }),
                        ],
                    }),
                }),
            });
            providers.push(provider);

            // Inspect worker #18 before running scheduler ticks
            await provider.pollNow(true);
            await provider.handleAction({ command: 'setLockToMainAgent', enabled: true });
            await provider.handleAction({ command: 'inspectMember', cascadeId: inspectedTarget });

            // Run 5 ticks to rotate through all 23 members (1 coordinator + 22 workers)
            for (let t = 0; t < 5; t++) {
                nowMs += 5_000;
                currentTickList = [];
                await provider.pollNow(false);
                polledPerTick.push([...currentTickList]);
            }

            // 0. Topology and scheduler state checks
            const topo = provider.getSwarmTopology();
            expect(topo.groupsByRootId.get(rootId)?.memberIds.length).toBe(23);
            expect(provider.getState().lastSwarmPollTick).toBeTruthy();

            // 1. Privacy / §1.2 allowlist guarantee: ZERO forbidden files opened
            expect(openedPaths.some(p => p.endsWith('members.json'))).toBe(true);
            expect(openedPaths.some(p => /board\.jsonl|transcript\.jsonl|plan\.json|steps[\\/]/.test(p))).toBe(false);

            // 2. Hard concurrency cap <= 3
            expect(maxObservedConcurrency).toBeGreaterThan(0);
            expect(maxObservedConcurrency).toBeLessThanOrEqual(3);

            // 3. Coordinator & inspectedMember prioritized in first scheduled tick after inspect
            expect(polledPerTick[0]).toContain(rootId);
            expect(polledPerTick[0]).toContain(inspectedTarget);

            // 4. Starvation-free round-robin covers all 23 members across ticks
            expect(polledMemberIds.has(rootId)).toBe(true);
            for (const wid of workerIds) {
                expect(polledMemberIds.has(wid)).toBe(true);
            }
            const lastTick = provider.getState().lastSwarmPollTick!;
            expect(lastTick.totalActiveMembers).toBe(23);
            expect(lastTick.observedActiveMembers).toBe(23);
            expect(lastTick.coverageRatio).toBe(1);
            for (const id of workerIds) {
                expect(topo.nodesById.get(id)).toMatchObject({ lastObservedAt: expect.any(Number), measuredModel: 'MODEL_PLACEHOLDER_M37', contextPct: expect.any(Number) });
            }
            // Single tick with maxRequests=8 across 23 members accurately reports deferred partialCoverage while cumulative coverageRatio reaches 1
            expect(lastTick.partialCoverage).toBe(true);
            expect(Object.keys(lastTick.lastObservedAtByCascade).length).toBe(23);

            // 5. Deduplicated group cost separates coordinator vs worker direct & tracks unpriced calls
            const groupCost = provider.getSwarmGroupCost()!;
            expect(groupCost).toBeTruthy();
            expect(groupCost.rootId).toBe(rootId);
            expect(groupCost.duplicateCallsDeduplicated).toBe(1); // exec-shared-dup deduplicated once!
            expect(groupCost.uniqueCallCount).toBe(4);
            expect(groupCost.unpricedCallCount).toBe(1); // UNKNOWN_PRIVATE_MODEL_XYZ
            expect(groupCost.hasUnpricedCalls).toBe(true);
            expect(groupCost.coordinatorDirectCostUsd).toBeGreaterThan(0);
            expect(groupCost.workersDirectCostUsd).toBeGreaterThan(0);
            // Inclusive group cost deduplicates the shared call, so it is strictly less than naive sum!
            expect(groupCost.inclusiveGroupCostUsd).toBeGreaterThan(0);
            expect(groupCost.inclusiveGroupCostUsd).toBeLessThan(
                groupCost.coordinatorDirectCostUsd + groupCost.workersDirectCostUsd,
            );
        });
    });

    // ── 4. Shared Core Consumption, Atomic Settings & §1.2 Compliance ───────

    describe('4. Shared core consumption, atomic field-level settings, legacy lock migration & §1.2 compliance', () => {
        it('4a. rejects stale pre-rewind GM high-water context via shared gm-context-fallback', async () => {
            let currentSteps = 20;
            let liveContextUsed = 200_000;
            const trajId = 'conv-rewind-1';
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps({
                    getAllTrajectories: async () => [makeTraj(trajId, { stepCount: currentSteps })],
                    getContextUsage: async (_ls, tr) => makeUsage(tr, liveContextUsed, 256_000, { isEstimated: true }),
                    fetchTrajectoryGeneratorMetadata: async () => [makeGmEntry(liveContextUsed)],
                    // Stale GM cache still holds pre-rewind 220k call at stepIndex 18!
                    fetchGM: async () => makeGmSummary({
                        [trajId]: [
                            makeCall({ executionId: 'c-old-hi', inputTokens: 220_000, contextTokensUsed: 220_000, stepIndices: [17, 18], startStepIndex: 17 }),
                        ],
                    }),
                }),
            });
            providers.push(provider);

            // Poll 1: high-water stepCount = 20
            await provider.pollNow(true);
            expect(provider.getState().currentUsage?.contextUsed).toBeGreaterThanOrEqual(200_000);

            // User rewinds back to stepCount = 4 (real context is now 30k); stale GM entry at step 17 MUST be rejected!
            currentSteps = 4;
            liveContextUsed = 30_000;
            await provider.pollNow(true);
            expect(provider.getState().currentUsage?.contextUsed).toBe(30_000);
            currentSteps = 5;
            await provider.pollNow(true);
            expect(provider.getState().currentUsage?.contextUsed).toBe(30_000);
            expect(provider.getState().contextBreakdown?.measurementState).not.toBe('estimated_rewind');
        });

        it('4b. supports all 10 currencies incl. CAD + customFxCurrency binding without clobbering concurrent disk settings', async () => {
            const statePath = makeTempStatePath();
            const provider = createSidecarRuntimeProvider({
                statePath,
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps(),
            });
            providers.push(provider);

            // Set JPY + custom FX rate 155 -> bound to JPY
            await provider.handleAction({ command: 'updateSettings', settings: { displayCurrency: 'JPY', customFxRate: 155 } });
            expect(provider.getAppSettings().displayCurrency).toBe('JPY');
            expect(provider.getAppSettings().customFxRate).toBe(155);
            expect(provider.getAppSettings().customFxCurrency).toBe('JPY');

            // Simulate external concurrent writer updating lockToMainAgent & contextPctBasis on disk
            const rawDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            rawDisk.global = rawDisk.global || {};
            rawDisk.global.appSettings = {
                ...(rawDisk.global.appSettings || {}),
                lockToMainAgent: true,
                contextPctBasis: 'native',
            };
            fs.writeFileSync(statePath, JSON.stringify(rawDisk, null, 2), 'utf8');

            // Switch currency to CAD -> clears stale JPY FX rate AND preserves concurrent disk settings!
            const cadRes = await provider.handleAction({ command: 'updateSetting', key: 'displayCurrency', value: 'CAD' });
            expect(cadRes.ok).toBe(true);
            expect(provider.getAppSettings().displayCurrency).toBe('CAD');
            expect(provider.getAppSettings().customFxRate).toBeNull();
            expect(provider.getAppSettings().customFxCurrency).toBeNull();

            const afterDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            expect(afterDisk.global.appSettings.displayCurrency).toBe('CAD');
            expect(afterDisk.global.appSettings.lockToMainAgent).toBe(true);
            expect(afterDisk.global.appSettings.contextPctBasis).toBe('native');

            // Bind CAD custom FX rate
            await provider.handleAction({ command: 'updateSetting', key: 'customFxRate', value: 1.38 });
            expect(provider.getAppSettings().displayCurrency).toBe('CAD');
            expect(provider.getAppSettings().customFxRate).toBe(1.38);
            expect(provider.getAppSettings().customFxCurrency).toBe('CAD');
        });

        it('4c. performs single-time migration of legacy lockToMainAgent key without re-locking after user disables it', async () => {
            const statePath = makeTempStatePath();
            // Seed legacy globalState.lockToMainAgent = true (pre-v1.18 format)
            const seed = createFastDurableState(statePath);
            await seed.globalBucket().update('lockToMainAgent', true);
            await seed.flush();

            const p1 = createSidecarRuntimeProvider({
                statePath,
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps(),
            });
            providers.push(p1);

            expect(p1.getState().lockToMainAgent).toBe(true);
            expect(p1.getAppSettings().legacyLockMigrated).toBe(true);

            // User explicitly disables lock
            await p1.handleAction({ command: 'setLockToMainAgent', enabled: false });
            expect(p1.getState().lockToMainAgent).toBe(false);
            await p1.dispose();

            // Restart with same statePath: MUST stay unlocked (migration must NOT run a second time!)
            const p2 = createSidecarRuntimeProvider({
                statePath,
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps(),
            });
            providers.push(p2);
            expect(p2.getState().lockToMainAgent).toBe(false);
            expect(p2.getAppSettings().legacyLockMigrated).toBe(true);
        });

        it('4d. Settings & About tabs use shared runtime version and contain zero absolutist ToS-compliance claims (§1.2)', async () => {
            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: createBaseDeps(),
            });
            providers.push(provider);

            await provider.pollNow(true);
            const snap = await provider.getSnapshot({ viewMode: 'sidebar' });
            const docHtml = await provider.renderHtml({ viewMode: 'sidebar', pathname: '/full', isSidecarEnv: true });
            const combined = `${docHtml}\n${snap.tabs.about}`;

            expect(combined).toContain(getRuntimeVersion());
            expect(combined).not.toMatch(/100%\s*ToS[- ]safe/i);
            expect(combined).not.toMatch(/100%\s*Antigravity\s*ToS[- ]compliant/i);
            expect(combined).not.toContain('100% 合规');
            expect(docHtml).toContain('CAD');
        });
    });
});

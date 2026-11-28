/**
 * Independent browser Shadow DOM overlay runtime for Antigravity App opt-in CDP injection.
 *
 * Compiled and typechecked under `tsconfig.client.json` (`lib: ["ES2022", "DOM", "DOM.Iterable"]`)
 * and bundled via `esbuild` into a self-contained browser IIFE with deterministic content-hash `buildId`.
 *
 * Security & Trusted Types Contract (NON-NEGOTIABLE):
 * - Strictly builds every DOM and SVG node via `document.createElement`,
 *   `document.createElementNS`, `textContent`, and `setAttribute`.
 * - Single authoritative `isInsideUnfocusedPane()` helper (eliminates duplicate declaration).
 * - Checks BOTH `version` and content-hash `buildId` so same-version rebuilds hot-reinject cleanly.
 */

import { projectQuotaDisplay } from '../../quota-runway';
import type {
    CdpOverlayApplyResult,
    CdpOverlayFontSizePreset,
    CdpOverlayGlobalHandle,
    CdpOverlayMountConfig,
    CdpOverlayMountResult,
    CdpOverlayRuntimePayload,
    CdpOverlayRuntimeToggles,
    CdpOverlaySlot,
    CdpOverlaySwarmSummary,
    CdpTopBarViewKey,
    NavigatorWithWco,
    PopoverCapableElement,
    WindowControlsOverlayLike,
} from './cdp-overlay-types';

interface CdpOverlayD9Marker {
    id: string;
    label: string;
    tokens: number;
    axis: 'compaction' | 'native';
    positionPct: number;
    exceeded: boolean;
}

interface CdpOverlayD9Payload extends CdpOverlayRuntimePayload {
    cascadeId?: string | null;
    selectionRevision?: number;
    dataRevision?: number;
    subjectCascadeId?: string | null;
    rootCascadeId?: string | null;
    subjectKind?: 'main' | 'worker' | 'subagent';
    actualBasis?: 'compaction' | 'native';
    requestedBasis?: 'compaction' | 'native';
    primaryPct?: number | null;
    primaryPctRaw?: number | null;
    primaryPctText?: string;
    geometryFillPct?: number;
    healthStatus?: 'fresh' | 'healthy' | 'elevated' | 'high_pressure' | 'overflow' | 'incomplete';
    isZeroStepFresh?: boolean;
    isIncomplete?: boolean;
    compactionWarningActive?: boolean;
    compactionWarningLevel?: 'none' | 'elevated' | 'critical' | 'overflow';
    compactionPct?: number | null;
    measuredModel?: string | null;
    speedMode?: 'decode' | 'e2e';
    speedSampleScope?: 'latest_call' | 'conversation_weighted' | 'none';
    speedCallId?: string | null;
    displaySpeedTps?: number | null;
    markers?: readonly CdpOverlayD9Marker[];
}

interface ResolvedOverlayContextView {
    isIncomplete: boolean;
    isZeroStepFresh: boolean;
    actualBasis: 'compaction' | 'native';
    rawPct: number | null;
    geometryFillPct: number;
    pctText: string;
    ringCenterText: string;
    pillPctText: string;
    severity: 'incomplete' | 'normal' | 'warn' | 'danger';
    healthStatus: 'fresh' | 'healthy' | 'elevated' | 'high_pressure' | 'overflow' | 'incomplete';
    badgeLabel: string;
    badgeCls: string;
    compactionWarningActive: boolean;
    compactionWarningLevel: 'none' | 'elevated' | 'critical' | 'overflow';
    usedTokens: number | null;
    denominatorTokens: number | null;
    capTokensText: string;
    remainingTokens: number | null;
    compactionMarkerPct: number | null;
    tier200kMarkerPct: number | null;
    subjectCascadeId: string;
    dataRevision: number;
}

interface KvPairRefs {
    row: HTMLDivElement;
    k: HTMLSpanElement;
    v: HTMLSpanElement;
}

interface ComposerSlotRefs {
    trigger: HTMLButtonElement;
    arc: SVGElement;
    pctCenter: HTMLSpanElement;
    popover: PopoverCapableElement;
    titleEl: HTMLDivElement;
    healthBadge: HTMLSpanElement;
    pinBadge: HTMLSpanElement;
    modelNameEl: HTMLDivElement;
    pctHeroEl: HTMLDivElement;
    meterFill: HTMLDivElement;
    tickCompaction: HTMLDivElement;
    tick200k: HTMLDivElement;
    capTokens: HTMLSpanElement;
    capWatermarks: HTMLSpanElement;
    compactRow: HTMLDivElement;
    compactLabel: HTMLSpanElement;
    compactBadge: HTMLSpanElement;
    perfLabel: HTMLDivElement;
    speedModeTag: HTMLSpanElement;
    kvSpeed: KvPairRefs;
    kvAvgSpeed: KvPairRefs;
    kvTtft: KvPairRefs;
    cacheLabel: HTMLDivElement;
    kvRecentCh: KvPairRefs;
    kvAvgCh: KvPairRefs;
    kvTurnState: KvPairRefs;
    turnBadge: HTMLSpanElement;
    tcLabel: HTMLDivElement;
    kvCost: KvPairRefs;
    kvInOut: KvPairRefs;
    kvCacheRead: KvPairRefs;
    kvTotal: KvPairRefs;
    swarmSec: HTMLDivElement;
    summaryText: HTMLSpanElement;
    actionFeedback: HTMLSpanElement;
    actionsRow: HTMLDivElement;
    openBtn: HTMLButtonElement;
    refreshBtn: HTMLButtonElement;
}

interface MiniRingRefs {
    svg: SVGElement;
    arc: SVGElement;
}

interface TopBarSlotRefs {
    cluster: HTMLDivElement;
    quotaPill: HTMLButtonElement;
    qRing: MiniRingRefs;
    qPctText: HTMLSpanElement;
    qWinTag: HTMLSpanElement;
    ctxPill: HTMLButtonElement;
    cRing: MiniRingRefs;
    cPctText: HTMLSpanElement;
    speedPill: HTMLButtonElement;
    totalPill: HTMLButtonElement;
    overflowBtn: HTMLButtonElement;
    overflowMenu: PopoverCapableElement;
    wcoSpacer: HTMLDivElement;
    quotaPopover: PopoverCapableElement;
    qpTitle: HTMLDivElement;
    qpMeta: HTMLDivElement;
    qpRefreshBtn: HTMLButtonElement;
    qpOpenBtn: HTMLButtonElement;
    qpCloseBtn: HTMLButtonElement;
    qpTabsBar: HTMLDivElement;
    qpTabs: Record<CdpTopBarViewKey, HTMLButtonElement>;
    qpBody: HTMLDivElement;
    qpFooterTotal: HTMLSpanElement;
    qpFooterFeedback: HTMLSpanElement;
}

interface AnchorPlacement {
    parent: Node;
    before: ChildNode | null;
    mode: 'inline' | 'fixed';
    tier?: string;
}

interface OverlayRuntimeState {
    composerEnabled: boolean;
    topBarEnabled: boolean;
    payload: CdpOverlayRuntimePayload | null;
    composerHost: HTMLDivElement | null;
    composerShadow: ShadowRoot | null;
    composerRefs: ComposerSlotRefs | null;
    composerPinned: boolean;
    composerOpen: boolean;
    composerHoverOpenTimer: ReturnType<typeof setTimeout> | null;
    composerHideTimer: ReturnType<typeof setTimeout> | null;
    topBarHost: HTMLDivElement | null;
    topBarShadow: ShadowRoot | null;
    topBarRefs: TopBarSlotRefs | null;
    topBarAnchorMode: 'inline' | 'fixed';
    topBarAnchorTier: string;
    topBarActiveView: CdpTopBarViewKey | null;
    topBarPinned: boolean;
    topBarHoverOpenTimer: ReturnType<typeof setTimeout> | null;
    topBarHoverCloseTimer: ReturnType<typeof setTimeout> | null;
    topBarWarmUntilMs: number;
    overflowOpen: boolean;
    fontSizePreset: CdpOverlayFontSizePreset;
    highContrast: boolean;
    countdownSec: number | null;
    countdownTimer: ReturnType<typeof setInterval> | null;
    domObserver: MutationObserver | null;
    themeObserver: MutationObserver | null;
    layoutObserver: ResizeObserver | null;
    observedLayoutNodes: Element[];
    reanchorTimer: ReturnType<typeof setTimeout> | null;
    layoutSyncHandle: number | ReturnType<typeof setTimeout> | null;
    layoutSyncIsRaf: boolean;
    sidebarTransitionTimer: ReturnType<typeof setTimeout> | null;
    boundWcoTarget: WindowControlsOverlayLike | null;
    focusSyncTimer: ReturnType<typeof setTimeout> | null;
    focusRevision: number;
    focusDelivery: {
        key: string;
        bridgeUrl: string;
        bridgeToken: string;
        revision: number;
        status: 'ready' | 'sending' | 'accepted';
    } | null;
}

export function mountCdpOverlayRuntime(config: CdpOverlayMountConfig): CdpOverlayMountResult {
    const win = window as unknown as Record<string, CdpOverlayGlobalHandle | undefined>;
    const nav = navigator as NavigatorWithWco;

    const GLOBAL_KEY = config.globalKey;
    const SCRIPT_VERSION = config.scriptVersion;
    const BUILD_ID = config.buildId;
    const COMPOSER_HOST_ID = config.composerHostId;
    const TOPBAR_HOST_ID = config.topBarHostId;
    const COMPOSER_CSS = config.composerCss;
    const TOPBAR_CSS = config.topBarCss;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const RING_RADIUS = 9;
    const RING_CIRC = 2 * Math.PI * RING_RADIUS;
    const MINI_RADIUS = 5.4;
    const MINI_CIRC = 2 * Math.PI * MINI_RADIUS;
    const HOVER_INTENT_DELAY_MS = 250;
    const HOVER_WARM_SIBLING_WINDOW_MS = 350;
    const HOVER_CLOSE_DELAY_MS = 160;

    const existing = win[GLOBAL_KEY];
    if (existing && existing.version === SCRIPT_VERSION && existing.buildId === BUILD_ID) {
        return { installed: true, reused: true, version: SCRIPT_VERSION, buildId: BUILD_ID };
    }
    if (existing && typeof existing.unmount === 'function') {
        try { existing.unmount('all'); } catch { /* ignore */ }
    }

    function el<K extends keyof HTMLElementTagNameMap>(
        tag: K,
        className?: string,
        text?: string | number | null,
    ): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined && text !== null) { node.textContent = String(text); }
        return node;
    }

    function svgEl(tag: string, attrs?: Record<string, string | number>): SVGElement {
        const node = document.createElementNS(SVG_NS, tag);
        if (attrs) {
            const keys = Object.keys(attrs);
            for (let i = 0; i < keys.length; i++) {
                node.setAttribute(keys[i], String(attrs[keys[i]]));
            }
        }
        return node;
    }

    function bi(lang: string | undefined, en: string, zh: string): string {
        if (lang === 'zh') { return zh; }
        if (lang === 'en') { return en; }
        return en === zh ? en : (en + ' / ' + zh);
    }

    function clampNum(v: unknown, min: number, max: number): number {
        const n = Number(v);
        if (!Number.isFinite(n)) { return min; }
        return Math.min(Math.max(n, min), max);
    }

    function formatCompact(n: unknown): string {
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) { return '0'; }
        if (n >= 1e9) { return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; }
        if (n >= 1e6) { return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
        if (n >= 1e3) { return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k'; }
        return String(Math.round(n));
    }

    function formatTtft(ms: unknown): string {
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) { return '—'; }
        if (ms >= 1000) { return (ms / 1000).toFixed(2) + 's'; }
        return Math.round(ms) + 'ms';
    }

    function formatTps(tps: unknown): string {
        if (typeof tps !== 'number' || !Number.isFinite(tps) || tps <= 0) { return '—'; }
        return tps.toFixed(1) + ' tok/s';
    }

    function formatPct(pct: unknown): string {
        if (typeof pct !== 'number' || !Number.isFinite(pct)) { return '—'; }
        return Math.round(pct) + '%';
    }

    function formatUsd(usd: unknown, preformatted?: string): string {
        if (typeof preformatted === 'string' && preformatted.trim()) { return preformatted.trim(); }
        if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) { return '—'; }
        if (usd >= 10) { return '$' + usd.toFixed(2); }
        if (usd >= 0.01) { return '$' + usd.toFixed(2); }
        return '$' + usd.toFixed(4);
    }

    function pad2(n: number): string {
        return n < 10 ? ('0' + n) : String(n);
    }

    function formatLocalClockTime(raw: unknown): string {
        if (raw === null || raw === undefined) { return ''; }
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            const fromNum = new Date(raw);
            if (!isNaN(fromNum.getTime())) {
                return pad2(fromNum.getHours()) + ':' + pad2(fromNum.getMinutes()) + ':' + pad2(fromNum.getSeconds());
            }
            return '';
        }
        const str = String(raw).trim();
        if (!str) { return ''; }
        const hmsMatch = str.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
        if (hmsMatch) {
            return pad2(parseInt(hmsMatch[1], 10)) + ':' + hmsMatch[2] + ':' + hmsMatch[3];
        }
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
            return pad2(parsed.getHours()) + ':' + pad2(parsed.getMinutes()) + ':' + pad2(parsed.getSeconds());
        }
        return str;
    }

    function getTier200kTooltip(lang: string | undefined): string {
        return bi(
            lang,
            '200k long-context tier: API ref rate & latency rise above 200k — not an extra Antigravity subscription charge or hard cutoff',
            '200k 长上下文参考阶梯：超过后延迟可能升高且 API 参考价翻倍，不会对订阅额外扣费或强制截断',
        );
    }

    function getTurnCacheTooltip(lang: string | undefined, turnCacheState: string | undefined): string {
        const tcState = turnCacheState || 'unknown';
        if (tcState === 'warm') {
            return bi(
                lang,
                'Prompt Cache warm (>=70% reused): reuses cached prefix for faster first token & lower API ref cost',
                '热缓存命中（>=70% 复用）：直接复用历史前缀，首字更快且 API 参考费用更低',
            );
        }
        if (tcState === 'partial') {
            return bi(
                lang,
                'Prompt Cache partial (10-70% reused): partial prefix reuse after history edits or compaction',
                '部分缓存命中（10-70% 复用）：仅复用部分前缀（常见于编辑历史或上下文压缩后）',
            );
        }
        if (tcState === 'cold') {
            return bi(
                lang,
                'Prompt Cache cold (<10% reused): prefix re-read on new chat, >5m idle expiry, or model switch',
                '冷启动（<10% 复用）：新对话、静置超 5 分钟过期或切换模型后需重新读取前缀',
            );
        }
        return bi(
            lang,
            'Prompt Cache reuse: >=70% warm (faster), 10-70% partial, <10% cold (new chat / idle / model switch)',
            'Prompt 缓存复用：>=70% 热缓存（首字更快），10-70% 部分命中，<10% 冷启动（新对话/静置过期/切模型）',
        );
    }

    function applyTurnCacheBadgeProps(badgeEl: HTMLElement, lang: string | undefined, turnCacheState: string | undefined): void {
        const tcState = turnCacheState || 'unknown';
        badgeEl.className = 'acm-pill-badge acm-has-tip' + (
            tcState === 'warm' ? ' is-good' : (tcState === 'partial' ? ' is-warn' : (tcState === 'cold' ? ' is-danger' : ''))
        );
        badgeEl.textContent = tcState === 'warm'
            ? bi(lang, 'Warm', '热缓存')
            : (tcState === 'partial'
                ? bi(lang, 'Partial', '部分命中')
                : (tcState === 'cold' ? bi(lang, 'Cold', '冷启动') : '—'));
        const tip = getTurnCacheTooltip(lang, tcState);
        badgeEl.setAttribute('tabindex', '0');
        if (typeof badgeEl.removeAttribute === 'function') { badgeEl.removeAttribute('title'); }
        badgeEl.setAttribute('data-tooltip', tip);
        badgeEl.setAttribute('aria-label', badgeEl.textContent + ' — ' + tip);
    }

    function buildTurnCacheBadge(lang: string | undefined, turnCacheState: string | undefined): HTMLSpanElement {
        const badge = el('span', 'acm-pill-badge acm-has-tip', '');
        applyTurnCacheBadgeProps(badge, lang, turnCacheState);
        return badge;
    }

    function getTargetTabForTopBarView(view: string): string {
        if (view === 'quota') { return 'models'; }
        if (view === 'context') { return 'overview'; }
        if (view === 'speed') { return 'gm'; }
        if (view === 'total') { return 'cost'; }
        return 'models';
    }

    function parseCssColorLuminance(raw: string): number | null {
        const bg = (raw || '').trim().toLowerCase();
        if (!bg || bg === 'transparent' || bg === 'none') { return null; }
        const alphaOk = (s?: string): boolean => !s || ((s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s)) > 0.1);
        const lumRgb = (r: number, g: number, b: number): number | null =>
            (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) ? (0.2126 * r + 0.7152 * g + 0.0722 * b) : null;
        let m = bg.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
        if (m) {
            const h = m[1];
            const s = h.length <= 4;
            const c = (i: number) => parseInt(s ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2), 16);
            if ((h.length === 4 || h.length === 8) && c(3) / 255 <= 0.1) { return null; }
            return lumRgb(c(0) / 255, c(1) / 255, c(2) / 255);
        }
        m = bg.match(/^rgba?\(\s*([\d.]+%?)(?:\s*,\s*|\s+)([\d.]+%?)(?:\s*,\s*|\s+)([\d.]+%?)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/);
        if (m) {
            if (!alphaOk(m[4])) { return null; }
            const ch = (v: string) => v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / 255;
            return lumRgb(ch(m[1]), ch(m[2]), ch(m[3]));
        }
        m = bg.match(/^oklch\(\s*([\d.]+%?)(?:\s+[\d.]+%?){2}(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
        if (m) {
            if (!alphaOk(m[2])) { return null; }
            const l = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
            return Number.isFinite(l) ? l : null;
        }
        m = bg.match(/^color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
        if (m) {
            if (!alphaOk(m[4])) { return null; }
            const u = (v: string) => v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
            return lumRgb(u(m[1]), u(m[2]), u(m[3]));
        }
        m = bg.match(/^(?:hsla?\(\s*)?[\d.]+(?:deg|rad|turn)?(?:\s*,\s*|\s+)[\d.]+%(?:\s*,\s*|\s+)([\d.]+)%(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)?$/);
        if (m && alphaOk(m[2])) {
            const l = parseFloat(m[1]) / 100;
            return Number.isFinite(l) ? l : null;
        }
        return null;
    }

    function detectHostTheme(explicitTheme?: string): 'light' | 'dark' {
        if (explicitTheme === 'light' || explicitTheme === 'dark') { return explicitTheme; }
        try {
            const html = document.documentElement;
            const body = document.body;
            const cls = ((html && html.className) || '') + ' ' + ((body && body.className) || '');
            const dataTheme = (html && html.getAttribute('data-theme'))
                || (body && body.getAttribute('data-theme'))
                || (html && html.getAttribute('data-agy-theme'))
                || (body && body.getAttribute('data-agy-theme'))
                || '';
            const combined = (cls + ' ' + dataTheme).toLowerCase();
            const hasLight = /\b(?:vscode-light|vscode-high-contrast-light|theme-light|light-theme|light)\b/.test(combined);
            const hasDark = /\b(?:vscode-dark|theme-dark|dark-theme|dark)\b/.test(combined);
            if (hasLight && !hasDark) {
                return 'light';
            }
            if (hasDark && !hasLight) {
                return 'dark';
            }
            const colorScheme = String(
                ((html && html.style && html.style.colorScheme) || (body && body.style && body.style.colorScheme) || ''),
            ).toLowerCase();
            if (/\blight\b/.test(colorScheme) && !/\bdark\b/.test(colorScheme)) {
                return 'light';
            }
            if (/\bdark\b/.test(colorScheme) && !/\blight\b/.test(colorScheme)) {
                return 'dark';
            }
            const target = body || html;
            if (target && window.getComputedStyle) {
                const bg = window.getComputedStyle(target).backgroundColor || '';
                const lum = parseCssColorLuminance(bg);
                if (lum !== null) {
                    return lum > 0.55 ? 'light' : 'dark';
                }
            }
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                return 'light';
            }
        } catch { /* ignore */ }
        return 'dark';
    }

    function resolveFontSizePreset(payload: CdpOverlayRuntimePayload | null): CdpOverlayFontSizePreset {
        const raw = payload ? (payload.overlayFontSize || payload.fontSizePreset || '') : '';
        const norm = String(raw).trim().toLowerCase();
        if (norm === 'compact' || norm === 'large') { return norm; }
        return 'normal';
    }

    function detectHostHighContrast(payload: CdpOverlayRuntimePayload | null): boolean {
        const explicitMode = payload ? payload.highContrast : undefined;
        const explicitToggle = payload ? payload.overlayHighContrast : undefined;
        if (explicitMode === true || explicitMode === 'high' || explicitMode === 'true' || explicitToggle === true) {
            return true;
        }
        if (explicitMode === 'normal' || explicitMode === 'false' || explicitMode === false) {
            return false;
        }
        // For highContrast === 'auto', undefined, or overlayHighContrast === false (default off),
        // honor host VS Code high-contrast classes and OS accessibility preferences.
        try {
            const html = document.documentElement;
            const body = document.body;
            const cls = ((html && html.className) || '') + ' ' + ((body && body.className) || '');
            const kind = (html && html.getAttribute('data-vscode-theme-kind'))
                || (body && body.getAttribute('data-vscode-theme-kind'))
                || (html && html.getAttribute('data-contrast'))
                || (body && body.getAttribute('data-contrast'))
                || '';
            if (/\b(?:vscode-high-contrast|vscode-high-contrast-light|high-contrast)\b/i.test(cls + ' ' + kind)) {
                return true;
            }
            if (typeof window.matchMedia === 'function') {
                if (window.matchMedia('(forced-colors: active)').matches) { return true; }
                if (window.matchMedia('(prefers-contrast: more)').matches) { return true; }
            }
        } catch { /* ignore */ }
        return false;
    }

    function preventFocusStealOnMouseDown(node: HTMLElement): void {
        node.addEventListener('mousedown', (ev) => {
            const me = ev as MouseEvent;
            if (me && typeof me.preventDefault === 'function') {
                me.preventDefault();
            }
        });
    }

    function findVisibleAuxSidebarToggle(): HTMLElement | null {
        try {
            const btns = document.querySelectorAll('[data-testid="toggle-aux-sidebar"]');
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i] as HTMLElement;
                if (btn && isElementVisible(btn)) {
                    return btn;
                }
            }
        } catch { /* ignore */ }
        return null;
    }

    function isElementVisible(node: Element | null): boolean {
        if (!node || !node.isConnected) { return false; }
        try {
            let cur: Element | null = node;
            let depth = 0;
            while (cur && cur !== document.documentElement && depth < 64) {
                const htmlCur = cur as HTMLElement;
                if (htmlCur.hidden === true) { return false; }
                if (htmlCur.style && (htmlCur.style.display === 'none' || htmlCur.style.visibility === 'hidden')) {
                    return false;
                }
                let cs: CSSStyleDeclaration | null = null;
                if (typeof window.getComputedStyle === 'function') {
                    cs = window.getComputedStyle(cur);
                    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) {
                        return false;
                    }
                }
                if (typeof cur.getBoundingClientRect === 'function') {
                    const rect = cur.getBoundingClientRect();
                    if (rect && typeof rect.width === 'number' && typeof rect.height === 'number') {
                        if (cur === node) {
                            if (rect.width <= 0 || rect.height <= 0) { return false; }
                        } else if ((!cs || cs.display !== 'contents') && rect.width <= 0 && rect.height <= 0) {
                            return false;
                        }
                    }
                }
                cur = cur.parentElement;
                depth += 1;
            }
        } catch { /* ignore */ }
        return true;
    }

    function isWindowsClient(): boolean {
        try {
            const ua = (nav.userAgent || '') + ' ' + (nav.platform || '');
            return /win/i.test(ua);
        } catch {
            return false;
        }
    }

    function isMacClient(): boolean {
        try {
            const ua = (nav.userAgent || '') + ' ' + (nav.platform || '');
            return /mac|darwin/i.test(ua);
        } catch {
            return false;
        }
    }

    function getSafeRect(node: Element | null | undefined): DOMRect | null {
        if (!node || typeof node.getBoundingClientRect !== 'function') { return null; }
        try {
            const r = node.getBoundingClientRect();
            if (r && typeof r.width === 'number' && typeof r.height === 'number') {
                return r;
            }
        } catch { /* ignore */ }
        return null;
    }

    function getElementChildren(node: Node | null | undefined): Element[] {
        const out: Element[] = [];
        if (!node) { return out; }
        const list = node.childNodes || [];
        for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].nodeType === 1) { out.push(list[i] as Element); }
        }
        return out;
    }

    function containsNode(container: Node | null | undefined, target: Node | null | undefined): boolean {
        if (!container || !target) { return false; }
        if (typeof container.contains === 'function') {
            try { return Boolean(container.contains(target)); } catch { /* ignore */ }
        }
        let cur: Node | null = target;
        while (cur) {
            if (cur === container) { return true; }
            cur = cur.parentNode;
        }
        return false;
    }

    function findAncestor(node: Node | null | undefined, predicate: (cur: Node) => boolean): Node | null {
        let cur: Node | null = node || null;
        while (cur) {
            if (predicate(cur)) { return cur; }
            cur = (cur as Element).parentElement || cur.parentNode;
        }
        return null;
    }

    function openTopLayerPopover(popEl: PopoverCapableElement | null): boolean {
        if (!popEl || typeof popEl.showPopover !== 'function') { return false; }
        try {
            let isOpen = false;
            if (typeof popEl.matches === 'function') {
                try { isOpen = popEl.matches(':popover-open'); } catch { /* ignore */ }
            }
            if (!isOpen) {
                popEl.showPopover();
            }
            return true;
        } catch {
            return false;
        }
    }

    function closeTopLayerPopover(popEl: PopoverCapableElement | null): void {
        if (!popEl || typeof popEl.hidePopover !== 'function') { return; }
        try {
            let isOpen = true;
            if (typeof popEl.matches === 'function') {
                try { isOpen = popEl.matches(':popover-open'); } catch { /* ignore */ }
            }
            if (isOpen) {
                popEl.hidePopover();
            }
        } catch { /* ignore */ }
    }

    function findVisibleTopRightWcoReserve(): { el: Element; rect: DOMRect } | null {
        const vw = window.innerWidth || 1280;
        const reserveSel = '[data-testid="window-controls-reserve"], [data-testid="legacy-window-controls-reserve"]';
        try {
            const reserveEls = document.querySelectorAll(reserveSel);
            for (let i = 0; i < reserveEls.length; i++) {
                const elNode = reserveEls[i];
                if (!elNode || !isElementVisible(elNode)) { continue; }
                const resRect = getSafeRect(elNode);
                if (resRect && resRect.top < 48 && resRect.width > 0 && resRect.width < vw * 0.5 && resRect.right >= vw - 60) {
                    return { el: elNode, rect: resRect };
                }
            }
        } catch { /* ignore */ }
        return null;
    }

    function computeWcoInsetPx(isFixedAnchor: boolean): number {
        if (!isFixedAnchor) {
            return 0;
        }
        const vw = window.innerWidth || 1280;
        const visibleReserve = findVisibleTopRightWcoReserve();
        if (visibleReserve) {
            return Math.round(visibleReserve.rect.width) + 8;
        }
        try {
            if (nav.windowControlsOverlay && nav.windowControlsOverlay.visible) {
                const rect = nav.windowControlsOverlay.getTitlebarAreaRect();
                if (rect && typeof rect.right === 'number' && Number.isFinite(rect.right) && rect.right > 0) {
                    const rightGap = Math.max(0, Math.round(vw - rect.right));
                    if (rightGap === 0) {
                        return 0;
                    }
                    if (rightGap > 0 && rightGap < vw * 0.5) {
                        return rightGap + 8;
                    }
                }
            }
        } catch { /* ignore */ }
        if (isWindowsClient()) {
            return 138;
        }
        return 0;
    }

    function hasLoopbackBridge(payload: CdpOverlayRuntimePayload | null): payload is CdpOverlayRuntimePayload & { bridgeUrl: string; bridgeToken: string } {
        return Boolean(
            payload
            && typeof payload.bridgeUrl === 'string'
            && /^http:\/\/127\.0\.0\.1:\d+$/.test(payload.bridgeUrl)
            && typeof payload.bridgeToken === 'string'
            && payload.bridgeToken,
        );
    }

    function sendBridgeAction(
        payload: CdpOverlayRuntimePayload | null,
        command: string,
        source: string,
        feedbackEl: HTMLElement | null,
        extra?: Record<string, unknown>,
        onResult?: (ok: boolean, receipt?: { accepted?: boolean; ackFocusRevision?: number }) => void,
    ): void {
        if (!hasLoopbackBridge(payload)) {
            if (onResult) { onResult(false); }
            return;
        }
        try {
            const bodyObj: Record<string, unknown> = { command, source };
            if (extra && typeof extra === 'object') {
                const extraKeys = Object.keys(extra);
                for (let i = 0; i < extraKeys.length; i++) {
                    const k = extraKeys[i];
                    if (extra[k] !== undefined) {
                        bodyObj[k] = extra[k];
                    }
                }
            }
            fetch(payload.bridgeUrl + '/api/overlay/action', {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Monitor-Token': payload.bridgeToken,
                },
                body: JSON.stringify(bodyObj),
            }).then(async (res) => {
                const isOk = Boolean(res && res.ok);
                if (feedbackEl) {
                    feedbackEl.textContent = isOk
                        ? bi(payload.language || 'both', 'Sent', '已发送')
                        : bi(payload.language || 'both', 'Unavailable', '不可用');
                }
                if (onResult) {
                    const body = isOk ? await res.json() : null;
                    onResult(isOk && body?.ok === true, body?.result);
                }
            }).catch(() => {
                if (feedbackEl) {
                    feedbackEl.textContent = bi(payload.language || 'both', 'Offline', '未连接');
                }
                if (onResult) { onResult(false); }
            });
        } catch {
            if (onResult) { onResult(false); }
        }
    }

    function triggerOpenPanelAction(
        payload: CdpOverlayRuntimePayload | null,
        source: string,
        feedbackEl: HTMLElement | null,
        targetTab?: string,
    ): void {
        let toggledHostSidebar = false;
        try {
            const auxBtn = findVisibleAuxSidebarToggle();
            if (auxBtn && auxBtn.getAttribute('aria-expanded') === 'false' && typeof auxBtn.click === 'function') {
                auxBtn.click();
                toggledHostSidebar = true;
            }
        } catch { /* ignore */ }
        if (hasLoopbackBridge(payload)) {
            sendBridgeAction(payload, 'openPanel', source, feedbackEl, targetTab ? { targetTab } : undefined);
        } else if (toggledHostSidebar && feedbackEl) {
            feedbackEl.textContent = bi((payload && payload.language) || 'both', 'Opened', '已打开');
        }
    }

    function clearChildren(node: Node): void {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function normalizePermButtonLabel(text: string | null | undefined): string {
        return String(text || '')
            .replace(/keyboard_arrow_(?:down|up)|expand_(?:more|less)|arrow_drop_down/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function findLastElementChild(parent: Element | null | undefined): Element | null {
        if (!parent) { return null; }
        if (parent.lastElementChild) { return parent.lastElementChild; }
        const nodes = parent.childNodes || [];
        for (let k = nodes.length - 1; k >= 0; k--) {
            if (nodes[k] && nodes[k].nodeType === 1) { return nodes[k] as Element; }
        }
        return null;
    }

    /**
     * Single canonical unfocused-pane detector shared by both anchor selection
     * and Hub conversation focus detection (eliminates duplicate declarations).
     */
    function isInsideUnfocusedPane(node: Node | null | undefined): boolean {
        let cur: Node | null = node || null;
        while (cur && cur !== document.body && cur !== document.documentElement) {
            const candidate = cur as Element;
            if (typeof candidate.getAttribute === 'function') {
                const val = candidate.getAttribute('data-pane-unfocused');
                if (val !== null && val !== 'false') {
                    return true;
                }
            }
            cur = candidate.parentElement || cur.parentNode;
        }
        return false;
    }

    function isMetadataBar(node: Node | null | undefined): boolean {
        const elNode = node as Element | null | undefined;
        if (!elNode || typeof elNode.getAttribute !== 'function') { return false; }
        const tid = elNode.getAttribute('data-testid') || '';
        const hasPerm = Boolean(elNode.querySelector && elNode.querySelector('[data-testid="permissions-selector-trigger"]'));
        if (hasPerm) { return false; }
        if (tid === 'input-box-bottom-toolbar') { return true; }
        if (elNode.querySelector && elNode.querySelector('.surface-composer-card, .agy-composer-footer, [data-agent-composer-root], [contenteditable="true"]')) {
            return false;
        }
        if (elNode.querySelector && elNode.querySelector('[data-testid="location-selector-trigger"], [data-testid="project-selector-trigger"]')) {
            return true;
        }
        return false;
    }

    function isInsideMetadataBar(node: Node | null | undefined): boolean {
        return Boolean(findAncestor(node, (cur) => {
            if (!cur || cur === document.body || cur === document.documentElement) { return false; }
            return isMetadataBar(cur);
        }));
    }

    function orderByFocusAndVisibility(nodes: ArrayLike<Element>, requireVisible: boolean): Element[] {
        const focusedVisible: Element[] = [];
        const unfocusedVisible: Element[] = [];
        const hidden: Element[] = [];
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n || !n.isConnected) { continue; }
            if (isElementVisible(n)) {
                if (!isInsideUnfocusedPane(n)) {
                    focusedVisible.push(n);
                } else {
                    unfocusedVisible.push(n);
                }
            } else if (!requireVisible) {
                hidden.push(n);
            }
        }
        return focusedVisible.concat(unfocusedVisible, hidden);
    }

    function resolveComposerActionAnchor(footer: Element | null, actionBtn: Element | null): AnchorPlacement | null {
        if (!actionBtn) { return null; }
        const firstGroup = footer ? footer.firstElementChild : null;
        const rightGroup = footer ? findLastElementChild(footer) : null;
        if (rightGroup && rightGroup !== firstGroup && containsNode(rightGroup, actionBtn)) {
            let cur: Element | null = actionBtn;
            while (cur && cur.parentElement && cur.parentElement !== rightGroup) {
                cur = cur.parentElement;
            }
            if (cur && cur.parentElement === rightGroup) {
                return { parent: rightGroup, before: cur, mode: 'inline' };
            }
        }
        let target: Element | null = actionBtn;
        while (
            target && target.parentElement && target.parentElement !== footer && target.parentElement !== document.body
            && (
                (typeof target.parentElement.getAttribute === 'function' && target.parentElement.getAttribute('data-testid') === 'voice-live-pill')
                || target.parentElement.tagName === 'SPAN'
                || target.parentElement.tagName === 'BUTTON'
            )
        ) {
            target = target.parentElement;
        }
        if (target && target.parentElement && !isInsideMetadataBar(target.parentElement)) {
            return { parent: target.parentElement, before: target, mode: 'inline' };
        }
        return null;
    }

    function findComposerAnchorInPass(requireVisible: boolean): AnchorPlacement | null {
        const permRe = /^(?:request\s*review|default|auto|turbo|ask|plan|planning|fast|agent|chat|edit|请求审核|审核|默认|自动|极速|询问|计划)$/i;
        const permAriaRe = /permissions?\s*preset|approval\s*(?:mode|policy)|权限预设|审批模式/i;
        const actionBtnSel = '[data-testid="voice-start-button"], [data-testid="send-button"], [data-testid="send-button-loading"], [data-testid="send-button-pending"], [data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-record-tooltip"], .agy-send-button';

        // Tier 1: Direct permissions selector trigger anywhere
        const directTriggers = orderByFocusAndVisibility(
            document.querySelectorAll('[data-testid="permissions-selector-trigger"]'),
            requireVisible,
        );
        for (let ti = 0; ti < directTriggers.length; ti++) {
            const trig = directTriggers[ti];
            if (trig && trig.parentElement && !isMetadataBar(trig.parentElement)) {
                return { parent: trig.parentElement, before: trig, mode: 'inline' };
            }
        }

        // Tier 2: True composer action footers ONLY
        const rawFooters = document.querySelectorAll('.agy-composer-footer, [data-agent-composer-root], [data-testid="composer-footer"], [class*="composer-footer"]');
        const candidateFooters: Element[] = [];
        const orderedFooters = orderByFocusAndVisibility(rawFooters, requireVisible);
        for (let fi = 0; fi < orderedFooters.length; fi++) {
            if (!isMetadataBar(orderedFooters[fi]) && !isInsideMetadataBar(orderedFooters[fi])) {
                candidateFooters.push(orderedFooters[fi]);
            }
        }

        // Tier 2a: Approval/permission button across all candidate footers
        for (let i = 0; i < candidateFooters.length; i++) {
            const footer = candidateFooters[i];
            const buttons = footer.querySelectorAll ? footer.querySelectorAll('button, [role="button"]') : [];
            for (let j = 0; j < buttons.length; j++) {
                const btn = buttons[j];
                if (requireVisible && !isElementVisible(btn)) { continue; }
                const tid = (btn.getAttribute('data-testid') || '').toLowerCase();
                if (tid === 'location-selector-trigger' || tid === 'project-selector-trigger' || tid === 'model-selector-trigger') {
                    continue;
                }
                const aria = btn.getAttribute('aria-label') || '';
                const label = normalizePermButtonLabel(btn.textContent);
                const isModeTid = tid.indexOf('permission') >= 0 || tid.indexOf('approval') >= 0 || (tid.indexOf('mode') >= 0 && tid.indexOf('model') < 0);
                if ((permAriaRe.test(aria) || isModeTid || permRe.test(label)) && btn.parentElement && !isInsideMetadataBar(btn)) {
                    return { parent: btn.parentElement, before: btn, mode: 'inline' };
                }
            }
        }

        // Tier 2b: Action button inside a true footer
        for (let ai = 0; ai < candidateFooters.length; ai++) {
            const aFooter = candidateFooters[ai];
            const actionBtns = aFooter.querySelectorAll ? orderByFocusAndVisibility(aFooter.querySelectorAll(actionBtnSel), requireVisible) : [];
            for (let aj = 0; aj < actionBtns.length; aj++) {
                const resolved = resolveComposerActionAnchor(aFooter, actionBtns[aj]);
                if (resolved) { return resolved; }
            }
        }

        // Tier 2c: Distinct right-hand group inside a true footer
        for (let ri = 0; ri < candidateFooters.length; ri++) {
            const rFooter = candidateFooters[ri];
            const rightGroup = findLastElementChild(rFooter);
            const firstGroup = rFooter.firstElementChild;
            if (rightGroup && rightGroup !== firstGroup) {
                return { parent: rightGroup, before: rightGroup.firstChild, mode: 'inline' };
            }
        }

        // Tier 2d: Single-group non-metadata footer fallback
        for (let si = 0; si < candidateFooters.length; si++) {
            const sFooter = candidateFooters[si];
            const sFirst = sFooter.firstElementChild;
            if (sFirst) {
                return { parent: sFirst, before: sFirst.firstChild, mode: 'inline' };
            }
            return { parent: sFooter, before: sFooter.firstChild, mode: 'inline' };
        }

        // Tier 3: Last-resort global action button inside composer card/box
        const cards = orderByFocusAndVisibility(
            document.querySelectorAll('.surface-composer-card, [data-testid="agent-input-box"]'),
            requireVisible,
        );
        for (let ci = 0; ci < cards.length; ci++) {
            const card = cards[ci];
            const cardBtns = card.querySelectorAll ? orderByFocusAndVisibility(card.querySelectorAll(actionBtnSel), requireVisible) : [];
            for (let cj = 0; cj < cardBtns.length; cj++) {
                if (isInsideMetadataBar(cardBtns[cj])) { continue; }
                const cardFooter = findAncestor(cardBtns[cj], (cur) => {
                    if (!cur || cur === card || cur === document.body) { return false; }
                    const elCur = cur as Element;
                    const cFirst = elCur.firstElementChild;
                    const cLast = findLastElementChild(elCur);
                    return Boolean(cFirst && cLast && cFirst !== cLast && containsNode(cLast, cardBtns[cj]));
                }) as Element | null;
                const cardAnchor = resolveComposerActionAnchor(cardFooter, cardBtns[cj]);
                if (cardAnchor) { return cardAnchor; }
            }
        }

        return null;
    }

    function findComposerAnchor(): AnchorPlacement | null {
        return findComposerAnchorInPass(true) || findComposerAnchorInPass(false);
    }

    function parsePxValue(raw: unknown): number {
        if (typeof raw !== 'string') { return 0; }
        const m = raw.trim().match(/^(-?[\d.]+)px$/i);
        if (!m) { return 0; }
        const n = parseFloat(m[1]);
        return Number.isFinite(n) ? n : 0;
    }

    function getOpenSidebarRightPx(): number {
        const vw = window.innerWidth || 1280;
        try {
            const sheet = document.querySelector('.agy-sheet');
            if (sheet && sheet.getAttribute('data-sidebar-closed') === 'true') {
                return 0;
            }
            const toggleBtn = document.querySelector('[data-testid="sidebar-toggle"]');
            const toggleExpanded = toggleBtn ? toggleBtn.getAttribute('aria-expanded') : null;
            if (toggleExpanded === 'false') {
                return 0;
            }
            const split = document.querySelector('[data-testid="sidebar-split"]');
            const sidebarEl = split ? split.firstElementChild as HTMLElement | null : null;
            if (sidebarEl) {
                const visible = isElementVisible(sidebarEl);
                const rect = getSafeRect(sidebarEl);
                const measuredRight = (visible && rect && rect.width > 20) ? rect.right : 0;
                const targetWidth = (toggleExpanded === 'true' && sidebarEl.style && sidebarEl.style.visibility !== 'hidden')
                    ? parsePxValue(sidebarEl.style.width)
                    : 0;
                const best = Math.max(measuredRight, targetWidth > 20 ? targetWidth : 0);
                if (best > 20) {
                    return Math.min(Math.round(best), Math.round(vw * 0.6));
                }
            }
        } catch { /* ignore */ }
        return 0;
    }

    function getLeftChromeRightPx(): number {
        const vw = window.innerWidth || 1280;
        let maxRight = 0;
        try {
            const controls = document.querySelectorAll('[data-testid="sidebar-toggle"], [data-testid="sidebar-search-button"]');
            for (let i = 0; i < controls.length; i++) {
                const ctrl = controls[i];
                if (!isElementVisible(ctrl)) { continue; }
                const rect = getSafeRect(ctrl);
                if (rect && rect.top < 48 && rect.right > 0 && rect.right < vw * 0.65) {
                    if (rect.right > maxRight) { maxRight = Math.round(rect.right); }
                }
                let cur = ctrl.parentElement;
                for (let depth = 0; cur && depth < 3; depth++) {
                    const cls = String(cur.className || '');
                    const isLeftOverlay = cls.indexOf('left-0') >= 0 && (cls.indexOf('absolute') >= 0 || cls.indexOf('z-50') >= 0);
                    if (isLeftOverlay) {
                        const ovRect = getSafeRect(cur);
                        if (ovRect && ovRect.top < 48 && ovRect.left <= 4 && ovRect.right > 0 && ovRect.right < vw * 0.65) {
                            if (ovRect.right > maxRight) { maxRight = Math.round(ovRect.right); }
                        }
                        break;
                    }
                    cur = cur.parentElement;
                }
            }
            if (nav.windowControlsOverlay && nav.windowControlsOverlay.visible) {
                const wcoRect = nav.windowControlsOverlay.getTitlebarAreaRect();
                if (wcoRect && typeof wcoRect.left === 'number' && wcoRect.left > maxRight && wcoRect.left < vw * 0.5) {
                    maxRight = Math.round(wcoRect.left);
                }
            }
        } catch { /* ignore */ }
        if (maxRight === 0 && state.topBarAnchorMode === 'fixed' && isMacClient()) {
            return 88;
        }
        return maxRight;
    }

    function getRightPaddingAndBorderPx(node: Element | null | undefined): number {
        if (!node) { return 0; }
        let pad = 0;
        let border = 0;
        let hasCsPad = false;
        let hasCsBorder = false;
        try {
            if (typeof window.getComputedStyle === 'function') {
                const cs = window.getComputedStyle(node);
                if (cs) {
                    if (typeof cs.paddingRight === 'string' && cs.paddingRight) {
                        pad = parsePxValue(cs.paddingRight);
                        hasCsPad = true;
                    }
                    if (typeof cs.borderRightWidth === 'string' && cs.borderRightWidth) {
                        border = parsePxValue(cs.borderRightWidth);
                        hasCsBorder = true;
                    }
                }
            }
        } catch { /* ignore */ }
        const htmlNode = node as HTMLElement;
        if (!hasCsPad && htmlNode.style && typeof htmlNode.style.paddingRight === 'string') {
            pad = parsePxValue(htmlNode.style.paddingRight);
        }
        if (!hasCsBorder && htmlNode.style && typeof htmlNode.style.borderRightWidth === 'string') {
            border = parsePxValue(htmlNode.style.borderRightWidth);
        }
        return Math.max(0, pad) + Math.max(0, border);
    }

    function getFollowingSiblingsMinLeftPx(host: Element | null): number {
        if (!host || !host.parentElement) { return Infinity; }
        let minLeft = Infinity;
        let sib = host.nextSibling;
        while (sib) {
            if (sib.nodeType === 1) {
                const elSib = sib as Element;
                if (elSib !== host && elSib.id !== TOPBAR_HOST_ID && isElementVisible(elSib)) {
                    const sr = getSafeRect(elSib);
                    if (sr && sr.top < 96 && sr.width > 0 && sr.left > 0 && sr.left < minLeft) {
                        minLeft = Math.round(sr.left);
                    }
                }
            }
            sib = sib.nextSibling;
        }
        return minLeft;
    }

    function getRightChromeLeftPx(): number {
        const vw = window.innerWidth || 1280;
        const isFixed = state.topBarAnchorMode === 'fixed';
        if (!isFixed) {
            const sibMinLeft = getFollowingSiblingsMinLeftPx(state.topBarHost);
            if (sibMinLeft < Infinity) {
                return Math.max(0, sibMinLeft);
            }
        }
        let minLeft = isFixed ? (vw - 10 - computeWcoInsetPx(true)) : (vw - 10);
        const maxTop = isFixed ? 48 : 96;
        try {
            const rightCtrls = document.querySelectorAll(
                '[data-testid="toggle-maximize-pane"], [data-testid="toggle-aux-sidebar"], [data-testid="window-controls-reserve"], [data-testid="legacy-window-controls-reserve"]',
            );
            for (let i = 0; i < rightCtrls.length; i++) {
                const c = rightCtrls[i];
                if (!c || c === state.topBarHost || c.id === TOPBAR_HOST_ID || !isElementVisible(c)) { continue; }
                const r = getSafeRect(c);
                if (r && r.top < maxTop && r.width > 0 && r.left > 0 && r.left < minLeft) {
                    minLeft = Math.round(r.left);
                }
            }
        } catch { /* ignore */ }
        return Math.max(0, minLeft);
    }

    function measureNativeToolbarButtonsWidth(toolbar: Element | null | undefined, excludeHost: Element | null): number {
        if (!toolbar) { return 0; }
        const children = getElementChildren(toolbar);
        let minL = Infinity;
        let maxR = 0;
        let sumW = 0;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child || child === excludeHost || child.id === TOPBAR_HOST_ID) { continue; }
            if (!isElementVisible(child)) { continue; }
            const r = getSafeRect(child);
            if (r && r.width > 0) {
                if (r.left < minL) { minL = r.left; }
                if (r.right > maxR) { maxR = r.right; }
                sumW += r.width;
            }
        }
        if (minL < Infinity && maxR > minL) {
            return Math.round(maxR - minL);
        }
        return Math.round(sumW);
    }

    function isRevealOnHoverElement(node: Element | null | undefined): boolean {
        if (!node || typeof node.getAttribute !== 'function') { return false; }
        const val = node.getAttribute('data-reveal-on-hover');
        return val !== null && val !== 'false';
    }

    function hasVisibleNativeChildren(container: Element | null | undefined, excludeHost: Element | null): boolean {
        const children = getElementChildren(container);
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child || child === excludeHost || child.id === TOPBAR_HOST_ID) { continue; }
            if (isElementVisible(child)) {
                return true;
            }
        }
        return false;
    }

    function doesEmptyToolbarOverlapRightWco(tb: Element | null, tbRect: DOMRect | null): boolean {
        if (!tb || !tbRect || tbRect.width <= 0 || tbRect.height <= 0) {
            return false;
        }
        if (hasVisibleNativeChildren(tb, state.topBarHost)) {
            return false;
        }
        if (findVisibleTopRightWcoReserve()) {
            return false;
        }
        try {
            const wco = nav.windowControlsOverlay;
            if (!wco || !wco.visible || typeof wco.getTitlebarAreaRect !== 'function') {
                return false;
            }
            const wcoRect = wco.getTitlebarAreaRect();
            if (!wcoRect || typeof wcoRect.right !== 'number' || !Number.isFinite(wcoRect.right) || wcoRect.right <= 0) {
                return false;
            }
            const vw = window.innerWidth || 1280;
            const rightGap = Math.max(0, Math.round(vw - wcoRect.right));
            if (rightGap <= 0 || rightGap >= vw * 0.5) {
                return false;
            }
            const wcoTop = (typeof wcoRect.top === 'number' && Number.isFinite(wcoRect.top)) ? wcoRect.top : 0;
            const wcoBottom = (typeof wcoRect.bottom === 'number' && Number.isFinite(wcoRect.bottom))
                ? wcoRect.bottom
                : (wcoTop + ((typeof wcoRect.height === 'number' && Number.isFinite(wcoRect.height) && wcoRect.height > 0) ? wcoRect.height : 32));
            if (!(tbRect.top < wcoBottom && tbRect.bottom > wcoTop)) {
                return false;
            }
            const tbContentRight = tbRect.right - getRightPaddingAndBorderPx(tb);
            return tbContentRight > wcoRect.right;
        } catch {
            return false;
        }
    }

    function findTopBarAnchor(): AnchorPlacement | null {
        const vw = window.innerWidth || 1280;

        // Tier 1: Primary Antigravity right chrome overlay
        const auxBtns = document.querySelectorAll('[data-testid="toggle-aux-sidebar"]');
        let auxBtn: Element | null = null;
        for (let ai = 0; ai < auxBtns.length; ai++) {
            if (isElementVisible(auxBtns[ai]) && auxBtns[ai].parentElement) {
                auxBtn = auxBtns[ai];
                break;
            }
        }
        if (auxBtn && auxBtn.parentElement) {
            const parent = auxBtn.parentElement;
            const maxBtn = parent.querySelector ? parent.querySelector('[data-testid="toggle-maximize-pane"]') : null;
            if (maxBtn && maxBtn.parentElement === parent && isElementVisible(maxBtn)) {
                return { parent, before: maxBtn, mode: 'inline', tier: 'right-overlay' };
            }
            return { parent, before: auxBtn, mode: 'inline', tier: 'right-overlay' };
        }

        // Tier 2: Windows/Linux non-conversation screens with top-right window-controls-reserve
        const wcoEls = document.querySelectorAll('[data-testid="window-controls-reserve"]');
        for (let wi = 0; wi < wcoEls.length; wi++) {
            const wco = wcoEls[wi];
            if (!wco || !wco.parentElement || wco.parentElement === document.body || wco.parentElement === document.documentElement) {
                continue;
            }
            if (!isElementVisible(wco)) { continue; }
            const wcoRect = getSafeRect(wco);
            if (!wcoRect || (wcoRect.top < 48 && wcoRect.right >= vw - 60)) {
                return { parent: wco.parentElement, before: wco, mode: 'inline', tier: 'right-overlay' };
            }
        }

        // Tier 3: Standalone right-aligned pane toolbar
        const paneToolbars = document.querySelectorAll('[data-testid="pane-titlebar-toolbar"]');
        const leftChromeRight = getLeftChromeRightPx();
        for (let pi = 0; pi < paneToolbars.length; pi++) {
            const tb = paneToolbars[pi];
            if (!tb || !isElementVisible(tb)) { continue; }
            if (isRevealOnHoverElement(tb)) { continue; }
            if (isInsideUnfocusedPane(tb)) { continue; }
            const tbRect = getSafeRect(tb);
            if (leftChromeRight > 0 && tbRect && tbRect.right > 0 && tbRect.right < leftChromeRight + 100) {
                continue;
            }
            if (doesEmptyToolbarOverlapRightWco(tb, tbRect)) {
                continue;
            }
            return { parent: tb, before: tb.firstChild, mode: 'inline', tier: 'pane-toolbar' };
        }

        // Tier 4: Fixed top-right fallback
        if (document.body) {
            return { parent: document.body, before: null, mode: 'fixed', tier: 'fixed' };
        }
        return null;
    }

    const state: OverlayRuntimeState = {
        composerEnabled: false,
        topBarEnabled: false,
        payload: null,
        composerHost: null,
        composerShadow: null,
        composerRefs: null,
        composerPinned: false,
        composerOpen: false,
        composerHoverOpenTimer: null,
        composerHideTimer: null,
        topBarHost: null,
        topBarShadow: null,
        topBarRefs: null,
        topBarAnchorMode: 'inline',
        topBarAnchorTier: 'right-overlay',
        topBarActiveView: null,
        topBarPinned: false,
        topBarHoverOpenTimer: null,
        topBarHoverCloseTimer: null,
        topBarWarmUntilMs: 0,
        overflowOpen: false,
        fontSizePreset: 'normal',
        highContrast: false,
        countdownSec: null,
        countdownTimer: null,
        domObserver: null,
        themeObserver: null,
        layoutObserver: null,
        observedLayoutNodes: [],
        reanchorTimer: null,
        layoutSyncHandle: null,
        layoutSyncIsRaf: false,
        sidebarTransitionTimer: null,
        boundWcoTarget: null,
        focusSyncTimer: null,
        focusRevision: 0,
        focusDelivery: null,
    };

    const HUB_UUID_EXACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const HUB_UUID_GLOBAL_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const HUB_UUID_ROUTE_RE = /(?:^|[\/#?&:=+,]|%2b)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[\/#?&+,]|%2b)/i;
    const HUB_NEW_CHAT_ROUTE_RE = /(?:^|\/)(?:new|new-chat|new-conversation)(?:\/|$)/i;

    function safeDecodeUri(raw: string): string {
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    }

    function extractHubUuid(raw: unknown): string | null {
        if (typeof raw !== 'string') { return null; }
        const trimmed = raw.trim();
        if (!trimmed) { return null; }
        if (HUB_UUID_EXACT_RE.test(trimmed)) { return trimmed; }
        const m = trimmed.match(HUB_UUID_ROUTE_RE);
        if (m && m[1]) { return m[1]; }
        const decoded = safeDecodeUri(trimmed);
        if (decoded !== trimmed) {
            if (HUB_UUID_EXACT_RE.test(decoded)) { return decoded; }
            const md = decoded.match(HUB_UUID_ROUTE_RE);
            if (md && md[1]) { return md[1]; }
        }
        return null;
    }

    function extractAllRouteUuids(raw: string): string[] {
        const out: string[] = [];
        const seen: Record<string, boolean> = {};
        if (!raw) { return out; }
        const decoded = safeDecodeUri(raw);
        const matches = decoded.match(HUB_UUID_GLOBAL_RE);
        if (!matches) { return out; }
        for (let i = 0; i < matches.length; i++) {
            const id = matches[i];
            const lower = id.toLowerCase();
            if (!seen[lower]) {
                seen[lower] = true;
                out.push(id);
            }
        }
        return out;
    }

    function extractQueryParam(rawQuery: string, key: string): string | null {
        if (!rawQuery) { return null; }
        const cleaned = rawQuery.charAt(0) === '?' ? rawQuery.slice(1) : rawQuery;
        if (!cleaned) { return null; }
        const pairs = cleaned.split('&');
        const targetKey = key.toLowerCase();
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            if (!pair) { continue; }
            const eqIdx = pair.indexOf('=');
            const rawK = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
            const k = safeDecodeUri(rawK).trim().toLowerCase();
            if (k === targetKey) {
                const rawV = eqIdx >= 0 ? pair.slice(eqIdx + 1) : '';
                return safeDecodeUri(rawV.replace(/\+/g, ' ')).trim();
            }
        }
        return null;
    }

    function parseSplitPaneUrlFocus(
        pathname: string,
        search: string,
        hash: string,
    ): { focusedUuid: string | null; isSplitRoute: boolean; paneUuids: string[]; cleanHashPath: string } {
        const cleanHash = hash.replace(/^#!?/, '');
        const hashQIdx = cleanHash.indexOf('?');
        const cleanHashPath = hashQIdx >= 0 ? cleanHash.slice(0, hashQIdx) : cleanHash;
        const hashQuery = hashQIdx >= 0 ? cleanHash.slice(hashQIdx) : '';

        // Combine route segments (pathname + hashPath) preserving split-pane `%2B` / `+` tokens
        const pathUuids = extractAllRouteUuids(pathname);
        const hashUuids = extractAllRouteUuids(cleanHashPath);
        const paneUuids: string[] = [];
        const seenPane: Record<string, boolean> = {};
        const addPane = (id: string) => {
            const low = id.toLowerCase();
            if (!seenPane[low]) {
                seenPane[low] = true;
                paneUuids.push(id);
            }
        };
        for (let i = 0; i < pathUuids.length; i++) { addPane(pathUuids[i]); }
        for (let i = 0; i < hashUuids.length; i++) { addPane(hashUuids[i]); }

        const isSplitRoute = paneUuids.length > 1 || /(?:\+|%2b)/i.test(pathname + ' ' + cleanHashPath);

        // 1. Explicit `?focused=` query param (from location.search or hash query) always wins
        const focusedRaw = extractQueryParam(search, 'focused')
            || extractQueryParam(hashQuery, 'focused')
            || extractQueryParam(search, 'focusedPane')
            || extractQueryParam(hashQuery, 'focusedPane');

        if (focusedRaw) {
            const focusedUuid = extractHubUuid(focusedRaw);
            if (focusedUuid) {
                return { focusedUuid, isSplitRoute, paneUuids, cleanHashPath };
            }
            // Numeric pane index (e.g. `?focused=1` on `/c/<uuidA>%2B<uuidB>?focused=1`)
            if (/^\d+$/.test(focusedRaw)) {
                const idx = parseInt(focusedRaw, 10);
                if (idx >= 0 && idx < paneUuids.length) {
                    return { focusedUuid: paneUuids[idx], isSplitRoute, paneUuids, cleanHashPath };
                }
            }
        }

        // 2. Single unambiguous conversation route (NOT split-pane)
        if (!isSplitRoute && paneUuids.length === 1) {
            return { focusedUuid: paneUuids[0], isSplitRoute: false, paneUuids, cleanHashPath };
        }

        // 3. Split-pane route without `?focused=`: NEVER blindly pick the first URL UUID;
        //    defer to focused-pane DOM attributes (!isInsideUnfocusedPane).
        return { focusedUuid: null, isSplitRoute, paneUuids, cleanHashPath };
    }

    function isInsideSidebarContainer(node: Node | null | undefined): boolean {
        let cur: Node | null = node || null;
        while (cur && cur !== document.body && cur !== document.documentElement) {
            const elCur = cur as Element;
            if (typeof elCur.getAttribute === 'function') {
                const tid = elCur.getAttribute('data-testid') || '';
                if (tid === 'sidebar-split') { return false; }
                if (tid.indexOf('sidebar') >= 0 && tid !== 'toggle-aux-sidebar') { return true; }
            }
            const tag = String(elCur.tagName || '').toUpperCase();
            if (tag === 'ASIDE' || tag === 'NAV') { return true; }
            cur = elCur.parentElement;
        }
        return false;
    }

    function detectHubConversationFocus(): { conversationId: string | null; isNewConversation: boolean } | null {
        let loc: Location | null = null;
        try {
            loc = window && window.location ? window.location : null;
        } catch {
            loc = null;
        }
        const pathname = loc && typeof loc.pathname === 'string' ? loc.pathname : '';
        const search = loc && typeof loc.search === 'string' ? loc.search : '';
        const hash = loc && typeof loc.hash === 'string' ? loc.hash : '';

        // 1. Explicit `?focused=` split-pane query param or unambiguous single-conversation route
        const urlFocus = parseSplitPaneUrlFocus(pathname, search, hash);
        if (urlFocus.focusedUuid) {
            return { conversationId: urlFocus.focusedUuid, isNewConversation: false };
        }

        // Helper to check if an ID matches one of the split-pane route UUIDs (when split route is active)
        const matchesSplitPaneSet = (uuid: string): boolean => {
            if (!urlFocus.isSplitRoute || urlFocus.paneUuids.length === 0) { return true; }
            const low = uuid.toLowerCase();
            for (let k = 0; k < urlFocus.paneUuids.length; k++) {
                if (urlFocus.paneUuids[k].toLowerCase() === low) { return true; }
            }
            return false;
        };

        // 2. Focused-pane explicit active conversation DOM attributes (strictly excluding unfocused panes & sidebar noise)
        const explicitSelectors = [
            '[data-active-conversation-id]',
            '[aria-current="page"]',
            '[data-active="true"]',
        ];
        let fallbackExplicitUuid: string | null = null;
        for (let si = 0; si < explicitSelectors.length; si++) {
            const sel = explicitSelectors[si];
            let nodes: ArrayLike<Element> = [];
            try { nodes = document.querySelectorAll(sel); } catch { nodes = []; }
            for (let ni = 0; ni < nodes.length; ni++) {
                const n = nodes[ni];
                if (!n || isInsideUnfocusedPane(n) || typeof n.getAttribute !== 'function') { continue; }
                // Exclude sidebar elements for generic `[data-active="true"]` so sidebar highlights never hijack focus
                if (sel === '[data-active="true"]' && isInsideSidebarContainer(n)) { continue; }
                const candidate = n.getAttribute('data-active-conversation-id')
                    || n.getAttribute('data-conversation-id')
                    || n.getAttribute('data-cascade-id')
                    || n.getAttribute('href')
                    || '';
                const foundUuid = extractHubUuid(candidate);
                if (foundUuid) {
                    if (matchesSplitPaneSet(foundUuid)) {
                        return { conversationId: foundUuid, isNewConversation: false };
                    }
                    if (!fallbackExplicitUuid) {
                        fallbackExplicitUuid = foundUuid;
                    }
                }
            }
        }
        if (fallbackExplicitUuid) {
            return { conversationId: fallbackExplicitUuid, isNewConversation: false };
        }

        // 3. Main-pane conversation/cascade ID attributes (strictly excluding sidebar lists & unfocused panes)
        const paneSelectors = ['[data-conversation-id]', '[data-cascade-id]'];
        let fallbackPaneUuid: string | null = null;
        for (let pi = 0; pi < paneSelectors.length; pi++) {
            let pNodes: ArrayLike<Element> = [];
            try { pNodes = document.querySelectorAll(paneSelectors[pi]); } catch { pNodes = []; }
            for (let pni = 0; pni < pNodes.length; pni++) {
                const pn = pNodes[pni];
                if (!pn || isInsideUnfocusedPane(pn) || isInsideSidebarContainer(pn) || typeof pn.getAttribute !== 'function') {
                    continue;
                }
                const pVal = pn.getAttribute('data-conversation-id') || pn.getAttribute('data-cascade-id') || '';
                const paneUuid = extractHubUuid(pVal);
                if (paneUuid) {
                    if (matchesSplitPaneSet(paneUuid)) {
                        return { conversationId: paneUuid, isNewConversation: false };
                    }
                    if (!fallbackPaneUuid) {
                        fallbackPaneUuid = paneUuid;
                    }
                }
            }
        }
        if (fallbackPaneUuid) {
            return { conversationId: fallbackPaneUuid, isNewConversation: false };
        }

        // 4. Explicit new-chat DOM marker or explicit `/new` / `/new-chat` route ONLY.
        //    NEVER treat a bare root page ('/') with a visible composer or the first URL UUID
        //    as a human-created new chat (D9 §3.2 anti-hijack invariant).
        try {
            const newMarker = document.querySelector('[data-new-conversation="true"]');
            if (newMarker && !isInsideUnfocusedPane(newMarker) && !isInsideSidebarContainer(newMarker)) {
                return { conversationId: null, isNewConversation: true };
            }
        } catch { /* ignore */ }

        if (pathname || urlFocus.cleanHashPath) {
            if (HUB_NEW_CHAT_ROUTE_RE.test(pathname) || HUB_NEW_CHAT_ROUTE_RE.test(urlFocus.cleanHashPath)) {
                return { conversationId: null, isNewConversation: true };
            }
        }

        return null;
    }

    function syncHubConversationFocus(): void {
        if (!state.topBarEnabled && !state.composerEnabled) { return; }
        if (!hasLoopbackBridge(state.payload)) { return; }
        const detected = detectHubConversationFocus();
        if (!detected) { return; }
        const key = detected.conversationId
            ? ('id:' + detected.conversationId.toLowerCase())
            : (detected.isNewConversation ? 'new' : '');
        if (!key) { return; }
        const { bridgeUrl, bridgeToken } = state.payload;
        let delivery = state.focusDelivery;
        if (!delivery || delivery.key !== key || delivery.bridgeUrl !== bridgeUrl || delivery.bridgeToken !== bridgeToken) {
            delivery = { key, bridgeUrl, bridgeToken, revision: ++state.focusRevision, status: 'ready' };
            state.focusDelivery = delivery;
        }
        if (delivery.status !== 'ready') { return; }
        delivery.status = 'sending';
        const source = state.topBarEnabled ? 'topbar' : 'composer';
        const current = delivery;
        sendBridgeAction(state.payload, 'focusConversation', source, null, {
            conversationId: detected.conversationId,
            isNewConversation: Boolean(detected.isNewConversation),
            focusRevision: current.revision,
        }, (ok, receipt) => {
            if (state.focusDelivery !== current) { return; }
            current.status = ok && receipt?.accepted === true && receipt.ackFocusRevision === current.revision
                ? 'accepted' : 'ready';
        });
    }

    function scheduleHubFocusSync(): void {
        if (!state.topBarEnabled && !state.composerEnabled) { return; }
        if (state.focusSyncTimer) { clearTimeout(state.focusSyncTimer); }
        state.focusSyncTimer = setTimeout(() => {
            state.focusSyncTimer = null;
            syncHubConversationFocus();
        }, 120);
    }

    function onHubNavigationChange(): void {
        if (!state.topBarEnabled && !state.composerEnabled) { return; }
        syncHubConversationFocus();
    }

    function syncThemes(): void {
        const theme = detectHostTheme(state.payload ? state.payload.theme : undefined);
        const fontSize = resolveFontSizePreset(state.payload);
        const highContrast = detectHostHighContrast(state.payload);
        state.fontSizePreset = fontSize;
        state.highContrast = highContrast;
        const contrastAttr = highContrast ? 'high' : 'normal';
        if (state.composerHost) {
            state.composerHost.setAttribute('data-theme', theme);
            state.composerHost.setAttribute('data-font-size', fontSize);
            state.composerHost.setAttribute('data-contrast', contrastAttr);
        }
        if (state.topBarHost) {
            state.topBarHost.setAttribute('data-theme', theme);
            state.topBarHost.setAttribute('data-font-size', fontSize);
            state.topBarHost.setAttribute('data-contrast', contrastAttr);
        }
    }

    function positionPopoverNear(triggerEl: Element | null, popEl: PopoverCapableElement | null, preferAbove: boolean): void {
        if (!triggerEl || !popEl) { return; }
        const rect = triggerEl.getBoundingClientRect();
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;
        const margin = 10;

        popEl.style.visibility = 'hidden';
        popEl.style.left = '0px';
        popEl.style.top = '0px';
        popEl.classList.add('is-open');
        openTopLayerPopover(popEl);

        const measuredRect = getSafeRect(popEl);
        const pw = popEl.offsetWidth || (measuredRect && measuredRect.width ? Math.round(measuredRect.width) : 0) || 340;
        const ph = popEl.offsetHeight || (measuredRect && measuredRect.height ? Math.round(measuredRect.height) : 0) || 260;

        const sidebarRight = getOpenSidebarRightPx();
        const safeLeft = (sidebarRight > 0 && (vw - sidebarRight - margin - 8) >= pw)
            ? Math.round(sidebarRight + 8)
            : margin;
        const maxLeft = Math.max(safeLeft, vw - pw - margin);

        let left = Math.round(rect.right - pw);
        if (left < safeLeft) { left = Math.round(rect.left); }
        if (left + pw > vw - margin) { left = vw - pw - margin; }
        if (left < safeLeft) { left = safeLeft; }
        left = Math.max(margin, Math.min(left, Math.max(margin, Math.min(maxLeft, vw - pw - margin))));

        let top: number;
        if (preferAbove) {
            top = Math.round(rect.top - ph - 8);
            if (top < margin) {
                const belowTop = Math.round(rect.bottom + 8);
                top = (belowTop + ph <= vh - margin)
                    ? belowTop
                    : Math.max(margin, Math.min(belowTop, vh - ph - margin));
            }
        } else {
            top = Math.round(rect.bottom + 8);
            if (top + ph > vh - margin) {
                const aboveTop = Math.round(rect.top - ph - 8);
                top = (aboveTop >= margin)
                    ? aboveTop
                    : Math.max(margin, vh - ph - margin);
            }
        }
        popEl.style.left = Math.max(margin, left) + 'px';
        popEl.style.top = Math.max(margin, top) + 'px';
        popEl.style.visibility = '';
    }

    function clearComposerHoverTimers(): void {
        if (state.composerHoverOpenTimer) {
            clearTimeout(state.composerHoverOpenTimer);
            state.composerHoverOpenTimer = null;
        }
        if (state.composerHideTimer) {
            clearTimeout(state.composerHideTimer);
            state.composerHideTimer = null;
        }
    }

    function closeComposerPopover(clearPin: boolean): void {
        clearComposerHoverTimers();
        if (clearPin) {
            state.composerPinned = false;
        }
        state.composerOpen = false;
        if (state.composerRefs) {
            state.composerRefs.popover.classList.remove('is-open');
            closeTopLayerPopover(state.composerRefs.popover);
            state.composerRefs.trigger.setAttribute('aria-expanded', 'false');
            if (clearPin) {
                state.composerRefs.trigger.classList.remove('is-pinned');
                state.composerRefs.pinBadge.style.display = 'none';
            }
        }
    }

    function createComposerSlot(): void {
        const existingNode = document.getElementById(COMPOSER_HOST_ID);
        if (existingNode && existingNode.parentNode) {
            existingNode.parentNode.removeChild(existingNode);
        }

        const host = el('div');
        host.id = COMPOSER_HOST_ID;
        host.setAttribute('data-acm-overlay', 'composer');
        host.setAttribute('data-no-drag', '');
        host.setAttribute('data-theme', detectHostTheme(state.payload ? state.payload.theme : undefined));
        host.setAttribute('data-font-size', resolveFontSizePreset(state.payload));
        host.setAttribute('data-contrast', detectHostHighContrast(state.payload) ? 'high' : 'normal');
        host.style.flexShrink = '0';

        const shadow = host.attachShadow({ mode: 'open' });
        const styleEl = el('style');
        styleEl.textContent = COMPOSER_CSS;
        shadow.appendChild(styleEl);

        const trigger = el('button', 'acm-ring-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Context window usage');
        // Preserve active chat composer focus on pointer interaction
        preventFocusStealOnMouseDown(trigger);

        const svg = svgEl('svg', { class: 'acm-ring-svg', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
        const track = svgEl('circle', { class: 'acm-ring-track', cx: '12', cy: '12', r: String(RING_RADIUS) });
        const arc = svgEl('circle', {
            class: 'acm-ring-arc',
            cx: '12',
            cy: '12',
            r: String(RING_RADIUS),
            'stroke-dasharray': RING_CIRC.toFixed(2),
            'stroke-dashoffset': RING_CIRC.toFixed(2),
            transform: 'rotate(-90 12 12)',
        });
        svg.appendChild(track);
        svg.appendChild(arc);
        const pctCenter = el('span', 'acm-ring-pct acm-num', '0');
        trigger.appendChild(svg);
        trigger.appendChild(pctCenter);

        const popover = el('div', 'acm-popover') as PopoverCapableElement;
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-modal', 'false');
        popover.setAttribute('popover', 'manual');

        const head = el('div', 'acm-pop-header');
        const titleEl = el('div', 'acm-pop-title', 'Usage / 用量');
        const headRight = el('div', 'acm-pop-header-right');
        const healthBadge = el('span', 'acm-pill-badge is-good', 'Healthy');
        const pinBadge = el('span', 'acm-pill-badge is-accent', 'Pinned');
        pinBadge.style.display = 'none';
        headRight.appendChild(healthBadge);
        headRight.appendChild(pinBadge);
        head.appendChild(titleEl);
        head.appendChild(headRight);

        const modelRow = el('div', 'acm-model-row');
        const modelNameEl = el('div', 'acm-model-name', '—');
        const pctHeroEl = el('div', 'acm-pct-hero acm-num', '0%');
        modelRow.appendChild(modelNameEl);
        modelRow.appendChild(pctHeroEl);

        const meterWrap = el('div', 'acm-meter-wrap');
        const meterFill = el('div', 'acm-meter-fill');
        meterFill.style.width = '0%';
        const tickCompaction = el('div', 'acm-watermark-tick is-compaction');
        tickCompaction.style.display = 'none';
        const tick200k = el('div', 'acm-watermark-tick is-tier200k');
        tick200k.style.display = 'none';
        meterWrap.appendChild(meterFill);
        meterWrap.appendChild(tickCompaction);
        meterWrap.appendChild(tick200k);

        const meterCaption = el('div', 'acm-meter-caption acm-num');
        const capTokens = el('span', '', '0 / 0');
        const capWatermarks = el('span', '', '');
        meterCaption.appendChild(capTokens);
        meterCaption.appendChild(capWatermarks);

        const compactRow = el('div', 'acm-compact-row');
        compactRow.style.display = 'none';
        const compactLabel = el('span', 'acm-k', '/compact');
        const compactBadge = el('span', 'acm-pill-badge acm-compact-badge', '');
        compactRow.appendChild(compactLabel);
        compactRow.appendChild(compactBadge);

        function makeKv(labelText: string): KvPairRefs {
            const row = el('div', 'acm-kv');
            const k = el('span', 'acm-k', labelText);
            const v = el('span', 'acm-v acm-num', '—');
            row.appendChild(k);
            row.appendChild(v);
            return { row, k, v };
        }

        const perfSec = el('div', 'acm-section');
        const perfHead = el('div', 'acm-swarm-head');
        const perfLabel = el('div', 'acm-section-label', 'Performance / 性能');
        const speedModeTag = el('span', 'acm-pill-badge acm-speed-mode-tag', 'Decode');
        perfHead.appendChild(perfLabel);
        perfHead.appendChild(speedModeTag);
        const perfGrid = el('div', 'acm-kv-grid');
        const kvSpeed = makeKv('Output Speed');
        const kvAvgSpeed = makeKv('Avg Speed');
        const kvTtft = makeKv('First Token');
        perfGrid.appendChild(kvSpeed.row);
        perfGrid.appendChild(kvAvgSpeed.row);
        perfGrid.appendChild(kvTtft.row);
        perfSec.appendChild(perfHead);
        perfSec.appendChild(perfGrid);

        const cacheSec = el('div', 'acm-section');
        const cacheLabel = el('div', 'acm-section-label', 'Cache / 缓存');
        const cacheGrid = el('div', 'acm-kv-grid');
        const kvRecentCh = makeKv('Recent CH');
        const kvAvgCh = makeKv('Avg CH');
        const kvTurnState = makeKv('Turn Cache');
        const turnBadge = el('span', 'acm-pill-badge', '—');
        clearChildren(kvTurnState.v);
        kvTurnState.v.appendChild(turnBadge);
        cacheGrid.appendChild(kvRecentCh.row);
        cacheGrid.appendChild(kvAvgCh.row);
        cacheGrid.appendChild(kvTurnState.row);
        cacheSec.appendChild(cacheLabel);
        cacheSec.appendChild(cacheGrid);

        const tcSec = el('div', 'acm-section');
        const tcLabel = el('div', 'acm-section-label', 'Tokens & Cost');
        const tcGrid = el('div', 'acm-kv-grid');
        const kvCost = makeKv('Current Chat Cost (Est.)');
        const kvInOut = makeKv('Input / Output');
        const kvCacheRead = makeKv('Cache Read');
        const kvTotal = makeKv('Total Tokens');
        tcGrid.appendChild(kvCost.row);
        tcGrid.appendChild(kvInOut.row);
        tcGrid.appendChild(kvCacheRead.row);
        tcGrid.appendChild(kvTotal.row);
        tcSec.appendChild(tcLabel);
        tcSec.appendChild(tcGrid);

        const swarmSec = el('div', 'acm-section acm-swarm-sec');
        swarmSec.style.display = 'none';

        const footerPill = el('div', 'acm-footer-pill');
        const summaryText = el('span', 'acm-summary-text acm-num', '—');
        const actionFeedback = el('span', 'acm-v-sub', '');
        actionFeedback.setAttribute('role', 'status');
        actionFeedback.setAttribute('aria-live', 'polite');
        footerPill.appendChild(summaryText);
        footerPill.appendChild(actionFeedback);

        const actionsRow = el('div', 'acm-actions');
        const openBtn = el('button', 'acm-btn is-primary', 'Open Panel');
        openBtn.type = 'button';
        const refreshBtn = el('button', 'acm-btn', 'Refresh');
        refreshBtn.type = 'button';
        actionsRow.appendChild(openBtn);
        actionsRow.appendChild(refreshBtn);

        popover.appendChild(head);
        popover.appendChild(modelRow);
        popover.appendChild(meterWrap);
        popover.appendChild(meterCaption);
        popover.appendChild(compactRow);
        popover.appendChild(perfSec);
        popover.appendChild(cacheSec);
        popover.appendChild(tcSec);
        popover.appendChild(swarmSec);
        popover.appendChild(footerPill);
        popover.appendChild(actionsRow);

        shadow.appendChild(trigger);
        shadow.appendChild(popover);

        function openPop(): void {
            clearComposerHoverTimers();
            state.composerOpen = true;
            trigger.setAttribute('aria-expanded', 'true');
            positionPopoverNear(trigger, popover, true);
        }

        function scheduleOpenPopWithIntent(): void {
            if (state.composerHideTimer) {
                clearTimeout(state.composerHideTimer);
                state.composerHideTimer = null;
            }
            if (state.composerOpen || state.composerPinned) {
                return;
            }
            if (state.composerHoverOpenTimer) {
                clearTimeout(state.composerHoverOpenTimer);
            }
            state.composerHoverOpenTimer = setTimeout(() => {
                state.composerHoverOpenTimer = null;
                if (!state.composerOpen) {
                    openPop();
                }
            }, HOVER_INTENT_DELAY_MS);
        }

        function scheduleClosePop(): void {
            if (state.composerHoverOpenTimer) {
                clearTimeout(state.composerHoverOpenTimer);
                state.composerHoverOpenTimer = null;
            }
            if (state.composerPinned) { return; }
            if (state.composerHideTimer) { clearTimeout(state.composerHideTimer); }
            state.composerHideTimer = setTimeout(() => {
                state.composerHideTimer = null;
                if (!state.composerPinned) {
                    closeComposerPopover(false);
                }
            }, HOVER_CLOSE_DELAY_MS);
        }

        trigger.addEventListener('mouseenter', scheduleOpenPopWithIntent);
        trigger.addEventListener('mouseleave', scheduleClosePop);
        popover.addEventListener('mouseenter', () => {
            if (state.composerHideTimer) {
                clearTimeout(state.composerHideTimer);
                state.composerHideTimer = null;
            }
        });
        popover.addEventListener('mouseleave', scheduleClosePop);

        trigger.addEventListener('click', (ev) => {
            ev.stopPropagation();
            clearComposerHoverTimers();
            state.composerPinned = !state.composerPinned;
            trigger.classList.toggle('is-pinned', state.composerPinned);
            pinBadge.style.display = state.composerPinned ? '' : 'none';
            if (state.composerPinned) {
                openPop();
            } else {
                closeComposerPopover(false);
            }
        });

        openBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            triggerOpenPanelAction(state.payload, 'composer', actionFeedback);
        });
        refreshBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            sendBridgeAction(state.payload, 'refresh', 'composer', actionFeedback);
        });

        state.composerHost = host;
        state.composerShadow = shadow;
        state.composerRefs = {
            trigger,
            arc,
            pctCenter,
            popover,
            titleEl,
            healthBadge,
            pinBadge,
            modelNameEl,
            pctHeroEl,
            meterFill,
            tickCompaction,
            tick200k,
            capTokens,
            capWatermarks,
            compactRow,
            compactLabel,
            compactBadge,
            perfLabel,
            speedModeTag,
            kvSpeed,
            kvAvgSpeed,
            kvTtft,
            cacheLabel,
            kvRecentCh,
            kvAvgCh,
            kvTurnState,
            turnBadge,
            tcLabel,
            kvCost,
            kvInOut,
            kvCacheRead,
            kvTotal,
            swarmSec,
            summaryText,
            actionFeedback,
            actionsRow,
            openBtn,
            refreshBtn,
        };
    }

    function anchorComposerHost(): void {
        if (!state.composerEnabled) { return; }
        if (!state.composerHost) { createComposerSlot(); }
        if (!state.composerHost) { return; }
        const anchor = findComposerAnchor();
        if (!anchor || !anchor.parent) {
            if (state.composerHost && state.composerHost.parentNode && isInsideMetadataBar(state.composerHost)) {
                closeComposerPopover(true);
                state.composerHost.parentNode.removeChild(state.composerHost);
            }
            return;
        }
        const anchorBefore = anchor.before === state.composerHost ? state.composerHost.nextSibling : anchor.before;
        const alreadyPlaced = state.composerHost.parentNode === anchor.parent
            && (anchorBefore ? state.composerHost.nextSibling === anchorBefore : state.composerHost.nextSibling === null);
        if (alreadyPlaced) {
            return;
        }
        if (anchorBefore && anchorBefore.parentNode === anchor.parent) {
            anchor.parent.insertBefore(state.composerHost, anchorBefore);
        } else {
            anchor.parent.appendChild(state.composerHost);
        }
        if (state.composerOpen && state.composerRefs) {
            positionPopoverNear(state.composerRefs.trigger, state.composerRefs.popover, true);
        }
    }

    function resolveOverlayContextView(rawPayload: CdpOverlayRuntimePayload, lang: string): ResolvedOverlayContextView {
        const p = rawPayload as CdpOverlayD9Payload;
        const actualBasis: 'compaction' | 'native' = p.actualBasis === 'native' ? 'native' : 'compaction';
        const isZeroStepFresh = p.isZeroStepFresh === true || (p.healthStatus === 'fresh' && p.isIncomplete !== true);
        const primaryDenom = actualBasis === 'native' && typeof p.contextNativeLimit === 'number' && p.contextNativeLimit > 0
            ? p.contextNativeLimit
            : (typeof p.contextEffectiveLimit === 'number' && p.contextEffectiveLimit > 0 ? p.contextEffectiveLimit : null);
        const hasNumericPct = (typeof p.primaryPctRaw === 'number' && Number.isFinite(p.primaryPctRaw))
            || (typeof p.primaryPct === 'number' && Number.isFinite(p.primaryPct))
            || (typeof p.contextPct === 'number' && Number.isFinite(p.contextPct));
        const isIncomplete = p.isIncomplete === true
            || (!isZeroStepFresh && p.primaryPct === null && (p.healthStatus === 'incomplete' || p.primaryPctText === '—' || !hasNumericPct))
            || (!isZeroStepFresh && !hasNumericPct && primaryDenom === null);

        const compactionWarningLevel: 'none' | 'elevated' | 'critical' | 'overflow' =
            p.compactionWarningLevel === 'overflow' || p.compactionWarningLevel === 'critical' || p.compactionWarningLevel === 'elevated'
                ? p.compactionWarningLevel
                : 'none';
        const compactionWarningActive = p.compactionWarningActive === true || compactionWarningLevel !== 'none';

        const subjectCascadeId = typeof p.subjectCascadeId === 'string'
            ? p.subjectCascadeId
            : (typeof p.cascadeId === 'string' ? p.cascadeId : '');
        const dataRevision = typeof p.dataRevision === 'number' && Number.isFinite(p.dataRevision) ? p.dataRevision : 0;

        // Resolve axis-aligned markers from D9 observation projection first, falling back to legacy percentages
        let compactionMarkerPct: number | null = null;
        let tier200kMarkerPct: number | null = null;
        if (Array.isArray(p.markers)) {
            for (let i = 0; i < p.markers.length; i++) {
                const mk = p.markers[i];
                if (!mk || typeof mk.positionPct !== 'number' || !Number.isFinite(mk.positionPct)) { continue; }
                if (mk.id === 'compaction' || mk.id === 'compaction_limit') {
                    compactionMarkerPct = mk.positionPct;
                } else if (mk.id === 'tier_200k' || mk.id === '200k' || mk.tokens === 200000) {
                    tier200kMarkerPct = mk.positionPct;
                }
            }
        } else {
            if (typeof p.compactionThresholdPct === 'number' && Number.isFinite(p.compactionThresholdPct)) {
                compactionMarkerPct = p.compactionThresholdPct;
            }
            if (typeof p.tier200kMarkerPct === 'number' && Number.isFinite(p.tier200kMarkerPct)) {
                tier200kMarkerPct = p.tier200kMarkerPct;
            }
        }

        if (isIncomplete) {
            const capTokensText = primaryDenom !== null
                ? ('— / ' + formatCompact(primaryDenom))
                : '— / —';
            return {
                isIncomplete: true,
                isZeroStepFresh: false,
                actualBasis,
                rawPct: null,
                geometryFillPct: 0,
                pctText: '—',
                ringCenterText: '—',
                pillPctText: '—',
                severity: 'incomplete',
                healthStatus: 'incomplete',
                badgeLabel: bi(lang, 'Unknown', '未知'),
                badgeCls: 'acm-pill-badge',
                compactionWarningActive: false,
                compactionWarningLevel: 'none',
                usedTokens: null,
                denominatorTokens: primaryDenom,
                capTokensText,
                remainingTokens: null,
                compactionMarkerPct,
                tier200kMarkerPct,
                subjectCascadeId,
                dataRevision,
            };
        }

        if (isZeroStepFresh) {
            const capTokensText = primaryDenom !== null
                ? ('0 / ' + formatCompact(primaryDenom))
                : '0 / —';
            return {
                isIncomplete: false,
                isZeroStepFresh: true,
                actualBasis,
                rawPct: 0,
                geometryFillPct: 0,
                pctText: '0%',
                ringCenterText: '0',
                pillPctText: '0%',
                severity: 'normal',
                healthStatus: 'fresh',
                badgeLabel: bi(lang, 'Healthy', '充裕'),
                badgeCls: 'acm-pill-badge is-good',
                compactionWarningActive: false,
                compactionWarningLevel: 'none',
                usedTokens: 0,
                denominatorTokens: primaryDenom,
                capTokensText,
                remainingTokens: primaryDenom,
                compactionMarkerPct,
                tier200kMarkerPct,
                subjectCascadeId,
                dataRevision,
            };
        }

        const rawPct = typeof p.primaryPctRaw === 'number' && Number.isFinite(p.primaryPctRaw)
            ? Math.max(0, p.primaryPctRaw)
            : (typeof p.primaryPct === 'number' && Number.isFinite(p.primaryPct)
                ? Math.max(0, p.primaryPct)
                : (Number.isFinite(Number(p.contextPct)) ? Math.max(0, Number(p.contextPct)) : 0));

        const displayPctNum = typeof p.primaryPct === 'number' && Number.isFinite(p.primaryPct)
            ? Math.max(0, p.primaryPct)
            : Math.round(rawPct * 10) / 10;

        // Geometry (SVG ring / progress bar) ALWAYS clamps to 0..100 while text preserves overflow (e.g. "112%")
        const geometryFillPct = typeof p.geometryFillPct === 'number' && Number.isFinite(p.geometryFillPct)
            ? clampNum(p.geometryFillPct, 0, 100)
            : clampNum(rawPct, 0, 100);

        const hasExplicitD9PctText = typeof p.primaryPctText === 'string' && p.primaryPctText.trim().length > 0;
        const pctText = hasExplicitD9PctText
            ? p.primaryPctText!.trim()
            : (displayPctNum.toFixed(1).replace(/\.0$/, '') + '%');
        const ringCenterText = String(Math.round(displayPctNum));
        // Use canonical D9 `primaryPctText` for 4-surface parity when present; keep legacy integer pill rounding otherwise
        const pillPctText = hasExplicitD9PctText ? pctText : (Math.round(displayPctNum) + '%');

        const healthStatus: ResolvedOverlayContextView['healthStatus'] = p.healthStatus
            ? p.healthStatus
            : (rawPct > 100
                ? 'overflow'
                : (rawPct >= 80 ? 'high_pressure' : (rawPct >= 65 ? 'elevated' : 'healthy')));

        let severity: ResolvedOverlayContextView['severity'] =
            (healthStatus === 'overflow' || healthStatus === 'high_pressure')
                ? 'danger'
                : (healthStatus === 'elevated' ? 'warn' : 'normal');
        // Compaction warning MUST remain visible even when actualBasis === 'native'
        if (compactionWarningActive) {
            if ((compactionWarningLevel === 'critical' || compactionWarningLevel === 'overflow') && severity !== 'danger') {
                severity = 'danger';
            } else if (compactionWarningLevel === 'elevated' && severity === 'normal') {
                severity = 'warn';
            }
        }

        let badgeLabel: string;
        if (healthStatus === 'overflow') {
            badgeLabel = bi(lang, 'Overflow', '超出上限');
        } else if (severity === 'danger') {
            badgeLabel = compactionWarningActive && actualBasis === 'native'
                ? bi(lang, 'Compaction risk', '压缩预警')
                : bi(lang, 'High pressure', '高压预警');
        } else if (severity === 'warn') {
            badgeLabel = compactionWarningActive && actualBasis === 'native'
                ? bi(lang, 'Compaction near', '接近压缩')
                : bi(lang, 'Elevated', '偏高');
        } else {
            badgeLabel = bi(lang, 'Healthy', '充裕');
        }
        const badgeCls = 'acm-pill-badge' + (severity === 'danger' ? ' is-danger' : (severity === 'warn' ? ' is-warn' : ' is-good'));

        const usedTokens = typeof p.contextUsedTokens === 'number' && Number.isFinite(p.contextUsedTokens) && p.contextUsedTokens >= 0
            ? p.contextUsedTokens
            : 0;
        const secondarySuffix = actualBasis === 'compaction'
            && p.contextNativeLimit
            && primaryDenom
            && p.contextNativeLimit > primaryDenom
            ? (' (' + formatCompact(p.contextNativeLimit) + ' max)')
            : (actualBasis === 'native'
                && p.contextEffectiveLimit
                && primaryDenom
                && p.contextEffectiveLimit < primaryDenom
                ? (' (' + formatCompact(p.contextEffectiveLimit) + ' compact)')
                : '');
        const capTokensText = formatCompact(usedTokens) + ' / ' + (primaryDenom !== null ? formatCompact(primaryDenom) : '—') + secondarySuffix;
        const remainingTokens = primaryDenom !== null ? Math.max(0, primaryDenom - usedTokens) : null;

        return {
            isIncomplete: false,
            isZeroStepFresh: false,
            actualBasis,
            rawPct,
            geometryFillPct,
            pctText,
            ringCenterText,
            pillPctText,
            severity,
            healthStatus,
            badgeLabel,
            badgeCls,
            compactionWarningActive,
            compactionWarningLevel,
            usedTokens,
            denominatorTokens: primaryDenom,
            capTokensText,
            remainingTokens,
            compactionMarkerPct,
            tier200kMarkerPct,
            subjectCascadeId,
            dataRevision,
        };
    }

    function resolveSpeedMode(p: CdpOverlayRuntimePayload): { mode: 'decode' | 'e2e'; explicit: boolean } {
        const raw = (p as CdpOverlayD9Payload).speedMode || p.speedMetricMode;
        if (raw === 'e2e') { return { mode: 'e2e', explicit: true }; }
        if (raw === 'decode') { return { mode: 'decode', explicit: true }; }
        return { mode: 'decode', explicit: false };
    }

    function resolveCompactionIndicator(
        p: CdpOverlayRuntimePayload,
        view: ResolvedOverlayContextView,
        lang: string,
    ): { state: 'idle' | 'recommended' | 'active' | 'compacted'; label: string; cls: string; tip: string } {
        const explicit = typeof p.compactionState === 'string' ? p.compactionState.trim().toLowerCase() : '';
        if (explicit === 'active') {
            return {
                state: 'active',
                label: bi(lang, '/compact running', '正在执行 /compact'),
                cls: 'acm-pill-badge is-accent acm-compact-badge acm-has-tip',
                tip: bi(lang, 'Context compaction is currently in progress', '正在压缩上下文历史以释放窗口空间'),
            };
        }
        if (explicit === 'compacted' || p.compactionDetected === true) {
            const drop = typeof p.checkpointCompressionDrop === 'number' && Number.isFinite(p.checkpointCompressionDrop) && p.checkpointCompressionDrop > 0
                ? (' -' + formatCompact(p.checkpointCompressionDrop))
                : '';
            return {
                state: 'compacted',
                label: bi(lang, 'Compacted (/compact)', '已压缩 (/compact)') + drop,
                cls: 'acm-pill-badge is-good acm-compact-badge acm-has-tip',
                tip: bi(lang, 'Recent /compact checkpoint reduced context footprint', '最近一次 /compact 压缩已释放上下文占用'),
            };
        }
        if (explicit === 'recommended' || view.compactionWarningActive || view.severity === 'danger') {
            return {
                state: 'recommended',
                label: bi(lang, 'Suggest /compact', '建议执行 /compact'),
                cls: 'acm-pill-badge acm-compact-badge acm-has-tip ' + (view.severity === 'danger' ? 'is-danger' : 'is-warn'),
                tip: bi(lang, 'Context is nearing compaction threshold — consider running /compact', '上下文接近自动压缩上限，建议适时执行 /compact'),
            };
        }
        return { state: 'idle', label: '', cls: 'acm-pill-badge acm-compact-badge', tip: '' };
    }

    function renderSwarmSummaryInto(
        container: HTMLElement,
        swarmSummary: CdpOverlaySwarmSummary | null | undefined,
        lang: string,
        isTopBar: boolean,
    ): boolean {
        clearChildren(container);
        const members = swarmSummary && Array.isArray(swarmSummary.members) ? swarmSummary.members : [];
        const totalCount = swarmSummary && typeof swarmSummary.totalCount === 'number' && Number.isFinite(swarmSummary.totalCount)
            ? Math.max(0, Math.round(swarmSummary.totalCount))
            : members.length;
        const activeCount = swarmSummary && typeof swarmSummary.activeCount === 'number' && Number.isFinite(swarmSummary.activeCount)
            ? Math.max(0, Math.round(swarmSummary.activeCount))
            : 0;
        if (!swarmSummary || (totalCount <= 0 && members.length === 0)) {
            return false;
        }

        const head = el('div', 'acm-swarm-head');
        head.appendChild(el('div', isTopBar ? 'acm-qp-section-title' : 'acm-section-label', bi(lang, 'Swarm Members', '多智能体成员')));
        head.appendChild(el(
            'span',
            'acm-pill-badge is-accent acm-num',
            activeCount + '/' + totalCount + ' ' + bi(lang, 'active', '活跃'),
        ));
        container.appendChild(head);

        if (typeof swarmSummary.rootTitle === 'string' && swarmSummary.rootTitle.trim()) {
            container.appendChild(el(
                'div',
                'acm-swarm-root',
                bi(lang, 'Root', '主会话') + ': ' + swarmSummary.rootTitle.trim(),
            ));
        }

        const maxVisible = 8;
        const list = el('div', 'acm-swarm-list');
        list.setAttribute('role', 'list');
        list.setAttribute('aria-label', bi(lang, 'Swarm member status list', '多智能体成员状态列表'));
        const limit = Math.min(members.length, maxVisible);
        for (let i = 0; i < limit; i++) {
            const m = members[i];
            if (!m || typeof m.name !== 'string') { continue; }
            const row = el('div', m.isInspected ? 'acm-swarm-row is-inspected' : 'acm-swarm-row');
            row.setAttribute('role', 'listitem');
            if (m.isInspected) {
                row.setAttribute('aria-current', 'true');
            }
            const nameEl = el('span', 'acm-swarm-name', m.name);
            const meta = el('span', 'acm-swarm-meta acm-num');
            if (m.isInspected) {
                meta.appendChild(el('span', 'acm-pill-badge is-accent', bi(lang, 'Viewing', '查看中')));
            }
            if (typeof m.phase === 'string' && m.phase.trim()) {
                meta.appendChild(el('span', 'acm-swarm-phase', m.phase.trim()));
            }
            const pctStr = typeof m.pct === 'number' && Number.isFinite(m.pct) ? (Math.round(m.pct) + '%') : '—';
            meta.appendChild(el('span', 'acm-v acm-num', pctStr));
            row.appendChild(nameEl);
            row.appendChild(meta);
            list.appendChild(row);
        }
        container.appendChild(list);

        if (members.length > maxVisible) {
            const extra = members.length - maxVisible;
            container.appendChild(el(
                'div',
                'acm-swarm-more',
                bi(lang, '+' + extra + ' more members', '另有 ' + extra + ' 个成员'),
            ));
        }
        return true;
    }

    function resolveQuotaDisplayConfig(p: CdpOverlayRuntimePayload, lang: string): {
        windowMode: '5h' | '7d' | 'tightest';
        directionMode: 'remaining' | 'used';
        explicitWindow: boolean;
        explicitDirection: boolean;
        directionLabel: string;
        windowModeLabel: string;
    } {
        const rawWin = typeof p.quotaWindowMode === 'string' ? p.quotaWindowMode.trim().toLowerCase() : '';
        const rawDir = typeof p.quotaDirectionMode === 'string' ? p.quotaDirectionMode.trim().toLowerCase() : '';
        const windowMode: '5h' | '7d' | 'tightest' = rawWin === '7d' ? '7d' : (rawWin === '5h' ? '5h' : 'tightest');
        const directionMode: 'remaining' | 'used' = rawDir === 'used' ? 'used' : 'remaining';
        const explicitWindow = rawWin === '5h' || rawWin === '7d' || rawWin === 'tightest';
        const explicitDirection = rawDir === 'remaining' || rawDir === 'used';
        const directionLabel = directionMode === 'used'
            ? bi(lang, 'Used', '已用')
            : bi(lang, 'Remaining', '剩余');
        const windowModeLabel = windowMode === '7d'
            ? bi(lang, 'Weekly window', '每周窗口')
            : (windowMode === '5h' ? bi(lang, '5-hour window', '5 小时窗口') : bi(lang, 'Lower remaining quota', '按剩余较少的窗口'));
        return {
            windowMode,
            directionMode,
            explicitWindow,
            explicitDirection,
            directionLabel,
            windowModeLabel,
        };
    }

    function applyObservationAttrs(host: HTMLElement | null, view: ResolvedOverlayContextView, compactState: string): void {
        if (!host) { return; }
        host.setAttribute('data-observation-subject', view.subjectCascadeId);
        host.setAttribute('data-observation-data-rev', String(view.dataRevision));
        host.setAttribute('data-observation-pct', view.pctText);
        host.setAttribute('data-observation-health', view.healthStatus);
        host.setAttribute('data-observation-basis', view.actualBasis);
        host.setAttribute('data-compaction-warning', view.compactionWarningActive ? view.compactionWarningLevel : 'none');
        host.setAttribute('data-compact-state', compactState);
    }

    function renderComposer(): void {
        if (!state.composerEnabled || !state.composerRefs || !state.payload) { return; }
        const p = state.payload as CdpOverlayD9Payload;
        const r = state.composerRefs;
        const lang = p.language || 'both';
        const view = resolveOverlayContextView(p, lang);
        const compactInfo = resolveCompactionIndicator(p, view, lang);
        const speedInfo = resolveSpeedMode(p);
        applyObservationAttrs(state.composerHost, view, compactInfo.state);

        const offset = RING_CIRC * (1 - view.geometryFillPct / 100);
        r.arc.setAttribute('stroke-dashoffset', offset.toFixed(2));
        r.arc.classList.toggle('is-warn', view.severity === 'warn');
        r.arc.classList.toggle('is-danger', view.severity === 'danger');
        r.pctCenter.textContent = view.ringCenterText;
        r.trigger.setAttribute(
            'aria-label',
            bi(lang, 'Context usage', '上下文用量') + ' ' + view.pctText + ' · ' + view.badgeLabel,
        );
        r.popover.setAttribute(
            'aria-label',
            state.composerPinned
                ? bi(lang, 'Context usage details (Pinned)', '上下文用量详情（冻结面板）')
                : bi(lang, 'Context usage details', '上下文用量详情'),
        );

        r.titleEl.textContent = bi(lang, 'Usage', '用量');
        r.healthBadge.className = view.badgeCls;
        r.healthBadge.textContent = view.badgeLabel;
        r.pinBadge.textContent = bi(lang, 'Pinned', '冻结面板');
        r.modelNameEl.textContent = p.modelName || bi(lang, 'No active model', '暂无活跃模型');
        r.pctHeroEl.textContent = view.pctText;
        r.pctHeroEl.classList.toggle('is-warn', view.severity === 'warn');
        r.pctHeroEl.classList.toggle('is-danger', view.severity === 'danger');

        r.meterFill.style.width = view.geometryFillPct.toFixed(1) + '%';
        r.meterFill.classList.toggle('is-warn', view.severity === 'warn');
        r.meterFill.classList.toggle('is-danger', view.severity === 'danger');

        const marks: string[] = [];
        if (view.actualBasis === 'native') {
            marks.push(bi(lang, 'Native Cap', '原生窗口上限'));
        }
        if (view.compactionWarningActive && view.actualBasis === 'native') {
            const cpPctStr = typeof p.compactionPct === 'number' && Number.isFinite(p.compactionPct)
                ? (' ' + p.compactionPct.toFixed(1).replace(/\.0$/, '') + '%')
                : '';
            marks.push(bi(lang, 'Compaction warning', '压缩预警') + cpPctStr);
        }
        if (view.compactionMarkerPct !== null && view.compactionMarkerPct > 2 && view.compactionMarkerPct < 99) {
            const compPct = clampNum(view.compactionMarkerPct, 2, 98);
            const compTip = bi(lang, 'Auto-compaction limit', '自动压缩上限') + ' ' + Math.round(view.compactionMarkerPct) + '%';
            r.tickCompaction.style.display = '';
            r.tickCompaction.style.left = compPct.toFixed(1) + '%';
            r.tickCompaction.classList.toggle('is-align-left', compPct <= 35);
            r.tickCompaction.classList.toggle('is-align-right', compPct >= 62);
            r.tickCompaction.setAttribute('role', 'img');
            r.tickCompaction.setAttribute('tabindex', '0');
            if (typeof r.tickCompaction.removeAttribute === 'function') { r.tickCompaction.removeAttribute('title'); }
            r.tickCompaction.setAttribute('data-tooltip', compTip);
            r.tickCompaction.setAttribute('aria-label', compTip);
            marks.push(bi(lang, 'Compact', '压缩') + ' ' + Math.round(view.compactionMarkerPct) + '%');
        } else {
            r.tickCompaction.style.display = 'none';
        }
        if (view.tier200kMarkerPct !== null && view.tier200kMarkerPct > 2 && view.tier200kMarkerPct < 99) {
            const tierPct = clampNum(view.tier200kMarkerPct, 2, 98);
            const tierTip = getTier200kTooltip(lang);
            r.tick200k.style.display = '';
            r.tick200k.style.left = tierPct.toFixed(1) + '%';
            r.tick200k.classList.toggle('is-align-left', tierPct <= 35);
            r.tick200k.classList.toggle('is-align-right', tierPct >= 62);
            r.tick200k.setAttribute('role', 'img');
            r.tick200k.setAttribute('tabindex', '0');
            if (typeof r.tick200k.removeAttribute === 'function') { r.tick200k.removeAttribute('title'); }
            r.tick200k.setAttribute('data-tooltip', tierTip);
            r.tick200k.setAttribute('aria-label', tierTip);
            marks.push('200k');
        } else {
            r.tick200k.style.display = 'none';
        }
        r.capTokens.textContent = view.capTokensText;
        r.capWatermarks.textContent = marks.join(' · ');

        // `/compact` state indicator
        r.compactRow.setAttribute('data-compact-state', compactInfo.state);
        if (compactInfo.state !== 'idle') {
            r.compactRow.style.display = 'flex';
            r.compactLabel.textContent = bi(lang, 'Compaction (/compact)', '压缩状态 (/compact)');
            r.compactBadge.className = compactInfo.cls;
            r.compactBadge.textContent = compactInfo.label;
            r.compactBadge.setAttribute('tabindex', '0');
            r.compactBadge.setAttribute('data-tooltip', compactInfo.tip);
            r.compactBadge.setAttribute('aria-label', compactInfo.label + ' — ' + compactInfo.tip);
        } else {
            r.compactRow.style.display = 'none';
        }

        // Performance
        r.perfLabel.textContent = bi(lang, 'Performance', '性能');
        r.speedModeTag.textContent = speedInfo.mode === 'e2e'
            ? bi(lang, 'E2E', '端到端 E2E')
            : bi(lang, 'Decode', '生成速率 Decode');
        r.speedModeTag.setAttribute('data-speed-mode', speedInfo.mode);
        r.kvSpeed.k.textContent = speedInfo.mode === 'e2e'
            ? bi(lang, 'E2E Speed (Model Call)', '模型调用端到端速度')
            : bi(lang, 'Output Speed (Decode)', '输出速度（Decode）');
        r.kvAvgSpeed.k.textContent = bi(lang, 'Avg Output Speed', '平均速度');
        r.kvTtft.k.textContent = bi(lang, 'First Token (TTFT)', '首字延迟');

        clearChildren(r.kvSpeed.v);
        const composerSpeed = typeof p.displaySpeedTps === 'number' && Number.isFinite(p.displaySpeedTps) && p.displaySpeedTps > 0
            ? p.displaySpeedTps
            : p.outputSpeedTps;
        if (p.isWaitingTtft) {
            r.kvSpeed.v.appendChild(el('span', 'acm-pill-badge is-warn', bi(lang, 'Waiting', '等待首字')));
        } else if (p.isShortSample) {
            r.kvSpeed.v.appendChild(el('span', 'acm-pill-badge is-warn', bi(lang, 'Short sample', '短样本')));
            if (typeof composerSpeed === 'number' && Number.isFinite(composerSpeed) && composerSpeed > 0) {
                r.kvSpeed.v.appendChild(el('span', 'acm-v-sub', '(' + composerSpeed.toFixed(1) + ')'));
            }
        } else {
            r.kvSpeed.v.textContent = formatTps(composerSpeed);
        }
        r.kvAvgSpeed.v.textContent = formatTps(p.avgOutputSpeedTps);
        r.kvTtft.v.textContent = formatTtft(p.ttftMs);

        // Cache
        r.cacheLabel.textContent = bi(lang, 'Cache', '缓存');
        r.kvRecentCh.k.textContent = bi(lang, 'Recent Cache Hit', '近期缓存命中');
        r.kvAvgCh.k.textContent = bi(lang, 'Avg Cache Hit', '平均缓存命中');
        r.kvTurnState.k.textContent = bi(lang, 'Turn Cache State', '轮次缓存状态');
        r.kvRecentCh.v.textContent = formatPct(p.recentCacheHitPct);
        r.kvAvgCh.v.textContent = formatPct(p.avgCacheHitPct);

        applyTurnCacheBadgeProps(r.turnBadge, lang, p.turnCacheState);

        // Tokens & Cost (explicitly scoped to Current Conversation vs Today/Cumulative)
        r.tcLabel.textContent = bi(lang, 'Tokens & Cost', '用量与费用');
        r.kvCost.k.textContent = bi(lang, 'Current Chat Cost (Est.)', '当前会话费用（估算）');
        r.kvInOut.k.textContent = bi(lang, 'Input / Output', '输入 / 输出');
        r.kvCacheRead.k.textContent = bi(lang, 'Cache Read', '缓存读取');
        r.kvTotal.k.textContent = bi(lang, 'Current Chat Tokens', '当前会话总 Tokens');

        clearChildren(r.kvCost.v);
        const costStr = formatUsd(p.estCostUsd, p.estCostFormatted);
        r.kvCost.v.appendChild(document.createTextNode(costStr));
        if (p.localCostFormatted) {
            r.kvCost.v.appendChild(el('span', 'acm-v-sub', '≈ ' + p.localCostFormatted));
        }
        r.kvInOut.v.textContent = formatCompact(p.inputTokens) + ' / ' + formatCompact(p.outputTokens);
        r.kvCacheRead.v.textContent = formatCompact(p.cacheReadTokens);
        r.kvTotal.v.textContent = formatCompact(p.totalTokens);

        // Optional lightweight Swarm member summary embedded inside existing Context Popover
        const hasSwarm = renderSwarmSummaryInto(r.swarmSec, p.swarmSummary, lang, false);
        r.swarmSec.style.display = hasSwarm ? 'flex' : 'none';

        // Bottom pill summary
        const summaryParts: string[] = [];
        if (typeof p.recentCacheHitPct === 'number' && Number.isFinite(p.recentCacheHitPct)) {
            summaryParts.push('CH ' + Math.round(p.recentCacheHitPct) + '%');
        }
        if (p.isShortSample) {
            summaryParts.push(bi(lang, 'Short sample', '短样本'));
        } else if (typeof composerSpeed === 'number' && Number.isFinite(composerSpeed) && composerSpeed > 0) {
            summaryParts.push(composerSpeed.toFixed(1) + ' tok/s');
        }
        if (costStr !== '—') {
            summaryParts.push(costStr);
        }
        r.summaryText.textContent = summaryParts.length > 0 ? summaryParts.join(' · ') : bi(lang, 'Telemetry active', '监控已就绪');

        const openLabel = bi(lang, 'Open Panel', '打开面板');
        const refreshLabel = bi(lang, 'Refresh', '刷新');
        r.openBtn.textContent = openLabel;
        r.openBtn.setAttribute('aria-label', openLabel);
        r.refreshBtn.textContent = refreshLabel;
        r.refreshBtn.setAttribute('aria-label', refreshLabel);
        const hasBridge = hasLoopbackBridge(p);
        const canOpenDirectly = Boolean(findVisibleAuxSidebarToggle());
        r.openBtn.style.display = (hasBridge || canOpenDirectly) ? '' : 'none';
        r.refreshBtn.style.display = hasBridge ? '' : 'none';
        r.actionsRow.style.display = (hasBridge || canOpenDirectly) ? 'flex' : 'none';
        if (state.composerOpen) {
            positionPopoverNear(r.trigger, r.popover, true);
        }
    }

    function makeMiniRing(isAccent: boolean): MiniRingRefs {
        const svg = svgEl('svg', { class: 'acm-mini-ring', viewBox: '0 0 14 14', 'aria-hidden': 'true' });
        const track = svgEl('circle', { class: 'acm-mini-track', cx: '7', cy: '7', r: String(MINI_RADIUS) });
        const arc = svgEl('circle', {
            class: isAccent ? 'acm-mini-arc is-accent' : 'acm-mini-arc',
            cx: '7',
            cy: '7',
            r: String(MINI_RADIUS),
            'stroke-dasharray': MINI_CIRC.toFixed(2),
            'stroke-dashoffset': MINI_CIRC.toFixed(2),
            transform: 'rotate(-90 7 7)',
        });
        svg.appendChild(track);
        svg.appendChild(arc);
        return { svg, arc };
    }

    const TOPBAR_VIEWS: CdpTopBarViewKey[] = ['quota', 'context', 'speed', 'total'];

    function normalizeTopBarView(view: string | null | undefined): CdpTopBarViewKey {
        if (view === 'quota' || view === 'context' || view === 'speed' || view === 'total') {
            return view;
        }
        return 'quota';
    }

    function getTopBarPillForView(view: CdpTopBarViewKey): HTMLButtonElement | null {
        if (!state.topBarRefs) { return null; }
        const r = state.topBarRefs;
        if (view === 'context') { return r.ctxPill; }
        if (view === 'speed') { return r.speedPill; }
        if (view === 'total') { return r.totalPill; }
        return r.quotaPill;
    }

    function resolveTopBarAnchor(view: CdpTopBarViewKey, explicitAnchor: Element | null): Element | null {
        if (!state.topBarRefs) { return explicitAnchor || null; }
        const r = state.topBarRefs;
        if (r.cluster && state.topBarHost && state.topBarHost.isConnected) {
            const cRect = getSafeRect(r.cluster);
            if (cRect && cRect.width > 0 && cRect.height > 0) {
                return r.cluster;
            }
        }
        if (explicitAnchor && !explicitAnchor.classList.contains('is-hidden')) {
            return explicitAnchor;
        }
        const pill = getTopBarPillForView(view);
        if (pill && !pill.classList.contains('is-hidden')) {
            return pill;
        }
        if (r.overflowBtn && !r.overflowBtn.classList.contains('is-hidden')) {
            return r.overflowBtn;
        }
        return r.cluster || r.quotaPill;
    }

    function syncTopBarPillStates(): void {
        if (!state.topBarRefs) { return; }
        const r = state.topBarRefs;
        const active = state.topBarActiveView;
        const tabActive = active || 'quota';
        for (let i = 0; i < TOPBAR_VIEWS.length; i++) {
            const v = TOPBAR_VIEWS[i];
            const pill = getTopBarPillForView(v);
            const isPillActive = active === v;
            if (pill) {
                pill.classList.toggle('is-active', isPillActive);
                pill.setAttribute('aria-expanded', isPillActive ? 'true' : 'false');
            }
            const tabBtn = r.qpTabs && r.qpTabs[v];
            if (tabBtn) {
                const isTabActive = tabActive === v;
                tabBtn.classList.toggle('is-active', isTabActive);
                tabBtn.setAttribute('aria-selected', isTabActive ? 'true' : 'false');
            }
        }
    }

    function clearTopBarHoverTimers(): void {
        if (state.topBarHoverOpenTimer) {
            clearTimeout(state.topBarHoverOpenTimer);
            state.topBarHoverOpenTimer = null;
        }
        if (state.topBarHoverCloseTimer) {
            clearTimeout(state.topBarHoverCloseTimer);
            state.topBarHoverCloseTimer = null;
        }
    }

    function closeOverflowMenu(): void {
        state.overflowOpen = false;
        if (state.topBarRefs) {
            state.topBarRefs.overflowMenu.classList.remove('is-open');
            closeTopLayerPopover(state.topBarRefs.overflowMenu);
            state.topBarRefs.overflowBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function closeTopBarPopover(): void {
        clearTopBarHoverTimers();
        state.topBarActiveView = null;
        state.topBarPinned = false;
        if (state.topBarRefs) {
            state.topBarRefs.quotaPopover.classList.remove('is-open');
            closeTopLayerPopover(state.topBarRefs.quotaPopover);
            if (typeof state.topBarRefs.quotaPopover.removeAttribute === 'function') {
                state.topBarRefs.quotaPopover.removeAttribute('data-active-view');
            } else {
                state.topBarRefs.quotaPopover.setAttribute('data-active-view', '');
            }
            syncTopBarPillStates();
        }
    }

    function openTopBarView(view: CdpTopBarViewKey, anchorPill: Element | null, pin = true): void {
        if (!state.topBarRefs) { return; }
        clearTopBarHoverTimers();
        const nextView = normalizeTopBarView(view);
        closeOverflowMenu();
        state.topBarActiveView = nextView;
        state.topBarPinned = pin;
        state.topBarRefs.quotaPopover.setAttribute('data-active-view', nextView);
        state.topBarRefs.quotaPopover.setAttribute('data-pinned', pin ? 'true' : 'false');
        state.topBarRefs.qpFooterFeedback.textContent = '';
        syncTopBarPillStates();
        renderTopBarPopover();
        const targetAnchor = resolveTopBarAnchor(nextView, anchorPill);
        positionPopoverNear(targetAnchor, state.topBarRefs.quotaPopover, false);
    }

    function toggleTopBarView(view: CdpTopBarViewKey, anchorPill: Element | null): void {
        const nextView = normalizeTopBarView(view);
        if (state.topBarActiveView === nextView && state.topBarPinned) {
            closeTopBarPopover();
            return;
        }
        openTopBarView(nextView, anchorPill, true);
    }

    function createTopBarSlot(): void {
        const existingNode = document.getElementById(TOPBAR_HOST_ID);
        if (existingNode && existingNode.parentNode) {
            existingNode.parentNode.removeChild(existingNode);
        }

        const host = el('div');
        host.id = TOPBAR_HOST_ID;
        host.setAttribute('data-acm-overlay', 'topbar');
        host.setAttribute('data-no-drag', '');
        host.setAttribute('data-theme', detectHostTheme(state.payload ? state.payload.theme : undefined));
        host.setAttribute('data-font-size', resolveFontSizePreset(state.payload));
        host.setAttribute('data-contrast', detectHostHighContrast(state.payload) ? 'high' : 'normal');
        host.style.flexShrink = '0';

        const shadow = host.attachShadow({ mode: 'open' });
        const styleEl = el('style');
        styleEl.textContent = TOPBAR_CSS;
        shadow.appendChild(styleEl);

        const cluster = el('div', 'acm-bar-cluster');

        // 1. Tightest quota pill
        const quotaPill = el('button', 'acm-bar-pill acm-num');
        quotaPill.type = 'button';
        quotaPill.setAttribute('data-view', 'quota');
        quotaPill.setAttribute('aria-haspopup', 'dialog');
        quotaPill.setAttribute('aria-expanded', 'false');
        const qRing = makeMiniRing(false);
        const qPctText = el('span', '', '—');
        const qWinTag = el('span', 'acm-bar-tag', '5h');
        quotaPill.appendChild(qRing.svg);
        quotaPill.appendChild(qPctText);
        quotaPill.appendChild(qWinTag);

        // 2. Context ring pill
        const ctxPill = el('button', 'acm-bar-pill acm-num');
        ctxPill.type = 'button';
        ctxPill.setAttribute('data-view', 'context');
        ctxPill.setAttribute('aria-haspopup', 'dialog');
        ctxPill.setAttribute('aria-expanded', 'false');
        const cRing = makeMiniRing(true);
        const cPctText = el('span', '', '0%');
        ctxPill.appendChild(cRing.svg);
        ctxPill.appendChild(cPctText);

        // 3. Speed / short-sample pill
        const speedPill = el('button', 'acm-bar-pill acm-num', '—');
        speedPill.type = 'button';
        speedPill.setAttribute('data-view', 'speed');
        speedPill.setAttribute('aria-haspopup', 'dialog');
        speedPill.setAttribute('aria-expanded', 'false');

        // 4. Cumulative recorded tokens pill
        const totalPill = el('button', 'acm-bar-pill acm-num', '0');
        totalPill.type = 'button';
        totalPill.setAttribute('data-view', 'total');
        totalPill.setAttribute('aria-haspopup', 'dialog');
        totalPill.setAttribute('aria-expanded', 'false');

        // 5. Overflow button (···) for narrow windows
        const overflowBtn = el('button', 'acm-bar-pill is-hidden', '···');
        overflowBtn.type = 'button';
        overflowBtn.setAttribute('data-action', 'overflow');
        overflowBtn.setAttribute('aria-label', 'More telemetry');
        overflowBtn.setAttribute('aria-expanded', 'false');

        // Preserve composer focus on all TopBar pill pointer-downs
        preventFocusStealOnMouseDown(quotaPill);
        preventFocusStealOnMouseDown(ctxPill);
        preventFocusStealOnMouseDown(speedPill);
        preventFocusStealOnMouseDown(totalPill);
        preventFocusStealOnMouseDown(overflowBtn);

        cluster.appendChild(quotaPill);
        cluster.appendChild(ctxPill);
        cluster.appendChild(speedPill);
        cluster.appendChild(totalPill);
        cluster.appendChild(overflowBtn);

        const wcoSpacer = el('div', 'acm-wco-spacer');
        wcoSpacer.setAttribute('aria-hidden', 'true');

        const overflowMenu = el('div', 'acm-overflow-menu') as PopoverCapableElement;
        overflowMenu.setAttribute('role', 'menu');
        overflowMenu.setAttribute('popover', 'manual');

        const quotaPopover = el('div', 'acm-quota-popover') as PopoverCapableElement;
        quotaPopover.setAttribute('role', 'dialog');
        quotaPopover.setAttribute('aria-modal', 'false');
        quotaPopover.setAttribute('popover', 'manual');

        const qpHead = el('div', 'acm-qp-head');
        const qpTitleWrap = el('div');
        const qpTitle = el('div', 'acm-qp-title', 'Model Quota Board / 模型配额面板');
        const qpMeta = el('div', 'acm-qp-meta acm-num', '—');
        qpTitleWrap.appendChild(qpTitle);
        qpTitleWrap.appendChild(qpMeta);

        const qpHeadActions = el('div', 'acm-qp-head-actions');
        const qpRefreshBtn = el('button', 'acm-btn', 'Refresh');
        qpRefreshBtn.type = 'button';
        const qpOpenBtn = el('button', 'acm-btn is-primary', 'Open Panel');
        qpOpenBtn.type = 'button';
        const qpCloseBtn = el('button', 'acm-btn', '×');
        qpCloseBtn.type = 'button';
        qpCloseBtn.setAttribute('data-action', 'close');
        qpCloseBtn.setAttribute('aria-label', 'Close');
        qpHeadActions.appendChild(qpRefreshBtn);
        qpHeadActions.appendChild(qpOpenBtn);
        qpHeadActions.appendChild(qpCloseBtn);
        qpHead.appendChild(qpTitleWrap);
        qpHead.appendChild(qpHeadActions);

        const qpTabsBar = el('div', 'acm-qp-tabs');
        qpTabsBar.setAttribute('role', 'tablist');
        const qpTabs = {} as Record<CdpTopBarViewKey, HTMLButtonElement>;
        for (let ti = 0; ti < TOPBAR_VIEWS.length; ti++) {
            const viewKey = TOPBAR_VIEWS[ti];
            const tabBtn = el('button', 'acm-qp-tab', viewKey);
            tabBtn.type = 'button';
            tabBtn.setAttribute('role', 'tab');
            tabBtn.setAttribute('data-tab-view', viewKey);
            tabBtn.setAttribute('aria-selected', viewKey === 'quota' ? 'true' : 'false');
            tabBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                openTopBarView(viewKey, getTopBarPillForView(viewKey), true);
            });
            qpTabs[viewKey] = tabBtn;
            qpTabsBar.appendChild(tabBtn);
        }

        const qpBody = el('div', 'acm-qp-body');

        const qpFooter = el('div', 'acm-qp-footer acm-num');
        const qpFooterTotal = el('span', '', '');
        const qpFooterFeedback = el('span', '', '');
        qpFooterFeedback.setAttribute('role', 'status');
        qpFooterFeedback.setAttribute('aria-live', 'polite');
        qpFooter.appendChild(qpFooterTotal);
        qpFooter.appendChild(qpFooterFeedback);

        quotaPopover.appendChild(qpHead);
        quotaPopover.appendChild(qpTabsBar);
        quotaPopover.appendChild(qpBody);
        quotaPopover.appendChild(qpFooter);

        shadow.appendChild(cluster);
        shadow.appendChild(wcoSpacer);
        shadow.appendChild(overflowMenu);
        shadow.appendChild(quotaPopover);

        // 250ms Hover-Intent delay + 350ms warm sibling window for zero-delay adjacent pill switching
        function scheduleTopBarHoverClose(): void {
            if (state.topBarHoverOpenTimer) {
                clearTimeout(state.topBarHoverOpenTimer);
                state.topBarHoverOpenTimer = null;
            }
            if (state.topBarPinned || !state.topBarActiveView) { return; }
            state.topBarWarmUntilMs = Date.now() + HOVER_WARM_SIBLING_WINDOW_MS;
            if (state.topBarHoverCloseTimer) { clearTimeout(state.topBarHoverCloseTimer); }
            state.topBarHoverCloseTimer = setTimeout(() => {
                state.topBarHoverCloseTimer = null;
                if (!state.topBarPinned) {
                    state.topBarWarmUntilMs = Date.now() + HOVER_WARM_SIBLING_WINDOW_MS;
                    closeTopBarPopover();
                }
            }, HOVER_CLOSE_DELAY_MS);
        }

        function bindTopBarPillHover(pill: HTMLButtonElement, viewKey: CdpTopBarViewKey): void {
            pill.addEventListener('mouseenter', () => {
                if (state.topBarPinned) { return; }
                if (state.topBarHoverCloseTimer) {
                    clearTimeout(state.topBarHoverCloseTimer);
                    state.topBarHoverCloseTimer = null;
                }
                if (state.topBarHoverOpenTimer) {
                    clearTimeout(state.topBarHoverOpenTimer);
                    state.topBarHoverOpenTimer = null;
                }
                const nowMs = Date.now();
                const isAlreadyHoverOpen = state.topBarActiveView !== null && !state.topBarPinned;
                const isWarmSibling = nowMs <= state.topBarWarmUntilMs;
                if (isAlreadyHoverOpen || isWarmSibling) {
                    state.topBarWarmUntilMs = nowMs + HOVER_WARM_SIBLING_WINDOW_MS;
                    openTopBarView(viewKey, pill, false);
                    return;
                }
                state.topBarHoverOpenTimer = setTimeout(() => {
                    state.topBarHoverOpenTimer = null;
                    if (!state.topBarPinned) {
                        state.topBarWarmUntilMs = Date.now() + HOVER_WARM_SIBLING_WINDOW_MS;
                        openTopBarView(viewKey, pill, false);
                    }
                }, HOVER_INTENT_DELAY_MS);
            });
            pill.addEventListener('mouseleave', scheduleTopBarHoverClose);
        }

        bindTopBarPillHover(quotaPill, 'quota');
        bindTopBarPillHover(ctxPill, 'context');
        bindTopBarPillHover(speedPill, 'speed');
        bindTopBarPillHover(totalPill, 'total');

        quotaPopover.addEventListener('mouseenter', () => {
            if (state.topBarHoverCloseTimer) {
                clearTimeout(state.topBarHoverCloseTimer);
                state.topBarHoverCloseTimer = null;
            }
            if (!state.topBarPinned && state.topBarActiveView) {
                state.topBarWarmUntilMs = Date.now() + HOVER_WARM_SIBLING_WINDOW_MS;
            }
        });
        quotaPopover.addEventListener('mouseleave', scheduleTopBarHoverClose);

        quotaPill.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleTopBarView('quota', quotaPill);
        });
        ctxPill.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleTopBarView('context', ctxPill);
        });
        speedPill.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleTopBarView('speed', speedPill);
        });
        totalPill.addEventListener('click', (ev) => {
            ev.stopPropagation();
            toggleTopBarView('total', totalPill);
        });

        overflowBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closeTopBarPopover();
            state.overflowOpen = !state.overflowOpen;
            overflowBtn.setAttribute('aria-expanded', state.overflowOpen ? 'true' : 'false');
            if (state.overflowOpen) {
                positionPopoverNear(overflowBtn, overflowMenu, false);
            } else {
                overflowMenu.classList.remove('is-open');
                closeTopLayerPopover(overflowMenu);
            }
        });

        qpCloseBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closeTopBarPopover();
        });

        qpRefreshBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            sendBridgeAction(state.payload, 'refresh', 'topbar', qpFooterFeedback);
        });
        qpOpenBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const targetTab = getTargetTabForTopBarView(state.topBarActiveView || 'quota');
            triggerOpenPanelAction(state.payload, 'topbar', qpFooterFeedback, targetTab);
        });

        state.topBarHost = host;
        state.topBarShadow = shadow;
        state.topBarRefs = {
            cluster,
            quotaPill,
            qRing,
            qPctText,
            qWinTag,
            ctxPill,
            cRing,
            cPctText,
            speedPill,
            totalPill,
            overflowBtn,
            overflowMenu,
            wcoSpacer,
            quotaPopover,
            qpTitle,
            qpMeta,
            qpRefreshBtn,
            qpOpenBtn,
            qpCloseBtn,
            qpTabsBar,
            qpTabs,
            qpBody,
            qpFooterTotal,
            qpFooterFeedback,
        };
    }

    function hasLiveAntigravityShellGeometry(): boolean {
        return Boolean(
            document.querySelector('.agy-sheet, [data-testid="sidebar-split"], [data-side-panel-strip], [data-testid="sidebar-toggle"]'),
        );
    }

    function applyTopBarResponsiveLayout(): void {
        if (!state.topBarRefs) { return; }
        const r = state.topBarRefs;
        const vw = window.innerWidth || 1280;
        const auxBtn = findVisibleAuxSidebarToggle();
        const auxOpen = Boolean(auxBtn && auxBtn.getAttribute('aria-expanded') === 'true');
        const wcoPx = computeWcoInsetPx(state.topBarAnchorMode === 'fixed');
        let hideTotal = false;
        let hideSpeed = false;
        let hideCtx = false;

        if (hasLiveAntigravityShellGeometry()) {
            const sidebarRight = getOpenSidebarRightPx();
            const leftChromeRight = getLeftChromeRightPx();
            const leftObstruction = Math.max(sidebarRight, leftChromeRight);
            const rightChromeLeft = getRightChromeLeftPx();
            const strip = document.querySelector('[data-side-panel-strip]');
            const stripVisible = Boolean(strip && isElementVisible(strip));
            let freeSpace = vw;

            if ((state.topBarAnchorTier === 'right-overlay' || state.topBarAnchorTier === 'fixed') && auxOpen && stripVisible && strip) {
                const spacer = strip.querySelector ? strip.querySelector('[data-testid="side-panel-drag-spacer"]') : null;
                const spacerRect = spacer && isElementVisible(spacer) ? getSafeRect(spacer) : null;
                let auxTabsRight = 0;
                if (spacerRect && spacerRect.left > 0) {
                    auxTabsRight = Math.round(spacerRect.left);
                } else {
                    const stripRect = getSafeRect(strip);
                    auxTabsRight = stripRect ? Math.round(stripRect.left) : 0;
                    const stripChildren = getElementChildren(strip);
                    for (let si = 0; si < stripChildren.length; si++) {
                        const sc = stripChildren[si];
                        if (!sc || sc.id === TOPBAR_HOST_ID || sc.getAttribute('data-testid') === 'side-panel-drag-spacer') {
                            continue;
                        }
                        if (!isElementVisible(sc)) { continue; }
                        const scRect = getSafeRect(sc);
                        if (scRect && scRect.right > auxTabsRight) {
                            auxTabsRight = Math.round(scRect.right);
                        }
                    }
                }
                freeSpace = Math.max(0, rightChromeLeft - auxTabsRight - 16);
            } else if (state.topBarAnchorTier === 'pane-toolbar') {
                const tbHostParent = state.topBarHost && state.topBarHost.parentElement;
                const tbOuter = tbHostParent && tbHostParent.parentElement;
                const tbOuterRect = getSafeRect(tbOuter);
                const tbHostRect = getSafeRect(tbHostParent);
                const tbRectLive = tbOuterRect || tbHostRect;
                const leftEdge = Math.max(leftObstruction, (tbRectLive && tbRectLive.left > 0) ? Math.round(tbRectLive.left) : 0);
                let tbRightBound = (tbRectLive && tbRectLive.right > 0) ? Math.round(tbRectLive.right) : rightChromeLeft;
                if (tbHostRect && tbHostRect.right > 0) {
                    const tbContentRight = Math.round(tbHostRect.right - getRightPaddingAndBorderPx(tbHostParent));
                    if (tbContentRight > 0 && tbContentRight < tbRightBound) {
                        tbRightBound = tbContentRight;
                    }
                }
                const tbSibMinLeft = getFollowingSiblingsMinLeftPx(state.topBarHost);
                const hasCrumbTb = Boolean(document.querySelector('[aria-label="Breadcrumb"]'));
                if (tbSibMinLeft < Infinity && tbSibMinLeft <= tbRightBound) {
                    freeSpace = Math.max(0, tbSibMinLeft - leftEdge - (hasCrumbTb ? 140 : 24) - 24);
                } else {
                    const tbNativeW = measureNativeToolbarButtonsWidth(tbHostParent, state.topBarHost);
                    const effectiveRight = Math.min(tbRightBound, rightChromeLeft);
                    freeSpace = Math.max(0, effectiveRight - leftEdge - tbNativeW - (hasCrumbTb ? 140 : 24) - 24);
                }
            } else {
                const paneTb = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
                const paneTbVisible = Boolean(paneTb && isElementVisible(paneTb) && !isRevealOnHoverElement(paneTb));
                const nativeBtnW = paneTbVisible ? measureNativeToolbarButtonsWidth(paneTb, state.topBarHost) : 0;
                const hasCrumb = Boolean(document.querySelector('[aria-label="Breadcrumb"]'));
                const crumbReserve = hasCrumb ? 140 : (paneTbVisible ? 48 : 16);
                freeSpace = Math.max(0, rightChromeLeft - leftObstruction - nativeBtnW - crumbReserve - 24);
            }

            hideTotal = freeSpace < 340;
            hideSpeed = freeSpace < 275;
            hideCtx = freeSpace < 195;

            if (state.topBarHost) {
                if (state.topBarAnchorMode === 'fixed') {
                    const spacerTotal = wcoPx > 0 ? (wcoPx + 5) : 0;
                    const totalHostBudget = vw - 10 - leftObstruction - 8;
                    state.topBarHost.style.maxWidth = Math.max(80 + spacerTotal, totalHostBudget) + 'px';
                    r.cluster.style.maxWidth = Math.max(80, totalHostBudget - spacerTotal) + 'px';
                } else {
                    state.topBarHost.style.maxWidth = '';
                    r.cluster.style.maxWidth = '';
                }
            }
        } else {
            let effectiveWidth = vw;
            try {
                const titlebar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
                if (titlebar && typeof titlebar.getBoundingClientRect === 'function') {
                    const tbRect = titlebar.getBoundingClientRect();
                    if (tbRect && typeof tbRect.width === 'number' && tbRect.width > 120) {
                        effectiveWidth = Math.min(effectiveWidth, tbRect.width);
                    }
                }
            } catch { /* ignore */ }
            const totalThreshold = auxOpen ? 1360 : 1120;
            const speedThreshold = auxOpen ? 1040 : 860;
            const ctxThreshold = auxOpen ? 760 : 620;
            hideTotal = effectiveWidth < totalThreshold;
            hideSpeed = effectiveWidth < speedThreshold;
            hideCtx = effectiveWidth < ctxThreshold;
            if (state.topBarHost && state.topBarAnchorMode !== 'fixed') {
                state.topBarHost.style.maxWidth = '';
            }
            if (state.topBarAnchorMode !== 'fixed') {
                r.cluster.style.maxWidth = '';
            }
        }

        r.totalPill.classList.toggle('is-hidden', hideTotal);
        r.speedPill.classList.toggle('is-hidden', hideSpeed);
        r.ctxPill.classList.toggle('is-hidden', hideCtx);
        const showOverflow = hideTotal || hideSpeed || hideCtx;
        r.overflowBtn.classList.toggle('is-hidden', !showOverflow);
        if (!showOverflow) {
            closeOverflowMenu();
        }
        if (wcoPx > 0) {
            r.wcoSpacer.style.display = 'block';
            r.wcoSpacer.style.width = wcoPx + 'px';
        } else {
            r.wcoSpacer.style.display = 'none';
            r.wcoSpacer.style.width = '0px';
        }
    }

    function anchorTopBarHost(): void {
        if (!state.topBarEnabled) { return; }
        if (!state.topBarHost) { createTopBarSlot(); }
        if (!state.topBarHost) { return; }
        const anchor = findTopBarAnchor();
        if (!anchor || !anchor.parent) { return; }

        const anchorBefore = anchor.before === state.topBarHost ? state.topBarHost.nextSibling : anchor.before;
        const alreadyPlaced = state.topBarHost.parentNode === anchor.parent
            && (anchor.mode === 'fixed'
                ? true
                : (anchorBefore ? state.topBarHost.nextSibling === anchorBefore : state.topBarHost.nextSibling === null));

        state.topBarAnchorMode = anchor.mode;
        state.topBarAnchorTier = anchor.tier || anchor.mode;
        state.topBarHost.setAttribute('data-anchor', anchor.mode);
        state.topBarHost.setAttribute('data-anchor-tier', state.topBarAnchorTier);
        state.topBarHost.style.flexShrink = '0';
        if (anchor.mode !== 'fixed') {
            state.topBarHost.style.top = '';
            state.topBarHost.style.right = '';
            state.topBarHost.style.maxWidth = '';
            if (state.topBarRefs && state.topBarRefs.cluster) {
                state.topBarRefs.cluster.style.maxWidth = '';
            }
        }

        if (!alreadyPlaced) {
            if (anchorBefore && anchorBefore.parentNode === anchor.parent) {
                anchor.parent.insertBefore(state.topBarHost, anchorBefore);
            } else {
                anchor.parent.appendChild(state.topBarHost);
            }
        }

        applyTopBarResponsiveLayout();

        if (!alreadyPlaced && state.topBarRefs) {
            if (state.topBarActiveView) {
                positionPopoverNear(resolveTopBarAnchor(state.topBarActiveView, null), state.topBarRefs.quotaPopover, false);
            } else if (state.overflowOpen) {
                positionPopoverNear(state.topBarRefs.overflowBtn, state.topBarRefs.overflowMenu, false);
            }
        }
    }

    function buildQuotaBarNode(
        label: string,
        remainingPct: number | null | undefined,
        resetText: string,
        directionMode: 'remaining' | 'used' = 'remaining',
        directionLabel?: string,
    ): HTMLDivElement {
        const row = el('div', 'acm-qp-bar-row');
        const meta = el('div', 'acm-qp-bar-meta');
        const left = el('span', 'acm-k', label);
        const hasNum = typeof remainingPct === 'number' && Number.isFinite(remainingPct) && remainingPct >= 0 && remainingPct <= 100;
        const remClamped = hasNum ? clampNum(remainingPct, 0, 100) : null;
        const displayPct = remClamped !== null
            ? (directionMode === 'used' ? clampNum(100 - remClamped, 0, 100) : remClamped)
            : null;
        const dirSuffix = displayPct !== null && directionLabel ? (' ' + directionLabel) : '';
        const rightText = (displayPct !== null ? (Math.round(displayPct) + '%' + dirSuffix) : '—')
            + (resetText ? (' · ' + resetText) : '');
        const right = el('span', 'acm-v acm-num', rightText);
        meta.appendChild(left);
        meta.appendChild(right);

        const track = el('div', 'acm-qp-track');
        const fill = el('div', 'acm-qp-fill');
        if (remClamped !== null && displayPct !== null) {
            fill.style.width = displayPct.toFixed(1) + '%';
            // Color severity ALWAYS reflects remaining headroom (danger < 20% remaining / > 80% used)
            if (remClamped < 20) { fill.classList.add('is-danger'); }
            else if (remClamped < 50) { fill.classList.add('is-warn'); }
        } else {
            fill.style.width = '0%';
            fill.classList.add('is-unknown');
        }
        track.appendChild(fill);
        row.appendChild(meta);
        row.appendChild(track);
        return row;
    }

    function buildQpKvRow(label: string, valueNodeOrText: Node | string, subText?: string): HTMLDivElement {
        const row = el('div', 'acm-qp-kv-row');
        row.appendChild(el('span', 'acm-k', label));
        const valWrap = el('span', 'acm-v acm-num');
        if (valueNodeOrText && typeof valueNodeOrText === 'object' && valueNodeOrText.nodeType === 1) {
            valWrap.appendChild(valueNodeOrText);
        } else {
            valWrap.appendChild(document.createTextNode(String(valueNodeOrText)));
        }
        if (subText) {
            valWrap.appendChild(el('span', 'acm-v-sub', subText));
        }
        row.appendChild(valWrap);
        return row;
    }

    function buildQpStatCard(label: string, valueText: string, subText?: string): HTMLDivElement {
        const card = el('div', 'acm-qp-stat-card');
        card.appendChild(el('div', 'acm-qp-stat-label', label));
        card.appendChild(el('div', 'acm-qp-stat-val acm-num', valueText));
        if (subText) {
            card.appendChild(el('div', 'acm-qp-stat-sub acm-num', subText));
        }
        return card;
    }

    function updateQuotaMetaClock(): void {
        if (!state.topBarRefs || !state.payload) { return; }
        const lang = state.payload.language || 'both';
        const parts: string[] = [];
        const clockStr = formatLocalClockTime(state.payload.updatedAt);
        if (clockStr) {
            parts.push(bi(lang, 'Updated', '更新于') + ' ' + clockStr);
        }
        if (typeof state.countdownSec === 'number' && state.countdownSec >= 0) {
            parts.push(bi(lang, 'Next refresh in', '下次刷新') + ' ' + state.countdownSec + 's');
        }
        state.topBarRefs.qpMeta.textContent = parts.join(' · ') || '—';
    }

    function renderTopBarQuotaView(p: CdpOverlayRuntimePayload, lang: string, body: HTMLElement, view: ResolvedOverlayContextView): void {
        const qCfg = resolveQuotaDisplayConfig(p, lang);

        const sessionSec = el('div', 'acm-qp-section');
        const modeHead = el('div', 'acm-quota-mode-row');
        modeHead.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Current Session Model', '当前会话模型')));
        const modeBadges = el('div', 'acm-pool-right');
        modeBadges.appendChild(el('span', 'acm-pill-badge', qCfg.windowModeLabel));
        modeBadges.appendChild(el('span', 'acm-pill-badge is-accent', qCfg.directionLabel));
        modeHead.appendChild(modeBadges);
        sessionSec.appendChild(modeHead);

        const sessionCard = el('div', 'acm-qp-session-card');
        sessionCard.setAttribute('data-quota-window', qCfg.windowMode);
        sessionCard.setAttribute('data-quota-direction', qCfg.directionMode);

        if (typeof p.accountLabel === 'string' && p.accountLabel.trim()) {
            sessionCard.appendChild(buildQpKvRow(bi(lang, 'Account', '账号'), p.accountLabel.trim()));
        }

        const sessTop = el('div', 'acm-qp-session-model');
        sessTop.appendChild(el('span', '', p.modelName || bi(lang, 'No active model', '暂无活跃模型')));
        sessTop.appendChild(el('span', 'acm-pill-badge is-accent acm-num', view.pctText + ' ' + bi(lang, 'Ctx', '上下文')));
        sessionCard.appendChild(sessTop);

        const sess5hPct = p.sessionQuota5hPct;
        const hasWeekly = p.sessionQuotaWeeklyPct !== undefined && p.sessionQuotaWeeklyPct !== null;
        if (qCfg.windowMode === '7d' && hasWeekly) {
            sessionCard.appendChild(buildQuotaBarNode(
                bi(lang, '7d Weekly Quota', '7 天配额'),
                p.sessionQuotaWeeklyPct,
                p.sessionQuotaWeeklyReset || '',
                qCfg.directionMode,
                qCfg.directionLabel,
            ));
            sessionCard.appendChild(buildQuotaBarNode(
                bi(lang, '5h Quota Window', '5 小时配额窗口'),
                sess5hPct,
                p.sessionQuota5hReset || '',
                qCfg.directionMode,
                qCfg.directionLabel,
            ));
        } else {
            sessionCard.appendChild(buildQuotaBarNode(
                bi(lang, '5h Quota Window', '5 小时配额窗口'),
                sess5hPct,
                p.sessionQuota5hReset || '',
                qCfg.directionMode,
                qCfg.directionLabel,
            ));
            if (hasWeekly) {
                sessionCard.appendChild(buildQuotaBarNode(
                    bi(lang, '7d Weekly Quota', '7 天配额'),
                    p.sessionQuotaWeeklyPct,
                    p.sessionQuotaWeeklyReset || '',
                    qCfg.directionMode,
                    qCfg.directionLabel,
                ));
            }
        }
        sessionSec.appendChild(sessionCard);
        body.appendChild(sessionSec);

        const poolsSec = el('div', 'acm-qp-section');
        poolsSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Shared Quota Pools', '共享配额池')));
        const poolList = el('div', 'acm-pool-list');
        const pools = Array.isArray(p.quotaPools) ? p.quotaPools : [];
        if (pools.length === 0) {
            poolList.appendChild(el('div', 'acm-k', bi(lang, 'Waiting for quota pool telemetry...', '正在等待配额池数据...')));
        } else {
            for (let i = 0; i < pools.length; i++) {
                const pool = pools[i];
                const card = el('div', pool.isCurrentSessionModel ? 'acm-pool-card is-current' : 'acm-pool-card');
                const top = el('div', 'acm-pool-top');
                top.appendChild(el('div', 'acm-pool-name', pool.label || pool.poolKey || 'Pool'));

                const right = el('div', 'acm-pool-right');
                const reading = projectQuotaDisplay({
                    windowMode: qCfg.windowMode, directionMode: qCfg.directionMode,
                    window5h: { remainingFraction: typeof pool.remainingPct === 'number' ? pool.remainingPct / 100 : null },
                    window7d: { remainingFraction: typeof pool.weeklyRemainingPct === 'number' ? pool.weeklyRemainingPct / 100 : null },
                });
                const activeRem = reading.remainingPct;
                const activeReset = reading.effectiveWindow === '7d' ? pool.weeklyResetCountdown : pool.resetCountdown;
                const health = activeRem === null ? 'unknown' : activeRem >= 50 ? 'good' : activeRem >= 20 ? 'warn' : 'danger';
                const healthLabel = health === 'good'
                    ? bi(lang, 'Healthy', '充裕')
                    : (health === 'warn'
                        ? bi(lang, 'Caution', '偏低')
                        : (health === 'danger' ? bi(lang, 'Critical', '紧张') : bi(lang, 'Unknown', '未知')));
                right.appendChild(el('span', 'acm-pill-badge' + (health !== 'unknown' ? (' is-' + health) : ''), healthLabel));
                top.appendChild(right);
                card.appendChild(top);

                card.appendChild(buildQuotaBarNode(
                    bi(lang, reading.windowLabelEn, reading.windowLabelZh), activeRem,
                    reading.isUnavailable ? '' : activeReset || '', qCfg.directionMode, qCfg.directionLabel,
                ));

                if (Array.isArray(pool.modelChips) && pool.modelChips.length > 0) {
                    const chipRow = el('div', 'acm-chip-row');
                    for (let c = 0; c < pool.modelChips.length; c++) {
                        chipRow.appendChild(el('span', 'acm-model-chip', pool.modelChips[c]));
                    }
                    card.appendChild(chipRow);
                }
                poolList.appendChild(card);
            }
        }
        poolsSec.appendChild(poolList);
        body.appendChild(poolsSec);
    }

    function renderTopBarContextView(rawPayload: CdpOverlayRuntimePayload, lang: string, body: HTMLElement, view: ResolvedOverlayContextView): void {
        const p = rawPayload as CdpOverlayD9Payload;
        const compactInfo = resolveCompactionIndicator(p, view, lang);

        const heroSec = el('div', 'acm-qp-section');
        heroSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Active Context Window', '当前上下文窗口')));
        const heroCard = el('div', 'acm-qp-hero-card');
        heroCard.setAttribute('data-observation-subject', view.subjectCascadeId);
        heroCard.setAttribute('data-observation-data-rev', String(view.dataRevision));
        heroCard.setAttribute('data-observation-pct', view.pctText);
        heroCard.setAttribute('data-observation-health', view.healthStatus);
        heroCard.setAttribute('data-observation-basis', view.actualBasis);
        heroCard.setAttribute('data-compact-state', compactInfo.state);

        const heroTop = el('div', 'acm-qp-hero-top');
        heroTop.appendChild(el('div', 'acm-qp-hero-label', p.modelName || bi(lang, 'No active model', '暂无活跃模型')));
        heroTop.appendChild(el('span', view.badgeCls, view.badgeLabel));
        heroCard.appendChild(heroTop);

        const metricRow = el('div', 'acm-qp-hero-metric-row');
        const pctCls = 'acm-qp-hero-value acm-num' + (
            view.severity === 'danger'
                ? ' is-danger'
                : (view.severity === 'warn' ? ' is-warn' : (view.severity === 'incomplete' ? '' : ' is-accent'))
        );
        metricRow.appendChild(el('div', pctCls, view.pctText));
        metricRow.appendChild(el('div', 'acm-v acm-num', view.capTokensText));
        heroCard.appendChild(metricRow);

        const meterWrap = el('div', 'acm-qp-meter-wrap');
        const meterFill = el('div', 'acm-qp-meter-fill' + (view.severity === 'danger' ? ' is-danger' : (view.severity === 'warn' ? ' is-warn' : '')));
        meterFill.style.width = view.geometryFillPct.toFixed(1) + '%';
        meterWrap.appendChild(meterFill);

        const marks: string[] = [];
        if (view.actualBasis === 'native') {
            marks.push(bi(lang, 'Native Window Limit', '原生窗口上限'));
        }
        if (view.compactionWarningActive && view.actualBasis === 'native') {
            const cpPctStr = typeof p.compactionPct === 'number' && Number.isFinite(p.compactionPct)
                ? (' ' + p.compactionPct.toFixed(1).replace(/\.0$/, '') + '%')
                : '';
            marks.push(bi(lang, 'Compaction warning', '压缩预警') + cpPctStr);
        }
        if (view.compactionMarkerPct !== null && view.compactionMarkerPct > 2 && view.compactionMarkerPct < 99) {
            const compPct = clampNum(view.compactionMarkerPct, 2, 98);
            const compTip = bi(lang, 'Auto-compaction limit', '自动压缩上限') + ' ' + Math.round(view.compactionMarkerPct) + '%';
            const tickComp = el('div', 'acm-qp-watermark-tick is-compaction' + (compPct <= 35 ? ' is-align-left' : (compPct >= 62 ? ' is-align-right' : '')));
            tickComp.style.left = compPct.toFixed(1) + '%';
            tickComp.setAttribute('role', 'img');
            tickComp.setAttribute('tabindex', '0');
            tickComp.setAttribute('data-tooltip', compTip);
            tickComp.setAttribute('aria-label', compTip);
            meterWrap.appendChild(tickComp);
            marks.push(bi(lang, 'Compact', '压缩') + ' ' + Math.round(view.compactionMarkerPct) + '%');
        }
        if (view.tier200kMarkerPct !== null && view.tier200kMarkerPct > 2 && view.tier200kMarkerPct < 99) {
            const tierPct = clampNum(view.tier200kMarkerPct, 2, 98);
            const tierTip = getTier200kTooltip(lang);
            const tick200k = el('div', 'acm-qp-watermark-tick is-tier200k' + (tierPct <= 35 ? ' is-align-left' : (tierPct >= 62 ? ' is-align-right' : '')));
            tick200k.style.left = tierPct.toFixed(1) + '%';
            tick200k.setAttribute('role', 'img');
            tick200k.setAttribute('tabindex', '0');
            tick200k.setAttribute('data-tooltip', tierTip);
            tick200k.setAttribute('aria-label', tierTip);
            meterWrap.appendChild(tick200k);
            marks.push('200k');
        }
        heroCard.appendChild(meterWrap);

        const subRow = el('div', 'acm-qp-hero-sub acm-num');
        const remText = view.remainingTokens !== null ? formatCompact(view.remainingTokens) : '—';
        subRow.appendChild(el('span', '', bi(lang, 'Remaining', '剩余可用') + ': ' + remText));
        subRow.appendChild(el('span', '', marks.join(' · ')));
        heroCard.appendChild(subRow);

        if (compactInfo.state !== 'idle') {
            const cRow = el('div', 'acm-compact-row');
            cRow.setAttribute('data-compact-state', compactInfo.state);
            cRow.appendChild(el('span', 'acm-k', bi(lang, 'Compaction (/compact)', '压缩状态 (/compact)')));
            const cBadge = el('span', compactInfo.cls, compactInfo.label);
            cBadge.setAttribute('tabindex', '0');
            cBadge.setAttribute('data-tooltip', compactInfo.tip);
            cBadge.setAttribute('aria-label', compactInfo.label + ' — ' + compactInfo.tip);
            cRow.appendChild(cBadge);
            heroCard.appendChild(cRow);
        }

        heroSec.appendChild(heroCard);
        body.appendChild(heroSec);

        // Optional lightweight Swarm member summary inside existing Context Popover (ZERO new permanent views!)
        if (p.swarmSummary && (p.swarmSummary.totalCount > 0 || (Array.isArray(p.swarmSummary.members) && p.swarmSummary.members.length > 0))) {
            const swarmSec = el('div', 'acm-qp-section acm-swarm-sec');
            if (renderSwarmSummaryInto(swarmSec, p.swarmSummary, lang, true)) {
                body.appendChild(swarmSec);
            }
        }

        const tokSec = el('div', 'acm-qp-section');
        tokSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Current Chat Token Breakdown', '当前会话 Token 明细')));
        const tokCard = el('div', 'acm-qp-kv-card');
        tokCard.appendChild(buildQpKvRow(bi(lang, 'Input / Output', '输入 / 输出'), formatCompact(p.inputTokens) + ' / ' + formatCompact(p.outputTokens)));
        tokCard.appendChild(buildQpKvRow(bi(lang, 'Cache Read', '缓存读取'), formatCompact(p.cacheReadTokens)));
        tokCard.appendChild(buildQpKvRow(bi(lang, 'Current Chat Total Tokens', '当前会话总 Tokens'), formatCompact(p.totalTokens)));
        if (typeof p.contextNativeLimit === 'number' && p.contextNativeLimit > 0) {
            tokCard.appendChild(buildQpKvRow(bi(lang, 'Native Window Limit', '原生窗口上限'), formatCompact(p.contextNativeLimit)));
        }
        tokSec.appendChild(tokCard);
        body.appendChild(tokSec);

        const cacheSec = el('div', 'acm-qp-section');
        cacheSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Cache Efficiency', '缓存命中效率')));
        const cacheCard = el('div', 'acm-qp-kv-card');
        cacheCard.appendChild(buildQpKvRow(bi(lang, 'Recent Cache Hit', '近期缓存命中'), formatPct(p.recentCacheHitPct)));
        cacheCard.appendChild(buildQpKvRow(bi(lang, 'Avg Cache Hit', '平均缓存命中'), formatPct(p.avgCacheHitPct)));
        cacheCard.appendChild(buildQpKvRow(bi(lang, 'Turn Cache State', '轮次缓存状态'), buildTurnCacheBadge(lang, p.turnCacheState)));
        cacheSec.appendChild(cacheCard);
        body.appendChild(cacheSec);
    }

    function renderTopBarSpeedView(p: CdpOverlayRuntimePayload, lang: string, body: HTMLElement): void {
        const speedInfo = resolveSpeedMode(p);
        const dp = p as CdpOverlayD9Payload;
        const activeSpeed = typeof dp.displaySpeedTps === 'number' && Number.isFinite(dp.displaySpeedTps) && dp.displaySpeedTps > 0
            ? dp.displaySpeedTps
            : p.outputSpeedTps;

        const heroSec = el('div', 'acm-qp-section');
        const headRow = el('div', 'acm-quota-mode-row');
        headRow.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Live Output Speed', '实时生成速度')));
        const modeBadge = el(
            'span',
            'acm-pill-badge acm-has-tip acm-speed-mode-tag' + (speedInfo.mode === 'e2e' ? ' is-accent' : ''),
            speedInfo.mode === 'e2e' ? bi(lang, 'E2E (Model Call)', '端到端 (E2E)') : bi(lang, 'Decode', '生成速率 (Decode)'),
        );
        modeBadge.setAttribute('data-speed-mode', speedInfo.mode);
        modeBadge.setAttribute('tabindex', '0');
        const speedModeTip = speedInfo.mode === 'e2e'
            ? bi(lang, 'Model-call E2E speed: output tokens / (TTFT + streaming duration)', '模型调用级端到端速度：输出 Tokens / (首字延迟 + 流式输出耗时)')
            : bi(lang, 'Decode streaming speed: output tokens / streaming duration', '流式解码生成速率：输出 Tokens / 流式输出耗时');
        modeBadge.setAttribute('data-tooltip', speedModeTip);
        modeBadge.setAttribute('aria-label', modeBadge.textContent + ' — ' + speedModeTip);
        headRow.appendChild(modeBadge);
        heroSec.appendChild(headRow);

        const heroCard = el('div', 'acm-qp-hero-card');
        heroCard.setAttribute('data-speed-mode', speedInfo.mode);

        const heroTop = el('div', 'acm-qp-hero-top');
        heroTop.appendChild(el('div', 'acm-qp-hero-label', p.modelName || bi(lang, 'Output Throughput', '输出吞吐')));
        let statusBadge: HTMLSpanElement;
        if (p.isWaitingTtft) {
            statusBadge = el('span', 'acm-pill-badge is-warn', bi(lang, 'Waiting for first token', '等待首字'));
        } else if (p.isShortSample) {
            statusBadge = el('span', 'acm-pill-badge is-warn', bi(lang, 'Short sample', '短样本'));
        } else if (typeof activeSpeed === 'number' && Number.isFinite(activeSpeed) && activeSpeed > 0) {
            statusBadge = el('span', 'acm-pill-badge is-good', bi(lang, 'Live', '实时'));
        } else {
            statusBadge = el('span', 'acm-pill-badge', bi(lang, 'Idle', '空闲'));
        }
        heroTop.appendChild(statusBadge);
        heroCard.appendChild(heroTop);

        const metricRow = el('div', 'acm-qp-hero-metric-row');
        if (p.isWaitingTtft) {
            metricRow.appendChild(el('div', 'acm-qp-hero-value is-warn', bi(lang, 'Waiting...', '等待首字...')));
        } else if (p.isShortSample) {
            const shortVal = el('div', 'acm-qp-hero-value is-warn acm-num', bi(lang, 'Short sample', '短样本'));
            if (typeof activeSpeed === 'number' && Number.isFinite(activeSpeed) && activeSpeed > 0) {
                shortVal.appendChild(el('span', 'acm-qp-hero-unit', '(' + formatTps(activeSpeed) + ')'));
            }
            metricRow.appendChild(shortVal);
        } else {
            metricRow.appendChild(el('div', 'acm-qp-hero-value is-accent acm-num', formatTps(activeSpeed)));
        }
        heroCard.appendChild(metricRow);

        const subRow = el('div', 'acm-qp-hero-sub acm-num');
        subRow.appendChild(el('span', '', bi(lang, 'First Token Latency (TTFT)', '首字延迟 (TTFT)') + ': ' + formatTtft(p.ttftMs)));
        subRow.appendChild(el('span', '', bi(lang, 'Avg', '平均') + ': ' + formatTps(p.avgOutputSpeedTps)));
        heroCard.appendChild(subRow);
        heroSec.appendChild(heroCard);
        body.appendChild(heroSec);

        const metricsSec = el('div', 'acm-qp-section');
        metricsSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Throughput & Latency', '吞吐与延迟指标')));
        const statGrid = el('div', 'acm-qp-stat-grid');
        statGrid.appendChild(buildQpStatCard(bi(lang, 'Avg Output Speed', '平均输出速度'), formatTps(p.avgOutputSpeedTps)));
        statGrid.appendChild(buildQpStatCard(bi(lang, 'First Token (TTFT)', '首字延迟'), formatTtft(p.ttftMs)));
        if (typeof p.peakOutputSpeedTps === 'number' && Number.isFinite(p.peakOutputSpeedTps) && p.peakOutputSpeedTps > 0) {
            statGrid.appendChild(buildQpStatCard(bi(lang, 'Peak Output Speed', '峰值输出速度'), formatTps(p.peakOutputSpeedTps)));
        }
        if (typeof p.recentCallCount === 'number' && Number.isFinite(p.recentCallCount) && p.recentCallCount >= 0) {
            statGrid.appendChild(buildQpStatCard(bi(lang, 'Recent Model Calls', '近期模型调用'), String(Math.round(p.recentCallCount))));
        }
        metricsSec.appendChild(statGrid);
        body.appendChild(metricsSec);

        const cacheSec = el('div', 'acm-qp-section');
        cacheSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Cache Efficiency (Prefill)', '缓存效率（影响首字延迟）')));
        const cacheCard = el('div', 'acm-qp-kv-card');
        cacheCard.appendChild(buildQpKvRow(bi(lang, 'Recent Cache Hit', '近期缓存命中'), formatPct(p.recentCacheHitPct)));
        cacheCard.appendChild(buildQpKvRow(bi(lang, 'Avg Cache Hit', '平均缓存命中'), formatPct(p.avgCacheHitPct)));
        cacheCard.appendChild(buildQpKvRow(bi(lang, 'Turn Cache State', '轮次缓存状态'), buildTurnCacheBadge(lang, p.turnCacheState)));
        cacheSec.appendChild(cacheCard);
        body.appendChild(cacheSec);
    }

    function renderTopBarTotalView(p: CdpOverlayRuntimePayload, lang: string, body: HTMLElement): void {
        const cumStr = formatCompact(p.cumulativeRecordedTokens);
        const costStr = formatUsd(p.estCostUsd, p.estCostFormatted);

        const heroSec = el('div', 'acm-qp-section');
        heroSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Recorded Local Total', '本机已记录总用量')));
        const heroCard = el('div', 'acm-qp-hero-card');

        const heroTop = el('div', 'acm-qp-hero-top');
        heroTop.appendChild(el('div', 'acm-qp-hero-label', bi(lang, 'Cumulative Recorded Tokens', '本机累计 Tokens')));
        if (typeof p.cumulativeCostFormatted === 'string' && p.cumulativeCostFormatted.trim()) {
            const cumBadge = el('span', 'acm-pill-badge is-accent acm-num', p.cumulativeCostFormatted.trim());
            cumBadge.setAttribute('aria-label', bi(lang, 'Cumulative recorded cost', '本机累计费用') + ' ' + p.cumulativeCostFormatted.trim());
            heroTop.appendChild(cumBadge);
        }
        heroCard.appendChild(heroTop);

        const metricRow = el('div', 'acm-qp-hero-metric-row');
        const heroVal = el('div', 'acm-qp-hero-value is-accent acm-num', cumStr);
        heroVal.appendChild(el('span', 'acm-qp-hero-unit', 'tokens'));
        metricRow.appendChild(heroVal);
        heroCard.appendChild(metricRow);

        const daysVal = typeof p.recordedDaysCount === 'number' && Number.isFinite(p.recordedDaysCount) && p.recordedDaysCount > 0
            ? Math.round(p.recordedDaysCount)
            : null;
        const sessVal = typeof p.sessionCount === 'number' && Number.isFinite(p.sessionCount) && p.sessionCount > 0
            ? Math.round(p.sessionCount)
            : null;
        const scopeEnParts: string[] = [];
        const scopeZhParts: string[] = [];
        const scopeCompactParts: string[] = [];
        if (daysVal !== null) {
            scopeEnParts.push(daysVal + (daysVal === 1 ? ' day' : ' days'));
            scopeZhParts.push(daysVal + ' 天');
            scopeCompactParts.push(lang === 'zh' ? (daysVal + ' 天') : (daysVal + 'd'));
        }
        if (sessVal !== null) {
            scopeEnParts.push(sessVal + (sessVal === 1 ? ' session' : ' sessions'));
            scopeZhParts.push(sessVal + ' 会话');
            scopeCompactParts.push(lang === 'zh' ? (sessVal + ' 会话') : (sessVal + ' ' + bi(lang, sessVal === 1 ? 'session' : 'sessions', '会话')));
        }
        const hasScope = scopeEnParts.length > 0;
        const scopeFullText = hasScope ? bi(lang, scopeEnParts.join(' · '), scopeZhParts.join(' · ')) : '';
        const scopeCompactText = hasScope
            ? (lang === 'en' ? scopeEnParts.join(' · ') : (lang === 'zh' ? scopeZhParts.join(' · ') : (daysVal !== null && sessVal !== null ? (daysVal + 'd · ' + sessVal + ' sess') : scopeCompactParts.join(' · '))))
            : '';
        const subRow = el('div', 'acm-qp-hero-sub acm-num');
        subRow.appendChild(el('span', '', hasScope
            ? (bi(lang, 'Recorded Scope', '记录范围') + ': ' + scopeFullText)
            : (bi(lang, 'Current Chat Total', '当前会话总计') + ': ' + formatCompact(p.totalTokens))));
        if (typeof p.todayCostFormatted === 'string' && p.todayCostFormatted.trim()) {
            subRow.appendChild(el('span', '', bi(lang, 'Today Cost', '今日费用') + ': ' + p.todayCostFormatted.trim()));
        }
        heroCard.appendChild(subRow);
        heroSec.appendChild(heroCard);
        body.appendChild(heroSec);

        const hasToday = (typeof p.todayTokens === 'number' && Number.isFinite(p.todayTokens))
            || (typeof p.todayCostFormatted === 'string' && p.todayCostFormatted.trim().length > 0);
        const hasHistory = hasScope
            || (typeof p.cumulativeCostFormatted === 'string' && p.cumulativeCostFormatted.trim().length > 0);
        const hasRoi = typeof p.subscriptionRoiSummary === 'string' && p.subscriptionRoiSummary.trim().length > 0;

        if (hasToday || hasHistory || hasRoi) {
            const histSec = el('div', 'acm-qp-section');
            histSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Today & Cumulative Totals', '今日与本机累计费用')));
            if (hasToday || hasHistory) {
                const grid = el('div', 'acm-qp-stat-grid');
                if (hasToday) {
                    const todayVal = typeof p.todayTokens === 'number' && Number.isFinite(p.todayTokens)
                        ? formatCompact(p.todayTokens)
                        : (p.todayCostFormatted || '—');
                    const todaySub = (typeof p.todayTokens === 'number' && Number.isFinite(p.todayTokens) && p.todayCostFormatted)
                        ? (bi(lang, 'Today', '今日费用') + ' ' + p.todayCostFormatted)
                        : '';
                    grid.appendChild(buildQpStatCard(bi(lang, 'Today Tokens & Cost', '今日用量与费用'), todayVal, todaySub));
                }
                if (hasHistory) {
                    const histVal = hasScope ? scopeCompactText : (p.cumulativeCostFormatted || '—');
                    const histSub = (hasScope && p.cumulativeCostFormatted)
                        ? (bi(lang, 'Cumulative', '本机累计费用') + ' ' + p.cumulativeCostFormatted)
                        : '';
                    grid.appendChild(buildQpStatCard(bi(lang, 'Cumulative History', '历史累计统计'), histVal, histSub));
                }
                histSec.appendChild(grid);
            }
            if (hasRoi && p.subscriptionRoiSummary) {
                const roiRow = el('div', 'acm-qp-roi-row');
                roiRow.appendChild(el('span', 'acm-qp-roi-label', bi(lang, 'Subscription ROI', '订阅参考比')));
                roiRow.appendChild(el('span', 'acm-qp-roi-val acm-num', p.subscriptionRoiSummary.trim()));
                histSec.appendChild(roiRow);
            }
            body.appendChild(histSec);
        }

        const sessSec = el('div', 'acm-qp-section');
        sessSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Current Session Breakdown', '当前会话明细')));
        const sessCard = el('div', 'acm-qp-kv-card');
        sessCard.appendChild(buildQpKvRow(
            bi(lang, 'Current Chat Cost (Est.)', '当前会话估算费用'),
            costStr,
            p.localCostFormatted ? ('≈ ' + p.localCostFormatted) : '',
        ));
        sessCard.appendChild(buildQpKvRow(bi(lang, 'Input / Output', '输入 / 输出'), formatCompact(p.inputTokens) + ' / ' + formatCompact(p.outputTokens)));
        sessCard.appendChild(buildQpKvRow(bi(lang, 'Cache Read', '缓存读取'), formatCompact(p.cacheReadTokens)));
        sessCard.appendChild(buildQpKvRow(bi(lang, 'Current Chat Tokens', '当前会话总 Tokens'), formatCompact(p.totalTokens)));
        sessSec.appendChild(sessCard);
        body.appendChild(sessSec);
    }

    function renderTopBarPopover(): void {
        if (!state.topBarRefs || !state.payload) { return; }
        const p = state.payload;
        const r = state.topBarRefs;
        const lang = p.language || 'both';
        const view = normalizeTopBarView(state.topBarActiveView || 'quota');
        const ctxView = resolveOverlayContextView(p, lang);
        const cumStr = formatCompact(p.cumulativeRecordedTokens);
        const costStr = formatUsd(p.estCostUsd, p.estCostFormatted);

        if (view === 'context') {
            r.qpTitle.textContent = bi(lang, 'Context Usage', '上下文用量');
        } else if (view === 'speed') {
            r.qpTitle.textContent = bi(lang, 'Speed & Throughput', '生成速度与吞吐');
        } else if (view === 'total') {
            r.qpTitle.textContent = bi(lang, 'Total Usage & Cost', '本机累计用量与费用');
        } else {
            r.qpTitle.textContent = bi(lang, 'Model Quota Board', '模型配额面板');
        }
        r.quotaPopover.setAttribute(
            'aria-label',
            r.qpTitle.textContent + (state.topBarPinned ? (' · ' + bi(lang, 'Pinned', '冻结面板')) : ''),
        );
        r.qpTabsBar.setAttribute('aria-label', bi(lang, 'Overlay detail views', '悬浮详情视图'));

        r.qpTabs.quota.textContent = lang === 'both' ? 'Quota 配额' : bi(lang, 'Quota', '配额');
        r.qpTabs.context.textContent = lang === 'both' ? 'Ctx 上下文' : bi(lang, 'Context', '上下文');
        r.qpTabs.speed.textContent = lang === 'both' ? 'Speed 速度' : bi(lang, 'Speed', '速度');
        r.qpTabs.total.textContent = lang === 'both' ? 'Total 累计' : bi(lang, 'Total', '累计');
        syncTopBarPillStates();

        const refreshLabel = bi(lang, 'Refresh', '刷新');
        const openLabel = bi(lang, 'Open Panel', '打开面板');
        const closeLabel = bi(lang, 'Close', '关闭');
        r.qpRefreshBtn.textContent = refreshLabel;
        r.qpRefreshBtn.setAttribute('aria-label', refreshLabel);
        r.qpOpenBtn.textContent = openLabel;
        r.qpOpenBtn.setAttribute('aria-label', openLabel);
        r.qpCloseBtn.setAttribute('aria-label', closeLabel);

        const hasBridge = hasLoopbackBridge(p);
        const canOpenDirectly = Boolean(findVisibleAuxSidebarToggle());
        r.qpRefreshBtn.style.display = hasBridge ? '' : 'none';
        r.qpOpenBtn.style.display = (hasBridge || canOpenDirectly) ? '' : 'none';

        updateQuotaMetaClock();

        clearChildren(r.qpBody);
        if (view === 'context') {
            renderTopBarContextView(p, lang, r.qpBody, ctxView);
            const hasSessionCost = typeof p.estCostUsd === 'number' && Number.isFinite(p.estCostUsd) && p.estCostUsd >= 0 && !ctxView.isZeroStepFresh && !ctxView.isIncomplete;
            const sessionCostText = hasSessionCost ? costStr : '—';
            r.qpFooterTotal.textContent = bi(lang, 'Current Chat Cost', '当前会话费用') + ': ' + sessionCostText + (hasSessionCost && p.localCostFormatted ? (' (≈ ' + p.localCostFormatted + ')') : '');
        } else if (view === 'speed') {
            renderTopBarSpeedView(p, lang, r.qpBody);
            r.qpFooterTotal.textContent = bi(lang, 'Current Chat Output', '当前会话输出') + ': ' + formatCompact(p.outputTokens) + ' tok';
        } else if (view === 'total') {
            renderTopBarTotalView(p, lang, r.qpBody);
            r.qpFooterTotal.textContent = bi(lang, 'Active Model', '当前模型') + ': ' + (p.modelName || '—');
        } else {
            renderTopBarQuotaView(p, lang, r.qpBody, ctxView);
            r.qpFooterTotal.textContent = bi(lang, 'Recorded Total', '本机已记录总量') + ': ' + cumStr;
        }
    }

    function renderTopBar(): void {
        if (!state.topBarEnabled || !state.topBarRefs || !state.payload) { return; }
        const p = state.payload as CdpOverlayD9Payload;
        const r = state.topBarRefs;
        const lang = p.language || 'both';
        const ctxView = resolveOverlayContextView(p, lang);
        const compactInfo = resolveCompactionIndicator(p, ctxView, lang);
        const qCfg = resolveQuotaDisplayConfig(p, lang);
        const speedInfo = resolveSpeedMode(p);
        applyObservationAttrs(state.topBarHost, ctxView, compactInfo.state);

        // Select active quota percentage & window tag honoring `quotaWindowMode` (5h / 7d / tightest) & `quotaDirectionMode` (remaining / used)
        const sessionAndPools = (current: number | null | undefined, weekly: boolean): number | null => {
            const valid = (pct: unknown): pct is number => typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
            if (valid(current)) { return current; }
            let lowest: number | null = null;
            for (const pool of p.quotaPools || []) {
                const pct = weekly ? pool.weeklyRemainingPct : pool.remainingPct;
                if (valid(pct) && (lowest === null || pct < lowest)) { lowest = pct; }
            }
            return lowest;
        };
        const weeklyTag = p.tightestQuotaWindowTag === '7d' || p.tightestQuotaWindowTag === 'wk';
        const hasTaggedAggregate = typeof p.tightestQuotaPct === 'number' &&
            (weeklyTag || p.tightestQuotaWindowTag === '5h');
        const aggregateMode = qCfg.windowMode === 'tightest' && hasTaggedAggregate;
        const p5 = aggregateMode ? (weeklyTag ? null : p.tightestQuotaPct)
            : sessionAndPools(p.sessionQuota5hPct, false);
        const p7 = aggregateMode ? (weeklyTag ? p.tightestQuotaPct : null)
            : sessionAndPools(p.sessionQuotaWeeklyPct, true);
        const selectedQuota = projectQuotaDisplay({
            windowMode: qCfg.windowMode, directionMode: qCfg.directionMode,
            window5h: { remainingFraction: typeof p5 === 'number' ? p5 / 100 : null },
            window7d: { remainingFraction: typeof p7 === 'number' ? p7 / 100 : null },
        });
        const selectedRemPct = selectedQuota.remainingPct;
        const displayQuotaPct = selectedQuota.displayPct;
        if (selectedRemPct !== null && displayQuotaPct !== null) {
            r.qRing.arc.setAttribute('stroke-dashoffset', (MINI_CIRC * (1 - displayQuotaPct / 100)).toFixed(2));
            r.qRing.arc.classList.toggle('is-warn', selectedRemPct >= 20 && selectedRemPct < 50);
            r.qRing.arc.classList.toggle('is-danger', selectedRemPct < 20);
            r.qPctText.textContent = Math.round(displayQuotaPct) + '%';
        } else {
            r.qRing.arc.setAttribute('stroke-dashoffset', MINI_CIRC.toFixed(2));
            r.qRing.arc.classList.remove('is-warn', 'is-danger');
            r.qPctText.textContent = '—';
        }
        const selectedLabel = bi(lang, selectedQuota.metricLabelEn, selectedQuota.metricLabelZh);
        r.qWinTag.textContent = selectedLabel;
        r.quotaPill.setAttribute('data-quota-window', qCfg.windowMode);
        r.quotaPill.setAttribute('data-quota-direction', qCfg.directionMode);
        r.quotaPill.setAttribute('aria-label', bi(lang, 'Model quota board', '模型配额面板') + ' · ' + selectedLabel + (displayQuotaPct === null ? '' : ' ' + Math.round(displayQuotaPct) + '%'));

        r.cRing.arc.setAttribute('stroke-dashoffset', (MINI_CIRC * (1 - ctxView.geometryFillPct / 100)).toFixed(2));
        r.cRing.arc.classList.toggle('is-accent', ctxView.severity === 'normal');
        r.cRing.arc.classList.toggle('is-warn', ctxView.severity === 'warn');
        r.cRing.arc.classList.toggle('is-danger', ctxView.severity === 'danger');
        const ctxLabel = ctxView.pillPctText;
        r.cPctText.textContent = ctxLabel;
        r.ctxPill.setAttribute('aria-label', bi(lang, 'Context Usage', '上下文用量') + ' ' + ctxLabel + ' · ' + ctxView.badgeLabel);
        r.ctxPill.setAttribute('data-observation-pct', ctxView.pctText);
        r.ctxPill.setAttribute('data-observation-health', ctxView.healthStatus);
        r.ctxPill.setAttribute('data-compaction-warning', ctxView.compactionWarningActive ? ctxView.compactionWarningLevel : 'none');
        r.ctxPill.setAttribute('data-compact-state', compactInfo.state);

        let speedLabel: string;
        const speedTps = typeof p.displaySpeedTps === 'number' && Number.isFinite(p.displaySpeedTps) && p.displaySpeedTps > 0
            ? p.displaySpeedTps
            : p.outputSpeedTps;
        if (p.isWaitingTtft) {
            speedLabel = bi(lang, 'Waiting', '等待首字');
            r.speedPill.classList.add('is-warn');
        } else if (p.isShortSample) {
            speedLabel = bi(lang, 'Short sample', '短样本');
            r.speedPill.classList.add('is-warn');
        } else if (typeof speedTps === 'number' && Number.isFinite(speedTps) && speedTps > 0) {
            speedLabel = speedTps.toFixed(1) + ' tok/s' + (speedInfo.mode === 'e2e' ? ' E2E' : '');
            r.speedPill.classList.remove('is-warn');
        } else {
            speedLabel = '— tok/s';
            r.speedPill.classList.remove('is-warn');
        }
        r.speedPill.textContent = speedLabel;
        r.speedPill.setAttribute('data-speed-mode', speedInfo.mode);
        r.speedPill.setAttribute(
            'aria-label',
            bi(lang, 'Speed & Throughput', '生成速度与吞吐')
            + ' (' + (speedInfo.mode === 'e2e' ? 'E2E' : 'Decode') + ') ' + speedLabel,
        );

        const cumStr = formatCompact(p.cumulativeRecordedTokens);
        r.totalPill.textContent = cumStr;
        r.totalPill.setAttribute('aria-label', bi(lang, 'Total Usage & Cost', '本机累计用量与费用') + ' ' + cumStr);

        r.overflowBtn.setAttribute('aria-label', bi(lang, 'More telemetry', '更多遥测指标'));
        r.overflowMenu.setAttribute('aria-label', bi(lang, 'More telemetry', '更多遥测指标'));

        clearChildren(r.overflowMenu);
        function makeOverflowItem(viewKey: CdpTopBarViewKey, labelText: string, valueText: string): HTMLButtonElement {
            const item = el('button', 'acm-overflow-row');
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-overflow-view', viewKey);
            item.appendChild(el('span', '', labelText));
            item.appendChild(el('strong', 'acm-num', valueText));
            preventFocusStealOnMouseDown(item);
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                openTopBarView(viewKey, r.overflowBtn, true);
            });
            return item;
        }
        r.overflowMenu.appendChild(makeOverflowItem('context', bi(lang, 'Context', '上下文用量'), ctxLabel));
        r.overflowMenu.appendChild(makeOverflowItem('speed', bi(lang, 'Speed', '生成速度'), speedLabel));
        r.overflowMenu.appendChild(makeOverflowItem('total', bi(lang, 'Recorded Total', '本机已记录'), cumStr));
        const ovBoardBtn = el('button', 'acm-btn', bi(lang, 'Model Quota Board', '模型配额面板'));
        ovBoardBtn.type = 'button';
        ovBoardBtn.setAttribute('role', 'menuitem');
        ovBoardBtn.setAttribute('data-overflow-view', 'quota');
        preventFocusStealOnMouseDown(ovBoardBtn);
        ovBoardBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openTopBarView('quota', r.overflowBtn, true);
        });
        r.overflowMenu.appendChild(ovBoardBtn);

        state.countdownSec = typeof p.nextRefreshSec === 'number' && Number.isFinite(p.nextRefreshSec)
            ? Math.max(0, Math.round(p.nextRefreshSec))
            : null;

        renderTopBarPopover();
        applyTopBarResponsiveLayout();
        if (state.topBarActiveView) {
            positionPopoverNear(resolveTopBarAnchor(state.topBarActiveView, null), state.topBarRefs.quotaPopover, false);
        }
    }

    function repositionOpenPopovers(): void {
        if (state.composerOpen && state.composerRefs) {
            positionPopoverNear(state.composerRefs.trigger, state.composerRefs.popover, true);
        }
        if (state.topBarActiveView && state.topBarRefs) {
            positionPopoverNear(resolveTopBarAnchor(state.topBarActiveView, null), state.topBarRefs.quotaPopover, false);
        }
        if (state.overflowOpen && state.topBarRefs) {
            positionPopoverNear(state.topBarRefs.overflowBtn, state.topBarRefs.overflowMenu, false);
        }
    }

    function cancelScheduledLayoutSync(): void {
        if (state.layoutSyncHandle === null) { return; }
        if (state.layoutSyncIsRaf && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(state.layoutSyncHandle as number);
        } else {
            clearTimeout(state.layoutSyncHandle as ReturnType<typeof setTimeout>);
        }
        state.layoutSyncHandle = null;
        state.layoutSyncIsRaf = false;
    }

    function runLayoutSyncNow(): void {
        if (state.composerEnabled) { anchorComposerHost(); }
        if (state.topBarEnabled) {
            anchorTopBarHost();
            applyTopBarResponsiveLayout();
        }
        repositionOpenPopovers();
        refreshResizeObserverTargets();
    }

    function scheduleLayoutSync(): void {
        if (state.layoutSyncHandle !== null) { return; }
        if (typeof requestAnimationFrame === 'function') {
            state.layoutSyncIsRaf = true;
            state.layoutSyncHandle = requestAnimationFrame(() => {
                state.layoutSyncHandle = null;
                state.layoutSyncIsRaf = false;
                runLayoutSyncNow();
            });
        } else {
            state.layoutSyncIsRaf = false;
            state.layoutSyncHandle = setTimeout(() => {
                state.layoutSyncHandle = null;
                runLayoutSyncNow();
            }, 16);
        }
    }

    function collectLayoutWatchNodes(): Element[] {
        const nodes: Element[] = [];
        const pushUnique = (n: Element | null | undefined) => {
            if (n && n.isConnected && nodes.indexOf(n) < 0) { nodes.push(n); }
        };
        pushUnique(document.querySelector('.agy-sheet'));
        const split = document.querySelector('[data-testid="sidebar-split"]');
        if (split && split.firstElementChild) {
            pushUnique(split.firstElementChild);
        }
        pushUnique(document.querySelector('[data-testid="aux-pane-split"]'));
        pushUnique(document.querySelector('[data-side-panel-strip]'));
        return nodes;
    }

    function refreshResizeObserverTargets(): void {
        if (!state.layoutObserver) { return; }
        const nextNodes = collectLayoutWatchNodes();
        let same = nextNodes.length === state.observedLayoutNodes.length;
        if (same) {
            for (let i = 0; i < nextNodes.length; i++) {
                if (nextNodes[i] !== state.observedLayoutNodes[i]) { same = false; break; }
            }
        }
        if (same) { return; }
        if (state.observedLayoutNodes.length > 0) {
            try { state.layoutObserver.disconnect(); } catch { /* ignore */ }
        }
        state.observedLayoutNodes = [];
        for (let j = 0; j < nextNodes.length; j++) {
            try {
                state.layoutObserver.observe(nextNodes[j]);
                state.observedLayoutNodes.push(nextNodes[j]);
            } catch { /* ignore */ }
        }
    }

    function onGlobalClick(ev: Event): void {
        const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
        if (state.composerOpen && state.composerPinned && state.composerHost && path.indexOf(state.composerHost) < 0) {
            closeComposerPopover(true);
        }
        if ((state.topBarActiveView || state.overflowOpen) && state.topBarHost && path.indexOf(state.topBarHost) < 0) {
            closeTopBarPopover();
            closeOverflowMenu();
        }
    }

    function onGlobalKeyDown(ev: Event): void {
        const ke = ev as KeyboardEvent;
        if (ke.key !== 'Escape') { return; }
        const activeHost = document.activeElement;
        if (state.composerOpen && state.composerRefs) {
            const shouldRestore = Boolean(state.composerHost && activeHost === state.composerHost);
            closeComposerPopover(true);
            if (shouldRestore && typeof state.composerRefs.trigger.focus === 'function') {
                try { state.composerRefs.trigger.focus(); } catch { /* ignore */ }
            }
        }
        if (state.topBarActiveView || state.overflowOpen) {
            const activeView = state.topBarActiveView;
            const wasOverflow = state.overflowOpen;
            const shouldRestore = Boolean(state.topBarHost && activeHost === state.topBarHost);
            closeTopBarPopover();
            closeOverflowMenu();
            if (shouldRestore && state.topBarRefs) {
                const targetTrigger = wasOverflow
                    ? state.topBarRefs.overflowBtn
                    : (activeView ? getTopBarPillForView(activeView) : null);
                if (targetTrigger && !targetTrigger.classList.contains('is-hidden') && typeof targetTrigger.focus === 'function') {
                    try { targetTrigger.focus(); } catch { /* ignore */ }
                }
            }
        }
    }

    function onWindowResize(): void {
        if (state.topBarEnabled) {
            anchorTopBarHost();
            applyTopBarResponsiveLayout();
        }
        repositionOpenPopovers();
    }

    function onWcoGeometryChange(): void {
        if (!state.topBarEnabled && !state.composerEnabled) { return; }
        if (state.topBarEnabled) {
            anchorTopBarHost();
            applyTopBarResponsiveLayout();
        }
        repositionOpenPopovers();
    }

    function ensureWcoListenerBound(): void {
        if (state.boundWcoTarget) { return; }
        try {
            if (nav && nav.windowControlsOverlay && typeof nav.windowControlsOverlay.addEventListener === 'function') {
                nav.windowControlsOverlay.addEventListener('geometrychange', onWcoGeometryChange);
                state.boundWcoTarget = nav.windowControlsOverlay;
            }
        } catch { /* ignore */ }
    }

    function onTransitionEnd(ev: Event): void {
        if (!state.topBarEnabled && !state.composerEnabled) { return; }
        const te = ev as TransitionEvent;
        const prop = te && te.propertyName ? String(te.propertyName) : '';
        if (prop && prop !== 'width' && prop !== 'flex-basis' && prop !== 'transform' && prop !== 'padding-left' && prop !== 'padding-right') {
            return;
        }
        scheduleLayoutSync();
    }

    const STREAMING_BODY_TAGS: Record<string, boolean> = {
        PRE: true, CODE: true, BLOCKQUOTE: true, TABLE: true, TBODY: true,
        TR: true, TD: true, TH: true, ARTICLE: true, P: true,
        UL: true, OL: true, LI: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
    };

    const NON_STRUCTURAL_INLINE_TAGS: Record<string, boolean> = {
        SPAN: true, P: true, CODE: true, PRE: true, BR: true, STRONG: true, EM: true,
        B: true, I: true, U: true, S: true, A: true, LI: true, UL: true, OL: true,
        TR: true, TD: true, TH: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
        MARK: true, SMALL: true, SUB: true, SUP: true, HR: true, IMG: true,
        SVG: true, PATH: true, CIRCLE: true, RECT: true, LINE: true, G: true,
    };

    const STREAMING_CONTAINER_RE = /\b(?:prose|markdown|message-body|message-content|assistant-message|response-body|chat-message|streaming|code-block|hljs|shiki|katex|turn-content)\b/i;
    const STREAMING_TESTID_RE = /message|markdown|response|stream|thinking|prose|code-block/i;
    const SHELL_CLASS_RE = /agy-sheet|agy-composer-footer|surface-composer|composer-footer/i;

    function isInsideStreamingContent(node: Node | null | undefined): boolean {
        let cur: Node | null = node || null;
        let depth = 0;
        while (cur && cur !== document.body && cur !== document.documentElement && depth < 12) {
            if (cur.nodeType === 1) {
                const elCur = cur as Element;
                const tag = String(elCur.tagName || '').toUpperCase();
                if (typeof elCur.getAttribute === 'function') {
                    const tid = elCur.getAttribute('data-testid') || '';
                    if (
                        tid === 'sidebar-split'
                        || tid === 'pane-titlebar-toolbar'
                        || tid === 'toggle-aux-sidebar'
                        || tid === 'sidebar-toggle'
                        || tid === 'input-box-bottom-toolbar'
                        || tid === 'permissions-selector-trigger'
                        || tid === 'aux-pane-split'
                    ) {
                        return false;
                    }
                    if (
                        elCur.getAttribute('contenteditable') === 'true'
                        || elCur.getAttribute('data-message-id') !== null
                        || elCur.getAttribute('data-role') === 'assistant'
                        || elCur.getAttribute('data-role') === 'user'
                        || (tid && STREAMING_TESTID_RE.test(tid))
                    ) {
                        return true;
                    }
                }
                const cls = typeof elCur.className === 'string' ? elCur.className : '';
                if (cls) {
                    if (SHELL_CLASS_RE.test(cls)) { return false; }
                    if (STREAMING_CONTAINER_RE.test(cls)) { return true; }
                }
                if (STREAMING_BODY_TAGS[tag]) {
                    return true;
                }
            }
            cur = (cur as Element).parentElement || cur.parentNode;
            depth += 1;
        }
        return false;
    }

    function isStructuralElementNode(node: Node | null | undefined): boolean {
        if (!node || node.nodeType !== 1) { return false; }
        if (node === state.composerHost || node === state.topBarHost) { return true; }
        const elNode = node as Element;
        if (typeof elNode.getAttribute === 'function') {
            if (
                elNode.getAttribute('data-testid')
                || elNode.getAttribute('data-conversation-id')
                || elNode.getAttribute('data-cascade-id')
                || elNode.getAttribute('data-active-conversation-id')
                || elNode.getAttribute('data-new-conversation')
                || elNode.getAttribute('data-pane-unfocused') !== null
                || elNode.getAttribute('data-side-panel-strip') !== null
                || elNode.getAttribute('data-sidebar-closed') !== null
                || elNode.getAttribute('data-agent-composer-root') !== null
            ) {
                return true;
            }
        }
        const cls = typeof elNode.className === 'string' ? elNode.className : '';
        if (cls && SHELL_CLASS_RE.test(cls)) { return true; }
        const tag = String(elNode.tagName || '').toUpperCase();
        if (NON_STRUCTURAL_INLINE_TAGS[tag]) { return false; }
        return true;
    }

    function ensureObserversRunning(): void {
        ensureWcoListenerBound();
        if (!state.domObserver && typeof MutationObserver !== 'undefined' && document.body) {
            state.domObserver = new MutationObserver((records) => {
                let hasLayoutAttrChange = false;
                let hasRelevantChildChange = false;
                const hostsIntact = (!state.composerEnabled || Boolean(state.composerHost && state.composerHost.isConnected))
                    && (!state.topBarEnabled || Boolean(state.topBarHost && state.topBarHost.isConnected));

                if (Array.isArray(records)) {
                    for (let i = 0; i < records.length; i++) {
                        const rec = records[i];
                        if (!rec || rec.target === state.topBarHost || rec.target === state.composerHost) { continue; }
                        if (rec.type === 'attributes') {
                            if (rec.attributeName !== 'data-pane-unfocused' && isInsideStreamingContent(rec.target)) {
                                continue;
                            }
                            hasLayoutAttrChange = true;
                        } else if (rec.type === 'childList') {
                            if (!hostsIntact) {
                                hasRelevantChildChange = true;
                                break;
                            }
                            if (isInsideStreamingContent(rec.target)) {
                                continue;
                            }
                            const added = rec.addedNodes;
                            const removed = rec.removedNodes;
                            const hasLists = Boolean((added && added.length > 0) || (removed && removed.length > 0));
                            if (hasLists) {
                                let foundStructural = false;
                                if (added) {
                                    for (let a = 0; a < added.length; a++) {
                                        if (isStructuralElementNode(added[a])) { foundStructural = true; break; }
                                    }
                                }
                                if (!foundStructural && removed) {
                                    for (let rm = 0; rm < removed.length; rm++) {
                                        if (isStructuralElementNode(removed[rm])) { foundStructural = true; break; }
                                    }
                                }
                                if (foundStructural) {
                                    hasRelevantChildChange = true;
                                }
                            } else {
                                // Synthetic childList record without node arrays (test harness fallback)
                                hasRelevantChildChange = true;
                            }
                        }
                    }
                } else {
                    hasRelevantChildChange = true;
                }
                if (hasLayoutAttrChange) {
                    scheduleLayoutSync();
                    if (state.sidebarTransitionTimer) { clearTimeout(state.sidebarTransitionTimer); }
                    state.sidebarTransitionTimer = setTimeout(() => {
                        state.sidebarTransitionTimer = null;
                        runLayoutSyncNow();
                    }, 540);
                }
                if (hasRelevantChildChange && !state.reanchorTimer) {
                    state.reanchorTimer = setTimeout(() => {
                        state.reanchorTimer = null;
                        runLayoutSyncNow();
                    }, 150);
                }
                if (hasLayoutAttrChange || hasRelevantChildChange) {
                    scheduleHubFocusSync();
                }
            });
            state.domObserver.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: false,
                attributes: true,
                attributeFilter: ['data-sidebar-closed', 'data-side-panel-docked', 'data-side-panel-maximized', 'data-pane-unfocused', 'aria-expanded', 'hidden'],
            });
        }
        if (!state.layoutObserver && typeof ResizeObserver === 'function') {
            state.layoutObserver = new ResizeObserver(() => {
                scheduleLayoutSync();
            });
            refreshResizeObserverTargets();
        }
        if (!state.themeObserver && typeof MutationObserver !== 'undefined' && document.documentElement) {
            state.themeObserver = new MutationObserver(() => { syncThemes(); });
            state.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-agy-theme', 'data-vscode-theme-kind', 'data-contrast'] });
            if (document.body) {
                state.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-agy-theme', 'data-vscode-theme-kind', 'data-contrast'] });
            }
        }
        if (!state.countdownTimer) {
            state.countdownTimer = setInterval(() => {
                if (state.topBarActiveView && typeof state.countdownSec === 'number' && state.countdownSec > 0) {
                    state.countdownSec -= 1;
                    updateQuotaMetaClock();
                }
            }, 1000);
        }
    }

    function stopObserversIfIdle(): void {
        if (state.composerEnabled || state.topBarEnabled) { return; }
        if (state.domObserver) { state.domObserver.disconnect(); state.domObserver = null; }
        if (state.themeObserver) { state.themeObserver.disconnect(); state.themeObserver = null; }
        if (state.layoutObserver) { state.layoutObserver.disconnect(); state.layoutObserver = null; state.observedLayoutNodes = []; }
        if (state.reanchorTimer) { clearTimeout(state.reanchorTimer); state.reanchorTimer = null; }
        if (state.sidebarTransitionTimer) { clearTimeout(state.sidebarTransitionTimer); state.sidebarTransitionTimer = null; }
        cancelScheduledLayoutSync();
        if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
        clearComposerHoverTimers();
        clearTopBarHoverTimers();
        if (state.focusSyncTimer) { clearTimeout(state.focusSyncTimer); state.focusSyncTimer = null; }
    }

    function unmountSlot(slot: CdpOverlaySlot = 'all'): { unmounted: CdpOverlaySlot } {
        if (slot === 'composer' || slot === 'all') {
            closeComposerPopover(true);
            state.composerEnabled = false;
            if (state.composerHost && state.composerHost.parentNode) {
                state.composerHost.parentNode.removeChild(state.composerHost);
            }
            const strayComposer = document.getElementById(COMPOSER_HOST_ID);
            if (strayComposer && strayComposer.parentNode) {
                strayComposer.parentNode.removeChild(strayComposer);
            }
            state.composerHost = null;
            state.composerShadow = null;
            state.composerRefs = null;
        }
        if (slot === 'topbar' || slot === 'all') {
            closeTopBarPopover();
            closeOverflowMenu();
            state.topBarEnabled = false;
            if (state.topBarHost && state.topBarHost.parentNode) {
                state.topBarHost.parentNode.removeChild(state.topBarHost);
            }
            const strayTopBar = document.getElementById(TOPBAR_HOST_ID);
            if (strayTopBar && strayTopBar.parentNode) {
                strayTopBar.parentNode.removeChild(strayTopBar);
            }
            state.topBarHost = null;
            state.topBarShadow = null;
            state.topBarRefs = null;
        }
        stopObserversIfIdle();
        if (slot === 'all') {
            document.removeEventListener('click', onGlobalClick, true);
            document.removeEventListener('keydown', onGlobalKeyDown, true);
            document.removeEventListener('transitionend', onTransitionEnd, true);
            window.removeEventListener('resize', onWindowResize);
            window.removeEventListener('popstate', onHubNavigationChange);
            window.removeEventListener('hashchange', onHubNavigationChange);
            state.focusDelivery = null;
            state.topBarWarmUntilMs = 0;
            try {
                const wcoTarget = state.boundWcoTarget || (nav && nav.windowControlsOverlay);
                if (wcoTarget && typeof wcoTarget.removeEventListener === 'function') {
                    wcoTarget.removeEventListener('geometrychange', onWcoGeometryChange);
                }
            } catch { /* ignore */ }
            state.boundWcoTarget = null;
            try { delete win[GLOBAL_KEY]; } catch { win[GLOBAL_KEY] = undefined; }
        }
        return { unmounted: slot };
    }

    document.addEventListener('click', onGlobalClick, true);
    document.addEventListener('keydown', onGlobalKeyDown, true);
    document.addEventListener('transitionend', onTransitionEnd, true);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('popstate', onHubNavigationChange);
    window.addEventListener('hashchange', onHubNavigationChange);
    ensureWcoListenerBound();

    win[GLOBAL_KEY] = {
        version: SCRIPT_VERSION,
        buildId: BUILD_ID,
        applyState(payload, toggles): CdpOverlayApplyResult {
            state.payload = payload || state.payload;
            const nextComposer = Boolean(toggles && toggles.appComposerRingEnabled);
            const nextTopBar = Boolean(toggles && toggles.appTopBarEnabled);

            if (!nextComposer && state.composerEnabled) {
                unmountSlot('composer');
            }
            if (!nextTopBar && state.topBarEnabled) {
                unmountSlot('topbar');
            }

            state.composerEnabled = nextComposer;
            state.topBarEnabled = nextTopBar;

            if (nextComposer || nextTopBar) {
                ensureObserversRunning();
            }
            if (nextComposer) {
                anchorComposerHost();
                renderComposer();
            }
            if (nextTopBar) {
                anchorTopBarHost();
                renderTopBar();
            }
            if (nextComposer || nextTopBar) {
                refreshResizeObserverTargets();
                syncHubConversationFocus();
            }
            syncThemes();
            let currentOrigin = '';
            let currentHref = '';
            try {
                if (window && window.location) {
                    currentOrigin = typeof window.location.origin === 'string' ? window.location.origin : '';
                    currentHref = typeof window.location.href === 'string' ? window.location.href : '';
                }
            } catch { /* ignore */ }
            return {
                ok: true,
                version: SCRIPT_VERSION,
                buildId: BUILD_ID,
                origin: currentOrigin,
                href: currentHref,
                composerMounted: Boolean(state.composerHost && state.composerHost.isConnected),
                topBarMounted: Boolean(state.topBarHost && state.topBarHost.isConnected),
            };
        },
        unmount: unmountSlot,
        getStatus() {
            return {
                version: SCRIPT_VERSION,
                buildId: BUILD_ID,
                composerEnabled: state.composerEnabled,
                topBarEnabled: state.topBarEnabled,
                composerMounted: Boolean(state.composerHost && state.composerHost.isConnected),
                topBarMounted: Boolean(state.topBarHost && state.topBarHost.isConnected),
                topBarAnchorMode: state.topBarAnchorMode,
                topBarAnchorTier: state.topBarAnchorTier,
                topBarActiveView: state.topBarActiveView,
                topBarPinned: state.topBarPinned,
                fontSizePreset: state.fontSizePreset,
                highContrast: state.highContrast,
            };
        },
    };

    return { installed: true, reused: false, version: SCRIPT_VERSION, buildId: BUILD_ID };
}
